Recorded 2026-11-05T00:11:27Z by `backend/scripts/record_test_samples_flood_maps.py` (5 real requests through `fire3d.http`, 16 read back from an earlier run's --cache-dir, one at a time, User-Agent "Fire-3d/0.1 test-sample recorder", no key or token). Area: gauge AGYM7, box `-94.80,39.62,-94.60,39.76`. Untrimmed answers.

Public domain U.S. Government data, NOAA/NWS National Water Center (experimental services; the National Water Model is model output).

* `rfc_fim_polygons.json`: `rfc/rfc_based_5day_max_inundation_extent` layer 0 (45 polygons, simplified 0.0002 deg).
* `rfc_fim_reaches.json`: the same service's layer 3 river lines, no geometry (9 reaches; 4 tied to AGYM7).
* `catfim_AGYM7_moderate.json`: `fim_libs/static_stage_based_catfim` layer 9 for `agym7`.
* `nwm_analysis.json`, `nwm_5day.json`, `nwm_high_flow.json`: `nwm/ana_inundation_extent`, `nwm/mrf_gfs_5day_max_inundation_extent`, `nwm/ana_high_flow_magnitude` layer 0 ({'nwm_analysis': 40, 'nwm_5day': 41, 'nwm_high_flow': 10}).
* `flowlines.json`: `reference/static_nwm_flowlines` layer 0, stream order 3 or more (14).
