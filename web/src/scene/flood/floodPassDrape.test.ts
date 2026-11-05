import { describe, expect, it } from 'vitest'
import type { FloodPass, FloodTimelineResponse, ManifestGrid } from '../../api/types'
import { lonLatToLocal } from '../../lib/reproject'
import { imageAffine, passDrapeAt, passOnScreenOf } from './floodPassDrape'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 5, 18)

function pass(key: string, daysAgo: number, over: Partial<FloodPass> = {}): FloodPass {
  return {
    key,
    product: 'DSWx-HLS',
    platform: 'L9',
    acquired_ms: NOW - daysAgo * DAY,
    route: 'earthdata_gis',
    granules: [key],
    url: null,
    view: 'clear',
    usable: true,
    clear_pct: 90,
    cloud_pct: 5,
    nodata_pct: 5,
    water_km2: 3,
    partial_km2: 1,
    image: { url: `/api/floods/f/passes/${key}.png?area=00000000`, bounds_lonlat: [-93.3, 30.1, -93.1, 30.3] },
    layer: null,
    caveat: null,
    depth_layer: null,
    ...over,
  }
}

function timeline(passes: FloodPass[], shown: string | null, status: 'available' | 'unavailable' = 'available'): FloodTimelineResponse {
  return { kind: 'flood_timeline', flood_id: 'f', now_ms: NOW, start_ms: NOW - 20 * DAY, end_ms: NOW, synthetic: false, passes: { status, passes, shown_key: shown } as FloodTimelineResponse['passes'], products: {} as FloodTimelineResponse['products'] }
}

// the route lists four passes (one with no view); the bundle keeps rasters for B (its shown pass) and C
const ROUTE = timeline([pass('A', 9), pass('N', 7, { view: 'no_view', usable: false, image: null }), pass('B', 5), pass('C', 2)], 'B')
const BUNDLE = timeline(
  [pass('A', 9, { image: null }), pass('B', 5, { image: null, layer: 'water_pass_B', depth_layer: 'depth_pass_B' }), pass('C', 2, { image: null, layer: 'water_pass_C', depth_layer: 'depth_pass_C' })],
  'B',
)
const LAYERS = { water_satellite: {}, depth_satellite: {}, water_pass_B: {}, depth_pass_B: {}, water_pass_C: {}, depth_pass_C: {} }
const at = (cursorMs: number | null, over: { route?: FloodTimelineResponse | null; layers?: Record<string, unknown> } = {}) =>
  passDrapeAt({ route: over.route === undefined ? ROUTE : over.route, bundle: BUNDLE, cursorMs, nowMs: NOW, layers: over.layers ?? LAYERS })

describe('the 3D satellite drape at the handle', () => {
  it('at now (or after it): the 3D data\'s own layer', () => {
    expect(at(null)).toBeNull()
    expect(at(NOW + DAY)).toBeNull()
  })

  it('before the first pass: nothing drawn (mode none, no pass)', () => {
    const d = at(NOW - 12 * DAY)!
    expect(d.mode).toBe('none')
    expect(d.pass).toBeNull()
    expect(passOnScreenOf(d)).toMatchObject({ before: true, depthLayer: null })
  })

  it('the bundle\'s shown pass uses the 3D data\'s own layer; a kept pass its own classes and depth', () => {
    expect(at(NOW - 5 * DAY)!.mode).toBe('bundle')
    expect(passOnScreenOf(at(NOW - 4 * DAY))).toMatchObject({ key: 'B', isShown: true })
    const c = at(NOW - 1 * DAY)!
    expect(c).toMatchObject({ mode: 'raster', waterLayer: 'water_pass_C', depthLayer: 'depth_pass_C' })
    expect(passOnScreenOf(c)).toMatchObject({ key: 'C', depthLayer: 'depth_pass_C', isShown: false })
  })

  it('a pass without a bundle raster drapes its picture and shows no depth surface', () => {
    const d = at(NOW - 8 * DAY)! // A: listed, no raster in the bundle
    expect(d.mode).toBe('image')
    expect(d.image?.url).toContain('/passes/A.png')
    expect(passOnScreenOf(d)?.depthLayer).toBeNull()
  })

  it('never draws a no-view pass: the handle on it shows the pass before, with the no-view pass in the gap', () => {
    const d = at(NOW - 7 * DAY)!
    expect(d.pass?.key).toBe('A')
    expect(d.at.noViewBetween.map((p) => p.key)).toEqual(['N'])
  })

  it("the bundle's passes stand in when the route's are unavailable (frozen, no pictures)", () => {
    const down = timeline([], null, 'unavailable')
    expect(at(NOW - 1 * DAY, { route: down })!.mode).toBe('raster')
    expect(at(NOW - 8 * DAY, { route: down })!.mode).toBe('none') // A has neither a raster nor a picture
  })

  it('a raster the manifest does not list is not used', () => {
    expect(at(NOW - 1 * DAY, { layers: { water_satellite: {} } })!.mode).toBe('image')
  })
})

describe('the picture drape map', () => {
  const grid = { center_e: 500000, center_n: 3340000, utm_zone: 15 } as ManifestGrid
  it('maps the picture\'s corners to (0,0) south-west and (1,1) north-east', () => {
    const b = [-93.3, 30.1, -93.1, 30.3]
    const a = imageAffine(b, grid)!
    const uv = (lon: number, lat: number) => {
      const [x, z] = lonLatToLocal(lon, lat, grid)
      return [a.u[0] * x + a.u[1] * z + a.u[2], a.v[0] * x + a.v[1] * z + a.v[2]]
    }
    const sw = uv(-93.3, 30.1)
    const ne = uv(-93.1, 30.3)
    expect(sw[0]).toBeCloseTo(0, 6)
    expect(sw[1]).toBeCloseTo(0, 6)
    expect(ne[0]).toBeCloseTo(1, 2)
    expect(ne[1]).toBeCloseTo(1, 2)
    expect(imageAffine([1, 2, 1, 2], grid)).toBeNull()
  })
})
