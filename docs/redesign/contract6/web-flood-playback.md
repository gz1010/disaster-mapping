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
| `web/src/ui/timeline/hydrographPlaybackView.ts` | `usePlaybackView(floodId, nowMs, past, tf)` → `PlaybackView`; `stepWords(view, cursorMs)` → `StepWords { label, gap, gapShort, note, onStep, past }` |
| `web/src/ui/timeline/HydrographPlayback.tsx` | `PlayRow` (buttons, step label, gap note, keys, Play timer; review: "NWS · n" list, phone line, "now" note), `PassMarks` (SVG marks on the plot), `NwsVersion` (one NWS version, exported for tests) |
| `web/src/ui/timeline/Hydrograph.tsx`, `hydrographModel.ts`, `hydrograph.css` | Mounts the row in both variants (also with no gauge); `HydrographInput.startMs` / `.ticks` |
| `web/src/map/floodAreaLayers.ts` | `satelliteAtHandle`, `warningsAtHandle` (pure, tested) |
| `web/src/map/floodController.ts` | **Declared edit** (no brief-6 owner): image, image edge and warning areas at the handle; redraw on a new timeline |
| `web/src/map/FloodLegend.tsx` | **Declared edit** (no brief-6 owner): the satellite chip and key read `useSatelliteAtHandle` (the pass's own date); at a past step the "now" chips (review WFP-R6) |
| `web/src/location/FloodReadout.tsx`, `location/FloodPointCard.tsx` | **Declared edits** (review WFP-R2): the point lines and area figures at the handle (`useProductsAtHandle`, `useSatelliteAtHandle`, `useSatClassAt(lon, lat, satAt)`) |
| `web/src/location/floodCheck.ts` | **Declared edit** (WFP-R2): `FloodPointInput.shown?: ShownProducts<FloodAlert>` (the products already picked at the handle) |
| `web/src/official/floodHooks.ts` | **Declared edit** (WFP-R2): `useSatClassAt(lon, lat, satAt?)` samples the answer shown at the handle |
| `web/src/ui/shell/CommandFloodChrome.tsx` | **Declared edit** (WFP-R3, WFP-R4): foot credits of the pass at the handle and of the IEM archive while its copies are drawn |
| `web/src/ui/Tooltip.tsx` | **Declared edit** (WFP-R8): a shown tip follows its element's `data-tip` (closes when it goes) |
| `web/src/ui/shell/FloodListPanel.test.ts` | **Declared edit** (WFP-R10): the App-import test has a 20 s limit |

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
export function gapNoteShort(at, cursorMs, tf, nowMs): string | null // phones (review WFP-R5)
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

## The handle each view follows (review WFP-R1)

`state/floodTimelineData.ts`:

```ts
export const isPublicView: (s: Pick<WorkspaceState, 'workspace' | 'preset'>) => boolean // workspace 'map' && preset 'public'
export function handleFor(publicView: boolean, cursorMs: number | null): number | null  // Public: always null (now)
export function useFloodHandleMs(): number | null                                        // handleFor for the view on screen
export function useSatelliteAtHandle(base): SatelliteWaterResponse | null                // uses useFloodHandleMs
export function useProductsAtHandle(live: FloodAlertsResponse | null | undefined): ProductsAtHandleZones & { timeline }
```

- **Public has no time handle** (BRIEF-6 decision 2): `ui/timeline/floodPlayback.ts` `leavePlaybackForPublic()` runs
  when the Public map view comes on screen (`useWorkspace` subscription: `isPublicView` turns true): Play stops, the
  axis returns to 72 h and `useFlood.cursorMs` goes back to null. Forensic keeps the preset it came from, so Forensic
  with the Public preset is not Public: its dock's handle stays. On top of that the readers use `handleFor` /
  `useFloodHandleMs` (the map's `syncAreas`, the legend, the point card), so Public draws now even if a handle is left.
- Command and Forensic follow `useFlood.cursorMs` as before.

## Point checks at the handle (review WFP-R2)

The readout (`FloodReadout` `PointLayers`, `AreaRows`) and the point card (`FloodViewBlock`) judge a spot by exactly
what the map draws at the handle:
- NWS: `useProductsAtHandle(alerts answer)` → `checkPoint({ alerts: r.alerts, shown: r, zones: r.zones, alertsStatus:
  r.source === 'timeline' ? 'available' : <live answer's state> })`; before now the timeline's versions (archived
  ones included) from their issue time, so a spot inside the archived NEW polygon reads "Inside the NWS Flood Warning
  area (until …)" at that step.
- Satellite: `satelliteAtHandle` (the pass at the handle) as `satellite`, its class from `useSatClassAt(lon, lat,
  satAt)` (the pass's PNG; the bundle's `water_satellite.bin` only when its time is the pass's), the line's date and
  tag age are the pass's; before the first pass its `reason` ("No satellite image at or before this time …").
- Area figures: `areaFigures(fim, satAt)`: a past pass has `stats: null`, so no satellite figure of another day.

## NWS versions at a past step (review WFP-R3)

- Row button `.hg-nws-btn` "NWS · {n}" (only while the handle is before now and `productsAt(...).source ===
  'timeline'` with at least one version drawn; `aria-haspopup="dialog"`, `aria-label` `PLAYBACK.nwsButtonLabel`).
  Its popover (`.hg-nws-pop`, `Popover`, title `PLAYBACK.nwsTitle`) lists each version (`orderAlerts`): NWS's event
  (`<strong data-verbatim>`) · `sender_name` verbatim; "issued {sent} · until {ends ?? expires}" in the product's own
  zone; the headline verbatim; for an IEM copy `ARCHIVED_COPY` and the link "Archived copy of the NWS product", else
  "NWS product" (https `url` only); then `PLAYBACK.nwsNote` and the archive's credit with its terms link.
- `map/floodAreaLayers.ts`:
  `productsAtHandle(live, liveAlerts, tl, cursorMs, nowMs): ProductsAtHandleZones` (productsAt + the zones of its
  source; `warningsAtHandle` draws it) and `archiveCreditAtHandle(r, tl): { text, href } | null` (the timeline's
  `products.archive_source` credit and terms link, else `ARCHIVED_COPY`, only while a shown version has `archived`).
- Command's foot credits (`#mw-credits`) add the archive credit while the warning layer draws an archived copy, and
  the satellite credit of the pass at the handle (`useSatelliteAtHandle`; review WFP-R4): a DSWx-S1 or PO.DAAC pass gets
  its own `passes.sources` line; nothing for the satellite layer before the first pass.

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
| `mapImage` | Shown: satellite image of {time} ({age} before the handle) (neutral for 2D and 3D; review WFP-R9) |
| `mapImageShort` / `gapBeforeShort` / `gapNoneShort` | Image shown: {date} ({age} before) / No satellite image before {to} / No usable satellite image (phones, WFP-R5) |
| `nowLayers` / `nowLayersShort` | As of now, not this time: {layers} / Now: {layers} (WFP-R6; slim chart at a past step) |
| `nowForecast` / `nowFloodplain` / `nowCatfim` / `nowModel` | NWS forecast area / FEMA floodplain / NWS category map / model |
| `chipNow` / `chipNowIssued` | now / now, issued {time} (Command legend chips at a past step) |
| `nwsButton` / `nwsButtonLabel` / `nwsButtonTip` | NWS · {n} / NWS products on the map at this time: {n}. Each with its issuer, its own times and a link / The NWS products the map draws at this time: issuer, own times, words and link |
| `nwsTitle` | NWS products on the map at this time |
| `nwsIssued` / `nwsUntil` | issued {time} / until {time} |
| `nwsLink` / `nwsLinkArchived` | NWS product / Archived copy of the NWS product |
| `nwsNote` | Each NWS product is shown from the time NWS issued it until its own end time or NWS’s next version of it. Its end is not an all-clear. Follow local officials. |
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
- **Review fixes (review6):** the readout's and point card's lines follow the handle (WFP-R2, above). The NWS forecast
  flooded area, FEMA, CatFIM and the model layers stay "now" products: at a past step their Command chips say "now"
  (the forecast area with its issue day) and the slim chart's row says "As of now, not this time: …" (WFP-R6).
- **Phones (≤ 760 px, WFP-R5):** the row wraps in two lines: the buttons and the step's label (two-line clamp), then
  "NWS · n" and `.hg-step-line` with the short gap note and the "now" note (`gapNoteShort`), so the image's date and
  age stay visible.
- **Ticks (WFP-R7):** `PlaybackView.ticks` is null unless the timeline's products block is `available`, so the live
  answer's send times stay the chart's ticks when NWS's feed and the IEM archive are both down.
- **For web-forensic-flood-3d / final-check:** the Forensic dock carries the "NWS · n" list (with the IEM credit) but
  Forensic's own foot credits do not add the IEM archive while its 3D warning lines draw archived versions; a one-line
  addition there (`archiveCreditAtHandle(productsAt…, tl)`) would credit it as Command's foot does.
