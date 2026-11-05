"""Past floods (brief 5, backend-flood-live M2; PLAN-5 3.6 and user decision U1 (a); CONTRACT 16.2 / 16.8; SPEC 8.10).

**Year lists** (``GET /api/floods?mode=historical&year=``, :data:`PAST_YEARS`) are built once per year in a background
thread (:func:`year_list` answers ``preparing: true`` until then) from the Iowa Environmental Mesonet's archive of NWS
products (an archived copy, not an official NWS source; credited as such):

* **The bulk route** (found in this step; PLAN-5 asked for at most 10 requests of research, 6 were used): IEM's
  watch / warning export ``cgi-bin/request/gis/watchwarn.py?accept=csv&limit1=1&addsvs=1`` gives one row per
  storm-based warning polygon (the issuance and each follow-up statement) with the H-VTEC NWSLI and **severity**, the
  **damage tag** and the **emergency flag**; IEM's ``api/1/vtec/sbw_interval.geojson`` gives the issuance polygons
  (with the year and the counties). Two requests a month, plus the gauges' names and positions from the NWS
  ``riv_gauges`` map (150 gauges a request): about 30 requests a year, at IEM's own limit (30 a minute, shared with the
  fire archive), cached for good for a closed year and 30 days for the current year's closed months (6 h for the
  current month). So the year lists follow **PAST_RULE** (``past_rule: "moderate_or_worse"``), not the fallback:

  - river **Flood Warnings** (FL.W) at an NWS gauge whose H-VTEC severity reached **2 (moderate) or 3 (major)** in any
    of their products, one flood per **gauge episode** (warnings at one gauge less than :data:`EPISODE_GAP_H` apart;
    the same gauge flooding again later is another flood, rule 10);
  - **Flash Flood Warnings** (FF.W) whose damage threat reached **CONSIDERABLE or CATASTROPHIC**, or that IEM marks as
    an emergency; warnings whose polygons overlap (30 % of the smaller) within 12 h are one flood.

  Smaller floods are not listed (the web's ``PAST_RULE_NOTE`` says so; never an all-clear).
* **Ids agree with live ids:** the registry is looked up by VTEC key first, so a 2026 flood Fire-3d saw live keeps its
  live id (and its live name); groups that map to one live id are merged. Other ids are deterministic
  (``naming.make_flood_id`` from the start, the name before duplicate suffixes, and the gauge or the oldest VTEC key).
* Rows: ``mode: "historical"``, ``status: "inactive"`` (a 2026 flood still in the live list is served as its live
  row), level ``warning``, ``max_category`` from the H-VTEC severity (NWS's own category for the event), products
  ``archived`` with phase ``ended`` and IEM's event page, ``gauges_in_flood`` 0 (no reading is kept for a past list).

**Past answers per flood** (``at_ms`` before now - 6 h):

* :func:`past_flood_alerts`: the flood's NWS products from IEM's per-event archive (``json/vtec_event.py``, cached 30
  days once over): every version (issuance and follow-up statements) of each event, the event's own segment verbatim
  (headline, description, instruction), its polygon (``LAT...LON``), H-VTEC, damage threat and detection; ``archived:
  true``, source IEM. At most :data:`MAX_PAST_EVENTS` events per answer.
* :func:`past_gauges`: member gauges with USGS's measured stage and flow around the flood (provisional data, USGS v1,
  no key), NWS's thresholds and impacts of today (``THRESHOLDS_TODAY``), no forecast (``PAST_NO_FORECAST``); the
  reading's category is ``unknown`` (NWS's category of a past reading is not kept; Fire-3d does not infer one).
* An area or point at a past time answers ``not_available_for_past_dates`` with :data:`PAST_AREA_ALERTS` /
  :data:`PAST_AREA_GAUGES` (open a past flood for its archived products and readings).
"""

from __future__ import annotations

import csv
import io
import logging
import re
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

import orjson
import shapely
from shapely.geometry import Point, Polygon, mapping

from .. import bundle, config, regions
from .. import http as fhttp
from ..sources import nwps, nws, usgs_water
from ..sources.nws import SourceBusy, SourceError
from ..timeutil import now_ms
from . import copy as fcopy
from . import grouping as G
from . import naming, store
from . import registry as reg_mod

log = logging.getLogger(__name__)

PAST_YEARS = (2026, 2025)                                    # CONTRACT 16.8
PAST_RULE = "moderate_or_worse"                              # PLAN-5 3.6 target rule (a bulk severity route exists)
SCHEMA = 1                                                   # bump when the year rows change shape or rule
WATCHWARN_URL = f"{nws.IEM_ROOT}/cgi-bin/request/gis/watchwarn.py"
SBW_URL = f"{nws.IEM_ROOT}/api/1/vtec/sbw_interval.geojson"
IEM_EVENT_PAGE = nws.IEM_ROOT + "/vtec/?year={year}&phenomena={ph}&sig={sig}&eventid={etn}&wfo={wfo}"
IEM_PRODUCT_PAGE = nws.IEM_ROOT + "/p.php?pid={pid}"
EPISODE_GAP_H = G.INACTIVE_LISTED_H                          # warnings at one gauge closer than this: one flood
FLASH_JOIN_H = G.AREAL_NEAR_H
DAY_MS = 86_400_000
HOUR_MS = 3_600_000
MONTH_TTL_CLOSED_S: float | None = None                     # a closed year's months: for good
MONTH_TTL_PAST_S = 30 * 86400.0                              # this year's closed months
MONTH_TTL_OPEN_S = 6 * 3600.0                                # the current month
YEAR_REFRESH_H = 6.0                                         # the current year's list is rebuilt after this
FAILED_RETRY_S = 600.0                                       # a failed or partial year build is retried after this
IEM_TIMEOUT_S = 180.0                                        # a busy month's CSV takes IEM a while to make
BUSY_WAIT_S = 4.0                                            # Fire-3d's own IEM limit reached: wait, then try again
BUSY_TRIES = 30
GAUGE_BATCH = 150
GAUGE_TTL_S = 30 * 86400.0
MAX_PAST_EVENTS = 12
MAX_PAST_GAUGES = 6
PAST_TOLERANCE_MS = 6 * HOUR_MS
SEVERITY = {"1": 1, "2": 2, "3": 3}
SEVERITY_CATEGORY = {2: "moderate", 3: "major"}
DAMAGE = {"CONSIDERABLE": 2, "CATASTROPHIC": 3}
EVENT = {"FL": "Flood Warning", "FF": "Flash Flood Warning"}

# Fire-3d's own sentences (guard-tested in tests/test_floods_history.py with the PLAN-5 5.1 patterns)
SOURCE_NAME = "National Weather Service, archived copy via the Iowa Environmental Mesonet (Iowa State University)"
ARCHIVE_DOWN = ("The archive of NWS warnings (Iowa Environmental Mesonet) could not be reached right now, so past floods "
                "could not be listed. That is not an all-clear.")
ARCHIVE_PARTIAL = ("Part of the archive of NWS warnings (Iowa Environmental Mesonet) could not be read ({months}); "
                   "floods of those months may be missing. That is not an all-clear.")
YEAR_NOT_KEPT = "Fire-3d lists past floods for {years} only. That is not an all-clear."
PAST_AREA_ALERTS = ("Past NWS flood products are shown per flood: open a past flood to see its archived products. "
                    "That is not an all-clear.")
PAST_AREA_GAUGES = ("Past river gauge readings are shown per flood and per gauge; nearby gauges are not kept for past "
                    "dates. That is not an all-clear.")
PAST_ALERTS_DOWN = ("The archive of NWS flood products (Iowa Environmental Mesonet) could not be reached right now. "
                    "That is not an all-clear: follow local officials.")
NO_USGS_SITE = "NWS names no USGS site for this gauge, so its past readings are not available here."
PAST_GAUGE_NOT_KEPT = "Past readings are not kept for this gauge. That is not an all-clear."
PAST_BEFORE_FLOOD = ("This flood's NWS products were sent after that time; Fire-3d shows a flood's products from its "
                     "start. That is not an all-clear.")
PAST_STRINGS = {"ARCHIVE_DOWN": ARCHIVE_DOWN, "ARCHIVE_PARTIAL": ARCHIVE_PARTIAL, "YEAR_NOT_KEPT": YEAR_NOT_KEPT,
                "PAST_AREA_ALERTS": PAST_AREA_ALERTS, "PAST_AREA_GAUGES": PAST_AREA_GAUGES,
                "PAST_ALERTS_DOWN": PAST_ALERTS_DOWN, "NO_USGS_SITE": NO_USGS_SITE,
                "PAST_GAUGE_NOT_KEPT": PAST_GAUGE_NOT_KEPT, "PAST_BEFORE_FLOOD": PAST_BEFORE_FLOOD}


def default_year() -> int:
    return time.gmtime().tm_year


def is_past(at_ms: int | None, now: int) -> bool:
    return at_ms is not None and at_ms < now - PAST_TOLERANCE_MS


# ----------------------------------------------------------------------------------------------------------------
# Requests (IEM, through fire3d.http on nws.IEM_LIMITER)
# ----------------------------------------------------------------------------------------------------------------
def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def _ms(text: str | None) -> int | None:
    """"2025-04-04 21:39" (UTC), "2025-04-04T21:39:00Z" or "202504082107" -> epoch ms; None."""
    s = (text or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%MZ", "%Y%m%d%H%M"):
        try:
            return int(datetime.strptime(s, fmt).replace(tzinfo=timezone.utc).timestamp() * 1000)
        except ValueError:
            continue
    return None


def _pid_ms(pid: str | None) -> int | None:
    """The issue time of an IEM product id ("202504021902-KIND-WGUS43-FLWIND")."""
    m = re.match(r"^(\d{12})-", pid or "")
    return _ms(m.group(1)) if m else None


def month_windows(year: int, now: int) -> list[tuple[int, int, float | None]]:
    """``(start_ms, end_ms, ttl_s)`` of each month of ``year`` up to now (the current month ends at the next full hour)."""
    out = []
    closed_year = year < time.gmtime(now / 1000).tm_year
    for m in range(1, 13):
        start = int(datetime(year, m, 1, tzinfo=timezone.utc).timestamp() * 1000)
        if start >= now:
            break
        nxt = datetime(year + (m == 12), 1 if m == 12 else m + 1, 1, tzinfo=timezone.utc)
        end = int(nxt.timestamp() * 1000)
        if end > now:
            end = (now // HOUR_MS + 1) * HOUR_MS
            ttl: float | None = MONTH_TTL_OPEN_S
        else:
            ttl = MONTH_TTL_CLOSED_S if closed_year else MONTH_TTL_PAST_S
        out.append((start, end, ttl))
    return out


def watchwarn_params(start_ms: int, end_ms: int) -> dict[str, str]:
    """FL.W and FF.W storm-based warnings issued in the window, with every follow-up statement's polygon (CSV)."""
    return {"accept": "csv", "sts": _iso(start_ms), "ets": _iso(end_ms), "limit1": "1", "limitps": "1",
            "phenomena": "FL,FF", "significance": "W,W", "addsvs": "1"}


def sbw_params(start_ms: int, end_ms: int) -> list[tuple[str, str]]:
    return [("begints", _iso(start_ms)), ("endts", _iso(end_ms)), ("ph", "FL"), ("ph", "FF")]


def _iem_get(url: str, params: Any, ttl_s: float | None, *, wait: bool = True) -> fhttp.Response:
    """A cached IEM GET on ``nws.IEM_LIMITER``; waits for a slot when Fire-3d's own limit is reached (``wait``)."""
    name = "The Iowa Environmental Mesonet archive of NWS warnings"
    for _ in range(BUSY_TRIES if wait else 1):
        hit = fhttp.peek_cache("GET", url, params, ttl_s)
        if hit is not None:
            return hit
        if nws.IEM_LIMITER.try_acquire():
            break
        if not wait:
            raise SourceBusy(f"{name}: Fire-3d's request limit is reached; try again in a minute")
        time.sleep(BUSY_WAIT_S)
    else:
        raise SourceBusy(f"{name}: Fire-3d's request limit is reached; try again in a minute")
    try:
        return fhttp.request("GET", url, params=params, ttl_s=ttl_s, timeout=IEM_TIMEOUT_S, retries=1)
    except fhttp.HttpError as e:
        raise SourceError(f"{name} could not be reached (HTTP {e.status})" if e.status else
                          f"{name} could not be reached (no response)", e.status) from None
    except Exception as e:  # noqa: BLE001 - any transport failure: unreachable
        log.warning("%s: %s", name, config.mask_secrets(f"{type(e).__name__}: {e}"))
        raise SourceError(f"{name} could not be reached (no response)") from None


def fetch_month(start_ms: int, end_ms: int, ttl_s: float | None, *,
                sbw_start_ms: int | None = None) -> tuple[list[dict], list[dict], int]:
    """(CSV rows, GeoJSON features, fetched_ms) of one month (the polygons from ``sbw_start_ms`` when given). Raises
    SourceError / SourceBusy."""
    p1 = watchwarn_params(start_ms, end_ms)
    r1 = _iem_get(WATCHWARN_URL, p1, ttl_s)
    text = r1.content.decode("utf-8", "replace")
    if not text.lstrip().lower().startswith("wfo,"):
        fhttp.evict_cache("GET", WATCHWARN_URL, p1)
        raise SourceError("The Iowa Environmental Mesonet sent an unexpected reply")
    rows = list(csv.DictReader(io.StringIO(text)))
    p2 = sbw_params(sbw_start_ms if sbw_start_ms is not None else start_ms, end_ms)
    r2 = _iem_get(SBW_URL, p2, ttl_s)
    try:
        doc = r2.json()
    except ValueError:
        fhttp.evict_cache("GET", SBW_URL, p2)
        raise SourceError("The Iowa Environmental Mesonet sent a reply Fire-3d could not read") from None
    feats = doc.get("features") if isinstance(doc, dict) else None
    if not isinstance(feats, list):
        fhttp.evict_cache("GET", SBW_URL, p2)
        raise SourceError("The Iowa Environmental Mesonet sent an unexpected reply")
    return rows, feats, int(min(r1.fetched_ms, r2.fetched_ms))


def gauge_rows(lids: Iterable[str]) -> dict[str, dict]:
    """``riv_gauges`` rows (name, waterbody, state, position) of NWS gauges by id, :data:`GAUGE_BATCH` a request
    (cached 30 days); gauges the map does not know are left out. Raises nothing: a failed batch is left out."""
    want = sorted({x.upper() for x in lids if re.fullmatch(r"[A-Z0-9]{5}", (x or "").upper())})
    out: dict[str, dict] = {}
    for i in range(0, len(want), GAUGE_BATCH):
        batch = want[i:i + GAUGE_BATCH]
        url, params = nwps.riv_gauges_query(0, "gaugelid in (" + ",".join(f"'{x}'" for x in batch) + ")")
        params["outFields"] = "gaugelid,location,waterbody,state,latitude,longitude,wfo,url"
        try:
            feats, _ = nwps._features(url, params, ttl_s=GAUGE_TTL_S, limiter=nwps.NOAA_MAPS_LIMITER,
                                      name="The NWS river gauge map", timeout=nwps.MAPS_TIMEOUT_S,
                                      retries=nwps.MAPS_RETRIES)
        except SourceError as e:                      # SourceBusy included: names fall back to places
            log.info("past floods: gauge names: %s", e)
            continue
        for f in feats:
            r = nwps.parse_riv_row(f)
            if r:
                out[r["lid"]] = r
    return out


# ----------------------------------------------------------------------------------------------------------------
# Events (one VTEC event = all rows of one office / phenomena / significance / ETN / year)
# ----------------------------------------------------------------------------------------------------------------
@dataclass
class Event:
    wfo: str
    ph: str
    sig: str
    etn: int
    year: int
    issue_ms: int
    expire_ms: int
    last_ms: int                                   # newest product (issuance or follow-up)
    severity: int = 0                              # max H-VTEC severity (FL)
    nwsli: str | None = None
    damage: str | None = None                      # max damage tag, verbatim
    emergency: bool = False
    product_id: str | None = None                  # issuance product
    geom: Any = None                               # issuance polygon
    locations: str | None = None                   # counties (IEM)
    ugcs: list[str] = field(default_factory=list)

    @property
    def key(self) -> tuple[str, str, str, int, int]:
        return (self.wfo, self.ph, self.sig, self.etn, self.year)

    @property
    def vtec_key(self) -> str:
        return f"K{self.wfo}.{self.ph}.{self.sig}.{self.etn:04d}.{self.year}"

    @property
    def damage_rank(self) -> int:
        return DAMAGE.get((self.damage or "").upper(), 0)


def events_from(rows: Iterable[dict], features: Iterable[dict]) -> dict[tuple, Event]:
    """CSV rows (every polygon: issuance and follow-ups) + issuance polygons -> events by key, with the highest H-VTEC
    severity, the highest damage tag and the emergency flag of any of their products."""
    out: dict[tuple, Event] = {}
    for r in rows:
        ph, sig, wfo = (r.get("phenomena") or "").upper(), (r.get("significance") or "").upper(), (r.get("wfo") or "").upper()
        if ph not in EVENT or sig != "W" or not re.fullmatch(r"[A-Z]{3}", wfo):
            continue
        try:
            etn, year = int(r.get("eventid") or ""), int(r.get("vtec_year") or "")
        except ValueError:
            continue
        issue, expire = _ms(r.get("utc_issue")), _ms(r.get("utc_expire"))
        prod = _ms(r.get("utc_prodissue")) or _ms(r.get("utc_polygon_begin")) or issue
        if issue is None or expire is None:
            continue
        if (r.get("status") or "").upper() == "NEW":       # the warning was issued before its VTEC begin (rule 7)
            issue = min(issue, prod or issue, _pid_ms(r.get("product_id")) or issue)
        k = (wfo, ph, sig, etn, year)
        ev = out.get(k)
        if ev is None:
            ev = out[k] = Event(wfo, ph, sig, etn, year, issue, expire, prod or issue)
        ev.issue_ms = min(ev.issue_ms, issue)
        ev.expire_ms = max(ev.expire_ms, expire)
        ev.last_ms = max(ev.last_ms, prod or issue)
        ev.severity = max(ev.severity, SEVERITY.get((r.get("hvtec_severity") or "").strip(), 0))
        nwsli = (r.get("hvtec_nwsli") or "").strip().upper()
        if re.fullmatch(r"[A-Z0-9]{5}", nwsli) and nwsli != "00000":
            ev.nwsli = ev.nwsli or nwsli
        tag = (r.get("damagetag") or "").strip().upper()
        if DAMAGE.get(tag, 0) > ev.damage_rank:
            ev.damage = tag
        ev.emergency = ev.emergency or (r.get("is_emergency") or "").strip().lower() in ("true", "t", "1", "yes")
        if (r.get("status") or "").upper() == "NEW" and r.get("product_id"):
            ev.product_id = r["product_id"]
    for f in features:
        p = (f or {}).get("properties") or {}
        try:
            k = (str(p.get("wfo") or "").upper(), str(p.get("phenomena") or "").upper(),
                 str(p.get("significance") or "").upper(), int(p.get("eventid")), int(p.get("year")))
        except (TypeError, ValueError):
            continue
        ev = out.get(k)
        if ev is None or ev.geom is not None:
            continue
        ev.geom = nws.polygonal((f or {}).get("geometry"))
        ev.locations = p.get("locations") or None
        ev.ugcs = [u.strip() for u in str(p.get("ugclist") or "").split(",") if u.strip()]
        ev.product_id = ev.product_id or p.get("product_id")
    return out


def meets_rule(ev: Event) -> bool:
    """PAST_RULE: a river Flood Warning at a gauge that reached moderate or major (H-VTEC severity 2 or 3), or a Flash
    Flood Warning with a considerable or catastrophic damage threat, or an emergency."""
    if ev.ph == "FL":
        return ev.nwsli is not None and ev.severity >= 2
    return ev.damage_rank >= 2 or ev.emergency


def _in_l48(ev: Event) -> bool:
    l48 = set(regions.L48)
    if ev.ugcs and any(u[:2] in l48 for u in ev.ugcs):
        return True
    if ev.geom is not None:
        c = ev.geom.representative_point()
        return regions.state_at(c.x, c.y) in l48
    return False


# ----------------------------------------------------------------------------------------------------------------
# Grouping into floods
# ----------------------------------------------------------------------------------------------------------------
def group_events(events: list[Event]) -> list[list[Event]]:
    """River: per gauge episode (warnings at one gauge less than :data:`EPISODE_GAP_H` apart; a gauge flooding again
    later is another flood). Flash: warnings whose issuance polygons overlap (30 % of the smaller) and were issued
    within :data:`FLASH_JOIN_H`."""
    groups: list[list[Event]] = []
    by_gauge: dict[str, list[Event]] = defaultdict(list)
    flash: list[Event] = []
    for ev in events:
        if ev.ph == "FL" and ev.nwsli:
            by_gauge[ev.nwsli].append(ev)
        else:
            flash.append(ev)
    gap = EPISODE_GAP_H * HOUR_MS
    for _lid, evs in sorted(by_gauge.items()):
        evs.sort(key=lambda e: e.issue_ms)
        cur = [evs[0]]
        end = evs[0].expire_ms
        for ev in evs[1:]:
            if ev.issue_ms - end <= gap:
                cur.append(ev)
                end = max(end, ev.expire_ms)
            else:
                groups.append(cur)
                cur, end = [ev], ev.expire_ms
        groups.append(cur)
    flash.sort(key=lambda e: e.issue_ms)
    parent = list(range(len(flash)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, a in enumerate(flash):
        for j in range(i + 1, len(flash)):
            b = flash[j]
            if b.issue_ms - a.issue_ms > FLASH_JOIN_H * HOUR_MS:
                break
            if G.overlap_share(a.geom, b.geom) >= G.AREAL_OVERLAP:
                parent[find(j)] = find(i)
    fl: dict[int, list[Event]] = defaultdict(list)
    for i, ev in enumerate(flash):
        fl[find(i)].append(ev)
    groups += list(fl.values())
    return groups


def _gauge_ref(lid: str, row: dict | None, ev_geom: Any, severity: int) -> dict:
    if row is not None:
        lat, lon, name, wb, st = row["lat"], row["lon"], row.get("name") or lid, row.get("waterbody"), row.get("state")
    else:
        c = ev_geom.representative_point() if ev_geom is not None else Point(0, 0)
        lat, lon, name, wb, st = c.y, c.x, lid, None, regions.state_at(c.x, c.y)
    return {"lid": lid, "name": f"{name} ({wb})" if (row is not None and wb) else name, "waterbody": wb, "state": st,
            "lat": float(lat), "lon": float(lon), "observed_category": "unknown", "observed_value": None,
            "unit": None, "observed_ms": None, "forecast_category": None, "forecast_max_value": None,
            "forecast_max_ms": None, "forecast_issued_ms": None, "url": nwps.gauge_page(lid)}


def _product_ref(ev: Event, flood_gauge: str | None) -> dict:
    return {"id": ev.product_id or ev.vtec_key, "event": EVENT[ev.ph], "vtec_key": ev.vtec_key, "sender_name": None,
            "phase": "ended", "sent_ms": ev.issue_ms, "onset_ms": ev.issue_ms, "ends_ms": ev.expire_ms,
            "emergency": ev.emergency, "damage_threat": ev.damage, "gauge_lids": [flood_gauge] if flood_gauge else [],
            "url": IEM_EVENT_PAGE.format(year=ev.year, ph=ev.ph, sig=ev.sig, etn=ev.etn, wfo=ev.wfo), "archived": True}


def summarize(group: list[Event], gauges: dict[str, dict]) -> dict:
    """A historical ``FloodSummary`` (no id yet: ``_keys``, ``_anchor`` and ``_base_name`` for :func:`assign`)."""
    group = sorted(group, key=lambda e: e.issue_ms)
    river = group[0].ph == "FL"
    lid = group[0].nwsli if river else None
    geoms = [e.geom for e in group if e.geom is not None]
    union = shapely.union_all(geoms) if geoms else None
    row = gauges.get(lid) if lid else None
    sev = max(e.severity for e in group)
    if river and lid:
        ref = _gauge_ref(lid, row, union, sev)
        lon, lat = ref["lon"], ref["lat"]
    else:
        ref = None
        big = max(geoms, key=lambda g: g.area) if geoms else None
        pt = big.representative_point() if big is not None else Point(0, 0)
        lon, lat = pt.x, pt.y
    pts = [Point(lon, lat)] + ([union] if union is not None else [])
    w, s, e, n = shapely.union_all(pts).bounds
    state = regions.state_at(lon, lat) or (ref or {}).get("state")
    l48 = set(regions.L48)
    states = sorted(({u[:2] for ev in group for u in ev.ugcs} & l48) | ({state} if state in l48 else set()))
    county = regions.county_at(lon, lat)
    tz = regions.time_zone_at(lon, lat) or (regions.main_zone(state) if state else None) or "UTC"
    rivers = [row["waterbody"]] if (row and row.get("waterbody")) else []
    base = naming.flood_name(kind="river" if river else "flash", level="warning", rivers=rivers, texts=[],
                             area_desc=None, geom=union, county=county.name if county else None)
    emergency = any(ev.emergency for ev in group)
    last = max(ev.last_ms for ev in group)
    ended = max(ev.expire_ms for ev in group)
    started = group[0].issue_ms
    s_ = {
        "id": "", "hazard": "flood", "name": base, "kind": "river" if river else "flash", "level": "warning",
        "emergency": emergency, "status": "inactive", "mode": "historical",
        "year": time.gmtime(started / 1000).tm_year, "started_ms": int(started), "started_basis": "nws_product",
        "updated_ms": int(last), "expires_ms": None, "last_product_ms": int(last), "ended_ms": int(ended),
        "lat": round(float(lat), 5), "lon": round(float(lon), 5),
        "bbox_lonlat": [round(w, 5), round(s, 5), round(e, 5), round(n, 5)],
        "state": state, "states": states or ([state] if state else []), "county": county.name if county else None,
        "time_zone": tz, "rivers": rivers, "primary_gauge": ref, "gauges": [ref] if ref else [], "gauges_in_flood": 0,
        "max_category": SEVERITY_CATEGORY.get(sev) if river else None,
        "products": [_product_ref(ev, lid) for ev in sorted(group, key=lambda e: (-e.last_ms, e.vtec_key))],
        "offices": sorted({f"K{ev.wfo}" for ev in group}), "bundle_status": "none", "bundle_built_ms": None,
        "aliases": [], "synthetic": False, "caveat": None,
        "_keys": [ev.vtec_key for ev in group], "_anchor": lid or min(ev.vtec_key for ev in group), "_base_name": base,
    }
    return s_


def assign(rows: list[dict], reg: reg_mod.Registry) -> list[dict]:
    """Ids (rule 10): a registered VTEC key gives its live id (rows of one live id merged; the live name kept when
    Fire-3d has a last-known summary for it); else ``make_flood_id(start, base name, anchor)``. Then names deduped."""
    by_id: dict[str, dict] = {}
    for r in rows:
        hits = sorted({hit for k in r["_keys"] for hit in [reg.id_for(k)] if hit}, key=lambda h: (h[1], h[0]))
        if hits:
            fid = hits[0][0]
            lk = reg_mod.read_last_known(fid)
            if lk is not None and lk[0].get("name"):
                r["name"] = r["_base_name"] = lk[0]["name"]
                r["_live_name"] = True
        else:
            fid = naming.make_flood_id(r["started_ms"], r["_base_name"], r["_anchor"])
        r["id"] = fid
        if fid in by_id:
            by_id[fid] = _merge(by_id[fid], r)
        else:
            by_id[fid] = r
    out = list(by_id.values())
    plain = [r for r in out if not r.get("_live_name")]
    naming.dedupe_names(plain)
    for r in out:
        r["aliases"] = reg.aliases_of(r["id"])
    return out


def _merge(a: dict, b: dict) -> dict:
    """Two year rows with one live id: one row (products and gauges of both, the wider box and times)."""
    lo = min(a["started_ms"], b["started_ms"])
    first = a if a["started_ms"] <= b["started_ms"] else b
    gauges = {g["lid"]: g for g in (a["gauges"] + b["gauges"])}
    cats = [c for c in (a.get("max_category"), b.get("max_category")) if c]
    bb = [min(a["bbox_lonlat"][0], b["bbox_lonlat"][0]), min(a["bbox_lonlat"][1], b["bbox_lonlat"][1]),
          max(a["bbox_lonlat"][2], b["bbox_lonlat"][2]), max(a["bbox_lonlat"][3], b["bbox_lonlat"][3])]
    prods = {p["vtec_key"]: p for p in a["products"] + b["products"]}
    return {**first, "started_ms": lo, "year": time.gmtime(lo / 1000).tm_year, "bbox_lonlat": bb,
            "updated_ms": max(a["updated_ms"], b["updated_ms"]), "last_product_ms": max(a["last_product_ms"], b["last_product_ms"]),
            "ended_ms": max(a["ended_ms"], b["ended_ms"]), "emergency": a["emergency"] or b["emergency"],
            "states": sorted(set(a["states"]) | set(b["states"])), "offices": sorted(set(a["offices"]) | set(b["offices"])),
            "gauges": list(gauges.values()), "rivers": sorted(set(a["rivers"]) | set(b["rivers"])),
            "max_category": max(cats, key=G.CATEGORY_ORDER.index) if cats else None,
            "products": sorted(prods.values(), key=lambda p: -(p["sent_ms"] or 0)),
            "_keys": a["_keys"] + b["_keys"]}


def build_rows(events: dict[tuple, Event], year: int, *, reg: reg_mod.Registry | None = None,
               gauges: dict[str, dict] | None = None) -> list[dict]:
    """The year's floods (rule, lower 48, grouping, summaries, ids), in ``floodRank`` order, internal keys dropped."""
    picked = [ev for ev in events.values() if ev.year == year and meets_rule(ev) and ev.geom is not None and _in_l48(ev)]
    if gauges is None:
        gauges = gauge_rows(ev.nwsli for ev in picked if ev.nwsli)
    rows = [summarize(g, gauges) for g in group_events(picked)]
    rows = [r for r in rows if r["year"] == year]
    rows = assign(rows, reg or reg_mod.get_registry())
    return G.sort_floods([{k: v for k, v in r.items() if not k.startswith("_")} for r in rows])


# ----------------------------------------------------------------------------------------------------------------
# Year lists: background build, disk copy, answer
# ----------------------------------------------------------------------------------------------------------------
@dataclass
class _Year:
    answer: dict | None = None
    built_at: float = 0.0                         # time.time() of the build
    partial: bool = False
    failed_at: float = 0.0
    thread: threading.Thread | None = None


_lock = threading.Lock()
_years: dict[int, _Year] = {}


def reset_state() -> None:
    with _lock:
        _years.clear()


def _disk_path(year: int):
    return store.floods_dir() / "years" / f"{year}.json"


def _source(status: str, retrieved: int | None, reason: str | None, stale: bool = False) -> dict:
    return {"id": "iem_archive", "name": SOURCE_NAME, "status": status, "retrieved_ms": retrieved, "reason": reason,
            "stale": stale}


def _answer(year: int, floods: list[dict], sources: list[dict], *, now: int, preparing: bool) -> dict:
    return {"hazard": "flood", "mode": "historical", "updated_ms": now, "year": year,
            "past_rule": PAST_RULE, "preparing": preparing, "floods": floods, "sources": sources,
            "products_in_effect": None}


def build_year(year: int, *, now: int | None = None) -> tuple[dict, bool]:
    """Build one year list now (blocking: about 30 requests). Returns (answer, partial)."""
    now = int(now if now is not None else now_ms())
    all_rows: list[dict] = []
    all_feats: list[dict] = []
    failed: list[str] = []
    fetched: list[int] = []
    windows = month_windows(year, now)
    for i, (start, end, ttl) in enumerate(windows):
        try:
            # IEM's two services cut windows differently (the CSV by the event's VTEC begin, the polygons by the
            # issuance product's time): the first month's polygons start 14 days earlier, and every month's rows
            # and polygons are joined only after all months are read
            rows, feats, f_ms = fetch_month(start, end, ttl, sbw_start_ms=start - 14 * DAY_MS if i == 0 else None)
        except SourceError as e:                  # SourceBusy included (after waiting)
            log.warning("past floods %s: month %s: %s", year, time.strftime("%Y-%m", time.gmtime(start / 1000)), e)
            failed.append(time.strftime("%b %Y", time.gmtime(start / 1000)))
            if not fetched and len(failed) >= 2:  # IEM is down: stop here, retried later (FAILED_RETRY_S)
                break
            continue
        fetched.append(f_ms)
        all_rows += rows
        all_feats += feats
    events = events_from(all_rows, all_feats)
    if not fetched:
        return _answer(year, [], [_source("unavailable", None, ARCHIVE_DOWN)], now=now, preparing=False), True
    floods = build_rows(events, year)
    reason = ARCHIVE_PARTIAL.format(months=", ".join(failed)) if failed else None
    src = _source("available", min(fetched), reason, stale=bool(failed))
    return _answer(year, floods, [src], now=now, preparing=False), bool(failed)


def _merge_event(a: Event, b: Event) -> Event:
    """One event seen in two months' answers (a follow-up statement in the next month)."""
    if b.damage_rank > a.damage_rank:
        a.damage = b.damage
    a.issue_ms, a.expire_ms, a.last_ms = min(a.issue_ms, b.issue_ms), max(a.expire_ms, b.expire_ms), max(a.last_ms, b.last_ms)
    a.severity, a.emergency = max(a.severity, b.severity), a.emergency or b.emergency
    a.nwsli = a.nwsli or b.nwsli
    if a.geom is None:
        a.geom, a.locations, a.ugcs = b.geom, b.locations, b.ugcs
    a.product_id = a.product_id or b.product_id
    return a


def _load_disk(year: int) -> tuple[dict, float] | None:
    p = _disk_path(year)
    try:
        doc = orjson.loads(p.read_bytes())
    except (OSError, orjson.JSONDecodeError):
        return None
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA or not isinstance(doc.get("answer"), dict):
        return None
    return doc["answer"], float(doc.get("built_at") or 0.0)


def _fresh(year: int, built_at: float, now_s: float) -> bool:
    if year < time.gmtime(now_s).tm_year:
        return True                                # a closed year: for good
    return now_s - built_at < YEAR_REFRESH_H * 3600


def _run_build(year: int) -> None:
    try:
        ans, partial = build_year(year)
    except Exception as e:  # noqa: BLE001 - never kill the server; retried later
        log.warning("past floods %s: build failed: %s", year, config.mask_secrets(f"{type(e).__name__}: {e}"))
        ans, partial = _answer(year, [], [_source("unavailable", None, ARCHIVE_DOWN)], now=now_ms(), preparing=False), True
    t = time.time()
    with _lock:
        y = _years.setdefault(year, _Year())
        if partial and y.answer is not None and not y.partial and ans["sources"][0]["status"] == "unavailable":
            y.failed_at = t                        # keep the earlier complete list over an outage
        else:
            y.answer, y.built_at, y.partial = ans, t, partial
            y.failed_at = t if partial else 0.0
        y.thread = None
    if not partial:
        try:
            bundle.write_json(_disk_path(year), {"schema": SCHEMA, "built_at": t, "answer": ans})
        except OSError as e:
            log.warning("past floods %s: not saved: %s", year, e)
    log.info("past floods %s: %d floods%s", year, len(ans["floods"]), " (partial)" if partial else "")


def _start(year: int, y: _Year) -> None:
    if y.thread is not None and y.thread.is_alive():
        return
    y.thread = threading.Thread(target=_run_build, args=(year,), name=f"fire3d-past-floods-{year}", daemon=True)
    y.thread.start()


def year_list(year: int, *, wait: bool = False) -> dict:
    """``FloodListResponse`` of a past year: the built list (from memory or the disk copy), else ``preparing: true``
    while the one-time build runs in the background (``wait``: build now, blocking; the CLI). Years outside
    :data:`PAST_YEARS` answer an empty list whose source says which years are kept."""
    now = now_ms()
    if year not in PAST_YEARS:
        years = " and ".join(str(y) for y in sorted(PAST_YEARS))
        return _answer(year, [], [_source("unavailable", None, YEAR_NOT_KEPT.format(years=years))], now=now,
                       preparing=False)
    t = time.time()
    with _lock:
        y = _years.setdefault(year, _Year())
        if y.answer is None and y.thread is None:
            disk = _load_disk(year)
            if disk is not None:
                y.answer, y.built_at = disk
        stale = y.answer is None or y.partial or not _fresh(year, y.built_at, t)
        may_retry = not y.failed_at or t - y.failed_at > FAILED_RETRY_S
        if stale and may_retry and not wait:
            _start(year, y)
        answer = y.answer
    if wait and (answer is None or stale):
        _run_build(year)
        with _lock:
            answer = _years[year].answer
    if answer is None:
        return _answer(year, [], [_source("available", None, None)], now=now, preparing=True)
    return answer


def cached_rows(year: int) -> list[dict]:
    """The year's rows from memory or disk, never a build or a request (the detail chain's year step)."""
    with _lock:
        y = _years.get(year)
        if y is not None and y.answer is not None:
            return list(y.answer["floods"])
    disk = _load_disk(year)
    if disk is None:
        return []
    with _lock:                                    # keep the disk copy in memory (the next lookup reads no file)
        y = _years.setdefault(year, _Year())
        if y.answer is None:
            y.answer, y.built_at = disk
    return list(disk[0]["floods"])


def find(flood_id: str) -> dict | None:
    """The year-list summary of ``flood_id`` (rule 13's year step; cached lists only), or None."""
    m = re.match(r"^flood-(\d{4})\d{4}-", flood_id or "")
    years = [int(m.group(1))] if m and int(m.group(1)) in PAST_YEARS else list(PAST_YEARS)
    for y in years + [y for y in PAST_YEARS if y not in years]:
        for s in cached_rows(y):
            if s["id"] == flood_id:
                return s
    return None


# ----------------------------------------------------------------------------------------------------------------
# Past NWS products of one flood (IEM per-event archive)
# ----------------------------------------------------------------------------------------------------------------
_KEY_RE = re.compile(r"^K([A-Z]{3})\.(FL|FA|FF)\.([WYA])\.(\d{1,4})\.(\d{4})$")
_SENDER_RE = re.compile(r"^National Weather Service (.+?)\s*$", re.MULTILINE)
_LATLON_RE = re.compile(r"LAT\.\.\.LON((?:\s+\d{4,5}\s+\d{4,5})+)")
_DAMAGE_RE = re.compile(r"FLASH FLOOD DAMAGE THREAT\.{3}([A-Z]+)")
_DETECT_RE = re.compile(r"FLASH FLOOD\.{3}(RADAR INDICATED|OBSERVED|RADAR AND GAUGE INDICATED)")


def latlon_polygon(text: str) -> Any:
    """The ``LAT...LON`` polygon of a segment (hundredths of degrees, longitude west), or None."""
    m = _LATLON_RE.search(text or "")
    if not m:
        return None
    nums = [int(v) for v in m.group(1).split()]
    pts = [(-nums[i + 1] / 100.0, nums[i] / 100.0) for i in range(0, len(nums) - 1, 2)]
    if len(pts) < 3:
        return None
    try:
        poly = Polygon(pts)
        return poly if poly.is_valid and poly.area > 0 else shapely.make_valid(poly)
    except (ValueError, TypeError):
        return None


def _segment_for(segments: list[dict], wfo: str, ph: str, sig: str, etn: int) -> dict | None:
    for seg in segments:
        for v in seg.get("vtec") or []:
            if (str(v.get("office") or "")[-3:].upper(), v.get("phenomena"), v.get("significance"),
                    int(v.get("etn") or -1)) == (wfo, ph, sig, etn):
                return {**seg, "_vtec": v}
    return None


def _past_alert(prod: dict, seg: dict, *, ev: nws.ArchiveEvent, flood_id: str, now: int, names: dict[str, str],
                over: bool = True) -> dict:
    """One archived product version of ``ev`` (its own segment verbatim). ``over``: the flood is a past one (every
    version ``ended``); else a version is ``ended`` once its own NWS end time passed."""
    text = prod.get("text") or ""
    v = seg["_vtec"]
    raw = _seg_text(text, ev) or text                # the event's own segment (its polygon and tags)
    geom = latlon_polygon(raw)
    m = _SENDER_RE.search(text)
    sender = ("NWS " + m.group(1).strip()) if m else None
    vt = {"office": f"K{ev.wfo}", "phenomena": ev.phenomena, "significance": ev.significance, "etn": ev.etn,
          "action": str(v.get("action") or ""), "year": ev.year}
    hv = nws.parse_hvtec_for(text, {"vtec": vt})
    end = v.get("end_ms")
    dmg = _DAMAGE_RE.search(raw)
    det = _DETECT_RE.search(raw)
    ugcs = list(seg.get("ugcs") or [])
    return {
        "id": f"{prod.get('product_id') or prod.get('valid_ms')}#{nws.vtec_key(vt)}",
        "url": IEM_PRODUCT_PAGE.format(pid=prod["product_id"]) if prod.get("product_id") else ev.url,
        "office_url": None, "event": ev.event, "vtec": vt, "hvtec": hv, "sender_name": sender,
        "sent_ms": prod.get("valid_ms"), "effective_ms": prod.get("valid_ms"),
        "onset_ms": v.get("begin_ms") or prod.get("valid_ms"), "expires_ms": end, "ends_ms": end,
        "headline": seg.get("headline"), "nws_headline": None, "description": seg.get("description"),
        "instruction": seg.get("instruction"),
        "area_desc": "; ".join(names[u] for u in ugcs if u in names) or None, "ugcs": ugcs,
        "message_type": None, "status": "Actual",
        "phase": "ended" if (over or (end is not None and end <= now)) else "in_effect", "archived": True,
        "time_zone": nws.alert_time_zone(geom, ugcs), "emergency": "FLASH FLOOD EMERGENCY" in raw.upper(),
        "damage_threat": dmg.group(1) if dmg else None, "detection": det.group(1) if det else None,
        "geometry": mapping(geom) if geom is not None else None, "covers_point": None, "flood_ids": [flood_id],
    }


def _seg_text(text: str, ev: nws.ArchiveEvent) -> str | None:
    """The raw text of the product segment holding ``ev``'s VTEC string (for its own ``LAT...LON``)."""
    tag = f".K{ev.wfo}.{ev.phenomena}.{ev.significance}.{ev.etn:04d}."
    for part in re.split(r"\n\$\$\s*\n", (text or "").replace("\r\n", "\n")):
        if tag in part:
            return part
    return None


def past_flood_alerts(summary: dict, *, now: int, at_ms: int | None) -> dict:
    """``FloodAlertsResponse`` of a flood at a past time from IEM's archive (every product version sent up to
    ``at_ms``; archived copies; source IEM)."""
    fid = summary["id"]
    keys = []
    for p in summary.get("products") or []:
        m = _KEY_RE.match(p.get("vtec_key") or "")
        if m and (m.group(1), m.group(2), m.group(3), int(m.group(4)), int(m.group(5))) not in keys:
            keys.append((m.group(1), m.group(2), m.group(3), int(m.group(4)), int(m.group(5))))
    env = {"kind": "flood_alerts", "status": "available", "reason_code": None, "reason": None,
           "source": dict(fcopy.SOURCE_IEM), "retrieved_ms": None, "source_updated_ms": None,
           "requested_at_ms": at_ms, "now_ms": now, "flood_id": fid, "synthetic": False, "caveats": []}
    base = {"zones": {"type": "FeatureCollection", "features": []}, "area_bbox": list(summary["bbox_lonlat"]),
            "states_checked": list(summary.get("states") or [])}
    if at_ms is not None and at_ms < int(summary.get("started_ms") or at_ms) - PAST_TOLERANCE_MS:
        return {**env, "status": "not_available_for_past_dates", "reason": PAST_BEFORE_FLOOD, "reason_code": "past_date",
                "alerts": [], **base}
    over = summary.get("mode") == "historical" or summary.get("status") == "inactive"
    alerts: list[dict] = []
    failed = 0
    for wfo, ph, sig, etn, year in keys[:MAX_PAST_EVENTS]:
        ev = nws.ArchiveEvent(wfo, year, ph, sig, etn, IEM_EVENT_PAGE.format(year=year, ph=ph, sig=sig, etn=etn, wfo=wfo))
        try:
            detail = nws.event_detail(ev, now=now)
        except SourceError as e:                   # SourceBusy included
            log.info("past products %s: %s", ev.key, e)
            failed += 1
            continue
        names = {r["ugc"]: r["name"] for r in detail.zone_rows if r.get("name")}
        for prod in detail.products:
            if at_ms is not None and (prod.get("valid_ms") or 0) > at_ms + PAST_TOLERANCE_MS:
                continue
            seg = _segment_for(detail.segments(prod), wfo, ph, sig, etn)
            if seg is not None:
                alerts.append(_past_alert(prod, seg, ev=ev, flood_id=fid, now=now, names=names, over=over))
    if keys and failed == len(keys[:MAX_PAST_EVENTS]):
        return {**env, "status": "unavailable", "reason": PAST_ALERTS_DOWN, "reason_code": "upstream_error",
                "alerts": [], **base}
    alerts.sort(key=lambda a: (0 if a["emergency"] else 1, -(a["sent_ms"] or 0), a["id"]))
    sent = [a["sent_ms"] for a in alerts if a["sent_ms"]]
    caveats = [PAST_ALERTS_DOWN] if failed else []
    return {**env, "retrieved_ms": now, "source_updated_ms": max(sent) if sent else None, "caveats": caveats,
            "alerts": alerts, **base}


def past_area_alerts(bbox: tuple[float, float, float, float], *, now: int, at_ms: int | None) -> dict:
    """An area or point at a past time: products are served per flood (``not_available_for_past_dates``)."""
    return {"kind": "flood_alerts", "status": "not_available_for_past_dates", "reason_code": "past_date",
            "reason": PAST_AREA_ALERTS, "source": dict(fcopy.SOURCE_IEM), "retrieved_ms": None,
            "source_updated_ms": None, "requested_at_ms": at_ms, "now_ms": now, "flood_id": None, "synthetic": False,
            "caveats": [], "alerts": [], "zones": {"type": "FeatureCollection", "features": []},
            "area_bbox": list(bbox), "states_checked": []}


# ----------------------------------------------------------------------------------------------------------------
# Past gauge readings (USGS measured; NWS thresholds of today)
# ----------------------------------------------------------------------------------------------------------------
PAST_WINDOW_BEFORE_MS = 3 * DAY_MS
PAST_WINDOW_AFTER_MS = 2 * DAY_MS
PAST_WINDOW_MAX_MS = 40 * DAY_MS


def _reading_at(rows: list, at_ms: int) -> list | None:
    best = None
    for r in rows:
        if r[0] <= at_ms and (r[1] is not None or r[2] is not None):
            best = r
    return best


def past_gauge(lid: str, *, member: bool, start_ms: int, end_ms: int, at_ms: int, now: int) -> tuple[dict, list[str]]:
    """One ``RiverGauge`` at a past time: NWPS detail (thresholds, impacts of today) + USGS's measured series over
    [start, end]. Returns (gauge, extra caveats). Raises SourceError when NWPS does not answer for the gauge."""
    from . import gauges as gauges_mod

    detail, _ = nwps.gauge(lid)
    lon, lat = nwps.num(detail.get("longitude")), nwps.num(detail.get("latitude"))
    state = regions.state_at(lon, lat) if lon is not None and lat is not None else None
    tz = gauges_mod._tz(lon, lat, state) if lon is not None and lat is not None else "UTC"
    g = nwps.river_gauge(detail, None, member=member, time_zone=tz, with_series=False, state=state)
    caveats: list[str] = []
    rows: list = []
    su = fu = None
    site = usgs_water.site_id(g.get("usgs_id"))
    if site is None:
        caveats.append(NO_USGS_SITE)
    else:
        try:
            ser = usgs_water.observed_series(site, start_ms, end_ms, now_ms=now)
            rows, su, fu = ser["observed"], ser.get("stage_unit"), ser.get("flow_unit")
        except usgs_water.UsgsBusy:
            caveats.append(fcopy.USGS_429)
        except SourceError as e:
            log.info("past readings %s: %s", lid, e)
            caveats.append(fcopy.GAUGES_UNAVAILABLE)
    r = _reading_at(rows, at_ms)
    g.update({
        "observed": {"value": r[1] if r else None, "unit": su or (g["thresholds"] or {}).get("unit") or "ft",
                     "flow": r[2] if r else None, "flow_unit": fu, "category": "unknown", "valid_ms": r[0] if r else None},
        "forecast": None,
        "series": {"observed": rows, "forecast": [], "forecast_issued_ms": None, "stage_unit": su, "flow_unit": fu},
        "data_attribution": [{"text": fcopy.USGS_OBSERVATIONS, "url": "https://waterdata.usgs.gov/"}] if site else [],
    })
    return g, caveats


def past_gauges(lids: list[str], *, now: int, at_ms: int, start_ms: int | None = None, end_ms: int | None = None,
                flood_id: str | None = None, member: bool = True, area: list | None = None) -> dict:
    """``RiverGaugesResponse`` at a past time for ``lids`` (members first): measured by USGS (provisional), NWS's
    flood stages of today (``THRESHOLDS_TODAY``), no forecast (``PAST_NO_FORECAST``)."""
    start = start_ms if start_ms is not None else at_ms - 10 * DAY_MS
    end = min(end_ms if end_ms is not None else at_ms + 3 * DAY_MS, now)
    start = max(start, end - PAST_WINDOW_MAX_MS)
    caveats = [fcopy.GAUGE_NOT_ALL_CLEAR, fcopy.THRESHOLDS_TODAY, fcopy.PAST_NO_FORECAST]
    out: list[dict] = []
    for lid in lids[:MAX_PAST_GAUGES]:
        try:
            g, extra = past_gauge(lid, member=member, start_ms=start, end_ms=end, at_ms=at_ms, now=now)
        except SourceError as e:                   # SourceBusy included
            log.info("past gauge %s: %s", lid, e)
            continue
        out.append(g)
        caveats += [c for c in extra if c not in caveats]
    env = {"kind": "river_gauges", "reason_code": None, "reason": None, "source": dict(fcopy.SOURCE_USGS),
           "retrieved_ms": now, "requested_at_ms": at_ms, "now_ms": now, "flood_id": flood_id, "synthetic": False}
    if lids and not out:
        return {**env, "status": "unavailable", "reason": fcopy.GAUGES_UNAVAILABLE, "reason_code": "upstream_error",
                "source_updated_ms": None, "caveats": [fcopy.GAUGE_NOT_ALL_CLEAR], "gauges": [], "area_bbox": area}
    obs = [g["observed"]["valid_ms"] for g in out if g["observed"].get("valid_ms")]
    return {**env, "status": "available", "source_updated_ms": max(obs) if obs else None, "caveats": caveats,
            "gauges": out, "area_bbox": area}


def past_flood_gauges(summary: dict, *, now: int, at_ms: int) -> dict:
    s0 = int(summary.get("started_ms") or at_ms)
    e0 = int(summary.get("ended_ms") or summary.get("last_product_ms") or at_ms)
    lids = [g["lid"] for g in summary.get("gauges") or []]
    return past_gauges(lids, now=now, at_ms=at_ms, start_ms=min(s0, at_ms) - PAST_WINDOW_BEFORE_MS,
                       end_ms=max(e0, at_ms) + PAST_WINDOW_AFTER_MS, flood_id=summary["id"],
                       area=list(summary["bbox_lonlat"]))


def past_area_gauges(bbox: Any, *, now: int, at_ms: int | None) -> dict:
    return {"kind": "river_gauges", "status": "not_available_for_past_dates", "reason_code": "past_date",
            "reason": PAST_AREA_GAUGES, "source": dict(fcopy.SOURCE_NWPS), "retrieved_ms": None,
            "source_updated_ms": None, "requested_at_ms": at_ms, "now_ms": now, "flood_id": None, "synthetic": False,
            "caveats": [fcopy.GAUGE_NOT_ALL_CLEAR], "gauges": [], "area_bbox": list(bbox) if bbox else None}


_ = (field,)
