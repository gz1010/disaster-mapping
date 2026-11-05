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

# brief 5 integration (part 2): progress

Started 2026-11-05 10:19 UTC on 277fcb5 (every role built, reviewed and fixed). Ports API 8759, Vite 5219.

- [x] (1) live loop end to end on real sources (FIRE3D_LIVE=1, scratch copy of data/floods): 2 cycles, appends,
  auto-build of the one top-4 flood without a bundle (Toccoa / Ocoee, 82 s), /api/floods/status 40 / 38, check_bundle
  0 problems on 10 bundles, 0 limit lines, 0 errors
- [x] (1) past floods: 2026 (2,109) and 2025 (1,977) under U1 (a); detail / archived products / USGS readings / 409 /
  model past-date walked; past names cleaned (ids kept; SCHEMA 3)
- [x] Command past floods: no category or age on a past reading; model / CatFIM chips "not kept for past dates";
  year-tab bar status "N PAST FLOODS IN YYYY"; chart notes backed
- [x] (2) Forensic on real bundles (auto-built Toccoa / Ocoee; fixture dock with crest): dock mounted, no NEARBY on
  members, no overlap, gutter whole
- [x] (3) CONTRACT 16.12 / 16.14 / 16.16 (forensic review-fix names, part 2), SPEC 8.10; parity and string tests green
- [x] (4) gates (backend 1406 passed / 0 skipped; web typecheck, lint 55 in src/scene, 1788 passed + 2 skipped fire tests, build), report part 2, as-built note, commit, push; servers on 8759 / 5219 stopped
