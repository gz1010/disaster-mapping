"""River gauge answers for floods (``RiverGaugesResponse``, CONTRACT 16.4; PLAN-5 D18, C18), shared by
``/api/official/river-gauges`` and the bundle's ``gauges.json``.

* **Member gauges** (the flood's ``summary.gauges``): NWPS per gauge (:func:`fire3d.sources.nwps.gauge` +
  ``stageflow``; timeout 20 s, one retry, outage memory): thresholds, impacts, the official RFC forecast with its issue
  time, data attribution. When NWPS cannot be read, the gauge's row of the NWS ``riv_gauges`` map stands in (observed
  reading and thresholds only) and the answer says so (``GAUGE_DETAIL_DOWN``).
* **Nearby gauges and ``bbox`` queries**: only the ``riv_gauges`` map, by envelope (layer 0 every status, layer 15 for
  which of them are forecast points): **never** an NWPS list (it answered 504 after 60 s). A nearby gauge's forecast
  comes from ``rfc_max_forecast`` when it is there (its ``crest_at_end`` read conservatively); otherwise ``forecast``
  is null (the gauge's own NWPS answer, ``?lid=``, has it exactly) while ``is_forecast_point`` still says it has one.
* **``scope=national``**: ``riv_gauges`` layer 0 at ``min`` or worse in the lower 48 + DC.

Facts and leaders use ``member === true`` only. Times are absolute; zones are IANA (``fire3d.regions``), never NWPS's
POSIX zones. Every answer carries ``GAUGE_NOT_ALL_CLEAR``.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Iterable

from .. import regions
from ..sources import nwps
from ..sources.nws import SourceBusy, SourceError
from . import copy as fcopy

log = logging.getLogger(__name__)

MAX_MEMBERS = 12
MAX_NEARBY = 40
NEARBY_PAD_KM = 10.0
CATEGORY_MIN = ("action", "minor", "moderate", "major")


def _tz(lon: float, lat: float, state: str | None) -> str:
    return regions.time_zone_at(lon, lat) or (regions.main_zone(state) if state else None) or "UTC"


def _county(lon: float, lat: float) -> str | None:
    c = regions.county_at(lon, lat)
    return c.name if c else None


def km_between(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    k = math.pi / 180.0
    x = (lon2 - lon1) * k * math.cos((lat1 + lat2) / 2 * k)
    return 6371.0 * math.hypot(x, (lat2 - lat1) * k)


def pad_bbox(bbox: Iterable[float], km: float) -> tuple[float, float, float, float]:
    w, s, e, n = (float(v) for v in bbox)
    dlat = km / 110.57
    dlon = km / (111.32 * max(0.2, math.cos(math.radians((s + n) / 2))))
    return (round(w - dlon, 5), round(s - dlat, 5), round(e + dlon, 5), round(n + dlat, 5))


def rfc_forecast(r: dict) -> dict:
    """A ``GaugeForecast`` from an ``rfc_max_forecast`` row (official; ``crest_at_end`` conservative)."""
    return {"category": r.get("max_status"), "max_value": r.get("max_value"), "max_ms": r.get("max_ms"),
            "issued_ms": r.get("issued_ms"), "producer": r.get("producer"), "producer_name": None,
            "issuer": r.get("issuer"), "url": r.get("url") or nwps.gauge_page(r["lid"]),
            "crest_at_end": bool(r.get("crest_at_end"))}


def riv_river_gauge(row: dict, *, member: bool, rfc_row: dict | None = None, forecast_point: bool = False) -> dict:
    """A ``RiverGauge`` from a ``riv_gauges`` map row (observed reading and thresholds; NWS fields verbatim)."""
    lid = row["lid"]
    th = row.get("thresholds") or {}
    thresholds = None if all(th.get(c) is None for c in CATEGORY_MIN) else {
        "unit": row.get("unit") or "ft", **{c: th.get(c) for c in CATEGORY_MIN}}
    state = row.get("state") or regions.state_at(row["lon"], row["lat"])
    return {
        "lid": lid, "usgs_id": (rfc_row or {}).get("usgs_id"), "reach_id": None, "name": row.get("name") or lid,
        "waterbody": row.get("waterbody"), "state": state, "county": _county(row["lon"], row["lat"]),
        "time_zone": _tz(row["lon"], row["lat"], state), "lat": row["lat"], "lon": row["lon"],
        "url": row.get("url") or nwps.gauge_page(lid), "rfc": (rfc_row or {}).get("producer"), "wfo": row.get("wfo"),
        "member": member, "is_forecast_point": bool(forecast_point or rfc_row is not None), "thresholds": thresholds,
        "observed": {"value": row.get("value"), "unit": row.get("unit"), "flow": row.get("flow"),
                     "flow_unit": row.get("flow_unit"), "category": row.get("status") or "unknown",
                     "valid_ms": row.get("valid_ms")},
        "forecast": rfc_forecast(rfc_row) if rfc_row else None,
        "impacts": [], "forecast_reliability": None, "hydronotes": [], "data_attribution": [],
    }


def nwps_river_gauge(lid: str, *, member: bool, with_series: bool, waterbody: str | None = None) -> dict:
    """A ``RiverGauge`` from NWPS detail (+ stageflow when ``with_series`` or for the forecast's crest). Raises
    SourceError / SourceBusy."""
    return nwps_river_gauge_fetched(lid, member=member, with_series=with_series, waterbody=waterbody)[0]


def nwps_river_gauge_fetched(lid: str, *, member: bool, with_series: bool,
                             waterbody: str | None = None) -> tuple[dict, int]:
    """(:func:`nwps_river_gauge`, when NWPS sent the oldest part of it: detail is cached up to 6 h, the series 10 min)."""
    detail, fetched = nwps.gauge(lid)
    try:
        sf, sf_fetched = nwps.stageflow(lid)
        fetched = min(fetched, sf_fetched)
    except SourceBusy:
        raise
    except SourceError as e:
        if with_series:
            raise
        log.info("stageflow %s: %s", lid, e)
        sf = None
    lon, lat = nwps.num(detail.get("longitude")), nwps.num(detail.get("latitude"))
    state = regions.state_at(lon, lat) if lon is not None and lat is not None else None
    tz = _tz(lon, lat, state) if lon is not None and lat is not None else "UTC"
    g = nwps.river_gauge(detail, sf, member=member, time_zone=tz, with_series=with_series,
                         state=state, county=_county(lon, lat) if lon is not None and lat is not None else None)
    g["waterbody"] = waterbody
    if g["lat"] is None or g["lon"] is None:
        raise SourceError(f"NWPS gave no position for gauge {lid}")
    return g, int(fetched)


def waterbody_of(lid: str, lon: float, lat: float) -> str | None:
    """The gauge's river or lake as the NWS ``riv_gauges`` map names it (NWPS detail has no such field): one small
    envelope query around the gauge (cached 5 min), matched by id; None when it cannot be read."""
    try:
        rows, _ = nwps.riv_gauges_in_bbox(pad_bbox((lon, lat, lon, lat), 1.0))
    except SourceError as e:                        # SourceBusy included: the name is optional
        log.info("riv_gauges waterbody %s: %s", lid, e)
        return None
    return next((r.get("waterbody") for r in rows if r["lid"] == lid.upper()), None)


def envelope(kind: str, *, now: int, flood_id: str | None, bbox: Any = None, status: str = "available",
             reason: str | None = None, reason_code: str | None = None, retrieved_ms: int | None = None,
             source_updated_ms: int | None = None, at_ms: int | None = None, caveats: list[str] | None = None,
             source: dict | None = None, synthetic: bool = False) -> dict:
    return {"kind": kind, "status": status, "reason_code": reason_code, "reason": reason,
            "source": dict(source or fcopy.SOURCE_NWPS), "retrieved_ms": retrieved_ms,
            "source_updated_ms": source_updated_ms, "requested_at_ms": at_ms, "now_ms": now, "flood_id": flood_id,
            "synthetic": synthetic, "caveats": list(caveats if caveats is not None else [])}


def _rfc_rows() -> dict[str, dict]:
    try:
        rows, _ = nwps.rfc_max_forecast()
    except SourceError as e:
        log.info("rfc_max_forecast: %s", e)
        return {}
    return {r["lid"]: r for r in rows}


def nearby(bbox: Iterable[float], *, exclude: Iterable[str] = (), center: tuple[float, float] | None = None,
           limit: int = MAX_NEARBY) -> tuple[list[dict], int]:
    """Every gauge in ``bbox`` from the ``riv_gauges`` envelope (layer 0) as non-member ``RiverGauge`` rows, nearest
    to ``center`` first. Raises SourceError / SourceBusy."""
    box = tuple(float(v) for v in bbox)
    rows, fetched = nwps.riv_gauges_in_bbox(box)  # type: ignore[arg-type]
    try:
        fc_rows, _ = nwps.riv_gauges_forecast_in_bbox(box)  # type: ignore[arg-type]
        fc_lids = {r["lid"] for r in fc_rows}
    except SourceError as e:
        log.info("riv_gauges forecast envelope: %s", e)
        fc_lids = set()
    rfc = _rfc_rows()
    skip = {x.upper() for x in exclude}
    l48 = set(regions.L48)
    out = []
    for r in rows:
        if r["lid"] in skip or (r.get("state") and r["state"] not in l48):
            continue
        out.append(riv_river_gauge(r, member=False, rfc_row=rfc.get(r["lid"]), forecast_point=r["lid"] in fc_lids))
    if center is not None:
        out.sort(key=lambda g: km_between(center[0], center[1], g["lon"], g["lat"]))
    return out[:limit], fetched


def flood_gauges(summary: dict, *, now: int, with_series: bool, include_nearby: bool = True,
                 at_ms: int | None = None) -> dict:
    """``RiverGaugesResponse`` for a flood: member gauges (NWPS; primary first), then nearby gauges (``riv_gauges``
    envelope around the flood's area). Never raises for an upstream failure: the envelope says it."""
    fid = summary["id"]
    members = [g["lid"] for g in (summary.get("gauges") or [])][:MAX_MEMBERS]
    wb = {g["lid"]: g.get("waterbody") for g in summary.get("gauges") or []}
    area = pad_bbox(summary["bbox_lonlat"], NEARBY_PAD_KM)
    caveats = [fcopy.GAUGE_NOT_ALL_CLEAR]
    rows: list[dict] = []
    fallback: dict[str, dict] = {}
    detail_down = False
    retrieved: list[int] = []
    for lid in members:
        try:
            g, fetched = nwps_river_gauge_fetched(lid, member=True, with_series=with_series, waterbody=wb.get(lid))
            rows.append(g)
            retrieved.append(fetched)
        except SourceError as e:
            log.info("member gauge %s: %s", lid, e)
            detail_down = detail_down or getattr(e, "status", None) != 404     # a gauge NWPS does not know is no outage
            fallback[lid] = {}
    near: list[dict] = []
    near_ok = True
    if include_nearby or fallback:
        try:
            near, fetched = nearby(area, exclude=[] if fallback else members,
                                   center=(float(summary["lon"]), float(summary["lat"])))
            retrieved.append(fetched)
        except SourceError as e:
            log.info("nearby gauges: %s", e)
            near_ok = False
    if fallback:
        by_lid = {g["lid"]: g for g in near}
        for lid in list(fallback):
            g = by_lid.pop(lid, None)
            if g is not None:
                g["member"] = True
                g["waterbody"] = g.get("waterbody") or wb.get(lid)
                rows.append(g)
        near = list(by_lid.values()) if include_nearby else []
        near = [g for g in near if g["lid"] not in members]
    order = {lid: i for i, lid in enumerate(members)}
    rows.sort(key=lambda g: order.get(g["lid"], 99))
    if detail_down:
        caveats.append(fcopy.GAUGE_DETAIL_DOWN)
    if not near_ok and include_nearby:
        caveats.append(fcopy.NEARBY_GAUGES_DOWN)
    if members and not rows:
        return {**envelope("river_gauges", now=now, flood_id=fid, bbox=area, status="unavailable",
                           reason=fcopy.GAUGES_UNAVAILABLE, reason_code="upstream_error", at_ms=at_ms, caveats=caveats),
                "gauges": [], "area_bbox": list(area)}
    if not members and not near_ok:
        return {**envelope("river_gauges", now=now, flood_id=fid, bbox=area, status="unavailable",
                           reason=fcopy.GAUGES_UNAVAILABLE, reason_code="upstream_error", at_ms=at_ms, caveats=caveats),
                "gauges": [], "area_bbox": list(area)}
    obs = [g["observed"]["valid_ms"] for g in rows if g["observed"].get("valid_ms")]
    # retrieved_ms: when the oldest part of this answer was fetched from NOAA (cached copies keep their own time)
    return {**envelope("river_gauges", now=now, flood_id=fid, bbox=area, retrieved_ms=min(retrieved) if retrieved else now,
                       source_updated_ms=max(obs) if obs else None, at_ms=at_ms, caveats=caveats),
            "gauges": rows + (near if include_nearby else []), "area_bbox": list(area)}


def bbox_gauges(bbox: Iterable[float], *, now: int, at_ms: int | None = None) -> dict:
    """``RiverGaugesResponse`` of every gauge in ``bbox`` (``riv_gauges`` envelope; never NWPS), nearest to the
    box's centre first."""
    box = tuple(float(v) for v in bbox)
    center = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
    # a point query (w == e, s == n) looks within NEARBY_PAD_KM around it
    area = pad_bbox(box, NEARBY_PAD_KM if (box[2] - box[0] < 1e-6 or box[3] - box[1] < 1e-6) else 0.0)
    try:
        rows, fetched = nearby(area, center=center)
    except SourceError as e:
        log.info("bbox gauges: %s", e)
        return {**envelope("river_gauges", now=now, flood_id=None, bbox=area, status="unavailable",
                           reason=fcopy.GAUGES_UNAVAILABLE, reason_code="upstream_error", at_ms=at_ms,
                           caveats=[fcopy.GAUGE_NOT_ALL_CLEAR]),
                "gauges": [], "area_bbox": list(area)}
    return {**envelope("river_gauges", now=now, flood_id=None, bbox=area, retrieved_ms=fetched, at_ms=at_ms,
                       caveats=[fcopy.GAUGE_NOT_ALL_CLEAR]),
            "gauges": rows, "area_bbox": list(area)}


def national_gauges(min_category: str, *, now: int) -> dict:
    """``RiverGaugesResponse`` of every lower-48 gauge observed at ``min_category`` or worse (``riv_gauges`` layer 0)."""
    if min_category not in CATEGORY_MIN:
        raise ValueError(f"unknown category {min_category!r}")
    try:
        rows, fetched = nwps.riv_gauges_observed(min_category)
    except SourceError as e:
        log.info("national gauges: %s", e)
        return {**envelope("river_gauges", now=now, flood_id=None, bbox=None, status="unavailable",
                           reason=fcopy.GAUGES_UNAVAILABLE, reason_code="upstream_error",
                           caveats=[fcopy.GAUGE_NOT_ALL_CLEAR]),
                "gauges": [], "area_bbox": None}
    rfc = _rfc_rows()
    l48 = set(regions.L48)
    keep = set(CATEGORY_MIN[CATEGORY_MIN.index(min_category):])
    out = [riv_river_gauge(r, member=False, rfc_row=rfc.get(r["lid"])) for r in rows
           if r.get("state") in l48 and r.get("status") in keep]
    out.sort(key=lambda g: (-CATEGORY_MIN.index(g["observed"]["category"]) if g["observed"]["category"] in CATEGORY_MIN
                            else 1, g["lid"]))
    return {**envelope("river_gauges", now=now, flood_id=None, bbox=None, retrieved_ms=fetched,
                       caveats=[fcopy.GAUGE_NOT_ALL_CLEAR]),
            "gauges": out, "area_bbox": None}


def lid_gauge(lid: str, *, now: int, with_series: bool, member: bool = False, at_ms: int | None = None) -> dict:
    """``RiverGaugesResponse`` of one gauge from NWPS (``?lid=``); ``unavailable`` when NWPS cannot be read; raises
    LookupError when NWPS does not know the gauge."""
    try:
        g, fetched = nwps_river_gauge_fetched(lid, member=member, with_series=with_series)
    except SourceError as e:
        if getattr(e, "status", None) == 404 or "has no gauge" in str(e):
            raise LookupError(lid) from None
        log.info("gauge %s: %s", lid, e)
        return {**envelope("river_gauges", now=now, flood_id=None, bbox=None, status="unavailable",
                           reason=fcopy.GAUGES_UNAVAILABLE, reason_code="upstream_error", at_ms=at_ms,
                           caveats=[fcopy.GAUGE_NOT_ALL_CLEAR]),
                "gauges": [], "area_bbox": None}
    g["waterbody"] = waterbody_of(lid, g["lon"], g["lat"])
    return {**envelope("river_gauges", now=now, flood_id=None, bbox=None, retrieved_ms=fetched,
                       source_updated_ms=g["observed"].get("valid_ms"), at_ms=at_ms,
                       caveats=[fcopy.GAUGE_NOT_ALL_CLEAR]),
            "gauges": [g], "area_bbox": [g["lon"], g["lat"], g["lon"], g["lat"]]}
