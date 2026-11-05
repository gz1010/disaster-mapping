# brief 5 integration (part 1): progress

Role `integration` part 1 (PLAN-5 10.1). Ports API 8759, Vite 5219. Started 2026-11-05 09:37 UTC on fd89c10.

State at start: web-flood-forensic fixed (fd89c10); backend-flood-live fixer running (uncommitted edits in
api/floods.py, cli.py, floods/history.py, floods/live.py and their tests): its owned paths (incl. SPEC.md,
contracts.py, web/src/api/types.ts, floodTypes.ts) are not touched by this part.

## Steps
- [x] (1) real data end to end: live list table vs NWS (09:38 and 10:03 UTC), bundles Rio Grande (river + WGRFC
  forecast) and Ducktown (flash), screenshots brief5-integration-*.png (viewed)
- [x] (2) cross-role fixes: gauge-only floods list products over their gauge (Copperhill Flash Flood Emergency),
  areal same-river join, watch + gauge stays gauge_only, names, stable split ids, circle meaning by caveat, passed
  crest, No flood open, chart gutter, past-flood prepare text and rule wording
- [x] (3) CONTRACT 16 (16.2, 16.3, 16.7, 16.8, 16.10-16.12, 16.14-16.16) and SPEC 8.8; parity test green
- [x] (4) README floods section, Earthdata token, CLI, routes, credits
- [x] (5) gates (backend 1405 passed / 0 skipped; web typecheck, lint 55 in src/scene, 1786 passed + 2 skipped, build),
  report, as-built note, commit, push; servers on 8759 / 5219 stopped
- Milestone commit f63e25c "brief 5 integration: M1 real data (...)" pushed.
- backend-flood-live was fixed at 6fbbf9d during this step, so its paths (SPEC, triple) became the integration's.

## Incident (09:53 UTC): data/floods wiped by an unisolated debug test (mine)
- A throw-away debug test that imported the grouping tests' helpers without their autouse isolation fixture ran
  `fresh()` (`shutil.rmtree(config.FLOODS_DIR)`) on the real `data/floods`. Lost: fixture-flood, the real flood
  bundles (Calcasieu, Grand River, Moenkopi Wash, Platte, Peace, St. Johns, Rio Grande, Ducktown), registry,
  last-known summaries and the year lists' disk copies. data/cache, data/incidents, data/official untouched.
- Recovery: polluted remains moved to the scratchpad (not deleted); fixture-flood regenerated (make_fixture --only
  flood); real bundles rebuilt through the real API (HTTP cache warm); registry and year lists rebuilt by the code.
  Flood ids are recomputed from their anchors (some dates/ids may differ from earlier reports).
