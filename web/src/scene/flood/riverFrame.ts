// The river view of the 3D flood view (brief 6, decision 3 "closer framing"; web-forensic-flood-3d): when a flood opens,
// a lower, closer camera along the main river instead of the whole flood seen from far above. Pure; tested in
// riverFrame.test.ts.
//   mainRiverReach  NOAA's river lines of the bundle (maps/flowlines.geojson, NWM, with strm_order and name): the lines
//                   named like the flood's river (summary.rivers, the primary gauge's waterbody; "St." = "Saint"), else
//                   the highest stream order; around the primary gauge (else the flood's point) a reach of a few km,
//                   its centre and its main direction (principal axis of its points)
//   riverViewHeading  the compass heading of a view that looks along the reach at an angle (so both banks show), the
//                   one of four nearest the usual view from the south-south-east
//   riverPose       the camera pose (target on the river, a low polar angle, a distance that fits the reach)
// Local coordinates (SPEC 4.1): x east+, z south+ (north is -z).
import type { FeatureCollectionJson, FloodSummary, ManifestGrid } from '../../api/types'
import { normalizeDeg } from '../../lib/compass'
import { lonLatToLocal } from '../../lib/reproject'

export interface RiverReach {
  /** Centre of the reach (local metres). */
  cx: number
  cz: number
  /** Unit direction of the reach (local x, z). */
  dirX: number
  dirZ: number
  /** Half its length along the direction (metres). */
  halfLen: number
  /** The river's name when the lines carry it ("Calcasieu River"), else null. */
  name: string | null
  /** Points of the reach used (≥ 2). */
  points: number
}

type Grid = Pick<ManifestGrid, 'center_e' | 'center_n' | 'utm_zone' | 'extent_m'>

/** "st johns" for "St. Johns River", "Saint Johns River" and "ST JOHNS RIVER". */
export function riverKey(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\bsaint\b/g, 'st')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

interface Line {
  pts: number[] // x0, z0, x1, z1, ...
  order: number
  name: string
}

function linesOf(fc: FeatureCollectionJson | null | undefined, grid: Grid): Line[] {
  const out: Line[] = []
  for (const f of fc?.features ?? []) {
    const g = f.geometry
    if (!g) continue
    const parts: unknown[] = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' && Array.isArray(g.coordinates) ? (g.coordinates as unknown[]) : []
    const props = (f.properties ?? {}) as Record<string, unknown>
    const order = Number(props.strm_order)
    const name = typeof props.name === 'string' ? props.name : ''
    for (const part of parts) {
      if (!Array.isArray(part) || part.length < 2) continue
      const pts: number[] = []
      for (const p of part as unknown[]) {
        if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
        const [x, z] = lonLatToLocal(p[0] as number, p[1] as number, grid)
        pts.push(x, z)
      }
      if (pts.length >= 4) out.push({ pts, order: Number.isFinite(order) ? order : 0, name })
    }
  }
  return out
}

/** Points along the lines at most `step` metres apart, inside the area. */
function densify(lines: Line[], step: number, half: number): number[] {
  const out: number[] = []
  for (const l of lines) {
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const ax = l.pts[i]
      const az = l.pts[i + 1]
      const bx = l.pts[i + 2]
      const bz = l.pts[i + 3]
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step))
      for (let k = 0; k < n; k++) {
        const t = k / n
        const x = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        if (Math.abs(x) <= half && Math.abs(z) <= half) out.push(x, z)
      }
    }
    const lx = l.pts[l.pts.length - 2]
    const lz = l.pts[l.pts.length - 1]
    if (Math.abs(lx) <= half && Math.abs(lz) <= half) out.push(lx, lz)
  }
  return out
}

/** Half-length of the reach the river view frames: about an eighth of the area, 2.5 to 6 km (closer on the large
 *  areas of flat floodplains, where a whole-area view hides the height boost). */
export function reachHalfLength(extent: number): number {
  return Math.min(6000, Math.max(2500, extent * 0.12))
}

/** The main river's reach around the flood's gauge (or point): null without river lines in the area. */
export function mainRiverReach(i: {
  flowlines: FeatureCollectionJson | null | undefined
  summary: Pick<FloodSummary, 'rivers' | 'primary_gauge' | 'lat' | 'lon'>
  grid: Grid
}): RiverReach | null {
  const { grid, summary } = i
  const half = grid.extent_m / 2
  const lines = linesOf(i.flowlines, grid)
  if (!lines.length) return null
  const wanted = new Set([...(summary.rivers ?? []), summary.primary_gauge?.waterbody ?? ''].map(riverKey).filter(Boolean))
  const named = lines.filter((l) => wanted.has(riverKey(l.name)))
  const top = Math.max(...lines.map((l) => l.order))
  const main = named.length ? named : lines.filter((l) => l.order === top)
  const step = Math.max(30, grid.extent_m / 1024)
  const pts = densify(main, step, half)
  if (pts.length < 4) return null
  // the anchor: the primary gauge (else the flood's point), moved onto the nearest point of the main river
  const g = summary.primary_gauge
  let [ax, az] = g && Number.isFinite(g.lat) && Number.isFinite(g.lon) ? lonLatToLocal(g.lon, g.lat, grid) : lonLatToLocal(summary.lon, summary.lat, grid)
  if (!Number.isFinite(ax) || !Number.isFinite(az)) [ax, az] = [0, 0]
  ax = Math.max(-half, Math.min(half, ax))
  az = Math.max(-half, Math.min(half, az))
  let best = Infinity
  let nx = pts[0]
  let nz = pts[1]
  for (let k = 0; k < pts.length; k += 2) {
    const d = (pts[k] - ax) ** 2 + (pts[k + 1] - az) ** 2
    if (d < best) {
      best = d
      nx = pts[k]
      nz = pts[k + 1]
    }
  }
  const R = reachHalfLength(grid.extent_m)
  // the reach: main-river points within R of the anchor point on the river
  let n = 0
  let sx = 0
  let sz = 0
  const near: number[] = []
  for (let k = 0; k < pts.length; k += 2) {
    if ((pts[k] - nx) ** 2 + (pts[k + 1] - nz) ** 2 > R * R) continue
    near.push(pts[k], pts[k + 1])
    sx += pts[k]
    sz += pts[k + 1]
    n++
  }
  if (n < 2) return null
  const mx = sx / n
  const mz = sz / n
  let cxx = 0
  let cxz = 0
  let czz = 0
  for (let k = 0; k < near.length; k += 2) {
    const dx = near[k] - mx
    const dz = near[k + 1] - mz
    cxx += dx * dx
    cxz += dx * dz
    czz += dz * dz
  }
  // principal axis of the 2 × 2 covariance
  const theta = 0.5 * Math.atan2(2 * cxz, cxx - czz)
  let dirX = Math.cos(theta)
  let dirZ = Math.sin(theta)
  if (!Number.isFinite(dirX) || !Number.isFinite(dirZ) || (cxx === 0 && czz === 0)) [dirX, dirZ] = [1, 0]
  let lo = Infinity
  let hi = -Infinity
  for (let k = 0; k < near.length; k += 2) {
    const t = (near[k] - mx) * dirX + (near[k + 1] - mz) * dirZ
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  const mid = (lo + hi) / 2
  const halfLen = Math.max(1500, (hi - lo) / 2)
  // the reach's centre on its axis, kept inside the area
  const cx = Math.max(-half, Math.min(half, mx + dirX * mid))
  const cz = Math.max(-half, Math.min(half, mz + dirZ * mid))
  const name = named.length ? (named[0].name || null) : main.find((l) => l.name && !/^unnamed/i.test(l.name))?.name ?? null
  return { cx, cz, dirX, dirZ, halfLen, name, points: n }
}

/** Compass heading (degrees clockwise from north) of a local direction (x east, z south). */
export function headingOfDir(dx: number, dz: number): number {
  return normalizeDeg((Math.atan2(dx, -dz) * 180) / Math.PI)
}

/** The river view's heading: along the reach at `offsetDeg` (both banks in view), the one of the four nearest the
 *  usual view (from the south-south-east, looking north-north-west: heading 337.5°). */
export function riverViewHeading(r: Pick<RiverReach, 'dirX' | 'dirZ'>, preferDeg = 337.5, offsetDeg = 32): number {
  const axis = headingOfDir(r.dirX, r.dirZ)
  const cands = [axis + offsetDeg, axis - offsetDeg, axis + 180 + offsetDeg, axis + 180 - offsetDeg].map(normalizeDeg)
  const delta = (a: number) => Math.abs(((a - preferDeg + 540) % 360) - 180)
  return cands.reduce((b, c) => (delta(c) < delta(b) ? c : b))
}

/** The river view's polar angle from straight down (the fire view frames at 61°; lower here, more like standing on a
 *  levee: 21° above the horizon). */
export const RIVER_POLAR_DEG = 69

/** Orbit distance that fits the reach on screen at the river view's angle (CameraRig fov 35°). */
export function riverDistance(r: Pick<RiverReach, 'halfLen'>, i: { width: number; height: number; insets: { top: number; right: number; bottom: number; left: number }; fovDeg: number; extent: number }): number {
  const freeW = Math.max(200, i.width - i.insets.left - i.insets.right)
  const freeH = Math.max(150, i.height - i.insets.top - i.insets.bottom)
  const tanV = Math.tan(((i.fovDeg * Math.PI) / 180) / 2) * (freeH / Math.max(1, i.height))
  const tanH = tanV * (freeW / freeH)
  // the reach seen at ~32° from its axis: its across-screen span is about its length × sin(32°) plus the floodplain on
  // both sides; the near and far ends spread in depth
  const across = r.halfLen * 0.62 + 500
  const dist = across / tanH
  return Math.min(i.extent * 1.2, Math.max(1800, dist))
}
