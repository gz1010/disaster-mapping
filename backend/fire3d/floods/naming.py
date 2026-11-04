"""Flood names and ids (PLAN-5 3.2 rule 9, CONTRACT 16.1).

Names: river floods "<River> flood" (the primary gauge's ``waterbody``, else the river named in the NWS text); flash
floods "<Place> flash flood" (the first place of the product's "Some locations that will experience flash flooding
include..." line, else the largest gazetteer place inside the polygon, else the nearest within 15 km, else "<County>
County"); areal floods "<Water> flood" ("Flooding along the Silver Creek") else "<Place> flood"; watch-only floods
"Flood watch: <first area> and N more areas". Duplicates get " (ST)". Proper names keep NWS capitals (an ALL CAPS name
is title-cased); names never contain "fire" (such a name falls back to the county).

Ids: ``flood-{YYYYMMDD}-{slug}-{h6}`` (UTC date of the start, slug of the name, first 6 hex of SHA-1 of the anchor).
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any, Iterable

FLOOD_ID_RE = re.compile(r"^flood-\d{8}-[a-z0-9-]+-[0-9a-f]{6}$")
SLUG_MAX = 48
PLACE_NEAR_KM = 15.0
_WATER_WORDS = ("River", "Creek", "Fork", "Bayou", "Run", "Brook", "Wash", "Slough", "Branch", "Canal", "Ditch", "Draw",
                "Arroyo", "Canyon", "Lake", "Stream", "Kill", "Swamp", "Spring", "Springs", "Prong", "Channel")
_WATER = r"(?:" + "|".join(_WATER_WORDS) + r")"
# A river product's segment names its forecast point on its WHERE line ("* WHERE...Grand River near Sumner."); the
# "<River> (at|near|above|below) <Place> affecting <Counties>" lines above it list every river of the whole product.
WHERE_RE = re.compile(r"\*\s*WHERE\.{3}\s*([A-Za-z0-9][A-Za-z0-9 .'&/-]*?)\s+(?:at|near|above|below)\s+[A-Za-z]",
                      re.IGNORECASE)
AFFECTING_RE = re.compile(r"(?m)^\s*([A-Za-z0-9][A-Za-z0-9 .'&/-]*?)\s+(?:at|near|above|below)\s+[^\n]+?\s+affecting\b",
                          re.IGNORECASE)
# Datum notes in gauge names ("Georgetown (in NAVD88)") and waterbody values that name no river ("Tide Station")
DATUM_RE = re.compile(r"\s*\((?:in\s+)?(?:MHHW|MLLW|MHW|MLW|NAVD\s*-?\s*88|NGVD\s*-?\s*29|MSL|STND|ft\.?\s*\w*)\)", re.IGNORECASE)
GENERIC_WATER = frozenset({"tide station", "tidal station", "tide gauge", "tide gage", "tide", "lake level", "reservoir"})
ALONG_RE = re.compile(r"\balong (?:the )?((?:[A-Z][\w'.-]*\s+){0,4}" + _WATER + r")\b")
LOCATIONS_RE = re.compile(r"(?is)some locations that will experience (?:flash )?flooding include\.{0,3}\s*(.+?)(?:\n\s*\n|$)")


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    s = re.sub(r"-{2,}", "-", s)[:SLUG_MAX].strip("-")
    return s or "flood"


def h6(anchor: str) -> str:
    return hashlib.sha1(anchor.encode("utf-8")).hexdigest()[:6]


def make_flood_id(started_ms: int, name: str, anchor: str) -> str:
    """``flood-{YYYYMMDD}-{slug(name)}-{h6(anchor)}``; never parses as a fire id."""
    day = datetime.fromtimestamp(started_ms / 1000, timezone.utc).strftime("%Y%m%d")
    return f"flood-{day}-{slug(name)}-{h6(anchor)}"


def is_flood_id(s: str) -> bool:
    return bool(FLOOD_ID_RE.match(s or ""))


def proper(name: str) -> str:
    """NWS capitals kept; an ALL CAPS name title-cased (short words after the first lower case)."""
    name = re.sub(r"\s+", " ", name).strip(" .,;:-")
    if name.isupper() and len(name) > 3:
        parts = name.title().split(" ")
        small = {"Of", "The", "And", "At", "Near", "De", "La", "Del"}
        name = " ".join(p.lower() if i and p in small else p for i, p in enumerate(parts))
    return name


def _no_fire(name: str | None) -> str | None:
    return name if name and "fire" not in name.lower() else None


def clean_water(name: str | None) -> str | None:
    """A gauge's waterbody for names and joins: datum notes removed; None for values that name no river."""
    if not name:
        return None
    w = proper(DATUM_RE.sub("", name))
    if not w or w.lower() in GENERIC_WATER or re.search(r"\btid(?:e|al)\s+(?:gauge|gage|station)\b", w.lower()):
        return None
    return w


def _river_cand(raw: str) -> str | None:
    cand = proper(raw)
    words = cand.split()
    if 1 <= len(words) <= 6 and any(w.rstrip(".").title() in _WATER_WORDS for w in words):
        return cand
    return None


def river_from_text(*texts: str | None) -> str | None:
    """The river of an NWS river product segment: its WHERE line ("* WHERE...Grand River near Sumner."), else the
    river of its "<River> (at|near|above|below) <Place> affecting ..." lines when they all name the same river."""
    for t in texts:
        m = WHERE_RE.search(t or "")
        if m:
            cand = _river_cand(m.group(1))
            if cand:
                return cand
    for t in texts:
        found = {c for c in (_river_cand(m.group(1)) for m in AFFECTING_RE.finditer(t or "")) if c}
        if len(found) == 1:
            return found.pop()
    return None


def river_from_gauge_name(name: str | None) -> str | None:
    """"San Juan River near Archuleta" -> "San Juan River" (the part before at / near / above / below)."""
    if not name:
        return None
    m = re.match(r"^(.+?)\s+(?:at|near|above|below)\s+", name, flags=re.IGNORECASE)
    return proper(m.group(1)) if m else None


def water_from_text(*texts: str | None) -> str | None:
    """"Flooding along the Silver Creek" -> "Silver Creek"."""
    for t in texts:
        m = ALONG_RE.search(t or "")
        if m:
            return proper(m.group(1))
    return None


def first_location(*texts: str | None) -> str | None:
    """The first place of "Some locations that will experience flash flooding include...", verbatim."""
    for t in texts:
        m = LOCATIONS_RE.search(t or "")
        if not m:
            continue
        first = re.split(r",| and |\.\.\.|\n", m.group(1).strip(), maxsplit=1)[0]
        first = proper(first)
        if first and len(first) <= 60 and not first.lower().startswith(("this includes", "http")):
            return first
    return None


def place_in(geom: Any, county: str | None) -> str | None:
    """The largest gazetteer place inside ``geom`` (shapely, lon/lat), else the nearest within 15 km, else None."""
    try:
        from shapely.geometry import Point

        from ..api.geocode import _km, gazetteer
    except Exception:  # noqa: BLE001 - no gazetteer: name by county
        return None
    gz = gazetteer()
    if gz is None or geom is None or geom.is_empty:
        return None
    w, s, e, n = geom.bounds
    inside = [p for p in gz.places if p.type != "county" and w <= p.lon <= e and s <= p.lat <= n
              and geom.covers(Point(p.lon, p.lat))]
    if inside:
        return max(inside, key=lambda p: (p.land_km2, p.name)).name
    c = geom.representative_point()
    best = None
    for p in gz.places:
        if p.type == "county" or abs(p.lat - c.y) > 0.3 or abs(p.lon - c.x) > 0.4:
            continue
        d = _km(c.y, c.x, p.lat, p.lon)
        if d <= PLACE_NEAR_KM and (best is None or d < best[1]):
            best = (p, d)
    return best[0].name if best else None


def _county_name(county: str | None) -> str | None:
    if not county:
        return None
    return county if re.search(r"\b(County|Parish|Borough|city|City)\b", county) else f"{county} County"


def flood_name(*, kind: str, level: str, rivers: Iterable[str], texts: Iterable[str | None], area_desc: str | None,
               geom: Any, county: str | None) -> str:
    """The display name of a flood (rule 9), before duplicate suffixes."""
    texts = [t for t in texts if t]
    if level == "watch" and kind != "river":
        areas = [a.strip() for a in re.split(r";", area_desc or "") if a.strip()]
        if areas:
            more = len(areas) - 1
            tail = "" if more == 0 else f" and {more} more area" + ("s" if more > 1 else "")
            return f"Flood watch: {areas[0]}{tail}"
    if kind == "river":
        river = next((r for r in rivers if _no_fire(r)), None) or _no_fire(river_from_text(*texts))
        if river:
            return f"{river} flood"
    if kind == "areal":
        water = _no_fire(water_from_text(*texts))
        if water:
            return f"{water} flood"
    place = _no_fire(first_location(*texts)) or _no_fire(place_in(geom, county))
    if place:
        return f"{place} flash flood" if kind == "flash" else f"{place} flood"
    cname = _no_fire(_county_name(county))
    if cname:
        return f"{cname} flash flood" if kind == "flash" else f"{cname} flood"
    return "Flash flood" if kind == "flash" else "Flood"


def dedupe_names(rows: list[dict]) -> None:
    """Two listed floods with the same name get their state: "Animas River flood (CO)" (in place). Floods whose names
    still clash use their place-based name (``_alt_name``, "Bluff flood (UT)") when they have one, then a number."""
    def groups() -> dict[str, list[dict]]:
        seen: dict[str, list[dict]] = {}
        for r in rows:
            seen.setdefault(r["name"], []).append(r)
        return {k: v for k, v in seen.items() if len(v) > 1}

    for name, group in groups().items():
        for r in group:
            if r.get("state"):
                r["name"] = f"{name} ({r['state']})"
    for name, group in groups().items():
        for r in group[1:]:
            alt = r.get("_alt_name")
            if alt and alt != r.get("_base_name"):
                r["name"] = f"{alt} ({r['state']})" if r.get("state") else alt
    for name, group in groups().items():
        for i, r in enumerate(sorted(group, key=lambda x: (x.get("_first_sent") or 0, x.get("_anchor") or "")), start=1):
            if i > 1:
                r["name"] = f"{name[:-1]}, {i})" if name.endswith(")") else f"{name} ({i})"
