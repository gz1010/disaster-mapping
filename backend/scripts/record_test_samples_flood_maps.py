"""Record the offline samples of the flood map sources in ``backend/tests/data/floods/{maps,nfhl,opera,usgs}/``.

Brief 5 (PLAN-5 M1, ``backend-flood-bundle-api``). The samples are read by ``tests/test_floods_maps.py``,
``tests/test_floods_opera.py``, ``tests/test_floods_usgs.py`` and the bundle tests. Run it from ``backend/``::

    uv run python scripts/record_test_samples_flood_maps.py              # fetch, check, write
    uv run python scripts/record_test_samples_flood_maps.py --dry-run    # fetch, check, write nothing
    uv run python scripts/record_test_samples_flood_maps.py --lid AGYM7 --bbox -94.80,39.62,-94.60,39.76

At most :data:`MAX_REQUESTS` polite requests (one at a time, at least 1.2 s apart) through ``fire3d.http`` with its
cache in a temporary folder (never ``data/``; ``--cache-dir`` keeps it between runs), no key or token sent (the
NASA Earthdata token path is tested with a fake token and a mock transport only). The area is one river gauge in flood
(default AGYM7, Platte River near Agency, Missouri, the gauge of the NWPS samples) and a box around it:

* maps.water.noaa.gov: RFC FIM layer 0 polygons and layer 3 river lines (2), CatFIM moderate for the gauge (1), NWM
  analysis and 5-day flooded areas and high-flow reaches (3), NWM river lines of stream order 3 or more (1);
* hazards.fema.gov NFHL: layers 28 (SFHA and 0.2 % only), 0 (availability) and 3 (FIRM panel dates) (3, each up to 4
  tries: FEMA resets connections);
* NASA Earthdata GIS DSWx-HLS: the catalog of the last 10 days (1) and locked exports of up to three passes, small
  (3), plus one at 30 m of the newest usable pass (1); NASA CMR: DSWx-S1 and DSWx-HLS searches (2, no login); NASA
  GIBS: the OPERA HLS picture dates (1);
* USGS water data v1: one day of gage height and discharge at the gauge's USGS site (2).

Every sample is checked before anything is written; a failed check stops the script and writes nothing. Untrimmed
unless the ``PROVENANCE.md`` files (rewritten by each run) say otherwise.
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
OUT = BACKEND / "tests" / "data" / "floods"

_TMP = tempfile.TemporaryDirectory(prefix="fire3d-record-flood-maps-")
os.environ["FIRE3D_CACHE_DIR"] = sys.argv[sys.argv.index("--cache-dir") + 1] if "--cache-dir" in sys.argv else _TMP.name
os.environ.pop("EARTHDATA_TOKEN", None)          # never used by the recorder

sys.path.insert(0, str(BACKEND))

from fire3d import config  # noqa: E402
from fire3d import http as fhttp  # noqa: E402
from fire3d.sources import nfhl, opera, usgs_water, water_maps  # noqa: E402

config.USER_AGENT = "Disaster-Mapping/0.1 test-sample recorder (research prototype; a few requests per run)"
config.EARTHDATA_TOKEN = None
TTL_S = 7 * 86400.0
PAUSE_S = 1.2
MAX_REQUESTS = 26
_requests = 0
_cached = 0
_fetched_ms: list[int] = []
_log: list[str] = []


def fetch(url: str, params: dict | None = None, *, tries: int = 1) -> fhttp.Response:
    global _requests, _cached
    last: Exception | None = None
    for t in range(tries):
        if fhttp.peek_cache("GET", url, params, TTL_S) is None:
            _requests += 1
            if _requests > MAX_REQUESTS:
                raise SystemExit(f"request budget of {MAX_REQUESTS} reached; nothing written")
            time.sleep(PAUSE_S * (1 + 2 * t))
        try:
            resp = fhttp.request("GET", url, params=params, ttl_s=TTL_S, timeout=90.0, retries=0)
        except fhttp.HttpError as e:
            last = e
            print(f"  fail  {fhttp.display_url(url, params)}: {e.message}")
            continue
        if resp.from_cache:
            _cached += 1
        _fetched_ms.append(int(resp.fetched_ms))
        line = f"{'cache' if resp.from_cache else 'GET  '} {fhttp.display_url(url, params)} ({len(resp.content):,} B)"
        _log.append(line)
        print("  " + line)
        return resp
    raise SystemExit(f"{fhttp.display_url(url, params)} failed after {tries} tries ({last}); nothing written")


def _check(cond: bool, what: str) -> None:
    if not cond:
        raise SystemExit(f"check failed: {what}; nothing written")


def _json(resp: fhttp.Response) -> dict:
    doc = resp.json()
    _check(isinstance(doc, dict) and "error" not in doc, f"{resp.url} answered an error")
    return doc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--cache-dir", default=None, help="keep the HTTP cache here between runs")
    ap.add_argument("--lid", default="AGYM7", help="the river gauge in flood (NWS id)")
    ap.add_argument("--usgs", default="06820500", help="the gauge's USGS site number")
    ap.add_argument("--bbox", default="-94.80,39.62,-94.60,39.76", help="w,s,e,n around the gauge")
    ap.add_argument("--days", type=int, default=20, help="Earthdata GIS search window (the app uses 10; a wider one "
                                                          "records a usable pass when the last 10 days have none)")
    args = ap.parse_args(argv)
    bbox = tuple(float(x) for x in args.bbox.split(","))
    lid = args.lid.upper()
    files: dict[str, tuple[Path, bytes]] = {}

    def keep(sub: str, name: str, content: bytes) -> None:
        files[f"{sub}/{name}"] = (OUT / sub / name, content)

    # ---- NOAA water map services -------------------------------------------------------------------------------
    print("NOAA water map services")
    p = water_maps.query_params(bbox, out_fields="feature_id,streamflow_cfs,reference_time,update_time")
    p.update(resultOffset="0", resultRecordCount=str(water_maps.PAGE_SIZE), orderByFields="oid")
    r = fetch(f"{water_maps.RFC_FIM}/0/query", p)
    doc = _json(r)
    _check(len(doc.get("features") or []) > 0, "RFC FIM polygons in the box")
    keep("maps", "rfc_fim_polygons.json", r.content)
    n_poly = len(doc["features"])
    p = water_maps.query_params(bbox, out_fields="feature_id,nws_station_id,influential_forecasts,viz_status", geometry=False)
    p.update(resultOffset="0", resultRecordCount=str(water_maps.PAGE_SIZE), orderByFields="oid")
    r = fetch(f"{water_maps.RFC_FIM}/3/query", p)
    doc = _json(r)
    reaches = [water_maps.parse_reach(f) for f in doc.get("features") or []]
    member = water_maps.member_reaches([x for x in reaches if x], [lid])
    _check(bool(member), f"RFC FIM reaches tied to {lid}")
    keep("maps", "rfc_fim_reaches.json", r.content)
    n_reach = len(reaches)
    cat_params = {"where": f"ahps_lid='{lid.lower()}'", "outFields": "ahps_lid,magnitude,stage,stage_uni,fim_version",
                  "returnGeometry": "true", "outSR": "4326", "f": "geojson", "geometryPrecision": "5",
                  "maxAllowableOffset": "0.0002", "resultOffset": "0", "resultRecordCount": "2000", "orderByFields": "oid"}
    r = fetch(f"{water_maps.CATFIM}/9/query", cat_params)
    doc = _json(r)
    _check(len(doc.get("features") or []) > 0, f"CatFIM moderate polygons for {lid}")
    keep("maps", f"catfim_{lid}_moderate.json", r.content)
    nwm_counts = {}
    for kind, fields in (("nwm_analysis", "feature_id,streamflow_cfs,reference_time,update_time"),
                         ("nwm_5day", "feature_id,streamflow_cfs,reference_time,update_time"),
                         ("nwm_high_flow", "feature_id,name,recur_cat,max_flow,high_water_threshold,reference_time,"
                                           "valid_time,update_time")):
        url, layer = water_maps.NWM_LAYERS[kind]
        p = water_maps.query_params(bbox, out_fields=fields)
        p.update(resultOffset="0", resultRecordCount=str(water_maps.PAGE_SIZE), orderByFields="oid")
        r = fetch(f"{url}/{layer}/query", p)
        doc = _json(r)
        _check(isinstance(doc.get("features"), list), f"{kind} features")
        nwm_counts[kind] = len(doc["features"])
        keep("maps", f"{kind}.json", r.content)
    p = water_maps.query_params(bbox, where="strm_order >= 3", out_fields="feature_id,name,strm_order")
    p.update(resultOffset="0", resultRecordCount=str(water_maps.PAGE_SIZE), orderByFields="oid")
    r = fetch(f"{water_maps.FLOWLINES}/0/query", p)
    doc = _json(r)
    _check(len(doc.get("features") or []) > 0, "NWM river lines")
    keep("maps", "flowlines.json", r.content)
    n_lines = len(doc["features"])

    # ---- FEMA NFHL ---------------------------------------------------------------------------------------------
    print("FEMA NFHL")
    zp = {**water_maps.envelope(bbox), "where": nfhl.ZONE_WHERE, "outFields": nfhl.ZONE_FIELDS, "returnGeometry": "true",
          "outSR": "4326", "f": "geojson", "geometryPrecision": "5", "maxAllowableOffset": "0.0002",
          "resultOffset": "0", "resultRecordCount": "2000", "orderByFields": "OBJECTID"}
    r = fetch(f"{nfhl.NFHL}/28/query", zp, tries=4)
    doc = _json(r)
    zones = doc.get("features") or []
    _check(len(zones) > 0, "NFHL zones in the box")
    _check(all("MINIMAL" not in str((f.get("properties") or {}).get("ZONE_SUBTY") or "").upper() for f in zones),
           "no zone X minimal in the NFHL answer")
    keep("nfhl", "zones.json", r.content)
    ap0 = {**water_maps.envelope(bbox), "where": "1=1", "outFields": "STUDY_ID", "returnGeometry": "true",
           "outSR": "4326", "f": "geojson", "geometryPrecision": "4", "maxAllowableOffset": "0.002",
           "resultOffset": "0", "resultRecordCount": "2000", "orderByFields": "OBJECTID"}
    r = fetch(f"{nfhl.NFHL}/0/query", ap0, tries=4)
    _check(len(_json(r).get("features") or []) > 0, "NFHL availability polygons")
    keep("nfhl", "availability.json", r.content)
    pp = {**water_maps.envelope(bbox), "where": "1=1", "outFields": "EFF_DATE", "returnGeometry": "false", "f": "geojson",
          "resultOffset": "0", "resultRecordCount": "2000", "orderByFields": "OBJECTID"}
    r = fetch(f"{nfhl.NFHL}/3/query", pp, tries=4)
    panels = _json(r).get("features") or []
    _check(len(panels) > 0, "FIRM panels")
    keep("nfhl", "panels.json", r.content)

    # ---- NASA OPERA --------------------------------------------------------------------------------------------
    print("NASA OPERA")
    now = int(time.time() * 1000)
    start, end = opera.search_window(now, args.days)
    qp = opera.egis_query_params(bbox, start, end)
    r = fetch(f"{opera.EGIS_HLS}/query", qp)
    doc = _json(r)
    grans = [g for g in (opera.parse_egis_row(f) for f in doc.get("features") or []) if g]
    _check(len(grans) > 0, f"Earthdata GIS granules in the last {args.days} days")
    keep("opera", "egis_query.json", r.content)
    passes = opera.group_passes(grans)
    probes = []
    pw, ph = 160, max(8, int(round(160 * (bbox[3] - bbox[1]) / (bbox[2] - bbox[0]))))
    import numpy as np

    chosen = None
    for i, ps in enumerate(passes[:4]):
        ep = opera.export_params(bbox, 4326, pw, ph, ps.oids)
        r = fetch(f"{opera.EGIS_HLS}/exportImage", ep)
        arr = opera.read_tiff_band(r.content, (ph, pw))
        clear = float(np.isin(arr, (0, 1, 2, 252, 254)).mean())
        probes.append((ps.key, ep["mosaicRule"], clear))
        keep("opera", f"egis_probe_{i}.tif", r.content)
        if chosen is None and clear >= 0.5:
            chosen = ps
    chosen = chosen or max(passes[:4], key=lambda ps: next(c for k, _, c in probes if k == ps.key))
    fw, fh = opera.px_size(bbox, 30.0, 400)
    ep = opera.export_params(bbox, 4326, fw, fh, chosen.oids)
    r = fetch(f"{opera.EGIS_HLS}/exportImage", ep)
    arr = opera.read_tiff_band(r.content, (fh, fw))
    keep("opera", "egis_export.tif", r.content)
    uniq = sorted(int(v) for v in np.unique(arr))
    _check(any(v != 255 for v in uniq), "the chosen pass has pixels over the box")
    start, end = opera.search_window(now)
    for short, name in ((opera.S1_SHORT_NAME, "cmr_s1.json"), (opera.HLS_SHORT_NAME, "cmr_hls.json")):
        iso = lambda t: datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
        cp = {"short_name": short, "bounding_box": f"{bbox[0]:.4f},{bbox[1]:.4f},{bbox[2]:.4f},{bbox[3]:.4f}",
              "temporal": f"{iso(start)},{iso(end)}", "page_size": "100", "sort_key": "-start_date"}
        r = fetch(opera.CMR_GRANULES, cp)
        doc = _json(r)
        _check(isinstance((doc.get("feed") or {}).get("entry"), list), f"CMR {short} entries")
        keep("opera", name, r.content)
    iso = lambda t: datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    gurl = f"{opera.GIBS_ROOT}/1.0.0/{opera.GIBS_HLS_LAYER}/default/{opera.GIBS_MATRIX}/all/{iso(start)}--{iso(end)}.xml"
    r = fetch(gurl)
    _check(b"<Domain>" in r.content, "GIBS domain")
    keep("opera", "gibs_domain.xml", r.content)

    # ---- USGS --------------------------------------------------------------------------------------------------
    print("USGS water data")
    day_end = (now // 86_400_000) * 86_400_000
    day_start = day_end - 86_400_000
    usgs_n = {}
    for param in (usgs_water.PARAM_STAGE, usgs_water.PARAM_FLOW):
        up = {"monitoring_location_id": usgs_water.site_id(args.usgs), "parameter_code": param,
              "time": f"{iso(day_start)}/{iso(day_end)}", "limit": str(usgs_water.PAGE_LIMIT),
              "properties": "time,value,unit_of_measure,approval_status", "f": "json"}
        r = fetch(usgs_water.CONTINUOUS, up)
        doc = _json(r)
        _check(len(doc.get("features") or []) > 0, f"USGS {param} values")
        usgs_n[param] = len(doc["features"])
        keep("usgs", f"continuous_{args.usgs}_{param}.json", r.content)

    # ---- write -------------------------------------------------------------------------------------------------
    when = datetime.fromtimestamp(max(_fetched_ms) / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    head = (f"Recorded {when} by `backend/scripts/record_test_samples_flood_maps.py` ({_requests} real requests through "
            f"`fire3d.http`{f', {_cached} read back from an earlier run’s --cache-dir' if _cached else ''}, one at a "
            "time, User-Agent \"Disaster-Mapping/0.1 test-sample recorder\", no key or token). Area: gauge "
            f"{lid}, box `{args.bbox}`. Untrimmed answers.\n\n")
    prov = {
        "maps": head + (
            "Public domain U.S. Government data, NOAA/NWS National Water Center (experimental services; the National "
            "Water Model is model output).\n\n"
            f"* `rfc_fim_polygons.json`: `rfc/rfc_based_5day_max_inundation_extent` layer 0 ({n_poly} polygons, "
            "simplified 0.0002 deg).\n"
            f"* `rfc_fim_reaches.json`: the same service's layer 3 river lines, no geometry ({n_reach} reaches; "
            f"{len(member)} tied to {lid}).\n"
            f"* `catfim_{lid}_moderate.json`: `fim_libs/static_stage_based_catfim` layer 9 for `{lid.lower()}`.\n"
            f"* `nwm_analysis.json`, `nwm_5day.json`, `nwm_high_flow.json`: `nwm/ana_inundation_extent`, "
            f"`nwm/mrf_gfs_5day_max_inundation_extent`, `nwm/ana_high_flow_magnitude` layer 0 ({nwm_counts}).\n"
            f"* `flowlines.json`: `reference/static_nwm_flowlines` layer 0, stream order 3 or more ({n_lines}).\n"),
        "nfhl": head + (
            "FEMA National Flood Hazard Layer (effective), provided \"as is\" by FEMA "
            "(https://www.arcgis.com/home/item.html?id=ae38b6f94eaf4abf97f986fa01921e13).\n\n"
            f"* `zones.json`: layer 28, `{nfhl.ZONE_WHERE}` ({len(zones)} zones, simplified 0.0002 deg).\n"
            "* `availability.json`: layer 0 (NFHL availability).\n"
            f"* `panels.json`: layer 3 FIRM panels, `EFF_DATE` only ({len(panels)}).\n"),
        "opera": head + (
            "NASA JPL OPERA DSWx (PO.DAAC, doi:10.5067/OPDSW-PL3V1), contains modified Copernicus Sentinel data; NASA "
            "open data (CC0). No login was used.\n\n"
            f"* `egis_query.json`: Earthdata GIS DSWx-HLS catalog, last {args.days} days ({len(grans)} granules, "
            f"{len(passes)} passes).\n"
            + "".join(f"* `egis_probe_{i}.tif`: pass `{k}` locked ({pw} x {ph} px, lon/lat; clear share {c:.2f}).\n"
                      for i, (k, _, c) in enumerate(probes))
            + f"* `egis_export.tif`: pass `{chosen.key}` locked, {fw} x {fh} px (classes {uniq}).\n"
            "* `cmr_s1.json`, `cmr_hls.json`: NASA CMR granule searches (no login).\n"
            "* `gibs_domain.xml`: GIBS DescribeDomains of `OPERA_L3_Dynamic_Surface_Water_Extent-HLS`.\n"),
        "usgs": head + (
            "U.S. Geological Survey, provisional data (https://waterdata.usgs.gov/provisional-data-statement/).\n\n"
            f"* `continuous_{args.usgs}_00065.json` / `_00060.json`: USGS v1 `continuous`, one UTC day of gage height "
            f"and discharge ({usgs_n}).\n"),
    }
    print(f"{_requests} requests, {_cached} from cache; {len(files)} files")
    if args.dry_run:
        print("dry run: nothing written")
        return 0
    for _, (path, content) in sorted(files.items()):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    for sub, text in prov.items():
        (OUT / sub / "PROVENANCE.md").write_text(text.replace("’", "'"), encoding="utf-8")
    print(json.dumps(sorted(files), indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
