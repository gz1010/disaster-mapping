"""NWS flood products for one flood or one area (``FloodAlertsResponse``, CONTRACT 16.4; PLAN-5 2, 3.8, D24, C9, C27),
shared by ``/api/official/flood-alerts`` and the bundle's ``warnings.json``.

* The products come from the one national request the flood list also uses (``nws.flood_active``, cached 2 min, on the
  shared NWS limiter): every actual product in effect or upcoming in the lower 48 + DC, verbatim (headline,
  description, instruction, area, sender, times, link), with its own IANA zone. **Every** product is answered for an
  area query, watches included (the list's "Show watches" never filters a point check; C27). A flood query answers the
  products of the flood's own events (by VTEC key, else CAP id), and its attached watches.
* Zone-based products (most watches) have no polygon: their outlines are fetched on demand, **at most**
  :data:`ZONE_FETCH_MAX` zones per answer (``/zones/{county|forecast}/{UGC}``, cached 30 days); the rest are drawn as
  whole counties from the packaged county shapes (their CAP SAME codes) and the answer says ``ZONES_AS_COUNTIES``.
  Whether a zone-based product touches an area is decided offline from its counties (no request).
* ``hvtec`` (the river gauge the product names): from the product text, read on demand for a flood's own river
  products (at most :data:`HVTEC_FETCH_MAX`, cached for good), else from caches only.
* ``flood_ids``: the listed floods each product belongs to (from the live list).
* NWS unreachable -> ``unavailable`` with ``ALERTS_UNAVAILABLE`` (never ``NO_PRODUCT``; D24). A cached earlier copy is
  used first (``stale`` caveat). Past times are not served yet (``ALERTS_PAST_NOT_YET``; the IEM archive comes with
  backend-flood-live).
"""

from __future__ import annotations

import logging
from typing import Any, Iterable

import shapely
from shapely.geometry import Point, box, mapping

from .. import regions
from ..sources import nws
from ..sources.nws import SourceBusy, SourceError
from . import catalog
from . import copy as fcopy
from . import grouping as G

log = logging.getLogger(__name__)

BBox = tuple[float, float, float, float]
ZONE_FETCH_MAX = 20
HVTEC_FETCH_MAX = 6
PAST_TOLERANCE_MS = 6 * 3_600_000
_SIG = {"W": 0, "Y": 1, "A": 2}


def _order(a: dict) -> tuple:
    v = a.get("vtec") or {}
    return (0 if a.get("emergency") else 1, _SIG.get(v.get("significance"), 3), -(a.get("sent_ms") or 0), a["id"])


def _national(now: int) -> tuple[list[dict], int | None, int | None, bool]:
    """(kept lower-48 products with phase, fetched_ms, NWS updated_ms, stale). Raises SourceError when neither a fresh
    nor an earlier copy can be read."""
    stale = False
    try:
        ans = nws.flood_active()
        alerts, fetched, updated = ans.alerts, ans.fetched_ms, ans.updated_ms
    except SourceBusy:
        raise
    except SourceError:
        old = catalog._stale_alerts()
        if old is None:
            raise
        alerts, fetched, updated, stale = old[0].alerts, old[1], None, True
    l48 = set(regions.L48)
    out = []
    for a in alerts:
        phase = nws.flood_phase(a, now)
        g = catalog.product_geom(a)
        gstates = regions.states_in_bbox(g.bounds) if g is not None else None
        if G.keep_product(a, phase, l48, gstates):
            out.append({**a, "phase": phase, "_geom": g})
    return out, fetched, updated, stale


def _flood_ids_by_product() -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """(CAP id -> flood ids, VTEC key -> flood ids) from the cached live list (never a new build here)."""
    by_id: dict[str, list[str]] = {}
    by_key: dict[str, list[str]] = {}
    try:
        lst = catalog.flood_list()
    except Exception as e:  # noqa: BLE001 - the list is only a label here
        log.info("flood-alerts: no list for flood ids (%s)", e)
        return by_id, by_key
    for s in lst.get("floods") or []:
        for p in s.get("products") or []:
            by_id.setdefault(p["id"], []).append(s["id"])
            if p.get("vtec_key"):
                by_key.setdefault(p["vtec_key"], []).append(s["id"])
    return by_id, by_key


def _public(a: dict, flood_ids: list[str], covers: bool | None, hvtec: dict | None) -> dict:
    tz = nws.alert_time_zone(a.get("_geom"), a.get("ugcs") or [], a.get("_same") or [])
    out = {k: v for k, v in a.items() if not k.startswith("_")}
    out.update(phase=a["phase"], time_zone=tz, covers_point=covers, flood_ids=sorted(set(flood_ids)), hvtec=hvtec)
    return out


def _zone_type(a: dict, ugc: str) -> str:
    return (a.get("_zone_types") or {}).get(ugc) or ("county" if len(ugc) == 6 and ugc[2] == "C" else "forecast")


def zone_features(alerts: list[dict], *, fetch_max: int = ZONE_FETCH_MAX) -> tuple[list[dict], bool]:
    """Zone outlines of the zone-based products: NWS zones first (at most ``fetch_max`` fetched), then whole counties
    (SAME codes). Returns (features ``{ugc, name, alert_ids}``, whether any was drawn as counties)."""
    feats: dict[str, dict] = {}
    as_counties = False
    fetched = 0
    shapes = catalog.county_geoms()
    for a in alerts:
        if a.get("_geometry") is not None:
            continue
        drawn_all = True
        for ugc in a.get("ugcs") or []:
            if ugc in feats:
                feats[ugc]["properties"]["alert_ids"].append(a["id"])
                continue
            z = None
            if fetched < fetch_max:
                fetched += 1
                try:
                    z = nws.nws_zone(ugc, _zone_type(a, ugc))
                except SourceBusy:
                    z = None
                except SourceError as e:
                    log.info("zone %s: %s", ugc, e)
                    z = None
            if z is None:
                drawn_all = False
                continue
            feats[ugc] = {"type": "Feature", "id": ugc, "geometry": nws.simplified(z.geom),
                          "properties": {"ugc": ugc, "name": z.name or ugc, "alert_ids": [a["id"]]}}
        if not drawn_all:
            for fips in catalog.zone_counties(a):
                g = shapes.get(fips)
                if g is None:
                    continue
                st = nws.STATE_BY_FIPS.get(fips[:2])
                code = f"{st}C{fips[2:]}" if st else fips
                if code in feats:
                    if a["id"] not in feats[code]["properties"]["alert_ids"]:
                        feats[code]["properties"]["alert_ids"].append(a["id"])
                    continue
                c = regions.county_at(g.representative_point().x, g.representative_point().y)
                feats[code] = {"type": "Feature", "id": code, "geometry": nws.simplified(g),
                               "properties": {"ugc": code, "name": (f"{c.name} County" if c else code),
                                              "alert_ids": [a["id"]]}}
                as_counties = True
    return list(feats.values()), as_counties


def _envelope(now: int, flood_id: str | None, *, at_ms: int | None, status: str = "available", reason: str | None = None,
              reason_code: str | None = None, retrieved: int | None = None, updated: int | None = None,
              caveats: list[str] | None = None) -> dict:
    return {"kind": "flood_alerts", "status": status, "reason_code": reason_code, "reason": reason,
            "source": dict(fcopy.SOURCE_NWS), "retrieved_ms": retrieved, "source_updated_ms": updated,
            "requested_at_ms": at_ms, "now_ms": now, "flood_id": flood_id, "synthetic": False,
            "caveats": list(caveats or [])}


def _empty(now: int, flood_id: str | None, area: BBox | None, states: list[str], *, at_ms: int | None, status: str,
           reason: str, reason_code: str) -> dict:
    return {**_envelope(now, flood_id, at_ms=at_ms, status=status, reason=reason, reason_code=reason_code),
            "alerts": [], "zones": {"type": "FeatureCollection", "features": []},
            "area_bbox": list(area) if area else None, "states_checked": states}


def _answer(selected: list[dict], *, now: int, flood_id: str | None, at_ms: int | None, fetched: int | None,
            updated: int | None, stale: bool, states: list[str], point: tuple[float, float] | None,
            area: BBox | None, hvtec_fetch: Iterable[str] = ()) -> dict:
    by_id, by_key = _flood_ids_by_product()
    zfeats, as_counties = zone_features(selected)
    zone_geoms: dict[str, list] = {}
    for f in zfeats:
        g = shapely.geometry.shape(f["geometry"])
        for aid in f["properties"]["alert_ids"]:
            zone_geoms.setdefault(aid, []).append(g)
    fetch = set(hvtec_fetch)
    out = []
    for a in sorted(selected, key=_order):
        hv = None
        if (a.get("vtec") or {}).get("phenomena") == "FL":
            hv = nws.cached_product_hvtec(a)
            if hv is None and a["id"] in fetch:
                try:
                    hv = nws.product_hvtec(a)
                except SourceError as e:              # SourceBusy included: the gauge link is optional
                    log.info("H-VTEC %s: %s", a["id"], e)
        covers = None
        if point is not None:
            geoms = [a["_geometry"]] if a.get("_geometry") is not None else zone_geoms.get(a["id"]) or (
                [a["_geom"]] if a.get("_geom") is not None else [])
            covers = any(g.covers(Point(*point)) for g in geoms if g is not None)
        fids = by_id.get(a["id"], []) + by_key.get(nws.vtec_key(a.get("vtec")) or "", [])
        out.append(_public(a, fids, covers, hv))
    caveats = []
    if as_counties:
        caveats.append(fcopy.ZONES_AS_COUNTIES)
    if stale:
        caveats.append(fcopy.STALE_NWS)
    geoms = [a["_geom"] for a in selected if a.get("_geom") is not None]
    if area is None and geoms:
        area = tuple(round(v, 5) for v in shapely.union_all(geoms).bounds)  # type: ignore[assignment]
    return {**_envelope(now, flood_id, at_ms=at_ms, retrieved=fetched, updated=updated, caveats=caveats),
            "alerts": out, "zones": {"type": "FeatureCollection", "features": zfeats},
            "area_bbox": list(area) if area else None, "states_checked": states}


def _past(at_ms: int | None, now: int) -> bool:
    return at_ms is not None and at_ms < now - PAST_TOLERANCE_MS


def flood_alerts(summary: dict, *, now: int, at_ms: int | None = None) -> dict:
    """``FloodAlertsResponse`` of one flood: the NWS products of its own events (VTEC key, else CAP id) and its
    attached watches, as NWS lists them now."""
    fid = summary["id"]
    states = list(summary.get("states") or ([summary["state"]] if summary.get("state") else []))
    area = tuple(summary["bbox_lonlat"])
    if _past(at_ms, now):
        return _empty(now, fid, area, states, at_ms=at_ms, status="not_available_for_past_dates",
                      reason=fcopy.ALERTS_PAST_NOT_YET, reason_code="past_date")
    try:
        prods, fetched, updated, stale = _national(now)
    except SourceBusy:
        raise
    except SourceError as e:
        log.info("flood-alerts %s: %s", fid, e)
        return _empty(now, fid, area, states, at_ms=at_ms, status="unavailable", reason=fcopy.ALERTS_UNAVAILABLE,
                      reason_code="upstream_error")
    keys = {p["vtec_key"] for p in summary.get("products") or [] if p.get("vtec_key")}
    ids = {p["id"] for p in summary.get("products") or []}
    selected = [a for a in prods if a["id"] in ids or (nws.vtec_key(a.get("vtec")) in keys)]
    river = [a["id"] for a in selected if (a.get("vtec") or {}).get("phenomena") == "FL"][:HVTEC_FETCH_MAX]
    return _answer(selected, now=now, flood_id=fid, at_ms=at_ms, fetched=fetched, updated=updated, stale=stale,
                   states=states, point=None, area=area, hvtec_fetch=river)


def bbox_alerts(bbox: BBox, *, now: int, at_ms: int | None = None) -> dict:
    """``FloodAlertsResponse`` of every NWS flood product touching ``bbox`` (a point when w == e and s == n; then
    ``covers_point`` says whether the product's area holds it). Watches included."""
    w, s, e, n = bbox
    is_point = (e - w) < 1e-9 and (n - s) < 1e-9
    states = regions.states_in_bbox(bbox, margin_km=1.0) if not is_point else (
        [st] if (st := regions.state_at(w, s)) else [])
    if _past(at_ms, now):
        return _empty(now, None, bbox, states, at_ms=at_ms, status="not_available_for_past_dates",
                      reason=fcopy.ALERTS_PAST_NOT_YET, reason_code="past_date")
    try:
        prods, fetched, updated, stale = _national(now)
    except SourceBusy:
        raise
    except SourceError as e:
        log.info("flood-alerts bbox: %s", e)
        return _empty(now, None, bbox, states, at_ms=at_ms, status="unavailable", reason=fcopy.ALERTS_UNAVAILABLE,
                      reason_code="upstream_error")
    q = Point(w, s) if is_point else box(w, s, e, n)
    selected = [a for a in prods if a.get("_geom") is not None and a["_geom"].intersects(q)]
    return _answer(selected, now=now, flood_id=None, at_ms=at_ms, fetched=fetched, updated=updated, stale=stale,
                   states=states, point=(w, s) if is_point else None, area=bbox)


_ = (mapping, Any)
