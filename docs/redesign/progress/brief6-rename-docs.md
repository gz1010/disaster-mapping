# Brief 6 rename-docs: progress

Role: rename-docs (builder). Ports: API 8761, Vite 5221. Owned files: see BRIEF-6 role table.

## M1 rename (in progress)
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

## M2 dimming switch
- pending

## M3 docs
- pending
