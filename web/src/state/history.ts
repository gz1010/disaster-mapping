// Browser history for the California overview (brief 2, O-R1; CONTRACT §13 shell). Opening a fire is a navigation:
// every explicit change of useStore.incidentId (fire card, search, picker, "All fires") pushes an entry
// (?incident=<id>, or none for the overview), so Back returns to the overview or to the previous fire. A zoom focus or
// zoom-out (decision 10, incidentSource 'zoom') and the not-found fallback replace the entry instead: Back steps through
// explicit opens only and never leads to a dead link. Back / Forward apply the entry: its incident (an explicit open,
// source 'history', without a build; or closeIncident), its ?t= once the bundle is ready, and its ?ws=. Every other URL
// change stays replaceState (state/runtime.ts useUrlSync, state/workspace.ts useWorkspaceUrlSync). Pure helpers:
// history.test.ts.
// Brief 5 (CONTRACT §16.10, C21): an open flood is ?flood=<id> (pushState as a fire is), never together with
// ?incident=. A hazard switch closes the other event first; that close writes no entry (state/floodNav.ts
// crossingHazard), so fire → flood and flood → fire are one entry each and Back crosses back. A flood that is no longer
// listed (404), a lists outage (503) and an alias answer (the canonical id) replace the entry. Back / Forward apply the
// entry's flood and its hazard (?hazard=flood) too.
import { useEffect } from 'react'
import { useFlood } from './flood'
import { isCrossingHazard, isReplacingHistory } from './floodNav'
import { readUrlParams } from './runtime'
import { useStore } from './store'
import { parseWorkspaceParams, useWorkspace } from './workspace'

/** history.state of the entries Fire-3d writes. `fromOverview`: pushed when a fire was opened from the overview, so
 *  "All fires" can go back instead of stacking another overview entry. Brief 5: true only when no event at all (fire or
 *  flood) was open just before, so the back buttons never go Back to the other hazard's event (review WFO-R1). `flood`:
 *  the open flood; optional, so entries written before brief 5 still parse. */
export interface HistoryEntryState {
  fire3d: 1
  incident: string | null
  flood?: string | null
  fromOverview: boolean
}

export function isHistoryEntry(v: unknown): v is HistoryEntryState {
  return typeof v === 'object' && v != null && (v as { fire3d?: unknown }).fire3d === 1
}

/** The ?incident= of a query string (empty = none). */
export function incidentParam(search: string): string | null {
  return new URLSearchParams(search).get('incident') || null
}

/** The ?flood= of a query string (empty = none). A link with both ?incident= and ?flood= opens the fire: no flood. */
export function floodParam(search: string): string | null {
  const q = new URLSearchParams(search)
  return q.get('incident') ? null : q.get('flood') || null
}

export type HistoryWrite = 'push' | 'replace' | 'none'

/** How an incident change is recorded: nothing when the address bar already says it (deep link, Back / Forward), a
 *  replacement for the not-found fallback and for zoom focus changes, else a new entry. */
export function historyWrite(urlIncident: string | null, nextIncident: string | null, notFound: boolean, zoom = false): HistoryWrite {
  if (urlIncident === nextIncident) return 'none'
  return notFound || zoom ? 'replace' : 'push'
}

/** The address of a navigation to `incident` (null = the overview): ?t= and ?mode= belong to the previous fire and the
 *  one-shot ?view= / ?sel= are dropped; workspace parameters stay. Brief 5: ?flood= is dropped too (never beside
 *  ?incident=; a stale one left by a link with both would reopen that flood on reload), unless `floodOpen` says a flood
 *  is open. Returns path + query + hash. */
export function navigationUrl(href: string, incident: string | null, floodOpen = false): string {
  const u = new URL(href)
  const p = u.searchParams
  if (incident) p.set('incident', incident)
  else p.delete('incident')
  if (incident || !floodOpen) p.delete('flood')
  for (const k of ['t', 'mode', 'view', 'sel']) p.delete(k)
  return `${u.pathname}${u.search}${u.hash}`
}

/** A start-up link with both ?incident= and ?flood= opens the fire and drops `flood` (CONTRACT §16.1): the address to
 *  put in its place (path + query + hash), or null when the link does not have both. */
export function linkWithBothUrl(href: string): string | null {
  const u = new URL(href)
  if (!u.searchParams.get('incident') || !u.searchParams.has('flood')) return null
  u.searchParams.delete('flood')
  return `${u.pathname}${u.search}${u.hash}`
}

/** The address of a navigation to flood `flood` (null = the flood overview): drops ?incident= and the fire's ?t= /
 *  ?mode=, and the one-shot ?view= / ?sel=; workspace parameters (?hazard=flood among them) stay. */
export function floodNavigationUrl(href: string, flood: string | null): string {
  const u = new URL(href)
  const p = u.searchParams
  if (flood) p.set('flood', flood)
  else p.delete('flood')
  for (const k of ['incident', 't', 'mode', 'view', 'sel']) p.delete(k)
  return `${u.pathname}${u.search}${u.hash}`
}

/** Apply ?t= once `id`'s bundle is ready (it may still be loading or building). Returns an unsubscribe. */
export function applyTimeWhenReady(id: string, t: number): () => void {
  const apply = () => {
    const s = useStore.getState()
    if (s.incidentId !== id) return true
    if (s.manifest?.status !== 'ready' || s.manifest.id !== id) return false
    s.setTimeMs(t)
    return true
  }
  if (apply()) return () => undefined
  const unsub = useStore.subscribe(() => {
    if (apply()) unsub()
  })
  return unsub
}

let pendingTime: (() => void) | null = null

/** Back / Forward: make the stores match the address bar's entry. */
export function applyLocation(): void {
  pendingTime?.()
  pendingTime = null
  const q = readUrlParams()
  const ws = parseWorkspaceParams(window.location.search).workspace
  if (ws && ws !== useWorkspace.getState().workspace) useWorkspace.getState().setWorkspace(ws)
  const st = useStore.getState()
  const flood = floodParam(window.location.search)
  if (!q.incident) {
    // the entry's hazard (?hazard=flood, or its open flood); an entry without one lists fires
    const hz = parseWorkspaceParams(window.location.search).hazard ?? 'fire'
    if (flood) {
      if (flood !== useFlood.getState().floodId) void useFlood.getState().openFlood(flood, { source: 'history' })
      return
    }
    if (st.incidentId != null) st.closeIncident()
    if (useFlood.getState().floodId != null) useFlood.getState().closeFlood()
    if (useWorkspace.getState().hazard !== hz) useWorkspace.getState().setHazard(hz)
    return
  }
  const id = q.incident
  const t = q.t
  if (id !== st.incidentId) {
    void st.selectIncident(id, { source: 'history' }).then(() => {
      if (t != null && useStore.getState().incidentId === id) pendingTime = applyTimeWhenReady(id, t)
    })
  } else if (t != null) pendingTime = applyTimeWhenReady(id, t)
}

/** Record incident and flood changes as history entries and follow Back / Forward; returns the uninstall. */
export function installHistorySync(): () => void {
  // Set while the other hazard's event closes for a switch (crossingHazard): the entry of the event that opens next is
  // then not "from the overview" (review WFO-R1), so "Back to all floods" / "Back to all fires" close the event (one
  // push to its overview) instead of going Back to the other hazard's event. Cleared by that next entry, and at the end
  // of the current task in any case (the close and the open of a switch run in one synchronous step).
  let crossed = false
  const markCrossed = () => {
    crossed = true
    queueMicrotask(() => {
      crossed = false
    })
  }
  const takeCrossed = () => {
    const c = crossed
    crossed = false
    return c
  }
  const unsub = useStore.subscribe((s, p) => {
    if (s.incidentId === p.incidentId) return
    // a fire closed on the way to a flood: the flood's entry is the switch (C21)
    if (isCrossingHazard()) {
      markCrossed()
      return
    }
    // a flood was open just before (closed for this switch, or about to be): not opened from the overview
    const fromEvent = takeCrossed() || useFlood.getState().floodId != null
    const notFound = s.incidentId == null && p.incidentId != null && s.missingIncidentId === p.incidentId
    const write = isReplacingHistory() ? 'replace' : historyWrite(incidentParam(window.location.search), s.incidentId, notFound, s.incidentSource === 'zoom')
    if (write === 'none') return
    const url = navigationUrl(window.location.href, s.incidentId, useFlood.getState().floodId != null)
    const state: HistoryEntryState = { fire3d: 1, incident: s.incidentId, flood: null, fromOverview: write === 'push' && p.incidentId == null && s.incidentId != null && !fromEvent }
    if (write === 'push') window.history.pushState(state, '', url)
    else window.history.replaceState(state, '', url)
  })
  const unsubFlood = useFlood.subscribe((s, p) => {
    if (s.floodId === p.floodId) return
    // a flood closed on the way to a fire: the fire's entry is the switch
    if (isCrossingHazard()) {
      markCrossed()
      return
    }
    // a fire was open just before (openFlood closes it first): not opened from the overview
    const fromEvent = takeCrossed() || useStore.getState().incidentId != null
    const urlFlood = floodParam(window.location.search)
    const write = isReplacingHistory() ? (urlFlood === s.floodId ? 'none' : 'replace') : historyWrite(urlFlood, s.floodId, false)
    if (write === 'none') return
    const url = floodNavigationUrl(window.location.href, s.floodId)
    const state: HistoryEntryState = { fire3d: 1, incident: null, flood: s.floodId, fromOverview: write === 'push' && p.floodId == null && s.floodId != null && !fromEvent }
    if (write === 'push') window.history.pushState(state, '', url)
    else window.history.replaceState(state, '', url)
  })
  const onPop = () => applyLocation()
  window.addEventListener('popstate', onPop)
  return () => {
    unsub()
    unsubFlood()
    window.removeEventListener('popstate', onPop)
    pendingTime?.()
    pendingTime = null
  }
}

/** Record incident and flood changes as history entries and follow Back / Forward. Mounted once (App); active from the
 *  start, so a dead start-up link is replaced too. */
export function useHistorySync(): void {
  useEffect(() => installHistorySync(), [])
}
