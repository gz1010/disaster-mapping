// Gauge bars (PLAN-5 §4.7): 1 ft of stage = 12 m of bar, ticks at the NWS flood stages, a hollow cap at the forecast,
// labels with the category in words (never a raw value), the reading's own time in the gauge's zone.
import { describe, expect, it } from 'vitest'
import { GAUGES } from '../../api/__fixtures__/floods/edgeCases'
import { timeFmt } from '../../lib/time'
import { CATEGORY_COLORS } from '../../map/floodStyle'
import { BAR_M_PER_FT, barHeightM, categoryCaps, gaugeBarLabel, gaugeBars, stageCaps, stageFt } from './gaugeBarMath'

const GRID = { center_e: 762340, center_n: 4075610, utm_zone: 12, extent_m: 12000 }
const TF = timeFmt('America/Denver', '24h')

describe('gauge bar maths', () => {
  it('scales the stage: 1 ft = 12 m; metres converted; other units never guessed', () => {
    expect(BAR_M_PER_FT).toBe(12)
    expect(barHeightM(stageFt(17.5, 'ft'))).toBe(210)
    expect(stageFt(2, 'm')).toBeCloseTo(6.56, 2)
    expect(stageFt(2, 'kcfs')).toBeNull()
    expect(barHeightM(stageFt(-1, 'ft'))).toBe(0)
    expect(barHeightM(null)).toBeNull()
  })

  it('writes every category in words, never a raw value', () => {
    expect(categoryCaps('moderate')).toBe('MODERATE')
    expect(categoryCaps('no_flooding')).toBe('BELOW FLOOD STAGE')
    expect(categoryCaps('obs_not_current')).toBe('READING NOT CURRENT')
    expect(categoryCaps('action')).toBe('ACTION STAGE')
    expect(categoryCaps('something_new')).toBe('CATEGORY UNKNOWN')
    expect(stageCaps(17.62, 'ft', 'us')).toBe('17.6 FT')
    expect(stageCaps(17.62, 'ft', 'metric')).toBe('5.4 M')
  })

  it('builds bars for the fixture gauges inside the area: members first, ticks in the category colours', () => {
    const resp = GAUGES()
    const now = resp.now_ms
    const bars = gaugeBars(resp.gauges, GRID, { units: 'us', tf: TF, nowMs: now })
    expect(bars.length).toBeGreaterThanOrEqual(2)
    expect(bars[0].member).toBe(true)
    const z1 = bars.find((b) => b.lid === 'ZZRF1')!
    const g1 = resp.gauges.find((g) => g.lid === 'ZZRF1')!
    expect(z1.heightM).toBeCloseTo((g1.observed.value ?? 0) * 12, 5)
    expect(z1.ticks.map((t) => t.category)).toEqual(['action', 'minor', 'moderate', 'major'])
    expect(z1.ticks.find((t) => t.category === 'moderate')?.color).toBe(CATEGORY_COLORS.moderate)
    expect(z1.crestM).toBeCloseTo((g1.forecast?.max_value ?? 0) * 12, 5)
    expect(z1.color).toBe(CATEGORY_COLORS.moderate)
    expect(z1.topM).toBeGreaterThanOrEqual(z1.ticks[3].heightM)
    expect(z1.label).toMatch(/^ZZRF1 · \d+\.\d FT · MODERATE · \d\d:\d\d M[SD]T$/)
    // below flood stage: grey, never green; a nearby gauge below flood stage keeps its bar but no label
    const z3 = bars.find((b) => b.lid === 'ZZRF3')
    if (z3) {
      expect(z3.color).toBe(CATEGORY_COLORS.below)
      expect(z3.labelled).toBe(false)
    }
    expect(z1.labelled).toBe(true)
  })

  it("names the reading's day when it is not today's", () => {
    const g = GAUGES().gauges[0]
    const t = g.observed.valid_ms!
    expect(gaugeBarLabel(g, 'us', TF, t + 2 * 86_400_000)).toMatch(/· NOV \d+, \d\d:\d\d M[SD]T$/)
  })

  it('leaves out a gauge outside the bundle area', () => {
    const g = { ...GAUGES().gauges[0], lat: 40, lon: -100 }
    expect(gaugeBars([g], GRID, { units: 'us', tf: TF, nowMs: 0 })).toEqual([])
  })
})
