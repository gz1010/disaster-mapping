// The flood's time steps as the river-level chart needs them (brief 6, web-flood-playback M2): the steps, the passes,
// the state of the timeline answer, the chart's start while stepping, the NWS changes as ticks
// (usePlaybackView), and the words of the row above the plot at the handle (stepWords, pure). Rendered by
// HydrographPlayback.tsx.
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FloodPass } from '../../api/types'
import type { TimeFmt } from '../../lib/time'
import { changeLabel, floodKeyframes, gapNote, keyframeIndexAt, keyframeLabel, passAt, passesOf, playSummary, STEP_EPS_MS, type FloodKeyframe, type StepLabel } from '../../state/floodTimeline'
import { timelineFor, useFloodTimeline, useFloodTimelineSync } from '../../state/floodTimelineData'
import { PLAYBACK } from './floodPlaybackCopy'
import { playbackAxisStart, useFloodPlayback } from './floodPlayback'
import type { HydroProductTick } from './hydrographModel'

/** What the chart needs from the flood's time steps. */
export interface PlaybackView {
  floodId: string
  frames: FloodKeyframe[]
  passes: FloodPass[]
  /** 'none' (not asked), 'loading', 'available', 'unavailable' (the request failed with no answer). */
  status: 'none' | 'loading' | 'available' | 'unavailable'
  /** The backend's own words when there is no step (the passes' or products' reason), else null. */
  reason: string | null
  /** The chart's start while stepping (null: the usual 72 h). */
  startMs: number | null
  /** The NWS changes as chart ticks (null: the products' send times, brief 5). */
  ticks: HydroProductTick[] | null
  nowMs: number
  past: boolean
  /** The flood's zone (pass times). */
  tf: TimeFmt
}

/** The open flood's steps for the chart (asks the timeline while mounted). */
export function usePlaybackView(floodId: string, nowMs: number, past: boolean, tf: TimeFmt): PlaybackView {
  useFloodTimelineSync(floodId)
  const t = useFloodTimeline(useShallow((s) => ({ data: timelineFor(s, floodId), mine: s.floodId === floodId, loading: s.loading, error: s.error })))
  const engaged = useFloodPlayback((s) => s.engaged && s.floodId === floodId)
  const frames = useMemo(() => floodKeyframes(t.data, nowMs), [t.data, nowMs])
  const passes = useMemo(() => passesOf(t.data), [t.data])
  const ticks = useMemo(
    () => (t.data ? frames.flatMap((f) => f.changes.map((c) => ({ t: c.t, label: changeLabel(c, tf, nowMs).text, emergency: c.product.emergency }))) : null),
    [t.data, frames, tf, nowMs],
  )
  const status = t.data ? 'available' : !t.mine ? 'loading' : t.error ? 'unavailable' : 'loading'
  const reason = t.data && !frames.length ? (t.data.passes?.reason ?? t.data.products?.reason ?? null) : null
  return { floodId, frames, passes, status, reason, startMs: playbackAxisStart(frames, engaged, nowMs), ticks, nowMs, past, tf }
}

/** The words of the row at the handle. */
export function stepWords(view: PlaybackView, cursorMs: number | null): { label: StepLabel | null; gap: string | null; note: string | null; onStep: boolean } {
  const { frames, nowMs, tf, past } = view
  if (view.status === 'loading') return { label: null, gap: null, note: PLAYBACK.loading, onStep: false }
  if (view.status === 'unavailable') return { label: null, gap: null, note: PLAYBACK.unavailable, onStep: false }
  if (view.status !== 'available') return { label: null, gap: null, note: null, onStep: false }
  if (!frames.length) return { label: null, gap: null, note: [PLAYBACK.none, view.reason].filter(Boolean).join(' '), onStep: false }
  // at now: what Play steps through; after now the chart's own note says what the map keeps (C1)
  if (cursorMs == null) return { label: { text: playSummary(frames, tf, nowMs), event: null }, gap: null, note: null, onStep: false }
  if (cursorMs >= nowMs - STEP_EPS_MS) return { label: null, gap: null, note: null, onStep: false }
  const i = keyframeIndexAt(frames, cursorMs)
  const label = i >= 0 ? keyframeLabel(frames[i], tf, nowMs, past) : null
  const at = passAt(view.passes, cursorMs)
  const gap = view.passes.length ? gapNote(at, cursorMs, tf, nowMs) : null
  const noImage = at.onPass && at.pass && !at.pass.image ? PLAYBACK.noImage : null
  return { label, gap, note: noImage, onStep: i >= 0 }
}

