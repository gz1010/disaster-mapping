// The river-level chart's data (brief 5, web-flood-command M1; PLAN-5 §4.6): one gauge with its series
// (`/api/official/river-gauges?lid=&series=1`, official) and, only in flow mode for a gauge with an NWM reach, the
// National Water Model series (`/api/floods/{id}/model?kind=nwm_series&lid=`, experimental model output, D12, D20).
// The two answers are kept apart (never merged); each refreshes on its own interval while a chart shows it (the server
// caches series 10 min). A small store shared by every chart (Command's slim chart, Forensic's dock), so two charts of
// one gauge ask once.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { ApiError, describeError, fetchJson } from '../../api/client'
import { getFloodModel, getRiverGauges } from '../../api/floods'
import type { GaugeReading, ModelOutputResponse, RiverGauge, RiverGaugesResponse } from '../../api/types'
import { fmtRelative, HOUR_MS } from '../../lib/time'
import type { Units } from '../../state/workspace'
import { fmtStage } from '../public/floodOverviewText'
import { categoryOf, categoryWord } from './hydrographModel'
import { NO_ANSWER, type Answer, type AnswerState } from '../../official/floodModel'

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

/** A gauge's newest reading: its status reading, or the last row of its observed series when that is newer (NWPS's
 *  status can lag its own series by hours). A series reading's category is NWS's levels compared with the stage
 *  (the chart's rule), else the status category. */
export function newestReading(g: RiverGauge): GaugeReading {
  const rows = g.series?.observed ?? []
  const last = rows.length ? rows[rows.length - 1] : null
  const t = g.observed.valid_ms
  if (!last || last[1] == null || !Number.isFinite(last[0]) || (t != null && Number.isFinite(t) && t >= last[0])) return g.observed
  const unit = g.series?.stage_unit ?? g.observed.unit
  const th = g.thresholds
  const same = th && (th.unit ?? 'ft').toLowerCase() === (unit ?? 'ft').toLowerCase()
  const category = same ? (categoryOf(last[1], { action: th.action ?? undefined, minor: th.minor ?? undefined, moderate: th.moderate ?? undefined, major: th.major ?? undefined }) ?? g.observed.category) : g.observed.category
  return { value: last[1], unit, flow: last[2], flow_unit: g.series?.flow_unit ?? g.observed.flow_unit, category, valid_ms: last[0] }
}

/** The chart's own reading of a gauge (its `?lid=` answer with the series) when it is newer than `g`'s: one reading
 *  per gauge everywhere (the per-flood gauges answer can lag the per-gauge one; review WFP-R2's rule). */
export function withChartReading(g: RiverGauge, chart: RiverGauge | null | undefined): RiverGauge {
  if (!chart || chart.lid !== g.lid) return g
  const own = newestReading(chart)
  const a = g.observed.valid_ms
  const b = own.valid_ms
  if (b == null || !Number.isFinite(b) || (a != null && Number.isFinite(a) && a >= b)) return g
  return { ...g, observed: own }
}

/** The newest cached chart answer's gauge for a lid (now, not a past time), else null. */
export function useChartGauge(lid: string | null | undefined): RiverGauge | null {
  return useHydroData((s) => (lid ? gaugeOf(s.gauges[gaugeKey(lid, null)]?.data, lid) : null))
}

/** Command's bar line for a gauge reading: "AGYM7 · 26.6 FT · MODERATE" (`main`, in the workspace's units like the
 *  readout, the map and the chart; review WFC-R6) and " · 1 H AGO" (`age`, amber after 3 h, kept on a narrow bar; review
 *  WFC-R15). */
export function gaugeLineParts(lid: string, r: Pick<GaugeReading, 'value' | 'unit' | 'category' | 'valid_ms'> | null, units: Units, nowMs: number): { main: string; age: string | null; stale: boolean } {
  const value = fmtStage(r?.value, r?.unit ?? 'ft', units)?.toUpperCase() ?? null
  const main = [lid, value, r ? categoryWord(r.category) : null].filter(Boolean).join(' · ')
  const age = r?.valid_ms != null ? ` · ${fmtRelative(r.valid_ms, nowMs).toUpperCase()}` : null
  return { main, age, stale: r?.valid_ms != null && nowMs - r.valid_ms > 3 * HOUR_MS }
}

// ------------------------------------------------------------------------------------------------ a point's gauges
/** The point's own gauges answers, per URL (the last few points; re-selecting one shows it at once; tests seed it). */
export const pointGaugeCache = new Map<string, { data: RiverGaugesResponse | null; error: string | null; at: number }>()
const POINT_GAUGES_FRESH_MS = 5 * 60_000

/** The gauges answer of Command's selected point (`location/floodCheck.ts pointGaugesUrl`: the point ± 25 km), asked
 *  only when the flood's own gauges answer does not cover the point's 25 km (review WFC-R2); null url: not asked. */
export function usePointGauges(url: string | null): { data: RiverGaugesResponse | null; state: AnswerState } {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!url) return
    const hit = pointGaugeCache.get(url)
    if (hit && Date.now() - hit.at < POINT_GAUGES_FRESH_MS) return
    const ctrl = new AbortController()
    fetchJson<RiverGaugesResponse>(url, { signal: ctrl.signal })
      .then((data) => pointGaugeCache.set(url, { data, error: null, at: Date.now() }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) pointGaugeCache.set(url, { data: hit?.data ?? null, error: describeError(e), at: Date.now() })
      })
      .finally(() => {
        if (ctrl.signal.aborted) return
        while (pointGaugeCache.size > 12) pointGaugeCache.delete(pointGaugeCache.keys().next().value as string)
        setTick((t) => t + 1)
      })
    return () => ctrl.abort()
  }, [url])
  if (!url) return { data: null, state: 'none' }
  const q = pointGaugeCache.get(url)
  const data = q?.data ?? null
  const state: AnswerState = data ? (data.status === 'available' ? 'available' : data.status === 'not_available_for_past_dates' ? 'past' : 'unavailable') : q?.error ? 'unavailable' : 'loading'
  return { data, state }
}
