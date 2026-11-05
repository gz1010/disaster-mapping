# Brief 6 · web-flood-playback · progress

Role: builder (BRIEF-6 role table, order 2). Ports: API 8763, Vite 5223. Owns: the Play and step controls and keyframes
on the river-level chart (`ui/timeline/Hydrograph*`, `hydrographModel`), the pure shared helper
`web/src/state/floodTimeline.ts`, the 2D map layers following the selected pass (`map/floodAreaLayers.ts`,
`map/floodCommandLayers.ts`), the wording for gaps. New files of this role: `state/floodTimelineData.ts` (the timeline
store), `ui/timeline/floodPlaybackCopy.ts` (strings, under the flood wording guard).

## Plan

- **M1 shared helper** (`state/floodTimeline.ts`, pure, tested; `state/floodTimelineData.ts`, the store that asks
  `GET /api/floods/{id}/timeline?wait=0` and polls while a block is incomplete): keyframes (usable passes and the NWS
  changes that change the drawing), `passAt`, `productsAt`, `step`, labels and gap notes.
- **M2 controls** on the slim chart (Command) and the dock (Forensic): Play / Pause, Previous / Next, the step's label,
  the gap note, keyframe marks on the plot, the chart's time axis widened to the first step while stepping, keys
  (Space, comma, full stop), no autoplay, reduced motion: one step per press.
- **M3 2D map**: the satellite layer shows the pass at the handle (its own image, no-view hatch, image edge); the warning
  polygons follow the handle (timeline versions before now, brief 5's rule at and after now).

## Log

- 2026-11-05: read BRIEF-6, contract6 notes of wave 1, PLAN-5 §4.5-4.7 and §5, the chart, the map module, the flood
  store. Real answers checked on API 8763: fixture-flood (4 passes, one no view, 4 NWS versions), Calcasieu River
  (5 passes, 2 no view; 2 versions), St Johns River (23 passes, 102 versions: a CON every 12 h, so NWS steps are only
  the changes of what is drawn).
- 2026-11-05: **M1 done.** `state/floodTimeline.ts` (+ 18 tests), `state/floodTimelineData.ts` (+ 5 tests),
  `ui/timeline/floodPlaybackCopy.ts`.
