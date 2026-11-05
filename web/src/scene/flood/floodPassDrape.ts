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
// The words follow the pass drawn (review WFF3D-R3): satelliteOfDrape builds the key's, the Layers tab's and the hover's
// satellite answer from the same pass list the drape used (the route's answer for a route pass; the drape's own pass,
// with no picture and no image edge, when the bundle's frozen passes stand in).
import { useMemo } from 'react'
import * as THREE from 'three'
import type { FloodPass, FloodPassImage, FloodTimelineResponse, ManifestGrid, SatelliteWaterResponse } from '../../api/types'
import { fmtDayDate, type TimeFmt } from '../../lib/time'
import { lonLatToLocal } from '../../lib/reproject'
import { satelliteAtHandle } from '../../map/floodAreaLayers'
import { useFlood } from '../../state/flood'
import { isUsablePass, passAt, passesOf, STEP_EPS_MS, type PassAt } from '../../state/floodTimeline'
import { fillCopy } from '../../ui/shell/floodCopy'
import { PLAYBACK } from '../../ui/timeline/floodPlaybackCopy'
import { timelineFor, useFloodTimeline } from '../../state/floodTimelineData'
import { useNow } from '../../ui/hooks'
import type { PassOnScreen } from './depthChoice'
import { FLOOD_3D } from './flood3dCopy'
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
  /** Which pass list it came from: GET /timeline ('route'), or the bundle's frozen timeline.json while the route's
   *  passes are unavailable or not loaded ('bundle'). */
  source: 'route' | 'bundle'
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
  const source = routeOk ? 'route' : 'bundle'
  const list = passesOf(routeOk ? i.route : i.bundle)
  if (!list.length) return null
  const at = passAt(list, cursorMs)
  const p = at.pass
  if (!p) return { mode: 'none', pass: null, waterLayer: null, depthLayer: null, image: null, at, source }
  const bundlePasses = i.bundle?.passes?.passes ?? []
  const bp = bundlePasses.find((x) => x.key === p.key) ?? null
  const shownKey = i.bundle?.passes?.shown_key ?? null
  const has = (k: string | null | undefined): k is string => !!k && k in i.layers
  if (p.key === shownKey && has('water_satellite')) return { mode: 'bundle', pass: p, waterLayer: null, depthLayer: null, image: p.image ?? null, at, source }
  if (has(bp?.layer)) return { mode: 'raster', pass: p, waterLayer: bp!.layer, depthLayer: has(bp?.depth_layer) ? bp!.depth_layer! : null, image: p.image ?? null, at, source }
  if (p.image) return { mode: 'image', pass: p, waterLayer: null, depthLayer: null, image: p.image, at, source }
  return { mode: 'none', pass: p, waterLayer: null, depthLayer: null, image: null, at, source }
}

/** depthChoice's view of the pass on screen (null: the 3D data's own satellite water). Passes without a view are never
 *  on screen (passAt skips them; the gap words name them). */
export function passOnScreenOf(d: PassDrape | null): PassOnScreen | null {
  if (!d) return null
  if (!d.pass) return { key: '', acquiredMs: Number.NaN, depthLayer: null, isShown: false, before: true }
  if (d.mode === 'none') return { key: d.pass.key, acquiredMs: d.pass.acquired_ms, depthLayer: null, isShown: false, drawn: false }
  return { key: d.pass.key, acquiredMs: d.pass.acquired_ms, depthLayer: d.mode === 'raster' ? d.depthLayer : null, isShown: d.mode === 'bundle' }
}

/** The satellite answer of the pass the 3D view draws (review WFF3D-R3): what the scene key, the Layers tab's date, the
 *  hover's SATELLITE row and the image edge read, so their date is always the drawn pass's.
 *   - a route pass: the route's own answer for it (satelliteAtHandle: its image, footprint and credit)
 *   - a pass from the bundle's frozen list (route unavailable or not loaded): the drape's own pass (its time, platform,
 *     cloud share and caveat) with no picture and no image edge (its footprint is unknown here)
 *   - before the first pass, or a known pass with nothing to draw: not measured, and why (never an all-clear) */
export function satelliteOfDrape(i: {
  drape: PassDrape
  /** The 3D data's own satellite answer (satellite.json). */
  base: SatelliteWaterResponse | null | undefined
  route: FloodTimelineResponse | null | undefined
  bundle: FloodTimelineResponse | null | undefined
  cursorMs: number
  nowMs: number
  tf: TimeFmt
}): SatelliteWaterResponse | null {
  const { drape: d, base, nowMs } = i
  if (d.source === 'route') {
    const r = satelliteAtHandle(base, i.route, i.cursorMs, nowMs)
    if (d.mode !== 'none' || !d.pass || !r) return r
    // a route pass with neither a raster in the 3D data nor a picture: nothing of it is drawn here
    return { ...r, measured: false, granules: [], image: null, reason: fillCopy(FLOOD_3D.satPassNotDrawn, { date: fmtDayDate(d.pass.acquired_ms, i.tf.tz, { year: 'auto', refMs: nowMs }) }) }
  }
  const block = i.bundle?.passes ?? null
  const p = d.pass
  const credit = (block?.sources ?? []).find((s) => p != null && s.name.includes(p.product)) ?? block?.source ?? base?.source
  if (!credit) return null
  const common = {
    kind: 'satellite_water' as const,
    status: 'available' as const,
    reason_code: null,
    login: block?.login ?? base?.login ?? 'configured',
    login_note: block?.login_note ?? base?.login_note ?? null,
    tiles: null,
    source: credit,
    retrieved_ms: block?.retrieved_ms ?? null,
    now_ms: nowMs,
    flood_id: i.bundle?.flood_id ?? base?.flood_id ?? null,
    synthetic: i.bundle?.synthetic === true || base?.synthetic === true,
    image: null,
    stats: null,
  }
  if (!p) return { ...common, reason: PLAYBACK.noImageAtHandle, measured: false, granules: [], caveats: base?.caveats ?? [] }
  if (d.mode === 'none') {
    const date = fmtDayDate(p.acquired_ms, i.tf.tz, { year: 'auto', refMs: nowMs })
    return { ...common, reason: fillCopy(FLOOD_3D.satPassNotDrawn, { date }), measured: false, granules: [], caveats: p.caveat ? [p.caveat] : (base?.caveats ?? []) }
  }
  return {
    ...common,
    reason: null,
    measured: true,
    granules: [{ id: p.granules[0] ?? p.key, product: p.product, platform: p.platform, acquired_ms: p.acquired_ms, produced_ms: null, cloud_pct: p.cloud_pct, route: p.route, url: p.url }],
    caveats: uniq([...(p.caveat ? [p.caveat] : (base?.caveats ?? [])), FLOOD_3D.satPassBundle]),
  }
}

const uniq = (xs: string[]) => [...new Set(xs)]

/** At now: the newest usable pass in the time history when it is newer than the pass the 3D data shows (review
 *  WFF3D-R8; the satellite route picks its own pass, which can be older), else null. */
export function newerPassThanShown(passes: readonly FloodPass[], shownMs: number | null | undefined): FloodPass | null {
  if (shownMs == null || !Number.isFinite(shownMs)) return null
  let newest: FloodPass | null = null
  for (const p of passes) if (isUsablePass(p) && (!newest || p.acquired_ms > newest.acquired_ms)) newest = p
  return newest && newest.acquired_ms > shownMs + STEP_EPS_MS ? newest : null
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
