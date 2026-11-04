"""The live flood list (PLAN-5 3.2, CONTRACT 16.2 and 16.8): NWS flood products and river gauges grouped into floods.

**Inputs, five national requests per cold build** (at most :data:`MAX_LIST_UPSTREAM_REQUESTS`; C9): the NWS flood
products in the lower 48 + DC (``nws.flood_active``, on the shared NWS limiter, 2 min), ``riv_gauges`` layers 0 and 15
(gauges observed / forecast at action or worse), ``rfc_max_forecast`` (official RFC forecast points) and IEM's current
flood warnings (H-VTEC join keys only). Nothing per flood: no zone outline, no product text, no gauge detail, no
series (those are read on demand or by the live loop; here only from cache).

**Rules** (named constants in :mod:`.grouping`; each tested): 1 keep actual lower-48 products in effect or upcoming
and lower-48 gauges; 2 link gauges to river products (cached H-VTEC, else the IEM join, else the gauge inside the
polygon + 2 km on the river the text names); 3 join (same VTEC key, linked gauges, same river within 25 km, flash /
areal polygons overlapping 30 % or within 10 km and 12 h; river and flash never by distance); 4 watches never bridge:
they attach to every flood they overlap (zone-based ones by their SAME counties, no request), else form a flood at
level ``watch``; 5 a gauge at minor or worse with no product is a flood at level ``gauge_only``; 6 fields; 7 start;
8 end and status; 9 names (:mod:`.naming`); 10 stable ids (:mod:`.registry`); 11 sources and outages; 12 order
(:func:`.grouping.flood_rank`); 13 :func:`resolve` (live list -> year lists -> alias -> bundle -> last-known -> 404,
503 when the lists could not decide).

Outages: NWS down -> floods from gauges only (``FLOOD_NWS_DOWN``); gauges down -> from products only
(``FLOOD_GAUGES_DOWN``); both down -> the flood bundles on disk only (``FLOOD_LISTS_DOWN``). A failed source answers
from its last cached copy when there is one (``stale``). The list is cached 5 min, 60 s while degraded.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

import shapely
from shapely.geometry import Point

from .. import http as fhttp
from .. import regions
from ..sources import nwps, nws
from ..timeutil import now_ms
from . import copy as fcopy
from . import grouping as G
from . import naming, store
from . import registry as reg_mod

log = logging.getLogger(__name__)

LIST_TTL_S = 300.0
LIST_TTL_DEGRADED_S = 60.0
MAX_LIST_UPSTREAM_REQUESTS = 6
WATCHES_SHOWN_BY_DEFAULT = False
GAUGE_POINT_PAD_DEG = 0.02
# Backend-sent strings live in floods/copy.py (review BFS-R8); these names stay for the other roles' imports.
SOURCE_NAMES = fcopy.SOURCE_NAMES
RFC_DOWN = fcopy.RFC_DOWN
STALE_REASON = {"nws_alerts": fcopy.STALE_NWS, "nwps_gauges": fcopy.STALE_GAUGES, "rfc_forecasts": fcopy.STALE_RFC,
                "iem_archive": fcopy.STALE_IEM}
PAST_NOT_YET = fcopy.PAST_NOT_YET
MAIN_SOURCES = ("nws_alerts", "nwps_gauges", "rfc_forecasts")    # the ones whose outage shortens the list cache
_SIG_ORDER = {"W": 0, "Y": 1, "A": 2}


class ListsUnavailable(RuntimeError):
    """The flood lists could not decide about an id and nothing is on disk: HTTP 503 ``FLOOD_LISTS_503``."""

    def __init__(self) -> None:
        super().__init__(fcopy.FLOOD_LISTS_503)


class FloodNotFound(LookupError):
    """The resolution chain ended (the lists answered): HTTP 404."""


# ----------------------------------------------------------------------------------------------------------------
# Inputs
# ----------------------------------------------------------------------------------------------------------------
@dataclass
class SourceResult:
    data: Any = None
    retrieved_ms: int | None = None
    stale: bool = False
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.data is not None


@dataclass
class Inputs:
    alerts: SourceResult            # nws.FloodNational
    observed: SourceResult          # riv_gauges layer 0 rows
    forecast: SourceResult          # riv_gauges layer 15 rows
    rfc: SourceResult               # rfc_max_forecast rows
    iem: SourceResult               # IEM join keys


def _stale_features(url: str, params: Any) -> tuple[list, int] | None:
    hit = fhttp.peek_cache("GET", url, params, None)
    if hit is None:
        return None
    try:
        doc = hit.json()
    except ValueError:
        return None
    feats = doc.get("features") if isinstance(doc, dict) else None
    return (feats, int(hit.fetched_ms)) if isinstance(feats, list) else None


def _stale_alerts() -> tuple[nws.FloodNational, int] | None:
    got = _stale_features(nws.flood_url(), None)
    if got is None:
        return None
    alerts = [a for a in (nws.normalize_flood_alert(f) for f in got[0]) if a is not None and a["id"]]
    return nws.FloodNational(alerts, got[1], None, list(nws.national_states()), True), got[1]


def _stale_rows(url_params: tuple[str, Any], parse: Callable[[Any], Any]) -> tuple[list, int] | None:
    got = _stale_features(*url_params)
    if got is None:
        return None
    return [r for r in (parse(f) for f in got[0]) if r], got[1]


def _get(fetch: Callable[[], tuple[Any, int]], stale: Callable[[], tuple[Any, int] | None]) -> SourceResult:
    try:
        data, fetched = fetch()
        return SourceResult(data, fetched)
    except nws.SourceError as e:                      # SourceBusy included: Fire-3d's own limit
        log.warning("flood list source failed: %s", e)
        old = stale()
        if old is not None:
            return SourceResult(old[0], old[1], stale=True, error=str(e))
        return SourceResult(None, None, error=str(e))


def fetch_inputs() -> Inputs:
    """The five national requests (cached by ``fire3d.http``), each with its stale copy on failure."""
    def alerts() -> tuple[Any, int]:
        ans = nws.flood_active()
        return ans, ans.fetched_ms

    return Inputs(
        alerts=_get(alerts, _stale_alerts),
        observed=_get(lambda: nwps.riv_gauges_observed(G.GAUGE_SHOW_MIN),
                      lambda: _stale_rows(nwps.riv_gauges_query(0, nwps.status_where(G.GAUGE_SHOW_MIN)), nwps.parse_riv_row)),
        forecast=_get(lambda: nwps.riv_gauges_forecast(G.GAUGE_SHOW_MIN),
                      lambda: _stale_rows(nwps.riv_gauges_query(15, nwps.status_where(G.GAUGE_SHOW_MIN)), nwps.parse_riv_row)),
        rfc=_get(nwps.rfc_max_forecast, lambda: _stale_rows(nwps.rfc_max_forecast_query(), nwps.parse_rfc_row)),
        iem=_get(nwps.iem_current_flood_warnings,
                 lambda: _stale_rows((nwps.IEM_CURRENT_FLOOD_WARNINGS_URL, None), nwps.parse_iem_warning)),
    )


# ----------------------------------------------------------------------------------------------------------------
# Geometry helpers (county shapes for zone-based products: no request)
# ----------------------------------------------------------------------------------------------------------------
_county_lock = threading.Lock()
_county_geoms: dict[str, Any] | None = None
_FIPS_BY_STATE = {v: k for k, v in nws.STATE_BY_FIPS.items()}


def county_geoms() -> dict[str, Any]:
    """5-digit county FIPS -> polygon (lon/lat), from the packaged ``us_counties.geojson`` (``fire3d.regions``)."""
    global _county_geoms
    with _county_lock:
        if _county_geoms is None:
            lay = regions._layer("counties")
            _county_geoms = {str(p["fips"]): g for p, g in zip(lay.props, lay.geoms)}
        return _county_geoms


def zone_counties(a: dict) -> list[str]:
    """County FIPS of a zone-based product: its CAP SAME codes, else its county UGCs ("MOC095" -> "29095")."""
    fips = [c[1:] for c in a.get("_same") or [] if isinstance(c, str) and len(c) == 6]
    if not fips:
        for u in a.get("ugcs") or []:
            if len(u) == 6 and u[2] == "C" and u[:2] in _FIPS_BY_STATE:
                fips.append(_FIPS_BY_STATE[u[:2]] + u[3:])
    return list(dict.fromkeys(fips))


def product_geom(a: dict) -> Any:
    """The product polygon, else the union of its counties (SAME codes; ZONES_AS_COUNTIES); None when unknown."""
    if a.get("_geometry") is not None:
        return a["_geometry"]
    shapes = county_geoms()
    parts = [shapes[f] for f in zone_counties(a) if f in shapes]
    return shapely.union_all(parts) if parts else None


def _largest(geoms: list[Any]) -> Any:
    best = None
    for g in geoms:
        if g is None or g.is_empty:
            continue
        c = g.representative_point()
        area = G.to_km(g, c.x, c.y).area
        if best is None or area > best[0]:
            best = (area, g)
    return best[1] if best else None


# ----------------------------------------------------------------------------------------------------------------
# Gauges
# ----------------------------------------------------------------------------------------------------------------
def _gauge_name(location: str | None, waterbody: str | None, lid: str) -> str:
    """NWS fields verbatim: "Agency (Platte River)" from ``riv_gauges`` location and waterbody (the list has no NWPS
    gauge name; the detail views show NWPS's own)."""
    if location and waterbody and waterbody.lower() not in location.lower():
        return f"{location} ({waterbody})"
    return location or waterbody or lid


@dataclass
class GaugeInfo:
    lid: str
    ref: dict                      # FloodGaugeRef
    flow: float | None
    state: str | None
    coastal: bool = False          # may measure tidal or lake water (grouping.coastal_lids; review BFS-R2)


def gauge_infos(inp: Inputs, l48: set[str]) -> dict[str, GaugeInfo]:
    """Every gauge Fire-3d knows from the national answers (observed at action+, or forecast at action+)."""
    obs = {r["lid"]: r for r in (inp.observed.data or []) if G.keep_gauge(r, l48)}
    fc = {r["lid"]: r for r in (inp.forecast.data or []) if G.keep_gauge(r, l48)}
    rfc = {r["lid"]: r for r in (inp.rfc.data or [])}
    coastal = G.coastal_lids([*(inp.observed.data or []), *(inp.forecast.data or [])])
    out: dict[str, GaugeInfo] = {}
    for lid in set(obs) | set(fc) | {k for k, r in rfc.items() if r.get("lat") is not None}:
        o, f, r = obs.get(lid), fc.get(lid), rfc.get(lid)
        base = o or f
        if base is None:
            st = regions.state_at(r["lon"], r["lat"])
            if st not in l48:
                continue
            base = {"lid": lid, "name": r.get("name") or lid, "waterbody": None, "state": st, "lat": r["lat"], "lon": r["lon"]}
        if r is not None and r.get("max_status") in G.CATEGORY_ORDER:
            fcat, fval, fms, fiss = r["max_status"], r["max_value"], r["max_ms"], r["issued_ms"]
        elif f is not None:
            fcat, fval, fms, fiss = f["status"], f["value"], f["valid_ms"], f["forecast_issued_ms"]
        else:
            fcat = fval = fms = fiss = None
        ref = {
            "lid": lid, "name": _gauge_name(base.get("name"), base.get("waterbody"), lid), "waterbody": base.get("waterbody"),
            "state": base.get("state"), "lat": base["lat"], "lon": base["lon"],
            "observed_category": o["status"] if o else "unknown", "observed_value": o["value"] if o else None,
            "unit": (o or f or {}).get("unit") or ((r or {}).get("units")), "observed_ms": o["valid_ms"] if o else None,
            "forecast_category": fcat, "forecast_max_value": fval, "forecast_max_ms": fms, "forecast_issued_ms": fiss,
            "url": (o or f or {}).get("url") or nwps.gauge_page(lid),
        }
        out[lid] = GaugeInfo(lid, ref, o.get("flow") if o else None, base.get("state"), lid in coastal)
    return out


def gauge_only_caveat(members: list[GaugeInfo], nws_ok: bool) -> str:
    """``FloodSummary.caveat`` of a gauge-only flood, never claiming an NWS answer Fire-3d does not have: NWS could not
    be read -> ``ALERTS_UNAVAILABLE`` (review BFS-R4); a gauge that may measure tidal or lake water ->
    ``GAUGE_ONLY_COASTAL_CAVEAT`` (Fire-3d does not read NWS Coastal or Lakeshore Flood products, D1; BFS-R2); else
    ``GAUGE_ONLY_CAVEAT``."""
    if not nws_ok:
        return fcopy.ALERTS_UNAVAILABLE
    if any(gi.coastal for gi in members):
        return fcopy.GAUGE_ONLY_COASTAL_CAVEAT
    return fcopy.GAUGE_ONLY_CAVEAT


def gauge_crossing_ms(lid: str, minor: float | None) -> int | None:
    """When the latest run at or above flood stage began, from a **cached** NWPS series only (rule 7); None."""
    if minor is None:
        return None
    hit = fhttp.peek_cache("GET", nwps.stageflow_url(lid), None, None)
    if hit is None:
        return None
    try:
        rows = nwps.series_rows((hit.json() or {}).get("observed"))
    except (ValueError, AttributeError):
        return None
    start = None
    for t, v, _ in rows:
        if v is not None and v >= minor:
            start = start if start is not None else t
        elif v is not None:
            start = None
    return start


# ----------------------------------------------------------------------------------------------------------------
# Products
# ----------------------------------------------------------------------------------------------------------------
def product_key(a: dict) -> str:
    """The event key: the VTEC key, else the CAP references chain (its oldest identifier; NWS PNS 26-62)."""
    k = nws.vtec_key(a.get("vtec"))
    if k:
        return k
    refs = [r for r in a.get("_references") or [] if r.get("identifier")]
    if refs:
        oldest = min(refs, key=lambda r: (r.get("sent_ms") or 0, r["identifier"]))
        return f"CAP:{oldest['identifier']}"
    return f"CAP:{a['id']}"


def product_ref(a: dict, gauge_lids: list[str]) -> dict:
    return {"id": a["id"], "event": a["event"], "vtec_key": nws.vtec_key(a.get("vtec")), "sender_name": a.get("sender_name"),
            "phase": a["phase"], "sent_ms": a.get("sent_ms"), "onset_ms": a.get("onset_ms"),
            "ends_ms": a.get("ends_ms") if a.get("ends_ms") is not None else a.get("expires_ms"),
            "emergency": bool(a.get("emergency")), "damage_threat": a.get("damage_threat"),
            "gauge_lids": sorted(gauge_lids), "url": a.get("url"), "archived": bool(a.get("archived"))}


def _product_order(r: dict) -> tuple:
    sig = (r.get("vtec_key") or "...").split(".")[2] if r.get("vtec_key") else "W"
    return (0 if r["emergency"] else 1, _SIG_ORDER.get(sig, 3), -(r.get("sent_ms") or 0), r["id"])


def texts_of(a: dict) -> list[str]:
    return [t for t in (a.get("description"), a.get("nws_headline"), a.get("headline")) if t]


# ----------------------------------------------------------------------------------------------------------------
# Build
# ----------------------------------------------------------------------------------------------------------------
@dataclass
class _Flood:
    pids: list[str]
    lids: list[str]
    watches: list[str]


def group(inp: Inputs, now: int, reg: reg_mod.Registry | None = None
          ) -> tuple[dict[str, dict], dict[str, GaugeInfo], dict[str, set[str]], list[_Flood], int]:
    """Rules 1-5: (products kept, gauges known, gauge links per product, floods as member lists, products in effect).
    While NWS cannot be read, gauges whose open episodes belong to one flood id stay joined (``reg``; review BFS-R4):
    the products that tied them are unknown, not gone."""
    l48 = set(regions.L48)
    prods: dict[str, dict] = {}
    geoms: dict[str, Any] = {}
    alerts = inp.alerts.data.alerts if inp.alerts.ok else []
    for a in alerts:
        phase = nws.live_phase(a, now)
        g = product_geom(a)
        gstates = regions.states_in_bbox(g.bounds) if g is not None else None
        if not G.keep_product(a, phase, l48, gstates):
            continue
        prods[a["id"]] = {**a, "phase": phase}
        geoms[a["id"]] = g
    in_effect = sum(1 for a in prods.values() if a["phase"] == "in_effect")
    gauges = gauge_infos(inp, l48)
    observed = {lid for lid, gi in gauges.items() if gi.ref["observed_category"] in G.CATEGORY_ORDER}
    iem: dict[tuple, set[str]] = {}
    for k in inp.iem.data or []:
        iem.setdefault(k["key4"], set()).add(k["nwsli"])
    classes = {pid: G.product_class(a) for pid, a in prods.items()}

    # Rule 2: link gauges to river products (FL.*): cached H-VTEC, else the IEM join, else a gauge inside the polygon
    # (+ 2 km) on the river the text names. Areal products (FA.*) link the same way by place and the water their text
    # names ("Flooding along the Silver Creek"): a flooding gauge on that water inside the area is part of the flood.
    # The water may also be named only in the segment's own description ("* WHERE...The Little Colorado River from
    # Winslow to Leupp", "Flooding of the Little Colorado River"): its gauge inside the area is linked (BFS-R3).
    links: dict[str, set[str]] = {}
    for pid, a in prods.items():
        v = a.get("vtec") or {}
        ph = v.get("phenomena")
        if ph not in ("FL", "FA") or classes[pid] == "watch":
            continue
        lids: set[str] = set()
        if ph == "FL":
            hv = nws.cached_product_hvtec(a)
            lids = {hv["nwsli"]} if hv else set(iem.get((v.get("office"), "FL", v.get("significance"), v.get("etn")), set()))
        if not lids and geoms[pid] is not None:
            named = [naming.river_from_text(*texts_of(a)), naming.water_from_text(*texts_of(a))]
            rivers = [r for r in named if r]
            lids = {lid for lid in observed
                    if G.point_in_buffer(gauges[lid].ref["lon"], gauges[lid].ref["lat"], geoms[pid], G.LINK_BUFFER_KM)
                    and (any(G.river_matches(naming.clean_water(gauges[lid].ref["waterbody"]), r) for r in rivers)
                         or naming.text_names_water(gauges[lid].ref["waterbody"], a.get("description")))}
        links[pid] = lids

    # Rule 3: join
    uf = G.UnionFind()
    for pid in prods:
        uf.add("p:" + pid)
    for lid in observed:
        uf.add("g:" + lid)
    by_key: dict[str, list[str]] = {}
    for pid, a in prods.items():
        by_key.setdefault(product_key(a), []).append(pid)
    for pids in by_key.values():
        for p in pids[1:]:
            uf.union("p:" + pids[0], "p:" + p)
    for pid, lids in links.items():
        if classes[pid] == "watch":
            continue
        for lid in lids:
            if lid in gauges:
                uf.union("p:" + pid, "g:" + lid)
    river_nodes: list[tuple[str, str, Any]] = []
    for lid in observed:
        wb = gauges[lid].ref["waterbody"]
        if wb:
            river_nodes.append(("g:" + lid, wb, Point(gauges[lid].ref["lon"], gauges[lid].ref["lat"])))
    for pid, a in prods.items():
        if classes[pid] == "river" and geoms[pid] is not None:
            r = naming.river_from_text(*texts_of(a))
            if r:
                river_nodes.append(("p:" + pid, r, geoms[pid]))
    for i in range(len(river_nodes)):
        for j in range(i + 1, len(river_nodes)):
            (na, ra, ga), (nb, rb, gb) = river_nodes[i], river_nodes[j]
            if uf.find(na) != uf.find(nb) and G.same_river(ra, rb) and G.distance_km(ga, gb) <= G.SAME_RIVER_KM:
                uf.union(na, nb)
    areal = [pid for pid in prods if classes[pid] in ("flash", "areal") and geoms[pid] is not None]
    for i in range(len(areal)):
        for j in range(i + 1, len(areal)):
            a, b = areal[i], areal[j]
            if uf.find("p:" + a) == uf.find("p:" + b):
                continue
            near = (G.distance_km(geoms[a], geoms[b]) <= G.AREAL_NEAR_KM       # issue times, not update times (R7)
                    and abs((G.issued_ms(prods[a]) or 0) - (G.issued_ms(prods[b]) or 0)) <= G.AREAL_NEAR_H * G.H_MS)
            if near or G.overlap_share(geoms[a], geoms[b]) >= G.AREAL_OVERLAP:
                uf.union("p:" + a, "p:" + b)
    if reg is not None and not inp.alerts.ok:                 # NWS cannot be read: keep each flood's gauges together
        by_id: dict[str, list[str]] = {}
        for lid in sorted(observed):
            fid = reusable_episode(reg, lid, now)[1]
            if fid:
                by_id.setdefault(fid, []).append(lid)
        for lids_ in by_id.values():
            for other in lids_[1:]:
                uf.union("g:" + lids_[0], "g:" + other)

    # Floods (rules 4-5): a component starts a flood with a non-watch product or a gauge at minor or worse
    floods: list[_Flood] = []
    watch_groups: list[list[str]] = []
    for comp in uf.groups():
        pids = [x[2:] for x in comp if x.startswith("p:")]
        lids = [x[2:] for x in comp if x.startswith("g:")]
        starts = any(classes[p] != "watch" for p in pids) or any(
            G.cat_rank(gauges[lid].ref["observed_category"]) >= G.cat_rank(G.GAUGE_EVENT_MIN) for lid in lids)
        if starts:
            extra = sorted({lid for p in pids for lid in links.get(p, ()) if lid in gauges and lid not in lids})
            floods.append(_Flood(pids, sorted(lids) + extra, []))
        elif pids:
            watch_groups.append(pids)
    # Rule 4: watches attach to every flood they overlap, else form their own flood
    shapes = []
    for f in floods:
        parts = [geoms[p] for p in f.pids if geoms[p] is not None]
        parts += [Point(gauges[lid].ref["lon"], gauges[lid].ref["lat"]).buffer(0.02) for lid in f.lids if lid in gauges]
        shapes.append(shapely.union_all(parts) if parts else None)
    for pids in watch_groups:
        wg = [geoms[p] for p in pids if geoms[p] is not None]
        wgeom = shapely.union_all(wg) if wg else None
        hit = [i for i, s in enumerate(shapes) if wgeom is not None and s is not None and wgeom.intersects(s)]
        if hit:
            for i in hit:
                floods[i].watches.extend(pids)
        else:
            floods.append(_Flood(pids, sorted({lid for p in pids for lid in links.get(p, ()) if lid in gauges}), []))
    for pid in prods:
        prods[pid]["_geom"] = geoms[pid]
    return prods, gauges, links, floods, in_effect


def _members(f: _Flood, gauges: dict[str, GaugeInfo]) -> list[GaugeInfo]:
    """Member gauges at action or above (observed), or forecast at minor or worse; primary first (rule 6)."""
    ms = [gauges[lid] for lid in f.lids if lid in gauges and (
        G.cat_rank(gauges[lid].ref["observed_category"]) >= 0 or G.cat_rank(gauges[lid].ref["forecast_category"]) >= 1)]
    ms.sort(key=lambda gi: (-G.cat_rank(gi.ref["observed_category"]), -G.cat_rank(gi.ref["forecast_category"]),
                            -(gi.flow or 0.0), gi.lid))
    return ms


def summarize(f: _Flood, prods: dict[str, dict], gauges: dict[str, GaugeInfo], links: dict[str, set[str]], now: int,
              obs_rows: dict[str, dict], nws_ok: bool = True) -> dict:
    """Rule 6-9 fields of one flood (``id``, ``aliases``, bundle state and ``started`` from the registry come later).
    ``nws_ok``: the NWS products could be read (fresh or an earlier copy); else no caveat claims their absence."""
    own = [prods[p] for p in f.pids]
    attached = [prods[p] for p in dict.fromkeys(f.watches) if p not in f.pids]
    products = own + attached
    members = _members(f, gauges)
    refs = [gi.ref for gi in members]
    classes = [G.product_class(a) for a in products]
    phs = {(a.get("vtec") or {}).get("phenomena") for a in products}
    kind = "river" if ("FL" in phs or refs) else ("flash" if any(c == "flash" for c in classes) else "areal")
    levels = [G.product_level(a) for a in products]
    level = max(levels, key=G.LEVEL_ORDER.index) if levels else "gauge_only"
    geoms = [a["_geom"] for a in products if a.get("_geom") is not None]
    big = _largest([a["_geom"] for a in own if a.get("_geom") is not None]) or _largest(geoms)
    if refs:
        lon, lat = refs[0]["lon"], refs[0]["lat"]
    elif big is not None:
        rp = big.representative_point()
        lon, lat = round(rp.x, 5), round(rp.y, 5)
    else:
        lon, lat = 0.0, 0.0
    parts = [a["_geom"] for a in own if a.get("_geom") is not None] + [Point(r["lon"], r["lat"]) for r in refs]
    if not parts:
        parts = geoms
    u = shapely.union_all(parts) if parts else Point(lon, lat)
    w, s, e, n = u.bounds
    if e - w < 1e-6 or n - s < 1e-6:
        w, s, e, n = w - GAUGE_POINT_PAD_DEG, s - GAUGE_POINT_PAD_DEG, e + GAUGE_POINT_PAD_DEG, n + GAUGE_POINT_PAD_DEG
    bbox = [math.floor(w * 1e5) / 1e5, math.floor(s * 1e5) / 1e5, math.ceil(e * 1e5) / 1e5, math.ceil(n * 1e5) / 1e5]
    state = regions.state_at(lon, lat)
    l48 = set(regions.L48)
    states = {u_[:2] for a in own for u_ in a.get("ugcs") or []} & l48
    states |= {r["state"] for r in refs if r.get("state")} | ({state} if state else set())
    county = regions.county_at(lon, lat)
    tz = regions.time_zone_at(lon, lat) or (regions.main_zone(state) if state else None) or "UTC"
    rivers = list(dict.fromkeys([w for w in (naming.clean_water(r.get("waterbody")) for r in refs) if w]
                                + [r for r in (naming.river_from_text(*texts_of(a)) for a in own) if r]))
    pref = sorted((product_ref(a, sorted(links.get(a["id"], set()))) for a in products), key=_product_order)
    sent = [a["sent_ms"] for a in products if a.get("sent_ms")]
    readings = [r["observed_ms"] for r in refs if r.get("observed_ms")]
    ends = [r["ends_ms"] for r in pref if r["phase"] in ("in_effect", "upcoming") and r.get("ends_ms")]
    in_flood = [r for r in refs if G.cat_rank(r["observed_category"]) >= 1]
    cats = [c for r in refs for c in (r["observed_category"], r["forecast_category"]) if c in G.CATEGORY_ORDER]
    recent = any(r["observed_ms"] and r["observed_ms"] >= now - G.GAUGE_ACTIVE_H * G.H_MS for r in in_flood)
    active = any(r["phase"] in ("in_effect", "upcoming") for r in pref) or recent
    ended = None
    if not active:
        ended = max([*(r.get("ends_ms") or 0 for r in pref), *(r["observed_ms"] or 0 for r in in_flood)], default=0) or None
    place_geom = big if big is not None else Point(lon, lat).buffer(0.05)
    cname = county.name if county else None
    name = naming.flood_name(kind=kind, level=level, rivers=[w for w in (naming.clean_water(r.get("waterbody")) for r in refs) if w],
                             texts=[t for a in own for t in texts_of(a)],
                             area_desc=next((a.get("area_desc") for a in products), None), geom=place_geom, county=cname)
    place = naming.place_in(place_geom, cname)
    alt = (f"{place} flash flood" if kind == "flash" else f"{place} flood") if place and "fire" not in place.lower() else None
    # Rule 7 (product part): a NEW product's VTEC begin, the oldest referenced message, a NEW product's own time
    starts: list[int] = []
    for a in own:
        v = a.get("vtec") or {}
        if v.get("action") == "NEW":
            starts += [t for t in (a.get("_vtec_begin_ms"), a.get("sent_ms")) if t]
        starts += [r["sent_ms"] for r in a.get("_references") or [] if r.get("sent_ms")]
    crossing = [t for t in (gauge_crossing_ms(gi.lid, (obs_rows.get(gi.lid) or {}).get("thresholds", {}).get("minor"))
                            for gi in members) if t]
    # Anchor (CONTRACT 16.1): primary gauge, else the oldest VTEC key, else a gauge
    keys = sorted({product_key(a) for a in own}, key=lambda k: min((a.get("sent_ms") or 0) for a in own if product_key(a) == k))
    anchor = refs[0]["lid"].upper() if (kind == "river" and refs) else (keys[0] if keys else (f.lids[0] if f.lids else name))
    return {
        "id": "", "hazard": "flood", "name": name, "kind": kind, "level": level,
        "emergency": any(r["emergency"] for r in pref), "status": "active" if active else "inactive", "mode": "live",
        "year": 0, "started_ms": 0, "started_basis": "first_seen",
        "updated_ms": max(sent + readings) if (sent or readings) else None,
        "expires_ms": max(ends) if ends else None, "last_product_ms": max(sent) if sent else None, "ended_ms": ended,
        "lat": float(lat), "lon": float(lon), "bbox_lonlat": bbox, "state": state, "states": sorted(states),
        "county": county.name if county else None, "time_zone": tz, "rivers": rivers,
        "primary_gauge": refs[0] if refs else None, "gauges": refs, "gauges_in_flood": len(in_flood),
        "max_category": max(cats, key=G.CATEGORY_ORDER.index) if cats else None, "products": pref,
        "offices": sorted({(a.get("vtec") or {}).get("office") for a in products} - {None}),
        "bundle_status": "none", "bundle_built_ms": None, "aliases": [], "synthetic": False,
        "caveat": gauge_only_caveat(members, nws_ok) if level == "gauge_only" else None,
        "_keys": keys, "_gauge_lids": [gi.lid for gi in members], "_anchor": anchor, "_starts": starts,
        "_crossing": min(crossing) if crossing else None, "_alt_name": alt, "_base_name": name,
        "_first_sent": min(sent) if sent else None,
    }


def reusable_episode(reg: reg_mod.Registry, lid: str, now: int) -> tuple[str | None, str | None]:
    """(open episode key, its flood id) of a gauge; the id is None when the episode must be retired (rule 10, C8).

    An episode stays open until its flood has been quiet longer than ``INACTIVE_LISTED_H``, judged from the flood's
    own last-known summary (review BFS-R5): an active flood went quiet at most when Fire-3d last saw it, an inactive
    one when it ended. Fire-3d's own build gaps (the server was off overnight) never close an episode alone. Without a
    last-known summary the episode's first-seen time stands in."""
    ep = reg.open_episode(lid)
    if ep is None:
        return None, None
    hit = reg.id_for(ep)
    if hit is None:
        return ep, None
    lk = reg_mod.read_last_known(hit[0])
    if lk is None:
        quiet_since = hit[1]
    else:
        summary, seen = lk
        quiet_since = seen if summary.get("status") == "active" else min(seen, summary.get("ended_ms") or seen)
    if now - quiet_since > G.INACTIVE_LISTED_H * G.H_MS:
        return ep, None
    return ep, hit[0]


def assign_ids(rows: list[dict], now: int, reg: reg_mod.Registry) -> None:
    """Rules 7 and 10 (in place): stable ids from the registry (oldest registered member wins; merges keep the older
    id and alias the other; a split keeps the id on the part with the anchor; gauge keys are episodes), the start
    time and its basis, aliases. Writes the new registry lines."""
    register: list[tuple[str, str, int]] = []
    aliases: list[tuple[str, str]] = []
    retire: list[tuple[str, int]] = []
    claims: list[list[tuple[int, str, str]]] = []          # per row: (first_seen, id, key)
    row_keys: list[list[str]] = []
    for r in rows:
        keys = list(r["_keys"])
        for lid in r["_gauge_lids"]:
            ep, fid = reusable_episode(reg, lid, now)
            if ep is not None and fid is None:
                retire.append((ep, now))               # the gauge's earlier flood stayed quiet too long: a new one (C8)
                reg.retired[ep] = now
                ep = None
            keys.append(ep or reg_mod.gauge_episode_key(lid, now))
        row_keys.append(keys)
        claims.append(sorted({(hit[1], hit[0], k) for k in keys for hit in [reg.id_for(k)] if hit}))
    taken: dict[str, int] = {}
    order = sorted(range(len(rows)), key=lambda i: (claims[i][0][0] if claims[i] else now + 1, i))
    for i in order:
        r = rows[i]
        cand = [c for c in claims[i]]
        chosen = None
        for first_seen, fid, _k in cand:
            if fid not in taken:
                chosen = fid
                break
            j = taken[fid]                                  # a split: the part with the anchor keeps the id
            if naming.h6(r["_anchor"]) == fid[-6:] and naming.h6(rows[j]["_anchor"]) != fid[-6:]:
                rows[j]["id"] = ""
                chosen = fid
                break
        first_seen = min((c[0] for c in cand), default=now)
        starts = [t for t in r["_starts"] if t]
        started, basis = (min(starts), "nws_product") if starts else (first_seen, "first_seen")
        if first_seen < started:
            started, basis = first_seen, "first_seen"
        if r["_crossing"] is not None:
            started, basis = r["_crossing"], "gauge"
        r["started_ms"], r["started_basis"] = int(started), basis
        r["year"] = time.gmtime(started / 1000).tm_year
        if chosen is None:
            chosen = naming.make_flood_id(int(started), r["name"], r["_anchor"])
        r["id"] = chosen
        taken[chosen] = i
        for _fs, fid, _k in cand:
            if fid != chosen:
                aliases.append((fid, chosen))
    for i in range(len(rows)):                               # a split part that lost its id gets a new one
        if not rows[i]["id"]:
            rows[i]["id"] = naming.make_flood_id(rows[i]["started_ms"], rows[i]["name"], rows[i]["_anchor"])
    for r, keys in zip(rows, row_keys):
        for k in keys:
            hit = reg.id_for(k)
            if hit is None:
                register.append((k, r["id"], now))
    reg.write(register=register, aliases=aliases, retire=retire)
    for r in rows:
        r["aliases"] = reg.aliases_of(r["id"])


def _public(r: dict) -> dict:
    return {k: v for k, v in r.items() if not k.startswith("_")}


def _overlay_bundle(s: dict) -> dict:
    st, built = store.bundle_state(s["id"])
    return {**s, "bundle_status": st, "bundle_built_ms": built}


def _source(sid: str, res: SourceResult, down_reason: str, name: str | None = None) -> dict:
    if not res.ok:
        return {"id": sid, "name": name or SOURCE_NAMES[sid], "status": "unavailable", "retrieved_ms": None,
                "reason": down_reason, "stale": False}
    return {"id": sid, "name": name or SOURCE_NAMES[sid], "status": "available", "retrieved_ms": res.retrieved_ms,
            "reason": STALE_REASON[sid] if res.stale else None, "stale": res.stale}


def _ref_key(p: dict) -> str:
    return p.get("vtec_key") or str(p.get("id"))


def as_left(s: dict, seen: int, now: int, *, nws_ok: bool, gauges_ok: bool,
            current: dict[str, str] | None = None) -> dict:
    """A flood that is no longer in the current lists, as Fire-3d shows it (rules 8 and 13; review BFS-R1, BFS-R4).

    NWS answered (fresh or an earlier copy): each product left NWS's active list, so its phase is "ended" (a product
    NWS still lists keeps its phase now, ``current``). NWS could not be read: each keeps its last-known phase until its
    own NWS end time passes (cannot decide). Status, level, ``expires_ms`` and ``emergency`` follow the products still
    in effect; with none the flood is inactive and keeps the level it last had (as a past flood does), with
    ``expires_ms`` null and ``emergency`` false. While the gauges cannot be read, a member gauge that read at flood
    stage within ``GAUGE_ACTIVE_H`` keeps it active. A gauge-only flood's caveat never claims an NWS answer Fire-3d
    does not have."""
    current = current or {}
    prods = []
    for p in s.get("products") or []:
        ph = current.get(_ref_key(p))
        if ph is None:
            if nws_ok:
                ph = "ended"
            else:
                ph = "ended" if (p.get("ends_ms") is not None and p["ends_ms"] <= now) else (p.get("phase") or "ended")
        prods.append({**p, "phase": ph})
    live = [p for p in prods if p["phase"] in ("in_effect", "upcoming")]
    recent = (not gauges_ok) and any(
        G.cat_rank(g.get("observed_category")) >= 1 and (g.get("observed_ms") or 0) >= now - G.GAUGE_ACTIVE_H * G.H_MS
        for g in s.get("gauges") or [])
    active = bool(live) or recent
    level = max((G.ref_level(p) for p in live), key=G.LEVEL_ORDER.index) if live else s.get("level")
    caveat = None
    if level == "gauge_only":
        caveat = s.get("caveat")
        if not nws_ok:
            caveat = fcopy.ALERTS_UNAVAILABLE
        elif caveat in (None, fcopy.ALERTS_UNAVAILABLE):
            tidal = any(G.ref_looks_tidal(g) for g in s.get("gauges") or [])
            caveat = fcopy.GAUGE_ONLY_COASTAL_CAVEAT if tidal else fcopy.GAUGE_ONLY_CAVEAT
    ends = [p["ends_ms"] for p in live if p.get("ends_ms")]
    return {**s, "status": "active" if active else "inactive", "products": prods, "level": level,
            "expires_ms": max(ends) if ends else None, "emergency": any(bool(p.get("emergency")) for p in live),
            "ended_ms": None if active else (s.get("ended_ms") or seen), "caveat": caveat}


def _listable(s: dict, nws_ok: bool, gauges_ok: bool, current: dict[str, str]) -> bool:
    """A flood that left the lists is listed (inactive) only when Fire-3d can tell it is quiet: NWS answered, the gauges
    answered when it has any, and none of its products is listed now with another flood (review BFS-R4: an outage
    means "cannot decide"; the detail route still answers its last-known summary)."""
    if not nws_ok or (s.get("gauges") and not gauges_ok):
        return False
    return not any(_ref_key(p) in current for p in s.get("products") or [])


def _carry_overs(current_ids: set[str], now: int, reg: reg_mod.Registry, *, nws_ok: bool, gauges_ok: bool,
                 current: dict[str, str]) -> list[dict]:
    """Rule 8: floods that left the current lists stay listed (status "inactive", their products "ended") for
    INACTIVE_LISTED_H after Fire-3d last saw them, when Fire-3d can tell (:func:`_listable`); older ones have their
    gauge episodes retired (a later flood there gets a new id), never during an outage."""
    out, retire = [], []
    for s, seen in reg_mod.iter_last_known():
        fid = s.get("id")
        if not fid or fid in current_ids or reg.canonical(fid) != fid or s.get("synthetic"):
            continue
        if seen >= now - G.INACTIVE_LISTED_H * G.H_MS:
            if _listable(s, nws_ok, gauges_ok, current):
                out.append(as_left(s, seen, now, nws_ok=nws_ok, gauges_ok=gauges_ok, current=current))
        elif nws_ok and gauges_ok:
            retire += [(k, now) for k in reg.keys_of(fid) if reg_mod.is_gauge_key(k)]
    if retire:
        reg.write(retire=retire)
    return out


def _sources(inp: Inputs) -> list[dict]:
    """``sources[]`` (rule 11) plus the IEM H-VTEC join that links gauges to warnings (review BFS-R10: credited)."""
    return [
        _source("nws_alerts", inp.alerts, fcopy.FLOOD_LISTS_DOWN if not inp.observed.ok else fcopy.FLOOD_NWS_DOWN),
        _source("nwps_gauges", inp.observed, fcopy.FLOOD_LISTS_DOWN if not inp.alerts.ok else fcopy.FLOOD_GAUGES_DOWN),
        _source("rfc_forecasts", inp.rfc, RFC_DOWN),
        _source("iem_archive", inp.iem, fcopy.IEM_JOIN_DOWN, name=fcopy.IEM_JOIN_NAME),
    ]


def current_phases(prods: dict[str, dict]) -> dict[str, str]:
    """Phase of every product kept from NWS's current answer, by VTEC key (else CAP id)."""
    out: dict[str, str] = {}
    for a in prods.values():
        out[nws.vtec_key(a.get("vtec")) or str(a["id"])] = a["phase"]
    return out


def nws_down_row(s: dict, now: int) -> dict | None:
    """The row the live list gives a flood while NWS cannot be read and no earlier copy exists (rule 11; review
    BFS-R4): rebuilt from its gauges only (level ``gauge_only``, no products, caveat ``ALERTS_UNAVAILABLE``, never
    ``GAUGE_ONLY_CAVEAT``); None when no member gauge reads at minor or worse (such a flood is not listed then). The
    fixture's ``edge/list-nws-down.json`` is made with it; a test checks it against :func:`build_list` on the recorded
    day."""
    refs = [g for g in s.get("gauges") or [] if G.cat_rank(g.get("observed_category")) >= 0]
    in_flood = [g for g in refs if G.cat_rank(g["observed_category"]) >= 1]
    if not in_flood:
        return None
    cats = [c for g in refs for c in (g["observed_category"], g.get("forecast_category")) if c in G.CATEGORY_ORDER]
    readings = [g["observed_ms"] for g in refs if g.get("observed_ms")]
    recent = any((g.get("observed_ms") or 0) >= now - G.GAUGE_ACTIVE_H * G.H_MS for g in in_flood)
    return {**s, "kind": "river", "level": "gauge_only", "emergency": False, "products": [], "offices": [],
            "caveat": fcopy.ALERTS_UNAVAILABLE, "expires_ms": None, "last_product_ms": None,
            "status": "active" if recent else "inactive",
            "ended_ms": None if recent else max((g.get("observed_ms") or 0) for g in in_flood) or None,
            "updated_ms": max(readings) if readings else None, "primary_gauge": refs[0], "gauges": refs,
            "gauges_in_flood": len(in_flood), "max_category": max(cats, key=G.CATEGORY_ORDER.index) if cats else None,
            "rivers": list(dict.fromkeys(w for w in (naming.clean_water(g.get("waterbody")) for g in refs) if w))}


def gauges_down_row(s: dict) -> dict | None:
    """The row the live list gives a flood while the river gauges (``riv_gauges`` and the RFC forecast points) cannot
    be read and no earlier copy exists (rule 11): its NWS products only, no gauge; None without a product in effect
    (a gauge-only flood is not listed then). Used for the fixture's ``edge/list-gauges-down.json``; tested against
    :func:`build_list`."""
    prods = [p for p in s.get("products") or [] if p.get("phase") in ("in_effect", "upcoming")]
    if not prods:
        return None
    sent = [p["sent_ms"] for p in prods if p.get("sent_ms")]
    phs = {(p.get("vtec_key") or "...").split(".")[1] for p in prods if p.get("vtec_key")}
    kind = "river" if "FL" in phs else ("flash" if any(p.get("event") == "Flash Flood Warning" for p in prods) else "areal")
    return {**s, "kind": kind, "primary_gauge": None, "gauges": [], "gauges_in_flood": 0, "max_category": None,
            "products": [{**p, "gauge_lids": p.get("gauge_lids") or []} for p in prods],
            "updated_ms": max(sent) if sent else s.get("updated_ms"), "status": "active", "ended_ms": None,
            "caveat": None}


def build_list(inp: Inputs, now: int) -> dict:
    """A ``FloodListResponse`` dict from the inputs (rules 1-12); writes registry lines and last-known summaries.

    Internal keys (dropped by :func:`public_list`): ``_nws_ok``, ``_gauges_ok`` (each source answered, fresh or an
    earlier copy) and ``_phases`` (:func:`current_phases`), used by :func:`resolve`."""
    reg = reg_mod.get_registry()
    nws_ok, gauges_ok = inp.alerts.ok, inp.observed.ok
    sources = _sources(inp)
    if not nws_ok and not gauges_ok:
        # Both lists down: the flood bundles on disk only, as last seen (their products until their own NWS end time).
        # The answer stays a 200 with every source unavailable (FLOOD_LISTS_DOWN), not a 503 (contract5 deviation).
        rows = []
        for m in store.list_flood_bundles():
            s = m.get("summary")
            if isinstance(s, dict) and not s.get("synthetic") and m.get("status") == "ready":
                seen = int(m.get("built_ms") or s.get("updated_ms") or now)
                rows.append(_overlay_bundle(as_left(s, seen, now, nws_ok=False, gauges_ok=False)))
        return {"hazard": "flood", "mode": "live", "updated_ms": now, "floods": G.sort_floods(rows), "sources": sources,
                "products_in_effect": None, "_nws_ok": False, "_gauges_ok": False, "_phases": {}}
    prods, gauges, links, floods, in_effect = group(inp, now, reg)
    obs_rows = {r["lid"]: r for r in (inp.observed.data or [])}
    rows = [summarize(f, prods, gauges, links, now, obs_rows, nws_ok) for f in floods]
    naming.dedupe_names(rows)
    assign_ids(rows, now, reg)
    current_ids = {r["id"] for r in rows}
    phases = current_phases(prods)
    out = []
    for r in rows:
        s = _overlay_bundle(_public(r))
        # During an outage Fire-3d sees less: an id's last-known summary (what it last saw with both lists) is kept.
        if (nws_ok and gauges_ok) or reg_mod.read_last_known(s["id"]) is None:
            reg_mod.write_last_known(s, now)
        out.append(s)
    out += [_overlay_bundle(s) for s in _carry_overs(current_ids, now, reg, nws_ok=nws_ok, gauges_ok=gauges_ok,
                                                     current=phases)]
    return {"hazard": "flood", "mode": "live", "updated_ms": now, "floods": G.sort_floods(out), "sources": sources,
            "products_in_effect": in_effect if nws_ok else None, "_nws_ok": nws_ok, "_gauges_ok": gauges_ok,
            "_phases": phases}


# ----------------------------------------------------------------------------------------------------------------
# Cache, status and resolution
# ----------------------------------------------------------------------------------------------------------------
_lock = threading.Lock()
_cache: dict[str, Any] = {}


def reset_state() -> None:
    """Forget the cached list (tests; a manual refresh)."""
    with _lock:
        _cache.clear()
    reg_mod.reset_registries()


def _degraded(lst: dict) -> bool:
    """A main source is down or stale (the IEM join alone never shortens the cache: IEM asks for few requests)."""
    return any(s["status"] != "available" or s["stale"] for s in lst["sources"] if s["id"] in MAIN_SOURCES)


def flood_list(refresh: bool = False) -> dict:
    """The live ``FloodListResponse`` (cached 5 min; 60 s while a source is down or stale)."""
    with _lock:
        hit = _cache.get("live")
        if hit is not None and not refresh:
            ttl = LIST_TTL_DEGRADED_S if _degraded(hit[1]) else LIST_TTL_S
            if time.monotonic() - hit[0] < ttl:
                return hit[1]
        now = now_ms()
        inp = fetch_inputs()
        lst = build_list(inp, now)
        lst["_decided"] = inp.alerts.ok and inp.observed.ok
        _cache["live"] = (time.monotonic(), lst)
        return lst


def public_list(lst: dict) -> dict:
    return {k: v for k, v in lst.items() if not k.startswith("_")}


def live_status() -> dict:
    """``FloodLiveStatus`` from the list (until the live loop owns it): counts null when the lists could not be read."""
    lst = flood_list()
    with _lock:
        built = _cache.get("live", (time.monotonic(), None))[0]
    age_s = time.monotonic() - built
    last = now_ms() - int(age_s * 1000)
    ttl = LIST_TTL_DEGRADED_S if _degraded(lst) else LIST_TTL_S
    unknown = not lst.get("_decided", True)
    active = [s for s in lst["floods"] if s["status"] == "active"]
    from .. import config

    return {"last_refresh_ms": last, "next_refresh_ms": last + int(ttl * 1000),
            "active_floods": None if unknown else len(active),
            "gauges_in_flood": None if unknown else sum(s["gauges_in_flood"] for s in active),
            "auto_build": bool(config.AUTO_BUILD_FLOODS and config.LIVE_ENABLED)}


def resolve(flood_id: str) -> tuple[dict, str]:
    """PLAN-5 3.2 rule 13: (summary, resolved_from) from the live list, an alias (the canonical summary), the bundle's
    frozen summary, or the last-known summary. Raises FloodNotFound (404) at the end of the chain when the lists
    answered, ListsUnavailable (503) when they could not decide and nothing is on disk."""
    if not store.valid_id(flood_id) or (flood_id.startswith("fixture-flood-")):
        raise FloodNotFound(flood_id)
    lst = flood_list()
    by_id = {s["id"]: s for s in lst["floods"]}
    if flood_id in by_id:
        return by_id[flood_id], "live"
    now = now_ms()
    # Not in the live list: shown as it left the lists (as_left; products "ended" once NWS answered without them).
    left = {"nws_ok": lst.get("_nws_ok", True), "gauges_ok": lst.get("_gauges_ok", True), "current": lst.get("_phases")}
    reg = reg_mod.get_registry()
    canon = reg.canonical(flood_id)
    if canon != flood_id:
        if canon in by_id:
            return by_id[canon], "alias"
        lk = reg_mod.read_last_known(canon)
        if lk is not None:
            return _overlay_bundle(as_left(lk[0], lk[1], now, **left)), "alias"
    m = store.load_flood_manifest(flood_id)
    if m is not None and isinstance(m.get("summary"), dict):
        if m["summary"].get("synthetic"):
            return _overlay_bundle(m["summary"]), "live"
        seen = int(m.get("built_ms") or m["summary"].get("updated_ms") or now)
        return _overlay_bundle(as_left(m["summary"], seen, now, **left)), "bundle"
    lk = reg_mod.read_last_known(flood_id)
    if lk is not None:
        return _overlay_bundle(as_left(lk[0], lk[1], now, **left)), "last_known"
    if lst.get("_decided", True):
        raise FloodNotFound(flood_id)
    raise ListsUnavailable()
