// Command's extra flood layers (brief 5, web-flood-command; PLAN-5 §4.5, D12, D22): the National Water Model's
// flooded area and high-flow reaches (model output, experimental, `/api/floods/{id}/model?kind=`) and NWS's category
// flood map for the primary gauge (`/api/floods/{id}/maps?kind=catfim&lid=&category=`, an official map library NWS
// calls experimental). Each is asked only while its Layers toggle is on and the Command flood view shows it; each
// keeps its own answer (never merged with official information or with each other). Read by the map module
// (map/floodController.ts), the readout's point check (location/FloodReadout.tsx) and the legend chips.
// One small store beside state/flood.ts (whose shape stays as it is): `useFloodLayerData`.
import { useEffect } from 'react'
import { create } from 'zustand'
import { ApiError, describeError } from '../api/client'
import { getFloodMap, getFloodModel } from '../api/floods'
import type { FloodCategory, FloodMapResponse, FloodSummary, ModelKind, ModelOutputResponse, RiverGauge } from '../api/types'
import { NO_ANSWER, primaryMemberGauge, type Answer } from '../official/floodModel'
import { useFloodOfficial } from '../official/floodHooks'
import { openFloodSummary, useFlood } from './flood'

export type FloodLayerDataKey = 'model' | 'highFlow' | 'catfim'

export interface FloodLayerDataState {
  floodId: string | null
  /** nwm_analysis: the model's flooded area now (model output). */
  model: Answer<ModelOutputResponse>
  /** nwm_high_flow: reaches above their high-water level (model output; `recur_cat` verbatim). */
  highFlow: Answer<ModelOutputResponse>
  /** catfim: NWS's category flood map for the primary gauge (official map library, experimental). */
  catfim: Answer<FloodMapResponse>
  /** The CatFIM answer's gauge and category ("ZZRF1|moderate"). */
  catfimFor: string | null
  asked: Partial<Record<FloodLayerDataKey, number>>
}

const EMPTY: Omit<FloodLayerDataState, 'floodId'> = { model: NO_ANSWER, highFlow: NO_ANSWER, catfim: NO_ANSWER, catfimFor: null, asked: {} }

export const useFloodLayerData = create<FloodLayerDataState>()(() => ({ floodId: null, ...EMPTY }))

/** Model output refreshes hourly on the server (analysis); NWS category maps are a library (30 days). */
export const FLOOD_LAYER_REFRESH_MS: Record<FloodLayerDataKey, number> = { model: 15 * 60_000, highFlow: 15 * 60_000, catfim: 6 * 3_600_000 }

const CATS: readonly FloodCategory[] = ['action', 'minor', 'moderate', 'major']
const isCategory = (c: string | null | undefined): c is FloodCategory => c != null && (CATS as readonly string[]).includes(c)

/** NWS's category flood map to show (D22): the primary gauge's NWS forecast category, else its observed category;
 *  null when neither is a flood category (nothing to map). */
export function catfimTarget(summary: Pick<FloodSummary, 'primary_gauge'> | null, gauges: unknown): { lid: string; category: FloodCategory } | null {
  const g: Pick<RiverGauge, 'lid' | 'forecast' | 'observed'> | null = primaryMemberGauge(gauges, summary)
  const ref = summary?.primary_gauge ?? null
  const lid = g?.lid ?? ref?.lid ?? null
  if (!lid) return null
  const fc = g?.forecast?.category ?? ref?.forecast_category ?? null
  if (isCategory(fc)) return { lid, category: fc }
  const ob = g?.observed.category ?? ref?.observed_category ?? null
  return isCategory(ob) ? { lid, category: ob } : null
}

/** What a Command layer shows while its toggle is on (review WFC-R9): 'drawn' (an available answer with something to
 *  draw), 'empty' (available, nothing to draw: "none"), 'unavailable' (its answer says it could not be loaded, or the
 *  request failed: never a silent layer, never "checking" forever), 'checking' (asked, no answer yet). */
export type ExtraLayerState = 'drawn' | 'empty' | 'unavailable' | 'checking'

export function extraLayerState(a: Answer<FloodMapResponse | ModelOutputResponse> | null | undefined): ExtraLayerState {
  const d = a?.data
  if (d) {
    if (d.status !== 'available') return 'unavailable'
    return (d.features?.features?.length ?? 0) > 0 ? 'drawn' : 'empty'
  }
  if (a?.error) return 'unavailable'
  return 'checking'
}

/** The reason to show for an unavailable layer: its answer's own words, else the request's error. */
export function extraLayerReason(a: Answer<FloodMapResponse | ModelOutputResponse> | null | undefined): string | null {
  const d = a?.data
  if (d && d.status !== 'available') return d.reason ?? null
  return d ? null : (a?.error ?? null)
}

const inflight = new Map<string, Promise<void>>()

function setAnswer<K extends FloodLayerDataKey>(key: K, floodId: string, a: FloodLayerDataState[K], extra: Partial<FloodLayerDataState> = {}) {
  if (useFloodLayerData.getState().floodId !== floodId) return
  useFloodLayerData.setState({ [key]: a, ...extra } as Partial<FloodLayerDataState>)
}

/** Ask one of the layers for the open flood (an answer for a flood no longer open is dropped). */
export function fetchFloodLayer(key: FloodLayerDataKey, s: FloodSummary, nowMs = Date.now()): Promise<void> {
  const target = key === 'catfim' ? catfimTarget(s, useFloodOfficial.getState().floodId === s.id ? useFloodOfficial.getState().gauges.data : null) : null
  const tag = `${s.id}|${key}|${target ? `${target.lid}|${target.category}` : ''}`
  const running = inflight.get(tag)
  if (running) return running
  if (useFloodLayerData.getState().floodId !== s.id) useFloodLayerData.setState({ floodId: s.id, ...EMPTY })
  useFloodLayerData.setState((x) => ({ [key]: { ...x[key], loading: true }, asked: { ...x.asked, [key]: nowMs } }) as Partial<FloodLayerDataState>)
  const fail = (e: unknown) => {
    const error = e instanceof ApiError && e.status === 404 ? 'Not found for this flood.' : describeError(e)
    setAnswer(key, s.id, { data: useFloodLayerData.getState()[key].data, loading: false, error } as never)
  }
  let run: Promise<void>
  if (key === 'catfim') {
    // the backend picks the primary gauge's category itself when none is given (and says when nothing applies)
    run = getFloodMap(s.id, 'catfim', target ? { lid: target.lid, category: target.category } : {})
      .then((data) => setAnswer('catfim', s.id, { data, loading: false, error: null }, { catfimFor: target ? `${target.lid}|${target.category}` : null }))
      .catch(fail)
  } else {
    const kind: ModelKind = key === 'model' ? 'nwm_analysis' : 'nwm_high_flow'
    run = getFloodModel(s.id, kind)
      .then((data) => setAnswer(key, s.id, { data, loading: false, error: null } as never))
      .catch(fail)
  }
  run = run.finally(() => inflight.delete(tag))
  inflight.set(tag, run)
  return run
}

/** Which layers to ask now: each only while its toggle is on (D12, D22); the high-flow reaches with the model. */
export function wantedLayerKeys(layers: { model: boolean; catfim: boolean; modelHighFlow?: boolean }): FloodLayerDataKey[] {
  const out: FloodLayerDataKey[] = []
  if (layers.model) out.push('model')
  if (layers.modelHighFlow) out.push('highFlow')
  if (layers.catfim) out.push('catfim')
  return out
}

/** Bring the store in step with the open flood and its toggles. */
export function syncFloodLayerData(nowMs = Date.now()): void {
  const fl = useFlood.getState()
  const s = openFloodSummary(fl)
  const st = useFloodLayerData.getState()
  if (!s) {
    if (st.floodId != null && fl.floodId == null) useFloodLayerData.setState({ floodId: null, ...EMPTY })
    return
  }
  if (st.floodId !== s.id) useFloodLayerData.setState({ floodId: s.id, ...EMPTY })
  const cur = useFloodLayerData.getState()
  const gauges = useFloodOfficial.getState().floodId === s.id ? useFloodOfficial.getState().gauges.data : null
  const target = catfimTarget(s, gauges)
  for (const key of wantedLayerKeys(fl.layers)) {
    const at = cur.asked[key]
    const stale = at == null || nowMs - at >= FLOOD_LAYER_REFRESH_MS[key]
    // the category map follows the primary gauge's category (a new forecast category asks again)
    const moved = key === 'catfim' && target != null && cur.catfimFor != null && cur.catfimFor !== `${target.lid}|${target.category}`
    if (stale || moved) void fetchFloodLayer(key, s, nowMs)
  }
}

/** Mounted by the Command flood chrome: asks the switched-on layers and keeps them fresh. */
export function useFloodLayerDataSync(): void {
  useEffect(() => {
    syncFloodLayerData()
    const unsub = useFlood.subscribe((s, p) => {
      if (s.floodId !== p.floodId || s.summary !== p.summary || s.layers !== p.layers) syncFloodLayerData()
    })
    const unsubG = useFloodOfficial.subscribe((s, p) => {
      if (s.gauges.data !== p.gauges.data) syncFloodLayerData()
    })
    const timer = window.setInterval(() => syncFloodLayerData(), 60_000)
    return () => {
      unsub()
      unsubG()
      window.clearInterval(timer)
    }
  }, [])
}


