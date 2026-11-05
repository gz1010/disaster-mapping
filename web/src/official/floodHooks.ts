// The open flood's official answers (brief 5, PLAN-5 §3.8, §4.4; C10): one small store, `useFloodOfficial`, filled by
// `useFloodOfficialSync()` (mounted by the flood chromes) and read by the facts, the key, the distance chip, the point
// card, Command's "Official now" and the map module (map/floodController.ts subscribes to the store). Each answer is
// its own request and keeps its own envelope (never merged): NWS flood products (`/api/official/flood-alerts?flood=`),
// the river gauges (`/api/official/river-gauges?flood=`), the NWS forecast flooded area (`maps?kind=rfc_fim`), water
// seen by satellite (`satellite`), the FEMA floodplain (`maps?kind=nfhl`, only while its layer is on, D21) and the local
// officials' messages for the flood's area (`local-alerts?bbox=&hazard=flood`). Model output is not fetched here
// (Command fetches it itself, never into an official answer). Each answer refreshes on its own interval; a failed
// refresh keeps the last answer and its own times; a new flood starts empty. A past flood asks at its last product's
// time (the backend answers from the archive or says "not available for past dates").
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { ApiError, API_BASE, describeError, fetchJson } from '../api/client'
import { apiPathUrl, floodFileUrl, getFloodAlerts, getFloodMap, getFloodSatellite, getRiverGauges } from '../api/floods'
import type { FloodAlertsResponse, FloodManifest, FloodMapResponse, FloodSummary, RiverGaugesResponse, SatelliteWaterResponse } from '../api/types'
import { lonLatToLocal } from '../lib/reproject'
import type { SatClassAt } from '../location/floodCheck'
import { openFloodSummary, useFlood } from '../state/flood'
import { floodArea } from '../state/selectors'
import { useNow } from '../ui/hooks'
import { polygonsOf } from '../ui/public/floodView'
import { NO_ANSWER, officialAlerts, productsDrawn, type Answer } from './floodModel'
import type { LocalAlertsResponse } from './types'

export type FloodOfficialKey = 'alerts' | 'gauges' | 'fim' | 'satellite' | 'nfhl' | 'local'

export interface FloodOfficialState {
  /** The flood the answers are for (null: none open). */
  floodId: string | null
  alerts: Answer<FloodAlertsResponse>
  gauges: Answer<RiverGaugesResponse>
  fim: Answer<FloodMapResponse>
  satellite: Answer<SatelliteWaterResponse>
  nfhl: Answer<FloodMapResponse>
  local: Answer<LocalAlertsResponse>
  /** When each answer was last asked for (ms). */
  asked: Partial<Record<FloodOfficialKey, number>>
}

const EMPTY: Omit<FloodOfficialState, 'floodId'> = { alerts: NO_ANSWER, gauges: NO_ANSWER, fim: NO_ANSWER, satellite: NO_ANSWER, nfhl: NO_ANSWER, local: NO_ANSWER, asked: {} }

export const useFloodOfficial = create<FloodOfficialState>()(() => ({ floodId: null, ...EMPTY }))

/** How often each answer is asked again while the flood is open (CONTRACT §16.7 server caches). */
export const FLOOD_OFFICIAL_REFRESH_MS: Record<FloodOfficialKey, number> = {
  alerts: 120_000,
  gauges: 300_000,
  fim: 900_000,
  satellite: 1_800_000,
  nfhl: 86_400_000,
  local: 120_000,
}

/** The local officials' messages for an area, flood keywords (`hazard=flood`). */
export function floodLocalAlertsUrl(b: readonly [number, number, number, number]): string {
  return `${API_BASE}/api/official/local-alerts?bbox=${b.map((v) => Math.round(v * 1e4) / 1e4).join(',')}&hazard=flood`
}

/** A past flood's answers are asked at its last NWS product's time; a live flood's now (null). */
export function askedAt(s: Pick<FloodSummary, 'mode' | 'last_product_ms' | 'updated_ms' | 'ended_ms'>): number | null {
  if (s.mode !== 'historical') return null
  return s.last_product_ms ?? s.ended_ms ?? s.updated_ms ?? null
}

type Fetcher = (s: FloodSummary, atMs: number | null) => Promise<unknown>

const FETCH: Record<FloodOfficialKey, Fetcher> = {
  alerts: (s, atMs) => getFloodAlerts({ flood: s.id, atMs }),
  gauges: (s, atMs) => getRiverGauges({ flood: s.id, atMs }),
  fim: (s, atMs) => getFloodMap(s.id, 'rfc_fim', { atMs }),
  satellite: (s, atMs) => getFloodSatellite(s.id, atMs),
  nfhl: (s) => getFloodMap(s.id, 'nfhl'),
  local: (s) => {
    const b = floodArea(s.bbox_lonlat)
    return b ? fetchJson<LocalAlertsResponse>(floodLocalAlertsUrl(b)) : Promise.reject(new Error('The flood has no area to check.'))
  },
}

/** Which answers a flood view needs now: the FEMA floodplain only while its layer is on (D21); local officials'
 *  messages only for a live flood (current status). */
export function wantedKeys(s: Pick<FloodSummary, 'mode'>, layers: { floodplain: boolean }): FloodOfficialKey[] {
  const keys: FloodOfficialKey[] = ['alerts', 'gauges', 'fim', 'satellite']
  if (layers.floodplain) keys.push('nfhl')
  if (s.mode !== 'historical') keys.push('local')
  return keys
}

const inflight = new Map<string, Promise<void>>()

/** Ask one answer for the open flood (kept in the store; an answer for a flood no longer open is dropped). */
export async function fetchFloodOfficial(key: FloodOfficialKey, s: FloodSummary, nowMs = Date.now()): Promise<void> {
  const tag = `${s.id}|${key}`
  const running = inflight.get(tag)
  if (running) return running
  const st = useFloodOfficial.getState()
  if (st.floodId !== s.id) useFloodOfficial.setState({ floodId: s.id, ...EMPTY })
  useFloodOfficial.setState((x) => ({ [key]: { ...x[key], loading: true }, asked: { ...x.asked, [key]: nowMs } }) as Partial<FloodOfficialState>)
  const run = FETCH[key](s, askedAt(s))
    .then((data) => {
      if (useFloodOfficial.getState().floodId !== s.id) return
      useFloodOfficial.setState({ [key]: { data, loading: false, error: null } } as Partial<FloodOfficialState>)
    })
    .catch((e: unknown) => {
      if (useFloodOfficial.getState().floodId !== s.id) return
      const error = e instanceof ApiError && e.status === 404 ? 'Not found for this flood.' : describeError(e)
      useFloodOfficial.setState((x) => ({ [key]: { data: x[key].data, loading: false, error } }) as Partial<FloodOfficialState>)
    })
    .finally(() => inflight.delete(tag))
  inflight.set(tag, run)
  return run
}

/** Bring the store in step with the open flood: empty when none is open; a new flood starts empty; each wanted answer
 *  is asked when it was never asked or its refresh time has passed. */
export function syncFloodOfficial(nowMs = Date.now()): void {
  const fl = useFlood.getState()
  const s = openFloodSummary(fl)
  const st = useFloodOfficial.getState()
  if (!s) {
    if (st.floodId != null && fl.floodId == null) useFloodOfficial.setState({ floodId: null, ...EMPTY })
    return
  }
  if (st.floodId !== s.id) useFloodOfficial.setState({ floodId: s.id, ...EMPTY })
  const asked = useFloodOfficial.getState().asked
  for (const key of wantedKeys(s, fl.layers)) {
    const at = asked[key]
    if (at == null || nowMs - at >= FLOOD_OFFICIAL_REFRESH_MS[key]) void fetchFloodOfficial(key, s, nowMs)
  }
}

/** Mounted by each flood chrome: keeps the open flood's official answers fresh while it is shown. */
export function useFloodOfficialSync(): void {
  useEffect(() => {
    syncFloodOfficial()
    const unsub = useFlood.subscribe((s, p) => {
      if (s.floodId !== p.floodId || s.summary !== p.summary || s.layers.floodplain !== p.layers.floodplain) syncFloodOfficial()
    })
    const timer = window.setInterval(() => syncFloodOfficial(), 30_000)
    return () => {
      unsub()
      window.clearInterval(timer)
    }
  }, [])
}

export type Ring = [number, number][]

/** The flood's areas for the chip and the leader: NWS products in effect now (polygons, else their zones' outlines)
 *  and the NWS forecast flooded area. */
export function useFloodAreas(): { warnings: Ring[][]; forecast: Ring[][] } {
  const { alerts, fim } = useFloodOfficial(useShallow((s) => ({ alerts: s.alerts.data, fim: s.fim.data })))
  const nowMs = useNow(60_000)
  return useMemo(() => {
    const inEffect = productsDrawn(officialAlerts(alerts), null, nowMs).alerts
    const ids = new Set(inEffect.map((a) => a.id))
    const warnings: Ring[][] = inEffect.flatMap((a) => polygonsOf(a.geometry))
    // zone-based products (most watches): their zones' outlines
    for (const z of alerts?.zones?.features ?? []) if (z.properties.alert_ids.some((id) => ids.has(id))) warnings.push(...polygonsOf(z.geometry))
    const forecast: Ring[][] = fim && fim.status === 'available' ? fim.features.features.flatMap((f) => polygonsOf(f.geometry)) : []
    return { warnings, forecast }
  }, [alerts, fim, nowMs])
}

// ------------------------------------------------------------------------------------------------ satellite class
const binCache = new Map<string, Promise<Uint8Array | null>>()
const pngCache = new Map<string, Promise<ImageData | null>>()

/** The bundle's water_satellite.bin (DSWx classes on the render grid) when it is the image the answer shows. */
function bundleSatBin(m: FloodManifest | null, sat: SatelliteWaterResponse | null): { url: string; m: FloodManifest } | null {
  const layer = m?.layers?.water_satellite
  const g = sat?.status === 'available' ? sat.granules[0] : null
  if (!m || m.status !== 'ready' || !layer || !g) return null
  const t = m.layer_status?.water_satellite?.time_ms
  if (t !== g.acquired_ms) return null
  return { url: floodFileUrl(m.id, layer.file, m.built_ms), m }
}

/** The class from the render grid (row 0 north, col 0 west; CONTRACT §16.3). */
export function binClassAt(data: Uint8Array, m: Pick<FloodManifest, 'grid'>, lon: number, lat: number): number | null {
  const g = m.grid
  const w = g.render.width
  const h = g.render.height
  const [x, z] = lonLatToLocal(lon, lat, g)
  const col = Math.floor((x + g.extent_m / 2) / g.render.res_m)
  const row = Math.floor((z + g.extent_m / 2) / g.render.res_m)
  if (col < 0 || row < 0 || col >= w || row >= h) return null
  return data[row * w + col] ?? null
}

/** The picture's class around a pixel (5 × 5; backend/fire3d/floods/satellite.py palette_rgba): its grey "no view"
 *  hatch (clouds and no data look alike, D25), water blue, the near-white of snow or ice (252: no view of water, as
 *  clouds), else `'clear'`: the picture draws "not water" and NASA's ocean mask (254) both transparent, so a clear
 *  pixel never says "no water" on its own (review WFP-R8). */
export function pngClassAt(img: Pick<ImageData, 'width' | 'height' | 'data'>, fx: number, fy: number): SatClassAt {
  const cx = Math.floor(fx * img.width)
  const cy = Math.floor(fy * img.height)
  let water = false
  let grey = false
  let snow = false
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      const i = (y * img.width + x) * 4
      const [r, g, b, a] = [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
      if (a < 16) continue
      if (Math.abs(r - g) < 24 && Math.abs(g - b) < 24 && r < 200) grey = true
      else if (r >= 200 && g >= 200 && b >= 200) snow = true
      else if (b > r + 40) water = true
    }
  return grey ? 'noview' : water ? 1 : snow ? 252 : 'clear'
}

/** The satellite class at a spot for the point check (C2): the bundle's classes when they are the shown image, else
 *  the picture's pixels; undefined while loading or without an image. Browser only. `satAt` (brief 6, web-flood-playback
 *  declared edit; review WFP-R2): the satellite answer shown at the chart's handle (state/floodTimelineData.ts
 *  useSatelliteAtHandle: a past step's own pass and image); omitted, the satellite route's answer. */
export function useSatClassAt(lon: number | null, lat: number | null, satAt?: SatelliteWaterResponse | null): SatClassAt {
  const manifest = useFlood((s) => (s.manifest && s.manifest.id === s.floodId ? s.manifest : null))
  const routeSat = useFloodOfficial((s) => s.satellite.data)
  const sat = satAt === undefined ? routeSat : satAt
  const [out, setOut] = useState<{ key: string; v: SatClassAt } | null>(null)
  const img = sat?.status === 'available' && sat.measured ? sat.image : null
  const bin = bundleSatBin(manifest, sat)
  const key = lon != null && lat != null && img ? `${lon},${lat}|${bin?.url ?? img.url}` : ''
  useEffect(() => {
    if (!key || lon == null || lat == null || !img || typeof window === 'undefined') return
    let live = true
    const done = (v: SatClassAt) => {
      if (live) setOut({ key, v })
    }
    if (bin) {
      if (!binCache.has(bin.url))
        binCache.set(
          bin.url,
          fetch(bin.url)
            .then((r) => (r.ok ? r.arrayBuffer() : null))
            .then((b) => (b ? new Uint8Array(b) : null))
            .catch(() => null),
        )
      void binCache.get(bin.url)!.then((d) => done(d ? binClassAt(d, bin.m, lon, lat) : undefined))
    } else {
      const url = apiPathUrl(img.url)
      if (!pngCache.has(url))
        pngCache.set(
          url,
          new Promise<ImageData | null>((resolve) => {
            const im = new Image()
            im.onload = () => {
              try {
                const c = document.createElement('canvas')
                c.width = im.naturalWidth
                c.height = im.naturalHeight
                const ctx = c.getContext('2d')
                if (!ctx) return resolve(null)
                ctx.drawImage(im, 0, 0)
                resolve(ctx.getImageData(0, 0, c.width, c.height))
              } catch {
                resolve(null)
              }
            }
            im.onerror = () => resolve(null)
            im.src = url
          }),
        )
      const [w, s, e, n] = img.bounds_lonlat
      void pngCache.get(url)!.then((d) => done(d ? pngClassAt(d, (lon - w) / (e - w), (n - lat) / (n - s)) : undefined))
    }
    return () => {
      live = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return out && out.key === key ? out.v : undefined
}
