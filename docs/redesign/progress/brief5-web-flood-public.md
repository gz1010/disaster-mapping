# brief5 web-flood-public: progress

Role `web-flood-public` (wave 2), PLAN-5 §4.4, CONTRACT §16.10-16.12. Ports API 8754 (fixture server, and the real API
with FIRE3D_LIVE=0 for the real flood and the build check), Vite 5214. Both stopped at the end.

## Status: done

- [x] M1 HazardDisc split (fire markup byte-identical, checked before/after with a temporary SSR capture), WaterTexture
  verbatim, FloodHazardCircle, FloodTitle, status words and meanings (`ui/public/floodView.ts`), Public flood chrome.
- [x] M2 floodModel + floodHooks (envelope-status rule), FloodEvacRows, FloodFacts per kind, FloodKey, areaDistance +
  DistanceChip props, startFloodBuild + job polling (canned job; then the real route: a real flood prepared end to end).
- [x] M3 map area layers, leader, FloodPointCard variant + floodCheck, FloodOfficialNow, FloodLayersPanel, phones,
  screenshots (9, all viewed).
- [x] Gates (backend 1323 passed, 0 skipped; web typecheck, lint 55 all in src/scene, 1573 tests, build), report
  `reports/brief5-web-flood-public.json`, as-built note `contract5/web-flood-public.md`.

## Notes

- Fixture server: `cd backend && uv run python scripts/serve_fixture.py --port 8754`; Vite 5214.
- `productsAt` lives in `official/floodModel.ts` (web-flood-command's hydrographModel should re-export it).
- New additive store key `useFlood.buildError` (C10); new store `useFloodOfficial` (official/floodHooks.ts).
- Cut line left: the GIBS picture drawing (off), the 1024 px layout pass.

## Review fixes (WFP-R1..R12), 2026-11-05: done

- [x] R1 failed or loading satellite / forecast-area answers: key, status, legend, point card (no NOTHING_COVERS)
- [x] R2 one reading per gauge (newer of the list's and the gauges answer's): leader diamond, stage row, map label
- [x] R3 area-sync key includes the satellite answer (image edge on first open)
- [x] R4 amber stale tone in the Public flood facts
- [x] R5 failed request: RFC_FIM_UNAVAILABLE and a flood-worded evacuation outage line (detail in the tooltip)
- [x] R6 flood layer credits in the foot credits when the key is hidden (panels collapsed, phones)
- [x] R7 detection, damage threat, watch area rows: sent time in the issuer's zone and a link
- [x] R8 DSWx snow/ice (252), ocean (254), transparent picture pixels: no "saw no water" claim
- [x] R9 build-job poll retries with backoff before failing
- [x] R10 productsAt location documented (no code change; Command re-exports)
- [x] R11 NWS event names verbatim in the point card lines
- [x] R12 no-gauge forecast row sub-line

- Gates: backend 1340 passed (0 skipped); web typecheck clean, lint 55 (all src/scene), 1603 tests passed (2 skipped,
  pre-existing), build ok. Screenshots retaken and viewed: fixture, flash, watch (clock fixed at 2026-11-05 01:16 UTC),
  outage, collapsed credits, phone credits, real (Grand River), real below stage (St Lucie River), real flash
  (Chatsworth). Servers on 8754 / 5214 stopped. Report `reports/review5-web-flood-public.json`.
