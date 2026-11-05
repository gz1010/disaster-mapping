# web-flood-command: as built (brief 5)

Role `web-flood-command` (wave 3), PLAN-5 §4.5-4.6, §5; CONTRACT §16.10-16.12. Commits: `M1 hydrograph` (74258f8; most
of the model and its test first landed in the orchestrator's snapshot be1e2d4), `M2 Command flood chrome, readout,
legend chips, Official now` (3d9370c), `M3 layers drawer, model / high-flow / CatFIM / FEMA layers, gauge picker, past
floods, phones, screenshots`, and the report commit. Paths under `web/src/`.

## The river-level chart (M1)

- `ui/timeline/hydrographModel.ts` (pure; tests `hydrographModel.test.ts`, 33 cases):
  `buildHydrograph(input) → HydrographModel`. Input = CONTRACT §16.12 `{ gauge, model, products, nowMs, widthPx, axis,
  units, zone }` **plus** `modelLoading?`, `clock?` (default `'24h'`) and `past?` (a past flood: `nowMs` is its last NWS
  product; empty states say `PAST_NO_FORECAST` and `HYDRO.noReadingsPast`). The model: `lid, name, zone, axis, units,
  unit ('FT' | 'M' | 'FT³/S' | 'M³/S'), unitWord, nowMs, startMs, endMs, vMin, vMax, observed, forecast, forecastJoined,
  model (HydroModelLine[]: name, referenceMs, points), modelState ('none' | 'stage_axis' | 'loading' | 'available' |
  'unavailable'), modelReason, thresholds (HydroThreshold: level, value, label "MINOR 15.0", pinned 'above' | 'below' |
  null), bands (minor → moderate → major → top; none below action), latest (t, v, label "LATEST 11:00 · 4 MIN AGO"
  (+ " · STALE" after 3 h), stale, ageText), crest (t, v, label "CREST 18.0 FT THU 17:00" or "HIGH 10.8 FT AT END ·
  STILL RISING", atEnd), productTicks (t, label "{event} · {sender} · sent {time}", emergency), dayTicks (local
  midnights in the gauge's IANA zone, DST-safe), empty (PLAN-5 §5.5 sentences), observedLabel ("OBSERVED · USGS" from
  the data attribution), forecastLabel ("FORECAST · NWS MBRFC · ISSUED NOV 4 20:47 CST"), modelLabel, hasLevels`.
  - Axis: 72 h before now to the end of the NWS forecast (at least 6 h after now), +72 h without a forecast.
  - Units: NWPS flow is kcfs; everything is converted to ft³/s (`flowToCfs`), metric to m and m³/s.
  - The NWS forecast line starts at the latest reading when its first step is later (`forecastJoined`), as NWS draws it.
  - NWM: flow axis only (D20), only with `gauge.reach_id` (C28), only from a `model_output: true` available answer.
  - NWS levels set in stage units are not drawn on the flow axis (`levelsFor`); the chart says `HYDRO.flowNoStages`.
  - A level far from the data is pinned with an arrow; a level within half the data's span stretches the range; with
    no data the levels set the range.
  - Also exported: `productsAt` (**re-exported** from `official/floodModel.ts`, CONTRACT §16.12), `cursorReadout(m,
    cursorMs, tf) → CursorReadout { t, timeText, line1, modelLine, kind, category, interpolated, future, stale, original
    }` (at now (`null`) the newest reading at its own time; a value between two points is marked "≈"; flow mode: NWS on
    `line1`, "MODEL · NWM · EXPERIMENTAL · 7,630 FT³/S (RUN NOV 4 10:00 MST)" on `modelLine`), `cursorLabel`,
    `stepCursor` (←/→ 1 h, Shift 6 h, Home / End), `clampCursor`, `xFrac`, `yFrac`, `valueAt`, `thinPoints`,
    `levelsFor`, `categoryOf`, `categoryWord`, `valueRange`, `fmtValue`, `unitLabels`, `stageToFt`, `flowToCfs`,
    `isFlowUnit`, `observedSource`, `monoTime`, constants `HYDRO_PAST_MS`, `HYDRO_FUTURE_MS`, `HYDRO_MIN_FUTURE_MS`,
    `HYDRO_STALE_MS` (3 h), `HYDRO_SNAP_MS`, `HYDRO_GAP_MS`, `HYDRO_LEVELS`.
- `ui/timeline/Hydrograph.tsx` (SSR test `Hydrograph.test.ts`, 11 cases):
  `Hydrograph({ variant: 'slim' | 'dock', floodId, lid })` per CONTRACT §16.12 **plus** optional `products` (the NWS
  products ticked; default the open flood's flood-alerts answer), `gauges` (the picker's list; default the open
  flood's gauges answer, members first), `atMs` (a past flood's time; default now), `initialAxis`, `widthPx` (server
  renders and tests) and `className`. `lid` null = the flood's primary gauge. Slim: a 40 px gauge picker, the top line
  (gauge, "nearby" tag when it is not a member, the line key, `STAGE FT | FLOW FT³/S`), the handle's words (2-3 lines:
  value; the model line; `CURSOR_FUTURE_PRODUCTS` after now), a 76 px plot, the axis row (day labels, LATEST). Dock:
  the same without the picker, a 78 px plot, the handle's words over the plot's top. The handle is a `role="slider"`
  (aria-valuetext = its words) driving `useFlood.setCursor`; dragging within 6 px of now, or the "NOW" button, sets
  `null`. No play button. Also exported: `GaugeList({ floodId, lid, gauges?, onPick? })` (the picker's list, used by
  Command's bar) and `Diamond({ tone, size })`.
- `ui/timeline/hydrographData.ts` (test `hydrographData.test.ts`): store `useHydroData` `{ gauges, models, asked }`
  keyed `gaugeKey(lid, atMs)` / `modelKey(floodId, lid)`; `useHydrographData(floodId, lid, { wantModel, atMs })` asks
  `/api/official/river-gauges?lid=&series=1` (and `at_ms` for a past flood) and, only in flow mode for a gauge with a
  reach, `/api/floods/{id}/model?kind=nwm_series&lid=`; refreshed every 10 min while shown; `fetchHydroGauge`,
  `fetchHydroModel`, `gaugeOf`, **`newestReading(g)`** (the status reading or the series' newest row, whichever is
  newer: NWPS's status reading lags its own series by hours on real gauges), **`withChartReading(g, chart)`**,
  `useChartGauge(lid)`.
- `ui/timeline/hydrograph.css` (`.hg-*`).

## The Command flood view (M2, M3)

- `ui/shell/CommandFloodChrome.tsx` replaces the stub, with Command fire's layout and classes: bar (Back to all floods,
  the flood name 18 px `.cfv-title`, LIVE / year, place, DEMO, the view pill, the primary gauge's line "AGYM7 · 26.6 FT ·
  MODERATE · 57 MIN AGO" (the newest of the list's, the flood's gauges answer's and the chart's readings; age amber
  after 3 h; opens `GaugeList`), Show panels, "Official" (phones), Check an address, Layers, menu); the readout; the
  right column (FloodOfficialNow + "Hide"; phones: the sheet "Official flood information"); map controls bar,
  `FloodLegend variant="chips"`, the slim chart (`atMs` = `askedAt(summary)` for a past flood), fixed copy, credits.
  Mounts `useFloodOfficialSync()` and `useFloodLayerDataSync()`.
- `location/FloodReadout.tsx` (test `FloodReadout.test.ts`, 14 cases): CommandReadout's structure (frozen, fire-only,
  untouched): point, DMS · UTM (the bundle's zone, else the point's) · WGS84, `FLOOD_LAST_KNOWN` when resolved from a
  bundle or last-known summary, one tagged line per layer (`checkPoint` at `useFlood.cursorMs`, with the model answer
  only while its layer is on) plus the NWS category map line when on, the nearest gauge (or the primary gauge without a
  point) with stage + own time + attribution + link, category words, flood stage, crest / forecast high / past-date
  row, distance + `GAUGE_OTHER_STREAM`, `NO_GAUGE_NEAR` only for an available answer, the flood rows (FLOOD ID copy,
  PRIMARY GAUGE copy / centre, LAST OFFICIAL UPDATE, demo note), the area figures (C6). Phones: a sheet whose peek is
  the point, else the primary gauge.
- `location/floodCheck.ts` additions (pure): `READOUT_GAUGE_KM`, `onFloodRiver`, `nearestFloodGauge` (the flood's
  rivers first, else at action stage or above, ≤ 25 km), `utmZoneOf`, `lineTag` (OFFICIAL, FORECAST · ISSUED {time},
  SATELLITE · {age at render}, FEMA · EFFECTIVE {date}, MODEL), `catfimLine`, `fmtArea`, `areaFigures`,
  `categoryWords`, `forecastRow(g, tf, units, nowMs, past?)`.
- `state/floodLayerData.ts` (new store `useFloodLayerData` `{ floodId, model, highFlow, catfim, catfimFor, asked }`,
  each an `Answer`): `nwm_analysis` and `nwm_high_flow` model answers and the CatFIM answer for `catfimTarget(summary,
  gauges)` (the primary gauge's NWS forecast category, else its observed category; D22), each asked only while its
  toggle is on; `useFloodLayerDataSync()`, `syncFloodLayerData`, `fetchFloodLayer`, `wantedLayerKeys`,
  `FLOOD_LAYER_REFRESH_MS`.
- `map/floodCommandLayers.ts` (test): Command-only layers kept apart from Public's area layers: CatFIM (a second hatch
  angle `fx-flood-catfim-hatch-img`, dashed edge, "NWS CATEGORY MAP · EXPERIMENTAL"), the model's flooded area (amber
  fill .10, amber dotted edge, "MODEL · EXPERIMENTAL" along it) and high-flow reaches (amber dotted lines + label).
  `catfimFeatures` takes an official CatFIM envelope only; `modelFeatures` / `highFlowFeatures` take model output only.
  `map/floodController.ts` adds them under the NWS warning areas, fills them from `useFloodLayerData`, shows each by
  `floodLayerShown(chrome, key, layers[key])`, and its view gauges use `withChartReading` (one reading per gauge).
- `map/FloodLegend.tsx`: with a flood open, `chips` are the Command flood chips (satellite with its date, no view,
  forecast area, warning area, the four diamonds, FEMA / CatFIM / model / high flow only while on, selected location);
  the details explain CatFIM and the model with their own notes and caveats. Defensive against malformed answers.
- `ui/shell/FloodLayersPanel.tsx` (command variant): CatFIM's description names its gauge and category; a second model
  toggle "National Water Model high-flow reaches (experimental)".
- `ui/feed/FloodOfficialNow.tsx`: the river forecast row's open text is the whole `CREST_LINE` / `FORECAST_HIGH_LINE`.
- `styles/view-command.css`: every `.mw[data-view='command-fire']` rule is now `.mw:is([data-view='command-fire'],
  [data-view='command-flood'])` (same specificity; the fire view is pixel-identical, checked against
  `brief4-final-command-fire-fixture-live.png`). `styles/view-flood-command.css`: the flood-only rules.
- `ui/shell/floodCopy.ts`: new `HYDRO` and `FLOOD_COMMAND` objects (guard-tested with the rest).

## Store changes (additive, wave 3; CONTRACT §16.10)

- `state/flood.ts`: `FloodLayerKey` gains **`'modelHighFlow'`** (default false); `map/floodProfile.ts`: Public false,
  Command `'toggle'`. No other key changed. Forensic keeps its own toggles.
- New stores beside it: `useHydroData` (ui/timeline/hydrographData.ts), `useFloodLayerData` (state/floodLayerData.ts).

## Deviations and decisions

- `productsAt` stays in `official/floodModel.ts` (web-flood-public); `hydrographModel.ts` re-exports it.
- The handle at now (`cursorMs` null) shows the newest reading at its own time (never a value between it and the
  forecast); a set handle shows the value at that time ("≈" when drawn between two points).
- One reading per gauge in Command: the bar, the readout, the map labels and the chart use the newest of the list's
  reading, the flood's gauges answer and the chart's `?lid=` answer including its series' last row (real gauges: the
  status reading lagged the series by 3 h). The series reading's category is NWS's levels compared with the stage.
- The readout's lines describe each answered layer even when that layer is hidden in Layers (as Public's point card).
- `?lid=` answers carry `member: false`; the chart decides membership from the flood's own lists.
- The Official now column has no "View all updates" (there is no flood updates feed); its phone sheet is titled
  "Official flood information".

## For the next roles

- **web-flood-forensic:** `<Hydrograph variant="dock" floodId={id} lid={lid} />` (optional `products` from
  `warnings.json`, `gauges` from `gauges.json`, `atMs` for a past flood). It drives `useFlood.cursorMs`; use
  `productsAt` from `ui/timeline/hydrographModel.ts` for the drapes. `GaugeList` and `Diamond` are exported if a gauge
  picker is wanted in the dock.
- **integration:** CONTRACT 16.12 signatures above (Hydrograph and buildHydrograph extra props, CursorReadout,
  GaugeList, hydrographData, floodLayerData); 16.10 the additive `modelHighFlow` key; small multiples in the dock and a
  data-status block in Official now are open; `location/CoordinateStrip.tsx` (not used in Command flood) still says
  "No fire open" on the flood overview (WFO-R9).
