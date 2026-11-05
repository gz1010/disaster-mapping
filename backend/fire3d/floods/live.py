"""The flood live refresh (PLAN-5 3.5, CONTRACT 16.2 ``FloodLiveStatus`` and 16.8 ``REFRESH_S`` / ``PREFETCH_MAX`` /
``AUTO_BUILD_FLOODS_N``; SPEC 8.9). Owner: backend-flood-live.

A **second asyncio task** in the API's lifespan, started when ``FIRE3D_LIVE=1`` and ``FIRE3D_FLOODS=1``, with its own
state (:data:`STATE`). The fire loop (``api/live.py``) is not touched, and nothing here can stop it: every cycle
catches its own errors, and the two tasks share no state. Every :data:`REFRESH_S` (15 min) one cycle:

1. **List:** rebuilds the live flood list (``catalog.flood_list(refresh=True)``: five national requests). The counts
   of ``GET /api/floods/status`` come from it; they are ``null`` when the lists could not decide (NWS or the gauges
   could not be read), never 0.
2. **Background prefetch**, at most :data:`PREFETCH_MAX` upstream requests a cycle (NWS calls on the shared
   ``NWS_LIMITER``, NWPS calls on its own limiter), never in the list build itself (C9):
   the product text of river products (their H-VTEC gauge id; the list reads it back from cache and links the right
   gauge, rule 2), the outlines of zone-based products (most watches; the flood-alerts answers then draw NWS's own
   zones instead of whole counties), and the 30-day series of member gauges (the list then refines a flood's start
   from the first crossing of flood stage, rule 7). Each kind has its own share (:data:`PREFETCH_CAPS`), so none
   starves another; what is left over goes to the next kind.
3. **Ready live bundles** of listed floods (at most :data:`BUNDLES_PER_CYCLE` a cycle, the least recently refreshed
   first; never while a build or refresh of that flood runs):
   - new NWS product versions are **appended** to ``warnings.json`` (every version seen is kept; a product NWS no
     longer lists is marked ``ended``, as the list does, rule 8) and new member gauge readings to ``gauges.json``
     (NWPS for at most :data:`GAUGE_READS_MAX` gauges a cycle, else the list's own reading, no request), atomically,
     under the bundle's build lock; ``manifest.refreshed_ms`` says when (``built_ms`` stays: the terrain did not
     change);
   - a ``refresh`` job is queued (:func:`refresh_reason`) when NASA's catalog has a satellite pass over the area newer
     than the bundle's image that this server has not tried yet, when NWS's forecast flooded-area map of the area
     has a new forecast time, or when an official layer could not be loaded at build time. The job re-runs the flood
     build (``floods.build.build_flood(force=True)``: terrain and the aerial photo come from the HTTP cache when the
     area did not change) and then puts back the product versions and readings the bundle already had. At most one
     refresh per bundle per :data:`REFRESH_MIN_AGE_H`.
4. **First cycle** (``FIRE3D_AUTO_BUILD_FLOODS=1``, default = ``FIRE3D_AUTO_BUILD_LIVE``): the
   :data:`AUTO_BUILD_FLOODS_N` most severe listed floods (``floodRank``; watches and tide gauges left out) that have
   no bundle yet are built, one after another (D4), once both lists answered.

The status, the logs and the job messages never carry a secret (``config.mask_secrets``).
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import orjson

from .. import bundle, config, regions
from .. import http as fhttp
from ..contracts import FloodAlertsResponse, RiverGaugesResponse, validate_strict
from ..sources import nwps, nws, opera, water_maps
from ..sources.nws import SourceBusy, SourceError
from ..timeutil import HOUR_MS, now_ms
from . import catalog, store
from . import copy as fcopy

log = logging.getLogger(__name__)

REFRESH_S = float(os.environ.get("FIRE3D_FLOOD_LIVE_INTERVAL_S", "") or 15 * 60.0)   # CONTRACT 16.8 (env for tests)
PREFETCH_MAX = 20                       # upstream requests a cycle for the background prefetch (CONTRACT 16.8)
PREFETCH_CAPS = {"hvtec": 10, "zones": 5, "series": 5}   # each kind's share; leftovers go to the next kind
AUTO_BUILD_FLOODS_N = 4                 # D4
AUTO_BUILD_POLL_S = 3.0
BUNDLES_PER_CYCLE = 8                   # ready live bundles appended / checked per cycle
GAUGE_READS_MAX = 12                    # NWPS member-gauge reads per cycle for gauges.json
REFRESH_MIN_AGE_H = 1.0                 # a bundle is rebuilt at most once an hour
RETRY_FAILED_H = 3.0                    # an official layer that failed at build time is retried after this
RETRY_LAYERS = ("warnings", "gauges", "water_forecast")


@dataclass
class FloodLiveState:
    """What ``GET /api/floods/status`` reports (plus internals)."""

    running: bool = False
    last_refresh_ms: int | None = None
    next_refresh_ms: int | None = None
    active_floods: int | None = None
    gauges_in_flood: int | None = None
    last_error: str | None = None
    cycles: int = 0
    auto_build_done: bool = False
    auto_build_ids: list[str] = field(default_factory=list)
    last_prefetch: dict[str, int] = field(default_factory=dict)
    last_appended: list[str] = field(default_factory=list)
    last_refreshes: list[tuple[str, str]] = field(default_factory=list)
    hvtec_tried: set[str] = field(default_factory=set)            # CAP ids whose product text was asked once
    seen_passes: dict[str, set[str]] = field(default_factory=dict)  # flood id -> satellite pass keys already tried
    lock: threading.Lock = field(default_factory=threading.Lock)


STATE = FloodLiveState()


def reset_state() -> None:
    """Forget the loop's state (tests)."""
    global STATE
    STATE = FloodLiveState()


def live_status() -> dict:
    """``FloodLiveStatus``. From the loop once it has run a cycle; before that (or without the loop: FIRE3D_LIVE=0 or
    FIRE3D_FLOODS=0) from the cached list. ``auto_build`` is true only while the loop runs with auto-build on. Counts
    are null when the lists could not decide (never 0 for unknown)."""
    st = STATE
    auto = bool(st.running and config.AUTO_BUILD_FLOODS)
    if st.running and st.last_refresh_ms is not None:
        return {"last_refresh_ms": st.last_refresh_ms, "next_refresh_ms": st.next_refresh_ms,
                "active_floods": st.active_floods, "gauges_in_flood": st.gauges_in_flood, "auto_build": auto}
    out = dict(catalog.live_status())
    out["auto_build"] = auto
    return out


def list_counts(lst: dict) -> tuple[int | None, int | None]:
    """(active floods, gauges in flood) of a list; (None, None) when the lists could not decide."""
    if not lst.get("_decided", bool(lst.get("_nws_ok", True) and lst.get("_gauges_ok", True))):
        return None, None
    active = [s for s in lst.get("floods") or [] if s.get("status") == "active"]
    return len(active), sum(int(s.get("gauges_in_flood") or 0) for s in active)


# ----------------------------------------------------------------------------------------------------------------
# Background prefetch (C9): product text H-VTEC, zone outlines, member gauge series
# ----------------------------------------------------------------------------------------------------------------
def _listed_product_ids(lst: dict) -> tuple[set[str], set[str]]:
    ids: set[str] = set()
    keys: set[str] = set()
    for s in lst.get("floods") or []:
        for p in s.get("products") or []:
            ids.add(p["id"])
            if p.get("vtec_key"):
                keys.add(p["vtec_key"])
    return ids, keys


def _national_from_cache() -> list[dict]:
    """The national flood products from the HTTP cache only (the list build has just fetched them): no request."""
    got = catalog._stale_alerts()
    return list(got[0].alerts) if got is not None else []


def _hvtec_cost(a: dict) -> int:
    awips = a.get("_awips") or ""
    lurl = nws.product_list_url(awips[:3], awips[3:])
    return 1 if fhttp.peek_cache("GET", lurl, None, nws.PRODUCT_LIST_TTL_S) is not None else 2


def _zone_url(ugc: str, zone_type: str) -> str:
    return f"{nws.NWS_API}/zones/{zone_type}/{ugc}"


def prefetch_plan(lst: dict, alerts: list[dict], now: int) -> dict[str, list[tuple[Any, ...]]]:
    """What the prefetch would fetch, most useful first: ``hvtec`` [(alert, cost)], ``zones`` [(ugc, type, cost)],
    ``series`` [(lid, cost)]. Things already cached (any age for series and zones) are left out."""
    from . import zones as zones_mod

    ids, keys = _listed_product_ids(lst)
    listed = [a for a in alerts if a.get("id") in ids or (nws.vtec_key(a.get("vtec")) or "") in keys]
    listed = [a for a in listed if nws.flood_phase(a, now) in ("in_effect", "upcoming")]
    # 1. H-VTEC of river products (warnings first, newest first) whose text was never read
    river = [a for a in listed if (a.get("vtec") or {}).get("phenomena") == "FL" and len(a.get("_awips") or "") >= 4]
    river.sort(key=lambda a: ({"W": 0, "Y": 1, "A": 2}.get((a.get("vtec") or {}).get("significance"), 3),
                              -(a.get("sent_ms") or 0)))
    hv = [(a, _hvtec_cost(a)) for a in river
          if a["id"] not in STATE.hvtec_tried and nws.cached_product_hvtec(a) is None]
    # 2. NWS zone outlines of zone-based products (no polygon)
    zs: list[tuple[str, str, int]] = []
    seen: set[str] = set()
    for a in listed:
        if a.get("_geometry") is not None:
            continue
        for ugc in a.get("ugcs") or []:
            zt = zones_mod._zone_type(a, ugc)
            if ugc in seen or zt not in ("forecast", "county", "fire", "public"):
                continue
            seen.add(ugc)
            with nws._zones_lock:
                known = (zt, ugc) in nws._zones
            if not known and not fhttp.has_cache("GET", _zone_url(ugc, zt)):
                zs.append((ugc, zt, 1))
    # 3. 30-day series of member gauges (most severe floods first; the list is already in floodRank order)
    se: list[tuple[str, int]] = []
    done: set[str] = set()
    for s in lst.get("floods") or []:
        if s.get("synthetic"):
            continue
        for g in s.get("gauges") or []:
            lid = g.get("lid")
            if not lid or lid in done or g.get("observed_category") not in ("minor", "moderate", "major"):
                continue
            done.add(lid)
            if not fhttp.has_cache("GET", nwps.stageflow_url(lid)):
                se.append((lid, 1))
    return {"hvtec": hv, "zones": zs, "series": se}


def prefetch(lst: dict, *, budget: int = PREFETCH_MAX, now: int | None = None) -> dict[str, int]:
    """Spend at most ``budget`` upstream requests on the background prefetch (:func:`prefetch_plan`). Returns the
    requests counted per kind (a fetch is counted at its largest possible cost before it is made). Fire-3d's own
    rate limit (``SourceBusy``) ends a kind for this cycle; an upstream error skips one item."""
    now = int(now if now is not None else now_ms())
    plan = prefetch_plan(lst, _national_from_cache(), now)
    kinds = ("hvtec", "zones", "series")
    spent = {k: 0 for k in kinds}
    nxt = {k: 0 for k in kinds}                                  # the next item of each kind
    stopped: set[str] = set()
    left = budget

    def hvtec(item: tuple[Any, ...]) -> None:
        a = item[0]
        STATE.hvtec_tried.add(a["id"])
        nws.product_hvtec(a)

    def zone(item: tuple[Any, ...]) -> None:
        nws.nws_zone(item[0], item[1])

    def series(item: tuple[Any, ...]) -> None:
        nwps.stageflow(item[0])

    fetchers: dict[str, Callable[[tuple[Any, ...]], None]] = {"hvtec": hvtec, "zones": zone, "series": series}

    def run(kind: str, cap: int) -> None:
        nonlocal left
        items = plan[kind]
        while nxt[kind] < len(items) and kind not in stopped:
            item = items[nxt[kind]]
            cost = int(item[-1])
            if cost > left or spent[kind] + cost > cap:
                return
            nxt[kind] += 1
            spent[kind] += cost
            left -= cost
            try:
                fetchers[kind](item)
            except SourceBusy:                   # Fire-3d's own rate limit: this kind waits for the next cycle
                stopped.add(kind)
            except SourceError as e:
                log.info("flood prefetch %s: %s", kind, config.mask_secrets(e))

    for kind in kinds:                           # each kind's own share first ...
        run(kind, PREFETCH_CAPS[kind])
    for kind in kinds:                           # ... then what is left, in the same order
        run(kind, budget)
    return spent


# ----------------------------------------------------------------------------------------------------------------
# Appending new product versions and gauge readings to a ready bundle
# ----------------------------------------------------------------------------------------------------------------
def _load(path: Path) -> Any | None:
    try:
        return orjson.loads(path.read_bytes()) if path.is_file() else None
    except (OSError, orjson.JSONDecodeError):
        return None


def _key(a: dict) -> str:
    return nws.vtec_key(a.get("vtec")) or a["id"]


def _alert_order(a: dict) -> tuple:
    v = a.get("vtec") or {}
    return (0 if a.get("emergency") else 1, {"W": 0, "Y": 1, "A": 2}.get(v.get("significance"), 3),
            -(a.get("sent_ms") or 0), a["id"])


def merge_alerts(old: dict | None, fresh: dict | None) -> tuple[dict | None, bool]:
    """``warnings.json`` keeping every product version seen: ``fresh`` (NWS now) wins for the ids it has; an older
    version of a product NWS still lists stays as it was; a product NWS answered without (it left NWS's active list)
    is marked ``ended`` (as the flood list does, rule 8). Zone outlines are merged by UGC. Unchanged when ``fresh``
    could not be read (an outage never ends a product). Returns (merged, changed)."""
    if fresh is None or fresh.get("status") != "available":
        return old, False
    if old is None or old.get("status") != "available":
        return fresh, True
    by_id = {a["id"]: a for a in old.get("alerts") or []}
    fresh_keys = {_key(a) for a in fresh.get("alerts") or []}
    fresh_ids = {a["id"] for a in fresh.get("alerts") or []}
    out = []
    for a in old.get("alerts") or []:
        if a["id"] in fresh_ids:
            continue
        if _key(a) not in fresh_keys and a.get("phase") != "ended":
            a = {**a, "phase": "ended"}
        out.append(a)
    out += list(fresh.get("alerts") or [])
    out.sort(key=_alert_order)
    zones = {f["properties"]["ugc"]: f for f in (old.get("zones") or {}).get("features") or []}
    for f in (fresh.get("zones") or {}).get("features") or []:
        prev = zones.get(f["properties"]["ugc"])
        ids = list(dict.fromkeys((prev or {}).get("properties", {}).get("alert_ids", []) + f["properties"]["alert_ids"]))
        zones[f["properties"]["ugc"]] = {**f, "properties": {**f["properties"], "alert_ids": ids}}
    caveats = list(fresh.get("caveats") or [])
    if fcopy.ZONES_AS_COUNTIES in (old.get("caveats") or []) and fcopy.ZONES_AS_COUNTIES not in caveats:
        caveats.append(fcopy.ZONES_AS_COUNTIES)
    merged = {**fresh, "alerts": out, "zones": {"type": "FeatureCollection", "features": list(zones.values())},
              "caveats": caveats}
    sig = lambda d: sorted((a["id"], a.get("phase"), orjson.dumps(a.get("hvtec")), tuple(a.get("flood_ids") or []))  # noqa: E731
                           for a in d.get("alerts") or [])
    changed = sig(merged) != sig(old) or len(merged["zones"]["features"]) != len((old.get("zones") or {}).get("features") or [])
    return merged, changed


def _union_rows(older: list, newer: list) -> list:
    """Series rows ``[t, stage, flow]`` of both, by time (``newer`` wins on the same time), oldest first."""
    rows = {int(r[0]): r for r in older or [] if r and r[0] is not None}
    for r in newer or []:
        if r and r[0] is not None:
            rows[int(r[0])] = r
    return [rows[t] for t in sorted(rows)]


def merge_gauge(old: dict, fresh: dict) -> dict:
    """One member gauge: NWPS's newer answer, with the bundle's earlier observed rows kept (series union) and the
    newest reading and forecast."""
    g = {**fresh, "member": True, "waterbody": old.get("waterbody") or fresh.get("waterbody")}
    if (old.get("observed") or {}).get("valid_ms") and (old["observed"]["valid_ms"] or 0) > (
            (fresh.get("observed") or {}).get("valid_ms") or 0):
        g["observed"] = old["observed"]
    os_, fs = old.get("series"), fresh.get("series")
    if isinstance(os_, dict) and isinstance(fs, dict):
        newer_fc = (fs.get("forecast_issued_ms") or 0) >= (os_.get("forecast_issued_ms") or 0)
        g["series"] = {**fs, "observed": _union_rows(os_.get("observed") or [], fs.get("observed") or []),
                       **({} if newer_fc else {"forecast": os_.get("forecast") or [],
                                               "forecast_issued_ms": os_.get("forecast_issued_ms")})}
    elif isinstance(os_, dict) and "series" not in fresh:
        g["series"] = os_
    return g


def append_reading(old: dict, ref: dict | None) -> dict:
    """One member gauge with the flood list's newer reading (``FloodGaugeRef``; no request): the observed reading
    and, when the gauge has a series, one more observed row. The forecast is left as it was."""
    if not ref or ref.get("observed_value") is None or not ref.get("observed_ms"):
        return old
    t = int(ref["observed_ms"])
    if t <= int((old.get("observed") or {}).get("valid_ms") or 0):
        return old
    obs = {**(old.get("observed") or {}), "value": ref["observed_value"], "unit": ref.get("unit") or
           (old.get("observed") or {}).get("unit"), "flow": None, "category": ref.get("observed_category") or "unknown",
           "valid_ms": t}
    g = {**old, "observed": obs}
    if isinstance(old.get("series"), dict):
        g["series"] = {**old["series"], "observed": _union_rows(old["series"].get("observed") or [],
                                                                [[t, ref["observed_value"], None]])}
    return g


def merge_gauges(old: dict | None, fresh: dict[str, dict], refs: dict[str, dict], now: int) -> tuple[dict | None, bool]:
    """``gauges.json`` with new member readings appended: NWPS answers in ``fresh`` (lid -> RiverGauge), else the
    list's reading in ``refs`` (lid -> FloodGaugeRef). Nearby gauges are left as they were. An outage answer at build
    time (``unavailable``) is left for a refresh rebuild. Returns (merged, changed)."""
    if old is None or old.get("status") != "available":
        return old, False
    out = []
    changed = False
    for g in old.get("gauges") or []:
        if not g.get("member"):
            out.append(g)
            continue
        ng = merge_gauge(g, fresh[g["lid"]]) if g["lid"] in fresh else append_reading(g, refs.get(g["lid"]))
        changed = changed or ng != g
        out.append(ng)
    if not changed:
        return old, False
    obs = [g["observed"].get("valid_ms") for g in out if g.get("member") and g["observed"].get("valid_ms")]
    return {**old, "gauges": out, "now_ms": now, "source_updated_ms": max(obs) if obs else old.get("source_updated_ms")}, True


def merge_rebuilt_gauges(older: dict | None, rebuilt: dict | None) -> dict | None:
    """After a refresh rebuild: the new ``gauges.json`` with the earlier observed rows of the same member gauges."""
    if older is None or rebuilt is None or rebuilt.get("status") != "available":
        return rebuilt
    prev = {g["lid"]: g for g in older.get("gauges") or [] if g.get("member")}
    gauges = [merge_gauge(prev[g["lid"]], g) if (g.get("member") and g["lid"] in prev) else g
              for g in rebuilt.get("gauges") or []]
    return {**rebuilt, "gauges": gauges}


def _gauge_cost(lid: str) -> int:
    return 1 if fhttp.peek_cache("GET", nwps.gauge_url(lid), None, nwps.GAUGE_TTL_S) is not None else 2


def fresh_member_gauges(old: dict | None, reads: dict[str, int]) -> dict[str, dict]:
    """NWPS answers (with series) for the bundle's member gauges while ``reads["left"]`` allows (NWPS requests)."""
    from . import gauges as gauges_mod

    out: dict[str, dict] = {}
    for g in (old or {}).get("gauges") or []:
        if not g.get("member"):
            continue
        cost = _gauge_cost(g["lid"])
        if reads["left"] < cost:
            break
        reads["left"] -= cost
        try:
            out[g["lid"]] = gauges_mod.nwps_river_gauge_fetched(g["lid"], member=True, with_series=True,
                                                                waterbody=g.get("waterbody"))[0]
        except SourceBusy:
            reads["left"] = 0
            break
        except SourceError as e:
            log.info("flood live: gauge %s: %s", g["lid"], config.mask_secrets(e))
    return out


def append_bundle(flood_id: str, summary: dict, *, now: int, reads: dict[str, int]) -> bool:
    """Append new NWS product versions (``warnings.json``) and member gauge readings (``gauges.json``) to a ready
    bundle; atomic writes under the bundle's build lock, ``manifest.refreshed_ms`` set. False when nothing changed or
    the bundle is busy (a build or refresh holds its lock)."""
    from ..build import pipeline
    from . import zones as zones_mod

    bdir = store.flood_dir(flood_id)
    m = store.load_flood_manifest(flood_id)
    if not m or m.get("status") != "ready":
        return False
    built = m.get("built_ms")
    old_w, old_g = _load(bdir / "warnings.json"), _load(bdir / "gauges.json")
    fresh_w = zones_mod.flood_alerts(summary, now=now)
    new_w, w_changed = merge_alerts(old_w, fresh_w)
    fresh_g = fresh_member_gauges(old_g, reads)
    new_g, g_changed = merge_gauges(old_g, fresh_g, {g["lid"]: g for g in summary.get("gauges") or []}, now)
    if not (w_changed or g_changed):
        return False
    if w_changed:
        validate_strict(FloodAlertsResponse, new_w)
    if g_changed:
        validate_strict(RiverGaugesResponse, new_g)
    try:
        with pipeline.bundle_lock(bdir, timeout=0):
            cur = store.load_flood_manifest(flood_id)
            if not cur or cur.get("status") != "ready" or cur.get("built_ms") != built:
                return False                          # rebuilt meanwhile: the new files are newer
            if w_changed:
                bundle.write_json(bdir / "warnings.json", new_w)
            if g_changed:
                bundle.write_json(bdir / "gauges.json", new_g)

            def fn(mm: dict) -> None:
                ls = mm.get("layer_status") or {}
                if w_changed and isinstance(ls.get("warnings"), dict) and new_w["status"] == "available":
                    sent = [a.get("sent_ms") for a in new_w["alerts"] if a.get("sent_ms")]
                    ls["warnings"].update(status="ok", reason=None, time_ms=max(sent) if sent else None)
                if g_changed and isinstance(ls.get("gauges"), dict):
                    obs = [g["observed"].get("valid_ms") for g in new_g["gauges"]
                           if g.get("member") and g["observed"].get("valid_ms")]
                    ls["gauges"]["time_ms"] = max(obs) if obs else ls["gauges"].get("time_ms")
                mm["refreshed_ms"] = now

            bundle.update_manifest(bdir, fn)
    except pipeline.BundleBusy:
        return False
    return True


# ----------------------------------------------------------------------------------------------------------------
# Refresh jobs (re-run the flood build when NWS's forecast map or NASA's satellite catalog has something newer)
# ----------------------------------------------------------------------------------------------------------------
def refresh_reason(flood_id: str, m: dict, summary: dict, *, now: int) -> str | None:
    """Why the bundle should be rebuilt now, or None: ``satellite`` (a pass newer than the bundle's image that this
    server has not tried), ``rfc_fim`` (NWS's forecast flooded-area map of the area has a new forecast time) or
    ``retry`` (an official layer failed at build time, after :data:`RETRY_FAILED_H`). Never for an inactive flood,
    never sooner than :data:`REFRESH_MIN_AGE_H` after the last build. At most two cached requests (the satellite
    catalog, cached 6 h, and the forecast map, cached 15 min; both shared with the flood's 2D routes)."""
    if summary.get("status") != "active":
        return None
    age = now - int(m.get("built_ms") or 0)
    if age < REFRESH_MIN_AGE_H * HOUR_MS:
        return None
    ls = m.get("layer_status") or {}
    if age >= RETRY_FAILED_H * HOUR_MS and any((ls.get(k) or {}).get("status") == "unavailable" and
                                               (ls.get(k) or {}).get("reason") in _OUTAGE_REASONS for k in RETRY_LAYERS):
        return "retry"
    bbox = tuple(float(v) for v in ((m.get("grid") or {}).get("bbox_lonlat") or summary["bbox_lonlat"]))
    try:
        grans, _ = opera.egis_granules(bbox, now, now_ms=now)        # type: ignore[arg-type]
        passes = opera.group_passes(grans)
    except SourceError as e:                                         # SourceBusy included: try next cycle
        log.info("flood live: satellite catalog for %s: %s", flood_id, config.mask_secrets(e))
        passes = []
    acq = (ls.get("water_satellite") or {}).get("time_ms") if (ls.get("water_satellite") or {}).get("status") == "ok" else None
    with STATE.lock:
        seen = STATE.seen_passes.setdefault(flood_id, set())
        new = [p for p in passes if p.key not in seen and (acq is None or p.acquired_ms > int(acq))]
        seen.update(p.key for p in passes)
    if new:
        return "satellite"
    if (ls.get("water_forecast") or {}).get("status") == "ok":
        try:
            layer = water_maps.rfc_fim(bbox)                         # type: ignore[arg-type]
        except SourceError as e:
            log.info("flood live: forecast map for %s: %s", flood_id, config.mask_secrets(e))
            return None
        ref = layer.reference_ms
        if ref is not None and ref != (ls.get("water_forecast") or {}).get("time_ms"):
            return "rfc_fim"
    return None


_OUTAGE_REASONS = {fcopy.ALERTS_UNAVAILABLE, fcopy.GAUGES_UNAVAILABLE, fcopy.RFC_FIM_UNAVAILABLE}


def refresh_job_fn(flood_id: str, reason: str):
    """The ``refresh`` job: re-run the flood build, then put back the product versions and earlier readings the
    bundle had (the build itself writes only what NWS lists now)."""
    from ..build import pipeline
    from . import build as flood_build

    def fn(progress):
        bdir = store.flood_dir(flood_id)
        old_w, old_g = _load(bdir / "warnings.json"), _load(bdir / "gauges.json")
        m = flood_build.build_flood(flood_id, progress=progress, force=True)
        with pipeline.bundle_lock(bdir, timeout=60):
            new_w, _ = merge_alerts(old_w, _load(bdir / "warnings.json"))
            new_g = merge_rebuilt_gauges(old_g, _load(bdir / "gauges.json"))
            if new_w is not None and new_w.get("status") == "available":
                validate_strict(FloodAlertsResponse, new_w)
                bundle.write_json(bdir / "warnings.json", new_w)
            if new_g is not None and new_g.get("status") == "available":
                validate_strict(RiverGaugesResponse, new_g)
                bundle.write_json(bdir / "gauges.json", new_g)
        return {"built_ms": m["built_ms"], "status": m["status"], "reason": reason,
                "message": f"flood bundle refreshed ({reason})"}

    return fn


def refresh_bundles(lst: dict, jobs: Any, *, now: int | None = None, limit: int = BUNDLES_PER_CYCLE,
                    gauge_reads: int = GAUGE_READS_MAX) -> tuple[list[str], list[tuple[str, str]]]:
    """Step 3 of a cycle over the ready live bundles of listed floods. Returns (appended ids, [(queued id, reason)])."""
    now = int(now if now is not None else now_ms())
    by_id = {s["id"]: s for s in lst.get("floods") or []}
    cands = []
    for m in store.list_flood_bundles():
        fid = m.get("id")
        s = by_id.get(fid)
        if (s is None or m.get("status") != "ready" or m.get("mode") != "live"
                or (m.get("summary") or {}).get("synthetic") or s.get("synthetic")):
            continue
        cands.append((int(m.get("refreshed_ms") or m.get("built_ms") or 0), fid, m, s))
    cands.sort(key=lambda c: c[0])
    reads = {"left": gauge_reads}
    appended: list[str] = []
    queued: list[tuple[str, str]] = []
    for _, fid, m, s in cands[:limit]:
        if jobs.active_for(fid) is not None or store.build_in_progress(fid):
            continue
        try:
            if append_bundle(fid, s, now=now, reads=reads):
                appended.append(fid)
        except SourceBusy as e:
            log.info("flood live: %s not appended this cycle: %s", fid, config.mask_secrets(e))
        except Exception as e:  # noqa: BLE001 - one bundle never stops the others
            log.warning("flood live: appending to %s failed: %s", fid, config.mask_secrets(f"{type(e).__name__}: {e}"))
        try:
            reason = refresh_reason(fid, store.load_flood_manifest(fid) or m, s, now=now)
        except Exception as e:  # noqa: BLE001
            log.warning("flood live: refresh check of %s failed: %s", fid, config.mask_secrets(f"{type(e).__name__}: {e}"))
            reason = None
        if reason:
            jobs.submit("refresh", fid, refresh_job_fn(fid, reason), progress_mode="overall",
                        message=f"flood refresh queued ({reason})")
            queued.append((fid, reason))
    return appended, queued


# ----------------------------------------------------------------------------------------------------------------
# Auto-build (D4)
# ----------------------------------------------------------------------------------------------------------------
def auto_build_candidates(floods: list[dict], limit: int = AUTO_BUILD_FLOODS_N) -> list[str]:
    """The ``limit`` most severe listed floods (the list's ``floodRank`` order) that have no bundle yet: active, real
    (not synthetic), in the lower 48 or DC; watches and gauges that may measure tidal water are left out (their
    flood products are not read; PLAN-5 D1)."""
    top = [s for s in floods
           if s.get("status") == "active" and not s.get("synthetic") and s.get("level") != "watch"
           and s.get("caveat") != fcopy.GAUGE_ONLY_COASTAL_CAVEAT and s.get("state") in regions.L48][:limit]
    return [s["id"] for s in top if s.get("bundle_status") not in ("ready", "building")]


def _build_job_fn(flood_id: str):
    from . import build as flood_build

    def fn(progress):
        m = flood_build.build_flood(flood_id, progress=progress, force=False)
        return {"built_ms": m["built_ms"], "status": m["status"], "warnings": len(m["warnings"]),
                "message": "bundle ready"}

    return fn


async def auto_build(jobs: Any, candidates: list[str]) -> None:
    """Build the candidates without a ready bundle, one after another (each waits for the previous one)."""
    from . import build as flood_build

    for fid in candidates:
        m = store.load_flood_manifest(fid)
        if m and m.get("status") == "ready":
            continue
        try:
            await asyncio.to_thread(flood_build.gate, fid)
        except flood_build.BuildRefused as e:
            log.info("flood auto-build: %s refused: %s", fid, e.detail)
            continue
        st = jobs.submit("build", fid, _build_job_fn(fid), progress_mode="overall", message="auto-build queued")
        STATE.auto_build_ids.append(fid)
        log.info("flood auto-build: %s (job %s)", fid, st.id)
        while True:
            cur = jobs.get(st.id)
            if cur is None or cur.status in ("done", "error"):
                break
            await asyncio.sleep(AUTO_BUILD_POLL_S)


# ----------------------------------------------------------------------------------------------------------------
# The loop
# ----------------------------------------------------------------------------------------------------------------
async def run_cycle(jobs: Any) -> dict:
    """One cycle (network work in worker threads); updates :data:`STATE`. Returns the list."""
    lst = await asyncio.to_thread(catalog.flood_list, True)
    STATE.active_floods, STATE.gauges_in_flood = list_counts(lst)
    try:
        STATE.last_prefetch = await asyncio.to_thread(prefetch, lst)
        if any(STATE.last_prefetch.values()):
            log.info("flood live: prefetch %s", STATE.last_prefetch)
    except Exception as e:  # noqa: BLE001 - the prefetch is best effort
        log.warning("flood live: prefetch failed: %s", config.mask_secrets(f"{type(e).__name__}: {e}"))
    try:
        appended, queued = await asyncio.to_thread(refresh_bundles, lst, jobs)
        STATE.last_appended, STATE.last_refreshes = appended, queued
        if appended or queued:
            log.info("flood live: appended to %s; refresh queued for %s", ", ".join(appended) or "none",
                     ", ".join(f"{i} ({r})" for i, r in queued) or "none")
    except Exception as e:  # noqa: BLE001
        log.warning("flood live: bundle refresh failed: %s", config.mask_secrets(f"{type(e).__name__}: {e}"))
    return lst


async def flood_refresh_loop(jobs: Any = None, interval_s: float | None = None) -> None:
    """Every :data:`REFRESH_S`: the flood list, the prefetch, the ready live bundles; auto-build on the first good
    cycle. Never raises out of a cycle (the fire loop is another task and never sees a flood error)."""
    if jobs is None:
        from ..api.jobs import get_manager

        jobs = get_manager()
    interval = float(interval_s or REFRESH_S)
    STATE.running = True
    auto_task: asyncio.Task | None = None
    log.info("flood live refresh loop started (every %.0f min, auto-build %s)", interval / 60,
             "on" if config.AUTO_BUILD_FLOODS else "off")
    try:
        while True:
            try:
                lst = await run_cycle(jobs)
                STATE.last_error = None
                STATE.cycles += 1
                if (config.AUTO_BUILD_FLOODS and not STATE.auto_build_done and lst.get("_nws_ok", True)
                        and lst.get("_gauges_ok", True)):
                    STATE.auto_build_done = True
                    cands = auto_build_candidates(lst.get("floods") or [])
                    log.info("flood auto-build candidates: %s", ", ".join(cands) or "none")
                    auto_task = asyncio.create_task(auto_build(jobs, cands))
            except asyncio.CancelledError:
                raise
            except Exception as e:  # keep looping; the next cycle retries
                STATE.active_floods = None                 # unknown, never 0
                STATE.gauges_in_flood = None
                STATE.last_error = config.mask_secrets(f"{type(e).__name__}: {e}")[:300]
                log.warning("flood live refresh cycle failed: %s", STATE.last_error)
            STATE.last_refresh_ms = now_ms()
            STATE.next_refresh_ms = STATE.last_refresh_ms + int(interval * 1000)
            await asyncio.sleep(interval)
    finally:
        STATE.running = False
        STATE.next_refresh_ms = None
        if auto_task is not None and not auto_task.done():
            auto_task.cancel()
        log.info("flood live refresh loop stopped")


_ = (time,)
