# web-flood-forensic: as built (brief 5)

Role `web-flood-forensic` (wave 3), PLAN-5 §4.7, §4.8, §5.5; CONTRACT §16.12. Commits: `M1 flood branch, Prepare 3D data,
SceneManifest assets, frame and overlays for floods, drapes, warning lines` (34dc4dd), `M2 gauge bars, header, entry
controls, right panel and tabs (CatFIM toggle), evidence` (a1b7b07), `M3 dock hydrograph, hand-off, screenshots, report` (d4c0cdf).
Paths under `web/src/`. web-flood-command's `M1 hydrograph` (74258f8) was in `git log` before Forensic's M1, so the dock
mounts the real `Hydrograph variant="dock"` (no placeholder).

## The branch (`ui/shell/ForensicWorkspace.tsx`, `ui/forensic-flood/FloodForensic.tsx`)

- `ForensicWorkspace` default export: a flood open (and no fire) → `FloodForensic`; no event → the entry page
  (unchanged); a fire → the fire Forensic (unchanged). The fire Header, Timeline, Charts, RightPanel and BottomDock are
  not touched and never mounted for a flood.
- The safe-area hook moved unchanged to `ui/forensic-flood/safeArea.ts` (`useSafeArea`), shared by both branches.
- `FloodForensic()`: the scene when `useFlood.manifest` is the open flood's and `ready`, else `NotPrepared`: the top
  bar, a glass card with FORENSIC_FLOOD `notPrepared` + `prepare` ("Prepare 3D data (about 1 min)") calling
  `useFlood.getState().startFloodBuild()`, the progress (`floodPrepState`, `ProgressBar`; "Preparing 3D data…
  terrain 40%"), a failure with the backend's reason and "Prepare again" (`startFloodBuild(true)`), "Back to the map",
  and the fixed copy pill at its foot. When the job is done web-flood-public's poller re-reads the detail and the
  scene loads by itself. `fixture-flood` (409 bundle-only) is never offered a preparation.
- The scene layout is the fire Forensic's (`.app`, `.app-canvas`, `.app-header`, `.rcol`, `.dock`, `.fx-ws`,
  `.fx-note`, `fx-dock-min`, `fx-sheet-closed`): `FloodHeader`, `FloodRightPanel`, `FloodDock`, the entry controls
  "Frame flood" (camera command `frame-fire`, which `frame.ts` turns into the flood's box) and "Charts & NWS products"
  (phones: "Layers & analysis"), the demo badge "Demo · simulated data" with its second line "terrain, water layers and
  gauges are synthetic", the scene key, and `FixedCopy variant="pill"` (PROTOTYPE_LINE + NOT_ALL_CLEAR) on every state,
  phones included.

## Scene (CONTRACT §16.12)

- `scene/assets.ts`: `export type SceneManifest = Pick<IncidentManifest, 'id' | 'grid' | 'time_origin_ms' | 'time_range'
  | 'built_ms' | 'status' | 'mode'> & { ignition: Ignition | null }`; `IncidentAssets.manifest: SceneManifest` (the
  frozen `scene/fx/**` typechecks with it, so **no `SceneAssets` base type was needed and nothing is cast**);
  `IncidentAssets.flood?: FloodSceneAssets` (additive, absent for a fire); `useSceneAssets()` (the open flood's assets
  while a flood is open, else the fire's).
- `scene/flood/floodAssets.ts`: `floodAssetStore` (`{ assets, loading, error }`), `syncFloodAssets()`,
  `useFloodAssets()`, `useFloodAssetsLoading()`, `useFloodAssetsError()`, `sceneManifestOf(m)`, `satLutTexture()`,
  types `FloodSceneAssets` and `FloodAssets = IncidentAssets & { flood }`. Loads `elevation`, `sky_view`, `naip`,
  `water_forecast`, `floodplain`, `water_model`, `water_satellite` (only layers whose `layer_status` is `ok`),
  `warnings.json`, `gauges.json`, `satellite.json` and the chosen CatFIM GeoJSON from `/api/floods/{id}/files/…`
  (`floodFileUrl`, `?v=built_ms`). `FloodSceneAssets`: `{ manifest, summary, textures: { pack, satWater, satLut }, has:
  { forecast, floodplain, model, catfim, satellite, noView }, arrays (render grid, row 0 north), catfim, warnings,
  gauges, satellite, frame, anchors }`. Every fire texture / array is null; `fireGrid` is the render grid.
- `scene/flood/floodGeo.ts` (pure): `polygonsLocal`, `featurePolygons`, `rasterizePolygons` (CatFIM has no bundle
  raster: rasterised on the render grid), `FLOODPLAIN_PACK` `[0, 96, 200, 255]`, `packFloodLayers` (RGBA: r NWS forecast
  area, g FEMA floodplain, b NWM, a CatFIM), `anySet`, `floodFrameOf` (the summary's `bbox_lonlat` in local metres, kept
  inside the bundle, ≥ 2 km), `maskAnchor(mask, w, h, extent, bias)`, `productKey`, **`warningsAt(alerts, cursorMs,
  nowMs)`** (warnings.json keeps every version: per product the newest version sent at or before the handle's time,
  then web-flood-public's `productsDrawn` at now / `productsAt` otherwise: C1, tested on both sides of now),
  `chooseCatfim` (D22: the primary gauge's forecast category, else observed, else the highest), `clipRingToBox`
  (outlines are never drawn along the bundle's edge).
- `scene/flood/satClasses.ts`: `SAT_CLASSES`, `satDrapeOf`, `satLutData()` (256 × 2 RGBA lookup the shader reads),
  `satShares`. 0 not water: nothing; 1 water `#2a8ce6` α .55; 2 partial `#7fd4ff` α .35; **252 snow/ice, 253 cloud,
  255 no data and any unknown value: the grey `#9a9a9a` "no view" cross-hatch, never transparent, never land**; 254
  ocean: nothing. `satClasses.test.ts` checks the table and the lookup bytes.
- `scene/terrain/terrainMaterial.ts` (additive uniforms `uFloodPack`, `uHasFlood`, `uSatWater`, `uHasSat`, `uSatLut`,
  `uSatOpacity`, `uFimOpacity`, `uPlainOpacity`, `uModelOpacity`, `uCatfimOpacity`; all 0 for a fire): FEMA floodplain
  faint stipple + hairline edge; NWS forecast area faint fill + "/" world-space hatch + edge; CatFIM "\" hatch, paler;
  satellite water from the lookup with bilinear masks (fill + `#7fd4ff` edge, no glints) and the no-view wash +
  cross-hatch; NWM amber dotted edge + faint fill. Hatch spacing ≥ ~10 px, snapped to powers of two.
- `scene/terrain/Terrain.tsx`: binds the flood textures; for a flood the terrain, aerial photo and contour opacities and
  the drape opacities come from `forensicFloodState` (never the fire store's layers).
- `scene/frame.ts`: `fireFrame()` returns the flood's box (`hasFire: false`, no time span) for flood assets; framing,
  the scan sweep centre and "Frame flood" use it.
- `scene/Scene.tsx`: `useSceneAssets()`; for a flood `SceneFx` is not mounted and `FloodFx` is; terrain, camera, probe,
  lights, look and post are shared.
- `scene/flood/FloodFx.tsx`: `FloodFxDriver` (the shared fx uniforms the ribbons and labels read; the fire FxDriver is
  not mounted), `WarningLines` (pink `#ee7aa0` ribbons draped with `scene/fx/lines.ts`: warnings 2.2 px, advisories
  ×0.8, watches dashed, an Emergency wider; zone-based products from `zones` features), `SatelliteEdge` (dashed grey
  along `image.bounds_lonlat`), drape labels "MODEL · EXPERIMENTAL" (amber) and "NWS CATEGORY MAP · EXPERIMENTAL" when
  on, `GaugeBars`. Per-frame opacities are module uniform objects (like `fxUniforms`); nothing animates.
- `scene/flood/GaugeBars.tsx` + `gaugeBarMath.ts`: `BAR_M_PER_FT` 12, `stageFt`, `barHeightM`, `categoryCaps` (§5.3
  short labels, capitals, never a raw value), `stageCaps`, `gaugeBarLabel` ("ZZRF1 · 17.6 FT · MODERATE · 22:00 MST";
  the reading's own time in the gauge's zone, its day when not today's), `gaugeBars(gauges, grid, { units, tf, nowMs })`
  → `GaugeBarSpec { lid, x, z, member, heightM, color, crestM, crestColor, ticks, topM, label, labelled }`. Members
  through `memberGaugesOf` (one reading per gauge, WFP-R2), then nearby gauges inside the area; labels only for members
  and gauges at action or above (a 60 km area holds dozens of gauges).
- `scene/overlays/SceneOverlays.tsx`: for a flood the probe readout shows coordinates, elevation, slope and the rows of
  `scene/flood/floodProbe.ts` (review WFF-R1, below; never fuel, arrival or ignition); the frame button says "Frame the
  flood"; the loading veil follows the flood's assets.

## Panels (`ui/forensic-flood/`)

- `forensicFloodState.ts`: `useForensicFlood` (dev handle `window.__forensicFlood`), `FloodForensicLayer` (`terrain
  naip floodplain satellite forecastArea warnings gauges catfim model contours telemetry`), `FLOOD_FORENSIC_DEFAULTS`
  (FEMA, CatFIM and model off), `setLayerVisible`, `toggleLayer`, `setLayerOpacity`, `resetLayers`, `tab`, `setTab`,
  `shownOpacity`. **No key was added to `state/flood.ts`.**
- `floodForensicCopy.ts`: `FLOOD_FORENSIC` (spreads floodCopy's `FORENSIC_FLOOD`); under the wording guard.
- `floodForensicView.ts` (pure): `LAYER_STATUS_KEY`, `layerUnavailable` (the backend's `layer_status.reason` or the
  answer's own reason, else "Not in this bundle"), `sceneKeyItems` (each layer drawn with its own time; satellite age at
  render time, amber after 3 days, C16; the no-view and image-edge lines; FEMA / CatFIM / model only when on; the
  gauge line "Bar height: river stage at the gauge (scaled), not water depth"), `evidenceProducts`, `versionAction`,
  `gaugeRows`.
- `FloodHeader.tsx`: the fire bar's layout: "Back to all floods" (`switchWorkspace('map')` then `goToFloodOverview`),
  logo, "● LIVE <name>" pill with DEMO, county + date line (`floodDateLine`), view pill, Share (copies the URL), Hide
  panels; mini bar with panels hidden.
- `FloodRightPanel.tsx`: tabs Layers (`FloodLayersTab`), Analysis (each member gauge's reading, `CREST_LINE` /
  `FORECAST_HIGH_LINE` / `NO_RFC_FORECAST`, "Chart" sets `useFlood.gaugeLid`), Evidence (`FloodEvidenceTab`), Notes
  (`state/annotations` `loadNotes` / `saveNotes` keyed by the flood id); cards "Flood overview" (kind, highest product
  verbatim, start, 3D area, prepared time, `aoi_note`) and "River gauges" (members, then 4 nearby + "Show all N").
- `FloodLayersTab.tsx`: Base (Terrain, Aerial photo "before this flood", FEMA floodplain "effective {date}"), Water
  (Satellite water, NWS forecast area, NWS warning areas, River gauges, NWS category maps), Model (NWM flooded area),
  Parametric (Contours, Telemetry labels); unavailable rows greyed with the reason.
- `FloodEvidenceTab.tsx`: every saved version per product (VTEC action, sent / starts / until in the issuer's zone,
  headline, description, instruction, area inside `data-verbatim`, sender, https link; "Archived copy (Iowa
  Environmental Mesonet)" for archived copies), then the bundle's `data_sources` (credit lines) and build notes.
- `FloodDock.tsx`: `Hydrograph variant="dock"` with `products` = warnings.json's alerts and `gauges` = members first;
  a compact gauge picker (members, category in words) sets `useFlood.gaugeLid`; "Charts & NWS products" opens the
  right column: the products drawn at the handle (`warningsAt`), `NO_PRODUCT` only for an available answer, and
  `CURSOR_FUTURE_PRODUCTS` after now.
- `styles/forensic-flood.css`: everything above (no green).

## Review fixes (review5-web-flood-forensic.json, 14 findings, all fixed)

The code is in the orchestrator's snapshot 8e756a7 (taken during a usage-limit pause); the card grid fix, screenshots
and docs are in `brief 5 web-flood-forensic: review fixes`.

- **Hover readout (R1)**: new pure `scene/flood/floodProbe.ts`: `floodProbeRows({ flood, layers, extent, point: { x, z,
  lon, lat }, cursorMs, nowMs, tf }) → { rows: ProbeRow[], note }` (`ProbeRow { key, label, text, tone? }`), `cellAt`,
  `catfimCategoryLabel(category)` ("Moderate flooding (NWS)"), `catfimCategoryWord(category)` ("moderate"). Rows: NWS
  products drawn at the handle whose area holds the spot (`INSIDE_WARNING` / `INSIDE_WARNING_UPCOMING`, issuer's zone);
  SATELLITE with the pass's own sentences (`FLOOD_PUBLIC.satWaterPoint` / `satNotWaterPoint` / `satSnowPoint` /
  `satOceanPoint` / `satNoViewPoint`, `SAT_CLOUD_POINT`, `SAT_NODATA_POINT`, `SAT_OUTSIDE_POINT` outside
  `image.bounds_lonlat`); NWS FCST inside / "unknown, not absent"; FEMA (while on) its zone, `NFHL_OUTSIDE` only when
  `layer_status.floodplain.reason` is null, `NFHL_NO_MAP`, else "may not cover this spot. Not an all-clear."; the category
  map and the model only inside (`MODEL_AT_POINT`), never "not flooded". Note: `NOTHING_COVERS` (no NWS product, forecast
  area or satellite water at the spot), `NOTHING_COVERS_OFFICIAL` (only FEMA / category map / model), the copy's outage
  text when warnings.json is not available. Values wrap (`.fxf-probe-row`).
- **Layer notes and caveats (R2)**: `floodForensicView.layerNote(k, flood)` (the reason of an 'ok' layer); `layerUnavailable`
  returns the backend's reason for a layer made with nothing to draw. `SceneKeyItem` gains `notes?: string[]` (shown
  under the line: `SAT_NOT_SET_UP_SHORT`, FEMA's partial map, other reasons) and `more?: { title, texts }` (the key's
  fold-out "About these layers": satellite.json caveats + `login_note`, `RFC_FIM_NOTE` + `RFC_FIM_OUTSIDE`, `NFHL_NOTE`,
  `CATFIM_NOTE`, `MODEL_CAVEAT`, warnings.json / gauges.json caveats). The Layers tab shows the note under the row.
- **Dates (R3)**: `floodplainEffective(flood)` (FEMA's `time_ms` as a UTC calendar date); the key's FEMA line is
  `NFHL_LABEL`; row notes ("effective {date}", "taken before this flood", the image day, the category in words) are a
  line of their own (`.fxf-row-meta`), never the `.lrow-meta` the narrow column hides.
- **Handle after now (R4)**: `sceneKeyItems({ …, cursorMs })` adds an amber `future` item with `futureProductsNote(warningsAt(…))`
  (web-flood-command's shared note: `CURSOR_FUTURE_PRODUCTS` or `CURSOR_FUTURE_ISSUED`); on phones it shows under the
  folded key. `warningsAt` now returns web-flood-command's `ShownProducts` (`productsShown`, WFC-R1).
- **Dock absence (R5)**: `dockNoProduct({ cursorMs, nowMs, savedMs, tf })`, `COPY_FRESH_MS` (30 min); the products column
  also shows "Copy saved with the 3D data · {time} ({age})".
- **Overview card (R6)**: `overviewProduct(warnings, built_ms, now) → { kind: 'unavailable', text } | { kind: 'product', alert }
  | { kind: 'none' }`; the card never reads the live list. `.kv.fxf-kv` is one column (the base `.kv` grid had put two
  rows side by side).
- **Gauges card (R7)**: gauges.json caveats and `GAUGE_NOT_ALL_CLEAR` whenever a listed gauge is below flood stage.
- **Bar labels (R8)**: `gaugeBarMath.placeBarLabel(anchor, size, wPx, hPx, offset, insets, blocked) → { flip, hidden, box }`,
  `ScreenRect`; new `scene/flood/floodOverlayRects.ts` (`setFloodOverlayRect(id, rect | null)`, `floodOverlayRects()`),
  fed by `FloodForensic` (ResizeObserver on the key column, badge, entry controls, prototype pill). `GaugeBars` drives
  `ScreenLabel`'s `fade` / `flip` / `screen` refs per frame (instant under reduced motion).
- **Phone picker (R9)**: under `NARROW_QUERY` the picker shows the diamond and the gauge id (`.fxf-pick.is-narrow`).
- **Loader test (R10)**: `scene/flood/floodAssets.test.ts` (stubbed fetch, 5 cases).
- **Nits**: R11 category in words; R12 `where`, `analysisPlaceholder`, `dockPlaceholder`, `keyFuture` removed (new keys:
  `keyMore*`, `probeNws`, `probeCatfim`, `probeOutPlainUnknown`, `probeInCatfim`, `layerNaipBefore`,
  `layerFloodplainEffective`, `keyFloodplainNoDate`, `overviewProductAt`, `dockCopyTime`, `dockNoProductAt`,
  `dockNoProductCopy`; `keyCatfim` and the probe sentences reworded); R13 flood colours from `--m-flood*`, `--m-alert`,
  `--m-cat-*`; R14 fire regression retaken at `--wait 40000`.

## Hand-off (`ui/shell/handoff.ts`)

`openEventGrid()` → `{ kind: 'fire' | 'flood', id, grid } | null` (the open fire's ready manifest, else the open
flood's); `switchWorkspace` uses it both ways; `flyForensic` waits for the fire's or the flood's asset store. The heading
rule is unchanged (`handoff.test.ts`: fire cases unchanged, one flood case).

## Deviations and notes

- PLAN-5 §4.7's "Analysis (hydrographs per gauge)": the Analysis tab lists each gauge's reading and NWS forecast with a
  "Chart" button that shows it in the dock; **small multiples are below the cut line** (left to the integration).
- Snow / ice (252) and unknown values are drawn as "no view" too (never as dry ground), beyond §16.5's 253 / 255.
- The NAIP year is not in the flood manifest; the row says "before this flood" (the layer's own description).
- Clouds / no data inside a real bundle can cover most of a 60 km area (St. Johns: 66 % no data outside the Landsat
  swath): the hatch is kept lighter than the water fill so the terrain stays readable.
- `scene/fx/**` stays frozen: the flood view imports its ribbons, sprites, `Overlay`, `ScreenLabel` and `fxUniforms`.

## For the next roles

- **web-flood-command (Hydrograph, dock variant):** after its review fixes the dock label rows read in full; still seen
  in the review-fix screenshots: the 82 px right gutter cuts "MODERATE 17.0" to "MODERATE 17.", and with the products
  column open the title row touches the "--- FORECAST" legend.
- **integration:** Analysis-tab small multiples (cut line); CONTRACT §16.16 from this note (including the review-fix
  exports above: `floodProbe.ts`, `floodOverlayRects.ts`, `placeBarLabel`, `layerNote`, `floodplainEffective`,
  `dockNoProduct`, `overviewProduct`, `SceneKeyItem.notes / more`).
