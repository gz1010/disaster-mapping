# Audit 5: flood data sources (brief 5)

Role `audit-sources-floods` (brief 5, stage "audit and research"). Documents only: no app code changed, no bundle
built, no server started, no secret read or used. Checked **2026-11-04, 19:51-20:25 UTC** from the cloud session, with
about 230 polite GETs (curl, one at a time, User-Agent `Fire-3d research prototype (flood source audit)`; the biggest
was one 12.6 MB national gauge list). There is no `EARTHDATA_TOKEN` in this environment, so no authenticated NASA
download was tried; section 6.4 says what one needs. The evidence log is section 10. The backend audit
(`audit-5/backend.md`, cited as BE-x) covers how the code would use these sources; this file covers the sources
themselves. Where the two differ, this file has the newer measurement (see the note in section 0).

## Words used here (plain)

- **NWS product**: a message from a National Weather Service office (a **WFO**, such as "NWS Quad Cities"), for
  example a Flood Warning. NWS's own web feed of them is **api.weather.gov** (the **CAP** format).
- **VTEC**: a code line inside each product, such as `/O.EXT.KDVN.FL.W.0092.261105T0712Z-261107T1230Z/`. It says
  which office (`KDVN`), what kind of hazard (`FL` river flood), how serious (`W` warning), and an event number
  (`0092`). Every update of the same flood warning keeps the same code, so it is how messages are grouped.
- **H-VTEC**: a second code line, only in flood products. For a river warning it names the **river gauge**
  (`SIGI4`), the expected severity (1 minor, 2 moderate, 3 major), the cause (ER = excessive rain) and the flood
  begin, crest and end times.
- **Gauge / LID / NWSLI**: a river measuring station. NWS calls it by a 5-character id (LID or NWSLI, for example
  `ARCF1`, Peace River at Arcadia, Florida). USGS, which runs most of the sensors, uses an 8-15 digit site number
  (`02296750`).
- **Stage**: the water level at a gauge, in feet. **Flow** (discharge): how much water passes, in cubic feet per
  second (cfs) or thousands of cfs (kcfs).
- **Flood categories**: fixed stage thresholds set per gauge by NWS: action, minor, moderate, major (and record).
- **RFC**: one of NWS's 13 River Forecast Centers. They make the **official river forecasts** (NOAA: "approximately
  4000 locations across the CONUS"); the local WFO issues them.
- **NWM**: NOAA's National Water Model, a computer model of every stream ("3.2 million stream reaches", NOAA). It is
  **model guidance, not an official forecast** (NOAA's own words, section 2.6).
- **FIM**: a flood inundation map, a polygon of where water is expected, made by NOAA from a stream flow and the
  height of the land above the nearest stream (**HAND**).
- **AEP**: annual exceedance probability. A "10 % AEP" flow is one expected to be reached in about 1 year in 10.
- **OPERA DSWx**: NASA's map of surface water seen by satellite, 30 m pixels. **DSWx-HLS** uses optical images
  (Landsat and Sentinel-2: blind under clouds); **DSWx-S1** uses Sentinel-1 radar (sees through clouds).
- **MGRS tile**: the 109.8 km square of the satellite grid each DSWx file covers. **COG**: a GeoTIFF laid out so a
  program can read just part of it.
- **NFHL / SFHA**: FEMA's National Flood Hazard Layer, the flood insurance maps. The Special Flood Hazard Area is the
  "100-year" (1 %-annual-chance) floodplain.

## 0. Summary

| # | Source | Verdict | Why, in one line |
|---|---|---|---|
| 1 | NWS alerts, api.weather.gov | **Use** | Official, free, one national request; flood warnings carry polygons; watches need zone shapes |
| 1b | IEM archive of NWS products | **Use** (past floods, river ids) | Every past flood event per state per year, **with the river gauge id**, polygons and text; not official, labelled archived |
| 2 | NWPS API, api.water.noaa.gov/nwps/v1 | **Use per gauge**; **do not use for the national list** | Gauge detail, impacts, crests, 30 days of observations and the official RFC forecast are excellent; the bbox list failed (HTTP 504 after 60 s) in 2 of 5 tries |
| 2b | NWS map service `riv_gauges` | **Use** (national gauge status) | Every gauge's observed and forecast flood category in one 0.2 s request; found during this audit |
| 3a | `rfc/rfc_based_5day_max_inundation_extent` | **Use with care** | The only forecast flooded-area map built from the official RFC forecast, but NOAA calls it **experimental**; covers the lower 48 in practice |
| 3b | `rfc/rfc_max_forecast` | **Use** | National list of official forecast points at action stage or above (89 today), with RFC, issuing office and times |
| 3c | `nwm/*` (high flow, rapid onset, inundation) | **Use with care, as model output only** | Hourly to 6-hourly model guidance; must never sit with official layers |
| 3d | `fim_libs/static_stage_based_catfim` | **Use with care** | Static library: what each official flood category would cover near a gauge; experimental |
| 3e | `flash` folder | **Do not use** | Needs a token ("Token Required", HTTP 499) |
| 4 | USGS Water Data OGC API | **Use with care** (history, per gauge) | Measured stage and flow back years; **v1 is now current**; without a key the shared cloud address hit the limit (HTTP 429) |
| 4b | Legacy USGS WaterServices (NWIS) | **Do not use** | Slowed from Nov 16, 2026; shut down **Feb 22, 2027** |
| 5 | FEMA NFHL | **Use with care** (background only) | Official 100-year floodplain; connection resets in 8 of 14 tries; insurance map, not a flood forecast |
| 6a | OPERA DSWx-HLS, NASA Earthdata GIS ImageServer | **Use** (no login) | **Measured water classes at 30 m without any login** (new finding); one day behind NASA's archive |
| 6b | OPERA DSWx-HLS and -S1 via PO.DAAC (CMR + download) | **Use when `EARTHDATA_TOKEN` is set** | Search works without login; files need the token; S1 radar sees through clouds |
| 6c | OPERA DSWx via NASA GIBS tiles | **Use** (picture only, no login) | Daily coloured tiles for HLS and S1; good for the overview, no numbers |
| 6d | VIIRS flood (GMU) via SSEC RealEarth | **Do not use** | Free tier is volume-limited with watermarks, paid tiers above it ("no paid map services") |
| 6e | Copernicus GFM API | **Do not use** | Needs an account (HTTP 401); not an approved secret |
| 7 | Terrain: USGS 3DEP, Mapterhorn | **Use** (already in the app) | Cover the lower 48; 3DEP rivers are flattened water surfaces, fine for draping extents |
| 7b | NWM flowlines (river lines) | **Use** | Fast; their `feature_id` joins the FIM polygons and NWM layers |
| 7c | USGS NHD / NHDPlus HR services | **Do not use now** | NHD query timed out twice at 60 s |

Key findings, in order of impact on the build:

1. **A national flood list is cheap and reliable without the NWPS bbox query** (confirms BE-0). Three requests:
   NWS flood products (one request), `riv_gauges` layer 0 filtered to minor/moderate/major (30 gauges today, 19 KB,
   0.2 s), and `rfc_max_forecast` (89 forecast points at action or above). The NWPS bbox list answered in 45 s once
   for the whole lower 48 (12,362 gauges, 12.6 MB) but then failed with **HTTP 504 after 60 s** for half of it and
   for a 10°×8° tile.
2. **The river gauge of a river flood warning is not in api.weather.gov's alert JSON.** It is in the H-VTEC line of the
   product text (`/products/{id}`), and IEM lists it as `hvtec_nwsli` for every live and past event.
3. **Measured satellite water works without the NASA login.** NASA's own Earthdata GIS serves DSWx-HLS water classes
   (0 not water, 1 open water, 2 partial water, 252 snow/ice, 253 cloud, 254 ocean, 255 no data) as a 30 m GeoTIFF through
   `exportImage`, from January 2023 to about one day behind NASA's archive. The backend audit (BE-0) assumed the
   token was needed for measured pixels; it is needed only for the radar product (DSWx-S1) and for the newest day.
4. **Every satellite water map is days old.** At the check, the newest DSWx-HLS image over the lower 48 was taken
   2026-10-31 19:22 UTC (4 days old) and the newest DSWx-S1 2026-11-02 00:05 UTC (3 days). Products are made 30-33 h
   (HLS) and 14-44 h (S1) after the satellite pass. The UI must show the image time, never "now".
5. **NOAA's forecast flooded-area maps are labelled experimental by NOAA**, and their service text still says "30 % of
   the U.S. population"; NOAA's operations page says "nearly 100 %", and features exist in Missouri, Iowa, Arizona,
   Colorado and Florida. Label them "Experimental NWS forecast flood map" with the RFC forecast time.
6. **NWM `recur_cat` is a probability in percent, not years.** `">50"` means the flow is above the model's
   high-water threshold but more likely than 1 year in 2 (below the 2-year flow); `"10"` means a 10-year flow. All
   1,071 rows checked fit this reading.
7. **USGS moved to v1** of its Water Data APIs (Sep 4, 2026). v0 still answers; most v0 endpoints are being
   redirected, and all of v0 by mid-2027. Use `/ogcapi/v1/`.
8. **NWS has proposed retiring VTEC** (PNS 26-62, Sep 1, 2026, comments closed Sep 21) in favour of CAP only. Today
   every flood product still carries VTEC; the grouping should keep a fallback on CAP's own `references` chain.
9. **FEMA's own words can break our wording rule.** NFHL zone X carries the subtype "AREA OF MINIMAL FLOOD HAZARD".
   Show only the floodplain (SFHA) and the 0.2 % band, never "minimal hazard" areas (section 5.5).

---

## 1. NWS alerts (api.weather.gov) and the IEM archive

### 1.1 Endpoints

| Use | Request | Seen today |
|---|---|---|
| Active flood products, national | `GET https://api.weather.gov/alerts/active?event=Flood Warning,Flash Flood Warning,Flood Watch,Flood Advisory,Flood Statement,Flash Flood Statement,Flash Flood Watch` (add `&area=<the 48 states + DC>` as `nws.national_url` does) | 200, 0.9 s. With coastal and lakeshore types too: 49 products (35 Flood Warning, 6 Flood Advisory, 1 Flash Flood Warning, 4 Coastal Flood Advisory, 3 Coastal Flood Statement). The 42 inland ones match the brief's count; 4 of them (3 advisories and the Flash Flood Warning) are in Puerto Rico and drop out of a lower-48 filter |
| Flood event names NWS uses | `GET /alerts/types` | 16 flood names: Flood Warning/Watch/Advisory/Statement, Flash Flood Warning/Watch/Statement, Coastal Flood ×4, Lakeshore Flood ×4, Hydrologic Outlook |
| Past 7 days | `GET /alerts?start=…&end=…&event=…` (as `nws.past_local` does) | not re-tested; NWS keeps about 7 days (brief 3) |
| A zone's outline | `GET /zones/county/IAC011` (warnings), `/zones/forecast/{UGC}` (watches, coastal) | 200, 7 KB, one Polygon |
| Product text (for H-VTEC) | `GET /products/types/FLS/locations/DVN`, then `GET /products/{id}` (`productText`) | 200; the FLS of 17:18 UTC carried `/SIGI4.1.ER.261105T0712Z.261105T1800Z.261107T0430Z.NO/` |

### 1.2 Fields we need (CAP alert, `features[].properties`)

`id` and `@id` (link), `event`, `messageType` (Alert / Update / Cancel), `sent`, `effective`, `onset`, `expires`,
`ends`, `senderName` ("NWS Quad Cities IA IL"), `headline`, `description`, `instruction` (all verbatim),
`areaDesc`, `geocode.UGC` and `geocode.SAME`, `affectedZones`, `references` (earlier messages of the same event),
`severity`, `certainty`, `urgency`, and `parameters`:

- `VTEC` (always present today, 49/49), `NWSheadline`, `eventEndingTime` (42/49), `AWIPSidentifier` ("FLWGID"),
  `WMOidentifier`, `expiredReferences`;
- flash floods only: `flashFloodDetection` ("RADAR INDICATED" / "OBSERVED"; 1/1 today) and, when the office uses
  it, `flashFloodDamageThreat` ("CONSIDERABLE", "CATASTROPHIC": the Flash Flood Emergency tag).

The `description` follows the WHAT / WHERE / WHEN / IMPACTS / ADDITIONAL DETAILS layout. For a river warning it
states the current stage, flood stage and forecast crest in words ("Flood stage is 15.0 feet", "a crest of 16.5 feet
Friday evening"). Quote it; do not parse numbers from it (NWPS has them as data, section 2).

### 1.3 VTEC and grouping

P-VTEC: `/k.aaa.cccc.pp.s.####.yymmddThhnnZ-yymmddThhnnZ/` (NWS "VTEC explanation" version 9.0, March 2025,
<https://www.weather.gov/media/vtec/VTEC_explanation_ver9.pdf>, read 2026-11-04). Flood phenomena and significance:

| Code | Meaning | Geometry in the CAP feed | Gauge (H-VTEC) |
|---|---|---|---|
| `FL.W` | Flood Warning for a forecast point (river) | polygon along the river reach | yes, NWSLI |
| `FL.Y` / `FL.A` | river Flood Advisory / Flood Watch for a point | polygon (advisory); watch not seen today | yes |
| `FA.W` | Flood Warning for an area ("areal", rain-driven) | polygon | `00000` (none) |
| `FA.Y` | Flood Advisory (areal; "urban and small stream") | polygon | none |
| `FA.A` | Flood Watch (areal; most flash flood watches are now issued as Flood Watches: Texas 2025 had 98 `FA.A`, 1 `FF.A`) | **null**, zones only | none |
| `FF.W` | Flash Flood Warning | polygon | none (`OO`) |
| `CF.*`, `LS.*` | Coastal / Lakeshore flood | **null**, forecast zones only | none |
| `HY.O` | Hydrologic Outlook | informational, not an event | none |

- **Event key = (office, phenomena, significance, ETN, year).** The ETN restarts every year, so the year must be in
  the key (IEM uses the same key; `nws.ArchiveEvent.key`). One event can arrive as several CAP alerts (one per text
  segment or zone group: `KMTR.CF.Y.0015` came as 3 alerts today), so group CAP alerts by this key.
- **Statements are updates.** Follow-up statements (product FLS for river warnings, FFS for flash floods) arrived as
  `event: "Flood Warning"`, `messageType: "Update"` with action `CON` or `EXT` on the same key. No alert named "Flood
  Statement" or "Flash Flood Statement" was in effect today, though both names exist in `/alerts/types`.
- **A "flood" (brief decision 1)** groups events per river or area: river events through their gauge's river name
  (`riv_gauges.waterbody`, or the NWPS gauge `name` "Iowa River at Marengo"); areal and flash events through
  overlapping polygons and times, named from the text ("Flooding along the Conejos River and San Antonio River").
- **Risk: VTEC may be retired.** NWS PNS 26-62 (Sep 1, 2026, <https://www.weather.gov/media/notification/pdf_2026/PNS26-62_CAP_Transition.pdf>)
  proposes "transition entirely to the CAP message format … and potentially discontinuing the use of VTEC", listing
  FFA, FFW and FLW among the affected products; CAP would "continue to include elements of the VTEC coding such as
  event tracking". Keep a fallback key: the chain of CAP `references` identifiers.

### 1.4 Polygons versus zones

- Warnings and advisories (`FL.W`, `FA.W`, `FF.W`, `FA.Y`, `FL.Y`) had a polygon in the CAP feed: all 42 inland
  products today (4 of them in Puerto Rico). The polygons are coarse (126-271 characters of GeoJSON, a few vertices along the river).
- Watches and coastal or lakeshore products have `geometry: null`. Their area is the union of their zones:
  `affectedZones` gives URLs such as `https://api.weather.gov/zones/county/IAC011` (county, `C` in the UGC) or
  `/zones/forecast/FLZ076` (forecast zone, `Z`). `nws.nws_zone` already fetches and caches zone outlines (30 days);
  it needs the zone type taken from the URL instead of the fixed "fire".

### 1.5 Affected rivers (gauge ids)

- **Not in the CAP JSON.** `parameters` has no H-VTEC (keys today: AWIPSidentifier, WMOidentifier, BLOCKCHANNEL,
  VTEC, NWSheadline, eventEndingTime, EAS-ORG, expiredReferences, flashFloodDetection).
- **In the product text**, one H-VTEC line per segment, right under the P-VTEC line:
  `/nwsli.s.ic.begin.crest.end.fr/`. Fields (VTEC explanation v9.0): severity `N` none, `0` non-forecast point or
  flash flood, `1` minor, `2` moderate, `3` major, `U` unknown; immediate cause `ER` excessive rainfall, `SM`
  snowmelt, `RS` rain and snowmelt, `DM` dam or levee failure, `IJ` ice jam, and others; flood record `NO` not
  expected, `NR` near record or record expected, `UU` no period of record, `OO` non-forecast point, flash flood or
  advisory. NWSLI `00000` means no forecast point. Official route: `GET /products/types/{FLW|FLS}/locations/{office}`
  then `GET /products/{id}` and match the segment's P-VTEC.
- **IEM shortcut** (copy, not official): `GET https://mesonet.agron.iastate.edu/api/1/nws/current_flood_warnings.geojson`
  answered in 0.9 s with 24 current point Flood Warnings, each with `hvtec_nwsli`, `river_name` ("102 River"),
  `name`, gauge `latitude` / `longitude`, `stage_text`, `flood_text`, `forecast_text`, `impact_text`, `severity`,
  `wfo`, `eventid`, and the warning polygon. "There is no archive support to this app" (IEM's own description).

### 1.6 Past alerts (IEM; reuse `nws.py`'s archive code)

`sources/nws.py:950-1286` already reads the IEM archive for Red Flag Warnings. For floods it needs the phenomenon
filter widened (`bypoint_events` keeps `FW` only, `:987`) and these extra calls:

| Request (all `https://mesonet.agron.iastate.edu`) | What it gives | Measured |
|---|---|---|
| `/json/vtec_events_bystate.py?state=TX&year=2025` (`year` is required) | every VTEC event in a state and year: `phenomena`, `significance`, `eventid`, `wfo`, `issue`, `expire`, `product_issue`, `locations`, `area`, `uri`, **`hvtec_nwsli`** | 200, 3.6 MB, 10.7 s; 7,739 events, of them 1,188 `FA.Y`, 747 `FF.W`, 366 `FL.W`, 98 `FA.A`, 80 `FA.W`, 26 `FL.Y`, 10 `FL.A`, 1 `FF.A`. Cache 30 days for past years |
| `/api/1/vtec/sbw_interval.geojson?begints=…&endts=…&wfo=EWX&ph=FF&ph=FA` (`ph` and `wfo` are repeated, at most 2 and 3 values) | warning polygons issued in a window, with `utc_issue`, `utc_expire`, `utc_polygon_begin/end`, `ph_sig`, `event_label`, `status`, `product_id`, `ugclist` | 200, 23 KB; 32 polygons for July 4, 2025 at NWS Austin/San Antonio (19 `FA.Y`, 13 `FF.W`). Writing `ph=FF,FA` returns an empty list without error |
| `/json/vtec_event.py?wfo=DVN&year=2026&phenomena=FL&significance=W&etn=92` | one event: per-zone rows with `hvtec_nwsli`, `utc_issue`, `utc_expire`, `utc_updated`, and every product's text (`report`, `svs`) | 200, 4 KB; included the 17:18 UTC statement when read at 19:52 |
| `/geojson/vtec_event.py?…` | the event's zone polygons (as `nws.load_event_zones`) | not re-tested (works for fire events) |
| `/json/vtec_events_bypoint.py?lat=&lon=&sdate=&edate=` | events at a point (as `nws.archive_for_area`) | not re-tested |

### 1.7 Cadence, limits, terms, failures, verdict

- **Cadence and latency:** products appear in the feed as they are issued (the existing 2-minute cache is right).
  River statements follow on a schedule each product states ("The next statement will be issued by Thursday
  morning").
- **Limits:** "The rate limit is not public information, but allows a generous amount for typical use. If the rate
  limit is execeed a request will return with an error, and may be retried after the limit clears (typically within
  5 seconds)." A unique User-Agent with contact details is asked for (<https://www.weather.gov/documentation/services-web-api>,
  read 2026-11-04). Fire-3d's own limit of 30 a minute stays. IEM: "These services and the backend server answering
  the requests have finite capacity. I would suggest not using these on a highly trafficked website" (IEM API
  description, <https://mesonet.agron.iastate.edu/api/1/openapi.json>); keep its 30 a minute and long caches.
- **Terms:** NWS: "public domain … may be used without charge for any lawful purpose so long as you do not: 1) claim it
  is your own …, 2) use it in a manner that implies an endorsement or affiliation with NOAA/NWS, or 3) modify its
  content and then present it as official government material" (<https://www.weather.gov/disclaimer>, read
  2026-11-04). IEM: "The materials found on this website are in the public domain and may be used freely by anyone
  for any lawful purpose. Attributing the Iowa Environmental Mesonet of Iowa State University would be appreciated"
  (<https://mesonet.agron.iastate.edu/disclaimer.php>, read 2026-11-04); API: "free to use for most any legal
  purpose".
- **Credit lines:** "National Weather Service" (live); "National Weather Service, archived copy via the Iowa
  Environmental Mesonet (Iowa State University)" (past), as today.
- **Failures seen:** none today. Known: IEM `vtec_events_bystate.py` answers 422 without `year`; `sbw_interval`
  answers an empty list (not an error) for a malformed `ph`.
- **Verdict: use.** Live from api.weather.gov; river gauge ids from the product text (official) or IEM (copy); past
  floods from IEM, labelled archived.

---

## 2. NOAA National Water Prediction Service (NWPS) API

Base `https://api.water.noaa.gov/nwps/v1`, documented by a Swagger file at `/nwps/v1/docs/swagger.json` (version
1.0.0, contact `nws.nwc.ops@noaa.gov`). No key. Paths: `/gauges`, `/gauges/{id}`, `/gauges/{id}/stageflow`,
`/gauges/{id}/stageflow/{observed|forecast}`, `/gauges/{id}/ratings`, `/gauges/{id}/riverflow`,
`/products/stageflow/{id}/{pedts}`, `/reaches/{reachId}`, `/reaches/{reachId}/streamflow`, `/monitor`.
`{id}` accepts the NWS LID or the USGS id.

### 2.1 Gauge list by area: unreliable for the whole country

`GET /gauges?bbox.xmin=&bbox.ymin=&bbox.xmax=&bbox.ymax=&srid=EPSG_4326` (optional `catfim=true`):

| Area | Result |
|---|---|
| Iowa box (6.6° × 3.3°) | 200, 532 gauges, 0.54 MB, 3.2 s |
| Lower 48 (-125, 24, -66, 50) | 200, **12,362 gauges, 12.6 MB, 45.5 s** (49 states incl. DC) |
| South-east half (-95, 24, -66, 37) | **504 after 60.6 s** |
| Tile -90, 30, -80, 38 | **504 after 60.3 s** |
| Tile -125, 40, -115, 49 | 200, 798 gauges, 0.8 MB, 20.8 s |

Each gauge: `lid`, `name`, `rfc{abbreviation,name}`, `wfo{abbreviation,name}`, `state`, `latitude`, `longitude`,
`pedts{observed,forecast}`, `status.observed` and `status.forecast` (`primary` stage, `primaryUnit`, `secondary`
flow, `secondaryUnit`, `floodCategory`, `validTime`). Categories seen: `no_flooding`, `not_defined`,
`obs_not_current`, `out_of_service`, `low_threshold`, `action`, `minor`, `moderate`, `major`, `fcst_not_current`.
Missing values are `-999` with the time `0001-01-01T00:00:00Z`.

**Verdict for listing: do not use.** The gateway times out at 60 s and the answer time swings from 3 s to over 60 s.
Use `riv_gauges` (2.2) for the national status and NWPS for one gauge at a time.

### 2.2 NWS map service `riv_gauges` (national status, found during this audit)

`https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer`: layer 0 "Observed River
Stages", layers 1-14 "River Stages {24…336} hour Forecast", layer 15 "Full Forecast Period Stages". Points.

- Layer 0: 12,913 gauges (with Alaska, Hawaii, Puerto Rico; filter by `state`). Grouped by `status` in 0.2 s:
  7,132 no_flooding, 4,176 not_defined, 825 obs_not_current, 638 out_of_service, 59 low_threshold, 53 action,
  **21 minor, 6 moderate, 3 major** (the same counts as the NWPS national list).
- `where=status in ('minor','moderate','major')` with `f=geojson`: 30 features, 19 KB, 0.22 s.
- Fields: `gaugelid`, `status`, `location`, `waterbody` (river name), `state`, `obstime` (UTC, "2026-11-04
  18:30:00"), `wfo`, `url` (`https://water.noaa.gov/gauges/agym7`), `observed`, `units`, `action`, `flood`,
  `moderate`, `major`, `secvalue`, `secunit`, `pedts`, `idp_filedate`. **Numbers are strings** ("25.84").
- Layer 15: `status` is the forecast category at `fcsttime`, with `fcstissunc` (forecast issue time, UTC) and
  `forecast`; 18 minor, 6 moderate, 2 major today.
- Refreshed within minutes (`idp_filedate` 20:08 UTC when read at 20:10). "This service is not time enabled":
  current only. Credit text (`copyrightText`): "National Oceanic and Atmospheric Administration, National Weather
  Service, National Weather Center,NOAA, NWS, NWC, National Water Prediction Service".
- **Verdict: use** for the overview's gauges and for "gauges at or above flood stage" (brief decision 1).

### 2.3 Gauge detail: `GET /gauges/ARCF1` (200, 48 KB, 0.27 s)

| Field | Example | Use |
|---|---|---|
| `lid`, `usgsId`, `reachId`, `name`, `county`, `state`, `timeZone` | ARCF1, 02296750, 16807219, "Peace River at SR 70 Arcadia", DeSoto, FL, EST5EDT | identity; USGS link; NWM reach |
| `rfc`, `wfo` | SERFC "Southeast River Forecast Center"; TBW "Ruskin" | who forecasts, who issues |
| `status.observed` / `status.forecast` | 15.13 ft, 8.88 kcfs, **moderate** at 18:30Z / 16.5 ft **major** at 2026-11-06 00Z | current and forecast category |
| `flood.categories` | action 9, minor 11, moderate 14, major 16 (ft); flows `-9999` = not defined | the thresholds (official) |
| `flood.impacts[]` | 9 rows of `{stage, statement}`: "Up to 60 homes at River Acres are flooded …" at 16 ft | **verbatim impacts text** |
| `flood.crests.historic[]` / `recent[]` | 117 each; record 23.7 ft on 2022-10-01, `preliminary` R/O | past floods ("Historic crests") |
| `flood.lro` | chance of minor flooding in the next 90 days, `producedTime` | optional |
| `forecastReliability` | "Forecasts are issued as needed during times of high water, but are not routinely available." | show verbatim |
| `hydronotes[]` | "River forecasts for this location take into account past precipitation and the precipitation amounts expected approximately 48 hours into the future from the forecast issuance time." | show verbatim |
| `dataAttribution[]` | "Observations courtesy of U.S. Geological Survey", link to the USGS site | credit per gauge |
| `inService`, `upstreamLid`, `downstreamLid`, `datums`, `images` (hydrograph and probability GIFs), `inundation.enabled` | | links, river order |

### 2.4 Stage and flow series: `GET /gauges/ARCF1/stageflow` (200, 468 KB, 0.34 s)

- `observed`: `issuedTime`, `wfo`, `timeZone`, `primaryName` "Stage" (ft), `secondaryName` "Flow" (kcfs), `data[]`
  of `{validTime, generatedTime, primary, secondary}`: 2,859 points, every 15 min, **from 2026-10-05 to 18:30Z
  today (30 days)**.
- `forecast`: `pedts` "HGIFF", **`issuedTime` 2026-11-04T12:33:00Z**, 20 points every 6 h to 2026-11-09 12Z.
- "This service does not contain historical data other than crest and low water history"
  (<https://water.noaa.gov/about/api>, read 2026-11-04). Past observations come from USGS (section 4); past RFC
  forecasts are not available anywhere public as data (only the wording inside archived warnings, section 1.6).

### 2.5 Which fields are official, and how to label them

- **Official (NWS):** the flood categories and thresholds, impacts, historic crests, and the forecast series
  (`stageflow.forecast`, `status.forecast`). Label: "Official NWS river forecast · Southeast River Forecast Center ·
  issued 8:33 AM EDT Nov 4" with a link to `https://water.noaa.gov/gauges/arcf1`. The forecast's `wfo` (TBW) is the
  office that issues it; the gauge's `rfc` is the centre that makes it.
- **Observed:** `stageflow.observed` and `status.observed`, credited from `dataAttribution` ("Observations courtesy
  of U.S. Geological Survey"). USGS data are provisional (section 4.5).
- **Model (never official):** `/reaches/{reachId}/streamflow` (section 2.6).

### 2.6 NWM stream flow per reach (model): `GET /reaches/16807219/streamflow?series=short_range`

Series: `analysis_assimilation`, `short_range` (18 hourly values, `referenceTime` 17:00Z read at 19:55Z),
`medium_range`, `medium_range_blend` (240 hourly values from the 12Z run), `long_range`; units `ft³/s`.
`/reaches/{id}` gives the reach name and its upstream and downstream reaches. NOAA's wording
(<https://water.noaa.gov/about/api>, read 2026-11-04): "The NWM provides hydrologic guidance and is not an official
forecast product", and the separate NWM API "is not supported 24/7 and may be modified without advance notice"; it
keeps "the most recent streamflow model run as well as a three-day rolling archive". **Use with care**, labelled
"Model output (National Water Model), experimental, not an official forecast". The HEFS ensemble API on the same
page is also experimental: **do not use** in this brief.

### 2.7 Cadence, limits, terms, verdict

- **Cadence:** observations every 15 min, reaching NWPS about 25 min after they are measured (ARCF1: the 18:30 value
  was generated at 18:54); RFC forecasts "as needed" (ARCF1's was issued at 12:33 UTC); NWM short range hourly,
  medium range every 6 h.
- **Limits:** none published (Swagger and the API page say nothing). Use a limiter of the NWS kind (30 a minute),
  cache gauge detail 6 h and series 10 min.
- **Terms:** NWS data; the NWS disclaimer above applies (water.noaa.gov has no separate terms page: `/about/disclaimer`
  answers 404). **Credit:** "NOAA National Water Prediction Service (NWS)"; per gauge, its `dataAttribution` text.
- **Failures seen:** 504 on large bbox lists (2.1). Gauge detail and series were fast (0.3 s).
- **Verdict: use** for one gauge at a time (detail, series, impacts, crests, official forecast).

---

## 3. NOAA water map services (maps.water.noaa.gov)

`GET https://maps.water.noaa.gov/server/rest/services?f=json` (ArcGIS 11.5): folders `fim_libs`, `flash`, `nwm`,
`reference`, `rfc`, `tools`, `Utilities`. All are queried like any ArcGIS layer:
`…/MapServer/{layer}/query?geometry=xmin,ymin,xmax,ymax&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&where=1=1&outFields=*&outSR=4326&f=geojson`,
with `maxAllowableOffset` (degrees) and `geometryPrecision` to shrink polygons; `maxRecordCount` is 2,000 and
pagination (`resultOffset`) is supported. None is time-enabled: **current only, no history.**

### 3.1 `rfc` folder

Services (each a MapServer and a FeatureServer): `rfc_based_5day_max_inundation_extent`,
`rfc_based_5day_max_streamflow`, `rfc_max_forecast`, plus `_ak` variants for Alaska.

**`rfc/rfc_based_5day_max_inundation_extent`** — its own text: "*****THIS IS AN EXPERIMENTAL SERVICE***** This
experimental map represents the National Weather Service's best approximation of inundation extent based upon
modeled river discharge. The map depicts the maximum inundation extent over the next 5 days derived from the
official River Forecast Center (RFC) forecast routed downstream through the National Water Model (NWM) stream
network." Updated "every 15 minutes based on RFC Forecast availability". `copyrightText`: "National Water Model,
NOAA/NWS National Water Center".

| Layer | Content | Fields |
|---|---|---|
| 0 | "5 Days -Inundation Extent (EXPERIMENTAL)", polygons, one per NWM reach | `feature_id`, `streamflow_cfs`, `reference_time` ("2026-11-04 18:00:00"), `update_time` ("2026-11-04 19:48:25 UTC") |
| 2 | "5 Days - Related RFC Forecast Points" | `nws_lid`, `usgs_sitecode`, `nws_name`, `reference_time` |
| 3, 4 | "Max Flood Status Forecast" river lines (action+ / other routing) | `feature_id`, `nws_station_id`, `name`, `stream_order`, `reference_time`, `time_of_max`, `discharge_cfs`, `viz_status`, `influential_forecasts`, `update_time` |
| 6, 7 | "Max Status - Forecast Trend", "Record Forecasts" (as `rfc_max_forecast`) | below |

- **Size:** 4,172 polygons nationally today; 182 in a 0.5° box at Arcadia, FL: **3.9 MB** as full GeoJSON, **0.52 MB**
  with `maxAllowableOffset=0.0002&geometryPrecision=5` (about 20 m). Request the simplified form.
- **Coverage:** the text still says "an area that includes 30% of the U.S. population … Boundary of 30% Area:
  reference/static_public_fim_domain". NOAA's operations page says "Experimental FIM services are now available for
  nearly 100% of the U.S. population" (<https://www.weather.gov/owp/operations>, read 2026-11-04). Measured: polygons
  exist in Missouri (760), Iowa (1,639), Arizona box (455), south-west Colorado (69) and Florida (423); the
  `static_public_fim_domain` layer now holds a single shape in Alaska only. Treat the lower 48 as covered, but say
  "no forecast flood map here" (never "no flooding") where a flood has none.
- **Time to show:** `reference_time` is the forecast's base time (UTC, no zone suffix); `update_time` is when the
  map was rebuilt. Show both, plus the related forecast points' issue times (layer 6).
- **Verdict: use with care**, labelled "Experimental NWS forecast flood map (from the official RFC forecast)". It is
  official-source-based but NOAA calls it experimental; keep it apart from NWM-only maps.

**`rfc/rfc_max_forecast`** layer 0 "Max Status - Forecast Trend": 89 points today (60 action, 20 minor, 6
moderate, 2 major). Fields: `nws_lid`, `nws_name`, `usgs_site_code`, `feature_id`, **`producer`** (SERFC),
**`issuer`** (TBW), **`issued_time`** ("2026-11-04 12:33:00+00"), `generation_time`, thresholds, `initial_value` /
`initial_status`, `max_value` / `max_status` / `max_value_timestep`, `forecast_trend` ("increasing"),
`is_record_forecast`, `hydrograph_link`, `hefs_link`, `update_time`. Updated about every 5 minutes. **Verdict: use**
(a national list of official forecasts at action or above).

### 3.2 `nwm` folder (model output)

40 services (73 MapServer and FeatureServer entries; CONUS, Alaska, Hawaii, Puerto Rico variants). The CONUS ones
that matter:

| Service | What | Cadence (service text) | Features today (CONUS) | Times seen |
|---|---|---|---|---|
| `ana_high_flow_magnitude` | reaches above the high-water threshold now, coloured by AEP | hourly | 80,944 | `reference_time` 19:00 UTC, `update_time` 19:49 |
| `ana_inundation_extent` (layer 0, EXPERIMENTAL) | modelled flooded area now | hourly | 183,041 polygons | ref 19:00, upd 19:54 |
| `ana_past_14day_max_high_flow_magnitude` | peak of the last 7 / 14 days | daily | — | `reference_time`, `valid_time` |
| `srf_18hr_max_high_flow_magnitude` | peak of the next 18 h | hourly | 95,338 | ref 18:00, upd 19:36 |
| `srf_18hr_rapid_onset_flooding` | small streams doubling within an hour (layers 0-1 lines, layer 2 HUC10 polygons) | hourly | — | `flood_start_time`, `flood_end_time` |
| `srf_18hr_high_water_arrival_time`, `srf_12hr_*_probability` | arrival time; probabilities | hourly | — | — |
| `mrf_gfs_5day_max_inundation_extent` (EXPERIMENTAL) | modelled flooded area, next 5 days (GFS weather) | every 6 h | 261,001 | ref 12:00, upd 18:39 |
| `mrf_nbm_5day_max_inundation_extent` (EXPERIMENTAL) | same with the National Blend of Models | every 6 h | 238,326 | ref 12:00, upd 18:36 |
| `mrf_gfs_10day_max_high_flow_magnitude` | 3, 5, 10-day peaks | every 6 h | — | — |

- **No CONUS short-range inundation service exists** (`srf_48hr_max_inundation_extent` is Hawaii and Puerto Rico
  only); the nearest forecast extents are the 5-day medium-range ones.
- **`recur_cat` is an AEP in percent.** Values `">50"`, `"50"`, `"20"`, `"10"`, `"4"`, `"2"`; each row also carries
  `flow_2yr … flow_50yr` and `high_water_threshold`. Checked on 1,071 rows near Arcadia: `"10"` rows were between the
  10- and 25-year flows, `"20"` between the 5- and 10-year flows, `">50"` below the 2-year flow. Show "about a 1 in
  10 chance in any year" from `"10"`; never "10-year flood" without checking.
- **Delay:** maps appear 1-2 h after the model run (`reference_time` to `update_time`), 6-7 h for medium range.
- **Verdict: use with care**, only as "Model output (National Water Model), experimental", never merged with or
  coloured like the official layers (brief decision 3). The `ana_*` layers suit the overview ("model sees high
  water"), the 5-day extents suit Command and Forensic.

### 3.3 `fim_libs/static_stage_based_catfim`

"EXPERIMENTAL … flood inundation extents derived from official NWS category thresholds and for every foot in
between using the Height Above Nearest Drainage (HAND) technique … Mapping extends 5 miles upstream and downstream of
AHPS gage locations … This service is static and only updated when a new FIM version is released." Layer 0: 6,152
sites, 2,570 with `mapped = 'yes'` (`ahps_lid` lower case, `usgs_gage`, `status`). Layers 3/6/9/12/13: the action,
minor, moderate, major and record polygons (`ahps_lid`, `magnitude`, `stage`, `fim_version` 6.2); layers
2/5/8/11: 1-foot steps. Arcadia's major polygon (16 ft): 64 KB at 0.0002°. **Verdict: use with care**, as "What
minor / moderate / major flooding covers here (experimental NWS map library)", for a gauge whose official
forecast reaches that category, and for past floods (section 8). Never as an observation.

### 3.4 `flash`, `tools`, `reference`

- `flash`: `{"error":{"code":499,"message":"Token Required"}}`. **Do not use.** `tools`: no public services.
- `reference/static_nwm_flowlines` (layer 0: `feature_id`, `name`, `strm_order`, `huc6`, `high_water_threshold`,
  `rf_2…rf_50` flows): 80 reaches in a 0.15° box, fast. `reference/static_nwm_coastal_domain_noaa`: where forecast
  extents "do not fully capture coastal processes". `reference/static_public_fim_domain`: see 3.1.

### 3.5 Terms, failures, verdict for the folder

NOAA/NWS data under the NWS disclaimer (1.7); documentation: "Public_Handbook_V2.3 NWC_Visualization_Services.pdf"
linked from each service. Credit line: "NOAA/NWS National Water Center" (from `copyrightText`), plus "experimental"
where the service says so. No failure seen in about 75 requests (0.2-0.9 s each).

---

## 4. USGS water data

### 4.1 Versions and the legacy shutdown

- **v1 is the current version** of the OGC API: "USGS water data APIs are hosted at
  https://api.waterdata.usgs.gov/ogcapi/v1/ … v1 is the current version"
  (<https://api.waterdata.usgs.gov/docs/ogcapi/versioning/>, read 2026-11-04). The V1 announcement (Sep 4, 2026,
  updated Oct 17; <https://waterdata.usgs.gov/blog/api-v1-release/>): change `ogcapi/v0/` to `ogcapi/v1/`; "The V0
  /time-series-metadata, /field-measurements, and /latest-field-measurements endpoints will remain online until June
  2027. Other endpoints will be automatically redirected in the coming weeks … We will redirect all requests from V0
  of these APIs to V1 in mid-2027." Both answered today.
- **Legacy WaterServices (`waterservices.usgs.gov/nwis`)**: "WaterServices will be decommissioned on February 22nd,
  2027." Before that: a 2 s delay per request from Nov 16, 2026; 10 s from Jan 11, 2027; 30 s from Jan 25; a 24 h
  redirect to the notice on Jan 27; 60 s from Feb 1; a 48 h redirect on Feb 15
  (<https://waterdata.usgs.gov/blog/wdfn-waterservices-degradation/>, posted Sep 18, updated Oct 27, 2026, read
  2026-11-04). **Do not use.**

### 4.2 Endpoints tested

| Request (`https://api.waterdata.usgs.gov/ogcapi/v1/collections/…`) | Result |
|---|---|
| `monitoring-locations/items?id=USGS-02296750&f=json` | 200, 3.4 KB: `monitoring_location_name` "PEACE RIVER AT SR 70 AT ARCADIA, FL", `site_type`, `state_name`, `county_name`, `hydrologic_unit_code`, `drainage_area` 1,367 mi², `altitude`, `vertical_datum` NGVD29, `time_zone_abbreviation` |
| `continuous/items?monitoring_location_id=USGS-02296750&parameter_code=00065&time=2026-11-03T00:00:00Z/2026-11-04T00:00:00Z&limit=200` | 200, 97 values every 15 min: `time`, **`value` as a string** ("11.17"), `unit_of_measure` ft, `approval_status` Provisional, `qualifier`, `time_series_id`, `statistic_id` 00011 |
| `continuous/items?monitoring_location_id=USGS-08165500&parameter_code=00065&time=2025-07-04T00:00:00Z/2025-07-05T00:00:00Z&properties=time,value,unit_of_measure,approval_status` | 200: the Guadalupe River at Hunt, TX, peaked at **37.52 ft at 10:10 UTC on July 4, 2025**, "Approved"; only 117 of 288 expected values (the gauge stopped reporting during the flood) |
| v0 `latest-continuous/items?monitoring_location_id=USGS-02296750` | 200: 00060 discharge 8,790 ft³/s, 00065 gage height 15.09 ft, 63160 stream water level 19.85 ft, all at 19:30Z (read about 19:58Z) |

Parameter codes: **00065 gage height (ft)**, **00060 discharge (ft³/s)**; 63160 is the stream water level above a
datum (NAVD88), not the gauge stage. Data arrive "within minutes of collection" where the site has telemetry.

### 4.3 Rate limits and keys

- Keys come from api.data.gov (free, by e-mail at <https://api.waterdata.usgs.gov/signup/>) and go in `api_key` or
  `X-Api-Key`. "Information on the rate limits … are provided in the X-RateLimit-Limit and X-RateLimit-Remaining
  headers" (<https://api.waterdata.usgs.gov/docs/ogcapi/keys/>, read 2026-11-04). Without a key the header said
  **`x-ratelimit-limit: 1000`**.
- **From this cloud session the keyless limit was already spent** by the shared outgoing address: `monitoring-locations`
  (v0) and the v1 collection page answered **429 `OVER_RATE_LIMIT`, `Retry-After: 2175`** (36 min), while other item
  requests passed (served by CloudFront). On the user's own computer the 1,000 an hour is far more than Fire-3d
  needs (a few requests per flood, cached).
- A key would be a **third secret**; CLAUDE.md allows only `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`. User decision (9).

### 4.4 NWS gauge to USGS site

1. NWPS gauge detail `usgsId` ("02296750") and `dataAttribution` (best, per gauge).
2. `rfc_max_forecast.usgs_site_code`, RFC inundation layer 2 `usgs_sitecode`, CatFIM `usgs_gage`.
3. NOAA HADS crosswalk, one 0.99 MB text file: `https://hads.ncep.noaa.gov/USGS/ALL_USGS-HADS_SITES.txt`
   (`NWS 5 CHR IDENT | USGS STATION NUMBER | GOES | NWS HSA | lat | lon | name`): ARCF1 → 02296750, SIGI4 → 05472500.
   Good for building past floods offline; cache 30 days.

### 4.5 Terms, verdict

- "USGS-authored or produced data and information are considered to be in the U.S. Public Domain … Credit: U.S.
  Geological Survey" (<https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits>, read
  2026-11-04). Provisional data: "This information is preliminary or provisional and is subject to revision … provided
  on the condition that neither the USGS nor the U.S. Government shall be held liable for any damages"
  (<https://waterdata.usgs.gov/provisional-data-statement/>, read 2026-11-04). Show "provisional" next to such values.
- **Credit line:** "U.S. Geological Survey (provisional data)".
- **Verdict: use with care**: for past floods (observations older than NWPS's 30 days) and gauges NWS does not
  carry; on demand, cached, with a plain "USGS data could not be reached right now (too many requests); try later"
  on 429. Live gauges use NWPS, which already relays USGS observations.

---

## 5. FEMA National Flood Hazard Layer

`https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer` (ArcGIS; `maxRecordCount` 2,000; max image
4,096 px; JSON, GeoJSON, PBF).

### 5.1 Layers

0 NFHL Availability, 1 LOMRs, 3 FIRM Panels, 14 Cross-Sections, 16 Base Flood Elevations, 20 Water Lines, 22
Political Jurisdictions, 23 Levees, 27 Flood Hazard Boundaries, **28 Flood Hazard Zones**, 32 Water Areas, and
others (34 LOMAs). Layer 28 fields: `FLD_ZONE` (A, AE, AH, AO, VE, X, …), `ZONE_SUBTY` ("FLOODWAY", "0.2 PCT ANNUAL
CHANCE FLOOD HAZARD", "AREA OF MINIMAL FLOOD HAZARD"), **`SFHA_TF`** (T = inside the 100-year floodplain),
`STATIC_BFE` (base flood elevation, -9999 none), `DEPTH`, `V_DATUM`, `DFIRM_ID`, `SOURCE_CIT`, `STUDY_TYP`.

### 5.2 Query versus export

- **Query features (recommended for bundles):** `28/query?geometry=-81.92,27.18,-81.84,27.25&…&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DFIRM_ID,SOURCE_CIT&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.0001&f=geojson`:
  185 zones (137 A, 17 AE, 1 AE floodway, 19 X 0.2 %, 11 X minimal), **0.97 MB**, 3.5 s. Count first
  (`returnCountOnly`, 1.6 s), page with `resultOffset` at 2,000, add `where=SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2%'`
  to drop the zone X "minimal" shapes, and simplify more (0.0002°) for a 20 km area. Cache 30 days (the data change
  by map revisions, not daily).
- **Export image (overview only):** `export?bbox=…&bboxSR=4326&imageSR=3857&size=1024,1024&layers=show:28&format=png32&transparent=true`
  gave a 77 KB PNG, 36 % covered, for an 8 km box. Layer 28 draws only at scales of **1:36,112 or larger**
  (`minScale`); FEMA: "detailed flood hazard maps at map scales of 1:50,000 and larger". Zoomed out it is empty,
  which must not read as "no floodplain": show "Zoom in to see FEMA flood zones".
- **Where there is no NFHL data:** layer 0 "NFHL Availability" answers per point (`STUDY_ID` 12027C at Arcadia).
  FEMA: "NFHL digital data covers over 90 percent of the U.S. population". Elsewhere say "FEMA flood zones are not
  available in digital form here", never "not in a floodplain".

### 5.3 Connection resets

Of **14 attempts** to hazards.fema.gov, **8 ended in `curl: (35) Recv failure: Connection reset by peer`** during
the TLS handshake (2-5 s): the service root needed 3 tries, an export of a 1° box failed 4 times in a row, the
point query needed 2 tries. When it answered, it was fast (0.2-3.5 s). `msc.fema.gov` also reset once, and
`www.fema.gov` answers 403 to scripts (as in brief 3). FEMA's services page notes "hazards.fema.gov only supports
TLS 1.2 with Cipher Suites". Whether the resets come from FEMA or from the cloud proxy could not be told apart; the
brief saw the same. **Retry advice:** up to 4 attempts with 2, 4, 8 s waits (fire3d.http already retries connection
errors), a 30-day cache, a `DownMemo` so one bad minute does not stall every request, and the bundle builds without
the layer ("FEMA flood zones could not be loaded right now") rather than failing.

### 5.4 Terms and required wording

- FEMA's ArcGIS item for this exact service (owner FEMA_MAC, <https://www.arcgis.com/home/item.html?id=ae38b6f94eaf4abf97f986fa01921e13>,
  read 2026-11-04), license field: "User assumes all risk related to the use of this data. FEMA provides this data
  "as is" and disclaims any and all warranties … there are no express or implied guarantees of accuracy of the data.
  In no event will FEMA or any other Federal Agency be liable …". No credit line or logo rule is stated; as with
  OpenFEMA (brief 3), no FEMA or DHS logo and no implied endorsement.
- FEMA's services page (<https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS>, read 2026-11-04): "The data depict
  effective flood hazard information"; preliminary and pending data "cannot be used to rate flood insurance policies
  or enforce the Federal mandatory purchase requirement" (use only layer 28 of the effective service, not the
  preliminary one); for official use other map data must meet FEMA's accuracy standard ("NSSDA radial accuracy of 38
  feet").
- **Credit line:** "Flood zones: FEMA National Flood Hazard Layer (effective)". **Disclaimer to show** (ours, built
  on FEMA's): "FEMA's 1%-annual-chance (100-year) floodplain, used for flood insurance. It is not a map of current
  flooding, and places outside it can flood. Provided as is by FEMA."

### 5.5 Verdict

**Use with care, background only.** Show the SFHA (`SFHA_TF = 'T'`, with the floodway) and the 0.2 % band.
**Do not show zone X "AREA OF MINIMAL FLOOD HAZARD"**: FEMA's own words would put "minimal hazard" on our map,
which CLAUDE.md forbids, and absence of a zone is not an all-clear.

---

## 6. Satellite water (observed)

### 6.1 OPERA DSWx-HLS (optical)

- CMR collection `C2617126679-POCLOUD`, short name `OPERA_L3_DSWX-HLS_V1`, DOI `10.5067/OPDSW-PL3V1`, PO.DAAC,
  "validated surface water extent observations beginning April 2023", inputs Landsat 8/9 and Sentinel-2A/B/C (HLS
  v2.0). 30 m pixels, UTM, one 109.8 km MGRS tile = 3,660 × 3,660 pixels, 10 COG layers per granule.
- **Classes, layer B01_WTR** (product specification D-107395 Rev B, read 2026-11-04): 0 not water, 1 open water, 2
  partial surface water ("at least 20% and less than 100% open water"), 252 snow/ice, 253 cloud/cloud shadow and
  adjacent, 254 ocean masked, 255 no data. B02_BWTR is the same as water / not water. B03_CONF splits open water
  into high and moderate confidence and partial water into conservative and aggressive.
- **Revisit:** near Arcadia, images on Oct 28, 29 and 31 (Landsat and Sentinel-2 combined); clouds are class 253, so
  a flood under cloud is **not seen**.
- **Latency (measured on the 200 newest CONUS granules):** made **30-33 h** after the image was taken; at the check
  the newest image was from 2026-10-31 19:22 UTC (4 days old). Near Arcadia: images of Oct 29 (16:15) and Oct 31
  (16:06), the latter 74-86 % cloud.
- **File sizes** (granule T17RMK, Oct 31): B02_BWTR 136 KB, B05_WTR-1 386 KB, B04_DIAG 669 KB, B07_LAND 1.7 MB,
  B10_DEM 39 MB (not needed). The water layers are small enough to download whole.

### 6.2 OPERA DSWx-S1 (radar)

- `C2949811996-POCLOUD`, `OPERA_L3_DSWX-S1_V1`: "maps open inland water bodies greater than 3 hectares and 200 meters
  in width, irrespective of cloud conditions and daylight", 30 m, MGRS, "revisit frequency between 6-12 days",
  forward production since Sept 2024; 3 GeoTIFFs (B01_WTR, B02_BWTR, B03_CONF; B04_DIAG also listed). "The OPERA
  DSWx-S1 product contains modified Copernicus Sentinel data". A processing anomaly (May 20 - Dec 9, 2025) was
  reprocessed; use current files only.
- **Latency:** made **14.5-44 h** after the pass (median 17 h); newest CONUS image 2026-11-02 00:05 UTC.
- It is the one that sees floods under storm clouds, but it misses narrow rivers (under 200 m) and small ponds.

### 6.3 Search without login (CMR)

`GET https://cmr.earthdata.nasa.gov/search/granules.json?short_name=OPERA_L3_DSWX-HLS_V1&bounding_box=-82.1,27.0,-81.6,27.5&temporal=2026-10-20T00:00:00Z,2026-11-05T00:00:00Z&page_size=50&sort_key=-start_date`
answered 200 (30 HLS granules; 8 S1 granules for the S1 name). Per entry: `title`
(`OPERA_L3_DSWx-HLS_T17RMK_20261031T160509Z_20261102T013949Z_S2B_30_v1.1`: tile, image time, production time,
satellite), `time_start`, `cloud_cover`, `links` (data, browse, metadata). `granules.umm_json` adds
`DataGranule.ArchiveAndDistributionInformation` (file sizes), `BoundingRectangles`, `CloudCoverage`,
`SpatialCoverage`, `MGRS_TILE_ID`. The existing `overpass.py` CMR code (BE-2) can do this.

- Data links are in `podaac-ops-cumulus-protected` (login). **Browse images are public**:
  `…/podaac-ops-cumulus-public/…_BROWSE.png` answers 303 to a signed S3 address, then 200: a 1024 × 1024 palette
  PNG (about 107 m pixels, 14 KB) with transparent = not water, blue (0,0,255) open water, light blue
  (180,213,244) partial water, white snow/ice, grey (175,175,175) cloud. It is a picture without map coordinates
  (the tile's UTM square must be computed from its MGRS id).

### 6.4 Download with login (what `EARTHDATA_TOKEN` must do; not tested here)

- Without credentials, a protected file answers **302 to `https://urs.earthdata.nasa.gov/oauth/authorize?…&app_type=401`**
  (seen today).
- With the token: send `Authorization: Bearer <EARTHDATA_TOKEN>` to `archive.podaac.earthdata.nasa.gov`; PO.DAAC then
  redirects to a signed S3 address that must **not** receive the token. httpx drops `Authorization` on a redirect to
  another host, so `fire3d.http.stream_download` can be used if the header is passed per request and never put in
  the cache key, the logged URL or an error message (`config.mask_secrets` masks only the FIRMS key today; add the
  token).
- Earthdata user tokens are made at <https://urs.earthdata.nasa.gov> ("Generate Token") and expire (60 days per
  Earthdata Login's token page, to be confirmed when the user makes one). A 401 or a redirect back to URS means
  "NASA Earthdata login missing or expired": the satellite layer then says so and the rest of the flood view works
  (brief decision 2). The user may also have to approve the PO.DAAC application once in the browser (section 9).

### 6.5 Reading only the window (no new dependency)

`backend/uv.lock` already has **rasterio 1.4.4 (GDAL 3.10.3)**, numpy 1.26.4, tifffile 2026.3.3 and pillow. Two
ways:

1. **Recommended:** download the one water layer per tile (0.1-0.4 MB) through `fire3d.http` (cache 30 days: a
   granule never changes), open it with `rasterio.io.MemoryFile`, and read `window = from_bounds(...)` in the tile's
   UTM zone, then reproject to the bundle grid as `terrain.py` does.
2. Range reads straight from the COG with GDAL (`/vsicurl/`, with `GDAL_HTTP_AUTH=BEARER` and `GDAL_HTTP_BEARER`,
   available since GDAL 3.9 per GDAL's documentation): fewer bytes, but the token would pass through GDAL's own HTTP
   stack, outside `fire3d.http`'s masking. Not needed at these file sizes.

A flood area usually needs 1-4 tiles per date.

### 6.6 No-login routes

**(a) NASA Earthdata GIS ImageServer: measured classes, no login (new finding).**
`https://gis.earthdata.nasa.gov/portal/rest/services/C2617126679-POCLOUD/OPERA_L3_DSWX-HLS_V1_B01_WTR/ImageServer`
(also `…_B03_CONF`). `pixelType` U8, 30 m, `maxImageWidth` 2,048, time field `datetime`, raster function `None` for
raw values, `copyrightText`: "Observational Products for End-Users from Remote Sensing Analysis (OPERA) Project,
National Aeronautics and Space Administration (NASA), Jet Propulsion Laboratory (JPL), California Institute of
Technology, Physical Oceanography Distributed Active Archive Center (PO.DAAC)."

- Catalog: `query?geometry=…&time=<ms>,<ms>&where=category=1&outFields=name,tileid,datetime,productgenerationdatetime,cloud_coverage&orderByFields=datetime DESC`
  lists the granules (rows with `category` 2 are overviews). The newest near Arcadia was **Oct 29** while CMR already
  had Oct 31: about **one day behind** NASA's archive. The service's `timeInfo` says the data end on Oct 25 (stale
  metadata; newer rows exist).
- Pixels: `exportImage?bbox=-81.95,27.15,-81.80,27.30&bboxSR=4326&imageSR=32617&size=600,600&format=tiff&pixelType=U8&interpolation=RSP_NearestNeighbor&time=…&renderingRule={"rasterFunction":"None"}&f=image`
  → a real GeoTIFF (EPSG:32617, 27.9 m pixels) in 5.2 s with values {0, 1, 2, 252, 253}. The default mosaic picked
  a cloudy image (94 % class 253). With
  `mosaicRule={"mosaicMethod":"esriMosaicAttribute","sortField":"cloud_coverage","sortValue":"0","ascending":true,"where":"category=1"}`
  the same box was 82 % not water, 0.4 % water or partial water, 17 % cloud. For a dated layer, lock to one
  granule (`mosaicMethod: esriMosaicLockRaster` with its object id) so the image time is known exactly.
- HLS only: there is **no national DSWx-S1 image service**; NASA's Disasters programme publishes event-only ones
  (for example `DISASTERS_202507_FLOOD_TX/202507_opera_dswx_hls`, `DISASTERS_202606_FLOOD_LA/202610_opera_dswx_s1`).
- **Verdict: use** as the default observed-water layer (works without the token), with the image time and the
  share of cloud shown, and "not water seen" never read as "dry".

**(b) NASA GIBS tiles (picture only).** WMTS layers `OPERA_L3_Dynamic_Surface_Water_Extent-HLS` (dates to
2026-10-31) and `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1` (to 2026-11-02), PNG,
`GoogleMapsCompatible_Level12` (zoom 12 at most, about 38 m), daily; a z10 tile of each answered 200 (2-4 KB). The
layer metadata (`/layer-metadata/v1.0/<layer>.json`) names the CMR collections; no colour map file was found
(`/colormaps/v1.3/<layer>.xml` 404), so the legend follows the browse colours above. **Use** for the overview and
for S1 without the token, labelled "picture, not measured".

**(c) Other observed-flood products checked:**

| Product | Finding | Verdict |
|---|---|---|
| NOAA/GMU VIIRS and ABI flood maps via SSEC RealEarth (`RIVER-FLDglobal-composite1`, 1-day, 375 m, max zoom 7) | Current to Nov 3-4. RealEarth: free "for up to 500 megapixels per rolling 24hr period", then watermarks, with paid "Plus" and "Pro" tiers (<https://www.ssec.wisc.edu/realearth/realearth-pro/>, read 2026-11-04) | **Do not use** (volume-limited, paid above it; CLAUDE.md: no paid map services) |
| Copernicus Global Flood Monitoring (GFM) API `api.gfm.eodc.eu/v2` | 401 "UNAUTHORIZED" without an account | **Do not use** (needs registration; not an approved secret) |
| NASA Disasters event services on Earthdata GIS | Per event, hand-made; some are exercises ("EXERCISE - DaNCE March 2026") | **Use with care**, only as an extra for a past flood when one exists |

### 6.7 Terms and credit

- NASA: "Unless the content is marked with a use restriction or license, data provided from a NASA-led mission are
  licensed as Creative Commons Zero (CC0). While there are no restrictions on the use of these data, data users are
  very strongly urged to cite the data" (<https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance>,
  read 2026-11-04). PO.DAAC: "Data hosted by the PO.DAAC is openly shared, without restriction … Proper citations
  include the authors, title, publisher, and Digital Object Identifier (DOI)" (<https://podaac.jpl.nasa.gov/CitingPODAAC>,
  read 2026-11-04). The CMR record carries no `UseConstraints`.
- **Credit lines:** "Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1); contains
  modified Copernicus Sentinel data" (HLS includes Sentinel-2); for S1: "NASA JPL OPERA DSWx-S1 (PO.DAAC); contains
  modified Copernicus Sentinel data"; add "via NASA Earthdata GIS" or "via NASA GIBS" for those routes.

---

## 7. Terrain and river lines for the 3D flood view

- **USGS 3DEP** (`elevation.nationalmap.gov/…/3DEPElevation/ImageServer`, used by `terrain.py`) covers the lower 48;
  an identify at Arcadia returned 2.19 m, but took 18 s (the bundle builder's 180 s timeout and 90-day cache
  suit it). **Mapterhorn** (`tiles.mapterhorn.com`, terrarium WebP, worldwide bounds) is the live 3D terrain in
  MapLibre (USGS 3DEP and Copernicus GLO-30 in the United States). Both cover every flood area in the lower 48.
- **Flood-specific:** 3DEP lidar elevation is "hydro-flattened" (rivers and lakes are flat at the water level of the
  day the lidar was flown), so river channels show as flat ribbons, not their bed. None of these sources gives a
  **water depth or water-surface height**: FIM, NFHL and DSWx are extents only (NFHL's `STATIC_BFE` is a base flood
  elevation for some zones). The Forensic view should drape extents on the terrain, not draw a modelled water
  surface (there is no Fire-3d flood model, brief decision 3).
- **River lines:** `reference/static_nwm_flowlines` on maps.water.noaa.gov (section 3.4): fast, with `feature_id` to
  join the FIM polygons and NWM layers. **Use.** The USGS NHD service (`hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer`,
  "Data Refreshed October, 2026") timed out twice at 60 s on a 0.15° box; NHDPlus HR ("Data refreshed October, 2022")
  answered its metadata. **Do not use now** (NWM flowlines are enough).
- Credit lines: as today for 3DEP and Mapterhorn; "River lines: NOAA/NWS National Water Center (NWM)".

---

## 8. Recommended source set for the build

Times are always the source's own; every official item keeps issuer, times, verbatim words and a link.

| Layer | Source and request | Label in the app | Credit line | Refresh / cache |
|---|---|---|---|---|
| **Event list (live)** | api.weather.gov `/alerts/active` flood types, lower 48; grouped by VTEC key, then per river (gauge `waterbody`) or overlapping area | "Official NWS flood products" | National Weather Service | 2 min |
| Event list: river gauge per warning | product text H-VTEC (`/products/{id}`); fallback IEM `current_flood_warnings` | — (data join) | National Weather Service (IEM copy if used) | with the alert |
| **Event list (past)** | IEM `vtec_events_bystate.py` (+ `hvtec_nwsli`), `sbw_interval` polygons, `vtec_event.py` text | "Archived NWS product" | National Weather Service, archived copy via the Iowa Environmental Mesonet (Iowa State University) | 30 days |
| **Gauges (national)** | `riv_gauges` layer 0 (observed) and 15 (forecast) | "Gauge at minor / moderate / major flood stage (NWS)" | NOAA National Water Prediction Service (NWS) | 5 min |
| **Gauge detail** | NWPS `/gauges/{lid}` + `/stageflow` | "Measured (USGS, provisional)" / thresholds and impacts "NWS" | NOAA NWPS; "Observations courtesy of U.S. Geological Survey" | 10 min series, 6 h detail |
| **Official forecast** | NWPS `stageflow.forecast` (+ `rfc_max_forecast` for the national list) | "Official NWS river forecast · <RFC> · issued <time>" | NWS <RFC name>, issued by NWS <office> | 10 min |
| **Flooded area forecast** | `rfc/rfc_based_5day_max_inundation_extent` layer 0 (+ layer 6 points), simplified | "Experimental NWS forecast flood map (from the official RFC forecast), next 5 days" | NOAA/NWS National Water Center (experimental) | 15 min |
| Flooded area by category | `fim_libs/static_stage_based_catfim` for the gauge and its forecast category | "What <category> flooding covers here (experimental NWS map library)" | NOAA/NWS National Water Center | 30 days |
| Warning polygons | from the alerts (zones for watches via `/zones/{type}/{UGC}`) | as the product | National Weather Service | with the alert / 30 days for zones |
| **Observed water** | Earthdata GIS DSWx-HLS ImageServer (no login); with `EARTHDATA_TOKEN`: PO.DAAC DSWx-S1 and newest HLS; GIBS tiles for the overview | "Water seen by satellite on <date, time>; clouds hide <n> %; not seen ≠ dry" | NASA JPL OPERA DSWx (PO.DAAC, DOI); contains modified Copernicus Sentinel data | 6 h search; granules 30 days |
| **Background zones** | FEMA NFHL layer 28, SFHA and 0.2 % only | "FEMA 100-year floodplain (flood insurance map), not current flooding" | FEMA National Flood Hazard Layer (effective) | 30 days, with retries |
| **Model** | `nwm/ana_high_flow_magnitude`, `srf_18hr_max_high_flow_magnitude`, `mrf_*_5day_max_inundation_extent`; per reach NWPS `/reaches/{id}/streamflow` | "Model output (National Water Model), experimental, not an official forecast" | NOAA/NWS National Water Center, National Water Model | hourly / 6 h |
| River lines | `reference/static_nwm_flowlines` | — | NOAA/NWS National Water Center | 30 days |
| Terrain | 3DEP (bundle), Mapterhorn (map) | — | as today | as today |
| Past observations | USGS v1 `continuous` (00065, 00060); NWPS historic crests | "Measured (USGS)" / "Historic crests (NWS)" | U.S. Geological Survey; NWS | 30 days |

**Past floods**, layer by layer: warnings yes (IEM; check the first year needed: IEM's VTEC archive starts in the
mid-2000s and storm-based polygons in about 2008, per BE-0, not re-checked here); gauge
observations yes (USGS; NWPS only 30 days); categories and impacts: today's values (they can change; say so);
official forecasts and forecast flood maps **not available for past dates**; NWM maps not available (raw NWM output
on AWS `noaa-nwm-pds` goes back to 2025-01-01 as NetCDF, which would need a new reader: not recommended);
satellite water yes (Earthdata GIS from Jan 2023; PO.DAAC HLS from April 2023 validated, S1 from Sept 2024).

## 9. What needs the user

1. **Earthdata token (approved secret, optional for the app):** create a free account at
   <https://urs.earthdata.nasa.gov>, choose "Generate Token", and put the token in the gitignored `.env` as
   `EARTHDATA_TOKEN=…` (never in chat or git). Then sign in once at <https://search.earthdata.nasa.gov> and download
   any one OPERA DSWx file, so the PO.DAAC application is approved for the account. Renew it when it expires (about
   every 60 days); the app will say "NASA Earthdata login missing or expired". Without it the app still shows
   DSWx-HLS (one day older) and the S1 picture tiles.
2. **USGS API key (decision):** not needed on your own computer (1,000 requests an hour). In cloud sessions the
   shared address hit the limit. Options: (a) no key, accept "try later" in the cloud (recommended); (b) a free
   api.data.gov key as a third secret.
3. **Coastal and lakeshore floods (decision):** brief decision 1 names inland flood products only. Options: (a) leave
   Coastal/Lakeshore Flood products out of the flood list for now (recommended: they have no polygons, no river
   gauges and a different map); (b) include them as area-only events.
4. **FEMA zone X wording (recommendation, confirm):** show only the 100-year floodplain and the 0.2 % band; never show
   FEMA's "AREA OF MINIMAL FLOOD HAZARD" text or shape.
5. **Model inundation in Public (decision):** options: (a) NWM model layers in Command and Forensic only, Public shows
   official layers and satellite water (recommended: simpler, and model output stays out of the public view); (b)
   also in Public, behind "Show model".

## 10. Evidence log (2026-11-04, UTC)

| Time | Request | Result |
|---|---|---|
| 19:51 | api.weather.gov `/alerts/active?event=<16 flood types>` | 200, 327 KB, 0.93 s, 49 products |
| 19:52 | `/products/types/FLW/locations/DVN`, `/FLS/…`, `/products/39b8ab00-…` | 200; H-VTEC `SIGI4.1.ER` found |
| 19:52 | IEM `json/vtec_event.py` DVN FL.W 92; `api/1/openapi.json` | 200, `hvtec_nwsli` SIGI4 |
| 19:52 | IEM `api/1/nws/current_flood_warnings.geojson` | 200, 21 KB, 24 warnings |
| 19:52 | IEM `api/1/vtec/sbw_interval.geojson` (`ph=FF,FA`, then `ph=FF&ph=FA`) | 200 empty; 200, 32 polygons |
| 19:53 | weather.gov API docs, disclaimer; IEM disclaimer; `/zones/county/IAC011`; `/alerts/types` | 200 |
| 19:53 | NWPS swagger; `/gauges` Iowa | 200; 532 gauges, 3.2 s |
| 19:53 | NWPS `/gauges` lower 48 | 200, 12.6 MB, 45.5 s, 12,362 gauges |
| 19:54 | NWPS `/gauges/ARCF1`, `/stageflow`, `/reaches/16807219`, `/streamflow` ×2 | 200, 0.3-1.2 s |
| 19:55 | water.noaa.gov `/about/api`, `/about/nwm`, `/about/output_file_contents` (200); `/about`, `/about/disclaimer` (404) | — |
| 19:56 | maps.water.noaa.gov root, 4 folders, `flash` (499), `reference`, `tools` | 200 |
| 19:56-20:01 | RFC inundation (metadata, counts in 5 regions, bbox GeoJSON full and simplified, layers), public FIM domain, 8 NWM services (metadata, counts, samples), CatFIM (sites, ARCF1 major) | about 75 requests, 0.2-0.9 s, no failure |
| 19:57 | AWS `noaa-nwm-pds` listing | 200, dates 2025-01-01 … 2026-11-04 |
| 19:58 | USGS v0 collections; v0 `monitoring-locations` | 200; **429**, `Retry-After: 2175` |
| 19:58 | USGS v0 `latest-continuous`; docs, keys, versioning, migration, blog ×3, copyright, provisional statement, HADS file | 200 |
| 19:59-20:03 | hazards.fema.gov NFHL: root, layer 28, count, GeoJSON, export ×2, layer 0 | 14 attempts, **8 resets**, 1° export failed 4/4 |
| 20:00 | fema.gov NFHL page (403), msc.fema.gov (reset), NFHLWMS page (200), ArcGIS item search and item | — |
| 20:01-20:06 | CMR collections, granules (HLS, S1), UMM-C, UMM-G; PO.DAAC protected file (302 to URS), browse PNG (303 → 200); spec PDF | 200 |
| 20:03-20:05 | GIBS WMTS capabilities (5.8 MB), 2 tiles, layer metadata ×2, colour maps (404) | 200 / 404 |
| 20:04-20:07 | Earthdata GIS search, ImageServer metadata, catalog query ×2, exportImage ×2 | 200; raw classes returned |
| 20:06 | SSEC RealEarth products, about, pro, policy pages; GFM API (200 page, 401 data); GFM info page | — |
| 20:08 | hydro.nationalmap.gov NHDPlus_HR, nhd metadata (200); NWM flowlines count (200); NHD layer 6 count and GeoJSON (timeout 60 s ×2) | — |
| 20:09 | 3DEP identify (200, 18 s); Mapterhorn tilejson (200) | — |
| 20:10 | NWPS `/gauges` SE half (**504, 60.6 s**); `rfc_max_forecast` layers | — |
| 20:11 | NWS mapservices `water` folder, `riv_gauges` metadata, status counts, flooding gauges (0.2 s), layer 15 | 200 |
| 20:12 | NWPS tiles: -90,30,-80,38 (**504, 60.3 s**); -125,40,-115,49 (200, 20.8 s) | — |
| 20:13 | `rfc_max_forecast` count, ARCF1, status counts | 200 |
| 20:14 | CMR newest 200 CONUS granules, HLS and S1 (latency) | 200 |
| 20:15 | USGS v1 `monitoring-locations`, `continuous` (Nov 3 and Jul 4, 2025) | 200; v1 collection page 429 |
| 20:16 | IEM `json/` index, `vtec_events_bystate.py` (422 without `year`, then 200, 3.6 MB, 10.7 s) | — |
| 20:17 | weather.gov/vtec page, VTEC explanation v9.0 PDF, PNS 26-62 PDF | 200 |

Downloads were kept in the session scratchpad only; nothing was added to the repository except this file.
