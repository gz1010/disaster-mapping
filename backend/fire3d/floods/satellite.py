"""Water seen by satellite for one flood (``SatelliteWaterResponse``, CONTRACT 16.5; PLAN-5 3.7, D6, D25, C2, C16),
shared by ``GET /api/floods/{id}/satellite`` (+ ``satellite.png``) and the bundle (``satellite.json``,
``satellite.png``, ``layers/water_satellite.bin``).

1. **Measured, no login (default):** the Earthdata GIS DSWx-HLS passes over the area in the 10 days before the time
   asked (:mod:`fire3d.sources.opera`). Up to :data:`PROBES` of the newest passes are read small to see how much of
   the area each one saw; the newest that saw at least half of it clearly is chosen, else the one that saw most.
   The chosen pass is **locked** (one granule set, so the image time is exact) and read at about 30 m.
2. **With ``EARTHDATA_TOKEN``:** also the newest DSWx-S1 (radar) and DSWx-HLS passes from PO.DAAC; a newer one replaces
   the Earthdata GIS pass. A refused login says ``SAT_LOGIN_REFUSED`` and the default route is kept.
3. **Picture only:** no usable measured pass, or Earthdata GIS down -> the GIBS daily picture (``measured: false``,
   no stats, no area). Both down -> ``SAT_UNAVAILABLE``.

The PNG (:func:`palette_rgba`): water ``#2a8ce6`` alpha .55, partial water ``#7fd4ff`` .35, snow / ice white .3, **cloud
(253) and no data (255) the same grey ``#9a9a9a`` .45 with a darker hatch ("no view"), never transparent**; not water
and ocean (254) transparent; **outside the image (the pass's tiles) transparent**, its edge drawn by the web from
``image.bounds_lonlat``. In the bundle grid, cells outside the image are 255. Stats over the whole area: water and
partial water in km², cloud and no-data shares in percent (outside the image counts as no data). Every time is
absolute (``acquired_ms``); ``SAT_CAVEAT`` carries the image's date and time in the flood's zone, never an age.
"""

from __future__ import annotations

import io
import logging
import math
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
from PIL import Image

from .. import config
from ..grid import Grid, transformer
from ..sources import opera
from ..sources.nws import SourceBusy, SourceError
from . import copy as fcopy

log = logging.getLogger(__name__)

BBox = tuple[float, float, float, float]
PROBES = 4
PROBE_PX = 160
CLEAR_ENOUGH = 0.5                  # a pass that saw at least half of the area clearly
SEEN_MIN = 0.05                     # a pass that saw less than this share of the area is not usable
IMAGE_TARGET_M = 30.0
IMAGE_MAX_PX = 1600
ROUTE_TTL_S = 1800.0
CLEAR_CLASSES = (opera.NOT_WATER, opera.OPEN_WATER, opera.PARTIAL_WATER, opera.SNOW_ICE, opera.OCEAN)

# RGBA per class (CONTRACT 16.5); the hatch is drawn over the "no view" grey
RGBA_WATER = (0x2A, 0x8C, 0xE6, 140)
RGBA_PARTIAL = (0x7F, 0xD4, 0xFF, 89)
RGBA_SNOW = (255, 255, 255, 77)
RGBA_NO_VIEW = (0x9A, 0x9A, 0x9A, 115)
RGBA_NO_VIEW_HATCH = (0x7A, 0x7A, 0x7A, 190)
HATCH_PERIOD, HATCH_WIDTH = 6, 2


# ----------------------------------------------------------------------------------------------------------------
# Palette and PNG
# ----------------------------------------------------------------------------------------------------------------
def palette_rgba(cls: np.ndarray, outside: np.ndarray | None = None) -> np.ndarray:
    """DSWx classes -> RGBA. 253 (cloud) and 255 (no data) are the same hatched grey, never transparent (D25); 0 and
    254 are transparent; ``outside`` (outside the image) is transparent."""
    h, w = cls.shape
    out = np.zeros((h, w, 4), np.uint8)
    out[cls == opera.OPEN_WATER] = RGBA_WATER
    out[cls == opera.PARTIAL_WATER] = RGBA_PARTIAL
    out[cls == opera.SNOW_ICE] = RGBA_SNOW
    noview = (cls == opera.CLOUD) | (cls == opera.NO_DATA) | ~np.isin(cls, opera.CLASSES)
    rr, cc = np.mgrid[0:h, 0:w]
    hatch = ((rr + cc) % HATCH_PERIOD) < HATCH_WIDTH
    out[noview] = RGBA_NO_VIEW
    out[noview & hatch] = RGBA_NO_VIEW_HATCH
    if outside is not None:
        out[outside] = (0, 0, 0, 0)
    return out


def png_bytes(rgba: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ----------------------------------------------------------------------------------------------------------------
# Geometry helpers
# ----------------------------------------------------------------------------------------------------------------
def _lonlat_mask(geom: Any, bbox: BBox, width: int, height: int) -> np.ndarray:
    """True where a pixel centre of the lon/lat grid lies inside ``geom``."""
    from rasterio import features
    from rasterio.transform import from_bounds

    if geom is None or geom.is_empty:
        return np.zeros((height, width), bool)
    return features.rasterize([(geom, 1)], out_shape=(height, width), transform=from_bounds(*bbox, width, height),
                              fill=0, dtype="uint8").astype(bool)


def _grid_mask(geom: Any, grid: Grid) -> np.ndarray:
    """True where a cell centre of the UTM grid lies inside the lon/lat ``geom``."""
    import shapely
    from rasterio import features

    if geom is None or geom.is_empty:
        return np.zeros(grid.shape, bool)
    t = transformer(4326, grid.epsg)
    utm = shapely.transform(geom, lambda a: np.column_stack(t.transform(a[:, 0], a[:, 1])))
    return features.rasterize([(utm, 1)], out_shape=grid.shape, transform=grid.transform, fill=0,
                              dtype="uint8").astype(bool)


def _row_area_km2(bbox: BBox, width: int, height: int) -> np.ndarray:
    """Area of one pixel in each row (km²) of a lon/lat grid over ``bbox``."""
    w, s, e, n = bbox
    lat = n - (np.arange(height) + 0.5) / height * (n - s)
    dx = (e - w) / width * 111.32 * np.cos(np.radians(lat))
    dy = (n - s) / height * 110.57
    return dx * dy


def stats_of(cls: np.ndarray, bbox: BBox) -> dict:
    """``SatelliteWaterResponse.stats`` over the whole area (``cls`` with 255 outside the image)."""
    h, w = cls.shape
    a = _row_area_km2(bbox, w, h)[:, None] * np.ones((1, w))
    total = float(a.sum()) or 1.0
    return {"area_km2": round(total, 3), "water_km2": round(float(a[cls == opera.OPEN_WATER].sum()), 3),
            "partial_km2": round(float(a[cls == opera.PARTIAL_WATER].sum()), 3),
            "cloud_pct": round(100.0 * float(a[cls == opera.CLOUD].sum()) / total, 1),
            "nodata_pct": round(100.0 * float(a[(cls == opera.NO_DATA) | ~np.isin(cls, opera.CLASSES)].sum()) / total, 1)}


def _crop(mask_inside: np.ndarray, bbox: BBox) -> tuple[slice, slice, list[float]] | None:
    """Rows and columns of the image's footprint inside the lon/lat grid, and their lon/lat bounds."""
    rows = np.flatnonzero(mask_inside.any(axis=1))
    cols = np.flatnonzero(mask_inside.any(axis=0))
    if rows.size == 0 or cols.size == 0:
        return None
    h, w = mask_inside.shape
    r0, r1, c0, c1 = int(rows[0]), int(rows[-1]) + 1, int(cols[0]), int(cols[-1]) + 1
    W, S, E, N = bbox
    dx, dy = (E - W) / w, (N - S) / h
    bounds = [round(W + c0 * dx, 6), round(N - r1 * dy, 6), round(W + c1 * dx, 6), round(N - r0 * dy, 6)]
    return slice(r0, r1), slice(c0, c1), bounds


def date_time_text(ms: int, tz: str) -> str:
    """"Oct 31, 2026, 4:06 PM MDT" in the flood's IANA zone (absolute; never an age)."""
    try:
        z = ZoneInfo(tz)
    except Exception:  # noqa: BLE001 - an unknown zone: UTC
        z = ZoneInfo("UTC")
    d = datetime.fromtimestamp(ms / 1000, tz=z)
    return f"{d.strftime('%b')} {d.day}, {d.year}, {d.strftime('%I').lstrip('0') or '12'}:{d.strftime('%M %p')} {d.strftime('%Z')}"


# ----------------------------------------------------------------------------------------------------------------
# Choosing a pass
# ----------------------------------------------------------------------------------------------------------------
@dataclass
class Chosen:
    p: opera.Pass
    clear: float
    seen: float


def _probe(p: opera.Pass, bbox: BBox) -> Chosen:
    w = PROBE_PX
    h = max(8, int(round(PROBE_PX * (bbox[3] - bbox[1]) / max(bbox[2] - bbox[0], 1e-9))))
    arr = opera.egis_export(p, bbox, w, h)
    return Chosen(p, float(np.isin(arr, CLEAR_CLASSES).mean()), float((arr != opera.NO_DATA).mean()))


def choose_egis(passes: list[opera.Pass], bbox: BBox) -> Chosen | None:
    """The newest of the first :data:`PROBES` passes that saw at least half of the area clearly, else the one that saw
    the most of it clearly; None when none saw :data:`SEEN_MIN` of it. Probe failures skip the pass."""
    seen: list[Chosen] = []
    for p in passes[:PROBES]:
        try:
            c = _probe(p, bbox)
        except SourceBusy:
            raise
        except SourceError as e:
            log.info("satellite probe %s: %s", p.key, e)
            continue
        if c.seen < SEEN_MIN:
            continue
        if c.clear >= CLEAR_ENOUGH:
            return c
        seen.append(c)
    return max(seen, key=lambda c: (c.clear, c.p.acquired_ms)) if seen else None


def _podaac_newest(bbox: BBox, end_ms: int, after_ms: int) -> tuple[opera.Pass | None, list[opera.Granule]]:
    """The newest PO.DAAC pass (DSWx-S1 or DSWx-HLS) over ``bbox`` sensed after ``after_ms``. Raises SourceError."""
    grans: list[opera.Granule] = []
    for short in (opera.S1_SHORT_NAME, opera.HLS_SHORT_NAME):
        try:
            got, _ = opera.cmr_granules(short, bbox, end_ms)
            grans += got
        except SourceBusy:
            raise
        except SourceError as e:
            log.info("CMR %s: %s", short, e)
    passes = [p for p in opera.group_passes(grans) if p.acquired_ms > after_ms]
    return (passes[0] if passes else None), grans


# ----------------------------------------------------------------------------------------------------------------
# The answer
# ----------------------------------------------------------------------------------------------------------------
@dataclass
class SatResult:
    answer: dict                      # SatelliteWaterResponse
    png: bytes | None                 # the image (outside the footprint transparent)
    grid_classes: np.ndarray | None   # classes on the bundle grid (255 outside the image), when a grid was given
    key: str | None                   # the pass key in image.url


def _source(product: str, route: str) -> dict:
    base = dict(fcopy.SOURCE_OPERA_HLS)
    if product == "DSWx-S1":
        base.update(name="NASA JPL OPERA DSWx-S1 (water seen by radar satellite)", credit=fcopy.CREDIT_OPERA_S1,
                    url="https://podaac.jpl.nasa.gov/OPERA")
    via = {"earthdata_gis": " via NASA Earthdata GIS", "gibs": " via NASA GIBS", "podaac": ""}[route]
    base["credit"] = base["credit"] + via
    return base


def _base(flood_id: str | None, now: int, login: str) -> dict:
    return {"kind": "satellite_water", "status": "available", "reason_code": None, "reason": None, "login": login,
            "login_note": {"not_configured": fcopy.SAT_NOT_SET_UP, "refused": fcopy.SAT_LOGIN_REFUSED}.get(login),
            "measured": False, "granules": [], "image": None, "tiles": None, "stats": None,
            "source": _source("DSWx-HLS", "earthdata_gis"), "retrieved_ms": None, "now_ms": now, "flood_id": flood_id,
            "synthetic": False, "caveats": []}


def _granule_out(g: opera.Granule, cloud_pct: float | None) -> dict:
    return {"id": g.id, "product": g.product, "platform": g.platform, "acquired_ms": int(g.acquired_ms),
            "produced_ms": g.produced_ms, "cloud_pct": cloud_pct if g.product == "DSWx-HLS" else None,
            "route": g.route, "url": g.page_url}


def _read(p: opera.Pass, bounds: BBox, crs_epsg: int, width: int, height: int) -> np.ndarray:
    if p.route == "podaac":
        return opera.podaac_pass(p, bounds, f"EPSG:{crs_epsg}", width, height)
    return opera.egis_export(p, bounds, width, height, sr=crs_epsg)


def flood_satellite(flood_id: str | None, bbox: BBox, *, now: int, time_zone: str, at_ms: int | None = None,
                    grid: Grid | None = None) -> SatResult:
    """The satellite water answer for an area (never raises for an upstream failure; Fire-3d's own limit raises
    SourceBusy)."""
    ref = min(int(at_ms), now) if at_ms is not None else now
    login = opera.login_state()
    out = _base(flood_id, now, login)
    if ref < opera.EGIS_ARCHIVE_START_MS:
        out.update(status="not_available_for_past_dates", reason_code="before_archive", reason=fcopy.SAT_BEFORE_ARCHIVE)
        return SatResult(out, None, None, None)
    chosen: opera.Pass | None = None
    clear: float | None = None
    egis_ok = True
    try:
        grans, fetched = opera.egis_granules(bbox, ref, now_ms=now)
        out["retrieved_ms"] = fetched
        c = choose_egis(opera.group_passes(grans), bbox)
        if c is not None:
            chosen, clear = c.p, c.clear
    except SourceBusy:
        raise
    except SourceError as e:
        log.info("Earthdata GIS: %s", e)
        egis_ok = False
    if login == "configured":
        try:
            newer, _ = _podaac_newest(bbox, ref, chosen.acquired_ms if chosen else ref - opera.SEARCH_DAYS * 86_400_000)
            if newer is not None:
                chosen, clear = newer, None
        except opera.LoginRefused:
            login = "refused"
        except SourceBusy:
            raise
        except SourceError as e:
            log.info("PO.DAAC search: %s", e)
    if chosen is not None:
        try:
            return _measured(out, chosen, bbox, now=now, time_zone=time_zone, grid=grid, flood_id=flood_id)
        except opera.LoginRefused:
            login = "refused"
            out.update(login="refused", login_note=fcopy.SAT_LOGIN_REFUSED)
            if chosen.route == "podaac" and egis_ok:     # the radar file was refused: keep the default route
                try:
                    grans, _ = opera.egis_granules(bbox, ref, now_ms=now)
                    c = choose_egis(opera.group_passes(grans), bbox)
                    if c is not None:
                        return _measured(out, c.p, bbox, now=now, time_zone=time_zone, grid=grid, flood_id=flood_id)
                except SourceError as e:
                    log.info("Earthdata GIS after a refused login: %s", e)
        except SourceBusy:
            raise
        except SourceError as e:
            log.info("satellite image: %s", e)
            egis_ok = False
    if login == "refused":
        out.update(login="refused", login_note=fcopy.SAT_LOGIN_REFUSED)
    return _picture(out, ref, no_image=egis_ok)


def _measured(out: dict, p: opera.Pass, bbox: BBox, *, now: int, time_zone: str, grid: Grid | None,
              flood_id: str | None) -> SatResult:
    w, h = opera.px_size(bbox, IMAGE_TARGET_M, IMAGE_MAX_PX)
    cls = _read(p, bbox, 4326, w, h)
    fp = p.footprint()
    inside = _lonlat_mask(fp, bbox, w, h) if fp is not None else np.ones((h, w), bool)
    cls = np.where(inside, cls, opera.NO_DATA).astype(np.uint8)
    stats = stats_of(cls, bbox)
    crop = _crop(inside, bbox)
    png = None
    image = None
    if crop is not None:
        rs, cs, bounds = crop
        png = png_bytes(palette_rgba(cls[rs, cs], ~inside[rs, cs]))
        url = f"/api/floods/{flood_id}/satellite.png?granule={p.key}" if flood_id else None
        image = {"url": url, "bounds_lonlat": bounds} if url else None
    grid_cls = None
    if grid is not None:
        g = _read(p, tuple(grid.bounds), grid.epsg, grid.width, grid.height)
        if fp is not None:
            g = np.where(_grid_mask(fp, grid), g, opera.NO_DATA)
        grid_cls = g.astype(np.uint8)
    cloud = stats["cloud_pct"]
    out.update(status="available", reason_code=None, reason=None, measured=True,
               granules=[_granule_out(g, cloud) for g in p.granules], image=image, tiles=None, stats=stats,
               source=_source(p.product, p.route), retrieved_ms=out.get("retrieved_ms") or now,
               caveats=[fcopy.sat_caveat(date_time_text(p.acquired_ms, time_zone), cloud if p.product == "DSWx-HLS" else None)])
    return SatResult(out, png, grid_cls, p.key)


def _picture(out: dict, ref: int, *, no_image: bool) -> SatResult:
    try:
        date, fetched = opera.gibs_latest(ref)
    except SourceBusy:
        raise
    except SourceError as e:
        log.info("GIBS: %s", e)
        out.update(status="unavailable", reason_code="upstream_error", reason=fcopy.SAT_UNAVAILABLE, measured=False)
        return SatResult(out, None, None, None)
    if date is None:
        out.update(status="unavailable", reason_code="no_image", reason=fcopy.SAT_NO_IMAGE, measured=False)
        return SatResult(out, None, None, None)
    out.update(status="available", measured=False, reason_code="no_image" if no_image else "upstream_error",
               reason=fcopy.SAT_NO_IMAGE if no_image else None, retrieved_ms=fetched,
               tiles={"url_template": opera.gibs_template(opera.GIBS_HLS_LAYER, date), "date": date,
                      "max_zoom": opera.GIBS_MAX_ZOOM},
               source=_source("DSWx-HLS", "gibs"),
               caveats=[fcopy.sat_caveat(_date_text(date), None)])
    return SatResult(out, None, None, None)


def _date_text(date: str) -> str:
    d = datetime.strptime(date, "%Y-%m-%d")
    return f"{d.strftime('%b')} {d.day}, {d.year}"


# ----------------------------------------------------------------------------------------------------------------
# Route cache (the 2D views): answers for 30 min in memory, PNGs on disk
# ----------------------------------------------------------------------------------------------------------------
_lock = threading.Lock()
_cache: dict[tuple, tuple[float, SatResult]] = {}


def png_dir(flood_id: str) -> Path:
    return Path(config.CACHE_DIR) / "floods" / "satellite" / flood_id


def cached_answer(flood_id: str, bbox: BBox, *, now: int, time_zone: str, at_ms: int | None = None) -> SatResult:
    """:func:`flood_satellite` for the routes, kept :data:`ROUTE_TTL_S`; the PNG is written to :func:`png_dir`."""
    key = (flood_id, tuple(round(v, 4) for v in bbox), None if at_ms is None else int(at_ms) // 3_600_000)
    with _lock:
        hit = _cache.get(key)
        if hit is not None and time.monotonic() - hit[0] < ROUTE_TTL_S:
            return hit[1]
    res = flood_satellite(flood_id, bbox, now=now, time_zone=time_zone, at_ms=at_ms)
    if res.png is not None and res.key:
        d = png_dir(flood_id)
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / f".{res.key}.png.tmp"
        tmp.write_bytes(res.png)
        tmp.replace(d / f"{res.key}.png")
    with _lock:
        _cache[key] = (time.monotonic(), res)
    return res


def reset_state() -> None:
    with _lock:
        _cache.clear()


_ = (math,)
