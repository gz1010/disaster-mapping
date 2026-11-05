// The satellite class-to-colour table of the 3D drape (D25, C2): clouds (253) and no data (255) are the grey "no view"
// hatch, never transparent and never drawn as the ground; the shader's lookup bytes say the same.
import { describe, expect, it } from 'vitest'
import { SAT_CLASSES, SAT_NO_VIEW, SAT_WATER, satDrapeOf, satLutData, satShares } from './satClasses'

const lut = satLutData()
const colour = (c: number) => Array.from(lut.subarray(c * 4, c * 4 + 4))
const flags = (c: number) => Array.from(lut.subarray((256 + c) * 4, (256 + c) * 4 + 4))

describe('satellite water classes in 3D', () => {
  it.each([253, 255])('class %i is the "no view" hatch: drawn, grey, never transparent, never land', (c) => {
    const d = satDrapeOf(c)
    expect(d.kind).toBe('noview')
    expect(d.hatch).toBe(true)
    expect(d.alpha).toBeGreaterThan(0.3)
    expect(d.color).toBe(SAT_NO_VIEW)
    expect(d.kind).not.toBe('land')
    // the shader's lookup: opaque enough, hatch flag on, drawn
    expect(colour(c)[3]).toBeGreaterThan(70)
    expect(colour(c).slice(0, 3)).toEqual([0x9a, 0x9a, 0x9a])
    expect(flags(c)[1]).toBe(255)
    expect(flags(c)[2]).toBe(255)
    expect(flags(c)[0]).toBe(0)
  })

  it('clouds and no data look the same', () => {
    expect(satDrapeOf(253).color).toBe(satDrapeOf(255).color)
    expect(colour(253)).toEqual(colour(255))
    expect(flags(253)).toEqual(flags(255))
  })

  it('water is the flood blue with an edge; partial water lighter; not-water and ocean draw nothing', () => {
    expect(satDrapeOf(1)).toMatchObject({ kind: 'water', color: SAT_WATER, water: true })
    expect(satDrapeOf(2)).toMatchObject({ kind: 'partial', water: true })
    expect(satDrapeOf(2).alpha).toBeLessThan(satDrapeOf(1).alpha)
    expect(satDrapeOf(0)).toMatchObject({ kind: 'land', alpha: 0 })
    expect(satDrapeOf(254)).toMatchObject({ kind: 'ocean', alpha: 0 })
    expect(flags(1)[0]).toBe(255)
    expect(flags(0)[2]).toBe(0)
  })

  it('snow or ice and any unknown value are "no view", never dry ground', () => {
    for (const c of [252, 3, 100, 251]) {
      expect(satDrapeOf(c).kind).toBe('noview')
      expect(flags(c)[1]).toBe(255)
    }
  })

  it('every class of the table and the lookup agree', () => {
    for (const [k, d] of Object.entries(SAT_CLASSES)) {
      const c = Number(k)
      expect(colour(c)[3]).toBe(Math.round(d.alpha * 255))
      expect(flags(c)[1] === 255).toBe(d.hatch)
    }
  })

  it('shares count water, partial water and no view', () => {
    const s = satShares(new Uint8Array([0, 1, 1, 2, 253, 255, 254, 0]))
    expect(s.water).toBeCloseTo(2 / 8)
    expect(s.partial).toBeCloseTo(1 / 8)
    expect(s.noView).toBeCloseTo(2 / 8)
  })
})
