// Command's flood readout (PLAN-5 §4.5): tags with each layer's kind and own time, NOTHING_COVERS, the nearest gauge
// (the flood's rivers first; NO_GAUGE_NEAR only for an available answer, D24), category words (never a raw value), the
// crest or the forecast high at its end (C7), the area figures only when measured (C6), the flood's rows, the model
// line only while switched on (D12), no banned word in Fire-3d's own words.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALERTS, DETAIL, DETAIL_FLASH, FIXTURE_NOW_MS, GAUGE_NOT_CURRENT, GAUGE_NOT_DEFINED, GAUGE_OUT_OF_SERVICE, GAUGE_RISING_AT_END, GAUGES, GAUGES_UNAVAILABLE, MODEL_SERIES, RFC_FIM, SATELLITE } from '../api/__fixtures__/floods/edgeCases'
import type { FloodDetailResponse, FloodMapResponse, GaugeCategory, ModelOutputResponse, RiverGauge, RiverGaugesResponse } from '../api/types'
import { useFloodOfficial } from '../official/floodHooks'
import { NO_ANSWER, type Answer } from '../official/floodModel'
import { useFlood, DEFAULT_FLOOD_LAYERS } from '../state/flood'
import { useFloodLayerData } from '../state/floodLayerData'
import { useWorkspace, type SelectedLocation } from '../state/workspace'
import { restoreSsrState, ssrState } from '../ui/ssr.testutil'
import {
  FLOOD_COMMAND,
  FORECAST_HIGH_LABEL,
  GAUGE_BELOW_STAGE_SUB,
  GAUGE_CATEGORY_DISPLAY,
  GAUGES_UNAVAILABLE as GAUGES_UNAVAILABLE_TEXT,
  NO_GAUGE_NEAR,
  NO_MEMBER_GAUGE,
  NO_MEMBER_GAUGE_SUB,
  NO_RFC_FORECAST,
  NOTHING_COVERS,
  floodWordingProblems,
  stripVerbatim,
} from '../ui/shell/floodCopy'
import catfimMap from '../api/__fixtures__/floods/maps-catfim.json'
import nfhlMap from '../api/__fixtures__/floods/maps-nfhl.json'
import { areaFigures, catfimLine, categoryWords, fmtArea, forecastRow, lineTag, nearestFloodGauge, onFloodRiver, pointGaugesUrl, utmZoneOf } from './floodCheck'
import { FloodReadout } from './FloodReadout'
import { pointGaugeCache } from '../ui/timeline/hydrographData'

const ans = <T,>(data: T | null): Answer<T> => ({ data, loading: false, error: null })
const TF = { tz: 'America/Denver', clock: '24h' as const }
const gaugesOf = () => GAUGES().gauges

function render(
  o: {
    sel?: SelectedLocation | null
    gauges?: Answer<RiverGaugesResponse>
    model?: ModelOutputResponse | null
    modelOn?: boolean
    fim?: FloodMapResponse | null
    real?: boolean
    detail?: FloodDetailResponse
    units?: 'us' | 'metric'
  } = {},
) {
  const d = o.detail ?? DETAIL()
  // `real`: the fixture's summary as a real (not simulated) flood, whose point check asks the point's own gauges answer
  const summary = o.real ? { ...d.summary, synthetic: false } : d.summary
  ssrState(useWorkspace, { preset: 'command', units: o.units ?? 'us', selection: o.sel === undefined ? { lat: 36.8, lon: -108.05, source: 'click' } : o.sel } as never)
  ssrState(useFlood, { floodId: summary.id, summary, manifest: null, resolvedFrom: 'live', cursorMs: null, layers: { ...DEFAULT_FLOOD_LAYERS, model: o.modelOn === true } } as never)
  ssrState(useFloodOfficial, {
    floodId: summary.id,
    alerts: ans(ALERTS()),
    gauges: o.gauges ?? ans(GAUGES()),
    fim: ans(o.fim === undefined ? RFC_FIM() : o.fim),
    satellite: ans(SATELLITE()),
    nfhl: NO_ANSWER,
    local: NO_ANSWER,
  } as never)
  ssrState(useFloodLayerData, { floodId: summary.id, model: ans(o.model ?? null), highFlow: NO_ANSWER, catfim: NO_ANSWER } as never)
  return renderToStaticMarkup(createElement(FloodReadout))
}

beforeEach(() => {
  vi.useFakeTimers({ now: FIXTURE_NOW_MS, toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
  restoreSsrState()
})

describe('readout tags (each layer with its kind and own time)', () => {
  const ctx = { fim: RFC_FIM(), satellite: SATELLITE(), nowMs: FIXTURE_NOW_MS, tf: TF }
  it('OFFICIAL, FORECAST · ISSUED <time>, SATELLITE · <age at render>, FEMA, MODEL; no tag for a note', () => {
    expect(lineTag({ kind: 'official' }, ctx)!.text).toBe('Official')
    expect(lineTag({ kind: 'forecast' }, ctx)!.text).toBe('Forecast · issued 09:00')
    expect(lineTag({ kind: 'satellite' }, ctx)!.text).toBe('Satellite · 4 d ago')
    // the age is computed at render time (C16): a week later it says so
    expect(lineTag({ kind: 'satellite' }, { ...ctx, nowMs: FIXTURE_NOW_MS + 7 * 86_400_000 })!.text).toBe('Satellite · 11 d ago')
    expect(lineTag({ kind: 'background' }, ctx)!.text).toBe('FEMA')
    expect(lineTag({ kind: 'model' }, ctx)!.text).toBe('Model')
    expect(lineTag({ kind: 'note' }, ctx)).toBeNull()
    // FEMA with its own effective date when its map answered (C19)
    expect(lineTag({ kind: 'background' }, { ...ctx, nfhl: nfhlMap as unknown as FloodMapResponse })!.text).toMatch(/^FEMA · effective [A-Z][a-z]{2} \d{1,2}, \d{4}/)
  })

  it('the NWS category flood map line (D22): inside or outside, its category and gauge, experimental, never an all-clear', () => {
    const m = catfimMap as unknown as FloodMapResponse
    const ring = (m.features.features[0].geometry as { coordinates: number[][][] }).coordinates[0]
    const inside = catfimLine(m, [ring[0][0] + 1e-6, ring[0][1]])
    expect(catfimLine(m, [-100, 40])!.text).toBe(FLOOD_COMMAND.catfimOutside.replace('{category}', 'moderate').replace('{lid}', 'ZZRF1'))
    expect(inside === null || inside.text.includes('ZZRF1')).toBe(true)
    expect(catfimLine({ ...m, status: 'unavailable' }, [-100, 40])).toBeNull()
    expect(catfimLine(RFC_FIM(), [-100, 40])).toBeNull()
  })
})

describe('area figures (C6)', () => {
  it('the forecast area only when measured from member reaches; the satellite water only from a measured image; each with its caveat', () => {
    const f = areaFigures(RFC_FIM(), SATELLITE(), 'us')
    expect(f.map((x) => x.key)).toEqual(['fim', 'sat'])
    expect(f[0].text).toMatch(/^Forecast flooded area \(next 5 days\): 3\.5 mi², measured by Fire-3d/)
    expect(f[0].text).toContain('It includes the river channel.')
    expect(f[1].text).toBe('Water seen by satellite in this area: 2.6 mi² (includes normal river and lake water)')
    expect(f[1].caveat).toMatch(/^Water seen by satellite \(NASA OPERA\)/)
    const noStats = { ...RFC_FIM(), stats: null }
    expect(areaFigures(noStats, null, 'us')).toEqual([])
    expect(areaFigures(null, { ...SATELLITE(), measured: false }, 'us')).toEqual([])
    expect(fmtArea(8.98, 'metric')).toBe('9.0 km²')
  })
})

describe('gauge words', () => {
  it('every category in words from the PLAN-5 5.3 table, never a raw value', () => {
    const cats: GaugeCategory[] = ['no_flooding', 'action', 'minor', 'moderate', 'major', 'not_defined', 'low_threshold', 'obs_not_current', 'out_of_service', 'fcst_not_current', 'unknown']
    for (const c of cats) {
      const g = { observed: { ...gaugesOf()[0].observed, category: c } } as RiverGauge
      const w = categoryWords(g, TF, FIXTURE_NOW_MS)
      expect(w.short).toBe(GAUGE_CATEGORY_DISPLAY[c].short)
      expect(w.short).not.toContain(c.includes('_') ? c : '§')
      expect(w.sentence).not.toMatch(/\{[^}]+\}/)
    }
    expect(categoryWords({ observed: { ...gaugesOf()[0].observed, category: 'no_flooding' } } as RiverGauge, TF, FIXTURE_NOW_MS).sentence).toBe(GAUGE_BELOW_STAGE_SUB)
    expect(categoryWords(GAUGE_NOT_CURRENT(), TF, FIXTURE_NOW_MS).sentence).toMatch(/last reading Nov 4, \d\d:\d\d MST/)
  })

  it('the forecast crest (CREST_LINE), the forecast high at its end (C7), none for a gauge that is not a forecast point', () => {
    const crest = forecastRow(gaugesOf()[0], TF, 'us', FIXTURE_NOW_MS)
    expect(crest.label).toBe(FLOOD_COMMAND.crestLabel)
    expect(crest.sub).toMatch(/^Forecast crest 18\.0 ft, Thu Nov 5, 17:00 MST \(NWS Example River Forecast Center \(synthetic\), issued Nov 4, 09:00 MST\)/)
    const high = forecastRow(GAUGE_RISING_AT_END(), TF, 'us', FIXTURE_NOW_MS)
    expect(high.label).toBe(FORECAST_HIGH_LABEL)
    expect(high.sub).toMatch(/^Highest NWS forecast value 10\.8 ft at the end of the forecast/)
    expect(high.sub).toContain('still forecast to rise')
    // a falling forecast (its highest value its first step, below the latest reading): never "Forecast crest" (WFC-R14)
    const falling = forecastRow(gaugesOf()[0], TF, 'us', FIXTURE_NOW_MS, false, true)
    expect(falling.label).toBe(FLOOD_COMMAND.highestForecastLabel)
    expect(falling.sub).toMatch(/^Highest NWS forecast value 18\.0 ft at its first step \(Thu Nov 5, 17:00 MST\), below the latest reading: not a crest still to come/)
    expect(floodWordingProblems(falling.sub)).toEqual([])
    const none = forecastRow(gaugesOf()[2], TF, 'us', FIXTURE_NOW_MS)
    expect(none.value).toBe(NO_RFC_FORECAST)
    // a forecast point whose forecast is not in this answer: never "No NWS river forecast" (bundle-api deviation 4)
    const fp = { ...gaugesOf()[0], forecast: null }
    expect(forecastRow(fp, TF, 'us', FIXTURE_NOW_MS).value).not.toBe(NO_RFC_FORECAST)
  })

  it("the nearest gauge: the flood's rivers first, else at action stage or above, within 25 km", () => {
    const gs = gaugesOf()
    expect(onFloodRiver(gs[0], ['Ridge Fork River'])).toBe(true)
    expect(onFloodRiver(gs[2], ['Ridge Fork River'])).toBe(false)
    // right next to ZZRF3 (another stream, below flood stage): the flood's river gauge is named, not ZZRF3
    const n = nearestFloodGauge(gs, [gs[2].lon + 0.001, gs[2].lat], ['Ridge Fork River'])!
    expect(n.gauge.waterbody).toBe('Ridge Fork River')
    expect(n.onRiver).toBe(true)
    // no river named: the nearest at action stage or above
    const m = nearestFloodGauge(gs, [gs[2].lon + 0.001, gs[2].lat], [])!
    expect(['action', 'minor', 'moderate', 'major']).toContain(m.gauge.observed.category)
    // far away: none
    expect(nearestFloodGauge(gs, [-100, 40], ['Ridge Fork River'])).toBeNull()
  })

  it('UTM zone from the point when there is no bundle grid', () => {
    expect(utmZoneOf(-108.05, null)).toBe(12)
    expect(utmZoneOf(-108.05, 13)).toBe(13)
  })
})

describe('FloodReadout (rendered)', () => {
  it('a point in the warning: tagged lines, the nearest gauge with its category words and crest, the flood rows, the area figures', () => {
    const html = render()
    expect(html).toContain('36.80000° N')
    expect(html).toContain('UTM 12N')
    expect(html).toMatch(/cro-tag ffr-tag is-official[^>]*>Official</)
    expect(html).toMatch(/Inside the NWS <span data-verbatim="">Flood Warning<\/span> area \(until/)
    expect(html).toContain('Forecast · issued 09:00')
    expect(html).toContain('ZZRF1')
    expect(html).toContain('Moderate flooding (NWS)')
    expect(html).toContain('Nearest gauge on the Ridge Fork River; another stream may be closer.')
    expect(html).toContain('Forecast crest (NWS)')
    expect(html).toContain(DETAIL().summary.id)
    expect(html).toContain('measured by Fire-3d')
    expect(html).toContain('includes normal river and lake water')
    expect(html).not.toContain('MODEL')
  })

  // review WFC-R2: the flood's gauges answer does not cover a far point's 25 km, so it never decides NO_GAUGE_NEAR there
  const FAR = { lat: 37.5, lon: -107.2, source: 'click' } as SelectedLocation
  const farUrl = () => pointGaugesUrl([FAR.lon, FAR.lat], null)
  const seed = (data: RiverGaugesResponse | null, error: string | null = null) => pointGaugeCache.set(farUrl(), { data, error, at: Date.now() })
  afterEach(() => pointGaugeCache.clear())

  it('far from every layer and gauge (a real flood): checking its own gauges, NOTHING_COVERS; NO_GAUGE_NEAR once that answer is available', () => {
    const noFim = { ...RFC_FIM(), features: { type: 'FeatureCollection' as const, features: [] } }
    const checking = render({ sel: FAR, fim: noFim, real: true })
    expect(checking).not.toContain(NO_GAUGE_NEAR)
    expect(checking).toContain(FLOOD_COMMAND.gaugesChecking)
    expect(checking).toContain(NOTHING_COVERS)
    seed({ ...GAUGES(), gauges: [], area_bbox: null })
    expect(render({ sel: FAR, fim: noFim, real: true })).toContain(NO_GAUGE_NEAR)
  })

  it("far point: a gauge at action stage in the point's own answer is named (never NO_GAUGE_NEAR from the flood's answer)", () => {
    const g = { ...GAUGES().gauges[1], lid: 'RSDM7', name: '102 River at Rosendale', waterbody: '102 River', member: false, lat: 37.55, lon: -107.25, observed: { ...GAUGES().gauges[1].observed, category: 'action' as const } }
    seed({ ...GAUGES(), gauges: [g] })
    const html = render({ sel: FAR, real: true })
    expect(html).toContain('RSDM7')
    expect(html).toContain(FLOOD_COMMAND.gaugeNearby)
    expect(html).not.toContain(NO_GAUGE_NEAR)
  })

  it("D24: the point's gauges answer could not be reached: its own text, never NO_GAUGE_NEAR", () => {
    seed(GAUGES_UNAVAILABLE())
    const html = render({ sel: FAR, real: true })
    expect(html).not.toContain(NO_GAUGE_NEAR)
    expect(html).toContain(GAUGES_UNAVAILABLE().reason ?? GAUGES_UNAVAILABLE_TEXT)
    seed(null, 'HTTP 502')
    const failed = render({ sel: FAR, real: true, gauges: { data: null, loading: false, error: 'HTTP 502' } })
    expect(failed).toContain(GAUGES_UNAVAILABLE_TEXT)
    expect(failed).not.toContain(NO_GAUGE_NEAR)
  })

  it("a simulated flood: its own gauges answer is the demo's world (NO_GAUGE_NEAR from it; no real gauge mixed in)", () => {
    expect(render({ sel: FAR })).toContain(NO_GAUGE_NEAR)
    const down = render({ sel: FAR, gauges: ans(GAUGES_UNAVAILABLE()) })
    expect(down).not.toContain(NO_GAUGE_NEAR)
    expect(down).toContain(GAUGES_UNAVAILABLE().reason ?? GAUGES_UNAVAILABLE_TEXT)
  })

  it('a flood with no member gauge and no point: NO_MEMBER_GAUGE under the heading, never an empty heading (WFC-R7)', () => {
    const flash = DETAIL_FLASH()
    const resp = { ...GAUGES(), gauges: GAUGES().gauges.map((g) => ({ ...g, member: false })) }
    const html = render({ sel: null, detail: flash, gauges: ans(resp) })
    expect(html).toContain(NO_MEMBER_GAUGE)
    expect(html).toContain(NO_MEMBER_GAUGE_SUB)
    expect(html).not.toContain(FLOOD_COMMAND.gaugePrimary)
  })

  it('no point: the prompt and the primary gauge', () => {
    const html = render({ sel: null })
    expect(html).toContain(FLOOD_COMMAND.pickPrompt)
    expect(html).toContain(FLOOD_COMMAND.gaugePrimary)
    expect(html).not.toContain(NO_GAUGE_NEAR)
  })

  it('the model line only while the model layer is on (D12), tagged MODEL', () => {
    const model: ModelOutputResponse = {
      ...MODEL_SERIES(),
      kind: 'nwm_analysis',
      series: null,
      features: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-108.06, 36.79], [-108.04, 36.79], [-108.04, 36.81], [-108.06, 36.81], [-108.06, 36.79]]] }, properties: {} }] },
    }
    expect(render({ model })).not.toContain('National Water Model (NOAA, experimental)')
    const on = render({ model, modelOn: true })
    expect(on).toContain('National Water Model (NOAA, experimental): flooded at the')
    expect(on).toMatch(/cro-tag ffr-tag is-model[^>]*>Model</)
  })

  it('category words for other gauge states (out of service, stages not set)', () => {
    const resp = GAUGES()
    resp.gauges = [GAUGE_OUT_OF_SERVICE(), GAUGE_NOT_DEFINED()].map((g, i) => ({ ...g, member: true, waterbody: 'Ridge Fork River', lat: 36.8 + i * 0.01, lon: -108.05 }))
    const html = render({ gauges: ans(resp) })
    expect(html).toContain('Out of service (NWS)')
    expect(html).toContain('Gauge out of service (NWS); no reading.')
  })

  it("no banned word in Fire-3d's own words", () => {
    for (const html of [render(), render({ sel: null }), render({ sel: { lat: 37.5, lon: -107.2, source: 'click' } as SelectedLocation }), render({ sel: null, detail: DETAIL_FLASH() })]) expect(floodWordingProblems(stripVerbatim(html))).toEqual([])
    expect(NOTHING_COVERS).toContain('Unknown, not dry')
  })
})
