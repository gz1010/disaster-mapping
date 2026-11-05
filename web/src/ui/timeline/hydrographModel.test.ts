// The river-level chart's model (PLAN-5 §4.6, D13, D20, C1, C7, C28): scales, NWS flood levels (pinned when out of
// range), the observed / forecast split, the model on the flow axis only and never without a reach, the flow-mode
// handle lines, stale after 3 h, the handle's words, productsAt on both sides of now, crest and "high at the end",
// product ticks, empty states, DST-safe day ticks and metric units.
import { describe, expect, it } from 'vitest'
import { ALERTS, FIXTURE_NOW_MS, GAUGE_NO_FORECAST, GAUGE_NOT_CURRENT, GAUGE_NOT_DEFINED, GAUGE_RISING_AT_END, MODEL_SERIES, MODEL_UNAVAILABLE } from '../../api/__fixtures__/floods/edgeCases'
import zzrf1 from '../../api/__fixtures__/floods/river-gauges-ZZRF1.json'
import type { ModelOutputResponse, RiverGauge, RiverGaugesResponse } from '../../api/types'
import { HOUR_MS, type TimeFmt } from '../../lib/time'
import { CURSOR_FUTURE_ISSUED, CURSOR_FUTURE_PRODUCTS, floodWordingProblems, HYDRO, HYDROGRAPH_EMPTY, PAST_NO_FORECAST } from '../shell/floodCopy'
import {
  buildHydrograph,
  categoryOf,
  clampCursor,
  cursorLabel,
  cursorReadout,
  flowToCfs,
  fmtValue,
  forecastFalling,
  futureProductsNote,
  handleRowHeight,
  HYDRO_PAST_MS,
  levelsFor,
  listKeyTarget,
  productsAt,
  productsShown,
  stepCursor,
  thinPoints,
  valueAt,
  xFrac,
  yFrac,
  type HydrographInput,
} from './hydrographModel'

const NOW = FIXTURE_NOW_MS
const TF: TimeFmt = { tz: 'America/Denver', clock: '24h' }
const primary = (): RiverGauge => structuredClone((zzrf1 as unknown as RiverGaugesResponse).gauges[0])

function build(over: Partial<HydrographInput> = {}) {
  return buildHydrograph({
    gauge: primary(),
    model: null,
    products: ALERTS().alerts,
    nowMs: NOW,
    widthPx: 800,
    axis: 'stage',
    units: 'us',
    zone: 'America/Denver',
    clock: '24h',
    ...over,
  })
}

describe('hydrographModel: axes and scales', () => {
  it('runs from 72 h before now to the end of the NWS forecast', () => {
    const m = build()
    const g = primary()
    expect(m.startMs).toBe(NOW - HYDRO_PAST_MS)
    expect(m.endMs).toBe(g.series!.forecast[g.series!.forecast.length - 1][0])
    expect(xFrac(m, m.startMs)).toBe(0)
    expect(xFrac(m, m.endMs)).toBe(1)
  })

  it('ends 72 h after now without a forecast', () => {
    const g = GAUGE_NO_FORECAST()
    const m = build({ gauge: g })
    expect(m.endMs).toBe(NOW + 72 * HOUR_MS)
    expect(m.forecast).toEqual([])
  })

  it('every plotted value lies inside the value range; y is 0 at the top', () => {
    const m = build()
    for (const p of [...m.observed, ...m.forecast]) {
      expect(p.v).toBeGreaterThanOrEqual(m.vMin)
      expect(p.v).toBeLessThanOrEqual(m.vMax)
    }
    expect(yFrac(m, m.vMax)).toBeCloseTo(0)
    expect(yFrac(m, m.vMin)).toBeCloseTo(1)
  })

  it('thins the observed record to the plot width but keeps the latest reading and the peak', () => {
    const g = primary()
    const full = g.series!.observed.length
    const m = build({ widthPx: 60 })
    expect(m.observed.length).toBeLessThan(full)
    expect(m.observed[m.observed.length - 1].t).toBe(g.series!.observed[full - 1][0])
    const peak = Math.max(...g.series!.observed.map((r) => r[1] ?? -Infinity))
    expect(Math.max(...m.observed.map((p) => p.v))).toBeCloseTo(peak)
    expect(thinPoints([{ t: 1, v: 1 }], 0, 10, 100)).toHaveLength(1)
  })
})

describe('hydrographModel: NWS flood levels', () => {
  it('labels each level on the right ("MINOR 15.0") with faint bands above minor and none below action', () => {
    const m = build()
    expect(m.thresholds.map((t) => t.level)).toEqual(['action', 'minor', 'moderate', 'major'])
    expect(m.thresholds.find((t) => t.level === 'minor')!.label).toBe('MINOR 15.0')
    expect(m.bands.map((b) => b.level)).toEqual(['minor', 'moderate', 'major'])
    expect(m.bands[0]).toMatchObject({ from: 15, to: 17 })
    expect(m.bands.some((b) => (b.level as string) === 'action')).toBe(false)
  })

  it('pins a level far outside the data to the edge with an arrow', () => {
    const g = primary()
    g.thresholds = { unit: 'ft', action: 13, minor: 15, moderate: 17, major: 60 }
    const m = build({ gauge: g })
    const major = m.thresholds.find((t) => t.level === 'major')!
    expect(major.pinned).toBe('above')
    expect(major.label).toBe('MAJOR 60.0 ↑')
    expect(m.vMax).toBeLessThan(60)
    const low = primary()
    low.thresholds = { unit: 'ft', action: 0.5, minor: 15, moderate: 17, major: 19 }
    expect(build({ gauge: low }).thresholds.find((t) => t.level === 'action')!.pinned).toBe('below')
  })

  it('a level just above a rising river stretches the range (flood stage visible)', () => {
    const g = GAUGE_RISING_AT_END()
    const m = build({ gauge: g })
    const minor = m.thresholds.find((t) => t.level === 'minor')!
    expect(minor.pinned).toBeNull()
  })

  it('flood levels set as river stages are not drawn on the flow axis (and the chart says so)', () => {
    const m = build({ axis: 'flow' })
    expect(m.thresholds).toEqual([])
    expect(m.hasLevels).toBe(false)
    expect(m.empty).toContain(HYDRO.flowNoStages)
    expect(levelsFor(primary(), 'stage', 'us')).toEqual({ action: 13, minor: 15, moderate: 17, major: 19 })
  })

  it('category words from the NWS levels, never a raw value', () => {
    const lv = levelsFor(primary(), 'stage', 'us')
    expect(categoryOf(12, lv)).toBe('no_flooding')
    expect(categoryOf(13, lv)).toBe('action')
    expect(categoryOf(17.6, lv)).toBe('moderate')
    expect(categoryOf(25, lv)).toBe('major')
    expect(categoryOf(5, {})).toBeNull()
  })
})

describe('hydrographModel: series and marks', () => {
  it('splits observed (until the latest reading) and the NWS forecast, joined to the latest reading', () => {
    const m = build()
    expect(m.observed.every((p) => p.t <= NOW)).toBe(true)
    expect(m.forecastJoined).toBe(true)
    expect(m.forecast[0].t).toBe(m.latest!.t)
    expect(m.forecast.slice(1).every((p) => p.t > NOW)).toBe(true)
    expect(m.observedLabel).toBe('OBSERVED · USGS')
    expect(m.forecastLabel).toMatch(/^FORECAST · NWS ZZRFC · ISSUED NOV 4 09:00 MST$/)
  })

  it('LATEST with its time and age; amber STALE after 3 h', () => {
    const m = build()
    expect(m.latest!.label).toBe('LATEST 11:00 · JUST NOW')
    expect(m.latest!.stale).toBe(false)
    const later = build({ nowMs: NOW + 3 * HOUR_MS + 60_000 })
    expect(later.latest!.stale).toBe(true)
    expect(later.latest!.label).toMatch(/^LATEST 11:00 · 3 H AGO · STALE$/)
    const notCurrent = build({ gauge: GAUGE_NOT_CURRENT() })
    expect(notCurrent.latest!.stale).toBe(true)
  })

  it('crest caret with its value and day; HIGH … AT END · STILL RISING when the highest value is the last step (C7)', () => {
    const m = build()
    expect(m.crest!.atEnd).toBe(false)
    expect(m.crest!.label).toBe('CREST 18.0 FT THU 17:00')
    const rising = build({ gauge: GAUGE_RISING_AT_END() })
    expect(rising.crest!.atEnd).toBe(true)
    expect(rising.crest!.label).toBe('HIGH 10.8 FT AT END · STILL RISING')
  })

  it('NWS product times as ticks with the event, sender and own time', () => {
    const m = build()
    expect(m.productTicks.length).toBe(3)
    expect(m.productTicks.map((t) => t.t)).toEqual([...m.productTicks.map((t) => t.t)].sort((a, b) => a - b))
    expect(m.productTicks[m.productTicks.length - 1].label).toMatch(/^Flood Advisory · NWS Example Office \(synthetic\) · sent Nov 4, \d\d:\d\d MST$/)
  })

  it('day ticks at local midnights across the end of daylight saving time (DST-safe)', () => {
    // Nov 1 2026, 2:00 MDT → 1:00 MST: that day is 25 h long in Denver
    const m = build({ nowMs: Date.UTC(2026, 10, 3, 18) })
    const labels = m.dayTicks.map((d) => d.label)
    expect(labels.slice(0, 3)).toEqual(['SUN NOV 1', 'MON NOV 2', 'TUE NOV 3'])
    const nov1 = m.dayTicks[0].t
    const nov2 = m.dayTicks[1].t
    expect(nov2 - nov1).toBe(25 * HOUR_MS)
    expect(new Date(nov1).toISOString()).toBe('2026-11-01T06:00:00.000Z')
    expect(new Date(nov2).toISOString()).toBe('2026-11-02T07:00:00.000Z')
  })
})

describe('hydrographModel: the model (D20, C28)', () => {
  const model = MODEL_SERIES()

  it('never on the stage axis', () => {
    const m = build({ model })
    expect(m.model).toEqual([])
    expect(m.modelState).toBe('stage_axis')
  })

  it('on the flow axis, in ft³/s, never converted to a stage', () => {
    const m = build({ axis: 'flow', model })
    expect(m.modelState).toBe('available')
    expect(m.model.map((l) => l.name)).toEqual(['analysis_assimilation', 'short_range', 'medium_range_blend'])
    expect(m.unit).toBe('FT³/S')
    // NWPS flow is in thousands of ft³/s: 7.061 kcfs → 7,061 ft³/s on the same axis as the model
    expect(m.observed[m.observed.length - 1].v).toBeCloseTo(7061)
    expect(m.modelLabel).toBe('MODEL · NWM · EXPERIMENTAL')
    expect(flowToCfs(7.061, 'kcfs')).toBeCloseTo(7061)
  })

  it('no model line, label or note without a reach_id', () => {
    const g = GAUGE_NO_FORECAST()
    expect(g.reach_id).toBeNull()
    const fake = { ...model, lid: g.lid } as ModelOutputResponse
    const m = build({ gauge: g, axis: 'flow', model: fake })
    expect(m.model).toEqual([])
    expect(m.modelState).toBe('none')
    expect(m.empty).not.toContain(HYDROGRAPH_EMPTY.noModel)
    const r = cursorReadout(m, null, TF)
    expect(r.modelLine).toBeNull()
  })

  it('a model answer that is not model output, or unavailable, draws nothing and says so', () => {
    const notModel = { ...model, model_output: false } as unknown as ModelOutputResponse
    expect(build({ axis: 'flow', model: notModel }).model).toEqual([])
    const down = build({ axis: 'flow', model: MODEL_UNAVAILABLE() })
    expect(down.modelState).toBe('unavailable')
    expect(down.empty).toContain(HYDROGRAPH_EMPTY.noModel)
    expect(build({ axis: 'flow', model: null, modelLoading: true }).modelState).toBe('loading')
  })

  it('flow-mode handle: NWS flow on line 1, the model on its own line, never one combined value', () => {
    const m = build({ axis: 'flow', model })
    const r = cursorReadout(m, null, TF)
    expect(r.line1).toBe('7,060 FT³/S OBSERVED')
    expect(r.line1).not.toMatch(/MODEL|NWM/)
    expect(r.modelLine).toMatch(/^MODEL · NWM · EXPERIMENTAL · [≈]?[\d,]+ FT³\/S \(RUN NOV 4 \d\d:\d\d MST\)$/)
    const ahead = cursorReadout(m, NOW + 30 * HOUR_MS, TF)
    expect(ahead.line1).toMatch(/FORECAST \(NWS\)$/)
    expect(ahead.modelLine).toMatch(/^MODEL · NWM · EXPERIMENTAL/)
  })
})

describe('hydrographModel: the handle', () => {
  it('at now: the latest reading at its own time, observed, with its category (never a value between it and the forecast)', () => {
    const m = build({ nowMs: NOW + 25 * 60_000 })
    expect(cursorReadout(m, null, TF).line1).toBe('17.6 FT OBSERVED · MODERATE')
    const r = cursorReadout(build(), null, TF)
    expect(cursorLabel(r)).toBe('NOV 4 11:00 MST · 17.6 FT OBSERVED · MODERATE')
    expect(r.kind).toBe('observed')
    expect(r.future).toBe(false)
  })

  it('in the forecast: the NWS forecast value and its category; after now it is a future cursor (C1)', () => {
    const m = build()
    const crest = m.crest!
    const r = cursorReadout(m, crest.t, TF)
    expect(r.kind).toBe('forecast')
    expect(r.line1).toBe('18.0 FT FORECAST (NWS) · MODERATE')
    expect(r.future).toBe(true)
    // between two forecast steps the value is drawn by Fire-3d: marked ≈
    const between = cursorReadout(m, crest.t + 3 * HOUR_MS, TF)
    expect(between.interpolated).toBe(true)
    expect(between.line1.startsWith('≈')).toBe(true)
  })

  it('in the past: an observed value from the record', () => {
    const m = build()
    const r = cursorReadout(m, NOW - 48 * HOUR_MS, TF)
    expect(r.kind).toBe('observed')
    expect(r.future).toBe(false)
    expect(r.line1).toMatch(/FT OBSERVED · (BELOW FLOOD STAGE|ACTION STAGE|MINOR)$/)
  })

  it('a stale latest reading is flagged; no reading at a time with none', () => {
    const m = build({ gauge: GAUGE_NOT_CURRENT() })
    const atLatest = cursorReadout(m, m.latest!.t, TF)
    expect(atLatest.stale).toBe(true)
    // at now (no handle set): the newest reading at its own time, flagged stale
    const now = cursorReadout(m, null, TF)
    expect(now.kind).toBe('observed')
    expect(now.t).toBe(m.latest!.t)
    expect(now.stale).toBe(true)
    // a handle set at now: no reading at that time
    const set = cursorReadout(m, NOW, TF)
    expect(set.kind).toBe('none')
    expect(set.line1).toBe('NO READING AT THIS TIME')
  })

  it('keyboard: arrows one hour, Shift six, Home and End; kept inside the chart', () => {
    const m = build()
    expect(stepCursor(m, null, 'ArrowRight', false)).toBe(NOW + HOUR_MS)
    expect(stepCursor(m, null, 'ArrowLeft', true)).toBe(NOW - 6 * HOUR_MS)
    expect(stepCursor(m, null, 'Home', false)).toBe(m.startMs)
    expect(stepCursor(m, null, 'End', false)).toBe(m.endMs)
    expect(stepCursor(m, m.endMs, 'ArrowRight', true)).toBe(m.endMs)
    expect(stepCursor(m, null, 'a', false)).toBeNull()
    expect(clampCursor(m, m.startMs - 1e9)).toBe(m.startMs)
  })

  it('metric: metres and m³/s, the original units for the tooltip', () => {
    const m = build({ units: 'metric' })
    expect(m.unit).toBe('M')
    const r = cursorReadout(m, null, TF)
    expect(r.line1).toBe('5.37 M OBSERVED · MODERATE')
    expect(r.original).toBe('17.6 ft in the original units')
    const f = build({ units: 'metric', axis: 'flow', model: MODEL_SERIES() })
    expect(f.unit).toBe('M³/S')
    expect(cursorReadout(f, null, TF).modelLine).toMatch(/ M³\/S \(RUN/)
  })

  it('values: one decimal for stage, three significant figures for flow', () => {
    expect(fmtValue(17.62, 'stage', 'us')).toBe('17.6')
    expect(fmtValue(7061, 'flow', 'us')).toBe('7,060')
    expect(fmtValue(12.345, 'flow', 'us')).toBe('12.3')
    expect(valueAt([], 0)).toBeNull()
  })
})

describe('productsAt (C1, re-exported for the hydrograph)', () => {
  const alerts = ALERTS().alerts
  const warning = alerts.find((a) => a.event === 'Flood Warning')!

  it('at or before now: the products in effect at the handle', () => {
    const before = productsAt(alerts, (warning.onset_ms ?? 0) - HOUR_MS, NOW)
    expect(before.future).toBe(false)
    expect(before.alerts.map((a) => a.event)).not.toContain('Flood Warning')
    const now = productsAt(alerts, null, NOW)
    expect(now.alerts.map((a) => a.event)).toContain('Flood Warning')
  })

  it('after now (beyond the warning end): the products in effect NOW, future: true', () => {
    const t = (warning.ends_ms ?? 0) + 22 * HOUR_MS
    const after = productsAt(alerts, t, NOW)
    expect(after.future).toBe(true)
    expect(after.alerts.map((a) => a.event)).toContain('Flood Warning')
    expect(CURSOR_FUTURE_PRODUCTS).toMatch(/NWS products in effect now/)
  })
})

describe('hydrographModel: empty states (PLAN-5 §5.5) and wording', () => {
  it('no readings in 72 h', () => {
    const g = primary()
    g.series!.observed = []
    expect(build({ gauge: g }).empty).toContain(HYDROGRAPH_EMPTY.noReadings)
  })
  it('no flood stages set', () => {
    expect(build({ gauge: GAUGE_NOT_DEFINED() }).empty).toContain(HYDROGRAPH_EMPTY.noStages)
  })
  it('no NWS forecast (not a forecast point) / none right now (a forecast point)', () => {
    expect(build({ gauge: GAUGE_NO_FORECAST() }).empty).toContain(HYDROGRAPH_EMPTY.noForecast)
    const g = primary()
    g.series!.forecast = []
    expect(build({ gauge: g }).empty).toContain(HYDRO.noForecastNow)
  })
  it('a past flood: forecasts are not kept for past dates; readings around that time', () => {
    const g = primary()
    g.series!.observed = []
    g.series!.forecast = []
    const m = build({ gauge: g, past: true })
    expect(m.empty).toContain(PAST_NO_FORECAST)
    expect(m.empty).toContain(HYDRO.noReadingsPast)
    // no data: the NWS levels set the range, none pinned
    expect(m.thresholds.every((t) => t.pinned === null)).toBe(true)
  })
  it("a past flood's reading: no category from today's levels, no age against its reference time (integration)", () => {
    const live = build({ gauge: primary() })
    const past = build({ gauge: primary(), past: true })
    expect(live.past).toBe(false)
    expect(past.past).toBe(true)
    expect(cursorReadout(live, null, TF).category).not.toBeNull()
    const r = cursorReadout(past, null, TF)
    expect(r.category).toBeNull()
    expect(r.line1).not.toMatch(/MINOR|MODERATE|MAJOR|ACTION|BELOW/)
    expect(past.latest?.label).toMatch(/^LAST READING SHOWN /)
    expect(past.latest?.label).not.toMatch(/AGO|STALE/)
    expect(past.latest?.stale).toBe(false)
  })

  it("no banned word in the chart's own words", () => {
    const m = build({ axis: 'flow', model: MODEL_SERIES() })
    const words = [m.observedLabel, m.forecastLabel ?? '', m.modelLabel, ...m.thresholds.map((t) => t.label), m.latest?.label ?? '', m.crest?.label ?? '', ...m.empty]
    const r = cursorReadout(m, NOW + 30 * HOUR_MS, TF)
    words.push(r.line1, r.modelLine ?? '', ...Object.values(HYDRO), ...Object.values(HYDROGRAPH_EMPTY))
    expect(floodWordingProblems(words.join(' \n '))).toEqual([])
  })
})

// review WFC-R1: the map's and the point check's one rule (productsShown), with the chart's note
describe('productsShown (review WFC-R1)', () => {
  const warning = () => ALERTS().alerts.find((a) => a.event === 'Flood Warning')!
  // PLCM7's case: issued, effective 3.3 h ago, onset 2.9 h after now, ends 91 h after now
  const upcoming = () => ({ ...warning(), id: 'up', phase: 'upcoming' as const, effective_ms: NOW - 3.3 * HOUR_MS, onset_ms: NOW + 2.9 * HOUR_MS, ends_ms: NOW + 91 * HOUR_MS })
  const ids = (cursor: number | null) => productsShown([warning(), upcoming()], cursor, NOW).alerts.map((a) => a.id)
  it('at now: the products in effect and the ones still to start', () => {
    expect(ids(null)).toEqual([warning().id, 'up'])
    expect(productsShown([upcoming()], null, NOW).future).toBe(false)
  })
  it('before now: in effect at the handle only (an upcoming product is not)', () => {
    expect(ids(NOW - 2 * HOUR_MS)).toEqual([warning().id])
  })
  it('after now: in effect now, plus an issued product whose own period covers the handle', () => {
    expect(ids(NOW + 1 * HOUR_MS)).toEqual([warning().id])
    expect(ids(NOW + 8 * HOUR_MS)).toEqual([warning().id, 'up'])
    expect(ids(NOW + 95 * HOUR_MS)).toEqual([warning().id])
  })
  it('the note: never "NWS has issued none" while an issued product covers the handle', () => {
    expect(futureProductsNote(productsShown([upcoming()], NOW + 8 * HOUR_MS, NOW))).toBe(CURSOR_FUTURE_ISSUED)
    expect(futureProductsNote(productsShown([upcoming()], NOW + 1 * HOUR_MS, NOW))).toBe(CURSOR_FUTURE_PRODUCTS)
    // the fixture warning (in effect now) ends 8 h after now: 4 h ahead it covers the handle, 30 h ahead it does not
    expect(futureProductsNote(productsShown([warning()], NOW + 4 * HOUR_MS, NOW))).toBe(CURSOR_FUTURE_ISSUED)
    expect(futureProductsNote(productsShown([warning()], NOW + 30 * HOUR_MS, NOW))).toBe(CURSOR_FUTURE_PRODUCTS)
    expect(futureProductsNote(productsShown([warning()], null, NOW))).toBeNull()
    expect(floodWordingProblems(CURSOR_FUTURE_ISSUED)).toEqual([])
  })
  it('an ended product is never shown', () => {
    expect(productsShown([{ ...upcoming(), phase: 'ended' as const }], null, NOW).alerts).toHaveLength(0)
  })
})

describe('hydrographModel: review fixes (WFC-R3, R5, R10, R11, R14)', () => {
  it('R5: a stage-only gauge on the flow axis says so, never "NWS: Data Not Current", and keys no OBSERVED line', () => {
    const g = primary()
    g.series!.observed = g.series!.observed.map(([t, st]) => [t, st, null])
    g.series!.forecast = g.series!.forecast.map(([t, st]) => [t, st, null])
    const m = build({ gauge: g, axis: 'flow' })
    expect(m.stageOnly).toBe(true)
    expect(m.empty[0]).toBe(HYDRO.flowStageOnly)
    expect(m.empty).not.toContain(HYDROGRAPH_EMPTY.noReadings)
    // the stage axis of the same gauge: normal; an empty stage record keeps NWS's "Data Not Current" words
    expect(build({ gauge: g }).stageOnly).toBe(false)
    const none = primary()
    none.series!.observed = []
    const f = build({ gauge: none, axis: 'flow' })
    expect(f.stageOnly).toBe(false)
    expect(f.empty).toContain(HYDROGRAPH_EMPTY.noReadings)
  })

  it('R14: a falling forecast (highest at its first step, below the latest reading) is not labelled a crest', () => {
    const g = primary()
    const latest = g.series!.observed[g.series!.observed.length - 1]
    const t0 = latest[0]
    const v0 = (latest[1] ?? 17) - 0.2
    g.series!.forecast = [0, 1, 2, 3, 4].map((i) => [t0 + (i + 1) * 6 * HOUR_MS, v0 - i * 0.5, null])
    g.forecast = g.forecast ? { ...g.forecast, crest_at_end: false } : null
    const m = build({ gauge: g })
    expect(m.crest?.falling).toBe(true)
    expect(m.crest?.label).toMatch(/^HIGHEST NWS FORECAST [\d.]+ FT [A-Z]{3} \d\d:\d\d$/)
    expect(m.crest?.label).not.toMatch(/^CREST/)
    // a rise is still a crest
    expect(build().crest?.label).toMatch(/^CREST /)
    expect(build().crest?.falling).toBe(false)
    // the readout and Official now ask the same of the gauge's series
    expect(forecastFalling(g)).toBe(true)
    expect(forecastFalling(primary())).toBe(false)
    expect(forecastFalling({ series: null })).toBe(false)
  })

  it('integration: a highest forecast value for a time that has passed is not a crest still to come', () => {
    const g = primary()
    const latest = g.series!.observed[g.series!.observed.length - 1]
    const t0 = latest[0]
    const v0 = (latest[1] ?? 17) + 0.4
    // NWS issued it before the latest reading: its peak (above the reading) is already behind NOW, then it falls
    g.series!.forecast = [[t0 - 3 * HOUR_MS, v0 - 0.2, null], [t0 - 2 * HOUR_MS, v0, null], ...[1, 2, 3].map((i) => [t0 + i * 6 * HOUR_MS, v0 - 0.3 * i - 0.5, null] as [number, number, null])]
    g.forecast = g.forecast ? { ...g.forecast, crest_at_end: false } : null
    const m = build({ gauge: g })
    expect(m.crest?.passed).toBe(true)
    expect(m.crest?.label).toMatch(/^HIGHEST NWS FORECAST [\d.]+ FT [A-Z]{3} \d\d:\d\d$/)
    expect(build().crest?.passed).toBe(false)
  })

  it('R11: the dock key keeps the issuer and a short issue time', () => {
    const m = build()
    expect(m.forecastLabel).toMatch(/^FORECAST · NWS ZZRFC · ISSUED NOV 4 \d\d:\d\d MST$/)
    expect(m.forecastLabelShort).toMatch(/^FORECAST · NWS ZZRFC · ISSUED \d\d:\d\d$/)
  })

  it('R3: the handle row is as tall as its lines (one, two in flow mode with the model)', () => {
    expect(handleRowHeight('slim', { modelLine: null })).toBe(16)
    expect(handleRowHeight('slim', { modelLine: 'MODEL · NWM · EXPERIMENTAL · 1 FT³/S (RUN)' })).toBe(32)
    expect(handleRowHeight('dock', { modelLine: 'x' })).toBe(28)
  })

  it('R10: arrow keys, Home and End move between the gauge options', () => {
    expect(listKeyTarget('ArrowDown', 0, 3)).toBe(1)
    expect(listKeyTarget('ArrowDown', 2, 3)).toBe(2)
    expect(listKeyTarget('ArrowUp', 0, 3)).toBe(0)
    expect(listKeyTarget('ArrowUp', -1, 3)).toBe(0)
    expect(listKeyTarget('Home', 2, 3)).toBe(0)
    expect(listKeyTarget('End', 0, 3)).toBe(2)
    expect(listKeyTarget('a', 0, 3)).toBeNull()
    expect(listKeyTarget('ArrowDown', 0, 0)).toBeNull()
  })
})
