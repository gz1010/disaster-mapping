# Roadmap 7: AI models, hurricanes, track record and UI (plan only, Nov 10, 2026)

The user asked: "Be creative and plan what can be added in addition to what I give here: 1. AI, I have access to
Google WeatherNext 3, how do we include AI models in this? We can use others in addition to WeatherNext 3 too.
2. Hurricane model? 3. Be creative: what can you add in UI, benchmarking, validating, etc."

This is a plan, not a build. The details and sources are in six research files in `audit-7/`:

| File | Topic |
|---|---|
| `audit-7/ai-weather.md` | WeatherNext 3 and the free AI weather models |
| `audit-7/hurricanes.md` | What NHC publishes, models, replay, the three views |
| `audit-7/ai-mapping-llm.md` | AI for satellite mapping, hazard AI, language-model features |
| `audit-7/benchmark-validation.md` | Measuring every forecast the app shows |
| `audit-7/code-integration.md` | Where each addition plugs into the code, and what to fix first |
| `audit-7/ui-ideas.md` | 30 UI ideas, ranked |

Hours below are agent build hours, measured against earlier briefs. Add about a third for independent reviews.

## 1. The short answers

**AI weather.** WeatherNext 3 is real and good: 64 forecasts at once, 15 days ahead, boxes of about 10 km. But it is
Google data, which `CLAUDE.md` forbids today. Using it needs four things:
- a rule change in `CLAUDE.md`, and in the `SPEC.md`, `README.md` and test lines that say no;
- Google's approval of your access request;
- a Google credential as a third secret;
- living with its terms: forecasts newer than an hour are "experimental", "not intended for consumer use", and the
  raw forecast may not be republished.

So it could appear in Command and Forensic as a comparison, not in the Public view.

A free AI model needs none of that. The European centre's **AIFS ensemble** (51 forecasts, 15 days, CC BY 4.0) comes
through Open-Meteo, the weather host the app already uses. It was tested and returns all five values the fire
forecast needs.

One honest limit: global AI models see the world in 10-25 km boxes, and a canyon wind is 1 km wide. AI weather is
good for "what do the next 3-10 days look like, and do the models agree?" It is not good for "which slope burns in
the next 6 hours". The 3 km weather model stays the driver for the first 48 hours.

**Hurricane model.** Building our own hurricane model is not the honest first step. NHC publishes everything for
free, with no key:
- the official forecast;
- the cone;
- wind extents;
- watches and warnings;
- the storm-surge map;
- every past advisory, back to 2008.

NOAA also publishes the tracks of its own AI hurricane models (AIGFS, AIGEFS, HGEFS) and of its physics models. So
the app can show:
- the official forecast;
- labelled model tracks, AI included;
- replays of past storms (Helene 2024, Milton 2024, Isaias 2026), which work out of season;
- scores for each model against the storm's real path afterwards.

Google DeepMind's storm tracks sit inside NHC's own public model file (rows `GDMN`, `GDMI`, `GDM2`). Those rows are
filtered out unless the Google rule changes.

**Benchmarking.** The app measures one thing today: fire spread on 15 past fires. It also deletes its own live
forecasts (it keeps the newest 4 per fire). The main proposal is a **forecast ledger**. It saves every forecast
exactly as shown, then scores it automatically when the truth arrives: a satellite pass, a gauge reading, a weather
station or a storm's real path. A **Scorecard** page shows the results with sample sizes and "too few to say". New
models run **shadow first**: they are recorded silently and shown only once they have a track record.

**UI.** The weakest point is that a newcomer cannot tell what a layer means, how old it is or how sure it is. The
cheapest fixes:
- odds as counts ("9 of 31 runs");
- a source card on every layer;
- a glossary;
- links that reopen the exact view.

The best new links between hazards are USGS debris-flow maps for burn scars (free, no key, 765 assessments) and the
NOAA smoke forecast.

## 2. Urgent, whatever else is chosen: the 3 km weather feed ends on Nov 30, 2026

Open-Meteo's documentation says its HRRR feed (the app's main fire weather, `gfs_hrrr`) is "discontinued at the end
of November 2026" and points to NOAA's successor model, RRFS. NOAA itself still runs HRRR. The provider is dropping
the feed, not NOAA. If nothing changes, live fire forecasts fall back to 25 km weather with only a warning.

The fix is in package P0 below. It should be built before Nov 30.

## 3. Build packages

| # | Package | What you would see | Hours | Needs from you |
|---|---|---|---|---|
| **P0** | **Fix first** | Nothing visible. Covers the RRFS switch before Nov 30, a weather-model registry (one table instead of about 17 hand-written lists), a secrets table (ready for a third key), a cache size cap, a hazard lookup table (ready for a third hazard) and a simple full-page mechanism | ~7 | nothing |
| **P1** | **AI weather, free** | "ECMWF AIFS 51 (AI)" as a third weather choice; a **model disagreement** panel in Command and Forensic (physics against AI); a 10-day model fire-weather outlook next to, never merged with, NWS products | ~9 | nothing |
| **P2** | **Track record** | The forecast ledger; fire scoring on the 15 fires; NWS river-crest scoring; a weather-station scorecard; the **Scorecard** page; a build check that fails if fire skill drops | ~14 (core ~8) | nothing |
| **P3** | **Hurricanes, official first** | "Hurricanes" in the hazard switch; storm list; Public and Command views from NHC and NWS only; advisory replay with Play; a spaghetti of labelled model tracks (NOAA AI included) | ~14 | the Google-rows decision |
| **P3b** | Hurricane add-ons | 3D storm surge in Forensic (4-5 h); track and intensity scores per model (2 h); "floods during this storm" link (1-1.5 h) | ~8 | P3 |
| **P4** | **Understand and trust (UI)** | Odds as counts; exact-view links; glossary and "how to read" cards; data-health panel with a source card on every layer | ~14.5 | nothing |
| **P5** | **New layers** | Radar water without a login (sees through clouds; NASA already publishes it), smoke (outlines and forecast), burn-scar debris-flow maps | ~13 | the smoke colour question (§4, Q4) |
| **P6** | **"Explain this view" (language model)** | A few sentences built only from the facts on screen, each tied to its facts; a daily digest in Command; off by default; never in answer to "should I leave?" | ~9-10 | approve `ANTHROPIC_API_KEY`, pick a model, set a spending cap |
| **P7** | **WeatherNext 3** | WeatherNext statistics in the disagreement panel and outlook (3.5 h); a back-test on the free archive (8 h); Command and Forensic only | ~11.5 | the rule change, Google's approval, a Google credential |

More ideas, each optional, with their hours in the research files:
- a before / after swipe;
- a fly-through along the river;
- the sun where it really was at the event time;
- the globe intro page (needs the design file `Intro.dc.html`, which is not in the repository);
- "what changed since yesterday";
- a "my place" page with saved places;
- running a radar flood model on your Mac.

## 4. Advised against

- **Our own hurricane or storm-surge model:** NHC's official products are better, and they are official.
- **PyTorch in the backend:** small AI models go in a separate optional `ml/` folder that writes files into a bundle.
- **Anything that reads as evacuation advice:** countdowns, routes, "nearest shelter", a chat box in Public.
- **One combined risk score, or traffic-light colours for a place.**
- **Push alerts from a research prototype.**

## 5. Recommended order

1. **P0 now**: the Nov 30 deadline.
2. **P1 with a small P2**: the ledger and Scorecard core, about 6 h. The AI model then collects a record from day one,
   shadow first.
3. **P4**: it makes everything after it easier to read.
4. **P3**, then P3b's 3D surge and scores.
5. **P5, P6 and P7** by your choice.

The first pass (P0 + P1 + small P2 + P4) is about **36 build hours**, with two agents at a time as in briefs 5 and 6.

## 6. Decisions for you

- **Q1. Google data (WeatherNext 3, DeepMind storm tracks).**
  - (a) Keep the rule for now: build free AIFS first and decide on WeatherNext later. *(recommended)*
  - (b) Allow WeatherNext 3 in Command and Forensic only, under its terms.
  - (c) Allow Google data wherever its terms allow, DeepMind storm tracks included.
- **Q2. Which packages go in the first pass?** P0 is always in. Pick any of: P1 AI weather, P2 track record, P3
  hurricanes, P4 understand-and-trust UI, P5 new layers. *(recommended: P1, P2 core, P4)*
- **Q3. Language-model features (P6).**
  - (a) Not now: the static glossary in P4 only. *(recommended)*
  - (b) Yes: "Explain this view" and a daily digest, off by default, with a new `ANTHROPIC_API_KEY` and a spending
    cap.
- **Q4. Smoke colours (only if P5 is chosen).** EPA's AirNow rules require its own colours and words, and its first
  class is "Good" in green, which looks like an all-clear.
  - (a) Show only NOAA smoke outlines and the forecast, with no AirNow categories. *(recommended)*
  - (b) Add AirNow with its official wording.
