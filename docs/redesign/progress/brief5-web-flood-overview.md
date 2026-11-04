# brief 5 web-flood-overview: progress

Role: web-flood-overview (builder), ports API 8752 / Vite 5212. Plan: PLAN-5 4.1-4.3, 4.9, 5, 7.3; CONTRACT 16.10-16.13.

## Status

- [x] M1 (committed 22:05 UTC; backend M1 contracts had landed, so it already uses the real flood types): tokens + floodStyle, TintLevel 'flood' + frameFlood, workspace hazard + URL, history
      (one entry per switch), selectors, views.ts five chromes + stub chromes, HazardSwitch, floodCopy.ts + guard test,
      shot.mjs --reduced-motion
- [x] M2 (committed ~22:25 UTC): api/floods.ts, fixtures + edgeCases.ts, state/flood.ts, floodCatalog.ts, floodOverview.ts,
      official/extras/fire-weather checks in flood mode, fetch-spy test
- [ ] M3: map module, FloodStatus, FloodListPanel, FloodLegend, FloodPointCard, Fires-mode line, search, Forensic entry,
      phones, screenshots

## Log

- Started (no earlier attempt found).
- 21:40 M1 started: shot.mjs --reduced-motion, flood tokens + floodStyle (no-green test), TintLevel 'flood'.
- 21:50 floodCopy.ts (all PLAN-5 §5 strings, slots `{x}` + fillCopy) and the guard test (word-bounded, *.test.ts
  excluded, data-verbatim stripped, planted-word test).
- 21:55 backend M1 contracts in git log: api/floods.ts client, state/flood.ts (store, openFlood/closeFlood with
  crossingHazard / replacingHistory flags in state/floodNav.ts), floodCatalog.ts, floodOverview.ts, selectors
  (noEventOpen, openEventKind, currentArea), history (one entry per switch, tests fire→flood→Back, flood→fire→Back, alias
  replace, 404/503), timeZone (flood zone), views (five chromes), stub flood chromes, App (chrome slot, title, bootstrap
  ?flood=, flood polling), HazardSwitch in the overview title slot, frameFlood (framing target 'flood:<id>').
- 22:02 gates: typecheck OK, lint 55 (all src/scene), 1406 web tests pass, build OK.
- 22:10 backend M2 fixture in git log: fixtures copied (plain cp, satellite.png left out: no web test reads it) into
  web/src/api/__fixtures__/floods/, edgeCases.ts (every PLAN-5 §7.3 case, derived cases by the smallest change).
- 22:15 official/runtime.ts + mapLayer.ts: no fire weather in flood mode (fetch and outlines); extras: flood
  evacuations by the flood's bbox with hazard=flood, no cameras/imagery for floods; fetch-spy test (server render with
  effects collected then run once; zustand hooks read current state) for the flood overview and both flood chromes.
- 22:20 tests: api/floods, floodCatalog, floodOverview (rank, kinds, watches, health, never 0 unknown), flood store.
- 22:22 gates: typecheck OK, lint 55 (src/scene only), 1430 tests pass, build OK.
