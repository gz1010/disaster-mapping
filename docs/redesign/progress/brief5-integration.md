# brief 5 integration (part 1): progress

Role `integration` part 1 (PLAN-5 10.1). Ports API 8759, Vite 5219. Started 2026-11-05 09:37 UTC on fd89c10.

State at start: web-flood-forensic fixed (fd89c10); backend-flood-live fixer running (uncommitted edits in
api/floods.py, cli.py, floods/history.py, floods/live.py and their tests): its owned paths (incl. SPEC.md,
contracts.py, web/src/api/types.ts, floodTypes.ts) are not touched by this part.

## Steps
- [ ] (1) real data end to end: live list table vs NWS, two real bundles, screenshots
- [ ] (2) cross-role fixes
- [ ] (3) CONTRACT 16 alignment (16.16 + deviations), triple consistency check
- [ ] (4) README floods section
- [ ] (5) gates, report, as-built note, commit, push

## Incident (09:53 UTC): data/floods wiped by an unisolated debug test (mine)
- A throw-away debug test that imported the grouping tests' helpers without their autouse isolation fixture ran
  `fresh()` (`shutil.rmtree(config.FLOODS_DIR)`) on the real `data/floods`. Lost: fixture-flood, the real flood
  bundles (Calcasieu, Grand River, Moenkopi Wash, Platte, Peace, St. Johns, Rio Grande, Ducktown), registry,
  last-known summaries and the year lists' disk copies. data/cache, data/incidents, data/official untouched.
- Recovery: polluted remains moved to the scratchpad (not deleted); fixture-flood regenerated (make_fixture --only
  flood); real bundles rebuilt through the real API (HTTP cache warm); registry and year lists rebuilt by the code.
  Flood ids are recomputed from their anchors (some dates/ids may differ from earlier reports).
