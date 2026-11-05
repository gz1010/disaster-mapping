"""Add brief 6's flood products to existing flood bundles, without a full rebuild (backend-flood-time-3d).

For each bundle: the 3D terrain products (``manifest.terrain3d``: relief and height boost, height above the river,
FwDET depth estimates; ``layers/hand.bin``, ``layers/depth_*.bin``, ``maps/flowlines.geojson``) and, for real floods,
the time history (``timeline.json``, ``layers/water_pass_<key>.bin``). A bundle built by brief 6's build already has
them; this is for brief-5 bundles on disk and for ``fixture-flood`` (whose synthetic valley's centre line stands in
for NOAA's river lines: no network; its timeline is made by the route from its frozen files).

Usage (from ``backend/``)::

    uv run python scripts/flood_3d.py fixture-flood
    uv run python scripts/flood_3d.py flood-20261104-calcasieu-river-flood-77edfb [--no-timeline]

Network: NOAA's river lines (1 request, cached 30 days), Earthdata GIS passes (cached 30 days) and the IEM archive,
all through ``fire3d.http``. Holds the bundle's build lock while it writes.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fire3d import bundle  # noqa: E402
from fire3d.build import pipeline  # noqa: E402
from fire3d.contracts import FloodManifest, FloodTimelineResponse, validate_strict  # noqa: E402
from fire3d.floods import copy as fcopy  # noqa: E402
from fire3d.floods import copy_time as tcopy  # noqa: E402
from fire3d.floods import store, terrain3d, timeline  # noqa: E402
from fire3d.floods.build import compact_fc  # noqa: E402
from fire3d.grid import Grid, grids_from_manifest  # noqa: E402
from fire3d.sources import water_maps  # noqa: E402
from fire3d.sources.nws import SourceError  # noqa: E402


def _layer(bdir: Path, m: dict, name: str, grid: Grid, dtype) -> np.ndarray | None:
    info = (m.get("layers") or {}).get(name)
    if not info:
        return None
    return np.fromfile(bdir / info["file"], dtype).reshape(grid.shape)


def fixture_flowlines(grid: Grid) -> list[dict]:
    """The fixture valley's centre line (``scripts/make_fixture.py`` ``flood_valley``) as one river line."""
    spec = importlib.util.spec_from_file_location("make_fixture", Path(__file__).with_name("make_fixture.py"))
    mod = importlib.util.module_from_spec(spec)                       # type: ignore[arg-type]
    sys.modules["make_fixture"] = mod
    spec.loader.exec_module(mod)                                       # type: ignore[union-attr]
    v = mod.flood_valley(grid, np.random.default_rng(0))
    lon, lat = grid.local_to_lonlat(v.line[:, 0], v.line[:, 1])
    coords = [[round(float(a), 6), round(float(b), 6)] for a, b in zip(np.atleast_1d(lon), np.atleast_1d(lat))]
    return [{"type": "Feature", "id": 1, "geometry": {"type": "LineString", "coordinates": coords},
             "properties": {"feature_id": 1, "name": "Ridge Fork River (synthetic)", "strm_order": 5}}]


def add_terrain3d(bdir: Path, m: dict, grid: Grid, *, flowlines: list[dict] | None, flow_reason: str | None,
                  now: int, fetched_ms: int | None = None) -> dict:
    dem = _layer(bdir, m, "elevation", grid, np.float32)
    if dem is None:
        raise SystemExit(f"{bdir.name}: no elevation layer")
    ls = m.get("layer_status") or {}
    water = terrain3d.water_layers_of(
        _layer(bdir, m, "water_satellite", grid, np.uint8), (ls.get("water_satellite") or {}).get("time_ms"),
        (ls.get("water_satellite") or {}).get("reason"),
        _layer(bdir, m, "water_forecast", grid, np.uint8), (ls.get("water_forecast") or {}).get("time_ms"),
        (ls.get("water_forecast") or {}).get("reason"))
    tz = (m.get("summary") or {}).get("time_zone") or "UTC"
    res = terrain3d.products(dem, grid, water=water, flowlines=flowlines, flowlines_reason=flow_reason,
                             time_zone=tz, now=now)
    layers = dict(m.get("layers") or {})
    for name in ("hand", "depth_satellite", "depth_forecast"):
        layers.pop(name, None)
    for name, arr in res.rasters.items():
        layers[name] = bundle.write_layer(bdir, name, arr, "render", "0.1 m", res.descriptions[name],
                                          nodata=terrain3d.NODATA, register=False)
    files = dict(m.get("files") or {})
    maps_ = dict(files.get("maps") or {})
    sources = list(m.get("data_sources") or [])
    if flowlines is not None:
        bundle.write_json(bdir / "maps" / "flowlines.geojson",
                          compact_fc({"type": "FeatureCollection", "features": flowlines}, grid))
        maps_["flowlines"] = "maps/flowlines.geojson"
        if not (m.get("summary") or {}).get("synthetic"):
            sources.append({"name": fcopy.CREDIT_NWC_EXPERIMENTAL,
                            "detail": f"National Water Model river lines: {len(flowlines)} reaches "
                                      "(maps/flowlines.geojson; the height-above-the-river input)",
                            "fetched_ms": int(fetched_ms or now)})
    files["maps"] = maps_
    return {**m, "layers": layers, "files": files, "data_sources": sources, "terrain3d": res.entry}


def add_timeline(bdir: Path, m: dict, grid: Grid, *, now: int) -> dict:
    s = m["summary"]
    bbox = tuple(round(float(v), 5) for v in m["grid"]["bbox_lonlat"])
    sat = bundle.read_json(bdir / "satellite.json") if (bdir / "satellite.json").is_file() else {}
    shown = [g["id"] for g in sat.get("granules") or []] if sat.get("measured") else None
    bp = timeline.bundle_passes(s, grid, bbox, now=now, shown_granules=shown,
                                progress=lambda f, msg: print(f"  {msg}", flush=True))
    prods = timeline.product_history(s, now=now)
    tl = timeline.timeline(s, bp.answer, prods, now=now)
    validate_strict(FloodTimelineResponse, tl)
    layers = {k: v for k, v in (m.get("layers") or {}).items() if not k.startswith("water_pass_")}
    for old in (bdir / "layers").glob("water_pass_*.bin"):
        old.unlink()
    for name, arr in bp.rasters.items():
        layers[name] = bundle.write_layer(bdir, name, arr, "render", None, bp.descriptions[name], register=False)
    bundle.write_json(bdir / "timeline.json", tl)
    files = {**(m.get("files") or {}), "timeline": "timeline.json"}
    sources = list(m.get("data_sources") or [])
    pa = bp.answer
    if pa["passes"]:
        sources.append({"name": pa["source"]["credit"],
                        "detail": f"{len(pa['passes'])} satellite passes "
                                  f"({sum(1 for p in pa['passes'] if p['layer'])} kept as images; timeline.json, "
                                  "layers/water_pass_<pass>.bin)", "fetched_ms": int(pa.get("retrieved_ms") or now)})
    if prods.get("archive_source"):
        sources.append({"name": fcopy.CREDIT_IEM, "detail": "earlier versions of this flood's NWS products, verbatim "
                        "(timeline.json)", "fetched_ms": int(prods.get("retrieved_ms") or now)})
    print(f"  timeline: {len(pa['passes'])} passes ({len(bp.rasters)} kept), {len(prods['products'])} product "
          f"versions, products {prods['status']}", flush=True)
    return {**m, "layers": layers, "files": files, "data_sources": sources}


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
        if synthetic:
            flow, reason, fetched = fixture_flowlines(grid), None, None
        else:
            try:
                ml = water_maps.flowlines(tuple(m["grid"]["bbox_lonlat"]), 1)
                flow, reason, fetched = ml.features, None, ml.fetched_ms
            except SourceError as e:
                print(f"  river lines: {e}", flush=True)
                flow, reason, fetched = None, tcopy.HAND_NO_LINES, None
        m2 = add_terrain3d(bdir, m, grid, flowlines=flow, flow_reason=reason, now=now, fetched_ms=fetched)
        if with_timeline and not synthetic:
            m2 = add_timeline(bdir, m2, grid, now=now)
        validate_strict(FloodManifest, m2)
        bundle.write_json(bdir / "manifest.json", m2)
    t3 = m2["terrain3d"]
    rel = t3["relief"] or {}
    print(f"{flood_id}: height boost ×{rel.get('exaggeration')} (ground {rel.get('p05_m')}-{rel.get('p95_m')} m, "
          f"{rel.get('area')}); hand {t3['hand']['status']}; "
          + ", ".join(f"{d['key']} {d['status']}" for d in t3["depth"]) + f" ({time.monotonic() - t0:.1f} s)")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("ids", nargs="+", help="flood ids (folders under data/floods/)")
    ap.add_argument("--no-timeline", action="store_true", help="only the 3D terrain products")
    args = ap.parse_args(argv)
    now = int(time.time() * 1000)
    return max(run(i, with_timeline=not args.no_timeline, now=now) for i in args.ids)


if __name__ == "__main__":
    raise SystemExit(main())
