// The river-level chart's data (brief 5, web-flood-command M1; PLAN-5 §4.6): one gauge with its series
// (`/api/official/river-gauges?lid=&series=1`, official) and, only in flow mode for a gauge with an NWM reach, the
// National Water Model series (`/api/floods/{id}/model?kind=nwm_series&lid=`, experimental model output, D12, D20).
// The two answers are kept apart (never merged); each refreshes on its own interval while a chart shows it (the server
// caches series 10 min). A small store shared by every chart (Command's slim chart, Forensic's dock), so two charts of
// one gauge ask once.
import { useEffect } from 'react'
import { create } from 'zustand'
import { ApiError, describeError } from '../../api/client'
import { getFloodModel, getRiverGauges } from '../../api/floods'
import type { ModelOutputResponse, RiverGauge, RiverGaugesResponse } from '../../api/types'
import { NO_ANSWER, type Answer } from '../../official/floodModel'

/** How often a shown chart asks again (the server caches series 10 min). */
export const HYDRO_REFRESH_MS = 10 * 60_000

interface HydroDataState {
  gauges: Record<string, Answer<RiverGaugesResponse>>
  models: Record<string, Answer<ModelOutputResponse>>
  asked: Record<string, number>
}

export const useHydroData = create<HydroDataState>()(() => ({ gauges: {}, models: {}, asked: {} }))

export const gaugeKey = (lid: string, atMs: number | null | undefined) => `g|${lid}|${atMs ?? ''}`
export const modelKey = (floodId: string, lid: string) => `m|${floodId}|${lid}`

const inflight = new Map<string, Promise<void>>()

function errorText(e: unknown): string {
  return e instanceof ApiError && e.status === 404 ? 'Not found.' : describeError(e)
}

/** Ask a gauge's series (kept until a newer answer arrives; a failed refresh keeps the last answer). */
export function fetchHydroGauge(lid: string, atMs: number | null, nowMs = Date.now()): Promise<void> {
  const key = gaugeKey(lid, atMs)
  const running = inflight.get(key)
  if (running) return running
  useHydroData.setState((s) => ({ gauges: { ...s.gauges, [key]: { ...(s.gauges[key] ?? NO_ANSWER), loading: true } }, asked: { ...s.asked, [key]: nowMs } }))
  const run = getRiverGauges({ lid, series: true, atMs })
    .then((data) => useHydroData.setState((s) => ({ gauges: { ...s.gauges, [key]: { data, loading: false, error: null } } })))
    .catch((e: unknown) => useHydroData.setState((s) => ({ gauges: { ...s.gauges, [key]: { data: s.gauges[key]?.data ?? null, loading: false, error: errorText(e) } } })))
    .finally(() => inflight.delete(key))
  inflight.set(key, run)
  return run
}

/** Ask the model series of a flood's gauge (model output, its own answer). */
export function fetchHydroModel(floodId: string, lid: string, nowMs = Date.now()): Promise<void> {
  const key = modelKey(floodId, lid)
  const running = inflight.get(key)
  if (running) return running
  useHydroData.setState((s) => ({ models: { ...s.models, [key]: { ...(s.models[key] ?? NO_ANSWER), loading: true } }, asked: { ...s.asked, [key]: nowMs } }))
  const run = getFloodModel(floodId, 'nwm_series', lid)
    .then((data) => useHydroData.setState((s) => ({ models: { ...s.models, [key]: { data, loading: false, error: null } } })))
    .catch((e: unknown) => useHydroData.setState((s) => ({ models: { ...s.models, [key]: { data: s.models[key]?.data ?? null, loading: false, error: errorText(e) } } })))
    .finally(() => inflight.delete(key))
  inflight.set(key, run)
  return run
}

/** The gauge of an answer (the one asked for by lid). */
export function gaugeOf(resp: RiverGaugesResponse | null | undefined, lid: string): RiverGauge | null {
  if (!resp || resp.status !== 'available') return null
  return resp.gauges.find((g) => g.lid === lid) ?? resp.gauges[0] ?? null
}

/** A chart's data: the gauge's series always, the model only when `wantModel` (flow mode with a reach). */
export function useHydrographData(
  floodId: string | null,
  lid: string | null,
  o: { wantModel: boolean; atMs?: number | null },
): { gauge: Answer<RiverGaugesResponse>; model: Answer<ModelOutputResponse> | null } {
  const atMs = o.atMs ?? null
  const gKey = lid ? gaugeKey(lid, atMs) : null
  const mKey = floodId && lid && o.wantModel ? modelKey(floodId, lid) : null
  const gauge = useHydroData((s) => (gKey ? s.gauges[gKey] : undefined)) ?? NO_ANSWER
  const model = useHydroData((s) => (mKey ? s.models[mKey] : undefined)) ?? null
  useEffect(() => {
    if (!lid) return
    const tick = () => {
      const now = Date.now()
      const asked = useHydroData.getState().asked
      const g = gaugeKey(lid, atMs)
      if (asked[g] == null || now - asked[g] >= HYDRO_REFRESH_MS) void fetchHydroGauge(lid, atMs, now)
      if (floodId && o.wantModel) {
        const m = modelKey(floodId, lid)
        if (asked[m] == null || now - asked[m] >= HYDRO_REFRESH_MS) void fetchHydroModel(floodId, lid, now)
      }
    }
    tick()
    const timer = window.setInterval(tick, 60_000)
    return () => window.clearInterval(timer)
  }, [floodId, lid, atMs, o.wantModel])
  return { gauge, model: mKey ? (model ?? { data: null, loading: true, error: null }) : null }
}
