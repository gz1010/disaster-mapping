"""Brief 6 M1: a flood's time history (``fire3d/floods/timeline.py``, ``GET /api/floods/{id}/timeline``, the pass PNG
route and the bundle's ``timeline.json``). Offline: Earthdata GIS and the IEM archive are mocked from recorded samples
(``tests/data/floods/opera``, ``tests/data/floods/iem``); a synthetic export answers every pass read."""

from __future__ import annotations

import json
import re

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import fire3d.http as fhttp
from fire3d import config
from fire3d.contracts import FloodManifest, FloodTimelineResponse, contract_problems, validate_strict
from fire3d.floods import build, copy_time as tcopy, store, timeline
from fire3d.floods import copy as fcopy
from fire3d.sources import opera

from conftest import FLOOD_SAMPLES, route_transport
from test_floods_build import _routes, _tiff_of, recorded_flood  # noqa: F401 - the fixture is used by name
from test_floods_copy import BANNED, guard

DAY = 86_400_000
OPERA = FLOOD_SAMPLES / "opera"
IEM = FLOOD_SAMPLES / "iem"


@pytest.fixture(autouse=True)
def _fresh_timeline():
    timeline.reset_state()
    opera.reset_state()
    yield
    timeline.reset_state()


# ---------------------------------------------------------------------------------------------------------------
# Wording
# ---------------------------------------------------------------------------------------------------------------
def test_every_timeline_and_terrain_string_passes_the_wording_guard():
    assert len(tcopy.ALL_STRINGS) >= 30
    for name, text in tcopy.ALL_STRINGS.items():
        assert guard(text) == [], (name, guard(text))
        assert "Fire-3d" not in text and "ago" not in text.split(), name
    assert guard(tcopy.PASS_NO_VIEW + " The area is safe.") == [BANNED[0]]        # a planted word is caught
    # the brief's exact labels
    assert tcopy.HAND_LABEL == "Height above the river (from terrain). Not a flood map"
    assert tcopy.DEPTH_LABEL == "Estimated depth (from the terrain at the water's edge), experimental"
    assert "Cohen" in tcopy.DEPTH_CAVEAT and "10.1111/1752-1688.12609" in tcopy.DEPTH_CITATION
    assert "10.5194/nhess-19-2053-2019" in tcopy.DEPTH_CITATION


# ---------------------------------------------------------------------------------------------------------------
# Window, passes, merging
# ---------------------------------------------------------------------------------------------------------------
def test_flood_window_live_past_and_cap():
    now = 1_793_900_000_000
    live = {"started_ms": now - 2 * DAY, "mode": "live"}
    assert timeline.flood_window(live, now) == (now - 12 * DAY, now)
    long = {"started_ms": now - 90 * DAY, "mode": "live"}
    assert timeline.flood_window(long, now) == (now - timeline.MAX_WINDOW_DAYS * DAY, now)
    past = {"started_ms": now - 200 * DAY, "last_product_ms": now - 190 * DAY, "mode": "historical"}
    assert timeline.flood_window(past, now) == (now - 210 * DAY, now - 187 * DAY)


def _granule(name: str, oid: int) -> opera.Granule:
    meta = opera.parse_name(name)
    return opera.Granule(name, meta["product"], meta["tile"], meta["acquired_ms"], meta["produced_ms"], meta["sensor"],
                         "earthdata_gis", oid=oid)


def test_tiles_of_one_overpass_sensed_a_minute_apart_are_one_pass():
    a = _granule("OPERA_L3_DSWx-HLS_T12SVF_20261029T175641Z_20261031T000000Z_L9_30_v1.1", 1)
    b = _granule("OPERA_L3_DSWx-HLS_T12SWF_20261029T175712Z_20261031T000000Z_L9_30_v1.1", 2)
    c = _granule("OPERA_L3_DSWx-HLS_T12SWF_20261029T180405Z_20261031T000000Z_S2C_30_v1.1", 3)
    d = _granule("OPERA_L3_DSWx-HLS_T12SWF_20261030T175712Z_20261031T000000Z_L9_30_v1.1", 4)
    grouped = opera.group_passes([a, b, c, d])
    assert len(grouped) == 4                                           # opera groups to the minute
    merged = timeline.merge_passes(grouped)
    assert [p.key for p in merged] == ["DSWx-HLS_20261030T1757_L9", "DSWx-HLS_20261029T1804_S2C",
                                       "DSWx-HLS_20261029T1756_L9"]
    assert sorted(merged[-1].oids) == [1, 2]                          # both tiles locked together


def _all_nodata_for(oids: set[int]):
    """The synthetic export, but no data everywhere for the passes locking ``oids`` (a pass with no view)."""
    def answer(req: httpx.Request) -> httpx.Response:
        locked = set(json.loads(req.url.params["mosaicRule"])["lockRasterIds"])
        if locked & oids:
            w, h = (int(v) for v in req.url.params["size"].split(","))
            import rasterio
            from rasterio.io import MemoryFile
            from rasterio.transform import from_bounds

            box = [float(v) for v in req.url.params["bbox"].split(",")]
            with MemoryFile() as mem:
                with mem.open(driver="GTiff", width=w, height=h, count=1, dtype="uint8",
                              crs=f"EPSG:{req.url.params['bboxSR']}", nodata=255, transform=from_bounds(*box, w, h)) as ds:
                    ds.write(np.full((h, w), 255, np.uint8), 1)
                return httpx.Response(200, content=mem.read())
        return _tiff_of(req)
    return answer


def _egis_routes(answer=None):
    return [("gis.earthdata.nasa.gov", r"/ImageServer/query$", OPERA / "egis_query.json"),
            ("gis.earthdata.nasa.gov", r"/ImageServer/exportImage$", answer or _tiff_of)]


def _recorded_passes():
    doc = json.loads((OPERA / "egis_query.json").read_text())
    grans = [g for g in (opera.parse_egis_row(f) for f in doc["features"]) if g]
    return timeline.merge_passes(opera.group_passes(grans))


def test_route_passes_read_once_mark_no_view_and_make_pngs(flood_iso, monkeypatch, no_backoff):
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", None)
    passes = _recorded_passes()
    newest = passes[0]
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", route_transport(_egis_routes(_all_nodata_for(set(newest.oids))), calls))
    now = newest.acquired_ms + 3 * DAY
    summary = {"id": "flood-20261101-test-river-flood-abcdef", "started_ms": newest.acquired_ms - 5 * DAY,
               "mode": "live", "time_zone": "America/Chicago"}
    bbox = (-95.3, 39.2, -94.6, 39.8)
    out = timeline.route_passes(summary, bbox, now=now, wait_s=60)
    assert out["status"] == "available" and out["complete"] and out["stats_over"] == "map_area"
    rows = out["passes"]
    assert rows and [r["acquired_ms"] for r in rows] == sorted(r["acquired_ms"] for r in rows)        # oldest first
    assert all(r["acquired_ms"] >= out["start_ms"] for r in rows)
    last = rows[-1]
    assert last["key"] == newest.key and last["view"] == "no_view" and not last["usable"] and last["image"] is None
    assert last["caveat"] == tcopy.PASS_NO_VIEW and last["clear_pct"] == 0.0
    good = [r for r in rows if r["usable"]]
    assert good and all(r["view"] in ("clear", "partly_hidden") and r["image"] for r in good)
    for r in good:
        assert r["image"]["url"].startswith(f"/api/floods/{summary['id']}/passes/{r['key']}.png?area=")
        assert r["caveat"].startswith("Water seen by satellite (NASA OPERA), ") and " ago" not in r["caveat"]
        assert 0 < r["clear_pct"] <= 100 and r["cloud_pct"] is not None and r["water_km2"] >= 0
    assert any(r["water_km2"] > 0 for r in good)
    assert out["shown_key"] in {r["key"] for r in good}                 # never the no-view pass by default
    assert tcopy.PASSES_NOTE in out["caveats"] and out["login_note"] == fcopy.SAT_NOT_SET_UP
    exports = [c for c in calls if c.url.path.endswith("/exportImage")]
    assert len(exports) == len(rows)                                    # one read per pass
    assert all('"esriMosaicLockRaster"' in c.url.params["mosaicRule"] for c in exports)
    # asked again: every read comes from the cache, no new request
    n = len(calls)
    again = timeline.route_passes(summary, bbox, now=now, wait_s=0)
    assert again["complete"] and not any(c.url.path.endswith("/exportImage") for c in calls[n:])
    # the PNG: hatched no-view grey, transparent outside, from disk
    area = good[0]["image"]["url"].rsplit("=", 1)[1]
    png = timeline.pass_png(summary["id"], good[0]["key"], area, bbox=bbox)
    img = np.asarray(Image.open(__import__("io").BytesIO(png)))
    assert img.shape[2] == 4 and (img[..., 3] == 0).any() and (img[..., 3] > 0).any()
    assert timeline.pass_png(summary["id"], good[0]["key"], "00000000", bbox=bbox) is None
    assert contract_problems(FloodTimelineResponse, timeline.timeline(summary, out, timeline._products_env(
        summary["id"], now), now=now)) == []


def test_route_passes_answer_unknown_when_reads_take_long(flood_iso, monkeypatch):
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", None)
    import threading

    gate = threading.Event()

    def slow(req):
        gate.wait(10)
        return _tiff_of(req)

    monkeypatch.setattr(fhttp, "_transport", route_transport(_egis_routes(slow)))
    p0 = _recorded_passes()[0]
    summary = {"id": "flood-20261101-slow-river-flood-abcdef", "started_ms": p0.acquired_ms - 5 * DAY, "mode": "live",
               "time_zone": "UTC"}
    out = timeline.route_passes(summary, (-95.3, 39.2, -94.6, 39.8), now=p0.acquired_ms + DAY, wait_s=0.05)
    assert not out["complete"] and {r["view"] for r in out["passes"]} == {"unknown"}
    assert all(r["caveat"] is None and r["image"] is None and not r["usable"] for r in out["passes"])
    assert tcopy.PASSES_PARTIAL in out["caveats"]
    gate.set()


def test_passes_unreachable_and_before_the_archive(flood_iso, monkeypatch):
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", None)

    def down(req):
        raise httpx.ConnectError("down", request=req)

    monkeypatch.setattr(fhttp, "_transport", route_transport([("gis.earthdata.nasa.gov", r".*", down)]))
    now = 1_793_900_000_000
    s = {"id": "flood-20261101-x-flood-abcdef", "started_ms": now - DAY, "mode": "live", "time_zone": "UTC"}
    out = timeline.route_passes(s, (-95.3, 39.2, -94.6, 39.8), now=now)
    assert out["status"] == "unavailable" and out["reason"] == tcopy.PASSES_UNAVAILABLE and out["passes"] == []
    old = {**s, "started_ms": 1_600_000_000_000, "last_product_ms": 1_600_100_000_000, "mode": "historical"}
    out = timeline.route_passes(old, (-95.3, 39.2, -94.6, 39.8), now=now)
    assert out["status"] == "not_available_for_past_dates" and out["reason_code"] == "before_archive"


def test_polite_read_waits_while_the_limit_is_nearly_used(monkeypatch):
    p = _recorded_passes()[0]
    slept: list[float] = []
    left = iter([2, 3, 30])
    monkeypatch.setattr(opera.EGIS_LIMITER, "remaining", lambda: next(left))
    monkeypatch.setattr(timeline, "_cached_export", lambda *a: False)
    monkeypatch.setattr(timeline.satellite, "_read", lambda *a: np.zeros((2, 2), np.uint8))
    out = timeline.polite_read(p, (0, 0, 1, 1), 4326, 2, 2, sleep=slept.append)
    assert out.shape == (2, 2) and len(slept) == 2                       # waited twice, never failed


# ---------------------------------------------------------------------------------------------------------------
# NWS product versions
# ---------------------------------------------------------------------------------------------------------------
def _alert(id_: str, action: str, sent: int, ends: int | None, *, etn: int = 7, archived: bool = True) -> dict:
    return {"id": id_, "vtec": {"office": "KABC", "phenomena": "FL", "significance": "W", "etn": etn, "action": action,
                                "year": 2026}, "sent_ms": sent, "onset_ms": sent, "ends_ms": ends, "phase": "in_effect",
            "archived": archived}


def test_versions_are_shown_from_issue_until_their_end_or_the_next_version():
    h = 3_600_000
    t0 = 1_793_000_000_000
    items = [_alert("a", "NEW", t0, t0 + 24 * h), _alert("b", "EXT", t0 + 6 * h, t0 + 48 * h),
             _alert("c", "CON", t0 + 12 * h, None), _alert("d", "CAN", t0 + 20 * h, t0 + 48 * h),
             _alert("x", "NEW", t0 + 2 * h, t0 + 4 * h, etn=9)]
    out = {a["id"]: a for a in timeline.with_timing(items, now=t0 + 30 * h)}
    assert [a["id"] for a in timeline.with_timing(items, now=t0)] == ["a", "x", "b", "c", "d"]   # oldest first
    assert out["a"]["replaced_ms"] == t0 + 6 * h and out["a"]["shown_until_ms"] == t0 + 6 * h
    assert out["b"]["shown_until_ms"] == t0 + 12 * h                     # replaced before its own end
    assert out["c"]["shown_until_ms"] == t0 + 20 * h                     # open end, closed by the next version
    assert out["d"]["shown_from_ms"] == out["d"]["shown_until_ms"] == t0 + 20 * h      # CAN ends at its issue
    assert out["x"]["shown_until_ms"] == t0 + 4 * h and out["x"]["replaced_ms"] is None
    assert all(a["phase"] == "ended" for a in out.values())
    assert out["a"]["vtec_key"] == "KABC.FL.W.0007.2026"
    live = timeline.with_timing(items[:3], now=t0 + 13 * h)
    assert {a["id"]: a["phase"] for a in live} == {"a": "ended", "b": "ended", "c": "in_effect"}


def test_a_live_copy_replaces_the_archived_copy_of_the_same_version():
    t = 1_793_000_000_000
    arch = [_alert("iem-1", "NEW", t, None), _alert("iem-2", "CON", t + 3_600_000, None)]
    live = [_alert("cap-2", "CON", t + 3_600_000 + 60_000, None, archived=False)]
    kept = timeline._dedupe(arch, live)
    assert [a["id"] for a in kept] == ["iem-1"]


def _iem_routes(down: bool = False):
    def event(req):
        if down:
            raise httpx.ConnectError("IEM down", request=req)
        p = req.url.params
        key = f"K{p['wfo']}_{p['phenomena']}_{p['significance']}_{int(p['etn']):04d}_{p['year']}"
        f = IEM / f"vtec_event_{key}.json"
        return httpx.Response(200, content=f.read_bytes()) if f.is_file() else httpx.Response(404, json={})

    return route_transport([("mesonet.agron.iastate.edu", r"/json/vtec_event\.py$", event),
                            ("mesonet.agron.iastate.edu", r"/geojson/vtec_event\.py$",
                             {"type": "FeatureCollection", "features": []})])


PAST = {"id": "flood-20250402-white-river-flood-aaaaaa", "mode": "historical", "status": "inactive",
        "started_ms": 1_743_600_000_000, "bbox_lonlat": [-87.6, 38.4, -86.8, 39.2], "states": ["IN"],
        "time_zone": "America/Indiana/Indianapolis",
        "products": [{"id": "x", "vtec_key": "KIND.FL.W.0030.2025"}, {"id": "y", "vtec_key": "KLMK.FF.W.0023.2025"}]}


def test_past_flood_history_has_every_archived_version(flood_iso, monkeypatch):
    monkeypatch.setattr(fhttp, "_transport", _iem_routes())
    now = 1_793_900_000_000
    out = timeline.product_history(PAST, now=now)
    assert out["status"] == "available" and out["complete"] and out["archive_source"]["credit"] == fcopy.CREDIT_IEM
    prods = out["products"]
    assert len(prods) >= 4 and all(p["archived"] and p["phase"] == "ended" for p in prods)
    keys = {p["vtec_key"] for p in prods}
    assert keys == {"KIND.FL.W.0030.2025", "KLMK.FF.W.0023.2025"}
    frei = [p for p in prods if p["vtec_key"] == "KIND.FL.W.0030.2025"]
    assert len(frei) > 2 and frei[0]["vtec"]["action"] == "NEW"
    for a, b in zip(frei, frei[1:]):                                   # each version replaced by the next one
        if b["shown_from_ms"] > a["shown_from_ms"]:
            assert a["replaced_ms"] == b["shown_from_ms"]
            assert a["shown_until_ms"] is not None and a["shown_until_ms"] <= b["shown_from_ms"]
    assert all(p["sender_name"] and p["url"] and p["url"].startswith("https://mesonet.agron.iastate.edu/") for p in prods)
    assert any(p["geometry"] for p in prods)
    assert tcopy.PRODUCTS_NOTE in out["caveats"]
    assert contract_problems(FloodTimelineResponse, timeline.timeline(
        PAST, {**timeline._passes_base(now, 0, now, "not_configured")}, out, now=now)) == []


def test_archive_down_is_an_outage_never_no_product(flood_iso, monkeypatch):
    monkeypatch.setattr(fhttp, "_transport", _iem_routes(down=True))
    out = timeline.product_history(PAST, now=1_793_900_000_000)
    assert out["status"] == "unavailable" and out["products"] == [] and tcopy.PRODUCTS_NONE not in out["caveats"]
    gauge_only = {**PAST, "products": []}
    out = timeline.product_history(gauge_only, now=1_793_900_000_000)
    assert out["status"] == "available" and tcopy.PRODUCTS_NONE in out["caveats"]


# ---------------------------------------------------------------------------------------------------------------
# Routes and the bundle
# ---------------------------------------------------------------------------------------------------------------
def test_fixture_flood_timeline_route_and_pass_png_guards(flood_fixture_data, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", flood_fixture_data)
    monkeypatch.setattr(config, "FLOODS_DIR", flood_fixture_data / "floods")
    from fire3d.api.app import app

    with TestClient(app) as client:
        r = client.get("/api/floods/fixture-flood/timeline")
        assert r.status_code == 200
        d = r.json()
        validate_strict(FloodTimelineResponse, d)
        assert d["synthetic"] and d["products"]["synthetic"] and len(d["passes"]["passes"]) == 1
        p = d["passes"]["passes"][0]
        assert p["layer"] == "water_satellite" and p["usable"] and tcopy.PASSES_SYNTHETIC in d["passes"]["caveats"]
        assert d["products"]["products"] and all("shown_from_ms" in a for a in d["products"]["products"])
        assert client.get("/api/floods/fixture-flood/passes/..x.png?area=abcdef12").status_code == 404
        assert client.get("/api/floods/fixture-flood/passes/k.png?area=nothex!!").status_code == 422
        assert client.get("/api/floods/fixture-flood/passes/k.png?area=abcdef12").status_code == 404


def test_bundle_keeps_the_timeline_and_pass_rasters(recorded_flood):  # noqa: F811 - pytest fixture
    summary, now, calls = recorded_flood
    m = build.build_flood(summary["id"], now=now)
    validate_strict(FloodManifest, m)
    bdir = store.flood_dir(summary["id"])
    assert m["files"]["timeline"] == "timeline.json"
    tl = json.loads((bdir / "timeline.json").read_text())
    validate_strict(FloodTimelineResponse, tl)
    ps = tl["passes"]
    assert ps["stats_over"] == "bundle_grid" and ps["passes"]
    kept = [p for p in ps["passes"] if p["layer"]]
    assert kept and len(kept) <= timeline.MAX_BUNDLE_PASSES
    for p in kept:
        assert re.fullmatch(r"water_pass_DSWx-HLS_\d{8}T\d{4}_[A-Z0-9]+", p["layer"]) and p["usable"]
        info = m["layers"][p["layer"]]
        arr = np.fromfile(bdir / info["file"], np.uint8)
        assert arr.size == 1024 * 1024 and set(np.unique(arr)) <= set(opera.CLASSES)
    assert ps["shown_key"] in {p["key"] for p in ps["passes"]}
    assert " ago" not in (bdir / "timeline.json").read_text()
    # the IEM archive is not mocked here: the products answer says so and keeps NWS's live copies
    pr = tl["products"]
    assert pr["status"] == "available" and pr["products"] and tcopy.PRODUCTS_ARCHIVE_DOWN in pr["caveats"]
    assert any("satellite passes" in d["detail"] for d in m["data_sources"])
