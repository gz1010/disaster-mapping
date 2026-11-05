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
- 2026-11-05: **M2 done** (commit "M2 Play and step controls"): `ui/timeline/HydrographPlayback.tsx` (row, keys, timer,
  pass marks), `hydrographPlaybackView.ts` (view model, step words), `floodPlayback.ts` (store: playing, engaged; hand
  move pauses; NOW ends the stepping), `hydrographModel` (`startMs`, `ticks` inputs), CSS; brief 5's "no play button"
  test updated deliberately. Checked live: Space / comma / full stop (keydown on the page), Play from the latest step
  restarts at the first, reduced motion one step per press.
- 2026-11-05: **M3**: `map/floodAreaLayers.ts` `satelliteAtHandle` / `warningsAtHandle`; declared edits (no brief-6
  owner) in `map/floodController.ts` (image, edge and warning areas at the handle; redraw on a new timeline) and
  `map/FloodLegend.tsx` (the chip's date is the pass at the handle); `useSatelliteAtHandle` in
  `state/floodTimelineData.ts`. The orchestrator's wave-2 snapshot commit (ee6ac13) carried these files mid-step.
  Also fixed in the chart: the level labels on their lines start under the levels pinned to the top ("MINOR 2.0" over
  "MODERATE 4.0 ↑" on Calcasieu), day labels keep 8 px apart. Screenshots: fixture steps 1-2, Calcasieu steps 1-2
  (Oct 25 pass; NWS Flood Warning issued Nov 4), Forensic dock.
- 2026-11-05: **final.** Found on Calcasieu: the IEM archive copy and NWS's live copy of one polygon start at another
  vertex, so the EXT counted as "updated: new area"; `areaOf` now ignores the first vertex, direction and closing
  vertex (about 100 m), with a test. Real steps: fixture 3 passes + 3 NWS; Calcasieu 3 + 1; St Johns 17 + 5 (from
  102 versions). Gates: backend 1466 passed; web typecheck, lint (55 warnings, all in src/scene), 1888 tests, build.
  Report `docs/redesign/reports/brief6-web-flood-playback.json`, as-built `docs/redesign/contract6/web-flood-playback.md`,
  CONTRACT §17 pointer.

## Review fixes (review6, WFP-R1 … R10)

- 2026-11-05: started. Read the ten findings, verified each against the code (all real). Plan: R1 Public follows now
  (cursor reset on entering Public + read-time rule), R2 readout and point card at the handle (productsAt, the pass and
  its class sampler, area figures), R3 "NWS at this time" list (issuer, own times, link, archived tag) + IEM credit,
  R4 credits at the handle, R5 phone gap line, R6 "now" tags on chips, R7 ticks, R8 tooltip text refresh, R9 neutral
  word, R10 test timeouts.
- 2026-11-05: review fixes coded and committed (f41d647): Public follows now (`handleFor` / `isPublicView` /
  `useFloodHandleMs`, cursor reset on entering Public in `floodPlayback.ts`), point checks at the handle
  (`productsAtHandle`, `checkPoint` `shown`, `useSatClassAt(lon, lat, satAt)`, area figures), "NWS · n" list +
  `archiveCreditAtHandle` (foot credits), credits at the handle, phone line (`gapNoteShort`), "now" tags and note, ticks
  null without the products block, tooltip follows `data-tip`, "Shown:" wording, App-import test 20 s. Gates: typecheck,
  lint 55 (src/scene), 1899 tests, build. Next: screenshots (API 8783, Vite 5243).
- 2026-11-05: review screenshots (viewed): Calcasieu Command Nov 4 step with the "NWS · 1" list, Oct 25 step, Public
  after a Command step (now), phone 390 px (two-line row), fixture Forensic dock ("Shown:" wording). Phone row changed
  to two lines (buttons + label; "NWS · n" + short gap). Tooltip checked live after Play stops. "Now" note reworded
  "As of now, not this time: …". Review report `docs/redesign/reports/review6-web-flood-playback.json`; as-built note and
  role report updated.
