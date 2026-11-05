// Pure helpers of the 3D flood scene (brief 5, PLAN-5 §4.7): NWS and NOAA geometry in the bundle's local metres, the
// polygons of a map layer rasterised on the render grid (the NWS category flood map has no raster in the bundle), the
// RGBA drape pack the terrain samples (r: NWS forecast flooded area, g: FEMA floodplain, b: National Water Model, a: NWS
// category flood map), the flood's framing box, label anchors, and the NWS products drawn at the hydrograph handle.
// Local coordinates (SPEC 4.1): x east+, z south+ (north is -z); raster row 0 is the north edge.
import type { FeatureCollectionJson, FloodAlert, FloodSummary, GeometryJson, ManifestGrid } from '../../api/types'
import { productsAt, productsDrawn } from '../../official/floodModel'
import { lonLatToLocal } from '../../lib/reproject'

/** One polygon: its rings (outer first) as flat [x0, z0, x1, z1, ...] local metres, the closing point not repeated. */
export type LocalPolygon = Float64Array[]

type Grid = Pick<ManifestGrid, 'center_e' | 'center_n' | 'utm_zone'>

function ringLocal(ring: unknown, grid: Grid): Float64Array | null {
  if (!Array.isArray(ring) || ring.length < 3) return null
  let n = ring.length
  const first = ring[0] as number[]
  const last = ring[n - 1] as number[]
  if (Array.isArray(first) && Array.isArray(last) && first[0] === last[0] && first[1] === last[1]) n--
  if (n < 3) return null
  const out = new Float64Array(n * 2)
  for (let i = 0; i < n; i++) {
    const p = ring[i] as number[]
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null
    const [x, z] = lonLatToLocal(p[0], p[1], grid)
    out[i * 2] = x
    out[i * 2 + 1] = z
  }
  return out
}

/** The polygons of a GeoJSON geometry in local metres (Polygon and MultiPolygon; other types give none). */
export function polygonsLocal(geom: GeometryJson | null | undefined, grid: Grid): LocalPolygon[] {
  if (!geom) return []
  const polys: unknown[] = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates) ? (geom.coordinates as unknown[]) : []
  const out: LocalPolygon[] = []
  for (const p of polys) {
    if (!Array.isArray(p)) continue
    const rings = p.map((r) => ringLocal(r, grid)).filter((r): r is Float64Array => r != null)
    if (rings.length) out.push(rings)
  }
  return out
}

/** Every polygon of a feature collection in local metres. */
export function featurePolygons(fc: FeatureCollectionJson | null | undefined, grid: Grid): LocalPolygon[] {
  const out: LocalPolygon[] = []
  for (const f of fc?.features ?? []) out.push(...polygonsLocal(f.geometry, grid))
  return out
}

/** Rasterise polygons (even-odd within each polygon, so holes stay empty; polygons OR together) on a width x height
 *  grid covering [-extent/2, extent/2]² (row 0 = north = -z). A cell is in when its centre is. */
export function rasterizePolygons(polys: LocalPolygon[], width: number, height: number, extent: number, value = 255): Uint8Array {
  const out = new Uint8Array(width * height)
  const half = extent / 2
  const rx = extent / width
  const rz = extent / height
  const xs: number[] = []
  for (const poly of polys) {
    let minZ = Infinity
    let maxZ = -Infinity
    for (const ring of poly)
      for (let i = 1; i < ring.length; i += 2) {
        if (ring[i] < minZ) minZ = ring[i]
        if (ring[i] > maxZ) maxZ = ring[i]
      }
    const r0 = Math.max(0, Math.ceil((minZ + half) / rz - 0.5))
    const r1 = Math.min(height - 1, Math.floor((maxZ + half) / rz - 0.5))
    for (let r = r0; r <= r1; r++) {
      const zc = -half + (r + 0.5) * rz
      xs.length = 0
      for (const ring of poly) {
        const n = ring.length / 2
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n
          const ax = ring[i * 2]
          const az = ring[i * 2 + 1]
          const bx = ring[j * 2]
          const bz = ring[j * 2 + 1]
          if (az <= zc === bz <= zc) continue // the edge does not cross this row's centre line
          xs.push(ax + ((zc - az) / (bz - az)) * (bx - ax))
        }
      }
      if (xs.length < 2) continue
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] + half) / rx - 0.5))
        const c1 = Math.min(width - 1, Math.floor((xs[k + 1] + half) / rx - 0.5))
        if (c1 >= c0) out.fill(value, r * width + c0, r * width + c1 + 1)
      }
    }
  }
  return out
}

/** FEMA floodplain codes of floodplain.bin (0 none, 1 0.2 % band, 2 1 % floodplain (SFHA), 3 floodway) in the pack's
 *  green channel: spaced so linear filtering keeps the 0.2 % band apart from the 1 % floodplain. */
export const FLOODPLAIN_PACK = [0, 96, 200, 255] as const

/** The terrain's drape pack, RGBA bytes with row 0 = north (as the bundle's rasters): r NWS forecast flooded area,
 *  g FEMA floodplain (FLOODPLAIN_PACK), b National Water Model flooded area, a NWS category flood map. A missing layer
 *  is 0 everywhere. */
export function packFloodLayers(n: number, l: { forecast?: Uint8Array | null; floodplain?: Uint8Array | null; model?: Uint8Array | null; catfim?: Uint8Array | null }): Uint8Array {
  const out = new Uint8Array(n * 4)
  const ok = (a: Uint8Array | null | undefined) => (a && a.length === n ? a : null)
  const f = ok(l.forecast)
  const p = ok(l.floodplain)
  const m = ok(l.model)
  const c = ok(l.catfim)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    out[o] = f && f[i] > 127 ? 255 : 0
    out[o + 1] = p ? (FLOODPLAIN_PACK[p[i]] ?? 0) : 0
    out[o + 2] = m && m[i] > 127 ? 255 : 0
    out[o + 3] = c && c[i] > 127 ? 255 : 0
  }
  return out
}

/** Does a mask have any cell set (> 127)? */
export function anySet(a: Uint8Array | null | undefined): boolean {
  if (!a) return false
  for (let i = 0; i < a.length; i++) if (a[i] > 127) return true
  return false
}

export interface FloodFrame {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  cx: number
  cz: number
}

/** The box the 3D view frames: the flood's own extent (its bbox_lonlat: NWS areas and member gauges) in local metres,
 *  kept inside the bundle's area; at least 2 km across around its point. */
export function floodFrameOf(summary: Pick<FloodSummary, 'bbox_lonlat' | 'lat' | 'lon'>, grid: Pick<ManifestGrid, 'center_e' | 'center_n' | 'utm_zone' | 'extent_m'>): FloodFrame {
  const half = grid.extent_m / 2
  const clamp = (v: number) => Math.max(-half, Math.min(half, v))
  const [w, s, e, n] = summary.bbox_lonlat
  const corners = [lonLatToLocal(w, s, grid), lonLatToLocal(e, s, grid), lonLatToLocal(e, n, grid), lonLatToLocal(w, n, grid)]
  let minX = clamp(Math.min(...corners.map((c) => c[0])))
  let maxX = clamp(Math.max(...corners.map((c) => c[0])))
  let minZ = clamp(Math.min(...corners.map((c) => c[1])))
  let maxZ = clamp(Math.max(...corners.map((c) => c[1])))
  const [px, pz] = lonLatToLocal(summary.lon, summary.lat, grid)
  if (!(maxX - minX > 1) || !(maxZ - minZ > 1) || ![minX, maxX, minZ, maxZ].every(Number.isFinite)) {
    minX = clamp(px - 1000)
    maxX = clamp(px + 1000)
    minZ = clamp(pz - 1000)
    maxZ = clamp(pz + 1000)
  }
  const grow = (lo: number, hi: number): [number, number] => {
    const need = 2000 - (hi - lo)
    return need > 0 ? [clamp(lo - need / 2), clamp(hi + need / 2)] : [lo, hi]
  }
  ;[minX, maxX] = grow(minX, maxX)
  ;[minZ, maxZ] = grow(minZ, maxZ)
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
}

/** A point to hang a label on a mask (row 0 = north): the set cell nearest to the set cells' centroid (so it lies on
 *  the area, even for a bent river), in local metres; null when nothing is set. */
export function maskAnchor(mask: Uint8Array | null | undefined, width: number, height: number, extent: number): [number, number] | null {
  if (!mask || mask.length !== width * height) return null
  let n = 0
  let sr = 0
  let sc = 0
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++)
      if (mask[r * width + c] > 127) {
        n++
        sr += r
        sc += c
      }
  if (!n) return null
  const mr = sr / n
  const mc = sc / n
  let best = -1
  let bestD = Infinity
  // a coarse search is enough for a label
  const step = Math.max(1, Math.floor(Math.min(width, height) / 256))
  for (let r = 0; r < height; r += step)
    for (let c = 0; c < width; c += step)
      if (mask[r * width + c] > 127) {
        const d = (r - mr) ** 2 + (c - mc) ** 2
        if (d < bestD) {
          bestD = d
          best = r * width + c
        }
      }
  if (best < 0) {
    // the mask's only cells fall between the coarse steps: take the first set cell
    for (let i = 0; i < mask.length; i++)
      if (mask[i] > 127) {
        best = i
        break
      }
  }
  const r = Math.floor(best / width)
  const c = best % width
  return [-extent / 2 + ((c + 0.5) * extent) / width, -extent / 2 + ((r + 0.5) * extent) / height]
}

type Versioned = Pick<FloodAlert, 'id' | 'vtec' | 'sent_ms' | 'onset_ms' | 'effective_ms' | 'ends_ms' | 'expires_ms' | 'phase'>

/** "KABQ.FL.W.0019.2026" for a product with VTEC, else its own id (CAP references are not kept in the bundle). */
export function productKey(a: Pick<FloodAlert, 'id' | 'vtec'>): string {
  const v = a.vtec
  return v ? `${v.office}.${v.phenomena}.${v.significance}.${String(v.etn).padStart(4, '0')}.${v.year}` : a.id
}

/** The NWS products the 3D view draws at the hydrograph handle (C1). warnings.json keeps every version of a product
 *  (NEW, EXT, CAN, ...): per product, the newest version sent at or before the handle's time (now when the handle is at
 *  now or after it), then productsDrawn: at now also the products still to start; before now the ones in effect then;
 *  after now the products in effect NOW with `future` (CURSOR_FUTURE_PRODUCTS). */
export function warningsAt<T extends Versioned>(alerts: readonly T[], cursorMs: number | null, nowMs: number): { alerts: T[]; future: boolean } {
  const past = cursorMs != null && Number.isFinite(cursorMs) && cursorMs < nowMs
  const t = past ? (cursorMs as number) : nowMs
  const newest = new Map<string, T>()
  for (const a of alerts) {
    const sent = a.sent_ms ?? Number.NEGATIVE_INFINITY
    if (sent > t) continue
    const k = productKey(a)
    const cur = newest.get(k)
    if (!cur || (cur.sent_ms ?? Number.NEGATIVE_INFINITY) <= sent) newest.set(k, a)
  }
  const latest = [...newest.values()]
  return cursorMs == null ? productsDrawn(latest, null, nowMs) : productsAt(latest, cursorMs, nowMs)
}

export interface CatfimChoice {
  key: string
  lid: string
  category: string
}

const CAT_ORDER = ['action', 'minor', 'moderate', 'major', 'record']

/** The NWS category flood map the bundle holds for the flood (D22): the primary gauge's NWS forecast category, else its
 *  observed category, else the highest category the bundle has. Keys are "catfim_<LID>_<category>". */
export function chooseCatfim(maps: Record<string, string> | null | undefined, primary: { lid: string; forecast_category?: string | null; observed_category?: string | null } | null): CatfimChoice | null {
  const all: CatfimChoice[] = []
  for (const key of Object.keys(maps ?? {})) {
    const m = /^catfim_([^_]+)_([a-z_]+)$/.exec(key)
    if (m) all.push({ key, lid: m[1], category: m[2] })
  }
  if (!all.length) return null
  if (primary) {
    for (const cat of [primary.forecast_category, primary.observed_category]) {
      const hit = cat ? all.find((c) => c.lid.toUpperCase() === primary.lid.toUpperCase() && c.category === cat) : undefined
      if (hit) return hit
    }
  }
  return [...all].sort((a, b) => CAT_ORDER.indexOf(b.category) - CAT_ORDER.indexOf(a.category))[0]
}

/** The parts of a closed ring (flat local x, z pairs) that lie inside the square [-half, half]² (Liang-Barsky per
 *  segment), as open polylines: an outline is drawn only where it really runs, never along the square's edge. */
export function clipRingToBox(ring: ArrayLike<number>, half: number): Float64Array[] {
  const n = Math.floor(ring.length / 2)
  const out: Float64Array[] = []
  let cur: number[] = []
  const flush = () => {
    if (cur.length >= 4) out.push(Float64Array.from(cur))
    cur = []
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const x0 = ring[i * 2]
    const z0 = ring[i * 2 + 1]
    const dx = ring[j * 2] - x0
    const dz = ring[j * 2 + 1] - z0
    let t0 = 0
    let t1 = 1
    let inside = true
    for (const [p, q] of [
      [-dx, x0 + half],
      [dx, half - x0],
      [-dz, z0 + half],
      [dz, half - z0],
    ] as const) {
      if (p === 0) {
        if (q < 0) inside = false
      } else {
        const r = q / p
        if (p < 0) t0 = Math.max(t0, r)
        else t1 = Math.min(t1, r)
      }
    }
    if (!inside || t0 > t1) {
      flush()
      continue
    }
    const ax = x0 + dx * t0
    const az = z0 + dz * t0
    const bx = x0 + dx * t1
    const bz = z0 + dz * t1
    const last = cur.length
    if (!(last >= 2 && Math.abs(cur[last - 2] - ax) < 1e-6 && Math.abs(cur[last - 1] - az) < 1e-6)) {
      flush()
      cur.push(ax, az)
    }
    cur.push(bx, bz)
    if (t1 < 1) flush()
  }
  flush()
  // a ring wholly inside: join its last piece to its first (one closed run, drawn as a polyline back to the start)
  if (out.length >= 2) {
    const a = out[out.length - 1]
    const b = out[0]
    if (Math.abs(a[a.length - 2] - b[0]) < 1e-6 && Math.abs(a[a.length - 1] - b[1]) < 1e-6) {
      const joined = new Float64Array(a.length + b.length - 2)
      joined.set(a)
      joined.set(b.subarray(2), a.length)
      out.splice(out.length - 1, 1)
      out[0] = joined
    }
  }
  return out
}
