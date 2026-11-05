"""The flood list on the recorded answers of 2026-11-04 (PLAN-5 3.2): contract-valid, grouped as reviewed by hand
(``tests/data/floods/catalog/cases.json``), ordered by rank, never a fire id; the time zone is IANA, never NWPS's."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

from conftest import FLOOD_SAMPLES, recorded_flood_inputs

from fire3d import contracts as C
from fire3d import regions
from fire3d.floods import catalog as cat
from fire3d.floods import copy as fcopy
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


def test_recorded_day_winslow_is_one_flood_and_tide_gauges_say_so(flood_iso: Path) -> None:
    """Review BFS-R3 and BFS-R2 on the recorded day: NWS Flagstaff's areal Flood Warning and the Winslow gauge it names
    are one flood; gauge-only floods at tide or coastal gauges never claim that no NWS flood product names them."""
    lst, _ = _build()
    by = {s["name"]: s for s in lst["floods"]}
    lc = by["Little Colorado River flood"]
    assert lc["level"] == "warning" and [g["lid"] for g in lc["gauges"]] == ["LCWA3"]
    assert [p["vtec_key"] for p in lc["products"]] == ["KFGZ.FA.W.0038.2026"] and "Winslow flood" not in by
    for name in ("Juno Beach Park Pier flood", "Key Largo flood (FL)", "North Key Largo flood", "New River flood",
                 "Crescent Lake flood", "Dunns Creek State Park Boat Ramp flood", "Georgetown flood",
                 "Intracoastal Waterway flood", "Indian River flood", "St Lucie River flood"):
        assert by[name]["caveat"] == fcopy.GAUGE_ONLY_COASTAL_CAVEAT, name
    for name in ("Devils Lake flood", "Eastern Stump Lake flood", "Mancos River flood", "Salinas River flood"):
        assert by[name]["caveat"] == fcopy.GAUGE_ONLY_CAVEAT, name


def _down(inp: cat.Inputs, **which: bool) -> cat.Inputs:
    off = cat.SourceResult(None, None, error="down")
    return dataclasses.replace(inp, **{k: off for k, v in which.items() if v})


def test_recorded_day_outages_have_the_fixture_shapes(flood_iso: Path) -> None:
    """Review BFS-R4: with NWS unreachable (no earlier copy) every flood is rebuilt from its gauges, keeps its id
    (no split), never says GAUGE_ONLY_CAVEAT, and equals ``catalog.nws_down_row`` of its normal row, the helper that
    writes the fixture's ``edge/list-nws-down.json``; product-only floods are not listed. With the gauges down the
    floods equal ``catalog.gauges_down_row`` (the fixture's ``edge/list-gauges-down.json``)."""
    first, now = _build()
    before = {s["id"]: s for s in first["floods"]}
    inp, _ = recorded_flood_inputs()
    t = now + 600_000
    cat.reset_state()
    out = cat.build_list(_down(inp, alerts=True), t)
    assert C.contract_problems(C.FloodListResponse, cat.public_list(out)) == []
    assert all(s["caveat"] == fcopy.ALERTS_UNAVAILABLE for s in out["floods"])
    want = {i: r for i, r in ((i, cat.nws_down_row(s, t)) for i, s in before.items()) if r}
    assert {s["id"] for s in out["floods"]} == set(want)
    keys = ("kind", "level", "emergency", "products", "offices", "caveat", "expires_ms", "last_product_ms", "status")
    for s in out["floods"]:
        assert {k: s[k] for k in keys} == {k: want[s["id"]][k] for k in keys}, s["name"]
        assert s["primary_gauge"]["lid"] == want[s["id"]]["primary_gauge"]["lid"], s["name"]
    cat.reset_state()
    gd = cat.build_list(_down(inp, observed=True, forecast=True, rfc=True), t)
    reg = reg_mod.get_registry()                    # own keys: a gauge-only flood's products over its gauge are not its own
    want = {i: r for i, r in ((i, cat.gauges_down_row(s, set(reg.keys_of(i)))) for i, s in before.items()) if r}
    got = {s["id"]: s for s in gd["floods"]}
    assert set(got) == set(want)
    for i, s in got.items():
        w = want[i]
        assert (s["kind"], s["level"], s["gauges"], s["primary_gauge"], s["gauges_in_flood"], s["max_category"],
                s["caveat"], s["status"]) == (w["kind"], w["level"], w["gauges"], w["primary_gauge"],
                                              w["gauges_in_flood"], w["max_category"], w["caveat"], w["status"]), s["name"]
        assert [(p["id"], p["phase"]) for p in s["products"]] == [(p["id"], p["phase"]) for p in w["products"]]
    cat.reset_state()
    again = cat.build_list(inp, t + 600_000)                         # both lists back: the same floods and ids
    assert {s["id"] for s in again["floods"]} == set(before)
