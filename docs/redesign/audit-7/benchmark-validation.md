# Audit 7: benchmarking and validation, or how the app can measure itself honestly (brief 7 planning)

Role: research for brief 7, topic "benchmarking and validation". **Documents only**: no app code changed, no bundle
built, no server started, no secret read or used.

This file was written in **two sittings on 2026-11-10**, both from the cloud session. The first (about 17:35-18:10
UTC) was cut short by a usage pause and left open points. The second (about 22:15-22:40 UTC) re-read the repository
facts, repeated five of the first sitting's test requests (same answers), and closed most of the open points. Both
used official pages read with WebFetch / WebSearch and small GETs with curl (one at a time, User-Agent
`Disaster Mapping research prototype`, at most 8 per host per sitting; about 40 in the first sitting and about 35 in
the second). The evidence log is section 12 and says which sitting saw what. Anything I could not check on an
official page is marked **not verified**.

Companion files of this audit: `ai-weather.md` (AI weather models), `hurricanes.md` (hurricane data and views) and
`ai-mapping-llm.md` (AI map layers and language models). This file does not repeat them; it says how each thing
they propose would be scored.

**Decisions this file cannot make for you.** `CLAUDE.md` says "No Google data, no paid map services, no Nominatim".
Five things in this topic touch Google. I have treated the first four as "do not use until you decide":

1. **WeatherBench 2 / WeatherBench-X** are Google Research projects, and their data sits in a Google Cloud bucket.
2. **Sen1Floods11** (hand-labelled flood maps) is downloaded from a Google Cloud bucket.
3. **Sim2Real-Fire** is downloaded from Google Drive.
4. **Scoring WeatherNext 3** is only possible if you allow WeatherNext at all (see `ai-weather.md` section 2).
5. **NHC's own yearly verification report scores Google's hurricane model.** The 2025 report lists it as `GDMI`
   in the same public table as the official forecast (section 2.5). Quoting that NOAA table is quoting an official
   U.S. government document, but the row is about a Google product, so I ask before showing it (question 1).

My working assumption is that reading a published paper or a published score is not "using Google data", and that
downloading from a Google bucket is a grey area. Both are yours to settle (question 1 in section 10). Everything in
the recommended first slice (section 8) needs **no** rule change, no new account, no new secret and no new package.

## 0. Short answer

1. **Today the app measures one thing well and nothing else.** It measures how well the fire spread forecast
   matches the satellite-reconstructed fire on 15 past fires (one score per region). It does not measure floods,
   weather inputs, satellite water maps, depth estimates, the official forecasts it shows, or its own live
   forecasts.
2. **The app throws its own track record away.** The live loop keeps only the 4 newest forecast runs per fire
   (`KEEP_LIVE_FORECASTS = 4` in `backend/fire3d/api/live.py`). NWS river forecasts are overwritten at each refresh,
   and a past flood shows "no forecast". So nobody, including us, can say how the forecasts shown last week did.
3. **The main proposal is a "forecast ledger".** Save every forecast the app shows, with its issue time, exactly
   as shown. When the truth arrives (a satellite pass, a gauge reading, a best track), score it automatically.
   The track record then grows by itself, every day, on the forecasts people really saw.
4. **The truth data are free, official and need no account.** (The one source that needs an account, Synoptic,
   is not recommended.) I tested these today: weather stations near fires (RAWS and airports) through the NWS API
   and the Iowa Environmental Mesonet (IEM) archive; every NWS river forecast since 2012 through IEM; the
   National Water Model's forecasts since 2025-01-01 on NOAA's AWS bucket; NHC's own forecast error files; NASA's
   12-hourly fire perimeters (FEDS); and USGS high-water marks for flood depth, at a new address the old one no
   longer points to (321 surveyed marks for Hurricane Helene, section 3.1).
5. **Honest display.** A Scorecard page per hazard, model and region, with sample sizes and "not yet tested";
   one chart that answers "when the model says 70 %, does it happen 70 % of the time?"; a label on each model layer
   that comes from the track record; "how did the forecast do last time" on past events; and a build check that
   fails when skill drops. One more rule for brief 7's new models (AI weather, hurricane tracks): **shadow first**.
   A new model runs silently in the ledger and is shown only once it has a record (section 5.7).
6. **Recommended first slice: about 14 agent-hours, 6 roles** (section 8): the ledger, fire scoring, flood-crest
   scoring, a weather-station scorecard, the Scorecard page, and skill gates. A smaller core of about 8 hours
   (ledger, fire scoring, Scorecard, gates) is possible if floods and weather wait.
7. **Found on the way (needs a decision before December).** Open-Meteo's documentation labels its HRRR feed
   "Discontinued 2026-11-30" and tells users to move to NOAA's new model, RRFS. The app's main fire weather is that
   feed (`gfs_hrrr`), and every score in `docs/validation.md` was measured with it. NOAA itself still runs HRRR:
   its servers held today's HRRR and RRFS runs side by side, and the NWS notice that started RRFS on Nov 3 retires
   other models, not HRRR (section 9). So the provider is dropping the feed, not NOAA. A weather scorecard is
   exactly the tool that would tell us whether a switch hurts.

## Words used here (plain)

- **Forecast**: a statement about the future made at a known time (the **issue time**) for a later time (the
  **valid time**). **Lead time** is the gap between the two.
- **Truth** (also "observation"): what was measured afterwards. Truth has errors too, and each score should say how
  good its truth is.
- **Score / metric**: one number that compares a forecast with the truth. **Skill** means "better than a simple
  guess", not just "a good-looking number".
- **Baseline**: the simple guess. **Persistence** means "nothing changes" (the fire stays as it is; the river stays
  at its level; the storm keeps its speed and heading).
- **Hindcast (back-test)**: a forecast made today for a past event, as if we had been there. It is cheap and
  repeatable, but it can flatter the model (better weather data, hand-picked start times).
- **Sørensen score** (the app's fire score): overlap of two areas, from 0 (no overlap) to 1 (identical).
  **IoU** and the **critical success index (CSI)** are the same idea with a slightly different formula:
  the shared area divided by the area covered by either map. CSI is the name used for floods and weather.
- **Hit, miss, false alarm**: forecast and happened; happened but not forecast; forecast but did not happen.
  **POD** (probability of detection) is hits / (hits + misses). **FAR** (false alarm ratio) is
  false alarms / (hits + false alarms).
- **Reliability (calibration)**: whether stated chances match what happens. If the model says "70 %" for many
  places, about 70 % of them should burn.
- **MAE / RMSE / bias**: average size of the error; the same with big errors counted more; the average signed
  error (positive = forecast too high).
- **In-sample / out-of-sample**: tested on the same cases the settings were tuned on (a best case), or on
  cases the model never saw (the fair test).
- **Pre-registration**: writing down the test cases and the metric **before** looking at any score, so nobody can
  pick the flattering ones afterwards. `docs/validation.md` section 10.1 already did this for brief 3.

---

## 1. What is measured today, and what is not

Read for this section: `docs/validation.md` (1,289 lines), `backend/fire3d/spread/validate.py`,
`backend/scripts/validate_us_fires.py`, `backend/fire3d/data/regional_accuracy.json`,
`backend/tests/test_spread_validate.py` and `test_regional_accuracy*.py`, `web/src/ui/RegionAccuracy.tsx`,
`web/src/state/accuracy.ts`, `docs/redesign/reports/brief3-validation.json` and `final-verification-*.json`, the
flood code in `backend/fire3d/floods/` and `backend/fire3d/api/live.py`.

### 1.1 Measured today (fire spread only)

| What | How | Result | Where |
|---|---|---|---|
| Fire spread forecast, Southern California | 3 fires of 2025 (Eaton, Madre, Palisades), 8 start times, leads 12/24/48/72 h = 32 scores. Forecast = the middle map (p50) of 31 members. Truth = fire spread rebuilt from satellite detections and mapped perimeters | growth Sørensen **0.43**; forecast growth about 1.85 times the real growth (median) | `docs/validation.md` 2-5 |
| The same, six other regions | 12 fires, two per region, start times and method fixed in advance (pre-registered) | 0.19 (Southeast) to 0.39 (Southern Plains); 8 of 12 fires forecast too little growth | `docs/validation.md` 10; `regional_accuracy.json` |
| "As if live" re-runs | Forecasts re-issued every 6 h on past fires with only the data known at the time | California: 51 issue times, 141 scores. Outside California: 12 fires, 531 scores, growth Sørensen **0.23** against the label's 0.30 | `docs/validation.md` 6.2, 10.8; `brief3-validation.json` |
| The truth itself | A synthetic fire with a known answer; final area against CAL FIRE | timing error about 1.3 h (median); final area within 1.4 % | `docs/validation.md` 1 |
| Model changes | Each change kept only if the score rose (drought moisture, held perimeter, decay); two tested and left off | table in `docs/validation.md` 3 | |
| Live fires | One evening (Oct 17, 2026): three live fires against CAL FIRE's reported acres | an anecdote, not a statistic | `docs/validation.md` 6.4 |

How it is shown: `GET /api/accuracy-regions` serves the regional file; `RegionAccuracy.tsx` shows one line per
fire ("Model accuracy here ..."), the words in Public and the number in Command, with the fires' range, the fuel
caveat and "Outside the modeled area is unknown, not low." Three regions say "Accuracy not yet tested here".
Historical forecast runs also carry their own `skill` list in the forecast manifest.

**What this means for the app.** The fire score is done carefully: pre-registered, out-of-sample outside
California, with caveats printed. It is the model for everything below. But it is one number about one hazard,
made once, by hand.

### 1.2 Not measured at all

| Thing the app shows | Measured? | Why it matters |
|---|---|---|
| **Live** fire forecasts (the ones users see) | No. They are deleted after 4 newer runs | Hindcasts start during a fire's main growth with archived weather. Live runs start from the latest satellite pass with forecast weather and "usually do worse" (`docs/validation.md` 10.10). The only evidence is 0.23 against 0.30 |
| **Burn probability** (the 0-100 % map) | No | `docs/validation.md` 6.5 says the ensemble range is "only about 2-4 % of the area" and "understates the real uncertainty". Nobody has checked what "90 %" really means |
| **Arrival time** (p10 / p50 / p90) | No (only the truth's own timing was checked) | The 3D view and the timeline show hours; the score only checks area |
| **Skill against a simple guess** | No | 0.43 means little without knowing what "the fire stays as it is" or "it grows like yesterday" would score |
| **Weather inputs** (wind, humidity, temperature at the fire) | No | Wind is the main driver. Hindcasts use "near-perfect" archived HRRR, live runs use GFS or ECMWF members shifted to HRRR. Neither was ever compared with a weather station |
| **Fuel moisture** (drought table in California, GSI elsewhere) | No | The Eaton under-forecast came from fuel moisture (`docs/validation.md` 4). Fire weather stations measure it |
| **NWS river forecasts** (crest height and time) | No. Shown word for word, never compared with what happened | A past flood says "no forecast" (`PAST_NO_FORECAST`), so the app cannot even show what was forecast |
| **National Water Model** (river flow series and flooded-area layers) | No | Shown as "experimental model output" with no evidence of how good it is |
| **NWS forecast flooded area** (the RFC map) against satellite water | No | Both layers are on the same map; their overlap is never computed |
| **Satellite water map** (NASA OPERA DSWx) | No (only cloud shares are reported) | The app trusts NASA's own validation |
| **Depth estimate** (FwDET, brief 6) and **height above river** (HAND) | Unit tests on synthetic shapes only (`test_floods_terrain3d.py`); never against measured water depths | The caveat says errors can be "a metre or more"; that is reasoning, not a measurement |
| **Data freshness** (how old each layer was when shown) | Shown per layer, never summarised | "NASA lists a pass 2 to 4 days late" is known from one report, not tracked |
| **Hurricanes, AI weather** | Not built yet | Scoring should be built together with them (sections 2.3, 2.5) |

### 1.3 Three structural gaps

1. **Forecasts are not kept.** Fire: newest 4 runs per live bundle, plus anything issued in the last 6 h
   (`KEEP_LIVE_FORECASTS`, `PRUNE_MIN_AGE_H`). Floods: each refresh replaces the gauge forecast and the NWM series.
2. **Hindcast and live are different tests.** A hindcast study picks fires that grew and starts while they grow.
   The app's most common live error is the opposite case: a fire that has stopped (Henderson, Oct 17: 13,330 ac
   forecast against 3,160 ac reported, before the fix). Only a record of live forecasts catches that kind of error.
3. **One metric.** A new paper on a public fire benchmark (WildfireSpreadBench, 2026, section 4) shows that the
   choice of metric changes which model "wins", and that the best-ranked model on the popular metric flagged 4 to
   5 times the real fire area. `docs/validation.md` 6.2 saw the same thing: growth Sørensen "scores every forecast
   as about 0" when a fire barely grows, whether the forecast said 0 ac or 5,800 ac.

---

## 2. A measurement programme

### 2.0 Seven rules that keep the scores honest

These already guide `docs/validation.md`. Brief 7 should write them into `CONTRACT.md` so every new score obeys them.

1. **Write the test down first** (cases, start times, metric, how results are averaged), commit it, then run.
2. **Never delete a bad score.** The ledger is append-only. A changed metric gets a new version number and is
   computed beside the old one.
3. **Say whether the test is in-sample.** Settings tuned on a case make that case a best case.
4. **Count events, not pixels.** One fire gives 260,000 pixels, but they all share one wind error. The honest
   sample size is the number of fires (or floods, or storms). Uncertainty comes from re-sampling whole events.
5. **Always show a simple guess beside the model** (persistence at least).
6. **Compare models on the same cases only** ("homogeneous" comparison, the way NHC does it).
7. **Grade the truth.** Each score says what it was compared with and how good that truth is
   (A: mapped by aircraft or surveyed; B: timed by satellite passes; C: sparse or cloudy).

Two wording rules from `CLAUDE.md` apply to every score: a score describes **past tests of model output**, never
how dangerous a place is; and the two banned phrases stay banned, including in chart labels and colour legends.

### 2.1 (a) The forecast ledger

**What it is.** A folder, `data/ledger/`, where the backend saves every forecast the app shows, at the moment it
is made or fetched, and never changes it afterwards. A second step, run every night, looks for forecasts whose
valid time has passed and whose truth has arrived, and writes a score next to each. A third step adds the scores
up into one small file that the Scorecard page reads.

**What goes in.**

| Forecast | Saved when | Issue time comes from | Truth | Scored when |
|---|---|---|---|---|
| Fire spread run (burn probability, arrival p10/p50/p90, area curve, settings, weather members used) | each live or hindcast run | the run (`issued_ms`, `start_ms`) | the app's own satellite reconstruction; mapped perimeters; later NASA FEDS as a second opinion | first score when start + 12 h has been observed; final when the fire is out and its last perimeter is in |
| Weather used for that run (16 points, hourly) plus the same hours from other models | with the run | the weather model's run time | RAWS and airport stations within the fire area | daily |
| NWS river forecast at each gauge of a built flood (and, optionally, every gauge at flood stage) | each refresh that brings a new issue | NWS (`issued_ms`, River Forecast Center) | the gauge's own readings | when the forecast period is over |
| National Water Model series at member gauges (analysis, short range, medium range) | each refresh | the model run time | the gauge's flow readings | same |
| NWS forecast flooded area; NWM flooded-area layer | each new map | the map's own time | NASA OPERA water map from a clear satellite pass | when a usable pass exists, 2 to 4 days later |
| Depth estimate | each build | the pass or forecast it was built from | USGS high-water marks | weeks later, large events only |
| Hurricane: NHC advisory forecast (official) and each model track | each advisory | NHC | NHC working best track, then the final best track | at each later 6-hourly fix; final after the season |
| AI weather forecasts (AIFS, others; WeatherNext only if allowed) | each run used | the model run time | stations; later an analysis | daily |

**What a record looks like** (one line of an index, one small file per forecast):

```json
{ "id": "fire/2026-henderson-…/fc-20261017T2250-gfs025-3df2",
  "hazard": "fire", "product": "spread_ensemble", "kind": "model",
  "source": "Disaster Mapping (pyretechnics 2026.8.10)", "issued_ms": 1792536600000,
  "start_ms": 1792536600000, "horizon_h": 72, "where": "2026-henderson-…",
  "app_commit": "f79ae9a", "settings_hash": "…", "weather": "gfs025 x31, anchored to HRRR",
  "files": ["burn_probability.u8.npz", "arrival_p50.u16.npz", "forecast.json"], "sha256": "…",
  "status": "scored-provisional", "metrics_version": 1 }
```

`kind` is `"model"` or `"official"`. Official records keep their issuer, their own times and a link, and they are
scored in separate tables, never averaged with model output.

**Why a ledger and not just more hindcasts.**

- It scores what users saw, including quiet fires, cloudy days and data outages.
- It cannot be tuned after the fact: the forecast was fixed before the truth existed.
- It is the only fair test for AI weather models. A back-test of an AI model on a year it was trained on is not a
  test (`ai-weather.md` section 2.4 raises this for WeatherNext). A ledger is always about the future.
- Some truths are only cheap for a short time. The NWS API keeps station readings for 7 days (measured, section
  12). The NWS forecast-area map and the NWM series for one river reach are, as far as I could find, not archived
  anywhere in a form the app could read later.
- It grows on its own. After one fire season the sample is in the hundreds of forecasts, not 15 fires.

**What it cannot do.** It starts empty, so the first numbers come from back-filling (sections 2.2-2.5 say what can
be back-filled from public archives). It only covers events the app looked at. And a forecast scored against the
app's own satellite reconstruction inherits that reconstruction's errors (rule 7).

**How it is shown.** The Scorecard page (section 5.1), "how did the forecast do" on a past event (5.4), and a
small "forecast receipt" on every forecast: its id and issue time, and later a link to its score.

**What this means for the app.** This is the foundation for every other item in this file. Without it, each new
model (AI weather, hurricanes, a flood model) would need its own one-off study, and live skill would stay unknown.
Effort: about 2 h for the store and the hooks; the scorers are counted under each hazard (section 8).

### 2.2 (b) Fire

| # | Measure | Plain meaning | Truth | Runs | Shown as |
|---|---|---|---|---|---|
| F1 | Growth Sørensen / IoU (kept) | How much of the new burned area the forecast and the fire share | reconstruction (grade B); mapped perimeters where they exist (grade A) | every scored lead; nightly | Scorecard, per region and lead |
| F2 | Area error | Forecast area minus real area, in acres and as a ratio. "Too much" and "too little" are separate | same | same | a two-sided bar: over / under |
| F3 | Missed area and false-alarm area | Acres that burned outside the forecast; acres forecast that did not burn | same | same | two numbers per lead |
| F4 | Arrival-time error | Where both the forecast and the fire burned: how many hours early or late the forecast front was (median, and the share within 3 h) | reconstruction; its own timing error is about 1.3 h, so nothing finer than about 3 h can be claimed | same | one sentence: the median hours early or late |
| F5 | Reliability of burn probability | Group all places by the stated chance (0-10 %, 10-20 %, ...). In each group, what share burned? | same | nightly roll-up over all scored runs | reliability chart (section 5.2) |
| F6 | Range coverage | How often the real area landed inside the model's 10-90 % range. It should be 8 times in 10 | same | same | one sentence |
| F7 | Skill against simple guesses | Is the model better than (i) "the fire stays as it is" and (ii) "the edge moves out everywhere by as much as it did in the last 24 h"? | same | same | one sentence: better than both simple guesses in N of M forecasts |
| F8 | Truth agreement ceiling | How well two independent reconstructions of the same fire agree (ours and NASA FEDS). No model can be expected to score above that | FEDS | per fire | a line on the chart |
| F9 | Near-miss credit | The overlap score again, but counted in 1 km squares instead of single grid cells (about 45 m on the Eaton bundle), so a forecast edge that is 200 m off is not scored like a complete miss (weather services call this the fractions skill score) | reconstruction | same | one extra column, Command and Forensic only |
| F10 | Probability score | One number for the whole burn-probability map: the average squared gap between the stated chance and what happened (0 or 1), compared with the same number for the simple guesses (the Brier score and Brier skill score) | reconstruction | nightly roll-up | one line under the reliability chart |

Notes for a reader new to this:

- **Why several measures.** F1 cannot tell a 5,800 ac false alarm from a correct "no growth" when the fire barely
  grew. F2 and F3 can. F7 with guess (i) scores 0 on F1 by construction whenever the fire grew, so the comparison
  with simple guesses must use F2, F3 and total-area IoU.
- **What F5 will probably show.** The ensemble range is known to be too narrow, so most places are near 0 % or
  100 %. The chart will likely show that "100 %" places burned much less than always. That is uncomfortable and
  useful: it lets the app say "in past tests, about N in 10 places the model marked above 90 % burned".
- **Low stated chances.** The same chart shows the share of "0-10 %" places that burned. It will not be zero.
  This is evidence for the app's standing line that a low model value and the area outside the model are unknown,
  not an all-clear.

**Back-fill without waiting.** The 15 built fires have their model inputs and their truth on disk in this
container (`data/incidents/`, 389 MB: `sim/static.npz`, `sim/weather.npz` and `layers/observed_arrival.bin` in
each). They hold **no** stored forecast runs (their manifests list `"forecasts": []`; I checked in the second
sitting), so the back-fill re-makes the forecasts at the pre-registered starts. That is quick: a 31-member run
took 5 to 15 seconds on the Mac (`docs/validation.md` section 7), so the roughly 50 starts behind the 188 scored
leads of `regional_accuracy.json` are minutes of computing, more in a cloud container. F2-F10 can then be computed in one role of about 2 hours of agent time. That gives the Scorecard real
content on day one. These are back-tests with archived weather, and the page must say so.

**Fuel moisture.** Fire weather stations carry a wooden stick whose water content is measured ("10-hour fuel
moisture"). The IEM archive returned it for the Chilao station near the Eaton fire: column `MMIRGZZ`, value 8.0 on
2025-01-08 08:53 UTC. The NWS code manual for this data format defines `MM` as "Fuel moisture, wood (%)", so that
is 8 %. Comparing the model's dead fuel moisture with those readings is cheap and has never been done. Live fuel
moisture (leaves and twigs, sampled by hand every week or two) used to sit in the National Fuel Moisture Database.
A search result of a federal notice says that database was replaced by the Field Sample Module of the Forest
Service's FEMS system, which is open without a login and has a read-only API. I did not open FEMS or test it, so
treat it as **not verified** and as a later step.

**What this means for the app.** The fire score becomes a small table instead of one number, and the app can say
plainly whether its forecast beats a simple guess. Effort: about 2.5 h for the metrics (F1-F7), the back-fill and
the gate command; F9 and F10 add about half an hour; the display is part of the Scorecard.

### 2.3 (c) Weather inputs

**The question.** How wrong were the wind, humidity and temperature the fire model was fed, at the fire?

**Truth.** Weather stations inside or near the fire area:

- **RAWS** (Remote Automatic Weather Stations): about 2,000 fire weather stations (the count is from memory) run
  by federal and state land agencies, placed in wildland. The fire-danger standard puts the wind sensor 20 feet
  (about 6 m) above the vegetation and averages over 10 minutes (search results of NWCG pages; I did not open the
  standard, PMS 426-3). Weather models and airports report wind at 10 m, and airports average over 2 minutes. So
  a RAWS reading is expected to be somewhat lower than a perfect 10 m forecast. I found no official conversion
  factor; the scorer should report RAWS and airport stations in separate rows and not "correct" either.
- **ASOS / AWOS**: airport stations. Good instruments, but in valleys and towns.
- **Later, a gridded truth:** NOAA's URMA, an hourly 2.5 km "analysis of record" that blends all stations with a
  model background. NOAA's own verification pages list it. Its AWS bucket (`noaa-urma-pds`) held folders from
  2014-01-28 to today. It fills the gaps between stations, but it needs a GRIB reader (a new package, the same
  question as in `ai-weather.md` section 6) and it is partly model. Use stations first.

I tested the route today: `api.weather.gov/gridpoints/LOX/160,51/stations` listed 64 stations around Altadena;
18 of the first 30 were RAWS; the Chilao RAWS returned hourly wind, gust, humidity and temperature. The NWS API
kept exactly 7 days of readings in both sittings (oldest reading 2026-11-03 22:53 UTC at 22:22 UTC on Nov 10).

**The forecast side.** For new forecasts: the weather the ledger saved with each run. For back-tests: the
`weather.json` of each built bundle, and Open-Meteo's Previous Runs API, which returns what a model said 1 to 7 days
earlier for the same hour (documented from January 2024 for most models; the app already uses this provider).

**Metrics, per model, variable and lead time** (a "WeatherBench-style scorecard", which just means a table with
models as rows and lead times as columns; weather centres colour it by who is better, the app's version would
use bar length and counts, section 5.1):

| Measure | Plain meaning |
|---|---|
| Bias | Is the model's wind too weak or too strong on average? |
| MAE | The typical size of the error (for wind, in km/h; for humidity, in % points) |
| Direction error | Typical wind direction error in degrees, counted only when the wind is above about 10 km/h |
| Critical-hour hit rate | Of the hours that were really hot, dry and windy (for example humidity at or below 15 % and wind at or above 40 km/h), what share did the model call? And how many did it call that did not happen? |
| Peak timing | Did the forecast put the strongest wind within 3 h of when it came? |
| Ensemble range coverage | How often the measured value fell inside the members' 10-90 % range (should be 8 in 10) |

**Models to compare.** HRRR (today's driver), GFS and ECMWF ensemble members (today's live members), and the AI
models of `ai-weather.md` (ECMWF AIFS first; NOAA's; WeatherNext only after a rule change). Scores are per fire
area and pooled per region. Expect coarse models to do worst on ridge-top RAWS: a 25 km box cannot see a canyon.
That is the honest finding the "model disagreement" panel of `ai-weather.md` needs.

**A first experiment worth doing.** On 2025-01-08 at 08:53 UTC, in the first night of the Eaton fire, the Chilao
RAWS (in the San Gabriel Mountains above Altadena; distance not measured) recorded a wind speed of 52 and a peak
of 75 (IEM archive, columns `USIRGZZ` and `UPHRGZZ`). The NWS code manual for this format gives miles per hour for
both (`US` "Wind, speed (MI/HR, M/SEC)", `UP` "Peak wind speed (MPH)"); the file itself states no unit, so one
cross-check against the NWS API's km/h values is needed before trusting it. What did the app's weather say for
that hour? Nobody has looked.

**AI weather models and WeatherNext.** The scorer treats every model the same way: a row in the table. Two
things are special for AI models. First, a back-test on years the model was trained on proves nothing, so their
fair test is the ledger (forecasts saved before the truth existed). Second, they are new, so they start in shadow
mode (section 5.7). If you allow WeatherNext 3, scoring it adds nothing to what `ai-weather.md` section 2.6
already lists as leaving or entering your machine: the scorer only reads the forecast values the adapter fetched
and compares them with public station readings on your disk. One thing is new: the ledger keeps those values on
your disk for years, and WeatherNext's terms must allow that (question 1c).

**NOAA's own scores, as a cross-check.** NOAA's Environmental Modeling Center has a public verification site with
sections for HRRR, RRFS, GFS and the AI models AIGFS and AIGEFS (`emc.ncep.noaa.gov/users/verification/`, marked
"not operational"). I read only its front page. It is the place to look up how NOAA rates RRFS against HRRR
nationally; the app's station scorecard answers the narrower question "at the stations near our fires".

**What this means for the app.** It turns "hindcast weather is near-perfect" from an assumption into a number, it
gives AI weather models a fair local test, and it would show the effect of the HRRR change of section 9. Effort:
about 2.5 h backend (station finder, readers, metrics, back-fill for the 15 fires); its table is part of the
Scorecard page.

### 2.4 (d) Floods

| # | Measure | Plain meaning | Truth | Runs | Shown as |
|---|---|---|---|---|---|
| W1 | Crest height error | NWS forecast peak minus the measured peak, in feet, by how far ahead the forecast was made | the gauge (NWPS / USGS readings) | when each flood ends; back-fill from the IEM archive | one sentence per lead: within 0.5 ft in N of M forecasts |
| W2 | Crest timing error | Hours early or late | same | same | same row |
| W3 | Category hit or miss | Forecast "moderate", got "minor"? A small table of forecast category against observed category | same, with NWS's own flood stages | same | 3 x 3 table |
| W4 | Warning lead time | Hours between the first forecast that reached flood stage and the river reaching it | same | same | median hours |
| W5 | Simple-guess comparison | Was the forecast better than "the river stays at its current level"? Did each update improve on the one before? | same | same | share of forecasts that beat the guess |
| W6 | National Water Model against gauges | Peak flow ratio and peak timing of the NWM short-range and medium-range series at the flood's gauges | gauge flow | nightly | per-flood row, labelled model |
| W7 | Forecast flooded area against satellite water (CSI) | Of the area either map calls flooded, the share both do. Reported with POD and FAR | NASA OPERA DSWx pass | when a clear pass exists | CSI with the cloud share beside it |
| W8 | Depth estimate against high-water marks | At each surveyed mark: the app's depth minus the measured height of water above ground | USGS high-water marks | weeks after large events | median error, number of marks |

Details that decide whether these scores are fair:

- **W1-W5 are scores of an official product.** They must be labelled as computed by Disaster Mapping from public
  NWS and USGS data, kept away from the official record itself, and never averaged with model scores. Forecasts
  whose peak lies at the end of the forecast period (`crest_at_end` in the app's data) have not shown their crest
  yet and must be left out or marked. USGS readings are provisional for months and can be revised.
- **Back-fill is possible today.** IEM archives every NWS river forecast it processes since 2012. I downloaded
  the 8 forecasts issued for the Calcasieu River gauge LCHL1 between Nov 1 and Nov 7, 2026 (160 rows) in one
  request. So W1-W5 can be computed for every past flood in the app's 2025 and 2026 lists without waiting.
- **W6.** NOAA's AWS bucket `noaa-nwm-pds` holds every NWM run from 2025-01-01 to today (measured). But one
  hourly file for the lower 48 is 14 MB and a day has hundreds, so back-filling is heavy. Saving the small
  per-gauge series the app already fetches (3 KB each) is the cheap route. That is a job for the ledger.
- **W7 must use masks**, or it will be wrong: count only pixels the satellite saw clearly; leave out water that is
  always there; match times (a pass within about 12 h of the forecast's valid time or of the crest). Satellites
  miss water under trees and between buildings, so some "false alarms" are real water. The display must say so.
- **W8 is possible, for a few large events.** A high-water mark is a mud or debris line that a USGS crew finds
  after the water has gone and surveys: where it is, how high above the ground, and how sure they are. USGS
  collects them only after big events and publishes them weeks to months later. The old service address now
  redirects to a web app, but the web app's own data service answers without a key (found in the second sitting,
  section 3.1). It lists 334 events back to 1888, 8 of them in 2025 (among them "2025 July TX Flood", "2025
  April KY Flood" and "2025 July NM Flood - Ruidoso Post-Fire", a flood below a burn scar) and 2 so far in 2026.
  For Hurricane Helene it returned 321 marks: 307 with a height above
  ground (from -1.3 to 8.5 ft, median 2.2 ft), 307 on rivers and 14 on the coast, surveyed between 2024-09-30
  and 2025-04-08. Each mark has a quality grade from "Excellent: +/- 0.05 ft" to "VP: > 0.40 ft"; 182 of the
  321 were graded "Poor: +/- 0.40 ft", and some carry notes such as "HWM was unreliable and was not used". So
  the scorer must use the grade and read the notes field. A fair comparison also needs the app's depth at the
  time of the **peak**, not at a satellite pass days later: the app's depth estimate is built from a pass or a
  forecast map, so each comparison must state which one and how far from the crest it was.
- **Flash floods** have no gauge. Their truth is local storm reports: short notes that NWS offices collect from
  spotters, police and fire departments. IEM serves them as GeoJSON without a key; a test for the San Antonio
  office on 2025-07-04 returned 8 flash-flood reports with place, time, source and a remark (for example water
  and debris over a named bridge). They are points that say "water was here", never "no water there", so they
  support a hit rate only, not a false-alarm rate.
- **A published yardstick for W5.** A study of NWS stage forecasts in Iowa for 1999-2014 found that the official
  forecast beat "the river stays as it is" by 0.04 to 1.24 ft of RMSE, more at longer leads (NOAA repository
  record 63660; from a search result, paper not opened). I found no current national NWS table of crest error by
  lead time (section 4), so the app's W1-W5 would be new information.

**What this means for the app.** The flood side gets its first numbers ever, starting with the simplest and
most useful one: how close NWS crest forecasts were at the gauges the app shows. Effort: W1-W5 2.5 h; W6 1.5 h;
W7 2.5 h; W8 about 2 h for the reader and the comparison, plus building the one or two past floods that have
marks (the app has no bundle yet for the Texas or Kentucky events of 2025).

### 2.5 (e) Hurricanes

`hurricanes.md` section 7 lists seven checks. For the ledger they reduce to this:

| # | Measure | Plain meaning | Truth | Reference lines |
|---|---|---|---|---|
| H1 | Track error | Distance between the forecast centre and the real centre at 12, 24, 36, 48, 60, 72, 96 and 120 h | NHC working best track (b-deck), then the final best track (HURDAT2, the next spring) | NHC's own five-year average errors; the consensus models |
| H2 | Along-track and cross-track error | Was the storm too fast or slow, or left or right of the forecast? | same | NHC publishes both |
| H3 | Intensity error | Wind speed error in knots, with rapid strengthening cases listed separately | same | NHC's averages; a persistence-and-climatology guess that NHC itself uses as the yardstick |
| H4 | Centre inside the cone | Share of forecasts where the real centre stayed inside the cone circle at each lead | same | about two in three by construction |
| H5 | Landfall error | Miles and hours between forecast and real landfall | best track landfall rows | none official |

Facts checked today:

- NHC publishes its **official forecast error database**: six text files of every individual forecast error,
  Atlantic from 1970 (without depressions) and 1989 (with depressions), eastern Pacific from 1989, to 2025, with
  a format document. The page was updated 08 July 2026; the Atlantic 1989-2025 zip is 440,502 bytes.
- The **2026 cone** circles are 25, 39, 49, 62, 77, 95, 134 and 200 nautical miles at 12, 24, 36, 48, 60, 72, 96
  and 120 h in the Atlantic, set so that two thirds of the official errors of 2021-2025 fall inside.
- NHC's **verification report for 2025** (dated 30 March 2026; I downloaded the PDF in the second sitting and read
  its tables 1 to 3). Atlantic, official forecast, all tropical cyclones:

  | Lead (h) | 12 | 24 | 36 | 48 | 60 | 72 | 96 | 120 |
  |---|---:|---:|---:|---:|---:|---:|---:|---:|
  | Track error 2025 (n mi) | 20.1 | 32.6 | 43.0 | 53.4 | 67.5 | 85.2 | 110.5 | 162.0 |
  | Track error, 2020-2024 mean (n mi) | 23.0 | 34.3 | 45.8 | 58.7 | 73.5 | 89.8 | 128.7 | 185.4 |
  | Simple-guess track error 2025 (CLIPER5, n mi) | 41.5 | 89.2 | 140.7 | 190.6 | 239.7 | 293.6 | 381.4 | 438.5 |
  | Wind error 2025 (kt) | 5.9 | 9.2 | 11.8 | 13.7 | 15.1 | 15.8 | 17.5 | 20.4 |
  | Wind error, 2020-2024 mean (kt) | 5.1 | 7.3 | 8.6 | 10.0 | 10.5 | 10.9 | 12.4 | 13.6 |
  | Forecasts in 2025 | 215 | 191 | 169 | 148 | 128 | 111 | 83 | 64 |

  Two lessons for the Scorecard. Track forecasts in 2025 were better than the five-year mean at every lead, while
  wind forecasts were 16 to 50 % worse, because of many rapid strengthening cases: one season is a small sample
  even for NHC. And NHC always prints a simple guess (CLIPER5 for track, Decay-SHIFOR5 for wind) beside its own
  forecast, which is rule 5 of section 2.0.
- **The Google row.** Table 2 of the same report compares models on the same cases. It lists `GDMI`, which the
  report calls "the Google DeepMind ensemble mean", with a smaller track error than the official forecast from
  12 to 96 h (for example 26.4 against 31.1 n mi at 24 h) and a larger one at 120 h (173.1 against 168.5). This
  is a published NOAA number about a Google product (question 1).

Rules: scores of the NHC forecast are scores of an official product (same labelling as W1-W5). Model tracks are
compared on the same cases. Samples are tiny: a season has a handful of lower-48 landfalls, so H1-H5 should be
shown per storm and pooled only over several seasons, with the count printed.

**What this means for the app.** Hurricane scoring can copy NHC's own method and use NHC's own numbers as the
reference, which is both honest and easy to explain. It should be built in the same step as the hurricane view,
not before. Effort: about 2.5-3 h once storms exist in the app.

### 2.6 (f) Satellite and AI maps

| Map | Independent check | Metric | Verdict |
|---|---|---|---|
| Fire reconstruction (ours) | NASA FEDS 12-hourly perimeters; final agency perimeter; later MTBS | Sørensen between the two, per time step | **use** FEDS for live fires from now on (its archive covers 2018-2021 only, so not the 2025 test fires) |
| Burn severity (dNBR picture) | MTBS severity classes, 1-2 years later | agreement of classes | later; MTBS not checked today |
| Satellite water (NASA OPERA) | A small hand-checked set made by you (below); NWS/USGS gauge "in flood or not" at the gauge pixel | CSI on the tiles; hit rate at gauges | **use with care** |
| Any AI water or burn map added in brief 7 | Sen1Floods11 hand labels (Google-hosted, rule question); the hand-checked set | IoU / CSI | only if such a model is added |
| Depth estimate | USGS high-water marks (W8) | error in metres | later |

**A small idea with a large effect: "check a tile".** A hidden page in Forensic shows one random 1 km tile of a
flood: the satellite photo on the left, the app's water map on the right, and three buttons (agrees, misses
water, shows water that is not there). Fifty tiles take you about fifteen minutes and give the app its own
hand-checked truth set, with your initials and date on each answer. No outside data, no licence question. It
is the same thing a benchmark like Sen1Floods11 is, at a small scale and for the app's own places. Effort: about 3 h.

**What this means for the app.** The app gets a second opinion on its own fire maps for free (FEDS), and a way
for a person to check the water maps. AI-made maps should not be shown without one of these checks.

### 2.7 When does the truth arrive?

| Forecast | First truth | Good truth | Final truth |
|---|---|---|---|
| Fire spread | next satellite pass (hours) | a mapped perimeter (about daily on large fires) | final perimeter after containment (weeks); MTBS (1-2 years) |
| Weather at the fire | the station's next report (within the hour; kept 7 days by the NWS API) | the same, from the IEM archive (years) | the same |
| River crest | the gauge, within the hour, provisional | the same after the flood | USGS-approved record (months) |
| Flooded area | a clear satellite pass (NASA lists it 2-4 days later) | several passes | high-water marks and surveys (weeks to months) |
| Hurricane track | NHC's working best track, every 6 h | the same | Tropical Cyclone Report and HURDAT2 (months; the next spring) |

So every score has two states, **provisional** and **final**, and the Scorecard says which.

---

## 3. Truth data: source cards

"Checked" means read or requested on 2026-11-10. Credit lines marked *proposed* are mine, in the style of the
README's credits table, because the source prescribes no wording.

### 3.1 Tested today, recommended

| | NWS API station observations | IEM ASOS archive | IEM DCP / HADS archive (RAWS) |
|---|---|---|---|
| What | Latest and recent readings of airport, RAWS and other stations | Airport station readings, long archive | Readings relayed by satellite from RAWS and river gauges, long archive |
| Who runs it | National Weather Service | Iowa Environmental Mesonet, Iowa State University | same |
| Route | `https://api.weather.gov/points/{lat},{lon}` then its `observationStations` list; `…/stations/{id}/observations?start=&end=` | `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=BUR&data=sknt&…` | `https://mesonet.agron.iastate.edu/cgi-bin/request/hads.py?network=CA_DCP&stations=CHOC1&sts=&ets=&what=txt&delim=comma` |
| Account / key | none (a User-Agent is asked for) | none | none |
| Cost | free | free | free |
| Terms | U.S. government work; `weather.gov/disclaimer` (as recorded in the README; not re-read today) | `mesonet.agron.iastate.edu/disclaimer.php`, read 2026-11-10: "The materials found on this website are in the public domain and may be used freely by anyone for any lawful purpose." and "Attributing the Iowa Environmental Mesonet of Iowa State University would be appreciated." The page states no rate limit | same |
| Credit | *proposed:* "Station observations: National Weather Service (api.weather.gov); RAWS stations are operated by federal and state land agencies" | *proposed:* "Airport observations (ASOS/AWOS), archived copy via the Iowa Environmental Mesonet (Iowa State University)" | *proposed:* "RAWS observations, archived copy via the Iowa Environmental Mesonet (Iowa State University)" |
| Resolution | points; about hourly | points; hourly and specials | points; hourly |
| Latency | minutes to an hour | about a day or less (not measured) | not measured |
| History | **7 days** (measured: oldest reading exactly 7 days old) | decades (2025-01-08 returned) | station CHOC1 listed from 2010-12-07; 2025-01-08 returned |
| What I saw | Chilao RAWS: wind 9.6 km/h from 69 degrees, gust 20.9 km/h, humidity 18 %, 17.8 C at 16:53 UTC (units are stated in the answer: `wmoUnit:km_h-1`) | Burbank, 2025-01-08 08:53 UTC: 12 kt from 350, gust 22 kt, humidity 16 % | Chilao, same hour: 11 columns incl. wind 52, peak 75, humidity 37, air temperature 34, fuel moisture 8.0. The file states no units. The NWS SHEF code manual (5 July 2012) gives: `US` wind speed (mi/h), `UP` peak wind speed (mph), `UD` direction (degrees), `XR` relative humidity (%), `TA` air temperature (F), `MM` fuel moisture, wood (%) |
| Verdict | **use** for the live ledger | **use** for back-tests | **use with care**: decode the codes with the manual and cross-check one week against the NWS API before trusting the units; not every RAWS may be present |

| | IEM HML archive (NWS river forecasts) | NOAA NWM operational archive | NHC forecast error database |
|---|---|---|---|
| What | Every river observation and forecast in NWS "HML" products, processed to tables | Every run of the National Water Model | Every official NHC forecast error, one row per forecast |
| Who runs it | Iowa Environmental Mesonet | NOAA, on Amazon's open data programme | NOAA National Hurricane Center |
| Route | `https://mesonet.agron.iastate.edu/cgi-bin/request/hml.py?station=LCHL1&sts=&ets=&fmt=csv&kind=forecasts&tz=UTC` | `https://noaa-nwm-pds.s3.amazonaws.com/` (folders `nwm.YYYYMMDD/short_range/` and others) | `https://www.nhc.noaa.gov/verification/verify7.shtml` (files under `…/verification/errors/`) |
| Account / key | none | none | none |
| Cost | free | free (downloads are large) | free |
| Terms | as IEM above; an archived copy of NWS products, not an official NWS source | NOAA open data. The registry page for the NWM retrospective says "Open Data. There are no restrictions on the use of this data." (checked); the page for the operational bucket was not read | U.S. government work (`hurricanes.md` 1.6) |
| Credit | "NWS <River Forecast Center>, archived copy via the Iowa Environmental Mesonet (Iowa State University)" (the README's pattern) | "NOAA/NWS National Water Center, National Water Model (experimental model output)" (the README's line) | *proposed:* "NOAA National Hurricane Center, forecast verification" |
| Resolution | per gauge; forecast steps of 6 h in my sample | 2.7 million river reaches; hourly | per forecast, per lead time |
| Forecast length | as issued (about 5 days in my sample) | NWM v3.0, per `water.noaa.gov/about/nwm` (read 2026-11-10): short range hourly, 18 h, one run; medium range four times a day, 10 days for member 1 and 8.5 days for members 2-6; long range 30 days | 12 to 120 h |
| Cadence, latency | as NWS issues (about daily; more in floods) | hourly runs; today's folder was present | updated once a year (last change 2026-07-08) |
| History | **since 2012**; forecasts one calendar year per request | **2025-01-01 to today** (measured); one hourly file 14.1 MB | Atlantic 1970-2025; eastern Pacific 1989-2025 |
| Verdict | **use**: back-fills W1-W5 | **use with care**: heavy; prefer saving the small series the app already fetches | **use**: reference lines for H1-H4 |

| | NASA FEDS fire perimeters | Open-Meteo Previous Runs / Single Runs API |
|---|---|---|
| What | Fire perimeters tracked every 12 h from VIIRS detections, labelled experimental by NASA | What a weather model said 1-7 days earlier for a given hour; or one whole past model run |
| Who runs it | NASA (Earth Information System / VEDA) | Open-Meteo (the app's current weather provider) |
| Route | `https://openveda.cloud/api/features/collections/public.eis_fire_lf_perimeter_nrt/items?bbox=&datetime=` | `https://previous-runs-api.open-meteo.com/v1/forecast`; `https://single-runs-api.open-meteo.com/v1/forecast?run=` |
| Account / key | none | none for non-commercial use |
| Cost | free | free within the daily limit |
| Terms | NASA open data policy (the README's NASA entry; this service's own page not read) | as for the app's existing Open-Meteo use (`ai-weather.md`); the underlying models keep their own credits |
| Credit | *proposed:* "NASA Fire Events Data Suite (FEDS), experimental" | as today, plus the model's owner |
| Resolution | 375 m detections; every 12 h; fires above 4 km² | as each model; hourly |
| Latency | newest record today was 2026-11-10 00:00 | not measured |
| History | live collection: the current year (99,936 records); archive collection: 2018-01-02 to 2021-12-31 | Previous Runs: "Most models are archived from January 2024"; Single Runs: "from 2nd of April 2026 for most models" |
| Verdict | **use** as a second opinion (F8). It uses the same satellites as our reconstruction, so it is not fully independent. NASA's note: its "perimeters" are not the operational kind | **use with care**: the shared cloud address had no quota left in either sitting, so I read the documentation but could not send a request. The HRRR entry on these pages is labelled "Discontinued 2026-11-30" (section 9), and the pages do not say whether its archive stays |

Added in the second sitting:

| | USGS high-water marks (Short-Term Network, STN) | NWS local storm reports, via IEM | NOAA URMA (analysis of record) |
|---|---|---|---|
| What | Surveyed flood marks after large events: place, height above ground, elevation, quality grade, notes | Short reports of flooding, wind and hail collected by NWS offices from spotters and agencies | An hourly 2.5 km grid of wind, temperature and humidity that blends station readings with a model |
| Who runs it | U.S. Geological Survey | National Weather Service; archived and served by the Iowa Environmental Mesonet | NOAA / NWS, on Amazon's open data programme |
| Route | `https://api.waterdata.usgs.gov/stnservices/events/`, `…/hwms/?event=<id>`, `…/hwmqualities/` (JSON). The old `stn.wim.usgs.gov/STNServices/…` addresses all answer 301 to the web app `apps.usgs.gov/stnweb`; I read the new address from that web app's own script | `https://mesonet.agron.iastate.edu/geojson/lsr.geojson?sts=&ets=&wfos=<office>` | `https://noaa-urma-pds.s3.amazonaws.com/` (folders `urma2p5.YYYYMMDD/`) |
| Account / key | none needed: plain requests answered 200 with a rate-limit header of 3,000. The web app's script carries a key of its own; I did not use or record it, and the app must not copy it | none | none |
| Cost | free | free | free (GRIB files; size not measured) |
| Terms | USGS data are U.S. public domain by the README's USGS entry; this service's own terms page was **not read**. USGS labels recent data provisional | IEM terms as in the first table; the reports are NWS products (U.S. government work) | NOAA open data; registry page **not read** |
| Credit | *proposed:* "High-water marks: U.S. Geological Survey, Short-Term Network (provisional data)" | *proposed:* "Local storm reports: National Weather Service <office>, archived copy via the Iowa Environmental Mesonet (Iowa State University)" | *proposed:* "NOAA/NWS Unrestricted Mesoscale Analysis (URMA)" |
| Resolution | points; one per mark; uncertainty graded from +/- 0.05 ft to more than 0.40 ft | points; time of the report | 2.5 km; hourly (from my memory of the product; I only listed folders) |
| Latency | weeks to months (Helene's marks were flagged from 2024-09-30, a few days after landfall, and surveyed until April 2025; when they appeared in the service was not measured) | minutes to days (the one report I opened was in a product issued four days after the event) | about 6 hours (from memory, not checked) |
| History | 334 events, 1888 to September 2026; 8 events in 2025, 2 in 2026 | not measured (IEM's storm report archive is long) | folders from 2014-01-28 to today |
| What I saw | Helene (event 346): 321 marks, 307 with height above ground (median 2.2 ft, largest 8.5 ft), 276 with an elevation, 265 approved | San Antonio office, 2025-07-04: 8 reports, all "FLASH FLOOD", each with place, time, source and remark | folder names only |
| Verdict | **use with care** (W8): few events, weeks late, check the grade and notes; not for live scoring | **use with care**: proof that water was somewhere, never proof that it was absent | **later**: needs a GRIB reader (one new package); stations first |

### 3.2 Already in the app, reused as truth

NIFC WFIGS perimeters and NASA FIRMS detections (fire truth), NWPS gauge readings and USGS water data (river
truth), NASA OPERA DSWx (water truth), NHC best tracks and a-decks (`hurricanes.md` section 2). Their terms and
credits are in the README table and do not change.

### 3.3 Looked at, not recommended or not ready

| Source | Finding | Verdict |
|---|---|---|
| **Synoptic Data** (the largest RAWS aggregator) | Its free Open Access programme is for "members of accredited U.S. educational institutions"; "a .edu email address is required"; one API response at a time, up to 1 year of history, renewed yearly (page read in both sittings) | **do not use**: needs an account and a third secret, and you may not qualify. The NWS API and IEM give the same stations without either |
| **NWM retrospective** (v3.0, 1979-2023) | A long simulation of the past, not forecasts | not needed |
| **WeatherReal** (Microsoft) | Quality-controlled station data for the year 2023 only; its second half comes from Synoptic and is not public (first sitting) | not needed; its method (grid value at the station, MAE per lead) is the one to copy |
| **Live fuel moisture samples** (FEMS Field Sample Module, the successor of the National Fuel Moisture Database) | By a search result of a federal notice: open without login, with a read-only API. Not opened, not tested | **later**, after a check of the API and its terms |
| **MTBS** (burn severity record) | not checked today | later |

---

## 4. Public benchmarks: join, reuse or just read?

"Could the app be scored on it?" is the practical question. The app has one forecasting model of its own (fire
spread). Everything else it shows is somebody else's forecast.

| Benchmark | What it contains | Licence and host (checked 2026-11-10) | Could the app's models be scored on it? | Verdict |
|---|---|---|---|---|
| **WildfireSpreadTS** (Gerard, Zhao, Sullivan; NeurIPS 2023) | 607 U.S. fires, January 2018 to October 2021; 13,607 daily images at 375 m; satellite fire detections as labels; 23 input layers (weather, forecasts, terrain, land cover) | **CC BY 4.0**; Zenodo record 8006177, one 48.36 GB zip (Zenodo's own record) | Yes, with work. Build bundles for 20-30 of its fires, run the app's 24 h forecast, and score it against the dataset's next-day fire mask with the benchmark's metrics. That puts pyretechnics beside published machine-learning models and a persistence baseline | **use with care (stretch)**: 5-7 h plus a 48 GB download; older fuel maps and weather archives are needed for 2018-2021 |
| **WildfireSpreadBench** (Gopakumar, Pannozzo; arXiv 2609.22191, v1 29 Aug 2026, v2 11 Oct 2026) | A study on WildfireSpreadTS: six models, one pipeline. The top model on the popular metric (average precision) flagged 4-5 times the real fire area and ranked fifth of six on overlap metrics; the model that flagged the most reached 16-23 times | paper CC BY 4.0; no code or data link on the page (abstract page read in both sittings) | No; it is a lesson, not a dataset | **read**: it supports reporting several metrics and the flagged-area ratio (the app's "growth ratio"). `ai-mapping-llm.md` 2.1 cites a second 2026 paper with the same message |
| **Sim2Real-Fire** (Li et al.; NeurIPS 2024) | 1 million simulated fires (FARSITE, WFDS, WRF-SFIRE) and about 1,000 real ones, five layers each | code Apache-2.0; **no dataset licence stated**; simulation and real-world files on **Google Drive**, a small sample on OneDrive (repository page, read in both sittings) | Poorly. Scoring one fire model against other fire models' simulations says little; the page does not say where, when or from what source the real cases come | **do not use** now (unclear licence, Google-hosted, weak fit) |
| **FloodCastBench** (Xu, Shi, Zhao, Zhu; Scientific Data 12, 431, 2025) | Hydrodynamic flood simulations for four floods: Pakistan 2022, UK 2015, Australia 2022, Mozambique 2019; 30 m to 480 m; 300-second steps | **CC BY 4.0**; Zenodo record 14017092, 21.55 GB | No. The app has no flood simulation of its own, and no event is in the United States | **do not use** now; revisit only if a flood-spread model is ever added |
| **Sen1Floods11** (Bonafilia, Tellman, Anderson, Issenberg; CVPR Workshops 2020) | 4,831 radar and optical chips (512 x 512) of 11 floods worldwide; 446 hand-labelled (counts from a search result and from `ai-mapping-llm.md`, not from the repository page, which gives no counts and no list of the floods) | **no LICENSE file and no licence text in the repository** (read in both sittings); a third-party copy says CC BY 4.0; data in a **Google Cloud bucket** (the README writes `gs://senfloods11/` in one place and `gs://sen1floods11` in its download command) | Only an AI water-mapping model could be scored on it. NASA's OPERA product, which the app shows, has its own validation | **only if** brief 7 adds an AI water mapper **and** you allow the bucket. Note that the AI flood model in `ai-mapping-llm.md` 1.5 was trained on this set, so scoring it there is in-sample |
| **WeatherBench 2** and **WeatherBench-X** (Google Research) | The standard scorecard for global weather models against ERA5 (1959-2023) and ECMWF analyses (2016-2022), at 0.25 degrees and coarser; WeatherBench-X is its newer scoring code and "handles sparse datasets like those coming from weather stations" | code Apache-2.0; data in `gs://weatherbench2/datasets`: "Some datasets allow commercial use. Others only permit research use", each with its own LICENSE file; the WeatherBench-X README says "This is not an officially supported Google product" (both read in the second sitting) | No. The app does not make weather forecasts, and a 25 km global score says little about wind in one canyon | **read the published scores; do not download** (Google rule). The local station scorecard of section 2.3 is the app's own small version |
| **Extreme Weather Bench** (McGovern and others, Brightband and partners; arXiv 2605.01126, 1 May 2026) | 329 cases from 2020-2024 (repository page): 46 heat waves, 14 freezes, 98 tropical cyclones, 56 atmospheric rivers, 115 severe storm cases; code to score any model on them | **MIT** (repository page); PyPI `extremeweatherbench` 1.0.2 (first sitting) | Not directly. Its case list is a ready-made, neutral choice of test events, and its results show how AI models do on extremes | **read and borrow the case list**; the page names ERA5 as truth and an archive of AI forecasts at CIRA, but not where the files are hosted |
| **NHC verification** (reports and error database) | Official track and intensity errors per forecast since 1970, yearly reports, cone sizes | U.S. government work; `nhc.noaa.gov/verification/` | Yes, by copying the method for any track the app shows | **reuse fully** (section 2.5) |
| **TCBench** (Gomez and others; arXiv 2601.23268, v1 30 Jan 2026, v3 3 Nov 2026) | Global tropical cyclone track and intensity benchmark for 1 to 5 days ahead, built on the IBTrACS best tracks, with 2023 test cases. Reference models: the TIGGE physics ensembles and the AI models AIFS, Pangu-Weather, FourCastNetV2, GenCast and FNV3P2 (GenCast is Google DeepMind's; FNV3 is the 2025 name of Google's cyclone model by `hurricanes.md` 3.2) | paper CC BY 4.0; no code or data link on the abstract page, so the data licence is **not found** | Not needed; NHC's files cover the app's scope | **read** |
| **NWS River Forecast Center verification** | A 2006 NWS plan describes a national river forecast verification system. Published studies exist for single regions: Iowa 1999-2014 (the official forecast beat "no change" by 0.04 to 1.24 ft of RMSE, growing with lead time) and twelve Missouri River points 1983-2013. In two searches I found **no current public table** of crest error by lead time | n/a | n/a | **nothing to join**. The app's W1-W5, computed from the IEM archive, would be new information for a user. That is one more reason to label them clearly as ours, not NWS's |
| **NOAA EMC verification pages** (`emc.ncep.noaa.gov/users/verification/`) | NOAA's own scores of its models: sections for GFS, AIGFS, GEFS, AIGEFS, HGEFS, RRFS, REFS, HRRR, RAP, the hurricane models and the URMA analysis. The front page says it "is not operational and is not subject to 24-h monitoring" | U.S. government site; front page only was read | No; it is NOAA scoring NOAA's models | **read**, above all for RRFS against HRRR (section 9) |
| **NOAA OWP flood map evaluation**, **FIMbench / FIMeval** (CIROH, University of Alabama) | NOAA scores its flood maps with CSI, POD and FAR against FEMA and USGS benchmark maps. FIMbench collects benchmark flood maps in five quality tiers, including maps made from high-water marks and from NOAA's aerial photos | found by search only; licences not checked | The method (CSI with masks) is the one W7 should copy; the benchmark maps could later serve as better truth than one satellite pass | **read now; check licences before any use** |
| **GOFER** (Liu, Randerson, Chen, Morton, Wiggins, Smyth; ESSD 16, 1395, 2024) | Hourly progression of 28 large California fires of 2019-2021 (each over 50,000 acres) from the GOES weather satellites, with fire lines and spread rates | **CC BY 4.0** on Zenodo record 14642378 (version 0.2, one 76 MB zip; Zenodo's own record, second sitting). The first sitting saw "non-commercial" on a mirror; the Zenodo record is the authors' own | As hourly truth for arrival time (F4), which the app's own reconstruction cannot give better than about 3 h. It needs bundles for some of those 28 fires, with 2019-2021 fuels and weather | **use with care, later**: the best public truth for arrival time; its viewer is a Google Earth Engine app, which the app would not use |

**What this means for the app.** Two public yardsticks fit well: NHC's verification (hurricanes) and
WildfireSpreadTS (fire). A third, GOFER, is the best public truth for fire arrival times. The others are either
for kinds of model the app does not have, or sit behind the Google question. The app's most valuable benchmark is
its own ledger, because no public benchmark covers "the forecasts this app showed for U.S. fires and floods in
2026".

**Could the app publish a benchmark of its own?** Yes, later, and cheaply: the ledger's score files plus the method
text are already a small open benchmark ("forecasts shown, truth, score"). Every input is public data, and an
export (section 7, "Open export") would carry each source's credit line and terms (Open-Meteo's free API, for
one, is for non-commercial use). Whether to share it is your decision (question 10).

---

## 5. Honest display

### 5.1 A Scorecard page

One page, reachable from the top bar in Command and Forensic and from "How was it tested?" in Public.

```
SCORECARD                          Tests of past forecasts. Not a statement about any place today.
[ Fires ] [ Floods ] [ Weather ] [ Hurricanes ]             Experimental. Follow local officials.

FIRE SPREAD MODEL (pyretechnics, experimental)                       updated Nov 10, 2026 · metrics v1
Region              Overlap of new growth   vs simple guess    Area error    Forecasts  Fires  Kind
Southern California 0.43  ████░░░░░░        better in 21/32    1.85x over    32         3      back-test, tuned here
Southwest           0.35  ███░░░░░░░        better in 19/32    1.84x over    32         2      back-test
Southeast           0.19  ██░░░░░░░░        worse in 15/24     0.35x under   24         2      back-test
Rocky Mountain      Not yet tested                                           0          0
LIVE FORECASTS (since Nov 2026)   Too few to say (7 forecasts, 2 fires)   [ see each forecast ]

OFFICIAL FORECASTS, compared by Disaster Mapping with public measurements (not an NWS statistic)
NWS river crest, 1 day ahead    within 0.5 ft in 14 of 22    median 0.4 ft    22 forecasts, 9 gauges
```

(The overlap and area-error numbers are today's values from `regional_accuracy.json`. The "vs simple guess"
column, the live row and the NWS row are **placeholders** to show the layout; those numbers do not exist yet.)

Rules for the page:

- **Every number has its count beside it** (forecasts and events), and its kind: back-test, tuned here, or live.
- **Three empty states, never a blank**: "Not yet tested", "Too few to say (n forecasts)" below a fixed minimum
  (the brief-3 rule is 2 fires and 16 scores; keep it), and "Truth not in yet".
- **Model output and official products are in separate blocks** with separate headings and are never averaged.
- **No traffic-light colours.** A green cell would read as an all-clear. Use one neutral colour with bar length,
  as the hydrograph and the fire card already do.
- **Each row opens the list of forecasts behind it**, each with its receipt, its map against the truth, and the
  truth's grade.
- **Filters**: hazard, model, region, lead time, date range, live or back-test.

### 5.2 The reliability chart, explained in plain words

The chart has one dot per group of places. Left to right: what the model said (10 %, 20 %, ... 90 %). Bottom to
top: how often it happened. Dots on the diagonal line mean the model's percentages can be taken at face value.
Dots below the line mean the model is too sure of itself. The caption under the chart is written by the code from
the data, in one sentence, for example (invented numbers): "Of the places the model marked 90 % or more, 5 in 10
burned (4 fires, 61 forecasts)." Each dot shows its count, and groups with too few cases are drawn hollow.

The same chart works for any stated chance: burn probability, the hurricane cone ("inside the cone 2 times in 3?"),
an ensemble's 10-90 % range for wind or river level.

### 5.3 A label on each model layer, taken from the track record

Today the fire card says "Model accuracy here ...". The same pattern can sit on every **model** layer in the
legend and in Layers & settings:

| Label | Rule |
|---|---|
| "Tested: agrees well with what happened" / "agrees partly" / "agrees poorly" | fixed score bands written into `CONTRACT.md`, with the number one tap away |
| "Too few tests to say (n)" | below the minimum sample |
| "Not yet tested" | no score |
| "Tested on past events only" | back-tests but no live forecasts scored yet |

The label describes the **test**, never the place. Official layers (NWS warnings, NHC cone, evacuation orders) get
no such label: they keep their issuer, times and link, as today.

### 5.4 "How did the forecast do last time?"

- **On a past event**: a row in the timeline, "Forecast made Oct 17, 15:50 for the next 24 h", that draws the
  forecast outline over what happened, with three plain numbers: area forecast, area that happened, hours early
  or late. For a past flood: the NWS crest forecast issued 1, 2 and 3 days before, as ticks on the river chart
  next to the measured peak (from the IEM archive, labelled archived).
- **On a live event**: one line in Command, "Yesterday's forecast for today: 2,100 ac forecast, 1,480 ac mapped
  so far", with a link to the receipt.
- **After an event ends**: an automatic one-page review listing every forecast issued, its score, the largest
  miss and the largest false alarm.

Public shows none of the numbers by default; it keeps the one-line words and "How was it tested?".

### 5.5 Tests that fail the build when skill drops

| Level | What | Where it runs | Fails when |
|---|---|---|---|
| 1. Metric tests | Each metric on tiny hand-made cases with a known answer (overlap, reliability bins, crest error, track error) | `uv run pytest -q`, always | the metric code changes its answer |
| 2. Frozen-forecast tests | Two or three small fixture forecasts with frozen truth; the scores are stored in the test | `uv run pytest -q`, always | a code change alters a stored forecast's score without the stored value being updated on purpose |
| 3. Skill gate | Re-run the 15 built fires (one member, a few minutes: a calibration point of 8 starts took 10-30 s, `docs/validation.md` 7) and compare with `backend/fire3d/data/skill_baseline.json` | a separate command, `uv run python -m fire3d.cli ledger gate`, in sessions where `data/incidents/` exists; it says loudly when it is skipped | the mean growth score falls by more than 0.01 overall or 0.02 in any tested region, or the area error grows by more than 10 % |
| 4. Drift watch | The nightly step compares the last 30 days of live scores with the 90 days before | live loop | never fails a build; raises a line in `/api/status` and on the Scorecard |

The baseline file is only changed in a commit whose message says why. Level 3 cannot run in a clean checkout,
because `data/` is not in git; that is acceptable for a research prototype and should be written in the README.

### 5.6 Wording

- Scores are about "past forecasts", "tests" and "agreement". They never grade a place or a moment.
- The two banned phrases of `CLAUDE.md` stay out of labels, captions, alt text and legends. "Unknown" and "not yet
  tested" are the words for missing evidence.
- A good score is never shown next to an evacuation order or inside an official record card.
- Every Scorecard view carries the two fixed lines the app already shows ("Experimental ..." and "Follow local
  officials").

### 5.7 Shadow first: how a new model earns its place

Brief 7 will add models the app has never tested: AI weather, hurricane tracks, perhaps an AI map layer. The same
rule can apply to all of them, and to any change of the fire model's settings.

1. **Shadow.** The new model runs in the background and its forecasts go into the ledger. Nothing is shown in
   Public. Command and Forensic may show it behind a switch labelled "In testing: not yet scored".
2. **Scored.** After a number of forecasts and events that is fixed in advance (for example 30 forecasts on at
   least 5 events), the Scorecard shows it beside the model in use, on the same cases only.
3. **Shown.** It gets a normal layer and label once it has a record. It becomes the default only if it is at
   least as good as the current default on the measures written down in advance, and you approve.
4. **Recorded.** Each step is one line in a small file with the date, the app version and the scores at that
   time, so anyone can see why a model is in the app.

Each model also gets a short **model card** in the Scorecard: who makes it, what goes in, what it was tested on,
where it is known to fail (for the fire model: firefighting is not simulated, embers are off, two fires per
region), its licence and credit, and the date of the last test. This is a plain-language version of what
`docs/validation.md` sections 8 and 10.10 already say.

Why this matters for the HRRR question of section 9: the replacement weather model would start in shadow next to
HRRR while both exist, so the switch is made with numbers in hand.

**What this means for the app.** New models stop being a matter of opinion ("AI is better") and become a matter
of record. It costs almost nothing once the ledger exists: about 1 h for the status field, the switch label and
the promotion log, and about 1 h for the model cards.

---

## 6. Engineering

### 6.1 Where things live

```
data/ledger/                      (inside data/, so it is already ignored by git)
  index.sqlite                    one row per forecast: id, hazard, product, kind, issuer, times, place, status
  forecasts/<hazard>/<yyyy>/<mm>/<id>/    the forecast as shown, compact, with a checksum
  truth/<hazard>/<yyyy>/<mm>/…            the measurements used, with the time they were fetched
  scores/<hazard>/<yyyy>/<id>.json        score rows per lead, with metrics_version and truth grade
  rollups/scorecard.json                  what the Scorecard page reads; rebuilt nightly
  rollups/skill_history.jsonl             one line per night, for the "over time" chart
```

- New code: a small package `backend/fire3d/ledger/` (store, hooks, one scorer per hazard, roll-up) and one line
  in each place that makes or fetches a forecast (`spread/ensemble.py` after a run, `floods/live.py` on a new
  gauge issue, later the hurricane and AI weather readers).
- **No new package.** SQLite is in Python's standard library, and every metric here is a few lines of numpy.
- The existing `regional_accuracy.json` stays as it is; the roll-up reads it as the "back-test" block so nothing
  the web shows today changes.
- Contracts: a new SPEC section and matching models in `contracts.py` and `types.ts` (`LedgerRecord`,
  `ScoreRow`, `Scorecard`). Routes: `GET /api/scorecard`, `GET /api/ledger?hazard=&where=`, and
  `GET /api/ledger/{id}` (the receipt).

### 6.2 Size (estimates from the code and from files measured today)

| Item | Per record | Rate | Per year |
|---|---|---|---|
| Fire forecast run | 4 layers of 512 x 512. Today they are written as float32 = 4.2 MB. Stored as 8-bit probability and 16-bit hours and compressed: about 0.2-0.4 MB (estimate, not measured) | the loop re-forecasts when the last run is 3 h old or the area changed by 2 %: up to about 8 a day per live fire | 6 live fires over a 180-day season: about 1.5-3 GB; about half that if only one run per 6 h is kept after 30 days |
| Weather used per run | about 50 KB | same | under 0.5 GB |
| Station readings | about 1 KB per station per day | about 10 stations per fire | negligible |
| NWS gauge forecast | 1.4 KB per issue (measured: 160 rows, 10.8 KB, 8 issues) | about 1-4 a day per gauge | member gauges only: a few MB; every gauge at flood stage (assuming about 300 gauges, 2 issues a day): about 50 MB compressed |
| NWM series per gauge | 3.2 KB (measured file) | 4 kept per day | about 5 MB per flood-month |
| Flooded-area maps | 0.1 MB (measured `rfc_fim.geojson`: 109 KB) | on change | under 0.5 GB |
| Hurricane advisories and model tracks | about 1 MB per storm (`hurricanes.md`: Helene's file 984 KB) | per storm | under 50 MB |
| **Total** | | | **about 2-4 GB a year**, mostly fire layers |

A cap (for example 10 GB) and a thinning rule keep it bounded: scores and the small JSON are kept forever; the
large layers of forecasts older than a year are thinned to one per day per fire. The folder can be copied to
another disk as a plain backup; losing it loses the track record, so the README should say to back it up.

### 6.3 Privacy

- The ledger holds forecasts and public measurements only. It holds **no** user location, search, address,
  "my place" pin, IP address or browser detail. The location card's lookups must never be written to it.
- "How did the forecast do at my address" is computed in the browser from the public score files, so the address
  never leaves the device.
- The "check a tile" answers (section 2.6) carry initials you choose; they stay in `data/` and are never pushed.
- No secret is involved: none of the truth sources recommended here needs a key. The count-only secret scans of
  the final checks should include `data/ledger/` once it exists.

### 6.4 Nightly scoring in the live loop

The API already runs two background loops (`live_refresh_loop` every 15 minutes for fires, `flood_refresh_loop`
for floods). The ledger adds a third, lighter one:

1. **Every hour:** collect truth that is due and cheap (station readings, gauge readings). This matters because
   the NWS API keeps station readings for 7 days only.
2. **Every night (about 09:00 UTC, night across the lower 48):** score every forecast whose valid time has passed
   and whose truth is in; mark provisional or final; rebuild `scorecard.json`; append one line to the history.
3. **On start-up:** catch up on anything missed while the computer was off. A gap longer than 7 days falls back to
   the IEM archive for station readings.

All heavy work runs as jobs through the existing `JobManager`, one at a time, with the request limits of
`fire3d.http` (per fire: about 10 station requests a day). The same work can be run by hand:
`uv run python -m fire3d.cli ledger run --once`. With `FIRE3D_LIVE=0` (tests, `./dev.sh --no-live`) the loop is
off and tests use recorded samples, as the flood tests do.

---

## 7. More ideas (each optional)

| Idea | What it is | Effort (agent-hours) | Verdict |
|---|---|---|---|
| Forecast receipts | A small id and issue time on every forecast in the UI; later it links to "how it did" | 1 (after the ledger) | use |
| Evidence map | The national map shaded by how much testing exists (region, fuel type, hazard): shows the blind spots at a glance | 1.5 | use |
| Skill over time | One small line per model on the Scorecard, with a mark at each app version, so a release that made things worse is visible | 1 | use |
| Adjusted probability | After enough data: a second, clearly labelled burn map where "90 %" has been corrected to what 90 % meant in the record | 2.5, needs about 50 scored forecasts | use with care, later |
| Truth agreement ceiling | Our reconstruction against NASA FEDS on live fires; drawn as the upper line on fire charts | 1.5 | use |
| Check a tile | The hand-check page of section 2.6 | 3 | use |
| Data-age scorecard | For each layer: how old the data was when shown, median and worst case, per source; counts of source outages | 1.5 | use |
| Event review page | The automatic after-event page of section 5.4 | 2 | use |
| Open export | Download the scores as CSV, with the method text, for anyone who wants to check them | 0.5 | use |
| Two-truth scoring | Score fire forecasts against mapped perimeters only (grade A) and show both numbers | 1 | use |
| Shadow first, with a promotion log | Section 5.7: new models run unseen until they have a record | 1 (after the ledger) | use, with the AI and hurricane builds |
| Model cards | Section 5.7: one plain card per model with its tests and known failures | 1 | use |
| Update consistency | Did each new forecast move toward what happened, or jump back and forth? One number per event ("5 of 7 updates were closer than the one before"). Works for fire area, river crests and storm tracks | 1 | use |
| Depth against high-water marks | Section 2.4, W8: needs a built flood that has USGS marks (Texas, July 2025 is the obvious first) | 2 plus the flood build | use with care, second slice |
| Flash-flood hit rate | Local storm reports inside or outside the warned and mapped areas (hits only, section 2.4) | 1.5 | use with care |
| Arrival time against GOFER | Section 4: hourly truth for 28 California fires of 2019-2021 | 4-6 (old fuels and weather needed) | stretch |
| WildfireSpreadTS cross-check | Section 4 | 5-7 plus a 48 GB download | stretch |
| NWS warning check | NWS flood and fire weather warnings against what happened. IEM already runs a public tool for storm warnings ("IEM Cow"); linking to it is enough | link only | link, do not build |

---

## 8. Effort and a recommended first slice

Calibration: in `docs/redesign/reports/*.json` a typical role took 1-2 hours; the brief-3 validation role, with
12 fire builds and many runs, was the longest of its brief.

### 8.1 All items

| Item | Section | Effort (agent-hours) | Needs | Risk | Verdict |
|---|---|---|---|---|---|
| Ledger store, hooks for fire and flood forecasts, stop deleting live runs | 2.1, 6 | 2 | nothing new | disk growth (cap and thinning) | **use, first** |
| Fire scorer (F1-F7), back-fill on the 15 built fires, gate command | 2.2, 5.5 | 2.5 (incl. runs) | bundles in `data/incidents/` | results will be unflattering; samples small | **use, first** |
| Flood-crest scorer (W1-W5), back-fill from the IEM archive, the nightly loop | 2.4, 6.4 | 2.5 | IEM archive | provisional gauge data; forecasts with the crest at the end | **use, first** |
| Weather-station scorecard (live and back-fill) | 2.3 | 2.5 | NWS API, IEM | RAWS wind height; station siting; Open-Meteo daily limit for back-tests | **use, first** |
| Scorecard page, reliability chart, weather table, receipts, empty states | 5.1, 5.2 | 3 | scores to show | wording; no traffic-light colours | **use, first** |
| Skill gates and metric tests; `docs/validation.md` section 11; SPEC and CONTRACT | 5.5 | 1.5 | built fires for level 3 | level 3 cannot run in a clean checkout | **use, first** |
| Layer labels from the track record | 5.3 | 1.5 | Scorecard | bands must be fixed before scores are seen | use, second |
| "How did the forecast do" on past and live events; event review | 5.4 | 2 + 2 | ledger with some weeks of data, or the IEM back-fill | official forecasts must stay separate | use, second |
| NWM against gauges (W6) | 2.4 | 1.5 | ledger | few floods at first | use, second |
| Forecast flooded area against satellite water (W7) | 2.4 | 2.5 | clear passes | clouds; water under trees | use with care, second |
| FEDS second opinion (F8) | 2.6 | 1.5 | live fires | not fully independent | use, second |
| Hurricane scoring (H1-H5) | 2.5 | 2.5-3 | the hurricane slice of `hurricanes.md` | tiny samples | use, with the hurricane build |
| AI weather scoring | 2.3 | included in the weather scorecard once a model is added | `ai-weather.md` first step | no fair back-test for AI models | use, with the AI build |
| Check a tile | 2.6 | 3 | your time: 15 minutes per 50 tiles | small sample | use, second |
| Shadow-first rule, promotion log, model cards | 5.7 | 2 | ledger | the entry numbers must be fixed before scores are seen | use, with the AI and hurricane builds |
| Depth against high-water marks (W8) | 2.4 | 2, plus one flood build | a built flood that has USGS marks (none of the 8 built floods has) | few events have marks; marks are graded "Poor" often; depth must be taken at the peak | use with care, second |
| Flash-flood hit rate from local storm reports | 2.4 | 1.5 | IEM storm reports | hits only, no false-alarm rate | use with care, second |
| WildfireSpreadTS cross-check | 4 | 5-7 | 48 GB; old fuel and weather data | large; old LANDFIRE editions | stretch |
| Sen1Floods11, WeatherBench downloads, WeatherNext scoring | 4 | not estimated | your decision on the Google rule | terms | only after your decision |

### 8.2 First slice (my recommendation): about 14 agent-hours, 6 roles, one pass

| Role | Does | Hours |
|---|---|---|
| checks-docs (starts first, finishes last) | The pre-registration; metric and frozen-forecast tests; skill baseline file; `docs/validation.md` section 11; README; CONTRACT section | 1.5 |
| backend-ledger | `fire3d/ledger/` store and index; hooks for fire runs, NWS gauge forecasts and NWM series; live runs are recorded before they are deleted; SPEC and contracts | 2 |
| backend-fire-scoring | Fire scorer F1-F7; back-fill of the 15 built fires; the `ledger gate` command | 2.5 |
| backend-flood-scoring | Crest scorer W1-W5; back-fill of the 2025-2026 past floods from the IEM archive; the nightly loop and `ledger run` | 2.5 |
| backend-weather-score | Station finder (NWS API), readers (NWS API, IEM), the six weather measures, back-fill for the 15 fires | 2.5 |
| web-scorecard | The Scorecard page, the reliability chart, the weather table, receipts, the three empty states | 3 |
| | **Total** | **14** |

**A smaller core, about 8 hours:** checks-docs, backend-ledger, backend-fire-scoring and a fire-only Scorecard
(2 h). Flood crests and the weather scorecard then follow as two add-ons of 2.5 h each.

**Order matters for honesty.** The checks-docs role writes the pre-registration first (which fires, floods,
gauges, metrics, score bands, minimum samples) and commits it before any new score is computed, as brief 3 did.

**What you would see at the end:** a Scorecard with real numbers for fire (15 fires, six measures, against two
simple guesses), for NWS crest forecasts at the gauges of the app's past floods, and for wind and humidity at the
stations near the 15 fires; "Too few to say" for live forecasts, with the count rising each day; and a build
check that goes red if a later change makes the fire model worse.

### 8.3 Second slice (after two to four weeks of ledger data)

Layer labels, "how did the forecast do", NWM against gauges, forecast flooded area against satellite water, the
FEDS second opinion, check a tile: about 14 hours. Depth against high-water marks and the flash-flood hit rate add
about 3.5 hours and one flood build. Hurricane and AI weather scoring, and the shadow-first rule (2 h), ride along
with their own builds.

### 8.4 If brief 7 builds AI weather and hurricanes first

Then the smallest honest companion is about 6 hours: the ledger (2 h), hooks for the new forecasts (included in
each new adapter), the shadow-first rule (2 h) and a one-table Scorecard (2 h). The new models then collect a
record from the first day, and the fire and flood scorers can follow.

---

## 9. Found on the way (outside this topic, but it affects the app)

**Open-Meteo marks its HRRR feed as ending on 2026-11-30.** Its documentation page for the U.S. models
(`open-meteo.com/en/docs/gfs-api`, read in both sittings through WebFetch) says: "The HRRR and NAM weather models
will be discontinued at the end of November 2026.", "Their successor, the Rapid Refresh Forecast System (RRFS), is
already available in this API." and "Please migrate to the RRFS models." The model list shows "HRRR CONUS
(Discontinued 2026-11-30)", "HRRR CONUS 15 min (Discontinued 2026-11-30)", "NAM CONUS (Discontinued 2026-11-01)"
and three RRFS entries. The Previous Runs page and the Historical Forecast page carry the same HRRR label. The
Historical Forecast page lists HRRR "since 2018-01-01" and does **not** say whether that archive stays after the
feed ends.

**NOAA itself has not retired HRRR.** This was open after the first sitting; the second sitting settled it.

- NWS Service Change Notice 26-48 (updated Oct 15, 2026; I extracted the PDF's text) is titled "Implementation of
  the Rapid Refresh Forecast System (RRFS) and RRFS Ensemble Forecast System (REFS): Effective November 3, 2026".
  It says: "The RRFS and REFS will replace NAM, HREF, SREF, and HiresW." HRRR is not on that list. The notice
  even uses it: "the HRRR provides two additional members" of the new ensemble.
- NOAA's public server held today's runs of both models on 2026-11-10 at 22:16 UTC: folders `hrrr.20261110` under
  `nomads.ncep.noaa.gov/pub/data/nccf/com/hrrr/prod/` and `rrfs.20261110` under `…/rrfs/prod/`.
- A search result quoting an NWS webinar says HRRR's retirement is expected with a later upgrade of RRFS, at a
  time "still being determined" (not opened).

So the two sources of the first sitting do not disagree. They speak about different things: NOAA keeps running
HRRR, and Open-Meteo, the app's provider, announces that it will stop serving it. I could not test the feed in
either sitting, because the shared cloud address had used up Open-Meteo's daily limit, and I did not ask
Open-Meteo why.

**Why it matters here.** The app's main weather for the first 48 hours is Open-Meteo's `gfs_hrrr`
(`backend/fire3d/sources/weather.py`: `DETERMINISTIC_MODELS = ("gfs_hrrr", "gfs_seamless")`), and the live
ensemble members are shifted to match it. `ai-weather.md` does not mention this notice. Three consequences:

1. **Live fires after Nov 30.** The code fills hours that HRRR lacks from `gfs_seamless`. What that name will
   return once HRRR is gone (RRFS, GFS or an error), and what the app does when HRRR returns nothing at all, is
   **not verified**. Every score in `docs/validation.md` was measured with HRRR.
2. **Past fires and the accuracy labels.** `regional_accuracy.json` records
   `"weather_source": "open-meteo:historical-forecast:gfs_hrrr"` for its fires. If the HRRR archive is removed,
   the validation cannot be re-run from a clean machine, and the skill gate of section 5.5 would need the weather
   kept on disk. The 15 built bundles in `data/incidents/` already hold their weather, so nothing is lost today;
   they should be backed up before Nov 30.
3. **Three ways forward**, for the next build agent to weigh: (a) switch to Open-Meteo's RRFS and measure the
   change; (b) read HRRR straight from NOAA (NOMADS, or NOAA's open-data buckets), which needs a GRIB reader, a
   new package; (c) both, with HRRR as the reference while it exists. RRFS runs to 84 h four times a day and to
   18 h hourly, at 3 km, and has a separate 1.5 km fire-weather run (from the notice), so (a) may even help.

This needs a decision before December (question 9). It is also the strongest practical argument for the
weather-station scorecard and for the shadow-first rule: with them, the app could show within a week whether the
replacement is better or worse at the stations near its fires.

---

## 10. Questions only you can answer

1. **The Google rule and benchmarks.** Three separate yes-or-no points; my default for each is no, and nothing in
   the first slice needs any of them.
   - (a) May the app, or a one-off research script, download benchmark files that are hosted on Google Cloud or
     Google Drive but made by others (Sen1Floods11, Sim2Real-Fire), or made by Google Research from non-Google
     data (WeatherBench 2)?
   - (b) May the Scorecard quote, with its source, a score that NOAA published about a Google model (the `GDMI`
     row of NHC's verification report, section 2.5) as a reference line for hurricane tracks?
   - (c) If you allow WeatherNext 3 (`ai-weather.md` section 2), may its forecasts be saved in the ledger and
     scored like any other model? Its terms on storing and showing the data are in `ai-weather.md` 2.3; a ledger
     keeps copies on your disk for years, so this needs your yes and a second look at those terms.
2. **Scoring official forecasts.** Are you comfortable with the app showing its own comparison of NWS river
   forecasts and NHC track forecasts with what happened? I recommend yes, in the Scorecard and Command only,
   under a heading that says it is the app's computation, never inside the official record. The alternative is to
   compute them and keep them out of the UI.
3. **Public view.** Should Public show any number at all, or stay with words and "How was it tested?" as today?
4. **Unflattering results.** The reliability chart will probably show that the burn-probability map is too sure
   of itself. Do you want it shown as soon as it exists (my recommendation), or after a calibration fix?
5. **Disk.** Is about 2-4 GB a year on the machine that runs the live loop acceptable, with a 10 GB cap?
6. **Always-on or not.** Will a server run the live loop every day? The ledger only records what is fetched. If
   the app runs only when you open it, the ledger will have gaps, and the back-fills become the main evidence.
7. **Your time as a checker.** Would you spend about 15 minutes per flood on "check a tile"?
8. **First hazard for live scoring.** If only one can be done first: fire (the app's own model) or flood crests
   (larger sample, simpler truth)? I recommend both, since they share the ledger.
9. **HRRR notice (section 9).** Open-Meteo stops serving HRRR on Nov 30; NOAA keeps running it. Which way do you
   want: (a) move to RRFS through Open-Meteo and measure the change, (b) read HRRR straight from NOAA (one new
   package to read its file format), or (c) decide after a short side-by-side test? And do you want the 15 built
   bundles backed up now, since they hold the only local copy of the weather the accuracy labels were made with?
10. **Sharing the scores.** Should the Scorecard's score files be downloadable (CSV with the method text), or
    stay inside the app for now?
11. **Entry rule for new models (section 5.7).** Is "30 scored forecasts on at least 5 events before a model is
    shown outside testing" about right, or do you want AI weather and hurricane tracks visible from day one with
    a "not yet scored" label?

---

## 11. Not verified, or open

Closed in the second sitting (kept here so the change is visible): the USGS high-water mark service (found and
tested, section 3.1); the RAWS column codes and units (NWS SHEF manual, section 3.1); the NWM forecast lengths
(`water.noaa.gov/about/nwm`); the NHC 2025 error numbers (read from the PDF, section 2.5); the HRRR question
(section 9); the IEM terms page (read); NWS local storm reports (tested through IEM); GOFER's licence (CC BY 4.0
on Zenodo).

Still open:

- **USGS high-water marks.** The service's own terms page and field dictionary were not read; I inferred the
  field meanings from their names (`height_above_ground`, `elev_ft`, `hwm_quality`, `vdatum`). The unit of
  `height_above_ground` is taken to be feet. How soon after an event marks appear was not measured. None of
  the app's 8 built floods has an STN event, so no comparison was tried.
- **RAWS in the IEM archive.** One station and two hours tested. The codes are confirmed by the SHEF manual, but
  the file carries no units and the manual allows metric values, so one cross-check against the NWS API is still
  needed. The manual gives the peak wind direction code `UR` "in tens of degrees", while the value I saw (22,
  next to a mean direction of 21) looks like whole degrees. Coverage of all RAWS is not verified.
- **RAWS wind height.** 20 feet and a 10-minute average come from search results of NWCG pages; the standard
  itself (PMS 426-3) was not opened, and I found no official factor to convert to 10 m.
- **Open-Meteo.** Previous Runs and Single Runs: documentation read; both hosts answered "Daily API request
  limit exceeded" from this shared address in both sittings, so no data was seen. Whether the HRRR archive
  (listed "since 2018-01-01") stays after 2026-11-30, why Open-Meteo drops HRRR, and what `gfs_seamless` returns
  afterwards are not stated on the pages I read.
- **NWM.** The AWS registry page for the operational bucket was not read (the retrospective page was). I
  measured the folder dates and one file size only. The NWM page gives two different member counts for the
  long-range forecast (4 and 16).
- **URMA.** Only folder names were listed. Grid size, variables, latency and file sizes are from memory.
- **Dataset licences not found:** Sim2Real-Fire (data), Sen1Floods11 (none in the repository), TCBench (data),
  FIMbench / FIMeval. Sen1Floods11's counts and its list of floods were not on the page I read.
- **Extreme Weather Bench**: where its truth data is hosted was not on the page (it may be a Google bucket).
- **NASA FEDS**: the terms page of the openveda service was not read; the NASA dashboard page for the dataset
  answered 403 in the second sitting; the paper behind it is cited from memory (Chen et al., 2022). An ArcGIS
  copy of the same layers on `gis.earthdata.nasa.gov/image/…` answered 404 in the first sitting.
- **NWS River Forecast Center verification**: no current public table found in two searches; that is an absence
  of evidence, not proof that none exists. The two regional studies are cited from search results.
- **NOAA EMC verification pages**: front page only; I did not open the RRFS or HRRR sections.
- **Live fuel moisture samples (FEMS)**: from a search result; not opened.
- **Not checked at all today:** MTBS, Copernicus flood products, NOAA's aerial photos, the NWS disclaimer page
  (taken from the README), NOAA OWP's flood map evaluation and FIMbench beyond search results.
- **Sizes in section 6.2** for compressed fire layers are estimates; no ledger file was written.
- **The "vs simple guess" numbers** in the Scorecard sketch are placeholders.
- **First-sitting items I did not repeat:** the IEM `hml.py?help` text (archive since 2012, one UTC year per
  request), the WeatherReal and PyPI pages, the NWM file size, the FEDS archive years, and the Single Runs
  start date. They stand as the first sitting recorded them.

---

## 12. Evidence log (2026-11-10)

### 12.1 First sitting (about 17:35-18:10 UTC)

Repository (read only):

| Checked | Result |
|---|---|
| `backend/fire3d/api/live.py` | `KEEP_LIVE_FORECASTS = 4`, `PRUNE_MIN_AGE_H = 6.0`, forecast when the newest is older than 3 h or the area changed by 2 %, loop every 15 min |
| `backend/fire3d/data/regional_accuracy.json` | 10 regions: 6 tested, Southern California tested in-sample, 3 untested; metric `growth_sorensen`, `min_fires` 2, `min_leads` 16 |
| `backend/fire3d/spread/ensemble.py` | forecast layers are float32, `width` up to 512: `arrival_p10/p50/p90`, `burn_probability` |
| `data/floods/flood-20261104-calcasieu-river-…/` | `gauges.json` 14 gauges; LCHL1 forecast 20 rows, issued by LMRFC; `model/nwm_series_LCHL1.json` 3,247 bytes; `maps/rfc_fim.geojson` 108,631 bytes; bundle 21 MB |
| `data/` | incidents 389 MB (15 built fires, 1 live, 3 fixtures), floods 155 MB |
| `backend/tests/test_floods_terrain3d.py` | depth and HAND tested on synthetic shapes only |

Requests (User-Agent `Disaster Mapping research prototype`):

| Host | Request | Answer |
|---|---|---|
| api.weather.gov | `/points/34.2,-118.13` | 200; stations list at `/gridpoints/LOX/160,51/stations` |
| api.weather.gov | that stations list | 200; 64 stations; providers RAWS, ASOS-HFM, MesoWest |
| api.weather.gov | `/stations/CHOC1/observations?limit=3` | 200; hourly; 16:53 UTC reading as in section 3.1 |
| api.weather.gov | same, Oct 1-20 | 0 readings |
| api.weather.gov | same, Oct 28 - Nov 6 | 48 readings; oldest 2026-11-03T17:53Z (7 days before the request) |
| api.weather.gov | stations with `?limit=25` | 400, "limit is not recognized" (my mistake; noted so nobody repeats it) |
| mesonet.agron.iastate.edu | `asos.py`, station BUR, 2025-01-08 08-11 UTC | 200; 3 rows |
| mesonet.agron.iastate.edu | `/geojson/network/CA_RAWS.geojson` | 200; 0 stations (no such network name) |
| mesonet.agron.iastate.edu | `/api/1/station/CHOC1.json` | 200; network `CA_DCP`, archive begins 2010-12-07 |
| mesonet.agron.iastate.edu | `hads.py`, CA_DCP, CHOC1, 2025-01-08 08-10 UTC | 200; 2 rows, 11 columns |
| mesonet.agron.iastate.edu | `hads.py?help` | 200; no documentation text found in the answer |
| mesonet.agron.iastate.edu | `hml.py?help` | 200; "you can only request forecast data within a single UTC year"; archive from 2012-01-01 |
| mesonet.agron.iastate.edu | `hml.py`, LCHL1, forecasts, Nov 1-8, 2026 | 200; 160 rows; 8 issue times |
| noaa-nwm-pds.s3.amazonaws.com | bucket listing | first folder `nwm.20250101/`, last `nwm.20261110/` |
| noaa-nwm-pds.s3.amazonaws.com | `nwm.20250301/` | 60+ product folders incl. `short_range/`, `medium_range_mem1-6/` |
| noaa-nwm-pds.s3.amazonaws.com | one `short_range.channel_rt` file | 14,141,462 bytes |
| noaa-nwm-retrospective-3-0-pds | bucket listing | folders Alaska, CONUS, Hawaii, PR |
| openveda.cloud | `/api/features/collections` | 200; 12 collections, 9 of them fire |
| openveda.cloud | `…perimeter_nrt/items?limit=2&sortby=-t` | 99,936 records; newest `t` 2026-11-10T00:00, regions CONUS and BorealNA |
| openveda.cloud | `…perimeter_archive`, newest and oldest | 123,324 records; 2018-01-02 to 2021-12-31 |
| openveda.cloud | archive, Eaton area, Jan 2025 | 0 records (outside the archive's years) |
| gis.earthdata.nasa.gov | `/image/rest/services/FireTracking/…` (3 tries) | 404 |
| stn.wim.usgs.gov | `/STNServices/Events.json` | 301 to `https://apps.usgs.gov/stnweb` |
| apps.usgs.gov | `/stnservices/Events.json` | 404 |
| www.nhc.noaa.gov | HEAD of `…/errors/1989-present_OFCL_v_BCD5_ind_ATL_TI_errors.txt.zip` | 200; 440,502 bytes; last modified 2026-07-08 |
| zenodo.org | `/api/records/8006177` and `/14017092` (and two unrelated records that a search had suggested) | CC BY 4.0, open; 48.36 GB and 21.55 GB |
| previous-runs-api.open-meteo.com, single-runs-api.open-meteo.com | one request each | "Daily API request limit exceeded" |

No request used a key. No file was written outside this document and the session's scratch folder.

### 12.2 Second sitting (about 22:15-22:40 UTC)

Repository (read only):

| Checked | Result |
|---|---|
| `backend/fire3d/data/regional_accuracy.json` | re-read: Southern California 0.433 (3 fires, 32 leads, in-sample, growth ratio 1.85); Southwest 0.351; Southern Plains 0.394; Northern Rockies 0.341; Northwest 0.255; Great Basin 0.247; Southeast 0.193; Rocky Mountain, Eastern and Northern California untested; 188 scored leads in all |
| `backend/fire3d/api/live.py`, `floods/copy.py`, `spread/ensemble.py`, `spread/validate.py` | `KEEP_LIVE_FORECASTS = 4`, `PRUNE_MIN_AGE_H = 6.0`; `PAST_NO_FORECAST = "River forecasts are not kept for past dates."`; forecast layers `float32`; `skill_from_arrays` scores the median (p50) map only, as total and growth Sørensen and acres per lead: burn probability and the p10 / p90 maps are never scored |
| `data/incidents/<15 built fires>/` | each has `sim/static.npz`, `sim/weather.npz`, `weather.json`, `layers/observed_arrival.bin`; **no `forecasts/` folder** and `"forecasts": []` in the manifest (only the 3 fixtures have one). This corrects the first sitting, which assumed stored forecasts |
| `data/incidents/2025-eaton-fire-dbfa57/manifest.json` | fire grid 512 x 512 at 44.9 m |
| `backend/fire3d/sources/weather.py` | `DETERMINISTIC_MODELS = ("gfs_hrrr", "gfs_seamless")` (primary, fill) |
| `backend/pyproject.toml` | no GRIB or Zarr reader among the dependencies |
| `docs/validation.md` 6.2, 6.4, 6.5, 7, 10.8, 10.10 | the numbers quoted in section 1 match |

Requests (User-Agent `Disaster Mapping research prototype`; WebFetch where marked):

| Host | Request | Answer |
|---|---|---|
| open-meteo.com (WebFetch) | `/en/docs/gfs-api`, `/en/docs/historical-forecast-api`, `/en/docs/previous-runs-api` | the HRRR and NAM discontinuation text and labels of section 9; HRRR archive "since 2018-01-01"; Previous Runs "Most models are archived from January 2024" |
| previous-runs-api.open-meteo.com | one request (Altadena, 2025-01-08) | "Daily API request limit exceeded" |
| www.weather.gov | SCN 26-48, update of 2026-10-15 (PDF, text extracted) | RRFS and REFS effective 2026-11-03; "will replace NAM, HREF, SREF, and HiresW"; HRRR feeds two members of the new ensemble |
| nomads.ncep.noaa.gov | listings of `…/com/hrrr/prod/` and `…/com/rrfs/prod/` (HTTP/1.1; three HTTP/2 tries failed on a malformed header) | newest folders `hrrr.20261110` and `rrfs.20261110` at 22:16 UTC |
| www.nhc.noaa.gov | `verification/verify7.shtml` (WebFetch); HEAD of the Atlantic 1989-2025 zip; `aboutcone.shtml` (WebFetch); `Verification_2025.pdf` (22.8 MB, text extracted) | page "Updated 08 July 2026", six files; 440,502 bytes, last modified 2026-07-08; 2026 cone radii; tables 1-3 as in section 2.5 |
| stn.wim.usgs.gov | `Events.json`, `HWMs/FilteredHWMs.json?Event=312`, the documentation page, `STNDataPortal` | all 301 to `apps.usgs.gov/stnweb` |
| apps.usgs.gov | `/stnweb` and its main script | the script names `https://api.waterdata.usgs.gov/stnservices/` as its data service (and holds a key, which I did not use or record) |
| api.waterdata.usgs.gov | `/stnservices/Events.json` | 404 (old path style) |
| api.waterdata.usgs.gov | `/stnservices/events/` | 200, no key; 334 events, 1888 to 2026; header `x-ratelimit-limit: 3000` |
| api.waterdata.usgs.gov | `/stnservices/hwms/?event=346` (Helene) | 200; 321 marks; 307 with `height_above_ground`, 276 with `elev_ft`, 265 approved |
| api.waterdata.usgs.gov | `/stnservices/hwmqualities/` | six grades, "Excellent: +/- 0.05 ft" to "VP: > 0.40 ft" and "Unknown/Historical" |
| mesonet.agron.iastate.edu | `hml.py`, LCHL1 forecasts, Nov 1-8 (repeat) | 200; 160 rows; 8 issue times (same as the first sitting) |
| mesonet.agron.iastate.edu | `hads.py`, CA_DCP, CHOC1, 2025-01-08 08-10 UTC (repeat) | 200; 2 rows; wind 52 and 51, peak 75, humidity 37, temperature 34, fuel moisture 8.0 |
| mesonet.agron.iastate.edu | `/geojson/lsr.geojson`, office EWX, 2025-07-04 | 200; 8 reports, all "FLASH FLOOD" |
| mesonet.agron.iastate.edu (WebFetch) | `/disclaimer.php` | public domain; attribution "would be appreciated" |
| www.weather.gov | SHEF Code Manual, 5 July 2012 (PDF, text extracted) | the element codes and units of section 3.1 |
| api.weather.gov | `/stations/CHOC1/observations`, Oct 28 - Nov 10 (repeat) | 142 readings; oldest 2026-11-03T22:53Z; wind unit `wmoUnit:km_h-1` |
| noaa-nwm-pds.s3.amazonaws.com | bucket listing (repeat) | `nwm.20250101/` to `nwm.20261110/` |
| noaa-urma-pds.s3.amazonaws.com | three listings | `urma2p5.20140128/` to `urma2p5.20261110/` |
| openveda.cloud | FEDS live perimeters, newest (repeat) | 99,936 records; newest 2026-11-10T00:00 |
| zenodo.org | `/api/records/8006177`, `/14017092`, `/14642378` | CC BY 4.0, open: 48.37 GB, 21.55 GB, 0.08 GB (GOFER, version 0.2) |
| water.noaa.gov (WebFetch) | `/about/nwm` | NWM v3.0 configurations and forecast lengths |
| github.com (WebFetch) | Sen1Floods11, weatherbenchX, ExtremeWeatherBench, Sim2Real-Fire | as in section 4 |
| arxiv.org (WebFetch) | 2609.22191, 2601.23268, 2605.01126 | titles, authors, dates and abstracts as in section 4 |
| weatherbench2.readthedocs.io, synopticdata.com, www.emc.ncep.noaa.gov (WebFetch) | one page each | as in sections 3.3 and 4 |
| www.earthdata.nasa.gov (WebFetch) | the FEDS dataset page | 403 |

No request used a key. Downloads (three PDFs, one web-app script, small JSON and CSV answers) went to the
session's scratch folder only and are not in the repository.

---

## 13. Sources (read 2026-11-10 in one or both sittings)

Official and project pages:

- NHC forecast verification: https://www.nhc.noaa.gov/verification/ (updated 08 July 2026);
  error database https://www.nhc.noaa.gov/verification/verify7.shtml; cone https://www.nhc.noaa.gov/aboutcone.shtml;
  2025 report https://www.nhc.noaa.gov/verification/pdfs/Verification_2025.pdf (dated 30 March 2026; downloaded
  and read in the second sitting)
- IEM river forecast archive: https://mesonet.agron.iastate.edu/request/hml.php and
  https://mesonet.agron.iastate.edu/cgi-bin/request/hml.py?help; IEM terms:
  https://mesonet.agron.iastate.edu/disclaimer.php
- NWS API: https://api.weather.gov/ (requests above)
- NWS SHEF Code Manual (5 July 2012): https://www.weather.gov/media/mdl/SHEF_CodeManual_5July2012.pdf
- NOAA National Water Model: https://water.noaa.gov/about/nwm; on AWS: https://registry.opendata.aws/nwm-archive/
  and the bucket listings above
- NASA VEDA features API: https://openveda.cloud/api/features/collections
- USGS Flood Event Viewer: https://www.usgs.gov/mission-areas/water-resources/science/usgs-flood-event-viewer-providing-hurricane-and-flood
  and https://apps.usgs.gov/fev/; STN web app https://apps.usgs.gov/stnweb; STN data service
  https://api.waterdata.usgs.gov/stnservices/
- Synoptic Open Access: https://synopticdata.com/pricing/open-access-pricing/
- Open-Meteo: https://open-meteo.com/en/docs/previous-runs-api, https://open-meteo.com/en/docs/single-runs-api,
  https://open-meteo.com/en/docs/gfs-api, https://open-meteo.com/en/docs/historical-forecast-api
- NWS Service Change Notice 26-48 (update of 2026-10-15):
  https://www.weather.gov/media/notification/pdf_2026/scn26-048_Updated_RRFS_and_REFS_Implementation.aaf.pdf;
  NOAA servers: https://nomads.ncep.noaa.gov/pub/data/nccf/com/hrrr/prod/ and `…/com/rrfs/prod/`
- NOAA EMC verification: https://www.emc.ncep.noaa.gov/users/verification/
- NOAA URMA on AWS: https://noaa-urma-pds.s3.amazonaws.com/ (listing only)
- RAWS standards (search results only): https://raws.nifc.gov/sites/default/files/inline-files/pms426-3.pdf
- FEMS and the fuel moisture samples (search result only): https://famit.nwcg.gov/node/3473

Benchmarks and datasets:

- WildfireSpreadTS: https://zenodo.org/records/8006177 (doi:10.5281/zenodo.8006177)
- WildfireSpreadBench: https://arxiv.org/abs/2609.22191
- Sim2Real-Fire: https://github.com/TJU-IDVLab/Sim2Real-Fire
- FloodCastBench: https://zenodo.org/records/14017092; paper doi:10.1038/s41597-025-04725-2
- Sen1Floods11: https://github.com/cloudtostreet/Sen1Floods11
- WeatherBench 2: https://weatherbench2.readthedocs.io/en/latest/data-guide.html;
  WeatherBench-X: https://github.com/google-research/weatherbenchX
- Extreme Weather Bench: https://github.com/brightbandtech/ExtremeWeatherBench; https://pypi.org/project/extremeweatherbench/
- WeatherReal: https://github.com/microsoft/WeatherReal-Benchmark
- TCBench: https://arxiv.org/abs/2601.23268
- GOFER: https://zenodo.org/records/14642378; paper doi:10.5194/essd-16-1395-2024
- NOAA OWP flood map evaluation and FIMbench (search results only):
  https://ciroh.ua.edu/abstracts/fimbench-a-benchmark-database-of-multi-tier-flood-inundation-maps-for-large-scale-evaluation/
- NWS river forecast verification (older documents, search results only):
  https://www.weather.gov/media/owp/oh/hrl/docs/NWSVerif.pdf;
  https://www.weather.gov/media/owp/oh/rfcdev/docs/Final_Verification_Report.pdf (2006 plan);
  https://repository.library.noaa.gov/view/noaa/63660 (Iowa stage forecast errors, 1999-2014)
- Extreme Weather Bench paper: https://arxiv.org/abs/2605.01126
- NWS webinar notes on RRFS (search result only):
  https://www.weather.gov/media/wrn/calendar/RRFS_REF-Webinar%26RegistrationFormQANotes.pdf

In this repository: `docs/validation.md`, `docs/redesign/audit-7/ai-weather.md`,
`docs/redesign/audit-7/hurricanes.md`, `docs/redesign/audit-7/ai-mapping-llm.md`,
`docs/redesign/reports/brief3-validation.json`, `docs/redesign/reports/final-verification-5.json` and `-6.json`,
`README.md` (credits table), `backend/fire3d/spread/validate.py`, `backend/fire3d/spread/ensemble.py`,
`backend/fire3d/api/live.py`, `backend/fire3d/sources/weather.py`, `backend/fire3d/data/regional_accuracy.json`,
`web/src/ui/RegionAccuracy.tsx`, `web/src/state/accuracy.ts`.
