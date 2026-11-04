"""The flood list on the recorded answers of 2026-11-04 (PLAN-5 3.2): contract-valid, grouped as reviewed by hand
(``tests/data/floods/catalog/cases.json``), ordered by rank, never a fire id; the time zone is IANA, never NWPS's."""

from __future__ import annotations

import json
from pathlib import Path

from conftest import FLOOD_SAMPLES, recorded_flood_inputs

from fire3d import contracts as C
from fire3d import regions
from fire3d.floods import catalog as cat
from fire3d.floods import grouping as G
from fire3d.floods import naming
from fire3d.floods import registry as reg_mod

CASES = json.loads((FLOOD_SAMPLES / "catalog" / "cases.json").read_text())


def _build():
    inp, now = recorded_flood_inputs()
    return cat.build_list(inp, now), now


def test_recorded_day_matches_the_reviewed_groups(flood_iso: Path) -> None:
    lst, now = _build()
    assert C.contract_problems(C.FloodListResponse, cat.public_list(lst)) == []
    got = [{"name": s["name"], "kind": s["kind"], "level": s["level"], "state": s["state"], "max_category": s["max_category"],
            "gauges": [g["lid"] for g in s["gauges"]],
            "vtec_keys": sorted({p["vtec_key"] for p in s["products"] if p["vtec_key"]})} for s in lst["floods"]]
    assert got == CASES["floods"]
    assert lst["products_in_effect"] == CASES["products_in_effect"]
    by = {s["name"]: s for s in lst["floods"]}
    # the KEAX product lists every river in its headline; each segment's own WHERE line decides (102 River stays apart)
    assert by["102 River flood"]["gauges"][0]["lid"] == "RSDM7"
    assert "RSDM7" not in [g["lid"] for g in by["Platte River flood"]["gauges"]]
    assert by["Silver Creek flood"]["kind"] == "river" and by["Silver Creek flood"]["products"]   # gauge + areal warning


def test_recorded_day_invariants(flood_iso: Path) -> None:
    lst, now = _build()
    ranks = [G.flood_rank(s) for s in lst["floods"]]
    assert ranks == sorted(ranks, reverse=True)
    l48 = set(regions.L48)
    ids = [s["id"] for s in lst["floods"]]
    assert len(ids) == len(set(ids))
    for s in lst["floods"]:
        assert naming.is_flood_id(s["id"]) and "fire" not in s["name"].lower()
        assert s["state"] in l48 and set(s["states"]) <= l48
        assert "/" in s["time_zone"] and "MST7MDT" not in s["time_zone"]
        assert s["synthetic"] is False
        stale = all((now - (g["observed_ms"] or 0)) > G.GAUGE_ACTIVE_H * G.H_MS for g in s["gauges"])
        assert s["status"] == ("inactive" if (s["level"] == "gauge_only" and stale) else "active"), s["name"]
        w, sth, e, n = s["bbox_lonlat"]
        assert w < e and sth < n and w <= s["lon"] <= e and sth <= s["lat"] <= n
        if s["level"] == "gauge_only":
            assert s["caveat"] and s["products"] == []
        if s["primary_gauge"]:
            assert s["primary_gauge"] == s["gauges"][0]
    names = [s["name"] for s in lst["floods"]]
    assert len(names) == len(set(names))                                       # duplicates resolved (rule 9)
    assert {s["name"]: s["status"] for s in lst["floods"]}["Salinas River flood"] == "inactive"   # its reading is 23 h old


def test_ids_survive_a_restart(flood_iso: Path) -> None:
    first, now = _build()
    cat.reset_state()
    reg_mod.reset_registries()
    inp, _ = recorded_flood_inputs()
    again = cat.build_list(inp, now + 3_600_000)
    assert {s["name"]: s["id"] for s in again["floods"]} == {s["name"]: s["id"] for s in first["floods"]}
