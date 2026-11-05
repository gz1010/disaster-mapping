// Which estimated water depth the 3D flood view shows (brief 6, decision 3; web-forensic-flood-3d). The bundle has a
// depth estimate (FwDET) per mapped water: the satellite pass shown (depth_satellite), each kept playback pass
// (depth_pass_<key>, FloodPass.depth_layer) and the NWS forecast flooded area (depth_forecast). A depth surface is
// only ever drawn inside its own mapped water; when a pass has no estimate the view says so and shows no surface
// (never an empty one, never "the water is gone"). Pure; tested in depthChoice.test.ts.
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
  /** The pass had no view of the area (clouds or no data): nothing of it is drawn as water. */
  noView: boolean
  /** The pass is the one the bundle's water_satellite / depth_satellite belong to. */
  isShown: boolean
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
}): DepthShown {
  const t3 = i.terrain3d
  if (!t3) return { from: null, product: null, layer: null, note: FLOOD_3D.depthNoTerrain3d, passKey: null }
  const sat = depthProduct(t3, 'depth_satellite')
  const fc = depthProduct(t3, 'depth_forecast')
  const satOk = okProduct(sat, i.has.depthSatellite)
  const fcOk = okProduct(fc, i.has.depthForecast)
  const forecast = (): DepthShown =>
    fcOk ? { from: 'forecast', product: fc, layer: fc!.layer, note: null, passKey: null } : { from: null, product: fc, layer: null, note: fc?.reason ?? FLOOD_3D.depthNoPass, passKey: null }
  const satellite = (): DepthShown => {
    const p = i.pass
    if (p && !p.isShown) {
      if (p.noView) return { from: null, product: sat, layer: null, note: FLOOD_3D.depthNoView, passKey: p.key }
      if (p.depthLayer && (!i.layers || p.depthLayer in i.layers)) return { from: 'satellite', product: sat, layer: p.depthLayer, note: null, passKey: p.key, timeMs: p.acquiredMs }
      return { from: null, product: sat, layer: null, note: FLOOD_3D.depthNoPass, passKey: p.key }
    }
    return satOk ? { from: 'satellite', product: sat, layer: sat!.layer, note: null, passKey: null } : { from: null, product: sat, layer: null, note: sat?.reason ?? FLOOD_3D.depthNoPass, passKey: null }
  }
  if (i.choice === 'forecast') return forecast()
  if (i.choice === 'satellite') return satellite()
  // automatic: the satellite water (the pass on screen) when it has an estimate, else the forecast area; a playback
  // pass without an estimate says so (it never silently swaps to the forecast)
  const s = satellite()
  if (s.from || s.passKey) return s
  return fcOk ? forecast() : s
}
