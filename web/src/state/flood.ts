// The flood store (brief 5, PLAN-5 §4.1, CONTRACT §16.10): floods live beside fires, never inside the fire store. It
// holds the flood lists (live and the past years, pure transitions in floodCatalog.ts), the open flood (summary from the
// detail route, manifest, build job), the hydrograph's gauge and handle, the flood map layers and the "Show watches"
// switch. Race-guarded like state/store.ts: an answer for a flood that is no longer open is dropped.
// One event at a time: opening a flood closes an open fire (useStore.closeIncident) and a fire that opens closes the
// flood (the subscription below; store.ts is frozen). Each switch is one history entry (state/floodNav.ts flags;
// state/history.ts writes the entries). Opening a flood sets the workspace hazard to 'flood'; a fire opening sets 'fire'.
// The detail route answers with the canonical id (rule 13): an alias opens the canonical flood and replaces the URL.
// 404 closes the flood with missingReason 'not_listed' (FLOOD_NOT_LISTED on the flood overview), 503 with 'lists_down'
// (FLOOD_LISTS_503, never "not found").
// Who writes what (C10): web-flood-overview (this file: lists, open/close, URL, layers, watches; startFloodBuild a typed
// stub) and web-flood-public (manifest loading, startFloodBuild, job polling). From wave 3 the shape changes only
// additively, announced in web-flood-command's contract5 note. Forensic keeps its own toggles.
// Dev handle: window.__flood.
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { ApiError, describeError } from '../api/client'
import { getFlood, getFloods } from '../api/floods'
import type { FloodDetailResponse, FloodManifest, FloodSummary, JobStatus } from '../api/types'
import { EMPTY_SLOT, findFloodIn, getSlot, slotApply, slotFail, slotKey, slotPending, type FloodListKey, type FloodListSlot } from './floodCatalog'
import { crossingHazard, replacingHistory } from './floodNav'
import { WATCHES_SHOWN_BY_DEFAULT } from './floodOverview'
import { useStore } from './store'
import { useWorkspace } from './workspace'

export type { FloodListKey, FloodListSlot } from './floodCatalog'

/** Flood map layers (CONTRACT §16.10-16.11). What a view draws is this AND its profile (map/floodProfile.ts). */
export type FloodLayerKey = 'events' | 'gauges' | 'warnings' | 'forecastArea' | 'satellite' | 'channel' | 'floodplain' | 'model' | 'catfim'

/** FEMA floodplain, model output and NWS category maps start off (D12, D21, D22); everything else on. */
export const DEFAULT_FLOOD_LAYERS: Record<FloodLayerKey, boolean> = {
  events: true,
  gauges: true,
  warnings: true,
  forecastArea: true,
  satellite: true,
  channel: true,
  floodplain: false,
  model: false,
  catfim: false,
}

export type FloodSource = 'list' | 'marker' | 'url' | 'search' | 'history' | 'card' | null

export interface FloodState {
  lists: Record<string, FloodListSlot>
  filter: FloodListKey
  showWatches: boolean
  floodId: string | null
  summary: FloodSummary | null
  manifest: FloodManifest | null
  job: JobStatus | null
  source: FloodSource
  missingFloodId: string | null
  missingReason: 'not_listed' | 'lists_down' | null
  /** Additive (web-flood-overview): where the detail route found the open flood (rule 13); 'bundle' and 'last_known'
   *  make the views show FLOOD_LAST_KNOWN. null while loading or without an answer. */
  resolvedFrom: FloodDetailResponse['resolved_from'] | null
  /** Additive: the detail request for the open flood is on its way. */
  detailLoading: boolean
  /** Additive: the last detail request failed for another reason than 404 / 503 (the list's summary stays shown). */
  detailError: string | null
  gaugeLid: string | null
  cursorMs: number | null
  layers: Record<FloodLayerKey, boolean>

  loadFloods(key?: FloodListKey): Promise<void>
  openFlood(id: string, opts?: { source?: FloodSource; replace?: boolean }): Promise<void>
  closeFlood(opts?: { replace?: boolean }): void
  startFloodBuild(force?: boolean): Promise<void>
  setFilter(key: FloodListKey): void
  setShowWatches(on: boolean): void
  setGauge(lid: string | null): void
  setCursor(ms: number | null): void
  setFloodLayer(k: FloodLayerKey, on: boolean): void
}

/** What the open flood resets to when it closes or another opens. */
const CLOSED = {
  floodId: null,
  summary: null,
  manifest: null,
  job: null,
  source: null,
  resolvedFrom: null,
  detailLoading: false,
  detailError: null,
  gaugeLid: null,
  cursorMs: null,
} as const

let openToken = 0
const listSeq: Record<string, number> = {}

const statusOf = (e: unknown): number | null => (e instanceof ApiError ? e.status : null)

export const useFlood: UseBoundStore<StoreApi<FloodState>> = create<FloodState>()((set, get) => ({
  lists: { live: EMPTY_SLOT },
  filter: 'live',
  showWatches: WATCHES_SHOWN_BY_DEFAULT,
  ...CLOSED,
  missingFloodId: null,
  missingReason: null,
  layers: { ...DEFAULT_FLOOD_LAYERS },

  loadFloods: async (key) => {
    const k = key ?? get().filter
    const sk = slotKey(k)
    const seq = (listSeq[sk] = (listSeq[sk] ?? 0) + 1)
    set((s) => ({ lists: slotPending(s.lists, k) }))
    try {
      const res = await getFloods(k)
      if (seq === listSeq[sk]) set((s) => ({ lists: slotApply(s.lists, k, res) }))
    } catch (e) {
      if (seq === listSeq[sk]) set((s) => ({ lists: slotFail(s.lists, k, describeError(e), statusOf(e)) }))
    }
  },

  openFlood: async (id, opts) => {
    const token = ++openToken
    const write = () => {
      // one event at a time: the fire closes first, without a history entry of its own (C21)
      if (useStore.getState().incidentId != null) crossingHazard(() => useStore.getState().closeIncident())
      const s = get()
      const same = s.floodId === id
      const row = findFloodIn(s.lists, id)
      set({
        ...(same ? {} : CLOSED),
        floodId: id,
        summary: same ? (s.summary ?? row) : row,
        source: opts?.source ?? null,
        missingFloodId: null,
        missingReason: null,
        detailLoading: true,
        detailError: null,
      })
    }
    if (opts?.replace) replacingHistory(write)
    else write()
    useWorkspace.getState().setHazard('flood')
    try {
      const d = await getFlood(id)
      if (token !== openToken || get().floodId !== id) return
      const canonical = d.summary.id
      const apply = () =>
        set({
          floodId: canonical,
          summary: d.summary,
          manifest: d.manifest,
          job: d.job,
          resolvedFrom: d.resolved_from,
          detailLoading: false,
          detailError: null,
        })
      // an alias (rule 13): the canonical flood, and the address bar says its id (replace, never a new entry)
      if (canonical !== id) replacingHistory(apply)
      else apply()
    } catch (e) {
      if (token !== openToken || get().floodId !== id) return
      const status = statusOf(e)
      const listsDown = status === 503
      if (status === 404 || listsDown || get().summary == null) {
        // gone (or nothing to show while the lists cannot be reached): back to the flood overview with a notice; the
        // dead link is replaced, never left as an entry Back leads to
        replacingHistory(() => set({ ...CLOSED, missingFloodId: id, missingReason: status === 404 ? 'not_listed' : 'lists_down' }))
        return
      }
      set({ detailLoading: false, detailError: describeError(e) })
    }
  },

  closeFlood: (opts) => {
    openToken++
    if (get().floodId == null) return
    const write = () => set({ ...CLOSED })
    if (opts?.replace) replacingHistory(write)
    else write()
  },

  // A typed stub: web-flood-public implements the build, job polling and manifest loading (C10, PLAN-5 §4.1).
  startFloodBuild: async () => undefined,

  setFilter: (filter) => {
    if (slotKey(filter) === slotKey(get().filter)) return
    set({ filter })
    const slot = getSlot(get().lists, filter)
    if (!slot.response && !slot.loading) void get().loadFloods(filter)
  },
  setShowWatches: (showWatches) => set((s) => (s.showWatches === showWatches ? {} : { showWatches })),
  setGauge: (gaugeLid) => set({ gaugeLid }),
  setCursor: (cursorMs) => set({ cursorMs: cursorMs != null && Number.isFinite(cursorMs) ? cursorMs : null }),
  setFloodLayer: (k, on) => set((s) => (s.layers[k] === on ? {} : { layers: { ...s.layers, [k]: on } })),
}))

/** Open a flood's view for the current preset (Public → the Public flood view, Command → the Command flood view
 *  directly, D14; Forensic → its flood branch): one history entry. */
export function pickFlood(id: string, source: FloodState['source']): void {
  useWorkspace.getState().setFireCard(null)
  void useFlood.getState().openFlood(id, { source })
}

/** "Back to all floods": history-aware like the fire's goToOverview: a flood opened from the overview goes Back (no
 *  second overview entry), else it closes (one push). The workspace keeps listing floods. */
export function goToFloodOverview(): void {
  const s = useFlood.getState()
  if (s.floodId == null) return
  const h = typeof window !== 'undefined' ? (window.history.state as { fire3d?: unknown; fromOverview?: unknown; flood?: unknown } | null) : null
  if (h && h.fire3d === 1 && h.fromOverview === true && h.flood === s.floodId) {
    window.history.back()
    return
  }
  s.closeFlood()
}

/** The open flood's summary when it is the one shown (it can lag a render behind a switch). */
export function openFloodSummary(s: Pick<FloodState, 'floodId' | 'summary'>): FloodSummary | null {
  return s.floodId != null && s.summary && (s.summary.id === s.floodId || s.summary.aliases.includes(s.floodId)) ? s.summary : null
}

// A fire that opens closes the flood (one event at a time), without a history entry of its own: the fire's entry is
// the switch (C21). The workspace then lists fires again.
useStore.subscribe((s, p) => {
  if (s.incidentId === p.incidentId || s.incidentId == null) return
  if (useFlood.getState().floodId != null) crossingHazard(() => useFlood.getState().closeFlood())
  if (useWorkspace.getState().hazard !== 'fire') useWorkspace.getState().setHazard('fire')
})

declare global {
  interface Window {
    /** Dev/test handle: window.__flood.getState() (scripts/shot.mjs --eval). */
    __flood?: typeof useFlood
  }
}

if (typeof window !== 'undefined') window.__flood = useFlood
