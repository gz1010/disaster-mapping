"""Flood event grouping (PLAN-5 3.2 rules 1-12, CONTRACT 16.8): which NWS products and river gauges form one flood.

Every rule is a named constant and a small function with a test. Inputs are normalised dicts (``sources.nws`` flood
alerts, ``sources.nwps`` gauge rows); nothing here makes a request.
"""

from __future__ import annotations

import math
import re
from typing import Any, Iterable

# ----------------------------------------------------------------------------------------------------------------
# Rank (CONTRACT 16.8 floodRank: backend sort and web markers)
# ----------------------------------------------------------------------------------------------------------------
RANK_EMERGENCY = 1000
RANK_CATEGORY = {"major": 400, "moderate": 300, "minor": 100}
RANK_FLASH_WARNING = 200
RANK_LEVEL = {"warning": 50, "advisory": 20, "gauge_only": 10, "watch": 0}
RANK_GAUGES_MAX = 9


def _flash_warning_in_effect(products: Iterable[dict[str, Any]]) -> bool:
    return any(p.get("event") == "Flash Flood Warning" and p.get("phase") == "in_effect" for p in products)


def flood_rank(s: dict[str, Any]) -> int:
    """``emergency`` 1000 + max category (major 400 / moderate 300 / minor 100) + a Flash Flood Warning in effect 200
    + level (warning 50 / advisory 20 / gauge_only 10 / watch 0) + min(gauges in flood, 9)."""
    return (RANK_EMERGENCY * bool(s.get("emergency"))
            + RANK_CATEGORY.get(s.get("max_category") or "", 0)
            + RANK_FLASH_WARNING * _flash_warning_in_effect(s.get("products") or [])
            + RANK_LEVEL.get(s.get("level") or "", 0)
            + min(int(s.get("gauges_in_flood") or 0), RANK_GAUGES_MAX))


def rank_key(s: dict[str, Any]) -> tuple[int, int, str]:
    """Sort key: rank high first, then ``updated_ms`` newest first, then id (stable)."""
    return (-flood_rank(s), -(s.get("updated_ms") or 0), str(s.get("id") or ""))


def sort_floods(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=rank_key)


# ----------------------------------------------------------------------------------------------------------------
# Constants (CONTRACT 16.8)
# ----------------------------------------------------------------------------------------------------------------
GAUGE_EVENT_MIN = "minor"            # a gauge at minor or worse starts a flood
GAUGE_SHOW_MIN = "action"            # a gauge at action is shown and joins a flood, never starts one (D3)
LINK_BUFFER_KM = 2.0
SAME_RIVER_KM = 25.0
AREAL_OVERLAP = 0.30
AREAL_NEAR_KM = 10.0
AREAL_NEAR_H = 12
GAUGE_ACTIVE_H = 6
INACTIVE_LISTED_H = 48
# Rule 10 continuation: a new flash or areal flood over (AREAL_OVERLAP) one of these kinds that left the lists within
# INACTIVE_LISTED_H keeps its id (NWS replaced a warning with a new one; catalog.continuations)
CONTINUE_KINDS = ("flash", "areal")
H_MS = 3_600_000
# A gauge-only flood at a gauge that may measure tidal or lake water (review BFS-R2): Fire-3d does not read NWS
# Coastal Flood or Lakeshore Flood products (D1), so it never says that no NWS flood product names such a gauge.
TIDAL_PE_CODES = ("HM", "HC")        # SHEF codes of tidal / coastal water levels (every one in the recorded answers)
COASTAL_NEAR_KM = 10.0               # a gauge this close to a recognised tide gauge may be tidal too
CATEGORY_ORDER = ("action", "minor", "moderate", "major")
LEVEL_ORDER = ("watch", "advisory", "warning")          # ascending
_RIVER_STOP = {"river", "creek", "fork", "the", "of", "at", "near", "above", "below", "r", "cr", "ck", "bayou", "run",
               "brook", "wash", "slough", "branch", "canal", "ditch", "draw", "stream", "and"}


def cat_rank(cat: str | None) -> int:
    """-1 below action / unknown, 0 action ... 3 major."""
    return CATEGORY_ORDER.index(cat) if cat in CATEGORY_ORDER else -1


def river_tokens(name: str | None) -> frozenset[str]:
    """Significant lower-case words of a river name ("San Juan River" -> {"san", "juan"}; "North Fork X" keeps
    "north")."""
    import re as _re

    return frozenset(w for w in _re.findall(r"[a-z0-9]+", (name or "").lower()) if w not in _RIVER_STOP)


def same_river(a: str | None, b: str | None) -> bool:
    """Two river names are the same river: equal significant words (strict, so North and South Fork differ); names
    that name no river ("Tide Station") never match."""
    from .naming import clean_water

    a, b = clean_water(a), clean_water(b)
    ta, tb = river_tokens(a), river_tokens(b)
    return bool(ta) and ta == tb


def river_matches(gauge_waterbody: str | None, text_river: str | None) -> bool:
    """A gauge's ``waterbody`` matches a river named in NWS text: one's significant words contain the other's."""
    ta, tb = river_tokens(gauge_waterbody), river_tokens(text_river)
    return bool(ta) and bool(tb) and (ta <= tb or tb <= ta)


# ----------------------------------------------------------------------------------------------------------------
# Geometry in km (local equirectangular frame)
# ----------------------------------------------------------------------------------------------------------------
def _frame(lon0: float, lat0: float):
    import math

    import numpy as np

    k = 111.32 * math.cos(math.radians(lat0))
    return lambda xy: np.column_stack(((xy[:, 0] - lon0) * k, (xy[:, 1] - lat0) * 111.32))


def to_km(geom: Any, lon0: float, lat0: float) -> Any:
    import shapely

    return shapely.transform(geom, _frame(lon0, lat0))


def distance_km(a: Any, b: Any) -> float:
    """Distance between two lon/lat geometries in km (0 when they touch)."""
    c = a.representative_point()
    return float(to_km(a, c.x, c.y).distance(to_km(b, c.x, c.y)))


def overlap_share(a: Any, b: Any) -> float:
    """Area of a ∩ b over the smaller of the two (0..1)."""
    if a is None or b is None or not a.intersects(b):
        return 0.0
    c = a.representative_point()
    ka, kb = to_km(a, c.x, c.y), to_km(b, c.x, c.y)
    small = min(ka.area, kb.area)
    return float(ka.intersection(kb).area / small) if small > 0 else 0.0


def point_in_buffer(lon: float, lat: float, geom: Any, km: float) -> bool:
    from shapely.geometry import Point

    return to_km(geom, lon, lat).distance(Point(0.0, 0.0)) <= km


# ----------------------------------------------------------------------------------------------------------------
# Rule 1: keep (lower 48 + DC, actual, in effect or upcoming)
# ----------------------------------------------------------------------------------------------------------------
def keep_product(a: dict, phase: str, l48: set[str], geom_states: Iterable[str] | None = None) -> bool:
    """An actual product in effect or upcoming with a UGC in a lower-48 state or DC whose area touches the lower 48."""
    if a.get("status") != "Actual" or phase not in ("in_effect", "upcoming"):
        return False
    ugc_states = {u[:2] for u in a.get("ugcs") or [] if isinstance(u, str) and len(u) >= 2}
    if not ugc_states & l48:
        return False
    if geom_states is not None:
        return bool(set(geom_states) & l48)
    return True


def keep_gauge(row: dict, l48: set[str]) -> bool:
    return row.get("state") in l48


# ----------------------------------------------------------------------------------------------------------------
# Tide and lake-shore gauges (review BFS-R2)
# ----------------------------------------------------------------------------------------------------------------
# "Steele Point (in MHHW)", "Georgetown (in NAVD88)", "Annapolis (IN MLLW)": a water level on a tidal datum
TIDAL_DATUM_RE = re.compile(r"\((?:in\s+)?(?:MHHW|MLLW|MHW|MLW|MSL|NAVD\s*-?\s*88)\)", re.IGNORECASE)
# Words of a waterbody that is the sea, an estuary or a Great Lake ("Atlantic Ocean Tide Gauge", "Juno Beach Park Pier")
COASTAL_WATER_RE = re.compile(
    r"\b(?:tide|tidal|pier|intracoastal|ocean|gulf|bay|sound|harbou?r|inlet|lagoon|beach|coast|"
    r"lake\s+(?:superior|michigan|huron|erie|ontario))\b", re.IGNORECASE)


def is_tidal_row(row: dict) -> bool:
    """A ``riv_gauges`` row that measures tidal, coastal or Great Lakes water: a SHEF tide / coastal code (HM, HC), a
    tidal datum note in its location or waterbody, or a coastal word in its waterbody ("Atlantic Ocean Tide Gauge",
    "Juno Beach Park Pier", "Intracoastal Waterway"). Locations are town names ("Beaver Bay"): only datum notes count
    there."""
    pe = (row.get("pedts") or "")[:2].upper()
    loc, wb = row.get("name") or "", row.get("waterbody") or ""
    return pe in TIDAL_PE_CODES or bool(TIDAL_DATUM_RE.search(f"{loc} {wb}")) or bool(COASTAL_WATER_RE.search(wb))


def coastal_lids(rows: Iterable[dict]) -> set[str]:
    """The gauges that may measure tidal or lake water: :func:`is_tidal_row`, or within :data:`COASTAL_NEAR_KM` of
    such a gauge (Crescent Lake beside the tidal St. Johns, the Loxahatchee 7 km from a pier's tide gauge)."""
    rows = [r for r in rows if r.get("lid") and r.get("lat") is not None and r.get("lon") is not None]
    tidal = [r for r in rows if is_tidal_row(r)]
    out = {r["lid"] for r in tidal}
    for r in rows:
        if r["lid"] in out:
            continue
        k = 111.32 * math.cos(math.radians(r["lat"]))
        if any(math.hypot((r["lon"] - t["lon"]) * k, (r["lat"] - t["lat"]) * 111.32) <= COASTAL_NEAR_KM for t in tidal):
            out.add(r["lid"])
    return out


def ref_looks_tidal(ref: dict) -> bool:
    """:func:`is_tidal_row` on a ``FloodGaugeRef`` (no SHEF code there: datum notes and words only)."""
    return is_tidal_row({"name": ref.get("name"), "waterbody": ref.get("waterbody")})


# ----------------------------------------------------------------------------------------------------------------
# Product classes
# ----------------------------------------------------------------------------------------------------------------
def product_class(a: dict) -> str:
    """"watch" (any *.A), "river" (FL.W / FL.Y), "flash" (FF.W) or "areal" (FA.W / FA.Y); by event name without VTEC."""
    v = a.get("vtec") or {}
    ph, sig = v.get("phenomena"), v.get("significance")
    if not ph:
        ev = (a.get("event") or "").lower()
        if "watch" in ev:
            return "watch"
        return "flash" if ev.startswith("flash flood warning") else "areal"
    if sig == "A":
        return "watch"
    return {"FL": "river", "FF": "flash"}.get(ph, "areal")


def product_level(a: dict) -> str:
    v = a.get("vtec") or {}
    sig = v.get("significance")
    if sig in ("W", "Y", "A"):
        return {"W": "warning", "Y": "advisory", "A": "watch"}[sig]
    ev = (a.get("event") or "").lower()
    return "watch" if "watch" in ev else ("advisory" if "advisory" in ev else "warning")


def ref_level(p: dict) -> str:
    """:func:`product_level` of a ``FloodProductRef`` (significance from its VTEC key, else its event name)."""
    parts = (p.get("vtec_key") or "").split(".")
    return product_level({"vtec": {"significance": parts[2]} if len(parts) == 5 else None, "event": p.get("event")})


def issued_ms(a: dict) -> int | None:
    """When NWS first issued a product's event (rule 3's ``AREAL_NEAR_H``; review BFS-R7): the oldest message of its
    CAP ``references`` chain, else its VTEC begin when that is not after this message, else this message's own sent
    time. A CON / EXT update resets ``sent`` but not the issue time, so an update never splits a joined flood."""
    refs = [r["sent_ms"] for r in a.get("_references") or [] if r.get("sent_ms")]
    sent = a.get("sent_ms")
    if refs:
        return min(refs + ([sent] if sent else []))
    begin = a.get("_vtec_begin_ms")
    if begin and (sent is None or begin <= sent):
        return begin
    return sent


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, x: str) -> None:
        self.parent.setdefault(x, x)

    def find(self, x: str) -> str:
        self.add(x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)

    def groups(self) -> list[list[str]]:
        out: dict[str, list[str]] = {}
        for x in self.parent:
            out.setdefault(self.find(x), []).append(x)
        return [sorted(v) for _, v in sorted(out.items())]
