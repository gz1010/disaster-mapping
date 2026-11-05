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
| `scene/flood/depthChoice.ts` | `PassOnScreen { key, acquiredMs, depthLayer, noView, isShown, before? }`, `DepthShown { from: 'satellite' \| 'forecast' \| null, product, layer, note, passKey, timeMs? }`, `depthShown({ terrain3d, has, choice, pass, layers })` |
| `scene/flood/depthMesh.ts` | `buildDepthMesh(depth, elev, w, h, extent, scale) → DepthMesh { positions, depth, inside, index, cells } \| null`, `DEPTH_RAMP` (0 m `#a9dcff`, 1 m `#3f8fe0`, 2 m `#1f5fb5`, 3 m+ `#0d2f73`) |
| `scene/flood/DepthSurface.tsx` | the water surface mesh (renderOrder 5, transparent, depthWrite off, fx fog / edge fade, `fxViewPos` bias 0.0009); sets `depthOnScreen` |
| `scene/flood/riverFrame.ts` | `RiverReach { cx, cz, dirX, dirZ, halfLen, name, points }`, `riverKey(name)`, `reachHalfLength(extent)` (12 % of the area, 2.5 to 6 km), `mainRiverReach({ flowlines, summary, grid })`, `headingOfDir`, `riverViewHeading(reach, prefer = 337.5, offset = 32)`, `RIVER_POLAR_DEG` 69, `riverDistance(reach, { width, height, insets, fovDeg, extent })` |
| `scene/flood/floodPassDrape.ts` | `PassDrapeMode 'bundle' \| 'raster' \| 'image' \| 'none'`, `PassDrape { mode, pass, waterLayer, depthLayer, image, at }`, `passDrapeAt({ route, bundle, cursorMs, nowMs, layers })`, `passOnScreenOf(d)`, `usePassDrape(flood)`, `imageAffine(bounds, grid)`, `passDrapeGpu` (module object Terrain.tsx reads each frame) |
| `scene/flood/bundleRaster.ts` | `useBundleRaster(manifest, layer, known?)`: one uint8 bundle layer on demand (24 kept per session) |
| `scene/flood/flood3dHooks.ts` | `useHeightInUse(flood)`, `useDepthShown(flood)`, `depthOnScreen` (zustand), `useSatelliteOnScreen(flood) → SatelliteOnScreen { sat, has, noView, arr, imageOnly, note }`, `useProductsOnScreen(flood) → { alerts, zones } \| null` |
| `scene/flood/flood3dCopy.ts` | `FLOOD_3D` (every new string), `HAND_LABEL_FALLBACK`, `DEPTH_LABEL_FALLBACK`; under the flood wording guard |
| `scene/flood/floodAssets.ts` | `FloodSceneAssets` gains `textures.hand`, `has.{hand, depthSatellite, depthForecast}`, `arrays.{hand, depthSatellite, depthForecast}`, `terrain3d`, `boost: AutoBoost`, `river: RiverReach \| null`, `bundleTimeline` |
| `scene/flood/FloodFx.tsx` | `HeightBoost` (layout effect), `PassDrapeDriver`, `DepthSurface`; `WarningLines` draw `useProductsOnScreen`; `SatelliteEdge` follows the pass on screen |
| `scene/flood/floodProbe.ts` | `floodProbeRows` gains `depth?`, `satOnScreen?`, `products?`; rows `depth` (DEPTH) and `hand` (ABOVE RIVER) |
| `scene/terrain/terrainMaterial.ts`, `Terrain.tsx` | uniforms `uHand`, `uHasHand`, `uHandOpacity` (HAND bands) and `uSatImg`, `uHasSatImg`, `uSatImgU`, `uSatImgV` (a pass's picture); the satellite drape swaps per frame from `passDrapeGpu` |
| `scene/camera/CameraRig.tsx` | river view on open (3D), on the hand-off when the map was wider, on `'frame-river'` |
| `scene/sceneStore.ts` | `CameraCommandKind` gains `'frame-river'` (additive) |
| `scene/overlays/SceneOverlays.tsx`, `overlays.css` | the dock's height select for a flood (`.sc-height`), kept on phones; hover readout inputs |
| `ui/forensic-flood/forensicFloodState.ts` | layers `depth` (on, 0.85) and `hand` (off, 0.8); `boost: { floodId, factor } \| null`, `setBoost(floodId, factor \| null)`; `depthFrom: 'satellite' \| 'forecast' \| null`, `setDepthFrom` |
| `ui/forensic-flood/floodForensicView.ts` | `LAYER_STATUS_KEY.depth/hand = null`; `layerUnavailable('hand' \| 'depth')`; `KeySwatch` + `'height' \| 'depth' \| 'hand'`; `sceneKeyItems({ …, height?, depth?, satNote? })` |
| `ui/forensic-flood/FloodLayersTab.tsx`, `FloodForensic.tsx`, `styles/forensic-flood.css` | group "From the terrain" (depth legend, "Depth of" Satellite water / NWS forecast area, HAND bands), key items, "River view" entry control (phones: "River") |

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
  `caveat`, `method`, `citation`. With none: the reason (backend `reason`, `depthNoPass`, `depthNoView`,
  `depthNoImageYet`, `depthNoTerrain3d`), never an empty surface. Hover: "About 1.2 m deep here (estimated …)" inside
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
  `flyTo.distance` is more than 1.25 × the river view's (a closer map view keeps its place). "Frame flood" still fits
  the whole flood. No river line → the old framing.
- **Drapes follow the handle (M4).** Before now: `passAt(route passes)` (the bundle's frozen passes when the route's
  are unavailable): the bundle's shown pass → its own layers; a kept pass → `water_pass_<key>` and `depth_pass_<key>`
  (loaded on demand); else its 2D picture (`image.url`, `bounds_lonlat`, an affine map in the terrain shader), with no
  depth surface and the key saying so; before the first pass → nothing, "No satellite image at or before this time…".
  A no-view pass is never drawn (passAt skips it; the gap words come from `gapNote`). The key's satellite line, the
  Layers tab date, the image edge and the hover's SATELLITE row follow the pass on screen. NWS warning lines and the
  hover's NWS rows use `productsAt` (time history before now, the bundle's copy at and after now). Nothing animates
  between passes; Play / step are the chart's (no autoplay; reduced motion stands still).

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
| `layerDepth` / `layerDepthTip` | Water depth (estimated) / Estimated from the terrain at the water's edge (FwDET), inside the mapped water only. Experimental: errors of a metre or more are common |
| `depthOfSatellite` / `depthOfForecast` | Of the satellite water seen {date} / Of the NWS forecast flooded area issued {date} |
| `depthNoPass` | No depth surface for this satellite pass: its depth estimate is not in the 3D data. The water it saw is drawn flat. |
| `depthNoView` | No depth surface for this satellite pass: it had no view of this area (clouds or no data). That is not an all-clear. |
| `depthNoImageYet` | No depth surface: no satellite image at or before this time. That is not an all-clear. |
| `depthNoTerrain3d` | This flood's 3D data was prepared before depth estimates were added: prepare it again for a depth surface. |
| `layerHand` / `layerHandTip` | Height above the river / Height of the ground above the nearest river channel, from the terrain. Not a flood map. Experimental |
| `handBand1..3`, `handLegend` | 0–1 m, 1–2 m, 2–5 m, above the nearest river channel |
| `groupTerrain3d` | From the terrain |
| `riverView` / `riverViewShort` / `riverViewTip` | River view / River / A lower, closer look along the main river |
| `probeDepth`, `probeDepthAt`, `probeDepthTop` | DEPTH; About {m} m deep here (estimated from the terrain at the water's edge; experimental, often off by a metre or more).; More than 25 m deep here by the estimate (from the terrain at the water's edge; experimental). |
| `probeHand`, `probeHandAt`, `probeHandTop`, `probeHandFar` | ABOVE RIVER; The ground here is about {m} m above the nearest river channel (from terrain). Not a flood map.; … more than 25 m …; More than 10 km from a mapped river channel: not measured. Not a flood map. |
| `probeSatImageOnly` | The pass of {date} is shown here as its picture only (its cells are not in the 3D data), so this spot is not read here. Not an all-clear. |

Also changed: `FLOOD_FORENSIC.layersFoot` "FEMA, NWS category maps, the model and the height above the river start off".

## Outside the role's folders (declared)

- `scene/sceneStore.ts`: the additive `'frame-river'` command kind. `ui/shell/handoff.ts` was not changed: a
  `'frame-river'` command counts as a user turn there (not in `NON_TURNING`), so the map takes the river view's heading
  back only after the user pressed "River view"; the initial river view is not a command and leaves the map's heading
  alone.
- `scene/overlays/SceneOverlays.tsx` + `overlays.css`, `scene/terrain/*`, `scene/camera/CameraRig.tsx`: flood-only
  branches; the fire view is unchanged (0.11 % of pixels differ below the top bar from
  brief5-final-fire-forensic-fixture-live.png, labels only).
