// Whether the national river gauge layer could be read (brief 5, review WFO-R8; PLAN-5 D24 "outages per layer"). The
// flood map module (map/floodController.ts) asks /api/official/river-gauges?scope=national&min=action and, when that
// answer is unavailable or the request fails, draws only the listed floods' own member gauges. This small store says
// so, so the flood legend and the list foot can tell the reader that gauges outside the listed floods are missing
// (never a silent gap that reads as "no gauge in flood here").
import { create } from 'zustand'

export type NationalGaugeStatus = 'idle' | 'loading' | 'available' | 'unavailable'

export interface NationalGaugeState {
  status: NationalGaugeStatus
  /** When the answer last arrived (or failed), epoch ms. */
  atMs: number | null
  set(status: NationalGaugeStatus): void
}

export const useNationalGauges = create<NationalGaugeState>()((set) => ({
  status: 'idle',
  atMs: null,
  set: (status) => set((s) => (s.status === status ? {} : { status, atMs: status === 'loading' ? s.atMs : Date.now() })),
}))

/** The national gauge answer could not be read (unavailable or failed): the map shows member gauges only. */
export function nationalGaugesDown(s: Pick<NationalGaugeState, 'status'>): boolean {
  return s.status === 'unavailable'
}
