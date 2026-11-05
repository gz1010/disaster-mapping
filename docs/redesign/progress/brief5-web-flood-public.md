# brief5 web-flood-public: progress

Role `web-flood-public` (wave 2), PLAN-5 §4.4, CONTRACT §16.10-16.12. Ports API 8754 (fixture server), Vite 5214.

## Status

- [x] M1 HazardDisc split (fire markup byte-identical, checked before/after with a temporary SSR capture), WaterTexture
  verbatim, FloodHazardCircle, FloodTitle, status words and meanings (`ui/public/floodView.ts`), Public flood chrome.
- [ ] M2 floodModel + floodHooks (envelope-status rule), FloodEvacRows, FloodFacts per kind, FloodKey, areaDistance +
  DistanceChip props, startFloodBuild + job polling (canned job, then the real route after bundle-api M2).
- [ ] M3 map area layers, leader, FloodPointCard variant + floodCheck, FloodOfficialNow, FloodLayersPanel, phones,
  screenshots.
- [ ] Gates, report, as-built note.

## Notes

- Fixture server: `cd backend && uv run python scripts/serve_fixture.py --port 8754`; Vite 5214.
- `productsAt` lives in `official/floodModel.ts` (web-flood-command's hydrographModel should re-export it).
- New additive store key `useFlood.buildError` (C10).
