# As built: backend-flood-bundle-api (brief 5)

Role `backend-flood-bundle-api` (PLAN-5 §10.1). Milestones M1 sources, M2 bundle, M3 routes, on branch
`claude/cool-mayer-ki7to6`. This note lists the real names, signatures and routes, and every deviation from CONTRACT §16
(the integration folds it into §16.16). No contract type changed: every answer uses the §16.2-16.6 models as
`backend-flood-sources` wrote them (the parity test is unchanged).

## Sources (M1)

- `sources/water_maps.py` (maps.water.noaa.gov; `NOAA_WATER_LIMITER` 30/min, outage memory `MAPS_DOWN`):
  `arcgis_query(layer_url, params, *, ttl_s, limiter, name, down, host, order_by="oid", ...) -> (features, fetched_ms)`
  (paged GeoJSON; an ArcGIS `{"error": …}` with HTTP 200 is a `SourceError` and never cached; the returned list has
  `.truncated` when the service had more than 10 pages), `query_params(bbox, *, where, out_fields, geometry,
  simplify_deg)`, `esri_time_ms(v)` (UTC strings, "... UTC", "+00", epoch ms), `rfc_fim(bbox) -> MapLayer`,
  `rfc_reaches(bbox) -> (list[Reach], fetched)` (layer 3, no geometry), `parse_reach(feature) -> Reach(feature_id,
  station, forecast_lids, status)`, `member_reaches(reaches, member_lids) -> set[str]` (the reach's own
  `nws_station_id`, or a forecast point named in `influential_forecasts` "… at AGYM7 (2529595 [order 5]) …"),
  `member_area_km2(features, member_fids) -> float | None`, `safe_union(geoms)` (repairs GEOS topology errors in
  simplified service polygons), `catfim(lid, category, bbox=None) -> MapLayer` (layers action 3, minor 6, moderate 9,
  major 12, record 13; `ahps_lid` lower case), `nwm_layer(kind, bbox)` (`nwm_analysis`, `nwm_5day`, `nwm_high_flow`;
  `recur_cat` verbatim), `flowlines(bbox, min_order)`, `MapLayer(features, reference_ms, updated_ms, fetched_ms, extra)`.
- `sources/nfhl.py` (hazards.fema.gov; 4 tries, 30-day cache, `NFHL_DOWN` memory): `zones(bbox)` (layer 28 with
  `SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2%'`; `parse_zone` drops anything else, never zone X "minimal"),
  `zone_code(props)` (1 band, 2 SFHA, 3 floodway, 0 not shown), `availability(bbox) -> ("mapped" | "no_digital_map" |
  "unknown", fetched)` (layer 0; `mapped` only when the availability polygons cover ≥ 98 % of the area),
  `coverage(bbox) -> ("mapped" | "partial" | "none" | "unknown", fetched)` (review R7; `availability()` maps it to the
  contract values: partial → unknown, none → no_digital_map),
  `effective_dates(bbox) -> (min_ms, max_ms, fetched)` (layer 3 `EFF_DATE`), `nfhl(bbox) -> NfhlResult(features,
  availability, effective_min_ms, effective_max_ms, fetched_ms, notes)` (zones required; availability and dates fall
  back to `unknown` / null with a note; `notes`: "partly mapped" (measured), "availability unknown" (layer 0 not read
  or not joinable, or zones without an availability polygon), "effective dates unknown", "truncated").
- `sources/opera.py` (NASA): `egis_granules(bbox, end_ms, days=10, *, now_ms)` (Earthdata GIS catalog, `category=1`,
  footprints), `group_passes(granules) -> list[Pass]` (tiles of one pass: product, sensor, sensing minute),
  `egis_export(pass, bbox, w, h, sr=4326) -> np.ndarray` (locked `esriMosaicLockRaster`, `rasterFunction: None`, nearest,
  `noData=255`, 30-day cache), `cmr_granules(short_name, bbox, end_ms)` (no login), `podaac_download(granule) -> Path`
  (the token as `Authorization: Bearer` to `archive.podaac.earthdata.nasa.gov` only; 401 / 403, or a login page instead
  of a GeoTIFF → `LoginRefused` and `login_state()` "refused" for 10 min; files `CACHE_DIR/opera/<granule>_B01_WTR.tif`),
  `READER` (injectable; default `read_window(path, bounds, crs, w, h)` reprojects nearest, 255 outside),
  `podaac_pass(...)`, `s1_classes(arr)` (DSWx-S1: 0, 1, 2, 254, 255 kept; 3 inundated vegetation → 2; HAND / layover /
  shadow masks → 255), `gibs_dates(end_ms) -> (dates, fetched)` (the layer's dates worldwide), `gibs_latest(end_ms) ->
  (date, fetched)` (newest of them; no longer used by the flood answers, review R3), `utc_day(ms)`,
  `gibs_template(layer, date)`, `token()`,
  `login_state()`, `px_size(bbox, 30 m, max_px)`, `parse_name(name)` (image time from the granule name).
- `sources/usgs_water.py` (USGS v1, no key): `continuous(site, parameter, start_ms, end_ms) -> UsgsSeries` (paged by the
  `next` link; 429 → `UsgsBusy` with `USGS_429` and a 10-min hold), `observed_series(site, start, end) -> {observed,
  stage_unit, flow_unit, provisional, fetched_ms}`, `site_id(v)`. **Not yet used by a route** (past gauge readings are
  backend-flood-live M2's; the module is ready for it).
- `sources/nwps.py` (additive): `riv_gauges_forecast_in_bbox(bbox)` (layer 15 envelope: which nearby gauges are
  forecast points).
- Recorder `scripts/record_test_samples_flood_maps.py` (23 requests on 2026-11-05 ~00:10 UTC, gauge AGYM7 box
  `-94.80,39.62,-94.60,39.76`; `--days 20` for the Earthdata GIS catalog so a usable pass is recorded) → samples and
  `PROVENANCE.md` in `backend/tests/data/floods/{maps,nfhl,opera,usgs}/`.

## Bundle (M2) — `floods/build.py`, `floods/satellite.py`, `floods/maps.py`, `floods/zones.py`, `floods/gauges.py`

- `build.gate(flood_id) -> (summary, resolved_from)`; raises `BuildRefused(status, detail)`: 404
  `FLOOD_ROUTE_NOT_LISTED`, 409 `BUILD_SYNTHETIC` (`fixture-flood`), 409 `BUILD_OUTSIDE_L48`, 503 `FLOOD_LISTS_503`.
- `build.build_flood(flood_id, *, progress=None, force=False, now=None) -> manifest`: `flood_grid(summary)` (1024² UTM
  grid of `maps.flood_area(summary)`), DEM, NAIP (≤ 2048 px), RFC FIM, NFHL, CatFIM (primary gauge's forecast else
  observed category), NWM analysis, flood alerts, gauges with series, satellite, all in a 4-thread pool; `WEIGHTS`
  catalog 0.05 terrain 0.35 maps 0.20 gauges 0.15 satellite 0.20 finish 0.05 (`pipeline.BuildProgress`); terrain
  required (else `RuntimeError` with `TERRAIN_DOWN`, the earlier bundle kept); `.staging/` swapped in at the end,
  manifest last, `validate_strict(FloodManifest, …)`; `compact_fc(fc, grid)` for the bundle's GeoJSON copies;
  `rasterize(features, grid, value)`. `manifest.data_sources` (review R1): one `DataSource` per step that wrote a file
  or a layer, **named by its credit line** (the same text as that layer's `layer_status.source`), `detail` = what the
  bundle holds from it (absolute UTC times), `fetched_ms` = when it was fetched: `Terrain: USGS 3D Elevation Program
  (3DEP)`, `Aerial photo: USDA NAIP via USGS The National Map`, `NOAA/NWS National Water Center (experimental)` (RFC FIM;
  CatFIM when written), `Flood zones: FEMA National Flood Hazard Layer (effective)`, `NOAA/NWS National Water Center,
  National Water Model (experimental model output)` (analysis map; series), `National Weather Service`
  (warnings.json; plus `Boundaries: U.S. Census Bureau TIGERweb` when zones are drawn as counties), `NOAA National
  Water Prediction Service (NWS)` (gauges.json) plus each data attribution NWPS names ("Observations courtesy of U.S.
  Geological Survey", "Courtesy of FDEP", ...) and each RFC forecast's issuer (`copy.rfc_credit`), and the OPERA credit
  of `satellite.json` (route included). A gauge step that raises writes an unavailable `gauges.json`
  (`GAUGES_UNAVAILABLE`, `upstream_error`) and layer_status `unavailable` (review R2).
- `maps.flood_area(summary) -> FloodArea(center_lon, center_lat, extent_m, bbox, note)` (pad 3 km, 8-60 km, cut around
  the primary gauge else the point; note `AOI_CUT_NOTE`), `maps.default_catfim(summary)`, `maps.map_answer(kind,
  summary, *, now, lid, category, at_ms, area)`, `rfc_fim_answer`, `catfim_answer`, `nfhl_answer`,
  `maps.model_answer(kind, summary, *, now, lid, at_ms, area)` (`nwm_series`: NWPS gauge → `reachId` →
  analysis_assimilation, short_range, medium_range_blend; no gauge → `MODEL_NO_GAUGE`, a gauge without a reach →
  `MODEL_NO_REACH`). `catfim_answer`: nothing to map (no gauge with a flood category, an id or category the library
  cannot take) → `unavailable` / `not_covered` / `CATFIM_NOT_COVERED` with `coverage_note` `CATFIM_NOTE_ANY`;
  `CATFIM_UNAVAILABLE` only for `upstream_error` (review R4). `nfhl_answer`: `NFHL_PARTLY_MAPPED` only for measured
  partial coverage, else `NFHL_AVAILABILITY_UNKNOWN` (review R7).
- `satellite.flood_satellite(flood_id, bbox, *, now, time_zone, at_ms=None, grid=None) -> SatResult(answer, png,
  grid_classes, key)`; `choose_egis(passes, bbox, rejected=None)` (probe up to 4 newest passes at 160 px: the newest
  that saw ≥ 50 % of the area clearly, else the one that saw most; a pass that saw < 5 % is not usable and its key goes
  into `rejected`), `picture_days(bbox, ref, passes, rejected) -> (days, cmr_ok)` (review R3: UTC days of DSWx-HLS
  passes that touch the area, from the Earthdata GIS catalog rows and NASA's CMR search, no login; never a rejected
  pass), `palette_rgba(cls, outside)`,
  `stats_of(cls, bbox)`, `date_time_text(ms, tz)`, `cached_answer(...)` (routes: 30 min in memory, PNG in
  `CACHE_DIR/floods/satellite/<id>/<pass key>.png`).
- `zones.flood_alerts(summary, *, now, at_ms)`, `zones.bbox_alerts(bbox, *, now, at_ms)`, `zones.zone_features(alerts)`
  (`ZONE_FETCH_MAX` 20, then counties), `HVTEC_FETCH_MAX` 6 product texts per flood answer.
- `gauges.flood_gauges(summary, *, now, with_series, include_nearby=True, at_ms)`, `gauges.bbox_gauges(bbox, *, now)`,
  `gauges.national_gauges(min, *, now)`, `gauges.lid_gauge(lid, *, now, with_series)` (LookupError → 404),
  `gauges.nearby(bbox, *, exclude, center)`, `gauges.riv_river_gauge(row, *, member, rfc_row, forecast_point)`,
  `gauges.nwps_river_gauge(lid, *, member, with_series, waterbody)`.
- `store.build_in_progress(flood_id)`; `store.bundle_state` now says `building` while the lock is held, and reads a
  stale "building" manifest as `error`.

## Routes (M2, M3) — all in `api/floods.py` except `hazard`

| Route | As built |
|---|---|
| `POST /api/floods/{id}/build?force=0\|1` | `JobStatus` (kind "build"); the running job when there is one; without `force` a ready bundle answers a job that finishes at once. 404 / 409 / 503 from `build.gate` (details in `copy.py`). |
| `GET /api/floods/{id}/files/{path}` | gzip except JPEG / PNG, weak ETag + 304, no-cache; `.geojson` → `application/geo+json`; dotfiles, `.staging/`, the lock and the fixture's `api/` are 404. |
| `GET /api/floods/{id}/maps?kind=&lid=&category=&at_ms=` | `FloodMapResponse` over the flood's area (its ready bundle's grid when there is one, else `flood_area`). |
| `GET /api/floods/{id}/model?kind=&lid=&at_ms=` | `ModelOutputResponse`; `nwm_series` defaults to the primary gauge. |
| `GET /api/floods/{id}/satellite?at_ms=` | `SatelliteWaterResponse`. Only in an outage (status `unavailable`, or the picture fallback with `reason_code` `upstream_error`) and only without `at_ms`, a ready bundle's frozen measured answer is served (absolute times; login fields of now; `SAT_SAVED_COPY` appended to `caveats`, `caveats[0]` stays the image's own caveat). A `no_image` answer is served as NASA gave it, never replaced by an older saved image (review R8). |
| `GET /api/floods/{id}/satellite.png?granule=<pass key>` | the route cache's PNG, else the bundle's (when the key or a granule id matches), else recomputed; 404 `SATELLITE_IMAGE_GONE`. |
| `GET /api/official/flood-alerts?flood=\|bbox=&at_ms=` | `FloodAlertsResponse`; `bbox` with w = e and s = n is a point (`covers_point`); max 4° box; 422 without a scope. |
| `GET /api/official/river-gauges?flood=\|lid=\|scope=national\|bbox=&min=&series=&at_ms=` | priority flood, lid, scope, bbox; 422 without one; 404 unknown lid; `ZZ…` lids from synthetic bundles. `retrieved_ms` is when NOAA sent the oldest part of the answer (cached copies keep their time; `gauges.nwps_river_gauge_fetched`), never simply now. `?lid=` fills `waterbody` from one small `riv_gauges` envelope around the gauge (`gauges.waterbody_of`, ±1 km, cached 5 min; null when it cannot be read) (review R10). |
| `GET /api/official/local-alerts?bbox=&hazard=flood` | `official._flood_local_alerts`: `NationalAnswer.local_flood` now, `past_local(..., hazard="flood")` up to 7 days back, FEMA archive `not_checked`; `incident` with `hazard=flood` is 400. |
| `GET /api/extras/evacuations?bbox=&hazard=flood` | `extras.evacuations_payload(ctx, hazard)`; `FIRE_ONLY_FEEDS = {"or_oem_evacuations"}`: never asked for floods; its state `availability: "not_available"`, `checked: false`, `note: OR_EVAC_FIRE_ONLY`; its source entry `unavailable` with `OR_EVAC_FIRE_ONLY`; an Oregon-only area answers `unavailable` / `state_not_available` / `OR_EVAC_FIRE_ONLY`; a mixed area adds the caveat. `hazard=fire` (default) takes the unchanged code path. |

`fixture-flood` (any bundle whose summary is `synthetic`) answers every per-flood route from its bundle folder: the
canned `api/<name>.json` answers (as `serve_fixture.py`), else the frozen files (`warnings.json`, `gauges.json`,
`satellite.json`). The real API's answers equal the committed `tests/data/floods/fixture_api/` copy (tested).
`fixture-flood-<kind>` ids stay 404 here (fixture server only).

## New backend-sent strings (`floods/copy.py` `BUNDLE_STRINGS`; for CONTRACT 16.14, integration)

`GAUGE_DETAIL_DOWN`, `NEARBY_GAUGES_DOWN`, `SAT_NO_IMAGE`, `SAT_BEFORE_ARCHIVE`, `RFC_FIM_PAST`, `CATFIM_TODAY`,
`MODEL_PAST`, `MODEL_DOWN`, `MODEL_NO_REACH`, `NFHL_PARTLY_MAPPED`, `NFHL_TRUNCATED`, `ALERTS_PAST_NOT_YET`,
`GAUGES_PAST_NOT_YET`,
`BUILD_SYNTHETIC`, `BUILD_OUTSIDE_L48`, `FLOOD_ROUTE_NOT_LISTED`, `GAUGE_NOT_FOUND`, `SATELLITE_IMAGE_GONE`,
`TERRAIN_DOWN`, `NAIP_DOWN`, `GAUGES_NONE`, `LOCAL_FLOOD_CAVEAT`, `LOCAL_FLOOD_ARCHIVE_REASON`, `LOCAL_FLOOD_NWS_DOWN`
(texts in `copy.py`, all under `test_floods_copy.py`'s guard).

Added by the review fixes (review5-backend-flood-bundle-api; exact texts, for CONTRACT 16.14):

| Name | Text | Sent |
|---|---|---|
| `SAT_CAVEAT_NO_CLOUD_SHARE` | Water seen by satellite (NASA OPERA), {date_time}. It includes the river's normal water. Clouds, trees, buildings and the days between passes hide water: dry pixels do not mean no flooding. | `caveats[0]` when the cloud share is unknown (the GIBS picture); replaces the old "Clouds (?% of this area)" (R5) |
| `SAT_CAVEAT_RADAR` | Water seen by radar satellite (NASA OPERA), {date_time}. It includes the river's normal water. Trees, buildings, steep slopes and the days between passes hide water: dry pixels do not mean no flooding. | `caveats[0]` of a DSWx-S1 (radar) image (R5) |
| `SAT_PICTURE_REASON` | Fire-3d could not load a measured satellite water image of this area from the last 10 days; NASA's picture of {date} is not measured here. That is not an all-clear. | `reason` of a GIBS picture answer (R3); `{date}` "Oct 30, 2026" |
| `SAT_SAVED_COPY` | NASA's satellite water service could not be reached right now; this is the image Fire-3d saved when it prepared this flood. | last of `caveats` when the route serves the bundle's saved image (R8) |
| `CATFIM_NOT_COVERED` | No NWS category flood map for this flood (no river gauge with a flood category). | CatFIM `reason` with `not_covered` (R4) |
| `CATFIM_NOTE_ANY` | What NWS maps for each flood category at a river gauge (experimental map library). Not a forecast. | CatFIM `coverage_note` when there is no category (R4) |
| `NFHL_AVAILABILITY_UNKNOWN` | Whether FEMA has a digital flood map for all of this area could not be checked right now. | NFHL caveat (and the bundle's floodplain reason) when availability is unknown but not measured partial (R7) |
| `MODEL_NO_GAUGE` | This flood has no river gauge, so there is no model series for it. | `nwm_series` `reason` without a gauge (R9) |

`SAT_CAVEAT` itself (CONTRACT 16.14) is unchanged and is sent only with a measured cloud share
(`copy.sat_caveat(date_time, cloud_pct, *, radar=False)` picks the variant). Credit helpers: `copy.opera_credit(product,
route)` (R6), `CREDIT_3DEP`, `CREDIT_NAIP`, `CREDIT_TIGERWEB_COUNTIES`, `CREDIT_COPERNICUS`, `CREDIT_OPERA_HLS_BASE`,
`CREDIT_OPERA_S1_BASE` (`CREDIT_OPERA_HLS` / `CREDIT_OPERA_S1` keep their values). `maps.AOI_CUT_NOTE` ("Cut to {km} km around the
{what}: this flood's NWS areas reach farther.") is the manifest's `aoi_note`.

## Deviations and interpretations

1. **Satellite window.** Earthdata GIS is often more than a day behind and Landsat swaths leave tiles half empty: in the
   recorded box the only pass of the last 10 days had no pixels there. The pass is therefore chosen by small probes
   (above); when no pass in 10 days saw ≥ 5 % of the area, the answer is the GIBS picture (`measured: false`,
   `reason_code: "no_image"`, `reason: SAT_PICTURE_REASON`) **of the newest day whose passes touch the area** (Earthdata
   GIS rows not rejected by a probe, or CMR; review R3), or, when there is no such day (or GIBS has not published it),
   no picture (`tiles: null`, `reason: SAT_NO_IMAGE`, `caveats: []`). Earthdata GIS down: the same rule with CMR
   (`reason_code: "upstream_error"`); Earthdata GIS and CMR down, or GIBS down: `SAT_UNAVAILABLE`. The window stays 10
   days (PLAN-5 3.7); no older image is shown, and the route's saved bundle image appears only in an outage (R8).
2. **Outside the image vs no data.** "The image" is the chosen pass's tile footprints: outside them the PNG is
   transparent and `image.bounds_lonlat` is cropped to them; inside a tile, pixels the swath missed are 255 (no data) and
   hatched like clouds (D25). The bundle grid has 255 in both cases. Stats count both as no data.
3. **`SAT_CAVEAT` for radar and pictures** (changed by review R5): a GIBS picture has no measured cloud share, so it
   gets `SAT_CAVEAT_NO_CLOUD_SHARE` (no parenthesis; the date only); DSWx-S1 radar sees through clouds, so it gets
   `SAT_CAVEAT_RADAR`. No answer carries a "?" slot.
4. **Nearby gauges' forecasts** come from `rfc_max_forecast` when listed there (its `crest_at_end` is conservative);
   otherwise `forecast` is null and `is_forecast_point` says whether NWS forecasts the gauge (`?lid=` reads NWPS for the
   exact forecast). The web should not show `NO_RFC_FORECAST` when `is_forecast_point` is true.
5. **Point queries never mix synthetic data with real answers:** `flood-alerts?bbox=` / `river-gauges?bbox=` around the
   fixture's place answer the real NWS / NOAA data (D17). For the demo's point check the web should use the open flood's
   own answers (`?flood=fixture-flood`) when `summary.synthetic` is true.
6. **Bundle vector copies are compact** (`compact_fc`: polygons under one render cell left out, ¾-cell simplification,
   4 decimals) so a 60 km bundle stays under 20 MB (17.6 and 17.7 MB measured); the rasters use the full answers and
   the 2D routes serve the full answers.
7. **`nwm_5day` and `nwm_high_flow`** are answered by the model route but not written into the bundle (CONTRACT 16.3
   lists `model/nwm_analysis.geojson` only). Cut-line items were both built: NWM high flow, and CatFIM for past dates
   (`CATFIM_TODAY`).
8. **Past times** (older than now − 6 h): maps and model `not_available_for_past_dates`; `flood-alerts` answers
   `not_available_for_past_dates` with `ALERTS_PAST_NOT_YET` until backend-flood-live adds the IEM archive;
   `river-gauges` (except `scope=national`) answers `not_available_for_past_dates` with `GAUGES_PAST_NOT_YET` (never
   today's readings for a past time) until backend-flood-live wires `usgs_water.observed_series` with
   `THRESHOLDS_TODAY` and `PAST_NO_FORECAST`; satellite answers the passes of the 10 days before `at_ms` (2023 on).
9. **List rows carry the bundle state per request** (`api/floods._bundle_now`: a running job, the build lock, the
   manifest), so a bundle built after the list was cached shows `ready` at once.
10. **`flood_iso` (tests)** also resets the flood rate limiters and the new modules' states: one test's mocked
    requests used up `NWS_LIMITER` and made later tests fail.

11. **The OPERA credit line** (review R6) is PLAN-5 2's exact line with the route before the Copernicus clause:
    "Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1) via NASA Earthdata GIS;
    contains modified Copernicus Sentinel data"; the GIBS picture uses the same line with "via NASA GIBS" (PLAN-5 2's
    shorter picture credit "NASA JPL OPERA DSWx via NASA GIBS" would drop the Copernicus clause that HLS data needs).
    CONTRACT 16.15's OPERA row ("(+ "via NASA Earthdata GIS" or "via NASA GIBS")") should say where the route goes.
12. **SPEC 5.3** (review R11) now sits after 5.1 (SPEC has no 5.2; the number is the one PLAN-5 cites).
13. **The FEMA caveat for `unknown` availability** (review R7) distinguishes measured partial coverage
    (`NFHL_PARTLY_MAPPED`) from "could not be checked" (`NFHL_AVAILABILITY_UNKNOWN`).
14. **Route tests run at the recording's time** (found in the review fix step): the endpoint and API test fixtures pin
    `api.floods._now` and `floods.build.now_ms`, so they keep passing after the recorded passes leave the 10-day window.

## For the next roles

- **web-flood-public / web-flood-forensic:** the real build and files routes are live (M2). A build of a 60 km flood
  took 36 s cold (St. Johns River, FL) and 15-24 s warm. `manifest.layer_status` always has the eight `FloodLayerId`
  keys. `satellite.json` `image.url` points at `/api/floods/{id}/satellite.png?granule=<pass key>`.
- **web roles:** deviations 4 and 5 above. `GET /api/official/river-gauges?lid=ZZRF1&series=1` works on the real API
  for the fixture's hydrograph.
- **backend-flood-live:** `zones.flood_alerts` / `bbox_alerts` take `at_ms` (add the IEM archive there);
  `usgs_water.observed_series` for past gauge readings; queue a `refresh` (re-`build_flood(force=True)`) when
  `satellite.cached_answer` reports a newer pass key than the bundle's `satellite.json` or RFC FIM's `reference_ms`
  changed; `nws.product_hvtec` for the background H-VTEC prefetch.
- **web roles (review fixes):** a GIBS picture answer has `reason` `SAT_PICTURE_REASON` (not `SAT_NO_IMAGE`); a
  no-image answer has `tiles` null and `caveats` []; a served saved image has `SAT_SAVED_COPY` last in `caveats`.
  Flood Forensic: `manifest.data_sources` names are credit lines, ready to list as the bundle's credits.
- **integration:** the fixture's list-only demo floods keep their own CatFIM not-covered sentence ("This flood has no
  NWS forecast gauge, so no category flood map applies.", `scripts/make_fixture.py`), since changing it changes the
  committed `fixture_api` copy the web copies verbatim; align it with `CATFIM_NOT_COVERED` in both copies if wanted.
- **integration:** CONTRACT 16.14 additions (lists above); CONTRACT 16.7 rows: local-alerts `hazard=flood` takes `bbox`
  only (400 with `incident`); `flood-alerts` and `river-gauges` `bbox` max 4°; README credits (SPEC §2 rows written
  for RFC FIM, CatFIM, NWM, FEMA NFHL, OPERA via Earthdata GIS / PO.DAAC / GIBS, USGS v1).
