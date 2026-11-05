"""Brief 6 M2: the 3D terrain products of a flood bundle (``fire3d/floods/terrain3d.py``): relief and the height boost,
height above the river (HAND, simplified) and the FwDET depth estimate, on synthetic DEMs with known answers; the
fixture valley (whose true height above the river is known); the build step with mocked river lines; the upgrade
script ``scripts/flood_3d.py``. Offline."""

from __future__ import annotations

import json
import shutil

import httpx
import numpy as np
import pytest

import fire3d.http as fhttp
from fire3d.contracts import FloodManifest, FloodTerrain3d, contract_problems, validate_strict
from fire3d.floods import build, store, terrain3d, timeline
from fire3d.floods import copy_time as tcopy
from fire3d.grid import Grid, grids_from_manifest
from fire3d.sources import opera

from conftest import load_script, route_transport
from test_floods_build import _routes, recorded_flood  # noqa: F401 - the fixture is used by name

RES = 30.0


def _grid(n: int = 200, res: float = RES) -> Grid:
    return Grid(32613, 500_000.0, 4_000_000.0, n * res, n, n)


def _cols(n: int = 200, res: float = RES) -> tuple[np.ndarray, np.ndarray]:
    """(x, y) in metres of each cell centre from the grid centre (x east, y north)."""
    c = (np.arange(n) - (n - 1) / 2) * res
    return np.meshgrid(c, -c)


# ---------------------------------------------------------------------------------------------------------------
# Encoding, relief, boost
# ---------------------------------------------------------------------------------------------------------------
def test_encoding_is_decimetres_with_a_top_code_and_nodata():
    v = np.array([[0.0, 0.04, 0.06, 1.23], [25.3, 25.4, 80.0, np.nan]])
    valid = np.array([[True, True, True, True], [True, True, True, True]])
    code = terrain3d.encode(v, valid)
    assert code.dtype == np.uint8
    assert code.tolist() == [[0, 0, 1, 12], [253, 254, 254, 255]]
    assert terrain3d.encode(v, ~valid).tolist() == [[255] * 4] * 2
    back = terrain3d.decode(code)
    assert np.isnan(back[1, 3]) and back[0, 3] == pytest.approx(1.2)


@pytest.mark.parametrize("range_m,width_m,want", [(9.0, 60000, 10.0), (27.0, 60000, 10.0), (60.0, 20000, 8.0),
                                                  (150.0, 20000, 3.0), (533.0, 60000, 3.0), (800.0, 12000, 1.5),
                                                  (0.0, 12000, 10.0)])
def test_boost_rule(range_m, width_m, want):
    assert terrain3d.boost_factor(range_m, width_m) == want


def test_relief_near_the_water_or_the_whole_grid():
    x, y = _cols()
    dem = 100.0 + 0.002 * np.abs(x) + np.where(np.abs(x) > 2500, 300.0, 0.0)     # a flat floodplain, high hills
    water = np.abs(x) < 300
    near = terrain3d.relief(dem, RES, 6000.0, water)
    assert near["area"] == "water" and near["range_m"] < 10 and near["exaggeration"] == 10.0
    assert near["rule"] == tcopy.RELIEF_RULE and "2 km" in near["area_note"]
    whole = terrain3d.relief(dem, RES, 6000.0, None)
    assert whole["area"] == "grid" and whole["range_m"] > 290 and whole["exaggeration"] == 1.5
    assert whole["area_note"] == tcopy.RELIEF_AREA_GRID


# ---------------------------------------------------------------------------------------------------------------
# HAND on a synthetic valley with a known answer
# ---------------------------------------------------------------------------------------------------------------
def test_hand_of_a_v_valley_is_the_side_slope_times_the_distance():
    x, y = _cols()
    dem = 100.0 + 0.05 * np.abs(x) + 0.001 * y                           # 5 % side slopes, 1 m/km down to the south
    channel = np.zeros(dem.shape, bool)
    channel[:, 100] = True                                                # the cell column at x = +15 m
    h, valid = terrain3d.hand(dem, RES, channel, max_dist_m=2000.0)
    dist = np.abs(x - x[0, 100])
    assert valid[np.abs(dist) <= 1990].all() and not valid[dist > 2010].any()
    err = h - (dem - (100.0 + 0.05 * np.abs(x[0, 100]) + 0.001 * y))
    # the channel's lowest ground within one cell: at most one cell's slope below the channel cell itself
    assert np.all(err[valid] >= -1e-3) and np.all(err[valid] <= 0.05 * RES + 0.001 * RES + 1e-3)
    assert h[valid].min() >= 0.0


def test_hand_needs_river_lines_on_the_grid():
    g = _grid(64)
    lon0, lat0 = g.local_to_lonlat(-900.0, 0.0)
    lon1, lat1 = g.local_to_lonlat(900.0, 0.0)
    line = {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[float(lon0), float(lat0)],
                                                                                  [float(lon1), float(lat1)]]},
            "properties": {"strm_order": 4}}
    small = {**line, "properties": {"strm_order": 1}}
    assert terrain3d.channel_order([line, small]) == 3 and terrain3d.channel_order([small]) == 1
    ch = terrain3d.rasterize_lines([line, small], g, 3)
    assert 55 <= ch.sum() <= 70 and ch[31:33, :].sum() >= 55          # one row across the middle
    assert not terrain3d.rasterize_lines([small], g, 3).any()


def test_hand_matches_the_fixture_valley(flood_fixture_bundle):
    mf = load_script("make_fixture")
    m = json.loads((flood_fixture_bundle / "manifest.json").read_text())
    grid, _ = grids_from_manifest(m)
    v = mf.flood_valley(grid, np.random.default_rng(0))
    dem = np.fromfile(flood_fixture_bundle / "layers" / "elevation.bin", np.float32).reshape(grid.shape)
    flow = load_script("flood_3d").fixture_flowlines(grid)
    ch = terrain3d.rasterize_lines(flow, grid, terrain3d.channel_order(flow))
    h, valid = terrain3d.hand(dem, grid.res_m, ch)
    # the fixture's channel water surface (make_fixture.flood_valley: 2.5 m/km, flowing west); its noise depends on the
    # fixture's random state, so the true height above it comes from the bundle's own terrain
    X, _ = grid.cell_centers_local()
    true = dem - (1488.0 + 0.0025 * (X + 0.5 * grid.extent_m))
    near = valid & (v.d < 600.0) & (v.d > 40.0)                           # the floodplain, off the channel itself
    diff = h[near] - true[near]
    # measured from the channel bottom in the DEM (2.2 m below the fixture's water surface): a constant offset
    off = float(np.median(diff))
    assert 1.5 <= off <= 3.0
    assert np.percentile(np.abs(diff - off), 90) < 1.0


# ---------------------------------------------------------------------------------------------------------------
# FwDET on a bathtub with a known water surface
# ---------------------------------------------------------------------------------------------------------------
def test_fwdet_recovers_a_flat_water_surface():
    x, y = _cols()
    dem = 100.0 + 0.01 * np.abs(x)                                        # 1 % side slopes
    surface = 104.0
    water = dem < surface
    open_ground = ~water
    got = terrain3d.fwdet(dem, water, open_ground)
    assert got is not None
    d, valid = got
    assert (valid == water).all() and np.all(d[~water] == 0)
    true = surface - dem[water]
    err = d[water] - true
    assert np.abs(err).max() < 0.01 * RES * 2 + 0.05                        # within two cells' slope
    # the edge cells lie just inside the water: the surface reads a little low (FwDET's known bias), by at most one
    # cell's rise of the bank
    assert -0.01 * RES - 0.01 <= float(np.median(err)) <= 0.05
    assert float(d[water].max()) == pytest.approx(4.0, abs=0.5)


def test_fwdet_edges_against_clouds_or_the_border_are_not_used():
    x, y = _cols()
    dem = 100.0 + 0.01 * np.abs(x)
    water = dem < 104.0
    cloud = ~water                                                        # all the ground is under cloud
    assert terrain3d.fwdet(dem, water, np.zeros_like(water)) is None
    # the east bank seen, the west bank under cloud: the surface comes from the east bank only
    og = ~water & (x > 0)
    d, _ = terrain3d.fwdet(dem, water, og)
    assert float(np.median(d[water])) == pytest.approx(float(np.median(104.0 - dem[water])), abs=0.4)
    assert cloud.any()
    # water touching only the grid border has no edge
    border = np.zeros_like(water)
    border[:, :3] = True
    assert terrain3d.water_edge(border, np.zeros_like(border)).sum() == 0


# ---------------------------------------------------------------------------------------------------------------
# The manifest entry
# ---------------------------------------------------------------------------------------------------------------
def test_products_say_why_each_one_is_missing():
    g = _grid(80)
    x, y = _cols(80)
    dem = (100.0 + 0.01 * np.abs(x)).astype(np.float32)
    sat = np.where(dem < 102.0, opera.OPEN_WATER, opera.NOT_WATER).astype(np.uint8)
    fc = np.zeros(dem.shape, np.uint8)                                    # the forecast maps no water here
    res = terrain3d.products(dem, g, water=terrain3d.water_layers_of(sat, 1_793_000_000_000, None, fc, None, None),
                             flowlines=None, flowlines_reason=None, time_zone="America/Denver", now=1_793_100_000_000)
    e = res.entry
    validate_strict(FloodTerrain3d, e)
    assert e["scale_m"] == 0.1 and e["top_code"] == 254 and e["nodata"] == 255 and e["version"] == 1
    assert e["hand"]["status"] == "unavailable" and e["hand"]["reason"] == tcopy.HAND_NO_LINES
    assert e["hand"]["label"] == tcopy.HAND_LABEL and e["hand"]["layer"] is None
    sat_d, fc_d = e["depth"]
    assert sat_d["key"] == "depth_satellite" and sat_d["status"] == "ok" and sat_d["layer"] == "depth_satellite"
    assert sat_d["label"] == tcopy.DEPTH_LABEL and sat_d["caveat"] == tcopy.DEPTH_CAVEAT
    assert sat_d["source"].startswith("Water seen by satellite (NASA OPERA), image of ") and "MDT" in sat_d["source"]
    assert sat_d["stats"]["max_m"] <= 2.5 and sat_d["source_layer"] == "water_satellite"
    assert fc_d["status"] == "not_covered" and fc_d["reason"] == tcopy.DEPTH_NO_WATER and fc_d["layer"] is None
    assert set(res.rasters) == {"depth_satellite"}
    code = res.rasters["depth_satellite"]
    assert (code[sat != opera.OPEN_WATER] == terrain3d.NODATA).all() and (code[sat == opera.OPEN_WATER] < 255).all()
    none = terrain3d.products(dem, g, water=terrain3d.water_layers_of(None, None, "Satellite water could not be "
                                                                      "loaded right now.", None, None, None),
                              flowlines=[], flowlines_reason=None, time_zone="UTC", now=0)
    assert none.entry["hand"]["status"] == "not_covered" and none.entry["hand"]["reason"] == tcopy.HAND_NO_CHANNEL
    assert [d["status"] for d in none.entry["depth"]] == ["unavailable", "unavailable"]
    assert none.entry["depth"][1]["reason"] == tcopy.DEPTH_NO_LAYER
    assert none.entry["relief"]["area"] == "grid"


# ---------------------------------------------------------------------------------------------------------------
# The build step and the upgrade script
# ---------------------------------------------------------------------------------------------------------------
def test_build_writes_hand_and_depth_with_river_lines(recorded_flood, monkeypatch):  # noqa: F811
    summary, now, calls = recorded_flood
    timeline.reset_state()
    grid, _ = build.flood_grid(summary)
    lines = []
    for z in (-6000.0, 0.0, 9000.0):
        a = grid.local_to_lonlat(-29000.0, z)
        b = grid.local_to_lonlat(29000.0, z + 3000.0)
        lines.append({"type": "Feature", "properties": {"feature_id": int(z) + 10000, "name": "Test River",
                                                        "strm_order": 5},
                      "geometry": {"type": "LineString", "coordinates": [[float(a[0]), float(a[1])],
                                                                         [float(b[0]), float(b[1])]]}})
    routes = _routes() + [("maps.water.noaa.gov", r"static_nwm_flowlines/MapServer/0/query$",
                           {"type": "FeatureCollection", "features": lines})]
    monkeypatch.setattr(fhttp, "_transport", route_transport(routes, calls))
    m = build.build_flood(summary["id"], now=now)
    validate_strict(FloodManifest, m)
    bdir = store.flood_dir(summary["id"])
    t3 = m["terrain3d"]
    assert t3["hand"]["status"] == "ok" and t3["hand"]["layer"] == "hand" and m["files"]["maps"]["flowlines"]
    assert t3["relief"]["exaggeration"] in terrain3d.NICE_FACTORS
    for name in ["hand"] + [d["layer"] for d in t3["depth"] if d["layer"]]:
        info = m["layers"][name]
        assert info["dtype"] == "uint8" and info["nodata"] == 255 and info["units"] == "0.1 m"
        assert (bdir / info["file"]).stat().st_size == 1024 * 1024
    hand = np.fromfile(bdir / "layers" / "hand.bin", np.uint8).reshape(1024, 1024)
    assert (hand == 0).any() and (hand < 255).mean() > 0.5
    assert any("river lines" in d["detail"] for d in m["data_sources"])
    rep, _ = load_script("check_bundle").check_flood_bundle(bdir)
    assert rep.problems == []
    assert sum(p.stat().st_size for p in bdir.rglob("*") if p.is_file()) < 30e6


def test_upgrade_script_adds_products_to_the_fixture(flood_fixture_bundle, tmp_data_dir, monkeypatch):
    dst = tmp_data_dir / "floods" / "fixture-flood"
    shutil.copytree(flood_fixture_bundle, dst)
    from fire3d import config

    monkeypatch.setattr(config, "FLOODS_DIR", tmp_data_dir / "floods")
    assert load_script("flood_3d").main(["fixture-flood"]) == 0
    m = json.loads((dst / "manifest.json").read_text())
    validate_strict(FloodManifest, m)
    t3 = m["terrain3d"]
    assert contract_problems(FloodTerrain3d, t3) == []
    assert t3["hand"]["status"] == "ok" and all(d["status"] == "ok" for d in t3["depth"])
    assert m["files"]["maps"]["flowlines"] == "maps/flowlines.geojson" and "timeline" not in m["files"]
    rep, _ = load_script("check_bundle").check_flood_bundle(dst)
    assert rep.problems == []
