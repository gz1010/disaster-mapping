# web-flood-overview: as built (brief 5)

Role `web-flood-overview` (wave 1), PLAN-5 §4.1-4.3, §4.9, §5, §7.3; CONTRACT §16.10-16.13. Commits: `M1 hazard
foundation`, `M2 fixtures, flood store tests, no fire data in flood mode, fetch-spy test`, `M3 ...` (see the report).
Paths under `web/src/`.

## State, URL, history

- `state/workspace.ts`: `type Hazard = 'fire' | 'flood'` (same literal as `api/floodTypes.ts`), `hazard` (default
  `'fire'`), `setHazard(h)` (keeps camera, selection, preset, Show details; closes a fire card and resets
  `overviewShowAll`). URL `?hazard=flood` (written by `writeWorkspaceParams` when `hazard === 'flood'`, removed
  otherwise); `parseWorkspaceParams` reads it, and a `?flood=` link without `?incident=` starts in Floods.
- `state/flood.ts` (`useFlood`, dev handle `window.__flood`): exactly the CONTRACT §16.10 shape plus three **additive**
  keys: `resolvedFrom: FloodDetailResponse['resolved_from'] | null` (rule 13; `bundle` / `last_known` → the views show
  `FLOOD_LAST_KNOWN`), `detailLoading: boolean`, `detailError: string | null` (a non-404/503 detail failure; the list
  row's summary stays shown). Also exported: `DEFAULT_FLOOD_LAYERS`, `FloodSource`, `pickFlood(id, source)`,
  `goToFloodOverview()` (history-aware "Back to all floods"), `openFloodSummary(state)` (the open flood's summary only
  when it is the one shown, aliases included).
  - `openFlood(id, { source, replace })`: closes an open fire under `crossingHazard` (no history entry of its own),
    shows the list row at once, sets `hazard = 'flood'`, then the detail route. Canonical id ≠ requested id (alias) →
    `floodId` becomes the canonical id under `replacingHistory` (URL replaced). 404 → closed with
    `missingReason: 'not_listed'`; 503 (or any failure with nothing to show) → `'lists_down'`; both replace the entry.
  - `closeFlood({ replace })`, `loadFloods(key)` (per-key sequence guard), `setFilter(key)` (loads a year tab once),
    `setShowWatches`, `setGauge`, `setCursor` (NaN → null), `setFloodLayer`.
  - `startFloodBuild` is the **typed stub** (`async () => undefined`): web-flood-public implements it (C10).
  - A `useStore` subscription closes the flood (under `crossingHazard`) when a fire opens and sets `hazard = 'fire'`.
- `state/floodNav.ts` (new): `crossingHazard(fn)`, `isCrossingHazard()`, `replacingHistory(fn)`, `isReplacingHistory()`;
  the flags state/flood.ts and state/history.ts share without importing each other.
- `state/floodCatalog.ts`: `FloodListKey`, `FloodListSlot` (`{ response, loading, error, status }`), `FLOOD_PAST_YEARS`
  `[2026, 2025]`, `EMPTY_SLOT`, `slotKey`, `getSlot`, `slotPending`, `slotApply`, `slotFail` (keeps the last answer),
  `findFloodIn(lists, idOrAlias)`.
- `state/floodOverview.ts`: `WATCHES_SHOWN_BY_DEFAULT = false` (U2), `PRODUCT_ORDER`, `floodRank` (CONTRACT §16.8),
  `sortFloods`, `floodMarkerKind` (`large | active | small | other`; past and inactive floods are `other`),
  `isWatchOnly`, `shownFloods`, `hiddenWatches`, `floodsInView`, `highestProduct` (Emergency first), `gaugeCategoryRank`,
  `floodListHealth(slot)` (`loading | ok | nws_down | gauges_down | both_down | failed`), `knownFloodCount` (null, never
  0, when unknown), `floodFlyTo`, `hasFlashWarning`, `isQuietFlood`.
- `state/history.ts`: `HistoryEntryState.flood?: string | null`; `floodParam(search)` (null when `?incident=` is also
  there); `navigationUrl` drops `flood` when it sets `incident`; new `floodNavigationUrl(href, flood)` drops `incident`,
  `t`, `mode`, `view`, `sel`; `installHistorySync()` (the body of `useHistorySync`, exported for tests) writes flood
  entries (push / replace / none like fires) and skips the close made while crossing hazards; `applyLocation` applies
  the entry's flood and its `?hazard=`. Tests: fire → flood → Back, flood → fire → Back (one entry each), alias replace,
  404 / 503.
- `state/selectors.ts`: `noEventOpen()`, `openEventKind()`, `eventKindOf(incidentId, floodId)` (hook-friendly),
  `floodArea(bbox)` (bbox + 10 %, 2 km for a degenerate box), `currentArea(marginKm = 0)`.
- `state/runtime.ts`: `useFloodPolling()` (mounted by App): the live list (and the filter's year) on the first switch to
  Floods or at start with `?hazard=flood` / `?flood=`, then every 5 min while Floods is picked or a flood is open.
- `state/timeZone.ts`: the open flood's zone joins the chain (fire → flood → place → viewer) in `useTimeFormat` /
  `getTimeFormat`; `useZoneSource()` reports a flood as `'place'` (lib/time.ts `zoneLine` knows only fire / place /
  viewer); new `EventZoneSource` with `'flood'`, `useEventZoneSource()`, `getEventZoneSource()`, `eventZoneSourceOf()`.

## Chromes, switch, App

- `ui/shell/views.ts`: `MapChrome` has the five values; `mapChromeOf(event: 'fire' | 'flood' | null, preset)`;
  `atmosphereEdgesOf` maps public-flood → `fire`, command-flood → `command`.
- `App.tsx`: the chrome slot mounts `PublicFloodChrome` / `CommandFloodChrome`; bootstrap opens `?flood=` (a link with
  both opens the fire); document title `<name> · live · Fire-3d`, no event `Fire-3d · Wildfires and floods`; skip link
  "Skip to the flood list" in Floods; the map's aria-label "Flood map" in Floods; `useFloodPolling()`; the loading line
  includes the flood detail; `StatusOverlay` only in a fire.
- `ui/shell/PublicFloodChrome.tsx`, `CommandFloodChrome.tsx`: **stubs** (bar with "Back to all floods", name, LIVE /
  year, DEMO; a card with the highest NWS product verbatim and its end, `FLOOD_LAST_KNOWN` when resolved from bundle /
  last known; `LocationCard`; map controls; `FixedCopy variant="corner"`; the Layers drawer). web-flood-public and
  web-flood-command replace them.
- `ui/public/HazardSwitch.tsx`: `HazardSwitch({ size?: 'sm' | 'md', className? })`, radiogroup "Show: fires or floods",
  arrow keys / Home / End; the active option's glyph takes the accent ink. Styles in `styles/flood-overview.css`
  (`.hz-*`). In the overview title slot ("United States · ( Fires | Floods )"; phones: the switch alone, the h1 kept for
  screen readers) and on Forensic's entry page.
- `ui/shell/OverviewChrome.tsx` in Floods: `FloodStatus`, `FloodListPanel`, `FloodListNoticeBanner`, `FloodLegend`,
  `FloodShowDetailsPill`, the disclaimer with `FLOOD_LIST_ABSENCE` (short on phones); no fire card. The fire overview
  differs from brief 4 only in the title slot and the document title.
- `ui/shell/ForensicWorkspace.tsx`: the entry page carries `HazardSwitch`; in Floods "Pick a flood" + `FloodList`
  (`pickFlood(id, 'list')`); fixed copy at its foot. **A flood open in Forensic still shows this page**: web-flood-forensic
  mounts its branch here (`ForensicWorkspace` default export: `noFire → OpenFireFirst`).
- `ui/shell/LayersPanel.tsx`: in flood mode the legend is `FloodLegend variant="panel"` and "Flood layers" has the river
  gauges toggle (`setFloodLayer('gauges', …)`); Forensic button "Open Forensic (pick a flood there)".

## Map

- `styles/map-tokens.css` + `map/floodStyle.ts`: the 15 tokens of §16.13 (`FLOOD_TOKENS`), `FLOOD_ALERT`, `FLOOD_MODEL`,
  `GaugeTone`, `CATEGORY_COLORS`, `DIAMOND_PX` (6 / 7 / 8 / 9), `gaugeTone(category)`, `CATEGORY_RANK`, `FLOOD_PALETTE`
  (the fire `PALETTE` shape), `floodPalette(theme)`, `FLOOD_TICK_RGBA`, `FLOOD_AREA` (area colours for the flood views).
  `floodStyle.test.ts` bans hue 75°-165° with saturation > 25 % over tokens, palette, categories, areas and the CSS.
- `map/basemapStyle.ts`: `TintLevel` gains `'flood'` (`AERIAL_TINT.flood = { saturation: -0.43, brightnessMax: 0.77 }`,
  between `fire` and `none`). The Public flood chrome asks for it with `useMapTint('flood')`.
- `map/mapStore.ts` `MapActions.frameFlood()`; `map/framing.ts` `FrameGoal.kind` gains `'flood'`, `floodTarget(id)`
  (`'flood:<id>'`), `isFloodTarget`, `floodGoalFor(summary, key?)` (bbox + 10 %, else the point at z11). The controller
  frames an open flood like a fire (one flight when its summary is in; the overview restored on Back). `MapControls`
  shows "Flood" (frame) while a flood is open.
- `map/overviewLayers.ts` (fire defaults unchanged): `overviewSourceOptions(group, width, { rankProp, rankValue })`,
  `groupLabelText(color, unit = ' FIRES')`, `MarkerPalette`, `OverviewLayerOptions { narrow, palette, unit, rankProp,
  sources, ids, chips, dotColorProp }`.
- `map/floodLayers.ts`: `FLOOD_SOURCES` (`fx-flood-overview-pinned|active|other`), `FLOOD_GAUGE_SOURCE`
  (`fx-flood-gauges`), `FLOOD_OVR` (the fire ids with `fx-flood-overview-`), `FLOOD_GAUGE_LAYERS`, `FLOOD_POINT_LAYERS`,
  `FLOOD_LABEL_LAYERS`, `FLOOD_CLUSTER_LAYERS`, `GAUGE_MIN_ZOOM` 5, `FLOOD_LABEL_ZOOM`, `splitFloods`, `floodFeatures`
  (properties `id name live small kind r lr dot dot_color hit sort rank lz label meta meta_color synthetic side`),
  `floodOverviewData`, `floodSourceOptions` (`max_rank`), `floodMarkerLayers(theme)`, `GaugePoint`, `DIAMOND_IMAGE`,
  `gaugeFeatures(points, units, minRank = 1)`, `diamondImage(tone)`, `floodTickImage(theme)`, `gaugeLayers(theme)`.
- `map/floodController.ts`: `mountFloodLayers(map, { topBeforeId })` → `FloodLayersHandle { update, restyle, hit,
  zoomToGroup, hoverLines, remove, layerIds }`. **Deviation from §16.11:** `hit()` returns `FloodHit { kind, id, lngLat? }`
  (a group's id is `"<group>:<cluster id>"`), and two methods are added: `zoomToGroup(hit, ease)` and `hoverLines(point)`.
  National gauges from `/api/official/river-gauges?scope=national&min=action` (5 min), falling back to the listed floods'
  member gauges while that route is missing or down. Also exported: `floodsShown()`, `floodMapMode()`, `memberGauges()`.
  It draws the overview markers, groups, labels and gauges only; the flood views' area layers are the next roles'.
- `map/mapController.ts`: mounts the module (restyled on every basemap load), hides the fire overview layers while
  `floodMapMode()`, stops the fire zoom focus / chips / nearby perimeters then, routes clicks to the flood module first
  (flood → `pickFlood(id, 'marker')` for both presets, D14; group → zoom ≤ z8; gauge → selects its point), flood hover
  text, `noEventOpen()` at the overview checks.
- `map/floodProfile.ts`: `floodProfile(chrome)` per §16.11 plus `floodLayerShown(chrome, key, on)`.
- `map/LeaderLabels.tsx`: in Floods it names the large floods with `label` (DEMO tag included) and `meta` in
  `meta_color`; click → `pickFlood`.
- `map/FloodLegend.tsx`: `FloodLegend({ variant: 'row' | 'chips' | 'key' | 'panel' })`; "NWS warning area" only while a
  flood is open; never a model entry.
- `map/MapAttribution.tsx` + `lib/dataCredits.ts`: `NWS_FLOOD_CREDIT`, `NWPS_CREDIT`, `floodCredits(floodMode)` in the
  footer while Floods is picked or a flood is open.

## Lists, status, point card, search

- `ui/public/FloodStatus.tsx`: "NOV 4 2026 · 31 FLOODS · 1 WATCH HIDDEN" (`floodCountPart`).
- `ui/shell/FloodListPanel.tsx`: `FloodListPanel({ closeHidesDetails, sheetPeek })`, `FloodList({ onPick })`,
  `FloodOfficialBlock`, `FloodPeekBar`, `FloodShowDetailsPill({ sheet })`, `FloodMissingNotice`,
  `FloodListNoticeBanner` (portal into App's top centre, dismissable).
- `ui/public/floodOverviewText.ts`: `fmtStage`, `gaugePlace`, `categoryWord`, `floodMeta`, `floodMetaColor`,
  `floodDotColor`, `floodWhere`, `floodRowSub`, `floodRowValue`, `floodDisplayName`, `gaugeLabel`, `floodCountPart`,
  `FLOOD_COUNT_TIP`, `officialProductsLine`, `floodInViewLine`, `floodDetailsPillLabel`, `NEAR_GAUGE_KM` 25,
  `floodPointModel(input)` (D24: `NO_PRODUCT` / `NO_GAUGE_NEAR` only for `available` answers), `floodHereLine(alerts)`,
  `floodListNotices(health)`.
- `location/FloodPointCard.tsx`: `FloodPointCard({ sel })` (every product at the point verbatim with `data-verbatim`,
  watches included; the nearest gauge at action or above within 25 km with `GAUGE_OTHER_STREAM`; the 3 nearest listed
  floods; `NOT_ALL_CLEAR`) and `FloodHereInFires({ sel })`. Point query = a zero-size bbox (`/api/official/flood-alerts
  ?bbox=lon,lat,lon,lat`); gauges `?bbox=` ± 25 km. `location/LocationCard.tsx` picks the flood card in flood mode and
  adds the Fires-mode line under the fire cards.
- `location/search.ts`: `FloodHit`, `searchFloods(text, pool, limit)` (name, rivers, county, state, id);
  `location/SearchBox.tsx`: in flood mode an exact (or the only) flood name opens that flood (`pickFlood(id, 'search')`);
  everything else continues to the place search unchanged.

## Official, extras

- `official/runtime.ts`: `fireMode(hazard, floodId)`; the national fire weather is fetched only on the fire overview and
  `useFireWeatherData` / `fireWeatherDataNow` answer null in flood mode (no Red Flag outlines); `official/mapLayer.ts`
  re-syncs on hazard and flood changes.
- `extras/client.ts`: `AreaQuery.hazard?: 'fire' | 'flood' | null` (`hazard=flood` only for floods; fire URLs byte-for-byte
  as before). `extras/ExtrasSync.tsx`: with a flood open, evacuations for `floodArea(bbox)` with `hazard=flood`, for now;
  no cameras or imagery. The answer lands in `useExtrasRuntime().evac` (its `incident_id` is null for floods: readers
  must not use `forIncident(evac, incidentId)` for a flood).

## Copy and tests

- `ui/shell/floodCopy.ts`: every PLAN-5 §5 string (slots `{x}` filled by `fillCopy`), (B) strings as fallbacks, the
  §5.3 category table `GAUGE_CATEGORY_DISPLAY`, `CIRCLE_STATUS`, `CIRCLE_MEANING`, `DATE_LINE`, `BAR_STATUS`,
  `FLOOD_OVERVIEW` (overview words), `FORENSIC_FLOOD`, `watchesHidden(n)`; the guard: `BANNED_PATTERNS` (RegExps),
  `ALLOWED_PHRASES`, `floodWordingProblems(text)`, `collectStrings(value)`, `stripVerbatim(html)`. Other roles' rendered
  scans use these three helpers.
- `web/scripts/shot.mjs --reduced-motion`: Playwright `reducedMotion: 'reduce'`; prints whether the media query matches
  and how many SVG animation elements and running CSS animations remain.
- Web fixtures: `api/__fixtures__/floods/*.json` plain copies of `backend/tests/data/floods/fixture_api` (the PNG left
  out), `edgeCases.ts` (every PLAN-5 §7.3 case; derived ones documented in the file).
- Fetch-spy test `state/floodFetchSpy.test.ts`: renders on the server with `useEffect` / `useLayoutEffect` collected and
  run once, `useSyncExternalStore` and zustand hooks reading the current state, `fetch` spied; flood overview (both
  presets) and both flood chromes ask no fire-only endpoint (`api/floods.ts FIRE_ONLY_ENDPOINTS`); a fire-mode control
  proves the spy sees effect requests.

## Notes for the next roles

- `PublicFloodChrome.tsx` / `CommandFloodChrome.tsx` are stubs to replace; `ForensicWorkspace.tsx` needs the flood
  branch mount (web-flood-forensic).
- `location/CoordinateStrip.tsx` (not this role's) still says "No fire open" on the flood overview readout; a flood
  wording there needs its owner (integration).
- `useZoneSource()` reports a flood as `'place'`; a flood-specific `zoneLine` wording would need lib/time.ts (not
  this role's).
- `ShowDetailsPill.tsx` / `useOverviewCount.ts` stay fire-only; OverviewChrome swaps in `FloodShowDetailsPill`.
- The national gauges route (`scope=national`) answered 404 on the real API at build time (bundle-api M3); the map falls
  back to member gauges meanwhile.
