"""River gauges and official river forecasts for floods (brief 5; PLAN-5 2 and 3.2, CONTRACT 16.8).

National status comes from NWS map services, one request each (never the NWPS ``gauges?bbox=`` list, which answered
HTTP 504 after 60 s in 2 of 5 tries; PLAN-5 D18, C18):

* :func:`riv_gauges_observed` / :func:`riv_gauges_forecast`: ``mapservices.weather.noaa.gov`` ``riv_gauges`` layers 0
  (observed river stages) and 15 (full forecast period), gauges at ``min`` category or worse, cached 5 min;
* :func:`riv_gauges_in_bbox`: layer 0 by envelope, every status (the gauges near a flood or a point);
* :func:`rfc_max_forecast`: ``maps.water.noaa.gov`` ``rfc/rfc_max_forecast`` layer 0 (official RFC forecast points at
  action or above), cached 10 min;
* :func:`iem_current_flood_warnings`: the Iowa Environmental Mesonet's list of current point Flood Warnings, used only
  as a join key (H-VTEC NWSLI of each warning), never shown; cached 5 min.

Per gauge, NOAA's National Water Prediction Service (NWPS, ``api.water.noaa.gov/nwps/v1``): :func:`gauge` (detail,
thresholds, impacts; 6 h), :func:`stageflow` (30 days observed and the RFC forecast; 10 min) and
:func:`reach_streamflow` (National Water Model flow of a reach: **model output**; 1 h). One gauge per request, timeout
20 s, one retry, and an outage memory (:data:`NWPS_DOWN`): after a failure NWPS is not asked again for 60 s.

Numbers arrive as strings in ``riv_gauges`` and as ``-999`` / ``-9999`` for missing values in NWPS: both parse to
None. ``riv_gauges.obstime`` has no zone; it is UTC (checked against NWPS ``validTime`` in the recorded samples,
``tests/data/floods/nwps/``). NWPS's POSIX time zones ("MST7MDT") are never used: zones come from ``fire3d.regions``.
Every request goes through :mod:`fire3d.http` (cache, retries, limiter); credits are in ``fire3d.floods.copy``.
"""

from __future__ import annotations

import logging
import math
import re
from datetime import datetime, timezone
from typing import Any, Iterable

from .. import config
from .. import http as fhttp
from .nws import IEM_LIMITER, SourceBusy, SourceError

log = logging.getLogger(__name__)

BBox = tuple[float, float, float, float]

RIV_GAUGES = "https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer"
RFC_MAX_FORECAST = "https://maps.water.noaa.gov/server/rest/services/rfc/rfc_max_forecast/MapServer"
NWPS_API = "https://api.water.noaa.gov/nwps/v1"
NWPS_HOST = "api.water.noaa.gov"
IEM_CURRENT_FLOOD_WARNINGS_URL = "https://mesonet.agron.iastate.edu/api/1/nws/current_flood_warnings.geojson"
GAUGE_PAGE = "https://water.noaa.gov/gauges/{lid}"

OBSERVED_LAYER, FORECAST_LAYER = 0, 15
CATEGORIES = ("action", "minor", "moderate", "major")          # ascending
GAUGE_CATEGORIES = ("no_flooding", "action", "minor", "moderate", "major", "not_defined", "low_threshold",
                    "obs_not_current", "out_of_service", "fcst_not_current", "unknown")
RIV_TTL_S = 300.0
RFC_TTL_S = 600.0
IEM_TTL_S = 300.0
GAUGE_TTL_S = 6 * 3600.0
SERIES_TTL_S = 600.0
REACH_TTL_S = 3600.0
NWPS_TIMEOUT_S = 20.0
NWPS_RETRIES = 1
MAPS_TIMEOUT_S = 30.0
MAPS_RETRIES = 1
MISSING = (-999.0, -9999.0, -99999.0)

NOAA_MAPS_LIMITER = fhttp.RateLimiter(30, 60.0, "floods: NOAA map services")
NWPS_LIMITER = fhttp.RateLimiter(30, 60.0, "floods: NWPS API")
NWPS_DOWN = fhttp.DownMemo("floods: NWPS per gauge")
_NWPS_NAME = "NOAA's National Water Prediction Service"
_MAPS_NAME = "NOAA's river gauge map service"
_RFC_NAME = "NOAA's river forecast map service"
_IEM_NAME = "The Iowa Environmental Mesonet list of current flood warnings"


# ----------------------------------------------------------------------------------------------------------------
# Parsing helpers
# ----------------------------------------------------------------------------------------------------------------
def num(v: Any) -> float | None:
    """A number from ``riv_gauges`` (strings) or NWPS (``-999`` / ``-9999`` for missing); None when missing."""
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(str(v).strip()) if isinstance(v, str) else float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x) or any(abs(x - m) < 1e-9 for m in MISSING):
        return None
    return x


def utc_ms(v: Any) -> int | None:
    """Epoch ms from an ArcGIS date (epoch ms), an ISO time ("2026-11-04T19:00:00Z", "...+00", "...+00:00") or a
    zone-less "2026-11-04 18:30:00" (UTC). NWPS's "0001-01-01T00:00:00Z" (no value) is None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return int(v) if v > 0 else None
    s = str(v).strip()
    if not s or s.startswith("0001-01-01"):
        return None
    s = s.replace(" UTC", "").replace("Z", "+00:00")
    if re.search(r"[+-]\d{2}$", s):
        s += ":00"
    try:
        dt = datetime.fromisoformat(s.replace(" ", "T", 1))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def category(v: Any) -> str:
    """A ``GaugeCategory`` from a riv_gauges / NWPS value (verbatim when known, else "unknown")."""
    s = str(v or "").strip().lower().replace(" ", "_")
    return s if s in GAUGE_CATEGORIES else "unknown"


def category_rank(cat: str | None) -> int:
    """-1 below action (or not a flood category), 0 action ... 3 major."""
    return CATEGORIES.index(cat) if cat in CATEGORIES else -1


def status_where(min_category: str = "action") -> str:
    """``status in ('action', ...)`` from ``min_category`` up."""
    if min_category not in CATEGORIES:
        raise ValueError(f"min must be one of {CATEGORIES}")
    cats = CATEGORIES[CATEGORIES.index(min_category):]
    return "status in (" + ",".join(f"'{c}'" for c in cats) + ")"


def gauge_page(lid: str) -> str:
    return GAUGE_PAGE.format(lid=lid.lower())


def _props(feature: Any) -> dict:
    if not isinstance(feature, dict):
        return {}
    p = feature.get("properties") if isinstance(feature.get("properties"), dict) else feature.get("attributes")
    return {str(k).lower(): v for k, v in (p or {}).items()}


def _point(feature: Any) -> tuple[float, float] | None:
    g = feature.get("geometry") if isinstance(feature, dict) else None
    if isinstance(g, dict):
        c = g.get("coordinates")
        if isinstance(c, (list, tuple)) and len(c) >= 2:
            lon, lat = num(c[0]), num(c[1])
            if lon is not None and lat is not None:
                return lon, lat
        if "x" in g and "y" in g:
            lon, lat = num(g.get("x")), num(g.get("y"))
            if lon is not None and lat is not None:
                return lon, lat
    return None


def _text(v: Any) -> str | None:
    if v is None or isinstance(v, (dict, list)):
        return None
    s = str(v).strip()
    return s or None


def parse_riv_row(feature: Any) -> dict | None:
    """One ``riv_gauges`` feature (layer 0 or 15) -> ``{lid, name, waterbody, state, lat, lon, status, value, unit,
    flow, flow_unit, valid_ms, thresholds {action, minor, moderate, major}, wfo, url, forecast_issued_ms, pedts}``;
    None without an id or a point. Layer 15's ``status`` is the forecast category, ``value`` the forecast value at
    ``valid_ms`` (``fcsttime``) and ``forecast_issued_ms`` its issue time (``fcstissunc``). ``pedts`` is the SHEF
    code of the value ("HGIRG" river stage; "HM..." / "HC..." the tidal and coastal water levels, measured on the
    recorded answers), used only to tell tide gauges from river gauges (``grouping.is_tidal_row``)."""
    p = _props(feature)
    lid = _text(p.get("gaugelid"))
    pt = _point(feature)
    if pt is None:
        lat, lon = num(p.get("latitude")), num(p.get("longitude"))
        pt = (lon, lat) if lat is not None and lon is not None else None
    if not lid or pt is None:
        return None
    value = num(p.get("observed")) if "observed" in p else num(p.get("forecast"))
    valid = utc_ms(p.get("obstime")) if "obstime" in p else utc_ms(p.get("fcsttime"))
    return {
        "lid": lid.upper(), "name": _text(p.get("location")) or lid.upper(), "waterbody": _text(p.get("waterbody")),
        "state": (_text(p.get("state")) or "").upper() or None, "lon": round(pt[0], 6), "lat": round(pt[1], 6),
        "status": category(p.get("status")), "value": value, "unit": _text(p.get("units")),
        "flow": num(p.get("secvalue")), "flow_unit": _text(p.get("secunit")), "valid_ms": valid,
        "thresholds": {"action": num(p.get("action")), "minor": num(p.get("flood")), "moderate": num(p.get("moderate")),
                       "major": num(p.get("major"))},
        "wfo": (_text(p.get("wfo")) or "").upper() or None, "url": _text(p.get("url")) or gauge_page(lid),
        "forecast_issued_ms": utc_ms(p.get("fcstissunc")) if "fcstissunc" in p else None,
        "pedts": (_text(p.get("pedts")) or "").upper() or None,
    }


def parse_rfc_row(feature: Any) -> dict | None:
    """One ``rfc_max_forecast`` feature -> ``{lid, name, usgs_id, feature_id, producer, issuer, issued_ms,
    initial_status, max_status, max_value, max_ms, units, trend, is_record, url, crest_at_end}``; None without an id.
    ``crest_at_end``: the forecast maximum is at its last step (the river is still forecast to rise; C7)."""
    p = _props(feature)
    lid = _text(p.get("nws_lid"))
    if not lid:
        return None
    max_ms = utc_ms(p.get("max_value_timestep"))
    min_ms = utc_ms(p.get("min_value_timestep"))
    trend = (_text(p.get("forecast_trend")) or "").lower() or None
    # The layer gives no last forecast step (recorded 2026-11-04); "forecast_trend" is the trend at the start. A
    # forecast whose lowest value comes before its highest ends rising or near its highest: read conservatively as
    # "still forecast to rise" (C7). The gauge's own series (NWPS stageflow) decides exactly in the detail views.
    crest_at_end = bool(max_ms is not None and min_ms is not None and max_ms > min_ms)
    pt = _point(feature)
    return {
        "lid": lid.upper(), "name": _text(p.get("nws_name")), "usgs_id": _text(p.get("usgs_site_code")),
        "feature_id": _text(p.get("feature_id")), "producer": (_text(p.get("producer")) or "").upper() or None,
        "issuer": (_text(p.get("issuer")) or "").upper() or None, "issued_ms": utc_ms(p.get("issued_time")),
        "initial_status": category(p.get("initial_status")), "max_status": category(p.get("max_status")),
        "initial_value": num(p.get("initial_value")), "initial_ms": utc_ms(p.get("initial_value_timestep")),
        "max_value": num(p.get("max_value")), "max_ms": max_ms, "min_ms": min_ms,
        "units": (_text(p.get("units")) or "").lower() or None, "trend": trend,
        "thresholds": {"action": num(p.get("action_threshold")), "minor": num(p.get("minor_threshold")),
                       "moderate": num(p.get("moderate_threshold")), "major": num(p.get("major_threshold"))},
        "is_record": str(p.get("is_record_forecast") or "").lower() in ("true", "1", "yes"),
        "url": _text(p.get("hydrograph_link")) or gauge_page(lid), "crest_at_end": crest_at_end,
        "lon": round(pt[0], 6) if pt else None, "lat": round(pt[1], 6) if pt else None,
    }


def parse_iem_warning(feature: Any) -> dict | None:
    """One IEM ``current_flood_warnings`` feature -> ``{nwsli, wfo, office, phenomena, significance, etn, key4}``
    (join keys only; never shown). The rows carry no year (recorded 2026-11-04): they are current warnings, so they
    join live NWS products on ``key4`` = (office, phenomena, significance, ETN), the live product giving the year."""
    p = _props(feature)
    nwsli = (_text(p.get("hvtec_nwsli")) or _text(p.get("nwsli")) or "").upper()
    wfo = (_text(p.get("wfo")) or "").upper()
    etn = num(p.get("eventid"))
    if not nwsli or nwsli == "00000" or not wfo or etn is None:
        return None
    ph = (_text(p.get("phenomena")) or "FL").upper()
    sig = (_text(p.get("significance")) or "W").upper()
    office = wfo if len(wfo) == 4 else ("P" + wfo if wfo in ("AFC", "AFG", "AJK", "HFO", "GUM") else "K" + wfo)
    return {"nwsli": nwsli, "wfo": wfo[-3:], "office": office, "phenomena": ph, "significance": sig, "etn": int(etn),
            "key4": (office, ph, sig, int(etn))}


# ----------------------------------------------------------------------------------------------------------------
# Requests (URLs are exposed for the recorder and the request-count test)
# ----------------------------------------------------------------------------------------------------------------
def riv_gauges_query(layer: int, where: str, bbox: BBox | None = None) -> tuple[str, dict[str, str]]:
    params = {"where": where, "outFields": "*", "returnGeometry": "true", "outSR": "4326", "f": "geojson"}
    if bbox is not None:
        params.update(geometry=",".join(f"{v:.5f}" for v in bbox), geometryType="esriGeometryEnvelope", inSR="4326",
                      spatialRel="esriSpatialRelIntersects")
    return f"{RIV_GAUGES}/{layer}/query", params


def rfc_max_forecast_query() -> tuple[str, dict[str, str]]:
    return (f"{RFC_MAX_FORECAST}/0/query",
            {"where": "1=1", "outFields": "*", "returnGeometry": "true", "outSR": "4326", "f": "geojson"})


def gauge_url(lid: str) -> str:
    return f"{NWPS_API}/gauges/{lid.upper()}"


def stageflow_url(lid: str) -> str:
    return f"{NWPS_API}/gauges/{lid.upper()}/stageflow"


def reach_streamflow_url(reach_id: str) -> str:
    return f"{NWPS_API}/reaches/{reach_id}/streamflow"


def _features(url: str, params: Any, *, ttl_s: float, limiter: fhttp.RateLimiter, name: str, timeout: float,
              retries: int) -> tuple[list[dict], int]:
    """A cached ArcGIS / GeoJSON request -> (features, fetched_ms). Raises SourceError / SourceBusy."""
    hit = fhttp.peek_cache("GET", url, params, ttl_s)
    if hit is None:
        if not limiter.try_acquire():
            raise SourceBusy(f"{name}: Fire-3d's request limit is reached; try again in a minute")
        try:
            hit = fhttp.request("GET", url, params=params, ttl_s=ttl_s, timeout=timeout, retries=retries, expect_json=True)
        except fhttp.HttpError as e:
            code = f"HTTP {e.status}" if e.status is not None else "no response"
            raise SourceError(f"{name} could not be reached ({code})", e.status) from None
        except Exception as e:  # noqa: BLE001 - any transport failure: unreachable
            log.warning("%s: %s", name, config.mask_secrets(f"{type(e).__name__}: {e}"))
            raise SourceError(f"{name} could not be reached (no response)") from None
    try:
        doc = hit.json()
    except ValueError:
        fhttp.evict_cache("GET", url, params)
        raise SourceError(f"{name} sent a reply Fire-3d could not read") from None
    if not isinstance(doc, dict) or not isinstance(doc.get("features"), list):
        fhttp.evict_bad_answer(hit, "GET", url, params)
        raise SourceError(f"{name} sent an unexpected reply")
    return doc["features"], int(hit.fetched_ms)


def riv_gauges_observed(min: str = "action") -> tuple[list[dict], int]:  # noqa: A002 - CONTRACT 16.8 name
    """Gauges observed at ``min`` or worse (``riv_gauges`` layer 0, every state; filter by ``state``)."""
    url, params = riv_gauges_query(OBSERVED_LAYER, status_where(min))
    feats, fetched = _features(url, params, ttl_s=RIV_TTL_S, limiter=NOAA_MAPS_LIMITER, name=_MAPS_NAME,
                               timeout=MAPS_TIMEOUT_S, retries=MAPS_RETRIES)
    return [r for r in (parse_riv_row(f) for f in feats) if r], fetched


def riv_gauges_forecast(min: str = "action") -> tuple[list[dict], int]:  # noqa: A002
    """Gauges whose NWS forecast reaches ``min`` or worse (``riv_gauges`` layer 15, full forecast period)."""
    url, params = riv_gauges_query(FORECAST_LAYER, status_where(min))
    feats, fetched = _features(url, params, ttl_s=RIV_TTL_S, limiter=NOAA_MAPS_LIMITER, name=_MAPS_NAME,
                               timeout=MAPS_TIMEOUT_S, retries=MAPS_RETRIES)
    return [r for r in (parse_riv_row(f) for f in feats) if r], fetched


def riv_gauges_in_bbox(bbox: BBox) -> tuple[list[dict], int]:
    """Every gauge in ``bbox`` (w, s, e, n), any status (``riv_gauges`` layer 0 envelope query): nearby gauges."""
    url, params = riv_gauges_query(OBSERVED_LAYER, "1=1", bbox=tuple(float(v) for v in bbox))  # type: ignore[arg-type]
    feats, fetched = _features(url, params, ttl_s=RIV_TTL_S, limiter=NOAA_MAPS_LIMITER, name=_MAPS_NAME,
                               timeout=MAPS_TIMEOUT_S, retries=MAPS_RETRIES)
    return [r for r in (parse_riv_row(f) for f in feats) if r], fetched


def riv_gauges_forecast_in_bbox(bbox: BBox) -> tuple[list[dict], int]:
    """Every forecast point in ``bbox`` (w, s, e, n), any forecast status (``riv_gauges`` layer 15 envelope query):
    which nearby gauges have an NWS forecast (backend-flood-bundle-api)."""
    url, params = riv_gauges_query(FORECAST_LAYER, "1=1", bbox=tuple(float(v) for v in bbox))  # type: ignore[arg-type]
    feats, fetched = _features(url, params, ttl_s=RIV_TTL_S, limiter=NOAA_MAPS_LIMITER, name=_MAPS_NAME,
                               timeout=MAPS_TIMEOUT_S, retries=MAPS_RETRIES)
    return [r for r in (parse_riv_row(f) for f in feats) if r], fetched


def rfc_max_forecast() -> tuple[list[dict], int]:
    """Official RFC forecast points at action or above, nationally (``rfc_max_forecast`` layer 0)."""
    url, params = rfc_max_forecast_query()
    feats, fetched = _features(url, params, ttl_s=RFC_TTL_S, limiter=NOAA_MAPS_LIMITER, name=_RFC_NAME,
                               timeout=MAPS_TIMEOUT_S, retries=MAPS_RETRIES)
    return [r for r in (parse_rfc_row(f) for f in feats) if r], fetched


def iem_current_flood_warnings() -> tuple[list[dict], int]:
    """IEM's current point Flood Warnings: H-VTEC join keys only (``{nwsli, vtec_key, ...}``)."""
    feats, fetched = _features(IEM_CURRENT_FLOOD_WARNINGS_URL, None, ttl_s=IEM_TTL_S, limiter=IEM_LIMITER, name=_IEM_NAME,
                               timeout=MAPS_TIMEOUT_S, retries=MAPS_RETRIES)
    return [r for r in (parse_iem_warning(f) for f in feats) if r], fetched


def _nwps_json(url: str, params: Any, ttl_s: float) -> tuple[Any, int]:
    """One NWPS request (timeout 20 s, one retry, outage memory). Raises SourceError / SourceBusy."""
    hit = fhttp.peek_cache("GET", url, params, ttl_s)
    if hit is None:
        if NWPS_DOWN.down(NWPS_HOST):
            raise SourceError(f"{_NWPS_NAME} could not be reached (it failed less than a minute ago)")
        if not NWPS_LIMITER.try_acquire():
            raise SourceBusy(f"{_NWPS_NAME}: Fire-3d's request limit is reached; try again in a minute")
        try:
            hit = fhttp.request("GET", url, params=params, ttl_s=ttl_s, timeout=NWPS_TIMEOUT_S, retries=NWPS_RETRIES,
                                expect_json=True)
        except fhttp.HttpError as e:
            if e.status is None or e.status >= 500 or e.status == 429:
                NWPS_DOWN.mark(NWPS_HOST)
            code = f"HTTP {e.status}" if e.status is not None else "no response"
            raise SourceError(f"{_NWPS_NAME} could not be reached ({code})", e.status) from None
        except Exception as e:  # noqa: BLE001
            NWPS_DOWN.mark(NWPS_HOST)
            log.warning("%s: %s", _NWPS_NAME, config.mask_secrets(f"{type(e).__name__}: {e}"))
            raise SourceError(f"{_NWPS_NAME} could not be reached (no response)") from None
        NWPS_DOWN.clear(NWPS_HOST)
    try:
        return hit.json(), int(hit.fetched_ms)
    except ValueError:
        fhttp.evict_cache("GET", url, params)
        raise SourceError(f"{_NWPS_NAME} sent a reply Fire-3d could not read") from None


def gauge(lid: str) -> tuple[dict, int]:
    """NWPS ``/gauges/{lid}`` (detail, thresholds, impacts, crests; cached 6 h)."""
    doc, fetched = _nwps_json(gauge_url(lid), None, GAUGE_TTL_S)
    if not isinstance(doc, dict) or not doc.get("lid"):
        fhttp.evict_cache("GET", gauge_url(lid), None)
        raise SourceError(f"{_NWPS_NAME} has no gauge {lid.upper()}")
    return doc, fetched


def stageflow(lid: str) -> tuple[dict, int]:
    """NWPS ``/gauges/{lid}/stageflow`` (about 30 days observed, the official RFC forecast; cached 10 min)."""
    doc, fetched = _nwps_json(stageflow_url(lid), None, SERIES_TTL_S)
    if not isinstance(doc, dict):
        raise SourceError(f"{_NWPS_NAME} sent an unexpected reply")
    return doc, fetched


def reach_streamflow(reach_id: str, series: str = "short_range") -> tuple[dict, int]:
    """NWPS ``/reaches/{id}/streamflow?series=`` (National Water Model flow: model output; cached 1 h)."""
    if series not in ("analysis_assimilation", "short_range", "medium_range", "medium_range_blend", "long_range"):
        raise ValueError(f"unknown series {series!r}")
    doc, fetched = _nwps_json(reach_streamflow_url(str(reach_id)), {"series": series}, REACH_TTL_S)
    if not isinstance(doc, dict):
        raise SourceError(f"{_NWPS_NAME} sent an unexpected reply")
    return doc, fetched


# ----------------------------------------------------------------------------------------------------------------
# NWPS detail and series -> contract shapes (RiverGauge, GaugeSeries; CONTRACT 16.4)
# ----------------------------------------------------------------------------------------------------------------
def _abbr(v: Any) -> str | None:
    if isinstance(v, dict):
        return _text(v.get("abbreviation")) or _text(v.get("code"))
    return _text(v)


def _name(v: Any) -> str | None:
    return _text(v.get("name")) if isinstance(v, dict) else None


def series_rows(block: Any) -> list[list]:
    """NWPS stageflow ``observed`` / ``forecast`` -> rows ``[valid_ms, stage | None, flow | None]`` (time order)."""
    rows = []
    for r in (block or {}).get("data") or [] if isinstance(block, dict) else []:
        t = utc_ms(r.get("validTime"))
        if t is None:
            continue
        rows.append([t, num(r.get("primary")), num(r.get("secondary"))])
    rows.sort(key=lambda r: r[0])
    return rows


def crest_at_end(rows: list[list]) -> bool:
    """True when the highest forecast stage is at the last forecast step (not a crest: still forecast to rise; C7)."""
    vals = [(i, r[1]) for i, r in enumerate(rows) if r[1] is not None]
    if len(vals) < 2:
        return False
    top = max(v for _, v in vals)
    return vals[-1][1] >= top - 1e-9 and vals[-1][1] > vals[0][1]


def gauge_series(sf: dict) -> dict:
    """``GaugeSeries`` from a stageflow answer."""
    obs, fc = sf.get("observed") or {}, sf.get("forecast") or {}
    return {"observed": series_rows(obs), "forecast": series_rows(fc), "forecast_issued_ms": utc_ms(fc.get("issuedTime")),
            "stage_unit": _text(obs.get("primaryUnits") or fc.get("primaryUnits")),
            "flow_unit": _text(obs.get("secondaryUnits") or fc.get("secondaryUnits"))}


def thresholds(detail: dict) -> dict | None:
    """``GaugeThresholds`` from NWPS ``flood.categories`` (stage); None when NWS has set no flood stage."""
    flood = detail.get("flood") if isinstance(detail.get("flood"), dict) else {}
    cats = flood.get("categories") if isinstance(flood.get("categories"), dict) else {}
    out = {c: num((cats.get(c) or {}).get("stage")) for c in CATEGORIES}
    if all(v is None for v in out.values()):
        return None
    return {"unit": _text(flood.get("stageUnits")) or "ft", **out}


def is_forecast_point(detail: dict) -> bool:
    pedts = detail.get("pedts") if isinstance(detail.get("pedts"), dict) else {}
    return bool(_text(pedts.get("forecast")))


def river_gauge(detail: dict, sf: dict | None = None, *, member: bool, time_zone: str, with_series: bool = False,
                state: str | None = None, county: str | None = None) -> dict:
    """A ``RiverGauge`` dict (CONTRACT 16.4) from NWPS detail (and stageflow). ``time_zone`` is IANA (from
    ``fire3d.regions``), never NWPS's POSIX zone."""
    st = detail.get("status") if isinstance(detail.get("status"), dict) else {}
    o, f = st.get("observed") or {}, st.get("forecast") or {}
    lid = str(detail.get("lid")).upper()
    series = gauge_series(sf) if sf else None
    fc_point = is_forecast_point(detail)
    forecast = None
    if fc_point:
        rows = series["forecast"] if series else []
        top = max(((r[0], r[1]) for r in rows if r[1] is not None), key=lambda x: x[1], default=None)
        forecast = {
            "category": category(f.get("floodCategory")) if f else None,
            "max_value": top[1] if top else num(f.get("primary")), "max_ms": top[0] if top else utc_ms(f.get("validTime")),
            "issued_ms": series["forecast_issued_ms"] if series else None,
            "producer": _abbr(detail.get("rfc")), "producer_name": _name(detail.get("rfc")),
            "issuer": _abbr((sf or {}).get("forecast", {}).get("wfo") if sf else None) or _abbr(detail.get("wfo")),
            "url": gauge_page(lid), "crest_at_end": crest_at_end(rows),
        }
    flood = detail.get("flood") if isinstance(detail.get("flood"), dict) else {}
    impacts = [{"stage": num(i.get("stage")), "statement": str(i.get("statement")).strip()}
               for i in flood.get("impacts") or [] if isinstance(i, dict) and num(i.get("stage")) is not None
               and _text(i.get("statement"))]
    # NWPS dataAttribution: {"abbrev": "USGS (05056500)", "text": "USGS Readings", "title": "Observations courtesy of
    # U.S. Geological Survey", "url": ...}: the title is the credit line (16.15)
    attr = [{"text": str(a.get("title") or a.get("text") or "").strip(), "url": _text(a.get("url") or a.get("link"))}
            for a in detail.get("dataAttribution") or [] if isinstance(a, dict) and (a.get("title") or a.get("text"))]
    notes = detail.get("hydronotes")
    hydronotes = [_text(h.get("statement") if isinstance(h, dict) else h) for h in (notes if isinstance(notes, list) else [notes])]
    out = {
        "lid": lid, "usgs_id": _text(detail.get("usgsId")), "reach_id": _text(detail.get("reachId")),
        "name": _text(detail.get("name")) or lid, "waterbody": None,
        "state": state or _abbr(detail.get("state")), "county": county or _text(detail.get("county")),
        "time_zone": time_zone, "lat": num(detail.get("latitude")), "lon": num(detail.get("longitude")),
        "url": gauge_page(lid), "rfc": _abbr(detail.get("rfc")), "wfo": _abbr(detail.get("wfo")), "member": member,
        "is_forecast_point": fc_point, "thresholds": thresholds(detail),
        "observed": {"value": num(o.get("primary")), "unit": _text(o.get("primaryUnit")), "flow": num(o.get("secondary")),
                     "flow_unit": _text(o.get("secondaryUnit")), "category": category(o.get("floodCategory")),
                     "valid_ms": utc_ms(o.get("validTime"))},
        "forecast": forecast, "impacts": sorted(impacts, key=lambda i: i["stage"]),
        "forecast_reliability": _text(detail.get("forecastReliability")),
        "hydronotes": [h for h in hydronotes if h],
        "data_attribution": attr,
    }
    if with_series:
        out["series"] = series
    return out


_SERIES_KEYS = {"analysis_assimilation": "analysisAssimilation", "short_range": "shortRange",
                "medium_range": "mediumRange", "medium_range_blend": "mediumRangeBlend", "long_range": "longRange"}


def nwm_series(doc: dict, name: str) -> dict | None:
    """``ModelSeries`` (CONTRACT 16.6) from NWPS ``/reaches/{id}/streamflow`` for one series name ("short_range";
    NWPS answers it under the camelCase key "shortRange"), or None when the answer has no values for it."""
    block = doc.get(_SERIES_KEYS.get(name, name))
    if not isinstance(block, dict):
        block = doc.get(name)
    if not isinstance(block, dict):
        return None
    sub = block.get("series") if isinstance(block.get("series"), dict) else block
    pts = []
    for r in sub.get("data") or []:
        t, q = utc_ms(r.get("validTime")), num(r.get("flow"))
        if t is not None and q is not None:
            pts.append([t, q])
    ref = utc_ms(sub.get("referenceTime") or block.get("referenceTime"))
    if not pts or ref is None:
        return None
    return {"name": name, "reference_ms": ref, "unit": "ft3/s", "points": sorted(pts)}


def in_states(rows: Iterable[dict], states: Iterable[str]) -> list[dict]:
    want = set(states)
    return [r for r in rows if r.get("state") in want]
