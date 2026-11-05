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
