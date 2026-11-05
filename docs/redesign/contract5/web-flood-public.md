# web-flood-public: as built (brief 5)

Role `web-flood-public` (wave 2), PLAN-5 §4.4, §4.8, §5; CONTRACT §16.10-16.12. Commits: `M1 HazardDisc split, water
texture, flood circle, title, status words` (9ca467d), `M2 official flood model and hooks, facts per kind, key, evacuation
rows, distance, preparation` (a75891f), `M3 map area layers, leader, point check, official rows, Layers drawer, phones,
screenshots` (fe8211e; most M3 code landed in the wave-2 work-in-progress snapshots 90f3d97 and be6c394), and the final
report commit. Paths under `web/src/`.

## The Public flood view (`ui/shell/PublicFloodChrome.tsx`)

The Public fire view's layout with the design's values (FloodView.dc.html): the round X "Back to all floods"
(`goToFloodOverview`), the title and the distance chip, the cluster (Show panels, view pill, Check an address, Layers,
`FireMenu`), from 1280 px the satellite status `FloodSatStatus` ("NASA OPERA · OCT 31 · 4 D AGO", amber after 3 days),
the water circle with its leader, the facts, the location card, the compact map controls, the key, the 30 px foot bar
(`FixedCopy variant="bar" extra={NOT_ALL_CLEAR}` and the map's credits). It keeps `useMapTint('flood')` (WFO-R12) and
mounts `useFloodOfficialSync()`. A flood resolved from its bundle or Fire-3d's last sight shows `FLOOD_LAST_KNOWN` above
the facts. Phones: the fire view's strip (120 px circle + chip) and bottom sheet (peek = the first two rows of the kind).
`data-view` is `public-flood`; `styles/view-public.css` now scopes every fire-view rule with
`.mw:is([data-view='public-fire'], [data-view='public-flood'])` (same specificity as before), and
`styles/view-flood-public.css` holds what differs (600 px left gradient .92 → .74, water circle colours, key swatches,
point-card lines, official rows; the facts column is 440 px from 1280 px so the 312 px circle fits at 1440 × 1000).

## Splits (fire output unchanged)

- `ui/public/HazardDisc.tsx`: `HazardDisc({ texture: 'thermal' | 'water', tone: 'active' | 'quiet' | 'demo' | 'unknown',
  statusLine, name, meaning, label, tip?, tipName?, onClick?, compact?, rain?, ref? })`, `CIRCLE_PX`, `NAME_ROOM`.
  **Deviation from §16.12:** `label` (the accessible name), `tipName`, `rain`, `ref` and the `'unknown'` tone are added
  (the fire container needs `unknown` and its label). The fire `HazardCircle` draws byte-identical markup (a temporary
  server-render capture before and after the split was equal; `floodView.test.ts` keeps a structure check).
- `ui/public/WaterTexture.tsx`: `WaterTexture({ tone, idPrefix, running, rain?, svgRef? })`, the design's SVG verbatim
  (base gradient, water mask, mist path, two currents −9° at 2.6 s and 1.5 s, mist band, rain 12° at 0.55 s, grain);
  `running: false` renders no `<animate>` / `<animateTransform>`. Quiet drops the rain unless `rain` (a watch keeps it).
- `ui/public/FireTitle.tsx`: exports `TitleBlock({ compact, srName, place, date, chip })` (the fire `FireTitle` uses it).
- `ui/public/DistanceChip.tsx`: exports `DistanceChipView({ compact, measure: ChipMeasure | null })` and the type
  `ChipMeasure { text: DistanceChipText; inside; bearing }`; the fire `DistanceChip` keeps `distanceToFire` (fireView.ts
  untouched).
- `ui/feed/OfficialNow.tsx`: exports `Row`, `SourceLink`, `type RowProps` and a new `CommandRows({ children })` (the
  command-variant provider; the context itself is not exported). No behaviour change.

## Components

- `ui/public/FloodHazardCircle.tsx` `FloodHazardCircle({ ref?, compact? })`; `ui/public/FloodTitle.tsx` `FloodTitle({
  chip?, compact? })`, `FloodDistanceChip({ compact? })`; `ui/public/FloodFacts.tsx` `FloodFacts({ peek?, more?, onMore?
  })`, `FloodMapData()` (prepare / progress / failed; **not shown in Public**: the 2D views need no preparation, D14;
  available to Command); `ui/public/FloodKey.tsx` `FloodKey({ details? })`, `FloodSatStatus()`, `FloodLayerCredits()`
  (the drawn layers' own credit lines, CONTRACT §16.15: RFC FIM, OPERA, FEMA when on, USGS for drawn gauges; rendered as
  the key's last line).
- `ui/shell/FloodLayersPanel.tsx` `FloodLayersPanel({ variant: 'public' | 'command' })`: Water (satellite, forecast area,
  warnings, gauges, channel; CatFIM in Command), Background (FEMA, off, "effective {date}"), Model (Command only, off),
  evacuation zones, basemap, legend (phones), units, Forensic. The profile (`map/floodProfile.ts`) decides what each
  variant offers. Public's note points to Command for the model and NWS category maps.
- `ui/feed/FloodEvacRows.tsx` `FloodEvacRows({ variant: 'command' | 'compact' })`; `ui/feed/FloodOfficialNow.tsx`
  `FloodOfficialNow({ variant: 'command' })` (one row per NWS product, Emergency first and open, NWS words in
  `data-verbatim`, "Show" fits the product area via `fitOfficialBounds`; river forecast row; evacuations; local officials'
  messages via `LocalAlertsRow`; foot `MODEL_SEPARATE`). **Not mounted yet:** web-flood-command mounts it.
- `location/FloodPointCard.tsx`: with a flood open the card starts with "Flood layers at this spot" (`checkPoint` lines
  tagged NWS / NWS FORECAST · EXPERIMENTAL / SATELLITE / FEMA) and, in Public, "The experimental model for this spot is in
  Command ›". The overview card below it is unchanged.
- `map/FloodLeader.tsx` `FloodLeader({ circle, leader })`: the 1.5 px `#4fc3ff` leader to the primary member gauge
  (category diamond in a 22 px halo) or, without one, to a point inside the largest NWS polygon (a 6 px pink ring);
  hidden when covered, like the fire leader.
- `map/FloodLegend.tsx` (details, flood open): the satellite answer's caveats and reason, the no-view and edge swatches,
  `SAT_NOT_SET_UP_SHORT` + the backend's login note when the token is not set up, the RFC FIM note, the main channel, FEMA
  when on.

## Pure modules

- `ui/public/floodView.ts`: `upperDay`, `isPastFlood`, `floodPlace`, `floodDateLine`, `floodShortName`,
  `floodCircleStatus(summary, tf, nowMs) → { kind, line, tone, meaning, rain }` (D19, C15; an upcoming product:
  `CIRCLE_MEANING_UPCOMING`, a watch adds `CIRCLE_MEANING_WATCH_TAIL`), `floodCircleLabel`, `floodFacts(input) →
  FloodFactRow[]` (keys `fim stage crest | detection damage gauges | watchArea gauges riverForecast`, then `started product
  evac local? updated`; rows carry `verbatim`, `subVerbatim`, `sub`, `link`, `tip`), `shortAreas`, `floodFactsSource`,
  `floodKeyItems(input) → FloodKeyItem[]` (keys `satellite noView edge forecast channel warning floodplain picture
  satNone`; ages at render, `SAT_STALE_MS` 3 days), `satLoginNote`, `nfhlEffective`, `polygonsOf`, `distanceToFlood`,
  `floodChipText`, `leaderTarget`.
- `official/floodModel.ts`: `Answer<T>`, `NO_ANSWER`, `answerState`, `officialState` (model output in an official slot reads
  unavailable), `answerReason`, `isModelOutput`, `orderAlerts`, **`productsAt(alerts, cursorMs, nowMs)`** (C1; CONTRACT
  §16.12 places it in `hydrographModel.ts`: it lives here so the map and the point check have it now —
  web-flood-command's `hydrographModel.ts` should re-export it), `productsDrawn` (productsAt + products still to start
  while the handle is at now; never after now), `phaseWord`, `senderName`, `floodAlertRows(resp, { zone, clock, past?,
  nowMs })`, `officialAlerts`, `leadAlert`, `mainAlert`, `memberGaugesOf`, `primaryMemberGauge`, `rfcName`, `fimMapped`,
  `shownGranule`, `floodEvacuation(q, tf, nowMs) → FloodEvacFact`, `evacOwnWordsMentionFire`.
- `location/floodCheck.ts`: `checkPoint(input) → { lines, future, nothing }` per CONTRACT §16.12, plus optional inputs
  `alertsStatus`, `zones`, `satClass` (`SatClassAt`: a DSWx class, `'noview'` from the picture, undefined while unknown),
  `tf`, `units`.
- `lib/areaDistance.ts`: `distanceToArea({ rings, point }) → { km, bearingDeg, inside } | null` (§16.12; null without a
  usable ring), `distanceToAreas(polygons, point)`.
- `map/floodAreaLayers.ts`: `FLOOD_AREA_SOURCES`, `FLOOD_AREA_LAYERS` (all `fx-flood-*`), `AREA_LAYER_KEY`,
  `floodAreaLayers()`, `satelliteImage`, `satelliteEdge`, `satelliteTiles`, `DRAW_SAT_PICTURE = false`, `mapFeatures`,
  `nfhlFeatures` (floodway / 1 % / 0.2 % only, never "minimal flood hazard"), `warningFeatures`, `imageCorners`,
  `fimHatchImage`, `nfhlStippleImage`.
- `state/floodBuild.ts`: `floodPrepState`, `activeBuildJob`, `pollDelay`, `jobFinished`.

## Stores and map

- `official/floodHooks.ts`: **new store `useFloodOfficial`** `{ floodId, alerts, gauges, fim, satellite, nfhl, local,
  asked }` (each an `Answer`), `FLOOD_OFFICIAL_REFRESH_MS`, `fetchFloodOfficial`, `syncFloodOfficial`,
  **`useFloodOfficialSync()`** (each flood chrome mounts it; FEMA only while its layer is on; local alerts
  `?bbox=&hazard=flood` for live floods; a past flood asks at its last product's time), `useFloodAreas()`,
  `useSatClassAt(lon, lat)` (the bundle's `water_satellite.bin` when it is the shown image, else the PNG's pixels),
  `binClassAt`, `pngClassAt`, `floodLocalAlertsUrl`, `askedAt`, `wantedKeys`. Model output is not fetched here.
- `state/flood.ts`: **additive key `buildError: string | null`**; `startFloodBuild(force)` implemented (POST build, poll
  `/api/jobs/{id}` with progress, re-read the detail for the manifest; 409 → the backend's reason); `openFlood` follows a
  build already running. Checked on the real route: a real flood went queued → running (terrain, maps) → done with its
  manifest loaded.
- `map/floodController.ts`: the area layers (inserted below the basemap's first label; hidden unless a flood is open, its
  view's profile allows them and its toggle is on), the satellite image source and its edge, warning areas by
  `productsDrawn` at `cursorMs`, the flood's own gauges in its view (members of any status, nearby at action or above,
  `gaugeFeatures(…, 0)`), `floodViewGauges()`; it subscribes to `useFloodOfficial`. `restyle` re-adds everything.
- `map/mapController.ts`: unchanged by this role.

## Deviations and decisions

- The Public view shows **no "Prepare map data"**: the 2D views need no bundle (D14); `startFloodBuild` serves Forensic.
- NASA's GIBS picture is **not drawn** (`DRAW_SAT_PICTURE = false`): its colour map shows clouds and snow in bright
  colours that read like a hazard map. The key, the point card and the legend say "Water seen by satellite: no usable
  image" with the backend's reason. Below the role's cut line: the integration decides.
- The flood layers' credit lines are the key's last line (`FloodLayerCredits`): `lib/dataCredits.ts` and
  `map/MapAttribution.tsx` are not this role's. The integration may move them into `floodCredits()`.
- Fact sub-lines are kept to one line where possible; the gauge's full name and data attribution, a product's sent time
  and a start's basis are the rows' tooltips.
- The design's status "FLOOD · ACTIVE" is "FLOOD · WARNING" etc. (D19); "FLOODED AREA [X] mi²" is "FORECAST FLOODED AREA
  (NWS, 5 DAYS) — Mapped" (D5); "REPORTED" is "FORECAST CREST (NWS)" (D11); the key names each layer with its own time
  (D8); the leader ends at the primary member gauge (D10).

## Notes for the next roles

- **web-flood-command:** mount `FloodOfficialNow` and `FloodLayersPanel variant="command"`; call `useFloodOfficialSync()`
  in the Command flood chrome (the answers are shared through `useFloodOfficial`); re-export `productsAt` from
  `hydrographModel.ts` (or import it from `official/floodModel.ts`); the area layers already follow `cursorMs`
  (`productsDrawn`); model and CatFIM layers are yours (`floodProfile` already allows them in command-flood).
  `checkPoint` takes a `model` answer for its MODEL line. `view-flood-public.css` holds the `.ffo-*` / `.ffe-*` /
  `.ffc-*` styles the shared components use (imported by them).
- **web-flood-forensic:** `useFlood.getState().startFloodBuild(force?)` and `floodPrepState(...)`; `buildError` says why a
  start failed.
- **Integration:** the 1024 px layout pass (the key with its credits gets tall); GIBS picture drawing; credits in the
  map footer; `location/CoordinateStrip.tsx` still says "No fire open" (WFO-R9).
