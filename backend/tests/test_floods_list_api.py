"""Flood routes of ``api/floods.py`` (CONTRACT 16.7; backend-flood-sources M4): the live list, status, and the detail
chain of PLAN-5 3.2 rule 13 (live -> alias -> bundle -> last-known -> 404; 503 when the lists could not decide).
Isolated from the developer's ``data/`` (PLAN-5 section 8): temp FLOODS_DIR / CACHE_DIR, every cache cleared, the
recorded answers of 2026-11-04 instead of the network."""

from __future__ import annotations

import os
import shutil
import warnings
from pathlib import Path

import orjson
import pytest
from conftest import recorded_flood_inputs

from fire3d import config
from fire3d import contracts as C
from fire3d.api import app as app_mod
from fire3d.api.jobs import JobManager, set_manager
from fire3d.floods import catalog as cat
from fire3d.floods import copy as fcopy
from fire3d.floods import registry as reg_mod

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from fastapi.testclient import TestClient

H = 3_600_000


@pytest.fixture
def client(flood_iso: Path, monkeypatch: pytest.MonkeyPatch):
    inp, now = recorded_flood_inputs()
    monkeypatch.setattr(config, "LIVE_ENABLED", False)
    monkeypatch.setattr(cat, "fetch_inputs", lambda: inp)
    monkeypatch.setattr(cat, "now_ms", lambda: now)
    m = JobManager()
    set_manager(m)
    with TestClient(app_mod.app) as c:
        c.now = now  # type: ignore[attr-defined]
        c.inp = inp  # type: ignore[attr-defined]
        yield c
    m.shutdown()
    set_manager(None)


def _ok(r, model):
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert C.contract_problems(model, body) == [], C.contract_problems(model, body)[:5]
    return body


def test_live_list_status_and_gzip(client: TestClient) -> None:
    body = _ok(client.get("/api/floods"), C.FloodListResponse)
    assert body["hazard"] == "flood" and body["mode"] == "live" and len(body["floods"]) >= 30
    assert {s["id"] for s in body["sources"]} == {"nws_alerts", "nwps_gauges", "rfc_forecasts", "iem_archive"}
    iem = {s["id"]: s for s in body["sources"]}["iem_archive"]                         # the H-VTEC join (BFS-R10)
    assert iem["name"] == fcopy.IEM_JOIN_NAME and iem["status"] == "available"
    raw = client.get("/api/floods", headers={"accept-encoding": "gzip"})
    assert "Accept-Encoding" in raw.headers.get("vary", "") and orjson.loads(raw.content) == body
    st = _ok(client.get("/api/floods/status"), C.FloodLiveStatus)
    assert st["active_floods"] == sum(1 for s in body["floods"] if s["status"] == "active") and st["auto_build"] is False
    past = _ok(client.get("/api/floods", params={"mode": "historical", "year": 2025}), C.FloodListResponse)
    assert past["floods"] == [] and past["year"] == 2025 and past["sources"][0]["reason"] == cat.PAST_NOT_YET
    assert client.get("/api/floods", params={"mode": "weird"}).status_code == 422


def test_detail_live_and_alias(client: TestClient) -> None:
    lst = client.get("/api/floods").json()
    s0 = lst["floods"][0]
    d = _ok(client.get(f"/api/floods/{s0['id']}"), C.FloodDetailResponse)
    assert d["resolved_from"] == "live" and d["summary"]["id"] == s0["id"] and d["manifest"] is None and d["job"] is None
    old = "flood-20261101-old-name-flood-abcdef"
    reg_mod.get_registry().write(aliases=[(old, s0["id"])])          # an older id merged into this flood
    a = _ok(client.get(f"/api/floods/{old}"), C.FloodDetailResponse)
    assert a["resolved_from"] == "alias" and a["summary"]["id"] == s0["id"]      # the canonical summary


def test_detail_bundle_last_known_and_404(client: TestClient, flood_fixture_bundle: Path) -> None:
    # the synthetic fixture bundle answers from its frozen summary (never listed by the real API)
    shutil.copytree(flood_fixture_bundle, config.FLOODS_DIR / "fixture-flood")
    fx = _ok(client.get("/api/floods/fixture-flood"), C.FloodDetailResponse)
    assert fx["summary"]["synthetic"] is True and fx["manifest"]["id"] == "fixture-flood" and fx["resolved_from"] == "live"
    assert all(s["id"] != "fixture-flood" for s in client.get("/api/floods").json()["floods"])
    assert client.get("/api/floods/fixture-flood-major").status_code == 404           # fixture server only
    # a real bundle whose flood left the lists: its frozen summary (resolved_from "bundle")
    bid = "flood-20261020-ridge-fork-river-flood-123456"
    b = config.FLOODS_DIR / bid
    shutil.copytree(flood_fixture_bundle, b, ignore=shutil.ignore_patterns("api"))
    m = orjson.loads((b / "manifest.json").read_bytes())
    m["id"] = bid
    m["summary"] = {**m["summary"], "id": bid, "synthetic": False}
    (b / "manifest.json").write_bytes(orjson.dumps(m))
    got = _ok(client.get(f"/api/floods/{bid}"), C.FloodDetailResponse)
    assert got["resolved_from"] == "bundle" and got["summary"]["bundle_status"] == "ready" and got["manifest"]["id"] == bid
    # an id last seen 72 h ago (no longer listed as inactive): its last-known summary, its products "ended" now that
    # NWS answered without them (BFS-R1: never "in_effect" with a future end beside an inactive status)
    live1 = next(x for x in client.get("/api/floods").json()["floods"] if x["products"])
    gone = [{**p, "id": f"gone-{i}", "vtec_key": f"KZZZ.FL.W.{9000 + i}.2026", "phase": "in_effect",
             "ends_ms": client.now + 9 * H} for i, p in enumerate(live1["products"])]  # type: ignore[attr-defined]
    s = {**live1, "id": "flood-20261030-gone-river-flood-0a0b0c", "products": gone, "status": "active"}
    reg_mod.write_last_known(s, client.now - 72 * H)  # type: ignore[attr-defined]
    lk = _ok(client.get(f"/api/floods/{s['id']}"), C.FloodDetailResponse)
    assert lk["resolved_from"] == "last_known" and lk["summary"]["status"] == "inactive"
    assert {p["phase"] for p in lk["summary"]["products"]} == {"ended"} and lk["summary"]["expires_ms"] is None
    # a stand-in sharing a product NWS still lists shows that product's phase now, never a false "ended"
    shared = {**live1, "id": "flood-20261030-shared-river-flood-0d0e0f"}
    reg_mod.write_last_known(shared, client.now - 72 * H)  # type: ignore[attr-defined]
    sh = _ok(client.get(f"/api/floods/{shared['id']}"), C.FloodDetailResponse)["summary"]
    assert [p["phase"] for p in sh["products"]] == [p["phase"] for p in live1["products"]]
    assert client.get("/api/floods/flood-20261104-never-seen-flood-ffffff").status_code == 404
    assert client.get("/api/floods/2025-eaton-fire-dbfa57").status_code == 404        # a fire id is never a flood


def test_an_id_left_the_list_48_h_ago_still_resolves(client: TestClient) -> None:
    first = client.get("/api/floods").json()["floods"]
    target = next(s for s in first if s["level"] == "gauge_only")
    cat.reset_state()
    obs = client.inp.observed  # type: ignore[attr-defined]
    obs.data = [r for r in obs.data if r["lid"] != target["primary_gauge"]["lid"]]     # its gauge fell below action
    lst = cat.flood_list(refresh=True)
    carried = {s["id"]: s for s in lst["floods"]}[target["id"]]
    assert carried["status"] == "inactive"                                             # still listed (rule 8)
    d = _ok(client.get(f"/api/floods/{target['id']}"), C.FloodDetailResponse)
    assert d["resolved_from"] == "live" and d["summary"]["status"] == "inactive"
    p = config.FLOODS_DIR / "last_known" / f"{target['id']}.json"
    t = (client.now - 50 * H) / 1000  # type: ignore[attr-defined]
    os.utime(p, (t, t))
    cat.reset_state()
    d2 = _ok(client.get(f"/api/floods/{target['id']}"), C.FloodDetailResponse)
    assert d2["resolved_from"] == "last_known"                                         # 50 h later: off the list


def test_503_only_when_the_lists_could_not_decide(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Both lists down: GET /api/floods stays a 200 whose sources say why (FLOOD_LISTS_DOWN; a deliberate deviation of
    CONTRACT 16.7's 503, recorded in contract5/backend-flood-sources.md, review BFS-R6); a detail the lists cannot
    decide answers 503 FLOOD_LISTS_503."""
    down = cat.Inputs(*(cat.SourceResult(None, None, error="down") for _ in range(5)))
    monkeypatch.setattr(cat, "fetch_inputs", lambda: down)
    cat.reset_state()
    body = _ok(client.get("/api/floods"), C.FloodListResponse)
    assert body["floods"] == [] and body["products_in_effect"] is None
    assert all(s["status"] == "unavailable" and s["reason"] == fcopy.FLOOD_LISTS_DOWN for s in body["sources"][:2])
    r = client.get("/api/floods/flood-20261104-never-seen-flood-ffffff")
    assert r.status_code == 503 and r.json()["detail"] == fcopy.FLOOD_LISTS_503
    st = _ok(client.get("/api/floods/status"), C.FloodLiveStatus)
    assert st["active_floods"] is None and st["gauges_in_flood"] is None                # never 0 for unknown


def test_fire_routes_are_unchanged_for_flood_ids(client: TestClient) -> None:
    fid = client.get("/api/floods").json()["floods"][0]["id"]
    assert client.get(f"/api/incidents/{fid}").status_code == 404
    for path in ("/api/floods", "/api/floods/status", f"/api/floods/{fid}"):
        assert client.get(path).status_code == 200, path                               # mounted by api/app.py
    assert client.get("/api/health").json()["ok"] is True
