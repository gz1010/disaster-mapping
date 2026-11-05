"""Flood folders (CONTRACT 16.1): bundles ``config.FLOODS_DIR/{id}/``, the registry ``registry.jsonl`` and the
last-known summaries ``last_known/{id}.json``. Fire folders and functions (``bundle.list_bundles`` ...) are untouched;
the folder-taking helpers of ``fire3d.bundle`` (``write_json``, ``update_manifest``, ``resolve_bundle_file`` ...) work
on a flood folder as they are."""

from __future__ import annotations

import fcntl
import os
import re
from pathlib import Path

from .. import bundle, config

FIXTURE_ID = "fixture-flood"
_ID_RE = re.compile(r"^(flood-\d{8}-[a-z0-9-]+-[0-9a-f]{6}|fixture-flood(-[a-z]+)?)$")
REGISTRY_NAME = "registry.jsonl"
BUILD_LOCK_NAME = ".build.lock"           # = build.pipeline.BUILD_LOCK_NAME (the flood builder takes the same lock)
LAST_KNOWN_DIR = "last_known"


def valid_id(flood_id: str) -> bool:
    return bool(_ID_RE.match(flood_id or ""))


def floods_dir() -> Path:
    return Path(config.FLOODS_DIR)


def flood_dir(flood_id: str) -> Path:
    """``FLOODS_DIR/{id}``; ValueError for anything that is not a flood id (no path tricks)."""
    if not valid_id(flood_id):
        raise ValueError(f"not a flood id: {flood_id!r}")
    return floods_dir() / flood_id


def registry_path() -> Path:
    return floods_dir() / REGISTRY_NAME


def last_known_path(flood_id: str) -> Path:
    if not valid_id(flood_id):
        raise ValueError(f"not a flood id: {flood_id!r}")
    return floods_dir() / LAST_KNOWN_DIR / f"{flood_id}.json"


def load_flood_manifest(flood_id: str) -> dict | None:
    """The bundle's manifest (any status), or None."""
    try:
        d = flood_dir(flood_id)
    except ValueError:
        return None
    m = bundle.load_manifest(d) if d.is_dir() else None
    return m if isinstance(m, dict) and m.get("hazard") == "flood" else None


def build_in_progress(flood_id: str) -> bool:
    """True while a build of this flood holds its exclusive lock (``floods.build``; a rebuild keeps the old files
    readable until it swaps the new ones in)."""
    try:
        d = flood_dir(flood_id)
        fd = os.open(d / BUILD_LOCK_NAME, os.O_RDONLY)
    except (ValueError, OSError):
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
    except BlockingIOError:
        return True
    else:
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    finally:
        os.close(fd)


def bundle_state(flood_id: str) -> tuple[str, int | None]:
    """(``FloodBundleStatus``, built_ms) from the folder and the build lock: building while a build runs, else
    ready / error from the manifest, or none. A "building" manifest left by a stopped process reads as error."""
    if build_in_progress(flood_id):
        return "building", None
    m = load_flood_manifest(flood_id)
    if m is None:
        return "none", None
    st = m.get("status")
    if st == "building":
        return "error", None
    return (st if st in ("ready", "error") else "none"), (m.get("built_ms") if st == "ready" else None)


def list_flood_bundles() -> list[dict]:
    """Every flood bundle's manifest under ``FLOODS_DIR`` (synthetic ones included), sorted by id."""
    root = floods_dir()
    out = []
    if root.is_dir():
        for d in sorted(root.iterdir()):
            if d.is_dir() and valid_id(d.name):
                m = load_flood_manifest(d.name)
                if m is not None:
                    out.append(m)
    return out
