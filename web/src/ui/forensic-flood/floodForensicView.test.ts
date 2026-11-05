// The 3D flood view's panels, pure parts: unavailable layers in the backend's words, the scene key (each layer with its
// own time; the satellite age computed at render time, C16), the Evidence products (every version, newest first) and
// the River gauges rows.
import { describe, expect, it } from 'vitest'
import { ALERTS, DETAIL, GAUGES, SATELLITE } from '../../api/__fixtures__/floods/edgeCases'
import type { FloodAlert, FloodAlertsResponse } from '../../api/types'
import { timeFmt } from '../../lib/time'
import type { FloodSceneAssets } from '../../scene/flood/floodAssets'
import { FLOOD_FORENSIC } from './floodForensicCopy'
import { evidenceProducts, gaugeRows, layerUnavailable, sceneKeyItems, versionAction } from './floodForensicView'
import { FLOOD_FORENSIC_DEFAULTS, type FloodForensicLayer, type FloodLayerSetting } from './forensicFloodState'

const TF = timeFmt('America/Denver', '24h')
const DAY = 86_400_000

function flood(over: Partial<FloodSceneAssets> = {}): FloodSceneAssets {
  const d = DETAIL()
  const sat = new Uint8Array([0, 1, 2, 253, 255, 0, 0, 0, 1, 1, 0, 0, 0, 0])
  return {
    manifest: d.manifest!,
    summary: d.summary,
    textures: { pack: null, satWater: null, satLut: null as never },
    has: { forecast: true, floodplain: true, model: true, catfim: true, satellite: true, noView: true },
    arrays: { width: 14, height: 1, forecast: null, floodplain: null, model: null, catfim: null, satellite: sat },
    catfim: { key: 'catfim_ZZRF1_moderate', lid: 'ZZRF1', category: 'moderate' },
    warnings: ALERTS(),
    gauges: GAUGES(),
    satellite: SATELLITE(),
    frame: { minX: -1, maxX: 1, minZ: -1, maxZ: 1, cx: 0, cz: 0 },
    anchors: { model: null, catfim: null },
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

describe('sceneKeyItems', () => {
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
    const f = flood({ has: { forecast: false, floodplain: false, model: false, catfim: false, satellite: false, noView: false } })
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
