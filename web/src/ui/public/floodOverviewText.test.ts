import { describe, expect, it } from 'vitest'
import { ALERTS, ALERTS_UNAVAILABLE as ALERTS_DOWN, GAUGES, GAUGES_UNAVAILABLE as GAUGES_DOWN, LIST, PAST_FLOOD } from '../../api/__fixtures__/floods/edgeCases'
import type { FloodAlertsResponse, RiverGaugesResponse } from '../../api/types'
import { ALERTS_UNAVAILABLE, FLOOD_HERE_IN_FIRES, floodWordingProblems, GAUGES_UNAVAILABLE, NO_GAUGE_NEAR, NO_PRODUCT } from '../shell/floodCopy'
import {
  categoryWord,
  floodCountPart,
  floodDetailsPillLabel,
  floodDisplayName,
  floodDotColor,
  floodHereLine,
  floodInViewLine,
  floodMeta,
  floodPointModel,
  floodRowSub,
  floodRowValue,
  fmtStage,
  gaugeLabel,
  gaugePlace,
  officialProductsLine,
} from './floodOverviewText'

const byId = (id: string) => LIST().floods.find((f) => f.id === id)!
const here = { lat: 36.8, lon: -108.05 }

describe('flood overview words', () => {
  it('leader meta: the gauge category and stage, else the NWS product (never Fire-3d words)', () => {
    expect(floodMeta(byId('fixture-flood-major'))).toBe('MAJOR · 24.3 FT')
    expect(floodMeta(byId('fixture-flood-flash'))).toBe('FLASH FLOOD EMERGENCY')
    expect(floodMeta(byId('fixture-flood-advisory'))).toBe('FLOOD ADVISORY')
    expect(floodMeta(byId('fixture-flood-watch'))).toBe('FLOOD WATCH')
    expect(floodMeta(byId('fixture-flood-major'), 'metric')).toBe('MAJOR · 7.4 M')
    for (const f of LIST().floods) expect(floodMeta(f)).not.toMatch(/\b(ACTIVE|ENDED|OVER|CLEAR|SAFE)\b/)
  })

  it('rows, names and values; DEMO on synthetic floods', () => {
    expect(floodRowSub(byId('fixture-flood'))).toBe('San Juan Co., NM · Flood Warning · Moderate at Example Crossing')
    expect(floodRowSub(byId('fixture-flood-flash'))).toMatch(/Flash Flood Emergency/)
    expect(floodRowValue(byId('fixture-flood'), 'us')).toBe('17.6 ft')
    expect(floodRowValue(byId('fixture-flood-flash'), 'us')).toBeNull()
    expect(floodDisplayName(byId('fixture-flood'))).toBe('Ridge Fork River flood · DEMO')
    expect(floodDisplayName({ name: 'Animas River flood', synthetic: false })).toBe('Animas River flood')
    expect(gaugePlace('San Juan River at Shiprock')).toBe('Shiprock')
    expect(gaugePlace('Cimarron')).toBe('Cimarron')
    expect(categoryWord('minor')).toBe('Minor')
    expect(categoryWord('no_flooding')).toBeNull()
    expect(fmtStage(null, 'ft', 'us')).toBeNull()
    expect(gaugeLabel({ lid: 'ZZRF1', observed_value: 17.62, unit: 'ft', observed_category: 'moderate' }, 'us')).toBe('ZZRF1 · 17.6 FT · MODERATE FLOODING')
    expect(floodDotColor({ max_category: 'major' })).toBe('#c766ff')
    expect(floodDotColor({ max_category: null })).toBe('#f2fbff')
    expect(floodRowSub(PAST_FLOOD())).not.toMatch(/ended/i)
  })

  it('bar status: never 0 when a list is unknown; watches hidden counted (C27)', () => {
    const base = { count: 6, loaded: true, loading: false, failed: false, bothDown: false, hiddenWatches: 1 }
    expect(floodCountPart(base)).toEqual({ text: '6 FLOODS · 1 WATCH HIDDEN', tone: 'count' })
    expect(floodCountPart({ ...base, hiddenWatches: 3 }).text).toBe('6 FLOODS · 3 WATCHES HIDDEN')
    expect(floodCountPart({ ...base, count: 1, hiddenWatches: 0 }).text).toBe('1 FLOOD')
    expect(floodCountPart({ ...base, loaded: false, loading: true }).text).toBe('LOADING FLOODS')
    expect(floodCountPart({ ...base, loaded: false, failed: true }).text).toBe('FLOOD LIST UNAVAILABLE')
    expect(floodCountPart({ ...base, count: null, bothDown: true }).text).toBe('FLOOD LISTS UNAVAILABLE')
    expect(floodCountPart({ ...base, count: 0, bothDown: true }).text).toBe('FLOOD LISTS UNAVAILABLE')
  })

  it('official line, in-view line, pill label', () => {
    expect(officialProductsLine(42, 0, 120_000)).toBe('42 in effect in the lower 48 · checked 2 min ago')
    expect(officialProductsLine(1, 0, 120_000)).toBe('1 in effect in the lower 48 · checked 2 min ago')
    expect(officialProductsLine(null, 0, 1)).toMatch(/not an all-clear/)
    expect(floodInViewLine(12, 31)).toEqual({ inView: '12 floods in this view', all: 'Show all 31' })
    expect(floodDetailsPillLabel(false, 6).aria).toBe('Show details: list of 6 floods')
    expect(floodDetailsPillLabel(true, null).aria).toMatch(/loading/)
  })
})

describe('flood point card (D24: absence needs an answer; C27: every product, watches included)', () => {
  const pointAlerts = (): FloodAlertsResponse => {
    const a = ALERTS()
    a.alerts = a.alerts.map((x) => ({ ...x, covers_point: true }))
    return a
  }
  const none = (): FloodAlertsResponse => ({ ...ALERTS(), alerts: [] })
  const noGauges = (): RiverGaugesResponse => ({ ...GAUGES(), gauges: [] })

  it('lists every product at the point, the watch included', () => {
    const m = floodPointModel({ point: here, alerts: pointAlerts(), alertsFailed: false, gauges: GAUGES(), gaugesFailed: false, floods: LIST().floods })
    expect(m.products.map((a) => a.event)).toEqual(['Flood Warning', 'Flood Advisory', 'Flood Watch'])
    expect(m.productsNote).toBeNull()
    expect(m.gauge?.gauge.lid).toBe('ZZRF1')
    expect(m.gaugeNote).toBe('Nearest gauge on the Ridge Fork River; another stream may be closer.')
    expect(m.nearest[0].flood.id).toBe('fixture-flood')
  })

  it('NO_PRODUCT and NO_GAUGE_NEAR only for available answers', () => {
    const ok = floodPointModel({ point: here, alerts: none(), alertsFailed: false, gauges: noGauges(), gaugesFailed: false, floods: [] })
    expect(ok.productsNote).toBe(NO_PRODUCT)
    expect(ok.gaugeNote).toBe(NO_GAUGE_NEAR)
    const down = floodPointModel({ point: here, alerts: ALERTS_DOWN(), alertsFailed: false, gauges: GAUGES_DOWN(), gaugesFailed: false, floods: [] })
    expect(down.productsNote).not.toBe(NO_PRODUCT)
    expect(down.productsNote).toBe(ALERTS_UNAVAILABLE)
    expect(down.gaugeNote).toBe(GAUGES_UNAVAILABLE)
    expect(down.gaugeNote).not.toBe(NO_GAUGE_NEAR)
    const failed = floodPointModel({ point: here, alerts: null, alertsFailed: true, gauges: null, gaugesFailed: true, floods: [] })
    expect(failed.productsNote).toBe(ALERTS_UNAVAILABLE)
    expect(failed.gaugeNote).toBe(GAUGES_UNAVAILABLE)
    const loading = floodPointModel({ point: here, alerts: null, alertsFailed: false, gauges: null, gaugesFailed: false, floods: [] })
    expect(loading.productsNote).toBeNull()
    expect(loading.gaugeNote).toBeNull()
  })

  it('a below-stage gauge or one farther than 25 km is never the nearest gauge in flood', () => {
    const g = GAUGES()
    g.gauges = g.gauges.map((x) => ({ ...x, observed: { ...x.observed, category: 'no_flooding' } }))
    expect(floodPointModel({ point: here, alerts: none(), alertsFailed: false, gauges: g, gaugesFailed: false, floods: [] }).gauge).toBeNull()
    const far = floodPointModel({ point: { lat: 40, lon: -100 }, alerts: none(), alertsFailed: false, gauges: GAUGES(), gaugesFailed: false, floods: [] })
    expect(far.gauge).toBeNull()
    expect(far.gaugeNote).toBe(NO_GAUGE_NEAR)
  })

  it('Fires mode: one line only when products are in effect at the point; nothing on none or a failure', () => {
    expect(floodHereLine(pointAlerts())).toBe(FLOOD_HERE_IN_FIRES)
    expect(floodHereLine(none())).toBeNull()
    expect(floodHereLine(ALERTS_DOWN())).toBeNull()
    expect(floodHereLine(null)).toBeNull()
  })

  it('every sentence the card can say passes the wording guard', () => {
    const all = [NO_PRODUCT, NO_GAUGE_NEAR, ALERTS_UNAVAILABLE, GAUGES_UNAVAILABLE, FLOOD_HERE_IN_FIRES]
    for (const s of all) expect(floodWordingProblems(s), s).toEqual([])
  })
})
