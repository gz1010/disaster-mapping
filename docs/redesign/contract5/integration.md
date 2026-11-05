# As built: integration, part 1 (brief 5)

Role `integration` part 1 (PLAN-5 §10.1), 2026-11-05 09:37-10:40 UTC, API 8759 / Vite 5219, on branch
`claude/cool-mayer-ki7to6`. Folded into CONTRACT §16.16 ("Integration (part 1)"); the live list table is in
`docs/redesign/reports/brief5-integration.json`.

## Real data end to end

- **Live list vs NWS** (`/api/floods` on the real API, `FIRE3D_LIVE=0`): every NWS flood product event in effect in the
  lower 48 (37 events, 35 in effect + 2 upcoming) is in a listed flood; every gauge observed at minor or worse is in a
  flood except SJNP4 (Puerto Rico, out by rule 1); 4 gauges forecast to reach minor with no NWS product (BFFU1 UT,
  BOWD1 DE, DESI4 IA, PLMF1 FL) are not floods (D2 starts floods from observed readings only). Each listed flood's
  name, kind, level, products and gauges were read against the products' own text (`area_desc`, the WHERE line, the
  "Some locations…" line) and the gauges' waterbodies; the changes this made are below.
- **Real bundles:** Rio Grande flood at Alamosa, CO (river; gauge ALAC2 at minor with a WGRFC forecast of 20 steps; 31 s)
  and Ducktown flash flood (NWS Morristown and Peachtree City Flash Flood Warnings; 42 s); both `check_bundle --hazard
  flood` 0 problems. Also rebuilt after the incident below: St. Johns, Peace, Platte, Grand, Calcasieu, Moenkopi Wash
  (all 0 problems).
- **Views on a real flood:** Public overview (Fires and Floods, same camera), Public flood view (Rio Grande; the
  Copperhill gauge flood), Command flood view with a selected point, Forensic, phones (390 × 844):
  `docs/screenshots/brief5-integration-*.png`.

## Changes (each small; tests added)

Backend (`backend/fire3d/floods/catalog.py`, `naming.py`; SPEC §8.8; CONTRACT §16.8):

1. **A gauge-only flood lists the NWS products over its gauge.** Found at Copperhill, TN: the Ocoee River gauge CPHT1
   read major ("3 feet from its all-time peak", NWS's words) under NWS Morristown's Flash Flood Warning with a **Flash
   Flood Emergency for Copperhill**, which names no gauge; the gauge-only flood's flood-alerts answer was empty, so its
   Public facts said "No NWS flood product here right now". `group()` now attaches every non-watch product whose area
   covers a member gauge of a flood with no own non-watch product (like rule 4's watches: never a join, never
   registered to it). The flood's level, status, emergency, circle and facts follow the product; its id and name stay
   the gauge's. On the recorded day Joshua Creek at Nocatee lists the Peace River Flood Warning that covers it.
   `gauges_down_row(s, own_keys=None)` takes the registry's own keys so such a flood is not listed from products it
   does not own while the gauges are down.
2. **Areal warnings join by the river they name.** Rule 3's same-river join also takes an areal product's water
   (`naming.water_from_text`): NWS Grand Junction's and Salt Lake City's "Flooding along the San Juan River" warnings,
   3 km apart and issued 17 h apart, were "San Juan River flood (UT)" and "(UT, 2)"; on the recorded day they join NWS
   Albuquerque's Shiprock warning into one "San Juan River flood"; Phoenix's Salt River warnings are one flood.
3. **A gauge in flood under only a watch stays `gauge_only`** (it was level `watch`, which U2 hides by default).
4. **Names:** `naming.clean_water` drops a waterbody's state notes ("Toccoa River (GA) / Ocoee River (TN)" → "Toccoa
   River / Ocoee River") and position notes ("Loxahatchee River 500 ft downstream of US 1" → "Loxahatchee River": the
   two Loxahatchee tide gauges are one flood); `dedupe_names` drops a state suffix that no longer separates two floods
   ("Salt River flood (AZ)" next to "Rio Verde flood (AZ)").
5. **Stable ids through a split.** The part of a split that lost the id to the part holding its anchor got an id made
   from its newest product key at every build (each NWS update changed it, orphaning its bundle; the Ducktown flash
   flood had three ids in an hour), and when that part was handled after the anchor part, the anchor part's live id
   was aliased to the new id. `assign_ids` now reassigns the split part's keys to its new id (`Registry.write(reassign=)`)
   and never aliases an id another row keeps.
6. `tests/data/floods/catalog/cases.json` re-reviewed (4 groups changed, each listed in its `integration_2026_11_05`
   note); new tests in `tests/test_floods_grouping.py` (`test_integration_*`, 5).

Web:

7. **Circle meaning of a gauge-only flood follows its caveat** (`ui/public/floodView.ts floodCircleStatus`):
   `ALERTS_UNAVAILABLE` (NWS outage) and `GAUGE_ONLY_COASTAL_CAVEAT` are the meaning (+ "Not an all-clear. Follow local
   officials."), never "No NWS flood product names this flood" or "No NWS flood product is in effect here" (D24; the
   sources note asked for it); a gauge in flood under a watch: `CIRCLE_MEANING.gaugeWatch`.
8. **A forecast crest that has passed is not a crest.** The real Rio Grande at Alamosa at 02:50 MST showed "9.8 ft ·
   Wed Nov 4, 23:00 — FORECAST CREST (NWS)" from an 18:00 forecast. `official/floodModel.ts forecastPassed(f, nowMs)`;
   Public facts (`FLOOD_PUBLIC.labelHighestForecast`, also WFC-R14's "below the latest reading", which Public lacked),
   Command readout (`FLOOD_COMMAND.highestPassedSub`), Official now (`highestPassedVerdict`), the chart's mark
   (`crest.passed`, `HYDRO.highestPassedTip`).
9. `location/CoordinateStrip.tsx`: "No flood open" in Floods (WFO-R9; test `CoordinateStrip.test.ts`).
10. `ui/timeline/Hydrograph.tsx` `GUTTER` 82 → 92 px (the dock cut "MODERATE 17.0" / "MODERATE 11.0").
11. Past floods (from the backend-flood-live note): `PAST_RULE_NOTE` "reached or were forecast to reach" (BFL-R9);
    Forensic's unprepared card shows `PAST_NO_BUNDLE` for a `mode: "historical"` flood instead of a button that
    answers 409 (`ui/forensic-flood/FloodForensic.tsx`, `floodCopy.PAST_NO_BUNDLE` = `history.PAST_NO_BUNDLE`).

Docs: README "Floods (brief 5)" (what the app shows, the three views, official / measured / model, fixture-flood),
"Optional: a NASA Earthdata token", flood CLI, scripts and routes, "Flood data (brief 5)" credits with terms;
CONTRACT §16.2 comments, 16.3 `refreshed_ms`, 16.7 rows (GET /api/floods 200 with both lists down; bbox ≤ 4°;
local-alerts `hazard=flood`), 16.8 as-built rules, 16.10 store keys, 16.11 `FloodHit` and the two extra methods, 16.12
signatures (`productsShown`, Hydrograph props, no `SceneAssets`), 16.14 every new backend and web string, 16.15 OPERA
row, 16.16 per role; SPEC §8.8 rules 3, 5, 6, 9, 10.

Decided and kept: `useZoneSource()` reports a flood as "local time at this place" (correct for a flood; no `zoneLine`
change); NASA's GIBS picture stays undrawn (web-flood-public's reason); the flood layers' credits stay as the key's last
line / the foot portal (not folded into `lib/dataCredits.ts`: they already reach the foot bar).

## Incident (my mistake, recovered)

At 09:53 UTC a throw-away debug test of mine imported `tests/test_floods_grouping.py`'s helpers without its autouse
isolation fixture; its `fresh()` removed the real `data/floods` (fixture-flood, 8 real bundles, registry, last-known
summaries, year-list copies). `data/cache`, `data/incidents` and `data/official` were untouched. Recovered: the
polluted remains moved to the session scratchpad (not deleted), `fixture-flood` regenerated, the 8 real bundles rebuilt
through the real API from the warm HTTP cache (all `check_bundle` 0 problems), registry and year lists rebuilt by the
code. Consequences: the registry's history is gone, so some flood ids differ from earlier reports (St. Johns is now
`flood-20261006-st-johns-river-flood-f81f2a`, Grand River `flood-20261104-grand-river-flood-1b2d20`, Rio Grande
`flood-20261104-rio-grande-flood-58a10a`); old ids that only the registry knew now answer 404; floods that had left
the lists are not carried over until they are seen again. `data/` is gitignored and local to this container.

## For the next steps

- **Part 2 / final check:** the year lists' disk copies were rebuilt on request (2025, 2026); the live loop's
  `live_state.json` is gone (the first cycle re-checks satellite passes).
- **Command, past floods (backend-flood-live note, not done here):** the model chip says "could not be loaded" for a
  `not_available_for_past_dates` answer; the slim chart labels a past reading with today's category and its age
  against now.
- **Copperhill:** the Ocoee River gauge flood and the Ducktown flash flood are one event listed twice (river and flash
  products never join by distance; the Flash Flood Warning names "the Ocoee River" in its text). Linking a gauge to a
  Flash Flood Warning whose text names its river (as rule 2 does for areal products) would make one river flood, but
  its Public facts would then show the river rows instead of detection and damage threat: a decision for the user.

# Part 2 (brief 5 integration, 2026-11-05 10:19-10:50 UTC)

After every role was built, reviewed and fixed. API 8759 / Vite 5219. Folded into CONTRACT §16.16 ("Integration
(part 2)").

## The live loop end to end (real sources)

- Run: `FIRE3D_LIVE=1 FIRE3D_AUTO_BUILD_LIVE=0 FIRE3D_AUTO_BUILD_FLOODS=1 FIRE3D_FLOOD_LIVE_INTERVAL_S=420`, a scratch
  copy of `data/floods` (`FIRE3D_DATA_DIR`; the loop changes ready bundles), the main HTTP cache.
- Cycle 1 (10:20 UTC): list built (both lists `available`), prefetch 2 series, appended to all 8 ready bundles,
  refresh due for none (every bundle was rebuilt less than `REFRESH_MIN_AGE_H` ago), auto-build candidates = the one
  top-4 flood without a bundle (the Toccoa River / Ocoee River flood at Copperhill, TN, under the Flash Flood
  Emergency): built in 82 s; the other three of the top 4 (Ducktown, St. Johns, Peace) were ready.
- Cycle 2 (10:27 UTC): appended to 4 bundles (`refreshed_ms` set), refresh due for none.
- `/api/floods/status` from the loop: `active_floods` 40, `gauges_in_flood` 38, `auto_build` true.
- `check_bundle --hazard flood`: 0 problems on all 10 bundles of the scratch folder after both cycles.
- Log: 0 "request limit" lines, 0 errors; the fire loop ran its own cycle beside it (149 fires); count-only secret
  scan of the log: 0 FIRMS key values (EARTHDATA_TOKEN not set here).

## Past floods end to end (U1 (a))

- 2026: 2,109 floods (1,500 flash, 470 moderate river, 139 major river; 41 Flash Flood Emergencies); 2025: 1,977
  (1,207 flash, 564 moderate, 206 major; 47 emergencies); `past_rule: "moderate_or_worse"` (the U1 (a) rule; the
  fallback is unused), `preparing` true while building (about 30 s each from the cached month answers), source
  `iem_archive` `available`.
- Walked on the real API: Turkey River flood (IA, 2025, SPLI4): detail `resolved_from: "year"`; 8 archived NWS La
  Crosse products verbatim with their H-VTEC (severity 3 in two of them: major, as its row says); USGS readings (654
  points, category `unknown`, `THRESHOLDS_TODAY`, `PAST_NO_FORECAST`); build 409 `PAST_NO_BUNDLE`; model
  `not_available_for_past_dates`. Bluefield flash flood (WV, 2025): 6 archived NWS Blacksburg products, damage threat
  CATASTROPHIC, emergency.
- Screenshots: `brief5-integration-past-2025.png`, `-past-2026.png`, `-past-public.png`, `-past-command.png`,
  `-past-forensic.png`.

## Changes

1. `backend/fire3d/floods/history.py` `summarize`: a past river flood's name uses `naming.clean_water` (the 2025 list
   had "Whitewater River (KS) flood (KS, 3)"); `_id_name` keeps the raw name for `make_flood_id`, so no past id
   changed; `SCHEMA` 3 (the disk copies are rebuilt once). Test `test_year_names_drop_state_notes_and_keep_their_ids`.
2. `web/src/ui/timeline/hydrographModel.ts`: `HydrographModel.past`; a past flood's reading gets no category from
   today's levels (`cursorReadout`) and its latest mark reads `HYDRO.latestPast` ("LAST READING SHOWN AUG 20 06:30"),
   never an age against the flood's last product, never STALE. Test in `hydrographModel.test.ts`.
3. `web/src/state/floodLayerData.ts` `ExtraLayerState` + `'past'`; `map/FloodLegend.tsx` chip "not kept for past
   dates" (`FLOOD_COMMAND.chipPast`) and the details note (`modelPast`); `location/floodCheck.ts`: the model and
   CatFIM lines at a past date say the answer's reason, quiet (`catfimPast`). Test in `FloodLegend.test.ts`.
4. `web/src/ui/public/FloodStatus.tsx`, `floodOverviewText.ts` `floodCountPart({ year })`: a year tab's bar status
   reads "{N} PAST FLOODS IN {YEAR}" (`BAR_STATUS.past` / `pastOne`), its tooltip `PAST_RULE_NOTE`; before, "NOV 5
   2026 · 1,977 FLOODS" read as floods today. Test in `floodOverviewText.test.ts`.
5. `web/src/ui/timeline/hydrograph.css` `.hg-notes`: a dark backing, so the record line never strikes the note
   through ("No NWS river forecast for this gauge right now", "River forecasts are not kept for past dates.").

## Forensic and the dock

- Forensic on the auto-built real bundle (`brief5-integration-real-forensic-autobuilt.png`: CPHT1 at major, the
  NWS warning lines, satellite water of Oct 27 with its age in amber) and on `fixture-flood` (dock with a crest): the
  dock mounts the real `Hydrograph variant="dock"` (web-flood-forensic did it; no placeholder left), members are never
  tagged NEARBY (fixed in web-flood-command's review fixes), the handle has its own row above the plot so NOW and
  CREST never overlap it, and the 92 px gutter (part 1) shows "MODERATE 17.0" whole.

## Contract and SPEC

- CONTRACT §16.12 `buildHydrograph` `past?`; §16.14 the new web strings; §16.16 the web-flood-forensic review fixes'
  exact names (`floodProbeRows`, `catfimCategoryLabel` / `Word`, `floodOverlayRects`, `placeBarLabel`, `ScreenRect`,
  `layerNote`, `floodplainEffective`, `dockNoProduct`, `COPY_FRESH_MS`, `overviewProduct`, `SceneKeyItem.notes` /
  `.more`) and "Integration (part 2)". Every `contract5/*.md` note is now folded.
- SPEC §8.10: past names (cleaned waterbody, raw slug in the id), `SCHEMA` 3. The triple did not change; the parity
  test (`test_flood_contracts.py`) and the 16.14 string test (`test_floods_copy.py`) are green.

## Left (with reasons)

- Forensic Analysis-tab small multiples (below web-flood-forensic's cut line): each gauge's "Chart" button shows it in
  the dock; small multiples need a third chart variant and its own review, so they stay for a later step.
- Refresh jobs were not due in this run (every bundle was rebuilt less than an hour before, after part 1's incident);
  backend-flood-live measured six refreshes (satellite and forecast map) with the same code on 2026-11-05.
