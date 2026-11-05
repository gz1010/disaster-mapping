// The river-level chart rendered on the server (PLAN-5 §4.6): slim and dock, the line key with issuer and issue time,
// the NWS levels, LATEST, NOW, the handle as a keyboard slider (no play button), the future-products note after now
// (C1), the model on the flow axis only and never without a reach (D20, C28), empty and failed states, and no banned
// word in Fire-3d's own words.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALERTS, DETAIL, DETAIL_FLASH, FIXTURE_NOW_MS, GAUGES, GAUGES_UNAVAILABLE, MODEL_SERIES } from '../../api/__fixtures__/floods/edgeCases'
import zzrf1 from '../../api/__fixtures__/floods/river-gauges-ZZRF1.json'
import zzrf3 from '../../api/__fixtures__/floods/river-gauges-ZZRF3.json'
import type { ModelOutputResponse, RiverGaugesResponse } from '../../api/types'
import { useFloodOfficial } from '../../official/floodHooks'
import { NO_ANSWER, type Answer } from '../../official/floodModel'
import { useFlood } from '../../state/flood'
import { useWorkspace } from '../../state/workspace'
import { CURSOR_FUTURE_ISSUED, CURSOR_FUTURE_PRODUCTS, floodWordingProblems, HYDRO, NO_MEMBER_GAUGE, stripVerbatim } from '../shell/floodCopy'
import { restoreSsrState, ssrState } from '../ssr.testutil'
import { GaugeList, Hydrograph, type HydrographProps } from './Hydrograph'
import { gaugeKey, modelKey, useHydroData } from './hydrographData'

const ans = <T,>(data: T | null): Answer<T> => ({ data, loading: false, error: null })
const G1 = () => structuredClone(zzrf1) as unknown as RiverGaugesResponse
const G3 = () => structuredClone(zzrf3) as unknown as RiverGaugesResponse

function render(p: Partial<HydrographProps> = {}, o: { cursorMs?: number | null; gauge?: Answer<RiverGaugesResponse>; model?: Answer<ModelOutputResponse>; lid?: string; detail?: ReturnType<typeof DETAIL>; official?: RiverGaugesResponse } = {}) {
  const detail = o.detail ?? DETAIL()
  const lid = o.lid ?? 'ZZRF1'
  ssrState(useWorkspace, { preset: 'command' })
  ssrState(useFlood, { floodId: detail.summary.id, summary: detail.summary, cursorMs: o.cursorMs ?? null } as never)
  ssrState(useFloodOfficial, { floodId: detail.summary.id, alerts: ans(ALERTS()), gauges: ans(o.official ?? GAUGES()), fim: NO_ANSWER, satellite: NO_ANSWER, nfhl: NO_ANSWER, local: NO_ANSWER } as never)
  ssrState(useHydroData, {
    gauges: { [gaugeKey(lid, null)]: o.gauge ?? ans(G1()) },
    models: o.model ? { [modelKey(detail.summary.id, lid)]: o.model } : {},
    asked: {},
  })
  return renderToStaticMarkup(createElement(Hydrograph, { variant: 'slim', floodId: detail.summary.id, lid: o.lid ?? null, widthPx: 1000, ...p }))
}

beforeEach(() => {
  vi.useFakeTimers({ now: FIXTURE_NOW_MS, toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
  restoreSsrState()
})

describe('Hydrograph (slim)', () => {
  it('draws the observed and forecast lines with their words, the NWS levels, LATEST and NOW; no play button', () => {
    const html = render()
    expect(html).toContain('ZZRF1 · Ridge Fork River at Example Crossing')
    expect(html).toContain('OBSERVED · USGS')
    expect(html).toMatch(/FORECAST · NWS ZZRFC · ISSUED NOV 4 \d\d:\d\d MST/)
    expect(html).toContain('MINOR 15.0')
    expect(html).toContain('MAJOR 19.0')
    expect(html).toContain('LATEST 11:00 · JUST NOW')
    expect(html).toContain('hg-line is-observed')
    expect(html).toContain('hg-line is-forecast')
    expect(html).toContain('>NOW</button>')
    expect(html).toContain('CREST 18.0 FT THU 17:00')
    expect(html).not.toMatch(/aria-label="Play|Pause playback/)
    // product times as ticks with their own words
    expect((html.match(/class="hg-product/g) ?? []).length).toBe(3)
  })

  it('the handle is a keyboard slider saying the time and the value; the map follows useFlood.cursorMs', () => {
    const html = render()
    expect(html).toContain('role="slider"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-valuetext="NOV 4 11:00 MST · 17.6 FT OBSERVED · MODERATE"')
    expect(html).toContain(HYDRO.sliderHelp)
  })

  it('after now: the forecast value and CURSOR_FUTURE_PRODUCTS (C1)', () => {
    const html = render({}, { cursorMs: FIXTURE_NOW_MS + 30 * 3600e3 })
    expect(html).toContain('FORECAST (NWS)')
    expect(html).toContain(CURSOR_FUTURE_PRODUCTS)
  })

  it('stage axis: never the model, even with a model answer', () => {
    const html = render({}, { model: ans(MODEL_SERIES()) })
    expect(html).not.toContain('MODEL · NWM')
    expect(html).not.toContain('hg-line is-model')
  })

  it('flow axis: the model dotted with its label on its own line; NWS flow on line 1 (C28)', () => {
    const html = render({ initialAxis: 'flow' }, { model: ans(MODEL_SERIES()) })
    expect(html).toContain('hg-line is-model')
    expect(html).toContain('MODEL · NWM · EXPERIMENTAL')
    expect(html).toMatch(/<span class="hg-hl-value is-observed"> · 7,060 FT³\/S OBSERVED<\/span>/)
    expect(html).toMatch(/<span class="hg-hl-line is-model">MODEL · NWM · EXPERIMENTAL · [≈]?[\d,]+ FT³\/S \(RUN NOV 4/)
    expect(html).toContain(HYDRO.flowNoStages)
  })

  it('flow axis without an NWM reach: no model line and no model label (C28)', () => {
    const fake = { ...MODEL_SERIES(), lid: 'ZZRF3' }
    const html = render({ initialAxis: 'flow' }, { lid: 'ZZRF3', gauge: ans(G3()), model: ans(fake) })
    expect(html).not.toContain('MODEL · NWM')
    expect(html).not.toContain('hg-line is-model')
  })

  it('the gauge picker lists the flood gauges, members first, nearby ones labelled', () => {
    const html = render()
    expect(html).toContain('aria-label="Choose the river gauge (ZZRF1)"')
  })

  it('a flood with no river gauge says so (no member gauge)', () => {
    const flash = DETAIL_FLASH()
    expect(flash.summary.primary_gauge).toBeNull()
    const html = render({}, { detail: flash, official: { ...GAUGES(), gauges: GAUGES().gauges.map((g) => ({ ...g, member: false })) } })
    expect(html).toContain(NO_MEMBER_GAUGE)
  })

  it('a failed gauge answer says it could not be loaded (never an empty chart)', () => {
    const html = render({}, { gauge: ans(GAUGES_UNAVAILABLE()) })
    expect(html).toContain(GAUGES_UNAVAILABLE().reason ?? 'missing reason')
    const failed = render({}, { gauge: { data: null, loading: false, error: 'HTTP 502' } })
    expect(failed).toContain(HYDRO.unavailable)
  })

  it("no banned word in Fire-3d's own words", () => {
    for (const html of [render(), render({ initialAxis: 'flow' }, { model: ans(MODEL_SERIES()) }), render({ variant: 'dock' }, { cursorMs: FIXTURE_NOW_MS + 30 * 3600e3 })])
      expect(floodWordingProblems(stripVerbatim(html))).toEqual([])
  })
})

describe('Hydrograph (dock)', () => {
  it('renders the same chart without the picker; the key keeps the forecast issuer and its issue time (WFC-R11)', () => {
    const html = render({ variant: 'dock' })
    expect(html).toContain('hg is-dock')
    expect(html).not.toContain('hg-pick')
    expect(html).toMatch(/FORECAST · NWS ZZRFC · ISSUED \d\d:\d\d/)
    // the full label (with the day and zone) is the key item's tooltip
    expect(html).toMatch(/title="FORECAST · NWS ZZRFC · ISSUED NOV 4 \d\d:\d\d MST"/)
    expect(html).toContain('role="slider"')
  })
})

// review WFC-R3: a three-line handle (value, the model's line, the future note) never prints over the plot or the key
describe('Hydrograph: three-line handle (WFC-R3)', () => {
  const three = (variant: 'slim' | 'dock') => render({ variant, initialAxis: 'flow' }, { cursorMs: FIXTURE_NOW_MS + 30 * 3600e3, model: ans(MODEL_SERIES()) })
  for (const variant of ['slim', 'dock'] as const)
    it(`${variant}: the row is sized for its two label lines; the future note is its own wrapped line before the plot`, () => {
      const html = three(variant)
      const px = variant === 'slim' ? 32 : 28
      expect(html).toContain(`class="hg-handle-row${variant === 'dock' ? ' is-dock' : ''}" style="height:${px}px" data-lines="2"`)
      expect(html).toContain('hg-hl-line is-model')
      // the note: not inside the absolutely placed label, never cut (no ellipsis), placed before the plot
      expect(html).not.toContain('hg-hl-line is-future')
      const note = html.indexOf('<p class="hg-future-note"')
      expect(note).toBeGreaterThan(html.indexOf('hg-handle-row'))
      expect(note).toBeLessThan(html.indexOf('class="hg-plot"'))
      expect(html).toContain(CURSOR_FUTURE_PRODUCTS)
    })
  it('a handle inside a product NWS issued for that time: CURSOR_FUTURE_ISSUED, never "NWS has issued none" (WFC-R1)', () => {
    const html = render({}, { cursorMs: FIXTURE_NOW_MS + 4 * 3600e3 })
    expect(html).toContain(CURSOR_FUTURE_ISSUED)
    expect(html).not.toContain(CURSOR_FUTURE_PRODUCTS)
  })
})

// review WFC-R10: the gauge list is a listbox of option groups with one tab stop (the current gauge)
describe('GaugeList (WFC-R10)', () => {
  it('options in labelled groups, the current gauge selected and the only tab stop', () => {
    render()
    const html = renderToStaticMarkup(createElement(GaugeList, { floodId: DETAIL().summary.id, lid: 'ZZRF1' }))
    expect(html).toContain('role="listbox"')
    expect(html).toMatch(/role="group" aria-labelledby="[^"]+-members"/)
    expect((html.match(/role="option"/g) ?? []).length).toBe(GAUGES().gauges.length)
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1)
    expect(html).toMatch(/aria-selected="true" tabindex="0"/)
  })
})
