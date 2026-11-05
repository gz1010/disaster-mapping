"""USGS water data v1 (brief 5, backend-flood-bundle-api M1; PLAN-5 D15): measured stage and flow, no key; a 429
answers ``USGS_429``. Recorded answers (``tests/data/floods/usgs``, site 06820500, 2026-11-04) through a mock
transport; no network."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

import fire3d.http as fhttp
from fire3d.floods import copy as fcopy
from fire3d.sources import usgs_water as uw

from conftest import route_transport

USGS = Path(__file__).parent / "data" / "floods" / "usgs"
DAY = int(datetime(2026, 11, 4, tzinfo=timezone.utc).timestamp() * 1000)
HOST = "api.waterdata.usgs.gov"


@pytest.fixture
def usgs(monkeypatch, flood_iso):
    calls: list[httpx.Request] = []

    def answer(req: httpx.Request) -> httpx.Response:
        p = req.url.params["parameter_code"]
        return httpx.Response(200, content=(USGS / f"continuous_06820500_{p}.json").read_bytes(),
                              headers={"content-type": "application/json"})

    monkeypatch.setattr(fhttp, "_transport", route_transport([(HOST, r"/collections/continuous/items$", answer)], calls))
    return calls


def test_continuous_stage(usgs):
    s = uw.continuous("06820500", uw.PARAM_STAGE, DAY, DAY + 86_400_000, now_ms=DAY + 86_400_000)
    assert s.site == "USGS-06820500" and s.unit == "ft" and s.provisional is True
    assert len(s.rows) > 80 and all(isinstance(v, float) for _, v in s.rows)
    assert [t for t, _ in s.rows] == sorted(t for t, _ in s.rows)
    q = usgs[0].url.params
    assert q["monitoring_location_id"] == "USGS-06820500" and q["parameter_code"] == "00065"
    assert "api_key" not in q and "x-api-key" not in usgs[0].headers


def test_observed_series_merges_stage_and_flow(usgs):
    out = uw.observed_series("USGS-06820500", DAY, DAY + 86_400_000, now_ms=DAY + 86_400_000)
    rows = out["observed"]
    assert rows and all(len(r) == 3 for r in rows)
    assert any(r[1] is not None and r[2] is not None for r in rows)
    assert out["stage_unit"] == "ft" and out["provisional"] is True


def test_429_answers_usgs_429_and_holds(monkeypatch, flood_iso):
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", route_transport(
        [(HOST, r"/items$", httpx.Response(429, text='{"error":{"code":"OVER_RATE_LIMIT"}}', headers={"retry-after": "1"}))],
        calls))
    monkeypatch.setattr(fhttp, "_retry_delay", lambda a, r: 0.0)
    with pytest.raises(uw.UsgsBusy) as ei:
        uw.continuous("06820500", uw.PARAM_STAGE, DAY, DAY + 3_600_000)
    assert str(ei.value) == fcopy.USGS_429
    n = len(calls)
    with pytest.raises(uw.UsgsBusy):
        uw.continuous("06820500", uw.PARAM_FLOW, DAY, DAY + 3_600_000)
    assert len(calls) == n                                   # not asked again while the limit holds


def test_site_ids():
    assert uw.site_id("06820500") == "USGS-06820500" and uw.site_id("USGS-02296750") == "USGS-02296750"
    assert uw.site_id("AGYM7") is None
    with pytest.raises(ValueError):
        uw.continuous("AGYM7", uw.PARAM_STAGE, DAY, DAY + 1)
