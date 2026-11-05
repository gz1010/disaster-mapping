// lib/areaDistance.ts (brief 5, flood-only distance to lon/lat rings; CONTRACT §16.12).
import { describe, expect, it } from 'vitest'
import { distanceM } from './geodesy'
import { distanceToArea, distanceToAreas, type LonLat } from './areaDistance'

// a 0.1° square around (-108.05, 36.8) with a hole in its middle
const square: LonLat[] = [
  [-108.1, 36.75],
  [-108.0, 36.75],
  [-108.0, 36.85],
  [-108.1, 36.85],
  [-108.1, 36.75],
]
const hole: LonLat[] = [
  [-108.06, 36.79],
  [-108.04, 36.79],
  [-108.04, 36.81],
  [-108.06, 36.81],
  [-108.06, 36.79],
]

describe('distanceToArea', () => {
  it('outside: the geodesic distance to the nearest edge and the bearing towards it', () => {
    // 0.1° east of the square's east edge at its middle latitude
    const d = distanceToArea({ rings: [square], point: [-107.9, 36.8] })!
    const expected = distanceM({ lat: 36.8, lon: -107.9 }, { lat: 36.8, lon: -108.0 }) / 1000
    expect(d.inside).toBe(false)
    expect(d.km).toBeCloseTo(expected, 1)
    expect(d.bearingDeg).toBeGreaterThan(265)
    expect(d.bearingDeg).toBeLessThan(275)
  })
  it('north of the square: bearing south', () => {
    const d = distanceToArea({ rings: [square], point: [-108.05, 36.95] })!
    expect(d.km).toBeCloseTo(11.1, 0)
    expect(Math.abs(d.bearingDeg - 180)).toBeLessThan(1)
  })
  it('inside: 0 km; inside a hole is outside (even-odd)', () => {
    expect(distanceToArea({ rings: [square, hole], point: [-108.09, 36.76] })).toMatchObject({ km: 0, inside: true })
    const inHole = distanceToArea({ rings: [square, hole], point: [-108.05, 36.8] })!
    expect(inHole.inside).toBe(false)
    expect(inHole.km).toBeGreaterThan(0.8)
    expect(inHole.km).toBeLessThan(1.2)
  })
  it('no usable ring or a bad point: null', () => {
    expect(distanceToArea({ rings: [], point: [-108, 36] })).toBeNull()
    expect(distanceToArea({ rings: [[[-108, 36]]], point: [-108, 36] })).toBeNull()
    expect(distanceToArea({ rings: [square], point: [Number.NaN, 36] })).toBeNull()
  })
})

describe('distanceToAreas', () => {
  it('the nearest polygon; inside any wins', () => {
    const far: LonLat[] = square.map(([x, y]) => [x + 1, y])
    const d = distanceToAreas([[far], [square]], [-107.9, 36.8])!
    expect(d.km).toBeLessThan(10)
    expect(distanceToAreas([[far], [square]], [-108.05, 36.76])).toMatchObject({ inside: true, km: 0 })
    expect(distanceToAreas([], [-108, 36])).toBeNull()
  })
})
