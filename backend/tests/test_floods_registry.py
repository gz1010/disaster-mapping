"""Flood registry (``floods/registry.py``, PLAN-5 3.2 rule 10, CONTRACT 16.1): append-only lines, aliases, gauge
episodes, reloading, last-known summaries."""

from __future__ import annotations

import os
from pathlib import Path

import orjson

from fire3d.floods import registry as reg_mod
from fire3d.floods import store


def test_lines_aliases_episodes_and_reload(flood_iso: Path) -> None:
    reg = reg_mod.get_registry()
    a, b = "flood-20261104-platte-river-flood-aaaaaa", "flood-20261104-platte-river-flood-bbbbbb"
    reg.write(register=[("KEAX.FL.W.0217.2026", a, 1), ("AGYM7@1", a, 1), ("KEAX.FL.W.0223.2026", b, 5)])
    assert reg.id_for("KEAX.FL.W.0217.2026") == (a, 1) and reg.open_episode("agym7") == "AGYM7@1"
    reg.write(aliases=[(b, a)])
    assert reg.id_for("KEAX.FL.W.0223.2026") == (a, 5) and reg.aliases_of(a) == [b] and reg.canonical(b) == a
    reg.write(retire=[("AGYM7@1", 9)])
    assert reg.open_episode("AGYM7") is None and reg.id_for("AGYM7@1") is None
    reg.write(register=[("AGYM7@100", "flood-20261204-platte-river-flood-cccccc", 100)])
    assert reg.open_episode("AGYM7") == "AGYM7@100"
    lines = [orjson.loads(x) for x in store.registry_path().read_bytes().splitlines()]
    assert {"alias": b, "id": a} in lines and {"retire": "AGYM7@1", "at_ms": 9} in lines
    # a second process appended a line: the registry reloads it; a torn last line is ignored
    with open(store.registry_path(), "ab") as f:
        f.write(orjson.dumps({"key": "KTOP.FL.W.0001.2026", "id": a, "first_seen_ms": 7}) + b"\n" + b'{"key": "tor')
    reg_mod.reset_registries()
    again = reg_mod.get_registry()
    assert again.id_for("KTOP.FL.W.0001.2026") == (a, 7) and again.canonical(b) == a
    assert set(again.keys_of(a)) >= {"KEAX.FL.W.0217.2026", "KEAX.FL.W.0223.2026", "KTOP.FL.W.0001.2026"}


def test_first_registration_wins(flood_iso: Path) -> None:
    reg = reg_mod.get_registry()
    reg.write(register=[("K1", "flood-20261104-x-flood-111111", 1)])
    reg.write(register=[("K1", "flood-20261104-x-flood-222222", 2)])             # ignored: keys are permanent
    assert reg.id_for("K1") == ("flood-20261104-x-flood-111111", 1)


def test_last_known_summaries(flood_iso: Path) -> None:
    s = {"id": "flood-20261104-joshua-creek-flood-231c11", "name": "Joshua Creek flood", "status": "active"}
    reg_mod.write_last_known(s, 1_793_815_200_000)
    got = reg_mod.read_last_known(s["id"])
    assert got is not None and got[0] == s and abs(got[1] - 1_793_815_200_000) < 2000
    reg_mod.write_last_known(s, 1_793_818_800_000)                                 # same content: only the time moves
    assert abs(reg_mod.read_last_known(s["id"])[1] - 1_793_818_800_000) < 2000
    assert [x[0]["id"] for x in reg_mod.iter_last_known()] == [s["id"]]
    assert reg_mod.read_last_known("flood-20261104-nothing-here-000000") is None
    assert store.valid_id("fixture-flood") and store.valid_id(s["id"]) and not store.valid_id("../etc")
    assert not store.valid_id("2025-eaton-fire-dbfa57")                            # a fire id is never a flood id
    os.makedirs(store.floods_dir(), exist_ok=True)
