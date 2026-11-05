# Progress: backend-flood-live (brief 5)

Role `backend-flood-live` (PLAN-5 §3.5-3.6, §10.1; plan5-roles.json). Ports API 8760 / Vite 5220.

## Status

- [x] M1 live: `floods/live.py` (second task in the lifespan, refresh of ready bundles, prefetch budget, auto-build of
  4), `/api/floods/status` from the loop, CLI `catalog --hazard flood` / `build-flood`, `check_bundle --hazard flood`,
  SPEC §8.9, tests, one real cycle on 8760.
- [x] M2 (cut line, U1 (a)) past floods: `floods/history.py`, `mode=historical&year=`, the detail chain's year step,
  IEM archive at past times, USGS observations, recorder + samples, tests.
- [ ] Final: gates, report, as-built note, push.

## Log

- 2026-11-05: read BRIEF-5, PLAN-5, CONTRACT §16, the part-1 results and the as-built notes. Started M1.
  Ownership: I do not own `floods/catalog.py`, `zones.py`, `gauges.py` or `build.py`; the year step and past answers
  are added in `api/floods.py` (mine) around them.
- 06:00 UTC: M1 built. `floods/live.py` (loop, prefetch, append, refresh jobs, auto-build), `/api/floods/status` from
  the loop, lifespan second task, CLI `catalog --hazard flood` / `build-flood`, `check_bundle --hazard flood`, SPEC §8.9,
  `FloodManifest.refreshed_ms` (additive). `tests/test_floods_live.py` 24 passed; full backend suite 1364 passed.
- Real cycle on 8760 (FIRE3D_LIVE=1, FIRE3D_AUTO_BUILD_LIVE=0, a scratch copy of `data/floods`, the main cache):
  list 55 floods (37 active, 31 gauges in flood), prefetch hvtec 14 + series 6 = 20 requests, appended to 5 bundles,
  4 refreshes queued (Peace River rfc_fim; Grand River, St. Johns River, Platte River satellite), rebuilt in 3-49 s,
  every product version kept, `check_bundle --hazard flood` 0 problems on all five afterwards (two had failed the
  credit check before their refresh: built before bundle-api's R1 fix). Fire loop ran its own cycle unchanged.
- CLI `build-flood "moenkopi wash"`: real bundle in 29 s (10.7 MB), `check_bundle --hazard flood` 0 problems.
- 06:10-06:50 UTC: M2. Research (6 IEM requests of the 10 allowed): `watchwarn.py?accept=csv&addsvs=1` has H-VTEC
  severity, damage tag and emergency flag per polygon (issuance and follow-ups), `api/1/vtec/sbw_interval.geojson` the
  issuance polygons: **PAST_RULE** ("moderate_or_worse") is used, not the fallback. `floods/history.py` (year lists in
  a background thread, disk copy, ids from the registry, past products from `vtec_event.py`, past readings from USGS),
  the year step in `api/floods.py`, past answers for `flood`/`lid` (and `not_available_for_past_dates` for areas).
  Real builds: 2025 1,976 floods (24 IEM + 5 map requests, 23 s, at most 24 IEM requests in a minute), 2026 2,108
  (22 + 3, 25 s; 8 rows served as live rows). Real API walk on 8760: year list, detail `resolved_from: year`, archived
  products (5 versions, verbatim), past gauge readings; all contract-valid. Recorder + samples in
  `backend/tests/data/floods/iem/` (1.2 MB). `tests/test_floods_history.py` 19 passed; full suite 1383 passed.
- Ownership deviation: three assertions in `tests/test_flood_endpoint_contracts.py` and `tests/test_floods_list_api.py`
  (not my files; their roles are finished and no active role owns them) encoded the pre-M2 placeholders
  (`ALERTS_PAST_NOT_YET`, `GAUGES_PAST_NOT_YET`, `PAST_NOT_YET`) that M2 replaces by design; updated deliberately
  (same intent: never today's readings for a past time; the historical list's shape). Recorded in the as-built note.
