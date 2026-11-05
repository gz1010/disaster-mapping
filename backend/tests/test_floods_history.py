"""Past floods (brief 5, backend-flood-live M2; PLAN-5 3.6, user decision U1 (a); CONTRACT 16.2 / 16.8; SPEC 8.10).

Offline on the recorded IEM / NWS / NWPS / USGS samples of ``tests/data/floods/iem/`` (NWS Indianapolis and Louisville, 2025-04-01..05; see
``PROVENANCE.md``) and synthetic rows: the bulk route's fields, PAST_RULE, gauge episodes (one gauge flooding twice 30
days apart gives two floods), ids equal to live ids through the registry, the background year build (preparing, disk
copy, request rate, outages), the detail chain's year step, archived products at past times, USGS readings with
today's thresholds, the wording guard."""

from __future__ import annotations

import csv
import io
import json
import time
from pathlib import Path

import httpx
import orjson
import pytest
from fastapi.testclient import TestClient

import fire3d.http as fhttp
from fire3d import config
from fire3d.contracts import (
    FloodAlertsResponse, FloodDetailResponse, FloodListResponse, RiverGaugesResponse, contract_problems,
)
from fire3d.floods import catalog, history, naming
from fire3d.floods import copy as fcopy
from fire3d.floods import registry as reg_mod
from fire3d.sources import nws

from conftest import route_transport
from test_floods_copy import guard

IEM = Path(__file__).parent / "data" / "floods" / "iem"
CSV = IEM / "watchwarn_IND_LMK_2025-04-01_05.csv"
SBW = IEM / "sbw_IND_LMK_2025-04-01_05.geojson"
RIV = IEM / "riv_gauges_lids.json"
DAY = 86_400_000
HOUR = 3_600_000


@pytest.fixture(autouse=True)
def _fresh(flood_iso):
    history.reset_state()
    yield flood_iso
    history.reset_state()


def _rows() -> list[dict]:
    return list(csv.DictReader(io.StringIO(CSV.read_text())))


def _feats() -> list[dict]:
    return orjson.loads(SBW.read_bytes())["features"]


def _gauges() -> dict[str, dict]:
    from fire3d.sources import nwps

    return {r["lid"]: r for r in (nwps.parse_riv_row(f) for f in orjson.loads(RIV.read_bytes())["features"]) if r}


def _routes(calls=None, *, iem_down: bool = False):
    def down(req):
        raise httpx.ConnectError("IEM down", request=req)

    def usgs(req):
        name = "stage" if req.url.params.get("parameter_code") == "00065" else "flow"
        return httpx.Response(200, content=(IEM / f"usgs_SERI3_{name}.json").read_bytes(),
                              headers={"content-type": "application/json"})

    def nwps_gauge(req):
        lid = req.url.path.rsplit("/", 1)[-1]
        p = IEM / f"nwps_gauge_{lid}.json"
        return httpx.Response(200, content=p.read_bytes()) if p.is_file() else httpx.Response(404, json={})

    def event(req):
        key = f"K{req.url.params['wfo']}_{req.url.params['phenomena']}_W_{int(req.url.params['etn']):04d}_{req.url.params['year']}"
        p = IEM / f"vtec_event_{key}.json"
        return httpx.Response(200, content=p.read_bytes()) if p.is_file() else httpx.Response(404, json={})

    iem = "mesonet.agron.iastate.edu"
    return route_transport([
        (iem, r"/watchwarn\.py$", down if iem_down else CSV.read_bytes()),
        (iem, r"/sbw_interval\.geojson$", down if iem_down else SBW),
        (iem, r"/json/vtec_event\.py$", down if iem_down else event),
        ("mapservices.weather.noaa.gov", r"/riv_gauges/MapServer/0/query$", RIV),
        ("api.water.noaa.gov", r"^/nwps/v1/gauges/[A-Z0-9]+$", nwps_gauge),
        ("api.waterdata.usgs.gov", r"/collections/continuous/items$", usgs),
    ], calls)


# ---------------------------------------------------------------------------------------------------------------
# The bulk route's rows -> events -> PAST_RULE
# ---------------------------------------------------------------------------------------------------------------
def test_events_take_the_highest_severity_and_tags_of_every_product():
    evs = history.events_from(_rows(), _feats())
    assert evs and all(e.year == 2025 for e in evs.values())
    with_geom = [e for e in evs.values() if e.geom is not None]
    geo_keys = {(f["properties"]["wfo"], f["properties"]["phenomena"], "W", f["properties"]["eventid"],
                 f["properties"]["year"]) for f in _feats() if f["properties"]["significance"] == "W"}
    assert with_geom and len(with_geom) == len(geo_keys & set(evs))     # IEM's two windows differ: joined by key
    frei = evs[("IND", "FL", "W", 30, 2025)]
    assert frei.nwsli == "FREI3" and frei.severity == 3                 # major in a follow-up statement
    assert frei.vtec_key == "KIND.FL.W.0030.2025" and frei.product_id.endswith("FLWIND")
    # severity of the issuance alone is lower for some events: follow-up statements count (addsvs)
    new_only = {}
    for r in _rows():
        if r["status"] == "NEW":
            k = (r["wfo"], r["phenomena"], r["significance"], int(r["eventid"]), int(r["vtec_year"]))
            new_only[k] = history.SEVERITY.get(r["hvtec_severity"], 0)
    assert any(evs[k].severity > s for k, s in new_only.items() if k in evs)


def test_past_rule():
    E = history.Event
    base = dict(wfo="IND", sig="W", year=2025, issue_ms=0, expire_ms=1, last_ms=1)
    assert history.meets_rule(E(ph="FL", etn=1, nwsli="FREI3", severity=2, **base))
    assert history.meets_rule(E(ph="FL", etn=1, nwsli="FREI3", severity=3, **base))
    assert not history.meets_rule(E(ph="FL", etn=1, nwsli="FREI3", severity=1, **base))      # minor: not listed
    assert not history.meets_rule(E(ph="FL", etn=1, nwsli=None, severity=3, **base))         # no gauge
    assert history.meets_rule(E(ph="FF", etn=1, damage="CONSIDERABLE", **base))
    assert history.meets_rule(E(ph="FF", etn=1, damage="CATASTROPHIC", **base))
    assert history.meets_rule(E(ph="FF", etn=1, emergency=True, **base))
    assert not history.meets_rule(E(ph="FF", etn=1, **base))


def _ev(lid, etn, start_ms, days=2.0, ph="FL", geom=None):
    from shapely.geometry import box

    return history.Event("IND", ph, "W", etn, 2025, start_ms, start_ms + int(days * DAY), start_ms + DAY,
                         severity=2, nwsli=lid if ph == "FL" else None, damage=None if ph == "FL" else "CONSIDERABLE",
                         geom=geom or box(-87.3, 38.7, -87.1, 38.9), ugcs=["INC027"], product_id=f"P{etn}")


def test_one_gauge_flooding_twice_30_days_apart_gives_two_floods():
    t0 = 1_743_638_400_000                               # 2025-04-03
    evs = [_ev("FREI3", 30, t0), _ev("FREI3", 31, t0 + 1 * DAY), _ev("FREI3", 40, t0 + 30 * DAY)]
    groups = history.group_events(evs)
    assert sorted(len(g) for g in groups) == [1, 2]      # 30 and 31 overlap; 40 starts 27 days after 31 ended
    rows = history.build_rows({e.key: e for e in evs}, 2025, gauges=_gauges(), reg=reg_mod.get_registry())
    assert len(rows) == 2 and len({r["id"] for r in rows}) == 2
    assert all(r["primary_gauge"]["lid"] == "FREI3" for r in rows)
    assert {len(r["products"]) for r in rows} == {1, 2}
    # flash floods: overlapping polygons within 12 h are one flood, far apart in time two
    from shapely.geometry import box

    f1 = _ev(None, 50, t0, ph="FF", geom=box(-86.2, 36.8, -86.0, 37.0))
    f2 = _ev(None, 51, t0 + 2 * HOUR, ph="FF", geom=box(-86.15, 36.8, -85.95, 37.0))
    f3 = _ev(None, 52, t0 + 5 * DAY, ph="FF", geom=box(-86.2, 36.8, -86.0, 37.0))
    assert sorted(len(g) for g in history.group_events([f1, f2, f3])) == [1, 2]


def test_year_rows_from_the_recorded_day_are_contract_valid(monkeypatch):
    evs = history.events_from(_rows(), _feats())
    rows = history.build_rows(evs, 2025, gauges=_gauges(), reg=reg_mod.get_registry())
    assert rows and all(r["mode"] == "historical" and r["status"] == "inactive" for r in rows)
    frei = next(r for r in rows if (r["primary_gauge"] or {}).get("lid") == "FREI3")
    assert frei["name"] == "White River flood" or frei["name"].startswith("White River")
    assert frei["max_category"] == "major" and frei["kind"] == "river" and frei["year"] == 2025
    assert all(p["archived"] and p["phase"] == "ended" and p["url"].startswith("https://mesonet.agron.iastate.edu/vtec/")
               for p in frei["products"])
    assert all(naming.is_flood_id(r["id"]) for r in rows) and len({r["id"] for r in rows}) == len(rows)
    assert all(r["state"] in ("IN", "IL", "TX", "MS", "AR", "KY", "OH", "TN", "MO") for r in rows)
    ans = history._answer(2025, rows, [history._source("available", 1, None)], now=2, preparing=False)
    assert contract_problems(FloodListResponse, ans) == []
    assert "fire" not in " ".join(r["name"].lower() for r in rows)
    # ids are stable: the same input gives the same ids
    again = history.build_rows(history.events_from(_rows(), _feats()), 2025, gauges=_gauges(), reg=reg_mod.get_registry())
    assert [r["id"] for r in again] == [r["id"] for r in rows]


def test_2026_ids_equal_live_ids(monkeypatch):
    """A flood Disaster Mapping saw live keeps its live id (and name) in the year list; two year rows of one live id merge."""
    t0 = int(time.mktime((2026, 3, 3, 0, 0, 0, 0, 0, 0)) * 1000)
    a = _ev("FREI3", 30, t0)
    b = _ev("SERI3", 20, t0 + HOUR)
    for e in (a, b):
        e.year = 2026
    reg = reg_mod.get_registry()
    live_id = "flood-20260302-white-river-flood-abc123"
    reg.write(register=[(a.vtec_key, live_id, t0), (b.vtec_key, live_id, t0)])
    reg_mod.write_last_known({"id": live_id, "name": "White River flood (IN)"}, t0)
    rows = history.build_rows({a.key: a, b.key: b}, 2026, gauges=_gauges(), reg=reg)
    assert [r["id"] for r in rows] == [live_id]
    assert rows[0]["name"] == "White River flood (IN)" and {g["lid"] for g in rows[0]["gauges"]} == {"FREI3", "SERI3"}
    assert {p["vtec_key"] for p in rows[0]["products"]} == {a.vtec_key, b.vtec_key}


def test_last_product_is_each_events_newest_product():
    """Review BFL-R2: IEM's ``utc_prodissue`` is the issuance product's time on every follow-up row; the newest
    product is the row's own product (its id's time), and the event ends at that product's expiry."""
    evs = history.events_from(_rows(), _feats())
    lmk = evs[("LMK", "FL", "W", 50, 2025)]                    # 47 rows; product ids up to 202504261610-KLMK-...
    assert lmk.last_ms == history._ms("2025-04-26 16:10")
    assert lmk.expire_ms == history._ms("2025-04-27 10:14")
    assert lmk.issue_ms == history._ms("2025-04-03 12:49")      # the issuance product (FLW of 12:49 UTC)
    # the early rows of an "until further notice" warning keep IEM's long provisional expiry: the newest decides
    ind21 = evs[("IND", "FL", "W", 21, 2025)]
    assert ind21.expire_ms == history._ms("2025-04-15 12:45")
    rows = history.build_rows(evs, 2025, gauges=_gauges(), reg=reg_mod.get_registry(), names={})
    dunk = next(r for r in rows if (r["primary_gauge"] or {}).get("lid") == "DUNK2")
    assert dunk["last_product_ms"] == dunk["updated_ms"] >= lmk.last_ms
    assert dunk["last_product_ms"] - dunk["started_ms"] > 20 * DAY                      # weeks, not hours
    for r in rows:                                       # never older than any of its products' issue times
        assert r["last_product_ms"] >= max(p["sent_ms"] for p in r["products"])


def test_year_rows_name_the_issuing_office():
    """Review BFL-R10: archived product refs carry the issuing office (NWS's own sender name when this server knows
    it, else "NWS <office id>")."""
    evs = history.events_from(_rows(), _feats())
    rows = history.build_rows(evs, 2025, gauges=_gauges(), reg=reg_mod.get_registry(),
                              names={"KLMK": "NWS Louisville KY"})
    senders = {p["sender_name"] for r in rows for p in r["products"]}
    assert "NWS Louisville KY" in senders and "NWS IND" in senders and None not in senders
    assert history.sender_of("ABQ", {}) == "NWS ABQ"


def test_year_names_drop_state_notes_and_keep_their_ids():
    """Integration (part 2): a gauge's waterbody "Whitewater River (KS)" names "Whitewater River flood", as the live
    list does (``naming.clean_water``); the id is still made from the raw name, so past ids do not change."""
    t0 = 1_743_638_400_000                               # 2025-04-03
    gauges = _gauges()
    gauges["FREI3"] = {**gauges["FREI3"], "waterbody": "White River (IN)"}
    rows = history.build_rows({(e := _ev("FREI3", 30, t0)).key: e}, 2025, gauges=gauges, reg=reg_mod.get_registry(),
                              names={})
    assert [r["name"] for r in rows] == ["White River flood"] and rows[0]["rivers"] == ["White River"]
    assert rows[0]["id"] == naming.make_flood_id(rows[0]["started_ms"], "White River (IN) flood", "FREI3")
    plain = dict(gauges, FREI3={**gauges["FREI3"], "waterbody": "White River"})
    same = history.build_rows({e.key: e}, 2025, gauges=plain, reg=reg_mod.get_registry(), names={})
    assert same[0]["id"] == naming.make_flood_id(same[0]["started_ms"], "White River flood", "FREI3")


def test_year_rows_leave_out_floods_still_in_effect():
    """Review BFL-R3: a flood whose newest product had not expired when the year was built is current (the live
    list serves it), never a past row with "ended" products."""
    t0 = 1_743_638_400_000                               # 2025-04-03
    a = _ev("FREI3", 30, t0)                             # expires t0 + 2 days
    reg = reg_mod.get_registry()
    assert history.build_rows({a.key: a}, 2025, gauges=_gauges(), reg=reg, now=t0 + DAY, names={}) == []
    later = history.build_rows({a.key: a}, 2025, gauges=_gauges(), reg=reg, now=t0 + 3 * DAY, names={})
    assert len(later) == 1 and later[0]["status"] == "inactive"


# ---------------------------------------------------------------------------------------------------------------
# Background build, disk copy, request rate, outages
# ---------------------------------------------------------------------------------------------------------------
def _one_month(monkeypatch, year=2025):
    s = int(time.mktime((year, 4, 1, 0, 0, 0, 0, 0, 0)) * 1000)
    monkeypatch.setattr(history, "month_windows", lambda y, now: [(s, s + 30 * DAY, None), (s + 30 * DAY, s + 60 * DAY, None)])


def test_year_list_builds_in_the_background_and_is_kept(monkeypatch):
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _routes(calls))
    _one_month(monkeypatch)
    first = history.year_list(2025)
    assert first["preparing"] is True and first["floods"] == [] and first["past_rule"] == "moderate_or_worse"
    assert contract_problems(FloodListResponse, first) == []
    t = history._years[2025].thread
    t.join(30)
    done = history.year_list(2025)
    assert done["preparing"] is False and done["floods"] and done["sources"][0]["status"] == "available"
    assert done["sources"][0]["name"] == history.SOURCE_NAME and done["year"] == 2025
    assert contract_problems(FloodListResponse, done) == []
    iem = [c for c in calls if c.url.host == "mesonet.agron.iastate.edu"]
    assert len(iem) == 4                                 # two requests a month (CSV + GeoJSON)
    assert all(c.url.params.get("addsvs") == "1" for c in iem if c.url.path.endswith("watchwarn.py"))
    # kept: closed year for good (a new process reads the disk copy; no request)
    assert (config.FLOODS_DIR / "years" / "2025.json").is_file()
    history.reset_state()
    calls.clear()
    again = history.year_list(2025)
    assert again["preparing"] is False and [f["id"] for f in again["floods"]] == [f["id"] for f in done["floods"]]
    assert calls == [] and history._years[2025].thread is None


def test_year_build_waits_for_the_iem_limit(monkeypatch):
    monkeypatch.setattr(fhttp, "_transport", _routes())
    _one_month(monkeypatch)
    slots = {"n": 0}

    def try_acquire():
        slots["n"] += 1
        return slots["n"] % 3 != 1                       # every third try finds the limit used up

    monkeypatch.setattr(nws.IEM_LIMITER, "try_acquire", try_acquire)
    monkeypatch.setattr(history, "BUSY_WAIT_S", 0.01)
    ans, partial = history.build_year(2025)
    assert not partial and ans["floods"] and slots["n"] >= 5


def test_iem_down_is_an_outage_never_an_empty_year(monkeypatch):
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _routes(calls, iem_down=True))
    monkeypatch.setattr(fhttp, "_retry_delay", lambda attempt, retry_after: 0.0)
    _one_month(monkeypatch)
    ans, partial = history.build_year(2025)
    assert partial and ans["floods"] == [] and ans["preparing"] is False
    assert ans["sources"][0]["status"] == "unavailable" and ans["sources"][0]["reason"] == history.ARCHIVE_DOWN
    assert contract_problems(FloodListResponse, ans) == []


def test_partial_year_says_which_months(monkeypatch):
    monkeypatch.setattr(fhttp, "_transport", _routes())
    _one_month(monkeypatch)
    real = history.fetch_month
    n = {"i": 0}

    def flaky(start, end, ttl, **kw):
        n["i"] += 1
        if n["i"] == 2:
            raise nws.SourceError("IEM timed out")
        return real(start, end, ttl, **kw)

    monkeypatch.setattr(history, "fetch_month", flaky)
    ans, partial = history.build_year(2025)
    src = ans["sources"][0]
    assert partial and ans["floods"] and src["status"] == "available" and src["stale"] is True
    assert src["reason"].startswith("Part of the archive") and "May 2025" in src["reason"]


def test_years_not_kept_and_month_windows():
    ans = history.year_list(2019)
    assert ans["floods"] == [] and ans["sources"][0]["status"] == "unavailable"
    assert ans["sources"][0]["reason"] == history.YEAR_NOT_KEPT.format(years="2025 and 2026")
    now = int(time.mktime((2026, 11, 5, 6, 30, 0, 0, 0, 0)) * 1000)
    w = history.month_windows(2026, now)
    assert len(w) == 11 and w[-1][2] == history.MONTH_TTL_OPEN_S and w[0][2] == history.MONTH_TTL_PAST_S
    assert w[-1][1] % HOUR == 0 and w[-1][1] > now
    w25 = history.month_windows(2025, now)
    assert len(w25) == 12 and all(t is None for _, _, t in w25)          # a closed year: for good


# ---------------------------------------------------------------------------------------------------------------
# API: historical lists, the detail chain's year step
# ---------------------------------------------------------------------------------------------------------------
@pytest.fixture
def client(monkeypatch):
    from fire3d.api import app as app_mod

    monkeypatch.setattr(config, "LIVE_ENABLED", False)
    live = {"hazard": "flood", "mode": "live", "updated_ms": 1, "floods": [], "sources": [], "products_in_effect": 0,
            "_nws_ok": True, "_gauges_ok": True, "_decided": True}
    monkeypatch.setattr(catalog, "flood_list", lambda refresh=False: live)
    return TestClient(app_mod.app), live


def test_historical_route_and_year_step(client, monkeypatch):
    c, live = client
    monkeypatch.setattr(fhttp, "_transport", _routes())
    _one_month(monkeypatch)
    r = c.get("/api/floods", params={"mode": "historical", "year": 2025})
    assert r.status_code == 200 and r.json()["preparing"] is True
    history._years[2025].thread.join(30)
    body = c.get("/api/floods", params={"mode": "historical", "year": 2025}).json()
    assert contract_problems(FloodListResponse, body) == [] and body["floods"]
    fid = body["floods"][0]["id"]
    d = c.get(f"/api/floods/{fid}").json()
    assert contract_problems(FloodDetailResponse, d) == []
    assert d["resolved_from"] == "year" and d["summary"]["id"] == fid and d["summary"]["mode"] == "historical"
    # the live list comes first (rule 13): the same id listed live answers from the live list
    live["floods"] = [{**body["floods"][0], "mode": "live", "status": "active"}]
    assert c.get(f"/api/floods/{fid}").json()["resolved_from"] == "live"
    # an unknown id still ends the chain with a 404
    assert c.get("/api/floods/flood-20250403-nowhere-flood-000000").status_code == 404


def test_detail_chain_order_live_year_alias(client, monkeypatch):
    c, live = client
    monkeypatch.setattr(fhttp, "_transport", _routes())
    _one_month(monkeypatch)
    history.year_list(2025, wait=True)
    rows = history.cached_rows(2025)
    fid = rows[0]["id"]
    reg = reg_mod.get_registry()
    reg.write(aliases=[("flood-20250402-old-name-flood-aaaaaa", fid)])
    d = c.get("/api/floods/flood-20250402-old-name-flood-aaaaaa").json()
    # an alias of a year flood: catalog's alias step answers it only from a last-known summary; with none, the year
    # list does not hold the old id, so the chain ends (404) -- the year step never invents an alias
    assert d.get("resolved_from") in (None, "alias") or "detail" in d


def test_year_ids_follow_aliases_written_after_the_build(client, monkeypatch):
    """Review BFL-R3: the year list was built before Disaster Mapping merged a flood into another; its old id must open the
    canonical flood (rule 13 alias), never a past row of its own."""
    c, live = client
    monkeypatch.setattr(fhttp, "_transport", _routes())
    _one_month(monkeypatch)
    history.year_list(2025, wait=True)
    old = history.cached_rows(2025)[0]["id"]
    new = "flood-20250403-merged-river-flood-bbbbbb"
    reg_mod.get_registry().write(aliases=[(old, new)])
    rows = history.cached_rows(2025)
    ids = [r["id"] for r in rows]
    assert old not in ids and ids.count(new) == 1 and old in next(r for r in rows if r["id"] == new)["aliases"]
    assert history.find(old) is None and history.find(new)["id"] == new
    body = c.get("/api/floods", params={"mode": "historical", "year": 2025}).json()
    assert contract_problems(FloodListResponse, body) == [] and old not in {f["id"] for f in body["floods"]}
    d = c.get(f"/api/floods/{old}").json()
    assert d["resolved_from"] == "alias" and d["summary"]["id"] == new and contract_problems(FloodDetailResponse, d) == []
    # the canonical flood is live: the alias answers the live flood (catalog's alias step)
    live["floods"] = [{**history.find(new), "mode": "live", "status": "active"}]
    d2 = c.get(f"/api/floods/{old}").json()
    assert d2["resolved_from"] in ("live", "alias") and d2["summary"]["id"] == new and d2["summary"]["mode"] == "live"


def test_a_year_row_whose_warning_is_live_is_served_as_the_live_flood(client, monkeypatch):
    """Review BFL-R3: the live list holds the same VTEC event under another id: the year route serves the live row
    (once), never a "past" copy of a warning still in effect."""
    c, live = client
    monkeypatch.setattr(fhttp, "_transport", _routes())
    _one_month(monkeypatch)
    history.year_list(2025, wait=True)
    row = history.cached_rows(2025)[0]
    other = "flood-20250403-other-name-flood-cccccc"
    live["floods"] = [{**row, "id": other, "mode": "live", "status": "active",
                       "products": [{**p, "phase": "in_effect"} for p in row["products"]]}]
    body = c.get("/api/floods", params={"mode": "historical", "year": 2025}).json()
    ids = [f["id"] for f in body["floods"]]
    assert row["id"] not in ids and ids.count(other) == 1
    served = next(f for f in body["floods"] if f["id"] == other)
    assert served["mode"] == "live" and served["status"] == "active"
    assert contract_problems(FloodListResponse, body) == []


def test_a_past_flood_is_never_prepared_and_never_answers_todays_model(client, monkeypatch):
    """Review BFL-R4 / R5: "Prepare 3D data" for a year-list flood is a 409 with an honest text (never "not
    listed"); the model, NWS forecast-map and satellite routes answer a past flood at its own dates without an
    ``at_ms`` (today's National Water Model never stands for a past flood)."""
    from fire3d.api import jobs as jobs_mod
    from fire3d.api.jobs import JobManager

    c, _ = client
    monkeypatch.setattr(fhttp, "_transport", _routes())
    _one_month(monkeypatch)
    history.year_list(2025, wait=True)
    s = next(r for r in history.cached_rows(2025) if (r["primary_gauge"] or {}).get("lid") == "FREI3")
    jm = JobManager()
    jobs_mod.set_manager(jm)
    try:
        r = c.post(f"/api/floods/{s['id']}/build")
        assert r.status_code == 409 and r.json()["detail"] == history.PAST_NO_BUNDLE
        assert guard(history.PAST_NO_BUNDLE) == []
    finally:
        jm.shutdown()
        jobs_mod.set_manager(None)
    for kind in ("nwm_analysis", "nwm_series"):
        mo = c.get(f"/api/floods/{s['id']}/model", params={"kind": kind}).json()
        assert mo["status"] == "not_available_for_past_dates" and mo["model_output"] is True, kind
    fim = c.get(f"/api/floods/{s['id']}/maps", params={"kind": "rfc_fim"}).json()
    assert fim["status"] == "not_available_for_past_dates" and fim["requested_at_ms"] == s["last_product_ms"]
    al = c.get("/api/official/flood-alerts", params={"flood": s["id"]}).json()
    assert al["requested_at_ms"] == s["last_product_ms"] and al["alerts"] and al["alerts"][0]["archived"]


def test_cli_refuses_to_prepare_a_past_flood(client, monkeypatch, capsys):
    from fire3d import cli
    from fire3d.floods import build

    monkeypatch.setattr(fhttp, "_transport", _routes())
    _one_month(monkeypatch)
    history.year_list(2025, wait=True)
    fid = history.cached_rows(2025)[0]["id"]
    monkeypatch.setattr(build, "build_flood", lambda *a, **k: pytest.fail("a past flood was built"))
    assert cli.main(["build-flood", fid]) == 1
    assert history.PAST_NO_BUNDLE in capsys.readouterr().err


# ---------------------------------------------------------------------------------------------------------------
# Past products (IEM per-event archive) and past readings (USGS)
# ---------------------------------------------------------------------------------------------------------------
def _frei_summary() -> dict:
    evs = history.events_from(_rows(), _feats())
    rows = history.build_rows(evs, 2025, gauges=_gauges(), reg=reg_mod.get_registry())
    return next(r for r in rows if (r["primary_gauge"] or {}).get("lid") == "FREI3")


def test_past_flood_alerts_are_archived_verbatim(monkeypatch):
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _routes(calls))
    s = _frei_summary()
    now = int(time.time() * 1000)
    ans = history.past_flood_alerts(s, now=now, at_ms=s["last_product_ms"])
    assert contract_problems(FloodAlertsResponse, ans) == []
    assert ans["status"] == "available" and ans["source"]["credit"] == fcopy.CREDIT_IEM
    al = ans["alerts"]
    assert al and all(a["archived"] and a["phase"] == "ended" and a["message_type"] is None for a in al)
    assert {a["vtec"]["action"] for a in al} >= {"NEW", "CON"}                   # every version up to at_ms
    a0 = next(a for a in al if a["vtec"]["action"] == "NEW")
    assert a0["sender_name"] == "NWS Indianapolis IN" and a0["hvtec"]["nwsli"] == "FREI3"
    assert a0["geometry"]["type"] == "Polygon" and a0["description"] and a0["time_zone"] == "America/New_York"
    assert a0["url"].startswith("https://mesonet.agron.iastate.edu/p.php?pid=")
    raw = json.loads((IEM / "vtec_event_KIND_FL_W_0030_2025.json").read_text())
    assert a0["description"].split("\n")[0].strip() in raw["report"]["text"]   # verbatim from the product
    # at an earlier time only the versions sent by then
    early = history.past_flood_alerts(s, now=now, at_ms=a0["sent_ms"])
    assert 0 < len(early["alerts"]) < len(al)
    # before the flood: no product of it yet (never "none here")
    before = history.past_flood_alerts(s, now=now, at_ms=s["started_ms"] - 30 * DAY)
    assert before["status"] == "not_available_for_past_dates" and before["reason"] == history.PAST_BEFORE_FLOOD
    # IEM down: unavailable, never "no product"
    monkeypatch.setattr(fhttp, "_transport", _routes(iem_down=True))
    monkeypatch.setattr(fhttp, "_retry_delay", lambda attempt, retry_after: 0.0)
    nws.reset_state()
    fhttp.evict_cache("GET", nws.IEM_EVENT_URL, {"wfo": "IND", "year": 2025, "phenomena": "FL", "significance": "W",
                                                 "etn": 30})
    down = history.past_flood_alerts(s, now=now, at_ms=s["last_product_ms"])
    assert down["status"] == "unavailable" and down["reason"] == history.PAST_ALERTS_DOWN and down["alerts"] == []


def test_flash_flood_past_alert_tags(monkeypatch):
    monkeypatch.setattr(fhttp, "_transport", _routes())
    s = {"id": "flood-20250403-x-flash-flood-aaaaaa", "started_ms": 1_743_700_000_000, "bbox_lonlat": [-86.2, 36.7, -85.9, 37.1],
         "states": ["KY"], "products": [{"vtec_key": "KLMK.FF.W.0023.2025"}]}
    ans = history.past_flood_alerts(s, now=int(time.time() * 1000), at_ms=None)
    a = ans["alerts"][0]
    assert a["event"] == "Flash Flood Warning" and a["damage_threat"] == "CONSIDERABLE" and a["detection"] == "OBSERVED"
    assert contract_problems(FloodAlertsResponse, ans) == []


def test_past_gauges_use_usgs_with_todays_thresholds(monkeypatch):
    calls: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _routes(calls))
    now = int(time.time() * 1000)
    at = int(time.mktime((2025, 4, 5, 0, 0, 0, 0, 0, 0)) * 1000)
    ans = history.past_gauges(["SERI3", "FREI3"], now=now, at_ms=at, start_ms=at - DAY, end_ms=at + DAY,
                              flood_id="flood-x", area=[-87, 38, -85, 39])
    assert contract_problems(RiverGaugesResponse, ans) == []
    assert ans["status"] == "available" and ans["source"]["credit"] == fcopy.CREDIT_USGS
    for c in (fcopy.GAUGE_NOT_ALL_CLEAR, fcopy.THRESHOLDS_TODAY, fcopy.PAST_NO_FORECAST, history.NO_USGS_SITE):
        assert c in ans["caveats"]
    seri = next(g for g in ans["gauges"] if g["lid"] == "SERI3")
    assert seri["forecast"] is None and seri["series"]["forecast"] == [] and seri["thresholds"] is not None
    assert seri["series"]["observed"] and seri["observed"]["valid_ms"] <= at and seri["observed"]["value"] is not None
    assert seri["observed"]["category"] == "unknown"                 # NWS's category of a past reading is not kept
    assert seri["data_attribution"][0]["text"] == fcopy.USGS_OBSERVATIONS
    frei = next(g for g in ans["gauges"] if g["lid"] == "FREI3")
    assert frei["series"]["observed"] == [] and frei["observed"]["value"] is None
    usgs = [c for c in calls if c.url.host == "api.waterdata.usgs.gov"]
    assert usgs and all(c.url.params["monitoring_location_id"] == "USGS-03365500" for c in usgs)


def test_past_gauges_usgs_busy(monkeypatch):
    def busy(req):
        if req.url.host == "api.waterdata.usgs.gov":
            return httpx.Response(429, json={})
        return _routes().handle_request(req)

    monkeypatch.setattr(fhttp, "_transport", httpx.MockTransport(busy))
    monkeypatch.setattr(fhttp, "_retry_delay", lambda attempt, retry_after: 0.0)
    at = int(time.mktime((2025, 4, 5, 0, 0, 0, 0, 0, 0)) * 1000)
    ans = history.past_gauges(["SERI3"], now=int(time.time() * 1000), at_ms=at)
    assert fcopy.USGS_429 in ans["caveats"] and ans["gauges"][0]["series"]["observed"] == []


def test_past_routes(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(fhttp, "_transport", _routes())
    _one_month(monkeypatch)
    history.year_list(2025, wait=True)
    s = next(r for r in history.cached_rows(2025) if (r["primary_gauge"] or {}).get("lid") == "FREI3")
    al = c.get("/api/official/flood-alerts", params={"flood": s["id"], "at_ms": s["last_product_ms"]}).json()
    assert contract_problems(FloodAlertsResponse, al) == [] and al["alerts"] and al["alerts"][0]["archived"]
    area = c.get("/api/official/flood-alerts", params={"bbox": "-87.3,38.7,-87.1,38.9", "at_ms": s["last_product_ms"]}).json()
    assert area["status"] == "not_available_for_past_dates" and area["reason"] == history.PAST_AREA_ALERTS
    g = c.get("/api/official/river-gauges", params={"flood": s["id"], "at_ms": s["last_product_ms"], "series": 1}).json()
    assert contract_problems(RiverGaugesResponse, g) == [] and fcopy.THRESHOLDS_TODAY in g["caveats"]
    g1 = c.get("/api/official/river-gauges", params={"lid": "SERI3", "at_ms": s["last_product_ms"], "series": 1}).json()
    assert contract_problems(RiverGaugesResponse, g1) == [] and g1["gauges"][0]["member"] is False
    ga = c.get("/api/official/river-gauges", params={"bbox": "-87.3,38.7,-87.1,38.9", "at_ms": s["last_product_ms"]}).json()
    assert ga["status"] == "not_available_for_past_dates" and ga["reason"] == history.PAST_AREA_GAUGES
    mp = c.get(f"/api/floods/{s['id']}/maps", params={"kind": "rfc_fim", "at_ms": s["last_product_ms"]}).json()
    assert mp["status"] == "not_available_for_past_dates"


# ---------------------------------------------------------------------------------------------------------------
# Wording, CLI
# ---------------------------------------------------------------------------------------------------------------
def test_past_strings_pass_the_wording_guard():
    for name, text in history.PAST_STRINGS.items():
        assert guard(text) == [], name
        assert "all-clear" not in text or "not an all-clear" in text.lower(), name
    assert guard(history.SOURCE_NAME) == []
    assert guard("The flood ended; safe now.") != []                    # a planted word fails


def test_cli_lists_a_past_year(monkeypatch, capsys):
    from fire3d import cli

    monkeypatch.setattr(fhttp, "_transport", _routes())
    _one_month(monkeypatch)
    assert cli.main(["catalog", "--hazard", "flood", "--mode", "historical", "--year", "2025"]) == 0
    out = capsys.readouterr().out
    assert "historical floods 2025 (rule: moderate_or_worse)" in out and "White River" in out
