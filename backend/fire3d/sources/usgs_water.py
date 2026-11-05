"""USGS water data (measured river stage and flow) for floods (brief 5; PLAN-5 2, 3.6; CONTRACT 16.15).

``api.waterdata.usgs.gov/ogcapi/v1`` (v1 is USGS's current version since Sep 4, 2026; legacy WaterServices shuts down
on Feb 22, 2027 and is never used), **no key** (PLAN-5 D15: a key would be a third secret). Collection ``continuous``:
gage height ``00065`` (ft) and discharge ``00060`` (ft³/s), every 15 min, ``value`` as a string, ``approval_status``
"Provisional" or "Approved". Used for past observations (older than NWPS's 30 days) and as a second source of a gauge's
readings; NWPS already relays USGS observations for live gauges.

An HTTP 429 from the shared keyless limit raises :class:`UsgsBusy`, whose text is ``USGS_429`` ("USGS data could not be
reached right now (too many requests); try later."), and USGS is not asked again for 10 min (:data:`USGS_DOWN`). Past
windows are cached 30 days, recent ones 10 min. Every value is provisional unless USGS says "Approved"
(``GAUGE_PROVISIONAL`` in the web). Credit: "U.S. Geological Survey (provisional data)".
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .. import config
from .. import http as fhttp
from ..floods import copy as fcopy
from .nws import SourceBusy, SourceError

log = logging.getLogger(__name__)

USGS_OGC = "https://api.waterdata.usgs.gov/ogcapi/v1"
USGS_HOST = "api.waterdata.usgs.gov"
CONTINUOUS = f"{USGS_OGC}/collections/continuous/items"
PARAM_STAGE, PARAM_FLOW = "00065", "00060"
PAGE_LIMIT = 10000
MAX_PAGES = 6
TIMEOUT_S = 30.0
RETRIES = 1
PAST_TTL_S = 30 * 86400.0
RECENT_TTL_S = 600.0
RECENT_MS = 2 * 86_400_000          # a window ending within 2 days of now is "recent"
BUSY_HOLD_S = 600.0
USGS_LIMITER = fhttp.RateLimiter(30, 60.0, "floods: USGS water data")
USGS_DOWN = fhttp.DownMemo("floods: USGS water data", hold_s=60.0)
_busy_until = 0.0
_NAME = "USGS water data"
_SITE_RE = re.compile(r"^(?:USGS-)?(\d{8,15})$")


class UsgsBusy(SourceBusy):
    """USGS answered 429 (the shared keyless limit): ``USGS_429``."""

    def __init__(self) -> None:
        super().__init__(fcopy.USGS_429)


def site_id(v: Any) -> str | None:
    """"06820500" or "USGS-06820500" -> "USGS-06820500"; None for anything else."""
    m = _SITE_RE.match(str(v or "").strip())
    return f"USGS-{m.group(1)}" if m else None


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ms(v: Any) -> int | None:
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp() * 1000)
    except (TypeError, ValueError):
        return None


def _num(v: Any) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x and abs(x) < 1e9 else None


@dataclass
class UsgsSeries:
    site: str
    parameter: str
    unit: str | None
    rows: list[list]                 # [valid_ms, value]
    provisional: bool                # any value not "Approved"
    fetched_ms: int


def continuous(site: str, parameter: str, start_ms: int, end_ms: int, *, now_ms: int | None = None) -> UsgsSeries:
    """Measured values of ``parameter`` at ``site`` between ``start_ms`` and ``end_ms`` (paged). Raises UsgsBusy on
    429, SourceError otherwise."""
    global _busy_until
    sid = site_id(site)
    if sid is None:
        raise ValueError(f"not a USGS site id: {site!r}")
    if parameter not in (PARAM_STAGE, PARAM_FLOW):
        raise ValueError(f"unknown parameter {parameter!r}")
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    ttl = RECENT_TTL_S if end_ms >= now - RECENT_MS else PAST_TTL_S
    url: str | None = CONTINUOUS
    params: dict[str, str] | None = {
        "monitoring_location_id": sid, "parameter_code": parameter, "time": f"{_iso(start_ms)}/{_iso(end_ms)}",
        "limit": str(PAGE_LIMIT), "properties": "time,value,unit_of_measure,approval_status", "f": "json"}
    rows: list[list] = []
    unit: str | None = None
    provisional = False
    fetched: int | None = None
    for _ in range(MAX_PAGES):
        if url is None:
            break
        hit = fhttp.peek_cache("GET", url, params, ttl)
        if hit is None:
            if time.monotonic() < _busy_until:
                raise UsgsBusy()
            if USGS_DOWN.down(USGS_HOST):
                raise SourceError(f"{_NAME} could not be reached (it failed less than a minute ago)")
            if not USGS_LIMITER.try_acquire():
                raise SourceBusy(f"{_NAME}: Fire-3d's request limit is reached; try again in a minute")
            try:
                hit = fhttp.request("GET", url, params=params, ttl_s=ttl, timeout=TIMEOUT_S, retries=RETRIES,
                                    expect_json=True)
            except fhttp.HttpError as e:
                if e.status == 429:
                    _busy_until = time.monotonic() + BUSY_HOLD_S
                    raise UsgsBusy() from None
                if e.status is None or e.status >= 500:
                    USGS_DOWN.mark(USGS_HOST)
                code = f"HTTP {e.status}" if e.status is not None else "no response"
                raise SourceError(f"{_NAME} could not be reached ({code})", e.status) from None
            except Exception as e:  # noqa: BLE001
                USGS_DOWN.mark(USGS_HOST)
                log.warning("%s: %s", _NAME, config.mask_secrets(f"{type(e).__name__}: {e}"))
                raise SourceError(f"{_NAME} could not be reached (no response)") from None
            USGS_DOWN.clear(USGS_HOST)
        try:
            doc = hit.json()
        except ValueError:
            fhttp.evict_cache("GET", url, params)
            raise SourceError(f"{_NAME} sent a reply Fire-3d could not read") from None
        if not isinstance(doc, dict) or not isinstance(doc.get("features"), list):
            fhttp.evict_bad_answer(hit, "GET", url, params)
            raise SourceError(f"{_NAME} sent an unexpected reply")
        fetched = int(hit.fetched_ms) if fetched is None else min(fetched, int(hit.fetched_ms))
        for f in doc["features"]:
            p = f.get("properties") if isinstance(f, dict) else None
            if not isinstance(p, dict):
                continue
            t, v = _ms(p.get("time")), _num(p.get("value"))
            if t is None or v is None:
                continue
            rows.append([t, v])
            unit = unit or (str(p.get("unit_of_measure")).strip() or None if p.get("unit_of_measure") else None)
            if str(p.get("approval_status") or "").strip().lower() != "approved":
                provisional = True
        nxt = next((ln.get("href") for ln in doc.get("links") or [] if isinstance(ln, dict) and ln.get("rel") == "next"),
                   None)
        url, params = (str(nxt), None) if nxt and str(nxt).startswith(f"https://{USGS_HOST}/") else (None, None)
    rows.sort(key=lambda r: r[0])
    dedup = [r for i, r in enumerate(rows) if i == 0 or r[0] != rows[i - 1][0]]
    return UsgsSeries(sid, parameter, unit, dedup, provisional, int(fetched if fetched is not None else now))


def observed_series(site: str, start_ms: int, end_ms: int, *, now_ms: int | None = None) -> dict:
    """A ``GaugeSeries``-shaped observed part ``{observed: [[t, stage, flow]], stage_unit, flow_unit, provisional,
    fetched_ms}`` from USGS stage and flow (flow optional: a stage-only site still answers)."""
    stage = continuous(site, PARAM_STAGE, start_ms, end_ms, now_ms=now_ms)
    try:
        flow: UsgsSeries | None = continuous(site, PARAM_FLOW, start_ms, end_ms, now_ms=now_ms)
    except UsgsBusy:
        raise
    except SourceError as e:
        log.info("USGS flow for %s: %s", site, e)
        flow = None
    by_t: dict[int, list] = {t: [t, v, None] for t, v in stage.rows}
    for t, q in (flow.rows if flow else []):
        by_t.setdefault(t, [t, None, None])[2] = q
    return {"observed": [by_t[t] for t in sorted(by_t)], "stage_unit": stage.unit or "ft",
            "flow_unit": (flow.unit if flow else None), "provisional": stage.provisional or bool(flow and flow.provisional),
            "fetched_ms": min(stage.fetched_ms, flow.fetched_ms) if flow else stage.fetched_ms}


def reset_state() -> None:
    global _busy_until
    _busy_until = 0.0
    USGS_DOWN.reset()
