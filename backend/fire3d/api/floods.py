"""Flood routes (brief 5, CONTRACT 16.7), mounted by one ``include_router`` line in ``api/app.py``.

Built by ``backend-flood-sources`` (M4): ``GET /api/floods`` (the live list; the historical lists come with
``backend-flood-live`` M2), ``GET /api/floods/status`` (from the list until the flood live loop owns it) and
``GET /api/floods/{id}`` (PLAN-5 3.2 rule 13: live list -> year lists -> registry alias -> bundle summary ->
last-known summary -> 404; 503 ``FLOOD_LISTS_503`` when the lists could not decide and nothing is on disk).

Added by ``backend-flood-bundle-api``: ``POST /api/floods/{id}/build`` (the flood bundle, ``floods/build.py``, as a
background job; 409 for ``fixture-flood`` or a flood outside the lower 48), ``GET /api/floods/{id}/files/{path}``
(gzip, ETag, no-cache, traversal-safe; dotfiles and the fixture's canned ``api/`` answers are not served), and the
per-flood routes (maps, model, satellite, official flood alerts and river gauges). List and detail rows carry this
server's bundle state on every request (a bundle built after the list was cached shows at once).

Route functions that touch the network are plain ``def`` (FastAPI's threadpool). Error texts never carry a secret.
"""

from __future__ import annotations

import gzip
import logging
import math
import re
import time
from pathlib import Path
from typing import Any

import orjson
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response

from ..contracts import dump
from ..floods import build as flood_build
from ..floods import catalog, store
from ..floods import copy as fcopy
from ..floods import gauges as flood_gauges
from ..floods import maps as flood_maps
from ..floods import satellite as flood_satellite
from ..floods import zones as flood_zones
from ..sources.nws import SourceBusy
from . import jobs as jobs_mod

log = logging.getLogger(__name__)
router = APIRouter()
GZIP_MIN_BYTES = 1024


def _json(obj: Any, request: Request | None = None, status: int = 200) -> Response:
    body = orjson.dumps(obj, option=orjson.OPT_SERIALIZE_NUMPY | orjson.OPT_NON_STR_KEYS)
    headers = {"Vary": "Accept-Encoding", "Cache-Control": "no-store"}
    if request is not None and "gzip" in request.headers.get("accept-encoding", "").lower() and len(body) >= GZIP_MIN_BYTES:
        headers["Content-Encoding"] = "gzip"
        body = gzip.compress(body, compresslevel=6, mtime=0)
    return Response(body, status_code=status, media_type="application/json", headers=headers)


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status, headers={"Cache-Control": "no-store"})


def _bundle_now(s: dict) -> dict:
    """A summary with this server's bundle state now: a queued or running build job, the build lock, the manifest."""
    if jobs_mod.get_manager().active_for(s["id"], "build") is not None:
        return {**s, "bundle_status": "building", "bundle_built_ms": None}
    st, built = store.bundle_state(s["id"])
    return {**s, "bundle_status": st, "bundle_built_ms": built}


@router.get("/api/floods")
def list_floods(request: Request, mode: str = Query("live", pattern="^(live|historical)$"), year: int | None = None,
                refresh: int = 0) -> Response:
    """``FloodListResponse``: the live list (cached 5 min; 60 s while degraded); historical lists answer an empty
    list that says past floods are not listed yet (``backend-flood-live`` M2 adds them). With both lists down the
    answer is still a 200 (every source ``unavailable`` with ``FLOOD_LISTS_DOWN``, the ready bundles on disk only),
    never a 503: the sources say why (contract5 note, deviation of CONTRACT 16.7; review BFS-R6)."""
    if mode == "historical":
        y = year or time.gmtime().tm_year
        return _json({"hazard": "flood", "mode": "historical", "updated_ms": int(time.time() * 1000), "year": y,
                      "preparing": False, "floods": [],
                      "sources": [{"id": "iem_archive", "name": fcopy.SOURCE_NAMES["iem_archive"],
                                   "status": "unavailable", "retrieved_ms": None, "reason": fcopy.PAST_NOT_YET,
                                   "stale": False}],
                      "products_in_effect": None}, request)
    lst = catalog.public_list(catalog.flood_list(refresh=bool(refresh)))
    return _json({**lst, "floods": [_bundle_now(r) for r in lst["floods"]]}, request)


@router.get("/api/floods/status")
def flood_status() -> Response:
    """``FloodLiveStatus`` (counts null when the lists could not be read, never 0)."""
    return _json(catalog.live_status())


@router.get("/api/floods/{flood_id}")
def get_flood(flood_id: str) -> Response:
    """``FloodDetailResponse`` ``{summary, manifest, job, resolved_from}`` (rule 13)."""
    try:
        summary, resolved = catalog.resolve(flood_id)
    except catalog.FloodNotFound:
        return _error(404, fcopy.FLOOD_NOT_LISTED_DETAIL)
    except catalog.ListsUnavailable:
        return _error(503, fcopy.FLOOD_LISTS_503)
    canonical = summary["id"]
    m = store.load_flood_manifest(canonical)
    job = jobs_mod.get_manager().latest_for(canonical)
    return _json({"summary": _bundle_now(summary), "manifest": m if (m and m.get("status") == "ready") else None,
                  "job": dump(job) if job else None, "resolved_from": resolved})


# ----------------------------------------------------------------------------------------------------------------
# Build and files (backend-flood-bundle-api M2)
# ----------------------------------------------------------------------------------------------------------------
def _build_job_fn(flood_id: str, force: bool):
    def fn(progress):
        m = store.load_flood_manifest(flood_id)
        if not force and m is not None and m.get("status") == "ready" and not store.build_in_progress(flood_id):
            progress("finish", 1.0, "The flood bundle is already prepared")
            return {"built_ms": m.get("built_ms"), "status": "ready", "warnings": len(m.get("warnings") or []),
                    "message": "bundle ready"}
        m = flood_build.build_flood(flood_id, progress=progress, force=force)
        return {"built_ms": m["built_ms"], "status": m["status"], "warnings": len(m["warnings"]), "message": "bundle ready"}

    return fn


@router.post("/api/floods/{flood_id}/build")
def start_flood_build(flood_id: str, force: bool = False) -> Response:
    """``JobStatus`` of the flood bundle build (kind "build", ``incident_id`` = the flood id); the running build when
    there is one. 404 not listed, 409 ``fixture-flood`` or outside the lower 48, 503 the lists could not decide."""
    if not store.valid_id(flood_id):
        return _error(404, fcopy.FLOOD_ROUTE_NOT_LISTED)
    jm = jobs_mod.get_manager()
    active = jm.active_for(flood_id, "build")
    if active is not None:
        return _json(dump(active))
    try:
        flood_build.gate(flood_id)
    except flood_build.BuildRefused as e:
        return _error(e.status, e.detail)
    st = jm.submit("build", flood_id, _build_job_fn(flood_id, force), progress_mode="overall",
                   message="rebuild queued" if force else "build queued")
    return _json(dump(st))


CONTENT_TYPES = {
    ".json": "application/json", ".geojson": "application/geo+json", ".bin": "application/octet-stream",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".txt": "text/plain; charset=utf-8",
}
NO_GZIP = {".jpg", ".jpeg", ".png"}


@router.get("/api/floods/{flood_id}/files/{path:path}")
def flood_file(flood_id: str, path: str, request: Request) -> Response:
    """A flood bundle file: gzip when accepted (not JPEG / PNG), weak ETag + 304, ``Cache-Control: no-cache``.
    Absolute paths, ``..``, dotfiles (lock, staging), directories, symlink escapes and the fixture's canned ``api/``
    answers are 404."""
    from .. import bundle

    try:
        bdir = store.flood_dir(flood_id)
        p = bundle.resolve_bundle_file(bdir, path)
    except ValueError:
        return _error(404, "not found")
    parts = path.replace("\\", "/").split("/")
    if any(part.startswith(".") for part in parts) or parts[0] == "api" or not p.is_file():
        return _error(404, "not found")
    st = p.stat()
    use_gzip = "gzip" in request.headers.get("accept-encoding", "").lower() and p.suffix.lower() not in NO_GZIP
    etag = f'W/"{st.st_size:x}-{st.st_mtime_ns:x}{"-gz" if use_gzip else ""}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
    inm = request.headers.get("if-none-match")
    if inm and (inm.strip() == "*" or etag in [t.strip() for t in inm.split(",")]):
        return Response(status_code=304, headers=headers)
    ctype = CONTENT_TYPES.get(p.suffix.lower(), "application/octet-stream")
    body = p.read_bytes()
    if use_gzip:
        headers["Content-Encoding"] = "gzip"
        body = gzip.compress(body, compresslevel=6, mtime=0)
    return Response(body, media_type=ctype, headers=headers)



# ----------------------------------------------------------------------------------------------------------------
# Per-flood maps, model and satellite; official flood alerts and river gauges (backend-flood-bundle-api M3)
# ----------------------------------------------------------------------------------------------------------------
PAST_TOLERANCE_MS = 6 * 3_600_000                        # an at_ms older than now - this is "past" (as extras)
_FICTIONAL_LID = re.compile(r"^ZZ[A-Z0-9]{3}$")          # the fixture's gauges (fictional ids; never a real NWSLI)
_LID = re.compile(r"^[A-Za-z0-9]{5}$")


class _Answer(Exception):
    """An HTTP error answer from a helper."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _now() -> int:
    return int(time.time() * 1000)


def _synthetic(flood_id: str) -> Path | None:
    """The bundle folder of a synthetic flood (``fixture-flood``), else None."""
    m = store.load_flood_manifest(flood_id)
    if m is not None and (m.get("summary") or {}).get("synthetic"):
        return store.flood_dir(flood_id)
    return None


def _load(path: Path) -> Any | None:
    try:
        return orjson.loads(path.read_bytes()) if path.is_file() else None
    except (OSError, orjson.JSONDecodeError):
        return None


def _frozen(bdir: Path, *names: str) -> Any:
    """The first of the synthetic bundle's canned answers (``api/<name>``) or frozen files (``<name>``) that exists."""
    for n in names:
        obj = _load(bdir / "api" / n)
        if obj is None:
            obj = _load(bdir / n)
        if obj is not None:
            return obj
    raise _Answer(404, "not found")


def _summary(flood_id: str) -> dict:
    """The flood's summary by the rule-13 chain; 404 / 503 as ``GET /api/floods/{id}``."""
    if not store.valid_id(flood_id):
        raise _Answer(404, fcopy.FLOOD_ROUTE_NOT_LISTED)
    try:
        return catalog.resolve(flood_id)[0]
    except catalog.FloodNotFound:
        raise _Answer(404, fcopy.FLOOD_ROUTE_NOT_LISTED) from None
    except catalog.ListsUnavailable:
        raise _Answer(503, fcopy.FLOOD_LISTS_503) from None


def _area(summary: dict) -> tuple[float, float, float, float]:
    """The flood's map area: its bundle's grid when one is ready (the maps match the 3D view), else the same square."""
    m = store.load_flood_manifest(summary["id"])
    bb = ((m or {}).get("grid") or {}).get("bbox_lonlat") if (m or {}).get("status") == "ready" else None
    if isinstance(bb, list) and len(bb) == 4:
        return tuple(round(float(v), 5) for v in bb)  # type: ignore[return-value]
    return flood_maps.flood_area(summary).bbox


def _answer(fn) -> Response:
    try:
        return fn()
    except _Answer as e:
        return _error(e.status, e.detail)
    except SourceBusy as e:
        return _error(429, str(e))


@router.get("/api/floods/{flood_id}/maps")
def get_flood_map(request: Request, flood_id: str, kind: str = Query(..., pattern="^(rfc_fim|catfim|nfhl)$"),
                  lid: str | None = Query(None, pattern=r"^[A-Za-z0-9]{5}$"),
                  category: str | None = Query(None, pattern="^(action|minor|moderate|major|record)$"),
                  at_ms: int | None = Query(None, ge=0)) -> Response:
    """``FloodMapResponse``: the NWS forecast flooded area (5 days, experimental; ``stats`` from member reaches only),
    NWS category flood maps (experimental library; one gauge and category), or FEMA's 1 % floodplain (background)."""
    def run() -> Response:
        bdir = _synthetic(flood_id)
        if bdir is not None:
            names = [f"maps-catfim-{lid.upper()}-{category}.json"] if (kind == "catfim" and lid and category) else []
            return _json(_frozen(bdir, *names, f"maps-{kind}.json"), request)
        s = _summary(flood_id)
        return _json(flood_maps.map_answer(kind, s, now=_now(), lid=lid, category=category, at_ms=at_ms,
                                           area=None if kind == "catfim" else _area(s)), request)
    return _answer(run)


@router.get("/api/floods/{flood_id}/model")
def get_flood_model(request: Request, flood_id: str,
                    kind: str = Query(..., pattern="^(nwm_analysis|nwm_5day|nwm_high_flow|nwm_series)$"),
                    lid: str | None = Query(None, pattern=r"^[A-Za-z0-9]{5}$"),
                    at_ms: int | None = Query(None, ge=0)) -> Response:
    """``ModelOutputResponse`` (National Water Model: experimental model output, never official, ``MODEL_CAVEAT``)."""
    def run() -> Response:
        bdir = _synthetic(flood_id)
        if bdir is not None:
            if kind == "nwm_series":
                pg = ((store.load_flood_manifest(flood_id) or {}).get("summary") or {}).get("primary_gauge") or {}
                want = (lid or pg.get("lid") or "").upper()
                return _json(_frozen(bdir, f"model-nwm_series-{want}.json"), request)
            return _json(_frozen(bdir, f"model-{kind}.json"), request)
        s = _summary(flood_id)
        return _json(flood_maps.model_answer(kind, s, now=_now(), lid=lid, at_ms=at_ms,
                                             area=None if kind == "nwm_series" else _area(s)), request)
    return _answer(run)


@router.get("/api/floods/{flood_id}/satellite")
def get_flood_satellite(request: Request, flood_id: str, at_ms: int | None = Query(None, ge=0)) -> Response:
    """``SatelliteWaterResponse`` (water seen by satellite, NASA OPERA; ``login`` never carries the token). Only when
    NASA cannot be reached (the answer is ``unavailable``, or the picture fallback because Earthdata GIS is down:
    ``reason_code`` ``upstream_error``), a ready bundle's frozen measured answer (absolute times) is served, with
    ``SAT_SAVED_COPY``. When NASA answered that it has no usable image of the last 10 days (``no_image``), that
    answer is served as is: an older saved image never replaces it."""
    def run() -> Response:
        bdir = _synthetic(flood_id)
        if bdir is not None:
            return _json(_frozen(bdir, "satellite.json"), request)
        s = _summary(flood_id)
        res = flood_satellite.cached_answer(s["id"], _area(s), now=_now(), time_zone=s.get("time_zone") or "UTC",
                                            at_ms=at_ms)
        a = res.answer
        outage = a["status"] == "unavailable" or (not a["measured"] and a.get("reason_code") == "upstream_error")
        if outage and at_ms is None:
            m = store.load_flood_manifest(s["id"])
            frozen = _load(store.flood_dir(s["id"]) / "satellite.json") if (m or {}).get("status") == "ready" else None
            if frozen is not None and frozen.get("measured"):
                caveats = list(frozen.get("caveats") or [])
                if fcopy.SAT_SAVED_COPY not in caveats:
                    caveats.append(fcopy.SAT_SAVED_COPY)
                return _json({**frozen, "login": a["login"], "login_note": a["login_note"], "now_ms": _now(),
                              "caveats": caveats}, request)
        return _json(a, request)
    return _answer(run)


@router.get("/api/floods/{flood_id}/satellite.png")
def get_flood_satellite_png(flood_id: str, granule: str | None = Query(None, max_length=200)) -> Response:
    """The satellite water PNG of ``image.url`` (lon/lat bounds in the JSON); clouds and no data hatched, outside the
    image transparent. 404 when it is no longer kept."""
    def run() -> Response:
        if not store.valid_id(flood_id):
            raise _Answer(404, "not found")
        key = re.sub(r"[^A-Za-z0-9_.-]", "", granule or "")
        cands = []
        if key:
            cands.append(flood_satellite.png_dir(flood_id) / f"{key}.png")
        frozen = _load(store.flood_dir(flood_id) / "satellite.json")
        if frozen is not None:
            url = ((frozen.get("image") or {}).get("url") or "")
            ids = {g.get("id") for g in frozen.get("granules") or []}
            if not key or key in url or key in ids:
                cands.append(store.flood_dir(flood_id) / "satellite.png")
        for p in cands:
            if p.is_file():
                return Response(p.read_bytes(), media_type="image/png",
                                headers={"Cache-Control": "public, max-age=86400" if key else "no-cache"})
        if key and _synthetic(flood_id) is None:
            s = _summary(flood_id)
            res = flood_satellite.cached_answer(s["id"], _area(s), now=_now(), time_zone=s.get("time_zone") or "UTC")
            if res.key == key and res.png is not None:
                return Response(res.png, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})
        raise _Answer(404, fcopy.SATELLITE_IMAGE_GONE)
    return _answer(run)


def _bbox(text: str) -> tuple[float, float, float, float]:
    """"w,s,e,n" (a point when w == e and s == n); 422 when malformed or larger than 4 degrees."""
    try:
        w, s, e, n = (float(v) for v in text.split(","))
    except ValueError:
        raise _Answer(422, "bbox must be four numbers: w,s,e,n") from None
    if not all(math.isfinite(v) for v in (w, s, e, n)) or not (-180 <= w <= e <= 180 and -85 <= s <= n <= 85):
        raise _Answer(422, "bbox must satisfy -180 <= w <= e <= 180 and -85 <= s <= n <= 85")
    if e - w > 4.0 or n - s > 4.0:
        raise _Answer(422, "bbox spans more than 4 degrees")
    return (w, s, e, n)


@router.get("/api/official/flood-alerts")
def get_flood_alerts(request: Request, flood: str | None = Query(None, max_length=120),
                     bbox: str | None = Query(None, max_length=120), at_ms: int | None = Query(None, ge=0)) -> Response:
    """``FloodAlertsResponse``: NWS flood products verbatim (issuer, own times, link); for a flood its own products and
    attached watches, for an area (or a point) every product touching it, watches included. 422 without a scope."""
    def run() -> Response:
        now = _now()
        if flood:
            bdir = _synthetic(flood)
            if bdir is not None:
                return _json(_frozen(bdir, "flood-alerts.json", "warnings.json"), request)
            return _json(flood_zones.flood_alerts(_summary(flood), now=now, at_ms=at_ms), request)
        if bbox:
            return _json(flood_zones.bbox_alerts(_bbox(bbox), now=now, at_ms=at_ms), request)
        raise _Answer(422, "flood-alerts needs flood= or bbox=")
    return _answer(run)


def _fictional_gauge(lid: str, series: bool) -> dict | None:
    for m in store.list_flood_bundles():
        if (m.get("summary") or {}).get("synthetic"):
            obj = _load(store.flood_dir(m["id"]) / "api" / f"river-gauges-{lid}.json")
            if obj is not None:
                return obj if series else {**obj, "gauges": [{k: v for k, v in g.items() if k != "series"}
                                                             for g in obj["gauges"]]}
    return None


@router.get("/api/official/river-gauges")
def get_river_gauges(request: Request, flood: str | None = Query(None, max_length=120),
                     bbox: str | None = Query(None, max_length=120),
                     lid: str | None = Query(None, max_length=8),
                     scope: str | None = Query(None, pattern="^national$"),
                     min: str = Query("action", pattern="^(action|minor|moderate|major)$"),  # noqa: A002 - query name
                     series: int = Query(0, ge=0, le=1), at_ms: int | None = Query(None, ge=0)) -> Response:
    """``RiverGaugesResponse``: a flood's member gauges (NWPS; primary first) then nearby gauges, the gauges of an area
    or near a point, one gauge (``lid``; NWPS), or every lower-48 gauge at ``min`` or worse. Area and nearby lists
    come from the NWS ``riv_gauges`` map by envelope, never an NWPS list. 422 without a scope."""
    def run() -> Response:
        now = _now()
        with_series = bool(series)
        if at_ms is not None and at_ms < now - PAST_TOLERANCE_MS and scope != "national":
            # never today's readings for a past time (USGS history comes with backend-flood-live)
            return _json({**flood_gauges.envelope("river_gauges", now=now, flood_id=flood, status="not_available_for_past_dates",
                                                  reason=fcopy.GAUGES_PAST_NOT_YET, reason_code="past_date", at_ms=at_ms,
                                                  caveats=[fcopy.GAUGE_NOT_ALL_CLEAR]),
                          "gauges": [], "area_bbox": None}, request)
        if flood:
            bdir = _synthetic(flood)
            if bdir is not None:
                return _json(_frozen(bdir, "gauges.json") if with_series else _frozen(bdir, "river-gauges.json"), request)
            return _json(flood_gauges.flood_gauges(_summary(flood), now=now, with_series=with_series, at_ms=at_ms),
                         request)
        if lid:
            if not _LID.match(lid):
                raise _Answer(422, "lid must be an NWS gauge id (5 letters or digits)")
            up = lid.upper()
            if _FICTIONAL_LID.match(up):
                obj = _fictional_gauge(up, with_series)
                if obj is None:
                    raise _Answer(404, fcopy.GAUGE_NOT_FOUND)
                return _json(obj, request)
            try:
                return _json(flood_gauges.lid_gauge(up, now=now, with_series=with_series, at_ms=at_ms), request)
            except LookupError:
                raise _Answer(404, fcopy.GAUGE_NOT_FOUND) from None
        if scope == "national":
            return _json(flood_gauges.national_gauges(min, now=now), request)
        if bbox:
            return _json(flood_gauges.bbox_gauges(_bbox(bbox), now=now, at_ms=at_ms), request)
        raise _Answer(422, "river-gauges needs flood=, bbox=, lid= or scope=national")
    return _answer(run)
