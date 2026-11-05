"""The flood bundle (PLAN-5 3.3, CONTRACT 16.3): terrain, water layers and frozen official copies of one flood, for the
Forensic 3D view (and the 2D views' files). Light: no fuels, no detections, no weather, no simulation.

Layout (``data/floods/{id}/``)::

    manifest.json                FloodManifest (grid = ManifestGrid with fire = render)
    layers/elevation.bin         render float32 m (USGS 3DEP)            layers/sky_view.bin  render uint8
    layers/naip.jpg              aerial photo (USGS NAIP), optional ("before this flood")
    layers/water_forecast.bin    uint8 0/255  NWS forecast flooded area, next 5 days (experimental)
    layers/floodplain.bin        uint8        0 none, 1 0.2 % band, 2 SFHA, 3 floodway (FEMA, background)
    layers/water_satellite.bin   uint8        DSWx classes; 255 outside the satellite image
    layers/water_model.bin       uint8 0/255  National Water Model analysis flooded area (model output, separate)
    layers/water_pass_<key>.bin  uint8        brief 6: DSWx classes of each kept satellite pass (newest usable, at most 8)
    warnings.json  gauges.json  satellite.json  satellite.png
    timeline.json                brief 6: FloodTimelineResponse (every pass; every NWS product version)
    maps/rfc_fim.geojson  maps/catfim_<lid>_<category>.geojson  maps/nfhl.geojson
    model/nwm_analysis.geojson  model/nwm_series_<lid>.json

* **Area** (:func:`fire3d.floods.maps.flood_area`): the flood's NWS polygons and member gauges, padded 3 km, square,
  8-60 km (cut around the primary gauge when longer; ``aoi_note``), on a 1024² UTM render grid.
* **Steps and weights:** catalog 0.05, terrain 0.30, maps 0.15, gauges 0.15, satellite 0.15, timeline 0.15 (brief 6:
  every satellite pass read on the grid after the satellite step, so it never takes the satellite step's request
  slots; every NWS product version), finish 0.05. Terrain is required (a failure fails the job and leaves any earlier bundle as it was); every other step that fails writes its
  ``layer_status`` entry with a reason and a manifest warning, and the bundle is still ``ready``.
* **Gate** (:func:`gate`): a flood the lists know (live list, alias, bundle or last-known summary), in the lower 48 or
  DC, not synthetic (``fixture-flood``: 409).
* **Frozen files carry absolute times only** (C16): no relative age is ever written.
* **Every source is credited** in ``manifest.data_sources`` (review R1): one entry per step that wrote a file or a
  layer, named by its credit line (CONTRACT 16.15; the same text as that layer's ``layer_status.source``), with what
  the bundle holds from it in ``detail`` (absolute UTC times) and when it was fetched. Gauges add each data
  attribution NWPS names ("Observations courtesy of U.S. Geological Survey") and each RFC forecast's issuer; products
  drawn as whole counties add the county shapes' source.
* The build runs in ``.staging/`` inside the bundle folder (hidden from the files route) and swaps the files in at
  the end, the manifest last, so a rebuild never shows a half-written bundle; ``pipeline.bundle_lock`` keeps one build
  per flood (``store.bundle_state`` reports ``building`` while it runs).
"""

from __future__ import annotations

import logging
import math
import os
import shutil
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

import numpy as np
import shapely
from shapely.geometry import shape

from .. import bundle, config, regions
from ..build import pipeline
from ..contracts import FloodManifest, validate_strict
from ..grid import Grid, manifest_grid, transformer, utm_epsg_for
from ..sources import imagery, terrain
from ..sources.nws import SourceBusy, SourceError
from ..timeutil import HOUR_MS, now_ms
from . import catalog, gauges as gauges_mod, maps, satellite, store, timeline, zones
from . import copy as fcopy
from . import copy_time as tcopy

log = logging.getLogger(__name__)

ProgressFn = Callable[[str, float, str], None]
WEIGHTS = {"catalog": 0.05, "terrain": 0.30, "maps": 0.15, "gauges": 0.15, "satellite": 0.15, "timeline": 0.15,
           "finish": 0.05}
PRODUCT_TRIES = 6                    # the NWS product history waits for Disaster Mapping's IEM limit this many times
PRODUCT_WAIT_S = 10.0
STAGING = ".staging"
NAIP_MAX_PX = 2048
TIME_BEFORE_MS = 72 * HOUR_MS
TIME_AFTER_MS = 120 * HOUR_MS
KEEP_NAMES = {pipeline.BUILD_LOCK_NAME, STAGING, "api"}       # never removed from a bundle folder by a rebuild


class BuildRefused(RuntimeError):
    """The build gate's answer: HTTP ``status`` with a plain ``detail``."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ----------------------------------------------------------------------------------------------------------------
# Gate
# ----------------------------------------------------------------------------------------------------------------
def gate(flood_id: str) -> tuple[dict, str]:
    """(summary, resolved_from) of a buildable flood; raises :class:`BuildRefused` (404 not listed, 409 synthetic or
    outside the lower 48, 503 the lists could not decide)."""
    if flood_id == store.FIXTURE_ID or flood_id.startswith(store.FIXTURE_ID + "-"):
        m = store.load_flood_manifest(flood_id)
        if m is not None or flood_id == store.FIXTURE_ID:
            raise BuildRefused(409, fcopy.BUILD_SYNTHETIC)
        raise BuildRefused(404, fcopy.FLOOD_ROUTE_NOT_LISTED)
    try:
        summary, resolved = catalog.resolve(flood_id)
    except catalog.FloodNotFound:
        raise BuildRefused(404, fcopy.FLOOD_ROUTE_NOT_LISTED) from None
    except catalog.ListsUnavailable:
        raise BuildRefused(503, fcopy.FLOOD_LISTS_503) from None
    if summary.get("synthetic"):
        raise BuildRefused(409, fcopy.BUILD_SYNTHETIC)
    st = summary.get("state")
    if not st or st not in regions.L48 or not regions.is_supported_state(st):
        raise BuildRefused(409, fcopy.BUILD_OUTSIDE_L48)
    return summary, resolved


# ----------------------------------------------------------------------------------------------------------------
# Grid and rasters
# ----------------------------------------------------------------------------------------------------------------
def flood_grid(summary: dict) -> tuple[Grid, maps.FloodArea]:
    """The 1024² UTM render grid of the flood's area."""
    area = maps.flood_area(summary)
    epsg = utm_epsg_for(area.center_lon)
    ce, cn = transformer(4326, epsg).transform(area.center_lon, area.center_lat)
    side = float(round(area.extent_m))
    return Grid(epsg, float(round(ce)), float(round(cn)), side, config.RENDER_SIZE, config.RENDER_SIZE), area


def grid_bbox(grid: Grid) -> tuple[float, float, float, float]:
    return tuple(round(float(v), 5) for v in grid.bbox_lonlat())  # type: ignore[return-value]


def rasterize(features: list[dict], grid: Grid, value: Callable[[dict], int] | int = 255) -> np.ndarray:
    """uint8 raster of lon/lat GeoJSON features on the UTM grid (later features win)."""
    from rasterio import features as rfeatures

    t = transformer(4326, grid.epsg)
    shapes = []
    for f in features:
        g = f.get("geometry")
        if not g:
            continue
        try:
            geom = shape(g).buffer(0) if g.get("type") in ("Polygon", "MultiPolygon") else shape(g)
        except (ValueError, TypeError, AttributeError):
            continue
        if geom.is_empty:
            continue
        utm = shapely.transform(geom, lambda a: np.column_stack(t.transform(a[:, 0], a[:, 1])))
        v = value(f) if callable(value) else value
        if v:
            shapes.append((utm, int(v)))
    if not shapes:
        return np.zeros(grid.shape, np.uint8)
    return rfeatures.rasterize(shapes, out_shape=grid.shape, transform=grid.transform, fill=0, dtype="uint8")


# ----------------------------------------------------------------------------------------------------------------
# Build
# ----------------------------------------------------------------------------------------------------------------
def compact_fc(fc: dict, grid: Grid) -> dict:
    """A FeatureCollection for the bundle's vector copies: polygons smaller than one render cell are left out (the 3D
    view cannot show them; the rasters are made from the full answer), geometries are simplified to about 3/4 of a
    cell and coordinates rounded to 4 decimals (about 11 m, finer than the 59 m cells of a 60 km area), so the bundle
    stays under 20 MB. The 2D routes keep serving the full answers."""
    from shapely.geometry import mapping

    tol = 0.75 * grid.res_m / 111_320.0
    lat = math.radians(float(grid.bbox_lonlat()[1] + grid.bbox_lonlat()[3]) / 2)
    cell_deg2 = (grid.res_m / (111_320.0 * max(0.2, math.cos(lat)))) * (grid.res_m / 110_570.0)
    out = []
    for f in fc.get("features") or []:
        g = f.get("geometry")
        if not g:
            continue
        try:
            geom = shape(g)
            poly = g.get("type") in ("Polygon", "MultiPolygon")
            if poly and geom.area < cell_deg2:
                continue
            geom = shapely.transform(geom.simplify(tol, preserve_topology=poly), lambda a: np.round(a, 4))
        except Exception:  # noqa: BLE001 - a geometry GEOS cannot simplify is kept as sent
            out.append(f)
            continue
        if geom.is_empty:
            continue
        out.append({**f, "geometry": mapping(geom)})
    return {"type": "FeatureCollection", "features": out}


def _status(status: str, reason: str | None, source: str, time_ms: int | None) -> dict:
    return {"status": status, "reason": reason, "source": source, "time_ms": time_ms}


def _iso(ms: int | None) -> str:
    """"2026-11-04T18:22Z" (UTC; absolute, never an age)."""
    if ms is None:
        return "time not stated"
    return time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(int(ms) / 1000))


def _credit(sources: list[dict], name: str, detail: str, fetched_ms: int | None, now: int) -> None:
    """Add one ``DataSource`` (name = the credit line)."""
    sources.append({"name": name, "detail": detail, "fetched_ms": int(fetched_ms or now)})


def _gauge_credits(sources: list[dict], gz: dict, now: int) -> None:
    """NWPS for gauges.json, each data attribution NWPS names for its gauges, and each RFC forecast's issuer."""
    gauges = gz.get("gauges") or []
    members = [g["lid"] for g in gauges if g.get("member")]
    near = len(gauges) - len(members)
    _credit(sources, fcopy.CREDIT_NWPS,
            f"river gauges (gauges.json): {len(members)} in this flood"
            + (f" ({', '.join(members)})" if members else "") + f", {near} nearby", gz.get("retrieved_ms"), now)
    attr: dict[str, list[str]] = {}
    rfc: dict[str, list[str]] = {}
    for g in gauges:
        for a in g.get("data_attribution") or []:
            if a.get("text"):
                attr.setdefault(a["text"], []).append(g["lid"])
        fc = g.get("forecast") or {}
        if g.get("member") and (fc.get("producer") or fc.get("producer_name") or fc.get("issuer")):
            rfc.setdefault(fcopy.rfc_credit(fc.get("producer_name") or fc.get("producer"), fc.get("issuer")),
                           []).append(f"{g['lid']} issued {_iso(fc.get('issued_ms'))}")
    for text, lids in attr.items():
        _credit(sources, text, f"river gauge observations: {', '.join(lids)}", gz.get("retrieved_ms"), now)
    for text, items in rfc.items():
        _credit(sources, text, f"official NWS river forecast: {'; '.join(items)}", gz.get("retrieved_ms"), now)


def _swap_in(stage: Path, bdir: Path) -> None:
    """Move every staged file into the bundle folder (directories merged), drop old files the new build did not write,
    and keep the lock, the staging folder and canned answers."""
    new: set[str] = set()
    for p in sorted(stage.rglob("*")):
        if p.is_file():
            rel = p.relative_to(stage).as_posix()
            if rel == "manifest.json":
                continue
            new.add(rel)
            dst = bdir / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            os.replace(p, dst)
    for p in sorted(bdir.rglob("*"), reverse=True):
        rel = p.relative_to(bdir).as_posix()
        top = rel.split("/", 1)[0]
        if top in KEEP_NAMES or rel == "manifest.json":
            continue
        if p.is_file() and rel not in new:
            p.unlink(missing_ok=True)
        elif p.is_dir() and not any(p.iterdir()):
            p.rmdir()


def build_flood(flood_id: str, *, progress: ProgressFn | None = None, force: bool = False,
                now: int | None = None) -> dict:
    """Build (or rebuild) the bundle of ``flood_id``; returns the ready manifest. Raises :class:`BuildRefused` from the
    gate, ``pipeline.BundleBusy`` when another build runs, and the terrain error when terrain fails."""
    prog = pipeline.BuildProgress(progress, WEIGHTS)
    prog.report("catalog", 0.0, "Checking the flood lists")
    summary, _ = gate(flood_id)
    now = int(now if now is not None else now_ms())
    bdir = store.flood_dir(flood_id)
    bdir.mkdir(parents=True, exist_ok=True)
    with pipeline.bundle_lock(bdir, timeout=0):
        stage = bdir / STAGING
        shutil.rmtree(stage, ignore_errors=True)
        stage.mkdir(parents=True)
        try:
            m = _build(summary, stage, prog, now)
            validate_strict(FloodManifest, m)
            _swap_in(stage, bdir)
            bundle.write_json(bdir / "manifest.json", m)
        finally:
            shutil.rmtree(stage, ignore_errors=True)
    prog.finish("finish", f"Flood bundle ready ({_size_mb(bdir):.1f} MB)")
    return m


def _size_mb(d: Path) -> float:
    return sum(p.stat().st_size for p in d.rglob("*") if p.is_file() and STAGING not in p.parts) / 1e6


def _build(summary: dict, stage: Path, prog: pipeline.BuildProgress, now: int) -> dict:
    fid = summary["id"]
    grid, area = flood_grid(summary)
    bbox = grid_bbox(grid)
    tz = summary.get("time_zone") or "UTC"
    prog.report("catalog", 1.0, f"{summary['name']}: {grid.extent_m / 1000:.0f} km area")
    warnings: list[str] = []
    status: dict[str, dict] = {}
    layers: dict[str, dict] = {}
    files: dict[str, Any] = {"warnings": "warnings.json", "gauges": "gauges.json", "satellite": None,
                             "satellite_image": None, "maps": {}, "model": {}}
    sources: list[dict] = []
    t0 = time.monotonic()

    with ThreadPoolExecutor(max_workers=4, thread_name_prefix=f"flood-build-{fid[-6:]}") as pool:
        f_dem: Future = pool.submit(terrain.fetch_dem_info, grid)
        f_naip: Future = pool.submit(imagery.fetch_naip_info, grid, NAIP_MAX_PX)
        f_fim = pool.submit(maps.rfc_fim_answer, summary, now=now, area=bbox)
        f_nfhl = pool.submit(maps.nfhl_answer, summary, now=now, area=bbox)
        lid, cat = maps.default_catfim(summary)
        f_cat = pool.submit(maps.catfim_answer, summary, now=now, lid=lid, category=cat) if lid else None
        f_nwm = pool.submit(maps.model_answer, "nwm_analysis", summary, now=now, area=bbox)
        f_alerts = pool.submit(zones.flood_alerts, summary, now=now)
        f_gauges = pool.submit(gauges_mod.flood_gauges, summary, now=now, with_series=True)
        f_sat = pool.submit(satellite.flood_satellite, fid, bbox, now=now, time_zone=tz, grid=grid)

        # ---- terrain (required) -------------------------------------------------------------------------------
        prog.report("terrain", 0.05, "Fetching USGS 3DEP elevation")
        try:
            dem, dem_info, filled = f_dem.result()
        except Exception as e:
            raise RuntimeError(f"{fcopy.TERRAIN_DOWN} ({pipeline.short_error(e)})") from e
        layers["elevation"] = bundle.write_layer(stage, "elevation", dem, "render", "m", "Elevation (USGS 3DEP), m",
                                                 register=False)
        svf = terrain.sky_view_uint8(dem, grid.res_m)
        layers["sky_view"] = bundle.write_layer(stage, "sky_view", svf, "render", "0-255", "Sky-view factor (0-255)",
                                                register=False)
        _credit(sources, fcopy.CREDIT_3DEP, f"elevation, {grid.res_m:.0f} m (layers/elevation.bin, sky_view.bin)",
                dem_info.fetched_ms, now)
        if filled:
            warnings.append(f"Terrain: {filled} cells without elevation were filled from their neighbours.")
        status["terrain"] = _status("ok", None, fcopy.CREDIT_3DEP, dem_info.fetched_ms)
        prog.report("terrain", 0.8, "Elevation written")
        try:
            img = f_naip.result()
            layers["naip"] = bundle.write_image_layer(stage, "naip", img.jpeg, img.width, img.height,
                                                      "Aerial photo (USGS NAIP), taken before this flood", register=False)
            status["naip"] = _status("ok", None, fcopy.CREDIT_NAIP, img.info.fetched_ms)
            _credit(sources, fcopy.CREDIT_NAIP,
                    f"aerial photo taken before this flood, {img.width} px (layers/naip.jpg)", img.info.fetched_ms, now)
        except Exception as e:  # noqa: BLE001 - optional layer
            log.info("NAIP %s: %s", fid, pipeline.short_error(e))
            status["naip"] = _status("unavailable", fcopy.NAIP_DOWN, fcopy.CREDIT_NAIP, None)
            warnings.append(fcopy.NAIP_DOWN)
        prog.report("terrain", 1.0, "Terrain ready")

        # ---- maps -----------------------------------------------------------------------------------------------
        prog.report("maps", 0.0, "NWS forecast flooded area, FEMA floodplain, model")
        fim = _result(f_fim, "RFC FIM")
        if fim and fim["status"] == "available":
            bundle.write_json(stage / "maps" / "rfc_fim.geojson", compact_fc(fim["features"], grid))
            files["maps"]["rfc_fim"] = "maps/rfc_fim.geojson"
            layers["water_forecast"] = bundle.write_layer(
                stage, "water_forecast", rasterize(fim["features"]["features"], grid), "render", None,
                "NWS forecast flooded area, next 5 days (experimental; 0/255)", register=False)
            status["water_forecast"] = _status("ok", None, fcopy.CREDIT_NWC_EXPERIMENTAL, fim.get("reference_ms"))
            _credit(sources, fcopy.CREDIT_NWC_EXPERIMENTAL,
                    "NWS forecast flooded area, next 5 days (RFC-based 5-day maximum inundation extent, "
                    f"experimental): {len(fim['features']['features'])} reach polygons, forecast of "
                    f"{_iso(fim.get('reference_ms'))} "
                    f"(maps/rfc_fim.geojson, layers/water_forecast.bin)", fim.get("retrieved_ms"), now)
        else:
            reason = (fim or {}).get("reason") or fcopy.RFC_FIM_UNAVAILABLE
            status["water_forecast"] = _status("unavailable", reason, fcopy.CREDIT_NWC_EXPERIMENTAL, None)
            warnings.append(reason)
        prog.report("maps", 0.35, "Forecast flooded area")
        nf = _result(f_nfhl, "NFHL")
        if nf and nf["status"] == "available":
            bundle.write_json(stage / "maps" / "nfhl.geojson", compact_fc(nf["features"], grid))
            files["maps"]["nfhl"] = "maps/nfhl.geojson"
            fp = rasterize([f for f in nf["features"]["features"]], grid, _nfhl_code)
            layers["floodplain"] = bundle.write_layer(
                stage, "floodplain", fp, "render", None,
                "FEMA floodplain (background): 0 none, 1 0.2 % band, 2 SFHA, 3 floodway", register=False)
            reason = None if nf.get("availability") == "mapped" else (nf["caveats"][0] if nf.get("caveats") else None)
            status["floodplain"] = _status("ok", reason, fcopy.CREDIT_NFHL, nf.get("effective_max_ms"))
            _credit(sources, fcopy.CREDIT_NFHL,
                    f"FEMA 1% annual-chance floodplain and 0.2% band (background): {len(nf['features']['features'])} "
                    f"zones, digital map availability {nf.get('availability')} "
                    "(maps/nfhl.geojson, layers/floodplain.bin)",
                    nf.get("retrieved_ms"), now)
        else:
            status["floodplain"] = _status("unavailable", fcopy.NFHL_DOWN, fcopy.CREDIT_NFHL, None)
            warnings.append(fcopy.NFHL_DOWN)
        prog.report("maps", 0.6, "FEMA floodplain")
        if f_cat is not None:
            cf = _result(f_cat, "CatFIM")
            if cf and cf["status"] == "available" and cf["features"]["features"]:
                name = f"catfim_{lid}_{cf['category'] or cat}"
                bundle.write_json(stage / "maps" / f"{name}.geojson", compact_fc(cf["features"], grid))
                files["maps"][name] = f"maps/{name}.geojson"
                _credit(sources, fcopy.CREDIT_NWC_EXPERIMENTAL,
                        f"NWS category flood map library (static stage-based CatFIM, experimental): {lid}, "
                        f"{cf['category'] or cat} flooding (maps/{name}.geojson)", cf.get("retrieved_ms"), now)
        nwm = _result(f_nwm, "NWM")
        if nwm and nwm["status"] == "available":
            bundle.write_json(stage / "model" / "nwm_analysis.geojson", compact_fc(nwm["features"], grid))
            files["model"]["nwm_analysis"] = "model/nwm_analysis.geojson"
            layers["water_model"] = bundle.write_layer(
                stage, "water_model", rasterize(nwm["features"]["features"], grid), "render", None,
                "National Water Model analysis flooded area (experimental model output; 0/255)", register=False)
            status["water_model"] = _status("ok", None, fcopy.CREDIT_NWM, nwm.get("reference_ms"))
            _credit(sources, fcopy.CREDIT_NWM,
                    f"National Water Model analysis flooded area of {_iso(nwm.get('reference_ms'))} "
                    "(experimental model output; model/nwm_analysis.geojson, layers/water_model.bin)",
                    nwm.get("retrieved_ms"), now)
        else:
            status["water_model"] = _status("unavailable", (nwm or {}).get("reason") or fcopy.MODEL_DOWN, fcopy.CREDIT_NWM,
                                            None)
        prog.report("maps", 1.0, "Maps ready")

        # ---- gauges and NWS products ----------------------------------------------------------------------------
        prog.report("gauges", 0.0, "River gauges and NWS products")
        gz = _result(f_gauges, "gauges")
        if gz is None:                    # the step failed (an unexpected error): an outage, never "no gauge" (R2)
            gz = {**gauges_mod.envelope("river_gauges", now=now, flood_id=fid, status="unavailable",
                                        reason=fcopy.GAUGES_UNAVAILABLE, reason_code="upstream_error",
                                        caveats=[fcopy.GAUGE_NOT_ALL_CLEAR]),
                  "gauges": [],
                  "area_bbox": list(gauges_mod.pad_bbox(summary["bbox_lonlat"], gauges_mod.NEARBY_PAD_KM))}
        bundle.write_json(stage / "gauges.json", gz)
        members = [g for g in gz.get("gauges") or [] if g.get("member")]
        if gz["status"] == "available":
            obs = [g["observed"].get("valid_ms") for g in members if g["observed"].get("valid_ms")]
            reason = None if summary.get("gauges") else fcopy.GAUGES_NONE
            status["gauges"] = _status("ok", reason, fcopy.CREDIT_NWPS, max(obs) if obs else None)
            _gauge_credits(sources, gz, now)
        else:
            status["gauges"] = _status("unavailable", fcopy.GAUGES_UNAVAILABLE, fcopy.CREDIT_NWPS, None)
            warnings.append(fcopy.GAUGES_UNAVAILABLE)
        series_lids: list[str] = []
        series_fetched: list[int] = []
        for g in members:
            if g.get("reach_id") and g.get("is_forecast_point"):
                try:
                    ans = maps.model_answer("nwm_series", summary, now=now, lid=g["lid"])
                except SourceError as e:              # SourceBusy included: optional
                    log.info("NWM series %s: %s", g["lid"], e)
                    continue
                if ans["status"] == "available":
                    bundle.write_json(stage / "model" / f"nwm_series_{g['lid']}.json", ans)
                    files["model"][f"nwm_series_{g['lid']}"] = f"model/nwm_series_{g['lid']}.json"
                    series_lids.append(g["lid"])
                    series_fetched.append(ans.get("retrieved_ms") or now)
        if series_lids:
            _credit(sources, fcopy.CREDIT_NWM,
                    f"National Water Model streamflow at {', '.join(series_lids)} (experimental model output; "
                    f"model/nwm_series_<gauge>.json)", min(series_fetched), now)
        prog.report("gauges", 0.6, f"{len(members)} member gauges")
        al = _result(f_alerts, "flood-alerts") or zones._empty(now, fid, tuple(summary["bbox_lonlat"]), [], at_ms=None,
                                                               status="unavailable", reason=fcopy.ALERTS_UNAVAILABLE,
                                                               reason_code="upstream_error")
        bundle.write_json(stage / "warnings.json", al)
        if al["status"] == "available":
            sent = [a.get("sent_ms") for a in al["alerts"] if a.get("sent_ms")]
            status["warnings"] = _status("ok", None, fcopy.CREDIT_NWS, max(sent) if sent else None)
            _credit(sources, fcopy.CREDIT_NWS,
                    f"NWS flood products, verbatim (warnings.json): {len(al['alerts'])}"
                    + (f", newest sent {_iso(max(sent))}" if sent else ""), al.get("retrieved_ms"), now)
            if fcopy.ZONES_AS_COUNTIES in (al.get("caveats") or []):
                _credit(sources, fcopy.CREDIT_TIGERWEB_COUNTIES,
                        "county shapes for NWS zone-based products drawn as whole counties (warnings.json)",
                        al.get("retrieved_ms"), now)
        else:
            status["warnings"] = _status("unavailable", fcopy.ALERTS_UNAVAILABLE, fcopy.CREDIT_NWS, None)
            warnings.append(fcopy.ALERTS_UNAVAILABLE)
        prog.report("gauges", 1.0, "Gauges and products ready")

        # ---- satellite ------------------------------------------------------------------------------------------
        prog.report("satellite", 0.0, "Water seen by satellite (NASA OPERA)")
        try:
            sat = f_sat.result()
        except Exception as e:  # noqa: BLE001 - SourceBusy or an unexpected error: the layer is unavailable
            log.info("satellite %s: %s", fid, pipeline.short_error(e))
            sat = satellite.SatResult({**satellite._base(fid, now, satellite.opera.login_state()), "status": "unavailable",
                                       "reason_code": "upstream_error", "reason": fcopy.SAT_UNAVAILABLE}, None, None, None)
        ans = sat.answer
        bundle.write_json(stage / "satellite.json", ans)
        files["satellite"] = "satellite.json"
        if sat.png is not None:
            bundle.atomic_write_bytes(stage / "satellite.png", sat.png)
            files["satellite_image"] = "satellite.png"
        acq = ans["granules"][0]["acquired_ms"] if ans.get("granules") else None
        if ans.get("measured") and ans.get("granules"):
            g0 = ans["granules"][0]
            _credit(sources, ans["source"]["credit"],
                    f"{g0['product']}{', ' + g0['platform'] if g0.get('platform') else ''}, image of {_iso(acq)} "
                    f"(satellite.json" + (", satellite.png" if sat.png is not None else "")
                    + (", layers/water_satellite.bin)" if sat.grid_classes is not None else ")"),
                    ans.get("retrieved_ms"), now)
        elif ans.get("tiles"):
            _credit(sources, ans["source"]["credit"], f"NASA picture of {ans['tiles']['date']} (not measured; "
                    "satellite.json)", ans.get("retrieved_ms"), now)
        if sat.grid_classes is not None:
            layers["water_satellite"] = bundle.write_layer(
                stage, "water_satellite", sat.grid_classes, "render", None,
                "Water seen by satellite (NASA OPERA DSWx WTR classes; 255 = no data or outside the image)", register=False)
            status["water_satellite"] = _status("ok", ans.get("login_note"), ans["source"]["credit"], acq)
        elif ans["status"] == "available":
            status["water_satellite"] = _status("unavailable", ans.get("reason") or fcopy.SAT_NO_IMAGE,
                                                ans["source"]["credit"], None)
        else:
            status["water_satellite"] = _status("not_configured" if ans.get("reason_code") == "not_configured" else
                                                "unavailable", ans.get("reason") or fcopy.SAT_UNAVAILABLE,
                                                ans["source"]["credit"], None)
        if status["water_satellite"]["status"] != "ok":
            warnings.append(status["water_satellite"]["reason"] or fcopy.SAT_UNAVAILABLE)
        prog.report("satellite", 1.0, "Satellite water ready")

        # ---- time history (brief 6): every satellite pass and every NWS product version ---------------------
        _timeline_step(summary, grid, bbox, stage, prog, now, ans, layers, files, sources, warnings)

    # ---- finish ------------------------------------------------------------------------------------------------
    prog.report("finish", 0.2, "Writing the manifest")
    for k in ("water_forecast", "floodplain", "water_satellite", "water_model", "naip"):
        status.setdefault(k, _status("unavailable", None, "", None))
    starts = [summary.get("started_ms") or now]
    ends = [now + TIME_AFTER_MS]
    for g in gz.get("gauges") or []:
        fc = (g.get("series") or {}).get("forecast") or []
        if fc:
            ends.append(int(fc[-1][0]))
    t_start = (min(min(starts), now - TIME_BEFORE_MS) // HOUR_MS) * HOUR_MS
    t_end = max(ends)
    s = {**summary, "bundle_status": "ready", "bundle_built_ms": now}
    m = {
        "schema_version": 1, "id": fid, "hazard": "flood", "name": summary["name"], "mode": summary.get("mode") or "live",
        "status": "ready", "summary": s, "time_origin_ms": int(t_start),
        "time_range": {"start_ms": int(t_start), "end_ms": int(t_end), "now_ms": now},
        "grid": manifest_grid(grid, grid, float(np.nanmin(dem)), float(np.nanmax(dem))), "aoi_note": area.note,
        "layers": layers, "layer_status": status, "files": files, "data_sources": sources,
        "warnings": list(dict.fromkeys(warnings)), "built_ms": now,
    }
    log.info("flood bundle %s built in %.1f s", fid, time.monotonic() - t0)
    return m


def _timeline_step(summary: dict, grid: Grid, bbox: tuple, stage: Path, prog: pipeline.BuildProgress, now: int,
                   sat_answer: dict, layers: dict, files: dict, sources: list[dict], warnings: list[str]) -> None:
    """``timeline.json`` and ``layers/water_pass_<key>.bin`` (optional: a failure is a manifest warning only)."""
    prog.report("timeline", 0.0, "Satellite passes and NWS product versions")
    shown = [g["id"] for g in sat_answer.get("granules") or []] if sat_answer.get("measured") else None
    try:
        bp = timeline.bundle_passes(summary, grid, bbox, now=now, shown_granules=shown,
                                    progress=lambda f, msg: prog.report("timeline", 0.75 * f, msg))
    except Exception as e:  # noqa: BLE001 - optional step: the passes say unavailable
        log.info("timeline passes %s: %s", summary["id"], pipeline.short_error(e))
        start, end = timeline.flood_window(summary, now)
        bp = timeline.BundlePasses({**timeline._passes_base(now, start, end, satellite.opera.login_state()),
                                    "stats_over": "bundle_grid", "status": "unavailable",
                                    "reason_code": "upstream_error", "reason": tcopy.PASSES_UNAVAILABLE}, {}, {})
    for name, arr in bp.rasters.items():
        layers[name] = bundle.write_layer(stage, name, arr, "render", None, bp.descriptions[name], register=False)
    prog.report("timeline", 0.8, "NWS product versions (live and archive)")
    prods = None
    for i in range(PRODUCT_TRIES):
        try:
            prods = timeline.product_history(summary, now=now)
        except Exception as e:  # noqa: BLE001 - optional step
            log.info("timeline products %s: %s", summary["id"], pipeline.short_error(e))
            break
        if prods.get("complete") or i == PRODUCT_TRIES - 1:
            break
        time.sleep(PRODUCT_WAIT_S)                                   # Disaster Mapping's own IEM limit: wait
    if prods is None:
        prods = {**timeline._products_env(summary["id"], now), "status": "unavailable",
                 "reason_code": "upstream_error", "reason": fcopy.ALERTS_UNAVAILABLE}
    bundle.write_json(stage / "timeline.json", timeline.timeline(summary, bp.answer, prods, now=now))
    files["timeline"] = "timeline.json"
    pa = bp.answer
    if pa["passes"]:
        kept = sum(1 for p in pa["passes"] if p["layer"])
        _credit(sources, pa["source"]["credit"],
                f"{len(pa['passes'])} satellite passes from {_iso(pa['start_ms'])} to {_iso(pa['end_ms'])}, "
                f"{kept} kept as images (timeline.json, layers/water_pass_<pass>.bin)", pa.get("retrieved_ms"), now)
    elif pa["status"] != "available":
        warnings.append(pa["reason"] or tcopy.PASSES_UNAVAILABLE)
    if prods.get("archive_source"):
        n = sum(1 for p in prods["products"] if p.get("archived"))
        _credit(sources, fcopy.CREDIT_IEM, f"{n} earlier versions of this flood's NWS products, verbatim (timeline.json)",
                prods.get("retrieved_ms"), now)
    if prods["status"] != "available":
        warnings.append(prods["reason"] or fcopy.ALERTS_UNAVAILABLE)
    prog.report("timeline", 1.0, f"{len(pa['passes'])} satellite passes, {len(prods['products'])} NWS product versions")


def _nfhl_code(f: dict) -> int:
    p = f.get("properties") or {}
    from ..sources import nfhl

    return nfhl.zone_code({"ZONE_SUBTY": p.get("zone_subty"), "SFHA_TF": p.get("sfha")})


def _result(fut: Future, what: str) -> Any:
    try:
        return fut.result()
    except Exception as e:  # noqa: BLE001 - an optional step: logged, the layer says unavailable
        log.info("flood build: %s failed: %s", what, pipeline.short_error(e))
        return None


_ = (math, SourceBusy)
