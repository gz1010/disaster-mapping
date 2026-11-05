// The 3D flood view's panels, pure parts: unavailable layers in the backend's words, the scene key (each layer with its
// own time; the satellite age computed at render time, C16), the Evidence products (every version, newest first) and
// the River gauges rows.
import { describe, expect, it } from 'vitest'
import { ALERTS, DETAIL, GAUGES, SATELLITE } from '../../api/__fixtures__/floods/edgeCases'
import type { FloodAlert, FloodAlertsResponse } from '../../api/types'
import { timeFmt } from '../../lib/time'
import type { FloodSceneAssets } from '../../scene/flood/floodAssets'
import { ALERTS_UNAVAILABLE, CURSOR_FUTURE_PRODUCTS, floodWordingProblems, NO_PRODUCT, MODEL_CAVEAT, NFHL_NO_MAP, NFHL_NOTE, RFC_FIM_NOTE, SAT_NOT_SET_UP, SAT_NOT_SET_UP_SHORT } from '../shell/floodCopy'
import { FLOOD_FORENSIC } from './floodForensicCopy'
import { dockNoProduct, evidenceProducts, floodplainEffective, gaugeRows, layerNote, layerUnavailable, overviewProduct, sceneKeyItems, versionAction } from './floodForensicView'
import { FLOOD_FORENSIC_DEFAULTS, type FloodForensicLayer, type FloodLayerSetting } from './forensicFloodState'

const TF = timeFmt('America/Denver', '24h')
const DAY = 86_400_000

function flood(over: Partial<FloodSceneAssets> = {}): FloodSceneAssets {
  const d = DETAIL()
  const sat = new Uint8Array([0, 1, 2, 253, 255, 0, 0, 0, 1, 1, 0, 0, 0, 0])
  return {
    manifest: d.manifest!,
    summary: d.summary,
    textures: { pack: null, satWater: null, satLut: null as never, hand: null },
    has: { forecast: true, floodplain: true, model: true, catfim: true, satellite: true, noView: true, hand: false, depthSatellite: false, depthForecast: false },
    arrays: { width: 14, height: 1, forecast: null, floodplain: null, model: null, catfim: null, satellite: sat, hand: null, depthSatellite: null, depthForecast: null },
    catfim: { key: 'catfim_ZZRF1_moderate', lid: 'ZZRF1', category: 'moderate' },
    warnings: ALERTS(),
    gauges: GAUGES(),
    satellite: SATELLITE(),
    frame: { minX: -1, maxX: 1, minZ: -1, maxZ: 1, cx: 0, cz: 0 },
    anchors: { model: null, catfim: null },
    terrain3d: null,
    boost: { factor: 3, basis: 'grid', rangeM: 90, widthM: 12000, reached: true, relief: null },
    river: null,
    ...over,
  }
}

const layers = (on: Partial<Record<FloodForensicLayer, boolean>> = {}): Record<FloodForensicLayer, FloodLayerSetting> => {
  const out = {} as Record<FloodForensicLayer, FloodLayerSetting>
  for (const [k, v] of Object.entries(FLOOD_FORENSIC_DEFAULTS)) out[k as FloodForensicLayer] = { ...v, visible: on[k as FloodForensicLayer] ?? v.visible }
  return out
}

describe('layerUnavailable', () => {
  it("says why in the backend's own words, and offers what the bundle has", () => {
    const f = flood()
    expect(layerUnavailable('satellite', f)).toBeNull()
    expect(layerUnavailable('model', f)).toBeNull()
    const m = { ...f.manifest, layer_status: { ...f.manifest.layer_status, water_satellite: { status: 'unavailable' as const, reason: 'Satellite water could not be loaded right now. That is not an all-clear.', source: 'x', time_ms: null } } }
    expect(layerUnavailable('satellite', { ...f, manifest: m, has: { ...f.has, satellite: false } })).toBe('Satellite water could not be loaded right now. That is not an all-clear.')
    expect(layerUnavailable('catfim', { ...f, has: { ...f.has, catfim: false } })).toBe(FLOOD_FORENSIC.layerUnavailable)
    expect(layerUnavailable('gauges', { ...f, gauges: { ...GAUGES(), status: 'unavailable', reason: 'River gauge readings could not be loaded right now. That is not an all-clear.' } })).toMatch(/not an all-clear/)
    expect(layerUnavailable('contours', f)).toBeNull()
  })
})

describe('layerNote and empty layers (review WFF-R2)', () => {
  it("keeps the backend's note of an 'ok' layer: the NASA login, FEMA's partial map", () => {
    const f = flood()
    // the fixture's satellite layer is 'ok' with SAT_NOT_SET_UP as its reason
    expect(f.manifest.layer_status.water_satellite.status).toBe('ok')
    expect(layerNote('satellite', f)).toBe(SAT_NOT_SET_UP)
    expect(layerNote('forecastArea', f)).toBeNull()
    const partial = "FEMA's digital flood map covers only part of this area; outside it, FEMA's floodplain is not shown."
    const m = { ...f.manifest, layer_status: { ...f.manifest.layer_status, floodplain: { ...f.manifest.layer_status.floodplain, reason: partial } } }
    expect(layerNote('floodplain', { ...f, manifest: m })).toBe(partial)
    // an unavailable layer has no note (its reason is the row's "why")
    const down = { ...f.manifest, layer_status: { ...f.manifest.layer_status, water_satellite: { status: 'unavailable' as const, reason: 'x', source: 'x', time_ms: null } } }
    expect(layerNote('satellite', { ...f, manifest: down, has: { ...f.has, satellite: false } })).toBeNull()
  })

  it("a layer made with nothing to draw says the backend's reason (FEMA has no digital map), not \"Not in this bundle\"", () => {
    const f = flood({ has: { forecast: true, floodplain: false, model: true, catfim: true, satellite: true, noView: true, hand: false, depthSatellite: false, depthForecast: false } })
    const m = { ...f.manifest, layer_status: { ...f.manifest.layer_status, floodplain: { ...f.manifest.layer_status.floodplain, reason: NFHL_NO_MAP } } }
    expect(layerUnavailable('floodplain', { ...f, manifest: m })).toBe(NFHL_NO_MAP)
    expect(layerUnavailable('floodplain', f)).toBe(FLOOD_FORENSIC.layerUnavailable)
  })
})

describe('sceneKeyItems', () => {
  it("carries each layer's note and caveats; FEMA with its effective date; the category in words (WFF-R2, R3, R11)", () => {
    const f = flood()
    const acquired = SATELLITE().granules[0].acquired_ms
    const items = sceneKeyItems({ flood: f, layers: layers({ floodplain: true, catfim: true, model: true }), tf: TF, nowMs: acquired + DAY, hasWarnings: true, hasGauges: true })
    const by = (k: string) => items.find((i) => i.key === k)!
    expect(by('satellite').notes).toEqual([SAT_NOT_SET_UP_SHORT])
    expect(by('satellite').more?.texts).toEqual([...SATELLITE().caveats, SAT_NOT_SET_UP])
    expect(by('satellite').more?.texts[0]).toMatch(/dry pixels do not mean no flooding/)
    expect(by('forecast').more?.texts[0]).toBe(RFC_FIM_NOTE)
    const date = floodplainEffective(f)
    expect(date).toMatch(/2021$/)
    expect(by('floodplain').text).toBe(`FEMA 1% annual-chance floodplain (“100-year floodplain”), background · effective ${date}`)
    expect(by('floodplain').more?.texts).toEqual([NFHL_NOTE])
    expect(by('catfim').text).toBe('NWS category flood map: Moderate flooding (NWS) · experimental')
    expect(by('catfim').more?.texts[0]).toBe('What NWS maps for moderate flooding at this gauge (experimental map library). Not a forecast.')
    expect(by('model').more?.texts).toEqual([MODEL_CAVEAT])
    expect(by('bar').more?.texts).toEqual(GAUGES().caveats)
    for (const it of items) for (const t of [it.text, ...(it.notes ?? []), ...(it.more?.texts ?? [])]) expect(floodWordingProblems(t)).toEqual([])
  })

  it("with the handle after now, says the products shown are those in effect now (C1, WFF-R4)", () => {
    const f = flood()
    const now = ALERTS().now_ms
    const future = sceneKeyItems({ flood: f, layers: layers(), tf: TF, nowMs: now, cursorMs: now + 30 * 3_600_000, hasWarnings: true, hasGauges: true })
    const item = future.find((i) => i.key === 'future')
    expect(item?.text).toBe(CURSOR_FUTURE_PRODUCTS)
    expect(item?.stale).toBe(true)
    // at now or before: no such line
    expect(sceneKeyItems({ flood: f, layers: layers(), tf: TF, nowMs: now, cursorMs: null, hasWarnings: true, hasGauges: true }).some((i) => i.key === 'future')).toBe(false)
    expect(sceneKeyItems({ flood: f, layers: layers(), tf: TF, nowMs: now, cursorMs: now - 3_600_000, hasWarnings: true, hasGauges: true }).some((i) => i.key === 'future')).toBe(false)
  })

  it('names each layer drawn with its own time, the no-view hatch, the image edge and the bar meaning', () => {
    const f = flood()
    const acquired = SATELLITE().granules[0].acquired_ms
    const items = sceneKeyItems({ flood: f, layers: layers(), tf: TF, nowMs: acquired + 4 * DAY, hasWarnings: true, hasGauges: true })
    const keys = items.map((i) => i.key)
    expect(keys).toEqual(['satellite', 'noview', 'edge', 'forecast', 'warning', 'bar'])
    expect(items[0].text).toMatch(/^Water seen by satellite · .+ \(4 d ago\)$/)
    expect(items[0].stale).toBe(true)
    expect(items.find((i) => i.key === 'bar')?.text).toBe('Bar height: river stage at the gauge (scaled), not water depth')
    // FEMA, the category map and the model only when switched on
    const all = sceneKeyItems({ flood: f, layers: layers({ floodplain: true, catfim: true, model: true }), tf: TF, nowMs: acquired, hasWarnings: true, hasGauges: true })
    expect(all.map((i) => i.key)).toEqual(expect.arrayContaining(['floodplain', 'catfim', 'model']))
    expect(all.find((i) => i.key === 'model')?.text).toMatch(/experimental/)
  })

  it('computes the age at render time: a bundle built 7 days ago shows a 7+ day old image (C16)', () => {
    const f = flood()
    const acquired = SATELLITE().granules[0].acquired_ms
    const later = sceneKeyItems({ flood: f, layers: layers(), tf: TF, nowMs: acquired + 7 * DAY + 3_600_000, hasWarnings: false, hasGauges: false })
    expect(later[0].text).toMatch(/\(7 d ago\)$/)
  })

  it('a bundle without a measured image says so instead of drawing nothing silently', () => {
    const f = flood({ has: { forecast: false, floodplain: false, model: false, catfim: false, satellite: false, noView: false, hand: false, depthSatellite: false, depthForecast: false } })
    const items = sceneKeyItems({ flood: f, layers: layers(), tf: TF, nowMs: Date.now(), hasWarnings: false, hasGauges: false })
    expect(items).toHaveLength(1)
    expect(items[0].key).toBe('satnone')
  })
})

describe('evidenceProducts', () => {
  it('groups every saved version per NWS product, newest first, in NWS order', () => {
    const resp = ALERTS()
    const flw = resp.alerts.find((a) => a.event === 'Flood Warning')!
    const older: FloodAlert = { ...flw, id: 'flw.1', vtec: { ...flw.vtec!, action: 'NEW' }, sent_ms: (flw.sent_ms ?? 0) - 6 * 3_600_000 }
    const r: FloodAlertsResponse = { ...resp, alerts: [older, ...resp.alerts] }
    const ps = evidenceProducts(r)
    expect(ps[0].event).toBe('Flood Warning')
    expect(ps[0].versions.map((v) => versionAction(v))).toEqual(['EXT', 'NEW'])
    expect(ps.map((p) => p.event)).toEqual(['Flood Warning', 'Flood Advisory', 'Flood Watch'])
    expect(ps[0].sender).toBe('NWS Example Office (synthetic)')
  })

  it('an answer that could not be read lists nothing (the tab says why)', () => {
    expect(evidenceProducts({ ...ALERTS(), status: 'unavailable' })).toEqual([])
    expect(evidenceProducts(null)).toEqual([])
  })
})

describe('gaugeRows', () => {
  it('lists members first with the category in words and the reading time with its age', () => {
    const resp = GAUGES()
    const rows = gaugeRows(resp, DETAIL().summary, 'us', TF, resp.now_ms)
    expect(rows[0].member).toBe(true)
    const lastMember = rows.map((r) => r.member).lastIndexOf(true)
    expect(rows.findIndex((r) => !r.member)).toBeGreaterThan(lastMember)
    const z1 = rows.find((r) => r.lid === 'ZZRF1')!
    expect(z1.category).toBe('MODERATE')
    expect(z1.time).toMatch(/M[SD]T \(.+\)$/)
    expect(gaugeRows({ ...resp, status: 'unavailable' }, null, 'us', TF, 0)).toEqual([])
  })
})

describe('dockNoProduct (review WFF-R5: the copy saved with the 3D data, never "right now" for a past handle)', () => {
  const now = Date.UTC(2026, 10, 5, 6, 0)
  it('a past handle names its time and the copy', () => {
    const t = dockNoProduct({ cursorMs: now - 31 * 3_600_000, nowMs: now, savedMs: now - 60_000, tf: TF })
    expect(t).toMatch(/^No NWS flood product was in effect at .+ in the copy saved with the 3D data\. That is not an all-clear: follow local officials\.$/)
    expect(t).not.toMatch(/right now/)
  })
  it('at now: NO_PRODUCT only while the copy is fresh, else the copy names its own time', () => {
    expect(dockNoProduct({ cursorMs: null, nowMs: now, savedMs: now - 10 * 60_000, tf: TF })).toBe(NO_PRODUCT)
    const old = dockNoProduct({ cursorMs: null, nowMs: now, savedMs: now - 3 * DAY, tf: TF })
    expect(old).toMatch(/^No NWS flood product was in effect in the copy saved with the 3D data \(.+\)\. That is not an all-clear: follow local officials\.$/)
    expect(floodWordingProblems(old)).toEqual([])
  })
})

describe('overviewProduct (review WFF-R6: from warnings.json at build time, never the live list)', () => {
  it('the highest product in effect when the 3D data was prepared', () => {
    const a = ALERTS()
    const r = overviewProduct(a, a.now_ms, a.now_ms + DAY)
    expect(r.kind).toBe('product')
    expect(r.kind === 'product' && r.alert.event).toBe('Flood Warning')
  })
  it('none in effect then: the absence; a copy that could not be read: its outage text (D24)', () => {
    const a = ALERTS()
    expect(overviewProduct(a, Date.UTC(2020, 0, 1), a.now_ms).kind).toBe('none')
    expect(overviewProduct({ ...a, status: 'unavailable', reason: ALERTS_UNAVAILABLE, alerts: [] }, a.now_ms, a.now_ms)).toEqual({ kind: 'unavailable', text: ALERTS_UNAVAILABLE })
    expect(overviewProduct(null, a.now_ms, a.now_ms)).toEqual({ kind: 'unavailable', text: ALERTS_UNAVAILABLE })
  })
})
