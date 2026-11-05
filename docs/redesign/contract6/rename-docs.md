# Brief 6 rename-docs: as built

Role: rename-docs (builder). Milestones: M1 17f0d6b (rename), M2 in 126ba1d (wave-1 snapshot: code) + 302bfe5
(screenshots, progress), M3 (README, CLAUDE.md name, current docs, this note, report).

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
  mark stays. Overview and Command bars are unchanged (the name fits at 1440).

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
  role="switch" aria-checked>` with label and description) and `DisplaySection` (`<section class="mw-set">` with
  `<h3>Display</h3>`). Mounted after Units in `LayersPanel` (overview, Public fire, Command fire) and
  `FloodLayersPanel` (Public and Command flood).
- Tests: `map/zoomDimming.test.ts` (default off with empty, missing or refusing storage; "1"/"0"; never throws; the
  workspace switch turns on and off and remembers; the stylesheet gates only `::before`), `ui/shell/
  ZoomDimmingSwitch.test.ts` (off by default, on from state, Display section, wording guard, present in both drawers).

## 3. Docs

- `README.md`: new, for Disaster Mapping (fires and floods): what it is, a glossary, official / measured / experimental,
  the three views for fires and for floods, using the map (Layers & settings, Zoom dimming, 2D/3D, turning, keyboard,
  links), running on a Mac step by step (tools, clone of `gz1010/disaster-mapping`, `uv sync --frozen`, `npm ci`,
  optional `.env` with `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`, `./dev.sh --no-live`, first run, demo data), how it works
  (data flow, command line, scripts, HTTP API and architecture folded), the fire forecast and its scores, known limits
  (everywhere, wildfires, floods), troubleshooting, every data source credit of the old README (fires and floods), the
  docs map and "About the name". Screenshots reused: brief4-final-* and brief5-final-* (they show the old name; the
  README says so).
- `CLAUDE.md`: the name only (title, first line, the ports line); rules unchanged. `docs/validation.md` title,
  `docs/cloud/SETUP.md` (name, repository `gz1010/disaster-mapping`), `docs/cloud/environment-setup.sh` and `dev.sh`
  header comments.

## 4. For other roles

- **backend-flood-time-3d / final-check:** flood bundles prepared before the rename keep "Fire-3d" in stored notes
  (the satellite login note in `data/floods/*/manifest.json` and `satellite.json`; 27 files in this container) until
  they are prepared again; the canned answers of `make_fixture.py --only flood` in `data/floods/*/api/` too. Re-running
  `make_fixture.py --only flood` and re-preparing the real floods clears it. Optionally `api/floods.py` could replace
  the old name in stored notes when serving them.
- **final-check:** the README's flood Command and Forensic paragraphs describe brief 5 behaviour; add the playback
  controls and the 3D flood view (height boost, depth tint, low-ground shading, framing) once built, with their exact
  labels, and re-shoot the README screenshots with the new name if wanted.
- **final-check:** on a 390 px phone the Public flood title's date line "SEEN BY DISASTER MAPPING SINCE NOV 4 2026"
  wraps to three lines (it fits on one line at 1440 px); it does not overlap the water circle.
