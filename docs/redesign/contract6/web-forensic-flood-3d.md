# Brief 6 · web-forensic-flood-3d · as built

The 3D flood view (Forensic with a flood open) after BRIEF-6 decision 3 (height boost, water surface with depth tint,
height above the river, closer framing) and decision 2's 3D part (drapes follow the river-level chart's handle).
Inputs: `manifest.terrain3d`, the bundle's `timeline.json` and `maps/flowlines.geojson`
(contract6/backend-flood-time-3d.md), `GET /timeline` through `state/floodTimelineData.ts` and `passAt` / `productsAt`
from `state/floodTimeline.ts` (contract6/web-flood-playback.md). Paths under `web/src/`.

## Files

| File | What |
|---|---|
| `scene/flood/heightBoost.ts` | `RELIEF_STEPS`, `RELIEF_TARGET` (0.02), `FLOOD_BOOSTS` `[1, 1.5, 2, 3, 5, 8, 10, 15, 20]`, `boostForRange(rangeM, widthM)`, `heightPercentiles(heights)`, `autoBoost(manifest, heights) → AutoBoost { factor, basis: 'bundle' \| 'grid', rangeM, widthM, reached, relief }`, `boostOptions(auto, current)`, `fmtFactor`, `fmtSpan`, `boostInUse(floodId, auto, choice)` |
| `scene/flood/terrain3d.ts` | `TERRAIN3D_SCALE_M` 0.1, `TERRAIN3D_TOP` 254, `TERRAIN3D_NODATA` 255, `cellMetres(v, t3)`, `cellIndex(x, z, w, h, extent)`, `depthProduct(t3, key)`, `fmtMetres` |
| `scene/flood/depthChoice.ts` | `PassOnScreen { key, acquiredMs, depthLayer, isShown, before?, drawn? }`, `DepthShown { from: 'satellite' \| 'forecast' \| null, product, layer, note, passKey, timeMs? }`, `depthShown({ terrain3d, has, choice, pass, layers, atMs })` |
| `scene/flood/depthMesh.ts` | `buildDepthMesh(depth, elev, w, h, extent, scale) → DepthMesh { positions, depth, inside, index, cells } \| null`, `DEPTH_RAMP` (0 m `#a9dcff`, 1 m `#3f8fe0`, 2 m `#1f5fb5`, 3 m+ `#0d2f73`) |
| `scene/flood/DepthSurface.tsx` | the water surface mesh (renderOrder 5, transparent, depthWrite off, fx fog / edge fade, `fxViewPos` bias 0.0009); sets `depthOnScreen` |
| `scene/flood/riverFrame.ts` | `RiverReach { cx, cz, dirX, dirZ, halfLen, name, points }`, `riverKey(name)`, `reachHalfLength(extent)` (12 % of the area, 2.5 to 6 km), `mainRiverReach({ flowlines, summary, grid })`, `headingOfDir`, `riverViewHeading(reach, prefer = 337.5, offset = 32)`, `RIVER_POLAR_DEG` 69, `riverDistance(reach, { width, height, insets, fovDeg, extent })` |
| `scene/flood/floodPassDrape.ts` | `PassDrapeMode 'bundle' \| 'raster' \| 'image' \| 'none'`, `PassDrape { mode, pass, waterLayer, depthLayer, image, at, source: 'route' \| 'bundle' }`, `passDrapeAt({ route, bundle, cursorMs, nowMs, layers })`, `passOnScreenOf(d)`, `satelliteOfDrape({ drape, base, route, bundle, cursorMs, nowMs, tf }) → SatelliteWaterResponse \| null`, `newerPassThanShown(passes, shownMs)`, `usePassDrape(flood)`, `imageAffine(bounds, grid)`, `passDrapeGpu` (module object Terrain.tsx reads each frame) |
| `scene/flood/productsOnScreen.ts` | `ProductsOnScreen { alerts, zones, source: 'timeline' \| 'copy', future, issuedForCursor, archiveCredit, retrievedMs }`, `productsOnScreenOf({ copy, route, cursorMs, nowMs })` (review WFF3D-R4: the warning lines, the hover's NWS rows and the dock's NWS column read this one answer) |
| `scene/flood/bundleRaster.ts` | `useBundleRaster(manifest, layer, known?)`: one uint8 bundle layer on demand (24 kept per session) |
| `scene/flood/flood3dHooks.ts` | `useHeightInUse(flood)`, `useDepthShown(flood)`, `depthOnScreen` (zustand), `useSatelliteOnScreen(flood) → SatelliteOnScreen { sat, has, noView, arr, imageOnly, gridOnly, note }`, `useProductsOnScreen(flood) → ProductsOnScreen \| null` |
| `scene/flood/flood3dCopy.ts` | `FLOOD_3D` (every new string), `HAND_LABEL_FALLBACK`, `DEPTH_LABEL_FALLBACK`; under the flood wording guard |
| `scene/flood/floodAssets.ts` | `FloodSceneAssets` gains `textures.hand`, `has.{hand, depthSatellite, depthForecast}`, `arrays.{hand, depthSatellite, depthForecast}`, `terrain3d`, `boost: AutoBoost`, `river: RiverReach \| null`, `bundleTimeline` |
| `scene/flood/FloodFx.tsx` | `HeightBoost` (layout effect), `PassDrapeDriver`, `DepthSurface`; `WarningLines` draw `useProductsOnScreen`; `SatelliteEdge` follows the pass on screen |
| `scene/flood/floodProbe.ts` | `floodProbeRows` gains `depth?`, `satOnScreen?`, `products?`; rows `depth` (DEPTH) and `hand` (ABOVE RIVER) |
| `scene/terrain/terrainMaterial.ts`, `Terrain.tsx` | uniforms `uHand`, `uHasHand`, `uHandOpacity` (HAND bands) and `uSatImg`, `uHasSatImg`, `uSatImgU`, `uSatImgV` (a pass's picture); the satellite drape swaps per frame from `passDrapeGpu`. Review WFF3D-R1: two program variants, `TERRAIN_FLOOD` (define), `setTerrainVariant(material, flood)`, `createTerrainMaterial(flood = false)`, `terrainFragmentShader` (exported for the test): fire 12 samplers (no flood drapes), flood 13 (no `uFuel`, `uObserved`, `uForecast`, `uSeverity`), each + 1 shadow map ≤ 16 (WebGL2's guaranteed `MAX_TEXTURE_IMAGE_UNITS`); `terrainMaterial.test.ts` counts them |
| `scene/camera/CameraRig.tsx` | river view on open (3D), on the hand-off when the map was wider, on `'frame-river'` |
| `scene/sceneStore.ts` | `CameraCommandKind` gains `'frame-river'` (additive) |
| `scene/overlays/SceneOverlays.tsx`, `overlays.css` | the dock's height select for a flood (`.sc-height`), kept on phones; hover readout inputs |
| `ui/forensic-flood/forensicFloodState.ts` | layers `depth` (on, 0.85) and `hand` (off, 0.8); `boost: { floodId, factor } \| null`, `setBoost(floodId, factor \| null)`; `depthFrom: { floodId, from: 'satellite' \| 'forecast' } \| null`, `setDepthFrom(floodId, from \| null)` (the water already chosen, or null, goes back to automatic), `depthChoiceFor(state, floodId)`; `resetLayers` also clears `depthFrom` |
| `ui/forensic-flood/FloodDock.tsx` | review WFF3D-R4: the NWS column reads `useProductsOnScreen` and renders each version with `NwsVersion` (`ui/timeline/HydrographPlayback.tsx`: event and issuer verbatim, own issue and end times, NWS headline verbatim, `ARCHIVED_COPY` tag, link) + the IEM credit; "From the flood's time history · read {time}" or the saved copy's time under it |
| `ui/forensic-flood/floodForensicView.ts` | `LAYER_STATUS_KEY.depth/hand = null`; `layerUnavailable('hand' \| 'depth')`; `KeySwatch` + `'height' \| 'depth' \| 'hand'`; `sceneKeyItems({ …, height?, depth?, satNote? })` |
| `ui/forensic-flood/FloodLayersTab.tsx`, `FloodForensic.tsx`, `styles/forensic-flood.css` | group "From the terrain" with an "experimental" tag in its header (depth legend, "Depth of (automatic)" Satellite water / NWS forecast area, HAND bands and its experimental tag), key items (`.fxf-key-none` hollow swatch for a line with nothing drawn), "River view" entry control (phones: "River") |

## Behaviour

- **Height boost.** The flood opens at `manifest.terrain3d.relief.exaggeration`; a bundle without `terrain3d` uses the
  same rule (`RELIEF_RULE`) on the whole grid's 5th–95th percentile heights. The factor is the shared
  `store.exaggeration` while the flood scene is mounted (`HeightBoost`, a layout effect so the camera frames at it);
  the value from before (the fire view's) comes back on unmount. The user's choice is kept per flood in
  `forensicFloodState.boost` for the session. Always on screen: the dock reads "Height ×10 · auto" (phones "Height
  ×10"; depth of field and full screen give way there) and the key "Height ×10: heights drawn 10 times taller,
  distances true", with "Still flat at ×10: raise it, or use River view." when `target_reached` is false (or the grid
  rule did not reach it), "Your choice. The automatic height here is ×10." for a user choice; the fold-out has the
  automatic reason, `relief.rule` and `relief.area_note`.
- **Water surface with depth tint.** `depthShown`: automatic = the satellite water (the pass on screen) when it has an
  estimate, else the NWS forecast area; the Layers tab's "Depth of" picks one. Drawn only inside the mapped water (255
  cells never get a vertex of their own; rim vertices at the terrain fade out). Key: the backend's `label` (DEPTH_LABEL)
  + "Of the satellite water seen {date}" / "Of the NWS forecast flooded area issued {date}"; fold-out: `source`,
  `caveat`, `method`, `citation`. With none: the reason (backend `reason`, `depthNoPass`, `depthPassNotDrawn`,
  `depthNoImageYet`, `depthForecastLater`, `depthNoTerrain3d`), never an empty surface. Hover: "About 1.2 m deep here (estimated …)" inside
  the water only (no "0 m" outside).
- **Height above the river.** Off by default; violet bands 0–1 / 1–2 / 2–5 m (`--fxf-hand-*`), hairlines at 1, 2, 5 m,
  nothing where 255 (more than 10 km from a channel). Key: `hand.label` (HAND_LABEL) and the bands; fold-out:
  `caveat`, `method`, `source`, `citation`. Hover: "The ground here is about 0.5 m above the nearest river channel
  (from terrain). Not a flood map."
- **River view.** `mainRiverReach`: lines named like `summary.rivers` / the primary gauge's waterbody ("St." =
  "Saint"), else the highest stream order; the reach within `reachHalfLength` of the main-river point nearest the
  primary gauge (else the flood's point); its centre and principal axis. Camera: target on the reach, polar 69° (21°
  above the horizon; fires stay at 61°), heading along the axis ±32° (the candidate nearest 337.5°), distance from
  `riverDistance`. Used when the flood opens in 3D, on "River view" (`'frame-river'`), and on the map's hand-off when
  `flyTo.distance` is more than 1.25 × the river view's (a closer map view keeps its place). On that hand-off a map the
  user turned keeps its heading (decision k; only the place, distance and tilt change), a north-up map gets the
  heading along the river (review WFF3D-R7, CONTRACT §17). "Frame flood" still fits the whole flood. No river line →
  the old framing.
- **Drapes follow the handle (M4).** Before now: `passAt(route passes)` (the bundle's frozen passes when the route's
  are unavailable): the bundle's shown pass → its own layers; a kept pass → `water_pass_<key>` and `depth_pass_<key>`
  (loaded on demand); else its 2D picture (`image.url`, `bounds_lonlat`, an affine map in the terrain shader), with no
  depth surface and the key saying so; before the first pass → nothing, "No satellite image at or before this time…".
  A no-view pass is never drawn (passAt skips it; the gap words come from `gapNote`). The key's satellite line, the
  Layers tab date, the image edge and the hover's SATELLITE row follow the pass on screen. NWS warning lines and the
  hover's NWS rows use `productsAt` (time history before now, the bundle's copy at and after now). Nothing animates
  between passes; Play / step are the chart's (no autoplay; reduced motion stands still).
- **Review fixes (review6, WFF3D-R1..R10).** The words always follow the pass drawn: with the route's passes
  unavailable or not loaded the drape uses the bundle's frozen list (`source: 'bundle'`) and `satelliteOfDrape` builds
  the key's, Layers tab's and hover's answer from that same pass (no picture, no image edge; the hover reads its cells,
  `gridOnly`); a known pass with nothing to draw says so (`satPassNotDrawn`, `depthPassNotDrawn`). Before the first
  pass nothing is drawn and the depth surface never falls back to the forecast; the NWS forecast area's surface is never
  shown for a handle before its own issue time (`depthForecastLater`). The dock's NWS column, the warning lines and the
  hover read `productsOnScreenOf` (before now the time history, archived versions tagged and credited; at and after
  now the saved copy's newest version of each product); the key's "NWS warning area" line shows only while a product is
  drawn. At now, when the time history lists a newer usable pass than the 3D data's, the key says so (`keySatNewer`).
  Past handles: the satellite age is counted from the handle (`keySatAgeHandle`, `keySatAtHandle`) and amber after 3
  days before it. A picture-only pass under the hover is "not read" (`probeNothingUnread`, never NOTHING_COVERS). The
  readout subscribes to `depthOnScreen`.

## Strings (exact; `scene/flood/flood3dCopy.ts`)

| Key | Text |
|---|---|
| `height` / `heightAuto` | Height ×{n} / Height ×{n} · auto |
| `heightTip` | Height boost: heights are drawn {n} times taller so low ground shows in flat places. Distances are true. |
| `keyHeight` | Height ×{n}: heights drawn {n} times taller, distances true |
| `keyHeightAuto` / `keyHeightAutoGrid` | Automatic for this area: the ground near the water spans {range} m (middle 90%) across {width} km. / Automatic for this area: its ground spans {range} m (middle 90%) across {width} km. |
| `keyHeightUser` | Your choice. The automatic height here is ×{n}. |
| `keyHeightFlat` | Still flat at ×{n}: raise it, or use River view. |
| `heightRuleGrid` | This flood's 3D data was prepared before the relief measure: the automatic height is taken from the heights of the whole 3D area, with the same rule. |
| `layerDepth` / `layerDepthTip` | Depth (estimated) / Estimated from the terrain at the water's edge (FwDET), inside the mapped water only. Experimental: errors of a metre or more are common |
| `depthOfSatellite` / `depthOfForecast` | Of the satellite water seen {date} / Of the NWS forecast flooded area issued {date} |
| `depthNoPass` | No depth surface for this satellite pass: its depth estimate is not in the 3D data. The water it saw is drawn flat. |
| `depthPassNotDrawn` | No depth surface for this satellite pass: neither its water nor its depth estimate is in the 3D data, so nothing of it is drawn here. That is not an all-clear. |
| `depthNoForecast` | No depth surface: the NWS forecast flooded area has no depth estimate in the 3D data. |
| `depthForecastLater` | No depth surface: the NWS forecast flooded area was issued after this time, so it is not shown here. Move the handle later, or pick Satellite water. |
| `depthFromAuto` / `depthChoiceAuto` | (automatic) / Your choice. Press again for the automatic choice |
| `depthNoImageYet` | No depth surface: no satellite image at or before this time. That is not an all-clear. |
| `depthNoTerrain3d` | This flood's 3D data was prepared before depth estimates were added: prepare it again for a depth surface. |
| `layerHand` / `layerHandTip` | Height above the river / Height of the ground above the nearest river channel, from the terrain. Not a flood map. Experimental |
| `handBand1..3`, `handLegend` | 0–1 m, 1–2 m, 2–5 m, above the nearest river channel |
| `groupTerrain3d` / `groupTerrain3dTag` | From the terrain / experimental (the group header's tag, and the depth and HAND notes') |
| `riverView` / `riverViewShort` / `riverViewTip` | River view / River / A lower, closer look along the main river |
| `probeDepth`, `probeDepthAt`, `probeDepthTop` | DEPTH; About {m} m deep here (estimated from the terrain at the water's edge; experimental, often off by a metre or more).; More than 25 m deep here by the estimate (from the terrain at the water's edge; experimental). |
| `probeHand`, `probeHandAt`, `probeHandTop`, `probeHandFar` | ABOVE RIVER; The ground here is about {m} m above the nearest river channel (from terrain). Not a flood map.; … more than 25 m …; More than 10 km from a mapped river channel: not measured. Not a flood map. |
| `probeSatImageOnly` | The pass of {date} is shown here as its picture only (its cells are not in the 3D data), so this spot is not read here. Not an all-clear. |
| `probeNothingUnread` | No NWS flood product or NWS forecast flooded area covers this spot, and the satellite picture is not read here. Unknown, not dry. Follow local officials. |
| `satPassBundle` | From the copy of the flood's time history saved with the 3D data (the live list could not be loaded). |
| `satPassNotDrawn` | The satellite pass of {date} is not in the 3D data and its picture could not be loaded: nothing of it is drawn here. That is not an all-clear. |
| `keySatAgeHandle` / `keySatAtHandle` | {age} before the handle / at the handle |
| `keySatNewer` | Newer satellite passes exist ({date}): step back with the river-level chart to see them. |
| `FLOOD_FORENSIC.dockNoProductTimeline` | No NWS flood product was in effect at {time} in the flood's time history (NWS, and the IEM archive for older versions). That is not an all-clear: follow local officials. |
| `FLOOD_FORENSIC.dockTimelineTime` | From the flood's time history · read {time} ({age}) |

Also changed: `FLOOD_FORENSIC.layersFoot` "FEMA, NWS category maps, the model and the height above the river start off".

## Outside the role's folders (declared)

- `scene/sceneStore.ts`: the additive `'frame-river'` command kind. `ui/shell/handoff.ts` was not changed: a
  `'frame-river'` command counts as a user turn there (not in `NON_TURNING`), so the map takes the river view's heading
  back only after the user pressed "River view"; the initial river view is not a command and leaves the map's heading
  alone.
- `scene/overlays/SceneOverlays.tsx` + `overlays.css`, `scene/terrain/*`, `scene/camera/CameraRig.tsx`: flood-only
  branches; the fire view is unchanged (0.11 % of pixels differ below the top bar from
  brief5-final-fire-forensic-fixture-live.png, labels only).
- Review fixes: `scene/terrain/terrainMaterial.ts` now has a fire and a flood program variant (the fire variant
  drops only the flood drapes, a no-op for a fire: 0.10 % of pixels differ from
  brief6-web-forensic-flood-3d-fire-regression.png, labels only). `ui/forensic-flood/FloodDock.tsx` imports
  web-flood-playback's exported `NwsVersion` (no change to their file).

## For other roles (review WFF3D-R8)

- **backend-flood-time-3d / web-flood-playback:** at now both the 2D map and the 3D view draw the satellite route's
  own pass (`shown_key`), which can be older than the newest usable pass in the time history (St Johns: Oct 26 shown,
  Oct 29 listed), so Play's last step then Next goes back in time. The 3D key now says "Newer satellite passes exist
  ({date}): step back with the river-level chart to see them." (`FLOOD_3D.keySatNewer`, `newerPassThanShown`). A later
  brief could let `shown_key` prefer the newest usable pass, or show the same note on the 2D map's legend.
