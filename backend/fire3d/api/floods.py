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
import time
from typing import Any

import orjson
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response

from ..contracts import dump
from ..floods import build as flood_build
from ..floods import catalog, store
from ..floods import copy as fcopy
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

