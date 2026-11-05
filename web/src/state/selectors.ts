// Derived values of bundle series at the timeline time (pure functions; safe to call in selectors / render).
// Brief 5 (CONTRACT §16.10): which event is open, fire or flood (the shell's "no incident = the overview" checks use
// noEventOpen()), and the area of the open event for the area queries (extras, official answers).
import type { ForecastManifest, TimeseriesFile, WeatherFile } from '../api/types'
import { expandBbox, incidentAreaBbox, type BBox } from '../extras/client'
import { openFloodSummary, useFlood } from './flood'
import { useStore } from './store'

/** No fire and no flood open: the national overview (either hazard). */
export function noEventOpen(): boolean {
  return useStore.getState().incidentId == null && useFlood.getState().floodId == null
}

/** The open event's kind (a fire wins when both are somehow set: a link with both opens the fire). */
export function openEventKind(): 'fire' | 'flood' | null {
  if (useStore.getState().incidentId != null) return 'fire'
  return useFlood.getState().floodId != null ? 'flood' : null
}

/** The same for a hook's selector inputs (no store reads inside). */
export function eventKindOf(incidentId: string | null, floodId: string | null): 'fire' | 'flood' | null {
  return incidentId != null ? 'fire' : floodId != null ? 'flood' : null
}

/** The flood's bbox with a 10 % margin on each side (a degenerate box gets 2 km). */
export function floodArea(b: readonly number[] | null | undefined): BBox | null {
  if (!b || b.length !== 4 || !b.every(Number.isFinite)) return null
  const dx = (b[2] - b[0]) * 0.1
  const dy = (b[3] - b[1]) * 0.1
  if (dx <= 0 || dy <= 0) return expandBbox([b[0], b[1], b[2], b[3]], 2)
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy]
}

/** The open event's area: the fire's analysis area (or its reported point ± 10 km), else the open flood's bbox + 10 %;
 *  null with no event open. `marginKm` widens the fire's area only (as extras/client.ts incidentAreaBbox does). */
export function currentArea(marginKm = 0): BBox | null {
  const s = useStore.getState()
  if (s.incidentId != null) {
    const summary = s.summary && s.summary.id === s.incidentId ? s.summary : null
    const manifest = s.manifest?.status === 'ready' && s.manifest.id === s.incidentId ? s.manifest : null
    return incidentAreaBbox(summary, manifest, marginKm)
  }
  const f = openFloodSummary(useFlood.getState())
  return f ? floodArea(f.bbox_lonlat) : null
}

const HOUR = 3_600_000

/** Index of the last sample with t <= ms (binary search); -1 before the first sample. */
export function lastIndexAtOrBefore(t: ArrayLike<number>, ms: number): number {
  let lo = 0
  let hi = t.length - 1
  if (hi < 0 || ms < t[0]) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (t[mid] <= ms) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Linear interpolation of `v` over `t` at ms; null outside [t0, tN] (or when values are missing). */
export function interpAt(t: ArrayLike<number>, v: ArrayLike<number> | undefined, ms: number): number | null {
  if (!v || t.length === 0 || v.length === 0) return null
  const n = Math.min(t.length, v.length)
  if (ms < t[0] || ms > t[n - 1]) return null
  const i = lastIndexAtOrBefore(t, ms)
  if (i >= n - 1) return finite(v[n - 1])
  const a = v[i]
  const b = v[i + 1]
  if (!Number.isFinite(a)) return finite(b)
  if (!Number.isFinite(b)) return a
  const f = (ms - t[i]) / Math.max(1, t[i + 1] - t[i])
  return a + (b - a) * f
}

const finite = (x: number) => (Number.isFinite(x) ? x : null)

/** Weather hour index for ms: the hour containing ms (null outside the series, allowing up to 1 h past the end). */
export function weatherIndex(w: WeatherFile | null, ms: number): number | null {
  if (!w || w.t_ms.length === 0) return null
  const t = w.t_ms
  if (ms < t[0] - HOUR / 2 || ms > t[t.length - 1] + HOUR) return null
  return Math.max(0, lastIndexAtOrBefore(t, ms))
}

export interface WeatherNow {
  i: number
  tMs: number
  windMs: number | null
  gustMs: number | null
  dirDeg: number | null
  tempC: number | null
  dewpointC: number | null
  rhPct: number | null
  fm1Pct: number | null
  fm10Pct: number | null
  ffwi: number | null
  flameFt: number | null
  rosPotential: number | null
  precipMm: number | null
  isForecast: boolean
}

/** Hourly weather & fire behaviour values at index i (see weatherIndex). */
export function weatherAt(w: WeatherFile, i: number): WeatherNow {
  const a = w.at_fire
  const g = (arr: number[] | undefined) => (arr && i < arr.length && Number.isFinite(arr[i]) ? arr[i] : null)
  return {
    i,
    tMs: w.t_ms[i],
    windMs: g(a.wind_speed_ms),
    gustMs: g(a.wind_gust_ms),
    dirDeg: g(a.wind_dir_deg),
    tempC: g(a.temp_c),
    dewpointC: g(a.dewpoint_c),
    rhPct: g(a.rh_pct),
    fm1Pct: g(a.fm1_pct),
    fm10Pct: g(a.fm10_pct),
    ffwi: g(a.ffwi),
    flameFt: g(a.flame_length_ft),
    rosPotential: g(a.ros_ch_per_h_potential),
    precipMm: g(a.precip_mm),
    isForecast: w.forecast_from_ms != null && w.t_ms[i] >= w.forecast_from_ms,
  }
}

/** Observed burned area (acres) at ms (null outside the observed series). */
export function observedAreaAt(ts: TimeseriesFile | null, ms: number): number | null {
  if (!ts) return null
  return interpAt(ts.t_ms, ts.area_acres, ms)
}

/** Forecast area quantiles at ms (null outside the run). */
export function forecastAreaAt(f: ForecastManifest | null, ms: number): { p10: number; p50: number; p90: number } | null {
  if (!f) return null
  const s = f.series
  const p50 = interpAt(s.t_ms, s.area_acres_p50, ms)
  if (p50 == null) return null
  return { p10: interpAt(s.t_ms, s.area_acres_p10, ms) ?? p50, p50, p90: interpAt(s.t_ms, s.area_acres_p90, ms) ?? p50 }
}

/** Forecast quantiles at start + lead hours (null when the run is shorter). */
export function forecastAtLead(f: ForecastManifest, leadH: number): { p10: number; p50: number; p90: number } | null {
  if (leadH > f.horizon_h) return null
  return forecastAreaAt(f, f.start_ms + leadH * HOUR)
}

/** Time (ms) and value of the largest hourly growth in the observed series. */
export function peakGrowth(ts: TimeseriesFile | null): { tMs: number; acresPerH: number } | null {
  if (!ts || ts.growth_acres_per_h.length === 0) return null
  let best = -1
  let bi = -1
  ts.growth_acres_per_h.forEach((g, i) => {
    if (Number.isFinite(g) && g > best) {
      best = g
      bi = i
    }
  })
  return bi < 0 ? null : { tMs: ts.t_ms[bi], acresPerH: best }
}
