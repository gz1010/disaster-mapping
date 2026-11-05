"""Brief 5 flood contracts (CONTRACT 16.2-16.6): contracts.py <-> web/src/api/floodTypes.ts parity.

For every TS interface (and every inline object type) the Python model has the same field names and the same
optional / required marks; every string-literal union, named (``export type X = 'a' | 'b'``) or inline in a field,
has the same values on both sides. ``web/src/api/types.ts`` re-exports the file. No fire model changes.
"""

from __future__ import annotations

import re
import types
import typing
from typing import Any, Literal, get_args, get_origin

import pytest
from pydantic import BaseModel

from fire3d import config, contracts
from fire3d.contracts import contract_problems, dump

FLOOD_TS_PATH = config.REPO_ROOT / "web" / "src" / "api" / "floodTypes.ts"
TYPES_TS_PATH = config.REPO_ROOT / "web" / "src" / "api" / "types.ts"


def _strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", text)


SRC = _strip_comments(FLOOD_TS_PATH.read_text())


def _interfaces(text: str) -> dict[str, tuple[str | None, str]]:
    """name -> (base interface or None, body)."""
    out: dict[str, tuple[str | None, str]] = {}
    for m in re.finditer(r"export interface (\w+)(?:<[^>{]*>)?(?:\s+extends\s+(\w+))?\s*\{", text):
        i, depth = m.end(), 1
        while depth:
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            i += 1
        out[m.group(1)] = (m.group(2), text[m.end():i - 1])
    return out


def _fields(body: str) -> dict[str, tuple[bool, str]]:
    """Top-level fields of an interface or inline object body: name -> (optional, type text)."""
    parts, depth, cur = [], 0, ""
    for ch in body:
        if ch in "{[(<":
            depth += 1
        elif ch in "}])>":
            depth -= 1
        if depth == 0 and ch in ";\n":
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    out: dict[str, tuple[bool, str]] = {}
    for p in parts:
        m = re.match(r"\s*(\w+)(\?)?\s*:\s*(.*)", p, flags=re.DOTALL)
        if m:
            out[m.group(1)] = (bool(m.group(2)), m.group(3).strip())
    return out


def _aliases(text: str) -> dict[str, str]:
    """``export type X = ...`` (one line or a leading-``|`` continuation) -> right-hand side."""
    out: dict[str, str] = {}
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        m = re.match(r"\s*export type (\w+)\s*=\s*(.*)", ln)
        if not m:
            continue
        rhs = [m.group(2)]
        j = i + 1
        while j < len(lines) and lines[j].strip().startswith("|"):
            rhs.append(lines[j].strip())
            j += 1
        out[m.group(1)] = " ".join(" ".join(rhs).split())
    return out


IFACES = _interfaces(SRC)
ALIASES = _aliases(SRC)
TS_ONLY = {"GeometryJson", "FeatureJson", "FeatureCollectionJson"}       # GeoJSON is dict[str, Any] in Python
# Inline TS object types -> their named Python models (interface, field)
INLINE = {
    ("FloodManifest", "time_range"): contracts.FloodTimeRange,
    ("FloodManifest", "files"): contracts.FloodManifestFiles,
    ("RiverGauge", "impacts"): contracts.GaugeImpact,
    ("RiverGauge", "data_attribution"): contracts.GaugeAttribution,
    ("FloodMapResponse", "stats"): contracts.FloodMapStats,
    ("SatelliteWaterResponse", "image"): contracts.SatelliteImage,
    ("SatelliteWaterResponse", "tiles"): contracts.SatelliteTiles,
    ("SatelliteWaterResponse", "stats"): contracts.SatelliteStats,
}


def _all_fields(name: str) -> dict[str, tuple[bool, str]]:
    base, body = IFACES[name]
    out = dict(_all_fields(base)) if base else {}
    out.update(_fields(body))
    return out


def _py_fields(model: type[BaseModel]) -> dict[str, bool]:
    return {n: not f.is_required() for n, f in model.model_fields.items()}


def _literal_values(tp: Any) -> set[Any] | None:
    """Every Literal value inside an annotation (None excluded); None when it holds no Literal."""
    vals: set[Any] = set()
    found = False
    stack = [tp]
    while stack:
        t = stack.pop()
        if get_origin(t) is Literal:
            found = True
            vals.update(get_args(t))
        elif get_origin(t) in (typing.Union, types.UnionType):
            stack.extend(get_args(t))
    return vals if found else None


def _ts_literals(type_text: str) -> set[Any] | None:
    """The values of a literal-only TS union (``'a' | 'b' | null``, ``1``, ``true``); None for any other type."""
    toks = [t.strip() for t in " ".join(type_text.split()).split("|") if t.strip()]
    vals: set[Any] = set()
    for t in toks:
        if t == "null":
            continue
        if re.fullmatch(r"'[^']*'", t):
            vals.add(t[1:-1])
        elif re.fullmatch(r"\d+", t):
            vals.add(int(t))
        elif t in ("true", "false"):
            vals.add(t == "true")
        else:
            return None
    return vals or None


def test_types_ts_reexports_the_flood_types() -> None:
    assert "export * from './floodTypes'" in TYPES_TS_PATH.read_text()
    raw = FLOOD_TS_PATH.read_text()
    assert "import type { DataSource, JobStatus, LayerInfo, ManifestGrid, Mode } from './types'" in raw
    assert "import type { OfficialSource, OfficialStatus } from '../official/types'" in raw


def test_every_ts_interface_has_a_python_model() -> None:
    names = set(IFACES) - TS_ONLY
    missing = sorted(n for n in names if not isinstance(getattr(contracts, n, None), type))
    assert not missing, missing
    assert len(names) >= 25


@pytest.mark.parametrize("ts_name", sorted(set(IFACES) - TS_ONLY))
def test_field_names_and_optionality(ts_name: str) -> None:
    model = getattr(contracts, ts_name)
    ts = _all_fields(ts_name)
    py = _py_fields(model)
    assert set(ts) == set(py), f"{ts_name}: only TS {sorted(set(ts) - set(py))}, only Python {sorted(set(py) - set(ts))}"
    for name, (optional, _) in ts.items():
        assert optional == py[name], f"{ts_name}.{name}: TS optional={optional}, Python optional={py[name]}"
    base = IFACES[ts_name][0]
    if base:
        assert issubclass(model, getattr(contracts, base)), f"{ts_name} must extend {base} in Python too"


@pytest.mark.parametrize("key", sorted(INLINE), ids=[f"{a}.{b}" for a, b in sorted(INLINE)])
def test_inline_objects(key: tuple[str, str]) -> None:
    iface, field = key
    text = _all_fields(iface)[field][1]
    body = text[text.index("{") + 1:text.rindex("}")]
    ts = _fields(body)
    py = _py_fields(INLINE[key])
    assert set(ts) == set(py), f"{iface}.{field}: TS {sorted(ts)}, Python {sorted(py)}"
    for name, (optional, _) in ts.items():
        assert optional == py[name], f"{iface}.{field}.{name}"


@pytest.mark.parametrize("alias", sorted(ALIASES))
def test_named_unions_match(alias: str) -> None:
    ts_vals = _ts_literals(ALIASES[alias])
    assert ts_vals is not None, f"{alias} is not a literal union: {ALIASES[alias]}"
    py = getattr(contracts, alias, None)
    assert py is not None, f"contracts.{alias} missing"
    assert _literal_values(py) == ts_vals, alias


def _field_cases() -> list[tuple[str, str, str]]:
    out = []
    for name in sorted(set(IFACES) - TS_ONLY):
        for f, (_, text) in _all_fields(name).items():
            if _ts_literals(text) is not None:
                out.append((name, f, text))
    return out


@pytest.mark.parametrize("ts_name,field,text", _field_cases(), ids=[f"{a}.{b}" for a, b, _ in _field_cases()])
def test_inline_unions_match(ts_name: str, field: str, text: str) -> None:
    py = _literal_values(getattr(contracts, ts_name).model_fields[field].annotation)
    assert py == _ts_literals(text), f"{ts_name}.{field}: TS {text}"


def test_named_union_fields_use_the_same_alias() -> None:
    """A TS field typed by a named union (``kind: FloodKind``) has the same values in Python."""
    checked = 0
    for name in sorted(set(IFACES) - TS_ONLY):
        model = getattr(contracts, name)
        for f, (_, text) in _all_fields(name).items():
            alias = " ".join(text.split()).replace("| null", "").strip()
            if alias in ALIASES:
                assert _literal_values(model.model_fields[f].annotation) == _ts_literals(ALIASES[alias]), f"{name}.{f}"
                checked += 1
    assert checked >= 20


# ------------------------------------------------------------------------------------------------------------------
# Behaviour of the models (strict checks; optional fields omitted from dumps)
# ------------------------------------------------------------------------------------------------------------------
GAUGE_REF = {"lid": "ZZRF1", "name": "Ridge Fork River at Example", "waterbody": "Ridge Fork River", "state": "NM",
             "lat": 36.79, "lon": -108.06, "observed_category": "moderate", "observed_value": 18.4, "unit": "ft",
             "observed_ms": 1, "forecast_category": "major", "forecast_max_value": 20.1, "forecast_max_ms": 2,
             "forecast_issued_ms": 0, "url": "https://water.noaa.gov/gauges/zzrf1"}
SUMMARY = {
    "id": "flood-20261104-ridge-fork-river-flood-abc123", "hazard": "flood", "name": "Ridge Fork River flood",
    "kind": "river", "level": "warning", "emergency": False, "status": "active", "mode": "live", "year": 2026,
    "started_ms": 0, "started_basis": "nws_product", "updated_ms": 1, "expires_ms": 2, "last_product_ms": 1,
    "ended_ms": None, "lat": 36.79, "lon": -108.06, "bbox_lonlat": [-108.2, 36.7, -107.9, 36.9], "state": "NM",
    "states": ["NM"], "county": "San Juan County", "time_zone": "America/Denver", "rivers": ["Ridge Fork River"],
    "primary_gauge": GAUGE_REF, "gauges": [GAUGE_REF], "gauges_in_flood": 1, "max_category": "major",
    "products": [{"id": "x", "event": "Flood Warning", "vtec_key": "KZZZ.FL.W.0001.2026", "sender_name": "NWS Example Office (synthetic)",
                  "phase": "in_effect", "sent_ms": 0, "onset_ms": None, "ends_ms": 9, "emergency": False,
                  "damage_threat": None, "gauge_lids": ["ZZRF1"], "url": None, "archived": False}],
    "offices": ["KZZZ"], "bundle_status": "none", "bundle_built_ms": None, "aliases": [], "synthetic": True, "caveat": None,
}


def test_summary_and_list_validate_strictly() -> None:
    assert contract_problems(contracts.FloodSummary, SUMMARY) == []
    assert contract_problems(contracts.FloodSummary, {**SUMMARY, "kind": "coastal"})
    assert contract_problems(contracts.FloodSummary, {**SUMMARY, "status": "ended"})          # never "ended"
    assert contract_problems(contracts.FloodSummary, {**SUMMARY, "extra": 1}) == ["extra: unexpected field"]
    src = {"id": "nws_alerts", "name": "National Weather Service", "status": "available", "retrieved_ms": 1,
           "reason": None, "stale": False}
    lst = {"hazard": "flood", "mode": "live", "updated_ms": 1, "floods": [SUMMARY], "sources": [src], "products_in_effect": 3}
    assert contract_problems(contracts.FloodListResponse, lst) == []
    d = dump(contracts.FloodListResponse.model_validate(lst))
    assert "year" not in d and "past_rule" not in d and "preparing" not in d             # optional: omitted when None
    hist = {**lst, "mode": "historical", "year": 2025, "past_rule": "fallback", "preparing": False}
    assert dump(contracts.FloodListResponse.model_validate(hist))["past_rule"] == "fallback"
    assert contract_problems(contracts.FloodListResponse, {**hist, "past_rule": "everything"})


def test_detail_resolution_values() -> None:
    for r in ("live", "year", "alias", "bundle", "last_known"):
        assert contract_problems(contracts.FloodDetailResponse,
                                 {"summary": SUMMARY, "manifest": None, "job": None, "resolved_from": r}) == []
    assert contract_problems(contracts.FloodDetailResponse,
                             {"summary": SUMMARY, "manifest": None, "job": None, "resolved_from": "guess"})


def test_model_output_is_never_an_official_envelope() -> None:
    assert not issubclass(contracts.ModelOutputResponse, contracts.FloodEnvelope)
    assert not issubclass(contracts.SatelliteWaterResponse, contracts.FloodEnvelope)
    for m in (contracts.FloodAlertsResponse, contracts.RiverGaugesResponse, contracts.FloodMapResponse):
        assert issubclass(m, contracts.FloodEnvelope)
    assert _literal_values(contracts.ModelOutputResponse.model_fields["model_output"].annotation) == {True}


def test_fire_unions_are_not_widened() -> None:
    """Flood answers have their own kinds and reason codes; the fire envelope's unions are unchanged."""
    assert _literal_values(contracts.OfficialKind) == {"calfire", "fire_weather", "incident_record", "local_alerts"}
    assert _literal_values(contracts.OfficialReasonCode) == {"past_date", "upstream_error", "not_covered", "state_not_available"}
    assert "kind" in contracts.FloodEnvelope.model_fields and "flood_id" in contracts.FloodEnvelope.model_fields
    assert "incident_id" not in contracts.FloodEnvelope.model_fields
