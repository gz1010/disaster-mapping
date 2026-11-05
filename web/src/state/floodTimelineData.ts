// The open flood's time history (brief 6, web-flood-playback M1; contract6/backend-flood-time-3d.md): one small store
// beside state/flood.ts, read by the river-level chart's time steps (ui/timeline/Hydrograph.tsx), the 2D map
// (map/floodController.ts) and Forensic's drapes (scene/flood/**). It asks GET /api/floods/{id}/timeline?wait=0, asks
// again every few seconds while the route says a block is not complete (passes still being read, an NWS feed down),
// then every 2 minutes (the NWS alerts cache), and drops an answer for a flood that is no longer open.
// `useFloodTimelineSync(floodId)` keeps it running while a view that needs it is mounted (the chart mounts it).
// Dev handle: window.__floodTimeline.
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { API_BASE, describeError, fetchJson } from '../api/client'
import type { FloodAlertsResponse, FloodTimelineResponse, SatelliteWaterResponse } from '../api/types'
import { productsAtHandle, satelliteAtHandle, type ProductsAtHandleZones } from '../map/floodAreaLayers'
import { officialAlerts } from '../official/floodModel'
import { useNow } from '../ui/hooks'
import { useFlood } from './flood'
import { useWorkspace, type WorkspaceState } from './workspace'

export interface FloodTimelineState {
  /** The flood the answer is for (null: none asked). */
  floodId: string | null
  data: FloodTimelineResponse | null
  loading: boolean
  /** The last request's error (the last answer, if any, stays). */
  error: string | null
  /** When the last answer arrived (wall clock). */
  receivedMs: number | null
}

export const useFloodTimeline = create<FloodTimelineState>()(() => ({ floodId: null, data: null, loading: false, error: null, receivedMs: null }))

/** Ask again this soon while a block is not complete (the backend reads passes 3 at a time, about 3 s each). */
export const TIMELINE_POLL_MS = 4_000
/** At most this many quick asks in a row; then the slow refresh. */
export const TIMELINE_MAX_POLLS = 45
/** A complete answer is asked again after this (the NWS alerts cache is 2 min). */
export const TIMELINE_REFRESH_MS = 2 * 60_000
/** After a failed request. */
export const TIMELINE_RETRY_MS = 30_000

/** `/floods/{id}/timeline?wait=0` (the route waits up to `wait` s for unread passes; the web asks with 0 and polls). */
export function floodTimelineQuery(id: string, wait = 0): string {
  return `/floods/${encodeURIComponent(id)}/timeline?wait=${Math.max(0, Math.min(30, Math.round(wait)))}`
}

export const getFloodTimeline = (id: string, wait = 0) => fetchJson<FloodTimelineResponse>(`${API_BASE}/api${floodTimelineQuery(id, wait)}`)

/** A block is still being completed: ask again soon. */
export function timelineIncomplete(d: Pick<FloodTimelineResponse, 'passes' | 'products'> | null | undefined): boolean {
  return d != null && (d.passes?.complete === false || d.products?.complete === false)
}

/** 'none' (not asked), 'loading' (no answer yet), 'available', 'unavailable' (the request failed with no answer). */
export function timelineState(s: Pick<FloodTimelineState, 'data' | 'loading' | 'error'>): 'none' | 'loading' | 'available' | 'unavailable' {
  if (s.data) return 'available'
  if (s.error) return 'unavailable'
  return s.loading ? 'loading' : 'none'
}

/** The timeline of `floodId` from the store (null when it holds another flood's). */
export function timelineFor(s: Pick<FloodTimelineState, 'floodId' | 'data'>, floodId: string | null | undefined): FloodTimelineResponse | null {
  return floodId != null && s.floodId === floodId && s.data && s.data.flood_id != null ? s.data : null
}

let inflight: { id: string; run: Promise<void> } | null = null

/** Ask the route once for `id` (an answer for a flood no longer asked is dropped). */
export function fetchFloodTimeline(id: string): Promise<void> {
  if (inflight && inflight.id === id) return inflight.run
  if (useFloodTimeline.getState().floodId !== id) useFloodTimeline.setState({ floodId: id, data: null, loading: false, error: null, receivedMs: null })
  useFloodTimeline.setState({ loading: true })
  const run = getFloodTimeline(id, 0)
    .then((data) => {
      if (useFloodTimeline.getState().floodId !== id) return
      useFloodTimeline.setState({ data, loading: false, error: null, receivedMs: Date.now() })
    })
    .catch((e: unknown) => {
      if (useFloodTimeline.getState().floodId !== id) return
      useFloodTimeline.setState({ loading: false, error: describeError(e) })
    })
    .finally(() => {
      if (inflight?.run === run) inflight = null
    })
  inflight = { id, run }
  return run
}

// one schedule for the open flood, shared by every mounted view
let users = 0
let current: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let polls = 0

function clearTimer() {
  if (timer) clearTimeout(timer)
  timer = null
}

function schedule(id: string, delay: number) {
  clearTimer()
  timer = setTimeout(() => void tick(id), delay)
}

async function tick(id: string) {
  if (current !== id || users <= 0) return
  await fetchFloodTimeline(id)
  if (current !== id || users <= 0) return
  const s = useFloodTimeline.getState()
  if (s.error && !s.data) return schedule(id, TIMELINE_RETRY_MS)
  if (timelineIncomplete(s.data) && polls < TIMELINE_MAX_POLLS) {
    polls += 1
    return schedule(id, TIMELINE_POLL_MS)
  }
  polls = 0
  schedule(id, s.error ? TIMELINE_RETRY_MS : TIMELINE_REFRESH_MS)
}

function start(id: string) {
  if (current === id && timer) return
  current = id
  polls = 0
  if (useFloodTimeline.getState().floodId !== id) useFloodTimeline.setState({ floodId: id, data: null, loading: false, error: null, receivedMs: null })
  void tick(id)
}

function stop() {
  clearTimer()
  current = null
  polls = 0
}

/** Keep the open flood's timeline asked while the calling view is mounted (null: nothing). */
export function useFloodTimelineSync(floodId: string | null | undefined): void {
  useEffect(() => {
    if (!floodId) return
    users += 1
    start(floodId)
    return () => {
      users -= 1
      // another view still mounted keeps the schedule
      if (users <= 0) {
        users = 0
        stop()
      }
    }
  }, [floodId])
}

/** The Public view is on screen (the map workspace in the Public preset; Forensic keeps the preset it came from). */
export const isPublicView = (s: Pick<WorkspaceState, 'workspace' | 'preset'>): boolean => s.workspace === 'map' && s.preset === 'public'

/** The handle a view follows: Public has no time handle (BRIEF-6 decision 2; review WFP-R1), so it always shows now,
 *  whatever handle Command or Forensic left; elsewhere the chart's handle (null = now). */
export function handleFor(publicView: boolean, cursorMs: number | null): number | null {
  return publicView ? null : cursorMs
}

/** The open flood's handle for the view on screen (handleFor). */
export function useFloodHandleMs(): number | null {
  const cursorMs = useFlood((s) => s.cursorMs)
  const pub = useWorkspace(isPublicView)
  return handleFor(pub, cursorMs)
}

/** The satellite answer the 2D views show at the chart's handle (map/floodAreaLayers.ts satelliteAtHandle): the
 *  route's own answer at now (and always in Public); before now the pass at the handle (its own date), or none before
 *  the first pass. */
export function useSatelliteAtHandle(base: SatelliteWaterResponse | null | undefined): SatelliteWaterResponse | null {
  const floodId = useFlood((s) => s.floodId)
  const cursorMs = useFloodHandleMs()
  const tl = useFloodTimeline((s) => timelineFor(s, floodId))
  const nowMs = useNow(60_000)
  return useMemo(() => satelliteAtHandle(base, tl, cursorMs, nowMs), [base, tl, cursorMs, nowMs])
}

/** The NWS products at the handle with their zones (map/floodAreaLayers.ts productsAtHandle): what the map draws, for
 *  the point checks (review WFP-R2) and the archive's credit (WFP-R3). `live`: the flood-alerts answer. */
export function useProductsAtHandle(live: FloodAlertsResponse | null | undefined): ProductsAtHandleZones & { timeline: FloodTimelineResponse | null } {
  const floodId = useFlood((s) => s.floodId)
  const cursorMs = useFloodHandleMs()
  const tl = useFloodTimeline((s) => timelineFor(s, floodId))
  const nowMs = useNow(60_000)
  return useMemo(() => ({ ...productsAtHandle(live, officialAlerts(live), tl, cursorMs, nowMs), timeline: tl }), [live, tl, cursorMs, nowMs])
}

declare global {
  interface Window {
    /** Dev/test handle: window.__floodTimeline.getState(). */
    __floodTimeline?: typeof useFloodTimeline
  }
}

if (typeof window !== 'undefined') window.__floodTimeline = useFloodTimeline
