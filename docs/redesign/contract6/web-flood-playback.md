# Brief 6 · web-flood-playback · as built

The flood's time steps (BRIEF-6 decision 2): Play and step controls on the river-level chart in Command (slim chart)
and Forensic (dock), the 2D map following the handle, and the words for the gaps between satellite passes. Input:
`GET /api/floods/{id}/timeline` (contract6/backend-flood-time-3d.md). One handle for every view: `useFlood.cursorMs`
(null = now), as in brief 5.

## Files

| File | What |
|---|---|
| `web/src/state/floodTimeline.ts` | Pure shared helper (tested): keyframes, `passAt`, `productsAt`, `step`, `playStart`, labels and gap notes |
| `web/src/state/floodTimelineData.ts` | The timeline store `useFloodTimeline`, `useFloodTimelineSync(floodId)`, `useSatelliteAtHandle(base)` |
| `web/src/state/floodTimeline.testutil.ts` | Test builders (`testPass`, `versionBuilder(now)`, `testTimeline`, `SQUARE`) |
| `web/src/ui/timeline/floodPlaybackCopy.ts` | Every new string (`PLAYBACK`), under the flood wording guard |
| `web/src/ui/timeline/floodPlayback.ts` | Store `useFloodPlayback` (`playing`, `engaged`), `moveHandle`, `setPlaying`, `playPress`, `playTick`, `playbackAxisStart` |
| `web/src/ui/timeline/hydrographPlaybackView.ts` | `usePlaybackView(floodId, nowMs, past, tf)` → `PlaybackView`; `stepWords(view, cursorMs)` |
| `web/src/ui/timeline/HydrographPlayback.tsx` | `PlayRow` (buttons, step label, gap note, keys, Play timer), `PassMarks` (SVG marks on the plot) |
| `web/src/ui/timeline/Hydrograph.tsx`, `hydrographModel.ts`, `hydrograph.css` | Mounts the row in both variants (also with no gauge); `HydrographInput.startMs` / `.ticks` |
| `web/src/map/floodAreaLayers.ts` | `satelliteAtHandle`, `warningsAtHandle` (pure, tested) |
| `web/src/map/floodController.ts` | **Declared edit** (no brief-6 owner): image, image edge and warning areas at the handle; redraw on a new timeline |
| `web/src/map/FloodLegend.tsx` | **Declared edit** (no brief-6 owner): the satellite chip and key read `useSatelliteAtHandle` (the pass's own date) |

## Shared helper (`state/floodTimeline.ts`)

```ts
export const STEP_EPS_MS = 30_000          // a handle within 30 s of a step is on it
export const PRODUCT_MERGE_MS = 15 * 60_000 // NWS changes this close are one step (at the last of them)
export const PLAY_STEP_MS = 1_800          // Play: one step every 1.8 s
export const isUsablePass: (p) => boolean  // usable && view clear | partly_hidden (never no_view / unknown)
export function passesOf(tl): FloodPass[]  // oldest first
export interface PassAt { pass: FloodPass | null; next: FloodPass | null; onPass: boolean; ageMs: number | null;
  gapMs: number | null; noViewBetween: FloodPass[]; unreadBetween: FloodPass[] }
export function passAt(passes, ms): PassAt // the latest usable pass at or before ms (+30 s); never a blend
export type ProductChangeKind = 'issued' | 'updated' | 'cancelled' | 'upgraded' | 'until'
export interface ProductChange { kind: ProductChangeKind; t: number; product: FloodTimelineProduct }
export function productChanges(products, nowMs): ProductChange[]
export function versionUntil(p): number    // shown_until_ms; null + phase 'ended' → expires_ms; else +∞
export function versionShownAt(p, t): boolean // shown_from_ms <= t < versionUntil(p)
export interface ProductsAtHandle extends ShownProducts<FloodAlert> { source: 'timeline' | 'live' }
export function productsAt(products | null, live: FloodAlert[], cursorMs, nowMs): ProductsAtHandle
export interface FloodKeyframe { t: number; kind: 'pass' | 'products'; pass: FloodPass | null; changes: ProductChange[] }
export function floodKeyframes(tl, nowMs, fromMs?): FloodKeyframe[] // oldest first, none after now
export function keyframeIndexAt(frames, cursorMs): number
export function step(frames, cursorMs, 'next' | 'prev', nowMs): { cursorMs: number | null } | null // null cursor = now
export function playStart(frames, cursorMs, nowMs): { cursorMs: number | null } | null
export interface StepLabel { text: string; event: string | null } // event: NWS's own words inside text
export function keyframeLabel(f, tf, nowMs, past?): StepLabel; passLabel(p, tf, nowMs, past?): string
export function changeLabel(c, tf, nowMs): StepLabel; gapNote(at, cursorMs, tf, nowMs): string | null
export function playSummary(frames, tf, nowMs): string; beforeNowText(ms, nowMs); spanText(ms); hiddenPct(p)
```

Rules:
- **Steps** = every usable pass (its `acquired_ms`) + every NWS change that changes what is drawn: a version of an
  event issued when no earlier version was drawn (`issued`), a later version with a different polygon or zone list
  (`updated`; `areaOf` ignores the first vertex, the direction and the closing vertex at about 100 m, because the IEM
  archive copy and NWS's live copy of one polygon start at different vertices), `CAN` (`cancelled`), `UPG`
  (`upgraded`), a version's own end with no next version then (`until`).
  A `CON` / `EXT` with the same area is not a step (St Johns River: 102 versions, 2-hourly / 12-hourly CONs → a few
  steps). Steps after now are left out (after now the views keep what is in effect now, C1). An NWS change within 30 s
  of a pass joins the pass's step.
- **Products at the handle** (`productsAt`): before now the timeline's versions from `shown_from_ms` until
  `versionUntil` (the backend's rule; archived versions included); at and after now brief 5's `productsShown` on the
  live flood-alerts answer (C1, WFC-R1). Without timeline products: `productsShown` on the live answer at every time.
- **Nothing between passes:** `passAt` gives the latest usable pass at or before the handle, with its own date; a
  view draws that pass or nothing (before the first one). Never interpolated.

## Store (`state/floodTimelineData.ts`)

`useFloodTimeline`: `{ floodId, data: FloodTimelineResponse | null, loading, error, receivedMs }`.
`floodTimelineQuery(id, wait=0)` → `/floods/{id}/timeline?wait=0`; asks again every 4 s (at most 45 times) while
`passes.complete` or `products.complete` is false, then every 2 min; after a failure 30 s. `useFloodTimelineSync(id)`
keeps it running while a view is mounted (the chart mounts it; Forensic can too). `timelineFor(state, floodId)`,
`timelineState(state)` ('none' | 'loading' | 'available' | 'unavailable'). `useSatelliteAtHandle(base)` = the
satellite answer the 2D views show at the handle. Dev handle: `window.__floodTimeline`.

## Controls (`HydrographPlayback.tsx`, both chart variants)

- Row above the plot (`.hg-play`, `role="group"` "Flood time steps"): Previous (`aria-label` "Previous time step"),
  Play / Pause ("Play the time steps" / "Pause the time steps", `aria-pressed`), Next ("Next time step"); then the
  step label (`.hg-step-label`, `.is-on` when the handle is on a step; NWS's event inside `data-verbatim`), the gap note
  (`.hg-step-gap`) and a status note (`.hg-step-note`). The row is shown with and without a gauge.
- At now: `playSummary` ("3 satellite passes and 2 NWS product changes from Oct 25 · Play steps through them"). After
  now: nothing (the chart's own C1 note). Loading / failed / no step: `PLAYBACK.loading`, `.unavailable`, `.none` + the
  backend's own reason.
- **No autoplay.** Play: from now, after now or at the latest step it starts at the first step, else the next step;
  then one step every 1.8 s and **stops at the latest step** (Next goes on to now). **prefers-reduced-motion:** Play
  never runs on a timer; each press shows one step. A hand move of the handle (drag, slider keys, NOW) or another flood
  pauses; the chart unmounting pauses.
- **Keys** (window, while the chart is shown and has steps): Space plays / pauses (not while typing, not on another
  button, link, select, list, tab, switch or slider; the chart's own slider is fine), `,` previous step, `.` next step.
- **Axis:** while stepping (`useFloodPlayback.engaged`: set by Play / a step, cleared when the handle is back at now)
  the chart starts 6 h before the first step (never later than 72 h before now, never more than 45 days back); at now
  it is brief 5's 72 h again.
- **Marks:** passes as small triangles along the plot's top (`.hg-pass`, filled; `.is-noview` hollow grey, listed and
  never drawn as water; `.is-current` outlined); the NWS changes are the chart's ticks (`HydrographInput.ticks`,
  labelled with `changeLabel`) instead of the live answer's send times when the timeline is there.

## 2D map (`floodAreaLayers.ts`)

- `satelliteAtHandle(base, tl, cursorMs, nowMs): SatelliteWaterResponse | null`: at and after now (or without the
  timeline's passes) `base` (the satellite route's answer, brief 5). Before now the pass at the handle as its own
  measured answer: `granules[0]` from the pass (its `acquired_ms`, product, platform, cloud share), `image` = the
  pass's PNG and bounds (same palette and no-view hatch; `satelliteEdge` draws its edge), `caveats` = the pass's
  `SAT_CAVEAT`, `source` = the matching `passes.sources` credit, `stats: null`. Before the first usable pass (or a
  pass without an image): `measured: false`, no image, `reason` = `PLAYBACK.noImageAtHandle` / `PLAYBACK.noImage`.
- `warningsAtHandle(live, liveAlerts, tl, cursorMs, nowMs): FeatureCollection` = `warningFeatures(productsAt(...))`,
  zones from the timeline (before now) or the live answer.

## Strings (exact; `ui/timeline/floodPlaybackCopy.ts` `PLAYBACK`)

| Key | Text |
|---|---|
| `groupName` | Flood time steps |
| `play` / `pause` / `prev` / `next` | Play the time steps / Pause the time steps / Previous time step / Next time step |
| `playTip` | Play: the satellite passes and NWS product changes, one step at a time, to the latest step (Space) |
| `playReducedTip` | Reduced motion is on: each press of Play shows the next step (Space) |
| `pauseTip` | Pause (Space) |
| `prevTip` | Previous step: the satellite pass or NWS product change before the handle (comma key) |
| `nextTip` | Next step: the satellite pass or NWS product change after the handle (full stop key) |
| `keysHelp` | Space plays or pauses the time steps; the comma and full stop keys step back and forward. |
| `pass` / `passPast` | Satellite pass {time} · {ago} / Satellite pass {time} |
| `passHidden` | no view of {pct}% of the area (clouds or no data) |
| `agoMinutes` … `agoDays` | {n} min before now · 1 hour before now · {n} hours before now · 1 day before now · {n} days before now |
| `issued` | NWS {event} issued {time} |
| `updated` | NWS {event} updated {time}: new area |
| `cancelled` | NWS cancelled the {event} {time} · not an all-clear |
| `upgraded` | NWS upgraded the {event} {time} |
| `until` | End time of the NWS {event}: {time} · not an all-clear |
| `moreOne` / `moreMany` | (+1 more NWS change by {time}) / (+{n} more NWS changes by {time}) |
| `mapImage` | Map: satellite image of {time} ({age} before the handle) |
| `gapBetween` | No satellite image between {from} and {to} |
| `gapAfter` | No satellite image after {from} yet |
| `gapBefore` | No satellite image before {to} |
| `gapNone` | No usable satellite image in this flood’s window |
| `noViewOne` / `noViewMany` | 1 pass in between saw no view (clouds or no data) / {n} passes in between saw no view (clouds or no data) |
| `unread` | some passes are still being read |
| `noImage` | This pass has no image to draw on the map. |
| `noImageAtHandle` | No satellite image at or before this time: the water then is not seen. That is not an all-clear. |
| `summary` | {passes} and {changes} from {from} · Play steps through them |
| `passesOne` / `passesMany` | 1 satellite pass / {n} satellite passes |
| `changesOne` / `changesMany` | 1 NWS product change / {n} NWS product changes |
| `loading` | Loading the flood’s time steps… |
| `unavailable` | The flood’s time steps could not be loaded right now. That is not an all-clear. |
| `none` | No satellite pass or NWS product change to step through yet. That is not an all-clear. |

Times: a pass in the flood's zone (`fmtAt`, with the zone; the year only when it differs); an NWS change in the
product's own `time_zone`. Gap dates are days (`fmtDayDate`).

## For other roles

- **web-forensic-flood-3d:** `passAt(passesOf(timelineFor(useFloodTimeline.getState(), id)), cursorMs)` gives the
  pass for the drapes; join it to the bundle's `timeline.json` by `key` for `layer` / `depth_layer`. `productsAt(...)`
  gives the NWS versions at the handle (`source` says which list). The dock's controls come with `Hydrograph`.
- **final-check / README:** the Command and Forensic flood paragraphs can say: "Play and the step buttons (or Space,
  comma and full stop) move the time handle from satellite pass to NWS product change; the map shows each pass's own
  image and date and the NWS warning areas of that time; nothing is drawn between two passes." Screenshots:
  `docs/screenshots/brief6-web-flood-playback-*.png`.
- **Known gaps (not in my files):** the readout's point lines (`location/FloodReadout.tsx`, `floodCheck.ts`,
  `official/floodHooks.ts` `useSatClassAt`) keep the satellite route's pass and the live NWS answer (with brief 5's
  rule at the handle), so at a past step they can name another image than the map; the NWS forecast flooded area,
  FEMA, CatFIM and the model layers do not follow the handle (they are "now" products).
