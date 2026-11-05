# Progress: backend-flood-bundle-api (brief 5)

Role entry: `docs/redesign/plan5-roles.json` (`backend-flood-bundle-api`); ports API 8753, Vite 5213.
Started 2026-11-04 ~23:55 UTC from HEAD 20a6eb2 (backend-flood-sources fixed). No earlier attempt found (no progress
file, no milestone commit, no uncommitted edit in this role's paths).

## Milestones

- [x] M1 sources: `sources/water_maps.py`, `sources/nfhl.py`, `sources/opera.py` (+ token path), `sources/usgs_water.py`,
      recorder `scripts/record_test_samples_flood_maps.py`, samples `tests/data/floods/{maps,nfhl,opera,usgs}/`
- [x] M2 bundle: `floods/build.py` (+ `satellite.py`, `maps.py`), POST build, files route
- [x] M3 routes: maps, model, satellite (+ png), flood-alerts, river-gauges, local-alerts `hazard=flood`, evacuations
      `hazard=flood`; `tests/test_flood_endpoint_contracts.py`; SPEC 5.3
- [x] Real flood bundle built, satellite PNG screenshot, report, contract5 note

## Log

- 23:55 read BRIEF-5, PLAN-5, CONTRACT 16, roles, audits, the previous role's as-built note and code.
- 00:15 M1: sources/water_maps.py (RFC FIM + layer-3 reach join, CatFIM, NWM, flowlines; shared paged ArcGIS query),
  sources/nfhl.py (layer 0 availability, layer 3 dates, layer 28 SFHA/floodway/0.2 % only), sources/opera.py (Earthdata
  GIS search + locked exports, CMR, PO.DAAC token path with injectable reader, GIBS, login state), sources/usgs_water.py
  (v1, USGS_429). Recorder made 23 polite requests (gauge AGYM7, Platte River near Agency, MO). Earthdata GIS had only
  one pass in the last 10 days over the box and it had no pixels there (Landsat swath gap): the satellite step must
  probe passes and fall back to the GIBS picture when none is usable. Tests: test_floods_{maps,opera,usgs}.py (47).
  SPEC §2 rows for the eight new sources.
- 00:55 M2: floods/build.py (gate, 60 km cut around the primary gauge, staging folder swapped in at the end,
  parallel steps, terrain required, every other layer with an honest layer_status), floods/satellite.py (pass probing,
  locked exports, PNG palette with the no-view hatch, outside the tile transparent, stats, token path, GIBS fallback),
  floods/maps.py (map and model answers, member-reach stats), floods/zones.py (flood-alerts answers, zones on demand
  then counties), floods/gauges.py (members from NWPS, nearby from the riv_gauges envelope). Routes POST build and
  files; list and detail rows carry the bundle state per request. store.bundle_state reads the build lock. Tests:
  test_floods_build.py (the recorded Platte River flood built end to end offline), test_floods_api.py. Fixed a test
  leak: flood_iso now resets the flood rate limiters.
- 01:00 M3: routes maps, model, satellite (+ png), official flood-alerts and river-gauges in api/floods.py;
  hazard=flood for local alerts (official.py) and evacuations (extras.py; Oregon fire-only); fixture-flood from its
  bundle; isolated tests/test_flood_endpoint_contracts.py; test_floods_evacuations.py; SPEC 5.3 and 6. An orchestrator
  WIP snapshot (90f3d97) committed the M3 code while I worked; the M3 milestone commit carries the docs.
- 01:05 Real data on port 8753 (FIRE3D_LIVE=0): 47 live floods; every route contract-valid for fixture-flood, Peace
  River (FL), St. Johns River (FL) and Platte River (MO). Fixed on real data: a GEOS topology error in the RFC FIM union
  (safe_union), FEMA paging truncation caveat, bundle size (compact vector copies: 21 -> 17.6 MB). Builds through POST
  build: Peace River 15-24 s warm, St. Johns River 36 s cold, 17.7 MB. Screenshot of the St. Johns satellite PNG.
  Past gauge queries now answer not_available_for_past_dates (never today's readings for a past time).
- Gates: backend 1322+ passed, 0 skipped; web typecheck clean, lint 55 (src/scene), 1573 passed + 2 old skips, build OK.
