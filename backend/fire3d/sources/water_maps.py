"""NOAA water map services for floods (brief 5; PLAN-5 2, 3.3, 3.8; CONTRACT 16.4, 16.6).

All on ``maps.water.noaa.gov/server/rest/services`` (ArcGIS 11; GeoJSON queries by envelope, simplified with
``maxAllowableOffset`` 0.0002 deg (about 20 m) and ``geometryPrecision`` 5, paged by ``resultOffset`` ordered by the
layers' ``oid``; current only, no history):

* **NWS forecast flooded area** (official source, NWS calls it experimental): ``rfc/rfc_based_5day_max_inundation_extent``
  layer 0 polygons (one per National Water Model reach, ``feature_id``) and layer 3 river lines ("Max Flood Status
  Forecast - Action + Only": ``feature_id``, ``nws_station_id``, ``influential_forecasts``). :func:`member_reaches`
  ties reaches to a flood's member gauges (the reach's own station, or the forecast point that drives it, named in
  ``influential_forecasts`` as "at AGYM7 (2529595 [order 5]) 0.0 miles upstream"), so the area figure
  (:func:`member_area_km2`) sums only those reaches' polygons, never a crop of everything in the box (C6); None when
  the join fails. Cached 15 min.
* **NWS category flood maps** (experimental static library): ``fim_libs/static_stage_based_catfim`` threshold layers
  (action 3, minor 6, moderate 9, major 12, record 13) for one gauge (``ahps_lid`` lower case). Cached 30 days.
* **National Water Model** (**model output**, never official; kept apart by the routes): ``nwm/ana_inundation_extent``
  layer 0 (analysis flooded area, hourly), ``nwm/mrf_gfs_5day_max_inundation_extent`` layer 0 (5-day, every 6 h) and
  ``nwm/ana_high_flow_magnitude`` layer 0 (reaches above their high-water threshold, ``recur_cat`` = an annual
  exceedance probability in percent, ``">50"`` = above the high-water threshold but more likely than 1 in 2; verbatim).
* **River lines**: ``reference/static_nwm_flowlines`` layer 0. Cached 30 days.

Every request goes through :mod:`fire3d.http` (disk cache, retries) behind :data:`NOAA_WATER_LIMITER`; a failed host is
remembered for 60 s (:data:`MAPS_DOWN`). Times: ``reference_time`` is UTC without a zone ("2026-11-04 22:00:00");
``update_time`` ends in " UTC". Credits are in :mod:`fire3d.floods.copy` (16.15). Errors raise ``nws.SourceError``
(``SourceBusy`` when Disaster Mapping's own limit is reached) with secret-free, user-facing text.
"""

from __future__ import annotations

import logging
import math
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

import shapely
from shapely.geometry import shape

from .. import config
from .. import http as fhttp
from .nws import SourceBusy, SourceError

log = logging.getLogger(__name__)

BBox = tuple[float, float, float, float]

MAPS_ROOT = "https://maps.water.noaa.gov/server/rest/services"
MAPS_HOST = "maps.water.noaa.gov"
RFC_FIM = f"{MAPS_ROOT}/rfc/rfc_based_5day_max_inundation_extent/MapServer"
CATFIM = f"{MAPS_ROOT}/fim_libs/static_stage_based_catfim/MapServer"
NWM_ANALYSIS = f"{MAPS_ROOT}/nwm/ana_inundation_extent/MapServer"
NWM_5DAY = f"{MAPS_ROOT}/nwm/mrf_gfs_5day_max_inundation_extent/MapServer"
NWM_HIGH_FLOW = f"{MAPS_ROOT}/nwm/ana_high_flow_magnitude/MapServer"
FLOWLINES = f"{MAPS_ROOT}/reference/static_nwm_flowlines/MapServer"

RFC_FIM_POLYGONS, RFC_FIM_REACHES = 0, 3
CATFIM_LAYERS = {"action": 3, "minor": 6, "moderate": 9, "major": 12, "record": 13}
NWM_LAYERS = {"nwm_analysis": (NWM_ANALYSIS, 0), "nwm_5day": (NWM_5DAY, 0), "nwm_high_flow": (NWM_HIGH_FLOW, 0)}

SIMPLIFY_DEG = 0.0002            # about 20 m (sources.md 3.1: 3.9 MB -> 0.52 MB for a 0.5 deg box)
PRECISION = 5
PAGE_SIZE = 2000                 # the services' maxRecordCount
MAX_PAGES = 10
TIMEOUT_S = 30.0
RETRIES = 1
RFC_FIM_TTL_S = 900.0
CATFIM_TTL_S = 30 * 86400.0
NWM_ANALYSIS_TTL_S = 3600.0
NWM_5DAY_TTL_S = 6 * 3600.0
FLOWLINES_TTL_S = 30 * 86400.0
NWM_TTL_S = {"nwm_analysis": NWM_ANALYSIS_TTL_S, "nwm_5day": NWM_5DAY_TTL_S, "nwm_high_flow": NWM_ANALYSIS_TTL_S}

NOAA_WATER_LIMITER = fhttp.RateLimiter(30, 60.0, "floods: NOAA water map services")
MAPS_DOWN = fhttp.DownMemo("floods: NOAA water map services")
_NAME = "NOAA's water map service"

# "Action (3.7 ft) issued 2026-11-04 19:50:00+00 at NSBT2 (1114345 [order 6]) 4.0 miles upstream"
_INFLUENTIAL_RE = re.compile(r"\bat\s+([A-Z0-9]{5})\b")


# ----------------------------------------------------------------------------------------------------------------
# Small parsers
# ----------------------------------------------------------------------------------------------------------------
def esri_time_ms(v: Any) -> int | None:
    """An ArcGIS time: epoch ms (date fields), or a UTC string ("2026-11-04 22:00:00", "... UTC",
    "2026-11-04 19:50:00+00"); None when missing."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v) if v > 0 and math.isfinite(v) else None
    s = str(v).strip()
    if not s:
        return None
    if s.lstrip("-").isdigit():
        n = int(s)
        return n if n > 0 else None
    s = re.sub(r"\s*UTC$", "", s).replace("T", " ")
    s = re.sub(r"([+-]\d\d)$", r"\1:00", s)
    for fmt in ("%Y-%m-%d %H:%M:%S%z", "%Y-%m-%d %H:%M:%S.%f%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f",
                "%Y-%m-%d %H:%M%z", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s, fmt)
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    return None


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) and x > -9998 else None


def _text(v: Any) -> str | None:
    if v is None or isinstance(v, (dict, list)):
        return None
    s = str(v).strip()
    return s or None


def _fid(v: Any) -> str | None:
    """A reach ``feature_id`` as a string ("2529595"); numbers and strings alike."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else None
    s = str(v).strip()
    return s if s.isdigit() else None


def envelope(bbox: BBox) -> dict[str, str]:
    w, s, e, n = (float(x) for x in bbox)
    return {"geometry": f"{w:.5f},{s:.5f},{e:.5f},{n:.5f}", "geometryType": "esriGeometryEnvelope", "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects"}


def query_params(bbox: BBox, *, where: str = "1=1", out_fields: str = "*", geometry: bool = True,
                 simplify_deg: float | None = SIMPLIFY_DEG) -> dict[str, str]:
    p = {**envelope(bbox), "where": where, "outFields": out_fields, "returnGeometry": "true" if geometry else "false",
         "outSR": "4326", "f": "geojson"}
    if geometry:
        p["geometryPrecision"] = str(PRECISION)
        if simplify_deg:
            p["maxAllowableOffset"] = f"{simplify_deg:g}"
    return p


# ----------------------------------------------------------------------------------------------------------------
# One paged ArcGIS GeoJSON query (also used by sources/nfhl.py)
# ----------------------------------------------------------------------------------------------------------------
class Features(list):
    """A list of features that knows whether the service had more than Disaster Mapping paged through (``truncated``)."""

    truncated: bool = False


def arcgis_query(layer_url: str, params: dict[str, str], *, ttl_s: float, limiter: fhttp.RateLimiter, name: str,
                 down: fhttp.DownMemo, host: str, order_by: str = "oid", timeout: float = TIMEOUT_S,
                 retries: int = RETRIES, max_pages: int = MAX_PAGES, page_size: int = PAGE_SIZE) -> tuple[list[dict], int]:
    """Every GeoJSON feature of ``layer_url/query`` (paged by ``resultOffset``) and the oldest fetch time.

    ArcGIS answers errors with HTTP 200 and ``{"error": ...}`` (never cached by :mod:`fire3d.http`). A host that just
    failed is not asked again for 60 s (``down``). Raises SourceError / SourceBusy."""
    feats = Features()
    fetched: int | None = None
    offset = 0
    url = f"{layer_url}/query"
    for _ in range(max_pages):
        p = {**params, "resultOffset": str(offset), "resultRecordCount": str(page_size), "orderByFields": order_by}
        hit = fhttp.peek_cache("GET", url, p, ttl_s)
        if hit is None:
            if down.down(host):
                raise SourceError(f"{name} could not be reached (it failed less than a minute ago)")
            if not limiter.try_acquire():
                raise SourceBusy(f"{name}: Disaster Mapping's request limit is reached; try again in a minute")
            try:
                hit = fhttp.request("GET", url, params=p, ttl_s=ttl_s, timeout=timeout, retries=retries, expect_json=True)
            except fhttp.HttpError as e:
                if e.status is None or e.status >= 500 or e.status == 429:
                    down.mark(host)
                code = f"HTTP {e.status}" if e.status is not None else "no response"
                raise SourceError(f"{name} could not be reached ({code})", e.status) from None
            except Exception as e:  # noqa: BLE001 - any transport failure: unreachable
                down.mark(host)
                log.warning("%s: %s", name, config.mask_secrets(f"{type(e).__name__}: {e}"))
                raise SourceError(f"{name} could not be reached (no response)") from None
            down.clear(host)
        try:
            doc = hit.json()
        except ValueError:
            fhttp.evict_cache("GET", url, p)
            raise SourceError(f"{name} sent a reply Disaster Mapping could not read") from None
        if not isinstance(doc, dict) or "error" in doc or not isinstance(doc.get("features"), list):
            fhttp.evict_bad_answer(hit, "GET", url, p)
            code = (doc.get("error") or {}).get("code") if isinstance(doc, dict) and isinstance(doc.get("error"), dict) else None
            raise SourceError(f"{name} returned an error ({code or 'unexpected reply'})")
        fetched = int(hit.fetched_ms) if fetched is None else min(fetched, int(hit.fetched_ms))
        page = doc["features"]
        feats.extend(page)
        more = doc.get("exceededTransferLimit") or (doc.get("properties") or {}).get("exceededTransferLimit")
        if not more or not page:
            break
        offset += len(page)
    else:
        feats.truncated = True
        log.warning("%s: more than %d pages for %s; the rest is left out", name, max_pages, fhttp.display_url(url))
    return feats, int(fetched if fetched is not None else time.time() * 1000)


def _query(layer_url: str, params: dict[str, str], ttl_s: float, **kw: Any) -> tuple[list[dict], int]:
    return arcgis_query(layer_url, params, ttl_s=ttl_s, limiter=NOAA_WATER_LIMITER, name=_NAME, down=MAPS_DOWN,
                        host=MAPS_HOST, **kw)


def _feature(f: dict, props: dict[str, Any], fid: Any = None) -> dict | None:
    g = f.get("geometry") if isinstance(f, dict) else None
    if not isinstance(g, dict) or not g.get("type"):
        return None
    out: dict[str, Any] = {"type": "Feature", "geometry": g, "properties": props}
    if fid is not None:
        out["id"] = fid
    return out


def _props(f: Any) -> dict:
    p = f.get("properties") if isinstance(f, dict) else None
    return p if isinstance(p, dict) else {}


def _times(feats: Iterable[dict]) -> tuple[int | None, int | None]:
    """(newest reference_time, newest update_time) over raw features."""
    refs, upds = [], []
    for f in feats:
        p = _props(f)
        r, u = esri_time_ms(p.get("reference_time")), esri_time_ms(p.get("update_time"))
        if r:
            refs.append(r)
        if u:
            upds.append(u)
    return (max(refs) if refs else None), (max(upds) if upds else None)


# ----------------------------------------------------------------------------------------------------------------
# Results
# ----------------------------------------------------------------------------------------------------------------
@dataclass
class MapLayer:
    """A map answer: contract-shaped features, the service's own times, and when Disaster Mapping fetched them."""

    features: list[dict]
    reference_ms: int | None
    updated_ms: int | None
    fetched_ms: int
    extra: dict[str, Any] = field(default_factory=dict)

    def collection(self) -> dict:
        return {"type": "FeatureCollection", "features": self.features}


@dataclass
class Reach:
    """One RFC FIM layer-3 river line (no geometry): its reach id, its own station and the forecast points that
    drive it."""

    feature_id: str
    station: str | None
    forecast_lids: list[str]
    status: str | None


# ----------------------------------------------------------------------------------------------------------------
# NWS forecast flooded area (RFC FIM)
# ----------------------------------------------------------------------------------------------------------------
def rfc_fim(bbox: BBox) -> MapLayer:
    """The NWS forecast flooded area (5-day maximum) polygons in ``bbox``: features ``{feature_id, streamflow_cfs}``."""
    raw, fetched = _query(f"{RFC_FIM}/{RFC_FIM_POLYGONS}",
                          query_params(bbox, out_fields="feature_id,streamflow_cfs,reference_time,update_time"),
                          RFC_FIM_TTL_S)
    ref, upd = _times(raw)
    feats = []
    for f in raw:
        p = _props(f)
        fid = _fid(p.get("feature_id"))
        out = _feature(f, {"feature_id": int(fid) if fid else None, "streamflow_cfs": _num(p.get("streamflow_cfs"))},
                       int(fid) if fid else None)
        if out is not None:
            feats.append(out)
    return MapLayer(feats, ref, upd, fetched)


def parse_reach(f: Any) -> Reach | None:
    p = _props(f) or (f.get("attributes") if isinstance(f, dict) and isinstance(f.get("attributes"), dict) else {})
    fid = _fid(p.get("feature_id"))
    if fid is None:
        return None
    station = (_text(p.get("nws_station_id")) or "").upper() or None
    infl = _text(p.get("influential_forecasts")) or ""
    lids = list(dict.fromkeys(m.group(1).upper() for m in _INFLUENTIAL_RE.finditer(infl)))
    return Reach(fid, station, lids, _text(p.get("viz_status")))


def rfc_reaches(bbox: BBox) -> tuple[list[Reach], int]:
    """RFC FIM layer 3 river lines in ``bbox`` without geometry: the reach -> gauge join of :func:`member_reaches`."""
    raw, fetched = _query(f"{RFC_FIM}/{RFC_FIM_REACHES}",
                          query_params(bbox, out_fields="feature_id,nws_station_id,influential_forecasts,viz_status",
                                       geometry=False), RFC_FIM_TTL_S)
    return [r for r in (parse_reach(f) for f in raw) if r], fetched


def member_reaches(reaches: Iterable[Reach], member_lids: Iterable[str]) -> set[str]:
    """Reach ids tied to a member gauge: the reach's own NWS station is a member, or a member forecast point drives
    it (``influential_forecasts``)."""
    want = {str(x).upper() for x in member_lids if x}
    if not want:
        return set()
    return {r.feature_id for r in reaches if (r.station in want) or any(x in want for x in r.forecast_lids)}


def _km_area(geom: Any) -> float:
    """Area in km² of a lon/lat geometry (local equal-area-ish projection at its centre: fine at flood scale)."""
    if geom is None or geom.is_empty:
        return 0.0
    c = geom.representative_point()
    lat0 = math.radians(c.y)
    kx, ky = 111.32 * math.cos(lat0), 110.57
    return float(shapely.transform(geom, lambda a: _scale(a, c.x, c.y, kx, ky)).area)


def _scale(a, x0: float, y0: float, kx: float, ky: float):
    out = a.copy()
    out[:, 0] = (a[:, 0] - x0) * kx
    out[:, 1] = (a[:, 1] - y0) * ky
    return out


def safe_union(geoms: list[Any]) -> Any | None:
    """Union of lon/lat polygons that survives GEOS topology errors in simplified service geometries (repair, then a
    1e-6 deg precision grid); None when even that fails."""
    from shapely.errors import GEOSException

    if not geoms:
        return None
    try:
        return shapely.union_all(geoms)
    except GEOSException:
        pass
    try:
        return shapely.union_all([shapely.make_valid(g) for g in geoms], grid_size=1e-6)
    except GEOSException as e:
        log.warning("union of %d polygons failed: %s", len(geoms), e)
        return None


def member_area_km2(features: Iterable[dict], member_fids: set[str]) -> float | None:
    """Union area (km²) of the RFC FIM polygons on member reaches; None when no polygon is on a member reach (the
    join failed or the reaches have no mapped polygon): never a crop of everything in the box (C6)."""
    if not member_fids:
        return None
    geoms = []
    for f in features:
        fid = _fid((f.get("properties") or {}).get("feature_id"))
        if fid in member_fids and f.get("geometry"):
            try:
                geoms.append(shape(f["geometry"]).buffer(0))
            except (ValueError, TypeError, AttributeError):
                continue
    u = safe_union(geoms)
    if u is None:
        return None
    return round(_km_area(u), 3)


# ----------------------------------------------------------------------------------------------------------------
# NWS category flood maps (CatFIM)
# ----------------------------------------------------------------------------------------------------------------
def catfim(lid: str, category: str, bbox: BBox | None = None) -> MapLayer:
    """What NWS maps for ``category`` flooding at gauge ``lid`` (static experimental library): features
    ``{ahps_lid, magnitude, stage}``. ``bbox`` (optional) limits the query. ValueError for an unknown category or lid."""
    layer = CATFIM_LAYERS.get(str(category).lower())
    if layer is None:
        raise ValueError(f"unknown CatFIM category {category!r}")
    lid_l = str(lid or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9]{5}", lid_l):
        raise ValueError(f"not an NWS gauge id: {lid!r}")
    params = {"where": f"ahps_lid='{lid_l}'", "outFields": "ahps_lid,magnitude,stage,stage_uni,fim_version",
              "returnGeometry": "true", "outSR": "4326", "f": "geojson", "geometryPrecision": str(PRECISION),
              "maxAllowableOffset": f"{SIMPLIFY_DEG:g}"}
    if bbox is not None:
        params.update(envelope(bbox))
    raw, fetched = _query(f"{CATFIM}/{layer}", params, CATFIM_TTL_S)
    feats = []
    for i, f in enumerate(raw):
        p = _props(f)
        out = _feature(f, {"ahps_lid": _text(p.get("ahps_lid")), "magnitude": _text(p.get("magnitude")),
                           "stage": _num(p.get("stage"))}, f"{lid_l}-{category}-{i}")
        if out is not None:
            feats.append(out)
    version = next((_text(_props(f).get("fim_version")) for f in raw if _text(_props(f).get("fim_version"))), None)
    return MapLayer(feats, None, None, fetched, {"fim_version": version})


# ----------------------------------------------------------------------------------------------------------------
# National Water Model (model output) and river lines
# ----------------------------------------------------------------------------------------------------------------
def nwm_layer(kind: str, bbox: BBox) -> MapLayer:
    """National Water Model output in ``bbox`` (``kind``: nwm_analysis | nwm_5day | nwm_high_flow). Polygons carry
    ``{feature_id, streamflow_cfs}``; high-flow reaches ``{feature_id, name, recur_cat, streamflow_cfs,
    high_water_threshold}`` with ``recur_cat`` verbatim (an AEP in percent). **Model output**, never official."""
    if kind not in NWM_LAYERS:
        raise ValueError(f"unknown NWM map kind {kind!r}")
    url, layer = NWM_LAYERS[kind]
    if kind == "nwm_high_flow":
        fields = "feature_id,name,recur_cat,max_flow,high_water_threshold,reference_time,valid_time,update_time"
    else:
        fields = "feature_id,streamflow_cfs,reference_time,update_time"
    raw, fetched = _query(f"{url}/{layer}", query_params(bbox, out_fields=fields), NWM_TTL_S[kind])
    ref, upd = _times(raw)
    feats = []
    for f in raw:
        p = _props(f)
        fid = _fid(p.get("feature_id"))
        if kind == "nwm_high_flow":
            props = {"feature_id": int(fid) if fid else None, "name": _text(p.get("name")),
                     "recur_cat": _text(p.get("recur_cat")), "streamflow_cfs": _num(p.get("max_flow")),
                     "high_water_threshold": _num(p.get("high_water_threshold"))}
        else:
            props = {"feature_id": int(fid) if fid else None, "streamflow_cfs": _num(p.get("streamflow_cfs"))}
        out = _feature(f, props, int(fid) if fid else None)
        if out is not None:
            feats.append(out)
    return MapLayer(feats, ref, upd, fetched)


def flowlines(bbox: BBox, min_order: int = 1) -> MapLayer:
    """NWM river lines in ``bbox`` (``{feature_id, name, strm_order}``), stream order ``min_order`` or more."""
    raw, fetched = _query(f"{FLOWLINES}/0", query_params(bbox, where=f"strm_order >= {int(min_order)}",
                                                         out_fields="feature_id,name,strm_order"), FLOWLINES_TTL_S)
    feats = []
    for f in raw:
        p = _props(f)
        fid = _fid(p.get("feature_id"))
        order = _num(p.get("strm_order"))
        out = _feature(f, {"feature_id": int(fid) if fid else None, "name": _text(p.get("name")),
                           "strm_order": int(order) if order is not None else None}, int(fid) if fid else None)
        if out is not None:
            feats.append(out)
    return MapLayer(feats, None, None, fetched)


def reset_state() -> None:
    """Forget the outage memory (tests)."""
    MAPS_DOWN.reset()
