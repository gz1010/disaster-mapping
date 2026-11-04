# Brief 5 build plan: floods across the lower 48 (PLAN-5)

Planner, 2026-11-04 (20:30-21:30 UTC), on branch `claude/cool-mayer-ki7to6` at f80d846. Inputs: `BRIEF-5.md` (the
authority: request, four decisions, standing rules), the three audits in `docs/redesign/audit-5/` (`sources.md`,
`backend.md`, `web.md`; where `sources.md` and `backend.md` differ, `sources.md` has the newer measurement), the design
(`handoff-4/HANDOFF.md`, `handoff-4/screens/FloodView.dc.html`, `handoff-4/renders/FloodView.jpg`), PLAN-4 §11 (brief-4 UI
decisions, kept), CONTRACT §14-15. Interfaces: **CONTRACT §16**. Roles, ownership, waves: **`plan5-roles.json`**.

**In plain words.** Fire-3d gets a second kind of event, the flood. A switch at the top of the map picks Fires or Floods.
A flood is a group of official National Weather Service (NWS) flood messages and river gauges that are at flood stage,
gathered per river or area and named like "San Juan River flood". Each flood has the three views fires have: Public
(the design's water circle and plain facts), Command (dense readout, official messages, a river-level chart) and
Forensic (the flood layers draped on 3D terrain). Every layer says who made it, when, and what kind of thing it is:
official NWS information, a forecast, a satellite picture that may be days old, or experimental model output. Nothing is
ever presented as "safe". Six build roles run in three waves of two (the machine has 4 CPUs), each with one review and
one fix step, then an integration and a final check. **Estimated finish: Thursday Nov 5 around 20:00 UTC (12 PM
Pacific), range 13:00 UTC Nov 5 to 05:00 UTC Nov 6** (section 10.4).

## 0. Scope and ground rules

- **In scope:** floods in the lower 48 states and DC: the national flood list and map, the Fires / Floods switch, the
  Public, Command and Forensic flood views, flood bundles (light: terrain + water layers + frozen official copies), a
  second live loop, the optional NASA Earthdata token, a synthetic `fixture-flood`, and past floods behind a cut line
  (section 3.6, user decision U1).
- **Out of scope:** coastal and lakeshore flood products (decision D1), any Fire-3d flood model (BRIEF-5 decision 3),
  Alaska, Hawaii and territories, a flood picker in Command (optional, later), flood search suggestions beyond names
  and rivers from the list, a "this flood is in the burn scar of the X Fire" link (later).
- **Keep everything that works for fires working.** No fire contract field changes. Flood code lives beside fire code:
  its own ids, folder, routes, contract types, store, chromes, map module and scene branch. Changes to shared fire
  files are additive with fire defaults (lists in sections 3.1 and 4.8). The whole fire suite stays green.
- **Standing rules (CLAUDE.md, BRIEF-5):** safety wording (section 5); official information keeps issuer, own times,
  verbatim wording and a link, never merged with model output; "Research prototype — not for operational use" and "Not
  an all-clear. Follow local officials." on every view, phones included; every animation stops under
  `prefers-reduced-motion`; no Google data, no paid map services, no Nominatim; credit every source (section 2);
  polite request rates through `fire3d.http`; secrets `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN` only from the environment or
  `.env`, never printed, logged, committed or copied, count-only scans; never "FireTrace"; never commit `data/` or
  `.env`; no new dependency (none is needed: rasterio, numpy, shapely, pyproj, pillow, MapLibre, three.js are there);
  no file names in one folder that differ only by case (`web/src/lib/fileNames.test.ts`).
- **Gates:** `cd backend && uv run pytest -q`; `cd web && npm run typecheck && npm run lint && npm test && npm run build`.
  Lint baseline 55 warnings, all in `src/scene`: add none. Keep `SPEC.md`, `backend/fire3d/contracts.py` and
  `web/src/api/types.ts` (with its re-export of `web/src/api/floodTypes.ts`) consistent; a test checks the field names
  (section 6).
- **Ports:** API 8751-8759, Vite 5211-5219 (per role in `plan5-roles.json`). Never 8000, 8710, 5173, 5180. Stop every
  server you start.
- **CPU:** 4 CPUs, so at most **2 agents** build, review or fix at once. One Chrome at a time per agent; iterate with
  `npx vitest run <files>` and run the full `npm test` only for the gate.
- **Per role:** progress `docs/redesign/progress/brief5-<role>.md`, report `docs/redesign/reports/brief5-<role>.json`
  (summary, files, screenshots, known_issues, cut_line_left), as-built note `docs/redesign/contract5/<role>.md`
  (CONTRACT.md itself is edited only by the integration), screenshots `docs/screenshots/brief5-<role>-*.png` (view
  every one). Commits: `brief 5 <role>: M<n> <what>`, pathspec only (`git add <own paths>`; `git commit -m … -- <own
  paths>`), ending with the two attribution lines; push after each milestone; on rejection `git pull --no-rebase`, then
  push; on `index.lock` wait 10 s and retry. Never force-push.

## 1. Decisions taken in this plan (settling the audits' questions)

These follow from the brief or the rules, so the build does not wait for the user. Each is one constant or one
component, easy to change later.

| # | Question (audit) | Decision | Why |
|---|---|---|---|
| D1 | Coastal and lakeshore products (BE Q1, SRC 9.3) | **Out.** Only Flood Warning, Flash Flood Warning, Flood Watch, Flash Flood Watch, Flood Advisory and their statements | BRIEF-5 decision 1 names exactly these; coastal products have no polygon and no river gauge. River gauges near the coast that NWS puts in flood stay river floods |
| D2 | Gauge at minor or worse with no NWS product (BE Q3) | **Listed** as level `gauge_only`, caveat "No NWS flood product names this gauge right now." | Decision 1: gauges at or above flood stage are members of a flood |
| D3 | Gauges at action stage | Shown (overview diamonds, flood views), **never start an event** | Action stage is below flood stage |
| D4 | Auto-prepare flood bundles (BE Q4) | **The 4 most severe live floods** at start-up, behind `FIRE3D_AUTO_BUILD_FLOODS` (default follows `FIRE3D_AUTO_BUILD_LIVE`) | Same rule as fires (brief 3 round 2); a flood bundle is light (30-90 s) |
| D5 | "FLOODED AREA" fact on the Public card (BE Q5) | **NWS forecast flooded area only** ("FORECAST FLOODED AREA (NWS, 5 DAYS)"), else "Not mapped here". **No satellite mi² in Public** | Satellite water includes the river's normal water and is days old: a number would read as "flooded now". Command shows the satellite area with that caveat |
| D6 | Satellite water without the NASA login (BE 3.7 vs SRC 6.6) | **Measured DSWx-HLS from NASA Earthdata GIS** (no login) is the default; GIBS tiles are the picture fallback; the token adds the radar product DSWx-S1 and the newest optical day | SRC 6.6(a) measured it today; the backend audit predates that finding |
| D7 | Where the Fires / Floods switch sits (Q-W1) | **Top bar title slot**: "United States · ( Fires \| Floods )", both presets, and on Forensic's entry page | Decision 1 ("behind a switch"); the title says what the map lists |
| D8 | Design key "Flooded area now" (Q-W2) | **Each layer named with its own time** ("Water seen by satellite · Oct 31, 4:06 PM (4 d ago)", "NWS forecast flooded area · issued 10:20 AM") | Neither layer is "now" |
| D9 | Gauge colours (Q-W3) | NOAA's hues for action to major, tuned for the dark map; **grey hollow diamond instead of NOAA's green "No Flood"**, grey "?" instead of its light blue "not defined" | Green reads as "safe"; light blue is our flood colour |
| D10 | Circle leader end (Q-W4) | **The primary river gauge**, drawn as its category diamond with a halo | Brief 4 keeps the light-blue dot for "your selected point" |
| D11 | Public facts (Q-W5) | Seven rows; **FORECAST CREST (NWS)** replaces REPORTED (coordinates move to Command) | A flood has no single reported location; the crest is what people check first |
| D12 | National Water Model (Q-W6, SRC 9.5) | **Never in Public.** Command: on the hydrograph's flow view by default, off on the map until switched on in Layers. Forensic: off until switched on | Decision 3; brief-4 rule "no model output in Public" |
| D13 | Hydrograph play button (Q-W7) | **None.** The handle reads values and shows the NWS products in effect at that time | Nothing on the map moves continuously |
| D14 | Click on a flood in Command (Q-W8) | **Opens the Command flood view directly** | Floods need no preparation for the 2D views |
| D15 | USGS API key (SRC 9.2) | **No key** (a third secret would need the user's approval). On HTTP 429: "USGS data could not be reached right now (too many requests); try later." | Enough on the user's own computer (1,000 an hour) |
| D16 | FEMA zones (SRC 9.4) | **Only the 1% floodplain (SFHA, with floodway) and the 0.2% band**; never zone X "AREA OF MINIMAL FLOOD HAZARD" shapes or text | CLAUDE.md: never "low risk" |
| D17 | `fixture-flood` in real lists | **Never listed** by the real API (opened by URL, demo badge); the fixture server lists it with seven synthetic list-only floods | A simulated flood must not sit among real ones |
| D18 | National gauge status source | `riv_gauges` map service (one request, 0.2 s); **NWPS only per gauge** (its lower-48 query timed out in 2 of 5 tries) | SRC 2.1-2.2 |
| D19 | Flood status words | The circle names the NWS product ("FLOOD · WARNING"), never "ACTIVE", "ENDED", "OVER" or "CLEAR" | Official level only, never Fire-3d's inference |
| D20 | Hydrograph model line | NWM flow drawn **on the flow axis only**, never converted to a stage | Converting would mix the model with NWS's rating curve |

## 2. Sources by layer (with credit lines)

All checked from the cloud on 2026-11-04 (SRC 1-7); terms read on the official pages named. Times shown are always the
source's own. Requests go through `fire3d.http` (cache, retries, limiter, outage memory) with the Fire-3d User-Agent.

| Layer | Source and request | Label in the app | Credit line (exact) | Terms (read 2026-11-04) | Refresh / cache |
|---|---|---|---|---|---|
| Event list (live) | `api.weather.gov/alerts/active?area=<48+DC>&event=<7 flood names>`; grouped by VTEC key, then per river or area | "Official NWS flood products" | National Weather Service | weather.gov/disclaimer (public domain; no implied endorsement; do not alter and present as official) | 2 min |
| River gauge of a warning | Product text H-VTEC (`/products/types/{FLW\|FLS}/locations/{office}`, `/products/{id}`); fallback IEM `current_flood_warnings` | (data join) | National Weather Service (IEM copy when used) | as above; IEM disclaimer (public domain, attribution appreciated) | for good per product |
| Event list (past) | IEM `vtec_events_bystate.py` / `sbw_interval.geojson` (≤ 2 phenomena per request) / `vtec_event.py` | "Archived NWS product" | National Weather Service, archived copy via the Iowa Environmental Mesonet (Iowa State University) | mesonet.agron.iastate.edu/disclaimer.php | 30 days (past months) |
| Gauges, national | `mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer` layers 0 (observed) and 15 (forecast) | "Gauge at minor / moderate / major flood stage (NWS)" | NOAA National Water Prediction Service (NWS) | NWS disclaimer | 5 min |
| Official forecast points, national | `maps.water.noaa.gov/server/rest/services/rfc/rfc_max_forecast/MapServer/0` | (catalog input) | NWS River Forecast Centers | NWS disclaimer | 10 min |
| Gauge detail and series | NWPS `api.water.noaa.gov/nwps/v1/gauges/{lid}` and `/stageflow` | "Measured (USGS, provisional)"; thresholds, impacts "NWS" | NOAA National Water Prediction Service (NWS); per gauge its `dataAttribution` ("Observations courtesy of U.S. Geological Survey") | NWS disclaimer (water.noaa.gov has no separate page) | detail 6 h, series 10 min |
| Official river forecast | NWPS `stageflow.forecast` | "Official NWS river forecast · <RFC> · issued <time>" | NWS <RFC name>, issued by NWS <office> | NWS disclaimer | 10 min |
| Forecast flooded area | `rfc/rfc_based_5day_max_inundation_extent` layer 0 (+ layer 2 points), simplified (`maxAllowableOffset=0.0002`, `geometryPrecision=5`) | "NWS forecast flooded area (next 5 days) · experimental" | NOAA/NWS National Water Center (experimental) | NWS disclaimer | 15 min |
| Flooded area by category | `fim_libs/static_stage_based_catfim` (gauge + its forecast category) | "What <category> flooding covers here (experimental NWS map library)" | NOAA/NWS National Water Center (experimental) | NWS disclaimer | 30 days |
| Warning polygons | from the alerts; watches from `/zones/{county\|forecast}/{UGC}` | as the product | National Weather Service | NWS disclaimer | with the alert; zones 30 days |
| Water seen by satellite (default) | NASA Earthdata GIS `OPERA_L3_DSWX-HLS_V1_B01_WTR/ImageServer` `exportImage` (raw classes, one granule locked) | "Water seen by satellite · <date, time> (<age>)" | Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1) via NASA Earthdata GIS; contains modified Copernicus Sentinel data | earthdata.nasa.gov data-use guidance (CC0, cite); podaac.jpl.nasa.gov/CitingPODAAC | search 6 h; images 30 days |
| Water seen by satellite (token) | CMR search + PO.DAAC download of `B01_WTR` for DSWx-S1 (radar) and the newest DSWx-HLS, `Authorization: Bearer` | same, plus "radar (sees through clouds)" for S1 | NASA JPL OPERA DSWx-S1 (PO.DAAC); contains modified Copernicus Sentinel data | as above | granules 30 days |
| Satellite picture (fallback) | NASA GIBS WMTS `OPERA_L3_Dynamic_Surface_Water_Extent-HLS` / `-Sentinel-1` (z ≤ 12) | "NASA picture, <date> (not measured here)" | NASA JPL OPERA DSWx via NASA GIBS | as above | daily |
| Background floodplain | FEMA NFHL `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28`, `SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2%'` | "FEMA 1% annual-chance floodplain (background)" | Flood zones: FEMA National Flood Hazard Layer (effective) | ArcGIS item ae38b6f9…: "as is", user assumes all risk; no logo, no endorsement | 30 days, 4 tries |
| Model | `maps.water.noaa.gov/…/nwm/ana_inundation_extent`, `ana_high_flow_magnitude`, `mrf_gfs_5day_max_inundation_extent`; NWPS `/reaches/{reachId}/streamflow` | "Model output (NOAA National Water Model) · experimental" | NOAA/NWS National Water Center, National Water Model (experimental model output) | NWS disclaimer; water.noaa.gov/about/api ("not an official forecast product") | hourly / 6 h |
| River lines | `reference/static_nwm_flowlines` | — | River lines: NOAA/NWS National Water Center (NWM) | NWS disclaimer | 30 days |
| Past observations | USGS `api.waterdata.usgs.gov/ogcapi/v1/collections/continuous` (00065 stage, 00060 flow), no key; NWPS historic crests | "Measured (USGS, provisional)" / "Historic crests (NWS)" | U.S. Geological Survey (provisional data) | usgs.gov copyrights-and-credits; provisional-data statement | 30 days |
| Terrain | 3DEP (bundle), Mapterhorn (map) | — | as today | as today | as today |
| Evacuations, local officials' messages | existing `/api/extras/evacuations?bbox=`, `/api/official/local-alerts?bbox=&hazard=flood` | as today | as today | as today | as today |

**Do not use:** NWPS `gauges?bbox=` for national lists (504s), the `maps.water.noaa.gov/flash` folder (token), legacy
USGS WaterServices (shut down Feb 22, 2027), VIIRS flood maps via SSEC RealEarth (volume-limited, paid tiers),
Copernicus GFM (account), USGS NHD services (timeouts), NOAA HEFS (experimental API).

## 3. Backend design

Paths under `backend/fire3d/` unless named. New package `floods/`. CONTRACT §16 has the exact types and routes.

### 3.1 The hazard dimension

- **Ids:** `flood-{YYYYMMDD}-{slug(name)}-{h6}` (UTC date of `started_ms`; `h6` = first 6 hex of SHA-1 of the anchor:
  the primary gauge NWSLI for a river flood, else the oldest VTEC key `KABQ.FA.W.0019.2026`, else the gauge NWSLI of a
  gauge-only flood). The `flood-` prefix never parses as a fire id (`catalog.parse_incident_id` → None), so every fire
  path treats a flood id as "not a listed fire" without change. Fixture: `fixture-flood`.
- **Folder:** `data/floods/{id}/` (`config.FLOODS_DIR`); registry `data/floods/registry.jsonl`. Fire functions
  (`bundle.list_bundles`, `_bundle_rows`, `live._live_bundles`, `check_bundle.py`, `test_endpoint_contracts.py`) stay
  fire-only and unchanged. `floods/store.py` has `flood_dir(id)`, `list_flood_bundles()` and reuses `bundle.py`'s
  folder-taking helpers (`atomic_write_bytes`, `write_json`, `update_manifest`, `manifest_lock`, `write_layer`,
  `resolve_bundle_file`).
- **Config** (`config.py`, additive): `FLOODS_DIR`, `EARTHDATA_TOKEN` (env or `.env`, None allowed), `FLOODS_ENABLED`
  (`FIRE3D_FLOODS`, default "1"), `AUTO_BUILD_FLOODS` (`FIRE3D_AUTO_BUILD_FLOODS`, default = `AUTO_BUILD_LIVE`),
  `mask_secrets` masks both secrets and any `Authorization: Bearer …` text; the module doc says "two secrets".
- **HTTP** (`http.py`, additive): `get`/`stream_download` take `headers=`; an `Authorization` header is allowed only
  to the NASA Earthdata host allow-list (`archive.podaac.earthdata.nasa.gov`, `urs.earthdata.nasa.gov`,
  `cmr.earthdata.nasa.gov`), never enters a cache key, a logged URL or an error text; redirects to another host drop it
  (httpx behaviour, proven by a mock-transport test).
- **NWS** (`sources/nws.py`, additive, fire defaults): `normalize_alert(feature, family="fire"|"flood")`, a cached
  national `flood_active()` request (same `NWS_LIMITER`, 2 min), `product_hvtec(alert)` (product text, cached for good),
  `local_in_scope(code, *texts, hazard="fire")` (floods keep CEM/LAE that mention flood, water, levee or dam),
  `bypoint_events(rows, phenomena=("FW",))`, a label table for FL/FA/FF × W/Y/A, zone type from the `affectedZones` URL.
- **Router:** `api/floods.py`, mounted with one `include_router` line in `api/app.py`; it also serves
  `/api/official/flood-alerts` and `/api/official/river-gauges` so `api/official.py` changes only by the
  `hazard=flood` parameter of local alerts. A second live task starts in the `lifespan`.

### 3.2 The flood catalog and event grouping (`floods/catalog.py`, `grouping.py`, `naming.py`, `registry.py`)

**Inputs (live), about three national requests per 10-15 min:** NWS flood products (one request), `riv_gauges` layer 0
`status in ('action','minor','moderate','major')` and layer 15 (one each), `rfc_max_forecast` (one). Gauge detail and
series only per flood, on demand.

**Rules** (named constants in CONTRACT §16.8; each tested on recorded answers):

1. **Keep** products with `status: Actual`, phase in effect or upcoming (`nws.live_phase`), a UGC in a lower-48 state
   or DC, and a geometry (or zones) touching the lower 48. Keep gauges whose `state` is lower 48 or DC. (Today this
   drops the Puerto Rico Flash Flood Warning.)
2. **Link gauges to river products (FL.*):** the gauge point lies inside the product polygon buffered by
   `LINK_BUFFER_KM` (2 km) **and** its `waterbody` matches the river named in the product text ("<River> (at|near|above|
   below) <Place> affecting <County>", token match). When several gauges qualify, the product's H-VTEC NWSLI decides
   (product text, one cached request per product; IEM `current_flood_warnings` as fallback, labelled a copy).
3. **Join into one flood** (union-find) when two members share a VTEC event key (office, phenomena, significance, ETN,
   **year**); share a gauge; are river members of the same river (normalised name tokens) within `SAME_RIVER_KM` (25 km);
   or are flash/areal products whose polygons overlap by `AREAL_OVERLAP` (30 % of the smaller) or lie within
   `AREAL_NEAR_KM` (10 km) and were issued within `AREAL_NEAR_H` (12 h). River and flash products never join by distance
   alone. If VTEC is missing (NWS PNS 26-62), the fallback key is the CAP `references` chain.
4. **Watches** (FA.A, FF.A, FL.A) never bridge two floods: they attach to every flood they overlap; a watch that
   overlaps none is its own flood at level `watch`, hidden by default behind "Show watches" (user decision U2).
5. **Gauge-only:** a gauge at minor or worse that no product names forms a flood at level `gauge_only` (D2).
6. **Fields:** `bbox_lonlat` = union of member polygons and gauge points; point = the primary gauge, else the
   representative point of the largest polygon; `state`, `states`, `county`, `time_zone` from `regions` (IANA; never
   NWPS's POSIX zones). **Primary gauge** = highest observed category, then highest NWS forecast category, then largest
   flow. **Kind:** `river` (any FL.* or gauge), else `flash` (any FF.W), else `areal`. **Level:** the highest product in
   effect: warning > advisory > watch, else `gauge_only`; `emergency` when a Flash Flood Emergency tag is present.
   **Max category:** highest observed or NWS-forecast category among member gauges.
7. **Start** (`started_ms` + `started_basis`): the earliest of a NEW product's VTEC begin (not `000000T0000Z`), the
   oldest message in the `references` chain, and the first crossing of flood stage in the member gauges' 30-day
   series; if none is known, the registry's first-seen time with basis `first_seen` (shown "Seen by Fire-3d since").
8. **End and status:** `expires_ms` = the latest `ends` / `eventEndingTime` / `expires` of products in effect (shown
   "NWS warning until …", never "flood ends"). Status `active` while a member product is in effect or upcoming, or a
   member gauge read minor or worse within `GAUGE_ACTIVE_H` (6 h); else `inactive`, kept in the live list for
   `INACTIVE_LISTED_H` (48 h). The word "inactive" never appears in the UI.
9. **Names:** river "<River> flood" (primary gauge `waterbody`, else the NWPS name before " at|near|above|below ", else
   the product text); flash "<Place> flash flood" (first place of the product's "Some locations that will experience
   flash flooding include…" line, else the largest gazetteer place in the polygon, else the nearest within 15 km, else
   "<County> County"); areal "<Water> flood" ("along the Silver Creek") else "<Place> flood"; watch-only "Flood watch:
   <first area of areaDesc>" + " and N more areas"; duplicates get " (ST)". Proper names keep NWS capitals; names never
   contain "fire".
10. **Stable ids:** the registry maps member keys (VTEC keys, NWSLIs) to ids with `first_seen_ms`; a flood takes the id
    of its oldest registered member; merges keep the older id and list the other in `aliases`; a split keeps the id on
    the part with the anchor. Without the registry ids are still deterministic.
11. **Sources and outages:** `sources[]` = `nws_alerts`, `nwps_gauges`, `rfc_forecasts` (+ `iem_archive` for past
    years), each with `status`, `retrieved_ms`, `stale`, `reason`. NWS down → floods from gauges only (reason
    `FLOOD_NWS_DOWN`); gauges down → products only (`FLOOD_GAUGES_DOWN`); both down → bundles on disk only
    (`FLOOD_LISTS_DOWN`); an id the lists cannot decide answers **503** `FLOOD_LISTS_503`, never 404. List cache 5 min,
    60 s while degraded.
12. **Order:** `emergency` first, then max category major > moderate > (flash warning) > minor, then level warning >
    advisory > gauge_only > watch, then gauges in flood, then `updated_ms` (CONTRACT §16.8 `floodRank`, same in web).

Wave 1 ships the catalog with `GET /api/floods` (live), `/api/floods/status` (from the list until the loop runs) and
`GET /api/floods/{id}` (summary + manifest from disk), so real floods are visible from wave 1 on.

### 3.3 The flood bundle (`floods/build.py`)

Light: no fuels, no detections, no weather, no simulation. Layout (CONTRACT §16.3):

```
data/floods/{id}/
  manifest.json                FloodManifest (grid = ManifestGrid with fire = render)
  layers/elevation.bin         render float32 m (3DEP, terrain.fetch_dem_info)
  layers/sky_view.bin          render uint8
  layers/naip.jpg              image, optional ("Aerial photo, <year>, before this flood")
  layers/water_forecast.bin    render uint8 0/255   NWS RFC-based 5-day maximum flooded area (experimental)
  layers/floodplain.bin        render uint8         0 none, 1 0.2 % band, 2 SFHA, 3 floodway (FEMA)
  layers/water_satellite.bin   render uint8         OPERA DSWx WTR classes (0, 1, 2, 252, 253, 254, 255)
  layers/water_model.bin       render uint8 0/255   NWM analysis flooded area (model output, separate)
  warnings.json  gauges.json  satellite.json  satellite.png
  maps/rfc_fim.geojson  maps/catfim_<lid>_<category>.geojson  maps/nfhl.geojson  model/nwm_analysis.geojson
  model/nwm_series_<lid>.json
```

- **Area:** union of polygons and gauges, padded `FLOOD_AOI_PAD_M` (3 km), side 8-60 km; a longer river flood is cut to
  the reach around the primary gauge and `aoi_note` says so. 1024² render grid (59 m per pixel at 60 km).
- **Steps and weights:** catalog 0.05, terrain 0.35, maps 0.20, gauges 0.15, satellite 0.20, finish 0.05. Required:
  catalog and terrain. Every other step that fails writes its `layer_status` entry with a reason and a warning; the
  bundle is still `ready`.
- **Gate:** buildable when a flood list (live or year) knows the id and its state is lower 48 or DC; `fixture-flood`
  answers 409 (bundle-only). Size about 10-15 MB, 30-90 s.
- **Job system:** the existing `JobManager` with kind `build` and the flood id (never collides with a fire id).

### 3.4 API routes (`api/floods.py`; exact shapes CONTRACT §16.7)

| Method | Path | Answer | Wave |
|---|---|---|---|
| GET | `/api/floods?mode=live\|historical&year=` | `FloodListResponse` | 1 (live), 2 (historical) |
| GET | `/api/floods/status` | `FloodLiveStatus` | 1, loop in 2 |
| GET | `/api/floods/{id}` | `FloodDetailResponse` (404 not listed; 503 lists down) | 1 |
| POST | `/api/floods/{id}/build?force=` | `JobStatus` (409 fixture / outside lower 48) | 2 |
| GET | `/api/floods/{id}/files/{path}` | bundle file (gzip, ETag, traversal-safe; the fire helper made root-taking) | 2 |
| GET | `/api/floods/{id}/maps?kind=rfc_fim\|catfim\|nfhl&lid=&category=` | `FloodMapResponse` | 2 |
| GET | `/api/floods/{id}/model?kind=nwm_analysis\|nwm_5day\|nwm_high_flow\|nwm_series&lid=` | `ModelOutputResponse` | 2 |
| GET | `/api/floods/{id}/satellite?at_ms=` | `SatelliteWaterResponse` | 2 |
| GET | `/api/floods/{id}/satellite.png?granule=` | PNG (lon/lat bounds in the JSON) | 2 |
| GET | `/api/official/flood-alerts?flood=\|bbox=&at_ms=` | `FloodAlertsResponse` | 2 |
| GET | `/api/official/river-gauges?flood=\|bbox=\|lid=\|scope=national&min=action&series=0\|1&at_ms=` | `RiverGaugesResponse` | 2 |
| GET | `/api/official/local-alerts?bbox=&hazard=flood` | existing `LocalAlertsResponse`, flood keywords | 2 |
| GET | `/api/extras/evacuations?bbox=` | unchanged | — |

`fixture-flood` is answered by every route from its bundle's frozen files, marked `synthetic`. Past times (`at_ms`
before the live window) answer from the IEM archive (alerts), USGS (gauge observations), or
`not_available_for_past_dates` (RFC forecasts, NOAA maps, NWM).

### 3.5 Live refresh (`floods/live.py`)

A **second asyncio task** in `lifespan` when `FIRE3D_LIVE=1` and `FIRE3D_FLOODS=1`; its own state; the fire loop is not
edited and a flood failure cannot stop it. Every `REFRESH_S` (15 min): rebuild the live list; append new NWS product
versions and gauge readings to each ready live bundle (`warnings.json`, `gauges.json`, atomic, under
`update_manifest`); queue a `refresh` job when the RFC map was updated or a newer satellite image covers the area (no
terrain rebuild). First cycle: auto-build the 4 most severe floods, one after another (D4). `/api/floods/status`:
`active_floods` and `gauges_in_flood` are null when the lists could not be read, never 0.

### 3.6 Past floods (cut line: below it if time runs short; user decision U1)

- **Year list** (`mode=historical&year=2026|2025`): floods that reached moderate or major at a gauge, plus Flash Flood
  Warnings with a "considerable" or "catastrophic" damage threat or a Flash Flood Emergency (rule `PAST_RULE`). Source:
  IEM (`vtec_events_bystate.py` or `sbw_interval.geojson`; the role measures both with ≤ 10 requests and picks the one
  that gives H-VTEC severity and damage tags in ≤ 30 requests a year; 30-day cache for past months).
- **Per layer:** warnings yes (IEM, archived copy); gauge observations yes (USGS v1, provisional); thresholds and
  impacts are today's values (say so); RFC forecasts, NWS forecast maps and NWM: "not available for past dates";
  satellite water yes (Earthdata GIS from 2023; PO.DAAC with the token); FEMA today's map (background).

### 3.7 Satellite water and the optional `EARTHDATA_TOKEN` (`sources/opera.py`, `floods/satellite.py`)

- **Default (no token, must work):** search the Earthdata GIS catalog for DSWx-HLS granules over the flood's area in
  the last 10 days (`category=1`), choose the newest with the least cloud over the area, **lock to that one granule**
  (`esriMosaicLockRaster`, so the image time is exact; the service's own time metadata is stale), and `exportImage`
  the raw classes (`renderingRule {"rasterFunction":"None"}`) twice: in EPSG:4326 for the 2D overlay PNG (rendered
  server side: water `#2a8ce6`, partial water lighter, cloud grey hatch, no data transparent) and in the bundle's UTM
  grid for `water_satellite.bin`. Stats: water, partial, cloud and no-data shares over the area (measured).
- **With the token:** also search CMR for `OPERA_L3_DSWX-S1_V1` (radar) and `OPERA_L3_DSWX-HLS_V1` (newest day), download
  `B01_WTR` (0.1-0.4 MB) from PO.DAAC with `Authorization: Bearer` through `fire3d.http`, cache by granule id, read the
  window with rasterio (`MemoryFile`), reproject (nearest). No GDAL `/vsicurl/` auth (it would bypass the masking).
  The OPERA reader is injectable for tests.
- **Fallbacks:** Earthdata GIS down → GIBS picture tiles (`measured: false`, no stats, no area); both down →
  `SAT_UNAVAILABLE`.
- **Login states and wording** (`login` field; never the token): `not_configured` → `SAT_NOT_SET_UP`;
  `refused` (401/403 or a redirect back to URS) → `SAT_LOGIN_REFUSED`; `configured` → nothing extra. The rest of the
  flood view always works.
- **What the user does (optional, section 12):** create the token at urs.earthdata.nasa.gov, put
  `EARTHDATA_TOKEN=…` in `.env`, approve PO.DAAC once in a browser, renew when it expires.

### 3.8 Official information and model output, never merged

| Layer | Endpoint | Kind | Coverage note (backend-sent, exact in §5) |
|---|---|---|---|
| NWS products (text, polygons) | `/api/official/flood-alerts` | official | `NO_PRODUCT` when none |
| Gauges, categories, RFC forecast | `/api/official/river-gauges` | official (USGS measures; NWS categorises and forecasts) | `GAUGE_NOT_ALL_CLEAR` |
| NWS forecast flooded area, CatFIM | `/api/floods/{id}/maps` | official source, NWS-labelled experimental | `RFC_FIM_NOTE`, `RFC_FIM_OUTSIDE`, `CATFIM_NOTE` |
| FEMA floodplain | `/api/floods/{id}/maps?kind=nfhl` | official background | `NFHL_NOTE` |
| Water seen by satellite | `/api/floods/{id}/satellite` | observation (NASA) | `SAT_CAVEAT` |
| National Water Model | `/api/floods/{id}/model` | **model output** (`model_output: true`, not an official envelope) | `MODEL_CAVEAT` |

Never summed, never drawn as one layer, never in one block; the web reads them from different endpoints.

## 4. Web design

Paths under `web/src/`. Reused brief-4 pieces are named; "new" means a new file. Exact props and store shapes: CONTRACT
§16.10-16.12.

### 4.1 State, URL, history, chromes (web-flood-overview)

- `state/workspace.ts`: `hazard: 'fire' | 'flood'` (default fire), `setHazard`; URL `?hazard=flood` (omitted for fires).
- `state/flood.ts` (new zustand store, race-guarded like `store.ts`): lists (live, years) with loading, errors, sources,
  updated time (pure transitions in `state/floodCatalog.ts`); open flood (`floodId`, `summary`, `manifest`, `job`,
  `source`, `missingFloodId`, `missingReason`); `gaugeLid`, `cursorMs`, `layers`, `showWatches`; actions `loadFloods`,
  `openFlood`, `closeFlood`, `startFloodBuild`, `setGauge`, `setCursor`, `setFloodLayer`, `setShowWatches`. Dev handle
  `window.__flood`.
- **One event at a time:** `openFlood` closes an open fire (`useStore.getState().closeIncident()`); a subscription in
  `flood.ts` closes the flood when a fire opens (no edit in the frozen `store.ts`). Opening a flood sets
  `hazard = 'flood'`.
- **URL and history:** `?flood=<id>` (pushState); `?incident=` and `?flood=` never together (a link with both opens the
  fire and drops `flood`); `HistoryEntryState.flood?`; Back across hazards works; a 404 shows `FLOOD_NOT_LISTED` on the
  flood overview (replace), a 503 shows `FLOOD_LISTS_503`, never "not found". `?t=` stays fire-only.
- `state/selectors.ts`: `noEventOpen()`, `openEventKind()`, `currentArea()` (the open fire's area or the flood's
  `bbox_lonlat` + margin), used at the 13 shell checks of WEB 1.2; `official/runtime.ts` and `official/mapLayer.ts` fetch
  and draw no fire weather in flood mode; `extras/ExtrasSync.tsx` and `extras/client.ts` take the area from
  `currentArea()`.
- `ui/shell/views.ts`: `mapChromeOf(event: 'fire' | 'flood' | null, preset)` →
  `'overview' | 'public-fire' | 'command-fire' | 'public-flood' | 'command-flood'`; `atmosphereEdgesOf` maps
  public-flood → `fire`, command-flood → `command`. `App.tsx` mounts `PublicFloodChrome` / `CommandFloodChrome` in the
  same slot (stubs from wave 1; the map never remounts), bootstraps `?flood=`, title "<name> · live · Fire-3d" (no
  event: "Fire-3d · Wildfires and floods"), skip link "Skip to the flood list" in flood mode.
- `state/timeZone.ts`: `floodZone` = the flood's `time_zone`, zone source "flood".

### 4.2 The Fires | Floods switch (web-flood-overview)

`ui/public/HazardSwitch.tsx` (new): 28 px segmented pill in the top bar title slot, after "United States ·", replacing
"all fires": glass `rgba(14,14,14,.6)`, hairline, active option accent `#ff7a3d` with ink `#1a0a03`; `role="radiogroup"`,
name "Show: fires or floods"; each option a 10 px glyph (fire dot `#ff8a3c`, water drop `#7fd4ff`). Smaller than and left
of the view pill. Phones: replaces the title. Shown in the Public and Command overviews and on Forensic's "open an event
first" page. Switching keeps the camera, the selected point, the preset and Show details; closes a fire card; the list,
markers, status, legend, Show-details count and search source follow the hazard. In a flood view the back button
("Back to all floods") returns to the flood overview.

### 4.3 National map in Floods (web-flood-overview)

| Element | Spec | Component (reuse / new) | Data |
|---|---|---|---|
| Flood markers | water-blue circles with the fire marker rules: large 15 px (moderate/major or flash warning/emergency; pinned, label at every zoom, leader candidate), active 11 (Flood Warning or gauge at minor), small 7 (advisory only, gauge-only at minor), other 4.5 hollow (watch-only, past); fill `rgba(42,140,230,.10)`, ring `rgba(127,212,255,.8)`, centre dot `#f2fbff` or the highest category colour | `map/overviewLayers.ts` spec builder reused with `{ palette: FLOOD_PALETTE, unit: ' FLOODS', rankProp: 'max_rank' }` (fire defaults unchanged); data and palette in new `map/floodLayers.ts`, `map/floodStyle.ts` | `/api/floods` |
| Groups | 3 or more close: `10 + 4.2·√n`, max 36; "28 FLOODS" | same builder | |
| Gauges | category diamonds 6/7/8/9 px (action, minor, moderate, major) from z5; grey hollow for below stage (flood views only) | new `map/floodLayers.ts` | `/api/official/river-gauges?scope=national&min=action` |
| Leader labels | "Animas River flood" / mono "MAJOR · 24.1 FT" in the category colour, else "FLASH FLOOD WARNING" / "FLOOD WARNING" / "FLOOD ADVISORY" | `map/LeaderLabels.tsx` reads `meta` and `rank` from the feature when present (fire default: acres) | |
| Bar status | "NOV 4 2026 · 31 FLOODS" (count `#7fd4ff`), "LOADING FLOODS", "FLOOD LIST UNAVAILABLE", "FLOOD LISTS UNAVAILABLE" (never 0 when unknown) | new `ui/public/FloodStatus.tsx` in `TopBarStatus` | list `sources` |
| List panel | "Floods in the lower 48"; OFFICIAL NOW block "Flood products (NWS) · 42 in effect in the lower 48 · checked 2 min ago"; tabs Active / 2026 / 2025 (U1); "Show watches" switch (U2); rows: name, "San Juan Co., NM · Flood Warning · Minor at Shiprock", right "15.2 ft" mono; "12 floods in this view · Show all 31"; source notices; `FLOOD_LIST_ABSENCE` at the foot | new `ui/shell/FloodListPanel.tsx` (the `OverviewPanel` look and classes) | |
| Show details count | listed floods for the filter | `ShowDetailsPill` reused | |
| Legend | flood marker sizes, category diamonds (with names), "NWS warning area" pink, "Show model" never here | new `map/FloodLegend.tsx` (the `MapLegend` variants chips / key / panel) | |
| Point card | NWS flood products at the point verbatim (bbox query), nearest listed floods with distance, nearest gauge at action or above within 25 km with `GAUGE_OTHER_STREAM`, absence line | new `location/FloodPointCard.tsx`; `location/LocationCard.tsx` picks it by hazard | `/api/official/flood-alerts?bbox=`, list |
| Search | flood names and rivers from the list (second hit provider) | `location/search.ts`, `SearchBox.tsx` | list |
| Click | Public → Public flood view (`pickFlood(id)`, one push); Command → Command flood view (D14); group → zoom in | `map/mapController.ts` routes clicks to `floodController.hit()` first | |
| Forensic entry | switch + flood list on "open an event first" | `ui/shell/ForensicWorkspace.tsx` | |

Fire markers, chips, zoom focus and fire weather outlines are hidden while Floods is picked (the "no incident"
checks of WEB 1.2 now use `noEventOpen()` and `hazard`).

### 4.4 Public flood view (web-flood-public), element by element

Layout = the Public fire view (`PublicFireChrome`) with the design's values. Differences from the fire view in bold.

| Design element (FloodView.dc.html) | Ours | Component | Data |
|---|---|---|---|
| Map tint, left gradient | `#333` `color` blend **0.25**; gradient **600 px** `rgba(12,12,12,.92)` → **.74** at 55 % → 0 | `MapAtmosphere edges="fire"` reused; new tint level `'flood'` in `mapStore.setTint`; gradient in `styles/view-flood-public.css` | |
| Close (X, 44 px) | "Back to all floods" | `BackButton` reused (label prop) | |
| Title + date line | "San Juan County, New Mexico" (county, state of the point); "NOV 2 2026 — PRESENT" / "SEEN BY FIRE-3D SINCE NOV 3 2026" / past "NOV 2 2026 — LAST NWS PRODUCT NOV 5 2026" (never "ENDED") | new `ui/public/FloodTitle.tsx` on the presentational part split from `FireTitle.tsx` (`keepDatesWhole` reused) | summary |
| Distance chip | the look unchanged; target in order: NWS warning area edge, else NWS forecast flooded area, else the primary gauge; line says which | `DistanceChip` with maths moved to pure `lib/areaDistance.ts` `distanceToArea({ rings, point })` (fire uses it too) | flood-alerts, maps |
| Hazard circle 312 px | bg **`#1a221f`**, the design's shadow and shade, **water texture** (verbatim: base gradient, water mask, mist path, two current layers −9° at 2.6 s and 1.5 s, mist band, rain 12° at 0.55 s, grain), status mono `#dff4ff`, name 72/800 `#f2fbff`, "MORE IN COMMAND ›" | `HazardCircle.tsx` split into presentational **`HazardDisc.tsx`** (`texture: 'thermal' \| 'water'`, `tone`, `statusLine`, `name`, `meaning`, `tip`, `onClick`, `compact`) + fire container (unchanged); new `WaterTexture.tsx`, `FloodHazardCircle.tsx`; `fitName`, `useId`, `usePausedWhenHidden`, reduced motion shared | summary |
| Status words | §5.2 table ("FLOOD · WARNING", "FLASH FLOOD · EMERGENCY", "FLOOD · GAUGE IN FLOOD", "FLOOD · NO NWS WARNING NOW", "PAST FLOOD · NOV 2 2026", "SIMULATED FLOOD · DEMO"); hidden meaning line names the issuer: "NWS Albuquerque has a Flood Warning in effect for this area until 9:00 PM MST." | `ui/public/floodView.ts` (pure) | products |
| Short name | `floodShortName`: "San Juan River flood" → "San Juan", "Clarks flash flood" → "Clarks"; full name as accessible name | `floodView.ts` | |
| Leader | 1.5 px `#4fc3ff` from the circle edge to the **primary gauge** diamond with a 22 px `#4fc3ff` halo at .22 (D10) | existing leader layout (`useMapAnchor`, `leaderLayout.ts`) | primary gauge |
| Facts (7 rows, `ReadoutRow` reused) | FORECAST FLOODED AREA (NWS, 5 DAYS) · RIVER STAGE (USGS) · FORECAST CREST (NWS) · STARTED · FLOOD WARNING (NWS) (label = the highest product) · EVACUATIONS · LAST OFFICIAL UPDATE; each with issuer, own time and link in its sub-line (§5) | new `ui/public/FloodFacts.tsx` (the `FireFacts` structure, `useFactsFit` reused) | maps (stats), river-gauges, flood-alerts, evacuations |
| Facts foot | OFFICIAL badge + "NWS · USGS · checked 2 min ago"; "Not an all-clear. Follow local officials." + link "NWS water" (`https://water.noaa.gov`) | `FloodFacts.tsx` | |
| Key (bottom right) | one item per layer drawn, each with its own time: "Water seen by satellite · Oct 31, 4:06 PM (4 d ago)" (solid swatch `1.5px #7fd4ff` on `rgba(42,140,230,.5)`); "NWS forecast flooded area · issued 10:20 AM" (hatched); "Main channel" (dashed `#4fb4ff` on `rgba(16,63,138,.7)`); "NWS warning area" (pink outline); scale; "Legend details" | new `ui/public/FloodKey.tsx` (the `FireKey` shape) + `FloodLegend variant="key"` | |
| Map layers (Public profile) | satellite water (measured PNG, else GIBS picture), NWS forecast flooded area, warning outlines, member gauges (below-stage grey), main channel (the basemap's OSM water restyled `#103f8a` fill, dashed `#4fb4ff`), evacuation zones. **No model, no floodplain** | `map/floodController.ts` area layers, `map/floodProfile.ts` | |
| Top right cluster | Show panels, view pill (sm), Check an address, Layers, menu; status from 1280 px: "NASA OPERA · OCT 31 · 4 D AGO" (amber after 3 days) | `TopBar`, `IconPill`, `TopBarStatus` reused | satellite |
| Foot bar | "Research prototype — not for operational use" left; real credits right (NOAA NWS, NWPS, USGS, FEMA, NASA OPERA, OpenFreeMap / OpenStreetMap) | `FixedCopy variant="bar"`, `MapAttribution` | |
| Selected point | brief-4 light-blue dot, halo, hairline, mono label, unchanged; card = `FloodPointCard` (flood-view variant: inside / distance to each layer, nearest gauge, "The experimental model for this spot is in Command ›") | `markers.ts` reused; `location/floodCheck.ts` (pure, new) | |
| Phones | the fire view's bottom sheet; the peek shows stage and the warning row | as `PublicFireChrome` | |

Official flood web (also web-flood-public): `official/floodModel.ts` (NWS answers → rows verbatim, Emergency first and open,
phases, archive labels; a model answer can never produce an official row), `official/floodHooks.ts`
(`useFloodOfficialSync`), `ui/feed/FloodOfficialNow.tsx` (the `variant="command"` rows; mounted by Command in wave 3);
`ui/feed/OfficialNow.tsx` only exports `Row` and `SourceLink`.

### 4.5 Command flood view (web-flood-command), derived from Command fire

`ui/shell/CommandFloodChrome.tsx` (new) with `CommandFireChrome`'s layout and classes (`styles/view-command.css` rules
broadened with `:is([data-view='command-fire'],[data-view='command-flood'])` where the layout is the same; flood rules
in `styles/view-flood-command.css`).

| Region | Ours | Component | Data |
|---|---|---|---|
| Top bar | back "Back to all floods"; flood name (18 px); LIVE or the year; place; demo badge · view pill · right: gauge line mono "SHRN5 · 15.2 FT · MINOR · 12 MIN AGO" (age amber after 3 h; opens the gauge list), Show panels, Updates (phones), Check an address, Layers, menu | `TopBar`, `BackButton`, `LiveDot`, `IconPill`, `TopBarStatus` reused | river-gauges |
| Left readout | "SELECTED POINT" + copy/centre/clear; point mono 30 px; DMS · UTM · WGS84 (zone from the point when no bundle); one line per flood layer at the point with outlined tags (`OFFICIAL`, `FORECAST · ISSUED 10:20`, `SATELLITE · 4 D AGO`, `MODEL` only when on, FEMA when on); `NOTHING_COVERS` when none; nearest-gauge rows (stage, category, flood stage, forecast crest, distance + `GAUGE_OTHER_STREAM`); event rows (FLOOD ID copy, PRIMARY GAUGE coords copy/centre, LAST OFFICIAL UPDATE); satellite area "Water seen by satellite in this area: 2.1 mi² (includes normal river and lake water)" | new `location/FloodReadout.tsx` (the `CommandReadout` structure; `CommandReadout` stays fire-only and frozen); `floodCheck.ts` from wave 2 | all |
| Right: Official now | one collapsible row per NWS product ("Flood Warning — in effect until 9:00 PM MST", meta "NWS ALBUQUERQUE NM · SENT 10:20 MST · CHECKED 2 MIN AGO", open: headline, description, instructions verbatim, link, "Show" fits the polygon); Emergency first and open; "River forecast — crest 17.1 ft Thu 6:00 AM (NWS CBRFC, issued 10:20 AM)"; Evacuations and Local officials' alerts by the flood's bbox; `NO_PRODUCT` when none; foot `MODEL_SEPARATE` | `FloodOfficialNow` (wave 2), fire evacuation/local rows reused | flood-alerts, river-gauges, evacuations, local-alerts |
| Bottom | map controls bar (left); legend chips + scale (right): "Water seen by satellite (Oct 31)", "NWS forecast flooded area", "NWS warning area", the four diamonds, "FEMA 1 % floodplain" and "Model (NWM, experimental)" when on, "Selected location", "Legend details"; then the **slim hydrograph**; fixed copy (`corner`); credits | `MapControls variant="bar"`, `FloodLegend variant="chips"`, `Hydrograph variant="slim"` | |
| Layers drawer | Water: satellite, NWS forecast area, NWS warning areas, gauges; Background: FEMA floodplain (off); Model: NWM flooded area (off, experimental), NWM high-flow reaches (off); basemap, units | new `ui/shell/FloodLayersPanel.tsx` | |
| Phones | readout sheet with a one-line peek (point, else primary gauge); Official now as the Updates sheet; hydrograph full width | as Command fire | |

### 4.6 The hydrograph (web-flood-command; used by Forensic)

`ui/timeline/hydrographModel.ts` (pure, tested) + `ui/timeline/Hydrograph.tsx` (`variant: 'slim' | 'dock'`) +
`hydrograph.css`. Committed first as milestone **M1** so web-flood-forensic can mount it.

- Data: `/api/official/river-gauges?lid=&series=1`; NWM series from `/api/floods/{id}/model?kind=nwm_series&lid=`.
  Observed points thinned to the plot width.
- Axes: 72 h before now to the end of the RFC forecast (or +72 h); day ticks in the gauge's IANA zone (DST-safe); y =
  stage (ft) by default, toggle `STAGE FT | FLOW CFS`; the NWM line exists only on the flow axis (D20).
- Lines: observed solid 1.6 px `#7fd4ff` "OBSERVED · USGS"; RFC forecast dashed 4 3, 1.4 px `#cfeaff` "FORECAST · NWS
  CBRFC · ISSUED NOV 4 10:20 MST"; NWM dotted 1 3 `#f5c060` "MODEL · NWM · EXPERIMENTAL". Style and words carry the
  meaning, never colour alone.
- Flood-stage lines in the category colours, labelled right ("MINOR 15.5"), faint bands above minor, none below action;
  out-of-range lines pinned to the edge with an arrow ("MAJOR 20.5 ↑").
- Marks: NOW; "LATEST 12:15 · 25 MIN AGO" (amber + STALE after 3 h); crest caret "CREST 17.1 FT THU 06:00"; NWS product
  times as small pink ticks.
- Handle: drag or keys (←/→ 1 h, Shift 6 h, Home/End); label "NOV 4 10:00 MST · 15.2 FT OBSERVED · MINOR" or "NOV 6
  06:00 · 17.1 FT FORECAST (NWS) · MODERATE"; sets `useFlood.cursorMs`; the map then draws the products in effect at
  that time. No play button (D13). Gauge picker = the slim variant's 40 px left button.
- Empty states (§5.5). Units: metric → m and m³/s with the original in the tooltip.

### 4.7 Forensic 3D flood view (web-flood-forensic)

| Part | Ours | Component | Data |
|---|---|---|---|
| Branch | `ForensicWorkspace` shows `FloodForensic` when a flood is open (fire Header, Timeline, Charts and panels untouched) | new `ui/forensic-flood/**` | |
| Unprepared | "Fire-3d has not prepared this flood's 3D terrain yet." + "Prepare 3D data (about 1 min)" (job progress) | `FloodForensic` | build route |
| Scene assets | `Scene.tsx` takes assets from `useSceneAssets()` = `scene/flood/floodAssets.ts` (same `IncidentAssets` shape: elevation, sky view, NAIP; fire fields null; `grid.fire = grid.render`) + a `flood` part; `Terrain`, `SunLights`, `CameraRig`, `ProbeDriver`, `SelectionPin`, `PostFX`, `LookDriver` unchanged; `SceneFx` renders nothing (no fire manifest) | `scene/Scene.tsx`, new `scene/flood/**` | bundle files |
| Drapes | terrain shader, additive uniforms: `uFloodPack` RGBA (r NWS forecast area, g FEMA floodplain, b NWM model; linear) and `uSatWater` (classes, nearest); satellite water `#2a8ce6` fill + `#7fd4ff` edge (screen-space derivative), no glints; clouds grey cross-hatch ("no view"), never dry; forecast area water-blue world-space hatch; floodplain faint stipple; model amber dotted edge + "MODEL · EXPERIMENTAL" | `scene/terrain/terrainMaterial.ts`, `Terrain.tsx` (additive) | layers |
| Warning polygons | pink lines draped with `scene/fx/lines.ts` (import only) | `scene/flood/FloodFx.tsx` | warnings.json |
| Gauges | thin vertical bars; ticks at action/minor/moderate/major; bright cap at the stage; hollow cap at the forecast crest; mono label "SHRN5 · 15.2 FT · MINOR · 10:00 MST" (`scene/fx/text.tsx` overlay, import); fixed scale (1 ft = 12 m) with legend "Bar height: river stage at the gauge (scaled), not water depth"; static | new `scene/flood/GaugeBars.tsx`, `gaugeBarMath.ts` (pure; not `gaugeBars.ts`, which would clash with `GaugeBars.tsx` on macOS) | gauges.json |
| Header and entry controls | `TopBar` (name, LIVE/year, view pill); "Frame flood" and "Charts & NWS products" under the compass; demo badge "Demo · simulated data" with "terrain, water layers and gauges are synthetic" | new `FloodHeader.tsx` | |
| Right panel | tabs Layers (Base: Terrain, Aerial photo (NAIP, "taken <year>, before this flood"), FEMA floodplain; Water: satellite, NWS forecast area, NWS warning areas, gauges; Model: NWM flooded area (experimental, off); Parametric: Contours, Telemetry labels), Analysis (hydrographs per gauge), Evidence (every NWS product version verbatim from `warnings.json`), Notes; cards "Flood overview" and "River gauges" | new `FloodRightPanel.tsx`, `FloodLayersTab.tsx`, `FloodEvidenceTab.tsx`, cards | bundle |
| Dock | `Hydrograph variant="dock"` (112 px, 90 px plot, small multiples in "Charts & NWS products") | import from wave 3 M1 | |
| Hand-off | `ui/shell/handoff.ts` reads the open event's grid (fire or flood); heading rule unchanged | | |

### 4.8 Brief-4 components reused, and the few splits

- **Reused unchanged:** `TopBar`, `ViewPill`, `BackButton` (label prop exists), `LiveDot`, `IconPill`, `TopBarStatus`,
  `FixedCopy` (+ `fixedCopyText.ts`), `ReadoutRow`, `MapControls` (bar, compact), `MapAtmosphere`, `markers.ts` selected
  point, `useMapAnchor`, `leaderLayout.ts` maths, `LocateButton`/`locate.ts`, `location/geometry.ts`, `lib/geodesy.ts`,
  `lib/time.ts`, `ShowDetailsPill`, `useFactsFit`, `usePausedWhenHidden`, the reduced-motion hook, `state/rotation.ts`,
  `ui/controls.tsx`, the Forensic scene stack (terrain, camera, probe, post, atmosphere), evacuation and local-alert rows.
- **Small additive splits (fire behaviour and screenshots unchanged):** `HazardCircle` → `HazardDisc` + fire container;
  `FireTitle` and `DistanceChip` → presentational parts with props; `overviewLayers.ts` palette/unit/rank parameters;
  `LeaderLabels.tsx` `meta`/`rank` from features; `OfficialNow.tsx` exports `Row`, `SourceLink`; `mapStore.setTint`
  gains `'flood'`; `MapControls` framing calls `frameFlood()` when a flood is open.
- **Stays fire-only:** fire lists, fire card, incident picker, CAL FIRE / WFIGS records, fire weather, detections,
  perimeters, spread model, accuracy regions, aircraft, fire timelines and charts, `CommandReadout`, `OfficialNow`'s fire
  rows, `MapLegend`, `fireView.ts`, `overviewLayers.ts` fire palette.

### 4.9 Colours and tokens (additive in `styles/map-tokens.css`, mirrors in `map/floodStyle.ts`)

`--m-flood #2a8ce6`, `--m-flood-edge #7fd4ff`, `--m-flood-channel #103f8a`, `--m-flood-channel-edge #4fb4ff`,
`--m-flood-lead #4fc3ff`, `--m-flood-ink #dff4ff`, `--m-flood-ink-2 #f2fbff`, `--m-flood-forecast #cfeaff`,
`--m-flood-disc #1a221f`, `--m-cat-action #f2e04a`, `--m-cat-minor #ff9a3c`, `--m-cat-moderate #ff4d4d`,
`--m-cat-major #c766ff`, `--m-cat-below #8a8a8a`, `--m-cat-undefined #8a8a8a`. NWS warning polygons use the existing
alert pink `--m-alert #ee7aa0`; model the existing modeled amber `#f5c060`. **No green in any flood colour** (a test
checks). Category is always written next to its colour, and diamonds grow with the category.

## 5. Safety wording for floods (exact strings)

Web strings live in `ui/shell/floodCopy.ts` (and, for Forensic, `ui/forensic-flood/floodForensicCopy.ts`); backend
strings in `backend/fire3d/floods/copy.py` (marked **B**: they cross the HTTP contract and are repeated in CONTRACT
§16.14). `{x}` are slots. A guard test (web `ui/shell/floodCopy.test.ts`, backend `test_floods_copy.py`) checks every
exported string of every `*[Ff]lood*[Cc]opy*.ts` file and `copy.py`, and every rendered fixture case (§7.3).

### 5.1 Never an all-clear

- Banned in Fire-3d's own voice (case-insensitive): "safe", "safely", "safety" (except the existing "does not establish
  the safety of a route or an area"), "low risk", "all clear" / "all-clear" (only inside "not an all-clear" / "never an
  all-clear"), "no flooding" (only inside "do not mean no flooding"), "dry" (only inside "Unknown, not dry" and "dry
  pixels do not mean no flooding"), "receded", "the flood is over", "ended" as a status, "normal level", "no danger",
  "you are outside the flood", "minimal flood hazard", "FireTrace". NWS's own wording, quoted verbatim with its issuer,
  is exempt.
- `PROTOTYPE_LINE` "Research prototype — not for operational use" and `NOT_ALL_CLEAR` "Not an all-clear. Follow local
  officials." on every flood view, phones included.

### 5.2 Lists, status words, dates

| Name | Text |
|---|---|
| `FLOOD_LIST_ABSENCE` | Only floods with an NWS flood product or a river gauge at flood stage are listed. A place with no marker is not an all-clear. Follow local officials. |
| `FLOOD_LIST_ABSENCE_SHORT` | Only listed floods · not an all-clear |
| `FLOOD_LIST_EMPTY_VIEW` | No listed floods in this view. |
| `FLOOD_LIST_EMPTY` | The NWS lists no flood warnings or advisories, and no river gauge reads at flood stage, in the lower 48 right now. Not an all-clear: flash floods can start within minutes. Follow local officials. |
| `FLOOD_NWS_DOWN` (B) | NWS flood warnings could not be reached right now; floods are listed from river gauges only. That is not an all-clear. |
| `FLOOD_GAUGES_DOWN` (B) | River gauges could not be reached right now; floods are listed from NWS products only. That is not an all-clear. |
| `FLOOD_LISTS_DOWN` (B) | The flood lists (NWS warnings and river gauges) could not be reached right now. Not an all-clear: follow local officials. |
| `FLOOD_LISTS_503` (B) | The flood lists could not be reached right now; try again later. |
| `FLOOD_NOT_LISTED` | This flood is no longer listed. |
| `GAUGE_ONLY_CAVEAT` (B) | No NWS flood product names this gauge right now. |
| Bar status | `{DATE} · {N} FLOODS` · `LOADING FLOODS` · `FLOOD LIST UNAVAILABLE` · `FLOOD LISTS UNAVAILABLE` |
| Circle status | `FLASH FLOOD · EMERGENCY` (Emergency tag) · `FLASH FLOOD · WARNING` · `FLOOD · WARNING` · `FLOOD · ADVISORY` · `FLOOD · WATCH` (quiet tone, rain kept) · `FLOOD · GAUGE IN FLOOD` · `FLOOD · NO NWS WARNING NOW` (quiet) · `PAST FLOOD · {MON D YYYY}` (quiet) · `SIMULATED FLOOD · DEMO` (demo) |
| Circle meaning | `{Sender} has a {event} in effect for this area until {time}.` / `No NWS flood product names this flood right now; a river gauge here reads at flood stage.` |
| Date line | `{MON D YYYY} — PRESENT` · `SEEN BY FIRE-3D SINCE {MON D YYYY}` · `{MON D YYYY} — LAST NWS PRODUCT {MON D YYYY}` |
| Product end | `NWS {event} until {time}` (never "flood ends") |

### 5.3 Gauges and forecasts

| Name | Text |
|---|---|
| `GAUGE_BELOW_STAGE` / sub | Below flood stage / NWS category at this gauge: “No Flood”. Not an all-clear: water can rise fast, and streams without a gauge are not measured. |
| `GAUGE_NOT_CURRENT` | This gauge's reading is not current (NWS: “Data Not Current”); last reading {time}. |
| `GAUGE_OUT_OF_SERVICE` | Gauge out of service (NWS); no reading. |
| `GAUGE_NOT_DEFINED` | NWS has not set flood stages for this gauge, so its reading cannot be compared with flood levels. |
| `GAUGE_OTHER_STREAM` | Nearest gauge on the {river}; another stream may be closer. |
| `GAUGE_NOT_ALL_CLEAR` (B) | A gauge below flood stage is not an all-clear. |
| `GAUGE_PROVISIONAL` | Measured by USGS (provisional data, subject to revision). |
| `USGS_429` (B) | USGS data could not be reached right now (too many requests); try later. |
| `CREST_LINE` | Forecast crest {value} {unit}, {day time zone} (NWS {RFC name}, issued {time}). Forecasts change; check NWS for the newest. |
| `NO_RFC_FORECAST` | No NWS river forecast for this gauge |
| `PAST_NO_FORECAST` (B) | River forecasts are not kept for past dates. |
| `RFC_FIM_LABEL` | NWS forecast flooded area (next 5 days) |
| `RFC_FIM_NOTE` (B) | Where NWS river forecasts say water could reach in the next 5 days (the most at any time). A forecast, not today's water. NWS calls this map experimental. |
| `RFC_FIM_OUTSIDE` (B) | Outside NWS's mapped area, flooding is unknown, not absent. |
| `RFC_FIM_NONE` | Not mapped here |
| `CATFIM_NOTE` (B) | What NWS maps for {category} flooding at this gauge (experimental map library). Not a forecast. |

### 5.4 Satellite water, FEMA, model

| Name | Text |
|---|---|
| `SAT_LABEL` | Water seen by satellite · {date, time} ({age}) |
| `SAT_CAVEAT` (B) | Water seen by satellite (NASA OPERA), {date, time} ({age}). It includes the river's normal water. Clouds ({n}% of this area), trees, buildings and the days between passes hide water: dry pixels do not mean no flooding. |
| `SAT_NOT_SET_UP` (B) | NASA Earthdata login is not set up on this server. Fire-3d shows NASA's public optical images (Landsat and Sentinel-2), which cannot see through clouds and arrive about a day later. Radar images that see through clouds need the login. |
| `SAT_NOT_SET_UP_SHORT` | No radar images: NASA login not set up |
| `SAT_LOGIN_REFUSED` (B) | The NASA Earthdata login on this server was refused (it may have expired). Fire-3d shows NASA's public optical images only until it is renewed. |
| `SAT_PICTURE_ONLY` | Satellite water: NASA picture, {date} (not measured here) |
| `SAT_UNAVAILABLE` (B) | Satellite water could not be loaded right now. That is not an all-clear. |
| `SAT_CLOUD` / `SAT_CLOUD_POINT` | No view (clouds) / Clouds hid this spot on the {date} pass. |
| `SAT_AREA_COMMAND` | Water seen by satellite in this area: {area} (includes normal river and lake water) |
| `NFHL_LABEL` | FEMA 1% annual-chance floodplain (“100-year floodplain”), background |
| `NFHL_NOTE` (B) | FEMA's 1%-annual-chance (100-year) floodplain, used for flood insurance. It is not a map of current flooding, and places outside it can flood. Provided as is by FEMA. |
| `NFHL_OUTSIDE` | Not in FEMA's mapped 1% floodplain. Floods can reach beyond it; not an all-clear. |
| `NFHL_NO_MAP` (B) | FEMA has no digital flood map here. |
| `NFHL_ZOOM` | Zoom in to see FEMA flood zones |
| `NFHL_DOWN` (B) | FEMA flood zones could not be loaded right now. |
| `MODEL_LABEL` (B) | Model output (NOAA National Water Model) · experimental |
| `MODEL_CAVEAT` (B) | Experimental model output (NOAA National Water Model). It is not an NWS forecast and not advice on when to evacuate. Follow local officials. |
| `MODEL_SEPARATE` | Fire-3d shows NOAA's National Water Model separately, as experimental model output. Not an all-clear. Follow local officials. |
| `MODEL_UNAVAILABLE` | Model series unavailable right now |
| `MODEL_AEP` | Model flow about a 1 in {n} chance in any year (NWM) — from `recur_cat` {p} % (n = 100 / p); `">50"`: Model flow above its high-water level (NWM) |

### 5.5 Point checks, distance, products, hydrograph

| Name | Text |
|---|---|
| `NO_PRODUCT` (B) | No NWS flood product here right now. That is not an all-clear: follow local officials. |
| `NOTHING_COVERS` | No mapped flood layer covers this spot. Unknown, not dry. Follow local officials. |
| `INSIDE_WARNING` | Inside the NWS {event} area (until {time}). |
| `INSIDE_FIM` / `NEAR_FIM` | Inside the NWS forecast flooded area (5-day maximum). / {distance} from the NWS forecast flooded area. |
| `NEAR_SAT` | {distance} from water seen by satellite ({date, time}; clouds over {n}% of the area). |
| `IN_FLOODPLAIN` | In FEMA's 1% annual-chance floodplain, Zone {zone} (background). |
| `MODEL_AT_POINT` | National Water Model (NOAA, experimental): flooded at the {time} analysis. |
| Distance chip lines | to the edge of the NWS warning area · to the NWS forecast flooded area (5 days) · to the river gauge, not the water's edge · Inside the NWS warning area |
| `WAS_IN_EFFECT` | Was in effect (sub-line starts "as of {date}"; brief-4 rule) |
| `ARCHIVED_COPY` | Archived copy (Iowa Environmental Mesonet) |
| Hydrograph empty | No readings from this gauge in the last 72 h (NWS: Data Not Current) · NWS has not set flood stages for this gauge · No NWS river forecast for this gauge · Model series unavailable right now |
| Forensic | Fire-3d has not prepared this flood's 3D terrain yet. · Prepare 3D data (about 1 min) · Bar height: river stage at the gauge (scaled), not water depth · Demo · simulated data: terrain, water layers and gauges are synthetic |

## 6. Contracts to keep consistent

- **Triple:** `SPEC.md` (§2 source rows, §4.4 "Flood ids", §5.3 "Flood bundle", §6 flood routes, §8.8 "Flood
  catalog", §8.9 "Flood live refresh", §10 flood tests), `backend/fire3d/contracts.py` (new models only), and
  `web/src/api/floodTypes.ts` re-exported by `web/src/api/types.ts` (`export * from './floodTypes'`). CONTRACT §16.2-16.7
  is the source text for all three.
- **Parity test** `backend/tests/test_flood_contracts.py`: for each flood model, the field names and optional/required
  marks equal the TS interface's (parsed from `floodTypes.ts`); every union literal equal. Runs in the backend gate.
- **No fire union widened:** flood official answers use their own `FloodEnvelope` (`kind: FloodOfficialKind`,
  `reason_code: FloodReasonCode`); `OfficialKind`, `OfficialReasonCode` and `web/src/official/types.ts` stay as they are,
  so no fire `switch` can break.
- **Changes after wave 1:** additive only, made by the owner of the triple in that wave (backend-flood-sources in wave 1,
  backend-flood-bundle-api in wave 2), recorded in its `contract5` note; the web roles are told by the note.

## 7. Fixtures (web before backend)

### 7.1 Backend fixture `fixture-flood` (backend-flood-sources, milestone M2, within about 2 h)

`uv run python scripts/make_fixture.py --only flood [--now 2026-11-04T18:00:00Z]` writes `data/floods/fixture-flood/`
(time-relative to now unless `--now`), strictly validated against the contracts:

- **Place:** centre 36.79 N, 108.06 W (San Juan County, NM), AOI 12 km, procedural valley with a winding channel (it does
  not follow a real river; the demo badge and "SIMULATED FLOOD · DEMO" say so). Name "Ridge Fork River flood" (fictional),
  `synthetic: true`, kind river, level warning.
- **Gauges** (fictional LIDs that cannot collide with real ones): `ZZRF1` primary, rising through action and minor to
  moderate now, RFC forecast crest major-1 ft in 30 h (issued 2 h ago, CBRFC/ABQ), NWM series (short range 18 h, medium
  blend 10 days, flow); `ZZRF2` at action; `ZZRF3` below flood stage (`no_flooding`); `ZZRF4` `obs_not_current`; 72 h of
  observed stage and flow every 15 min; thresholds, three impacts lines, data attribution "Observations courtesy of U.S.
  Geological Survey".
- **Products** (text marked "[SYNTHETIC — NOT AN NWS PRODUCT]"): a Flood Warning (FL.W, H-VTEC `ZZRF1.2.ER`) with two
  versions (NEW, then EXT), a Flood Advisory (FA.Y) polygon, a Flood Watch (FA.A) with zone polygons.
- **Maps:** RFC FIM polygons along the channel (area stats), CatFIM moderate and major polygons for `ZZRF1`, NFHL zones
  (A, AE, floodway, 0.2 %; no zone X), NWM analysis polygons + high-flow reaches with `recur_cat` "10" and ">50".
- **Satellite:** classes raster + PNG with water, partial water, a cloud patch (≈ 30 %) and a no-data strip; one HLS
  granule 4 days old (`measured: true`, `login: not_configured`, `SAT_NOT_SET_UP` reason).
- **Bundle files:** every layer of §3.3 (`water_model` included), `warnings.json`, `gauges.json`, `satellite.json`.
- **Canned API answers** in `data/floods/fixture-flood/api/` for every route of §3.4 (list with fixture-flood and seven
  synthetic list-only floods across the lower 48 covering: emergency flash flood, major river, moderate river, minor
  gauge-only, advisory-only, watch-only, a past flood in 2025; detail; flood-alerts; river-gauges for the flood, per lid
  with series, and national; maps for each kind; model for each kind; satellite JSON + PNG; status), all
  contract-valid.
- A committed copy generated with `--now 2026-11-04T18:00:00Z` in `backend/tests/data/floods/fixture_api/` (tests).

### 7.2 Serving it

- `uv run python scripts/serve_fixture.py --port <api>` answers every flood route from `data/floods/*/api/` (and the
  fire routes as today). Web roles use it until the real routes are in `git log`
  (`brief 5 backend-flood-sources: M4` for list/detail; `brief 5 backend-flood-bundle-api: M3` for the rest).
- The real API (`FIRE3D_LIVE=0`) answers `fixture-flood` on every route from the bundle's frozen files, so waves 2-3 and
  the integration can use the real API with the fixture and real floods side by side.

### 7.3 Web fixtures (web-flood-overview)

`web/src/api/__fixtures__/floods/*.json`: plain copies (`cp`, no edits) of `backend/tests/data/floods/fixture_api/`, so
web tests check the same shapes the backend validates, plus `edgeCases.ts` built from them: no token (default), token
refused, picture only, Data Not Current, out of service, not defined, Flash Flood Emergency, Puerto Rico product
dropped, past flood ("Was in effect"), gauge without a forecast point, NWS down, gauges down, both down, empty list.
Until M2 lands, hand-written minimal fixtures per CONTRACT §16 are allowed and are replaced by the copies.

## 8. Tests at risk (update deliberately, in the same commit as the change)

**Backend** (must stay green; edits additive):
- `tests/test_endpoint_contracts.py` (fire bundles in `data/incidents`): untouched, frozen. Flood bundles live in
  `data/floods`, so it never sees one. The new `tests/test_flood_endpoint_contracts.py` isolates from the start: empty
  temporary `CACHE_DIR`, temporary `FLOODS_DIR` copy of `fixture-flood`, temporary registry, `LIVE_ENABLED=False`, and
  clears the flood catalog cache, `nws.reset_state()`, `extras.reset_state()`, `fhttp.reset_down_memos()` before and
  after (brief-4 lesson, `final-verification-4.json`).
- `test_config.py` (mask both secrets; `Authorization: Bearer` masked), `test_http.py` (`headers=` path; no auth in cache
  keys or logs; cross-host redirect drops it), `test_official_nws.py`, `test_local_alerts_nws.py` (fire defaults of the
  new `family`/`hazard` parameters), `test_api.py` / `test_api_live.py` (lifespan starts two tasks; flood task off with
  `FIRE3D_FLOODS=0`), `test_serve_fixture.py` (new routes answer contract-valid JSON), `test_contracts.py` (unchanged),
  `test_extras.py` (`order_by` default `OBJECTID`), `test_api_cli.py` (new commands).
- Secrets: with a fake `EARTHDATA_TOKEN` (monkeypatch) a mock transport proves the token is only in the PO.DAAC
  request's header, never in a URL, a log record (`caplog`), an error, a response body or a cache file (count-only).

**Web** (about 1,383 cases in 101 files today; all stay green):
- `ui/shell/views.test.ts` (`mapChromeOf` takes the event kind; five chromes), `state/workspace.test.ts` (defaults + the
  `hazard` URL parameter), `state/history.test.ts` (entry with `flood`), `state/timeZone.test.ts`.
- `map/overviewLayers.test.ts` (fire defaults of the new parameters; `CLUSTER_RADIUS_EXPR`; draw order; style validity),
  `map/userInput.test.ts` and `state/fireCard.test.ts` (regexes over `mapController.ts`, `SearchBox.tsx`,
  `OverviewCard.tsx`: keep the fire click path's shape; route flood hits before it), `map/layers.test.ts`.
- `official/runtime.test.ts`, `official/mapLayer.test.ts` (no fire weather in flood mode), `extras/client.test.ts`
  (`currentArea`), `location/search.test.ts` (second provider), `lib/dataCredits.test.ts`, `lib/fileNames.test.ts`.
- `ui/shell/ForensicWorkspace.test.ts`, `ui/shell/handoff.test.ts` (wave 3), `ui/public/fireView.test.ts` and the fire
  view's SSR snapshots after the `HazardDisc` split (must not change).
- Lint: scene changes add no warning (baseline 55, all `src/scene`).

**New guard tests:** `ui/shell/floodCopy.test.ts` (banned patterns over every flood copy file and rendered facts,
readouts, keys for every fixture case); `map/floodStyle.test.ts` (no green: hue 75°-165° with saturation > 25 % banned);
a fetch-spy test that mounts each flood chrome and fails on any request to a fire-only endpoint (`/api/incidents/`,
`/api/official/fire-weather`, `/api/official/calfire`, `/api/official/incident-record`, `/aircraft`); `floodProfile.test.ts`
(no model layer in Public).

## 9. Screenshot recipe

Run on your own ports (never 8000, 8710, 5173, 5180):

```
cd backend && uv run python scripts/make_fixture.py --only flood                       # once
cd backend && FIRE3D_LIVE=0 uv run uvicorn fire3d.api.app:app --port <api>              # or: uv run python scripts/serve_fixture.py --port <api>
cd web && VITE_API_TARGET=http://localhost:<api> PORT=<vite> npm run dev -- --port <vite> --strictPort
cd web && node scripts/shot.mjs "http://localhost:<vite><path>" ../docs/screenshots/brief5-<role>-<view>.png --w 1440 --h 1000 --wait <ms> --backend swiftshader
```

| View | Path | Wait | Notes |
|---|---|---|---|
| Public overview, Floods (minimal) | `/?hazard=flood` | 9000 | |
| Public overview, Floods (details) | `/?hazard=flood` + `--eval "await new Promise(r=>setTimeout(r,4000)); window.__workspace.getState().setOverviewDetails(true)"` | 9000 | |
| Command overview, Floods | `/?hazard=flood&preset=command` | 9000 | |
| Public flood view (fixture) | `/?flood=fixture-flood` | 12000 | compare side by side with `handoff-4/renders/FloodView.jpg` |
| … with the distance chip | add `--eval "…; window.__workspace.getState().setDevice({lat:36.95,lon:-107.9,accuracyM:30,tMs:Date.now()})"` | 12000 | |
| … reduced motion | add `--reduced-motion` (new flag, wave 1) | 12000 | circle still; no animation running |
| Command flood view, point + cursor in the forecast | `/?flood=fixture-flood&preset=command&sel=36.80,-108.05` + `--eval-after-wait "window.__flood.getState().setCursor(Date.now()+30*3600e3)"` | 12000 | |
| Command flood view, model on | add `--eval-after-wait "window.__flood.getState().setFloodLayer('model',true)"` | 12000 | MODEL tags, amber dotted |
| Forensic flood (fixture) | `/?flood=fixture-flood&ws=forensic` with `--quality low --shot-timeout 240000` | 25000 | |
| Forensic unprepared | `/?flood=<a real live id without a bundle>&ws=forensic` | 15000 | Prepare button |
| A real live flood (Public, Command) | `/?flood=$(curl -s localhost:<api>/api/floods \| jq -r '.floods[0].id')` | 12000 | if NWS lists none, say so in the report |
| Phones | any of the above with `--w 390 --h 844 --dpr 2` | same | also `--w 1024 --h 768` |
| Fire regressions | the brief-4 final set (`docs/screenshots/brief4-final-*.png` URLs, PLAN-4 §9) | same | compare; nothing may change |

Dev handles: `window.__store`, `__workspace`, `__flood` (new), `__mapRuntime`, `__sceneStore`, `__mapChrome()`. Check
`__mapChrome().unobstructed`, text contrast 4.5:1 over aerial and dark maps, keyboard (switch, hydrograph slider, gauge
picker), and no console error.

## 10. Roles, waves, schedule and finish estimate

### 10.1 Roles (ownership globs, acceptance, screenshots: `plan5-roles.json`)

| Wave | Role | Content | Hours (agent) | Ports API / Vite |
|---|---|---|---|---|
| 1 | `backend-flood-sources` | M1 contracts triple + config/secret/HTTP plumbing; M2 `fixture-flood` + fixture server; M3 NWS flood family + `sources/nwps.py` (riv_gauges, rfc_max_forecast, gauge detail, stageflow, reach streamflow) + recorder + samples; M4 flood catalog (grouping, naming, registry, sources) + `GET /api/floods`, `/status`, `/{id}`; SPEC rows | 4.5 (3.5-6) | 8751 / 5211 |
| 1 | `web-flood-overview` | hazard state, URL, history, selectors, five chromes (stubs for the flood views), switch, flood markers, groups, gauges, leader labels, bar status, list panel, legend, point card, search, Forensic entry list, flood client, web fixtures, tokens, `floodCopy.ts` + guard, credits, `shot.mjs --reduced-motion` | 3.5 (2.5-4.5) | 8752 / 5212 |
| 2 | `backend-flood-bundle-api` | `sources/water_maps.py`, `nfhl.py`, `opera.py` (+ token path), `usgs_water.py`; routes build/files/maps/model/satellite/flood-alerts/river-gauges/local-alerts hazard; bundle builder; live loop + auto-build; CLI + `check_bundle --hazard flood`; past floods (cut line); isolated endpoint contract test; SPEC §5.3, §8.9 | 5 (4-6.5) | 8753 / 5213 |
| 2 | `web-flood-public` | Public flood view (§4.4): `HazardDisc` split, `WaterTexture`, circle, title, distance maths, facts, key, flood map area layers, point card variant, `floodCheck.ts`; official flood web (`floodModel`, hooks, `FloodOfficialNow`) | 3.5 (2.5-4.5) | 8754 / 5214 |
| 3 | `web-flood-command` | M1 hydrograph (model + both variants); Command flood chrome, `FloodReadout`, layers drawer, legend chips, model and floodplain layers, phones | 3.5 (2.5-4.5) | 8755 / 5215 |
| 3 | `web-flood-forensic` | flood branch, assets, drapes, gauge bars, header, right panel, evidence, dock hydrograph, prepare, hand-off | 3.5 (2.5-5) | 8756 / 5216 |
| 4 | `integration` | part 1 (after the five others): real data end to end (live list names and groups checked against NWS, two real flood bundles built, every view with a real flood), cross-role fixes; part 2 (after Forensic): fold `contract5/*.md` into CONTRACT §16.16, README (floods, sources, credits, token set-up), SPEC check | 2.75 (2-3.5) | 8759 / 5219 |
| 5 | `final-check` | gates, screenshot set, reduced motion, safety and secret scans (both secrets, count only), fire regressions, report | 1.5 (1-2) | 8759 / 5219 |

**Every build role** gets one independent **review** (≈ 0.5 h; one reviewer, two lenses: (1) design and contract
fidelity: PLAN-5 §4 tables, the render, CONTRACT §16 shapes, tokens; (2) behaviour and safety: §5 wording, never merged,
not an all-clear, reduced motion, outages, secrets, fire regressions) on ports 8757 / 5217 (or 8758 / 5218 when two
reviews run at once), written to `docs/redesign/reports/review5-<role>.json` and `docs/screenshots/review5-<role>-*.png`,
in a clean worktree (`git worktree add <scratch>/review-<role> HEAD`, `web/node_modules` symlinked,
`FIRE3D_DATA_DIR`/`FIRE3D_CACHE_DIR` pointing at the main checkout's `data/`). Then one **fix** step (≈ 0.75 h) by a fixer
who owns the role's paths and commits `brief 5 <role>: review fixes`.

### 10.2 Milestone hand-offs inside a wave

- `web-flood-overview` imports flood types only after `brief 5 backend-flood-sources: M1 contracts` is in `git log`
  (target ≤ 1 h); before that it does tokens, styles, hazard state, URL, history, switch and selectors. It copies the
  web fixtures after `…: M2 fixture` (target ≤ 2 h).
- `web-flood-forensic` mounts `Hydrograph variant="dock"` after `brief 5 web-flood-command: M1 hydrograph` (target ≤ 1.25
  h into wave 3); it starts with assets, drapes and gauge bars.
- Web roles switch from `serve_fixture.py` to the real API when the backend milestone that serves their routes is in
  `git log` (§7.2).

### 10.3 Scheduling rule (at most 2 agents at once)

A free slot goes, in order, to: (1) a pending fix, (2) a pending review, (3) the next role whose `depends_on` roles are
built, reviewed and fixed. Waves are the default order: wave 1 = `backend-flood-sources` ∥ `web-flood-overview`; wave 2 =
`backend-flood-bundle-api` ∥ `web-flood-public`; wave 3 = `web-flood-command` ∥ `web-flood-forensic`; then integration,
then the final check. Integration part 1 may start while `web-flood-forensic` (or its review) still runs: it owns only
backend and non-Forensic files until Forensic is fixed.

### 10.4 Finish estimate

**Calibration.** Measured from commit times: brief 3's wave-1 roles, planned at about 5 h each, took 1.0-1.8 h
(us-catalog 00:36-01:38, us-web 00:36-02:25, us-pipeline 00:36-02:11, us-official 01:40-03:20 UTC, Oct 23); reviews
took 0.3-0.5 h and fix rounds 0.4-1 h; brief 4's view steps took 1-3 h each (Public fire view 3 h). The audits' totals
(backend about 98 agent-hours, web about 52) were not calibrated this way and assumed 3-4 parallel agents; with two
slots, the honest figure is the per-role hours of 10.1 scheduled by 10.3.

**Simulated schedule** (build starts about **21:45 UTC Nov 4**, right after this plan is pushed; the user's answers to
U1-U2 can arrive during wave 1; no usage-limit pause):

| Slot A | Slot B |
|---|---|
| 21:45 `backend-flood-sources` → 02:15 | 21:45 `web-flood-overview` → 01:15; review → 01:45; fix → 02:30 |
| review → 02:45; fix → 03:30 | 02:30 `web-flood-public` → 06:00; review → 06:30; fix → 07:15 |
| 03:30 `backend-flood-bundle-api` → 08:30; review → 09:00; fix → 09:45 | 07:15 `web-flood-command` → 10:45; review → 11:15; fix → 12:00 |
| 09:45 `web-flood-forensic` → 13:15; review → 13:45; fix → 14:30 | 12:00 integration part 1 → 13:45 |
| 14:30 integration part 2 → 15:30; final check → **17:00 UTC Nov 5** | |

- **Without pauses: about 17:00 UTC Thursday Nov 5 (9 AM Pacific).**
- **Most likely: about 20:00 UTC Nov 5 (12 PM Pacific)**, allowing about 3 h for one or two usage-limit pauses (brief 3
  had three, about 5 h in all).
- **Range: 13:00 UTC Nov 5 (5 AM Pacific) to 05:00 UTC Nov 6 (9 PM Pacific Nov 5)** (−20 % to +35 % on the work, plus up
  to 5 h of pauses). Pacific is PST (UTC−8) since Nov 1.
- Milestones reported to the user: wave 1 done (~03:30 UTC), real flood list live (~02:15), wave 2 done (~09:45), all
  views built (~14:30), finished (~17:00 + pauses).
- The critical path is backend-flood-sources → backend-flood-bundle-api → web-flood-forensic → integration → final
  check. If U1 = (c) (no past floods), take about 1 h off; if the grouping review on real data needs a second pass, add
  about 1 h.

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Grouping splits one flood into several or merges two | Named constants; tests on today's recorded answers; the integration reviews every live name and group against the NWS products and records the table in its report |
| R2 | Ids change after a restart, merge or split, breaking links | Registry + aliases; deterministic anchors; tests through a merge and a split |
| R3 | Live alerts lack the gauge id (H-VTEC): a warning linked to the wrong gauge | Place + river name first; product text when ambiguous; a test with two gauges on one river in one polygon |
| R4 | Unreliable sources: NWPS bbox lists time out; FEMA resets connections (8 of 14); USGS 429 from the shared cloud address; NOAA maps call themselves experimental | `riv_gauges` + `rfc_max_forecast` nationally, NWPS per gauge; retries, `DownMemo`, 30-day caches; per-layer `layer_status`; a missing layer reads "unavailable", never "no flooding" |
| R5 | Safety wording: a forecast, a model map or days-old satellite water read as "water now"; no layer read as "dry" | Per-layer labels with kind and time (D8); no satellite mi² in Public (D5); §5 strings; guard tests; both review lenses |
| R6 | `EARTHDATA_TOKEN` leaks (headers, logs, errors, cache files, GDAL) | Header only, host allow-list, `mask_secrets`, no GDAL auth, fake-token tests, count-only scans of tree, diffs and commit messages |
| R7 | Token path cannot be tried end to end (no token here) | Mock-transport tests; default path needs no token; the report says "untested with a real token"; the user can test later (§12) |
| R8 | Satellite water is 2-4 days old, blind under cloud; Earthdata GIS time metadata is stale and its default mosaic picks cloudy images | Lock to one granule; show image time and cloud share; amber after 3 days; `SAT_CAVEAT` |
| R9 | Fire regressions in shared files (about 45 "no incident = overview" checks) | `noEventOpen()`; additive parameters with fire defaults; fetch-spy test; brief-4 screenshot set re-shot by the final check |
| R10 | Test isolation (the brief-4 503/404 failure) | Isolated flood endpoint test from the start (§8) |
| R11 | Time zones: NWPS POSIX zones; `riv_gauges.obstime` has no zone; DST in hydrograph ticks | IANA zones from `regions`; `obstime` treated as UTC only after checking it against NWPS in a recorded sample; DST test |
| R12 | NWS may retire VTEC (PNS 26-62) | CAP `references` fallback key, tested |
| R13 | Contract churn while web builds on fixtures | M1 lands the full §16 types first; later changes additive and announced in `contract5` notes |
| R14 | Two slots, usage-limit pauses and SwiftShader slow the schedule | §10.3 rule; cut lines per role; `--quality low --shot-timeout 240000` for Forensic |
| R15 | The water circle's noise layers cost CPU on phones | Paused when hidden, still under reduced motion; fallback: pre-rendered noise moved by CSS transforms |
| R16 | Colour clashes: minor orange ≈ fire orange; flood edge ≈ selected-point blue | Fire markers hidden in Floods; shape and words everywhere; the selected point keeps its dot, halo and label |
| R17 | Large polygons (RFC FIM, NFHL, NWM) slow the map and bundles | Per-flood bbox queries, server-side simplification, paging ≤ 2,000, GeoJSON sources updated in place |
| R18 | No real flood listed at integration time | The fixture covers every case; the report says so; a recorded real answer is replayed through the fixture server |
| R19 | A river flood longer than 60 km | Cut to the reach around the primary gauge; `aoi_note` says so |
| R20 | IEM limits (2 phenomena per request; "not for highly trafficked sites") | Two requests per window; long caches; past floods only on request |

## 12. Decisions only the user can make (the build proceeds on the recommendation)

- **U1. Past floods (year lists).** (a) **Recommended:** "2026" and "2025" tabs listing river floods that reached
  moderate or major at a gauge, plus Flash Flood Warnings with a "considerable" or "catastrophic" damage threat or a
  Flash Flood Emergency; (b) every Flood and Flash Flood Warning (thousands a year; slow, cluttered lists); (c) current
  floods only for now (finishes about 1 h earlier; the year tabs come later). Needed by wave 2 (about 03:30 UTC Nov 5).
- **U2. A Flood Watch where no flooding is reported yet.** (a) **Recommended:** listed, but hidden by default behind a
  "Show watches" switch (watches can cover dozens of counties); (b) shown like the other floods; (c) not listed on its
  own, only attached to floods it overlaps. Needed during wave 1 (a default value only).
- **Optional action, not a decision:** the NASA Earthdata token (adds radar water maps that see through clouds, and
  the newest optical day). Make a free account at urs.earthdata.nasa.gov, choose "Generate Token", put
  `EARTHDATA_TOKEN=<token>` in the gitignored `.env` (never in chat or git), sign in once at search.earthdata.nasa.gov and
  download any one OPERA DSWx file so PO.DAAC is approved for the account, and renew the token when it expires (about
  60 days; check the date when you make it). Without it everything works; the satellite layer says
  `SAT_NOT_SET_UP_SHORT`.

## Appendix A. Ownership check

Run this snippet from the repo root (it is not saved as a script: this step writes documents only). It expands each role's `owns` globs (`*` stays inside one folder, `**` crosses folders) over `git ls-files` plus
the role's `planned_new` paths, and fails if two roles of one wave own the same path, a glob matches nothing, or a role
owns a `shared_frozen` path.

```python
import json, re, subprocess, sys
d = json.load(open('docs/redesign/plan5-roles.json'))
def rx(g):
    out, i = '', 0
    while i < len(g):
        if g.startswith('**/', i): out += '(?:.*/)?'; i += 3
        elif g.startswith('**', i): out += '.*'; i += 2
        elif g[i] == '*': out += '[^/]*'; i += 1
        elif g[i] == '?': out += '[^/]'; i += 1
        elif g[i] == '[':
            j = g.index(']', i); body = g[i+1:j]
            out += '[^' + body[1:] + ']' if body.startswith('!') else '[' + body + ']'; i = j + 1
        else: out += re.escape(g[i]); i += 1
    return re.compile('^' + out + '$')
files = set(subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split())
for r in d['roles']: files |= set(r.get('planned_new', []))
frozen = [rx(g) for g in d['shared_frozen']]
bad = 0
for wave in d['waves']:
    seen = {}
    for rid in wave:
        role = next(r for r in d['roles'] if r['id'] == rid)
        if role.get('owns_all'): continue
        for g in role['owns']:
            m = {f for f in files if rx(g).match(f)}
            if not m: print('no match', rid, g); bad += 1
            for f in m:
                if f in seen and seen[f] != rid: print('clash', f, seen[f], rid); bad += 1
                seen[f] = rid
                if any(z.match(f) for z in frozen): print('frozen', rid, f); bad += 1
sys.exit(1 if bad else 0)
```
