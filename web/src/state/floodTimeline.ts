// A flood's time steps (brief 6, web-flood-playback M1; BRIEF-6 decision 2; contract6/backend-flood-time-3d.md). Pure,
// tested in floodTimeline.test.ts, shared by Command (the river-level chart, the 2D map) and Forensic (the dock, the
// 3D drapes). Input: GET /api/floods/{id}/timeline (state/floodTimelineData.ts holds it).
//   - Keyframes (floodKeyframes): every usable satellite pass (its own image time) and every NWS product change that
//     changes what is drawn: an event issued, its area updated, cancelled, upgraded, or its own end time reached (a
//     version that only continues or extends an event with the same area is not a step). Changes within 15 min are
//     one step. Only steps at or before now (after now the views keep what is in effect now; C1). Oldest first.
//   - passAt(passes, ms): the latest usable pass at or before ms, its age at ms, the next usable pass and the gap to it,
//     and the passes in that gap that saw nothing (no view) or are not read yet. Nothing is interpolated between two
//     passes: a view draws the pass passAt gives, with its own date, or nothing before the first one.
//   - productsAt(products, live, cursorMs, nowMs): the NWS products shown at the handle. Before now: each timeline
//     version from its issue time (shown_from_ms) until shown_until_ms (exclusive; open: still shown; a version whose
//     phase is `ended` without an end time stops at its expiry). At now and after now: brief 5's rule on the live
//     answer (productsShown: the products in effect now and the issued ones still to start; C1, WFC-R1). Without the
//     timeline's products: productsShown on the live answer at any time.
//   - step(keyframes, cursorMs, dir, nowMs): the handle's next or previous step; "now" (null) is the last step.
//   - Labels (keyframeLabel, gapNote, gapNoteShort for phones, playSummary): the words of ui/timeline/floodPlaybackCopy.ts.
import type { FloodAlert, FloodPass, FloodTimelineProduct, FloodTimelineResponse } from '../api/types'
import { DAY_MS, HOUR_MS, MINUTE_MS, fmtAt, fmtClock, fmtDayDate, type TimeFmt } from '../lib/time'
import { fillCopy } from '../ui/shell/floodCopy'
import { PLAYBACK } from '../ui/timeline/floodPlaybackCopy'
import { productsShown, type ShownProducts } from '../ui/timeline/hydrographModel'

/** A handle within this of a step is on it (the slider rounds to the minute). */
export const STEP_EPS_MS = 30_000
/** NWS changes this close together are one step (the step sits at the last of them, so all of them show). */
export const PRODUCT_MERGE_MS = 15 * MINUTE_MS
/** Play: one step every this many ms (each satellite image needs a moment to load). */
export const PLAY_STEP_MS = 1_800

// ------------------------------------------------------------------------------------------------ passes
/** A pass the views can draw: NASA saw some of the area (clear or partly hidden). Never a no-view or unread pass. */
export const isUsablePass = (p: Pick<FloodPass, 'usable' | 'view'>): boolean => p.usable === true && (p.view === 'clear' || p.view === 'partly_hidden')

/** The timeline's passes, oldest first (the route sends them so; sorted again for safety). */
export function passesOf(tl: Pick<FloodTimelineResponse, 'passes'> | null | undefined): FloodPass[] {
  const list = tl?.passes?.passes ?? []
  return [...list].filter((p) => Number.isFinite(p.acquired_ms)).sort((a, b) => a.acquired_ms - b.acquired_ms)
}

export interface PassAt {
  /** The latest usable pass at or before the handle (null: before the first one, or none). */
  pass: FloodPass | null
  /** The first usable pass after the handle. */
  next: FloodPass | null
  /** The handle is on `pass` (within STEP_EPS_MS). */
  onPass: boolean
  /** The handle's time minus the pass's image time (≥ 0). */
  ageMs: number | null
  /** The time between `pass` and `next` (both present). */
  gapMs: number | null
  /** Passes between `pass` and `next` (or the handle when there is no next) that saw no view (clouds or no data). */
  noViewBetween: FloodPass[]
  /** Passes in that gap not read yet (view `unknown`). */
  unreadBetween: FloodPass[]
}

/** The pass a view shows at `ms` (null = now: pass the timeline's now). Never a pass after the handle, never a blend. */
export function passAt(passes: readonly FloodPass[], ms: number): PassAt {
  const sorted = [...passes].sort((a, b) => a.acquired_ms - b.acquired_ms)
  let pass: FloodPass | null = null
  let next: FloodPass | null = null
  for (const p of sorted) {
    if (!isUsablePass(p)) continue
    if (p.acquired_ms <= ms + STEP_EPS_MS) pass = p
    else {
      next = p
      break
    }
  }
  const lo = pass?.acquired_ms ?? Number.NEGATIVE_INFINITY
  const hi = next?.acquired_ms ?? ms + STEP_EPS_MS
  const between = sorted.filter((p) => p.acquired_ms > lo && p.acquired_ms < hi && !isUsablePass(p))
  return {
    pass,
    next,
    onPass: pass != null && Math.abs(ms - pass.acquired_ms) <= STEP_EPS_MS,
    ageMs: pass ? Math.max(0, ms - pass.acquired_ms) : null,
    gapMs: pass && next ? next.acquired_ms - pass.acquired_ms : null,
    noViewBetween: between.filter((p) => p.view === 'no_view'),
    unreadBetween: between.filter((p) => p.view === 'unknown'),
  }
}

// ------------------------------------------------------------------------------------------------ products
export type ProductChangeKind = 'issued' | 'updated' | 'cancelled' | 'upgraded' | 'until'

export interface ProductChange {
  kind: ProductChangeKind
  /** When it happened: the version's issue time, or (until) its own end time. */
  t: number
  /** The version issued, or (until) the version whose end time it is. */
  product: FloodTimelineProduct
}

const actionOf = (p: Pick<FloodAlert, 'vtec'>): string => (p.vtec?.action ?? '').toUpperCase()
const eventKey = (p: Pick<FloodTimelineProduct, 'vtec_key' | 'id'>): string => p.vtec_key ?? `id:${p.id}`

/** A ring as text that does not depend on its first vertex, its direction or the closing vertex (the live CAP copy and
 *  the IEM archive copy of one polygon start at different vertices), at about 100 m. */
function ringKey(ring: unknown): string {
  if (!Array.isArray(ring)) return ''
  const pts = ring.filter((p): p is number[] => Array.isArray(p) && p.length >= 2).map((p) => `${Number(p[0]).toFixed(3)},${Number(p[1]).toFixed(3)}`)
  if (pts.length > 1 && pts[0] === pts[pts.length - 1]) pts.pop()
  const rotated = (list: string[]) => {
    let i0 = 0
    for (let i = 1; i < list.length; i++) if (list[i] < list[i0]) i0 = i
    return [...list.slice(i0), ...list.slice(0, i0)].join(';')
  }
  const fwd = rotated(pts)
  const back = rotated([...pts].reverse())
  return fwd < back ? fwd : back
}

/** Where a version is drawn: its polygon(s) (vertex order and start ignored), else its zones. */
export function areaOf(p: Pick<FloodAlert, 'geometry' | 'ugcs'>): string {
  const g = p.geometry as { type?: string; coordinates?: unknown } | null
  if (!g) return `ugc:${[...(p.ugcs ?? [])].sort().join(',')}`
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? (g.coordinates as unknown[]) : []) as unknown[]
  const keys = polys.map((rings) => (Array.isArray(rings) ? rings.map(ringKey).join('|') : '')).sort()
  return keys.length ? keys.join('||') : JSON.stringify(g)
}

/** When a version stops being drawn (exclusive): shown_until_ms; without one, its expiry when NWS's phase says it is
 *  over, else never. Never before its issue time. */
export function versionUntil(p: Pick<FloodTimelineProduct, 'shown_from_ms' | 'shown_until_ms' | 'phase' | 'expires_ms'>): number {
  const from = p.shown_from_ms ?? Number.NEGATIVE_INFINITY
  if (p.shown_until_ms != null) return Math.max(from, p.shown_until_ms)
  if (p.phase === 'ended' && p.expires_ms != null) return Math.max(from, p.expires_ms)
  return Number.POSITIVE_INFINITY
}

/** Is a version drawn at `t` (a time before now)? From its issue time until versionUntil (exclusive). */
export function versionShownAt(p: Pick<FloodTimelineProduct, 'shown_from_ms' | 'shown_until_ms' | 'phase' | 'expires_ms'>, t: number): boolean {
  return p.shown_from_ms != null && p.shown_from_ms <= t && t < versionUntil(p)
}

/** The NWS product changes that change what is drawn, oldest first, up to `nowMs`. */
export function productChanges(products: readonly FloodTimelineProduct[], nowMs: number): ProductChange[] {
  const groups = new Map<string, FloodTimelineProduct[]>()
  for (const p of products) {
    if (p.shown_from_ms == null || !Number.isFinite(p.shown_from_ms)) continue
    const k = eventKey(p)
    groups.set(k, [...(groups.get(k) ?? []), p])
  }
  const out: ProductChange[] = []
  for (const list of groups.values()) {
    list.sort((a, b) => (a.shown_from_ms as number) - (b.shown_from_ms as number) || a.id.localeCompare(b.id))
    let prev: FloodTimelineProduct | null = null
    for (const v of list) {
      const from = v.shown_from_ms as number
      const action = actionOf(v)
      // the previous version still drawn when this one came (else this one makes the event appear again)
      const prevShown = prev != null && versionUntil(prev) >= from - STEP_EPS_MS
      let kind: ProductChangeKind | null
      if (action === 'CAN') kind = 'cancelled'
      else if (action === 'UPG') kind = 'upgraded'
      else if (!prevShown) kind = 'issued'
      else kind = areaOf(prev!) !== areaOf(v) ? 'updated' : null
      if (kind && from <= nowMs + STEP_EPS_MS) out.push({ kind, t: from, product: v })
      // its own end time, when no later version of the event takes over then (CAN / UPG end at their issue time)
      const until = versionUntil(v)
      if (action !== 'CAN' && action !== 'UPG' && Number.isFinite(until) && until > from && until <= nowMs + STEP_EPS_MS) {
        const next = list.find((x) => (x.shown_from_ms as number) > from)
        if (!next || (next.shown_from_ms as number) > until + STEP_EPS_MS) out.push({ kind: 'until', t: until, product: v })
      }
      prev = v
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

export interface ProductsAtHandle extends ShownProducts<FloodAlert> {
  /** 'timeline': versions of the time history (before now); 'live': the live answer (brief 5's rule). */
  source: 'timeline' | 'live'
}

/** The NWS products shown at the handle (module docstring). `products`: the timeline's versions (null or empty: the
 *  live answer is used at every time); `live`: the flood-alerts answer's products. */
export function productsAt(
  products: readonly FloodTimelineProduct[] | null | undefined,
  live: readonly FloodAlert[],
  cursorMs: number | null,
  nowMs: number,
): ProductsAtHandle {
  const past = cursorMs != null && Number.isFinite(cursorMs) && cursorMs < nowMs
  if (past && products && products.length) {
    return { alerts: products.filter((p) => versionShownAt(p, cursorMs)), future: false, issuedForCursor: false, source: 'timeline' }
  }
  return { ...productsShown(live, cursorMs, nowMs), source: 'live' }
}

// ------------------------------------------------------------------------------------------------ keyframes
export interface FloodKeyframe {
  /** The step's time (the pass's image time; the last of a group of NWS changes). */
  t: number
  kind: 'pass' | 'products'
  /** kind 'pass': the pass. */
  pass: FloodPass | null
  /** NWS changes at this step (a pass step can carry some within STEP_EPS_MS), oldest first. */
  changes: ProductChange[]
}

/** The steps of a flood, oldest first, at or before `nowMs` and not before `fromMs` (module docstring). */
export function floodKeyframes(tl: FloodTimelineResponse | null | undefined, nowMs: number, fromMs = Number.NEGATIVE_INFINITY): FloodKeyframe[] {
  if (!tl) return []
  const inRange = (t: number) => t >= fromMs && t <= nowMs + STEP_EPS_MS
  const frames: FloodKeyframe[] = passesOf(tl)
    .filter((p) => isUsablePass(p) && inRange(p.acquired_ms))
    .map((p) => ({ t: p.acquired_ms, kind: 'pass' as const, pass: p, changes: [] }))
  const changes = tl.products?.status === 'available' ? productChanges(tl.products.products ?? [], nowMs).filter((c) => inRange(c.t)) : []
  // NWS changes close together are one step, at the last of them
  const groups: ProductChange[][] = []
  for (const c of changes) {
    const g = groups[groups.length - 1]
    if (g && c.t - g[0].t <= PRODUCT_MERGE_MS) g.push(c)
    else groups.push([c])
  }
  for (const g of groups) {
    const t = g[g.length - 1].t
    const pass = frames.find((f) => f.kind === 'pass' && Math.abs(f.t - t) <= STEP_EPS_MS)
    if (pass) pass.changes.push(...g)
    else frames.push({ t, kind: 'products', pass: null, changes: g })
  }
  frames.sort((a, b) => a.t - b.t || (a.kind === 'pass' ? -1 : 1))
  // two steps closer than STEP_EPS_MS cannot both be reached: keep the first, fold the second's changes into it
  const out: FloodKeyframe[] = []
  for (const f of frames) {
    const last = out[out.length - 1]
    if (last && f.t - last.t <= STEP_EPS_MS && !(last.pass && f.pass)) {
      last.changes.push(...f.changes)
      if (!last.pass && f.pass) Object.assign(last, { kind: 'pass', pass: f.pass, t: f.t })
    } else out.push({ ...f, changes: [...f.changes] })
  }
  return out
}

/** The step the handle is on (within STEP_EPS_MS), else -1. null (now) is on no step. */
export function keyframeIndexAt(frames: readonly FloodKeyframe[], cursorMs: number | null): number {
  if (cursorMs == null) return -1
  return frames.findIndex((f) => Math.abs(f.t - cursorMs) <= STEP_EPS_MS)
}

/** The handle's next or previous step: a keyframe's time, or null for now (the last step). Null result: no move (at
 *  now going forward, at the first step going back, no steps). A handle after now steps back to now. */
export function step(frames: readonly FloodKeyframe[], cursorMs: number | null, dir: 'next' | 'prev', nowMs: number): { cursorMs: number | null } | null {
  const cur = cursorMs ?? nowMs
  const stops: { t: number; cursor: number | null }[] = [...frames.filter((f) => f.t < nowMs - STEP_EPS_MS).map((f) => ({ t: f.t, cursor: f.t as number | null })), { t: nowMs, cursor: null }]
  if (dir === 'next') {
    if (cursorMs == null) return null
    const s = stops.find((x) => x.t > cur + STEP_EPS_MS)
    return s ? { cursorMs: s.cursor } : null
  }
  const before = stops.filter((x) => x.t < cur - STEP_EPS_MS)
  const s = before[before.length - 1]
  return s ? { cursorMs: s.cursor } : null
}

/** Where Play starts: the first step when the handle is at now (or after the last step), else the next step. */
export function playStart(frames: readonly FloodKeyframe[], cursorMs: number | null, nowMs: number): { cursorMs: number | null } | null {
  const first = frames.find((f) => f.t < nowMs - STEP_EPS_MS)
  if (!first) return null
  if (cursorMs == null || cursorMs >= nowMs - STEP_EPS_MS) return { cursorMs: first.t }
  return step(frames, cursorMs, 'next', nowMs)
}

// ------------------------------------------------------------------------------------------------ labels
/** "7 days before now" / "5 hours before now" / "12 min before now". */
export function beforeNowText(ms: number, nowMs: number): string {
  const d = Math.max(0, nowMs - ms)
  if (d < HOUR_MS) return fillCopy(PLAYBACK.agoMinutes, { n: Math.max(1, Math.round(d / MINUTE_MS)) })
  if (d < 36 * HOUR_MS) {
    const h = Math.round(d / HOUR_MS)
    return h === 1 ? PLAYBACK.agoHour : fillCopy(PLAYBACK.agoHours, { n: h })
  }
  const days = Math.round(d / DAY_MS)
  return days === 1 ? PLAYBACK.agoDay : fillCopy(PLAYBACK.agoDays, { n: days })
}

/** A span without "before now" ("3 days", "5 hours", "20 min"): the age of an image at the handle. */
export function spanText(ms: number): string {
  return beforeNowText(0, ms).replace(/ before now$/, '')
}

/** A label: its text and, when it names an NWS event, that verbatim part (the view wraps it in data-verbatim). */
export interface StepLabel {
  text: string
  /** NWS's own event name inside `text` (verbatim), or null. */
  event: string | null
}

/** The share of the area a pass did not see (cloud + no data), whole percent; null when not known. */
export function hiddenPct(p: Pick<FloodPass, 'clear_pct' | 'cloud_pct' | 'nodata_pct'>): number | null {
  if (p.clear_pct != null && Number.isFinite(p.clear_pct)) return Math.max(0, Math.min(100, Math.round(100 - p.clear_pct)))
  const s = (p.cloud_pct ?? 0) + (p.nodata_pct ?? 0)
  return p.cloud_pct == null && p.nodata_pct == null ? null : Math.round(Math.min(100, s))
}

/** "Satellite pass Oct 29, 12:04 EDT · 7 days before now" (· "no view of 41% of the area …" when partly hidden). A past
 *  flood's pass has no age (its "now" is its last NWS product). */
export function passLabel(p: FloodPass, tf: TimeFmt, nowMs: number, past = false): string {
  const time = fmtAt(p.acquired_ms, tf, { zone: true, year: 'auto', refMs: nowMs })
  const base = past ? fillCopy(PLAYBACK.passPast, { time }) : fillCopy(PLAYBACK.pass, { time, ago: beforeNowText(p.acquired_ms, nowMs) })
  const hidden = p.view === 'partly_hidden' ? hiddenPct(p) : null
  return hidden != null && hidden > 0 ? `${base} · ${fillCopy(PLAYBACK.passHidden, { pct: hidden })}` : base
}

/** One NWS change's words, in the product's own zone ("NWS Flood Warning issued Nov 4, 20:25 CST"). */
export function changeLabel(c: ProductChange, tf: TimeFmt, nowMs: number): StepLabel {
  const ptf: TimeFmt = { tz: c.product.time_zone || tf.tz, clock: tf.clock }
  const time = fmtAt(c.t, ptf, { zone: true, year: 'auto', refMs: nowMs })
  const event = c.product.event?.trim() || 'product'
  return { text: fillCopy(PLAYBACK[c.kind], { event, time }), event: c.product.event?.trim() ? event : null }
}

/** The label of a step: the pass, else the first NWS change (+ how many more). */
export function keyframeLabel(f: FloodKeyframe, tf: TimeFmt, nowMs: number, past = false): StepLabel {
  if (f.pass) {
    const text = passLabel(f.pass, tf, nowMs, past)
    if (!f.changes.length) return { text, event: null }
    const c = changeLabel(f.changes[0], tf, nowMs)
    return { text: `${text} · ${c.text}${moreText(f.changes, tf)}`, event: c.event }
  }
  const c = changeLabel(f.changes[0], tf, nowMs)
  return { text: `${c.text}${moreText(f.changes, tf)}`, event: c.event }
}

function moreText(changes: readonly ProductChange[], tf: TimeFmt): string {
  if (changes.length < 2) return ''
  const last = changes[changes.length - 1]
  const ptf: TimeFmt = { tz: last.product.time_zone || tf.tz, clock: tf.clock }
  // the clock only when the last change is on the first one's day ("by 00:10 EST"), else its day too
  const sameDay = fmtDayDate(last.t, ptf.tz) === fmtDayDate(changes[0].t, ptf.tz)
  const time = sameDay ? fmtClock(last.t, ptf, { zone: true }) : fmtAt(last.t, ptf, { zone: true })
  return ` ${changes.length === 2 ? fillCopy(PLAYBACK.moreOne, { time }) : fillCopy(PLAYBACK.moreMany, { n: changes.length - 1, time })}`
}

/** The note for the satellite layer at the handle (null: on a pass, or nothing to say): which image the map shows and
 *  the gap ("No satellite image between Oct 29 and Nov 3"), with the passes in the gap that saw no view. */
export function gapNote(at: PassAt, cursorMs: number, tf: TimeFmt, nowMs: number): string | null {
  if (at.onPass) return null
  const day = (ms: number) => fmtDayDate(ms, tf.tz, { year: 'auto', refMs: nowMs })
  const parts: string[] = []
  if (at.pass) {
    parts.push(fillCopy(PLAYBACK.mapImage, { time: fmtAt(at.pass.acquired_ms, tf, { zone: true, year: 'auto', refMs: nowMs }), age: spanText(cursorMs - at.pass.acquired_ms) }))
    parts.push(at.next ? fillCopy(PLAYBACK.gapBetween, { from: day(at.pass.acquired_ms), to: day(at.next.acquired_ms) }) : fillCopy(PLAYBACK.gapAfter, { from: day(at.pass.acquired_ms) }))
  } else if (at.next) parts.push(fillCopy(PLAYBACK.gapBefore, { to: day(at.next.acquired_ms) }))
  else parts.push(PLAYBACK.gapNone)
  const nv = at.noViewBetween.length
  if (nv) parts.push(nv === 1 ? PLAYBACK.noViewOne : fillCopy(PLAYBACK.noViewMany, { n: nv }))
  if (at.unreadBetween.length) parts.push(PLAYBACK.unread)
  return parts.join(' · ')
}

/** The gap note's short form for phones (review WFP-R5): the date and age of the image shown, kept visible on its own
 *  line ("Image shown: Oct 29 (6 days before)"); null on a pass. */
export function gapNoteShort(at: PassAt, cursorMs: number, tf: TimeFmt, nowMs: number): string | null {
  if (at.onPass) return null
  const day = (ms: number) => fmtDayDate(ms, tf.tz, { year: 'auto', refMs: nowMs })
  if (at.pass) return fillCopy(PLAYBACK.mapImageShort, { date: day(at.pass.acquired_ms), age: spanText(cursorMs - at.pass.acquired_ms) })
  return at.next ? fillCopy(PLAYBACK.gapBeforeShort, { to: day(at.next.acquired_ms) }) : PLAYBACK.gapNoneShort
}

/** The row at now: "4 satellite passes and 5 NWS product changes from Oct 23 · Play steps through them". */
export function playSummary(frames: readonly FloodKeyframe[], tf: TimeFmt, nowMs: number): string {
  if (!frames.length) return PLAYBACK.none
  const passes = frames.filter((f) => f.pass).length
  const changes = frames.reduce((n, f) => n + f.changes.length, 0)
  const p = passes === 1 ? PLAYBACK.passesOne : fillCopy(PLAYBACK.passesMany, { n: passes })
  const c = changes === 1 ? PLAYBACK.changesOne : fillCopy(PLAYBACK.changesMany, { n: changes })
  return fillCopy(PLAYBACK.summary, { passes: p, changes: c, from: fmtDayDate(frames[0].t, tf.tz, { year: 'auto', refMs: nowMs }) })
}
