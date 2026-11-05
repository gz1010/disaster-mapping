# Brief 6 rename-docs: progress

Role: rename-docs (builder). Ports: API 8761, Vite 5221. Owned files: see BRIEF-6 role table.

## M1 rename (done, 17f0d6b)
- Done: "Fire-3d" -> "Disaster Mapping" ("FIRE-3D" -> "DISASTER MAPPING") in web/src (strings and comments),
  web/*.html (title, description, noscript), backend/fire3d strings, docstrings and comments, backend/scripts,
  backend/tests asserting old strings, the flood fixture copies (backend/tests/data/floods/fixture_api and
  web/src/api/__fixtures__/floods: only the renamed strings). User-Agent: "Disaster-Mapping/0.1 (research prototype)".
- Not touched (other role or historical): backend/fire3d/contracts.py, floods/build.py, api/floods.py,
  web/src/api/floodTypes.ts, SPEC.md (backend-flood-time-3d); test-data PROVENANCE.md files and
  caloes_brief2_expected.json (records of past recordings); fire3d/data/gazetteer_us.json (generated data, its note is
  not served); .claude/hooks (configuration).
- Guards: web/src/lib/productName.test.ts (TypeScript AST: strings, templates, JSX text; HTML pages),
  backend/tests/test_product_name.py (tokenize: strings and f-string parts; the User-Agent).
- test_floods_evacuations: the flood wording check no longer strips the app name before looking for "fire".

- Follow-up in M2's commit: one regex literal in location/FloodReadout.test.ts ended in "Fire-3d/" and got the
  User-Agent form ("Disaster-Mapping/"); fixed to "Disaster Mapping/".

## M2 dimming switch (done)
- map/zoomDimming.ts (key `fire3d.zoomDimming`, read/write wrapped in try/catch, default off), useWorkspace
  `zoomDimming` + `setZoomDimming`, MapAtmosphere marks `data-vignette="on|off"` and follows the zoom only while on,
  atmosphere.css hides `::before` unless on (edge gradients `::after` unchanged).
- ui/shell/ZoomDimmingSwitch.tsx: `DisplaySection` ("Display" / "Zoom dimming", checkbox role="switch") after Units in
  LayersPanel (overview, fires) and FloodLayersPanel (floods, Public and Command).
- Tests: map/zoomDimming.test.ts, ui/shell/ZoomDimmingSwitch.test.ts.
- Rename follow-up: the Forensic bar's brand word now hides up to 1720 px (was 1400): with the longer name the place
  and date lines were cut at 1440-1600 px. CONTRACT 15 line updated.
- Screenshots: brief6-rename-docs-public-fire-dimming-off/on, -public-overview, -command-overview-floods,
  -forensic-flood-header (1440: brand word hidden, place and date whole) and -forensic-flood-header-1760 (brand word
  shown), -public-flood-seen-since, -phone-public-flood-seen-since (fixture server: "SEEN BY DISASTER MAPPING SINCE",
  three lines on a phone).
- Found: flood bundles built before the rename keep the old name in stored notes (satellite login note in
  data/floods/*/manifest.json and satellite.json) until rebuilt; note for backend-flood-time-3d / final-check.

## M3 docs (done)
- README.md rewritten for Disaster Mapping (fires and floods): glossary, official / measured / experimental, the three
  views for fires and floods, using the map (Zoom dimming), Mac step by step (clone gz1010/disaster-mapping, uv sync
  --frozen, npm ci, .env keys, ./dev.sh --no-live, demo data), how it works, the fire forecast, known limits (everywhere,
  fires, floods), troubleshooting, every credit table, docs map, About the name. Anchors and file links checked.
- CLAUDE.md name only; docs/validation.md title; docs/cloud/SETUP.md (name, repository); environment-setup.sh and dev.sh
  header comments.
- contract6/rename-docs.md (as built) and reports/brief6-rename-docs.json written.
- Gates (final): web typecheck, lint (55 warnings, all src/scene), 139 test files / 1809 tests, build: all pass;
  backend 1441 passed.
