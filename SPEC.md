# Disaster Mapping — Build Spec v1

Source of truth for every build agent. Sections marked **(Contract)** are interfaces other modules depend on:
implement them exactly. If a contract is wrong or impossible, make the smallest compatible change, keep old fields
working, and list the deviation in your report. Sections marked **(Guidance)** describe recommended approaches you
may improve on.

Reference UI (a mocked demo we are rebuilding on real data): `docs/reference/firetrace-demo.png`. View it.
Do **not** use the name "FireTrace" anywhere. The app is called **Disaster Mapping** (wildfires and floods; brief 6).
It was called Fire-3d until brief 6: internal names keep the old name so `.env`, `data/`, saved preferences and old
links keep working (the `fire3d` Python package, the `FIRE3D_*` settings, URL parameters, storage keys, CSS classes;
the GitHub repository is now `disaster-mapping`). Historical documents keep their wording.

---

## 0. Product

A wildfire and flood mapping app for the **lower 48 US states and DC** (floods since brief 5, §5.3 and §8.8-8.11).
For wildfires it is a 3D analysis app (brief 3; it started with California), built on
real data. Alaska, Hawaii and US territories are not supported yet: their fires are not listed, and a point there says
"Disaster Mapping does not support Alaska, Hawaii or US territories yet." The national fire list comes from NIFC WFIGS (IRWIN);
in California CAL FIRE stays the record and WFIGS adds only the fires CAL FIRE does not list
(docs/redesign/CONTRACT.md §14.1-14.2). The brief-2 text below describes California, where it still holds:

- **Live mode:** incidents CAL FIRE currently lists as active, plus satellite fire detections, perimeters, weather, a
  72-hour **ensemble** fire-spread forecast (burn probability), and live firefighting aircraft from ADS-B.
- **Historical mode:** **all 2025** California incidents ≥ 300 acres (toggle for ≥ 100). Each gets a forensic
  replay of the observed spread (timeline animation, charts, key events) and **hindcasts**: a forecast launched from
  any past moment, scored against what actually burned.
- The 3D terrain is real (USGS 10 m DEM + NAIP aerial imagery + LANDFIRE vegetation). It is rendered in the
  **cinematic "realistic + parametric" art direction** of `docs/reference/art-direction.png`: photographic terrain in a
  dark, moody atmosphere, overlaid with a luminous golden data lattice, isolines, and monospace telemetry, with depth
  of field. Modes: hybrid (default), realistic, parametric (§9.0). The panel layout follows
  `docs/reference/firetrace-demo.png`, restyled as dark glass.
- WeatherNext 3 is **out of scope for now** (access pending). Weather sits behind a `WeatherSource` interface so it
  can be added later. Do not implement a WeatherNext adapter.

## 1. Environment facts (verified 2026-10-16)

- macOS arm64, 12 cores, 36 GB RAM. **Only ~28 GB free disk:** keep `data/` under 3 GB. The only bulk downloads
  allowed are the FIRMS 2025 yearly CSVs (~46 MB total).
- Node 25.6.1, npm 11.9. Python 3.12 via **uv 0.10.3**. Xcode CLT clang 17 is present (pyretechnics compiles from
  sdist in ~45 s).
- No GDAL CLI. Use `rasterio` wheels, which bundle GDAL.
- **SSL gotcha:** the python.org Python's `urllib` fails certificate checks on this machine. Use `httpx` (certifi).
  `fire3d/config.py` sets `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE` to `certifi.where()` at import, so
  rasterio/GDAL `/vsicurl/` reads work.
- Google Chrome is installed. Playwright drives it with `channel: "chrome"` (no browser download).
- Free-to-use public APIs only. The one secret is the **NASA FIRMS MAP_KEY**, which lives in `<repo>/.env` as
  `FIRMS_MAP_KEY=…`. That file is gitignored and chmod 600.
  - `fire3d/config.py` loads `.env` at import with a tiny built-in parser (no python-dotenv); real environment
    variables take precedence.
  - **Never print, log, commit, or copy the key** into any other file, report, screenshot, or error message. Mask
    it as `***` in logged URLs.
  - Limit: **5,000 transactions per 10 minutes**; one area request costs roughly 5–8. Use a client-side limiter
    (≤ 150 FIRMS API requests per rolling 10 min) and cache aggressively.
  - Usage check: `https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=…`.
  - Everything must still work without the key, using the no-key fallbacks in §2.

## 2. Data sources (all verified working on 2026-10-16)

| Data | Endpoint | Notes |
|---|---|---|
| CAL FIRE live incidents | `GET https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=false` | JSON list. Fields: `Name` (may have trailing space), `Started`/`Updated` (ISO Z), `AcresBurned`, `PercentContained` (nullable), `Latitude`, `Longitude`, `County`, `Location`, `AdminUnit`, `Type` ("Wildfire", "Fire", …), `UniqueId` (uuid), `Url`, `IsActive`, `Final`, `ExtinguishedDate`. 13 active on 2026-10-16. |
| CAL FIRE 2025 incidents | `GET …/IncidentApi/List?inactive=true&year=2025` | 556 incidents: 130 ≥ 100 ac, 78 ≥ 300 ac, 36 ≥ 1000 ac. Largest: Gifford 131,612; Madre 80,779; Garnet 59,844; Palisades 23,448; Eaton 14,021. |
| **FIRMS area API (primary, key)** | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SOURCE}/{w,s,e,n}/{DAY_RANGE}/{YYYY-MM-DD}` | DAY_RANGE is the number of days starting at the date: **max 5** for VIIRS/MODIS/LANDSAT, **max 2 for GOES_NRT** ("Invalid day range" otherwise). Availability on 2026-10-16 (`/api/data_availability/csv/{KEY}/ALL`):<br>• `VIIRS_SNPP_SP` 2012-01-20…2026-06-30, `VIIRS_NOAA20_SP` 2018-04-01…2026-06-30, `VIIRS_NOAA21_SP` 2023-03-01…2026-06-30, `MODIS_SP` 2000-11…2026-07-31<br>• NRT: `VIIRS_SNPP_NRT` and `VIIRS_NOAA20_NRT` from 2026-07-01, `VIIRS_NOAA21_NRT` from 2024-01-17, `MODIS_NRT` from 2026-08-01, `GOES_NRT` from 2022-08-09, `LANDSAT_NRT` from 2022-06-20<br>**2025 replays:** use the three VIIRS SP sources + MODIS_SP (≈6 VIIRS passes/day at 375 m; e.g. Eaton Jan 8–12: ~530 NOAA-20, ~550 SNPP, ~660 NOAA-21 detections) + GOES_NRT + LANDSAT_NRT.<br>**Live:** the NRT sources (SP for dates before NRT coverage).<br>Columns as the CSV feeds below, plus `instrument` and `type`. **`acq_time` is NOT zero-padded** ("949" = 09:49 UTC): `zfill(4)`.<br>**`type`:** 0 vegetation, 1 volcano, 2 static land source, 3 offshore. Real fire pixels can be tagged 2 (MODIS on Eaton/Palisades) or 3 (Palisades coast), so drop only type 1 and rely on space-time clustering (§8.3) to exclude unrelated static sources.<br>**GOES_NRT** rows: satellites `G16`, `G18` (also `G19`), plus duplicate `G18FRP`-style rows (drop the `*FRP` duplicates). Pixel ≈ 2–3 km; `scan`/`track` are not km (assume a 2 km footprint). Confidence ranges from `30.0000` (low) to `100`. ~2,000 rows per 2 days over Eaton. Use GOES for **timing and activity** (ignition refinement, hourly FRP/activity series, gaps between VIIRS passes), not for the spatial burned mask.<br>**LANDSAT_NRT**: 30 m, sparse (~8-day revisit). Use it for the spatial mask when present.<br>**Caching:** SP and past-dated responses are immutable (TTL 30 d); NRT responses touching the last 48 h TTL 15 min. |
| FIRMS live CSV (no key) | `https://firms.modaps.eosdis.nasa.gov/data/active_fire/{dir}/csv/{prefix}_USA_contiguous_and_Hawaii_{24h\|48h\|7d}.csv`; (dir, prefix) ∈ (`suomi-npp-viirs-c2`,`SUOMI_VIIRS_C2`), (`noaa-20-viirs-c2`,`J1_VIIRS_C2`), (`noaa-21-viirs-c2`,`J2_VIIRS_C2`), (`modis-c6.1`,`MODIS_C6_1`) | Used for the **California-wide live catalog** (`detections_24h` for every incident in one request per source), and as the fallback when the key is missing. VIIRS columns `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence(l/n/h),version,bright_ti5,frp,daynight`. MODIS has `brightness`, numeric `confidence`. 7d files < 1 MB. |
| FIRMS 2025 yearly archive (no key, fallback) | `https://firms.modaps.eosdis.nasa.gov/data/country/{viirs-snpp\|modis}/2025/{viirs-snpp\|modis}_2025_United_States.csv` | 37 MB / 9 MB, full year 2025, SNPP + MODIS only (`viirs-noaa20` yearly is 404). Fallback for 2025 when the area API is unavailable. Download once, filter to the California bbox (lon −124.6…−113.9, lat 32.4…42.1), cache as parquet. Same `type` rule. |
| NIFC daily perimeters | `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Daily_Perimeters_Public/FeatureServer/0/query` with `where`, `outFields`, `outSR=4326`, `f=geojson` (max 2000 records/page; paginate with `resultOffset`) | 1,046 CA records in 2025. Fields: `poly_IncidentName`, `poly_PolygonDateTime` (epoch ms, may be null → fall back to `poly_DateCurrent` → `poly_CreateDate`), `poly_GISAcres`, `poly_FeatureCategory` ("Wildfire Daily Fire Perimeter" / "Wildfire Final Fire Perimeter"), `attr_IrwinID`, `attr_POOState` ("US-CA"), `attr_FireDiscoveryDateTime`, `attr_ContainmentDateTime`, `attr_FireCause`. **Messy:** many duplicate edits share one timestamp; names recur across years and states (e.g. "Gifford" 2020/2021/2023/2025; "Eaton" in MN/FL). California fires (CAL FIRE records) keep this path exactly: state = US-CA, time window [start − 2 d, start + 120 d], distance (< 30 km from the CAL FIRE point). Fires elsewhere (NIFC WFIGS records) match by IRWIN id: `UPPER(attr_IrwinID) IN (...) OR UPPER(poly_IRWINID) IN (...)`, else by name in `US-<state>`; the time window, distance and size checks stay; a WFIGS record with neither IRWIN id nor state is not matched (warning). Example where-clause that works: `attr_POOState='US-CA' AND poly_PolygonDateTime >= TIMESTAMP '2025-01-01 00:00:00'`. Current perimeters of live fires are also in `WFIGS_Interagency_Perimeters_Current`. |
| USGS 3DEP DEM | `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox={minx},{miny},{maxx},{maxy}&bboxSR={epsg}&imageSR={epsg}&size={W},{H}&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image` | Returns a float32 GeoTIFF already in our UTM grid. maxImage 8000. |
| LANDFIRE | `https://lfps.usgs.gov/arcgis/rest/services/Landfire_{ED}/{ED}_{LAYER}_CONUS/ImageServer/exportImage?…&format=tiff&interpolation=RSP_NearestNeighbor&f=image` with ED ∈ {`LF2023`,`LF2024`,`LF2025`} (LF2023 added in brief 3, same service), LAYER ∈ {`FBFM40`,`CC`,`CH`,`CBH`,`CBD`,`EVT`} | int16, 30 m native (EPSG:5070), reprojected server-side. FBFM40 codes: 91–99 non-burnable, 101–204 burnable. **CC** is percent; **CH** and **CBH** are metres × 10; **CBD** is kg/m³ × 100. Historical: the pre-fire edition LF{federal fiscal year of the start − 1}, at least LF2023 (a fire before October 2023 is refused with 422 unless forced); live: LF2025. LF2025 has no data in parts of the South and East (none at Black Cove, NC, checked 2026-10-23). Optional seasonal fuels for live: `Landfire_LF2025_Seasonal_Fuels_2026/LF2025_FBFM40_FA26` (fall 2026). |
| NAIP imagery | `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=…&bboxSR=…&imageSR=…&size=W,H&format=jpg&f=image` | maxImage 4000×4000. (`USGSNAIPPlus` timed out; don't use it.) |
| Sentinel-2 L2A | STAC `POST https://earth-search.aws.element84.com/v1/search` with `{"collections":["sentinel-2-l2a"],"bbox":[…],"datetime":"a/b","query":{"eo:cloud_cover":{"lt":20}}}` | Assets `nir` (B08, 10 m), `swir22` (B12, 20 m), `scl`. Public HTTPS COGs; read windowed via rasterio `WarpedVRT` onto our grid. **Apply each asset's `raster:bands` scale/offset** (L2A has a −0.1 offset since 2022). |
| Weather forecast (deterministic) | `https://api.open-meteo.com/v1/forecast?latitude=a,b,…&longitude=c,d,…&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation&models=gfs_hrrr&wind_speed_unit=ms&timeformat=unixtime&past_days=3&forecast_days=4` | Multi-location works (one JSON object per location). HRRR fills only ~48 h (later hours null); fill the rest with `models=gfs_seamless`. `wind_direction_10m` is the meteorological FROM direction. |
| Weather ensemble (**live only**) | `https://ensemble-api.open-meteo.com/v1/ensemble?…&models=gfs025` (31 members: control + `_member01…30`) or `models=ecmwf_ifs025` (51) | Keys look like `wind_speed_10m_member07`. Multi-location works. **Only covers ~the last 90 days plus the forecast** (range 2026-07-16…2026-11-21 on 2026-10-16), so it cannot be used for 2025. |
| Weather historical | `https://historical-forecast-api.open-meteo.com/v1/forecast?…&start_date=YYYY-MM-DD&end_date=…&models=gfs_hrrr` | Archived HRRR forecasts; works for 2025. Fallback: `https://archive-api.open-meteo.com/v1/archive` (ERA5). Free tier limits per IP: daily (~10k), hourly (~5k) and per-minute (~600) weighted calls; a refusal is HTTP 429 with a JSON body such as {"error":true,"reason":"Daily API request limit exceeded. Please try again tomorrow."} (resets 00:00 UTC). Cache everything; never cache an error body (§8.4). |
| ADS-B | `https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}`, `https://api.adsb.lol/v2/type/{ICAO type}`; fallback `https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}` (free for non-commercial use) when adsb.lol is unreachable | Response `{ac:[…], now, total}` (adsb.fi: `{aircraft:[…], now (s), resultCount}`). Aircraft fields: `hex`, `flight` (callsign, space-padded), `r` (registration), `t` (ICAO type), `lat`, `lon`, `alt_baro` (ft, or the string "ground"), `alt_geom`, `gs` (kt), `track`, `category`, `seen`, `squawk`. |
| NWS fire weather alerts (no key; added 2026-10-18) | `GET https://api.weather.gov/alerts/active?area=CA&event=Red%20Flag%20Warning,Fire%20Weather%20Watch` (header `User-Agent: Disaster-Mapping/0.1 (research prototype)`, `Accept: application/geo+json`); zone polygons `GET https://api.weather.gov/zones/fire/{UGC}` | GeoJSON CAP alerts; fire weather alerts carry `geometry: null` and list their fire weather zones in `geocode.UGC` / `affectedZones`; P-VTEC in `parameters.VTEC` (e.g. `/O.CON.KLOX.FW.W.0005.000000T0000Z-261018T0300Z/`). Open data, free to use; a User-Agent is required (optional contact via `FIRE3D_NWS_CONTACT`). NWS keeps no archive: past dates answer an empty list. Cached 2 min (alerts) / 30 days (zones). |
| NWS alert archive (Iowa Environmental Mesonet, no key; added 2026-10-18) | `GET https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py?lat=&lon=&sdate=YYYY-MM-DD&edate=`, `/json/vtec_event.py?wfo=LOX&year=2025&phenomena=FW&significance=W&etn=1`, `/geojson/vtec_event.py?…` (same query) | Public domain ("may be used freely by anyone for any lawful purpose"), an archived copy of NWS products, not an NWS source. bypoint lists events by their start date (look back about 14 days); `vtec_event` gives per-zone `utc_product_issue`, `utc_issue`, `utc_expire` (final; a watch upgraded or cancelled before it began ends before it begins) and the original text products (`report`, `svs[]`); the geojson features' `id` is the UGC. Cached 30 days (30 min while the window touches the last day). |
| NIFC WFIGS Incident Locations (no key; brief 3) | `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations{_Current,_YearToDate,}/FeatureServer/0/query` with `IncidentTypeCategory='WF'` (+ `UniqueFireIdentifier LIKE '<year>-%' AND IncidentSize>=<min>` for year lists), explicit `outFields`, `outSR=4326`, `f=json`, 2,000 rows per page | The national fire list and each fire's agency record (`sources/wfigs.py`; Current 5 min, YearToDate 30 min, all years 24 h, one record by IRWIN id 10 min). Item licence is a disclaimer only, no use restriction (checked 2026-10-22/23). Credit "NIFC WFIGS (IRWIN)". |
| NWCG Unit Identifier codes (brief 3) | PMS 931 (Sep 2022), https://www.nwcg.gov/publications/pms931 | Plain names of protecting-agency codes, `backend/fire3d/data/nwcg_agency_codes.json`. NWCG publications are public domain, use permitted when credited to NWCG (checked 2026-10-23). Credit "Agency names: NWCG unit identifiers". |
| USDOT BTS NTAD Time Zones (brief 3) | `https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Time_Zones/FeatureServer/0` | Time zone at a point (`backend/fire3d/data/us_timezones.geojson`, built offline by `scripts/build_us_regions.py`). "Available for unrestricted public use" (the layer's own text, checked 2026-10-23). Credit "Time zones: USDOT BTS NTAD". |
| Census TIGERweb states, counties, AIANNH (brief 3) | `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/{State_County/MapServer/0,1, AIANNHA/MapServer/2}` | State, county, Navajo Nation and Hopi Reservation (`us_states.geojson`, `us_counties.geojson`, `us_timezones.geojson`). Public domain, "Source: U.S. Census Bureau". Credit "Boundaries: U.S. Census Bureau TIGERweb". |
| Census 2026 Gazetteer Files, national (brief 3) | `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_{place,counties,zcta}_national.zip` | Towns, counties and ZIP areas of every state for `/api/geocode` (`backend/fire3d/data/gazetteer_us.json`). Public domain. Credit "U.S. Census Bureau Gazetteer Files". |
| NWS API alerts, national (brief 3, us-pipeline) | `GET https://api.weather.gov/alerts/active?area=<the 48 states + DC>` | Fire weather and the local officials' messages NWS relays: also `event=` the local officials' NWEM types (Fire Warning FRW, Evacuation Immediate EVI, Shelter In Place Warning SPW, Civil Danger Warning CDW always; Civil Emergency Message CEM and Local Area Emergency LAE only when the text mentions fire, smoke or evacuation); NWS keeps about 7 days, so past dates use the OpenFEMA IPAWS archive. Public domain (weather.gov/disclaimer). Credit "National Weather Service". |
| OpenFEMA IPAWS Archived Alerts v1 (brief 3, us-pipeline) | `https://www.fema.gov/api/open/v1/IpawsArchivedAlerts` | Local officials' messages of past days, labelled archived. OpenFEMA terms (2025-01-22): the notice "This product uses the Federal Emergency Management Agency's OpenFEMA API, but is not endorsed by FEMA" is required; no FEMA or DHS logos. Credit "FEMA IPAWS archive via OpenFEMA". |
| Oregon OEM "Evacuation Areas Public" (brief 3, us-official) | Oregon Department of Emergency Management ArcGIS layer | Evacuation zones in Oregon. Licence field "Public"; no further terms published (checked 2026-10-22). Credit "Oregon Department of Emergency Management". |
| LANDFIRE LF2023 (brief 3, us-pipeline) | the LANDFIRE service above with ED `LF2023` | Pre-fire fuels of federal fiscal year 2024 fires. Public domain. Credit "LANDFIRE" (edition named). |
| NWS flood products, national (brief 5, backend-flood-sources; no key) | `GET https://api.weather.gov/alerts/active?area=<the 48 states + DC>&event=Flood Warning,Flash Flood Warning,Flood Watch,Flash Flood Watch,Flood Advisory,Flood Statement,Flash Flood Statement`; product text per flood on demand: `/products/types/{FLW\|FLS}/locations/{office}`, `/products/{id}` (H-VTEC) | The flood list's NWS input: one request per list build on the shared NWS limiter, cached 2 min (product list 5 min, product text for good). Coastal Flood and Lakeshore Flood products are not read (PLAN-5 D1), so a gauge-only flood at a tide or lake gauge says that such products may be in effect there (`GAUGE_ONLY_COASTAL_CAVEAT`). Public domain (https://www.weather.gov/disclaimer, read 2026-11-04). Credit: "National Weather Service". |
| NWS `riv_gauges` map service (brief 5; no key) | `https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/{0\|15}/query?where=status in ('action','minor','moderate','major')&f=geojson` (layer 0 observed, 15 forecast; nearby gauges by an envelope query on layer 0) | National gauge status in one request each, cached 5 min. Numbers are strings; `obstime` is UTC (checked against NWPS `validTime`); `pedts` is the SHEF code (`HM…` / `HC…` tidal and coastal water levels, used only to tell tide gauges from river gauges). NWS disclaimer. Credit: "NOAA National Water Prediction Service (NWS)". |
| NWS `rfc/rfc_max_forecast` (brief 5; no key) | `https://maps.water.noaa.gov/server/rest/services/rfc/rfc_max_forecast/MapServer/0/query` | Official RFC forecast points at action or above (`producer`, `issuer`, `issued_time`, `max_status`, `max_value`), cached 10 min. It has no last forecast step, so the list reads "still rising at the end" conservatively; the detail routes decide from the NWPS series. NWS disclaimer. Credit: "NWS River Forecast Centers". |
| IEM current flood warnings (brief 5; no key) | `GET https://mesonet.agron.iastate.edu/api/1/nws/current_flood_warnings.geojson` | A copy of NWS's point Flood Warnings, not an official source, used in the live flood list only as a join key (`hvtec_nwsli`, `wfo`, `eventid`) to link river gauges to their warning; never shown. Named in the live list's `sources[]` as `iem_archive` "Iowa Environmental Mesonet (copy of NWS flood warnings, used to link river gauges)" (its outage: some gauges may not be linked). Cached 5 min. Public domain (https://mesonet.agron.iastate.edu/disclaimer.php, read 2026-11-04). Credit: "National Weather Service (IEM copy when used)". |
| NWPS API, per gauge (brief 5; no key) | `https://api.water.noaa.gov/nwps/v1/gauges/{lid}`, `/gauges/{lid}/stageflow`, `/reaches/{reachId}/streamflow` | One gauge per request (timeout 20 s, one retry, outage memory); detail 6 h, series 10 min, reach flow 1 h. Never `gauges?bbox=` for a list (504 after 60 s). NWS disclaimer (water.noaa.gov has no separate terms page). Credit: "NOAA National Water Prediction Service (NWS)"; per gauge its `dataAttribution` ("Observations courtesy of U.S. Geological Survey"). |
| NWS forecast flooded area, RFC FIM (brief 5, backend-flood-bundle-api; no key) | `https://maps.water.noaa.gov/server/rest/services/rfc/rfc_based_5day_max_inundation_extent/MapServer/{0\|3}/query` by envelope, `f=geojson`, `maxAllowableOffset=0.0002`, `geometryPrecision=5`, paged by `resultOffset` (ordered by `oid`) | Layer 0: one polygon per National Water Model reach (`feature_id`, `streamflow_cfs`, `reference_time` UTC without a zone, `update_time`); layer 3 river lines (no geometry) tie reaches to gauges: the reach's own `nws_station_id`, or the forecast point named in `influential_forecasts` ("… at AGYM7 (2529595 [order 5]) 0.0 miles upstream"). The flood's area figure sums only the polygons on member gauges' reaches (null when that join fails), Command only. NOAA calls the service experimental. Cached 15 min. NWS disclaimer (https://www.weather.gov/disclaimer, read 2026-11-04). Credit: "NOAA/NWS National Water Center (experimental)". |
| NWS category flood maps, CatFIM (brief 5; no key) | `https://maps.water.noaa.gov/server/rest/services/fim_libs/static_stage_based_catfim/MapServer/{3\|6\|9\|12\|13}/query?where=ahps_lid='<lid lower case>'` (action, minor, moderate, major, record thresholds) | A static experimental library: what each NWS flood category would cover near a gauge; not a forecast and not an observation. Cached 30 days. NWS disclaimer. Credit: "NOAA/NWS National Water Center (experimental)". |
| National Water Model maps (brief 5; no key; **model output**) | `https://maps.water.noaa.gov/server/rest/services/nwm/{ana_inundation_extent,mrf_gfs_5day_max_inundation_extent,ana_high_flow_magnitude}/MapServer/0/query` by envelope; river lines `reference/static_nwm_flowlines/MapServer/0` | Experimental model output, never official, never merged with NWS layers: analysis flooded area (hourly, cached 1 h), 5-day flooded area (every 6 h, cached 6 h), reaches above their high-water threshold with `recur_cat` verbatim (an annual exceedance probability in percent; ">50" = above the high-water threshold but more likely than 1 in 2). River lines cached 30 days. https://water.noaa.gov/about/api ("not an official forecast product", read 2026-11-04). Credit: "NOAA/NWS National Water Center, National Water Model (experimental model output)"; river lines "River lines: NOAA/NWS National Water Center (NWM)". |
| FEMA National Flood Hazard Layer (brief 5; no key; background only) | `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/{0\|3\|28}/query` by envelope, `f=geojson` | Layer 28 with `SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2%'` only (the 1 % floodplain with floodway, and the 0.2 % band; zone X "AREA OF MINIMAL FLOOD HAZARD" is never requested or kept); layer 0 availability decides `mapped` / `no_digital_map` / `unknown`; layer 3 FIRM panels give the effective dates (`EFF_DATE`). FEMA resets connections often: 4 tries with backoff, an outage memory, cached 30 days; a failure leaves the bundle ready with `NFHL_DOWN`. Insurance map, not current flooding. "As is", the user assumes all risk; no FEMA logo or endorsement (https://www.arcgis.com/home/item.html?id=ae38b6f94eaf4abf97f986fa01921e13 and https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS, read 2026-11-04). Credit: "Flood zones: FEMA National Flood Hazard Layer (effective)". |
| NASA OPERA DSWx-HLS via NASA Earthdata GIS (brief 5; no key, no login: the default satellite water) | `https://gis.earthdata.nasa.gov/portal/rest/services/C2617126679-POCLOUD/OPERA_L3_DSWX-HLS_V1_B01_WTR/ImageServer/{query\|exportImage}` | Catalog `query` (`where=category=1`, `time=<10-day window>`, footprints) cached 6 h; `exportImage` of one locked pass (`mosaicMethod: esriMosaicLockRaster`), raw classes (`renderingRule {"rasterFunction":"None"}`, nearest, `noData=255`), cached 30 days. Classes 0 not water, 1 open water, 2 partial water, 252 snow/ice, 253 cloud, 254 ocean, 255 no data; image times from the granule names (the service's own time metadata is stale). About one day behind NASA's archive; every image is days old. NASA open data, CC0, cite (https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance; https://podaac.jpl.nasa.gov/CitingPODAAC, read 2026-11-04). Credit (exact, PLAN-5 §2): "Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1) via NASA Earthdata GIS; contains modified Copernicus Sentinel data". |
| NASA OPERA DSWx-S1 and DSWx-HLS via CMR and PO.DAAC (brief 5; optional `EARTHDATA_TOKEN`) | `GET https://cmr.earthdata.nasa.gov/search/granules.json?short_name={OPERA_L3_DSWX-S1_V1\|OPERA_L3_DSWX-HLS_V1}&bounding_box=&temporal=` (no login); `GET https://archive.podaac.earthdata.nasa.gov/podaac-ops-cumulus-protected/…_B01_WTR.tif` with `Authorization: Bearer <EARTHDATA_TOKEN>` | Only with the token (the second secret, BRIEF-5 decision 2): radar water (sees through clouds) and the newest optical day. The header goes only to `archive.podaac.earthdata.nasa.gov` (`config.EARTHDATA_AUTH_HOSTS`); the pre-signed S3 redirect is followed without it and its `X-Amz-*` values are masked in logs. 401 / 403 or a redirect to the login page → `login: "refused"`. Files cached under `CACHE_DIR/opera/`. Untested with a real token (mock transport only). Terms as above. Credit: "NASA JPL OPERA DSWx-S1 (PO.DAAC); contains modified Copernicus Sentinel data". |
| NASA GIBS OPERA picture (brief 5; no key; fallback) | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/OPERA_L3_Dynamic_Surface_Water_Extent-HLS/default/{date}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`; dates from `/1.0.0/<layer>/default/<matrix>/all/<start>--<end>.xml` | A daily picture, not a measurement (`measured: false`, no area, no stats), used when Earthdata GIS cannot be read or has no usable image; its date is the newest day whose passes touch the flood's area (Earthdata GIS catalog or CMR, never a pass a probe found with no view of the area), never the layer's newest day worldwide; no such day → no picture. Terms as above. Credit: "Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1) via NASA GIBS; contains modified Copernicus Sentinel data" (the route before the Copernicus clause, which HLS's licence requires). |
| USGS water data, OGC API v1 (brief 5; no key) | `GET https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?monitoring_location_id=USGS-<site>&parameter_code={00065\|00060}&time=<start>/<end>` | Measured gage height (ft) and discharge (ft³/s), every 15 min, provisional unless USGS says "Approved"; paged by the `next` link. No key (a key would be a third secret): an HTTP 429 answers `USGS_429` and USGS is not asked again for 10 min. Past windows cached 30 days, recent 10 min. Legacy WaterServices (shut down Feb 22, 2027) is never used. U.S. Public Domain; provisional-data statement (https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits; https://waterdata.usgs.gov/provisional-data-statement/, read 2026-11-04). Credit: "U.S. Geological Survey (provisional data)". |
| Satellite passes (NASA CMR, no key; added 2026-10-17) | `GET https://cmr.earthdata.nasa.gov/search/granules.json?short_name={SN}&version={V}&point={lon},{lat}&temporal={iso},{iso}&sort_key=-start_date&page_size=200` (header `Client-Id: fire3d`) | Granules of the active-fire products FIRMS is made from. Live (LANCE NRT): `VNP14IMG_NRT` v2 (Suomi NPP), `VJ114IMG_NRT` v2 (NOAA-20), `VJ214IMG_NRT` v2 (NOAA-21), `MOD14` v6.1NRT (Terra), `MYD14` v6.1NRT (Aqua). Archive: `VNP14IMG`/`VJ114IMG`/`VJ214IMG` v002, `MOD14`/`MYD14` v061. Fields used: `time_start`/`time_end` (6-min VIIRS, 5-min MODIS granules; FIRMS `acq_time` falls inside), `day_night_flag`, `updated` (publication, 0.75–3 h after acquisition). A granule containing the fire's point is a pass over it (§8.3). |

## 3. Repo layout

```
Fire-3d/   (repository root; the GitHub repository is now disaster-mapping)
  SPEC.md  PLAN.md  README.md  dev.sh  .gitignore
  .env                                   FIRMS_MAP_KEY (gitignored, chmod 600; never copy the key elsewhere)
  docs/reference/firetrace-demo.png      reference for layout and features
  docs/reference/art-direction.png       reference for the LOOK (realistic + parametric, dark cinematic)
  docs/screenshots/                      verification screenshots
  backend/
    pyproject.toml  uv.lock  .venv/
    fire3d/
      __init__.py
      config.py          paths, env, constants, SSL setup
      types.py           shared dataclasses (Contract §7.1)
      contracts.py       pydantic models mirroring §5/§6 JSON (Contract)
      grid.py            Grid + AOI math (Contract §7.2)
      http.py            cached HTTP client with retries; DownMemo (a failed source is not asked again for 60 s, §14.16)
      bundle.py          bundle paths, manifest load/save/update (atomic + lock), layer write/read
      timeutil.py
      sources/  calfire.py firms.py perimeters.py terrain.py landfire.py imagery.py sentinel.py weather.py aircraft.py
                wfigs.py nws.py openfema.py evacuations.py calfire_history.py overpass.py   (brief 3: national list, NWS, FEMA archive, evacuations)
      catalog.py regions.py
      build/    aoi.py observed.py weather_bundle.py pipeline.py
      spread/   moisture.py behavior.py engine.py ensemble.py validate.py
      api/      app.py jobs.py live.py
      cli.py
    scripts/  make_fixture.py  serve_fixture.py
    tests/
  web/
    package.json vite.config.ts tsconfig*.json index.html
    scripts/shot.mjs                     Playwright screenshot tool
    src/
      main.tsx App.tsx
      api/types.ts (Contract, mirrors §5/§6)  api/client.ts
      state/store.ts (Contract §9.2)
      lib/raster.ts lib/geo.ts lib/time.ts lib/format.ts lib/fuels.ts
      scene/…  ui/…  styles/…
  data/            gitignored; FIRE3D_DATA_DIR overrides
    cache/         shared HTTP and file cache; FIRE3D_CACHE_DIR overrides
    incidents/{id}/  bundles
```

## 4. Conventions (Contract)

### 4.1 Coordinates
- Each incident has an **AOI**: a square in the incident's standard UTM zone (brief 3): EPSG
  `32600 + floor((lon + 180) / 6) + 1` of the centre longitude, zones 10-19 across the lower 48. California is
  unchanged: EPSG:32610 if the centre longitude is < −120°, else EPSG:32611. It is centered at (`center_e`,
  `center_n`) with side `extent_m`.
- Two grids cover exactly that extent:
  - **render grid** 1024 × 1024: elevation and trees.
  - **fire grid** M × M: fuels, canopy, burn scar, every fire raster and the simulation.
    `M = clamp(ceil(extent_m / 30 / 16) * 16, 128, 512)`, so `res = extent_m / M`.
    M is always divisible by 16; the weather grid is 4 × 4.
- Raster arrays are row-major. **Row 0 = NORTH edge, col 0 = WEST edge.** Pixel (r, c) center:
  `e = minx + (c + .5)·res`, `n = maxy − (r + .5)·res`.
- **Local/world coordinates** (all JSON and the frontend use these):
  `x = e − center_e` (east +), `z = −(n − center_n)` (**south +**, Three.js convention), `y` = elevation in metres.
  The frontend multiplies `y` by the vertical exaggeration. One world unit = 1 metre.
- Frontend plane UV: `u = x/extent + 0.5`, `v = 0.5 − z/extent` (v = 1 at the north edge). Every raster covers the
  full extent, so all layers share the same UV regardless of resolution. The frontend raster loader flips rows on
  upload so DataTexture `(u, v)` lines up with plane UV.

### 4.2 Time
- JSON timestamps are integer **epoch milliseconds UTC**, in fields ending `_ms`.
- Raster time values are float32 **hours since `manifest.time_origin_ms`**. **NEVER = 1.0e6** marks a pixel that
  never burns.
- `time_origin_ms = floor_to_hour(started_ms) − 3_600_000`.
- The UI shows each fire's local time with its zone (`summary.time_zone`, never assumed to be Pacific; a point
  without a fire uses `/api/geo/lookup`'s zone; the viewer's zone only as a labelled fallback). Public 12-hour
  ("Aug 14, 5:02 PM PDT"), Command and Forensic 24-hour ("Aug 14, 17:02 PDT") (brief 3, CONTRACT §14.9).

### 4.3 Raster files
`.bin` files are raw little-endian with no header. dtype and shape come from the `LayerInfo` in the manifest.
dtypes: `float32`, `uint8`, `uint16`, `int16`. The API serves them gzip-compressed.

### 4.4 Incident IDs
CAL FIRE rows: `f"{year}-{slug(name)}-{calfire_uid[:6].lower()}"` (year of `Started`), e.g. `2025-eaton-fire-dbfa57`.
NIFC WFIGS rows (brief 3): `f"{UFI year}-{slug(name)}-{IRWIN id[:6].lower()}"` (the `UniqueFireIdentifier` year and
the IRWIN id without braces), e.g. `2025-black-cove-95c3c8`. Every California id keeps resolving; ids nobody lists
(fixtures, local bundles) are served read-only from their manifest and never rebuilt.
Id pinning (CONTRACT 14.2): a CAL FIRE row matched to a WFIGS record that already has a bundle under its WFIGS id
keeps that id; its CAL FIRE id is listed in `aliases` and resolves too (a build by the alias answers 409
"'{alias}' is listed as '{id}'."), and the live loop makes the bundle's summary CAL FIRE's record (§8.7).
WFIGS names in ALL CAPS are title-cased for display, a short run after an apostrophe kept lower case ("DEVIL'S
CANYON" → "Devil's Canyon", "O'NEIL" → "O'Neil"); the slug is the same either way.
`slug`: lowercase, strip, non-alphanumerics → `-`, collapse repeats, trim `-`.
The fixture uses id `fixture-demo`.

**Flood ids (brief 5, CONTRACT §16.1).** `flood-{YYYYMMDD}-{slug(name)}-{h6}` (regex
`^flood-\d{8}-[a-z0-9-]+-[0-9a-f]{6}$`): the UTC date of the flood's `started_ms`, the slug of its name (at most 48
characters), and the first 6 hex characters of the SHA-1 of its anchor: the primary gauge's NWSLI (upper case) for a
river flood, else the oldest VTEC key `{office}.{phenomena}.{significance}.{etn:04d}.{year}`, else the NWSLI of a
gauge-only flood. Example: `flood-20261104-san-juan-river-flood-3fa2c1`. A flood id never parses as a fire id
(`catalog.parse_incident_id` → None), so every fire route answers it as "not a listed fire". Flood bundles live in
`data/floods/{id}/` (`config.FLOODS_DIR`), never in `data/incidents/`. The registry `data/floods/registry.jsonl` keeps
ids stable: VTEC keys are permanent, a gauge key is an episode `{NWSLI}@{first_seen_ms}` (the same gauge flooding again
weeks later is a new flood with a new id); merged floods keep the older id and list the other in `aliases`; the last
summary of an id that left the live list is kept in `data/floods/last_known/{id}.json`. The synthetic flood fixture is
`fixture-flood` (bundle-only; the fixture server alone also lists `fixture-flood-<kind>` demo rows).

### 4.5 Units in the UI (match the reference)
Area in acres (1 ac = 4046.8564224 m²), rate of spread in chains/hour (1 chain = 20.1168 m), wind in mph with a
cardinal direction, temperature in °C, RH %, fuel moisture %, flame length in ft, elevation axis in m.

## 5. Incident bundle (Contract)

```
data/incidents/{id}/
  manifest.json
  layers/elevation.bin          render  float32  m
  layers/fuel.bin               fire    uint8    FBFM40 code (0 = nodata)
  layers/canopy_cover.bin       fire    uint8    percent
  layers/canopy_height.bin      fire    float32  m
  layers/burn_severity.bin      fire    float32  dNBR (optional; nodata −9999)
  layers/observed_arrival.bin   fire    float32  hours since origin, NEVER = 1e6
  layers/naip.jpg               image   JPEG ≤ 4000 px
  layers/sky_view.bin           render  uint8    sky-view factor / ambient occlusion, 0 (enclosed) .. 255 (open sky)
  layers/water.bin              render  uint8    water mask 0..255 (NAIP NDWI ∪ FBFM40 98), soft edges; optional
  layers/trees.bin              points  float32 × 6 per tree: x, y(ground m), z, height_m, crown_radius_m, kind (0 conifer, 1 broadleaf, 2 shrub)
  sim/static.npz                fire    backend only: fuel_model(int16), slope(rise/run), aspect(deg cw from N, downslope-facing),
                                         canopy_cover(0–1), canopy_height(m), canopy_base_height(m), canopy_bulk_density(kg/m³), elevation(m)
  detections.json  perimeters.json  timeseries.json  events.json  weather.json
  forecasts/{run_id}/forecast.json + arrival_p10.bin arrival_p50.bin arrival_p90.bin burn_probability.bin flame_length_p50.bin   (fire grid)
```

### 5.1 TypeScript shapes
The pydantic and TS mirrors must match these.

```ts
type Mode = "live" | "historical";

interface IncidentSummary {
  id: string; name: string; mode: Mode; year: number; calfire_uid: string;
  started_ms: number; updated_ms: number | null; contained_ms: number | null;
  acres: number | null; percent_contained: number | null; is_active: boolean;
  county: string | null; location: string | null; admin_unit: string | null; url: string | null;
  lat: number; lon: number;
  detections_24h: number | null;                       // live only
  bundle_status: "none" | "building" | "ready" | "error";
  bundle_built_ms: number | null;
  // Brief 3 (docs/redesign/CONTRACT.md §14.1). `calfire_uid` is deprecated: the CAL FIRE UniqueId, or "" when the row
  // is not CAL FIRE's record. The five (R) fields are required since the brief-3 integration; the backend always sends
  // them (old manifests and fixtures are filled on read: uid <- calfire_uid, record_source "calfire", record_issuer
  // and agency "CAL FIRE" (a NIFC WFIGS record without an issuer: "<agency code> via NIFC WFIGS", else "NIFC WFIGS
  // (IRWIN)"), source_name <- name, active_sources from is_active, state and time_zone from the location; never
  // America/Los_Angeles by default). The other new fields stay optional.
  uid: string;                                         // (R) CAL FIRE UniqueId, or IRWIN id (upper case, no braces)
  record_source: "calfire" | "wfigs";                  // (R) whose record this row is
  record_issuer: string;                               // (R) "CAL FIRE" | "<agency code> via NIFC WFIGS" | "NIFC WFIGS (IRWIN)"
  state: string | null;                                // (R) USPS code of the point of origin (48 states + "DC"); null off-US
  time_zone: string;                                   // (R) IANA zone of the reported location, never assumed
  agency?: string | null; agency_code?: string | null; // protecting agency: plain name and verbatim code
  irwin_id?: string | null; unique_fire_id?: string | null; source_name?: string; gacc?: string | null;
  accuracy_region?: "NWCC" | "NRCC" | "GBCC" | "SWCC" | "SACC-SP" | "SACC-SE" | "RMCC" | "EACC" | "ONCC" | "OSCC" | null;
  active_sources?: ("calfire" | "wfigs")[];            // which records call the fire active (California may list both)
  other_records?: OtherRecord[];                       // other agencies' records of the same fire (California rows)
  complex_name?: string | null;                        // a member fire outside California ("Part of the X Complex")
  complex_members?: string[];                          // a CAL FIRE complex row: its NIFC WFIGS member names, verbatim
  aliases?: string[];                                  // other ids that resolve to this row (id pinning)
  contained_kind?: "contained" | "controlled" | "out" | null; // which agency time contained_ms is (CONTRACT §14.17):
                                                       // NIFC WFIGS Containment, else Control, else FireOut; CAL FIRE
                                                       // "contained"; null: no time, or an older NIFC WFIGS manifest
}

interface OtherRecord {                                // brief 3: another agency's record of the same fire
  source: "calfire" | "wfigs"; id: string; name: string; issuer: string;
  agency: string | null; agency_code: string | null; acres: number | null; percent_contained: number | null;
  is_active: boolean; updated_ms: number | null; url: string | null;
}

interface LayerInfo {
  file: string;                                        // path relative to the bundle dir
  grid: "render" | "fire" | "image" | "points";
  dtype: "float32" | "uint8" | "uint16" | "int16" | "jpeg";
  width?: number; height?: number; count?: number;     // count for points
  units?: string; nodata?: number; min?: number; max?: number;
  description: string;
}

interface ForecastSummary {
  run_id: string; status: "running" | "ready" | "error";
  issued_ms: number; start_ms: number; horizon_h: number;
  ensemble: "gfs025" | "ecmwf_ifs025" | "perturbed" | "none"; members: number;
  file: string;                                        // "forecasts/{run_id}/forecast.json"
}

interface IncidentManifest {
  schema_version: 1;
  id: string; name: string; mode: Mode; status: "building" | "ready" | "error";
  summary: IncidentSummary;
  time_origin_ms: number;
  time_range: {
    start_ms: number; end_ms: number;
    now_ms: number;              // latest observation of the fire. Live: the newest of its detections, mapped perimeters and
                                 // confirmed satellite passes over it that saw no new fire (§8.3); historical: end_ms
    last_detection_ms?: number;  // live: newest detection or mapped perimeter (the burned area is known up to here)
    last_pass_ms?: number;       // live: newest confirmed VIIRS/MODIS pass over the fire, whatever it saw
  };
  grid: {
    crs: string; utm_zone: number; center_e: number; center_n: number; extent_m: number;
    bbox_lonlat: [number, number, number, number];     // w, s, e, n
    render: { width: number; height: number; res_m: number };
    fire:   { width: number; height: number; res_m: number };
    elev_min_m: number; elev_max_m: number;
  };
  layers: Record<string, LayerInfo>;  // keys: elevation fuel canopy_cover canopy_height burn_severity? observed_arrival naip sky_view water? trees
  ignition: { x: number; z: number; lat: number; lon: number; t_ms: number; source: string } | null;
  default_profile_path: [number, number][];            // local [x, z] polyline (ignition → main run)
  fuels_edition: string;                               // e.g. "LF2024"
  data_sources: { name: string; detail: string; fetched_ms: number }[];
  stats: { final_acres_observed: number; detections: number; perimeters: number };
  forecasts: ForecastSummary[];                        // newest first
  warnings: string[];
  built_ms: number;                                    // also the cache-buster: fetch files with ?v={built_ms}
}

interface DetectionsFile { detections: {
  t_ms: number; lat: number; lon: number; x: number; z: number; frp: number | null;
  satellite: string; instrument: "VIIRS" | "MODIS" | "GOES" | "LANDSAT"; confidence: string; daynight: "D" | "N"; footprint_m: number }[] }
  // GOES rows are thinned to ≤ 1 per 10 min per ~2 km cell (keep max FRP) to keep the file small.

interface PerimetersFile { perimeters: {
  t_ms: number; acres: number; source: string; rings: [number, number][][] }[] }   // local x,z; ≤ 1500 vertices each; cumulative/monotone

interface TimeseriesFile {
  step_h: 1; t_ms: number[];                           // hourly, time_range.start_ms .. now_ms
  area_acres: number[]; growth_acres_per_h: number[]; ros_ch_per_h: number[]; detections_per_h: number[];
  frp_mw_per_h?: number[];                             // hourly mean total FRP (MW) of this fire, GOES-based when available (else VIIRS/MODIS)
}

type EventType = "ignition" | "rapid_growth" | "spot_fire" | "ridge_crossing" | "containment" | "peak_wind" | "wind_shift" | "perimeter_update";
interface EventsFile { events: {
  id: string; type: EventType; t_ms: number; title: string; detail: string;
  x?: number; z?: number; confidence: "observed" | "estimated" | "probable"; source: string }[] }

interface WeatherFile {
  source: string;                                      // e.g. "open-meteo:gfs_hrrr" or "open-meteo:historical-forecast:gfs_hrrr"
  t_ms: number[];                                      // hourly
  at_fire: {
    temp_c: number[]; rh_pct: number[]; dewpoint_c: number[];
    wind_speed_ms: number[]; wind_dir_deg: number[];   // FROM direction
    wind_gust_ms: number[]; precip_mm: number[];
    fm1_pct: number[]; fm10_pct: number[]; fm100_pct: number[];
    ffwi: number[];                                    // Fosberg Fire Weather Index
    flame_length_ft?: number[]; ros_ch_per_h_potential?: number[];  // added by spread/behavior.py
  };
  grid: { nx: 4; ny: 4; x: number[]; z: number[]; u_ms: number[]; v_ms: number[] };  // u,v flattened [t][j][i]; j row north→south; u east+, v north+
  forecast_from_ms: number | null;                     // first hour that is forecast rather than (re)analysis
}

interface ForecastManifest {
  run_id: string; incident_id: string; status: "running" | "ready" | "error"; error?: string;
  issued_ms: number; start_ms: number; horizon_h: number; time_origin_ms: number;
  model: { engine: "pyretechnics"; version: string; surface_lw_ratio_model: string; crown: boolean; spotting: boolean; spread_adjustment: number; grid_res_m: number };
  weather: { source: string; ensemble: "gfs025" | "ecmwf_ifs025" | "perturbed" | "none"; members: number };
  layers: { arrival_p10: LayerInfo; arrival_p50: LayerInfo; arrival_p90: LayerInfo; burn_probability: LayerInfo; flame_length_p50: LayerInfo };
  series: { t_ms: number[]; area_acres_p10: number[]; area_acres_p50: number[]; area_acres_p90: number[]; ros_ch_per_h_p50: number[] };
  skill?: { lead_h: number; sorensen: number; observed_acres: number; forecast_acres_p50: number;
            growth_sorensen?: number | null }[];   // historical runs only; growth_sorensen: brief 3 (CONTRACT §14.12.7)
  runtime_s: number; warnings: string[];
}
```

**Arrival-quantile semantics:** `arrival_pK` is the K-th percentile, across members, of each pixel's arrival time,
counting members that never reach the pixel as +∞ (stored as NEVER).
So `P(burned by t) ≥ K%` ⇔ `arrival_pK ≤ t`. `burn_probability` = fraction of members burned by `start + horizon`.

### 5.3 Flood bundle (brief 5, CONTRACT §16.3; `backend/fire3d/floods/build.py`)

Light: no fuels, detections, weather or simulation. Built by `POST /api/floods/{id}/build` as a background job (kind
"build", 30-90 s; about 17-18 MB for a 60 km area). Flood bundles live beside fire bundles, never in `data/incidents/`.

```
data/floods/{id}/
  manifest.json                FloodManifest (grid = ManifestGrid with fire = render; summary frozen at build;
                               refreshed_ms: when the flood live loop last appended to warnings / gauges, §8.9)
  layers/elevation.bin         render  float32  m (USGS 3DEP)
  layers/sky_view.bin          render  uint8    0-255
  layers/naip.jpg              image   JPEG ≤ 2048 px, optional ("Aerial photo (USGS NAIP), taken before this flood")
  layers/water_forecast.bin    render  uint8    0/255 NWS forecast flooded area, next 5 days (RFC FIM, experimental)
  layers/floodplain.bin        render  uint8    0 none, 1 0.2 % band, 2 SFHA, 3 floodway (FEMA NFHL, background)
  layers/water_satellite.bin   render  uint8    OPERA DSWx WTR classes 0, 1, 2, 252, 253, 254, 255; 255 outside the image
  layers/water_model.bin       render  uint8    0/255 National Water Model analysis flooded area (model output, separate)
  layers/water_pass_<key>.bin  render  uint8    brief 6: DSWx classes of one satellite pass (the 8 newest passes that saw
                                                the area; 255 outside the pass), named in timeline.json (§8.11)
  layers/depth_pass_<key>.bin  render  uint8    brief 6 (review BTD-R3): FwDET depth estimate inside that pass's water
                                                (§5.4), named by the pass's `depth_layer` in timeline.json
  layers/hand.bin              render  uint8    brief 6: height above the nearest river channel (§5.4), 0.1 m steps
  layers/depth_satellite.bin   render  uint8    brief 6: FwDET depth estimate inside the satellite water (§5.4)
  layers/depth_forecast.bin    render  uint8    brief 6: FwDET depth estimate inside the NWS forecast flooded area (§5.4)
  maps/flowlines.geojson                        brief 6: NOAA National Water Model river lines (the HAND input)
  warnings.json                FloodAlertsResponse (the flood's NWS products, verbatim; every version seen, §8.9)
  gauges.json                  RiverGaugesResponse (member gauges with 30-day series and the RFC forecast; nearby gauges)
  satellite.json + satellite.png   SatelliteWaterResponse (absolute times only) and its PNG (clouds and no data hatched)
  maps/rfc_fim.geojson  maps/catfim_<lid>_<category>.geojson  maps/nfhl.geojson  model/nwm_analysis.geojson
  model/nwm_series_<lid>.json  ModelOutputResponse per member forecast point with an NWM reach
  timeline.json                brief 6: FloodTimelineResponse frozen at build (every satellite pass of the flood's window
                               with its view shares over the bundle grid; every version of its NWS products; §8.11)
  passes/<key>.png             fixture-flood only (scripts/flood_3d.py): the 2D images of its simulated passes
```

- **Area:** the flood's NWS polygons and member gauges, padded 3 km, square, 8-60 km; longer floods are cut to 60 km
  around the primary gauge (else the flood's point) and `aoi_note` says so. 1024² UTM render grid (59 m at 60 km).
- **Steps** (weights): catalog 0.05, terrain 0.25, maps 0.15, gauges 0.15, satellite 0.15, timeline 0.15 (brief 6;
  after the satellite step, so its reads never take the satellite step's request slots), terrain3d 0.05 (brief 6,
  §5.4; under 1 s), finish 0.05, the network steps in parallel. Size: 12-18 MB before brief 6; brief 6 adds 3 MB
  (terrain products) and up to 16 MB on disk (8 pass images and their depth estimates, 1 MB each; the depth rasters
  are mostly "no value" and shrink to a few kB with gzip on the wire): St Johns River measured 29.5 MB with 8 passes
  before the per-pass depth, Calcasieu 18.2 MB. **A rebuild never loses its time history or river lines** (review
  BTD-R2): when NASA cannot be reached, the earlier bundle's pass list and pass rasters are kept (same grid; on another
  grid the list without rasters); every earlier NWS product version is kept (merged; a live copy still replaces the
  archived copy of the same version); NOAA's river lines unreachable: the earlier `maps/flowlines.geojson`; each with
  the manifest warning `REBUILD_KEPT`. After a refresh puts an earlier water layer back (§8.9), the 3D terrain
  products are made again from the layers then in the bundle, so a depth estimate always belongs to the water layer
  shown (`terrain3d.after_refresh`). Terrain is required (a failure fails the job and keeps any earlier bundle); every other step that
  fails writes its `layer_status` entry (`unavailable` + a reason: `NFHL_DOWN`, `RFC_FIM_UNAVAILABLE`, `NAIP_DOWN`, ...)
  and a manifest warning, and the bundle is still `ready`.
- **Gate:** the flood resolves (live list, alias, bundle, last-known) and its state is lower 48 or DC; `fixture-flood`
  (synthetic) answers 409, an unknown id 404, lists that cannot decide 503.
- **Swap:** the build writes into `.staging/` (hidden from the files route) and swaps the files in at the end, the
  manifest last; a rebuild never shows a half-written bundle and drops files the new build did not write. One build per
  flood (`.build.lock`; the summary's `bundle_status` reads `building` while it runs).
- **Vector copies are compact:** polygons smaller than one render cell are left out of the bundle's GeoJSON files
  (the rasters are made from the full answers), geometries are simplified to ¾ of a cell and rounded to 4 decimals. The
  2D routes keep serving the full answers.
- **Frozen files carry absolute times only** (no relative age; C16).
- **Credits:** `data_sources` names every source a step wrote a file or layer from, by its credit line (CONTRACT
  §16.15, the same text as the layer's `layer_status.source`): 3DEP, NAIP, the NWS forecast flooded area and
  category maps (NOAA/NWS National Water Center, experimental), FEMA NFHL, the National Water Model (analysis and
  series), the National Weather Service (products; TIGERweb when zones are drawn as counties), NOAA NWPS with each
  gauge's data attribution and each RFC forecast's issuer, and NASA OPERA with its route and Copernicus clause.

### 5.4 3D terrain products of the flood bundle (brief 6, decision 3; `backend/fire3d/floods/terrain3d.py`)

The Forensic flood view on flat ground showed little: the terrain looked flat and the affected areas were hard to see.
`manifest.terrain3d` (`FloodTerrain3d`, absent in brief-5 bundles) holds three products made at build (numpy / scipy
only, under 1 s); `scripts/flood_3d.py <id>...` adds them (and the §8.11 time history) to an existing bundle without a
rebuild (`fixture-flood`: its synthetic valley's centre line stands in for the river lines). Every raster is uint8 on
the render grid: metres = value × `scale_m` (0.1), `top_code` 254 = 25.4 m or more, `nodata` 255 = no value; `LayerInfo`
`units: "0.1 m"`, `nodata: 255`. Each product (`FloodTerrainProduct`) carries `label`, `caveat`, `method`, `citation`,
`source`, the source layer's own `time_ms`, `stats` (`cells`, `area_km2`, `p50_m`, `p90_m`, `max_m`), and when it is
missing `status` (`unavailable` | `not_covered`) with `reason`. Strings: `fire3d/floods/copy_time.py`.

- **Relief and the height boost** (`relief`): the 5th-95th percentile of the ground within 2 km of the mapped water
  (satellite open and partial water, and the NWS forecast flooded area; the whole grid when there is none, or when the
  ground within 2 km of it covers under 1 % of the grid). `exaggeration` = the smallest of ×1.5, ×2, ×3, ×5, ×8, ×10
  that makes that range span at least 2 % of the area's width (×10 when none does; ×1.5 when the ground is already
  steep enough). `rule` writes the rule down (`RELIEF_RULE`, which says that ×10 is the most, so a very flat
  floodplain can still look flat at the default). `target_reached` (review BTD-R4, additive) is false when even ×10
  leaves the range under 2 % of the width: true of every flat flood measured, so the web may suggest a larger boost or
  the closer framing. The web shows the factor ("Height ×5") and lets the user change it. Measured 2026-11-05:
  St Johns River 9.0 m over 60 km → ×10; Calcasieu River 6.7 m → ×10; Grand River 27 m → ×10; Moenkopi Wash 534 m →
  ×3; `fixture-flood` → ×3.
- **Height above the river** (`hand`, HAND simplified; label `HAND_LABEL` "Height above the river (from terrain). Not a
  flood map", off by default in the web): NOAA National Water Model river lines (`reference/static_nwm_flowlines`
  layer 0, every stream order, one request cached 30 days, kept as `maps/flowlines.geojson`) of stream order 3 and up
  (or the largest order present when none is that large) are drawn on the grid (all touched cells). Each channel cell
  takes the lowest terrain height within one cell of it (the lines are not always on the channel bottom); every other
  cell takes the height of its nearest channel cell in a straight line (`scipy.ndimage.distance_transform_edt`) and
  keeps its height above it (below counts as 0); cells more than 10 km from a channel have no value. **Limits**
  (`HAND_METHOD`): HAND proper (Nobre et al., 2011) follows the downhill flow path to the channel the cell drains to;
  the straight-line version can measure a cell near a ridge against the next valley; levees, culverts and storm
  drains are unknown; it is not a flood map and an empty tint is never an all-clear. River lines unreachable:
  `unavailable` + `HAND_NO_LINES`; none in the area: `not_covered` + `HAND_NO_CHANNEL`. Checked on the fixture valley
  (true height above its channel known): a constant offset of about 2 m (the channel bed lies below the water surface
  in that terrain; real 3DEP lidar shows the water surface) and 90 % of floodplain cells within 1 m of it.
- **Depth estimate** (`depth_satellite`, `depth_forecast`; FwDET, Cohen et al. 2018, doi:10.1111/1752-1688.12609, and
  FwDET v2.0, Cohen et al. 2019, doi:10.5194/nhess-19-2053-2019; label `DEPTH_LABEL` "Estimated depth (from the terrain
  at the water's edge), experimental") for each mapped water layer: the satellite pass the bundle shows
  (`water_satellite`: open and partial water; open ground = class 0) and the NWS forecast flooded area
  (`water_forecast`: 255; open ground = 0). The water's **edge** = water cells with a 4-neighbour of open ground;
  edges against clouds, no data, ocean, snow or the grid border are not used (FwDET v2.0's boundary rule). Each water
  cell takes the terrain height of its nearest edge cell as the water surface; depth = surface − terrain, below 0
  counts as 0, then a 3 × 3 average over the water cells; cells outside the mapped water have no value (it is never
  shown there). Known bias: the edge cells lie just inside the water, so depth reads low by up to one cell's rise of
  the bank (tested on a bathtub of known depth); steep banks and maps that do not line up with the terrain give errors
  of a metre or more; depth in the river's normal channel is not measured (lidar shows its water surface). Missing:
  `unavailable` + the layer's own reason or `DEPTH_NO_LAYER`; no water mapped: `not_covered` + `DEPTH_NO_WATER`; no
  edge on open ground: `not_covered` + `DEPTH_NO_EDGE`. Measured 2026-11-05: St Johns satellite water 479 km², median
  0.03 m, 90th percentile 0.46 m, max 6.0 m; Calcasieu forecast area 39 km², median 0.24 m, max 2.4 m.

## 6. HTTP API (Contract)

FastAPI on port **8710** (`fire3d.api.app:app`). Vite proxies `/api` there by default (`VITE_API_TARGET` overrides).
**Port 8000 is NOT ours:** an unrelated local app (the user's MeetingPipelines uvicorn) permanently listens on
127.0.0.1:8000, and 8765 is also busy. Never stop those processes. Disaster Mapping's default API port is **8710**
everywhere: `vite.config.ts` default proxy target `http://localhost:8710`, `dev.sh`, the CLI `serve` default,
and README.

| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `{ok: true, version}` |
| GET | `/api/incidents?mode=live\|historical&min_acres=300&year=<current UTC year>&state=` | `{mode, updated_ms, incidents: IncidentListRow[], year?, sources}`. **Brief 3 (CONTRACT §14.1, §14.2):** the lower 48 states + DC from NIFC WFIGS, with CAL FIRE as the record in California (WFIGS adds only the California fires CAL FIRE does not list; a California fire is active when either agency says so; a CAL FIRE complex is one row). Live: every active wildfire in the lower 48, whatever its size, sorted by `detections_24h` then acres. Historical: the wildfires of `year` (default: the current UTC year) of `min_acres` (default 300) or more, by acres. Prescribed burns, complex parents outside California, Alaska, Hawaii and territories are never listed. `state` (USPS code) filters rows. `sources[]` (`ListSource`: `id` "calfire" \| "wfigs", `name`, `status` "available" \| "unavailable", `retrieved_ms`, `reason`, `stale`) says which lists answered and when Disaster Mapping fetched them; with WFIGS down only California (CAL FIRE) is listed, with CAL FIRE down California's WFIGS rows still list; `stale: true` when a list could not be refreshed and an older copy is shown (CONTRACT §14.16). Both lists down: 200 with the bundles on disk of listed fires only (never synthetic bundles or failed builds), both sources `unavailable` with one reason. A failed list is remembered for 60 s, so every answer stays within seconds during an outage (§14.16). gzip when the request accepts it (`Vary: Accept-Encoding`). Brief 2 text, still true for California: `{mode, updated_ms, incidents: IncidentListRow[], year?}`. Historical: CAL FIRE's list of `year` (default 2025; e.g. `year=2026` for the current season, refreshed every 30 min and overlaid with the fresher live-list records), default `min_acres=300`, sorted by acres desc; every row keeps mode `"historical"` (`is_active` says whether CAL FIRE still lists the fire as active; `/api/incidents/{id}` resolves such a fire as live); the response says which `year` it lists. Live: all active `Type ∈ {Wildfire, Fire}` incidents, sorted by `detections_24h` then acres (`year` is ignored). Rows (BRIEF-2) are `IncidentSummary` + `bbox_lonlat: [w, s, e, n] \| null`: the analysis area (`manifest.grid.bbox_lonlat`) of a ready bundle, else null. |
| GET | `/api/incidents/{id}` | `{summary: IncidentSummary, manifest: IncidentManifest \| null, job: JobStatus \| null}` |
| POST | `/api/incidents/{id}/build?force=false` | `JobStatus`. Builds or rebuilds the bundle in the background; returns the existing job if one is running. Brief 3 (CONTRACT §14.2): an id is buildable only when a CAL FIRE or NIFC WFIGS list knows it (never a manifest alone) and its state is in the lower 48 + DC: unknown id 404 "unknown incident"; Alaska, Hawaii or a territory 422 "Disaster Mapping does not support Alaska, Hawaii or US territories yet."; a local or synthetic bundle (`fixture-demo`, `fixture-east`) 409 "'{id}' is a local or synthetic bundle; it cannot be rebuilt." (a non-forced build of a ready one returns it untouched); the source lists unreachable (no list that answered knows the id) 503 "The fire lists could not be reached right now; try again later." (also `GET /api/incidents/{id}` of a listed fire without a bundle, the incident record and `/api/extras/*` by incident), never "a local or synthetic bundle". |
| POST | `/api/incidents/{id}/forecast` body `{start_ms?: number, horizon_h?: number = 72, ensemble?: "auto" \| "gfs025" \| "ecmwf_ifs025" \| "perturbed" \| "none", members?: number}` | `JobStatus`. Default `start_ms`: live = `time_range.now_ms`, the latest observation of the fire: a confirmed satellite pass after the last detection counts (§8.3), so a fire that went quiet starts at the latest pass with its last mapped area, not at its last detection; historical = 24 h after ignition. `"auto"`: live → gfs025, historical → perturbed. |
| GET | `/api/jobs/{job_id}` | `JobStatus` |
| GET | `/api/bundles/{id}/{path:path}` | Static bundle files, gzip, `Cache-Control: no-cache` + ETag. Path traversal must be impossible. |
| GET | `/api/incidents/{id}/aircraft?all=0` | `{updated_ms, source: "adsb.lol" \| "adsb.fi", radius_nm, aircraft: Aircraft[], note?}`. `source` names the provider that answered (adsb.fi is the fallback while adsb.lol is unreachable). Live incidents only (historical → empty list plus a note). Every provider failing or rate-limited → empty list plus a note (never an error status). Cached 10 s. |
| GET | `/api/live/status` | `{last_refresh_ms, next_refresh_ms, active_incidents, detections_24h_ca, auto_build, detections_24h}`. Brief 3: `detections_24h` = keyless FIRMS feed rows of the last 24 h inside the lower-48 state polygons; `detections_24h_ca` (California) stays for one release; `active_incidents` = the live list length, `null` when the lists could not be read (never 0; CONTRACT §14.16). |
| GET | `/api/geo/lookup?lon=&lat=` | Brief 3 (CONTRACT §14.3). `GeoLookup` `{lon, lat, coverage: "lower48" \| "alaska" \| "hawaii" \| "territory" \| "outside_us", supported, state, state_name, county: {fips, name} \| null, time_zone, time_zone_name, note}`: offline (Census TIGERweb states and counties, USDOT BTS NTAD time zones with the Navajo Nation and Hopi Reservation). `note` is the coverage sentence when not supported. 400 on bad numbers; `Cache-Control: public, max-age=86400`. |
| GET | `/api/accuracy-regions` | Brief 3 (CONTRACT §14.4). `AccuracyRegionsResponse`: `backend/fire3d/data/regional_accuracy.json` (schema 1) plus `served_ms`; all ten regions (NWCC, NRCC, GBCC, SWCC, SACC-SP, SACC-SE, RMCC, EACC, ONCC, OSCC), a region missing from the file served as `untested`. Status: `tested` with >= 2 fires and >= 16 scored leads, else `limited` with >= 1 fire, else `untested`. Each region's `fires[]` (`AccuracyFire`) carries the fire's own `growth_ratio_median` (optional; brief 3 integration); the region's is null when its fires erred in opposite directions. `Cache-Control: no-cache`. |
| GET | `/api/geocode?q=<US street address \| US town \| ZIP code \| county>` | Brief 3 (CONTRACT §14.10): local matches come from `backend/fire3d/data/gazetteer_us.json` (2026 Census Gazetteer Files, every state; replaces `gazetteer_ca.json`); each gains `state`, `state_name`, `county`, `supported` (false in Alaska, Hawaii, territories), `name`/`matched_address` "<Name>, <ST>", `place_type` (Census LSAD in plain words) and `place_type_label`; "Springfield, IL", "Springfield IL", "83702 ID" parse; no match: "No US city, town, county or ZIP code matches '<q>'." Brief 2 text: Map-first redesign (shapes in docs/redesign/CONTRACT.md §6 and §13 location). A street address (house number first) is proxied to the US Census Geocoder (`Public_AR_Current`, cached 30 days); a California town or a 5-digit ZIP code is matched locally in `backend/fire3d/data/gazetteer_ca.json` (2026 Census Gazetteer Files, no upstream call; replies say `kind` and `local: true`). Coordinates are parsed by the browser (400 here). 503 when the local index is missing. |
| GET | `/api/extras/{evacuations,cameras,cameras/latest,imagery,sources}` | Optional official and public sources (CONTRACT §12.1): Cal OES evacuation zones, public cameras, recent satellite imagery; `?incident=<id>` or `?bbox=w,s,e,n`. Upstream failures answer 200 with an honest status, never invented data. Brief 3 (CONTRACT §14.8): evacuations come from a state registry (Cal OES in California, Oregon OEM in Oregon); every other state answers `unavailable` + `reason_code: "state_not_available"` without an upstream request ("Official evacuation zones are not available in this state ({State}). Follow local officials."); the answer adds `states[]` and per-source fields. Cameras outside California answer `state_not_available`. |
| GET | `/api/official/calfire?incident={id}` | BRIEF-2. `CalFireOfficial`: CAL FIRE's current record of the incident (its own numbers and `Updated` time), every change of acres, containment, active or final status Disaster Mapping has recorded since it first checked (append-only `data/official/calfire/<UniqueId>.jsonl`, outside the bundles), and caveats. Each call is a check and records the current record. Past fires have only CAL FIRE's final record. Brief 3 (§14.5): a fire whose `record_source` is "wfigs" answers `unavailable` + `not_covered` ("CAL FIRE does not list this fire; its official record is published by NIFC WFIGS."); any listed id resolves (no 404 for a listed fire without a bundle). |
| GET | `/api/official/fire-weather?incident={id}&at_ms=&margin_km=15` | BRIEF-2. `FireWeather`: NWS Red Flag Warnings and Fire Weather Watches whose zones meet the incident's analysis area + `margin_km`, verbatim, with `covers_reported_location` and `nearest_km`. The present (no `at_ms`, or within 6 h of now, or later): the live NWS list (one statewide request, cached 2 min; zone polygons cached 30 days). An older `at_ms`, or any `at_ms` of a historical incident: the Iowa Environmental Mesonet archive (`archived: true`); a historical incident without `at_ms`, or an archive failure, is `not_available_for_past_dates`, never "no alerts". Without `incident`: every current California alert.  Brief 3 (§14.6): one cached national request (`area=` the 48 states + DC); per fire, alerts are kept only when a UGC's state is in the fire's states before any zone loads. Adds `states_checked` (the states this answer covers; `[]` when none could be checked), `alert_states`, and each alert's `time_zone` (all required since the integration; the web still reads a cached answer without `states_checked` as ["CA"]). |
| GET | `/api/official/incident-record?incident={id}` | Brief 3 (CONTRACT §14.5). `IncidentRecord`: the fire's NIFC WFIGS (IRWIN) record (WFIGS rows and California rows matched to one WFIGS record) with the protecting agency, its own times and a link. A California row without a match, one matched to several records none of which has its name (the reason names them; several records that all carry its name, such as the Lucas Fire's two LUCAS records, are one record: the largest, then the newest), a CAL FIRE complex row and a synthetic or local bundle answer `unavailable` + `not_covered` with their reasons; an unknown id is 404; WFIGS down is `upstream_error`; the source lists unreachable for the id 503. |
| GET | `/api/official/local-alerts?incident={id}&at_ms=&margin_km=15` or `?bbox=w,s,e,n` | Brief 3 (CONTRACT §14.7). `LocalAlerts`: local officials' messages relayed by the NWS (live and the last 7 days) and FEMA's IPAWS archive via OpenFEMA (older days, labelled archived), verbatim, each with a `source_url`. `incident` xor `bbox` (else 400); unknown incident 404. An area that touches no lower-48 state (Alaska, Hawaii, territories, outside the US) answers `unavailable` / `state_not_available` with both channels `not_checked` ("Disaster Mapping checks local officials' alerts in the lower 48 states only." plus the §14.14 sentence), with no NWS request. Every `at_ms` query parameter (here, fire weather and `/api/extras/*`) is limited to 2100-01-01 (larger: 422; CONTRACT §14.16). |

```ts
interface JobStatus {
  id: string; kind: "build" | "forecast" | "refresh"; incident_id: string;
  status: "queued" | "running" | "done" | "error"; progress: number /* 0..1 */; step: string; message: string;
  created_ms: number; started_ms: number | null; finished_ms: number | null; error: string | null; result: any | null;
}
interface Aircraft {
  hex: string; callsign: string | null; registration: string | null; type: string | null;
  category: "airtanker" | "helicopter" | "air_attack" | "lead_plane" | "other_fire" | "unknown";
  is_fire_aircraft: boolean; reason: string;
  lat: number; lon: number; x: number; z: number;
  alt_m: number | null; agl_m: number | null; gs_kt: number | null; track_deg: number | null;
  seen_s: number; on_ground: boolean;
}
```

**Flood routes (brief 5; shapes in `docs/redesign/CONTRACT.md` §16.2-16.7, `backend/fire3d/contracts.py` and
`web/src/api/floodTypes.ts`, re-exported by `web/src/api/types.ts`).** All in `backend/fire3d/api/floods.py` (one
`include_router` line in `api/app.py`) except the `hazard` parameter of local alerts and evacuations. Every route answers
`fixture-flood` from its bundle's frozen files (`synthetic: true`). Official answers use their own `FloodEnvelope`
(`kind` "flood_alerts" \| "river_gauges" \| "flood_map", `flood_id`, `synthetic`); model output
(`ModelOutputResponse`, `model_output: true`) is never an official envelope; no fire union is widened.

| Method | Path | Response |
|---|---|---|
| GET | `/api/floods?mode=live\|historical&year=` | `FloodListResponse` `{hazard: "flood", mode, updated_ms, year?, past_rule?, preparing?, floods: FloodSummary[], sources: FloodListSource[], products_in_effect}`. Live: NWS flood products in effect or upcoming in the lower 48 + DC (Flood Warning, Flash Flood Warning, Flood Watch, Flash Flood Watch, Flood Advisory and their statements; coastal and lakeshore products are out) and river gauges observed at minor flooding or worse, grouped per river or area (§8.8), ordered by `floodRank` (CONTRACT §16.8); watches are included (the web hides them by default). Historical (`year` 2026 or 2025, default this year; §8.10): `past_rule` `"moderate_or_worse"`, `preparing: true` while the one-time year build runs, then the year's floods (mode `historical`; a row whose id or any VTEC key the live list holds is served as that live row, once; floods still in effect when the year was built are left to the live list; row ids follow registry aliases written after the build); other years an empty list whose `iem_archive` source says which years are kept. `sources[]` (`nws_alerts`, `nwps_gauges`, `rfc_forecasts`; `iem_archive` for past years, and in the live list the IEM copy of NWS warnings that links gauges to them): NWS down → floods from gauges only (`FLOOD_NWS_DOWN`; their caveat says NWS could not be reached); gauges down → from NWS products only (`FLOOD_GAUGES_DOWN`); both down → the flood bundles on disk only (`FLOOD_LISTS_DOWN`), still a 200 whose sources say why (not CONTRACT §16.7's 503; contract5 note); never "no floods" for an outage. `products_in_effect` is null when NWS could not be read. Cached 5 min (60 s while degraded); a cold build makes at most 6 upstream requests. |
| GET | `/api/floods/status` | `FloodLiveStatus` `{last_refresh_ms, next_refresh_ms, active_floods, gauges_in_flood, auto_build}` from the flood live loop (§8.9) once it has run a cycle, else from the cached list; counts null when the lists could not be read (never 0); `auto_build` only while the loop runs with auto-build on. |
| GET | `/api/floods/{id}` | `FloodDetailResponse` `{summary, manifest: FloodManifest \| null, job: JobStatus \| null, resolved_from}`. Resolution (PLAN-5 §3.2 rule 13): the live list → the year lists → a registry alias (the canonical summary, live or a year row; the web replaces the URL) → the bundle's frozen summary → the registry's last-known summary → 404. 503 "The flood lists could not be reached right now; try again later." when the lists could not decide and nothing is on disk, never 404. `fixture-flood-<kind>` ids are 404 here (fixture server only). |
| POST | `/api/floods/{id}/build?force=0\|1` | `JobStatus` (kind "build", `incident_id` = the flood id). 409 for `fixture-flood`, a flood outside the lower 48, or a past (year-list) flood (`PAST_NO_BUNDLE`: "Disaster Mapping prepares 3D data for current floods only: NWS's forecast maps, the model and river forecasts are not kept for a past flood's dates."). |
| GET | `/api/floods/{id}/files/{path}` | Flood bundle files (gzip except JPEG / PNG, weak ETag + 304, `Cache-Control: no-cache`, traversal-safe; dotfiles such as the lock and `.staging/`, and the fixture's canned `api/` answers, are 404); `.geojson` as `application/geo+json`. |
| GET | `/api/floods/{id}/maps?kind=rfc_fim\|catfim\|nfhl&lid=&category=&at_ms=` | `FloodMapResponse`: the NWS forecast flooded area (next 5 days, experimental), NWS category flood maps (experimental), FEMA's 1 % floodplain (background, with `availability` and effective dates); past times `not_available_for_past_dates` (CatFIM answers today's library with a caveat). A past (year-list) flood asked without `at_ms` is answered at its last NWS product's time (FEMA: today's map either way). |
| GET | `/api/floods/{id}/model?kind=nwm_analysis\|nwm_5day\|nwm_high_flow\|nwm_series&lid=&at_ms=` | `ModelOutputResponse` (National Water Model, experimental model output; `MODEL_CAVEAT` always); past times `not_available_for_past_dates`; a past (year-list) flood asked without `at_ms` is answered at its last NWS product's time, so never today's model output. |
| GET | `/api/floods/{id}/timeline?wait=0..30` | Brief 6 (§8.11). `FloodTimelineResponse` `{kind: "flood_timeline", flood_id, now_ms, start_ms, end_ms, passes: FloodPassHistory, products: FloodProductHistory, synthetic}`. `passes`: every satellite pass over the flood's window (oldest first; `view` clear \| partly_hidden \| no_view \| unknown, `usable`, view shares and water areas over the 2D map area, `image` `{url, bounds_lonlat}` for usable passes, `caveat` = that pass's `SAT_CAVEAT` or `PASS_NO_VIEW`, `shown_key` = the pass the satellite layer shows); passes still being read after `wait` seconds (default 20) come back `view: "unknown"` with `complete: false` (ask again). `products`: a `FloodEnvelope` (`kind: "flood_alerts"`) with every version of every NWS product of the flood (`FloodTimelineProduct` = `FloodAlert` + `vtec_key`, `replaced_ms`, `shown_from_ms`, `shown_until_ms`; oldest first), zone outlines in `zones`, `archive_source` (IEM) when archived copies are included, `complete`. Observation and official blocks are separate, never merged. Additive (brief 6 review): `passes.sources` (one credit per product and route), `FloodPass.depth_layer` (bundle), and the window starts at the earlier of the live start and the ready bundle's (BTD-R10). `fixture-flood` answers from its bundle (`synthetic: true`): four simulated passes (clear, no view, a five-day gap, partly hidden, its own image) once `scripts/flood_3d.py fixture-flood` ran after `make_fixture.py --only flood`, else its one pass. |
| GET | `/api/floods/{id}/passes/{key}.png?area=<8 hex>` | Brief 6. The PNG of one pass of the timeline (water `#2a8ce6`, partial water lighter, clouds and no data the hatched grey "no view", outside the pass transparent; lon/lat bounds in the JSON). 404 `SATELLITE_IMAGE_GONE` when it is no longer kept, the map area changed, or the pass had no view (no image is made for a no-view pass; BTD-R13); `key` `[A-Za-z0-9_-]`, `area` 8 hex digits (else 404 / 422). `fixture-flood`: the frozen images in its bundle's `passes/<key>.png`. |
| GET | `/api/floods/{id}/satellite?at_ms=` and `/api/floods/{id}/satellite.png?granule=` | `SatelliteWaterResponse` (water seen by satellite, NASA OPERA DSWx; `login` "not_configured" \| "configured" \| "refused", never the token) and its PNG (cloud and no-data pixels drawn as "no view", never transparent). A past (year-list) flood asked without `at_ms` is answered at its last NWS product's time. |
| GET | `/api/official/flood-alerts?flood=<id>\|bbox=w,s,e,n&at_ms=` | `FloodAlertsResponse`: NWS flood products verbatim with issuer, own times, IANA zone and link, from the one national request the list uses (2 min); a flood: its own events (VTEC key, else CAP id) and attached watches; an area or point (w = e, s = n): every product touching it, watches included, with `covers_point`; zone-based products drawn from at most 20 NWS zone outlines, then whole counties (`ZONES_AS_COUNTIES`); `ALERTS_UNAVAILABLE` when NWS cannot be read (never `NO_PRODUCT`); a flood at a past time (`at_ms` older than 6 h): its archived products from the IEM archive (§8.10: every version sent by then, the event's own segment verbatim, `archived: true`, source IEM; `not_available_for_past_dates` before the flood's first product; `unavailable` when IEM cannot be read); an area at a past time `not_available_for_past_dates` (products are served per flood); 422 without `flood` or `bbox`. |
| GET | `/api/official/river-gauges?flood=<id>\|bbox=\|lid=\|scope=national&min=action&series=0\|1&at_ms=` | `RiverGaugesResponse`: gauges, NWS flood categories and thresholds, USGS-measured readings (provisional), the official RFC forecast with its issue time; `bbox` and nearby gauges from the NWS `riv_gauges` map service (layer 0, and layer 15 for which are forecast points), NWPS per `lid` only; a nearby gauge's forecast is `rfc_max_forecast`'s when it is listed there, else null (`is_forecast_point` still says it has one; `?lid=` has it exactly); members fall back to the map's reading with `GAUGE_DETAIL_DOWN` when NWPS cannot be read; `bbox` of a point looks 10 km around it; 404 for a `lid` NOAA does not know; the fixture's fictional `ZZ…` gauges answer from its bundle; an `at_ms` older than 6 h (§8.10): a flood's member gauges or one `lid` with USGS's measured stage and flow around that time (provisional), NWS's flood stages of today (`THRESHOLDS_TODAY`), no forecast (`PAST_NO_FORECAST`), the reading's category `unknown`; an area `not_available_for_past_dates`; never today's readings for a past time; 422 without a scope. |
| GET | `/api/official/local-alerts?...&hazard=fire\|flood`, `/api/extras/evacuations?...&hazard=fire\|flood` | The existing answers; `hazard` defaults to `fire` (byte-for-byte as before). `flood`: local messages about flood, water, levees or dams; Oregon's wildfire-only evacuation feed answers not-available (`OR_EVAC_FIRE_ONLY`); Cal OES `event_type` verbatim. |

Official endpoints (BRIEF-2; built in `backend/fire3d/api/official.py`, details in `docs/redesign/CONTRACT.md` §13). An upstream failure is not an HTTP error: they answer 200 with `status: "unavailable"` (or `"not_available_for_past_dates"` for the archive). Errors: 400 bad id, 404 unknown incident, 422 bad query, 429 Disaster Mapping's own request limit (NWS 30/min, IEM 30/min). JSON is `Cache-Control: no-store`.

```ts
interface IncidentListRow extends IncidentSummary { bbox_lonlat: [number, number, number, number] | null }
interface OfficialEnvelope {
  kind: "calfire" | "fire_weather" | "incident_record" | "local_alerts";      // brief 3 widened
  status: "available" | "unavailable" | "not_available_for_past_dates";
  reason_code: "past_date" | "upstream_error" | "not_covered" | "state_not_available" | null; reason: string | null;
  source: { name: string; url: string; credit: string; license?: string; terms_url?: string };
  retrieved_ms: number | null;        // when Disaster Mapping fetched it from the source
  source_updated_ms: number | null;   // the source's own update time
  requested_at_ms: number | null; now_ms: number; incident_id: string | null; caveats: string[];
}
interface CalFireOfficial extends OfficialEnvelope {
  incident_url: string | null; agencies: string | null;   // CAL FIRE's AgencyNames, verbatim
  current: { acres: number | null; percent_contained: number | null; is_active: boolean; final: boolean;
             updated_ms: number | null; extinguished_ms: number | null } | null;
  changes: { updated_ms: number | null; seen_ms: number; acres?: [number | null, number | null];
             percent_contained?: [number | null, number | null]; is_active?: [boolean, boolean]; final?: [boolean, boolean] }[];
  recording_since_ms: number | null;
}
interface FireWeatherAlert {
  id: string; url: string | null; office_url: string | null; event: "Red Flag Warning" | "Fire Weather Watch";
  vtec: { office: string; phenomena: string; significance: string; etn: number; action: string } | null;
  sender_name: string | null; sent_ms: number | null; effective_ms: number | null; onset_ms: number | null;
  expires_ms: number | null; ends_ms: number | null;
  headline: string | null; nws_headline: string | null; description: string | null; instruction: string | null;
  area_desc: string | null; ugcs: string[]; message_type: string | null; status: string;
  covers_reported_location: boolean | null; nearest_km: number | null; archived: boolean;
  phase: "upcoming" | "in_effect" | "ended";
  time_zone: string | null;           // brief 3 (required since the integration): IANA zone of the alert's first zone, else its state's main zone
}
interface FireWeather extends OfficialEnvelope {
  alerts: FireWeatherAlert[];
  zones: GeoJSON.FeatureCollection;   // simplified outlines; properties { ugc, name, alert_ids }
  area_bbox: [number, number, number, number] | null; reported_location: [number, number] | null;   // lon, lat
  states_checked: string[];           // brief 3 (required since the integration): the states this answer covers; [] = none checked
  alert_states: string[];             // brief 3 (required since the integration): the states with at least one alert in this answer
}
// Brief 3 (CONTRACT §14.5, §14.7)
interface IncidentRecord extends OfficialEnvelope {          // kind "incident_record"
  record_source: "wfigs"; irwin_id: string | null; unique_fire_id: string | null; publisher: "NIFC WFIGS (IRWIN)";
  agency_code: string | null; agency: string | null; protecting_unit: string | null; state: string | null;
  county: string | null; time_zone: string; incident_url: string | null; dataset_url: string;
  current: { name: string; acres: number | null; percent_contained: number | null; is_active: boolean;
             discovered_ms: number | null; contained_ms: number | null; controlled_ms: number | null; out_ms: number | null;
             updated_ms: number | null; ics209_report_ms: number | null } | null;
  complex: { name: string; id: string | null } | null;
  changes: [];                        // history outside California is deferred
  recording_since_ms: null;
}
interface LocalAlerts extends OfficialEnvelope {             // kind "local_alerts"
  alerts: LocalAlert[];               // fields in CONTRACT §14.7 (id = CAP identifier, channel "nws_api" | "openfema_archive",
                                      // archived, event, event_code, message_type, references, sender_name, sender_is_platform,
                                      // sent/effective/onset/expires_ms, headline, description, instruction, wea_text,
                                      // wea_long_text, web, source_url (always, https), area_desc, same_codes, ugcs, polygon
                                      // (GeoJSON Polygon, or MultiPolygon when an archived message had several areas),
                                      // match, covers_reported_location and nearest_km (null for a county match), time_zone, phase)
  channels: { id: "nws_api" | "openfema_archive"; status: "available" | "unavailable" | "pending" | "not_checked";
              retrieved_ms: number | null; source_updated_ms: number | null; reason: string | null }[];
  area_bbox: [number, number, number, number] | null; reported_location: [number, number] | null;
  counties: { fips: string; name: string; state: string }[];
}
```

## 7. Backend modules (Contract)

### 7.1 `fire3d/types.py` (shared dataclasses, written by scaffold)
```python
@dataclass
class BuildContext:
    summary: IncidentSummary            # pydantic model from contracts.py
    bundle_dir: Path
    render_grid: Grid
    fire_grid: Grid
    time_origin_ms: int
    mode: Literal["live", "historical"]
    progress: Callable[[str, float, str], None]  # (step, fraction 0..1 within step, message)
    fire_bbox_lonlat: tuple[float, float, float, float] | None = None
    end_ms: int | None = None           # time_range.end_ms once known
    now_ms: int | None = None

@dataclass
class StaticInputs:                     # fire grid; loaded from sim/static.npz
    fuel_model: np.ndarray              # int16 FBFM40 codes
    slope: np.ndarray                   # float32 rise/run
    aspect: np.ndarray                  # float32 deg clockwise from N, the direction the slope FACES (downslope)
    canopy_cover: np.ndarray            # float32 0–1
    canopy_height: np.ndarray           # float32 m
    canopy_base_height: np.ndarray      # float32 m
    canopy_bulk_density: np.ndarray     # float32 kg/m³
    elevation: np.ndarray               # float32 m
    res_m: float

@dataclass
class MemberWeather:                    # one ensemble member; hourly on the 4×4 weather grid
    t_ms: np.ndarray                    # (T,) int64 hourly
    wind_speed_10m_kmh: np.ndarray      # (T, 4, 4)
    upwind_dir_deg: np.ndarray          # (T, 4, 4) FROM direction, deg clockwise from N
    temp_c: np.ndarray                  # (T, 4, 4)
    rh_pct: np.ndarray                  # (T, 4, 4)
    fm1: np.ndarray; fm10: np.ndarray; fm100: np.ndarray   # (T, 4, 4) kg/kg (fractions)
    fm_live_herb: float; fm_live_woody: float; foliar_moisture: float   # kg/kg
    label: str                          # "control", "member07", "perturbed-03" …

@dataclass
class SpreadSettings:
    spread_adjustment: float = 1.0
    surface_lw_ratio_model: str = "behave"
    crown: bool = True
    spotting: bool = False
    max_cells_per_timestep: float = 0.4

@dataclass
class MemberResult:
    label: str
    arrival_h: np.ndarray               # float32 (M, M) hours since time_origin, NEVER = 1e6
    flame_length_m: np.ndarray          # float32 (M, M), 0 where unburned
    fire_type: np.ndarray               # uint8 (M, M) 0 unburned, 1 surface, 2 passive crown, 3 active crown
    runtime_s: float
```

### 7.2 `fire3d/grid.py` (scaffold)
```python
@dataclass(frozen=True)
class Grid:
    epsg: int; center_e: float; center_n: float; extent_m: float; width: int; height: int
    res_m: float                       # property
    bounds: tuple[float, float, float, float]  # property: (minx, miny, maxx, maxy) in UTM
    transform: Affine                  # property (rasterio)
    def with_size(self, w: int, h: int) -> "Grid": ...
    def en_to_local(self, e, n) -> tuple[x, z]: ...
    def local_to_en(self, x, z) -> tuple[e, n]: ...
    def lonlat_to_local(self, lon, lat) -> tuple[x, z]: ...      # vectorized
    def local_to_lonlat(self, x, z) -> tuple[lon, lat]: ...
    def lonlat_to_rowcol(self, lon, lat) -> tuple[row, col]: ... # float, vectorized
    def bbox_lonlat(self) -> tuple[w, s, e, n]: ...
    def cell_centers_local(self) -> tuple[X, Z]: ...             # 2-D arrays
def utm_epsg_for(lon: float) -> int
def make_aoi(center_lon, center_lat, fire_bbox_lonlat | None, mode) -> tuple[Grid, Grid]   # (render 1024², fire M²) per §8.1
def weather_points(grid: Grid) -> list[tuple[lat, lon]]          # 4×4 cell centers, row-major from the north-west
```

### 7.3 Module functions (owners in brackets)
```python
# sources/terrain.py      [terrain]  fetch_dem(grid) -> np.float32 (H, W)
# sources/landfire.py     [terrain]  fetch_landfire(grid, edition, layers=("FBFM40","CC","CH","CBH","CBD","EVT")) -> dict[str, np.ndarray]  (raw int16)
# sources/imagery.py      [terrain]  fetch_naip(grid, max_px=4000) -> tuple[bytes, int, int]
# sources/sentinel.py     [terrain]  compute_dnbr(grid, pre_window_ms, post_window_ms) -> tuple[np.ndarray | None, dict]
# build/aoi.py            [terrain]  build_static_layers(ctx) -> None  # elevation, fuel, canopy_*, naip, trees, burn_severity, sim/static.npz; updates manifest
# sources/calfire.py      [firedata] list_live() -> list[dict]; list_year(year) -> list[dict]
# sources/firms.py        [firedata] load_year_us(year, bbox=None) -> pd.DataFrame; load_live_us(days=7) -> pd.DataFrame  (brief 3: lower 48)
#                                    columns: t_ms, lat, lon, frp, satellite, instrument, confidence, daynight, scan, track
# sources/perimeters.py   [firedata] fetch_perimeters(name, lat, lon, start_ms, end_ms) -> list[dict(t_ms, acres, geometry: shapely (lon/lat), source, category)]
# catalog.py              [firedata] get_catalog(mode, min_acres=None, refresh=False) -> list[IncidentSummary]; get_summary(incident_id) -> IncidentSummary | None
#                                    estimate_fire_bbox(summary) -> tuple | None
# build/observed.py       [observed] build_observed(ctx) -> None  # detections, perimeters, observed_arrival, timeseries, events, ignition, default_profile_path, time_range
# sources/weather.py      [weather]  class WeatherSource(Protocol); class OpenMeteoSource
#                                    .deterministic(points, start_ms, end_ms) -> dict;  .ensemble(points, start_ms, end_ms, model) -> dict | None
# build/weather_bundle.py [weather]  build_weather(ctx) -> None (weather.json)
#                                    member_weathers(bundle_dir, start_ms, horizon_h, ensemble, members=None) -> list[MemberWeather]
# spread/moisture.py      [weather]  dead_fuel_moisture(temp_c, rh_pct, dt_h=1, init=None) -> (fm1, fm10, fm100) fractions
#                                    live_fuel_moisture(month) -> (herb, woody); emc(temp_c, rh_pct); ffwi(temp_c, rh_pct, wind_ms)
# spread/behavior.py      [spread]   surface_behavior(fuel_code, fm..., wind_10m_kmh, slope) -> dict; annotate_weather_with_behavior(bundle_dir) -> None
# spread/engine.py        [spread]   load_static_inputs(bundle_dir) -> StaticInputs
#                                    run_member(static, weather, ignition_mask, start_ms, horizon_h, time_origin_ms, settings) -> MemberResult
# spread/ensemble.py      [spread]   run_forecast(bundle_dir, start_ms=None, horizon_h=72, ensemble="auto", members=None, progress=None) -> ForecastManifest
# spread/validate.py      [spread]   sorensen(a_mask, b_mask) -> float; hindcast_skill(forecast_dir, observed_arrival, ...) -> list[dict]
# sources/aircraft.py     [api]      fetch_aircraft(lat, lon, radius_nm) -> list[dict]; classify(ac, context) -> (category, is_fire, reason)
# build/pipeline.py       [api]      build_incident(incident_id, progress=None, force=False) -> IncidentManifest; refresh_live(incident_id) -> bool
# api/app.py, api/jobs.py, api/live.py, cli.py   [api]
```

## 8. Algorithms (Guidance)

### 8.1 AOI sizing (`grid.make_aoi`)
- Fire bbox:
  - Historical: final perimeter ∪ the detection cluster belonging to this fire.
  - Live: current perimeter ∪ the last-7-day detection cluster.
  - Fallback: a circle of radius `sqrt(acres·4046.86/π)` around the CAL FIRE point (min 1 km).
  - `catalog.estimate_fire_bbox` computes it.
- Margin: historical 2,000 m, live 6,000 m (room to grow).
- `extent = clamp(ceil((max(w, h)·1.3 + 2·margin) / 1000)·1000, min_extent, 60000)`, with min_extent 8,000 m
  historical and 16,000 m live. Centered on the bbox center.

### 8.2 Static layers (`build/aoi.py`)
- **DEM:** one exportImage at 1024² (render). Also derive the fire-grid elevation by area-averaging, or a second
  request at M². Slope (rise/run) and aspect go on the fire grid; `numpy.gradient` with `res_m` is fine.
  Aspect = the downslope-facing direction, degrees clockwise from north. Sanity-check it on a synthetic plane.
- **LANDFIRE:** request at M² with nearest neighbour.
  - Scale: CH and CBH ÷ 10 → m; CBD ÷ 100 → kg/m³; CC ÷ 100 → fraction (keep percent in `canopy_cover.bin`).
  - Nodata/negative → non-burnable 99 for fuel, 0 for canopy.
  - Edition (`landfire.edition_for`): historical = the pre-fire edition LF{FY − 1} of the start's federal fiscal year, at least LF2023 (`landfire_gate`: before October 2023 → 422 unless forced; forced builds use LF2023 with a "LANDFIRE:" warning); live = LF2025. A failed edition falls back to the next older one only (LF2025 → LF2024 → LF2023, never forward). An edition with no fuel code in the AOI, or with no fuel code on more than 2 % of the land cells (inside the lower-48 + DC state polygons, elevation above 0.5 m), switches the whole bundle to the next older edition with the warning "LANDFIRE: LANDFIRE 2025 is not released here yet; LANDFIRE 2024 used" (other editions: "LANDFIRE <E> has no fuel data for <p>% of the land here; LANDFIRE <older> used"). Ground outside the US without fuel data stays fuel 99 and is labelled "outside fuel data coverage: not modeled (unknown, not low)"; stats gain `nodata_land_frac` and `outside_coverage_cells`.
- **NAIP:** `size = min(4000, max(2048, extent/3))` px square, JPEG.
- **Sky-view factor** (`sky_view.bin`, render grid): horizon-based ambient occlusion from the DEM.
  - 16 azimuths, march out to ~1.5 km with geometric step growth; SVF = mean over azimuths of cos²(horizon angle);
    scale to 0–255.
  - Vectorized numpy over shifted arrays: a few seconds at 1024². Verify that valleys are darker than ridges in a
    quick-look.
- **Water mask** (`water.bin`, render grid, optional):
  - Source 1: NAIP green + NIR from exportImage with `bandIds=1,3` (G, NIR), `format=tiff`, 1024², uint8.
    NDWI = (G − NIR)/(G + NIR); water where NDWI > ~0.15, slightly blurred for soft edges.
  - Source 2: FBFM40 code 98 (open water), upsampled. Union the two.
  - On failure, write fuel-98 only plus a warning.
- **Trees:** jittered placement per fire cell.
  - Count ~ Poisson(cc_frac · k), with k tuned so the total is ≤ 120,000.
  - Height = CH × U(0.7, 1.1), with a floor of 3 m where cc > 0.
  - Crown radius = clamp(0.28·h, 1.5, 9).
  - Kind:
    - FBFM 161–165 and 181–189 → conifer (0);
    - else broadleaf (1) if CH ≥ 5 m;
    - shrub fuels 141–149 → shrub (2), with a few low shrubs even where cc = 0 (density ∝ shrub cover) so chaparral
      reads as scrub.
  - y = bilinear DEM at (x, z).
- **dNBR** (historical; best-effort for live):
  - Pre-fire scene: least cloudy in [start − 60 d, start − 1 d].
  - Post-fire scene: least cloudy in [end + 3 d, end + 60 d]; live: last 10 days.
  - Mosaic tiles if needed. NBR = (B08 − B12)/(B08 + B12) after scale/offset; mask clouds with SCL (3, 8, 9, 10, 11).
  - dNBR = NBR_pre − NBR_post.
  - After the observed reconstruction, pixels farther than 1 km from this incident's burned area become nodata
    (`pipeline.mask_burn_severity`): the post-fire window can hold other fires' scars and harvested fields.
  - On failure, write nothing and add a manifest warning.

### 8.3 Observed arrival-time reconstruction (`build/observed.py`)
1. **Detections for this fire:**
   - **With the key (primary):** the FIRMS area API over the AOI bbox (§2), in 5-day chunks (GOES: 2-day chunks),
     for t ∈ [start − 12 h, end].
     - Historical sources: `VIIRS_SNPP_SP`, `VIIRS_NOAA20_SP`, `VIIRS_NOAA21_SP`, `MODIS_SP`, `LANDSAT_NRT`,
       `GOES_NRT`.
     - Live sources: the matching NRT sources, plus SP for dates before NRT coverage.
   - **Without the key (fallback):** historical = yearly SNPP + MODIS; live = the four 7d feeds.
   - **Filters:**
     - Drop `type == 1` (volcano) only.
     - Drop VIIRS confidence "l", MODIS confidence < 30, and GOES confidence < 50 (and `*FRP` duplicate rows).
   - **GOES** contributes timing (ignition refinement, `frp_mw_per_h`, `detections_per_h`) and may add intermediate
     snapshot times when it shows clear growth between VIIRS passes. It never contributes to the spatial mask.
   - Cluster in space-time (eps ≈ 1.5 km, 2 days) and keep clusters connected to the ignition/perimeter. This removes
     other fires inside the AOI.
   - Footprint: VIIRS ≈ 375 m × (scan, track); MODIS ≈ 1 km × (scan, track); LANDSAT 30 m; GOES ≈ 2 km (timing
     only).
2. **Perimeters:**
   - Fetch: California records as §2; other fires by IRWIN id, else name + state (§2).
   - Dedupe per timestamp (keep the latest edit, i.e. max `poly_DateCurrent`).
   - Make them cumulative: each perimeter = union with all earlier ones.
   - Drop ones that shrink by more than 20%; flag them.
   - Simplify to ≤ 1500 vertices.
3. **Final burned mask F:**
   - Use the latest/largest perimeter when available, ∪ detection footprints within 300 m of it.
   - Otherwise use the union of footprints shrunk by ~⅓ to reduce VIIRS bloat.
4. **Snapshots:**
   - Snapshot times = perimeter times ∪ detection overpasses (detections grouped within 30 min).
   - `B_k` = (perimeters with t ≤ t_k ∪ footprints with t ≤ t_k) ∩ F.
   - Enforce `B_k ⊇ B_{k−1}`.
5. **Arrival per pixel in F:**
   - k\* = the first snapshot containing the pixel.
   - Interpolate between snapshots with the distance-ratio rule:
     `T = t_{k*−1} + (t_{k*} − t_{k*−1}) · d_prev / (d_prev + d_next)`, where
     `d_prev` = EDT distance to `B_{k*−1}` and `d_next` = distance to the outside of `B_{k*}`.
   - For k\* = 0, use the ignition point at the ignition time.
   - Result: smooth, monotone fronts. Pixels outside F = NEVER.
6. **Ignition:**
   - Use the fire record's point (CAL FIRE in California, NIFC WFIGS/IRWIN elsewhere) at its start time, snapped into the earliest burned region; every text names the record's issuer (`record_issuer`, e.g. "Reported by USFS via NIFC WFIGS Jul 09, 13:32 MDT"), times in the fire's own zone (`summary.time_zone`).
   - If that point is > 3 km from the earliest detections, use their centroid and label the source.
7. **timeseries:**
   - `area(t)` = count(arrival ≤ t)·res² → acres; growth = Δarea.
   - `ros_ch_per_h(t)` = 90th percentile of `1/|∇T|` (m/h) over pixels with arrival in (t − 1 h, t], in chains/h.
     Clamp outliers; use 0 when nothing burned that hour.
8. **events** (≤ ~12 total, each with location and confidence):
   - **ignition**.
   - **rapid_growth:** hours with growth ≥ max(250 ac/h, 3 × the median positive growth); keep events ≥ 12 h
     apart, max 3.
   - **spot_fire (prob.):** a detection > 750 m outside the previous `B_k`; max 3.
   - **ridge_crossing (est.):** the front crosses a prominent ridge, e.g. pixels with TPI > +40 m at ~500 m radius
     forming lines, burned from one side then the other within 12 h.
   - **containment:** from WFIGS `attr_ContainmentDateTime`, or the record at 100% ("{issuer} (100% contained)").
   - **peak_wind:** max gust while the fire grew. This is added in `pipeline.py` after weather is built.
9. `default_profile_path` = [ignition, the farthest burned pixel along the dominant growth direction].
   `time_range`:
   - start = `time_origin_ms`.
   - end: historical = the time 99% of the final area was reached + 24 h (capped at start + 45 d); live = now_ms.
   - now_ms: historical = end. Live = the latest observation of the fire (`build/live_observation.py`):
     - `last_detection_ms` = the newest VIIRS/MODIS/Landsat detection or mapped perimeter of this fire. The burned
       area is known up to here; the observed arrival is clipped to it (no growth is invented after it).
     - Satellite passes over the fire's centroid since then come from NASA CMR (§2). A pass is *confirmed* when its
       granule was published ≥ 30 min before our FIRMS data of the same satellite were fetched (a satellite whose
       FIRMS request failed has no confirmed passes). A confirmed pass after `last_detection_ms` saw no fire above
       the detection limit; `last_pass_ms` = the newest confirmed pass.
     - now_ms = max(`last_detection_ms`, `last_pass_ms`), except when the record's acreage (CAL FIRE or NIFC WFIGS) reported after the last
       detection exceeds 1.25 × the mapped area + 100 ac (the fire grew unseen): then now_ms = `last_detection_ms`
       with a warning. Without CMR (outage) now_ms = `last_detection_ms`, with a warning.
     - Activity too weak or coarse to map area (low-confidence VIIRS/MODIS pixels within 1 km of the burned area,
       GOES detections of this fire on ≥ 2 scans within 1 h) after `last_detection_ms` is stored with the confirmed
       passes in `sim/activity.json` (backend only) for the forecast (§8.5). It never moves now_ms.
     - The `NASA CMR satellite passes` data source explains the decision in plain words.
10. **Data sources:** the data sources list the fire's own record first: "CAL FIRE incidents" or "NIFC WFIGS incident
    record (IRWIN)" (IRWIN id and issuer in `detail`).

### 8.4 Weather and fuel moisture
- **Points:** the 4×4 `weather_points(grid)`.
- **Live:** HRRR (`past_days=3`) filled with `gfs_seamless`.
- **Historical:** historical-forecast HRRR over [start − 72 h, end + 72 h], falling back to the ERA5 archive.
  Chunk long ranges.
- **Fire-local time:** month-dependent values (live fuel moisture rows) use the month in the fire's zone
  (`timeutil.local_month(ms, summary.time_zone)`), never Pacific.
- **Open-Meteo limits** (`sources/weather.py`, `fire3d.http`): a 429 naming a daily, hourly or per-minute limit is
  never retried (a per-minute one is waited out once) and blocks that host in the process until the reset; a blocked
  host answers from the cache or raises `WeatherQuotaExceeded` ("Open-Meteo daily request limit reached; retry after
  the reset (00:00 UTC)"). A *daily* block is re-checked at most once an hour (`weather.DAILY_RECHECK_S = 3600`,
  counted from the block or the last re-check) with one tiny uncached probe request (no retries): an answer lifts the
  block, a limit answer renews it (`weather.recheck_daily_block`, used by every request and by the build preflight; at
  most 24 tiny requests a day per blocked host; on a shared IP the daily refusal can be transient). Error bodies
  (stream errors, cut-off JSON, `{"error": true}`) are never cached and are evicted when found. A refused
  deterministic request fails the build (never ERA5-filled); `build --require-hrrr` also refuses ERA5-filled hours
  and, in California, a missing water-year total. `weather-probe` sends one tiny uncached request per host.
- Request `timeformat=unixtime`, `wind_speed_unit=ms`.
- Wind direction is FROM. Convert to u/v for averaging/interpolation:
  `u = −S·sin(dir)`, `v = −S·cos(dir)`.
- **Dead fuel moisture:** EMC (Simard 1968, from °F and RH) → 1-h ≈ 1.03·EMC; 10-h and 100-h are exponential lags
  of EMC with τ = 10 h and 100 h. Spin up over the 72 h before the start.
- **Live fuel moisture** (CA defaults by month, documented and configurable; operational forecasts blend them toward
  the dry-season row when the water year has been dry, see `config.DROUGHT_ADJUSTED_LFM` and docs/validation.md 3.1):
  - Jan–Apr: herb 1.2, woody 1.2
  - May–Jun: herb 0.6, woody 1.0
  - Jul–Oct: herb 0.3, woody 0.7
  - Nov–Dec: herb 0.6, woody 0.9
  - Foliar moisture 1.0.
  - Outside California (`summary.state != "CA"`) live fuel moisture follows the NFDRS 2016 Growing Season Index
    (Jolly et al. 2005; the default parameters of the USFS reference code NFDRS4): daily GSI = iTmin · iVPD · iDayl
    with iTmin 0 at −2 °C .. 1 at 5 °C (daily minimum temperature), iVPD 1 at 900 Pa .. 0 at 4100 Pa (VPD =
    es(Tmax) · (1 − max(RHmin, 5 %)/100), es = 610.7 · exp(17.38 T / (239 + T)) Pa), iDayl 0 at 10 h .. 1 at 11 h
    (MT-CLIM day length); the GSI at a forecast start is the mean of the 21 local days before the start's day (all 21
    required), scaled by MaxGSI 1.0; below the green-up threshold 0.5 herb 0.30 and woody 0.60, above it linear to
    herb 2.50 and woody 2.00 at GSI 1. Inputs: hourly 2 m temperature and humidity at the fire, aggregated to the
    fire's local days, from the Open-Meteo ERA5 archive (`models=era5`, historical builds: start − 28 d through the
    end of the weather window) or the forecast host's `past_days=28` (live builds); stored in the backend-only
    `sim/lfm_gsi.json` (builds and live forecasts fetch it; hindcasts never do). The hourly fire behaviour charts use
    each local day's GSI and hold the latest 21-day value after the series ends (a live series ends today). The
    forecast note reads "live fuel moisture herb H%, woody W%: NFDRS 2016 growing season index G (mean of the 21 days
    A..B; source)". `config.GSI_*`. California keeps the month table and drought rule.
  - Never silent: a bundle outside California without the series (refused or failed request, or fewer than 21 days
    before a start) uses California's values with the manifest warning "Live fuel moisture outside California uses
    California's seasonal values because the regional (GSI) series is unavailable; experimental." and the forecast
    note prefix "Live fuel moisture: California's seasonal values (GSI series unavailable); experimental."; hours of
    the behaviour charts without a GSI value add the manifest warning "Fire behaviour charts (<dates>, <n> h): live
    fuel moisture uses California's seasonal values (GSI series unavailable); experimental."; `build --require-hrrr`
    fails instead. docs/validation.md section 10 reports the method's test on 12 fires.
- **FFWI:** Fosberg, using EMC (%) and wind (mph).
- `at_fire` = weather interpolated at the ignition/centroid.
- **Ensembles** (`member_weathers`):
  - **gfs025 / ecmwf_ifs025** (live): fetch the members at the 16 points. Bias-correct to HRRR while HRRR exists:
    `x_i = x_hrrr + (x_i − mean_ens)` in u/v/T/RH space, blending to raw members over 6 h after HRRR ends.
  - **perturbed** (historical, or a fallback): 31 members around the deterministic series. Perturbations are AR(1)
    with τ = 8 h:
    - wind speed × lognormal (σ = 0.25)
    - direction + N(0, 20°)
    - RH + N(0, 6%)
    - temperature + N(0, 1.5 °C)
    Seeds are deterministic; member 0 is unperturbed.
  - **none:** the single deterministic member.
  - Recompute fuel moisture per member.

### 8.5 Spread forecast (`spread/*`)
- **pyretechnics API (verified):**
  `pyretechnics.eulerian_level_set.spread_fire_with_phi_field(space_time_cubes, spread_state, cube_resolution=(band_minutes, cell_h, cell_w), start_time, max_duration, …)`.
  - Cubes are `pyretechnics.space_time_cube.SpaceTimeCube(cube_shape=(bands, rows, cols), base)`; the base may be
    lower resolution if the dims divide evenly. Use base `(1, M, M)` for static layers and `(T, 4, 4)` for weather,
    so M must be divisible by 4.
  - Required cube units:
    - slope: rise/run; aspect: degrees clockwise from N
    - fuel_model: FBFM integer code
    - canopy_cover: 0–1; canopy_height and canopy_base_height: m; canopy_bulk_density: kg/m³
    - wind_speed_10m: km/h; upwind_direction: degrees clockwise from N (FROM)
    - moistures: kg/kg; temperature: °C
    - optional `weather_spread_adjustment`
  - `SpreadState(cube_shape).ignite_cells(lower_left_corner, ignition_matrix)`.
  - `get_full_matrices()` returns phi, fire_type, spread_rate, flame_length, time_of_arrival, …
  - **Verify the conventions with tests:** on a synthetic upslope the fire runs uphill; with wind FROM 270° it runs
    east; the FBFM40 code table is accepted.
- **Ignition mask** = observed_arrival ≤ start_h on the fire grid. If empty (start before ignition), ignite the
  ignition cell at its time.
- **Members** run in a `ProcessPoolExecutor(max_workers=min(10, cpu − 2))`. Target < 5 min for 31 members × 72 h
  at M ≤ 512. If slower, downsample the simulation grid ×2 and upsample the results (nearest for arrival). Log
  timings in `runtime_s`/warnings.
- **Outputs:**
  - Per-pixel arrival quantiles p10/p50/p90 (§5 semantics) and burn_probability at the horizon.
  - flame_length_p50 over members that burned the pixel.
  - Series: hourly area quantiles across members; ROS p50 from the members' spread_rate at the front.
- **Historical runs:** skill = Sørensen between (forecast p50 burned by start + L) and (observed burned by
  start + L), for L ∈ {12, 24, 48, 72} within the data range. Each skill entry also carries `growth_sorensen`
  (Sørensen of the new growth only, `validate.skill_entry`).
- **`validate.py`** also provides a CLI-callable batch hindcast used to pick `spread_adjustment`, e.g. a grid search
  over {0.5, 0.75, 1, 1.5, 2} on 2–3 fires. Record the result in `docs/validation.md`.
- Spotting is off by default. Crown fire is on.
- **Operational settings** (`config.FORECAST_*`, calibrated in docs/validation.md 3–5): spread-rate multiplier 0.5 at
  the start relaxing as × (0.1 + 0.9 e^(−lead/12 h)); drought-adjusted live fuel moisture; WUI surrogate off.
  `ForecastManifest.model.spread_adjustment` reports the multiplier at zero lead (0.5); the schedule, including a
  decay clock that starts before the forecast (live, below), is in the forecast warnings.
- **Held perimeter** (observation-informed start): unburned cells along the perimeter are made non-burnable (2-cell
  band) where nothing burned and no VIIRS/MODIS/Landsat detection of new burning was made within 1 km in the 12 h
  before the start. A detection counts only where it coincides with growth: its cell burned in the window or lies
  outside the burned area. A hot pixel on ground that burned before the window is burnout, not spread.
  Live forecasts add, from `sim/activity.json` and the manifest summary:
  - activity markers (§8.3) after the window start, also those seen after the forecast start: the perimeter within
    1 km of them (GOES: of a 1 km disk around the pixel centre) stays active;
  - the record's containment (CAL FIRE or NIFC WFIGS, note "{issuer} reports N% containment"): at least `percent_contained` of the perimeter is held, the cells farthest from recent
    activity first (where the contained lines are is not published);
  - when the start is later than the last sign of activity (a quiet satellite pass), the multiplier's decay is
    counted from that activity, as if the forecast had started there.
  A fully held perimeter gives a no-growth forecast; its warning says that this does not mean the fire is out.
- **Activity-rule switches** (`config.FORECAST_ACTIVE_*`; tested on 2026-10-18, docs/validation.md 6.6): the 1 km
  activity radius (`FORECAST_ACTIVE_RADIUS_M`), ignoring activity deeper than `FORECAST_ACTIVE_EDGE_M` inside the
  burned area (0 = off) and counting detections only where they coincide with growth (`FORECAST_ACTIVE_GROWTH_ONLY`).
  Operational: 1 km radius, edge filter off, growth-only on (docs/validation.md 6.6). `validate hindcast` and
  `validate live-start` take `--radius-m`, `--edge-m` and `--growth-only` / `--no-growth-only`.

### 8.6 Aircraft classification (`sources/aircraft.py`)
Sources: adsb.lol `point` around the incident (radius 40 nm); adsb.fi open data when adsb.lol is unreachable (each
provider is skipped for 5 min after a failure and paused 30 s after HTTP 429). Rules, in confidence order:
1. **Known firefighting types** (configurable list in `config.py`; verify the ICAO designators):
   - fixed-wing tankers: `DC10`, `MD87`, `RJ85`, `B461`/`B462`/`B463`, `C130`/`C30J`, `CL2T`, `S2P`/`S2T`, `AT8T`
   - air attack / lead: `OV10`, `AC90`, `AC95`
   - helicopters: `S64`, `S70`/`H60`, `CH47`/`H47`, `KMAX`
2. Registration/operator patterns (CAL FIRE and contractor fleets) and callsign prefixes such as `CALFIRE`, `TNKR`,
   `TANKER`, `ATTACK`, `LEAD`, `HELI`. Keep these in config with comments.
3. **Proximity:** inside the AOI, AGL < 1,500 m, gs < 250 kt, not an airliner category (A3–A5) → `other_fire` with
   reason "low & slow over fire".
4. Squawk 1255 (the US firefighting beacon code) counts as strong evidence, like a fire callsign. Air-ambulance,
   police, news and airlift callsigns or operators and emitter categories B1–B4 (gliders, balloons, parachutists,
   ultralights) veto only the "low & slow" inferences (`config.NON_FIRE_*`).

Only fire aircraft are returned unless `all=1`. `agl_m` uses the DEM when the aircraft is inside the AOI.

### 8.7 Live refresh (`api/live.py`)
An asyncio loop every 15 min refreshes the national live list (every active wildfire of the lower 48: CAL FIRE in
California, NIFC WFIGS elsewhere; brief 3) and the national FIRMS 7d feeds (`firms.load_live_us(days=7)`, the
lower-48 box with a 0.5° margin). Then:
- every ready live bundle's `manifest.summary` follows its records (acres, containment, update time, active flag,
  location fields, `detections_24h`, and since brief 3 `active_sources`, `other_records`, `complex_members`,
  `irwin_id`, `gacc`, `accuracy_region`): an atomic manifest update, no rebuild, `built_ms` unchanged. When the
  listed row is another agency's record than the summary's (`record_source` or `uid` differs: an id pinned to a bundle
  built under the fire's NIFC WFIGS id, §4.4 / CONTRACT 14.2), the record's identity is copied too (`name`,
  `source_name`, `record_source`, `record_issuer`, `uid`, `calfire_uid`, `agency`, `agency_code`, `unique_fire_id`,
  `aliases`, `complex_name`, `state`, `time_zone`, `started_ms`, `year`; the id and `time_origin_ms` stay), so the
  numbers, the link and the issuer always come from one record. An incident that left the live list is looked up in
  its year list;
- for each built live bundle with detections newer than `now_ms` (or built > 3 h ago, which picks up quiet
  satellite passes):
  - re-run `build_observed` and `build_weather`;
  - re-run the forecast when the last one is > 3 h old or burned area changed > 2%;
  - after a live-loop forecast, keep the newest 4 ready runs plus every run issued in the last 6 h; other runs leave
    the manifest first, and their directories are deleted ≥ 1 h later (an open view keeps working).
- Weather in a live refresh is refetched at most hourly (`config.LIVE_WEATHER_REFETCH_S = 3600`) and not at all once
  the day's weighted Open-Meteo usage passes `config.OPEN_METEO_DAILY_SOFT_CAP = 6000` (`weather.open_meteo_usage()`,
  persisted in `data/cache/open_meteo_usage.json`; cost = locations × max(1, series/10) × max(1, days/14)); the
  bundle then keeps its weather with "Weather not refreshed: daily request budget reached."; a refused refresh keeps
  it with "Weather not refreshed: Open-Meteo daily request limit reached." (the hourly and per-minute limits name
  themselves the same way; removed by the next successful refresh). A refresh without supplied detections loads
  `firms.load_live_us(days=2)`. After a successful build, the OpenFEMA archive window of the fire is prefetched once
  (`pipeline.archive_prefetch` → `openfema.prefetch`; best effort, never fails the build): an API build job only
  starts the one deduplicated background fetch (`openfema.start`) and ends when its bundle is ready (`JobManager.drain`
  waits for these follow-up threads); a CLI build fetches synchronously, each request capped at
  `openfema.PREFETCH_TIMEOUT_S = 15` s with no retry. A window that failed less than 10 min ago is not restarted.

Max 1 forecast job at a time.

Auto-build on startup (env `FIRE3D_AUTO_BUILD_LIVE=1`, default on): up to 4 live incidents with ≥ 100 acres and
detections in the last 48 h, chosen from the whole lower-48 live list (brief 3, round 2 item 4). Builds run
sequentially. `LiveStatus.detections_24h` counts the feed's last 24 h inside the lower-48 state polygons
(`detections_24h_ca`, California, stays for one release).

### 8.8 Flood catalog (`fire3d/floods/catalog.py`, `grouping.py`, `naming.py`, `registry.py`; brief 5)

The live flood list (`GET /api/floods`) groups NWS flood products and river gauges into floods (PLAN-5 §3.2, CONTRACT
§16.8). **Inputs, five national requests per cold build** (at most `MAX_LIST_UPSTREAM_REQUESTS` = 6, tested): the NWS
flood products in effect in the lower 48 + DC (`sources/nws.flood_active`: Flood / Flash Flood Warning, Flood / Flash
Flood Watch, Flood Advisory and their statements; coastal and lakeshore products are out), the NWS `riv_gauges` map
service layers 0 and 15 (gauges observed / forecast at action or worse), `rfc/rfc_max_forecast` (official RFC forecast
points) and the Iowa Environmental Mesonet's current flood warnings (H-VTEC gauge ids, a join key only). Nothing per
flood (no zone outline, product text, gauge detail or series) is requested in the list build.

1. **Keep** actual products in effect or upcoming with a UGC in a lower-48 state or DC and an area touching the lower
   48; gauges in the lower 48 + DC.
2. **Link** gauges to river products (FL.*): a cached product-text H-VTEC, else the IEM join (office, phenomena,
   significance, ETN), else a gauge inside the polygon + 2 km on the river the segment's `* WHERE...` line names.
   Areal products (FA.*) link a flooding gauge inside their area on the water their text names ("along the Silver
   Creek", "Flooding of the Little Colorado River", "* WHERE...The Little Colorado River from Winslow to Leupp"); a
   gauge inside a FL or FA area whose waterbody the segment's own description names is linked too (the
   "<River> near <Place> affecting <County>" lines that list a whole product's rivers never count).
3. **Join** (union-find) products with one VTEC key (the CAP `references` chain when NWS sends no VTEC), linked gauges,
   river members of the same river (equal significant name words) within 25 km (an areal product counts as a river
   member of the water its text names, "Flooding along the San Juan River"; integration), and flash / areal polygons overlapping
   30 % of the smaller or within 10 km and issued within 12 h (issue time: the oldest message of the CAP `references`
   chain, so an update never splits a flood). River and flash products never join by distance alone; names that name
   no river ("Tide Station") never join. While NWS cannot be read, gauges whose open episodes belong to one flood stay
   joined (the products that tied them are unknown, not gone).
4. **Watches** never bridge two floods: they attach to every flood they overlap (zone-based ones through their CAP SAME
   counties and the packaged county shapes, no request), else form a flood at level `watch`.
5. A gauge at minor or worse that no product names is a flood at level `gauge_only` ("No NWS flood product names this
   gauge right now."); a gauge at action joins a flood but never starts one. A gauge that may measure tidal or lake
   water (SHEF code HM / HC, a tidal datum note such as "(in MHHW)", a coastal word in its waterbody, or within 10 km of
   such a gauge) says instead that Disaster Mapping does not read NWS Coastal Flood or Lakeshore Flood products, which may be in
   effect there; while NWS cannot be read the caveat is "NWS flood products could not be reached right now. …".
   A gauge-only flood whose gauge stands inside the area of a non-watch NWS product lists that product too (attached
   like a watch: never a join, never its own registry key), so it is never shown as "no NWS flood product here" while
   one covers the gauge (integration, 2026-11-05: the Ocoee River gauge at Copperhill read major under NWS Morristown's
   Flash Flood Emergency for Copperhill).
6. **Fields:** primary gauge (highest observed, then forecast category, then flow); point (primary gauge, else the
   representative point of the largest polygon); `bbox_lonlat`; state, states, county and IANA time zone from
   `fire3d.regions` (never NWPS's POSIX zones); kind river (any FL.* or gauge) / flash (FF.W) / areal; level warning >
   advisory > watch, else gauge_only (a gauge at flood stage under only a watch stays gauge_only: it is never hidden as
   a watch-only flood); `max_category` over member gauges' observed and forecast categories.
7. **Start:** the earliest of a NEW product's VTEC begin and own time, the oldest referenced message, and the
   registry's first-seen time (`started_basis` `nws_product` / `first_seen`); a member gauge's first crossing of flood
   stage refines it (`gauge`) only when its series is already cached.
8. **Status:** `active` while a product is in effect or upcoming or a member gauge read minor or worse within 6 h, else
   `inactive` (never shown as a word); a flood that left the lists stays listed (inactive) for 48 h after Disaster Mapping last
   saw it, with every product `ended` (it left NWS's active list), `expires_ms` null, `emergency` false and the level it
   last had. It is listed so only when Disaster Mapping can tell: NWS answered, the gauges answered when it has any, and none of
   its products is listed now with another flood; during an outage it is not listed (its detail answers its last-known
   summary, its products in effect until their own NWS end time).
9. **Names:** "<River> flood", "<Place> flash flood", "<Water> flood" / "<Place> flood", "Flood watch: <first area>
   and N more areas"; a waterbody's datum, state and position notes are dropped ("Toccoa River (GA) / Ocoee River
   (TN)" → "Toccoa River / Ocoee River"); duplicates get the state, then a place-based name, then a number, and a state
   suffix that no longer separates two floods is dropped; never "fire".
10. **Ids** `flood-{YYYYMMDD}-{slug}-{h6}` stay stable through `data/floods/registry.jsonl`: VTEC keys are permanent,
    a gauge key is an episode `NWSLI@first_seen_ms`, kept until its flood has been quiet longer than 48 h (judged from
    the flood's last-known summary, never from Disaster Mapping's own build gaps: a restart after a night off keeps the ids);
    a gauge flooding again later gets a new id; merges keep the older id (`aliases`), a split keeps it on the part with
    the anchor, and the other part's keys are reassigned to its new id (stable through later NWS updates; a live
    part's id is never aliased to another live part). During an outage an id's last-known summary is not
    overwritten.
11. **Sources and outages:** `sources[]` `nws_alerts`, `nwps_gauges`, `rfc_forecasts`, `iem_archive` (the IEM join;
    its outage never shortens the cache) with `status`, `retrieved_ms`, `stale`, `reason`. A failed source answers from its last cached copy (`stale: true`); without one: NWS down → floods
    from gauges only, gauges down → from products only, both down → the flood bundles on disk only. Cached 5 min, 60 s
    while degraded.
12. **Order:** `floodRank` (CONTRACT §16.8), then the newest update.
13. **`GET /api/floods/{id}`** resolves: the live list → the year lists (§8.10, cached lists only) → a registry alias (the
    canonical summary) → the bundle's frozen summary → the last-known summary (`data/floods/last_known/{id}.json`) →
    404; 503 "The flood lists could not be reached right now; try again later." when the lists could not decide and
    nothing is on disk. A summary from the alias, bundle or last-known step is shown as it left the lists (rule 8).

### 8.9 Flood live refresh (`fire3d/floods/live.py`; brief 5)

A **second asyncio task** in the API's lifespan, started when `FIRE3D_LIVE=1` and `FIRE3D_FLOODS=1` (default on), with
its own state; the fire loop (§8.7) is not changed, and a flood error never reaches it (independent tasks; each cycle
catches its own errors). Every `REFRESH_S` = 900 s (`FIRE3D_FLOOD_LIVE_INTERVAL_S` for tests) one cycle:

1. **List:** the live flood list is rebuilt (`catalog.flood_list(refresh=True)`, the five national requests of §8.8).
   `GET /api/floods/status` then answers from the loop: `last_refresh_ms`, `next_refresh_ms`, `active_floods` and
   `gauges_in_flood` (active floods only), **null when the lists could not decide** (NWS or the gauges could not be
   read, or the cycle failed), never 0; `auto_build` is true only while the loop runs with auto-build on. Without the
   loop (or before its first cycle) the status comes from the cached list (`next_refresh_ms` = the list cache's).
2. **One budget a cycle: `PREFETCH_MAX` = 20 upstream requests** for the background prefetch **and** the append
   step of 3 together (NWS and NWPS requests alike; never in the list build; C9), each counted at its largest cost
   before it is made, so the loop never uses up Disaster Mapping's own NWS or NWPS limit (30 a minute each). The **prefetch**
   takes at most 20 − `APPEND_SHARE` (8) = 12: the product text of river products in effect (their H-VTEC gauge id:
   the list then links the right gauge; warnings first, newest first; at most 6 requests), the NWS zone outlines of
   zone-based products (most watches; flood-alerts answers then draw NWS's own zones instead of whole counties; at
   most 3), the 30-day series of member gauges at minor or worse (the list then refines a flood's start from the
   first crossing of flood stage; at most 3); a share left unused goes to the next kind. NWS calls run on the shared
   `NWS_LIMITER`, NWPS calls on their own; Disaster Mapping's own rate limit ends a kind for the cycle (a product text it
   refused is asked again in a later cycle).
3. **Ready live flood bundles of listed floods** (at most 8 a cycle, the least recently refreshed first; never while
   a build or refresh of that flood runs):
   - **append** (within what is left of the cycle's budget): new NWS product versions to `warnings.json` (every
     version seen is kept; a product NWS answered without is marked `ended`, as the list does; an outage changes
     nothing; when the zone outlines and product texts the products' answer would fetch do not fit the budget, the
     products wait for a later cycle) and new member gauge readings to `gauges.json` (NWPS detail and series for at
     most 12 gauges a cycle within the budget, the earlier observed rows kept; the list's own reading whenever it is
     newer, no request); atomic writes under the bundle's build lock, validated against the contracts;
     `manifest.refreshed_ms` says when (`built_ms` stays);
   - **refresh** (kind `refresh`, at most once an hour per bundle, active floods only) when NASA's Earthdata GIS
     catalog has a satellite pass over the area that the bundle's build could not have used and this server has not
     tried yet (with a measured image: passes newer than it; without one: passes that appear after the first check
     following the build; the keys tried are kept in `data/floods/live_state.json`, so a restart never tries them
     again), when NWS's forecast flooded-area map of the area has a new forecast time, or 3 h after an official layer
     (warnings, gauges, forecast map) could not be loaded at build time. A due refresh is run by the loop's own
     runner, one after another, never in the job workers: it first loads the flood's NWPS gauge details and series and
     the model series of their reaches into the HTTP cache at a pace that leaves 10 of NWPS's 30 slots a minute free
     (at most 4 min), then queues the job. The job re-runs the flood build (`build_flood(force=True)`; terrain and the
     aerial photo come from the HTTP cache when the area did not change). **A refresh never makes a bundle worse:** the
     product versions and readings the bundle had are put back; a member gauge the rebuild could read only from the
     NWS gauge map (or not at all) keeps its earlier NWPS detail (impacts, reach, forecast, data attribution) with the
     newer reading, and a member gauge it left out is put back; the earlier model series are kept; a layer that was
     `ok` but could not be loaded again (forecast map, floodplain, model, satellite outage, aerial photo, products,
     gauges) keeps its earlier copy, its own time and its credit; the manifest then says "The refresh of {time} could
     not load {what} again; the earlier copy is kept, with its own time."
4. **Past years:** each cycle starts the one-time background build of a past year's list when it is missing or stale
   (§8.10; no request once built).
5. **Auto-build** (`FIRE3D_AUTO_BUILD_FLOODS`, default = `FIRE3D_AUTO_BUILD_LIVE`), once, on the first cycle in which
   both lists answered: of the 4 most severe listed floods (`floodRank`; active, real, lower 48 or DC; watches and
   gauges that may measure tidal water left out), those without a bundle are built one after another (D4), each after
   the same paced warm-up of its NWPS answers.

CLI: `uv run python -m fire3d.cli catalog --hazard flood [--mode live|historical] [--year Y] [--refresh]` lists floods;
`uv run python -m fire3d.cli build-flood <id-or-name> [--force]` builds one flood bundle with progress (the API's
build gate: 404 / 409 / 503 texts; a past flood: 409 `PAST_NO_BUNDLE`); `uv run python scripts/check_bundle.py
--hazard flood <id>` checks a flood bundle (strict contracts, layer encodings, credits, absolute times, no secret; notes
member gauges of the summary missing from `gauges.json`, members with the gauge map's reading only, and what a refresh
kept).

### 8.10 Past floods (`fire3d/floods/history.py`; brief 5, user decision U1 (a))

Year lists for 2026 and 2025 (`PAST_YEARS`), built **once per year in a background thread** on the first request
(`preparing: true` until then; the CLI `catalog --hazard flood --mode historical --year Y` builds and waits), kept in
memory and on disk (`data/floods/years/{year}.json`): for good for a closed year, rebuilt after 6 h for the current one.
A failed or partial build is retried after 10 min and never replaces a complete list.

- **Sources:** the Iowa Environmental Mesonet's archive of NWS products (an archived copy, credited "National Weather
  Service, archived copy via the Iowa Environmental Mesonet (Iowa State University)"). Per month two requests:
  `cgi-bin/request/gis/watchwarn.py?accept=csv&limit1=1&limitps=1&phenomena=FL,FF&significance=W,W&addsvs=1` (one row
  per storm-based warning polygon, issuance and every follow-up statement, with the H-VTEC NWSLI and severity, the damage
  tag and the emergency flag) and `api/1/vtec/sbw_interval.geojson?ph=FL&ph=FF` (the issuance polygons, the year, the
  counties; the first month starts 14 days earlier because the two services cut their windows differently). Rows and
  polygons are joined by VTEC key after all months are read. The gauges' names, rivers and positions come from the NWS
  `riv_gauges` map (`gaugelid in (...)`, 150 a request, cached 30 days). About 30 requests a year on `nws.IEM_LIMITER`
  (30 a minute, shared with the fire archive; the build waits for a slot); cached for good for a closed year's months,
  30 days for this year's closed months, 6 h for the current month. Measured 2026-11-05: 2025 in 24 IEM + 5 map
  requests (23 s, 1,976 floods); 2026 in 22 + 3 (25 s, 2,108 floods).
- **Rule (`past_rule: "moderate_or_worse"`, PAST_RULE):** river Flood Warnings (FL.W) at an NWS gauge whose H-VTEC
  severity was 2 (moderate) or 3 (major) in any of their products (H-VTEC's severity is the flood severity NWS
  **forecast or observed**, so: river floods that reached **or were forecast to reach** moderate or major flood stage);
  Flash Flood Warnings (FF.W) whose damage threat reached CONSIDERABLE or CATASTROPHIC, or that IEM marks as an
  emergency; lower 48 + DC. The fallback rule is not needed (the bulk route has severity and tags). A flood whose
  newest product had not expired when the year was built is left out (it is current: the live list serves it).
- **Grouping:** one river flood per gauge episode (warnings at one gauge less than 48 h apart; the same gauge flooding
  again later is another flood); flash floods joined when their issuance polygons overlap 30 % of the smaller within
  12 h. Names as §8.8 rule 9 (the gauge's river without its state or position notes, as the live list's
  `naming.clean_water`: "Whitewater River (KS)" names "Whitewater River flood"; the largest place in a flash flood's
  polygon), duplicates numbered.
- **Ids:** a VTEC key in the registry gives its live id (and the live name from the last-known summary), so a 2026
  flood Disaster Mapping saw live keeps its id; rows of one live id are merged. Served rows follow the registry's aliases at
  the time of the request (a merge recorded after the build), so an old id resolves as an alias of the canonical flood. Other ids are deterministic
  (`flood-{YYYYMMDD of the first product}-{slug of the name before duplicate suffixes}-{h6 of the gauge or the oldest
  VTEC key}`; the slug keeps the gauge's raw waterbody, so cleaning the shown name changed no id). The disk copies carry
  `SCHEMA` (3); a copy of an older schema is rebuilt once from the cached month answers.
- **Rows:** `mode: "historical"`, `status: "inactive"`, level `warning`, `started_ms` = the first product's issue time
  (`nws_product`), `last_product_ms` and `updated_ms` = the newest product's own time (each CSV row's product id;
  IEM's `utc_prodissue` is the issuance product's time on every follow-up row), `ended_ms` = the newest product's
  expiry, `expires_ms` null, `max_category` from the H-VTEC severity (NWS's own forecast or observed category for the
  event), `gauges_in_flood` 0 (no reading kept), products `archived` with phase `ended`, IEM's event page as `url` and
  the issuing office as `sender_name` (NWS's own name when this server has seen it, else "NWS <office id>"),
  `products_in_effect` null. A past flood is never prepared as a 3D bundle (409 `PAST_NO_BUNDLE`), and its per-flood
  routes answer at its last product's time when asked without `at_ms`.
- **Per flood at a past time:** NWS products from IEM's `json/vtec_event.py` (on demand, at most 12 events, cached 30
  days once over), every version sent up to `at_ms` with the event's own segment verbatim and its `LAT...LON` polygon;
  gauge readings from USGS (`api.waterdata.usgs.gov/ogcapi/v1`, stage 00065 and flow 00060, provisional, no key) for the
  flood's span ± a few days (at most 40 days), NWS thresholds and impacts of today (`THRESHOLDS_TODAY`), no forecast
  (`PAST_NO_FORECAST`); NWS forecast maps and the National Water Model `not_available_for_past_dates`; satellite water
  from the passes of the 10 days before `at_ms` (2023 on).

### 8.11 A flood's time history (`fire3d/floods/timeline.py`; brief 6, decision 2)

Flood animation is made of real time steps only: satellite passes and NWS product versions. **Nothing is drawn
between two passes**, and no water is interpolated or invented between two images. User-facing strings are in
`fire3d/floods/copy_time.py` (under the PLAN-5 §5.1 wording guard).

- **Window** (`flood_window`): from 10 days before the flood's start to now; a past (year-list) flood from 10 days
  before its start to 3 days after its last NWS product. At most 45 days (the newest part is kept). The start is
  rounded down to midnight UTC, and the route takes the earlier of the live start and the start frozen in the flood's
  ready bundle, so Command and Forensic list the same passes when the live list refines the start (review BTD-R10). Before 2023
  (NASA's archive): `not_available_for_past_dates`, `PASSES_BEFORE_ARCHIVE`.
- **Passes:** one Earthdata GIS catalog search over the window (DSWx-HLS, cached 6 h); with `EARTHDATA_TOKEN` NASA's
  catalogue (CMR) adds DSWx-S1 radar passes and HLS passes Earthdata GIS has not loaded yet (PO.DAAC); `sources`
  (additive) credits each product and route listed (review BTD-R8). The tiles of
  one overpass are sensed up to a minute or two apart, so passes of one product and sensor less than 10 minutes apart
  are **one pass** (the key of the earliest; e.g. `DSWx-HLS_20261029T1756_L9`). At most 40 passes (`truncated`).
- **Each pass is read once**, locked to its own granules (`esriMosaicLockRaster`, so the image time is exact),
  cached 30 days: the route reads it on the satellite route's lon/lat grid (about 30 m, ≤ 1600 px) and makes its PNG
  and view shares from that read; the bundle reads it on the render grid. Shares over the whole area: `clear_pct`
  (seen clearly: not cloud, not no data), `cloud_pct`, `nodata_pct` (no data and outside the pass), `water_km2`,
  `partial_km2` (they include the river's normal water). `view`: `clear` (≥ 50 % seen clearly), `partly_hidden`,
  `no_view` (< 1 %: listed with `PASS_NO_VIEW`, `usable: false`, never drawn as water, and no PNG is made for it),
  `unknown` (not read yet or could not be read; the route says `PASSES_PARTIAL`, the bundle `PASSES_BUNDLE_UNREAD`). `shown_key`: the pass the satellite layer shows (the route's satellite answer
  or the bundle's `satellite.json`; it can be a no-view pass when that is what the satellite step chose), else the
  newest pass that saw at least half of the area clearly, else the clearest.
- **Polite reads:** at most 3 at a time; a read waits while fewer than 8 Earthdata GIS request slots (of 30 a
  minute) are left, so the satellite route's own probes never starve; a cached read never waits. The route waits at
  most `wait` seconds (default 20) and answers unfinished passes as `unknown` with `complete: false`; the reads go on
  in the background, so asking again a few seconds later completes the list. Measured 2026-11-05 (Moenkopi Wash,
  6 passes): 8 s cold, 0.03 s cached; one read about 3 s and 1 MB.
- **Bundle:** the newest 24 passes are read on the render grid (the build waits for request slots: it is a
  background job) and the classes of the 8 newest usable ones are kept as `layers/water_pass_<key>.bin` (1 MB each;
  gzip on the wire), each with its own FwDET depth estimate `layers/depth_pass_<key>.bin` (`depth_layer`; null when
  that pass maps no water or its water has no edge on open ground: no depth surface is shown for it); the others are
  listed with `layer: null` (`PASSES_BUNDLE_LIMIT`), passes not read stay `unknown` (`PASSES_BUNDLE_UNREAD`; nothing
  reads a bundle again, so `complete` stays true). `timeline.json` keeps the answer with `stats_over: "bundle_grid"`
  and no 2D image. **Forensic takes the pass list and the NWS products from `GET /timeline`** (live; the bundle's
  products are a frozen record that the live loop does not append to) and only the pass rasters from the bundle, joined
  by `key`; passes without a bundle raster are draped from the route's PNG (`image.bounds_lonlat`).
- **NWS products** (`product_history`): every event of the flood (its products' VTEC keys, at most 20, the newest
  events kept, `PRODUCTS_EVENTS_TRUNCATED`) from IEM's
  `json/vtec_event.py` (the issuance and every follow-up statement; one version per product segment carrying the
  event, its own text verbatim, its `LAT...LON` polygon; zone outlines from `geojson/vtec_event.py` for versions
  without one) plus NWS's live copies (CAP, in effect now). A live copy replaces the archived copy of the same version
  (same event, issued within 10 minutes, same action). Each version keeps its issuer, its own times, its verbatim
  text and its link (IEM's product page for archived copies, `archived: true`). `shown_from_ms` = its issue time;
  `shown_until_ms` = the earliest of its own end time and the next version's issue time (`replaced_ms`); CAN and UPG
  versions end at their own issue time; null = open (a river warning "until further notice"). `phase` follows from
  them at `now`. Measured 2026-11-05: St Johns River (5 events) 97 versions, 233 KB; Ducktown flash flood (4 events)
  12 versions. Archive down with the live copies read: `PRODUCTS_ARCHIVE_DOWN` (some events: `PRODUCTS_ARCHIVE_PARTIAL`);
  nothing read: `unavailable` with `ALERTS_UNAVAILABLE` (a past flood: `PAST_ALERTS_DOWN`), never "no product"; a
  flood with no product at all: `PRODUCTS_NONE`. An open flood whose live NWS feed could not be read: the archived
  copies with `PRODUCTS_LIVE_DOWN` (the newest may be missing; never an all-clear) and `complete: false`, so the
  answer is not kept (review BTD-R1). Caches (review BTD-R6): the passes block of a complete answer 10 min; the products
  block at most 2 min (the NWS alerts cache), made for every answer; a cached or frozen products block is served with
  every version's `phase` and `now_ms` of the moment it is served (the web draws a version from `shown_from_ms` until
  `shown_until_ms` at the playback time).

## 9. Frontend

### 9.0 Art direction (read this first)
There are two references, and each has a different job:
- **Layout and features:** `docs/reference/firetrace-demo.png`. It shows the header, the right panel
  (Layers / Incident Overview / Weather), the bottom timeline, key events, three charts, and map controls.
- **Look:** `docs/reference/art-direction.png`. A cinematic "digital twin":
  - photographic terrain (moss, rock and vegetation micro-detail) in a dark, moody green-black atmosphere;
  - a luminous **golden parametric lattice** (dot grid / wire mesh) draped over the relief;
  - a glowing data "river of light";
  - floating **monospace numeric readouts**;
  - shallow **depth of field with bokeh**, soft bloom, film grain.

  It is **realistic and parametric at the same time**. View both images before writing any visual code, and keep
  comparing against them.

The look applied to wildfire data:

- **Realistic layer = the real place.**
  - Terrain: the NAIP aerial photo, colour-graded toward desaturated moss/olive greens and stone greys; DEM relief
    with soft sun shadows and sky-view ambient occlusion (`sky_view.bin`); procedural micro-detail by slope, fuel
    and canopy (rock on steep slopes, grass/scrub texture, dark canopy).
  - Instanced trees from LANDFIRE canopy.
  - Water with sun glints and sparkle (`water.bin`).
  - Aerial-perspective haze.
  - Fire is physical: charred ground (from arrival time, plus dNBR when available), an incandescent flame front
    with flicker, drifting embers, and **smoke plumes that drift with the real wind**.
- **Parametric layer = the data.**
  - A golden **dot lattice** draped on the terrain. Spacing adapts from about 30 to 120 m. Dot size and brightness
    encode `latticeField`:
    - fire **activity** (default): how recently each spot burned, plus front proximity;
    - forecast **probability**;
    - **elevation**, **slope** or **canopy**.
  - **Elevation contour lines.**
  - **Fire isochrones**: lines of equal arrival time every 1, 3, 6 or 12 h depending on zoom and fire duration.
    They tell the parametric story of the spread.
  - Forecast probability as a luminous field with crisp 10/50/90 % contours.
  - The active front as a bright filament.
  - **Telemetry columns**: small gold monospace text, with a subtle flicker only when values change. They are
    anchored at the ignition, the active front's main clusters, and a hover probe.
    - Real values only: lat/lon, elevation, arrival `T+hh:mm`, local ROS, FRP, wind, burn probability.
    - Never fake binary.
  - A one-time scan-sweep animation when an incident loads.
- **Visual modes** (`visualStyle`):
  - `hybrid` (default): realistic terrain, with the parametric lattice concentrated over the fire area and fading
    out radially, as in the reference (the lattice covers the valley and fades on the slopes). Isochrones and
    telemetry sit on top; dark atmospheric sky.
  - `realistic`: no lattice or telemetry. Natural golden-hour light, a sky gradient with sun glow, smoke and flames
    emphasized.
  - `parametric`: terrain reduced to dark relief (near-black with faint hillshade); everything drawn as glowing
    points and lines. The purest digital-twin look.
- **Palette:**
  - sky/background: deep green-black gradient `#060A08 → #111A14`
  - lattice gold: `#E8C77E` (core) → `#B08A45` (falloff)
  - fire: `#FFF3C4 → #FFB347 → #FF6A2B → #B8321A` (embers)
  - burned ground: charcoal `#16130F` with a warm undertone
  - probability ramp: transparent → gold → orange → red
- **Camera and post-processing:**
  - Tone mapping (AgX or ACES) with a filmic grade: lifted green-black shadows, warm highlights.
  - Bloom only on emissive things: fire, lattice, telemetry, water glints.
  - Depth of field with bokeh, auto-focused on the camera target. Toggled by `dof`; off in 2D.
  - Vignette, subtle film grain, fog/aerial perspective.
  - The square AOI edge must never read as a hard border: terrain fades into the dark fog over the outer ~8%.
- **Motion:** gentle lattice shimmer, front flicker, ember and smoke drift, telemetry ticking only when values
  change. Calm when idle. Honour `prefers-reduced-motion`.

### 9.1 Stack
- Vite + React 19 + TypeScript, `three`, `@react-three/fiber`, `@react-three/drei` (`<Text>`/troika for 3D
  telemetry), `@react-three/postprocessing` (Bloom, DepthOfField, Vignette, Noise, ToneMapping, SMAA), `zustand`,
  d3 (`d3-scale`, `d3-shape`, `d3-array`, `d3-time`) for SVG charts, `lucide-react` icons.
- Fonts: **Inter** (UI) + **JetBrains Mono** (numbers, coordinates, timestamps, telemetry) from Google Fonts in
  `index.html`, with tabular numerals.
- No other UI framework. Plain CSS (CSS variables) or CSS modules.

### 9.2 Store (`state/store.ts`, Contract)
```ts
type LayerKey = "terrain" | "imagery" | "trees" | "fuels" | "burnScar"
              | "observedFire" | "isochrones" | "forecast" | "detections" | "perimeters" | "smoke" | "ignition"
              | "lattice" | "contours" | "telemetry"
              | "wind" | "aircraft" | "profilePath";
interface LayerState { visible: boolean; opacity: number }      // opacity 0..1
type VisualStyle = "hybrid" | "realistic" | "parametric";
type LatticeField = "activity" | "probability" | "elevation" | "slope" | "canopy";
interface AppState {
  mode: Mode;
  catalog: { live: IncidentSummary[]; historical: IncidentSummary[]; loading: boolean; error: string | null };
  incidentId: string | null;
  summary: IncidentSummary | null;
  manifest: IncidentManifest | null;
  job: JobStatus | null;
  forecastRunId: string | null; forecast: ForecastManifest | null;
  timeseries: TimeseriesFile | null; events: EventsFile | null; weather: WeatherFile | null;
  detections: DetectionsFile | null; perimeters: PerimetersFile | null;
  timeMs: number; playing: boolean; speedHoursPerSec: number;
  timeWindow: { startMs: number; endMs: number } | null;       // visible timeline window
  viewMode: "3d" | "2d"; visualStyle: VisualStyle; latticeField: LatticeField;
  exaggeration: number; treeScale: number; dof: boolean; quality: "high" | "medium" | "low";
  panelsCollapsed: boolean;                                     // hide UI chrome for a cinematic view (key "H")
  layers: Record<LayerKey, LayerState>;
  aircraft: Aircraft[]; aircraftUpdatedMs: number | null;      // UI polls /aircraft every 10 s (live); scene renders
  profilePath: [number, number][]; drawingPath: boolean;
  selectedEventId: string | null;
  flyTo: { x: number; z: number; distance?: number; nonce: number } | null;
  rightTab: "layers" | "analysis" | "evidence" | "notes";
  // actions: setters + async loaders (loadCatalog, selectIncident, startBuild, startForecast, selectForecast, refreshManifest)
}
```
- **Defaults:** visualStyle `hybrid`, latticeField `activity`, exaggeration 1.5, treeScale 1, dof true, quality
  `high`.
  - Visible: terrain, imagery, trees, observedFire, isochrones (0.8), forecast (0.85), detections (0.9),
    perimeters (0.6), smoke (0.8), ignition, lattice (0.9), contours (0.35), telemetry, aircraft, profilePath.
  - Hidden: fuels, burnScar, wind.
- Large binary arrays never go in the store; `lib/raster.ts` caches them by URL.
- During playback the scene reads time with `useStore.getState()` inside `useFrame`.
- Scene-only transient state (hover probe, FPS, focus distance) lives in `scene/sceneStore.ts`.

### 9.3 Scene (`scene/`, R3F)
- **Terrain mesh:** `PlaneGeometry(extent, extent, 1023, 1023)` in XZ, displaced on the CPU from `elevation.bin` ×
  exaggeration. Normals are computed once per incident or exaggeration change. Edge fade per §9.0.
- **One custom terrain shader** with these components:
  - **Realistic shading:**
    - Albedo: graded NAIP when `imagery` is on, else a procedural realistic palette from fuels and canopy.
    - Plus triplanar/procedural micro-detail and a detail normal by slope, fuel and canopy.
    - Lighting: sun + hemisphere sky × `sky_view` AO + soft shadow map + aerial perspective.
    - Water (`water.bin`): darker, reflective, with animated sparkle that blooms.
  - **Parametric style:** dark relief with faint hillshade; contours and isochrones emphasized.
  - **Observed fire:** with `a` = observed arrival and `t` = time (hours):
    - a ≤ t: charred. Charcoal and ash albedo, ember glow decaying over ~6 h, dNBR-modulated darkness when
      available.
    - t − 0.75 h < a ≤ t: an incandescent flame front with animated flame-tongue noise, emissive so it blooms.
    - a > t: untouched.
  - **Isochrones:** thin gold-white lines where `fract(a / step)` crosses, only for a ≤ t. Brighter every 4th
    line; the current front is the brightest filament.
  - **Contours:** elevation lines via `fwidth` anti-aliasing. Interval 10/20/50/100 m by extent; index contour
    every 5th.
  - **Forecast:** P(burned by t) piecewise-linear from p10/p50/p90. Shown as a luminous field (hybrid/parametric)
    or a translucent heat wash (realistic), with crisp 10/50/90 % contours and a dimmer, dashed p50 front.
  - **Burn scar:** dNBR ramp overlay.
  - **Fuels:** FBFM40 colour overlay (data-viz palette in `lib/fuels.ts`).
  - All layer opacities are uniforms.
- **Parametric lattice:** `THREE.Points` on a regular grid (256²/384²/512² by quality) draped 2 m above the
  terrain, with a custom shader:
  - Size and brightness from `latticeField`. Activity = recency of burning + front proximity + forecast
    probability ahead of the front.
  - Radial falloff around the fire centroid in hybrid; full extent in parametric.
  - Distance attenuation, subtle shimmer, additive blending.
  - Every 4th row is optionally connected as faint gold wire lines (the reference's mesh lines).
- **Trees:** InstancedMesh variants: conifer (stacked cones), broadleaf (lumpy blob), shrub (flattened blob).
  - Per-instance moss-green colour variation and base AO; shadow casting at high quality.
  - The vertex shader samples arrival: burned → charred black, shrunk 60%; on the front → emissive.
  - Respects treeScale and exaggeration.
- **Smoke:** instanced soft billboards with a procedural noise texture.
  - Emitted from active-front clusters at the current time and from FRP-weighted recent detections.
  - Rises and drifts with the interpolated wind, lit by the sun. Density scales with active length/FRP.
  - Alpha-blended, never bloomed.
- **Embers:** GPU points spawned along the front, rising and drifting downwind.
- **Detections:**
  - Realistic: small hot-pixel glows sized by FRP.
  - Parametric/hybrid: true-size footprint squares (375 m VIIRS, 1 km MODIS) outlined in gold/orange.
  - Coloured by age (≤ 12 h bright → dim). GOES points are drawn only as faint large halos (2 km) when
    `detections` is on and zoomed out.
- **Perimeters:** thin luminous draped lines; older ones dimmer; the latest ≤ t highlighted.
- **Ignition:** bright point + additive flare + monospace label.
- **Telemetry:** drei `<Text>` columns (3–8 lines, JetBrains Mono, gold, ~70% opacity), billboarded. Anchors:
  ignition, the top-3 active front clusters (centroid of pixels with t − 1 h < a ≤ t), and the hover probe.
  - Probe: raycast the terrain to get lat/lon, elevation, fuel model name, arrival time or "unburned", P(burn), and
    slope.
  - Values update when time changes by ≥ 10 min of simulation time; digits "tick" briefly.
- **Wind:** ~3000 particle streaks from the 4×4 u/v grid at the current time; gold-white in parametric, faint white
  otherwise.
- **Profile path:** a draped gold polyline with click-to-draw (raycast; Esc or double-click ends) that writes
  `store.profilePath`.
- **Aircraft:** small glowing heading-oriented icons (fixed-wing / rotor), category accents, monospace callsign
  labels, 5-minute trails, smoothed interpolation.
- **Sky/background:** gradient dome in palette colours. In realistic mode, a warm sun glow near the horizon.
- **Camera:** MapControls/OrbitControls with damping.
  - Initial oblique view from the south-south-east framing the fire bbox; 2D = top-down; `flyTo` animates.
  - DOF focus follows the orbit target.
- **HTML overlays** (dark glass style §9.5):
  - compass (rotates with azimuth; click resets north) and scale bar;
  - 2D/3D toggle, exaggeration select, quality select, DOF toggle, fullscreen;
  - probe readout near the cursor (hybrid/parametric).
- **Post-processing:** Bloom (luminance threshold so only emissive glows), DepthOfField (bokeh), Vignette, Noise
  (film grain, subtle), ToneMapping, SMAA.

### 9.4 UI layout (structure of the demo, chrome of the art direction)
- The **3D canvas is full-bleed** (whole window). UI panels float above it as dark glass.
- `panelsCollapsed` (key **H** or a button) hides everything except a minimal top bar for a cinematic view.
- **Header (≈52 px, floating, full width):**
  - Logo mark + "Disaster Mapping" (brief 6; the brief-2 tagline is gone).
  - Incident picker: dropdown with a **Live / 2025** segmented control and search. Rows show name, acres,
    containment, start date, status chip, and bundle status (ready / build needed / building). The 2025 list has
    a ≥ 100 ac toggle.
  - Location; date range in monospace.
  - Tabs "Incident" | "Aircraft (n)" (live only).
  - View menu: Hybrid / Realistic / Parametric, lattice field, 2D/3D, exaggeration, tree scale, DOF, quality.
  - Analysis menu; Share (copies a `?incident=&t=&mode=` link); settings.
- **Right panel (~360 px, floating, from below the header to the bottom margin):**
  - Tabs **Layers** (grouped: Base · Fire · Parametric · Live & Atmosphere). Each row: checkbox, small swatch,
    label, opacity slider, %. Unavailable layers are greyed with a tooltip.
  - **Analysis:**
    - Forecast runner: start = the current timeline time (historical) or now (live); horizon 24/48/72 h; ensemble
      Auto / GFS 31 / ECMWF 51 / Perturbed / None. Shows progress.
    - Run list. Selected-run summary: p50 area at +24/48/72 h with the p10–p90 range.
    - Skill table for hindcasts.
    - Disclaimer: "Research prototype — not for operational use".
  - **Evidence:** data sources with fetch times; detection counts by satellite/instrument; perimeter list that
    jumps the timeline; warnings.
  - **Notes:** a textarea saved to localStorage per incident.
  - **Incident Overview** card: name, incident ID, location, start, end/containment, total acres, cause, analysis
    status.
  - **Weather & Fire Behavior (at fire front)** card at the current time: wind mph + cardinal (degrees), temp,
    RH, fuel moisture (1-h), FFWI, flame length. Numbers in monospace.
- **Bottom dock (floating, left of the right panel):**
  - **Timeline:**
    - Play/pause/step; speed in hours/sec (0.5, 1, 3, 6, 12, 24).
    - Scrubber with a time bubble, day/6-hour ticks, event markers.
    - Hatched forecast region after the **Now** marker.
    - Window presets: All / 7 d / 72 h + forecast.
  - **Key Events** list: icon per type, title, local time. Click → set time + fly to. "+ Add" annotations.
  - **Charts row:**
    - Fire Area (acres): observed + forecast p10–p90 band + p50.
    - Rate of Spread (chains/hr), with an optional GOES FRP overlay.
    - Elevation Profile (selected path): elevation along `store.profilePath`, burned portion at the current time
      shaded, fire position marker.
    - All charts carry a time cursor synced to the timeline.
- **Overlays:**
  - Build/forecast progress (step, %, message).
  - Empty states (no live fires; bundle not built → Build button).
  - Errors with retry.
  - "Not for operational use" in the Analysis tab and footer.
- **Default selection:** the largest live incident with a ready bundle; else the Eaton Fire 2025. Unbuilt
  incidents auto-build with the progress overlay. Live mode polls the manifest every 60 s and refetches files when
  `built_ms` changes.

### 9.5 Look and feel (dark, matches the art direction)
- **Panels:** translucent dark glass `rgba(9,14,11,0.72)` + `backdrop-filter: blur(14px) saturate(120%)`;
  1 px hairline borders `rgba(232,214,170,0.12)`; radius 10 px; soft shadow.
- **Colour tokens:** text `#ECE6D6`, secondary `#9BA394`, muted `#6B7468`, accent gold `#E2BE72`, fire `#FF6A2B`,
  danger `#E5483A`, ok `#8FBF7A`, warn `#F0A35E`.
- **Typography:** Inter 12–13 px for UI; JetBrains Mono for all numbers, coordinates, times, telemetry and table
  values (tabular-nums).
- **Charts:** dark background, hairline grid `rgba(255,255,255,0.06)`, gold observed series, fire-orange forecast
  with a translucent band, gold time cursor.
- **Controls:** minimal; gold focus rings; sliders with gold fills; tabs with a gold underline.
- Professional and dense: a scientific instrument with a cinematic finish, never a game UI.

### 9.6 Performance rules
- **Quality levels:**
  - `high`: DPR ≤ 2, shadow map 4096, DOF on, all trees, lattice 512².
  - `medium`: DPR 1.5, shadows 2048, DOF on, 60% trees, lattice 384².
  - `low`: DPR 1, no shadows, no DOF, 30% trees, lattice 256².
  - Auto-suggest `medium` if FPS < 30 for 5 s.
- Target ≥ 50 fps on an M-series Mac at `high` for a 12 km AOI.
- Upload textures once per file. No per-frame allocations in `useFrame`. Build terrain displacement, tree
  instancing and the lattice once per incident or exaggeration change.
- Arrival textures: HalfFloat + LinearFilter; clamp NEVER to 60000 before conversion.

## 10. Testing and verification

- **Backend:** `cd backend && uv run pytest -q`. Covers the pure functions: grid transforms, moisture, FFWI,
  quantile semantics, arrival interpolation on synthetic snapshots, aircraft classification, pyretechnics
  conventions on synthetic terrain. Tests are offline and fast (< 60 s total).
- **Network smoke scripts** live in `fire3d/cli.py`:
  - `uv run python -m fire3d.cli catalog --mode live|historical`
  - `… build <id-or-name> [--force] [--require-hrrr]` (`--require-hrrr` fails instead of filling with ERA5; every
    build prints the HRRR / GFS / ERA5 hour counts)
  - `… weather-probe` (one uncached request per Open-Meteo host; exit 0 only when historical builds can run)
  - `… forecast <id> [--start ISO] [--horizon 72] [--ensemble auto]`
  - `… hindcast <id> --start ISO`
  - `… serve`
- **Fixture:** `uv run python scripts/make_fixture.py` writes a synthetic, contract-complete bundle
  `data/incidents/fixture-demo/`. `uv run python scripts/serve_fixture.py --port P --data-dir D` is a standalone
  server for the §6 read endpoints that does not import `fire3d.api`. Frontend agents develop against it.
- **Floods (brief 5):** the flood tests (`tests/test_flood*.py`, `tests/test_floods_*.py`, 380 cases) are offline: a
  session fixture writes `fixture-flood` into `tmp_path` with `make_fixture.py`'s flood builder at
  `--now 2026-11-04T18:00:00Z`, so no flood test depends on `data/` or skips; recorded NWS / NOAA / IEM / USGS answers
  live in `tests/data/floods/`. `test_flood_contracts.py` checks the field names, optionality and literals of
  `contracts.py` against `web/src/api/floodTypes.ts`; `test_floods_copy.py` checks the backend strings against
  CONTRACT §16.14 and the banned words (PLAN-5 §5.1); `test_floods_list_cost.py` caps a cold list build at 6 upstream
  requests; the token path is tested with a fake `EARTHDATA_TOKEN` and a mock transport only. Fixture:
  `make_fixture.py --only flood [--now ISO]` writes `data/floods/fixture-flood/` and its canned answers;
  `serve_fixture.py` also answers the seven synthetic demo floods. Web: `ui/shell/floodCopy.test.ts` (the wording
  guard over every flood copy file and the rendered fixture cases, verbatim text stripped), `map/floodStyle.test.ts`
  (no green), `state/floodFetchSpy.test.ts` (no fire-only request from a flood chrome). `scripts/check_bundle.py
  --hazard flood <id>` checks a built flood bundle (brief 6: also the pass and terrain layers and `timeline.json`).
- **Floods, brief 6:** `test_floods_timeline.py` (window, overpass merging, one read per pass, no-view passes marked,
  unfinished reads `unknown`, polite waits, product versions and their shown periods from the recorded IEM events,
  archive outages never "no product", the fixture route, the bundle's `timeline.json` and pass rasters; the wording
  guard over `copy_time.py`) and `test_floods_terrain3d.py` (encoding, the boost rule, relief near the water, HAND on a
  V valley and on the fixture valley of known height, FwDET on a bathtub of known depth, edges against clouds and the
  border, every missing-product reason, the build step with mocked river lines, `scripts/flood_3d.py` on the fixture).
- **Frontend:** `cd web && npm run build` must pass (tsc + vite).
  `node scripts/shot.mjs <url> <out.png> [--wait ms] [--w 1720 --h 1080]` takes a screenshot with the installed
  Chrome (headless; it tries GPU flags and falls back to SwiftShader) and prints console errors. Inspect screenshots
  with the Read tool.
- **Ports:** integration uses API **8710** / web 5173 (8000 is occupied by an unrelated app; see §6). Module
  agents use only the ports their prompts assign. Wherever a prompt says "port 8000" for the Disaster Mapping API,
  use 8710.
- **Scene isolation:** the scene agent develops in `web/scene-dev.html` + `web/src/scene/dev/`, a standalone page that
  mounts only `<Scene/>` and loads the fixture into the store itself. App.tsx supports `VITE_SCENE=off`, which
  renders a placeholder instead of `<Scene/>`, so UI work isn't blocked by scene work in progress.

## 11. Out of scope for v1
WeatherNext 3, WindNinja terrain winds, the Hugging Face ML models (side-by-side later), deployment, user accounts,
suppression data, GOES 5-minute detections.
