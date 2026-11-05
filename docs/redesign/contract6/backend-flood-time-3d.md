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

`fixture-flood` answers `/timeline` from its bundle: one simulated pass (its `water_satellite` layer, the frozen
`satellite.png` URL) and its frozen products, `synthetic: true`, `PASSES_SYNTHETIC` in `passes.caveats`.

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
}
export interface FloodPassHistory {
  status: OfficialStatus; reason_code: SatelliteReasonCode; reason: string | null
  login: SatelliteLogin; login_note: string | null; source: OfficialSource; retrieved_ms: number | null
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
  as water. `view: 'unknown'` (not read yet): `complete: false` while reads are still running; ask again (e.g. with
  `wait=0` every few seconds) until `complete: true`. `PASSES_PARTIAL` is in `caveats` while any pass is unknown.
- `shown_key` = the pass the satellite layer shows (the satellite route's own answer when it has one, the bundle's
  `satellite.json`, else the newest pass that saw ≥ 50 % clearly, else the clearest). It can be a no-view pass when the
  satellite step itself chose one (seen 2026-11-05 on the Grand River flood: 7 % cloud, 93 % no data).
- PNG: same palette as `satellite.png` (water `#2a8ce6` α .55, partial `#7fd4ff` α .35, no-view grey hatched, never
  transparent; outside the pass transparent). `bounds_lonlat` is the pass's footprint inside the area.
- **Products:** every version of every event of the flood (live CAP copies + IEM archive). Draw a version from
  `shown_from_ms` (its issue time) until `shown_until_ms` (exclusive; null = still open). CAN / UPG versions have
  `shown_from_ms == shown_until_ms` (the event ends there). `archived: true` = IEM copy (credit `archive_source`),
  `false` = NWS's live CAP copy. Zone-based versions have `geometry: null`; their outlines are in `zones` by
  `alert_ids`. Every version is verbatim official text: render it inside `data-verbatim` with its `sender_name`, its
  own times and its `url`.
- **Bundle (`timeline.json`):** `passes.stats_over: 'bundle_grid'`, `image: null` on every pass; the 8 newest usable
  passes have `layer` = `water_pass_<key>` (uint8 DSWx classes on the render grid, 255 outside the pass, same encoding
  as `water_satellite`). Older or later-read passes have `layer: null` (`PASSES_BUNDLE_LIMIT` in caveats).

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
| `PASSES_SYNTHETIC` | Synthetic test data: one simulated satellite pass, not a NASA image. |
| `PRODUCTS_NOTE` | Each NWS product is shown from the time NWS issued it until its own end time or NWS's next version of it. An NWS end time is not a forecast of when flooding stops. |
| `PRODUCTS_ARCHIVE_DOWN` | Earlier versions of this flood's NWS products (Iowa Environmental Mesonet archive) could not be loaded right now; only the products NWS lists now are shown. That is not an all-clear. |
| `PRODUCTS_ARCHIVE_PARTIAL` | Earlier versions of some of this flood's NWS products could not be loaded right now. That is not an all-clear. |
| `PRODUCTS_NONE` | This flood has no NWS flood product (it is listed from a river gauge at flood stage). That is not an all-clear: follow local officials. |
| `PRODUCTS_TRUNCATED` | This flood has more NWS product versions than Disaster Mapping lists; the oldest ones are left out. |

Reused from `floods/copy.py`: `SAT_CAVEAT` (per pass), `SAT_NOT_SET_UP`, `SAT_LOGIN_REFUSED`, `SAT_UNAVAILABLE`,
`ALERTS_UNAVAILABLE`, `SATELLITE_IMAGE_GONE`; `history.PAST_ALERTS_DOWN`.

### Outside my files (declared)

- `backend/scripts/check_bundle.py`: `flood_layer_spec()` accepts `water_pass_<key>` (DSWx classes) and the M2 layers
  `hand`, `depth_satellite`, `depth_forecast` (uint8), and validates `timeline.json` against `FloodTimelineResponse`.
  Additive; without it the bundle check (and `test_floods_live`) rejected the new layers.

## M2 · 3D terrain products

(in progress)
