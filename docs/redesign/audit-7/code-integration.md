# Audit 7: where new models and a third hazard plug into the code, and what it costs (brief 7 planning)

Role: research for brief 7, topic "code integration". **Documents only**: no app code changed, no bundle built, no
server started, no secret read or used. Checked **2026-11-10, about 21:30-22:45 UTC**, in the cloud session, on
branch `claude/cool-mayer-ki7to6` at `0fc9b36`.

What I read: `backend/fire3d` (`sources/weather.py`, `build/weather_bundle.py`, `build/pipeline.py`, `spread/`,
`floods/`, `api/`, `contracts.py`, `config.py`, `http.py`, `cli.py`, `types.py`, `grid.py`), `SPEC.md`,
`docs/redesign/CONTRACT.md` sections 16 and 17, `contract5/*.md`, `contract6/*.md`, `BRIEF-4.md`, the build reports,
and `web/src` (`state/`, `api/`, `map/`, `scene/`, `ui/shell/`, `ui/public/`, `ui/timeline/`, `location/`). I also
read the four other audit-7 files so that this one adds to them and does not repeat them: `ai-weather.md`,
`hurricanes.md`, `ai-mapping-llm.md`, `benchmark-validation.md`. Where a fact comes from one of them and I did not
check it myself, I say so.

Small tests I ran (User-Agent `Disaster Mapping research prototype`): two GETs to the ECMWF open-data mirror, three
GETs to the Python package index, one read of an Open-Meteo documentation page. They are listed in section 11.

**The one decision this file cannot make for you.** `CLAUDE.md` says "No Google data, no paid map services, no
Nominatim". WeatherNext is a Google product. This file shows where a WeatherNext reader would plug in and what it
would touch (section 1.6 and section 5.3), but nothing here assumes the rule changes. Every "first" step below
works with the rules as they stand.

## 0. Short answer

1. **The weather plug point already exists, but it is narrower than it looks.** There is a `WeatherSource`
   interface with one implementation (Open-Meteo). The list of ensemble names, however, is written out by hand in
   about 17 places in 10 code files and 5 lines of `SPEC.md`. Adding one model today means editing all of them.
   A small "registry" (one table of models with their issuer, credit line, grid, members and rules) fixes that
   and is the real "weather provider interface". About 4.5 hours with one AI model (ECMWF AIFS) included.
2. **No new package is needed to read the open AI weather files.** I downloaded one ECMWF AIFS forecast map by
   byte range (248 KB) and the `rasterio` already installed opened it in 0.1 s. So GRIB files from ECMWF and NOAA
   can be read with what the backend has.
3. **A third hazard costs about the same as floods did, plus two hours of plumbing first.** Floods were built
   "beside" fires, never inside them: own ids, folder, routes, store, map module and views. That pattern works for
   hurricanes. But the web code tests "fire or flood" as a yes/no in 39 lines of 24 files. Turning those into one
   lookup table first (2 hours) makes hurricanes cheaper and a fourth hazard cheap.
4. **Three things in the code do not fit a hurricane at all:** a bundle is one square of at most 60 km in metric
   coordinates; an event has one time zone; and both catalogs keep only things inside the lower 48. A storm is
   500-1,500 km wide, crosses time zones and lives over the sea. The hurricane views must be built on plain
   longitude and latitude, and the 3D view can only show a coastal patch, never the whole storm.
5. **Forecasts are thrown away, and the weather that drove them is never saved.** The live loop keeps the newest 4
   runs per fire. The members' weather exists only in memory. So today nothing can be scored after the fact. A
   ledger hook belongs in one function that all four callers pass through (`spread.ensemble.run_forecast`).
6. **A third secret needs one hour of preparation.** Secret masking and the "which host may get a login header"
   check are written for exactly two names. A Google credential or an Anthropic key should not be bolted on; the
   two checks should first become a small table.
7. **Do not put PyTorch in the backend.** The backend pins `numpy==1.26.4` and Python 3.12 for the fire engine.
   PyTorch's file for a Mac is 139 MB (539 MB for Linux, before its graphics-card extras). The full global AI
   weather models need a data-centre graphics card anyway, and their output is published. Small models (a flood
   mapper, Wildfire-FM) belong in a separate optional folder that writes files into a bundle.
8. **Fix first, before any of this (about 7 hours):** Open-Meteo's documentation says its HRRR feed ends on
   2026-11-30, and HRRR is the app's main weather for the first 48 hours (section 8, item 1). Then the secrets
   table, a size cap on the download cache, the hazard lookup table and a simple "page" mechanism. The registry
   of point 1 belongs in the same step.
9. **Total if everything in this file is built** (WeatherNext left out): about 75-90 agent-hours of building,
   about 100-130 with reviews and fixes. A sensible first pass (fix-first, AI weather source, model comparison,
   ledger core, radar water, search suggestions) is about 31 hours of building.

## Words used here (plain)

- **Provider / source**: the place the app downloads from (Open-Meteo, ECMWF's file server, NOAA's file server).
  **Model**: the computer program that made the forecast (HRRR, GFS, AIFS). One provider can serve many models.
- **Registry**: one table in the code that lists every model once, with everything the app needs to know about it.
- **Member**: one forecast out of a set made by the same model with small changes. **Driver**: the model whose
  members feed the fire model. **Mixed ensemble**: members from more than one model in one fire forecast.
- **Anchor**: the single fine-grid forecast (HRRR today) that the coarse members are shifted onto for the first
  two days.
- **Bundle**: the folder of files the app prepares for one fire or one flood.
- **Contract triple**: the three files that must always agree: `SPEC.md`, `backend/fire3d/contracts.py` and
  `web/src/api/types.ts`.
- **Hook**: one line added in existing code that calls new code ("when a forecast is ready, also record it").
- **Ledger**: a folder where every forecast is saved when it is made and never changed, so it can be scored later.
- **Job**: background work the API runs (a build, a forecast, a refresh). **Live loop**: a timer in the API that
  starts such work every 15 minutes.
- **Secret**: a key or token. **Allow-list**: the short list of internet hosts a secret may be sent to.
- **Dependency / package**: other people's code the app installs. **Wheel**: the file a Python package is
  downloaded as.
- **GRIB**: the file format weather centres publish forecasts in. One "message" is one map of one variable.
- **Agent-hour**: one hour of one build agent. Calibration: by commit times, brief 5 (floods: 7 build roles, their
  reviews and fixes, integration, final check) ran from 2026-11-04 21:50 to 2026-11-05 11:19, with at most two
  agents at once and some pauses; each build role took about 1-1.2 h from its first commit to its report, and its
  review and fix about as long again. Brief 6 (4 roles) took 4.7 h of wall clock.

---

## 1. Weather: how it enters a fire forecast, and what a provider interface would be

### 1.1 The path today

```
build:     pipeline.build_incident
             -> weather_bundle.build_weather(ctx, source=OpenMeteoSource)
                  -> source.deterministic(16 points, window)        one best forecast, 7 variables
                  -> weather.json  (public: series at the fire + 4 x 4 wind grid)
                  -> sim/weather.npz  (backend only: all 7 variables on the 4 x 4 grid, "HRRR had data" mask)
forecast:  ensemble.run_forecast -> prepare_forecast -> load_member_weathers
             -> weather_bundle.member_weathers(bundle, start, horizon, ensemble kind)
                  -> deterministic_grid(...)        stored weather, or a fresh fetch for a live fire (at most hourly)
                  -> source.ensemble(16 points, window, "gfs025" | "ecmwf_ifs025")     5 variables per member
                  -> bias_corrected_members(...)    shift each member onto the anchor (HRRR), fade over 6 h
                  -> dead fuel moisture per member (72 h spin-up), live fuel moisture (one value per run)
                  -> list[MemberWeather]            wind in km/h, kept in memory only
             -> one pyretechnics run per member -> arrival p10/p50/p90, burn probability, flame length
             -> forecasts/{run_id}/forecast.json    records only: source text, ensemble kind, member count
```

If the ensemble cannot be fetched (always for 2025 fires: Open-Meteo keeps about 90 days), the code falls back to
31 "perturbed" copies of the anchor, and says so in the run's warnings. If `member_weathers` fails altogether, a
second fallback builds members from `weather.json`.

### 1.2 Exact variables, units, grids and time steps

| Thing | Value today | Where in the code |
|---|---|---|
| Points | 16: the centres of a 4 x 4 grid over the fire area, row by row from the north-west, as (lat, lon) rounded to 4 decimals. The fire area is 8-60 km wide, so points are 2-15 km apart | `grid.weather_points`, `config.WEATHER_GRID_N`, `AOI_*` |
| Time axis | whole hours in UTC, as epoch milliseconds, from the whole hour at or before the start to the whole hour at or after the end | `sources.weather.hourly_axis` |
| Single forecast: 7 variables | `temp_c` (deg C, 2 m), `rh_pct` (%, 2 m), `dewpoint_c` (deg C), `wind_speed_ms` (m/s, 10 m), `wind_dir_deg` (degrees the wind comes FROM, clockwise from north), `wind_gust_ms` (m/s), `precip_mm` (mm in the hour). Shape (hours, 16) | `VARS`, `OpenMeteoSource.deterministic` |
| Ensemble: 5 variables | temperature, humidity, wind speed, wind direction, precipitation. Shape (members, hours, 16). **Gusts are not used by the fire model** | `ENSEMBLE_VARS`, `OpenMeteoSource.ensemble` |
| Window stored with a bundle | past fire: 72 h before the start to 72 h after the end; live fire: from (start, or 7 days ago) minus 72 h, to now plus 96 h | `weather_bundle.weather_window` |
| Window fetched for a forecast | 72 h before the forecast start ("spin-up" for fuel dryness) to the end of the horizon (default 72 h, at most 240 h) | `SPINUP_H`, `ensemble.MAX_HORIZON_H` |
| What a member hands to the fire model | `wind_speed_10m_kmh` (m/s x 3.6), `upwind_dir_deg`, `temp_c`, `rh_pct` (held between 1 and 100), dead fuel moisture `fm1`, `fm10`, `fm100` (fractions), live fuel moisture (herb, woody; one value per run), foliar moisture 1.0, and a `label`. Arrays are (hours, 4, 4) | `types.MemberWeather`, `member_weathers` |
| Anchoring | member value + (anchor - average of the members), in east-west wind, north-south wind, temperature and humidity; full while the anchor has data, fading to nothing over 6 h after it ends | `bias_corrected_members`, `BLEND_H` |
| Made-up members when no ensemble exists | 31; wind speed x e^(0.25 z), direction + 20 deg z, humidity + 6 % z, temperature + 1.5 deg C z, with z a slowly varying random series (8 h memory) | `perturbed_members` |
| Request budget | the app counts its own Open-Meteo use: 16 "weighted calls" for one fetch of 16 points; above 6,000 a day a live refresh keeps its last weather; live weather is fetched again at most once an hour | `request_cost`, `OPEN_METEO_DAILY_SOFT_CAP`, `LIVE_WEATHER_REFETCH_S` |
| Time budget | all members together get 240 s; beyond that every member re-runs at half resolution. Workers: the smaller of 10 and (processor cores - 2) | `ensemble.BUDGET_S`, `default_workers` |

### 1.3 What is hard-wired today

- **The anchor model.** `DETERMINISTIC_MODELS = ("gfs_hrrr", "gfs_seamless")`. The mask that says "HRRR had data
  this hour" is called `hrrr` in three files. (Section 8, item 1: this feed may end on 2026-11-30.)
- **The ensemble names.** `"gfs025"` and `"ecmwf_ifs025"` are listed in `sources/weather.py` (`ENSEMBLE_SIZES`),
  `build/weather_bundle.py` (`ENSEMBLE_KINDS`, `DEFAULT_MEMBERS`, one branch), `spread/ensemble.py` (`ENSEMBLES`,
  two branches), `contracts.py` (`EnsembleKind`, `EnsembleRequest`), `cli.py` and `spread/validate.py` (command
  choices), `web/src/api/types.ts`, `web/src/ui/AnalysisTab.tsx` (the selector and the member counts),
  `web/src/ui/options.ts` (two label tables), `web/src/lib/plainLanguage.ts` (the sentence), and `SPEC.md` lines
  75, 288, 360, 501 and 903.
- **One driver per run.** A run has one `ensemble` word and one free-text `source`. Member labels ("control",
  "member07") exist while the run is computed and are then dropped: `forecast.json` cannot say which member came
  from which model.
- **Credits by guessing.** The web decides which credit line to show by looking for the text "open-meteo" inside the
  source string (`web/src/lib/dataCredits.ts`). ECMWF members today carry only Open-Meteo's credit line.
- **A written "no".** `SPEC.md` lines 35-36 say "Do not implement a WeatherNext adapter", and
  `backend/tests/test_api.py` line 322 checks that asking for `ensemble: "weathernext"` is refused.
- **Weather exists only inside a fire bundle.** There is no route that answers "what is the forecast at this
  place". A fire-weather outlook, a rain outlook for floods, or a "my place" page all need one.

### 1.4 The provider interface (proposal)

Keep the two methods that exist (`deterministic`, `ensemble`). Add one table and two small things around them.

**(1) A registry row per model** (new file `backend/fire3d/weather/registry.py`; nothing else imports model names):

```python
@dataclass(frozen=True)
class WeatherModel:
    id: str            # "hrrr", "rrfs", "gfs025", "ecmwf_ifs025", "ecmwf_aifs025", "ncep_aigefs025", "hrrrcast", "weathernext3"
    label: str         # "ECMWF AIFS ensemble (AI)"
    family: str        # "physics" | "ai"
    role: str          # "anchor" (one fine forecast) | "ensemble"
    members: int       # 1, 31, 51, 64 ...
    grid_km: float     # 3, 25 ...
    native_step_h: int # 1, 3, 6: the model's own time step (the provider may have filled in the hours between)
    reach_h: int       # how far ahead it goes
    latency_h: float   # how long after its start time it can be downloaded
    has: frozenset     # {"temp", "rh" or "dewpoint", "wind", "precip", "gust"}
    provider: str      # "open-meteo" | "ecmwf-opendata" | "noaa-nomads" | "google-weathernext"
    issuer: str        # "ECMWF", "NOAA / NWS", "Google DeepMind"
    credit: str        # the exact credit line
    licence_url: str   # the terms page, and the date it was checked
    history_days: int | None   # what the provider keeps (None = an archive exists)
    needs_secret: str | None   # the name of an environment variable, or None
    allowed: bool      # False while a CLAUDE.md rule forbids it: listed and explained, never fetched
    raw_display: bool  # False when the terms forbid showing the forecast itself (only what is derived from it)
```

**(2) A provider** is the existing `WeatherSource` plus `models()` (the rows it serves) and two facts in every
answer: `init_ms` (when the model run started) and `interpolated` (true when hours between native steps were
filled in). `OpenMeteoSource` already fits; it only needs to read its model list from the registry.

**(3) Labelled members and a mixed ensemble.** `MemberWeather` gains `driver: str`. A forecast request may name
one model (as today) or a plan such as "16 GFS + 15 AIFS". Anchoring is done per model group. The run writes, in
addition to today's five layers, one small "middle arrival time" layer per driver. That is what lets Command draw
"where each model puts the fire edge" without running anything a second time: the cost of a run depends on the
number of members, not on the number of drivers.

**(4) Contract additions (all optional fields, so old bundles still load):**

```ts
// ForecastManifest.weather (SPEC 5.1)
weather: { source: string; ensemble: EnsembleKind; members: number;
  drivers?: { id: string; label: string; family: 'physics' | 'ai'; members: number; issuer: string; credit: string;
              init_ms: number | null; grid_km: number; native_step_h: number; anchored_to: string | null }[] }
// ForecastManifest.driver_layers?: Record<string /* driver id */, LayerInfo>     // arrival p50 of that driver's members
// EnsembleKind gains the new ids and "mixed"; GET /api/weather-models lists the registry (allowed and not allowed, with the reason)
```

### 1.5 How each model would fit

Source facts in this table are from `ai-weather.md` (checked there on 2026-11-10); the code columns are mine.

| Model | Family | Role | Route | New package | New secret | Under the rules today |
|---|---|---|---|---|---|---|
| HRRR 3 km (anchor today) | physics | anchor | Open-Meteo `gfs_hrrr` | none | none | use, but see section 8 item 1 |
| RRFS (the named successor) | physics | anchor | Open-Meteo (model id not checked) | none | none | use after a test |
| GFS ensemble, 31 | physics | ensemble | Open-Meteo `gfs025` | none | none | use (today) |
| ECMWF IFS ensemble, 51 | physics | ensemble | Open-Meteo `ecmwf_ifs025` | none | none | use (today) |
| **ECMWF AIFS ensemble, 51** | AI | ensemble | Open-Meteo `ecmwf_aifs025`; or ECMWF's own GRIB files | none (GRIB read tested, section 6.2) | none | **use** |
| NOAA AIGEFS, 31 | AI | ensemble | Open-Meteo or NOAA files | none | none | use with care: no humidity, so it cannot drive the fire model alone |
| NOAA HRRR-Cast, 3 km, about 18 | AI | ensemble | NOAA experimental bucket (GRIB) | none expected | none | use with care: experimental, 3 days kept |
| Google WeatherNext 3, 64 | AI | ensemble | Google Cloud (section 1.6) | yes | yes | **not allowed** unless you change the rule |

### 1.6 If you change the rule: what a WeatherNext reader would touch in the code

`ai-weather.md` section 2 has the access routes, terms, timing and credit lines. Here is the code side.

- **Which route decides the work.** Only the "full ensemble" route (Cloud Storage, 64 members) can drive the fire
  model. The statistics routes (BigQuery, Earth Engine, statistics files) give percentiles, which can feed a
  comparison chart or an outlook but not the fire ensemble.
- **New packages.** `google-auth` plus either `google-cloud-bigquery`, or `xarray` + `zarr` + a Cloud Storage
  reader. None is installed. (GDAL inside `rasterio` lists a Zarr driver, but I did not test it against Google's
  files, and nobody without access can.) Licences of these packages: **not checked today**; check before adding.
- **New secret** and the allow-list work of section 5.3.
- **Files touched:** `weather/registry.py` (set `allowed` to true), a new `weather/google_weathernext.py`,
  `config.py`, `http.py`, `pyproject.toml`, `SPEC.md` lines 35-36, `README.md` (the sentence "It uses no Google
  data" and the sources table), `CLAUDE.md` (two rules), `backend/tests/test_api.py` line 322, and the credit
  line in the web. Unit conversion is small (kelvin to deg C, dew point to humidity with the existing
  `rh_from_dewpoint`, metres of water to mm).
- **Two rules from Google's terms become code.** (1) Live WeatherNext values may not be published as they are, so
  the registry row has `raw_display: false`: the fire forecast made from it may be shown, a chart of its wind may
  not leave your own machine. (2) If Google ends access, the data must be deleted, so every stored file and every
  ledger record must carry its provider id, and there must be one command that removes a provider's data.
- **What leaves your machine:** your Google account and project id, and each query, which shows which fire areas
  you look at. **What comes in:** forecast numbers. **Cost:** nothing for the data today; downloads on the member
  route are billed to your project (`ai-weather.md` could not verify the prices).
- **Effort:** statistics reader for comparison only, about 3.5 h; member reader for the fire ensemble, 5-7 h and
  only after someone with access looks at how the files are cut into chunks. No test in the cloud session can
  touch Google: tests would use a fake login and recorded answers, as they do for `EARTHDATA_TOKEN`.

**What this means for the app.** One table of models turns "add an AI model" from an edit in 10 files into one row
plus, if the files are new, one reader. It also gives every model its own honest label (issuer, grid size, time
step, credit) and gives the "not allowed" models a visible, explained place instead of a silent absence. **Effort:**
AIFS as a third choice through the existing Open-Meteo code, 1.5 h; the registry, labelled members, mixed
ensemble, per-driver layers and credits from the registry, 3 h more; a direct reader for ECMWF's files (needed for
back-tests with real ensembles, because Open-Meteo keeps only 90 days), 3.5 h more.

---

## 2. The hazard dimension: how fire and flood are separated, and what a third hazard needs

### 2.1 Where each hazard lives today

Floods were added "beside" fires (CONTRACT 16: "No fire contract field changes and no fire union is widened").

| Layer | Fire | Flood |
|---|---|---|
| Id | `{year}-{slug}-{6 hex}` (`catalog.parse_incident_id`) | `flood-{YYYYMMDD}-{slug}-{6 hex}` (`floods/store.py`); never parses as a fire id |
| Catalog | `fire3d/catalog.py` (CAL FIRE and NIFC lists) | `floods/catalog.py`, `grouping.py`, `naming.py`, `registry.py` (stable ids), `history.py` (past years) |
| Folder | `data/incidents/{id}/` | `data/floods/{id}/`, plus `registry.jsonl`, `last_known/`, `live_state.json` |
| Build | `build/pipeline.py` (terrain, fuels, photos, observations, weather, behaviour, forecast) | `floods/build.py` (terrain, maps, gauges, satellite, time history, 3D products), built in `.staging/` and swapped in |
| Routes | `/api/incidents`, `/api/incidents/{id}`, `.../build`, `.../forecast`, `/api/bundles/{id}/{path}`, `/api/live/status` | `/api/floods`, `/api/floods/status`, `/api/floods/{id}`, `.../build`, `.../files/{path}`, `.../maps`, `.../model`, `.../satellite`, `.../timeline`, `/api/official/flood-alerts`, `/api/official/river-gauges` |
| Shared routes with a hazard switch | `/api/extras/evacuations?hazard=`, `/api/official/local-alerts?hazard=` (they accept only `fire` or `flood`) | same |
| Contract types | `IncidentSummary`, `IncidentManifest`, `ForecastManifest` ... | `FloodSummary`, `FloodManifest`, `FloodAlert`, `RiverGauge` ...; `Hazard = Literal["fire", "flood"]` |
| Live loop | `api/live.py` `live_refresh_loop` | `floods/live.py` `flood_refresh_loop` (a second task with its own state) |
| Switches | `FIRE3D_LIVE`, `FIRE3D_AUTO_BUILD_LIVE` | `FIRE3D_FLOODS`, `FIRE3D_AUTO_BUILD_FLOODS` |
| Test fixture | `fixture-demo`, `fixture-live`, `fixture-east` | `fixture-flood` and seven list-only floods |
| Fixed wording | `web/src/lib/plainLanguage.ts` and others | `floods/copy.py`, `web/src/ui/shell/floodCopy.ts` |
| Web store | `state/store.ts` (981 lines, treated as frozen) | `state/flood.ts` and seven helper files |
| Address bar | `?incident=<id>`, `?t=` | `?hazard=flood`, `?flood=<id>` (never together with `?incident=`) |
| Switch | `ui/public/HazardSwitch.tsx`: two options | same |
| Map chrome | `PublicFireChrome`, `CommandFireChrome` | `PublicFloodChrome`, `CommandFloodChrome` (`views.ts`: five chromes in all) |
| Map layers | inside `map/mapController.ts` (2,196 lines) | `map/floodController.ts`, mounted by the map controller; layer ids start `fx-flood-` |
| Point card | `location/LocationCard.tsx`, `locationCheck.ts` | `location/FloodPointCard.tsx`, `floodCheck.ts` |
| Time control | `ui/timeline/CompactTimeline.tsx`, `ui/Timeline.tsx` | `ui/timeline/Hydrograph.tsx`, `HydrographPlayback.tsx` |
| Forensic 3D | `scene/Scene.tsx`, `scene/fx/**`, `ui/Header`, `RightPanel`, `BottomDock` | `ui/forensic-flood/**`, `scene/flood/**` (reuses terrain, camera, probe) |

One event is open at a time. `flood.ts` watches the fire store and closes the flood when a fire opens; opening a
flood closes the fire.

### 2.2 What a third hazard (hurricane) needs, and a fourth

Following the same pattern, each row above gets a third column: `storm-al092026` ids, `fire3d/storms/`,
`data/storms/`, `/api/storms...`, `StormSummary`, `storms/live.py`, `FIRE3D_STORMS`, `fixture-storm`,
`state/storm.ts`, `?hazard=storm` and `?storm=<id>`, a third switch option, two more chromes,
`map/stormController.ts` with `fx-storm-` layers, a storm point card, an advisory stepper, and (later) a Forensic
branch. `hurricanes.md` section 9 lists the roles (H1-H7, 13.5-14 h).

What the pattern does **not** give for free:

1. **Two-way checks.** 39 lines in 24 web files test the hazard or the open event as a yes/no, mostly as
   `const floods = hazard === 'flood'` (for example `App.tsx`, `OverviewChrome.tsx`, `LayersPanel.tsx`,
   `ForensicWorkspace.tsx`, `LocationCard.tsx`, `CoordinateStrip.tsx`, `MapAttribution.tsx`, `LeaderLabels.tsx`,
   `SearchBox.tsx`, `floodController.ts`, `mapController.ts`). With three hazards "not flood" no longer means
   "fire". Each must become a lookup.
2. **Pairwise closing rules.** "Opening A closes B" is one rule for two hazards, three for three, six for four.
   One small "which event is open" module should own it.
3. **A click order.** The map controller asks the flood module first, then handles fires itself. A third module
   needs a list, not another `if`.
4. **Storm-scale geometry** (section 2.3, items 11-13).

**A fourth hazard later** (for example severe storms, heat, smoke as its own view) costs: one backend package on
the same pattern, one row in the web's hazard table, one store, one map module, two chromes, one point-card
block. With the lookup table in place the shared files change by one line each.

### 2.3 Assumptions that are still fire-only (or "fire or flood" only)

1. `JobStatus.incident_id` is the field a flood id travels in; `JobKind` is `build | forecast | refresh`.
2. `?t=` (time in the address bar) is fire-only; the flood handle is not in the address bar.
3. `eventKindOf(incidentId, floodId)` and `mapChromeOf(event: 'fire' | 'flood' | null, preset)` take two kinds.
4. Browser history entries hold `{incident, flood?}`.
5. The fire overview's markers and focus-by-zoom live inside `mapController.ts`, not in a module of their own.
6. `/api/live/status` is fire-only (it even has a California-only count); floods have `/api/floods/status`.
7. The two shared routes accept only `fire|flood`; `nws.local_in_scope(hazard=)` knows two scopes.
8. Evacuation zones: California and Oregon feeds, and Oregon's is wildfire-only (`FIRE_ONLY_FEEDS`).
9. Accuracy is fire-only: ten wildfire regions, one metric (`growth_sorensen`), one engine name
   (`ForecastModelInfo.engine: Literal["pyretechnics"]`).
10. Weather is fire-only (section 1.3, last point).
11. **Lower-48 land gate.** Both catalogs drop anything outside the lower 48 and DC, and the text "Disaster
    Mapping does not support Alaska, Hawaii or US territories yet" is fixed. A hurricane is mostly over water;
    Puerto Rico and Hawaii are hurricane places.
12. **One square, at most 60 km, in metres.** A bundle is a 1,024 x 1,024 grid in one UTM zone
    (`AOI_MAX_EXTENT_M = 60000`; floods use 8-60 km). The 3D scene works in local metres on that square. A storm
    is 500-1,500 km wide and crosses UTM zones.
13. **One time zone per event** (`summary.time_zone`). A storm crosses zones, and NHC advisories carry their own
    local-time label, which must be shown as issued.
14. The Forensic scene's fire effects (`scene/fx/**`) are frozen and fire-only; the shared manifest type has an
    `ignition` field that a flood sets to null.
15. Search knows fire names and flood names (`location/search.ts`).
16. The page title, skip links and the map's accessible name choose between two texts.
17. `scripts/make_fixture.py`, `serve_fixture.py` and `check_bundle.py` know two hazards.

**What this means for the app.** Hurricanes are a good fit for the list, the 2D map, the point card and replay by
advisory. They are a poor fit for the bundle and the 3D scene as they are. The honest plan is: storm data as plain
map shapes in longitude and latitude (no square grid), times shown both as NHC wrote them and in the viewer's
zone, the lower-48 rule replaced by "affects the lower 48" for storms, and Forensic 3D only for a coastal patch
(storm surge on terrain), as `hurricanes.md` H8 proposes. **Effort:** 2 h of plumbing first (items 1-3 of 2.2),
then `hurricanes.md`'s 13.5-14 h.

---

## 3. Validation numbers: where they are computed, stored and shown

| Number | Computed in | Stored in | Served by | Shown in |
|---|---|---|---|---|
| Skill of one run: overlap (Sørensen) of the forecast's middle map with what burned, at 12, 24, 48 and 72 h, total and "new growth only" | `spread/validate.py` `skill_from_arrays`, called at the end of `ensemble.run_forecast` when the bundle has observations for that time | `forecasts/{run_id}/forecast.json` field `skill` | the bundle files route | Forensic's Analysis tab; the hindcast command prints it |
| Regional accuracy: mean over fires of each fire's mean growth score; "tested / limited / untested"; too much or too little growth | `spread/validate.py` `regional_accuracy`, fed by `scripts/validate_us_fires.py` (run by hand) | `backend/fire3d/data/regional_accuracy.json` (15 KB, in git) | `GET /api/accuracy-regions` (`api/records.py`) | `ui/RegionAccuracy.tsx`, the fire card, the Analysis drawer, the location card; wording in `lib/plainLanguage.ts`; loaded once by `state/accuracy.ts` |
| Calibration and "as if live" studies | `validate.py` `batch_hindcast`, `live_start_check` | `docs/validation.md` (1,288 lines), written by hand | not served | the docs only |
| Timing of a run | `run_forecast` | a `timing: ...` line in the run's warnings | bundle files | Forensic |
| Anything about floods, weather inputs, live forecasts, burn probability, arrival time | not computed | | | |

Two facts from the code that matter for any scoring plan:

- **Live runs are deleted.** `api/live.py` `prune_live_forecasts` keeps the newest 4 ready runs per live bundle
  (and anything from the last 6 hours), then removes the folders.
- **The members' weather is never written.** Only the single anchor forecast is kept (`sim/weather.npz`). After a
  run, nothing records which wind each member saw.

**What this means for the app.** Today's numbers are careful but made by hand, once, for fires only
(`benchmark-validation.md` section 1 says the same from the science side). The code has exactly one automatic
score (the per-run `skill`), and it is lost for live fires together with the run.

---

## 4. Live loops, caches and jobs, and where a ledger and nightly scoring fit

### 4.1 What runs today

- **Two timers** start with the API when `FIRE3D_LIVE=1` (`api/app.py` `lifespan`): the fire loop and the flood
  loop, every 15 minutes, each with its own state and its own error handling. With `FIRE3D_LIVE=0` (tests,
  `./dev.sh --no-live`) neither runs.
- **Jobs** (`api/jobs.py`): two pools of background threads, `build` (2 workers; also runs refreshes) and
  `forecast` (1 worker, so one fire forecast at a time). A second request for the same kind and id returns the
  running job. Jobs live in memory only: a restart forgets them (a half-built bundle is then reported as an error).
- **Locks**: one file lock per bundle; builds and refreshes take it alone, forecasts started by the API or the
  live loop share it. (The command-line `forecast` calls the run directly, without the lock: a small gap.)
- **Caches and limits** (`fire3d/http.py`): every download goes through one client with a disk cache
  (`data/cache/http`, keyed by a hash of the request, each call saying how long its answer stays valid), retries,
  at most 4 requests at once, a per-source request limiter (FIRMS 150 per 10 minutes, NWS, NWPS 30 a minute,
  Open-Meteo's own counter), and a 60-second memory of hosts that are down. The flood list is also cached in
  memory for 5 minutes.
- **No size limit on the disk cache.** In this session `data/cache` is 1.1 GB of the 1.7 GB in `data/`; `SPEC.md`
  asks to keep `data/` under 3 GB on your Mac.

### 4.2 Where a forecast ledger hooks in

`benchmark-validation.md` sections 2.1 and 6 describe the ledger itself (a folder `data/ledger/`, an index, a
scorer per hazard, a nightly roll-up). The code side:

| What to record | The one place to hook | Why there |
|---|---|---|
| A fire forecast run | the end of `spread.ensemble.run_forecast`, right after the run is marked ready | all four callers pass through it: the live build (`pipeline._optional_steps`), the API and the live loop (`pipeline.run_forecast_locked`), the command line (`cli._run_forecast`) |
| The weather that drove it | the same place, from `setup.members` (in memory at that moment) | it exists nowhere else |
| A new NWS river forecast at a gauge | `floods/live.py` `append_bundle` (where new readings and product versions are appended) | it already sees each new issue |
| National Water Model series, NWS forecast-area map | `floods/live.py` `refresh_job_fn`, after the rebuild | a rebuild replaces them today |
| Hurricane advisories and model tracks (later) | the storm live loop, on each new advisory | |

The hook is one guarded call: a ledger failure must never fail a forecast. `prune_live_forecasts` can stay as it
is, because the ledger keeps its own compact copy.

### 4.3 Where nightly scoring fits

- **A third timer** in `lifespan`, next to the two that exist: every hour collect measurements that are due
  (stations and gauges), once a night score what can be scored and rebuild the roll-up, and on start-up catch up.
- **A new job kind** `"score"` (`JobKind`, `POOL_FOR_KIND`). Put it in the `build` pool or give it a one-worker
  pool of its own, so that scoring never holds up a build or a forecast.
- **What has been scored is kept in the ledger's own index on disk**, not in the job list (which is forgotten on
  restart).
- **By hand too:** `uv run python -m fire3d.cli ledger run --once`, so tests and a machine that is usually off
  can do the same work.
- New: `backend/fire3d/ledger/` (store, hooks, scorers, roll-up, loop), `api/ledger.py`, three contract models,
  a flag `FIRE3D_LEDGER`, `config.LEDGER_DIR`. No new package (SQLite is part of Python).

**What this means for the app.** The ledger is small in code (a package and five one-line hooks) and large in
effect: every later addition (an AI weather model, hurricanes, a flood model) gets a track record without its own
study. It should be built before or together with the first new model, not after.

---

## 5. Secrets: how the two are handled, and how a third would be added without leaking

### 5.1 Today

- **Where they come from.** `config.py` reads `<repo>/.env` with its own small parser and copies every line into
  the process environment (real environment variables win). So **any key in `.env` is visible to the API and to
  every process it starts** (the forecast workers). Two names are then read: `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`.
  Either may be missing; the app works without.
- **`FIRMS_MAP_KEY`** travels inside the request address. Addresses are masked wherever they are logged or put
  into an error (`config.mask_secrets`: the key's own value, plus patterns for a FIRMS address).
- **`EARTHDATA_TOKEN`** travels as a login header (`Authorization: Bearer ...`). `http.check_auth_headers` refuses
  to send that header to any host except the allow-list `EARTHDATA_AUTH_HOSTS` (one NASA host). Headers are never
  part of the cache key. If a download is redirected to another host, the header is dropped.
- **Masking** also covers any `Bearer ...` text and the signed parts of Amazon download addresses, and a log
  filter masks what the HTTP library itself logs.
- **Checks:** unit tests (`test_config.py`, `test_http.py`) and count-only scans in every final check.

### 5.2 What is hard-wired

`mask_secrets` loops over exactly two values. `check_auth_headers` knows one header name and one host list. The
log filter is attached to the loggers of one HTTP library (`httpx`). A third secret added by copy and paste would
work, but each copy is a place to forget.

### 5.3 Adding a secret the right way

**First, one hour of preparation** (no new secret yet): a table in `config.py`,

```python
SECRETS = {  # name -> where it may go and how
  "FIRMS_MAP_KEY":   Secret(env="FIRMS_MAP_KEY",   hosts=("firms.modaps.eosdis.nasa.gov",), carrier="url"),
  "EARTHDATA_TOKEN": Secret(env="EARTHDATA_TOKEN", hosts=("archive.podaac.earthdata.nasa.gov",), carrier="authorization"),
}
```

with `mask_secrets` looping over the table and `check_auth_headers` checking any secret-carrying header
(`authorization`, `x-api-key`, `x-goog-api-key`) against the hosts of the secret it carries. Tests: a header to a
host outside its list is refused before any request; every value is masked in logs, errors and files.

**Then a new secret is one row plus its patterns.** What is special about each candidate:

| Secret | How it is carried | Hosts | What is different | Leak risks to close |
|---|---|---|---|---|
| **Anthropic API key** (for an explanation box) | header `x-api-key`, read from `ANTHROPIC_API_KEY` by Anthropic's own library | `api.anthropic.com` only | The official library (`anthropic` 2.8.0, Apache-2.0) uses its own HTTP layer, `httpx2`, not the app's `fire3d.http`. So the app's cache, limiter, allow-list and log filter do not cover it by themselves | add the log filter to the `httpx2`, `httpcore2` and `anthropic` loggers; add a mask pattern for `sk-ant-...`; never log request headers; tests replay recorded answers and never call the service |
| **Google Cloud credential** (only if the rule changes) | not one string. Either a **service-account key file** (a JSON file with a private key; only its path goes in `.env`), or a **login done once on your Mac** with Google's tool (a file in your home folder, nothing in `.env`). Both are exchanged for short-lived tokens sent as `Authorization: Bearer` | `oauth2.googleapis.com` (the exchange), then `bigquery.googleapis.com` or `storage.googleapis.com` | The exchange needs Google's library (`google-auth`) or hand-written signing with a new crypto package: a dependency either way. The key file must live **outside the repository** (the `.gitignore` covers `.env` and `data/`, not a stray JSON file). Error texts and addresses contain your **project id** and **account e-mail**: not secrets, but private | mask the short-lived token pattern (`ya29....`), the text between `-----BEGIN PRIVATE KEY-----` markers, and (your choice) the project id; refuse to start if the key file is inside the repo; allow-list the three hosts for this secret only |
| **Another API key** (for example an account for radar images) | usually a header or a `Bearer` token | that service's host | one table row | the same tests |

The cloud session has none of these credentials, so every such path is tested with a made-up value and recorded
answers, as `EARTHDATA_TOKEN` is today. `CLAUDE.md` names the two allowed secrets; a third needs your approval and
one more line there.

**What this means for the app.** Adding a key is safe if the hour of preparation is done first. The Google
credential is the awkward one: it is a file, it needs a new package, and it brings private details (project,
e-mail) into logs that the app must also keep out of sight.

---

## 6. Heavy dependencies, and what running an AI model yourself would need

### 6.1 What is installed

Backend: Python 3.12 only (`>=3.12,<3.13`), 713 MB in this session. The largest parts: `pyarrow` 152 MB, `scipy`
126 MB, `rasterio` (with GDAL inside) 107 MB, `numpy` 67 MB, `pandas` 53 MB, `pyretechnics` (the fire engine) 34
MB, `scikit-image` 30 MB. The fire engine pins `numpy==1.26.4`, `scipy` 1.12 and `rasterio` 1.4. Web: `three`,
`maplibre-gl` 5.24, React 19.

**Not installed:** PyTorch, `xarray`, `zarr`, `cfgrib` / `eccodes`, `netCDF4`, `h5py`, any Google library, the
Anthropic library.

### 6.2 Reading weather files needs nothing new (tested)

GDAL inside the installed `rasterio` 1.4.4 lists drivers for GRIB, netCDF, Zarr and HDF5. I tested GRIB for real:
the index file of today's ECMWF AIFS run (29,538 bytes) gave the position of the 2 m temperature map; one byte-range
request fetched it (247,991 bytes); `rasterio.open` read it in 0.1 s as a 1,440 x 721 grid, already in deg C and
with longitudes from -180 to 180, with the run time and valid time in its tags. The other three formats are listed
by GDAL but were **not** exercised.

### 6.3 Three ways to use a model

| Way | Example | New package | New secret | Processor time | Verdict |
|---|---|---|---|---|---|
| **Download its output** | ECMWF AIFS, NOAA AI models, NASA water maps | none | none | seconds per fire | **use** |
| **Call a hosted service** | WeatherNext (Google Cloud), Claude (Anthropic API) | the service's library | yes | none locally | use with care; your decision each time |
| **Run it on your machine** | a radar flood mapper, Wildfire-FM | PyTorch, in a separate folder | none (weights are public downloads) | seconds per tile for small models | use with care, outside the backend |

### 6.4 What PyTorch would cost (package index read 2026-11-10)

- `torch` 2.15.0 needs Python 3.11 or newer. Its file for Python 3.12 is **138.6 MB on an Apple-chip Mac** and
  **539.2 MB on Linux**, where it also pulls in several graphics-card packages. Its licence is a mix of permissive
  licences (Apache-2.0, BSD, MIT and others).
- It does not declare a `numpy` version, so I cannot say from its metadata whether it is happy with the backend's
  pinned `numpy` 1.26.4: **not tested**.
- **The full global AI weather models are not laptop software** (`ai-weather.md`: an 80 GB graphics card for
  the full WeatherNext 2; ECMWF gives no number for AIFS), and there is no reason to run them: their output is
  published a few hours after each run.
- **Small models can.** `ai-mapping-llm.md` section 1.11 estimates seconds per image tile on a processor for the
  flood and burn models, and under a second for Wildfire-FM (31 MB of weights). Your Mac (`SPEC.md`: 12 cores, 36
  GB of memory, about 28 GB of free disk) is enough; the cloud session (4 cores, 15 GB, no graphics card) is
  enough for tests only.
- **The rule "add a dependency only when clearly needed".** PyTorch is not needed by anything in the recommended
  first pass. If you want a local model later: a separate optional folder (for example `ml/`) with its own
  environment, run as a command that writes a layer file and a small "which model, which weights, which inputs"
  note into the bundle. The API never imports it; the app works without it.
- **A lighter option for one model:** `onnxruntime` 1.31.1 (MIT; a 21-24 MB file; needs only `numpy` 1.21.6 or
  newer, which fits the pin). A model that its authors publish in, or allow converting to, the ONNX format could
  run inside the backend without PyTorch. I did not check this for any specific model.

**What this means for the app.** "Including AI models" does not mean running them. For weather it means downloading
what the weather centres publish and labelling it. Running a model yourself only makes sense for small mapping
models, and then next to the backend, not inside it.

---

## 7. The candidate additions: files, contracts, tests, risks, hours

Hours are agent build time. A review and its fixes add about a third to a half.

### A. Weather-provider interface + one AI weather source (ECMWF AIFS)

- **New:** `backend/fire3d/weather/registry.py`, `weather/provider.py` (the result shapes), optional
  `weather/ecmwf_opendata.py` (GRIB by byte range), `GET /api/weather-models`, `backend/tests/test_weather_registry.py`.
- **Touched:** `sources/weather.py` (model list from the registry; the anchor becomes a named model),
  `build/weather_bundle.py` (labels, per-group anchoring, a plan with several drivers), `spread/ensemble.py`
  (per-driver layer, `weather.drivers`), `types.py` (`MemberWeather.driver`), `contracts.py`, `cli.py`,
  `spread/validate.py`, `api/app.py`, `SPEC.md`, `README.md`; web `api/types.ts`, `ui/AnalysisTab.tsx`,
  `ui/options.ts`, `lib/plainLanguage.ts`, `lib/dataCredits.ts`.
- **Contract:** section 1.4 (4). All additions optional.
- **Tests:** `test_weather_source.py`, `test_weather_bundle.py`, `test_spread_ensemble.py`, `test_api.py`,
  `test_contracts.py`, web `dataCredits.test.ts` and the wording tests; a recorded AIFS answer; the registry test
  (every model has an issuer, a credit, a terms address; a not-allowed model is never fetched).
- **Risks:** Open-Meteo's request limit (more models, more calls; the cloud session's shared address hits the
  daily limit quickly); AIFS has 6-hour steps that Open-Meteo fills in to hourly, which hides the afternoon peak
  after the anchor ends (say so in the label); 51 members instead of 31 against the 240-second budget; people
  reading "AI" as "better" (wording: "another model, experimental"); no fair back-test through Open-Meteo.
- **Hours:** 1.5 (AIFS as a third choice only) + 3 (registry, labels, mixed ensemble, credits) + 3.5 (direct ECMWF
  reader, optional) = **4.5 to 8**.
- **What this means for the app:** the forecast can say "31 members: 16 NOAA GFS (physics), 15 ECMWF AIFS (AI)",
  each credited, and the next model is one row.

### B. Model-comparison layer in Command

- **Two parts.** B1, a weather panel: the raw (not anchored) wind, humidity and temperature at the fire from each
  allowed model, as lines or bands on one chart, with each model's run time. B2, on the map: one outline per
  driver of where its members put the fire edge at the chosen hour, from the per-driver layers of addition A.
- **New:** backend `api/weather_models.py` and `build/weather_compare.py` (a route
  `GET /api/incidents/{id}/weather-models`, cached one hour, counted against the Open-Meteo budget); web
  `ui/shell/ModelCompare.tsx`, `ModelCompareChart.tsx`, `state/modelCompare.ts`, `map/driverOutlines.ts`.
- **Touched:** `ui/shell/AnalysisDrawer.tsx` (mount), `ui/AnalysisTab.tsx` (Forensic), `map/MapLegend.tsx`,
  `ui/shell/LayersPanel.tsx`, `state/workspace.ts` (one layer key), one mount line in `map/mapController.ts`,
  `map/fireProfile.ts` (Public never draws it).
- **Contract:** one response type; the per-driver layers from A.
- **Tests:** route tests with a fake provider; pure tests of the chart model and the outline builder; screenshots.
- **Risks:** in the first 48 hours the fire members are anchored, so drivers differ little there: B1 must show raw
  values and B2 must say "anchored to HRRR until ...". Colours: the model colour is amber and green is banned, so
  drivers should differ by line pattern, not by new colours. `mapController.ts` is a shared hot file. WeatherNext
  could never appear in B1 on a shared screen (`raw_display: false`).
- **Hours:** B1 3 + B2 2.5 = **5.5**.
- **What this means for the app:** Command can show at a glance whether the models agree, which is the most honest
  use of several models.

### C. Hurricane hazard (catalog + views) on the flood pattern

- **New:** `backend/fire3d/storms/**`, `sources/nhc.py`, `api/storms.py`, `fixture-storm`, recorded samples of
  three past storms; web `state/storm.ts`, `map/stormController.ts`, `ui/shell/PublicStormChrome.tsx`,
  `CommandStormChrome.tsx`, a storm list panel, a storm point-card block, an advisory stepper, `stormCopy.ts`.
- **Touched (after the 2 h of plumbing in section 2.2):** `contracts.py` (`Hazard` gains `"storm"`),
  `api/app.py`, `config.py`, the web hazard table, `HazardSwitch.tsx`, `views.ts`, `App.tsx`, `state/history.ts`,
  `api/extras.py` and `api/official.py` (the `hazard=` pattern), `sources/nws.py` (a tropical scope).
- **Contract:** a new CONTRACT section 18; a storm contract test like `test_flood_contracts.py`.
- **Tests:** list, grouping by storm id, advisory frames, wording guards, endpoint contracts, a replay of the
  three recorded storms.
- **Risks:** the Atlantic season ends on Nov 30, so there may be no live storm to test with: replay of past
  storms must be the first thing built, not the last. Section 2.3 items 11-13. The national map is framed on the
  lower 48; storms need a wider view. Evacuation zones exist for two states only.
- **Hours:** 2 (plumbing) + 13.5-14 (`hurricanes.md` H1-H7) = **15.5-16**; with reviews about 20. Storm surge in
  3D, scoring and the flood link are further slices there (H8-H13).
- **What this means for the app:** official hurricane information with replay, and public model tracks (AI ones
  included) drawn as labelled guidance. The app would not forecast hurricanes itself.

### D. Forecast ledger + scorecard page

- **New:** `backend/fire3d/ledger/**`, `api/ledger.py`, `cli.py` commands `ledger run` and `ledger gate`; web
  `ui/scorecard/**`, `state/scorecard.ts`.
- **Touched:** the hooks of section 4.2 (`spread/ensemble.py`, `floods/live.py`), `api/jobs.py` and
  `contracts.py` (job kind `score`, three models), `api/app.py` (third timer, router), `config.py`; web
  `api/client.ts`, `api/types.ts`, `App.tsx` (the page gate of section 8 item 6), a link in the top bar menu and
  in `ui/RegionAccuracy.tsx`.
- **Contract:** `LedgerRecord`, `ScoreRow`, `Scorecard`; routes `GET /api/scorecard`, `GET /api/ledger`,
  `GET /api/ledger/{id}`.
- **Tests:** a frozen-forecast test (a recorded forecast and truth give the same score for ever), metric unit
  tests, hook tests (a ledger failure does not fail a forecast), roll-up tests, page tests with three empty states.
- **Risks:** disk (a fire run's five layers are 5.2 MB as written today at 512 x 512; the ledger must store them
  compactly and thin old ones); results will be unflattering at first; a record of a not-allowed or withdrawn
  provider must be removable by provider id.
- **Hours:** core (store, fire hook, keep live runs, fire scorer, fire-only page) **about 8**; the full first
  slice of `benchmark-validation.md` section 8.2 **about 14**.
- **What this means for the app:** the app starts keeping its own track record, for every model that is added.

### E. An LLM explanation box ("Explain this view")

- **Design** (from `ai-mapping-llm.md` section 3): the backend builds a numbered list of facts already on screen;
  the model returns sentences that each cite fact numbers; code drops any sentence without a valid number and
  replaces the whole answer with a fixed line if a banned phrase appears; a fixed footer is always added; off by
  default.
- **New:** `backend/fire3d/llm/` (`facts.py`, `client.py`, `check.py`, `copy.py`), `api/explain.py`
  (`POST /api/explain`); web `ui/explain/ExplainBox.tsx`, `state/explain.ts`.
- **Touched:** `config.py` (the key as an approved third secret, a switch `FIRE3D_LLM`, a monthly spending
  counter like the Open-Meteo one), `http.py` log filter, `pyproject.toml` (+ `anthropic`), `contracts.py`,
  `api/app.py`; web mounts in `CommandFireChrome.tsx`, `CommandFloodChrome.tsx` and the Forensic right panels.
- **Library and model.** Anthropic's guidance is to use its official Python library, not hand-written requests,
  and to start on Claude Opus 5.5 (`claude-opus-5-5`, $4 per million input tokens and $20 per million output
  tokens; Claude Sonnet 5.5 is $2 / $10 and Claude Haiku 5.5 $0.10 / $0.50). The library can return an answer
  that already matches a fixed shape (structured output), which is what the sentence-with-fact-numbers format
  needs, and the backend already has the `pydantic` package that describes such a shape. On this model the code
  must check the answer's stop reason, because a declined request comes back as a normal answer marked
  "refusal"; that case shows the fixed "No AI explanation available" line. The same guidance says to switch on
  the service's automatic fall-back to another model for declined requests, and to set the "effort" level
  explicitly (this model's default is the middle level). Which model to use is your decision.
- **Contract:** `ExplainResponse { status, sentences[{text, facts[]}], facts[{n, text, source, issuer, time_ms,
  url}], model, generated_ms, footer }`.
- **Tests:** recorded answers only; the fact-number checker; the banned-phrase guard; a test that the facts list
  never holds the selected point's coordinates or the browser's location; secret-masking tests; a "service down"
  test.
- **Risks:** safety wording (the hard limits in `ai-mapping-llm.md` 3.0); a second HTTP layer beside the app's
  own (section 5.3); cost without a cap; an answer that is stale after the data changes (store each answer with a
  hash of its facts and show it only for the same facts).
- **Hours:** the box alone **5.5**; a fixed glossary that needs no service, **2**; box plus daily digest 9-10
  (`ai-mapping-llm.md`).
- **What this means for the app:** plain-language help for a newcomer, built so that it can only restate what is
  on screen and never give advice.

### F. Radar / AI flood mapping

- **F1, radar water from NASA without a login** (`ai-mapping-llm.md` 1.1): `sources/opera.py`,
  `floods/satellite.py`, `floods/timeline.py`, `contracts.py` (`FloodPass.route` gains `"gibs"`), web
  `api/floodTypes.ts`, `scene/flood/satClasses.ts`, `state/floodTimeline.ts`, the two copy files. Tests on recorded
  tiles. Risk: classes are read back from picture colours, which is lossy; radar passes come every 6-12 days.
  **3-4 h.**
- **F2, a model run on your Mac** (ai4g-flood or TerraMind): a separate `ml/` folder with its own environment; it
  writes `layers/water_ai_<key>.bin` and `ai_water.json` (model name, weights checksum, input images, time) into
  the flood bundle. Backend: `floods/build.py` registers the layer if the file is there; `FloodLayerId` gains
  `water_ai`. Web: one more layer key, a Command and Forensic toggle (off by default), the legend label
  "AI-estimated water (experimental)". Risks: the radar input needs an account (a new secret, unless the existing
  Earthdata token covers it: not verified); PyTorch; no ground truth except NASA's own radar product.
  **10-14 h** (`ai-mapping-llm.md`).
- **What this means for the app:** F1 answers the biggest gap of brief 6 (clouds hiding floods) with data NASA
  already makes. F2 is a research experiment and should be labelled as one.

### G. A place page ("my place") that joins all hazards for one location

- **What exists.** Two point cards, chosen by the hazard switch: the fire card (`locationCheck.ts`, 528 lines) and
  the flood card (`floodCheck.ts`, 536 lines). The fire card already adds one line when a flood product covers the
  point. Routes exist for the state, county and time zone of a point, NWS fire-weather and flood products, river
  gauges, evacuation zones and relayed local messages.
- **What is missing.** Weather at a place (section 1.3), and one view that shows all of it together.
- **New:** web `ui/place/PlacePage.tsx`, `placeModel.ts` (a pure join of the answers), `placeCopy.ts`,
  `state/place.ts`; backend `api/place.py` with `GET /api/place/weather?lat=&lon=` (one point, a few variables,
  through the provider registry).
- **Touched:** `location/LocationCard.tsx` and `FloodPointCard.tsx` (an "Open place page" link), `App.tsx` (page
  gate), `api/client.ts`, `contracts.py`.
- **Sections of the page, in this order:** official information in effect at the point (every kind, each with
  issuer, times, wording and link); fires nearby (distance to listed fires; inside a modeled area or "outside the
  modeled area: unknown"); floods (products at the point, nearest gauges); storms (when C exists); weather outlook
  (model output, experimental, last). **Never one combined score, never the words "safe" or "low risk".**
- **Privacy, as the code is today:** the point goes to your own backend only. For current alerts, NWS is asked
  for the whole lower 48 and the answer is filtered locally, so the point is not sent to NWS (I checked the two
  active-alert requests in `sources/nws.py`). For past dates the archive is searched at the fire's own reported
  location; I did **not** trace every past-date path for a point the user picked, so a place page needs a test
  for it. A new place-weather route would send the point (rounded) to the weather provider: that is new, and
  should be said on the page. Only a typed street address goes outside today, to the Census geocoder, and only
  when submitted. The selected point is not kept in the address bar. Saving places in the browser is a question
  for you.
- **Tests:** the pure join; "nothing found" lines only when a source answered; wording guards; a test that the
  place-weather route is the only one that sends the point outside, rounded, and only when the page is opened.
- **Risks:** it invites "am I OK?" reading more than any other screen, so the wording work is the main work.
- **Hours:** **5.5**; a storm block later, 1 more.
- **What this means for the app:** the question most people actually have ("what about where I am?") gets one
  screen, built only from official answers plus clearly separated model output.

### H. The globe intro page and search suggestions (pending from BRIEF-4)

- **Globe intro.** The design file (`Intro.dc.html`) is **not in the repository**: BRIEF-4 calls it "a separate
  zip", and `docs/redesign/handoff-4/screens/` holds five other screens. It has to come from you. Code: a lazy
  `ui/intro/IntroPage.tsx` shown only on a first visit with no link target, with "Skip", and still under reduced
  motion; decorative orbits only (BRIEF-4: no live satellite positions presented as real). Two ways to draw it:
  a small three.js scene (three.js is already installed), or the map itself: the installed map library
  (`maplibre-gl` 5.24) has a globe view in its typings, and the app does not use it yet. The second would make
  "zooming in hands over to the US map" a camera move instead of a hand-over between two renderers, but it is
  **not tried** with this app's terrain and overlays. Touched: `App.tsx` (the gate), one small "seen" flag kept in
  the browser. **3.5 h** once the design file is here.
- **Search suggestions.** The backend already holds a local index of 35,585 places (towns, cities and 3,222
  counties) and 33,791 ZIP areas, from public-domain Census files, and the web holds the fire and flood lists. New `GET /api/geocode/suggest?q=`
  (prefix match in memory, no outside request); web `location/SearchBox.tsx` (600 lines), `search.ts`,
  `searchUi.ts`: a grouped list (fires, floods, towns, ZIP codes, counties) with keyboard control. **Street
  addresses stay as they are** (typed in full and submitted; BRIEF-4 decision 5). The contract text says "no
  autocomplete": that rule was about not sending keystrokes to outside services, and local suggestions keep it,
  but the sentence must be changed on purpose. Forensic's pending "search for a fire or pick a state" can reuse
  the same list. **3 h.**
- **What this means for the app:** two long-standing requests that touch few shared files and can be built at any
  time by a free agent.

### Summary

| | Addition | Build hours | New package | New secret | Rule change |
|---|---|---|---|---|---|
| A | Provider interface + AIFS | 4.5 (to 8 with the ECMWF reader) | none | none | none |
| B | Model comparison in Command | 5.5 | none | none | none |
| C | Hurricane hazard, slice 1 | 15.5-16 | none for slice 1 | none | none |
| D | Ledger + scorecard | 8 (core) to 14 | none | none | none |
| E | Explanation box (+ glossary) | 5.5 (+ 2) | `anthropic` | yes | secrets line |
| F1 | Radar water tiles | 3-4 | none | none | none |
| F2 | AI flood model on your Mac | 10-14 | PyTorch, in `ml/` | maybe | none |
| G | Place page | 5.5 | none | none | none |
| H | Globe intro; search suggestions | 3.5; 3 | none | none | contract sentence |
| | Fix-first pack (section 8) | about 7 | none | none | none |
| | WeatherNext reader (section 1.6) | 3.5 to 7 | Google libraries | yes | **Google rule + secrets line** |

---

## 8. Technical debt and risks to fix first

| # | What | Why it would make the additions fragile | Fix | Hours |
|---|---|---|---|---|
| 1 | **Open-Meteo says its HRRR feed ends 2026-11-30.** Its documentation page for the US models (read 2026-11-10) says: "The HRRR and NAM weather models will be discontinued at the end of November 2026", "Their successor, the Rapid Refresh Forecast System (RRFS), is already available in this API", "Please migrate to the RRFS models". `benchmark-validation.md` section 9 found this first and notes a second source that disagrees about NOAA's own timing | HRRR is the hard-wired anchor (`gfs_hrrr`) for every live fire and the reference every skill number was measured with. If the feed stops, live builds fall back to GFS (about 25 km instead of 3 km) with only a warning | Make the anchor a registry row; find and test the RRFS model name on Open-Meteo; re-run a small part of the hindcast study with it; update the wording. **Needed before December whatever brief 7 contains** | 2-3 |
| 2 | Ensemble names written out in about 17 places in 10 code files and 5 `SPEC.md` lines | every new model repeats the same wide edit; one missed place is a silent mismatch | the registry (part of addition A) | in A |
| 3 | Live runs deleted; member weather never saved | nothing new can be scored; AI models cannot earn or lose trust | the ledger hook (part of D) before or with the first new model | in D |
| 4 | Two-way hazard checks (39 lines, 24 files); pairwise closing rules; click order | a third hazard breaks "not flood means fire" in places no test covers | a web hazard table, one "open event" module, a list of map modules | 2 |
| 5 | Secret handling written for exactly two names | a third secret by copy and paste | the table of section 5.3 | 1 |
| 6 | No "page" concept: the web has two workspaces and no router | the scorecard, the place page and the intro each need a full-screen page; three roles would each invent one in `App.tsx` | one small `?page=` mechanism, built once | 0.5 |
| 7 | Disk cache without a size limit (1.1 GB here; `SPEC.md` asks for `data/` under 3 GB) | weather files and map tiles would be cached for ever | a size cap with oldest-first trimming; large files kept out of the general cache | 1 |
| 8 | Hot shared files: `contracts.py` (1,551 lines), `web/src/api/types.ts`, `SPEC.md` (1,568), `CONTRACT.md` (5,161), `api/app.py`, `config.py`, `App.tsx`, `map/mapController.ts` (2,196), `state/workspace.ts`, `README.md`, `pyproject.toml` | every addition touches the contract triple; two agents editing them at once collide | as in brief 5: the contract for a wave is written first, by one role, additively; empty routers for the new packages are mounted in `api/app.py` up front so later roles never edit it | in planning |
| 9 | One forecast worker; a 240-second budget; 2 workers in the cloud session (4 cores) | mixed or larger ensembles queue behind live forecasts and trip the half-resolution fallback | keep the total member count at 31 for mixed runs; measure before raising it | in A |
| 10 | Open-Meteo's limit on a shared address | more models mean more calls; the cloud session often starts the day already refused | recorded samples for tests; one direct reader (ECMWF) as a second route | in A |
| 11 | Written "no" to WeatherNext in `SPEC.md`, a test and `README.md` | if you change the rule, these must change together with `CLAUDE.md`, or the gates fail | one commit that changes all of them, only after your decision | 0.5 |
| 12 | Python 3.12 only; `numpy` pinned for the fire engine | most AI libraries move faster than these pins | keep AI libraries out of the backend (section 6.4) | none |

Items 1, 4, 5, 6 and 7 are the "fix-first pack": **about 7 hours**, no new package, no new secret, no rule
change. The registry (item 2) is counted under addition A, but it should be built in the same step as item 1,
because the anchor fix needs it.

---

## 9. What two agents can build at the same time without file conflicts

The rule that worked in briefs 5 and 6: two roles may run together only if the files they own are disjoint; a
shared file has one owner per wave; the contract triple is written first.

**Two tracks, run side by side.** Each line is one role; a role starts when the one above it in its track is
reviewed and fixed.

| Step | Track X (backend) | Track Y (web) |
|---|---|---|
| 0 | **backend-foundations:** secrets table, cache cap, anchor check (RRFS), the weather registry, the contract triple for steps 1-2, empty routers mounted in `api/app.py`. Owns `config.py`, `http.py`, `weather/**`, `sources/weather.py`, `build/weather_bundle.py`, `spread/ensemble.py`, `types.py`, `contracts.py`, `cli.py`, `SPEC.md`, `web/src/api/types.ts` | **web-foundations:** hazard table, "open event" module, map-module list, `?page=` mechanism. Owns `web/src/hazards/**` (new), `state/workspace.ts`, `state/selectors.ts`, `state/history.ts`, `ui/shell/views.ts`, `ui/public/HazardSwitch.tsx`, `App.tsx`, and the 24 files with two-way checks |
| 1 | **backend-ai-weather:** AIFS, labelled and mixed members, per-driver layers, `GET /api/weather-models`, the comparison route. Owns `weather/**`, `api/weather_models.py`, `build/weather_compare.py`, and the three weather files above | **web-model-compare:** the selector from the registry, credits, the comparison panel and outlines, against the fixture server. Owns `ui/AnalysisTab.tsx`, `ui/options.ts`, `lib/plainLanguage.ts`, `lib/dataCredits.ts`, `ui/shell/ModelCompare*.tsx`, `ui/shell/AnalysisDrawer.tsx`, `map/driverOutlines.ts`, `map/MapLegend.tsx`, `ui/shell/LayersPanel.tsx` |
| 2 | **backend-ledger:** store, hooks, job kind, timer, fire scorer. Owns `ledger/**`, `api/ledger.py`, `api/jobs.py`, one hook line each in `spread/ensemble.py` and `floods/live.py` | **web-scorecard:** owns `ui/scorecard/**`, `state/scorecard.ts`, a link in the top bar and in `ui/RegionAccuracy.tsx` |
| 3 | **backend-storm-sources**, then **backend-storm-bundle:** own `storms/**`, `sources/nhc.py`, `api/storms.py`, the storm contract | **web-storm-overview**, then **public** and **command:** own `state/storm.ts`, `map/stormController.ts`, the storm chromes and copy |
| 4 | **backend-flood-scoring** or **guidance** | **web-place-page:** owns `ui/place/**`, `state/place.ts` |

**Side roles** that own files nobody above touches, for whenever an agent is free:

| Role | Owns | Wait for |
|---|---|---|
| Search suggestions | `api/geocode.py`, `location/SearchBox.tsx`, `location/search.ts`, `location/searchUi.ts` | step 0 of track Y (`SearchBox.tsx` has a two-way check) |
| Radar water tiles (F1) | `sources/opera.py`, `floods/satellite.py`, `floods/timeline.py`, `scene/flood/satClasses.ts`, `state/floodTimeline.ts` | one contract line (`FloodPass.route`) written in step 0 |
| Glossary | new files under `ui/glossary/**` | nothing |
| Globe intro | `ui/intro/**` | step 0 of track Y; your design file |
| Explanation box (E) | `llm/**`, `api/explain.py`, `ui/explain/**`, mounts in the two Command chromes | step 0 of both tracks; your approval of the key |

**Pairs that must not run together:** any two roles that both need the contract triple in the same step; A and D
on `spread/ensemble.py` (run D's hook after A); B's map outlines and any storm map work on `mapController.ts`
(each needs only one mount line: let the planner add both lines in step 0).

**Limits:** the cloud session has 4 processor cores, so at most two agents build, review or fix at once (PLAN-5's
rule), and only one browser for screenshots at a time per agent.

---

## 10. Found on the way

1. **The HRRR notice** (section 8, item 1). I read the same Open-Meteo page as `benchmark-validation.md` and saw the
   same three sentences and the label "HRRR CONUS (Discontinued 2026-11-30)". I could not test the feed itself.
2. **The web page loads its two fonts from Google Fonts** (`web/index.html` lines 11-15: Inter and JetBrains Mono
   from `fonts.googleapis.com` and `fonts.gstatic.com`; `SPEC.md` line 1333 says so too). That is not "Google
   data" and the fonts themselves are open, but every viewer's browser contacts Google when the page opens. If
   the spirit of your rule is "nothing from Google", the fix is to ship the two font files with the app (about
   0.5 h; check the fonts' licence files when copying them).
3. **ECMWF members are shown under Open-Meteo's credit only.** `ai-weather.md` quotes ECMWF's own required credit
   for its open data. The registry's `credit` field would fix this for every model.
4. **Open-Meteo's free API is for non-commercial use** (`README.md` line 957, checked there on 2026-10-23). More
   models through it deepen that dependence; a direct ECMWF reader is also a way out.
5. **Older documents speak about WeatherNext and Google in four ways.** `PLAN.md` says "Access requested;
   skipped for now" and lists a WeatherNext adapter and a deployment on Google Cloud under "After v1"; `SPEC.md`
   says "out of scope for now (access pending)"; `README.md` says the app "uses no Google data". None of this is
   wrong; it should be made consistent with whatever you decide.

---

## 11. Evidence log (2026-11-10) and what I could not verify

| Check | Result |
|---|---|
| `backend/fire3d/**`, `web/src/**`, `SPEC.md`, CONTRACT 16-17, `contract5/`, `contract6/` | read; facts in sections 1-5 |
| `grep` for two-way hazard tests in `web/src` (tests and fixtures left out) | 39 lines in 24 files |
| `git log` commit times for briefs 5 and 6 | brief 5: 2026-11-04 21:50 to 2026-11-05 11:19; brief 6: 2026-11-05 13:07 to 17:47 |
| `uv pip list`, folder sizes | no PyTorch, `xarray`, `zarr`, `cfgrib`, Google or Anthropic library; environment 713 MB |
| `rasterio` 1.4.4 / GDAL 3.10.3 driver list | GRIB, netCDF, Zarr, HDF5 present |
| GET `ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20261110/00z/aifs-single/0p25/oper/20261110000000-24h-oper-fc.index` | HTTP 200, 29,538 bytes, 122 messages |
| GET the same `.grib2` with `Range: bytes=55332117-55580107` (2 m temperature) | HTTP 206, 247,991 bytes; `rasterio.open`: driver GRIB, 1,440 x 721, deg C, valid time 24 h after the run; read in 0.1 s |
| `pypi.org/pypi/torch/json` | 2.15.0; Python >= 3.11; cp312 files: macOS arm64 138.6 MB, Linux x86-64 539.2 MB, Linux arm64 483.7 MB; licence expression "Apache-2.0 AND ... BSD-3-Clause ... MIT ..."; no `numpy` in its requirements |
| `pypi.org/pypi/anthropic/json` | 2.8.0 (uploaded 2026-11-10); Apache-2.0; Python >= 3.10; needs `httpx2`, `jiter`, `docstring-parser`, `sniffio`, and four packages the backend already has; 2.5 MB |
| `pypi.org/pypi/onnxruntime/json` | 1.31.1; MIT; needs `numpy>=1.21.6`, `flatbuffers`, `packaging`, `protobuf`; 21-24 MB |
| `open-meteo.com/en/docs/gfs-api` | the three sentences quoted in section 8 item 1; model list labels "HRRR CONUS (Discontinued 2026-11-30)", "NAM CONUS (Discontinued 2026-11-01)", "RRFS CONUS" |
| `web/node_modules/maplibre-gl` 5.24 typings | `setProjection`, a "globe" projection and a `GlobeControl` exist; `web/src/map` sets no projection |
| `data/` in this session | 1.7 GB: cache 1.1 GB, incidents 389 MB, floods 155 MB |
| Tests | 1,466 backend tests collected; 151 web test files (not run: nothing was changed) |
| Claude model names and prices | from Anthropic's developer guidance bundled with this tool (dated 2026-11-03); they match the prices `ai-mapping-llm.md` read on Anthropic's page today |

**Not verified:**

- The Open-Meteo model name for RRFS, and whether RRFS covers the same hours and variables as HRRR.
- Whether Open-Meteo's historical HRRR archive stays after Nov 30 (the hindcast study depends on it).
- GDAL's Zarr and netCDF drivers against real weather files; any Google file (no access, by design).
- Whether PyTorch 2.15 works beside `numpy` 1.26.4.
- Google's host names for logging in and the look of its short-lived tokens (section 5.3): from memory, not
  re-checked, because nothing Google is proposed while the rule stands.
- Licences of `google-auth`, `google-cloud-bigquery`, `xarray`, `zarr`: not checked, because none is proposed while
  the Google rule stands.
- The globe view of the map library together with this app's terrain and overlays.
- Every hour estimate: they are judgments calibrated on commit times, not measurements.
- Facts I took from the other audit-7 files (model lists, terms, latencies, WeatherNext routes) are theirs; I
  re-checked only the HRRR notice and the ECMWF file route.

---

## 12. Questions only you can answer

1. **The Google rule.** Do you want to change "No Google data" so that WeatherNext 3 can be used? If yes: for
   back-tests only (the older data has an open licence), for a private comparison on your own machine, or as a
   driver of the fire forecast? And which access do you have (`ai-weather.md` section 2.2, routes A to G)? Until
   you answer, the registry would list WeatherNext as "not allowed" with the reason.
2. **Fonts.** Should the two fonts be shipped with the app instead of loaded from Google's servers?
3. **A third secret.** Would you approve `ANTHROPIC_API_KEY` for an explanation box, and with which model and
   monthly spending limit? (Without it, only the fixed glossary is built.)
4. **HRRR.** May the next build agent spend 2-3 hours before December on the RRFS check, even if the rest of
   brief 7 starts later?
5. **Hurricanes and the lower-48 rule.** Should storms that never touch the lower 48 be listed? Should Puerto
   Rico and Hawaii count for storms, although fires and floods there are not supported?
6. **Order.** My suggestion for a first pass of about 31 build hours: fix-first pack (7), AI weather source (4.5),
   model comparison (5.5), ledger core (8), radar water (3-4), search suggestions (3). Hurricanes (about 16) would
   be the second pass, when the plumbing is in place. Do you prefer hurricanes first?
7. **The globe intro.** Can you send `Intro.dc.html`? And may the intro be the map itself turned into a globe, if
   a test shows that works, or must it follow the design file exactly?
8. **The place page.** May places be saved in the browser (never on a server), and may a place be part of a link
   you share? Today neither is done, on purpose.
9. **Local AI models.** Is a separate `ml/` folder with PyTorch acceptable on your Mac (about 140 MB for PyTorch
   plus weights of 31 MB to 1.3 GB per model), for experiments that never run inside the API?
10. **Disk.** The ledger and weather files add a few GB a year. Is the "keep `data/` under 3 GB" limit in `SPEC.md`
    still right for your Mac?
