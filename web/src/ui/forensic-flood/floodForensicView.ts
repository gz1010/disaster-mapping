// Pure parts of the 3D flood view's panels (brief 5, PLAN-5 §4.7): which Layers-tab rows the bundle can show (and why
// not, in the backend's own words), the scene key (one item per layer drawn, each with its own time; ages computed at
// render time, C16), the Evidence tab's products (every version saved, newest first, grouped per NWS product), and the
// River gauges card rows. Tested in floodForensicView.test.ts.
// Brief 6 (web-forensic-flood-3d): the key's height line ("Height ×10: heights drawn 10 times taller, distances true",
// automatic or the user's choice, "Still flat at ×10" when the relief rule could not reach its target), the estimated
// depth surface (DEPTH_LABEL with its water's own time, or why none is shown) and the height above the river
// (HAND_LABEL with its bands), each with the backend's caveat, method and citation in the fold-out; the Layers tab's
// two new rows ('depth', 'hand') say why they are missing (an older bundle, the backend's reason).
import type { FloodAlert, FloodAlertsResponse, FloodManifest, FloodSummary, RiverGaugesResponse } from '../../api/types'
import { fmtAt, fmtDayDate, fmtRelative, type TimeFmt } from '../../lib/time'
import { memberGaugesOf, orderAlerts, senderName, shownGranule } from '../../official/floodModel'
import type { DepthShown } from '../../scene/flood/depthChoice'
import { FLOOD_3D } from '../../scene/flood/flood3dCopy'
import type { FloodSceneAssets } from '../../scene/flood/floodAssets'
import { productKey, warningsAt } from '../../scene/flood/floodGeo'
import { fmtFactor, fmtSpan } from '../../scene/flood/heightBoost'
import { catfimCategoryLabel, catfimCategoryWord } from '../../scene/flood/floodProbe'
import { categoryCaps, stageCaps } from '../../scene/flood/gaugeBarMath'
import type { Units } from '../../state/workspace'
import { ALERTS_UNAVAILABLE, CATFIM_NOTE, fillCopy, MODEL_CAVEAT, NO_PRODUCT, NFHL_LABEL, NFHL_NOTE, RFC_FIM_NOTE, RFC_FIM_OUTSIDE, SAT_NOT_SET_UP_SHORT } from '../shell/floodCopy'
import { futureProductsNote } from '../timeline/hydrographModel'
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
  depth: null,
  hand: null,
}

type LayerFlood = Pick<FloodSceneAssets, 'manifest' | 'has' | 'warnings' | 'gauges'> & Partial<Pick<FloodSceneAssets, 'terrain3d'>>

/** Why a toggle has nothing to draw for this flood (null: it can be shown). The backend's own reason when the layer
 *  could not be made (e.g. SAT_UNAVAILABLE) or when it was made but holds nothing here (e.g. NFHL_NO_MAP: FEMA has no
 *  digital flood map; review WFF-R2), else "Not in this bundle". */
export function layerUnavailable(k: FloodForensicLayer, flood: LayerFlood | null): string | null {
  if (!flood) return FLOOD_FORENSIC.loadingTerrain
  const m = flood.manifest
  const sk = LAYER_STATUS_KEY[k]
  const st = sk ? m.layer_status[sk] : null
  const notOk = st && st.status !== 'ok' ? (st.reason ?? FLOOD_FORENSIC.layerUnavailable) : null
  // made, but nothing to draw here: the backend's own reason when it gave one
  const empty = st?.reason ?? FLOOD_FORENSIC.layerUnavailable
  switch (k) {
    case 'naip':
      return notOk ?? (m.layers.naip ? null : empty)
    case 'floodplain':
      return notOk ?? (flood.has.floodplain ? null : empty)
    case 'satellite':
      return notOk ?? (flood.has.satellite ? null : (st?.reason ?? FLOOD_FORENSIC.keySatNone))
    case 'forecastArea':
      return notOk ?? (flood.has.forecast ? null : empty)
    case 'model':
      return notOk ?? (flood.has.model ? null : empty)
    case 'catfim':
      return flood.has.catfim ? null : FLOOD_FORENSIC.layerUnavailable
    case 'warnings':
      return notOk ?? (flood.warnings ? (flood.warnings.status === 'available' ? null : (flood.warnings.reason ?? FLOOD_FORENSIC.evidenceUnavailable)) : FLOOD_FORENSIC.layerUnavailable)
    case 'gauges':
      return notOk ?? (flood.gauges ? (flood.gauges.status === 'available' ? null : (flood.gauges.reason ?? FLOOD_FORENSIC.gaugesUnavailable)) : FLOOD_FORENSIC.layerUnavailable)
    case 'hand': {
      // brief 6: an older bundle has no terrain products; else the backend's own reason
      const t3 = flood.terrain3d ?? m.terrain3d ?? null
      if (!t3) return FLOOD_3D.depthNoTerrain3d
      if (t3.hand.status !== 'ok') return t3.hand.reason ?? FLOOD_FORENSIC.layerUnavailable
      return flood.has.hand ? null : (t3.hand.reason ?? FLOOD_FORENSIC.layerUnavailable)
    }
    case 'depth': {
      const t3 = flood.terrain3d ?? m.terrain3d ?? null
      if (!t3) return FLOOD_3D.depthNoTerrain3d
      if (flood.has.depthSatellite || flood.has.depthForecast) return null
      return t3.depth.find((d) => d.reason)?.reason ?? FLOOD_FORENSIC.layerUnavailable
    }
    default:
      return notOk
  }
}

/** The backend's note on a layer that can be shown (layer_status.reason of an 'ok' layer: "NASA Earthdata login is not
 *  set up on this server…", "FEMA's digital flood map covers only part of this area…"; review WFF-R2), else null. */
export function layerNote(k: FloodForensicLayer, flood: LayerFlood | null): string | null {
  if (!flood || layerUnavailable(k, flood) != null) return null
  const sk = LAYER_STATUS_KEY[k]
  return sk ? (flood.manifest.layer_status[sk]?.reason ?? null) : null
}

/** "effective Aug 3, 2021": FEMA's own effective date of its newest map panel over the area (layer_status.floodplain
 *  time_ms; FEMA's dates are calendar days, shown in UTC so they never shift by a day). */
export function floodplainEffective(flood: Pick<FloodSceneAssets, 'manifest'>): string | null {
  const t = flood.manifest.layer_status.floodplain?.time_ms
  return t != null ? fmtDayDate(t, 'UTC', { year: 'always' }) : null
}

export type KeySwatch = 'satellite' | 'noview' | 'edge' | 'forecast' | 'warning' | 'floodplain' | 'model' | 'catfim' | 'bar' | 'future' | 'height' | 'depth' | 'hand'

export interface SceneKeyItem {
  key: string
  swatch: KeySwatch
  text: string
  /** amber: a satellite image older than 3 days (as the Public key); the handle after now (C1) */
  stale?: boolean
  /** Short notes shown under the line (the layer's own reason, e.g. "No radar images: NASA login not set up"). */
  notes?: string[]
  /** The layer's caveats in its source's words, in the key's fold-out "About these layers" (review WFF-R2). */
  more?: { title: string; texts: string[] }
}

const SAT_STALE_MS = 3 * 24 * 3_600_000

const uniq = (xs: (string | null | undefined)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))]

/** One key item per layer drawn, each with its own time (D8); the age is computed now, from the image's own time
 *  (C16). Each item carries the layer's backend note (layer_status.reason, the NASA login note) and, for the fold-out,
 *  its caveats (SAT_CAVEAT from satellite.json, RFC_FIM_NOTE, NFHL_NOTE, CATFIM_NOTE, MODEL_CAVEAT; review WFF-R2).
 *  FEMA's line is NFHL_LABEL with its effective date (WFF-R3); the category map's category in words (WFF-R11). With the
 *  handle after now, an amber line says the products shown are those in effect now (C1, WFF-R4). The gauge line always
 *  says what the bar height means. */
export function sceneKeyItems(i: {
  flood: Pick<FloodSceneAssets, 'has' | 'satellite' | 'manifest' | 'catfim' | 'warnings' | 'gauges'> & Partial<Pick<FloodSceneAssets, 'terrain3d' | 'boost'>>
  layers: Record<FloodForensicLayer, FloodLayerSetting>
  tf: TimeFmt
  nowMs: number
  hasWarnings: boolean
  hasGauges: boolean
  /** The river-level chart's handle (useFlood.cursorMs; null = now). */
  cursorMs?: number | null
  /** Brief 6: the height boost in use (store.exaggeration) and whether it is the user's own choice. */
  height?: { factor: number; user: boolean } | null
  /** Brief 6: the depth surface on screen (scene/flood/depthChoice.ts), or why there is none. */
  depth?: DepthShown | null
}): SceneKeyItem[] {
  const { flood, layers: L, tf, nowMs } = i
  const out: SceneKeyItem[] = []
  const on = (k: FloodForensicLayer) => shownOpacity(L[k]) > 0
  const st = flood.manifest.layer_status
  const t3 = flood.terrain3d ?? flood.manifest.terrain3d ?? null
  // brief 6: the height boost, always on screen while a flood's 3D view shows
  if (i.height && flood.boost) {
    const b = flood.boost
    const n = fmtFactor(i.height.factor)
    const auto = fillCopy(b.basis === 'bundle' ? FLOOD_3D.keyHeightAuto : FLOOD_3D.keyHeightAutoGrid, { range: fmtSpan(b.rangeM), width: fmtSpan(b.widthM / 1000) })
    // short notes in the key (the user's choice; how to see more where the rule's cap still looks flat); the automatic
    // value's reason and the rule in the fold-out
    const notes = uniq([
      i.height.user ? fillCopy(FLOOD_3D.keyHeightUser, { n: fmtFactor(b.factor) }) : null,
      !b.reached && i.height.factor <= b.factor ? fillCopy(FLOOD_3D.keyHeightFlat, { n }) : null,
    ])
    const rule = b.relief ? [auto, b.relief.rule, b.relief.area_note] : [auto, FLOOD_3D.heightRuleGrid]
    out.push({ key: 'height', swatch: 'height', text: fillCopy(FLOOD_3D.keyHeight, { n }), notes, more: { title: FLOOD_3D.keyMoreHeight, texts: uniq(rule) } })
  }
  if (on('satellite')) {
    const sat = flood.satellite
    const g = shownGranule(sat)
    const reason = st.water_satellite?.reason ?? null
    const login = sat?.login_note ?? null
    // the login note in short under the line (the full text in the fold-out); any other backend reason in full
    const loginShort = sat?.login === 'not_configured' ? SAT_NOT_SET_UP_SHORT : login
    const notes = uniq([loginShort, reason && reason !== login ? reason : null])
    const more = { title: FLOOD_FORENSIC.keyMoreSatellite, texts: uniq([...(sat?.caveats ?? []), login]) }
    if (flood.has.satellite && g) {
      const time = fmtAt(g.acquired_ms, tf, { zone: true, year: 'auto', refMs: nowMs })
      out.push({ key: 'satellite', swatch: 'satellite', text: fillCopy(FLOOD_FORENSIC.keySatellite, { time, age: fmtRelative(g.acquired_ms, nowMs) }), stale: nowMs - g.acquired_ms > SAT_STALE_MS, notes, more })
      if (flood.has.noView) out.push({ key: 'noview', swatch: 'noview', text: FLOOD_FORENSIC.keySatNoView })
      if (sat?.image) out.push({ key: 'edge', swatch: 'edge', text: FLOOD_FORENSIC.keySatEdge })
    } else out.push({ key: 'satnone', swatch: 'noview', text: reason ?? FLOOD_FORENSIC.keySatNone, notes: uniq([loginShort]).filter((n) => n !== reason), more: more.texts.length ? more : undefined })
  }
  if (on('forecastArea') && flood.has.forecast) {
    const t = st.water_forecast?.time_ms
    out.push({
      key: 'forecast',
      swatch: 'forecast',
      text: t != null ? fillCopy(FLOOD_FORENSIC.keyForecast, { time: fmtAt(t, tf, { zone: true, year: 'auto', refMs: nowMs }) }) : FLOOD_FORENSIC.keyForecastNoTime,
      notes: uniq([st.water_forecast?.reason]),
      more: { title: FLOOD_FORENSIC.keyMoreForecast, texts: [RFC_FIM_NOTE, RFC_FIM_OUTSIDE] },
    })
  }
  // brief 6: the estimated depth surface (its water's own time in the backend's source line), or why none is shown
  if (on('depth') && i.depth && t3) {
    const d = i.depth
    const p = d.product
    const more = p ? { title: FLOOD_3D.keyMoreDepth, texts: uniq([d.from && !d.passKey ? p.source : null, p.caveat, p.method, p.citation]) } : undefined
    // which water it is of, with that water's own time (a playback pass's acquisition time, else the product's)
    const tMs = d.timeMs ?? p?.time_ms ?? null
    const date = tMs != null ? fmtDayDate(tMs, tf.tz, { year: 'auto', refMs: nowMs }) : '—'
    const of = d.from === 'forecast' ? fillCopy(FLOOD_3D.depthOfForecast, { date }) : fillCopy(FLOOD_3D.depthOfSatellite, { date })
    if (d.from && p) out.push({ key: 'depth', swatch: 'depth', text: p.label, notes: [of], more })
    else if (d.note) out.push({ key: 'depth', swatch: 'noview', text: p?.label ?? FLOOD_3D.layerDepth, notes: [d.note], more })
  }
  // brief 6: the height above the river (off by default), its bands and the backend's caveat
  if (on('hand') && t3 && flood.has.hand) {
    const p = t3.hand
    out.push({
      key: 'hand',
      swatch: 'hand',
      text: p.label,
      notes: [`${FLOOD_3D.handBand1} · ${FLOOD_3D.handBand2} · ${FLOOD_3D.handBand3} ${FLOOD_3D.handLegend}`],
      more: { title: FLOOD_3D.keyMoreHand, texts: uniq([p.caveat, p.method, p.source, p.citation]) },
    })
  }
  if (on('warnings') && i.hasWarnings) {
    const caveats = uniq(flood.warnings?.caveats ?? [])
    out.push({ key: 'warning', swatch: 'warning', text: FLOOD_FORENSIC.keyWarning, notes: uniq([st.warnings?.reason]), more: caveats.length ? { title: FLOOD_FORENSIC.keyMoreWarnings, texts: caveats } : undefined })
  }
  // the handle after now: the products shown (lines, dock, hover) are those in effect now (C1; review WFF-R4)
  const shown = flood.warnings?.status === 'available' ? warningsAt(flood.warnings.alerts, i.cursorMs ?? null, nowMs) : null
  const future = shown ? futureProductsNote(shown) : null
  if (future) out.push({ key: 'future', swatch: 'future', text: future, stale: true })
  if (on('floodplain') && flood.has.floodplain) {
    const date = floodplainEffective(flood)
    out.push({
      key: 'floodplain',
      swatch: 'floodplain',
      text: date ? fillCopy(NFHL_LABEL, { date }) : FLOOD_FORENSIC.keyFloodplainNoDate,
      notes: uniq([st.floodplain?.reason]),
      more: { title: FLOOD_FORENSIC.keyMoreFloodplain, texts: [NFHL_NOTE] },
    })
  }
  if (on('catfim') && flood.has.catfim && flood.catfim) {
    const c = flood.catfim
    out.push({
      key: 'catfim',
      swatch: 'catfim',
      text: fillCopy(FLOOD_FORENSIC.keyCatfim, { category: catfimCategoryLabel(c.category) }),
      more: { title: FLOOD_FORENSIC.keyMoreCatfim, texts: [fillCopy(CATFIM_NOTE, { category: catfimCategoryWord(c.category) })] },
    })
  }
  if (on('model') && flood.has.model) {
    const t = st.water_model?.time_ms
    out.push({
      key: 'model',
      swatch: 'model',
      text: t != null ? `${FLOOD_FORENSIC.keyModel} · ${fmtAt(t, tf, { zone: true, year: 'auto', refMs: nowMs })}` : FLOOD_FORENSIC.keyModel,
      notes: uniq([st.water_model?.reason]),
      more: { title: FLOOD_FORENSIC.keyMoreModel, texts: [MODEL_CAVEAT] },
    })
  }
  if (on('gauges') && i.hasGauges) {
    const caveats = uniq(flood.gauges?.caveats ?? [])
    out.push({ key: 'bar', swatch: 'bar', text: FLOOD_FORENSIC.barHeight, more: caveats.length ? { title: FLOOD_FORENSIC.keyMoreGauges, texts: caveats } : undefined })
  }
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

/** A bundle's NWS copy is "fresh" this long after it was saved (the flood live loop appends new versions every 15 min):
 *  then an empty list may say NO_PRODUCT ("right now"); else it names the copy's time (review WFF-R5). */
export const COPY_FRESH_MS = 30 * 60_000

/** The dock's products column when no product is drawn at the handle (D24: only for an available copy; review
 *  WFF-R5): before now, at the handle's time "in the copy saved with the 3D data"; at or after now, NO_PRODUCT only
 *  while the copy is fresh, else the copy's own time. */
export function dockNoProduct(i: { cursorMs: number | null; nowMs: number; savedMs: number | null; tf: TimeFmt }): string {
  const { cursorMs, nowMs, savedMs, tf } = i
  const at = (ms: number) => fmtAt(ms, tf, { zone: true, year: 'auto', refMs: nowMs })
  if (cursorMs != null && Number.isFinite(cursorMs) && cursorMs < nowMs) return fillCopy(FLOOD_FORENSIC.dockNoProductAt, { time: at(cursorMs) })
  if (savedMs != null && nowMs - savedMs <= COPY_FRESH_MS) return NO_PRODUCT
  return fillCopy(FLOOD_FORENSIC.dockNoProductCopy, { time: savedMs != null ? at(savedMs) : '—' })
}

/** The Flood overview card's NWS line (review WFF-R6): from the copy saved with the 3D data (warnings.json), never the
 *  live list: the copy's outage text when it could not be read (D24), else the highest product in effect when the 3D
 *  data was prepared, else the absence sentence. */
export function overviewProduct(resp: FloodAlertsResponse | null, builtMs: number, nowMs: number): { kind: 'unavailable'; text: string } | { kind: 'product'; alert: FloodAlert } | { kind: 'none' } {
  if (!resp || resp.status !== 'available') return { kind: 'unavailable', text: resp?.reason ?? ALERTS_UNAVAILABLE }
  const top = orderAlerts(warningsAt(resp.alerts, Math.min(builtMs, nowMs - 1), nowMs).alerts)[0]
  return top ? { kind: 'product', alert: top } : { kind: 'none' }
}
