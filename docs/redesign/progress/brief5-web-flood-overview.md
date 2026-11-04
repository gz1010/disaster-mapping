# brief 5 web-flood-overview: progress

Role: web-flood-overview (builder), ports API 8752 / Vite 5212. Plan: PLAN-5 4.1-4.3, 4.9, 5, 7.3; CONTRACT 16.10-16.13.

## Status

- [x] M1 (committed 22:05 UTC; backend M1 contracts had landed, so it already uses the real flood types): tokens + floodStyle, TintLevel 'flood' + frameFlood, workspace hazard + URL, history
      (one entry per switch), selectors, views.ts five chromes + stub chromes, HazardSwitch, floodCopy.ts + guard test,
      shot.mjs --reduced-motion
- [x] M2 (committed ~22:25 UTC): api/floods.ts, fixtures + edgeCases.ts, state/flood.ts, floodCatalog.ts, floodOverview.ts,
      official/extras/fire-weather checks in flood mode, fetch-spy test
- [x] M3 (committed ~23:15 UTC): map module, FloodStatus, FloodListPanel, FloodLegend, FloodPointCard, Fires-mode line, search, Forensic entry,
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
- 22:30-23:05 M3: overviewLayers options (fire defaults unchanged), floodLayers / floodController / floodProfile, the
  flood module in mapController (fire markers hidden, focus off, clicks and hover routed), LeaderLabels in Floods,
  FloodStatus, FloodListPanel (+ pill, notices, missing notice), FloodLegend, FloodPointCard + Fires-mode line,
  floodOverviewText (pure words + point model), flood search, Forensic entry page, LayersPanel flood legend and gauges
  toggle, flood credits, stub chrome CSS.
- 23:05 screenshots (fixture server on 8752, Vite 5212; fire regression with the real API): every one viewed.
- 23:10 gates: typecheck OK, lint 55 (src/scene only), 1457 web tests pass, build OK, backend 1213 pass.
- Report and as-built note written; servers stopped after the last screenshot.

## Review fixes (WFO-R1..R13)

- [x] Review fixes (started before a container restart; the code reached git in the work-in-progress snapshots c69c324
      and e155020; finished and committed as "brief 5 web-flood-overview: review fixes").
- 23:30 continued from the snapshot: R1 history (`fromOverview` only when no event was open), R2 notice mounted, R3
  `archive_down`, R4 both-down bar, R5 `linkWithBothUrl` + stale `?flood=`, R6 distance note, R7 gauge reading time /
  attribution / link (card and hover), R8 `floodGaugeStatus.ts` outage line, R10 28 px pill, R11 h1, R13 strings moved.
- 23:35 R12: the stub calls `useMapTint('flood')`; R11 reordered (hidden hazard word before the `aria-hidden` dot); R13
  also the tab tips, peek bar and legend prose. Typecheck OK.
- 23:38-23:42 Playwright probes on the fixture server (8752 / 5212): R1 both directions PASS, R2 404 and 503 PASS, R3
  PASS (route interception), R4 PASS, R5 PASS (start, Back, reload), R8 PASS, R10 28 px, R11 h1 text, R7 gauge hover
  shows "reading Nov 4, 3:00 PM MST (2 h ago)", R12 tint 'flood' in the stub and null elsewhere.
- 23:43-23:47 gates: typecheck OK, lint 55 (src/scene only), 1469 web tests pass, build OK, backend 1225 pass.
- 23:47-23:53 screenshots retaken and viewed (fixture server; public-fires and the real 2026 tab on the real API with
  FIRE3D_LIVE=0); servers stopped.
- 23:53 R8 refined: the outage line also on the year tabs (the map draws today's gauges there), not on Forensic's entry
  page; test extended. Reports and the as-built note updated (R9 skipped: CoordinateStrip.tsx is the integration's).
