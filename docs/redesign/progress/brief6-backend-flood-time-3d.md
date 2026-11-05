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
