"""The flood live refresh (brief 5, backend-flood-live M1; PLAN-5 3.5, CONTRACT 16.2 / 16.8, SPEC 8.9).

Offline: the recorded lists of 2026-11-04 (``recorded_flood_inputs``) and the recorded Platte River flood bundle
(``test_floods_build.recorded_flood``: every upstream mocked). Covers the second task in the lifespan (off with
FIRE3D_FLOODS=0; a flood failure never stops the fire loop), ``/api/floods/status`` from the loop (counts null when the
lists fail), the background prefetch budget (<= 20 requests, NWS calls on NWS_LIMITER), appending product versions and
gauge readings to a ready bundle, refresh jobs, auto-build of the 4 most severe floods, ``check_bundle --hazard flood``
and the CLI commands."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import httpx
import orjson
import pytest
from fastapi.testclient import TestClient

import fire3d.http as fhttp
from fire3d import config
from fire3d.api import live as fire_live
from fire3d.api.jobs import JobManager
from fire3d.contracts import FloodAlertsResponse, FloodManifest, RiverGaugesResponse, validate_strict
from fire3d.floods import build, catalog, store
from fire3d.floods import copy as fcopy
from fire3d.floods import copy_time as tcopy
from fire3d.floods import live as flood_live
from fire3d.sources import nws, nwps, opera
from fire3d.timeutil import HOUR_MS

from conftest import load_script, recorded_flood_inputs, route_transport
from test_floods_build import NWS, _routes, recorded_flood  # noqa: F401 - the fixture is used by name

PLATTE = "flood-20261103-platte-river-flood-e045bf"


@pytest.fixture(autouse=True)
def _fresh_state():
    flood_live.reset_state()
    yield
    flood_live.reset_state()


@pytest.fixture
def jm():
    m = JobManager()
    yield m
    m.shutdown()
    assert m.drain(60), "background jobs still running after the test"


@pytest.fixture
def recorded_list(flood_iso):
    inp, now = recorded_flood_inputs()
    return catalog.build_list(inp, now), now


# ---------------------------------------------------------------------------------------------------------------
# Status and counts
# ---------------------------------------------------------------------------------------------------------------
def test_counts_null_when_the_lists_could_not_decide(recorded_list):
    lst, _ = recorded_list
    active = [s for s in lst["floods"] if s["status"] == "active"]
    assert flood_live.list_counts(lst) == (len(active), sum(s["gauges_in_flood"] for s in active))
    assert flood_live.list_counts({**lst, "_decided": False}) == (None, None)
    assert flood_live.list_counts({**lst, "_nws_ok": False}) == (None, None)
    assert flood_live.list_counts({**lst, "_gauges_ok": False}) == (None, None)


def test_status_from_the_list_without_the_loop(monkeypatch):
    monkeypatch.setattr(config, "AUTO_BUILD_FLOODS", True)
    monkeypatch.setattr(catalog, "live_status", lambda: {"last_refresh_ms": 1, "next_refresh_ms": 2, "active_floods": 3,
                                                         "gauges_in_flood": 4, "auto_build": True})
    st = flood_live.live_status()
    assert st == {"last_refresh_ms": 1, "next_refresh_ms": 2, "active_floods": 3, "gauges_in_flood": 4,
                  "auto_build": False}                         # nothing auto-builds without the loop
    flood_live.STATE.running = True                            # the loop runs but has not finished a cycle
    assert flood_live.live_status()["auto_build"] is True and flood_live.live_status()["active_floods"] == 3
    flood_live.STATE.last_refresh_ms, flood_live.STATE.next_refresh_ms = 100, 200
    flood_live.STATE.active_floods, flood_live.STATE.gauges_in_flood = None, None
    assert flood_live.live_status() == {"last_refresh_ms": 100, "next_refresh_ms": 200, "active_floods": None,
                                        "gauges_in_flood": None, "auto_build": True}


def test_status_route_answers_from_the_loop(flood_iso):
    from fire3d.api.app import app

    flood_live.STATE.running = True
    flood_live.STATE.last_refresh_ms, flood_live.STATE.next_refresh_ms = 1_700_000_000_000, 1_700_000_900_000
    flood_live.STATE.active_floods, flood_live.STATE.gauges_in_flood = None, None
    r = TestClient(app).get("/api/floods/status")                # no lifespan: nothing else starts
    assert r.status_code == 200
    assert r.json() == {"last_refresh_ms": 1_700_000_000_000, "next_refresh_ms": 1_700_000_900_000,
                        "active_floods": None, "gauges_in_flood": None, "auto_build": bool(config.AUTO_BUILD_FLOODS)}


# ---------------------------------------------------------------------------------------------------------------
# The loop: cycles, failures, auto-build; two tasks in the lifespan
# ---------------------------------------------------------------------------------------------------------------
def test_loop_cycles_survive_failures_and_auto_build_once(recorded_list, jm, monkeypatch):
    lst, now = recorded_list
    monkeypatch.setattr(config, "AUTO_BUILD_FLOODS", True)
    monkeypatch.setattr(flood_live, "AUTO_BUILD_POLL_S", 0.02)
    cycles = {"n": 0}

    def flood_list(refresh=False):
        cycles["n"] += 1
        if cycles["n"] == 2:
            raise RuntimeError("NWS answered garbage for a moment")
        return {**lst, "_decided": True}

    monkeypatch.setattr(catalog, "flood_list", flood_list)
    monkeypatch.setattr(flood_live, "prefetch", lambda lst, **kw: {"hvtec": 0, "zones": 0, "series": 0})
    monkeypatch.setattr(flood_live, "refresh_bundles", lambda lst, jobs, **kw: ([], []))
    warmed = {"n": 0}
    monkeypatch.setattr(flood_live, "warm_year_lists", lambda: warmed.__setitem__("n", warmed["n"] + 1))
    built: list[str] = []

    def fake_build(fid, *, progress=None, force=False, now=None):
        built.append(fid)
        d = store.flood_dir(fid)
        d.mkdir(parents=True, exist_ok=True)
        (d / "manifest.json").write_text(json.dumps({"hazard": "flood", "id": fid, "status": "ready", "built_ms": 1,
                                                     "warnings": []}))
        return {"built_ms": 1, "status": "ready", "warnings": []}

    monkeypatch.setattr(build, "build_flood", fake_build)
    monkeypatch.setattr(build, "gate", lambda fid: ({}, "live"))
    seen: dict[str, object] = {}

    async def main():
        task = asyncio.create_task(flood_live.flood_refresh_loop(jm, interval_s=0.05))
        deadline = time.time() + 20
        while time.time() < deadline:
            await asyncio.sleep(0.02)
            if cycles["n"] == 2 and "failed" not in seen and flood_live.STATE.last_error:
                seen["failed"] = (flood_live.STATE.active_floods, flood_live.STATE.gauges_in_flood)
            if cycles["n"] >= 4 and len(built) == 4 and flood_live.STATE.active_floods is not None:
                break
        st = flood_live.live_status()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return st

    st = asyncio.run(main())
    expect = flood_live.auto_build_candidates(lst["floods"])
    assert len(expect) == 4 and built == expect == flood_live.STATE.auto_build_ids     # once, in rank order
    assert seen["failed"] == (None, None)                     # a failed cycle: unknown, never 0
    assert st["active_floods"] == flood_live.list_counts(lst)[0] and st["auto_build"] is True
    assert flood_live.STATE.running is False and flood_live.live_status()["auto_build"] is False
    assert warmed["n"] >= 3                                   # every good cycle asks for the past years (no-op once built)


def test_auto_build_candidates_are_the_most_severe_real_floods(recorded_list):
    lst, _ = recorded_list
    rows = lst["floods"]
    cands = flood_live.auto_build_candidates(rows)
    by_id = {s["id"]: s for s in rows}
    assert len(cands) == flood_live.AUTO_BUILD_FLOODS_N
    ok = [s["id"] for s in rows if s["status"] == "active" and s["level"] != "watch"
          and s.get("caveat") != fcopy.GAUGE_ONLY_COASTAL_CAVEAT]
    assert cands == ok[:4]                                    # floodRank order (the list's)
    assert all(by_id[i]["level"] != "watch" for i in cands)
    # floods with a bundle count among the 4 but are not built again
    marked = [{**s, "bundle_status": "ready"} if s["id"] == cands[0] else s for s in rows]
    assert flood_live.auto_build_candidates(marked) == cands[1:]
    # watches, tide gauges, synthetic and inactive floods never
    fake = [{**rows[0], "id": "a", "level": "watch"}, {**rows[0], "id": "b", "synthetic": True},
            {**rows[0], "id": "c", "status": "inactive"}, {**rows[0], "id": "d", "caveat": fcopy.GAUGE_ONLY_COASTAL_CAVEAT},
            {**rows[0], "id": "e", "state": "PR"}, {**rows[0], "id": "f"}]
    assert flood_live.auto_build_candidates(fake) == ["f"]


def test_auto_build_skips_refused_and_ready_floods(flood_iso, jm, monkeypatch):
    calls: list[str] = []

    def gate(fid):
        if fid == "flood-20261104-x-flood-aaaaaa":
            raise build.BuildRefused(409, fcopy.BUILD_OUTSIDE_L48)
        return {}, "live"

    def fake_build(fid, *, progress=None, force=False, now=None):
        calls.append(fid)
        return {"built_ms": 1, "status": "ready", "warnings": []}

    monkeypatch.setattr(build, "gate", gate)
    monkeypatch.setattr(build, "build_flood", fake_build)
    monkeypatch.setattr(flood_live, "AUTO_BUILD_POLL_S", 0.02)
    asyncio.run(flood_live.auto_build(jm, ["flood-20261104-x-flood-aaaaaa", "flood-20261104-y-flood-bbbbbb"]))
    assert calls == ["flood-20261104-y-flood-bbbbbb"]


def _lifespan_tasks(monkeypatch, *, floods: bool, flood_loop=None):
    started: list[str] = []
    fire_ticks = {"n": 0}

    async def fake_fire(jobs=None, interval_s=None):
        started.append("fire")
        while True:
            fire_ticks["n"] += 1
            await asyncio.sleep(0.01)

    async def fake_flood(jobs=None, interval_s=None):
        started.append("flood")
        while True:
            await asyncio.sleep(0.01)

    monkeypatch.setattr(config, "LIVE_ENABLED", True)
    monkeypatch.setattr(config, "FLOODS_ENABLED", floods)
    monkeypatch.setattr(fire_live, "live_refresh_loop", fake_fire)
    monkeypatch.setattr(flood_live, "flood_refresh_loop", flood_loop or fake_flood)
    return started, fire_ticks


def test_lifespan_starts_two_tasks(flood_iso, monkeypatch):
    from fire3d.api import jobs as jobs_mod
    from fire3d.api.app import app

    started, _ = _lifespan_tasks(monkeypatch, floods=True)
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        names = client.portal.call(lambda: sorted(t.get_name() for t in asyncio.all_tasks()))
    assert sorted(started) == ["fire", "flood"]
    assert "fire3d-live-refresh" in names and "fire3d-flood-live-refresh" in names
    jobs_mod.set_manager(None)


def test_flood_task_off_with_floods_disabled(flood_iso, monkeypatch):
    from fire3d.api import jobs as jobs_mod
    from fire3d.api.app import app

    started, _ = _lifespan_tasks(monkeypatch, floods=False)
    with TestClient(app) as client:
        names = client.portal.call(lambda: sorted(t.get_name() for t in asyncio.all_tasks()))
    assert started == ["fire"] and "fire3d-flood-live-refresh" not in names
    jobs_mod.set_manager(None)


def test_a_dead_flood_task_never_stops_the_fire_loop(flood_iso, monkeypatch):
    from fire3d.api import jobs as jobs_mod
    from fire3d.api.app import app

    async def broken_flood(jobs=None, interval_s=None):
        raise RuntimeError("the flood loop crashed")

    _, ticks = _lifespan_tasks(monkeypatch, floods=True, flood_loop=broken_flood)
    with TestClient(app) as client:
        time.sleep(0.2)
        before = ticks["n"]
        time.sleep(0.2)
        assert ticks["n"] > before > 0                       # the fire loop keeps running
        assert client.get("/api/health").status_code == 200
    jobs_mod.set_manager(None)


def test_failing_flood_cycles_never_reach_the_fire_loop(flood_iso, jm, monkeypatch):
    fire_cycles = {"n": 0}

    async def fire_cycle(jobs):
        fire_cycles["n"] += 1
        return [], None

    def broken_list(refresh=False):
        raise RuntimeError("flood lists exploded")

    monkeypatch.setattr(fire_live, "STATE", fire_live.LiveState())
    monkeypatch.setattr(fire_live, "run_cycle", fire_cycle)
    monkeypatch.setattr(config, "AUTO_BUILD_LIVE", False)
    monkeypatch.setattr(config, "AUTO_BUILD_FLOODS", True)
    monkeypatch.setattr(catalog, "flood_list", broken_list)

    async def main():
        fire = asyncio.create_task(fire_live.live_refresh_loop(jm, interval_s=0.02))
        flood = asyncio.create_task(flood_live.flood_refresh_loop(jm, interval_s=0.02))
        await asyncio.sleep(0.5)
        out = (fire.done(), flood.done(), fire_cycles["n"], flood_live.STATE.last_error,
               flood_live.STATE.active_floods, flood_live.STATE.auto_build_done)
        for t in (fire, flood):
            t.cancel()
        for t in (fire, flood):
            try:
                await t
            except asyncio.CancelledError:
                pass
        return out

    fire_done, flood_done, n, err, active, auto = asyncio.run(main())
    assert not fire_done and not flood_done and n >= 5
    assert err and "flood lists exploded" in err and active is None
    assert auto is False                                     # never auto-builds from a failed list


# ---------------------------------------------------------------------------------------------------------------
# Background prefetch: budget, NWS limiter, kinds
# ---------------------------------------------------------------------------------------------------------------
def _prefetch_routes(calls: list[httpx.Request], busy_nws: bool = False):
    product = {"productText": "...FLOOD WARNING...\n/O.CON.KEAX.FL.W.0217.261104T0000Z-000000T0000Z/\n"
                              "/AGYM7.2.ER.261103T1200Z.261105T0000Z.000000T0000Z.NO/\n"}

    def listing(req):
        return httpx.Response(200, json={"@graph": [{"id": "abc-1", "issuanceTime": "2026-11-04T21:00:00Z"}]})

    zone = {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[-95, 39], [-94, 39], [-94, 40],
                                                                              [-95, 40], [-95, 39]]]},
            "properties": {"name": "Zone"}}
    return route_transport([
        ("api.weather.gov", r"^/alerts/active$", NWS / "nws_flood_active.json"),
        ("api.weather.gov", r"^/products/types/", listing),
        ("api.weather.gov", r"^/products/abc-1$", product),
        ("api.weather.gov", r"^/zones/", zone),
        ("api.water.noaa.gov", r"/stageflow$", {"observed": {"data": []}, "forecast": {"data": []}}),
    ], calls)


def test_prefetch_stays_within_its_budget_and_on_the_nws_limiter(recorded_list, monkeypatch):
    lst, now = recorded_list
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _prefetch_routes(calls))
    nws.flood_active()                                        # the list build's request: now in the HTTP cache
    calls.clear()
    plan = flood_live.prefetch_plan(lst, flood_live._national_from_cache(), now)
    assert plan["hvtec"] and plan["series"]                   # recorded day: river products and member gauges
    before = len(nws.NWS_LIMITER._times)
    spent = flood_live.prefetch(lst, now=now)
    nws_calls = [c for c in calls if c.url.host == "api.weather.gov"]
    assert len(calls) <= flood_live.PREFETCH_MAX and sum(spent.values()) <= flood_live.PREFETCH_MAX
    assert len(calls) <= sum(spent.values())                  # counted at the largest possible cost
    assert len(nws.NWS_LIMITER._times) - before == len(nws_calls) > 0       # every NWS call took the shared limiter
    assert spent["hvtec"] <= flood_live.PREFETCH_CAPS["hvtec"] + flood_live.PREFETCH_MAX
    assert any(c.url.path.endswith("/stageflow") for c in calls)            # the series got their share
    assert not any(c.url.path.startswith("/alerts") for c in calls)          # never the list's own request
    # a second cycle: what was fetched is cached now and never asked again
    first = {c.url.path for c in calls if c.url.path.endswith("/stageflow") or "/zones/" in c.url.path}
    calls.clear()
    flood_live.prefetch(lst, now=now)
    second = [c.url.path for c in calls]
    assert len(second) == len(set(second)) and not first & set(second)


def test_prefetch_fetches_zone_outlines_of_zone_based_products(recorded_list, monkeypatch):
    lst, now = recorded_list
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _prefetch_routes(calls))
    nat = nws.flood_active().alerts
    calls.clear()
    base = next(a for a in nat if nws.flood_phase(a, now) == "in_effect")
    watch = {**base, "id": "urn:test:watch", "_geometry": None, "ugcs": ["COZ991", "COZ992", "COC011"],
             "_zone_types": {"COZ991": "forecast", "COZ992": "forecast"}}
    lst2 = {**lst, "floods": [{**lst["floods"][0], "products": [{"id": watch["id"], "vtec_key": None}]}]}
    monkeypatch.setattr(flood_live, "_national_from_cache", lambda: [watch])
    plan = flood_live.prefetch_plan(lst2, [watch], now)
    assert [(u, t) for u, t, _ in plan["zones"]] == [("COZ991", "forecast"), ("COZ992", "forecast"),
                                                      ("COC011", "county")]
    spent = flood_live.prefetch(lst2, now=now)
    assert spent["zones"] == 3 and sorted(c.url.path for c in calls if "/zones/" in c.url.path) == [
        "/zones/county/COC011", "/zones/forecast/COZ991", "/zones/forecast/COZ992"]
    assert flood_live.prefetch_plan(lst2, [watch], now)["zones"] == []          # cached now: never asked again


def test_prefetch_with_nws_busy_still_fetches_series(recorded_list, monkeypatch):
    lst, now = recorded_list
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _prefetch_routes(calls))
    nws.flood_active()
    calls.clear()
    monkeypatch.setattr(nws.NWS_LIMITER, "try_acquire", lambda: False)     # Disaster Mapping's own NWS budget is used up
    monkeypatch.setattr(nws.NWS_LIMITER, "acquire", lambda *a, **k: False, raising=False)
    spent = flood_live.prefetch(lst, now=now)
    assert not [c for c in calls if c.url.host == "api.weather.gov"]
    assert [c for c in calls if c.url.path.endswith("/stageflow")] and spent["series"] > 0


def test_prefetch_without_a_cached_national_answer_makes_no_nws_request(recorded_list, monkeypatch):
    lst, now = recorded_list
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _prefetch_routes(calls))
    flood_live.prefetch(lst, now=now, budget=3)
    assert len(calls) <= 3 and not [c for c in calls if c.url.host == "api.weather.gov"]


# ---------------------------------------------------------------------------------------------------------------
# Appending to a ready bundle; merges
# ---------------------------------------------------------------------------------------------------------------
def _alert(aid: str, key: str, sent: int, phase: str = "in_effect") -> dict:
    office, ph, sig, etn, year = key.split(".")
    return {"id": aid, "vtec": {"office": office, "phenomena": ph, "significance": sig, "etn": int(etn), "action": "CON",
                                "year": int(year)}, "sent_ms": sent, "phase": phase, "emergency": False,
            "hvtec": None, "flood_ids": []}


def _answer(alerts, status="available"):
    return {"kind": "flood_alerts", "status": status, "alerts": alerts, "zones": {"type": "FeatureCollection",
                                                                                  "features": []}, "caveats": []}


def test_merge_alerts_keeps_versions_and_marks_dropped_products_ended():
    old = _answer([_alert("v1", "KEAX.FL.W.0217.2026", 1), _alert("w1", "KEAX.FL.W.0223.2026", 1)])
    fresh = _answer([_alert("v2", "KEAX.FL.W.0217.2026", 2)])
    merged, changed = flood_live.merge_alerts(old, fresh)
    by = {a["id"]: a for a in merged["alerts"]}
    assert changed and set(by) == {"v1", "v2", "w1"}
    assert by["v1"]["phase"] == "in_effect"                  # an older version of a product NWS still lists
    assert by["w1"]["phase"] == "ended"                      # NWS answered without it
    assert [a["id"] for a in merged["alerts"]][0] == "v2"    # newest first within a significance
    # an outage changes nothing (never "ended" because NWS could not be read)
    same, changed = flood_live.merge_alerts(old, _answer([], status="unavailable"))
    assert same is old and changed is False
    # the same answer twice: no change
    again, changed = flood_live.merge_alerts(merged, fresh)
    assert changed is False
    # an outage answer at build time is replaced by the first good answer
    rep, changed = flood_live.merge_alerts(_answer([], status="unavailable"), fresh)
    assert rep is fresh and changed


def test_merge_gauges_appends_readings():
    old = {"status": "available", "gauges": [
        {"lid": "AGYM7", "member": True, "waterbody": "Platte River",
         "observed": {"value": 20.0, "unit": "ft", "flow": 900.0, "flow_unit": "ft3/s", "category": "minor",
                      "valid_ms": 1000},
         "series": {"observed": [[500, 19.0, None], [1000, 20.0, 900.0]], "forecast": [[2000, 21.0, None]],
                    "forecast_issued_ms": 900, "stage_unit": "ft", "flow_unit": "ft3/s"}},
        {"lid": "NEAR1", "member": False, "observed": {"valid_ms": 10}}], "now_ms": 1, "source_updated_ms": 1000}
    ref = {"lid": "AGYM7", "observed_value": 21.5, "unit": "ft", "observed_category": "moderate", "observed_ms": 1600}
    new, changed = flood_live.merge_gauges(old, {}, {"AGYM7": ref}, 5000)
    g = new["gauges"][0]
    assert changed and g["observed"]["value"] == 21.5 and g["observed"]["category"] == "moderate"
    assert g["series"]["observed"][-1] == [1600, 21.5, None] and len(g["series"]["observed"]) == 3
    assert g["series"]["forecast"] == [[2000, 21.0, None]] and new["gauges"][1] == old["gauges"][1]
    assert new["source_updated_ms"] == 1600 and new["now_ms"] == 5000
    # an older list reading changes nothing
    _, changed = flood_live.merge_gauges(new, {}, {"AGYM7": {**ref, "observed_ms": 1200}}, 6000)
    assert changed is False
    # an NWPS answer keeps the bundle's earlier observed rows and takes the newer forecast
    fresh = {**old["gauges"][0], "observed": {**old["gauges"][0]["observed"], "value": 22.0, "valid_ms": 3000},
             "series": {"observed": [[2500, 21.8, None], [3000, 22.0, None]], "forecast": [[4000, 23.0, None]],
                        "forecast_issued_ms": 2900, "stage_unit": "ft", "flow_unit": "ft3/s"}, "waterbody": None}
    m2, changed = flood_live.merge_gauges(new, {"AGYM7": fresh}, {}, 7000)
    g2 = m2["gauges"][0]
    assert changed and [r[0] for r in g2["series"]["observed"]] == [500, 1000, 1600, 2500, 3000]
    assert g2["series"]["forecast"] == [[4000, 23.0, None]] and g2["waterbody"] == "Platte River"
    # an outage answer at build time is left for a refresh rebuild
    out, changed = flood_live.merge_gauges({"status": "unavailable", "gauges": []}, {}, {"AGYM7": ref}, 1)
    assert changed is False


def _alerts_with(path: Path, change) -> bytes:
    doc = orjson.loads(path.read_bytes())
    doc["features"] = [f for f in (change(f) for f in doc["features"]) if f is not None]
    return orjson.dumps(doc)


def _swap_alerts(monkeypatch, calls, body: bytes) -> None:
    routes = [r for r in _routes() if r[1] != r"^/alerts/active$"]
    routes.insert(0, ("api.weather.gov", r"^/alerts/active$", body))
    monkeypatch.setattr(fhttp, "_transport", route_transport(routes, calls))
    fhttp.evict_cache("GET", nws.flood_url(), None)


def test_append_new_versions_and_readings_to_a_ready_bundle(recorded_flood, monkeypatch, jm):
    summary, now, calls = recorded_flood
    m0 = build.build_flood(summary["id"], now=now)
    bdir = store.flood_dir(summary["id"])
    w0 = json.loads((bdir / "warnings.json").read_text())
    ids0 = {a["id"] for a in w0["alerts"]}
    target = next(a for a in w0["alerts"] if a["vtec"] and a["vtec"]["etn"] == 217)

    def new_version(f):                                      # NWS sends a new version (CON) of KEAX.FL.W.0217
        if f["properties"]["id"] == target["id"] or f["id"] == target["id"] or f["id"].endswith(target["id"]):
            g = json.loads(json.dumps(f))
            g["id"] = f["id"] + "-v2"
            g["properties"]["id"] = f["properties"]["id"] + "-v2"
            g["properties"]["sent"] = "2026-11-04T22:30:00-06:00"
            return g
        return f

    _swap_alerts(monkeypatch, calls, _alerts_with(NWS / "nws_flood_active.json", new_version))
    s2 = {**summary, "products": summary["products"] + [{**next(p for p in summary["products"] if p["id"] == target["id"]),
                                                          "id": target["id"] + "-v2"}]}
    ref = next(g for g in summary["gauges"] if g["lid"] == "AGYM7")
    s2["gauges"] = [{**g, "observed_ms": now + HOUR_MS, "observed_value": (g["observed_value"] or 0) + 0.7}
                    if g["lid"] == "AGYM7" else g for g in summary["gauges"]]
    # the products' NWS requests come out of the cycle's budget (review BFL-R7): a cycle's worth here
    assert flood_live.append_bundle(summary["id"], s2, now=now + HOUR_MS, reads={"left": flood_live.PREFETCH_MAX}) is True
    w1 = json.loads((bdir / "warnings.json").read_text())
    validate_strict(FloodAlertsResponse, w1)
    ids1 = {a["id"] for a in w1["alerts"]}
    assert ids0 < ids1 and target["id"] + "-v2" in ids1 and target["id"] in ids1     # every version kept
    g1 = json.loads((bdir / "gauges.json").read_text())
    validate_strict(RiverGaugesResponse, g1)
    agym7 = next(g for g in g1["gauges"] if g["lid"] == "AGYM7")
    assert agym7["observed"]["valid_ms"] == now + HOUR_MS and agym7["series"]["observed"][-1][0] == now + HOUR_MS
    assert agym7["observed"]["value"] == pytest.approx(ref["observed_value"] + 0.7)
    m1 = json.loads((bdir / "manifest.json").read_text())
    validate_strict(FloodManifest, m1)
    assert m1["built_ms"] == m0["built_ms"] and m1["refreshed_ms"] == now + HOUR_MS
    assert m1["layer_status"]["gauges"]["time_ms"] >= now + HOUR_MS
    # NWS drops the product: its versions read "ended" (it left NWS's active list), nothing is removed
    _swap_alerts(monkeypatch, calls, _alerts_with(NWS / "nws_flood_active.json",
                                                   lambda f: None if "KEAX" in json.dumps(f["properties"].get(
                                                       "parameters", {}).get("VTEC", "")) else f))
    assert flood_live.append_bundle(summary["id"], {**s2, "products": []}, now=now + 2 * HOUR_MS,
                                    reads={"left": flood_live.PREFETCH_MAX})
    w2 = json.loads((bdir / "warnings.json").read_text())
    assert {a["id"] for a in w2["alerts"]} == ids1 and all(a["phase"] == "ended" for a in w2["alerts"])
    # NWS unreachable: nothing changes
    _swap_alerts(monkeypatch, calls, b"not json")
    before = (bdir / "warnings.json").read_bytes()
    flood_live.append_bundle(summary["id"], {**s2, "products": []}, now=now + 3 * HOUR_MS,
                             reads={"left": flood_live.PREFETCH_MAX})
    assert (bdir / "warnings.json").read_bytes() == before
    # the bundle still passes the bundle check
    rep, _ = load_script("check_bundle").check_flood_bundle(bdir)
    assert rep.problems == []


def test_append_skips_a_busy_bundle(recorded_flood, monkeypatch):
    from fire3d.build import pipeline

    summary, now, _ = recorded_flood
    build.build_flood(summary["id"], now=now)
    bdir = store.flood_dir(summary["id"])
    s2 = {**summary, "gauges": [{**g, "observed_ms": now + HOUR_MS, "observed_value": 1.0} for g in summary["gauges"]]}
    before = (bdir / "gauges.json").read_bytes()
    with pipeline.bundle_lock(bdir, timeout=0):              # a build holds the lock
        assert flood_live.append_bundle(summary["id"], s2, now=now + HOUR_MS, reads={"left": 0}) is False
    assert (bdir / "gauges.json").read_bytes() == before


def test_refresh_bundles_appends_and_queues(recorded_flood, monkeypatch, jm):
    summary, now, calls = recorded_flood
    build.build_flood(summary["id"], now=now)
    lst = {"floods": [{**summary, "gauges": [{**g, "observed_ms": now + HOUR_MS, "observed_value": 30.0}
                                             for g in summary["gauges"]]}]}
    monkeypatch.setattr(flood_live, "refresh_reason", lambda fid, m, s, now: "satellite")
    queued_fns = []
    monkeypatch.setattr(flood_live, "refresh_job_fn", lambda fid, reason: (queued_fns.append(fid), lambda p: {})[1])
    appended, queued = flood_live.refresh_bundles(lst, jm, now=now + HOUR_MS, gauge_reads=0)
    # due refreshes wait for the loop's runner, never straight in the job workers (review BFL-R1)
    assert appended == [summary["id"]] and queued == [(summary["id"], "satellite")] and queued_fns == []
    assert summary["id"] in flood_live.STATE.pending
    assert flood_live.refresh_bundles(lst, jm, now=now + HOUR_MS, gauge_reads=0)[1] == []    # due once
    warmed: list[str] = []
    monkeypatch.setattr(flood_live, "warm_nwps", lambda s, **kw: warmed.append(s["id"]) or 0)
    done = asyncio.run(flood_live.run_refreshes(jm))
    assert done == [(summary["id"], "satellite")] and warmed == queued_fns == [summary["id"]]
    assert not flood_live.STATE.pending
    # a flood that is not listed, a synthetic bundle or a bundle with a running job is left alone
    assert flood_live.refresh_bundles({"floods": []}, jm, now=now + HOUR_MS) == ([], [])


def test_refresh_reason(recorded_flood, monkeypatch):
    summary, now, calls = recorded_flood
    m = build.build_flood(summary["id"], now=now)
    later = now + 2 * HOUR_MS
    assert flood_live.refresh_reason(summary["id"], m, {**summary, "status": "inactive"}, now=later) is None
    assert flood_live.refresh_reason(summary["id"], m, summary, now=now + 10 * 60_000) is None      # built < 1 h ago
    acq = m["layer_status"]["water_satellite"]["time_ms"]
    newer = opera.Pass("DSWx-HLS_newer", "DSWx-HLS", "S2B", acq + HOUR_MS)
    older = opera.Pass("DSWx-HLS_older", "DSWx-HLS", "L9", acq - HOUR_MS)
    monkeypatch.setattr(opera, "egis_granules", lambda bbox, end, now_ms=None: ([], now))
    monkeypatch.setattr(opera, "group_passes", lambda grans: [newer, older])
    assert flood_live.refresh_reason(summary["id"], m, summary, now=later) == "satellite"
    # the same pass is never tried twice; the forecast map with the bundle's own time: nothing to do
    assert flood_live.refresh_reason(summary["id"], m, summary, now=later) is None
    # NWS issued a new forecast flooded-area map for the area
    from fire3d.sources import water_maps

    ref = m["layer_status"]["water_forecast"]["time_ms"]
    monkeypatch.setattr(water_maps, "rfc_fim", lambda bbox: water_maps.MapLayer([], (ref or 0) + HOUR_MS, None, now, {}))
    assert flood_live.refresh_reason(summary["id"], m, summary, now=later) == "rfc_fim"
    # an official layer that failed at build time is retried after 3 h
    bad = {**m, "layer_status": {**m["layer_status"], "gauges": {**m["layer_status"]["gauges"], "status": "unavailable",
                                                                  "reason": fcopy.GAUGES_UNAVAILABLE}}}
    assert flood_live.refresh_reason(summary["id"], bad, summary, now=now + 4 * HOUR_MS) == "retry"


def test_refresh_job_keeps_earlier_versions(recorded_flood, monkeypatch, jm):
    summary, now, calls = recorded_flood
    build.build_flood(summary["id"], now=now)
    bdir = store.flood_dir(summary["id"])
    w = json.loads((bdir / "warnings.json").read_text())
    old = {**w["alerts"][0], "id": w["alerts"][0]["id"] + "-old", "sent_ms": w["alerts"][0]["sent_ms"] - HOUR_MS}
    w["alerts"].append(old)
    (bdir / "warnings.json").write_text(json.dumps(w))
    res = flood_live.refresh_job_fn(summary["id"], "satellite")(lambda *a: None)
    assert res["reason"] == "satellite" and res["status"] == "ready"
    w2 = json.loads((bdir / "warnings.json").read_text())
    validate_strict(FloodAlertsResponse, w2)
    assert old["id"] in {a["id"] for a in w2["alerts"]}
    rep, _ = load_script("check_bundle").check_flood_bundle(bdir)
    assert rep.problems == []


# ---------------------------------------------------------------------------------------------------------------
# Review BFL-R1: one budget a cycle, refreshes warmed at a pace, and a refresh never makes a bundle worse
# ---------------------------------------------------------------------------------------------------------------
def _member(lid, *, detail=True, valid=1000, value=20.0):
    g = {"lid": lid, "member": True, "waterbody": "Platte River", "name": lid, "usgs_id": None, "reach_id": None,
         "rfc": None, "is_forecast_point": False, "thresholds": None, "forecast": None, "impacts": [],
         "forecast_reliability": None, "hydronotes": [], "data_attribution": [], "state": "MO", "county": None,
         "time_zone": "America/Chicago", "lat": 39.0, "lon": -94.5, "url": "https://water.noaa.gov/gauges/x",
         "wfo": None,
         "observed": {"value": value, "unit": "ft", "flow": None, "flow_unit": None, "category": "minor",
                      "valid_ms": valid}}
    if detail:
        g.update(reach_id="2529595", is_forecast_point=True, impacts=[{"stage": 25.0, "statement": "Water reaches..."}],
                 data_attribution=[{"text": fcopy.USGS_OBSERVATIONS, "url": None}],
                 series={"observed": [[500, 19.0, None], [valid, value, None]], "forecast": [[2000, 21.0, None]],
                         "forecast_issued_ms": 900, "stage_unit": "ft", "flow_unit": None})
    return g


def test_merge_rebuilt_gauges_never_loses_members_or_detail():
    older = {"status": "available", "caveats": [fcopy.GAUGE_NOT_ALL_CLEAR],
             "gauges": [_member("AGYM7"), _member("SJWF1"), {**_member("NEAR1", detail=False), "member": False}]}
    # the rebuild read AGYM7 from the gauge map only (NWPS busy) and lost SJWF1; NEAR1 is gone (nearby: not kept)
    fallback = _member("AGYM7", detail=False, valid=3000, value=21.5)
    rebuilt = {"status": "available", "caveats": [fcopy.GAUGE_NOT_ALL_CLEAR, fcopy.GAUGE_DETAIL_DOWN],
               "gauges": [fallback], "source_updated_ms": 3000}
    merged, kept = flood_live.merge_rebuilt_gauges(older, rebuilt, ["AGYM7", "SJWF1", "XXXX1"])
    by = {g["lid"]: g for g in merged["gauges"]}
    assert kept == ["gauge_detail"] and [g["lid"] for g in merged["gauges"]] == ["AGYM7", "SJWF1"]
    agym = by["AGYM7"]
    assert agym["impacts"] and agym["reach_id"] == "2529595" and agym["data_attribution"]       # earlier detail
    assert agym["observed"]["valid_ms"] == 3000 and agym["observed"]["value"] == 21.5           # newer reading
    assert agym["series"]["observed"][-1] == [3000, 21.5, None] and agym["series"]["forecast"] == [[2000, 21.0, None]]
    assert fcopy.GAUGE_DETAIL_DOWN not in merged["caveats"]          # every member has its NWPS detail again
    validate_strict(RiverGaugesResponse, {**merged, "kind": "river_gauges", "reason_code": None, "reason": None,
                                          "source": dict(fcopy.SOURCE_NWPS), "retrieved_ms": 1, "requested_at_ms": None,
                                          "now_ms": 1, "flood_id": None, "synthetic": False, "area_bbox": None})
    # the rebuild could not read the gauges at all: the earlier answer stays
    same, kept = flood_live.merge_rebuilt_gauges(older, {"status": "unavailable", "gauges": []}, ["AGYM7"])
    assert same is older and kept == ["gauges"]
    # an ordinary rebuild (NWPS read): its answer, with the earlier observed rows; a gauge that left the flood (no
    # longer at action stage in NWS's list) stays as a nearby gauge with its readings and the map's newest one
    fresh = _member("AGYM7", valid=4000, value=22.0)
    now_near = {**_member("SJWF1", detail=False, valid=5000, value=3.0), "member": False}
    ok, kept = flood_live.merge_rebuilt_gauges(older, {"status": "available", "caveats": [],
                                                       "gauges": [fresh, now_near]}, ["AGYM7"])
    assert kept == [] and [(g["lid"], g["member"]) for g in ok["gauges"]] == [("AGYM7", True), ("SJWF1", False)]
    assert [r[0] for r in ok["gauges"][0]["series"]["observed"]] == [500, 1000, 4000]
    sj = ok["gauges"][1]
    assert sj["impacts"] and sj["observed"]["valid_ms"] == 5000 and sj["series"]["observed"][-1] == [5000, 3.0, None]
    # a gauge the map has no detail for either: the caveat stays
    lone = {"status": "available", "caveats": [fcopy.GAUGE_DETAIL_DOWN], "gauges": [_member("NEW01", detail=False)]}
    m2, kept = flood_live.merge_rebuilt_gauges(older, lone, ["NEW01"])
    assert fcopy.GAUGE_DETAIL_DOWN in m2["caveats"]


def _nwps_busy(monkeypatch):
    def busy(url, params, ttl_s):
        raise nws.SourceBusy("NOAA's National Water Prediction Service: Disaster Mapping's request limit is reached")

    monkeypatch.setattr(nwps, "_nwps_json", busy)


def test_refresh_with_nwps_busy_keeps_member_gauges_detail_and_model_series(recorded_flood, monkeypatch):
    """The reviewer's run: the refresh rebuild met Disaster Mapping's own NWPS limit. Nothing the bundle had is lost."""
    summary, now, calls = recorded_flood
    build.build_flood(summary["id"], now=now)
    bdir = store.flood_dir(summary["id"])
    g0 = json.loads((bdir / "gauges.json").read_text())
    m0 = json.loads((bdir / "manifest.json").read_text())
    members0 = [g["lid"] for g in g0["gauges"] if g["member"]]
    agym0 = next(g for g in g0["gauges"] if g["lid"] == "AGYM7")
    assert agym0["impacts"] and agym0["reach_id"] and "nwm_series_AGYM7" in m0["files"]["model"]
    series0 = (bdir / "model" / "nwm_series_AGYM7.json").read_bytes()
    _nwps_busy(monkeypatch)
    res = flood_live.refresh_job_fn(summary["id"], "satellite")(lambda *a: None)
    # NWPS refused every request: the rebuild had no member gauge from NWPS, so the earlier gauges.json is kept
    # (gauges), or its members' detail (gauge_detail) when the gauge map had them; the model series either way
    assert res["status"] == "ready" and "nwm_series" in res["kept"]
    assert {"gauges", "gauge_detail"} & set(res["kept"])
    g1 = json.loads((bdir / "gauges.json").read_text())
    m1 = json.loads((bdir / "manifest.json").read_text())
    assert [g["lid"] for g in g1["gauges"] if g["member"]] == members0                      # no member lost
    agym1 = next(g for g in g1["gauges"] if g["lid"] == "AGYM7")
    for k in ("impacts", "reach_id", "data_attribution", "usgs_id", "thresholds"):
        assert agym1[k] == agym0[k], k
    assert fcopy.GAUGE_DETAIL_DOWN not in g1["caveats"]
    assert m1["files"]["model"]["nwm_series_AGYM7"] == "model/nwm_series_AGYM7.json"
    assert (bdir / "model" / "nwm_series_AGYM7.json").read_bytes() == series0                 # the earlier model run
    assert any(w.startswith("The refresh of ") and "earlier copy is kept" in w for w in m1["warnings"])
    assert m1["built_ms"] != m0["built_ms"] and m1["layer_status"]["gauges"]["status"] == "ok"
    rep, _ = load_script("check_bundle").check_flood_bundle(bdir)
    assert rep.problems == []
    assert flood_live.STATE.last_kept[summary["id"]] == res["kept"]


def test_refresh_keeps_layers_the_rebuild_could_not_load(recorded_flood, monkeypatch):
    """FEMA, NOAA's maps and NASA unreachable during the refresh: the earlier layers stay, with their own times."""
    summary, now, calls = recorded_flood
    build.build_flood(summary["id"], now=now)
    bdir = store.flood_dir(summary["id"])
    m0 = json.loads((bdir / "manifest.json").read_text())
    before = {k: (bdir / m0["layers"][k]["file"]).read_bytes() for k in ("water_forecast", "floodplain", "water_satellite",
                                                                        "water_model")}
    # brief 6 (review BTD-R2): the time history's passes and their rasters, and the depth estimates
    tl0 = json.loads((bdir / "timeline.json").read_text())
    pass_layers0 = {k: (bdir / i["file"]).read_bytes() for k, i in m0["layers"].items()
                    if k.startswith(("water_pass_", "depth_pass_"))}
    assert tl0["passes"]["status"] == "available" and pass_layers0
    depth0 = {d["key"]: (bdir / m0["layers"][d["layer"]]["file"]).read_bytes()
              for d in m0["terrain3d"]["depth"] if d["layer"]}
    assert set(depth0) == {"depth_satellite", "depth_forecast"}

    def down(req):
        raise httpx.ConnectError("Connection reset by peer", request=req)

    routes = [r for r in _routes() if not (r[0] in ("maps.water.noaa.gov", "hazards.fema.gov", "gis.earthdata.nasa.gov",
                                                    "gibs.earthdata.nasa.gov", "cmr.earthdata.nasa.gov"))]
    for host in ("maps.water.noaa.gov", "hazards.fema.gov", "gis.earthdata.nasa.gov", "gibs.earthdata.nasa.gov",
                 "cmr.earthdata.nasa.gov"):
        routes.append((host, r".*", down))
    monkeypatch.setattr(fhttp, "_transport", route_transport(routes, calls))
    monkeypatch.setattr(fhttp, "_retry_delay", lambda attempt, retry_after: 0.0)
    fhttp.reset_down_memos()
    for p in sorted(config.CACHE_DIR.rglob("*")) if config.CACHE_DIR.is_dir() else []:   # nothing from the cache
        if p.is_file():
            p.unlink()
    res = flood_live.refresh_job_fn(summary["id"], "rfc_fim")(lambda *a: None)
    m1 = json.loads((bdir / "manifest.json").read_text())
    assert {"water_forecast", "floodplain", "water_model", "water_satellite"} <= set(res["kept"])
    for k, raw in before.items():
        assert m1["layer_status"][k] == m0["layer_status"][k], k                         # its own (earlier) time
        assert (bdir / m1["layers"][k]["file"]).read_bytes() == raw, k
    assert m1["files"]["maps"]["rfc_fim"] and (bdir / m1["files"]["maps"]["rfc_fim"]).is_file()
    assert json.loads((bdir / "satellite.json").read_text())["measured"] is True
    assert fcopy.NFHL_DOWN not in m1["warnings"] and any("earlier copy is kept" in w for w in m1["warnings"])
    # the pass list and its rasters are kept (NASA unreachable), and each depth estimate belongs to the water layer
    # put back: the rebuild alone had none (no satellite or forecast water), the refresh made them again
    tl1 = json.loads((bdir / "timeline.json").read_text())
    assert tl1["passes"]["status"] == "available"
    assert [p["key"] for p in tl1["passes"]["passes"]] == [p["key"] for p in tl0["passes"]["passes"]]
    for k, raw in pass_layers0.items():
        assert (bdir / m1["layers"][k]["file"]).read_bytes() == raw, k
    assert any(tcopy.KEPT_PASSES in w for w in m1["warnings"])
    by = {d["key"]: d for d in m1["terrain3d"]["depth"]}
    for k, raw in depth0.items():
        assert by[k]["status"] == "ok" and (bdir / m1["layers"][by[k]["layer"]]["file"]).read_bytes() == raw, k
    assert by["depth_satellite"]["time_ms"] == m1["layer_status"]["water_satellite"]["time_ms"]
    rep, _ = load_script("check_bundle").check_flood_bundle(bdir)
    assert rep.problems == []


def test_warm_nwps_paces_and_stops(monkeypatch):
    """Before a refresh or auto-build: NWPS answers are loaded only while more than NWPS_RESERVE slots are free, and
    the warm-up stops at its deadline (never in a job worker)."""
    asked: list[str] = []
    free = {"n": flood_live.NWPS_RESERVE + 2}

    def take(name):
        def fn(*a, **k):
            if free["n"] <= 0:
                raise nws.SourceBusy("limit")
            free["n"] -= 1
            asked.append(name + ":" + str(a[0]))
            return ({"lid": a[0]}, 1)
        return fn

    monkeypatch.setattr(nwps.NWPS_LIMITER, "remaining", lambda: free["n"])
    monkeypatch.setattr(nwps, "gauge", take("gauge"))
    monkeypatch.setattr(nwps, "stageflow", take("stageflow"))
    monkeypatch.setattr(flood_live, "WARM_POLL_S", 0.01)
    from fire3d.floods import gauges as gauges_mod

    monkeypatch.setattr(gauges_mod, "nwps_river_gauge", lambda lid, **k: {"reach_id": None, "is_forecast_point": False})
    s = {"id": "flood-x", "gauges": [{"lid": "AAAA1"}, {"lid": "BBBB2"}]}
    t0 = time.monotonic()
    made = flood_live.warm_nwps(s, max_s=0.3)
    assert made == 2 and asked == ["gauge:AAAA1", "stageflow:AAAA1"]      # stopped at the reserve, then the deadline
    assert free["n"] == flood_live.NWPS_RESERVE and time.monotonic() - t0 < 5
    free["n"] = 99
    asked.clear()
    assert flood_live.warm_nwps(s, max_s=5) == 4 and len(asked) == 4


def test_a_cycle_spends_one_budget(recorded_list, jm, monkeypatch):
    """The prefetch and the append step share PREFETCH_MAX (NWS and NWPS together), and due refreshes are queued by
    the loop's runner after warming, not by the cycle."""
    lst, now = recorded_list
    monkeypatch.setattr(catalog, "flood_list", lambda refresh=False: lst)
    monkeypatch.setattr(flood_live, "warm_year_lists", lambda: None)
    seen: dict[str, object] = {}

    def prefetch(lst, *, budget=0, now=None):
        seen["prefetch_budget"] = budget
        return {"hvtec": 6, "zones": 0, "series": 3}

    def refresh_bundles(lst, jobs, *, budget=None, **kw):
        seen["append_budget"] = budget
        flood_live.STATE.pending["flood-20261104-a-flood-aaaaaa"] = ("satellite", {"id": "flood-20261104-a-flood-aaaaaa"})
        return [], [("flood-20261104-a-flood-aaaaaa", "satellite")]

    ran: list[str] = []

    async def run_refreshes(jobs):
        ran.append("runner")
        flood_live.STATE.pending.clear()
        return []

    monkeypatch.setattr(flood_live, "prefetch", prefetch)
    monkeypatch.setattr(flood_live, "refresh_bundles", refresh_bundles)
    monkeypatch.setattr(flood_live, "run_refreshes", run_refreshes)

    async def main():
        await flood_live.run_cycle(jm)
        await asyncio.sleep(0.05)

    asyncio.run(main())
    assert seen["prefetch_budget"] == flood_live.PREFETCH_MAX - flood_live.APPEND_SHARE
    assert seen["append_budget"] == flood_live.PREFETCH_MAX - 9 and ran == ["runner"]


def test_append_products_wait_when_their_requests_do_not_fit(recorded_flood, monkeypatch):
    """The products' answer would fetch zone outlines / product texts the cycle cannot afford: they wait for a later
    cycle; the gauge readings are still appended (review BFL-R7)."""
    summary, now, calls = recorded_flood
    build.build_flood(summary["id"], now=now)
    bdir = store.flood_dir(summary["id"])
    before = (bdir / "warnings.json").read_bytes()
    monkeypatch.setattr(flood_live, "alerts_cost", lambda s: 5)
    asked: list[int] = []
    from fire3d.floods import zones as zones_mod

    monkeypatch.setattr(zones_mod, "flood_alerts", lambda *a, **k: asked.append(1) or pytest.fail("fetched"))
    s2 = {**summary, "gauges": [{**g, "observed_ms": now + HOUR_MS, "observed_value": 31.0} for g in summary["gauges"]]}
    reads = {"left": 4, "gauges": 0}
    assert flood_live.append_bundle(summary["id"], s2, now=now + HOUR_MS, reads=reads) is True
    assert asked == [] and (bdir / "warnings.json").read_bytes() == before and reads["left"] == 4
    g1 = json.loads((bdir / "gauges.json").read_text())
    assert next(g for g in g1["gauges"] if g["lid"] == "AGYM7")["observed"]["value"] == 31.0


def test_alerts_cost_counts_uncached_zones_and_texts(recorded_list, monkeypatch):
    lst, now = recorded_list
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _prefetch_routes(calls))
    nat = nws.flood_active().alerts
    river = next(a for a in nat if (a.get("vtec") or {}).get("phenomena") == "FL" and len(a.get("_awips") or "") >= 4)
    river = {**river, "sent_ms": 1_793_826_000_000}                 # 2026-11-04T21:00Z: the recorded listing's product
    watch = {**river, "id": "urn:test:watch", "vtec": {**river["vtec"], "phenomena": "FA", "significance": "A"},
             "_geometry": None, "ugcs": ["COZ991", "COZ992"], "_zone_types": {"COZ991": "forecast", "COZ992": "forecast"}}
    monkeypatch.setattr(flood_live, "_national_from_cache", lambda: [river, watch])
    s = {"products": [{"id": river["id"], "vtec_key": nws.vtec_key(river["vtec"])}, {"id": watch["id"], "vtec_key": None}]}
    assert flood_live.alerts_cost(s) == 2 + 2                       # two zones + the product list and the product
    flood_live.prefetch({"floods": [{"products": s["products"], "gauges": []}]}, now=now)
    assert flood_live.alerts_cost(s) == 0                           # warmed by the prefetch: nothing left to fetch


def test_prefetch_asks_again_for_a_product_refused_by_the_own_limit(recorded_list, monkeypatch):
    """Review BFL-R8: Disaster Mapping's own NWS limit refused the product text: it is asked again next cycle; NWS's own
    answer (or error) is final."""
    lst, now = recorded_list
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _prefetch_routes(calls))
    nws.flood_active()
    plan = flood_live.prefetch_plan(lst, flood_live._national_from_cache(), now)
    first = plan["hvtec"][0][0]["id"]
    real = nws.NWS_LIMITER.try_acquire
    monkeypatch.setattr(nws.NWS_LIMITER, "try_acquire", lambda: False)
    flood_live.prefetch(lst, now=now)
    assert flood_live.STATE.hvtec_tried == set()
    assert first in {a["id"] for a, _ in flood_live.prefetch_plan(lst, flood_live._national_from_cache(), now)["hvtec"]}
    monkeypatch.setattr(nws.NWS_LIMITER, "try_acquire", real)
    flood_live.prefetch(lst, now=now)
    assert first in flood_live.STATE.hvtec_tried


def test_satellite_passes_tried_survive_a_restart(recorded_flood, monkeypatch):
    """Review BFL-R6: the pass keys tried are kept on disk; without a measured image, the passes the build saw are
    never "new"; only a pass that appears later is."""
    summary, now, calls = recorded_flood
    m = build.build_flood(summary["id"], now=now)
    m = {**m, "layer_status": {**m["layer_status"], "water_satellite": {**m["layer_status"]["water_satellite"],
                                                                        "status": "unavailable", "time_ms": None}}}
    later = now + 2 * HOUR_MS
    seen_by_build = opera.Pass("DSWx-HLS_seen", "DSWx-HLS", "S2B", now - 3 * HOUR_MS)
    shown = {"passes": [seen_by_build]}
    monkeypatch.setattr(opera, "egis_granules", lambda bbox, end, now_ms=None: ([], now))
    monkeypatch.setattr(opera, "group_passes", lambda grans: list(shown["passes"]))
    from fire3d.sources import water_maps

    ref = m["layer_status"]["water_forecast"]["time_ms"]
    monkeypatch.setattr(water_maps, "rfc_fim", lambda bbox: water_maps.MapLayer([], ref, None, now, {}))
    assert flood_live.refresh_reason(summary["id"], m, summary, now=later) is None       # the build saw it
    assert (config.FLOODS_DIR / flood_live.LIVE_STATE_NAME).is_file()
    flood_live.reset_state()                                                              # a restart
    assert flood_live.refresh_reason(summary["id"], m, summary, now=later) is None
    newer = opera.Pass("DSWx-HLS_newer", "DSWx-HLS", "L9", now + HOUR_MS)
    shown["passes"] = [newer, seen_by_build]
    assert flood_live.refresh_reason(summary["id"], m, summary, now=later) == "satellite"
    flood_live.reset_state()                                                              # restart again
    assert flood_live.refresh_reason(summary["id"], m, summary, now=later) is None        # tried once, kept


# ---------------------------------------------------------------------------------------------------------------
# check_bundle --hazard flood, CLI
# ---------------------------------------------------------------------------------------------------------------
def test_check_bundle_flood_on_the_fixture(flood_fixture_data, monkeypatch, capsys):
    cb = load_script("check_bundle")
    rep, m = cb.check_flood_bundle(flood_fixture_data / "floods" / "fixture-flood")
    assert rep.problems == [] and m["id"] == "fixture-flood"
    monkeypatch.setattr(config, "FLOODS_DIR", flood_fixture_data / "floods")
    assert cb.main(["--hazard", "flood", "fixture-flood"]) == 0
    assert "fixture-flood: 0 problem(s)" in capsys.readouterr().out
    assert cb.main(["--hazard", "flood", "../etc"]) == 1


def test_check_bundle_flood_finds_problems(recorded_flood, monkeypatch):
    summary, now, _ = recorded_flood
    build.build_flood(summary["id"], now=now)
    bdir = store.flood_dir(summary["id"])
    cb = load_script("check_bundle")
    assert cb.check_flood_bundle(bdir)[0].problems == []
    sat = json.loads((bdir / "satellite.json").read_text())
    sat["caveats"].append("Water seen 4 d ago")             # a relative age in a frozen file (C16)
    (bdir / "satellite.json").write_text(json.dumps(sat))
    m = json.loads((bdir / "manifest.json").read_text())
    m["data_sources"] = [d for d in m["data_sources"] if d["name"] != fcopy.CREDIT_NWS]
    (bdir / "manifest.json").write_text(json.dumps(m))
    fc = bdir / m["layers"]["water_forecast"]["file"]
    raw = bytearray(fc.read_bytes())
    raw[0] = 7                                                # not a 0/255 value
    fc.write_bytes(bytes(raw))
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", "fake-token-for-the-scan-0000")
    (bdir / "gauges.json").write_text((bdir / "gauges.json").read_text().replace(
        '"caveats":[', '"caveats":["fake-token-for-the-scan-0000",', 1))
    probs = "\n".join(cb.check_flood_bundle(bdir)[0].problems)
    assert "satellite.json: holds a relative age" in probs
    assert "layer_status.warnings ok but its source is not credited" in probs
    assert "layer water_forecast: values [7]" in probs
    assert "gauges.json: holds a secret (count only)" in probs and "fake-token" not in probs


def test_cli_flood_catalog_and_build(recorded_list, monkeypatch, capsys):
    from fire3d import cli

    lst, now = recorded_list
    monkeypatch.setattr(catalog, "flood_list", lambda refresh=False: lst)
    assert cli.main(["catalog", "--hazard", "flood"]) == 0
    out = capsys.readouterr().out
    assert f"{len(lst['floods'])} live floods" in out and PLATTE in out and "Platte River flood" in out
    built: list[tuple[str, bool]] = []

    def fake_build(fid, *, progress=None, force=False, now=None):
        built.append((fid, force))
        progress("terrain", 0.5, "Fetching USGS 3DEP elevation")
        d = store.flood_dir(fid)
        d.mkdir(parents=True, exist_ok=True)
        return {"id": fid, "name": "Platte River flood", "status": "ready", "aoi_note": None, "warnings": ["w1"],
                "grid": {"extent_m": 60000, "crs": "EPSG:32615", "elev_min_m": 200, "elev_max_m": 300},
                "layer_status": {"terrain": {"status": "ok", "reason": None}}}

    monkeypatch.setattr(build, "build_flood", fake_build)
    assert cli.main(["build-flood", "platte river", "--force"]) == 0
    out = capsys.readouterr().out
    assert built == [(PLATTE, True)] and f"built {PLATTE}" in out and "layer terrain" in out and "warning: w1" in out
    assert cli.main(["build-flood", PLATTE]) == 0 and built[-1] == (PLATTE, False)

    def refused(fid, **kw):
        raise build.BuildRefused(409, fcopy.BUILD_OUTSIDE_L48)

    monkeypatch.setattr(build, "build_flood", refused)
    capsys.readouterr()
    assert cli.main(["build-flood", PLATTE]) == 1
    assert "refused (HTTP 409" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        cli.main(["build-flood", "no such river anywhere"])


_ = (nwps,)
