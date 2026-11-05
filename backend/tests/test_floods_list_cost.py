"""A cold flood-list build makes at most MAX_LIST_UPSTREAM_REQUESTS upstream requests (C9): the five national
answers, and never a zone outline, a product text, a gauge detail or a series. Recorded answers via a mock transport."""

from __future__ import annotations

from pathlib import Path

import httpx
import orjson
import pytest
from conftest import FLOOD_SAMPLES

import fire3d.http as fhttp
from fire3d import contracts as C
from fire3d.floods import catalog as cat

SAMPLES = {
    "/alerts/active": FLOOD_SAMPLES / "nws" / "nws_flood_active.json",
    "riv_gauges/MapServer/0/query": FLOOD_SAMPLES / "nwps" / "riv_gauges_observed.json",
    "riv_gauges/MapServer/15/query": FLOOD_SAMPLES / "nwps" / "riv_gauges_forecast.json",
    "rfc_max_forecast/MapServer/0/query": FLOOD_SAMPLES / "nwps" / "rfc_max_forecast.json",
    "current_flood_warnings": FLOOD_SAMPLES / "nwps" / "iem_current_flood_warnings.json",
}


def test_cold_build_request_budget(flood_iso: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        for part, path in SAMPLES.items():
            if part in str(req.url):
                return httpx.Response(200, content=path.read_bytes(), headers={"content-type": "application/json"})
        return httpx.Response(599, text="unexpected request")

    monkeypatch.setattr(fhttp, "_transport", httpx.MockTransport(handler))
    lst = cat.flood_list(refresh=True)
    assert 0 < len(calls) <= cat.MAX_LIST_UPSTREAM_REQUESTS
    assert len(calls) == 5
    urls = " ".join(str(c.url) for c in calls)
    for banned in ("/zones/", "/products/", "/stageflow", "/nwps/v1/gauges", "/reaches/"):
        assert banned not in urls, banned
    assert C.contract_problems(C.FloodListResponse, cat.public_list(lst)) == [] and lst["floods"]
    assert all(s["status"] == "available" and not s["stale"] for s in lst["sources"])
    cat.flood_list()                                                    # cached: no new request
    assert len(calls) == 5
    nws_calls = [c for c in calls if "api.weather.gov" in str(c.url)]
    assert len(nws_calls) == 1                                          # one NWS request per build (shared limiter)


def test_failed_source_answers_from_its_cached_copy(flood_iso: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def good(req: httpx.Request) -> httpx.Response:
        for part, path in SAMPLES.items():
            if part in str(req.url):
                return httpx.Response(200, content=path.read_bytes(), headers={"content-type": "application/json"})
        return httpx.Response(599)

    monkeypatch.setattr(fhttp, "_transport", httpx.MockTransport(good))
    monkeypatch.setattr(fhttp, "BACKOFF_BASE_S", 0.001)
    first = cat.flood_list(refresh=True)
    # later the NWS answer is older than its 2 min cache and NWS fails: the cached copy is used, marked stale
    import time as _time
    real = _time.time
    monkeypatch.setattr(_time, "time", lambda: real() + 600)
    monkeypatch.setattr(fhttp, "_transport", httpx.MockTransport(lambda req: httpx.Response(503, text="down")))
    second = cat.flood_list(refresh=True)
    src = {s["id"]: s for s in second["sources"]}
    assert src["nws_alerts"]["stale"] is True and src["nws_alerts"]["status"] == "available"
    assert src["nws_alerts"]["reason"] == cat.STALE_REASON["nws_alerts"]
    assert {s["id"] for s in second["floods"]} == {s["id"] for s in first["floods"]}
