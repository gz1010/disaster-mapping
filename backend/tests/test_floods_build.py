"""The flood bundle builder (brief 5, backend-flood-bundle-api M2; PLAN-5 3.3, 3.7, D25, C2, C6, C16).

End to end offline: the recorded Platte River flood of 2026-11-04 (gauge AGYM7, ``recorded_flood_inputs``) is built
through the real request code with a routing mock transport over the recorded samples (NWS, NWPS, ``riv_gauges``,
NOAA water maps, FEMA, Earthdata GIS catalog, GIBS); the 3DEP elevation and the satellite exports are synthetic (their
answers are rasters of the requested size). No network, no gitignored ``data/``."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import numpy as np
import pytest
from PIL import Image

import fire3d.http as fhttp
from fire3d import config
from fire3d.contracts import FloodManifest, SatelliteWaterResponse, validate_strict
from fire3d.floods import build, catalog, maps, satellite, store
from fire3d.floods import copy as fcopy
from fire3d.sources import imagery, opera, terrain
from fire3d.sources.terrain import FetchInfo, RasterFetchError

from conftest import recorded_flood_inputs, route_transport

DATA = Path(__file__).parent / "data" / "floods"
NWS, NWPS, MAPS, NFHL, OPERA = (DATA / d for d in ("nws", "nwps", "maps", "nfhl", "opera"))


# ---------------------------------------------------------------------------------------------------------------
# Palette (D25: clouds and no data hatched, never transparent)
# ---------------------------------------------------------------------------------------------------------------
def test_palette_no_view_is_never_transparent():
    cls = np.array([[0, 1, 2, 252, 253, 254, 255, 7]] * 6, np.uint8)
    rgba = satellite.palette_rgba(cls)
    alpha = rgba[..., 3]
    assert (alpha[:, 4] > 0).all() and (alpha[:, 6] > 0).all()                  # 253 cloud, 255 no data
    assert (alpha[:, 7] > 0).all()                                               # an unknown class: no view too
    assert (alpha[:, 0] == 0).all() and (alpha[:, 5] == 0).all()                 # not water, ocean: clear
    assert tuple(rgba[0, 1]) == satellite.RGBA_WATER and tuple(rgba[0, 2]) == satellite.RGBA_PARTIAL
    # clouds and no data are drawn the same way (one diagonal "no view" hatch over the same grey)
    cloud, nodata = ({tuple(int(v) for v in rgba[r, c]) for r in range(6)} for c in (4, 6))
    assert cloud == nodata == {satellite.RGBA_NO_VIEW, satellite.RGBA_NO_VIEW_HATCH}
    out = np.zeros(cls.shape, bool)
    out[:, 6] = True
    assert (satellite.palette_rgba(cls, out)[:, 6, 3] == 0).all()                # outside the image: transparent


def test_stats_and_absolute_caveat_time():
    cls = np.zeros((10, 10), np.uint8)
    cls[0, :] = 253
    cls[1, :] = 255
    cls[2, :5] = 1
    st = satellite.stats_of(cls, (-95.0, 39.0, -94.9, 39.1))
    assert st["cloud_pct"] == pytest.approx(10.0, abs=0.3) and st["nodata_pct"] == pytest.approx(10.0, abs=0.3)
    assert st["water_km2"] > 0 and st["partial_km2"] == 0 and st["area_km2"] > 90
    txt = satellite.date_time_text(1793293589000, "America/Chicago")
    assert txt == "Oct 29, 2026, 12:06 PM CDT"


# ---------------------------------------------------------------------------------------------------------------
# Area
# ---------------------------------------------------------------------------------------------------------------
def test_flood_area_pads_and_cuts_long_floods():
    small = {"bbox_lonlat": [-108.065, 36.787, -108.055, 36.793], "lat": 36.79, "lon": -108.06, "primary_gauge": None}
    a = maps.flood_area(small)
    assert a.extent_m == maps.FLOOD_AOI_MIN_M and a.note is None
    long = {"bbox_lonlat": [-94.84, 39.27, -94.64, 39.77001], "lat": 39.688, "lon": -94.703,
            "primary_gauge": {"lid": "AGYM7", "lon": -94.702611, "lat": 39.688028}}
    a = maps.flood_area(long)
    assert a.extent_m == maps.FLOOD_AOI_MAX_M and "primary river gauge" in a.note
    assert a.center_lon == pytest.approx(-94.702611) and a.center_lat == pytest.approx(39.688028)


# ---------------------------------------------------------------------------------------------------------------
# End-to-end build on the recorded day
# ---------------------------------------------------------------------------------------------------------------
def _tiff_of(req: httpx.Request) -> httpx.Response:
    """A synthetic DSWx export of the requested size and box: no data along the west edge, a band of water, partial
    water around it, a cloud block."""
    import rasterio
    from rasterio.io import MemoryFile
    from rasterio.transform import from_bounds

    w, h = (int(v) for v in req.url.params["size"].split(","))
    box = [float(v) for v in req.url.params["bbox"].split(",")]
    sr = int(req.url.params["bboxSR"])
    a = np.zeros((h, w), np.uint8)
    a[:, : max(1, w // 10)] = 255
    a[h // 2 - h // 20: h // 2 + h // 20, :] = 1
    a[h // 2 + h // 20: h // 2 + h // 12, :] = 2
    a[: h // 5, w // 2: w // 2 + w // 5] = 253
    with MemoryFile() as mem:
        with mem.open(driver="GTiff", width=w, height=h, count=1, dtype="uint8", crs=f"EPSG:{sr}", nodata=255,
                      transform=from_bounds(*box, w, h)) as ds:
            ds.write(a, 1)
        return httpx.Response(200, content=mem.read(), headers={"content-type": "image/tiff"})


def _routes(nfhl_down: bool = False) -> list:
    not_found = httpx.Response(404, json={"title": "Not Found"})
    nwps_files = {"/gauges/AGYM7": NWPS / "nwps_gauge_AGYM7.json", "/gauges/AGYM7/stageflow": NWPS / "nwps_stageflow_AGYM7.json"}

    def nwps(req):
        p = req.url.path.replace("/nwps/v1", "")
        if p in nwps_files:
            return httpx.Response(200, content=nwps_files[p].read_bytes(), headers={"content-type": "application/json"})
        if p.startswith("/reaches/"):
            return httpx.Response(200, content=(NWPS / "nwps_reach_14299883_short_range.json").read_bytes())
        return not_found

    def fema_down(req):
        raise httpx.ConnectError("Connection reset by peer", request=req)

    noaa = "maps.water.noaa.gov"
    return [
        ("api.weather.gov", r"^/alerts/active$", NWS / "nws_flood_active.json"),
        ("api.weather.gov", r"^/(products|zones)/", not_found),
        ("api.water.noaa.gov", r"^/nwps/v1/", nwps),
        ("mapservices.weather.noaa.gov", r"/riv_gauges/MapServer/(0|15)/query$", NWPS / "riv_gauges_bbox.json"),
        (noaa, r"/rfc_max_forecast/MapServer/0/query$", NWPS / "rfc_max_forecast.json"),
        (noaa, r"rfc_based_5day_max_inundation_extent/MapServer/0/query$", MAPS / "rfc_fim_polygons.json"),
        (noaa, r"rfc_based_5day_max_inundation_extent/MapServer/3/query$", MAPS / "rfc_fim_reaches.json"),
        (noaa, r"static_stage_based_catfim/MapServer/\d+/query$", MAPS / "catfim_AGYM7_moderate.json"),
        (noaa, r"ana_inundation_extent/MapServer/0/query$", MAPS / "nwm_analysis.json"),
        ("hazards.fema.gov", r"/28/query$", fema_down if nfhl_down else NFHL / "zones.json"),
        ("hazards.fema.gov", r"/0/query$", fema_down if nfhl_down else NFHL / "availability.json"),
        ("hazards.fema.gov", r"/3/query$", fema_down if nfhl_down else NFHL / "panels.json"),
        ("gis.earthdata.nasa.gov", r"/ImageServer/query$", OPERA / "egis_query.json"),
        ("gis.earthdata.nasa.gov", r"/ImageServer/exportImage$", _tiff_of),
        ("gibs.earthdata.nasa.gov", r"\.xml$", OPERA / "gibs_domain.xml"),
    ]


@pytest.fixture
def recorded_flood(monkeypatch, flood_iso, no_backoff):
    """The recorded Platte River flood (AGYM7) as the lists know it, every upstream mocked."""
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", None)
    inp, now = recorded_flood_inputs()
    lst = catalog.build_list(inp, now)
    summary = next(s for s in lst["floods"] if (s["primary_gauge"] or {}).get("lid") == "AGYM7")
    monkeypatch.setattr(catalog, "flood_list", lambda refresh=False: lst)
    monkeypatch.setattr(catalog, "resolve", lambda fid: (summary, "live") if fid == summary["id"] else
                        (_ for _ in ()).throw(catalog.FloodNotFound(fid)))

    def dem(grid):
        x = np.linspace(0, 1, grid.width, dtype=np.float32)
        return (250.0 + 40.0 * np.add.outer(x, x)).astype(np.float32), FetchInfo("https://3dep.test", now, False, 0.1), 0

    def no_naip(grid, max_px=2048):
        raise RasterFetchError("NAIP: no imagery over the AOI (0.0% covered)")

    monkeypatch.setattr(terrain, "fetch_dem_info", dem)
    monkeypatch.setattr(imagery, "fetch_naip_info", no_naip)
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", route_transport(_routes(), calls))
    return summary, now, calls


def test_build_recorded_flood_end_to_end(recorded_flood):
    summary, now, calls = recorded_flood
    steps: list[tuple[str, float]] = []
    m = build.build_flood(summary["id"], progress=lambda s, v, msg: steps.append((s, v)), now=now)
    validate_strict(FloodManifest, m)
    bdir = store.flood_dir(summary["id"])
    on_disk = json.loads((bdir / "manifest.json").read_text())
    assert on_disk == json.loads(json.dumps(m)) and m["status"] == "ready" and m["hazard"] == "flood"
    # area: cut to 60 km around the primary gauge; 1024² UTM grid; fire grid = render grid
    assert m["aoi_note"] and m["grid"]["extent_m"] == 60000 and m["grid"]["crs"] == "EPSG:32615"
    assert m["grid"]["render"] == m["grid"]["fire"] and m["grid"]["render"]["width"] == 1024
    # layers
    for name in ("elevation", "sky_view", "water_forecast", "floodplain", "water_satellite", "water_model"):
        info = m["layers"][name]
        assert (bdir / info["file"]).stat().st_size == 1024 * 1024 * (4 if name == "elevation" else 1), name
    assert "naip" not in m["layers"] and m["layer_status"]["naip"]["status"] == "unavailable"
    assert m["layer_status"]["naip"]["reason"] == fcopy.NAIP_DOWN
    assert {k for k, v in m["layer_status"].items() if v["status"] == "ok"} >= {
        "terrain", "water_forecast", "floodplain", "water_satellite", "water_model", "warnings", "gauges"}
    fc = np.fromfile(bdir / m["layers"]["water_forecast"]["file"], np.uint8)
    assert set(np.unique(fc)) <= {0, 255} and (fc == 255).any()
    fp = np.fromfile(bdir / m["layers"]["floodplain"]["file"], np.uint8)
    assert set(np.unique(fp)) <= {0, 1, 2, 3} and (fp == 2).any()
    sat = np.fromfile(bdir / m["layers"]["water_satellite"]["file"], np.uint8).reshape(1024, 1024)
    assert set(np.unique(sat)) <= set(opera.CLASSES) and (sat == 1).any()
    # the chosen pass's tile (T15TUE) ends at 39.638 N: the south of the area is outside the image -> 255 there
    assert (sat[-40:, :] == 255).all()
    # files
    for rel in ("warnings.json", "gauges.json", "satellite.json", "satellite.png", "maps/rfc_fim.geojson",
                "maps/nfhl.geojson", "model/nwm_analysis.geojson"):
        assert (bdir / rel).is_file(), rel
    assert m["files"]["maps"]["rfc_fim"] == "maps/rfc_fim.geojson" and "catfim_AGYM7_moderate" in m["files"]["maps"]
    assert any(k.startswith("nwm_series_") for k in m["files"]["model"])
    gz = json.loads((bdir / "gauges.json").read_text())
    agym7 = next(g for g in gz["gauges"] if g["lid"] == "AGYM7")
    assert agym7["member"] and agym7["series"]["observed"] and agym7["time_zone"] == "America/Chicago"
    al = json.loads((bdir / "warnings.json").read_text())
    assert al["status"] == "available" and {a["vtec"]["office"] for a in al["alerts"]} == {"KEAX"}
    # satellite: measured, locked pass, absolute times only (C16), PNG with lon/lat bounds
    s = json.loads((bdir / "satellite.json").read_text())
    validate_strict(SatelliteWaterResponse, s)
    assert s["measured"] and s["login"] == "not_configured" and s["login_note"] == fcopy.SAT_NOT_SET_UP
    assert s["granules"][0]["route"] == "earthdata_gis" and s["granules"][0]["acquired_ms"] < now
    assert " ago" not in (bdir / "satellite.json").read_text() and "d ago" not in json.dumps(m)
    assert s["image"]["url"].startswith(f"/api/floods/{summary['id']}/satellite.png?granule=DSWx-HLS_")
    img = Image.open(bdir / "satellite.png")
    assert img.mode == "RGBA"
    b = s["image"]["bounds_lonlat"]
    assert b[1] >= 39.63 and b[3] <= m["grid"]["bbox_lonlat"][3] + 1e-4           # cropped to the image's tile
    exports = [c for c in calls if c.url.path.endswith("/exportImage")]
    assert exports and all('"esriMosaicLockRaster"' in c.url.params["mosaicRule"] for c in exports)
    # progress is monotone and finishes; size well under 20 MB; nothing left in staging
    vals = [v for _, v in steps]
    assert vals == sorted(vals) and vals[-1] == 1.0
    assert sum(p.stat().st_size for p in bdir.rglob("*") if p.is_file()) < 20e6
    assert not (bdir / build.STAGING).exists()
    assert store.bundle_state(summary["id"]) == ("ready", now)


def test_fema_down_bundle_still_ready(recorded_flood, monkeypatch):
    summary, now, _ = recorded_flood
    monkeypatch.setattr(fhttp, "_transport", route_transport(_routes(nfhl_down=True)))
    m = build.build_flood(summary["id"], now=now)
    assert m["status"] == "ready" and m["layer_status"]["floodplain"] == {
        "status": "unavailable", "reason": fcopy.NFHL_DOWN, "source": fcopy.CREDIT_NFHL, "time_ms": None}
    assert "floodplain" not in m["layers"] and fcopy.NFHL_DOWN in m["warnings"]


def test_terrain_failure_keeps_the_old_bundle(recorded_flood, monkeypatch):
    summary, now, _ = recorded_flood
    build.build_flood(summary["id"], now=now)
    bdir = store.flood_dir(summary["id"])
    before = (bdir / "manifest.json").read_bytes()

    def down(grid):
        raise RasterFetchError("3DEP: HTTP 503")

    monkeypatch.setattr(terrain, "fetch_dem_info", down)
    with pytest.raises(RuntimeError, match="Terrain"):
        build.build_flood(summary["id"], now=now + 60_000, force=True)
    assert (bdir / "manifest.json").read_bytes() == before and not (bdir / build.STAGING).exists()


def test_rebuild_drops_files_the_new_build_did_not_write(recorded_flood):
    summary, now, _ = recorded_flood
    build.build_flood(summary["id"], now=now)
    bdir = store.flood_dir(summary["id"])
    (bdir / "maps" / "old_layer.geojson").write_text("{}")
    build.build_flood(summary["id"], now=now + 60_000, force=True)
    assert not (bdir / "maps" / "old_layer.geojson").exists() and (bdir / "maps" / "rfc_fim.geojson").is_file()


def test_gate(monkeypatch, flood_iso):
    with pytest.raises(build.BuildRefused) as ei:
        build.gate("fixture-flood")
    assert ei.value.status == 409

    def lists_down(fid):
        raise catalog.ListsUnavailable()

    monkeypatch.setattr(catalog, "resolve", lists_down)
    with pytest.raises(build.BuildRefused) as ei:
        build.gate("flood-20261104-x-flood-abcdef")
    assert ei.value.status == 503

    def not_listed(fid):
        raise catalog.FloodNotFound(fid)

    monkeypatch.setattr(catalog, "resolve", not_listed)
    with pytest.raises(build.BuildRefused) as ei:
        build.gate("flood-20261104-x-flood-abcdef")
    assert ei.value.status == 404
    monkeypatch.setattr(catalog, "resolve", lambda fid: ({"id": fid, "state": "PR", "synthetic": False}, "live"))
    with pytest.raises(build.BuildRefused) as ei:
        build.gate("flood-20261104-x-flood-abcdef")
    assert ei.value.status == 409 and ei.value.detail == fcopy.BUILD_OUTSIDE_L48
