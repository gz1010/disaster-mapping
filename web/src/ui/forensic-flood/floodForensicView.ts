// Pure parts of the 3D flood view's panels (brief 5, PLAN-5 §4.7): which Layers-tab rows the bundle can show (and why
// not, in the backend's own words), the scene key (one item per layer drawn, each with its own time; ages computed at
// render time, C16), the Evidence tab's products (every version saved, newest first, grouped per NWS product), and the
// River gauges card rows. Tested in floodForensicView.test.ts.
import type { FloodAlert, FloodAlertsResponse, FloodManifest, FloodSummary, RiverGaugesResponse } from '../../api/types'
import { fmtAt, fmtRelative, type TimeFmt } from '../../lib/time'
import { memberGaugesOf, orderAlerts, senderName, shownGranule } from '../../official/floodModel'
import type { FloodSceneAssets } from '../../scene/flood/floodAssets'
import { productKey } from '../../scene/flood/floodGeo'
import { categoryCaps, stageCaps } from '../../scene/flood/gaugeBarMath'
import type { Units } from '../../state/workspace'
import { fillCopy } from '../shell/floodCopy'
import { FLOOD_FORENSIC } from './floodForensicCopy'
import { shownOpacity, type FloodForensicLayer, type FloodLayerSetting } from './forensicFloodState'

/** The bundle layer behind each toggle (manifest.layer_status keys); null: not a bundle layer. */
export const LAYER_STATUS_KEY: Record<FloodForensicLayer, keyof FloodManifest['layer_status'] | null> = {
  terrain: 'terrain',
  naip: 'naip',
  floodplain: 'floodplain',
  satellite: 'water_satellite',
  forecastArea: 'water_forecast',
  warnings: 'warnings',
  gauges: 'gauges',
  catfim: null,
  model: 'water_model',
  contours: null,
  telemetry: null,
}

/** Why a toggle has nothing to draw for this flood (null: it can be shown). The backend's own reason when the layer
 *  could not be made (e.g. SAT_UNAVAILABLE), else "Not in this bundle". */
export function layerUnavailable(k: FloodForensicLayer, flood: Pick<FloodSceneAssets, 'manifest' | 'has' | 'warnings' | 'gauges'> | null): string | null {
  if (!flood) return FLOOD_FORENSIC.loadingTerrain
  const m = flood.manifest
  const sk = LAYER_STATUS_KEY[k]
  const st = sk ? m.layer_status[sk] : null
  const notOk = st && st.status !== 'ok' ? (st.reason ?? FLOOD_FORENSIC.layerUnavailable) : null
  switch (k) {
    case 'naip':
      return notOk ?? (m.layers.naip ? null : FLOOD_FORENSIC.layerUnavailable)
    case 'floodplain':
      return notOk ?? (flood.has.floodplain ? null : FLOOD_FORENSIC.layerUnavailable)
    case 'satellite':
      return notOk ?? (flood.has.satellite ? null : FLOOD_FORENSIC.keySatNone)
    case 'forecastArea':
      return notOk ?? (flood.has.forecast ? null : FLOOD_FORENSIC.layerUnavailable)
    case 'model':
      return notOk ?? (flood.has.model ? null : FLOOD_FORENSIC.layerUnavailable)
    case 'catfim':
      return flood.has.catfim ? null : FLOOD_FORENSIC.layerUnavailable
    case 'warnings':
      return notOk ?? (flood.warnings ? (flood.warnings.status === 'available' ? null : (flood.warnings.reason ?? FLOOD_FORENSIC.evidenceUnavailable)) : FLOOD_FORENSIC.layerUnavailable)
    case 'gauges':
      return notOk ?? (flood.gauges ? (flood.gauges.status === 'available' ? null : (flood.gauges.reason ?? FLOOD_FORENSIC.gaugesUnavailable)) : FLOOD_FORENSIC.layerUnavailable)
    default:
      return notOk
  }
}

export type KeySwatch = 'satellite' | 'noview' | 'edge' | 'forecast' | 'warning' | 'floodplain' | 'model' | 'catfim' | 'bar'

export interface SceneKeyItem {
  key: string
  swatch: KeySwatch
  text: string
  /** amber: a satellite image older than 3 days (as the Public key) */
  stale?: boolean
}

const SAT_STALE_MS = 3 * 24 * 3_600_000

/** One key item per layer drawn, each with its own time (D8); the age is computed now, from the image's own time
 *  (C16). The gauge line always says what the bar height means. */
export function sceneKeyItems(i: {
  flood: Pick<FloodSceneAssets, 'has' | 'satellite' | 'manifest' | 'catfim'>
  layers: Record<FloodForensicLayer, FloodLayerSetting>
  tf: TimeFmt
  nowMs: number
  hasWarnings: boolean
  hasGauges: boolean
}): SceneKeyItem[] {
  const { flood, layers: L, tf, nowMs } = i
  const out: SceneKeyItem[] = []
  const on = (k: FloodForensicLayer) => shownOpacity(L[k]) > 0
  if (on('satellite')) {
    const g = shownGranule(flood.satellite)
    if (flood.has.satellite && g) {
      const time = fmtAt(g.acquired_ms, tf, { zone: true, year: 'auto', refMs: nowMs })
      out.push({ key: 'satellite', swatch: 'satellite', text: fillCopy(FLOOD_FORENSIC.keySatellite, { time, age: fmtRelative(g.acquired_ms, nowMs) }), stale: nowMs - g.acquired_ms > SAT_STALE_MS })
      if (flood.has.noView) out.push({ key: 'noview', swatch: 'noview', text: FLOOD_FORENSIC.keySatNoView })
      if (flood.satellite?.image) out.push({ key: 'edge', swatch: 'edge', text: FLOOD_FORENSIC.keySatEdge })
    } else out.push({ key: 'satnone', swatch: 'noview', text: flood.manifest.layer_status.water_satellite?.reason ?? FLOOD_FORENSIC.keySatNone })
  }
  if (on('forecastArea') && flood.has.forecast) {
    const t = flood.manifest.layer_status.water_forecast?.time_ms
    out.push({ key: 'forecast', swatch: 'forecast', text: t != null ? fillCopy(FLOOD_FORENSIC.keyForecast, { time: fmtAt(t, tf, { zone: true, year: 'auto', refMs: nowMs }) }) : FLOOD_FORENSIC.keyForecastNoTime })
  }
  if (on('warnings') && i.hasWarnings) out.push({ key: 'warning', swatch: 'warning', text: FLOOD_FORENSIC.keyWarning })
  if (on('floodplain') && flood.has.floodplain) out.push({ key: 'floodplain', swatch: 'floodplain', text: FLOOD_FORENSIC.keyFloodplain })
  if (on('catfim') && flood.has.catfim && flood.catfim) out.push({ key: 'catfim', swatch: 'catfim', text: fillCopy(FLOOD_FORENSIC.keyCatfim, { category: flood.catfim.category }) })
  if (on('model') && flood.has.model) out.push({ key: 'model', swatch: 'model', text: FLOOD_FORENSIC.keyModel })
  if (on('gauges') && i.hasGauges) out.push({ key: 'bar', swatch: 'bar', text: FLOOD_FORENSIC.barHeight })
  return out
}

export interface EvidenceProduct {
  key: string
  event: string
  sender: string
  emergency: boolean
  /** Every version saved, newest first. */
  versions: FloodAlert[]
}

/** The Evidence tab's products: per NWS product (VTEC event, else its own id), every saved version newest first;
 *  products in NWS's order (Emergency first, then warnings, advisories, watches, statements). */
export function evidenceProducts(resp: FloodAlertsResponse | null): EvidenceProduct[] {
  if (!resp || resp.status !== 'available') return []
  const groups = new Map<string, FloodAlert[]>()
  for (const a of resp.alerts) {
    const k = productKey(a)
    const list = groups.get(k)
    if (list) list.push(a)
    else groups.set(k, [a])
  }
  const heads = [...groups.entries()].map(([key, versions]) => {
    const sorted = [...versions].sort((a, b) => (b.sent_ms ?? 0) - (a.sent_ms ?? 0))
    const head = sorted[0]
    return { key, head, versions: sorted }
  })
  const byKey = new Map(heads.map((h) => [h.key, h]))
  const out: EvidenceProduct[] = []
  for (const h of orderAlerts(heads.map((x) => ({ ...x.head, _k: x.key })))) {
    const g = byKey.get(h._k)
    if (g) out.push({ key: g.key, event: g.head.event, sender: senderName(g.head.sender_name), emergency: g.versions.some((v) => v.emergency), versions: g.versions })
  }
  return out
}

/** "NEW", "EXT", "CAN" … (VTEC action), else NWS's message type. */
export function versionAction(a: Pick<FloodAlert, 'vtec' | 'message_type'>): string | null {
  return a.vtec?.action ?? a.message_type ?? null
}

export interface GaugeRow {
  lid: string
  name: string
  member: boolean
  stage: string | null
  category: string
  tone: string
  time: string | null
  url: string
}

/** The River gauges card: members first (one reading per gauge, WFP-R2), then the nearby gauges. */
export function gaugeRows(resp: RiverGaugesResponse | null, summary: Pick<FloodSummary, 'primary_gauge'> | null, units: Units, tf: TimeFmt, nowMs: number): GaugeRow[] {
  if (!resp || resp.status !== 'available') return []
  const members = memberGaugesOf(resp, summary)
  const nearby = resp.gauges.filter((g) => !g.member)
  return [...members, ...nearby].map((g) => {
    const zoned: TimeFmt = { tz: g.time_zone || tf.tz, clock: tf.clock }
    return {
      lid: g.lid,
      name: g.name,
      member: g.member,
      stage: stageCaps(g.observed.value, g.observed.unit, units),
      category: categoryCaps(g.observed.category),
      tone: g.observed.category,
      time: g.observed.valid_ms != null ? `${fmtAt(g.observed.valid_ms, zoned, { zone: true, year: 'auto', refMs: nowMs })} (${fmtRelative(g.observed.valid_ms, nowMs)})` : null,
      url: g.url,
    }
  })
}
