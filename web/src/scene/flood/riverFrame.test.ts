import { describe, expect, it } from 'vitest'
import type { FeatureCollectionJson, ManifestGrid } from '../../api/types'
import { localToLonLat } from '../../lib/reproject'
import { headingOfDir, mainRiverReach, reachHalfLength, riverDistance, riverKey, riverViewHeading } from './riverFrame'

// a 12 km area in UTM zone 13 (the fixture flood's)
const grid = { center_e: 700000, center_n: 4070000, utm_zone: 13, extent_m: 12000 } as ManifestGrid

/** A line through local points (x east, z south). */
function line(pts: [number, number][], props: Record<string, unknown>) {
  return { type: 'Feature' as const, properties: props, geometry: { type: 'LineString' as const, coordinates: pts.map(([x, z]) => localToLonLat(x, z, grid)) } }
}

const summary = (over: Record<string, unknown> = {}) => {
  const [lon, lat] = localToLonLat(0, 0, grid)
  return { rivers: ['Ridge Fork River'], primary_gauge: null, lat, lon, ...over } as Parameters<typeof mainRiverReach>[0]['summary']
}

describe('river view: the main river near the flood', () => {
  it('normalises river names (St. = Saint, punctuation)', () => {
    expect(riverKey('St. Johns River')).toBe(riverKey('Saint Johns River'))
    expect(riverKey('ST JOHNS RIVER')).toBe('st johns river')
    expect(riverKey(null)).toBe('')
  })

  it('follows the named river (not a bigger unnamed one) and finds its direction', () => {
    const fc: FeatureCollectionJson = {
      type: 'FeatureCollection',
      features: [
        // the named river runs west → east through the middle
        line([[-5000, 0], [0, 0], [5000, 0]], { name: 'Ridge Fork River', strm_order: 4 }),
        // a higher-order unnamed stream runs north → south far east
        line([[5500, -5000], [5500, 5000]], { name: 'Unnamed Stream', strm_order: 6 }),
      ],
    }
    const r = mainRiverReach({ flowlines: fc, summary: summary(), grid })!
    expect(r.name).toBe('Ridge Fork River')
    expect(Math.abs(r.dirX)).toBeCloseTo(1, 3)
    expect(Math.abs(r.dirZ)).toBeLessThan(1e-3)
    expect(Math.abs(r.cz)).toBeLessThan(50)
    // the reach is cut to about a fifth of the area around the gauge / point
    expect(r.halfLen).toBeLessThanOrEqual(reachHalfLength(grid.extent_m) + 50)
    expect(r.halfLen).toBeGreaterThan(1500)
  })

  it('without a name match, takes the highest stream order; without lines, null', () => {
    const fc: FeatureCollectionJson = {
      type: 'FeatureCollection',
      features: [line([[0, -5000], [0, 5000]], { name: 'Unnamed Stream', strm_order: 5 }), line([[-5000, 3000], [5000, 3000]], { name: 'Unnamed Stream', strm_order: 2 })],
    }
    const r = mainRiverReach({ flowlines: fc, summary: summary({ rivers: ['St. Johns River'] }), grid })!
    expect(Math.abs(r.dirZ)).toBeCloseTo(1, 3)
    expect(r.name).toBeNull()
    expect(mainRiverReach({ flowlines: null, summary: summary(), grid })).toBeNull()
    expect(mainRiverReach({ flowlines: { type: 'FeatureCollection', features: [] }, summary: summary(), grid })).toBeNull()
  })

  it('looks along the reach at an angle, nearest the usual south-south-east view', () => {
    // a river running east-west: the axis is 90° / 270°; candidates 58°, 122°, 238°, 302° → 302° is nearest 337.5°
    expect(headingOfDir(1, 0)).toBeCloseTo(90, 6)
    expect(headingOfDir(0, -1)).toBeCloseTo(0, 6)
    expect(riverViewHeading({ dirX: 1, dirZ: 0 })).toBeCloseTo(302, 6)
    // a river running north-south: candidates 32°, 328°, 148°, 212° → 328°
    expect(riverViewHeading({ dirX: 0, dirZ: 1 })).toBeCloseTo(328, 6)
  })

  it('the distance fits the reach and stays closer than the whole area', () => {
    const at = (halfLen: number) => riverDistance({ halfLen }, { width: 1440, height: 1000, insets: { top: 80, right: 360, bottom: 160, left: 300 }, fovDeg: 35, extent: 60000 })
    expect(at(9000)).toBeGreaterThan(at(3000))
    expect(at(9000)).toBeLessThan(60000)
    expect(at(10)).toBeGreaterThanOrEqual(1800)
  })
})
