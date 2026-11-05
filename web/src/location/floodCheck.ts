// The flood view's point check (brief 5, PLAN-5 §4.4 "Selected point", §4.5 readout; D24, D25, C1, C2; CONTRACT
// §16.12): what each flood layer says about one spot, each line from its own answer and in its own words, never merged:
//   NWS products     inside the area of each product in effect at the handle's time (productsAt: after now, the products
//                    in effect now with CURSOR_FUTURE_PRODUCTS), else the distance to the nearest one
//   forecast area    inside / the distance to the NWS forecast flooded area (5-day maximum, experimental), or "not
//                    mapped here" only when the map answered (D24)
//   satellite        the image's class at the spot: water, no water (dry pixels do not mean no flooding), clouds,
//                    no data, or outside the image (C2); its date always
//   FEMA             in the 1 % floodplain (zone), "Not in FEMA's mapped 1% floodplain" only where FEMA says a digital
//                    map exists (C19), "FEMA has no digital flood map here"; background only (when its layer is on)
//   model            only when given (Command, switched on): flooded at the analysis time, labelled experimental
// Unavailable answers say so with their own "could not be reached" text; NOTHING_COVERS when no layer covers the spot.
// Pure and tested (floodCheck.test.ts). Used by the point card (location/FloodPointCard.tsx) and Command's readout.
import type { FloodAlert, FloodAlertsResponse, FloodMapResponse, ModelOutputResponse, RiverGauge, SatelliteWaterResponse } from '../api/types'
import { distanceToAreas } from '../lib/areaDistance'
import { bearingDeg, distanceM } from '../lib/geodesy'
import { distance } from '../lib/plainLanguage'
import { fmtAt, fmtClock, fmtDayDate, fmtRelative, timeFmt, type TimeFmt } from '../lib/time'
import { fimMapped, productsAt, rfcName, type AnswerState } from '../official/floodModel'
import type { Units } from '../state/workspace'
import {
  ALERTS_UNAVAILABLE,
  CREST_LINE,
  CURSOR_FUTURE_PRODUCTS,
  fillCopy,
  FLOOD_COMMAND,
  FLOOD_PUBLIC,
  FORECAST_HIGH_LABEL,
  FORECAST_HIGH_LINE,
  GAUGE_BELOW_STAGE_SUB,
  GAUGE_CATEGORY_DISPLAY,
  NO_RFC_FORECAST,
  RFC_FIM_AREA_COMMAND,
  SAT_AREA_COMMAND,
  type GaugeCategoryKey,
  IN_FLOODPLAIN,
  INSIDE_FIM,
  INSIDE_WARNING,
  MODEL_AT_POINT,
  NEAR_FIM,
  NFHL_DOWN,
  NFHL_NO_MAP,
  NFHL_OUTSIDE,
  NOTHING_COVERS,
  RFC_FIM_UNAVAILABLE,
  SAT_CLOUD_POINT,
  SAT_NODATA_POINT,
  SAT_OUTSIDE_POINT,
  SAT_UNAVAILABLE,
} from '../ui/shell/floodCopy'
import { fmtStage } from '../ui/public/floodOverviewText'
import { polygonsOf } from '../ui/public/floodView'

/** A DSWx class at the spot: 0 not water, 1 open water, 2 partial water, 252 snow/ice, 253 cloud, 254 ocean, 255 no
 *  data; `'noview'` when only the picture says "no view" (clouds and no data share its grey hatch, D25); `'clear'` when
 *  the picture is clear there (the backend draws "not water" and NASA's ocean mask alike, so the line never asserts
 *  "no water"; review WFP-R8); undefined while unknown. */
export type SatClassAt = number | 'noview' | 'clear' | null | undefined

export type FloodCheckKind = 'official' | 'forecast' | 'satellite' | 'background' | 'model' | 'note'

export interface FloodCheckLine {
  key: string
  kind: FloodCheckKind
  text: string
  /** NWS's own event name in the line (rendered verbatim). */
  event?: string
  /** The spot is inside this layer. */
  inside?: boolean
  tone?: 'alert' | 'quiet' | 'warn'
}

export interface FloodPointCheck {
  lines: FloodCheckLine[]
  /** The handle is after now: the products shown are those in effect now (C1). */
  future: boolean
  /** No mapped flood layer covers the spot (every answer that could say so answered). */
  nothing: boolean
}

export interface FloodPointInput {
  point: [number, number]
  alerts: FloodAlert[]
  /** The alerts answer's state (D24): only an available answer can say "none here". */
  alertsStatus?: FloodAlertsResponse['status'] | 'failed' | 'loading'
  zones?: FloodAlertsResponse['zones'] | null
  fim: FloodMapResponse | null
  /** The forecast-area, satellite and FEMA answers' states when their body is null (official/floodModel.ts answerState;
   *  review WFP-R1): `unavailable` (the request failed) says the layer's own "could not be loaded" text, `loading`
   *  says it is being checked; either way NOTHING_COVERS is not said. Default: not asked. */
  fimState?: AnswerState
  satelliteState?: AnswerState
  nfhlState?: AnswerState
  satellite: SatelliteWaterResponse | null
  /** The satellite class at the spot (map/the bundle's water_satellite.bin or the picture), when known. */
  satClass?: SatClassAt
  nfhl: FloodMapResponse | null
  model: ModelOutputResponse | null
  gauges: RiverGauge[]
  rivers: string[]
  cursorMs: number | null
  nowMs: number
  /** The flood's zone and clock (products keep their issuer's zone). */
  tf?: TimeFmt
  units?: Units
}

type Ring = [number, number][]

const inBounds = (b: readonly number[] | null | undefined, lon: number, lat: number) => !!b && b.length === 4 && lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]

/** The areas of a product: its polygon, else its zones' outlines. */
function productAreas(a: FloodAlert, zones: FloodAlertsResponse['zones'] | null | undefined): Ring[][] {
  const own = polygonsOf(a.geometry)
  if (own.length) return own
  return (zones?.features ?? []).filter((z) => z.properties.alert_ids.includes(a.id)).flatMap((z) => polygonsOf(z.geometry))
}

export function checkPoint(i: FloodPointInput): FloodPointCheck {
  const [lon, lat] = i.point
  const units = i.units ?? 'us'
  const tf = i.tf ?? timeFmt('UTC', '24h')
  const lines: FloodCheckLine[] = []
  let covered = false
  let allAnswered = true
  const dist = (km: number) => distance(km * 1000, units).text

  // NWS products at the handle's time (C1)
  const { alerts, future } = productsAt(i.alerts, i.cursorMs, i.nowMs)
  const status = i.alertsStatus ?? 'available'
  if (status === 'unavailable' || status === 'failed') {
    lines.push({ key: 'alerts', kind: 'official', text: ALERTS_UNAVAILABLE, tone: 'warn' })
    allAnswered = false
  } else if (status === 'loading') allAnswered = false
  else {
    let nearest: { km: number; a: FloodAlert } | null = null
    for (const a of alerts) {
      const d = distanceToAreas(productAreas(a, i.zones), [lon, lat])
      if (!d) continue
      const end = a.ends_ms ?? a.expires_ms
      const atf = timeFmt(a.time_zone || tf.tz, tf.clock)
      if (d.inside) {
        covered = true
        lines.push({ key: `in-${a.id}`, kind: 'official', event: a.event, inside: true, tone: 'alert', text: fillCopy(INSIDE_WARNING, { event: a.event, time: end != null ? fmtAt(end, atf, { zone: true, year: 'auto', refMs: i.nowMs }) : '—' }) })
      } else if (!nearest || d.km < nearest.km) nearest = { km: d.km, a }
    }
    if (!lines.some((l) => l.inside) && nearest) lines.push({ key: 'near-warning', kind: 'official', event: nearest.a.event, text: fillCopy(FLOOD_PUBLIC.nearWarning, { distance: dist(nearest.km), event: nearest.a.event }) })
    if (future) lines.push({ key: 'future', kind: 'note', text: CURSOR_FUTURE_PRODUCTS, tone: 'quiet' })
  }

  // the NWS forecast flooded area (experimental; D24)
  const fim = i.fim
  if (fim) {
    if (fim.status === 'available') {
      if (fimMapped(fim)) {
        const d = distanceToAreas(
          fim.features.features.flatMap((f) => polygonsOf(f.geometry)),
          [lon, lat],
        )
        if (d?.inside) {
          covered = true
          lines.push({ key: 'fim', kind: 'forecast', inside: true, text: INSIDE_FIM })
        } else if (d) lines.push({ key: 'fim', kind: 'forecast', text: fillCopy(NEAR_FIM, { distance: dist(d.km) }) })
      } else lines.push({ key: 'fim', kind: 'forecast', text: FLOOD_PUBLIC.fimNotMappedPoint, tone: 'quiet' })
    } else {
      allAnswered = false
      lines.push({ key: 'fim', kind: 'forecast', text: fim.reason ?? RFC_FIM_UNAVAILABLE, tone: 'warn' })
    }
  } else if (i.fimState === 'unavailable') {
    // the request failed with no answer (review WFP-R1)
    allAnswered = false
    lines.push({ key: 'fim', kind: 'forecast', text: RFC_FIM_UNAVAILABLE, tone: 'warn' })
  } else if (i.fimState === 'loading') {
    allAnswered = false
    lines.push({ key: 'fim', kind: 'forecast', text: FLOOD_PUBLIC.fimCheckingPoint, tone: 'quiet' })
  }

  // water seen by satellite (C2: no view and outside the image said so; dry pixels are never "no flooding")
  const sat = i.satellite
  if (sat) {
    const g = sat.status === 'available' ? sat.granules[0] : null
    if (sat.status !== 'available') {
      allAnswered = false
      lines.push({ key: 'sat', kind: 'satellite', text: sat.reason ?? SAT_UNAVAILABLE, tone: 'warn' })
    } else if (!g && !sat.tiles && sat.reason) {
      lines.push({ key: 'sat', kind: 'satellite', text: sat.reason, tone: 'quiet' })
    } else if (sat.measured && g && sat.image) {
      const date = fmtDayDate(g.acquired_ms, tf.tz, { year: 'auto', refMs: i.nowMs })
      if (!inBounds(sat.image.bounds_lonlat, lon, lat)) lines.push({ key: 'sat', kind: 'satellite', text: fillCopy(SAT_OUTSIDE_POINT, { date }), tone: 'quiet' })
      else if (i.satClass === 253) lines.push({ key: 'sat', kind: 'satellite', text: fillCopy(SAT_CLOUD_POINT, { date }), tone: 'quiet' })
      else if (i.satClass === 255) lines.push({ key: 'sat', kind: 'satellite', text: fillCopy(SAT_NODATA_POINT, { date }), tone: 'quiet' })
      else if (i.satClass === 'noview') lines.push({ key: 'sat', kind: 'satellite', text: fillCopy(FLOOD_PUBLIC.satNoViewPoint, { date }), tone: 'quiet' })
      // snow or ice hides water as clouds do; NASA's ocean mask is not checked (review WFP-R8)
      else if (i.satClass === 252) lines.push({ key: 'sat', kind: 'satellite', text: fillCopy(FLOOD_PUBLIC.satSnowPoint, { date }), tone: 'quiet' })
      else if (i.satClass === 254) lines.push({ key: 'sat', kind: 'satellite', text: fillCopy(FLOOD_PUBLIC.satOceanPoint, { date }), tone: 'quiet' })
      else if (i.satClass === 1 || i.satClass === 2) {
        covered = true
        lines.push({ key: 'sat', kind: 'satellite', inside: true, text: fillCopy(FLOOD_PUBLIC.satWaterPoint, { date }) })
      } else if (i.satClass === 0) lines.push({ key: 'sat', kind: 'satellite', text: fillCopy(FLOOD_PUBLIC.satNotWaterPoint, { date }) })
      else if (i.satClass === 'clear') lines.push({ key: 'sat', kind: 'satellite', text: fillCopy(FLOOD_PUBLIC.satClearPoint, { date }) })
      else {
        // the spot is still being read: no "nothing covers" yet
        allAnswered = false
        lines.push({ key: 'sat', kind: 'satellite', text: fillCopy(FLOOD_PUBLIC.satCheckingPoint, { date }), tone: 'quiet' })
      }
    }
  } else if (i.satelliteState === 'unavailable') {
    // the request failed with no answer (review WFP-R1)
    allAnswered = false
    lines.push({ key: 'sat', kind: 'satellite', text: SAT_UNAVAILABLE, tone: 'warn' })
  } else if (i.satelliteState === 'loading') {
    allAnswered = false
    lines.push({ key: 'sat', kind: 'satellite', text: FLOOD_PUBLIC.satLoadingPoint, tone: 'quiet' })
  }

  // FEMA floodplain (background; C19)
  const nfhl = i.nfhl
  if (nfhl) {
    if (nfhl.status !== 'available') lines.push({ key: 'nfhl', kind: 'background', text: nfhl.reason ?? NFHL_DOWN, tone: 'warn' })
    else {
      let zone: string | null = null
      for (const f of nfhl.features.features) {
        const d = distanceToAreas(polygonsOf(f.geometry), [lon, lat])
        if (d?.inside) {
          const p = (f.properties ?? {}) as Record<string, unknown>
          zone = String(p.fld_zone ?? p.zone_subty ?? '?')
          break
        }
      }
      if (zone) lines.push({ key: 'nfhl', kind: 'background', inside: true, text: fillCopy(IN_FLOODPLAIN, { zone }) })
      else if (nfhl.availability === 'mapped') lines.push({ key: 'nfhl', kind: 'background', text: NFHL_OUTSIDE, tone: 'quiet' })
      else if (nfhl.availability === 'no_digital_map') lines.push({ key: 'nfhl', kind: 'background', text: NFHL_NO_MAP, tone: 'quiet' })
    }
  } else if (i.nfhlState === 'unavailable') lines.push({ key: 'nfhl', kind: 'background', text: NFHL_DOWN, tone: 'warn' })

  // model output (Command only, switched on): never merged with the lines above
  const model = i.model
  if (model && model.model_output === true && model.status === 'available' && model.features) {
    const d = distanceToAreas(
      model.features.features.flatMap((f) => polygonsOf(f.geometry)),
      [lon, lat],
    )
    if (d?.inside) lines.push({ key: 'model', kind: 'model', text: fillCopy(MODEL_AT_POINT, { time: model.reference_ms != null ? fmtAt(model.reference_ms, tf, { zone: true }) : '—' }) })
  }

  const nothing = !covered && allAnswered && (i.alerts.length > 0 || status === 'available')
  if (nothing) lines.push({ key: 'nothing', kind: 'note', text: NOTHING_COVERS, tone: 'quiet' })
  return { lines, future, nothing }
}

// ------------------------------------------------------------------------------------------------ the nearest gauge
/** Gauges further than this from a spot are not offered (NO_GAUGE_NEAR's 25 km). */
export const READOUT_GAUGE_KM = 25

const riverKey = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Is the gauge on one of the flood's rivers (its waterbody or name names one)? */
export function onFloodRiver(g: Pick<RiverGauge, 'waterbody' | 'name'>, rivers: readonly string[]): boolean {
  const own = [riverKey(g.waterbody), riverKey(g.name)].filter(Boolean)
  return rivers.map(riverKey).some((r) => r && own.some((o) => o === r || o.includes(r) || (o.length > 3 && r.includes(o))))
}

export interface NearestGauge {
  gauge: RiverGauge
  km: number
  bearingDeg: number
  /** On one of the flood's rivers (picked first). */
  onRiver: boolean
}

/** The gauge the readout names for a spot (PLAN-5 §4.5): the nearest within 25 km on one of the flood's rivers, else
 *  the nearest at action stage or above; null when none (NO_GAUGE_NEAR only for an available answer, D24). The
 *  readout always adds GAUGE_OTHER_STREAM: another stream may be closer. */
export function nearestFloodGauge(gauges: readonly RiverGauge[], point: [number, number], rivers: readonly string[], maxKm = READOUT_GAUGE_KM): NearestGauge | null {
  const [lon, lat] = point
  const near = gauges
    .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon))
    .map((g) => {
      const me = { lat, lon }
      const at = { lat: g.lat, lon: g.lon }
      return { gauge: g, km: distanceM(me, at) / 1000, bearingDeg: (bearingDeg(me, at) + 360) % 360, onRiver: onFloodRiver(g, rivers) }
    })
    .filter((x) => x.km <= maxKm)
    .sort((a, b) => a.km - b.km)
  const rank = (c: string) => ({ action: 1, minor: 2, moderate: 3, major: 4 })[c] ?? 0
  return near.find((x) => x.onRiver) ?? near.find((x) => rank(x.gauge.observed.category) >= 1) ?? null
}

// ------------------------------------------------------------------------------------------------ Command's readout (pure)
/** The UTM zone of a point (the bundle's grid when it has one). */
export function utmZoneOf(lon: number, gridZone: number | null | undefined): number {
  if (gridZone != null && Number.isFinite(gridZone)) return gridZone
  return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1))
}

export interface LineTag {
  text: string
  cls: string
  tip: string
}

/** The outlined tag of a check line: what the layer is and how old (PLAN-5 §4.5). */
export function lineTag(l: Pick<FloodCheckLine, 'kind'>, ctx: { fim: FloodMapResponse | null; satellite: SatelliteWaterResponse | null; nowMs: number; tf: TimeFmt }): LineTag | null {
  switch (l.kind) {
    case 'official':
      return { text: FLOOD_COMMAND.tagOfficial, cls: 'is-official', tip: FLOOD_COMMAND.tagOfficialTip }
    case 'forecast': {
      const t = ctx.fim?.status === 'available' ? (ctx.fim.reference_ms ?? ctx.fim.updated_ms) : null
      return { text: t != null ? fillCopy(FLOOD_COMMAND.tagForecastIssued, { time: fmtClock(t, ctx.tf) }) : FLOOD_COMMAND.tagForecast, cls: 'is-forecast', tip: FLOOD_COMMAND.tagForecastTip }
    }
    case 'satellite': {
      const g = ctx.satellite?.status === 'available' ? ctx.satellite.granules[0] : null
      // the age at render time from the image's own time (C16)
      return { text: g ? fillCopy(FLOOD_COMMAND.tagSatelliteAge, { age: fmtRelative(g.acquired_ms, ctx.nowMs) }) : FLOOD_COMMAND.tagSatellite, cls: 'is-satellite', tip: FLOOD_COMMAND.tagSatelliteTip }
    }
    case 'background':
      return { text: FLOOD_COMMAND.tagFema, cls: 'is-fema', tip: FLOOD_COMMAND.tagFemaTip }
    case 'model':
      return { text: FLOOD_COMMAND.tagModel, cls: 'is-model', tip: FLOOD_COMMAND.tagModelTip }
    default:
      return null
  }
}

/** "4.2 km²" / "1.6 mi²". */
export function fmtArea(km2: number, units: Units): string {
  if (units === 'metric') return `${km2 < 10 ? km2.toFixed(1) : Math.round(km2).toLocaleString('en-US')} km²`
  const mi2 = km2 * 0.386102
  return `${mi2 < 10 ? mi2.toFixed(1) : Math.round(mi2).toLocaleString('en-US')} mi²`
}

/** The area figures (C6): the forecast area only when the backend measured it from the flood's member reaches
 *  (`stats` null when that join failed: no figure), the satellite water only from a measured image. */
export function areaFigures(fim: FloodMapResponse | null, sat: SatelliteWaterResponse | null, units: Units): { key: string; text: string; caveat: string | null }[] {
  const out: { key: string; text: string; caveat: string | null }[] = []
  if (fim?.status === 'available' && fim.stats && Number.isFinite(fim.stats.area_km2))
    out.push({ key: 'fim', text: fillCopy(RFC_FIM_AREA_COMMAND, { area: fmtArea(fim.stats.area_km2, units) }), caveat: fim.coverage_note || null })
  if (sat?.status === 'available' && sat.measured && sat.stats && Number.isFinite(sat.stats.water_km2)) {
    const water = sat.stats.water_km2 + (Number.isFinite(sat.stats.partial_km2) ? sat.stats.partial_km2 : 0)
    out.push({ key: 'sat', text: fillCopy(SAT_AREA_COMMAND, { area: fmtArea(water, units) }), caveat: sat.caveats[0] ?? null })
  }
  return out
}

/** A gauge's NWS category in words (PLAN-5 §5.3; never a raw value): the short label and the sentence. */
export function categoryWords(g: Pick<RiverGauge, 'observed'>, tf: TimeFmt, nowMs: number): { short: string; sentence: string } {
  const c = (g.observed.category in GAUGE_CATEGORY_DISPLAY ? g.observed.category : 'unknown') as GaugeCategoryKey
  const d = GAUGE_CATEGORY_DISPLAY[c]
  const time = g.observed.valid_ms != null ? fmtAt(g.observed.valid_ms, tf, { zone: true, year: 'auto', refMs: nowMs }) : '—'
  const sentence = d.sentence == null ? GAUGE_BELOW_STAGE_SUB : fillCopy(d.sentence, { time })
  return { short: d.short, sentence }
}

/** The forecast row of a gauge: the crest (CREST_LINE) or the forecast high still rising at its end (C7); none when
 *  the gauge is not a forecast point (NO_RFC_FORECAST); a forecast point without its forecast here says where to see
 *  it (never NO_RFC_FORECAST then; bundle-api deviation 4). */
export function forecastRow(g: RiverGauge, tf: TimeFmt, units: Units, nowMs: number): { label: string; value: string; sub: string } {
  const f = g.forecast
  if (f && f.max_value != null) {
    const unit = g.thresholds?.unit ?? g.observed.unit ?? 'ft'
    const value = fmtStage(f.max_value, unit, units) ?? '—'
    const [v, u] = [value.replace(/\s\S+$/, ''), value.split(' ').pop() ?? '']
    const when = f.max_ms != null ? fmtAt(f.max_ms, tf, { weekday: true, zone: true, year: 'auto', refMs: nowMs }) : '—'
    const issued = f.issued_ms != null ? fmtAt(f.issued_ms, tf, { zone: true, year: 'auto', refMs: nowMs }) : '—'
    const slots = { value: v, unit: u, 'day time zone': when, 'RFC name': rfcName(f), time: issued }
    return f.crest_at_end
      ? { label: FORECAST_HIGH_LABEL, value, sub: fillCopy(FORECAST_HIGH_LINE, slots) }
      : { label: FLOOD_COMMAND.crestLabel, value: `${value} · ${when}`, sub: fillCopy(CREST_LINE, slots) }
  }
  if (g.is_forecast_point) return { label: FLOOD_COMMAND.crestLabel, value: '—', sub: FLOOD_COMMAND.forecastInChart }
  return { label: FLOOD_COMMAND.crestLabel, value: NO_RFC_FORECAST, sub: '' }
}

