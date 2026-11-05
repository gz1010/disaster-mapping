import { describe, expect, it } from 'vitest'
import type { FloodManifest, FloodRelief } from '../../api/types'
import { autoBoost, boostForRange, boostInUse, boostOptions, FLOOD_BOOSTS, fmtFactor, fmtSpan, heightPercentiles } from './heightBoost'

const grid = { extent_m: 12000 } as FloodManifest['grid']

function relief(over: Partial<FloodRelief> = {}): FloodRelief {
  return { area: 'water', area_note: 'near the water', cells: 100, min_m: 0, max_m: 9, p05_m: 1, p95_m: 7.7, range_m: 6.7, width_m: 36772, exaggeration: 10, rule: 'rule', target_reached: false, ...over }
}

describe('height boost (RELIEF_RULE)', () => {
  it('takes the smallest step that makes the middle 90% span 2% of the width, ×1.5 when already steep', () => {
    // 2% of 12 km = 240 m
    expect(boostForRange(500, 12000)).toEqual({ factor: 1.5, reached: true })
    expect(boostForRange(160, 12000)).toEqual({ factor: 1.5, reached: true }) // 160 × 1.5 = 240
    expect(boostForRange(100, 12000)).toEqual({ factor: 3, reached: true })
    expect(boostForRange(50, 12000)).toEqual({ factor: 5, reached: true })
    expect(boostForRange(24, 12000)).toEqual({ factor: 10, reached: true })
    // a flat floodplain: capped at ×10 and the target is not reached
    expect(boostForRange(6.7, 36772)).toEqual({ factor: 10, reached: false })
    expect(boostForRange(0, 12000)).toEqual({ factor: 10, reached: false })
  })

  it('uses the bundle measure when terrain3d has one (its own target_reached)', () => {
    const a = autoBoost({ grid, terrain3d: { relief: relief() } as FloodManifest['terrain3d'] }, new Float32Array(0))
    expect(a).toMatchObject({ factor: 10, basis: 'bundle', rangeM: 6.7, widthM: 36772, reached: false })
    const b = autoBoost({ grid, terrain3d: { relief: relief({ exaggeration: 3, target_reached: undefined, range_m: 108, width_m: 12000 }) } as FloodManifest['terrain3d'] }, new Float32Array(0))
    expect(b).toMatchObject({ factor: 3, basis: 'bundle', reached: true })
  })

  it('falls back to the same rule on the whole grid for an older bundle (no terrain3d)', () => {
    // heights 0..100 m evenly: p05 ≈ 5, p95 ≈ 95 → 90 m over 12 km → ×3 (270 m ≥ 240 m)
    const h = Float32Array.from({ length: 10001 }, (_, i) => i / 100)
    const a = autoBoost({ grid, terrain3d: null }, h)
    expect(a.basis).toBe('grid')
    expect(a.rangeM).toBeCloseTo(90, 0)
    expect(a.factor).toBe(3)
    expect(a.reached).toBe(true)
    expect(a.relief).toBeNull()
    // no usable heights: the cap
    expect(autoBoost({ grid, terrain3d: undefined }, new Float32Array(4)).factor).toBe(10)
  })

  it('percentiles skip non-finite and absurd values', () => {
    const h = new Float32Array(200).fill(5)
    h[0] = Number.NaN
    h[1] = -1e6
    h[2] = 1e9
    expect(heightPercentiles(h)).toEqual({ p05: 5, p95: 5 })
    expect(heightPercentiles(new Float32Array(3))).toBeNull()
  })

  it('options: the fixed list plus the automatic and current values, sorted', () => {
    expect(boostOptions(10, 10)).toEqual([...FLOOD_BOOSTS])
    expect(boostOptions(10, 4)).toEqual([1, 1.5, 2, 3, 4, 5, 8, 10, 15, 20])
    expect(Math.max(...FLOOD_BOOSTS)).toBeGreaterThan(10) // past the rule's cap, for the flattest places
  })

  it('the user choice applies to its own flood only', () => {
    expect(boostInUse('a', 10, null)).toEqual({ factor: 10, user: false })
    expect(boostInUse('a', 10, { floodId: 'a', factor: 5 })).toEqual({ factor: 5, user: true })
    expect(boostInUse('a', 10, { floodId: 'b', factor: 5 })).toEqual({ factor: 10, user: false })
    expect(boostInUse('a', 10, { floodId: 'a', factor: 10 })).toEqual({ factor: 10, user: false })
  })

  it('formats factors and spans', () => {
    expect(fmtFactor(10)).toBe('10')
    expect(fmtFactor(1.5)).toBe('1.5')
    expect(fmtSpan(6.67)).toBe('6.7')
    expect(fmtSpan(108.56)).toBe('109')
  })
})
