// Words of the national map in Floods (brief 5, PLAN-5 §4.3, §5.2): the bar status, the list rows, the leader labels'
// second line, the official block and the "Show details" pill. Pure, tested in floodOverviewText.test.ts. Official
// words only: a flood is named by its NWS product or its gauge's NWS category, never by Fire-3d's own inference, and a
// count is never "0" when a list could not be read.
import type { FloodAlert, FloodAlertsResponse, FloodGaugeRef, FloodListResponse, FloodSummary, GaugeCategory, RiverGauge, RiverGaugesResponse } from '../../api/types'
import { bearingDeg, distanceM } from '../../lib/geodesy'
import { fmtAt, fmtRelative, timeFmt, type Clock } from '../../lib/time'
import { gaugeTone, CATEGORY_COLORS, FLOOD_ALERT, FLOOD_TOKENS } from '../../map/floodStyle'
import { gaugeCategoryRank, highestProduct, listDownReasons, type FloodListHealth } from '../../state/floodOverview'
import type { Units } from '../../state/workspace'
import {
  ALERTS_UNAVAILABLE,
  BAR_STATUS,
  DEMO_TAG,
  FLOOD_GAUGES_DOWN,
  FLOOD_HERE_IN_FIRES,
  FLOOD_LIST_ABSENCE,
  FLOOD_LISTS_DOWN,
  FLOOD_NWS_DOWN,
  FLOOD_OVERVIEW,
  GAUGE_CATEGORY_DISPLAY,
  GAUGE_OTHER_STREAM,
  GAUGES_UNAVAILABLE,
  NO_GAUGE_NEAR,
  NO_PRODUCT,
  fillCopy,
} from '../shell/floodCopy'

const FT_PER_M = 3.28084

/** A stage in the viewer's units: "15.2 ft" / "4.6 m" (null when unknown). Values in another unit are shown as sent. */
export function fmtStage(value: number | null | undefined, unit: string | null | undefined, units: Units): string | null {
  if (value == null || !Number.isFinite(value)) return null
  const u = (unit ?? 'ft').toLowerCase()
  if (units === 'metric' && (u === 'ft' || u === 'feet')) return `${(value / FT_PER_M).toFixed(1)} m`
  return `${value.toFixed(1)} ${u === 'feet' ? 'ft' : u}`
}

/** The place of a gauge from its NWS name: "San Juan River at Shiprock" → "Shiprock" (else the whole name). */
export function gaugePlace(name: string): string {
  const m = /\s(?:at|near|above|below)\s+(.+)$/i.exec(name)
  return (m ? m[1] : name).trim()
}

/** "Minor" for an NWS category (the short label without "(NWS)" and " flooding"). */
export function categoryWord(c: GaugeCategory | null | undefined): string | null {
  if (!c) return null
  const r = gaugeCategoryRank(c)
  if (r < 2) return c === 'action' ? 'Action stage' : null
  return c.charAt(0).toUpperCase() + c.slice(1)
}

/** The primary gauge when it reads at minor or worse (the leader's and the row's gauge part). */
function gaugeInFlood(f: Pick<FloodSummary, 'primary_gauge'>): FloodGaugeRef | null {
  const g = f.primary_gauge
  return g && gaugeCategoryRank(g.observed_category) >= 2 ? g : null
}

/** The leader label's second line (mono capitals): "MAJOR · 24.1 FT" from the primary gauge, else the highest NWS
 *  product ("FLASH FLOOD WARNING", "FLOOD WARNING", "FLOOD ADVISORY", "FLOOD WATCH"), else "GAUGE IN FLOOD". */
export function floodMeta(f: Pick<FloodSummary, 'primary_gauge' | 'products' | 'emergency' | 'level'>, units: Units = 'us'): string {
  const g = gaugeInFlood(f)
  if (g) {
    const v = fmtStage(g.observed_value, g.unit, units)
    return [categoryWord(g.observed_category), v].filter(Boolean).join(' · ').toUpperCase()
  }
  if (f.emergency) return 'FLASH FLOOD EMERGENCY'
  const p = highestProduct(f)
  if (p) return p.event.toUpperCase()
  return f.level === 'gauge_only' ? 'GAUGE IN FLOOD' : 'NWS FLOOD PRODUCT'
}

/** The second line's colour: the gauge category's, else the NWS alert pink (a product name). */
export function floodMetaColor(f: Pick<FloodSummary, 'primary_gauge' | 'products' | 'emergency' | 'level'>): string {
  const g = gaugeInFlood(f)
  return g ? CATEGORY_COLORS[gaugeTone(g.observed_category)] : FLOOD_ALERT
}

/** The centre dot of a flood's marker: its highest category's colour, else near-white (PLAN-5 §4.3). */
export function floodDotColor(f: Pick<FloodSummary, 'max_category'>): string {
  return f.max_category && f.max_category !== 'action' ? CATEGORY_COLORS[f.max_category] : FLOOD_TOKENS['m-flood-ink-2']
}

/** "San Juan Co., NM": the county and state of the flood's point. */
export function floodWhere(f: Pick<FloodSummary, 'county' | 'state' | 'states'>): string | null {
  const st = f.state ?? f.states[0] ?? null
  if (f.county) return `${f.county.replace(/\s+County$/i, '')} Co.${st ? `, ${st}` : ''}`
  return st
}

/** A list row's second line: "San Juan Co., NM · Flood Warning · Minor at Shiprock" (+ " · DEMO" for synthetic data). */
export function floodRowSub(f: FloodSummary): string {
  const p = highestProduct(f)
  const g = gaugeInFlood(f)
  const gauge = g ? `${categoryWord(g.observed_category)} at ${gaugePlace(g.name)}` : null
  return [floodWhere(f), f.emergency ? 'Flash Flood Emergency' : (p?.event ?? null), gauge].filter(Boolean).join(' · ')
}

/** A list row's value (mono, right): the primary gauge's stage, else null. */
export function floodRowValue(f: Pick<FloodSummary, 'primary_gauge'>, units: Units): string | null {
  const g = f.primary_gauge
  return g ? fmtStage(g.observed_value, g.unit, units) : null
}

/** A flood's name on the map and in lists: the DEMO tag on every synthetic one (D17, C26). */
export function floodDisplayName(f: Pick<FloodSummary, 'name' | 'synthetic'>): string {
  return f.synthetic ? `${f.name} · ${DEMO_TAG}` : f.name
}

/** A gauge's map label: "SHRN5 · 15.2 FT · MINOR" (the category always written next to its colour). */
export function gaugeLabel(g: { lid: string; observed_value: number | null; unit: string | null; observed_category: GaugeCategory }, units: Units): string {
  const v = fmtStage(g.observed_value, g.unit, units)
  const d = GAUGE_CATEGORY_DISPLAY[g.observed_category] ?? GAUGE_CATEGORY_DISPLAY.unknown
  return [g.lid, v, d.short.replace(/\s*\(NWS\)$/, '')].filter(Boolean).join(' · ').toUpperCase()
}

export interface FloodCountInput {
  /** Floods the list shows (watches filtered as the switch says), or null when unknown. */
  count: number | null
  loaded: boolean
  loading: boolean
  failed: boolean
  /** NWS and the gauges could not be read (FLOOD LISTS UNAVAILABLE). */
  bothDown: boolean
  /** A year list's archive could not be read (FLOOD LIST UNAVAILABLE; review WFO-R3). */
  archiveDown?: boolean
  /** Watch-only floods hidden by "Show watches" (C27). */
  hiddenWatches: number
  /** A year tab (integration): the count says it is that year's past floods, never "N FLOODS" next to today's date. */
  year?: number | null
}

/** The count part of the bar: "31 FLOODS" (+ " · 3 WATCHES HIDDEN"), or why there is no count (never "0" unknown).
 *  While both live lists are down the bar says FLOOD LISTS UNAVAILABLE even with floods listed from disk, as the fire
 *  bar does (review WFO-R4); a year whose archive could not be read says FLOOD LIST UNAVAILABLE (WFO-R3). */
export function floodCountPart(i: FloodCountInput): { text: string; tone: 'count' | 'quiet' | 'warn' } {
  if (!i.loaded) return i.failed && !i.loading ? { text: BAR_STATUS.listDown, tone: 'warn' } : { text: BAR_STATUS.loading, tone: 'quiet' }
  if (i.bothDown) return { text: BAR_STATUS.listsDown, tone: 'warn' }
  if (i.archiveDown) return { text: BAR_STATUS.listDown, tone: 'warn' }
  if (i.count == null) return { text: BAR_STATUS.listDown, tone: 'warn' }
  const n = i.count
  if (i.year != null) return { text: fillCopy(n === 1 ? BAR_STATUS.pastOne : BAR_STATUS.past, { N: n.toLocaleString('en-US'), YEAR: i.year }), tone: 'count' }
  const watches = i.hiddenWatches > 0 ? (i.hiddenWatches === 1 ? BAR_STATUS.watchesHiddenOne : fillCopy(BAR_STATUS.watchesHidden, { n: i.hiddenWatches })) : ''
  return { text: `${n.toLocaleString('en-US')} FLOOD${n === 1 ? '' : 'S'}${watches}`, tone: 'count' }
}

/** The bar status's tooltip: whose list it is, and that a place without a marker is not an all-clear. */
export const FLOOD_COUNT_TIP = `Floods Fire-3d groups from NWS flood products in effect and river gauges at flood stage, lower 48 states. ${FLOOD_LIST_ABSENCE}`

/** The official block's line: "42 in effect in the lower 48 · checked 2 min ago" (null count: could not be read). */
export function officialProductsLine(n: number | null, checkedMs: number | null, nowMs: number): string {
  if (n == null) return FLOOD_OVERVIEW.officialUnknown
  const age = checkedMs != null ? fmtRelative(checkedMs, nowMs) : 'not yet'
  return fillCopy(n === 1 ? FLOOD_OVERVIEW.officialCountOne : FLOOD_OVERVIEW.officialCount, { n: n.toLocaleString('en-US'), age })
}

/** "12 floods in this view · Show all 31". */
export function floodInViewLine(n: number, total: number): { inView: string; all: string } {
  const inView = n === 1 ? fillCopy(FLOOD_OVERVIEW.inViewOne, { total }) : fillCopy(FLOOD_OVERVIEW.inView, { n: n.toLocaleString('en-US'), total: total.toLocaleString('en-US') })
  const [a, b] = inView.split(' · ')
  return { inView: a, all: b ?? '' }
}

/** The "Show details" pill in Floods: its text and accessible name with the number of listed floods (`unavailable`:
 *  the list could not be read, so no number). */
export function floodDetailsPillLabel(open: boolean, count: number | null, unavailable = false): { text: string; aria: string } {
  const text = open ? 'Hide details' : 'Show details'
  if (count == null) return { text, aria: unavailable ? `${text}: flood list unavailable` : `${text}: flood list loading` }
  const n = `${count.toLocaleString('en-US')} flood${count === 1 ? '' : 's'}`
  return { text, aria: open ? `Hide details (list of ${n})` : `Show details: list of ${n}` }
}

// ------------------------------------------------------------------------------------------------ the point card
/** Gauges and products near a point are checked within this distance (PLAN-5 §4.3: 25 km). */
export const NEAR_GAUGE_KM = 25

export interface FloodPointInput {
  point: { lat: number; lon: number }
  /** /api/official/flood-alerts?bbox=<point>: every NWS flood product at the point, watches included (C27). */
  alerts: FloodAlertsResponse | null
  /** The request itself failed (no answer to read a reason from). */
  alertsFailed: boolean
  /** /api/official/river-gauges?bbox=<point ± 25 km> (riv_gauges envelope; every status). */
  gauges: RiverGaugesResponse | null
  gaugesFailed: boolean
  /** The listed floods (the live list, watches included). */
  floods: readonly FloodSummary[]
}

export interface FloodPointModel {
  /** Every NWS flood product at the point, Emergency first (the backend's order), verbatim. */
  products: FloodAlert[]
  /** NO_PRODUCT only when the alerts answer is available (D24); ALERTS_UNAVAILABLE when it is not; the past-date text
   *  for a past date; null while loading or when products are listed. */
  productsNote: string | null
  /** The nearest gauge at action stage or above within 25 km, with its distance. */
  gauge: { gauge: RiverGauge; distanceM: number; bearingDeg: number } | null
  /** GAUGE_OTHER_STREAM (with the gauge's river), NO_GAUGE_NEAR (available answers only) or GAUGES_UNAVAILABLE. */
  gaugeNote: string | null
  /** The nearest listed floods (at most 3), measured to each flood's point (its primary gauge or polygon point). */
  nearest: { flood: FloodSummary; distanceM: number; bearingDeg: number }[]
}

/** The flood point card's content (pure; FloodPointCard renders it). */
export function floodPointModel(i: FloodPointInput): FloodPointModel {
  const here = { lat: i.point.lat, lon: i.point.lon }
  const a = i.alerts
  const products = a && a.status === 'available' ? a.alerts.filter((x) => x.covers_point !== false) : []
  let productsNote: string | null = null
  if (i.alertsFailed || (a && a.status === 'unavailable')) productsNote = a?.reason || ALERTS_UNAVAILABLE
  else if (a && a.status === 'not_available_for_past_dates') productsNote = a.reason || FLOOD_OVERVIEW.pastAlerts
  else if (a && a.status === 'available' && products.length === 0) productsNote = NO_PRODUCT
  const g = i.gauges
  let gauge: FloodPointModel['gauge'] = null
  if (g && g.status === 'available') {
    for (const x of g.gauges) {
      if (gaugeCategoryRank(x.observed.category) < 1) continue
      const d = distanceM(here, { lat: x.lat, lon: x.lon })
      if (d > NEAR_GAUGE_KM * 1000) continue
      if (!gauge || d < gauge.distanceM) gauge = { gauge: x, distanceM: d, bearingDeg: bearingDeg(here, { lat: x.lat, lon: x.lon }) }
    }
  }
  let gaugeNote: string | null = null
  if (i.gaugesFailed || (g && g.status === 'unavailable')) gaugeNote = g?.reason || GAUGES_UNAVAILABLE
  else if (gauge) gaugeNote = fillCopy(GAUGE_OTHER_STREAM, { river: gauge.gauge.waterbody || gaugePlace(gauge.gauge.name) })
  else if (g && g.status === 'available') gaugeNote = NO_GAUGE_NEAR
  const nearest = i.floods
    .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))
    .map((f) => ({ flood: f, distanceM: distanceM(here, { lat: f.lat, lon: f.lon }), bearingDeg: bearingDeg(here, { lat: f.lat, lon: f.lon }) }))
    .sort((x, y) => x.distanceM - y.distanceM)
    .slice(0, 3)
  return { products, productsNote, gauge, gaugeNote, nearest }
}

/** Fires mode (PLAN-5 §4.3, C27): the fire point card's one flood line, only when the point's flood-alerts answer
 *  lists a product; nothing when it lists none or failed (the fire card makes no flood claim). */
export function floodHereLine(a: FloodAlertsResponse | null): string | null {
  return a && a.status === 'available' && a.alerts.some((x) => x.covers_point !== false) ? FLOOD_HERE_IN_FIRES : null
}

/** The notices a list's sources give (rule 11): NWS down, the gauges down, both down, a year's archive down (its
 *  reason as the backend sent it, else PAST list unavailable; review WFO-R3). Never an all-clear. */
export function floodListNotices(health: FloodListHealth, response: FloodListResponse | null = null): string[] {
  if (health === 'both_down') return [FLOOD_LISTS_DOWN]
  if (health === 'nws_down') return [FLOOD_NWS_DOWN]
  if (health === 'gauges_down') return [FLOOD_GAUGES_DOWN]
  if (health === 'archive_down') {
    const reasons = listDownReasons(response)
    return reasons.length ? reasons : [FLOOD_OVERVIEW.pastListUnavailable]
  }
  return []
}

/** A gauge reading's own time in the gauge's zone with its age: "reading Nov 4, 10:00 AM MST (25 min ago)"
 *  (review WFO-R7); "reading time not given" when NWS sent none. */
export function gaugeReadingLine(observedMs: number | null, zone: string | null, clock: Clock, nowMs: number): string {
  if (observedMs == null || !Number.isFinite(observedMs)) return FLOOD_OVERVIEW.gaugeNoReadingTime
  const tf = timeFmt(zone, clock)
  return fillCopy(FLOOD_OVERVIEW.gaugeReading, { time: fmtAt(observedMs, tf, { zone: true, year: 'auto', refMs: nowMs }), age: fmtRelative(observedMs, nowMs) })
}
