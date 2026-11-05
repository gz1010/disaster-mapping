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
