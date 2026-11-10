# Audit 7: UI and product ideas (brief 7 planning)

Role: research for brief 7, topic "creative but honest UI and product ideas". **Documents only**: no app code
changed, no bundle built, no server started, no secret read or used. Checked **2026-11-10, about 22:30-23:05 UTC**
from the cloud session.

How I worked:

- **The app as it is.** I viewed 12 of the final screenshots of briefs 5 and 6 (both national maps, Public fire and
  flood, Command fire and flood playback, Forensic fire and flood, three phone shots) and read `README.md`,
  `docs/redesign/handoff-4/HANDOFF.md` (the design system), `CONTRACT.md` sections 15-17, `BRIEF-4.md` (its "Later"
  list), `BRIEF-5.md`, `BRIEF-6.md`, the known issues in `reports/final-verification-6.json`, and the other
  audit-7 files (`ai-weather.md`, `hurricanes.md`, `ai-mapping-llm.md`, `benchmark-validation.md`,
  `code-integration.md`). I did not run the app.
- **The data behind each idea.** 45 small GETs with curl (one at a time, User-Agent
  `Disaster Mapping research prototype`), 11 page reads and 6 web searches. The evidence log is section 11.
  **Measured** means I saw it in a real answer today. **Not verified** means I could not check it on an official
  page; section 10 lists all of those.

**The one rule this file cannot change for you.** `CLAUDE.md` says "No Google data, no paid map services, no
Nominatim". **None of the 30 ideas below needs Google data.** Section 5 says where Google data could appear if
you change the rule, and what that would mean on screen.

## 0. Short answer

1. **The app's weakest point is not a missing feature. It is that a newcomer cannot yet tell what a layer means,
   how old it is, or how sure it is.** The cheapest, most valuable ideas fix that: odds shown as "9 of 31 runs"
   (A1), a data-health panel with a source card on every layer (I1), a glossary with "how to read this" cards
   (G2), and links that reopen the exact view and time (E2).
2. **A multi-hazard app can show links that single-hazard apps cannot.** The best one is ready today: the USGS
   publishes **debris-flow hazard assessments for burned areas** as a free map service with no key. I measured
   765 assessments, 100 of them for fires that started in 2026, including the Norte fire in Orange County and the
   2025 Eaton fire, both of which the app already knows (D1). NOAA's **smoke forecast** is also a free map
   service (D3), and the rain forecast that links a storm to river floods is too (D2).
3. **The question most people have is "what about my place?"** A place page that lists official alerts first,
   and keeps saved places only in the browser, is the most valuable public feature and the one with the most
   wording risk (C1).
4. **The wow items are cheap because the parts exist**: a before/after swipe (B2), a fly-through along the river
   (F1), the sun where it really was at the event time (F4), and the globe intro page you asked for in brief 4
   (J1). The globe needs the design file `Intro.dc.html`, which is not in the repository.
5. **Three things I advise against** (section 6): anything that reads as evacuation advice (countdowns, routes,
   "nearest shelter"), one combined risk score or traffic-light colour for a place, and push alerts from a
   research prototype.
6. **One finding needs your decision before smoke is built**: EPA's AirNow rules require its own colours and
   words, and its first class is "Good" in green. The app has so far avoided anything that looks like an
   all-clear (section 4, card S6, and question 4).

My top 8 by value for effort are in section 7: **A1, E2 (link part), I1, G2, D1, D3, B3, C1**, about 35 build
hours in three small slices.

## Words used here (plain)

| Word | Meaning |
|---|---|
| **Ensemble, run, member** | The same forecast made many times with slightly different weather. Each one is a *run* (or *member*). The app's fire forecast has 31 or 51 runs. |
| **Fan, band** | On a chart, the shaded area between a low and a high run. It gets wider further into the future. |
| **Spaghetti** | Many model lines drawn together, for example many possible storm tracks. |
| **Odds** | A chance said as a count: "9 of 31 runs", not "29 %". |
| **Burn scar** | Land that burned recently. Rain runs off it fast, so floods and debris flows are more likely there for a few years. |
| **Debris flow** | A fast flood of mud, rocks and burned wood down a steep channel. |
| **Design storm** | A made-up rainstorm of a stated strength, used to test "what if it rains this hard". It is not a rain forecast. |
| **AQI** | Air Quality Index: EPA's 0-500 scale for air pollution, with fixed names and colours for each class. |
| **Provenance** | Where a piece of data came from: who made it, when, and how. |
| **Swipe** | A divider you drag across the map to compare two pictures of the same place. |
| **Cross-section** | A side view of the ground along a line, as if the land were cut with a knife. |
| **Palette (keyboard)** | A small search box, opened with a key press, that runs commands ("turn on floodplain"). |
| **PWA** | A web page that can be installed like an app and can open without a connection. |
| **Build hours** | Hours of agent build time. A typical role in `docs/redesign/reports/*.json` took 1-2 hours. An independent review and its fixes add about a third. |

## 1. What I saw in the app today

Good, and worth keeping in every new screen:

- **One visual language**: grey glass panels, one accent orange, hazard colours only on hazards, mono numbers,
  "value — LABEL" rows, leader-line labels (HANDOFF.md).
- **Honest labels are already everywhere**: OFFICIAL, MODEL, EXPERIMENTAL, Stale tags, ages ("7 d ago"), "no view
  of 53 % of the area", "Unknown, not dry", and the two fixed lines on every view.
- **Time is real**: flood steps go from satellite pass to pass and never invent water in between.

Gaps a newcomer would feel (each has an idea below):

| What I saw | Where | Idea |
|---|---|---|
| A model chance is a sentence only ("0 of 31 simulated fires reached here"); nothing to look at | Command readout, point card | A1 |
| Many small labels with no way to ask "what is this?": isochrones, FBFM40, dNBR, FFWI, ROS, FRP, flow in ft³/s | Command and Forensic | G2 |
| The top-right status shows one source's age; the ages of the others are spread over panels | every view | I1 |
| "Fires" or "Floods": one hazard at a time, no link between a fire and the floods on its burn scar | national map | D1, D2 |
| A step chosen in Command is lost after a trip through Public (known issue 8); flood links carry no time | links | E2 |
| No measuring, drawing or export | Command | E1, E2 |
| Real flat floods still look flat in 3D (known issue 1) | Forensic flood | F2 |
| On a 390 px phone the first frame shows the whole hemisphere and the lower 48 fill about a quarter of the screen; groups overlap ("805 FIRES" over "68 FIRES") | `brief6-final-phone-overview-fires.png` | H4 |
| On a phone in Command the map controls wrap into two rows over the map and "LIVE" floats alone | `brief6-final-phone-command-playback.png` | H4 |
| No language other than English; no installable or offline mode; no text summary of the map | everywhere | H2, H3, H4 |
| (For balance: the Public flood view on a phone already works well, with its facts in a bottom sheet) | `brief5-final-phone-public-flood.png` | keep |
| Search has no suggestions; Forensic has no fire search (BRIEF-4 "Later") | search box | C2 |

## 2. Ground rules for every idea

These come from `CLAUDE.md`, HANDOFF.md and the briefs. Every idea below was written to fit them.

**Safety wording**

- Model output is experimental and never advice on when to leave. No countdowns, no "you have until".
- Never the two banned phrases of `CLAUDE.md`. Missing data is "unknown". "0 of 31 runs" is not an all-clear.
- Official information keeps its issuer, its own times, its exact words and a link, inside a `data-verbatim`
  element. It is never merged with model output, never recoloured into our own scale, never summarised in its
  place.
- Every new view keeps "Research prototype — not for operational use" and "Not an all-clear. Follow local
  officials."
- Every animation stops under `prefers-reduced-motion`; nothing plays by itself.
- Model output stays out of the Public view (decisions of briefs 4 and 5).

**Design**

- Inter for text, JetBrains Mono for numbers and small caps labels; greys plus hazard colour; no new accent.
- Each new layer needs its colour token agreed in `CONTRACT.md` and mirrored in TypeScript, as in sections 15.1
  and 16.13.
- **No green for anything of ours.** Green reads as an all-clear. Where an issuer's own scale contains green
  (EPA's AQI "Good"), it is shown only as that issuer's scale, labelled as theirs (question 4).
- A new control goes where its family already lives: layers in Layers & settings, time on the timeline, facts in
  "value — LABEL" rows, official text in "Official now".

**Privacy**

- Location stays in the browser until the user acts (as today). Saved places, last-visit time, tour flags and
  sketches are kept in the browser only, never in a link and never in an export.

## 3. The ideas

Thirty ideas in ten groups. Each has: the pitch, what you see, the data (free and official only), the safety
wording it needs, the effort in build hours, a wow-versus-risk note, and what it means for the app.
Verdict words: **build first**, **build**, **build with care**, **needs your decision**, **later**.

### (a) Understanding uncertainty

#### A1. Odds you can count. **Build first.**

- **Pitch.** Show a model chance as dots you can count, "9 of 31 runs", instead of "29 %".
- **What you see.** In the Command readout and the point card's model part: a row of 31 small dots (51 for the
  ECMWF ensemble), 9 of them filled in the modeled amber, and the sentence the app already uses ("In the
  experimental model, 9 of 31 simulated fires reached here by Thu 15:00 (72 h)."). Three stops under it, "+24 h ·
  +48 h · +72 h", refill the dots. Forensic's hover readout gets the same strip. Floods get no dots (the app has no
  flood ensemble). For storms, NHC's own wind chance for a place is shown as NHC's number, never as our dots.
- **Data.** Nothing new: the forecast's `burn_probability` layer and member count. The bundle keeps three
  arrival-time layers (10 %, 50 %, 90 % of runs), not every run, so counts before the end time are "about 9 of 31"
  unless two small count layers (+24 h, +48 h) are added.
- **Safety wording.** Keep "Not a safety guarantee." At zero: "0 of 31 runs reached here. Not an all-clear: the
  model does not simulate firefighting or embers, and outside the modeled area nothing is known." Amber dots on
  grey only: no green, no tick mark. Not in Public.
- **Effort.** 2 h (2.5 h with the two count layers).
- **Wow versus risk.** Modest wow, high value: counts are easier to grasp than percentages. Small risk: dots look
  exact, so the member count and "experimental" stay beside them.
- **For the app.** The plainest answer to "how sure is the model here?" on the screen where people ask it.

#### A2. Fans that say their own width. **Build.**

- **Pitch.** Every forecast band comes with one sentence that says how wide it is.
- **What you see.** Forensic's area chart already draws the 10 %-90 % band. Command's slim timeline gets the same
  widening wedge in place of the dashed line, and one sentence written by code: "By Thu 13:30: middle run 9,400 ac;
  8 in 10 runs between 7,100 and 12,800 ac." For rivers, the NWS forecast is one official line and gets **no band
  of ours**. Instead a switch "Earlier NWS forecasts" draws the forecasts issued before as faint lines, so you see
  how the forecast moved.
- **Data.** Fires: `forecast.json` already holds `area_acres_p10`, `_p50`, `_p90` (SPEC section 5). Rivers: the
  app does not keep river forecasts for past dates (README, Known limits), so a small recorder must save each new
  NWS forecast from now on. NOAA's river model gave no multi-run series for the one reach I tried (section 10).
- **Safety wording.** "Range of model runs, not the range of what can happen." Official lines never get a band,
  a tint or an average of ours.
- **Effort.** 3 h (fire wedge and sentence 1.5 h; river recorder and faint lines 1.5 h).
- **Wow versus risk.** Medium wow. Risk: a band reads as a promise. Once the scorecard exists
  (`benchmark-validation.md` 5.2) the sentence can add "in tests the truth fell inside this band in X of Y
  forecasts".
- **For the app.** Bands become readable without knowing what a percentile is.

#### A3. Spaghetti tracks you can untangle. **Build with the hurricane slice.**

- **Pitch.** Many model storm tracks under the official one, drawn so the eye is not led by the wildest line.
- **What you see.** As planned in `hurricanes.md` 5.2 and its role H6: thin muted lines under NHC's track, off by
  default, Command and Forensic only. My additions: lines grouped and coloured by owner ("NOAA models", "NOAA AI
  models", "ECMWF models", "Consensus"); hovering one line lights it and names its model and owner; a "thin out"
  switch shows one line per family; a "density" switch replaces lines with a soft shade where many tracks pass.
  Line patterns differ as well as colours (H1).
- **Data.** NHC's public model file and NOAA's tracker folders (`hurricanes.md` 3.2). The Google DeepMind rows in
  that file stay filtered unless you change the rule (section 5).
- **Safety wording.** From `hurricanes.md`: "Model guidance: experimental computer output, not a forecast for
  your place. The official forecast is NHC's." No count of "tracks that hit" a named town.
- **Effort.** +1 h on top of H6 (2.5 h).
- **Wow versus risk.** High wow. Risks: one outlier line draws the eye; strands read as a forecast for a town.
- **For the app.** The classic picture of forecast uncertainty, with the official track always on top.

#### A4. "Runs close together / runs spread out" badge. **Build with care.**

- **Pitch.** A three-word badge on each model layer that says whether the runs tell one story or several.
- **What you see.** Next to a model layer's name and in the readout, one of: "Runs close together", "Runs spread
  out", "Weather models differ". A tap shows what was compared (the 31 GFS runs, or the GFS-driven run against the
  ECMWF-driven run), the two numbers, and the fixed sentence "Agreement is not accuracy: models can agree and
  still be wrong."
- **Data.** Existing: the ratio of the 90 % and 10 % area, and a second forecast with the other ensemble (the app
  can already run `gfs025` or `ecmwf_ifs025`; SPEC section 6). ECMWF's AI model adds a third opinion
  (`ai-weather.md`, first step). WeatherNext only after a rule change.
- **Safety wording.** Never "confident", "reliable" or "certain". Never green. Not in Public, and never beside an
  evacuation row. The thresholds are fixed numbers in `CONTRACT.md`, with tests.
- **Effort.** 3 h (badge, rules and tests 1.5 h; second run and comparison 1.5 h). The second run doubles a 2-30 s
  forecast.
- **Wow versus risk.** Medium wow. Main risk: "close together" is read as "right". The sentence and a link to the
  scorecard answer that.
- **For the app.** Teaches the main lesson of ensembles in three words.

#### A5. Unknown is drawn, not blank. **Build.**

- **Pitch.** One pattern for "we do not know", and one button that lists what is unknown in this view.
- **What you see.** The same fine grey pattern wherever knowledge stops: outside the modeled area, where clouds hid
  the satellite, along rivers with no gauge, and (with the evacuation layer on) over states with no evacuation
  feed. In the legend, "What is unknown here?" opens a short list in words: "No river gauge in this flood ·
  Clouds hid 61 % of the newest image · Evacuation zones are not available in Louisiana · No flood model in this
  app."
- **Data.** Existing: each layer's `status`, the no-view share of a pass, the list of states with a feed.
- **Safety wording.** This is the rule "Unknown, not low" made visible. The list ends with the fixed
  all-clear line.
- **Effort.** 2.5 h.
- **Wow versus risk.** Low wow, high value. Risk: more grey on the map, so the pattern stays faint.
- **For the app.** The map stops implying that empty means fine.

### (b) Time

#### B1. Time machine: a shelf of past events. **Build.**

- **Pitch.** A door to past fires, floods and storms, each saying honestly what can be replayed.
- **What you see.** "Past events" on the national map: a year ribbon (2024-2026) and a shelf of well-recorded
  events with a small map picture and chips for what exists: Perimeters · Satellite detections · NWS warnings
  (archived copy) · Satellite passes · Storm advisories. Opening one puts the view in a clear "PAST · Jan 8, 2025"
  frame, sets the timeline to the start and offers Play.
- **Data.** The app's lists (fires 2025 and 2026; floods 2025 and 2026), the Iowa Environmental Mesonet archive
  of NWS products (in use), NHC's archive for storms (`hurricanes.md` section 2). For older burn scars as
  background only: NIFC's perimeter history (measured: 95,677 outlines with a fire year after 1900) and MTBS
  (measured: layers up to "2026 Burned Area Boundaries"); card S11.
- **Honest limits to state on each card.** A past flood replays warnings, measured river levels and satellite
  passes only: NWS forecast maps, the river model and river forecasts are not kept for past dates, and 3D data is
  prepared for current floods only (README).
- **Safety wording.** Every archived item is tagged "Archived copy" with the archive's name. A past view never
  says "In effect" (the brief-4 rule: "Was in effect"). A banner reads "Past event: nothing here describes today."
- **Effort.** 4 h (shelf, list and pictures 2.5 h; "what can be replayed" chips 1 h; tests 0.5 h). The storm part
  comes with the hurricane slice.
- **Wow versus risk.** High for learning and demos. Risk: a past view mistaken for now; the frame and banner
  answer it.
- **For the app.** The replays that already exist become easy to find, and off-season demos become possible.

#### B2. Before / after swipe. **Build.**

- **Pitch.** Drag a divider across the map: before on the left, after on the right.
- **What you see.** Fire: the aerial photo from before (USGS / NAIP, June 2024 or earlier) against the newest
  satellite image after the fire. Flood: one satellite pass against another, or the dry aerial photo against a
  pass. Where NOAA flew a plane after a disaster: NOAA's aerial photos against the earlier photo. Each side has a
  header: "BEFORE · USDA NAIP · Jun 2024" | "AFTER · Sentinel-2 · Jan 16, 2025 · 12 % cloud". The divider also
  moves with the arrow keys.
- **Data.** Existing sources (USGS imagery, NASA GIBS Landsat/HLS, Sentinel-2, the flood passes). New and
  optional: NOAA NGS Emergency Response Imagery (card S10): its index lists "California Fire (2025)", "Texas
  Flooding (2025)", Helene and Milton (2024) and "Hurricane Isaias (2026)".
- **Safety wording.** "Pictures only. Not a damage assessment." Clouds and smoke can hide the ground. No automatic
  "destroyed" labels (`ai-mapping-llm.md` 1.9 advises against building-damage AI).
- **Effort.** 3 h; +1.5 h for the NOAA aerial photos.
- **Wow versus risk.** High wow for little work. Risk: people will look for their own home in a picture of loss;
  the app shows the picture and its date and says nothing more about a building.
- **For the app.** The most direct way to see what an event did, built only from pictures the app already fetches.

#### B3. What changed since yesterday. **Build first.**

- **Pitch.** A short list of what is different from the last check, written by code, each line linked to its
  source.
- **What you see.** On the national map and inside each event, a card "Since yesterday 09:00" (or "since your
  last visit", a time kept in the browser): "New: 4 fires listed · McCully: +2,100 ac (NIFC, updated 06:12) ·
  Hagen: 40 → 65 % contained (CAL FIRE) · NWS: 3 Flood Warnings issued, 2 ended · Peace River: Moderate → Major
  (NWS category) · New satellite pass (Nov 3) · Model re-run 06:40". Each line opens its row.
- **Data.** The app's own snapshots. CAL FIRE changes are already recorded. NIFC records, NWS products and gauge
  categories need a small daily recorder (README: "Records outside California have no change history yet").
- **Safety wording.** "Changes Disaster Mapping saw between two checks. A fire or flood not listed here is not an
  all-clear." Official changes keep the issuer and its own time; the recorder's time is labelled "seen by
  Disaster Mapping at".
- **Effort.** 4 h (recorder 1.5 h, difference rules 1 h, card 1 h, tests 0.5 h). No AI needed. The AI-written
  digest of `ai-mapping-llm.md` 3.2 can sit on top later.
- **Wow versus risk.** Medium wow, high value for anyone who opens the app daily. Small risk: a missed check
  looks like "no change", so the card states both check times.
- **For the app.** It answers the returning user's first question without reading every panel again.

### (c) Place-centred

#### C1. "My place", with saved places kept only in the browser. **Build with care.**

- **Pitch.** One page for one address: every official alert in effect there first, then what is nearby, with
  model output last.
- **What you see.** A page titled with the name you gave ("Home"), a small map with a 25-mile ring, then fixed
  sections in this order: (1) **Official alerts in effect here** (NWS products of every kind, the evacuation zone
  status where a state feed exists, local officials' messages), word for word; (2) **Listed events nearby**:
  fires, floods and storms with distance and direction; (3) **Measured**: nearest river gauges, the newest
  satellite pass; (4) **Background maps at this point**: FEMA flood zone, a USGS debris-flow basin (D1), the
  drought class (D4), the smoke forecast (D3); (5) **Experimental model output**, collapsed; (6) **What is unknown
  here** (A5). Up to 8 saved places sit in a small list: stored in this browser only, named by you, with "Forget
  this place" and "Forget all".
- **Data.** Existing routes for alerts, gauges, evacuation zones, lists and the state/county of a point
  (`code-integration.md` section G describes the files). Optional: the NWS point forecast (official; it would
  send the rounded point to NWS: question 3).
- **Safety wording.** No combined score, no colour for the place, no "your place is …" sentence. The empty case
  reads: "No official alert is in effect at this point right now (NWS, checked 14:02). Not an all-clear. Follow
  local officials." No notifications. The page says where the point is sent: to your own backend; from there
  only to the services named on the page.
- **Effort.** 7.5 h (place page 5.5 h, as estimated in `code-integration.md` G; saved places 2 h).
- **Wow versus risk.** Medium wow, the highest public value, and the highest wording risk: this screen invites
  "am I OK?" more than any other. Most of the work is wording and tests.
- **For the app.** The question people actually bring gets one screen, with officials first.

#### C2. One search everywhere: suggestions, Forensic search, and a keyboard palette. **Build.**

- **Pitch.** Type two letters and pick from fires, floods, storms, towns, ZIP codes and counties; press Ctrl-K
  (⌘K) to run a command.
- **What you see.** Suggestions grouped by kind under the search pill, with keyboard control. The same box in
  Forensic, which BRIEF-4 left for later ("search for a fire, or pick a state"). As a palette it also lists
  commands: "Go to Command", "Turn on FEMA floodplain", "Copy link", "North up", "Measure".
- **Data.** Local only: the app's own lists and the Census index it already ships. Nothing leaves the machine
  while you type. A street address is still sent to the Census geocoder only when you submit it.
- **Safety wording.** "No listed fire matches" is not an all-clear. The contract sentence "no autocomplete" must
  be changed on purpose (`code-integration.md` H): it was about not sending keystrokes outside, which stays true.
- **Effort.** 5 h (suggestions and Forensic search 3 h; palette 2 h).
- **Wow versus risk.** Low wow, daily value. Almost no risk.
- **For the app.** Two of the three BRIEF-4 "Later" items are closed, and every command gains a keyboard path.

### (d) Cross-hazard links (what only a multi-hazard app can show)

#### D1. After the fire: debris flows and floods on the burn scar. **Build first.**

- **Pitch.** When a fire is out, show what the USGS says about mud and debris flows from its slopes, and tie
  flood warnings to the burn scar they name.
- **What you see.** On a fire (Command and Forensic; one fact row in Public): a layer "USGS debris-flow hazard
  assessment" when the USGS has one for that fire. Basins and stream segments are coloured by USGS's likelihood
  class, with the design storm in words, the assessment date, and links to the USGS page and download. In 3D the
  basins lie on the terrain, where steep burned slopes above houses are easy to see. On a flood: when NWS's own
  text names a burn scar, a chip quotes it and links to the fire. On the national map: "Burn scars with a USGS
  assessment".
- **Data.** USGS map service, no key (card S1). Measured today: 765 assessments, 100 for fires that started in
  2026; "Norte, Orange County" started Oct 16 and was assessed Oct 26, 2026; "Eaton" has one from Jan 19, 2025.
  Both are fires the app already has, so there are ready test cases. NWS flash flood products: the existing route
  (card S2). Older outlines: NIFC history and MTBS (card S11).
- **Safety wording.** USGS's combined class is named "Low / Moderate / High" in its legend. The app never uses
  the first of those words as its own: it shows USGS's likelihood class ("20-40 %") and volume class, and shows
  the combined class only as USGS's word, quoted with its issuer (question 5). Fixed lines: "USGS estimate for
  one design storm (USGS label: 24mm). Real storms differ." "Basins without colour were not assessed: unknown."
  "Flash flood and debris-flow warnings come from the NWS." Nothing here draws or implies an evacuation area.
- **Effort.** 5 h (reader and fire-to-assessment matching 2 h; 2D layer, key and fact row 1.5 h; burn-scar chip
  on floods 1 h; 3D drape 0.5 h).
- **Wow versus risk.** High wow, and it is the clearest "only a multi-hazard app" feature. It is timely: in
  California the rains follow the fire season. Risks: matching the wrong assessment (fire names repeat, so match
  by place and start date too), and the class word above.
- **For the app.** A fire's story no longer ends at "contained"; the same place carries on into the flood view.

#### D2. From storm to rain to rivers. **Build (first part now, the rest with hurricanes).**

- **Pitch.** Three official steps in a row: the storm, the rain forecast, the rivers forecast to flood.
- **What you see.** A strip on a storm or flood view: "1 Storm: NHC Advisory 12 → 2 Rain: WPC forecast for the
  next 3 days, WPC Excessive Rainfall Outlook → 3 Rivers: 4 gauges forecast to reach flood stage (NWS), with
  crest dates". Each step names its issuer and time, and a click turns on its layer. Without a storm it still
  works for any big rain: the two WPC layers can be turned on in the flood views.
- **Data.** WPC rainfall forecast and Excessive Rainfall Outlook, days 1-5 (NOAA map services, measured; card
  S9); river forecasts (in the app); storms and the flood link (`hurricanes.md` 5.4).
- **Safety wording.** WPC's outlook classes are WPC's words, quoted. No sentence of ours says a storm "will
  flood" a place. The link label is the one `hurricanes.md` proposes: "Linked by place and time, not by NWS."
- **Effort.** 1.5 h for the WPC layers on flood views now; +2 h for the strip once storms exist.
- **Wow versus risk.** Medium-high wow. Risk: a chain looks like certainty, so each step keeps "forecast" and its
  date.
- **For the app.** Shows why a hurricane belongs in the same app as river floods.

#### D3. Where the smoke goes. **Build first (forecast and satellite outlines); AirNow needs your decision.**

- **Pitch.** A fire's smoke reaches far more people than its flames: show NOAA's smoke forecast and the smoke
  seen from space today.
- **What you see.** (a) A layer "Smoke forecast (NOAA)" that follows the timeline hour by hour for the next two
  days. (b) "Smoke seen by satellite today": outlines drawn by NOAA analysts, in three densities. (c) If you
  approve: AQI readings at official monitors, in EPA's own colours and words, labelled preliminary. (d) In
  Public, one fact row: "Smoke: NOAA's forecast shows smoke over this area this afternoon", with a link to
  AirNow's own Fire and Smoke Map for health guidance.
- **Data.** (a) NOAA's surface-smoke forecast image service: measured today, hourly frames from Nov 10 03:00 to
  Nov 12 06:00 UTC, no key (card S3). (b) NOAA HMS smoke outlines: measured, files for Nov 6-10 present, archive
  folders for 2005-2026 (card S5). (c) EPA AirNow: its public file answered without a key, but its rules need
  care (card S6). Later, sharper: the smoke fields of NOAA's 3 km HRRR model are in its public bucket (measured in
  today's file index; card S4).
- **Safety wording.** "Smoke forecast: NOAA model guidance." "Smoke seen from space can be high above the ground;
  clouds can hide it." AQI words and colours are EPA's and its partner agencies', unchanged. The app never says
  the air is fine. Health guidance is a link to AirNow, not text of ours.
- **Effort.** 4 h for (a), (b) and (d); +2 h for (c).
- **Wow versus risk.** High wow. Risk: EPA's first AQI class is "Good" in green, which the app's own design
  avoids; and EPA asks data users to make their use known to AirNow (question 4).
- **For the app.** The first layer that matters to people far from the fire.

#### D4. Drought and dry-fuel context. **Build.**

- **Pitch.** A small "why now?" card: how dry the land is and what the fire-weather forecasters expect.
- **What you see.** On a fire (Command and Forensic; one row in Public): the U.S. Drought Monitor class at the
  fire with the map's date; the Storm Prediction Center's Fire Weather Outlook for today to day 8, in SPC's own
  words; and the app's own modeled fuel moisture (already in Forensic's weather card), labelled model. On the
  national map, each can be turned on as a layer.
- **Data.** U.S. Drought Monitor current GeoJSON (measured: 16.4 MB, so the backend should simplify it once a
  week; card S7). SPC Fire Weather Outlooks (measured: 24 layers for days 1-8; card S8).
- **Safety wording.** "The Drought Monitor is a weekly, broad map. It is not a fire forecast." SPC's classes are
  quoted. Official outlooks and our modeled fuel moisture sit in separate blocks.
- **Effort.** 3 h.
- **Wow versus risk.** Low-medium wow; good teaching value; little risk.
- **For the app.** Explains why a fire spreads the way it does, with official context beside the model.

### (e) Command tools

#### E1. Measure and sketch. **Build.**

- **Pitch.** Measure a distance or an area; draw a line, a shape or a note on the map.
- **What you see.** Measure: click points to get distance (miles or km), bearing and area. Sketch: lines, shapes
  and text notes on the 2D map, kept in the browser for that event, downloadable as a GeoJSON file, and shown in
  Forensic too (Forensic already keeps notes in the browser).
- **Data.** None. The app's geodesy helpers already exist (`web/src/lib/geodesy.ts`).
- **Safety wording.** A distance says what it measures ("to the mapped edge, as of Oct 22, 07:59"). Sketches are
  dashed white and tagged "User sketch · not official"; they never use the colours of official zones. The tool
  does not turn a distance into a time.
- **Effort.** 5 h (measure 2 h, sketch 3 h).
- **Wow versus risk.** Low wow, expected by any Command user. Low risk.
- **For the app.** Command becomes a place to work, not only to read.

#### E2. Share: exact-view links and a one-page briefing. **Link: build first. Briefing: build with care.**

- **Pitch.** A link that reopens exactly this view at this time, and a one-page sheet you can print.
- **What you see.** (a) **Link.** "Copy link" keeps the hazard, the event, the view, the camera, the basemap, the
  layers, the selected point, the time, the flood step and the forecast run. Opening it shows a banner: "Shared
  view: Nov 5, 14:00 EST. Data may have changed. Go to now." It never holds your location or saved places.
  (b) **Briefing.** "Export briefing" in Command makes one page (through the browser's Print, so no new package):
  event, time and zone; the map with scale and north arrow; "Official now" word for word with issuer, times and
  the link as text; measured facts; the model in its own box with "experimental" and its receipt (run, weather,
  members); data ages; credits; the two fixed lines at the foot.
- **Data.** None. Today `?t=` exists for fires only and a flood's step is not in the link (CONTRACT 16.1; known
  issue 8).
- **Safety wording.** A sheet travels without the app, so it carries its time ("valid as of"), both fixed lines,
  and "Check the live sources after …". It must not look official: no agency logos, title "Disaster Mapping
  research prototype briefing". Camera pictures are left out (ALERTCalifornia's licence allows no derivatives).
  FEMA's notice is printed when archived alerts are shown.
- **Effort.** 6.5 h (link 2.5 h, briefing 4 h).
- **Wow versus risk.** Medium wow. The link has almost no risk. The briefing's risk is a stale sheet being passed
  on, which the "valid as of" line addresses.
- **For the app.** What you see can be handed to someone else without losing its time or its labels.

#### E3. Two models side by side. **Build with the AI-weather step.**

- **Pitch.** Split the map in two, one model on each side, with the cameras locked together.
- **What you see.** Left "GFS · 31 runs", right "ECMWF · 51 runs" (both exist today), later "ECMWF AIFS (AI)". A
  third mode, "Difference", marks where one model says at least half its runs and the other fewer than one in
  ten. Under each side: its A2 sentence and A4 badge. For floods, the NWS forecast area (official, with its badge)
  against NOAA's river model stays visibly "official" against "model".
- **Data.** Two existing forecasts; the AI model per `ai-weather.md`. `code-integration.md` section B lists the
  files.
- **Safety wording.** Both sides say experimental. No "better" label unless the scorecard shows it on the same
  cases (`benchmark-validation.md` 5.7).
- **Effort.** 5.5 h (as estimated in `code-integration.md` B).
- **Wow versus risk.** High wow in Command and Forensic. Risks: two maps double the graphics load; a difference
  is read as an error bar.
- **For the app.** The honest way to show an AI model: beside the physics model, not instead of it.

### (f) Forensic 3D

#### F1. Fly-through along a river or a fire front. **Build.**

- **Pitch.** Let the camera travel down the river, or along the fire's edge, at eye level.
- **What you see.** "Fly the river": from the upstream end of the flood to the downstream end at a fixed height,
  with gauges and warning areas passing by and a scrubber in river miles. "Fly the front": along the fire's active
  edge, or from the ignition point to the head as time runs. Pausing gives back the normal controls. With reduced
  motion there is no flight: six still "stations" with Next and Back.
- **Data.** In the bundles: the river lines (`maps/flowlines.geojson`), the arrival-time layers. Nothing new.
- **Safety wording.** A flight never starts by itself. The time and the "Height ×10" label stay on screen during
  it.
- **Effort.** 3.5 h.
- **Wow versus risk.** High wow, good for demos. Risks: motion discomfort (a speed limit and the still stations);
  frame rate was never measured on a real graphics card in the cloud sessions.
- **For the app.** Makes the 3D view worth opening for someone who is not an analyst.

#### F2. Cross-sections. **Build.**

- **Pitch.** Cut the valley with a line and see the ground, the estimated water and the river level from the
  side.
- **What you see.** Draw a line (or pick "Across the river here"): a panel shows the ground profile, the
  estimated water surface where water was mapped, the height above the river, and marks for the NWS flood levels
  when a gauge sits on the line. For fires, the existing elevation-profile chart gains slope and arrival-time
  colours.
- **Data.** In the bundles: terrain, the depth estimates, the height above the river, gauges. Nothing new.
- **Safety wording.** The existing lines: "Estimated depth (from the terrain at the water's edge), experimental";
  water is drawn only where it was mapped; the ends say "unmapped beyond here: unknown".
- **Effort.** 3.5 h.
- **Wow versus risk.** Medium wow, high value: it answers known issue 1 ("real flat floods still look fairly
  flat in 3D"), because 1.5 m of water on a plain is obvious from the side. Risk: a gauge's stage and the
  terrain's height use different zero points; unless the gauge's zero height is known, the stage is drawn as its
  own bar, not on the terrain's scale.
- **For the app.** The flat-flood problem of brief 6 gets a view that works on flat land.

#### F3. Storm surge on terrain. **Build after the first hurricane slice.**

- **Pitch.** NHC's surge map laid on the coast in 3D, with a door and a person for scale.
- **What you see.** As `hurricanes.md` 5.3 and its role H8 describe: NHC's flooding classes on the coastal
  terrain with brief 6's height boost and a stepped water sheet at each class's lower bound. My additions: a
  door-height and a person-height mark beside the water, and the title always on screen.
- **Data.** NHC Potential Storm Surge Flooding Map (official; `hurricanes.md` 1f: use with care).
- **Safety wording.** From `hurricanes.md` section 8: "reasonable worst case", not a prediction and not the whole
  flood; a place without colour is not an all-clear; never a zone or an order derived from it.
- **Effort.** 4-5 h (the estimate of `hurricanes.md` H8).
- **Wow versus risk.** The highest wow in 3D. Risk: a worst case shown this vividly reads as a forecast.
- **For the app.** It is what makes hurricanes worth a Forensic view.

#### F4. Sun and shadow at the event time. **Build.**

- **Pitch.** Put the sun where it really was at that hour, so slopes are lit as they were; at night the fire
  glows.
- **What you see.** A switch "Light: Studio | Time of day". With "Time of day" the sun follows the timeline, and a
  small dial reads "Sun 14° above the horizon, WSW". At night the terrain is dark and the observed fire front
  glows.
- **Data.** None: the sun's position comes from the date, time and place by a standard formula (about 40 lines,
  no package). Today the sun sits at fixed angles per visual style (`web/src/scene/look.ts`: 252°/25°, 284°/18°,
  300°/38°).
- **Safety wording.** "Lighting only: shadows are not smoke or burned ground." Studio light stays the default so
  no layer is hidden by darkness.
- **Effort.** 2.5 h.
- **Wow versus risk.** High wow for the cost. Risk: a night scene hides layers; labels must stay readable.
- **For the app.** A small touch that makes a replay feel like the real afternoon it was.

### (g) Onboarding and learning

#### G1. Guided tour and demo mode. **Build.**

- **Pitch.** Five steps that show a newcomer around, on made-up data that is clearly marked.
- **What you see.** On a first visit: a five-step tour, skippable and replayable from the menu: the map and the
  hazard switch; opening an event; official, measured and model; time; "what this app cannot tell you". "Try the
  demo" opens the synthetic fire or flood ("Demo · simulated data"), so the tour works on a fresh install with no
  prepared data. Each view has "Show me around" with three hints.
- **Data.** The fixtures that exist (`fixture-live`, `fixture-flood`). They are generated by a script today
  (question 11); the demo flood needs a second script for its time steps (known issue 11).
- **Safety wording.** Demo data is marked on every panel, as now. Step five states the limits in plain words.
- **Effort.** 4 h (tour without a library 2 h, steps 1 h, demo door 1 h).
- **Wow versus risk.** Medium wow. Risk: tours annoy; one press skips it for good.
- **For the app.** A first-time visitor understands the three kinds of information before reading a number.

#### G2. Glossary and "how to read this map" cards. **Build first.**

- **Pitch.** Every hard word can be tapped, and every layer can explain itself in three lines.
- **What you see.** (a) Terms with a dotted underline open a two-line meaning and a link to the official
  definition; a glossary page lists about 60 (the README's table of 20 is the seed; `ai-mapping-llm.md` 3.2
  estimates 2 h). (b) Each legend row has an "i" card with three fixed lines: **Is · Is not · How old.** Example:
  "Water seen by satellite. Is: water a satellite mapped on Oct 29. Is not: all the flood water (clouds and trees
  hide water, and the river's normal water is included). How old: NASA lists a pass 2 to 4 days after it was
  taken."
- **Data.** None: fixed text, read by a person before release.
- **Safety wording.** Definitions never give advice. "Warning" and "Watch" quote the NWS.
- **Effort.** 4.5 h (glossary 2 h, cards 2.5 h).
- **Wow versus risk.** Low wow, very high value: you told us you are new to this science, and so is most of the
  public. No risk beyond keeping the text true.
- **For the app.** The app teaches while it shows.

### (h) Accessibility and reach

#### H1. Colour-blind check and pattern-first layers. **Build.**

- **Pitch.** Make sure no meaning depends on telling orange from amber or orange from red.
- **What you see.** (a) A test simulates the three common kinds of colour blindness on the palette and lists the
  pairs that merge. From the tokens, likely pairs are fire orange `#ff6a2a`, modeled amber `#f5c060` and stale
  amber `#e8b04a`, and NWS minor `#ff9a3c` against moderate `#ff4d4d` (**not computed today**). (b) The fix is a
  second cue, not new colours: hatching for model (exists), a solid outline and badge for official, letters or
  pips on gauge diamonds, direct labels. (c) A "High contrast" switch for the app's own colours and small grey
  labels.
- **Data.** None.
- **Safety wording.** Official scales keep their issuer's colours and gain a label or shape. Nothing of ours is
  green.
- **Effort.** 3.5 h.
- **Wow versus risk.** Low wow, real reach (roughly 1 man in 12 has a colour-vision difference; from general
  knowledge, not checked today). Risk: none.
- **For the app.** The official / model split, the app's main promise, stays readable for everyone.

#### H2. Screen-reader summaries. **Build.**

- **Pitch.** A text version of what the map shows, written by code from the same facts.
- **What you see (or hear).** A "Map summary" region in each view, also behind a "Describe this view" button:
  "Calcasieu River flood, Louisiana. NWS Flood Warning in effect until Nov 6, 6 PM CST, issued by NWS Lake
  Charles. No river gauge in this flood. Water seen by satellite on Oct 29, 7 days ago; 61 % of the area was
  hidden." Also: every marker reachable as a list item, timeline steps announced ("Step 3 of 4: satellite pass
  Oct 29"), and a focus-order check.
- **Data.** None. No AI: the same fixed strings as the panels.
- **Safety wording.** Official text is read as issued, issuer first. The summary ends with the two fixed lines.
- **Effort.** 3 h.
- **Wow versus risk.** Low wow, high reach. It also gives E2's briefing its text, and it is the "facts packet" an
  AI explanation would need (`ai-mapping-llm.md` 3.2).
- **For the app.** A map app that can be used without seeing the map.

#### H3. Spanish. **Needs your decision (a fluent reviewer).**

- **Pitch.** The app's own words in Spanish; official text stays as issued, with a link to the official Spanish
  version where one exists.
- **What you see.** A switch "EN | ES" for labels, captions, the two fixed lines, the glossary and the cards.
  Official text stays in English under "Texto oficial en inglés", with a link to NWS's own Spanish product when
  there is one.
- **Data.** None needed. Read today: NWS's translation site is labelled "Experimental - Not for operational use"
  and draws on "a limited number of NWS Forecast Offices", so there is no nationwide official Spanish warning
  text to rely on (card S13).
- **Safety wording.** No machine translation of official text (`ai-mapping-llm.md` 3.1 F). Every safety sentence
  is checked by a fluent speaker before release, and the wording tests gain the Spanish forms of the banned
  phrases.
- **Effort.** 7 h plus a reviewer's time (a string layer without a library 3 h, since strings live in several
  web and backend files; translation and review notes 3 h; tests 1 h).
- **Wow versus risk.** High reach. Risk: a wrong safety sentence in Spanish is worse than none.
- **For the app.** Reaches many US residents the English-only app does not, if the review is done properly.

#### H4. Phone polish and an offline-friendly install. **Polish: build. Install: needs your decision.**

- **Pitch.** Make the phone views fit, then let the app open without a connection and say clearly how old its
  data is.
- **What you see.** (a) **Polish**: the first frame fits the lower 48 in portrait (or your region); Command's
  controls fold into one row; sheets snap at three heights; touch targets of 44 px; shorter credits behind
  "Credits". (b) **Install**: "Add to Home Screen" and an offline start that shows the last opened event with a
  banner that cannot be closed: "Offline. Showing data saved at 14:05 (2 h ago). Official alerts may have
  changed."
- **Data.** None. The fonts must be stored with the app to work offline. Today the page loads Inter and
  JetBrains Mono from Google Fonts on every start (`web/index.html`; `code-integration.md` section 10 found this
  first). Storing them locally also ends that request to Google (question 12).
- **Safety wording.** Nothing saved is shown without its saved time. Offline alert rows are greyed, with "as
  of". No bulk download of map tiles (the tile hosts' terms on bulk use were not checked).
- **Effort.** 7 h (polish 3 h, install 4 h).
- **Wow versus risk.** Low wow. Install matters only if the app is served to phones (question 1). Its risk is
  stale data looking current, which is why the banner stays.
- **For the app.** The phone becomes a first-class screen; offline never pretends to be live.

### (i) Trust

#### I1. Data health panel and a source card on every layer. **Build first.**

- **Pitch.** One place that shows how fresh every source is, and one card per layer that says where it comes
  from.
- **What you see.** (a) **Data health**: the status text at the top right opens a panel with one row per source:
  name · last successful check · age of its newest data · next check · state in words ("Updated", "Stale", "Could
  not be reached") · link. (b) **Source card**: the layer's "i" (shared with G2) has a "Source" tab: issuer and
  product; kind (Official / Measured / Estimate / Model); measured or issued time; fetched time; detail ("375 m
  squares"); known limits; licence and credit line; a link to the exact record; for model layers the receipt
  (run, weather source, members).
- **Data.** Existing: `/api/live/status`, `/api/floods/status`, `/api/extras/sources` and the credit list in
  `web/src/lib/dataCredits.ts`.
- **Safety wording.** State is in words, with amber for stale as now, never a green "OK". An unreachable source
  says what is still shown and from when.
- **Effort.** 5.5 h (panel 2.5 h, cards 3 h).
- **Wow versus risk.** Low wow, high trust. No real risk.
- **For the app.** The promise "official, measured or model, each with its time" can be checked by anyone in two
  taps.

#### I2. A public scorecard and a "what we got wrong" page. **Build after the forecast ledger.**

- **Pitch.** Show how past forecasts did, and keep a dated list of the app's own mistakes.
- **What you see.** (a) The Scorecard page designed in `benchmark-validation.md` 5.1: plain bars, a count beside
  every number, three empty states, no traffic-light colours. Doors to it: "How was it tested?" in Public, the
  top bar in Command and Forensic. (b) "What we got wrong": dated entries of two kinds. Automatic: for each ended
  event, the largest miss and the largest false alarm, as a small map of forecast against what happened.
  Hand-written: corrections to the app, taken from each build's known issues ("Oct 24: alerts on a past fire read
  'In effect'; now 'Was in effect'"). Each entry says what was shown, what was true and what changed.
- **Data.** The forecast ledger of `benchmark-validation.md` 2.1 (not built yet); the build reports.
- **Safety wording.** Scores describe past forecasts, never a place or today (`benchmark-validation.md` 5.6). An
  error in how the app showed an official product is the app's error, said so.
- **Effort.** 2 h for (b) once the ledger exists (1.5 h as a hand-written page before that); (a) is in the
  benchmark plan (8-14 h with the ledger).
- **Wow versus risk.** Unusual and credible: few apps list their own errors. Risk: it must be kept up.
- **For the app.** Trust earned by showing the misses, not by claiming accuracy.

### (j) The globe intro page

#### J1. The globe intro, now with fires, floods and storms on it. **Build; needs your design file.**

- **Pitch.** The dotted globe of BRIEF-4, carrying today's real events, that zooms into the US map.
- **What you see.** A dark first screen: a globe with land drawn as dots, turning slowly toward North America;
  thin decorative orbit rings (no satellites shown as real, as BRIEF-4 decided); small marks for today's events
  (fires orange, floods blue, storms a small spiral); three counters with their time: "149 active fires · 52
  floods · 0 storms · as of 14:02". Scrolling, zooming or Enter flies into the lower-48 map. "Skip intro" is
  always there. It shows on a first visit only, or at `/?intro=1`. With reduced motion: a still globe, the
  counters and a button.
- **Data.** The app's own lists. Land dots from Natural Earth (public domain, credit optional; card S12). The
  map library the app already uses can draw a globe: version 5.24 has `setProjection` in its typings (measured)
  and the library's own example calls `map.setProjection({type: 'globe'})`. Then the zoom-in is one camera move
  on the same map. This has **not been tried** with the app's terrain and overlays (`code-integration.md` H); a
  small three.js scene is the fallback.
- **Safety wording.** The two fixed lines appear here too. Counters carry "as of". "0 storms listed" is not an
  all-clear. "Lower 48 states only" is written under the counters.
- **Effort.** 3.5 h with the design file (the estimate of `code-integration.md` H); 5 h with live event marks and
  storm spirals.
- **Wow versus risk.** The highest wow, and you asked for it. Risks: it delays the map (so it is first-visit only,
  with Skip); globe frame rate on phones is untested. The design file `Intro.dc.html` is **not in the
  repository** (question 2).
- **For the app.** A front door that says "one country, several hazards, live" in two seconds.

### Small extras (not counted in the 30)

| Idea | What | Effort | Note |
|---|---|---|---|
| "All hazards" on the national map | A third position of the Fires / Floods switch that shows every marker at once | 1.5 h | Useful with D1 and D2; clutter is the risk |
| Receipt on every forecast picture | "Forecast fc-20261017T1106 · GFS 31 runs" in the legend and on exports | 1 h | Same as "Forecast receipts" in `benchmark-validation.md` section 7 |
| Watch board | A grid of 4-6 small live maps of chosen events for a duty desk | 4 h | Later; needs E2's link format |
| Run outlines for fires | Each run's final outline as a thin line (fire "spaghetti") | 3 h + disk | Later: the bundle keeps three summary layers, not every run |

## 4. The data behind the ideas: source cards

Only sources that are **new** to the app. Storm sources are in `hurricanes.md`; AI weather in `ai-weather.md`.
"Cost" is zero for all of them. None needs a key unless said.

**S1. USGS postfire debris-flow hazard assessments. Verdict: use.**
- What and who: after a fire, the USGS Landslide Hazards Program estimates, for each small basin and stream
  segment, how likely a debris flow is in a design storm, how much material could move, and a combined class.
- Access: `https://earthquake.usgs.gov/arcgis/rest/services/ls/pwfdf/MapServer` (layers: 0 Locations, 9 Fire
  Perimeters, 3 Basin Outlets, 1 and 2 probability, 7 and 6 volume, 5 and 4 combined hazard; `f=geojson` works;
  2,000 records per page). Dashboard `https://apps.usgs.gov/landslides/pwfdf/`. Full files per assessment on
  ScienceBase (each record has a `download_url`).
- Terms: the data page (dated April 22, 2026) states no separate licence and warns "the feature service only
  contains a subset of the data for a given assessment". USGS products are U.S. public domain under the USGS
  policy the README already cites (not re-read today). Credit (proposed): "U.S. Geological Survey, Landslide
  Hazards Program: postfire debris-flow hazard assessment".
- Detail: vector basins and segments. Likelihood in five 20 % classes; volume in four classes (under 1,000 to
  over 100,000 m³); combined class "Low / Moderate / High" (the service's legend).
- Time: it is a what-if for one design storm, not a rain forecast. The service's `Rainfall` label read "24mm"
  for the 2026 fires I sampled and "40mm" for Eaton. USGS's method page speaks of the design storm's "peak
  15-minute rainfall" but gives no number, so the app should show the label as given.
- Latency (measured): Norte started Oct 16 and was assessed Oct 26, 2026; Eaton Jan 7 → Jan 19, 2025; two
  Washington fires of August 2026 were assessed Nov 5, 2026.
- History: 765 assessments today, 100 for fires that started in 2026; older archives (2013-2023, 2024) on
  ScienceBase.
- Test note: 11 requests. Simple queries worked; a `where=fire IN (…)` query failed twice (the second time I
  recorded HTTP 403 from the service's front end), so a build should use simple `=` or area queries.
- **For the app:** a ready, official, national layer that links a fire to the floods that follow it.

**S2. NWS flash flood products that name a burn scar. Verdict: use with care.**
- What: the same NWS products the app already reads (`api.weather.gov`, the IEM archive). Forecasters write the
  burn scar into the text. I found no separate machine tag: the tag line in the product I read was "FLASH
  FLOOD...RADAR INDICATED".
- Today: 0 active Flash Flood Warnings, Statements or Flood Advisories (22:35 UTC), so a text match could not be
  tried on a live product. NWS's guide to these warnings (a PDF) could not be read by my tools.
- Use: a text match is a join key only. The chip quotes NWS's sentence. A second, clearly separate link is
  geometry: "This warning area overlaps the 2024 … Fire outline (NIFC)", labelled as Disaster Mapping's link.
- **For the app:** no new source; a small rule with tests on recorded products.

**S3. NOAA smoke forecast guidance (surface smoke; smoke in the whole air column). Verdict: use.**
- Who: NOAA / NWS, National Air Quality Forecast Capability.
- Access: `https://mapservices.weather.noaa.gov/raster/rest/services/air_quality/ndgd_smoke_sfc_1hr_avg_time/ImageServer`
  and `…/ndgd_smoke_vert_1hr_avg_time/ImageServer` (time-aware image services; WMS and WCS on).
- The service's own text: "Forecast guidance is issued daily at 6Z model runs. Forecast information is provided
  in one hour intervals for the subsequent 48-hour period." and "updates twice a day at 6Z and at 12Z".
- Measured: frames from 2026-11-10 03:00 to 2026-11-12 06:00 UTC; pixel 2.66 km; answer in 0.2 s.
- Terms: NWS disclaimer (as for the other NOAA map services in the README). Credit from the service: "National
  Oceanic and Atmospheric Administration, NOAA, National Weather Service, NWS".
- History: none (a rolling 48 hours). For replays the app would have to save frames itself.
- Not verified: which model makes it; the unit (the service says "micrograms per cubic feet").
- **For the app:** an hourly smoke layer with no key and no new package.

**S4. Smoke fields of NOAA's HRRR model. Verdict: use with care, as a second step.**
- Measured: the index of today's 12 UTC run in NOAA's public bucket
  (`noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20261110/conus/hrrr.t12z.wrfsfcf06.grib2.idx`) lists near-surface
  smoke (`MASSDEN`, 8 m above ground) and column smoke (`COLMD`).
- It is a 3 km model in GRIB files, so the backend must read GRIB (`code-integration.md` 6.2 says this needs
  nothing new; tested there, not by me). Run times and length were not re-checked today. Open-Meteo stops serving
  HRRR on Nov 30, 2026 while NOAA keeps running it (`benchmark-validation.md` section 9).
- **For the app:** a sharper smoke picture later; S3 is the simple start.

**S5. NOAA HMS smoke outlines. Verdict: use.**
- Who: NOAA / NESDIS Satellite Analysis Branch. Analysts outline smoke on daytime satellite images.
- Access: `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/YYYY/MM/hms_smokeYYYYMMDD.kml`
  (and `/Shapefile/…zip`). Measured: files for Nov 6-10, 2026; the Nov 9 shapefile was 69,640 bytes, changed
  Nov 10 10:59 UTC; year folders 2005-2026.
- Cadence (the HMS page): a first smoke analysis between 11 AM and noon Eastern, a second between 7 and 8 PM.
- Caveats on the page: smoke mapping "can be greatly affected by the observation conditions (most often as a
  result of cloud interference)"; fire positions are "general guidance and for strategic planning".
- Terms: no terms on the page itself; NOAA's disclaimer page was not read. Credit (proposed): "NOAA/NESDIS Hazard
  Mapping System (HMS) smoke analysis".
- **For the app:** what was actually seen today, beside the forecast, and 20 years of history for past fires.

**S6. EPA AirNow. Verdict: use with care, after your decision.**
- What and who: AQI readings and forecasts from federal, state, local and tribal agencies, gathered by EPA.
- Access: public files answered without a key (measured: `https://files.airnowtech.org/airnow/today/reportingarea.dat`,
  with AQI value, class word and agency name per area). The web API needs an account key (its FAQ; whether it is
  free was not stated on the page I read).
- Terms: "AirNow Data Exchange Guidelines" (PDF, "Last Updated August 2025", read in full). In its words: data
  "are not fully verified or validated" and "should be considered preliminary"; they "should not be used to
  formulate or support regulation, ascertain trends, act as guidance, or support any other government or public
  decision-making"; "Credit should first be given to the appropriate source"; values and advisories "should not be
  altered in any way"; values are shown "in accordance with the AQI and corresponding RGB colors"; displays "must
  indicate that these data are preliminary"; and that products rely on the data "must be made known to the
  relevant federal, state, local, and tribal air quality agencies and the EPA AirNow program". The PDF ends with
  a form to sign and e-mail.
- Credit (proposed): "<reporting agency> and U.S. EPA AirNow · preliminary data".
- Cadence: "updates all data feeds several times per hour". History: none here; validated history is in EPA's
  AQS.
- **For the app:** measured air quality at official monitors, but with EPA's green "Good" class and a duty to
  tell AirNow about the use. Both are your call (question 4).

**S7. U.S. Drought Monitor. Verdict: use.**
- Who: the National Drought Mitigation Center with USDA, NOAA and NASA.
- Access: `https://droughtmonitor.unl.edu/data/json/usdm_current.json` (measured: 16.4 MB GeoJSON, changed
  Nov 7, 2026); archives as shapefile, GeoJSON, KMZ and WMS on its GIS data page.
- Terms (permission page, read today): the map and data "are available and authorized for use by third parties,
  including by commercial and non-commercial entities. Credit must be properly attributed using the following".
- Credit (exact): "The U.S. Drought Monitor is jointly produced by the National Drought Mitigation Center at the
  University of Nebraska-Lincoln, the U.S. Department of Agriculture, the National Oceanic and Atmospheric
  Administration and NASA. [Map / Data] courtesy of NDMC, via https://droughtmonitor.unl.edu."
- Cadence: weekly (the release day is not on the pages I read). Classes D0 to D4.
- **For the app:** one weekly file, simplified by the backend, gives the drought class at any point.

**S8. SPC Fire Weather Outlooks. Verdict: use.**
- Who: NOAA / NWS Storm Prediction Center. Official forecasts of fire-weather conditions for days 1 to 8.
- Access: `https://mapservices.weather.noaa.gov/vector/rest/services/fire_weather/SPC_firewx/MapServer`
  (measured: 24 layers, three per day for days 1 to 8, with separate "Dry Thunderstorm" and, from day 3,
  "Winds and Low Humidity" layers).
- Terms: NWS disclaimer. Credit: "NOAA/NWS Storm Prediction Center".
- **For the app:** the official "days ahead" picture beside the model outlook that `ai-weather.md` proposes.

**S9. WPC rainfall forecast and Excessive Rainfall Outlook. Verdict: use.**
- Access: `…/vector/rest/services/precip/wpc_qpf/MapServer` and `…/hazards/wpc_precip_hazards/MapServer`
  (measured: "Excessive Rainfall Day 1" to "Day 5"). NWS disclaimer. Credit: "NOAA/NWS Weather Prediction
  Center". `hurricanes.md` row 1h reaches the same verdict.
- **For the app:** the official middle step between a storm and a river flood.

**S10. NOAA NGS Emergency Response Imagery. Verdict: use with care.**
- What and who: aerial photos flown by NOAA's Remote Sensing Division after disasters ("The imagery posted on
  this site was acquired by the NOAA Remote Sensing Division").
- Access: an index at `https://storms.ngs.noaa.gov/`; map tiles through a WMTS service
  (`https://storms.ngs.noaa.gov/storms/tileso/services/tileserver.php/wmts`, tiles at
  `https://stormscdn.ngs.noaa.gov/<layer>/{z}/{x}/{y}`). Measured on one event page: 23 layers. That page turned
  out to be the 2020 storm of the same name as this year's Isaias; I did not find the 2026 layer names.
- Terms: no licence text on the pages I reached (the disclaimer address I tried returned 404). It is a NOAA
  federal product, so very likely public domain: **not verified**.
- **For the app:** sharp "after" pictures for B2; each event's layers must be looked up by hand.

**S11. Older fire outlines: NIFC perimeter history and MTBS. Verdict: use (NIFC), use with care (MTBS).**
- NIFC `InterAgencyFirePerimeterHistory_All_Years_View` (ArcGIS, no key): 95,677 outlines with a fire year after
  1900 (my filter); the largest year value is 9999, a placeholder, so years must be cleaned. Same owner as the
  NIFC layers the app uses; its terms were not re-read today.
- MTBS (`https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MTBS_01/MapServer`): burned-area outlines per year
  up to a "2026" layer; credit in the service: "U.S. Forest Service Enterprise Map Services Program". MTBS says
  data for the current and previous year arrive unevenly. Licence **not verified**.
- **For the app:** background burn scars for D1 and B1, older than the app's own bundles.

**S12. Natural Earth (land shapes for the globe). Verdict: use.**
- Terms (read today): "All versions of Natural Earth raster + vector map data found on this website are in the
  public domain." Credit is optional: "Made with Natural Earth."

**S13. NWS translations. Verdict: link only.**
- `https://www.weather.gov/translate/` (read today): "Experimental - Not for operational use"; from "a limited
  number of NWS Forecast Offices"; "no guarantee of timely availability". A search result summarises a January
  2026 GAO report (GAO-26-107680): AI translations in five languages, not yet nationwide (not read in full).

**S14. FEMA Open Shelters. Verdict: do not use for now.**
- Measured: `https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/MapServer` answers; its text says the
  data are synchronised every morning with the American Red Cross shelter database and checked every 20 minutes.
- It is official and public, but on this app's map a shelter pin reads as "go here" (section 6, item 1).

## 5. The Google rule and this file

- **Nothing above needs Google data.** Every source in section 4 is a US agency, a US university centre or
  public-domain data.
- **Where Google data could appear if you change the rule**, each as a switchable row that is off by default:
  A3 (the Google DeepMind rows inside NHC's public model file: `hurricanes.md` 3.3), A4 and E3 (WeatherNext 3 as
  one more "opinion": `ai-weather.md` section 2), I2 (a WeatherNext back-test on past fires).
- **What its terms would mean on screen** (from `ai-weather.md` 2.3; I did not re-read Google's terms): the
  real-time data is "not intended for consumer use", so it would never appear in Public. The forecast itself may
  not be published, so E3 could show a burn map made with it but not a WeatherNext wind chart, and E2's briefing
  would have to leave raw WeatherNext charts out whenever someone other than you sees it. It needs Google's exact
  credit line and a third secret.
- **One Google service is already in use**: the page loads its two fonts from Google Fonts. That is a service,
  not data, and `code-integration.md` section 10 reports it. H4 would remove it (question 12).

## 6. Considered and rejected

| # | Idea | Why not |
|---|---|---|
| 1 | "Time until the fire reaches you", "leave by" clocks, escape routes, "nearest shelter" pins | It is evacuation advice. A model with 0.19-0.43 overlap scores (README) cannot carry it, and routes and shelters change by the hour. Officials decide; the app links to them. |
| 2 | One risk score or a red / amber / green light for a place | It merges official and model, hides what is unknown, and its lowest class would be an all-clear by another name. |
| 3 | Push alerts, SMS or e-mail from the app | A research prototype with no uptime promise must not be anyone's alarm. A missed alert would do harm. NWS and local officials run alerting. |
| 4 | Crowd-sourced reports ("I see flames") without moderation | Unverified, easy to abuse, and they would sit beside official data. Moderation is a service, not a feature. |
| 5 | Social media feeds on the map | Same problem, plus platform terms. |
| 6 | An AI chat in Public; AI that reads pictures and declares "flooded" or "burning" | `ai-mapping-llm.md` 3.3: people will ask "should I leave?", and a picture verdict cannot be traced to a measurement. |
| 7 | Automatic "destroyed" labels on after-pictures | `ai-mapping-llm.md` 1.9: do not use. A wrong label about someone's home is a serious harm. |
| 8 | Machine translation of official warnings | One wrong verb changes an instruction (`ai-mapping-llm.md` 3.1 F). Link to the issuer's own translation. |
| 9 | Live satellite positions or "next pass in 12 min" on the globe | BRIEF-4 already chose decorative orbits. Fake precision on the first screen would undercut the rest. |
| 10 | Smooth water animation between satellite passes; our own surge or flood model | Brief 6: nothing is invented between passes. `hurricanes.md` 3h: NHC's surge product exists. |
| 11 | Low-cost sensor networks for smoke | Not official data, which is this project's rule; their terms were not checked. |
| 12 | Power-outage and road-closure layers | No free official national feed that I know of (not checked today). Road closures read as route advice, and the best-known traffic sources are commercial map services, which `CLAUDE.md` bans. |
| 13 | "What if the wind were 20 % stronger" sliders in Public or on live fires | Reads as a prediction made to order. Possible later in Forensic on past events only, clearly a lesson. |
| 14 | Maps ranking neighbourhoods by social vulnerability | It is not hazard information and it can stigmatise places. |
| 15 | Cinematic autoplay on live events, sound alarms, streaks or badges | Autoplay breaks the reduced-motion and "nothing plays by itself" rules; the rest turns a disaster into a game. |
| 16 | WeatherNext layers in Public | Banned by `CLAUDE.md` today; and even after a rule change its terms say "not intended for consumer use" (`ai-weather.md` 2.3). |
| 17 | FEMA Open Shelters as a layer | Official (card S14), but see item 1. If you want it, it should be a list with issuer and time, not pins: question 13. |

## 7. Top 8 by value for effort, and a suggested order

| Rank | Idea | Hours | Why it ranks here |
|---|---|---|---|
| 1 | **A1** Odds you can count | 2 | The smallest change that makes the model understandable |
| 2 | **E2 (link)** Exact-view links | 2.5 | Fixes a known issue; every later feature (briefing, watch board, tests) builds on it |
| 3 | **I1** Data health and source cards | 5.5 | Makes the app's main promise checkable; all data exists |
| 4 | **G2** Glossary and "how to read" cards | 4.5 | Aimed at the stated audience; no data, no risk |
| 5 | **D1** Burn scars and debris flows | 5 | The best multi-hazard link; official data measured today; two test fires ready |
| 6 | **D3** Smoke (forecast and satellite outlines) | 4 | Reaches people far from the fire; no key |
| 7 | **B3** What changed since yesterday | 4 | The returning user's first question; also starts the recorder that A2 and I2 need |
| 8 | **C1** My place and saved places | 7.5 | Highest public value; ranked last of the eight only because its wording needs the most care |

Together about **35 build hours** (about 47 with independent reviews).

**Suggested order**, each slice in one pass with two agents at a time:

1. **Slice U1, "understand and trust" (14.5 h): A1, E2 link, G2, I1.** No new source, no new package, no rule
   change. I1 and G2 share the layer "i" card, so one role builds the card and the other fills it.
2. **Slice U2, "cross-hazard" (9 h): D1, D3 (a, b, d).** Two official map services, no key. Decide question 5
   first; question 4 only matters for the AirNow part, which can wait.
3. **Slice U3, "your place, your day" (11.5 h): B3, then C1.** C1 comes last because it shows D1, D3 and the
   source cards, and reuses B3's recorder.
4. **Then, by taste:** the wow set (B2 swipe 3 h, F4 sun 2.5 h, F1 fly-through 3.5 h, J1 globe 3.5-5 h once the
   design file is here), the reach set (H2 3 h, H1 3.5 h, H4 polish 3 h), the Command set (E1 5 h, C2 5 h, E2
   briefing 4 h), and F2 cross-sections (3.5 h) for flat floods.

**How this fits the other audit-7 plans.** A3, D2's strip and F3 belong to the hurricane slices
(`hurricanes.md` section 9). A4 and E3 belong to the AI-weather first step (`ai-weather.md` section 6). I2 needs
the forecast ledger (`benchmark-validation.md` section 8). H2's summaries are the facts packet for "Explain this
view" (`ai-mapping-llm.md` 3.2). Slice U1 conflicts with none of them and can run beside any of them.

## 8. All 30 ideas in one table

| Id | Idea | Build hours | New data | Verdict |
|---|---|---|---|---|
| A1 | Odds you can count (dot strip) | 2 | none | build first |
| A2 | Fans that say their own width | 3 | none (a recorder for river forecasts) | build |
| A3 | Spaghetti tracks you can untangle | +1 on H6 | NHC model file (`hurricanes.md`) | with hurricanes |
| A4 | "Runs close together / spread out" badge | 3 | none | build with care |
| A5 | Unknown is drawn, not blank | 2.5 | none | build |
| B1 | Time machine: past events shelf | 4 | NIFC history, MTBS (background) | build |
| B2 | Before / after swipe | 3 (+1.5) | optional NOAA aerial photos | build |
| B3 | What changed since yesterday | 4 | none (a daily recorder) | build first |
| C1 | My place, saved places in the browser | 7.5 | optional NWS point forecast | build with care |
| C2 | Search suggestions, Forensic search, palette | 5 | none (local index) | build |
| D1 | Burn scars: debris flows and floods | 5 | USGS debris-flow service | build first |
| D2 | Storm → rain → rivers | 1.5 (+2) | WPC rainfall layers | build; strip with hurricanes |
| D3 | Smoke: forecast, satellite outlines, monitors | 4 (+2) | NOAA smoke, HMS; AirNow optional | build first; AirNow: your decision |
| D4 | Drought and dry-fuel context | 3 | Drought Monitor, SPC outlooks | build |
| E1 | Measure and sketch | 5 | none | build |
| E2 | Exact-view links; one-page briefing | 2.5 + 4 | none | link: build first; briefing: with care |
| E3 | Two models side by side | 5.5 | none (AI model per `ai-weather.md`) | with AI weather |
| F1 | Fly-through (river, fire front) | 3.5 | none | build |
| F2 | Cross-sections | 3.5 | none | build |
| F3 | Storm surge on terrain | 4-5 | NHC surge map (`hurricanes.md`) | after hurricane slice 1 |
| F4 | Sun and shadow at event time | 2.5 | none (formula) | build |
| G1 | Guided tour and demo mode | 4 | none (fixtures) | build |
| G2 | Glossary and "how to read" cards | 4.5 | none | build first |
| H1 | Colour-blind check, pattern-first layers | 3.5 | none | build |
| H2 | Screen-reader summaries | 3 | none | build |
| H3 | Spanish | 7 + reviewer | none | your decision |
| H4 | Phone polish; offline-friendly install | 3 + 4 | none | polish: build; install: your decision |
| I1 | Data health panel, source cards | 5.5 | none | build first |
| I2 | Scorecard; "what we got wrong" | 2 (+ ledger) | forecast ledger | after the ledger |
| J1 | Globe intro with live events | 3.5-5 | Natural Earth | build; needs your design file |

All 30 together are about 120-130 build hours (before reviews), so this is a menu, not one brief.

## 9. Questions only you can answer

1. **Who sees the app?** Only you on your Mac, or other people too (a phone on your network, a hosted copy)? It
   decides H4's install, the privacy text of C1, what E2's briefing may contain, and the AirNow duty.
2. **Globe intro.** Can you add `Intro.dc.html` (BRIEF-4 calls it "a separate zip")? If not, may it be derived
   from the handoff design system? First visit only, or every visit?
3. **My place.** Are saved places in the browser only (no account, up to 8) right? May the place page ask the NWS
   for the official point forecast, which sends the rounded point to NWS?
4. **Smoke and AirNow.** (a) NOAA forecast and satellite outlines only (my advice for now); (b) add AirNow's
   monitors with EPA's own colours and words, including its green "Good" class, labelled preliminary, and you
   send EPA the form; or (c) also its API with a key, which would be another secret.
5. **USGS debris-flow classes.** Show USGS's combined class in USGS's own words (its first class is "Low"),
   quoted with the issuer, or show only likelihood and volume?
6. **Spanish.** Is there a fluent reviewer for the safety sentences? Without one I advise against shipping it.
7. **Briefing export.** Who would receive it? Is a page made by the browser's Print good enough?
8. **Past events shelf.** Which events matter to you (Eaton and Palisades 2025, the Texas floods of July 2025,
   Helene 2024, others)?
9. **Order.** Do you agree with the top 8, or do you want the wow items first (globe, swipe, fly-through, sun)?
10. **Google.** If you change the rule for WeatherNext, should the comparison views (A4, E3) and the track
    spaghetti (A3) include Google rows, in Command and Forensic only? (Also question 1 of `hurricanes.md`.)
11. **Demo data.** May a small demo bundle live inside the repository so the tour works on a fresh copy, or
    should it stay generated by a script?
12. **Fonts.** Store Inter and JetBrains Mono with the app (no request to Google Fonts, works offline)?
13. **Shelters.** Keep FEMA's open-shelter list out (my advice), or show it as a text list with issuer and time?

## 10. Not verified, or open

- **I did not run the app.** Everything about the current UI comes from 12 screenshots of briefs 5 and 6 and
  from the documents. The phone notes rest on three phone screenshots.
- **USGS design storm.** The service labels it "24mm" or "40mm"; the method page read today gives no number and
  does not say how long an assessment stays valid. The USGS public-domain policy was not re-read.
- **Burn-scar wording in NWS products.** Seen only in search-result excerpts. No such product was active today,
  the one archived text I read named no burn scar, and NWS's PDF guide was unreadable.
- **NOAA smoke guidance.** Which model makes it and its true grid; the unit text in the service looks wrong.
- **HRRR smoke.** Only the file index was read. Run length and reading GRIB were not tested by me.
- **HMS and NGS terms.** No terms text found on the pages reached; both are NOAA federal products. The 2026
  layer names of NGS's Isaias imagery and its ground detail were not found.
- **AirNow.** Whether the API key is free, and its rate limits. Whether the public files fall under the same
  form (the guidelines name AirNow.gov, AirNow-Tech and the AirNow API).
- **Drought Monitor.** Release day and the start of its archive are from general knowledge.
- **MTBS licence; NIFC history terms.** Not read today.
- **River fan (A2).** NOAA's river-model API returned no medium-range series for the one reach I tried, so I do
  not know whether it offers several runs per reach.
- **Globe (J1).** The map library's globe has not been tried with the app's terrain, overlays or tint. When the
  globe was added to the library is from memory (version 5).
- **Colours (H1).** No contrast or colour-blind numbers were computed; the pairs named are guesses from the
  tokens. The "1 man in 12" figure is general knowledge.
- **Fonts' licence** (SIL Open Font License for both) is from memory.
- **Hours.** Estimates, calibrated on the 1-2 h roles of earlier briefs. The four "+ on another plan" items
  depend on that plan's own estimate.

## 11. Evidence log (2026-11-10, about 22:30-23:05 UTC)

All requests: curl, one at a time, User-Agent `Disaster Mapping research prototype`; no key, no login.

| Host | Requests | What was seen |
|---|---|---|
| `earthquake.usgs.gov` (USGS debris flow) | 11 | Service and 12 layers; 765 assessments, 100 with a 2026 start date; newest three records (Sisi, Wonderland Complex, Norte); Norte's 20 basins (18 in "0-20%", 2 in "20-40%"); the legend's class names; Eaton's record ("40mm", assessed 2025-01-19); two `IN (…)` queries failed (HTTP 403 recorded on the second) |
| `mapservices.weather.noaa.gov` | 10 | Raster folders; 18 air-quality services including two smoke services; the smoke service's text and time extent; vector folders; SPC fire weather (24 layers); WPC rainfall services; ERO days 1-5 |
| `api.weather.gov` | 1 | 0 active Flash Flood Warning / Statement / Flood Advisory products |
| `tgftp.ncep.noaa.gov` | 1 | One Flash Flood Warning text (NWS Albuquerque, Sep 25, 2026) with its tag line |
| `satepsanone.nesdis.noaa.gov` (HMS) | 3 | Nov 9 smoke shapefile present; KML files Nov 6-10; year folders 2005-2026 |
| `droughtmonitor.unl.edu` | 4 | Current GeoJSON (16,402,765 bytes); permission page with the exact credit; GIS data page |
| `docs.airnowapi.org`, `files.airnowtech.org` | 3 | Guidelines PDF (303,400 bytes, text extracted); public `reportingarea.dat` rows; one guessed hourly file name returned 404 |
| `storms.ngs.noaa.gov`, `www.ngs.noaa.gov` | 3 | An event page and its WMTS list (23 layers, 2020); a disclaimer address returned 404 |
| `apps.fs.usda.gov` (MTBS) | 1 | Layers up to "2026 Burned Area Boundaries" |
| `services3.arcgis.com` (NIFC history) | 3 | Fields; 95,677 records with a fire year after 1900; largest year value 9999 |
| `gis.fema.gov` | 1 | Open Shelters service text |
| `api.water.noaa.gov` | 3 | Gauge COCF1 → reach 11003333; short-range series present; medium-range empty |
| `noaa-hrrr-bdp-pds.s3.amazonaws.com` | 1 | Today's HRRR index lists `MASSDEN`, `COLMD`, `AOTK` |

Pages read with WebFetch (11): USGS debris-flow data page and scientific background; NWS flash-flood PDF
(unreadable); Drought Monitor permission; AirNow FAQ; NOAA HMS; NGS storms index; Natural Earth terms; MapLibre
globe example; `weather.gov/translate`; NOAA air-quality programme page. Web searches (6): USGS debris-flow
services; NWS burn-scar warnings; HRRR smoke access; AirNow terms; MTBS and BAER access; NWS translations.

In the repository: `web/package.json` (maplibre-gl 5.24.0; no service worker, no language layer),
`node_modules/maplibre-gl/dist/maplibre-gl.d.ts` (`setProjection`), `web/src/scene/look.ts` (fixed sun angles),
`web/src/state/history.ts` and CONTRACT 16.1 (`t` is fire-only), `web/index.html` (Google Fonts), `SPEC.md`
(forecast series and layers), the route list of `backend/fire3d/api/`.

One note for whoever repeats this: the AirNow guidelines PDF contains a stray line addressed to automated
readers (about how to sign e-mails). It is not part of the guidelines and I ignored it.

## 12. Sources

- USGS: `https://www.usgs.gov/programs/landslide-hazards/science/postfire-debris-flow-hazard-assessment-data`;
  `https://www.usgs.gov/programs/landslide-hazards/science/scientific-background`;
  `https://earthquake.usgs.gov/arcgis/rest/services/ls/pwfdf/MapServer`
- NOAA map services: `https://mapservices.weather.noaa.gov/raster/rest/services/air_quality`;
  `https://mapservices.weather.noaa.gov/vector/rest/services/fire_weather/SPC_firewx/MapServer`;
  `https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer`;
  `https://vlab.noaa.gov/web/osti-modeling/air-quality`
- NOAA HMS: `https://www.ospo.noaa.gov/products/land/hms.html`;
  `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/`
- NOAA NGS: `https://storms.ngs.noaa.gov/`
- EPA AirNow: `https://docs.airnowapi.org/docs/DataUseGuidelines.pdf`; `https://docs.airnowapi.org/faq`;
  `https://files.airnowtech.org/airnow/today/reportingarea.dat`
- U.S. Drought Monitor: `https://droughtmonitor.unl.edu/About/Permission.aspx`;
  `https://droughtmonitor.unl.edu/DmData/GISData.aspx`
- NWS: `https://api.weather.gov/alerts/active`; `https://www.weather.gov/translate/`;
  `https://www.weather.gov/media/impacts/Flash-Flood-IBW.pdf` (not readable);
  `https://www.gao.gov/products/GAO-26-107680` (search result only)
- NIFC and MTBS: `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0`;
  `https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MTBS_01/MapServer`; `https://www.mtbs.gov/direct-download`
  (search result only)
- FEMA: `https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/MapServer`
- Natural Earth: `https://www.naturalearthdata.com/about/terms-of-use/`
- MapLibre: `https://maplibre.org/maplibre-gl-js/docs/examples/display-a-globe-with-a-vector-map/`
- In this repository: `README.md`, `SPEC.md`, `docs/redesign/handoff-4/HANDOFF.md`, `docs/redesign/CONTRACT.md`
  sections 15-17, `docs/redesign/BRIEF-4.md`, `BRIEF-5.md`, `BRIEF-6.md`,
  `docs/redesign/reports/final-verification-6.json`, and the other files in `docs/redesign/audit-7/`.
