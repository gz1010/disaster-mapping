"""Record the past-flood test samples (brief 5, backend-flood-live M2) into ``backend/tests/data/floods/iem/``.

    cd backend && uv run python scripts/record_test_samples_flood_history.py [--out DIR] [--cache-dir DIR]

Polite and small: 9 requests through ``fire3d.http`` (Fire-3d User-Agent, cache), no key.

1. IEM ``cgi-bin/request/gis/watchwarn.py?accept=csv`` (FL.W + FF.W storm-based warnings with every follow-up
   statement's polygon: H-VTEC NWSLI and severity, damage tag, emergency flag) for 6 hours of 2025-04-03;
2. IEM ``api/1/vtec/sbw_interval.geojson`` (the issuance polygons) for the same 6 hours;
3. the NWS ``riv_gauges`` map rows of the gauges those warnings name (names, rivers, positions);
4. IEM ``json/vtec_event.py`` of a river Flood Warning at a major H-VTEC severity (KIND.FL.W.0030.2025, gauge FREI3) and of a Flash Flood Warning with a CONSIDERABLE damage threat (KLMK.FF.W.0023.2025);
5. NWPS ``/gauges/FREI3`` (no USGS site) and ``/gauges/SERI3`` (thresholds, impacts, USGS site), and USGS
   ``continuous`` stage and flow of SERI3's site for
   2025-04-02..04-12 (provisional data; two requests when one page each).

Each answer is written as received (JSON, CSV) with the request time in ``PROVENANCE.md``. The token and the FIRMS
key are never used.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fire3d import config  # noqa: E402
from fire3d import http as fhttp  # noqa: E402
from fire3d.floods import history  # noqa: E402
from fire3d.sources import nwps, nws, usgs_water  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "tests" / "data" / "floods" / "iem"
START = "2025-04-03T00:00Z"
END = "2025-04-03T06:00Z"
FL_EVENT = {"wfo": "IND", "year": 2025, "phenomena": "FL", "significance": "W", "etn": 30}
FF_EVENT = {"wfo": "LMK", "year": 2025, "phenomena": "FF", "significance": "W", "etn": 23}
GAUGE = "SERI3"                  # East Fork White River near Seymour (USGS 03365500)
NO_SITE_GAUGE = "FREI3"          # White River at Edwardsport: NWPS names no USGS site


def _ms(iso: str) -> int:
    return history._ms(iso.replace("T", " ").replace("Z", ""))  # type: ignore[return-value]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--cache-dir", type=Path, default=None, help="read back an earlier run's cache (no new request)")
    args = ap.parse_args(argv)
    if args.cache_dir:
        config.CACHE_DIR = args.cache_dir
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    log: list[str] = []
    s, e = _ms(START), _ms(END)

    def save(name: str, resp: fhttp.Response, what: str) -> None:
        (out / name).write_bytes(resp.content)
        log.append(f"- `{name}`: {what}; fetched {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(resp.fetched_ms / 1000))}"
                   f"{' (cache)' if resp.from_cache else ''}; {len(resp.content):,} bytes")
        print(f"{name}: {len(resp.content):,} bytes")

    r = fhttp.request("GET", history.WATCHWARN_URL, params=history.watchwarn_params(s, e), ttl_s=None, timeout=180)
    save("watchwarn_2025-04-03T00-06.csv", r, f"IEM watchwarn.py CSV, FL.W + FF.W issued {START}..{END}, with "
         "follow-up polygons (addsvs=1)")
    r = fhttp.request("GET", history.SBW_URL, params=history.sbw_params(s, e), ttl_s=None, timeout=180)
    save("sbw_2025-04-03T00-06.geojson", r, f"IEM api/1/vtec/sbw_interval.geojson, FL + FF issued {START}..{END}")
    import csv
    import io

    rows = list(csv.DictReader(io.StringIO((out / "watchwarn_2025-04-03T00-06.csv").read_text())))
    lids = sorted({x["hvtec_nwsli"] for x in rows if x.get("hvtec_nwsli") and x["hvtec_nwsli"] != "00000"})
    url, params = nwps.riv_gauges_query(0, "gaugelid in (" + ",".join(f"'{x}'" for x in lids[:history.GAUGE_BATCH]) + ")")
    params["outFields"] = "gaugelid,location,waterbody,state,latitude,longitude,wfo,url"
    r = fhttp.request("GET", url, params=params, ttl_s=None, timeout=60)
    save("riv_gauges_lids.json", r, f"NWS riv_gauges layer 0, the {min(len(lids), history.GAUGE_BATCH)} gauges those "
         "warnings name")
    for ev, name in ((FL_EVENT, "vtec_event_KIND_FL_W_0030_2025.json"), (FF_EVENT, "vtec_event_KLMK_FF_W_0023_2025.json")):
        r = fhttp.request("GET", nws.IEM_EVENT_URL, params=ev, ttl_s=None, timeout=60)
        save(name, r, f"IEM json/vtec_event.py {ev}")
    r = fhttp.request("GET", nwps.gauge_url(NO_SITE_GAUGE), ttl_s=None, timeout=30)
    save(f"nwps_gauge_{NO_SITE_GAUGE}.json", r, f"NWPS /gauges/{NO_SITE_GAUGE} (no USGS site)")
    r = fhttp.request("GET", nwps.gauge_url(GAUGE), ttl_s=None, timeout=30)
    save(f"nwps_gauge_{GAUGE}.json", r, f"NWPS /gauges/{GAUGE}")
    site = usgs_water.site_id(r.json().get("usgsId"))
    if site is None:
        raise SystemExit(f"{GAUGE} has no USGS site")
    t0, t1 = _ms("2025-04-04T00:00Z"), _ms("2025-04-06T00:00Z")
    for param, label in ((usgs_water.PARAM_STAGE, "stage"), (usgs_water.PARAM_FLOW, "flow")):
        params = {"monitoring_location_id": site, "parameter_code": param,
                  "time": f"{usgs_water._iso(t0)}/{usgs_water._iso(t1)}", "limit": str(usgs_water.PAGE_LIMIT),
                  "properties": "time,value,unit_of_measure,approval_status", "f": "json"}   # as usgs_water.continuous
        r = fhttp.request("GET", usgs_water.CONTINUOUS, params=params, ttl_s=None, timeout=60)
        save(f"usgs_{GAUGE}_{label}.json", r, f"USGS continuous {param} ({label}) of {site}, 2025-04-04..04-06")
    (out / "PROVENANCE.md").write_text(
        "# Past-flood test samples (brief 5, backend-flood-live M2)\n\n"
        "Recorded by `backend/scripts/record_test_samples_flood_history.py` (Fire-3d User-Agent, no key). Iowa "
        "Environmental Mesonet: an archived copy of NWS products (public domain, "
        "https://mesonet.agron.iastate.edu/disclaimer.php); NOAA NWS / NWPS (https://www.weather.gov/disclaimer); "
        "U.S. Geological Survey provisional data (https://waterdata.usgs.gov/provisional-data-statement/).\n\n"
        + "\n".join(log) + "\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
