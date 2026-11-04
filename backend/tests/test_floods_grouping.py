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
