"""Check a built incident bundle against the contracts (SPEC 5) and write quick-look PNGs.

    cd backend && uv run python scripts/check_bundle.py <incident-id> [--quicklook DIR] [--prefix NAME]
    cd backend && uv run python scripts/check_bundle.py --hazard flood <flood-id>      # a flood bundle (SPEC 5.3)

Checks: strict pydantic validation of manifest.json, every JSON file and every forecast.json; manifest completeness
(required/optional layers, grid sizes, time origin, stats); every layer file against its LayerInfo (size, dtype,
min/max, NaN); sim/static.npz keys, shapes and ranges; timeseries/detections/perimeters/events/weather internals
(hourly axes, array lengths, GOES-based FRP series, vertex limits, monotone perimeters); forecast quantile ordering
and burn-probability consistency. Prints one line per problem and exits 1 when any check fails.

Flood bundles (``--hazard flood``, brief 5, SPEC 5.3 / CONTRACT 16.3; :func:`check_flood_bundle`): strict validation of
manifest.json (FloodManifest), warnings.json (FloodAlertsResponse), gauges.json (RiverGaugesResponse), satellite.json
(SatelliteWaterResponse) and every model/nwm_series_*.json (ModelOutputResponse); every manifest file present; the
eight layer_status keys; every layer file against its LayerInfo with the flood encodings (water_forecast and
water_model 0/255, floodplain 0-3, water_satellite the DSWx classes); the satellite PNG decodable and never transparent
where the classes say cloud or no data (D25); GeoJSON copies are FeatureCollections; every ``ok`` layer credited in
data_sources; no relative age ("4 d ago") in the frozen files (C16); no secret in any file (count only).

Quick-looks (``--quicklook``, fire bundles): hillshade x sky_view, fuels, water, dNBR (+ perimeter outline: an independent
alignment check, since Sentinel-2 is georeferenced separately from the perimeters), NAIP thumbnail (+ perimeter
and detections), observed arrival with perimeters/ignition/detections by instrument, and one map per forecast
(burn probability, p50 isochrones, start mask, final observed outline, mean wind arrow).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fire3d import bundle, config  # noqa: E402
from fire3d.contracts import (  # noqa: E402
    DetectionsFile, EventsFile, ForecastManifest, IncidentManifest, PerimetersFile, TimeseriesFile, WeatherFile,
    contract_problems,
)
from fire3d.grid import fire_grid_size, grids_from_manifest, utm_epsg_for  # noqa: E402
from fire3d.timeutil import HOUR_MS, time_origin_for  # noqa: E402
from fire3d.types import STATIC_NPZ_KEYS  # noqa: E402

REQUIRED_LAYERS = ("elevation", "fuel", "canopy_cover", "canopy_height", "observed_arrival", "naip", "sky_view", "trees")
OPTIONAL_LAYERS = ("burn_severity", "water")
LAYER_GRID = {"elevation": "render", "sky_view": "render", "water": "render", "fuel": "fire", "canopy_cover": "fire",
              "canopy_height": "fire", "burn_severity": "fire", "observed_arrival": "fire", "naip": "image", "trees": "points"}
LAYER_DTYPE = {"elevation": "float32", "sky_view": "uint8", "water": "uint8", "fuel": "uint8", "canopy_cover": "uint8",
               "canopy_height": "float32", "burn_severity": "float32", "observed_arrival": "float32", "naip": "jpeg",
               "trees": "float32"}
ITEMSIZE = {"float32": 4, "uint8": 1, "uint16": 2, "int16": 2}
NEVER = config.NEVER


class Report:
    def __init__(self) -> None:
        self.problems: list[str] = []
        self.notes: list[str] = []

    def bad(self, msg: str) -> None:
        self.problems.append(msg)

    def note(self, msg: str) -> None:
        self.notes.append(msg)

    def check(self, ok: bool, msg: str) -> bool:
        if not ok:
            self.bad(msg)
        return ok


def _strict(rep: Report, model, path: Path, label: str) -> dict | None:
    if not path.is_file():
        rep.bad(f"{label}: missing")
        return None
    raw = path.read_bytes()
    for p in contract_problems(model, raw)[:20]:
        rep.bad(f"{label}: {p}")
    try:
        return bundle.read_json(path)
    except ValueError as e:
        rep.bad(f"{label}: unreadable JSON ({e})")
        return None


def _check_layer(rep: Report, bdir: Path, name: str, info: dict, *, grid: str | None = None,
                 dtype: str | None = None) -> np.ndarray | None:
    path = bdir / info["file"]
    if not rep.check(path.is_file(), f"layer {name}: file {info['file']} missing"):
        return None
    exp_grid, exp_dtype = grid or LAYER_GRID.get(name), dtype or LAYER_DTYPE.get(name)
    if exp_grid:
        rep.check(info.get("grid") == exp_grid, f"layer {name}: grid {info.get('grid')!r}, SPEC says {exp_grid!r}")
    if exp_dtype:
        rep.check(info.get("dtype") == exp_dtype, f"layer {name}: dtype {info.get('dtype')!r}, SPEC says {exp_dtype!r}")
    size = path.stat().st_size
    if info["dtype"] == "jpeg":
        from PIL import Image

        try:
            with Image.open(path) as im:
                rep.check(im.size == (info.get("width"), info.get("height")),
                          f"layer {name}: JPEG is {im.size}, LayerInfo says {info.get('width')}x{info.get('height')}")
                rep.check(max(im.size) <= 4000, f"layer {name}: JPEG larger than 4000 px")
        except OSError as e:
            rep.bad(f"layer {name}: undecodable JPEG ({e})")
        return None
    if info.get("grid") == "points":
        n = int(info.get("count") or 0)
        rep.check(size == n * 6 * 4, f"layer {name}: {size} bytes, expected count*6*4 = {n * 24}")
    else:
        exp = int(info["width"]) * int(info["height"]) * ITEMSIZE[info["dtype"]]
        if not rep.check(size == exp, f"layer {name}: {size} bytes, expected {exp}"):
            return None
    a = bundle.read_array(bdir, info)
    if a.dtype.kind == "f":
        nan = int(np.count_nonzero(~np.isfinite(a)))
        rep.check(nan == 0, f"layer {name}: {nan} NaN/inf values")
    if info.get("grid") != "points":
        lo, hi = bundle.layer_stats(a, info.get("nodata"))
        if lo is not None and info.get("min") is not None:
            rep.check(abs(lo - info["min"]) <= 1e-3 * max(1.0, abs(lo)) and abs(hi - info["max"]) <= 1e-3 * max(1.0, abs(hi)),
                      f"layer {name}: data range {lo:.4g}..{hi:.4g} != LayerInfo {info['min']:.4g}..{info['max']:.4g}")
    return a


# ----------------------------------------------------------------------------------------------------------------
# Flood bundles (brief 5)
# ----------------------------------------------------------------------------------------------------------------
FLOOD_LAYER_IDS = ("terrain", "naip", "water_forecast", "floodplain", "water_satellite", "water_model", "warnings",
                   "gauges")
FLOOD_LAYERS = {                     # layer -> (grid, dtype, allowed values or None, its layer_status key)
    "elevation": ("render", "float32", None, "terrain"),
    "sky_view": ("render", "uint8", None, "terrain"),
    "naip": ("image", "jpeg", None, "naip"),
    "water_forecast": ("render", "uint8", {0, 255}, "water_forecast"),
    "floodplain": ("render", "uint8", {0, 1, 2, 3}, "floodplain"),
    "water_satellite": ("render", "uint8", {0, 1, 2, 252, 253, 254, 255}, "water_satellite"),
    "water_model": ("render", "uint8", {0, 255}, "water_model"),
}
# brief 6 (backend-flood-time-3d): the satellite pass rasters of timeline.json and the 3D terrain products of
# manifest.terrain3d (layer_status has no entry for them: their own status is in timeline.json / terrain3d)
FLOOD_PASS_LAYER = re.compile(r"^water_pass_[A-Za-z0-9_-]+$")
FLOOD_PASS_DEPTH_LAYER = re.compile(r"^depth_pass_[A-Za-z0-9_-]+$")      # review BTD-R3: each kept pass's depth
TERRAIN3D_LAYERS = ("hand", "depth_satellite", "depth_forecast")


def flood_layer_spec(name: str) -> tuple | None:
    """(grid, dtype, allowed values or None, its layer_status key or None) of a flood bundle layer, or None."""
    if name in FLOOD_LAYERS:
        return FLOOD_LAYERS[name]
    if FLOOD_PASS_LAYER.match(name):
        return ("render", "uint8", {0, 1, 2, 252, 253, 254, 255}, None)
    if name in TERRAIN3D_LAYERS or FLOOD_PASS_DEPTH_LAYER.match(name):
        return ("render", "uint8", None, None)
    return None


RELATIVE_AGE = re.compile(r"\b\d+(\.\d+)?\s*(s|sec|min|mins|minutes?|h|hrs?|hours?|d|days?)\s+ago\b", re.IGNORECASE)


def _secret_hits(raw: bytes) -> int:
    """How many configured secrets occur in ``raw`` (count only; the values are never printed)."""
    return sum(1 for k in (config.FIRMS_MAP_KEY, config.EARTHDATA_TOKEN) if k and k.encode() in raw)


def check_flood_bundle(bdir: Path) -> tuple[Report, dict]:
    """The flood bundle checks (module doc). Returns (report, manifest dict)."""
    from fire3d.contracts import (
        FloodAlertsResponse, FloodManifest, ModelOutputResponse, RiverGaugesResponse, SatelliteWaterResponse,
    )

    rep = Report()
    m = _strict(rep, FloodManifest, bdir / bundle.MANIFEST_NAME, "manifest.json") or {}
    if not m:
        return rep, m
    rep.check(m.get("hazard") == "flood", f"manifest hazard {m.get('hazard')!r}")
    rep.check(m.get("id") == bdir.name, f"manifest id {m.get('id')!r} != folder {bdir.name!r}")
    rep.check(m.get("status") == "ready", f"manifest status {m.get('status')!r}")
    s = m.get("summary") or {}
    rep.check(s.get("id") == m.get("id"), "summary.id != manifest id")
    if s.get("synthetic"):
        rep.note("synthetic bundle (fixture): terrain, water layers and gauges are made up")
    else:
        rep.check(s.get("bundle_status") == "ready", f"summary.bundle_status {s.get('bundle_status')!r}")
        rep.check(s.get("bundle_built_ms") == m.get("built_ms"), "summary.bundle_built_ms != built_ms")
    tr = m.get("time_range") or {}
    rep.check(m.get("time_origin_ms") == tr.get("start_ms"), "time_origin_ms != time_range.start_ms")
    rep.check(tr.get("start_ms", 0) <= tr.get("now_ms", 0) <= tr.get("end_ms", 0), "time_range: not start <= now <= end")
    g = m["grid"]
    rep.check(g["render"]["width"] == config.RENDER_SIZE == g["render"]["height"], "render grid is not 1024²")
    rep.check(8000 - 1 <= float(g["extent_m"]) <= config.AOI_MAX_EXTENT_M + 1,
              f"area {g['extent_m']} m outside 8-{config.AOI_MAX_EXTENT_M / 1000:g} km")
    ls = m.get("layer_status") or {}
    rep.check(set(ls) == set(FLOOD_LAYER_IDS), f"layer_status keys {sorted(ls)} != the eight FloodLayerId keys")
    for name in ("elevation", "sky_view"):
        rep.check(name in (m.get("layers") or {}), f"layer {name} missing")
    rep.check((ls.get("terrain") or {}).get("status") == "ok", "terrain is not ok (it is required)")
    # layers against their LayerInfo, with the flood encodings
    for name, info in (m.get("layers") or {}).items():
        exp = flood_layer_spec(name)
        if not rep.check(exp is not None, f"layer {name}: not a flood layer"):
            continue
        grid, dtype, values, key = exp
        if key is not None:
            rep.check((ls.get(key) or {}).get("status") == "ok",
                      f"layer {name} written but layer_status.{key} is not ok")
        a = _check_layer(rep, bdir, name, info, grid=grid, dtype=dtype)
        if a is not None and values is not None:
            extra = sorted(set(np.unique(a).tolist()) - values)
            rep.check(not extra, f"layer {name}: values {extra[:8]} outside {sorted(values)}")
    for key, name in (("water_forecast", "water_forecast"), ("floodplain", "floodplain"),
                      ("water_satellite", "water_satellite"), ("water_model", "water_model")):
        if (ls.get(key) or {}).get("status") == "ok":
            rep.check(name in (m.get("layers") or {}), f"layer_status.{key} ok but layer {name} missing")
    # files
    f = m.get("files") or {}
    w = _strict(rep, FloodAlertsResponse, bdir / f.get("warnings", "warnings.json"), "warnings.json")
    gz = _strict(rep, RiverGaugesResponse, bdir / f.get("gauges", "gauges.json"), "gauges.json")
    sat = _strict(rep, SatelliteWaterResponse, bdir / f["satellite"], "satellite.json") if f.get("satellite") else None
    if w is not None:
        rep.check(w.get("kind") == "flood_alerts", "warnings.json kind != flood_alerts")
        if w.get("status") != "available":
            rep.note(f"warnings.json: {w.get('status')} ({w.get('reason')})")
    if gz is not None:
        rep.check(gz.get("kind") == "river_gauges", "gauges.json kind != river_gauges")
        members = [x for x in gz.get("gauges") or [] if x.get("member")]
        rep.check(all(x.get("series") is not None for x in members) or gz.get("status") != "available",
                  "gauges.json: a member gauge without its series")
        rep.check(not members or members[0]["lid"] == ((s.get("primary_gauge") or {}).get("lid") or members[0]["lid"]),
                  "gauges.json: the primary gauge is not first")
        if gz.get("status") == "available":
            from fire3d.floods import copy as fcopy

            # notes, not problems: NWPS may not know a gauge, or could not be read at build time (review BFL-R1)
            have = {x["lid"] for x in members}
            missing = [g["lid"] for g in s.get("gauges") or [] if g.get("lid") not in have]
            if missing:
                rep.note(f"gauges.json: member gauge(s) of the summary not in it: {', '.join(missing)}")
            if fcopy.GAUGE_DETAIL_DOWN in (gz.get("caveats") or []):
                bare = [x["lid"] for x in members if not (x.get("data_attribution") or x.get("impacts") or x.get("reach_id"))]
                rep.note("gauges.json: NWPS could not be read; member gauge(s) with the NWS gauge map's reading only: "
                         + (", ".join(bare) or "none"))
    if f.get("timeline"):                                         # brief 6: the frozen time history
        from fire3d.contracts import FloodTimelineResponse

        tl = _strict(rep, FloodTimelineResponse, bdir / f["timeline"], f["timeline"])
        if tl is not None:
            for ps in (tl.get("passes") or {}).get("passes") or []:
                if ps.get("layer"):
                    rep.check(ps["layer"] in (m.get("layers") or {}), f"timeline pass {ps['key']}: layer missing")
                if ps.get("depth_layer"):
                    rep.check(ps["depth_layer"] in (m.get("layers") or {}),
                              f"timeline pass {ps['key']}: depth layer missing")
    for w in m.get("warnings") or []:
        if w.startswith("The refresh of "):
            rep.note(f"refresh kept earlier copies: {w}")
    if f.get("satellite_image"):
        p = bdir / f["satellite_image"]
        if rep.check(p.is_file(), f"{f['satellite_image']} missing"):
            from PIL import Image

            try:
                with Image.open(p) as im:
                    rgba = np.asarray(im.convert("RGBA"))
                rep.check(rgba.shape[2] == 4, "satellite.png has no alpha")
                if sat is not None and sat.get("stats") and (sat["stats"].get("cloud_pct") or 0) + (
                        sat["stats"].get("nodata_pct") or 0) > 0:
                    rep.check(bool((rgba[..., 3] > 0).any()), "satellite.png is fully transparent although the image "
                              "has cloud or no-data pixels (D25: no view is hatched, never transparent)")
            except OSError as e:
                rep.bad(f"satellite.png undecodable ({e})")
    if "water_satellite" in (m.get("layers") or {}) and sat is not None:
        rep.check(bool(sat.get("measured")), "water_satellite.bin written from an unmeasured picture")
    for kind, files in (("maps", f.get("maps") or {}), ("model", f.get("model") or {})):
        for key, rel in files.items():
            p = bdir / rel
            if not rep.check(p.is_file(), f"files.{kind}.{key}: {rel} missing"):
                continue
            if rel.endswith(".geojson"):
                try:
                    fc = bundle.read_json(p)
                    rep.check(isinstance(fc, dict) and fc.get("type") == "FeatureCollection"
                              and isinstance(fc.get("features"), list), f"{rel}: not a FeatureCollection")
                except ValueError as e:
                    rep.bad(f"{rel}: unreadable JSON ({e})")
            elif key.startswith("nwm_series_"):
                mo = _strict(rep, ModelOutputResponse, p, rel)
                rep.check(bool(mo and mo.get("model_output") is True), f"{rel}: not marked model output")
    # credits: every ok layer named in data_sources by its credit line
    names = {d.get("name") for d in m.get("data_sources") or []}
    for key, st in ls.items():
        if st.get("status") == "ok" and st.get("source") and not s.get("synthetic"):
            rep.check(st["source"] in names, f"layer_status.{key} ok but its source is not credited in data_sources")
    # absolute times only (C16) and no secret, in every JSON file of the bundle
    for p in sorted(bdir.rglob("*.json")):
        if any(part.startswith(".") for part in p.relative_to(bdir).parts):
            continue
        raw = p.read_bytes()
        rel = p.relative_to(bdir).as_posix()
        if not rel.startswith("api/"):
            rep.check(RELATIVE_AGE.search(raw.decode("utf-8", "replace")) is None, f"{rel}: holds a relative age")
        rep.check(_secret_hits(raw) == 0, f"{rel}: holds a secret (count only)")
    size = sum(p.stat().st_size for p in bdir.rglob("*") if p.is_file()) / 1e6
    rep.note(f"size {size:.1f} MB; layers {', '.join(sorted(m.get('layers') or {}))}; "
             + ", ".join(f"{k} {v.get('status')}" for k, v in sorted(ls.items())))
    if m.get("refreshed_ms"):
        rep.note(f"refreshed by the flood live loop at {m['refreshed_ms']}")
    return rep, m


def check_bundle(bdir: Path) -> tuple[Report, dict]:
    rep = Report()
    m = _strict(rep, IncidentManifest, bdir / bundle.MANIFEST_NAME, "manifest.json") or {}
    if not m:
        return rep, m
    rep.check(m.get("status") == "ready", f"manifest status {m.get('status')!r}")
    s = m.get("summary") or {}
    rep.check(s.get("bundle_status") == "ready", f"summary.bundle_status {s.get('bundle_status')!r}")
    rep.check(s.get("bundle_built_ms") == m.get("built_ms"), "summary.bundle_built_ms != built_ms")
    rep.check(m.get("time_origin_ms") == time_origin_for(int(s.get("started_ms", 0))),
              "time_origin_ms != floor_to_hour(started_ms) - 1 h")
    g = m["grid"]
    render, fire = grids_from_manifest(m)
    rep.check(g["render"]["width"] == 1024 == g["render"]["height"], "render grid is not 1024²")
    M = fire_grid_size(float(g["extent_m"]))
    rep.check(g["fire"]["width"] == M == g["fire"]["height"], f"fire grid {g['fire']['width']} != SPEC M {M}")
    rep.check(abs(g["fire"]["res_m"] - g["extent_m"] / M) < 1e-6, "fire res_m != extent/M")
    # Standard UTM zone (SPEC 4.1, brief 3): of the AOI centre (the analysis area's bbox, as grid.make_aoi chose it),
    # or of the incident point; both agree except for a fire within an AOI's half-width of a zone line.
    bb = g.get("bbox_lonlat") or []
    exp = {utm_epsg_for(float(s.get("lon", 0)))}
    if len(bb) == 4:
        exp.add(utm_epsg_for((float(bb[0]) + float(bb[2])) / 2.0))
    rep.check(g["crs"] in {f"EPSG:{e}" for e in exp},
              f"crs {g['crs']} but the incident longitude says EPSG:{'/'.join(str(e) for e in sorted(exp))}")
    rep.check(int(g.get("utm_zone", -1)) == int(str(g["crs"]).split(":")[-1]) - 32600,
              f"utm_zone {g.get('utm_zone')} does not match crs {g['crs']}")
    lay = m.get("layers") or {}
    for k in REQUIRED_LAYERS:
        rep.check(k in lay, f"required layer {k!r} missing")
    for k in OPTIONAL_LAYERS:
        if k not in lay:
            rep.note(f"optional layer {k!r} absent")
    arrays: dict[str, np.ndarray] = {}
    for k, info in lay.items():
        a = _check_layer(rep, bdir, k, info)
        if a is not None:
            arrays[k] = a
    if "elevation" in arrays:
        e = arrays["elevation"]
        rep.check(abs(float(e.min()) - g["elev_min_m"]) < 1 and abs(float(e.max()) - g["elev_max_m"]) < 1,
                  "grid.elev_min_m/elev_max_m do not match the elevation layer")
    if "fuel" in arrays:
        f = arrays["fuel"]
        bad = np.setdiff1d(np.unique(f), np.r_[0, 91:100, 101:110, 121:125, 141:150, 161:166, 181:190, 201:205])
        rep.check(bad.size == 0, f"fuel: non-FBFM40 codes {bad[:10].tolist()}")
        rep.note(f"fuel: non-burnable (91-99) {np.isin(f, range(91, 100)).mean() * 100:.1f}%, urban 91 {np.mean(f == 91) * 100:.1f}%")
    if "trees" in arrays:
        t = arrays["trees"]
        half = g["extent_m"] / 2
        rep.check(bool(np.all(np.abs(t[:, 0]) <= half + 1) and np.all(np.abs(t[:, 2]) <= half + 1)), "trees outside the AOI")
        rep.check(set(np.unique(t[:, 5]).astype(int)) <= {0, 1, 2}, "trees: kind outside 0/1/2")
        rep.check(len(t) <= 120_000, f"trees: {len(t)} > 120,000")
    # sim/static.npz
    p = bdir / bundle.STATIC_NPZ
    if rep.check(p.is_file(), "sim/static.npz missing"):
        z = bundle.read_npz(p)
        for k in STATIC_NPZ_KEYS:
            if rep.check(k in z, f"static.npz: {k} missing"):
                rep.check(z[k].shape == (M, M), f"static.npz: {k} shape {z[k].shape}")
        if all(k in z for k in STATIC_NPZ_KEYS):
            rep.check(z["fuel_model"].dtype == np.int16, f"static.npz: fuel_model dtype {z['fuel_model'].dtype}")
            rep.check(float(np.nanmin(z["aspect"])) >= 0 and float(np.nanmax(z["aspect"])) <= 360, "static.npz: aspect outside 0..360")
            rep.check(float(np.nanmin(z["slope"])) >= 0, "static.npz: negative slope")
            rep.check(0 <= float(np.nanmin(z["canopy_cover"])) and float(np.nanmax(z["canopy_cover"])) <= 1, "static.npz: canopy_cover not 0..1")
            rep.check(float(np.nanmax(z["canopy_bulk_density"])) < 2, "static.npz: canopy_bulk_density > 2 kg/m³ (unscaled?)")
            rep.check(float(np.nanmax(z["canopy_base_height"])) < 100, "static.npz: canopy_base_height > 100 m (unscaled?)")
            if "fuel" in arrays:   # identical except nodata: 0 in fuel.bin, non-burnable 99 for the simulation (SPEC 8.2)
                fl, fz = arrays["fuel"].astype(np.int64), z["fuel_model"].astype(np.int64)
                rep.check(bool(np.all((fl == fz) | ((fl == 0) & (fz == 99)))), "static.npz fuel_model != layers/fuel.bin")
            # aspect convention spot check: downslope-facing (the direction of steepest descent)
            el = z["elevation"].astype(np.float64)
            res = float(g["fire"]["res_m"])
            dr, dc = np.gradient(el, res)
            de, dn = dc, -dr                                    # d(elev)/d(east), d(elev)/d(north)
            asp = np.degrees(np.arctan2(-de, -dn)) % 360        # direction of descent, cw from N
            steep = np.hypot(de, dn) > 0.2
            if steep.any():
                diff = np.abs(((asp - z["aspect"]) + 180) % 360 - 180)[steep]
                rep.check(float(np.median(diff)) < 10, f"static.npz: aspect is not downslope-facing (median diff {np.median(diff):.0f}°)")
    # JSON files
    tr = m.get("time_range") or {}
    if m.get("mode") == "live" and "last_detection_ms" in tr:
        # live start (SPEC 8.3): burned area known to last_detection_ms; now_ms may be a later confirmed quiet pass
        rep.check(tr["last_detection_ms"] <= tr["now_ms"] == tr["end_ms"], "time_range: live now_ms must equal end_ms and be >= last_detection_ms")
        if tr.get("last_pass_ms") is not None and tr["now_ms"] > tr["last_detection_ms"]:
            rep.check(tr["now_ms"] == tr["last_pass_ms"], "time_range: a now_ms after the last detection must be the last confirmed pass")
        try:
            act = json.loads((bdir / "sim" / "activity.json").read_text())
            rep.check(act.get("now_ms") == tr["now_ms"] and act.get("last_detection_ms") == tr["last_detection_ms"],
                      "sim/activity.json disagrees with time_range")
            rep.note(f"live start: {act.get('rule')}, {act.get('quiet_passes')} quiet pass(es), {len(act.get('markers') or [])} activity marker(s)")
        except (OSError, ValueError) as e:
            rep.check(False, f"sim/activity.json unreadable: {e}")
        try:
            obs_live = bundle.read_layer(bdir, "observed_arrival", m)
            hours = (tr["last_detection_ms"] - m["time_origin_ms"]) / HOUR_MS
            rep.check(float(obs_live[obs_live < 1e5].max(initial=0.0)) <= hours + 1e-3, "observed arrival after the last detection")
        except (KeyError, OSError, ValueError):
            pass
    elif m.get("mode") != "live":
        rep.check("last_detection_ms" not in tr and "last_pass_ms" not in tr, "time_range: live-only fields in a historical bundle")
    det = _strict(rep, DetectionsFile, bdir / "detections.json", "detections.json")
    per = _strict(rep, PerimetersFile, bdir / "perimeters.json", "perimeters.json")
    ts = _strict(rep, TimeseriesFile, bdir / "timeseries.json", "timeseries.json")
    ev = _strict(rep, EventsFile, bdir / "events.json", "events.json")
    wx = _strict(rep, WeatherFile, bdir / "weather.json", "weather.json")
    st = m.get("stats") or {}
    if det is not None:
        d = det["detections"]
        rep.check(st.get("detections") == len(d), f"stats.detections {st.get('detections')} != {len(d)}")
        by = {}
        for r in d:
            by[r["instrument"]] = by.get(r["instrument"], 0) + 1
        rep.note(f"detections by instrument: {by}")
        if d:
            t = np.array([r["t_ms"] for r in d])
            rep.check(bool(np.all(t >= tr["start_ms"] - 12 * HOUR_MS) and np.all(t <= tr["now_ms"] + HOUR_MS)) or m["mode"] == "historical",
                      "detections outside the time range")
    if per is not None:
        pp = per["perimeters"]
        rep.check(st.get("perimeters") == len(pp), f"stats.perimeters {st.get('perimeters')} != {len(pp)}")
        ts_ = [p["t_ms"] for p in pp]
        rep.check(ts_ == sorted(ts_), "perimeters not sorted by time")
        ac = [p["acres"] for p in pp]
        rep.check(all(b >= a * 0.999 for a, b in zip(ac, ac[1:])), f"perimeter acres not monotone: {ac}")
        for p in pp:
            nv = sum(len(r) for r in p["rings"])
            rep.check(nv <= 1500, f"perimeter at {p['t_ms']} has {nv} vertices > 1500")
    if ts is not None:
        t = np.asarray(ts["t_ms"], dtype=np.int64)
        rep.check(ts["step_h"] == 1 and bool(np.all(np.diff(t) == HOUR_MS)), "timeseries not hourly")
        if t.size:
            rep.check(int(t[0]) == tr["start_ms"] and int(t[-1]) <= tr["now_ms"] < int(t[-1]) + HOUR_MS,
                      "timeseries t_ms does not span time_range.start_ms..now_ms")
        for k in ("area_acres", "growth_acres_per_h", "ros_ch_per_h", "detections_per_h", "frp_mw_per_h"):
            if k == "frp_mw_per_h" and k not in ts:
                rep.bad("timeseries: frp_mw_per_h missing")
                continue
            rep.check(len(ts[k]) == t.size, f"timeseries: {k} has {len(ts[k])} values, t_ms {t.size}")
        if det is not None and "frp_mw_per_h" in ts:
            n_goes = sum(1 for r in det["detections"] if r["instrument"] == "GOES")
            rep.note(f"FRP series: max {max(ts['frp_mw_per_h'] or [0]):,.0f} MW, {n_goes} GOES detections in the bundle "
                     f"({'GOES-based' if n_goes else 'polar-orbiter based'})")
        a = np.asarray(ts["area_acres"])
        rep.check(bool(np.all(np.diff(a) >= -1e-6)), "timeseries area not monotone")
        if a.size and st.get("final_acres_observed"):
            rep.check(abs(a[-1] - st["final_acres_observed"]) <= 0.02 * st["final_acres_observed"] + 5,
                      f"timeseries final area {a[-1]:,.0f} != stats {st['final_acres_observed']:,.0f}")
    if ev is not None:
        e = ev["events"]
        rep.check(len(e) <= 12, f"{len(e)} events > 12")
        rep.check([x["t_ms"] for x in e] == sorted(x["t_ms"] for x in e), "events not chronological")
        rep.note("events: " + ", ".join(sorted({x['type'] for x in e})))
    if wx is not None:
        t = np.asarray(wx["t_ms"], dtype=np.int64)
        rep.check(bool(np.all(np.diff(t) == HOUR_MS)), "weather not hourly")
        for k, v in wx["at_fire"].items():
            rep.check(len(v) == t.size, f"weather.at_fire.{k}: {len(v)} values, t_ms {t.size}")
        for k in ("flame_length_ft", "ros_ch_per_h_potential"):
            rep.check(k in wx["at_fire"], f"weather.at_fire.{k} missing (behaviour annotation)")
        rep.check(len(wx["grid"]["u_ms"]) == t.size * 16 == len(wx["grid"]["v_ms"]), "weather grid u/v length != T*16")
        if t.size:
            rep.check(int(t[0]) <= tr["start_ms"] and int(t[-1]) >= tr["end_ms"], "weather does not cover the time range")
    if m.get("ignition"):
        ig = m["ignition"]
        rep.check(abs(ig["x"]) < g["extent_m"] / 2 and abs(ig["z"]) < g["extent_m"] / 2, "ignition outside the AOI")
        if "observed_arrival" in arrays:
            r, c = fire.local_to_rowcol(ig["x"], ig["z"])
            ri, ci = int(math.floor(r)), int(math.floor(c))
            a_ig = float(arrays["observed_arrival"][ri, ci])
            rep.check(a_ig < NEVER * 0.5, "ignition pixel never burns in observed_arrival")
            rep.check(abs(a_ig - (ig["t_ms"] - m["time_origin_ms"]) / HOUR_MS) < 0.05,
                      f"ignition pixel arrival {a_ig:.2f} h != ignition time")
    if "observed_arrival" in arrays and st.get("final_acres_observed"):
        a = arrays["observed_arrival"]
        ac = np.count_nonzero(a < NEVER * 0.5) * g["fire"]["res_m"] ** 2 / config.ACRE_M2
        rep.check(abs(ac - st["final_acres_observed"]) < 0.01 * ac + 1, "stats.final_acres_observed != observed_arrival area")
    # forecasts
    for f in m.get("forecasts") or []:
        check_forecast(rep, bdir, m, f)
    return rep, m


def check_forecast(rep: Report, bdir: Path, m: dict, f: dict) -> None:
    rid = f["run_id"]
    fm = _strict(rep, ForecastManifest, bdir / f["file"], f"forecast {rid}")
    if fm is None:
        return
    rep.check(fm["status"] == f["status"], f"forecast {rid}: forecast.json status {fm['status']} != manifest {f['status']}")
    if fm["status"] != "ready":
        rep.note(f"forecast {rid}: status {fm['status']} ({fm.get('error', '')[:80]})")
        return
    M = m["grid"]["fire"]["width"]
    arr = {}
    for k, info in fm["layers"].items():
        p = bdir / info["file"]
        if rep.check(p.is_file() and p.stat().st_size == M * M * 4, f"forecast {rid}: {k} file missing or wrong size"):
            arr[k] = bundle.read_array(bdir, info)
    if {"arrival_p10", "arrival_p50", "arrival_p90", "burn_probability"} <= set(arr):
        p10, p50, p90, bp = arr["arrival_p10"], arr["arrival_p50"], arr["arrival_p90"], arr["burn_probability"]
        rep.check(bool(np.all(p10 <= p50) and np.all(p50 <= p90)), f"forecast {rid}: quantiles not ordered p10<=p50<=p90")
        rep.check(float(bp.min()) >= 0 and float(bp.max()) <= 1, f"forecast {rid}: burn_probability outside 0..1")
        end_h = (fm["start_ms"] + fm["horizon_h"] * HOUR_MS - m["time_origin_ms"]) / HOUR_MS
        b50 = p50 <= end_h + 1e-3
        rep.check(bool(np.all(bp[b50] >= 0.5 - 1e-6)), f"forecast {rid}: p50 burned by the horizon where probability < 0.5")
        start_h = (fm["start_ms"] - m["time_origin_ms"]) / HOUR_MS
        rep.check(float(p10[p10 < NEVER * 0.5].min(initial=start_h)) >= start_h - 1e-3, f"forecast {rid}: arrival before the start")
    s = fm["series"]
    n = fm["horizon_h"] + 1
    for k in ("t_ms", "area_acres_p10", "area_acres_p50", "area_acres_p90", "ros_ch_per_h_p50"):
        rep.check(len(s[k]) == n, f"forecast {rid}: series {k} has {len(s[k])} values, expected {n}")
    rep.note(f"forecast {rid}: {fm['weather']['ensemble']} x{fm['weather']['members']}, start {fm['start_ms']}, "
             f"runtime {fm['runtime_s']:.0f} s, skill {[(x['lead_h'], round(x['sorensen'], 3)) for x in fm.get('skill') or []]}")


# ----------------------------------------------------------------------------------------------------------------
# Quick-looks
# ----------------------------------------------------------------------------------------------------------------
def _outline(mask: np.ndarray) -> np.ndarray:
    m = np.asarray(mask, dtype=bool)
    e = np.zeros_like(m)
    e[1:] |= m[1:] ^ m[:-1]
    e[:, 1:] |= m[:, 1:] ^ m[:, :-1]
    return e


def _up(a: np.ndarray, size: int) -> np.ndarray:
    k = size // a.shape[0]
    return np.repeat(np.repeat(a, k, axis=0), k, axis=1) if k > 1 else a


def write_quicklooks(bdir: Path, out: Path, prefix: str) -> list[Path]:
    from PIL import Image, ImageDraw

    from fire3d.build import aoi, observed
    from fire3d.sources import terrain

    out.mkdir(parents=True, exist_ok=True)
    m = bundle.load_manifest(bdir) or {}
    render, fire = grids_from_manifest(m)
    tmp = Path(tempfile.mkdtemp(prefix="fire3d-ql-"))
    paths: list[Path] = []
    try:
        aoi.write_quicklooks(bdir, tmp, "x")
        elev, _ = observed.fire_elevation(bdir, fire, m, allow_fetch=False)
        observed.write_quicklooks(bdir, tmp, "x", elev)
        for src, dst in (("hillshade-skyview.png", "hillshade-skyview.png"), ("fuels.png", "fuels.png"),
                         ("water.png", "water.png"), ("dnbr.png", "dnbr.png"), ("naip.jpg", "naip.jpg"),
                         ("naip-contours.png", "naip-contours.png"), ("arrival.png", "observed-arrival.png"),
                         ("series.png", "observed-series.png")):
            if (tmp / f"x-{src}").is_file():
                shutil.copy(tmp / f"x-{src}", out / f"{prefix}-{dst}")
                paths.append(out / f"{prefix}-{dst}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    S = 1024
    ext = float(m["grid"]["extent_m"])

    def px(x: float, z: float) -> tuple[float, float]:
        return ((x / ext + 0.5) * S, (z / ext + 0.5) * S)

    per = (bundle.read_json(bdir / "perimeters.json") or {}).get("perimeters") or []
    dem = bundle.read_layer(bdir, "elevation", m)
    hs = terrain.hillshade(dem, float(m["grid"]["render"]["res_m"]))
    obs = bundle.read_layer(bdir, "observed_arrival", m)
    obs_edge = _up(_outline(obs < NEVER * 0.5), S)
    # dNBR with the latest perimeter (white) and the observed final extent (cyan): independent georeferencing check
    lay = m.get("layers") or {}
    if "burn_severity" in lay:
        d = bundle.read_layer(bdir, "burn_severity", m)
        v = np.where(d <= -9000, np.nan, d)
        u = np.clip(np.nan_to_num(v, nan=0.0) / 0.8, 0, 1)
        base = terrain.nearest_resample(hs, d.shape) * 90 + 30
        rgb = np.stack([base + u * (255 - base), base * (1 - u * 0.6), base * (1 - u)], -1)
        rgb[np.isnan(v)] = [20, 40, 90]
        img = np.clip(_up(rgb, S), 0, 255).astype(np.uint8)
        img[obs_edge] = [60, 230, 255]
        im = Image.fromarray(img)
        dr = ImageDraw.Draw(im)
        if per:
            for ring in per[-1]["rings"]:
                dr.line([px(a, c) for a, c in ring], fill=(255, 255, 255), width=1)
        dr.text((8, 8), f"{m['name']}: Sentinel-2 dNBR (black->red 0..0.8), observed extent cyan, latest WFIGS perimeter white", fill=(255, 255, 255))
        p = out / f"{prefix}-dnbr-perimeter.png"
        im.save(p)
        paths.append(p)
    # NAIP thumbnail with the latest perimeter and detections
    if "naip" in lay:
        with Image.open(bdir / lay["naip"]["file"]) as im0:
            im = im0.convert("RGB").resize((S, S), Image.LANCZOS)
        dr = ImageDraw.Draw(im)
        if per:
            for ring in per[-1]["rings"]:
                dr.line([px(a, c) for a, c in ring], fill=(255, 80, 40), width=2)
        dets = (bundle.read_json(bdir / "detections.json") or {}).get("detections") or []
        for r in dets[:: max(1, len(dets) // 3000)]:
            if r["instrument"] in ("VIIRS", "LANDSAT"):
                X, Y = px(r["x"], r["z"])
                dr.point((X, Y), fill=(255, 230, 0))
        dr.text((8, 8), f"{m['name']}: NAIP, latest perimeter orange, VIIRS/Landsat detections yellow", fill=(255, 255, 255))
        p = out / f"{prefix}-naip-perimeter.png"
        im.save(p)
        paths.append(p)
    for f in m.get("forecasts") or []:
        if f.get("status") == "ready":
            paths.append(forecast_quicklook(bdir, m, f, out / f"{prefix}-forecast-{f['run_id']}.png", hs, obs))
    return paths


def forecast_quicklook(bdir: Path, m: dict, f: dict, path: Path, hs: np.ndarray, obs: np.ndarray) -> Path:
    from PIL import Image, ImageDraw

    from fire3d.sources import terrain

    fm = bundle.read_json(bdir / f["file"])
    M = m["grid"]["fire"]["width"]
    S = 1024
    origin = m["time_origin_ms"]
    start_h = (fm["start_ms"] - origin) / HOUR_MS
    bp = bundle.read_array(bdir, fm["layers"]["burn_probability"])
    p50 = bundle.read_array(bdir, fm["layers"]["arrival_p50"])
    base = terrain.nearest_resample(hs, (M, M)) * 110 + 30
    rgb = np.repeat(base[..., None], 3, axis=-1)
    u = np.clip(bp, 0, 1)[..., None]
    ramp = np.where(u < 0.5, np.array([230, 190, 90]) * (u * 2), np.array([230, 190, 90]) + (np.array([220, 40, 30]) - np.array([230, 190, 90])) * (u * 2 - 1))
    rgb = np.where(bp[..., None] > 0, rgb * (1 - 0.75 * np.minimum(1, u * 3)) + ramp * 0.75 * np.minimum(1, u * 3), rgb)
    img = np.clip(_up(rgb, S), 0, 255).astype(np.uint8)
    for lead, col in ((12, (255, 255, 255)), (24, (120, 255, 120)), (48, (90, 200, 255)), (72, (200, 120, 255))):
        if lead <= fm["horizon_h"]:
            img[_up(_outline(p50 <= start_h + lead), S)] = col
    img[_up(_outline(obs <= start_h), S)] = [0, 0, 0]
    img[_up(_outline(obs < NEVER * 0.5), S)] = [60, 230, 255]
    im = Image.fromarray(img)
    dr = ImageDraw.Draw(im)
    # mean wind over the forecast at the fire (FROM convention -> arrow points downwind)
    wx = bundle.read_json(bdir / "weather.json")
    t = np.asarray(wx["t_ms"])
    sel = (t >= fm["start_ms"]) & (t <= fm["start_ms"] + min(24, fm["horizon_h"]) * HOUR_MS)
    if sel.any():
        spd = np.asarray(wx["at_fire"]["wind_speed_ms"], dtype=float)[sel]
        dirs = np.radians(np.asarray(wx["at_fire"]["wind_dir_deg"], dtype=float)[sel])
        uu, vv = np.mean(-spd * np.sin(dirs)), np.mean(-spd * np.cos(dirs))
        frm = (math.degrees(math.atan2(-uu, -vv)) + 360) % 360
        L = 80
        cx, cy = 90, S - 90
        ex, ey = cx + uu / max(1e-6, math.hypot(uu, vv)) * L, cy - vv / max(1e-6, math.hypot(uu, vv)) * L
        dr.line([(cx, cy), (ex, ey)], fill=(255, 255, 255), width=4)
        dr.ellipse([ex - 6, ey - 6, ex + 6, ey + 6], fill=(255, 255, 255))
        dr.text((cx - 70, cy + 60), f"mean wind first 24 h: from {frm:.0f}° at {math.hypot(uu, vv):.1f} m/s (arrow = downwind)", fill=(255, 255, 255))
    sk = fm.get("skill") or []
    lines = [f"{m['name']} {fm['run_id']}: {fm['weather']['ensemble']} x{fm['weather']['members']}, adj {fm['model']['spread_adjustment']}, "
             f"spotting {fm['model']['spotting']}, {fm['runtime_s']:.0f} s",
             "burn probability gold->red; p50 front +12 white, +24 green, +48 blue, +72 violet; start mask black; observed final cyan",
             "skill: " + ", ".join(f"+{s['lead_h']:.0f}h S={s['sorensen']:.2f} ({s['forecast_acres_p50']:,.0f}/{s['observed_acres']:,.0f} ac)" for s in sk)]
    for i, line in enumerate(lines):
        dr.text((8, 8 + 14 * i), line, fill=(255, 255, 255))
    im.save(path)
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("incident", help="incident id (or a flood id with --hazard flood)")
    ap.add_argument("--hazard", choices=("fire", "flood"), default="fire", help="fire (default) or flood bundle")
    ap.add_argument("--quicklook", type=Path, default=None, help="directory for quick-look PNGs (fire bundles)")
    ap.add_argument("--prefix", default=None, help="file prefix (default backend-<incident id>)")
    args = ap.parse_args(argv)
    if args.hazard == "flood":
        from fire3d.floods import store

        try:
            fdir = store.flood_dir(args.incident)
        except ValueError:
            print(f"{args.incident}: not a flood id")
            return 1
        rep, _ = check_flood_bundle(fdir)
        print(f"{args.incident}: {len(rep.problems)} problem(s)")
        for p in rep.problems:
            print(f"  PROBLEM {config.mask_secrets(p)}")
        for n in rep.notes:
            print(f"  note    {config.mask_secrets(n)}")
        if args.quicklook:
            print("  note    quick-looks are drawn for fire bundles only")
        return 1 if rep.problems else 0
    bdir = bundle.bundle_dir(args.incident)
    rep, m = check_bundle(bdir)
    print(f"{args.incident}: {len(rep.problems)} problem(s)")
    for p in rep.problems:
        print(f"  PROBLEM {config.mask_secrets(p)}")
    for n in rep.notes:
        print(f"  note    {config.mask_secrets(n)}")
    if args.quicklook and m:
        for p in write_quicklooks(bdir, args.quicklook, args.prefix or f"backend-{args.incident}"):
            print(f"  quicklook {p}")
    return 1 if rep.problems else 0


if __name__ == "__main__":
    sys.exit(main())
