"""FEMA National Flood Hazard Layer (effective) for floods, as **background** only (brief 5; PLAN-5 D16, D21, 3.3;
CONTRACT 16.4).

``hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer`` (ArcGIS; GeoJSON queries by envelope):

* layer 0 "NFHL Availability" decides whether FEMA has a digital flood map for the area (:func:`availability`):
  ``mapped`` (the area is covered), ``no_digital_map`` (no availability polygon touches it) or ``unknown`` (partly
  covered, or the layer could not be read). The web says "Not in FEMA's mapped 1% floodplain" only where it is
  ``mapped`` (C19);
* layer 3 "FIRM Panels" gives the effective dates (``EFF_DATE``, oldest and newest over the area;
  :func:`effective_dates`), shown "effective {date}";
* layer 28 "Flood Hazard Zones": **only** the 1%-annual-chance floodplain (``SFHA_TF = 'T'``, with the floodway) and the
  0.2 % band (``ZONE_SUBTY LIKE '0.2%'``): :func:`zones`. Zone X "AREA OF MINIMAL FLOOD HAZARD" is never requested and,
  should a row slip through, never kept (FEMA's own words would put "minimal hazard" on the map; CLAUDE.md).

FEMA's connection resets often (8 of 14 tries in the audit): 4 tries with backoff (``fire3d.http``), a 30-day cache
(the maps change by revisions, not daily) and an outage memory (:data:`NFHL_DOWN`, 60 s). The GeoJSON has no zoom limit
(FEMA's 1:36,112 limit is for its export images, which Fire-3d does not use): ``min_zoom`` is always null. Errors raise
``nws.SourceError`` / ``SourceBusy``; the bundle and the maps route turn them into ``NFHL_DOWN``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import shapely
from shapely.geometry import box, shape

from .. import http as fhttp
from .nws import SourceError
from .water_maps import BBox, _km_area, _num, _props, _text, arcgis_query, envelope, esri_time_ms

log = logging.getLogger(__name__)

NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer"
NFHL_HOST = "hazards.fema.gov"
AVAILABILITY_LAYER, PANELS_LAYER, ZONES_LAYER = 0, 3, 28
ZONE_WHERE = "SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2%'"
ZONE_FIELDS = "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE"
NFHL_TTL_S = 30 * 86400.0
NFHL_TIMEOUT_S = 40.0
NFHL_RETRIES = 3                  # 4 tries in all, with fire3d.http's backoff (about 1.5, 3, 6 s)
SIMPLIFY_DEG = 0.0002
MAPPED_MIN_SHARE = 0.98           # the availability polygons cover at least this share of the area -> "mapped"
NFHL_LIMITER = fhttp.RateLimiter(20, 60.0, "floods: FEMA NFHL")
NFHL_DOWN = fhttp.DownMemo("floods: FEMA NFHL")
_NAME = "FEMA's flood map service (NFHL)"

# Floodplain codes (CONTRACT 16.3 floodplain.bin): 0 none, 1 0.2 % band, 2 SFHA, 3 floodway
CODE_BAND, CODE_SFHA, CODE_FLOODWAY = 1, 2, 3


def _q(layer: int, params: dict[str, str], order_by: str = "OBJECTID") -> tuple[list[dict], int]:
    return arcgis_query(f"{NFHL}/{layer}", params, ttl_s=NFHL_TTL_S, limiter=NFHL_LIMITER, name=_NAME, down=NFHL_DOWN,
                        host=NFHL_HOST, order_by=order_by, timeout=NFHL_TIMEOUT_S, retries=NFHL_RETRIES)


def zone_code(props: dict) -> int:
    """0 (not shown), 1 0.2 % band, 2 SFHA, 3 floodway, from FEMA's ``SFHA_TF`` and ``ZONE_SUBTY``."""
    sub = (str(props.get("ZONE_SUBTY") or props.get("zone_subty") or "")).upper()
    sfha = str(props.get("SFHA_TF") or props.get("sfha") or "").upper() == "T"
    if "MINIMAL" in sub:
        return 0
    if sfha and "FLOODWAY" in sub:
        return CODE_FLOODWAY
    if sfha:
        return CODE_SFHA
    if sub.startswith("0.2"):
        return CODE_BAND
    return 0


def parse_zone(f: Any) -> dict | None:
    """A layer-28 feature -> ``{fld_zone, zone_subty, sfha, static_bfe}`` (FEMA's values verbatim) with an internal
    ``code``; None for anything outside the SFHA and the 0.2 % band (never zone X "minimal")."""
    p = _props(f)
    code = zone_code(p)
    g = f.get("geometry") if isinstance(f, dict) else None
    if code == 0 or not isinstance(g, dict):
        return None
    return {"type": "Feature", "geometry": g,
            "properties": {"fld_zone": _text(p.get("FLD_ZONE")), "zone_subty": _text(p.get("ZONE_SUBTY")),
                           "sfha": (_text(p.get("SFHA_TF")) or "").upper() or None, "static_bfe": _num(p.get("STATIC_BFE")),
                           "code": code}}


def zones(bbox: BBox) -> tuple[list[dict], int]:
    """The SFHA (with floodway) and 0.2 % band polygons in ``bbox`` (simplified to about 20 m)."""
    params = {**envelope(bbox), "where": ZONE_WHERE, "outFields": ZONE_FIELDS, "returnGeometry": "true",
              "outSR": "4326", "f": "geojson", "geometryPrecision": "5", "maxAllowableOffset": f"{SIMPLIFY_DEG:g}"}
    raw, fetched = _q(ZONES_LAYER, params)
    feats = [z for z in (parse_zone(f) for f in raw) if z]
    for i, z in enumerate(feats):
        z["id"] = f"nfhl-{i}"
    return feats, fetched


def availability(bbox: BBox) -> tuple[str, int]:
    """(``mapped`` | ``no_digital_map`` | ``unknown``, fetched_ms) from layer 0 over ``bbox``."""
    params = {**envelope(bbox), "where": "1=1", "outFields": "STUDY_ID", "returnGeometry": "true", "outSR": "4326",
              "f": "geojson", "geometryPrecision": "4", "maxAllowableOffset": "0.002"}
    raw, fetched = _q(AVAILABILITY_LAYER, params)
    area = box(*bbox)
    geoms = []
    for f in raw:
        try:
            if isinstance(f.get("geometry"), dict):
                geoms.append(shape(f["geometry"]).buffer(0))
        except (ValueError, TypeError, AttributeError):
            continue
    if not geoms:
        return "no_digital_map", fetched
    covered = shapely.union_all(geoms).intersection(area)
    share = _km_area(covered) / max(_km_area(area), 1e-9)
    return ("mapped" if share >= MAPPED_MIN_SHARE else "unknown"), fetched


def effective_dates(bbox: BBox) -> tuple[int | None, int | None, int]:
    """(oldest EFF_DATE, newest EFF_DATE, fetched_ms) of the FIRM panels over ``bbox`` (layer 3)."""
    params = {**envelope(bbox), "where": "1=1", "outFields": "EFF_DATE", "returnGeometry": "false", "f": "geojson"}
    raw, fetched = _q(PANELS_LAYER, params)
    dates = [t for t in (esri_time_ms(_props(f).get("EFF_DATE")) for f in raw) if t]
    return (min(dates) if dates else None), (max(dates) if dates else None), fetched


@dataclass
class NfhlResult:
    """Everything the maps route and the bundle need for FEMA's floodplain over an area."""

    features: list[dict]
    availability: str
    effective_min_ms: int | None
    effective_max_ms: int | None
    fetched_ms: int
    notes: list[str] = field(default_factory=list)

    def collection(self) -> dict:
        """The features as served (``{fld_zone, zone_subty, sfha, static_bfe}``; the internal code dropped)."""
        return {"type": "FeatureCollection",
                "features": [{**f, "properties": {k: v for k, v in f["properties"].items() if k != "code"}}
                             for f in self.features]}


def nfhl(bbox: BBox) -> NfhlResult:
    """Zones, availability and effective dates for ``bbox``. The zones are required (SourceError when they cannot be
    read); availability and dates fall back to ``unknown`` / None with a note."""
    feats, fetched = zones(bbox)
    notes: list[str] = []
    try:
        avail, _ = availability(bbox)
    except SourceError as e:
        log.info("NFHL availability: %s", e)
        avail = "unknown"
        notes.append("availability unknown")
    try:
        eff_min, eff_max, _ = effective_dates(bbox)
    except SourceError as e:
        log.info("NFHL effective dates: %s", e)
        eff_min = eff_max = None
        notes.append("effective dates unknown")
    if feats and avail == "no_digital_map":
        avail = "unknown"             # zones but no availability polygon: do not claim either way
    return NfhlResult(feats, avail, eff_min, eff_max, fetched, notes)


def reset_state() -> None:
    NFHL_DOWN.reset()
