"""Flood bundle and per-flood routes of ``api/floods.py`` (CONTRACT 16.7; backend-flood-bundle-api M2/M3): build
(job, gate), bundle files (gzip, ETag, traversal), and ``fixture-flood`` served from its bundle by the real API.
Isolated (PLAN-5 section 8): temp FLOODS_DIR / CACHE_DIR with ``fixture-flood`` copied from the session fixture,
caches cleared, recorded answers instead of the network."""

from __future__ import annotations

import gzip
import shutil
import time
import warnings
from pathlib import Path

import httpx
import pytest

import fire3d.http as fhttp
from fire3d import config
from fire3d import contracts as C
from fire3d.api import app as app_mod
from fire3d.api.jobs import JobManager, set_manager
from fire3d.floods import catalog, store
from fire3d.floods import copy as fcopy
from fire3d.sources import imagery, terrain

from conftest import route_transport
from test_floods_build import _routes

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from fastapi.testclient import TestClient


@pytest.fixture
def client(flood_iso: Path, flood_fixture_bundle: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "LIVE_ENABLED", False)
    shutil.copytree(flood_fixture_bundle, Path(config.FLOODS_DIR) / "fixture-flood")
    m = JobManager()
    set_manager(m)
    with TestClient(app_mod.app) as c:
        yield c
    m.shutdown()
    set_manager(None)


def _ok(r, model):
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert C.contract_problems(model, body) == [], C.contract_problems(model, body)[:5]
    return body


# ---------------------------------------------------------------------------------------------------------------
# fixture-flood from its bundle; build gate
# ---------------------------------------------------------------------------------------------------------------
def test_fixture_flood_detail_and_build_409(client):
    body = _ok(client.get("/api/floods/fixture-flood"), C.FloodDetailResponse)
    assert body["resolved_from"] == "live" and body["summary"]["synthetic"] and body["manifest"]["status"] == "ready"
    assert body["summary"]["bundle_status"] == "ready"
    r = client.post("/api/floods/fixture-flood/build")
    assert r.status_code == 409 and r.json()["detail"] == fcopy.BUILD_SYNTHETIC
    assert client.post("/api/floods/fixture-flood-major/build").status_code == 404
    assert client.post("/api/floods/not-a-flood/build").status_code == 404


def test_files_gzip_etag_and_traversal(client):
    r = client.get("/api/floods/fixture-flood/files/manifest.json", headers={"accept-encoding": "gzip"})
    assert r.status_code == 200 and r.headers["content-encoding"] == "gzip" and r.headers["cache-control"] == "no-cache"
    assert r.json()["id"] == "fixture-flood"
    etag = r.headers["etag"]
    assert client.get("/api/floods/fixture-flood/files/manifest.json", headers={"accept-encoding": "gzip",
                                                                                 "if-none-match": etag}).status_code == 304
    r = client.get("/api/floods/fixture-flood/files/layers/elevation.bin", headers={"accept-encoding": "identity"})
    assert r.status_code == 200 and len(r.content) == 1024 * 1024 * 4 and "content-encoding" not in r.headers
    png = client.get("/api/floods/fixture-flood/files/satellite.png", headers={"accept-encoding": "gzip"})
    assert png.headers["content-type"] == "image/png" and "content-encoding" not in png.headers
    geo = client.get("/api/floods/fixture-flood/files/maps/rfc_fim.geojson")
    assert geo.headers["content-type"].startswith("application/geo+json") and geo.json()["type"] == "FeatureCollection"
    for bad in ("../registry.jsonl", "..%2Fregistry.jsonl", "/etc/passwd", ".build.lock", "api/list.json", "layers",
                "layers/../../fixture-flood/manifest.json/../x", "nope.json"):
        assert client.get(f"/api/floods/fixture-flood/files/{bad}").status_code == 404, bad
    assert client.get("/api/floods/..%2F..%2Fetc/files/passwd").status_code == 404


# ---------------------------------------------------------------------------------------------------------------
# A real (recorded) flood built through the route
# ---------------------------------------------------------------------------------------------------------------
@pytest.fixture
def recorded_client(client, monkeypatch, no_backoff):
    from conftest import recorded_flood_inputs
    from fire3d.sources.terrain import FetchInfo, RasterFetchError
    import numpy as np

    monkeypatch.setattr(config, "EARTHDATA_TOKEN", None)
    inp, now = recorded_flood_inputs()
    monkeypatch.setattr(catalog, "fetch_inputs", lambda: inp)
    monkeypatch.setattr(catalog, "now_ms", lambda: now)
    monkeypatch.setattr(terrain, "fetch_dem_info", lambda grid: (np.full(grid.shape, 250.0, np.float32),
                                                                 FetchInfo("https://3dep.test", now, False, 0.1), 0))

    def no_naip(grid, max_px=2048):
        raise RasterFetchError("NAIP: no imagery")

    monkeypatch.setattr(imagery, "fetch_naip_info", no_naip)
    monkeypatch.setattr(fhttp, "_transport", route_transport(_routes()))
    lst = catalog.flood_list()
    fid = next(s["id"] for s in lst["floods"] if (s["primary_gauge"] or {}).get("lid") == "AGYM7")
    client.fid = fid  # type: ignore[attr-defined]
    return client


def _wait(client, job_id: str, timeout_s: float = 60.0) -> dict:
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout_s:
        st = client.get(f"/api/jobs/{job_id}").json()
        if st["status"] in ("done", "error"):
            return st
        time.sleep(0.1)
    raise AssertionError("the build did not finish")


def test_build_route_job_and_bundle_state(recorded_client):
    c = recorded_client
    fid = c.fid
    before = _ok(c.get(f"/api/floods/{fid}"), C.FloodDetailResponse)
    assert before["summary"]["bundle_status"] == "none" and before["manifest"] is None
    st = _ok(c.post(f"/api/floods/{fid}/build"), C.JobStatus)
    assert st["kind"] == "build" and st["incident_id"] == fid
    again = c.post(f"/api/floods/{fid}/build").json()
    assert again["id"] == st["id"] or again["status"] in ("done", "running", "queued")
    done = _wait(c, st["id"])
    assert done["status"] == "done", done.get("error")
    after = _ok(c.get(f"/api/floods/{fid}"), C.FloodDetailResponse)
    assert after["manifest"]["status"] == "ready" and after["summary"]["bundle_status"] == "ready"
    assert after["job"]["id"] == st["id"]
    row = next(s for s in c.get("/api/floods").json()["floods"] if s["id"] == fid)
    assert row["bundle_status"] == "ready" and row["bundle_built_ms"]           # not stuck at the cached "none"
    r = c.get(f"/api/floods/{fid}/files/layers/water_satellite.bin")
    assert r.status_code == 200 and len(r.content) == 1024 * 1024
    # a second build without force answers at once from the ready bundle
    st2 = c.post(f"/api/floods/{fid}/build").json()
    assert _wait(c, st2["id"])["status"] == "done"
    assert store.load_flood_manifest(fid)["built_ms"] == after["manifest"]["built_ms"]


def test_build_route_outside_lower48_is_409(recorded_client, monkeypatch):
    c = recorded_client
    s, _ = catalog.resolve(c.fid)
    monkeypatch.setattr(catalog, "resolve", lambda fid: ({**s, "state": "PR"}, "live"))
    r = c.post(f"/api/floods/{c.fid}/build")
    assert r.status_code == 409 and r.json()["detail"] == fcopy.BUILD_OUTSIDE_L48


_ = (gzip, httpx)
