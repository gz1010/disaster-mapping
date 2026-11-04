# Brief 5 build plan: floods across the lower 48 (PLAN-5)

Planner, 2026-11-04 (20:30-21:30 UTC), on branch `claude/cool-mayer-ki7to6` at f80d846; **revised 21:15-22:20 UTC after an
independent critique (30 problems, all handled: see the Critique log at the end)**. Inputs: `BRIEF-5.md` (the
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
ever presented as "safe". Seven build roles run two at a time (the machine has 4 CPUs), each with one review and
one fix step, then an integration and a final check. **Estimated finish: about 00:30 UTC Friday Nov 6 (4:30 PM Pacific,
Thursday Nov 5), range 18:00 UTC Nov 5 to 09:15 UTC Nov 6** (section 10.4; without usage-limit pauses about 21:30 UTC
Nov 5).

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
- **The second secret overrides one CLAUDE.md line.** CLAUDE.md still says "The only secret is `FIRMS_MAP_KEY`". The
  user approved `EARTHDATA_TOKEN` as a second secret in BRIEF-5 decision 2, so for brief 5 both are secrets, with the
  same rules. Every role prompt states this override; nobody edits CLAUDE.md (frozen; the user decides, §12 U3). The
  final check scans for both (count only).
- **Gates:** `cd backend && uv run pytest -q`; `cd web && npm run typecheck && npm run lint && npm test && npm run build`.
  Lint baseline 55 warnings, all in `src/scene`: add none. Keep `SPEC.md`, `backend/fire3d/contracts.py` and
  `web/src/api/types.ts` (with its re-export of `web/src/api/floodTypes.ts`) consistent; a test checks the field names
  (section 6).
- **Ports:** API 8751-8760, Vite 5211-5220 (per role in `plan5-roles.json`). Never 8000, 8710, 5173, 5180. Stop every
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
| D5 | "FLOODED AREA" fact on the Public card (BE Q5) | **No area number in Public.** The row reads "FORECAST FLOODED AREA (NWS, 5 DAYS)" with the value "Mapped" (sub-line: NWS's experimental 5-day map, its issue time, "see the map") or "Not mapped here" (only when the map answered, with `RFC_FIM_OUTSIDE`). **No satellite mi² either.** Command shows both numbers with their caveats (`RFC_FIM_AREA_COMMAND`, `SAT_AREA_COMMAND`) | NWS publishes no area: the number would be Fire-3d's own sum of NWS polygons, which also include the normal river channel (the reason the satellite number was dropped). Satellite water is days old and includes normal water (critique C6) |
| D6 | Satellite water without the NASA login (BE 3.7 vs SRC 6.6) | **Measured DSWx-HLS from NASA Earthdata GIS** (no login) is the default; GIBS tiles are the picture fallback; the token adds the radar product DSWx-S1 and the newest optical day | SRC 6.6(a) measured it today; the backend audit predates that finding |
| D7 | Where the Fires / Floods switch sits (Q-W1) | **Top bar title slot**: "United States · ( Fires \| Floods )", both presets, and on Forensic's entry page | Decision 1 ("behind a switch"); the title says what the map lists |
| D8 | Design key "Flooded area now" (Q-W2) | **Each layer named with its own time** ("Water seen by satellite · Oct 31, 4:06 PM (4 d ago)", "NWS forecast flooded area · issued 10:20 AM") | Neither layer is "now" |
| D9 | Gauge colours (Q-W3) | NOAA's hues for action to major, tuned for the dark map; **grey hollow diamond instead of NOAA's green "No Flood"**, grey "?" instead of its light blue "not defined" | Green reads as "safe"; light blue is our flood colour |
| D10 | Circle leader end (Q-W4) | **The primary member river gauge**, drawn as its category diamond with a halo; a flood with no member gauge (flash, areal, watch): the representative point of its largest NWS polygon, drawn as a small pink ring | Brief 4 keeps the light-blue dot for "your selected point"; a nearby gauge on another stream must never stand for a flash flood (C4) |
| D11 | Public facts (Q-W5) | Seven rows **per kind** (§4.4): river floods show **FORECAST CREST (NWS)** (or **FORECAST HIGH (NWS)** when the highest forecast value is the last one, C7) in place of REPORTED (coordinates move to Command); flash and areal floods show **FLASH FLOOD DETECTION (NWS)** and **DAMAGE THREAT (NWS)** verbatim and a river-gauge row from member gauges only | A flood has no single reported location; river and flash floods are checked differently (C4) |
| D12 | National Water Model (Q-W6, SRC 9.5) | **Never in Public.** Command: on the hydrograph's flow view by default, off on the map until switched on in Layers. Forensic: off until switched on | Decision 3; brief-4 rule "no model output in Public" |
| D13 | Hydrograph play button (Q-W7) | **None.** The handle reads values. At or before now, the map shows the NWS products in effect at the handle's time; **after now it keeps the products in effect now** with `CURSOR_FUTURE_PRODUCTS`, and readout lines keep "until {time}" (C1) | Nothing on the map moves continuously; an NWS end time is not a forecast of when flooding ends, and products get extended |
| D14 | Click on a flood in Command (Q-W8) | **Opens the Command flood view directly** | Floods need no preparation for the 2D views |
| D15 | USGS API key (SRC 9.2) | **No key** (a third secret would need the user's approval). On HTTP 429: "USGS data could not be reached right now (too many requests); try later." | Enough on the user's own computer (1,000 an hour) |
| D16 | FEMA zones (SRC 9.4) | **Only the 1% floodplain (SFHA, with floodway) and the 0.2% band**, with FEMA's own effective date; never zone X "AREA OF MINIMAL FLOOD HAZARD" shapes or text; "Not in FEMA's mapped 1% floodplain" only where FEMA's availability layer says a digital map exists (C19) | CLAUDE.md: never "low risk"; official layers keep their own times |
| D17 | `fixture-flood` in real lists | **Never listed** by the real API (opened by URL, demo badge); the fixture server lists it with seven synthetic list-only floods, all with **fictional names, a DEMO tag wherever `synthetic` is true, and a fictional issuer** ("NWS Example Office (synthetic)", office `KZZZ`); each answers detail, alerts, gauges and maps (C26) | A simulated flood must not sit among real ones or carry a real office's name |
| D18 | National gauge status source | `riv_gauges` map service (one request, 0.2 s), also for **nearby gauges** (envelope query); **NWPS only per gauge**, with a 20 s timeout, one retry and an outage memory (its lower-48 query timed out in 2 of 5 tries; C18) | SRC 2.1-2.2 |
| D19 | Flood status words | The circle names the NWS product ("FLOOD · WARNING"), never "ACTIVE", "ENDED", "OVER" or "CLEAR" | Official level only, never Fire-3d's inference |
| D20 | Hydrograph model line | NWM flow drawn **on the flow axis only**, never converted to a stage; in flow mode the handle shows NWS flow and NWM flow on **separate lines**, the model's prefixed "MODEL · NWM · EXPERIMENTAL"; no NWM line when the gauge has no `reach_id` (C28) | Converting would mix the model with NWS's rating curve |
| D21 | FEMA floodplain in Public (decision 2 says "as background") | **A Layers-drawer toggle in Public, off by default**, with `NFHL_LABEL` (and its effective date) and `NFHL_NOTE` in the key when on; off by default in Command and Forensic too (C13) | Decision 2 lists it; off by default keeps the Public map about current water |
| D22 | CatFIM (NWS category flood maps) | **"NWS category flood maps (experimental)" toggle, off by default**, in the Command drawer and the Forensic Layers tab, for the primary gauge's forecast category (else its observed category); never in Public (C14) | It is a map library, not a forecast; useful to experts only |
| D23 | Evacuations for a flood | `/api/extras/evacuations?bbox=&hazard=flood`: Oregon's feed is wildfire-only, so for floods Oregon answers not-available (`OR_EVAC_FIRE_ONLY`); Cal OES zones show their own `EVENT_TYPE` verbatim; flood rows use flood wording (`EVAC_NONE_LISTED`), never the fire rows' text (C5) | "None listed" from a fire-only feed would read as "no flood evacuations" |
| D24 | Per-flood and per-point outages | Each official answer has its own "could not be reached" string (`ALERTS_UNAVAILABLE`, `GAUGES_UNAVAILABLE`, `RFC_FIM_UNAVAILABLE`, `CATFIM_UNAVAILABLE`); `NO_PRODUCT`, `RFC_FIM_NONE`, `GAUGE_BELOW_STAGE` and `NO_GAUGE_NEAR` render **only when that answer's status is `available`** (C3) | "No NWS flood product here" while NWS is unreachable would be false |
| D25 | Satellite pixels with no view | Cloud (253) **and no data (255)** drawn with the same grey "no view" hatch, never transparent; the image's edge is outlined ("Edge of the satellite image"); outside it, the point check says so (C2) | Transparent no-data looks like "not water", i.e. dry |

## 2. Sources by layer (with credit lines)

All checked from the cloud on 2026-11-04 (SRC 1-7); terms read on the official pages named. Times shown are always the
source's own. Requests go through `fire3d.http` (cache, retries, limiter, outage memory) with the Fire-3d User-Agent.

| Layer | Source and request | Label in the app | Credit line (exact) | Terms (read 2026-11-04) | Refresh / cache |
|---|---|---|---|---|---|
| Event list (live) | `api.weather.gov/alerts/active?area=<48+DC>&event=<7 flood names>`; grouped by VTEC key, then per river or area | "Official NWS flood products" | National Weather Service | weather.gov/disclaimer (public domain; no implied endorsement; do not alter and present as official) | 2 min |
| River gauge of a warning | **List join (bulk, one request):** IEM `api/1/nws/current_flood_warnings.geojson` (`hvtec_nwsli`, `wfo`, `eventid`), used only as a join key, never shown. **Shown H-VTEC and ambiguity:** product text (`/products/types/{FLW\|FLS}/locations/{office}`, `/products/{id}`), per flood on demand (C9) | (data join) | National Weather Service (IEM copy when used) | as above; IEM disclaimer (public domain, attribution appreciated) | list join 5 min; product text for good per product |
| Event list (past) | IEM `vtec_events_bystate.py` (49 requests a year, one-time background build, §3.6), `api/1/nws/emergencies.json` (Flash Flood Emergencies), `vtec_event.py` per event on demand | "Archived NWS product" | National Weather Service, archived copy via the Iowa Environmental Mesonet (Iowa State University) | mesonet.agron.iastate.edu/disclaimer.php | for good (closed years), 30 days (2026) |
| Gauges, national and nearby | `mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer` layers 0 (observed) and 15 (forecast); nearby gauges of any status by an envelope query on layer 0 (one request, C18) | "Gauge at minor / moderate / major flood stage (NWS)" | NOAA National Water Prediction Service (NWS) | NWS disclaimer | 5 min |
| Official forecast points, national | `maps.water.noaa.gov/server/rest/services/rfc/rfc_max_forecast/MapServer/0` | (catalog input) | NWS River Forecast Centers | NWS disclaimer | 10 min |
| Gauge detail and series | NWPS `api.water.noaa.gov/nwps/v1/gauges/{lid}` and `/stageflow` (one gauge per request; timeout 20 s, one retry, outage memory) | "Measured (USGS, provisional)"; thresholds, impacts "NWS" | NOAA National Water Prediction Service (NWS); per gauge its `dataAttribution` ("Observations courtesy of U.S. Geological Survey") | NWS disclaimer (water.noaa.gov has no separate page) | detail 6 h, series 10 min |
| Official river forecast | NWPS `stageflow.forecast` | "Official NWS river forecast · <RFC> · issued <time>" | NWS <RFC name>, issued by NWS <office> | NWS disclaimer | 10 min |
| Forecast flooded area | `rfc/rfc_based_5day_max_inundation_extent` layer 0 polygons (one per NWM reach, `feature_id`) + layer 3 river lines (`feature_id`, `nws_station_id`, `influential_forecasts`) to tie reaches to member gauges, simplified (`maxAllowableOffset=0.0002`, `geometryPrecision=5`) | "NWS forecast flooded area (next 5 days) · experimental" | NOAA/NWS National Water Center (experimental) | NWS disclaimer | 15 min |
| Flooded area by category | `fim_libs/static_stage_based_catfim` (gauge + its forecast category) | "What <category> flooding covers here (experimental NWS map library)" | NOAA/NWS National Water Center (experimental) | NWS disclaimer | 30 days |
| Warning polygons | from the alerts. Zone-based products (most watches): **grouping** uses the CAP `geocode.SAME` county codes with the packaged county shapes (`regions`' `us_counties.geojson`), no request; **drawing** uses `/zones/{county\|forecast}/{UGC}` on demand (at most 20 per answer, then county shapes with `ZONES_AS_COUNTIES`), prefetched by the live loop (C9) | as the product | National Weather Service | NWS disclaimer | with the alert; zones 30 days |
| Water seen by satellite (default) | NASA Earthdata GIS `OPERA_L3_DSWX-HLS_V1_B01_WTR/ImageServer` `exportImage` (raw classes, one granule locked) | "Water seen by satellite · <date, time> (<age>)" | Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1) via NASA Earthdata GIS; contains modified Copernicus Sentinel data | earthdata.nasa.gov data-use guidance (CC0, cite); podaac.jpl.nasa.gov/CitingPODAAC | search 6 h; images 30 days |
| Water seen by satellite (token) | CMR search + PO.DAAC download of `B01_WTR` for DSWx-S1 (radar) and the newest DSWx-HLS, `Authorization: Bearer` | same, plus "radar (sees through clouds)" for S1 | NASA JPL OPERA DSWx-S1 (PO.DAAC); contains modified Copernicus Sentinel data | as above | granules 30 days |
| Satellite picture (fallback) | NASA GIBS WMTS `OPERA_L3_Dynamic_Surface_Water_Extent-HLS` / `-Sentinel-1` (z ≤ 12) | "NASA picture, <date> (not measured here)" | NASA JPL OPERA DSWx via NASA GIBS | as above | daily |
| Background floodplain | FEMA NFHL `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28`, `SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2%'`; layer 0 (NFHL availability) first; layer 3 (FIRM panels, `EFF_DATE`) for the effective date (C19) | "FEMA 1% annual-chance floodplain (background) · effective {date}" | Flood zones: FEMA National Flood Hazard Layer (effective) | ArcGIS item ae38b6f9…: "as is", user assumes all risk; no logo, no endorsement | 30 days, 4 tries |
| Model | `maps.water.noaa.gov/…/nwm/ana_inundation_extent`, `ana_high_flow_magnitude`, `mrf_gfs_5day_max_inundation_extent`; NWPS `/reaches/{reachId}/streamflow` | "Model output (NOAA National Water Model) · experimental" | NOAA/NWS National Water Center, National Water Model (experimental model output) | NWS disclaimer; water.noaa.gov/about/api ("not an official forecast product") | hourly / 6 h |
| River lines | `reference/static_nwm_flowlines` | — | River lines: NOAA/NWS National Water Center (NWM) | NWS disclaimer | 30 days |
| Past observations | USGS `api.waterdata.usgs.gov/ogcapi/v1/collections/continuous` (00065 stage, 00060 flow), no key; NWPS historic crests | "Measured (USGS, provisional)" / "Historic crests (NWS)" | U.S. Geological Survey (provisional data) | usgs.gov copyrights-and-credits; provisional-data statement | 30 days |
| Terrain | 3DEP (bundle), Mapterhorn (map) | — | as today | as today | as today |
| Evacuations, local officials' messages | `/api/extras/evacuations?bbox=&hazard=flood` (new parameter, fire default; Oregon's wildfire-only feed answers not-available for floods, D23), `/api/official/local-alerts?bbox=&hazard=flood` | as today, flood wording | as today | as today | as today |

**Do not use:** NWPS `gauges?bbox=` for any list, national or nearby (504 after 60 s; C18), the `maps.water.noaa.gov/flash` folder (token), legacy
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
  `mask_secrets` masks both secrets, any `Authorization: Bearer …` text, and the values of pre-signed S3 query
  parameters `X-Amz-Security-Token`, `X-Amz-Signature` and `X-Amz-Credential` (PO.DAAC redirects there; C17); the
  module doc says "two secrets".
- **HTTP** (`http.py`, additive): `get`/`stream_download` take `headers=`; an `Authorization` header is allowed only
  to the NASA Earthdata host allow-list, which is **only `archive.podaac.earthdata.nasa.gov`** (CMR search works
  without a login; a host is added only when a recorded flow needs it, with a `contract5` note; C17); it never enters a
  cache key, a logged URL or an error text; redirects to another host drop it (httpx behaviour, proven by a
  mock-transport test, which also proves no `X-Amz-*` value reaches a log record or an error, count-only).
- **NWS** (`sources/nws.py`, additive, fire defaults): `normalize_alert(feature, family="fire"|"flood")`, a cached
  national `flood_active()` request (same `NWS_LIMITER`, 2 min), `product_hvtec(alert)` (product text, cached for good,
  per flood on demand, never in the list build),
  `local_in_scope(code, *texts, hazard="fire")` (floods keep CEM/LAE that mention flood, water, levee or dam),
  `bypoint_events(rows, phenomena=("FW",))`, a label table for FL/FA/FF × W/Y/A, zone type from the `affectedZones` URL.
- **Router:** `api/floods.py`, mounted with one `include_router` line in `api/app.py`; it also serves
  `/api/official/flood-alerts` and `/api/official/river-gauges` so `api/official.py` changes only by the
  `hazard=flood` parameter of local alerts. A second live task starts in the `lifespan`.

### 3.2 The flood catalog and event grouping (`floods/catalog.py`, `grouping.py`, `naming.py`, `registry.py`)

**Inputs (live), five national requests per list build, cached 5 min (C9):** NWS flood products (one request, through
`NWS_LIMITER`), `riv_gauges` layer 0 `status in ('action','minor','moderate','major')` and layer 15 (one each),
`rfc_max_forecast` (one), IEM `current_flood_warnings` (one; H-VTEC join keys). **Nothing else in the list build:** no
zone outline, no product text, no gauge detail and no series (those are per flood, on demand, or prefetched by the
live loop in the background). A test builds the list cold on recorded inputs and fails above
`MAX_LIST_UPSTREAM_REQUESTS` = 6 upstream requests; the list's NWS share is one request per 2 minutes, so fire weather
calls on the same limiter are never starved.

**Rules** (named constants in CONTRACT §16.8; each tested on recorded answers):

1. **Keep** products with `status: Actual`, phase in effect or upcoming (`nws.live_phase`), a UGC in a lower-48 state
   or DC, and a geometry (or zones) touching the lower 48. Keep gauges whose `state` is lower 48 or DC. (Today this
   drops the Puerto Rico Flash Flood Warning.)
2. **Link gauges to river products (FL.*):** first by the H-VTEC NWSLI of the IEM bulk join (the warning's office,
   phenomena, significance, ETN and year match an IEM row); else the gauge point lies inside the product polygon
   buffered by `LINK_BUFFER_KM` (2 km) **and** its `waterbody` matches the river named in the CAP description ("<River>
   (at|near|above|below) <Place> affecting <County>", token match). When several gauges still qualify, the product text's
   H-VTEC decides, fetched in the background (live loop) and used from cache only, never in the list build.
3. **Join into one flood** (union-find) when two members share a VTEC event key (office, phenomena, significance, ETN,
   **year**); share a gauge **while both memberships overlap in time** (gap ≤ `GAUGE_ACTIVE_H`; the same gauge flooding
   again weeks later is a new flood, C8); are river members of the same river (normalised name tokens) within
   `SAME_RIVER_KM` (25 km); or are flash/areal products whose polygons overlap by `AREAL_OVERLAP` (30 % of the smaller)
   or lie within `AREAL_NEAR_KM` (10 km) and were issued within `AREAL_NEAR_H` (12 h). River and flash products never
   join by distance alone. If VTEC is missing (NWS PNS 26-62), the fallback key is the CAP `references` chain.
4. **Watches** (FA.A, FF.A, FL.A) never bridge two floods: they attach to every flood they overlap; a watch that
   overlaps none is its own flood at level `watch`, hidden by default behind "Show watches" (user decision U2). Overlap
   of a zone-based watch is tested with its CAP `geocode.SAME` county codes against the packaged county shapes (no
   request; C9); its drawn outline comes later, on demand.
5. **Gauge-only:** a gauge at minor or worse that no product names forms a flood at level `gauge_only` (D2).
6. **Fields:** `bbox_lonlat` = union of member polygons and gauge points; point = the primary gauge, else the
   representative point of the largest polygon; `state`, `states`, `county`, `time_zone` from `regions` (IANA; never
   NWPS's POSIX zones). **Primary gauge** = highest observed category, then highest NWS forecast category, then largest
   flow. **Kind:** `river` (any FL.* or gauge), else `flash` (any FF.W), else `areal`. **Level:** the highest product in
   effect: warning > advisory > watch, else `gauge_only`; `emergency` when a Flash Flood Emergency tag is present.
   **Max category:** highest observed or NWS-forecast category among member gauges.
7. **Start** (`started_ms` + `started_basis`): in the list, the earliest of a NEW product's VTEC begin (not
   `000000T0000Z`), the oldest message in the `references` chain, and the registry's first-seen time (basis
   `first_seen`, shown "Seen by Fire-3d since"). The first crossing of flood stage in a member gauge's 30-day series
   refines it (basis `gauge`) **only when that series is already cached** (detail view or the live loop's background
   prefetch); the id never changes because of it (rule 10 pins it).
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
10. **Stable ids:** the registry maps member keys to ids with `first_seen_ms`. VTEC keys (they include the year) are
    permanent. **Gauge keys are episodes**, `NWSLI@first_seen_ms`, retired once their flood has been inactive longer
    than `INACTIVE_LISTED_H`; the same gauge flooding again later gets a new episode key and a new id (C8). A flood takes
    the id of its oldest registered live member; merges keep the older id and list the other in `aliases`; a split
    keeps the id on the part with the anchor. The registry also keeps each id's **last-known summary** (rule 13).
    Without the registry ids are still deterministic. Tests: one gauge flooding twice 30 days apart gives two ids, in
    the live list and in the year list.
11. **Sources and outages:** `sources[]` = `nws_alerts`, `nwps_gauges`, `rfc_forecasts` (+ `iem_archive` for past
    years), each with `status`, `retrieved_ms`, `stale`, `reason`. NWS down → floods from gauges only (reason
    `FLOOD_NWS_DOWN`); gauges down → products only (`FLOOD_GAUGES_DOWN`); both down → bundles on disk only
    (`FLOOD_LISTS_DOWN`); an id the lists cannot decide answers **503** `FLOOD_LISTS_503`, never 404. List cache 5 min,
    60 s while degraded.
12. **Order:** `emergency` first, then max category major > moderate > (flash warning) > minor, then level warning >
    advisory > gauge_only > watch, then gauges in flood, then `updated_ms` (CONTRACT §16.8 `floodRank`, same in web).
13. **Old links keep working (C20).** `GET /api/floods/{id}` resolves in order: the live list → the year lists (once
    backend-flood-live adds them) → a registry alias (answers the canonical summary; the web replaces the URL with the
    canonical id) → the bundle's frozen summary on disk → the registry's last-known summary → 404. `resolved_from`
    says which; for `bundle` and `last_known` the views show `FLOOD_LAST_KNOWN`. Tests: an old id after a merge, and an
    id 48 h after its flood left the live list.

Wave 1 ships the catalog with `GET /api/floods` (live), `/api/floods/status` (from the list until the loop runs) and
`GET /api/floods/{id}` (rule 13, without the year step), so real floods are visible from wave 1 on.

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
- **Forecast flooded-area figure (C6):** `stats.area_km2` sums only the RFC FIM polygons whose `feature_id` lies on a
  layer-3 river line whose `nws_station_id` or `influential_forecasts` names a **member** gauge of the flood (never a
  crop of everything in the bbox); `stats` is null when that join fails. It is Fire-3d's measurement of an NWS map and
  includes the river channel: Command shows it with `RFC_FIM_AREA_COMMAND`, Public never shows it (D5).
- **FEMA (C19):** layer 0 (availability) decides whether a digital FEMA map exists for the area (`availability`:
  `mapped` / `no_digital_map` / `unknown`); layer 3 (FIRM panels) gives `EFF_DATE` (oldest and newest effective date
  over the area); layer 28 the zones. `NFHL_OUTSIDE` only where `availability` is `mapped`; else `NFHL_NO_MAP` or
  nothing. The GeoJSON route has no zoom limit (`min_zoom: null`; FEMA's 1:36,112 limit applies to its export images
  only, which Fire-3d does not use).
- **Frozen files carry absolute times only (C16).** `satellite.json`, `warnings.json` and `gauges.json` never store a
  relative age ("4 d ago"); the web computes ages from `acquired_ms` / `observed_ms` at render time. A test serves a
  bundle built 7 days earlier and checks the shown age is 7+ days.

### 3.4 API routes (`api/floods.py`; exact shapes CONTRACT §16.7)

| Method | Path | Answer | Role (milestone) |
|---|---|---|---|
| GET | `/api/floods?mode=live\|historical&year=` | `FloodListResponse` | sources M4 (live), live M2 (historical) |
| GET | `/api/floods/status` | `FloodLiveStatus` | sources M4 (from the list), live M1 (from the loop) |
| GET | `/api/floods/{id}` | `FloodDetailResponse` (rule 13 chain; 404 only at its end; 503 lists down) | sources M4, year step live M2 |
| POST | `/api/floods/{id}/build?force=` | `JobStatus` (409 fixture / outside lower 48) | bundle-api M2 |
| GET | `/api/floods/{id}/files/{path}` | bundle file (gzip, ETag, traversal-safe; the fire helper made root-taking) | bundle-api M2 |
| GET | `/api/floods/{id}/maps?kind=rfc_fim\|catfim\|nfhl&lid=&category=` | `FloodMapResponse` | bundle-api M3 |
| GET | `/api/floods/{id}/model?kind=nwm_analysis\|nwm_5day\|nwm_high_flow\|nwm_series&lid=` | `ModelOutputResponse` | bundle-api M3 |
| GET | `/api/floods/{id}/satellite?at_ms=` | `SatelliteWaterResponse` | bundle-api M3 |
| GET | `/api/floods/{id}/satellite.png?granule=` | PNG (lon/lat bounds in the JSON) | bundle-api M3 |
| GET | `/api/official/flood-alerts?flood=\|bbox=&at_ms=` | `FloodAlertsResponse` | bundle-api M3 |
| GET | `/api/official/river-gauges?flood=\|bbox=\|lid=\|scope=national&min=action&series=0\|1&at_ms=` | `RiverGaugesResponse` (`bbox` and nearby gauges from `riv_gauges` by envelope; NWPS per `lid` only) | bundle-api M3 |
| GET | `/api/official/local-alerts?bbox=&hazard=flood` | existing `LocalAlertsResponse`, flood keywords | bundle-api M3 |
| GET | `/api/extras/evacuations?bbox=&hazard=fire\|flood` | existing `EvacuationsResponse`; `hazard=flood` drops Oregon's wildfire-only feed (not-available, `OR_EVAC_FIRE_ONLY`) and keeps Cal OES `event_type` verbatim (D23) | bundle-api M3 |

`fixture-flood` is answered by every route from its bundle's frozen files, marked `synthetic`. Past times (`at_ms`
before the live window) answer from the IEM archive (alerts), USGS (gauge observations), or
`not_available_for_past_dates` (RFC forecasts, NOAA maps, NWM).

### 3.5 Live refresh (`floods/live.py`; role backend-flood-live, C11)

A **second asyncio task** in `lifespan` when `FIRE3D_LIVE=1` and `FIRE3D_FLOODS=1`; its own state; the fire loop is not
edited and a flood failure cannot stop it. Every `REFRESH_S` (15 min): rebuild the live list; append new NWS product
versions and gauge readings to each ready live bundle (`warnings.json`, `gauges.json`, atomic, under
`update_manifest`); queue a `refresh` job when the RFC map was updated or a newer satellite image covers the area (no
terrain rebuild). **Background prefetch** (its own small budget, ≤ 20 requests a cycle, NWS calls on `NWS_LIMITER`):
the product text of new river products (H-VTEC), member gauges' 30-day series (start refinement, rule 7), and the zone
outlines of new zone-based products (C9). First cycle: auto-build the 4 most severe floods, one after another (D4).
`/api/floods/status`: `active_floods` and `gauges_in_flood` are null when the lists could not be read, never 0.

### 3.6 Past floods (role backend-flood-live, milestone M2; cut line; user decision U1)

Measured during this revision (2 requests, C29): `vtec_events_bystate.py` (RI 2025: 85 events, 0.8 s) gives
`phenomena`, `significance`, `eventid`, `wfo`, `issue`, `expire`, `locations`, `area` and `hvtec_nwsli`, but **no H-VTEC
severity, no damage tag and no emergency flag**. IEM's API description has a storm-based-warning item with
`damagetag` and `is_emergency`, and a `/api/1/nws/emergencies.json` list of Flash Flood Emergencies ("not official",
IEM's words); the bulk route that serves damage tags per warning was not identified.

- **Year list** (`mode=historical&year=2026|2025`), built **once per year in the background** (49
  `vtec_events_bystate` requests at IEM's 30 a minute, about 3-10 min; cached for good for closed years, 30 days for
  2026's past months) plus one `emergencies` request. The year tab shows "Preparing past floods…" until it is done.
- **`PAST_RULE` (target, U1 (a)):** river Flood Warnings whose H-VTEC severity reached 2 (moderate) or 3 (major), and
  Flash Flood Warnings with a "considerable" or "catastrophic" damage tag or an Emergency. The role first spends ≤ 10
  requests finding a bulk IEM route for severity and damage tags (≤ 60 requests a year in all). **If there is none,
  `PAST_RULE_FALLBACK`:** every river Flood Warning at a forecast point (FL.W with an NWSLI), grouped by gauge episode,
  plus every Flash Flood Emergency; the year tab's foot then says `PAST_RULE_NOTE_FALLBACK`. Per-event product text
  (`vtec_event.py`) is fetched only when a past flood is opened.
- **Ids agree with live ids:** the year-list builder looks up the registry by VTEC key first, so a 2026 flood seen live
  keeps its live id in the 2026 tab; gauge episodes follow rule 10.
- **Per layer:** warnings yes (IEM, archived copy); gauge observations yes (USGS v1, provisional); thresholds and
  impacts are today's values (`THRESHOLDS_TODAY`); RFC forecasts, NWS forecast maps and NWM: "not available for past
  dates"; satellite water yes (Earthdata GIS from 2023; PO.DAAC with the token); FEMA today's map (background).

### 3.7 Satellite water and the optional `EARTHDATA_TOKEN` (`sources/opera.py`, `floods/satellite.py`)

- **Default (no token, must work):** search the Earthdata GIS catalog for DSWx-HLS granules over the flood's area in
  the last 10 days (`category=1`), choose the newest with the least cloud over the area, **lock to that one granule**
  (`esriMosaicLockRaster`, so the image time is exact; the service's own time metadata is stale), and `exportImage`
  the raw classes (`renderingRule {"rasterFunction":"None"}`) twice: in EPSG:4326 for the 2D overlay PNG (rendered
  server side: water `#2a8ce6`, partial water lighter, **cloud (253) and no data (255) the same grey "no view" hatch,
  never transparent** (D25); ocean (254) transparent; outside the image transparent, with the image's edge drawn by
  the web from `bounds_lonlat`) and in the bundle's UTM grid for `water_satellite.bin` (cells outside the image =
  255). Stats: water, partial, cloud and no-data shares over the area (measured). A palette test checks 253 and 255
  are never transparent.
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

| Layer | Endpoint | Kind | Coverage note when answered (backend-sent, exact in §5) | When it could not be reached (C3) |
|---|---|---|---|---|
| NWS products (text, polygons) | `/api/official/flood-alerts` | official | `NO_PRODUCT` when none | `ALERTS_UNAVAILABLE` |
| Gauges, categories, RFC forecast | `/api/official/river-gauges` | official (USGS measures; NWS categorises and forecasts) | `GAUGE_NOT_ALL_CLEAR` | `GAUGES_UNAVAILABLE` |
| NWS forecast flooded area, CatFIM | `/api/floods/{id}/maps` | official source, NWS-labelled experimental | `RFC_FIM_NOTE`, `RFC_FIM_OUTSIDE`, `CATFIM_NOTE` | `RFC_FIM_UNAVAILABLE`, `CATFIM_UNAVAILABLE` |
| FEMA floodplain | `/api/floods/{id}/maps?kind=nfhl` | official background | `NFHL_NOTE` | `NFHL_DOWN` |
| Water seen by satellite | `/api/floods/{id}/satellite` | observation (NASA) | `SAT_CAVEAT` | `SAT_UNAVAILABLE` |
| National Water Model | `/api/floods/{id}/model` | **model output** (`model_output: true`, not an official envelope) | `MODEL_CAVEAT` | `MODEL_UNAVAILABLE` |

Never summed, never drawn as one layer, never in one block; the web reads them from different endpoints. **An
absence sentence needs an answer (D24):** `NO_PRODUCT`, `RFC_FIM_NONE`, `GAUGE_BELOW_STAGE` and `NO_GAUGE_NEAR` render
only when the envelope's `status` is `available`; with `unavailable` the row shows the layer's "could not be reached"
string, and with `not_available_for_past_dates` its past-date string. Edge-case fixtures cover each layer down, and a
web test checks that the three absence strings never render then.

## 4. Web design

Paths under `web/src/`. Reused brief-4 pieces are named; "new" means a new file. Exact props and store shapes: CONTRACT
§16.10-16.12.

### 4.1 State, URL, history, chromes (web-flood-overview)

- `state/workspace.ts`: `hazard: 'fire' | 'flood'` (default fire), `setHazard`; URL `?hazard=flood` (omitted for fires).
- `state/flood.ts` (new zustand store, race-guarded like `store.ts`): lists (live, years) with loading, errors, sources,
  updated time (pure transitions in `state/floodCatalog.ts`); open flood (`floodId`, `summary`, `manifest`, `job`,
  `source`, `missingFloodId`, `missingReason`); `gaugeLid`, `cursorMs`, `layers`, `showWatches`; actions `loadFloods`,
  `openFlood`, `closeFlood`, `startFloodBuild`, `setGauge`, `setCursor`, `setFloodLayer`, `setShowWatches`. Dev handle
  `window.__flood`. **Who writes what (C10):** web-flood-overview creates the store (lists, open/close, URL, layers,
  watches; `startFloodBuild` as a typed stub); **web-flood-public** implements manifest loading, `startFloodBuild` and
  job polling, tested against the real build route once `brief 5 backend-flood-bundle-api: M2 bundle` is in `git log`.
  From wave 3 on the store's shape is frozen except additive keys that web-flood-command announces in its `contract5`
  note; Forensic keeps its own toggles in `ui/forensic-flood/forensicFloodState.ts`.
- **One event at a time:** `openFlood` closes an open fire (`useStore.getState().closeIncident()`); a subscription in
  `flood.ts` closes the flood when a fire opens (no edit in the frozen `store.ts`). Opening a flood sets
  `hazard = 'flood'`.
- **URL and history:** `?flood=<id>` (pushState); `?incident=` and `?flood=` never together (a link with both opens the
  fire and drops `flood`); `HistoryEntryState.flood?`; Back across hazards works; a 404 shows `FLOOD_NOT_LISTED` on the
  flood overview (replace), a 503 shows `FLOOD_LISTS_503`, never "not found". `?t=` stays fire-only. A detail answer
  with another canonical id (alias, rule 13) replaces the URL with the canonical id. **One entry per switch (C21):**
  `history.ts` keeps a module flag set by `openFlood` while it closes a fire (and by the fire subscription while it
  closes a flood), and the fire push is skipped while the flag is set, so fire → flood and flood → fire each push one
  entry; `navigationUrl` drops `flood` when it sets `incident` and the reverse. `history.test.ts` covers fire → flood →
  Back and flood → fire → Back.
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
("Back to all floods") returns to the flood overview. **The fire overview changes in exactly two places (C23):** the
title slot ("United States · ( Fires | Floods )" instead of "United States · all fires") and the document title
("Fire-3d · Wildfires and floods"); every other pixel of the fire overview matches brief 4.

### 4.3 National map in Floods (web-flood-overview)

| Element | Spec | Component (reuse / new) | Data |
|---|---|---|---|
| Flood markers | water-blue circles with the fire marker rules: large 15 px (moderate/major or flash warning/emergency; pinned, label at every zoom, leader candidate), active 11 (Flood Warning or gauge at minor), small 7 (advisory only, gauge-only at minor), other 4.5 hollow (watch-only, past); fill `rgba(42,140,230,.10)`, ring `rgba(127,212,255,.8)`, centre dot `#f2fbff` or the highest category colour | `map/overviewLayers.ts` spec builder reused with `{ palette: FLOOD_PALETTE, unit: ' FLOODS', rankProp: 'max_rank' }` (fire defaults unchanged); data and palette in new `map/floodLayers.ts`, `map/floodStyle.ts` | `/api/floods` |
| Groups | 3 or more close: `10 + 4.2·√n`, max 36; "28 FLOODS" | same builder | |
| Gauges | category diamonds 6/7/8/9 px (action, minor, moderate, major) from z5; grey hollow for below stage (flood views only) | new `map/floodLayers.ts` | `/api/official/river-gauges?scope=national&min=action` |
| Leader labels | "Animas River flood" / mono "MAJOR · 24.1 FT" in the category colour, else "FLASH FLOOD WARNING" / "FLOOD WARNING" / "FLOOD ADVISORY" | `map/LeaderLabels.tsx` reads `meta` and `rank` from the feature when present (fire default: acres) | |
| Bar status | "NOV 4 2026 · 31 FLOODS" (count `#7fd4ff`), "LOADING FLOODS", "FLOOD LIST UNAVAILABLE", "FLOOD LISTS UNAVAILABLE" (never 0 when unknown) | new `ui/public/FloodStatus.tsx` in `TopBarStatus` | list `sources` |
| List panel | "Floods in the lower 48"; OFFICIAL NOW block "Flood products (NWS) · 42 in effect in the lower 48 · checked 2 min ago"; tabs Active / 2026 / 2025 (U1); "Show watches" switch (U2); while watches are hidden, the list foot and the bar status say `WATCHES_HIDDEN` ("3 Flood Watches hidden · Show", C27); rows: name, "San Juan Co., NM · Flood Warning · Minor at Shiprock", right "15.2 ft" mono; a `DEMO` tag on every row, marker label and card whose summary is `synthetic` (C26); "12 floods in this view · Show all 31"; source notices; `FLOOD_LIST_ABSENCE` at the foot | new `ui/shell/FloodListPanel.tsx` (the `OverviewPanel` look and classes) | |
| Show details count | listed floods for the filter | `ShowDetailsPill` reused | |
| Legend | flood marker sizes, category diamonds (with names), "NWS warning area" pink, "Show model" never here | new `map/FloodLegend.tsx` (the `MapLegend` variants chips / key / panel) | |
| Point card | **Every** NWS flood product at the point verbatim (bbox query), **watches included whatever "Show watches" says** (C27); nearest listed floods with distance; nearest gauge at action or above within 25 km with `GAUGE_OTHER_STREAM`, else `NO_GAUGE_NEAR` (only when the gauge answer is `available`); absence line `NO_PRODUCT` only when the alerts answer is `available`, else `ALERTS_UNAVAILABLE` (D24). **In Fires mode** the fire point card adds one line, `FLOOD_HERE_IN_FIRES` ("NWS flood products are in effect here · Show floods"), when the point's flood-alerts query returns any product; nothing is added when it returns none or fails (the fire card makes no flood claim) | new `location/FloodPointCard.tsx`; `location/LocationCard.tsx` picks it by hazard and adds the Fires-mode line | `/api/official/flood-alerts?bbox=`, `/api/official/river-gauges?bbox=`, list |
| Search | flood names and rivers from the list (second hit provider) | `location/search.ts`, `SearchBox.tsx` | list |
| Click | Public → Public flood view (`pickFlood(id)`, one push); Command → Command flood view (D14); group → zoom in | `map/mapController.ts` routes clicks to `floodController.hit()` first | |
| Forensic entry | switch + flood list on "open an event first" | `ui/shell/ForensicWorkspace.tsx` | |

Fire markers, chips, zoom focus and fire weather outlines are hidden while Floods is picked (the "no incident"
checks of WEB 1.2 now use `noEventOpen()` and `hazard`).

### 4.4 Public flood view (web-flood-public), element by element

Layout = the Public fire view (`PublicFireChrome`) with the design's values. Differences from the fire view in bold.

| Design element (FloodView.dc.html) | Ours | Component | Data |
|---|---|---|---|
| Map tint, left gradient | `#333` `color` blend **0.25**; gradient **600 px** `rgba(12,12,12,.92)` → **.74** at 55 % → 0 | `MapAtmosphere edges="fire"` reused; new `TintLevel` `'flood'` (`map/basemapStyle.ts`, set through `mapStore.setTint`); gradient in `styles/view-flood-public.css` | |
| Close (X, 44 px) | "Back to all floods" | `BackButton` reused (label prop) | |
| Title + date line | "San Juan County, New Mexico" (county, state of the point); "NOV 2 2026 — PRESENT" / "SEEN BY FIRE-3D SINCE NOV 3 2026" / past "NOV 2 2026 — LAST NWS PRODUCT NOV 5 2026" (never "ENDED") | new `ui/public/FloodTitle.tsx` on the presentational part split from `FireTitle.tsx` (`keepDatesWhole` reused) | summary |
| Distance chip | the look unchanged; target in order: NWS warning area edge, else NWS forecast flooded area, else the primary member gauge; line says which | `DistanceChip` split into a presentational part with props; flood maths in new pure **flood-only** `lib/areaDistance.ts` `distanceToArea({ rings, point })` (lon/lat rings, geodesic); the fire chip keeps `distanceToFire` in the frozen `fireView.ts`, untouched (C22) | flood-alerts, maps |
| Hazard circle 312 px | bg **`#1a221f`**, the design's shadow and shade, **water texture** (verbatim: base gradient, water mask, mist path, two current layers −9° at 2.6 s and 1.5 s, mist band, rain 12° at 0.55 s, grain), status mono `#dff4ff`, name 72/800 `#f2fbff`, "MORE IN COMMAND ›" | `HazardCircle.tsx` split into presentational **`HazardDisc.tsx`** (`texture: 'thermal' \| 'water'`, `tone`, `statusLine`, `name`, `meaning`, `tip`, `onClick`, `compact`) + fire container (unchanged); new `WaterTexture.tsx`, `FloodHazardCircle.tsx`; `fitName`, `useId`, `usePausedWhenHidden`, reduced motion shared | summary |
| Status words | §5.2 table ("FLOOD · WARNING", "FLASH FLOOD · EMERGENCY", "FLOOD · GAUGE IN FLOOD", "FLOOD · NO NWS WARNING NOW", "PAST FLOOD · NOV 2 2026", "SIMULATED FLOOD · DEMO"); hidden meaning line names the issuer ("NWS Albuquerque has a Flood Warning in effect for this area until 9:00 PM MST."), one template per state including no product now, watch, past and demo (§5.2, C15) | `ui/public/floodView.ts` (pure) | products |
| Short name | `floodShortName`: "San Juan River flood" → "San Juan", "Clarks flash flood" → "Clarks"; full name as accessible name | `floodView.ts` | |
| Leader | 1.5 px `#4fc3ff` from the circle edge to the **primary member gauge** diamond with a 22 px `#4fc3ff` halo at .22; with no member gauge, to the representative point of the largest NWS polygon, drawn as a 6 px `--m-alert` ring (D10, C4) | existing leader layout (`useMapAnchor`, `leaderLayout.ts`) | primary gauge / products |
| Facts (7 rows, `ReadoutRow` reused) | **per kind, table below (C4)**; each row with issuer, own time and link in its sub-line (§5); **member gauges only**, never a nearby gauge | new `ui/public/FloodFacts.tsx` (the `FireFacts` structure, `useFactsFit` reused) | maps (status, no stats), river-gauges, flood-alerts, evacuations (`hazard=flood`) |
| Facts foot | OFFICIAL badge + "NWS · USGS · checked 2 min ago"; "Not an all-clear. Follow local officials." + link "NWS water" (`https://water.noaa.gov`) | `FloodFacts.tsx` | |
| Key (bottom right) | one item per layer drawn, each with its own time: "Water seen by satellite · Oct 31, 4:06 PM (4 d ago)" (solid swatch `1.5px #7fd4ff` on `rgba(42,140,230,.5)`; the age computed at render time from `acquired_ms`, C16); "No satellite view (clouds or no data)" (grey hatch) and "Edge of the satellite image" (thin dashed grey) whenever the image has such pixels (C2); "NWS forecast flooded area · issued 10:20 AM" (hatched); "Main channel" (dashed `#4fb4ff` on `rgba(16,63,138,.7)`); "NWS warning area" (pink outline); when switched on, "FEMA 1% annual-chance floodplain · effective {date}" with `NFHL_NOTE` in Legend details; scale; "Legend details" | new `ui/public/FloodKey.tsx` (the `FireKey` shape) + `FloodLegend variant="key"` | |
| Map layers (Public profile) | satellite water (measured PNG with the no-view hatch and the image edge, else GIBS picture), NWS forecast flooded area, warning outlines, member gauges (below-stage grey), main channel (the basemap's OSM water restyled `#103f8a` fill, dashed `#4fb4ff`), evacuation zones; **FEMA floodplain as a Layers-drawer toggle, off by default (D21). Never the model, never CatFIM** | `map/floodController.ts` area layers, `map/floodProfile.ts`, `FloodLayersPanel` public variant | |
| Top right cluster | Show panels, view pill (sm), Check an address, Layers, menu; status from 1280 px: "NASA OPERA · OCT 31 · 4 D AGO" (amber after 3 days) | `TopBar`, `IconPill`, `TopBarStatus` reused | satellite |
| Foot bar | "Research prototype — not for operational use" left; real credits right (NOAA NWS, NWPS, USGS, FEMA, NASA OPERA, OpenFreeMap / OpenStreetMap) | `FixedCopy variant="bar"`, `MapAttribution` | |
| Selected point | brief-4 light-blue dot, halo, hairline, mono label, unchanged; card = `FloodPointCard` (flood-view variant: inside / distance to each layer, `SAT_CLOUD_POINT`, `SAT_NODATA_POINT` or `SAT_OUTSIDE_POINT` where the satellite had no view (C2), nearest gauge, "The experimental model for this spot is in Command ›") | `markers.ts` reused; `location/floodCheck.ts` (pure, new) | |
| Phones | the fire view's bottom sheet; the peek shows the first two fact rows of the flood's kind | as `PublicFireChrome` | |

**Facts per kind (C4, C6, C7).** Rows 4-7 are the same for every kind: STARTED · {highest product in effect} (NWS) (label
= that product, e.g. "FLOOD WARNING (NWS)") · EVACUATIONS (`hazard=flood` answer, flood wording, D23) · LAST OFFICIAL
UPDATE. Rows 1-3:

| Kind | Row 1 | Row 2 | Row 3 |
|---|---|---|---|
| `river` | FORECAST FLOODED AREA (NWS, 5 DAYS): "Mapped" + sub `RFC_FIM_MAPPED_SUB` (no number, D5), "Not mapped here" + `RFC_FIM_OUTSIDE` (only when `available`), else `RFC_FIM_UNAVAILABLE` | RIVER STAGE (USGS): the primary member gauge's stage, category (§5.3 table) and time | FORECAST CREST (NWS) via `CREST_LINE`; **FORECAST HIGH (NWS)** via `FORECAST_HIGH_LINE` when `crest_at_end`; `NO_RFC_FORECAST` when the gauge is not a forecast point |
| `flash`, `areal` | FLASH FLOOD DETECTION (NWS): the product's `detection` verbatim ("Radar indicated"), else `NOT_STATED_NWS` | DAMAGE THREAT (NWS): `damage_threat` verbatim ("Considerable"), with "Flash Flood Emergency" when `emergency`, else `NOT_STATED_NWS` | RIVER GAUGES: a member gauge's stage if the flood has one, else `NO_MEMBER_GAUGE` ("No river gauge in this flood" / sub "Small streams and streets are not measured. Not an all-clear.") |
| level `watch` (watch only) | WATCH AREA (NWS): `area_desc` verbatim (first two areas, "and N more"); row 5 then reads FLOOD WATCH (NWS) with "until {time}" | RIVER GAUGES: as row 3 of flash | RIVER FORECAST (NWS): the highest NWS forecast category among member forecast points with `CREST_LINE` / `FORECAST_HIGH_LINE`, else `NO_RFC_FORECAST` |

A second detail fixture case (the flash flood emergency and the watch-only flood of the fixture list, §7.1) exercises
the flash and watch rows; web-flood-public screenshots both.

Official flood web (also web-flood-public): `official/floodModel.ts` (NWS answers → rows verbatim, Emergency first and open,
phases, archive labels; a model answer can never produce an official row; every "none" row checks the envelope status
first, D24), `official/floodHooks.ts` (`useFloodOfficialSync`), `ui/feed/FloodOfficialNow.tsx` (the `variant="command"`
rows; mounted by Command in wave 3), `ui/feed/FloodEvacRows.tsx` (evacuation rows in flood wording, D23; a guard test
checks no flood view renders the word "fire" in an evacuation row); `ui/feed/OfficialNow.tsx` only exports `Row` and
`SourceLink`.

### 4.5 Command flood view (web-flood-command), derived from Command fire

`ui/shell/CommandFloodChrome.tsx` (new) with `CommandFireChrome`'s layout and classes (`styles/view-command.css` rules
broadened with `:is([data-view='command-fire'],[data-view='command-flood'])` where the layout is the same; flood rules
in `styles/view-flood-command.css`).

| Region | Ours | Component | Data |
|---|---|---|---|
| Top bar | back "Back to all floods"; flood name (18 px); LIVE or the year; place; demo badge · view pill · right: gauge line mono "SHRN5 · 15.2 FT · MINOR · 12 MIN AGO" (age amber after 3 h; opens the gauge list), Show panels, Updates (phones), Check an address, Layers, menu | `TopBar`, `BackButton`, `LiveDot`, `IconPill`, `TopBarStatus` reused | river-gauges |
| Left readout | "SELECTED POINT" + copy/centre/clear; point mono 30 px; DMS · UTM · WGS84 (zone from the point when no bundle); one line per flood layer at the point with outlined tags (`OFFICIAL`, `FORECAST · ISSUED 10:20`, `SATELLITE · 4 D AGO`, `MODEL` only when on, FEMA when on); `NOTHING_COVERS` when none; nearest-gauge rows (stage, category per the §5.3 table, flood stage, forecast crest or high, distance + `GAUGE_OTHER_STREAM`; `NO_GAUGE_NEAR` only when the gauge answer is `available`); event rows (FLOOD ID copy, PRIMARY GAUGE coords copy/centre, LAST OFFICIAL UPDATE); area figures, each on its own line with its caveat: `RFC_FIM_AREA_COMMAND` (from member reaches only; omitted when `stats` is null, C6) and `SAT_AREA_COMMAND` | new `location/FloodReadout.tsx` (the `CommandReadout` structure; `CommandReadout` stays fire-only and frozen); `floodCheck.ts` from wave 2 | all |
| Right: Official now | one collapsible row per NWS product ("Flood Warning — in effect until 9:00 PM MST", meta "NWS ALBUQUERQUE NM · SENT 10:20 MST · CHECKED 2 MIN AGO", open: headline, description, instructions verbatim, link, "Show" fits the polygon); Emergency first and open; "River forecast — crest 17.1 ft Thu 6:00 AM (NWS CBRFC, issued 10:20 AM)" (or `FORECAST_HIGH_LINE`); Evacuations (`hazard=flood`, flood rows with `EVAC_NONE_LISTED`, Cal OES `event_type` verbatim, Oregon `OR_EVAC_FIRE_ONLY`; never the fire rows' "near this fire" text, D23) and Local officials' alerts by the flood's bbox; `NO_PRODUCT` only when the alerts answer is `available`, else `ALERTS_UNAVAILABLE`; foot `MODEL_SEPARATE` | `FloodOfficialNow` (wave 2) with new flood evacuation rows in `ui/feed/FloodEvacRows.tsx`; the fire local-alert row reused | flood-alerts, river-gauges, evacuations, local-alerts |
| Bottom | map controls bar (left); legend chips + scale (right): "Water seen by satellite (Oct 31)", "No satellite view", "NWS forecast flooded area", "NWS warning area", the four diamonds, "FEMA 1 % floodplain", "NWS category flood map (experimental)" and "Model (NWM, experimental)" when on, "Selected location", "Legend details"; then the **slim hydrograph**; fixed copy (`corner`); credits | `MapControls variant="bar"`, `FloodLegend variant="chips"`, `Hydrograph variant="slim"` | |
| Layers drawer | Water: satellite, NWS forecast area, NWS warning areas, gauges; **NWS category flood maps (experimental), off (D22)**; Background: FEMA floodplain (off; "effective {date}"); Model: NWM flooded area (off, experimental), NWM high-flow reaches (off); basemap, units | `ui/shell/FloodLayersPanel.tsx` command variant | |
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
- Marks: NOW; "LATEST 12:15 · 25 MIN AGO" (amber + STALE after 3 h); crest caret "CREST 17.1 FT THU 06:00", or, when
  the highest forecast value is the last forecast step (`crest_at_end`, C7), "HIGH 17.1 FT AT END · STILL RISING"; NWS
  product times as small pink ticks.
- Handle: drag or keys (←/→ 1 h, Shift 6 h, Home/End); label "NOV 4 10:00 MST · 15.2 FT OBSERVED · MINOR" or "NOV 6
  06:00 · 17.1 FT FORECAST (NWS) · MODERATE"; sets `useFlood.cursorMs`. **Products shown (C1):** with the handle at or
  before now, the map, readout and point check use the products in effect at the handle's time; **after now they keep
  the products in effect now**, the readout lines keep "until {time}", and a note under the label says
  `CURSOR_FUTURE_PRODUCTS`. One pure function, `productsAt(alerts, cursorMs, nowMs)` in `hydrographModel.ts`, used by
  the map, `floodCheck.ts`, the Forensic dock and drapes; tested on both sides of now. No play button (D13). Gauge
  picker = the slim variant's 40 px left button.
- **Flow mode (C28):** the handle label shows NWS observed or forecast flow on line 1 and, on its own line, "MODEL ·
  NWM · EXPERIMENTAL · {flow} ft³/s ({run time})"; never one combined value. No NWM line or label when the gauge has no
  `reach_id`. A `hydrographModel` test checks both.
- Empty states (§5.5). Units: metric → m and m³/s with the original in the tooltip.

### 4.7 Forensic 3D flood view (web-flood-forensic)

| Part | Ours | Component | Data |
|---|---|---|---|
| Branch | `ForensicWorkspace` shows `FloodForensic` when a flood is open (fire Header, Timeline, Charts and panels untouched); `FixedCopy` (`PROTOTYPE_LINE` and `NOT_ALL_CLEAR`) stays visible in the flood branch and on the entry page, phones included (C23) | new `ui/forensic-flood/**` | |
| Unprepared | "Fire-3d has not prepared this flood's 3D terrain yet." + "Prepare 3D data (about 1 min)" (job progress) through `useFlood.startFloodBuild` (written and tested by web-flood-public, C10) | `FloodForensic` | build route |
| Forensic toggles | its own store `ui/forensic-flood/forensicFloodState.ts` (layer toggles incl. NAIP, contours, telemetry labels, CatFIM, model; open tab); never new keys in `state/flood.ts` (C10) | new | |
| Scene assets | `Scene.tsx` takes assets from `useSceneAssets()` = `scene/flood/floodAssets.ts` + a `flood` part. **No cast (C10):** `IncidentAssets.manifest` is typed `SceneManifest` (CONTRACT §16.12: the manifest fields the scene reads, `ignition: Ignition \| null`), which a fire `IncidentManifest` satisfies; if the frozen `scene/fx/**` does not typecheck with that, the fire `IncidentAssets` keeps `IncidentManifest` and the shared parts (`Terrain`, `CameraRig`, `ProbeDriver`, `SelectionPin`, `SceneOverlays`, `frame.ts`) take a `SceneAssets` base type instead; `frame.ts` frames a flood by its bbox; `SceneOverlays` shows no ignition for a flood; `SunLights`, `PostFX`, `LookDriver` unchanged; `SceneFx` is not mounted for a flood | `scene/Scene.tsx`, `scene/assets.ts`, `scene/frame.ts`, `scene/overlays/SceneOverlays.tsx`, new `scene/flood/**` | bundle files |
| Drapes | terrain shader, additive uniforms: `uFloodPack` RGBA (r NWS forecast area, g FEMA floodplain, b NWM model; linear) and `uSatWater` (classes, nearest); satellite water `#2a8ce6` fill + `#7fd4ff` edge (screen-space derivative), no glints; **cloud (253) and no data (255) the same grey cross-hatch ("no view"), never transparent and never drawn as land** (D25; a test over the class-to-colour table); forecast area water-blue world-space hatch; floodplain faint stipple; CatFIM (when on) a second hatch angle with "NWS CATEGORY MAP · EXPERIMENTAL"; model amber dotted edge + "MODEL · EXPERIMENTAL"; NWS warning lines follow `productsAt` (C1) | `scene/terrain/terrainMaterial.ts`, `Terrain.tsx` (additive) | layers |
| Warning polygons | pink lines draped with `scene/fx/lines.ts` (import only) | `scene/flood/FloodFx.tsx` | warnings.json |
| Gauges | thin vertical bars; ticks at action/minor/moderate/major; bright cap at the stage; hollow cap at the forecast crest; mono label "SHRN5 · 15.2 FT · MINOR · 10:00 MST" (`scene/fx/text.tsx` overlay, import); fixed scale (1 ft = 12 m) with legend "Bar height: river stage at the gauge (scaled), not water depth"; static | new `scene/flood/GaugeBars.tsx`, `gaugeBarMath.ts` (pure; not `gaugeBars.ts`, which would clash with `GaugeBars.tsx` on macOS) | gauges.json |
| Header and entry controls | `TopBar` (name, LIVE/year, view pill); "Frame flood" and "Charts & NWS products" under the compass; demo badge "Demo · simulated data" with "terrain, water layers and gauges are synthetic" | new `FloodHeader.tsx` | |
| Right panel | tabs Layers (Base: Terrain, Aerial photo (NAIP, "taken <year>, before this flood"), FEMA floodplain (off, "effective {date}"); Water: satellite, NWS forecast area, NWS warning areas, gauges, NWS category flood maps (experimental, off, D22); Model: NWM flooded area (experimental, off); Parametric: Contours, Telemetry labels), Analysis (hydrographs per gauge), Evidence (every NWS product version verbatim from `warnings.json`), Notes; cards "Flood overview" and "River gauges" | new `FloodRightPanel.tsx`, `FloodLayersTab.tsx`, `FloodEvidenceTab.tsx`, cards | bundle |
| Dock | `Hydrograph variant="dock"` (112 px, 90 px plot, small multiples in "Charts & NWS products"); the handle follows the C1 rule | import after `brief 5 web-flood-command: M1 hydrograph` is in `git log`; if it is not there by Forensic's last milestone, a placeholder slot and the mount go to the integration | |
| Hand-off | `ui/shell/handoff.ts` reads the open event's grid (fire or flood); heading rule unchanged | | |

### 4.8 Brief-4 components reused, and the few splits

- **Reused unchanged:** `TopBar`, `ViewPill`, `BackButton` (label prop exists), `LiveDot`, `IconPill`, `TopBarStatus`,
  `FixedCopy` (+ `fixedCopyText.ts`), `ReadoutRow`, `MapControls` (bar, compact), `MapAtmosphere`, `markers.ts` selected
  point, `useMapAnchor`, `leaderLayout.ts` maths, `LocateButton`/`locate.ts`, `location/geometry.ts`, `lib/geodesy.ts`,
  `lib/time.ts`, `ShowDetailsPill`, `useFactsFit`, `usePausedWhenHidden`, the reduced-motion hook, `state/rotation.ts`,
  `ui/controls.tsx`, the Forensic scene stack (terrain, camera, probe, post, atmosphere), evacuation and local-alert rows.
- **Small additive splits (fire behaviour and screenshots unchanged):** `HazardCircle` → `HazardDisc` + fire container;
  `FireTitle` and `DistanceChip` → presentational parts with props (the fire chip still uses `distanceToFire` from the
  frozen `fireView.ts`; `lib/areaDistance.ts` is flood-only, C22); `overviewLayers.ts` palette/unit/rank parameters;
  `LeaderLabels.tsx` `meta`/`rank` from features; `OfficialNow.tsx` exports `Row`, `SourceLink`; `TintLevel`
  (`basemapStyle.ts`) gains `'flood'` and `mapStore` gains `frameFlood()` (both web-flood-overview M1, C22);
  `MapControls` framing calls `frameFlood()` when a flood is open.
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
exported string of every `*[Ff]lood*[Cc]opy*.ts` file **except `*.test.ts`** (test files hold banned words as inputs;
C24) and `copy.py`, and every rendered fixture case (§7.3).

### 5.1 Never an all-clear

- Banned in Fire-3d's own voice (case-insensitive): "safe", "safely", "safety" (except the existing "does not establish
  the safety of a route or an area"), "low risk", "all clear" / "all-clear" (only inside "not an all-clear" / "never an
  all-clear"), "no flooding" (only inside "do not mean no flooding"), "dry" (only inside "Unknown, not dry" and "dry
  pixels do not mean no flooding"), "receded", "the flood is over", "ended" as a status, "normal level", "no danger",
  "you are outside the flood", "minimal flood hazard", "FireTrace". NWS's own wording, quoted verbatim with its issuer,
  is exempt. The guard removes the allowed phrases first, case-insensitively and longest first ("dry pixels do not
  mean no flooding" before "do not mean no flooding"; "Not an all-clear" with a capital N), then searches for the banned
  words **with word boundaries** (`\bsafe(ly|ty)?\b`, `\bdry\b`, `\bended\b`, `\breceded\b`, …; so "extended" and
  "recommended" never match; C24). **Verbatim text is marked:** every NWS, FEMA, Cal OES or other issuer's text is
  rendered inside an element with `data-verbatim` (and the issuer named next to it); the rendered-output scan strips
  those elements before searching. A test plants a banned word in Fire-3d's own text and checks the guard fails.
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
| `FLOOD_LAST_KNOWN` | This flood is no longer in the NWS lists Fire-3d reads. Shown: what Fire-3d last saw on {date}. Not an all-clear. Follow local officials. |
| `GAUGE_ONLY_CAVEAT` (B) | No NWS flood product names this gauge right now. |
| `WATCHES_HIDDEN` | {n} Flood Watches hidden · Show (singular: 1 Flood Watch hidden · Show) |
| `FLOOD_HERE_IN_FIRES` | NWS flood products are in effect here · Show floods |
| `DEMO_TAG` | DEMO |
| `PAST_PREPARING` | Preparing past floods (the first time takes about 10 minutes)… |
| `PAST_RULE_NOTE` | Past years list river floods that reached moderate or major flood stage at an NWS gauge, and flash floods NWS tagged considerable or catastrophic or called an emergency. Smaller floods are not listed; not an all-clear. |
| `PAST_RULE_NOTE_FALLBACK` | Past years list NWS river Flood Warnings at river gauges and NWS Flash Flood Emergencies. Other flash floods are not listed; not an all-clear. |
| Bar status | `{DATE} · {N} FLOODS` (+ ` · {n} WATCHES HIDDEN` while hidden) · `LOADING FLOODS` · `FLOOD LIST UNAVAILABLE` · `FLOOD LISTS UNAVAILABLE` |
| Circle status | `FLASH FLOOD · EMERGENCY` (Emergency tag) · `FLASH FLOOD · WARNING` · `FLOOD · WARNING` · `FLOOD · ADVISORY` · `FLOOD · WATCH` (quiet tone, rain kept) · `FLOOD · GAUGE IN FLOOD` · `FLOOD · NO NWS WARNING NOW` (quiet) · `PAST FLOOD · {MON D YYYY}` (quiet) · `SIMULATED FLOOD · DEMO` (demo) |
| Circle meaning (one per status, C15) | product in effect: `{Sender} has a {event} in effect for this area until {time}.` · watch: `{Sender} has a {event} in effect for this area until {time}: flooding is possible. Not an all-clear. Follow local officials.` · gauge only: `No NWS flood product names this flood right now; a river gauge here reads at flood stage.` · no product now (status inactive): `No NWS flood product is in effect here right now, and no gauge of this flood has read at flood stage in the last 6 hours. Not an all-clear. Follow local officials.` · past: `Past flood: NWS's last product for it was sent {date}. Not an all-clear. Follow local officials.` · demo: `Simulated data for testing: not a real flood, NWS product or gauge reading.` |
| Date line | `{MON D YYYY} — PRESENT` · `SEEN BY FIRE-3D SINCE {MON D YYYY}` · `{MON D YYYY} — LAST NWS PRODUCT {MON D YYYY}` |
| Product end | `NWS {event} until {time}` (never "flood ends") |

### 5.3 Gauges and forecasts

| Name | Text |
|---|---|
**Gauge category display (every `GaugeCategory` value; C15).** Never a raw value on screen.

| Category | Short label | Sentence |
|---|---|---|
| `no_flooding` | Below flood stage | `GAUGE_BELOW_STAGE` sub (below) |
| `action` | Action stage (NWS) | Action stage (NWS): near flood stage. |
| `minor` / `moderate` / `major` | Minor / Moderate / Major flooding (NWS) | NWS category at this gauge: {category} flooding. |
| `not_defined` | Flood stages not set (NWS) | `GAUGE_NOT_DEFINED` |
| `low_threshold` | Low-water threshold (NWS) | Low-water threshold (NWS); not a flood measure. |
| `obs_not_current` | Reading not current (NWS) | `GAUGE_NOT_CURRENT` |
| `out_of_service` | Out of service (NWS) | `GAUGE_OUT_OF_SERVICE` |
| `fcst_not_current` | Forecast not current (NWS) | This gauge's NWS forecast is not current. |
| `unknown` | Category unknown (NWS) | Category unknown (NWS). |

| Name | Text |
|---|---|
| `GAUGE_BELOW_STAGE` / sub | Below flood stage / NWS category at this gauge: “No Flood”. Not an all-clear: water can rise fast, and streams without a gauge are not measured. |
| `GAUGE_NOT_CURRENT` | This gauge's reading is not current (NWS: “Data Not Current”); last reading {time}. |
| `GAUGE_OUT_OF_SERVICE` | Gauge out of service (NWS); no reading. |
| `GAUGE_NOT_DEFINED` | NWS has not set flood stages for this gauge, so its reading cannot be compared with flood levels. |
| `GAUGE_OTHER_STREAM` | Nearest gauge on the {river}; another stream may be closer. |
| `GAUGE_NOT_ALL_CLEAR` (B) | A gauge below flood stage is not an all-clear. |
| `GAUGES_UNAVAILABLE` (B) | River gauge readings could not be loaded right now. That is not an all-clear. |
| `NO_GAUGE_NEAR` | No gauge reads at action stage or above within 25 km; streams without a gauge are not measured. Not an all-clear. |
| `NO_MEMBER_GAUGE` / sub | No river gauge in this flood / Small streams and streets are not measured. Not an all-clear. |
| `NOT_STATED_NWS` | Not stated by NWS |
| `GAUGE_PROVISIONAL` | Measured by USGS (provisional data, subject to revision). |
| `USGS_429` (B) | USGS data could not be reached right now (too many requests); try later. |
| `THRESHOLDS_TODAY` (B) | Flood stages shown are NWS's current values; they may have differed then. |
| `CREST_LINE` | Forecast crest {value} {unit}, {day time zone} (NWS {RFC name}, issued {time}). Forecasts change; check NWS for the newest. |
| `FORECAST_HIGH_LABEL` / `FORECAST_HIGH_LINE` | FORECAST HIGH (NWS) / Highest NWS forecast value {value} {unit} at the end of the forecast ({day time zone}); the river is still forecast to rise (NWS {RFC name}, issued {time}). Check NWS for the newest. |
| `NO_RFC_FORECAST` | No NWS river forecast for this gauge |
| `PAST_NO_FORECAST` (B) | River forecasts are not kept for past dates. |
| `RFC_FIM_LABEL` | NWS forecast flooded area (next 5 days) |
| `RFC_FIM_MAPPED` / `RFC_FIM_MAPPED_SUB` | Mapped / NWS's experimental 5-day forecast map · issued {time} · see the map |
| `RFC_FIM_AREA_COMMAND` | Forecast flooded area (next 5 days): {area}, measured by Fire-3d from NWS's experimental map of this flood's forecast reaches. It includes the river channel. |
| `RFC_FIM_NOTE` (B) | Where NWS river forecasts say water could reach in the next 5 days (the most at any time). A forecast, not today's water. NWS calls this map experimental. |
| `RFC_FIM_OUTSIDE` (B) | Outside NWS's mapped area, flooding is unknown, not absent. |
| `RFC_FIM_NONE` | Not mapped here (only when the map answer is `available`) |
| `RFC_FIM_UNAVAILABLE` (B) | The NWS forecast flooded-area map could not be loaded right now. That is not an all-clear. |
| `CATFIM_LABEL` | NWS category flood maps (experimental) |
| `CATFIM_NOTE` (B) | What NWS maps for {category} flooding at this gauge (experimental map library). Not a forecast. |
| `CATFIM_UNAVAILABLE` (B) | NWS category flood maps could not be loaded right now. |

### 5.4 Satellite water, FEMA, model

| Name | Text |
|---|---|
| `SAT_LABEL` | Water seen by satellite · {date, time} ({age}) — `{age}` computed by the web at render time from `acquired_ms` (C16) |
| `SAT_CAVEAT` (B) | Water seen by satellite (NASA OPERA), {date, time}. It includes the river's normal water. Clouds ({n}% of this area), trees, buildings and the days between passes hide water: dry pixels do not mean no flooding. — the backend fills only the absolute date and time (image's zone); the web shows `SAT_LABEL` with the age next to it |
| `SAT_NO_VIEW_KEY` | No satellite view (clouds or no data) |
| `SAT_NODATA` / `SAT_NODATA_POINT` | No satellite view (no data) / No satellite view of this spot on the {date} pass. |
| `SAT_EDGE` / `SAT_OUTSIDE_POINT` | Edge of the satellite image / This spot is outside the {date} satellite image: no satellite view of it. |
| `SAT_NOT_SET_UP` (B) | NASA Earthdata login is not set up on this server. Fire-3d shows NASA's public optical images (Landsat and Sentinel-2), which cannot see through clouds and arrive about a day later. Radar images that see through clouds need the login. |
| `SAT_NOT_SET_UP_SHORT` | No radar images: NASA login not set up |
| `SAT_LOGIN_REFUSED` (B) | The NASA Earthdata login on this server was refused (it may have expired). Fire-3d shows NASA's public optical images only until it is renewed. |
| `SAT_PICTURE_ONLY` | Satellite water: NASA picture, {date} (not measured here) |
| `SAT_UNAVAILABLE` (B) | Satellite water could not be loaded right now. That is not an all-clear. |
| `SAT_CLOUD` / `SAT_CLOUD_POINT` | No view (clouds) / Clouds hid this spot on the {date} pass. |
| `SAT_AREA_COMMAND` | Water seen by satellite in this area: {area} (includes normal river and lake water) |
| `NFHL_LABEL` | FEMA 1% annual-chance floodplain (“100-year floodplain”), background · effective {date} (or {date}–{date} when panels differ; C19) |
| `NFHL_NOTE` (B) | FEMA's 1%-annual-chance (100-year) floodplain, used for flood insurance. It is not a map of current flooding, and places outside it can flood. Provided as is by FEMA. |
| `NFHL_OUTSIDE` | Not in FEMA's mapped 1% floodplain. Floods can reach beyond it; not an all-clear. (Only where `availability` is `mapped`; C19) |
| `NFHL_NO_MAP` (B) | FEMA has no digital flood map here. |
| `NFHL_DOWN` (B) | FEMA flood zones could not be loaded right now. |
| `MODEL_LABEL` (B) | Model output (NOAA National Water Model) · experimental |
| `MODEL_CAVEAT` (B) | Experimental model output (NOAA National Water Model). It is not an NWS forecast and not advice on when to evacuate. Follow local officials. |
| `MODEL_SEPARATE` | Fire-3d shows NOAA's National Water Model separately, as experimental model output. Not an all-clear. Follow local officials. |
| `MODEL_UNAVAILABLE` | Model series unavailable right now |
| `MODEL_AEP` | Model flow about a 1 in {n} chance in any year (NWM) — from `recur_cat` {p} % (n = 100 / p); `">50"`: Model flow above its high-water level (NWM) |

### 5.5 Point checks, distance, products, hydrograph

| Name | Text |
|---|---|
| `NO_PRODUCT` (B) | No NWS flood product here right now. That is not an all-clear: follow local officials. (Only when the alerts answer is `available`; D24) |
| `ALERTS_UNAVAILABLE` (B) | NWS flood products could not be reached right now. That is not an all-clear: follow local officials. |
| `ZONES_AS_COUNTIES` (B) | Drawn as whole counties; NWS's own zones may be smaller. |
| `NOTHING_COVERS` | No mapped flood layer covers this spot. Unknown, not dry. Follow local officials. |
| `INSIDE_WARNING` | Inside the NWS {event} area (until {time}). |
| `CURSOR_FUTURE_PRODUCTS` | NWS products in effect now; NWS has issued none for this future time. An NWS end time is not a forecast of when flooding stops. (C1) |
| `EVAC_NONE_LISTED` / sub | None listed / None listed in {source} for this area · checked {time} · not an all-clear: follow local officials. |
| `OR_EVAC_FIRE_ONLY` (B) | Oregon's evacuation feed covers wildfires only; flood evacuations are not shown here. Not an all-clear: follow local officials. |
| `INSIDE_FIM` / `NEAR_FIM` | Inside the NWS forecast flooded area (5-day maximum). / {distance} from the NWS forecast flooded area. |
| `NEAR_SAT` | {distance} from water seen by satellite ({date, time}; clouds over {n}% of the area). |
| `IN_FLOODPLAIN` | In FEMA's 1% annual-chance floodplain, Zone {zone} (background). |
| `MODEL_AT_POINT` | National Water Model (NOAA, experimental): flooded at the {time} analysis. |
| Distance chip lines | to the edge of the NWS warning area · to the NWS forecast flooded area (5 days) · to the river gauge, not the water's edge · Inside the NWS warning area |
| `WAS_IN_EFFECT` | Was in effect (sub-line starts "as of {date}"; brief-4 rule) |
| `ARCHIVED_COPY` | Archived copy (Iowa Environmental Mesonet) |
| Hydrograph empty | No readings from this gauge in the last 72 h (NWS: Data Not Current) · NWS has not set flood stages for this gauge · No NWS river forecast for this gauge · Model series unavailable right now |
| Hydrograph marks | `CREST {value} {UNIT} {DAY HH:MM}` · `HIGH {value} {UNIT} AT END · STILL RISING` (C7) · flow-mode model line `MODEL · NWM · EXPERIMENTAL · {flow} FT³/S ({run time})` (C28) |
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
- **Changes after M1:** additive only, made by the backend role that owns the triple at that time (backend-flood-sources,
  then backend-flood-bundle-api, then backend-flood-live; they run one after another), recorded in its `contract5`
  note; the web roles are told by the note. The revision's additions (`resolved_from`, `crest_at_end`, the NFHL
  `availability` and `effective_*` fields, `past_rule`, `preparing`, the new reason strings) are part of M1, not later
  changes.

## 7. Fixtures (web before backend)

### 7.1 Backend fixture `fixture-flood` (backend-flood-sources, milestone M2, within about 2 h)

`uv run python scripts/make_fixture.py --only flood [--now 2026-11-04T18:00:00Z]` writes `data/floods/fixture-flood/`
(time-relative to now unless `--now`), strictly validated against the contracts:

- **Place:** centre 36.79 N, 108.06 W (San Juan County, NM), AOI 12 km, procedural valley with a winding channel (it does
  not follow a real river; the demo badge and "SIMULATED FLOOD · DEMO" say so). Name "Ridge Fork River flood" (fictional),
  `synthetic: true`, kind river, level warning.
- **Issuers are fictional (C26):** sender "NWS Example Office (synthetic)", VTEC office `KZZZ`, RFC "Example River
  Forecast Center (synthetic)" (code `ZZRFC`), so no screenshot puts a made-up product under a real office's name.
- **Gauges** (fictional LIDs that cannot collide with real ones): `ZZRF1` primary, rising through action and minor to
  moderate now, RFC forecast crest major-1 ft in 30 h (issued 2 h ago by the example RFC), NWM series (short range 18 h,
  medium blend 10 days, flow; `reach_id` set); `ZZRF2` at action, its forecast still rising at the last step
  (`crest_at_end: true`, C7); `ZZRF3` below flood stage (`no_flooding`, no `reach_id`); `ZZRF4` `obs_not_current`; 72 h
  of observed stage and flow every 15 min; thresholds, three impacts lines, data attribution "Observations courtesy of
  U.S. Geological Survey".
- **Products** (text marked "[SYNTHETIC — NOT AN NWS PRODUCT]"): a Flood Warning (FL.W, H-VTEC `ZZRF1.2.ER`) with two
  versions (NEW, then EXT), its `ends_ms` 8 h after now (so the forecast-cursor screenshot proves C1), a Flood Advisory
  (FA.Y) polygon, a Flood Watch (FA.A) with zone polygons and `geocode.SAME` codes.
- **Maps:** RFC FIM polygons along the channel tied to `ZZRF1` through layer-3-style `feature_id` lines (area stats from
  member reaches), CatFIM moderate and major polygons for `ZZRF1`, NFHL zones (A, AE, floodway, 0.2 %; no zone X) with
  `availability: mapped` and two effective dates, NWM analysis polygons + high-flow reaches with `recur_cat` "10" and
  ">50".
- **Satellite:** classes raster + PNG with water, partial water, a cloud patch (≈ 30 %) and a no-data strip (both drawn
  with the no-view hatch, D25), the image not covering the AOI's east edge (to show the image edge); one HLS granule 4
  days old (`measured: true`, `login: not_configured`, `SAT_NOT_SET_UP` reason); absolute times only (C16).
- **Bundle files:** every layer of §3.3 (`water_model` included), `warnings.json`, `gauges.json`, `satellite.json`.
- **Canned API answers** in `data/floods/fixture-flood/api/` for every route of §3.4 (list with fixture-flood and seven
  synthetic list-only floods across the lower 48 covering: emergency flash flood, major river, moderate river, minor
  gauge-only, advisory-only, watch-only, a past flood in 2025; detail; flood-alerts; river-gauges for the flood, per lid
  with series, and national; maps for each kind; model for each kind; satellite JSON + PNG; status), all
  contract-valid.
- **The seven list-only floods (C4, C26):** ids `fixture-flood-<kind>` (never the real id pattern), fictional names
  ("Example Creek flash flood", …), `synthetic: true` (the web shows `DEMO_TAG`), each with canned detail (summary,
  `manifest: null`), flood-alerts, river-gauges and maps answers so a click opens its view. Two are full detail cases:
  **`fixture-flood-flash`**, a Flash Flood Warning with the Emergency tag, `detection` "OBSERVED", damage threat
  "CATASTROPHIC", no member gauge (a below-stage gauge 6 km away on another stream, `member: false`) and an RFC FIM
  answer with no features; **`fixture-flood-watch`**, a watch-only flood (zone-based, SAME codes, no gauge).
- **Edge-case answers** for each official layer `unavailable` (alerts, gauges, RFC FIM, CatFIM, NFHL, satellite, model;
  C3) in `api/edge/`.
- A committed copy generated with `--now 2026-11-04T18:00:00Z` in `backend/tests/data/floods/fixture_api/` (tests).
- **Tests never depend on a gitignored bundle (C25):** a session-scoped pytest fixture generates `fixture-flood` into
  `tmp_path` with `make_fixture`'s flood builder at `--now 2026-11-04T18:00:00Z`; flood tests never skip for a missing
  bundle. Every gate records its skip count, and the final check fails on any flood test skip.

### 7.2 Serving it

- `uv run python scripts/serve_fixture.py --port <api>` answers every flood route from `data/floods/*/api/` (and the
  fire routes as today), including the seven list-only floods' detail answers and, with `?edge=<layer>` on a route,
  its `unavailable` edge case. Web roles use it until the real routes are in `git log`
  (`brief 5 backend-flood-sources: M4` for list/detail; `brief 5 backend-flood-bundle-api: M2` for build/files;
  `…: M3` for the rest).
- The real API (`FIRE3D_LIVE=0`) answers `fixture-flood` on every route from the bundle's frozen files, so waves 2-3 and
  the integration can use the real API with the fixture and real floods side by side.

### 7.3 Web fixtures (web-flood-overview)

`web/src/api/__fixtures__/floods/*.json`: plain copies (`cp`, no edits) of `backend/tests/data/floods/fixture_api/`, so
web tests check the same shapes the backend validates, plus `edgeCases.ts` built from them: no token (default), token
refused, picture only, Data Not Current, out of service, not defined, Flash Flood Emergency, Puerto Rico product
dropped, past flood ("Was in effect"), gauge without a forecast point, NWS down, gauges down, both down, empty list;
added by the revision: each official layer `unavailable` (C3), forecast still rising at its end (C7), satellite no
data and outside the image (C2), a bundle built 7 days earlier (C16), alias and last-known detail answers (C20),
watches hidden (C27), flow mode without `reach_id` (C28). Until M2 lands, hand-written minimal fixtures per CONTRACT
§16 are allowed and are replaced by the copies.

## 8. Tests at risk (update deliberately, in the same commit as the change)

**Backend** (must stay green; edits additive):
- `tests/test_endpoint_contracts.py` (fire bundles in `data/incidents`): untouched, frozen. Flood bundles live in
  `data/floods`, so it never sees one. The new `tests/test_flood_endpoint_contracts.py` isolates from the start: empty
  temporary `CACHE_DIR`, temporary `FLOODS_DIR` with `fixture-flood` **generated into `tmp_path`** (C25), temporary
  registry, `LIVE_ENABLED=False`, and clears the flood catalog cache, `nws.reset_state()`, `extras.reset_state()`,
  `fhttp.reset_down_memos()` before and after (brief-4 lesson, `final-verification-4.json`).
- `test_config.py` (mask both secrets; `Authorization: Bearer` and `X-Amz-*` values masked), `test_http.py` (`headers=`
  path; no auth in cache keys or logs; cross-host redirect drops it), `test_official_nws.py`, `test_local_alerts_nws.py`
  (fire defaults of the new `family`/`hazard` parameters), `test_api.py` / `test_api_live.py` (lifespan starts two
  tasks; flood task off with `FIRE3D_FLOODS=0`), `test_serve_fixture.py` (new routes answer contract-valid JSON),
  `test_contracts.py` (unchanged), `test_extras.py` (`order_by` default `OBJECTID`; evacuations `hazard` default `fire`
  byte-for-byte; `hazard=flood` drops Oregon with `OR_EVAC_FIRE_ONLY`), `test_api_cli.py` (new commands).
- Secrets: with a fake `EARTHDATA_TOKEN` (monkeypatch) a mock transport proves the token is only in the PO.DAAC
  request's header, never in a URL, a log record (`caplog`), an error, a response body or a cache file, and that the
  pre-signed redirect's `X-Amz-*` values never reach a log record or an error (count-only; C17).
- **New backend tests from the revision:** cold list build ≤ `MAX_LIST_UPSTREAM_REQUESTS` (C9); a watch grouped by SAME
  counties with no zone request (C9); one gauge flooding twice 30 days apart gives two ids, live and in the year list
  (C8); the rule-13 detail chain after a merge and after 48 h (C20); `crest_at_end` from NWPS series, `rfc_max_forecast`
  and an H-VTEC crest of `000000T0000Z` (C7); RFC FIM `stats` from member reaches only, null when the join fails (C6);
  NFHL `availability` and effective dates (C19); the satellite PNG palette never makes 253 or 255 transparent (C2);
  `satellite.json` holds no relative age (C16); per-gauge NWPS timeout and outage memory (C18).

**Web** (about 1,383 cases in 101 files today; all stay green):
- `ui/shell/views.test.ts` (`mapChromeOf` takes the event kind; five chromes), `state/workspace.test.ts` (defaults + the
  `hazard` URL parameter), `state/history.test.ts` (entry with `flood`; one entry for fire → flood → Back and flood →
  fire → Back; `navigationUrl` never keeps both parameters; C21), `state/timeZone.test.ts`.
- `map/overviewLayers.test.ts` (fire defaults of the new parameters; `CLUSTER_RADIUS_EXPR`; draw order; style validity),
  `map/userInput.test.ts` and `state/fireCard.test.ts` (regexes over `mapController.ts`, `SearchBox.tsx`,
  `OverviewCard.tsx`: keep the fire click path's shape; route flood hits before it).
- `official/runtime.test.ts`, `official/mapLayer.test.ts` (no fire weather in flood mode), `extras/client.test.ts`
  (`currentArea`), `location/search.test.ts` (second provider), `lib/dataCredits.test.ts`, `lib/fileNames.test.ts`.
- `ui/shell/ForensicWorkspace.test.ts`, `ui/shell/handoff.test.ts` (wave 3), `ui/public/fireView.test.ts` and the fire
  view's SSR snapshots after the `HazardDisc` split (must not change).
- Lint: scene changes add no warning (baseline 55, all `src/scene`).

**New guard tests:** `ui/shell/floodCopy.test.ts` (banned patterns, word-bounded, over every flood copy file except
tests and over rendered facts, readouts and keys for every fixture case with `data-verbatim` text stripped; a planted
banned word must fail it; C24); `map/floodStyle.test.ts` (no green: hue 75°-165° with saturation > 25 % banned);
a fetch-spy test that mounts each flood chrome and fails on any request to a fire-only endpoint (`/api/incidents/`,
`/api/official/fire-weather`, `/api/official/calfire`, `/api/official/incident-record`, `/aircraft`); `floodProfile.test.ts`
(no model and no CatFIM layer in Public; FEMA a toggle, off by default; C13, C14); an absence test (`NO_PRODUCT`,
`RFC_FIM_NONE`, `GAUGE_BELOW_STAGE`, `NO_GAUGE_NEAR` never render when their answer is `unavailable`; C3); an
evacuation-row test (no flood view renders "fire" in an evacuation row; C5); `productsAt` on both sides of now in
`hydrographModel.test.ts` and `floodCheck.test.ts` (C1); the flow-mode label keeps NWS and NWM on separate lines and
drops NWM without `reach_id` (C28); facts per kind use member gauges only (C4); the Forensic class-to-colour table never
makes 253 or 255 transparent or land-coloured (C2); the satellite age is computed at render time (C16).

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
| Public flash flood emergency, watch only (fixture server) | `/?flood=fixture-flood-flash`, `/?flood=fixture-flood-watch` | 12000 | facts per kind (C4): detection, damage threat, `NO_MEMBER_GAUGE`; leader to the polygon point; DEMO tags |
| Command flood view, point + cursor in the forecast | `/?flood=fixture-flood&preset=command&sel=36.80,-108.05` + `--eval-after-wait "window.__flood.getState().setCursor(Date.now()+30*3600e3)"` | 12000 | **the Flood Warning outline is still drawn** (its end is 8 h away) and `CURSOR_FUTURE_PRODUCTS` shows (C1) |
| Command flood view, model on | add `--eval-after-wait "window.__flood.getState().setFloodLayer('model',true)"` | 12000 | MODEL tags, amber dotted |
| Forensic flood (fixture) | `/?flood=fixture-flood&ws=forensic` with `--quality low --shot-timeout 240000` | 25000 | |
| Forensic unprepared | `/?flood=<a real live id without a bundle>&ws=forensic` | 15000 | Prepare button |
| A real live flood (Public, Command) | `/?flood=$(curl -s localhost:<api>/api/floods \| jq -r '.floods[0].id')` | 12000 | if NWS lists none, say so in the report |
| Phones | any of the above with `--w 390 --h 844 --dpr 2` | same | also `--w 1024 --h 768` |
| Fire regressions | the brief-4 final set (`docs/screenshots/brief4-final-*.png` URLs, PLAN-4 §9) | same | compare; nothing may change **except the overview's title slot (the switch) and the document title** (C23) |

Dev handles: `window.__store`, `__workspace`, `__flood` (new), `__mapRuntime`, `__sceneStore`, `__mapChrome()`. Check
`__mapChrome().unobstructed`, text contrast 4.5:1 over aerial and dark maps, keyboard (switch, hydrograph slider, gauge
picker), and no console error.

## 10. Roles, waves, schedule and finish estimate

### 10.1 Roles (ownership globs, acceptance, screenshots: `plan5-roles.json`)

Seven build roles (the critique split the overloaded bundle role, C11), then the integration in two parts and the final
check. "Depends on" means built, reviewed and fixed; milestone waits are in 10.2.

| Order | Role | Content | Hours (agent) | Depends on | Ports API / Vite |
|---|---|---|---|---|---|
| 1 | `backend-flood-sources` | M1 contracts triple (with the revision's fields) + config/secret/HTTP plumbing (allow-list PO.DAAC only, `X-Amz-*` masking); M2 `fixture-flood` (fictional issuers, forecast rising at its end, no-data strip, seven list-only floods with detail answers, edge cases) + fixture server + the `tmp_path` test fixture; M3 NWS flood family + `sources/nwps.py` (riv_gauges incl. envelope, rfc_max_forecast, IEM `current_flood_warnings` join, gauge detail, stageflow, reach streamflow; per-gauge timeouts) + recorder + samples; M4 flood catalog (grouping with SAME-county watch overlap and gauge episodes, naming, registry with last-known summaries, sources; ≤ 6 upstream requests) + `GET /api/floods`, `/status`, `/{id}` (rule 13 without the year step); SPEC rows | 5 (4-6.5) | — | 8751 / 5211 |
| 1 | `web-flood-overview` | hazard state, URL, history (one entry per switch), selectors, five chromes (stubs for the flood views), `TintLevel 'flood'` + `frameFlood()`, switch, flood markers, groups, gauges, leader labels, bar status, list panel (watches-hidden line, DEMO tags), legend, point card (+ the Fires-mode flood line), search, Forensic entry list, flood client, web fixtures, tokens, `floodCopy.ts` + guard, credits, `shot.mjs --reduced-motion` | 4.5 (3.5-5.5) | — | 8752 / 5212 |
| 2 | `backend-flood-bundle-api` | M1 `sources/water_maps.py` (RFC FIM with the layer-3 reach join, CatFIM, NWM, flowlines), `nfhl.py` (availability, effective dates), `opera.py` (+ token path), `usgs_water.py`; M2 bundle builder + build/files routes; M3 maps/model/satellite/flood-alerts (zone outlines on demand)/river-gauges (envelope)/local-alerts/evacuations `hazard=flood` routes, isolated endpoint contract test; SPEC §5.3 | 5.5 (4.5-7) | sources | 8753 / 5213 |
| 2 | `web-flood-public` | Public flood view (§4.4) with facts per kind; manifest loading, `startFloodBuild` and job polling (C10); official flood web (`floodModel`, hooks, `FloodOfficialNow`, `FloodEvacRows`); FEMA toggle; no-view hatch and image edge | 4.5 (3.5-5.5) | overview | 8754 / 5214 |
| 3 | `web-flood-forensic` | flood branch (FixedCopy kept), `forensicFloodState.ts`, `SceneManifest` assets, `frame.ts` and `SceneOverlays` for floods, drapes (no-view hatch), gauge bars, header, right panel (CatFIM toggle), evidence, dock hydrograph, Prepare, hand-off | 4 (3-5) | overview, public | 8756 / 5216 |
| 3 | `web-flood-command` | M1 hydrograph (`productsAt`, forecast high at the end, flow-mode lines); Command flood chrome, `FloodReadout`, layers drawer (CatFIM, FEMA, model), legend chips, model and floodplain layers, phones | 4.5 (3.5-5.5) | public | 8755 / 5215 |
| 4 | `backend-flood-live` | M1 live loop (second task, background prefetch, auto-build of 4), `/api/floods/status` from the loop, CLI `catalog --hazard flood` / `build-flood`, `check_bundle --hazard flood`, SPEC §8.9; M2 (cut line) past floods: year lists (§3.6), the detail chain's year step, IEM archive at past times, USGS observations | 3 (2-4) | bundle-api | 8760 / 5220 |
| 5 | `integration` | **part 1** (2.25 h; once sources, overview, bundle-api, public and command are fixed; may run beside forensic or live with an explicit owns list, 10.3): real data end to end (live list names and groups checked against NWS, two real flood bundles, every view with a real flood), cross-role fixes, README and CONTRACT §16.16 for the roles already fixed; **part 2** (0.5 h; after every role is fixed): the live loop and past floods end to end, the last `contract5` notes, SPEC check | 2.75 (2-3.5) | see the parts | 8759 / 5219 |
| 6 | `final-check` | gates (no flood test skipped), screenshot set, reduced motion, safety and secret scans (both secrets, count only), fire regressions (unchanged except the title slot and the document title), report | 1.5 (1-2) | integration | 8759 / 5219 |

**Every build role** gets one independent **review** (≈ 0.5 h; one reviewer, two lenses: (1) design and contract
fidelity: PLAN-5 §4 tables, the render, CONTRACT §16 shapes, tokens; (2) behaviour and safety: §5 wording, never merged,
not an all-clear, reduced motion, outages, secrets, fire regressions) on ports 8757 / 5217 (or 8758 / 5218 when two
reviews run at once), written to `docs/redesign/reports/review5-<role>.json` and `docs/screenshots/review5-<role>-*.png`,
in a clean worktree (`git worktree add <scratch>/review-<role> HEAD`, `web/node_modules` symlinked,
`FIRE3D_DATA_DIR`/`FIRE3D_CACHE_DIR` pointing at the main checkout's `data/`). Then one **fix** step (≈ 0.75 h) by a fixer
who owns the role's paths and commits `brief 5 <role>: review fixes`. Every role prompt (builder, reviewer, fixer) states
the secrets override of §0 (two secrets, BRIEF-5 decision 2; C30).

### 10.2 Milestone hand-offs

- `web-flood-overview` imports flood types only after `brief 5 backend-flood-sources: M1 contracts` is in `git log`
  (target ≤ 1 h); before that it does tokens, styles, hazard state, URL, history, switch, selectors, `TintLevel` and
  `frameFlood`. It copies the web fixtures after `…: M2 fixture` (target ≤ 2 h).
- `web-flood-public` tests manifest loading, `startFloodBuild` and job polling against the real route once
  `brief 5 backend-flood-bundle-api: M2 bundle` is in `git log` (about 3 h into that role); before that, against the
  fixture server's canned build job (§7.2).
- `web-flood-forensic` uses the real build and files routes (after `…bundle-api: M2 bundle`, which lands before
  Forensic starts in the default schedule) and mounts `Hydrograph variant="dock"` after `brief 5 web-flood-command: M1
  hydrograph` (target ≤ 1.25 h into Command). It starts with assets, drapes and gauge bars; if Command's M1 is not in
  `git log` by Forensic's last milestone, Forensic leaves a placeholder slot and the integration mounts the dock.
- Web roles switch from `serve_fixture.py` to the real API when the backend milestone that serves their routes is in
  `git log` (§7.2).

### 10.3 Scheduling rule (at most 2 agents at once)

A free slot goes, in order, to: (1) a pending fix, (2) a pending review, (3) the next role whose `depends_on` roles are
built, reviewed and fixed, ties broken by the order of 10.1 (`backend-flood-sources`, `web-flood-overview`,
`backend-flood-bundle-api`, `web-flood-public`, `web-flood-forensic`, `web-flood-command`, `backend-flood-live`), then
integration part 1 once its five roles are fixed, part 2 when everything is fixed, then the final check.

**Who may run beside whom.** Any two roles that `depends_on` does not order (directly or through other roles) may
overlap, so their `owns` must be disjoint; Appendix A checks every such pair, not only the default waves. Integration
part 1 owns `**` minus the `owns` of every role that may still be running beside it (`web-flood-forensic`,
`backend-flood-live`) and minus what Forensic reads (`web/src/state/flood*`, `web/src/api/floods.ts`,
`web/src/ui/timeline/[Hh]ydrograph*`, `web/src/scene/**`) until Forensic is fixed (C22). `state/flood.ts` is owned by
web-flood-command while Forensic reads it: from wave 3 on its shape changes only additively, announced in Command's
`contract5` note (C10).

### 10.4 Finish estimate

**Calibration.** Measured from commit times: brief 3's wave-1 roles, planned at about 5 h each, took 1.0-1.8 h
(us-catalog 00:36-01:38, us-web 00:36-02:25, us-pipeline 00:36-02:11, us-official 01:40-03:20 UTC, Oct 23); reviews
took 0.3-0.5 h and fix rounds 0.4-1 h; brief 4's view steps took 1-3 h each (the Public fire view **restyle** alone 3 h).
The web audit calibrated its parts on those brief-4 steps (`web.md` §6.1); the backend audit's 98 h was not calibrated.
The first plan gave each web role a single brief-4 step's hours although each combines two or three audit parts
(overview W1+W2+W8, 12.5 h in the audit; Public W3+W4, 10.5 h; Command W5+W6, 10.5 h), so the revision sets them at
4.5 h each, adds the critique's work (about 0.5 h to sources and Forensic), and splits bundle-api (C11, C12).

**Simulated schedule** (build starts about **22:30 UTC Nov 4**, after this revision is pushed; the user's answers to
U1-U3 can arrive during the first roles; no usage-limit pause). Computed with the 10.3 rule over every start order; this
order is the fastest:

| Slot A | Slot B |
|---|---|
| 22:30 `backend-flood-sources` → 03:30 | 22:30 `web-flood-overview` → 03:00; review → 03:30 |
| 03:30 fix overview → 04:15 | 03:30 review sources → 04:00; fix sources → 04:45 |
| 04:15 `web-flood-public` → 08:45; review → 09:15; fix → 10:00 | 04:45 `backend-flood-bundle-api` → 10:15; review → 10:45; fix → 11:30 |
| 10:00 `web-flood-forensic` → 14:00; review → 14:30; fix → 15:15 | 11:30 `web-flood-command` → 16:00; review → 16:30; fix → 17:15 |
| 15:15 `backend-flood-live` → 18:15; review → 18:45; fix → 19:30 | 17:15 integration part 1 → 19:30 |
| 19:30 integration part 2 → 20:00; final check → **21:30 UTC Nov 5** | |

- **Without pauses: about 21:30 UTC Thursday Nov 5 (1:30 PM Pacific).**
- **Most likely: about 00:30 UTC Friday Nov 6 (4:30 PM Pacific, Thursday Nov 5)**, allowing about 3 h for one or two
  usage-limit pauses (brief 3 had three, about 5 h in all).
- **Range: 18:00 UTC Nov 5 (10 AM Pacific) to 09:15 UTC Nov 6 (1:15 AM Pacific, Friday)** (the same simulation with
  −20 % and +35 % on every step, plus up to 5 h of pauses at the late end). Pacific is PST (UTC−8) since Nov 1.
- Milestones reported to the user: real flood list live (sources M4, ~03:30 UTC), first two roles done (~04:45), Public
  flood view done (~10:00), flood bundles and all flood routes (~11:30), Forensic (~15:15), Command (~17:15), live loop
  and past floods (~19:30), finished (~21:30 + pauses).
- The critical path is now the work itself (two slots are busy almost all the time): sources → bundle-api → (command,
  live) on one side, overview → public → forensic → command on the other, then integration and the final check. If U1 =
  (c) (no past floods), take about 1 h off; if the grouping review on real data needs a second pass, add about 1 h.

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Grouping splits one flood into several or merges two | Named constants; tests on today's recorded answers; the integration reviews every live name and group against the NWS products and records the table in its report |
| R2 | Ids change after a restart, merge or split, breaking links; or one gauge's later flood reuses an old id | Registry + aliases; gauge keys scoped to episodes, VTEC keys permanent (C8); deterministic anchors; the rule-13 detail chain answers old links (C20); tests through a merge, a split, a 48 h gap and a gauge flooding twice |
| R3 | Live alerts lack the gauge id (H-VTEC): a warning linked to the wrong gauge | IEM bulk H-VTEC join first (one request), then place + river name; product text (background, cached) when still ambiguous; a test with two gauges on one river in one polygon |
| R4 | Unreliable sources: NWPS bbox lists time out; FEMA resets connections (8 of 14); USGS 429 from the shared cloud address; NOAA maps call themselves experimental | `riv_gauges` + `rfc_max_forecast` nationally and for nearby gauges, NWPS per gauge only with a 20 s timeout and one retry (C18); retries, `DownMemo`, 30-day caches; per-layer `layer_status`; each layer has its own "could not be reached" string and absence sentences render only for `available` answers (D24, C3) |
| R5 | Safety wording: a forecast, a model map or days-old satellite water read as "water now"; no layer, no-data pixels or a far gauge read as "dry"; a warning's end time read as the flood's end; a forecast maximum at the last step read as a crest | Per-layer labels with kind and time (D8); no area figures in Public (D5, C6); no-view hatch for clouds and no data, image edge drawn (D25, C2); facts from member gauges only, per kind (C4); products after now kept (C1); `FORECAST_HIGH_LINE` (C7); ages computed at render (C16); §5 strings; word-bounded guard with verbatim text marked (C24); both review lenses |
| R6 | `EARTHDATA_TOKEN` leaks (headers, logs, errors, cache files, GDAL) | Header only, host allow-list, `mask_secrets`, no GDAL auth, fake-token tests, count-only scans of tree, diffs and commit messages |
| R7 | Token path cannot be tried end to end (no token here) | Mock-transport tests; default path needs no token; the report says "untested with a real token"; the user can test later (§12) |
| R8 | Satellite water is 2-4 days old, blind under cloud; Earthdata GIS time metadata is stale and its default mosaic picks cloudy images | Lock to one granule; show image time and cloud share; amber after 3 days; `SAT_CAVEAT` |
| R9 | Fire regressions in shared files (about 45 "no incident = overview" checks) | `noEventOpen()`; additive parameters with fire defaults; fetch-spy test; brief-4 screenshot set re-shot by the final check |
| R10 | Test isolation (the brief-4 503/404 failure) | Isolated flood endpoint test from the start (§8) |
| R11 | Time zones: NWPS POSIX zones; `riv_gauges.obstime` has no zone; DST in hydrograph ticks | IANA zones from `regions`; `obstime` treated as UTC only after checking it against NWPS in a recorded sample; DST test |
| R12 | NWS may retire VTEC (PNS 26-62) | CAP `references` fallback key, tested |
| R13 | Contract churn while web builds on fixtures | M1 lands the full §16 types first, the revision's fields included; later changes additive and announced in `contract5` notes |
| R14 | Two slots, usage-limit pauses and SwiftShader slow the schedule; both slots are busy almost all the time | §10.3 rule with a fixed tie order; cut lines per role; `--quality low --shot-timeout 240000` for Forensic; Forensic's dock can move to the integration if Command's M1 is late |
| R15 | The water circle's noise layers cost CPU on phones | Paused when hidden, still under reduced motion; fallback: pre-rendered noise moved by CSS transforms |
| R16 | Colour clashes: minor orange ≈ fire orange; flood edge ≈ selected-point blue | Fire markers hidden in Floods; shape and words everywhere; the selected point keeps its dot, halo and label |
| R17 | Large polygons (RFC FIM, NFHL, NWM) slow the map and bundles | Per-flood bbox queries, server-side simplification, paging ≤ 2,000, GeoJSON sources updated in place |
| R18 | No real flood listed at integration time | The fixture covers every case; the report says so; a recorded real answer is replayed through the fixture server |
| R19 | A river flood longer than 60 km | Cut to the reach around the primary gauge; `aoi_note` says so |
| R20 | IEM limits (2 phenomena per request; "not for highly trafficked sites") | One bulk join request per list build (5 min cache); year lists built once in the background at 30 a minute, cached for good for closed years; past-flood text only on request |
| R21 | The list build fans out (zones, product text, series) and starves fire weather calls on the shared NWS limiter (C9) | Five national requests per build, nothing per flood; SAME-county overlap offline; zone outlines, product text and series on demand or in the live loop's background budget; a request-count test |
| R22 | Past-flood severity is not in IEM's bulk year list (measured, C29) | The role looks for a bulk severity/damage route first; else `PAST_RULE_FALLBACK` with its own note; never an unlabelled partial list |
| R23 | Evacuation feeds built for wildfires (Oregon) answer "none" for floods (C5) | `hazard=flood` drops Oregon with `OR_EVAC_FIRE_ONLY`; Cal OES `EVENT_TYPE` verbatim; flood wording only; guard test |
| R24 | CLAUDE.md names one secret while BRIEF-5 approved two (C30) | Every role prompt states the override; the final check scans for both; U3 asks the user whether to update CLAUDE.md |

## 12. Decisions only the user can make (the build proceeds on the recommendation)

- **U1. Past floods (year lists).** (a) **Recommended:** "2026" and "2025" tabs listing river floods that reached
  moderate or major at a gauge, plus Flash Flood Warnings with a "considerable" or "catastrophic" damage threat or a
  Flash Flood Emergency. IEM's yearly list lacks those severity fields (measured in this revision), so if the build
  finds no bulk route for them, the tabs list every river Flood Warning at a gauge plus every Flash Flood Emergency, and
  say so at the foot of the tab; (b) every Flood and Flash Flood Warning (thousands a year; slow, cluttered lists);
  (c) current floods only for now (finishes about 1 h earlier; the year tabs come later). Needed by backend-flood-live
  (about 15:00 UTC Nov 5).
- **U2. A Flood Watch where no flooding is reported yet.** (a) **Recommended:** listed, but hidden by default behind a
  "Show watches" switch (watches can cover dozens of counties); (b) shown like the other floods; (c) not listed on its
  own, only attached to floods it overlaps. Whatever the choice, a point check always lists every NWS product at the
  point, and the list says how many watches are hidden. Needed during the first two roles (a default value only).
- **Optional action, not a decision:** the NASA Earthdata token (adds radar water maps that see through clouds, and
  the newest optical day). Make a free account at urs.earthdata.nasa.gov, choose "Generate Token", put
  `EARTHDATA_TOKEN=<token>` in the gitignored `.env` (never in chat or git), sign in once at search.earthdata.nasa.gov and
  download any one OPERA DSWx file so PO.DAAC is approved for the account, and renew the token when it expires (about
  60 days; check the date when you make it). Without it everything works; the satellite layer says
  `SAT_NOT_SET_UP_SHORT`.
- **U3. CLAUDE.md's secrets line.** It still says "The only secret is `FIRMS_MAP_KEY`", while BRIEF-5 decision 2
  approved `EARTHDATA_TOKEN` as a second secret. (a) **Recommended:** you (or the orchestrator, on your say-so) change
  that one line to name both secrets, citing decision 2; (b) leave CLAUDE.md as it is: every role prompt carries the
  override (§0) and the final check scans for both. Agents do not edit CLAUDE.md on their own. The build proceeds
  with (b) until you answer.

## Appendix A. Ownership check

Run this snippet from the repo root (it is not saved as a script: this step writes documents only). It expands each
role's `owns` globs (`*` stays inside one folder, `**` crosses folders) over `git ls-files` plus every role's
`planned_new` paths. **Revised (C22):** it checks every pair of roles (and integration part 1) that `depends_on` does
not order, directly or through other roles, since those may run at the same time under the 10.3 rule, instead of only
the default waves; integration part 1 owns everything minus the `owns` of the roles that may run beside it and minus
what Forensic reads. It fails if two such units own the same path, a glob matches nothing, a build role owns a
`shared_frozen` path, or an everything-owning unit could overlap another. Run on the revised `plan5-roles.json`: 10
units, 15 pairs that may overlap, 0 problems; with a clash injected on purpose (Forensic also owning
`web/src/state/flood.ts`, overview owning `backend/fire3d/sources/nws.py`) it reports 3 clashes and exits 1. A
separate check found no two script files in one folder whose names differ only by case (`lib/fileNames.test.ts` rule).

```python
import itertools, json, re, subprocess, sys
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
roles = {r['id']: r for r in d['roles']}
frozen = [rx(g) for g in d['shared_frozen']]
owned = lambda globs: {f for f in files if any(rx(g).match(f) for g in globs)}
bad, units = 0, {}                       # unit -> (depends_on, owned paths or None = everything)
for r in d['roles']:
    if r.get('parts'):
        for p in r['parts']:
            ex = set().union(set(), *(owned(roles[x]['owns']) for x in p.get('owns_all_except_roles', [])))
            ex |= owned(p.get('owns_except', []))
            units[f"{r['id']}#{p['part']}"] = (p['depends_on'], None if p.get('owns_all') else files - ex)
        continue
    if r.get('owns_all'): units[r['id']] = (r['depends_on'], None); continue
    for g in r['owns']:
        if not owned([g]): print('no match', r['id'], g); bad += 1
    mine = owned(r['owns'])
    for f in sorted(mine):
        if any(z.match(f) for z in frozen): print('frozen', r['id'], f); bad += 1
    units[r['id']] = (r['depends_on'], mine)
def expand(x): return [u for u in units if u == x or u.startswith(x + '#')]
def ancestors(u):
    seen, todo = set(), list(units[u][0])
    while todo:
        for v in expand(todo.pop()):
            if v not in seen: seen.add(v); todo += list(units[v][0])
    return seen
pairs = 0
for a, b in itertools.combinations(units, 2):
    if a in ancestors(b) or b in ancestors(a): continue        # ordered: never at the same time
    pairs += 1
    A, B = units[a][1], units[b][1]
    if A is None or B is None: print('owns everything while another may run', a, b); bad += 1; continue
    for f in sorted(A & B): print('clash', f, a, b); bad += 1
print(f'{len(units)} units, {pairs} pairs that may overlap, {bad} problems')
sys.exit(1 if bad else 0)
```

## Critique log (revision of 2026-11-04, 21:15-22:20 UTC)

An independent critic raised 30 problems (C1-C30). All were accepted; four were accepted with a different detail than
the critic proposed (C9, C11, C12, C30), each said below. No app code was changed. Two polite IEM requests were made
to settle C29 (no key, Fire-3d User-Agent).

| Id | Verdict | What changed |
|---|---|---|
| C1 | accepted | D13, §4.6, §4.7: after now the map, readout, point check, Forensic dock and drapes keep the products in effect now (`productsAt`), with `CURSOR_FUTURE_PRODUCTS` and "until {time}" lines; fixture warning ends 8 h after now; tests on both sides of now; the forecast-cursor screenshot must show the warning outline (§9) |
| C2 | accepted | D25, §3.7, §4.4, §4.7, CONTRACT §16.5: no data (255) hatched like clouds, never transparent; image edge outlined; `SAT_NODATA_POINT`, `SAT_OUTSIDE_POINT`, key item; PNG palette test and Forensic class-to-colour test |
| C3 | accepted | D24, §3.8, §5: `ALERTS_UNAVAILABLE`, `GAUGES_UNAVAILABLE`, `RFC_FIM_UNAVAILABLE`, `CATFIM_UNAVAILABLE` (B); absence sentences only for `available` answers; edge-case fixtures (`api/edge/`, `?edge=`) and a test |
| C4 | accepted | D10, D11, §4.4 facts per kind (river; flash/areal with detection and damage threat verbatim; watch); member gauges only; leader to the polygon point without a gauge; `fixture-flood-flash` and `fixture-flood-watch` detail cases screenshotted by web-flood-public |
| C5 | accepted | D23, §2, §3.4, §4.5: `/api/extras/evacuations?hazard=flood` (bundle-api owns `api/extras.py`; `sources/evacuations.py` stays frozen): Oregon not-available with `OR_EVAC_FIRE_ONLY`, Cal OES `event_type` verbatim; new `FloodEvacRows.tsx` with `EVAC_NONE_LISTED`; guard test against "fire" in flood evacuation rows |
| C6 | accepted | D5: no area number in Public ("Mapped" / "Not mapped here"); Command shows `RFC_FIM_AREA_COMMAND` ("measured by Fire-3d … includes the river channel"); `stats` from member reaches via the layer-3 `feature_id` join, null when the join fails (§3.3) |
| C7 | accepted | `crest_at_end` in `GaugeForecast` (CONTRACT §16.4); `FORECAST_HIGH_LABEL` / `FORECAST_HIGH_LINE`; hydrograph "HIGH … AT END · STILL RISING"; fixture gauge `ZZRF2`; tests |
| C8 | accepted | Rule 3 (gauge join only when memberships overlap in time) and rule 10 (gauge keys are episodes `NWSLI@first_seen_ms`, VTEC keys permanent); CONTRACT §16.1 registry lines; tests for one gauge flooding twice, live and in the year list |
| C9 | accepted, with a detail | §3.2: five national requests per list build, nothing per flood; watch overlap by CAP `geocode.SAME` + packaged county shapes; H-VTEC join from IEM `current_flood_warnings`; start refinement from cached series only; ≤ 6-request test. Detail added: drawn zone outlines on demand at most 20 per answer, then county shapes with `ZONES_AS_COUNTIES`, and the live loop prefetches the rest |
| C10 | accepted, with a fallback | web-flood-public owns manifest loading, `startFloodBuild` and job polling (tested against bundle-api M2); `forensicFloodState.ts`; `state/flood.ts` additive-only in wave 3; Forensic owns `scene/frame.ts` and `scene/overlays/SceneOverlays.tsx`; `SceneManifest` (with `mode`, which the scene also reads) in CONTRACT §16.12; if the frozen `scene/fx/**` does not typecheck with it, a `SceneAssets` base type for the shared parts, never a cast |
| C11 | accepted, with a different split | New role `backend-flood-live` (live loop, auto-build, prefetch, CLI, `check_bundle`, past floods). It owns `floods/live.py`, `floods/history.py`, `api/floods.py`, `api/app.py`, `cli.py`, `check_bundle.py`, the contract triple and its tests, but **not** `floods/catalog.py`, `grouping.py` or `naming.py`, so integration part 1 can fix names and groups while it runs. It follows bundle-api; Forensic depends on overview and public plus a milestone wait on bundle-api M2 (not on bundle-api's review), which the simulation showed is faster |
| C12 | accepted, with different numbers | §10.1, §10.4: overview, Public and Command 4.5 h; bundle-api 5.5 h after the split; sources 5 h and Forensic 4 h for the critique's additions; live 3 h; start 22:30 UTC (now, after this revision). Simulated over every start order with the 10.3 rule: **21:30 UTC Nov 5 without pauses; most likely 00:30 UTC Nov 6 (4:30 PM PST Nov 5); range 18:00 UTC Nov 5 to 09:15 UTC Nov 6.** Later than the critic's figure because the split role brings its own review and fix and the additions cost time |
| C13 | accepted | D21: FEMA floodplain as a Public Layers-drawer toggle, off by default, with `NFHL_LABEL` (effective date) and `NFHL_NOTE` in the key; `floodProfile.test.ts` updated |
| C14 | accepted | D22: "NWS category flood maps (experimental)" toggle, off by default, in the Command drawer and the Forensic Layers tab; never in Public |
| C15 | accepted | §5.3 category display table for every `GaugeCategory`; `THRESHOLDS_TODAY` (B); circle meanings for no product now, watch, past and demo; `NO_GAUGE_NEAR` |
| C16 | accepted | §3.3, §5.4, CONTRACT §16.14: `SAT_CAVEAT` carries only the absolute time; the web computes ages at render; frozen files never store a relative age; 7-day-old bundle test |
| C17 | accepted | `EARTHDATA_AUTH_HOSTS` = PO.DAAC archive only; `mask_secrets` masks `X-Amz-Security-Token`, `X-Amz-Signature`, `X-Amz-Credential` values; mock-redirect test (count-only) |
| C18 | accepted | D18, §2, §3.4, CONTRACT §16.8: nearby and bbox gauges from `riv_gauges` layer 0 by envelope; `gauges_in_bbox` removed; NWPS per gauge only, 20 s timeout, one retry, outage memory |
| C19 | accepted | D16, §3.3, CONTRACT §16.4: FEMA layer 0 availability before `NFHL_OUTSIDE`; layer 3 `EFF_DATE` shown as "effective {date}"; `min_zoom` null for GeoJSON; `NFHL_ZOOM` dropped |
| C20 | accepted | Rule 13 resolution chain for `GET /api/floods/{id}` (live → year → alias → bundle → last-known → 404), `resolved_from` in `FloodDetailResponse`, canonical-id URL replace, `FLOOD_LAST_KNOWN`; tests after a merge and after 48 h |
| C21 | accepted | §4.1: module flag in `history.ts` so a hazard switch pushes one entry; `navigationUrl` drops the other parameter; `history.test.ts` cases both ways |
| C22 | accepted | §10.3 and Appendix A: integration part 1's explicit owns; the check now covers every pair that may overlap; `TintLevel 'flood'` and `frameFlood` in overview M1; `lib/areaDistance.ts` flood-only, `fireView.ts` untouched |
| C23 | accepted | §4.2, §9, roles: fire overview "unchanged except the title slot and the document title" (overview and final check); Forensic acceptance requires `FixedCopy` in the flood branch and entry page, phones included |
| C24 | accepted | §5, §5.1: `*.test.ts` excluded from the glob; word-boundary patterns; `data-verbatim` text stripped before scanning; planted-word test |
| C25 | accepted | §7.1, §8: a session pytest fixture generates `fixture-flood` into `tmp_path`; flood tests never skip; skip counts recorded; the final check fails on a flood test skip |
| C26 | accepted | D17, §7.1: fictional issuers ("NWS Example Office (synthetic)", `KZZZ`, `ZZRFC`); list-only floods `fixture-flood-<kind>` with fictional names, `DEMO_TAG` wherever `synthetic`, and detail, alerts, gauges and maps answers |
| C27 | accepted | §4.3: point checks always list every NWS product at the point, watches included; `WATCHES_HIDDEN` in the list foot and bar; `FLOOD_HERE_IN_FIRES` line on the fire point card |
| C28 | accepted | D20, §4.6: flow-mode handle with NWS and NWM on separate lines; no NWM line without `reach_id`; `hydrographModel` test |
| C29 | accepted, with a measurement | §3.6: measured that `vtec_events_bystate` has `hvtec_nwsli` but no severity, damage tag or emergency flag; IEM's API describes `damagetag` / `is_emergency` and an `emergencies` list. Year lists built once in the background (49 requests a year + 1); `PAST_RULE` when a bulk severity route is found, else `PAST_RULE_FALLBACK` with its own note; registry lookup by VTEC key so 2026 ids match live ids; U1 reworded |
| C30 | accepted, second option | Agents do not edit CLAUDE.md (frozen; changing it is the user's call): every role prompt states the two-secret override citing BRIEF-5 decision 2 (§0, `plan5-roles.json` notes), the final check scans both, and U3 asks the user whether to update the line |
