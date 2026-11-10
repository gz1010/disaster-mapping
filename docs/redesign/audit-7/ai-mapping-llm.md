# Audit 7: AI beyond weather: satellite mapping, hazard AI models and language models (brief 7 planning)

Role: research for brief 7, topic "AI mapping and language models". **Documents only**: no app code changed, no bundle
built, no server started, no secret read or used. Checked **2026-11-10, about 16:45-17:50 UTC** from the cloud session:
official pages read with WebFetch / WebSearch, plus about 36 small GETs with curl (one at a time, User-Agent
`Disaster Mapping research prototype`). The evidence log is section 7. Anything I could not check on an official page
is marked **not verified**. Compute times are estimates, not measurements: nothing was run on a Mac.

**Three decisions this file cannot make for you.**

1. **Google.** `CLAUDE.md` says "No Google data, no paid map services, no Nominatim". Google Flood Hub and its API,
   FireBench, the "Next Day Wildfire Spread" dataset and AlphaEarth are Google products. They are described here so
   you can decide; none is in a recommendation. (WeatherNext itself is covered in `ai-weather.md`.)
2. **A third secret.** `CLAUDE.md` says the only secrets are `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`. Any language-model
   feature that runs while the app runs needs an `ANTHROPIC_API_KEY`. AirNow air-quality sensors need an AirNow key.
   Each needs your approval, as `EARTHDATA_TOKEN` did in brief 5.
3. **A large new dependency.** Running any AI model on the backend means PyTorch (about 2 GB installed). The rule is
   "add a dependency only when it is clearly needed, and say why". Section 1.11 says how to keep it out of the main app.

Everything in the "first step" (section 4) works **without** any of these three.

## 0. Short answer

1. **The best fix for "clouds hide the water" is not an AI model. It is NASA's radar water map, and the app can show
   it today without a login.** NASA publishes its radar water product (OPERA DSWx-S1, from the Sentinel-1 radar
   satellites) as public map tiles on NASA GIBS. I fetched one over south-west Louisiana for Oct 31: the tile's
   colour numbers are the product's own classes (not water, open water, flooded vegetation, radar shadow). The app
   already has the layer's name in its code but does not use it; its on-screen text says radar "needs the login".
2. **The famous NASA/IBM flood model (Prithvi) reads optical images, not radar.** Its published flood weights take six
   Sentinel-2 colour bands. Clouds hide the ground from it exactly as they do today. A newer IBM/ESA model
   (TerraMind-base-Flood) and a Microsoft model (ai4g-flood) do read radar. They are open (Apache-2.0, MIT), but they
   need raw radar images, which need an account, and PyTorch.
3. **For hazards, the free official products beat the open AI models for now.** NOAA already runs smoke forecasts
   (HRRR-Smoke: I downloaded and read one field), flash-flood products (MRMS FLASH) and AI fire detection from GOES
   (NGFS, still a beta site). Wildfire-FM is real and MIT-licensed, but it predicts on 5 km squares, in California
   only, and its authors present it as a reference model for a paper, not as a product.
4. **Language models: three features are worth it, and only behind a switch that is off by default.** (a) A glossary
   written once and checked by a person (no AI runs in the app). (b) "Explain this view": a few sentences built only
   from the facts on screen, each sentence tied to its facts. (c) A daily digest for Command. Each costs from a
   fraction of a cent to a few cents. Avoid a chat box in Public, anything that answers "should I leave?", and
   summaries or translations that take the place of official text.
5. **Recommended first step (about 6 agent-hours, no rule change):** radar water without a login, plus the static
   glossary. **Next (about 5 hours):** a smoke layer. **Stretch:** the language-model features (needs your approval
   of one new secret), or running a radar flood model yourself on the Mac.

## Words used here (plain)

- **Optical image**: a picture made from sunlight, like a camera (Landsat, Sentinel-2). Clouds, smoke and night block it.
- **Radar (SAR)**: the satellite sends its own radio pulses and listens for the echo (Sentinel-1). It works through
  clouds and at night. Calm open water looks dark because it reflects the pulse away. Water under trees or between
  buildings is hard to see, and so are steep slopes ("layover" and "shadow").
- **Segmentation model**: an AI model that labels every pixel of an image (water / not water, burned / not burned).
- **Foundation model**: a large model trained once on huge amounts of unlabelled images, then "fine-tuned" (trained a
  little more) on a small labelled set for one job. Prithvi and TerraMind are foundation models.
- **Weights / checkpoint**: the learned numbers of a model, as a file. With the weights, the code and PyTorch you can
  run the model yourself.
- **IoU ("intersection over union")**: a score from 0 to 100 for a pixel map. Of all pixels that either the model or
  the truth calls water, what share do both call water? 100 is a perfect match. **mIoU** averages over the classes.
- **Language model (LLM)**: an AI model that reads and writes text. Claude is one. **Token**: a piece of a word; the
  API bills per million tokens read and written.
- **Grounded**: the model may only use the facts it is handed, and each sentence must point to them.

## 1. Satellite mapping: what could map water, burns, damage and smoke

### 1.0 The problem, in the app's own numbers

From `docs/redesign/reports/final-verification-6.json` (known issues): on real floods "the grey 'no satellite view'
hatching covers much of the 3D view (St. Johns River passes are 53 to 97 % hidden by clouds or missing data)"; a
Calcasieu River pass had "no view of 61% of the area"; NASA lists a pass days late; and "the radar route (DSWx-S1,
EARTHDATA_TOKEN) is tested offline only; no token was set here".

What the app does today (`backend/fire3d/sources/opera.py`, `backend/fire3d/floods/satellite.py`):

| Route | Product | Login | Sees through clouds | State |
|---|---|---|---|---|
| NASA Earthdata GIS image service | DSWx-HLS (optical, 30 m), measured classes | none | no | default route |
| PO.DAAC files | DSWx-S1 (radar, 30 m) and newest DSWx-HLS | `EARTHDATA_TOKEN` | yes (S1) | built, tested offline only |
| NASA GIBS tiles | DSWx-HLS picture | none | no | fallback |
| NASA GIBS tiles | DSWx-S1 picture | none | **yes** | **name in the code (`GIBS_S1_LAYER`), not used** |

Measured today for the Calcasieu area (NASA CMR, no login): the newest radar water map was taken Oct 31 12:22 UTC by
Sentinel-1D and listed Nov 3 15:38 UTC (3.1 days later). The two newest optical water maps were taken Nov 1 and Nov 2
and listed Nov 6 and Nov 8 (4.4 and 5.8 days later). So today radar was both cloud-proof and quicker.

### 1.1 Radar water map without a login: NASA GIBS DSWx-S1 tiles. Verdict: **use**

- **What it is:** NASA JPL's OPERA "Dynamic Surface Water Extent from Sentinel-1" (DSWx-S1), drawn as daily map tiles
  by NASA GIBS. It is a rule-based product (thresholds on the radar echo plus terrain checks), **not an AI model**.
- **Who runs it:** NASA JPL (OPERA project), files at PO.DAAC, tiles by NASA GIBS (ESDIS).
- **Access:** WMTS layer `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1` on
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/`, tile set `GoogleMapsCompatible_Level12` (zoom 12 is about
  30 m per pixel at 38 degrees north). No account, no key, no cost.
- **Tested:** tile `2026-10-31 / 10 / 421 / 246` answered 200, a 256 x 256 PNG with a colour table. The colour
  numbers found were 0 (not water, 63,270 pixels), 1 (open water, 1,782), 3 (flooded vegetation, 483), 251 (radar
  layover / shadow, 1); 255 is transparent (no data). These are the DSWx-S1 class values, so the classes can be read
  from the public tile exactly, not guessed from colours.
- **Time:** one picture per day; dates listed from 2023-12-15; newest date today 2026-11-05 (5 days before today for
  the whole layer). The exact time of each pass comes from NASA CMR, which answers without a login (tested).
- **Resolution:** 30 m product. **Revisit:** a given place is seen every few days (the granule I listed was from
  Sentinel-1D; Sentinel-1A and 1C also fly, not re-checked today). **History for back-testing:** December 2023 onward.
- **Licence / credit:** NASA open data, no restriction on use; the app's existing line fits: "NASA JPL OPERA DSWx-S1
  (PO.DAAC) via NASA GIBS; contains modified Copernicus Sentinel data".
- **Limits:** a daily picture can join two passes of the same day; flooded vegetation is a separate class that the
  optical product does not have; radar misses water under dense trees and in streets between buildings; it can call
  smooth dry ground (sand, tarmac, ploughed fields) water; steep terrain is masked.
- **Honest label:** "Water seen by radar satellite (NASA OPERA), {date, time}. It includes the river's normal water.
  Trees, buildings, steep slopes and the days between passes hide water: dry pixels do not mean no flooding." (This is
  the existing `SAT_CAVEAT_RADAR` text.) Add "(NASA's public picture of this pass)" for this route.

**What this means for the app.** Radar passes can join the flood time steps for everyone, with no token. On cloudy
floods the grey hatching would shrink on the days a radar pass exists. The sentence `SAT_NOT_SET_UP` ("Radar images
that see through clouds need the login") would be corrected. The estimated-depth surface (FwDET) needs class values on
the flood grid; the tiles give them at zoom 12. **Effort: 3-4 agent-hours** (backend: read the S1 tiles onto the
grid, pass times from CMR, pass list and timeline; web: label and legend entry for flooded vegetation; one review).

### 1.2 Radar water as measured files: DSWx-S1 with `EARTHDATA_TOKEN`. Verdict: **use** (already built)

Same product as 1.1, as the original GeoTIFF from PO.DAAC. It needs the free NASA Earthdata login that brief 5
approved. The code exists and passed offline tests; nobody has run it with a real token. I checked that NASA's
no-login image service has **no** DSWx-S1 folder (`C2949811996-POCLOUD`: "Folder not found"), so the token route is the
only way to the original files. **What this means for the app:** if you set the token on your Mac, one live test run
(about 1 agent-hour with you present) would finish brief 5's radar route. With 1.1 in place the token becomes a
quality upgrade, not a requirement.

### 1.3 Same-day, wide-area water: NASA LANCE MODIS / VIIRS flood maps. Verdict: **use with care**

- **What it is:** NASA's near-real-time global flood product: water found in MODIS (Terra, Aqua) and VIIRS (NOAA-20,
  NOAA-21) optical images, compared with normal water, as 1-day, 2-day and 3-day composites. Joining two or three
  days lets gaps between clouds add up. Not AI.
- **Access:** GIBS layers `MODIS_Combined_Flood_1-Day / 2-Day / 3-Day` and `VIIRS_Combined_Flood_1-Day / 2-Day /
  3-Day`, 250 m tile set, PNG. No account. Newest date today: **2026-11-10 (same day)**. MODIS layers go back to
  2021, VIIRS to June 2025. One VIIRS tile tested (200; it was all "no data / cloud" grey for that tile and day).
- **Limits (NASA's own notes):** the 1-day product "can be contaminated with cloud-shadow false-positives"; terrain
  shadow is filtered in mountains; pixels are 250 m (VIIRS is 375 m, resampled), so narrow rivers and streets are
  invisible. Terra and Aqua are near the end of their lives (not re-checked today); prefer the VIIRS layers.
- **Credit:** "NASA LANCE MODIS / VIIRS NRT Global Flood Product, via NASA GIBS" (exact acknowledgement text on the
  product page: **not verified** today).
- **Honest label:** "Possible flood water seen from space over the last 2 days (NASA, 250 m squares). Coarse: it
  cannot see small streams or streets. Cloud shadows can look like water. Grey means no clear view."

**What this means for the app.** A wide "where is water standing today" layer for the Floods overview and Command,
on the same day, while the sharp 30 m maps arrive 3 to 6 days later. It must never be drawn as the flood's edge.
**Effort: 2-3 agent-hours.**

### 1.4 Copernicus Global Flood Monitoring (GFM). Verdict: **use with care** (terms page not read)

- **What it is:** the European Commission's automatic flood maps from every Sentinel-1 radar image, worldwide (20 m
  grid, from earlier knowledge): three independent algorithms vote on each pixel, with "reference water",
  "exclusion mask" and "likelihood" layers. Automatic, but not a deep-learning model as far as I know. Run for the Copernicus Emergency Management Service (CEMS) by a consortium (EODC, TU Wien, DLR,
  LIST and others).
- **Access:** a time-enabled WMS ("WMS-T freely accessible"), a download portal, an API at `api.gfm.eodc.eu/v2`
  ("for expert users") and a STAC catalogue. **Not verified:** whether the WMS or API needs registration.
- **Latency:** target "within 8 hours" of the radar pass (CEMS slides, 2025 and 2026). That would be days quicker
  than NASA's listing lag measured today.
- **Licence:** CEMS decks cite CC BY 4.0. I did not read a licence page, so treat as **not verified**. Credit line
  would be of the form "Copernicus Emergency Management Service (GFM), CC BY 4.0".
- **Honest label:** "Flood water mapped automatically from radar (Copernicus GFM, experimental in this app)."

**What this means for the app.** The quickest cloud-proof flood map I found. Worth a stretch task once someone reads
the terms page and tests one request. **Effort: 3-4 agent-hours** after that check.

### 1.5 NASA / IBM Prithvi-EO-2.0 flood model. Verdict: **use with care, low priority** (it is optical)

- **What it is:** `ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11` on Hugging Face: the Prithvi-EO-2.0
  foundation model (300 million parameters) fine-tuned to mark water.
- **Weights:** one file, 1.28 GB, not gated (no login), last changed 2026-08-25. **Licence: Apache-2.0** (model card
  and Hub API, checked today).
- **Input:** six bands (Blue, Green, Red, Narrow NIR, SWIR, SWIR 2) of **Sentinel-2 L1C** images, 512 x 512 chips.
  Despite "Sen1" in the dataset's name, the published weights do **not** read radar.
- **Training data:** Sen1Floods11: 446 hand-labelled chips from 11 flood events on 6 continents.
- **Accuracy by its authors:** the card gives no number. The paper (arXiv 2412.02732) reports mIoU 90.0 and water
  IoU 82.6 on the Sen1Floods11 test set (read through a search summary, not the paper itself).
- **Data it needs:** Sentinel-2 images. The app already reads public Sentinel-2 files without a login
  (`sources/sentinel.py`), but as L2A, not L1C: a difference the model was not trained on.
- **Compute (estimate):** a 40 x 40 km flood at 10 m is about 64 chips: minutes on a CPU, well under a minute on an
  Apple GPU.

**What this means for the app.** It cannot solve the cloud problem. Its one real use: on a clear day, make an
"AI-mapped water" layer from the newest Sentinel-2 image days before NASA's own optical water map is listed (4 to 6
days today), at 10 m instead of 30 m. That is a nice-to-have with a 2 GB dependency. **Effort: 6-8 agent-hours**
including a comparison against DSWx-HLS on past floods.

### 1.6 IBM / ESA TerraMind-base-Flood (radar + optical + terrain). Verdict: **use with care** (too new to trust)

- **What it is:** `ibm-esa-geospatial/TerraMind-base-Flood`, fine-tuned from TerraMind-1.0-base on the
  "ImpactMesh-Flood" dataset. A sister model, `TerraMind-base-Fire`, exists (the card does not say whether it maps
  burn scars or active fire).
- **Licence:** Apache-2.0 (Hub API, checked today). Not gated.
- **Input:** Sentinel-2 L2A (12 bands) **and Sentinel-1 RTC radar (2 bands)** and a terrain height layer, as 4 time
  steps of 256 x 256 chips. Whether it runs with radar alone on a cloudy day is **not stated**.
- **Accuracy:** **none published** on the card; the technical report is "coming soon". Run through TerraTorch 1.2.1.
- **Data it needs:** Sentinel-1 radar images corrected for terrain (RTC). I found no login-free source: NASA's OPERA
  RTC-S1 files are at the Alaska Satellite Facility behind the Earthdata login (a different host from the one the
  app's token is allowed to go to); Copernicus Data Space needs its own free account; Microsoft Planetary Computer's
  page did not load for me (**not verified**).

**What this means for the app.** This is the model family that could one day give "AI-mapped water through clouds"
on your own machine. Today it has no published accuracy, needs an account for radar data and TerraTorch on top of
PyTorch. Watch it; do not build on it yet.

### 1.7 Microsoft ai4g-flood (radar change detection). Verdict: **use with care**

- **What it is:** Microsoft AI for Good Lab's flood model from the paper "Mapping global floods with 10 years of
  satellite radar data" (Nature Communications, 2025). It compares a radar image **before** and **after** the event
  (VV and VH channels).
- **Licence:** MIT (repository label). Weights are in the repository (`models/ai4g_sar_model.ckpt`).
- **Data it needs:** Sentinel-1 RTC from Microsoft Planetary Computer, or other sources "only if similar
  preprocessing is applied". Account need: **not verified**.
- **Limits by its authors:** "may produce false positives in permanent water bodies" (you must mask normal water
  yourself); the paper's method needs an 80 m buffer; accuracy numbers are in the paper, not on the page.

**What this means for the app.** The simplest radar AI model to run yourself, and "before vs after" is easy to
explain. It still needs raw radar data and PyTorch. It is the model I would try first in the stretch step (4.3).

### 1.8 Burn severity and burned area

| Item | What it is | Licence / access | Verdict |
|---|---|---|---|
| The app's own dNBR | Burn severity from Sentinel-2 before / after (already built, `sources/sentinel.py`) | public data | keep |
| `Prithvi-EO-2.0-300M-BurnScars` | AI burned-area map from one HLS image (six bands, 512 px chips). Trained on about 800 chips in the lower 48. Authors' test score: burned IoU 87.52, mIoU 93.00 | Apache-2.0, 1.30 GB, not gated | use with care: optical, so smoke and cloud block it; a second opinion beside dNBR, not a replacement |
| OPERA DIST-ALERT-HLS | NASA's "vegetation disturbance" alerts (any loss of green: fire, logging, storm), 30 m | GIBS layer `OPERA_L3_DIST-ALERT-HLS_Color_Index`, no login, newest date 2026-11-04 | use with care: it does not say the cause is fire |
| BAER soil burn severity, RAVG | Official post-fire maps by USGS / US Forest Service teams, days to weeks after a fire | Burn Severity Portal (`burnseverity.cr.usgs.gov`), public | use for past fires, as official with issuer and date |
| MTBS | The official long-term burn severity record | public, published long after the fire (**delay not verified**) | use for past years only |

**What this means for the app.** The app's dNBR already covers the need. The better addition is official: show the
BAER / RAVG map for a past fire in Forensic next to the app's dNBR and report how well they agree (a validation
idea, section 5). **Effort: 3-4 agent-hours.** The Prithvi burn model adds little for its cost.

### 1.9 Building damage (xBD / xView2). Verdict: **do not use**

- **xBD** is the training set behind the xView2 challenge: before / after Maxar satellite photos at well under 1 m
  per pixel with 850,736 building outlines and four damage grades. Secondary sources give its licence as
  **CC BY-NC-SA 4.0** (non-commercial, share-alike); `xview2.org` did not load for me (**not verified** on the
  official page). Models trained on it inherit a non-commercial question.
- **The real blocker is the input.** These models need sub-metre images taken days after the disaster. Free Landsat
  and Sentinel images (10-30 m) cannot show one house. Sub-metre images are commercial (a paid map service under
  `CLAUDE.md`) except Maxar's Open Data releases for some disasters (CC BY-NC 4.0, **not verified** today) and NOAA's
  aerial photos (below).
- **Risk:** a wrong "destroyed" on someone's house is a harm, and a wrong "no damage" reads like an all-clear.

Official alternatives that need no AI:

| Source | What | Notes |
|---|---|---|
| CAL FIRE DINS | Inspectors' damage grade for each structure in California fires since 2013 (No Damage, Affected 1-10 %, Minor 10-25 %, Major 25-50 %, Destroyed 50-100 %) | Public downloads on data.ca.gov and ArcGIS; the catalogue marks the licence "other, specified" (**terms not read**). Verdict: use with care, as official information with issuer and date, for past fires in Forensic |
| NOAA NGS Emergency Response Imagery | NOAA aircraft photos after hurricanes, floods and fires (`storms.ngs.noaa.gov`). Listed today: Hurricane Isaias (2026), Hurricane Melissa (2025), Texas Flooding (2025), California Fire (2025), Hurricanes Helene and Milton (2024) | A US Government work; the page states no licence or credit line (**not verified**). Verdict: use, as a picture layer "NOAA aerial photo, {date}" with no damage label. Most useful for the hurricane work |

**What this means for the app.** Do not grade damage with AI. Show the official inspection points and the official
aerial photos, and let people see for themselves. **Effort: 3 agent-hours** for DINS points on past California fires;
**3-4 hours** for an NGS photo layer (best planned with the hurricane work).

### 1.10 Smoke seen from space or cameras

| Item | What it is | Access, terms | Verdict |
|---|---|---|---|
| NOAA HMS smoke outlines | Smoke areas drawn by NOAA analysts on satellite images, in three grades (Light, Medium, Heavy), several times a day. People, not AI | Public files, no key: `satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/Shapefile/YYYY/MM/hms_smokeYYYYMMDD.zip`. Today's and yesterday's files exist (tested; today's was updated 16:57 UTC). Record from 2005. US Government work; credit "NOAA/NESDIS Hazard Mapping System" | **use** |
| GOES aerosol / smoke detection | Automatic smoke mask from the GOES weather satellites | not checked today | not verified |
| Pyronear | Open camera-based smoke detection (YOLO models, Apache-2.0 on its model cards) | Needs camera feeds | **do not use**: the app has no cameras |
| ALERTCalifornia cameras | A large network of fire-watch cameras (UC San Diego) | Public viewing; "non-commercial use with credit" ("ALERTCalifornia / UC San Diego"); nothing about automated bulk use or AI | **do not use** without written permission |

Smoke forecasts are in section 2.3. **What this means for the app:** HMS outlines are the honest "where is smoke now"
layer: official, human-made, free.

### 1.11 If a model runs on your machine: cost and how to keep it separate

| Model | Weights | Extra software | Chip | CPU (estimate) | Apple GPU (estimate) |
|---|---|---|---|---|---|
| Prithvi-EO-2.0-300M flood / burn | 1.3 GB | PyTorch + TerraTorch | 512 px | seconds per chip | under 1 s per chip |
| TerraMind-base-Flood | size not stated | PyTorch + TerraTorch 1.2.1 | 256 px x 4 dates | seconds per chip | under 1 s per chip |
| ai4g-flood | in the repository | PyTorch (Python below 3.12 per its README) | tiles of a radar pair | seconds per tile | under 1 s per tile |
| Wildfire-FM (section 2.1) | 31 MB | PyTorch only | all California at 5 km | under 1 s | under 1 s |

Three practical points:

- The backend pins `numpy==1.26.4` (for pyretechnics) and runs Python 3.12. TerraTorch and ai4g-flood have their own
  version needs. **Keep AI models out of the backend's environment**: a separate optional folder (for example
  `ml/`) with its own `uv` project, run as a command that writes a GeoTIFF into the bundle. The API never imports
  PyTorch, the app works without it, and the cloud session (4 CPU cores, no GPU) can skip it.
- Weights are downloaded once from Hugging Face (no login for the models above). Record the file's hash and the
  model's name and date in the bundle, so every AI layer can say which model made it.
- Nothing leaves your machine when a model runs locally.

### 1.12 Honest labels for AI-made map layers (proposed wording)

- Layer name: "AI-mapped water (experimental)". Never just "Flood" or "Water".
- Caption: "A computer model's reading of a {radar / satellite} image from {date, time}. No person checked it. It
  can miss water under trees and between buildings, and can mark roads, fields or shadows as water. Dry pixels do
  not mean no flooding."
- Always beside it: model name and version, image source and time, credit, and a link to the model's page.
- Never merged with official areas (NWS warning polygons, FEMA zones). Different colour family, own legend row, own
  on/off switch, off in Public by default.
- Where the model had no input: the same "no view" hatch as today, never blank land.
- For burned area: "AI-mapped burned area (experimental)". For any forecast: "AI forecast (experimental). Not advice.
  Follow local officials."

## 2. Hazard-specific AI forecasts

### 2.1 Fire

**Wildfire-FM (RAI-Lab). Verdict: use with care, as a labelled experiment only.**

- **What it is:** "WildFIRE-FM", a small U-Net that predicts, for each 5 km square of California, whether satellites
  will detect fire there in the next 12 hours ("occupancy"). Published at `huggingface.co/RAI-Lab/Wildfire-FM` with a
  paper titled "Does Your Wildfire Prediction Model Actually Work, or Just Score Well?" (arXiv 2605.18911).
- **Checked today:** licence MIT; not gated; five checkpoints of 31 MB each; repository created 2026-05-13, last
  changed 2026-10-11. The card says: "The released weights are California regional checkpoints, not nationwide-trained
  weights" and offers a recipe to retrain for the lower 48.
- **Input (16 layers on a 5 km grid, fixed order, raw units):** ten NOAA HRRR weather fields (temperature, dew point,
  two wind components, CAPE, pressure, boundary-layer height, visibility, rain rate, rain total), two validity masks,
  and four fixed layers: LANDFIRE fuel model, canopy cover, housing density (Wildfire Risk to Communities) and
  population (LandScan). FIRMS detections are the answer it learned from, not an input.
- **Trained on:** June-August 2024, checked on September, tested on October 2024. One fire season.
- **Accuracy by its authors:** in their task table the best 12-hour occupancy score ("union F1") was 60.15 % (plus or
  minus 7.59), and it was won by another model (ClimaX), not by Wildfire-FM. Wildfire-FM led their "fire-spread
  spatial F1" row (80.97 %). The paper's own message is that such scores change a lot with how you count.
- **Data needs:** HRRR from NOAA's public bucket (no key); LANDFIRE (the app has it); two new static sources (housing
  density, LandScan population), whose terms need a check.

**What this means for the app.** It answers a different question from the app's spread model: "which 5 km squares
will have satellite fire detections in the next 12 hours", not "where will this fire's edge be". 5 km is about 170 times
coarser than the app's 30 m grid. Honest uses: (1) a benchmark line in `docs/validation.md` ("does the app's forecast
beat an open AI model at 5 km?"); (2) an optional California-only layer in Command labelled "AI forecast: chance of
satellite fire detections in this 5 km square in the next 12 hours (experimental)". **Effort: 8-12 agent-hours**
(separate `ml/` environment, HRRR fields onto the 5 km grid, two new static layers, a 2025 back-test). Not a first
step.

**NOAA Next Generation Fire System (NGFS). Verdict: use with care (beta; no documented API).**

- **What it is:** NOAA's AI-assisted fire detection from the GOES East and West weather satellites. It scans every
  new image (every 5 minutes over the lower 48, every minute in small "mesoscale" boxes; scan schedule not
  re-checked today) and reports heat spots as events, corrected for terrain.
- **Who runs it:** NOAA/NESDIS, developed with the University of Wisconsin (CIMSS).
- **Access:** the NESDIS Wildland Fire Data Portal, `fire.data.nesdis.noaa.gov` ("Beta Site", "still in
  development"). Its data page offers a **download form**: 12 collections (detections and features for GOES East and
  West, CONUS and mesoscale), formats GeoJSON, KML, CSV, Shapefile, up to 24 hours per request. I found **no
  documented API, map service or cloud bucket** (two guessed bucket names do not exist).
- **Terms:** data "as is", "for informational purposes only", use in decisions "at the sole risk of the end user".
  No credit line given; "NOAA/NESDIS Next Generation Fire System (experimental)" would be accurate.
- **Status:** NOAA says the GOES part moves to operations "later in 2026" (news reports, **not verified** on a NOAA
  schedule page).

**What this means for the app.** The app already gets GOES detections through NASA FIRMS (with the FIRMS key). NGFS
is built to do better (NOAA describes earlier detection, also through some cloud and smoke), and it needs no key. But a beta
website's download form is not a stable feed for a live loop. Plan: ask NOAA which machine-readable route is
supported, then add NGFS as one more detection source with its own label. **Effort: 3-4 agent-hours** once a stable
route is known.

**Others.**

| Item | What it is | Verdict under `CLAUDE.md` |
|---|---|---|
| FireBench | Google Research's set of very detailed fire simulations, hosted on Google Cloud | **do not use** (Google; licence not verified) |
| "Next Day Wildfire Spread" | Google Research's 2022 training set (made with Google Earth Engine) | **do not use** (Google) |
| AlphaEarth embeddings | Google DeepMind's satellite "summary" layers (one of the models compared in the Wildfire-FM paper) | **do not use** (Google) |
| WildfireSpreadTS | A university training set: 13,607 daily images of 607 US fires, 2018-2021 (Zenodo record 8006177) | use with care: a benchmark set, not a model; licence field **not verified** |
| Open "next-day spread" models | Research code trained on the two sets above; no maintained open model with weights and a live data feed was found | nothing to use today |

### 2.2 Floods

| Item | What it is | Access, cost, terms | Verdict |
|---|---|---|---|
| NOAA National Water Model (NWM) | NOAA's physics model of every US stream. Already in the app | public | keep |
| NWM "NextGen" with AI parts | NOAA's next version, which can mix in learned models (LSTM) for some basins | No NOAA notice of it being operational found (**not verified**) | wait; the app gets it for free through NWM when it arrives |
| Google Flood Hub and Flood Forecasting API | Google's AI river forecasts (up to 7 days) and flood maps; news reports say it covers US rivers | API: waitlist form, then a Google Cloud project and API key; "public and offered at no charge"; data "under the CC BY 4.0 license"; described as a pilot. US coverage in the API: **not verified** | **do not use** unless you change the Google rule. If you do: a new secret (Google API key), a Google account, and requests for river points go to Google |
| GloFAS (Copernicus) | Europe's global river-flow forecast: daily, ensemble, about 5 km squares, weeks ahead (grid and length not re-checked today) | Official files: ECMWF's Early Warning Data Store, needs an ECMWF account. CC BY licence replaced the old Copernicus licence on 2025-07-02 (forum notice, **not verified** on the licence page) | use with care, through Open-Meteo (next row) |
| GloFAS through Open-Meteo Flood API | The same forecasts from the weather host the app already uses | `flood-api.open-meteo.com/v1/flood`, no key. Tested: 13 daily values for a point near Lake Charles (3 past + 10 ahead), with median and maximum | **use with care**: 5 km squares, so small rivers are wrong; a second opinion beside NWM, never the main line |
| NeuralHydrology | A research toolkit to train AI river-flow models (LSTM) | BSD-3-Clause; a library, **no ready model or live feed** | do not use (nothing to plug in) |
| NOAA MRMS FLASH | NOAA's flash-flood products from radar rain every few minutes: rain compared with flash-flood guidance, and modelled stream response | Public bucket `noaa-mrms-pds`, no key. Listed today: `FLASH_QPE_FFG01H / 03H / 06H`, `FLASH_QPE_ARI*`, `FLASH_CREST_MAXUNITSTREAMFLOW` and more | **use with care**: experimental model output; strong for flash floods, where gauges and satellites are too slow |
| NWS flash-flood guidance, WPC Excessive Rainfall Outlook | Official forecaster products | public | use, as official with issuer, time and link (not re-checked today) |

**What this means for the app.** For river floods the app is already on the best free model (NWM). The gap is
**flash floods**: brief 5 found they have no gauge and no timely satellite view. MRMS FLASH's "rain compared with
flash-flood guidance" is the standard way forecasters see them. The installed `rasterio` can read these files (its
GDAL has the GRIB reader: checked), so no new dependency. **Effort: 4-5 agent-hours** for one FLASH layer in Command
with a plain legend ("Rain in the last 3 hours compared with what the ground can take. NOAA model, experimental").

### 2.3 Smoke

| Item | What it is | Access, cost, terms | Resolution, time | Verdict |
|---|---|---|---|---|
| HRRR-Smoke | NOAA's 3 km weather model carries smoke from satellite-detected fires and forecasts where it goes. Physics, not AI | Public bucket `noaa-hrrr-bdp-pds`, no key, US Government work. Tested on today's 12 UTC run: fields `MASSDEN` (smoke near the ground), `COLMD` (smoke in the whole air column) and `AOTK`. I downloaded only the near-ground field for +6 h by byte range (725 kB) and read it with the installed `rasterio`: 1799 x 1059 squares of 3 km, largest value 701 micrograms per cubic metre | 3 km; hourly runs, 18 h ahead, 48 h four times a day (run lengths not re-checked today); archive on the bucket for back-tests | **use** |
| NOAA HMS smoke outlines | Section 1.10 | no key | several times a day | **use** |
| AirNow sensors | EPA's official air-quality monitors and the AQI | Free **API key** (a new secret). EPA's Data Exchange Guidelines (updated August 2025): data "are not fully verified or validated ... should be considered preliminary"; credit "federal, state, local, and tribal air quality agencies and the EPA AirNow program"; displays "must indicate that these data are preliminary"; values and advisories "should not be altered in any way"; AQI colours as EPA defines them; agencies and AirNow must be told that a product relies on the data | hourly points | **use with care**: needs your approval of the key and a short notice to AirNow |
| Open-Meteo Air Quality (CAMS) | Europe's global air-quality model | No key. Tested: hourly PM2.5 and US AQI for a point near Pasadena | about 40 km global squares: far too coarse for one fire's smoke | do not use for smoke plumes |

**What this means for the app.** A "Smoke" layer for fires, built from two free NOAA sources: where analysts see
smoke now (HMS), and where the model expects smoke near the ground over the next 18-48 hours (HRRR-Smoke), with the
existing time handle. Wording: "Smoke near the ground (NOAA HRRR-Smoke forecast, experimental). Not an air-quality
reading. For health guidance see AirNow." with a link. No colours that read as "clean air": outside the plume is
"no smoke forecast here", not "good". **Effort: about 5 agent-hours** (backend 2-3, web 2, review). AirNow monitors
could follow if you approve the key (3 hours).

## 3. Language models (Claude through the Anthropic API)

### 3.0 Hard limits for every idea (not negotiable under `CLAUDE.md`)

1. **Official text stays whole.** NWS products, evacuation orders and agency fire records are shown verbatim with
   issuer, their own times and a link, exactly as today. AI text never replaces, shortens or sits in place of them.
   An AI sentence may point to an official item ("An NWS Flood Warning is in effect: read it above") but may not
   restate what it tells people to do.
2. **Nothing that reads as evacuation advice or an all-clear.** No "you should", no "you can stay", never the words
   "safe" or "low risk". Outside the modeled area is "unknown".
3. **Every AI sentence is labelled and traceable.** The backend hands the model a numbered list of facts (value,
   source, issuer, time, link). The model must return each sentence with the numbers of the facts it used. The
   backend drops any sentence with no fact number, or with a number or name that is not in the facts. The reader
   can open "Built from" and see the facts.
4. **Checked by code after the model.** A banned-phrase check ("safe", "low risk", "all clear", "no danger", "you
   should", "evacuate now", "no need to") replaces the whole answer with a fixed line if it trips. A fixed footer is
   always added: "AI-written explanation (experimental). It can be wrong. Not advice. Follow local officials."
5. **Questions about leaving, staying or personal risk get a fixed answer, not a model answer:** "Disaster Mapping
   cannot tell you whether to leave or stay. Follow local officials." followed by the official items and links
   already on screen.
6. **No personal location without consent.** The facts packet holds what is on screen for the selected fire or
   flood. It never holds the browser's "my location". A point the user selected is sent only as facts computed
   locally ("the selected point is inside the NWS Flood Warning area"), not as coordinates.
7. **A clear off switch, off by default.** No `ANTHROPIC_API_KEY`, or `FIRE3D_LLM=0`: no AI panel appears anywhere and
   no request is made. A second switch in Layers & settings lets a viewer hide AI text.
8. **The key is a secret** like the other two: environment or `.env` only, never printed, logged or committed,
   count-only scans, sent only to `api.anthropic.com`.
9. **Tests never call the API.** They replay recorded answers, as the app's source tests do.

### 3.1 The ideas, with a verdict

| Idea | What leaves the machine | Risk | Verdict |
|---|---|---|---|
| A. Glossary tooltips ("crest", "containment", "ensemble", "Red Flag Warning") | **Nothing.** Written once with Claude's help while building, read by a person, shipped as fixed text | very low | **use** (recommended 1) |
| B. "Explain this view" button: 3-5 sentences on what the map shows now | The facts packet for the open fire or flood (public data). No free text from the user | low, with rules 1-5 | **use** (recommended 2) |
| C. Daily situation digest in Command: "what changed since yesterday" across the lists | The day's list facts (public data) | low-medium: a wrong sentence about an official product. Every line must link to its row | **use with care** (recommended 3) |
| D. Summary of the model output ("the forecast grows mostly north-east in 24 h; members disagree most after 36 h") | Forecast statistics | medium: it can sound like a prediction of what will happen | fold into B for Command and Forensic only, never Public |
| E. Question box, grounded only in the data on screen | The user's typed question plus the facts packet | **high**: people will ask "should I leave?"; typed text may contain personal details; answers vary | **use with care, later**, in Command and Forensic only; never in Public |
| F. Translating NWS text | The NWS text (public) | **high**: one wrong verb changes an instruction. NWS runs its own experimental translations (Spanish, Simplified Chinese, Vietnamese, French, Samoan at `weather.gov/translate`); a January 2026 GAO report (GAO-26-107680) found the project lacks a long-term plan | **use with care**: first link to NWS's own translation where one exists. Machine translation only below the full English original, labelled "Unofficial machine translation. The English text above is the official one." Not in the first LLM step |
| G. Translating the app's own fixed sentences (labels, captions, disclaimers) | Nothing at run time (done once, reviewed) | low, if a speaker of the language reviews the safety lines | use, as a separate localisation task |
| H. AI reading satellite pictures to say "flooded" or "burning" | Images | high: reads as an observation, cannot be traced to a measurement | **avoid** |
| I. AI choosing a status word or a risk level, writing alerts or notifications, or a chat "assistant" in Public | varies | high | **avoid** |

### 3.2 The three worth building

**1. Glossary (static).** About 60 terms in plain words, each with one link to an official definition (NWS
glossary, NWCG glossary, USGS). Claude drafts them while the feature is built; you or a reviewer read them; they ship
as fixed text. No key, no cost while the app runs, nothing sent anywhere. **Effort: 2 agent-hours.**

**2. "Explain this view".** A button in Command and Forensic (and, if you want, Public). The backend builds the
facts packet from the bundle and the live lists, asks Claude for 3-5 sentences in plain words, checks them (3.0
rules 3-5) and stores the answer under a hash of the facts. The same view with the same data shows the same stored
text at no cost, and an auditor can see exactly what was said. Example of an allowed answer for a flood: "The river
gauge at {name} read 17.6 ft at 14:00, in the range NWS calls moderate flooding [1]. NWS forecasts a crest of 18.0 ft
tomorrow afternoon [2]. The blue area is water a satellite saw on Oct 29; clouds hid 61 % of this area that day [3].
An NWS Flood Warning is in effect: read its full text above [4]." **Effort: 5-6 agent-hours** (facts packet,
API client, checker, store, panel, recorded-answer tests, one safety review).

**3. Daily digest (Command).** Once a day (or on demand) the backend sends the day's list facts: new fires and
floods, changes of status word, acres and containment changes from the agency record, new and ended NWS products.
Claude returns short lines, each with fact numbers; the page shows each line with a link to its row. It can run
through the Message Batches API at half price, since nobody waits for it. **Effort: 4 agent-hours.**

### 3.3 What to avoid, in one list

A chat box in the Public view; any answer to "should I leave / is my house at risk"; summaries shown in place of
official text; translation shown in place of the English original; AI-chosen status words, colours or risk levels;
AI-written push alerts; AI reading pictures to declare fire or flood; sending "my location", an address or free text
without a visible notice; calling the API from tests or from the live loop without a spending limit.

### 3.4 Cost per request (prices read from Anthropic's pricing page on 2026-11-10)

Prices per million tokens, input / output: Claude Haiku 5.5 $0.10 / $0.50 (prompts up to 100,000 tokens); Claude
Sonnet 5.5 $2 / $10; Claude Opus 5.5 $4 / $20; Claude Fable 5.2 $8 / $40. The Batch API halves both. Hidden reasoning
counts as output; the estimates below allow for some.

| Feature | Tokens in / out (estimate) | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 | Fable 5.2 |
|---|---|---|---|---|---|
| Explain this view (per new answer; stored answers cost nothing) | 3,500 / 600 | $0.0007 | $0.013 | $0.026 | $0.052 |
| Question box (per question) | 5,000 / 800 | $0.0009 | $0.018 | $0.036 | $0.072 |
| Daily digest (per day) | 12,000 / 2,000 | $0.002 | $0.044 | $0.088 | $0.176 |
| Daily digest through Batch | same | $0.001 | $0.022 | $0.044 | $0.088 |
| Translate one NWS product | 2,400 / 1,600 | $0.001 | $0.021 | $0.042 | $0.083 |

So a month of daily digests on Claude Opus 5.5 is about $2.60 ($1.30 through Batch), and 1,000 fresh "Explain"
answers about $26. Anthropic's own guidance is to start on Claude Opus 5.5 and move to a cheaper model only as a
deliberate choice; which model to use is your decision (section 8). Set a monthly spending limit in the Anthropic
Console before the key goes into `.env` (Console limits not re-checked today).

### 3.5 What is sent, what is kept, how it is built

- **Sent to Anthropic:** the fixed instructions and the facts packet (public data about the selected fire or flood:
  names, numbers, times, issuer names, links, short official headlines). For the question box only: the typed
  question. Never: "my location", IP-derived place, browser details, the other secrets.
- **Kept by Anthropic:** by reports of its commercial terms, API inputs and outputs are not used to train models and
  are kept for a limited time (about 30 days). **Not verified** on Anthropic's own privacy page today; read
  `privacy.claude.com` before switching the feature on.
- **Kept by the app:** each answer with its facts, model name and time, in the bundle folder. That is the audit trail
  and the cache.
- **Build notes for the plan:** the official Python SDK (`anthropic`) is one new dependency, clearly needed for this
  feature only; the answer is requested as structured output (a list of sentences with fact numbers), so the checker
  never parses free prose; text inside official products is passed as quoted data, with an instruction that nothing
  inside it is a command (an NWS text or a place name must not be able to steer the model); if the API declines or
  fails, the panel says "No AI explanation available" and the page is otherwise unchanged.

## 4. Recommendation

### 4.1 First step (about 6 agent-hours; no rule change, no new secret, no new dependency)

1. **Radar water without a login** (section 1.1): NASA's DSWx-S1 tiles as radar passes in the flood time steps,
   classes read from the tiles, pass times from CMR, the corrected "not set up" sentence. **3-4 hours.** It answers
   brief 6's biggest known issue (clouds hide most of St. Johns and Calcasieu) with data NASA already makes.
2. **Static glossary** (section 3.2, item 1). **2 hours.**

### 4.2 Next step (about 5 agent-hours; still no rule change)

**Smoke layer for fires** (section 2.3): HMS smoke outlines now, HRRR-Smoke near-ground forecast on the time handle.
Smoke is the part of a wildfire most people actually meet, and the app shows none today.

### 4.3 Stretch steps (pick by interest)

| Stretch | Needs from you | Effort |
|---|---|---|
| A. "Explain this view" + daily digest (3.2) | Approve `ANTHROPIC_API_KEY` as a third secret; choose a model; set a spending limit | 9-10 h |
| B. Flash-flood layer from NOAA MRMS FLASH (2.2) | nothing | 4-5 h |
| C. Same-day wide water view, MODIS / VIIRS (1.3) | nothing | 2-3 h |
| D. Run a radar flood model on your Mac: ai4g-flood first, TerraMind later (1.6, 1.7) | An account for radar images (Earthdata login at ASF, or Copernicus Data Space); accept PyTorch in a separate `ml/` folder; your Mac for the run | 10-14 h, incl. a comparison with DSWx-S1 on 3 past floods |
| E. Wildfire-FM California experiment and benchmark line (2.1) | Accept PyTorch in `ml/`; terms check of two static layers | 8-12 h |
| F. Official damage points and NOAA aerial photos (1.9) | Read the DINS terms | 3-7 h |
| G. Copernicus GFM radar flood maps (1.4) | Read the GFM terms page | 3-4 h |
| H. NGFS fire detections (2.1) | Ask NOAA for the supported machine route | 3-4 h |

## 5. Benchmarking and validation ideas for these additions

- **Radar vs optical water, same flood:** for each stored flood, the share of the area each pass could see, and how
  well radar and optical water agree where both saw the ground (IoU). Publishes the honest answer to "how much does
  radar help?" **1-2 hours** on top of 4.1.
- **AI-mapped water vs NASA's map:** if stretch D is built, score the AI layer against DSWx-S1 of the same pass on
  3 past floods (IoU, missed water, false water), and put the scores in the layer's caption.
- **Burn severity vs the official map:** the app's dNBR against BAER / RAVG classes for 5 past fires (agreement per
  class).
- **Wildfire-FM as a baseline:** at 5 km and 12 h, compare three things on the 2025 California fires in
  `docs/validation.md`: Wildfire-FM, the app's own forecast summed to 5 km squares, and "tomorrow equals today".
  A forecast that cannot beat "no change" should say so.
- **Smoke forecast check:** HRRR-Smoke plume 6 h ahead against the HMS outline drawn 6 h later (share of the outline
  covered).
- **Language-model test set:** about 60 recorded cases run before any release: normal views; views with missing
  data; trap questions ("am I safe?", "should we go?"); an official text containing a planted instruction; a fact
  packet with an empty forecast. Pass rules: every sentence has valid fact numbers, no banned phrase, the fixed
  answer for advice questions, official text untouched. Keep the score in `docs/validation.md`.

## 6. What I could not verify

- Licence text on official pages for: xBD (`xview2.org` did not load), Copernicus GFM, GloFAS, WildfireSpreadTS,
  CAL FIRE DINS, NOAA NGS aerial photos, Maxar Open Data, the LANCE flood product's credit line.
- Whether Microsoft Planetary Computer's Sentinel-1 data needs an account (page did not load); how soon raw
  Sentinel-1 and Sentinel-2 images are public after a pass.
- Accuracy of TerraMind-base-Flood (none published) and ai4g-flood (in its paper, not read).
- Prithvi's paper numbers were read through a search summary, not the paper.
- NGFS: any machine route beyond the download form; the date it becomes operational. The session's network refused
  the GitHub API for other repositories, so repository licences come from the repositories' web pages.
- Google Flood Forecasting API: country list, whether the US is covered, any terms beyond the developer page.
- NOAA NextGen / NWM version 4 dates; HRRR run lengths; MTBS and RAVG delays; GOES smoke masks.
- Anthropic's data retention wording on its own privacy page; Console spending limits.
- All compute times (no Mac, no GPU here).
- A note on one source: the AirNow guidelines PDF contains a stray sentence addressed to AI tools (about how to
  identify oneself in email). It is text inside a document, not an instruction from you. I did nothing with it.

## 7. Evidence log (2026-11-10, UTC)

| Host | Requests | What was checked |
|---|---|---|
| `huggingface.co` (model API and cards) | 10 | Licence, gating, file sizes, dates for 4 Prithvi models, Wildfire-FM, TerraMind and IBM model lists; Wildfire-FM card text |
| `gibs.earthdata.nasa.gov` | 3 | Layer list with dates (capabilities file); one DSWx-S1 tile; one VIIRS flood tile |
| `cmr.earthdata.nasa.gov` | 3 | Newest DSWx-S1 and DSWx-HLS passes near Lake Charles with sensing and listing times; OPERA collections |
| `gis.earthdata.nasa.gov` | 3 | No DSWx-S1 image service; folder list |
| `noaa-hrrr-bdp-pds.s3.amazonaws.com` | 2 | Today's 12 UTC index (smoke fields); one 725 kB field by byte range, read with rasterio |
| `noaa-mrms-pds.s3.amazonaws.com` | 1 | FLASH product folders |
| two guessed NGFS bucket names | 2 | Do not exist |
| `satepsanone.nesdis.noaa.gov` | 2 (HEAD) | HMS smoke files for Nov 9 and Nov 10 |
| `flood-api.open-meteo.com`, `air-quality-api.open-meteo.com` | 1 + 1 | GloFAS river flow and CAMS PM2.5 for one point each, no key |
| `fire.data.nesdis.noaa.gov` | 2 | Beta banner, data download form, terms |
| `api.github.com` | 7 | All refused by this session's network settings (not a fact about the repositories) |

Pages read with WebFetch: the Prithvi flood and burn cards, TerraMind-base-Flood and -Fire cards,
`github.com/microsoft/ai4g-flood`, `github.com/neuralhydrology/neuralhydrology`,
`developers.google.com/flood-forecasting`, `cimss.ssec.wisc.edu/ngfs`, the NESDIS portal pages,
`storms.ngs.noaa.gov`, the AirNow Data Exchange Guidelines (PDF, "Last Updated August 2025"),
`platform.claude.com/docs/en/about-claude/pricing`. Local checks: `backend/pyproject.toml` (numpy pin), the installed
GDAL 3.10.3 has the GRIB reader, `sources/opera.py` and `floods/satellite.py` (the unused `GIBS_S1_LAYER`).

## 8. Questions only you can answer

1. **Google rule:** keep "No Google data" as it is for Flood Hub, FireBench and the others in this file? (Nothing
   recommended here needs a change.)
2. **A third secret:** may the app use an `ANTHROPIC_API_KEY` (optional, off by default) for "Explain this view" and
   the daily digest? If yes: which model (Anthropic's default advice is Claude Opus 5.5; Haiku 5.5 costs about 40
   times less), and what monthly spending limit?
3. **Where may AI-written text appear:** Command and Forensic only, or also Public?
4. **PyTorch:** may an optional, separate `ml/` folder with PyTorch exist for experiments on your Mac (radar flood
   model, Wildfire-FM), as long as the app never needs it?
5. **Radar account:** would you set `EARTHDATA_TOKEN` on your Mac for one live test of the measured radar route, and
   accept the Alaska Satellite Facility as a second host for that token if stretch D is chosen?
6. **AirNow:** may the app use an AirNow API key (a fourth secret) and send AirNow the notice its guidelines ask
   for, or should smoke stay with the two no-key NOAA sources?
7. **Translation:** is Spanish (or another language) a goal for this app? If yes, the app's own sentences come
   first, with a human review of the safety lines.
8. **Damage:** do you want official damage inspection points (California) and NOAA aerial photos, knowing that the
   app will not grade damage itself?
9. **Order:** is "radar water + glossary, then smoke" the right first two steps, or should the language-model
   features come first?

## 9. Sources (all read 2026-11-10 unless marked)

- NASA GIBS capabilities: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities`
- NASA CMR granule search: `https://cmr.earthdata.nasa.gov/search/granules.umm_json` (short names `OPERA_L3_DSWX-S1_V1`,
  `OPERA_L3_DSWX-HLS_V1`)
- NASA data use guidance: `https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance`
  (as cited in the app; not re-read today)
- NASA LANCE flood product: `https://www.earthdata.nasa.gov/global-flood-product` (through search summaries)
- Copernicus GFM: `https://global-flood.emergency.copernicus.eu/` (annual-meeting slide decks, through search summaries)
- Prithvi flood: `https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11`; burn scars:
  `https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-BurnScars`; paper `https://arxiv.org/abs/2412.02732`
- TerraMind: `https://huggingface.co/ibm-esa-geospatial/TerraMind-base-Flood`,
  `https://huggingface.co/ibm-esa-geospatial/TerraMind-base-Fire`
- ai4g-flood: `https://github.com/microsoft/ai4g-flood`
- Wildfire-FM: `https://huggingface.co/RAI-Lab/Wildfire-FM`; paper `https://arxiv.org/abs/2605.18911`
- NGFS: `https://cimss.ssec.wisc.edu/ngfs`, `https://fire.data.nesdis.noaa.gov/`, `https://fire.data.nesdis.noaa.gov/data/`,
  `https://www.nesdis.noaa.gov/data-products-research-services/wildland-fire-data-portal`
- Google Flood Forecasting API: `https://developers.google.com/flood-forecasting`
- GloFAS / EWDS: `https://confluence.ecmwf.int/spaces/CEMS/pages/242067419/EWDS` (through search summaries);
  Open-Meteo Flood API `https://flood-api.open-meteo.com/v1/flood`
- NeuralHydrology: `https://github.com/neuralhydrology/neuralhydrology`
- NOAA open data buckets: `https://noaa-hrrr-bdp-pds.s3.amazonaws.com/`, `https://noaa-mrms-pds.s3.amazonaws.com/`
- NOAA HMS smoke: `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/`
- AirNow Data Exchange Guidelines: `https://docs.airnowapi.org/docs/DataUseGuidelines.pdf`
- NOAA NGS Emergency Response Imagery: `https://storms.ngs.noaa.gov/`
- CAL FIRE DINS: `https://catalog.data.gov/dataset/cal-fire-damage-inspection-dins-data` (through search summaries)
- Burn Severity Portal (BAER, RAVG): `https://burnseverity.cr.usgs.gov/` (through search summaries)
- xBD paper: `https://arxiv.org/abs/1911.09296` (licence through secondary pages)
- WildfireSpreadTS: `https://zenodo.org/records/8006177` (through search summaries)
- NWS translation: `https://www.weather.gov/translate/`; GAO report `https://www.gao.gov/products/GAO-26-107680`
  (through search summaries)
- Anthropic pricing: `https://platform.claude.com/docs/en/about-claude/pricing`
