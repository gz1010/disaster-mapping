"""A flood's time history (brief 6, decision 2): its satellite passes and its NWS product versions
(``FloodTimelineResponse``; CONTRACT 16 brief-6 note ``docs/redesign/contract6/backend-flood-time-3d.md``; SPEC 8.11).

**Satellite passes** (:func:`route_passes`, :func:`bundle_passes`):

* Window (:func:`flood_window`): from :data:`BEFORE_DAYS` days before the flood's start to now; a past (year-list)
  flood ends :data:`PAST_AFTER_DAYS` days after its last NWS product. At most :data:`MAX_WINDOW_DAYS` days (the newest
  part is kept).
* One Earthdata GIS catalog search over the window (DSWx-HLS; cached 6 h). With ``EARTHDATA_TOKEN`` NASA's catalogue
  (CMR) adds the DSWx-S1 radar passes and DSWx-HLS passes Earthdata GIS has not loaded yet (PO.DAAC route).
* The tiles of one overpass can be sensed a minute or two apart: passes of one product and sensor less than
  :data:`MERGE_MS` apart are one pass (:func:`merge_passes`). At most :data:`MAX_PASSES` passes, newest kept.
* Every pass is read **once**, locked to its own granules (the image time is exact): for the 2D views on the
  satellite route's lon/lat grid (about 30 m, the PNG and the view shares come from that read), for the bundle on
  the render grid. A pass that saw less than :data:`USABLE_MIN_PCT` % of the area clearly is listed with
  ``usable: false`` and ``view: no_view`` (never drawn as water). Nothing is ever drawn or interpolated between
  passes.
* Reads are polite: cached for 30 days (``fire3d.http``), at most :data:`READ_WORKERS` at a time, and a read waits
  while fewer than :data:`LIMIT_RESERVE` Earthdata GIS request slots are left, so the satellite route's own probes
  never starve. The route waits at most :data:`ROUTE_WAIT_S` s; unfinished passes come back ``view: unknown`` with
  ``complete: false`` (ask again).

**NWS products** (:func:`product_history`): every version of every event of the flood (its products' VTEC keys),
every segment, from the IEM archive (``json/vtec_event.py``; zone outlines from ``geojson/vtec_event.py`` for
versions without a polygon), plus NWS's live copies (CAP; a live copy replaces the archived copy of the same version).
Each version keeps its issuer, its own times, its verbatim text and its link. ``shown_from_ms`` is its issue time;
``shown_until_ms`` the earliest of its own end time and the next version's issue time (CAN and UPG end at their own
issue time).
"""

from __future__ import annotations

import hashlib
import logging
import math
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import wait as wait_futures
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from .. import config
from .. import http as fhttp
from ..grid import Grid
from ..sources import nws, opera
from ..sources.nws import SourceBusy, SourceError
from . import copy as fcopy
from . import copy_time as tcopy
from . import history, satellite, zones

log = logging.getLogger(__name__)

BBox = tuple[float, float, float, float]
DAY_MS = 86_400_000
BEFORE_DAYS = 10
PAST_AFTER_DAYS = 3
MAX_WINDOW_DAYS = 45
MERGE_MS = 10 * 60_000
MAX_PASSES = 40
SEARCH_ROWS = 200                    # opera.egis_query_params resultRecordCount
USABLE_MIN_PCT = 1.0
CLEAR_PCT = 50.0
ROUTE_WAIT_S = 20.0
READ_WORKERS = 3
LIMIT_RESERVE = 8                    # Earthdata GIS slots left for the satellite route
POLITE_WAIT_S = 120.0
POLITE_SLEEP_S = 2.0
FAILED_TTL_S = 120.0
ANSWER_TTL_S = 600.0
PRODUCTS_TTL_S = 300.0
MAX_BUNDLE_READS = 24
MAX_BUNDLE_PASSES = 8                # 1 MB each on disk (gzip on the wire)
MAX_EVENTS = 20
MAX_VERSIONS = 600
DEDUPE_MS = 10 * 60_000
ENDS_AT_ISSUE = ("CAN", "UPG")


# ----------------------------------------------------------------------------------------------------------------
# Window and passes
# ----------------------------------------------------------------------------------------------------------------
def flood_window(summary: dict, now: int) -> tuple[int, int]:
    """(start_ms, end_ms) of the flood's satellite window (module docstring)."""
    started = int(summary.get("started_ms") or now)
    if summary.get("mode") == "historical":
        last = summary.get("last_product_ms") or summary.get("ended_ms") or summary.get("updated_ms") or started
        end = min(int(now), int(last) + PAST_AFTER_DAYS * DAY_MS)
    else:
        end = int(now)
    start = max(started - BEFORE_DAYS * DAY_MS, end - MAX_WINDOW_DAYS * DAY_MS)
    return min(start, end), end


def _last_ms(p: opera.Pass) -> int:
    return max((g.acquired_ms for g in p.granules), default=p.acquired_ms)


def merge_passes(passes: list[opera.Pass]) -> list[opera.Pass]:
    """Passes of one product and sensor sensed less than :data:`MERGE_MS` apart are one overpass (the key of the
    earliest). Returns newest first."""
    out: list[opera.Pass] = []
    for p in sorted(passes, key=lambda q: (q.acquired_ms, q.key)):
        prev = next((q for q in reversed(out) if q.product == p.product and q.sensor == p.sensor
                     and q.route == p.route), None)
        if prev is not None and p.acquired_ms - _last_ms(prev) <= MERGE_MS:
            for g in p.granules:
                if all(g.id != x.id for x in prev.granules):
                    prev.granules.append(g)
            continue
        out.append(opera.Pass(p.key, p.product, p.sensor, p.acquired_ms, list(p.granules)))
    return sorted(out, key=lambda q: (-q.acquired_ms, q.key))


@dataclass
class PassList:
    passes: list[opera.Pass]          # newest first
    retrieved_ms: int | None
    egis_ok: bool
    truncated: bool
    login: str


def list_passes(bbox: BBox, start: int, end: int, *, now: int) -> PassList:
    """Every pass over ``bbox`` sensed in [start, end] (newest first). Raises SourceError when no catalog answered;
    SourceBusy for Disaster Mapping's own limit."""
    days = max(1, math.ceil((end - start) / DAY_MS))
    login = opera.login_state()
    egis: list[opera.Pass] = []
    retrieved = None
    egis_ok = True
    truncated = False
    try:
        grans, retrieved = opera.egis_granules(bbox, end, days, now_ms=now)
        truncated = len(grans) >= SEARCH_ROWS - 5
        egis = merge_passes(opera.group_passes(g for g in grans if start <= g.acquired_ms <= end))
    except SourceBusy:
        raise
    except SourceError as e:
        log.info("timeline: Earthdata GIS search: %s", e)
        egis_ok = False
    extra: list[opera.Pass] = []
    cmr_ok = False
    if login == "configured":
        grans_c: list[opera.Granule] = []
        for short in (opera.S1_SHORT_NAME, opera.HLS_SHORT_NAME):
            try:
                got, fetched = opera.cmr_granules(short, bbox, end, days)
                grans_c += [g for g in got if start <= g.acquired_ms <= end]
                cmr_ok = True
                retrieved = retrieved or fetched
            except SourceBusy:
                raise
            except SourceError as e:
                log.info("timeline: CMR %s: %s", short, e)
        for p in merge_passes(opera.group_passes(grans_c)):
            dup = any(q.product == p.product and q.sensor == p.sensor and abs(q.acquired_ms - p.acquired_ms) <= MERGE_MS
                      for q in egis)
            if not dup:
                extra.append(p)
    if not egis_ok and not cmr_ok:
        raise SourceError("no satellite catalog could be reached")
    passes = sorted(egis + extra, key=lambda q: (-q.acquired_ms, q.key))
    if len(passes) > MAX_PASSES:
        passes, truncated = passes[:MAX_PASSES], True
    return PassList(passes, retrieved, egis_ok, truncated, login)


# ----------------------------------------------------------------------------------------------------------------
# Reading one pass
# ----------------------------------------------------------------------------------------------------------------
def _cached_export(p: opera.Pass, bounds: BBox, sr: int, width: int, height: int) -> bool:
    if p.route != "earthdata_gis" or not p.oids:
        return False
    w, h = int(min(width, opera.EXPORT_MAX_PX)), int(min(height, opera.EXPORT_MAX_PX))
    return fhttp.peek_cache("GET", f"{opera.EGIS_HLS}/exportImage", opera.export_params(bounds, sr, w, h, p.oids),
                            opera.IMAGE_TTL_S) is not None


def polite_read(p: opera.Pass, bounds: BBox, sr: int, width: int, height: int, *,
                max_wait_s: float = POLITE_WAIT_S, sleep: Callable[[float], None] = time.sleep) -> np.ndarray:
    """``satellite._read`` of one pass that waits (never fails) while Disaster Mapping's Earthdata GIS limit is nearly
    used up, keeping :data:`LIMIT_RESERVE` slots for the satellite route. Raises SourceError (SourceBusy after
    ``max_wait_s``) and ``opera.LoginRefused``."""
    deadline = time.monotonic() + max_wait_s
    while True:
        if p.route == "earthdata_gis" and not _cached_export(p, bounds, sr, width, height) \
                and opera.EGIS_LIMITER.remaining() <= LIMIT_RESERVE:
            if time.monotonic() > deadline:
                raise SourceBusy("Earthdata GIS: Disaster Mapping's request limit is reached; try again in a minute")
            sleep(POLITE_SLEEP_S)
            continue
        try:
            return satellite._read(p, bounds, sr, int(width), int(height))
        except SourceBusy:
            if time.monotonic() > deadline:
                raise
            sleep(POLITE_SLEEP_S)


def _area_hash(bbox: BBox) -> str:
    return hashlib.sha1(",".join(f"{v:.5f}" for v in bbox).encode()).hexdigest()[:8]


def png_dir(flood_id: str) -> Path:
    return Path(config.CACHE_DIR) / "floods" / "timeline" / flood_id


def png_path(flood_id: str, key: str, area: str) -> Path:
    return png_dir(flood_id) / f"{key}-{area}.png"


def image_url(flood_id: str, key: str, area: str) -> str:
    return f"/api/floods/{flood_id}/passes/{key}.png?area={area}"


@dataclass
class PassRead:
    stats: dict                      # clear_pct, cloud_pct, nodata_pct, water_km2, partial_km2
    bounds: list[float] | None       # lon/lat bounds of the PNG (route reads)
    classes: np.ndarray | None = None  # grid classes (bundle reads)


def _shares_lonlat(cls: np.ndarray, bbox: BBox) -> dict:
    st = satellite.stats_of(cls, bbox)
    return {"clear_pct": round(max(0.0, 100.0 - st["cloud_pct"] - st["nodata_pct"]), 1), "cloud_pct": st["cloud_pct"],
            "nodata_pct": st["nodata_pct"], "water_km2": st["water_km2"], "partial_km2": st["partial_km2"]}


def shares_grid(cls: np.ndarray, res_m: float) -> dict:
    """View shares and water areas of classes on a UTM grid (equal cells)."""
    n = float(cls.size) or 1.0
    cloud = float((cls == opera.CLOUD).sum()) / n * 100.0
    nodata = float(((cls == opera.NO_DATA) | ~np.isin(cls, opera.CLASSES)).sum()) / n * 100.0
    cell_km2 = (res_m / 1000.0) ** 2
    return {"clear_pct": round(max(0.0, 100.0 - cloud - nodata), 1), "cloud_pct": round(cloud, 1),
            "nodata_pct": round(nodata, 1), "water_km2": round(float((cls == opera.OPEN_WATER).sum()) * cell_km2, 3),
            "partial_km2": round(float((cls == opera.PARTIAL_WATER).sum()) * cell_km2, 3)}


def read_lonlat(p: opera.Pass, bbox: BBox, flood_id: str, area: str) -> PassRead:
    """The 2D read of one pass: view shares over the map area and its PNG (written to :func:`png_path`; clouds and
    no data hatched, outside the pass transparent; the satellite route's palette)."""
    w, h = opera.px_size(bbox, satellite.IMAGE_TARGET_M, satellite.IMAGE_MAX_PX)
    cls = polite_read(p, bbox, 4326, w, h)
    fp = p.footprint()
    inside = satellite._lonlat_mask(fp, bbox, w, h) if fp is not None else np.ones((h, w), bool)
    cls = np.where(inside, cls, opera.NO_DATA).astype(np.uint8)
    stats = _shares_lonlat(cls, bbox)
    crop = satellite._crop(inside, bbox)
    bounds = None
    if crop is not None:
        rs, cs, bounds = crop
        out = png_path(flood_id, p.key, area)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(f".{out.name}.tmp")
        tmp.write_bytes(satellite.png_bytes(satellite.palette_rgba(cls[rs, cs], ~inside[rs, cs])))
        tmp.replace(out)
    return PassRead(stats, bounds)


def read_grid(p: opera.Pass, grid: Grid) -> PassRead:
    """The bundle read of one pass on the render grid (255 outside the pass's tiles)."""
    g = polite_read(p, tuple(grid.bounds), grid.epsg, grid.width, grid.height)
    fp = p.footprint()
    if fp is not None:
        g = np.where(satellite._grid_mask(fp, grid), g, opera.NO_DATA)
    g = g.astype(np.uint8)
    return PassRead(shares_grid(g, grid.res_m), None, g)


def view_of(stats: dict | None) -> str:
    if stats is None:
        return "unknown"
    if stats["clear_pct"] < USABLE_MIN_PCT:
        return "no_view"
    return "clear" if stats["clear_pct"] >= CLEAR_PCT else "partly_hidden"


def pass_out(p: opera.Pass, read: PassRead | None, *, tz: str, image: dict | None, layer: str | None) -> dict:
    """One ``FloodPass``."""
    st = read.stats if read is not None else None
    view = view_of(st)
    caveat = None
    if view == "no_view":
        caveat = tcopy.PASS_NO_VIEW
    elif st is not None:
        caveat = fcopy.sat_caveat(satellite.date_time_text(p.acquired_ms, tz),
                                  st["cloud_pct"] if p.product == "DSWx-HLS" else None, radar=p.product == "DSWx-S1")
    g0 = p.granules[0] if p.granules else None
    return {"key": p.key, "product": p.product, "platform": g0.platform if g0 else None, "acquired_ms": int(p.acquired_ms),
            "route": p.route, "granules": [g.id for g in p.granules], "url": g0.page_url if g0 else None, "view": view,
            "usable": view in ("clear", "partly_hidden"),
            "clear_pct": st["clear_pct"] if st else None, "cloud_pct": st["cloud_pct"] if st else None,
            "nodata_pct": st["nodata_pct"] if st else None, "water_km2": st["water_km2"] if st else None,
            "partial_km2": st["partial_km2"] if st else None,
            "image": image if view in ("clear", "partly_hidden") else None, "layer": layer, "caveat": caveat}


def default_key(passes: list[dict]) -> str | None:
    """The pass a satellite layer shows by default: the newest usable pass that saw at least half of the area clearly,
    else the clearest usable pass (``satellite.choose_egis``'s rule over every read pass)."""
    usable = [p for p in passes if p["usable"]]
    good = [p for p in usable if (p["clear_pct"] or 0) >= CLEAR_PCT]
    if good:
        return max(good, key=lambda p: p["acquired_ms"])["key"]
    return max(usable, key=lambda p: (p["clear_pct"] or 0, p["acquired_ms"]))["key"] if usable else None


def key_for_granules(passes: list[opera.Pass], granule_ids: list[str]) -> str | None:
    """The (merged) pass holding any of ``granule_ids`` (the satellite answer's image)."""
    ids = set(granule_ids)
    return next((p.key for p in passes if ids & {g.id for g in p.granules}), None)


def _passes_base(now: int, start: int, end: int, login: str) -> dict:
    return {"status": "available", "reason_code": None, "reason": None, "login": login,
            "login_note": {"not_configured": fcopy.SAT_NOT_SET_UP, "refused": fcopy.SAT_LOGIN_REFUSED}.get(login),
            "source": satellite._source("DSWx-HLS", "earthdata_gis"), "retrieved_ms": None, "start_ms": int(start),
            "end_ms": int(end), "complete": True, "truncated": False, "stats_over": "map_area", "passes": [],
            "shown_key": None, "caveats": [tcopy.PASSES_NOTE]}


def _date(ms: int, tz: str) -> str:
    """"Oct 29, 2026" in the flood's zone (the date part of ``satellite.date_time_text``)."""
    return ", ".join(satellite.date_time_text(ms, tz).split(", ")[:2])


def _list_or_answer(out: dict, bbox: BBox, start: int, end: int, now: int, tz: str) -> PassList | None:
    """The pass list, or None with ``out`` filled as the answer (before the archive, nothing reached, no pass)."""
    if end < opera.EGIS_ARCHIVE_START_MS:
        out.update(status="not_available_for_past_dates", reason_code="before_archive",
                   reason=tcopy.PASSES_BEFORE_ARCHIVE)
        return None
    try:
        pl = list_passes(bbox, start, end, now=now)
    except SourceBusy:
        out.update(status="unavailable", reason_code="upstream_error", reason=tcopy.PASSES_UNAVAILABLE,
                   complete=False)
        return None
    except SourceError:
        out.update(status="unavailable", reason_code="upstream_error", reason=tcopy.PASSES_UNAVAILABLE)
        return None
    out.update(retrieved_ms=pl.retrieved_ms, truncated=pl.truncated, login=pl.login)
    if pl.truncated:
        out["caveats"].append(tcopy.PASSES_TRUNCATED)
    if not pl.passes:
        out.update(reason_code="no_image", reason=tcopy.passes_none(_date(start, tz), _date(end, tz)))
        return None
    return pl


# ----------------------------------------------------------------------------------------------------------------
# The route's passes (2D): reads in the background, answered within ROUTE_WAIT_S
# ----------------------------------------------------------------------------------------------------------------
_lock = threading.Lock()
_pool: ThreadPoolExecutor | None = None
_reads: dict[tuple, tuple[float, PassRead | None]] = {}     # key -> (monotonic expiry, read or None = failed)
_inflight: dict[tuple, Future] = {}
_answers: dict[str, tuple[float, dict]] = {}
_products: dict[str, tuple[float, dict]] = {}
_last_lists: dict[str, tuple[BBox, list[opera.Pass]]] = {}
READ_TTL_S = 30 * 86400.0
MAX_READS_KEPT = 2000


def _get_pool() -> ThreadPoolExecutor:
    global _pool
    with _lock:
        if _pool is None:
            _pool = ThreadPoolExecutor(max_workers=READ_WORKERS, thread_name_prefix="flood-passes")
        return _pool


def _read_key(flood_id: str, p: opera.Pass, area: str) -> tuple:
    return (flood_id, p.key, area, tuple(sorted(g.id for g in p.granules)))


def _run_read(key: tuple, p: opera.Pass, bbox: BBox, flood_id: str, area: str) -> PassRead | None:
    try:
        r: PassRead | None = read_lonlat(p, bbox, flood_id, area)
        ttl = READ_TTL_S
    except opera.LoginRefused:
        r, ttl = None, FAILED_TTL_S
    except SourceError as e:                       # SourceBusy included
        log.info("timeline: pass %s: %s", p.key, e)
        r, ttl = None, FAILED_TTL_S
    except Exception as e:  # noqa: BLE001 - one unreadable pass never fails the list
        log.warning("timeline: pass %s: %s", p.key, type(e).__name__)
        r, ttl = None, FAILED_TTL_S
    with _lock:
        if len(_reads) > MAX_READS_KEPT:
            for k in list(_reads)[: MAX_READS_KEPT // 4]:
                _reads.pop(k, None)
        _reads[key] = (time.monotonic() + ttl, r)
        _inflight.pop(key, None)
    return r


def _start_read(flood_id: str, p: opera.Pass, bbox: BBox, area: str) -> tuple[bool, PassRead | None, Future | None]:
    """(known, read, future): a finished read (``read`` None when it failed recently) or the running one."""
    key = _read_key(flood_id, p, area)
    with _lock:
        hit = _reads.get(key)
        if hit is not None and hit[0] > time.monotonic():
            return True, hit[1], None
        fut = _inflight.get(key)
    if fut is None:
        fut = _get_pool().submit(_run_read, key, p, bbox, flood_id, area)
        with _lock:
            _inflight.setdefault(key, fut)
            fut = _inflight.get(key) or fut
    return False, None, fut


def route_passes(summary: dict, bbox: BBox, *, now: int, shown_granules: list[str] | None = None,
                 wait_s: float = ROUTE_WAIT_S) -> dict:
    """``FloodPassHistory`` for the 2D views (stats over the map area, PNG per pass). Never raises for an upstream
    failure."""
    fid = summary["id"]
    tz = summary.get("time_zone") or "UTC"
    start, end = flood_window(summary, now)
    out = _passes_base(now, start, end, opera.login_state())
    pl = _list_or_answer(out, bbox, start, end, now, tz)
    if pl is None:
        return out
    area = _area_hash(bbox)
    with _lock:
        _last_lists[fid] = (bbox, list(pl.passes))
    pending: dict[str, Future] = {}
    known: dict[str, PassRead | None] = {}
    for p in pl.passes:
        done, r, fut = _start_read(fid, p, bbox, area)
        if done:
            known[p.key] = r
        elif fut is not None:
            pending[p.key] = fut
    if pending:
        wait_futures(list(pending.values()), timeout=max(0.0, wait_s))
    rows = []
    unknown = False
    still = False
    for p in sorted(pl.passes, key=lambda q: (q.acquired_ms, q.key)):
        r: PassRead | None
        if p.key in known:
            r = known[p.key]
        elif pending[p.key].done():
            try:
                r = pending[p.key].result()
            except Exception:  # noqa: BLE001 - recorded as unknown
                r = None
        else:
            r, still = None, True
        unknown = unknown or r is None
        img = {"url": image_url(fid, p.key, area), "bounds_lonlat": r.bounds} if (r is not None and r.bounds) else None
        rows.append(pass_out(p, r, tz=tz, image=img, layer=None))
    out["passes"] = rows
    out["complete"] = not still
    out["shown_key"] = (key_for_granules(pl.passes, shown_granules) if shown_granules else None) or default_key(rows)
    if unknown:
        out["caveats"].append(tcopy.PASSES_PARTIAL)
    if not pl.egis_ok and out["login"] == "configured":
        out["caveats"].append(fcopy.SAT_UNAVAILABLE)
    return out


def pass_png(flood_id: str, key: str, area: str, *, bbox: BBox | None, summary: dict | None = None,
             now: int | None = None) -> bytes | None:
    """The PNG of one pass of the route's list (from disk, else read again when ``bbox`` is the current map area of
    the same hash: the pass from the last list, or a new search of the flood's window); None when it is no longer
    kept or cannot be made."""
    p = png_path(flood_id, key, area)
    if p.is_file():
        return p.read_bytes()
    if bbox is None or _area_hash(bbox) != area:
        return None
    with _lock:
        last = _last_lists.get(flood_id)
    hit = next((q for q in (last[1] if last else []) if q.key == key), None)
    if hit is None and summary is not None:
        t = int(now if now is not None else time.time() * 1000)
        start, end = flood_window(summary, t)
        try:
            hit = next((q for q in list_passes(bbox, start, end, now=t).passes if q.key == key), None)
        except SourceError as e:                                    # SourceBusy included
            log.info("timeline png %s: %s", key, e)
            return None
    if hit is None:
        return None
    try:
        read_lonlat(hit, bbox, flood_id, area)
    except Exception as e:  # noqa: BLE001 - an image that cannot be made: 404
        log.info("timeline png %s: %s", key, type(e).__name__)
        return None
    return p.read_bytes() if p.is_file() else None


# ----------------------------------------------------------------------------------------------------------------
# The bundle's passes (Forensic): every pass read on the render grid, rasters for the newest usable ones
# ----------------------------------------------------------------------------------------------------------------
@dataclass
class BundlePasses:
    answer: dict                                   # FloodPassHistory (stats over the bundle grid)
    rasters: dict[str, np.ndarray]                 # layer name -> classes on the render grid
    descriptions: dict[str, str]


def layer_name(key: str) -> str:
    return f"water_pass_{key}"


def bundle_passes(summary: dict, grid: Grid, bbox: BBox, *, now: int, shown_granules: list[str] | None = None,
                  progress: Callable[[float, str], None] | None = None) -> BundlePasses:
    """Read the newest :data:`MAX_BUNDLE_READS` passes on the render grid (polite, waiting for the limiter: a build
    is a background job) and keep the classes of the newest :data:`MAX_BUNDLE_PASSES` usable ones."""
    fid = summary["id"]
    tz = summary.get("time_zone") or "UTC"
    start, end = flood_window(summary, now)
    out = {**_passes_base(now, start, end, opera.login_state()), "stats_over": "bundle_grid"}
    pl = _list_or_answer(out, bbox, start, end, now, tz)
    if pl is None:
        return BundlePasses(out, {}, {})
    to_read = pl.passes[:MAX_BUNDLE_READS]
    reads: dict[str, PassRead | None] = {}
    done = 0

    def one(p: opera.Pass) -> tuple[str, PassRead | None]:
        try:
            return p.key, read_grid(p, grid)
        except opera.LoginRefused:
            return p.key, None
        except SourceError as e:
            log.info("timeline bundle: pass %s: %s", p.key, e)
            return p.key, None

    with ThreadPoolExecutor(max_workers=READ_WORKERS, thread_name_prefix=f"flood-passes-{fid[-6:]}") as pool:
        for key, r in pool.map(one, to_read):
            reads[key] = r
            done += 1
            if progress is not None:
                progress(done / max(1, len(to_read)), f"Satellite passes: {done} of {len(to_read)} read")
    rasters: dict[str, np.ndarray] = {}
    desc: dict[str, str] = {}
    kept = 0
    rows = []
    unknown = False
    for p in pl.passes:                                                 # newest first: rasters for the newest
        r = reads.get(p.key)
        unknown = unknown or r is None
        layer = None
        if r is not None and view_of(r.stats) in ("clear", "partly_hidden") and kept < MAX_BUNDLE_PASSES:
            layer = layer_name(p.key)
            rasters[layer] = r.classes                                  # type: ignore[assignment]
            desc[layer] = (f"Water seen by satellite, {p.product} pass of "
                           f"{time.strftime('%Y-%m-%dT%H:%MZ', time.gmtime(p.acquired_ms / 1000))} (NASA OPERA DSWx "
                           "WTR classes; 255 = no data or outside the image)")
            kept += 1
        rows.append(pass_out(p, r, tz=tz, image=None, layer=layer))       # Forensic draws ``layer``; no 2D image
    out["passes"] = sorted(rows, key=lambda q: (q["acquired_ms"], q["key"]))
    out["shown_key"] = (key_for_granules(pl.passes, shown_granules) if shown_granules else None) or \
        default_key(out["passes"])
    usable_unkept = sum(1 for row in rows if row["usable"] and row["layer"] is None)
    if usable_unkept or len(pl.passes) > len(to_read):
        out["caveats"].append(tcopy.passes_bundle_limit(MAX_BUNDLE_PASSES))
    if unknown:
        out["caveats"].append(tcopy.PASSES_PARTIAL)
    return BundlePasses(out, rasters, desc)


# ----------------------------------------------------------------------------------------------------------------
# NWS product history
# ----------------------------------------------------------------------------------------------------------------
def _event_of(key: str) -> nws.ArchiveEvent | None:
    m = history._KEY_RE.match(key or "")
    if not m:
        return None
    wfo, ph, sig, etn, year = m.group(1), m.group(2), m.group(3), int(m.group(4)), int(m.group(5))
    return nws.ArchiveEvent(wfo, year, ph, sig, etn,
                            history.IEM_EVENT_PAGE.format(year=year, ph=ph, sig=sig, etn=etn, wfo=wfo))


def _event_vtec(seg: dict, ev: nws.ArchiveEvent) -> dict | None:
    for v in seg.get("vtec") or []:
        if (str(v.get("office") or "")[-3:].upper(), v.get("phenomena"), v.get("significance"),
                int(v.get("etn") or -1)) == (ev.wfo, ev.phenomena, ev.significance, ev.etn):
            return v
    return None


def archived_versions(ev: nws.ArchiveEvent, *, flood_id: str, now: int, over: bool) -> tuple[list[dict], dict]:
    """Every archived version of one event (one item per product segment carrying it) and the zone features of the
    versions without a polygon (``{ugc: feature}``). Raises SourceError / SourceBusy (the event text)."""
    detail = nws.event_detail(ev, now=now)
    names = {r["ugc"]: r["name"] for r in detail.zone_rows if r.get("name")}
    items: list[dict] = []
    for prod in detail.products:
        segs = [(s, v) for s in detail.segments(prod) if (v := _event_vtec(s, ev)) is not None]
        for i, (seg, v) in enumerate(segs):
            a = history._past_alert(prod, {**seg, "_vtec": v}, ev=ev, flood_id=flood_id, now=now, names=names,
                                    over=over)
            if len(segs) > 1:
                a["id"] = f"{a['id']}#s{i + 1}"
            items.append(a)
    feats: dict[str, dict] = {}
    if any(a["geometry"] is None for a in items):
        try:
            nws.load_event_zones(ev, detail, now=now)
        except SourceError as e:                               # SourceBusy included: outlines missing
            log.info("timeline: zones of %s: %s", ev.key, e)
        for a in items:
            if a["geometry"] is not None:
                continue
            for ugc in a["ugcs"]:
                g = detail.zones.get(ugc)
                if g is None:
                    continue
                f = feats.setdefault(ugc, {"type": "Feature", "id": ugc, "geometry": nws.simplified(g),
                                           "properties": {"ugc": ugc, "name": names.get(ugc) or ugc, "alert_ids": []}})
                f["properties"]["alert_ids"].append(a["id"])
    return items, feats


def with_timing(items: list[dict], now: int) -> list[dict]:
    """``FloodTimelineProduct``s: ``vtec_key``, ``replaced_ms`` (the next version of the same event), ``shown_from_ms``
    (its issue time) and ``shown_until_ms`` (its own end, the next version, or its issue time for CAN / UPG); the
    phase follows from them. Oldest first."""
    by_key: dict[str, list[int]] = {}
    for a in items:
        k = nws.vtec_key(a.get("vtec"))
        if k and a.get("sent_ms") is not None:
            by_key.setdefault(k, []).append(int(a["sent_ms"]))
    out = []
    for a in items:
        k = nws.vtec_key(a.get("vtec"))
        sent = a.get("sent_ms")
        later = sorted(t for t in by_key.get(k or "", []) if sent is not None and t > sent)
        replaced = later[0] if later else None
        action = str((a.get("vtec") or {}).get("action") or "").upper()
        if sent is not None and action in ENDS_AT_ISSUE:
            until = int(sent)
        else:
            ends = [t for t in (a.get("ends_ms"), replaced) if t is not None]
            until = min(ends) if ends else None
            if until is not None and sent is not None:
                until = max(int(until), int(sent))
        onset = a.get("onset_ms")
        if sent is not None and sent > now:
            phase = "upcoming"
        elif (until is not None and until <= now) or (until is None and a.get("phase") == "ended"):
            phase = "ended"                                         # its end passed, or a past flood's version
        elif onset is not None and onset > now:
            phase = "upcoming"
        else:
            phase = "in_effect"
        out.append({**a, "phase": phase, "vtec_key": k, "replaced_ms": replaced,
                    "shown_from_ms": int(sent) if sent is not None else None, "shown_until_ms": until})
    return sorted(out, key=lambda x: (x["shown_from_ms"] if x["shown_from_ms"] is not None else 0, x["id"]))


def _dedupe(archived: list[dict], live: list[dict]) -> list[dict]:
    """Archived copies of a version NWS still lists live are dropped (same event, issued within
    :data:`DEDUPE_MS`, same action when the event has several)."""
    drop: set[str] = set()
    for la in live:
        k = nws.vtec_key(la.get("vtec"))
        if not k or la.get("sent_ms") is None:
            continue
        cands = [a for a in archived if a["id"] not in drop and nws.vtec_key(a.get("vtec")) == k
                 and a.get("sent_ms") is not None and abs(int(a["sent_ms"]) - int(la["sent_ms"])) <= DEDUPE_MS]
        same = [a for a in cands if (a.get("vtec") or {}).get("action") == (la.get("vtec") or {}).get("action")]
        for a in (same or cands)[:1]:
            drop.add(a["id"])
    return [a for a in archived if a["id"] not in drop]


def _products_env(fid: str, now: int, *, synthetic: bool = False) -> dict:
    return {"kind": "flood_alerts", "status": "available", "reason_code": None, "reason": None,
            "source": dict(fcopy.SOURCE_NWS), "retrieved_ms": None, "source_updated_ms": None, "requested_at_ms": None,
            "now_ms": now, "flood_id": fid, "synthetic": synthetic, "caveats": [tcopy.PRODUCTS_NOTE],
            "products": [], "zones": {"type": "FeatureCollection", "features": []}, "archive_source": None,
            "complete": True}


def _finish_products(out: dict, items: list[dict], zone_feats: dict[str, dict], now: int) -> dict:
    timed = with_timing(items, now)
    if len(timed) > MAX_VERSIONS:
        timed = timed[-MAX_VERSIONS:]
        out["caveats"].append(tcopy.PRODUCTS_TRUNCATED)
    ids = {a["id"] for a in timed}
    feats = []
    for f in zone_feats.values():
        keep = [i for i in dict.fromkeys(f["properties"]["alert_ids"]) if i in ids]
        if keep:
            feats.append({**f, "properties": {**f["properties"], "alert_ids": keep}})
    sent = [a["sent_ms"] for a in timed if a.get("sent_ms")]
    out.update(products=timed, zones={"type": "FeatureCollection", "features": feats},
               source_updated_ms=max(sent) if sent else None)
    return out


def product_history(summary: dict, *, now: int) -> dict:
    """``FloodProductHistory`` of one flood (module docstring). Never raises for an upstream failure."""
    fid = summary["id"]
    out = _products_env(fid, now)
    past = summary.get("mode") == "historical"
    over = past or summary.get("status") == "inactive"
    live_alerts: list[dict] = []
    live_zones: list[dict] = []
    live_ok = False
    if not past:
        try:
            la = zones.flood_alerts(summary, now=now)
            if la.get("status") == "available":
                live_ok = True
                live_alerts = list(la.get("alerts") or [])
                live_zones = list((la.get("zones") or {}).get("features") or [])
                out["retrieved_ms"] = la.get("retrieved_ms")
                out["caveats"] += [c for c in la.get("caveats") or [] if c not in out["caveats"]]
        except SourceError as e:                        # SourceBusy included
            log.info("timeline: live products %s: %s", fid, e)
    keys: list[str] = []
    for k in [p.get("vtec_key") for p in summary.get("products") or []] + \
             [nws.vtec_key(a.get("vtec")) for a in live_alerts]:
        if k and k not in keys:
            keys.append(k)
    archived: list[dict] = []
    zone_feats: dict[str, dict] = {}
    failed = busy = asked = 0
    for key in keys[:MAX_EVENTS]:
        ev = _event_of(key)
        if ev is None:
            continue
        asked += 1
        try:
            items, feats = archived_versions(ev, flood_id=fid, now=now, over=over)
        except SourceBusy:
            busy += 1
            continue
        except SourceError as e:
            log.info("timeline: archive %s: %s", key, e)
            failed += 1
            continue
        archived += items
        for ugc, f in feats.items():
            if ugc in zone_feats:
                zone_feats[ugc]["properties"]["alert_ids"] += f["properties"]["alert_ids"]
            else:
                zone_feats[ugc] = f
    if asked and (failed + busy) < asked:
        out["archive_source"] = dict(fcopy.SOURCE_IEM)
        out["retrieved_ms"] = out["retrieved_ms"] or now
    if not live_ok and not past:
        out["source"] = dict(fcopy.SOURCE_IEM)
    archived = _dedupe(archived, live_alerts)
    for f in live_zones:
        ugc = (f.get("properties") or {}).get("ugc") or f.get("id")
        if ugc in zone_feats:
            zone_feats[ugc]["properties"]["alert_ids"] += list(f["properties"].get("alert_ids") or [])
        elif ugc:
            zone_feats[ugc] = {**f, "properties": {**f["properties"], "alert_ids": list(f["properties"].get("alert_ids") or [])}}
    items = archived + live_alerts
    if busy:
        out["complete"] = False
    if asked and failed + busy == asked:
        if not live_ok:
            out.update(status="unavailable", reason_code="upstream_error",
                       reason=history.PAST_ALERTS_DOWN if past else fcopy.ALERTS_UNAVAILABLE)
            return out
        out["caveats"].append(tcopy.PRODUCTS_ARCHIVE_DOWN)
    elif failed or busy:
        out["caveats"].append(tcopy.PRODUCTS_ARCHIVE_PARTIAL)
    if not keys and not live_alerts:
        if not past and not live_ok:
            out.update(status="unavailable", reason_code="upstream_error", reason=fcopy.ALERTS_UNAVAILABLE)
            return out
        out["caveats"].append(tcopy.PRODUCTS_NONE)
    return _finish_products(out, items, zone_feats, now)


def cached_product_history(summary: dict, *, now: int) -> dict:
    """:func:`product_history` kept :data:`PRODUCTS_TTL_S` (complete answers only)."""
    fid = summary["id"]
    with _lock:
        hit = _products.get(fid)
        if hit is not None and hit[0] > time.monotonic():
            return {**hit[1], "now_ms": now}
    ans = product_history(summary, now=now)
    if ans.get("complete") and ans["status"] == "available":
        with _lock:
            _products[fid] = (time.monotonic() + PRODUCTS_TTL_S, ans)
    return ans


# ----------------------------------------------------------------------------------------------------------------
# The whole answer
# ----------------------------------------------------------------------------------------------------------------
def timeline(summary: dict, passes: dict, products: dict, *, now: int, synthetic: bool = False) -> dict:
    """``FloodTimelineResponse``."""
    return {"kind": "flood_timeline", "flood_id": summary["id"], "now_ms": int(now), "start_ms": passes["start_ms"],
            "end_ms": passes["end_ms"], "passes": passes, "products": products, "synthetic": synthetic}


def route_timeline(summary: dict, bbox: BBox, *, now: int, shown_granules: list[str] | None = None,
                   wait_s: float = ROUTE_WAIT_S) -> dict:
    """The route's answer, kept :data:`ANSWER_TTL_S` once complete."""
    fid = summary["id"]
    ck = f"{fid}|{_area_hash(bbox)}"
    with _lock:
        hit = _answers.get(ck)
        if hit is not None and hit[0] > time.monotonic():
            return {**hit[1], "now_ms": now}
    ps = route_passes(summary, bbox, now=now, shown_granules=shown_granules, wait_s=wait_s)
    pr = cached_product_history(summary, now=now)
    ans = timeline(summary, ps, pr, now=now)
    if ps["complete"] and pr["complete"] and ps["status"] == "available" and pr["status"] == "available" \
            and tcopy.PASSES_PARTIAL not in ps["caveats"]:
        with _lock:
            _answers[ck] = (time.monotonic() + ANSWER_TTL_S, ans)
    return ans


def bundle_timeline(bdir: Path, manifest: dict, *, now: int) -> dict | None:
    """A bundle's frozen ``timeline.json`` (``now_ms`` updated); for a synthetic bundle without one (``fixture-flood``)
    a timeline made from its frozen ``satellite.json`` (one pass, its ``water_satellite`` layer) and
    ``warnings.json``. None when neither exists."""
    import orjson

    p = bdir / "timeline.json"
    if p.is_file():
        try:
            return {**orjson.loads(p.read_bytes()), "now_ms": now}
        except (OSError, orjson.JSONDecodeError):
            return None
    summary = manifest.get("summary") or {}
    if not summary.get("synthetic"):
        return None
    try:
        sat = orjson.loads((bdir / "satellite.json").read_bytes())
        warn = orjson.loads((bdir / "warnings.json").read_bytes())
    except (OSError, orjson.JSONDecodeError):
        return None
    return synthetic_timeline(summary, sat, warn, now=now,
                              has_layer="water_satellite" in (manifest.get("layers") or {}))


def synthetic_timeline(summary: dict, sat: dict, warn: dict, *, now: int, has_layer: bool) -> dict:
    """The fixture's timeline: its one simulated pass and its frozen products (``synthetic: true``)."""
    fid = summary["id"]
    start, end = flood_window(summary, now)
    ps = {**_passes_base(now, start, end, sat.get("login") or "not_configured"), "source": sat.get("source"),
          "retrieved_ms": sat.get("retrieved_ms"), "stats_over": "bundle_grid"}
    ps["caveats"].append(tcopy.PASSES_SYNTHETIC)
    g = (sat.get("granules") or [None])[0]
    if sat.get("measured") and g:
        url = (sat.get("image") or {}).get("url") or ""
        key = url.split("granule=", 1)[1] if "granule=" in url else g["id"]
        st = sat.get("stats") or {}
        stats = {"clear_pct": round(max(0.0, 100.0 - st.get("cloud_pct", 0) - st.get("nodata_pct", 0)), 1),
                 "cloud_pct": st.get("cloud_pct"), "nodata_pct": st.get("nodata_pct"),
                 "water_km2": st.get("water_km2"), "partial_km2": st.get("partial_km2")}
        view = view_of(stats)
        ps["passes"] = [{"key": key, "product": g["product"], "platform": g.get("platform"),
                         "acquired_ms": int(g["acquired_ms"]), "route": "earthdata_gis", "granules": [g["id"]],
                         "url": g.get("url"), "view": view, "usable": view in ("clear", "partly_hidden"), **stats,
                         "image": sat.get("image"), "layer": "water_satellite" if has_layer else None,
                         "caveat": (sat.get("caveats") or [None])[0]}]
        ps["shown_key"] = key
    else:
        ps.update(reason_code=sat.get("reason_code"), reason=sat.get("reason"))
    pr = _products_env(fid, now, synthetic=True)
    pr.update(source=warn.get("source") or pr["source"], retrieved_ms=warn.get("retrieved_ms"))
    zf = {(f.get("properties") or {}).get("ugc") or str(f.get("id")): f
          for f in (warn.get("zones") or {}).get("features") or []}
    pr = _finish_products(pr, list(warn.get("alerts") or []), zf, now)
    return timeline(summary, ps, pr, now=now, synthetic=True)


def satellite_granules(flood_id: str, bbox: BBox) -> list[str] | None:
    """The granule ids of the image the satellite route answered for this flood and area (its in-memory answer, if
    any; never a new request), so the timeline's ``shown_key`` is the pass the 2D satellite layer shows."""
    key = (flood_id, tuple(round(v, 4) for v in bbox), None)
    try:
        with satellite._lock:
            hit = satellite._cache.get(key)
    except AttributeError:
        return None
    if hit is None:
        return None
    ans = hit[1].answer
    return [g["id"] for g in ans.get("granules") or []] if ans.get("measured") else None


def reset_state() -> None:
    """Forget every cached read and answer (tests)."""
    with _lock:
        _reads.clear()
        _inflight.clear()
        _answers.clear()
        _products.clear()
        _last_lists.clear()
