"""Backend-sent fixed strings and credit lines for floods (CONTRACT 16.14 and 16.15, PLAN-5 section 5 "(B)").

These texts cross the HTTP contract: the web shows them as sent. Every string keeps the safety rules of PLAN-5 5.1
(never an all-clear, never "safe" or "low risk"; outside the mapped area is unknown, not absent);
``tests/test_floods_copy.py`` checks them word for word against CONTRACT 16.14 and bans 5.1's patterns with word
boundaries. ``{...}`` slots are filled with absolute times only (never a relative age such as "4 d ago": the web adds
ages at render time, C16).
"""

from __future__ import annotations

from typing import Any

# ----------------------------------------------------------------------------------------------------------------
# CONTRACT 16.14 (exact)
# ----------------------------------------------------------------------------------------------------------------
FLOOD_NWS_DOWN = ("NWS flood warnings could not be reached right now; floods are listed from river gauges only. "
                  "That is not an all-clear.")
FLOOD_GAUGES_DOWN = ("River gauges could not be reached right now; floods are listed from NWS products only. "
                     "That is not an all-clear.")
FLOOD_LISTS_DOWN = ("The flood lists (NWS warnings and river gauges) could not be reached right now. Not an all-clear: "
                    "follow local officials.")
FLOOD_LISTS_503 = "The flood lists could not be reached right now; try again later."
GAUGE_ONLY_CAVEAT = "No NWS flood product names this gauge right now."
NO_PRODUCT = "No NWS flood product here right now. That is not an all-clear: follow local officials."
ALERTS_UNAVAILABLE = "NWS flood products could not be reached right now. That is not an all-clear: follow local officials."
GAUGES_UNAVAILABLE = "River gauge readings could not be loaded right now. That is not an all-clear."
RFC_FIM_UNAVAILABLE = "The NWS forecast flooded-area map could not be loaded right now. That is not an all-clear."
CATFIM_UNAVAILABLE = "NWS category flood maps could not be loaded right now."
ZONES_AS_COUNTIES = "Drawn as whole counties; NWS's own zones may be smaller."
OR_EVAC_FIRE_ONLY = ("Oregon's evacuation feed covers wildfires only; flood evacuations are not shown here. Not an "
                     "all-clear: follow local officials.")
THRESHOLDS_TODAY = "Flood stages shown are NWS's current values; they may have differed then."
GAUGE_NOT_ALL_CLEAR = "A gauge below flood stage is not an all-clear."
USGS_429 = "USGS data could not be reached right now (too many requests); try later."
PAST_NO_FORECAST = "River forecasts are not kept for past dates."
RFC_FIM_NOTE = ("Where NWS river forecasts say water could reach in the next 5 days (the most at any time). A forecast, "
                "not today's water. NWS calls this map experimental.")
RFC_FIM_OUTSIDE = "Outside NWS's mapped area, flooding is unknown, not absent."
CATFIM_NOTE = "What NWS maps for {category} flooding at this gauge (experimental map library). Not a forecast."
SAT_CAVEAT = ("Water seen by satellite (NASA OPERA), {date_time}. It includes the river's normal water. Clouds ({n}% of "
              "this area), trees, buildings and the days between passes hide water: dry pixels do not mean no flooding.")
SAT_NOT_SET_UP = ("NASA Earthdata login is not set up on this server. Fire-3d shows NASA's public optical images "
                  "(Landsat and Sentinel-2), which cannot see through clouds and arrive about a day later. Radar images "
                  "that see through clouds need the login.")
SAT_LOGIN_REFUSED = ("The NASA Earthdata login on this server was refused (it may have expired). Fire-3d shows NASA's "
                     "public optical images only until it is renewed.")
SAT_UNAVAILABLE = "Satellite water could not be loaded right now. That is not an all-clear."
NFHL_NOTE = ("FEMA's 1%-annual-chance (100-year) floodplain, used for flood insurance. It is not a map of current "
             "flooding, and places outside it can flood. Provided as is by FEMA.")
NFHL_NO_MAP = "FEMA has no digital flood map here."
NFHL_DOWN = "FEMA flood zones could not be loaded right now."
MODEL_LABEL = "Model output (NOAA National Water Model) · experimental"
MODEL_CAVEAT = ("Experimental model output (NOAA National Water Model). It is not an NWS forecast and not advice on "
                "when to evacuate. Follow local officials.")

# Every CONTRACT 16.14 name -> text (the copy test compares this table with the contract word for word).
CONTRACT_STRINGS: dict[str, str] = {
    "FLOOD_NWS_DOWN": FLOOD_NWS_DOWN, "FLOOD_GAUGES_DOWN": FLOOD_GAUGES_DOWN, "FLOOD_LISTS_DOWN": FLOOD_LISTS_DOWN,
    "FLOOD_LISTS_503": FLOOD_LISTS_503, "GAUGE_ONLY_CAVEAT": GAUGE_ONLY_CAVEAT, "NO_PRODUCT": NO_PRODUCT,
    "ALERTS_UNAVAILABLE": ALERTS_UNAVAILABLE, "GAUGES_UNAVAILABLE": GAUGES_UNAVAILABLE,
    "RFC_FIM_UNAVAILABLE": RFC_FIM_UNAVAILABLE, "CATFIM_UNAVAILABLE": CATFIM_UNAVAILABLE,
    "ZONES_AS_COUNTIES": ZONES_AS_COUNTIES, "OR_EVAC_FIRE_ONLY": OR_EVAC_FIRE_ONLY, "THRESHOLDS_TODAY": THRESHOLDS_TODAY,
    "GAUGE_NOT_ALL_CLEAR": GAUGE_NOT_ALL_CLEAR, "USGS_429": USGS_429, "PAST_NO_FORECAST": PAST_NO_FORECAST,
    "RFC_FIM_NOTE": RFC_FIM_NOTE, "RFC_FIM_OUTSIDE": RFC_FIM_OUTSIDE, "CATFIM_NOTE": CATFIM_NOTE,
    "SAT_CAVEAT": SAT_CAVEAT, "SAT_NOT_SET_UP": SAT_NOT_SET_UP, "SAT_LOGIN_REFUSED": SAT_LOGIN_REFUSED,
    "SAT_UNAVAILABLE": SAT_UNAVAILABLE, "NFHL_NOTE": NFHL_NOTE, "NFHL_NO_MAP": NFHL_NO_MAP, "NFHL_DOWN": NFHL_DOWN,
    "MODEL_LABEL": MODEL_LABEL, "MODEL_CAVEAT": MODEL_CAVEAT,
}


# ----------------------------------------------------------------------------------------------------------------
# Other backend-sent strings of the flood list and detail routes (review BFS-R8; not yet in CONTRACT 16.14: the
# integration adds them from docs/redesign/contract5/backend-flood-sources.md). Same guard as above.
# ----------------------------------------------------------------------------------------------------------------
# FloodSummary.caveat of a gauge-only flood at a gauge that may measure tidal or lake water (review BFS-R2): Fire-3d
# does not read NWS Coastal Flood or Lakeshore Flood products (PLAN-5 D1), so it never says that none names it.
GAUGE_ONLY_COASTAL_CAVEAT = ("No NWS Flood or Flash Flood product names this gauge right now. It may measure tidal or "
                             "lake water: Fire-3d does not read NWS Coastal Flood or Lakeshore Flood products, which "
                             "may be in effect here.")
# FloodListSource.reason texts
RFC_DOWN = "NWS river forecast points could not be reached right now; forecast flood categories may be missing."
STALE_NWS = "NWS flood products could not be refreshed right now; an earlier copy is shown."
STALE_GAUGES = "River gauges could not be refreshed right now; an earlier copy is shown."
STALE_RFC = "NWS river forecasts could not be refreshed right now; an earlier copy is shown."
STALE_IEM = "IEM's copy of NWS flood warnings could not be refreshed right now; an earlier copy links the gauges."
IEM_JOIN_DOWN = ("IEM's copy of NWS flood warnings could not be reached right now; some river gauges may not be linked "
                 "to their NWS warning.")
PAST_NOT_YET = "Fire-3d does not list past floods yet. That is not an all-clear."
# HTTP 404 detail of GET /api/floods/{id} (the web shows its own FLOOD_NOT_LISTED)
FLOOD_NOT_LISTED_DETAIL = "This flood is not listed."
# FloodListSource.name per source id (the live list's IEM entry is its H-VTEC join, review BFS-R10)
SOURCE_NAMES: dict[str, str] = {
    "nws_alerts": "National Weather Service",
    "nwps_gauges": "NOAA National Water Prediction Service (NWS)",
    "rfc_forecasts": "NWS River Forecast Centers",
    "iem_archive": "Iowa Environmental Mesonet (archived NWS products)",
}
IEM_JOIN_NAME = "Iowa Environmental Mesonet (copy of NWS flood warnings, used to link river gauges)"
LIST_STRINGS: dict[str, str] = {
    "GAUGE_ONLY_COASTAL_CAVEAT": GAUGE_ONLY_COASTAL_CAVEAT, "RFC_DOWN": RFC_DOWN, "STALE_NWS": STALE_NWS,
    "STALE_GAUGES": STALE_GAUGES, "STALE_RFC": STALE_RFC, "STALE_IEM": STALE_IEM, "IEM_JOIN_DOWN": IEM_JOIN_DOWN,
    "PAST_NOT_YET": PAST_NOT_YET, "FLOOD_NOT_LISTED_DETAIL": FLOOD_NOT_LISTED_DETAIL, "IEM_JOIN_NAME": IEM_JOIN_NAME,
}


# ----------------------------------------------------------------------------------------------------------------
# Backend-sent strings of the bundle and the per-flood routes (backend-flood-bundle-api; not yet in CONTRACT 16.14:
# the integration adds them from docs/redesign/contract5/backend-flood-bundle-api.md). Same guard as above.
# ----------------------------------------------------------------------------------------------------------------
# RiverGaugesResponse.caveats
GAUGE_DETAIL_DOWN = ("NOAA's gauge detail service could not be reached right now; this gauge shows the NWS gauge map's "
                     "reading only (no forecast, no impacts). That is not an all-clear.")
NEARBY_GAUGES_DOWN = "Gauges near this flood could not be loaded right now. That is not an all-clear."
# SatelliteWaterResponse.reason
SAT_NO_IMAGE = ("NASA has no usable satellite water image of this area from the last 10 days (no pass, or no view of "
                "it). That is not an all-clear.")
SAT_BEFORE_ARCHIVE = "NASA's satellite water images start in 2023; none exists for this date."
# FloodMapResponse / ModelOutputResponse reasons for past dates and outages
RFC_FIM_PAST = "NWS forecast flooded-area maps are not kept for past dates."
CATFIM_TODAY = ("NWS category flood maps are a static library: this is today's map, not one made at that time. "
                "Not a forecast.")
MODEL_PAST = "National Water Model output is not kept here for past dates."
MODEL_DOWN = "National Water Model output could not be loaded right now."
MODEL_NO_REACH = "This gauge has no National Water Model reach, so there is no model series for it."
NFHL_PARTLY_MAPPED = ("FEMA's digital flood map covers only part of this area; outside it, FEMA's floodplain is not "
                      "shown.")
ALERTS_PAST_NOT_YET = ("Past NWS flood products are not served yet (the archive comes with a later step). That is not "
                       "an all-clear: follow local officials.")
# HTTP error details of the build and per-flood routes
BUILD_SYNTHETIC = "This is a synthetic bundle (test data); it cannot be rebuilt."
BUILD_OUTSIDE_L48 = "Fire-3d prepares floods in the lower 48 states and DC only."
FLOOD_ROUTE_NOT_LISTED = "This flood is not listed."
GAUGE_NOT_FOUND = "NOAA has no river gauge with this id."
SATELLITE_IMAGE_GONE = "This satellite image is no longer kept; reload the flood to get the newest one."
# FloodLayerStatus.reason of bundle layers
TERRAIN_DOWN = "Terrain (USGS 3DEP) could not be loaded; the 3D view needs it."
NAIP_DOWN = "The aerial photo (USGS NAIP) could not be loaded for this area."
GAUGES_NONE = "This flood has no river gauge."
BUNDLE_STRINGS: dict[str, str] = {
    "GAUGE_DETAIL_DOWN": GAUGE_DETAIL_DOWN, "NEARBY_GAUGES_DOWN": NEARBY_GAUGES_DOWN, "SAT_NO_IMAGE": SAT_NO_IMAGE,
    "SAT_BEFORE_ARCHIVE": SAT_BEFORE_ARCHIVE, "RFC_FIM_PAST": RFC_FIM_PAST, "CATFIM_TODAY": CATFIM_TODAY,
    "MODEL_PAST": MODEL_PAST, "MODEL_DOWN": MODEL_DOWN, "MODEL_NO_REACH": MODEL_NO_REACH,
    "NFHL_PARTLY_MAPPED": NFHL_PARTLY_MAPPED, "ALERTS_PAST_NOT_YET": ALERTS_PAST_NOT_YET,
    "BUILD_SYNTHETIC": BUILD_SYNTHETIC, "BUILD_OUTSIDE_L48": BUILD_OUTSIDE_L48,
    "FLOOD_ROUTE_NOT_LISTED": FLOOD_ROUTE_NOT_LISTED, "GAUGE_NOT_FOUND": GAUGE_NOT_FOUND,
    "SATELLITE_IMAGE_GONE": SATELLITE_IMAGE_GONE, "TERRAIN_DOWN": TERRAIN_DOWN, "NAIP_DOWN": NAIP_DOWN,
    "GAUGES_NONE": GAUGES_NONE,
}


def catfim_note(category: str) -> str:
    """CATFIM_NOTE for a category ("moderate")."""
    return CATFIM_NOTE.format(category=category)


def sat_caveat(date_time: str, cloud_pct: float | int | None) -> str:
    """SAT_CAVEAT with the image's absolute date and time (in the flood's zone, e.g. "Oct 31, 2026, 4:06 PM MDT")
    and the cloud share of the area (rounded; "?" when unknown). Never a relative age."""
    n = "?" if cloud_pct is None else str(int(round(float(cloud_pct))))
    return SAT_CAVEAT.format(date_time=date_time, n=n)


# ----------------------------------------------------------------------------------------------------------------
# CONTRACT 16.15: sources and credit lines (exact). OfficialSource dicts {name, url, credit, license?, terms_url?}.
# ----------------------------------------------------------------------------------------------------------------
NWS_TERMS = "https://www.weather.gov/disclaimer"
CREDIT_NWS = "National Weather Service"
CREDIT_IEM = "National Weather Service, archived copy via the Iowa Environmental Mesonet (Iowa State University)"
CREDIT_NWPS = "NOAA National Water Prediction Service (NWS)"
CREDIT_NWC_EXPERIMENTAL = "NOAA/NWS National Water Center (experimental)"
CREDIT_NWM = "NOAA/NWS National Water Center, National Water Model (experimental model output)"
CREDIT_NFHL = "Flood zones: FEMA National Flood Hazard Layer (effective)"
CREDIT_OPERA_HLS = ("Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1); contains "
                    "modified Copernicus Sentinel data")
CREDIT_OPERA_S1 = "NASA JPL OPERA DSWx-S1 (PO.DAAC); contains modified Copernicus Sentinel data"
CREDIT_USGS = "U.S. Geological Survey (provisional data)"
USGS_OBSERVATIONS = "Observations courtesy of U.S. Geological Survey"


def rfc_credit(rfc_name: str | None, office: str | None) -> str:
    """"NWS <RFC name>, issued by NWS <office>" (16.15); the parts that are known."""
    parts = [f"NWS {rfc_name}" if rfc_name else "NWS River Forecast Center"]
    if office:
        parts.append(f"issued by NWS {office}")
    return ", ".join(parts)


SOURCE_NWS: dict[str, Any] = {
    "name": "National Weather Service", "url": "https://www.weather.gov/", "credit": CREDIT_NWS,
    "license": "U.S. Government work in the public domain", "terms_url": NWS_TERMS,
}
SOURCE_IEM: dict[str, Any] = {
    "name": "NWS products, archived copy: Iowa Environmental Mesonet", "url": "https://mesonet.agron.iastate.edu/vtec/",
    "credit": CREDIT_IEM,
    "license": "Public domain (IEM: \"may be used freely by anyone for any lawful purpose\"); not an official NWS source",
    "terms_url": "https://mesonet.agron.iastate.edu/disclaimer.php",
}
SOURCE_NWPS: dict[str, Any] = {
    "name": "NOAA National Water Prediction Service", "url": "https://water.noaa.gov/", "credit": CREDIT_NWPS,
    "license": "U.S. Government work in the public domain", "terms_url": NWS_TERMS,
}
SOURCE_RFC_FIM: dict[str, Any] = {
    "name": "NWS forecast flooded area (RFC-based 5-day maximum inundation extent, experimental)",
    "url": "https://maps.water.noaa.gov/server/rest/services/rfc/rfc_based_5day_max_inundation_extent/MapServer",
    "credit": CREDIT_NWC_EXPERIMENTAL, "license": "U.S. Government work in the public domain", "terms_url": NWS_TERMS,
}
SOURCE_CATFIM: dict[str, Any] = {
    "name": "NWS category flood maps (static stage-based CatFIM, experimental)",
    "url": "https://maps.water.noaa.gov/server/rest/services/fim_libs/static_stage_based_catfim/MapServer",
    "credit": CREDIT_NWC_EXPERIMENTAL, "license": "U.S. Government work in the public domain", "terms_url": NWS_TERMS,
}
SOURCE_NFHL: dict[str, Any] = {
    "name": "FEMA National Flood Hazard Layer", "url": "https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS",
    "credit": CREDIT_NFHL,
    "license": "Provided \"as is\" by FEMA; the user assumes all risk related to the use of this data",
    "terms_url": "https://www.arcgis.com/home/item.html?id=ae38b6f94eaf4abf97f986fa01921e13",
}
SOURCE_OPERA_HLS: dict[str, Any] = {
    "name": "NASA JPL OPERA DSWx-HLS (water seen by satellite)", "url": "https://podaac.jpl.nasa.gov/OPERA",
    "credit": CREDIT_OPERA_HLS, "license": "NASA open data (CC0); please cite",
    "terms_url": "https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance",
}
SOURCE_NWM: dict[str, Any] = {
    "name": "NOAA National Water Model (experimental model output)", "url": "https://water.noaa.gov/about/nwm",
    "credit": CREDIT_NWM, "license": "U.S. Government work in the public domain",
    "terms_url": "https://water.noaa.gov/about/api",
}
SOURCE_USGS: dict[str, Any] = {
    "name": "U.S. Geological Survey water data", "url": "https://waterdata.usgs.gov/", "credit": CREDIT_USGS,
    "license": "U.S. Public Domain; provisional data are subject to revision",
    "terms_url": "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
}
