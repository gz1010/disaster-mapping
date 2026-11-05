"""Backend-sent strings of brief 6 (flood time history and the 3D terrain products), under the PLAN-5 5.1 wording
guard (``tests/test_floods_timeline.py`` and ``tests/test_floods_terrain3d.py`` scan every string here). Existing
strings of ``floods/copy.py`` (``SAT_CAVEAT``, ``ALERTS_UNAVAILABLE``, ...) are reused there, never repeated here.

Exact texts are listed in ``docs/redesign/contract6/backend-flood-time-3d.md``. Slots ``{…}`` are absolute dates and
times in the flood's own zone (never an age: the web adds ages at render time, C16).
"""

from __future__ import annotations

# ---------------------------------------------------------------------------------------------------------------
# Satellite passes (FloodPassHistory)
# ---------------------------------------------------------------------------------------------------------------
PASS_NO_VIEW = ("No view of this area on this pass (clouds or no data): it shows nothing about the water here. "
                "That is not an all-clear.")
PASSES_NOTE = ("Each satellite image shows the water on its own date only. Nothing is drawn between two passes: "
               "the days between passes are not seen.")
PASSES_NONE = ("NASA has no satellite water pass over this area between {start} and {end}. That is not an "
               "all-clear.")
PASSES_UNAVAILABLE = "Satellite water passes could not be loaded right now. That is not an all-clear."
PASSES_PARTIAL = ("Some satellite passes could not be read yet; their view is shown as unknown. Ask again in a "
                  "minute.")
PASSES_TRUNCATED = ("This flood has more satellite passes than Disaster Mapping lists; the oldest ones are left "
                    "out.")
PASSES_BUNDLE_LIMIT = ("The 3D data keeps the images of the {n} newest passes that saw this area; older passes are "
                       "listed without an image here.")
PASSES_BEFORE_ARCHIVE = "NASA's satellite water images start in 2023; none exists for this flood's dates."
PASSES_SYNTHETIC = "Synthetic test data: simulated satellite passes, not NASA images."
# the bundle's frozen list (review BTD-R5): nothing reads a bundle again, so never "ask again"
PASSES_BUNDLE_UNREAD = ("Some satellite passes were not read for the 3D data (too many passes, or NASA could not be "
                        "reached when it was prepared); their view is shown as unknown here. That is not an all-clear.")

# ---------------------------------------------------------------------------------------------------------------
# NWS product history (FloodProductHistory)
# ---------------------------------------------------------------------------------------------------------------
PRODUCTS_NOTE = ("Each NWS product is shown from the time NWS issued it until its own end time or NWS's next "
                 "version of it. An NWS end time is not a forecast of when flooding stops.")
PRODUCTS_ARCHIVE_DOWN = ("Earlier versions of this flood's NWS products (Iowa Environmental Mesonet archive) could "
                         "not be loaded right now; only the products NWS lists now are shown. That is not an "
                         "all-clear.")
PRODUCTS_ARCHIVE_PARTIAL = ("Earlier versions of some of this flood's NWS products could not be loaded right now. "
                            "That is not an all-clear.")
PRODUCTS_NONE = ("This flood has no NWS flood product (it is listed from a river gauge at flood stage). That is not "
                 "an all-clear: follow local officials.")
PRODUCTS_TRUNCATED = ("This flood has more NWS product versions than Disaster Mapping lists; the oldest ones are "
                      "left out.")
PRODUCTS_EVENTS_TRUNCATED = ("This flood has more NWS product events than Disaster Mapping lists; the oldest "
                             "events are left out.")
# review BTD-R1: NWS's live feed could not be read for an open flood (the answer is not kept; ask again)
PRODUCTS_LIVE_DOWN = ("NWS's current flood products could not be loaded right now; only archived copies are shown and "
                      "the newest may be missing. That is not an all-clear.")

# ---------------------------------------------------------------------------------------------------------------
# 3D terrain products (FloodTerrain3d)
# ---------------------------------------------------------------------------------------------------------------
RELIEF_RULE = ("Height boost: the smallest of ×1.5, ×2, ×3, ×5, ×8 and ×10 that makes the middle 90% of the ground "
               "heights near the mapped water (5th to 95th percentile) span at least 2% of the area's width; ×1.5 "
               "when the ground is already steep enough. At most ×10, so a very flat floodplain can still look flat "
               "at the default: raise the boost or look from closer. Only heights are boosted, never distances.")
RELIEF_AREA_WATER = "ground within {km} km of the mapped water (satellite water and the NWS forecast flooded area)"
RELIEF_AREA_GRID = "the whole 3D area (no mapped water to measure around)"

HAND_LABEL = "Height above the river (from terrain). Not a flood map"
HAND_CAVEAT = ("Height of the ground above the nearest river channel, from the terrain model and NOAA's river "
               "lines. It is not a flood map: low ground is not always flooded, and higher ground can flood (rain, "
               "small streams, drains). Experimental. Not an all-clear.")
HAND_METHOD = ("NOAA National Water Model river lines (stream order {order} and up) are drawn on the terrain grid. "
               "Each channel cell takes the lowest terrain height within one cell of it; every other cell takes the "
               "height of its nearest channel cell in a straight line and shows how far above it the ground is "
               "(below it counts as 0). Cells more than {km} km from a channel are left out. Simplified from Height "
               "Above the Nearest Drainage (Nobre et al., 2011), which follows the downhill flow path instead: near "
               "a ridge between two valleys a cell can be measured against the other valley.")
HAND_NO_LINES = ("Height above the river is not available: NOAA's river lines could not be loaded for this area.")
HAND_NO_CHANNEL = "Height above the river is not available: NOAA lists no river line in this area."
HAND_SOURCE = "Terrain (USGS 3DEP) and river lines (NOAA National Water Model)"
HAND_CITATION = ("Nobre, A. D., et al. (2011). Height Above the Nearest Drainage, a hydrologically relevant new "
                 "terrain model. Journal of Hydrology 404(1-2), 13-29.")

DEPTH_LABEL = "Estimated depth (from the terrain at the water's edge), experimental"
DEPTH_CAVEAT = ("Estimated depth inside the mapped water only: the water surface is taken from the terrain height "
                "along the water's edge and the ground is subtracted (the published FwDET method, Cohen et al.). "
                "Experimental: errors of a metre or more are common, most where the edge runs up a steep bank or "
                "the map and the terrain do not line up. The terrain model shows the river's normal water surface, "
                "not its bed, so depth in the normal channel is not measured. Shallow water here is not an "
                "all-clear. Follow local officials.")
DEPTH_METHOD = ("Cells of the mapped water next to open ground are its edge (edges against clouds, no data, "
                "ocean or the area's border are not used). Each water cell takes the terrain height of its nearest "
                "edge cell as the water surface; depth = water surface − terrain, below 0 counts as 0, then a "
                "3 × 3 average over the water smooths it (FwDET v2.0). Only cells inside the mapped water get a "
                "depth.")
DEPTH_CITATION = ("Cohen, S., et al. (2018). Estimating Floodwater Depths from Flood Inundation Maps and "
                  "Topography. JAWRA 54(4), 847-858, doi:10.1111/1752-1688.12609. Cohen, S., et al. (2019). The "
                  "Floodwater Depth Estimation Tool (FwDET v2.0) for improved remote sensing analysis of coastal "
                  "flooding. NHESS 19, 2053-2065, doi:10.5194/nhess-19-2053-2019.")
DEPTH_SOURCE_SATELLITE = "Water seen by satellite (NASA OPERA), image of {date_time}"
DEPTH_SOURCE_FORECAST = "NWS forecast flooded area (next 5 days, experimental), forecast of {date_time}"
DEPTH_NO_LAYER = "No depth estimate: this water layer is not in the 3D data."
DEPTH_NO_WATER = "No depth estimate: this layer maps no water in this area. That is not an all-clear."
DEPTH_NO_EDGE = ("No depth estimate: the mapped water has no edge on open ground here (it meets clouds, no data or "
                 "the area's border everywhere).")
TIME_NOT_STATED = "time not stated"

# ---------------------------------------------------------------------------------------------------------------
# Bundle build: progress texts, layer descriptions, data-source details and kept copies (review BTD-R12, R2)
# ---------------------------------------------------------------------------------------------------------------
PROGRESS_TIMELINE = "Satellite passes and NWS product versions"
PROGRESS_PASSES_READ = "Satellite passes: {done} of {n} read"
PROGRESS_PRODUCTS = "NWS product versions (live and archive)"
PROGRESS_TIMELINE_DONE = "{passes} satellite passes, {versions} NWS product versions"
PROGRESS_TERRAIN3D = "Height boost, height above the river, depth estimates"
PROGRESS_TERRAIN3D_DONE = "3D terrain products ready"
DESC_PASS = ("Water seen by satellite, {product} pass of {time} (NASA OPERA DSWx WTR classes; 255 = no data or "
             "outside the image)")
DESC_HAND = ("Height above the nearest river channel (simplified HAND; NWM river lines of stream order {order} and "
             "up), 0.1 m steps, 254 = 25.4 m or more, 255 = no value")
DESC_DEPTH = ("Estimated water depth inside {layer} (FwDET, Cohen et al.; experimental), 0.1 m steps, 254 = 25.4 m "
              "or more, 255 = outside the mapped water")
SRC_PASSES = ("{n} satellite passes from {start} to {end}, {kept} kept as images with depth estimates (timeline.json, "
              "layers/water_pass_<pass>.bin, layers/depth_pass_<pass>.bin)")
SRC_IEM_VERSIONS = "{n} earlier versions of this flood's NWS products, verbatim (timeline.json)"
SRC_FLOWLINES = ("National Water Model river lines: {n} reaches (maps/flowlines.geojson; the height-above-the-river "
                 "input)")
REBUILD_KEPT = "The rebuild of {time} could not load {what} again; the earlier copy is kept, with its own times."
KEPT_PASSES = "the satellite pass list and its images"
KEPT_PRODUCTS = "the NWS product versions"
KEPT_FLOWLINES = "NOAA's river lines"

TERRAIN3D_STRINGS: dict[str, str] = {
    "RELIEF_RULE": RELIEF_RULE, "RELIEF_AREA_WATER": RELIEF_AREA_WATER, "RELIEF_AREA_GRID": RELIEF_AREA_GRID,
    "HAND_LABEL": HAND_LABEL, "HAND_CAVEAT": HAND_CAVEAT, "HAND_METHOD": HAND_METHOD, "HAND_NO_LINES": HAND_NO_LINES,
    "HAND_NO_CHANNEL": HAND_NO_CHANNEL, "HAND_SOURCE": HAND_SOURCE, "HAND_CITATION": HAND_CITATION,
    "DEPTH_LABEL": DEPTH_LABEL, "DEPTH_CAVEAT": DEPTH_CAVEAT, "DEPTH_METHOD": DEPTH_METHOD,
    "DEPTH_CITATION": DEPTH_CITATION, "DEPTH_SOURCE_SATELLITE": DEPTH_SOURCE_SATELLITE,
    "DEPTH_SOURCE_FORECAST": DEPTH_SOURCE_FORECAST, "DEPTH_NO_LAYER": DEPTH_NO_LAYER, "DEPTH_NO_WATER": DEPTH_NO_WATER,
    "DEPTH_NO_EDGE": DEPTH_NO_EDGE, "TIME_NOT_STATED": TIME_NOT_STATED,
}

BUILD_STRINGS: dict[str, str] = {
    "PROGRESS_TIMELINE": PROGRESS_TIMELINE, "PROGRESS_PASSES_READ": PROGRESS_PASSES_READ,
    "PROGRESS_PRODUCTS": PROGRESS_PRODUCTS, "PROGRESS_TIMELINE_DONE": PROGRESS_TIMELINE_DONE,
    "PROGRESS_TERRAIN3D": PROGRESS_TERRAIN3D, "PROGRESS_TERRAIN3D_DONE": PROGRESS_TERRAIN3D_DONE,
    "DESC_PASS": DESC_PASS, "DESC_HAND": DESC_HAND, "DESC_DEPTH": DESC_DEPTH, "SRC_PASSES": SRC_PASSES,
    "SRC_IEM_VERSIONS": SRC_IEM_VERSIONS, "SRC_FLOWLINES": SRC_FLOWLINES, "REBUILD_KEPT": REBUILD_KEPT,
    "KEPT_PASSES": KEPT_PASSES, "KEPT_PRODUCTS": KEPT_PRODUCTS, "KEPT_FLOWLINES": KEPT_FLOWLINES,
}

TIMELINE_STRINGS: dict[str, str] = {
    "PASS_NO_VIEW": PASS_NO_VIEW, "PASSES_NOTE": PASSES_NOTE, "PASSES_NONE": PASSES_NONE,
    "PASSES_UNAVAILABLE": PASSES_UNAVAILABLE, "PASSES_PARTIAL": PASSES_PARTIAL, "PASSES_TRUNCATED": PASSES_TRUNCATED,
    "PASSES_BUNDLE_LIMIT": PASSES_BUNDLE_LIMIT, "PASSES_BEFORE_ARCHIVE": PASSES_BEFORE_ARCHIVE,
    "PASSES_SYNTHETIC": PASSES_SYNTHETIC, "PASSES_BUNDLE_UNREAD": PASSES_BUNDLE_UNREAD, "PRODUCTS_NOTE": PRODUCTS_NOTE,
    "PRODUCTS_ARCHIVE_DOWN": PRODUCTS_ARCHIVE_DOWN, "PRODUCTS_ARCHIVE_PARTIAL": PRODUCTS_ARCHIVE_PARTIAL,
    "PRODUCTS_NONE": PRODUCTS_NONE, "PRODUCTS_TRUNCATED": PRODUCTS_TRUNCATED,
    "PRODUCTS_EVENTS_TRUNCATED": PRODUCTS_EVENTS_TRUNCATED, "PRODUCTS_LIVE_DOWN": PRODUCTS_LIVE_DOWN,
}

ALL_STRINGS: dict[str, str] = {**TIMELINE_STRINGS, **TERRAIN3D_STRINGS, **BUILD_STRINGS}


def passes_none(start: str, end: str) -> str:
    return PASSES_NONE.format(start=start, end=end)


def passes_bundle_limit(n: int) -> str:
    return PASSES_BUNDLE_LIMIT.format(n=int(n))
