// The satellite pass the 3D flood view drapes at the river-level chart's handle (brief 6, decision 2; M4 of
// web-forensic-flood-3d; contract6/backend-flood-time-3d.md "Which source Forensic uses"):
//   - the pass list from GET /timeline (state/floodTimelineData.ts, web-flood-playback), the pass at the handle from
//     state/floodTimeline.ts passAt (the latest usable pass at or before the handle; never a blend, never a no-view
//     pass); when the route's passes are unavailable, the bundle's frozen timeline.json passes stand in
//   - the pass rasters from the bundle's timeline.json, joined by key: `layer` (water_pass_<key>, DSWx classes on the
//     render grid) and `depth_layer` (its own FwDET depth)
//   - mode 'bundle': the pass the 3D data's water_satellite / depth_satellite belong to (its shown_key), or the handle
//     at now; 'raster': a kept pass's own classes (and depth when it has one); 'image': a pass with no bundle raster
//     (older than the kept ones, or newer than the build): the route's 2D picture is draped and no depth surface is
//     shown (said so); 'none': no satellite image at or before the handle (nothing drawn as water, said so)
// passDrapeAt is pure (floodPassDrape.test.ts); the hooks feed DepthSurface, the terrain's satellite drape
// (passDrapeGpu, read by scene/terrain/Terrain.tsx every frame), the scene key and the hover readout.
import { useMemo } from 'react'
import * as THREE from 'three'
import type { FloodPass, FloodPassImage, FloodTimelineResponse, ManifestGrid } from '../../api/types'
import { lonLatToLocal } from '../../lib/reproject'
import { useFlood } from '../../state/flood'
import { passAt, passesOf, type PassAt } from '../../state/floodTimeline'
import { timelineFor, useFloodTimeline } from '../../state/floodTimelineData'
import { useNow } from '../../ui/hooks'
import type { PassOnScreen } from './depthChoice'
import type { FloodSceneAssets } from './floodAssets'

export type PassDrapeMode = 'bundle' | 'raster' | 'image' | 'none'

export interface PassDrape {
  mode: PassDrapeMode
  /** The pass on screen (null for 'none'). */
  pass: FloodPass | null
  /** 'raster': the bundle layer of its water classes. */
  waterLayer: string | null
  /** Its own depth estimate in the bundle (null: none; 'bundle' uses depth_satellite). */
  depthLayer: string | null
  /** 'image': the route's 2D picture and its footprint. */
  image: FloodPassImage | null
  /** passAt's answer (gap, passes without a view in the gap). */
  at: PassAt
}

/** The pass the 3D view drapes at the handle; null at now (and after it): the 3D data's own satellite layer. */
export function passDrapeAt(i: {
  route: FloodTimelineResponse | null | undefined
  bundle: FloodTimelineResponse | null | undefined
  cursorMs: number | null
  nowMs: number
  /** manifest.layers (which rasters the bundle has). */
  layers: Record<string, unknown>
}): PassDrape | null {
  const { cursorMs, nowMs } = i
  if (cursorMs == null || !Number.isFinite(cursorMs) || cursorMs >= nowMs) return null
  const routeOk = i.route?.passes?.status === 'available' && (i.route.passes.passes?.length ?? 0) > 0
  const list = passesOf(routeOk ? i.route : i.bundle)
  if (!list.length) return null
  const at = passAt(list, cursorMs)
  const p = at.pass
  if (!p) return { mode: 'none', pass: null, waterLayer: null, depthLayer: null, image: null, at }
  const bundlePasses = i.bundle?.passes?.passes ?? []
  const bp = bundlePasses.find((x) => x.key === p.key) ?? null
  const shownKey = i.bundle?.passes?.shown_key ?? null
  const has = (k: string | null | undefined): k is string => !!k && k in i.layers
  if (p.key === shownKey && has('water_satellite')) return { mode: 'bundle', pass: p, waterLayer: null, depthLayer: null, image: p.image ?? null, at }
  if (has(bp?.layer)) return { mode: 'raster', pass: p, waterLayer: bp!.layer, depthLayer: has(bp?.depth_layer) ? bp!.depth_layer! : null, image: p.image ?? null, at }
  if (p.image) return { mode: 'image', pass: p, waterLayer: null, depthLayer: null, image: p.image, at }
  return { mode: 'none', pass: p, waterLayer: null, depthLayer: null, image: null, at }
}

/** depthChoice's view of the pass on screen (null: the 3D data's own satellite water). */
export function passOnScreenOf(d: PassDrape | null): PassOnScreen | null {
  if (!d) return null
  if (d.mode === 'none' || !d.pass) return { key: d.pass?.key ?? '', acquiredMs: d.pass?.acquired_ms ?? Number.NaN, depthLayer: null, noView: false, isShown: false, before: !d.pass }
  return { key: d.pass.key, acquiredMs: d.pass.acquired_ms, depthLayer: d.mode === 'raster' ? d.depthLayer : null, noView: false, isShown: d.mode === 'bundle' }
}

/** The pass the 3D view drapes at the chart's handle (null: at now, the 3D data's own satellite layer). */
export function usePassDrape(flood: Pick<FloodSceneAssets, 'manifest' | 'bundleTimeline'> | null): PassDrape | null {
  const floodId = useFlood((s) => s.floodId)
  const cursorMs = useFlood((s) => s.cursorMs)
  const route = useFloodTimeline((s) => timelineFor(s, floodId))
  const nowMs = useNow(60_000)
  const forThis = flood != null && floodId === flood.manifest.id
  return useMemo(
    () => (forThis && flood ? passDrapeAt({ route, bundle: flood.bundleTimeline, cursorMs, nowMs, layers: flood.manifest.layers }) : null),
    [forThis, flood, route, cursorMs, nowMs],
  )
}

/** local (x, z) → the picture's (u, v) (u east from its west edge, v north from its south edge) as two rows of an
 *  affine map [a, b, c]: u = a·x + b·z + c (from three of its corners in local metres; the area is small enough for a
 *  plane map). Null for a degenerate footprint. */
export function imageAffine(bounds: readonly number[], grid: Pick<ManifestGrid, 'center_e' | 'center_n' | 'utm_zone'>): { u: [number, number, number]; v: [number, number, number] } | null {
  if (bounds.length !== 4) return null
  const [w, s, e, n] = bounds
  const [x0, z0] = lonLatToLocal(w, s, grid)
  const [x1, z1] = lonLatToLocal(e, s, grid)
  const [x2, z2] = lonLatToLocal(w, n, grid)
  const ax = x1 - x0
  const az = z1 - z0
  const bx = x2 - x0
  const bz = z2 - z0
  const det = ax * bz - bx * az
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return null
  // [x - x0, z - z0] = u·(ax, az) + v·(bx, bz)
  const iu = [bz / det, -bx / det]
  const iv = [-az / det, ax / det]
  return {
    u: [iu[0], iu[1], -(iu[0] * x0 + iu[1] * z0)],
    v: [iv[0], iv[1], -(iv[0] * x0 + iv[1] * z0)],
  }
}

/** What the terrain's satellite drape shows this frame (written by FloodFx's PassDrapeDriver, read by Terrain.tsx;
 *  one flood scene at a time, like fxUniforms). mode 'bundle': the flood's own satWater texture. */
export const passDrapeGpu: {
  mode: PassDrapeMode
  sat: THREE.DataTexture | null
  img: THREE.Texture | null
  imgU: THREE.Vector3
  imgV: THREE.Vector3
} = { mode: 'bundle', sat: null, img: null, imgU: new THREE.Vector3(), imgV: new THREE.Vector3() }
