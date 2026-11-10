# Audit 7: AI weather models and how the app could use them (brief 7 planning)

Role: research for brief 7, topic "AI weather". **Documents only**: no app code changed, no bundle built, no server
started, no secret read or used. Checked **2026-11-10, about 16:50-17:30 UTC** from the cloud session: official pages
read with WebFetch / WebSearch, plus about 75 small GETs with curl (one at a time, User-Agent
`Disaster Mapping research prototype`). The evidence log is section 8. Anything I could not check on an official page
is marked **not verified**.

**The one decision this file cannot make for you.** `CLAUDE.md` says: "No Google data, no paid map services, no
Nominatim". WeatherNext is a Google product. Using it in the app, by any route, needs you to change that rule in
your own words. Section 2 says exactly what using it would involve so you can decide. Everything in the
"recommended first step" (section 6) works **without** changing the rule.

## 0. Short answer

1. **WeatherNext 3 is real and you can get its data** (Google's newest model, announced 2026-09-03): 64 forecasts
   side by side ("members"), hourly steps, 15 days ahead, about 10 km grid at the surface. The data is free of
   charge today but **not open**: you ask Google for access with a Google account (5-7 business days), forecasts for
   the future come under special "experimental" terms, and they arrive about **7-8 hours after** the forecast's
   start time. It has no wind gusts and no relative humidity (humidity must be worked out from dew point).
2. **There are free, open AI models that need no rule change.** The best fit is the European centre's
   **AIFS ensemble** (51 members, 15 days, CC BY 4.0). It is already served by Open-Meteo, the weather host the app
   uses now, and I tested that it returns all five variables the fire forecast needs. NOAA also runs AI models
   (AIGFS, AIGEFS, HGEFS) and an experimental 3 km AI model for the lower 48 (HRRR-Cast).
3. **Be honest about what AI weather can and cannot do for fires.** The global AI models see the world in boxes of
   about 25 km (WeatherNext 3: about 10 km). A canyon wind that drives a fire is 1 km wide or less. So AI models
   are good for "what will the next 3-10 days look like, and how sure are the models", not for "which slope burns
   in the next 6 hours". The app's existing 3 km HRRR weather stays the driver for the first 48 hours.
4. **Recommended first step (about 9 agent-hours, no rule change):** add the AIFS ensemble as a weather choice, a
   "model disagreement" panel that compares physics models with AI models, and a 10-day fire-weather outlook.
5. **Stretch steps:** real-ensemble hindcasts from archives, the NOAA 3 km AI ensemble, WeatherNext 3 itself (only
   if you change the rule), and AI "downscaling" on a rented GPU.

## Words used here (plain)

- **Weather model**: a computer program that takes the state of the air now and works out the state later.
  A **physics model** (GFS, HRRR, ECMWF IFS) solves the equations of air motion on a supercomputer. An **AI model**
  has learned from about 40 years of past weather maps to make the next map directly; it runs in minutes on one
  graphics card.
- **Grid / resolution**: the model cuts the world into boxes and gives one value per box. "0.25 degree" means
  boxes of about 28 km north-south (about 23 km east-west at Los Angeles). HRRR's boxes are 3 km.
- **Init time (run time)**: the moment a forecast starts from. **Lead time**: how far ahead a value is.
  **Latency**: how long after the init time you can download it.
- **Ensemble / member**: the same model run many times with small changes. Each run is a member. If the members
  agree, the forecast is more certain. The app already runs its fire model once per weather member and counts how
  many members burn each spot ("burn probability").
- **Deterministic**: one single forecast, no members.
- **Percentile (p10, p50, p90)**: sort the members' values; p50 is the middle one, p10 and p90 are near the low and
  high ends. A percentile is a summary. It is **not a member**: you cannot run the fire model on "the p90 wind".
- **Downscaling**: turning a coarse forecast into a finer one, by physics (WindNinja) or by AI (CorrDiff).
- **Weights**: the learned numbers of an AI model. With the weights, the code and a graphics card (GPU) you can run
  the model yourself.

## 1. What the app's fire forecast needs from weather (read from the code)

Read: `backend/fire3d/sources/weather.py`, `backend/fire3d/build/weather_bundle.py`,
`backend/fire3d/spread/ensemble.py`, `backend/fire3d/types.py`.

| Need | Today | Where |
|---|---|---|
| Single best forecast, hourly | Open-Meteo `gfs_hrrr` (HRRR 3 km), filled by `gfs_seamless` after about 48 h, ERA5 for old gaps. Seven variables: 2 m temperature, relative humidity, dew point, 10 m wind speed, wind direction, gusts, precipitation | `VARS`, `OpenMeteoSource.deterministic` |
| Ensemble members, hourly | Open-Meteo `gfs025` (31) or `ecmwf_ifs025` (51). Five variables: temperature, relative humidity, wind speed, wind direction, precipitation. **Gusts are not used by the spread model** | `ENSEMBLE_VARS`, `OpenMeteoSource.ensemble` |
| Where | 16 points (a 4 x 4 grid) over the fire area, which is 8-60 km wide | `WEATHER_GRID_N`, `AOI_*` |
| When | 72 h before the start (to "spin up" fuel dryness) to the forecast end. Lead times scored: 12, 24, 48, 72 h; longest run allowed: 240 h | `SPINUP_H`, `LEAD_HOURS`, `MAX_HORIZON_H` |
| Anchoring | While HRRR exists, every member is shifted so the ensemble average equals HRRR; the shift fades out over 6 h after HRRR ends | `bias_corrected_members`, `BLEND_H` |
| Past fires | Open-Meteo keeps ensembles for about 90 days only, so 2025 hindcasts use 31 "perturbed" copies of HRRR, not a real ensemble | `ENSEMBLE_PAST_DAYS`, `perturbed_members` |
| Plug point | `WeatherSource` protocol; `build_weather(..., source=)` and `member_weathers(..., source=)`. The docstring names a future `WeatherNext3Source`; SPEC section 0 says "Do not implement a WeatherNext adapter"; a test checks that `ensemble: "weathernext"` is refused (422) | `weather.py` lines 1-6 and 430-444, `SPEC.md` line 35, `tests/test_api.py` line 322 |

Two consequences for any new weather source:

- It must give **members** with temperature, humidity (or dew point), wind speed and direction, and precipitation.
  A source with only percentiles cannot drive the fire ensemble.
- A coarse model changes little in the first 48 hours, because the app anchors members to HRRR there. A coarse
  model's own values only matter after HRRR ends. That is the honest place for global AI models: **days 3 to 10**.

## 2. Google WeatherNext 3

### 2.1 What it is today (names and dates)

Source: `developers.google.com/weathernext/guides/models` and Google's announcement, both read 2026-11-10.

| Name | Also known as | Date on Google's model page | Kind | Grid | Step | Members |
|---|---|---|---|---|---|---|
| WeatherNext 1 Graph | GraphCast | Nov 2023 | deterministic | 0.25 deg | 6 h | 1 |
| WeatherNext 1 Gen | GenCast | Dec 2024 | ensemble (diffusion) | 0.25 deg | 12 h | 50 |
| WeatherNext 2 | FGN | June 2025 (public blog later in 2025, from memory, not re-checked) | ensemble | 0.25 deg | 6 h | 64 |
| **WeatherNext 3** | | "August 2026" on the model page; announced **2026-09-03** | ensemble | 0.05 deg station temperature and dew point; 0.1 deg surface; 0.25 deg upper air | **1 h** | **64** |

WeatherNext 3 facts (Google's pages, 2026-11-10):

- **Who runs it:** Google DeepMind and Google Research. "WeatherNext 3 is available as an operational forecast
  service but is not open source."
- **Inputs:** live geostationary satellite pictures and the ECMWF HRES analysis. Trained on ERA5 / HRES, IMERG
  satellite rain, weather stations and satellite pictures.
- **Runs:** from 2026, a new forecast every hour. The 00, 06, 12, 18 UTC runs go to **15 days (360 h)**; the other
  hours go to **48 h** and hold surface variables only. For 2024-2025 the archive has 8 runs a day.
- **Variables on the 0.1 degree surface grid (hourly):** 2 m temperature, 2 m dew point, 10 m wind (speed, u, v),
  100 m wind, sun radiation (two kinds), precipitation in three flavours (`total_precipitation_1hr` model native,
  `imerg_tp_1hr` satellite-calibrated, `experimental_tp_1hr` satellite-radar), cloud cover (4), sea-level pressure,
  sea surface temperature. Units: kelvin, m/s, metres of water.
- **Station grid (0.05 degree, about 5 km):** 2 m temperature and dew point only.
- **Upper air (0.25 degree, 13 pressure levels, 6-hourly runs, Cloud Storage only):** height, humidity,
  temperature, wind, vertical motion.
- **Missing for this app:** **no wind gusts, no relative humidity** (work it out from temperature and dew point;
  the app already has `rh_from_dewpoint`). Google's announcement mentions "discrete cyclone tracks" in a figure
  caption, but no track product is in the variable list (**not verified** as downloadable data).
- **Google's own claims** (not independently checked by me): rain forecasts better by "up to 60% against IMERG,
  30% for MRMS, and 10% against rain gauge measurements"; "roughly five times sharper than ... WeatherNext 2".

### 2.2 Every access route

| # | Route | What you get | Account or approval | Cost | Fit for this app |
|---|---|---|---|---|---|
| A | **BigQuery** (Analytics Hub listing `weathernext_3` in Google's project `gcp-public-data-weathernext`; tables `weathernext_3_0_0_0p1deg`, `weathernext_3_0_0_0p05deg`) | Mean and p10, p25, p50, p75, p90 of the 19 surface variables (114 columns). One row per grid box per run; the forecast is an array by lead time. **No members** | Google account + the "WeatherNext Data Request" form ("typically approved within 5-7 business days") + your own Google Cloud project to subscribe | Data free. Queries are billed by bytes read. List price from memory about $6.25 per TiB with the first 1 TiB a month free: **not verified today** (the pricing page did not load) | Good for outlooks, rain totals and the disagreement view |
| B | **Earth Engine** (`projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg` and `..._0p05deg`) | The same statistics as pictures: one image per run and lead time, 114 bands | Same form + a Cloud project registered for Earth Engine. Noncommercial projects get 150 "EECU-hours" a month in the free Community tier (rule since 2026-04-27) | Free for noncommercial use within that quota | Fine for a map; clumsy for a 240-step time series |
| C | **Cloud Storage, statistics** (`gs://weathernext3_statistics_spatial/weathernext_3_0_0_statistics/zarr/...`, Zarr v3) | The same statistics as files, one store per run, hourly lead axis | Same form. "Requester Pays" is off, but **anonymous reads are refused** (I tested: HTTP 401 on list, 403 on get), so a signed-in, approved account is needed | No Google charge stated | Simplest Python route (`xarray` + `zarr` + `obstore`) |
| D | **Cloud Storage, full ensemble** (`gs://weathernext3_spatial/weathernext_3_0_0/zarr/2026_to_present/<YYYYMMDD_HHhr_XX_preds>/predictions.zarr`; yearly stores for 2024 and 2025) | **All 64 members**, surface and upper air | Same form + a Cloud project **with billing**, because the bucket is "Requester Pays" | You pay the download ("network egress") to your project; Google says a global 64-member forecast is "hundreds of gigabytes" and to run in region `us-east1` to avoid fees. Internet egress list price from memory about $0.12 per GB: **not verified today** | The **only** route with members, so the only one that can drive the fire ensemble |
| E | **Custom inference** on Google Cloud Model Garden (Vertex AI, now named "Gemini Enterprise Agent Platform") | Run the model yourself with your own member count, lead time and starting data. **WeatherNext 2 only** | Project on an allowlist (form or Google Cloud account team), billing, GPU quota (default 0) for NVIDIA H100 / A100 80 GB | GPU time; no price on the page | Not for this app. Terms forbid using it "to develop a similar or competing product or service" |
| F | **Weather Lab** (`deepmind.google.com/science/weatherlab`) | Interactive maps and cyclone tracks | Google sign-in (the page redirected me to the Google login) | Free | For looking, not for the app |
| G | **Google Maps Platform Weather API** | Point forecasts; the announcement says WeatherNext 3 powers it | API key + billing enabled | Pay-as-you-go ("Weather Usage" SKU; price not on the page I read) | **Do not use**: a paid map service, and its policy says "Don't create content based on Google Maps Content" and "Don't pre-fetch, index, store, or redistribute" |
| H | **Open-Meteo** `models=google_weathernext2_ensemble` | **WeatherNext 2** (not 3): 64 members, 0.25 deg, 6-hourly made hourly, 15 days; only the 00 and 12 UTC runs | None (the app's existing host) | Free for non-commercial use | Still Google data, so still needs the rule change. Has **no 2 m humidity** in Open-Meteo's variable list, so it cannot drive the fire model by itself |
| I | Partner programmes | Google's pages only say to write to `weathernext@google.com` or your Google Cloud account team | | | **Not verified**: I found no public partner programme page |

You wrote "I have access to Google WeatherNext 3". Which of A-G that is decides everything else (question 2 in
section 9).

### 2.3 Terms: what you may do with it

Two licences, split by time (Google's pages and the terms PDF, "Last modified: 3 September 2026", read in full):

- **Data about a time 1 hour ago or older: CC BY 4.0.** You may use, change and publish it with credit. This covers
  the whole 2024-to-now archive, so **back-tests on past fires and floods are the easy case**.
- **Data about "a time less than 1 hour ago and the future": the "GDM Real-Time Weather Forecasting Experimental
  Data Terms of Use"** (`https://storage.googleapis.com/weathernext-public/terms-of-use.pdf`). In plain words:
  - You may use it for "any internal purpose".
  - You may **publish a "Value Added Service"**: something "derived from or based upon" the data, made for a
    purpose the raw data cannot serve, **from which the forecast cannot be recovered** ("Non-Retrievable").
    A burn-probability map made by running the fire model on WeatherNext members looks like this to me (my reading,
    not legal advice).
  - You may **not** publish the forecast itself. Colouring it, cutting out an area, or picking time steps does not
    change that: the terms call such things "unmodified" data. So a public chart of "WeatherNext wind at this
    fire for the next 10 days" is **not allowed**; the same chart on your own machine is internal use.
  - It is "**not intended for consumer use**" and "is not intended, validated, or approved for real world use".
    That does not fit the app's Public view, which is written for residents.
  - You may not use it if you live in, or make it available in, a "Restricted Country". The list includes
    **Japan, South Korea and Indonesia** as well as sanctioned places.
  - Google can end your access; then you must delete the data and stop sharing what you built on it.
  - "We do not currently charge", but Google may start to, with one month's notice.
- **Credit line the terms require** when you publish findings or a derived product from real-time data (exact):
  name the Google product you fetched it from (for example BigQuery) and add
  "© 2024-6 Google LLC, whose machine learning models were used to create the experimental data made available under
  the following licence terms https://storage.googleapis.com/weathernext-public/terms-of-use.pdf. This data is
  intended for experimental modelling only and is not intended, validated, or approved for real world use."
- **Credit line for historical (CC BY 4.0) data:** Google's pages give no exact wording. A proposal that meets
  CC BY: "WeatherNext 3 forecast data, Google DeepMind and Google Research, © Google LLC, CC BY 4.0 (changes made)".
- **Google's own disclaimer** (its "terms and disclaimers" page): outputs "do not constitute official weather
  forecasts, watches, or warnings"; "always defer to official alerts and advisories". This matches the app's
  safety rule.

### 2.4 Timing

Google's "dissemination schedule" page (2026-11-10):

| Run | Cloud Storage | BigQuery and Earth Engine |
|---|---|---|
| 00, 06, 12, 18 UTC (15 days) | run time **+ 7 h 45 min** | **+ 8 h 10 min** |
| Other hours (48 h) | + 7 h 10 min | + 7 h 25 min |

"Typical ±15 minute variance". So the "hourly" model reaches you 7-8 hours old. For comparison, measured today
from file timestamps: ECMWF AIFS 00 UTC was on the open-data mirror at 05:24 (single) and 05:55 UTC (ensemble);
NOAA AIGFS 00 UTC finished at 04:16 UTC; NOAA's AI ensemble at 04:04 UTC. **History:** 2024 to present.

A caution for back-tests: WeatherNext 3 came out in 2026. I did not find which years it was trained on. If 2024-2025
were in its training data, its "forecasts" of 2025 fires are not a fair test (**not verified**).

### 2.5 How a small backend would fetch a region

The app needs 16 points over a fire (or a river basin a few hundred km wide), the next 3-10 days.

1. **Statistics by SQL (route A).** One query per run. Google's own example, shortened; lower-48 longitudes are
   plain west-negative in BigQuery:

   ```sql
   SELECT t.geography, f.time, f.hours,
          f.temperature_2m_p50, f.dewpoint_temperature_2m_p50,
          f.wind_speed_10m_p10, f.wind_speed_10m_p50, f.wind_speed_10m_p90,
          f.total_precipitation_1hr_mean
   FROM `MY_PROJECT.MY_DATASET.weathernext_3_0_0_0p1deg` AS t, t.forecast AS f
   WHERE t.init_time = TIMESTAMP('2026-11-10 00:00:00 UTC')          -- prunes to one run
     AND ST_INTERSECTS(t.geography, ST_GEOGFROMTEXT('POLYGON((-119 33.5, -117 33.5, -117 35, -119 35, -119 33.5))'))
     AND f.hours <= 240
   ```

   The exact statistic column names are my reading of Google's naming rule (`<variable>_<stat>`): check them in the
   table schema. A 200 km box is about 400 grid boxes. Google does not publish how many bytes such a query reads
   (**not verified**); filter on `init_time` and `geography`, never `SELECT *`.
2. **Statistics as files (route C).** `xarray.open_zarr` on the run's store, then
   `ds[vars].sel(lat_0p1=slice(33.5, 35), lon_0p1=slice(241, 243))`. Longitudes in the Zarr files run **0-360**
   (`lon % 360`), so the lower 48 is about 235-294.
3. **Members (route D).** Same as 2 on the full-ensemble store, with the billing project in the request header
   (`x-goog-user-project`). **Unknown that matters:** Google's page does not say how the files are cut into chunks.
   If each chunk is a whole-world map, 16 points still cost a whole-world download per member, hour and variable,
   which is far too much for a Mac. Only someone with access can look (one metadata read). Until that is known,
   treat route D as a cloud job in `us-east1`, not something the Mac does.
4. **From the app's side** the adapter is small: kelvin to Celsius, dew point to relative humidity, u/v to speed and
   direction, metres to millimetres, then the existing `WeatherSource` shapes.

New Python packages needed (none are in `backend/pyproject.toml` today): `google-auth` plus either
`google-cloud-bigquery` (route A) or `xarray`, `zarr`, `obstore` (routes C, D), or `earthengine-api` (route B).

### 2.6 What leaves your machine, what comes in, what it costs

- **Goes to Google:** your Google account e-mail and what you write in the request form; your Cloud project id; and
  every query, which shows the places and times you ask about (the fires or basins being looked at) and your
  network address. No data about the app's viewers is sent.
- **Comes in:** forecast numbers, under the two licences above.
- **A new secret.** The backend needs a Google credential (a service-account key file, or a login done once with
  `gcloud auth application-default login`). `CLAUDE.md` says the only secrets are `FIRMS_MAP_KEY` and
  `EARTHDATA_TOKEN`, so the **secrets rule would need a third entry** too.
- **Money:** nothing for the data today. BigQuery within its free monthly allowance is likely enough for a
  prototype (not verified). Route D needs a billing account and can cost real money if used carelessly.

### 2.7 Verdict under CLAUDE.md

- **As the rules stand: do not use** (Google data; route G is also a paid map service). This applies to route H too.
- **If you change the rule**, my advice in order: (1) historical CC BY data for back-tests; (2) live statistics in
  Command and Forensic only, as a "second opinion", never in Public; (3) live members for the fire ensemble only
  after the chunk question in 2.5 is answered. Keep the exact credit lines of 2.3 and keep WeatherNext output apart
  from official NWS information, like every other model output.

## 3. Open and free alternatives

### 3.1 ECMWF AIFS (single and ensemble): **use**

- **What / who:** the AI forecast system of ECMWF (the European Centre for Medium-Range Weather Forecasts), run
  next to its physics model IFS. AIFS Single (one forecast) operational since 2025-02-25; AIFS ENS (ensemble) since
  2025-07-01; both upgraded to version 2 on 2026-05-12.
- **Grid / time:** about 0.25 degree; 6-hourly steps to 15 days (360 h); runs at 00, 06, 12, 18 UTC.
- **Members:** 51 (1 control + 50; I counted members 1-50 in today's index file).
- **Variables (today's ensemble index):** 10 m wind u, v; 2 m temperature; 2 m dew point; precipitation; 100 m
  wind; pressure; clouds; radiation; snowfall; runoff. ECMWF's list adds 6 upper-air variables on pressure
  levels. **No gusts.**
- **Access routes (no account, no key):**
  - Open-Meteo, the host the app already uses: `https://ensemble-api.open-meteo.com/v1/ensemble?models=ecmwf_aifs025`.
    Tested today at one point: 51 series each for temperature, relative humidity, dew point, precipitation and wind
    direction, hourly (Open-Meteo fills in between the 6-hour steps), data to day 15; gusts all empty. The single
    forecast is `ecmwf_aifs025_single` (tested on the historical-forecast host for 2026-08-01: data; for 2025-01-08:
    empty).
  - ECMWF's own files: `https://data.ecmwf.int/forecasts/` (keeps "the most recent 12 forecast runs") and mirrors.
    The AWS mirror `s3://ecmwf-forecasts` (Frankfurt) holds an **archive back to 2023-01-18**: I saw `aifs-ens`,
    `aifs-single` and `ifs` folders for 2025-08-01, and `aifs` and `ifs` for 2025-01-08 (the Eaton fire day). Files
    are GRIB2 with an `.index` file, so one variable can be fetched by byte range. Path today:
    `20261110/00z/aifs-ens/0p25/enfo/20261110000000-24h-enfo-pf.grib2`. ECMWF limits the portal to "between 500 and
    2000 simultaneous connections"; the AWS mirror answered "SlowDown" to two of my 11 requests, so retries are
    needed.
  - Size: each message is one whole-world map (about 0.5 MB). The five fire variables for 50 members at one lead
    time were 120 MB today, so 10 days is about 5 GB per run. One download serves every fire, but it must be cut to
    the lower 48 and thrown away at once (`SPEC.md` asks to keep `data/` under 3 GB).
- **Latency (measured today):** 00 UTC run on the mirror at 05:24 UTC (single) and 05:55 UTC (ensemble).
- **History for back-tests:** Open-Meteo keeps ensembles about 90 days. The AWS mirror has AIFS ENS from July 2025
  and the physics IFS ensemble from 2023. ECMWF's own archive (MARS) has more but needs registration.
- **Licence (ECMWF open-data page and licence page, 2026-11-10):** CC BY 4.0; redistribution and commercial use
  allowed with credit. **Credit line** (ECMWF's required parts): "© 2026 European Centre for Medium-Range Weather
  Forecasts (ECMWF). Source: www.ecmwf.int. This data is published under a Creative Commons Attribution 4.0
  International (CC BY 4.0). https://creativecommons.org/licenses/by/4.0/. ECMWF does not accept any liability
  whatsoever for any error or omission in the data, their availability, or for any loss or damage arising from
  their use." Say that the data was modified. Through Open-Meteo, also keep the existing "Weather data by
  Open-Meteo.com" link.
- **Run it yourself:** weights `ecmwf/aifs-single-2.0` and `ecmwf/aifs-ens-2.0` on Hugging Face, CC BY 4.0, not
  gated. Needs a large GPU (ECMWF states no number for running it; the Mac cannot use the CUDA-only parts). No
  reason to run it: ECMWF publishes the output.
- **What this means for the app:** a drop-in third ensemble choice next to GFS 31 and ECMWF 51, through code that
  already exists. It is the cheapest honest way to say "an AI model is in the forecast".

### 3.2 NOAA AIGFS, AIGEFS, HGEFS: **use with care**

- **What / who:** NOAA's National Weather Service put three AI systems into operation (news release dated
  2025-12-17). They started from Google DeepMind's GraphCast, re-trained on NOAA's own analyses. **AIGFS**: one
  forecast, 16 days. **AIGEFS**: 31 members. **HGEFS**: 62 members = 31 physics (GEFS) + 31 AI (AIGEFS), which NOAA
  says "consistently outperforms both". NOAA's own caveat: better storm tracks, weaker storm strength.
  The forecasts are NOAA's data; only the model design came from Google's open GraphCast. I read the "No Google
  data" rule as being about where data comes from, so this passes. Say so if you read it differently.
- **Grid / time:** 0.25 degree, 6-hourly steps, runs at 00, 06, 12, 18 UTC. AIGFS files go to 384 h (16 days).
- **Variables (today's AIGFS surface index):** 10 m wind u and v, 2 m temperature, sea-level pressure, 6-hour
  precipitation. **No 2 m humidity and no gusts.** Through Open-Meteo (`ncep_aigefs025`, 31 members, tested):
  temperature, wind and precipitation have data; relative humidity and gusts are empty.
- **Access (no account, no key):** NOMADS, `https://nomads.ncep.noaa.gov/pub/data/nccf/com/{aigfs,aigefs,hgefs}/prod/`
  (GRIB2 + `.idx`; AIGFS keeps 10 days, the ensembles 2 days). Archive on AWS, anonymous:
  `s3://noaa-nws-graphcastgfs-pds/` with `graphcastgfs.20240205` to `20260406`, `aigfs.20260416` to today, and
  `EAGLE_ensemble/aigefs.20250601` to today (528 days), plus a `model_weights/` folder.
- **Latency (measured today):** AIGFS 00 UTC complete 04:16; AIGEFS 04:04; HGEFS 06:35 UTC.
- **Licence / credit:** US Government work, no copyright; I found no licence text in the folders themselves
  (**not verified** beyond NOAA's general open-data practice). Credit: "NOAA / NWS / NCEP (AIGFS, AIGEFS, HGEFS)".
- **Verdict:** fine for wind, temperature, rain and the disagreement view. **Cannot drive the fire model alone**:
  fuel dryness needs humidity. It could borrow humidity from another model, but that is a design change to test.

### 3.3 NOAA GSL HRRR-Cast: **use with care** (experimental, but the only AI model near HRRR's resolution)

- **What / who:** an AI copy ("emulator") of HRRR by NOAA's Global Systems Laboratory. Experimental, not an
  operational NWS product. The GSL web pages refused my reader (HTTP 403), so the version number and official
  description are **not verified**; a GSL news item found by search says version 2 added a 9-member ensemble.
  Everything below is what I saw in the public bucket today.
- **Access (no account):** `s3://noaa-gsl-experimental-pds/HRRRCast/YYYYMMDD/HH/hrrrcast.mNN.tHHz.pgrb2.fFF` plus
  `.idx`; also `avg`, `spr` (spread) and `prob` files.
- **Grid / time:** lower 48 on HRRR's 3 km grid; hourly steps; a run every hour. The 00 and 06 UTC runs went to
  48 h, the 09 UTC run to 18 h. **18 members** (`m00`-`m17`) in the 12 UTC run.
- **Variables:** 10 m wind u and v, **surface gust**, 2 m temperature, dew point and **relative humidity**,
  precipitation, and many more (173 messages per file).
- **Size:** one member, one lead time, the five fire variables = about 10 MB (whole lower 48). 18 members x 49
  hours is about 9 GB per run, so pick fewer members or 3-hourly steps, or fetch once and share across fires.
- **Latency (measured today):** the 12 UTC run's first file appeared at 16:51 UTC and files were still arriving at
  17:14 UTC, so about 5 hours.
- **History:** the bucket holds **3 days**. Back-tests need our own saved copies from now on.
- **Licence / credit:** NOAA open data; no terms page read (**not verified**). Credit: "NOAA Global Systems
  Laboratory, HRRR-Cast (experimental)".
- **What this means for the app:** the first real 3 km **ensemble** for the first 18-48 hours, with exactly the
  variables the fire model needs. Worth a trial, but it can change or stop without notice.

### 3.4 Models you could run yourself

| Model | Who | Licence (checked 2026-11-10) | Needs | Verdict for this app |
|---|---|---|---|---|
| **WeatherNext 2**, WeatherNext Cyclones, GraphCast, GenCast (`github.com/google-deepmind/weathernext`, weights in bucket `dm_graphcast`) | Google DeepMind | Code Apache 2.0; "All other materials" CC BY 4.0 | Full models: "require H100" (an 80 GB GPU) or a TPU. "Mini" 1 degree models run on a P100 or a free Colab runtime. Start data: ECMWF HRES | Google-made, so covered by the rule in spirit; ask (question 1). Too coarse and too heavy to be worth it |
| **AIFS** 2.0 | ECMWF | CC BY 4.0 | Large GPU | No need: output is published |
| **AIGEFS weights** (`EAGLE_ensemble/model_weights/` in NOAA's bucket) | NOAA | Not read (**not verified**) | GPU | No need: output is published |
| **Aurora** (`microsoft/aurora`) | Microsoft | Code and weights MIT. README: "not been developed nor tested for non-academic purposes" | GPU; versions for medium- and high-resolution weather, air pollution, ocean waves | Use with care; no members; no clear gain over published data |
| **FourCastNet 3** (`nvidia/fourcastnet3`) | NVIDIA | Apache 2.0 | NVIDIA GPU | Global, coarse; no gain |
| **StormCast-CONUS** (`nvidia/stormcast-conus`) | NVIDIA | OpenMDW 1.1; "ready for commercial or non-commercial use" | NVIDIA GPU, Linux (tested by NVIDIA on A100, H100, L40S) | A 3 km, hourly AI forecast of the lower 48 that can make members. Stretch idea |
| **CorrDiff ERA5-to-HRRR** (`nvidia/corrdiff-era5-hrrr`, released 2026-09-28) | NVIDIA | OpenMDW 1.1 | NVIDIA GPU (tested on H100 80 GB), Linux | AI downscaling: coarse global fields in, 3 km lower-48 fields out (10 m wind, 2 m temperature, humidity on levels). Stretch idea |
| **Atlas**, **StormScope** | NVIDIA | "other" on Hugging Face; not read | NVIDIA GPU | Not verified |
| **Pangu-Weather** | Huawei | Weights BY-NC-SA 4.0; "The commercial use of these models is forbidden." | GPU | Do not use: non-commercial and share-alike, no members |
| **FuXi** | Fudan University | Official README has no licence line; third-party pages say BY-NC-SA 4.0 (**not verified**) | GPU | Do not use |
| ECMWF `ai-models` runner | ECMWF | Apache 2.0, but marked **Archived** ("no longer actively maintained") | | Do not build on it; NVIDIA's `earth2studio` (Apache 2.0) is the maintained runner |

**Can any of these run on your Mac or in the cloud session?** Not in practice. The cloud session has no GPU. The
Mac (Apple chip) cannot run the NVIDIA-only models, and the big global models want 40-80 GB of GPU memory. Running a
model means renting an NVIDIA GPU by the hour (question 7).

### 3.5 Run it or download it

| | Download the output (data) | Run it yourself |
|---|---|---|
| WeatherNext 3 | Yes, with Google approval | No (not open) |
| WeatherNext 2 | Yes (Google routes, Open-Meteo) | Yes, 80 GB GPU; mini version small |
| ECMWF AIFS | **Yes, open, no account** | Yes, but pointless |
| NOAA AIGFS / AIGEFS / HGEFS | **Yes, open, no account** | Weights published; pointless |
| NOAA HRRR-Cast | **Yes, open, no account** (3 days kept) | Not verified |
| NVIDIA StormCast / CorrDiff / FourCastNet 3 | No public forecast feed found | Yes, rented NVIDIA GPU |
| Aurora, Pangu, FuXi | No | Yes, GPU; Pangu and FuXi non-commercial |

## 4. Uses in the app

### (a) Another weather driver for the fire spread ensemble

| Source | Members | Grid | Step | Reach | Temp | Humidity | Wind | Precip | Can drive the fire model? |
|---|---|---|---|---|---|---|---|---|---|
| HRRR (today, single) | 1 | 3 km | 1 h | 18-48 h | yes | yes | yes | yes | yes (today) |
| GFS ensemble (today) | 31 | 0.25 deg | 3 h | 10 d | yes | yes | yes | yes | yes (today) |
| ECMWF IFS ensemble (today) | 51 | 0.25 deg | 3 h | 15 d | yes | yes | yes | yes | yes (today) |
| **ECMWF AIFS ENS** | 51 | 0.25 deg | 6 h | 15 d | yes | yes | yes | yes | **yes, drop-in** (tested) |
| NOAA AIGEFS | 31 | 0.25 deg | 6 h | 16 d | yes | **no** | yes | yes | no, unless humidity is borrowed |
| NOAA HGEFS | 62 | 0.25 deg | 6 h | 10 d (not verified) | yes | physics half only (files not opened) | yes | yes | no, same reason |
| **NOAA HRRR-Cast** | 18 seen | **3 km** | **1 h** | 18-48 h | yes | yes | yes (+ gusts) | yes | **yes**, new reader needed |
| WeatherNext 3 (route D) | 64 | 0.1 deg (temp, dew point 0.05) | **1 h** | 15 d | yes | from dew point | yes | yes | yes, if rule changed and chunks allow |
| WeatherNext 2 via Open-Meteo | 64 | 0.25 deg | 6 h | 15 d | yes | **no** | yes | yes | no |

- **What it replaces or adds:** nothing is replaced. An AI ensemble is one more choice in the "ensemble" selector,
  and (later) part of a mixed set, the way NOAA mixes 31 + 31 in HGEFS.
- **Honest limits.** (1) A 0.25 degree box is as big as the app's whole fire area, so all 16 weather points get
  nearly the same value; terrain winds are invisible. Even WeatherNext 3's 10 km wind does not see a canyon.
  (2) 6-hourly models miss the afternoon peak of heat, dryness and wind unless anchored to HRRR; the app does that
  anchoring for the first 48 hours only. (3) AI models trained to be right on average are widely reported to smooth
  out the strongest winds (general knowledge, **not verified today** on an official page). (4) More members cost
  time: the forecast has a 240-second budget, after which members drop to half resolution.
- **What this means for the app:** AI members mostly change the **spread** (how wide the burn-probability cone is)
  and the picture after day 2. They should be offered as a choice and tested, not made the default. For terrain
  winds the right tool is physics downscaling (WindNinja, already on the "later" list in `PLAN.md`) or the 3 km
  models, not a global AI model.
- **Effort:** AIFS ENS through the existing Open-Meteo code: **about 1.5 h** (one new model name in
  `ENSEMBLE_SIZES`, `ENSEMBLE_KINDS`, contracts, `types.ts`, the selector, plain-language text, credits, tests).
  HRRR-Cast reader: **about 4 h** plus 2 h of trial runs.

### (b) Fire-weather outlook, days ahead

- **What it adds:** today the app shows weather at the fire for 96 hours. An outlook would say, for each of the
  next 7-10 days, how many members reach hot, dry and windy conditions.
- **Measures.** The app already computes the Fosberg Fire Weather Index (FFWI) from temperature, humidity and
  wind. Add the share of members with humidity under a threshold **and** wind over a threshold, and a
  surface "hot-dry-windy" number (wind x how thirsty the air is). The published **Hot-Dry-Windy Index** (Srock and
  others, 2018) uses the strongest wind and the driest air in the lowest 500 m; that needs upper-air data per member
  (AIFS and WeatherNext 3 route D have it), so start with the surface version and name it differently.
- **Variables and resolution:** temperature, humidity, wind per member. 0.25 degree is acceptable here: a
  region-wide dry wind event (Santa Ana, a dry cold front) is hundreds of km wide. Wording must say "in the wider
  area", never a street-level claim.
- **Rules.** Do not call it "Red Flag" anything. Red Flag Warnings and Fire Weather Watches are official NWS
  products: show them apart, with issuer, times, wording and link, as the app does for other alerts. NOAA's Storm
  Prediction Center also issues official Fire Weather Outlooks for days 1-8 (**not re-checked today**); show the
  official outlook first, the model outlook second, never merged. No day is ever labelled as free of danger; a day
  below the thresholds just shows the numbers.
- **What this means for the app:** a new strip "Model fire-weather outlook (experimental)" in Command and Forensic.
- **Effort:** backend about 1.5 h (shares the fetch with (e)), web about 1.5 h.

### (c) Rainfall forecast feeding a flood outlook

- **What it adds:** the flood side shows official river forecasts and gauges. A rain outlook would add "how much
  rain do the models expect over the land that drains to this gauge in the next 1, 3 and 7 days", with a range.
- **Variables and resolution:** precipitation only. AIFS ENS and the physics ensembles: 0.25 degree, 6-hourly. One
  box is about 600 square km, so this is meaningful for multi-day rain over **large basins** and misleading for a
  thunderstorm over one creek. WeatherNext 3 would be the strongest candidate here (hourly, 10 km, three rain
  variables, Google's biggest claimed gain), and percentiles from routes A-C are enough: no members needed.
- **Rules.** The official rain forecast (NOAA Weather Prediction Center) and the official river forecast stay
  first and separate. The model rain outlook is never turned into a water level or a flood statement by the app.
- **What this means for the app:** a "Model rain outlook (experimental)" row under the hydrograph, with p10-p90
  per model family.
- **Effort:** backend about 2.5 h (needs the upstream area of a gauge, or a fixed radius as a first version), web
  about 2 h.

### (d) Tropical cyclone tracks

- **What exists:** ECMWF publishes AIFS storm tracks as open data (I saw `...-360h-oper-tf.bufr` in today's AIFS
  folder; format BUFR). NOAA says its AI models improve track forecasts but are weaker on strength. Google's
  cyclone model runs in Weather Lab (Google sign-in) and its weights are open ("WeatherNext Cyclones"; the mini
  version runs on a small GPU). I could not see Weather Lab's download options myself (login wall).
- **The hurricane audit is the reference here:** `audit-7/hurricanes.md` (section 3) covers track guidance in
  depth. It reports that Google DeepMind's tracks also sit inside NHC's own public model file, and that ECMWF's
  track files stay online for 2-3 days only. Where the two files differ on tracks, that one has the closer look.
- **Honest limit:** AI tracks are good guidance for *where*, weak for *how strong*, and say nothing about surge or
  rain flooding. The National Hurricane Center forecast is the official one and must lead.
- **What this means for the app:** if a hurricane view is built, AI tracks fit as a thin "model tracks" layer
  under the official NHC cone, labelled by model. The hurricane audit should decide; BUFR decoding needs a new
  package (`eccodes` or similar).
- **Effort:** about 3 h backend + 1.5 h web, with risk in the BUFR decoding.

### (e) "Model disagreement" view

- **What it adds:** one chart at the fire (or basin) with a band per model family: HRRR (line), GFS ensemble and
  ECMWF IFS ensemble (physics), AIFS ENS and AIGEFS (AI), and WeatherNext 3 if allowed. Variables: wind speed,
  humidity, temperature, rain. Under it one plain sentence per day, for example "Thursday afternoon: the AI
  ensemble's middle wind is 9 m/s, the physics ensembles' is 14 m/s. The models disagree; treat this day as
  uncertain."
- **Why it is worth it:** it teaches the main lesson of ensembles without any new science, it is honest about AI
  (shown next to physics, not instead of it), and it needs only data the app can already reach.
- **Variables and resolution:** all families give wind, temperature and rain; AIGEFS has no humidity (show a gap,
  say why). All are coarse except HRRR; the panel says so in its caption.
- **Rules:** experimental model output, Command and Forensic only at first. Disagreement is described as
  uncertainty, never as reassurance.
- **Quota:** one point, four families, five variables is about 80 "weighted calls" on Open-Meteo per fire per
  refresh (the app's own formula in `request_cost`); cache for 6 hours. Note that this cloud session's shared
  address was refused by Open-Meteo ("Daily API request limit exceeded") during my tests: the forecast host on my
  first request, the other two hosts after four or five small requests. CONTRACT 14.12.2 records the same problem.
- **Effort:** backend about 2 h (an endpoint returning p10/p50/p90 per family), web about 2.5 h.

## 5. More ideas (creative, all optional)

| Idea | What it is | Effort (agent-hours) | Verdict |
|---|---|---|---|
| Forecast "freshness" chips | Next to every weather source: which run, how old. Makes latency visible (AIFS about 6 h and NOAA's AI models about 4 h measured today; WeatherNext 3 about 8 h by Google's schedule) | 1 | use |
| Local weather-model scorecard | For the last 7-30 days, compare each model's wind, humidity and temperature with nearby weather stations (the app already credits the IEM archive) and show "which model has been closest here lately" | 3 backend + 1.5 web | use with care (station choice matters) |
| Two-driver burn maps | Run the fire ensemble once with physics members and once with AI members; show where the two burn-probability maps differ | 2 + compute time doubles | use with care |
| Mixed "grand ensemble" | 16 GFS + 16 AIFS members in one run, as NOAA does with HGEFS | 1.5 after (a) | use with care, test first |
| Real-ensemble hindcasts | For 2025 test fires, replace the 31 "perturbed" copies with the real IFS ensemble (archive from 2023) or AIFS ENS (from July 2025) read from the ECMWF mirror; re-score `docs/validation.md` | 4-5 reader + 3-4 runs | use; biggest validation gain |
| Save HRRR-Cast daily | A small job that keeps the five fire variables for active fires, so back-tests become possible later | 2 | use with care |
| WeatherNext 3 back-test | With the CC BY archive: score fire hindcasts with 64 real members for 2025 fires | 4-6 + 3-4 runs | only after rule change; see training-data caution in 2.4 |
| AI downscaling trial | CorrDiff or StormCast on a rented NVIDIA GPU to get 3 km fields beyond 48 h | 6-10 + GPU rent | stretch, high risk |

## 6. Recommendation

### First step (no rule change, no new account, no new secret, no new package)

| Part | What | Effort |
|---|---|---|
| 1 | `ecmwf_aifs025` as a third ensemble choice for live fire forecasts (label "ECMWF AIFS 51 (AI)"), with the ECMWF credit and a note "AI model, about 25 km boxes, 6-hourly" | about 1.5 h |
| 2 | Model disagreement panel in Command and Forensic (4.e) | about 4.5 h |
| 3 | Model fire-weather outlook, 10 days, next to (not merged with) official NWS products (4.b) | about 3 h |
| | **Total** | **about 9 h**, 3-4 agent roles |

Risks: Open-Meteo quota on shared addresses (cache hard; fall back with a clear message, as today); the 6-hour
steps hide the afternoon peak after HRRR ends (say so in the caption); users may read "AI" as "better" (the
wording must stay neutral: "another model", "experimental"); no back-test of AIFS members on 2025 fires is
possible through Open-Meteo (90 days kept), so skill is unknown until the stretch step.

### Stretch step (pick one)

- **S1, validation first (my pick):** a direct reader for the ECMWF open-data mirror, then hindcasts of the 2025
  test fires with real ensembles, physics and AI, scored the same way as `docs/validation.md`. About 8-9 h. Risks:
  5 GB downloads per run, the mirror's "SlowDown" answers, a GRIB reader (check first whether the installed
  `rasterio` can read GRIB; if not, one new package).
- **S2, resolution first:** HRRR-Cast as a 3 km, 18-member driver for the first 18-48 h. About 6 h. Risks:
  experimental feed, 3-day retention, large files, no official description read.
- **S3, WeatherNext 3 (only after you change the rule and confirm your access):** statistics adapter for the
  disagreement panel and rain outlook, about 3.5 h; back-test with the CC BY archive, about 8 h; live members only
  after the chunk question is answered. Risks: terms (not for consumer use; raw forecast not public), a third
  secret, new packages, possible costs, access can be withdrawn.

## 7. What I could not verify

- Google Cloud prices (BigQuery per TiB, storage egress per GB): the pricing pages did not load; figures above are
  from memory.
- How the WeatherNext 3 Zarr files are chunked, bytes read by a typical BigQuery query, and whether the BigQuery
  sandbox (no billing) can subscribe to the listing.
- WeatherNext 3's training years; whether cyclone tracks are a downloadable product; any partner programme.
- Weather Lab's content and download options (Google login required).
- HRRR-Cast's official version, member count as documented, and terms (GSL pages returned 403).
- NOAA's exact licence wording for the AI model folders; the licence of NOAA's published AIGEFS weights.
- FuXi's licence from an official page; NVIDIA Atlas and StormScope licences.
- The claim that AI models smooth extreme winds: general knowledge, no official page read today.
- Open-Meteo's start date for archived AIFS single forecasts (empty on 2025-01-08, present on 2026-08-01) and its
  licence position on redistributing WeatherNext 2.
- SPC Fire Weather Outlook and WPC rain forecast details (official products; outside this file's topic).

## 8. Evidence log (2026-11-10)

| Check | Result |
|---|---|
| `developers.google.com/weathernext` and guides `models`, `access-forecast`, `gcs`, `bigquery`, `earth-engine`, `dissemination`, `disclaimers`, `access-vmg`, `osmodel`, `support` | Read. Facts in section 2 |
| `storage.googleapis.com/weathernext-public/terms-of-use.pdf` | Downloaded (171,639 bytes), read in full; "Last modified: 3 September 2026" |
| `blog.google/.../introducing-weathernext-3/` | Dated Sep 03, 2026 |
| `arxiv.org/abs/2609.03582` | "WeatherNext 3: Increasing resolution and performance of global weather models with raw observations", submitted 2026-09-03 |
| Anonymous list of `weathernext3_statistics_spatial` and `weathernext3_spatial` | HTTP 401 both; anonymous GET of one object in the statistics bucket: HTTP 403 |
| `deepmind.google.com/science/weatherlab` | 302 to Google sign-in |
| `developers.google.com/maps/documentation/weather/policies` | Credit "Source: Includes weather data from Google"; no storing, no derived content |
| `github.com/google-deepmind/weathernext` README (the old `graphcast` address now serves it) | Apache 2.0 code, CC BY 4.0 other materials; H100 for full models; lists Open-Meteo as a data route |
| `ecmwf.int/en/forecasts/datasets/open-data`, `.../aifs-machine-learning-data`, `apps.ecmwf.int/datasets/licences/general/` | Read. Section 3.1 |
| `ecmwf-forecasts` S3 listing | Today 00z has `aifs-ens`, `aifs-single`, `ifs`; 61 AIFS single steps (0-360 h by 6); ensemble file 2.9 GB per step with index; earliest folder `20230118`; `20250801` has `aifs-ens`; `20250108` has `aifs`, `ifs`. Two of 11 requests answered `SlowDown` |
| AIFS ENS index `...-24h-enfo-pf.index` | 5,400 messages, members 1-50, 21 surface variables; `10u,10v,2t,2d,tp` for all members = 119,809,341 bytes |
| Open-Meteo `ensemble-api` `ecmwf_aifs025` | 51 series per variable; humidity, dew point, precipitation, wind direction filled to day 15; gusts empty |
| Open-Meteo `ensemble-api` `ncep_aigefs025` | 31 series; wind, temperature, precipitation filled; humidity and gusts empty |
| Open-Meteo `historical-forecast-api` `ecmwf_aifs025_single`, `ncep_aigfs025` | 2026-08-01: data (AIGFS without humidity); 2025-01-08: empty |
| Open-Meteo docs `ensemble-api`, `google-weathernext-api`, `licence` | WeatherNext 2 offered as `google_weathernext2_ensemble`; CC BY 4.0 for API data with "Weather data by Open-Meteo.com" |
| Open-Meteo quota | `api.open-meteo.com` answered "Daily API request limit exceeded" on my first request; the historical-forecast and ensemble hosts did so after 5 and 4 requests (shared address) |
| NOAA news release "NOAA deploys new generation of AI-driven global weather models" | Dated 2025-12-17, updated 2026-02-17 |
| NOMADS `aigfs`, `aigefs`, `hgefs` | Folders for today; AIGEFS `mem000`-`mem030`; AIGFS 260 files (65 lead times, `f000`-`f384`, surface and pressure, each with `.idx`); surface index: UGRD, VGRD 10 m, TMP 2 m, PRMSL, APCP |
| `noaa-nws-graphcastgfs-pds` S3 listing | `graphcastgfs.20240205`-`20260406`, `aigfs.20260416`-`20261110`, `EAGLE_ensemble/aigefs.20250601`-`20261110` (528), `model_weights/` |
| `noaa-gsl-experimental-pds/HRRRCast/` | Days 20261108-20261110; hourly run folders; members `m00`-`m17` + `avg`, `spr`, `prob`; 00z and 06z to `f48`, 09z to `f18`; member index has GUST, RH 2 m, DPT 2 m, APCP |
| Hugging Face model list (API) | `ecmwf/aifs-single-2.0`, `aifs-ens-2.0` CC BY 4.0; `microsoft/aurora` MIT; `nvidia/fourcastnet3` Apache 2.0; `nvidia/stormcast-conus`, `nvidia/corrdiff-era5-hrrr` OpenMDW 1.1 (model cards read) |
| `github.com/198808xc/Pangu-Weather` README | Weights BY-NC-SA 4.0, commercial use forbidden |
| `github.com/ecmwf-lab/ai-models` README | Archived |
| Earth Engine noncommercial tiers | 150 / 1,000 / 100,000 EECU-hours a month, in effect since 2026-04-27 (search summary of the official guide) |

## 9. Questions only you can answer

1. **The rule.** Do you want to change "No Google data" so WeatherNext may be used? If yes, how far: (a) past data
   only, for back-tests; (b) also live, in Command and Forensic; (c) also in Public (I advise against: the terms say
   "not intended for consumer use")? Does the change also cover WeatherNext 2 through Open-Meteo, and Google's open
   model weights? And do you agree that NOAA's AI models (built on Google's open GraphCast design, but NOAA data)
   are allowed as the rule stands?
2. **Your access.** Which access do you have: the WeatherNext data allowlist (BigQuery, Earth Engine, Cloud
   Storage), Model Garden (WeatherNext 2), Weather Lab, or the Maps Weather API? Under which Google account and
   Cloud project, and is billing switched on?
3. **Publication.** Will anyone but you see the app (a shared link, a demo, a public site)? That decides what the
   real-time terms allow.
4. **Place.** Are you and any viewers outside the terms' "Restricted Countries" (the list includes Japan, South
   Korea and Indonesia)?
5. **Secrets.** May a third secret (a Google credential) be added to the secrets rule?
6. **Packages.** May the backend gain `google-auth` and either `google-cloud-bigquery` or `xarray` + `zarr` +
   `obstore` (WeatherNext), and possibly a GRIB / BUFR reader (direct ECMWF and NOAA files)?
7. **GPU.** Is there a budget to rent an NVIDIA GPU for a trial of AI downscaling? Your Mac cannot run those models.
8. **Money.** Is there a monthly ceiling for cloud costs (I would plan for zero unless you say otherwise)?
9. **Default or choice.** Should AI weather be an extra choice and a "second opinion" (my advice until it is
   tested), or the default driver?
10. **Stretch pick.** Validation first (S1), resolution first (S2), or WeatherNext first (S3)?

## 10. Sources

Google: `https://developers.google.com/weathernext` (and `/guides/models`, `/guides/access-forecast`, `/guides/gcs`,
`/guides/bigquery`, `/guides/earth-engine`, `/guides/dissemination`, `/guides/disclaimers`, `/guides/access-vmg`,
`/guides/osmodel`, `/support`); `https://storage.googleapis.com/weathernext-public/terms-of-use.pdf`;
`https://blog.google/innovation-and-ai/models-and-research/google-deepmind/introducing-weathernext-3/`;
`https://arxiv.org/abs/2609.03582`; `https://github.com/google-deepmind/weathernext`;
`https://developers.google.com/maps/documentation/weather/policies`;
`https://developers.google.com/earth-engine/guides/noncommercial_tiers`.

ECMWF: `https://www.ecmwf.int/en/forecasts/datasets/open-data`;
`https://www.ecmwf.int/en/forecasts/datasets/aifs-machine-learning-data`;
`https://apps.ecmwf.int/datasets/licences/general/`; `https://registry.opendata.aws/ecmwf-forecasts/`;
`https://huggingface.co/ecmwf/aifs-single-1.1`.

NOAA: `https://www.noaa.gov/news-release/noaa-deploys-new-generation-of-ai-driven-global-weather-models`;
`https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod/` (and `aigefs`, `hgefs`);
`https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com/`; `https://noaa-gsl-experimental-pds.s3.amazonaws.com/`;
`https://gsl.noaa.gov/hrrrcast/` (not readable today).

Open-Meteo: `https://open-meteo.com/en/docs/ensemble-api`; `https://open-meteo.com/en/docs/google-weathernext-api`;
`https://open-meteo.com/en/licence`.

Others: `https://github.com/microsoft/aurora`; `https://github.com/NVIDIA/earth2studio`;
`https://huggingface.co/nvidia/corrdiff-era5-hrrr`; `https://huggingface.co/nvidia/stormcast-conus`;
`https://huggingface.co/blog/nvidia/earth-2-open-models`; `https://github.com/198808xc/Pangu-Weather`;
`https://github.com/ecmwf-lab/ai-models`; Hot-Dry-Windy Index paper: `https://www.mdpi.com/2073-4433/9/7/279`.
