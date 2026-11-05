// The flood lists' pure transitions (brief 5, CONTRACT §16.10; the twin of state/catalog.ts for fires): one slot per
// list key ('live', '2026', '2025'), each with its answer, loading flag, error text and HTTP status. A failed reload
// keeps the last answer (the list stays usable, its notice says it could not be refreshed). Tests: floodCatalog.test.ts.
import type { FloodListResponse, FloodSummary } from '../api/types'

export type FloodListKey = 'live' | number

export interface FloodListSlot {
  response: FloodListResponse | null
  loading: boolean
  error: string | null
  /** HTTP status of the last failure (503: the lists could not be reached); null when fine or not an HTTP error. */
  status: number | null
}

/** The past years with a tab (PLAN-5 §3.6, CONTRACT §16.8 PAST_YEARS). */
export const FLOOD_PAST_YEARS = [2026, 2025] as const

export const EMPTY_SLOT: FloodListSlot = { response: null, loading: false, error: null, status: null }

/** The record key of a list ('live' or the year as a string). */
export function slotKey(key: FloodListKey): string {
  return key === 'live' ? 'live' : String(key)
}

export function getSlot(lists: Record<string, FloodListSlot>, key: FloodListKey): FloodListSlot {
  return lists[slotKey(key)] ?? EMPTY_SLOT
}

export function slotPending(lists: Record<string, FloodListSlot>, key: FloodListKey): Record<string, FloodListSlot> {
  const k = slotKey(key)
  const cur = lists[k] ?? EMPTY_SLOT
  return { ...lists, [k]: { ...cur, loading: true } }
}

export function slotApply(lists: Record<string, FloodListSlot>, key: FloodListKey, response: FloodListResponse): Record<string, FloodListSlot> {
  return { ...lists, [slotKey(key)]: { response, loading: false, error: null, status: null } }
}

export function slotFail(lists: Record<string, FloodListSlot>, key: FloodListKey, error: string, status: number | null): Record<string, FloodListSlot> {
  const k = slotKey(key)
  const cur = lists[k] ?? EMPTY_SLOT
  return { ...lists, [k]: { ...cur, loading: false, error, status } }
}

/** A flood by id (or alias) in any loaded list, live first. */
export function findFloodIn(lists: Record<string, FloodListSlot>, id: string): FloodSummary | null {
  const keys = ['live', ...Object.keys(lists).filter((k) => k !== 'live')]
  for (const k of keys) {
    const f = lists[k]?.response?.floods.find((x) => x.id === id || x.aliases.includes(id))
    if (f) return f
  }
  return null
}
