"""Smoke test of the documented fixture server (``scripts/serve_fixture.py``, ``./dev.sh --fixture``).

Brief-3 integration review R2: the integration made ``LiveStatus.detections_24h`` and ``IncidentListResponse.sources``
required, and list rows have required ``bbox_lonlat`` since brief 2; the fixture server built both models without
them, so ``/api/incidents`` and ``/api/live/status`` answered 500. This test catches the next required-field change.
"""

from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fire3d import config
from fire3d.contracts import IncidentListResponse, LiveStatus

SCRIPT = config.REPO_ROOT / "backend" / "scripts" / "serve_fixture.py"


def _load_script():
    spec = importlib.util.spec_from_file_location("serve_fixture_under_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def client(tmp_path: Path, fixture_bundle: Path, fixture_live_bundle: Path) -> TestClient:
    """The fixture app over a temp data dir holding only the two synthetic bundles' manifests."""
    for src in (fixture_bundle, fixture_live_bundle):
        dst = tmp_path / "incidents" / src.name
        dst.mkdir(parents=True)
        shutil.copy(src / "manifest.json", dst / "manifest.json")
    return TestClient(_load_script().create_app(tmp_path))


def test_incident_lists_answer_with_the_required_fields(client: TestClient) -> None:
    for mode in ("historical", "live"):
        r = client.get("/api/incidents", params={"mode": mode})
        assert r.status_code == 200, r.text
        body = r.json()
        IncidentListResponse.model_validate(body)        # every required field is there
        assert body["incidents"], mode
        for row in body["incidents"]:
            assert row["bundle_status"] == "ready"
            bb = row["bbox_lonlat"]
            assert bb is not None and len(bb) == 4 and bb[0] < bb[2] and bb[1] < bb[3]
        # the fixture server never fetches the source lists: both say so in plain words
        assert {s["id"] for s in body["sources"]} == {"calfire", "wfigs"}
        assert all(s["status"] == "unavailable" and s["retrieved_ms"] is None and "Fixture server" in s["reason"] for s in body["sources"])


def test_historical_list_follows_the_year_asked(client: TestClient) -> None:
    demo_year = client.get("/api/incidents", params={"mode": "historical"}).json()["incidents"][0]["year"]
    same = client.get("/api/incidents", params={"mode": "historical", "year": demo_year}).json()
    other = client.get("/api/incidents", params={"mode": "historical", "year": demo_year - 7}).json()
    assert same["year"] == demo_year and len(same["incidents"]) == 1
    assert other["incidents"] == []


def test_live_status_answers_with_the_national_detection_count(client: TestClient) -> None:
    r = client.get("/api/live/status")
    assert r.status_code == 200, r.text
    body = r.json()
    LiveStatus.model_validate(body)
    assert body["active_incidents"] == 1
    assert body["detections_24h"] == body["detections_24h_ca"]


# ------------------------------------------------------------------------------------------------------------------
# Brief 5 (PLAN-5 7.2): every flood route of CONTRACT 16.7 answers contract-valid JSON from data/floods/*/api/
# ------------------------------------------------------------------------------------------------------------------
from fire3d import contracts as C  # noqa: E402


@pytest.fixture(scope="module")
def flood_client(flood_fixture_data: Path) -> TestClient:
    """The fixture app over the session's generated flood fixture (no fire bundles)."""
    return TestClient(_load_script().create_app(flood_fixture_data))


def _ok(client: TestClient, url: str, model: type, **params) -> dict:
    r = client.get(url, params=params)
    assert r.status_code == 200, (url, params, r.text[:300])
    body = r.json()
    assert C.contract_problems(model, body) == [], (url, params, C.contract_problems(model, body)[:5])
    return body


def test_flood_lists_status_and_details(flood_client: TestClient) -> None:
    live = _ok(flood_client, "/api/floods", C.FloodListResponse)
    assert live["mode"] == "live" and live["floods"][0]["id"] == "fixture-flood-flash"
    past = _ok(flood_client, "/api/floods", C.FloodListResponse, mode="historical", year=2025)
    assert [r["id"] for r in past["floods"]] == ["fixture-flood-past"]
    other = _ok(flood_client, "/api/floods", C.FloodListResponse, mode="historical", year=2019)
    assert other["floods"] == [] and other["sources"][0]["status"] == "unavailable"
    _ok(flood_client, "/api/floods/status", C.FloodLiveStatus)
    d = _ok(flood_client, "/api/floods/fixture-flood", C.FloodDetailResponse)
    assert d["manifest"]["id"] == "fixture-flood" and d["summary"]["synthetic"] is True
    for fid in ("fixture-flood-flash", "fixture-flood-watch", "fixture-flood-past"):
        assert _ok(flood_client, f"/api/floods/{fid}", C.FloodDetailResponse)["manifest"] is None
    assert flood_client.get("/api/floods/flood-20261104-nowhere-flood-abcdef").status_code == 404
    assert flood_client.get("/api/floods/..%2Fetc").status_code == 404
    for case, model in (("nws_down", C.FloodListResponse), ("both_down", C.FloodListResponse), ("empty", C.FloodListResponse)):
        body = _ok(flood_client, "/api/floods", model, edge=case)
        assert body["floods"] == [] or any(s["status"] == "unavailable" for s in body["sources"]) or case == "empty"
    assert _ok(flood_client, "/api/floods/fixture-flood", C.FloodDetailResponse, edge="last_known")["resolved_from"] == "last_known"


def test_flood_build_job_and_files(flood_client: TestClient) -> None:
    assert flood_client.post("/api/floods/fixture-flood/build").status_code == 409
    r = flood_client.post("/api/floods/fixture-flood-major/build")
    assert r.status_code == 200
    job = r.json()
    assert C.contract_problems(C.JobStatus, job) == [] and job["incident_id"] == "fixture-flood-major" and job["kind"] == "build"
    again = flood_client.get(f"/api/jobs/{job['id']}").json()
    assert again["status"] in ("queued", "running", "done")
    assert flood_client.get("/api/floods/fixture-flood-major").json()["job"]["id"] == job["id"]
    assert flood_client.post("/api/floods/fixture-flood-nope/build").status_code == 404
    f = flood_client.get("/api/floods/fixture-flood/files/manifest.json")
    assert f.status_code == 200 and f.headers["etag"] and f.headers["cache-control"] == "no-cache"
    assert flood_client.get("/api/floods/fixture-flood/files/layers/elevation.bin", headers={"accept-encoding": "gzip"}).status_code == 200
    assert flood_client.get("/api/floods/fixture-flood/files/maps/rfc_fim.geojson").json()["type"] == "FeatureCollection"
    assert flood_client.get("/api/floods/fixture-flood/files/../../etc/passwd").status_code == 404
    png = flood_client.get("/api/floods/fixture-flood/satellite.png", params={"granule": "x"})
    assert png.status_code == 200 and png.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_flood_maps_model_and_satellite(flood_client: TestClient) -> None:
    for kind in ("rfc_fim", "catfim", "nfhl"):
        _ok(flood_client, "/api/floods/fixture-flood/maps", C.FloodMapResponse, kind=kind)
        _ok(flood_client, "/api/floods/fixture-flood-major/maps", C.FloodMapResponse, kind=kind)
        assert _ok(flood_client, "/api/floods/fixture-flood/maps", C.FloodMapResponse, kind=kind, edge=kind)["status"] == "unavailable"
    major = _ok(flood_client, "/api/floods/fixture-flood/maps", C.FloodMapResponse, kind="catfim", lid="ZZRF1", category="major")
    assert major["category"] == "major"
    for kind in ("nwm_analysis", "nwm_5day", "nwm_high_flow"):
        assert _ok(flood_client, "/api/floods/fixture-flood/model", C.ModelOutputResponse, kind=kind)["model_output"] is True
    s = _ok(flood_client, "/api/floods/fixture-flood/model", C.ModelOutputResponse, kind="nwm_series", lid="ZZRF1")
    assert s["series"] and s["reach_id"]
    assert _ok(flood_client, "/api/floods/fixture-flood-major/model", C.ModelOutputResponse, kind="nwm_analysis")["status"] == "unavailable"
    assert flood_client.get("/api/floods/fixture-flood/model", params={"kind": "nwm_series"}).status_code == 422
    sat = _ok(flood_client, "/api/floods/fixture-flood/satellite", C.SatelliteWaterResponse)
    assert sat["measured"] and sat["image"]["url"].startswith("/api/floods/fixture-flood/satellite.png")
    for case in ("satellite", "satellite_refused", "satellite_picture"):
        _ok(flood_client, "/api/floods/fixture-flood/satellite", C.SatelliteWaterResponse, edge=case)
    assert _ok(flood_client, "/api/floods/fixture-flood-watch/satellite", C.SatelliteWaterResponse)["status"] == "unavailable"


def test_flood_official_answers(flood_client: TestClient) -> None:
    a = _ok(flood_client, "/api/official/flood-alerts", C.FloodAlertsResponse, flood="fixture-flood")
    assert len(a["alerts"]) == 3
    assert _ok(flood_client, "/api/official/flood-alerts", C.FloodAlertsResponse, flood="fixture-flood", edge="alerts")["status"] == "unavailable"
    assert flood_client.get("/api/official/flood-alerts").status_code == 422
    # a point inside the Flood Warning polygon: covers_point, and every product there (watches included, C27)
    flw = next(x for x in a["alerts"] if x["event"] == "Flood Warning")
    from shapely.geometry import shape

    pt = shape(flw["geometry"]).representative_point()
    here = _ok(flood_client, "/api/official/flood-alerts", C.FloodAlertsResponse, bbox=f"{pt.x},{pt.y},{pt.x},{pt.y}")
    events = {x["event"]: x["covers_point"] for x in here["alerts"]}
    assert events.get("Flood Warning") is True and "Flood Watch" in events
    assert here["flood_id"] is None and here["states_checked"] == ["NM"]
    nowhere = _ok(flood_client, "/api/official/flood-alerts", C.FloodAlertsResponse, bbox="-100.0,45.0,-100.0,45.0")
    assert nowhere["alerts"] == [] and nowhere["status"] == "available"
    g = _ok(flood_client, "/api/official/river-gauges", C.RiverGaugesResponse, flood="fixture-flood")
    assert [x["lid"] for x in g["gauges"]] == ["ZZRF1", "ZZRF2", "ZZRF3", "ZZRF4"] and "series" not in g["gauges"][0]
    gs = _ok(flood_client, "/api/official/river-gauges", C.RiverGaugesResponse, flood="fixture-flood", series=1)
    assert gs["gauges"][0]["series"]["observed"] and gs["gauges"][0]["member"] is True
    one = _ok(flood_client, "/api/official/river-gauges", C.RiverGaugesResponse, lid="ZZRF2", series=1)
    assert one["gauges"][0]["forecast"]["crest_at_end"] is True and one["gauges"][0]["series"]["forecast"]
    nat = _ok(flood_client, "/api/official/river-gauges", C.RiverGaugesResponse, scope="national", min="minor")
    assert nat["gauges"] and all(x["observed"]["category"] in ("minor", "moderate", "major") for x in nat["gauges"])
    w, s_, e, n = g["area_bbox"]
    box = _ok(flood_client, "/api/official/river-gauges", C.RiverGaugesResponse, bbox=f"{w},{s_},{e},{n}")
    assert box["gauges"] and all(x["member"] is False for x in box["gauges"])
    assert flood_client.get("/api/official/river-gauges").status_code == 422
    assert _ok(flood_client, "/api/official/river-gauges", C.RiverGaugesResponse, flood="fixture-flood", edge="gauges")["status"] == "unavailable"
    la = _ok(flood_client, "/api/official/local-alerts", C.LocalAlertsResponse, bbox=f"{w},{s_},{e},{n}", hazard="flood")
    assert la["status"] == "unavailable"
    ev = flood_client.get("/api/extras/evacuations", params={"bbox": f"{w},{s_},{e},{n}", "hazard": "flood"})
    assert ev.status_code == 200 and ev.json()["kind"] == "evacuations"
    assert flood_client.get("/api/extras/evacuations", params={"bbox": f"{w},{s_},{e},{n}"}).status_code == 404   # fire: as before
