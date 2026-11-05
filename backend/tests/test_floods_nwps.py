"""``sources/nwps.py`` (brief 5, CONTRACT 16.8): national gauge status from the NWS ``riv_gauges`` map service, the
RFC forecast points, the IEM H-VTEC join keys, and NWPS per gauge (20 s timeout, one retry, outage memory). Offline:
recorded samples in ``tests/data/floods/nwps`` (``PROVENANCE.md``) and a mock transport."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

import fire3d.http as fhttp
from fire3d import contracts as C
from fire3d.sources import nwps

DATA = Path(__file__).parent / "data" / "floods" / "nwps"


def _j(name: str):
    return json.loads((DATA / name).read_text())


OBS, FCST, RFC, IEM, NEAR = (_j(n) for n in ("riv_gauges_observed.json", "riv_gauges_forecast.json", "rfc_max_forecast.json",
                                             "iem_current_flood_warnings.json", "riv_gauges_bbox.json"))
GAUGES = sorted(p.stem.split("_")[-1] for p in DATA.glob("nwps_gauge_*.json"))


@pytest.fixture(autouse=True)
def _iso(tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(fhttp, "BACKOFF_BASE_S", 0.001)
    nwps.NWPS_DOWN.reset()
    yield
    nwps.NWPS_DOWN.reset()


def _install(monkeypatch: pytest.MonkeyPatch, handler) -> list[httpx.Request]:
    calls: list[httpx.Request] = []

    def rec(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        return handler(req)

    monkeypatch.setattr(fhttp, "_transport", httpx.MockTransport(rec))
    return calls


def test_numbers_and_times() -> None:
    assert nwps.num("25.84") == 25.84 and nwps.num(-999) is None and nwps.num("-9999") is None and nwps.num("") is None
    assert nwps.num(None) is None and nwps.num(0) == 0.0 and nwps.num(True) is None
    t = nwps.utc_ms("2026-11-04T19:00:00Z")
    assert nwps.utc_ms("2026-11-04 19:00:00") == t == nwps.utc_ms("2026-11-04 19:00:00+00") == nwps.utc_ms("2026-11-04 19:00:00 UTC")
    assert nwps.utc_ms("0001-01-01T00:00:00Z") is None and nwps.utc_ms(1793823000000) == 1793823000000
    assert nwps.category("Minor") == "minor" and nwps.category("weird") == "unknown"
    assert nwps.status_where("minor") == "status in ('minor','moderate','major')"
    with pytest.raises(ValueError):
        nwps.status_where("no_flooding")


def test_riv_rows_parse_and_obstime_is_utc() -> None:
    rows = [nwps.parse_riv_row(f) for f in OBS["features"]]
    assert all(rows) and len(rows) == len(OBS["features"])
    assert all(r["status"] in nwps.CATEGORIES for r in rows)
    assert all(isinstance(r["value"], float) or r["value"] is None for r in rows)
    r = next(r for r in rows if r["lid"] == GAUGES[0]) if any(r["lid"] == GAUGES[0] for r in rows) else rows[0]
    assert r["thresholds"]["minor"] is not None or r["thresholds"]["action"] is not None
    # R11: riv_gauges obstime (no zone) is UTC: it equals NWPS's validTime of the same reading
    for lid in GAUGES:
        sf = _j(f"nwps_stageflow_{lid}.json")
        row = next((x for x in rows if x["lid"] == lid), None)
        if row is None:
            continue
        match = [d for d in sf["observed"]["data"] if nwps.utc_ms(d["validTime"]) == row["valid_ms"]]
        assert match and abs(match[0]["primary"] - row["value"]) < 0.005, lid
    fc = [nwps.parse_riv_row(f) for f in FCST["features"]]
    assert all(f and f["forecast_issued_ms"] for f in fc)


def test_rfc_rows_and_crest_at_end() -> None:
    rows = [r for r in (nwps.parse_rfc_row(f) for f in RFC["features"]) if r]
    assert len(rows) >= 50 and all(r["producer"] and r["producer"].endswith("RFC") for r in rows)
    assert all(r["issued_ms"] for r in rows)
    end = {"properties": {"nws_lid": "ZZX1", "max_value_timestep": "2026-11-09 12:00:00 UTC",
                          "min_value_timestep": "2026-11-05 00:00:00 UTC", "max_value": 10}}
    crest = {"properties": {"nws_lid": "ZZX2", "max_value_timestep": "2026-11-06 12:00:00 UTC",
                            "min_value_timestep": "2026-11-09 12:00:00 UTC", "max_value": 10}}
    assert nwps.parse_rfc_row(end)["crest_at_end"] is True and nwps.parse_rfc_row(crest)["crest_at_end"] is False


def test_iem_join_keys() -> None:
    keys = [k for k in (nwps.parse_iem_warning(f) for f in IEM["features"]) if k]
    assert keys and all(len(k["nwsli"]) == 5 and k["nwsli"] != "00000" and k["office"].startswith("K") for k in keys)
    assert all(k["key4"] == (k["office"], "FL", "W", k["etn"]) for k in keys if k["phenomena"] == "FL")
    assert nwps.parse_iem_warning({"properties": {"hvtec_nwsli": "00000", "wfo": "DVN", "eventid": 1}}) is None


def test_national_requests_one_each_and_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if "riv_gauges/MapServer/0" in req.url.path:
            return httpx.Response(200, json=NEAR if "geometry" in req.url.params else OBS)
        if "riv_gauges/MapServer/15" in req.url.path:
            return httpx.Response(200, json=FCST)
        if "rfc_max_forecast" in req.url.path:
            return httpx.Response(200, json=RFC)
        if "current_flood_warnings" in req.url.path:
            return httpx.Response(200, json=IEM)
        return httpx.Response(404)

    calls = _install(monkeypatch, handler)
    obs, _ = nwps.riv_gauges_observed()
    fc, _ = nwps.riv_gauges_forecast("minor")
    rfc, _ = nwps.rfc_max_forecast()
    iem, _ = nwps.iem_current_flood_warnings()
    near, _ = nwps.riv_gauges_in_bbox((-99.3, 47.8, -98.5, 48.4))
    assert len(calls) == 5 and obs and fc and rfc and iem and near
    assert "status in ('minor','moderate','major')" in str(calls[1].url.params["where"])
    env = calls[4].url.params
    assert env["geometryType"] == "esriGeometryEnvelope" and env["where"] == "1=1" and env["inSR"] == "4326"
    assert not any("api.water.noaa.gov" in str(c.url) for c in calls)            # never the NWPS bbox list (C18)
    nwps.riv_gauges_observed(), nwps.rfc_max_forecast()
    assert len(calls) == 5                                                       # cached


def test_map_service_error_body_is_an_outage(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, lambda req: httpx.Response(200, json={"error": {"code": 500, "message": "boom"}}))
    with pytest.raises(nwps.SourceError):
        nwps.riv_gauges_observed()


@pytest.mark.parametrize("lid", GAUGES)
def test_gauge_detail_and_series_to_contract(lid: str) -> None:
    g, sf = _j(f"nwps_gauge_{lid}.json"), _j(f"nwps_stageflow_{lid}.json")
    rg = nwps.river_gauge(g, sf, member=True, time_zone="America/Chicago", with_series=True)
    assert C.contract_problems(C.RiverGauge, rg) == []
    assert rg["lid"] == lid and rg["url"] == f"https://water.noaa.gov/gauges/{lid.lower()}"
    assert rg["time_zone"] == "America/Chicago"                                   # never NWPS's POSIX zone
    assert any(a["text"] == "Observations courtesy of U.S. Geological Survey" for a in rg["data_attribution"])
    assert rg["series"]["observed"] and rg["series"]["stage_unit"] == "ft"
    if rg["is_forecast_point"]:
        assert rg["forecast"]["producer"].endswith("RFC") and rg["forecast"]["issued_ms"]
        assert rg["forecast"]["max_value"] == max(r[1] for r in rg["series"]["forecast"] if r[1] is not None)
    else:
        assert rg["forecast"] is None and rg["series"]["forecast"] == []


def test_crest_at_end_from_series() -> None:
    assert nwps.crest_at_end([[1, 10.0, None], [2, 11.0, None], [3, 12.0, None]]) is True
    assert nwps.crest_at_end([[1, 10.0, None], [2, 13.0, None], [3, 12.0, None]]) is False
    assert nwps.crest_at_end([[1, 10.0, None], [2, 10.0, None]]) is False
    assert nwps.crest_at_end([]) is False


def test_nwm_series_is_read_from_camel_case_keys() -> None:
    doc = next(json.loads(p.read_text()) for p in DATA.glob("nwps_reach_*_short_range.json"))
    s = nwps.nwm_series(doc, "short_range")
    assert C.contract_problems(C.ModelSeries, s) == [] and s["unit"] == "ft3/s" and len(s["points"]) >= 18
    assert nwps.nwm_series(doc, "medium_range_blend") is None


def test_per_gauge_timeout_retry_and_outage_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[dict] = []
    real = fhttp.request

    def spy(method, url, **kw):
        seen.append({"timeout": kw.get("timeout"), "retries": kw.get("retries")})
        return real(method, url, **kw)

    monkeypatch.setattr(fhttp, "request", spy)
    calls = _install(monkeypatch, lambda req: httpx.Response(503, text="busy"))
    with pytest.raises(nwps.SourceError):
        nwps.gauge("SHRN5")
    assert seen == [{"timeout": 20.0, "retries": 1}] and len(calls) == 2         # 20 s, one retry (C18)
    with pytest.raises(nwps.SourceError) as ei:
        nwps.stageflow("SHRN5")                                                   # remembered: no request for 60 s
    assert len(calls) == 2 and "less than a minute ago" in str(ei.value)
    nwps.NWPS_DOWN.reset()
    g = _j(f"nwps_gauge_{GAUGES[0]}.json")
    calls = _install(monkeypatch, lambda req: httpx.Response(200, json=g))
    doc, _ = nwps.gauge(GAUGES[0])
    assert doc["lid"] == g["lid"] and len(calls) == 1
    nwps.gauge(GAUGES[0])
    assert len(calls) == 1                                                        # cached 6 h
    _install(monkeypatch, lambda req: httpx.Response(404, json={"code": 404}))
    with pytest.raises(nwps.SourceError):
        nwps.gauge("ZZZZ9")
    assert not nwps.NWPS_DOWN.down(nwps.NWPS_HOST)                               # a 404 is not an outage
