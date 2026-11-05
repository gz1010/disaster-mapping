"""Flood map and model answers (``FloodMapResponse``, ``ModelOutputResponse``; CONTRACT 16.4, 16.6; PLAN-5 3.3, 3.8,
D5, D16, D22, C6, C14, C19), shared by ``GET /api/floods/{id}/maps`` / ``model`` and the bundle builder.

Official sources and model output are **never merged**: map answers are ``FloodEnvelope``s of kind ``flood_map``
(NWS forecast flooded area, NWS category flood maps, FEMA floodplain); model answers are ``ModelOutputResponse`` with
``model_output: true``, ``MODEL_LABEL`` and ``MODEL_CAVEAT``, never an official envelope. Each official answer has its
own "could not be reached" reason (``RFC_FIM_UNAVAILABLE``, ``CATFIM_UNAVAILABLE``, ``NFHL_DOWN``) and never an absence
sentence while unavailable (D24). Past times: the forecast maps and the model are ``not_available_for_past_dates``;
CatFIM answers today's static library with ``CATFIM_TODAY``; FEMA answers today's map (background).

:func:`flood_area` is the flood's map and bundle area: its ``bbox_lonlat`` (NWS polygons and member gauges) padded by
``FLOOD_AOI_PAD_M``, square, 8-60 km; a longer flood is cut to 60 km around its primary gauge (else its point) and
``aoi_note`` says so.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Any

from ..sources import nwps, nfhl as nfhl_src, water_maps as wm
from ..sources.nws import SourceBusy, SourceError
from . import copy as fcopy

log = logging.getLogger(__name__)

BBox = tuple[float, float, float, float]
FLOOD_AOI_PAD_M = 3000.0
FLOOD_AOI_MIN_M = 8000.0
FLOOD_AOI_MAX_M = 60000.0
CATFIM_CATEGORIES = ("action", "minor", "moderate", "major", "record")
AOI_CUT_NOTE = "Cut to {km:.0f} km around the {what}: this flood's NWS areas reach farther."


@dataclass
class FloodArea:
    center_lon: float
    center_lat: float
    extent_m: float
    bbox: BBox                       # lon/lat of the square (approximate; the bundle grid is the exact square)
    note: str | None


def _deg(m: float, lat: float) -> tuple[float, float]:
    return m / (111_320.0 * max(0.2, math.cos(math.radians(lat)))), m / 110_570.0


def flood_area(summary: dict) -> FloodArea:
    """The square area of a flood's maps and bundle (8-60 km; cut around the primary gauge when longer)."""
    w, s, e, n = (float(v) for v in summary["bbox_lonlat"])
    lat0 = (s + n) / 2
    width_m = (e - w) * 111_320.0 * math.cos(math.radians(lat0)) + 2 * FLOOD_AOI_PAD_M
    height_m = (n - s) * 110_570.0 + 2 * FLOOD_AOI_PAD_M
    side = max(width_m, height_m, FLOOD_AOI_MIN_M)
    note = None
    cx, cy = (w + e) / 2, lat0
    if side > FLOOD_AOI_MAX_M:
        pg = summary.get("primary_gauge")
        if pg:
            cx, cy, what = float(pg["lon"]), float(pg["lat"]), "primary river gauge"
        else:
            cx, cy, what = float(summary["lon"]), float(summary["lat"]), "flood's main point"
        side = FLOOD_AOI_MAX_M
        note = AOI_CUT_NOTE.format(km=side / 1000.0, what=what)
    dx, dy = _deg(side / 2, cy)
    return FloodArea(cx, cy, side, (round(cx - dx, 5), round(cy - dy, 5), round(cx + dx, 5), round(cy + dy, 5)), note)


def member_lids(summary: dict) -> list[str]:
    return [g["lid"] for g in summary.get("gauges") or [] if g.get("lid")]


def default_catfim(summary: dict) -> tuple[str | None, str | None]:
    """(lid, category) of the CatFIM map to show: the primary gauge's NWS forecast category, else its observed one
    (minor or worse); (None, None) when it has neither (D22)."""
    pg = summary.get("primary_gauge") or {}
    for cat in (pg.get("forecast_category"), pg.get("observed_category")):
        if cat in ("minor", "moderate", "major"):
            return pg.get("lid"), cat
    return None, None


def _envelope(flood_id: str, now: int, source: dict, *, at_ms: int | None, status: str = "available",
              reason: str | None = None, reason_code: str | None = None, retrieved: int | None = None,
              updated: int | None = None, caveats: list[str] | None = None) -> dict:
    return {"kind": "flood_map", "status": status, "reason_code": reason_code, "reason": reason, "source": dict(source),
            "retrieved_ms": retrieved, "source_updated_ms": updated, "requested_at_ms": at_ms, "now_ms": now,
            "flood_id": flood_id, "synthetic": False, "caveats": list(caveats or [])}


def _empty_fc() -> dict:
    return {"type": "FeatureCollection", "features": []}


def _is_past(at_ms: int | None, now: int) -> bool:
    return at_ms is not None and at_ms < now - 6 * 3_600_000


# ----------------------------------------------------------------------------------------------------------------
# Official maps
# ----------------------------------------------------------------------------------------------------------------
def rfc_fim_answer(summary: dict, *, now: int, at_ms: int | None = None, area: BBox | None = None) -> dict:
    """The NWS forecast flooded area (next 5 days, experimental) over the flood's area, with ``stats`` from the
    member gauges' reaches only (null when that join fails; C6)."""
    fid = summary["id"]
    box = area or flood_area(summary).bbox
    base = {"map": "rfc_fim", "coverage_note": fcopy.RFC_FIM_NOTE, "outside_note": fcopy.RFC_FIM_OUTSIDE,
            "experimental": True, "category": None, "min_zoom": None, "reference_ms": None, "updated_ms": None,
            "stats": None, "features": _empty_fc()}
    if _is_past(at_ms, now):
        return {**_envelope(fid, now, fcopy.SOURCE_RFC_FIM, at_ms=at_ms, status="not_available_for_past_dates",
                            reason=fcopy.RFC_FIM_PAST, reason_code="past_date"), **base}
    try:
        lay = wm.rfc_fim(box)
    except SourceBusy:
        raise
    except SourceError as e:
        log.info("RFC FIM %s: %s", fid, e)
        return {**_envelope(fid, now, fcopy.SOURCE_RFC_FIM, at_ms=at_ms, status="unavailable",
                            reason=fcopy.RFC_FIM_UNAVAILABLE, reason_code="upstream_error"), **base}
    stats = None
    lids = member_lids(summary)
    if lids and lay.features:
        try:
            reaches, _ = wm.rfc_reaches(box)
            area_km2 = wm.member_area_km2(lay.features, wm.member_reaches(reaches, lids))
            stats = {"area_km2": area_km2} if area_km2 is not None else None
        except SourceBusy:
            raise
        except SourceError as e:
            log.info("RFC FIM reaches %s: %s", fid, e)
    return {**_envelope(fid, now, fcopy.SOURCE_RFC_FIM, at_ms=at_ms, retrieved=lay.fetched_ms, updated=lay.updated_ms),
            **base, "features": lay.collection(), "reference_ms": lay.reference_ms, "updated_ms": lay.updated_ms,
            "stats": stats}


def catfim_answer(summary: dict, *, now: int, lid: str | None = None, category: str | None = None,
                  at_ms: int | None = None) -> dict:
    """NWS category flood maps (experimental static library) for one gauge and category: by default the primary
    gauge's forecast category, else its observed one. Past times answer today's library with ``CATFIM_TODAY``."""
    fid = summary["id"]
    d_lid, d_cat = default_catfim(summary)
    lid = (lid or d_lid or "").upper() or None
    cat = (category or d_cat or "").lower() or None
    base = {"map": "catfim", "coverage_note": fcopy.catfim_note(cat or "flood"), "outside_note": None,
            "experimental": True, "category": cat if cat in ("action", "minor", "moderate", "major") else None,
            "min_zoom": None, "reference_ms": None, "updated_ms": None, "stats": None, "features": _empty_fc()}
    caveats = [fcopy.CATFIM_TODAY] if _is_past(at_ms, now) else []
    if lid is None or cat not in CATFIM_CATEGORIES:
        return {**_envelope(fid, now, fcopy.SOURCE_CATFIM, at_ms=at_ms, status="unavailable",
                            reason=fcopy.CATFIM_UNAVAILABLE, reason_code="not_covered", caveats=caveats), **base}
    try:
        lay = wm.catfim(lid, cat)
    except ValueError:
        return {**_envelope(fid, now, fcopy.SOURCE_CATFIM, at_ms=at_ms, status="unavailable",
                            reason=fcopy.CATFIM_UNAVAILABLE, reason_code="not_covered", caveats=caveats), **base}
    except SourceBusy:
        raise
    except SourceError as e:
        log.info("CatFIM %s %s: %s", lid, cat, e)
        return {**_envelope(fid, now, fcopy.SOURCE_CATFIM, at_ms=at_ms, status="unavailable",
                            reason=fcopy.CATFIM_UNAVAILABLE, reason_code="upstream_error", caveats=caveats), **base}
    return {**_envelope(fid, now, fcopy.SOURCE_CATFIM, at_ms=at_ms, retrieved=lay.fetched_ms, caveats=caveats), **base,
            "features": lay.collection()}


def nfhl_answer(summary: dict, *, now: int, at_ms: int | None = None, area: BBox | None = None) -> dict:
    """FEMA's 1 % floodplain (with floodway) and 0.2 % band over the flood's area (background), with ``availability``
    (layer 0) and the effective dates (layer 3). ``NFHL_DOWN`` when FEMA cannot be read."""
    fid = summary["id"]
    box = area or flood_area(summary).bbox
    base = {"map": "nfhl", "coverage_note": fcopy.NFHL_NOTE, "outside_note": None, "experimental": False,
            "category": None, "min_zoom": None, "reference_ms": None, "updated_ms": None, "stats": None,
            "features": _empty_fc(), "availability": None, "effective_min_ms": None, "effective_max_ms": None}
    try:
        res = nfhl_src.nfhl(box)
    except SourceBusy:
        raise
    except SourceError as e:
        log.info("NFHL %s: %s", fid, e)
        return {**_envelope(fid, now, fcopy.SOURCE_NFHL, at_ms=at_ms, status="unavailable", reason=fcopy.NFHL_DOWN,
                            reason_code="upstream_error"), **base}
    caveats = []
    if res.availability == "no_digital_map":
        caveats.append(fcopy.NFHL_NO_MAP)
    elif res.availability == "unknown":
        caveats.append(fcopy.NFHL_PARTLY_MAPPED)
    if "truncated" in res.notes:
        caveats.append(fcopy.NFHL_TRUNCATED)
    return {**_envelope(fid, now, fcopy.SOURCE_NFHL, at_ms=at_ms, retrieved=res.fetched_ms, updated=res.effective_max_ms,
                        caveats=caveats),
            **base, "features": res.collection(), "updated_ms": res.effective_max_ms, "availability": res.availability,
            "effective_min_ms": res.effective_min_ms, "effective_max_ms": res.effective_max_ms}


def map_answer(kind: str, summary: dict, *, now: int, lid: str | None = None, category: str | None = None,
               at_ms: int | None = None, area: BBox | None = None) -> dict:
    if kind == "rfc_fim":
        return rfc_fim_answer(summary, now=now, at_ms=at_ms, area=area)
    if kind == "catfim":
        return catfim_answer(summary, now=now, lid=lid, category=category, at_ms=at_ms)
    if kind == "nfhl":
        return nfhl_answer(summary, now=now, at_ms=at_ms, area=area)
    raise ValueError(f"unknown map kind {kind!r}")


# ----------------------------------------------------------------------------------------------------------------
# Model output (never official)
# ----------------------------------------------------------------------------------------------------------------
SERIES_NAMES = ("analysis_assimilation", "short_range", "medium_range_blend")


def _model(kind: str, flood_id: str | None, now: int, *, status: str = "available", reason: str | None = None,
           retrieved: int | None = None, reference: int | None = None, updated: int | None = None,
           features: dict | None = None, series: list | None = None, reach_id: str | None = None,
           lid: str | None = None) -> dict:
    return {"kind": kind, "model_output": True, "label": fcopy.MODEL_LABEL, "status": status, "reason": reason,
            "source": dict(fcopy.SOURCE_NWM), "retrieved_ms": retrieved, "reference_ms": reference, "updated_ms": updated,
            "features": features, "series": series, "reach_id": reach_id, "lid": lid, "now_ms": now,
            "flood_id": flood_id, "synthetic": False, "caveats": [fcopy.MODEL_CAVEAT]}


def model_answer(kind: str, summary: dict, *, now: int, lid: str | None = None, at_ms: int | None = None,
                 area: BBox | None = None) -> dict:
    """National Water Model output for the flood (``nwm_analysis`` / ``nwm_5day`` / ``nwm_high_flow`` maps over its
    area, or ``nwm_series`` for one gauge's reach: analysis, short range and medium-range blend)."""
    fid = summary["id"]
    if _is_past(at_ms, now):
        return _model(kind, fid, now, status="not_available_for_past_dates", reason=fcopy.MODEL_PAST, lid=lid)
    if kind == "nwm_series":
        return _series_answer(fid, now, lid or ((summary.get("primary_gauge") or {}).get("lid")))
    if kind not in wm.NWM_LAYERS:
        raise ValueError(f"unknown model kind {kind!r}")
    box = area or flood_area(summary).bbox
    try:
        lay = wm.nwm_layer(kind, box)
    except SourceBusy:
        raise
    except SourceError as e:
        log.info("NWM %s %s: %s", kind, fid, e)
        return _model(kind, fid, now, status="unavailable", reason=fcopy.MODEL_DOWN)
    return _model(kind, fid, now, retrieved=lay.fetched_ms, reference=lay.reference_ms, updated=lay.updated_ms,
                  features=lay.collection())


def _series_answer(fid: str | None, now: int, lid: str | None) -> dict:
    if not lid:
        return _model("nwm_series", fid, now, status="unavailable", reason=fcopy.MODEL_NO_REACH)
    lid = lid.upper()
    try:
        detail, _ = nwps.gauge(lid)
    except SourceBusy:
        raise
    except SourceError as e:
        log.info("NWM series %s: %s", lid, e)
        return _model("nwm_series", fid, now, status="unavailable", reason=fcopy.MODEL_DOWN, lid=lid)
    reach = nwps._text(detail.get("reachId"))
    if not reach:
        return _model("nwm_series", fid, now, status="unavailable", reason=fcopy.MODEL_NO_REACH, lid=lid)
    series: list[dict] = []
    fetched: list[int] = []
    for name in SERIES_NAMES:
        try:
            doc, t = nwps.reach_streamflow(reach, name)
        except SourceBusy:
            raise
        except SourceError as e:
            log.info("NWM %s %s: %s", reach, name, e)
            continue
        s = nwps.nwm_series(doc, name)
        if s is not None:
            series.append(s)
            fetched.append(t)
    if not series:
        return _model("nwm_series", fid, now, status="unavailable", reason=fcopy.MODEL_DOWN, reach_id=reach, lid=lid)
    return _model("nwm_series", fid, now, retrieved=min(fetched), reference=max(s["reference_ms"] for s in series),
                  series=series, reach_id=reach, lid=lid)


_ = (Any,)
