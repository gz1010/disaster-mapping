# Past-flood test samples (brief 5, backend-flood-live M2)

Recorded by `backend/scripts/record_test_samples_flood_history.py` (Fire-3d User-Agent, no key). Iowa Environmental Mesonet: an archived copy of NWS products (public domain, https://mesonet.agron.iastate.edu/disclaimer.php); NOAA NWS / NWPS (https://www.weather.gov/disclaimer); U.S. Geological Survey provisional data (https://waterdata.usgs.gov/provisional-data-statement/).

- `watchwarn_2025-04-03T00-06.csv`: IEM watchwarn.py CSV, FL.W + FF.W issued 2025-04-03T00:00Z..2025-04-03T06:00Z, with follow-up polygons (addsvs=1); fetched 2026-11-05T06:17:32Z (cache); 17,952 bytes
- `sbw_2025-04-03T00-06.geojson`: IEM api/1/vtec/sbw_interval.geojson, FL + FF issued 2025-04-03T00:00Z..2025-04-03T06:00Z; fetched 2026-11-05T06:06:54Z (cache); 39,060 bytes
- `riv_gauges_lids.json`: NWS riv_gauges layer 0, the 10 gauges those warnings name; fetched 2026-11-05T06:17:32Z (cache); 3,229 bytes
- `vtec_event_KIND_FL_W_0030_2025.json`: IEM json/vtec_event.py {'wfo': 'IND', 'year': 2025, 'phenomena': 'FL', 'significance': 'W', 'etn': 30}; fetched 2026-11-05T06:17:33Z (cache); 387,829 bytes
- `vtec_event_KLMK_FF_W_0023_2025.json`: IEM json/vtec_event.py {'wfo': 'LMK', 'year': 2025, 'phenomena': 'FF', 'significance': 'W', 'etn': 23}; fetched 2026-11-05T06:17:33Z (cache); 3,364 bytes
- `nwps_gauge_FREI3.json`: NWPS /gauges/FREI3 (no USGS site); fetched 2026-11-05T06:17:34Z (cache); 66,164 bytes
- `nwps_gauge_SERI3.json`: NWPS /gauges/SERI3; fetched 2026-11-05T06:17:48Z (cache); 177,238 bytes
- `usgs_SERI3_stage.json`: USGS continuous 00065 (stage) of USGS-03365500, 2025-04-04..04-06; fetched 2026-11-05T06:17:59Z; 80,830 bytes
- `usgs_SERI3_flow.json`: USGS continuous 00060 (flow) of USGS-03365500, 2025-04-04..04-06; fetched 2026-11-05T06:17:59Z; 81,602 bytes
