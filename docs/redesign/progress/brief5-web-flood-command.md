# brief5 web-flood-command: progress

Role `web-flood-command` (PLAN-5 §4.5-4.6, plan5-roles.json). Ports: API 8755, Vite 5215.

## Status

- 2026-11-05: started. Read BRIEF-5, PLAN-5, CONTRACT §16, plan5-roles, part-1 results and the contract5 notes.
- M1 hydrograph: done (`ui/timeline/hydrographModel.ts` + test (32 cases), `Hydrograph.tsx` + SSR test (11 cases),
  `hydrographData.ts`, `hydrograph.css`; `HYDRO` strings in `floodCopy.ts`). Committed and pushed as
  "brief 5 web-flood-command: M1 hydrograph". Forensic mounts `<Hydrograph variant="dock" floodId lid />`.
- M2: done. `CommandFloodChrome.tsx` (Command fire's layout; bar with the flood name, LIVE, place, DEMO, the primary
  gauge line that opens the gauge list; readout; Official now column / phone sheet; controls bar, legend chips, slim
  chart, fixed copy, credits), `location/FloodReadout.tsx` (+ test), pure readout helpers in `location/floodCheck.ts`,
  `FloodLegend` flood-view chips, `FloodOfficialNow` river forecast sentence (CREST_LINE / FORECAST_HIGH_LINE),
  `styles/view-command.css` scoped to both Command chromes with `:is()`, `styles/view-flood-command.css`,
  `state/floodLayerData.ts` (model / high-flow / CatFIM answers), additive layer key `modelHighFlow`.
- M3: done. `map/floodCommandLayers.ts` (+ test; CatFIM hatch, NWM flooded area and high-flow reaches, amber dotted
  with MODEL · EXPERIMENTAL), wired in `map/floodController.ts`; FloodLayersPanel high-flow toggle and CatFIM target;
  CatFIM readout line and FEMA effective-date tag; gauge list from the bar; one reading per gauge (chart series);
  past floods (chart at the last NWS product, PAST_NO_FORECAST); phone title and Official sheet; screenshots (7).
- Gates (2026-11-05 ~06:30 UTC): backend 1340 passed / 0 skipped; web typecheck clean, lint 55 (all src/scene),
  tests 1706 passed / 2 skipped (pre-existing fire skips), build ok.
- Report: `docs/redesign/reports/brief5-web-flood-command.json`; as-built: `docs/redesign/contract5/web-flood-command.md`.

## Decisions so far

- `productsAt` stays in `official/floodModel.ts` (web-flood-public); `hydrographModel.ts` re-exports it (CONTRACT §16.12).
- The hydrograph fetches its own gauge series (`/api/official/river-gauges?lid=&series=1`) and, only in flow mode with
  a `reach_id`, the model series (`/api/floods/{id}/model?kind=nwm_series&lid=`), in `ui/timeline/hydrographData.ts`.

## Review fixes (WFC-R1..R15), 2026-11-05 from ~06:40 UTC

Ports: API 8755, Vite 5215 (started by the fixer; stop them at the end).

- R1: `productsShown` + `futureProductsNote` (ui/timeline/hydrographModel.ts) used by the map (floodController), the point
  check (floodCheck.checkPoint, also Public's point card) and the chart's note; `INSIDE_WARNING_UPCOMING`,
  `CURSOR_FUTURE_ISSUED`. Forensic's `warningsAt` (scene/flood/floodGeo.ts, not ours) should switch to it.
- R2: `chooseNearGauge`, `floodAnswerCovers`, `pointGaugeBox`, `pointGaugesUrl` (floodCheck.ts), `usePointGauges`
  (hydrographData.ts); synthetic floods never ask real gauges.
- R3: handle row sized by lines (`handleRowHeight`), future note its own wrapped `<p class="hg-future-note">`, dock in flow.
- R4: `map/floodLayerCredits.ts` + portal in CommandFloodChrome (`FloodLayerFootCredits`).
- R5: `stageOnly` + `HYDRO.flowStageOnly`. R6/R15: `gaugeLineParts` (hydrographData.ts), age kept. R7: NO_MEMBER_GAUGE.
- R8/R9: checkPoint takes catfim/model states, `NOTHING_COVERS_OFFICIAL`, `catfimCheck`; legend chips/details states
  (`extraLayerState`). R10: keyboard GaugeList. R11: `forecastLabelShort`. R12: `has-more` fade on the column.
- R13: point labels (`labelPoints`, `pointInside`). R14: `crest.falling` ("HIGHEST NWS FORECAST …").
- Status: code + unit tests done; next: browser checks, screenshots, gates, reports.
- 2026-11-05 ~08:52 UTC: resumed after a usage-limit pause and a container restart (the fixer's code, tests,
  screenshots and draft reports were in the snapshots 7e6b0e9 and 8e756a7; the working tree was clean). Re-ran the
  targeted tests (171 passed) and the backend suite (1383 passed, 0 skipped).
- Re-checked in the app (API 8755 real, then the fixture server on 8755 for the past demo; Vite 5215): R1 on the live
  Platte flood at sel 39.38,-94.75 (the then still-to-start warning), R2 far point, R3 slim and dock, R4 credits, R5
  Devils Lake flow, R6/R12/R15 at 1024 metric, R7 Salem, R10 keyboard probe, R11 dock key. Retook every fix-* shot
  (the earlier ones predated the last code) plus model-on and past; viewed each.
- Finished two fixes the re-check showed incomplete: R13 (3 label points left a zoomed-in reach unlabelled and the
  model's labels hid the category map's: 12 points 5 km apart, 28 px collision padding, category map above model) and
  R14 (a nearby gauge's forecast below its reading had no series: `forecastBelowReading`, `highestBelowSub`,
  `highestBelowVerdict`). Tests updated deliberately (floodCommandLayers.test.ts, FloodReadout.test.ts).
- Gates ~09:35 UTC: backend 1383 passed / 0 skipped; web typecheck clean, lint 55 (all src/scene), 1780 passed /
  2 skipped (pre-existing fire tests), build ok. Servers on 8755 / 5215 stopped. Reports and as-built note updated.
