"""Backend-sent flood strings (``fire3d/floods/copy.py``): equal to CONTRACT 16.14 word for word, and free of the
PLAN-5 5.1 banned patterns in Disaster Mapping's own voice (word boundaries; allowed phrases removed first, longest first).
A planted banned word must make the guard fail (C24). The canned fixture answers pass the same guard, with NWS-style
verbatim text (alerts' headline, description, instruction) left out, as the web strips ``data-verbatim`` text."""

from __future__ import annotations

import re
from pathlib import Path

import orjson
import pytest

from fire3d import config
from fire3d.floods import copy as fcopy

CONTRACT = config.REPO_ROOT / "docs" / "redesign" / "CONTRACT.md"

# PLAN-5 5.1: allowed phrases (removed first, case-insensitive, longest first) and banned patterns (word-bounded)
ALLOWED = [
    "does not establish the safety of a route or an area", "dry pixels do not mean no flooding",
    "do not mean no flooding", "unknown, not dry", "not an all-clear", "never an all-clear",
]
BANNED = [r"\bsafe(ly|ty)?\b", r"\blow risk\b", r"\ball[- ]clear\b", r"\bno flooding\b", r"\bdry\b", r"\breceded\b",
          r"\bthe flood is over\b", r"\bended\b", r"\bnormal level\b", r"\bno danger\b", r"\byou are outside the flood\b",
          r"\bminimal flood hazard\b", r"firetrace"]


def guard(text: str) -> list[str]:
    """The banned patterns found in ``text`` after the allowed phrases are removed."""
    t = text
    for phrase in sorted(ALLOWED, key=len, reverse=True):
        t = re.sub(re.escape(phrase), " ", t, flags=re.IGNORECASE)
    return [p for p in BANNED if re.search(p, t, flags=re.IGNORECASE)]


AS_BUILT = "**As built: more backend-sent strings**"


def _rows(sec: str) -> dict[str, str]:
    out = {}
    for m in re.finditer(r"^\| `([A-Z0-9_]+)` \| (.+?) \|$", sec, flags=re.MULTILINE):
        out[m.group(1)] = m.group(2).strip()
    return out


def _contract_table() -> dict[str, str]:
    """CONTRACT 16.14's planned table (the rows before the integration's as-built table)."""
    text = CONTRACT.read_text()
    sec = text[text.index("### 16.14"):text.index("### 16.15")]
    return _rows(sec.split(AS_BUILT)[0])


def test_as_built_strings_equal_the_code() -> None:
    """The integration's as-built table in 16.14 (copy.py LIST_STRINGS / BUNDLE_STRINGS, history.PAST_STRINGS,
    live.REFRESH_KEPT): every single-name row is the code's text word for word."""
    from fire3d.floods import history, live

    text = CONTRACT.read_text()
    sec = text[text.index("### 16.14"):text.index("### 16.15")]
    rows = _rows(sec.split(AS_BUILT)[1])
    code = {**fcopy.LIST_STRINGS, **fcopy.BUNDLE_STRINGS, **history.PAST_STRINGS, "REFRESH_KEPT": live.REFRESH_KEPT}
    assert len(rows) >= 20
    for name, row in rows.items():
        assert name in code, name
        assert code[name] == row, name


def test_strings_equal_contract_16_14() -> None:
    table = _contract_table()
    assert len(table) == 28
    assert set(table) == set(fcopy.CONTRACT_STRINGS)
    for name, text in table.items():
        assert fcopy.CONTRACT_STRINGS[name] == text.replace("{date, time}", "{date_time}"), name
        assert getattr(fcopy, name) == fcopy.CONTRACT_STRINGS[name], name


def test_slots_are_absolute() -> None:
    cav = fcopy.sat_caveat("Oct 31, 2026, 12:06 PM MDT", 29.6)
    assert "Oct 31, 2026, 12:06 PM MDT" in cav and "Clouds (30% of this area)" in cav and "ago" not in cav
    assert fcopy.catfim_note("major") == ("What NWS maps for major flooding at this gauge (experimental map library). "
                                          "Not a forecast.")
    assert fcopy.sat_picture_reason("Oct 30, 2026") == (
        "Disaster Mapping could not load a measured satellite water image of this area from the last 10 days; NASA's picture "
        "of Oct 30, 2026 is not measured here. That is not an all-clear.")


def test_sat_caveat_without_a_cloud_share_and_for_radar() -> None:
    """Review R5: no "?" ever reaches a user. A picture (no measured cloud share) drops the parenthesis; radar
    (DSWx-S1) sees through clouds, so its caveat never says clouds hide water, and both keep "dry pixels do not mean
    no flooding"."""
    pic = fcopy.sat_caveat("Oct 31, 2026", None)
    assert pic == ("Water seen by satellite (NASA OPERA), Oct 31, 2026. It includes the river's normal water. Clouds, "
                   "trees, buildings and the days between passes hide water: dry pixels do not mean no flooding.")
    radar = fcopy.sat_caveat("Nov 2, 2026, 7:01 AM CST", None, radar=True)
    assert radar == ("Water seen by radar satellite (NASA OPERA), Nov 2, 2026, 7:01 AM CST. It includes the river's "
                     "normal water. Trees, buildings, steep slopes and the days between passes hide water: dry pixels "
                     "do not mean no flooding.")
    assert fcopy.sat_caveat("Nov 2, 2026", 12.0, radar=True) == fcopy.sat_caveat("Nov 2, 2026", None, radar=True)
    for text in (pic, radar):
        assert "?" not in text and "dry pixels do not mean no flooding" in text and guard(text) == []
    assert "Clouds" not in radar and "cloud" not in radar.lower()


def test_opera_credit_lines_are_exact() -> None:
    """Review R6: the route sits before the Copernicus clause (PLAN-5 2 "Credit line (exact)")."""
    assert fcopy.opera_credit("DSWx-HLS", "earthdata_gis") == (
        "Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1) via NASA Earthdata GIS; "
        "contains modified Copernicus Sentinel data")
    assert fcopy.opera_credit("DSWx-HLS", "gibs") == (
        "Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1) via NASA GIBS; "
        "contains modified Copernicus Sentinel data")
    assert fcopy.opera_credit("DSWx-HLS", "podaac") == fcopy.CREDIT_OPERA_HLS == (
        "Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1); contains modified "
        "Copernicus Sentinel data")
    assert fcopy.opera_credit("DSWx-S1", "podaac") == fcopy.CREDIT_OPERA_S1 == (
        "NASA JPL OPERA DSWx-S1 (PO.DAAC); contains modified Copernicus Sentinel data")


def test_bundle_strings_live_in_copy_and_pass_the_guard() -> None:
    assert not set(fcopy.BUNDLE_STRINGS) & set(fcopy.CONTRACT_STRINGS)
    for name, text in fcopy.BUNDLE_STRINGS.items():
        assert guard(text) == [] and getattr(fcopy, name) == text, name
    # review R4, R9: "not covered" is never said as an outage, and no slot fill reads "flood flooding"
    assert "could not" not in fcopy.CATFIM_NOT_COVERED and "flood flooding" not in fcopy.CATFIM_NOTE_ANY
    assert "gauge has no" not in fcopy.MODEL_NO_GAUGE and "no river gauge" in fcopy.MODEL_NO_GAUGE
    # review R7: "could not be checked" is never a claim of partial coverage
    assert "only part" not in fcopy.NFHL_AVAILABILITY_UNKNOWN and "could not be checked" in fcopy.NFHL_AVAILABILITY_UNKNOWN


@pytest.mark.parametrize("name", sorted(fcopy.CONTRACT_STRINGS))
def test_no_banned_words(name: str) -> None:
    assert guard(fcopy.CONTRACT_STRINGS[name]) == [], name


def test_every_module_string_passes_the_guard() -> None:
    for name, value in vars(fcopy).items():
        if isinstance(value, str) and not name.startswith("_"):
            assert guard(value) == [], name
        elif isinstance(value, dict) and name.startswith("SOURCE_"):
            for k, v in value.items():
                assert guard(str(v)) == [], (name, k)


def test_list_strings_live_in_copy_and_pass_the_guard() -> None:
    """Review BFS-R8: every other fixed string the list and detail routes send (source reasons and names, the 404
    detail, the coastal gauge caveat) is a ``copy.py`` constant under this guard; catalog and the routes read them
    from there. They are not CONTRACT 16.14 names yet (the integration adds them from the contract5 note)."""
    from fire3d.api import floods as api_floods
    from fire3d.floods import catalog as cat

    assert not set(fcopy.LIST_STRINGS) & set(fcopy.CONTRACT_STRINGS)
    for name, text in fcopy.LIST_STRINGS.items():
        assert guard(text) == [] and getattr(fcopy, name) == text, name
    for text in fcopy.SOURCE_NAMES.values():
        assert guard(text) == []
    assert cat.RFC_DOWN == fcopy.RFC_DOWN and cat.PAST_NOT_YET == fcopy.PAST_NOT_YET
    assert set(cat.STALE_REASON.values()) <= set(fcopy.LIST_STRINGS.values()) and cat.SOURCE_NAMES is fcopy.SOURCE_NAMES
    src = Path(api_floods.__file__).read_text() + Path(cat.__file__).read_text()
    for text in fcopy.LIST_STRINGS.values():
        assert text not in src                                       # no second copy of a sent string
    assert "No NWS flood product names" not in fcopy.GAUGE_ONLY_COASTAL_CAVEAT        # never claims D1's absence


@pytest.mark.parametrize("planted", ["This area is safe.", "Low risk here.", "All clear now.", "The river has receded.",
                                     "Flooding ended at noon.", "Dry ground.", "No flooding here.", "Proceed safely.",
                                     "AREA OF MINIMAL FLOOD HAZARD"])
def test_the_guard_catches_a_planted_word(planted: str) -> None:
    assert guard(f"{fcopy.NO_PRODUCT} {planted}") != []


@pytest.mark.parametrize("fine", ["Not an all-clear. Follow local officials.", "The warning was extended.",
                                  "Officials recommended moving to higher ground.", "Unknown, not dry.",
                                  "Clouds hide water: dry pixels do not mean no flooding."])
def test_the_guard_keeps_allowed_and_unrelated_words(fine: str) -> None:
    assert guard(fine) == []


def _own_voice(obj, path: str = "") -> list[tuple[str, str]]:
    """Every string in a canned answer except NWS-style verbatim text, identifiers and enum values (the web maps
    those to its own words)."""
    verbatim = {"headline", "nws_headline", "description", "instruction", "area_desc", "statement", "name", "id",
                "url", "url_template", "event", "zone_subty", "fld_zone"}
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in verbatim:
                continue
            out += _own_voice(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out += _own_voice(v, f"{path}[{i}]")
    elif isinstance(obj, str) and not re.fullmatch(r"[a-z0-9_]+", obj):     # enum values ("ended" phase) are data
        out.append((path, obj))
    return out


def test_canned_fixture_answers_pass_the_guard(flood_fixture_bundle: Path) -> None:
    for p in sorted((flood_fixture_bundle / "api").rglob("*.json")):
        for path, text in _own_voice(orjson.loads(p.read_bytes())):
            assert guard(text) == [], (p.name, path, text)
