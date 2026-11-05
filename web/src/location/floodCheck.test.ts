// The flood view's point check (brief 5, PLAN-5 §4.4, D24, D25, C1, C2): each layer in its own words; products on both
// sides of now; no view and outside the image said so; absence only from an available answer.
import { describe, expect, it } from 'vitest'
import { ALERTS, FIXTURE_NOW_MS, RFC_FIM, RFC_FIM_UNAVAILABLE, SATELLITE, SATELLITE_UNAVAILABLE } from '../api/__fixtures__/floods/edgeCases'
import nfhlFixture from '../api/__fixtures__/floods/maps-nfhl.json'
import type { FloodMapResponse } from '../api/types'
import { timeFmt } from '../lib/time'
import { CURSOR_FUTURE_PRODUCTS, FLOOD_PUBLIC, floodWordingProblems, NFHL_DOWN, NFHL_OUTSIDE, NOTHING_COVERS, RFC_FIM_UNAVAILABLE as RFC_FIM_UNAVAILABLE_TEXT, SAT_CLOUD_POINT, SAT_NODATA_POINT, SAT_OUTSIDE_POINT, SAT_UNAVAILABLE } from '../ui/shell/floodCopy'
import { pngClassAt } from '../official/floodHooks'
import { checkPoint, type FloodPointInput } from './floodCheck'

const H = 3_600_000
const tf = timeFmt('America/Denver', '12h')
const gauge: [number, number] = [-108.06357, 36.78458]
const far: [number, number] = [-107.5, 37.3]

const input = (over: Partial<FloodPointInput> = {}): FloodPointInput => ({
  point: gauge,
  alerts: ALERTS().alerts,
  alertsStatus: 'available',
  zones: ALERTS().zones,
  fim: RFC_FIM(),
  satellite: SATELLITE(),
  satClass: 1,
  nfhl: null,
  model: null,
  gauges: [],
  rivers: ['Ridge Fork River'],
  cursorMs: null,
  nowMs: FIXTURE_NOW_MS,
  tf,
  units: 'us',
  ...over,
})

const texts = (i: FloodPointInput) => checkPoint(i).lines.map((l) => l.text)

describe('checkPoint (CONTRACT §16.12)', () => {
  it('inside the Flood Warning (until its own end, issuer zone) and the forecast flooded area; satellite water', () => {
    const c = checkPoint(input())
    expect(c.lines.find((l) => l.key.startsWith('in-') && l.event === 'Flood Warning')?.text).toMatch(/^Inside the NWS Flood Warning area \(until Nov \d{1,2}, .+ M[SD]T\)\.$/)
    expect(c.lines.find((l) => l.key === 'fim')?.text).toBe('Inside the NWS forecast flooded area (5-day maximum).')
    expect(c.lines.find((l) => l.key === 'sat')?.text).toMatch(/^Water seen by satellite at this spot on the Oct 31 pass/)
    expect(c.nothing).toBe(false)
    expect(c.future).toBe(false)
  })
  it('C1: a handle 30 h after now keeps the products in effect now, with CURSOR_FUTURE_PRODUCTS', () => {
    const c = checkPoint(input({ cursorMs: FIXTURE_NOW_MS + 30 * H }))
    expect(c.future).toBe(true)
    expect(c.lines.some((l) => l.event === 'Flood Warning' && l.inside)).toBe(true)
    expect(c.lines.map((l) => l.text)).toContain(CURSOR_FUTURE_PRODUCTS)
  })
  it('C1: a handle long before the products: none in effect then, the distance to none; nothing covers', () => {
    const c = checkPoint(input({ cursorMs: FIXTURE_NOW_MS - 30 * 24 * H, fim: null, satellite: null }))
    expect(c.lines.some((l) => l.kind === 'official')).toBe(false)
    expect(c.nothing).toBe(true)
    expect(texts(input({ cursorMs: FIXTURE_NOW_MS - 30 * 24 * H, fim: null, satellite: null }))).toContain(NOTHING_COVERS)
  })
  it('far away: distances to the warning area and the forecast area; no-water pixels say dry pixels do not mean no flooding', () => {
    const t = texts(input({ point: far, satClass: 0 }))
    expect(t.find((x) => /from the NWS .+ area\.$/.test(x))).toBeTruthy()
    expect(t.find((x) => /from the NWS forecast flooded area\.$/.test(x))).toBeTruthy()
    expect(t).toContain(SAT_OUTSIDE_POINT.replace('{date}', 'Oct 31'))
    expect(t).toContain(NOTHING_COVERS)
  })
  it('C2: clouds, no data and the picture-only no-view at the spot', () => {
    expect(texts(input({ satClass: 253 }))).toContain(SAT_CLOUD_POINT.replace('{date}', 'Oct 31'))
    expect(texts(input({ satClass: 255 }))).toContain(SAT_NODATA_POINT.replace('{date}', 'Oct 31'))
    expect(texts(input({ satClass: 'noview' }))).toContain('No satellite view of this spot on the Oct 31 pass (clouds or no data).')
    expect(texts(input({ satClass: 0 }))).toContain('The Oct 31 satellite pass saw no water at this spot; dry pixels do not mean no flooding.')
  })
  it('D24: unavailable answers say so; never "none here" or NOTHING_COVERS then', () => {
    const c = checkPoint(input({ point: far, alerts: [], alertsStatus: 'unavailable', fim: RFC_FIM_UNAVAILABLE(), satellite: SATELLITE_UNAVAILABLE() }))
    const t = c.lines.map((l) => l.text)
    expect(t[0]).toMatch(/^NWS flood products could not be reached right now/)
    expect(t).toContain(RFC_FIM_UNAVAILABLE().reason ?? RFC_FIM_UNAVAILABLE_TEXT)
    expect(t).not.toContain(NOTHING_COVERS)
    expect(c.nothing).toBe(false)
  })
  it('FEMA (C19): in the floodplain with its zone; outside only where FEMA mapped', () => {
    const nfhl = nfhlFixture as unknown as FloodMapResponse
    const inside = nfhl.features.features[0]
    const ring = (inside.geometry as { coordinates: number[][][] | number[][][][] }).coordinates
    const first = (Array.isArray(ring[0][0][0]) ? (ring as number[][][][])[0][0] : (ring as number[][][])[0]) as number[][]
    const cx = first.reduce((a, p) => a + p[0], 0) / first.length
    const cy = first.reduce((a, p) => a + p[1], 0) / first.length
    const t = texts(input({ point: [cx, cy], nfhl }))
    expect(t.some((x) => /^In FEMA's 1% annual-chance floodplain, Zone .+ \(background\)\.$/.test(x) || x === NFHL_OUTSIDE)).toBe(true)
    expect(texts(input({ point: far, nfhl: { ...nfhl, availability: 'mapped' } }))).toContain(NFHL_OUTSIDE)
    expect(texts(input({ point: far, nfhl: { ...nfhl, availability: 'no_digital_map' } }))).toContain('FEMA has no digital flood map here.')
  })
  it('no line uses a banned word', () => {
    for (const i of [input(), input({ point: far, satClass: 0 }), input({ satClass: 253 }), input({ cursorMs: FIXTURE_NOW_MS + 30 * H })]) expect(floodWordingProblems(texts(i).join(' '))).toEqual([])
  })
})

// review WFP-R1: a request that failed (no answer) or is still running is never "not asked"
describe('checkPoint: failed and loading layer requests (review WFP-R1)', () => {
  const outside = (over: Partial<FloodPointInput>) => input({ point: far, satClass: 0, ...over })
  it('the forecast-area and satellite requests failed: their unavailable lines, never NOTHING_COVERS', () => {
    const c = checkPoint(outside({ fim: null, fimState: 'unavailable', satellite: null, satelliteState: 'unavailable' }))
    const t = c.lines.map((l) => l.text)
    expect(t).toContain(RFC_FIM_UNAVAILABLE_TEXT)
    expect(t).toContain(SAT_UNAVAILABLE)
    expect(t).not.toContain(NOTHING_COVERS)
    expect(c.nothing).toBe(false)
  })
  it('the same while they are loading: "checking" lines, never NOTHING_COVERS', () => {
    const c = checkPoint(outside({ fim: null, fimState: 'loading', satellite: null, satelliteState: 'loading' }))
    const t = c.lines.map((l) => l.text)
    expect(t).toContain(FLOOD_PUBLIC.fimCheckingPoint)
    expect(t).toContain(FLOOD_PUBLIC.satLoadingPoint)
    expect(c.nothing).toBe(false)
  })
  it('the satellite spot still being read (class unknown): no NOTHING_COVERS yet', () => {
    const quiet = { alerts: [], fim: { ...RFC_FIM(), features: { type: 'FeatureCollection' as const, features: [] } } }
    const c = checkPoint(input({ ...quiet, satClass: undefined }))
    expect(c.lines.find((l) => l.key === 'sat')?.text).toMatch(/checking this spot/)
    expect(c.nothing).toBe(false)
    // once read as clear, every answer answered and nothing covers the spot
    expect(checkPoint(input({ ...quiet, satClass: 'clear' })).nothing).toBe(true)
  })
  it('not asked (state none or absent): no line and NOTHING_COVERS can still be said when every asked answer answered', () => {
    const c = checkPoint(outside({ fim: null, satellite: null }))
    expect(c.nothing).toBe(true)
  })
  it('FEMA switched on but its request failed: NFHL_DOWN', () => {
    expect(texts(input({ nfhl: null, nfhlState: 'unavailable' }))).toContain(NFHL_DOWN)
  })
})

// review WFP-R8: snow or ice hides water as clouds do; NASA's ocean mask and a clear picture pixel are not "no water"
describe('checkPoint: snow, ocean and clear picture pixels (review WFP-R8)', () => {
  const sat = (satClass: FloodPointInput['satClass']) => checkPoint(input({ satClass })).lines.find((l) => l.key === 'sat')!
  it('252 snow or ice: no view of water, quiet', () => {
    expect(sat(252).text).toBe('Snow or ice covered this spot on the Oct 31 pass: no satellite view of water here.')
    expect(sat(252).tone).toBe('quiet')
  })
  it('254 ocean: masked by NASA, not checked here', () => {
    expect(sat(254).text).toBe("NASA's Oct 31 pass masks this spot as ocean; its water is not checked here.")
  })
  it("a clear picture pixel: no water seen or not checked, never a plain 'saw no water'", () => {
    expect(sat('clear').text).toBe('The Oct 31 satellite pass shows no water at this spot (or did not check it there); dry pixels do not mean no flooding.')
    for (const c of [252, 254, 'clear'] as const) expect(sat(c).text).not.toMatch(/saw no water/)
    for (const c of [252, 254, 'clear'] as const) expect(floodWordingProblems(sat(c).text)).toEqual([])
  })
})

describe('pngClassAt: the picture palette (backend satellite.py palette_rgba; review WFP-R8)', () => {
  const img = (rgba: [number, number, number, number]) => {
    const data = new Uint8ClampedArray(9 * 9 * 4)
    for (let i = 0; i < 81; i++) data.set(rgba, i * 4)
    return { width: 9, height: 9, data } as unknown as ImageData
  }
  it('water blue, partial water, the no-view grey, snow white, and clear (transparent) pixels', () => {
    expect(pngClassAt(img([0x2a, 0x8c, 0xe6, 140]), 0.5, 0.5)).toBe(1)
    expect(pngClassAt(img([0x7f, 0xd4, 0xff, 89]), 0.5, 0.5)).toBe(1)
    expect(pngClassAt(img([0x9a, 0x9a, 0x9a, 115]), 0.5, 0.5)).toBe('noview')
    expect(pngClassAt(img([255, 255, 255, 77]), 0.5, 0.5)).toBe(252)
    expect(pngClassAt(img([0, 0, 0, 0]), 0.5, 0.5)).toBe('clear')
  })
})

// ------------------------------------------------------------------------------------------------ the rendered card
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, vi } from 'vitest'
import { DETAIL } from '../api/__fixtures__/floods/edgeCases'
import { useFloodOfficial } from '../official/floodHooks'
import { NO_ANSWER } from '../official/floodModel'
import { useFlood } from '../state/flood'
import { restoreSsrState, ssrState } from '../ui/ssr.testutil'
import { FloodViewBlock } from './FloodPointCard'

describe('FloodPointCard: the flood-view block (reviews WFP-R1, WFP-R11)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_NOW_MS, toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    restoreSsrState()
  })
  const render = (lon: number, lat: number, over: Record<string, unknown> = {}) => {
    const s = { ...DETAIL().summary, synthetic: false }
    ssrState(useFlood, { floodId: s.id, summary: s } as never)
    ssrState(useFloodOfficial, { floodId: s.id, alerts: { data: ALERTS(), loading: false, error: null }, gauges: NO_ANSWER, fim: { data: RFC_FIM(), loading: false, error: null }, satellite: { data: SATELLITE(), loading: false, error: null }, nfhl: NO_ANSWER, local: NO_ANSWER, ...over } as never)
    return renderToStaticMarkup(createElement(FloodViewBlock, { sel: { lat, lon, source: 'map' } as never }))
  }
  it("NWS's event name in a line is marked verbatim", () => {
    const html = render(gauge[0], gauge[1])
    expect(html).toContain('Inside the NWS <span data-verbatim="">Flood Warning</span> area')
  })
  it('the satellite and forecast-area requests failed: their unavailable lines, never NOTHING_COVERS', () => {
    const failed = { data: null, loading: false, error: 'API 503' }
    const html = render(-108.3, 36.66, { fim: failed, satellite: failed })
    expect(html).toContain(SAT_UNAVAILABLE)
    expect(html).toContain(RFC_FIM_UNAVAILABLE_TEXT)
    expect(html).not.toContain(NOTHING_COVERS)
  })
  it('not asked yet (a flood just opened): "checking", never NOTHING_COVERS', () => {
    const html = render(-108.3, 36.66, { fim: NO_ANSWER, satellite: NO_ANSWER })
    expect(html).toContain(FLOOD_PUBLIC.satLoadingPoint)
    expect(html).not.toContain(NOTHING_COVERS)
  })
})
