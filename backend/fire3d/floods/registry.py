"""Stable flood ids (PLAN-5 3.2 rule 10, CONTRACT 16.1): ``data/floods/registry.jsonl`` and the last-known summaries.

Append-only lines: ``{"key": k, "id": id, "first_seen_ms": n}`` (a member key belongs to a flood id),
``{"alias": old, "id": id}`` (two floods merged: the older id stays, the other resolves to it) and
``{"retire": k, "at_ms": n}`` (a gauge episode closed). **Keys:** a VTEC key ``KABQ.FL.W.0019.2026`` is permanent; a
CAP reference chain key ``CAP:<identifier>`` stands in when NWS sends no VTEC; a gauge key is an **episode**
``{NWSLI}@{first_seen_ms}``: the same gauge flooding again after its flood was quiet for more than ``GAUGE_ACTIVE_H``
gets a new episode and so a new id (C8).

Last-known summaries ``last_known/{id}.json`` (a ``FloodSummary``) are written for every flood built from the
current lists; the file's mtime is when Fire-3d last saw the flood. They keep an id that left the lists listed (as
inactive) for ``INACTIVE_LISTED_H`` and resolvable afterwards (rule 13, C20).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

import orjson

from .. import bundle
from . import store

log = logging.getLogger(__name__)


def gauge_episode_key(nwsli: str, first_seen_ms: int) -> str:
    return f"{nwsli.upper()}@{int(first_seen_ms)}"


def is_gauge_key(key: str) -> bool:
    return "@" in key


@dataclass
class Registry:
    """The registry file's state. Thread-safe; reloaded when the file changes on disk (another process)."""

    path: Path
    keys: dict[str, tuple[str, int]] = field(default_factory=dict)       # key -> (id, first_seen_ms)
    retired: dict[str, int] = field(default_factory=dict)
    aliases: dict[str, str] = field(default_factory=dict)                 # old id -> id
    _stamp: tuple[int, int] | None = None
    _lock: threading.RLock = field(default_factory=threading.RLock)

    # ---- loading -----------------------------------------------------------------------------------------------
    def _file_stamp(self) -> tuple[int, int] | None:
        try:
            st = self.path.stat()
        except FileNotFoundError:
            return None
        return (st.st_size, st.st_mtime_ns)

    def refresh(self) -> None:
        with self._lock:
            stamp = self._file_stamp()
            if stamp == self._stamp:
                return
            self.keys.clear()
            self.retired.clear()
            self.aliases.clear()
            if stamp is not None:
                for raw in self.path.read_bytes().splitlines():
                    try:
                        line = orjson.loads(raw)
                    except orjson.JSONDecodeError:
                        continue                          # a torn last line after a crash: ignored
                    self._apply(line)
            self._stamp = stamp

    def _apply(self, line: Any) -> None:
        if not isinstance(line, dict):
            return
        if "key" in line and "id" in line:
            k = str(line["key"])
            if k not in self.keys:
                self.keys[k] = (str(line["id"]), int(line.get("first_seen_ms") or 0))
            elif "reassign" in line:
                self.keys[k] = (str(line["id"]), self.keys[k][1])
        elif "alias" in line and "id" in line:
            if str(line["alias"]) != str(line["id"]):
                self.aliases[str(line["alias"])] = str(line["id"])
        elif "retire" in line:
            self.retired[str(line["retire"])] = int(line.get("at_ms") or 0)

    def _append(self, lines: list[dict]) -> None:
        if not lines:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = b"".join(orjson.dumps(x) + b"\n" for x in lines)
        with open(self.path, "ab") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        for x in lines:
            self._apply(x)
        self._stamp = self._file_stamp()

    # ---- queries -----------------------------------------------------------------------------------------------
    def id_for(self, key: str) -> tuple[str, int] | None:
        """(id, first_seen_ms) of a live (not retired) key, following aliases."""
        with self._lock:
            hit = self.keys.get(key)
            if hit is None or key in self.retired:
                return None
            return self.canonical(hit[0]), hit[1]

    def canonical(self, flood_id: str) -> str:
        seen = set()
        while flood_id in self.aliases and flood_id not in seen:
            seen.add(flood_id)
            flood_id = self.aliases[flood_id]
        return flood_id

    def aliases_of(self, flood_id: str) -> list[str]:
        with self._lock:
            return sorted(a for a in self.aliases if self.canonical(a) == flood_id and a != flood_id)

    def open_episode(self, nwsli: str) -> str | None:
        """The newest gauge episode key of ``nwsli`` that is not retired, or None."""
        prefix = nwsli.upper() + "@"
        with self._lock:
            eps = [k for k in self.keys if k.startswith(prefix) and k not in self.retired]
        return max(eps, key=lambda k: int(k.split("@", 1)[1])) if eps else None

    def keys_of(self, flood_id: str) -> list[str]:
        with self._lock:
            return [k for k, (i, _) in self.keys.items() if self.canonical(i) == flood_id]

    def known_ids(self) -> set[str]:
        with self._lock:
            return {self.canonical(i) for i, _ in self.keys.values()} | set(self.aliases)

    # ---- writes ------------------------------------------------------------------------------------------------
    def write(self, *, register: list[tuple[str, str, int]] = (), aliases: list[tuple[str, str]] = (),
              retire: list[tuple[str, int]] = (), reassign: list[tuple[str, str]] = ()) -> None:
        lines: list[dict] = []
        with self._lock:
            self.refresh()
            for k, i, t in register:
                if k not in self.keys:
                    lines.append({"key": k, "id": i, "first_seen_ms": int(t)})
            for k, i in reassign:
                lines.append({"key": k, "id": i, "reassign": True})
            for old, new in aliases:
                if old != new and self.aliases.get(old) != new:
                    lines.append({"alias": old, "id": new})
            for k, t in retire:
                if k not in self.retired:
                    lines.append({"retire": k, "at_ms": int(t)})
            try:
                self._append(lines)
            except OSError as e:                         # a read-only data dir must not break the list
                log.warning("flood registry not written: %s", e)
                for x in lines:
                    self._apply(x)


_registries: dict[str, Registry] = {}
_reg_lock = threading.Lock()


def get_registry() -> Registry:
    """The registry of the current ``config.FLOODS_DIR`` (one per path; tests point FLOODS_DIR at a temp dir)."""
    path = store.registry_path()
    with _reg_lock:
        reg = _registries.get(str(path))
        if reg is None:
            reg = _registries[str(path)] = Registry(path)
    reg.refresh()
    return reg


def reset_registries() -> None:
    with _reg_lock:
        _registries.clear()


# ----------------------------------------------------------------------------------------------------------------
# Last-known summaries
# ----------------------------------------------------------------------------------------------------------------
def write_last_known(summary: dict, now_ms: int | None = None) -> None:
    """Save the summary as the id's last-known one; the file's mtime records when it was last seen (``now_ms``)."""
    try:
        p = store.last_known_path(summary["id"])
        data = orjson.dumps(summary, option=orjson.OPT_SORT_KEYS)
        if not p.is_file() or p.read_bytes() != data:
            bundle.atomic_write_bytes(p, data)
        t = (now_ms if now_ms is not None else time.time() * 1000) / 1000.0
        os.utime(p, (t, t))
    except (OSError, ValueError, KeyError) as e:
        log.warning("last-known flood summary not written: %s", e)


def read_last_known(flood_id: str) -> tuple[dict, int] | None:
    """(summary, last_seen_ms) of an id, or None."""
    try:
        p = store.last_known_path(flood_id)
        return orjson.loads(p.read_bytes()), int(p.stat().st_mtime * 1000)
    except (OSError, ValueError, orjson.JSONDecodeError):
        return None


def iter_last_known() -> Iterator[tuple[dict, int]]:
    d = store.floods_dir() / store.LAST_KNOWN_DIR
    if not d.is_dir():
        return
    for p in sorted(d.glob("*.json")):
        hit = read_last_known(p.stem) if store.valid_id(p.stem) else None
        if hit is not None:
            yield hit
