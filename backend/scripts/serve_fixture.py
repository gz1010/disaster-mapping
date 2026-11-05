#!/usr/bin/env python
"""Standalone server for the SPEC 6 read endpoints, straight from bundles on disk (no ``fire3d.api`` import).

Frontend agents develop against it before the real API exists; it is also the reference behaviour for the
bundle file endpoint (gzip, ETag, no-cache, traversal-safe). Build/forecast POSTs return fake jobs that finish after
~5 s, and ``/aircraft`` returns 4-6 synthetic fire aircraft circling live incidents (``?force=1`` for any incident,
``?all=1`` adds non-fire traffic).

Floods (brief 5, PLAN-5 7.2): every flood route of CONTRACT 16.7 answers from the canned files in ``data/floods/*/api/``
(``scripts/make_fixture.py --only flood`` writes them): the list (with ``fixture-flood`` and the seven list-only demo
floods ``fixture-flood-<kind>``), details, NWS products and river gauges (by flood, by ``bbox`` with point checks, by
``lid``, national), maps, model output, satellite water and its PNG, bundle files, a canned build job for list-only
floods, and ``hazard=flood`` local alerts and evacuations. ``?edge=<case>`` answers an edge case: each official layer
``unavailable`` (``alerts``, ``gauges``, ``rfc_fim``, ``catfim``, ``nfhl``, ``satellite``, ``model``), lists
(``nws_down``, ``gauges_down``, ``both_down``, ``empty``), satellite (``satellite_refused``, ``satellite_picture``) and
details (``last_known``). The canned times are those of the run that wrote them: run ``make_fixture.py --only flood``
again to bring them back to the present.

Usage: ``uv run python scripts/serve_fixture.py --port 8099 [--data-dir DIR] [--host 127.0.0.1]``
"""

from __future__ import annotations

import argparse
import gzip
import math
import sys
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

import numpy as np
import uvicorn
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fire3d import bundle, config  # noqa: E402
from fire3d.contracts import (  # noqa: E402
    Aircraft,
    AircraftResponse,
    ForecastRequest,
    HealthResponse,
    IncidentDetailResponse,
    IncidentListResponse,
    IncidentListRow,
    IncidentSummary,
    JobStatus,
    ListSource,
    LiveStatus,
    dump,
)
from fire3d.grid import grids_from_manifest  # noqa: E402

JOB_SECONDS = 5.0
CONTENT_TYPES = {".json": "application/json", ".bin": "application/octet-stream", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".png": "image/png", ".npz": "application/octet-stream"}
NO_GZIP = {".jpg", ".jpeg", ".png", ".npz"}
BUILD_STEPS = ["aoi", "terrain", "fuels", "imagery", "observed", "weather", "behavior"]
FORECAST_STEPS = ["weather members", "spread", "quantiles", "write"]
FIXTURE_LIST_REASON = "Fixture server: only the fire bundles on disk are listed (the CAL FIRE and NIFC lists are not fetched)."

# Synthetic fire aircraft: (hex, callsign, registration, ICAO type, category, reason, orbit radius m, gs kt, AGL m, clockwise)
FIRE_FLEET = [
    ("a3f2c1", "TNKR912", "N612AX", "DC10", "airtanker", "type DC10 (VLAT airtanker)", 3200.0, 165.0, 450.0, True),
    ("a1b7e4", "CAL301", "N481DF", "OV10", "air_attack", "type OV10 (CAL FIRE air attack)", 4600.0, 140.0, 1150.0, False),
    ("a5c9d2", "LEAD51", "N151Z", "BE20", "lead_plane", "callsign prefix LEAD (lead plane)", 2500.0, 150.0, 320.0, True),
    ("a7e0b9", "HELI404", "N404CF", "S70", "helicopter", "type S70 (Firehawk helitanker)", 1300.0, 85.0, 160.0, False),
    ("a2d4f6", "TNKR131", "N131CG", "C130", "airtanker", "type C130 (airtanker)", 3900.0, 175.0, 520.0, False),
    ("a9b3c7", "N189AC", "N189AC", "S64", "helicopter", "type S64 (Skycrane helitanker)", 900.0, 70.0, 120.0, True),
]
OTHER_TRAFFIC = [
    ("ac81f0", "SWA2318", "N8710M", "B38M", "unknown", "airliner (A3) en route", 11000.0, 455.0, 10600.0, True),
    ("a0c3d7", "N52918", "N52918", "C172", "unknown", "general aviation, not over the fire", 15000.0, 105.0, 1500.0, False),
]


class GzipCache:
    """Small LRU of gzip-compressed bundle files keyed by (path, mtime_ns, size)."""

    def __init__(self, max_bytes: int = 96 << 20):
        self.max_bytes = max_bytes
        self.items: OrderedDict[tuple[str, int, int], bytes] = OrderedDict()
        self.size = 0
        self.lock = threading.Lock()

    def get(self, path: Path, st) -> bytes:
        key = (str(path), st.st_mtime_ns, st.st_size)
        with self.lock:
            hit = self.items.get(key)
            if hit is not None:
                self.items.move_to_end(key)
                return hit
        data = gzip.compress(path.read_bytes(), compresslevel=5, mtime=0)
        with self.lock:
            self.items[key] = data
            self.size += len(data)
            while self.size > self.max_bytes and len(self.items) > 1:
                _, old = self.items.popitem(last=False)
                self.size -= len(old)
        return data


def create_app(data_dir: Path) -> FastAPI:
    """Build the fixture app serving bundles under ``data_dir/incidents``."""
    incidents_dir = Path(data_dir).resolve() / "incidents"
    app = FastAPI(title="Disaster Mapping fixture server", version=config.VERSION)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], expose_headers=["ETag"])
    jobs: dict[str, dict[str, Any]] = {}
    jobs_lock = threading.Lock()
    gz = GzipCache()
    started = int(time.time() * 1000)
    centroid_cache: dict[tuple[str, int], tuple[float, float, np.ndarray | None]] = {}

    def bdir(incident_id: str) -> Path:
        try:
            bundle.bundle_dir(incident_id)          # validates the id
        except ValueError:
            raise HTTPException(404, "unknown incident") from None
        return incidents_dir / incident_id

    def manifests() -> list[dict]:
        out = []
        if incidents_dir.is_dir():
            for d in sorted(incidents_dir.iterdir()):
                if d.is_dir() and not d.name.startswith(".") and (d / bundle.MANIFEST_NAME).is_file():
                    m = bundle.load_manifest(d)
                    if isinstance(m, dict) and m.get("status") == "ready":
                        out.append(m)
        return out

    def summary_of(m: dict) -> dict:
        s = dict(m["summary"])
        s["bundle_status"] = "ready"
        s["bundle_built_ms"] = m.get("built_ms")
        return dump(IncidentSummary.model_validate(s))

    def row_of(m: dict) -> dict:
        """A list row (``IncidentListRow``): the summary plus the ready bundle's analysis area (``bbox_lonlat``)."""
        grid = m.get("grid") if isinstance(m.get("grid"), dict) else {}
        bb = grid.get("bbox_lonlat")
        ok = isinstance(bb, (list, tuple)) and len(bb) == 4 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in bb)
        ok = ok and bb[0] < bb[2] and bb[1] < bb[3]
        return dump(IncidentListRow.model_validate({**summary_of(m), "bbox_lonlat": list(bb) if ok else None}))

    def list_sources() -> list[ListSource]:
        """The fixture server never reaches the source lists (CONTRACT 14.1 ``sources``): both are unavailable."""
        return [ListSource(id=sid, name=name, status="unavailable", retrieved_ms=None, reason=FIXTURE_LIST_REASON)
                for sid, name in (("calfire", "CAL FIRE"), ("wfigs", "NIFC WFIGS (IRWIN)"))]

    def load_ready(incident_id: str) -> dict:
        d = bdir(incident_id)
        m = bundle.load_manifest(d) if d.is_dir() else None
        if not isinstance(m, dict):
            raise HTTPException(404, f"no bundle for {incident_id}")
        return m

    # ---------------------------------------------------------------- jobs
    def job_view(j: dict[str, Any]) -> dict:
        now = time.time()
        el = now - j["t0"]
        steps = j.get("steps") or (BUILD_STEPS if j["kind"] == "build" else FORECAST_STEPS)
        if el < 0.4:
            status, progress, step, started_ms, finished_ms = "queued", 0.0, "queued", None, None
        elif el < JOB_SECONDS:
            frac = (el - 0.4) / (JOB_SECONDS - 0.4)
            i = min(len(steps) - 1, int(frac * len(steps)))
            status, progress, step = "running", round(frac, 3), steps[i]
            started_ms, finished_ms = j["created_ms"] + 400, None
        else:
            status, progress, step = "done", 1.0, "done"
            started_ms, finished_ms = j["created_ms"] + 400, j["created_ms"] + int(JOB_SECONDS * 1000)
        msg = {"queued": "waiting for a worker", "done": "finished (fixture: nothing was rebuilt)"}.get(step, f"{step} (fixture)")
        return dump(JobStatus(
            id=j["id"], kind=j["kind"], incident_id=j["incident_id"], status=status, progress=progress, step=step, message=msg,
            created_ms=j["created_ms"], started_ms=started_ms, finished_ms=finished_ms, error=None,
            result=j["result"] if status == "done" else None,
        ))

    def start_job(kind: str, incident_id: str, result: Any, steps: list[str] | None = None) -> dict:
        with jobs_lock:
            for j in jobs.values():
                if j["incident_id"] == incident_id and j["kind"] == kind and time.time() - j["t0"] < JOB_SECONDS:
                    return job_view(j)
            jid = f"job-{len(jobs) + 1:04d}-{kind}"
            j = {"id": jid, "kind": kind, "incident_id": incident_id, "t0": time.time(), "created_ms": int(time.time() * 1000), "result": result}
            if steps:
                j["steps"] = steps
            jobs[jid] = j
            return job_view(j)

    def latest_job(incident_id: str) -> dict | None:
        with jobs_lock:
            js = [j for j in jobs.values() if j["incident_id"] == incident_id]
        return job_view(max(js, key=lambda j: j["t0"])) if js else None

    # ---------------------------------------------------------------- endpoints
    @app.get("/api/health")
    def health() -> dict:
        return dump(HealthResponse(ok=True, version=config.VERSION))

    @app.get("/api/incidents")
    def incidents(mode: str = Query("historical", pattern="^(live|historical)$"), min_acres: float | None = None,
                  year: int | None = None, state: str | None = None) -> dict:
        lo = min_acres if min_acres is not None else (300.0 if mode == "historical" else None)
        rows = [row_of(m) for m in manifests() if m.get("mode") == mode]
        if mode == "historical" and year is not None:
            rows = [r for r in rows if r["year"] == year]
        if state:
            rows = [r for r in rows if (r.get("state") or "").upper() == state.upper()]
        if lo is not None:
            rows = [r for r in rows if r["acres"] is None or r["acres"] >= lo]
        if mode == "historical":
            rows.sort(key=lambda r: -(r["acres"] or 0))
        else:
            rows.sort(key=lambda r: (-(r["detections_24h"] or 0), -(r["acres"] or 0)))
        return dump(IncidentListResponse(mode=mode, updated_ms=int(time.time() * 1000), incidents=rows, sources=list_sources(),
                                         year=year if mode == "historical" else None))

    @app.get("/api/incidents/{incident_id}")
    def incident(incident_id: str) -> dict:
        m = load_ready(incident_id)
        return dump(IncidentDetailResponse(summary=summary_of(m), manifest=m, job=latest_job(incident_id)))

    @app.post("/api/incidents/{incident_id}/build")
    def build(incident_id: str, force: bool = False) -> dict:
        m = load_ready(incident_id)
        return start_job("build", incident_id, {"built_ms": m.get("built_ms"), "force": force})

    @app.post("/api/incidents/{incident_id}/forecast")
    def forecast(incident_id: str, req: ForecastRequest | None = Body(default=None)) -> dict:
        m = load_ready(incident_id)
        runs = m.get("forecasts") or []
        return start_job("forecast", incident_id, {"run_id": runs[0]["run_id"] if runs else None, "request": dump(req) if req else None})

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str) -> dict:
        with jobs_lock:
            j = jobs.get(job_id)
        if j is None:
            raise HTTPException(404, "unknown job")
        return job_view(j)

    @app.get("/api/live/status")
    def live_status() -> dict:
        live = [m for m in manifests() if m.get("mode") == "live"]
        now = int(time.time() * 1000)
        last = now - (now - started) % (15 * 60_000)
        det = sum((m["summary"].get("detections_24h") or 0) for m in live)
        return dump(LiveStatus(last_refresh_ms=last, next_refresh_ms=last + 15 * 60_000, active_incidents=len(live), detections_24h_ca=det,
                               auto_build=False, detections_24h=det))

    def fire_center(incident_id: str, m: dict) -> tuple[float, float, np.ndarray | None]:
        key = (incident_id, int(m.get("built_ms") or 0))
        if key not in centroid_cache:
            d = bdir(incident_id)
            cx, cz = (m["ignition"]["x"], m["ignition"]["z"]) if m.get("ignition") else (0.0, 0.0)
            elev = None
            try:
                arr = bundle.read_layer(d, "observed_arrival", m)
                r, c = np.nonzero(arr < config.NEVER)
                if len(r):
                    _, fire = grids_from_manifest(m)
                    cx = float(((c + 0.5) * fire.res_m - fire.extent_m / 2).mean())
                    cz = float(((r + 0.5) * fire.res_m - fire.extent_m / 2).mean())
                elev = bundle.read_layer(d, "elevation", m)
            except (KeyError, OSError, ValueError):
                pass
            centroid_cache[key] = (cx, cz, elev)
        return centroid_cache[key]

    @app.get("/api/incidents/{incident_id}/aircraft")
    def aircraft(incident_id: str, all: int = 0, force: int = 0) -> dict:  # noqa: A002 - query name from SPEC 6
        m = load_ready(incident_id)
        now = time.time()
        if m.get("mode") != "live" and not force:
            return dump(AircraftResponse(updated_ms=int(now * 1000), source="adsb.lol (fixture)", radius_nm=40, aircraft=[],
                                         note="Aircraft are only tracked for live incidents."))
        render, _ = grids_from_manifest(m)
        cx, cz, elev = fire_center(incident_id, m)
        half = render.extent_m / 2

        def ground(x: float, z: float) -> float | None:
            if elev is None or abs(x) > half or abs(z) > half:
                return None
            rr, cc = render.local_to_rowcol(x, z)
            return float(elev[int(np.clip(rr, 0, elev.shape[0] - 1)), int(np.clip(cc, 0, elev.shape[1] - 1))])

        fleet = FIRE_FLEET[: 4 + int(now // 300) % 3] + (OTHER_TRAFFIC if all else [])
        out = []
        for i, (hx, cs, reg, typ, cat, reason, radius, gs, agl, cw) in enumerate(fleet):
            is_fire = cat != "unknown"
            period = 2 * math.pi * radius / (gs * 0.514444)
            theta = (i * 1.37 + 2 * math.pi * (now / period)) * (1 if cw else -1)
            x = cx + radius * math.sin(theta)
            z = cz - radius * math.cos(theta)
            track = (math.degrees(theta) + (90.0 if cw else -90.0)) % 360.0
            g = ground(x, z)
            alt = (g if g is not None else float(m["grid"]["elev_min_m"])) + agl + 25.0 * math.sin(now / 20.0 + i)
            lon, lat = render.local_to_lonlat(x, z)
            out.append(Aircraft(
                hex=hx, callsign=cs, registration=reg, type=typ, category=cat, is_fire_aircraft=is_fire, reason=reason,
                lat=round(lat, 6), lon=round(lon, 6), x=round(x, 1), z=round(z, 1), alt_m=round(alt, 1),
                agl_m=None if g is None else round(alt - g, 1), gs_kt=round(gs, 1), track_deg=round(track, 1),
                seen_s=round(0.3 + (now * 7.3 + i) % 2.2, 1), on_ground=False,
            ))
        return dump(AircraftResponse(updated_ms=int(now * 1000), source="adsb.lol (fixture)", radius_nm=40, aircraft=out))

    @app.get("/api/bundles/{incident_id}/{path:path}")
    def bundle_file(incident_id: str, path: str, request: Request) -> Response:
        d = bdir(incident_id)
        try:
            p = bundle.resolve_bundle_file(d, path)
        except ValueError:
            raise HTTPException(404, "not found") from None
        if any(part.startswith(".") for part in Path(path).parts) or not p.is_file():
            raise HTTPException(404, "not found")
        st = p.stat()
        use_gzip = "gzip" in request.headers.get("accept-encoding", "").lower() and p.suffix.lower() not in NO_GZIP
        etag = f'W/"{st.st_size:x}-{st.st_mtime_ns:x}{"-gz" if use_gzip else ""}"'
        headers = {"ETag": etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
        inm = request.headers.get("if-none-match")
        if inm and etag in [t.strip() for t in inm.split(",")]:
            return Response(status_code=304, headers=headers)
        ctype = CONTENT_TYPES.get(p.suffix.lower(), "application/octet-stream")
        if use_gzip:
            headers["Content-Encoding"] = "gzip"
            return Response(gz.get(p, st), media_type=ctype, headers=headers)
        return Response(p.read_bytes(), media_type=ctype, headers=headers)

    mount_flood_routes(app, Path(data_dir).resolve(), start_job=start_job, latest_job=latest_job, gz=gz)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    return app


# ---------------------------------------------------------------------------------------------------------------------
# Brief 5: flood routes (CONTRACT 16.7) from the canned answers in data/floods/*/api/ (PLAN-5 7.2)
# ---------------------------------------------------------------------------------------------------------------------
FLOOD_BUILD_STEPS = ["catalog", "terrain", "maps", "gauges", "satellite", "finish"]
FLOOD_EDGE_FILES = {
    "alerts": "alerts-unavailable.json", "gauges": "gauges-unavailable.json", "rfc_fim": "rfc_fim-unavailable.json",
    "catfim": "catfim-unavailable.json", "nfhl": "nfhl-unavailable.json", "satellite": "satellite-unavailable.json",
    "satellite_refused": "satellite-refused.json", "satellite_picture": "satellite-picture.json",
    "model": "model-unavailable.json", "nws_down": "list-nws-down.json", "gauges_down": "list-gauges-down.json",
    "both_down": "list-both-down.json", "empty": "list-empty.json", "last_known": "detail-last-known.json",
}
FLOOD_ID_RE = __import__("re").compile(r"^[a-z0-9][a-z0-9-]{0,120}$")
CATEGORY_ORDER = ("action", "minor", "moderate", "major")
_SIG_ORDER = {"W": 0, "Y": 1, "A": 2}


def _bbox_param(raw: str | None) -> tuple[float, float, float, float] | None:
    if raw is None:
        return None
    try:
        w, s_, e, n = (float(x) for x in raw.split(","))
    except ValueError:
        raise HTTPException(422, "bbox must be w,s,e,n") from None
    if not (w <= e and s_ <= n):
        raise HTTPException(422, "bbox must be w,s,e,n")
    return (w, s_, e, n)


def mount_flood_routes(app: FastAPI, data_dir: Path, *, start_job, latest_job, gz: GzipCache) -> None:
    """Mount the flood routes on the fixture app (answers are read from disk on each request; they are small)."""
    import orjson
    import shapely
    from shapely.geometry import Point, box, shape

    from fire3d.contracts import (
        FloodAlertsResponse, FloodDetailResponse, FloodListResponse, FloodLiveStatus, FloodMapResponse,
        LocalAlertsResponse, ModelOutputResponse, RiverGaugesResponse, SatelliteWaterResponse,
    )

    floods_dir = data_dir / "floods"

    def api_dirs() -> list[Path]:
        if not floods_dir.is_dir():
            return []
        return [d / "api" for d in sorted(floods_dir.iterdir()) if (d / "api").is_dir()]

    def load(name: str) -> Any | None:
        for d in api_dirs():
            p = d / name
            if p.is_file():
                return orjson.loads(p.read_bytes())
        return None

    def matching(prefix: str) -> list[Any]:
        out = []
        for d in api_dirs():
            for p in sorted(d.glob(f"{prefix}*.json")):
                out.append(orjson.loads(p.read_bytes()))
        return out

    def edge(name: str | None) -> Any | None:
        if not name:
            return None
        f = FLOOD_EDGE_FILES.get(name)
        if f is None:
            raise HTTPException(422, f"unknown edge case {name!r}; one of {', '.join(FLOOD_EDGE_FILES)}")
        return load(f"edge/{f}")

    def check_id(flood_id: str) -> str:
        if not FLOOD_ID_RE.match(flood_id):
            raise HTTPException(404, "unknown flood")
        return flood_id

    def known(flood_id: str) -> bool:
        return flood_id == "fixture-flood" and load("detail.json") is not None or load(f"detail-{flood_id}.json") is not None

    def per_flood(flood_id: str, base: str) -> Any:
        """``<base>.json`` for fixture-flood, ``<base>-<id>.json`` for a list-only demo flood; 404 otherwise."""
        check_id(flood_id)
        obj = load(f"{base}.json") if flood_id == "fixture-flood" else load(f"{base}-{flood_id}.json")
        if obj is None:
            raise HTTPException(404, "unknown flood")
        return obj

    def now_ms() -> int:
        return int(time.time() * 1000)

    # ---- lists, status, detail -----------------------------------------------------------------------------------
    @app.get("/api/floods")
    def flood_list(mode: str = Query("live", pattern="^(live|historical)$"), year: int | None = None,
                   edge_case: str | None = Query(None, alias="edge")) -> Any:
        e = edge(edge_case)
        if e is not None:
            return e
        if mode == "live":
            obj = load("list.json")
            if obj is None:
                raise HTTPException(503, "The flood lists could not be reached right now; try again later.")
            return obj
        y = year or time.gmtime().tm_year
        obj = load(f"list-{y}.json")
        if obj is None:
            obj = {"hazard": "flood", "mode": "historical", "updated_ms": now_ms(), "year": y, "past_rule": "fallback",
                   "preparing": False, "floods": [], "sources": [
                       {"id": "iem_archive", "name": "Iowa Environmental Mesonet (archived NWS products)",
                        "status": "unavailable", "retrieved_ms": None, "stale": False,
                        "reason": "Fixture server: no past floods are canned for this year."}],
                   "products_in_effect": None}
            FloodListResponse.model_validate(obj)
        return obj

    @app.get("/api/floods/status")
    def flood_status() -> Any:
        obj = load("status.json")
        if obj is None:
            obj = {"last_refresh_ms": None, "next_refresh_ms": None, "active_floods": None, "gauges_in_flood": None,
                   "auto_build": False}
        return FloodLiveStatus.model_validate(obj).model_dump(mode="json")

    @app.get("/api/floods/{flood_id}")
    def flood_detail(flood_id: str, edge_case: str | None = Query(None, alias="edge")) -> Any:
        e = edge(edge_case)
        if e is not None:
            return e
        obj = per_flood(flood_id, "detail")
        if flood_id != "fixture-flood":
            obj = {**obj, "job": latest_job(flood_id)}
        return obj

    @app.post("/api/floods/{flood_id}/build")
    def flood_build(flood_id: str, force: bool = False) -> Any:
        check_id(flood_id)
        if flood_id == "fixture-flood":
            raise HTTPException(409, "'fixture-flood' is a synthetic bundle; it cannot be rebuilt.")
        if load(f"detail-{flood_id}.json") is None:
            raise HTTPException(404, "unknown flood")
        return start_job("build", flood_id, {"canned": True, "force": force, "bundle": None}, steps=FLOOD_BUILD_STEPS)

    @app.get("/api/floods/{flood_id}/files/{path:path}")
    def flood_file(flood_id: str, path: str, request: Request) -> Response:
        check_id(flood_id)
        d = floods_dir / flood_id
        try:
            p = bundle.resolve_bundle_file(d, path)
        except ValueError:
            raise HTTPException(404, "not found") from None
        if any(part.startswith(".") for part in Path(path).parts) or Path(path).parts[:1] == ("api",) or not p.is_file():
            raise HTTPException(404, "not found")
        st = p.stat()
        use_gzip = "gzip" in request.headers.get("accept-encoding", "").lower() and p.suffix.lower() not in NO_GZIP
        etag = f'W/"{st.st_size:x}-{st.st_mtime_ns:x}{"-gz" if use_gzip else ""}"'
        headers = {"ETag": etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
        inm = request.headers.get("if-none-match")
        if inm and etag in [t.strip() for t in inm.split(",")]:
            return Response(status_code=304, headers=headers)
        ctype = CONTENT_TYPES.get(p.suffix.lower(), "application/geo+json" if p.suffix == ".geojson" else "application/octet-stream")
        if use_gzip:
            headers["Content-Encoding"] = "gzip"
            return Response(gz.get(p, st), media_type=ctype, headers=headers)
        return Response(p.read_bytes(), media_type=ctype, headers=headers)

    # ---- maps, model, satellite -------------------------------------------------------------------------------
    @app.get("/api/floods/{flood_id}/maps")
    def flood_maps(flood_id: str, kind: str = Query(..., pattern="^(rfc_fim|catfim|nfhl)$"), lid: str | None = None,
                   category: str | None = None, at_ms: int | None = None,
                   edge_case: str | None = Query(None, alias="edge")) -> Any:
        e = edge(edge_case)
        if e is not None:
            return e
        if flood_id == "fixture-flood" and kind == "catfim" and lid and category:
            obj = load(f"maps-catfim-{lid.upper()}-{category}.json")
            if obj is not None:
                return obj
        return per_flood(flood_id, f"maps-{kind}")

    @app.get("/api/floods/{flood_id}/model")
    def flood_model(flood_id: str, kind: str = Query(..., pattern="^(nwm_analysis|nwm_5day|nwm_high_flow|nwm_series)$"),
                    lid: str | None = None, edge_case: str | None = Query(None, alias="edge")) -> Any:
        e = edge(edge_case)
        if e is not None:
            return e
        check_id(flood_id)
        if not known(flood_id):
            raise HTTPException(404, "unknown flood")
        if flood_id == "fixture-flood":
            if kind == "nwm_series":
                if not lid:
                    raise HTTPException(422, "nwm_series needs lid=")
                obj = load(f"model-nwm_series-{lid.upper()}.json")
            else:
                obj = load(f"model-{kind}.json")
            if obj is not None:
                return obj
        base = load("model-nwm_analysis.json") or {}
        obj = {**base, "kind": kind, "status": "unavailable", "retrieved_ms": None, "reference_ms": None, "updated_ms": None,
               "reason": "Fixture server: no model output is canned for this demo flood.", "features": None,
               "series": None, "reach_id": None, "lid": lid, "flood_id": flood_id, "now_ms": now_ms()}
        return ModelOutputResponse.model_validate(obj).model_dump(mode="json")

    @app.get("/api/floods/{flood_id}/satellite")
    def flood_satellite(flood_id: str, at_ms: int | None = None, edge_case: str | None = Query(None, alias="edge")) -> Any:
        e = edge(edge_case)
        if e is not None:
            return e
        check_id(flood_id)
        if not known(flood_id):
            raise HTTPException(404, "unknown flood")
        if flood_id == "fixture-flood":
            obj = load("satellite.json")
            if obj is not None:
                return obj
        base = load("satellite.json") or {}
        obj = {**base, "status": "unavailable", "reason_code": "no_image", "measured": False, "granules": [],
               "reason": "Fixture server: no satellite image is canned for this demo flood.", "image": None,
               "tiles": None, "stats": None, "retrieved_ms": None, "flood_id": flood_id, "now_ms": now_ms(), "caveats": []}
        return SatelliteWaterResponse.model_validate(obj).model_dump(mode="json")

    @app.get("/api/floods/{flood_id}/satellite.png")
    def flood_satellite_png(flood_id: str, granule: str | None = None) -> Response:
        check_id(flood_id)
        p = floods_dir / flood_id / "satellite.png"
        if not p.is_file():
            raise HTTPException(404, "not found")
        return Response(p.read_bytes(), media_type="image/png", headers={"Cache-Control": "no-cache"})

    # ---- official: flood alerts and river gauges --------------------------------------------------------------
    def _alert_geoms(answer: dict) -> dict[str, list]:
        out: dict[str, list] = {}
        for a in answer.get("alerts") or []:
            if a.get("geometry"):
                out.setdefault(a["id"], []).append(shape(a["geometry"]))
        for f in (answer.get("zones") or {}).get("features") or []:
            for aid in (f.get("properties") or {}).get("alert_ids") or []:
                out.setdefault(aid, []).append(shape(f["geometry"]))
        return out

    def _alert_order(a: dict) -> tuple:
        v = a.get("vtec") or {}
        return (0 if a.get("emergency") else 1, _SIG_ORDER.get(v.get("significance"), 3), -(a.get("sent_ms") or 0))

    @app.get("/api/official/flood-alerts")
    def flood_alerts(flood: str | None = None, bbox: str | None = None, at_ms: int | None = None,
                     edge_case: str | None = Query(None, alias="edge")) -> Any:
        e = edge(edge_case)
        if e is not None:
            return e
        if flood:
            return per_flood(flood, "flood-alerts")
        area = _bbox_param(bbox)
        if area is None:
            raise HTTPException(422, "flood-alerts needs flood= or bbox=")
        abox = box(*area)
        is_point = (area[2] - area[0]) < 1e-6 and (area[3] - area[1]) < 1e-6
        here = Point(area[0], area[1])
        seen: dict[str, dict] = {}
        zones: dict[str, dict] = {}
        answers = matching("flood-alerts")
        template = None
        for ans in answers:
            if ans.get("source", {}).get("name", "").find("Iowa") >= 0:
                continue                                       # archived (past) answers are not "now" at a point
            template = template or ans
            geoms = _alert_geoms(ans)
            for a in ans.get("alerts") or []:
                gs = geoms.get(a["id"]) or []
                if not gs or a["id"] in seen or not any(g.intersects(abox) for g in gs):
                    continue
                seen[a["id"]] = {**a, "covers_point": any(g.covers(here) for g in gs) if is_point else None}
            for f in (ans.get("zones") or {}).get("features") or []:
                if any(aid in seen for aid in f["properties"]["alert_ids"]):
                    zones[f["properties"]["ugc"]] = f
        if template is None:
            raise HTTPException(404, "no canned flood alerts (run scripts/make_fixture.py --only flood)")
        from fire3d import regions
        obj = {**template, "flood_id": None, "now_ms": now_ms(), "alerts": sorted(seen.values(), key=_alert_order),
               "zones": {"type": "FeatureCollection", "features": list(zones.values())}, "area_bbox": list(area),
               "states_checked": regions.states_in_bbox(area), "caveats": []}
        return FloodAlertsResponse.model_validate(obj).model_dump(mode="json")

    def all_gauges() -> dict[str, dict]:
        out: dict[str, dict] = {}
        for ans in matching("river-gauges-"):
            for g in ans.get("gauges") or []:
                cur = out.get(g["lid"])
                if cur is None or ("series" in g and "series" not in cur):
                    out[g["lid"]] = g
        return out

    @app.get("/api/official/river-gauges")
    def river_gauges(flood: str | None = None, bbox: str | None = None, lid: str | None = None, scope: str | None = None,
                     min: str = Query("action", pattern="^(action|minor|moderate|major)$"),  # noqa: A002 - query name
                     series: int = 0, at_ms: int | None = None, edge_case: str | None = Query(None, alias="edge")) -> Any:
        e = edge(edge_case)
        if e is not None:
            return e
        strip = (lambda g: g) if series else (lambda g: {k: v for k, v in g.items() if k != "series"})
        if flood:
            obj = per_flood(flood, "river-gauges")
            if series:
                full = all_gauges()
                obj = {**obj, "gauges": [{**full.get(g["lid"], g), "member": g["member"]} for g in obj["gauges"]]}
            return obj
        if lid:
            obj = load(f"river-gauges-{lid.upper()}.json")
            if obj is None:
                g = all_gauges().get(lid.upper())
                if g is None:
                    raise HTTPException(404, "unknown gauge")
                base = load("river-gauges-national.json")
                obj = {**base, "gauges": [g], "area_bbox": [g["lon"], g["lat"], g["lon"], g["lat"]]}
            return {**obj, "gauges": [strip(g) for g in obj["gauges"]]}
        if scope == "national":
            obj = load("river-gauges-national.json")
            if obj is None:
                raise HTTPException(404, "no canned national gauges")
            lo = CATEGORY_ORDER.index(min)
            keep = [g for g in obj["gauges"] if g["observed"]["category"] in CATEGORY_ORDER[lo:]]
            return {**obj, "gauges": keep}
        area = _bbox_param(bbox)
        if area is None:
            raise HTTPException(422, "river-gauges needs flood=, bbox=, lid= or scope=national")
        cx, cy = (area[0] + area[2]) / 2, (area[1] + area[3]) / 2
        rows = [{**strip(g), "member": False} for g in all_gauges().values()
                if area[0] <= g["lon"] <= area[2] and area[1] <= g["lat"] <= area[3]]
        rows.sort(key=lambda g: (g["lon"] - cx) ** 2 + (g["lat"] - cy) ** 2)
        base = load("river-gauges-national.json")
        obj = {**base, "flood_id": None, "now_ms": now_ms(), "gauges": rows, "area_bbox": list(area)}
        return RiverGaugesResponse.model_validate(obj).model_dump(mode="json")

    # ---- hazard=flood local alerts and evacuations (canned for the fixture's area) ----------------------------------
    @app.get("/api/official/local-alerts")
    def local_alerts(bbox: str | None = None, incident: str | None = None, hazard: str = "fire",
                     at_ms: int | None = None) -> Any:
        if hazard != "flood":
            raise HTTPException(404, "the fixture server answers local alerts for hazard=flood only")
        obj = load("local-alerts.json")
        if obj is None:
            raise HTTPException(404, "not found")
        area = _bbox_param(bbox)
        obj = {**obj, "now_ms": now_ms(), "area_bbox": list(area) if area else obj.get("area_bbox")}
        return LocalAlertsResponse.model_validate(obj).model_dump(mode="json")

    @app.get("/api/extras/evacuations")
    def evacuations(bbox: str | None = None, incident: str | None = None, hazard: str = "fire",
                    at_ms: int | None = None) -> Any:
        if hazard != "flood":
            raise HTTPException(404, "the fixture server answers evacuations for hazard=flood only")
        obj = load("evacuations.json")
        if obj is None:
            raise HTTPException(404, "not found")
        area = _bbox_param(bbox)
        return {**obj, "now_ms": now_ms(), "bbox": list(area) if area else obj.get("bbox")}

    _ = (FloodDetailResponse, FloodMapResponse, shapely)   # imported for the validators used by the tests


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Disaster Mapping fixture server (SPEC 6 read endpoints from disk)")
    ap.add_argument("--port", type=int, default=8099)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--data-dir", type=Path, default=None, help="data dir containing incidents/ (default: FIRE3D_DATA_DIR or <repo>/data)")
    args = ap.parse_args(argv)
    data_dir = (args.data_dir or config.DATA_DIR).resolve()
    print(f"serving bundles from {data_dir / 'incidents'} and {data_dir / 'floods'} on http://{args.host}:{args.port}", flush=True)
    uvicorn.run(create_app(data_dir), host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
