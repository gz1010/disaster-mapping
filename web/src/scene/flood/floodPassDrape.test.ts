import { describe, expect, it } from 'vitest'
import { DETAIL, SATELLITE } from '../../api/__fixtures__/floods/edgeCases'
import type { FloodPass, FloodTimelineResponse, ManifestGrid } from '../../api/types'
import { fmtDayDate, timeFmt } from '../../lib/time'
import { lonLatToLocal } from '../../lib/reproject'
import { sceneKeyItems } from '../../ui/forensic-flood/floodForensicView'
import { FLOOD_FORENSIC_DEFAULTS } from '../../ui/forensic-flood/forensicFloodState'
import { floodWordingProblems } from '../../ui/shell/floodCopy'
import { PLAYBACK } from '../../ui/timeline/floodPlaybackCopy'
import { depthShown } from './depthChoice'
import { FLOOD_3D } from './flood3dCopy'
import type { FloodSceneAssets } from './floodAssets'
import { imageAffine, newerPassThanShown, passDrapeAt, passOnScreenOf, satelliteOfDrape } from './floodPassDrape'
import { floodProbeRows } from './floodProbe'

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
  const source = { name: 'NASA OPERA DSWx-HLS', url: 'https://www.earthdata.nasa.gov/', credit: 'NASA OPERA DSWx-HLS', terms_url: null }
  return {
    kind: 'flood_timeline',
    flood_id: 'f',
    now_ms: NOW,
    start_ms: NOW - 20 * DAY,
    end_ms: NOW,
    synthetic: false,
    passes: { status, passes, shown_key: shown, source, sources: [source], login: 'configured', login_note: null, retrieved_ms: NOW - 3_600_000 } as unknown as FloodTimelineResponse['passes'],
    products: {} as FloodTimelineResponse['products'],
  }
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

describe('the words follow the pass drawn (review WFF3D-R3)', () => {
  const TF = timeFmt('America/Chicago', '24h')
  const down = timeline([], null, 'unavailable')
  const day = (ms: number) => fmtDayDate(ms, TF.tz, { year: 'auto', refMs: NOW })
  const keyFlood = (sat: ReturnType<typeof satelliteOfDrape>): Parameters<typeof sceneKeyItems>[0]['flood'] => {
    const d = DETAIL()
    return { manifest: d.manifest!, has: { forecast: false, floodplain: false, model: false, catfim: false, satellite: true, noView: false, hand: false, depthSatellite: false, depthForecast: false }, satellite: sat, catfim: null, warnings: null, gauges: null }
  }

  it("with the route down, the drape's own pass labels the key, with no picture and no image edge", () => {
    const cursor = NOW - 1 * DAY // C is drawn from the bundle's frozen list
    const d = at(cursor, { route: down })!
    expect(d).toMatchObject({ source: 'bundle', mode: 'raster' })
    const sat = satelliteOfDrape({ drape: d, base: SATELLITE(), route: down, bundle: BUNDLE, cursorMs: cursor, nowMs: NOW, tf: TF })!
    expect(sat.granules[0].acquired_ms).toBe(d.pass!.acquired_ms)
    expect(sat.image).toBeNull()
    expect(sat.caveats).toContain(FLOOD_3D.satPassBundle)
    // the scene key's satellite line carries the drawn pass's date, and no image-edge line
    const items = sceneKeyItems({ flood: keyFlood(sat), layers: { ...FLOOD_FORENSIC_DEFAULTS }, tf: TF, nowMs: NOW, cursorMs: cursor, hasWarnings: false, hasGauges: false })
    const line = items.find((i) => i.key === 'satellite')!
    expect(line.text).toContain(day(d.pass!.acquired_ms))
    expect(line.text).toContain('(24 hours before the handle)')
    expect(items.some((i) => i.key === 'edge')).toBe(false)
    // with the route up, the route's own answer for the same pass (its picture and footprint)
    const up = at(cursor)!
    const routeSat = satelliteOfDrape({ drape: up, base: SATELLITE(), route: ROUTE, bundle: BUNDLE, cursorMs: cursor, nowMs: NOW, tf: TF })!
    expect(up.source).toBe('route')
    expect(routeSat.granules[0].acquired_ms).toBe(up.pass!.acquired_ms)
    expect(routeSat.image?.url).toContain('/passes/C.png')
  })

  it('a known pass with nothing to draw says so; before the first pass, no image yet', () => {
    const d = at(NOW - 8 * DAY, { route: down })! // A: no raster, no picture
    expect(d.mode).toBe('none')
    expect(passOnScreenOf(d)).toMatchObject({ key: 'A', drawn: false })
    const sat = satelliteOfDrape({ drape: d, base: SATELLITE(), route: down, bundle: BUNDLE, cursorMs: NOW - 8 * DAY, nowMs: NOW, tf: TF })!
    expect(sat.measured).toBe(false)
    expect(sat.reason).toContain('nothing of it is drawn here')
    expect(floodWordingProblems(sat.reason!)).toEqual([])
    // the depth line does not claim that water is drawn
    const depth = depthShown({ terrain3d: { version: 1, relief: null, hand: {} as never, depth: [], scale_m: 0.1, top_code: 254, nodata: 255, built_ms: 1 }, has: { depthSatellite: false, depthForecast: false }, choice: null, pass: passOnScreenOf(d) })
    expect(depth.note).toBe(FLOOD_3D.depthPassNotDrawn)
    const first = at(NOW - 12 * DAY, { route: down })!
    expect(satelliteOfDrape({ drape: first, base: SATELLITE(), route: down, bundle: BUNDLE, cursorMs: NOW - 12 * DAY, nowMs: NOW, tf: TF })?.reason).toBe(PLAYBACK.noImageAtHandle)
  })

  it("the hover reads a bundle pass's cells without a picture footprint", () => {
    const d = DETAIL()
    const fl = {
      manifest: d.manifest!,
      has: { forecast: false, floodplain: false, model: false, catfim: false, satellite: true, noView: false, hand: false, depthSatellite: false, depthForecast: false },
      arrays: { width: 2, height: 1, forecast: null, floodplain: null, model: null, catfim: null, satellite: null, hand: null, depthSatellite: null, depthForecast: null },
      warnings: null,
      satellite: SATELLITE(),
      catfim: null,
    } as unknown as FloodSceneAssets
    const cursor = NOW - 1 * DAY
    const sat = satelliteOfDrape({ drape: at(cursor, { route: down })!, base: SATELLITE(), route: down, bundle: BUNDLE, cursorMs: cursor, nowMs: NOW, tf: TF })
    const arr = new Uint8Array([1, 0])
    const rows = floodProbeRows({ flood: fl, layers: { ...FLOOD_FORENSIC_DEFAULTS }, extent: 200, point: { x: -50, z: 0, lon: 0, lat: 0 }, cursorMs: cursor, nowMs: NOW, tf: TF, satOnScreen: { sat, has: true, arr, imageOnly: false, gridOnly: true, note: null } })
    expect(rows.rows.find((r) => r.key === 'sat')?.tone).toBe('water')
  })
})

describe('at now, a newer pass than the 3D data shows (review WFF3D-R8)', () => {
  it('names the newest usable pass when it is newer than the shown one', () => {
    const passes = [pass('A', 9), pass('B', 5), pass('C', 2), pass('N', 1, { view: 'no_view', usable: false, image: null })]
    expect(newerPassThanShown(passes, NOW - 5 * DAY)?.key).toBe('C')
    expect(newerPassThanShown(passes, NOW - 2 * DAY)).toBeNull()
    expect(newerPassThanShown(passes, null)).toBeNull()
    expect(floodWordingProblems(FLOOD_3D.keySatNewer)).toEqual([])
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
