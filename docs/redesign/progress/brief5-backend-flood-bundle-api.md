# Progress: backend-flood-bundle-api (brief 5)

Role entry: `docs/redesign/plan5-roles.json` (`backend-flood-bundle-api`); ports API 8753, Vite 5213.
Started 2026-11-04 ~23:55 UTC from HEAD 20a6eb2 (backend-flood-sources fixed). No earlier attempt found (no progress
file, no milestone commit, no uncommitted edit in this role's paths).

## Milestones

- [x] M1 sources: `sources/water_maps.py`, `sources/nfhl.py`, `sources/opera.py` (+ token path), `sources/usgs_water.py`,
      recorder `scripts/record_test_samples_flood_maps.py`, samples `tests/data/floods/{maps,nfhl,opera,usgs}/`
- [ ] M2 bundle: `floods/build.py` (+ `satellite.py`, `maps.py`), POST build, files route
- [ ] M3 routes: maps, model, satellite (+ png), flood-alerts, river-gauges, local-alerts `hazard=flood`, evacuations
      `hazard=flood`; `tests/test_flood_endpoint_contracts.py`; SPEC 5.3
- [ ] Real flood bundle built, satellite PNG screenshot, report, contract5 note

## Log

- 23:55 read BRIEF-5, PLAN-5, CONTRACT 16, roles, audits, the previous role's as-built note and code.
- 00:15 M1: sources/water_maps.py (RFC FIM + layer-3 reach join, CatFIM, NWM, flowlines; shared paged ArcGIS query),
  sources/nfhl.py (layer 0 availability, layer 3 dates, layer 28 SFHA/floodway/0.2 % only), sources/opera.py (Earthdata
  GIS search + locked exports, CMR, PO.DAAC token path with injectable reader, GIBS, login state), sources/usgs_water.py
  (v1, USGS_429). Recorder made 23 polite requests (gauge AGYM7, Platte River near Agency, MO). Earthdata GIS had only
  one pass in the last 10 days over the box and it had no pixels there (Landsat swath gap): the satellite step must
  probe passes and fall back to the GIBS picture when none is usable. Tests: test_floods_{maps,opera,usgs}.py (47).
  SPEC §2 rows for the eight new sources.
