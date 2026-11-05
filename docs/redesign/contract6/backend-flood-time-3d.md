# Brief 6 · backend-flood-time-3d · as built

Contract triple: `backend/fire3d/contracts.py`, `web/src/api/floodTypes.ts` (re-exported by `types.ts`), SPEC.md
(§5.3 bundle files, §5.4 3D terrain products, §6 routes, §8.11 time history). `backend/tests/test_flood_contracts.py`
checks field names, optionality and every literal union of the new types. Strings: `backend/fire3d/floods/copy_time.py`
(wording guard: `tests/test_floods_timeline.py`).

## M1 · a flood's time history

### Routes

| Method | Path | Answer |
|---|---|---|
| GET | `/api/floods/{id}/timeline?wait=0..30` | `FloodTimelineResponse` (default `wait` 20 s) |
| GET | `/api/floods/{id}/passes/{key}.png?area=<8 hex>` | `image/png` of one pass (`FloodPass.image.url`); 404 `SATELLITE_IMAGE_GONE` |

`fixture-flood` answers `/timeline` from its bundle (`synthetic: true`, `PASSES_SYNTHETIC` in `passes.caveats`): after
`uv run python scripts/flood_3d.py fixture-flood` (run it after every `make_fixture.py --only flood`, which writes the
fixture without brief 6's products) **four simulated passes** (review BTD-R9), oldest first: `DSWx-HLS_<t-9d>_L8`
clear (the river before the flood), `DSWx-HLS_<t-7d>_S2A` no view (all cloud; no image, no layer), a five-day gap,
`DSWx-HLS_<t-2d>_L9` partly hidden (a cloud bank over the east 65 %), `DSWx-HLS_<t>_S2B` the fixture's own image
(`shown_key`); each usable one with `layer` / `depth_layer` rasters in the bundle and a 2D image served by
`GET /api/floods/fixture-flood/passes/<key>.png?area=<any 8 hex>` from the bundle's `passes/` folder. Without the
script: one simulated pass (its `water_satellite` layer, the frozen `satellite.png` URL).

### Shapes (TypeScript; Python mirrors have the same names)

```ts
export type PassView = 'clear' | 'partly_hidden' | 'no_view' | 'unknown'
export type PassStatsOver = 'map_area' | 'bundle_grid'
export interface FloodPassImage { url: string; bounds_lonlat: [number, number, number, number] }
export interface FloodPass {
  key: string; product: 'DSWx-HLS' | 'DSWx-S1'; platform: string | null; acquired_ms: number
  route: 'earthdata_gis' | 'podaac'; granules: string[]; url: string | null
  view: PassView; usable: boolean                    // usable = clear | partly_hidden
  clear_pct: number | null; cloud_pct: number | null; nodata_pct: number | null
  water_km2: number | null; partial_km2: number | null
  image: FloodPassImage | null                       // route answers, usable passes only
  layer: string | null                               // bundle: manifest.layers key ("water_pass_<key>")
  caveat: string | null                              // SAT_CAVEAT of this pass | PASS_NO_VIEW | null (unknown)
  depth_layer?: string | null                        // review BTD-R3: bundle: "depth_pass_<key>" (FwDET of this pass)
}
export interface FloodPassHistory {
  status: OfficialStatus; reason_code: SatelliteReasonCode; reason: string | null
  login: SatelliteLogin; login_note: string | null; source: OfficialSource; retrieved_ms: number | null
  sources?: OfficialSource[] | null                  // review BTD-R8: one per (product, route) listed; credit each
  start_ms: number; end_ms: number; complete: boolean; truncated: boolean; stats_over: PassStatsOver
  passes: FloodPass[]                                // OLDEST FIRST
  shown_key: string | null; caveats: string[]        // PASSES_NOTE always first
}
export interface FloodTimelineProduct extends FloodAlert {
  vtec_key: string | null; replaced_ms: number | null; shown_from_ms: number | null; shown_until_ms: number | null
}
export interface FloodProductHistory extends FloodEnvelope {
  kind: 'flood_alerts'; products: FloodTimelineProduct[] // OLDEST FIRST
  zones: FeatureCollectionJson<{ ugc: string; name: string; alert_ids: string[] }>
  archive_source: OfficialSource | null; complete: boolean
}
export interface FloodTimelineResponse {
  kind: 'flood_timeline'; flood_id: string; now_ms: number; start_ms: number; end_ms: number
  passes: FloodPassHistory; products: FloodProductHistory; synthetic: boolean
}
// FloodManifest.files.timeline?: string | null ("timeline.json"); files.maps.flowlines (M2)
```

### Rules the web can rely on

- **Pass keys** are URL-safe (`DSWx-HLS_20261029T1756_L9`); tiles of one overpass sensed up to 10 min apart are one
  pass. `acquired_ms` is the image time (the web computes the age at render time; no backend string carries an age).
- **Nothing between passes:** the backend never fills a gap. `PASSES_NOTE` says so; gap wording ("No satellite image
  between Oct 29 and Nov 3") is web-flood-playback's.
- `view: 'no_view'` passes are listed (with `PASS_NO_VIEW`, `image: null`, `usable: false`) and must never be drawn
  as water; no PNG is made for them (the PNG route answers 404; review BTD-R13). `view: 'unknown'` (not read yet):
  `complete: false` while reads are still running; ask again (e.g. with `wait=0` every few seconds) until
  `complete: true`. `PASSES_PARTIAL` is in the route's `caveats` while any pass is unknown. In the bundle's frozen
  `timeline.json` an unknown pass was not read for the 3D data (beyond the 24 newest, or NASA unreachable at build):
  `PASSES_BUNDLE_UNREAD`, `complete` stays true, nothing asks again (review BTD-R5).
- **Window:** the start is rounded down to midnight UTC and the route takes the earlier of the live start and the
  ready bundle's frozen start, so Command and Forensic list the same passes (review BTD-R10).
- **Credits:** `sources` lists every OPERA product and route among the passes (DSWx-S1 radar and PO.DAAC only with
  `EARTHDATA_TOKEN`); show each credit line. `source` stays the first of them.
- `shown_key` = the pass the satellite layer shows (the satellite route's own answer when it has one, the bundle's
  `satellite.json`, else the newest pass that saw ≥ 50 % clearly, else the clearest). It can be a no-view pass when the
  satellite step itself chose one (seen 2026-11-05 on the Grand River flood: 7 % cloud, 93 % no data).
- PNG: same palette as `satellite.png` (water `#2a8ce6` α .55, partial `#7fd4ff` α .35, no-view grey hatched, never
  transparent; outside the pass transparent). `bounds_lonlat` is the pass's footprint inside the area.
- **Products:** every version of every event of the flood (live CAP copies + IEM archive; at most 20 events, the
  newest kept, `PRODUCTS_EVENTS_TRUNCATED`). Draw a version from `shown_from_ms` (its issue time) until
  `shown_until_ms` (exclusive; null = still open) at the playback time; `phase` is its state **now** (recomputed
  whenever an answer is served, also from a cache or the frozen bundle; review BTD-R6). The products block is made for
  every answer from a cache of at most 2 min (the NWS alerts cache), so a new warning appears here as soon as in
  "Official now"; only the passes block is kept 10 min. An open flood whose live NWS feed could not be read:
  archived copies only, `PRODUCTS_LIVE_DOWN` in `caveats` and `complete: false` (ask again; review BTD-R1). CAN / UPG versions have
  `shown_from_ms == shown_until_ms` (the event ends there). `archived: true` = IEM copy (credit `archive_source`),
  `false` = NWS's live CAP copy. Zone-based versions have `geometry: null`; their outlines are in `zones` by
  `alert_ids`. Every version is verbatim official text: render it inside `data-verbatim` with its `sender_name`, its
  own times and its `url`.
- **Bundle (`timeline.json`):** `passes.stats_over: 'bundle_grid'`, `image: null` on every pass; the 8 newest usable
  passes have `layer` = `water_pass_<key>` (uint8 DSWx classes on the render grid, 255 outside the pass, same encoding
  as `water_satellite`) and `depth_layer` = `depth_pass_<key>` (their own FwDET depth; FloodTerrain3d encoding; null
  when the pass maps no water or its water has no edge on open ground). Older or later-read passes have `layer: null`
  (`PASSES_BUNDLE_LIMIT` in caveats).
- **Which source Forensic uses (review BTD-R2):** the **pass list and the NWS products from `GET /timeline`** (live:
  the live loop appends new NWS versions to `warnings.json` only, so the bundle's products are a frozen record), and
  **only the pass rasters from the bundle**, joined by `key` (`timeline.json` `passes[].layer` / `depth_layer`). A pass
  of the route without a bundle raster (older than the 8 kept, or newer than the build): drape the route's PNG
  (`image.url`, `image.bounds_lonlat`) and say that no depth surface is shown for it (never an empty surface). When
  the route's passes are `unavailable`, `timeline.json`'s passes (frozen, each with its own time) may stand in.
- **A rebuild never loses the time history (review BTD-R2):** when NASA cannot be reached the earlier bundle's pass
  list and rasters are kept; every earlier NWS version is kept; NOAA's river lines too (manifest warning
  `REBUILD_KEPT`). After a refresh puts an earlier water layer back, the 3D terrain products are made again
  (`terrain3d.after_refresh`), so `depth_satellite` always belongs to the `water_satellite` shown.

### Strings (exact; `copy_time.py`)

| Name | Text |
|---|---|
| `PASS_NO_VIEW` | No view of this area on this pass (clouds or no data): it shows nothing about the water here. That is not an all-clear. |
| `PASSES_NOTE` | Each satellite image shows the water on its own date only. Nothing is drawn between two passes: the days between passes are not seen. |
| `PASSES_NONE` | NASA has no satellite water pass over this area between {start} and {end}. That is not an all-clear. |
| `PASSES_UNAVAILABLE` | Satellite water passes could not be loaded right now. That is not an all-clear. |
| `PASSES_PARTIAL` | Some satellite passes could not be read yet; their view is shown as unknown. Ask again in a minute. |
| `PASSES_TRUNCATED` | This flood has more satellite passes than Disaster Mapping lists; the oldest ones are left out. |
| `PASSES_BUNDLE_LIMIT` | The 3D data keeps the images of the {n} newest passes that saw this area; older passes are listed without an image here. |
| `PASSES_BEFORE_ARCHIVE` | NASA's satellite water images start in 2023; none exists for this flood's dates. |
| `PASSES_SYNTHETIC` | Synthetic test data: simulated satellite passes, not NASA images. |
| `PASSES_BUNDLE_UNREAD` | Some satellite passes were not read for the 3D data (too many passes, or NASA could not be reached when it was prepared); their view is shown as unknown here. That is not an all-clear. |
| `PRODUCTS_NOTE` | Each NWS product is shown from the time NWS issued it until its own end time or NWS's next version of it. An NWS end time is not a forecast of when flooding stops. |
| `PRODUCTS_ARCHIVE_DOWN` | Earlier versions of this flood's NWS products (Iowa Environmental Mesonet archive) could not be loaded right now; only the products NWS lists now are shown. That is not an all-clear. |
| `PRODUCTS_ARCHIVE_PARTIAL` | Earlier versions of some of this flood's NWS products could not be loaded right now. That is not an all-clear. |
| `PRODUCTS_NONE` | This flood has no NWS flood product (it is listed from a river gauge at flood stage). That is not an all-clear: follow local officials. |
| `PRODUCTS_TRUNCATED` | This flood has more NWS product versions than Disaster Mapping lists; the oldest ones are left out. |
| `PRODUCTS_EVENTS_TRUNCATED` | This flood has more NWS product events than Disaster Mapping lists; the oldest events are left out. |
| `PRODUCTS_LIVE_DOWN` | NWS's current flood products could not be loaded right now; only archived copies are shown and the newest may be missing. That is not an all-clear. |

Reused from `floods/copy.py`: `SAT_CAVEAT` (per pass), `SAT_NOT_SET_UP`, `SAT_LOGIN_REFUSED`, `SAT_UNAVAILABLE`,
`ALERTS_UNAVAILABLE`, `SATELLITE_IMAGE_GONE`; `history.PAST_ALERTS_DOWN`.

### Outside my files (declared)

- `backend/scripts/check_bundle.py`: `flood_layer_spec()` accepts `water_pass_<key>` (DSWx classes) and the M2 layers
  `hand`, `depth_satellite`, `depth_forecast`, `depth_pass_<key>` (uint8), validates `timeline.json` against
  `FloodTimelineResponse` and checks each pass's `layer` / `depth_layer` exists. Additive; without it the bundle check
  (and `test_floods_live`) rejected the new layers.
- `backend/fire3d/floods/live.py` (no brief-6 owner; review BTD-R2): one call at the end of the layer loop of
  `keep_what_the_rebuild_lost`, `terrain3d.after_refresh(bdir, m, kept, now=now)`, which makes the 3D terrain
  products again when the refresh put `water_satellite` or `water_forecast` back. Everything else of the fix is in my
  files (`floods/build.py` keeps the passes, products and river lines at rebuild time; `floods/terrain3d.py`).
  `tests/test_floods_live.py::test_refresh_keeps_layers_the_rebuild_could_not_load` covers it (fails without the call).

## M2 · 3D terrain products

`manifest.terrain3d` (absent in brief-5 bundles; `scripts/flood_3d.py <id>...` adds it, and the M1 timeline, to an
existing bundle; done on disk 2026-11-05 for `fixture-flood`, Calcasieu River and St Johns River). Module:
`backend/fire3d/floods/terrain3d.py`. SPEC §5.4 has the method and its limits.

```ts
export type TerrainProductKind = 'hand' | 'depth'
export interface FloodRelief {
  area: 'water' | 'grid'; area_note: string; cells: number
  min_m: number; max_m: number; p05_m: number; p95_m: number; range_m: number; width_m: number
  exaggeration: number                 // 1.5 | 2 | 3 | 5 | 8 | 10: the default height boost ("Height ×10")
  rule: string                         // RELIEF_RULE
  target_reached?: boolean | null      // review BTD-R4: false when even ×10 leaves the middle 90% under 2% of the
                                       // width (every flat flood measured): suggest a larger boost or the closer view
}
export interface FloodTerrainStats { cells: number; area_km2: number; p50_m: number; p90_m: number; max_m: number }
export interface FloodTerrainProduct {
  key: string                          // "hand" | "depth_satellite" | "depth_forecast"
  kind: TerrainProductKind; layer: string | null; status: LayerState; reason: string | null
  label: string; caveat: string; method: string; citation: string
  source_layer: string | null; source: string; time_ms: number | null; stats: FloodTerrainStats | null
}
export interface FloodTerrain3d {
  version: 1; relief: FloodRelief | null; hand: FloodTerrainProduct
  depth: FloodTerrainProduct[]         // [depth_satellite, depth_forecast], always both, in that order
  scale_m: number; top_code: number; nodata: number   // 0.1, 254, 255
  built_ms: number
}
// FloodManifest.terrain3d?: FloodTerrain3d | null; FloodManifest.files.maps.flowlines = "maps/flowlines.geojson"
```

### Rasters (for web-forensic-flood-3d)

- `layers/hand.bin`, `layers/depth_satellite.bin`, `layers/depth_forecast.bin`: **uint8**, 1024 × 1024 render grid,
  row 0 north (same layout as `water_satellite.bin`). Metres = value × 0.1; 254 = 25.4 m or more; **255 = no value**
  (outside the mapped water for depth; more than 10 km from a channel for HAND). `LayerInfo.units` = "0.1 m",
  `nodata` = 255, `min` / `max` exclude 255.
- **Depth is only inside the mapped water.** `depth_satellite` belongs to the pass in `water_satellite.bin`
  (`timeline.passes.shown_key` in the bundle); each kept pass has its own `depth_pass_<key>` (`FloodPass.depth_layer`;
  review BTD-R3): while stepping, show the surface of the pass on screen; a pass with `depth_layer` null (or without a
  bundle raster) shows no depth surface, and the view says so (never an empty surface, never "the water is gone").
  Say "Estimated depth …" with `label` and `caveat`.
- **HAND** (`label` "Height above the river (from terrain). Not a flood map") is off by default; `caveat` always with
  it. An empty or shallow tint is never an all-clear.
- **Height boost:** `relief.exaggeration` is the default factor; the user can change it; always show it.
- Water surface for drawing: surface = terrain + depth (inside the water only).
- **Closer framing:** not a backend product; the river lines (`maps/flowlines.geojson`, `strm_order`, `name`) and the
  member gauges give the main river's course if the camera needs it.

### Strings (exact; `copy_time.py`)

| Name | Text |
|---|---|
| `RELIEF_RULE` | Height boost: the smallest of ×1.5, ×2, ×3, ×5, ×8 and ×10 that makes the middle 90% of the ground heights near the mapped water (5th to 95th percentile) span at least 2% of the area's width; ×1.5 when the ground is already steep enough. At most ×10, so a very flat floodplain can still look flat at the default: raise the boost or look from closer. Only heights are boosted, never distances. |
| `RELIEF_AREA_WATER` | ground within {km} km of the mapped water (satellite water and the NWS forecast flooded area) |
| `RELIEF_AREA_GRID` | the whole 3D area (no mapped water to measure around) |
| `HAND_LABEL` | Height above the river (from terrain). Not a flood map |
| `HAND_CAVEAT` | Height of the ground above the nearest river channel, from the terrain model and NOAA's river lines. It is not a flood map: low ground is not always flooded, and higher ground can flood (rain, small streams, drains). Experimental. Not an all-clear. |
| `HAND_METHOD` | NOAA National Water Model river lines (stream order {order} and up) are drawn on the terrain grid. Each channel cell takes the lowest terrain height within one cell of it; every other cell takes the height of its nearest channel cell in a straight line and shows how far above it the ground is (below it counts as 0). Cells more than {km} km from a channel are left out. Simplified from Height Above the Nearest Drainage (Nobre et al., 2011), which follows the downhill flow path instead: near a ridge between two valleys a cell can be measured against the other valley. |
| `HAND_NO_LINES` | Height above the river is not available: NOAA's river lines could not be loaded for this area. |
| `HAND_NO_CHANNEL` | Height above the river is not available: NOAA lists no river line in this area. |
| `HAND_SOURCE` | Terrain (USGS 3DEP) and river lines (NOAA National Water Model) |
| `HAND_CITATION` | Nobre, A. D., et al. (2011). Height Above the Nearest Drainage, a hydrologically relevant new terrain model. Journal of Hydrology 404(1-2), 13-29. |
| `DEPTH_LABEL` | Estimated depth (from the terrain at the water's edge), experimental |
| `DEPTH_CAVEAT` | Estimated depth inside the mapped water only: the water surface is taken from the terrain height along the water's edge and the ground is subtracted (the published FwDET method, Cohen et al.). Experimental: errors of a metre or more are common, most where the edge runs up a steep bank or the map and the terrain do not line up. The terrain model shows the river's normal water surface, not its bed, so depth in the normal channel is not measured. Shallow water here is not an all-clear. Follow local officials. |
| `DEPTH_METHOD` | Cells of the mapped water next to open ground are its edge (edges against clouds, no data, ocean or the area's border are not used). Each water cell takes the terrain height of its nearest edge cell as the water surface; depth = water surface − terrain, below 0 counts as 0, then a 3 × 3 average over the water smooths it (FwDET v2.0). Only cells inside the mapped water get a depth. |
| `DEPTH_CITATION` | Cohen, S., et al. (2018). Estimating Floodwater Depths from Flood Inundation Maps and Topography. JAWRA 54(4), 847-858, doi:10.1111/1752-1688.12609. Cohen, S., et al. (2019). The Floodwater Depth Estimation Tool (FwDET v2.0) for improved remote sensing analysis of coastal flooding. NHESS 19, 2053-2065, doi:10.5194/nhess-19-2053-2019. |
| `DEPTH_SOURCE_SATELLITE` | Water seen by satellite (NASA OPERA), image of {date_time} |
| `DEPTH_SOURCE_FORECAST` | NWS forecast flooded area (next 5 days, experimental), forecast of {date_time} |
| `DEPTH_NO_LAYER` | No depth estimate: this water layer is not in the 3D data. |
| `DEPTH_NO_WATER` | No depth estimate: this layer maps no water in this area. That is not an all-clear. |
| `DEPTH_NO_EDGE` | No depth estimate: the mapped water has no edge on open ground here (it meets clouds, no data or the area's border everywhere). |

### Bundle build

Steps and weights: catalog 0.05, terrain 0.25, maps 0.15, gauges 0.15, satellite 0.15, timeline 0.15, terrain3d 0.05,
finish 0.05. River lines come from one more request in the parallel maps step (`water_maps.flowlines`, NOAA/NWS
National Water Center, credited). A failed terrain3d step leaves `terrain3d` null and the bundle `ready`.

### For other roles

- **make_fixture.py owner (not mine):** to give a freshly generated `fixture-flood` its terrain products, run
  `uv run python scripts/flood_3d.py fixture-flood` after `make_fixture.py --only flood`, or add at the end of
  `build_flood_fixture` a call of `flood_3d.add_terrain3d(bdir, manifest, grid, flowlines=fixture_flowlines(grid),
  flow_reason=None, now=now)` and write the manifest. The committed web fixture copy
  (`web/src/api/__fixtures__/floods/`) has no canned terrain3d or timeline answer; the real API serves
  `/api/floods/fixture-flood/timeline` from the fixture bundle.
