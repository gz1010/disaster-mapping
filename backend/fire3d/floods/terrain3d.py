"""3D terrain products of a flood bundle (brief 6, decision 3; ``FloodManifest.terrain3d``; SPEC 5.4).

Forensic's flood view on flat ground showed little: the terrain looked flat and the affected areas were hard to see.
Three products, all on the bundle's 1024² render grid, numpy / scipy only:

1. **Relief and the height boost** (:func:`relief`): the 5th-95th percentile of the ground heights within
   :data:`RELIEF_BUFFER_M` of the mapped water (satellite water and the NWS forecast flooded area; the whole grid when
   there is none, or when the ground within :data:`RELIEF_BUFFER_M` of it covers under :data:`RELIEF_MIN_FRAC` of the
   grid). The suggested boost is the smallest of :data:`NICE_FACTORS` that makes that range span
   :data:`TARGET_RELIEF_RATIO` of the area's width (``copy_time.RELIEF_RULE``), at most ×10: hills get ×1.5, and a
   flat floodplain gets ×10 without reaching the target (``FloodRelief.target_reached`` false; review BTD-R4).
2. **Height above the river (HAND, simplified)** (:func:`hand`): NOAA National Water Model river lines are drawn on the
   grid (stream order :data:`HAND_MIN_ORDER` and up, or the largest order present when the area has none that big);
   each channel cell takes the lowest terrain height within one cell of it (the lines are not always on the channel
   bottom); every cell takes the height of its nearest channel cell in a straight line (``distance_transform_edt``)
   and its height above it is kept (below counts as 0). Cells more than :data:`HAND_MAX_DIST_M` from a channel have no
   value. Limits (in ``HAND_METHOD``): HAND proper (Nobre et al. 2011) follows the downhill flow path; near a ridge a
   cell can be measured against the next valley; levees and culverts are not known. It is not a flood map.
3. **Depth estimate (FwDET)** (:func:`fwdet`; Cohen et al. 2018, 2019) for each mapped water layer: the water cells
   next to open ground are the water's edge (cells next to clouds, no data, ocean, snow or the grid border are not:
   FwDET v2.0's boundary rule); every water cell takes the terrain height of its nearest edge cell as the water
   surface; depth = surface − terrain, below 0 counts as 0; a 3 × 3 average over the water smooths it. Only cells
   inside the mapped water get a value.

Rasters are uint8 (:data:`SCALE_M` = 0.1 m per step; :data:`TOP_CODE` 254 = 25.4 m or more; :data:`NODATA` 255 = no
value), 1 MB each, so the bundle stays small (``FloodTerrain3d.scale_m``, ``top_code``, ``nodata``).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

from ..grid import Grid, transformer
from ..sources import opera
from . import copy_time as tcopy
from .satellite import date_time_text

log = logging.getLogger(__name__)

SCALE_M = 0.1
TOP_CODE = 254
NODATA = 255
NICE_FACTORS = (1.5, 2.0, 3.0, 5.0, 8.0, 10.0)
TARGET_RELIEF_RATIO = 0.02
RELIEF_BUFFER_M = 2000.0
RELIEF_MIN_FRAC = 0.01                # the ground within RELIEF_BUFFER_M of the water needs at least this share of the
                                      # grid, else the whole grid is measured
HAND_MIN_ORDER = 3
HAND_MAX_DIST_M = 10000.0             # a hard cut-off: 5 km drew visible circles on flat coastal plains
SMOOTH_CELLS = 3
SAT_WATER = (opera.OPEN_WATER, opera.PARTIAL_WATER)
SAT_OPEN_GROUND = (opera.NOT_WATER,)


# ----------------------------------------------------------------------------------------------------------------
# Encoding and statistics
# ----------------------------------------------------------------------------------------------------------------
def encode(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Metres -> uint8 steps of :data:`SCALE_M` (0..253 exact, :data:`TOP_CODE` = 25.4 m or more), :data:`NODATA`
    where ``valid`` is False or the value is not finite."""
    v = np.asarray(values, dtype=np.float64)
    ok = valid & np.isfinite(v)
    code = np.clip(np.rint(np.where(ok, v, 0.0) / SCALE_M), 0, TOP_CODE).astype(np.uint8)
    code[~ok] = NODATA
    return code


def decode(code: np.ndarray) -> np.ndarray:
    """uint8 codes -> metres (NaN for :data:`NODATA`)."""
    out = code.astype(np.float32) * SCALE_M
    out[code == NODATA] = np.nan
    return out


def stats(values_m: np.ndarray, valid: np.ndarray, res_m: float) -> dict | None:
    v = values_m[valid & np.isfinite(values_m)]
    if v.size == 0:
        return None
    return {"cells": int(v.size), "area_km2": round(float(v.size) * (res_m / 1000.0) ** 2, 3),
            "p50_m": round(float(np.percentile(v, 50)), 2), "p90_m": round(float(np.percentile(v, 90)), 2),
            "max_m": round(float(v.max()), 2)}


# ----------------------------------------------------------------------------------------------------------------
# 1. Relief and the height boost
# ----------------------------------------------------------------------------------------------------------------
def boost_factor(range_m: float, width_m: float) -> float:
    """The smallest of :data:`NICE_FACTORS` with ``factor * range_m >= TARGET_RELIEF_RATIO * width_m`` (the largest
    when none is enough); ×1.5 when the ground is already steep enough."""
    need = TARGET_RELIEF_RATIO * float(width_m)
    for f in NICE_FACTORS:
        if f * max(float(range_m), 0.0) >= need:
            return f
    return NICE_FACTORS[-1]


def relief(dem: np.ndarray, res_m: float, width_m: float, water: np.ndarray | None) -> dict | None:
    """``FloodRelief``: percentiles of the ground near the mapped water (or the whole grid) and the boost."""
    finite = np.isfinite(dem)
    if not finite.any():
        return None
    area = "grid"
    sel = finite
    if water is not None and water.any():
        near = ndimage.distance_transform_edt(~water, sampling=res_m) <= RELIEF_BUFFER_M
        if (near & finite).mean() >= RELIEF_MIN_FRAC:
            area, sel = "water", near & finite
    v = dem[sel].astype(np.float64)
    p05, p95 = (float(x) for x in np.percentile(v, [5, 95]))
    rng = max(0.0, p95 - p05)
    note = tcopy.RELIEF_AREA_WATER.format(km=f"{RELIEF_BUFFER_M / 1000:g}") if area == "water" else tcopy.RELIEF_AREA_GRID
    f = boost_factor(rng, width_m)
    return {"area": area, "area_note": note, "cells": int(v.size), "min_m": round(float(v.min()), 2),
            "max_m": round(float(v.max()), 2), "p05_m": round(p05, 2), "p95_m": round(p95, 2), "range_m": round(rng, 2),
            "width_m": round(float(width_m), 1), "exaggeration": f, "rule": tcopy.RELIEF_RULE,
            "target_reached": bool(f * rng >= TARGET_RELIEF_RATIO * float(width_m))}


# ----------------------------------------------------------------------------------------------------------------
# 2. Height above the river (HAND, simplified)
# ----------------------------------------------------------------------------------------------------------------
def channel_order(features: list[dict]) -> int | None:
    """The stream order used: :data:`HAND_MIN_ORDER`, or the largest order present when none is that big."""
    orders = [int(o) for f in features if (o := (f.get("properties") or {}).get("strm_order")) is not None]
    if not orders:
        return 1 if features else None
    return min(HAND_MIN_ORDER, max(orders))


def rasterize_lines(features: list[dict], grid: Grid, min_order: int) -> np.ndarray:
    """True on the grid cells the river lines of order ``min_order`` and up pass through (all touched)."""
    import shapely
    from rasterio import features as rfeatures
    from shapely.geometry import shape

    t = transformer(4326, grid.epsg)
    shapes = []
    for f in features:
        o = (f.get("properties") or {}).get("strm_order")
        if o is not None and int(o) < min_order:
            continue
        g = f.get("geometry")
        if not g or g.get("type") not in ("LineString", "MultiLineString"):
            continue
        try:
            geom = shape(g)
        except (ValueError, TypeError, AttributeError):
            continue
        if geom.is_empty:
            continue
        shapes.append((shapely.transform(geom, lambda a: np.column_stack(t.transform(a[:, 0], a[:, 1]))), 1))
    if not shapes:
        return np.zeros(grid.shape, bool)
    return rfeatures.rasterize(shapes, out_shape=grid.shape, transform=grid.transform, fill=0, all_touched=True,
                               dtype="uint8").astype(bool)


def hand(dem: np.ndarray, res_m: float, channel: np.ndarray, *, max_dist_m: float = HAND_MAX_DIST_M
         ) -> tuple[np.ndarray, np.ndarray]:
    """(height above the nearest channel cell in m, valid mask). ``channel``: True on channel cells."""
    finite = np.isfinite(dem)
    filled = np.where(finite, dem, np.nanmax(dem) if finite.any() else 0.0).astype(np.float64)
    bottom = ndimage.minimum_filter(filled, size=3, mode="nearest")          # the channel's lowest nearby ground
    ch = channel & finite
    if not ch.any():
        return np.full(dem.shape, np.nan, np.float32), np.zeros(dem.shape, bool)
    dist, idx = ndimage.distance_transform_edt(~ch, sampling=res_m, return_indices=True)
    h = filled - bottom[idx[0], idx[1]]
    h = np.maximum(h, 0.0)
    valid = finite & (dist <= max_dist_m)
    return h.astype(np.float32), valid


# ----------------------------------------------------------------------------------------------------------------
# 3. Depth estimate (FwDET)
# ----------------------------------------------------------------------------------------------------------------
def water_edge(water: np.ndarray, open_ground: np.ndarray) -> np.ndarray:
    """Water cells with a 4-neighbour of open ground (the grid border is never open ground)."""
    og = np.pad(open_ground, 1, constant_values=False)
    near = og[:-2, 1:-1] | og[2:, 1:-1] | og[1:-1, :-2] | og[1:-1, 2:]
    return water & near


def fwdet(dem: np.ndarray, water: np.ndarray, open_ground: np.ndarray, *, smooth: int = SMOOTH_CELLS
          ) -> tuple[np.ndarray, np.ndarray] | None:
    """(depth in m, valid mask = the mapped water), or None when the water has no edge on open ground."""
    finite = np.isfinite(dem)
    wat = water & finite
    edge = water_edge(wat, open_ground & finite)
    if not edge.any():
        return None
    _, idx = ndimage.distance_transform_edt(~edge, return_indices=True)
    surface = dem[idx[0], idx[1]].astype(np.float64)
    depth = np.where(wat, np.maximum(surface - dem, 0.0), 0.0)
    if smooth and smooth > 1:
        w = wat.astype(np.float64)
        num = ndimage.uniform_filter(depth * w, size=smooth, mode="constant")
        den = ndimage.uniform_filter(w, size=smooth, mode="constant")
        depth = np.where(wat, num / np.maximum(den, 1e-9), 0.0)
    return depth.astype(np.float32), wat


# ----------------------------------------------------------------------------------------------------------------
# The manifest entry and rasters
# ----------------------------------------------------------------------------------------------------------------
@dataclass
class WaterLayer:
    """One mapped water layer of the bundle, as its source raster and own time."""

    key: str                          # "satellite" | "forecast"
    raster: np.ndarray | None         # the bundle layer (DSWx classes, or 0/255)
    time_ms: int | None
    reason: str | None = None         # why the layer is missing


@dataclass
class Terrain3dResult:
    entry: dict                                   # FloodTerrain3d
    rasters: dict[str, np.ndarray] = field(default_factory=dict)   # layer name -> uint8
    descriptions: dict[str, str] = field(default_factory=dict)


def _product(key: str, kind: str, *, status: str, reason: str | None, source_layer: str | None, source: str,
             time_ms: int | None, layer: str | None = None, st: dict | None = None) -> dict:
    hand_ = kind == "hand"
    return {"key": key, "kind": kind, "layer": layer, "status": status, "reason": reason,
            "label": tcopy.HAND_LABEL if hand_ else tcopy.DEPTH_LABEL,
            "caveat": tcopy.HAND_CAVEAT if hand_ else tcopy.DEPTH_CAVEAT,
            "method": tcopy.HAND_METHOD.format(order=HAND_MIN_ORDER, km=f"{HAND_MAX_DIST_M / 1000:g}") if hand_
            else tcopy.DEPTH_METHOD,
            "citation": tcopy.HAND_CITATION if hand_ else tcopy.DEPTH_CITATION, "source_layer": source_layer,
            "source": source, "time_ms": time_ms, "stats": st}


def _masks(layer: WaterLayer) -> tuple[np.ndarray, np.ndarray]:
    """(water, open ground) of a water layer."""
    r = layer.raster
    if layer.key == "satellite":
        return np.isin(r, SAT_WATER), np.isin(r, SAT_OPEN_GROUND)
    return r == 255, r == 0


def products(dem: np.ndarray, grid: Grid, *, water: list[WaterLayer], flowlines: list[dict] | None,
             flowlines_reason: str | None, time_zone: str, now: int) -> Terrain3dResult:
    """Every 3D terrain product of one bundle (never raises for missing inputs: each product says why)."""
    res = Terrain3dResult({})
    t0 = time.monotonic()
    width = float(grid.extent_m)
    masks = {w.key: _masks(w) for w in water if w.raster is not None}
    union = None
    for wm, _ in masks.values():
        union = wm if union is None else (union | wm)
    rel = relief(dem, grid.res_m, width, union)

    # HAND
    hand_src = tcopy.HAND_SOURCE
    if flowlines is None:
        hp = _product("hand", "hand", status="unavailable", reason=flowlines_reason or tcopy.HAND_NO_LINES,
                      source_layer="elevation", source=hand_src, time_ms=None)
    else:
        order = channel_order(flowlines)
        channel = rasterize_lines(flowlines, grid, order) if order is not None else np.zeros(grid.shape, bool)
        if not channel.any():
            hp = _product("hand", "hand", status="not_covered", reason=tcopy.HAND_NO_CHANNEL, source_layer="elevation",
                          source=hand_src, time_ms=None)
        else:
            h, valid = hand(dem, grid.res_m, channel)
            res.rasters["hand"] = encode(h, valid)
            res.descriptions["hand"] = tcopy.DESC_HAND.format(order=order)
            hp = _product("hand", "hand", status="ok", reason=None, source_layer="elevation", source=hand_src,
                          time_ms=None, layer="hand", st=stats(h, valid, grid.res_m))
            hp["method"] = tcopy.HAND_METHOD.format(order=order, km=f"{HAND_MAX_DIST_M / 1000:g}")

    # depth per mapped water layer
    depth_out = []
    for w in water:
        key = f"depth_{w.key}"
        layer_name = "water_satellite" if w.key == "satellite" else "water_forecast"
        tmpl = tcopy.DEPTH_SOURCE_SATELLITE if w.key == "satellite" else tcopy.DEPTH_SOURCE_FORECAST
        source = tmpl.format(date_time=date_time_text(w.time_ms, time_zone) if w.time_ms else tcopy.TIME_NOT_STATED)
        if w.raster is None:
            depth_out.append(_product(key, "depth", status="unavailable", reason=w.reason or tcopy.DEPTH_NO_LAYER,
                                      source_layer=layer_name, source=source, time_ms=w.time_ms))
            continue
        wm, og = masks[w.key]
        if not wm.any():
            depth_out.append(_product(key, "depth", status="not_covered", reason=tcopy.DEPTH_NO_WATER,
                                      source_layer=layer_name, source=source, time_ms=w.time_ms))
            continue
        got = fwdet(dem, wm, og)
        if got is None:
            depth_out.append(_product(key, "depth", status="not_covered", reason=tcopy.DEPTH_NO_EDGE,
                                      source_layer=layer_name, source=source, time_ms=w.time_ms))
            continue
        d, valid = got
        res.rasters[key] = encode(d, valid)
        res.descriptions[key] = tcopy.DESC_DEPTH.format(layer=layer_name)
        depth_out.append(_product(key, "depth", status="ok", reason=None, source_layer=layer_name, source=source,
                                  time_ms=w.time_ms, layer=key, st=stats(d, valid, grid.res_m)))
    res.entry = {"version": 1, "relief": rel, "hand": hp, "depth": depth_out, "scale_m": SCALE_M, "top_code": TOP_CODE,
                 "nodata": NODATA, "built_ms": int(now)}
    log.info("terrain3d: %.1f s", time.monotonic() - t0)
    return res


def water_layers_of(sat: np.ndarray | None, sat_time: int | None, sat_reason: str | None, fc: np.ndarray | None,
                    fc_time: int | None, fc_reason: str | None) -> list[WaterLayer]:
    """The two mapped water layers in their order (satellite first)."""
    return [WaterLayer("satellite", sat, sat_time, sat_reason), WaterLayer("forecast", fc, fc_time, fc_reason)]


def pass_depth(dem: np.ndarray, classes: np.ndarray) -> np.ndarray | None:
    """The FwDET depth (uint8, :data:`SCALE_M` steps, :data:`NODATA` outside the water) of one satellite pass's
    classes on the render grid, or None when it maps no water or the water has no edge on open ground (review
    BTD-R3: each pass Forensic steps through has its own depth surface)."""
    wm, og = np.isin(classes, SAT_WATER), np.isin(classes, SAT_OPEN_GROUND)
    if not wm.any():
        return None
    got = fwdet(dem, wm, og)
    if got is None:
        return None
    return encode(*got)


# ----------------------------------------------------------------------------------------------------------------
# A bundle on disk: (re)make the products from its own files
# ----------------------------------------------------------------------------------------------------------------
def _bundle_layer(bdir, m: dict, name: str, grid: Grid, dtype) -> np.ndarray | None:
    info = (m.get("layers") or {}).get(name)
    if not info:
        return None
    try:
        return np.fromfile(bdir / info["file"], dtype).reshape(grid.shape)
    except (OSError, ValueError):
        return None


def bundle_flowlines(bdir, m: dict) -> list[dict] | None:
    """The river lines kept in the bundle (``maps/flowlines.geojson``), or None."""
    import orjson

    rel = ((m.get("files") or {}).get("maps") or {}).get("flowlines")
    if not rel:
        return None
    try:
        return list(orjson.loads((bdir / rel).read_bytes()).get("features") or [])
    except (OSError, orjson.JSONDecodeError):
        return None


def apply_to_bundle(bdir, m: dict, grid: Grid, *, flowlines: list[dict] | None, flow_reason: str | None,
                    now: int) -> dict:
    """Make every 3D terrain product of a bundle from its own files (elevation, ``water_satellite``,
    ``water_forecast``) and ``flowlines``; write the rasters and set ``layers`` and ``terrain3d`` in ``m`` (in place;
    returned). Used by ``scripts/flood_3d.py`` and after a refresh put earlier water layers back
    (:func:`after_refresh`)."""
    from .. import bundle

    dem = _bundle_layer(bdir, m, "elevation", grid, np.float32)
    if dem is None:
        raise ValueError(f"{getattr(bdir, 'name', bdir)}: no elevation layer")
    ls = m.get("layer_status") or {}
    sat_st, fc_st = ls.get("water_satellite") or {}, ls.get("water_forecast") or {}
    water = water_layers_of(
        _bundle_layer(bdir, m, "water_satellite", grid, np.uint8) if sat_st.get("status") == "ok" else None,
        sat_st.get("time_ms"), sat_st.get("reason"),
        _bundle_layer(bdir, m, "water_forecast", grid, np.uint8) if fc_st.get("status") == "ok" else None,
        fc_st.get("time_ms"), fc_st.get("reason"))
    tz = (m.get("summary") or {}).get("time_zone") or "UTC"
    res = products(dem, grid, water=water, flowlines=flowlines, flowlines_reason=flow_reason, time_zone=tz, now=now)
    layers = m.setdefault("layers", {})
    for name in ("hand", "depth_satellite", "depth_forecast"):
        if layers.pop(name, None) is not None and name not in res.rasters:
            (bdir / "layers" / f"{name}.bin").unlink(missing_ok=True)
    for name, arr in res.rasters.items():
        layers[name] = bundle.write_layer(bdir, name, arr, "render", "0.1 m", res.descriptions[name], nodata=NODATA,
                                          register=False)
    m["terrain3d"] = res.entry
    return m


def after_refresh(bdir, m: dict, kept: list[str], *, now: int) -> bool:
    """After a refresh put an earlier water layer back (``live.keep_what_the_rebuild_lost``: ``water_satellite`` or
    ``water_forecast``), make the 3D terrain products again from the layers now in the bundle, so a depth estimate
    always belongs to the water layer shown (review BTD-R2). ``m`` is changed in place. False when nothing was done
    or the products could not be made (the rebuild's ``terrain3d`` then stays)."""
    from ..grid import grids_from_manifest

    if not ({"water_satellite", "water_forecast"} & set(kept)):
        return False
    try:
        grid, _ = grids_from_manifest(m)
        fl = bundle_flowlines(bdir, m)
        apply_to_bundle(bdir, m, grid, flowlines=fl, flow_reason=None if fl is not None else tcopy.HAND_NO_LINES,
                        now=now)
    except Exception as e:  # noqa: BLE001 - optional products: the rebuild's entry stays
        log.warning("terrain3d after refresh: %s", type(e).__name__)
        return False
    return True

