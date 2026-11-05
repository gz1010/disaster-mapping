import { describe, expect, it } from 'vitest'
import type { FloodTerrain3d, FloodTerrainProduct } from '../../api/types'
import { floodWordingProblems } from '../../ui/shell/floodCopy'
import { depthShown } from './depthChoice'
import { FLOOD_3D } from './flood3dCopy'
import { cellIndex, cellMetres, fmtMetres } from './terrain3d'

function product(key: string, over: Partial<FloodTerrainProduct> = {}): FloodTerrainProduct {
  return {
    key,
    kind: key === 'hand' ? 'hand' : 'depth',
    layer: key,
    status: 'ok',
    reason: null,
    label: "Estimated depth (from the terrain at the water's edge), experimental",
    caveat: 'caveat',
    method: 'method',
    citation: 'citation',
    source_layer: key === 'depth_forecast' ? 'water_forecast' : 'water_satellite',
    source: 'source',
    time_ms: 1,
    stats: null,
    ...over,
  }
}

function t3(over: { sat?: Partial<FloodTerrainProduct>; fc?: Partial<FloodTerrainProduct> } = {}): FloodTerrain3d {
  return { version: 1, relief: null, hand: product('hand'), depth: [product('depth_satellite', over.sat), product('depth_forecast', over.fc)], scale_m: 0.1, top_code: 254, nodata: 255, built_ms: 1 }
}

const both = { depthSatellite: true, depthForecast: true }

describe('which depth surface is shown', () => {
  it('an older bundle has none and says why', () => {
    const d = depthShown({ terrain3d: null, has: both, choice: null })
    expect(d.from).toBeNull()
    expect(d.note).toBe(FLOOD_3D.depthNoTerrain3d)
  })

  it('automatic: the satellite water, else the NWS forecast area', () => {
    expect(depthShown({ terrain3d: t3(), has: both, choice: null })).toMatchObject({ from: 'satellite', layer: 'depth_satellite', note: null })
    expect(depthShown({ terrain3d: t3({ sat: { status: 'unavailable', layer: null, reason: 'No depth estimate: this layer maps no water in this area. That is not an all-clear.' } }), has: both, choice: null })).toMatchObject({ from: 'forecast', layer: 'depth_forecast' })
    expect(depthShown({ terrain3d: t3(), has: { depthSatellite: false, depthForecast: true }, choice: null }).from).toBe('forecast')
  })

  it("the user's choice is kept; a missing estimate says the backend's reason, never an empty surface", () => {
    expect(depthShown({ terrain3d: t3(), has: both, choice: 'forecast' })).toMatchObject({ from: 'forecast', layer: 'depth_forecast' })
    const none = depthShown({ terrain3d: t3({ fc: { status: 'not_covered', layer: null, reason: 'No depth estimate: this water layer is not in the 3D data.' } }), has: both, choice: 'forecast' })
    expect(none.from).toBeNull()
    expect(none.layer).toBeNull()
    expect(none.note).toBe('No depth estimate: this water layer is not in the 3D data.')
  })

  it('a playback pass shows its own estimate, or says there is none (it never swaps to the forecast)', () => {
    const layers = { depth_pass_A: {}, depth_satellite: {} }
    const own = depthShown({ terrain3d: t3(), has: both, choice: null, layers, pass: { key: 'A', depthLayer: 'depth_pass_A', isShown: false, acquiredMs: 5 } })
    expect(own).toMatchObject({ from: 'satellite', layer: 'depth_pass_A', passKey: 'A' })
    const missing = depthShown({ terrain3d: t3(), has: both, choice: null, layers, pass: { key: 'B', depthLayer: null, isShown: false, acquiredMs: 5 } })
    expect(missing).toMatchObject({ from: null, layer: null, note: FLOOD_3D.depthNoPass, passKey: 'B' })
    const notInBundle = depthShown({ terrain3d: t3(), has: both, choice: null, layers, pass: { key: 'C', depthLayer: 'depth_pass_C', isShown: false, acquiredMs: 5 } })
    expect(notInBundle.from).toBeNull()
    // a known pass with nothing of it drawn (no raster, no picture): it says so, never "drawn flat"
    const notDrawn = depthShown({ terrain3d: t3(), has: both, choice: null, layers, pass: { key: 'D', depthLayer: null, isShown: false, acquiredMs: 5, drawn: false } })
    expect(notDrawn).toMatchObject({ from: null, layer: null, note: FLOOD_3D.depthPassNotDrawn })
    // the bundle's own shown pass uses depth_satellite
    expect(depthShown({ terrain3d: t3(), has: both, choice: null, layers, pass: { key: 'S', depthLayer: 'depth_pass_S', isShown: true, acquiredMs: 5 } }).layer).toBe('depth_satellite')
    // the forecast stays available on request
    expect(depthShown({ terrain3d: t3(), has: both, choice: 'forecast', layers, pass: { key: 'B', depthLayer: null, isShown: false, acquiredMs: 5 } }).from).toBe('forecast')
  })

  it('before the first pass: nothing is drawn, never the forecast surface (review WFF3D-R2)', () => {
    const before = { key: '', depthLayer: null, isShown: false, acquiredMs: Number.NaN, before: true }
    const d = depthShown({ terrain3d: t3(), has: both, choice: null, pass: before, atMs: 100 })
    expect(d).toMatchObject({ from: null, layer: null, note: FLOOD_3D.depthNoImageYet })
    // the user's satellite choice says the same
    expect(depthShown({ terrain3d: t3(), has: both, choice: 'satellite', pass: before, atMs: 100 }).layer).toBeNull()
  })

  it('the NWS forecast area is never shown for a handle before its own issue time', () => {
    const fcAt = t3({ fc: { time_ms: 1_000 } })
    // the user's forecast choice, the handle before the forecast was issued: no surface, and why
    expect(depthShown({ terrain3d: fcAt, has: both, choice: 'forecast', atMs: 500 })).toMatchObject({ from: null, layer: null, note: FLOOD_3D.depthForecastLater })
    // after its issue time (or at now) it is shown
    expect(depthShown({ terrain3d: fcAt, has: both, choice: 'forecast', atMs: 1_500 }).from).toBe('forecast')
    expect(depthShown({ terrain3d: fcAt, has: both, choice: 'forecast', atMs: null }).from).toBe('forecast')
    // automatic, the 3D data's own pass on screen without a satellite estimate: the forecast only once it was issued
    const noSat = t3({ sat: { status: 'unavailable', layer: null, reason: 'none' }, fc: { time_ms: 1_000 } })
    const shown = { key: 'S', depthLayer: null, isShown: true, acquiredMs: 400 }
    expect(depthShown({ terrain3d: noSat, has: both, choice: null, pass: shown, atMs: 500 }).from).toBeNull()
    expect(depthShown({ terrain3d: noSat, has: both, choice: null, pass: shown, atMs: 1_500 }).from).toBe('forecast')
  })

  it('the notes are never an all-clear', () => {
    for (const s of [FLOOD_3D.depthNoPass, FLOOD_3D.depthPassNotDrawn, FLOOD_3D.depthNoImageYet, FLOOD_3D.depthNoForecast, FLOOD_3D.depthForecastLater, FLOOD_3D.depthNoTerrain3d])
      expect(floodWordingProblems(s)).toEqual([])
  })
})

describe('terrain3d raster cells', () => {
  it('reads metres, the 25.4 m top code and no value', () => {
    expect(cellMetres(12)).toEqual({ m: 1.2000000000000002, top: false })
    expect(cellMetres(254)?.top).toBe(true)
    expect(cellMetres(255)).toBeNull()
  })

  it('finds the cell under a local point (row 0 north)', () => {
    expect(cellIndex(-150, -150, 4, 4, 400)).toBe(0)
    expect(cellIndex(-150, -50, 4, 4, 400)).toBe(1 * 4 + 0)
    expect(cellIndex(199, 199, 4, 4, 400)).toBe(15)
    expect(cellIndex(201, 0, 4, 4, 400)).toBe(-1)
  })

  it('formats metres', () => {
    expect(fmtMetres(0.46)).toBe('0.5')
    expect(fmtMetres(12.4)).toBe('12')
  })
})
