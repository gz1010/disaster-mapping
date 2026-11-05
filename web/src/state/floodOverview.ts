// The national map's flood rules (brief 5, PLAN-5 §4.3, CONTRACT §16.8; the twin of state/overview.ts for fires). Pure:
// rank and marker kind from the official level and gauge category only (never Fire-3d's own inference), the watches
// filter (user decision U2: hidden by default, counted), "in this view", the highest NWS product in effect and the
// list's source state. Tests: floodOverview.test.ts.
import type { FloodCategory, FloodListResponse, FloodProductRef, FloodSourceId, FloodSummary, GaugeCategory } from '../api/types'
import type { LonLatBox } from '../lib/fireBounds'
import type { FloodListSlot } from './floodCatalog'

/** User decision U2 (CONTRACT §16.8 WATCHES_SHOWN_BY_DEFAULT): watch-only floods are listed but hidden by default. */
export const WATCHES_SHOWN_BY_DEFAULT = false

const CATEGORY_POINTS: Record<FloodCategory, number> = { action: 0, minor: 100, moderate: 300, major: 400 }
const LEVEL_POINTS: Record<FloodSummary['level'], number> = { warning: 50, advisory: 20, gauge_only: 10, watch: 0 }

/** Order of NWS flood products, most severe first (verbatim NWS event names). */
export const PRODUCT_ORDER = ['Flash Flood Warning', 'Flood Warning', 'Flood Advisory', 'Flash Flood Watch', 'Flood Watch', 'Flash Flood Statement', 'Flood Statement'] as const

const inEffect = (p: Pick<FloodProductRef, 'phase'>) => p.phase === 'in_effect'

/** A Flash Flood Warning is in effect for the flood. */
export function hasFlashWarning(f: Pick<FloodSummary, 'products'>): boolean {
  return f.products.some((p) => p.event === 'Flash Flood Warning' && inEffect(p))
}

/** CONTRACT §16.8 floodRank: emergency 1000 + max category major 400 / moderate 300 / minor 100 + a Flash Flood
 *  Warning in effect 200 + level warning 50 / advisory 20 / gauge_only 10 / watch 0 + min(gauges in flood, 9). */
export function floodRank(f: Pick<FloodSummary, 'emergency' | 'max_category' | 'products' | 'level' | 'gauges_in_flood'>): number {
  return (
    (f.emergency ? 1000 : 0) +
    (f.max_category ? CATEGORY_POINTS[f.max_category] : 0) +
    (hasFlashWarning(f) ? 200 : 0) +
    LEVEL_POINTS[f.level] +
    Math.min(Math.max(0, f.gauges_in_flood | 0), 9)
  )
}

/** Sort like the backend: rank, then the newest update first. */
export function sortFloods<T extends FloodSummary>(floods: readonly T[]): T[] {
  return [...floods].sort((a, b) => floodRank(b) - floodRank(a) || (b.updated_ms ?? 0) - (a.updated_ms ?? 0))
}

export type FloodMarkerKind = 'large' | 'active' | 'small' | 'other'

/** Is the flood a past one (year lists) or no longer in effect (live, kept 48 h)? Never shown as a word. */
export function isQuietFlood(f: Pick<FloodSummary, 'mode' | 'status'>): boolean {
  return f.mode === 'historical' || f.status === 'inactive'
}

/** Marker kind (CONTRACT §16.8): large = rank >= 300 or a Flash Flood Warning or Emergency; active = a Flood Warning or a
 *  gauge at minor; small = advisory only or gauge-only at minor; other = watch only or past. */
export function floodMarkerKind(f: FloodSummary): FloodMarkerKind {
  if (isQuietFlood(f) || f.level === 'watch') return 'other'
  if (floodRank(f) >= 300 || f.emergency || hasFlashWarning(f)) return 'large'
  if (f.level === 'warning') return 'active'
  return 'small'
}

/** Watch-only floods (no warning, advisory or gauge in flood yet). */
export function isWatchOnly(f: Pick<FloodSummary, 'level'>): boolean {
  return f.level === 'watch'
}

/** The floods the list and the markers show: watch-only ones only while "Show watches" is on (the point card always
 *  lists every product at the point, watches included). */
export function shownFloods(floods: readonly FloodSummary[], showWatches: boolean): FloodSummary[] {
  return showWatches ? [...floods] : floods.filter((f) => !isWatchOnly(f))
}

/** How many watch-only floods "Show watches" hides (0 while it is on). */
export function hiddenWatches(floods: readonly FloodSummary[], showWatches: boolean): number {
  return showWatches ? 0 : floods.filter(isWatchOnly).length
}

const validPoint = (f: Pick<FloodSummary, 'lat' | 'lon'>) => Number.isFinite(f.lat) && Number.isFinite(f.lon) && Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180

/** Floods whose point lies inside the visible map area (the list's "in this view"). */
export function floodsInView<T extends Pick<FloodSummary, 'lat' | 'lon'>>(floods: readonly T[], view: LonLatBox | null): T[] {
  if (!view) return [...floods]
  const [w, s, e, n] = view
  return floods.filter((f) => validPoint(f) && f.lon >= w && f.lon <= e && f.lat >= s && f.lat <= n)
}

/** The highest NWS product in effect (Emergency first), else the highest upcoming one, else null. */
export function highestProduct(f: Pick<FloodSummary, 'products'>): FloodProductRef | null {
  const rank = (p: FloodProductRef) => {
    const i = PRODUCT_ORDER.indexOf(p.event as (typeof PRODUCT_ORDER)[number])
    return (p.emergency ? -1 : 0) + (i < 0 ? PRODUCT_ORDER.length : i)
  }
  const pick = (ps: FloodProductRef[]) => ps.sort((a, b) => rank(a) - rank(b) || (b.sent_ms ?? 0) - (a.sent_ms ?? 0))[0] ?? null
  return pick(f.products.filter(inEffect)) ?? pick(f.products.filter((p) => p.phase === 'upcoming'))
}

const GAUGE_RANK: Partial<Record<GaugeCategory, number>> = { action: 1, minor: 2, moderate: 3, major: 4 }

/** Rank of a gauge category (0 below action or not a flood category). */
export function gaugeCategoryRank(c: GaugeCategory | FloodCategory | null | undefined): number {
  return (c && GAUGE_RANK[c as GaugeCategory]) || 0
}

/** The state of a flood list for its notices (CONTRACT §16.2 sources, PLAN-5 §3.2 rule 11). The live list is read
 *  from NWS and the river gauges; a year list from the IEM archive ('archive_down' when that could not be read). */
export type FloodListHealth = 'loading' | 'ok' | 'nws_down' | 'gauges_down' | 'both_down' | 'archive_down' | 'failed'

/** The sources a list itself is read from: a year list's IEM archive, else the live list's NWS products and gauges. */
export function listSourceIds(r: Pick<FloodListResponse, 'mode'>): FloodSourceId[] {
  return r.mode === 'historical' ? ['iem_archive'] : ['nws_alerts', 'nwps_gauges']
}

export function floodListHealth(slot: FloodListSlot): FloodListHealth {
  const r = slot.response
  if (!r) return slot.loading ? 'loading' : slot.error ? 'failed' : 'loading'
  const down = (id: FloodSourceId) => r.sources.some((s) => s.id === id && s.status === 'unavailable')
  if (r.mode === 'historical') return down('iem_archive') ? 'archive_down' : 'ok'
  const nws = down('nws_alerts')
  const gauges = down('nwps_gauges')
  if (nws && gauges) return 'both_down'
  if (nws) return 'nws_down'
  if (gauges) return 'gauges_down'
  return 'ok'
}

/** The list could not be read at all (the live list's NWS products and gauges both down, or a year's archive down):
 *  the bar says so instead of a count (never "0", review WFO-R3/R4); rows from disk may still be listed. */
export function floodListUnreadable(health: FloodListHealth): boolean {
  return health === 'both_down' || health === 'archive_down'
}

/** The backend's own reasons (verbatim, de-duplicated) of the list's own sources that could not be read. */
export function listDownReasons(r: FloodListResponse | null): string[] {
  if (!r) return []
  const ids = listSourceIds(r)
  const out: string[] = []
  for (const s of r.sources) if (ids.includes(s.id) && s.status === 'unavailable' && s.reason && !out.includes(s.reason)) out.push(s.reason)
  return out
}

/** The number of listed floods, or null when it is not known (never 0 for unknown): no answer, or the list could not be
 *  read (both live lists down, or a year's archive down) with nothing listed. */
export function knownFloodCount(r: FloodListResponse | null, showWatches: boolean): number | null {
  if (!r) return null
  const shown = shownFloods(r.floods, showWatches).length
  const unreadable = floodListUnreadable(floodListHealth({ response: r, loading: false, error: null, status: null }))
  return unreadable && shown === 0 ? null : shown
}

/** Fly-to request framing a flood: its bbox (with a small margin), else its point at z11. */
export function floodFlyTo(f: Pick<FloodSummary, 'bbox_lonlat' | 'lat' | 'lon'>): { lon: number; lat: number; zoom?: number; bounds?: LonLatBox } | null {
  const b = f.bbox_lonlat
  if (b && b.length === 4 && b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1]) {
    const dx = (b[2] - b[0]) * 0.1
    const dy = (b[3] - b[1]) * 0.1
    return { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2, bounds: [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy] }
  }
  if (validPoint(f)) return { lon: f.lon, lat: f.lat, zoom: 11 }
  return null
}
