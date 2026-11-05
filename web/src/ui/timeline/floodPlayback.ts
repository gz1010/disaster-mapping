// Play and step on the river-level chart (brief 6, web-flood-playback M2; BRIEF-6 decision 2). A small store beside
// state/flood.ts (whose `cursorMs` stays the one handle every view follows): whether Play runs, and whether the chart's
// time axis spans the flood's steps ("engaged": Play or a step was used, until the handle is back at now). Shared by
// Command's slim chart and Forensic's dock (one is mounted at a time).
//   - Play never starts by itself (no autoplay); it runs one step every PLAY_STEP_MS and stops at the latest step.
//   - Under prefers-reduced-motion Play never runs on a timer: each press shows the next step.
//   - Moving the handle by hand (drag, keys, NOW, another flood) pauses Play; back at now the axis returns to 72 h.
//   - Entering the Public view (no time handle) stops Play and puts the handle back at now (review WFP-R1).
import { create } from 'zustand'
import { useFlood } from '../../state/flood'
import { playStart, step, STEP_EPS_MS, type FloodKeyframe } from '../../state/floodTimeline'
import { isPublicView } from '../../state/floodTimelineData'
import { useWorkspace } from '../../state/workspace'
import { DAY_MS, HOUR_MS } from '../../lib/time'
import { HYDRO_PAST_MS } from './hydrographModel'

export interface FloodPlaybackState {
  /** The flood the state is for. */
  floodId: string | null
  playing: boolean
  /** The chart's axis spans the flood's steps (from the first step) until the handle is back at now. */
  engaged: boolean
}

export const useFloodPlayback = create<FloodPlaybackState>()(() => ({ floodId: null, playing: false, engaged: false }))

/** The handle value Play or a step set last (to tell a hand move apart); undefined: none. */
let lastSet: number | null | undefined

/** Move the handle to a step (null: now) as playback. */
export function moveHandle(floodId: string, cursorMs: number | null): void {
  lastSet = cursorMs
  if (useFloodPlayback.getState().floodId !== floodId) useFloodPlayback.setState({ floodId, playing: false, engaged: false })
  if (cursorMs != null) useFloodPlayback.setState({ engaged: true })
  useFlood.getState().setCursor(cursorMs)
}

export function setPlaying(floodId: string, playing: boolean): void {
  const s = useFloodPlayback.getState()
  if (s.floodId !== floodId) useFloodPlayback.setState({ floodId, playing, engaged: false })
  else if (s.playing !== playing) useFloodPlayback.setState({ playing })
}

/** The latest step Play goes to (before now). */
export function lastStep(frames: readonly FloodKeyframe[], nowMs: number): FloodKeyframe | null {
  const before = frames.filter((f) => f.t < nowMs - STEP_EPS_MS)
  return before[before.length - 1] ?? null
}

/** What a press of Play does: the handle's next value (null: now) and whether Play then keeps running. From now, after
 *  now, or at the latest step it starts again at the first step. Reduced motion: one step, never running. */
export function playPress(frames: readonly FloodKeyframe[], cursorMs: number | null, nowMs: number, reduced: boolean): { to: number | null; run: boolean } | null {
  const last = lastStep(frames, nowMs)
  if (!last) return null
  const atEnd = cursorMs == null || cursorMs >= last.t - STEP_EPS_MS
  const target = atEnd ? playStart(frames, null, nowMs) : step(frames, cursorMs, 'next', nowMs)
  if (!target || target.cursorMs == null) return null
  return { to: target.cursorMs, run: !reduced && Math.abs(target.cursorMs - last.t) > STEP_EPS_MS }
}

/** One tick of Play: the next step, or null to stop (at the latest step; Play never goes on to now by itself). */
export function playTick(frames: readonly FloodKeyframe[], cursorMs: number | null, nowMs: number): number | null {
  const r = step(frames, cursorMs, 'next', nowMs)
  return r && r.cursorMs != null ? r.cursorMs : null
}

/** Earliest the chart's axis reaches back (the flood window is at most 45 days). */
export const AXIS_MAX_PAST_MS = 45 * DAY_MS
/** Room before the first step. */
export const AXIS_PAD_MS = 6 * HOUR_MS

/** The chart's start while engaged: the first step less AXIS_PAD_MS (never later than the usual 72 h, never more than
 *  45 days back); null when not engaged or without steps (the usual 72 h). */
export function playbackAxisStart(frames: readonly FloodKeyframe[], engaged: boolean, nowMs: number): number | null {
  if (!engaged || !frames.length) return null
  const first = frames[0].t - AXIS_PAD_MS
  return Math.max(nowMs - AXIS_MAX_PAST_MS, Math.min(nowMs - HYDRO_PAST_MS, first))
}

/** Entering the Public view (it has no time handle; BRIEF-6 decision 2): Play stops and the handle goes back to now, so
 *  Public never shows a step Command or Forensic left (review WFP-R1). */
export function leavePlaybackForPublic(): void {
  const pb = useFloodPlayback.getState()
  if (pb.playing || pb.engaged) useFloodPlayback.setState({ playing: false, engaged: false })
  if (useFlood.getState().cursorMs != null) {
    lastSet = undefined
    useFlood.getState().setCursor(null)
  }
}

useWorkspace.subscribe((s, p) => {
  if (isPublicView(s) && !isPublicView(p)) leavePlaybackForPublic()
})

// the handle back at now ends the stepping (the axis returns to 72 h); a hand move pauses Play; another flood resets
useFlood.subscribe((s, p) => {
  const pb = useFloodPlayback.getState()
  if (s.floodId !== p.floodId) {
    lastSet = undefined
    if (pb.playing || pb.engaged || pb.floodId !== s.floodId) useFloodPlayback.setState({ floodId: s.floodId, playing: false, engaged: false })
    return
  }
  if (s.cursorMs === p.cursorMs) return
  const byPlayback = lastSet !== undefined && s.cursorMs === lastSet
  lastSet = undefined
  if (s.cursorMs == null) {
    if (pb.playing || pb.engaged) useFloodPlayback.setState({ playing: false, engaged: false })
  } else if (pb.playing && !byPlayback) useFloodPlayback.setState({ playing: false })
})
