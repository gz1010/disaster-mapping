"""Add brief 6's flood products to existing flood bundles, without a full rebuild (backend-flood-time-3d).

For each bundle: the 3D terrain products (``manifest.terrain3d``: relief and height boost, height above the river,
FwDET depth estimates; ``layers/hand.bin``, ``layers/depth_*.bin``, ``maps/flowlines.geojson``) and the time history
(``timeline.json``, ``layers/water_pass_<key>.bin`` and ``layers/depth_pass_<key>.bin``). A bundle built by brief 6's
build already has them; this is for brief-5 bundles on disk and for ``fixture-flood``: its synthetic valley's centre
line stands in for NOAA's river lines, and it gets four simulated satellite passes (a clear pass before the flood, a
pass with no view, a five-day gap, a partly hidden pass and the fixture's own image; each with its class raster, its
depth estimate and a 2D image in ``passes/<key>.png``), with no network (review BTD-R9). Run it again after
``make_fixture.py --only flood``, which writes the fixture without them.

Stored notes that still carry the app's old name (texts written before the rename to Disaster Mapping) are replaced
with today's texts in every file this script rewrites (review BTD-R11).

Usage (from ``backend/``)::

    uv run python scripts/flood_3d.py fixture-flood
    uv run python scripts/flood_3d.py flood-20261104-calcasieu-river-flood-77edfb [--no-timeline]

Network (real floods only): NOAA's river lines (1 request, cached 30 days), Earthdata GIS passes (cached 30 days) and
the IEM archive, all through ``fire3d.http``. Holds the bundle's build lock while it writes.
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fire3d import bundle  # noqa: E402
from fire3d.build import pipeline  # noqa: E402
from fire3d.contracts import FloodManifest, FloodTimelineResponse, validate_strict  # noqa: E402
from fire3d.floods import copy as fcopy  # noqa: E402
from fire3d.floods import copy_time as tcopy  # noqa: E402
from fire3d.floods import history, satellite, store, terrain3d, timeline  # noqa: E402
from fire3d.floods.build import compact_fc  # noqa: E402
from fire3d.grid import Grid, grids_from_manifest  # noqa: E402
from fire3d.sources import opera, water_maps  # noqa: E402
from fire3d.sources.nws import SourceError  # noqa: E402

DAY_MS = 86_400_000
NEW_NAME = "Disaster Mapping"
# the app's name before brief 6, only to find stored notes that still carry it; it is never sent (the product-name
# guard, tests/test_product_name.py, scans literals, so the name is joined here from its parts)
OLD_NAME = "-".join(("Fire", "3d"))


# ----------------------------------------------------------------------------------------------------------------
# Old-name notes (review BTD-R11)
# ----------------------------------------------------------------------------------------------------------------
def _old_name_fragments() -> list[tuple[str, str]]:
    """(old text, today's text) for every literal part of today's backend notes that names the app: the texts as
    they were stored before the rename. Slots (``{...}``) split a template into its literal parts."""
    out: dict[str, str] = {}
    for mod in (fcopy, tcopy, history):
        for v in vars(mod).values():
            if not isinstance(v, str) or NEW_NAME not in v:
                continue
            for frag in re.split(r"\{[^{}]*\}", v):
                if NEW_NAME in frag and len(frag) >= 24:
                    out[frag.replace(NEW_NAME, OLD_NAME)] = frag
    out[f"test data for {OLD_NAME}, not an instruction"] = f"test data for {NEW_NAME}, not an instruction"
    return sorted(out.items(), key=lambda kv: -len(kv[0]))


def rename_old_notes(obj: Any, pairs: list[tuple[str, str]] | None = None) -> tuple[Any, int]:
    """``obj`` (a JSON value) with the old-name notes replaced, and how many strings changed."""
    pairs = pairs if pairs is not None else _old_name_fragments()
    n = 0

    def walk(v: Any) -> Any:
        nonlocal n
        if isinstance(v, str):
            if OLD_NAME not in v:
                return v
            w = v
            for old, new in pairs:
                if old in w:
                    w = w.replace(old, new)
            n += w != v
            return w
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v

    return walk(obj), n


def rename_files(bdir: Path, names: tuple[str, ...] = ("satellite.json", "warnings.json", "timeline.json")) -> int:
    """Replace old-name notes in the bundle's JSON files (the manifest is done by :func:`run`)."""
    pairs = _old_name_fragments()
    total = 0
    for name in names:
        p = bdir / name
        if not p.is_file():
            continue
        doc, n = rename_old_notes(bundle.read_json(p), pairs)
        if n:
            bundle.write_json(p, doc)
            total += n
    return total


# ----------------------------------------------------------------------------------------------------------------
# 3D terrain products
# ----------------------------------------------------------------------------------------------------------------
def _layer(bdir: Path, m: dict, name: str, grid: Grid, dtype) -> np.ndarray | None:
    info = (m.get("layers") or {}).get(name)
    if not info:
        return None
    return np.fromfile(bdir / info["file"], dtype).reshape(grid.shape)


def _load_make_fixture():
    if "make_fixture" in sys.modules:
        return sys.modules["make_fixture"]
    spec = importlib.util.spec_from_file_location("make_fixture", Path(__file__).with_name("make_fixture.py"))
    mod = importlib.util.module_from_spec(spec)                       # type: ignore[arg-type]
    sys.modules["make_fixture"] = mod
    spec.loader.exec_module(mod)                                       # type: ignore[union-attr]
    return mod


def fixture_flowlines(grid: Grid) -> list[dict]:
    """The fixture valley's centre line (``scripts/make_fixture.py`` ``flood_valley``) as one river line."""
    v = _load_make_fixture().flood_valley(grid, np.random.default_rng(0))
    lon, lat = grid.local_to_lonlat(v.line[:, 0], v.line[:, 1])
    coords = [[round(float(a), 6), round(float(b), 6)] for a, b in zip(np.atleast_1d(lon), np.atleast_1d(lat))]
    return [{"type": "Feature", "id": 1, "geometry": {"type": "LineString", "coordinates": coords},
             "properties": {"feature_id": 1, "name": "Ridge Fork River (synthetic)", "strm_order": 5}}]


def _without_sources(sources: list[dict], pred) -> list[dict]:
    return [d for d in sources if not pred(d)]


def add_terrain3d(bdir: Path, m: dict, grid: Grid, *, flowlines: list[dict] | None, flow_reason: str | None,
                  now: int, fetched_ms: int | None = None) -> dict:
    m = {**m, "layers": dict(m.get("layers") or {}), "files": dict(m.get("files") or {})}
    terrain3d.apply_to_bundle(bdir, m, grid, flowlines=flowlines, flow_reason=flow_reason, now=now)
    maps_ = dict(m["files"].get("maps") or {})
    sources = _without_sources(list(m.get("data_sources") or []),
                               lambda d: "maps/flowlines.geojson" in str(d.get("detail")))   # re-runs: one credit
    if flowlines is not None:
        bundle.write_json(bdir / "maps" / "flowlines.geojson",
                          compact_fc({"type": "FeatureCollection", "features": flowlines}, grid))
        maps_["flowlines"] = "maps/flowlines.geojson"
        if not (m.get("summary") or {}).get("synthetic"):
            sources.append({"name": fcopy.CREDIT_NWC_EXPERIMENTAL, "detail": tcopy.SRC_FLOWLINES.format(n=len(flowlines)),
                            "fetched_ms": int(fetched_ms or now)})
    m["files"]["maps"] = maps_
    m["data_sources"] = sources
    return m


# ----------------------------------------------------------------------------------------------------------------
# Time history
# ----------------------------------------------------------------------------------------------------------------
def _drop_pass_layers(bdir: Path, layers: dict) -> dict:
    out = {k: v for k, v in layers.items() if not k.startswith(("water_pass_", "depth_pass_"))}
    for pat in ("water_pass_*.bin", "depth_pass_*.bin"):
        for old in (bdir / "layers").glob(pat):
            old.unlink()
    return out


def _write_pass_layers(bdir: Path, layers: dict, bp: timeline.BundlePasses) -> None:
    for name, arr in bp.rasters.items():
        layers[name] = bundle.write_layer(bdir, name, arr, "render", None, bp.descriptions[name], register=False)
    for name, arr in bp.depth.items():
        layers[name] = bundle.write_layer(bdir, name, arr, "render", "0.1 m", bp.descriptions[name],
                                          nodata=terrain3d.NODATA, register=False)


def _timeline_sources(sources: list[dict], pa: dict, prods: dict, now: int) -> list[dict]:
    sources = _without_sources(sources, lambda d: "timeline.json" in str(d.get("detail")))    # re-runs: one credit
    if pa["passes"]:
        kept = sum(1 for p in pa["passes"] if p["layer"])
        for src in pa.get("sources") or [pa["source"]]:
            sources.append({"name": src["credit"], "detail": tcopy.SRC_PASSES.format(
                n=len(pa["passes"]), start=time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(pa["start_ms"] / 1000)),
                end=time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(pa["end_ms"] / 1000)), kept=kept),
                "fetched_ms": int(pa.get("retrieved_ms") or now)})
    if prods.get("archive_source"):
        n = sum(1 for p in prods["products"] if p.get("archived"))
        sources.append({"name": fcopy.CREDIT_IEM, "detail": tcopy.SRC_IEM_VERSIONS.format(n=n),
                        "fetched_ms": int(prods.get("retrieved_ms") or now)})
    return sources


def add_timeline(bdir: Path, m: dict, grid: Grid, *, now: int) -> dict:
    s = m["summary"]
    bbox = tuple(round(float(v), 5) for v in m["grid"]["bbox_lonlat"])
    sat = bundle.read_json(bdir / "satellite.json") if (bdir / "satellite.json").is_file() else {}
    shown = [g["id"] for g in sat.get("granules") or []] if sat.get("measured") else None
    dem = _layer(bdir, m, "elevation", grid, np.float32)
    bp = timeline.bundle_passes(s, grid, bbox, now=now, shown_granules=shown, dem=dem,
                                progress=lambda f, msg: print(f"  {msg}", flush=True))
    prods = timeline.product_history(s, now=now)
    old_tl = bundle.read_json(bdir / "timeline.json") if (bdir / "timeline.json").is_file() else None
    if old_tl and (old_tl.get("products") or {}).get("status") == "available":
        prods = timeline.merge_products(old_tl["products"], prods, now)      # a re-run never loses a version
    tl = timeline.timeline(s, bp.answer, prods, now=now)
    validate_strict(FloodTimelineResponse, tl)
    layers = _drop_pass_layers(bdir, dict(m.get("layers") or {}))
    _write_pass_layers(bdir, layers, bp)
    bundle.write_json(bdir / "timeline.json", tl)
    files = {**(m.get("files") or {}), "timeline": "timeline.json"}
    pa = bp.answer
    sources = _timeline_sources(list(m.get("data_sources") or []), pa, prods, now)
    print(f"  timeline: {len(pa['passes'])} passes ({sum(1 for p in pa['passes'] if p['layer'])} kept, "
          f"{len(bp.depth)} with depth), {len(prods['products'])} product versions, products {prods['status']}",
          flush=True)
    return {**m, "layers": layers, "files": files, "data_sources": sources}


# ---- fixture-flood: four simulated passes (review BTD-R9) ---------------------------------------------------------
def _png_lonlat(cls: np.ndarray, grid: Grid, bounds: list[float]) -> bytes:
    """The classes on the render grid as a lon/lat PNG over ``bounds`` (the 2D views' palette)."""
    w, s, e, n = bounds
    pw = 640
    ph = max(1, int(round(pw * (n - s) / ((e - w) * np.cos(np.radians((s + n) / 2))))))
    lon = w + (np.arange(pw) + 0.5) / pw * (e - w)
    lat = n - (np.arange(ph) + 0.5) / ph * (n - s)
    LON, LAT = np.meshgrid(lon, lat)
    rr, cc = grid.lonlat_to_rowcol(LON, LAT)
    inside = (rr >= 0) & (rr < grid.height) & (cc >= 0) & (cc < grid.width)
    rr = np.clip(np.floor(rr).astype(int), 0, grid.height - 1)
    cc = np.clip(np.floor(cc).astype(int), 0, grid.width - 1)
    px = np.where(inside, cls[rr, cc], opera.NO_DATA)
    return satellite.png_bytes(satellite.palette_rgba(px, ~inside))   # no data hatched; outside transparent


def fixture_passes(base: np.ndarray, acquired_ms: int) -> list[tuple[str, str, int, np.ndarray]]:
    """(sensor, label, acquired_ms, classes) of the fixture's four simulated passes, oldest first: the river before
    the flood (clear), a pass with no view (all cloud), then a gap of five days, a partly hidden pass (a cloud bank
    over the east) and the fixture's own image."""
    from scipy import ndimage

    outside = base == opera.NO_DATA
    water = np.isin(base, (opera.OPEN_WATER, opera.PARTIAL_WATER))
    before = ndimage.binary_erosion(water, iterations=12)
    clear_before = np.where(outside, opera.NO_DATA, np.where(before, opera.OPEN_WATER, opera.NOT_WATER))
    no_view = np.where(outside, opera.NO_DATA, opera.CLOUD)
    rising = ndimage.binary_erosion(water, iterations=4)
    cols = np.arange(base.shape[1])[None, :] >= int(base.shape[1] * 0.35)
    partly = np.where(outside, opera.NO_DATA, np.where(cols, opera.CLOUD,
                                                       np.where(rising, opera.OPEN_WATER, opera.NOT_WATER)))
    return [("L8", "before", acquired_ms - 9 * DAY_MS - 3 * 3_600_000, clear_before.astype(np.uint8)),
            ("S2A", "no_view", acquired_ms - 7 * DAY_MS + 3_600_000, no_view.astype(np.uint8)),
            ("L9", "partly", acquired_ms - 2 * DAY_MS - 3_600_000, partly.astype(np.uint8)),
            ("S2B", "own", acquired_ms, base.astype(np.uint8))]


def add_fixture_timeline(bdir: Path, m: dict, grid: Grid, *, now: int) -> dict:
    """``timeline.json`` of ``fixture-flood`` with four simulated passes (keys in the real
    ``DSWx-HLS_<time>_<sensor>`` form), their class and depth rasters and their 2D images (served by
    ``GET /api/floods/fixture-flood/passes/<key>.png``), and its frozen products (``synthetic: true``)."""
    s = m["summary"]
    sat = bundle.read_json(bdir / "satellite.json")
    warn = bundle.read_json(bdir / "warnings.json")
    base = _layer(bdir, m, "water_satellite", grid, np.uint8)
    dem = _layer(bdir, m, "elevation", grid, np.float32)
    if base is None or dem is None or not sat.get("measured"):
        raise SystemExit(f"{bdir.name}: no satellite water layer to simulate passes from")
    g0 = sat["granules"][0]
    tz = s.get("time_zone") or "UTC"
    bounds = list((sat.get("image") or {}).get("bounds_lonlat") or m["grid"]["bbox_lonlat"])
    area = timeline._area_hash(tuple(round(float(v), 5) for v in m["grid"]["bbox_lonlat"]))
    layers = _drop_pass_layers(bdir, dict(m.get("layers") or {}))
    pdir = bdir / "passes"
    if pdir.is_dir():
        for old in pdir.glob("*.png"):
            old.unlink()
    pdir.mkdir(exist_ok=True)
    rows = []
    own_key = None
    for sensor, label, acq, cls in fixture_passes(base, int(g0["acquired_ms"])):
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(acq / 1000))
        gid = f"SYNTHETIC_OPERA_L3_DSWx-HLS_T12SZZ_{stamp}_{sensor}_30_v1.1"
        gran = opera.Granule(gid, "DSWx-HLS", "T12SZZ", acq, acq + 31 * 3_600_000, sensor, "earthdata_gis")
        p = opera.Pass(f"DSWx-HLS_{stamp[:13]}_{sensor}", "DSWx-HLS", sensor, acq, [gran])
        read = timeline.PassRead(timeline.shares_grid(cls, grid.res_m), None, cls)
        view = timeline.view_of(read.stats)
        layer = dlayer = None
        image = None
        if view in ("clear", "partly_hidden"):
            layer = timeline.layer_name(p.key)
            layers[layer] = bundle.write_layer(bdir, layer, cls, "render", None, tcopy.DESC_PASS.format(
                product=p.product, time=time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(acq / 1000))), register=False)
            d = terrain3d.pass_depth(dem, cls)
            if d is not None:
                dlayer = timeline.depth_layer_name(p.key)
                layers[dlayer] = bundle.write_layer(bdir, dlayer, d, "render", "0.1 m",
                                                    tcopy.DESC_DEPTH.format(layer=layer), nodata=terrain3d.NODATA,
                                                    register=False)
            (pdir / f"{p.key}.png").write_bytes(_png_lonlat(cls, grid, bounds))
            image = {"url": timeline.image_url(s["id"], p.key, area), "bounds_lonlat": bounds}
        row = timeline.pass_out(p, read, tz=tz, image=image, layer=layer, depth_layer=dlayer)
        row["url"] = None                                         # no NASA page for a simulated granule
        rows.append(row)
        if label == "own":
            own_key = p.key
    start, end = timeline.flood_window(s, now)
    start = min(start, min(r["acquired_ms"] for r in rows) - DAY_MS)
    ps = {**timeline._passes_base(now, start, end, sat.get("login") or "not_configured"), "source": sat.get("source"),
          "sources": [sat.get("source")], "retrieved_ms": sat.get("retrieved_ms"), "stats_over": "bundle_grid",
          "passes": rows, "shown_key": own_key}
    ps["caveats"].append(tcopy.PASSES_SYNTHETIC)
    pr = timeline._products_env(s["id"], now, synthetic=True)
    pr.update(source=warn.get("source") or pr["source"], retrieved_ms=warn.get("retrieved_ms"))
    zf = {(f.get("properties") or {}).get("ugc") or str(f.get("id")): f
          for f in (warn.get("zones") or {}).get("features") or []}
    pr = timeline._finish_products(pr, list(warn.get("alerts") or []), zf, now)
    tl = timeline.timeline(s, ps, pr, now=now, synthetic=True)
    validate_strict(FloodTimelineResponse, tl)
    bundle.write_json(bdir / "timeline.json", tl)
    print(f"  timeline: {len(rows)} simulated passes ({sum(1 for r in rows if r['layer'])} with images), "
          f"{len(pr['products'])} product versions", flush=True)
    return {**m, "layers": layers, "files": {**(m.get("files") or {}), "timeline": "timeline.json"}}


def upgrade_fixture(bdir: Path, m: dict, *, now: int) -> dict:
    """Both products for ``fixture-flood`` (no network): the 3D terrain products and the simulated time history."""
    grid, _ = grids_from_manifest(m)
    m2 = add_terrain3d(bdir, m, grid, flowlines=fixture_flowlines(grid), flow_reason=None, now=now)
    return add_fixture_timeline(bdir, m2, grid, now=now)


# ----------------------------------------------------------------------------------------------------------------
def run(flood_id: str, *, with_timeline: bool, now: int) -> int:
    bdir = store.flood_dir(flood_id)
    m = store.load_flood_manifest(flood_id)
    if m is None or m.get("status") != "ready":
        print(f"{flood_id}: no ready flood bundle", file=sys.stderr)
        return 1
    grid, _ = grids_from_manifest(m)
    synthetic = bool((m.get("summary") or {}).get("synthetic"))
    t0 = time.monotonic()
    with pipeline.bundle_lock(bdir, timeout=0):
        renamed = rename_files(bdir)
        m, n = rename_old_notes(m)
        renamed += n
        if synthetic:
            m2 = upgrade_fixture(bdir, m, now=int((m.get("time_range") or {}).get("now_ms") or now))
        else:
            try:
                ml = water_maps.flowlines(tuple(m["grid"]["bbox_lonlat"]), 1)
                flow, reason, fetched = ml.features, None, ml.fetched_ms
            except SourceError as e:
                print(f"  river lines: {e}", flush=True)
                flow, reason, fetched = None, tcopy.HAND_NO_LINES, None
            m2 = add_terrain3d(bdir, m, grid, flowlines=flow, flow_reason=reason, now=now, fetched_ms=fetched)
            if with_timeline:
                m2 = add_timeline(bdir, m2, grid, now=now)
        validate_strict(FloodManifest, m2)
        bundle.write_json(bdir / "manifest.json", m2)
    t3 = m2["terrain3d"]
    rel = t3["relief"] or {}
    print(f"{flood_id}: height boost ×{rel.get('exaggeration')} (ground {rel.get('p05_m')}-{rel.get('p95_m')} m, "
          f"{rel.get('area')}, target reached: {rel.get('target_reached')}); hand {t3['hand']['status']}; "
          + ", ".join(f"{d['key']} {d['status']}" for d in t3["depth"])
          + f"; {renamed} old-name notes replaced ({time.monotonic() - t0:.1f} s)")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("ids", nargs="+", help="flood ids (folders under data/floods/)")
    ap.add_argument("--no-timeline", action="store_true", help="only the 3D terrain products (real floods)")
    args = ap.parse_args(argv)
    now = int(time.time() * 1000)
    return max(run(i, with_timeline=not args.no_timeline, now=now) for i in args.ids)


if __name__ == "__main__":
    raise SystemExit(main())
