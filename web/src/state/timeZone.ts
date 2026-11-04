// Which zone and which clock the UI's times use (CONTRACT §14.9.4).
//
// - Clock: 12-hour in the map workspace's Public preset ("3:40 PM MDT"); 24-hour in Command and in Forensic
//   ("15:40 MDT") (BRIEF-3 round 2 item 8).
// - Zone: the open fire's `summary.time_zone`; with no fire open, the zone of the place the location card shows
//   (from /api/geo/lookup, set with `setPlaceZone`); else the viewer's own zone, labelled as such. Never Pacific by
//   default. Overview rows and hovers use each row's own zone (`useTimeFormatFor(row.time_zone)`).
// Components use the hooks; pure helpers take the TimeFmt as an argument; imperative code (the map controller) reads
// `getTimeFormat()`.
// Brief 5 (CONTRACT §16.10): an open flood's `summary.time_zone` (IANA) is the zone of its views, zone source 'flood'
// (useEventZoneSource). For lib/time.ts zoneLine, which knows 'fire' | 'place' | 'viewer', a flood's zone is the local
// time at the flood's place ('place').
import { create } from 'zustand'
import { isValidZone, timeFmt, type Clock, type TimeFmt } from '../lib/time'
import { openFloodSummary, useFlood, type FloodState } from './flood'
import { useStore } from './store'
import { useWorkspace, type Preset, type Workspace } from './workspace'

export type ZoneSource = 'fire' | 'place' | 'viewer'
/** Brief 5: where the zone comes from, flood included. */
export type EventZoneSource = ZoneSource | 'flood'

/** '12h' in the map workspace's Public preset, else '24h'. */
export function clockFor(workspace: Workspace, preset: Preset): Clock {
  return workspace === 'map' && preset === 'public' ? '12h' : '24h'
}

interface PlaceZoneState {
  /** IANA zone of the selected place without a fire (from /api/geo/lookup); null = none known. */
  placeZone: string | null
  setPlaceZone: (tz: string | null) => void
}

/** The zone of the place the location card shows when no fire is open (written by the location card). */
export const usePlaceZone = create<PlaceZoneState>()((set) => ({
  placeZone: null,
  setPlaceZone: (tz) => set({ placeZone: tz && isValidZone(tz) ? tz : null }),
}))

/** A summary's own zone when it is a valid IANA zone, else null. */
export function zoneOf(summary: { time_zone?: string | null } | null | undefined): string | null {
  const tz = summary?.time_zone
  return tz && isValidZone(tz) ? tz : null
}

/** The open fire's zone (null when no fire is open or its summary has no valid zone). */
function fireZone(s: { incidentId: string | null; summary: { id: string; time_zone?: string | null } | null }): string | null {
  if (!s.incidentId || !s.summary || s.summary.id !== s.incidentId) return null
  return zoneOf(s.summary)
}

/** The open flood's zone (null when no flood is open or its summary has no valid zone). */
function floodZone(s: Pick<FloodState, 'floodId' | 'summary'>): string | null {
  return zoneOf(openFloodSummary(s))
}

/** Where the current zone comes from: the open fire, the selected place, or the viewer's device (a flood's zone counts
 *  as its place's: pass it as `place`). */
export function zoneSourceOf(fire: string | null, place: string | null): ZoneSource {
  return fire ? 'fire' : place ? 'place' : 'viewer'
}

/** The same with the open flood: fire, then flood, then place, then viewer. */
export function eventZoneSourceOf(fire: string | null, flood: string | null, place: string | null): EventZoneSource {
  return fire ? 'fire' : flood ? 'flood' : place ? 'place' : 'viewer'
}

/** The clock of the current workspace and preset. */
export function useClock(): Clock {
  return useWorkspace((s) => clockFor(s.workspace, s.preset))
}

/** The open fire's zone (else the selected place's, else the viewer's) with the current clock. Stable identity. */
export function useTimeFormat(): TimeFmt {
  const clock = useClock()
  const fire = useStore(fireZone)
  const flood = useFlood(floodZone)
  const place = usePlaceZone((s) => s.placeZone)
  return timeFmt(fire ?? flood ?? place, clock)
}

/** The current clock in another zone (an overview row's own `time_zone`, a point's lookup zone). */
export function useTimeFormatFor(tz: string | null | undefined): TimeFmt {
  return timeFmt(tz, useClock())
}

/** Same words as zoneLine's `whose`: 'fire', 'place' or 'viewer'. */
export function useZoneSource(): ZoneSource {
  const fire = useStore(fireZone)
  const flood = useFlood(floodZone)
  const place = usePlaceZone((s) => s.placeZone)
  return zoneSourceOf(fire, flood ?? place)
}

/** Brief 5: the zone source with 'flood' for an open flood. */
export function useEventZoneSource(): EventZoneSource {
  const fire = useStore(fireZone)
  const flood = useFlood(floodZone)
  const place = usePlaceZone((s) => s.placeZone)
  return eventZoneSourceOf(fire, flood, place)
}

/** Non-hook read of `useTimeFormat()` for imperative code (the map controller, event handlers). */
export function getTimeFormat(): TimeFmt {
  const ws = useWorkspace.getState()
  return timeFmt(fireZone(useStore.getState()) ?? floodZone(useFlood.getState()) ?? usePlaceZone.getState().placeZone, clockFor(ws.workspace, ws.preset))
}

/** Non-hook read of `useZoneSource()`. */
export function getZoneSource(): ZoneSource {
  return zoneSourceOf(fireZone(useStore.getState()), floodZone(useFlood.getState()) ?? usePlaceZone.getState().placeZone)
}

/** Non-hook read of `useEventZoneSource()`. */
export function getEventZoneSource(): EventZoneSource {
  return eventZoneSourceOf(fireZone(useStore.getState()), floodZone(useFlood.getState()), usePlaceZone.getState().placeZone)
}
