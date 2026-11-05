"""The flood live refresh (PLAN-5 3.5, CONTRACT 16.2 ``FloodLiveStatus`` and 16.8 ``REFRESH_S`` / ``PREFETCH_MAX`` /
``AUTO_BUILD_FLOODS_N``; SPEC 8.9). Owner: backend-flood-live.

A **second asyncio task** in the API's lifespan, started when ``FIRE3D_LIVE=1`` and ``FIRE3D_FLOODS=1``, with its own
state (:data:`STATE`). The fire loop (``api/live.py``) is not touched, and nothing here can stop it: every cycle
catches its own errors, and the two tasks share no state. Every :data:`REFRESH_S` (15 min) one cycle:

1. **List:** rebuilds the live flood list (``catalog.flood_list(refresh=True)``: five national requests). The counts
   of ``GET /api/floods/status`` come from it; they are ``null`` when the lists could not decide (NWS or the gauges
   could not be read), never 0.
2. **Background prefetch** (C9). The whole cycle's background work, this prefetch **and** the append step's NWS
   and NWPS requests (step 3), spends at most :data:`PREFETCH_MAX` upstream requests (each counted at its largest
   cost before it is made; NWS calls on the shared ``NWS_LIMITER``, NWPS calls on its own 30-a-minute limiter, so
   neither is ever exhausted by the loop; review BFL-R1, R7); the prefetch takes at most what is left after
   :data:`APPEND_SHARE`, never in the list build itself:
   the product text of river products (their H-VTEC gauge id; the list reads it back from cache and links the right
   gauge, rule 2), the outlines of zone-based products (most watches; the flood-alerts answers then draw NWS's own
   zones instead of whole counties), and the 30-day series of member gauges (the list then refines a flood's start
   from the first crossing of flood stage, rule 7). Each kind has its own share (:data:`PREFETCH_CAPS`), so none
   starves another; what is left over goes to the next kind.
3. **Ready live bundles** of listed floods (at most :data:`BUNDLES_PER_CYCLE` a cycle, the least recently refreshed
   first; never while a build or refresh of that flood runs):
   - new NWS product versions are **appended** to ``warnings.json`` (every version seen is kept; a product NWS no
     longer lists is marked ``ended``, as the list does, rule 8; skipped for the cycle when the zone outlines and
     product texts it would fetch do not fit the cycle's budget) and new member gauge readings to ``gauges.json``
     (NWPS for at most :data:`GAUGE_READS_MAX` gauges a cycle within the budget, else the list's own reading, no
     request), atomically, under the bundle's build lock; ``manifest.refreshed_ms`` says when (``built_ms`` stays: the
     terrain did not change);
   - a ``refresh`` is due (:func:`refresh_reason`) when NASA's catalog has a satellite pass over the area that the
     bundle's build could not have seen and this server has not tried yet (pass keys kept on disk, so a restart does
     not try them again; review BFL-R6), when NWS's forecast flooded-area map of the area has a new forecast time, or
     when an official layer could not be loaded at build time. Due refreshes are run one after another by the loop's
     own runner (:func:`run_refreshes`), never by the job workers: it first loads the flood's NWPS gauge details,
     series and model series into the HTTP cache **at a pace that leaves** :data:`NWPS_RESERVE` **NWPS slots free**
     (:func:`warm_nwps`), then queues the ``refresh`` job, which re-runs the flood build
     (``floods.build.build_flood(force=True)``: terrain and the aerial photo come from the HTTP cache when the area did
     not change). **A refresh never makes a bundle worse** (:func:`keep_what_the_rebuild_lost`, review BFL-R1): the
     product versions and readings the bundle had are put back; a member gauge the rebuild could read only from the
     NWS gauge map (or not at all) keeps its earlier NWPS detail (impacts, reach, data attribution, forecast) with the
     newer reading; earlier National Water Model series are kept; and a layer that was ``ok`` but could not be
     loaded again (forecast map, floodplain, model, satellite outage, aerial photo, products, gauges) keeps its
     earlier copy with its own time, and the manifest says so. At most one refresh per bundle per
     :data:`REFRESH_MIN_AGE_H`.
4. **Past years:** each cycle starts the one-time background build of a past year's list when it is missing or
   stale (``history.year_list``; no request when it is built), so the year tabs are ready before anyone opens them.
5. **First cycle** (``FIRE3D_AUTO_BUILD_FLOODS=1``, default = ``FIRE3D_AUTO_BUILD_LIVE``): the
   :data:`AUTO_BUILD_FLOODS_N` most severe listed floods (``floodRank``; watches and tide gauges left out) that have
   no bundle yet are built, one after another (D4), once both lists answered; each build first warms its NWPS answers
   at the same pace (:func:`warm_nwps`).

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
PREFETCH_MAX = 20                       # upstream requests a cycle for the background work: the prefetch and the
                                        # append step's NWS and NWPS requests together (CONTRACT 16.8; BFL-R1, R7)
APPEND_SHARE = 8                        # of PREFETCH_MAX kept for the append step (the prefetch takes the rest first)
PREFETCH_CAPS = {"hvtec": 6, "zones": 3, "series": 3}    # each kind's share of the prefetch; leftovers go on
AUTO_BUILD_FLOODS_N = 4                 # D4
AUTO_BUILD_POLL_S = 3.0
BUNDLES_PER_CYCLE = 8                   # ready live bundles appended / checked per cycle
GAUGE_READS_MAX = 12                    # NWPS member-gauge reads per cycle for gauges.json (within the budget)
REFRESH_MIN_AGE_H = 1.0                 # a bundle is rebuilt at most once an hour
RETRY_FAILED_H = 3.0                    # an official layer that failed at build time is retried after this
RETRY_LAYERS = ("warnings", "gauges", "water_forecast")
NWPS_RESERVE = 10                       # NWPS slots (of 30 a minute) a refresh or auto-build leaves free while warming
WARM_MAX_S = 240.0                      # a warm-up stops after this; the build asks for the rest itself
WARM_POLL_S = 2.0
SEEN_PASSES_MAX = 60                    # satellite pass keys remembered per flood
LIVE_STATE_NAME = "live_state.json"     # data/floods/live_state.json: the pass keys tried (survive a restart; BFL-R6)
REFRESH_KEPT = "The refresh of {time} could not load {what} again; the earlier copy is kept, with its own time."
KEPT_NAMES = {"naip": "the aerial photo", "water_forecast": "NWS's forecast flooded area",
              "floodplain": "FEMA's floodplain", "water_model": "the National Water Model's flooded area",
              "water_satellite": "the water seen by satellite", "warnings": "the NWS flood products",
              "gauges": "the river gauges", "gauge_detail": "the river gauge details (NWPS)",
              "nwm_series": "the National Water Model series"}
# the files and manifest entries of each optional layer (kept from the earlier build when a refresh cannot load it)
LAYER_PARTS: dict[str, dict[str, tuple[str, ...]]] = {
    "naip": {"layers": ("naip",)},
    "water_forecast": {"layers": ("water_forecast",), "maps": ("rfc_fim",)},
    "floodplain": {"layers": ("floodplain",), "maps": ("nfhl",)},
    "water_model": {"layers": ("water_model",), "model": ("nwm_analysis",)},
    "water_satellite": {"layers": ("water_satellite",), "files": ("satellite", "satellite_image")},
}


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
    seen_passes: dict[str, dict] = field(default_factory=dict)      # flood id -> {built_ms, keys}: passes tried
    seen_loaded: bool = False                                       # seen_passes read from disk
    pending: dict[str, tuple[str, dict]] = field(default_factory=dict)   # flood id -> (reason, summary): due refreshes
    runner: Any = None                                              # the asyncio task running the due refreshes
    last_kept: dict[str, list[str]] = field(default_factory=dict)   # flood id -> what its last refresh kept
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
    """NWS requests ``nws.product_hvtec(a)`` makes now: the product list of its office (cached 5 min) and the product
    (cached for good) when not cached; 0 when both are (or its H-VTEC is in memory)."""
    v = a.get("vtec") or {}
    awips = a.get("_awips") or ""
    with nws._hvtec_lock:
        if nws._hvtec.get((awips, nws.vtec_key(v) or "")) is not None:
            return 0
    lurl = nws.product_list_url(awips[:3], awips[3:])
    listing = fhttp.peek_cache("GET", lurl, None, nws.PRODUCT_LIST_TTL_S)
    if listing is None:
        return 2
    try:
        pid = nws.pick_product_id(listing.json(), a.get("sent_ms"))
    except ValueError:
        return 1
    if pid is None:                                  # no product to read: product_hvtec stops after the list
        return 0
    return 0 if fhttp.peek_cache("GET", nws.product_url(pid), None, None) is not None else 1


def _zone_url(ugc: str, zone_type: str) -> str:
    return f"{nws.NWS_API}/zones/{zone_type}/{ugc}"


def _zone_cached(ugc: str, zone_type: str) -> bool:
    """The zone outline is in memory or in the HTTP cache (``nws.nws_zone`` then makes no request)."""
    with nws._zones_lock:
        hit = nws._zones.get((zone_type, ugc))
    return (hit is not None and hit[0] > time.monotonic()) or fhttp.has_cache("GET", _zone_url(ugc, zone_type))


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
            if not _zone_cached(ugc, zt):
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


def prefetch(lst: dict, *, budget: int = PREFETCH_MAX - APPEND_SHARE, now: int | None = None) -> dict[str, int]:
    """Spend at most ``budget`` upstream requests on the background prefetch (:func:`prefetch_plan`; by default what
    the cycle's :data:`PREFETCH_MAX` leaves after :data:`APPEND_SHARE`). Returns the requests counted per kind (a
    fetch is counted at its largest possible cost before it is made). Fire-3d's own rate limit (``SourceBusy``) ends a
    kind for this cycle; an upstream error skips one item. A product whose text could not be asked because of
    Fire-3d's own limit is asked again in a later cycle (review BFL-R8)."""
    now = int(now if now is not None else now_ms())
    plan = prefetch_plan(lst, _national_from_cache(), now)
    kinds = ("hvtec", "zones", "series")
    spent = {k: 0 for k in kinds}
    nxt = {k: 0 for k in kinds}                                  # the next item of each kind
    stopped: set[str] = set()
    left = budget

    def hvtec(item: tuple[Any, ...]) -> None:
        a = item[0]
        try:
            nws.product_hvtec(a)
        except SourceBusy:                       # never asked: Fire-3d's own limit; a later cycle asks again
            raise
        except SourceError:                      # NWS answered (or failed): not asked again every cycle
            STATE.hvtec_tried.add(a["id"])
            raise
        STATE.hvtec_tried.add(a["id"])

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
        # NWPS's answer (series, forecast) when read this cycle; the list's reading whenever it is newer still
        ng = append_reading(merge_gauge(g, fresh[g["lid"]]) if g["lid"] in fresh else g, refs.get(g["lid"]))
        changed = changed or ng != g
        out.append(ng)
    if not changed:
        return old, False
    obs = [g["observed"].get("valid_ms") for g in out if g.get("member") and g["observed"].get("valid_ms")]
    return {**old, "gauges": out, "now_ms": now, "source_updated_ms": max(obs) if obs else old.get("source_updated_ms")}, True


# what an NWPS answer holds that the NWS gauge map's row (the fallback when NWPS cannot be read) does not
_DETAIL_FIELDS = ("usgs_id", "reach_id", "rfc", "is_forecast_point", "thresholds", "forecast", "impacts",
                  "forecast_reliability", "hydronotes", "data_attribution", "name", "url", "county", "time_zone")


def _has_detail(g: dict) -> bool:
    return bool(g.get("data_attribution") or g.get("impacts") or g.get("reach_id") or g.get("hydronotes"))


def keep_detail(old: dict, fresh: dict, *, member: bool = True) -> dict:
    """One gauge that the rebuild could read only from the NWS gauge map (or not at all: ``fresh`` = ``old``): the
    earlier NWPS answer (impacts, reach, forecast, data attribution, series) with the map's newer reading appended."""
    obs = fresh.get("observed") or {}
    g = {**fresh, **{k: old[k] for k in _DETAIL_FIELDS if k in old}, "member": member,
         "waterbody": old.get("waterbody") or fresh.get("waterbody"), "series": old.get("series")}
    if (obs.get("valid_ms") or 0) > ((old.get("observed") or {}).get("valid_ms") or 0):
        g["observed"] = obs
        if isinstance(g.get("series"), dict) and (obs.get("value") is not None or obs.get("flow") is not None):
            g["series"] = {**g["series"], "observed": _union_rows(g["series"].get("observed") or [],
                                                                  [[obs["valid_ms"], obs.get("value"), obs.get("flow")]])}
    else:
        g["observed"] = old.get("observed") or obs
    return g


def merge_rebuilt_gauges(older: dict | None, rebuilt: dict | None, members: list[str] | None = None) -> tuple[dict | None, list[str]]:
    """After a refresh rebuild: the new ``gauges.json``, never worse than the earlier one (review BFL-R1). Returns
    (merged, what was kept: "gauges" when the rebuild could not read the gauges at all, "gauge_detail" when a member
    gauge kept its earlier NWPS detail or was put back).

    * The rebuild could not read the gauges (``unavailable``): the earlier answer stays as it was.
    * A member gauge the rebuild read from NWPS: the new answer with the earlier observed rows (series union).
    * A member gauge the rebuild could read only from the NWS gauge map (NWPS busy or down: no impacts, no reach, no
      data attribution): the earlier NWPS answer with the map's newer reading (:func:`keep_detail`).
    * A member gauge of the flood now (``members``: the rebuilt summary's gauges) that the rebuild left out: put back.
    * A gauge that has left the flood (NWS's list no longer has it at action stage or above): kept as a nearby gauge
      (``member: false``) with its earlier detail and observed rows and the newest reading, so the bundle keeps the
      readings it saw (as it keeps every product version); facts and leaders use members only.
    ``GAUGE_DETAIL_DOWN`` is dropped when no member gauge is left with the map's reading only."""
    if older is None or older.get("status") != "available":
        return rebuilt, []
    if rebuilt is None or rebuilt.get("status") != "available":
        return older, ["gauges"]
    prev = {g["lid"]: g for g in older.get("gauges") or [] if g.get("member")}
    down = fcopy.GAUGE_DETAIL_DOWN in (rebuilt.get("caveats") or [])
    kept = False
    fallback_left = False
    out = []
    for g in rebuilt.get("gauges") or []:
        if g.get("member") and g["lid"] in prev:
            o = prev[g["lid"]]
            if down and not _has_detail(g) and _has_detail(o):
                g, kept = keep_detail(o, g), True
            else:
                g = merge_gauge(o, g)
        if g.get("member") and down and not _has_detail(g):
            fallback_left = True
        out.append(g)
    have = {g["lid"] for g in out if g.get("member")}
    lost = [prev[lid] for lid in (members or []) if lid in prev and lid not in have]
    if lost:
        kept = True
        n_members = sum(1 for g in out if g.get("member"))
        out = out[:n_members] + lost + out[n_members:]          # members first, nearby gauges after
        order = {lid: i for i, lid in enumerate(members or [])}
        out[:n_members + len(lost)] = sorted(out[:n_members + len(lost)], key=lambda g: order.get(g["lid"], 99))
    if members is not None:                                     # gauges that left the flood: nearby, with history
        gone = [lid for lid in prev if lid not in have and lid not in members]
        if gone:
            n_members = sum(1 for g in out if g.get("member"))
            near = {g["lid"]: g for g in out[n_members:]}
            hist = [keep_detail(prev[lid], near.get(lid) or prev[lid], member=False) for lid in gone]
            out = out[:n_members] + hist + [g for g in out[n_members:] if g["lid"] not in set(gone)]
    caveats = list(rebuilt.get("caveats") or [])
    if down and not fallback_left:
        caveats = [c for c in caveats if c != fcopy.GAUGE_DETAIL_DOWN]
    obs = [g["observed"].get("valid_ms") for g in out if g.get("member") and (g.get("observed") or {}).get("valid_ms")]
    merged = {**rebuilt, "gauges": out, "caveats": caveats,
              "source_updated_ms": max(obs) if obs else rebuilt.get("source_updated_ms")}
    return merged, (["gauge_detail"] if kept else [])


def _gauge_cost(lid: str) -> int:
    """NWPS requests one member gauge's answer with series costs now: detail (cached 6 h) + series (10 min)."""
    detail = fhttp.peek_cache("GET", nwps.gauge_url(lid), None, nwps.GAUGE_TTL_S) is None
    series = fhttp.peek_cache("GET", nwps.stageflow_url(lid), None, nwps.SERIES_TTL_S) is None
    return int(detail) + int(series)


def fresh_member_gauges(old: dict | None, reads: dict[str, int]) -> dict[str, dict]:
    """NWPS answers (with series) for the bundle's member gauges while the cycle's budget allows: ``reads["left"]``
    (the cycle's requests left) and ``reads["gauges"]`` (gauge reads left, :data:`GAUGE_READS_MAX`)."""
    from . import gauges as gauges_mod

    out: dict[str, dict] = {}
    for g in (old or {}).get("gauges") or []:
        if not g.get("member"):
            continue
        cost = _gauge_cost(g["lid"])
        if reads.get("left", 0) < cost or reads.get("gauges", GAUGE_READS_MAX) < 1:
            break
        reads["left"] = reads.get("left", 0) - cost
        reads["gauges"] = reads.get("gauges", GAUGE_READS_MAX) - 1
        try:
            out[g["lid"]] = gauges_mod.nwps_river_gauge_fetched(g["lid"], member=True, with_series=True,
                                                                waterbody=g.get("waterbody"))[0]
        except SourceBusy:
            reads["left"] = 0
            break
        except SourceError as e:
            log.info("flood live: gauge %s: %s", g["lid"], config.mask_secrets(e))
    return out


def alerts_cost(summary: dict) -> int:
    """At most how many NWS requests ``zones.flood_alerts(summary)`` makes now: the national answer when its 2-min
    copy has expired (the cycle's list build has just fetched it), each zone outline of the flood's zone-based products
    that is not cached (at most ``ZONE_FETCH_MAX``), and each of its river products' text that is not cached (at most
    ``HVTEC_FETCH_MAX``, 1 or 2 requests each). Read from caches only (review BFL-R7)."""
    from . import zones as zones_mod

    cost = 0 if fhttp.peek_cache("GET", nws.flood_url(), None, nws.ALERTS_TTL_S) is not None else 1
    keys = {p["vtec_key"] for p in summary.get("products") or [] if p.get("vtec_key")}
    ids = {p["id"] for p in summary.get("products") or []}
    sel = [a for a in _national_from_cache() if a.get("id") in ids or (nws.vtec_key(a.get("vtec")) or "") in keys]
    tries = 0
    for a in sel:
        if a.get("_geometry") is not None:
            continue
        for ugc in a.get("ugcs") or []:
            if tries >= zones_mod.ZONE_FETCH_MAX:
                break
            tries += 1
            if not _zone_cached(ugc, zones_mod._zone_type(a, ugc)):
                cost += 1
    river = [a for a in sel if (a.get("vtec") or {}).get("phenomena") == "FL"][:zones_mod.HVTEC_FETCH_MAX]
    cost += sum(_hvtec_cost(a) for a in river)
    return cost


def append_bundle(flood_id: str, summary: dict, *, now: int, reads: dict[str, int]) -> bool:
    """Append new NWS product versions (``warnings.json``) and member gauge readings (``gauges.json``) to a ready
    bundle; atomic writes under the bundle's build lock, ``manifest.refreshed_ms`` set. The NWS requests of the
    products' answer (:func:`alerts_cost`) and the NWPS gauge reads come out of the cycle's budget ``reads``; when
    the products' answer does not fit, the products wait for a later cycle (the prefetch warms their zones and
    texts). False when nothing changed or the bundle is busy (a build or refresh holds its lock)."""
    from ..build import pipeline
    from . import zones as zones_mod

    bdir = store.flood_dir(flood_id)
    m = store.load_flood_manifest(flood_id)
    if not m or m.get("status") != "ready":
        return False
    built = m.get("built_ms")
    old_w, old_g = _load(bdir / "warnings.json"), _load(bdir / "gauges.json")
    cost = alerts_cost(summary)
    if cost <= reads.get("left", 0):
        reads["left"] = reads.get("left", 0) - cost
        fresh_w = zones_mod.flood_alerts(summary, now=now)
    else:
        log.info("flood live: %s products wait for a later cycle (%d requests; %d left)", flood_id, cost,
                 reads.get("left", 0))
        fresh_w = None
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
def _state_path() -> Path:
    return store.floods_dir() / LIVE_STATE_NAME


def _seen_record(flood_id: str) -> dict:
    """The pass keys this server has tried for ``flood_id`` (``{built_ms, keys}``; read from disk once). Call with
    :data:`STATE`'s lock held."""
    if not STATE.seen_loaded:
        STATE.seen_loaded = True
        doc = _load(_state_path()) or {}
        for fid, rec in ((doc.get("seen_passes") if isinstance(doc, dict) else None) or {}).items():
            if isinstance(rec, dict) and isinstance(rec.get("keys"), list):
                STATE.seen_passes.setdefault(fid, {"built_ms": rec.get("built_ms"), "keys": [str(k) for k in rec["keys"]]})
    return STATE.seen_passes.get(flood_id) or {"built_ms": None, "keys": []}


def _save_seen() -> None:
    """Persist the pass keys tried (only floods with a bundle), so a restart does not try them again (BFL-R6). Call
    with :data:`STATE`'s lock held."""
    keep = {m.get("id") for m in store.list_flood_bundles()}
    doc = {"seen_passes": {fid: rec for fid, rec in STATE.seen_passes.items() if fid in keep}}
    try:
        bundle.write_json(_state_path(), doc)
    except OSError as e:
        log.info("flood live: pass keys not saved: %s", e)


def new_passes(flood_id: str, m: dict, passes: list, acq: int | None) -> list:
    """The satellite passes over the area that the bundle's build could not have used and this server has not tried
    yet. With a measured image (acquired ``acq``): passes newer than it, not tried. Without one: the build already
    searched the catalog and found nothing usable, so the passes listed at the first check after a build are taken as
    the ones it saw (when sensed before it ran); only passes that appear later count (BFL-R6). The keys tried are kept
    on disk per flood (:data:`LIVE_STATE_NAME`)."""
    built = int(m.get("built_ms") or 0)
    with STATE.lock:
        rec = dict(_seen_record(flood_id))
        keys = list(rec.get("keys") or [])
        if rec.get("built_ms") != built:
            if acq is None:
                keys += [p.key for p in passes if p.acquired_ms <= built and p.key not in keys]
            rec["built_ms"] = built
        known = set(keys)
        new = [p for p in passes if p.key not in known and (acq is None or p.acquired_ms > int(acq))]
        keys += [p.key for p in passes if p.key not in known]
        rec["keys"] = keys[-SEEN_PASSES_MAX:]
        if rec != STATE.seen_passes.get(flood_id):
            STATE.seen_passes[flood_id] = rec
            _save_seen()
    return new


def refresh_reason(flood_id: str, m: dict, summary: dict, *, now: int) -> str | None:
    """Why the bundle should be rebuilt now, or None: ``satellite`` (:func:`new_passes`), ``rfc_fim`` (NWS's forecast
    flooded-area map of the area has a new forecast time) or ``retry`` (an official layer failed at build time, after
    :data:`RETRY_FAILED_H`). Never for an inactive flood, never sooner than :data:`REFRESH_MIN_AGE_H` after the last
    build. At most two cached requests (the satellite catalog, cached 6 h, and the forecast map, cached 15 min; both
    shared with the flood's 2D routes)."""
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
    if passes and new_passes(flood_id, m, passes, acq):
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


# ---- a refresh never makes a bundle worse (review BFL-R1) -------------------------------------------------------
def snapshot(bdir: Path, m: dict | None) -> dict[str, bytes]:
    """The earlier build's files a refresh may have to keep (every file but the terrain, which is required and always
    rebuilt), read into memory before the rebuild replaces them."""
    out: dict[str, bytes] = {}
    if not m:
        return out
    files = m.get("files") or {}
    rels = {"warnings.json", "gauges.json"}
    rels |= {info.get("file") for k, info in (m.get("layers") or {}).items() if k not in ("elevation", "sky_view")}
    rels |= set((files.get("maps") or {}).values()) | set((files.get("model") or {}).values())
    rels |= {files.get("satellite"), files.get("satellite_image")}
    for rel in sorted(r for r in rels if r):
        p = bdir / rel
        try:
            if p.is_file():
                out[rel] = p.read_bytes()
        except OSError:
            continue
    return out


def _sat_outage(answer: dict | None) -> bool:
    """The rebuild's satellite answer is an outage (NASA could not be reached), not "no usable image" (``no_image``:
    then an older image never replaces NASA's answer, as on the satellite route)."""
    if not answer:
        return True
    return answer.get("status") == "unavailable" or (not answer.get("measured") and answer.get("reason_code") == "upstream_error")


def _restore(bdir: Path, snap: dict[str, bytes], rel: str | None) -> bool:
    if not rel or rel not in snap:
        return False
    bundle.atomic_write_bytes(bdir / rel, snap[rel])
    return True


def keep_what_the_rebuild_lost(bdir: Path, old_m: dict | None, snap: dict[str, bytes], new_m: dict, *,
                               now: int) -> list[str]:
    """After a refresh rebuild: put back what the rebuild could not load again (call under the bundle's build lock).
    Returns the names of what was kept (:data:`KEPT_NAMES` keys); the manifest says so in one warning."""
    from . import build as flood_build

    if not old_m or old_m.get("status") != "ready":
        return []
    kept: list[str] = []
    m = new_m
    ls_old, ls_new = old_m.get("layer_status") or {}, m.setdefault("layer_status", {})
    files_old, files_new = old_m.get("files") or {}, m.setdefault("files", {})
    old_sources = old_m.get("data_sources") or []
    new_warn = list(m.get("warnings") or [])

    def credit(name: str | None) -> None:
        if not name or any(d.get("name") == name for d in m.get("data_sources") or []):
            return
        prev = [d for d in old_sources if d.get("name") == name]
        m.setdefault("data_sources", []).extend(prev or [{"name": name, "detail": "kept from the earlier build",
                                                          "fetched_ms": now}])

    def drop_warning(text: str | None) -> None:
        nonlocal new_warn
        if text:
            new_warn = [w for w in new_warn if w != text]

    # ---- optional layers that were ok and could not be loaded again ------------------------------------------
    sat_new = _load(bdir / files_new["satellite"]) if files_new.get("satellite") else None
    for key, parts in LAYER_PARTS.items():
        was, now_st = ls_old.get(key) or {}, ls_new.get(key) or {}
        if was.get("status") != "ok" or now_st.get("status") == "ok":
            continue
        if key == "water_satellite" and not _sat_outage(sat_new):
            continue
        need = [((old_m.get("layers") or {}).get(name) or {}).get("file") for name in parts.get("layers", ())]
        need += [(files_old.get(kind) or {}).get(k) for kind in ("maps", "model") for k in parts.get(kind, ())]
        need += [files_old.get(k) for k in parts.get("files", ()) if k == "satellite" or files_old.get(k)]
        if not all(rel and rel in snap for rel in need):
            continue                                       # the earlier copy is not complete: nothing to keep
        for rel in need:
            _restore(bdir, snap, rel)
        for name in parts.get("layers", ()):
            m.setdefault("layers", {})[name] = (old_m.get("layers") or {})[name]
        for kind in ("maps", "model"):
            for k in parts.get(kind, ()):
                files_new.setdefault(kind, {})[k] = files_old[kind][k]
        for k in parts.get("files", ()):
            files_new[k] = files_old.get(k)
        drop_warning(now_st.get("reason"))
        ls_new[key] = was
        credit(was.get("source"))
        kept.append(key)

    # ---- NWS products: every version kept; an outage keeps the earlier answer ----------------------------------
    old_w = _load_bytes(snap.get("warnings.json"))
    new_w, _ = merge_alerts(old_w, _load(bdir / "warnings.json"))
    if new_w is not None and new_w.get("status") == "available":
        validate_strict(FloodAlertsResponse, new_w)
        bundle.write_json(bdir / "warnings.json", new_w)
        if (ls_new.get("warnings") or {}).get("status") != "ok" and (ls_old.get("warnings") or {}).get("status") == "ok":
            drop_warning((ls_new.get("warnings") or {}).get("reason"))
            ls_new["warnings"] = ls_old["warnings"]
            credit(ls_old["warnings"].get("source"))
            if fcopy.ZONES_AS_COUNTIES in (new_w.get("caveats") or []):
                credit(fcopy.CREDIT_TIGERWEB_COUNTIES)
            kept.append("warnings")

    # ---- river gauges: never fewer members or less detail -------------------------------------------------------
    old_g = _load_bytes(snap.get("gauges.json"))
    members = [g["lid"] for g in (m.get("summary") or {}).get("gauges") or []]
    new_g, g_kept = merge_rebuilt_gauges(old_g, _load(bdir / "gauges.json"), members)
    if new_g is not None and new_g.get("status") == "available":
        validate_strict(RiverGaugesResponse, new_g)
        bundle.write_json(bdir / "gauges.json", new_g)
        if "gauges" in g_kept and (ls_old.get("gauges") or {}).get("status") == "ok":
            drop_warning((ls_new.get("gauges") or {}).get("reason"))
            ls_new["gauges"] = ls_old["gauges"]
        if g_kept:
            tmp: list[dict] = []
            flood_build._gauge_credits(tmp, new_g, now)
            for d in tmp:
                if not any(x.get("name") == d["name"] for x in m.get("data_sources") or []):
                    m.setdefault("data_sources", []).append(d)
        kept += g_kept

    # ---- National Water Model series of member gauges the rebuild could not read again ------------------------
    members_now = {g["lid"] for g in (new_g or {}).get("gauges") or [] if g.get("member")}
    series_kept = False
    for k, rel in (files_old.get("model") or {}).items():
        if not k.startswith("nwm_series_") or k in (files_new.get("model") or {}):
            continue
        if k[len("nwm_series_"):] in members_now and _restore(bdir, snap, rel):
            files_new.setdefault("model", {})[k] = rel
            series_kept = True
    if series_kept:
        credit(fcopy.CREDIT_NWM)
        kept.append("nwm_series")

    if kept:
        when = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(now / 1000))
        new_warn.append(REFRESH_KEPT.format(time=when, what=", ".join(KEPT_NAMES[k] for k in kept)))
    m["warnings"] = list(dict.fromkeys(new_warn))
    return kept


def _load_bytes(raw: bytes | None) -> Any | None:
    try:
        return orjson.loads(raw) if raw else None
    except orjson.JSONDecodeError:
        return None


def refresh_job_fn(flood_id: str, reason: str):
    """The ``refresh`` job: re-run the flood build, then keep what the rebuild could not load again
    (:func:`keep_what_the_rebuild_lost`: product versions, readings, member gauges and their NWPS detail, model series,
    layers that were ok). A refresh never makes a bundle worse."""
    from ..build import pipeline
    from ..contracts import FloodManifest
    from . import build as flood_build

    def fn(progress):
        bdir = store.flood_dir(flood_id)
        old_m = store.load_flood_manifest(flood_id)
        snap = snapshot(bdir, old_m)
        flood_build.build_flood(flood_id, progress=progress, force=True)
        now = now_ms()
        kept: list[str] = []
        with pipeline.bundle_lock(bdir, timeout=60):
            cur = store.load_flood_manifest(flood_id) or {}

            def fix(mm: dict) -> dict:
                kept[:] = keep_what_the_rebuild_lost(bdir, old_m, snap, mm, now=now)
                validate_strict(FloodManifest, mm)
                return mm

            if cur.get("status") == "ready":
                bundle.update_manifest(bdir, fix)
        m = store.load_flood_manifest(flood_id) or {}
        with STATE.lock:
            STATE.last_kept[flood_id] = list(kept)
        if kept:
            log.info("flood live: refresh of %s kept from the earlier build: %s", flood_id, ", ".join(kept))
        return {"built_ms": m.get("built_ms"), "status": m.get("status"), "reason": reason, "kept": kept,
                "message": f"flood bundle refreshed ({reason})" + (f"; kept: {', '.join(kept)}" if kept else "")}

    return fn


# ---- warming the NWPS answers before a build (review BFL-R1) -----------------------------------------------------
def warm_nwps(summary: dict, *, max_s: float | None = None) -> int:
    """Load the flood's member gauges' NWPS detail and series, and the National Water Model series of their reaches,
    into the HTTP cache **at a pace that leaves** :data:`NWPS_RESERVE` NWPS slots free, so the build that follows reads
    them from the cache instead of running into Fire-3d's own NWPS limit (30 a minute) and falling back to the gauge
    map. Stops after ``max_s`` (:data:`WARM_MAX_S`); what is not warmed by then the build asks for itself. Returns the
    requests made. Runs in the loop's own runner, never in a job worker."""
    from . import gauges as gauges_mod
    from . import maps as maps_mod

    end = time.monotonic() + (WARM_MAX_S if max_s is None else max_s)
    made = 0

    class _Late(Exception):
        pass

    def fetch(url: str, params: Any, ttl: float, fn: Callable[[], Any]) -> bool:
        nonlocal made
        if fhttp.peek_cache("GET", url, params, ttl) is not None:
            return True
        while True:
            if nwps.NWPS_LIMITER.remaining() > NWPS_RESERVE:
                try:
                    fn()
                    made += 1
                    return True
                except SourceBusy:                      # another caller took the slot: wait for the next one
                    pass
                except SourceError as e:                # NWPS answered an error or is down: not this one
                    log.info("flood live: warm %s: %s", url.rsplit("/", 2)[-2:], config.mask_secrets(e))
                    return False
            if time.monotonic() >= end:
                raise _Late
            time.sleep(WARM_POLL_S)

    try:
        for lid in [g["lid"] for g in summary.get("gauges") or []][:gauges_mod.MAX_MEMBERS]:
            ok = fetch(nwps.gauge_url(lid), None, nwps.GAUGE_TTL_S, lambda lid=lid: nwps.gauge(lid))
            ok = fetch(nwps.stageflow_url(lid), None, nwps.SERIES_TTL_S, lambda lid=lid: nwps.stageflow(lid)) and ok
            if not ok:
                continue
            try:                                        # both cached now: no request
                g = gauges_mod.nwps_river_gauge(lid, member=True, with_series=True)
            except SourceError:
                continue
            reach = g.get("reach_id")
            if not (reach and g.get("is_forecast_point")):
                continue
            for name in maps_mod.SERIES_NAMES:
                fetch(nwps.reach_streamflow_url(reach), {"series": name}, nwps.REACH_TTL_S,
                      lambda reach=reach, name=name: nwps.reach_streamflow(reach, name))
    except _Late:
        log.info("flood live: warm-up of %s stopped after %.0f s (%d requests)", summary.get("id"),
                 WARM_MAX_S if max_s is None else max_s, made)
    return made


def refresh_bundles(lst: dict, jobs: Any, *, now: int | None = None, limit: int = BUNDLES_PER_CYCLE,
                    gauge_reads: int = GAUGE_READS_MAX, budget: int | None = None) -> tuple[list[str], list[tuple[str, str]]]:
    """Step 3 of a cycle over the ready live bundles of listed floods: appends (within ``budget`` requests, by default
    the cycle's :data:`PREFETCH_MAX`) and due refreshes, which go to :data:`STATE`'s ``pending`` for
    :func:`run_refreshes` (never queued straight into the job workers). Returns (appended ids, [(due id, reason)])."""
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
    reads = {"left": PREFETCH_MAX if budget is None else int(budget), "gauges": gauge_reads}
    appended: list[str] = []
    queued: list[tuple[str, str]] = []
    for _, fid, m, s in cands[:limit]:
        with STATE.lock:
            pending = fid in STATE.pending
        if pending or jobs.active_for(fid) is not None or store.build_in_progress(fid):
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
            with STATE.lock:
                STATE.pending[fid] = (reason, s)
            queued.append((fid, reason))
    return appended, queued


async def run_refreshes(jobs: Any) -> list[tuple[str, str]]:
    """The due refreshes, one after another: warm the flood's NWPS answers at a pace that leaves room for everyone
    else (:func:`warm_nwps`, in a worker thread of the loop, not a job worker), then queue the ``refresh`` job.
    Returns [(flood id, reason)] queued."""
    done: list[tuple[str, str]] = []
    while True:
        with STATE.lock:
            if not STATE.pending:
                break
            fid, (reason, summary) = next(iter(STATE.pending.items()))
        try:
            await asyncio.to_thread(warm_nwps, summary)
            if jobs.active_for(fid) is None and not store.build_in_progress(fid):
                jobs.submit("refresh", fid, refresh_job_fn(fid, reason), progress_mode="overall",
                            message=f"flood refresh queued ({reason})")
                done.append((fid, reason))
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - one refresh never stops the others
            log.warning("flood live: refresh of %s not queued: %s", fid, config.mask_secrets(f"{type(e).__name__}: {e}"))
        finally:
            with STATE.lock:
                STATE.pending.pop(fid, None)
    return done


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


async def auto_build(jobs: Any, candidates: list[str], rows: dict[str, dict] | None = None) -> None:
    """Build the candidates without a ready bundle, one after another (each waits for the previous one); each first
    warms its NWPS answers at a pace that leaves room for everyone else (:func:`warm_nwps`; ``rows``: the list's
    summaries by id)."""
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
        if rows and fid in rows:
            await asyncio.to_thread(warm_nwps, rows[fid])
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
def warm_year_lists() -> None:
    """Start the past years' one-time builds in the background (``floods/history.py``; no-op once built and fresh),
    so the year tabs are ready before anyone opens them."""
    from . import history

    for y in history.PAST_YEARS:
        history.year_list(y)


async def run_cycle(jobs: Any) -> dict:
    """One cycle (network work in worker threads); updates :data:`STATE`. Returns the list."""
    lst = await asyncio.to_thread(catalog.flood_list, True)
    STATE.active_floods, STATE.gauges_in_flood = list_counts(lst)
    try:
        await asyncio.to_thread(warm_year_lists)
    except Exception as e:  # noqa: BLE001 - past years are best effort here (their route says why)
        log.warning("flood live: past years: %s", config.mask_secrets(f"{type(e).__name__}: {e}"))
    left = PREFETCH_MAX                          # the cycle's one budget: prefetch + append step (BFL-R1, R7)
    try:
        STATE.last_prefetch = await asyncio.to_thread(prefetch, lst, budget=PREFETCH_MAX - APPEND_SHARE)
        left -= sum(STATE.last_prefetch.values())
        if any(STATE.last_prefetch.values()):
            log.info("flood live: prefetch %s", STATE.last_prefetch)
    except Exception as e:  # noqa: BLE001 - the prefetch is best effort
        left = APPEND_SHARE
        log.warning("flood live: prefetch failed: %s", config.mask_secrets(f"{type(e).__name__}: {e}"))
    try:
        appended, queued = await asyncio.to_thread(refresh_bundles, lst, jobs, budget=max(0, left))
        STATE.last_appended, STATE.last_refreshes = appended, queued
        if appended or queued:
            log.info("flood live: appended to %s; refresh due for %s", ", ".join(appended) or "none",
                     ", ".join(f"{i} ({r})" for i, r in queued) or "none")
    except Exception as e:  # noqa: BLE001
        log.warning("flood live: bundle refresh failed: %s", config.mask_secrets(f"{type(e).__name__}: {e}"))
    with STATE.lock:
        due = bool(STATE.pending)
    if due and (STATE.runner is None or STATE.runner.done()):
        STATE.runner = asyncio.create_task(run_refreshes(jobs), name="fire3d-flood-refreshes")
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
                    auto_task = asyncio.create_task(auto_build(jobs, cands, {s["id"]: s for s in lst.get("floods") or []}))
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
        for t in (auto_task, STATE.runner):
            if t is not None and not t.done():
                t.cancel()
        log.info("flood live refresh loop stopped")

