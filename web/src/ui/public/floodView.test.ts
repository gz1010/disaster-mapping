// The Public flood view's words (brief 5, PLAN-5 §4.4, §5.2; D19, C15): circle status and meaning for every case, the
// short name, the place and date line; the disc's water texture (verbatim layers, no animation under reduced motion)
// and the fire circle drawn exactly as brief 4 drew it (the HazardDisc split, PLAN-5 §4.8).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_NOW_MS, DETAIL, DETAIL_FLASH, DETAIL_WATCH, LIST, PAST_FLOOD } from '../../api/__fixtures__/floods/edgeCases'
import { summaryFixture } from '../../api/fixtures.testutil'
import type { FloodSummary } from '../../api/types'
import { timeFmt } from '../../lib/time'
import { useStore } from '../../state/store'
import { ALERTS_UNAVAILABLE as ALERTS_DOWN_TEXT, CIRCLE_MEANING, CIRCLE_STATUS, GAUGE_ONLY_CAVEAT, GAUGE_ONLY_COASTAL_CAVEAT, floodWordingProblems } from '../shell/floodCopy'
import { restoreSsrState, ssrState } from '../ssr.testutil'
import { floodCircleLabel, floodCircleStatus, floodDateLine, floodPlace, floodShortName } from './floodView'
import { HazardCircle } from './HazardCircle'
import { HazardDisc } from './HazardDisc'
import { WaterTexture } from './WaterTexture'

const tf = timeFmt('America/Denver', '12h')
const real = (s: FloodSummary): FloodSummary => ({ ...s, synthetic: false })
const listed = (id: string) => real(LIST().floods.find((f) => f.id === id)!)

afterEach(() => restoreSsrState())

describe('floodShortName (PLAN-5 §4.4)', () => {
  it('drops "River flood", "flash flood", "flood" and a state suffix; a watch keeps its first area', () => {
    expect(floodShortName('San Juan River flood')).toBe('San Juan')
    expect(floodShortName('Animas River flood')).toBe('Animas')
    expect(floodShortName('Clarks flash flood')).toBe('Clarks')
    expect(floodShortName('Silver Creek flood')).toBe('Silver Creek')
    expect(floodShortName('San Juan River flood (NM)')).toBe('San Juan')
    expect(floodShortName('Flood watch: Example County and 2 more areas')).toBe('Example County')
    expect(floodShortName('Ridge Fork River flood')).toBe('Ridge Fork')
  })
})

describe('title (PLAN-5 §5.2 date line)', () => {
  it('place is "<County>, <State name>"', () => {
    expect(floodPlace(DETAIL().summary)).toBe('San Juan County, New Mexico')
  })
  it('PRESENT, SEEN BY DISASTER MAPPING SINCE, and a past flood with its last NWS product; never ENDED', () => {
    const s = DETAIL().summary
    expect(floodDateLine({ ...s, started_basis: 'nws_product' }, tf.tz)).toMatch(/^[A-Z]{3} \d{1,2} 2026 — PRESENT$/)
    expect(floodDateLine({ ...s, started_basis: 'first_seen' }, tf.tz)).toMatch(/^SEEN BY DISASTER MAPPING SINCE [A-Z]{3} \d{1,2} 2026$/)
    const past = PAST_FLOOD()
    const line = floodDateLine(past, tf.tz)!
    expect(line).toMatch(/^[A-Z]{3} \d{1,2} 2025 — LAST NWS PRODUCT [A-Z]{3} \d{1,2} 2025$/)
    expect(line).not.toMatch(/ENDED/)
  })
})

describe('circle status and meaning (PLAN-5 §5.2, D19, C15)', () => {
  const cases: [string, FloodSummary, string][] = [
    ['emergency', real(DETAIL_FLASH().summary), CIRCLE_STATUS.emergency],
    ['warning', real(DETAIL().summary), CIRCLE_STATUS.warning],
    ['advisory', listed('fixture-flood-advisory'), CIRCLE_STATUS.advisory],
    ['watch', real(DETAIL_WATCH().summary), CIRCLE_STATUS.watch],
    ['gauge only', listed('fixture-flood-minor'), CIRCLE_STATUS.gaugeOnly],
    ['no product now', { ...real(DETAIL().summary), status: 'inactive', products: [] }, CIRCLE_STATUS.noProductNow],
    ['demo', DETAIL().summary, CIRCLE_STATUS.demo],
  ]
  for (const [name, s, line] of cases)
    it(`${name}: ${line}`, () => {
      const st = floodCircleStatus(s, tf, FIXTURE_NOW_MS)
      expect(st.line).toBe(line)
      expect(st.line).not.toMatch(/ACTIVE|ENDED|OVER|CLEAR/)
      expect(st.meaning.length).toBeGreaterThan(20)
      expect(floodWordingProblems(st.meaning)).toEqual([])
      expect(floodWordingProblems(st.line)).toEqual([])
    })

  it('a past flood: PAST FLOOD · its day, quiet, the meaning names the last product day', () => {
    const st = floodCircleStatus(real(PAST_FLOOD()), tf, FIXTURE_NOW_MS)
    expect(st.line).toMatch(/^PAST FLOOD · [A-Z]{3} \d{1,2} 2025$/)
    expect(st.tone).toBe('quiet')
    expect(st.meaning).toMatch(/^Past flood: NWS's last product for it was sent [A-Z][a-z]{2} \d{1,2}, 2025\. Not an all-clear/)
  })

  it('the product meaning names the issuer, the product and its own end time in the flood zone', () => {
    const st = floodCircleStatus(real(DETAIL().summary), tf, FIXTURE_NOW_MS)
    expect(st.meaning).toMatch(/^NWS Example Office \(synthetic\) has a Flood Warning in effect for this area until [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M M[SD]T\.$/)
    expect(st.tone).toBe('active')
  })

  it('a watch is quiet and keeps the rain; its meaning says flooding is possible and is not an all-clear', () => {
    const st = floodCircleStatus(real(DETAIL_WATCH().summary), tf, FIXTURE_NOW_MS)
    expect(st.tone).toBe('quiet')
    expect(st.rain).toBe(true)
    expect(st.meaning).toMatch(/[Ff]looding is possible\. Not an all-clear\. Follow local officials\.$/)
    // in effect (not still to start): the plan's watch template
    const inEffect = { ...real(DETAIL_WATCH().summary) }
    inEffect.products = inEffect.products.map((p) => ({ ...p, phase: 'in_effect' as const }))
    expect(floodCircleStatus(inEffect, tf, FIXTURE_NOW_MS).meaning).toMatch(/^NWS Example Office \(synthetic\) has a Flood Watch in effect for this area until .+: flooding is possible\. Not an all-clear\. Follow local officials\.$/)
  })

  it('an emergency names the Flash Flood Emergency; no product now and demo use their templates verbatim', () => {
    expect(floodCircleStatus(real(DETAIL_FLASH().summary), tf, FIXTURE_NOW_MS).meaning).toMatch(/Flash Flood Warning \(Flash Flood Emergency\)/)
    expect(floodCircleStatus({ ...real(DETAIL().summary), status: 'inactive', products: [] }, tf, FIXTURE_NOW_MS).meaning).toBe(CIRCLE_MEANING.noProductNow)
    expect(floodCircleStatus(DETAIL().summary, tf, FIXTURE_NOW_MS).meaning).toBe(CIRCLE_MEANING.demo)
  })

  it('a gauge-only flood whose caveat is an NWS outage or a tide gauge never says "no NWS flood product" (integration, D24)', () => {
    const base = { ...real(DETAIL().summary), level: 'gauge_only' as const, products: [], gauges_in_flood: 1 }
    for (const caveat of [ALERTS_DOWN_TEXT, GAUGE_ONLY_COASTAL_CAVEAT])
      for (const status of ['active', 'inactive'] as const) {
        const st = floodCircleStatus({ ...base, caveat, status }, tf, FIXTURE_NOW_MS)
        expect(st.line).toBe(CIRCLE_STATUS.gaugeOnly)
        expect(st.meaning.startsWith(caveat)).toBe(true)
        expect(st.meaning).toMatch(/not an all-clear/i)
        expect(st.meaning).not.toContain(CIRCLE_MEANING.noProductNow)
        expect(st.tone).toBe(status === 'inactive' ? 'quiet' : 'active')
        expect(floodWordingProblems(st.meaning)).toEqual([])
      }
    // the plain caveat keeps the plan's sentence
    expect(floodCircleStatus({ ...base, caveat: GAUGE_ONLY_CAVEAT, status: 'active' }, tf, FIXTURE_NOW_MS).meaning).toBe(CIRCLE_MEANING.gaugeOnly)
  })

  it('a gauge at flood stage under a Flood Watch: the gauge is the status, the watch is named (integration)', () => {
    const watch = real(DETAIL_WATCH().summary).products[0]
    const s = { ...real(DETAIL().summary), level: 'gauge_only' as const, caveat: GAUGE_ONLY_CAVEAT, gauges_in_flood: 1,
      products: [{ ...watch, phase: 'in_effect' as const }] }
    const st = floodCircleStatus(s, tf, FIXTURE_NOW_MS)
    expect(st.line).toBe(CIRCLE_STATUS.gaugeOnly)
    expect(st.meaning).toMatch(/^A river gauge here reads at flood stage; NWS Example Office \(synthetic\) has a Flood Watch in effect for this area until .+\. Not an all-clear\. Follow local officials\.$/)
    expect(floodWordingProblems(st.meaning)).toEqual([])
  })

  it('the accessible name is the whole name with the status words', () => {
    const st = floodCircleStatus(real(DETAIL().summary), tf, FIXTURE_NOW_MS)
    expect(floodCircleLabel('Ridge Fork River flood', st)).toBe('Ridge Fork River flood: flood, warning. More in Command view')
  })
})

describe('water texture (FloodView.dc.html verbatim) and reduced motion', () => {
  it('draws the design layers: base, mist, two currents at −9°, mist band, rain at 12°, grain; ids prefixed', () => {
    const html = renderToStaticMarkup(createElement(WaterTexture, { tone: 'active', idPrefix: 'tA', running: true }))
    for (const id of ['tAflBase', 'tAflWaterG', 'tAflWater', 'tAflCurrentF', 'tAflFoamF', 'tAflRainF', 'tAflGrain', 'tAflMistF', 'tAflCurrentP', 'tAflFoamP', 'tAflRainP']) expect(html).toContain(`id="${id}"`)
    expect(html).toContain('rotate(-9 156 156)')
    expect(html).toContain('rotate(12 156 156)')
    expect(html).toContain('dur="2.6s"')
    expect(html).toContain('dur="1.5s"')
    expect(html).toContain('dur="0.55s"')
    expect(html).toContain('baseFrequency="0.0096 0.08"')
    expect(html).toContain('stop-color="#7f8a84"')
  })
  it('running false: no <animate> or <animateTransform> at all (prefers-reduced-motion)', () => {
    const html = renderToStaticMarkup(createElement(WaterTexture, { tone: 'active', idPrefix: 'tB', running: false }))
    expect(html).not.toMatch(/<animate/i)
    expect(html).toContain('flCurrentP')
  })
  it('quiet drops the rain unless kept (a watch keeps it)', () => {
    expect(renderToStaticMarkup(createElement(WaterTexture, { tone: 'quiet', idPrefix: 'q', running: true }))).not.toContain('flRainP')
    expect(renderToStaticMarkup(createElement(WaterTexture, { tone: 'quiet', idPrefix: 'q', running: true, rain: true }))).toContain('flRainP')
  })
  it('the water disc: class is-water, the status split at " · ", the short name, the meaning as its description', () => {
    const html = renderToStaticMarkup(
      createElement(HazardDisc, { texture: 'water', tone: 'active', statusLine: 'FLOOD · WARNING', name: 'Ridge Fork', meaning: 'M', label: 'L', tip: 'T', tipName: 'Ridge Fork River flood' }),
    )
    expect(html).toContain('class="pfv-circle is-active is-water"')
    expect(html).toContain('data-tip="Ridge Fork River flood. T"')
    expect(html).toContain('aria-label="L"')
    expect(html).toMatch(/<span class="pfv-circle-part">FLOOD<\/span><span class="pfv-circle-part"><span class="pfv-circle-dot"> · <\/span>WARNING<\/span>/)
    expect(html).not.toContain('radialGradient')
  })
})

describe('the fire circle after the split (PLAN-5 §4.8: brief 4 unchanged)', () => {
  it('draws the thermal texture, the record status, the fire name and its brief-4 tooltip and label', () => {
    const s = summaryFixture({ name: 'Willow' })
    ssrState(useStore, { incidentId: s.id, summary: s } as never)
    const html = renderToStaticMarkup(createElement(HazardCircle, {}))
    expect(html).toMatch(/^<button type="button" class="pfv-circle is-quiet" aria-label="Willow fire: wildfire, not listed as active\. More in Command view" aria-describedby="hz[^"]+m" data-tip="Open this fire in the Command view: the timeline, the experimental model, coordinates and every source"><svg class="pfv-circle-tex" width="312" height="312"/)
    expect(html).toContain('stop-color="#ff9a3c"')
    expect(html).toContain('values="0.011 0.02;0.013 0.017;0.010 0.022;0.011 0.02"')
    expect(html).not.toContain('is-water')
    expect(html).not.toContain('flCurrent')
    expect(html).toMatch(/<span class="pfv-circle-name" aria-hidden="true" style="--pfv-name-px:\d+px"><span>Willow<\/span><\/span>/)
  })
})

// ------------------------------------------------------------------------------------------------ facts and key
import alertsWatch from '../../api/__fixtures__/floods/flood-alerts-fixture-flood-watch.json'
import gaugesFlash from '../../api/__fixtures__/floods/river-gauges-fixture-flood-flash.json'
import gaugesWatch from '../../api/__fixtures__/floods/river-gauges-fixture-flood-watch.json'
import fimFlash from '../../api/__fixtures__/floods/maps-rfc_fim-fixture-flood-flash.json'
import evacNm from '../../api/__fixtures__/floods/evacuations.json'
import {
  ALERTS,
  ALERTS_FLASH,
  ALERTS_UNAVAILABLE,
  DETAIL_BUILT_7_DAYS_AGO,
  GAUGE_RISING_AT_END,
  GAUGES,
  GAUGES_UNAVAILABLE,
  RFC_FIM,
  RFC_FIM_UNAVAILABLE,
  SATELLITE,
  SATELLITE_PICTURE_ONLY,
  SATELLITE_UNAVAILABLE,
} from '../../api/__fixtures__/floods/edgeCases'
import type { FloodAlertsResponse, FloodMapResponse, RiverGaugesResponse } from '../../api/types'
import type { EvacuationsResponse } from '../../extras/types'
import { useExtrasRuntime } from '../../extras/runtime'
import { useFloodOfficial } from '../../official/floodHooks'
import { NO_ANSWER, type Answer } from '../../official/floodModel'
import { useFlood } from '../../state/flood'
import {
  ALERTS_UNAVAILABLE as ALERTS_UNAVAILABLE_TEXT,
  FORECAST_HIGH_LABEL,
  GAUGE_BELOW_STAGE,
  GAUGES_UNAVAILABLE as GAUGES_UNAVAILABLE_TEXT,
  NO_GAUGE_NEAR,
  NO_MEMBER_GAUGE,
  NO_PRODUCT,
  NOT_STATED_NWS,
  RFC_FIM_NONE,
  RFC_FIM_UNAVAILABLE as RFC_FIM_UNAVAILABLE_TEXT,
  SAT_NOT_SET_UP_SHORT,
  stripVerbatim,
} from '../shell/floodCopy'
import { floodFacts, floodKeyItems, satLoginNote, type FloodFactsInput } from './floodView'
import { FloodFacts } from './FloodFacts'
import { FloodKey } from './FloodKey'

const ans = <T,>(data: T | null): Answer<T> => ({ data, loading: false, error: null })
const H = 3_600_000
const evacAnswer = ans(evacNm as unknown as EvacuationsResponse)

function input(over: Partial<FloodFactsInput> = {}): FloodFactsInput {
  return {
    summary: real(DETAIL().summary),
    alerts: ans(ALERTS()),
    gauges: ans(GAUGES()),
    fim: ans(RFC_FIM()),
    evac: evacAnswer,
    tf,
    nowMs: FIXTURE_NOW_MS,
    units: 'us',
    ...over,
  }
}

const flashInput = () =>
  input({ summary: real(DETAIL_FLASH().summary), alerts: ans(ALERTS_FLASH()), gauges: ans(gaugesFlash as unknown as RiverGaugesResponse), fim: ans(fimFlash as unknown as FloodMapResponse) })
const watchInput = () => input({ summary: real(DETAIL_WATCH().summary), alerts: ans(alertsWatch as unknown as FloodAlertsResponse), gauges: ans(gaugesWatch as unknown as RiverGaugesResponse), fim: NO_ANSWER })

const rowsText = (i: FloodFactsInput) =>
  floodFacts(i)
    .map((r) => `${r.value} ${r.label} ${r.sub ?? ''}`)
    .join('\n')

describe('facts per kind (PLAN-5 §4.4, C4, C6, C7, D5)', () => {
  it('river: Mapped (never a number), river stage (USGS) of the primary member gauge, forecast crest; then started, product, evacuations, update', () => {
    const rows = floodFacts(input())
    expect(rows.map((r) => r.key)).toEqual(['fim', 'stage', 'crest', 'started', 'product', 'evac', 'updated'])
    expect(rows[0].value).toBe('Mapped')
    expect(rows[0].sub).toMatch(/^NWS's experimental 5-day forecast map · issued .+ · see the map$/)
    expect(rows[0].value).not.toMatch(/\d/)
    expect(rows[1].label).toBe('River stage (USGS)')
    expect(rows[1].value).toBe('17.6')
    expect(rows[1].unit).toBe('ft')
    expect(rows[1].link?.url).toBe('https://water.noaa.gov/gauges/zzrf1')
    expect(rows[2].label).toBe('Forecast crest (NWS)')
    expect(rows[2].sub).toMatch(/^Forecast crest 18\.0 ft, .+ \(NWS Example River Forecast Center \(synthetic\), issued .+\)\. Forecasts change; check NWS for the newest\.$/)
    expect(rows[4].label).toBe('Flood Warning (NWS)')
    expect(rows[4].value).toBe('In effect')
    expect(rows[4].sub).toMatch(/until .+ · NWS Example Office \(synthetic\)$/)
    expect(rows[4].tip).toMatch(/^sent /)
    // no satellite or model figure, never a km² / mi² area
    expect(rowsText(input())).not.toMatch(/km²|mi²|NWM|model/i)
  })
  it('river: a primary gauge forecast still rising at its last step reads FORECAST HIGH (C7)', () => {
    const g = GAUGES()
    const rising = GAUGE_RISING_AT_END()
    g.gauges = [{ ...rising, member: true }]
    const rows = floodFacts(input({ gauges: ans(g), summary: { ...real(DETAIL().summary), primary_gauge: { ...real(DETAIL().summary).primary_gauge!, lid: rising.lid } } }))
    const crest = rows.find((r) => r.key === 'crest')!
    expect(crest.label).toBe(FORECAST_HIGH_LABEL)
    expect(crest.sub).toMatch(/^Highest NWS forecast value .+ at the end of the forecast \(.+\); the river is still forecast to rise/)
  })
  it("river (integration): NWS's highest forecast value for a time that has passed, or below the latest reading, is not a crest", () => {
    const crestMs = GAUGES().gauges[0].forecast!.max_ms!
    const passed = floodFacts(input({ nowMs: crestMs + H })).find((r) => r.key === 'crest')!
    expect(passed.label).toBe('Highest NWS forecast')
    expect(passed.sub).toMatch(/^Highest NWS forecast value 18\.0 ft was for .+, which has passed; no higher value is forecast after it/)
    const g = GAUGES()
    g.gauges = g.gauges.map((x, i) => (i === 0 ? { ...x, observed: { ...x.observed, value: (x.forecast?.max_value ?? 0) + 0.5 } } : x))
    const below = floodFacts(input({ gauges: ans(g) })).find((r) => r.key === 'crest')!
    expect(below.label).toBe('Highest NWS forecast')
    expect(below.sub).toMatch(/below the latest reading: not a crest still to come/)
  })
  it('flash (fixture-flood-flash): detection and damage threat verbatim, NO_MEMBER_GAUGE (never the nearby below-stage gauge)', () => {
    const rows = floodFacts(flashInput())
    expect(rows.map((r) => r.key)).toEqual(['detection', 'damage', 'gauges', 'started', 'product', 'evac', 'updated'])
    expect(rows[0]).toMatchObject({ value: 'OBSERVED', verbatim: true, label: 'Flash flood detection (NWS)' })
    expect(rows[1]).toMatchObject({ value: 'CATASTROPHIC', verbatim: true, label: 'Damage threat (NWS)' })
    expect(rows[1].sub).toMatch(/^Flash Flood Emergency/)
    expect(rows[2].value).toBe(NO_MEMBER_GAUGE)
    expect(rowsText(flashInput())).not.toContain('ZZEC1')
    expect(rowsText(flashInput())).not.toContain(GAUGE_BELOW_STAGE)
  })
  it('flash without the NWS fields: NOT_STATED_NWS', () => {
    const a = ALERTS_FLASH()
    a.alerts = a.alerts.map((x) => ({ ...x, detection: null, damage_threat: null }))
    const s = { ...real(DETAIL_FLASH().summary), products: real(DETAIL_FLASH().summary).products.map((p) => ({ ...p, damage_threat: null })) }
    const rows = floodFacts({ ...flashInput(), alerts: ans(a), summary: s })
    expect(rows[0].value).toBe(NOT_STATED_NWS)
    expect(rows[1].value).toBe(NOT_STATED_NWS)
  })
  it('watch only (fixture-flood-watch): the watch area verbatim (two areas and N more), river gauges, river forecast; the product row is the watch', () => {
    const rows = floodFacts(watchInput())
    expect(rows.map((r) => r.key)).toEqual(['watchArea', 'gauges', 'riverForecast', 'started', 'product', 'evac', 'updated'])
    expect(rows[0]).toMatchObject({ value: 'Example Valley; Sample Foothills and 1 more', verbatim: true })
    expect(rows[1].value).toBe(NO_MEMBER_GAUGE)
    expect(rows[2].value).toBe('No NWS river forecast for this gauge')
    expect(rows[4].label).toBe('Flood Watch (NWS)')
  })
  it('a past flood: its last product "Was in effect" as of its date; forecasts not kept for past dates', () => {
    const rows = floodFacts(input({ summary: real(PAST_FLOOD()) }))
    const product = rows.find((r) => r.key === 'product')!
    expect(product.value).toBe('Was in effect')
    expect(product.sub).toMatch(/^as of [A-Z][a-z]{2} \d{1,2}, 2025/)
    expect(rows.find((r) => r.key === 'crest')?.value).toBe('Not available for past dates')
  })
  it('every fact names its issuer or source, and no fact uses a banned word', () => {
    for (const i of [input(), flashInput(), watchInput()]) for (const r of floodFacts(i)) expect(floodWordingProblems(`${r.value} ${r.label} ${r.sub ?? ''}`), r.key).toEqual([])
  })
})

describe('absence needs an answer (D24, C3)', () => {
  const absent = [NO_PRODUCT, RFC_FIM_NONE, GAUGE_BELOW_STAGE, NO_GAUGE_NEAR]
  it('alerts, gauges and the RFC FIM map unavailable: their "could not be reached" texts, never an absence sentence', () => {
    const s = { ...real(DETAIL().summary), products: [] }
    const text = rowsText(input({ summary: s, alerts: ans(ALERTS_UNAVAILABLE()), gauges: ans(GAUGES_UNAVAILABLE()), fim: ans(RFC_FIM_UNAVAILABLE()) }))
    for (const a of absent) expect(text).not.toContain(a)
    expect(text).toContain(ALERTS_UNAVAILABLE_TEXT)
    expect(text).toContain(GAUGES_UNAVAILABLE_TEXT)
    expect(text).toContain(RFC_FIM_UNAVAILABLE().reason ?? RFC_FIM_UNAVAILABLE_TEXT)
  })
  it('a failed request (no envelope) is the same', () => {
    const s = { ...real(DETAIL().summary), products: [] }
    const failed: Answer<never> = { data: null, loading: false, error: 'API 503' }
    const text = rowsText(input({ summary: s, alerts: failed, gauges: failed, fim: failed }))
    for (const a of absent) expect(text).not.toContain(a)
  })
  it('available answers with nothing in them say so (NO_PRODUCT, RFC_FIM_NONE)', () => {
    const a = ALERTS()
    a.alerts = []
    const f = RFC_FIM()
    f.features = { type: 'FeatureCollection', features: [] }
    const text = rowsText(input({ summary: { ...real(DETAIL().summary), products: [] }, alerts: ans(a), fim: ans(f) }))
    expect(text).toContain(NO_PRODUCT)
    expect(text).toContain(RFC_FIM_NONE)
  })
})

describe('key (D8, C2, C16)', () => {
  const layers = { satellite: true, forecastArea: true, warnings: true, channel: true, floodplain: false }
  it('each layer with its own time; satellite age computed now; no-view hatch and image edge; nothing called "now"', () => {
    const items = floodKeyItems({ satellite: SATELLITE(), fim: RFC_FIM(), nfhl: null, warnings: true, layers, tf, nowMs: FIXTURE_NOW_MS })
    expect(items.map((i) => i.key)).toEqual(['satellite', 'noView', 'edge', 'forecast', 'channel', 'warning'])
    expect(items[0].text).toBe('Water seen by satellite')
    expect(items[0].time).toMatch(/^Oct 31, 10:00 AM MDT$/)
    expect(items[0].age).toBe('4 d ago')
    expect(items[0].stale).toBe(true)
    expect(items[3].text).toMatch(/^NWS forecast flooded area · issued /)
    expect(items.map((i) => i.text).join(' ')).not.toMatch(/\bnow\b/i)
  })
  it('a bundle built 7 days earlier: the age is computed at render (7+ days), never read from a file', () => {
    const later = FIXTURE_NOW_MS + 7 * 24 * H
    expect(DETAIL_BUILT_7_DAYS_AGO().manifest).not.toBeNull()
    const items = floodKeyItems({ satellite: SATELLITE(), fim: null, nfhl: null, warnings: false, layers, tf, nowMs: later })
    expect(Number(/^(\d+) d ago$/.exec(items[0].age ?? '')?.[1])).toBeGreaterThanOrEqual(11)
  })
  it('picture only and unavailable', () => {
    const pic = floodKeyItems({ satellite: SATELLITE_PICTURE_ONLY(), fim: null, nfhl: null, warnings: false, layers, tf, nowMs: FIXTURE_NOW_MS, pictureDrawn: true })
    expect(pic[0].key).toBe('picture')
    // not drawn (the default): the key says there is no usable image, never names a picture it does not show
    expect(floodKeyItems({ satellite: SATELLITE_PICTURE_ONLY(), fim: null, nfhl: null, warnings: false, layers, tf, nowMs: FIXTURE_NOW_MS })[0].key).toBe('satNone')
    expect(pic[0].text).toMatch(/^Satellite water: NASA picture, .+ \(not measured here\)$/)
    expect(floodKeyItems({ satellite: SATELLITE_UNAVAILABLE(), fim: null, nfhl: null, warnings: false, layers, tf, nowMs: FIXTURE_NOW_MS }).some((i) => i.key === 'satellite')).toBe(false)
  })
  it('no token: SAT_NOT_SET_UP_SHORT for the legend details; never the token', () => {
    expect(satLoginNote(SATELLITE())?.short).toBe(SAT_NOT_SET_UP_SHORT)
    expect(satLoginNote({ ...SATELLITE(), login: 'configured', login_note: null })).toBeNull()
  })
})

describe('rendered facts and key: every fixture case passes the wording guard (PLAN-5 §5.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_NOW_MS, toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const cases: [string, FloodFactsInput][] = [
    ['river', input()],
    ['flash', flashInput()],
    ['watch', watchInput()],
    ['outages', input({ alerts: ans(ALERTS_UNAVAILABLE()), gauges: ans(GAUGES_UNAVAILABLE()), fim: ans(RFC_FIM_UNAVAILABLE()) })],
    ['past', input({ summary: real(PAST_FLOOD()) })],
  ]
  for (const [name, i] of cases)
    it(name, () => {
      ssrState(useFlood, { floodId: i.summary!.id, summary: i.summary } as never)
      ssrState(useFloodOfficial, { floodId: i.summary!.id, alerts: i.alerts, gauges: i.gauges, fim: i.fim, satellite: ans(SATELLITE()), nfhl: NO_ANSWER, local: NO_ANSWER } as never)
      ssrState(useExtrasRuntime, { evac: { ...i.evac, refresh: () => undefined } } as never)
      const html = renderToStaticMarkup(createElement('div', null, createElement(FloodFacts), createElement(FloodKey)))
      expect(html).toContain('Not an all-clear. Follow local officials.')
      expect(html).toContain('href="https://water.noaa.gov"')
      expect(floodWordingProblems(stripVerbatim(html))).toEqual([])
      // NWS's own words are marked
      if (name === 'flash') expect(html).toContain('<span data-verbatim="">OBSERVED</span>')
    })
})

// ------------------------------------------------------------------------------------------------ chip and leader
import { distanceToFlood, floodChipText, leaderTarget, polygonsOf } from './floodView'

describe('distance chip (PLAN-5 §4.4 distance chip lines)', () => {
  const warnings = ALERTS()
    .alerts.filter((a) => a.event === 'Flood Warning')
    .flatMap((a) => polygonsOf(a.geometry))
  const forecast = RFC_FIM().features.features.flatMap((f) => polygonsOf(f.geometry))
  const gauge = { lat: 36.78458, lon: -108.06357 }
  it('to the edge of the NWS warning area first', () => {
    const d = distanceToFlood({ lat: 36.95, lon: -107.9 }, { warnings, forecast, gauge })!
    expect(d.to).toBe('warning')
    const t = floodChipText(d, 'us')
    expect(t.measures).toBe('to the edge of the NWS warning area')
    expect(t.direction).toMatch(/of you$/)
    expect(t.spoken).toMatch(/^The flood is .+ of you, to the edge of the NWS warning area\.$/)
  })
  it('else the NWS forecast flooded area, else the gauge (not the water edge); inside the warning area', () => {
    expect(distanceToFlood({ lat: 36.95, lon: -107.9 }, { warnings: [], forecast, gauge })?.to).toBe('forecast')
    const g = distanceToFlood({ lat: 36.95, lon: -107.9 }, { warnings: [], forecast: [], gauge })!
    expect(floodChipText(g, 'us').measures).toBe("to the river gauge, not the water's edge")
    const inside = distanceToFlood(gauge, { warnings, forecast, gauge })!
    expect(inside.inside).toBe(true)
    expect(floodChipText(inside, 'us').measures).toBe('Inside the NWS warning area')
    expect(distanceToFlood({ lat: 36.95, lon: -107.9 }, { warnings: [], forecast: [], gauge: null })).toBeNull()
  })
  it('the chip words never say safe or an all-clear', () => {
    const d = distanceToFlood({ lat: 36.95, lon: -107.9 }, { warnings, forecast, gauge })!
    expect(floodWordingProblems(Object.values(floodChipText(d, 'metric')).join(' '))).toEqual([])
  })
})

describe('leader end (D10, C4)', () => {
  it('a river flood: its primary member gauge', () => {
    expect(leaderTarget(DETAIL().summary, [])).toMatchObject({ kind: 'gauge', lat: 36.78458, lon: -108.06357 })
  })
  it('a flash flood without a member gauge: a point inside its largest NWS polygon, never a nearby gauge', () => {
    const s = DETAIL_FLASH().summary
    expect(s.primary_gauge).toBeNull()
    const polys = ALERTS_FLASH().alerts.flatMap((a) => polygonsOf(a.geometry))
    const t = leaderTarget(s, polys)!
    expect(t.kind).toBe('polygon')
    const ring = polys[0][0]
    const xs = ring.map((p) => p[0])
    const ys = ring.map((p) => p[1])
    expect(t.lon).toBeGreaterThanOrEqual(Math.min(...xs))
    expect(t.lon).toBeLessThanOrEqual(Math.max(...xs))
    expect(t.lat).toBeGreaterThanOrEqual(Math.min(...ys))
    expect(t.lat).toBeLessThanOrEqual(Math.max(...ys))
  })
})

// ------------------------------------------------------------------------------------------------ review fixes
import { FloodLegend } from '../../map/FloodLegend'
import { FloodSatStatus } from './FloodKey'
import { EVAC_UNAVAILABLE, FLOOD_PUBLIC, SAT_UNAVAILABLE } from '../shell/floodCopy'

describe('review WFP-R1: a failed or running satellite / forecast-area request is said, never a silent gap', () => {
  const layers = { satellite: true, forecastArea: true, warnings: true, channel: true, floodplain: false }
  const base = { nfhl: null, warnings: true, layers, tf, nowMs: FIXTURE_NOW_MS }
  it('failed requests (no answer): SAT_UNAVAILABLE and RFC_FIM_UNAVAILABLE items, the request error in the tooltip', () => {
    const items = floodKeyItems({ ...base, satellite: null, fim: null, satelliteState: 'unavailable', fimState: 'unavailable', satelliteError: 'API 503', fimError: 'API 429' })
    expect(items.map((i) => i.key)).toEqual(['satUnavailable', 'fimUnavailable', 'channel', 'warning'])
    expect(items[0]).toMatchObject({ text: SAT_UNAVAILABLE, tip: 'API 503' })
    expect(items[1]).toMatchObject({ text: RFC_FIM_UNAVAILABLE_TEXT, tip: 'API 429' })
  })
  it('requests still running: "checking" items', () => {
    const items = floodKeyItems({ ...base, satellite: null, fim: null, satelliteState: 'loading', fimState: 'loading' })
    expect(items.slice(0, 2).map((i) => i.text)).toEqual([FLOOD_PUBLIC.keySatChecking, FLOOD_PUBLIC.keyForecastChecking])
  })
  it('answers that say unavailable: the same items, the backend reason in the tooltip', () => {
    const items = floodKeyItems({ ...base, satellite: SATELLITE_UNAVAILABLE(), fim: RFC_FIM_UNAVAILABLE() })
    expect(items.map((i) => i.key)).toContain('satUnavailable')
    expect(items.map((i) => i.key)).toContain('fimUnavailable')
  })
  it('a layer switched off says nothing', () => {
    expect(floodKeyItems({ ...base, layers: { ...layers, satellite: false, forecastArea: false }, satellite: null, fim: null, satelliteState: 'unavailable', fimState: 'unavailable' }).map((i) => i.key)).toEqual(['channel', 'warning'])
  })
  it('rendered: the key, the satellite status and the legend details say the layers could not be loaded', () => {
    const s = real(DETAIL().summary)
    const failed: Answer<never> = { data: null, loading: false, error: 'API 503' }
    ssrState(useFlood, { floodId: s.id, summary: s } as never)
    ssrState(useFloodOfficial, { floodId: s.id, alerts: ans(ALERTS()), gauges: ans(GAUGES()), fim: failed, satellite: failed, nfhl: NO_ANSWER, local: NO_ANSWER } as never)
    const key = renderToStaticMarkup(createElement(FloodKey))
    expect(key).toContain(SAT_UNAVAILABLE)
    expect(key).toContain(RFC_FIM_UNAVAILABLE_TEXT)
    expect(renderToStaticMarkup(createElement(FloodSatStatus))).toContain(FLOOD_PUBLIC.satStatusUnavailable)
    const Legend = () => FloodLegend({ variant: 'panel' })
    const legend = renderToStaticMarkup(createElement(Legend))
    expect(legend).toContain(SAT_UNAVAILABLE)
    expect(legend).toContain(RFC_FIM_UNAVAILABLE_TEXT)
    expect(floodWordingProblems(stripVerbatim(key + legend))).toEqual([])
  })
})

describe('review WFP-R2: one reading per gauge (the newer of the list and the gauges answer)', () => {
  const s = real(DETAIL().summary)
  const pg = s.primary_gauge!
  it('the list has the newer reading: the stage row shows it with its own time and category', () => {
    const at = GAUGES().gauges[0].observed.valid_ms! + 3 * H
    const newer = { ...s, primary_gauge: { ...pg, observed_value: 19.4, observed_category: 'major' as const, observed_ms: at } }
    const later = at + 10 * 60_000
    const stage = floodFacts(input({ summary: newer, nowMs: later })).find((r) => r.key === 'stage')!
    expect(stage.value).toBe('19.4')
    expect(stage.sub).toMatch(/^Major flooding \(NWS\) · /)
    expect(stage.sub).toMatch(/\(10 min ago\)$/)
    expect(stage.tone).toBe('alert')
  })
  it('the gauges answer has the newer reading: the stage row keeps it (a below-stage reading is never shown as the list\'s minor)', () => {
    const older = { ...s, primary_gauge: { ...pg, observed_value: 2.03, observed_category: 'minor' as const, observed_ms: FIXTURE_NOW_MS - 5 * H } }
    const g = GAUGES()
    g.gauges = g.gauges.map((x) => (x.lid === pg.lid ? { ...x, observed: { ...x.observed, value: 1.3, category: 'no_flooding' as const, valid_ms: FIXTURE_NOW_MS - 20 * 60_000 } } : x))
    const stage = floodFacts(input({ summary: older, gauges: ans(g) })).find((r) => r.key === 'stage')!
    expect(stage.value).toBe('1.3')
    expect(stage.sub).toMatch(/^Below flood stage\./)
  })
})

describe('review WFP-R5, R7, R12: outage wording, product sources, no-gauge forecast', () => {
  it('R5: a failed forecast-area request says RFC_FIM_UNAVAILABLE (not an all-clear), the error in the tooltip', () => {
    const fim = floodFacts(input({ fim: { data: null, loading: false, error: 'Unavailable right now: test outage (HTTP 503)' } })).find((r) => r.key === 'fim')!
    expect(fim.sub).toBe(RFC_FIM_UNAVAILABLE_TEXT)
    expect(fim.tip).toBe('Unavailable right now: test outage (HTTP 503)')
  })
  it('R5: a failed evacuation request says EVAC_UNAVAILABLE (flood wording, not an all-clear), the error in the tooltip', () => {
    const evac = floodFacts(input({ evac: { data: null, loading: false, error: 'The Disaster Mapping server could not get data from this source.' } })).find((r) => r.key === 'evac')!
    expect(evac.sub).toBe(EVAC_UNAVAILABLE)
    expect(evac.sub).toMatch(/not an all-clear/)
    expect(evac.tip).toBe('The Disaster Mapping server could not get data from this source.')
  })
  it('R7: detection, damage threat and watch area name the issuer, its own sent time and link to the product', () => {
    const withUrl = <T extends { alerts: { url: string | null }[] }>(r: T): T => ({ ...r, alerts: r.alerts.map((a) => ({ ...a, url: 'https://api.weather.gov/alerts/urn:oid:example' })) })
    const flash = floodFacts({ ...flashInput(), alerts: ans(withUrl(ALERTS_FLASH())) })
    for (const k of ['detection', 'damage'] as const) {
      const r = flash.find((x) => x.key === k)!
      expect(r.sub).toMatch(/· sent [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M [A-Z]{3,4}$/)
      expect(r.link?.url).toMatch(/^https:\/\//)
    }
    const watch = floodFacts({ ...watchInput(), alerts: ans(withUrl(alertsWatch as unknown as FloodAlertsResponse)) }).find((x) => x.key === 'watchArea')!
    expect(watch.sub).toMatch(/· sent /)
    expect(watch.link?.url).toMatch(/^https:\/\//)
  })
  it('R12: a flood without a gauge says why there is no forecast point under NO_RFC_FORECAST', () => {
    const r = floodFacts(watchInput()).find((x) => x.key === 'riverForecast')!
    expect(r.value).toBe('No NWS river forecast for this gauge')
    expect(r.sub).toBe(FLOOD_PUBLIC.noForecastNoGauge)
  })
})
