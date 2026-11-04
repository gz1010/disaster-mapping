# Audit 5: the backend for floods (brief 5)

Role `audit-backend-floods` (brief 5, stage "audit and research"). Read-only: no app code changed, no bundle built, no
server started. Written 2026-11-04, 19:45-20:30 UTC. 32 polite GETs to the flood sources (curl, User-Agent
"Fire-3d research prototype (audit)", one at a time, 0 non-GET, no key or token sent); the evidence log is section 7.
Paths are under `backend/fire3d/` unless they start with `backend/`, `web/` or `docs/`. Line numbers are those of
branch `claude/cool-mayer-ki7to6` at 1824908.

Words used here, in plain terms:

- **NWS product**: a message from a National Weather Service office, such as a Flood Warning. Each carries a **VTEC**
  code (office, kind, number, times). River warnings also have an **H-VTEC** line in the full text that names the
  river gauge by its 5-character **NWSLI** id (for example `SHRN5`, the San Juan River at Shiprock).
- **Gauge**: a river gauge. NOAA's National Water Prediction Service (**NWPS**) gives each gauge a **flood category**
  (action, minor, moderate, major) by comparing its water level (**stage**, in feet) with fixed thresholds. USGS
  usually measures the water; an NWS River Forecast Center (**RFC**) issues the official forecast.
- **FIM**: a flood inundation map, a polygon of where water is expected. NWS makes them from forecasts plus the land's
  height above the nearest stream (HAND). NWS labels these services **experimental** itself.
- **NWM**: NOAA's National Water Model, a computer model of every US stream. Its output is **model output**, not an
  official forecast.
- **OPERA DSWx**: NASA's map of surface water seen by satellite (30 m pixels, every 2-3 days, blind under clouds).

## 0. Summary

- **The backend is built around one hazard.** "Incident" means a wildfire everywhere: the id format, the catalog
  (CAL FIRE + NIFC WFIGS), the summary fields (acres, containment, detections), the manifest (fuels, ignition,
  forecasts), the build (fuels, FIRMS, weather, spread), the live loop, the official endpoints and the CLI
  (section 1, about 60 places).
- **Most of the plumbing is reusable as is**: `fire3d.http` (cache, retries, limits, outage memory), the bundle file
  helpers (`bundle.py` functions that take a folder), the job system, regions and time zones, geocoding and the
  gazetteer, terrain (3DEP DEM, sky view, hillshade), rasterising, the NWS and IEM archive code once its "fire weather
  only" filters become parameters, and the evacuation and local-alert endpoints by `bbox` (section 2).
- **Least disruption: floods live next to fires, not inside them.** New ids that can never parse as fire ids
  (`flood-20261104-san-juan-river-flood-3fa2c1`), a new folder `data/floods/`, new endpoints `/api/floods...`, new
  contract types, and a second live loop. No fire contract field changes. Every fire path keeps treating a flood id
  as unknown, which is the right default (section 3.1).
- **The flood list can be built from three cheap national requests** (measured today):
  - NWS flood products in the lower 48: one request, 42 products nationally (35 Flood Warnings, 6 Flood Advisories,
    1 Flash Flood Warning in Puerto Rico, which the lower-48 filter drops). Every one had its own polygon.
  - Gauges observed at minor flooding or worse: **one** request to NWS's map service `riv_gauges` (30 gauges, 18 KB,
    0.2 s), with the river name (`waterbody`) for naming. This avoids the lower-48 NWPS query that timed out.
  - RFC forecast points forecast at action stage or above: one request (91 points; 28 at minor or worse).
  Grouping these into events with stable ids and names ("San Juan River flood", "Clarks flash flood") is the hardest
  new logic (section 3.2).
- **Live NWS messages lack the gauge id.** api.weather.gov gives only the P-VTEC; the gauge (H-VTEC NWSLI) is only in
  the product text. Warnings and gauges are linked by place (gauge inside the warning polygon) and river name first,
  and by the product text only when that is ambiguous.
- **A flood "bundle" is light** (about 10-15 MB, 30-90 s, no simulation): terrain for the 3D view, rasterised water
  layers, and frozen copies of the warnings, gauges and maps seen (section 3.3). The Public and Command views can work
  without any build, from the list and live endpoints.
- **The satellite water layer works partly without the NASA login.** NASA GIBS serves the OPERA DSWx-HLS picture as
  keyless daily tiles (`OPERA_L3_Dynamic_Surface_Water_Extent-HLS`). The `EARTHDATA_TOKEN` is needed only for the
  measured pixels (an area in mi², the 3D drape, the radar product DSWx-S1 that sees through clouds) (section 3.7).
- **Past floods are possible, but not for every layer.** NWS warnings: IEM archive (polygons since 2008). Gauge
  history: USGS. Satellite water: OPERA, operational since 2023 (GIBS and CMR; earlier dates CMR lists are to be
  checked). RFC forecasts, NWS flood maps and NWM: current only, so "not available for past dates" (section 3.6).
- **Effort: about 100 agent-hours of backend work**, in three waves that can run in parallel (section 5).

## 1. Where the backend assumes "fire" (file:line)

| Area | Where | What it assumes |
|---|---|---|
| Ids | `catalog.py:116` `_ID_RE = ^(\d{4})-(.+)-([0-9a-f]{6})$`; `:132-140` `make_incident_id` / `parse_incident_id`; `:118` `_NAME_STOP` drops "fire", "wildfire"; SPEC §4.4 | An id is `<year>-<slug>-<CAL FIRE or IRWIN uid6>`. Anything else is "not listed" (`parse_incident_id` returns None), which every gate reads as a fixture or a local bundle |
| Bundle folder | `bundle.py:50-54` `bundle_dir` = `config.INCIDENTS_DIR / id` (`config.py:85`); `:212-226` `list_bundles` walks only that folder; `:31-33` `forecasts/`, `sim/static.npz` | One folder of fire bundles. `list_bundles` feeds the fallback list (`api/app.py:267`), the live loop (`api/live.py:229`) and tests |
| Layer grids | `bundle.py:272` grid kinds "render", "fire", "points"; `contracts.py:29` `LayerGrid` | A second "fire grid" for spread rasters |
| Summary | `contracts.py:134-184` `IncidentSummary`: `calfire_uid` (139), `acres` / `percent_contained` (143-144), `detections_24h` (152), `record_source` "calfire" or "wfigs" (63), `accuracy_region` (65), `contained_kind`, complexes | Fire records only; the after-validator `_fill_summary_defaults` (`:84-131`) fills CAL FIRE defaults |
| Manifest | `contracts.py:261-280` `IncidentManifest`: `ignition`, `fuels_edition`, `stats.final_acres_observed` / `detections` / `perimeters` (`:255-258`), `forecasts` (spread runs) | Fire bundle shape, all required |
| Events, jobs | `contracts.py:33-35` `EventType` (ignition, spot_fire, containment...); `:37` `JobKind` build / forecast / refresh; `api/jobs.py:44-56` forecast pool and spread step weights | Spread forecasts |
| List response | `contracts.py:506-528` `IncidentListRow`, `ListSource.id: RecordSource` ("calfire" / "wfigs"), `IncidentListResponse` | Two fire lists behind every list |
| Live status | `contracts.py:552-558` `LiveStatus`: `active_incidents`, `detections_24h_ca`, `detections_24h` | Fires and FIRMS |
| Official kinds | `contracts.py:663-666` `OfficialKind` calfire / fire_weather / incident_record / local_alerts; `:727-751` `FireWeatherAlert.event` ("Red Flag Warning" or "Fire Weather Watch"; a TS literal union in SPEC §6) | Fire weather only |
| Catalog sources | `catalog.py:743-819` `_live_base` (CAL FIRE + WFIGS + FIRMS feeds side by side), `:822-867` `_historical_base`, `:707-714` `_source` (CAL FIRE / WFIGS texts), `:106-111` outage texts | Every list is a fire list |
| Catalog sizing | `catalog.py:67` `DEFAULT_MIN_ACRES = 300`; `:69` `FIRE_TYPES`; `:1185-1262` `estimate_fire_bbox` (FIRMS clustering) | Size in acres, extent from fire detections |
| Resolution | `catalog.py:972-1032` `resolve_listed` (live list, year list, CAL FIRE year list, WFIGS lookup); `:959-969` `ListsUnavailable` "The fire lists could not be reached right now"; `:1047-1060` `get_summary` falls back to a manifest under `INCIDENTS_DIR` | A flood id would return None (not listed) and, with no manifest, 404 |
| API list and detail | `api/app.py:476-514` `/api/incidents` (default `min_acres` 300, sort by acres or detections); `:467-474` `LISTS_DOWN_FALLBACK` names CAL FIRE and NIFC; `:267-299` `_bundle_rows` keeps only ids that parse as fire ids (`:276`); `:517-531` detail | Fire lists |
| Build gate | `api/app.py:178-190` `_resolve` -> `pipeline.is_catalog_incident`; `:545-564` `_not_buildable` (409 "local or synthetic bundle"); `:567-584` `start_build`; `build/pipeline.py:86-139` gate | Only CAL FIRE / WFIGS ids build |
| Fire-only routes | `api/app.py:587-615` forecast (spread); `:652-672` aircraft (firefighting aircraft); `:415` app description "Wildfire Forensics & Forecast"; `:419-423` 503 handler with the fire-lists text | |
| Build pipeline | `build/pipeline.py:52-59` `STAGE_WEIGHTS` (fuels, trees, burn_scar, observations, forecast); `:492-532` `build_incident`; `:585-680` `_build_locked`: `estimate_fire_bbox`, `make_aoi(mode)`, `build_static_layers`, `build_observed` (FIRMS), `build_weather`, LANDFIRE gate (`:550`), forecast; `:772-882` `refresh_live` (new detections) | A fire bundle |
| AOI | `grid.py:220-275` `fire_grid_size`, `aoi_extent(mode)`, `fallback_radius_m(acres)`, `make_aoi`; `config.py:118-121` margins by mode, max 60 km | Sized from acres or a fire bbox |
| Static layers | `build/aoi.py:42` steps terrain, fuels, imagery, trees, burn_scar; `:399-600` `build_static_layers` raises on a LANDFIRE failure | Fuels are required |
| Live loop | `api/live.py:1-19` doc; `:41-69` constants (`AUTO_BUILD_MIN_ACRES` 100, forecast age, `SUMMARY_SYNC_FIELDS` acres / containment); `:212-226` `fetch_cycle_data` (fire list + FIRMS 7 days); `:253-295` `sync_live_summaries` (`:269` skips ids that do not parse as fire ids); `:388-403` refresh on new detections; `:413-437` auto-build by acres and detections; `:469-498` `run_cycle`; `:501-532` the one loop; `api/app.py:397-412` lifespan starts only it | One hazard, one cycle |
| Official endpoints | `api/official.py:123-136` `IncidentRef` (CAL FIRE uid, record source); `:140-169` `incident_ref` (fire id or bundle under `INCIDENTS_DIR`); `:217-243` `fill_from_catalog`; `:386-391` `_fire_area`; `:394-466` fire weather; `:542-632` local alerts ("The fire's reported location could not be looked up", `:559-561`); texts `STANDING_NWS` `:56`, `LOCAL_CAVEAT` `:69` | Fire incidents and fire wording |
| NWS module | `sources/nws.py:56-58` `FIRE_EVENTS`, `FIRE_PHENOMENA = "FW"`, `EVENT_BY_SIGNIFICANCE`; `:402-445` `normalize_alert` drops every other event (`:409`) and assumes fire weather zones (`:443`); `:516-583` `place_live` (zone type "fire" `:536`, caveat "fire weather alert(s)" `:572`); `:723-727` `national_url` event list; `:604-612` `LOCAL_KEYWORD` / `_FIRE_WORDS` and `:755-759` `local_in_scope` (CEM and LAE kept only when they mention fire, smoke or evacuation); `:979-980` `ArchiveEvent.event`; `:983-1010` `bypoint_events` keeps FW only (`:987`, key `:1000`); `:1162` `place_archive` labels | Red Flag Warnings and fire-related local messages |
| Records | `api/records.py` (whole module): NIFC WFIGS fire records and the accuracy regions of the spread model | Not applicable to floods |
| Extras | `api/extras.py:361-393` `_incident_info` resolves an `incident=` id through the fire catalog and `INCIDENTS_DIR`; `:1451` imagery families (VIIRS, GOES, Landsat, Sentinel-2) chosen for fires; `:478` `_arcgis_features` orders by `OBJECTID` | `?bbox=` works for any area; `?incident=` only for fires |
| Evacuations | `sources/evacuations.py:41` Oregon's layer is `Fire_Evacuation_Areas_Public` (`Fire_Name`, `:268`); Cal OES zones carry `EVENT_TYPE` (`:204`, kept as `hazard_type` `:249`) | Oregon is a fire layer; Cal OES is all hazards |
| CLI | `cli.py:43-45` `_norm` strips "fire", "incident", "complex"; `:76-124` `resolve_incident` searches the fire catalog; `:127-137` `catalog` prints acres and containment; `:294-300` `build --require-hrrr`; forecast, hindcast | Fire commands |
| Config | `config.py:8-9` "the only secret is FIRMS_MAP_KEY"; `:130-156` `mask_secrets` masks the FIRMS key only; `:159-164` `FIRE3D_LIVE`, `FIRE3D_AUTO_BUILD_LIVE` | One secret; one live loop |
| HTTP | `http.py:186` FIRMS limiter; `:498-547` `stream_download` takes no `headers` | A bearer token cannot be sent on a download yet |
| Types | `types.py:34-48` `BuildContext` (`fire_grid`, `fire_bbox_lonlat`, `require_hrrr`) | Fire build context |
| Scripts | `backend/scripts/make_fixture.py:229-290` fire scenarios only; `check_bundle.py` checks fire bundles; `serve_fixture.py` serves fire endpoints | |
| Tests | `backend/tests/conftest.py:23` `FIXTURE_ROOT = data/incidents`, `:61-71` fire fixtures; `backend/tests/test_endpoint_contracts.py:37-50` walks every ready manifest in `data/incidents` and validates it as `IncidentManifest` | A flood manifest in `data/incidents` would fail this test |

Not fire-specific (no change needed): `regions.py` (states, counties, time zones, lower-48 tests), `api/geocode.py`
(addresses, towns, ZIP codes), `timeutil.py`, `bundle.py` I/O functions that take a folder, `http.py` request path,
`api/jobs.py` manager, `sources/terrain.py`.

## 2. What can be reused for floods

### 2.1 As is

- **`fire3d.http`** (`http.py`): disk cache with TTLs, retries with backoff, `Retry-After`, the 4-request concurrency
  cap, error bodies never cached (ArcGIS answers errors with HTTP 200 and `{"error": ...}`, `http.py:69-91`: this
  matters for the NOAA and FEMA map services), `RateLimiter` per source, `DownMemo` (a failed host is remembered for
  60 s, `http.py:192-238`), `peek_cache` / `evict_cache`, secret masking in logs. Every flood source goes through it.
- **The extras fetch pattern** (`api/extras.py:240-306`): `_Upstream` (name + limiter), `_fetch` (in-memory TTL cache
  over `fhttp`), `_arcgis_check`, `_arcgis_features` (paging) and `_layer_updated_ms`. These fit NOAA's map services,
  the `riv_gauges` service and FEMA's NFHL. One small change: `_arcgis_features` orders by a hard-coded `OBJECTID`
  (`:478`); NOAA's layers use `oid` or `objectid`, so the field becomes a parameter.
- **NASA CMR and GIBS helpers** (`api/extras.py:252-253`, `:1070` `gibs_tiles`, `:1074-1124` GIBS time domains,
  `:1232-1262` `_cmr_polygons`, `_cmr_granules`): OPERA DSWx is one more CMR short name and one more GIBS layer.
- **Bundle file helpers** (`bundle.py`): `atomic_write_bytes`, `write_json`, `read_json`, `update_manifest` and
  `manifest_lock` (fcntl + re-entrant), `write_layer` / `write_image_layer` / `read_layer`, `resolve_bundle_file`
  (traversal-safe). They all take a folder, so a flood folder works without change. `pipeline.bundle_lock` /
  `build_in_progress` (`build/pipeline.py:158-203`) too.
- **Job system** (`api/jobs.py`): `JobManager.submit(kind, incident_id, fn)` dedupes by (kind, id); flood ids never
  collide with fire ids, so the existing kinds "build" and "refresh" can carry flood ids. Progress, masked errors,
  `drain`, and `background_followups` work for any job function.
- **Regions and states** (`regions.py`): `L48`, `state_at`, `states_in_bbox`, `county_at`, `counties_in_bbox`,
  `time_zone_at`, `main_zone`, `in_lower48`, `is_supported_state`, `lookup`. Offline, thread-safe. Also
  `nws.ugc_state`, `nws.same_state`, `nws.STATE_BY_FIPS`, `nws.alert_time_zone`, `nws.states_in_area`. These give the
  lower-48 filter, the state and county of an event, and the IANA time zone (NWPS gives POSIX zones such as
  "MST7MDT", which are not IANA names).
- **Geocoding** (`api/geocode.py`): addresses, towns, counties and ZIP codes work for any hazard. The gazetteer
  (`gazetteer_us.json`, `Place` `:207`, `Gazetteer` `:229`, `gazetteer()` `:281`) can name a flash flood after the
  largest town inside its polygon.
- **Terrain** (`sources/terrain.py`): `fetch_dem_info(grid)` (3DEP), `sky_view_uint8`, `hillshade` (`:304`),
  `clean_dem`, `area_resample`; `grid.Grid`, `utm_epsg_for`, `manifest_grid`, `grids_from_manifest`;
  `sources/imagery.fetch_naip` for an aerial photo under the 3D view; `build/observed.rasterize_local`
  (`observed.py:569`) to burn polygons onto the render grid. No new Python dependency is needed (rasterio, shapely,
  pyproj, numpy are already there).
- **Evacuation zones** (`/api/extras/evacuations?bbox=`): works for any area. Cal OES zones carry their hazard
  (`EVENT_TYPE`), shown verbatim. Every state without a feed already answers "not available in this state", never an
  all-clear.
- **Local officials' messages** (`/api/official/local-alerts?bbox=`): Evacuation Immediate, Shelter In Place and
  similar relayed messages, plus FEMA's archive; works by `bbox`.

### 2.2 Reusable after a small, additive generalization (defaults keep fire behaviour)

| Module | Change | Why |
|---|---|---|
| `sources/nws.py` | An event family parameter: `normalize_alert(feature, family="fire")`, `bypoint_events(rows, phenomena=("FW",))`, a label table by (phenomena, significance) for `ArchiveEvent.event` and `place_archive` (FL.W Flood Warning, FL.Y Flood Advisory, FL.A Flood Watch, FA.W/FA.Y/FA.A, FF.W Flash Flood Warning, FF.A Flash Flood Watch, FW.W/FW.A), and a second cached national request `flood_active()` | Today's parsing, phases, polygons, archive search, segments and verbatim text are exactly what flood products need. Flood products have their own polygons, so `place_live` takes its `_geometry` path and never loads zone outlines |
| `sources/nws.py` | `local_in_scope(code, *texts, hazard="fire")`: for floods, CEM and LAE are kept when they mention flood, water, levee or dam | The keyword rule is fire-only today |
| `api/extras.py` | `_incident_info` accepts a flood id (by its `flood-` prefix) and uses the flood's area | So `?incident=<flood id>` works like `?bbox=` |
| `api/extras.py` | `_arcgis_features(..., order_by="OBJECTID")` | NOAA layers use `oid` |
| `http.py` | `stream_download(..., headers=None)` | To send the NASA token on a download (section 3.7) |
| `config.py` | `FLOODS_DIR = DATA_DIR / "floods"`, `EARTHDATA_TOKEN`, `mask_secrets` for both secrets, `FIRE3D_FLOODS` / `FIRE3D_AUTO_BUILD_FLOODS` flags | |

## 3. Proposed design (least disruption)

### 3.1 The hazard dimension: ids, folders, endpoints

- **Ids.** `flood-{YYYYMMDD}-{slug(name)}-{h6}`: the UTC start date, the slug of the event name, and the first 6 hex
  characters of a hash of the event's anchor (the primary gauge's NWSLI for a river flood, else the first VTEC key,
  for example `KABQ.FA.W.0019.2026`). Example: `flood-20261104-san-juan-river-flood-3fa2c1`. The `flood-` prefix
  means `catalog.parse_incident_id` returns None, so every fire path (lists, build gate, live sync, records, official
  endpoints) treats a flood id as "not a listed fire" without any change. `bundle._ID_RE` already accepts it. The
  synthetic fixture is `fixture-flood`.
- **Folder.** `data/floods/{id}/` (`config.FLOODS_DIR`). Keeping flood bundles out of `data/incidents/` means
  `bundle.list_bundles`, `_bundle_rows`, `live._live_bundles`, `catalog.bundle_status_for`, `check_bundle.py` and
  `test_endpoint_contracts.py` stay fire-only and unchanged. Add `flood_dir(id)` / `list_flood_bundles()` next to the
  fire functions, reusing the same validation.
- **Endpoints.** A new router `api/floods.py`, mounted with one `include_router` line in `api/app.py` (as
  geocode / extras / official / records are today):

  | Method | Path | Answer |
  |---|---|---|
  | GET | `/api/floods?mode=live\|historical&year=&state=&level=` | `FloodListResponse` |
  | GET | `/api/floods/status` | `FloodLiveStatus` (the flood loop's times and counts; `LiveStatus` stays as it is) |
  | GET | `/api/floods/{id}` | `FloodDetailResponse` `{summary, manifest \| null, job \| null}` |
  | POST | `/api/floods/{id}/build?force=` | `JobStatus` (job kind "build" with the flood id) |
  | GET | `/api/floods/{id}/files/{path}` | Flood bundle files (the `bundle_file` logic of `api/app.py:627-649`, moved into a helper that takes a root) |
  | GET | `/api/floods/{id}/maps?kind=rfc_fim\|catfim\|nfhl` | `FloodMapResponse`: official map layers in the flood's area, each with its own source, times and coverage note |
  | GET | `/api/floods/{id}/model?kind=nwm_analysis\|nwm_5day` | `ModelOutputResponse` (`model_output: true`): National Water Model layers, never inside an official answer |
  | GET | `/api/official/flood-alerts?flood=<id>\|bbox=&at_ms=` | `FloodAlertsResponse` (kind "flood_alerts"): NWS products, verbatim; IEM archive for past times |
  | GET | `/api/official/river-gauges?flood=<id>\|bbox=\|lid=&series=1&at_ms=` | `RiverGaugesResponse` (kind "river_gauges"): gauges, categories, observed series, the RFC's official forecast with its issue time |
  | GET | `/api/extras/imagery?bbox=&families=opera_dswx` | Existing route, new family: OPERA water tiles from GIBS (keyless) and the CMR granule list |
  | GET | `/api/extras/evacuations?bbox=`, `/api/official/local-alerts?bbox=` | Unchanged, by the flood's area |

  The overview's **Fires / Floods** switch then reads `/api/incidents` or `/api/floods`. No fire route changes.

### 3.2 The flood catalog (`fire3d/floods/catalog.py`)

#### Inputs (live), with their cost

| Input | Request | Today | Cache |
|---|---|---|---|
| NWS flood products, lower 48 | `api.weather.gov/alerts/active?area=<48 states + DC>&event=Flood Warning,Flash Flood Warning,Flood Watch,Flash Flood Watch,Flood Advisory,Flood Statement,Flash Flood Statement` (a sibling of `nws.national_url`, same `NWS_LIMITER`) | 42 products nationally, 291 KB, all with polygons; P-VTEC only (FL.W 24, FA.W 11, FL.Y 3, FA.Y 3, FF.W 1); `eventEndingTime` on 35 | 2 min, shared |
| Gauges observed in flood | `mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0/query?where=status in ('minor','moderate','major')` | 30 gauges, 18 KB, 0.2 s; fields `gaugelid, status, location, waterbody, state, obstime, url, action, flood, moderate, major, observed, units, secvalue` | 10 min |
| Gauges forecast at action or above | `maps.water.noaa.gov/server/rest/services/rfc/rfc_max_forecast/MapServer/0/query` | 91 points, 28 at minor or worse; `nws_lid, usgs_site_code, feature_id`, thresholds, `initial_status`, `max_status`, `max_value_timestep`, `forecast_trend`, `issued_time`, `issuer`, `producer` (RFC), `hydrograph_link` | 15 min |
| Gauge details (per event, on demand) | `api.water.noaa.gov/nwps/v1/gauges/{lid}` and `/stageflow` | 11 KB + 378 KB (30 days observed every 15 min, 5-day forecast) | 15 min |

The NWPS `gauges?bbox=` query (30 gauges in 2.5° x 1.6°, 0.6 s) stays the tool for "all gauges near this event",
including those at action or below, which are shown but never start an event.

#### Grouping rules (constants, one each, like the fire catalog's)

1. **Keep** products with `status: Actual`, phase in effect or upcoming (`nws.live_phase`), at least one UGC in a
   lower-48 state (`nws.ugc_state` in `regions.L48`) and a polygon that touches the lower 48 (`regions.in_lower48`
   on its representative point, else `states_in_bbox`). Keep gauges whose `state` is in `regions.L48`. Today this
   drops the Puerto Rico Flash Flood Warning.
2. **Link gauges to products.** A gauge belongs to a river product (FL.*) when (a) its point is inside the product
   polygon buffered by 2 km and (b) its `waterbody` matches the river parsed from the product text (pattern
   `"<River> (at|near|above|below) <Place> affecting <County>"`, case-insensitive token match). When several gauges
   qualify on the same river, use the H-VTEC NWSLI from the product text (one request per product, cached for good:
   `api.weather.gov/products/types/{FLW|FLS}/locations/{office}` by `parameters.AWIPSidentifier` and `sent`, then
   the product). Measured example: the Shiprock warning names "San Juan River At Shiprock"; the gauge `SHRN5` "San
   Juan River at Shiprock" is in its polygon.
3. **Join into one event** (union-find) when two members:
   - share a VTEC event key (office, phenomena, significance, number, year): updates of one product;
   - share a gauge;
   - are river members of the same river (normalised name tokens) with polygons or gauges within 25 km (next reaches
     of one river);
   - are flash or areal products whose polygons overlap by 30 % or more of the smaller one, or lie within 10 km and
     were issued within 12 h of each other.
   River and flash products are never joined by distance alone (a flash flood next to a river warning stays its own
   event unless the polygons overlap as above).
4. **Watches** (FA.A, FF.A, FL.A) never join two events together: they cover large areas. A watch is attached to
   every event it overlaps. A watch that overlaps no event is its own event at level "watch" (see Q2).
5. **Gauges at minor or worse with no product** form an event of their own at level "gauge_only" (see Q3), with the
   caveat "No NWS flood product names this gauge right now."
6. **Event fields.** Area = union of member polygons and gauge points (`bbox_lonlat`); point = the primary gauge, else
   the representative point of the largest polygon; `state` = `regions.state_at(point)`, `states` = every state
   touched; `county` = `regions.county_at(point)`; `time_zone` = `regions.time_zone_at(point)`. The **primary gauge**
   is the member gauge with the highest observed category, then highest forecast category, then largest flow.
7. **Kind**: "river" (any FL.* product or gauge), else "flash" (any FF.W), else "areal". **Level**: the highest
   official product in effect: "warning" > "advisory" > "watch", else "gauge_only". **Max category**: the highest
   observed or forecast category among member gauges (null when none).
8. **Start** (`started_ms`, with `started_basis` so the label can be honest): the earliest of the VTEC begin time of
   a NEW product (when not `000000T0000Z`), the `sent` time of the oldest message in the products' `references`, and
   the first time a member gauge crossed flood stage in its 30-day observed series. When none is known (an event
   already running before Fire-3d first saw it), the first-seen time from the registry with basis "first_seen" ("Seen
   by Fire-3d since ..."), never presented as the start of the flood.
9. **End and status.** `expires_ms` = the latest `ends` / `eventEndingTime` / `expires` of the products in effect
   (shown as "NWS warning until ...", never "flood ends"). Status "active" while any member product is in effect or
   upcoming, or any member gauge is observed at minor or worse within the last 6 h. Status "ended" when neither holds
   for 6 h; `ended_ms` = the later of the last product end and the last gauge reading at minor or worse. An ended
   event stays in the live list for 48 h (`nws.ENDED_LISTED_MS`), then only in the year list.
10. **Lower-48 rule for a whole event**: listed when its point is in the lower 48; an event whose point falls outside
    (a border river) but touches a lower-48 state keeps that state.

#### Naming

- **River**: "<River> flood". River = the primary gauge's `waterbody` (riv_gauges), else the NWPS name before " at " /
  " near " / " above " / " below " ("San Juan River near Archuleta" -> "San Juan River"), else the river parsed from
  the product text. Several rivers: the primary river names the event; `rivers` lists all, in order.
- **Flash**: "<Place> flash flood". Place = the first place in the product's "Some locations that will experience
  flash flooding include..." line (verbatim, split on commas and "and"), else the largest gazetteer place inside the
  polygon, else the nearest within 15 km, else "<County> County".
- **Areal**: "<Water> flood" when the text names a creek or river ("along the Silver Creek" -> "Silver Creek flood"),
  else "<Place> flood" as for flash floods.
- **Watch only**: "Flood watch: <first area in areaDesc>" plus "and N more areas".
- Two live events with the same name get the state: "Animas River flood (CO)". Display names keep NWS capitalisation
  of proper names; the slug is lower case. Names never contain "fire".

#### Stable ids

A small registry `data/floods/registry.jsonl` (append-only, like the CAL FIRE history files) maps member keys (VTEC
event keys, gauge NWSLIs) to event ids with `first_seen_ms`. On every rebuild of the list, an event takes the id of its
oldest registered member. Two events that merge keep the older id; the other id goes into `aliases` and still
resolves (the same rule as CONTRACT 14.2 "Id pinning"). When an event splits, the part that holds the anchor keeps the
id. Without the registry (first run), ids are still deterministic from the anchor and the start date.

#### Sources, outages and caching

- `sources[]` on the list, like the fire list (CONTRACT 14.1 and 14.16): `nws_alerts` (National Weather Service),
  `nwps_gauges` (NOAA National Water Prediction Service), `rfc_forecasts` (NWS River Forecast Centers), and
  `iem_archive` for past years. Each with `status`, `retrieved_ms`, `stale`, `reason`.
- NWS down: events from gauges only, with the reason "NWS flood warnings could not be reached; floods are listed from
  river gauges only. That is not an all-clear." Gauges down: events from NWS products only. Both down: the flood
  bundles on disk, both sources unavailable (as `api/app.py:498-502` does for fires). An id the lists cannot decide
  answers 503 "The flood lists could not be reached right now; try again later.", never 404.
- In-memory list cache 5 min, 60 s while a source is degraded (as `catalog._base`). The whole live list costs about
  3 national requests per 10-15 min plus the cached NWS request.

### 3.3 The flood bundle (`fire3d/floods/build.py`)

Much lighter than a fire bundle: no fuels, no detections, no weather, no simulation.

```
data/floods/{id}/
  manifest.json                FloodManifest
  layers/elevation.bin         render  float32  m (3DEP; terrain.fetch_dem_info)
  layers/sky_view.bin          render  uint8    (terrain.sky_view_uint8)
  layers/naip.jpg              image   JPEG     optional aerial photo, labelled with its year ("before the flood")
  layers/water_forecast.bin    render  uint8    0/255: NWS RFC-based 5-day maximum flooded area (official, experimental)
  layers/floodplain_100yr.bin  render  uint8    0/255: FEMA Special Flood Hazard Area (background)
  layers/water_satellite.bin   render  uint8    OPERA DSWx WTR classes (0 not water, 1 open water, 2 partial,
                                                252 snow/ice, 253 cloud, 255 no data); only with EARTHDATA_TOKEN
  layers/water_model.bin       render  uint8    0/255: NWM analysis flooded area (model output; separate)
  warnings.json                every NWS product version seen for the event, verbatim, with times and links
  gauges.json                  member and nearby gauges: thresholds, observed series, RFC forecast series + issue time
  maps/rfc_fim.geojson  maps/catfim_<lid>.geojson  maps/nfhl.geojson  maps/nwm_analysis.geojson   (simplified)
  satellite.json               OPERA granules used (ids, times, cloud %, links), or the "not set up" reason
```

- **Area.** The union of the event's polygons and gauges, padded by 3 km, side 8-60 km (the fire cap
  `config.AOI_MAX_EXTENT_M`). A long river event is cut to the reach around the primary gauge, and the manifest says
  so. At 60 km the 1024² render grid is 59 m per pixel: fine for the 3D view, coarse for narrow floodplains (risk R12).
  A new `floods.build.flood_aoi(bbox)` builds the `Grid` directly; `grid.make_aoi` is not changed.
- **Grid in the manifest.** Reuse the `ManifestGrid` shape so `grids_from_manifest` and the web's terrain code work
  unchanged; `fire` is set equal to `render` and documented "unused for floods". (Alternative: a new `FloodGrid`
  without `fire`; cleaner, but the web then needs its own grid loader.)
- **Steps and weights** (progress like `BuildProgress`): catalog 0.05, terrain 0.35, maps 0.20, gauges 0.15,
  satellite 0.20, finish 0.05. Required: catalog and terrain (status "error" on failure). Optional: each map, gauge
  and satellite step adds a warning and an honest per-layer status instead.
- **Build gate.** Buildable when the flood list (live or a year list) knows the id and its state is in the lower 48.
  `fixture-flood` is bundle-only (409), like `fixture-east`.
- **Size and time.** About 10-15 MB (fire bundles are about 30 MB) and 30-90 s (one DEM export, 3-6 ArcGIS queries,
  2-5 gauge series, one CMR search, one OPERA band download).

### 3.4 Live refresh (`fire3d/floods/live.py`)

- A **second asyncio task**, started in `api/app.py` `lifespan` when `FIRE3D_LIVE=1` and `FIRE3D_FLOODS=1`, with its
  own state. A failure in flood code can never stop the fire loop, and the fire loop is not edited.
- Every 15 min: rebuild the live flood list (`refresh=True`), append any new NWS product versions and gauge readings
  to each ready live flood bundle (`warnings.json`, `gauges.json`; atomic writes through `update_manifest`), and queue
  a "refresh" job for a ready bundle when its RFC map was updated (NWS updates it hourly) or a new OPERA granule
  covers it. No terrain rebuild.
- Auto-build (behind `FIRE3D_AUTO_BUILD_FLOODS`): on the first cycle, the 4 most severe live events (max category,
  then level, then number of gauges), one after another, as `live.auto_build` does for fires (see Q4).
- `GET /api/floods/status`: `{last_refresh_ms, next_refresh_ms, active_floods (null when the lists could not be
  read, never 0), gauges_in_flood, auto_build}`.

### 3.5 Official information and model output (never merged)

| Layer | Issuer and label | Endpoint | Coverage note |
|---|---|---|---|
| Warning polygons and text | National Weather Service, verbatim, with times and a link | `/api/official/flood-alerts` | "No NWS flood product here right now. That is not an all-clear: follow local officials." |
| Gauges and categories | NWS (categories, RFC forecast with its issue time); USGS (measurements, `dataAttribution`) | `/api/official/river-gauges` | "A gauge below flood stage is not an all-clear." |
| RFC-based 5-day maximum flooded area | NWS; the service calls itself "THIS IS AN EXPERIMENTAL SERVICE" (kept verbatim) | `/api/floods/{id}/maps?kind=rfc_fim` | The service covers areas with about 30 % of the US population (its own description): "Outside NWS's mapped area, flooding is unknown, not absent." |
| Category flood maps at a gauge (CatFIM) | NWS, experimental, 60 % population domain | `kind=catfim` | "What NWS maps for minor / moderate / major flooding at this gauge; not a forecast." |
| 100-year floodplain | FEMA National Flood Hazard Layer | `kind=nfhl` | "Background: FEMA's 1 % annual chance floodplain. Floods can reach beyond it." |
| Water seen by satellite | NASA OPERA DSWx (JPL / PO.DAAC), via GIBS tiles or the token raster | `/api/extras/imagery?families=opera_dswx`, bundle layer | "Clouds and gaps hide water; dry pixels are not an all-clear." |
| National Water Model | NOAA Office of Water Prediction; **model output** | `/api/floods/{id}/model` | "Experimental model output (NOAA National Water Model). It is not an NWS forecast and not advice on when to evacuate. Follow local officials." |

The RFC map and CatFIM are NWS products built partly with the NWM stream network. They stay under the official
answer, with NWS's own "experimental" label, because NWS issues them (decision 2 lists "NWS / NOAA forecast-based
flooded-area maps"). The NWM's own layers are model output and only ever appear in the model endpoint.

### 3.6 Past floods (history)

| Piece | Source for past times | Since | Notes |
|---|---|---|---|
| Event list of a year | IEM `api/1/vtec/sbw_interval.geojson` (polygons issued in a window; **at most 2 phenomena per request**, so FL+FA and FF are 2 requests) | 2008 | Measured: 51 flood polygons issued on 2026-10-30 (FA.Y 38, FA.W 6, FL.Y 5, FL.W 2). A year = 12 monthly windows x 2 = 24 requests, cached 30 days for past months |
| Product text, H-VTEC gauge, severity | IEM `api/1/nwstext/{product_id}`, `json/vtec_event.py` (already parsed by `nws.parse_event_detail`) | 2008 | Archived copies, labelled as in brief 3 |
| Warnings at a point and time | `nws.archive_for_area` with the flood phenomena | as above | Reuse as is once the FW filter is a parameter |
| Gauge water levels | USGS `api.waterdata.usgs.gov/ogcapi/v0` collections `continuous`, `daily`, `peaks` by the gauge's `usgsId` (NWPS gauge metadata) | decades | NWPS keeps only 30 days of observations (measured: 2,304 points from 2026-10-05) |
| Flood thresholds | NWPS gauge metadata (today's thresholds) | now | Caveat: thresholds may have changed since |
| Satellite water | OPERA DSWx-HLS (CMR, GIBS daily tiles); DSWx-S1 from 2023-12 | 2023 (operational) | CMR lists the HLS collection from 2016-01-01; check before relying on early dates |
| RFC forecasts, RFC flood maps, NWM | none (these services hold the current run only) | | "Not available for past dates" |
| 100-year floodplain | FEMA NFHL (today's maps) | now | Background only |

Past events use `mode: "historical"`. Without a filter a year holds thousands of flood products, so the year list
needs a rule (see Q6).

### 3.7 The NASA Earthdata token (`EARTHDATA_TOKEN`)

- `config.EARTHDATA_TOKEN` from the environment or `.env`, None allowed. `mask_secrets` (`config.py:144`) also
  replaces it, and any `Authorization: Bearer <...>` text. The module doc (`config.py:8`) and CLAUDE.md say "two
  secrets". There is no token in this environment, so nothing authenticated was tried.
- **Without the token** (must work): GIBS tiles of `OPERA_L3_Dynamic_Surface_Water_Extent-HLS` (daily, keyless,
  measured) give the picture with its date; the public `*_BROWSE.png` of each granule is also keyless. The OPERA
  layer answers `status: "unavailable"`, `reason_code: "not_configured"`, reason "Measured satellite water (NASA
  OPERA) needs a free NASA Earthdata login on this server; it is not set up. The NASA picture is shown instead.", and
  no area in mi² is computed from it.
- **With the token**: search CMR for `OPERA_L3_DSWX-HLS_V1` (and `OPERA_L3_DSWX-S1_V1`, radar, through clouds) in the
  AOI and time window; download the `B01_WTR` band of the newest usable granule(s) from
  `archive.podaac.earthdata.nasa.gov` with the header `Authorization: Bearer <token>` (never in a URL, a cache key, a
  log or an error); cache the file under `CACHE_DIR/opera/<granule id>.tif`; read the AOI window with rasterio and
  reproject onto the render grid (nearest).
- The token is sent only to an allow-list of NASA Earthdata hosts. PO.DAAC answers with a redirect to a pre-signed S3
  URL; httpx drops the `Authorization` header when a redirect goes to another host (to be proven by a test with a
  mock transport). Prefer this one-file download over GDAL `/vsicurl/` with auth headers: GDAL's verbose curl logging
  would print headers, and it bypasses `fire3d.http` and its test guard.
- A 401 / 403 answers "The NASA Earthdata login on this server was refused (it may have expired)." The count-only
  leak scans cover both secrets.

### 3.8 Contract additions (keep `contracts.py`, `SPEC.md` and `web/src/api/types.ts` consistent)

New types only; no fire field changes. Python names first; the TS names are the same.

```python
Hazard = Literal["fire", "flood"]
FloodKind = Literal["river", "flash", "areal"]
FloodLevel = Literal["warning", "advisory", "watch", "gauge_only"]
FloodStatus = Literal["active", "ended"]
FloodCategory = Literal["action", "minor", "moderate", "major"]
GaugeCategory = Literal["no_flooding", "action", "minor", "moderate", "major", "not_defined",
                        "obs_not_current", "out_of_service", "fcst_not_current", "unknown"]   # NWPS values, verbatim
StartedBasis = Literal["nws_product", "gauge", "first_seen"]
FloodSourceId = Literal["nws_alerts", "nwps_gauges", "rfc_forecasts", "iem_archive"]

class FloodProductRef:   id, event, vtec_key, office, phase, sent_ms, onset_ms, ends_ms, url
class FloodGaugeRef:     lid, name, waterbody, lat, lon, observed_category: GaugeCategory, observed_value, unit,
                         observed_ms, forecast_category: GaugeCategory | None, forecast_max_value, forecast_max_ms, url
class FloodSummary:      id, hazard: "flood", name, kind, level, status, mode, year, started_ms, started_basis,
                         updated_ms, expires_ms | None, ended_ms | None, lat, lon, bbox_lonlat, state, states,
                         county, time_zone, rivers, primary_gauge: FloodGaugeRef | None, gauges_in_flood: int,
                         max_category: FloodCategory | None, products: list[FloodProductRef], offices,
                         bundle_status, bundle_built_ms, aliases
class FloodListSource:   id: FloodSourceId, name, status, retrieved_ms, reason, stale
class FloodListResponse: hazard: "flood", mode, updated_ms, floods: list[FloodSummary], year?, sources
class FloodManifest:     schema_version 1, id, hazard "flood", name, mode, status, summary: FloodSummary,
                         time_range {start_ms, end_ms, now_ms}, grid: ManifestGrid, layers: dict[str, LayerInfo],
                         files {warnings, gauges, maps..., satellite}, data_sources: list[DataSource],
                         warnings: list[str], built_ms
class FloodDetailResponse: summary: FloodSummary, manifest: FloodManifest | None, job: JobStatus | None
class FloodLiveStatus:   last_refresh_ms, next_refresh_ms, active_floods, gauges_in_flood, auto_build
class FloodAlert:        the FireWeatherAlert fields with event: str, plus polygon (GeoJSON) and
                         hvtec {nwsli, severity, cause, begin_ms, crest_ms, end_ms} | None
class FloodAlertsResponse(OfficialEnvelope):  kind "flood_alerts", alerts, area_bbox, states_checked, alert_states
class RiverGauge:        lid, usgs_id, name, waterbody, state, time_zone, lat, lon, url, thresholds {action, minor,
                         moderate, major, unit}, observed {...}, forecast {category, max_value, max_ms, issued_ms,
                         issuer} | None, series? {observed, forecast, forecast_issued_ms}, data_attribution
class RiverGaugesResponse(OfficialEnvelope):  kind "river_gauges", gauges, area_bbox
class FloodMapResponse(OfficialEnvelope):     kind "flood_map", map: "rfc_fim" | "catfim" | "nfhl", features (GeoJSON),
                                              reference_ms, coverage_note
class ModelOutputResponse:  kind "nwm", model_output: true, label, status, reason, source, retrieved_ms,
                            reference_ms, features, caveats      # deliberately not an OfficialEnvelope
```

- `OfficialKind` gains "flood_alerts", "river_gauges", "flood_map"; `OfficialReasonCode` gains "not_configured"
  (OPERA without the token). These widen existing unions; the web's switch statements must handle the new values.
- `SPEC.md`: §2 source rows (with terms checked), §4.4 a "Flood ids" paragraph, a new §5.3 "Flood bundle" tree,
  §6 rows for every new route, a §8.8 "Flood catalog" algorithm section (the rules of 3.2), §10 flood tests.
- `docs/redesign/CONTRACT.md` §16 (brief 5 interfaces): these shapes, the grouping and naming switches, and the fixed
  wording strings (3.5), as §14.14 does for fires.

### 3.9 CLI and scripts

- `cli catalog --hazard flood [--mode live|historical] [--year]`; `cli build-flood <id-or-name> [--force]`
  (`resolve_incident` gains a flood branch by the `flood-` prefix or a name match in the flood list).
- `scripts/check_bundle.py --hazard flood` (manifest strict check, layer sizes, GeoJSON validity, no secret).
- `scripts/make_fixture.py --only flood` (section 4). `serve_fixture.py`: flood list and detail from disk, optional.

## 4. Test strategy

- **No network, ever.** `backend/tests/conftest.py:29-40` blocks `fire3d.http` with a refusing `MockTransport`. All
  flood sources go through `fire3d.http`, so they are covered. Rasterio / GDAL reads (the OPERA band) do not go
  through it: make the OPERA reader injectable (as `render_sentinel2` takes a `reader`, `api/extras.py:1614`) and pass
  a fake in tests.
- **Recorded samples** in `backend/tests/data/floods/` with a `PROVENANCE.md`, written by a new
  `backend/scripts/record_test_samples_floods.py` (about 15 polite requests through `fire3d.http` with a temporary
  cache, trimmed and checked before writing, as `record_test_samples_official.py` does): the national NWS flood answer,
  the `riv_gauges` minor+ query, `rfc_max_forecast`, NWPS detail + stageflow for 2 gauges (trimmed to 3 days), one
  RFC FIM bbox page, one CatFIM query, one NWM analysis bbox page, one NFHL zones page, CMR DSWx granules, the GIBS
  layer metadata, two IEM `sbw_interval` windows, one IEM `nwstext`, one USGS `continuous` page. Today's answers are
  good cases: river warnings with and without a gauge in flood, advisories, a Puerto Rico product to drop, Florida
  gauges at minor without a nearby product.
- **Unit tests for the catalog** on hand-made and recorded inputs: the lower-48 filter; gauge-to-product linking
  (spatial + name; ambiguous case resolved by the product text); joining (same VTEC key, shared gauge, same river within
  25 km, flash overlap 30 %); watches never bridging two events; gauge-only events; naming (river, flash from the
  "locations" line, areal from "along the X", duplicates get the state); start basis; active/ended at the 6 h and 48 h
  edges; id stability through a merge and a split with the registry in a temp `DATA_DIR`; outages (each source down,
  both down, a 503 for an undecidable id).
- **Synthetic flood fixture** `fixture-flood` from `make_fixture.py --only flood` (time-relative, like
  `fixture-live`): procedural valley terrain with a river; a gauge whose stage rises through action and minor to
  moderate and falls; a warning polygon along the reach with verbatim-looking text marked synthetic; an RFC FIM
  polygon; a satellite water raster with a cloud patch; a 100-year floodplain polygon; every file validated strictly
  against the new contracts. It is bundle-only (build answers 409) and has no agency record. A `conftest` fixture
  `fixture_flood_bundle` reads it from `data/floods/`.
- **Endpoint contract test for floods**, `backend/tests/test_flood_endpoint_contracts.py`, modelled on
  `test_endpoint_contracts.py` **with the brief-4 isolation lesson built in from the start**: the module fixture sets
  `LIVE_ENABLED=False`, points `FLOODS_DIR` at the real folder read-only, uses an **empty temporary `CACHE_DIR`**, a
  temporary registry path, and clears every in-memory cache before and after (the flood catalog cache,
  `nws.reset_state()`, `extras.reset_state()`, `fhttp.reset_down_memos()`). In brief 4 the fire version read the
  developer's `data/cache`, so an unknown id answered 503 or 404 depending on how old two cached lists were
  (`docs/redesign/reports/final-verification-4.json`, `backend_test_root_cause`). The flood version must give the same
  answers whatever is in `data/`.
- **Contract consistency**: extend `test_contracts.py` so each new Python model matches its TS mirror (field names,
  optionality), and add the new kinds to the web's contract tests.
- **Secrets**: with a fake `EARTHDATA_TOKEN` set by `monkeypatch`, a mock transport records requests: the token is in
  the `Authorization` header of the PO.DAAC request only, never in a URL, never sent after a cross-host redirect,
  never in an error, a log record (`caplog`) or a response body (count-only asserts). A test without the token checks
  the "not set up" answer and that the GIBS picture is still offered.
- **Fire regressions**: the whole existing suite (about 1,000 tests) stays green; the changes in `nws.py`, `http.py`,
  `config.py`, `extras.py` and `app.py` are additive with fire defaults.

## 5. Risks and effort

### 5.1 Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Grouping splits one flood into many events, or merges two | Rules as named constants; tests on today's recorded answers; a review of the names and groups on a live day before the UI ships |
| R2 | Ids change after a restart, a merge or a split, breaking links | The registry and aliases (3.2); deterministic anchors |
| R3 | No H-VTEC in api.weather.gov alerts: a warning linked to the wrong gauge | Spatial + river-name match; product text only when ambiguous; a test for two gauges on one river in one polygon |
| R4 | Sources are slow or drop: NWPS lower-48 query timed out (brief), FEMA NFHL drops connections, the NOAA map services call themselves experimental | National requests only to `riv_gauges` and `rfc_max_forecast` (fast today); `DownMemo`; per-source statuses; a missing layer is "unavailable", never "no flooding" |
| R5 | Safety wording: a flooded-area number or a dry map read as complete | Coverage notes per layer (3.5); never add or merge areas from different sources; "unknown, not low" outside the mapped area; see Q5 |
| R6 | Leak of `EARTHDATA_TOKEN` (headers, GDAL logs, exceptions, cache files) | Header only, host allow-list, `mask_secrets`, no GDAL auth, tests with a fake token, count-only scans |
| R7 | Bandwidth and disk: NWPS stageflow is 378 KB per gauge; NWM / FIM layers can be large | Series only for event gauges and only on view or for built bundles; bbox-limited ArcGIS queries, paging (max 2,000 records a page), simplification; flood bundles ~10-15 MB |
| R8 | Test isolation (the brief-4 failure) | The flood contract test isolates `CACHE_DIR`, registry and memory caches from the start (section 4) |
| R9 | Fire regressions in shared modules | Additive parameters with fire defaults; a separate flood loop task; full fire suite in every gate |
| R10 | Time zones: NWPS gives POSIX names ("MST7MDT"); `riv_gauges.obstime` has no zone | Time zones from `regions.time_zone_at`; display gauge times from NWPS `validTime` (ISO, Z); check `obstime` against NWPS before use |
| R11 | NWPS keeps 30 days of observations: a long flood's start is outside the series | USGS series for older readings; `started_basis` says what the start is based on |
| R12 | A river flood can be longer than the 60 km AOI; 59 m pixels at 60 km | Cut to the reach around the primary gauge and say so; keep 1024² unless the plan raises it |
| R13 | Terms not yet checked on each official page (NWS, NWPS / water.noaa.gov, NOAA map services, IEM, USGS, FEMA NFHL, NASA EOSDIS data policy for OPERA, PO.DAAC and GIBS) | A terms task before the build; credits in README, SPEC §2 and the app |
| R14 | Request rules of IEM's API (2 phenomena per request; 422 on 3, measured) | Two requests per window; tests on the recorded answers |
| R15 | The Oregon evacuation layer is a fire layer | For floods in Oregon say "not available in this state" unless its terms and content say otherwise (to check) |

### 5.2 Effort per part (agent-hours, backend only, including tests for that part)

| Part | Hours | Can start |
|---|---|---|
| A. Contracts: `contracts.py`, `types.ts`, SPEC.md rows, CONTRACT §16 draft | 4.5 | Wave 1 |
| B1. `sources/nws.py` generalisation (families, flood request, archive phenomena, flood keywords for local messages) | 5.5 | Wave 1 |
| B2. `sources/nwps.py` (`riv_gauges`, `rfc_max_forecast`, gauge detail, stageflow, bbox) | 5 | Wave 1 |
| B3. `sources/water_maps.py` (RFC FIM, CatFIM, NWM layers; ArcGIS paging with `oid`; simplification) | 5 | Wave 1 |
| B4. `sources/nfhl.py` (FEMA zones by bbox, flaky host handling) | 3 | Wave 1 |
| B5. `sources/opera.py` + token plumbing (`config`, `mask_secrets`, `http.stream_download` headers, GIBS family) | 9 | Wave 1 |
| B6. `sources/usgs_water.py` (past series, peaks) and IEM past flood list (`sbw_interval`, `nwstext`) | 7 | Wave 1 |
| C. Flood catalog: grouping, naming, start / end / status, registry, lower-48, sources, caching | 11 | Wave 2 (after A, B1, B2) |
| D. API router `api/floods.py`: list, status, detail, build gate, files, maps, model, flood-alerts, river-gauges; extras `incident=` for floods | 7 | Wave 2 |
| E. Flood bundle build (AOI, terrain, rasterised layers, vectors, manifest, locks) | 8 | Wave 2 |
| F. Live flood loop, refresh jobs, auto-build, status | 4.5 | Wave 3 |
| G. Past floods (historical mode end to end) | 6 | Wave 3 |
| H. Fixture `fixture-flood`, recorder script, recorded samples | 7 | Wave 1 (recorder) and wave 2 (fixture) |
| I. Cross-cutting tests (flood endpoint contracts with isolation, secrets, regressions) | 9 | Wave 2-3 |
| J. CLI, `check_bundle --hazard flood`, `serve_fixture` | 3 | Wave 3 |
| K. Terms checks and credits (README, SPEC §2) | 3.5 | Wave 1 |
| **Total** | **about 98** | |

With four backend agents in wave 1, three in wave 2 and three in wave 3, plus one independent review per part, the
backend needs roughly **20-26 hours of wall-clock build time** before integration with the web. The largest
uncertainty is part C (grouping and naming on real data) and part B5 (the token path cannot be tried until a token is
set).

## 6. Open questions (decisions for the user, with a recommendation)

- **Q1. Coastal and lakeshore floods** (Coastal Flood Warnings CF.*, Lakeshore LS.*)? Options: (a) out of this
  brief, (b) in, as their own kind. Recommendation: (a). River gauges near the coast that NWPS puts in flood (17 of
  today's 30 are in Florida) are still listed as river floods.
- **Q2. A Flood Watch with no flooding yet:** (a) list it as an event at level "watch", hidden by default behind a
  "Show watches" filter, (b) list it like the others, (c) only attach it to events. Recommendation: (a).
- **Q3. A gauge at minor or worse with no NWS product:** (a) list it as "gauge only" with the caveat, (b) do not list
  it. Recommendation: (a).
- **Q4. Auto-build flood bundles:** (a) the 4 most severe live floods on start-up, (b) only when someone presses
  Prepare. Recommendation: (a); they are light.
- **Q5. The "FLOODED AREA (mi²)" fact on the Public card:** (a) NWS's forecast flooded area when NWS maps the place,
  else the satellite water area labelled "water seen by satellite, includes normal river and lake water", never
  summed; (b) satellite only; (c) drop the number and show only the map. Recommendation: (a).
- **Q6. Past floods in the year list:** (a) river floods that reached moderate or major at a gauge, plus Flash Flood
  Warnings with "considerable" or "catastrophic" damage threat or a Flash Flood Emergency, current year and the two
  before; (b) every Flood and Flash Flood Warning (thousands a year); (c) live only for now. Recommendation: (a).

## 7. Evidence log (2026-11-04, about 19:50-20:00 UTC; all GET; no key or token; 0 non-GET)

| # | Request | Result |
|---|---|---|
| 1 | `api.weather.gov/alerts/active?event=Flood Warning,Flash Flood Warning,Flood Watch,Flood Advisory,Flash Flood Statement,Flood Statement,Flash Flood Watch,Coastal Flood Warning` | 200, 291 KB, 42 features, `updated` 19:50:09Z; events: Flood Warning 35, Flood Advisory 6, Flash Flood Warning 1 (Caguas, PR); VTEC FL.W 24, FA.W 11, FA.Y 3, FL.Y 3, FF.W 1; all with geometry; `messageType` Update 36, Alert 6; parameters: VTEC (P-VTEC only), NWSheadline 41, eventEndingTime 35, AWIPSidentifier 42, flashFloodDetection 1; states AZ CO FL IA LA MO NE NM PR UT. Example FL.W text: "San Juan River At Shiprock affecting San Juan County ... At 10:00 AM MST Wednesday the stage was 15.0 feet ... Flood stage is 15.5 feet." |
| 2 | `api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=-109.5&bbox.ymin=36.0&bbox.xmax=-107.0&bbox.ymax=37.6&srid=EPSG_4326` | 200, 30 KB, 0.58 s, 30 gauges; observed categories include no_flooding, action (SHRN5 14.54 ft, LPVC2), minor (MNRC2), not_defined, obs_not_current, out_of_service |
| 3-4 | `.../gauges/SHRN5`, `.../gauges/SHRN5/stageflow` | 200, 11 KB: `usgsId` 09368000, `reachId` 17003486, thresholds action 13.5 / minor 15.5 / moderate 18 / major 20.5 ft, historic crests, `timeZone` "MST7MDT", `inundation.enabled` false, USGS attribution. 200, 378 KB: observed 2,304 points 2026-10-05T20:00Z to 2026-11-04T19:00Z; forecast 20 points to 2026-11-09T12:00Z, `issuedTime` 2026-11-04T17:20Z |
| 5-6 | `maps.water.noaa.gov/server/rest/services/rfc?f=json`, `.../nwm?f=json` | 200; rfc: `rfc_based_5day_max_inundation_extent`, `rfc_based_5day_max_streamflow`, `rfc_max_forecast` (+ AK); nwm: `ana_inundation_extent`, `ana_high_flow_magnitude`, `mrf_gfs_5day_max_inundation_extent`, `mrf_nbm_5day_max_inundation_extent`, `srf_18hr_max_high_flow_magnitude`, `srf_18hr_rapid_onset_flooding`, arrival-time layers |
| 7-9 | RFC FIM FeatureServer/0 info, `returnCountOnly`, MapServer info | Layer "5 Days -Inundation Extent (EXPERIMENTAL)", polygons, fields `feature_id, streamflow_cfs, reference_time, update_time, oid`, maxRecordCount 2000; 4,172 features now; description "THIS IS AN EXPERIMENTAL SERVICE ... available for an area that includes 30% of the U.S. population"; copyright "National Water Model, NOAA/NWS National Water Center" |
| 10-13 | `rfc_max_forecast/MapServer/0` info, 3-row query, count, count with `max_status in (minor, moderate, major)` | Fields listed in 3.2; 91 points; 28 at minor or worse; example AGYM7 Platte River near Agency, MO, moderate 26.2 ft, issuer EAX, producer MBRFC |
| 14-16 | CMR `collections.json?short_name=OPERA_L3_DSWX-HLS_V1`, granules in a small bbox, `OPERA_L3_DSWX-S1_V1` | HLS collection at POCLOUD (time_start 2016-01-01); granule T13SBA 2026-10-31 (cloud 67 %), bands B01_WTR..B10_DEM in `podaac-ops-cumulus-protected` (login needed), `*_BROWSE.png` public; S1 collection from 2023-12-01 |
| 17-18 | GIBS `layer-metadata/v1.0/OPERA_L3_Dynamic_Surface_Water_Extent-HLS.json`, same with `-S1` | 200: "OPERA Dynamic Surface Water Extent (L3)", daily, ongoing, retention -1; 404 for the S1 name tried |
| 19-23 | IEM `api/1/openapi.json`; `api/1/nws/current_flood_warnings.json`; `api/1/vtec/sbw_interval.geojson` x3 | Endpoints `nws/current_flood_warnings`, `vtec/sbw_interval`, `vtec/events_status`, `nws/sbw_by_line`; 24 current point flood warnings with H-VTEC NWSLI, `river_name`, stage / flood / forecast text, severity ("no archive support"); `sbw_interval` with 3 `ph` values: 422 "at most 2 items"; with `ph=FL,FA,FF` as one value: 0 features; with `ph=FL&ph=FA` for 2026-10-30: 51 features |
| 24 | `api.waterdata.usgs.gov/ogcapi/v0/collections` | 200; `continuous`, `daily`, `latest-continuous`, `monitoring-locations`, `peaks`, `field-measurements`, ... |
| 25 | `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer?f=json` | 200 in 0.15 s; layers include 28 Flood Hazard Zones, 27 Flood Hazard Boundaries, 16 Base Flood Elevations, 10 Gages; maxRecordCount 2000 |
| 26-29 | `maps.water.noaa.gov/.../flash`, `fim_libs`, `reference` folders; `fim_libs/static_stage_based_catfim/MapServer` | flash: empty; fim_libs: `static_stage_based_catfim` ("EXPERIMENTAL", category extents and 1-ft intervals, 60 % population domain); reference: `static_public_fim_domain`, NWM flowlines and waterbodies |
| 30-32 | `mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer`, layer 0 info, query `status in (minor, moderate, major)` | NWPS River Gauge System; layers 0 Observed River Stages, 1-14 forecast days, 15 Full Forecast Period; maxRecordCount 10000; 30 gauges, 18 KB, 0.23 s (FL 17, MO 3, CO 2, ND 2, AZ 2, IA 1, LA 1, CA 1, NE 1); `obstime` "2026-11-04 18:30:00" without a zone |

Raw answers were kept only in the session scratchpad (not in the repository).
