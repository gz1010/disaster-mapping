// floodTimeline.ts (brief 6, web-flood-playback M1): keyframes, passAt, productsAt, step and the labels, on a small
// synthetic timeline shaped like the route's answers (the fixture's four passes; a St Johns-like run of NWS versions).
import { describe, expect, it } from 'vitest'
import type { FloodAlert, FloodPass, FloodTimelineProduct, FloodTimelineResponse } from '../api/types'
import { DAY_MS, HOUR_MS, MINUTE_MS, type TimeFmt } from '../lib/time'
import { floodWordingProblems } from '../ui/shell/floodCopy'
import { SQUARE as TEST_SQUARE, testPass, testTimeline, versionBuilder } from './floodTimeline.testutil'
import {
  beforeNowText,
  floodKeyframes,
  gapNote,
  hiddenPct,
  isUsablePass,
  keyframeIndexAt,
  keyframeLabel,
  passAt,
  passesOf,
  passLabel,
  playStart,
  playSummary,
  productChanges,
  productsAt,
  step,
  versionShownAt,
} from './floodTimeline'

const NOW = Date.UTC(2026, 10, 5, 15, 0) // Nov 5 2026 15:00 UTC
const TF: TimeFmt = { tz: 'America/New_York', clock: '24h' }

const pass = testPass
const version = versionBuilder(NOW)
const SQUARE = TEST_SQUARE

const P = {
  before: pass('DSWx-HLS_20261023T0915_L8', NOW - 13 * DAY_MS, 'clear'),
  cloud: pass('DSWx-HLS_20261025T1315_S2A', NOW - 11 * DAY_MS, 'no_view'),
  partly: pass('DSWx-HLS_20261030T1115_L9', NOW - 6 * DAY_MS, 'partly_hidden'),
  unread: pass('DSWx-HLS_20261031T1115_S2C', NOW - 5 * DAY_MS, 'unknown'),
  latest: pass('DSWx-HLS_20261101T1215_S2B', NOW - 4 * DAY_MS, 'clear'),
}

// event A: NEW, three CONs with the same area (no step), an EXT with a new area, a CAN
// event B: NEW, its own end time passes (no next version); event C: a Watch UPG'd
// event D: a zone-based advisory (geometry null), NEW, then still open
const T0 = NOW - 5 * DAY_MS
const A = [
  version('a1', 'KMLB.FL.W.0003', 'NEW', T0, T0 + 12 * HOUR_MS, { replaced_ms: T0 + 12 * HOUR_MS }),
  version('a2', 'KMLB.FL.W.0003', 'CON', T0 + 12 * HOUR_MS, T0 + 24 * HOUR_MS, { replaced_ms: T0 + 24 * HOUR_MS }),
  version('a3', 'KMLB.FL.W.0003', 'CON', T0 + 24 * HOUR_MS, T0 + 36 * HOUR_MS, { replaced_ms: T0 + 36 * HOUR_MS }),
  version('a4', 'KMLB.FL.W.0003', 'EXT', T0 + 36 * HOUR_MS, T0 + 72 * HOUR_MS, { replaced_ms: T0 + 72 * HOUR_MS, geometry: SQUARE(0.4) as FloodAlert['geometry'] }),
  version('a5', 'KMLB.FL.W.0003', 'CAN', T0 + 72 * HOUR_MS, T0 + 72 * HOUR_MS),
]
const B = [version('b1', 'KMLB.FL.W.0005', 'NEW', T0 + 30 * HOUR_MS, T0 + 40 * HOUR_MS)]
const C = [
  version('c1', 'KMLB.FA.A.0002', 'NEW', T0 + 50 * HOUR_MS, T0 + 55 * HOUR_MS, { event: 'Flood Watch', replaced_ms: T0 + 55 * HOUR_MS }),
  version('c2', 'KMLB.FA.A.0002', 'UPG', T0 + 55 * HOUR_MS, T0 + 55 * HOUR_MS, { event: 'Flood Watch' }),
]
const D = [version('d1', 'KMLB.FA.Y.0007', 'NEW', NOW - 3 * HOUR_MS, null, { event: 'Flood Advisory', geometry: null, ugcs: ['FLZ141'], archived: false, phase: 'in_effect' })]
const PRODUCTS = [...A, ...B, ...C, ...D].sort((a, b) => (a.shown_from_ms ?? 0) - (b.shown_from_ms ?? 0))

const timeline = (passes: FloodPass[] = Object.values(P), products: FloodTimelineProduct[] = PRODUCTS): FloodTimelineResponse => testTimeline(NOW, passes, products)

describe('passes', () => {
  it('usable passes are clear or partly hidden; never no-view or unread', () => {
    expect(isUsablePass(P.before)).toBe(true)
    expect(isUsablePass(P.partly)).toBe(true)
    expect(isUsablePass(P.cloud)).toBe(false)
    expect(isUsablePass(P.unread)).toBe(false)
    expect(passesOf(timeline([P.latest, P.before])).map((p) => p.key)).toEqual([P.before.key, P.latest.key])
  })

  it('passAt: the latest usable pass at or before the handle, its age, the next one and the gap', () => {
    const all = Object.values(P)
    const on = passAt(all, P.partly.acquired_ms)
    expect(on.pass?.key).toBe(P.partly.key)
    expect(on.onPass).toBe(true)
    expect(on.ageMs).toBe(0)
    expect(on.next?.key).toBe(P.latest.key)
    expect(on.gapMs).toBe(2 * DAY_MS)
    // between the first pass and the partly hidden one: the no-view pass in the gap is listed, never drawn
    const mid = passAt(all, NOW - 9 * DAY_MS)
    expect(mid.pass?.key).toBe(P.before.key)
    expect(mid.onPass).toBe(false)
    expect(mid.ageMs).toBe(4 * DAY_MS)
    expect(mid.next?.key).toBe(P.partly.key)
    expect(mid.noViewBetween.map((p) => p.key)).toEqual([P.cloud.key])
    // the unread pass between the partly hidden one and the latest
    expect(passAt(all, NOW - 5.5 * DAY_MS).unreadBetween.map((p) => p.key)).toEqual([P.unread.key])
    // before the first pass: nothing to draw
    const early = passAt(all, NOW - 14 * DAY_MS)
    expect(early.pass).toBeNull()
    expect(early.next?.key).toBe(P.before.key)
    // after the last pass: no next
    const late = passAt(all, NOW - DAY_MS)
    expect(late.pass?.key).toBe(P.latest.key)
    expect(late.next).toBeNull()
    expect(late.gapMs).toBeNull()
    // a no-view pass is never chosen, even exactly at its time
    expect(passAt(all, P.cloud.acquired_ms).pass?.key).toBe(P.before.key)
  })

  it('the handle within 30 s of a pass is on it', () => {
    expect(passAt([P.latest], P.latest.acquired_ms - 20_000).onPass).toBe(true)
    expect(passAt([P.latest], P.latest.acquired_ms - 2 * MINUTE_MS).pass).toBeNull()
  })
})

describe('NWS product changes', () => {
  it('a step only where the drawing changes: issued, new area, cancelled, upgraded, its own end time', () => {
    const c = productChanges(PRODUCTS, NOW)
    expect(c.map((x) => `${x.product.id}:${x.kind}`)).toEqual(['a1:issued', 'b1:issued', 'a4:updated', 'b1:until', 'c1:issued', 'c2:upgraded', 'a5:cancelled', 'd1:issued'])
    // the CONs with the same area are not steps
    expect(c.some((x) => x.product.id === 'a2' || x.product.id === 'a3')).toBe(false)
  })

  it('a version issued again after its event was off the map counts as issued', () => {
    const gap = [version('e1', 'KMLB.FL.W.0009', 'NEW', T0, T0 + HOUR_MS), version('e2', 'KMLB.FL.W.0009', 'EXT', T0 + 5 * HOUR_MS, T0 + 9 * HOUR_MS)]
    expect(productChanges(gap, NOW).map((x) => `${x.product.id}:${x.kind}`)).toEqual(['e1:issued', 'e1:until', 'e2:issued', 'e2:until'])
  })

  it('no change after now (the views keep what is in effect now)', () => {
    const later = [version('f1', 'KMLB.FL.W.0010', 'NEW', NOW - HOUR_MS, NOW + 10 * HOUR_MS)]
    expect(productChanges(later, NOW).map((x) => x.kind)).toEqual(['issued'])
  })

  it('a version is shown from its issue time until shown_until (exclusive); open means still shown', () => {
    expect(versionShownAt(A[0], T0 - 1)).toBe(false)
    expect(versionShownAt(A[0], T0)).toBe(true)
    expect(versionShownAt(A[0], T0 + 12 * HOUR_MS)).toBe(false)
    expect(versionShownAt(A[4], A[4].shown_from_ms!)).toBe(false) // CAN: from == until
    expect(versionShownAt(D[0], NOW + DAY_MS)).toBe(true)
    // an ended version without an end time stops at its expiry
    const lost = version('g1', 'KMLB.FL.W.0011', 'NEW', T0, null, { phase: 'ended', expires_ms: T0 + 6 * HOUR_MS })
    expect(versionShownAt(lost, T0 + 5 * HOUR_MS)).toBe(true)
    expect(versionShownAt(lost, T0 + 7 * HOUR_MS)).toBe(false)
  })

  it('productsAt: before now the versions shown then; at and after now the live rule (C1)', () => {
    const live = [D[0]] as FloodAlert[]
    // between a1's issue and its replacement: a1 only (never two versions of one event)
    const r = productsAt(PRODUCTS, live, T0 + HOUR_MS, NOW)
    expect(r.source).toBe('timeline')
    expect(r.alerts.map((a) => a.id)).toEqual(['a1'])
    // later: a4 (new area) and b1
    expect(productsAt(PRODUCTS, live, T0 + 37 * HOUR_MS, NOW).alerts.map((a) => a.id).sort()).toEqual(['a4', 'b1'])
    // at now and after now: the live answer, brief 5's rule
    const atNow = productsAt(PRODUCTS, live, null, NOW)
    expect(atNow.source).toBe('live')
    expect(atNow.alerts.map((a) => a.id)).toEqual(['d1'])
    const future = productsAt(PRODUCTS, live, NOW + 6 * HOUR_MS, NOW)
    expect(future.source).toBe('live')
    expect(future.future).toBe(true)
    // no timeline products: the live answer at any time
    expect(productsAt(null, live, T0, NOW).source).toBe('live')
    expect(productsAt([], live, T0, NOW).source).toBe('live')
  })
})

describe('keyframes and steps', () => {
  const frames = floodKeyframes(timeline(), NOW)

  it('usable passes and NWS changes, oldest first, none after now', () => {
    expect(frames.map((f) => f.kind)).toEqual(['pass', 'pass', 'products', 'pass', 'products', 'products', 'products', 'products', 'products', 'products', 'products'])
    expect(frames.every((f, i) => i === 0 || f.t > frames[i - 1].t)).toBe(true)
    expect(frames.filter((f) => f.pass).map((f) => f.pass!.key)).toEqual([P.before.key, P.partly.key, P.latest.key])
    expect(frames[frames.length - 1].t).toBeLessThanOrEqual(NOW)
    // no step from the no-view or the unread pass
    expect(frames.some((f) => f.pass?.view === 'no_view' || f.pass?.view === 'unknown')).toBe(false)
  })

  it('NWS changes within 15 minutes are one step at the last of them; a change at a pass joins the pass', () => {
    const near = [version('h1', 'KMLB.FL.W.0020', 'NEW', NOW - 10 * HOUR_MS, null), version('h2', 'KMLB.FL.W.0021', 'NEW', NOW - 10 * HOUR_MS + 10 * MINUTE_MS, null)]
    const f = floodKeyframes(timeline([], near), NOW)
    expect(f).toHaveLength(1)
    expect(f[0].t).toBe(NOW - 10 * HOUR_MS + 10 * MINUTE_MS)
    expect(f[0].changes.map((c) => c.product.id)).toEqual(['h1', 'h2'])
    const atPass = [version('i1', 'KMLB.FL.W.0022', 'NEW', P.latest.acquired_ms + 10_000, null)]
    const g = floodKeyframes(timeline([P.latest], atPass), NOW)
    expect(g).toHaveLength(1)
    expect(g[0].kind).toBe('pass')
    expect(g[0].changes.map((c) => c.product.id)).toEqual(['i1'])
  })

  it('a products block that is not available gives pass steps only; no timeline gives none', () => {
    const tl = timeline()
    const down = { ...tl, products: { ...tl.products, status: 'unavailable' as const } }
    expect(floodKeyframes(down, NOW).every((f) => f.kind === 'pass')).toBe(true)
    expect(floodKeyframes(null, NOW)).toEqual([])
  })

  it('step: next and previous keyframe; now (null) is the last step', () => {
    expect(step(frames, null, 'next', NOW)).toBeNull()
    const back = step(frames, null, 'prev', NOW)
    expect(back).toEqual({ cursorMs: frames[frames.length - 1].t })
    expect(step(frames, frames[0].t, 'prev', NOW)).toBeNull()
    expect(step(frames, frames[0].t, 'next', NOW)).toEqual({ cursorMs: frames[1].t })
    expect(step(frames, frames[frames.length - 1].t, 'next', NOW)).toEqual({ cursorMs: null })
    // between two steps
    const mid = (frames[1].t + frames[2].t) / 2
    expect(step(frames, mid, 'next', NOW)).toEqual({ cursorMs: frames[2].t })
    expect(step(frames, mid, 'prev', NOW)).toEqual({ cursorMs: frames[1].t })
    // a handle after now steps back to now
    expect(step(frames, NOW + 5 * HOUR_MS, 'prev', NOW)).toEqual({ cursorMs: null })
    expect(step([], null, 'prev', NOW)).toBeNull()
    expect(keyframeIndexAt(frames, frames[3].t + 10_000)).toBe(3)
    expect(keyframeIndexAt(frames, null)).toBe(-1)
  })

  it('Play starts at the first step from now, else at the next step', () => {
    expect(playStart(frames, null, NOW)).toEqual({ cursorMs: frames[0].t })
    expect(playStart(frames, frames[1].t, NOW)).toEqual({ cursorMs: frames[2].t })
    expect(playStart([], null, NOW)).toBeNull()
  })
})

describe('labels', () => {
  it('a pass: its own time and its age before now; a partly hidden one says how much it did not see', () => {
    expect(passLabel(P.before, TF, NOW)).toBe('Satellite pass Oct 23, 11:00 EDT · 13 days before now')
    expect(passLabel(P.partly, TF, NOW)).toBe('Satellite pass Oct 30, 11:00 EDT · 6 days before now · no view of 65% of the area (clouds or no data)')
    expect(passLabel(P.before, TF, NOW, true)).toBe('Satellite pass Oct 23, 11:00 EDT')
    expect(beforeNowText(NOW - 5 * HOUR_MS, NOW)).toBe('5 hours before now')
    expect(beforeNowText(NOW - HOUR_MS, NOW)).toBe('1 hour before now')
    expect(beforeNowText(NOW - 20 * MINUTE_MS, NOW)).toBe('20 min before now')
    expect(beforeNowText(NOW - DAY_MS - 14 * HOUR_MS, NOW)).toBe('2 days before now')
    expect(hiddenPct({ clear_pct: null, cloud_pct: 30, nodata_pct: 10 })).toBe(40)
  })

  it('an NWS step names the product, its action and its own time (the event verbatim)', () => {
    const f = floodKeyframes(timeline([], PRODUCTS), NOW)
    const labels = f.map((x) => keyframeLabel(x, TF, NOW))
    expect(labels[0]).toEqual({ text: 'NWS Flood Warning issued Oct 31, 11:00 EDT', event: 'Flood Warning' })
    expect(labels.map((l) => l.text)).toContain('NWS Flood Warning updated Nov 1, 22:00 EST: new area')
    expect(labels.map((l) => l.text)).toContain('End time of the NWS Flood Warning: Nov 2, 02:00 EST · not an all-clear')
    expect(labels.map((l) => l.text)).toContain('NWS upgraded the Flood Watch Nov 2, 17:00 EST')
    expect(labels.map((l) => l.text)).toContain('NWS cancelled the Flood Warning Nov 3, 10:00 EST · not an all-clear')
    const two = floodKeyframes(timeline([], [version('h1', 'KMLB.FL.W.0020', 'NEW', NOW - 10 * HOUR_MS, null), version('h2', 'KMLB.FL.W.0021', 'NEW', NOW - 10 * HOUR_MS + 10 * MINUTE_MS, null)]), NOW)
    expect(keyframeLabel(two[0], TF, NOW).text).toBe('NWS Flood Warning issued Nov 5, 00:00 EST (+1 more NWS change by 00:10 EST)')
  })

  it('gap notes: the image the map shows with its own time, the gap, and the no-view passes in it', () => {
    const all = Object.values(P)
    const t = NOW - 9 * DAY_MS
    expect(gapNote(passAt(all, t), t, TF, NOW)).toBe(
      'Map: satellite image of Oct 23, 11:00 EDT (4 days before the handle) · No satellite image between Oct 23 and Oct 30 · 1 pass in between saw no view (clouds or no data)',
    )
    expect(gapNote(passAt(all, P.partly.acquired_ms), P.partly.acquired_ms, TF, NOW)).toBeNull()
    const early = NOW - 14 * DAY_MS
    expect(gapNote(passAt(all, early), early, TF, NOW)).toBe('No satellite image before Oct 23')
    const late = NOW - 2 * DAY_MS
    expect(gapNote(passAt(all, late), late, TF, NOW)).toBe('Map: satellite image of Nov 1, 10:00 EST (2 days before the handle) · No satellite image after Nov 1 yet')
    expect(gapNote(passAt([P.cloud], late), late, TF, NOW)).toBe('No usable satellite image in this flood’s window · 1 pass in between saw no view (clouds or no data)')
  })

  it('the summary at now counts the steps', () => {
    expect(playSummary(floodKeyframes(timeline(), NOW), TF, NOW)).toBe('3 satellite passes and 8 NWS product changes from Oct 23 · Play steps through them')
    expect(playSummary([], TF, NOW)).toBe('No satellite pass or NWS product change to step through yet. That is not an all-clear.')
  })

  it('every label passes the flood wording guard', () => {
    const f = floodKeyframes(timeline(), NOW)
    const texts = [...f.map((x) => keyframeLabel(x, TF, NOW).text), playSummary(f, TF, NOW)]
    for (const t of [NOW - 9 * DAY_MS, NOW - 14 * DAY_MS, NOW - DAY_MS]) texts.push(gapNote(passAt(Object.values(P), t), t, TF, NOW) ?? '')
    for (const t of texts) expect(floodWordingProblems(t), t).toEqual([])
  })
})
