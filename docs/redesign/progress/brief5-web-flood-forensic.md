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

## Decisions so far

- `IncidentAssets.manifest` is typed `SceneManifest` (CONTRACT §16.12); the frozen `scene/fx/**` typechecks with it, so
  no `SceneAssets` base type is needed. Flood assets add an optional `flood` part.
- Warning lines: per VTEC event, the newest version sent at or before the handle's time, then `productsDrawn` /
  `productsAt` (C1).
