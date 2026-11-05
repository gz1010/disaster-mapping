"""Flood grouping rules (PLAN-5 3.2 rules 1-12, CONTRACT 16.8) on hand-made inputs: each rule a test. Offline: the
network is refused (conftest), so a rule that needed a request would fail here (C9)."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from fire3d.floods import catalog as cat
from fire3d.floods import copy as fcopy
from fire3d.floods import grouping as G
from fire3d.floods import naming
from fire3d.floods import registry as reg_mod
from fire3d.sources import nws

H = 3_600_000
NOW = 1_793_815_200_000          # 2026-11-04T18:00:00Z


def iso(ms: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ms / 1000))


def vt(action: str, ph: str, sig: str, etn: int, begin: str = "000000T0000Z", end: str = "261106T0000Z", office: str = "KEAX") -> str:
    return f"/O.{action}.{office}.{ph}.{sig}.{etn:04d}.{begin}-{end}/"


def box(lon: float, lat: float, dx: float = 0.1, dy: float = 0.05) -> dict:
    return {"type": "Polygon", "coordinates": [[[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy],
                                                 [lon - dx, lat + dy], [lon - dx, lat - dy]]]}


def cap(cid: str, event: str, vtec: str | None, geom: dict | None, *, desc: str = "", ugcs=("MOC021",), same=("029021",),
        sent: int = NOW - 2 * H, ends: int | None = NOW + 20 * H, refs=(), area: str = "Buchanan, MO", params=None,
        headline: str | None = None, onset: int | None = None) -> dict:
    p = {"@id": f"https://api.weather.gov/alerts/{cid}", "id": cid, "status": "Actual", "event": event,
         "messageType": "Update", "senderName": "NWS Kansas City/Pleasant Hill MO", "sent": iso(sent),
         "effective": iso(sent), "onset": iso(onset) if onset else None, "expires": iso(sent + 6 * H),
         "ends": iso(ends) if ends else None, "headline": headline or f"{event} issued", "description": desc,
         "instruction": "Turn around, don't drown.", "areaDesc": area, "geocode": {"UGC": list(ugcs), "SAME": list(same)},
         "affectedZones": [], "references": [{"identifier": r, "sent": iso(t)} for r, t in refs],
         "parameters": {"VTEC": [vtec] if vtec else [], "AWIPSidentifier": ["FLSEAX"], **(params or {})}}
    return {"id": p["@id"], "type": "Feature", "geometry": geom, "properties": p}


def riv(lid: str, lon: float, lat: float, status: str, waterbody: str | None, *, value: float = 20.0,
        valid: int = NOW - 900_000, state: str = "MO", minor: float = 18.0) -> dict:
    return {"lid": lid, "name": lid.title(), "waterbody": waterbody, "state": state, "lon": lon, "lat": lat, "status": status,
            "value": value, "unit": "ft", "flow": 10.0, "flow_unit": "kcfs", "valid_ms": valid,
            "thresholds": {"action": minor - 2, "minor": minor, "moderate": minor + 4, "major": minor + 8},
            "wfo": "EAX", "url": f"https://water.noaa.gov/gauges/{lid.lower()}", "forecast_issued_ms": None}


def inputs(alerts=(), obs=(), fc=(), rfc=(), iem=(), *, nws_down=False, gauges_down=False) -> cat.Inputs:
    al = [a for a in (nws.normalize_flood_alert(f) for f in alerts) if a]
    return cat.Inputs(
        alerts=cat.SourceResult(None, None, error="down") if nws_down else
        cat.SourceResult(nws.FloodNational(al, NOW, NOW, list(nws.national_states())), NOW),
        observed=cat.SourceResult(None, None, error="down") if gauges_down else cat.SourceResult(list(obs), NOW),
        forecast=cat.SourceResult(list(fc), NOW), rfc=cat.SourceResult(list(rfc), NOW), iem=cat.SourceResult(list(iem), NOW))


def build(inp: cat.Inputs, now: int = NOW) -> dict:
    return cat.build_list(inp, now)


def names(lst: dict) -> list[str]:
    return sorted(s["name"] for s in lst["floods"])


def fresh() -> None:
    """A new, independent scenario: no registry, no last-known summaries, no cached list."""
    import shutil

    from fire3d import config

    shutil.rmtree(config.FLOODS_DIR, ignore_errors=True)
    cat.reset_state()


RIVER_DESC = "* WHAT...Minor flooding is occurring.\n\n* WHERE...Platte River near Agency.\n\n* WHEN...Until Friday."


@pytest.fixture(autouse=True)
def _iso(flood_iso: Path):
    yield


# ---- rule 1 ---------------------------------------------------------------------------------------------------------
def test_rule1_lower48_only() -> None:
    pr = cap("pr", "Flash Flood Warning", vt("NEW", "FF", "W", 5, office="TJSJ"), box(-66.0, 18.2), ugcs=("PRC025",),
             same=("072025",), area="Caguas, PR")
    mo = cap("mo", "Flood Warning", vt("CON", "FL", "W", 217), box(-94.7, 39.69), desc=RIVER_DESC)
    lst = build(inputs([pr, mo], obs=[riv("AGYM7", -94.70, 39.69, "moderate", "Platte River"),
                                      riv("SJUP4", -66.0, 18.2, "major", "Rio Grande de Loiza", state="PR")]))
    assert names(lst) == ["Platte River flood"]
    assert lst["products_in_effect"] == 1
    ended = cap("old", "Flood Warning", vt("CAN", "FL", "W", 9), box(-93.0, 39.0), desc=RIVER_DESC)
    after = build(inputs([ended]))                                   # cancelled: not in effect, never a flood
    assert after["products_in_effect"] == 0
    assert all(p["id"] != "old" for s in after["floods"] for p in s["products"])
    assert all(s["status"] == "inactive" for s in after["floods"])   # only the earlier flood, carried over (rule 8)


# ---- rule 2 ---------------------------------------------------------------------------------------------------------
def test_rule2_iem_join_links_the_named_gauge() -> None:
    flw = cap("a", "Flood Warning", vt("EXT", "FL", "W", 215), box(-94.83, 40.05, 0.05, 0.08),
              desc="* WHERE...102 River at Rosendale.")
    far = riv("RSDM7", -94.6, 40.3, "moderate", "102 River")           # outside the polygon: joined by H-VTEC key
    iem = [{"nwsli": "RSDM7", "office": "KEAX", "phenomena": "FL", "significance": "W", "etn": 215,
            "key4": ("KEAX", "FL", "W", 215)}]
    s = build(inputs([flw], obs=[far], iem=iem))["floods"]
    assert len(s) == 1 and [g["lid"] for g in s[0]["gauges"]] == ["RSDM7"] and s[0]["products"][0]["gauge_lids"] == ["RSDM7"]


def test_rule2_two_gauges_on_one_river_in_one_polygon() -> None:
    flw = cap("a", "Flood Warning", vt("CON", "FL", "W", 217), box(-94.7, 39.69, 0.3, 0.1), desc=RIVER_DESC)
    g1 = riv("AGYM7", -94.70, 39.69, "moderate", "Platte River")
    g2 = riv("SSTM7", -94.60, 39.70, "minor", "Platte River")
    other = riv("XXXM7", -94.65, 39.68, "minor", "Little Blue River")   # inside, on another river: not this product's
    lst = build(inputs([flw], obs=[g1, g2, other]))
    by_name = {s["name"]: s for s in lst["floods"]}
    assert {g["lid"] for g in by_name["Platte River flood"]["gauges"]} == {"AGYM7", "SSTM7"}   # no H-VTEC: both
    assert "Little Blue River flood" in by_name
    a = next(x for x in (nws.normalize_flood_alert(flw),) if x)
    nws._hvtec[(a["_awips"], nws.vtec_key(a["vtec"]))] = {"nwsli": "AGYM7", "severity": "2", "cause": "ER",
                                                         "begin_ms": None, "crest_ms": None, "end_ms": None, "record": "NO"}
    cat.reset_state()
    lst = build(inputs([flw], obs=[g1, g2, other]))
    p = next(s for s in lst["floods"] if s["products"])
    assert p["products"][0]["gauge_lids"] == ["AGYM7"]                # the cached H-VTEC decides (never fetched here)


# ---- rule 3 ---------------------------------------------------------------------------------------------------------
def test_rule3_same_vtec_key_and_same_river_within_25_km() -> None:
    seg1 = cap("s1", "Flood Warning", vt("CON", "FL", "W", 217), box(-94.7, 39.69), desc=RIVER_DESC)
    seg2 = cap("s2", "Flood Warning", vt("CON", "FL", "W", 217), box(-94.4, 39.60), desc=RIVER_DESC)   # same key
    assert len(build(inputs([seg1, seg2]))["floods"]) == 1
    fresh()
    near = [riv("A1", -94.70, 39.69, "minor", "Platte River"), riv("A2", -94.50, 39.75, "minor", "Platte River")]
    assert len(build(inputs([], obs=near))["floods"]) == 1                      # ~18 km apart, same river
    fresh()
    far = [riv("A1", -94.70, 39.69, "minor", "Platte River"), riv("A3", -94.20, 39.95, "minor", "Platte River")]
    assert len(build(inputs([], obs=far))["floods"]) == 2                       # ~50 km apart
    fresh()
    other = [riv("A1", -94.70, 39.69, "minor", "Platte River"), riv("B1", -94.69, 39.70, "minor", "North Platte River")]
    assert len(build(inputs([], obs=other))["floods"]) == 2                     # different rivers, same place


def test_rule3_flash_overlap_time_and_river_never_by_distance() -> None:
    f1 = cap("f1", "Flash Flood Warning", vt("NEW", "FF", "W", 1, office="KPSR"), box(-112.0, 33.5, 0.1, 0.1),
             ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ", sent=NOW - H)
    f2 = cap("f2", "Flash Flood Warning", vt("NEW", "FF", "W", 2, office="KPSR"), box(-111.9, 33.5, 0.1, 0.1),
             ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ", sent=NOW - 2 * H)       # 50 % overlap
    assert len(build(inputs([f1, f2]))["floods"]) == 1
    fresh()
    f3 = cap("f3", "Flash Flood Warning", vt("NEW", "FF", "W", 3, office="KPSR"), box(-111.80, 33.5, 0.04, 0.04),
             ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ", sent=NOW - 20 * H)      # 5.6 km, but 19 h apart
    assert len(build(inputs([f1, f3]))["floods"]) == 2
    fresh()
    f4 = cap("f4", "Flash Flood Warning", vt("NEW", "FF", "W", 4, office="KPSR"), box(-111.80, 33.5, 0.04, 0.04),
             ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ", sent=NOW - 2 * H)       # 5.6 km away, 1 h apart
    assert len(build(inputs([f1, f4]))["floods"]) == 1
    fresh()
    river = cap("r", "Flood Warning", vt("CON", "FL", "W", 30, office="KPSR"), box(-112.0, 33.5, 0.1, 0.1),
                desc="* WHERE...Salt River near Phoenix.", ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ")
    assert len(build(inputs([f1, river]))["floods"]) == 2                       # river and flash: never by distance


# ---- rules 4-5 ------------------------------------------------------------------------------------------------------
def test_rule4_watches_never_bridge_and_use_same_counties() -> None:
    a = cap("a", "Flood Warning", vt("CON", "FL", "W", 217), box(-94.7, 39.69, 0.05, 0.05), desc=RIVER_DESC)
    b = cap("b", "Flood Warning", vt("CON", "FL", "W", 220), box(-93.6, 39.8, 0.05, 0.05),
            desc="* WHERE...Grand River near Chillicothe.", ugcs=("MOC117",), same=("029117",), area="Livingston, MO")
    # a zone-based watch (no polygon) over Buchanan (29021) and Livingston (29117) counties: attaches to both floods
    w = cap("w", "Flood Watch", vt("NEW", "FA", "A", 12), None, ugcs=("MOZ008", "MOZ012"), same=("029021", "029117"),
            area="Buchanan; Livingston", onset=NOW + 2 * H)
    lst = build(inputs([a, b, w]))                                    # the network is refused: no zone request (C9)
    assert len(lst["floods"]) == 2
    for s in lst["floods"]:
        assert "Flood Watch" in {p["event"] for p in s["products"]} and s["level"] == "warning"
    fresh()
    alone = cap("w2", "Flood Watch", vt("NEW", "FA", "A", 13), None, ugcs=("MOZ001", "MOZ002", "MOZ003"),
                same=("029005", "029087", "029147"), area="Atchison; Holt; Nodaway")
    s = build(inputs([alone]))["floods"]
    assert len(s) == 1 and s[0]["level"] == "watch" and s[0]["name"] == "Flood watch: Atchison and 2 more areas"
    assert s[0]["kind"] == "areal" and s[0]["bbox_lonlat"][0] < s[0]["bbox_lonlat"][2]   # placed by its counties


def test_rule5_gauge_only_and_action_never_starts_a_flood() -> None:
    lst = build(inputs([], obs=[riv("JSHF1", -82.0, 27.2, "minor", "Joshua Creek", state="FL"),
                                riv("ACTM7", -94.0, 39.0, "action", "Big Creek")]))
    assert [s["name"] for s in lst["floods"]] == ["Joshua Creek flood"]
    s = lst["floods"][0]
    assert s["level"] == "gauge_only" and s["caveat"] == fcopy.GAUGE_ONLY_CAVEAT and s["products"] == []


# ---- rule 6 ---------------------------------------------------------------------------------------------------------
def test_rule6_fields_primary_kind_level_category() -> None:
    flw = cap("a", "Flood Warning", vt("CON", "FL", "W", 217), box(-94.7, 39.69, 0.3, 0.1), desc=RIVER_DESC)
    fay = cap("y", "Flood Advisory", vt("NEW", "FL", "Y", 5), box(-94.6, 39.69, 0.05, 0.05), desc=RIVER_DESC)
    g1 = riv("AGYM7", -94.70, 39.69, "minor", "Platte River", value=19.0)
    g2 = riv("SSTM7", -94.60, 39.70, "moderate", "Platte River", value=23.0)
    rfc = [{"lid": "AGYM7", "max_status": "major", "max_value": 27.0, "max_ms": NOW + 30 * H, "issued_ms": NOW - 3 * H,
            "lat": 39.69, "lon": -94.70}]
    s = build(inputs([flw, fay], obs=[g1, g2], rfc=rfc))["floods"][0]
    assert s["primary_gauge"]["lid"] == "SSTM7"                       # highest observed category first
    assert s["max_category"] == "major" and s["gauges_in_flood"] == 2   # the forecast counts for max_category
    assert s["kind"] == "river" and s["level"] == "warning" and s["state"] == "MO" and s["time_zone"] == "America/Chicago"
    assert (s["lat"], s["lon"]) == (39.70, -94.60) and s["offices"] == ["KEAX"]
    g = next(x for x in s["gauges"] if x["lid"] == "AGYM7")
    assert g["forecast_category"] == "major" and g["forecast_issued_ms"] == NOW - 3 * H
    assert s["expires_ms"] == NOW + 20 * H and s["rivers"] == ["Platte River"]


# ---- rules 7-8 ------------------------------------------------------------------------------------------------------
def test_rule7_start_basis() -> None:
    new = cap("n", "Flood Warning", vt("NEW", "FL", "W", 300, begin="261104T0600Z"), box(-94.7, 39.69), desc=RIVER_DESC,
              sent=NOW - 10 * H)
    s = build(inputs([new]))["floods"][0]
    assert s["started_basis"] == "nws_product" and s["started_ms"] == nws._vtec_time("261104T0600Z")
    cat.reset_state()
    con = cap("c", "Flood Warning", vt("CON", "FL", "W", 301), box(-93.7, 39.69), desc="* WHERE...Grand River near Gallatin.",
              refs=[("old-1", NOW - 40 * H), ("old-2", NOW - 20 * H)])
    s = build(inputs([con]))["floods"][0]
    assert s["started_basis"] == "nws_product" and s["started_ms"] == NOW - 40 * H
    cat.reset_state()
    s = build(inputs([], obs=[riv("JSHF1", -82.0, 27.2, "minor", "Joshua Creek", state="FL")]))["floods"][0]
    assert s["started_basis"] == "first_seen" and s["started_ms"] == NOW


def test_rule7_gauge_crossing_only_from_a_cached_series(monkeypatch: pytest.MonkeyPatch) -> None:
    from fire3d import http as fhttp
    from fire3d.sources import nwps

    rows = [{"validTime": iso(NOW - k * H), "primary": v, "secondary": 1} for k, v in ((30, 15.0), (20, 18.5), (10, 19.0), (0, 20.0))]
    body = {"observed": {"data": rows, "primaryUnits": "ft"}, "forecast": {"data": []}}
    resp = fhttp.Response(200, nwps.stageflow_url("JSHF1"), __import__("orjson").dumps(body), "application/json", True, NOW)
    monkeypatch.setattr(fhttp, "peek_cache", lambda m, u, p=None, t=None: resp if u == nwps.stageflow_url("JSHF1") else None)
    s = build(inputs([], obs=[riv("JSHF1", -82.0, 27.2, "minor", "Joshua Creek", state="FL", minor=18.0)]))["floods"][0]
    assert s["started_basis"] == "gauge" and s["started_ms"] == NOW - 20 * H


def test_rule8_active_inactive_edges() -> None:
    fresh = riv("JSHF1", -82.0, 27.2, "minor", "Joshua Creek", state="FL", valid=NOW - int(5.9 * H))
    stale = riv("NOCF1", -81.0, 26.2, "minor", "Peace Creek", state="FL", valid=NOW - int(6.1 * H))
    by = {s["name"]: s for s in build(inputs([], obs=[fresh, stale]))["floods"]}
    assert by["Joshua Creek flood"]["status"] == "active" and by["Joshua Creek flood"]["ended_ms"] is None
    assert by["Peace Creek flood"]["status"] == "inactive" and by["Peace Creek flood"]["ended_ms"] == NOW - int(6.1 * H)


def test_rule8_left_the_list_stays_48_h_then_drops() -> None:
    g = riv("JSHF1", -82.0, 27.2, "minor", "Joshua Creek", state="FL")
    first = build(inputs([], obs=[g]))["floods"][0]
    cat.reset_state()
    later = build(inputs([], obs=[]), now=NOW + 47 * H)["floods"]      # the gauge fell below action
    assert [s["id"] for s in later] == [first["id"]] and later[0]["status"] == "inactive"
    cat.reset_state()
    assert build(inputs([], obs=[]), now=NOW + 49 * H)["floods"] == []
    reg = reg_mod.get_registry()
    assert all(k in reg.retired for k in reg.keys_of(first["id"]) if reg_mod.is_gauge_key(k))


# ---- rule 9 ---------------------------------------------------------------------------------------------------------
def test_rule9_names() -> None:
    flash = cap("f", "Flash Flood Warning", vt("NEW", "FF", "W", 7, office="KPSR"), box(-112.0, 33.5, 0.05, 0.05),
                ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ",
                desc="Some locations that will experience flash flooding include...\nCave Creek, Carefree and New River.")
    areal = cap("ar", "Flood Warning", vt("NEW", "FA", "W", 8, office="KPSR"), box(-110.0, 34.5, 0.05, 0.05),
                ugcs=("AZC017",), same=("004017",), area="Navajo, AZ", desc="Flooding along the Silver Creek continues.")
    by = {s["kind"]: s["name"] for s in build(inputs([flash, areal]))["floods"]}
    assert by == {"flash": "Cave Creek flash flood", "areal": "Silver Creek flood"}
    assert naming.river_from_text("...The Flood Warning continues for the following rivers...\n\nPlatte River near "
                                  "Agency affecting Buchanan County.\n\nGrand River near Sumner affecting Linn County.\n\n"
                                  "* WHERE...Grand River near Sumner.") == "Grand River"
    assert naming.clean_water("Georgetown (in NAVD88)") == "Georgetown" and naming.clean_water("Tide Station") is None
    rows = [{"name": "Animas River flood", "state": "CO"}, {"name": "Animas River flood", "state": "NM"}]
    naming.dedupe_names(rows)
    assert [r["name"] for r in rows] == ["Animas River flood (CO)", "Animas River flood (NM)"]
    for s in build(inputs([flash, areal]))["floods"]:
        assert "fire" not in s["name"].lower()


# ---- rule 10: ids -------------------------------------------------------------------------------------------------
def test_rule10_ids_stable_merge_split_and_gauge_episodes() -> None:
    g1 = riv("A1", -94.70, 39.69, "minor", "Platte River")
    g2 = riv("A3", -94.20, 39.95, "minor", "Platte River")             # 50 km away: a second flood
    one = build(inputs([], obs=[g1, g2]))["floods"]
    ids = {s["primary_gauge"]["lid"]: s["id"] for s in one}
    assert all(naming.is_flood_id(i) for i in ids.values()) and len(set(ids.values())) == 2
    cat.reset_state()
    again = build(inputs([], obs=[g1, g2]), now=NOW + H)["floods"]
    assert {s["primary_gauge"]["lid"]: s["id"] for s in again} == ids            # stable
    # a merge: a warning links both gauges -> one flood keeps the older id, the other id becomes an alias
    cat.reset_state()
    flw = cap("m", "Flood Warning", vt("CON", "FL", "W", 400), box(-94.45, 39.82, 0.4, 0.2), desc=RIVER_DESC)
    iem = [{"nwsli": l, "office": "KEAX", "phenomena": "FL", "significance": "W", "etn": 400, "key4": ("KEAX", "FL", "W", 400)}
           for l in ("A1", "A3")]
    merged = build(inputs([flw], obs=[g1, g2], iem=iem), now=NOW + 2 * H)["floods"]
    assert len(merged) == 1 and merged[0]["id"] in ids.values()
    other = (set(ids.values()) - {merged[0]["id"]}).pop()
    assert merged[0]["aliases"] == [other]
    assert reg_mod.get_registry().canonical(other) == merged[0]["id"]
    # a split: the part holding the id's anchor keeps it
    cat.reset_state()
    split = build(inputs([], obs=[g1, g2]), now=NOW + 3 * H)["floods"]
    keep = merged[0]["id"]
    assert keep in {s["id"] for s in split} and len({s["id"] for s in split}) == 2
    anchor_of = {s["id"]: s["primary_gauge"]["lid"] for s in split}
    assert naming.h6(anchor_of[keep]) == keep[-6:]


def test_rule10_one_gauge_flooding_twice_gets_two_ids() -> None:
    g = riv("JSHF1", -82.0, 27.2, "minor", "Joshua Creek", state="FL")
    first = build(inputs([], obs=[g]))["floods"][0]["id"]
    cat.reset_state()
    assert build(inputs([], obs=[]), now=NOW + 3 * 24 * H)["floods"] == []       # quiet for 3 days
    cat.reset_state()
    later = NOW + 30 * 24 * H
    g2 = {**g, "valid_ms": later - 900_000}
    second = build(inputs([], obs=[g2]), now=later)["floods"][0]["id"]
    assert second != first and naming.is_flood_id(second)
    # within GAUGE_ACTIVE_H the same episode (and id) continues
    cat.reset_state()
    third = build(inputs([], obs=[{**g2, "valid_ms": later + 2 * H}]), now=later + 3 * H)["floods"][0]["id"]
    assert third == second


# ---- rules 11-12 ----------------------------------------------------------------------------------------------------
def test_rule11_sources_and_outages(flood_fixture_data: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    flw = cap("a", "Flood Warning", vt("CON", "FL", "W", 217), box(-94.7, 39.69), desc=RIVER_DESC)
    g = riv("JSHF1", -82.0, 27.2, "minor", "Joshua Creek", state="FL")
    nws_down = build(inputs([flw], obs=[g], nws_down=True))
    assert names(nws_down) == ["Joshua Creek flood"] and nws_down["products_in_effect"] is None
    src = {s["id"]: s for s in nws_down["sources"]}
    assert src["nws_alerts"]["status"] == "unavailable" and src["nws_alerts"]["reason"] == fcopy.FLOOD_NWS_DOWN
    fresh()
    g_down = build(inputs([flw], obs=[g], gauges_down=True))
    assert names(g_down) == ["Platte River flood"]
    assert {s["id"]: s for s in g_down["sources"]}["nwps_gauges"]["reason"] == fcopy.FLOOD_GAUGES_DOWN
    fresh()
    both = build(inputs([flw], obs=[g], nws_down=True, gauges_down=True))
    assert both["floods"] == [] and all(s["reason"] == fcopy.FLOOD_LISTS_DOWN for s in both["sources"][:2])


def test_rule12_order_by_rank() -> None:
    adv = cap("y", "Flood Advisory", vt("NEW", "FA", "Y", 5, office="KPSR"), box(-112.0, 33.5, 0.05, 0.05),
              ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ", desc="Flooding along the Salt River.")
    emer = cap("e", "Flash Flood Warning", vt("NEW", "FF", "W", 6, office="KPSR"), box(-110.0, 34.5, 0.05, 0.05),
               ugcs=("AZC017",), same=("004017",), area="Navajo, AZ", params={"flashFloodDamageThreat": ["CATASTROPHIC"]},
               desc="Some locations that will experience flash flooding include...\nWinslow.")
    lst = build(inputs([adv, emer], obs=[riv("JSHF1", -82.0, 27.2, "major", "Joshua Creek", state="FL")]))
    assert [s["level"] for s in lst["floods"]] == ["warning", "gauge_only", "advisory"]
    assert lst["floods"][0]["emergency"] and G.flood_rank(lst["floods"][0]) >= 1000


# ---- review fixes (docs/redesign/reports/review5-backend-flood-sources.json) ----------------------------------------
def test_rule8_a_product_nws_dropped_is_ended_never_in_effect() -> None:
    """BFS-R1: a flood whose products left NWS's active list (one cancelled early, one "until further notice" with no
    end time) stays listed as inactive with every product "ended", no expiry and no emergency; it keeps the level it
    last had, never a product "in_effect" beside a status that says none is."""
    until = cap("u", "Flood Warning", vt("NEW", "FA", "W", 38, office="KFGZ"), box(-110.2, 34.6, 0.1, 0.05),
                ugcs=("AZC017",), same=("004017",), area="Navajo, AZ", ends=None,
                desc="* WHERE...Rural areas of Navajo County.")
    until["properties"]["expires"] = None                             # "until further notice": no end time at all
    flash = cap("f", "Flash Flood Warning", vt("NEW", "FF", "W", 9, office="KPSR"), box(-112.0, 33.5, 0.05, 0.05),
                ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ", ends=NOW + 30 * H,
                params={"flashFloodDamageThreat": ["CATASTROPHIC"]},
                desc="Some locations that will experience flash flooding include...\nCave Creek.")
    first = {s["kind"]: s for s in build(inputs([until, flash]))["floods"]}
    assert first["areal"]["products"][0]["ends_ms"] is None and first["flash"]["emergency"] is True
    cat.reset_state()
    can = cap("f2", "Flash Flood Warning", vt("CAN", "FF", "W", 9, office="KPSR"), box(-112.0, 33.5, 0.05, 0.05),
              ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ", sent=NOW + 10 * 60_000, refs=[("f", NOW - 2 * H)])
    lst = build(inputs([can]), now=NOW + 20 * 60_000)                # the CAN version is not in effect; FA.W gone
    assert lst["products_in_effect"] == 0
    by = {s["id"]: s for s in lst["floods"]}
    for k in ("areal", "flash"):
        s = by[first[k]["id"]]
        assert s["status"] == "inactive" and s["expires_ms"] is None and s["emergency"] is False, k
        assert [p["phase"] for p in s["products"]] == ["ended"] and s["level"] == "warning", k
        assert G.flood_rank(s) < G.RANK_EMERGENCY and s["ended_ms"] is not None
    # the detail chain shows the same once the flood is off the list (rule 13)
    import time as _t

    cat._cache["live"] = (_t.monotonic(), {**lst, "floods": [], "_phases": {}})
    s, how = cat.resolve(first["flash"]["id"])
    assert how == "last_known" and s["status"] == "inactive" and [p["phase"] for p in s["products"]] == ["ended"]


def test_rule2_an_areal_warning_links_the_gauge_its_text_names() -> None:
    """BFS-R3: NWS Flagstaff's areal Flood Warning names the Little Colorado River ("* WHERE...The Little Colorado River
    from Winslow to Leupp", "Flooding of the Little Colorado River"); the Winslow gauge inside it is its member, so the
    event is one flood, never an areal flood beside a gauge-only one."""
    desc = ("* WHAT...Flooding caused by excessive rainfall continues.\n\n* WHERE...The Little Colorado River from "
            "Winslow to Leupp...\n\n* IMPACTS...Flooding of the Little Colorado River is occurring.")
    fa = cap("w", "Flood Warning", vt("CON", "FA", "W", 38, office="KFGZ"), box(-110.70, 35.03, 0.25, 0.1),
             ugcs=("AZC017",), same=("004017",), area="Coconino, AZ; Navajo, AZ", desc=desc)
    g = riv("LCWA3", -110.70, 35.03, "minor", "Little Colorado River", state="AZ")
    s = build(inputs([fa], obs=[g]))["floods"]
    assert len(s) == 1 and s[0]["name"] == "Little Colorado River flood" and s[0]["kind"] == "river"
    assert [x["lid"] for x in s[0]["gauges"]] == ["LCWA3"] and s[0]["products"][0]["gauge_lids"] == ["LCWA3"]
    assert s[0]["level"] == "warning" and s[0]["caveat"] is None
    assert naming.river_from_text(desc) == "Little Colorado River"
    assert naming.river_from_text("* WHERE...along the San Juan River from the Four Corners through Mexican Hat.") == \
        "San Juan River"
    assert naming.water_from_text("Flooding of the Little Colorado River is occurring.") == "Little Colorado River"
    assert naming.text_names_water("St. Johns River", "Minor flooding on the St Johns River near Astor.")
    multi = ("Platte River near Agency affecting Buchanan County.\n\nGrand River near Sumner affecting Linn County.\n\n"
             "* WHERE...Grand River near Sumner.")
    assert not naming.text_names_water("Platte River", multi) and naming.text_names_water("Grand River", multi)
    assert not naming.text_names_water("Tide Station", "Tide Station readings")      # names no river
    fresh()
    other = riv("CLCA3", -110.69, 35.02, "minor", "Clear Creek", state="AZ")       # water the text does not name
    assert len(build(inputs([fa], obs=[other]))["floods"]) == 2


def test_rule5_a_tide_gauge_caveat_never_claims_no_coastal_product() -> None:
    """BFS-R2: Fire-3d does not read NWS Coastal Flood or Lakeshore Flood products (D1), so a gauge-only flood at a
    gauge that may measure tidal or lake water says so, never "No NWS flood product names this gauge"."""
    pier = {**riv("JBPF1", -80.05, 26.88, "minor", "Juno Beach Park Pier (in MHHW)", state="FL"), "pedts": "HCIRP"}
    near = riv("LRPF1", -80.10, 26.94, "minor", "Loxahatchee River 500 ft downstream of US 1", state="FL")  # ~8 km
    inland = riv("NOCF1", -81.85, 27.20, "moderate", "Joshua Creek", state="FL")
    by = {s["primary_gauge"]["lid"]: s for s in build(inputs([], obs=[pier, near, inland]))["floods"]}
    assert by["JBPF1"]["caveat"] == by["LRPF1"]["caveat"] == fcopy.GAUGE_ONLY_COASTAL_CAVEAT
    assert by["NOCF1"]["caveat"] == fcopy.GAUGE_ONLY_CAVEAT
    assert G.is_tidal_row({"pedts": "HMIRG", "name": "Virginia Key", "waterbody": "Atlantic Ocean Tide Gauge"})
    assert G.is_tidal_row({"pedts": "HGIRG", "name": "Steele Point (in MHHW)", "waterbody": "St Lucie River"})
    assert G.is_tidal_row({"pedts": "HGIRG", "name": "Duluth", "waterbody": "Lake Superior"})
    assert not G.is_tidal_row({"pedts": "HGIRG", "name": "Beaver Bay", "waterbody": "Beaver River (MN)"})  # a town
    assert not G.is_tidal_row({"pedts": "HPIRP", "name": "Devils Lake", "waterbody": "Devils Lake"})


def test_rule11_nws_down_never_claims_an_absence_or_an_end(monkeypatch: pytest.MonkeyPatch) -> None:
    """BFS-R4: NWS unreachable and no earlier copy. Gauge-only rows say NWS could not be reached (never
    GAUGE_ONLY_CAVEAT); a river flood whose two far-apart gauges a warning joined stays one flood with its id; a
    product-only flood is not listed as quiet (cannot decide) and its detail answers its last-known summary, its
    product in effect until NWS's own end time; when NWS answers again every id is the same. Gauges down: a
    gauge-only flood is not listed as quiet either."""
    import time as _t

    flw = cap("a", "Flood Warning", vt("CON", "FL", "W", 400), box(-94.45, 39.82, 0.4, 0.2), desc=RIVER_DESC)
    iem = [{"nwsli": lid, "office": "KEAX", "phenomena": "FL", "significance": "W", "etn": 400,
            "key4": ("KEAX", "FL", "W", 400)} for lid in ("A1", "A3")]
    g1, g3 = riv("A1", -94.70, 39.69, "minor", "Platte River"), riv("A3", -94.20, 39.95, "minor", "Platte River")
    flash = cap("f", "Flash Flood Warning", vt("NEW", "FF", "W", 7, office="KPSR"), box(-112.0, 33.5, 0.05, 0.05),
                ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ",
                desc="Some locations that will experience flash flooding include...\nCave Creek.")
    lone = riv("JSHF1", -82.0, 27.2, "minor", "Joshua Creek", state="FL")
    before = build(inputs([flw, flash], obs=[g1, g3, lone], iem=iem))["floods"]
    ids = {s["name"]: s["id"] for s in before}
    assert set(ids) == {"Platte River flood", "Cave Creek flash flood", "Joshua Creek flood"}
    cat.reset_state()
    out = build(inputs([], obs=[g1, g3, lone], iem=iem, nws_down=True), now=NOW + H)
    by = {s["id"]: s for s in out["floods"]}
    assert set(by) == {ids["Platte River flood"], ids["Joshua Creek flood"]}
    for s in by.values():
        assert s["level"] == "gauge_only" and s["caveat"] == fcopy.ALERTS_UNAVAILABLE and s["status"] == "active"
    assert sorted(g["lid"] for g in by[ids["Platte River flood"]]["gauges"]) == ["A1", "A3"]
    monkeypatch.setattr(cat, "now_ms", lambda: NOW + H)
    cat._cache["live"] = (_t.monotonic(), {**out, "_decided": False})
    s, how = cat.resolve(ids["Cave Creek flash flood"])
    assert how == "last_known" and [p["phase"] for p in s["products"]] == ["in_effect"]   # until NOW + 20 h
    cat.reset_state()
    gd = build(inputs([flw, flash], iem=iem, gauges_down=True), now=NOW + 2 * H)
    listed = {s["id"] for s in gd["floods"]}
    assert ids["Joshua Creek flood"] not in listed
    assert {ids["Platte River flood"], ids["Cave Creek flash flood"]} <= listed
    cat.reset_state()
    after = build(inputs([flw, flash], obs=[g1, g3, lone], iem=iem), now=NOW + 3 * H)["floods"]
    assert {s["name"]: s["id"] for s in after} == ids and len(after) == 3


def test_rule10_a_restart_after_a_long_gap_keeps_gauge_ids() -> None:
    """BFS-R5: Fire-3d was off for 23 h (across a UTC date) while the gauge stayed in flood: the same id, no duplicate.
    A flood quiet for less than INACTIVE_LISTED_H that floods again keeps its id too; longer is a new flood (C8)."""
    g = riv("DCBN8", -98.9, 48.1, "major", "Devils Lake", state="ND", valid=NOW - 23 * H - 900_000)
    first = build(inputs([], obs=[g]), now=NOW - 23 * H)["floods"]
    assert first[0]["id"].startswith("flood-20261103-")
    cat.reset_state()
    again = build(inputs([], obs=[{**g, "valid_ms": NOW - 900_000}]))["floods"]
    assert [s["id"] for s in again] == [first[0]["id"]]
    cat.reset_state()
    quiet = build(inputs([], obs=[]), now=NOW + 10 * H)["floods"]                 # below action for a while
    assert [(s["id"], s["status"]) for s in quiet] == [(first[0]["id"], "inactive")]
    cat.reset_state()
    back = build(inputs([], obs=[{**g, "valid_ms": NOW + 30 * H}]), now=NOW + 30 * H)["floods"]
    assert [s["id"] for s in back] == [first[0]["id"]]


def test_rule3_an_update_never_splits_an_areal_join() -> None:
    """BFS-R7: two Flash Flood Warnings 5.6 km apart issued 1 h apart are one flood; a CON update of one sent 14 h
    after the other's message keeps them joined (the join compares issue times, not update times)."""
    kw = dict(ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ")
    a = cap("a", "Flash Flood Warning", vt("NEW", "FF", "W", 1, office="KPSR"), box(-112.0, 33.5, 0.1, 0.1),
            sent=NOW - 14 * H, ends=NOW + 10 * H, **kw)
    b = cap("b", "Flash Flood Warning", vt("NEW", "FF", "W", 4, office="KPSR"), box(-111.80, 33.5, 0.04, 0.04),
            sent=NOW - 13 * H, ends=NOW + 10 * H, **kw)
    first = build(inputs([a, b]), now=NOW - 12 * H)["floods"]
    assert len(first) == 1
    cat.reset_state()
    b2 = cap("b2", "Flash Flood Warning", vt("CON", "FF", "W", 4, office="KPSR"), box(-111.80, 33.5, 0.04, 0.04),
             sent=NOW, ends=NOW + 10 * H, refs=[("b", NOW - 13 * H)], **kw)
    later = build(inputs([a, b2]))["floods"]
    assert [s["id"] for s in later] == [first[0]["id"]]
    assert G.issued_ms(nws.normalize_flood_alert(b2)) == NOW - 13 * H
    assert G.issued_ms({"sent_ms": NOW, "_vtec_begin_ms": NOW - 5 * H}) == NOW - 5 * H     # no references: VTEC begin
    assert G.issued_ms({"sent_ms": NOW, "_vtec_begin_ms": NOW + 5 * H}) == NOW            # upcoming: its own time


def test_rule11_the_iem_join_is_a_credited_source() -> None:
    """BFS-R10: the IEM H-VTEC join that links gauges to warnings is credited in ``sources[]``; its outage says gauges
    may be unlinked and never shortens the list cache (IEM asks for few requests)."""
    g = riv("JSHF1", -82.0, 27.2, "minor", "Joshua Creek", state="FL")
    src = {s["id"]: s for s in build(inputs([], obs=[g]))["sources"]}
    assert src["iem_archive"]["name"] == fcopy.IEM_JOIN_NAME and src["iem_archive"]["status"] == "available"
    fresh()
    inp = inputs([], obs=[g])
    inp.iem = cat.SourceResult(None, None, error="down")
    lst = build(inp)
    iem = {s["id"]: s for s in lst["sources"]}["iem_archive"]
    assert iem["status"] == "unavailable" and iem["reason"] == fcopy.IEM_JOIN_DOWN and not cat._degraded(lst)


def test_rule10_an_old_reading_never_churns_episodes() -> None:
    """BFS-R5 follow-up: a gauge whose last reading at flood stage is already 3 days old when Fire-3d first lists it
    (an inactive gauge-only flood) keeps one episode and one id over many builds and across a UTC date, instead of a
    new episode at every build."""
    g = riv("SDDC1", -121.6, 36.6, "minor", "Salinas River", state="CA", valid=NOW - 72 * H)
    first = build(inputs([], obs=[g]))["floods"]
    assert [s["status"] for s in first] == ["inactive"]
    for k in range(1, 4):                                            # every 5 min, then the next UTC day
        cat.reset_state()
        again = build(inputs([], obs=[g]), now=NOW + k * 300_000)["floods"]
        assert [s["id"] for s in again] == [first[0]["id"]]
    cat.reset_state()
    nextday = build(inputs([], obs=[g]), now=NOW + 10 * H)["floods"]
    assert [s["id"] for s in nextday] == [first[0]["id"]]
    eps = [k for k in reg_mod.get_registry().keys if k.startswith("SDDC1@")]
    assert len(eps) == 1


def test_rule8_a_carry_over_stays_ended_through_a_later_outage(monkeypatch: pytest.MonkeyPatch) -> None:
    """BFS-R1 follow-up: once NWS answered without a flood's product (carried over, its product "ended"), a later NWS
    outage never shows that product as in effect again, in the list's detail chain or its last-known summary; the
    48 h listing window still counts from when Fire-3d last saw the flood in the lists."""
    import time as _t

    flash = cap("f", "Flash Flood Warning", vt("NEW", "FF", "W", 9, office="KPSR"), box(-112.0, 33.5, 0.05, 0.05),
                ugcs=("AZC013",), same=("004013",), area="Maricopa, AZ", ends=NOW + 30 * H,
                desc="Some locations that will experience flash flooding include...\nCave Creek.")
    fid = build(inputs([flash]))["floods"][0]["id"]
    cat.reset_state()
    gone = build(inputs([]), now=NOW + H)                            # NWS answered without it (cancelled early)
    s = next(x for x in gone["floods"] if x["id"] == fid)
    assert s["status"] == "inactive" and [p["phase"] for p in s["products"]] == ["ended"]
    lk, seen = reg_mod.read_last_known(fid)
    assert [p["phase"] for p in lk["products"]] == ["ended"] and abs(seen - NOW) < 2_000
    cat.reset_state()
    out = build(inputs([], nws_down=True), now=NOW + 2 * H)          # then NWS cannot be read
    assert fid not in {x["id"] for x in out["floods"]}               # cannot decide: not listed as quiet
    monkeypatch.setattr(cat, "now_ms", lambda: NOW + 2 * H)
    cat._cache["live"] = (_t.monotonic(), {**out, "_decided": False})
    d, how = cat.resolve(fid)
    assert how == "last_known" and d["status"] == "inactive" and [p["phase"] for p in d["products"]] == ["ended"]
    cat.reset_state()
    late = build(inputs([]), now=NOW + 49 * H)                       # 48 h after it was last seen in the lists
    assert fid not in {x["id"] for x in late["floods"]}


def test_rule10_a_replaced_areal_warning_continues_its_flood() -> None:
    """Seen on the real list of 2026-11-04 (fix step of review5-backend-flood-sources): NWS Pueblo replaced its Conejos
    River Flood Warning KPUB.FA.W.0026 with a new one, KPUB.FA.W.0028, over the same river. The new product continues
    the flood (same id, its start kept, listed once), never a second "Conejos River flood" beside an inactive copy
    that would say no NWS product is in effect there. A new warning elsewhere, or one more than INACTIVE_LISTED_H
    after the old flood left the lists, is a new flood."""
    desc = "* WHAT...Flooding caused by snowmelt.\n\n* WHERE...Flooding along the Conejos River in Conejos County."
    kw = dict(ugcs=("COC021",), same=("008021",), area="Conejos, CO", desc=desc)
    old = cap("o", "Flood Warning", vt("NEW", "FA", "W", 26, office="KPUB"), box(-105.95, 37.25, 0.2, 0.2),
              sent=NOW - 44 * H, ends=NOW + 5 * H, **kw)
    first = build(inputs([old]))["floods"]
    assert [s["name"] for s in first] == ["Conejos River flood"]
    fid, started = first[0]["id"], first[0]["started_ms"]
    cat.reset_state()
    new = cap("n", "Flood Warning", vt("NEW", "FA", "W", 28, office="KPUB"), box(-105.85, 37.28, 0.15, 0.2),
              sent=NOW + H, ends=NOW + 26 * H, **kw)
    later = build(inputs([new]), now=NOW + H)["floods"]
    assert [(s["id"], s["name"], s["status"]) for s in later] == [(fid, "Conejos River flood", "active")]
    assert [p["vtec_key"] for p in later[0]["products"]] == ["KPUB.FA.W.0028.2026"]
    assert later[0]["started_ms"] == started and later[0]["aliases"] == []
    cat.reset_state()
    again = build(inputs([new]), now=NOW + 2 * H)["floods"]                # the new key is now registered to the id
    assert [s["id"] for s in again] == [fid]
    # a new warning far away is its own flood; the old flood, once quiet, is not continued by it
    fresh()
    first = build(inputs([old]))["floods"]
    cat.reset_state()
    far = cap("f", "Flood Warning", vt("NEW", "FA", "W", 29, office="KPUB"), box(-104.0, 38.5, 0.1, 0.1),
              sent=NOW + H, **{**kw, "desc": "* WHERE...Flooding along the Huerfano River."})
    got = {s["id"]: s for s in build(inputs([far]), now=NOW + H)["floods"]}
    assert len(got) == 2 and got[first[0]["id"]]["status"] == "inactive"
    # more than 48 h after the old flood left the lists: a new flood
    fresh()
    first = build(inputs([old]))["floods"]
    cat.reset_state()
    new2 = cap("n2", "Flood Warning", vt("NEW", "FA", "W", 30, office="KPUB"), box(-105.85, 37.28, 0.15, 0.2),
               sent=NOW + 50 * H, ends=NOW + 70 * H, **kw)
    late = build(inputs([new2]), now=NOW + 50 * H)["floods"]
    assert first[0]["id"] not in {s["id"] for s in late} and len(late) == 1


def test_rule8_a_left_gauge_flood_never_keeps_a_false_caveat() -> None:
    """Seen on the real list (fix step): "Fisher Island flood" at the Atlantic Ocean tide gauge, saved by an earlier
    Fire-3d with the plain gauge-only caveat, was carried over with it. A flood that left the lists gets its caveat
    decided again: the tide-gauge one for a tide gauge, ALERTS_UNAVAILABLE while NWS cannot be read."""
    ref = {"lid": "VAKF1", "name": "Virginia Key (Atlantic Ocean Tide Gauge)", "waterbody": "Atlantic Ocean Tide Gauge",
           "observed_category": "minor", "observed_ms": NOW - 3 * H}
    s = {"id": "flood-20261104-fisher-island-flood-fl-c23148", "level": "gauge_only", "status": "active",
         "products": [], "gauges": [ref], "caveat": fcopy.GAUGE_ONLY_CAVEAT, "ended_ms": None}
    assert cat.as_left(s, NOW, NOW + H, nws_ok=True, gauges_ok=True)["caveat"] == fcopy.GAUGE_ONLY_COASTAL_CAVEAT
    assert cat.as_left(s, NOW, NOW + H, nws_ok=False, gauges_ok=True)["caveat"] == fcopy.ALERTS_UNAVAILABLE
    inland = {**s, "gauges": [{**ref, "name": "Nocatee (Joshua Creek)", "waterbody": "Joshua Creek"}],
              "caveat": fcopy.ALERTS_UNAVAILABLE}
    assert cat.as_left(inland, NOW, NOW + H, nws_ok=True, gauges_ok=True)["caveat"] == fcopy.GAUGE_ONLY_CAVEAT


# ---- integration (2026-11-05): checked against the real list ----------------------------------------------------
def test_integration_areal_warnings_on_one_named_river_join_within_25_km() -> None:
    """NWS Grand Junction's and NWS Salt Lake City's areal Flood Warnings "along the San Juan River", 3 km apart and
    issued 17 h apart, were two "San Juan River flood (UT)" entries: the water an areal product names joins river
    members of that river within 25 km (rule 3), like a river product's WHERE line. Different waters stay apart."""
    kw = {"ugcs": ("UTC037",), "same": ("049037",), "area": "San Juan, UT"}
    gjt = cap("gjt", "Flood Warning", vt("NEW", "FA", "W", 30, office="KGJT"), box(-109.5, 37.15, 0.3, 0.1),
              desc="Flooding along the San Juan River continues.", sent=NOW - 20 * H, **kw)
    slc = cap("slc", "Flood Warning", vt("NEW", "FA", "W", 17, office="KSLC"), box(-110.17, 37.2, 0.3, 0.1),
              desc="* WHAT...Flooding along the San Juan River.", sent=NOW - 2 * H, **kw)
    lst = build(inputs([gjt, slc]))
    assert names(lst) == ["San Juan River flood"] and lst["floods"][0]["kind"] == "areal"
    fresh()
    verde = cap("v", "Flood Warning", vt("NEW", "FA", "W", 40, office="KPSR"), box(-109.5, 37.15, 0.3, 0.1),
                desc="Flooding along the Verde River continues.", sent=NOW - 20 * H, **kw)
    assert len(build(inputs([verde, slc]))["floods"]) == 2                   # another river: no join by distance


def test_integration_a_gauge_only_flood_lists_the_products_over_its_gauge() -> None:
    """Copperhill's gauge (Toccoa / Ocoee River) read major under NWS Morristown's Flash Flood Warning, which names no
    gauge: the gauge-only flood said "No NWS flood product here right now" while the warning covered it. Such a flood
    now lists the products over its gauge (attached like a watch: never a join, never its own key), so its views name
    the warning; its id and name stay the gauge's, and the flash flood stays its own flood."""
    ff = cap("ff", "Flash Flood Warning", vt("EXT", "FF", "W", 82, office="KMRX"), box(-84.38, 35.0, 0.08, 0.06),
             desc="Some locations that will experience flash flooding include...\nDucktown, Copperhill and Culberson.",
             ugcs=("TNC139",), same=("047139",), area="Polk, TN")
    g = riv("CPHT1", -84.3767, 34.9914, "major", "Toccoa River (GA) / Ocoee River (TN)", state="TN")
    lst = build(inputs([ff], obs=[g]))
    by = {s["name"]: s for s in lst["floods"]}
    assert set(by) == {"Ducktown flash flood", "Toccoa River / Ocoee River flood"}
    gauge = by["Toccoa River / Ocoee River flood"]
    assert gauge["kind"] == "river" and gauge["level"] == "warning" and gauge["caveat"] is None
    assert [p["event"] for p in gauge["products"]] == ["Flash Flood Warning"]
    assert gauge["primary_gauge"]["lid"] == "CPHT1" and (gauge["lat"], gauge["lon"]) == (34.9914, -84.3767)
    assert by["Ducktown flash flood"]["kind"] == "flash" and by["Ducktown flash flood"]["gauges"] == []
    reg = reg_mod.get_registry()
    assert not any(k.startswith("KMRX.FF") for k in reg.keys_of(gauge["id"]))   # the product is not the gauge flood's
    # outside the product's area: a gauge-only flood as before (D2)
    fresh()
    far = riv("CPHT1", -84.0, 34.6, "major", "Toccoa River (GA) / Ocoee River (TN)", state="GA")
    s = {x["name"]: x for x in build(inputs([ff], obs=[far]))["floods"]}["Toccoa River / Ocoee River flood"]
    assert s["level"] == "gauge_only" and s["products"] == [] and s["caveat"] == fcopy.GAUGE_ONLY_CAVEAT


def test_integration_a_gauge_in_flood_under_a_watch_is_never_hidden_as_watch_only() -> None:
    """U2 hides watch-only floods by default; a gauge at flood stage under an attached Flood Watch is not one: it
    stays gauge_only (ranked above watches) and lists the watch."""
    w = cap("w", "Flood Watch", vt("NEW", "FA", "A", 12), None, ugcs=("MOZ008",), same=("029021",), area="Buchanan",
            onset=NOW + 2 * H)
    g = riv("AGYM7", -94.70, 39.69, "minor", "Platte River")
    s = build(inputs([w], obs=[g]))["floods"]
    assert len(s) == 1 and s[0]["level"] == "gauge_only" and [p["event"] for p in s[0]["products"]] == ["Flood Watch"]


def test_integration_names_drop_state_and_position_notes_and_needless_suffixes() -> None:
    assert naming.clean_water("Toccoa River (GA) / Ocoee River (TN)") == "Toccoa River / Ocoee River"
    assert naming.clean_water("Loxahatchee River 500 ft downstream of US 1") == "Loxahatchee River"
    assert naming.clean_water("Dunns Creek State Park Boat Ramp (in MHHW)") == "Dunns Creek State Park Boat Ramp"
    # two "Salt River flood"s: the second takes its place name; the first no longer needs its state
    rows = [{"name": "Salt River flood", "state": "AZ", "_base_name": "Salt River flood"},
            {"name": "Salt River flood", "state": "AZ", "_base_name": "Salt River flood", "_alt_name": "Rio Verde flood"}]
    naming.dedupe_names(rows)
    assert [r["name"] for r in rows] == ["Salt River flood", "Rio Verde flood"]
    rows = [{"name": "Key Largo flood", "state": "FL", "_first_sent": 1}, {"name": "Key Largo flood", "state": "FL", "_first_sent": 2}]
    naming.dedupe_names(rows)
    assert [r["name"] for r in rows] == ["Key Largo flood (FL)", "Key Largo flood (FL, 2)"]
