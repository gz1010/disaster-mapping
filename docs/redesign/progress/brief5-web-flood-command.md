# brief5 web-flood-command: progress

Role `web-flood-command` (PLAN-5 §4.5-4.6, plan5-roles.json). Ports: API 8755, Vite 5215.

## Status

- 2026-11-05: started. Read BRIEF-5, PLAN-5, CONTRACT §16, plan5-roles, part-1 results and the contract5 notes.
- M1 hydrograph: done (`ui/timeline/hydrographModel.ts` + test (32 cases), `Hydrograph.tsx` + SSR test (11 cases),
  `hydrographData.ts`, `hydrograph.css`; `HYDRO` strings in `floodCopy.ts`). Committed and pushed as
  "brief 5 web-flood-command: M1 hydrograph". Forensic mounts `<Hydrograph variant="dock" floodId lid />`.
- M2: pending. M3: pending.

## Decisions so far

- `productsAt` stays in `official/floodModel.ts` (web-flood-public); `hydrographModel.ts` re-exports it (CONTRACT §16.12).
- The hydrograph fetches its own gauge series (`/api/official/river-gauges?lid=&series=1`) and, only in flow mode with
  a `reach_id`, the model series (`/api/floods/{id}/model?kind=nwm_series&lid=`), in `ui/timeline/hydrographData.ts`.
