"""Flood routes (brief 5, CONTRACT 16.7), mounted by one ``include_router`` line in ``api/app.py``.

Built by ``backend-flood-sources`` (M4): ``GET /api/floods`` (the live list; the historical lists come with
``backend-flood-live`` M2), ``GET /api/floods/status`` (from the list until the flood live loop owns it) and
``GET /api/floods/{id}`` (PLAN-5 3.2 rule 13: live list -> year lists -> registry alias -> bundle summary ->
last-known summary -> 404; 503 ``FLOOD_LISTS_503`` when the lists could not decide and nothing is on disk). The other
routes of 16.7 (build, files, maps, model, satellite, flood alerts, river gauges) are added by
``backend-flood-bundle-api``.

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


@router.get("/api/floods")
def list_floods(request: Request, mode: str = Query("live", pattern="^(live|historical)$"), year: int | None = None,
                refresh: int = 0) -> Response:
    """``FloodListResponse``: the live list (cached 5 min; 60 s while degraded); historical lists answer an empty
    list that says past floods are not listed yet (``backend-flood-live`` M2 adds them)."""
    if mode == "historical":
        y = year or time.gmtime().tm_year
        return _json({"hazard": "flood", "mode": "historical", "updated_ms": int(time.time() * 1000), "year": y,
                      "preparing": False, "floods": [],
                      "sources": [{"id": "iem_archive", "name": catalog.SOURCE_NAMES["iem_archive"],
                                   "status": "unavailable", "retrieved_ms": None, "reason": catalog.PAST_NOT_YET,
                                   "stale": False}],
                      "products_in_effect": None}, request)
    return _json(catalog.public_list(catalog.flood_list(refresh=bool(refresh))), request)


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
        return _error(404, "This flood is not listed.")
    except catalog.ListsUnavailable:
        return _error(503, fcopy.FLOOD_LISTS_503)
    canonical = summary["id"]
    m = store.load_flood_manifest(canonical)
    job = jobs_mod.get_manager().latest_for(canonical)
    return _json({"summary": summary, "manifest": m if (m and m.get("status") == "ready") else None,
                  "job": dump(job) if job else None, "resolved_from": resolved})
