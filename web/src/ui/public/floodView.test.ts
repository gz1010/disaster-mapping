// The Public flood view's words (brief 5, PLAN-5 §4.4, §5.2; D19, C15): circle status and meaning for every case, the
// short name, the place and date line; the disc's water texture (verbatim layers, no animation under reduced motion)
// and the fire circle drawn exactly as brief 4 drew it (the HazardDisc split, PLAN-5 §4.8).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { FIXTURE_NOW_MS, DETAIL, DETAIL_FLASH, DETAIL_WATCH, LIST, PAST_FLOOD } from '../../api/__fixtures__/floods/edgeCases'
import { summaryFixture } from '../../api/fixtures.testutil'
import type { FloodSummary } from '../../api/types'
import { timeFmt } from '../../lib/time'
import { useStore } from '../../state/store'
import { CIRCLE_MEANING, CIRCLE_STATUS, floodWordingProblems } from '../shell/floodCopy'
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
  it('PRESENT, SEEN BY FIRE-3D SINCE, and a past flood with its last NWS product; never ENDED', () => {
    const s = DETAIL().summary
    expect(floodDateLine({ ...s, started_basis: 'nws_product' }, tf.tz)).toMatch(/^[A-Z]{3} \d{1,2} 2026 — PRESENT$/)
    expect(floodDateLine({ ...s, started_basis: 'first_seen' }, tf.tz)).toMatch(/^SEEN BY FIRE-3D SINCE [A-Z]{3} \d{1,2} 2026$/)
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
