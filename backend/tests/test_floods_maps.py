"""NOAA water map services and FEMA NFHL sources for floods (brief 5, backend-flood-bundle-api M1; PLAN-5 3.3, D16,
C6, C19). Recorded answers (``tests/data/floods/{maps,nfhl}``, gauge AGYM7, 2026-11-05) replayed through the real
request code with a routing mock transport; no network."""

from __future__ import annotations

from pathlib import Path

import httpx
import orjson
import pytest

import fire3d.http as fhttp
from fire3d.sources import nfhl, water_maps as wm
from fire3d.sources.nws import SourceBusy, SourceError

from conftest import route_transport

MAPS = Path(__file__).parent / "data" / "floods" / "maps"
NFHL_DIR = Path(__file__).parent / "data" / "floods" / "nfhl"
BOX = (-94.80, 39.62, -94.60, 39.76)
NOAA = "maps.water.noaa.gov"
FEMA = "hazards.fema.gov"


@pytest.fixture
def maps_transport(monkeypatch, flood_iso):
    calls: list[httpx.Request] = []
    routes = [
        (NOAA, r"rfc_based_5day_max_inundation_extent/MapServer/0/query$", MAPS / "rfc_fim_polygons.json"),
        (NOAA, r"rfc_based_5day_max_inundation_extent/MapServer/3/query$", MAPS / "rfc_fim_reaches.json"),
        (NOAA, r"static_stage_based_catfim/MapServer/9/query$", MAPS / "catfim_AGYM7_moderate.json"),
        (NOAA, r"ana_inundation_extent/MapServer/0/query$", MAPS / "nwm_analysis.json"),
        (NOAA, r"mrf_gfs_5day_max_inundation_extent/MapServer/0/query$", MAPS / "nwm_5day.json"),
        (NOAA, r"ana_high_flow_magnitude/MapServer/0/query$", MAPS / "nwm_high_flow.json"),
        (NOAA, r"static_nwm_flowlines/MapServer/0/query$", MAPS / "flowlines.json"),
        (FEMA, r"NFHL/MapServer/28/query$", NFHL_DIR / "zones.json"),
        (FEMA, r"NFHL/MapServer/0/query$", NFHL_DIR / "availability.json"),
        (FEMA, r"NFHL/MapServer/3/query$", NFHL_DIR / "panels.json"),
    ]
    monkeypatch.setattr(fhttp, "_transport", route_transport(routes, calls))
    return calls


# ---------------------------------------------------------------------------------------------------------------
# NWS forecast flooded area (RFC FIM) and the member-reach join (C6)
# ---------------------------------------------------------------------------------------------------------------
def test_rfc_fim_polygons_and_times(maps_transport):
    lay = wm.rfc_fim(BOX)
    assert len(lay.features) == 45
    for f in lay.features:
        assert set(f["properties"]) == {"feature_id", "streamflow_cfs"}
        assert f["geometry"]["type"] in ("Polygon", "MultiPolygon")
        assert isinstance(f["properties"]["feature_id"], int)
    assert lay.reference_ms and lay.updated_ms and lay.updated_ms >= lay.reference_ms
    q = maps_transport[0].url.params
    assert q["maxAllowableOffset"] == "0.0002" and q["geometryPrecision"] == "5" and q["orderByFields"] == "oid"
    assert q["f"] == "geojson" and q["geometryType"] == "esriGeometryEnvelope"


def test_member_reaches_from_station_and_influential_forecasts(maps_transport):
    reaches, _ = wm.rfc_reaches(BOX)
    assert len(reaches) == 9
    member = wm.member_reaches(reaches, ["agym7"])
    # the gauge's own reach (nws_station_id AGYM7) and three reaches its forecast drives ("... at AGYM7 (...)")
    assert member == {"2529595", "2529323", "2529409", "2529609"}
    # RSDM7's reaches are not AGYM7's
    assert not member & wm.member_reaches(reaches, ["RSDM7"])


def test_member_area_only_from_member_reaches_never_a_bbox_crop(maps_transport):
    lay = wm.rfc_fim(BOX)
    reaches, _ = wm.rfc_reaches(BOX)
    member = wm.member_reaches(reaches, ["AGYM7"])
    area = wm.member_area_km2(lay.features, member)
    everything = wm.member_area_km2(lay.features, {str(f["properties"]["feature_id"]) for f in lay.features})
    assert area is not None and 0 < area < everything
    # the join fails -> None (never the box's polygons)
    assert wm.member_area_km2(lay.features, wm.member_reaches(reaches, ["ZZZZ9"])) is None
    assert wm.member_area_km2(lay.features, set()) is None


def test_parse_reach_reads_influential_forecast_lids():
    r = wm.parse_reach({"properties": {"feature_id": 1114367, "nws_station_id": "jybt2", "viz_status": "Action",
                                       "influential_forecasts": "Action (3.7 ft) issued 2026-11-04 19:50:00+00 at NSBT2 "
                                                                "(1114345 [order 6]) 4.0 miles upstream"}})
    assert (r.feature_id, r.station, r.forecast_lids) == ("1114367", "JYBT2", ["NSBT2"])
    assert wm.parse_reach({"properties": {"feature_id": None}}) is None


@pytest.mark.parametrize("raw, want", [
    ("2026-11-04 22:00:00", 1793829600000), ("2026-11-04 23:47:56 UTC", 1793836076000),
    ("2026-11-04 19:50:00+00", 1793821800000), (1303084800000, 1303084800000), (None, None), ("", None), ("x", None),
])
def test_esri_times_are_utc(raw, want):
    assert wm.esri_time_ms(raw) == want


# ---------------------------------------------------------------------------------------------------------------
# CatFIM, NWM (model output), river lines
# ---------------------------------------------------------------------------------------------------------------
def test_catfim_one_gauge_one_category(maps_transport):
    lay = wm.catfim("AGYM7", "moderate")
    assert lay.features and all(set(f["properties"]) == {"ahps_lid", "magnitude", "stage"} for f in lay.features)
    assert {f["properties"]["magnitude"] for f in lay.features} == {"moderate"}
    assert maps_transport[0].url.params["where"] == "ahps_lid='agym7'"
    with pytest.raises(ValueError):
        wm.catfim("AGYM7", "catastrophic")
    with pytest.raises(ValueError):
        wm.catfim("AGY' OR 1=1", "minor")


def test_nwm_layers_are_model_output_with_recur_cat_verbatim(maps_transport):
    hf = wm.nwm_layer("nwm_high_flow", BOX)
    cats = {f["properties"]["recur_cat"] for f in hf.features}
    assert cats <= {">50", "50", "20", "10", "4", "2"} and ">50" in cats      # an AEP in percent, as sent
    assert all(isinstance(f["properties"]["recur_cat"], str) for f in hf.features)
    ana = wm.nwm_layer("nwm_analysis", BOX)
    five = wm.nwm_layer("nwm_5day", BOX)
    assert ana.features and five.features and ana.reference_ms and five.reference_ms
    with pytest.raises(ValueError):
        wm.nwm_layer("nwm_srf", BOX)


def test_flowlines(maps_transport):
    lay = wm.flowlines(BOX, min_order=3)
    assert lay.features and all(f["properties"]["strm_order"] >= 3 for f in lay.features)
    assert maps_transport[0].url.params["where"] == "strm_order >= 3"


# ---------------------------------------------------------------------------------------------------------------
# ArcGIS errors, paging, outage memory
# ---------------------------------------------------------------------------------------------------------------
def test_arcgis_error_body_is_a_source_error_and_never_cached(monkeypatch, flood_iso):
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", route_transport(
        [(NOAA, r"/query$", {"error": {"code": 500, "message": "Error performing query operation"}})], calls))
    with pytest.raises(SourceError, match="returned an error"):
        wm.rfc_fim(BOX)
    with pytest.raises(SourceError):
        wm.rfc_fim(BOX)
    assert len(calls) == 2                      # not served from the cache


def test_paging_follows_exceeded_transfer_limit(monkeypatch, flood_iso):
    feat = {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
            "properties": {"feature_id": 1, "streamflow_cfs": 2.0}}

    def page(req: httpx.Request) -> httpx.Response:
        off = int(req.url.params["resultOffset"])
        body = {"type": "FeatureCollection", "features": [feat] * (2 if off == 0 else 1)}
        if off == 0:
            body["properties"] = {"exceededTransferLimit": True}
        return httpx.Response(200, json=body)

    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", route_transport([(NOAA, r"/query$", page)], calls))
    assert len(wm.rfc_fim(BOX).features) == 3
    assert [c.url.params["resultOffset"] for c in calls] == ["0", "2"]


def test_outage_memory_skips_a_dead_host(monkeypatch, flood_iso, no_backoff):
    calls: list[httpx.Request] = []

    def down(req):
        raise httpx.ConnectError("reset", request=req)

    monkeypatch.setattr(fhttp, "_transport", route_transport([(NOAA, r"/query$", down)], calls))
    with pytest.raises(SourceError, match="could not be reached"):
        wm.rfc_fim(BOX)
    n = len(calls)
    with pytest.raises(SourceError, match="less than a minute ago"):
        wm.nwm_layer("nwm_analysis", BOX)
    assert len(calls) == n


def test_busy_limiter(monkeypatch, flood_iso):
    monkeypatch.setattr(wm.NOAA_WATER_LIMITER, "try_acquire", lambda: False)
    with pytest.raises(SourceBusy):
        wm.rfc_fim(BOX)


# ---------------------------------------------------------------------------------------------------------------
# FEMA NFHL (D16, C19)
# ---------------------------------------------------------------------------------------------------------------
def test_nfhl_zones_only_sfha_floodway_and_band(maps_transport):
    feats, _ = nfhl.zones(BOX)
    assert len(feats) == 3 and {f["properties"]["code"] for f in feats} == {nfhl.CODE_SFHA}
    assert all(set(f["properties"]) == {"fld_zone", "zone_subty", "sfha", "static_bfe", "code"} for f in feats)
    assert all(f["properties"]["static_bfe"] is None for f in feats)               # -9999 -> null
    q = maps_transport[0].url.params
    assert q["where"] == "SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2%'"


@pytest.mark.parametrize("props, code", [
    ({"FLD_ZONE": "AE", "ZONE_SUBTY": "FLOODWAY", "SFHA_TF": "T"}, 3),
    ({"FLD_ZONE": "AE", "ZONE_SUBTY": None, "SFHA_TF": "T"}, 2),
    ({"FLD_ZONE": "X", "ZONE_SUBTY": "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", "SFHA_TF": "F"}, 1),
    ({"FLD_ZONE": "X", "ZONE_SUBTY": "AREA OF MINIMAL FLOOD HAZARD", "SFHA_TF": "F"}, 0),
    ({"FLD_ZONE": "X", "ZONE_SUBTY": "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE", "SFHA_TF": "F"}, 0),
])
def test_nfhl_zone_codes_never_keep_minimal_hazard(props, code):
    f = {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
         "properties": props}
    assert nfhl.zone_code(props) == code
    z = nfhl.parse_zone(f)
    assert (z is None) == (code == 0)
    if z is not None:
        assert "MINIMAL" not in orjson.dumps(z).decode().upper()


def test_nfhl_availability_effective_dates_and_result(maps_transport):
    # the recorded box is only partly inside FEMA's availability polygons -> unknown (never "mapped")
    assert nfhl.availability(BOX)[0] == "unknown"
    # a box inside one availability polygon -> mapped
    assert nfhl.availability((-94.55, 39.50, -94.30, 39.70))[0] == "mapped"
    lo, hi, _ = nfhl.effective_dates(BOX)
    assert (lo, hi) == (1069200000000, 1726099200000)
    res = nfhl.nfhl(BOX)
    assert res.availability == "unknown" and res.effective_min_ms == lo and res.effective_max_ms == hi
    served = res.collection()
    assert all("code" not in f["properties"] for f in served["features"])


def test_nfhl_no_availability_polygon_is_no_digital_map(monkeypatch, flood_iso):
    monkeypatch.setattr(fhttp, "_transport", route_transport([(FEMA, r"/0/query$", {"type": "FeatureCollection",
                                                                                      "features": []})]))
    assert nfhl.availability(BOX)[0] == "no_digital_map"


def test_nfhl_four_tries_then_answer(monkeypatch, flood_iso, no_backoff):
    n = {"zones": 0}
    body = (NFHL_DIR / "zones.json").read_bytes()

    def flaky(req):
        n["zones"] += 1
        if n["zones"] < 4:
            raise httpx.ConnectError("Connection reset by peer", request=req)
        return httpx.Response(200, content=body, headers={"content-type": "application/json"})

    monkeypatch.setattr(fhttp, "_transport", route_transport([(FEMA, r"/28/query$", flaky)]))
    feats, _ = nfhl.zones(BOX)
    assert len(feats) == 3 and n["zones"] == 4


def test_nfhl_down_raises_and_availability_failure_is_unknown(monkeypatch, flood_iso, no_backoff):
    def reset(req):
        raise httpx.ConnectError("Connection reset by peer", request=req)

    monkeypatch.setattr(fhttp, "_transport", route_transport([(FEMA, r"/query$", reset)]))
    with pytest.raises(SourceError):
        nfhl.nfhl(BOX)
    nfhl.reset_state()
    zones = (NFHL_DIR / "zones.json").read_bytes()
    monkeypatch.setattr(fhttp, "_transport", route_transport([(FEMA, r"/28/query$", zones), (FEMA, r"/query$", reset)]))
    res = nfhl.nfhl(BOX)
    assert res.features and res.availability == "unknown" and res.effective_min_ms is None and res.notes
