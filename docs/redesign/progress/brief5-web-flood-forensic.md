# brief5 web-flood-forensic: progress

Role `web-flood-forensic` (PLAN-5 §4.7, CONTRACT §16.12). Ports API 8756, Vite 5216.

## Status

- 2026-11-05 04:45 UTC: started (no earlier attempt found). Read BRIEF-5, PLAN-5, CONTRACT §16, roles, part-1 results
  and the four as-built notes. web-flood-command's `M1 hydrograph` is not in `git log` yet: M1 and M2 first.
- 05:35 UTC M1 committed (34dc4dd): branch, unprepared state + Prepare, `forensicFloodState.ts`, `SceneManifest`
  assets, `frame.ts` and `SceneOverlays` for floods, drapes (`uFloodPack`, `uSatWater`, satClasses test), warning lines
  with `warningsAt` (productsAt).
- web-flood-command's `M1 hydrograph` (74258f8) landed at 04:5x: the dock mounts `Hydrograph variant="dock"`.
- M2 (05:55 UTC): gauge bars (labels only for members and gauges at action or above), header (county only, full place
  in the tooltip), demo badge with its second line, right panel (Layers, Analysis, Evidence, Notes; Flood overview and
  River gauges cards, nearby gauges capped at 4 + "Show all"), dock gauge picker; hand-off of the flood grid
  (`openEventGrid`); tests for gauge bars, panels and hand-off.

- M3 (06:10 UTC): dock hydrograph mounted (Command's M1 was in git log), hand-off, the key folded on phones, model and
  CatFIM labels kept apart; screenshots (fixture, model on, cursor after now, unprepared, real prepared from the
  button, phones, fire regression), reduced motion checked (no animation running); gates green (backend 1340 passed;
  web typecheck, lint 55 all in src/scene, 1706 passed / 2 skipped fire-data tests, build). Report and as-built note
  written. Role done; servers on 8756 / 5216 stopped.

## Decisions

- `IncidentAssets.manifest` is typed `SceneManifest` (CONTRACT §16.12); the frozen `scene/fx/**` typechecks with it, so
  no `SceneAssets` base type is needed. Flood assets add an optional `flood` part.
- Warning lines: per VTEC event, the newest version sent at or before the handle's time, then `productsDrawn` /
  `productsAt` (C1).

## Review fixes (review5-web-flood-forensic, 14 findings)

- 2026-11-05 07:15 UTC: started the fix step (no earlier attempt found: no review5 report, no fix commit, no uncommitted
  edits in this role's files). Read BRIEF-5, PLAN-5, CONTRACT §16, the role entry, part-1 results and the as-built
  notes; viewed the reviewer's screenshots (scratchpad rv-wff). Ports API 8756, Vite 5216.
- 07:24 UTC: code fixes in place for R1-R13 (floodProbe.ts + test, key notes and fold-out, row meta lines, future line,
  dock absence, overview from warnings.json, gauge caveats, label placement + floodOverlayRects, phone picker,
  floodAssets.test.ts, unused copy removed, tokens in CSS); targeted tests green, typecheck ok, lint 55. Next:
  screenshots on 8756 / 5216, then gates.
- 09:20 UTC: resumed after a usage-limit pause. The code fixes of 07:24 were committed by the orchestrator's snapshot
  8e756a7 (no uncommitted edits left in this role's files). Next: re-verify, typecheck / lint / targeted tests,
  screenshots on 8756 / 5216, gates, reports, commit "review fixes".
- 09:30 UTC: screenshots retaken and viewed (fixture, probe, cursor-future, past-dock, phone, St. Johns FEMA, model-on, fire regression at 40 s); found and fixed the Flood overview card's two-column grid (.kv base columns). Next: full gates.
- 09:40 UTC: gates green (backend 1383 passed; web typecheck ok, lint 55 all in src/scene, 135 files / 1780 passed / 2
  skipped, build ok). Servers on 8756 / 5216 stopped. review5-web-flood-forensic.json written (14 fixed, 0 skipped), role
  report and as-built note updated; committing "brief 5 web-flood-forensic: review fixes".
