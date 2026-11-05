// The Public flood view's words and figures (brief 5, FloodView.dc.html; PLAN-5 §4.4, §5; D5, D8, D10, D11, D19,
// D24, C1, C4, C7, C15, C16). Pure and tested (floodView.test.ts); the components in this folder only draw them.
//   title          the place ("San Juan County, New Mexico") and "NOV 2 2026 — PRESENT" / "SEEN BY FIRE-3D SINCE …" /
//                  "NOV 2 2026 — LAST NWS PRODUCT NOV 5 2026" (never "ENDED")
//   hazard circle  the NWS product as the status ("FLOOD · WARNING", never ACTIVE / ENDED / OVER / CLEAR), the short
//                  name ("San Juan"), one meaning sentence per status that names the issuer
//   facts          seven "value — LABEL" rows per kind (river / flash and areal / watch only), from official answers and
//                  member gauges only, each with its issuer, own time and link; quiet rows say why and are never an
//                  all-clear; "none" sentences only for answers that are `available` (D24)
//   key            one item per layer drawn, each with its own source and time; ages computed now (C16)
//   distance chip  to the NWS warning area's edge, else the NWS forecast flooded area, else the primary member gauge
import type { FloodMapResponse, FloodProductRef, FloodSummary, RiverGauge, SatelliteWaterResponse } from '../../api/types'
import { distanceToAreas, type AreaDistance } from '../../lib/areaDistance'
import { bearingDeg, distanceM } from '../../lib/geodesy'
import { directionWord, distance } from '../../lib/plainLanguage'
import { fmtAt, fmtClock, fmtDayDate, fmtRelative, HOUR_MS, DAY_MS, MONTHS, timeFmt, wallParts, type TimeFmt } from '../../lib/time'
import { stateName } from '../../lib/usStates'
import { answerReason, officialState, fimMapped, floodEvacuation, leadAlert, mainAlert, memberGaugesOf, orderAlerts, primaryMemberGauge, rfcName, senderName, shownGranule, type Answer, type FloodEvacFact } from '../../official/floodModel'
import { gaugeCategoryRank, highestProduct } from '../../state/floodOverview'
import type { Units } from '../../state/workspace'
import type { EvacuationsResponse } from '../../extras/types'
import type { FloodAlertsResponse, RiverGaugesResponse } from '../../api/types'
import {
  ALERTS_UNAVAILABLE,
  CIRCLE_MEANING,
  CIRCLE_MEANING_UPCOMING,
  CIRCLE_MEANING_WATCH_TAIL,
  CIRCLE_STATUS,
  CREST_LINE,
  DATE_LINE,
  DISTANCE_CHIP_LINES,
  FLOOD_PUBLIC,
  FORECAST_HIGH_LABEL,
  FORECAST_HIGH_LINE,
  GAUGE_BELOW_STAGE,
  GAUGE_BELOW_STAGE_SUB,
  GAUGE_CATEGORY_DISPLAY,
  GAUGE_NOT_CURRENT,
  GAUGE_OUT_OF_SERVICE,
  GAUGE_PROVISIONAL,
  GAUGES_UNAVAILABLE,
  NFHL_LABEL,
  NO_MEMBER_GAUGE,
  NO_MEMBER_GAUGE_SUB,
  NO_PRODUCT,
  NO_RFC_FORECAST,
  NOT_STATED_NWS,
  PAST_NO_FORECAST,
  RFC_FIM_MAPPED,
  RFC_FIM_MAPPED_SUB,
  RFC_FIM_NONE,
  RFC_FIM_OUTSIDE,
  RFC_FIM_UNAVAILABLE,
  SAT_EDGE,
  SAT_LABEL,
  SAT_NO_VIEW_KEY,
  SAT_NOT_SET_UP_SHORT,
  SAT_PICTURE_ONLY,
  fillCopy,
} from '../shell/floodCopy'
import { fmtStage, gaugePlace } from './floodOverviewText'
import type { DistanceChipText } from './fireView'

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const join = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ') || null
const https = (u: string | null | undefined) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null)

/** "NOV 2 2026" in `tz`. */
export function upperDay(ms: number, tz: string): string {
  const p = wallParts(ms, tz)
  return `${MONTHS[p.month - 1].toUpperCase()} ${p.day} ${p.year}`
}

/** A past flood (a year list) or one with no NWS product and no gauge in flood now (live, kept 48 h). */
export function isPastFlood(s: Pick<FloodSummary, 'mode'>): boolean {
  return s.mode === 'historical'
}

// ------------------------------------------------------------------------------------------------ title
/** "San Juan County, New Mexico": the county and state of the flood's point (else the state, else the name). */
export function floodPlace(s: Pick<FloodSummary, 'county' | 'state' | 'states' | 'name'> | null): string | null {
  if (!s) return null
  const code = s.state ?? s.states[0] ?? null
  const state = code ? (stateName(code) ?? code) : null
  const county = s.county?.trim()
  if (county) return state ? `${county}, ${state}` : county
  return state ?? s.name
}

/** The date line (PLAN-5 §5.2), never "ENDED": a past or quiet flood ends with its last NWS product's day. */
export function floodDateLine(s: Pick<FloodSummary, 'started_ms' | 'started_basis' | 'mode' | 'status' | 'last_product_ms'> | null, tz: string): string | null {
  if (!s || !num(s.started_ms)) return null
  const start = upperDay(s.started_ms, tz)
  if (isPastFlood(s) || s.status === 'inactive') {
    if (!num(s.last_product_ms)) return start
    // "{MON D YYYY} — LAST NWS PRODUCT {MON D YYYY}": the start, then the last product's day
    const [a, b, c] = DATE_LINE.past.split('{MON D YYYY}')
    return `${a}${start}${b}${upperDay(s.last_product_ms, tz)}${c}`
  }
  if (s.started_basis === 'first_seen') return fillCopy(DATE_LINE.seenSince, { 'MON D YYYY': start })
  return fillCopy(DATE_LINE.present, { 'MON D YYYY': start })
}

// ------------------------------------------------------------------------------------------------ hazard circle
/** The circle's short name: "San Juan River flood" → "San Juan", "Clarks flash flood" → "Clarks", "Flood watch:
 *  Example County and 2 more areas" → "Example County"; a " (NM)" suffix goes too. The full name stays the button's
 *  accessible name and tooltip. */
export function floodShortName(name: string): string {
  let n = name.trim().replace(/\s+\([A-Z]{2}\)$/, '')
  const watch = /^flood watch:\s*(.+?)(?:\s+and\s+\d+\s+more\s+areas?)?$/i.exec(n)
  if (watch) return watch[1].trim()
  n = n.replace(/\s+(flash\s+)?flood$/i, '')
  n = n.replace(/\s+River$/i, '')
  return n.trim() || name.trim()
}

export type FloodCircleKind = 'emergency' | 'flashWarning' | 'warning' | 'advisory' | 'watch' | 'gaugeOnly' | 'noProductNow' | 'past' | 'demo'

export interface FloodCircleStatus {
  kind: FloodCircleKind
  /** "FLOOD · WARNING" */
  line: string
  tone: 'active' | 'quiet' | 'demo'
  /** The hidden meaning line, naming the issuer (C15). */
  meaning: string
  /** Keep the rain on a quiet tone (a watch). */
  rain: boolean
}

const WATCH_EVENTS = new Set(['Flood Watch', 'Flash Flood Watch'])

/** The circle's status from the NWS product only (D19): the highest product in effect (Emergency first), else the
 *  gauge in flood, else "no NWS warning now"; past floods and simulated data say so. One meaning per status. */
export function floodCircleStatus(s: FloodSummary | null, tf: TimeFmt, nowMs: number): FloodCircleStatus {
  if (!s) return { kind: 'noProductNow', line: 'FLOOD', tone: 'quiet', meaning: FLOOD_PUBLIC.loadingFlood, rain: false }
  if (s.synthetic) return { kind: 'demo', line: CIRCLE_STATUS.demo, tone: 'demo', meaning: CIRCLE_MEANING.demo, rain: true }
  if (isPastFlood(s)) {
    const last = s.last_product_ms ?? s.ended_ms ?? s.updated_ms ?? s.started_ms
    return {
      kind: 'past',
      line: fillCopy(CIRCLE_STATUS.past, { 'MON D YYYY': upperDay(s.started_ms, tf.tz) }),
      tone: 'quiet',
      meaning: fillCopy(CIRCLE_MEANING.past, { date: fmtDayDate(last, tf.tz, { year: 'always' }) }),
      rain: false,
    }
  }
  const p = highestProduct(s)
  // no NWS product in effect and no member gauge at flood stage in the last 6 hours (the live list keeps it 48 h)
  if (s.status === 'inactive' || (!p && s.level !== 'gauge_only' && s.gauges_in_flood <= 0))
    return { kind: 'noProductNow', line: CIRCLE_STATUS.noProductNow, tone: 'quiet', meaning: CIRCLE_MEANING.noProductNow, rain: false }
  if (!p) return { kind: 'gaugeOnly', line: CIRCLE_STATUS.gaugeOnly, tone: 'active', meaning: CIRCLE_MEANING.gaugeOnly, rain: true }
  const kind: FloodCircleKind =
    p.emergency || s.emergency
      ? 'emergency'
      : p.event === 'Flash Flood Warning'
        ? 'flashWarning'
        : p.event === 'Flood Warning'
          ? 'warning'
          : p.event === 'Flood Advisory'
            ? 'advisory'
            : WATCH_EVENTS.has(p.event)
              ? 'watch'
              : s.kind === 'flash'
                ? 'flashWarning'
                : s.level === 'advisory'
                  ? 'advisory'
                  : 'warning'
  const line = CIRCLE_STATUS[kind as 'emergency' | 'flashWarning' | 'warning' | 'advisory' | 'watch']
  return { kind, line, tone: kind === 'watch' ? 'quiet' : 'active', meaning: productMeaning(p, kind, tf, nowMs), rain: true }
}

function productMeaning(p: FloodProductRef, kind: FloodCircleKind, tf: TimeFmt, nowMs: number): string {
  const sender = senderName(p.sender_name)
  const event = p.emergency ? `${p.event} (${FLOOD_PUBLIC.flashEmergency})` : p.event
  if (p.phase === 'upcoming' && num(p.onset_ms)) {
    const up = fillCopy(CIRCLE_MEANING_UPCOMING, { Sender: sender, event, time: fmtAt(p.onset_ms, tf, { zone: true, year: 'auto', refMs: nowMs }) })
    return kind === 'watch' ? `${up} ${CIRCLE_MEANING_WATCH_TAIL}` : up
  }
  const template = kind === 'watch' ? CIRCLE_MEANING.watch : CIRCLE_MEANING.product
  const filled = fillCopy(template, { Sender: sender, event, time: num(p.ends_ms) ? fmtAt(p.ends_ms, tf, { zone: true, year: 'auto', refMs: nowMs }) : '' })
  // no end time given: the sentence without "until"
  return num(p.ends_ms) ? filled : filled.replace(/ until (?=[.:])/, '')
}

// ------------------------------------------------------------------------------------------------ facts
export type FloodFactKey = 'fim' | 'stage' | 'crest' | 'detection' | 'damage' | 'gauges' | 'watchArea' | 'riverForecast' | 'started' | 'product' | 'evac' | 'local' | 'updated'

export interface FloodFactRow {
  key: FloodFactKey
  value: string
  unit?: string
  /** "River stage (USGS)" (upper-cased by the row's style). */
  label: string
  /** 26 for figures, 22 for dates, 17 for words. */
  size: 26 | 22 | 17
  tone?: 'alert' | 'stale'
  /** The value is an issuer's own words (rendered inside data-verbatim). */
  verbatim?: boolean
  /** An issuer's own words opening the sub-line (rendered inside data-verbatim). */
  subVerbatim?: string | null
  /** The source, its own time and what a quiet answer means. */
  sub?: string | null
  link?: { url: string; label: string } | null
  /** More about the row (the gauge's full name and its data attribution): the sub-line's tooltip. */
  tip?: string | null
}

export interface FloodFactsInput {
  summary: FloodSummary | null
  alerts: Answer<FloodAlertsResponse>
  gauges: Answer<RiverGaugesResponse>
  fim: Answer<FloodMapResponse>
  evac: Answer<EvacuationsResponse>
  /** The local officials' line while one is in effect (officialSummary.localAlertsLine), else null. */
  local?: { text: string; link?: { url: string; label: string } | null } | null
  /** The flood's own zone and the clock. */
  tf: TimeFmt
  nowMs: number
  units: Units
}

/** A gauge's reading time in its own zone with its age: "Nov 4, 10:00 AM MST (25 min ago)" (the row's label says it is
 *  the river stage; `long` adds "reading"). */
function readingText(ms: number | null | undefined, tz: string | null | undefined, tf: TimeFmt, nowMs: number, long = false): string | null {
  if (!num(ms)) return null
  const gtf = timeFmt(tz || tf.tz, tf.clock)
  return fillCopy(long ? FLOOD_PUBLIC.reading : FLOOD_PUBLIC.readingShort, { time: fmtAt(ms, gtf, { zone: true, year: 'auto', refMs: nowMs }), age: fmtRelative(ms, nowMs) })
}

/** The stage row of a member gauge (river kind row 2; flash / watch "River gauges"). Never a nearby gauge (C4). */
function gaugeRow(key: 'stage' | 'gauges', label: string, g: RiverGauge, i: FloodFactsInput): FloodFactRow {
  const cat = g.observed.category
  const d = GAUGE_CATEGORY_DISPLAY[cat] ?? GAUGE_CATEGORY_DISPLAY.unknown
  const reading = readingText(g.observed.valid_ms, g.time_zone, i.tf, i.nowMs)
  const attribution = g.data_attribution.map((a) => a.text).filter(Boolean)[0] ?? null
  const link = https(g.url) ? { url: g.url, label: FLOOD_PUBLIC.gaugePageLink } : null
  const where = `at ${gaugePlace(g.name)}`
  const tip = join([g.name, attribution, GAUGE_PROVISIONAL])
  if (cat === 'out_of_service' || !num(g.observed.value))
    return { key, label, value: FLOOD_PUBLIC.noReading, size: 17, sub: join([cat === 'out_of_service' ? GAUGE_OUT_OF_SERVICE : d.short, where]), link, tip }
  const v = fmtStage(g.observed.value, g.observed.unit, i.units) ?? ''
  const cut = v.lastIndexOf(' ')
  const value = cut > 0 ? v.slice(0, cut) : v
  const unit = cut > 0 ? v.slice(cut + 1) : undefined
  let what: string
  if (cat === 'no_flooding') what = `${GAUGE_BELOW_STAGE}. ${GAUGE_BELOW_STAGE_SUB}`
  else if (cat === 'obs_not_current') what = fillCopy(GAUGE_NOT_CURRENT, { time: num(g.observed.valid_ms) ? fmtAt(g.observed.valid_ms, timeFmt(g.time_zone || i.tf.tz, i.tf.clock), { zone: true, year: 'auto', refMs: i.nowMs }) : '—' })
  else what = d.short
  const stale = cat === 'obs_not_current' || (num(g.observed.valid_ms) && i.nowMs - g.observed.valid_ms > 3 * HOUR_MS)
  return {
    key,
    label,
    value,
    unit,
    size: 26,
    tone: stale ? 'stale' : gaugeCategoryRank(cat) >= 2 ? 'alert' : undefined,
    sub: join([what, cat === 'obs_not_current' ? null : reading]),
    link,
    tip,
  }
}

/** The forecast row (river row 3, watch row 3): FORECAST CREST, or FORECAST HIGH when the highest forecast value is at
 *  the last forecast step (C7); NO_RFC_FORECAST when the gauge is not a forecast point. */
function forecastRow(key: 'crest' | 'riverForecast', g: RiverGauge | null, i: FloodFactsInput, label: string = FLOOD_PUBLIC.labelCrest): FloodFactRow {
  if (i.summary && isPastFlood(i.summary)) return { key, label, value: FLOOD_PUBLIC.pastDates, size: 17, sub: PAST_NO_FORECAST }
  const f = g?.forecast ?? null
  if (!g || !g.is_forecast_point || !f || !num(f.max_value)) return { key, label, value: NO_RFC_FORECAST, size: 17, sub: g ? g.name : null }
  const gtf = timeFmt(g.time_zone || i.tf.tz, i.tf.clock)
  const v = fmtStage(f.max_value, g.observed.unit ?? g.thresholds?.unit ?? 'ft', i.units) ?? ''
  const cut = v.lastIndexOf(' ')
  const value = cut > 0 ? v.slice(0, cut) : v
  const unit = cut > 0 ? v.slice(cut + 1) : ''
  const day = num(f.max_ms) ? fmtAt(f.max_ms, gtf, { zone: true, weekday: true, year: 'auto', refMs: i.nowMs }) : '—'
  const issued = num(f.issued_ms) ? fmtAt(f.issued_ms, gtf, { zone: true, year: 'auto', refMs: i.nowMs }) : '—'
  const slots = { value, unit, 'day time zone': day, 'RFC name': rfcName(f), time: issued }
  const cat = f.category ? (GAUGE_CATEGORY_DISPLAY[f.category] ?? GAUGE_CATEGORY_DISPLAY.unknown).short : null
  const link = https(f.url) ?? https(g.url)
  return {
    key,
    label: f.crest_at_end ? FORECAST_HIGH_LABEL : label,
    value,
    unit,
    size: 26,
    sub: f.crest_at_end ? fillCopy(FORECAST_HIGH_LINE, slots) : fillCopy(CREST_LINE, slots),
    link: link ? { url: link, label: FLOOD_PUBLIC.forecastLink } : null,
    tip: join([g.name, cat ? `NWS forecast category: ${cat}` : null]),
  }
}

/** The member gauge with the highest NWS forecast category (watch row 3), else the primary member gauge. */
function highestForecastGauge(members: RiverGauge[]): RiverGauge | null {
  const points = members.filter((g) => g.is_forecast_point && g.forecast && num(g.forecast.max_value))
  return points.sort((a, b) => gaugeCategoryRank(b.forecast?.category) - gaugeCategoryRank(a.forecast?.category))[0] ?? null
}

function quietRow(key: FloodFactKey, label: string, state: ReturnType<typeof officialState>, unavailableText: string, reason: string | null): FloodFactRow | null {
  if (state === 'loading' || state === 'none') return { key, label, value: FLOOD_PUBLIC.checking, size: 17 }
  if (state === 'unavailable') return { key, label, value: FLOOD_PUBLIC.unavailable, size: 17, sub: unavailableText }
  if (state === 'past') return { key, label, value: FLOOD_PUBLIC.pastDates, size: 17, sub: reason }
  return null
}

function memberGaugeRows(i: FloodFactsInput, key: 'gauges', label: string): FloodFactRow {
  const st = officialState(i.gauges)
  const q = quietRow(key, label, st, GAUGES_UNAVAILABLE, answerReason(i.gauges))
  if (q) return q
  const g = primaryMemberGauge(i.gauges.data, i.summary)
  if (!g) return { key, label, value: NO_MEMBER_GAUGE, size: 17, sub: NO_MEMBER_GAUGE_SUB }
  return gaugeRow(key, label, g, i)
}

/** The NWS product row (row 5): the highest product in effect, its own times and sender, verbatim event name. */
function productRow(i: FloodFactsInput): FloodFactRow {
  const s = i.summary
  const past = s != null && isPastFlood(s)
  // a past flood: its own last products (they were in effect then; "Was in effect" with the date)
  const p = s ? (highestProduct(s) ?? (past ? (orderAlerts(s.products)[0] ?? null) : null)) : null
  const alert = past ? mainAlert(i.alerts.data, i.nowMs) : leadAlert(i.alerts.data, i.nowMs)
  if (!p && !alert) {
    const st = officialState(i.alerts)
    const q = quietRow('product', FLOOD_PUBLIC.labelNoProduct, st, ALERTS_UNAVAILABLE, answerReason(i.alerts))
    if (q) return q
    // the alerts answered: no NWS flood product in effect for this flood (D24: only for an available answer)
    return { key: 'product', label: FLOOD_PUBLIC.labelNoProduct, value: FLOOD_PUBLIC.noneInEffect, size: 17, sub: join([NO_PRODUCT, s?.caveat ?? null]) }
  }
  const event = alert?.event ?? p!.event
  const emergency = alert?.emergency ?? p!.emergency
  const tz = alert?.time_zone || i.tf.tz
  const tf = timeFmt(tz, i.tf.clock)
  const end = alert ? (alert.ends_ms ?? alert.expires_ms) : p!.ends_ms
  const sent = alert?.sent_ms ?? p!.sent_ms
  const phase = alert?.phase ?? p!.phase
  const url = https(alert?.url) ?? https(p?.url)
  const asOf = past && num(s?.last_product_ms) ? `as of ${fmtDayDate(s!.last_product_ms, tz, { year: 'always' })}` : null
  return {
    key: 'product',
    label: fillCopy(FLOOD_PUBLIC.labelProduct, { event }),
    value: past ? 'Was in effect' : phase === 'upcoming' ? FLOOD_PUBLIC.startingSoon : FLOOD_PUBLIC.inEffect,
    size: 17,
    tone: 'alert',
    sub: join([
      asOf,
      emergency ? FLOOD_PUBLIC.flashEmergency : null,
      num(end) ? fillCopy(FLOOD_PUBLIC.until, { time: fmtAt(end, tf, { zone: true, year: 'auto', refMs: i.nowMs }) }) : null,
      senderName(alert?.sender_name ?? p!.sender_name),
      (alert?.archived ?? p?.archived) ? 'archived copy' : null,
    ]),
    link: url ? { url, label: FLOOD_PUBLIC.nwsAlertLink } : null,
    tip: num(sent) ? fillCopy(FLOOD_PUBLIC.sent, { time: fmtAt(sent, tf, { zone: true, year: 'auto', refMs: i.nowMs }) }) : null,
  }
}

function evacRow(i: FloodFactsInput): FloodFactRow {
  const e: FloodEvacFact = floodEvacuation(i.evac, i.tf, i.nowMs)
  return { key: 'evac', label: FLOOD_PUBLIC.labelEvacuations, value: e.value, size: 17, tone: e.tone, verbatim: e.verbatim, subVerbatim: e.subVerbatim, sub: e.sub, link: e.link }
}

/** The facts rows per kind (PLAN-5 §4.4 table; C4, C6, C7): rows 1-3 by kind, then the start, the highest NWS product,
 *  evacuations, local officials' alerts (only while one is in effect, as the fire view) and the last official update.
 *  Member gauges only; no area number (D5); no satellite or model figure. */
export function floodFacts(i: FloodFactsInput): FloodFactRow[] {
  const s = i.summary
  const rows: FloodFactRow[] = []
  const members = memberGaugesOf(i.gauges.data)
  const primary = primaryMemberGauge(i.gauges.data, s)
  const watchOnly = s?.level === 'watch'
  const alert = mainAlert(i.alerts.data, i.nowMs)
  if (watchOnly) {
    // WATCH AREA (NWS): the watch's own area words, verbatim (first two areas, "and N more")
    const st = officialState(i.alerts)
    const q = quietRow('watchArea', FLOOD_PUBLIC.labelWatchArea, st, ALERTS_UNAVAILABLE, answerReason(i.alerts))
    const area = alert?.area_desc ?? null
    rows.push(q && !area ? q : { key: 'watchArea', label: FLOOD_PUBLIC.labelWatchArea, value: area ? shortAreas(area) : NOT_STATED_NWS, verbatim: area != null, size: 17, sub: area ? senderName(alert?.sender_name) : null })
    rows.push(memberGaugeRows(i, 'gauges', FLOOD_PUBLIC.labelGauges))
    const gq = quietRow('riverForecast', FLOOD_PUBLIC.labelRiverForecast, officialState(i.gauges), GAUGES_UNAVAILABLE, answerReason(i.gauges))
    rows.push(gq ?? forecastRow('riverForecast', highestForecastGauge(members), i, FLOOD_PUBLIC.labelRiverForecast))
  } else if (s?.kind === 'flash' || s?.kind === 'areal') {
    const st = officialState(i.alerts)
    const flashAlert = alert
    const q1 = quietRow('detection', FLOOD_PUBLIC.labelDetection, st, ALERTS_UNAVAILABLE, answerReason(i.alerts))
    const detection = flashAlert?.detection?.trim() || null
    rows.push(q1 && !detection ? q1 : { key: 'detection', label: FLOOD_PUBLIC.labelDetection, value: detection ?? NOT_STATED_NWS, verbatim: detection != null, size: 17, sub: detection ? senderName(flashAlert?.sender_name) : null })
    const damage = flashAlert?.damage_threat?.trim() || highestProduct(s)?.damage_threat?.trim() || null
    const emergency = flashAlert?.emergency ?? s.emergency
    const q2 = quietRow('damage', FLOOD_PUBLIC.labelDamage, st, ALERTS_UNAVAILABLE, answerReason(i.alerts))
    rows.push(
      q2 && !damage
        ? q2
        : {
            key: 'damage',
            label: FLOOD_PUBLIC.labelDamage,
            value: damage ?? NOT_STATED_NWS,
            verbatim: damage != null,
            size: 17,
            tone: damage || emergency ? 'alert' : undefined,
            sub: join([emergency ? FLOOD_PUBLIC.flashEmergency : null, damage ? senderName(flashAlert?.sender_name ?? highestProduct(s)?.sender_name) : null]),
          },
    )
    rows.push(memberGaugeRows(i, 'gauges', FLOOD_PUBLIC.labelGauges))
  } else {
    // river: the NWS forecast flooded area (Mapped / Not mapped here, never a number; D5), stage, crest
    const st = officialState(i.fim)
    const q = quietRow('fim', FLOOD_PUBLIC.labelFim, st, RFC_FIM_UNAVAILABLE, answerReason(i.fim))
    if (q) rows.push(st === 'unavailable' ? { ...q, sub: answerReason(i.fim) ?? RFC_FIM_UNAVAILABLE } : q)
    else if (fimMapped(i.fim.data)) {
      const ref = i.fim.data!.reference_ms ?? i.fim.data!.updated_ms
      rows.push({
        key: 'fim',
        label: FLOOD_PUBLIC.labelFim,
        value: RFC_FIM_MAPPED,
        size: 17,
        sub: fillCopy(RFC_FIM_MAPPED_SUB, { time: num(ref) ? fmtAt(ref, i.tf, { zone: true, year: 'auto', refMs: i.nowMs }) : '—' }),
      })
    } else rows.push({ key: 'fim', label: FLOOD_PUBLIC.labelFim, value: RFC_FIM_NONE, size: 17, sub: i.fim.data?.outside_note ?? RFC_FIM_OUTSIDE })
    const gs = officialState(i.gauges)
    const gq = quietRow('stage', FLOOD_PUBLIC.labelStage, gs, GAUGES_UNAVAILABLE, answerReason(i.gauges))
    if (gq) {
      // while the gauges load, the list's own reading of the primary gauge (the same NWS data, with its own time)
      const pg = s?.primary_gauge
      if (gs === 'loading' && pg && num(pg.observed_value)) {
        const v = fmtStage(pg.observed_value, pg.unit, i.units) ?? ''
        const cut = v.lastIndexOf(' ')
        rows.push({
          key: 'stage',
          label: FLOOD_PUBLIC.labelStage,
          value: cut > 0 ? v.slice(0, cut) : v,
          unit: cut > 0 ? v.slice(cut + 1) : undefined,
          size: 26,
          sub: join([(GAUGE_CATEGORY_DISPLAY[pg.observed_category] ?? GAUGE_CATEGORY_DISPLAY.unknown).short, `at ${gaugePlace(pg.name)}`, readingText(pg.observed_ms, s?.time_zone, i.tf, i.nowMs)]),
          tip: pg.name,
          link: https(pg.url) ? { url: pg.url, label: FLOOD_PUBLIC.gaugePageLink } : null,
        })
      } else rows.push(gq)
      rows.push({ ...gq, key: 'crest', label: FLOOD_PUBLIC.labelCrest })
    } else if (!primary) {
      rows.push({ key: 'stage', label: FLOOD_PUBLIC.labelStage, value: NO_MEMBER_GAUGE, size: 17, sub: NO_MEMBER_GAUGE_SUB })
      rows.push(forecastRow('crest', null, i))
    } else {
      rows.push(gaugeRow('stage', FLOOD_PUBLIC.labelStage, primary, i))
      rows.push(forecastRow('crest', primary, i))
    }
  }
  // row 4: the start (its basis said: NWS product, a gauge's first reading at flood stage, or Fire-3d's first sight)
  if (s && num(s.started_ms)) {
    const seen = s.started_basis === 'first_seen'
    rows.push({
      key: 'started',
      label: seen ? FLOOD_PUBLIC.labelSeenSince : FLOOD_PUBLIC.labelStarted,
      value: fmtDayDate(s.started_ms, i.tf.tz, { year: 'auto', refMs: i.nowMs }),
      unit: fmtClock(s.started_ms, i.tf, { zone: true }),
      size: 26,
      // the label says Fire-3d's first sight; what else started it (an NWS product, a gauge's first reading at flood
      // stage) is the row's tooltip
      tip: seen ? FLOOD_PUBLIC.startedFirstSeen : s.started_basis === 'gauge' ? FLOOD_PUBLIC.startedGauge : FLOOD_PUBLIC.startedNws,
    })
  }
  rows.push(productRow(i))
  rows.push(evacRow(i))
  if (i.local) rows.push({ key: 'local', label: FLOOD_PUBLIC.labelLocal, value: FLOOD_PUBLIC.inEffect, size: 17, tone: 'alert', sub: i.local.text, link: i.local.link ?? null })
  const updated = s?.updated_ms ?? null
  if (num(updated))
    rows.push({
      key: 'updated',
      label: FLOOD_PUBLIC.labelUpdated,
      value: fmtDayDate(updated, i.tf.tz, { year: 'auto', refMs: i.nowMs }),
      unit: fmtClock(updated, i.tf, { zone: true }),
      size: 26,
      tip: FLOOD_PUBLIC.updatedWhat,
    })
  else rows.push({ key: 'updated', label: FLOOD_PUBLIC.labelUpdated, value: FLOOD_PUBLIC.noUpdateTime, size: 17 })
  return rows
}

/** "San Juan, NM; Rio Arriba, NM; McKinley, NM" → "San Juan, NM; Rio Arriba, NM and 1 more" (NWS's words kept). */
export function shortAreas(areaDesc: string): string {
  const parts = areaDesc
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length <= 2) return parts.join('; ')
  const head = parts.slice(0, 2).join('; ')
  const n = parts.length - 2
  return n === 1 ? fillCopy(FLOOD_PUBLIC.andMoreOne, { areas: head }) : fillCopy(FLOOD_PUBLIC.andMore, { areas: head, n })
}

/** The facts' foot: OFFICIAL (or DEMO) and "NWS · USGS · checked 2 min ago". */
export function floodFactsSource(i: Pick<FloodFactsInput, 'summary' | 'alerts' | 'gauges' | 'nowMs'>): { badge: 'official' | 'demo' | null; line: string } {
  if (i.summary?.synthetic) return { badge: 'demo', line: FLOOD_PUBLIC.demoLine }
  const checks = [i.alerts.data?.retrieved_ms, i.gauges.data?.retrieved_ms].filter(num)
  const latest = checks.length ? Math.max(...checks) : null
  return { badge: 'official', line: latest != null ? fillCopy(FLOOD_PUBLIC.sourcesLine, { age: fmtRelative(latest, i.nowMs) }) : FLOOD_PUBLIC.sourcesLineNoCheck }
}

// ------------------------------------------------------------------------------------------------ key
export interface FloodKeyItem {
  key: 'satellite' | 'noView' | 'edge' | 'forecast' | 'channel' | 'warning' | 'floodplain' | 'picture' | 'satNone'
  /** The swatch class (styles/view-flood-public.css .ffk-sw-*). */
  swatch: string | null
  text: string
  /** The layer's own time ("Oct 31, 4:06 PM MDT"). */
  time?: string | null
  /** Its age, computed now (C16). */
  age?: string | null
  /** Older than 3 days (satellite): amber. */
  stale?: boolean
  tip?: string | null
  off?: boolean
}

export const SAT_STALE_MS = 3 * DAY_MS

export interface FloodKeyInput {
  satellite: SatelliteWaterResponse | null
  fim: FloodMapResponse | null
  /** Any NWS product with an area in the answer. */
  warnings: boolean
  layers: { satellite: boolean; forecastArea: boolean; warnings: boolean; channel: boolean; floodplain: boolean }
  nfhl: FloodMapResponse | null
  tf: TimeFmt
  nowMs: number
  /** NASA's picture (GIBS) is drawn on the map (map/floodAreaLayers.ts DRAW_SAT_PICTURE). */
  pictureDrawn?: boolean
}

/** "May 3" or "May 3–Jun 1, 2024" for FEMA's effective dates (C19). */
export function nfhlEffective(r: Pick<FloodMapResponse, 'effective_min_ms' | 'effective_max_ms'> | null, tz: string): string | null {
  const a = r?.effective_min_ms ?? null
  const b = r?.effective_max_ms ?? null
  if (!num(a) && !num(b)) return null
  if (num(a) && num(b) && fmtDayDate(a, tz, { year: 'always' }) !== fmtDayDate(b, tz, { year: 'always' })) return `${fmtDayDate(a, tz, { year: 'always' })}–${fmtDayDate(b, tz, { year: 'always' })}`
  return fmtDayDate((num(a) ? a : b) as number, tz, { year: 'always' })
}

/** The key's items: one per layer drawn, each with its own source and time (D8); the satellite's age now (C16). */
export function floodKeyItems(i: FloodKeyInput): FloodKeyItem[] {
  const out: FloodKeyItem[] = []
  const sat = i.satellite
  const g = shownGranule(sat)
  if (i.layers.satellite && sat && sat.status === 'available') {
    if (sat.measured && g) {
      const time = fmtAt(g.acquired_ms, i.tf, { zone: true, year: 'auto', refMs: i.nowMs })
      const age = fmtRelative(g.acquired_ms, i.nowMs)
      out.push({
        key: 'satellite',
        swatch: 'sat',
        text: fillCopy(SAT_LABEL, { 'date, time': time, age }).replace(/ · .*$/, ''),
        time,
        age,
        stale: i.nowMs - g.acquired_ms > SAT_STALE_MS,
        tip: sat.caveats[0] ?? null,
      })
      const st = sat.stats
      if (!st || st.cloud_pct > 0 || st.nodata_pct > 0) out.push({ key: 'noView', swatch: 'noview', text: SAT_NO_VIEW_KEY })
      if (sat.image) out.push({ key: 'edge', swatch: 'edge', text: SAT_EDGE })
    } else if (sat.tiles && i.pictureDrawn) {
      out.push({ key: 'picture', swatch: 'sat', text: fillCopy(SAT_PICTURE_ONLY, { date: sat.tiles.date }), tip: sat.caveats[0] ?? null })
    } else if (sat.reason || sat.tiles) {
      // NASA has no usable image of the area: said, never left blank (the backend's reason in the tooltip)
      out.push({ key: 'satNone', swatch: null, text: FLOOD_PUBLIC.keySatNone, tip: sat.reason ?? sat.caveats[0] ?? null })
    }
  } else if (i.layers.satellite && sat && sat.status !== 'available' && sat.reason) {
    out.push({ key: 'satNone', swatch: null, text: FLOOD_PUBLIC.keySatNone, tip: sat.reason })
  }
  if (i.layers.forecastArea && fimMapped(i.fim)) {
    const ref = i.fim!.reference_ms ?? i.fim!.updated_ms
    out.push({
      key: 'forecast',
      swatch: 'forecast',
      text: num(ref) ? fillCopy(FLOOD_PUBLIC.keyForecast, { time: fmtAt(ref, i.tf, { zone: true, year: 'auto', refMs: i.nowMs }) }) : FLOOD_PUBLIC.keyForecastNoTime,
      tip: i.fim!.coverage_note,
    })
  }
  if (i.layers.channel) out.push({ key: 'channel', swatch: 'channel', text: FLOOD_PUBLIC.keyChannel })
  if (i.layers.warnings && i.warnings) out.push({ key: 'warning', swatch: 'warning', text: FLOOD_PUBLIC.keyWarning })
  if (i.layers.floodplain && i.nfhl && i.nfhl.status === 'available') {
    const eff = nfhlEffective(i.nfhl, i.tf.tz)
    out.push({ key: 'floodplain', swatch: 'floodplain', text: eff ? fillCopy(NFHL_LABEL, { date: eff }) : NFHL_LABEL.replace(/ · effective \{date\}$/, ''), tip: i.nfhl.coverage_note })
  }
  return out
}

/** The satellite login's note for the legend details (no token: SAT_NOT_SET_UP_SHORT with the backend's longer
 *  sentence; refused: the backend's sentence), else null. Never the token. */
export function satLoginNote(sat: Pick<SatelliteWaterResponse, 'login' | 'login_note'> | null | undefined): { short: string | null; long: string | null } | null {
  if (!sat || sat.login === 'configured') return null
  return { short: sat.login === 'not_configured' ? SAT_NOT_SET_UP_SHORT : null, long: sat.login_note }
}

// ------------------------------------------------------------------------------------------------ distance chip
export type FloodChipTarget = 'warning' | 'forecast' | 'gauge'

export interface FloodDistance extends AreaDistance {
  to: FloodChipTarget
}

type Ring = [number, number][]

/** Polygons (lists of lon/lat rings) of a GeoJSON geometry. */
export function polygonsOf(g: { type: string; coordinates: unknown } | null | undefined): Ring[][] {
  if (!g) return []
  if (g.type === 'Polygon') return [g.coordinates as Ring[]]
  if (g.type === 'MultiPolygon') return g.coordinates as Ring[][]
  return []
}

/** The distance from the viewer to the flood (PLAN-5 §4.4): the NWS warning area's nearest edge, else the NWS
 *  forecast flooded area, else the primary member gauge (never a nearby gauge). */
export function distanceToFlood(me: { lat: number; lon: number }, f: { warnings: Ring[][]; forecast: Ring[][]; gauge: { lat: number; lon: number } | null }): FloodDistance | null {
  if (!num(me.lat) || !num(me.lon)) return null
  const p: [number, number] = [me.lon, me.lat]
  const w = distanceToAreas(f.warnings, p)
  if (w) return { ...w, to: 'warning' }
  const fc = distanceToAreas(f.forecast, p)
  if (fc) return { ...fc, to: 'forecast' }
  const g = f.gauge
  if (g && num(g.lat) && num(g.lon)) return { km: distanceM(me, g) / 1000, bearingDeg: bearingDeg(me, g), inside: false, to: 'gauge' }
  return null
}

/** The chip's words: "↗ 20 mi | northeast of you" and what it measures ("to the edge of the NWS warning area"). */
export function floodChipText(d: FloodDistance, units: Units): DistanceChipText {
  const measures = DISTANCE_CHIP_LINES[d.to]
  if (d.inside) {
    const area = d.to === 'forecast' ? 'Inside the NWS forecast flooded area' : DISTANCE_CHIP_LINES.inside
    return { value: 'Inside', unit: '', direction: area.replace(/^Inside /, ''), measures: area, spoken: `Your location is ${area.charAt(0).toLowerCase()}${area.slice(1)}.` }
  }
  const t = distance(d.km * 1000, units).text
  const cut = t.lastIndexOf(' ')
  const value = cut > 0 ? t.slice(0, cut) : t
  const unit = cut > 0 ? t.slice(cut + 1) : ''
  const direction = `${directionWord(d.bearingDeg)} of you`
  return { value, unit, direction, measures, spoken: `The flood is ${t} ${direction}, ${measures}.` }
}

/** The leader's end (D10, C4): the primary member gauge, else the representative point of the largest NWS polygon. */
export function leaderTarget(s: Pick<FloodSummary, 'primary_gauge' | 'lat' | 'lon'> | null, warnings: Ring[][]): { lon: number; lat: number; kind: 'gauge' | 'polygon' } | null {
  if (!s) return null
  const g = s.primary_gauge
  if (g && num(g.lat) && num(g.lon)) return { lon: g.lon, lat: g.lat, kind: 'gauge' }
  const largest = [...warnings].sort((a, b) => ringArea(b[0] ?? []) - ringArea(a[0] ?? []))[0]
  if (largest && largest[0]?.length) {
    const c = representativePoint(largest)
    if (c) return { ...c, kind: 'polygon' }
  }
  return num(s.lat) && num(s.lon) ? { lon: s.lon, lat: s.lat, kind: 'polygon' } : null
}

function ringArea(r: Ring): number {
  let a = 0
  for (let k = 0, j = r.length - 1; k < r.length; j = k++) a += (r[j][0] - r[k][0]) * (r[j][1] + r[k][1])
  return Math.abs(a / 2)
}

/** A point inside the polygon (the centroid when it is inside, else the middle of the widest horizontal chord through
 *  the polygon's middle latitude). */
function representativePoint(poly: Ring[]): { lon: number; lat: number } | null {
  const outer = poly[0]
  if (!outer?.length) return null
  let cx = 0
  let cy = 0
  for (const [x, y] of outer) {
    cx += x
    cy += y
  }
  cx /= outer.length
  cy /= outer.length
  if (inRings(cx, cy, poly)) return { lon: cx, lat: cy }
  const xs: number[] = []
  for (let k = 0, j = outer.length - 1; k < outer.length; j = k++) {
    const [x1, y1] = outer[j]
    const [x2, y2] = outer[k]
    if (y1 > cy !== y2 > cy) xs.push(x1 + ((cy - y1) * (x2 - x1)) / (y2 - y1))
  }
  xs.sort((a, b) => a - b)
  let best: [number, number] | null = null
  for (let k = 0; k + 1 < xs.length; k += 2) if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]]
  return best ? { lon: (best[0] + best[1]) / 2, lat: cy } : { lon: outer[0][0], lat: outer[0][1] }
}

function inRings(x: number, y: number, rings: Ring[]): boolean {
  let inside = false
  for (const r of rings)
    for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
      const [xi, yi] = r[k]
      const [xj, yj] = r[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  return inside
}

/** The flood's full name as a phrase for screen readers (it is already "… flood"). */
export function floodLabel(name: string): string {
  return name.trim()
}

/** The circle's accessible name: "Ridge Fork River flood: flood, warning. More in Command view". */
export function floodCircleLabel(name: string, status: Pick<FloodCircleStatus, 'line'>): string {
  return fillCopy(FLOOD_PUBLIC.circleLabel, { name: name ? floodLabel(name) : FLOOD_PUBLIC.thisFlood, status: status.line.replace(' · ', ', ').toLowerCase() })
}
