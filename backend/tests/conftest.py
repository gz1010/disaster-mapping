"""Shared pytest fixtures. Tests are offline and fast (SPEC 10).

* ``fire3d.http`` is blocked from reaching the network in every test (autouse ``_offline_http``); install your
  own ``httpx.MockTransport`` via ``monkeypatch.setattr(fire3d.http, "_transport", ...)`` or mark a test
  ``@pytest.mark.network`` to opt out.
* ``tmp_data_dir`` points DATA_DIR / INCIDENTS_DIR / CACHE_DIR at a temp dir.
* ``fixture_bundle`` / ``fixture_live_bundle`` are the synthetic bundles from ``scripts/make_fixture.py``
  (read-only; skipped when missing).
* Floods (brief 5, PLAN-5 7.1, C25): ``flood_fixture_data`` is a session-scoped data dir in which
  ``scripts/make_fixture.py``'s flood builder wrote ``floods/fixture-flood`` at :data:`FLOOD_FIXTURE_NOW_MS`
  (2026-11-04T18:00:00Z), with the network refused while it runs; ``flood_fixture_bundle`` is that bundle folder.
  Flood tests never depend on the gitignored ``data/`` and never skip.
"""

from __future__ import annotations

import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType

import httpx
import pytest

import fire3d.http as fhttp
from fire3d import config as f3config
from fire3d.grid import Grid, make_aoi

FIXTURE_ROOT = f3config.REPO_ROOT / "data" / "incidents"


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "network: test may use the real network through fire3d.http")


def _refuse(request: httpx.Request) -> httpx.Response:
    raise RuntimeError(f"network access in tests is not allowed: {f3config.mask_secrets(str(request.url))}")


@pytest.fixture(autouse=True)
def _offline_http(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    if request.node.get_closest_marker("network") is None:
        monkeypatch.setattr(fhttp, "_transport", httpx.MockTransport(_refuse))
    fhttp.reset_down_memos()        # a failure remembered by one test never leaks into the next


@pytest.fixture
def tmp_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Temp DATA_DIR (with ``incidents/``) and CACHE_DIR for one test."""
    data = tmp_path / "data"
    (data / "incidents").mkdir(parents=True)
    monkeypatch.setattr(f3config, "DATA_DIR", data)
    monkeypatch.setattr(f3config, "INCIDENTS_DIR", data / "incidents")
    monkeypatch.setattr(f3config, "FLOODS_DIR", data / "floods")
    monkeypatch.setattr(f3config, "CACHE_DIR", data / "cache")
    monkeypatch.setenv("FIRE3D_DATA_DIR", str(data))
    monkeypatch.setenv("FIRE3D_CACHE_DIR", str(data / "cache"))
    return data


def _bundle_or_skip(name: str) -> Path:
    p = FIXTURE_ROOT / name
    if not (p / "manifest.json").is_file():
        pytest.skip(f"{name} missing: run `uv run python scripts/make_fixture.py`")
    return p


@pytest.fixture
def fixture_bundle() -> Path:
    """data/incidents/fixture-demo (historical synthetic bundle)."""
    return _bundle_or_skip("fixture-demo")


@pytest.fixture
def fixture_live_bundle() -> Path:
    """data/incidents/fixture-live (live synthetic bundle)."""
    return _bundle_or_skip("fixture-live")


@pytest.fixture
def demo_grids() -> tuple[Grid, Grid]:
    """(render, fire) grids of a 12 km historical AOI near Altadena (EPSG:32611)."""
    return make_aoi(-118.07, 34.20, (-118.10, 34.18, -118.04, 34.22), "historical")


# ------------------------------------------------------------------------------------------------------------------
# Floods (brief 5): the synthetic fixture-flood, generated into a temp dir once per session (C25)
# ------------------------------------------------------------------------------------------------------------------
FLOOD_FIXTURE_NOW_MS = int(datetime(2026, 11, 4, 18, 0, tzinfo=timezone.utc).timestamp() * 1000)
SCRIPTS_DIR = f3config.REPO_ROOT / "backend" / "scripts"


def load_script(name: str) -> ModuleType:
    """Import ``backend/scripts/<name>.py`` as a module (scripts are not a package); one module per script, kept in
    ``sys.modules`` (dataclasses need it there)."""
    import sys

    mod_name = f"{name}_under_test"
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    spec = importlib.util.spec_from_file_location(mod_name, SCRIPTS_DIR / f"{name}.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    try:
        spec.loader.exec_module(mod)
    except BaseException:
        sys.modules.pop(mod_name, None)
        raise
    return mod


@pytest.fixture(scope="session")
def flood_fixture_data(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A data dir holding ``floods/fixture-flood`` generated at FLOOD_FIXTURE_NOW_MS (read-only for tests)."""
    root = tmp_path_factory.mktemp("flood-fixture-data")
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(fhttp, "_transport", httpx.MockTransport(_refuse))
        load_script("make_fixture").build_flood_fixture(root, FLOOD_FIXTURE_NOW_MS)
    return root


@pytest.fixture(scope="session")
def flood_fixture_bundle(flood_fixture_data: Path) -> Path:
    """``<flood_fixture_data>/floods/fixture-flood``."""
    return flood_fixture_data / "floods" / "fixture-flood"


FLOOD_SAMPLES = f3config.REPO_ROOT / "backend" / "tests" / "data" / "floods"


def recorded_flood_inputs():
    """``floods.catalog.Inputs`` from the recorded samples of 2026-11-04 (``tests/data/floods/{nws,nwps}``), and the
    NWS ``updated`` time of that answer (the "now" of the recording)."""
    import orjson

    from fire3d.floods import catalog as cat
    from fire3d.sources import nwps, nws

    fl = orjson.loads((FLOOD_SAMPLES / "nws" / "nws_flood_active.json").read_bytes())
    now = nws._ms(fl["updated"])
    alerts = [a for a in (nws.normalize_flood_alert(f) for f in fl["features"]) if a]

    def rows(name: str, parse):
        doc = orjson.loads((FLOOD_SAMPLES / "nwps" / name).read_bytes())
        return [r for r in (parse(f) for f in doc["features"]) if r]

    inp = cat.Inputs(
        alerts=cat.SourceResult(nws.FloodNational(alerts, now, now, list(nws.national_states())), now),
        observed=cat.SourceResult(rows("riv_gauges_observed.json", nwps.parse_riv_row), now),
        forecast=cat.SourceResult(rows("riv_gauges_forecast.json", nwps.parse_riv_row), now),
        rfc=cat.SourceResult(rows("rfc_max_forecast.json", nwps.parse_rfc_row), now),
        iem=cat.SourceResult(rows("iem_current_flood_warnings.json", nwps.parse_iem_warning), now),
    )
    return inp, now


def route_transport(routes: list[tuple[str, str, object]], calls: list[httpx.Request] | None = None) -> httpx.MockTransport:
    """An ``httpx.MockTransport`` answering by (host, path regex): each route's answer is a ``Path`` (its bytes, 200),
    bytes, a dict / list (JSON, 200), an ``httpx.Response``, or a callable ``request -> httpx.Response``. Requests
    that match no route raise (as the offline guard does). ``calls`` (optional) collects every request."""
    import re as _re

    import orjson as _orjson

    compiled = [(h, _re.compile(p), a) for h, p, a in routes]

    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        for host, rx, answer in compiled:
            if request.url.host == host and rx.search(request.url.path):
                if callable(answer) and not isinstance(answer, (Path, bytes, dict, list)):
                    return answer(request)
                if isinstance(answer, httpx.Response):
                    return answer
                if isinstance(answer, Path):
                    body = answer.read_bytes()
                    ctype = ("image/tiff" if answer.suffix == ".tif" else "text/xml" if answer.suffix == ".xml"
                             else "application/json")
                    return httpx.Response(200, content=body, headers={"content-type": ctype})
                if isinstance(answer, bytes):
                    return httpx.Response(200, content=answer)
                return httpx.Response(200, content=_orjson.dumps(answer), headers={"content-type": "application/json"})
        raise RuntimeError(f"no test route for {f3config.mask_secrets(str(request.url))}")

    return httpx.MockTransport(handler)


@pytest.fixture
def no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """``fire3d.http`` retries without waiting (tests of retry paths)."""
    monkeypatch.setattr(fhttp, "_retry_delay", lambda attempt, retry_after: 0.0)


@pytest.fixture
def flood_iso(tmp_data_dir: Path):
    """PLAN-5 section 8 isolation for flood tests: temp DATA_DIR / FLOODS_DIR / CACHE_DIR (``tmp_data_dir``), and every
    in-memory cache cleared before and after (flood list, registries, NWS, extras, outage memories)."""
    from fire3d.api import extras
    from fire3d.floods import catalog as cat
    from fire3d.sources import nfhl, nws, nwps, opera, usgs_water, water_maps

    limiters = [nws.NWS_LIMITER, nws.IEM_LIMITER, nwps.NOAA_MAPS_LIMITER, nwps.NWPS_LIMITER,
                water_maps.NOAA_WATER_LIMITER, nfhl.NFHL_LIMITER, opera.EGIS_LIMITER, opera.CMR_LIMITER,
                opera.PODAAC_LIMITER, opera.GIBS_LIMITER, usgs_water.USGS_LIMITER]

    def clear() -> None:
        from fire3d.floods import satellite

        cat.reset_state()
        nws.reset_state()
        extras.reset_state()
        nwps.NWPS_DOWN.reset()
        for mod in (water_maps, nfhl, opera, usgs_water, satellite):
            mod.reset_state()
        for lim in limiters:                 # process-wide request limits: one test's requests never starve the next
            with lim._lock:
                lim._times.clear()
        fhttp.reset_down_memos()

    clear()
    yield tmp_data_dir
    clear()
