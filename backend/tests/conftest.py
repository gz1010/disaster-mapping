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
