# Brief 6 · backend-flood-time-3d · progress

Role: builder (BRIEF-6 role table, order 1). Ports: API 8762, Vite 5222. Owns: new backend modules for the flood
time history and the 3D terrain products, their routes in `api/floods.py`, `floods/build.py` additions, contracts
(`contracts.py`, `web/src/api/floodTypes.ts`), SPEC.md (new sections + title / intro rename), backend tests.

## Plan

- **M1 time history** (`floods/timeline.py`, strings in `floods/copy_time.py`):
  - satellite passes over the flood window (start − 10 d → now; a past flood: start − 10 d → last product + 3 d;
    at most 45 d), one Earthdata GIS search, passes of one overpass merged (same sensor within 10 min), each read
    once (2D: lon/lat PNG + view shares; bundle: the render grid), no-view passes listed and marked;
  - NWS products: every version of the flood's events from IEM (`json/vtec_event.py`, every segment) + the live CAP
    copies, de-duplicated, each with `replaced_ms`, `shown_from_ms`, `shown_until_ms`; zone outlines for zone-based
    versions;
  - routes `GET /api/floods/{id}/timeline`, `GET /api/floods/{id}/passes/{key}.png`; bundle `timeline.json` +
    `layers/water_pass_*.bin`.
- **M2 3D terrain** (`floods/terrain3d.py`): relief statistics + suggested height boost, HAND (NWM flowlines
  rasterised; nearest channel cell), FwDET depth (Cohen et al. 2018, 2019) for the satellite layer and the NWS
  forecast area; manifest `terrain3d`; `scripts/flood_3d.py` upgrades an existing bundle (and the fixture).

## Log

- 2026-11-05: read BRIEF-6, BRIEF-5, PLAN-5 §3.3-3.8 and §5, CONTRACT §16, the OPERA / satellite / history / zones /
  build / routes code. Measured: Earthdata GIS pass read ~3 s (1600 px, ~1 MB); IEM event detail 0.1-1.3 s;
  St Johns event KMLB.FL.W.0003 has 68 versions; NWM flowlines 535-1105 lines per 60 km area (2 s).
- 2026-11-05: **M1 done.** `floods/timeline.py`, `floods/copy_time.py`, routes `/timeline` and `/passes/{key}.png`,
  bundle step "timeline" (`timeline.json`, `layers/water_pass_<key>.bin`, at most 8), contracts (Python + TS),
  SPEC §5.3 / §6 / §8.11 and the title / intro rename (every SPEC "Fire-3d" now "Disaster Mapping" except the history
  note and the repo folder), `scripts/check_bundle.py` knows the new layers (declared in the contract6 note),
  `tests/test_floods_timeline.py` (13). Backend suite 1441 passed; web typecheck clean.
  Real runs: Moenkopi Wash 6 passes (8 s cold); Grand River 3 passes, all no view; St Johns 97 product versions.
- 2026-11-05: **M2 done.** `floods/terrain3d.py` (relief + boost rule, HAND from NWM river lines, FwDET depth for the
  satellite and forecast layers; uint8 0.1 m rasters, 255 = no value), build step "terrain3d" (+ river lines in the
  maps step, `maps/flowlines.geojson`), `scripts/flood_3d.py` (adds the products and the timeline to existing
  bundles; run on `fixture-flood`, Calcasieu River, St Johns River: check_bundle 0 problems), SPEC §5.4 / §5.3 / §10,
  `tests/test_floods_terrain3d.py` (17; HAND checked against the fixture valley's known heights, FwDET against a
  bathtub of known depth). HAND cut-off raised from 5 to 10 km after a visible circle on the Calcasieu plain.
  Gates: backend 1458 passed; web typecheck, lint (55 warnings, all src/scene), 1809 tests, build.
- 2026-11-05: **Final.** Report `docs/redesign/reports/brief6-backend-flood-time-3d.json` (JSON samples of
  `/timeline` for Calcasieu River and the fixture, the pass PNG route, a bundle pass, `manifest.terrain3d` and the
  `hand` layer of St Johns River), as-built note `docs/redesign/contract6/backend-flood-time-3d.md`. Count-only scans:
  0 secret hits, no "FireTrace". API on 8762 stopped.
