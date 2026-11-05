# Audit 5: the web app and the design for floods (brief 5)

Role `audit-web-floods` (brief 5, stage "audit and research"). Read-only: no app code changed, no server started, no
bundle built. Written 2026-11-04, 20:05-20:35 UTC. Two polite GETs to NOAA (curl, User-Agent "Fire-3d research
prototype (audit)", no key or token sent); the evidence log is section 8. Paths are under `web/src/` unless they start
with `docs/` or `backend/`. Line numbers are those of branch `claude/cool-mayer-ki7to6` at ac05eea. This audit sits next
to `audit-5/backend.md` and uses its data shapes (its section 3.8): `FloodSummary`, `FloodManifest`, `FloodAlert`,
`RiverGauge`, `FloodMapResponse`, `ModelOutputResponse`, ids `flood-YYYYMMDD-<slug>-<h6>`, endpoints `/api/floods…`.

Read for it: `BRIEF-5.md` (request, four decisions), `BRIEF-3.md`, `BRIEF-4.md`, `handoff-4/HANDOFF.md` (design system,
"Flood view"), `handoff-4/screens/FloodView.dc.html` (every inline style), `handoff-4/renders/FloodView.jpg`, seven of the 14
`docs/screenshots/brief4-final-*.png` (section 8), CONTRACT §15 (§15.5 as built), and the web code listed in section 1.

Words used here, in plain terms:

- **Gauge**: a measuring post in a river. Its **stage** is the water height at the post, in feet (not the water's
  depth). NWS gives each gauge fixed levels: **action stage** (near flooding; agencies start preparing), then **minor**,
  **moderate** and **major** flood stage. The gauge's **flood category** is the level its water has reached.
- **Hydrograph**: a chart of a river's stage (or flow) over time: the measured past, then the forecast.
- **RFC forecast**: the official river forecast of an NWS River Forecast Center for a gauge (a forecast point).
- **NWM**: NOAA's National Water Model, a computer model of every US stream. Its output is **model output**, never an
  official forecast. At a gauge it gives the river's **flow** (cubic feet per second), not its stage.
- **NWS forecast flooded area**: NWS's map of where its river forecasts say water could reach in the next 5 days
  (backend's `rfc_fim`; NWS calls the service experimental).
- **Satellite water**: NASA OPERA's map of surface water seen from space (every 2-3 days, blind under clouds). It shows
  all water, the river's normal water included.
- **Chrome**: the panels, bars and buttons that float over the map (the map itself is not chrome).

## 0. Summary

- **The web app has one event slot, and it is a fire.** `useStore` holds `incidentId`, an `IncidentSummary` (acres,
  containment, CAL FIRE / WFIGS record) and a fire `IncidentManifest`; about 45 checks in 27 files read "no incident"
  as "the national overview" (section 1.2). Markers, labels, legends, status lines, the timeline, the official rows and
  the Forensic scene are all fire-shaped (section 1.1, about 90 places).
- **Least disruption: floods live beside fires, as on the backend.** A new flood store (`state/flood.ts`) with its own
  list, open flood, gauge and time cursor; a `hazard` switch in the workspace store (`?hazard=flood`); an open flood in
  `?flood=<id>`, never in `?incident=`; one event open at a time (opening a flood closes a fire and back). Two new map
  chromes (`public-flood`, `command-flood`), a flood branch in Forensic, and flood map layers mounted as one module the
  way the official layers are (`official/mapLayer.ts`). No fire component changes its behaviour.
- **Most brief-4 pieces are reused as they are:** `TopBar`, `ViewPill`, `ReadoutRow`, `FixedCopy`, `MapControls`,
  `DistanceChip`'s look and maths, `MapAtmosphere`, the leader-label layout, the marker layer specs, `OfficialNow`'s row,
  the locate-me button, the selected-point marker. Three need a small split so floods can feed them: `HazardCircle`
  (a `water` texture from the design, section 2.6), `FireTitle` and `LeaderLabels` (data from props, not from the fire
  store).
- **The national map** gets a **Fires | Floods** switch in the top bar's title slot ("United States · Fires | Floods"),
  water-blue circles with the fire markers' sizing rules, groups "N FLOODS", gauges as small diamonds in NOAA's flood
  category colours (never NOAA's green for "No Flood"), and leader labels "Animas River flood / MAJOR · 24.1 FT".
- **Public flood view**: the design's layout on the real map; the water circle, title, distance chip, seven official
  facts and a key. Four small departures from the design copy, each for safety or accuracy (section 2.6.5), the main one
  being that "Flooded area now" becomes what each layer really is, with its own time.
- **Command flood view**: the fire Command layout. Left: the selected point against each mapped flood layer (with its
  source, time and kind), the nearest gauge with stage and category. Right: "Official now" with NWS flood products
  verbatim. Bottom: the slim timeline becomes a **hydrograph** (observed solid, NWS RFC forecast dashed, NWM dotted and
  labelled experimental, flood-stage lines).
- **Forensic flood view**: the same scene, terrain and camera, with flood layers draped on the terrain (the terrain
  shader already draws water), gauges as 3D stage bars, the dock as a larger hydrograph. Fire effects do not run.
- **One backend addition the web needs** that `backend.md` does not list: the NWM flow series at a gauge's river reach
  (NWPS `/reaches/{reachId}/streamflow`, measured, section 8; risk W-R7). Everything else the views draw is already in
  its endpoints (map layers in `/api/floods/{id}/maps`, OPERA picture tiles in `/api/extras/imagery`).
- **Effort: about 52 agent-hours of web work** (range 40-64), calibrated on brief 4's measured build times; about
  22-30 hours of wall-clock with three web agents in parallel, alongside the backend. Finish-time input in section 6.3.

## 1. Where the web app assumes "fire" (file:line)

### 1.1 By area

| Area | Where | What it assumes |
|---|---|---|
| Event slot | `state/store.ts:138-151` `AppState`: `incidentId`, `summary: IncidentSummary`, `manifest: IncidentManifest`, `forecast`, `timeseries`, `events`, `weather`, `detections`, `perimeters`; `:37` `IncidentSource`; `:296-308` the cache of shown fires | One event, a fire bundle |
| Lists | `state/store.ts:436-440` `fetchList` → `getIncidents` (live, 2026 season, 2025); `state/catalog.ts:8-30` three `IncidentSummary` lists; `:66-67` season rows by `year` | Every list is a fire list |
| Forensic layers | `state/store.ts:43-61` `LayerKey` (fuels, burnScar, observedFire, isochrones, forecast, detections, perimeters, smoke, ignition, lattice…), `:111-130` defaults | Fire layers |
| Overview rules | `state/overview.ts:13-17` season year and acres; `:28-45` `LIST_ABSENCE`, `NIFC_LIST_DOWN`, `ALL_LISTS_DOWN` name CAL FIRE and NIFC; `:53-74` `isActiveFire`, sort by acres; `:110-117` `fireStatus` (contained / out); `:134-159` fly-to box sized by acres; `:191-194` "N fires in this view"; `:286-331` source notices and empty texts | Fire records |
| Workspace | `state/workspace.ts:98-107` `MapLayerKey` (observed, detections, perimeters, forecast, events + evacuation, cameras, recentImagery); `:151` `fireCardId`; `:153` `overviewFilter` active / season / past; `:225-250` URL params (no hazard); `:279` `linkedIncident` from `?incident=`; `:289-294` `incidentFlyTo`; `:335-345` `returnToIncident` → `frameFire()`; `:373-389` incident-switch subscription | |
| History and URL | `state/history.ts:16-20` entry `{ incident }`; `:27-29` `incidentParam`; `:42-49` `navigationUrl` (`?incident=`); `:70-88` `applyLocation`; `:92-113`; `state/runtime.ts:102-117` `?incident=&t=&mode=`; `:119-127` `shareUrl`; `:131-…` `useUrlSync` | One event kind in the address |
| Picking | `state/fireCard.ts:19-58` `showFireCard`, `openFireView`, `pickFire` look ids up in the fire lists | |
| Time zone | `state/timeZone.ts:40-44` `fireZone`: the zone of the open fire only | |
| App shell | `App.tsx:53-64` bootstrap loads fire lists and `?incident=`; `:71` title "Wildfire Forensics & Forecast"; `:210` "Skip to the fire list"; `:246-279` "Prepare analysis" notice; `:297` `overview = incidentId == null`; `:302` `mapChromeOf(!overview, preset)`; `:333` "Wildfire map" | |
| Chromes | `ui/shell/views.ts:10-15` `MapChrome` = overview / public-fire / command-fire; `:22-26` view tips ("Map of the fire…") | |
| Overview chrome | `ui/shell/OverviewChrome.tsx:82-84` "United States · all fires"; `:90` `OverviewStatus`; `:98` `LeaderLabels`; `:133-135` "Fires in the lower 48" + `OverviewPanel`; `:151-154` `MapLegend`; `:157` `LIST_ABSENCE_SHORT` | |
| Bar status | `ui/public/overviewText.ts:29-38` "203 ACTIVE", "FIRE LIST UNAVAILABLE", tip naming CAL FIRE and NIFC | |
| List panel | `ui/shell/OverviewPanel.tsx:49` `OVERVIEW_TITLE`; `:214-215` "Reload the fire lists (CAL FIRE and NIFC)"; `:273-276` | |
| Top-bar items | `ui/shell/topBarItems.tsx:64-70` `AllFiresBack` "Back to all fires"; `ui/shell/fireBarInfo.ts:15-21` reads the fire summary | |
| Public fire chrome | `ui/shell/PublicFireChrome.tsx:59` "Back to all fires"; `:105` `usePublicFireTime`; `:140-150` `HazardCircle`, `FireFacts`; `:169-171` `FireKey` | |
| Hazard circle | `ui/public/HazardCircle.tsx:62-73` summary and agency record from the fire store; `:89-130` the thermal texture inline; `:84` "This fire" | |
| Fire view words | `ui/public/fireView.ts:26-38` fixed copy (perimeter, Prepare map data); `:89-100` "WILDFIRE · ACTIVE" from the agency record; `:182` `distanceToFire(perimeter, grid, reported)`; `:406` `fireFacts` (acres, containment, NWS fire weather, evacuations) | |
| Title, chip, facts, key | `ui/public/FireTitle.tsx:171-186` (summary from the store); `DistanceChip.tsx:233-239, :278-281` (newest perimeter); `FireFacts.tsx:66-113` (Prepare map data), `:120-133`; `FireKey.tsx:197-255` (latest perimeter) | |
| Command chrome | `ui/shell/CommandFireChrome.tsx:54` `IncidentPicker`; `:65` `ImageryChip` (fire detections status); `:78` `CommandAreaLabels` ("Observed fire", "Modeled spread"); `:82-84` `AnalysisDrawer`; `:90` `CommandReadout`; `:110-113` "Incident updates" + `UpdatesFeed`; `:128` `MapLegend` chips; `:133` `CompactTimeline` | |
| Command readout | `location/CommandReadout.tsx:42-45` UTM zone from the fire grid; `:215-273` record rows (burned, contained, incident id); `location/describe.ts:47, :202` "Inside the mapped fire area"; `:181` "Outside modeled area… Unknown, not low." | |
| Official runtime | `official/runtime.ts:20-60` CAL FIRE record, WFIGS record, fire weather, local alerts, statewide fire weather; `:95` statewide answer when no incident; `:136-141` `officialTimeReady` | Fire weather and fire records |
| Official rows | `ui/feed/OfficialNow.tsx:729-767` evacuation / fire record / fire weather / local rows; `official/fire.ts` distance to "the fire" (perimeter + detections); `official/mapLayer.ts:200-205` NWS fire weather outlines | |
| Extras | `extras/ExtrasSync.tsx:23-30` and `extras/client.ts:101-106` `incidentAreaBbox(summary, manifest)`: the fire's area; `extras/imagery.ts:104` `pickDefaultImagery` (fire families) | |
| Point card | `location/LocationCard.tsx:38-41` overview card vs fire card by `incidentId`; `location/OverviewCard.tsx:24, :38` nearest fires | |
| Search | `location/search.ts:4-5, :22-34` exact incident names open fires; `location/SearchBox.tsx:65, :261` "Showing the … Fire" | |
| Map engine | `map/mapController.ts:186-190` `catalogOf`; `:514-538` the three fire overview sources; `:596-641` profiles; `:644-695` `updateOverview` / `applyOverviewState` (hides fires not started at a replay time); `:784-786` `openFireFromOverview` → `pickFire`; zoom focus `scheduleFocus` `:386, :401, :446, :563` | Fire markers, fire focus |
| Markers | `map/overviewLayers.ts:120-160` acres thresholds, marker kinds; `:100-108` chip "Spread not prepared yet"; `:418-452` orange `PALETTE`; `:591-592` " FIRES" | |
| Leader labels | `map/LeaderLabels.tsx:104-107` acres, strips " fire", `kind === 'large'`; `map/leaderLayout.ts:266-268` "AC" | |
| Map layers | `map/layers.ts:15-61` fire sources and layers; `:88-94` `LAYER_GROUPS`; `map/fireProfile.ts:11-27` profiles full / public-fire | |
| Legend | `map/MapLegend.tsx:112-215` fire swatches and texts | |
| Map controls | `map/MapControls.tsx:343-347` "Incident" framing → `frameFire()` | |
| Timeline | `ui/timeline/CompactTimeline.tsx:55-71` `buildCompactTimeline(manifest, forecast)`; `:582` latest observation = satellite fire detection; `ui/Timeline.tsx:22-30` (Forensic) | Fire time range and spread forecast |
| Forensic shell | `ui/shell/ForensicWorkspace.tsx:144-148` no fire → `OpenFireFirst`; `:130` "Frame fire"; `:138` "Charts & key events"; `:200` demo badge "terrain, fuels, fire and weather are synthetic" | |
| Forensic panels | `ui/Header.tsx` (`IncidentPicker`); `ui/RightPanel.tsx:13-18` tabs; `ui/LayersTab.tsx:26-67` groups Base / Fire / Parametric / Live; `ui/IncidentOverview.tsx`; `ui/WeatherCard.tsx:55` "Weather & Fire Behavior" | |
| Scene assets | `scene/assets.ts:133-147` `loadBase` (elevation, observed arrival, fuel, canopy, burn severity, sky view, water, trees, NAIP); `:65` fire grid; `:318-320` keyed on `useStore.manifest` | |
| Scene effects | `scene/fx/index.tsx:22-46` trees, lattice, detections, perimeters, smoke, embers, ignition, aircraft, telemetry; `scene/fx/driver.tsx:1-4` fire fronts | |
| Terrain | `scene/terrain/Terrain.tsx:129-139, :221-226` fire uniforms; `scene/frame.ts:6-17` `FireFrame` (`hasFire` false is handled) | |
| Hand-off | `ui/shell/handoff.ts:55-78` camera hand-off reads `store.manifest` | |

Already generic (no change needed): `ui/shell/TopBar.tsx` (bar, view pill, icon pills, status, place), `Readout.tsx`
`ReadoutRow`, `FixedCopy` / `fixedCopyText.ts`, `map/MapAtmosphere.tsx`, `map/markers.ts` (selected point),
`map/leaderLayout.ts` (layout maths), `map/useMapAnchor.ts`, `location/LocateButton.tsx` and `locate.ts`,
`location/geometry.ts` (`pointInRings`, `nearestOnRings`), `lib/geodesy.ts`, `lib/time.ts`, `lib/usStates.ts`,
`state/rotation.ts`, `ui/controls.tsx`, `scene/camera/CameraRig.tsx`, `scene/probe/ProbeDriver.tsx`,
`scene/atmosphere/*`, `scene/post/*`, the terrain's water rendering (`terrainMaterial.ts:85-86, :280, :397-431`).

### 1.2 "No incident" means "the overview": the checks a flood touches

With a flood open, `useStore.incidentId` stays `null`, so each of these checks would treat the flood view as the fire
overview. Grouped by what to do (`grep "incidentId == null|!= null|!s.incidentId"`, 45 checks in 27 files):

| Group | Checks | Action |
|---|---|---|
| Shell: must know a flood is open | `App.tsx:297` (feeds the chrome choice `:302`; the loading line `:283` adds the flood's loading); `state/history.ts:78, :96, :100`; `state/runtime.ts:138`; `state/workspace.ts:338, :377`; `state/timeZone.ts:42`; `ui/shell/ForensicWorkspace.tsx:146`; `location/LocationCard.tsx:41`; `location/SearchBox.tsx:131` | Use one selector `noEventOpen(s, f)` (no fire and no flood) or the flood store directly |
| Map engine: must know the hazard | `map/mapController.ts:370, :424, :598, :662, :995, :1393, :1553`; `map/framing.ts:195`; `map/MapControls.tsx:292, :324` | Hide fire markers and chips when `hazard === 'flood'`; no fire zoom focus; route clicks to flood layers first; framing button frames the flood |
| Official: must not fetch fire data | `official/runtime.ts:95` (statewide fire weather), `:139`; `official/context.ts:50, :75`; `official/mapLayer.ts:203` (Red Flag outlines) | Fire weather only on the **fire** overview; outlines hidden in flood views (the module's `update({ visible: false })`) |
| Fire components a flood chrome never mounts | `extras/ImageryChip.tsx:77, :79`; `ui/public/usePublicFireTime.ts:44`; `ui/shell/UpdatesPanel.tsx:51, :147`; `ui/shell/topBarItems.tsx:56, :120`; `ui/shell/fireActions.ts:77`; `ui/shell/LayersPanel.tsx:219`; `ui/feed/OfficialNow.tsx:738`; `official/hooks.ts:255`; `location/CoordinateStrip.tsx:226`; `map/MapLegend.tsx:72`; `map/MapNotices.tsx:41`; `state/fireCard.ts:27`; `state/store.ts:511` | No change |

## 2. Proposed design (least disruption)

### 2.1 Principle

Floods sit **beside** fires, never inside the fire types: their own store, ids, URL parameter, chromes, map layers and
scene branch. One event is open at a time. Every fire file keeps its behaviour; the changes to shared files are
additive and listed in section 2.11. Everything is drawn from the backend's flood endpoints; the Public and Command
views work **without a flood bundle** (list summary + live endpoints), and only Forensic needs one (terrain).

### 2.2 State, URL and history

- **`state/workspace.ts`**: `hazard: 'fire' | 'flood'` (default `'fire'`), `setHazard(h)`. URL `?hazard=flood`,
  omitted for fires (as other defaults are, `writeWorkspaceParams` `:255-274`). The hazard decides which list, markers,
  status, legend and search the overview shows, in both presets and in Forensic's "open an event first" page.
- **`state/flood.ts`** (new zustand store, race-guarded like `store.ts`):
  `lists` (live; year lists when backend Q6 is answered) with `loading / errors / sources / updatedMs` (pure
  transitions in `state/floodCatalog.ts`, a twin of `catalog.ts`); `floodId`, `summary: FloodSummary | null`,
  `manifest: FloodManifest | null` (Forensic only), `job`, `source`, `missingFloodId`; `gaugeLid` (the hydrograph's
  gauge; default the primary gauge); `cursorMs: number | null` (the hydrograph handle; null = now); `layers:
  Record<FloodLayerKey, boolean>`. Actions `loadFloods`, `openFlood(id, { source })`, `closeFlood`, `startFloodBuild`,
  `setGauge`, `setCursor`, `setFloodLayer`. Lists load lazily: on the first switch to Floods, at start-up with
  `?hazard=flood` or `?flood=`; the fire start-up is unchanged.
- **One event at a time**: `openFlood` calls `useStore.getState().closeIncident()` when a fire is open; a subscription in
  `flood.ts` closes the flood when `useStore.incidentId` becomes non-null (no edit in `store.ts`). Opening a flood
  sets `hazard = 'flood'`.
- **URL**: `?flood=<id>` for the open flood (pushState, as `?incident=` is). The two never appear together:
  `navigationUrl` (`history.ts:42-49`) drops the other one. A link with both opens the fire (today's behaviour) and
  drops `flood`. `?t=` stays fire-only in this brief.
- **History**: `HistoryEntryState` gains `flood: string | null` (optional, so old entries still parse);
  `historyWrite` and `applyLocation` handle both kinds; Back from a flood opened on the flood overview returns there.
  A 404 for a flood answers "This flood is no longer listed" on the flood overview (replace, as for fires); a 503 says
  "The flood lists could not be reached right now; try again later." and never "not found".
- **Selectors** (`state/selectors.ts`): `noEventOpen()`, `openEventKind(): 'fire' | 'flood' | null`. Used at the 13
  shell checks of section 1.2.
- **Chromes** (`ui/shell/views.ts`): `mapChromeOf(event: 'fire' | 'flood' | null, preset)` →
  `'overview' | 'public-fire' | 'command-fire' | 'public-flood' | 'command-flood'`; `atmosphereEdgesOf` maps
  public-flood → `'fire'`, command-flood → `'command'`. `App.tsx MapWorkspace` mounts `PublicFloodChrome` or
  `CommandFloodChrome` in the same slot; the map never remounts.
- **Time zone** (`state/timeZone.ts`): `floodZone` = the flood summary's `time_zone`; the zone source reads "flood".
- **Document title**: "Animas River flood · live · Fire-3d"; with no event "Fire-3d · Wildfires and floods".

### 2.3 Map engine: one mounted flood module

`mapController.ts` is 2,089 lines and owned by map-core. Flood drawing goes in a module mounted like
`mountOfficialLayers` (`official/mapLayer.ts:191-216`):

```ts
// map/floodController.ts
export interface FloodLayersHandle {
  update(): void                       // re-sync from useFlood / useWorkspace (sources updated in place)
  restyle(theme: MapTheme): void       // basemap switch: re-add from cached data
  hit(point: PointLike): { kind: 'flood' | 'gauge' | 'group'; id: string } | null
  remove(): void
  layerIds(): string[]
}
export function mountFloodLayers(map: MapLibreMap, opts: { beforeId: string[]; topBeforeId: string[] }): FloodLayersHandle
```

Pure specs and data in `map/floodLayers.ts` (tested), colours in `map/floodStyle.ts`, what each view draws in
`map/floodProfile.ts`. Changes inside `mapController.ts` (about 10 touch points): mount and restyle the module;
`hazard === 'flood'` hides the three fire overview sources and their chips, stops `scheduleFocus` (fire zoom focus),
routes clicks to the module's `hit()` first, keeps the "overview stays put" rule (`:1553`) while no event is open;
`MapControls` frames the flood (`actions.frameFlood()`: the flood's `bbox_lonlat`, else its point at z11).

Flood layers (sources `fx-flood-*`, never the fire ids):

| Key (`FloodLayerKey`) | Data | Drawn as | Public | Command |
|---|---|---|---|---|
| `events` (overview) | `/api/floods` list | blue circles, groups, labels (2.5) | yes | yes |
| `gauges` | `/api/official/river-gauges?flood=` (bbox on the overview) | diamonds by category (2.4) | yes | yes |
| `warnings` | `/api/official/flood-alerts?flood=` polygons | alert-pink outline: warning solid, advisory dashed, watch dotted | yes | yes |
| `forecastArea` | `/api/floods/{id}/maps?kind=rfc_fim` | water-blue hatch, dashed `#7fd4ff` edge | yes | yes |
| `satellite` | OPERA: GIBS picture tiles (no token) or the bundle's measured raster (token) | raster; measured: `#2a8ce6` fill, `#7fd4ff` edge, clouds grey cross-hatch | yes | yes |
| `channel` | the basemap's own OSM water (OpenFreeMap), restyled in flood views | `#103f8a` fill, dashed `#4fb4ff` edge ("Main channel") | yes | yes |
| `floodplain` | `/api/floods/{id}/maps?kind=nfhl` | faint grey-blue stipple | no | off by default |
| `model` | `/api/floods/{id}/model?kind=nwm_analysis` | amber `#f5c060` dotted edge, "EXPERIMENTAL" | never | off by default (Q-W6) |
| evacuation zones | existing extras by the flood's bbox | as today | yes | yes |

`extras/ExtrasSync.tsx` and `extras/client.ts:101-106` take the area from a small `currentArea()` helper (the fire's
area or the flood's `bbox_lonlat` + margin) instead of reading the fire store; that is the only change to extras.

### 2.4 Tokens and colours

Additive tokens in `styles/map-tokens.css` (frozen H2 file: additions only, through the orchestrator) with TS mirrors
in `map/floodStyle.ts`:

| Token | Value | Use (from the design) |
|---|---|---|
| `--m-flood` | `#2a8ce6` | flood fill (HANDOFF table) |
| `--m-flood-edge` | `#7fd4ff` | flood edge, observed hydrograph line |
| `--m-flood-channel` / `-edge` | `#103f8a` / `#4fb4ff` | main channel |
| `--m-flood-lead` | `#4fc3ff` | the circle's leader line |
| `--m-flood-ink` | `#dff4ff` / `#f2fbff` | text on the water circle |
| `--m-flood-forecast` | `#cfeaff` | RFC forecast line (dashed) |
| `--m-cat-action` … `--m-cat-major` | see below | gauge categories |
| `--m-cat-below` | `#8a8a8a` | below flood stage (hollow) |

**Gauge categories.** NOAA's own legend (`riv_gauges` layer, measured, section 8): Major Flood `#CC33FF`, Moderate Flood
`#FF0000`, Minor Flood `#FF9900`, Action `#FFFF00`, **No Flood `#00FF00`**, Flood Category Not Defined `#72AFE9`, Data
Not Current `#BDC2BB`, Out of Service `#666666`. Recommendation (Q-W3): keep NOAA's hues for action to major (people
who know water.noaa.gov read them at once), slightly tuned for the dark map (`#f2e04a`, `#ff9a3c`, `#ff4d4d`,
`#c766ff`); **replace NOAA's green** by a grey hollow diamond labelled "Below flood stage" (green reads as "safe");
replace NOAA's light blue for "not defined" (it is the flood colour here) by a grey diamond with "?". Never colour alone:
the diamond grows with the category (6 / 7 / 8 / 9 px), and the category is written wherever a gauge is named.

Known clashes, accepted with shape and text: minor `#ff9a3c` ≈ the fire marker orange (fire markers are hidden while
Floods is picked) and near the accent `#ff7a3d` (accent only fills controls); action yellow is close to "gold", which
the design bans in the interface (it is a data colour here, like the Forensic layer swatches); the flood edge
`#7fd4ff` is near the selected-point blue `#9fd6ff` (the selected point keeps its dot, halo and mono label, section
2.6.5). NWS warning polygons use the existing alert pink `#ee7aa0` (HANDOFF: NWS alerts), not NWS's own polygon
colours (NWS draws Flood Warnings in green).

### 2.5 National map: the Fires | Floods switch, markers, list

**Where the switch sits** (Q-W1). In the top bar's title slot, replacing the grey "· all fires":

```
[logo] Fire-3d │ United States  ( Fires | Floods )        ( Public | Command | Forensic )        NOV 4 2026 · 31 FLOODS  [≡]
```

- `ui/public/HazardSwitch.tsx`: a 28 px segmented pill (`ViewPill size="sm"` look: glass `rgba(14,14,14,.6)`, hairline,
  the active option accent `#ff7a3d` with ink `#1a0a03`, as every selected state), `role="radiogroup"`, name "Show:
  fires or floods", each option with a 10 px glyph (fire dot `#ff8a3c`, water drop `#7fd4ff`). It stays smaller than
  and left of the view pill, so the two switches do not compete. Phones: it replaces the title ("Fires | Floods" fits
  in 140 px), with logo and menu as today.
- Why not the search row: the row is centred and 52 px tall; adding ~170 px crowds 1024-1280 px windows, and the switch
  belongs to "what the map lists", which is the title's job. Fallback if the user prefers it: a pill left of the search.
- Switching keeps the camera, the selected point, the preset and Show details; it closes a fire card; the list, markers,
  status, legend, "Show details" count and search source follow the hazard.

**Markers** (`map/floodLayers.ts`, the fire marker rules of `overviewLayers.ts` with a water palette). The fire layer
specs read feature properties (`r`, `lr`, `kind`, `label`, `chip`), so the flood features carry the same properties and
the same spec builder is reused with a palette and a unit: `overviewLayers(theme, { palette: FLOOD_PALETTE, unit:
' FLOODS', sources: FLOOD_SOURCES })`. The cluster property `max_acres` becomes a parameter (`max_rank` for floods).

| Kind | Rule (from the official level and category only) | Radius |
|---|---|---|
| large (pinned, never grouped, label at every zoom, leader-label candidate) | max category moderate or major (observed or NWS forecast), or a Flash Flood Warning / Emergency in effect | 15 |
| active | a Flood Warning in effect, or a gauge at minor | 11 |
| small | advisory only, or a gauge-only event at minor with no product | 7 |
| other (hollow ring) | watch only (if listed, backend Q2), or not active (year lists) | 4.5 |
| group | 3 or more close, `10 + 4.2·√n`, at most 36; "28 FLOODS" after a short tick | |

Palette (dark and aerial): fill `rgba(42,140,230,.10)`, ring `rgba(127,212,255,.8)` 1-1.2 px, a faint dark casing;
the centre dot is `#f2fbff` with no gauge category, else the event's highest category colour (so the national view
shows severity without extra marks); other ring `rgba(127,212,255,.45)`; counts `#cfeaff` with the unit in `#7fd4ff`.
Light road map: darker blues. Sizes grow 1.2x by z10 and shrink to 0.65x at a phone's national view, as for fires.

**Gauges on the overview**: gauges at action or above (about 30-100 nationally), as category diamonds, from z5 (below
z5 the event's centre dot carries the category). Below-flood-stage gauges are drawn only inside a flood view.

**Labels and leaders**: names "Animas River flood"; second line in mono, in the category colour: "MAJOR · 24.1 FT"
(primary gauge observed), else "FLASH FLOOD WARNING" / "FLOOD WARNING" / "FLOOD ADVISORY". `LeaderLabels.tsx:93-109`
reads `meta` and `rank` from the feature when present (else acres, as now), so the same overlay serves both hazards;
"N FLOODS" counts avoid the names as "N FIRES" do. Ranking: major > moderate > flash warning > minor > warning >
advisory > watch, then number of gauges in flood.

**Click**: Public opens the Public flood view (`pickFlood(id)`, one history push); Command opens the Command flood
view directly (Q-W8: floods need no preparation for 2D, so the fire card's purpose, "Prepare analysis", does not apply).

**Bar status** (`ui/public/FloodStatus.tsx`): "NOV 4 2026 · 31 FLOODS" (count in `#7fd4ff`), "LOADING FLOODS",
"FLOOD LIST UNAVAILABLE", "FLOOD LISTS UNAVAILABLE" (never "0" when a list could not be read). Tooltip ends with the
list-absence line.

**List panel** (`ui/shell/FloodListPanel.tsx`, the `OverviewPanel` look): title "Floods in the lower 48"; OFFICIAL NOW
block "Flood products (NWS) · 42 in effect in the lower 48 · checked 2 min ago" (pink frame as the fire weather block);
tabs Active / 2026 / 2025 (per backend Q6) and a "Show watches" switch (backend Q2); rows: name, "San Juan Co., NM ·
Flood Warning · Minor at Shiprock", right "15.2 ft" in mono; sorted by rank; "12 floods in this view · Show all 31";
source notices (NWS down, gauges down, both down) and the absence line at the foot.

**Other overview pieces**: the "Show details" count = listed floods for the filter; the legend
(`map/FloodLegend.tsx`, the `MapLegend` variants `chips` / `key` / panel); the selected point's card in flood mode
(`location/FloodPointCard.tsx`: NWS flood products at the point verbatim, nearest listed floods with distance, the
nearest gauge at action or above within 25 km, absence line); search matches flood names and rivers from the flood
list (`search.ts` takes a second hit provider); Forensic's "open an event first" page shows the switch and the flood
list too.

### 2.6 Public flood view (from `FloodView.dc.html`)

#### 2.6.1 Layout (the screen's exact values; differences from the fire view in bold)

| Part | Spec |
|---|---|
| Map tint and gradient | `#333333`, `mix-blend-mode: color`, **0.25** (fire 0.35); left gradient **600 px**, `rgba(12,12,12,.92)` 0 % → **.74** 55 % → 0 (fire 560 px, .90 / .72) |
| Close | 44 px round, top / left 24, glass `rgba(14,14,14,.6)` blur 18, border `rgba(200,200,200,.24)`, X 18 px `#e6e6e6`; "Back to all floods" |
| Title | top 22, centred: h1 24/600, −0.01em, `#f0f0f0`, shadow `0 1px 12px rgba(0,0,0,.6)` ("San Juan County, New Mexico"); mono 12, .16em, `#d0d0d0` date line; the distance chip 6 px under it |
| Circle | left 48, top 88, 312 px; bg **`#1a221f`**; shadow **`0 0 0 1px rgba(200,214,206,.45), 0 0 48px rgba(120,140,130,.35), inset 0 0 40px rgba(0,0,0,.65)`**; shade **`radial-gradient(ellipse 58% 30% at 50% 50%, rgba(2,8,16,.62) 0%, rgba(2,8,16,.3) 60%, rgba(2,8,16,0) 100%)`**; status mono 12/600 .18em **`#dff4ff`**, shadow `0 1px 8px rgba(0,10,25,.8)`; name 72/80 800 −0.03em, text **`#f2fbff`**, shadow `0 2px 14px rgba(0,10,25,.75)`; "MORE IN COMMAND ›" mono 11/600 .14em `#dff4ff` |
| Leader | 1.5 px **`#4fc3ff`** from the circle's edge to the primary gauge (2.6.5) |
| Facts | left 48, top 452, 420 px wide; hairlines `rgba(200,200,200,.35)`; rows 11 px vertical padding: value mono 26/500 `#f0f0f0`, unit 13 `#bdbdbd`, label 11/600 .12em `#9a9a9a` "— LABEL"; foot: OFFICIAL badge (`#8fd3a8` outline, mono 10/600 .1em) + 12 px `#bdbdbd` source line, "Not an all-clear. Follow local officials." + link "NWS water" (`https://water.noaa.gov`) |
| Key | right 24, bottom 52, glass `.62` blur 18, border **`rgba(200,200,200,.22)`**, radius 12, padding 10 14, gap 18, 13 px `#e6e6e6`; swatches 20 × 12: water `1.5px solid #7fd4ff` on `rgba(42,140,230,.5)`; channel `1px dashed #4fb4ff` on `rgba(16,63,138,.7)`; separator 1 × 18; scale mono 11 + 81 × 5 bar |
| Foot bar | 30 px, `rgba(12,12,12,.8)`, top hairline `.1`, mono 11 `#8a8a8a`: "Research prototype — not for operational use" left, the real credits right (2.6.5) |
| Map extent (in the design) | fill `#2a8ce6` at .42, edge `#7fd4ff` 1.6 px round joins; channel `#103f8a` at .55, edge `#4fb4ff` at .5, 1 px, dash 3 3 |

#### 2.6.2 The water texture (`ui/public/WaterTexture.tsx`, verbatim from the screen)

Base `linearGradient` (`#121a16` 0, `#2a3530` .3, `#7f8a84` .44, `#5d6863` .56, `#252d2a` 1); a water mask (white 0 →
.15 at .38 → .9 at .5 → 1), so the water fills the lower half; a dark mist path top left (`#0b120e`, .7, blur 14);
inside the mask two current layers rotated −9°: `fractalNoise 0.0096 0.08`, 4 octaves, seed 11, stitched, coloured
(.78, .83, .79) with alpha `3·R − 1.2`, opacity .85, scrolling −312 px in **2.6 s**; and `turbulence 0.0256 0.16`, 3
octaves, seed 6, alpha `−5·R + 1.5`, opacity .5, in **1.5 s**; a mist band (ellipse 160, 138, 190 × 34, `#c3ccc6` .32,
blur 14); rain rotated 12°: `fractalNoise 0.48 0.0096`, seed 3, alpha `9·R − 5.6`, opacity .38, falling 312 px in
**0.55 s**; grain `fractalNoise 0.95`, 2 octaves, seeds 5→9 every 0.1 s, overlay at .32.

- **Reuse**: split `HazardCircle.tsx` into a presentational `ui/public/HazardDisc.tsx` (`texture: 'thermal' |
  'water'`, `tone`, `statusLine`, `name`, `meaning`, `tip`, `onClick`, `compact`) and keep `HazardCircle` as the fire
  container (unchanged behaviour); `FloodHazardCircle` feeds it from the flood store. `fitName`, ids per instance
  (`useId`), `usePausedWhenHidden` and the reduced-motion hook are shared.
- **Motion**: under `prefers-reduced-motion` no `<animate>` / `<animateTransform>` is rendered (the texture stands
  still, as the design's `still` state); paused while the tab is hidden. Tone `quiet` (no product in effect, past
  floods): no rain layer, current at a quarter speed; tone `demo`: as active, words say simulated.
- **Name**: `floodShortName("San Juan River flood")` → "San Juan" ("Animas River flood" → "Animas", "Clarks flash
  flood" → "Clarks"); the full name is the accessible name and the tooltip when shortened.

#### 2.6.3 The circle's status words (official level only, never Fire-3d's inference)

| Case | Line | Tone |
|---|---|---|
| Flash Flood Emergency (NWS tag) | `FLASH FLOOD · EMERGENCY` | active |
| Flash Flood Warning in effect | `FLASH FLOOD · WARNING` | active |
| Flood Warning in effect | `FLOOD · WARNING` | active |
| Advisory only | `FLOOD · ADVISORY` | active |
| Watch only (flooding possible, not reported) | `FLOOD · WATCH` | quiet, rain kept |
| Gauge in flood, no product | `FLOOD · GAUGE IN FLOOD` | active |
| Live, no product in effect now (backend status "ended", 48 h window) | `FLOOD · NO NWS WARNING NOW` | quiet |
| Past flood (year list) | `PAST FLOOD · NOV 2 2026` | quiet |
| Fixture | `SIMULATED FLOOD · DEMO` | demo |

The design's "FLOOD · ACTIVE" is a placeholder (BRIEF-5: every value on the screen is); "ACTIVE" would be Fire-3d's
own rule (backend 3.2 item 9), so the circle names the NWS product instead. The hidden meaning line says who decides:
"NWS Albuquerque has a Flood Warning in effect for this area until 9:00 PM MST."

#### 2.6.4 Facts (seven `ReadoutRow`s, from official answers only)

| Row | Value | Sub-line (issuer, own time, link) |
|---|---|---|
| FORECAST FLOODED AREA (NWS, 5 DAYS) | `3.2 mi²` | "Forecast, not water now · issued Nov 4, 10:20 AM MST · NWS calls this map experimental"; where NWS maps nothing: value "Not mapped here", sub "Outside NWS's mapped area, flooding is unknown, not absent." (backend Q5 option a: satellite area when NWS does not map, labelled "WATER SEEN BY SATELLITE (NASA, OCT 31)", sub "includes the river's normal water"; never summed) |
| RIVER STAGE (USGS) | `15.2 ft` | the label names the gauge's own data source (USGS for most); "San Juan River at Shiprock · Minor Flood (NWS) · flood stage 15.5 ft · 10:00 AM MST (12 min ago)"; amber Stale tag after 3 h |
| FORECAST CREST (NWS) | `17.1 ft` + `THU 6 AM` | "NWS Colorado Basin River Forecast Center · issued 10:20 AM MST · Moderate Flood"; no forecast point: "No NWS river forecast for this gauge" |
| STARTED | `Nov 2` | basis: "first NWS flood product" / "gauge above flood stage" / label becomes "SEEN BY FIRE-3D SINCE" for `first_seen` |
| FLOOD WARNING (NWS) | `In effect` + `until 9 PM` | the label names the highest product in effect (FLASH FLOOD WARNING, FLOOD ADVISORY, FLOOD WATCH); the NWS headline verbatim, sender, link; past: "Was in effect" with "as of <date>" first (brief-4 rule) |
| EVACUATIONS | as the fire view | "Not available in this state" / "None listed" (never "N/A"), with its source |
| LAST OFFICIAL UPDATE | `Nov 4` + `10:20 AM` | the newest NWS product or RFC forecast time, issuer named |

The design's REPORTED coordinates row moves to Command (Q-W5): for a flood there is no single "reported location", and
the crest is what a person checks first. Foot: "OFFICIAL · NWS · USGS · checked 2 min ago"; "Not an all-clear. Follow
local officials. NWS water". Phones: the fire view's bottom sheet; the peek shows stage and the warning row.

#### 2.6.5 Map, key, chip and the departures from the design

- **Map profile** (`map/floodProfile.ts`, Public): satellite water, NWS forecast flooded area, warning outlines,
  gauges (member gauges, below-stage ones grey), main channel, evacuation zones; no model, no floodplain.
- **Key** (`ui/public/FloodKey.tsx`, the `FireKey` shape): one item per layer drawn, each with its own time:
  "Water seen by satellite · Oct 31, 10:30 AM (4 d ago)" (solid swatch), "NWS forecast flooded area · issued 10:20 AM"
  (hatched swatch), "Main channel" (dashed swatch), "NWS warning area" (pink outline) when drawn; then the scale and
  "Legend details" (`FloodLegend variant="key"`). Without the NASA login: "Satellite water: NASA picture, Oct 31 (not
  measured here)".
- **Distance chip**: `DistanceChip`'s look unchanged; its maths moves to a pure `distanceToArea({ rings, point,
  grid })` shared with fires. Target, in order: the NWS warning area's edge, else the NWS forecast flooded area, else
  the primary gauge; the line under the chip says which: "to the edge of the NWS warning area" / "to the NWS forecast
  flooded area (5 days)" / "to the river gauge, not the water's edge". Inside: "Inside the NWS warning area".
- **Departures from the design** (each needs no new design work):
  1. "Flooded area now" becomes what each layer is, with its own time (Q-W2): satellite water can be days old and NWS's
     area is a 5-day forecast; neither is "now".
  2. The leader ends at the **primary gauge**, drawn as its category diamond with a 22 px `#4fc3ff` halo at .22
     (Q-W4), not the design's light-blue dot: brief 4 reserves the light-blue dot for the user's selected point.
  3. Status words name the NWS product (2.6.3).
  4. REPORTED → FORECAST CREST (2.6.4); the foot bar's right side carries the real credits (NOAA NWS, NWPS, USGS,
     FEMA, NASA OPERA via GIBS, OpenFreeMap / OpenStreetMap) instead of "Flood extent: illustrative placeholder".
- **Top right cluster** as the fire view: Show panels, view pill (sm), Check an address, Layers, menu. Status line
  from 1280 px: "NASA OPERA · OCT 31 · 4 D AGO" (amber after 3 days) instead of the fire detections line.

### 2.7 Command flood view (derived from Command fire)

`ui/shell/CommandFloodChrome.tsx`, the `CommandFireChrome` layout and CSS classes (`styles/view-command.css` rules
broadened to `[data-view='command-flood']` where the layout is the same; flood-only rules in `styles/view-flood.css`).

- **Top bar**: back "Back to all floods", the flood's name (plain title, 18 px; a flood picker is optional, +3 h), LIVE
  or the year, the place, demo badge · view pill · right: the gauge line in mono "SHRN5 · 15.2 FT · MINOR · 12 MIN AGO"
  (age amber after 3 h, a button that opens the gauge list), Show panels, Updates (phones), Check an address, Layers,
  menu. No Analysis pill in this brief (the hydrograph is always shown).
- **Left readout** (`location/FloodReadout.tsx`, the `CommandReadout` structure; `CommandReadout` itself is frozen and
  stays fire-only):
  - "SELECTED POINT" + copy / centre / clear; the point in mono 30 px; DMS · UTM · WGS84 (UTM zone from the point when
    there is no bundle grid).
  - **One line per flood layer at the point** (pure `location/floodCheck.ts`), each with outlined tags as the fire
    readout's:
    - "Inside the NWS Flood Warning area (until 9:00 PM MST)." `OFFICIAL`
    - "Inside the NWS forecast flooded area (5-day maximum)." `FORECAST · ISSUED 10:20` (or "0.4 mi from its edge.")
    - "0.3 mi from water seen by satellite (Oct 31, 10:30 AM; clouds over 67 % of the area)." `SATELLITE · 4 D AGO`;
      on a cloud pixel: "Clouds hid this spot on the Oct 31 pass."
    - "In FEMA's 1 % annual-chance floodplain, Zone AE (background)." when the layer is on.
    - `MODEL` "National Water Model (NOAA, experimental): flooded at 10:00 AM analysis." only when the model layer is on.
    - Nothing covers the point: "No mapped flood layer covers this spot. Unknown, not dry. Follow local officials."
  - **Nearest gauge** rows: `15.2 ft — RIVER STAGE · SHRN5 (USGS)`, `Minor Flood — CATEGORY (NWS)`, `15.5 ft — FLOOD
    STAGE (NWS)`, `17.1 ft Thu 6 AM — FORECAST CREST (NWS RFC)`, `2.3 mi NW — DISTANCE TO GAUGE` with the sub "Nearest
    gauge on the San Juan River; another stream may be closer." The gauge is picked among the event's rivers first.
  - Event rows: `flood-20261104-san-juan-river-flood-3fa2c1 — FLOOD ID` (copy), `36.789° N · 108.688° W — PRIMARY
    GAUGE` (copy, centre), `Nov 4, 10:20 MST — LAST OFFICIAL UPDATE`.
  - No point: "Click the map or search to select a point", then the gauge and event rows.
- **Right: Official now** (`ui/feed/FloodOfficialNow.tsx`, the `variant="command"` rows; `OfficialNow.tsx` exports its
  `Row` and `SourceLink`, the only change there). One collapsible row per NWS product ("Flood Warning — in effect until
  9:00 PM MST", meta "NWS ALBUQUERQUE NM · SENT 10:20 MST · CHECKED 2 MIN AGO"; open: headline, description and
  instructions verbatim, link, "Show" to fit the polygon); a Flash Flood Emergency first and open; "River forecast — crest
  17.1 ft Thu 6:00 AM (NWS CBRFC, issued 10:20 AM)"; "Evacuations — …" and "Local officials' alerts — …" reusing the
  fire rows with the flood's bbox; when no product is in effect: "No NWS flood product here right now. That is not an
  all-clear: follow local officials." Foot: "Fire-3d shows NOAA's National Water Model separately, as experimental
  model output. Not an all-clear. Follow local officials." Model output never appears in this block.
- **Bottom**: map controls bar (left) and legend chips with the scale (right): "Water seen by satellite (Oct 31)",
  "NWS forecast flooded area", "NWS warning area", the four category diamonds, "FEMA 1 % floodplain" and "Model (NWM,
  experimental)" when on, "Selected location", "Legend details"; then the **slim hydrograph** (2.8), the fixed copy and
  the credits.
- **Phones**: as Command fire: readout sheet with a one-line peek (selected point, else the primary gauge), Official now
  as the Updates sheet, the hydrograph full width.

### 2.8 The hydrograph (one model, two variants)

`ui/timeline/hydrographModel.ts` (pure, tested) and `ui/timeline/Hydrograph.tsx` (`variant: 'slim' | 'dock'`); it
replaces `CompactTimeline` in flood chromes and the Forensic dock; the fire timelines are not touched.

- **Data**: `/api/official/river-gauges?lid=&series=1` (observed stage and flow, the RFC forecast with its issue time
  and issuer, the thresholds); the NWM series from a backend addition (W-R7). Observed points are thinned to the plot
  width (NWPS gives 2,304 points for 30 days).
- **Axes**: time from 72 h before now to the end of the RFC forecast (or +72 h), day ticks in the gauge's zone; y =
  **stage (ft)** by default, with a mono toggle `STAGE FT | FLOW CFS`. NWM gives flow only, so the **model line is drawn
  on the flow axis only**; it is never converted to a stage (that would mix the model with NWS's rating).
- **Lines**: observed solid 1.6 px `#7fd4ff` ("OBSERVED · USGS"); RFC forecast dashed 4 3, 1.4 px `#cfeaff`, from its
  issue time ("FORECAST · NWS CBRFC · ISSUED NOV 4 10:20 MST"); NWM dotted 1 3 `#f5c060` (the design's modeled colour,
  as Fire-3d's own model is for fires) with an end tag "MODEL · NWM · EXPERIMENTAL". Line style and words carry the
  meaning; colour is never alone.
- **Flood-stage lines**: action, minor, moderate and major as thin horizontal lines in the category colours, labelled at
  the right ("MINOR 15.5"); faint bands above minor; no band and no colour below action. Lines outside the visible range
  are pinned to the edge with an arrow ("MAJOR 20.5 ↑").
- **Marks**: NOW (thin line + "NOW 12:40"); "LATEST 12:15 · 25 MIN AGO" at the newest reading, amber + STALE after 3 h;
  the forecast crest caret "CREST 17.1 FT THU 06:00"; NWS product times (issued, extended, expired) as small pink ticks
  on the time axis (the fire timeline's key-event markers).
- **Handle**: drag or keys (slider: ←/→ 1 h, Shift 6 h, Home / End, as the fire timeline); the mono label above reads
  "NOV 4 10:00 MST · 15.2 FT OBSERVED · MINOR" or "NOV 6 06:00 · 17.1 FT FORECAST (NWS) · MODERATE". It moves
  `useFlood.cursorMs`; the map then draws the NWS products in effect at that time. No play button (Q-W7): nothing on the
  map moves continuously.
- **Gauge picker**: the slim variant's 40 px left button (where Play sits for fires) opens the member and nearby gauges
  (lid, name, stage, category); the map highlights the picked one.
- **Empty states**: "No NWS river forecast for this gauge" (not every gauge is a forecast point); "No readings from this
  gauge in the last 72 h (NWS: Data Not Current)"; "NWS has not set flood stages for this gauge"; NWM missing: "Model
  series unavailable right now".
- **Units**: metric → m and m³/s, the original in the tooltip.
- **Sizes**: slim = the fire slim timeline's row with a 72 px plot; dock = Forensic's 112 px dock with a 90 px plot and,
  in "Charts & NWS products", small multiples of every member gauge.

### 2.9 Forensic 3D flood view

- **Branch**: `ForensicWorkspace` shows `FloodForensic` when a flood is open (a separate small tree: `FloodHeader`,
  `FloodRightPanel`, `FloodDock`), so the fire Header, Timeline, Charts and panels stay untouched. Unprepared flood:
  the terrain needs a bundle: "Fire-3d has not prepared this flood's 3D terrain yet. Prepare 3D data (about 1 min)".
- **Scene**: `Scene.tsx SceneContent` takes its assets from `useSceneAssets()` = the flood's (`scene/flood/
  floodAssets.ts`) when a flood is open, else `useIncidentAssets()`. The flood loader returns the same `IncidentAssets`
  shape (elevation, sky view, NAIP; fire fields null; backend sets `grid.fire = grid.render`) plus a `flood` part. So
  `Terrain`, `SunLights`, `CameraRig`, `ProbeDriver`, `SelectionPin`, `PostFX` and `LookDriver` work unchanged;
  `SceneFx` (fire effects) renders nothing because it reads the fire store, which holds no manifest; `FloodFx` adds the
  flood effects. The look keeps the green terrain and gold graphics (HANDOFF); flood layers keep their data colours.
- **Drapes** (terrain shader, additive uniforms; no new lint warnings in `src/scene`): one RGBA texture
  `uFloodPack` (r NWS forecast area, g FEMA floodplain, b NWM model) with linear filtering and one `uSatWater`
  (OPERA classes, nearest) with opacity uniforms. Satellite water: `#2a8ce6` fill with a `#7fd4ff` edge (screen-space
  derivative), no glints (the existing water glints are for lakes in fire scenes); cloud pixels a grey cross-hatch ("no
  view"), never shown as dry; forecast area: water-blue world-space hatch with a dashed-looking edge; floodplain: faint
  stipple; model: amber dotted edge with a mono "MODEL · EXPERIMENTAL" label. NWS warning polygons: pink lines draped
  with the helper `Perimeters.tsx` uses (`scene/fx/lines.ts`).
- **Gauges** (`scene/flood/GaugeBars.tsx`, maths in `gaugeBars.ts`, tested): at each gauge a thin vertical bar from the
  ground; tick marks at action / minor / moderate / major in the category colours; a bright cap at the current stage;
  the forecast crest as a hollow cap; a mono label (the `scene/fx/text.tsx` overlay) "SHRN5 · 15.2 FT · MINOR · 10:00
  MST". Bars use a fixed scale (e.g. 1 ft = 12 m) and the legend says "Bar height: river stage at the gauge (scaled),
  not water depth". No pulsing; static under reduced motion.
- **Panels**: tabs Layers (`FloodLayersTab`: Base: Terrain, Aerial photo (NAIP, "taken <year>, before this flood"),
  FEMA floodplain; Water: Water seen by satellite, NWS forecast flooded area, NWS warning areas, River gauges; Model:
  NWM flooded area (experimental); Parametric: Contours, Telemetry labels), Analysis (hydrographs of each gauge), Evidence
  (every NWS product version verbatim, from the bundle's `warnings.json`, with times and links), Notes; cards "Flood
  overview" (kind, level, rivers, states, started with its basis, NWS until, highest category) and "River gauges"
  (replaces "Weather & Fire Behavior").
- **Entry controls**: "Frame flood" (the event's area) and "Charts & NWS products" under the compass, as for fires;
  the demo badge "Demo · simulated data" with "terrain, water layers and gauges are synthetic".
- **Hand-off**: `handoff.ts` reads the open event's grid (fire or flood); the heading rule is unchanged.

### 2.10 What stays fire-only

Fire lists, fire card, incident picker, CAL FIRE / WFIGS records, fire weather, detections, perimeters, spread model,
accuracy regions, aircraft, the fire timelines and charts, `CommandReadout`, `OfficialNow`'s fire rows, `MapLegend`,
`fireView.ts`, `overviewLayers.ts`' fire palette. A flood in a recent burn scar (common: debris flows) shows only the
flood; a "this flood is in the area of the 2025 X Fire" link is a later idea.

### 2.11 Changes to existing shared files (all additive)

| File | Change |
|---|---|
| `state/workspace.ts` | `hazard`, `setHazard`, URL `?hazard=` |
| `state/history.ts`, `state/runtime.ts` | `?flood=`, entry `flood`, share link |
| `state/timeZone.ts`, `state/selectors.ts` | flood zone; `noEventOpen`, `openEventKind` |
| `App.tsx` | bootstrap `?flood=`; chrome choice; title; skip link "Skip to the flood list" |
| `ui/shell/views.ts`, `OverviewChrome.tsx` | five chromes; the switch and flood parts by hazard |
| `ui/public/HazardCircle.tsx` | rendering moved to `HazardDisc.tsx`; behaviour unchanged |
| `ui/public/FireTitle.tsx`, `DistanceChip.tsx` | presentational parts take props; fire containers unchanged |
| `ui/feed/OfficialNow.tsx` | export `Row`, `SourceLink` |
| `map/mapController.ts` | mount the flood module; hazard checks (section 2.3) |
| `map/overviewLayers.ts`, `map/LeaderLabels.tsx` | palette, unit, cluster property and `meta` / `rank` as parameters (fire defaults) |
| `map/MapControls.tsx`, `map/mapStore.ts` | `frameFlood` |
| `extras/ExtrasSync.tsx`, `extras/client.ts` | area from `currentArea()` |
| `official/runtime.ts`, `official/mapLayer.ts` | no fire weather fetch or outlines in flood mode |
| `scene/Scene.tsx`, `scene/terrain/*` | asset source; drape uniforms |
| `ui/shell/ForensicWorkspace.tsx`, `ui/shell/handoff.ts` | flood branch; grid of the open event |
| `styles/map-tokens.css`, `view-public.css`, `view-command.css` | flood tokens; selectors broadened to the flood views |
| `lib/dataCredits.ts`, `map/MapAttribution.tsx` | flood credits |

New files keep the case rule (`lib/fileNames.test.ts`): `ui/public/floodView.ts` must never sit next to a
`FloodView.tsx`; components are `FloodFacts.tsx`, `FloodKey.tsx`, `FloodTitle.tsx`, `FloodHazardCircle.tsx`.

### 2.12 Brief-4 rules kept

- **Tokens**: the greys, glass, hairlines and accent of `map-tokens.css` / `theme.css`; flood colours only as additive
  tokens (2.4); the accent fills selected controls only; no gold or olive in the interface (data swatches excepted, as
  in Forensic today).
- **Fixed copy**: "Research prototype — not for operational use" and "Not an all-clear. Follow local officials." on
  every flood view, phones included (`FixedCopy` variants `line`, `bar`, `corner`, `pill` as the fire views use them).
- **Reduced motion**: the water circle, the hydrograph handle and the 3D gauge labels stop animating; no flowing-water
  animation on the 2D map or in the 3D drapes; animations pause while the tab is hidden.
- **Selected-point marker**: the brief-4 light-blue dot, halo, hairline leader and mono label, unchanged in every flood
  view; nothing else on a flood map uses that dot.
- **Layout rules**: the floating top bar (back or X, name, LIVE, place · view pill · status and round buttons), "number
  — LABEL" readouts, two-line leader labels, edge dimming and the map tint, `[data-chrome]` regions and `--chrome-side`,
  map rotation in all three views.

## 3. Wording rules for floods

The standing rules (BRIEF-5) applied to each flood layer, as exact strings in one file `ui/shell/floodCopy.ts`
(CONTRACT §16 lists them; a guard test checks them, section 4).

### 3.1 Never an all-clear

- Never "safe", "low risk", "all clear" (only "not an all-clear"), "no flooding" in Fire-3d's own voice, "dry" (except
  in the fixed caveats of 3.2), "receded", "the flood is over", "ended" as a status, "normal level", "no danger", "you
  are outside the flood". The guard test bans these patterns in every exported flood string and in rendered facts,
  readouts and keys for every fixture case; NWS's own wording, quoted verbatim with its issuer, is exempt.
- **Below flood stage**: value "Below flood stage"; sub "NWS category at this gauge: “No Flood”. Not an all-clear:
  water can rise fast, and streams without a gauge are not measured." NOAA's name is shown in quotes with its issuer,
  never as Fire-3d's verdict, and never in green.
- **Not current / out of service / not defined**: "This gauge's reading is not current (NWS: “Data Not Current”); last
  reading <time>." · "Gauge out of service (NWS); no reading." · "NWS has not set flood stages for this gauge, so its
  reading cannot be compared with flood levels." None of these is "below flood stage".
- **Nearest gauge**: always "may be on another stream" when the gauge's river is not the event's.
- **No product**: "No NWS flood product here right now. That is not an all-clear: follow local officials."
- **Lists**: `FLOOD_LIST_ABSENCE` "Only floods with an NWS flood product or a river gauge in flood are listed; a place
  with no marker is not an all-clear. Follow local officials." Short: "Only listed floods · not an all-clear". Empty
  view: "No listed floods in this view." Empty list: "The NWS lists no flood warnings or advisories, and no river gauge
  reads at flood stage, in the lower 48 right now. Not an all-clear: flash floods can start within minutes. Follow local
  officials." Sources down: the backend's texts (NWS down: "…floods are listed from river gauges only. That is not an
  all-clear."; both down: "The flood lists (NWS warnings and river gauges) could not be reached right now. Not an
  all-clear: follow local officials."); counts read "unknown", never 0.
- **Status words**: section 2.6.3; never "ENDED", "OVER" or "CLEAR".

### 3.2 Satellite water is not "no flooding"

- Measured (token): "Water seen by satellite (NASA OPERA), <pass date, time> (<age>). It includes the river's normal
  water. Clouds (<n> % of this area), trees, buildings and the days between passes hide water: dry pixels do not mean no
  flooding."
- No token (the default today): the backend's line "Measured satellite water (NASA OPERA) needs a free NASA Earthdata
  login on this server; it is not set up. The NASA picture is shown instead." Public short: "Satellite water: NASA
  picture, <date> (not measured here)". No area in mi² is ever computed from the picture.
- Cloud pixels: "No view (clouds)", drawn grey, never as land. A pass older than 3 days is tagged amber with its age.

### 3.3 Forecasts are forecasts

- NWS forecast flooded area: "NWS forecast flooded area: where NWS river forecasts say water could reach in the next 5
  days (the most at any time). A forecast, not today's water. NWS calls this map experimental." + "Outside NWS's mapped
  area, flooding is unknown, not absent." + "issued <time>".
- RFC crest: "Forecast crest 17.1 ft, Thu Nov 6, 6:00 AM MST (NWS Colorado Basin River Forecast Center, issued Nov 4,
  10:20 AM MST). Forecasts change; check NWS for the newest." Never "the river will peak at".
- Hydrograph: the forecast part is dashed and labelled FORECAST with issuer and issue time; past floods: "River
  forecasts are not kept for past dates."

### 3.4 Model output is labelled experimental

- Label: "Model output (NOAA National Water Model) · experimental". Caveat (backend's): "Experimental model output
  (NOAA National Water Model). It is not an NWS forecast and not advice on when to evacuate. Follow local officials."
- Never in Public; never inside "Official now", the facts or any official row; dotted amber with a MODEL tag; never
  summed with or drawn as the same layer as NWS or satellite water.

### 3.5 Official text keeps issuer, own time, wording and link

- NWS products: event name, headline, description and instructions verbatim (line breaks kept); the sender as NWS gives
  it ("NWS Albuquerque NM"); sent / onset / ends in the issuer's own zone with its abbreviation ("10:20 AM MST"); a link
  to the product; NWS calls to action ("Turn around, don't drown") appear only inside NWS's quoted text, never in
  Fire-3d's voice. Past: "Was in effect" with "as of <date>"; IEM copies "Archived copy (Iowa Environmental Mesonet)".
- Gauges: category names as NOAA writes them (“Minor Flood”); the reading's time from NWPS in the gauge's zone; link
  `https://water.noaa.gov/gauges/<lid>`; "Measured by USGS" from the gauge's attribution.
- FEMA: "FEMA 1 % annual-chance floodplain (the “100-year floodplain”), background. It is not today's flood, and floods
  can reach beyond it." Outside it: "Not in FEMA's mapped 1 % floodplain. Floods can reach beyond it; not an all-clear."
  Where FEMA has no map: "FEMA has no flood map here" (not "no flood hazard").
- Never merged: official and model answers come from different endpoints and are drawn in different blocks; no
  "combined flooded area".

### 3.6 Fixed copy and dates

- Every flood view keeps "Research prototype — not for operational use" and "Not an all-clear. Follow local officials."
- Date line: "NOV 2 2026 — PRESENT" (product or gauge basis); "SEEN BY FIRE-3D SINCE NOV 3 2026" (first seen); a past
  flood: "NOV 2 2026 — LAST NWS PRODUCT NOV 5 2026", never "ENDED".
- "NWS warning until 9:00 PM MST", never "flood ends".

## 4. Test strategy

### 4.1 Pure model files and their tests (vitest, no network)

| File | Tests assert |
|---|---|
| `state/floodCatalog.ts` | pending / apply / fail / patch; source health (NWS down, gauges down, both); stale copies; counts "unknown" when down |
| `state/floodOverview.ts` | filters (active, years, watches); rank order; in-view counts and texts; fly-to box from bbox or gauge; `floodWhere` |
| `state/flood.ts` | open / close with race tokens; 404 → missing notice, 503 → lists text; one event at a time with the fire store; URL parse and write (`hazard`, `flood`, both present); history push / replace / Back across hazards |
| `map/floodLayers.ts`, `floodStyle.ts`, `floodProfile.ts` | ids unique and never fire ids; feature properties (`r`, `lr`, `kind`, `rank`, `meta`); " FLOODS"; category → colour and diamond size; **no green** in any flood colour; what each view draws (no model in Public) |
| `ui/public/floodView.ts` | date line by basis; status words for every level, status, mode and demo; `floodShortName`; the seven facts for each fixture case (token / no token, no RFC forecast, gauge not current, no product, past flood "Was in effect", Flash Flood Emergency); distance target and its words; key rows |
| `ui/timeline/hydrographModel.ts` | scales keep thresholds in view or pinned; series split; NWM only on the flow axis; stale at 3 h; cursor readout by kind; crest; product ticks; empty-state texts; day ticks across a DST change in the gauge's zone; metric conversion |
| `location/floodCheck.ts` | inside / distance for each polygon layer; satellite class at a point (cloud → "no view"); nearest gauge prefers the event's rivers, with the caveat; "Unknown, not dry" when nothing covers |
| `official/floodModel.ts` | NWS answers → rows verbatim (headline, description, sender, times in the issuer's zone); phases; Emergency first and open; archive labels; a model answer can never produce an official row |
| `scene/flood/floodAssets.ts`, `gaugeBars.ts` | channel packing, satellite classes, frame box; bar heights and tick positions (no WebGL) |
| `ui/shell/floodCopy.test.ts` | the wording guard of section 3.1 over every exported flood string and every rendered fixture case |

Plus: the backend's `test_contracts.py` mirror check for the new TS types; `lib/fileNames.test.ts` (case rule);
existing fire tests unchanged and green (about 1,060 test cases in 102 files today).

### 4.2 Fixtures

- Backend `fixture-flood` (`make_fixture.py --only flood`, backend part H): served by the real API with
  `FIRE3D_LIVE=0`; time-relative, so the gauge is rising through minor on every run.
- Web TS fixtures `official/__fixtures__/floods.ts`: trimmed copies of the backend's recorded samples
  (`backend/tests/data/floods/`): the national NWS answer, `riv_gauges`, SHRN5 detail + 3 days of stageflow, an RFC FIM
  page, the NWPS reach streamflow (section 8), plus hand-made edge cases (no token, Data Not Current, Flash Flood
  Emergency, Puerto Rico product dropped, past flood, gauge with no forecast point).
- A shot helper flag or `--eval` snippets to open `fixture-flood` and set the hazard, as brief 4 did.

### 4.3 Screenshots (each viewed; `--backend swiftshader` in the cloud; ports other than 8000 / 8710 / 5173 / 5180)

1. Public overview, Floods, minimal and details (1440 × 1000) · 2. Command overview, Floods · 3. phone overview,
Floods · 4. Public flood view, `fixture-flood`, side by side with `renders/FloodView.jpg` · 5. the same without the NASA
login (the default) · 6. phone Public flood view · 7. Command flood view with the handle in the forecast and a point
selected · 8. Command flood view of a past flood · 9. Forensic flood (fixture) · 10. Forensic unprepared flood · 11. the
water circle under `prefers-reduced-motion` (emulated) · 12. one real live flood if any is listed at build time · 13.
**fire regressions**: the brief-4 final set (`brief4-final-*.png`) re-shot and compared.

Checks with them: `__mapChrome().unobstructed`, text contrast over aerial and dark maps (brief 4 decision l: at least
4.5:1), keyboard (switch, hydrograph slider, gauge picker), screen-reader names, no request to a fire-only endpoint
while a flood is open (a fetch spy in a component test), gates and the lint baseline (55, all in `src/scene`).

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| W-R1 | A missed "no incident = overview" check shows fire UI over a flood or fetches fire data | The classification of section 1.2; one selector; a test mounting each flood chrome with a fetch spy and a "no fire words" check |
| W-R2 | A forecast, model or old satellite map is read as "water now", or no layer as "dry" | Per-layer labels with kind and time; the key departs from "Flooded area now"; the wording guard; review of each view against section 3 |
| W-R3 | Colour meaning: NOAA's green, NOAA's light blue = flood blue, minor ≈ fire orange, flood edge ≈ selected-point blue | Section 2.4 choices; shape and text everywhere; Q-W3 |
| W-R4 | The water circle's three scrolling noise patterns + grain cost CPU on phones | Paused when hidden; static under reduced motion; measure frame time; fallback: render each noise once to an image and move it with CSS transforms |
| W-R5 | Missing data: no token (the default), gauges without forecasts, NWM flow only, FEMA drops, past floods without forecasts | An explicit state for each (sections 2.8, 3); never an empty panel |
| W-R6 | Contract churn while web builds against fixtures | Freeze the flood types in `api/types.ts` in wave 0 (backend part A) before W2+ |
| W-R7 | The NWM line needs a gauge-level flow series the backend audit does not list | Add `GET /api/floods/{id}/model?kind=nwm_series&lid=` (NWPS `/reaches/{reachId}/streamflow`, 7.6 KB, measured) to backend part D, with `model_output: true` |
| W-R8 | Forensic: shader changes in `src/scene` (lint baseline), SwiftShader slowness in the cloud | Additive uniforms, lint checked per commit; `--quality low`, `--shot-timeout` |
| W-R9 | Frozen brief-4 files (TopBar, ReadoutRow, CommandReadout, MapWorkspace, tokens) | New components beside them; additive changes through the orchestrator only |
| W-R10 | URL and history with two event kinds (stale links, Back across the switch) | Tests in `state/flood.test.ts`; a 503 never reads as "not found" |
| W-R11 | CSS scoped to `[data-view='public-fire']` | Broaden selectors with `:is(...)` where layouts match; screenshot fire and flood views |
| W-R12 | Gauge times (NWPS POSIX zones, `obstime` without a zone) and DST in hydrograph ticks | Times from NWPS ISO UTC, shown in `regions.time_zone_at` zones (backend R10); a DST test |
| W-R13 | Overlapping events: a flood in a fire's burn scar shows only the flood | Said in the legend details; a cross-link later |
| W-R14 | Large polygons (RFC FIM, NFHL) slow the map | Per-event bbox queries, simplification on the backend, GeoJSON sources updated in place |

## 6. Effort per part and finish-time input

### 6.1 Calibration

Measured from commit times: brief 4 (a restyle of existing views) took about 10.5 h of wall-clock (Oct 24, 03:33 to
13:54 UTC); its steps took one agent about 1 h (H2a foundation), 1-1.5 h (H2b Command), 2 h (H3 overview), 3 h (H4
Public fire view), 2 h (H5 Forensic), and 1-1.5 h per review-fix round. Brief 3 (new data across the lower 48, both
ends) took about 26 h of wall-clock including three usage-limit pauses. Floods need new data plumbing and three new
views, so the parts below are 1.5-3x the brief-4 step of the same kind. Hours are one agent's working time, tests
included.

### 6.2 Parts

| Part | Content | Hours (range) | Needs | Wave |
|---|---|---|---|---|
| W1 | Foundation: flood client (`api/floods.ts`), `state/flood.ts`, `floodCatalog.ts`, hazard + URL + history, one-event rule, selectors at the 13 shell checks, five chromes (stubs), tokens + `floodStyle.ts`, web fixtures | 4 (3-5) | backend part A (types) | 0 |
| W2 | National map: switch, markers, groups, gauges, leader labels, bar status, list panel, Show-details count, legend, point card, search hits, phones, Forensic entry list | 6.5 (5-8) | W1 | 1 |
| W3 | Public flood view: `HazardDisc` + `WaterTexture`, title, chip maths, facts, key, flood map module (warnings, forecast area, satellite tiles / raster, channel, gauges), profile, phones | 6.5 (5-8) | W1 | 1 |
| W4 | Official flood web: `floodModel.ts`, `useFloodOfficialSync`, `FloodOfficialNow`, evacuations + local alerts by bbox, past "Was in effect" | 4 (3-5) | W1 | 1 |
| W5 | Hydrograph: model + component, two variants, gauge picker, NWM on the flow axis | 5 (4-6) | W1, backend D (+ W-R7) | 1 |
| W6 | Command flood view: chrome, `floodCheck.ts`, `FloodReadout`, legend chips, Layers entries, phones | 5.5 (4-7) | W3, W4, W5 | 2 |
| W7 | Forensic flood: assets, drapes, gauge bars, panels, dock, prepare, hand-off | 8 (6-10) | W5, backend E (bundle), H (fixture) | 2 |
| W8 | Wording file, credits, guard test | 2 (1.5-2.5) | — | 1 |
| W9 | One independent review per part (W2, W3, W4+W6, W5, W7), fixes, screenshots, checks, CONTRACT §16 "as built" | 10 (8-12) | all | 3 |
| **Total** | | **about 52 (40-64)** | | |

### 6.3 Wall-clock and finish-time input

- Wave 0 (one agent, W1): about 4 h, in parallel with backend wave 1 (it uses the contract draft of `backend.md` 3.8 and
  the fixtures until part A lands).
- Wave 1 (three agents: W2; W3 + W8; W4 + W5): about 6-8 h, against fixtures and `fixture-flood`.
- Wave 2 (two agents: W6; W7): about 6-10 h; W7 waits for the backend flood bundle (part E, backend wave 2).
- Reviews, fixes, integration with the real backend, final check: about 6-8 h.
- **Web: about 22-30 h of wall-clock**, overlapping the backend's 20-26 h; the critical path is backend C (catalog) → D
  (API) → E (bundle) → W7 → final check. **Whole build, from the start of the build waves: about 26-34 h.**
- With the plan (PLAN-5, CONTRACT §16) and the user's answers taking about 2-3 h from now (20:35 UTC, Nov 4), the build
  starts around 23:00 UTC Nov 4 and **finishes around Nov 6, 01:00-09:00 UTC (Nov 5, 5 PM - Nov 6, 1 AM Pacific)**,
  most likely about 05:00 UTC (Nov 5, 9 PM Pacific). Each usage-limit pause (brief 3 had three) adds its own length.

## 7. Open questions (decisions for the user, with a recommendation)

- **Q-W1. Where the Fires | Floods switch sits**: (a) in the top bar's title, "United States · Fires | Floods"; (b) a
  pill left of the search box; (c) only inside "Show details". Recommendation: (a).
- **Q-W2. The key's "Flooded area now"**: (a) name each layer with its own time ("Water seen by satellite · Oct 31",
  "NWS forecast flooded area · issued 10:20 AM"); (b) keep "Flooded area now" for the newest satellite water, with its
  date. Recommendation: (a): satellite water can be days old and NWS's area is a forecast.
- **Q-W3. Gauge colours**: (a) NOAA's hues for action to major, tuned for the dark map, grey instead of NOAA's green for
  "No Flood" and instead of its light blue for "not defined"; (b) NOAA's exact colours, green included; (c) a blue-only
  scale. Recommendation: (a).
- **Q-W4. Where the circle's leader line ends**: (a) at the primary river gauge, drawn as its gauge marker; (b) at the
  design's light-blue dot on the flood edge. Recommendation: (a): the light-blue dot means "your selected point".
- **Q-W5. The Public facts**: (a) seven rows with "Forecast crest (NWS)" in place of the reported coordinates (these
  move to Command); (b) the design's rows, coordinates included. Recommendation: (a).
- **Q-W6. The National Water Model in Command**: (a) on the hydrograph's flow view by default, off on the map until
  switched on in Layers; (b) on in both; (c) off in both until asked. Recommendation: (a). It is never in Public.
- **Q-W7. Hydrograph play button**: (a) none: the handle reads values and shows the NWS products in effect then; (b) a
  play button that moves through time. Recommendation: (a).
- **Q-W8. A click on a flood in Command**: (a) opens the Command flood view directly; (b) opens a flood card first, as
  for fires. Recommendation: (a): floods need no preparation for the 2D views.

## 8. Evidence log (2026-11-04, 20:17-20:18 UTC; GET only; no key or token)

| # | Request | Result |
|---|---|---|
| 1 | `mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0?f=json` | 200, 11.5 KB; renderer `uniqueValue` on `status`: major "Major Flood" (204,51,255), moderate "Moderate Flood" (255,0,0), minor "Minor Flood" (255,153,0), action "Action" (255,255,0), no_flooding "No Flood" (0,255,0), not_defined "Flood Category Not Defined" (114,175,233), low_threshold "Low Water Threshold" (144,99,32), obs_not_current "Data Not Current" (189,194,187), out_of_service "Out of Service" (102,102,102); circles size 6 |
| 2 | `api.water.noaa.gov/nwps/v1/reaches/17003486/streamflow` (SHRN5's reach, from `backend.md` evidence 3-4) | 200, 7.6 KB, 1.3 s: `reach` (San Juan River, route up / downstream), `analysisAssimilation.series` (reference 2026-11-04T16:00Z, 48 hourly points, units ft³/s, field `flow`), `shortRange.series` (reference 18:00Z, 18 points), `mediumRange`, `longRange`, `mediumRangeBlend` (empty objects in this answer). Flow only: no stage |

Code read at ac05eea (section 1). Screenshots viewed: `renders/FloodView.jpg`, `brief4-final-public-fire-fixture-live`,
`-command-fire-fixture-live`, `-public-overview-minimal`, `-public-overview-details`, `-command-overview`,
`-forensic-fixture-live`, `-phone-public-fire`. Raw answers were kept only in the session scratchpad.
