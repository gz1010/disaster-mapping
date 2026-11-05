# As built: final check (brief 5)

Role `final-check` (PLAN-5 §10.1, `plan5-roles.json`), 2026-11-05 10:39-11:30 UTC, API 8759 / Vite 5219, on branch
`claude/cool-mayer-ki7to6` from c839471. Folded into CONTRACT §16.16 ("Final check"). Report:
`docs/redesign/reports/final-verification-5.json`.

## What was checked

- **Working tree:** clean at c839471; nothing of the build was left uncommitted.
- **Gates:** backend `uv run pytest -q` 1406 passed, 0 skipped (380 flood tests; none skipped; no network). Web:
  typecheck ok; lint 55 warnings, all in `src/scene` (0 elsewhere); `npm test` 136 files, 1793 passed + 2 skipped (the
  two real-fire data tests `overlayModel.test.ts` and `fireBounds.test.ts`, which skip without the Eaton / Norte bundles;
  no flood test skips); build ok.
- **Screenshots** (`docs/screenshots/brief5-final-*.png`, 22, every one viewed): Public overview in Floods (minimal,
  details), Command overview in Floods, Public flood view (fixture-flood, the real Peace River flood, the demo flash
  flood emergency and the demo watch-only flood on the fixture server), Command flood view (fixture-flood with a
  selected point, the same with the chart's handle 30 h into the forecast: the Flood Warning outline is still drawn and
  `CURSOR_FUTURE_PRODUCTS` shows, and the real Peace River flood with a point), Forensic (fixture-flood; the real
  Toccoa River / Ocoee River flood unprepared, "Prepare 3D data (about 1 min)"), a rotated flood map (35°), reduced
  motion, phones 390 × 844 @2 (Floods overview, Public flood view, Command flood). Fires: the brief-4 set re-shot
  (Public overview minimal and details, Public fire view, Command fire, Forensic fire).
- **Fires unchanged:** pixel difference with `brief4-final-*.png`: Public fire view 0.13 %, Command fire 0.12 %,
  Forensic fire 0.01 %, all in time-relative text (ages, "TIMES IN PST" after Nov 1, NOW); the overviews differ by
  today's live fires (149 active, Nov 5) and the title slot's Fires | Floods switch, as decided (C23).
- **Smoke run** (scratch Playwright script in the session scratchpad, Chrome + SwiftShader):
  - navigation 14/14: the switch (radiogroup, arrow keys, `?hazard=flood`, no history entry); a list row opens its own
    flood (one entry); MORE IN COMMAND keeps the flood; browser Back to the flood overview, Forward back; "Back to all
    floods"; a map marker opens its flood; fire → flood closes the fire with one entry and Back reopens the fire;
  - rotation 24/24 (Public and Command flood views, Floods overview: N, E, Q Q, the turn button, compass click;
    Forensic flood: N, E, Q Q, the turn button);
  - reduced motion 32/32 on 10 flood views (no running CSS / Web animation, no playing SVG animation, the water circle's
    pixels identical 1.5 s apart, E turns at once; control: without reduced motion the circle moves);
  - fixed lines, wording and console 85/85 on 19 views (both fixed lines visible; no banned word outside `data-verbatim`;
    no "fire" in a flood evacuation row; no console error). A basemap glyph range
    (`/fonts/Noto Sans Regular/66560-66815.pbf`) answers 404 from OpenFreeMap's font server near Copperhill: the
    provider's, not an app error.
- **Scans (count only, no value printed):** `FIRMS_MAP_KEY` 0 in 1869 tracked files and 0 in every diff and commit
  message since 1824908; `EARTHDATA_TOKEN` is not set in this container (nothing to leak), and no tracked file or diff
  assigns either name to a 20+ character value; no tracked `data/` or `.env`; 0 values and 0 `Bearer ` in this run's
  server, Vite, screenshot and smoke logs. "FireTrace" 0 in code and UI (only the rule lines in docs and the two guard
  tests that ban it). "safe" / "low risk" / "minimal flood hazard": 0 in UI strings (comments, CSS variables
  `--safe-*`, guard tests and the existing allowed phrase "does not establish the safety of a route or an area" only).

## Fix (small)

- **Crest label under its caret.** In the slim (Command) and dock (Forensic) charts, a crest near the top of the plot
  pinned its label to the plot's top, where the crest caret covered its middle ("CREST 18.0 F▼T FRI 09:30"; seen on
  fixture-flood and the Peace River). `crestLeft(label, crestX, nowX, plotW, beside = false) → number | null` moved
  from `ui/timeline/Hydrograph.tsx` to `ui/timeline/hydrographModel.ts` (pure, tested; a non-component export in the
  `.tsx` would add a lint warning) with `CREST_LABEL_ROOM` (22 px): with less room above the caret the label goes
  beside it (right, else left, still after the NOW label); otherwise unchanged. 5 tests in `hydrographModel.test.ts`.

## Docs

- CONTRACT §16.16 "Final check"; SPEC §10 a "Floods (brief 5)" testing paragraph (the sources role's cut-line item);
  README "Floods (brief 5)" shows two final screenshots (Public fixture, Command real). README otherwise checked: the
  floods section, the optional `EARTHDATA_TOKEN` set-up, the flood CLI, scripts, routes and credits match the build.

## Left (known issues, none blocking)

- Forensic Analysis-tab small multiples (below the cut line; each gauge's "Chart" button shows it in the dock).
- Phones (390 px), Command flood: the selected point's "SELECTED" label can touch a nearby gauge's map label.
- On the fixture server, list-only demo floods in Texas and Colorado show New Mexico's evacuation fixture and "Satellite
  water · unavailable" (fixture limits, not the real API).
- A watch-only flood's third row reads "No NWS river forecast for this gauge" while the flood has no gauge (PLAN-5 §5.3
  `NO_RFC_FORECAST`; its sub-line says the flood has no river gauge).
- The one-time rotate hint covers part of the Command map for its first 12 s (brief-4 behaviour).
- `data/floods/years/2026.json` is still schema 2 here and rebuilds once on its first request (2025 was rebuilt to
  schema 3 during the smoke run).
- Forensic logs three.js's "THREE.Clock … deprecated" warning (since brief 4).
- Integration's list stands: Copperhill's two listings are one event (a decision for the user); the token path is
  tested only with a fake token and a mock transport; refresh jobs were not due in part 2's run; a past flood's satellite
  area can read 0.0 mi² under cloud, with its caveat.
