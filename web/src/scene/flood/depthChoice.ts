// Which estimated water depth the 3D flood view shows (brief 6, decision 3; web-forensic-flood-3d). The bundle has a
// depth estimate (FwDET) per mapped water: the satellite pass shown (depth_satellite), each kept playback pass
// (depth_pass_<key>, FloodPass.depth_layer) and the NWS forecast flooded area (depth_forecast). A depth surface is
// only ever drawn inside its own mapped water; when a pass has no estimate the view says so and shows no surface
// (never an empty one, never "the water is gone"). With the handle in the past, the automatic choice never swaps to
// another time's water: before the first pass nothing is drawn, and the NWS forecast area (a product of its own issue
// time) is never shown for a time before it was issued (review WFF3D-R2). Pure; tested in depthChoice.test.ts.
import type { FloodTerrain3d, FloodTerrainProduct } from '../../api/types'
import type { DepthFrom } from '../../ui/forensic-flood/forensicFloodState'
import { FLOOD_3D } from './flood3dCopy'
import { depthProduct } from './terrain3d'

/** The satellite pass on screen during playback (scene/flood/floodPassDrape.ts); null = the bundle's own shown pass. */
export interface PassOnScreen {
  key: string
  /** The pass's image time (ms). */
  acquiredMs: number
  /** The bundle raster of its depth estimate (manifest.layers key), null when the bundle has none for this pass. */
  depthLayer: string | null
  /** The pass is the one the bundle's water_satellite / depth_satellite belong to. */
  isShown: boolean
  /** No satellite image at or before the handle (nothing of the satellite is drawn). */
  before?: boolean
  /** False: the pass is known but nothing of it is drawn (no raster in the 3D data and no picture). */
  drawn?: boolean
}

export interface DepthShown {
  /** Which mapped water the surface is of; null: no surface. */
  from: DepthFrom | null
  /** The backend's product (label, caveat, method, citation, source with its own time); the satellite product also
   *  stands for a playback pass's own estimate (same method, same words). */
  product: FloodTerrainProduct | null
  /** The bundle raster to draw (manifest.layers key). */
  layer: string | null
  /** Why no surface is shown (null when one is). */
  note: string | null
  /** A playback pass's own estimate (not the bundle's shown pass). */
  passKey: string | null
  /** The water's own time when it is a playback pass (its acquisition time); else the product's time_ms applies. */
  timeMs?: number | null
}

const okProduct = (p: FloodTerrainProduct | null, has: boolean) => !!p && p.status === 'ok' && !!p.layer && has

/** The depth surface for the user's choice (null = automatic: the satellite water when it has an estimate, else the
 *  NWS forecast area) and the pass on screen. */
export function depthShown(i: {
  terrain3d: FloodTerrain3d | null | undefined
  has: { depthSatellite: boolean; depthForecast: boolean }
  choice: DepthFrom | null
  pass?: PassOnScreen | null
  /** Bundle layers present (manifest.layers keys). */
  layers?: Record<string, unknown>
  /** The river-level chart's handle when it is before now (null: now). */
  atMs?: number | null
}): DepthShown {
  const t3 = i.terrain3d
  if (!t3) return { from: null, product: null, layer: null, note: FLOOD_3D.depthNoTerrain3d, passKey: null }
  const sat = depthProduct(t3, 'depth_satellite')
  const fc = depthProduct(t3, 'depth_forecast')
  const satOk = okProduct(sat, i.has.depthSatellite)
  const fcOk = okProduct(fc, i.has.depthForecast)
  // the forecast area is a product of its own issue time: never shown for a handle before it
  const atMs = i.atMs != null && Number.isFinite(i.atMs) ? i.atMs : null
  const fcIssued = atMs == null || fc?.time_ms == null || fc.time_ms <= atMs
  const forecast = (): DepthShown => {
    if (!fcOk) return { from: null, product: fc, layer: null, note: fc?.reason ?? FLOOD_3D.depthNoForecast, passKey: null }
    if (!fcIssued) return { from: null, product: fc, layer: null, note: FLOOD_3D.depthForecastLater, passKey: null }
    return { from: 'forecast', product: fc, layer: fc!.layer, note: null, passKey: null }
  }
  const satellite = (): DepthShown => {
    const p = i.pass
    if (p && !p.isShown) {
      if (p.before) return { from: null, product: sat, layer: null, note: FLOOD_3D.depthNoImageYet, passKey: null }
      if (p.drawn === false) return { from: null, product: sat, layer: null, note: FLOOD_3D.depthPassNotDrawn, passKey: p.key }
      if (p.depthLayer && (!i.layers || p.depthLayer in i.layers)) return { from: 'satellite', product: sat, layer: p.depthLayer, note: null, passKey: p.key, timeMs: p.acquiredMs }
      return { from: null, product: sat, layer: null, note: FLOOD_3D.depthNoPass, passKey: p.key }
    }
    return satOk ? { from: 'satellite', product: sat, layer: sat!.layer, note: null, passKey: null } : { from: null, product: sat, layer: null, note: sat?.reason ?? FLOOD_3D.depthNoPass, passKey: null }
  }
  if (i.choice === 'forecast') return forecast()
  if (i.choice === 'satellite') return satellite()
  // automatic: the satellite water (the pass on screen) when it has an estimate, else the forecast area. A playback
  // pass of its own, or no image yet before the first pass, says why there is no surface: it never swaps to the
  // forecast (review WFF3D-R2); nor does a past handle before the forecast's issue time
  const s = satellite()
  if (s.from) return s
  if (i.pass && !i.pass.isShown) return s
  return fcOk && fcIssued ? forecast() : s
}
