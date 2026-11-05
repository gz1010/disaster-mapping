// The flood routes of the Disaster Mapping API (brief 5, CONTRACT §16.7; SPEC §6). Typed helpers next to api/client.ts (frozen):
// they reuse its fetchJson, ApiError and base URL. Every flood answer is its own type (api/floodTypes.ts); no fire
// helper changes. Query strings are pure (floods.test.ts).
import { API_BASE, fetchJson, type FetchOptions } from './client'
import type {
  FloodAlertsResponse,
  FloodDetailResponse,
  FloodListResponse,
  FloodLiveStatus,
  FloodMapKind,
  FloodMapResponse,
  JobStatus,
  ModelKind,
  ModelOutputResponse,
  RiverGaugesResponse,
  SatelliteWaterResponse,
} from './types'

const api = (path: string) => `${API_BASE}/api${path}`
const enc = encodeURIComponent

export type Bbox = [number, number, number, number]

/** "w,s,e,n" with 5 decimals (about 1 m): a stable cache key for nearby queries. */
export function bboxParam(b: Bbox): string {
  return b.map((v) => (Math.round(v * 1e5) / 1e5).toString()).join(',')
}

/** `/api/floods?mode=live` or `?mode=historical&year=`. */
export function floodListQuery(key: 'live' | number): string {
  return key === 'live' ? '/floods?mode=live' : `/floods?mode=historical&year=${key}`
}

export const getFloods = (key: 'live' | number, opts?: FetchOptions) => fetchJson<FloodListResponse>(api(floodListQuery(key)), opts)
export const getFloodStatus = (opts?: FetchOptions) => fetchJson<FloodLiveStatus>(api('/floods/status'), opts)
export const getFlood = (id: string, opts?: FetchOptions) => fetchJson<FloodDetailResponse>(api(`/floods/${enc(id)}`), opts)

export function postFloodBuild(id: string, force = false, opts?: FetchOptions) {
  return fetchJson<JobStatus>(api(`/floods/${enc(id)}/build${force ? '?force=1' : ''}`), { ...opts, method: 'POST' })
}

/** A flood bundle file (cache-busted with the manifest's built_ms). */
export function floodFileUrl(id: string, path: string, v?: number | string | null): string {
  const q = v != null ? `?v=${enc(String(v))}` : ''
  return api(`/floods/${enc(id)}/files/${path.split('/').map(enc).join('/')}${q}`)
}

export interface FloodAlertsQuery {
  flood?: string
  bbox?: Bbox
  atMs?: number | null
}

/** `/api/official/flood-alerts?flood=` or `?bbox=` (one is required; the route answers 422 without). */
export function floodAlertsQuery(q: FloodAlertsQuery): string {
  const p = new URLSearchParams()
  if (q.flood) p.set('flood', q.flood)
  else if (q.bbox) p.set('bbox', bboxParam(q.bbox))
  if (q.atMs != null && Number.isFinite(q.atMs)) p.set('at_ms', String(Math.round(q.atMs)))
  return `/official/flood-alerts?${p.toString()}`
}

export const getFloodAlerts = (q: FloodAlertsQuery, opts?: FetchOptions) => fetchJson<FloodAlertsResponse>(api(floodAlertsQuery(q)), opts)

export interface RiverGaugesQuery {
  flood?: string
  bbox?: Bbox
  lid?: string
  national?: boolean
  min?: 'action' | 'minor'
  series?: boolean
  atMs?: number | null
}

/** `/api/official/river-gauges?flood=|bbox=|lid=|scope=national&min=action&series=1&at_ms=`. */
export function riverGaugesQuery(q: RiverGaugesQuery): string {
  const p = new URLSearchParams()
  if (q.flood) p.set('flood', q.flood)
  else if (q.lid) p.set('lid', q.lid)
  else if (q.bbox) p.set('bbox', bboxParam(q.bbox))
  else if (q.national) p.set('scope', 'national')
  if (q.min) p.set('min', q.min)
  if (q.series) p.set('series', '1')
  if (q.atMs != null && Number.isFinite(q.atMs)) p.set('at_ms', String(Math.round(q.atMs)))
  return `/official/river-gauges?${p.toString()}`
}

export const getRiverGauges = (q: RiverGaugesQuery, opts?: FetchOptions) => fetchJson<RiverGaugesResponse>(api(riverGaugesQuery(q)), opts)

/** `/api/floods/{id}/maps?kind=&lid=&category=&at_ms=`. */
export function floodMapQuery(id: string, kind: FloodMapKind, o: { lid?: string; category?: string; atMs?: number | null } = {}): string {
  const p = new URLSearchParams({ kind })
  if (o.lid) p.set('lid', o.lid)
  if (o.category) p.set('category', o.category)
  if (o.atMs != null && Number.isFinite(o.atMs)) p.set('at_ms', String(Math.round(o.atMs)))
  return `/floods/${enc(id)}/maps?${p.toString()}`
}

export const getFloodMap = (id: string, kind: FloodMapKind, o?: { lid?: string; category?: string; atMs?: number | null }, opts?: FetchOptions) =>
  fetchJson<FloodMapResponse>(api(floodMapQuery(id, kind, o)), opts)

/** `/api/floods/{id}/model?kind=&lid=`: model output, never official information (CONTRACT §16.6). */
export function floodModelQuery(id: string, kind: ModelKind, lid?: string): string {
  const p = new URLSearchParams({ kind })
  if (lid) p.set('lid', lid)
  return `/floods/${enc(id)}/model?${p.toString()}`
}

export const getFloodModel = (id: string, kind: ModelKind, lid?: string, opts?: FetchOptions) => fetchJson<ModelOutputResponse>(api(floodModelQuery(id, kind, lid)), opts)

export function floodSatelliteQuery(id: string, atMs?: number | null): string {
  return `/floods/${enc(id)}/satellite${atMs != null && Number.isFinite(atMs) ? `?at_ms=${Math.round(atMs)}` : ''}`
}

export const getFloodSatellite = (id: string, atMs?: number | null, opts?: FetchOptions) => fetchJson<SatelliteWaterResponse>(api(floodSatelliteQuery(id, atMs)), opts)

/** A same-origin API path the backend sent (satellite image url "/api/floods/…/satellite.png?granule=…"). */
export function apiPathUrl(path: string): string {
  return path.startsWith('/api/') ? `${API_BASE}${path}` : path
}

/** The fire-only endpoints a flood view must never ask for (fetch-spy test, PLAN-5 §8). */
export const FIRE_ONLY_ENDPOINTS: readonly RegExp[] = [
  /\/api\/incidents\//,
  /\/api\/official\/fire-weather/,
  /\/api\/official\/calfire/,
  /\/api\/official\/incident-record/,
  /\/aircraft/,
]
