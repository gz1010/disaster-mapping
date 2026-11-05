"""NWS flood family in ``sources/nws.py`` (brief 5, CONTRACT 16.8): flood products, H-VTEC from product text, flood
local-message scope, archived flood events. Fire defaults keep every fire answer the same (checked on the brief-2/3
recorded fire samples). Offline: recorded samples in ``tests/data/floods/nws`` and a mock transport."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from urllib.parse import unquote

import httpx
import pytest

import fire3d.http as fhttp
from fire3d.sources import nws

DATA = Path(__file__).parent / "data" / "floods" / "nws"
OFFICIAL = Path(__file__).parent / "data" / "official"
FLOOD = json.loads((DATA / "nws_flood_active.json").read_text())
PRODUCT = next(json.loads(p.read_text()) for p in DATA.glob("nws_product_*.json"))
LISTING = next(json.loads(p.read_text()) for p in DATA.glob("nws_products_*.json"))


@pytest.fixture(autouse=True)
def _reset(tmp_data_dir: Path):
    nws.reset_state()
    yield
    nws.reset_state()


def _install(monkeypatch: pytest.MonkeyPatch, handler) -> list[httpx.Request]:
    calls: list[httpx.Request] = []

    def rec(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        return handler(req)

    monkeypatch.setattr(fhttp, "_transport", httpx.MockTransport(rec))
    return calls


def test_flood_products_normalise_verbatim() -> None:
    alerts = [nws.normalize_alert(f, family="flood") for f in FLOOD["features"]]
    assert all(a is not None for a in alerts) and len(alerts) == len(FLOOD["features"])
    for a, f in zip(alerts, FLOOD["features"]):
        p = f["properties"]
        assert a["event"] == p["event"] and a["description"] == nws._verbatim(p["description"])
        assert a["sender_name"] == p["senderName"] and a["url"] == p["@id"]
        assert a["vtec"]["phenomena"] in nws.FLOOD_PHENOMENA and a["vtec"]["year"] >= 2026
        assert nws.vtec_key(a["vtec"]).startswith(a["vtec"]["office"] + ".")
        assert a["ends_ms"] == (nws._ms(p.get("ends")) or nws._ms((p["parameters"].get("eventEndingTime") or [None])[0]))
        assert a["geometry"]["type"] in ("Polygon", "MultiPolygon") and a["_geometry"] is not None
        assert a["_awips"] and a["hvtec"] is None and a["flood_ids"] == [] and a["archived"] is False
        assert a["_same"] and all(len(c) == 6 for c in a["_same"])
    assert {a["event"] for a in alerts} <= set(nws.FLOOD_EVENTS)


def test_families_never_mix() -> None:
    """A flood product is never a fire weather alert and the reverse; the fire default is unchanged."""
    fire = json.loads((OFFICIAL / "nws_alerts_lox_rfw.json").read_text())
    for f in fire["features"]:
        assert nws.normalize_alert(f, family="flood") is None
        a = nws.normalize_alert(f)
        assert a == nws.normalize_alert(f, family="fire")
        assert a is not None and set(a) >= {"id", "event", "vtec", "_zone_types"} and "emergency" not in a
    for f in FLOOD["features"]:
        assert nws.normalize_alert(f) is None
    with pytest.raises(ValueError):
        nws.normalize_alert(FLOOD["features"][0], family="smoke")


def test_vtec_year_and_emergency_tags() -> None:
    f = copy.deepcopy(FLOOD["features"][0])
    p = f["properties"]
    p["parameters"]["VTEC"] = ["/O.CON.KABQ.FF.W.0019.000000T0000Z-270101T0300Z/"]     # already in effect
    p["references"] = [{"identifier": "x", "sent": "2026-12-31T22:00:00-07:00"}]
    p["sent"] = "2027-01-01T01:00:00-07:00"
    p["event"] = "Flash Flood Warning"
    p["parameters"]["flashFloodDamageThreat"] = ["CATASTROPHIC"]
    p["parameters"]["flashFloodDetection"] = ["OBSERVED"]
    a = nws.normalize_alert(f, family="flood")
    assert a["vtec"]["year"] == 2027 or a["vtec"]["year"] == 2026
    # the oldest referenced message decides the year of an event already in effect (ETN restarts each year)
    assert a["vtec"]["year"] == nws.ms_to_dt(nws._ms("2026-12-31T22:00:00-07:00")).year
    assert a["emergency"] is True and a["damage_threat"] == "CATASTROPHIC" and a["detection"] == "OBSERVED"
    p["parameters"]["flashFloodDamageThreat"] = ["CONSIDERABLE"]
    p["parameters"]["NWSheadline"] = ["FLASH FLOOD EMERGENCY FOR SOMEWHERE"]
    assert nws.normalize_alert(f, family="flood")["emergency"] is True
    p["parameters"]["NWSheadline"] = ["FLASH FLOOD WARNING REMAINS IN EFFECT"]
    p["description"] = "Flash flooding is ongoing."
    p["headline"] = "Flash Flood Warning issued"
    assert nws.normalize_alert(f, family="flood")["emergency"] is False
    p["status"] = "Test"
    assert nws.normalize_alert(f, family="flood") is None


def test_flood_active_one_cached_request(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _install(monkeypatch, lambda req: httpx.Response(200, json=FLOOD))
    ans = nws.flood_active()
    assert len(calls) == 1
    url = unquote(str(calls[0].url))
    for ev in nws.FLOOD_EVENTS:
        assert ev in url
    assert "Coastal" not in url and "Red Flag" not in url and "area=AL,AZ" in url and ",DC," in url
    assert len(ans.alerts) == len(FLOOD["features"]) and ans.updated_ms == nws._ms(FLOOD["updated"])
    again = nws.flood_active()
    assert len(calls) == 1 and again.from_cache                     # cached 2 min


def test_flood_active_outage_is_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fhttp, "BACKOFF_BASE_S", 0.001)
    _install(monkeypatch, lambda req: httpx.Response(503, text="down"))
    with pytest.raises(nws.SourceError):
        nws.flood_active()
    _install(monkeypatch, lambda req: httpx.Response(200, json={"type": "FeatureCollection"}))
    with pytest.raises(nws.SourceError):
        nws.flood_active()


def test_hvtec_from_recorded_product_text() -> None:
    alerts = [nws.normalize_alert(f, family="flood") for f in FLOOD["features"]]
    text = PRODUCT["productText"]
    hits = [(a, nws.parse_hvtec_for(text, a)) for a in alerts if a["_awips"] and a["_awips"][3:] == PRODUCT.get("issuingOffice", "")[1:]]
    found = [h for _, h in hits if h]
    assert found, "the recorded product names a gauge for one of the recorded alerts"
    hv = found[0]
    assert len(hv["nwsli"]) == 5 and hv["nwsli"] != "00000" and hv["severity"] in "N0123U"
    assert set(hv) == {"nwsli", "severity", "cause", "begin_ms", "crest_ms", "end_ms", "record"}
    assert nws.parse_hvtec(text)


def test_hvtec_edge_cases() -> None:
    text = ("/O.EXT.KABQ.FL.W.0019.000000T0000Z-261106T1800Z/\n/SHRN5.2.ER.261104T1200Z.000000T0000Z.261106T0600Z.NO/\n"
            "/O.CON.KABQ.FA.W.0020.000000T0000Z-261105T0300Z/\n/00000.0.ER.000000T0000Z.000000T0000Z.000000T0000Z.OO/\n")
    fl = {"vtec": {"office": "KABQ", "phenomena": "FL", "significance": "W", "etn": 19}}
    fa = {"vtec": {"office": "KABQ", "phenomena": "FA", "significance": "W", "etn": 20}}
    other = {"vtec": {"office": "KABQ", "phenomena": "FL", "significance": "W", "etn": 21}}
    hv = nws.parse_hvtec_for(text, fl)
    assert hv["nwsli"] == "SHRN5" and hv["severity"] == "2" and hv["crest_ms"] is None          # crest 000000T0000Z (C7)
    assert hv["begin_ms"] == nws._vtec_time("261104T1200Z") and hv["end_ms"] == nws._vtec_time("261106T0600Z")
    assert nws.parse_hvtec_for(text, fa) is None and nws.parse_hvtec_for(text, other) is None    # 00000: no gauge
    assert [h["nwsli"] for h in nws.parse_hvtec(text)] == ["SHRN5"]


def test_product_hvtec_list_then_product_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    alerts = [nws.normalize_alert(f, family="flood") for f in FLOOD["features"]]
    a = next(x for x in alerts if x["_awips"] and nws.pick_product_id(LISTING, x["sent_ms"]) == PRODUCT["id"]
             and nws.parse_hvtec_for(PRODUCT["productText"], x))

    def handler(req: httpx.Request) -> httpx.Response:
        if "/products/types/" in req.url.path:
            return httpx.Response(200, json=LISTING)
        return httpx.Response(200, json=PRODUCT)

    calls = _install(monkeypatch, handler)
    hv = nws.product_hvtec(a)
    assert hv and hv == nws.parse_hvtec_for(PRODUCT["productText"], a) and len(calls) == 2
    assert calls[0].url.path == f"/products/types/{a['_awips'][:3]}/locations/{a['_awips'][3:]}"
    assert nws.product_hvtec(a) == hv and len(calls) == 2                            # cached for good
    assert nws.product_hvtec({**a, "vtec": {**a["vtec"], "phenomena": "FA"}}) is None and len(calls) == 2


def test_pick_product_id_tolerance() -> None:
    lst = {"@graph": [{"id": "a", "issuanceTime": "2026-11-04T17:00:00+00:00"},
                      {"id": "b", "issuanceTime": "2026-11-04T17:20:00+00:00"}]}
    t = nws._ms("2026-11-04T17:18:00+00:00")
    assert nws.pick_product_id(lst, t) == "b"
    assert nws.pick_product_id(lst, nws._ms("2026-11-04T19:00:00+00:00")) is None
    assert nws.pick_product_id({}, t) is None


def _cem(text: str, code: str = "CEM") -> dict:
    return {"id": "https://api.weather.gov/alerts/x", "type": "Feature", "geometry": None, "properties": {
        "@id": "https://api.weather.gov/alerts/x", "id": "x", "status": "Actual", "event": "Civil Emergency Message",
        "eventCode": {"SAME": [code]}, "messageType": "Alert", "senderName": "Example County",
        "headline": "Civil Emergency Message", "description": text, "geocode": {"SAME": ["035045"], "UGC": []},
        "sent": "2026-11-04T17:00:00+00:00", "references": []}}


def test_local_scope_by_hazard() -> None:
    levee = "The levee on the river has breached. Move to higher ground."
    smoke = "Smoke from a brush fire: keep windows closed."
    assert nws.local_in_scope("CEM", levee, hazard="flood") and not nws.local_in_scope("CEM", levee)
    assert nws.local_in_scope("CEM", smoke) and not nws.local_in_scope("CEM", smoke, hazard="flood")
    for code in ("FRW", "EVI", "SPW", "CDW"):
        assert nws.local_in_scope(code) and nws.local_in_scope(code, hazard="flood")
    assert nws.mentions_flood("Flash flooding on Main St") and nws.mentions_flood("dam release")
    assert not nws.mentions_flood("Waterloo road closed", "Amsterdam Avenue")
    assert nws.split_local([_cem(levee)], hazard="flood")[0] and not nws.split_local([_cem(levee)])[0]
    assert nws.normalize_local_nws(_cem(levee), "flood")["event"] == "Civil Emergency Message"


def test_national_answer_carries_flood_local_messages(monkeypatch: pytest.MonkeyPatch) -> None:
    levee = _cem("Dam failure is imminent below Example Reservoir.")
    data = {"type": "FeatureCollection", "updated": "2026-11-04T17:00:00+00:00", "features": [levee]}
    _install(monkeypatch, lambda req: httpx.Response(200, json=data))
    ans = nws.national_active()
    assert ans.local == [] and [a["id"] for a in ans.local_flood] == ["x"]


def test_bypoint_events_flood_phenomena() -> None:
    rows = [{"phenomena": "FL", "significance": "W", "eventid": 92, "wfo": "DVN", "ugc": "IAC011",
             "issue": "2026-11-04T12:00:00Z", "expire": "2026-11-06T12:00:00Z", "url": "/vtec/#2026-O-NEW-KDVN-FL-W-0092"},
            {"phenomena": "FF", "significance": "W", "eventid": 3, "wfo": "EWX", "ugc": "TXC265",
             "issue": "2025-07-04T08:00:00Z", "expire": "2025-07-04T12:00:00Z", "url": ""},
            {"phenomena": "FW", "significance": "W", "eventid": 1, "wfo": "LOX", "ugc": "CAZ288",
             "issue": "2025-01-07T08:00:00Z", "expire": "2025-01-08T12:00:00Z", "url": ""}]
    fire = nws.bypoint_events(rows, at_point=True)
    assert [ev.event for ev in fire.values()] == ["Red Flag Warning"]                   # default: fire only, as before
    flood = nws.bypoint_events(rows, at_point=True, phenomena=nws.FLOOD_PHENOMENA)
    assert sorted(ev.event for ev in flood.values()) == ["Flash Flood Warning", "Flood Warning"]
    assert ("DVN", 2026, "FL", "W", 92) in flood
    assert nws.EVENT_LABELS[("FA", "Y")] == "Flood Advisory" and nws.EVENT_LABELS[("FF", "A")] == "Flash Flood Watch"
