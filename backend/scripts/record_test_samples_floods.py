"""Record the offline flood samples in ``backend/tests/data/floods/nws/`` and ``backend/tests/data/floods/nwps/``.

Brief 5 (PLAN-5 M3, ``backend-flood-sources``). The samples are read by ``tests/test_floods_nws.py``,
``tests/test_floods_nwps.py``, the catalog tests and the cold-build request-count test. Run it from ``backend/``::

    uv run python scripts/record_test_samples_floods.py              # fetch, trim, check, write
    uv run python scripts/record_test_samples_floods.py --dry-run    # fetch, trim, check, write nothing

At most about 16 polite requests (one at a time, at least 1.2 s apart), made through ``fire3d.http`` with its cache in
a temporary folder (never ``data/``; ``--cache-dir`` keeps it between runs instead), no key or token sent:

* api.weather.gov: the national flood products in the lower 48 + DC, exactly as ``nws.flood_url()`` asks (1); one
  river product's text for its H-VTEC line: the product list of its type and office (1) and the product (1).
* NWS map service ``riv_gauges``: layer 0 gauges at action or worse (1), layer 15 forecasts at action or worse (1),
  and an envelope query of every gauge near the most severe one (1).
* maps.water.noaa.gov ``rfc/rfc_max_forecast`` layer 0 (1).
* Iowa Environmental Mesonet ``api/1/nws/current_flood_warnings.geojson`` (1; H-VTEC join keys).
* NWPS: gauge detail and stage/flow series of two gauges (4) and one NWM reach's short-range flow (1).

How each file is trimmed is written down in the two ``PROVENANCE.md`` files (rewritten by each run). Every sample is
checked against what the tests need before anything is written; a failed check stops the script and writes nothing.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
NWS_DIR = BACKEND / "tests" / "data" / "floods" / "nws"
NWPS_DIR = BACKEND / "tests" / "data" / "floods" / "nwps"

_TMP = tempfile.TemporaryDirectory(prefix="fire3d-record-floods-")
if "--cache-dir" not in sys.argv:
    os.environ["FIRE3D_CACHE_DIR"] = _TMP.name
else:
    os.environ["FIRE3D_CACHE_DIR"] = sys.argv[sys.argv.index("--cache-dir") + 1]

sys.path.insert(0, str(BACKEND))

from fire3d import config  # noqa: E402
from fire3d import http as fhttp  # noqa: E402
from fire3d.sources import nwps, nws  # noqa: E402

config.USER_AGENT = "Fire-3d/0.1 test-sample recorder (research prototype; a few requests per run)"
NWS_HEADERS = {"User-Agent": config.USER_AGENT, "Accept": "application/geo+json"}
TTL_S = 7 * 86400.0
PAUSE_S = 1.2
MAX_REQUESTS = 20
_requests = 0
_cached = 0                       # answers served from an earlier run's cache (--cache-dir; review BFS-R9)
_fetched_ms: list[int] = []       # when each answer was fetched from its source
STAGEFLOW_KEEP_H = 72
CATEGORY_ORDER = ("major", "moderate", "minor", "action")


def fetch_json(url: str, params: dict | None = None, headers: dict | None = None) -> object:
    global _requests, _cached
    if fhttp.peek_cache("GET", url, params, TTL_S) is None:
        _requests += 1
        if _requests > MAX_REQUESTS:
            raise SystemExit(f"request budget of {MAX_REQUESTS} reached; nothing written")
        time.sleep(PAUSE_S)
    resp = fhttp.request("GET", url, params=params, headers=headers, ttl_s=TTL_S, timeout=60.0, retries=2)
    if resp.from_cache:
        _cached += 1
    _fetched_ms.append(int(resp.fetched_ms))
    print(f"  {'cache' if resp.from_cache else 'GET  '} {fhttp.display_url(url, params)} ({len(resp.content):,} B)")
    return resp.json()


def _check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit(f"check failed: {what}; nothing written")


def _trim_stageflow(sf: dict) -> dict:
    out = json.loads(json.dumps(sf))
    obs = (out.get("observed") or {}).get("data") or []
    if obs:
        last = obs[-1]["validTime"]
        t_last = datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp()
        out["observed"]["data"] = [r for r in obs
                                   if t_last - datetime.fromisoformat(r["validTime"].replace("Z", "+00:00")).timestamp()
                                   <= STAGEFLOW_KEEP_H * 3600]
    return out


def _trim_gauge(g: dict) -> dict:
    out = json.loads(json.dumps(g))
    crests = (out.get("flood") or {}).get("crests") or {}
    for k in ("historic", "recent"):
        if isinstance(crests.get(k), list):
            crests[k] = crests[k][:8]
    out.pop("images", None)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--cache-dir", default=None)
    args = ap.parse_args(argv)
    recorded = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    files: dict[Path, object] = {}
    notes_nws: list[str] = []
    notes_nwps: list[str] = []

    print("NWS national flood products")
    url = nws.flood_url()
    alerts = fetch_json(url, None, NWS_HEADERS)
    _check(isinstance(alerts, dict) and isinstance(alerts.get("features"), list), "NWS answer")
    files[NWS_DIR / "nws_flood_active.json"] = alerts
    notes_nws.append(f"* `nws_flood_active.json`: `{url}` as recorded ({len(alerts['features'])} products, untrimmed).")

    print("riv_gauges observed / forecast, rfc_max_forecast, IEM current flood warnings")
    obs = fetch_json(*nwps.riv_gauges_query(0, nwps.status_where("action")))
    fc = fetch_json(*nwps.riv_gauges_query(15, nwps.status_where("action")))
    rfc = fetch_json(*nwps.rfc_max_forecast_query())
    iem = fetch_json(nwps.IEM_CURRENT_FLOOD_WARNINGS_URL)
    for name, doc in (("riv_gauges observed", obs), ("riv_gauges forecast", fc), ("rfc_max_forecast", rfc), ("IEM", iem)):
        _check(isinstance(doc, dict) and isinstance(doc.get("features"), list), name)
    files[NWPS_DIR / "riv_gauges_observed.json"] = obs
    files[NWPS_DIR / "riv_gauges_forecast.json"] = fc
    files[NWPS_DIR / "rfc_max_forecast.json"] = rfc
    files[NWPS_DIR / "iem_current_flood_warnings.json"] = iem
    notes_nwps += [
        f"* `riv_gauges_observed.json`, `riv_gauges_forecast.json`: `riv_gauges` layers 0 and 15, status action or worse "
        f"({len(obs['features'])} and {len(fc['features'])} gauges), untrimmed.",
        f"* `rfc_max_forecast.json`: `rfc/rfc_max_forecast` layer 0, every point ({len(rfc['features'])}), untrimmed.",
        f"* `iem_current_flood_warnings.json`: IEM current point Flood Warnings ({len(iem['features'])}), untrimmed.",
    ]

    rows = [nwps.parse_riv_row(f) for f in obs["features"]]
    rows = [r for r in rows if r and r["state"] in nws.national_states() and r["status"] in CATEGORY_ORDER]
    rows.sort(key=lambda r: (CATEGORY_ORDER.index(r["status"]), r["lid"]))
    _check(len(rows) >= 2, "two lower-48 gauges at action or worse")
    fc_lids = {nwps.parse_rfc_row(f)["lid"] for f in rfc["features"] if nwps.parse_rfc_row(f)}
    picks = [rows[0]["lid"]]
    second = next((r["lid"] for r in rows[1:] if r["lid"] in fc_lids and r["lid"] not in picks), rows[1]["lid"])
    picks.append(second)
    top = rows[0]
    print(f"gauges near {top['lid']} ({top['status']}), detail and series of {picks}")
    w, s, e, n = top["lon"] - 0.4, top["lat"] - 0.3, top["lon"] + 0.4, top["lat"] + 0.3
    near = fetch_json(*nwps.riv_gauges_query(0, "1=1", bbox=(w, s, e, n)))
    _check(isinstance(near.get("features"), list) and near["features"], "envelope query")
    files[NWPS_DIR / "riv_gauges_bbox.json"] = near
    notes_nwps.append(f"* `riv_gauges_bbox.json`: `riv_gauges` layer 0 envelope `{w:.2f},{s:.2f},{e:.2f},{n:.2f}` "
                      f"(around {top['lid']}), every status ({len(near['features'])} gauges), untrimmed.")
    reach_id = None
    for lid in picks:
        g = fetch_json(nwps.gauge_url(lid))
        sf = fetch_json(nwps.stageflow_url(lid))
        _check(isinstance(g, dict) and g.get("lid", "").upper() == lid, f"gauge {lid}")
        _check(isinstance(sf, dict) and "observed" in sf, f"stageflow {lid}")
        files[NWPS_DIR / f"nwps_gauge_{lid}.json"] = _trim_gauge(g)
        files[NWPS_DIR / f"nwps_stageflow_{lid}.json"] = _trim_stageflow(sf)
        notes_nwps.append(f"* `nwps_gauge_{lid}.json`: `/gauges/{lid}` (historic and recent crests cut to 8 each, "
                          f"`images` dropped); `nwps_stageflow_{lid}.json`: `/gauges/{lid}/stageflow` (observed cut to "
                          f"the last {STAGEFLOW_KEEP_H} h; forecast untrimmed).")
        reach_id = reach_id or g.get("reachId")
    if reach_id:
        url, params = nwps.reach_streamflow_url(str(reach_id)), {"series": "short_range"}
        rs = fetch_json(url, params)
        files[NWPS_DIR / f"nwps_reach_{reach_id}_short_range.json"] = rs
        notes_nwps.append(f"* `nwps_reach_{reach_id}_short_range.json`: `/reaches/{reach_id}/streamflow?series=short_range` "
                          "(National Water Model output), untrimmed.")

    print("one river product's text (H-VTEC)")
    flood = [nws.normalize_alert(f, family="flood") for f in alerts["features"]]
    river = [a for a in flood if a and (a.get("vtec") or {}).get("phenomena") == "FL" and a.get("_awips")]
    if river:
        a = river[0]
        ptype, loc = a["_awips"][:3], a["_awips"][3:]
        lst = fetch_json(nws.product_list_url(ptype, loc), None, {"User-Agent": config.USER_AGENT, "Accept": "application/ld+json"})
        files[NWS_DIR / f"nws_products_{ptype}_{loc}.json"] = {**lst, "@graph": (lst.get("@graph") or [])[:10]}
        pid = nws.pick_product_id(lst, a["sent_ms"])
        _check(pid is not None, "a product matching the alert's sent time")
        prod = fetch_json(nws.product_url(pid), None, {"User-Agent": config.USER_AGENT, "Accept": "application/ld+json"})
        files[NWS_DIR / f"nws_product_{pid}.json"] = prod
        hv = nws.parse_hvtec_for(prod.get("productText") or "", a)
        notes_nws.append(f"* `nws_products_{ptype}_{loc}.json`: `/products/types/{ptype}/locations/{loc}` (first 10 of "
                         f"`@graph`); `nws_product_{pid}.json`: `/products/{pid}` untrimmed (the product of alert "
                         f"`{a['id']}`; its H-VTEC NWSLI {hv['nwsli'] if hv else 'none'}).")
    print(f"{_requests} real requests, {_cached} answers from the cache of an earlier run")
    if args.dry_run:
        print("dry run: nothing written")
        return 0
    for d in (NWS_DIR, NWPS_DIR):
        d.mkdir(parents=True, exist_ok=True)
    for p, doc in files.items():
        p.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    # The answers' own fetch time and request count, also when a re-run with --cache-dir serves them from the cache
    fetched = (datetime.fromtimestamp(min(_fetched_ms) / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
               if _fetched_ms else recorded)
    how = f"{_requests + _cached} real requests through `fire3d.http`"
    if _cached:
        how += f", {_cached} of them made by an earlier run and read back here from its `--cache-dir`"
    head = (f"Recorded {fetched} by `backend/scripts/record_test_samples_floods.py` ({how}, one at a time, User-Agent "
            "\"Fire-3d/0.1 test-sample recorder\", no key or token). Public "
            "domain U.S. Government data (National Weather Service, NOAA National Water Prediction Service); the IEM file "
            "is the Iowa Environmental Mesonet's public-domain copy (https://mesonet.agron.iastate.edu/disclaimer.php).")
    (NWS_DIR / "PROVENANCE.md").write_text("# Flood samples: NWS\n\n" + head + "\n\n" + "\n".join(notes_nws) + "\n")
    (NWPS_DIR / "PROVENANCE.md").write_text("# Flood samples: river gauges and forecasts\n\n" + head + "\n\n"
                                            + "\n".join(notes_nwps) + "\n")
    print(f"wrote {len(files)} samples")
    return 0


if __name__ == "__main__":
    sys.exit(main())
