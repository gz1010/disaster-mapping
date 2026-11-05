// The distance from a point to an area given as lon/lat rings (brief 5, PLAN-5 §4.4, CONTRACT §16.12; flood-only: the
// fire chip keeps fireView.ts distanceToFire, untouched, C22). Pure and tested (areaDistance.test.ts).
// The nearest point of the rings' edges is found in a local equirectangular plane centred on the point (metres;
// accurate to well under 1 % over the tens of kilometres a flood spans), then the distance and the bearing to it are
// geodesic (lib/geodesy.ts). Inside is the even-odd rule over all the rings (an outer ring with its holes).
import { bearingDeg, distanceM } from './geodesy'

export type LonLat = [number, number]

export interface AreaDistance {
  /** Kilometres to the nearest edge (0 inside). */
  km: number
  /** Bearing from the point to that edge point (degrees clockwise from true north; to the nearest edge when inside). */
  bearingDeg: number
  inside: boolean
}

const M_PER_DEG = 111_320

function pointInRings(x: number, y: number, rings: readonly (readonly LonLat[])[]): boolean {
  let inside = false
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]
      const [xj, yj] = r[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  return inside
}

/** One polygon (its outer ring and holes) or any set of rings. Null without a usable ring. */
export function distanceToArea(p: { rings: readonly (readonly LonLat[])[]; point: LonLat }): AreaDistance | null {
  const [lon, lat] = p.point
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180)
  const ky = M_PER_DEG
  let best: { d2: number; lon: number; lat: number } | null = null
  for (const ring of p.rings) {
    if (!ring || ring.length < 2) continue
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (!a || !b) continue
      const ax = (a[0] - lon) * kx
      const ay = (a[1] - lat) * ky
      const bx = (b[0] - lon) * kx
      const by = (b[1] - lat) * ky
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
      const x = ax + t * dx
      const y = ay + t * dy
      const d2 = x * x + y * y
      if (!best || d2 < best.d2) best = { d2, lon: lon + x / kx, lat: lat + y / ky }
    }
  }
  if (!best) return null
  const inside = pointInRings(lon, lat, p.rings)
  const me = { lat, lon }
  const edge = { lat: best.lat, lon: best.lon }
  return { km: inside ? 0 : distanceM(me, edge) / 1000, bearingDeg: bearingDeg(me, edge), inside }
}

/** The nearest of several polygons (each a list of rings): inside any of them wins. Null when there is none. */
export function distanceToAreas(polygons: readonly (readonly (readonly LonLat[])[])[], point: LonLat): AreaDistance | null {
  let best: AreaDistance | null = null
  for (const rings of polygons) {
    const d = distanceToArea({ rings, point })
    if (!d) continue
    if (!best || (d.inside && !best.inside) || (d.inside === best.inside && d.km < best.km)) best = d
  }
  return best
}
