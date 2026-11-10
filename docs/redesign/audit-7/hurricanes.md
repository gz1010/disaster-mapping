# Audit 7: hurricanes (tropical cyclones) as a third hazard

Role: brief-7 planning, research task "hurricanes". **Planning only**: no app code changed, no bundle built, no server
started, no secret read or used. Checked **2026-11-10, 17:10-17:35 UTC** from the cloud session with about 75 small
GETs (curl, one at a time, User-Agent `Disaster Mapping research prototype (hurricane source audit)`), 17 page reads
and 11 web searches. The evidence log is section 12. Everything marked **measured** was seen in a real answer today;
everything marked **not verified** is from general knowledge or a secondary page and must be checked before a build.

The Atlantic was quiet today (no active storm), so live field shapes were read from Tropical Storm Pena in the
Central Pacific (out of scope for the app) and file contents from **Hurricane Isaias (AL092026)**, which made
landfall near Destin, Florida on Oct 9-10, 2026.

## Words used here (plain)

- **Tropical cyclone**: the general word for a rotating storm that forms over warm sea. By wind speed it is a
  tropical depression (under 39 mph), a **tropical storm** (39-73 mph, gets a name) or a **hurricane** (74 mph and
  up). A **major hurricane** is Category 3 or more (111 mph and up). The category counts **wind only**, not water.
- **NHC**: the National Hurricane Center (Miami), part of the National Weather Service (NWS). It is the official
  voice for Atlantic and East Pacific storms. **WFO**: a local NWS office (for example "NWS Mobile AL").
- **Advisory**: NHC's forecast package for one storm. A full one comes every 6 hours (03, 09, 15, 21 UTC); in
  between, an "intermediate" one (numbered 12A, 13A …) comes every 3 hours while coastal watches or warnings are up.
- **Watch / warning**: a watch means the hazard is *possible* (about 48 hours ahead), a warning means it is
  *expected* (about 36 hours ahead). There are separate ones for wind (Tropical Storm, Hurricane) and for water
  (Storm Surge).
- **Cone**: the area where the storm's **centre** will probably travel. It says nothing about the storm's size.
- **Storm surge**: sea water pushed onto land by the storm's wind. **Inundation**: how high that water stands above
  ground that is normally dry.
- **Best track**: NHC's after-the-fact record of where the storm really was and how strong, every 6 hours.
  **HURDAT2** is the final, reviewed version, published the next year.
- **Guidance / "spaghetti"**: the track forecasts of many computer models drawn together as thin lines. Guidance
  is **model output**; the NHC forecast is made by people who look at it.
- **ATCF / a-deck / b-deck**: NHC's forecast database. For each storm, the **a-deck** file holds every model's
  forecast ("aids"), the **b-deck** the working best track. Each model has a 4-letter code (`OFCL` is NHC itself).
- **Ensemble**: one model run many times with slightly different starts (for example 31 or 51 "members") to show
  how uncertain the forecast is.
- **Tracker**: a program that finds the storm centre in a model's gridded weather maps and writes a track.
- **SLOSH**: NOAA's storm surge model. **P-Surge** runs SLOSH hundreds of times around the official forecast.
  **MOM / MEOW**: pre-computed worst-case SLOSH maps per hurricane category, for planning, not a forecast.
- **VTEC / ETN**: the code line in NWS warnings and its event number (brief 5). For tropical products the event
  number is 1000 + the storm's number (measured: Isaias, storm 09, has ETN 1009).

## 0. Summary

### 0.1 Verdicts

| # | Source | Kind | Verdict under CLAUDE.md | Why, in one line |
|---|---|---|---|---|
| 1a | NHC `CurrentStorms.json` | official | **Use** | One small file lists every active storm with links to all its products and their own update times |
| 1b | NOAA map service `tropical/NHC_tropical_weather_summary` (and the per-storm one) | official | **Use** | GeoJSON for track points, cone, coastal watch/warning lines, wind radii, arrival times, wind probabilities; 0.2 s |
| 1c | NHC GIS files (zip shapefile, KMZ) and their archive | official | **Use** | Same content per advisory, kept for every storm since 2008: this is what makes replay possible |
| 1d | NHC text products (TCP, TCM, TCD, PWS, TCU) via api.weather.gov, NHC's archive pages and IEM | official | **Use** | Verbatim wording with issuer and time; api.weather.gov keeps about 7 days, the archives keep all |
| 1e | NWS alerts: Hurricane / Tropical Storm / Storm Surge Watch and Warning, Extreme Wind Warning, local statements | official | **Use** | Already the app's alert route; zones give "warnings for your place" |
| 1f | Potential Storm Surge Flooding Map (GeoTIFF per advisory) and Peak Storm Surge | official | **Use with care** | Reasonable worst case (1-in-10), not "the" flood; 23 MB per advisory; only when US surge watches are up |
| 1g | National Storm Surge Risk Maps (SLOSH MOMs, version 4) | official, static | **Use with care** (background, off by default) | Worst case per category for planning; NHC says they do not replace evacuation zones |
| 1h | WPC rainfall (QPF, Excessive Rainfall Outlook), SPC tornado outlooks | official | **Use** | Free NOAA map services; the storm's rain and tornado sides |
| 2a | HURDAT2, ATCF a-deck / b-deck archive, NHC advisory and GIS archives | history | **Use** | Free, public, complete; Helene and Milton (2024) and the 2026 storms are all there |
| 2b | IEM archive of NWS tropical warnings and NHC text | history | **Use** (labelled archived) | Past warnings with zone shapes and verbatim NHC text; same route as floods |
| 3a | ATCF public a-deck (`aid_public`) | models | **Use**, but see 3e | About 90 model codes per storm (30 of them GEFS members) in one small file, updated through the day; no ECMWF in real time |
| 3b | NOAA NOMADS `ens_tracker` (GFS, GEFS, **AIGFS, AIGEFS, HGEFS**, Canadian and Navy ensembles) | models | **Use** | NOAA's own AI model tracks in ATCF text; 00Z run on the server by 04:04 UTC |
| 3c | HAFS-A / HAFS-B (NOMADS, AWS open data) | models | **Use** | NOAA's hurricane model; per-storm track files; AWS history from June 2023 |
| 3d | ECMWF open data track files (IFS, ENS, **AIFS, AIFS-ENS**) | models | **Use with care** | CC BY 4.0 with a fixed credit; BUFR format needs a decoder (a new dependency); online for 2-3 days only |
| 3e | Google DeepMind cyclone tracks (rows `GDMN`, `GDMI`, `GDM2` inside NHC's public a-deck; Weather Lab downloads) | models | **Do not use until the user changes the rule** | It is Google data, even when NOAA hands it on. Section 3.3 lists exactly what using it involves |
| 3f | Our own tracker over gridded AI forecasts | models | **Do not build now** | Every public AI model already publishes tracks; a tracker adds work, not information |
| 3g | Wind field from a track (Holland-type formula) | our model | **Use with care**, after the official wind radii | Honest only as "experimental estimate"; NHC already gives official wind extents |
| 3h | Running a surge model ourselves | our model | **Do not use** | NHC's P-Surge product exists and is official; our own surge would be weaker and riskier |

### 0.2 Key findings, in order of impact

1. **Everything official is free, public and machine-readable.** NHC publishes each advisory as text, as
   shapefile/KMZ and through a NOAA ArcGIS service that answers in GeoJSON. No key, no account. NHC's metadata
   says: "Use constraints: None. Acknowledgement of the National Oceanic and Atmospheric Administration, National
   Weather Service, National Centers for Environmental Prediction or the National Hurricane Center would be
   appreciated" (measured in the Isaias cone file).
2. **Replay out of season works from official archives.** For Isaias 2026 the archive holds 20 advisories, 11
   intermediate ones, 11 updates, a cone and wind-radii file per advisory, and 13 storm-surge flooding maps
   (advisories 2-14). Helene 2024 has 70 cone and wind-radii files. Helene's archived a-deck holds 277 model
   codes.
3. **Google DeepMind's tracks are inside NHC's own public file.** The a-deck for Isaias contains 420 rows `GDMN`,
   195 `GDMI` and 40 `GDM2` (measured). News reports and summaries of NHC's 2025 verification report name `GDMI`
   as the Google DeepMind aid (its ensemble mean); by ATCF's naming habit `GDMN` is the run itself and `GDMI` /
   `GDM2` the same run shifted 6 and 12 hours (not verified: NHC's public code list dates from 2021). So a
   "spaghetti of public model tracks" shows Google data unless the app filters those rows. This is the user's
   decision (section 3.3, question Q1).
4. **NOAA runs its own AI models and publishes their storm tracks.** `aigfs`, `aigefs` and `hgefs` have tracker
   folders on NOMADS (measured); NOAA made them operational on Dec 17, 2025. ECMWF publishes track files for its
   AI models AIFS and AIFS-ENS next to its physics models (measured). **AI guidance is possible without Google.**
5. **ECMWF is missing from the real-time public a-deck** (0 rows for Isaias) but present in the archived one (51
   ensemble members and the main run for Helene). Live ECMWF tracks must come from ECMWF's own open data.
6. **Tropical warnings join to the storm by number.** NWS event number 1009 = Atlantic storm 09 (Isaias); 1002 =
   storm 02 (Bertha). That is the key that groups local warnings under "one storm".
7. **The official surge map arrives late and is big.** For Isaias advisory 12 (15:00 UTC) the map file was posted
   at 15:53:50 UTC, and it is 23.5 MB. The app must show the advisory it belongs to and crop it per place.
8. **The cone changed in 2026.** It is 4-8 % smaller than in 2025 (Atlantic radius 200 nautical miles at 5 days),
   the cone picture now carries inland watches and warnings, and NHC is testing a second, wider "90 %" cone made
   of ellipses. The app must name which cone it draws.
9. **A hurricane model of our own is not the honest first step.** The official forecast plus labelled public
   guidance, scored against the best track after the fact, gives the user "models" and a benchmark with no claim
   the app cannot back.

### 0.3 Recommended first slice (details in section 9)

**Official hurricanes in 2D, with replay and a guidance layer from NHC's public file**: a third option
"Hurricanes" in the hazard switch; a storm list; Public and Command views drawn only from NHC and NWS products;
three recorded storms to test with (Helene 2024, Milton 2024, Isaias 2026); and the public a-deck spaghetti with
the Google rows left out until the user decides. About **13-14 hours** of agent build time in seven roles (17-18
with the independent reviews; 10-11 without the guidance layer). 3D surge, the flood link, ECMWF and scoring follow
as separate slices.

---

## 1. Official information: what NHC issues and how to read it by machine

### 1.1 The advisory package

Read on NHC's product description page (`https://www.nhc.noaa.gov/aboutnhcprod.shtml`, 2026-11-10):

| Product | Code | What it holds | When |
|---|---|---|---|
| Public Advisory | TCP | Position, wind, movement, pressure; the list of watches and warnings; hazards (surge heights, wind, rain, tornadoes, surf) in plain words | Every 6 h (Atlantic: 5 and 11, AM and PM, EDT). "Intermediate public advisories are issued every 3 hours when coastal watches or warnings are in effect" |
| Forecast/Advisory | TCM | The numbers: forecast positions, winds and wind radii at 12, 24, 36, 48, 60, 72, 96, 120 h | "every six hours at 0300, 0900, 1500, and 2100 UTC" |
| Discussion | TCD | The forecaster's reasoning and the **Key Messages** | Every 6 h |
| Wind Speed Probabilities | PWS | Chance of 34, 50, 64 knot winds at named places | Every 6 h |
| Update | TCU | Short notice of a sudden change (landfall, new warning) | Any time |
| Watch/Warning list | TCV | US wind and surge watches and warnings by zone | With each advisory when they change |
| Tropical Weather Outlook | TWO | Areas that may become a storm in 2 and 7 days, with a formation chance | 00, 06, 12, 18 UTC, May 15 - Nov 30 |

Measured: the Isaias archive page lists 20 forecast advisories, 20 public advisories, 20 discussions, 15 wind
probability products, 11 intermediate public advisories and 11 updates.

### 1.2 The feeds

| Route | Address | What comes back (measured 2026-11-10) | Account / cost |
|---|---|---|---|
| Active storm list | `https://www.nhc.noaa.gov/CurrentStorms.json` | 4.6 KB. Per storm: `id` ("cp042026"), `binNumber`, `name`, `classification`, `intensity` (knots), `pressure`, position, movement, `lastUpdate`, and one block per product with `advNum`, `issuance`, `fileUpdateTime` and a link (text page, zip, KMZ) | none / free |
| Map service, all storms | `https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer` | 35 layers: outlook areas, forecast points, track, cone, watch/warning lines, past track, past wind swath, wind radii, arrival times, surge flooding raster, wind probabilities. Queries answer in GeoJSON in 0.2-0.3 s. "Update Frequency: Every 6 hours and every 3 hours if the storm is approaching the shore." `maxRecordCount` 2000 | none / free |
| Map service, per storm slot | `…/tropical/NHC_tropical_weather/MapServer` | 400 layers: the same set for each "wallet" AT1-AT5, EP1-EP5, CP1-CP5 | none / free |
| Other tropical services | `…/tropical/NHC_PeakStormSurge`, `…/tropical/StormSurgeRisk`, `…/tropical/NHC_Breakpoints` | Peak surge (points, lines, polygons); the static risk maps by category; the coastal breakpoints | none / free |
| GIS files | linked from `https://www.nhc.noaa.gov/gis/` | Zip shapefiles and KMZ per advisory; archive pages by year back to 2008 (surge flooding map from 2016, peak surge from 2022) | none / free |
| RSS | `https://www.nhc.noaa.gov/index-at.xml`, `nhc_at1.xml` … `nhc_at5.xml`, `gis-at.xml` | Per-basin and per-storm feeds (not needed if the JSON is used) | none / free |
| Text products | `https://api.weather.gov/products/types/{TCP,TCM,TCD,PWS,TCV,HLS,TCU,TWO}` | Lists with office and time; about 7 days kept (oldest TCP today: Nov 3) | none / free |
| Alerts | `https://api.weather.gov/alerts/active?event=…` | Event names include Hurricane Warning/Watch, Tropical Storm Warning/Watch, Storm Surge Warning/Watch, Extreme Wind Warning, Tropical Cyclone Local Statement (111 names in all). 0 active today | none / free |

Field shapes worth knowing (measured on the live summary service):

- **Forecast points** (layer 5): `stormname`, `stormtype` (TS, HU, MH for major hurricane, TD, STS …), `advisnum`,
  `advdate` ("500 AM HST Tue Nov 10 2026"), `tau` (hours ahead: 0, 12, 24, 36, 48, 60, 72, 96, 120), `maxwind` and
  `gust` in knots, `mslp` (9999 when not forecast), `ssnum` (category), `tcdvlp` ("Tropical Storm"), `lat`, `lon`,
  `validtime` ("10/1200"), `idp_source` ("cp042026-016_5day_pts"), `idp_filedate`.
- **Cone** (layer 7): one MultiPolygon per storm with `advisnum`, `advdate`, `fcstprd` 120.
- **Watch/warning lines** (layer 8; in the zip `…_ww_wwlin`): coastal line pieces with `TCWW` codes. Measured in
  Isaias advisory 12: `TWR` (tropical storm warning) and `HWR` (hurricane warning). `TWA` and `HWA` are the watch
  codes by NHC's convention (not seen today).
- **Forecast wind radii** (layer 15): `radii` 34 / 50 / 64 knots, `tau`, `validtime`, and the reach in nautical
  miles per quadrant `ne`, `se`, `sw`, `nw`.
- A storm crossing the date line reports longitudes below -180 (Pena: -185, -189). Not a lower-48 problem, but a
  parser must not choke on it.

Timing, measured:

| What | For which advisory | Seen at |
|---|---|---|
| Text products on the web (`fileUpdateTime`) | Pena 16, nominal 15:00 UTC | 14:40-14:43 UTC |
| Track, cone, radii zip and KMZ | same | 14:44-14:45 UTC |
| ArcGIS service copy (`idp_filedate`) | same | 15:02:45 UTC; forecast radii 15:17:38 UTC |
| Wind speed probability GIS | 12:00 UTC run | 15:23 UTC |
| Potential Storm Surge Flooding Map zip | Isaias 12, nominal 15:00 UTC | 15:53:50 UTC (NHC's own text: "60 to 90 minutes after a full advisory") |

**What this means for the app.** One poll of `CurrentStorms.json` every few minutes tells the app that a new
advisory exists; it then reads the summary map service (or the zip) once. Each layer carries its own advisory
number and time, so the app can always show "NHC Advisory 12, 10:00 AM CDT Fri Oct 9" beside what it draws, and
must show the surge map with *its own* advisory number because it lags the track by an hour.

### 1.3 The products one by one

| Product | Route for the app | Fixed caveat to show with it (NHC's own words, read 2026-11-10) |
|---|---|---|
| Forecast track and points | map service layers 5-6 / `…_5day_NNN.zip` | (issuer, advisory number and time) |
| Cone | layer 7 / same zip | NHC prints on every cone graphic: "The cone contains the probable path of the storm center but does not show the size of the storm. Hazardous conditions can occur outside of the cone." Each circle is sized "so that two-thirds of historical official forecast errors over the previous five years (2021-2025) fall within the circle" |
| Coastal watch/warning lines | layer 8 / `…_ww_wwlin` | The TCV "can only convey an approximate description of the watch/warning areas" |
| Watches and warnings by zone (inland too) | NWS alerts (api.weather.gov), zone outlines as for flood watches | Issuer is the local NWS office; verbatim headline and instruction |
| Wind field now and forecast wind radii | layers 15-16 / `…_fcst_NNN.zip` | Radii are the largest reach in each quarter: not every place inside gets that wind |
| Past wind swath | layer 12 | "the areas potentially affected so far" |
| Wind speed probabilities | layers 30-32 / `…_wsp_120hr5km.zip` (5 km), GRIB on `ftp.nhc.ncep.noaa.gov/wsp/` | Small numbers matter: probabilities that "may seem relatively small (e.g., 5-10%) may still be quite significant" |
| Arrival time of tropical-storm-force winds | layers 18-19 / KMZ, GRIB2 on `ftp.nhc.ncep.noaa.gov/toa/` | "Earliest reasonable": no more than a 1-in-10 chance the winds start before it. "Most likely": equally likely before or after |
| Storm Surge Watch/Warning | NWS alerts (zones); NHC KML | Warning: "a danger of life-threatening inundation" generally within 36 hours; watch: possible within 48 hours |
| Peak Storm Surge Forecast | `NHC_PeakStormSurge` service; the TCP text | Heights are "above normally dry ground somewhere within the specified areas", if the peak comes at high tide |
| Potential Storm Surge Flooding Map | `AL{nn}{yy}_{adv}_inundation.zip` (GeoTIFF) and `_tidalmask.zip`; raster layers in the map service | "a reasonable worst-case scenario": "approximately a 1-in-10 chance" of being exceeded. It includes tides; it leaves out waves, rain, river flow and levee failure. Leveed areas are hatched: "Users are urged to consult local officials" |
| Tropical Weather Outlook | layers 1-3 / `gtwo_shapefiles.zip` | Formation chance words are NHC's ("low", "medium", "high" chance of *formation*, not of harm): quote them inside a verbatim element only |
| Key Messages | inside the TCD text | Verbatim, with advisory number |

The surge flooding raster uses these classes (measured in NHC's sample metadata): 1 = less than 1 foot above
ground, 2 = 1 to 3 feet, 3 = greater than 3 feet, 4 = greater than 6 feet, 5 = greater than 9 feet, 7 = levee
areas, 15 = high tide mask.

An example of the wording the app must carry unchanged (Isaias Advisory 12, archived copy from IEM, measured):

> A Storm Surge Warning is in effect for... * Mouth of the Mississippi River to the Suwannee River
>
> AL/FL Border to Grayton Beach, FL...6-9 ft
>
> Promptly follow evacuation and other instructions from local officials.

### 1.4 What changed in 2026

From "National Hurricane Center Products and Services Update for 2026 Hurricane Season"
(`https://www.nhc.noaa.gov/pdf/2026NHCNewProductsAndServices.pdf`, read 2026-11-10):

- The cone graphic "with a depiction of inland tropical storm and hurricane watches and warnings for the United
  States becomes operational". In rare cases a "preliminary" cone with coastal warnings only comes first.
- Cone circle radii for 2026 (Atlantic, nautical miles): 3 h 16, 12 h 25, 24 h 39, 36 h 49, 48 h 62, 60 h 77,
  72 h 95, 96 h 134, 120 h 200. The Atlantic cone is "about 4–8% smaller as compared to 2025".
- A new **experimental cone**: ellipses instead of circles, sized to "the 90th percentile of the along- and
  cross-track errors", so the centre "would be expected to fall within each ellipse 90% of the time". Whether it is
  published as GIS data was **not verified**.
- Storm surge watches, warnings, peak surge and the flooding map now also exist for Hawaii (out of scope).
- A gray X in the outlook for systems not expected to develop; experimental marine wind warning shapefiles; a
  mobile-friendly front page.

**What this means for the app.** Draw the operational cone and label it "NHC forecast cone: where the centre may
go (two times out of three)". Do not rebuild a cone from the radii when NHC's own polygon is available; keep the
radii table only to draw cones for model-free teaching views or for tests.

### 1.5 Rain, tornadoes and rivers

| Source | Address | Measured | Use |
|---|---|---|---|
| WPC rainfall forecast (QPF) | `https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer` | Layers for 6-hour steps and day 1 to day 7 totals | Official rain amount polygons; "Storm total rainfall" in the advisory points to it |
| WPC Excessive Rainfall Outlook | `…/vector/rest/services/hazards/wpc_precip_hazards/MapServer` | Days 1-5 | Official flash-flood chance areas |
| SPC outlooks | `…/vector/rest/services/outlooks/SPC_wx_outlks/MapServer` | Day 1-3 with a tornado probability layer | Tornado side of a landfall |
| Tornado and flash flood warnings | api.weather.gov alerts | already used | Shown as today |
| River forecasts, gauges, flood maps | the app's flood views (brief 5, 6) | already built | Linked, not copied (section 5.4) |

After NHC stops advisories on a storm that has moved inland, the Weather Prediction Center continues public
advisories while the rain threat lasts (NWS practice; **not verified** today). The app should follow the storm id
across that hand-over and keep the issuer name it finds in each product.

### 1.6 Terms and credit lines

| Source | Terms (page, date read) | Credit line to use |
|---|---|---|
| NHC products, GIS, map services | NWS disclaimer `https://www.weather.gov/disclaimer` (2026-11-10): NWS information is "in the public domain, unless specifically noted otherwise, and may be used without charge for any lawful purpose"; do not "modify its content and then present it as official government material", do not imply endorsement. NHC GIS metadata: "Use constraints: None" with acknowledgement "appreciated"; "No responsibility is assumed by the National Oceanic and Atmospheric Administration in the use of these data" | `NOAA / NWS National Hurricane Center` plus advisory number, time and a link to hurricanes.gov |
| NWS alerts and local statements | same disclaimer | `National Weather Service` + office name (as today) |
| WPC, SPC | same disclaimer | `NOAA / NWS Weather Prediction Center`; `NOAA / NWS Storm Prediction Center` |
| National Storm Surge Risk Maps | `https://www.nhc.noaa.gov/nationalsurge/` (2026-11-10): "as is"; for awareness, not for parcels; the maps "should not be used to replace the maps used for hurricane evacuation zones" | `NOAA / NWS National Hurricane Center, National Storm Surge Risk Maps version 4 (Zachry et al. 2015)` |
| IEM archive | as in CONTRACT 16.15 | `National Weather Service, archived copy via the Iowa Environmental Mesonet (Iowa State University)` |

The NWS name and emblem are trademarks: naming the issuer of unaltered content is allowed, using the logo is not
without permission. The app shows names, never logos.

---

## 2. Past storms: what is public for replay and for scoring

| Source | Address | Measured 2026-11-10 | History | Verdict |
|---|---|---|---|---|
| HURDAT2 (final best track) | `https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-092326.txt` | 7.07 MB, last modified 2026-09-30; supports byte ranges. Rows every 6 h plus landfall rows marked `L`, with wind, pressure and 34/50/64-knot radii per quadrant | 1851-2025 (2026 comes in 2027) | **Use** |
| Working best track (b-deck) | `https://ftp.nhc.noaa.gov/atcf/btk/` and `…/atcf/archive/{year}/b…dat.gz` | 2024 archive: 34 a-, b-, e- and f-deck files each; Helene's b-deck 1.1 KB | current season and back | **Use** for the current year |
| NHC GIS archive | `https://www.nhc.noaa.gov/gis/archive_forecast_results.php?id=al09&year=2024&name=…` | Helene: 70 files (cone and radii per advisory incl. intermediate). Isaias 2026: 26 surge flooding files | cone 2008+, surge map 2016+ | **Use** |
| NHC advisory archive | `https://www.nhc.noaa.gov/archive/2026/ISAIAS.shtml` → `…/al09/al092026.public.012.shtml` | 98 links for Isaias | 1998+ (not verified) | **Use** |
| ATCF a-deck archive (model guidance) | `https://ftp.nhc.noaa.gov/atcf/archive/2024/aal092024.dat.gz` | Helene: 984 KB, 76,234 rows, 277 codes, incl. ECMWF (`EMX`, `EE01`-`EE50`), GEFS, HAFS, HWRF, HMON, Canadian, consensus. Milton: 1.6 MB | by year | **Use** |
| IEM archive | `https://mesonet.agron.iastate.edu/json/vtec_events_bystate.py?state=FL&year=2026&phenomena=HU&significance=W`; `/geojson/vtec_event.py`; `/cgi-bin/afos/retrieve.py?pil=TCPAT4…` | 2 hurricane-warning events for Isaias in Florida (NWS Mobile, NWS Tallahassee), 29 zone shapes for the Mobile one, and the full text of Advisory 12 | years | **Use**, labelled archived |
| Tropical Cyclone Reports | `https://www.nhc.noaa.gov/data/` | Listed for 1995-2025 (the 2026 ones are not out yet) | — | Link only |
| IBTrACS (world best tracks, NOAA NCEI, doi:10.25921/82ty-9e16) | not fetched | Terms not found in a search | — | Not needed (HURDAT2 covers the scope) |

Landfalls in the lower 48, from HURDAT2 `L` rows (measured) and, for 2026, from NHC files and news reports:

| Storm | ATCF id | Landfall | Why it is a good test |
|---|---|---|---|
| Helene | AL092024 | 2024-09-27 03:10 UTC, 30.0N 83.7W (Florida Big Bend), 120 kt, 939 mb | Surge on a flat coast, then far-inland river floods (the flood link) |
| Milton | AL142024 | 2024-10-10 00:30 UTC, 27.4N 82.6W (west Florida), 100 kt, 958 mb | Fast intensity change, cone and warning replay, tornadoes ahead of landfall |
| Beryl, Debby, Francine | AL022024, AL042024, AL062024 | Texas Jul 8; Florida Aug 5 and South Carolina Aug 8; Louisiana Sep 11 | Extra cases if wanted |
| Chantal | AL032025 | 2025-07-06 08:00 UTC, 33.6N 79.0W (South Carolina), 45 kt | The only 2025 lower-48 landfall: a weak storm, mostly rain |
| Isaias | AL092026 | Near Destin, Florida, about 01:30 UTC Oct 10, 2026 (news reports; a-deck positions 27.0N 87.6W at 105 kt on Oct 9 12Z and 30.2N 86.6W at 95 kt on Oct 10 00Z, measured) | Newest case: all 2026 products incl. inland warnings on the cone and Google rows in the a-deck |
| Arthur, Bertha, Edouard | AL012026, AL022026, AL052026 | Texas Jun 17-18, Louisiana Jul 22, Louisiana Sep 1 (Wikipedia, not verified against NHC; consistent with tropical storm warnings of event 1002 on Jul 21-22 and P-Surge folders dated Aug 31 and Sep 1, both measured) | Tropical storms: rain-led cases |

**What this means for the app.** A past storm can be rebuilt from public files alone: the b-deck or HURDAT2 for
what happened, the GIS archive for what NHC forecast at each advisory, IEM for the warnings, the a-deck for what
the models said. Nothing needs to be invented for a fixture.

---

## 3. Models (always labelled as model output, never merged with official)

### 3.1 How hurricane guidance works, in five lines

Each model starts from the current weather and steps forward. A tracker then finds the storm in each forecast and
writes "position, wind, pressure" every 6 hours. NHC collects these in the a-deck under 4-letter codes. A code
ending in `I` (or `2`) is an older run shifted to the present position ("interpolated"), because the big models
finish hours after the advisory deadline. "Consensus" codes (`TVCN`, `HCCA`) are averages of several models and are
usually better than any single one. The official forecast `OFCL` is made by people after looking at all of them.

### 3.2 Sources

| Source | Who runs it | Route (measured 2026-11-10) | Account, cost | Resolution, length, cadence | History | Terms and credit | Verdict |
|---|---|---|---|---|---|---|---|
| ATCF public a-deck | NHC | `https://ftp.nhc.noaa.gov/atcf/aid_public/aal092026.dat.gz` (432 KB for Isaias; 62 files in the folder for all basins; Atlantic storms 01-10 and "invests" 90-99) | none, free | One row per model, run, hour and wind radius. Isaias: 91 codes over 25 run times. Runs every 6 h; files are rewritten as aids arrive (the folder's last change was 14:43 UTC, in step with the 15:00 UTC advisory of the live Pacific storm) | `…/atcf/archive/{year}/` | README: "provided 'as-is'"; users are "REQUIRED to perform quality control"; data "can differ from information issued in official NHC products". Credit `NOAA / NWS National Hurricane Center, ATCF guidance (a-deck)` plus each model's owner | **Use** (filter rule in 3.3) |
| GFS, GEFS (31 members), Canadian and Navy ensembles; **AIGFS, AIGEFS, HGEFS** | NOAA NCEP (and partners) | `https://nomads.ncep.noaa.gov/pub/data/nccf/com/ens_tracker/prod/{aigfs,aigefs,hgefs,gfs,gefs,cmce,fens}.YYYYMMDD/HH/tctrack/*.trackatcfunix` (AIGFS 00Z file 5.7 KB, written 04:04 UTC) | none, free | ATCF text, 6-hour steps, seen to 132 h; 4 runs a day. AIGFS forecasts 16 days, AIGEFS has 31 members, HGEFS 62 (NOAA announcement, Dec 17, 2025; grid spacing not verified) | 2 days on NOMADS | NOAA, public domain. Credit `NOAA / NWS NCEP` + model name | **Use** |
| HAFS-A (`HFSA`), HAFS-B (`HFSB`) | NOAA NCEP | NOMADS `…/com/hafs/prod/hfsa.YYYYMMDD/`; AWS `https://noaa-nws-hafs-pds.s3.amazonaws.com/hfsa/20261009/12/09l.2026100912.hfsa.trak.atcfunix` (16 KB) | none, free ("no restrictions on the use of this data", AWS open-data registry as quoted in a search) | Storm-following high-resolution model; a-deck rows to 126 h; 4 runs a day; also a wind and rain "swath" GRIB2 file (307 MB) per run | AWS from 2023-06-19 | Credit `NOAA / NWS NCEP, HAFS` | **Use** |
| IFS (main run and 51-member ENS), **AIFS Single, AIFS ENS** | ECMWF | `https://data.ecmwf.int/forecasts/YYYYMMDD/HHz/{ifs,aifs-single,aifs-ens}/0p25/{oper,enfo}/…-tf.bufr` (00Z today, by the listing's times: IFS 33 KB at 06:55, ENS 1.1 MB at 07:41, AIFS 26 KB at 07:05, AIFS ENS 1.0 MB at 07:41) | none, free; 500-2000 connections shared by all users | Track files to 360 h (IFS 06/18Z to 144 h); 4 runs a day; grids at 0.25° (IFS also 0.1° since 2026-10-20) | "the most recent 12 forecast runs" (2-3 days); also on AWS, Azure, Google Cloud | CC BY 4.0 (`https://www.ecmwf.int/en/forecasts/datasets/open-data`, 2026-11-10). Credit in the form NHC uses in its own NOTICE file: `© 2026 European Centre for Medium-Range Weather Forecasts (ECMWF). Source www.ecmwf.int. Licensed CC BY 4.0. ECMWF does not accept any liability whatsoever for any error or omission in the data, their availability, or for any loss or damage arising from their use. This material has been modified from the original.` | **Use with care**: BUFR needs a decoder |
| Google DeepMind cyclone model ("WeatherNext Cyclones"; called FNV3 in 2025) | Google DeepMind | (1) rows `GDMN`, `GDMI`, `GDM2` in NHC's public a-deck; (2) Weather Lab downloads in CSV or ATCF; (3) open code and weights | (1) none; (2) Google sign-in (the page redirects to accounts.google.com); (3) none | a-deck rows 6-hourly to 102-108 h; Weather Lab: 15 days, many members (not verified) | Weather Lab: "approximately 2023 to present" | Section 3.3 | **Do not use** unless the rule changes |

Other things seen in the Isaias a-deck: `HWRF` and `HMON` rows are still present in 2026 (what produces them was
not checked); `NNIC` / `NNIB` are a neural-network intensity consensus; `TVCN`, `IVCN`, `HCCA`, `RVCN` are consensus
aids. The technique list in `atcf/docs/nhc_techlist.dat` dates from 2021 and has no entry for the newer codes, so
the app needs its own short table of code → plain name → owner, and should show unknown codes as "other aid".

**What this means for the app.** One reader for ATCF text covers the a-deck, the NOMADS tracker files and the HAFS
files. ECMWF needs a second reader. A "guidance" layer can therefore show, each with its owner's name: NOAA
physics models (GFS, HAFS), NOAA ensembles, NOAA AI models (AIGFS and the AIGEFS members), ECMWF physics and AI
models, and the consensus aids. That answers "how do we include AI models" for hurricanes without any account.

### 3.3 The Google question (to report, not to resolve)

CLAUDE.md says "No Google data, no paid map services, no Nominatim". Google DeepMind's cyclone forecasts are
Google data. There are three ways they could reach the app. The user decides (question Q1); until then the
recommendation is to **filter the three `GDM*` codes out** of anything the app shows or scores.

| Route | Account | Cost | What enters the app | What leaves the machine | Terms |
|---|---|---|---|---|---|
| A. NHC public a-deck rows `GDMN` / `GDMI` / `GDM2` | none | free | Track, wind, pressure, wind radii every 6 h, mixed in NOAA's file | nothing (a plain download from NOAA) | NHC's README and NOTICE files say nothing about Google (searched: no match for "Google", "GDM"). Whether Google's terms travel with these rows is **not verified**. Ask NHC or Google before showing them |
| B. Weather Lab (`https://deepmind.google.com/science/weatherlab`) download, CSV or ATCF | a Google account sign-in | free today ("We do not currently charge … we reserve the right to charge reasonable fees" with one month's notice) | Ensemble tracks and paired observed tracks, about 2023 to now | the user's Google identity, to Google | Data about "a time less than 1 hour ago and the future" falls under the *GDM Real-Time Weather Forecasting Experimental Data Terms of Use* (last modified 3 September 2026). Older data is CC BY 4.0 |
| C. Run the open model ourselves (`github.com/google-deepmind/weathernext`; code Apache 2.0, other materials CC BY 4.0) | none | compute: the README names a TPU "v5p" or an H100 GPU for the full models, a P100 for the 1° "Mini" ones | Our own run of Google's model | nothing | Research code "provided as-is"; "not an officially supported Google product". It also needs suitable starting weather data. Far outside this app's size |

What the real-time terms (route B, read in full on 2026-11-10 at
`https://storage.googleapis.com/weathernext-public/terms-of-use.pdf`) allow and forbid, in plain words:

- **Allowed**: "any internal purpose"; sharing with named people "solely for educational purposes"; publishing a
  "Value Added Service" from which the data cannot be got back out.
- **Not a Value Added Service**: "colouring, formatting, compressing … sub-setting of areas". A track drawn on a
  map is still the data. So, in this audit's reading (not legal advice), **a public page showing a live Google
  forecast track is not allowed** without Google's written agreement. On the user's own machine it is "internal".
- **Places**: the terms exclude residents of some countries (Japan, South Korea and Indonesia among them) and
  making the data available there. Not a problem for a user in the US; a problem for a public site.
- **Required when sharing results**: cite the Google product used and the sentence "© 2024-6 Google LLC, whose
  machine learning models were used to create the experimental data made available under the following licence
  terms https://storage.googleapis.com/weathernext-public/terms-of-use.pdf. This data is intended for experimental
  modelling only and is not intended, validated, or approved for real world use."
- **Disclaimers the app would have to respect**: the data is "not intended for consumer use" and "in no way
  replaces official alerts, warnings or notices".
- **Past storms are easier**: anything about a time at least one hour ago is CC BY 4.0. A replay of Helene or
  Isaias with Google's past tracks would need only the credit, not the real-time terms.

The user's own "WeatherNext 3" access is a different product (gridded weather through BigQuery, Earth Engine,
Google Cloud Storage or Google Maps Platform); the AI-models audit covers it. For hurricanes its only use would be
option (b) of section 3.6, a tracker over its grids, which this audit does not recommend.

How good is it? NHC's 2025 verification report is reported to say the Google aid "slightly outperformed" the
official Atlantic track forecast at 12-72 h (news summaries of
`https://www.nhc.noaa.gov/verification/pdfs/Verification_2025.pdf`; the report itself was **not read** today).
That is a reason the user may want it, not a reason to bend the rule quietly.

One more thing the user should know before answering Q1: NOAA's AIGFS was started from Google DeepMind's open
GraphCast model and then retrained by NOAA on NOAA's own analyses (NOAA announcement of Dec 17, 2025, as reported).
Its forecasts are NOAA products on NOAA servers, and this audit treats them as NOAA data. ECMWF's AIFS is ECMWF's
own model.

### 3.4 A tracker of our own

- **What exists**: TempestExtremes (open source, C++, reported BSD 2-clause; licence file **not verified**); NOAA's
  own tracker (its output is what NOMADS serves); Google's repository includes a tracker for its own models.
- **A simple tracker** is small: start at the last known centre, find the lowest sea-level pressure within a few
  hundred km in the next forecast step, read the highest 10 m wind near it, repeat. It needs pressure and wind
  grids every 6 hours, for example from AIFS open data (0.25°, index files allow partial downloads).
- **Honest value**: low. NOAA already tracks AIGFS and AIGEFS, ECMWF already tracks AIFS, Google publishes its own
  tracks. A tracker is only needed for a gridded model that publishes no tracks, and 0.25° grids underestimate
  the peak wind of a hurricane badly, so intensity from such a tracker would mislead (NOAA's own note on AIGFS
  version 1 reports weaker storm-intensity forecasts than the physics model).
- **Verdict**: do not build now. If the user wants it as a learning piece, validate it against ECMWF's own AIFS
  track file for the same run (a clean test), label it "Disaster Mapping tracker, experimental", and never show
  its wind speed as a forecast. Effort 3-5 hours, plus large downloads.

### 3.5 Impact models

| Impact | Official product that already exists | A model of our own | Verdict |
|---|---|---|---|
| Wind area | NHC wind radii per quadrant (now and forecast), past wind swath, wind speed probabilities, arrival times | A smooth wind field from track, peak wind and radii with a Holland-type formula (a known textbook method; about 150 lines) | Official first. Our field **with care**: label "Estimated wind field (from the NHC track and radii), experimental"; never beyond the official radii; needed mostly for the 3D picture |
| Wind, model | — | HAFS "swath" file (model's own peak wind and rain along the path, 307 MB per run, partial download possible) | Later, as "HAFS model output" |
| Storm surge, forecast | Potential Storm Surge Flooding Map (P-Surge), Peak Storm Surge | Running SLOSH or another surge model. No public SLOSH code was found (**not verified**) | Use NHC's. **Do not** model surge ourselves |
| Storm surge, planning | National Storm Surge Risk Maps (MOMs): GeoTIFF, 1-foot bins, about 10 m grid, version 4 (US file updated 2026-06-18), categories 1-5 | — | With care: off by default, titled "If a Category 3 hurricane hit here at high tide: near worst case (planning map, not a forecast)" |
| Surge and tide, model | — | NOAA STOFS-2D-Global water levels (`noaa-gestofs-pds` on AWS: 4 runs a day, 180 h, GRIB2 and station series; terms not stated on the bucket page) | Later, as model output for tide-gauge charts |
| Raw P-Surge grids | — | NOMADS `…/com/psurge/prod/` lists folders for Aug 31, Sep 1 and Oct 7-10, 2026, but the folder itself answered HTTP 403 today; the NDFD folder NHC links is empty out of season | Not needed: the GeoTIFF product is enough |
| Rain flooding | WPC rainfall and excessive-rain outlooks; NWS flood warnings; river forecasts | The National Water Model, already in the app as model output | Reuse the flood views |

### 3.6 What "a hurricane model" could honestly mean for this app

| Option | What the user would see | Honest? | Effort | Verdict |
|---|---|---|---|---|
| (a) Official forecast + labelled guidance | NHC track and cone, and behind a "Model guidance" switch thin lines per model with owner names, AI models marked, a separate key, and after the storm a score table (who was closest at 24, 48, 72, 120 h) | Yes: nothing is ours except the drawing and the arithmetic | 4-5 h on top of the official slice | **Use: this is the hurricane "model" feature** |
| (b) Our own tracker over AI weather forecasts | One more line on the map, made by us | Only as an experiment; adds no information over published tracks | 3-5 h | Not now |
| (c) Impact views | Wind extent, surge on terrain, rain and rivers, each from its official product, with at most one estimate of ours (the smooth wind field) | Yes, if each layer keeps its issuer and the estimate is labelled | 4-6 h | **Use**, after (a) |

---

## 4. The app: unit, ids, list and the hazard switch

### 4.1 The unit: one storm, many advisories

- **One hurricane event = one ATCF storm id** (for example `AL092026`). The name changes during a storm's life
  ("Potential Tropical Cyclone Nine", "Tropical Storm Isaias", "Hurricane Isaias", "Post-Tropical Cyclone
  Isaias"); the id does not. Proposed app id: `storm-al092026` (pattern `^storm-(al|ep)\d{6}$`), with the current
  name as a label and older names as aliases. Folder `data/storms/{id}/`, beside `data/incidents/` and
  `data/floods/`.
- **Time steps = advisories.** Each advisory (12, 12A, 13 …) is one frame with its own track, cone, warnings, wind
  radii and, when issued, surge products. The time handle steps from advisory to advisory, exactly as flood
  playback steps from satellite pass to satellite pass. Nothing is drawn "between" advisories except the best-track
  dots of where the storm really was.
- **Members of the event**: the NHC products of that id; NWS tropical watches and warnings whose event number is
  1000 + the storm number for an Atlantic storm (measured: ETN 1009 for Isaias in the NWS Mobile and Tallahassee
  products; the East Pacific numbering was not verified); local statements (HLS) from the offices involved; later,
  the linked floods.
- **Which storms are listed.** Proposal: every active Atlantic and East Pacific storm appears on the national map
  (there are rarely more than three), and a storm is marked "affects the lower 48" when its cone touches the lower
  48, or a US watch or warning is in effect there, or NHC's 34-knot wind probability reaches a lower-48 place. Other
  storms read "No forecast effect on the lower 48 states in the next 5 days (NHC Advisory n). Not an all-clear."
  Central Pacific storms are not listed. This rule is a question for the user (Q2).

### 4.2 The hazard switch

Today: `type Hazard = 'fire' | 'flood'` (CONTRACT 16.1), a **Fires / Floods** switch, `?hazard=flood`,
`?flood=<id>`. The addition follows the same pattern, beside and not inside the other two: a third literal, a third
segment "Hurricanes", `?hazard=storm`, `?storm=<id>`, its own routes (`/api/storms…`), contract types, store, map
module and scene branch. No fire or flood contract changes. Out of season the list is empty most days, so the
empty state matters: "No tropical storm or hurricane is active in the Atlantic or East Pacific (NHC, checked
17:10 UTC). Past storms: Isaias 2026, Milton 2024, Helene 2024 …", with the past-storm list one click away.

### 4.3 Reading the storm for one place

The app's point card ("what about my place") gets a hurricane block built only from official answers, each with
issuer, time and link:

1. NWS watches and warnings in effect at the point (alerts by point, as today).
2. "Is the point inside the NHC cone?" answered as a fact about the *centre's* path, always followed by the cone
   sentence in section 8.
3. NHC's chance of tropical-storm-force and hurricane-force wind at the point (wind speed probabilities), and the
   earliest reasonable and most likely arrival times.
4. The class of the Potential Storm Surge Flooding Map at the point, with "reasonable worst case" wording, or
   "NHC has not issued a storm surge flooding map for this storm" when there is none.
5. Evacuation: the existing evacuation row (California and Oregon zones; elsewhere "not available in this state")
   plus local officials' messages relayed by NWS. No new source in the first slice (section 8).

---

## 5. What the three views would show

### 5.1 Public (map first, no timeline)

- **Status circle**: a slowly turning spiral (still under reduced motion) with NHC's own class for the storm
  ("Hurricane · Category 3", "Tropical Storm", "Post-Tropical Cyclone") and the advisory time. For a selected
  place, the strongest NWS product in effect there ("Hurricane Warning · NWS Mobile AL").
- **Facts**: maximum sustained wind, movement, pressure, distance from the selected place, next advisory time,
  each "NHC Advisory n". NHC's headline and Key Messages verbatim.
- **Map**: past track dots, forecast track, the cone with its sentence, coastal warning lines, warning zones, the
  wind extent now (official radii). When issued: the surge flooding map, cropped to the coast in view, with its key.
- **Warnings for your place** and **arrival time** (section 4.3). **Peak surge** range for the coast segment, in
  NHC's words.
- **Not shown in Public**: model guidance (as with fires and floods, models stay out of the public view).

### 5.2 Command

- **Track chart with an intensity timeline**: time along the bottom; wind speed up the side with the category
  bands; the best track so far as a solid line; the selected advisory's official forecast as dots at 12-120 h. This
  takes the place the river-level chart has for floods, with the same handle, Play and step controls.
- **Advisory stepper**: step through advisories; the map, the readout and the verbatim panel follow. For a past
  storm the chart can add "what happened next" so the user sees the forecast against reality.
- **Guidance switch** (off by default): spaghetti of model tracks for the run nearest the selected advisory, in a
  muted style under the official track, with its own key grouped by owner ("NOAA models", "NOAA AI models",
  "ECMWF models", "ECMWF AI models", "Consensus aids") and the sentence "Model guidance: experimental computer
  output, not a forecast for your place. The official forecast is NHC's." Model intensity lines on the chart only
  when the switch is on.
- **Wind**: forecast wind radii at each forecast time; wind speed probability shading; arrival-time lines.
- **Official now**: every product in effect, verbatim, with issuer, own times and link: TCP, TCD Key Messages,
  TCU, local statements, watches and warnings.
- **Rain and tornado layers**: WPC rainfall and excessive-rain outlook, SPC tornado outlook, each from its own
  centre.

### 5.3 Forensic 3D

- **Storm surge on terrain**: the official flooding classes draped on the coastal terrain with brief 6's automatic
  height boost (coasts are flat), buildings if available, and a stepped water sheet at each class's lower bound
  ("more than 3 feet above ground"). Title: "NHC Potential Storm Surge Flooding Map, Advisory n: reasonable worst
  case". It is NHC's classes, not a depth estimate of ours.
- **Planning layer** (off by default): the category 1-5 risk maps for the same coast.
- **Wind field**: official radii as rings on the surface; optionally our smooth field as arrows or a tint,
  labelled experimental.
- **The track through time**: past track and the cones of successive advisories as a stack, so the user can see how
  the forecast moved.
- **After landfall**: the app's existing flood drapes (satellite water, forecast flood areas) for the linked floods.

### 5.4 The link to floods

A hurricane causes floods the app already lists. Proposal: link, do not merge.

- A flood is shown as "during Hurricane Isaias" when it started between the storm's first advisory and 7 days
  after its last, and lies within a set distance of the best track or inside an NHC-warned zone. The label says
  the link is Disaster Mapping's: "Linked by place and time, not by NWS."
- Where the NWS flood product's own text names the storm, say so and quote it.
- Storm Surge Watches and Warnings belong to the storm (same event number), not to the flood list. Coastal Flood
  products stay where they are.
- The storm view lists "Floods during this storm" (count and worst category); the flood view shows a chip back to
  the storm. Effort is small because both lists exist.

### 5.5 Extra ideas (each optional, each small)

| Idea | What the user sees | Effort | Note |
|---|---|---|---|
| Forecast against reality | For a past storm, an old advisory's track and cone with the later best track drawn over it | in H5 / H10 | The clearest way to learn what a cone means |
| Cone history | All cones of one storm as fading outlines: how the forecast moved from day to day | 0.5 h | Official layers only |
| Arrival window for my place | NHC's two arrival times for the selected place as one bar on a day-and-night strip: "Earliest reasonable: Thu 2 PM · Most likely: Thu 8 PM (NHC Advisory n)" | 1 h | States NHC's times; never "you have until …" |
| Warning timeline for my place | When the watch began, became a warning and ended, on the Command chart | 0.5 h | From NWS alerts and the IEM archive |
| Model families | Guidance lines coloured by family (physics, AI, consensus) with a filter | in H6 | Model output key only |
| Score card | Per storm and per season: mean track error by model and lead time, with the official forecast as the bar to beat | H10 | Section 7 |
| Water height marker in 3D | A person-height and a door-height mark beside the surge classes | in H8 | Wording: "more than 6 feet above ground: reasonable worst case (NHC)" |
| Satellite picture of the storm | Cloud imagery under the track (NOAA GOES through NASA GIBS, which the app already uses for flood pictures) | 1.5 h | Availability and terms **not verified** |

**What this means for the app.** Most of the three views is new drawing of official layers on existing parts: the
status circle, the facts column, the time handle with Play and steps, the verbatim panel, the point card and the
3D drape and height boost were all built for fires and floods.

---

## 6. Testing out of season

The season runs June 1 - Nov 30 and today there is no Atlantic storm, so tests cannot wait for one.

| Piece | How |
|---|---|
| `fixture-storm` | A small synthetic storm (like `fixture-flood`): 6 advisories incl. one intermediate, a cone, warning lines and zones, radii, one tiny surge raster, a short a-deck with 5 invented model codes, canned route answers. Marked synthetic everywhere |
| Recorded real storms | Helene (AL092024), Milton (AL142024), Isaias (AL092026): built by a command (proposed: `fire3d.cli build-storm al092026`) from the public archives of section 2. About 1 MB of cone and radii files per storm; the surge maps are 23 MB each, so keep only a cropped copy per coast window (as flood passes do) |
| Replay clock | The existing "past event" mode: the handle starts at the last advisory; stepping back shows each advisory as it was issued, with "Archived copy" tags |
| Live code path with no storm | The live reader is fed a saved `CurrentStorms.json` and saved map-service answers (recorded today from Pena for shapes; replaced by an Atlantic storm's in season). The empty state is tested against today's real answers |
| What replay cannot give | api.weather.gov alerts older than about 7 days (use IEM); the live map service (use the zip archive); ECMWF track files older than 2-3 days (use the archived a-deck, which includes ECMWF after the season); arrival-time KMZ before 2018 |
| Screenshots | Isaias advisory 12 (Oct 9, 15:00 UTC: Category 3, warnings from Louisiana to the Florida Big Bend, surge 6-9 ft forecast) is a ready-made reference frame for all three views |

---

## 7. Benchmarking and validation ideas (hurricane side)

All of these use only public files and fit `docs/validation.md`'s way of working.

1. **Track error per model and lead time.** For each a-deck run, the distance between the forecast position and
   the best track at 12-120 h, on the same set of cases for every model ("homogeneous"), with `OFCL` and the
   consensus as reference lines. This is how NHC verifies; the app would say "same method as NHC's verification,
   computed by Disaster Mapping on public files".
2. **Was the centre inside the cone?** Per advisory and lead time, for past storms; expected about two times in
   three. A direct, visual lesson in what the cone means.
3. **Intensity error**, with a plain warning that all models miss rapid strengthening.
4. **AI against physics**: AIGFS, AIGEFS mean and (after the season, from the archive) ECMWF's models side by
   side with GFS and HAFS for the 2026 storms. Google's rows only if the rule changes.
5. **Wind field check**: our estimated wind field against the official radii it was built from (must match) and,
   later, against observed peak winds.
6. **Surge map check** for past storms: NHC's reasonable-worst-case classes against measured high water (tide
   gauges and USGS high-water marks; sources **not verified** in this audit). Expect the map to be higher than
   what happened in most places: that is what "1-in-10" means, and the view should say so.
7. **Timeliness**: how long after each advisory time the app had each layer (from the files' own times).

---

## 8. Safety rules for hurricanes

These extend CLAUDE.md's rules; none of them relaxes one.

- **Evacuation is local.** Zones and orders come from county and state officials. NHC's advisory itself says
  "Promptly follow evacuation and other instructions from local officials." The app has live zones only for
  California and Oregon (brief 3). That audit found only static planning zones ("Know Your Zone") in the
  hurricane states it checked, and for Florida a county-level status list the app does not show. First slice: keep
  "Official evacuation zones are not available in this state (Florida). Follow local officials." and show
  officials' messages relayed by NWS. Never derive a zone or an order from the surge map, the cone or a category.
- **The cone is not the impact area.** Every cone carries NHC's sentence. No wording such as "outside the cone".
  A point check never ends on the cone; it continues with warnings, wind chances and surge.
- **Surge maps are a reasonable worst case, not a prediction, and not the whole flood.** They leave out rain,
  rivers, waves and levee failure. A pixel without colour is never an all-clear. The static category maps are
  planning maps and are never shown as "what this storm will do".
- **Category is wind only.** Do not rank places or storms as less dangerous because the category is lower; a
  tropical storm can flood more than a hurricane.
- **Never "safe", never "low risk".** NHC's outlook uses "low / medium / high" for the chance that a storm
  *forms*: show those words only as NHC's, inside a verbatim element, never as a statement about a place.
- **No watch or warning is never an all-clear.** Also for storms far away: "not forecast to affect" is NHC's
  5-day statement at one advisory, and the app says which advisory.
- **Official and model stay apart.** The NHC track, cone and warnings are official. Every model line, the score
  table and our wind field are experimental model output with their own key, never drawn in the official style,
  never averaged with the official track, never used for the point card's answers.
- **Verbatim and dated.** Each product keeps its issuer (NHC, WPC, SPC, or the local office), advisory number,
  its own times and a link. Archived copies are tagged. An old advisory is marked "replaced by Advisory n".
- **Stale data must look stale.** A storm changes in hours. If the newest advisory is older than 7 hours while the
  storm is active, or a source fails, the view says so in the status circle, as the flood views do for outages.
- Every view keeps "Research prototype — not for operational use" and "Not an all-clear. Follow local officials."
  The spiral and playback stop under `prefers-reduced-motion`.

---

## 9. Effort and the recommended slices

Calibrated on `docs/redesign/reports/*.json`: one role is 1-2 hours of agent build time, plus one independent
review and fix (about a third more). Brief 5 (floods, all three views) used seven build roles plus integration.

| Part | Content | Hours |
|---|---|---|
| H1 `backend-storm-sources` | Contract triple for storms; `fixture-storm`; readers for `CurrentStorms.json`, the map service and the zip/KMZ files; storm list with the lower-48 rule; ids and folder | 2 |
| H2 `backend-storm-bundle` | Advisory history as frames; text products verbatim (api.weather.gov, NHC archive, IEM); NWS warnings joined by event number; build command for past storms; three recorded storms | 2 |
| H3 `web-storm-overview` | Third hazard in the switch and URL; markers, list, legend, empty state, past-storm list | 1.5 |
| H4 `web-storm-public` | Spiral status circle, facts, cone, warning lines and zones, wind extent, point card block, key | 2 |
| H5 `web-storm-command` | Track chart with intensity timeline, advisory stepper with Play, wind radii and probabilities, Official now panel | 2 |
| H6 `guidance` | ATCF reader (a-deck, NOMADS trackers, HAFS), code table with owners, Google filter, guidance route; web spaghetti layer, key, intensity lines | 2.5 |
| H7 `integration + final check` | Real replay of three storms, gates, screenshots, scans, README section | 1.5-2 |
| | **Slice 1 = H1-H7: official 2D hurricanes with replay and public guidance** | **13.5-14; with reviews 17-18** |
| H8 `surge-and-3d` | Surge flooding map and peak surge in the bundle (cropped rasters); 2D layer and key; Forensic drape with height boost, stepped water sheet, wind rings; category planning layer | 4-5 |
| H9 `flood-link` | Link rule both ways, chips, "Floods during this storm" | 1-1.5 |
| H10 `scoring` | Track and intensity error tables per model, cone check, `docs/validation.md` section, a Command "Scores" panel for past storms | 2 |
| H11 `ecmwf-tracks` | BUFR reader (new dependency), IFS / ENS / AIFS / AIFS-ENS lines with the CC BY credit | 1.5-2 |
| H12 `rain-and-tornado` | WPC and SPC layers in Command | 1 |
| H13 `wind-field` | Our labelled wind field for 3D | 1.5 |
| H14 `tracker` (not recommended) | Section 3.4 | 3-5 |

**Recommended order**: slice 1, then H8 (the 3D surge view is what makes hurricanes worth a Forensic workspace),
then H10 (the benchmark the user asked for), H9, H11, H12, H13. Slice 1 alone already answers "Hurricane model?"
honestly: official forecast, public guidance, AI models included, each named.

Dependencies to decide: reading shapefiles (a small pure-Python reader, or use the map service's GeoJSON and the
KMZ, which need none); reading BUFR for ECMWF (H11 only: `eccodes`, Apache 2.0, licence **not re-verified**).
GeoTIFF is already covered by `rasterio`.

---

## 10. Questions only the user can answer

1. **Q1 Google.** May the app show Google DeepMind cyclone tracks? (a) No: filter `GDM*` everywhere (keeps
   CLAUDE.md as it is; recommended default). (b) Yes, but only the rows NOAA republishes in its public a-deck, with
   the credit "Google DeepMind (experimental), via NOAA NHC ATCF". (c) Yes, also Weather Lab downloads with a
   Google sign-in: live tracks only on your own machine, past storms under CC BY 4.0. Any "yes" needs a written
   change of the rule.
2. **Q2 Scope.** Atlantic only, or Atlantic and East Pacific (rarely reaches the Southwest)? List every active
   storm, or only those that touch the lower 48?
3. **Q3 Name on the switch.** "Hurricanes" (the word people look for), "Storms", or "Tropical storms"?
4. **Q4 Who sees the app.** Only you on your machine, or other people too? It changes what the Google terms allow
   and how carefully ECMWF's credit must be placed.
5. **Q5 First slice.** As recommended (official 2D + replay + public guidance), or 3D surge first?
6. **Q6 Replay storms.** Helene 2024, Milton 2024 and Isaias 2026; add a rain-led tropical storm (Chantal 2025 or
   Edouard 2026)?
7. **Q7 Our own estimates.** Is a labelled wind field of ours welcome in 3D, or official wind radii only?
8. **Q8 New dependency for ECMWF tracks** (a BUFR decoder): yes, or leave ECMWF out of live guidance and show it
   only for past storms from NHC's archive?
9. **Q9 Evacuation zones.** Keep "not available in this state" for the hurricane coast (recommended first), or
   research the static state zone maps as a labelled background layer in a later brief?
10. **Q10 Units.** Public in mph and feet; Command in knots and mph, nautical and statute miles?

---

## 11. Not verified, or open

- The licence position of the `GDM*` rows in NHC's public a-deck. The same file carries UK Met Office (`UKX`),
  Canadian (`CMC`, `CEMN`) and US Navy (`NVGM`, `CTCX`) rows; NHC's files state terms only for ECMWF. Credit each
  owner by name and check their terms before a public release.
- NHC's 2025 verification report itself (only news summaries were read).
- Grid spacing of GFS, GEFS, HAFS, AIGFS and AIGEFS (not looked up today); member count and forecast length of
  Google's cyclone ensemble; the pixel size of the surge flooding GeoTIFF (the 23 MB file was not downloaded).
- Whether the 2026 experimental cone and the inland watch/warning areas are published as GIS layers (the zones are
  available through NWS alerts either way).
- Geometry of Storm Surge Watch/Warning in the live alert feed (the archive gives zones; NHC's KML gives the
  gridded area).
- East Pacific event numbering for the warning join; WPC's take-over of inland advisories.
- TempestExtremes and `eccodes` licence texts; IBTrACS terms; STOFS terms.
- NOAA tide gauge and USGS high-water-mark sources for the surge check.
- The live map service's raster layers for the surge map (no Atlantic storm today).
- 2026 landfall details other than Isaias come from Wikipedia and news, not from NHC reports (not yet published).

---

## 12. Evidence log (2026-11-10, 17:10-17:35 UTC)

| Host | Requests | What was read |
|---|---|---|
| `www.nhc.noaa.gov` | 14 GET/HEAD + 6 page reads (2 more addresses answered 404) | `CurrentStorms.json` (200, 4.6 KB); `/gis/` (44 KB); 2026 forecast archive list (Atlantic: Arthur … Josephine; one hurricane, Isaias); `/data/` and `/data/hurdat/`; HURDAT2 HEAD and a 420 KB range; Helene 2024 archive (70 files); 2024 surge-map archive list; Isaias 2026 surge-map list (26 files); `al092026_5day_012.zip` (32 KB, 4 layers, metadata); HEAD of `AL0926_12_inundation.zip` (23,467,273 bytes, 15:53:50 UTC Oct 9); sample surge metadata; `ISAIAS.shtml`; product, graphics, RSS, surge-map and risk-map description pages; the 2026 products PDF (12 pages read) |
| `ftp.nhc.noaa.gov` | 9 | `/atcf/` listing, README, NOTICE (ECMWF CC BY note; no Google note), `aid_public/` (62 files), `aal092026.dat.gz` (33,960 rows, 91 codes), `docs/`, `nhc_techlist.dat` (2021), `archive/2024/`, `aal092024.dat.gz` (76,234 rows, 277 codes) |
| `mapservices.weather.noaa.gov` | 13 | `tropical` folder (5 services); the two NHC services (35 and 400 layers); PeakStormSurge, StormSurgeRisk, Breakpoints; 4 layer queries in GeoJSON; WPC QPF, WPC precipitation hazards, SPC outlooks |
| `api.weather.gov` | 10 | `/alerts/types` (111 names), active tropical alerts (0), 8 product-type lists (TCV, HLS, TCU empty today) |
| `nomads.ncep.noaa.gov` | 13 | `com/` (one HTTP/2 header error, fine over HTTP/1.1); `psurge`, `ens_tracker`, `aigfs`, `hgefs`, `hafs`, `nhc` listings; `psurge.20261009/` → 403; AIGFS 00Z tracker folder and its 5.9 KB track file |
| `tgftp.nws.noaa.gov` | 1 | P-Surge NDFD folder: empty |
| `data.ecmwf.int` | 5 | Today's 00Z listings: `-tf.bufr` present for IFS oper and enfo, AIFS single, AIFS ENS |
| `mesonet.agron.iastate.edu` | 5 | Hurricane, storm surge and tropical storm warnings for Florida 2026; zone polygons of event 1009; text of TCPAT4 for Oct 9 |
| `noaa-nws-hafs-pds.s3.amazonaws.com` | 3 | Bucket root, `hfsa/` dates (from 20230619), Isaias run 2026100912 (356 files) |
| Other pages read | 9 | `www.weather.gov/disclaimer`; `www.ecmwf.int/en/forecasts/datasets/open-data`; `developers.google.com/weathernext/guides/weatherlab`; `github.com/google-deepmind/weathernext`; Google's real-time terms PDF (7 pages, last modified 3 September 2026); `deepmind.google/science/weathernext/`; Weather Lab (302 to Google sign-in); `noaa-gestofs-pds` README; Wikipedia "2026 Atlantic hurricane season" |
| Web searches | 11 | Google aid codes, Weather Lab terms, Isaias landfall, NOAA AI models, NHC 2026 changes, WeatherNext 3, HAFS on AWS, TempestExtremes, IBTrACS, NHC 2025 verification |

No request used a key or a login. Nothing was written outside this file and the session scratchpad.
