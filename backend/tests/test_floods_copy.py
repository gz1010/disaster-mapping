"""Backend-sent flood strings (``fire3d/floods/copy.py``): equal to CONTRACT 16.14 word for word, and free of the
PLAN-5 5.1 banned patterns in Fire-3d's own voice (word boundaries; allowed phrases removed first, longest first).
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


def _contract_table() -> dict[str, str]:
    text = CONTRACT.read_text()
    sec = text[text.index("### 16.14"):text.index("### 16.15")]
    out = {}
    for m in re.finditer(r"^\| `([A-Z0-9_]+)` \| (.+?) \|$", sec, flags=re.MULTILINE):
        out[m.group(1)] = m.group(2).strip()
    return out


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
    assert fcopy.sat_caveat("Oct 31, 2026", None).count("(?% of this area)") == 1
    assert fcopy.catfim_note("major") == ("What NWS maps for major flooding at this gauge (experimental map library). "
                                          "Not a forecast.")


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
