# Brief 5 final check (progress)

Role `final-check` (PLAN-5 §10.1). Ports: API 8759, Vite 5219. Started 2026-11-05 10:39 UTC at c839471.

- [x] 1. git status: working tree clean at c839471 (nothing of the build left uncommitted)
- [x] 2. gates: backend 1406 passed, 0 skipped (380 flood tests, none skipped); web typecheck ok, lint 55 (all
      src/scene), 136 files 1788 passed + 2 skipped (two real-fire data tests, not flood), build ok. After the crest
      fix: 1793 passed + 2 skipped.
- [x] 3. final screenshots docs/screenshots/brief5-final-*.png (22, all viewed) + brief-4 fire set re-shot and compared
      (pixel diff: Public fire 0.13 %, Command fire 0.12 %, Forensic fire 0.01 %, all time-relative text; overviews
      differ by live data and the title slot)
- [x] 4. scratch Playwright smoke run (session scratchpad smoke5.mjs): nav 14/14, rotation 24/24, reduced motion 32/32,
      fixed lines / wording / console 85/85 (19 views)
- [x] 5. count-only scans (FIRMS_MAP_KEY 0 in 1869 tracked files, 0 in the diffs and messages since 1824908;
      EARTHDATA_TOKEN not set here, 0 assignments of either name to a long value; FireTrace 0 in code/UI; banned words 0
      in UI strings)
- [x] 6. docs: CONTRACT 16.16 "Final check"; SPEC §10 flood tests paragraph; README floods section checked (two final
      screenshots added)
- [x] 7. report final-verification-5.json (+ user_summary), as-built note contract5/final-check.md, commit, push
      (finished 11:30 UTC)

## Notes

- Start: working tree clean at c839471 (`git status`: nothing to commit).
- `fixture-flood` regenerated relative to now (make_fixture.py --only flood, 10:45 UTC) before the screenshots.
- Fix (small): the slim and dock river charts drew the crest caret over the middle of its own label when the crest sat
  near the top of the plot ("CREST 18.0 F▼T FRI 09:30"; the label is pinned at the plot's top there). `crestLeft` moved
  to `hydrographModel.ts` and puts the label beside the caret when there is no room above (`CREST_LABEL_ROOM` 22 px);
  5 tests. Seen in Command (fixture and Peace River) and the Forensic dock; re-shot.
- Command screenshots use `--wait 16000`: the one-time rotate hint (12 s) covered the map at 12 s.
- The first Forensic fire shot showed a third telemetry column (FRONT 03) over FRONT 02: the frozen `scene/fx`
  declutter fades it over several frames, slow under SwiftShader; at `--wait 40000` it matches brief 4 (0.01 % diff).
- Smoke: a basemap glyph range (`/fonts/Noto Sans Regular/66560-66815.pbf`, U+10400) answers 404 from the font server
  near Copperhill; not an app error (recorded apart). On a fire view the flood-only banned list (PLAN-5 §5.1) hits
  LANDFIRE's fuel-model name "dry climate shrub (SH7)" and "No danger category is given unless…" (fire copy from
  brief 3/4): fire views are checked with CLAUDE.md's patterns (safe, low risk, FireTrace), which pass.
- Flash and watch demo floods shot on the fixture server (8759), then the servers 8759 / 5219 were stopped.
- A work-in-progress snapshot by the orchestrator (5b32b1d) committed the first screenshots and the crest fix
  mid-step; the next commit has the re-shot images.
