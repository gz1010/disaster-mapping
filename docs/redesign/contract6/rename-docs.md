# Brief 6 rename-docs: as built

Role: rename-docs (builder). Milestones: M1 17f0d6b (rename), M2 in 126ba1d (wave-1 snapshot: code) + 302bfe5
(screenshots, progress), M3 92b2835 (README, CLAUDE.md name, current docs, this note, report). Review fixes RD-R1..R7:
section 5 (commit "brief 6 rename-docs: review fixes").

## 1. The rename (decision 1)

- **Product name:** "Disaster Mapping" everywhere a person sees it. Uppercase forms: "DISASTER MAPPING" (for example
  `FLOOD_PUBLIC.seenSince`: "SEEN BY DISASTER MAPPING SINCE {MON D YYYY}").
- **Web:** `web/index.html` `<title>Disaster Mapping</title>`, meta description "Disaster Mapping: wildfire and flood
  maps, forecasts and forensics for the lower 48 US states (research prototype, not for operational use)", noscript
  "Disaster Mapping needs JavaScript and WebGL."; the dev pages (`scene-dev.html`, `fx-dev.html`, `extras-dev.html`)
  "Disaster Mapping · … dev". `document.title` (App.tsx): "`<name>`[ · live] · Disaster Mapping", with no event
  `FLOOD_OVERVIEW.titleNoEvent` = "Disaster Mapping · Wildfires and floods". Brand text: `TopBarBrand`
  (`.tb-brand-name`), `Header.tsx` and `FloodHeader.tsx` minibars (`.brand-name`). Every string, template and JSX text
  in `web/src` that said "Fire-3d" now says "Disaster Mapping" (comments too, except files of other roles).
- **Backend:** every message, note, caveat, credit and docstring in `backend/fire3d` (not `contracts.py`,
  `floods/build.py`, `api/floods.py`: backend-flood-time-3d renamed those). FastAPI title "Disaster Mapping API",
  description "Wildfires and floods: maps, forensics and forecasts (SPEC 6)"; CLI description "Disaster Mapping
  backend CLI (wildfires and floods: maps, forensics and forecasts)"; `pyproject.toml` description "Disaster Mapping
  backend: real-data wildfire and flood maps, forensics and forecasts (research prototype)" (uv.lock unchanged).
- **User-Agent:** `config.USER_AGENT` = `"Disaster-Mapping/0.1 (research prototype)"` (a product token cannot hold a
  space). With `FIRE3D_NWS_CONTACT`: "Disaster-Mapping/0.1 (research prototype; <contact>)". Recorder and builder
  scripts: "Disaster-Mapping/0.1 test-sample recorder (…)", "… region builder (…)", "… county GACC builder (…)".
  `fire3d.http`'s cache key does not include the User-Agent, so the download cache stays valid.
- **Scripts:** `make_fixture.py` synthetic product text "[SYNTHETIC] This text is test data for Disaster Mapping, not an
  instruction from any office."; `serve_fixture.py` "Disaster Mapping fixture server".
- **Fixtures:** the committed flood answers `backend/tests/data/floods/fixture_api/**` and their web copy
  `web/src/api/__fixtures__/floods/**` changed only in the renamed strings (equal to a fresh
  `make_fixture.py --only flood --now 2026-11-04T18:00:00Z --copy-api` run of the M1 code; checked by
  `test_committed_copy_matches_a_fresh_run`).
- **Kept (internal):** the `fire3d` package, `FIRE3D_*` settings, URL parameters, storage keys (`fire3d.*`,
  `fire3d:annotations:*`), history state key `fire3d`, CSS classes, scene object names (`fire3d-terrain`), thread names
  (`fire3d-flood-live-refresh`), file names, the npm package name `fire3d-web`. Kept (historical): earlier
  BRIEF/PLAN/RUNBOOK files, reports, audits, progress notes, contract3/5, handoff-4, test-data `PROVENANCE.md` files and
  `caloes_brief2_expected.json`, `docs/dev/module-reports.md`, `PLAN.md`. Not touched: `.claude/hooks/cloud_install.sh`
  (configuration), `backend/fire3d/data/gazetteer_us.json` (generated data; its note is not served; the builder's note
  text is renamed for the next rebuild).
- **Guards:** `web/src/lib/productName.test.ts` parses every non-test `web/src/**/*.{ts,tsx}` with the TypeScript
  compiler and fails on `/Fire[- ]?3[dD]|FIRE[- ]3D/` in any string literal, template part or JSX text (comments are
  not scanned; lowercase `fire3d` and the slug `fire-3d` are allowed), and checks every `web/*.html` page's title.
  `backend/tests/test_product_name.py` tokenizes every `backend/fire3d/**/*.py` and `backend/scripts/**/*.py` and fails
  on the same pattern in any string or f-string part; it reads the User-Agent from `config.py`'s source (recorder
  scripts that some tests import reassign `config.USER_AGENT`).
- `backend/tests/test_floods_evacuations.py`: the flood local-alerts wording check no longer strips the app's name
  before asserting that "fire" is absent (stricter now that the name has no "fire").
- **CONTRACT.md:** every quoted string renamed (16.14's as-built table is tested word for word against the code); the
  header says "The app is **Disaster Mapping** (called Fire-3d until brief 6; never "FireTrace")"; the 15.x line on
  the Forensic bar now says the brand word hides at ≤ 1720 px.
- **Forensic top bar (rename follow-up):** `styles/header.css` hides `.fx-bar .tb-brand-name` at
  `max-width: 1720px` (was 1400 px): the longer name cut the flood's place and date lines at 1440-1600 px. The logo
  mark stays.
- **Overview top bar (review RD-R1):** `styles/map-layout.css` `@media (min-width: 1024px) and (max-width: 1279px)`
  hides `.mw-header .tb-brand-name` visually (the phone rule's clip: `position: absolute; width/height 1px; overflow:
  hidden; clip: rect(0 0 0 0)`), so the words stay for screen readers and the logo mark stays. Without it the name
  (about 150 px) pushed the Fires | Floods switch under the centre view pill: Floods could not be clicked up to about
  1150 px. 761-1023 px (pill in the menu) and from 1280 px the name shows. Only the overview bar has the brand inside
  `.mw-header` (fire and flood views do not show it). `web/scripts/check-topbar.mjs <base-url> [--widths …]
  [--backend swiftshader]` loads `/?preset=public|command[&hazard=flood]` at each width and fails when a left item,
  the centre pill or a right item overlap, or when `elementFromPoint` at the middle of a Fires / Floods / view button
  hits something else (measured: all 36 pages pass at 768, 900, 1023, 1024, 1100, 1180, 1279, 1280 and 1440 px).
  Test `ui/shell/overviewBrand.test.ts` (the rule, its 1024 lower bound matching the pill's 1023 px menu rule, the
  name still in the markup). CONTRACT §15 breakpoint line updated.

## 2. Zoom dimming (decision 4)

- `web/src/map/zoomDimming.ts`: `ZOOM_DIMMING_KEY = 'fire3d.zoomDimming'` (localStorage, "1" on / "0" off),
  `ZOOM_DIMMING_DEFAULT = false`, `readZoomDimming(storage?)` (true only for "1"; missing storage, a throwing storage
  or any other value → false), `writeZoomDimming(on, storage?)` (never throws). Strings: `DISPLAY_SECTION_TITLE =
  'Display'`, `ZOOM_DIMMING_LABEL = 'Zoom dimming'`, `ZOOM_DIMMING_DESC = "Darkens the map's edges more as you zoom
  in, like the rim of a globe. Off by default; remembered in this browser. The soft shading behind the panels' text
  stays either way."`
- `useWorkspace`: `zoomDimming: boolean` (initial `readZoomDimming()`; not in the URL), `setZoomDimming(on)` (writes
  storage, then sets state). `window.__workspace` already exposes the store for screenshots
  (`--eval "window.__workspace.getState().setZoomDimming(true)"`).
- `map/MapAtmosphere.tsx`: sets `data-vignette="on" | "off"` on `.mw-atmo`; the zoom subscription, the strength
  (`--mw-vignette`) and the geometry (`--mw-vig-x/y/r`) run only while on.
- `styles/atmosphere.css`: `.mw-atmo:not([data-vignette='on'])::before { opacity: 0; }` (off also before the script
  marks the layer); the existing 160 ms opacity transition fades it in and out (none under reduced motion). The static
  edge gradients (`::after`, per `data-edges`) are unchanged.
- `ui/shell/ZoomDimmingSwitch.tsx`: `ZoomDimmingSwitch` (a `.mw-check-list` row: `<input type="checkbox"
  role="switch" class="mw-switch">` with label and description; the native checked state is its state, no
  `aria-checked` on top (review RD-R6)) and `DisplaySection` (`<section class="mw-set">` with `<h3>Display</h3>`).
  `.mw-check-row input.mw-switch` (`styles/map-layout.css`) draws it as the small pill switch of "Show watches"
  (26 x 14 px track `rgba(200,200,200,.22)`, 10 px knob `#e6e6e6`; on: track `--m-accent`, knob `--m-accent-ink`,
  moved 12 px; focus ring 2 px accent; no transition under reduced motion). Mounted after Units in `LayersPanel`
  (overview, Public fire, Command fire) and `FloodLayersPanel` (Public and Command flood).
- Tests: `map/zoomDimming.test.ts` (default off with empty, missing or refusing storage; "1"/"0"; never throws; the
  workspace switch turns on and off and remembers; the stylesheet gates only `::before`), `ui/shell/
  ZoomDimmingSwitch.test.ts` (off by default, on from state, no `aria-checked`, the pill switch rules, Display
  section, wording guard, present in both drawers).
- CONTRACT §15.1 (runtime variables: `data-vignette`) and the §15 "Globe-like dimming and tint" paragraph now say the
  vignette is off by default and list these interfaces (review RD-R4).

## 3. Docs

- `README.md`: new, for Disaster Mapping (fires and floods): what it is, a glossary, official / measured / experimental,
  the three views for fires and for floods, using the map (Layers & settings, Zoom dimming, 2D/3D, turning, keyboard,
  links), running on a Mac step by step (tools, clone of `gz1010/disaster-mapping`, `uv sync --frozen`, `npm ci`,
  optional `.env` with `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`, `./dev.sh --no-live`, first run, demo data), how it works
  (data flow, command line, scripts, HTTP API and architecture folded), the fire forecast and its scores, known limits
  (everywhere, wildfires, floods), troubleshooting, every data source credit of the old README (fires and floods), the
  docs map and "About the name". Review fixes (RD-R2, R3, R5): the eight README screenshots re-shot with the new name
  (`docs/screenshots/brief6-rename-docs-readme-*.png`, Nov 5 2026; the "still reads Fire-3d" line is gone); "How it
  works" step 3 describes the flood's time history (`timeline.json`) and the three 3D terrain products; the scripts
  table has `scripts/flood_3d.py`; the HTTP API table has `/api/floods/{id}/timeline?wait=0..30` and
  `/api/floods/{id}/passes/{key}.png?area=<8 hex>`; the flood credits say the NWM river lines feed the height above the
  river and the IEM archive feeds earlier product versions; Known limits → Floods gives the exact re-prepare commands
  (`uv run python -m fire3d.cli build-flood <flood id> --force`, `uv run python scripts/make_fixture.py --only flood`);
  the troubleshooting row says "Zoom dimming" darkens the edges more as you zoom in and that the fixed shading behind
  the side panels stays (hide the panels with `H`).
- `CLAUDE.md`: the name only (title, first line, the ports line); rules unchanged. `docs/validation.md` title,
  `docs/cloud/SETUP.md` (name, repository `gz1010/disaster-mapping`), `docs/cloud/environment-setup.sh` and `dev.sh`
  header comments.

## 4. For other roles

- **backend-flood-time-3d (their review R11) / final-check:** flood bundles prepared before the rename keep "Fire-3d"
  in stored app notes (the satellite login note and the "could not load a measured satellite water image" reason in
  `manifest.json` `layer_status.water_satellite.reason` / `warnings` and `satellite.json` `login_note` / `reason`) until
  prepared again. In this container (review RD-R2): `fixture-flood` re-made (`make_fixture.py --only flood`), Grand
  River re-prepared with `build-flood … --force` (its satellite layer is now "unavailable": no measured image in the
  last 10 days), and the other seven real floods' stored notes rewritten in place offline (only `reason`,
  `login_note`, `warnings` strings of `manifest.json` / `satellite.json`, the same text a re-prepare writes; their data
  untouched, so the wave-2 roles' St Johns and Calcasieu 3D bundles stay as they are). `data/` now holds no "Fire-3d"
  (count-only scan, 0 files). A user's own older bundles still need a re-prepare (README command) unless the server
  replaces the old notes when serving: `api/floods.py` `_json()` is the one place every flood answer passes; a
  replace of the old SAT_NOT_SET_UP / SAT_LOGIN_REFUSED / no-image texts by the current `fcopy` ones there (or in
  `floods/store.py load_flood_manifest` plus the `_load` of `satellite.json`) heals them; that file is
  backend-flood-time-3d's. If they add it, final-check should shorten the README's Known limits → Floods line.
- **final-check:** the README's flood Command and Forensic paragraphs and the Keyboard line (`Space` plays a fire's
  timeline) describe brief 5 behaviour; add the playback controls and the 3D flood view (the "Height ×5" boost and its
  control, "Estimated depth (from the terrain at the water's edge), experimental", "Height above the river (from
  terrain). Not a flood map" off by default, the closer framing, the "No satellite image between …" wording) with the
  labels as built by web-flood-playback and web-forensic-flood-3d, and replace the README's Command flood and Forensic
  flood pictures with brief-6 final shots.
- **final-check:** run `node web/scripts/check-topbar.mjs http://localhost:<vite-port> --backend swiftshader` (exit 0 =
  no overlap in the overview bar at 1024-1440 px).

## 5. Review fixes (reports/review6-rename-docs.json)

- **RD-R1 (major, fixed):** overview bar name word hidden at 1024-1279 px (section 1), check script, test, CONTRACT.
- **RD-R2 (minor, fixed here; serving-time heal proposed):** see section 4; README re-prepare commands.
- **RD-R3 (minor, fixed in part):** README pictures re-shot, timeline and pass routes, flood products, scripts row;
  the brief-6 playback and 3D view wording waits for those roles (section 4, final-check).
- **RD-R4 (nit, fixed):** CONTRACT §15 says the vignette is off by default, with every brief-6 interface.
- **RD-R5 (nit, fixed):** README troubleshooting row reworded (fixed side shading stays; `H` hides the panels).
- **RD-R6 (nit, fixed):** the switch keeps its native checkbox with `role="switch"`, drops `aria-checked`, and is
  drawn as the app's pill switch.
- **RD-R7 (nit, fixed):** `styles/view-flood-public.css`, phones (≤ 760 px), only when the bar holds the DEMO badge
  (`.pfv-bar .tb-left:has(> .ffv-demo)`): the left side is a grid (X | place | DEMO on the first row; the date line
  spans the place and the badge columns on the second; the X centred on both; the title block `display: contents`).
  "SEEN BY DISASTER MAPPING SINCE NOV 4 2026" now takes two lines (was three) and the place sits 7 px from the screen's
  top (was about 2 px). Real floods (no badge) and wider screens are unchanged.
