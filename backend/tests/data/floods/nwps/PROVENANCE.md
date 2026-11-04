# Flood samples: river gauges and forecasts

Recorded 2026-11-04T22:16:03Z by `backend/scripts/record_test_samples_floods.py` (0 real requests through `fire3d.http`, one at a time, User-Agent "Fire-3d/0.1 test-sample recorder", no key or token). Public domain U.S. Government data (National Weather Service, NOAA National Water Prediction Service); the IEM file is the Iowa Environmental Mesonet's public-domain copy (https://mesonet.agron.iastate.edu/disclaimer.php).

* `riv_gauges_observed.json`, `riv_gauges_forecast.json`: `riv_gauges` layers 0 and 15, status action or worse (97 and 86 gauges), untrimmed.
* `rfc_max_forecast.json`: `rfc/rfc_max_forecast` layer 0, every point (88), untrimmed.
* `iem_current_flood_warnings.json`: IEM current point Flood Warnings (22), untrimmed.
* `riv_gauges_bbox.json`: `riv_gauges` layer 0 envelope `-99.30,47.80,-98.50,48.40` (around DCBN8), every status (9 gauges), untrimmed.
* `nwps_gauge_DCBN8.json`: `/gauges/DCBN8` (historic and recent crests cut to 8 each, `images` dropped); `nwps_stageflow_DCBN8.json`: `/gauges/DCBN8/stageflow` (observed cut to the last 72 h; forecast untrimmed).
* `nwps_gauge_AGYM7.json`: `/gauges/AGYM7` (historic and recent crests cut to 8 each, `images` dropped); `nwps_stageflow_AGYM7.json`: `/gauges/AGYM7/stageflow` (observed cut to the last 72 h; forecast untrimmed).
* `nwps_reach_14299883_short_range.json`: `/reaches/14299883/streamflow?series=short_range` (National Water Model output), untrimmed.
