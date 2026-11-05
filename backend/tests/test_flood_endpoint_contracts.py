"""Every flood route of CONTRACT 16.7 answers contract-valid JSON (strict: no unknown field), isolated from the
developer's ``data/`` and cache (PLAN-5 section 8, C25; backend-flood-bundle-api M3).

Isolation: ``flood_iso`` (temp DATA_DIR / FLOODS_DIR / CACHE_DIR, registry and every in-memory cache and rate limiter
cleared before and after), ``fixture-flood`` copied from the session fixture generated into ``tmp_path`` at
2026-11-04T18:00Z, ``LIVE_ENABLED=False``, and a routing mock transport over the recorded samples for the real flood
(the Platte River flood of 2026-11-04, gauge AGYM7). The answers therefore do not depend on what is in ``data/`` or
the HTTP cache, or on whether ``data/floods/fixture-flood`` exists. Each official layer's outage answers its own
"could not be reached" reason and never an absence sentence (D24)."""

from __future__ import annotations

import shutil
import warnings
from pathlib import Path

import httpx
import numpy as np
import orjson
import pytest

import fire3d.http as fhttp
from fire3d import config
from fire3d import contracts as C
from fire3d.api import app as app_mod
from fire3d.api.jobs import JobManager, set_manager
from fire3d.floods import catalog
from fire3d.floods import copy as fcopy
from fire3d.sources import imagery, terrain
from fire3d.sources.terrain import FetchInfo, RasterFetchError

from conftest import recorded_flood_inputs, route_transport
from test_floods_build import _routes

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from fastapi.testclient import TestClient

COMMITTED = Path(__file__).parent / "data" / "floods" / "fixture_api"
NO_PRODUCT_LIKE = (fcopy.NO_PRODUCT, fcopy.GAUGE_ONLY_CAVEAT)


@pytest.fixture
def api(flood_iso: Path, flood_fixture_bundle: Path, monkeypatch: pytest.MonkeyPatch, no_backoff):
    assert str(config.FLOODS_DIR).startswith(str(flood_iso)) and str(config.CACHE_DIR).startswith(str(flood_iso))
    monkeypatch.setattr(config, "LIVE_ENABLED", False)
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", None)
    shutil.copytree(flood_fixture_bundle, Path(config.FLOODS_DIR) / "fixture-flood")
    inp, now = recorded_flood_inputs()
    monkeypatch.setattr(catalog, "fetch_inputs", lambda: inp)
    monkeypatch.setattr(catalog, "now_ms", lambda: now)
    monkeypatch.setattr(terrain, "fetch_dem_info", lambda grid: (np.full(grid.shape, 250.0, np.float32),
                                                                 FetchInfo("https://3dep.test", now, False, 0.1), 0))

    def no_naip(grid, max_px=2048):
        raise RasterFetchError("NAIP: no imagery")

    monkeypatch.setattr(imagery, "fetch_naip_info", no_naip)
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", route_transport(_routes(), calls))
    m = JobManager()
    set_manager(m)
    with TestClient(app_mod.app) as c:
        lst = catalog.flood_list()
        c.fid = next(s["id"] for s in lst["floods"] if (s["primary_gauge"] or {}).get("lid") == "AGYM7")  # type: ignore
        c.calls = calls  # type: ignore[attr-defined]
        yield c
    m.shutdown()
    set_manager(None)


def ok(r, model):
    assert r.status_code == 200, (r.status_code, r.text[:300])
    body = r.json()
    C.validate_strict(model, body)
    return body


# ---------------------------------------------------------------------------------------------------------------
# fixture-flood: every route from its bundle's frozen files (equal to the committed canned copy)
# ---------------------------------------------------------------------------------------------------------------
FIXTURE_ROUTES = [
    ("/api/floods/fixture-flood/maps?kind=rfc_fim", C.FloodMapResponse, "maps-rfc_fim.json"),
    ("/api/floods/fixture-flood/maps?kind=catfim", C.FloodMapResponse, "maps-catfim.json"),
    ("/api/floods/fixture-flood/maps?kind=catfim&lid=ZZRF1&category=major", C.FloodMapResponse, "maps-catfim-ZZRF1-major.json"),
    ("/api/floods/fixture-flood/maps?kind=nfhl", C.FloodMapResponse, "maps-nfhl.json"),
    ("/api/floods/fixture-flood/model?kind=nwm_analysis", C.ModelOutputResponse, "model-nwm_analysis.json"),
    ("/api/floods/fixture-flood/model?kind=nwm_5day", C.ModelOutputResponse, "model-nwm_5day.json"),
    ("/api/floods/fixture-flood/model?kind=nwm_high_flow", C.ModelOutputResponse, "model-nwm_high_flow.json"),
    ("/api/floods/fixture-flood/model?kind=nwm_series", C.ModelOutputResponse, "model-nwm_series-ZZRF1.json"),
    ("/api/floods/fixture-flood/model?kind=nwm_series&lid=ZZRF3", C.ModelOutputResponse, "model-nwm_series-ZZRF3.json"),
    ("/api/floods/fixture-flood/satellite", C.SatelliteWaterResponse, "satellite.json"),
    ("/api/official/flood-alerts?flood=fixture-flood", C.FloodAlertsResponse, "flood-alerts.json"),
    ("/api/official/river-gauges?flood=fixture-flood", C.RiverGaugesResponse, "river-gauges.json"),
    ("/api/official/river-gauges?lid=ZZRF1&series=1", C.RiverGaugesResponse, "river-gauges-ZZRF1.json"),
]


@pytest.mark.parametrize("path, model, canned", FIXTURE_ROUTES)
def test_fixture_routes_from_frozen_files(api, path, model, canned):
    body = ok(api.get(path), model)
    assert body == orjson.loads((COMMITTED / canned).read_bytes())
    assert body.get("synthetic") is True


def test_fixture_detail_series_png_and_build(api):
    d = ok(api.get("/api/floods/fixture-flood"), C.FloodDetailResponse)
    C.validate_strict(C.FloodManifest, d["manifest"])
    g = ok(api.get("/api/official/river-gauges?flood=fixture-flood&series=1"), C.RiverGaugesResponse)
    assert all(x.get("series") for x in g["gauges"] if x["member"])
    s = api.get("/api/floods/fixture-flood/satellite").json()
    png = api.get(s["image"]["url"])
    assert png.status_code == 200 and png.headers["content-type"] == "image/png" and png.content[:4] == b"\x89PNG"
    assert api.post("/api/floods/fixture-flood/build").status_code == 409
    for demo in ("fixture-flood-major", "fixture-flood-flash"):                  # fixture-server-only ids
        assert api.get(f"/api/floods/{demo}").status_code == 404
        assert api.get(f"/api/floods/{demo}/maps?kind=rfc_fim").status_code == 404
    assert api.get("/api/official/river-gauges?lid=ZZZZ9").status_code == 404


# ---------------------------------------------------------------------------------------------------------------
# A real flood (recorded, mocked upstream)
# ---------------------------------------------------------------------------------------------------------------
def test_real_flood_every_route(api):
    fid = api.fid
    ok(api.get(f"/api/floods/{fid}"), C.FloodDetailResponse)
    fim = ok(api.get(f"/api/floods/{fid}/maps?kind=rfc_fim"), C.FloodMapResponse)
    assert fim["status"] == "available" and fim["experimental"] and fim["min_zoom"] is None
    assert fim["stats"] and fim["stats"]["area_km2"] > 0 and fim["coverage_note"] == fcopy.RFC_FIM_NOTE
    assert fim["outside_note"] == fcopy.RFC_FIM_OUTSIDE and fim["reference_ms"] and fim["source"]["credit"] == fcopy.CREDIT_NWC_EXPERIMENTAL
    cat = ok(api.get(f"/api/floods/{fid}/maps?kind=catfim"), C.FloodMapResponse)
    assert cat["status"] == "available" and cat["category"] in ("minor", "moderate", "major") and cat["features"]["features"]
    nf = ok(api.get(f"/api/floods/{fid}/maps?kind=nfhl"), C.FloodMapResponse)
    assert nf["status"] == "available" and nf["availability"] in ("mapped", "no_digital_map", "unknown")
    assert nf["effective_min_ms"] and nf["effective_max_ms"] >= nf["effective_min_ms"] and nf["min_zoom"] is None
    assert "MINIMAL" not in api.get(f"/api/floods/{fid}/maps?kind=nfhl").text.upper()
    for kind in ("nwm_analysis", "nwm_5day", "nwm_high_flow"):
        mo = ok(api.get(f"/api/floods/{fid}/model?kind={kind}"), C.ModelOutputResponse)
        assert mo["model_output"] is True and mo["label"] == fcopy.MODEL_LABEL and mo["caveats"] == [fcopy.MODEL_CAVEAT]
        assert mo["status"] == "available" and mo["features"]["features"]
    hf = api.get(f"/api/floods/{fid}/model?kind=nwm_high_flow").json()
    assert {f["properties"]["recur_cat"] for f in hf["features"]["features"]} <= {">50", "50", "20", "10", "4", "2"}
    ser = ok(api.get(f"/api/floods/{fid}/model?kind=nwm_series&lid=AGYM7"), C.ModelOutputResponse)
    assert ser["status"] == "available" and ser["reach_id"] and ser["series"]
    sat = ok(api.get(f"/api/floods/{fid}/satellite"), C.SatelliteWaterResponse)
    assert sat["measured"] and sat["login"] == "not_configured" and sat["login_note"] == fcopy.SAT_NOT_SET_UP
    assert sat["caveats"] and "ago" not in sat["caveats"][0]
    png = api.get(sat["image"]["url"])
    assert png.status_code == 200 and png.content[:4] == b"\x89PNG"
    al = ok(api.get(f"/api/official/flood-alerts?flood={fid}"), C.FloodAlertsResponse)
    assert al["status"] == "available" and al["alerts"] and all(fid in a["flood_ids"] for a in al["alerts"])
    a0 = al["alerts"][0]
    assert a0["geometry"] and a0["time_zone"] == "America/Chicago" and a0["sender_name"] and a0["url"]
    from shapely.geometry import shape

    inside = shape(a0["geometry"]).representative_point()
    pt = ok(api.get(f"/api/official/flood-alerts?bbox={inside.x},{inside.y},{inside.x},{inside.y}"), C.FloodAlertsResponse)
    assert any(a["id"] == a0["id"] and a["covers_point"] is True for a in pt["alerts"])
    far = ok(api.get("/api/official/flood-alerts?bbox=-110.0,44.0,-110.0,44.0"), C.FloodAlertsResponse)
    assert far["status"] == "available" and far["alerts"] == []
    gz = ok(api.get(f"/api/official/river-gauges?flood={fid}"), C.RiverGaugesResponse)
    assert gz["gauges"][0]["lid"] == "AGYM7" and gz["gauges"][0]["member"] and "series" not in gz["gauges"][0]
    assert gz["caveats"][0] == fcopy.GAUGE_NOT_ALL_CLEAR
    one = ok(api.get("/api/official/river-gauges?lid=agym7&series=1"), C.RiverGaugesResponse)
    assert one["gauges"][0]["series"]["observed"] and one["gauges"][0]["forecast"]["issued_ms"]
    box = ok(api.get("/api/official/river-gauges?bbox=-99.30,47.80,-98.50,48.40"), C.RiverGaugesResponse)
    assert box["gauges"] and not any(g["member"] for g in box["gauges"])
    nat = ok(api.get("/api/official/river-gauges?scope=national&min=minor"), C.RiverGaugesResponse)
    assert all(g["observed"]["category"] in ("minor", "moderate", "major") for g in nat["gauges"])
    # never an NWPS list: every NWPS request names one gauge or one reach
    nwps = [c.url.path for c in api.calls if c.url.host == "api.water.noaa.gov"]
    assert nwps and all(p.startswith(("/nwps/v1/gauges/", "/nwps/v1/reaches/")) for p in nwps)
    assert not any(p.rstrip("/") == "/nwps/v1/gauges" for p in nwps)
    loc = api.get(f"/api/official/local-alerts?bbox=-94.80,39.62,-94.60,39.76&hazard=flood")
    assert loc.status_code == 200 and loc.json()["caveats"][0] == fcopy.LOCAL_FLOOD_CAVEAT
    ev = api.get("/api/extras/evacuations?bbox=-94.80,39.62,-94.60,39.76&hazard=flood").json()
    assert ev["status"] == "unavailable" and ev["reason_code"] == "state_not_available"


def test_queries_without_a_scope_are_422(api):
    assert api.get("/api/official/flood-alerts").status_code == 422
    assert api.get("/api/official/river-gauges").status_code == 422
    assert api.get("/api/official/flood-alerts?bbox=1,2,3").status_code == 422
    assert api.get(f"/api/floods/{api.fid}/maps?kind=roads").status_code == 422


def test_past_times(api):
    fid, past = api.fid, 1700000000000
    fim = ok(api.get(f"/api/floods/{fid}/maps?kind=rfc_fim&at_ms={past}"), C.FloodMapResponse)
    assert fim["status"] == "not_available_for_past_dates" and fim["reason"] == fcopy.RFC_FIM_PAST
    cat = ok(api.get(f"/api/floods/{fid}/maps?kind=catfim&at_ms={past}"), C.FloodMapResponse)
    assert fcopy.CATFIM_TODAY in cat["caveats"]
    mo = ok(api.get(f"/api/floods/{fid}/model?kind=nwm_analysis&at_ms={past}"), C.ModelOutputResponse)
    assert mo["status"] == "not_available_for_past_dates" and mo["model_output"] is True
    al = ok(api.get(f"/api/official/flood-alerts?flood={fid}&at_ms={past}"), C.FloodAlertsResponse)
    assert al["status"] == "not_available_for_past_dates" and al["alerts"] == []
    sat = ok(api.get(f"/api/floods/{fid}/satellite?at_ms={1600000000000}"), C.SatelliteWaterResponse)
    assert sat["reason_code"] == "before_archive" and sat["reason"] == fcopy.SAT_BEFORE_ARCHIVE


# ---------------------------------------------------------------------------------------------------------------
# Outages: each official layer says it could not be reached, never "none" (D24)
# ---------------------------------------------------------------------------------------------------------------
def _down(req):
    raise httpx.ConnectError("down", request=req)


@pytest.mark.parametrize("host, path_re, route, model, reason", [
    ("api.weather.gov", r"^/alerts/active$", "/api/official/flood-alerts?flood={fid}", C.FloodAlertsResponse,
     fcopy.ALERTS_UNAVAILABLE),
    ("api.weather.gov", r"^/alerts/active$", "/api/official/flood-alerts?bbox=-94.8,39.6,-94.6,39.8", C.FloodAlertsResponse,
     fcopy.ALERTS_UNAVAILABLE),
    ("maps.water.noaa.gov", r"rfc_based_5day", "/api/floods/{fid}/maps?kind=rfc_fim", C.FloodMapResponse,
     fcopy.RFC_FIM_UNAVAILABLE),
    ("maps.water.noaa.gov", r"catfim", "/api/floods/{fid}/maps?kind=catfim", C.FloodMapResponse,
     fcopy.CATFIM_UNAVAILABLE),
    ("hazards.fema.gov", r"/query$", "/api/floods/{fid}/maps?kind=nfhl", C.FloodMapResponse, fcopy.NFHL_DOWN),
    ("mapservices.weather.noaa.gov", r"riv_gauges", "/api/official/river-gauges?bbox=-94.8,39.6,-94.6,39.8",
     C.RiverGaugesResponse, fcopy.GAUGES_UNAVAILABLE),
    ("api.water.noaa.gov", r"/nwps/", "/api/official/river-gauges?lid=AGYM7", C.RiverGaugesResponse,
     fcopy.GAUGES_UNAVAILABLE),
])
def test_each_official_layer_down(api, monkeypatch, host, path_re, route, model, reason):
    if host == "api.weather.gov":                       # no earlier copy of the national answer either
        monkeypatch.setattr(catalog, "_stale_alerts", lambda: None)
    monkeypatch.setattr(fhttp, "_transport", route_transport([(host, path_re, _down)] + _routes()))
    body = ok(api.get(route.format(fid=api.fid)), model)
    assert body["status"] == "unavailable" and body["reason"] == reason and body["reason_code"] == "upstream_error"
    text = orjson.dumps(body).decode()
    assert fcopy.NO_PRODUCT not in text


def test_model_and_satellite_down(api, monkeypatch):
    monkeypatch.setattr(fhttp, "_transport", route_transport(
        [("maps.water.noaa.gov", r"/nwm/", _down), ("gis.earthdata.nasa.gov", r".", _down),
         ("gibs.earthdata.nasa.gov", r".", _down)] + _routes()))
    mo = ok(api.get(f"/api/floods/{api.fid}/model?kind=nwm_analysis"), C.ModelOutputResponse)
    assert mo["status"] == "unavailable" and mo["reason"] == fcopy.MODEL_DOWN and mo["model_output"] is True
    sat = ok(api.get(f"/api/floods/{api.fid}/satellite"), C.SatelliteWaterResponse)
    assert sat["status"] == "unavailable" and sat["reason"] == fcopy.SAT_UNAVAILABLE and not sat["measured"]


def test_satellite_picture_fallback_when_earthdata_gis_is_down(api, monkeypatch):
    monkeypatch.setattr(fhttp, "_transport", route_transport([("gis.earthdata.nasa.gov", r".", _down)] + _routes()))
    sat = ok(api.get(f"/api/floods/{api.fid}/satellite"), C.SatelliteWaterResponse)
    assert sat["status"] == "available" and sat["measured"] is False and sat["stats"] is None and sat["image"] is None
    assert sat["tiles"]["date"] == "2026-10-31" and sat["tiles"]["max_zoom"] == 12
    assert "via NASA GIBS" in sat["source"]["credit"]
