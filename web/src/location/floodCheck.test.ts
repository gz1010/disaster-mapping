// The flood view's point check (brief 5, PLAN-5 §4.4, D24, D25, C1, C2): each layer in its own words; products on both
// sides of now; no view and outside the image said so; absence only from an available answer.
import { describe, expect, it } from 'vitest'
import { ALERTS, FIXTURE_NOW_MS, RFC_FIM, RFC_FIM_UNAVAILABLE, SATELLITE, SATELLITE_UNAVAILABLE } from '../api/__fixtures__/floods/edgeCases'
import nfhlFixture from '../api/__fixtures__/floods/maps-nfhl.json'
import type { FloodMapResponse } from '../api/types'
import { timeFmt } from '../lib/time'
import { CURSOR_FUTURE_PRODUCTS, floodWordingProblems, NFHL_OUTSIDE, NOTHING_COVERS, RFC_FIM_UNAVAILABLE as RFC_FIM_UNAVAILABLE_TEXT, SAT_CLOUD_POINT, SAT_NODATA_POINT, SAT_OUTSIDE_POINT } from '../ui/shell/floodCopy'
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
