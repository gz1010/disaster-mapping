// One reading per gauge (PLAN-5 §4.5; review WFP-R2's rule): the chart's own answer (status reading or its newest
// series row, whichever is newer) wins over an older reading of the same gauge; never another gauge's.
import { describe, expect, it } from 'vitest'
import zzrf1 from '../../api/__fixtures__/floods/river-gauges-ZZRF1.json'
import type { RiverGauge, RiverGaugesResponse } from '../../api/types'
import { gaugeKey, gaugeLineParts, modelKey, newestReading, withChartReading } from './hydrographData'

const g1 = (): RiverGauge => structuredClone((zzrf1 as unknown as RiverGaugesResponse).gauges[0])

describe('hydrograph data', () => {
  it('keys keep the gauge and the past time apart, the model by flood', () => {
    expect(gaugeKey('ZZRF1', null)).not.toBe(gaugeKey('ZZRF1', 5))
    expect(modelKey('a', 'ZZRF1')).not.toBe(modelKey('b', 'ZZRF1'))
  })

  it('the newest reading: a series row newer than the status reading, with the category from NWS levels', () => {
    const g = g1()
    expect(newestReading(g)).toBe(g.observed)
    const later = g1()
    const t = (later.observed.valid_ms ?? 0) + 3_600_000
    later.series!.observed.push([t, 19.4, 9.1])
    const r = newestReading(later)
    expect(r.valid_ms).toBe(t)
    expect(r.value).toBe(19.4)
    expect(r.category).toBe('major')
  })

  it('withChartReading: the chart answer when newer, for the same gauge only', () => {
    const old = g1()
    old.observed = { ...old.observed, valid_ms: (old.observed.valid_ms ?? 0) - 7_200_000, value: 16.1, category: 'minor' }
    const chart = g1()
    expect(withChartReading(old, chart).observed.value).toBe(chart.observed.value)
    expect(withChartReading(chart, old).observed.value).toBe(chart.observed.value)
    expect(withChartReading(old, { ...chart, lid: 'OTHER' }).observed.value).toBe(16.1)
    expect(withChartReading(old, null)).toBe(old)
  })

  // reviews WFC-R6, WFC-R15: the bar's line in the workspace's units, its age kept apart (never cut first)
  it("Command's bar line: the units of the readout, map and chart; the age (amber after 3 h) on its own", () => {
    const now = 1_793_800_000_000
    const r = { value: 26.6, unit: 'ft', category: 'moderate' as const, valid_ms: now - 3_600_000 }
    expect(gaugeLineParts('AGYM7', r, 'us', now)).toEqual({ main: 'AGYM7 · 26.6 FT · MODERATE', age: ' · 1 H AGO', stale: false })
    expect(gaugeLineParts('AGYM7', r, 'metric', now).main).toBe('AGYM7 · 8.1 M · MODERATE')
    expect(gaugeLineParts('AGYM7', { ...r, valid_ms: now - 4 * 3_600_000 }, 'us', now).stale).toBe(true)
    expect(gaugeLineParts('AGYM7', null, 'us', now)).toEqual({ main: 'AGYM7', age: null, stale: false })
  })
})
