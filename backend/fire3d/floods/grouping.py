"""Flood event grouping (PLAN-5 3.2 rules 1-12, CONTRACT 16.8): which NWS products and river gauges form one flood.

Every rule is a named constant and a small function with a test. Inputs are normalised dicts (``sources.nws`` flood
alerts, ``sources.nwps`` gauge rows); nothing here makes a request.
"""

from __future__ import annotations

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
