// The official flood answers as rows and states (brief 5, PLAN-5 §3.8, §4.4, D24; CONTRACT §16.4). Pure, tested in
// floodModel.test.ts; the flood views only draw what this says.
//   - Every answer has a state from its envelope: loading, available, unavailable, past (not available for past dates).
//     An absence sentence (NO_PRODUCT, RFC_FIM_NONE, GAUGE_BELOW_STAGE, NO_GAUGE_NEAR) is said only for an `available`
//     answer; an unavailable answer gets its own "could not be reached" text (D24).
//   - NWS products become rows with their own words verbatim (event, headline, description, instruction: rendered inside
//     `data-verbatim` by the views), the sender, the issuer's own zone and times, and a link. A Flash Flood Emergency
//     comes first and open; then warnings, advisories, watches, statements; newest first within each.
//   - Model output (ModelOutputResponse, `model_output: true`) is never an official row: the row builders take official
//     envelopes only and drop anything else (test).
//   - productsAt (C1): the products in effect at the hydrograph handle's time; after now, the products in effect now
//     (`future: true`: the views add CURSOR_FUTURE_PRODUCTS). Used by the map, location/floodCheck.ts, Command and
//     Forensic (web-flood-command's hydrographModel re-exports it).
//   - Evacuations in flood wording (D23): "None listed" with its source and check time, Oregon's wildfire-only feed
//     answers OR_EVAC_FIRE_ONLY, Cal OES zones keep their own status and event type verbatim; never a fire row's words.
import type { FloodAlert, FloodAlertsResponse, FloodMapResponse, FloodSummary, RiverGauge, RiverGaugesResponse, SatelliteWaterResponse } from '../api/types'
import type { EvacuationsResponse, EvacZoneFeature } from '../extras/types'
import { statusLabel, statusText } from '../extras/evacuation'
import { evacStyleGroup } from '../extras/style'
import { fmtAt, fmtRelative, type TimeFmt } from '../lib/time'
import { EVAC_NONE_LISTED, EVAC_NONE_LISTED_SUB, fillCopy, FLOOD_PUBLIC, OR_EVAC_FIRE_ONLY } from '../ui/shell/floodCopy'

// ------------------------------------------------------------------------------------------------ answers
/** One official answer as the views hold it (the query's state and the envelope). */
export interface Answer<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export const NO_ANSWER: Answer<never> = { data: null, loading: false, error: null }

export type AnswerState = 'loading' | 'available' | 'unavailable' | 'past' | 'none'

/** The state of an answer from its envelope (D24): `none` = not asked (no flood, layer off). A failed request is
 *  `unavailable`; a stale answer kept while a refresh fails stays what it said. */
export function answerState(a: Answer<{ status: string }> | null | undefined): AnswerState {
  if (!a) return 'none'
  if (a.data) {
    if (a.data.status === 'available') return 'available'
    if (a.data.status === 'not_available_for_past_dates') return 'past'
    return 'unavailable'
  }
  if (a.loading) return 'loading'
  return a.error ? 'unavailable' : 'none'
}

/** The answer's reason (the backend's own words) when it is not available. */
export function answerReason(a: Answer<{ status: string; reason?: string | null }> | null | undefined): string | null {
  if (!a) return null
  if (a.data) return a.data.status === 'available' ? null : (a.data.reason ?? null)
  return a.error
}

/** Model output is never official information: anything carrying `model_output` is refused by the row builders. */
export function isModelOutput(x: unknown): boolean {
  return typeof x === 'object' && x !== null && (x as { model_output?: unknown }).model_output === true
}

const isFloodAlerts = (x: unknown): x is FloodAlertsResponse => typeof x === 'object' && x !== null && !isModelOutput(x) && (x as { kind?: unknown }).kind === 'flood_alerts'
const isRiverGauges = (x: unknown): x is RiverGaugesResponse => typeof x === 'object' && x !== null && !isModelOutput(x) && (x as { kind?: unknown }).kind === 'river_gauges'

// ------------------------------------------------------------------------------------------------ products
const PRODUCT_RANK: Record<string, number> = {
  'Flash Flood Warning': 0,
  'Flood Warning': 1,
  'Flood Advisory': 2,
  'Flash Flood Watch': 3,
  'Flood Watch': 4,
  'Flash Flood Statement': 5,
  'Flood Statement': 6,
}

/** Emergency first, then warnings, advisories, watches, statements; newest first within each (CONTRACT §16.4). */
export function orderAlerts<T extends Pick<FloodAlert, 'event' | 'emergency' | 'sent_ms'>>(alerts: readonly T[]): T[] {
  const rank = (a: T) => (a.emergency ? -1 : (PRODUCT_RANK[a.event] ?? 9))
  return [...alerts].sort((a, b) => rank(a) - rank(b) || (b.sent_ms ?? 0) - (a.sent_ms ?? 0))
}

const startOf = (a: Pick<FloodAlert, 'onset_ms' | 'effective_ms' | 'sent_ms'>) => a.onset_ms ?? a.effective_ms ?? a.sent_ms ?? Number.NEGATIVE_INFINITY
const endOf = (a: Pick<FloodAlert, 'ends_ms' | 'expires_ms'>) => a.ends_ms ?? a.expires_ms ?? Number.POSITIVE_INFINITY

/** Was the product in effect at `t`? Now: NWS's own phase must not say it ended (a cancelled product); a past time: its
 *  own start and end times. */
function inEffectAt(a: Pick<FloodAlert, 'onset_ms' | 'effective_ms' | 'sent_ms' | 'ends_ms' | 'expires_ms' | 'phase'>, t: number, now: boolean): boolean {
  if (now && a.phase === 'ended') return false
  return startOf(a) <= t && t < endOf(a)
}

/** The products to draw and check at the hydrograph handle (CONTRACT §16.12, C1): in effect at `cursorMs` when it is
 *  now or before (null = now); after now, the products in effect NOW with `future: true` (NWS has issued none for
 *  that time; an NWS end time is not a forecast of when flooding stops). */
export function productsAt<T extends Pick<FloodAlert, 'onset_ms' | 'effective_ms' | 'sent_ms' | 'ends_ms' | 'expires_ms' | 'phase'>>(
  alerts: readonly T[],
  cursorMs: number | null,
  nowMs: number,
): { alerts: T[]; future: boolean } {
  const future = cursorMs != null && Number.isFinite(cursorMs) && cursorMs > nowMs
  const now = cursorMs == null || !Number.isFinite(cursorMs) || cursorMs >= nowMs
  const t = now ? nowMs : cursorMs
  return { alerts: alerts.filter((a) => inEffectAt(a, t, now)), future }
}

/** The phase word of a product: "In effect", "Starting soon", or, for a past view, "Was in effect" (brief-4 rule). */
export function phaseWord(a: Pick<FloodAlert, 'phase'>, past: boolean): string {
  if (past) return 'Was in effect'
  return a.phase === 'upcoming' ? FLOOD_PUBLIC.startingSoon : FLOOD_PUBLIC.inEffect
}

/** "NWS Albuquerque NM" → as sent (the issuer's own name); null → "NWS". */
export function senderName(s: string | null | undefined): string {
  const t = (s ?? '').trim().replace(/^National Weather Service\b\s*/i, 'NWS ')
  return t || 'NWS'
}

export interface FloodAlertRow {
  id: string
  /** NWS's event name verbatim ("Flood Warning"). */
  event: string
  emergency: boolean
  /** "In effect" / "Starting soon" / "Was in effect". */
  phase: string
  /** "until Nov 4, 7:00 PM MST" in the issuer's zone, or null without an end. */
  until: string | null
  sender: string
  /** "sent Nov 4, 5:00 AM MST" in the issuer's zone. */
  sent: string | null
  /** NWS's own words, verbatim (rendered inside data-verbatim). */
  headline: string | null
  description: string | null
  instruction: string | null
  areaDesc: string | null
  detection: string | null
  damageThreat: string | null
  url: string | null
  archived: boolean
  /** Open at first (an Emergency). */
  open: boolean
  geometry: FloodAlert['geometry']
  /** The issuer's IANA zone (else the flood's). */
  timeZone: string
}

/** The official rows of a flood-alerts answer (none for any other kind of answer, model output included). */
export function floodAlertRows(resp: unknown, o: { zone: string; clock: TimeFmt['clock']; past?: boolean; nowMs: number; tf?: (tz: string) => TimeFmt }): FloodAlertRow[] {
  if (!isFloodAlerts(resp) || resp.status !== 'available') return []
  const mk = o.tf ?? ((tz: string) => ({ tz, clock: o.clock }) as TimeFmt)
  return orderAlerts(resp.alerts).map((a) => {
    const tz = a.time_zone || o.zone
    const tf = mk(tz)
    const end = a.ends_ms ?? a.expires_ms
    return {
      id: a.id,
      event: a.event,
      emergency: a.emergency,
      phase: phaseWord(a, o.past === true || a.archived),
      until: end != null ? fillCopy(FLOOD_PUBLIC.until, { time: fmtAt(end, tf, { zone: true, year: 'auto', refMs: o.nowMs }) }) : null,
      sender: senderName(a.sender_name),
      sent: a.sent_ms != null ? fillCopy(FLOOD_PUBLIC.sent, { time: fmtAt(a.sent_ms, tf, { zone: true, year: 'auto', refMs: o.nowMs }) }) : null,
      headline: a.headline,
      description: a.description,
      instruction: a.instruction,
      areaDesc: a.area_desc,
      detection: a.detection,
      damageThreat: a.damage_threat,
      url: httpsUrl(a.url),
      archived: a.archived,
      open: a.emergency,
      geometry: a.geometry,
      timeZone: tz,
    }
  })
}

/** The answer's alerts that belong to the flood (all of a `?flood=` answer). Never from a model answer. */
export function officialAlerts(resp: unknown): FloodAlert[] {
  return isFloodAlerts(resp) && resp.status === 'available' ? resp.alerts : []
}

/** The alert behind the flood's highest product (Emergency first), from the answer, else null. */
export function leadAlert(resp: unknown, nowMs: number): FloodAlert | null {
  const alerts = productsAt(officialAlerts(resp), null, nowMs).alerts
  return orderAlerts(alerts)[0] ?? null
}

// ------------------------------------------------------------------------------------------------ gauges
/** The flood's member gauges (primary first); never a nearby gauge (C4). */
export function memberGaugesOf(resp: unknown): RiverGauge[] {
  return isRiverGauges(resp) && resp.status === 'available' ? resp.gauges.filter((g) => g.member === true) : []
}

/** The primary member gauge: the summary's primary gauge when the answer has it as a member, else the first member. */
export function primaryMemberGauge(resp: unknown, summary: Pick<FloodSummary, 'primary_gauge'> | null): RiverGauge | null {
  const members = memberGaugesOf(resp)
  const lid = summary?.primary_gauge?.lid
  return (lid ? members.find((g) => g.lid === lid) : null) ?? members[0] ?? null
}

/** "Example River Forecast Center (synthetic)", else the RFC code, else "River Forecast Center". */
export function rfcName(f: Pick<NonNullable<RiverGauge['forecast']>, 'producer' | 'producer_name'> | null | undefined): string {
  return f?.producer_name?.trim() || f?.producer?.trim() || 'River Forecast Center'
}

// ------------------------------------------------------------------------------------------------ maps, satellite
/** Does an available RFC FIM answer map anything for this flood? */
export function fimMapped(resp: FloodMapResponse | null | undefined): boolean {
  return resp != null && resp.status === 'available' && resp.features.features.length > 0
}

/** The satellite answer's image shown first (null without a measured image). */
export function shownGranule(resp: SatelliteWaterResponse | null | undefined): SatelliteWaterResponse['granules'][number] | null {
  return resp && resp.status === 'available' ? (resp.granules[0] ?? null) : null
}

// ------------------------------------------------------------------------------------------------ evacuations (D23)
export interface FloodEvacFact {
  state: 'loading' | 'unavailable' | 'not-available' | 'none-listed' | 'listed' | 'not-checked'
  /** "Evacuation Order" (the issuer's own words, verbatim), "None listed", ... */
  value: string
  /** The value is an issuer's own words (rendered inside data-verbatim). */
  verbatim: boolean
  tone?: 'alert'
  /** The issuer's own words for the sub-line (Cal OES event type), verbatim. */
  subVerbatim: string | null
  sub: string | null
  link: { url: string; label: string } | null
  /** Who answered ("Cal OES"), null when nobody. */
  who: string | null
  checkedMs: number | null
}

const httpsUrl = (u: string | null | undefined): string | null => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null)
const AGGREGATOR: Record<string, string> = { caloes_evacuations: 'Cal OES', caloes_evacuation_inventory: 'Cal OES', or_oem_evacuations: 'Oregon OEM' }
const ZONE_URGENCY: Record<string, number> = { order: 0, warning: 1, other: 2, hidden: 3 }
const ORDER_WORDS = /\bfire\b|\bwildfire\b/i
const OR_EVAC_KEY = "Oregon's evacuation feed covers wildfires only"

/** The flood's evacuation answer (`/api/extras/evacuations?bbox=&hazard=flood`) in flood wording (D23): never "near
 *  this fire". Oregon's wildfire-only feed answers OR_EVAC_FIRE_ONLY. */
export function floodEvacuation(q: Answer<EvacuationsResponse> | null | undefined, tf: TimeFmt, nowMs: number): FloodEvacFact {
  const base = { verbatim: false, subVerbatim: null, link: null, who: null, checkedMs: null } as const
  if (!q || (!q.data && !q.loading && !q.error)) return { ...base, state: 'not-checked', value: FLOOD_PUBLIC.checking, sub: null }
  if (!q.data) return q.loading ? { ...base, state: 'loading', value: FLOOD_PUBLIC.checking, sub: null } : { ...base, state: 'unavailable', value: FLOOD_PUBLIC.unavailable, sub: q.error }
  const d = q.data
  // Oregon's feed is wildfire-only: for a flood the backend answers it not-available with OR_EVAC_FIRE_ONLY (in the
  // source's reason, the state's note or the answer's reason)
  const notes = [d.reason, ...d.sources.map((s) => s.reason), ...(d.states ?? []).map((s) => s.note)]
  const orNote = notes.some((t) => (t ?? '').includes(OR_EVAC_KEY)) ? OR_EVAC_FIRE_ONLY : null
  const answered = d.sources.filter((s) => s.status === 'available' && AGGREGATOR[s.id])
  const who = [...new Set(answered.map((s) => s.aggregator || AGGREGATOR[s.id]))].join(' and ') || null
  const checkedMs = answered.length ? Math.min(...answered.map((s) => s.retrieved_ms ?? d.retrieved_ms ?? nowMs)) : d.retrieved_ms
  if (d.status !== 'available') {
    const notHere = d.reason_code === 'state_not_available'
    const firstLink = (d.states ?? []).flatMap((s) => s.links)[0]
    const reason = orNote ?? stripFollow(d.reason)
    return {
      ...base,
      state: notHere ? 'not-available' : 'unavailable',
      value: notHere ? 'Not available in this state' : FLOOD_PUBLIC.unavailable,
      sub: [reason, 'follow local officials'].filter(Boolean).join(' · ') || null,
      link: firstLink && httpsUrl(firstLink.url) ? { url: firstLink.url, label: firstLink.label } : null,
      who,
      checkedMs,
    }
  }
  const zones = d.zones.features.filter((z) => evacStyleGroup(z.properties.status_key) !== 'hidden')
  if (!zones.length) {
    const sub = who ? fillCopy(EVAC_NONE_LISTED_SUB, { source: who, time: checkedMs != null ? fmtRelative(checkedMs, nowMs) : 'just now' }) : orNote
    return { ...base, state: 'none-listed', value: EVAC_NONE_LISTED, sub: [sub, who && orNote ? orNote : null].filter(Boolean).join(' · ') || null, who, checkedMs }
  }
  const sorted = [...zones].sort((a, b) => ZONE_URGENCY[evacStyleGroup(a.properties.status_key)] - ZONE_URGENCY[evacStyleGroup(b.properties.status_key)])
  const top = sorted[0]
  const sameStatus = sorted.filter((z) => zoneStatus(z) === zoneStatus(top))
  const others = zones.length - sameStatus.length
  const p = top.properties
  const own = p.status_updated_ms ?? p.aggregated_ms
  const sub = [
    `${sameStatus.length} zone${sameStatus.length === 1 ? '' : 's'}`,
    p.jurisdiction,
    own != null ? `updated ${fmtAt(own, tf, { zone: true, year: 'auto', refMs: nowMs })}` : null,
    others > 0 ? `+${others} other zone${others === 1 ? '' : 's'}` : null,
    who ? `via ${who}` : null,
    orNote,
  ]
  const src = d.sources.find((s) => s.id === p.source_id)
  const url = httpsUrl(src?.url)
  return {
    ...base,
    state: 'listed',
    value: zoneStatus(top),
    verbatim: p.status_verbatim !== false,
    tone: 'alert',
    // Cal OES names each zone's own event type ("Flood", "Fire"): verbatim, so a fire zone in the flood's area says so
    subVerbatim: p.event_type?.trim() ? `${AGGREGATOR[p.source_id] ?? 'Source'} event type: ${p.event_type.trim()}` : null,
    sub: sub.filter(Boolean).join(' · '),
    link: url ? { url, label: who ?? 'Source' } : null,
    who,
    checkedMs,
  }
}

function zoneStatus(z: EvacZoneFeature): string {
  return statusLabel(z.properties) ?? statusText(z.properties)
}

const stripFollow = (s: string | null | undefined): string | null => (s ? s.replace(/\s*Follow local officials\.?\s*$/i, '').trim() || null : null)

/** Fire-3d's own words in an evacuation fact never name a fire (the issuer's verbatim words may; C5 guard). */
export function evacOwnWordsMentionFire(f: Pick<FloodEvacFact, 'value' | 'verbatim' | 'sub'>): boolean {
  return (!f.verbatim && ORDER_WORDS.test(f.value)) || ORDER_WORDS.test(f.sub ?? '')
}
