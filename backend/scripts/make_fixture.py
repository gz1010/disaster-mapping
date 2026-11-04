#!/usr/bin/env python
"""Write synthetic, contract-complete incident bundles into ``DATA_DIR/incidents`` (the default run writes the first two):

* ``fixture-demo``  historical (2025), 12 km AOI near Altadena (EPSG:32611): ~5 days to ~12,000 ac, a wind event,
  a spot fire across the creek, containment; hindcast ``fx-001`` launched 24 h after ignition (perturbed x31).
* ``fixture-live``  live, 16 km AOI in the Santa Lucia Range (EPSG:32610): "now" is ~2/3 through the observed
  period, nothing is observed after now, and forecast ``fx-001`` (gfs025 x31) starts at now. Dates are relative to
  the moment this script runs.
* ``fixture-east``  (``--only east``, brief 3) historical (2025), 12 km AOI near Black Cove, NC (EPSG:32617,
  America/New_York): a synthetic NIFC WFIGS-style fire (``state`` "NC", ``record_source`` "wfigs", ``record_issuer``
  "NIFC WFIGS (IRWIN)", ``irwin_id`` null, ``calfire_uid`` ""), for browser checks of Eastern time and UTM 17 without a
  build. It is bundle-only: never buildable, and it has no agency record (CONTRACT 14.12.9).

Everything is procedural (numpy/scipy/Pillow, fixed seeds): ridged-fBm terrain with a carved river valley, FBFM40
fuels by elevation/aspect/slope, canopy, a NAIP-like aerial photo, sky-view AO, water, ~60k trees, an anisotropic
(wind + slope + fuel) arrival-time field from a 16-neighbour Dijkstra, satellite detections sampled from it, perimeters,
hourly series, events, diurnal weather with a wind event, and an ensemble forecast. Every JSON file is validated
strictly against ``fire3d.contracts``. The spread here is NOT pyretechnics output: it only has to look plausible.

* ``fixture-flood`` (``--only flood``, brief 5; also in the default run) live, 12 km AOI in San Juan County, NM: the synthetic
  "Ridge Fork River flood" (fictional office, gauges and products, all marked synthetic), with every flood bundle layer
  and file, and canned answers for every flood route in ``data/floods/fixture-flood/api/`` (PLAN-5 7.1, CONTRACT 16.9).
  ``--now 2026-11-04T18:00:00Z`` pins its times; ``--copy-api tests/data/floods/fixture_api`` writes the committed copy.

Usage: ``uv run python scripts/make_fixture.py [--data-dir DIR] [--only demo|live|east|flood] [--members 31] [--quicklook DIR]
[--now ISO] [--copy-api DIR]``
"""

from __future__ import annotations

import argparse
import io
import math
import shutil
import sys
import time
import warnings
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
from PIL import Image
from scipy import ndimage, special
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from shapely.geometry import LineString
from skimage import measure
from skimage.transform import resize

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fire3d import bundle, config  # noqa: E402
from fire3d.contracts import (  # noqa: E402
    DetectionsFile,
    EventsFile,
    ForecastManifest,
    IncidentManifest,
    PerimetersFile,
    TimeseriesFile,
    WeatherFile,
    validate_strict,
)
from fire3d.grid import Grid, fire_grid_size, manifest_grid, slope_aspect, transformer, utm_epsg_for, weather_axes  # noqa: E402
from fire3d.timeutil import DAY_MS, HOUR_MS, floor_hour_ms, now_ms, time_origin_for  # noqa: E402

LA = ZoneInfo("America/Los_Angeles")      # the zone of the scenario being built (set by build_fixture; demo/live: Pacific)
NEVER = config.NEVER
ACRE = config.ACRE_M2
CHAIN = config.CHAIN_M
NB_CODES = (91, 92, 93, 98, 99)
PYRETECHNICS_VERSION = "2026.8.10"

# land-cover classes used for fuels + imagery
SH5, SH7, GS2, GR2, TU5, TL8, RIP, BAR, URB, WAT = range(10)
CLASS_FBFM = np.array([145, 147, 122, 102, 165, 188, 122, 99, 91, 98], np.uint8)
CLASS_SPEED = np.array([1.5, 1.8, 2.2, 2.9, 0.55, 0.30, 0.8, 0.0, 0.0, 0.035], np.float32)  # relative; water = slow "spotting" crossing
CLASS_FLAME_M = np.array([3.6, 5.2, 2.0, 1.3, 2.8, 0.9, 1.6, 0.0, 0.0, 0.0], np.float32)


# =================================================================================================================
# Noise
# =================================================================================================================
class Perlin:
    """Vectorized 2-D gradient noise (~[-1, 1])."""

    def __init__(self, seed: int):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256)
        self.perm = np.concatenate([p, p]).astype(np.int64)
        ang = rng.uniform(0.0, 2 * np.pi, 256)
        self.gx, self.gy = np.cos(ang), np.sin(ang)

    def __call__(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        x0, y0 = np.floor(x), np.floor(y)
        xf, yf = x - x0, y - y0
        xi, yi = x0.astype(np.int64) & 255, y0.astype(np.int64) & 255
        p = self.perm
        a, b = p[xi], p[xi + 1]
        h00, h01, h10, h11 = p[a + yi], p[a + yi + 1], p[b + yi], p[b + yi + 1]
        gx, gy = self.gx, self.gy
        n00 = gx[h00] * xf + gy[h00] * yf
        n10 = gx[h10] * (xf - 1) + gy[h10] * yf
        n01 = gx[h01] * xf + gy[h01] * (yf - 1)
        n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1)
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        nx0 = n00 + u * (n10 - n00)
        nx1 = n01 + u * (n11 - n01)
        return (nx0 + v * (nx1 - nx0)) * 1.4142


def fbm(noise: Perlin, x, y, octaves: int, lac: float = 2.0, gain: float = 0.5) -> np.ndarray:
    total, amp, freq, norm = 0.0, 1.0, 1.0, 0.0
    for i in range(octaves):
        total = total + amp * noise(x * freq + 17.31 * i, y * freq - 9.13 * i)
        norm += amp
        amp *= gain
        freq *= lac
    return total / norm


def ridged(noise: Perlin, x, y, octaves: int, lac: float = 2.0, gain: float = 2.0, h: float = 0.9) -> np.ndarray:
    """Musgrave ridged multifractal."""
    total, weight, freq = 0.0, 1.0, 1.0
    for i in range(octaves):
        n = noise(x * freq + 31.7 * i, y * freq + 12.9 * i)
        signal = (1.0 - np.abs(n)) ** 2 * weight
        weight = np.clip(signal * gain, 0.0, 1.0)
        total = total + signal * freq ** (-h)
        freq *= lac
    return total


def eroded_fbm(noise: Perlin, x, y, octaves: int, step: float, gain: float = 0.5) -> np.ndarray:
    """Gradient-damped fBm (I. Quilez "elevated" style): octaves are attenuated where the accumulated slope is
    high, which gives smooth valleys and crisp ridges. ``step`` = noise units per pixel at frequency 1."""
    total = np.zeros_like(x)
    dx = np.zeros_like(x)
    dy = np.zeros_like(x)
    amp, freq = 1.0, 1.0
    for i in range(octaves):
        n = noise(x * freq + 17.31 * i, y * freq - 9.13 * i)
        g_r, g_c = np.gradient(n, step * freq)
        dx += g_c / freq
        dy += g_r / freq
        total += amp * n / (1.0 + 0.9 * (dx * dx + dy * dy))
        amp *= gain
        freq *= 2.0
    return total


def value_fbm(rng: np.random.Generator, shape: tuple[int, int], cells: float, octaves: int = 3, gain: float = 0.55) -> np.ndarray:
    """Fast smooth noise: bicubic-upsampled white noise, summed over octaves; zero mean, unit std (float32)."""
    h, w = shape
    out = np.zeros(shape, np.float32)
    amp, c = 1.0, float(cells)
    for _ in range(octaves):
        gh = max(4, int(round(c * h / max(h, w))) + 3)
        gw = max(4, int(round(c * w / max(h, w))) + 3)
        g = rng.standard_normal((gh, gw)).astype(np.float32)
        z = ndimage.zoom(g, (h / gh, w / gw), order=3, mode="reflect", grid_mode=True)
        out += amp * z[:h, :w]
        amp *= gain
        c *= 2.0
    out -= out.mean()
    out /= out.std() + 1e-9
    return out


def smoothstep(e0: float, e1: float, x) -> np.ndarray:
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smin(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    """Smooth minimum (log-sum-exp), k in the same units as a/b."""
    m = np.minimum(a, b)
    return m - k * np.log1p(np.exp(-np.abs(a - b) / k))


# =================================================================================================================
# Scenarios
# =================================================================================================================
@dataclass
class WindEvent:
    t_h: float          # hours after ignition
    spread_amp: float   # extra relative spread rate at the peak
    width_h: float
    wind_peak_ms: float


@dataclass
class Scenario:
    id: str
    name: str
    mode: str
    seed: int
    center_lon: float
    center_lat: float
    extent_m: float
    started_ms: int
    wind_from: float                       # dominant FROM direction while the fire runs (deg)
    ignition_uv: tuple[float, float]       # (u west->east, w north->south) in 0..1
    river_u0: float
    river_amp: float
    river_phase: float
    river_top_m: float
    town: tuple[float, float, float, float]   # u0, u1, w0, w1
    events: list[WindEvent]
    spot_h: float
    target_acres: float
    target_at_h: float | None              # None: final area; else area at that hour after ignition
    contain_h: tuple[float, float] | None   # growth decays to 0 between these hours (historical)
    t_mean: float
    t_amp: float
    rh_mean: float
    rh_amp: float
    county: str
    location: str
    admin_unit: str
    calfire_uid: str
    fuels_edition: str
    percent_contained: float
    now_ms: int | None = None              # live: wall-clock "now" used to cut observations
    forecast_events: list[WindEvent] = field(default_factory=list)
    tz: str = "America/Los_Angeles"        # the fire's own zone (local hours, labels); brief 3
    tz_abbr: str = "PT"                    # zone word in event text
    issuer: str = "CAL FIRE"               # who "reported" the synthetic fire (event and ignition text)
    summary_extra: dict = field(default_factory=dict)   # brief-3 summary fields written explicitly (east)


def demo_scenario() -> Scenario:
    started = int(datetime(2025, 8, 14, 21, 26, tzinfo=timezone.utc).timestamp() * 1000)   # 14:26 PDT
    return Scenario(
        id="fixture-demo", name="Ridgeview Fire", mode="historical", seed=7,
        center_lon=-118.07, center_lat=34.20, extent_m=12000.0, started_ms=started,
        wind_from=203.0, ignition_uv=(0.43, 0.76),
        river_u0=0.53, river_amp=0.085, river_phase=0.15, river_top_m=1080.0,
        town=(0.0, 0.40, 0.835, 1.0),
        events=[WindEvent(2.5, 0.9, 3.5, 10.0), WindEvent(26.0, 2.3, 6.5, 20.6), WindEvent(49.5, 0.8, 4.5, 12.0)],
        spot_h=27.0, target_acres=12000.0, target_at_h=None, contain_h=(74.0, 104.0),
        t_mean=27.0, t_amp=7.5, rh_mean=30.0, rh_amp=15.0,
        county="Los Angeles", location="San Gabriel Mountains foothills (synthetic fixture)",
        admin_unit="Synthetic fixture (Angeles NF)", calfire_uid="00000000-f1e3-4d00-8000-00000000d3a0",
        fuels_edition="LF2024", percent_contained=100.0,
    )


def live_scenario() -> Scenario:
    real_now = now_ms()
    started = (real_now - int(79.4 * HOUR_MS)) // 60000 * 60000
    return Scenario(
        id="fixture-live", name="Cedar Canyon Fire", mode="live", seed=23,
        center_lon=-121.45, center_lat=36.20, extent_m=16000.0, started_ms=started,
        wind_from=32.0, ignition_uv=(0.60, 0.27),
        river_u0=0.42, river_amp=0.10, river_phase=0.62, river_top_m=1000.0,
        town=(0.64, 1.0, 0.86, 1.0),
        events=[WindEvent(1.5, 0.3, 3.0, 8.0), WindEvent(30.0, 1.1, 5.0, 14.0), WindEvent(54.0, 1.9, 6.0, 18.0)],
        spot_h=55.0, target_acres=7000.0, target_at_h=(real_now - started) / HOUR_MS, contain_h=None,
        t_mean=24.0, t_amp=8.0, rh_mean=28.0, rh_amp=14.0,
        county="Monterey", location="Santa Lucia Range, Los Padres NF (synthetic fixture)",
        admin_unit="Synthetic fixture (Los Padres NF)", calfire_uid="00000000-f1e3-4d00-8000-0000000011fe",
        fuels_edition="LF2025", percent_contained=18.0, now_ms=real_now,
        forecast_events=[WindEvent((real_now - started) / HOUR_MS + 26.0, 0.7, 6.0, 13.0)],
    )


def east_scenario() -> Scenario:
    """Brief 3 (CONTRACT 14.12.9): a synthetic historical fire near Black Cove, NC (35.29, -82.30), UTM 17, Eastern
    time (EDT on these dates), with a NIFC WFIGS-style record that matches no real record (``irwin_id`` null)."""
    started = int(datetime(2025, 3, 22, 18, 10, tzinfo=timezone.utc).timestamp() * 1000)   # 14:10 EDT
    return Scenario(
        id="fixture-east", name="Fixture East (synthetic)", mode="historical", seed=31,
        center_lon=-82.30, center_lat=35.29, extent_m=12000.0, started_ms=started,
        wind_from=250.0, ignition_uv=(0.38, 0.55),
        river_u0=0.62, river_amp=0.07, river_phase=0.4, river_top_m=700.0,
        town=(0.70, 1.0, 0.80, 1.0),
        events=[WindEvent(3.0, 0.8, 3.5, 9.0), WindEvent(25.0, 1.8, 6.0, 16.0), WindEvent(47.0, 0.6, 4.0, 10.0)],
        spot_h=26.0, target_acres=4000.0, target_at_h=None, contain_h=(70.0, 100.0),
        t_mean=16.0, t_amp=8.0, rh_mean=34.0, rh_amp=14.0,
        county="Polk", location="Blue Ridge escarpment (synthetic fixture)",
        admin_unit="Synthetic fixture (North Carolina)", calfire_uid="",
        fuels_edition="LF2024", percent_contained=100.0,
        tz="America/New_York", tz_abbr="ET", issuer="NIFC WFIGS (IRWIN)",
        summary_extra={
            "uid": "", "record_source": "wfigs", "record_issuer": "NIFC WFIGS (IRWIN)", "state": "NC",
            "time_zone": "America/New_York", "agency": None, "agency_code": None, "irwin_id": None,
            "unique_fire_id": None, "source_name": "Fixture East (synthetic)", "gacc": None, "accuracy_region": None,
            "active_sources": [], "other_records": [], "complex_name": None, "complex_members": [], "aliases": [],
            "contained_kind": "contained",   # its contained_ms is a synthetic WFIGS ContainmentDateTime (final fixes)
        },
    )


def _use_zone(tz: str) -> None:
    """Point the module's local-time helpers (local hours, wall times, labels) at the scenario's zone."""
    global LA
    LA = ZoneInfo(tz)


# =================================================================================================================
# Terrain
# =================================================================================================================
@dataclass
class Terrain:
    dem: np.ndarray            # render grid float32 m
    river_xz: np.ndarray       # (K, 2) centerline local coords
    river_w: np.ndarray        # (K,) along-course parameter 0 (north) .. 1 (south)
    river_tree: cKDTree
    river_d: np.ndarray        # render grid distance to centerline (m)
    river_wn: np.ndarray       # render grid along-course parameter of the nearest centerline point


def make_terrain(sc: Scenario, render: Grid) -> Terrain:
    X, Z = render.cell_centers_local()
    ext = render.extent_m
    u, w = X / ext + 0.5, Z / ext + 0.5
    pn = Perlin(sc.seed)
    f = 3.1 * ext / 12000.0                       # major ridge systems ~4 km apart
    sx, sy = u * f, w * f
    wx = fbm(pn, sx * 0.5 + 3.1, sy * 0.5 + 7.7, 3)
    wy = fbm(pn, sx * 0.5 - 5.3, sy * 0.5 + 1.9, 3)
    big = ridged(pn, sx + 0.45 * wx, sy + 0.45 * wy, 5, h=1.0)
    big = (big - big.min()) / (np.ptp(big) + 1e-9)
    fe = 6.0 * ext / 12000.0
    ero = eroded_fbm(pn, u * fe + 0.6 * wx + 50.0, w * fe + 0.6 * wy - 20.0, 8, step=fe / render.width)
    ero = (ero - ero.min()) / (np.ptp(ero) + 1e-9)
    region = fbm(pn, u * 1.3 + 101.0, w * 1.3 + 57.0, 2)
    north = smoothstep(1.02, 0.15, w)
    h = 0.24 * (1 - w) ** 1.25 + (0.55 * big + 0.42 * ero) * (0.25 + 0.75 * north) + 0.04 * region
    lo, hi = np.percentile(h, [0.3, 99.9])
    elev = 380.0 + (np.clip(h, lo, hi) - lo) / (hi - lo) * (1800.0 - 380.0)
    # southern basin: a gently sloping alluvial plain with low relief
    ripple = fbm(pn, u * 14.0 + 7.0, w * 14.0 + 3.0, 4)
    basin = 350.0 + 120.0 * (1.0 - w) + 10.0 * ripple
    bw = smoothstep(0.80, 0.96, w)
    elev = elev * (1 - 0.92 * bw) + basin * 0.92 * bw
    # meandering river from the north edge to the south edge in a V-shaped valley with textured walls
    ws = np.linspace(-0.03, 1.03, 3000)
    ur = sc.river_u0 + sc.river_amp * np.sin(2 * np.pi * (0.9 * ws + sc.river_phase)) + 0.032 * np.sin(2 * np.pi * (2.6 * ws + 0.4 + sc.river_phase))
    river_xz = np.c_[(ur - 0.5) * ext, (ws - 0.5) * ext]
    tree = cKDTree(river_xz)
    d, idx = tree.query(np.c_[X.ravel(), Z.ravel()], workers=-1)
    d = d.reshape(X.shape)
    wn = np.clip(ws[idx].reshape(X.shape), 0, 1)
    zr = 335.0 + (sc.river_top_m - 335.0) * (1.0 - wn) ** 1.35
    wall = fbm(pn, u * 22.0 - 3.0, w * 22.0 + 11.0, 4)
    highpass = elev - ndimage.gaussian_filter(elev, 6.0, mode="nearest")     # carry gullies onto the valley walls
    floor = zr + 560.0 * (np.clip(d - 45.0, 0, None) / 850.0) ** 1.1 + (40.0 * wall + 0.9 * highpass) * smoothstep(60.0, 350.0, d)
    floor = np.where(d < 24.0, zr - 3.0 * (1.0 - d / 24.0), floor)
    elev = smin(elev, floor, 30.0)
    elev = np.clip(elev, 300.0, 1800.0)
    return Terrain(elev.astype(np.float32), river_xz, ws, tree, d.astype(np.float32), wn.astype(np.float32))


def sky_view_factor(dem: np.ndarray, res: float, n_az: int = 16, max_dist: float = 1500.0, n_steps: int = 18) -> np.ndarray:
    """Horizon-based sky-view factor: mean over azimuths of cos²(horizon angle), 0..1."""
    h, w = dem.shape
    max_off = int(math.ceil(max_dist / res)) + 2
    pad = np.pad(dem.astype(np.float32), max_off, mode="edge")
    dists = np.geomspace(res, max_dist, n_steps)
    svf = np.zeros(dem.shape, np.float32)
    for k in range(n_az):
        az = 2 * math.pi * k / n_az
        de, dn = math.sin(az), math.cos(az)
        max_tan = np.zeros(dem.shape, np.float32)
        seen: set[tuple[int, int]] = set()
        for dist in dists:
            dc, dr = int(round(de * dist / res)), int(round(-dn * dist / res))
            if (dr, dc) in seen or (dr, dc) == (0, 0):
                continue
            seen.add((dr, dc))
            real = math.hypot(dr, dc) * res
            sh = pad[max_off + dr: max_off + dr + h, max_off + dc: max_off + dc + w]
            np.maximum(max_tan, (sh - dem) / real, out=max_tan)
        svf += 1.0 / (1.0 + max_tan * max_tan)
    return svf / n_az


# =================================================================================================================
# Fuels, canopy
# =================================================================================================================
@dataclass
class Fuels:
    cls: np.ndarray            # fire grid land-cover class
    fuel: np.ndarray           # uint8 FBFM40
    cc: np.ndarray             # uint8 %
    ch: np.ndarray             # float32 m
    cbh: np.ndarray            # float32 m
    cbd: np.ndarray            # float32 kg/m³
    elev: np.ndarray           # fire-grid elevation
    slope: np.ndarray
    aspect: np.ndarray
    tpi: np.ndarray


def mode_filter(cls: np.ndarray, n_classes: int, size: int = 3, keep: tuple[int, ...] = ()) -> np.ndarray:
    counts = np.stack([ndimage.uniform_filter((cls == c).astype(np.float32), size=size, mode="nearest") for c in range(n_classes)])
    out = counts.argmax(axis=0).astype(cls.dtype)
    for c in keep:
        out[cls == c] = c
    return out


def make_fuels(sc: Scenario, fire: Grid, terr: Terrain, rng: np.random.Generator) -> Fuels:
    m = fire.width
    elev = resize(terr.dem, (m, m), order=1, anti_aliasing=True, preserve_range=True).astype(np.float32)
    slope, aspect = slope_aspect(elev, fire.res_m)
    tpi = elev - ndimage.gaussian_filter(elev, 500.0 / fire.res_m / 2.0, mode="nearest")
    X, Z = fire.cell_centers_local()
    u, w = X / fire.extent_m + 0.5, Z / fire.extent_m + 0.5
    d_river, _ = terr.river_tree.query(np.c_[X.ravel(), Z.ravel()], workers=-1)
    d_river = d_river.reshape(m, m)
    n1 = value_fbm(rng, (m, m), 10, 3)
    n2 = value_fbm(rng, (m, m), 22, 3)
    asp = np.radians(aspect)
    facing_n = np.cos(asp)
    facing_sw = np.cos(asp - np.radians(225))
    cls = np.full((m, m), SH5, np.uint8)
    cls[(facing_sw > -0.15) & (slope > 0.28) & (elev > 640) & (elev < 1520) & (n1 > -0.25)] = SH7
    cls[elev < 830 + 110 * n2] = GS2
    cls[((elev < 640 + 90 * n1) & (slope < 0.5)) | ((elev < 780) & (np.cos(asp - np.pi) > 0.45) & (n2 > 0.55))] = GR2
    timber = (facing_n > 0.2) & (elev > 1060 + 150 * n2)
    cls[timber] = TU5
    cls[(timber & (elev > 1380 + 90 * n1)) | (elev > 1610 + 70 * n2)] = TL8
    cls[(d_river < 105 + 75 * n1) & (elev < 1250)] = RIP
    cls[((slope > 0.95) & (n2 > 0.1)) | ((tpi > 50) & (elev > 1450) & (n1 > 0.45))] = BAR
    u0, u1, w0, w1 = sc.town
    town = (u >= u0 + 0.035 * n1) & (u <= u1 + 0.035 * n1) & (w >= w0 + 0.02 * n2) & (w <= w1) & (slope < 0.28) & (d_river > 160)
    cls[town] = URB
    cls[d_river < 34.0] = WAT
    cls = mode_filter(cls, 10, 3, keep=(WAT, URB))
    fuel = CLASS_FBFM[cls]

    cc = np.zeros((m, m), np.float32)
    ch = np.zeros((m, m), np.float32)
    cbh = np.zeros((m, m), np.float32)
    cbd = np.zeros((m, m), np.float32)
    nz = value_fbm(rng, (m, m), 40, 2)

    def setv(c: int, cc_mu: float, cc_sd: float, ch_mu: float, ch_sd: float, cbh_mu: float, cbd_mu: float) -> None:
        sel = cls == c
        cc[sel] = np.clip(cc_mu + cc_sd * nz[sel], 0, 95)
        ch[sel] = np.clip(ch_mu + ch_sd * n2[sel], 2.0, 40.0)
        cbh[sel] = np.clip(cbh_mu * (1 + 0.3 * n1[sel]), 0.5, 10.0)
        cbd[sel] = np.clip(cbd_mu * (1 + 0.25 * nz[sel]), 0.01, 0.35)

    setv(TU5, 58, 14, 16, 4, 2.5, 0.14)
    setv(TL8, 66, 13, 24, 5, 4.0, 0.10)
    setv(RIP, 60, 12, 13, 3, 3.0, 0.07)
    setv(URB, 18, 8, 9, 2.5, 3.0, 0.03)
    oaks = ((cls == SH5) | (cls == GS2)) & (nz > 1.1)          # scattered oak woodland in chaparral / grass-shrub
    cc[oaks] = np.clip(14 + 10 * (nz[oaks] - 1.1), 5, 45)
    ch[oaks] = np.clip(7 + 2 * n2[oaks], 4, 12)
    cbh[oaks] = 2.0
    cbd[oaks] = 0.05
    cc = np.round(cc).astype(np.uint8)
    none = cc == 0
    ch[none] = cbh[none] = cbd[none] = 0.0
    return Fuels(cls, fuel, cc, ch.astype(np.float32), cbh.astype(np.float32), cbd.astype(np.float32), elev, slope, aspect, tpi.astype(np.float32))


# =================================================================================================================
# Spread (synthetic): anisotropic travel time on a 16-neighbour graph + a separable time profile
# =================================================================================================================
OFFSETS = [(0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1),
           (1, 2), (1, -2), (-1, 2), (-1, -2), (2, 1), (2, -1), (-2, 1), (-2, -1)]


class SpreadGraph:
    """Directed graph whose edge weights are travel 'effort' = length / (fuel x slope x wind factor)."""

    def __init__(self, fu: Fuels, res: float, rng: np.random.Generator, lb_ratio: float = 1.9):
        m = fu.cls.shape[0]
        self.m = m
        burnable = CLASS_SPEED[fu.cls] > 0
        edge = np.minimum.reduce([np.arange(m)[:, None] + np.zeros((1, m)), (m - 1 - np.arange(m))[:, None] + np.zeros((1, m)),
                                  np.arange(m)[None, :] + np.zeros((m, 1)), (m - 1 - np.arange(m))[None, :] + np.zeros((m, 1))]) * res
        speed = CLASS_SPEED[fu.cls] * np.exp(0.5 * value_fbm(rng, (m, m), 26, 3)) * (0.03 + 0.97 * smoothstep(150.0, 900.0, edge))
        idx = np.arange(m * m).reshape(m, m)
        src_l, dst_l, len_l, th_l, base_l = [], [], [], [], []
        for dr, dc in OFFSETS:
            r0, r1, c0, c1 = max(0, -dr), m - max(0, dr), max(0, -dc), m - max(0, dc)
            ok = burnable[r0:r1, c0:c1] & burnable[r0 + dr:r1 + dr, c0 + dc:c1 + dc]
            if abs(dr) == 1 and abs(dc) == 1:
                ok &= burnable[r0 + dr:r1 + dr, c0:c1] & burnable[r0:r1, c0 + dc:c1 + dc]
            elif abs(dr) == 2:
                hr = dr // 2
                ok &= burnable[r0 + hr:r1 + hr, c0:c1] & burnable[r0 + hr:r1 + hr, c0 + dc:c1 + dc]
            elif abs(dc) == 2:
                hc = dc // 2
                ok &= burnable[r0:r1, c0 + hc:c1 + hc] & burnable[r0 + dr:r1 + dr, c0 + hc:c1 + hc]
            length = res * math.hypot(dr, dc)
            rise = (fu.elev[r0 + dr:r1 + dr, c0 + dc:c1 + dc] - fu.elev[r0:r1, c0:c1]) / length
            f_s = np.where(rise > 0, np.minimum(1.0 + 4.0 * rise * rise, 6.0), 1.0 / (1.0 + 1.2 * np.abs(rise)))
            base = np.sqrt(speed[r0:r1, c0:c1] * speed[r0 + dr:r1 + dr, c0 + dc:c1 + dc]) * f_s
            src_l.append(idx[r0:r1, c0:c1][ok])
            dst_l.append(idx[r0 + dr:r1 + dr, c0 + dc:c1 + dc][ok])
            len_l.append(np.full(int(ok.sum()), length))
            th_l.append(np.full(int(ok.sum()), math.degrees(math.atan2(dc, -dr)) % 360.0))
            base_l.append(base[ok])
        self.src = np.concatenate(src_l)
        dst = np.concatenate(dst_l)
        self.length = np.concatenate(len_l)
        self.theta = np.radians(np.concatenate(th_l))
        self.base = np.concatenate(base_l)
        n = m * m
        self.csr = csr_matrix((np.arange(1, len(self.src) + 1, dtype=np.float64), (self.src, dst)), shape=(n, n))
        self.perm = (self.csr.data - 1).astype(np.int64)
        self.ecc = math.sqrt(1.0 - 1.0 / (lb_ratio * lb_ratio))
        self.omega_noise = 16.0 * value_fbm(rng, (m, m), 6, 2).ravel()
        self.burnable = burnable

    def solve(self, sources: np.ndarray, wind_from: float) -> np.ndarray:
        """Effort-to-reach every cell from ``sources`` (flat indices); inf where unreachable. (M, M) float64."""
        omega = np.radians((wind_from + 180.0 + self.omega_noise[self.src]) % 360.0)
        e = self.ecc
        f_w = (1.0 - e) / (1.0 - e * np.cos(self.theta - omega))
        cost = self.length / (self.base * f_w)
        self.csr.data = cost[self.perm]
        d = dijkstra(self.csr, directed=True, indices=np.atleast_1d(sources), min_only=True)
        return d.reshape(self.m, self.m)


def local_hour(ms) -> np.ndarray:
    """Local (America/Los_Angeles) hour of day (float) for epoch-ms timestamps."""
    ms = np.asarray(ms, dtype=np.int64)
    uniq, inv = np.unique(ms // HOUR_MS, return_inverse=True)
    offs = np.array([datetime.fromtimestamp(int(h) * 3600, tz=LA).utcoffset().total_seconds() / 3600.0 for h in uniq])
    return (ms / HOUR_MS + offs[inv].reshape(ms.shape)) % 24.0


def la_ms(day: date, hour_local: float) -> int:
    """Epoch ms of a local (America/Los_Angeles) wall-clock time."""
    hh = int(hour_local) % 24
    mm = int(round((hour_local - int(hour_local)) * 60)) % 60
    return int(datetime(day.year, day.month, day.day, hh, mm, tzinfo=LA).timestamp() * 1000)


def diurnal(hl: np.ndarray, peak: float = 15.0) -> np.ndarray:
    return ((1.0 + np.cos(2 * np.pi * (hl - peak) / 24.0)) / 2.0) ** 1.5


def event_sum(t_h: np.ndarray, events: list[WindEvent], attr: str = "spread_amp") -> np.ndarray:
    out = np.zeros_like(t_h, dtype=np.float64)
    for ev in events:
        out += getattr(ev, attr) * np.exp(-(((t_h - ev.t_h) / ev.width_h) ** 2))
    return out


def spread_rate_profile(sc: Scenario, t_h: np.ndarray, events: list[WindEvent], contain: tuple[float, float] | None) -> np.ndarray:
    """Relative spread rate over time (hours after ignition): diurnal x wind events x containment."""
    hl = local_hour(sc.started_ms + (t_h * HOUR_MS).astype(np.int64))
    s = (0.15 + 0.85 * diurnal(hl)) * (1.0 + event_sum(t_h, events))
    if contain is not None:
        a, b = contain
        s = s * np.clip(1.0 - (t_h - a) / (b - a), 0.0, 1.0) ** 1.5
    return s


def cumulative(t_h: np.ndarray, s: np.ndarray) -> np.ndarray:
    dt = np.diff(t_h, prepend=t_h[0])
    c = np.cumsum(s * dt)
    return c + np.arange(len(c)) * 1e-9          # strictly increasing for interpolation


@dataclass
class TruthFire:
    arrival_h: np.ndarray       # hours since time_origin (fire grid), NEVER where unburned
    k: float
    t_grid: np.ndarray
    S: np.ndarray
    spot_xz: tuple[float, float]
    spot_rc: tuple[int, int]
    ign_rc: tuple[int, int]
    tau_main: np.ndarray
    tau_spot: np.ndarray


def nearest_burnable(burnable: np.ndarray, r: int, c: int) -> tuple[int, int]:
    if burnable[r, c]:
        return r, c
    rr, cc = np.nonzero(burnable)
    i = int(np.argmin((rr - r) ** 2 + (cc - c) ** 2))
    return int(rr[i]), int(cc[i])


def simulate_truth(sc: Scenario, fire: Grid, fu: Fuels, graph: SpreadGraph, terr: Terrain) -> TruthFire:
    m = fire.width
    origin = time_origin_for(sc.started_ms)
    ign_off_h = (sc.started_ms - origin) / HOUR_MS
    r0, c0 = int(sc.ignition_uv[1] * m), int(sc.ignition_uv[0] * m)
    ign = nearest_burnable(graph.burnable, r0, c0)
    t_grid = np.arange(0.0, 240.0, 1.0 / 12.0)
    S = cumulative(t_grid, spread_rate_profile(sc, t_grid, sc.events, sc.contain_h))
    lim_h = sc.target_at_h if sc.target_at_h is not None else t_grid[-1]
    s_lim = float(np.interp(lim_h, t_grid, S))
    res2 = fire.res_m**2
    target_px = sc.target_acres * ACRE / res2

    tau_main = graph.solve(np.array([ign[0] * m + ign[1]]), sc.wind_from)

    def calibrate(tau_eff_fn) -> float:
        lo, hi = -12.0, 12.0
        for _ in range(70):
            mid = (lo + hi) / 2
            k = 10.0**mid
            area = np.count_nonzero(tau_eff_fn(k) / k <= s_lim)
            lo, hi = (mid, hi) if area < target_px else (lo, mid)
        return 10.0 ** ((lo + hi) / 2)

    k1 = calibrate(lambda k: tau_main)
    # spot fire: downwind of the main front at spot time, across the river when the front is near it
    s_spot = float(np.interp(sc.spot_h, t_grid, S))
    front = np.argwhere((tau_main / k1 <= s_spot) & (tau_main / k1 > float(np.interp(sc.spot_h - 3, t_grid, S))))
    if len(front) == 0:
        front = np.argwhere(tau_main / k1 <= s_spot)
    toward = np.radians((sc.wind_from + 180.0) % 360.0)
    dir_e, dir_s = math.sin(toward), -math.cos(toward)          # x east, z south
    fx = (front[:, 1] + 0.5) * fire.res_m - fire.extent_m / 2
    fz = (front[:, 0] + 0.5) * fire.res_m - fire.extent_m / 2
    lead = int(np.argmax(fx * dir_e + fz * dir_s))
    spot = None
    for dist in np.arange(450.0, 1500.0, 30.0):
        sx, sz = fx[lead] + dir_e * dist, fz[lead] + dir_s * dist
        rr, cc = int((sz + fire.extent_m / 2) / fire.res_m), int((sx + fire.extent_m / 2) / fire.res_m)
        if not (0 <= rr < m and 0 <= cc < m):
            break
        d_r, _ = terr.river_tree.query([sx, sz])
        if graph.burnable[rr, cc] and fu.cls[rr, cc] != WAT and d_r > 120 and tau_main[rr, cc] / k1 > s_spot + 1e-6:
            spot = (rr, cc)
            if dist > 650:
                break
    if spot is None:
        spot = nearest_burnable(graph.burnable, int(np.clip(front[lead][0] - 20 * dir_s, 0, m - 1)), int(np.clip(front[lead][1] + 20 * dir_e, 0, m - 1)))
    tau_spot = graph.solve(np.array([spot[0] * m + spot[1]]), sc.wind_from)

    def eff(k: float) -> np.ndarray:
        return np.minimum(tau_main, k * s_spot + tau_spot)

    k = calibrate(eff)
    sigma = eff(k) / k
    burned = sigma <= s_lim
    t_since = np.interp(np.where(burned, sigma, 0.0), S, t_grid)
    arrival = np.where(burned & (fu.cls != WAT), ign_off_h + t_since, NEVER).astype(np.float32)
    arrival[ign] = ign_off_h
    sx = (spot[1] + 0.5) * fire.res_m - fire.extent_m / 2
    sz = (spot[0] + 0.5) * fire.res_m - fire.extent_m / 2
    return TruthFire(arrival, k, t_grid, S, (sx, sz), spot, ign, tau_main, tau_spot)


# =================================================================================================================
# Observations derived from the arrival field
# =================================================================================================================
def ms_of(origin: int, h: float | np.ndarray):
    return origin + np.round(np.asarray(h) * HOUR_MS).astype(np.int64)


def make_detections(sc: Scenario, fire: Grid, arrival_h: np.ndarray, origin: int, end_ms: int, rng: np.random.Generator) -> list[dict]:
    """VIIRS (3 sats) + MODIS (Terra/Aqua) passes, GOES every 10 min, one Landsat pass; sampled from the arrival field."""
    rr, cc = np.nonzero(arrival_h < NEVER)
    a = arrival_h[rr, cc].astype(np.float64)
    px = (cc + 0.5) * fire.res_m - fire.extent_m / 2
    pz = (rr + 0.5) * fire.res_m - fire.extent_m / 2
    start_ms = sc.started_ms - 2 * HOUR_MS
    out: list[dict] = []
    half = fire.extent_m / 2

    def emit(t_ms: int, x: float, z: float, frp: float | None, sat: str, inst: str, conf: str, foot: float) -> None:
        lon, lat = fire.local_to_lonlat(x, z)
        hl = float(local_hour(np.array([t_ms]))[0])
        out.append({
            "t_ms": int(t_ms), "lat": round(lat, 6), "lon": round(lon, 6), "x": round(float(x), 1), "z": round(float(z), 1),
            "frp": None if frp is None else round(float(frp), 2), "satellite": sat, "instrument": inst,
            "confidence": conf, "daynight": "D" if 6.0 <= hl < 19.0 else "N", "footprint_m": foot,
        })

    def cells(t_ms: int, size: float, tau_h: float, window_h: float):
        th = (t_ms - origin) / HOUR_MS
        sel = (a <= th) & (a > th - window_h)
        if not sel.any():
            return None
        wgt = np.exp(-(th - a[sel]) / tau_h)
        ox, oz = rng.uniform(0, size, 2)
        ci = np.floor((px[sel] + half + ox) / size).astype(np.int64)
        cj = np.floor((pz[sel] + half + oz) / size).astype(np.int64)
        n = int(math.ceil((fire.extent_m + size) / size)) + 1
        key = cj * n + ci
        tot = np.bincount(key, weights=wgt, minlength=n * n)
        per_cell = (size / fire.res_m) ** 2
        frac = tot / per_cell
        hit = np.nonzero(frac > 0)[0]
        xs = (hit % n + 0.5) * size - half - ox
        zs = (hit // n + 0.5) * size - half - oz
        return frac[hit], xs, zs

    # polar orbiters: (satellite, instrument, local day hour, local night hour, cell size m, conf style)
    polar = [("N", "VIIRS", 13.5, 1.5, 375.0), ("N20", "VIIRS", 12.7, 0.7, 375.0), ("N21", "VIIRS", 13.1, 1.1, 375.0),
             ("Terra", "MODIS", 10.5, 22.5, 1000.0), ("Aqua", "MODIS", 13.5, 1.5, 1000.0)]
    day = datetime.fromtimestamp(start_ms / 1000, tz=LA).date() - timedelta(days=1)
    last_day = datetime.fromtimestamp(end_ms / 1000, tz=LA).date() + timedelta(days=1)
    while day <= last_day:
        for sat, inst, h_day, h_night, size in polar:
            for hloc in (h_day, h_night):
                t = int(la_ms(day, hloc) + rng.normal(0, 0.45) * HOUR_MS)
                if not (start_ms <= t <= end_ms):
                    continue
                res = cells(t, size, 1.5, 6.0)
                if res is None:
                    continue
                frac, xs, zs = res
                thr = 0.02 if inst == "VIIRS" else 0.025
                for f, x, z in zip(frac, xs, zs):
                    if f < thr or rng.random() > 0.36 * min(0.9, 0.2 + 9 * f):
                        continue
                    jx, jz = rng.normal(0, 0.15 * size, 2)
                    if inst == "VIIRS":
                        frp = 1.0 + 260.0 * f * rng.lognormal(0, 0.45)
                        conf = "h" if f > 0.12 else "n"
                    else:
                        frp = 4.0 + 1100.0 * f * rng.lognormal(0, 0.45)
                        conf = str(int(np.clip(55 + 220 * f, 30, 100)))
                    emit(t, x + jx, z + jz, frp, sat, inst, conf, size)
        day += timedelta(days=1)
    # Landsat: one daytime pass near the middle of the observed period
    t_land = la_ms(datetime.fromtimestamp((sc.started_ms + 0.45 * (end_ms - sc.started_ms)) / 1000, tz=LA).date(), 10.75)
    if start_ms <= t_land <= end_ms:
        th = (t_land - origin) / HOUR_MS
        sel = np.nonzero((a <= th) & (a > th - 2.0))[0]
        if len(sel):
            for i in rng.choice(sel, size=min(36, len(sel)), replace=False):
                emit(t_land, px[i] + rng.normal(0, 8), pz[i] + rng.normal(0, 8), None, "L9", "LANDSAT", "H" if rng.random() < 0.7 else "M", 30.0)
    # GOES-18 every 10 min, 2 km cells (already "thinned": <= 1 per 10 min per cell)
    t = (start_ms // (10 * 60000) + 1) * 10 * 60000
    while t <= end_ms:
        res = cells(t, 2000.0, 1.2, 4.0)
        if res is not None:
            frac, xs, zs = res
            for f, x, z in zip(frac, xs, zs):
                if f < 0.01 or rng.random() > min(0.75, 0.15 + 10 * f):
                    continue
                emit(t, x + rng.normal(0, 300), z + rng.normal(0, 300), 12.0 + 3800.0 * f * rng.lognormal(0, 0.35), "G18", "GOES", f"{min(100.0, 30.0 + 600.0 * f):.1f}", 2000.0)
        t += 10 * 60000
    out.sort(key=lambda r: (r["t_ms"], r["instrument"]))
    return out


def mask_rings(mask: np.ndarray, fire: Grid, max_vertices: int = 1500) -> list[list[list[float]]]:
    padded = np.pad(mask.astype(np.float32), 1)
    contours = measure.find_contours(padded, 0.5)
    rings = []
    for cnt in contours:
        if len(cnt) < 8:
            continue
        r = cnt[:, 0] - 1.0
        c = cnt[:, 1] - 1.0
        xs = (c + 0.5) * fire.res_m - fire.extent_m / 2
        zs = (r + 0.5) * fire.res_m - fire.extent_m / 2
        rings.append(np.c_[xs, zs])
    tol = fire.res_m * 0.4
    while True:
        simp = []
        for ring in rings:
            ls = LineString(ring).simplify(tol, preserve_topology=False)
            coords = np.asarray(ls.coords)
            if len(coords) >= 4:
                if not np.allclose(coords[0], coords[-1]):
                    coords = np.vstack([coords, coords[:1]])
                simp.append(coords)
        if sum(len(s) for s in simp) <= max_vertices:
            break
        tol *= 1.5
    return [[[round(float(x), 1), round(float(z), 1)] for x, z in s] for s in simp]


def make_perimeters(sc: Scenario, fire: Grid, arrival_h: np.ndarray, origin: int, end_ms: int, last_growth_ms: int) -> list[dict]:
    out = []
    t = sc.started_ms + 8 * HOUR_MS
    # align to 08:00 / 20:00 local
    hl = float(local_hour(np.array([t]))[0])
    t += int(((8.0 - hl) % 12.0) * HOUR_MS)
    t = t // 60000 * 60000
    times = []
    while t <= end_ms:
        times.append(t)
        t += 12 * HOUR_MS
    if sc.mode == "historical" and (not times or times[-1] < last_growth_ms):
        times.append(min(end_ms, last_growth_ms + 6 * HOUR_MS))
    prev_acres = 0.0
    for i, t in enumerate(times):
        th = (t - origin) / HOUR_MS
        mask = arrival_h <= th
        acres = float(mask.sum()) * fire.res_m**2 / ACRE
        if acres < 5 or acres < prev_acres * 0.999 and i > 0:
            continue
        prev_acres = acres
        final = sc.mode == "historical" and i == len(times) - 1
        out.append({"t_ms": int(t), "acres": round(acres, 1), "source": "NIFC WFIGS " + ("final" if final else "daily") + " perimeter (fixture)", "rings": mask_rings(mask, fire)})
    return out


def ros_series(arrival_h: np.ndarray, res: float, hours: np.ndarray) -> np.ndarray:
    """90th percentile of 1/|grad T| (m/h -> chains/h) over pixels that burned in (t-1, t]."""
    a = np.where(arrival_h < NEVER, arrival_h, np.nan).astype(np.float64)
    gy, gx = np.gradient(a, res)
    g = np.hypot(gx, gy)
    speed = np.where(g > 1e-6, 1.0 / g, np.nan)
    speed = np.minimum(speed, 400 * CHAIN)
    flat_a, flat_s = a.ravel(), speed.ravel()
    order = np.argsort(np.nan_to_num(flat_a, nan=np.inf))
    sa, ss = flat_a[order], flat_s[order]
    out = np.zeros(len(hours))
    lo = np.searchsorted(sa, hours - 1.0, side="right")
    hi = np.searchsorted(sa, hours, side="right")
    for i, (l, h) in enumerate(zip(lo, hi)):
        if h > l:
            v = ss[l:h]
            v = v[np.isfinite(v)]
            if len(v):
                out[i] = np.percentile(v, 90) / CHAIN
    return out


def make_timeseries(fire: Grid, arrival_h: np.ndarray, origin: int, start_ms: int, now_ms_: int, detections: list[dict]) -> dict:
    t_ms = np.arange(start_ms, floor_hour_ms(now_ms_) + 1, HOUR_MS, dtype=np.int64)
    hours = (t_ms - origin) / HOUR_MS
    burned = np.sort(arrival_h[arrival_h < NEVER].ravel())
    area = np.searchsorted(burned, hours, side="right") * fire.res_m**2 / ACRE
    growth = np.diff(area, prepend=0.0)
    ros = ros_series(arrival_h, fire.res_m, hours)
    det_t = np.array([d["t_ms"] for d in detections], dtype=np.int64)
    det_n = np.searchsorted(np.sort(det_t), t_ms, side="right") - np.searchsorted(np.sort(det_t), t_ms - HOUR_MS, side="right")
    goes = [(d["t_ms"], d["frp"] or 0.0) for d in detections if d["instrument"] == "GOES"]
    frp = np.zeros(len(t_ms))
    if goes:
        gt = np.array([g[0] for g in goes], dtype=np.int64)
        gf = np.array([g[1] for g in goes])
        for i, t in enumerate(t_ms):
            sel = (gt > t - HOUR_MS) & (gt <= t)
            frp[i] = gf[sel].sum() / 6.0         # 6 scans per hour; scans without detections count as 0
    return {
        "step_h": 1,
        "t_ms": [int(v) for v in t_ms],
        "area_acres": [round(float(v), 2) for v in area],
        "growth_acres_per_h": [round(float(v), 2) for v in growth],
        "ros_ch_per_h": [round(float(v), 2) for v in ros],
        "detections_per_h": [int(v) for v in det_n],
        "frp_mw_per_h": [round(float(v), 2) for v in frp],
    }


# =================================================================================================================
# Weather
# =================================================================================================================
def emc_pct(temp_c: np.ndarray, rh: np.ndarray) -> np.ndarray:
    t = temp_c * 9 / 5 + 32
    h = rh
    return np.where(h < 10, 0.03229 + 0.281073 * h - 0.000578 * h * t,
                    np.where(h < 50, 2.22749 + 0.160107 * h - 0.01478 * t, 21.0606 + 0.005565 * h * h - 0.00035 * h * t - 0.483199 * h))


def ffwi(temp_c: np.ndarray, rh: np.ndarray, wind_ms: np.ndarray) -> np.ndarray:
    m = np.clip(emc_pct(temp_c, rh), 0, 30) / 30.0
    eta = 1 - 2 * m + 1.5 * m**2 - 0.5 * m**3
    u = wind_ms * 2.236936
    return eta * np.sqrt(1 + u * u) / 0.3002


def lagged(x: np.ndarray, tau_h: float, init: float) -> np.ndarray:
    out = np.empty_like(x)
    a = 1 - math.exp(-1.0 / tau_h)
    v = init
    for i, xi in enumerate(x):
        v = v + a * (xi - v)
        out[i] = v
    return out


def wind_dir_series(sc: Scenario, t_h: np.ndarray, hl: np.ndarray, noise: np.ndarray, events: list[WindEvent]) -> np.ndarray:
    night = 1.0 - diurnal(hl, 15.0)
    ev = np.clip(event_sum(t_h, events, "spread_amp"), 0, 1)
    return (sc.wind_from - 48.0 * night * (1 - ev) + 9.0 * noise + 8.0 * ev) % 360.0


def make_weather(sc: Scenario, render: Grid, terr: Terrain, origin: int, obs_end_ms: int, rng: np.random.Generator) -> tuple[dict, dict]:
    w0 = origin - 72 * HOUR_MS
    w1 = floor_hour_ms(obs_end_ms) + 96 * HOUR_MS
    t_ms = np.arange(w0, w1 + 1, HOUR_MS, dtype=np.int64)
    n = len(t_ms)
    t_h = (t_ms - sc.started_ms) / HOUR_MS
    hl = local_hour(t_ms)
    events = sc.events + sc.forecast_events
    g = np.zeros(n)
    peak_extra = np.zeros(n)
    for ev in events:
        ge = np.exp(-(((t_h - ev.t_h) / ev.width_h) ** 2))
        g = np.maximum(g, ge * min(1.0, ev.spread_amp))
        peak_extra = np.maximum(peak_extra, ge * ev.wind_peak_ms)
    slow = np.convolve(rng.normal(0, 1, n + 48), np.ones(24) / 24, mode="same")[24:24 + n] * 3.0
    temp = sc.t_mean + sc.t_amp * np.cos(2 * np.pi * (hl - 15.0) / 24.0) + 3.0 * g + 0.8 * slow
    rh = np.clip(sc.rh_mean - sc.rh_amp * np.cos(2 * np.pi * (hl - 15.0) / 24.0) - 10.0 * g - 2.0 * slow + rng.normal(0, 1.2, n), 4.0, 98.0)
    gamma = np.log(rh / 100.0) + 17.625 * temp / (243.04 + temp)
    dew = 243.04 * gamma / (17.625 - gamma)
    base = 1.8 + 4.2 * diurnal(hl, 16.0) + np.abs(rng.normal(0, 0.5, n))
    speed = np.where(peak_extra > base, peak_extra * (0.97 + 0.03 * rng.random(n)), base)
    noise = np.convolve(rng.normal(0, 1, n + 12), np.ones(6) / 6, mode="same")[6:6 + n] * 2.0
    wdir = wind_dir_series(sc, t_h, hl, noise, events)
    gust = speed * (1.32 + 0.08 * rng.random(n)) + 1.2
    emc = emc_pct(temp, rh)
    fm1 = 1.03 * emc
    fm10 = lagged(emc, 10.0, float(emc[:72].mean()))
    fm100 = lagged(emc, 100.0, float(emc[:72].mean()) + 2.0)
    fwi = ffwi(temp, rh, speed)
    mph = speed * 2.236936
    ros_pot = (6.0 + 1.9 * mph**1.45) * np.clip(1.45 - fm1 / 9.0, 0.15, 1.4)
    flame_ft = 1.9 * ros_pot**0.5
    # 4 x 4 grid: terrain-modulated speed and direction offsets per cell
    xs, zs = weather_axes(render)
    cell_elev = np.zeros((4, 4))
    for j in range(4):
        for i in range(4):
            r, c = render.local_to_rowcol(xs[i], zs[j])
            cell_elev[j, i] = terr.dem[int(r), int(c)]
    s_fac = 1.0 + 0.16 * (cell_elev - cell_elev.mean()) / (cell_elev.std() + 1e-9)
    d_off = rng.normal(0, 9.0, (4, 4))
    sp = speed[:, None, None] * s_fac[None]
    dr = np.radians(wdir[:, None, None] + d_off[None])
    u = -sp * np.sin(dr)
    v = -sp * np.cos(dr)
    forecast_from = None if sc.mode == "historical" else int(floor_hour_ms(obs_end_ms) + HOUR_MS)
    weather = {
        "source": "fixture:synthetic (shaped like open-meteo:" + ("historical-forecast:gfs_hrrr)" if sc.mode == "historical" else "gfs_hrrr+gfs_seamless)"),
        "t_ms": [int(v_) for v_ in t_ms],
        "at_fire": {
            "temp_c": np.round(temp, 2).tolist(), "rh_pct": np.round(rh, 1).tolist(), "dewpoint_c": np.round(dew, 2).tolist(),
            "wind_speed_ms": np.round(speed, 2).tolist(), "wind_dir_deg": np.round(wdir, 1).tolist(),
            "wind_gust_ms": np.round(gust, 2).tolist(), "precip_mm": [0.0] * n,
            "fm1_pct": np.round(fm1, 2).tolist(), "fm10_pct": np.round(fm10, 2).tolist(), "fm100_pct": np.round(fm100, 2).tolist(),
            "ffwi": np.round(fwi, 1).tolist(),
            "flame_length_ft": np.round(flame_ft, 1).tolist(), "ros_ch_per_h_potential": np.round(ros_pot, 1).tolist(),
        },
        "grid": {"nx": 4, "ny": 4, "x": [float(x) for x in xs], "z": [float(z) for z in zs],
                 "u_ms": np.round(u, 2).ravel().tolist(), "v_ms": np.round(v, 2).ravel().tolist()},
        "forecast_from_ms": forecast_from,
    }
    aux = {"t_ms": t_ms, "speed": speed, "gust": gust, "dir": wdir}
    return weather, aux


# =================================================================================================================
# Events
# =================================================================================================================
def cardinal(deg: float) -> str:
    names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    return names[int((deg % 360) / 22.5 + 0.5) % 16]


def la_label(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=LA).strftime("%b %d, %H:%M")


def make_events(sc: Scenario, fire: Grid, fu: Fuels, truth: TruthFire, arrival_h: np.ndarray, origin: int, ts: dict,
                weather_aux: dict, obs_end_ms: int, contained_ms: int | None) -> list[dict]:
    ev: list[dict] = []
    X, Z = fire.cell_centers_local()

    def centroid(sel: np.ndarray) -> tuple[float, float]:
        return float(X[sel].mean()), float(Z[sel].mean())

    ix, iz = fire.pixel_center_local(*truth.ign_rc)
    ev.append({"type": "ignition", "t_ms": sc.started_ms, "title": "Ignition (est.)",
               "detail": f"Reported by {sc.issuer}; fixture ignition at {la_label(sc.started_ms)} {sc.tz_abbr}.", "x": round(ix, 1), "z": round(iz, 1),
               "confidence": "estimated", "source": f"{sc.issuer} (fixture)"})
    growth = np.array(ts["growth_acres_per_h"])
    t_arr = np.array(ts["t_ms"])
    pos = growth[growth > 0]
    if len(pos):
        thr = max(250.0, 3.0 * float(np.median(pos)))
        picked: list[int] = []
        for i in np.argsort(-growth):
            if growth[i] < thr or len(picked) >= 3:
                break
            if all(abs(int(t_arr[i]) - int(t_arr[j])) >= 12 * HOUR_MS for j in picked):
                picked.append(int(i))
        for i in picked:
            th = (t_arr[i] - origin) / HOUR_MS
            sel = (arrival_h > th - 1) & (arrival_h <= th)
            cx, cz = centroid(sel)
            ev.append({"type": "rapid_growth", "t_ms": int(t_arr[i]) - HOUR_MS // 2, "title": "Rapid growth",
                       "detail": f"+{growth[i]:,.0f} ac/h; front ROS {ts['ros_ch_per_h'][i]:.0f} ch/h", "x": round(cx, 1), "z": round(cz, 1),
                       "confidence": "observed", "source": "Observed arrival (fixture)"})
    spot_t = int(ms_of(origin, float(arrival_h[truth.spot_rc])))
    if spot_t <= obs_end_ms:
        ev.append({"type": "spot_fire", "t_ms": spot_t, "title": "Spot fire (prob.)",
                   "detail": "New detection ~0.7 km ahead of the front, across the creek.", "x": round(truth.spot_xz[0], 1),
                   "z": round(truth.spot_xz[1], 1), "confidence": "probable", "source": "FIRMS VIIRS (fixture)"})
    ridge = (fu.tpi > 40) & (arrival_h < NEVER)
    if ridge.any():
        burned_t = arrival_h[ridge]
        lo, hi = np.percentile(burned_t, [20, 80])
        cand = ridge & (arrival_h >= lo) & (arrival_h <= hi)
        if cand.any():
            r, c = np.unravel_index(np.argmax(np.where(cand, fu.tpi, -1e9)), fu.tpi.shape)
            x, z = fire.pixel_center_local(r, c)
            ev.append({"type": "ridge_crossing", "t_ms": int(ms_of(origin, float(arrival_h[r, c]))), "title": "Ridge crossing",
                       "detail": f"Front crossed a ridge at {fu.elev[r, c]:,.0f} m (TPI +{fu.tpi[r, c]:.0f} m).", "x": round(x, 1), "z": round(z, 1),
                       "confidence": "estimated", "source": "Terrain + observed arrival (fixture)"})
    wt = weather_aux["t_ms"]
    grow_sel = np.isin(wt, t_arr[growth > 1.0])
    if grow_sel.any():
        i = int(np.argmax(np.where(grow_sel, weather_aux["gust"], -1)))
        th = (int(wt[i]) - origin) / HOUR_MS
        sel = (arrival_h > th - 3) & (arrival_h <= th)
        cx, cz = centroid(sel) if sel.any() else (ix, iz)
        ev.append({"type": "peak_wind", "t_ms": int(wt[i]), "title": "Peak wind",
                   "detail": f"Gust {weather_aux['gust'][i]:.1f} m/s ({weather_aux['gust'][i] * 2.236936:.0f} mph) from {cardinal(weather_aux['dir'][i])}.",
                   "x": round(cx, 1), "z": round(cz, 1), "confidence": "observed", "source": "Open-Meteo HRRR (fixture)"})
    if contained_ms is not None:
        ev.append({"type": "containment", "t_ms": contained_ms, "title": "Containment",
                   "detail": "100% contained (WFIGS ContainmentDateTime).", "confidence": "observed", "source": "WFIGS (fixture)"})
    ev = [e for e in ev if e["t_ms"] <= obs_end_ms]
    ev.sort(key=lambda e: e["t_ms"])
    for i, e in enumerate(ev):
        e["id"] = f"ev-{i + 1:02d}"
    return [{k: e[k] for k in ("id", "type", "t_ms", "title", "detail", "x", "z", "confidence", "source") if k in e} for e in ev]


# =================================================================================================================
# Forecast (synthetic ensemble)
# =================================================================================================================
def make_forecast(sc: Scenario, fire: Grid, fu: Fuels, graph: SpreadGraph, truth: TruthFire, observed_h: np.ndarray, origin: int,
                  start_ms: int, horizon_h: int, ensemble: str, members: int, weather_aux: dict, rng: np.random.Generator,
                  data_end_ms: int | None) -> tuple[dict, dict[str, np.ndarray]]:
    t0 = time.time()
    m = fire.width
    start_h = (start_ms - origin) / HOUR_MS
    start_ign = (start_ms - sc.started_ms) / HOUR_MS
    burned0 = observed_h <= start_h
    sources = np.flatnonzero(burned0)
    if len(sources) == 0:
        sources = np.array([truth.ign_rc[0] * m + truth.ign_rc[1]])
        burned0 = np.zeros_like(burned0)
        burned0.flat[sources] = True
    events = [e for e in sc.events + sc.forecast_events if e.t_h > start_ign - 12]
    t_grid = np.arange(0.0, horizon_h + 1e-9, 1.0 / 12.0)
    arrivals = np.empty((members, m, m), np.float32)
    flames = np.zeros((members, m, m), np.float32)
    wind_t = weather_aux["t_ms"]
    wind_mph = np.interp(start_ms + t_grid * HOUR_MS, wind_t, weather_aux["speed"]) * 2.236936
    flame_noise = np.exp(0.25 * value_fbm(rng, (m, m), 40, 2))
    for k in range(members):
        if k == 0:
            kf, dd, amp, shift = 1.0, 0.0, 1.0, 0.0
        else:
            kf = float(rng.lognormal(0.0, 0.22))
            dd = float(rng.normal(0.0, 12.0))
            amp = float(rng.uniform(0.6, 1.4))
            shift = float(rng.normal(0.0, 2.5))
        evs = [WindEvent(e.t_h - start_ign + shift, e.spread_amp * amp, e.width_h, e.wind_peak_ms) for e in events]
        s = spread_rate_profile(sc, t_grid + start_ign, [], None) * (1.0 + event_sum(t_grid, evs))
        S = cumulative(t_grid, s)
        tau = graph.solve(sources, sc.wind_from + dd) / (truth.k * kf)
        reach = tau <= S[-1]
        th = np.interp(np.where(reach, tau, 0.0), S, t_grid)
        arr = np.where(reach & (fu.cls != WAT), start_h + th, NEVER).astype(np.float32)
        arr[burned0] = observed_h[burned0]
        arrivals[k] = arr
        fl = CLASS_FLAME_M[fu.cls] * (0.55 + 0.035 * np.interp(np.clip(th, 0, horizon_h), t_grid, wind_mph)) * flame_noise * (1 + 0.6 * np.clip(fu.slope, 0, 1))
        fl = np.where(fu.cc > 40, fl * 1.8, fl)
        flames[k] = np.where(reach & ~burned0, fl, 0.0)
    srt = np.sort(arrivals, axis=0)

    def q(p: float) -> np.ndarray:
        return srt[int(math.ceil(p / 100.0 * members)) - 1]

    p10, p50, p90 = q(10), q(50), q(90)
    end_h = start_h + horizon_h
    prob = (arrivals <= end_h).mean(axis=0).astype(np.float32)
    fl_masked = np.where(flames > 0, flames, np.nan)
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        fl50 = np.nan_to_num(np.nanmedian(fl_masked, axis=0), nan=0.0).astype(np.float32)
    hours = np.arange(0, horizon_h + 1)
    t_series = [int(start_ms + h * HOUR_MS) for h in hours]
    res2 = fire.res_m**2 / ACRE
    areas = np.stack([[np.count_nonzero(arrivals[k] <= start_h + h) * res2 for h in hours] for k in range(members)])
    ros = np.stack([ros_series(arrivals[k], fire.res_m, start_h + hours) for k in range(min(members, 15))])
    a10, a50, a90 = np.percentile(areas, [10, 50, 90], axis=0)
    fx = {
        "run_id": "fx-001", "incident_id": sc.id, "status": "ready", "issued_ms": 0, "start_ms": int(start_ms), "horizon_h": int(horizon_h),
        "time_origin_ms": int(origin),
        "model": {"engine": "pyretechnics", "version": PYRETECHNICS_VERSION, "surface_lw_ratio_model": "behave", "crown": True,
                  "spotting": False, "spread_adjustment": 1.0, "grid_res_m": fire.res_m},
        "weather": {"source": "fixture:synthetic-" + ensemble, "ensemble": ensemble, "members": members},
        "layers": {},
        "series": {"t_ms": t_series, "area_acres_p10": np.round(a10, 1).tolist(), "area_acres_p50": np.round(a50, 1).tolist(),
                   "area_acres_p90": np.round(a90, 1).tolist(), "ros_ch_per_h_p50": np.round(np.median(ros, axis=0), 1).tolist()},
        "runtime_s": 0.0,
        "warnings": ["Synthetic fixture forecast: generated by scripts/make_fixture.py, not by pyretechnics."],
    }
    if data_end_ms is not None:
        skill = []
        for lead in (12, 24, 48, 72):
            t = start_ms + lead * HOUR_MS
            if lead > horizon_h or t > data_end_ms:
                continue
            th = start_h + lead
            obs = observed_h <= th
            fc = p50 <= th
            denom = obs.sum() + fc.sum()
            sor = 1.0 if denom == 0 else 2.0 * np.count_nonzero(obs & fc) / denom
            skill.append({"lead_h": lead, "sorensen": round(float(sor), 4), "observed_acres": round(float(obs.sum() * res2), 1),
                          "forecast_acres_p50": round(float(fc.sum() * res2), 1)})
        fx["skill"] = skill
    fx["runtime_s"] = round(time.time() - t0, 2)
    return fx, {"arrival_p10": p10, "arrival_p50": p50, "arrival_p90": p90, "burn_probability": prob, "flame_length_p50": fl50}


# =================================================================================================================
# Imagery, water, trees
# =================================================================================================================
PALETTE = {  # class: (base = gaps between plants, clump = plant crowns, clump density) in sRGB 0..1
    SH5: ((0.52, 0.48, 0.38), (0.22, 0.25, 0.16), 0.58),
    SH7: ((0.47, 0.44, 0.35), (0.18, 0.21, 0.14), 0.74),
    GS2: ((0.64, 0.58, 0.44), (0.27, 0.30, 0.19), 0.30),
    GR2: ((0.74, 0.66, 0.49), (0.58, 0.51, 0.37), 0.30),
    TU5: ((0.36, 0.36, 0.27), (0.12, 0.16, 0.11), 0.66),
    TL8: ((0.41, 0.38, 0.30), (0.10, 0.14, 0.10), 0.72),
    RIP: ((0.45, 0.45, 0.33), (0.14, 0.21, 0.12), 0.62),
    BAR: ((0.64, 0.62, 0.57), (0.47, 0.45, 0.41), 0.30),
    URB: ((0.56, 0.54, 0.50), (0.22, 0.27, 0.17), 0.22),
    WAT: ((0.60, 0.57, 0.50), (0.45, 0.43, 0.38), 0.25),     # wash floor around the channel
}


def river_half_width(wn: np.ndarray) -> np.ndarray:
    """Wetted half-width (m) of the fixture river along its course (wider downstream)."""
    return 13.0 + 10.0 * wn


def make_naip(render: Grid, terr: Terrain, fu: Fuels, svf: np.ndarray, rng: np.random.Generator, size: int = 2048) -> bytes:
    """A NAIP-like summer aerial photo (sRGB JPEG) from terrain, fuels and canopy."""
    S = size
    res = render.extent_m / S

    def up(a: np.ndarray, order: int = 1) -> np.ndarray:
        return ndimage.zoom(a.astype(np.float32), S / a.shape[0], order=order, grid_mode=True, mode="nearest")[:S, :S]

    elev = up(terr.dem, 1)
    gy, gx = np.gradient(elev, res)
    nrm = np.sqrt(gx * gx + gy * gy + 1.0)
    sun_az, sun_alt = math.radians(140.0), math.radians(52.0)
    se, sn, su = math.sin(sun_az) * math.cos(sun_alt), math.cos(sun_az) * math.cos(sun_alt), math.sin(sun_alt)
    shade = (-gx * se + gy * sn + su) / nrm
    slope2 = np.sqrt(gx * gx + gy * gy)
    svf2 = up(svf, 1)
    river_d = up(terr.river_d, 1)
    wn2 = up(terr.river_wn, 1)
    cc2 = np.clip(up(fu.cc.astype(np.float32), 1) / 100.0, 0, 1)
    # organic class boundaries: blurred one-hot + noise, argmax
    best = np.full((S, S), -1e9, np.float32)
    cls = np.zeros((S, S), np.uint8)
    edge_noise = value_fbm(rng, (S, S), S / 10.0, 3, 0.6)
    for c in range(10):
        sel = fu.cls == c
        if not sel.any():
            continue
        f = ndimage.gaussian_filter(up(sel.astype(np.float32), 1), 1.8)
        f += 0.20 * edge_noise * (0.6 + 0.4 * math.sin(c * 1.7))
        better = f > best
        best[better] = f[better]
        cls[better] = c
    base = np.array([PALETTE[c][0] for c in range(10)], np.float32)
    clump = np.array([PALETTE[c][1] for c in range(10)], np.float32)
    dens = np.array([PALETTE[c][2] for c in range(10)], np.float32)[cls]
    canopy_cls = np.isin(cls, (TU5, TL8, RIP, URB))
    dens = np.where(canopy_cls, np.clip(0.12 + 0.85 * cc2, 0, 0.92), np.maximum(dens, 0.85 * cc2))
    # multi-scale clumps (shrub patches, tree groups) + fine crowns
    blobs = 0.62 * value_fbm(rng, (S, S), S / 5.0, 2, 0.5) + 0.38 * value_fbm(rng, (S, S), S / 16.0, 2, 0.5)
    blobs /= blobs.std() + 1e-9
    crowns = value_fbm(rng, (S, S), S / 2.4, 1)
    field = np.where(canopy_cls, 0.55 * blobs + 0.65 * crowns, 0.85 * blobs + 0.3 * crowns)
    field /= field.std() + 1e-9
    thr = special.ndtri(np.clip(1.0 - dens, 1e-4, 1 - 1e-4))
    clm = smoothstep(-0.18, 0.18, field - thr).astype(np.float32)
    img = base[cls] * (1 - clm[..., None]) + clump[cls] * clm[..., None]
    # crown shadows cast to the north-west (sun in the south-east)
    shadow = np.clip(np.roll(clm, (-1, -1), axis=(0, 1)) + 0.6 * np.roll(clm, (-2, -2), axis=(0, 1)) - clm, 0, 1)
    img *= (1 - 0.32 * shadow)[..., None]
    var = 1.0 + 0.09 * value_fbm(rng, (S, S), 40, 3) + 0.05 * value_fbm(rng, (S, S), 260, 2)
    hue = 0.04 * value_fbm(rng, (S, S), 28, 2)
    img *= var[..., None]
    img[..., 0] *= 1 + hue
    img[..., 2] *= 1 - 0.8 * hue
    # rock on steep slopes, with fractures
    rocky = smoothstep(0.75, 1.25, slope2) * (0.5 + 0.5 * smoothstep(-0.6, 0.9, value_fbm(rng, (S, S), 110, 2)))
    rock = (rocky * ~np.isin(cls, (WAT, URB))).astype(np.float32)
    frac = 1.0 - 0.25 * smoothstep(0.55, 0.95, np.abs(value_fbm(rng, (S, S), 180, 2)))
    rock_col = np.array([0.63, 0.61, 0.56], np.float32) * ((1 + 0.12 * value_fbm(rng, (S, S), 300, 2)) * frac)[..., None]
    img = img * (1 - rock[..., None]) + rock_col * rock[..., None]
    # river: braided gravel wash, sand bars, a thin wetted channel
    n_w = value_fbm(rng, (S, S), 90, 2)
    hw = river_half_width(wn2) * (1 + 0.22 * n_w)
    wash_w = hw * 2.1 + 28.0 + 30.0 * value_fbm(rng, (S, S), 260, 2)
    wash = smoothstep(wash_w, wash_w - 26.0, river_d).astype(np.float32)
    braid = 0.5 + 0.5 * smoothstep(-0.4, 0.6, value_fbm(rng, (S, S), 420, 2))
    bars = (smoothstep(0.7, 1.3, value_fbm(rng, (S, S), 360, 2)) * (river_d > hw + 8.0)).astype(np.float32)
    sand = np.array([0.71, 0.66, 0.56], np.float32) * (0.86 + 0.16 * braid)[..., None]
    k_w = (0.85 * wash * (1.0 - 0.8 * bars))[..., None]
    img = img * (1 - k_w) + sand * k_w
    wet = smoothstep(hw + 4.0, hw - 4.0, river_d).astype(np.float32)
    depth = np.clip(1.0 - river_d / np.maximum(hw, 1.0), 0, 1)
    wcol = np.array([0.30, 0.34, 0.30], np.float32) * (1 - depth[..., None]) + np.array([0.11, 0.16, 0.17], np.float32) * depth[..., None]
    img = img * (1 - wet[..., None]) + wcol * wet[..., None]
    # town: street grid, roofs, yards with street trees
    urb = (cls == URB).astype(np.float32)
    if urb.any():
        jj, ii = np.meshgrid(np.arange(S), np.arange(S))
        block = max(14, int(round(125.0 / res)))
        street = ((ii % block) < 2) | ((jj % block) < 2)
        lot = max(4, int(round(31.0 / res)))
        lot_id = (ii // lot) * 100003 + (jj // lot)
        lot_rand = (np.sin(lot_id * 12.9898) * 43758.5453) % 1.0
        roof_cols = np.array([[0.69, 0.46, 0.36], [0.78, 0.77, 0.73], [0.46, 0.45, 0.43], [0.60, 0.56, 0.50], [0.36, 0.38, 0.40]], np.float32)
        roof = roof_cols[(lot_rand * 5).astype(int) % 5]
        li, lj = ii % lot, jj % lot
        inner = (li > 0) & (lj > 0) & (li < lot - 1) & (lj < lot - 2) & (lot_rand > 0.12)
        town = np.where(inner[..., None], roof, img)
        town = np.where(street[..., None], np.array([0.38, 0.38, 0.37], np.float32), town)
        trees = (crowns > 1.0) & ~inner
        town = np.where(trees[..., None], np.array([0.17, 0.22, 0.14], np.float32), town)
        img = img * (1 - urb[..., None]) + town * urb[..., None]
    light = 0.40 + 0.78 * np.clip(shade, 0, 1)
    img *= (light * (0.72 + 0.28 * svf2))[..., None]
    img = img * 0.94 + np.array([0.020, 0.024, 0.032], np.float32)
    img += rng.normal(0, 0.008, (S, S, 1)).astype(np.float32) + rng.normal(0, 0.003, (S, S, 3)).astype(np.float32)
    img = np.clip(img, 0, 1)
    img = img + 0.12 * (img - 0.45) * (1 - np.abs(img - 0.45) * 2)     # gentle S-curve
    out = (np.clip(img, 0, 1) ** (1 / 1.04) * 255 + 0.5).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out, "RGB").save(buf, "JPEG", quality=88, optimize=True, progressive=True)
    return buf.getvalue()


def make_water(render: Grid, terr: Terrain, fu: Fuels) -> np.ndarray:
    hw = river_half_width(terr.river_wn)
    fine = np.clip((hw + 5.0 - terr.river_d) / 10.0, 0, 1)
    w98 = (fu.fuel == 98).astype(np.float32)
    up98 = resize(w98, (render.height, render.width), order=0, anti_aliasing=False)
    up98 = ndimage.gaussian_filter(up98, 2.0) * 0.5
    return (np.maximum(fine, up98) * 255 + 0.5).astype(np.uint8)


def make_trees(fire: Grid, render: Grid, terr: Terrain, fu: Fuels, rng: np.random.Generator, target: int = 60000) -> np.ndarray:
    ccf = fu.cc.astype(np.float64) / 100.0
    shrub_cover = np.select([fu.cls == SH7, fu.cls == SH5, fu.cls == GS2], [0.8, 0.6, 0.3], 0.0)
    fuel = fu.fuel.astype(int)
    shrub_lambda = shrub_cover * (ccf == 0) * 0.30
    n_shrub_exp = shrub_lambda.sum()
    k = max(0.1, (target - n_shrub_exp) / max(ccf.sum(), 1e-9))
    lam = ccf * k
    n_tree = rng.poisson(lam)
    n_sh = rng.poisson(shrub_lambda)
    rr, cc = np.nonzero(n_tree)
    tr, tc = np.repeat(rr, n_tree[rr, cc]), np.repeat(cc, n_tree[rr, cc])
    code = fuel[tr, tc]
    conifer = ((code >= 161) & (code <= 165)) | ((code >= 181) & (code <= 189))
    t_kind = np.where(conifer, 0, np.where(fu.ch[tr, tc] >= 5, 1, 2))
    t_h = np.maximum(fu.ch[tr, tc] * rng.uniform(0.7, 1.1, len(tr)), 3.0)
    rr, cc = np.nonzero(n_sh)
    sr, scol = np.repeat(rr, n_sh[rr, cc]), np.repeat(cc, n_sh[rr, cc])
    rows_a = np.concatenate([tr, sr]).astype(np.float64)
    cols_a = np.concatenate([tc, scol]).astype(np.float64)
    kind = np.concatenate([t_kind, np.full(len(sr), 2)]).astype(np.float32)
    h = np.concatenate([t_h, rng.uniform(1.2, 3.2, len(sr))]).astype(np.float32)
    jr = rng.random(len(rows_a))
    jc = rng.random(len(rows_a))
    x = (cols_a + jc) * fire.res_m - fire.extent_m / 2
    z = (rows_a + jr) * fire.res_m - fire.extent_m / 2
    rr_c, cc_c = render.local_to_rowcol(x, z)
    y = ndimage.map_coordinates(terr.dem, [rr_c - 0.5, cc_c - 0.5], order=1, mode="nearest")
    crown = np.clip(0.28 * h, 1.5, 9.0)
    return np.c_[x, y, z, h, crown, kind].astype(np.float32)


# =================================================================================================================
# Bundle assembly
# =================================================================================================================
def build_fixture(sc: Scenario, data_dir: Path, members: int, quicklook: Path | None) -> dict:
    t_start = time.time()
    _use_zone(sc.tz)
    rng = np.random.default_rng(sc.seed)
    built = now_ms()
    epsg = utm_epsg_for(sc.center_lon)
    ce, cn = transformer(4326, epsg).transform(sc.center_lon, sc.center_lat)
    render = Grid(epsg, float(round(ce)), float(round(cn)), sc.extent_m, config.RENDER_SIZE, config.RENDER_SIZE)
    fire = render.with_size(fire_grid_size(sc.extent_m), fire_grid_size(sc.extent_m))
    origin = time_origin_for(sc.started_ms)
    print(f"[{sc.id}] grid EPSG:{epsg} extent {sc.extent_m:.0f} m, fire {fire.width}² @ {fire.res_m:.2f} m", flush=True)

    terr = make_terrain(sc, render)
    svf = sky_view_factor(terr.dem, render.res_m)
    fu = make_fuels(sc, fire, terr, rng)
    graph = SpreadGraph(fu, fire.res_m, rng)
    truth = simulate_truth(sc, fire, fu, graph, terr)
    full_arrival = truth.arrival_h
    if sc.mode == "live":
        assert sc.now_ms is not None
        cut_h = (sc.now_ms - origin) / HOUR_MS
        observed = np.where(full_arrival <= cut_h, full_arrival, NEVER).astype(np.float32)
        obs_cut_ms = sc.now_ms
    else:
        observed = full_arrival
        burned_t = np.sort(full_arrival[full_arrival < NEVER])
        t99 = float(burned_t[int(0.99 * (len(burned_t) - 1))])
        obs_cut_ms = int(ms_of(origin, min(t99 + 24.0, 45 * 24.0)))
    last_growth_ms = int(ms_of(origin, float(observed[observed < NEVER].max())))
    detections = make_detections(sc, fire, observed, origin, obs_cut_ms, rng)
    if sc.mode == "live":
        now_ = max(d["t_ms"] for d in detections)          # latest observation
        end_ = now_
        contained_ms = None
        observed = np.where(full_arrival <= (now_ - origin) / HOUR_MS, full_arrival, NEVER).astype(np.float32)
        last_growth_ms = int(ms_of(origin, float(observed[observed < NEVER].max())))
    else:
        now_ = end_ = obs_cut_ms
        contained_ms = int(last_growth_ms + 20 * HOUR_MS)
        contained_ms = min(contained_ms, end_)
    start_ = origin
    perimeters = make_perimeters(sc, fire, observed, origin, end_, last_growth_ms)
    ts = make_timeseries(fire, observed, origin, start_, now_, detections)
    weather, waux = make_weather(sc, render, terr, origin, end_, rng)
    events = make_events(sc, fire, fu, truth, observed, origin, ts, waux, end_, contained_ms)
    final_acres = float((observed < NEVER).sum()) * fire.res_m**2 / ACRE

    # ---------------------------------------------------------------- write bundle into a temp dir, then swap in
    inc = data_dir / "incidents"
    tmp = inc / f".{sc.id}.tmp-{built}"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    bundle.write_layer(tmp, "elevation", terr.dem, "render", "m", "USGS 3DEP-like synthetic DEM (fixture)")
    bundle.write_layer(tmp, "fuel", fu.fuel, "fire", "FBFM40", "LANDFIRE-like FBFM40 fuel model codes (fixture); 0 = nodata", nodata=0)
    bundle.write_layer(tmp, "canopy_cover", fu.cc, "fire", "%", "Canopy cover, percent (fixture)")
    bundle.write_layer(tmp, "canopy_height", fu.ch, "fire", "m", "Canopy height (fixture)")
    if sc.mode == "historical":
        dn = np.where(observed < NEVER, np.clip(0.18 + 0.12 * CLASS_FLAME_M[fu.cls] / 2 + 0.25 * value_fbm(rng, fu.cls.shape, 30, 3), 0.05, 1.1), 0.0)
        dn = dn + rng.normal(0, 0.035, dn.shape)
        dn = np.where(fu.cls == WAT, -9999.0, dn).astype(np.float32)
        bundle.write_layer(tmp, "burn_severity", dn, "fire", "dNBR", "Sentinel-2-like dNBR (fixture)", nodata=-9999.0)
    bundle.write_layer(tmp, "observed_arrival", observed, "fire", "h", "Observed arrival, hours since time_origin_ms; NEVER = 1e6 (fixture)")
    water = make_water(render, terr, fu)
    naip = make_naip(render, terr, fu, svf, rng)
    bundle.write_image_layer(tmp, "naip", naip, 2048, 2048, "NAIP-like aerial photo (procedural fixture)")
    bundle.write_layer(tmp, "sky_view", (np.clip(svf, 0, 1) * 255 + 0.5).astype(np.uint8), "render", "0-255", "Sky-view factor (horizon AO), 255 = open sky")
    bundle.write_layer(tmp, "water", water, "render", "0-255", "Water mask (river + FBFM40 98), soft edges")
    trees = make_trees(fire, render, terr, fu, rng)
    bundle.write_layer(tmp, "trees", trees, "points", "m", "Trees: x, y(ground m), z, height_m, crown_radius_m, kind (0 conifer, 1 broadleaf, 2 shrub)")
    bundle.write_npz(tmp / bundle.STATIC_NPZ, fuel_model=fu.fuel.astype(np.int16), slope=fu.slope, aspect=fu.aspect,
                     canopy_cover=(fu.cc.astype(np.float32) / 100.0), canopy_height=fu.ch, canopy_base_height=fu.cbh,
                     canopy_bulk_density=fu.cbd, elevation=fu.elev, res_m=np.float64(fire.res_m))
    bundle.write_json(tmp / "detections.json", {"detections": detections})
    bundle.write_json(tmp / "perimeters.json", {"perimeters": perimeters})
    bundle.write_json(tmp / "timeseries.json", ts)
    bundle.write_json(tmp / "events.json", {"events": events})
    bundle.write_json(tmp / "weather.json", weather)

    # forecast
    if sc.mode == "historical":
        f_start = floor_hour_ms(sc.started_ms + 24 * HOUR_MS)
        ensemble, data_end = "perturbed", end_
    else:
        f_start, ensemble, data_end = now_, "gfs025", None
    fx, fx_layers = make_forecast(sc, fire, fu, graph, truth, observed, origin, f_start, 72, ensemble, members, waux, rng, data_end)
    fdir = f"forecasts/{fx['run_id']}"
    desc = {
        "arrival_p10": "Arrival time, 10th percentile across members (hours since time_origin_ms; NEVER = 1e6)",
        "arrival_p50": "Arrival time, median across members (hours since time_origin_ms; NEVER = 1e6)",
        "arrival_p90": "Arrival time, 90th percentile across members (hours since time_origin_ms; NEVER = 1e6)",
        "burn_probability": "Fraction of members burned by start + horizon",
        "flame_length_p50": "Median flame length over members that burned the pixel",
    }
    units = {"arrival_p10": "h", "arrival_p50": "h", "arrival_p90": "h", "burn_probability": "fraction", "flame_length_p50": "m"}
    for name, arr in fx_layers.items():
        fx["layers"][name] = bundle.write_layer(tmp, name, arr, "fire", units[name], desc[name], rel_dir=fdir, register=False)
    fx["issued_ms"] = int(built if sc.mode == "historical" else now_ + 4 * 60000)
    validate_strict(ForecastManifest, fx)
    bundle.write_json(tmp / fdir / "forecast.json", fx, indent=True)

    ign_x, ign_z = fire.pixel_center_local(*truth.ign_rc)
    ign_lon, ign_lat = fire.local_to_lonlat(ign_x, ign_z)
    burned = observed < NEVER
    X, Z = fire.cell_centers_local()
    cx, cz = float(X[burned].mean()), float(Z[burned].mean())
    dvec = np.array([cx - ign_x, cz - ign_z])
    dvec /= np.linalg.norm(dvec) + 1e-9
    proj = (X[burned] - ign_x) * dvec[0] + (Z[burned] - ign_z) * dvec[1]
    far = int(np.argmax(proj))
    profile = [[round(ign_x, 1), round(ign_z, 1)], [round(float(X[burned][far]), 1), round(float(Z[burned][far]), 1)]]
    det_24h = sum(1 for d in detections if d["t_ms"] > now_ - DAY_MS and d["instrument"] != "GOES") if sc.mode == "live" else None
    summary = {
        "id": sc.id, "name": sc.name, "mode": sc.mode, "year": datetime.fromtimestamp(sc.started_ms / 1000, tz=timezone.utc).year,
        "calfire_uid": sc.calfire_uid, "started_ms": sc.started_ms, "updated_ms": int(now_ if sc.mode == "live" else contained_ms),
        "contained_ms": contained_ms, "acres": round(final_acres, 1), "percent_contained": sc.percent_contained,
        "is_active": sc.mode == "live", "county": sc.county, "location": sc.location, "admin_unit": sc.admin_unit, "url": None,
        "lat": round(ign_lat, 6), "lon": round(ign_lon, 6), "detections_24h": det_24h, "bundle_status": "ready", "bundle_built_ms": built,
        **sc.summary_extra,
    }
    sources = [
        ("Terrain (synthetic)", "Ridged-fBm DEM with a carved river valley, 1024² render grid"),
        ("Fuels & canopy (synthetic)", f"FBFM40 by elevation/aspect/slope ({sc.fuels_edition}-like), canopy cover/height"),
        ("Imagery (synthetic)", "Procedural NAIP-like aerial photo, 2048 px"),
        ("Fire observations (synthetic)", "VIIRS/MODIS/GOES/Landsat detections and 12-hourly perimeters sampled from a synthetic arrival field"),
        ("Weather (synthetic)", weather["source"]),
    ]

    def finish(mf: dict) -> dict:
        mf.update({
            "schema_version": 1, "id": sc.id, "name": sc.name, "mode": sc.mode, "status": "ready", "summary": summary,
            "time_origin_ms": int(origin), "time_range": {"start_ms": int(start_), "end_ms": int(end_), "now_ms": int(now_)},
            "grid": manifest_grid(render, fire, float(terr.dem.min()), float(terr.dem.max())),
            "ignition": {"x": round(ign_x, 1), "z": round(ign_z, 1), "lat": round(ign_lat, 6), "lon": round(ign_lon, 6), "t_ms": sc.started_ms,
                         "source": f"{sc.issuer} incident point (fixture)"},
            "default_profile_path": profile, "fuels_edition": sc.fuels_edition,
            "data_sources": [{"name": n, "detail": d, "fetched_ms": built} for n, d in sources],
            "stats": {"final_acres_observed": round(final_acres, 1), "detections": len(detections), "perimeters": len(perimeters)},
            "forecasts": [{"run_id": fx["run_id"], "status": "ready", "issued_ms": fx["issued_ms"], "start_ms": fx["start_ms"],
                           "horizon_h": fx["horizon_h"], "ensemble": ensemble, "members": members, "file": f"{fdir}/forecast.json"}],
            "warnings": ["Synthetic fixture bundle generated by scripts/make_fixture.py: not real data."]
            + ([] if sc.mode == "historical" else ["burn_severity unavailable: no post-fire Sentinel-2 scene yet (fixture)."]),
            "built_ms": built,
        })
        order = list(IncidentManifest.model_fields)
        return {k: mf[k] for k in order}

    manifest = bundle.update_manifest(tmp, finish)
    validate_strict(IncidentManifest, manifest)
    for name, model in (("detections.json", DetectionsFile), ("perimeters.json", PerimetersFile), ("timeseries.json", TimeseriesFile),
                        ("events.json", EventsFile), ("weather.json", WeatherFile)):
        validate_strict(model, (tmp / name).read_bytes())
    (tmp / bundle.LOCK_NAME).unlink(missing_ok=True)

    final = inc / sc.id
    old = inc / f".{sc.id}.old-{built}"
    if final.exists():
        final.rename(old)
    tmp.rename(final)
    if old.exists():
        shutil.rmtree(old)

    n_by = {}
    for d in detections:
        n_by[d["instrument"]] = n_by.get(d["instrument"], 0) + 1
    info = {
        "id": sc.id, "acres": round(final_acres), "detections": n_by, "perimeters": len(perimeters), "events": [e["type"] for e in events],
        "trees": int(len(trees)), "hours": len(ts["t_ms"]), "weather_hours": len(weather["t_ms"]),
        "forecast_p50_final_acres": fx["series"]["area_acres_p50"][-1], "skill": fx.get("skill"), "seconds": round(time.time() - t_start, 1),
    }
    print(f"[{sc.id}] {info}", flush=True)
    if quicklook is not None:
        write_quicklooks(quicklook, sc.id, terr, svf, fu, observed, fx_layers, naip)
    return info


def write_quicklooks(out: Path, name: str, terr: Terrain, svf: np.ndarray, fu: Fuels, arrival: np.ndarray, fx: dict[str, np.ndarray], naip: bytes) -> None:
    """Small PNGs for eyeballing (not part of the bundle)."""
    out.mkdir(parents=True, exist_ok=True)

    def hillshade(z: np.ndarray, res: float) -> np.ndarray:
        gy, gx = np.gradient(z, res)
        return np.clip((-gx * 0.6 + gy * 0.6 + 1) / np.sqrt(gx * gx + gy * gy + 1) * 0.75, 0, 1)

    def save(a: np.ndarray, fname: str, nearest: bool = False) -> None:
        im = Image.fromarray(a.astype(np.uint8))
        im.resize((512, 512), Image.NEAREST if nearest else Image.BILINEAR).save(out / f"{name}-{fname}.png")

    save(hillshade(terr.dem, 12.0) * 255, "hillshade")
    save(np.clip(svf, 0, 1) * 255, "skyview")
    pal = np.array([[150, 110, 60], [120, 80, 40], [200, 190, 90], [235, 220, 120], [60, 140, 80], [30, 90, 60],
                    [90, 170, 120], [140, 140, 140], [200, 200, 210], [60, 120, 220]], np.uint8)
    save(pal[fu.cls], "fuels", True)
    hs = hillshade(fu.elev, 30.0)[..., None] * np.array([110, 110, 110])
    a = np.where(arrival < NEVER, arrival, np.nan)
    t = (a - np.nanmin(a)) / (np.nanmax(a) - np.nanmin(a) + 1e-9)
    col = np.stack([255 * np.ones_like(t), 60 + 180 * (1 - t), 40 * np.ones_like(t)], -1)
    save(np.where(np.isnan(t)[..., None], hs, col), "arrival", True)
    p = fx["burn_probability"][..., None]
    save(hs * (1 - p) + p * np.array([255, 170, 60]), "burnprob", True)
    Image.open(io.BytesIO(naip)).save(out / f"{name}-naip.jpg", quality=90)


# =================================================================================================================
# Brief 5: the synthetic flood fixture ``fixture-flood`` (PLAN-5 7.1, CONTRACT 16.9)
# =================================================================================================================
# Everything is synthetic and says so: the flood ("Ridge Fork River flood"), its gauges (ZZRF1-ZZRF4, LIDs that cannot
# collide with real ones), its NWS-style products (text marked SYNTHETIC_MARK, issued by the fictional office KZZZ,
# "NWS Example Office (synthetic)") and its forecasts (the fictional "Example River Forecast Center (synthetic)",
# ZZRFC). The procedural valley does not follow a real river. Times are relative to ``now`` (``--now`` pins it); the
# frozen files carry absolute times only (C16). Canned answers for every flood route go to ``api/`` (the fixture server
# serves them); the seven list-only demo floods ``fixture-flood-<kind>`` have fictional names and live only there.
from fire3d.timeutil import ms_to_dt  # noqa: E402

FLOOD_ID = "fixture-flood"
FLOOD_CENTER = (-108.06, 36.79)                    # lon, lat (San Juan County, NM)
FLOOD_EXTENT_M = 12000.0
FLOOD_TZ = "America/Denver"
FLOOD_SEED = 5
FLOOD_NOW_DEFAULT_STEP_MS = 15 * 60_000            # time-relative runs round "now" down to 15 min
SYNTHETIC_MARK = "[SYNTHETIC — NOT AN NWS PRODUCT]"
SYN_SENDER = "NWS Example Office (synthetic)"
SYN_OFFICE = "KZZZ"
SYN_WFO = "ZZZ"
SYN_RFC, SYN_RFC_NAME = "ZZRFC", "Example River Forecast Center (synthetic)"
SYN_ATTRIBUTION = "Observations courtesy of U.S. Geological Survey"
FLOOD_REACHES = 8                                  # RFC FIM reaches (feature ids 9900001..9900008), west to east
REACH_STATION = {0: "ZZXX9", 1: "ZZXX9", 2: "ZZRF1", 3: "ZZRF1", 4: "ZZRF1", 5: "ZZRF1", 6: "ZZRF2", 7: "ZZRF2"}
SAT_IMAGE_EAST_FRACTION = 0.86                     # the satellite image ends before the AOI's east edge (C2)
NFHL_EFFECTIVE = ("2010-09-26", "2021-08-03")
FLOOD_EDGE_LAYERS = ("alerts", "gauges", "rfc_fim", "catfim", "nfhl", "satellite", "model")


def _flood_copy():
    from fire3d.floods import copy as fcopy
    return fcopy


def _syn_source(src: dict) -> dict:
    """An OfficialSource dict for synthetic data: the shape of the real source, never its credit."""
    return {**src, "name": f"Synthetic fixture (shaped like: {src['name']})",
            "credit": f"Synthetic data for testing; not from: {src['credit']}"}


def _iso_ms(s: str) -> int:
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)


def _ms_date(s: str) -> int:
    return int(datetime.fromisoformat(s).replace(tzinfo=timezone.utc).timestamp() * 1000)


def _local_text(ms: int, fmt: str = "%-I:%M %p %Z %a %b %-d %Y", tz: str = FLOOD_TZ) -> str:
    return datetime.fromtimestamp(ms / 1000, ZoneInfo(tz)).strftime(fmt)


def _vtec_key(office: str, ph: str, sig: str, etn: int, year: int) -> str:
    return f"{office}.{ph}.{sig}.{etn:04d}.{year}"


def _round_geom(g):
    import shapely
    return shapely.set_precision(g, 1e-5)


def _geojson(g) -> dict:
    from shapely.geometry import mapping
    d = mapping(_round_geom(g))
    return orjson_roundtrip(d)


def orjson_roundtrip(obj):
    """Plain JSON types (tuples -> lists) so canned answers compare equal after a reload."""
    import orjson
    return orjson.loads(orjson.dumps(obj, option=orjson.OPT_SERIALIZE_NUMPY))


def _fc(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


@dataclass
class FloodValley:
    render: Grid
    dem: np.ndarray            # float32 m
    hand: np.ndarray           # height above the channel water surface, m
    d: np.ndarray              # distance to the channel centerline, m
    s: np.ndarray              # along-channel coordinate (local x of the nearest centerline point), m
    line: np.ndarray           # (K, 2) centerline local x, z
    to_lonlat: object          # UTM -> lon/lat transformer
    lon: np.ndarray            # cell centre lon / lat
    lat: np.ndarray


def flood_valley(render: Grid, rng: np.random.Generator) -> FloodValley:
    """A procedural river valley: a meandering west-flowing channel on a 0.4-0.7 km wide floodplain, terraces and mesas."""
    X, Z = render.cell_centers_local()
    ext = render.extent_m
    xs = np.linspace(-0.6 * ext, 0.6 * ext, 4000)
    zc = 950.0 * np.sin(2 * np.pi * xs / 7400.0 + 0.6) + 330.0 * np.sin(2 * np.pi * xs / 2300.0 + 1.9)
    line = np.c_[xs, zc]
    d, idx = cKDTree(line).query(np.c_[X.ravel(), Z.ravel()], workers=-1)
    d = d.reshape(X.shape)
    s = xs[idx].reshape(X.shape)
    shape = X.shape
    width_noise = value_fbm(rng, shape, 18.0, octaves=3)
    small = value_fbm(rng, shape, 120.0, octaves=4)
    mesa_noise = value_fbm(rng, shape, 9.0, octaves=4)
    z_river = 1488.0 + 0.0025 * (X + 0.5 * ext)                 # 2.5 m/km, flowing west (smooth: no seams)
    fp_w = 520.0 + 260.0 * width_noise                          # floodplain half-width
    fp = np.clip(d - 28.0, 0, None)
    prof = 4.6 * np.clip(fp / fp_w, 0, 1.6) ** 1.25
    terrace = smoothstep(0.85, 2.4, d / fp_w) * 38.0
    mesa = smoothstep(1500.0, 3400.0, d) * (85.0 + 80.0 * mesa_noise)
    elev = z_river + prof + terrace + mesa + 0.7 * small * smoothstep(40.0, 400.0, d)
    elev = np.where(d < 28.0, z_river - 2.2 * (1.0 - d / 28.0), elev)
    hand = (elev - z_river).astype(np.float32)
    epsg = render.epsg
    tll = transformer(epsg, 4326)
    lon, lat = render.cell_centers_lonlat()
    return FloodValley(render, elev.astype(np.float32), hand, d.astype(np.float32), s.astype(np.float32), line, tll,
                       np.asarray(lon), np.asarray(lat))


def _mask_polygons(v: FloodValley, mask: np.ndarray, tol_deg: float = 0.0002):
    """(lon/lat geometry, UTM geometry) of a boolean mask on the render grid; (None, None) when empty."""
    import shapely
    from rasterio import features as rfeatures
    from shapely.geometry import shape

    if not mask.any():
        return None, None
    polys = [shape(g) for g, val in rfeatures.shapes(mask.astype(np.uint8), mask=mask, transform=v.render.transform) if val == 1]
    utm = shapely.union_all(polys)
    ll = shapely.transform(utm, lambda xy: np.column_stack(v.to_lonlat.transform(xy[:, 0], xy[:, 1])))
    ll = ll.simplify(tol_deg, preserve_topology=True)
    return _round_geom(ll), utm


def _local_lonlat(v: FloodValley, x: float, z: float) -> tuple[float, float]:
    lon, lat = v.render.local_to_lonlat(x, z)
    return round(float(lon), 5), round(float(lat), 5)


def _centerline_z(v: FloodValley, x: float) -> float:
    i = int(np.argmin(np.abs(v.line[:, 0] - x)))
    return float(v.line[i, 1])


def _stage_series(knots: list[tuple[float, float]], t_h: np.ndarray, rng: np.random.Generator, noise: float) -> np.ndarray:
    k = np.array(knots, dtype=float)
    y = np.interp(t_h, k[:, 0], k[:, 1])
    if noise:
        y = y + rng.normal(0, noise, size=y.shape)
    return np.round(y, 2)


def _category(stage: float | None, th: dict) -> str:
    if stage is None:
        return "unknown"
    for cat in ("major", "moderate", "minor", "action"):
        if th.get(cat) is not None and stage >= th[cat]:
            return cat
    return "no_flooding"


def _series_rows(t_ms: np.ndarray, stage: np.ndarray, flow: np.ndarray) -> list[list]:
    return [[int(t), float(h), float(round(q, 3))] for t, h, q in zip(t_ms, stage, flow)]


def flood_gauges(v: FloodValley, now: int, rng: np.random.Generator) -> list[dict]:
    """The four synthetic gauges as RiverGauge dicts with ``series`` (members ZZRF1, ZZRF2; nearby ZZRF3, ZZRF4)."""
    step = 15 * 60_000
    t_obs = np.arange(now - 72 * HOUR_MS, now + 1, step)
    th_obs = (t_obs - now) / HOUR_MS
    t_fc = np.arange(now + 6 * HOUR_MS, now + 120 * HOUR_MS + 1, 6 * HOUR_MS)
    th_fc = (t_fc - now) / HOUR_MS
    issued = now - 2 * HOUR_MS
    out = []

    def gauge(lid, name, waterbody, x, z, th, obs_knots, fc_knots, rating, *, reach, member, fc_point, last_ms=None,
              category_override=None, impacts=None, notes=None):
        lon, lat = _local_lonlat(v, x, z)
        t_o = t_obs if last_ms is None else t_obs[t_obs <= last_ms]
        h_o = _stage_series(obs_knots, (t_o - now) / HOUR_MS, rng, 0.015)
        q_o = rating(h_o)
        obs_cat = category_override or _category(float(h_o[-1]), th)
        reading = {"value": float(h_o[-1]), "unit": "ft", "flow": float(round(q_o[-1], 3)), "flow_unit": "kcfs",
                   "category": obs_cat, "valid_ms": int(t_o[-1])}
        series = {"observed": _series_rows(t_o, h_o, q_o), "forecast": [], "forecast_issued_ms": None,
                  "stage_unit": "ft", "flow_unit": "kcfs"}
        forecast = None
        if fc_point:
            h_f = _stage_series(fc_knots, th_fc, rng, 0.0)
            q_f = rating(h_f)
            series.update(forecast=_series_rows(t_fc, h_f, q_f), forecast_issued_ms=issued)
            i_max = int(np.argmax(h_f))
            forecast = {"category": _category(float(h_f[i_max]), th), "max_value": float(h_f[i_max]), "max_ms": int(t_fc[i_max]),
                        "issued_ms": issued, "producer": SYN_RFC, "producer_name": SYN_RFC_NAME, "issuer": SYN_WFO,
                        "url": None, "crest_at_end": bool(i_max == len(h_f) - 1)}
        g = {"lid": lid, "usgs_id": None, "reach_id": reach, "name": name, "waterbody": waterbody, "state": None,
             "county": None, "time_zone": FLOOD_TZ, "lat": lat, "lon": lon, "url": f"https://water.noaa.gov/gauges/{lid.lower()}",
             "rfc": SYN_RFC, "wfo": SYN_WFO, "member": member, "is_forecast_point": fc_point,
             "thresholds": {"unit": "ft", **th}, "observed": reading, "forecast": forecast, "series": series,
             "impacts": impacts or [], "forecast_reliability": notes[0] if notes else None,
             "hydronotes": list(notes[1:]) if notes else [],
             "data_attribution": [{"text": SYN_ATTRIBUTION, "url": None}]}
        out.append(g)

    x1, x2 = -300.0, 3800.0
    gauge("ZZRF1", "Ridge Fork River at Example Crossing", "Ridge Fork River", x1, _centerline_z(v, x1),
          {"action": 13.0, "minor": 15.0, "moderate": 17.0, "major": 19.0},
          [(-72, 10.9), (-48, 11.4), (-40, 13.0), (-30, 14.3), (-20, 15.0), (-12, 16.0), (-4, 17.0), (0, 17.6)],
          [(0, 17.6), (6, 17.75), (12, 17.85), (24, 17.95), (30, 18.0), (36, 17.92), (48, 17.3), (72, 15.9), (96, 14.7),
           (120, 13.9)],
          lambda h: 0.12 * np.clip(h - 8.0, 0, None) ** 1.8, reach="9900004", member=True, fc_point=True,
          impacts=[{"stage": 15.0, "statement": "[SYNTHETIC] Water reaches the picnic area at Example Crossing Park."},
                   {"stage": 17.0, "statement": "[SYNTHETIC] Water covers the low-water crossing on Example Road and "
                                                "fields along the river."},
                   {"stage": 19.0, "statement": "[SYNTHETIC] Water reaches homes on Riverside Lane in the fictional "
                                                "town of Example Crossing."}],
          notes=["[SYNTHETIC] Forecasts are issued as needed during times of high water.",
                 "[SYNTHETIC] River forecasts for this example gauge take into account past precipitation and the "
                 "precipitation expected in the next 48 hours."])
    gauge("ZZRF2", "Ridge Fork River near Sample Bend", "Ridge Fork River", x2, _centerline_z(v, x2),
          {"action": 9.0, "minor": 11.0, "moderate": 13.0, "major": 15.0},
          [(-72, 7.2), (-36, 7.9), (-12, 8.8), (0, 9.4)],
          [(0, 9.4), (24, 9.8), (48, 10.1), (72, 10.35), (96, 10.6), (120, 10.8)],
          lambda h: 0.05 * np.clip(h - 4.0, 0, None) ** 1.9, reach="9900007", member=True, fc_point=True)
    gauge("ZZRF3", "Demo Draw at Mock Springs", "Demo Draw", -2600.0, 3300.0,
          {"action": 6.0, "minor": 8.0, "moderate": 10.0, "major": 12.0},
          [(-72, 3.0), (-24, 3.2), (0, 3.1)], [], lambda h: 0.01 * np.clip(h - 1.0, 0, None) ** 1.7,
          reach=None, member=False, fc_point=False)
    gauge("ZZRF4", "Sample Wash near Placeholder", "Sample Wash", 1500.0, -3600.0,
          {"action": 5.0, "minor": 7.0, "moderate": 9.0, "major": 11.0},
          [(-72, 3.6), (-30, 4.0), (-9, 4.2)], [], lambda h: 0.01 * np.clip(h - 1.0, 0, None) ** 1.7,
          reach="9900099", member=False, fc_point=False, last_ms=now - 9 * HOUR_MS, category_override="obs_not_current")
    from fire3d import regions
    for g in out:
        g["state"] = regions.state_at(g["lon"], g["lat"])
        c = regions.county_at(g["lon"], g["lat"])
        g["county"] = c.name if c else None
    return out


def gauge_ref(g: dict) -> dict:
    """FloodGaugeRef of a RiverGauge dict."""
    f = g.get("forecast") or {}
    return {"lid": g["lid"], "name": g["name"], "waterbody": g["waterbody"], "state": g["state"], "lat": g["lat"],
            "lon": g["lon"], "observed_category": g["observed"]["category"], "observed_value": g["observed"]["value"],
            "unit": g["observed"]["unit"], "observed_ms": g["observed"]["valid_ms"],
            "forecast_category": f.get("category") if g.get("forecast") else None,
            "forecast_max_value": f.get("max_value"), "forecast_max_ms": f.get("max_ms"),
            "forecast_issued_ms": f.get("issued_ms"), "url": g["url"]}


def product_ref(a: dict) -> dict:
    """FloodProductRef of a FloodAlert dict."""
    vt = a.get("vtec")
    return {"id": a["id"], "event": a["event"],
            "vtec_key": _vtec_key(vt["office"], vt["phenomena"], vt["significance"], vt["etn"], vt["year"]) if vt else None,
            "sender_name": a["sender_name"], "phase": a["phase"], "sent_ms": a["sent_ms"], "onset_ms": a["onset_ms"],
            "ends_ms": a["ends_ms"] if a["ends_ms"] is not None else a["expires_ms"], "emergency": a["emergency"],
            "damage_threat": a["damage_threat"], "gauge_lids": [a["hvtec"]["nwsli"]] if a.get("hvtec") else [],
            "url": a["url"], "archived": a["archived"]}


def syn_alert(*, aid: str, event: str, ph: str, sig: str, etn: int, action: str, year: int, sent: int,
              onset: int | None, ends: int | None, headline: str, description: str, instruction: str | None,
              area_desc: str, ugcs: list[str], geometry: dict | None, flood_ids: list[str], phase: str = "in_effect",
              hvtec: dict | None = None, emergency: bool = False, damage: str | None = None,
              detection: str | None = None, archived: bool = False, tz: str = FLOOD_TZ, sender: str = SYN_SENDER,
              office: str = SYN_OFFICE) -> dict:
    return {
        "id": aid, "url": None, "office_url": None, "event": event,
        "vtec": {"office": office, "phenomena": ph, "significance": sig, "etn": etn, "action": action, "year": year},
        "hvtec": hvtec, "sender_name": sender, "sent_ms": sent, "effective_ms": sent, "onset_ms": onset,
        "expires_ms": (ends if ends is not None else sent + 6 * HOUR_MS) if not archived else None, "ends_ms": ends,
        "headline": headline, "nws_headline": headline.upper() if not archived else headline,
        "description": f"{SYNTHETIC_MARK}\n\n{description}", "instruction": instruction, "area_desc": area_desc,
        "ugcs": ugcs, "message_type": None if archived else ("Alert" if action == "NEW" else "Update"),
        "status": "Actual", "phase": phase, "archived": archived, "time_zone": tz, "emergency": emergency,
        "damage_threat": damage, "detection": detection, "geometry": geometry, "covers_point": None,
        "flood_ids": flood_ids,
    }


def _envelope(kind: str, src: dict, now: int, flood_id: str | None, *, status: str = "available",
              reason_code: str | None = None, reason: str | None = None, caveats: list[str] | None = None,
              retrieved: int | None = None, updated: int | None = None, at_ms: int | None = None) -> dict:
    return {"kind": kind, "status": status, "reason_code": reason_code, "reason": reason, "source": _syn_source(src),
            "retrieved_ms": retrieved if retrieved is not None else (now - 60_000 if status == "available" else None),
            "source_updated_ms": updated, "requested_at_ms": at_ms, "now_ms": now, "flood_id": flood_id,
            "synthetic": True, "caveats": list(caveats or [])}


def _bbox_of(geoms: list, pad_deg: float = 0.005) -> list[float]:
    import shapely
    u = shapely.union_all([g for g in geoms if g is not None])
    w, s, e, n = u.bounds
    return [round(w - pad_deg, 5), round(s - pad_deg, 5), round(e + pad_deg, 5), round(n + pad_deg, 5)]


def _place(lon: float, lat: float) -> dict:
    from fire3d import regions
    c = regions.county_at(lon, lat)
    st = regions.state_at(lon, lat)
    return {"state": st, "county": c.name if c else None, "time_zone": regions.time_zone_at(lon, lat) or regions.main_zone(st)}


def _summary(*, fid: str, name: str, kind: str, level: str, emergency: bool, status: str, mode: str, year: int,
             started: int, basis: str, products: list[dict], gauges: list[dict], lon: float, lat: float, bbox: list[float],
             states: list[str], now: int, bundle_status: str = "none", built: int | None = None,
             ended: int | None = None, caveat: str | None = None, rivers: list[str] | None = None) -> dict:
    from fire3d.floods.grouping import flood_rank  # noqa: F401 - documents where the order comes from
    members = [g for g in gauges if g["member"]]
    cats = [c for g in members for c in (g["observed"]["category"], (g.get("forecast") or {}).get("category"))]
    max_cat = next((c for c in ("major", "moderate", "minor", "action") if c in cats), None)
    in_effect = [p for p in products if p["phase"] in ("in_effect", "upcoming")]
    ends = [p["ends_ms"] for p in in_effect if p.get("ends_ms")]
    sent = [p["sent_ms"] for p in products if p.get("sent_ms")]
    readings = [g["observed"]["valid_ms"] for g in members if g["observed"]["valid_ms"]]
    place = _place(lon, lat)
    refs = [gauge_ref(g) for g in members]
    return {
        "id": fid, "hazard": "flood", "name": name, "kind": kind, "level": level, "emergency": emergency, "status": status,
        "mode": mode, "year": year, "started_ms": started, "started_basis": basis,
        "updated_ms": max(sent + readings) if (sent or readings) else None,
        "expires_ms": max(ends) if ends else None, "last_product_ms": max(sent) if sent else None, "ended_ms": ended,
        "lat": lat, "lon": lon, "bbox_lonlat": bbox, "state": place["state"], "states": states,
        "county": place["county"], "time_zone": place["time_zone"],
        "rivers": rivers if rivers is not None else list(dict.fromkeys(g["waterbody"] for g in members if g["waterbody"])),
        "primary_gauge": refs[0] if refs else None, "gauges": refs,
        "gauges_in_flood": sum(1 for g in members if g["observed"]["category"] in ("minor", "moderate", "major")),
        "max_category": max_cat, "products": products, "offices": sorted({SYN_OFFICE}) if products else [],
        "bundle_status": bundle_status, "bundle_built_ms": built, "aliases": [], "synthetic": True, "caveat": caveat,
    }


def _rect(lon: float, lat: float, dx: float, dy: float, rot: float = 0.0):
    from shapely import affinity
    from shapely.geometry import box as sbox
    g = sbox(lon - dx, lat - dy, lon + dx, lat + dy)
    return _round_geom(affinity.rotate(g, rot, origin=(lon, lat)))


def _simple_gauge(lid: str, name: str, waterbody: str, lon: float, lat: float, th: dict, stage: float, now: int, *,
                  member: bool, fc: tuple[float, int] | None, rng: np.random.Generator, tz: str,
                  category: str | None = None, past_ms: int | None = None) -> dict:
    """A list-only demo flood's gauge (RiverGauge dict, 72 h of hourly series)."""
    t_end = past_ms if past_ms is not None else now
    t = np.arange(t_end - 72 * HOUR_MS, t_end + 1, HOUR_MS)
    h = np.round(stage - 2.4 * np.exp(-((t - t[0]) / (36 * HOUR_MS))) + rng.normal(0, 0.02, t.shape), 2)
    q = 0.08 * np.clip(h - 2.0, 0, None) ** 1.8
    cat = category or _category(float(h[-1]), th)
    forecast = None
    series = {"observed": _series_rows(t, h, q), "forecast": [], "forecast_issued_ms": None, "stage_unit": "ft", "flow_unit": "kcfs"}
    if fc is not None:
        fmax, fh = fc
        tf = np.arange(now + 6 * HOUR_MS, now + 96 * HOUR_MS + 1, 6 * HOUR_MS)
        hf = np.round(np.interp((tf - now) / HOUR_MS, [0, fh, 96], [float(h[-1]), fmax, fmax - 2.5]), 2)
        qf = 0.08 * np.clip(hf - 2.0, 0, None) ** 1.8
        series.update(forecast=_series_rows(tf, hf, qf), forecast_issued_ms=now - 3 * HOUR_MS)
        i = int(np.argmax(hf))
        forecast = {"category": _category(float(hf[i]), th), "max_value": float(hf[i]), "max_ms": int(tf[i]),
                    "issued_ms": now - 3 * HOUR_MS, "producer": SYN_RFC, "producer_name": SYN_RFC_NAME, "issuer": SYN_WFO,
                    "url": None, "crest_at_end": bool(i == len(hf) - 1)}
    place = _place(lon, lat)
    return {"lid": lid, "usgs_id": None, "reach_id": None, "name": name, "waterbody": waterbody, "state": place["state"],
            "county": place["county"], "time_zone": tz, "lat": lat, "lon": lon,
            "url": f"https://water.noaa.gov/gauges/{lid.lower()}", "rfc": SYN_RFC, "wfo": SYN_WFO, "member": member,
            "is_forecast_point": fc is not None, "thresholds": {"unit": "ft", **th},
            "observed": {"value": float(h[-1]), "unit": "ft", "flow": float(round(q[-1], 3)), "flow_unit": "kcfs",
                         "category": cat, "valid_ms": int(t[-1])},
            "forecast": forecast, "series": series, "impacts": [], "forecast_reliability": None, "hydronotes": [],
            "data_attribution": [{"text": SYN_ATTRIBUTION, "url": None}]}


def _no_series(g: dict) -> dict:
    return {k: v for k, v in g.items() if k != "series"}


def _gauges_answer(gauges: list[dict], now: int, fid: str | None, bbox, *, series: bool, at_ms: int | None = None,
                   caveats: list[str] | None = None, status: str = "available", reason: str | None = None,
                   reason_code: str | None = None) -> dict:
    fc = _flood_copy()
    rows = [g if series else _no_series(g) for g in gauges]
    return {**_envelope("river_gauges", fc.SOURCE_NWPS, now, fid, status=status, reason=reason, reason_code=reason_code,
                        caveats=caveats if caveats is not None else [fc.GAUGE_NOT_ALL_CLEAR], updated=now - 15 * 60_000,
                        at_ms=at_ms),
            "gauges": rows, "area_bbox": bbox}


def _alerts_answer(alerts: list[dict], zones: dict, now: int, fid: str | None, bbox, states: list[str], *,
                   archived: bool = False, at_ms: int | None = None, caveats: list[str] | None = None) -> dict:
    fc = _flood_copy()
    src = fc.SOURCE_IEM if archived else fc.SOURCE_NWS
    return {**_envelope("flood_alerts", src, now, fid, caveats=caveats or [], updated=now - 2 * 60_000, at_ms=at_ms),
            "alerts": alerts, "zones": zones, "area_bbox": bbox, "states_checked": states}


def _map_answer(kind: str, features: dict, now: int, fid: str | None, *, reference: int | None, updated: int | None,
                stats: float | None, category: str | None = None, availability: str | None = None,
                eff: tuple[int, int] | None = None, status: str = "available", reason: str | None = None,
                reason_code: str | None = None, caveats: list[str] | None = None) -> dict:
    fc = _flood_copy()
    src = {"rfc_fim": fc.SOURCE_RFC_FIM, "catfim": fc.SOURCE_CATFIM, "nfhl": fc.SOURCE_NFHL}[kind]
    note = {"rfc_fim": fc.RFC_FIM_NOTE, "catfim": fc.catfim_note(category or "moderate"), "nfhl": fc.NFHL_NOTE}[kind]
    out = {**_envelope("flood_map", src, now, fid, status=status, reason=reason, reason_code=reason_code,
                       caveats=caveats, updated=updated),
           "map": kind, "features": features, "reference_ms": reference, "updated_ms": updated,
           "stats": {"area_km2": round(stats, 3)} if stats is not None else None, "coverage_note": note,
           "outside_note": fc.RFC_FIM_OUTSIDE if kind == "rfc_fim" else None, "experimental": kind != "nfhl",
           "category": category if kind == "catfim" else None, "min_zoom": None}
    if kind == "nfhl":
        out.update(availability=availability, effective_min_ms=eff[0] if eff else None, effective_max_ms=eff[1] if eff else None)
    return out


def _model_answer(kind: str, now: int, fid: str | None, *, features: dict | None = None, series: list[dict] | None = None,
                  reach_id: str | None = None, lid: str | None = None, reference: int | None = None,
                  updated: int | None = None, status: str = "available", reason: str | None = None) -> dict:
    fc = _flood_copy()
    return {"kind": kind, "model_output": True, "label": fc.MODEL_LABEL, "status": status, "reason": reason,
            "source": _syn_source(fc.SOURCE_NWM), "retrieved_ms": now - 60_000 if status == "available" else None,
            "reference_ms": reference, "updated_ms": updated, "features": features, "series": series,
            "reach_id": reach_id, "lid": lid, "now_ms": now, "flood_id": fid, "synthetic": True,
            "caveats": [fc.MODEL_CAVEAT]}


def _sat_palette_rgba(cls: np.ndarray) -> np.ndarray:
    """DSWx WTR classes -> RGBA (CONTRACT 16.5): water #2a8ce6 a.55, partial #7fd4ff a.35, cloud (253) and no data
    (255) the same grey #9a9a9a "no view" hatch (never transparent), snow/ice white a.3, not water and ocean clear."""
    h, w = cls.shape
    out = np.zeros((h, w, 4), np.uint8)
    out[cls == 1] = (0x2A, 0x8C, 0xE6, 140)
    out[cls == 2] = (0x7F, 0xD4, 0xFF, 89)
    out[cls == 252] = (255, 255, 255, 77)
    noview = (cls == 253) | (cls == 255)
    rr, cc = np.mgrid[0:h, 0:w]
    hatch = ((rr + cc) % 6) < 2
    out[noview] = (0x9A, 0x9A, 0x9A, 115)
    out[noview & hatch] = (0x7A, 0x7A, 0x7A, 190)
    return out


def _png(rgba: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _naip(v: FloodValley, rng: np.random.Generator) -> bytes:
    gy, gx = np.gradient(v.dem.astype(np.float64), v.render.res_m)
    shade = np.clip((-gx * 0.6 + gy * 0.6 + 1) / np.sqrt(gx * gx + gy * gy + 1) * 0.9, 0.35, 1.1)
    hand = v.hand
    fields = value_fbm(rng, hand.shape, 60.0, octaves=2)
    base = np.empty(hand.shape + (3,), np.float32)
    base[:] = (158, 142, 122)                                               # desert soil
    fp = hand < 5.0
    base[fp] = np.stack([116 + 18 * fields[fp], 124 + 16 * fields[fp], 98 + 10 * fields[fp]], -1)   # fields, cottonwoods
    base[v.d < 30.0] = (74, 82, 78)                                        # channel (normal water)
    mesa = hand > 60
    base[mesa] = (170, 140, 112)
    img = np.clip(base * shade[..., None], 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img, "RGB").save(buf, format="JPEG", quality=82)
    return buf.getvalue()


def build_flood_fixture(data_dir: Path, now: int | None = None, *, copy_api: Path | None = None) -> Path:
    """Write ``<data_dir>/floods/fixture-flood/`` (bundle, frozen files, canned answers in ``api/``) and return it.
    ``now``: epoch ms the fixture is relative to (default: the current time rounded down to 15 min). Every JSON file is
    validated strictly against ``fire3d.contracts``. ``copy_api``: also copy ``api/`` there (the committed test copy)."""
    from shapely.geometry import LineString as SLine, mapping, shape as sshape

    from fire3d import contracts as C
    from fire3d import regions
    from fire3d.floods.grouping import sort_floods

    fc = _flood_copy()
    t0 = time.time()
    if now is None:
        now = now_ms() // FLOOD_NOW_DEFAULT_STEP_MS * FLOOD_NOW_DEFAULT_STEP_MS
    rng = np.random.default_rng(FLOOD_SEED)
    root = Path(data_dir) / "floods" / FLOOD_ID
    if root.exists():
        shutil.rmtree(root)
    api = root / "api"
    (api / "edge").mkdir(parents=True)
    year = ms_to_dt(now).year

    epsg = utm_epsg_for(FLOOD_CENTER[0])
    ce, cn = transformer(4326, epsg).transform(*FLOOD_CENTER)
    render = Grid(epsg, float(round(ce)), float(round(cn)), FLOOD_EXTENT_M, config.RENDER_SIZE, config.RENDER_SIZE)
    v = flood_valley(render, rng)
    res2 = render.res_m ** 2
    aoi_bbox = [round(float(x), 5) for x in render.bbox_lonlat()]
    print(f"[{FLOOD_ID}] grid EPSG:{epsg} extent {FLOOD_EXTENT_M:.0f} m @ {render.res_m:.2f} m", flush=True)

    # ---- gauges ------------------------------------------------------------------------------------------------
    gauges = flood_gauges(v, now, rng)
    g1 = gauges[0]
    members = [g for g in gauges if g["member"]]

    # ---- products (FL.W two versions, FA.Y, FA.A zones) -------------------------------------------------------
    reach_mask = (np.abs(v.s - (-300.0)) < 3500.0) & (v.hand < 4.2) & (v.d < 1500.0)
    flw_geom, _ = _mask_polygons(v, reach_mask, tol_deg=0.002)
    flw_geom = flw_geom.convex_hull.buffer(0.004).simplify(0.002)
    fay_geom = _rect(*_local_lonlat(v, -2400.0, 2600.0), 0.022, 0.016, rot=18.0)
    t_new, t_ext = now - 30 * HOUR_MS, now - 6 * HOUR_MS
    flw_begin, flw_end_old, flw_end = now - 20 * HOUR_MS, now + 2 * HOUR_MS, now + 8 * HOUR_MS
    crest_ms = now + 30 * HOUR_MS
    hv = {"nwsli": "ZZRF1", "severity": "2", "cause": "ER", "begin_ms": flw_begin, "crest_ms": crest_ms, "end_ms": None,
          "record": "NO"}
    area_flw = "San Juan, NM"
    desc_flw = ("* WHAT...Flooding caused by excessive rainfall is occurring and is forecast to continue.\n\n"
                "* WHERE...Ridge Fork River at Example Crossing (a fictional gauge).\n\n"
                f"* WHEN...Until {_local_text(flw_end, '%-I:%M %p %Z %A')}.\n\n"
                "* IMPACTS...At 17.0 feet, water covers the low-water crossing on Example Road and fields along the river.\n\n"
                "* ADDITIONAL DETAILS...\n"
                f"- At {_local_text(now - HOUR_MS, '%-I:%M %p %Z %A')} the stage was 17.6 feet.\n"
                "- Flood stage is 15.0 feet.\n"
                f"- Forecast...The river is expected to rise to a crest of 18.0 feet {_local_text(crest_ms, '%A %p')}.")
    instr = ("Turn around, don't drown when encountering flooded roads. Most flood deaths occur in vehicles.\n\n"
             "[SYNTHETIC] This text is test data for Fire-3d, not an instruction from any office.")
    zones_geom = {"NMZ901": _rect(*_local_lonlat(v, -2500.0, 0.0), 0.06, 0.05), "NMZ902": _rect(*_local_lonlat(v, 4200.0, 0.0), 0.05, 0.05)}
    alerts_all = [
        syn_alert(aid="urn:oid:synthetic.fixture-flood.flw.1", event="Flood Warning", ph="FL", sig="W", etn=1, action="NEW",
                  year=ms_to_dt(t_new).year, sent=t_new, onset=flw_begin, ends=flw_end_old,
                  headline=f"Flood Warning issued {_local_text(t_new)} by {SYN_SENDER}", description=desc_flw,
                  instruction=instr, area_desc=area_flw, ugcs=["NMC045"], geometry=mapping(flw_geom),
                  flood_ids=[FLOOD_ID], hvtec=hv),
        syn_alert(aid="urn:oid:synthetic.fixture-flood.flw.2", event="Flood Warning", ph="FL", sig="W", etn=1, action="EXT",
                  year=ms_to_dt(t_new).year, sent=t_ext, onset=flw_begin, ends=flw_end,
                  headline=f"Flood Warning issued {_local_text(t_ext)} by {SYN_SENDER}", description=desc_flw,
                  instruction=instr, area_desc=area_flw, ugcs=["NMC045"], geometry=mapping(flw_geom),
                  flood_ids=[FLOOD_ID], hvtec=hv),
        syn_alert(aid="urn:oid:synthetic.fixture-flood.fay.1", event="Flood Advisory", ph="FA", sig="Y", etn=7, action="NEW",
                  year=year, sent=now - 3 * HOUR_MS, onset=now - 3 * HOUR_MS, ends=now + 5 * HOUR_MS,
                  headline=f"Flood Advisory issued {_local_text(now - 3 * HOUR_MS)} by {SYN_SENDER}",
                  description="* WHAT...Urban and small stream flooding caused by excessive rainfall is expected.\n\n"
                              "* WHERE...A portion of the fictional Demo Draw area.\n\n"
                              "* IMPACTS...Minor flooding in low-lying and poor drainage areas.",
                  instruction=instr, area_desc=area_flw, ugcs=["NMC045"], geometry=mapping(fay_geom),
                  flood_ids=[FLOOD_ID]),
        syn_alert(aid="urn:oid:synthetic.fixture-flood.faa.1", event="Flood Watch", ph="FA", sig="A", etn=3, action="NEW",
                  year=year, sent=now - 20 * HOUR_MS, onset=now - 18 * HOUR_MS, ends=now + 30 * HOUR_MS,
                  headline=f"Flood Watch issued {_local_text(now - 20 * HOUR_MS)} by {SYN_SENDER}",
                  description="* WHAT...Flooding caused by excessive rainfall is possible.\n\n"
                              "* WHERE...Example Mesa and Sample Valley (fictional zones).\n\n"
                              "* IMPACTS...Excessive runoff may result in flooding of rivers, creeks, streams and other "
                              "low-lying and flood-prone locations.",
                  instruction="You should monitor later forecasts and be alert for possible Flood Warnings.\n\n"
                              "[SYNTHETIC] This text is test data for Fire-3d, not an instruction from any office.",
                  area_desc="Example Mesa; Sample Valley", ugcs=list(zones_geom), geometry=None, flood_ids=[FLOOD_ID]),
    ]
    current = [alerts_all[1], alerts_all[2], alerts_all[3]]                # the versions in effect now
    zones_fc = _fc([{"type": "Feature", "id": ugc, "geometry": _geojson(g),
                     "properties": {"ugc": ugc, "name": {"NMZ901": "Example Mesa", "NMZ902": "Sample Valley"}[ugc],
                                    "alert_ids": [alerts_all[3]["id"]]}} for ugc, g in zones_geom.items()])
    flood_bbox = _bbox_of([flw_geom, fay_geom] + [sshape({"type": "Point", "coordinates": [g["lon"], g["lat"]]}) for g in members])

    # ---- water layers ------------------------------------------------------------------------------------------
    reach = np.clip(((v.s + FLOOD_EXTENT_M / 2) / FLOOD_EXTENT_M * FLOOD_REACHES).astype(int), 0, FLOOD_REACHES - 1)
    near = v.d < 2600.0
    channel = v.d < 60.0

    def joined(m: np.ndarray) -> np.ndarray:
        """Only the parts of ``m`` connected to the channel (no ponds on the terraces)."""
        lab, _ = ndimage.label(m)
        keep = np.unique(lab[m & channel])
        return np.isin(lab, keep[keep > 0])

    fim = joined((v.hand < 3.0) & near)
    cat_mod, cat_maj = joined((v.hand < 2.6) & near), joined((v.hand < 3.4) & near)
    floodway = (v.hand < 1.0) & (v.d < 220.0)
    sfha = joined((v.hand < 4.0) & near)
    band02 = joined((v.hand < 5.2) & near)
    floodplain = np.zeros(v.hand.shape, np.uint8)
    floodplain[band02] = 1
    floodplain[sfha] = 2
    floodplain[floodway] = 3
    model_thr = 2.1 + 0.6 * np.sin(v.s / 1500.0)
    nwm = joined((v.hand < model_thr) & near)
    nwm5 = joined((v.hand < 3.6) & near)
    # satellite classes (DSWx WTR): water near the channel (more around ZZRF1), partial water at the edge, a cloud
    # patch (~30 %), a no-data strip, and the image ending before the AOI's east edge
    boost = 1.0 * np.exp(-(((v.s + 300.0) / 2600.0) ** 2))
    wet = joined((v.hand < 1.3 + boost) & near)
    partial = (~wet) & joined((v.hand < 1.9 + boost) & near)
    sat = np.zeros(v.hand.shape, np.uint8)
    sat[partial & near] = 2
    sat[wet & near] = 1
    cloud_field = ndimage.gaussian_filter(rng.random(v.hand.shape), 60.0)
    lon_w, _, lon_e, _ = render.bbox_lonlat()
    img_e = lon_w + SAT_IMAGE_EAST_FRACTION * (lon_e - lon_w)
    in_img = v.lon <= img_e
    thr = np.quantile(cloud_field[in_img], 0.70)
    sat[(cloud_field > thr) & in_img] = 253
    X, Z = render.cell_centers_local()
    strip = np.abs((0.8 * X + 0.6 * Z) - 2600.0) < 260.0
    sat[strip & in_img] = 255
    sat[~in_img] = 255

    # ---- bundle files ------------------------------------------------------------------------------------------
    svf = sky_view_factor(v.dem, render.res_m, n_az=8, n_steps=10)
    layers = {
        "elevation": bundle.write_layer(root, "elevation", v.dem, "render", "m", "Elevation (synthetic terrain)", register=False),
        "sky_view": bundle.write_layer(root, "sky_view", (np.clip(svf, 0, 1) * 255).astype(np.uint8), "render", None,
                                       "Sky-view factor (0-255)", register=False),
        "water_forecast": bundle.write_layer(root, "water_forecast", (fim * 255).astype(np.uint8), "render", None,
                                             "NWS forecast flooded area, next 5 days (synthetic; 0/255)", register=False),
        "floodplain": bundle.write_layer(root, "floodplain", floodplain, "render", None,
                                         "FEMA floodplain (synthetic): 0 none, 1 0.2 % band, 2 SFHA, 3 floodway", register=False),
        "water_satellite": bundle.write_layer(root, "water_satellite", sat, "render", None,
                                              "Water seen by satellite (synthetic DSWx WTR classes)", register=False),
        "water_model": bundle.write_layer(root, "water_model", (nwm * 255).astype(np.uint8), "render", None,
                                          "National Water Model flooded area (synthetic model output; 0/255)", register=False),
    }
    naip = _naip(v, rng)
    layers["naip"] = bundle.write_image_layer(root, "naip", naip, config.RENDER_SIZE, config.RENDER_SIZE,
                                              "Aerial photo (synthetic), before this flood", register=False)

    # ---- maps --------------------------------------------------------------------------------------------------
    import shapely
    fim_feats, member_utm = [], []
    for r in range(FLOOD_REACHES):
        ll, utm = _mask_polygons(v, fim & (reach == r))
        if ll is None:
            continue
        fid_r = 9900001 + r
        fim_feats.append({"type": "Feature", "id": fid_r, "geometry": _geojson(ll),
                          "properties": {"feature_id": fid_r, "streamflow_cfs": round(6400.0 - 300.0 * abs(r - 3.5), 1)}})
        if REACH_STATION[r] in {g["lid"] for g in members}:
            member_utm.append(utm)
    fim_area = shapely.union_all(member_utm).area / 1e6 if member_utm else None
    rfc_ref, rfc_upd = now - 2 * HOUR_MS, now - 100 * 60_000
    maps = {"rfc_fim": _fc(fim_feats)}
    for cat, m in (("moderate", cat_mod), ("major", cat_maj)):
        ll, _ = _mask_polygons(v, m)
        maps[f"catfim_ZZRF1_{cat}"] = _fc([{"type": "Feature", "id": f"ZZRF1-{cat}", "geometry": _geojson(ll),
                                           "properties": {"ahps_lid": "zzrf1", "magnitude": cat,
                                                          "stage": 17.0 if cat == "moderate" else 19.0}}])
    nfhl_feats = []
    for code, zone, subty, sfha_tf, bfe in ((3, "AE", "FLOODWAY", "T", 1491.0), (2, "AE", None, "T", 1492.4),
                                            (1, "X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", "F", -9999.0)):
        ll, _ = _mask_polygons(v, floodplain == code)
        if ll is not None:
            nfhl_feats.append({"type": "Feature", "id": f"nfhl-{code}", "geometry": _geojson(ll),
                               "properties": {"fld_zone": zone, "zone_subty": subty, "sfha": sfha_tf, "static_bfe": bfe}})
    maps["nfhl"] = _fc(nfhl_feats)
    nwm_ll, _ = _mask_polygons(v, nwm)
    nwm5_ll, _ = _mask_polygons(v, nwm5)
    nwm_ref, nwm_upd = now - 2 * HOUR_MS + 0, now - HOUR_MS
    model_fc = {"nwm_analysis": _fc([{"type": "Feature", "id": 1, "geometry": _geojson(nwm_ll),
                                      "properties": {"feature_id": 9900004, "streamflow_cfs": 6100.0}}]),
                "nwm_5day": _fc([{"type": "Feature", "id": 1, "geometry": _geojson(nwm5_ll),
                                  "properties": {"feature_id": 9900004, "streamflow_cfs": 6900.0}}])}
    hf_feats = []
    for r in range(FLOOD_REACHES):
        x0 = -FLOOD_EXTENT_M / 2 + r * FLOOD_EXTENT_M / FLOOD_REACHES
        sel = (v.line[:, 0] >= x0) & (v.line[:, 0] <= x0 + FLOOD_EXTENT_M / FLOOD_REACHES)
        pts = [v.render.local_to_lonlat(float(x), float(z)) for x, z in v.line[sel][::40]]
        if len(pts) < 2:
            continue
        recur = "10" if 2 <= r <= 5 else (">50" if r >= 6 else "20")
        hf_feats.append({"type": "Feature", "id": 9900001 + r, "geometry": _geojson(SLine(pts).simplify(0.0002)),
                         "properties": {"feature_id": 9900001 + r, "recur_cat": recur, "streamflow_cfs": 6000.0 - 250.0 * r,
                                        "high_water_threshold": 2400.0}})
    model_fc["nwm_high_flow"] = _fc(hf_feats)
    for name, f in maps.items():
        bundle.write_json(root / "maps" / f"{name}.geojson", f)
    bundle.write_json(root / "model" / "nwm_analysis.geojson", model_fc["nwm_analysis"])

    # NWM series (model output) for the gauges with a reach
    def nwm_series(g: dict) -> list[dict]:
        obs = np.array([r[2] for r in g["series"]["observed"]], dtype=float) * 1000.0
        t_obs = np.array([r[0] for r in g["series"]["observed"]], dtype=np.int64)
        ana_t = np.arange(now - 24 * HOUR_MS, now + 1, HOUR_MS)
        ana = np.interp(ana_t, t_obs, obs) * 0.93
        sr_ref = now - HOUR_MS
        sr_t = np.arange(sr_ref + HOUR_MS, sr_ref + 18 * HOUR_MS + 1, HOUR_MS)
        mr_ref = now - 6 * HOUR_MS
        mr_t = np.arange(mr_ref + HOUR_MS, mr_ref + 240 * HOUR_MS + 1, HOUR_MS)
        fc_rows = g["series"]["forecast"]
        ft = np.array([now] + [r[0] for r in fc_rows], dtype=np.int64)
        fq = np.array([obs[-1]] + [r[2] * 1000.0 for r in fc_rows], dtype=float)
        sr = np.interp(sr_t, ft, fq) * 1.08
        mr = np.interp(mr_t, ft, fq) * 1.12 * (1 + 0.05 * np.sin((mr_t - mr_ref) / (30 * HOUR_MS)))
        rows = lambda t, q: [[int(a), float(round(b, 1))] for a, b in zip(t, q)]  # noqa: E731
        return [{"name": "analysis_assimilation", "reference_ms": now - HOUR_MS, "unit": "ft3/s", "points": rows(ana_t, ana)},
                {"name": "short_range", "reference_ms": sr_ref, "unit": "ft3/s", "points": rows(sr_t, sr)},
                {"name": "medium_range_blend", "reference_ms": mr_ref, "unit": "ft3/s", "points": rows(mr_t, mr)}]

    model_series = {}
    for g in gauges:
        if g["reach_id"] and g["is_forecast_point"]:
            model_series[g["lid"]] = _model_answer("nwm_series", now, FLOOD_ID, series=nwm_series(g), reach_id=g["reach_id"],
                                                   lid=g["lid"], reference=now - 6 * HOUR_MS, updated=now - 5 * HOUR_MS)
            bundle.write_json(root / "model" / f"nwm_series_{g['lid']}.json", model_series[g["lid"]])

    # ---- satellite ---------------------------------------------------------------------------------------------
    acquired = now - 4 * 86_400_000 - 2 * HOUR_MS
    granule_id = f"SYNTHETIC_OPERA_L3_DSWx-HLS_T12SZZ_{ms_to_dt(acquired).strftime('%Y%m%dT%H%M%SZ')}_S2B_30_v1.1"
    bounds = [aoi_bbox[0], aoi_bbox[1], round(img_e, 5), aoi_bbox[3]]
    pw = 640
    ph = int(round(pw * (bounds[3] - bounds[1]) / ((bounds[2] - bounds[0]) * math.cos(math.radians(FLOOD_CENTER[1])))))
    plon = bounds[0] + (np.arange(pw) + 0.5) / pw * (bounds[2] - bounds[0])
    plat = bounds[3] - (np.arange(ph) + 0.5) / ph * (bounds[3] - bounds[1])
    LON, LAT = np.meshgrid(plon, plat)
    rr, cc = render.lonlat_to_rowcol(LON, LAT)
    rr = np.clip(np.floor(rr).astype(int), 0, render.height - 1)
    cc = np.clip(np.floor(cc).astype(int), 0, render.width - 1)
    png_cls = sat[rr, cc]
    png_cls = np.where(LON > img_e, 255, png_cls)
    sat_png = _png(_sat_palette_rgba(png_cls))
    (root / "satellite.png").write_bytes(sat_png)
    cell_km2 = res2 / 1e6
    n_cells = sat.size
    sat_stats = {"area_km2": round(n_cells * cell_km2, 3), "water_km2": round(float((sat == 1).sum()) * cell_km2, 3),
                 "partial_km2": round(float((sat == 2).sum()) * cell_km2, 3),
                 "cloud_pct": round(100.0 * float((sat == 253).sum()) / n_cells, 1),
                 "nodata_pct": round(100.0 * float((sat == 255).sum()) / n_cells, 1)}
    sat_when = _local_text(acquired, "%b %-d, %Y, %-I:%M %p %Z")
    satellite = {
        "kind": "satellite_water", "status": "available", "reason_code": None, "reason": None, "login": "not_configured",
        "login_note": fc.SAT_NOT_SET_UP, "measured": True,
        "granules": [{"id": granule_id, "product": "DSWx-HLS", "platform": "Sentinel-2B", "acquired_ms": acquired,
                      "produced_ms": acquired + 31 * HOUR_MS, "cloud_pct": sat_stats["cloud_pct"], "route": "earthdata_gis",
                      "url": None}],
        "image": {"url": f"/api/floods/{FLOOD_ID}/satellite.png?granule={granule_id}", "bounds_lonlat": bounds},
        "tiles": None, "stats": sat_stats, "source": _syn_source(fc.SOURCE_OPERA_HLS), "retrieved_ms": now - 60_000,
        "now_ms": now, "flood_id": FLOOD_ID, "synthetic": True, "caveats": [fc.sat_caveat(sat_when, sat_stats["cloud_pct"])],
    }

    # ---- summary, warnings.json, gauges.json, manifest ---------------------------------------------------------
    products = [product_ref(a) for a in current]
    summary = _summary(fid=FLOOD_ID, name="Ridge Fork River flood", kind="river", level="warning", emergency=False,
                       status="active", mode="live", year=ms_to_dt(flw_begin).year, started=flw_begin, basis="nws_product",
                       products=products, gauges=gauges, lon=g1["lon"], lat=g1["lat"], bbox=flood_bbox,
                       states=regions.states_in_bbox(tuple(flood_bbox)), now=now, bundle_status="ready", built=now)
    warnings_doc = _alerts_answer(alerts_all, zones_fc, now, FLOOD_ID, flood_bbox, summary["states"])
    gauges_doc = _gauges_answer(gauges, now, FLOOD_ID, flood_bbox, series=True)
    bundle.write_json(root / "warnings.json", warnings_doc)
    bundle.write_json(root / "gauges.json", gauges_doc)
    bundle.write_json(root / "satellite.json", satellite)
    eff = (_ms_date(NFHL_EFFECTIVE[0]), _ms_date(NFHL_EFFECTIVE[1]))

    def syn(credit: str) -> str:
        return f"Synthetic data for testing; not from: {credit}"

    layer_status = {
        "terrain": {"status": "ok", "reason": None, "source": "Synthetic terrain (procedural; not a real place's shape)", "time_ms": None},
        "naip": {"status": "ok", "reason": None, "source": "Synthetic aerial photo", "time_ms": None},
        "water_forecast": {"status": "ok", "reason": None, "source": syn(fc.CREDIT_NWC_EXPERIMENTAL), "time_ms": rfc_ref},
        "floodplain": {"status": "ok", "reason": None, "source": syn(fc.CREDIT_NFHL), "time_ms": eff[1]},
        "water_satellite": {"status": "ok", "reason": fc.SAT_NOT_SET_UP, "source": syn(fc.CREDIT_OPERA_HLS), "time_ms": acquired},
        "water_model": {"status": "ok", "reason": None, "source": syn(fc.CREDIT_NWM), "time_ms": nwm_ref},
        "warnings": {"status": "ok", "reason": None, "source": syn(fc.CREDIT_NWS), "time_ms": max(a["sent_ms"] for a in current)},
        "gauges": {"status": "ok", "reason": None, "source": syn(fc.CREDIT_NWPS), "time_ms": g1["observed"]["valid_ms"]},
    }
    t_start, t_end = now - 72 * HOUR_MS, now + 120 * HOUR_MS
    manifest = {
        "schema_version": 1, "id": FLOOD_ID, "hazard": "flood", "name": summary["name"], "mode": "live", "status": "ready",
        "summary": summary, "time_origin_ms": t_start, "time_range": {"start_ms": t_start, "end_ms": t_end, "now_ms": now},
        "grid": manifest_grid(render, render, float(v.dem.min()), float(v.dem.max())), "aoi_note": None,
        "layers": layers, "layer_status": layer_status,
        "files": {"warnings": "warnings.json", "gauges": "gauges.json", "satellite": "satellite.json",
                  "satellite_image": "satellite.png",
                  "maps": {k: f"maps/{k}.geojson" for k in maps},
                  "model": {"nwm_analysis": "model/nwm_analysis.geojson",
                            **{f"nwm_series_{lid}": f"model/nwm_series_{lid}.json" for lid in model_series}}},
        "data_sources": [{"name": "Synthetic fixture", "detail": "fixture-flood: procedural valley, synthetic NWS-style "
                          "products (fictional office KZZZ), gauges, maps, satellite water and model output", "fetched_ms": now}],
        "warnings": ["Simulated data for testing: not a real flood, NWS product or gauge reading."],
        "built_ms": now,
    }

    # ---- the seven list-only demo floods (C26) -----------------------------------------------------------------
    demo = demo_floods(now, rng)

    # ---- canned answers ----------------------------------------------------------------------------------------
    def put(name: str, model: type, obj: dict) -> None:
        C.validate_strict(model, obj)
        bundle.write_json(api / name, obj)

    live_rows = sort_floods([summary] + [d["summary"] for d in demo if d["summary"]["mode"] == "live"])
    sources_ok = [
        {"id": "nws_alerts", "name": "National Weather Service", "status": "available", "retrieved_ms": now - 60_000,
         "reason": None, "stale": False},
        {"id": "nwps_gauges", "name": "NOAA National Water Prediction Service (NWS)", "status": "available",
         "retrieved_ms": now - 60_000, "reason": None, "stale": False},
        {"id": "rfc_forecasts", "name": "NWS River Forecast Centers", "status": "available", "retrieved_ms": now - 60_000,
         "reason": None, "stale": False},
    ]
    n_products = sum(len(r["products"]) for r in live_rows)
    flood_list = {"hazard": "flood", "mode": "live", "updated_ms": now, "floods": live_rows, "sources": sources_ok,
                  "products_in_effect": n_products}
    put("list.json", C.FloodListResponse, flood_list)
    past_rows = [d["summary"] for d in demo if d["summary"]["mode"] == "historical"]
    iem_src = {"id": "iem_archive", "name": "Iowa Environmental Mesonet (archived NWS products)", "status": "available",
               "retrieved_ms": now - 3600_000, "reason": None, "stale": False}
    for y in sorted({r["year"] for r in past_rows} | {year}):
        rows = sort_floods([r for r in past_rows if r["year"] == y])
        put(f"list-{y}.json", C.FloodListResponse,
            {"hazard": "flood", "mode": "historical", "updated_ms": now, "year": y, "past_rule": "fallback",
             "preparing": False, "floods": rows, "sources": [iem_src], "products_in_effect": None})
    put("status.json", C.FloodLiveStatus, {"last_refresh_ms": now - 5 * 60_000, "next_refresh_ms": now + 10 * 60_000,
                                          "active_floods": sum(1 for r in live_rows if r["status"] == "active"),
                                          "gauges_in_flood": sum(r["gauges_in_flood"] for r in live_rows), "auto_build": False})
    put("detail.json", C.FloodDetailResponse, {"summary": summary, "manifest": manifest, "job": None, "resolved_from": "live"})
    C.validate_strict(C.FloodManifest, manifest)
    bundle.write_json(root / "manifest.json", manifest)
    put("flood-alerts.json", C.FloodAlertsResponse, _alerts_answer(current, zones_fc, now, FLOOD_ID, flood_bbox, summary["states"]))
    put("river-gauges.json", C.RiverGaugesResponse, _gauges_answer(gauges, now, FLOOD_ID, flood_bbox, series=False))
    for g in gauges:
        put(f"river-gauges-{g['lid']}.json", C.RiverGaugesResponse,
            _gauges_answer([g], now, FLOOD_ID, [g["lon"], g["lat"], g["lon"], g["lat"]], series=True))
    national = [g for g in gauges if g["observed"]["category"] in ("action", "minor", "moderate", "major")]
    national += [g for d in demo if d["summary"]["mode"] == "live" for g in d["gauges"]
                 if g["observed"]["category"] in ("action", "minor", "moderate", "major")]
    put("river-gauges-national.json", C.RiverGaugesResponse,
        _gauges_answer([{**g, "member": False} for g in national], now, None, None, series=False))
    put("maps-rfc_fim.json", C.FloodMapResponse, _map_answer("rfc_fim", maps["rfc_fim"], now, FLOOD_ID, reference=rfc_ref,
                                                              updated=rfc_upd, stats=fim_area))
    for cat in ("moderate", "major"):
        ans = _map_answer("catfim", maps[f"catfim_ZZRF1_{cat}"], now, FLOOD_ID, reference=None, updated=_ms_date("2025-06-01"),
                          stats=None, category=cat)
        put(f"maps-catfim-ZZRF1-{cat}.json", C.FloodMapResponse, ans)
        if cat == "moderate":
            put("maps-catfim.json", C.FloodMapResponse, ans)
    put("maps-nfhl.json", C.FloodMapResponse, _map_answer("nfhl", maps["nfhl"], now, FLOOD_ID, reference=None, updated=eff[1],
                                                          stats=None, availability="mapped", eff=eff))
    put("model-nwm_analysis.json", C.ModelOutputResponse,
        _model_answer("nwm_analysis", now, FLOOD_ID, features=model_fc["nwm_analysis"], reference=nwm_ref, updated=nwm_upd))
    put("model-nwm_5day.json", C.ModelOutputResponse,
        _model_answer("nwm_5day", now, FLOOD_ID, features=model_fc["nwm_5day"], reference=now - 8 * HOUR_MS,
                      updated=now - 2 * HOUR_MS))
    put("model-nwm_high_flow.json", C.ModelOutputResponse,
        _model_answer("nwm_high_flow", now, FLOOD_ID, features=model_fc["nwm_high_flow"], reference=nwm_ref, updated=nwm_upd))
    for lid, ans in model_series.items():
        put(f"model-nwm_series-{lid}.json", C.ModelOutputResponse, ans)
    for g in gauges:
        if g["lid"] not in model_series:
            put(f"model-nwm_series-{g['lid']}.json", C.ModelOutputResponse,
                _model_answer("nwm_series", now, FLOOD_ID, lid=g["lid"], reach_id=g["reach_id"], status="unavailable",
                              reason="This gauge has no National Water Model series here." if g["reach_id"] is None
                              else "No National Water Model series for this gauge in the fixture."))
    put("satellite.json", C.SatelliteWaterResponse, satellite)
    (api / "satellite.png").write_bytes(sat_png)
    for d in demo:
        did = d["summary"]["id"]
        put(f"detail-{did}.json", C.FloodDetailResponse,
            {"summary": d["summary"], "manifest": None, "job": None,
             "resolved_from": "year" if d["summary"]["mode"] == "historical" else "live"})
        put(f"flood-alerts-{did}.json", C.FloodAlertsResponse, d["alerts_answer"])
        put(f"river-gauges-{did}.json", C.RiverGaugesResponse, d["gauges_answer"])
        for kind, ans in d["maps"].items():
            put(f"maps-{kind}-{did}.json", C.FloodMapResponse, ans)
    job0 = {"id": "fixture-flood-build-job", "kind": "build", "incident_id": "fixture-flood-<kind>", "status": "queued",
            "progress": 0.0, "step": "queued", "message": "Queued (fixture server: a canned build job)", "created_ms": now,
            "started_ms": None, "finished_ms": None, "error": None, "result": None}
    jobs = [job0, {**job0, "status": "running", "progress": 0.45, "step": "terrain", "message": "Terrain (canned)",
                   "started_ms": now + 1000},
            {**job0, "status": "done", "progress": 1.0, "step": "finish", "message": "Done (canned; no bundle is written)",
             "started_ms": now + 1000, "finished_ms": now + 6000}]
    for j in jobs:
        C.validate_strict(C.JobStatus, j)
    bundle.write_json(api / "build-job.json", jobs)
    write_flood_edges(api / "edge", now, flood_bbox, summary, flood_list, satellite)
    write_flood_extras(api, now, flood_bbox)
    if copy_api is not None:
        dst = Path(copy_api)
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(api, dst)
    print(f"[{FLOOD_ID}] written in {time.time() - t0:.1f} s: {root}", flush=True)
    return root


def demo_floods(now: int, rng: np.random.Generator) -> list[dict]:
    """The seven list-only demo floods ``fixture-flood-<kind>`` (fictional names, issuer and gauges; C4, C26). Each:
    ``summary``, ``gauges`` (RiverGauge dicts), ``alerts_answer``, ``gauges_answer`` and ``maps`` (rfc_fim, nfhl,
    catfim answers)."""
    from shapely.geometry import Point, mapping
    from shapely.geometry import shape as sshape

    from fire3d import regions

    fc = _flood_copy()
    out = []

    def finish(fid, name, kind, level, alerts, gauges, *, emergency=False, mode="live", status="active", started=None,
               rivers=None, caveat=None, zones=None, fim_empty=False, ended=None, at_ms=None):
        geoms = [sshape(a["geometry"]) for a in alerts if a.get("geometry")]
        zone_geoms = [sshape(f["geometry"]) for f in (zones or {}).get("features", [])]
        pts = [Point(g["lon"], g["lat"]) for g in gauges if g["member"]]
        bbox = _bbox_of([g for g in geoms if g is not None] + zone_geoms + pts, pad_deg=0.01)
        lon, lat = None, None
        members = [g for g in gauges if g["member"]]
        if members:
            lon, lat = members[0]["lon"], members[0]["lat"]
        else:
            big = max([g for g in geoms if g is not None] + zone_geoms, key=lambda g: g.area)
            rp = big.representative_point()
            lon, lat = round(rp.x, 5), round(rp.y, 5)
        for a in alerts:
            a["flood_ids"] = [fid]
            a["time_zone"] = _place(lon, lat)["time_zone"]
        products = [product_ref(a) for a in alerts]
        yr = ms_to_dt(started).year
        s = _summary(fid=fid, name=name, kind=kind, level=level, emergency=emergency, status=status, mode=mode, year=yr,
                     started=started, basis="nws_product" if alerts else "first_seen", products=products, gauges=gauges,
                     lon=lon, lat=lat, bbox=bbox, states=regions.states_in_bbox(tuple(bbox)), now=now, ended=ended,
                     caveat=caveat, rivers=rivers)
        archived = mode == "historical"
        src_states = s["states"]
        alerts_answer = _alerts_answer(alerts, zones or _fc([]), now, fid, bbox, src_states, archived=archived, at_ms=at_ms)
        gcav = [fc.GAUGE_NOT_ALL_CLEAR] + ([fc.THRESHOLDS_TODAY, fc.PAST_NO_FORECAST] if archived else [])
        gauges_answer = _gauges_answer(gauges, now, fid, bbox, series=False, caveats=gcav, at_ms=at_ms)
        if archived:
            rfc = _map_answer("rfc_fim", _fc([]), now, fid, reference=None, updated=None, stats=None,
                              status="not_available_for_past_dates", reason_code="past_date",
                              reason="NWS forecast flooded-area maps hold the current forecast only; they are not "
                                     "available for past dates.")
        elif fim_empty or not members:
            rfc = _map_answer("rfc_fim", _fc([]), now, fid, reference=now - 2 * HOUR_MS, updated=now - 90 * 60_000, stats=None)
        else:
            m = members[0]
            poly = _round_geom(Point(m["lon"], m["lat"]).buffer(0.012).simplify(0.002))
            rfc = _map_answer("rfc_fim", _fc([{"type": "Feature", "id": 9800001, "geometry": mapping(poly),
                                               "properties": {"feature_id": 9800001, "streamflow_cfs": 12000.0}}]),
                              now, fid, reference=now - 2 * HOUR_MS, updated=now - 90 * 60_000, stats=round(poly.area * 9.5e3, 3))
        nfhl = _map_answer("nfhl", _fc([]), now, fid, reference=None, updated=None, stats=None, availability="unknown",
                           eff=None)
        if members:
            cat = (members[0].get("forecast") or {}).get("category") or members[0]["observed"]["category"]
            cat = cat if cat in ("action", "minor", "moderate", "major") else "minor"
            catfim = _map_answer("catfim", _fc([]), now, fid, reference=None, updated=_ms_date("2025-06-01"), stats=None,
                                 category=cat, caveats=["The fixture server has no category map for this demo gauge."])
        else:
            catfim = _map_answer("catfim", _fc([]), now, fid, reference=None, updated=None, stats=None, category=None,
                                 status="unavailable", reason_code="not_covered",
                                 reason="This flood has no NWS forecast gauge, so no category flood map applies.")
        out.append({"summary": s, "gauges": gauges, "alerts_answer": alerts_answer, "gauges_answer": gauges_answer,
                    "maps": {"rfc_fim": rfc, "nfhl": nfhl, "catfim": catfim}})

    def poly_alert(**kw):
        lon, lat, dx, dy, rot = kw.pop("box")
        g = _rect(lon, lat, dx, dy, rot)
        return syn_alert(**kw, geometry=mapping(g))

    # 1. Flash Flood Emergency (no member gauge; a below-stage gauge 6 km away on another stream)
    t = now - 2 * HOUR_MS
    a = poly_alert(aid="urn:oid:synthetic.fixture-flood-flash.ffw.1", event="Flash Flood Warning", ph="FF", sig="W", etn=41,
                   action="NEW", year=ms_to_dt(t).year, sent=t, onset=t, ends=now + 3 * HOUR_MS,
                   headline=f"Flash Flood Warning issued by {SYN_SENDER}",
                   description="FLASH FLOOD EMERGENCY FOR EXAMPLE CREEK (FICTIONAL)...\n\n"
                               "* WHAT...Flash flooding caused by excessive rainfall is occurring.\n\n"
                               "* WHERE...Example Creek, Mock Hollow and Sample Flats (fictional places).\n\n"
                               "Some locations that will experience flash flooding include...\n"
                               "Example Creek, Mock Hollow and Sample Flats.",
                   instruction="Move to higher ground now. Act quickly to protect your life.\n\n"
                               "[SYNTHETIC] This text is test data for Fire-3d, not an instruction from any office.",
                   area_desc="Kerr, TX", ugcs=["TXC265"], flood_ids=[], emergency=True, damage="CATASTROPHIC",
                   detection="OBSERVED", box=(-99.30, 30.06, 0.06, 0.04, -12.0))
    far = _simple_gauge("ZZEC1", "Sample Brook at Mock Ford", "Sample Brook", -99.30 + 0.0626, 30.06, {"action": 9.0, "minor": 12.0,
                        "moderate": 15.0, "major": 18.0}, 4.1, now, member=False, fc=None, rng=rng, tz="America/Chicago")
    finish("fixture-flood-flash", "Example Creek flash flood", "flash", "warning", [a], [far], emergency=True,
           started=t, rivers=[], fim_empty=True)
    # 2. Major river flood
    g = _simple_gauge("ZZSR1", "Sample River at Demo Landing", "Sample River", -93.21, 39.52,
                      {"action": 14.0, "minor": 16.0, "moderate": 20.0, "major": 24.0}, 24.6, now, member=True,
                      fc=(25.3, 18), rng=rng, tz="America/Chicago")
    t = now - 40 * HOUR_MS
    a = poly_alert(aid="urn:oid:synthetic.fixture-flood-major.flw.1", event="Flood Warning", ph="FL", sig="W", etn=88,
                   action="CON", year=ms_to_dt(t).year, sent=now - 4 * HOUR_MS, onset=t, ends=now + 36 * HOUR_MS,
                   headline=f"Flood Warning issued by {SYN_SENDER}",
                   description="* WHAT...Major flooding is occurring and major flooding is forecast.\n\n"
                               "* WHERE...Sample River at Demo Landing (fictional).",
                   instruction=None, area_desc="Carroll, MO", ugcs=["MOC033"], flood_ids=[],
                   hvtec={"nwsli": "ZZSR1", "severity": "3", "cause": "ER", "begin_ms": t, "crest_ms": now + 18 * HOUR_MS,
                          "end_ms": None, "record": "NO"}, box=(-93.21, 39.52, 0.08, 0.025, 25.0))
    finish("fixture-flood-major", "Sample River flood", "river", "warning", [a], [g], started=t)
    # 3. Moderate river flood
    g = _simple_gauge("ZZDF1", "Demo Fork near Testville", "Demo Fork", -91.62, 41.93,
                      {"action": 11.0, "minor": 13.0, "moderate": 15.0, "major": 18.0}, 15.4, now, member=True,
                      fc=(15.9, 12), rng=rng, tz="America/Chicago")
    t = now - 26 * HOUR_MS
    a = poly_alert(aid="urn:oid:synthetic.fixture-flood-moderate.flw.1", event="Flood Warning", ph="FL", sig="W", etn=23,
                   action="EXT", year=ms_to_dt(t).year, sent=now - 5 * HOUR_MS, onset=t, ends=now + 20 * HOUR_MS,
                   headline=f"Flood Warning issued by {SYN_SENDER}",
                   description="* WHAT...Moderate flooding is occurring.\n\n* WHERE...Demo Fork near Testville (fictional).",
                   instruction=None, area_desc="Linn, IA", ugcs=["IAC113"], flood_ids=[],
                   hvtec={"nwsli": "ZZDF1", "severity": "2", "cause": "ER", "begin_ms": t, "crest_ms": now + 12 * HOUR_MS,
                          "end_ms": now + 60 * HOUR_MS, "record": "NO"}, box=(-91.62, 41.93, 0.07, 0.02, -30.0))
    finish("fixture-flood-moderate", "Demo Fork flood", "river", "warning", [a], [g], started=t)
    # 4. Gauge only (minor, no NWS product)
    g = _simple_gauge("ZZTC1", "Testbed Creek at Example Park", "Testbed Creek", -81.86, 27.24,
                      {"action": 9.0, "minor": 11.0, "moderate": 14.0, "major": 16.0}, 11.6, now, member=True,
                      fc=None, rng=rng, tz="America/New_York")
    finish("fixture-flood-minor", "Testbed Creek flood", "river", "gauge_only", [], [g], started=now - 14 * HOUR_MS,
           caveat=fc.GAUGE_ONLY_CAVEAT)
    # 5. Advisory only (areal)
    t = now - HOUR_MS
    a = poly_alert(aid="urn:oid:synthetic.fixture-flood-advisory.fay.1", event="Flood Advisory", ph="FA", sig="Y", etn=12,
                   action="NEW", year=ms_to_dt(t).year, sent=t, onset=t, ends=now + 2 * HOUR_MS,
                   headline=f"Flood Advisory issued by {SYN_SENDER}",
                   description="* WHAT...Urban and small stream flooding caused by excessive rainfall is expected.\n\n"
                               "* WHERE...Flooding along the Mockingbird Run (fictional).",
                   instruction=None, area_desc="Maricopa, AZ", ugcs=["AZC013"], flood_ids=[],
                   box=(-111.94, 33.46, 0.05, 0.035, 8.0))
    finish("fixture-flood-advisory", "Mockingbird Run flood", "areal", "advisory", [a], [], started=t, rivers=[])
    # 6. Watch only (zone-based, SAME counties, no gauge)
    zones = {"COZ991": ("Example Valley", (-105.62, 39.12)), "COZ992": ("Sample Foothills", (-105.46, 39.30)),
             "COZ993": ("Demo Plains", (-105.30, 39.06))}
    t = now - 6 * HOUR_MS
    wa = syn_alert(aid="urn:oid:synthetic.fixture-flood-watch.faa.1", event="Flood Watch", ph="FA", sig="A", etn=9,
                   action="NEW", year=ms_to_dt(t).year, sent=t, onset=now + 4 * HOUR_MS, ends=now + 40 * HOUR_MS,
                   headline=f"Flood Watch issued by {SYN_SENDER}",
                   description="* WHAT...Flooding caused by excessive rainfall is possible.\n\n"
                               "* WHERE...Example Valley, Sample Foothills and Demo Plains (fictional zones).",
                   instruction="You should monitor later forecasts and be prepared to take action should Flood "
                               "Warnings be issued.", area_desc="Example Valley; Sample Foothills; Demo Plains",
                   ugcs=list(zones), geometry=None, flood_ids=[], phase="upcoming")
    zfc = _fc([{"type": "Feature", "id": u, "geometry": _geojson(_rect(c[0], c[1], 0.09, 0.07)),
                "properties": {"ugc": u, "name": n, "alert_ids": [wa["id"]]}} for u, (n, c) in zones.items()])
    finish("fixture-flood-watch", "Flood watch: Example Valley and 2 more areas", "areal", "watch", [wa], [], started=t,
           rivers=[], zones=zfc)
    # 7. A past flood (2025, archived products, inactive)
    p0 = _iso_ms("2025-04-06T09:00:00Z")
    g = _simple_gauge("ZZPR1", "Placeholder River at Sample Mills", "Placeholder River", -83.31, 37.58,
                      {"action": 16.0, "minor": 20.0, "moderate": 25.0, "major": 30.0}, 31.2, now, member=True, fc=None,
                      rng=rng, tz="America/New_York", past_ms=p0 + 30 * HOUR_MS)
    a = poly_alert(aid="2025-KZZZ-FL-W-0031", event="Flood Warning", ph="FL", sig="W", etn=31, action="EXP", year=2025,
                   sent=p0 + 60 * HOUR_MS, onset=p0, ends=p0 + 66 * HOUR_MS, headline=f"Flood Warning issued by {SYN_SENDER}",
                   description="* WHAT...Major flooding occurred.\n\n* WHERE...Placeholder River at Sample Mills (fictional).",
                   instruction=None, area_desc="Breathitt, KY", ugcs=["KYC025"], flood_ids=[], phase="ended", archived=True,
                   hvtec={"nwsli": "ZZPR1", "severity": "3", "cause": "ER", "begin_ms": p0, "crest_ms": p0 + 30 * HOUR_MS,
                          "end_ms": p0 + 64 * HOUR_MS, "record": "NR"}, box=(-83.31, 37.58, 0.07, 0.02, 40.0))
    finish("fixture-flood-past", "Placeholder River flood", "river", "warning", [a], [g], mode="historical",
           status="inactive", started=p0, ended=p0 + 66 * HOUR_MS, at_ms=p0 + 30 * HOUR_MS)
    return out


def write_flood_edges(edge: Path, now: int, bbox: list[float], summary: dict, flood_list: dict, satellite: dict) -> None:
    """``api/edge/``: each official layer ``unavailable`` (C3), plus list and satellite variants the web's edge cases
    use (NWS down, gauges down, both down, empty list, login refused, picture only)."""
    from fire3d import contracts as C

    fc = _flood_copy()

    def put(name: str, model: type, obj: dict) -> None:
        C.validate_strict(model, obj)
        bundle.write_json(edge / name, obj)

    put("alerts-unavailable.json", C.FloodAlertsResponse,
        {**_envelope("flood_alerts", fc.SOURCE_NWS, now, FLOOD_ID, status="unavailable", reason_code="upstream_error",
                     reason=fc.ALERTS_UNAVAILABLE), "alerts": [], "zones": _fc([]), "area_bbox": bbox, "states_checked": []})
    put("gauges-unavailable.json", C.RiverGaugesResponse,
        _gauges_answer([], now, FLOOD_ID, bbox, series=False, status="unavailable", reason_code="upstream_error",
                       reason=fc.GAUGES_UNAVAILABLE, caveats=[]) | {"retrieved_ms": None})
    for kind, text in (("rfc_fim", fc.RFC_FIM_UNAVAILABLE), ("catfim", fc.CATFIM_UNAVAILABLE), ("nfhl", fc.NFHL_DOWN)):
        ans = _map_answer(kind, _fc([]), now, FLOOD_ID, reference=None, updated=None, stats=None,
                          category="moderate" if kind == "catfim" else None,
                          availability="unknown" if kind == "nfhl" else None, status="unavailable",
                          reason_code="upstream_error", reason=text)
        ans["retrieved_ms"] = None
        put(f"{kind}-unavailable.json", C.FloodMapResponse, ans)
    put("satellite-unavailable.json", C.SatelliteWaterResponse,
        {**satellite, "status": "unavailable", "reason_code": "upstream_error", "reason": fc.SAT_UNAVAILABLE,
         "measured": False, "granules": [], "image": None, "tiles": None, "stats": None, "retrieved_ms": None,
         "caveats": []})
    put("satellite-refused.json", C.SatelliteWaterResponse,
        {**satellite, "login": "refused", "login_note": fc.SAT_LOGIN_REFUSED})
    put("satellite-picture.json", C.SatelliteWaterResponse,
        {**satellite, "measured": False, "image": None, "stats": None,
         "granules": [{**satellite["granules"][0], "route": "gibs", "cloud_pct": None}],
         "tiles": {"url_template": "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
                                   "OPERA_L3_Dynamic_Surface_Water_Extent-HLS/default/{date}/GoogleMapsCompatible_Level12/"
                                   "{z}/{y}/{x}.png", "date": ms_to_dt(satellite["granules"][0]["acquired_ms"]).strftime("%Y-%m-%d"),
                   "max_zoom": 12}})
    put("model-unavailable.json", C.ModelOutputResponse,
        _model_answer("nwm_analysis", now, FLOOD_ID, status="unavailable",
                      reason="National Water Model output could not be loaded right now.") | {"retrieved_ms": None})
    srcs = flood_list["sources"]

    def down(ids: set[str], reasons: dict[str, str]) -> list[dict]:
        return [{**s, "status": "unavailable", "retrieved_ms": None, "reason": reasons.get(s["id"])} if s["id"] in ids else s
                for s in srcs]

    gauge_rows = [r for r in flood_list["floods"] if r["gauges_in_flood"] > 0 and r["kind"] == "river"]
    product_rows = [r for r in flood_list["floods"] if r["products"]]
    put("list-nws-down.json", C.FloodListResponse,
        {**flood_list, "floods": gauge_rows, "products_in_effect": None,
         "sources": down({"nws_alerts"}, {"nws_alerts": fc.FLOOD_NWS_DOWN})})
    put("list-gauges-down.json", C.FloodListResponse,
        {**flood_list, "floods": product_rows,
         "sources": down({"nwps_gauges", "rfc_forecasts"}, {"nwps_gauges": fc.FLOOD_GAUGES_DOWN,
                                                           "rfc_forecasts": fc.FLOOD_GAUGES_DOWN})})
    put("list-both-down.json", C.FloodListResponse,
        {**flood_list, "floods": [r for r in flood_list["floods"] if r["id"] == FLOOD_ID], "products_in_effect": None,
         "sources": down({"nws_alerts", "nwps_gauges", "rfc_forecasts"},
                         {k: fc.FLOOD_LISTS_DOWN for k in ("nws_alerts", "nwps_gauges", "rfc_forecasts")})})
    put("list-empty.json", C.FloodListResponse, {**flood_list, "floods": [], "products_in_effect": 0})
    put("detail-last-known.json", C.FloodDetailResponse,
        {"summary": {**summary, "status": "inactive", "bundle_status": "none", "bundle_built_ms": None},
         "manifest": None, "job": None, "resolved_from": "last_known"})


def write_flood_extras(api: Path, now: int, bbox: list[float]) -> None:
    """Canned ``/api/official/local-alerts?hazard=flood`` and ``/api/extras/evacuations?hazard=flood`` answers for the
    fixture's area (no request is made: New Mexico has no evacuation feed, and the fixture server never asks NWS)."""
    from fire3d import contracts as C
    from fire3d.api import extras

    local = {"kind": "local_alerts", "status": "unavailable", "reason_code": "upstream_error",
             "reason": "Fixture server: local officials' messages are not fetched for this demo flood. Follow local officials.",
             "source": {"name": "National Weather Service", "url": "https://www.weather.gov/",
                        "credit": "Synthetic data for testing; not from: National Weather Service"},
             "retrieved_ms": None, "source_updated_ms": None, "requested_at_ms": None, "now_ms": now, "incident_id": None,
             "caveats": [], "alerts": [], "channels": [
                 {"id": "nws_api", "status": "not_checked", "retrieved_ms": None, "source_updated_ms": None, "reason": None},
                 {"id": "openfema_archive", "status": "not_checked", "retrieved_ms": None, "source_updated_ms": None,
                  "reason": None}],
             "area_bbox": bbox, "reported_location": None, "counties": []}
    C.validate_strict(C.LocalAlertsResponse, local)
    bundle.write_json(api / "local-alerts.json", local)
    evac = extras.evacuations_payload(extras.AreaContext(tuple(bbox), None, now, None, "live"))
    bundle.write_json(api / "evacuations.json", evac)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data-dir", type=Path, default=None, help="data dir (default: FIRE3D_DATA_DIR or <repo>/data)")
    ap.add_argument("--only", choices=("demo", "live", "east", "flood"), default=None,
                    help="one fixture; the default run writes demo + live + flood (east only with --only east)")
    ap.add_argument("--members", type=int, default=31)
    ap.add_argument("--quicklook", type=Path, default=None, help="also write quick-look PNGs to this directory")
    ap.add_argument("--now", default=None, help="flood fixture: the time it is relative to (ISO 8601, e.g. "
                                                "2026-11-04T18:00:00Z); default: now, rounded down to 15 min")
    ap.add_argument("--copy-api", type=Path, default=None, help="flood fixture: also copy its canned answers (api/) "
                                                                "here, e.g. tests/data/floods/fixture_api")
    args = ap.parse_args(argv)
    data_dir = (args.data_dir or config.DATA_DIR).resolve()
    scenarios = []
    if args.only in (None, "demo"):
        scenarios.append(demo_scenario())
    if args.only in (None, "live"):
        scenarios.append(live_scenario())
    if args.only == "east":
        scenarios.append(east_scenario())
    for sc in scenarios:
        build_fixture(sc, data_dir, args.members, args.quicklook)
    if scenarios:
        print(f"fixtures written to {data_dir / 'incidents'} and validated against fire3d.contracts")
    if args.only in (None, "flood"):
        build_flood_fixture(data_dir, _iso_ms(args.now) if args.now else None, copy_api=args.copy_api)
        print(f"flood fixture written to {data_dir / 'floods'} and validated against fire3d.contracts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
