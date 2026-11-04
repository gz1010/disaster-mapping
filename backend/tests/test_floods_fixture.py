"""The synthetic flood fixture ``fixture-flood`` (PLAN-5 7.1, CONTRACT 16.9): complete, strictly valid, honest.

It is generated into a temp dir at 2026-11-04T18:00:00Z by the session fixture (``conftest.flood_fixture_data``), so
these tests never skip; the committed copy of its canned answers (``tests/data/floods/fixture_api/``, which the web
copies verbatim) must equal a fresh run.
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import numpy as np
import orjson
import pytest
from PIL import Image

from fire3d import contracts as C
from fire3d import config
from fire3d.floods import copy as fcopy
from fire3d.floods.grouping import flood_rank

from conftest import FLOOD_FIXTURE_NOW_MS, load_script

NOW = FLOOD_FIXTURE_NOW_MS
H = 3_600_000
COMMITTED = config.REPO_ROOT / "backend" / "tests" / "data" / "floods" / "fixture_api"
DEMO_IDS = ["fixture-flood-flash", "fixture-flood-major", "fixture-flood-moderate", "fixture-flood-minor",
            "fixture-flood-advisory", "fixture-flood-watch", "fixture-flood-past"]
# Real NWS office names that must never appear on a synthetic product (C26); a sample of the offices near the demo floods
REAL_OFFICES = ("Albuquerque", "Kansas City", "Quad Cities", "Austin", "Tampa", "Phoenix", "Denver", "Jackson KY", "Grand Junction")


def _j(p: Path):
    return orjson.loads(p.read_bytes())


def _model_for(name: str) -> type:
    n = name.removesuffix(".json")
    if n.startswith("edge/"):
        n = n[5:]
    table = [("list", C.FloodListResponse), ("status", C.FloodLiveStatus), ("detail", C.FloodDetailResponse),
             ("flood-alerts", C.FloodAlertsResponse), ("alerts-", C.FloodAlertsResponse),
             ("river-gauges", C.RiverGaugesResponse), ("gauges-", C.RiverGaugesResponse), ("maps-", C.FloodMapResponse),
             ("rfc_fim-", C.FloodMapResponse), ("catfim-", C.FloodMapResponse), ("nfhl-", C.FloodMapResponse),
             ("model", C.ModelOutputResponse), ("satellite", C.SatelliteWaterResponse),
             ("local-alerts", C.LocalAlertsResponse)]
    for prefix, model in table:
        if n.startswith(prefix):
            return model
    raise AssertionError(f"no model for {name}")


@pytest.fixture(scope="module")
def api(flood_fixture_bundle: Path) -> Path:
    return flood_fixture_bundle / "api"


def test_bundle_files_and_layers(flood_fixture_bundle: Path) -> None:
    b = flood_fixture_bundle
    m = C.validate_strict(C.FloodManifest, (b / "manifest.json").read_bytes())
    assert m.id == "fixture-flood" and m.hazard == "flood" and m.summary.synthetic is True
    assert set(m.layers) == {"elevation", "sky_view", "naip", "water_forecast", "floodplain", "water_satellite", "water_model"}
    for name, info in m.layers.items():
        p = b / info.file
        assert p.is_file(), name
        if info.dtype != "jpeg":
            assert p.stat().st_size == info.width * info.height * (4 if info.dtype == "float32" else 1), name
    assert set(m.layer_status) == {"terrain", "naip", "water_forecast", "floodplain", "water_satellite", "water_model",
                                   "warnings", "gauges"}
    assert m.grid.fire == m.grid.render
    assert m.time_origin_ms == m.time_range.start_ms and m.time_range.now_ms == NOW
    for rel in [m.files.warnings, m.files.gauges, m.files.satellite, m.files.satellite_image,
                *m.files.maps.values(), *m.files.model.values()]:
        assert (b / rel).is_file(), rel
    assert {"rfc_fim", "nfhl", "catfim_ZZRF1_moderate", "catfim_ZZRF1_major"} <= set(m.files.maps)
    assert {"nwm_analysis", "nwm_series_ZZRF1"} <= set(m.files.model)
    C.validate_strict(C.FloodAlertsResponse, (b / "warnings.json").read_bytes())
    C.validate_strict(C.RiverGaugesResponse, (b / "gauges.json").read_bytes())
    C.validate_strict(C.SatelliteWaterResponse, (b / "satellite.json").read_bytes())
    C.validate_strict(C.ModelOutputResponse, (b / "model" / "nwm_series_ZZRF1.json").read_bytes())
    for f in (b / "maps").glob("*.geojson"):
        fc = _j(f)
        assert fc["type"] == "FeatureCollection" and fc["features"], f.name


def test_every_canned_answer_validates(api: Path) -> None:
    files = sorted(p for p in api.rglob("*.json") if p.name not in ("build-job.json", "evacuations.json"))
    assert len(files) >= 60
    for p in files:
        rel = p.relative_to(api).as_posix()
        assert C.contract_problems(_model_for(rel), p.read_bytes()) == [], rel
    for j in _j(api / "build-job.json"):
        assert C.contract_problems(C.JobStatus, j) == []
    assert [j["status"] for j in _j(api / "build-job.json")] == ["queued", "running", "done"]
    ev = _j(api / "evacuations.json")
    assert ev["kind"] == "evacuations" and ev["status"] == "unavailable" and ev["reason_code"] == "state_not_available"


def test_issuers_are_fictional_and_products_marked(flood_fixture_bundle: Path, api: Path) -> None:
    texts = []
    for p in [flood_fixture_bundle / "warnings.json", *api.glob("flood-alerts*.json")]:
        ans = _j(p)
        assert ans["synthetic"] is True and ans["source"]["credit"].startswith("Synthetic data for testing")
        for a in ans["alerts"]:
            assert a["sender_name"] == "NWS Example Office (synthetic)", p.name
            assert a["vtec"]["office"] == "KZZZ" and a["url"] is None and a["office_url"] is None
            assert a["description"].startswith(fcopy_mark())
            texts.append(" ".join(str(a[k]) for k in ("headline", "description", "instruction", "area_desc")))
    blob = "\n".join(texts)
    for office in REAL_OFFICES:
        assert f"NWS {office}" not in blob
    for p in api.glob("river-gauges*.json"):
        for g in _j(p)["gauges"]:
            assert re.fullmatch(r"ZZ[A-Z]{2}\d", g["lid"]), g["lid"]
            assert g["rfc"] == "ZZRFC" and (g["forecast"] is None or g["forecast"]["producer_name"].endswith("(synthetic)"))


def fcopy_mark() -> str:
    return load_script("make_fixture").SYNTHETIC_MARK


def test_fixture_flood_scenario(flood_fixture_bundle: Path, api: Path) -> None:
    d = _j(api / "detail.json")
    s = d["summary"]
    assert (s["name"], s["kind"], s["level"], s["synthetic"], d["resolved_from"]) == (
        "Ridge Fork River flood", "river", "warning", True, "live")
    assert (s["state"], s["county"], s["time_zone"]) == ("NM", "San Juan County", "America/Denver")
    assert abs(s["lat"] - 36.79) < 0.03 and abs(s["lon"] + 108.06) < 0.03
    assert s["primary_gauge"]["lid"] == "ZZRF1" and [g["lid"] for g in s["gauges"]] == ["ZZRF1", "ZZRF2"]
    assert s["max_category"] == "moderate" and s["gauges_in_flood"] == 1
    gauges = {g["lid"]: g for g in _j(flood_fixture_bundle / "gauges.json")["gauges"]}
    z1, z2, z3, z4 = (gauges[k] for k in ("ZZRF1", "ZZRF2", "ZZRF3", "ZZRF4"))
    assert z1["observed"]["category"] == "moderate" and z1["member"] and z1["reach_id"]
    assert z1["forecast"]["max_value"] == pytest.approx(z1["thresholds"]["major"] - 1.0)
    assert z1["forecast"]["max_ms"] == NOW + 30 * H and z1["forecast"]["issued_ms"] == NOW - 2 * H
    assert z1["forecast"]["crest_at_end"] is False and len(z1["impacts"]) == 3
    obs_cats = [C_ for C_ in (_cat(r[1], z1["thresholds"]) for r in z1["series"]["observed"])]
    assert {"action", "minor", "moderate"} <= set(obs_cats)            # rose through action and minor to moderate
    assert len(z1["series"]["observed"]) == 72 * 4 + 1                    # 72 h every 15 min
    assert z1["data_attribution"] == [{"text": "Observations courtesy of U.S. Geological Survey", "url": None}]
    assert z2["observed"]["category"] == "action" and z2["forecast"]["crest_at_end"] is True      # C7
    assert z3["observed"]["category"] == "no_flooding" and z3["reach_id"] is None and not z3["member"]
    assert z4["observed"]["category"] == "obs_not_current" and z4["observed"]["valid_ms"] == NOW - 9 * H
    warnings = _j(flood_fixture_bundle / "warnings.json")["alerts"]
    flw = [a for a in warnings if a["event"] == "Flood Warning"]
    assert [a["vtec"]["action"] for a in flw] == ["NEW", "EXT"] and flw[-1]["ends_ms"] == NOW + 8 * H   # C1
    assert flw[-1]["hvtec"]["nwsli"] == "ZZRF1" and flw[-1]["hvtec"]["severity"] == "2" and flw[-1]["hvtec"]["cause"] == "ER"
    watch = next(a for a in warnings if a["event"] == "Flood Watch")
    assert watch["geometry"] is None and watch["ugcs"]
    zones = _j(flood_fixture_bundle / "warnings.json")["zones"]["features"]
    assert {f["properties"]["ugc"] for f in zones} == set(watch["ugcs"])
    assert {a["event"] for a in _j(api / "flood-alerts.json")["alerts"]} == {"Flood Warning", "Flood Advisory", "Flood Watch"}
    assert len(_j(api / "flood-alerts.json")["alerts"]) == 3              # the versions in effect now
    model = _j(api / "model-nwm_series-ZZRF1.json")
    assert [s_["name"] for s_ in model["series"]] == ["analysis_assimilation", "short_range", "medium_range_blend"]
    assert len(model["series"][1]["points"]) == 18 and len(model["series"][2]["points"]) == 240
    assert _j(api / "model-nwm_series-ZZRF3.json")["status"] == "unavailable"        # no reach: no NWM line (C28)


def _cat(v, th):
    for c in ("major", "moderate", "minor", "action"):
        if v >= th[c]:
            return c
    return "no_flooding"


def test_maps_rfc_fim_member_reaches_nfhl_and_model(api: Path) -> None:
    import shapely
    from shapely.geometry import shape

    rfc = _j(api / "maps-rfc_fim.json")
    assert rfc["experimental"] is True and rfc["coverage_note"] == fcopy.RFC_FIM_NOTE
    assert rfc["outside_note"] == fcopy.RFC_FIM_OUTSIDE and rfc["min_zoom"] is None
    feats = rfc["features"]["features"]
    ids = {f["properties"]["feature_id"] for f in feats}
    assert {9900001, 9900002} <= ids                                 # reaches of a non-member forecast point exist ...
    lat0 = 36.79
    k = (111.32 * np.cos(np.radians(lat0))) * 111.32
    total = shapely.union_all([shape(f["geometry"]) for f in feats]).area * k
    members = shapely.union_all([shape(f["geometry"]) for f in feats if f["properties"]["feature_id"] >= 9900003]).area * k
    assert rfc["stats"]["area_km2"] < total * 0.95                   # ... but are not counted (C6: never a bbox crop)
    assert rfc["stats"]["area_km2"] == pytest.approx(members, rel=0.08)
    nfhl = _j(api / "maps-nfhl.json")
    assert nfhl["availability"] == "mapped" and nfhl["effective_min_ms"] < nfhl["effective_max_ms"]    # C19
    zones = {(f["properties"]["fld_zone"], f["properties"]["zone_subty"]) for f in nfhl["features"]["features"]}
    assert ("AE", "FLOODWAY") in zones and ("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD") in zones
    assert b"MINIMAL" not in (api / "maps-nfhl.json").read_bytes()                                  # D16: no zone X minimal
    hf = _j(api / "model-nwm_high_flow.json")
    assert {f["properties"]["recur_cat"] for f in hf["features"]["features"]} >= {"10", ">50"}
    for name in ("model-nwm_analysis.json", "model-nwm_5day.json", "model-nwm_high_flow.json"):
        m = _j(api / name)
        assert m["model_output"] is True and m["caveats"] == [fcopy.MODEL_CAVEAT] and m["label"] == fcopy.MODEL_LABEL
    cat = _j(api / "maps-catfim-ZZRF1-major.json")
    assert cat["category"] == "major" and cat["coverage_note"] == fcopy.catfim_note("major")


def test_satellite_no_view_is_never_transparent(flood_fixture_bundle: Path, api: Path) -> None:
    """D25 / C2: cloud (253) and no data (255) share a grey "no view" hatch, never transparent; the image ends
    before the AOI's east edge; there is a no-data strip inside the image."""
    mf = load_script("make_fixture")
    classes = np.array([[0, 1, 2, 252, 253, 254, 255]], np.uint8).repeat(6, 0).repeat(6, 1)
    rgba = mf._sat_palette_rgba(classes)
    alpha = {c: rgba[..., 3][classes == c] for c in (0, 1, 2, 252, 253, 254, 255)}
    assert alpha[253].min() > 0 and alpha[255].min() > 0 and alpha[0].max() == 0 and alpha[254].max() == 0
    grey = lambda c: set(map(tuple, rgba[classes == c][:, :3]))  # noqa: E731
    assert grey(253) == grey(255)
    sat = np.fromfile(flood_fixture_bundle / "layers" / "water_satellite.bin", np.uint8).reshape(1024, 1024)
    assert set(np.unique(sat)) <= {0, 1, 2, 252, 253, 254, 255}
    assert (sat[:, -1] == 255).all()                                 # outside the image (east edge)
    inside = sat[:, :700]
    assert (inside == 255).sum() > 1000 and (inside == 253).sum() > 0.1 * inside.size and (inside == 1).sum() > 1000
    png = Image.open(io.BytesIO((flood_fixture_bundle / "satellite.png").read_bytes()))
    a = np.asarray(png.convert("RGBA"))
    assert (a[..., 3] > 0).any() and (a[..., 3] == 0).any()
    s = _j(api / "satellite.json")
    assert s["measured"] is True and s["login"] == "not_configured" and s["login_note"] == fcopy.SAT_NOT_SET_UP
    w, s_, e, n = s["image"]["bounds_lonlat"]
    aoi = _j(api / "detail.json")["manifest"]["grid"]["bbox_lonlat"]
    assert w == pytest.approx(aoi[0]) and e < aoi[2]
    assert s["granules"][0]["acquired_ms"] == NOW - 4 * 86_400_000 - 2 * H and s["granules"][0]["route"] == "earthdata_gis"
    assert 20 <= s["stats"]["cloud_pct"] <= 40 and s["stats"]["nodata_pct"] > 5


def test_frozen_files_carry_absolute_times_only(flood_fixture_bundle: Path, api: Path) -> None:
    """C16: no relative age ("4 d ago") in any frozen file or canned answer; ages are computed by the web."""
    pat = re.compile(rb"\b\d+\s*(?:d|h|min|days?|hours?|minutes?)\s+ago\b", re.IGNORECASE)
    for p in [*flood_fixture_bundle.glob("*.json"), *api.rglob("*.json")]:
        assert not pat.search(p.read_bytes()), p.name
    cav = _j(api / "satellite.json")["caveats"][0]
    assert re.search(r"Nov \d+, 2026|Oct \d+, 2026", cav) and "ago" not in cav


def test_list_only_demo_floods(api: Path) -> None:
    live = _j(api / "list.json")
    ids = [r["id"] for r in live["floods"]]
    assert ids[0] == "fixture-flood-flash" and "fixture-flood" in ids
    assert set(ids) == {"fixture-flood", *DEMO_IDS} - {"fixture-flood-past"}
    ranks = [flood_rank(r) for r in live["floods"]]
    assert ranks == sorted(ranks, reverse=True)
    past = _j(api / "list-2025.json")
    assert [r["id"] for r in past["floods"]] == ["fixture-flood-past"] and past["mode"] == "historical"
    for fid in DEMO_IDS:
        d = _j(api / f"detail-{fid}.json")
        s = d["summary"]
        assert s["id"] == fid and s["synthetic"] is True and d["manifest"] is None
        assert "fire" not in s["name"].lower()
        for kind in ("flood-alerts", "river-gauges", "maps-rfc_fim", "maps-nfhl", "maps-catfim"):
            assert (api / f"{kind}-{fid}.json").is_file(), (kind, fid)
    flash = _j(api / "detail-fixture-flood-flash.json")["summary"]
    assert flash["emergency"] and flash["kind"] == "flash" and flash["primary_gauge"] is None and flash["gauges"] == []
    fa = _j(api / "flood-alerts-fixture-flood-flash.json")["alerts"][0]
    assert (fa["detection"], fa["damage_threat"], fa["emergency"]) == ("OBSERVED", "CATASTROPHIC", True)
    near = _j(api / "river-gauges-fixture-flood-flash.json")["gauges"]
    assert len(near) == 1 and near[0]["member"] is False and near[0]["observed"]["category"] == "no_flooding"
    dkm = np.hypot((near[0]["lon"] - flash["lon"]) * 111.32 * np.cos(np.radians(flash["lat"])), (near[0]["lat"] - flash["lat"]) * 111.32)
    assert 4.0 < dkm < 8.0
    rfc = _j(api / "maps-rfc_fim-fixture-flood-flash.json")
    assert rfc["status"] == "available" and rfc["features"]["features"] == [] and rfc["stats"] is None
    watch = _j(api / "detail-fixture-flood-watch.json")["summary"]
    assert watch["level"] == "watch" and watch["gauges"] == [] and watch["name"].startswith("Flood watch: ")
    wa = _j(api / "flood-alerts-fixture-flood-watch.json")
    assert wa["alerts"][0]["geometry"] is None and len(wa["zones"]["features"]) == 3
    minor = _j(api / "detail-fixture-flood-minor.json")["summary"]
    assert minor["level"] == "gauge_only" and minor["caveat"] == fcopy.GAUGE_ONLY_CAVEAT and minor["products"] == []
    p = _j(api / "detail-fixture-flood-past.json")
    assert p["resolved_from"] == "year" and p["summary"]["status"] == "inactive" and p["summary"]["year"] == 2025
    assert _j(api / "maps-rfc_fim-fixture-flood-past.json")["status"] == "not_available_for_past_dates"
    assert all(a["archived"] for a in _j(api / "flood-alerts-fixture-flood-past.json")["alerts"])


def test_edge_cases_say_unavailable_never_none(api: Path) -> None:
    edge = api / "edge"
    for name, text in (("alerts-unavailable.json", fcopy.ALERTS_UNAVAILABLE), ("gauges-unavailable.json", fcopy.GAUGES_UNAVAILABLE),
                       ("rfc_fim-unavailable.json", fcopy.RFC_FIM_UNAVAILABLE), ("catfim-unavailable.json", fcopy.CATFIM_UNAVAILABLE),
                       ("nfhl-unavailable.json", fcopy.NFHL_DOWN), ("satellite-unavailable.json", fcopy.SAT_UNAVAILABLE)):
        ans = _j(edge / name)
        assert ans["status"] == "unavailable" and ans["reason"] == text, name
    assert _j(edge / "model-unavailable.json")["status"] == "unavailable"
    assert _j(edge / "satellite-refused.json")["login_note"] == fcopy.SAT_LOGIN_REFUSED
    assert _j(edge / "satellite-picture.json")["measured"] is False and _j(edge / "satellite-picture.json")["tiles"]
    both = _j(edge / "list-both-down.json")
    assert all(s_["status"] == "unavailable" and s_["reason"] == fcopy.FLOOD_LISTS_DOWN for s_ in both["sources"])
    assert both["products_in_effect"] is None
    assert _j(edge / "list-nws-down.json")["sources"][0]["reason"] == fcopy.FLOOD_NWS_DOWN
    assert _j(edge / "detail-last-known.json")["resolved_from"] == "last_known"


def test_committed_copy_matches_a_fresh_run(api: Path) -> None:
    """``tests/data/floods/fixture_api`` (copied verbatim by the web) is exactly what the generator writes at the
    pinned time: regenerate it with ``make_fixture.py --only flood --now 2026-11-04T18:00:00Z --copy-api
    tests/data/floods/fixture_api`` after changing the fixture."""
    fresh = {p.relative_to(api).as_posix() for p in api.rglob("*") if p.is_file()}
    committed = {p.relative_to(COMMITTED).as_posix() for p in COMMITTED.rglob("*") if p.is_file()}
    assert fresh == committed
    for rel in sorted(fresh):
        if rel.endswith(".json"):
            assert _j(api / rel) == _j(COMMITTED / rel), rel
        else:
            assert (api / rel).read_bytes() == (COMMITTED / rel).read_bytes(), rel
