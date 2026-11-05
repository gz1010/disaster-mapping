"""``hazard=flood`` for evacuations and local officials' alerts (brief 5, backend-flood-bundle-api M3; PLAN-5 D23, C5):
the default ``hazard=fire`` answers are unchanged; for floods, Oregon's wildfire-only feed answers not-available with
``OR_EVAC_FIRE_ONLY`` (never "none listed") and is never asked; Cal OES zones keep their ``EVENT_TYPE`` verbatim; local
alerts use the flood scope and flood wording. Mock transports only."""

from __future__ import annotations

import copy
import warnings
from pathlib import Path

import httpx
import orjson
import pytest
from fastapi import FastAPI

import fire3d.http as fhttp
from fire3d.api import extras as ex
from fire3d.api import official as off
from fire3d.floods import copy as fcopy
from fire3d.sources import nws

from test_extras import EVAC_FEATURES, LA_BBOX, Router, client, evac_routes, router  # noqa: F401 - fixtures

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from fastapi.testclient import TestClient

OREGON_BBOX = "-122.70,44.00,-122.40,44.20"
BORDER_BBOX = "-123.60,41.90,-123.30,42.10"          # California / Oregon border


def test_fire_default_is_unchanged(router: Router, client: TestClient) -> None:
    evac_routes(router)
    plain = client.get("/api/extras/evacuations", params={"bbox": LA_BBOX})
    ex.reset_state()
    fire = client.get("/api/extras/evacuations", params={"bbox": LA_BBOX, "hazard": "fire"})
    assert plain.status_code == fire.status_code == 200
    a, b = plain.json(), fire.json()
    for d in (a, b):
        d.pop("retrieved_ms", None)
        for s in d["sources"]:
            s.pop("retrieved_ms", None)
    assert orjson.dumps(a, option=orjson.OPT_SORT_KEYS) == orjson.dumps(b, option=orjson.OPT_SORT_KEYS)
    assert "OR_EVAC" not in plain.text and fcopy.OR_EVAC_FIRE_ONLY not in plain.text
    assert client.get("/api/extras/evacuations", params={"bbox": LA_BBOX, "hazard": "smoke"}).status_code == 422


def test_flood_keeps_cal_oes_event_type_verbatim(router: Router, client: TestClient) -> None:
    feats = copy.deepcopy(EVAC_FEATURES)
    feats[0]["properties"]["EVENT_TYPE"] = "Flood"
    evac_routes(router, zones=feats)
    d = client.get("/api/extras/evacuations", params={"bbox": LA_BBOX, "hazard": "flood"}).json()
    assert d["status"] == "available"
    z = {f["id"]: f["properties"] for f in d["zones"]["features"]}
    assert z["US-CA-XLA-KAN-U017"]["event_type"] == "Flood" and z["US-CA-XLA-KAN-U017"]["status"] == "Evacuation Order"
    assert fcopy.OR_EVAC_FIRE_ONLY not in d["caveats"]


def test_flood_oregon_feed_is_fire_only_and_never_asked(router: Router, client: TestClient) -> None:
    d = client.get("/api/extras/evacuations", params={"bbox": OREGON_BBOX, "hazard": "flood"}).json()
    assert d["status"] == "unavailable" and d["reason_code"] == "state_not_available"
    assert d["reason"] == fcopy.OR_EVAC_FIRE_ONLY and d["zones"]["features"] == []
    assert router.calls == []                                   # Oregon OEM is never asked for floods
    orr = next(s for s in d["sources"] if s["id"] == "or_oem_evacuations")
    assert orr["status"] == "unavailable" and orr["reason"] == fcopy.OR_EVAC_FIRE_ONLY
    st = next(s for s in d["states"] if s["state"] == "OR")
    assert st["availability"] == "not_available" and st["checked"] is False and st["note"] == fcopy.OR_EVAC_FIRE_ONLY
    assert "none listed" not in orjson.dumps(d).decode().lower()


def test_flood_border_area_mixes_cal_oes_and_oregon_note(router: Router, client: TestClient) -> None:
    evac_routes(router, zones=[])
    d = client.get("/api/extras/evacuations", params={"bbox": BORDER_BBOX, "hazard": "flood"}).json()
    assert d["status"] == "available"
    assert fcopy.OR_EVAC_FIRE_ONLY in d["caveats"]
    assert not any("Fire_Evacuation_Areas_Public" in u for u in router.calls)
    assert {s["state"]: s["availability"] for s in d["states"]} == {"CA": "available", "OR": "not_available"}


# ---------------------------------------------------------------------------------------------------------------
# Local officials' alerts, hazard=flood
# ---------------------------------------------------------------------------------------------------------------
LOCAL_FEATURES = [
    {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[-94.9, 39.5], [-94.5, 39.5], [-94.5, 39.9],
                                                                          [-94.9, 39.9], [-94.9, 39.5]]]},
     "properties": {"id": "urn:oid:local.flood.1", "@id": "https://api.weather.gov/alerts/urn:oid:local.flood.1",
                    "event": "Civil Emergency Message", "status": "Actual", "messageType": "Alert",
                    "sent": "2026-11-04T21:00:00Z", "effective": "2026-11-04T21:00:00Z",
                    "expires": "2026-11-05T09:00:00Z", "senderName": "Platte County Emergency Management",
                    "headline": "Levee breach on the Platte River", "description": "The levee near Agency failed.",
                    "instruction": "Move to higher ground.", "areaDesc": "Buchanan, MO",
                    "geocode": {"SAME": ["029021"], "UGC": ["MOC021"]}, "affectedZones": [],
                    "parameters": {"EAS-ORG": ["CIV"], "eventCode": {"NationalWeatherService": ["CEM"]}}}},
    {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[-94.9, 39.5], [-94.5, 39.5], [-94.5, 39.9],
                                                                          [-94.9, 39.9], [-94.9, 39.5]]]},
     "properties": {"id": "urn:oid:local.fire.1", "@id": "https://api.weather.gov/alerts/urn:oid:local.fire.1",
                    "event": "Civil Emergency Message", "status": "Actual", "messageType": "Alert",
                    "sent": "2026-11-04T21:00:00Z", "effective": "2026-11-04T21:00:00Z",
                    "expires": "2026-11-05T09:00:00Z", "senderName": "Platte County Emergency Management",
                    "headline": "Grass fire near Agency", "description": "A grass fire burns near Agency.",
                    "instruction": "Avoid the area.", "areaDesc": "Buchanan, MO",
                    "geocode": {"SAME": ["029021"], "UGC": ["MOC021"]}, "affectedZones": [],
                    "parameters": {"EAS-ORG": ["CIV"], "eventCode": {"NationalWeatherService": ["CEM"]}}}},
]


@pytest.fixture
def local_client(monkeypatch, flood_iso):
    body = orjson.dumps({"type": "FeatureCollection", "features": LOCAL_FEATURES, "updated": "2026-11-04T22:00:00Z"})
    monkeypatch.setattr(fhttp, "_transport", httpx.MockTransport(
        lambda r: httpx.Response(200, content=body, headers={"content-type": "application/geo+json"})))
    monkeypatch.setattr(off, "now_ms", lambda: 1793833200000)          # 2026-11-04T23:00Z
    nws.reset_state()
    app = FastAPI()
    app.include_router(off.router)
    return TestClient(app)


def test_local_alerts_flood_scope_and_wording(local_client) -> None:
    bbox = "-94.80,39.62,-94.60,39.76"
    flood = local_client.get("/api/official/local-alerts", params={"bbox": bbox, "hazard": "flood"}).json()
    assert flood["status"] == "available"
    assert [a["id"] for a in flood["alerts"]] == ["urn:oid:local.flood.1"]           # the levee message, not the fire
    assert flood["caveats"][0] == fcopy.LOCAL_FLOOD_CAVEAT
    arch = next(c for c in flood["channels"] if c["id"] == "openfema_archive")
    assert arch["status"] == "not_checked" and arch["reason"] == fcopy.LOCAL_FLOOD_ARCHIVE_REASON
    own = orjson.dumps({k: v for k, v in flood.items() if k != "alerts"}).decode().lower()
    assert "fire" not in own                                                         # flood wording
    fire = local_client.get("/api/official/local-alerts", params={"bbox": bbox}).json()
    assert [a["id"] for a in fire["alerts"]] == ["urn:oid:local.fire.1"]             # the fire default is unchanged
    assert fire["caveats"][0] == off.LOCAL_CAVEAT
    assert local_client.get("/api/official/local-alerts",
                            params={"incident": "2026-x-abcdef", "hazard": "flood"}).status_code == 400


def test_local_alerts_flood_outside_lower48_and_nws_down(local_client, monkeypatch) -> None:
    d = local_client.get("/api/official/local-alerts", params={"bbox": "-158.0,21.2,-157.6,21.5", "hazard": "flood"}).json()
    assert d["status"] == "unavailable" and d["reason_code"] == "state_not_available" and d["alerts"] == []

    def down(r):
        raise httpx.ConnectError("down", request=r)

    nws.reset_state()
    monkeypatch.setattr(fhttp, "_transport", httpx.MockTransport(down))
    monkeypatch.setattr(fhttp, "_retry_delay", lambda a, r: 0.0)
    d = local_client.get("/api/official/local-alerts", params={"bbox": "-94.80,39.62,-94.60,39.76",
                                                                "hazard": "flood"}).json()
    assert d["status"] == "unavailable" and d["alerts"] == [] and fcopy.LOCAL_FLOOD_NWS_DOWN in d["reason"]


_ = (Path,)
