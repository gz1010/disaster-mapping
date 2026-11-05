// The river-level chart's model (brief 5, web-flood-command M1; PLAN-5 §4.6, D13, D20, C1, C7, C28; CONTRACT §16.12).
// Pure: everything the slim (Command) and dock (Forensic) charts draw, from one gauge answer (with its series), the
// model answer, the flood's NWS products, "now", the plot width, the axis and the units. Tested in
// hydrographModel.test.ts.
//   - Time axis: 72 h before now to the end of the NWS river forecast (at least 6 h after now; +72 h without a
//     forecast). Day ticks at local midnights in the gauge's IANA zone (DST-safe).
//   - Lines: observed (measured, solid), the NWS river forecast (dashed, joined to the latest reading as NWS draws it),
//     the National Water Model (dotted amber) on the FLOW axis only, never converted to a stage, never without a
//     reach_id (D20, C28). Style and words carry the meaning, never colour alone.
//   - NWS flood levels (action, minor, moderate, major) as lines labelled on the right ("MINOR 15.5"), faint bands
//     above minor, none below action; a level outside the chart is pinned to its edge with an arrow ("MAJOR 20.5 ↑").
//   - Marks: NOW; LATEST <time> · <age> (stale after 3 h); the forecast crest, or "HIGH … AT END · STILL RISING" when
//     the highest forecast value is the last step (C7); NWS product times as small ticks.
//   - The handle (cursorReadout): "NOV 4 10:00 MST · 15.2 FT OBSERVED · MINOR"; in flow mode the NWS flow on line 1
//     and the model on its own line ("MODEL · NWM · EXPERIMENTAL · 7,630 FT³/S (RUN …)"), never one combined value.
//     After now the views keep the products in effect now (productsAt, C1; re-exported from official/floodModel.ts).
//   - Empty states (PLAN-5 §5.5): no readings in 72 h, no flood stages set, no NWS forecast, model series unavailable.
import type { FloodAlert, GaugeCategory, ModelOutputResponse, ModelSeries, RiverGauge } from '../../api/types'
import { productsAt } from '../../official/floodModel'
import { HOUR_MS, MINUTE_MS, fmtAt, fmtClock, fmtDayDate, fmtRelative, localDayTicks, type TimeFmt } from '../../lib/time'
import { fillCopy, GAUGE_CATEGORY_DISPLAY, HYDRO, HYDROGRAPH_EMPTY, HYDROGRAPH_MARKS } from '../shell/floodCopy'

export { productsAt }

export type HydroAxis = 'stage' | 'flow'
export type HydroUnits = 'us' | 'metric'
export type HydroLevel = 'action' | 'minor' | 'moderate' | 'major'

/** The chart starts 72 h before now. */
export const HYDRO_PAST_MS = 72 * HOUR_MS
/** Without an NWS forecast the chart ends 72 h after now; with one, at its end but at least 6 h after now. */
export const HYDRO_FUTURE_MS = 72 * HOUR_MS
export const HYDRO_MIN_FUTURE_MS = 6 * HOUR_MS
/** A reading older than this is stale (amber, "STALE"). */
export const HYDRO_STALE_MS = 3 * HOUR_MS
/** A value is "interpolated" when no reading or forecast step lies within this of the handle. */
export const HYDRO_SNAP_MS = 20 * MINUTE_MS
/** Readings further apart than this are not joined by a line (a gap in the record). */
export const HYDRO_GAP_MS = 6 * HOUR_MS
export const HYDRO_LEVELS: readonly HydroLevel[] = ['action', 'minor', 'moderate', 'major']

const FT_PER_M = 1 / 0.3048
const M3S_PER_CFS = 0.028316846592

export interface HydroPoint {
  t: number
  v: number
}

/** One model line (flow axis only): a National Water Model series, its run time and name. */
export interface HydroModelLine {
  name: ModelSeries['name']
  referenceMs: number
  points: HydroPoint[]
}

export interface HydroThreshold {
  level: HydroLevel
  /** In display units. */
  value: number
  /** "MINOR 15.0" (mono, upper case on screen); pinned ones end with " ↑" / " ↓". */
  label: string
  /** Outside the chart's range: drawn at its top or bottom edge with an arrow. */
  pinned: 'above' | 'below' | null
}

export interface HydroBand {
  level: Exclude<HydroLevel, 'action'>
  from: number
  to: number
}

export interface HydroMark {
  t: number
  v: number
  label: string
}

export interface HydroProductTick {
  t: number
  label: string
  emergency: boolean
}

export interface HydroDayTick {
  t: number
  label: string
}

export type HydroModelState = 'none' | 'stage_axis' | 'loading' | 'available' | 'unavailable'

export interface HydrographModel {
  lid: string
  name: string
  zone: string
  axis: HydroAxis
  units: HydroUnits
  /** "FT", "M", "FT³/S", "M³/S" (mono). */
  unit: string
  /** "ft", "m", "ft³/s", "m³/s" (sentences). */
  unitWord: string
  nowMs: number
  startMs: number
  endMs: number
  vMin: number
  vMax: number
  observed: HydroPoint[]
  /** The NWS forecast, its first point the latest reading when the forecast starts after it (NWS draws it joined). */
  forecast: HydroPoint[]
  /** forecast[0] is the latest reading (the join), not a forecast step. */
  forecastJoined: boolean
  /** Flow axis only, and only for a gauge with a reach_id (D20, C28). */
  model: HydroModelLine[]
  modelState: HydroModelState
  modelReason: string | null
  thresholds: HydroThreshold[]
  bands: HydroBand[]
  latest: (HydroMark & { stale: boolean; ageText: string }) | null
  crest: (HydroMark & { atEnd: boolean }) | null
  productTicks: HydroProductTick[]
  dayTicks: HydroDayTick[]
  /** PLAN-5 §5.5 sentences that apply (and the flow axis' "no flood lines" note). */
  empty: string[]
  observedLabel: string
  forecastLabel: string | null
  modelLabel: string
  /** The gauge has NWS flood levels for this axis. */
  hasLevels: boolean
}

export interface HydrographInput {
  gauge: RiverGauge
  /** The nwm_series answer for this gauge (null: not asked). */
  model: ModelOutputResponse | null
  /** The model answer is on its way. */
  modelLoading?: boolean
  products: readonly FloodAlert[]
  nowMs: number
  widthPx: number
  axis: HydroAxis
  units: HydroUnits
  /** The gauge's IANA zone (ticks and labels). */
  zone: string
  clock?: TimeFmt['clock']
}

// ------------------------------------------------------------------------------------------------ units
const FLOW_UNITS = /^(k?cfs|ft3\/s|ft³\/s|m3\/s|m³\/s|kcms|cms)$/i

/** A stage in feet from a value in `unit` ('ft' or 'm'); null when unknown. */
export function stageToFt(v: number | null | undefined, unit: string | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null
  const u = (unit ?? 'ft').trim().toLowerCase()
  if (u === 'm' || u === 'meters' || u === 'metres') return v * FT_PER_M
  return v
}

/** A flow in ft³/s from a value in `unit` ('kcfs' is NWPS's thousands of ft³/s); null when unknown. */
export function flowToCfs(v: number | null | undefined, unit: string | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null
  const u = (unit ?? 'cfs').trim().toLowerCase()
  if (u === 'kcfs') return v * 1000
  if (u === 'm3/s' || u === 'm³/s' || u === 'cms') return v / M3S_PER_CFS
  if (u === 'kcms') return (v * 1000) / M3S_PER_CFS
  return v
}

/** Is a threshold unit a flow unit (NWS sets some gauges' flood levels in flow)? */
export function isFlowUnit(unit: string | null | undefined): boolean {
  return FLOW_UNITS.test((unit ?? '').trim())
}

/** Display value from feet or ft³/s. */
function display(v: number, axis: HydroAxis, units: HydroUnits): number {
  if (units !== 'metric') return v
  return axis === 'stage' ? v / FT_PER_M : v * M3S_PER_CFS
}

export function unitLabels(axis: HydroAxis, units: HydroUnits): { unit: string; unitWord: string } {
  if (axis === 'stage') return units === 'metric' ? { unit: 'M', unitWord: 'm' } : { unit: 'FT', unitWord: 'ft' }
  return units === 'metric' ? { unit: 'M³/S', unitWord: 'm³/s' } : { unit: 'FT³/S', unitWord: 'ft³/s' }
}

/** "17.6" (stage, ft), "5.37" (stage, m), "7,060" (flow: three significant figures, thousands separated). */
export function fmtValue(v: number, axis: HydroAxis, units: HydroUnits): string {
  if (axis === 'stage') return v.toFixed(units === 'metric' ? 2 : 1)
  const a = Math.abs(v)
  if (a === 0) return '0'
  const digits = Math.floor(Math.log10(a)) + 1
  const rounded = digits >= 3 ? Math.round(v / 10 ** (digits - 3)) * 10 ** (digits - 3) : Number(v.toPrecision(3))
  return rounded.toLocaleString('en-US', { maximumFractionDigits: digits >= 3 ? 0 : 3 - digits })
}

// ------------------------------------------------------------------------------------------------ series
/** A gauge series column as display-unit points, sorted, finite values only. */
function seriesPoints(rows: readonly (readonly [number, number | null, number | null])[] | undefined, axis: HydroAxis, units: HydroUnits, stageUnit: string | null, flowUnit: string | null): HydroPoint[] {
  const out: HydroPoint[] = []
  for (const r of rows ?? []) {
    const raw = axis === 'stage' ? stageToFt(r[1], stageUnit) : flowToCfs(r[2], flowUnit)
    if (raw == null || !Number.isFinite(r[0])) continue
    out.push({ t: r[0], v: display(raw, axis, units) })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** Keep the shape at the plot's width: per pixel bucket the first, lowest and highest point, and always the last. */
export function thinPoints(points: readonly HydroPoint[], t0: number, t1: number, widthPx: number): HydroPoint[] {
  const buckets = Math.max(8, Math.round(widthPx))
  if (points.length <= buckets * 2) return [...points]
  const span = Math.max(1, t1 - t0)
  const out: HydroPoint[] = []
  let cur = -1
  let group: HydroPoint[] = []
  const flush = () => {
    if (!group.length) return
    let lo = group[0]
    let hi = group[0]
    for (const p of group) {
      if (p.v < lo.v) lo = p
      if (p.v > hi.v) hi = p
    }
    const keep = [group[0], lo, hi].filter((p, i, a) => a.indexOf(p) === i).sort((a, b) => a.t - b.t)
    out.push(...keep)
    group = []
  }
  for (const p of points) {
    const b = Math.floor(((p.t - t0) / span) * buckets)
    if (b !== cur) {
      flush()
      cur = b
    }
    group.push(p)
  }
  flush()
  const last = points[points.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/** The value of a series at `t` (linear between neighbours closer than HYDRO_GAP_MS), with whether a point is near. */
export function valueAt(points: readonly HydroPoint[], t: number): { v: number; snapped: boolean } | null {
  if (!points.length || t < points[0].t - HYDRO_SNAP_MS || t > points[points.length - 1].t + HYDRO_SNAP_MS) return null
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  const near = [a, b].reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), a)
  if (Math.abs(near.t - t) <= HYDRO_SNAP_MS) return { v: near.v, snapped: true }
  if (t < a.t || t > b.t || b.t - a.t > HYDRO_GAP_MS) return null
  const f = (t - a.t) / Math.max(1, b.t - a.t)
  return { v: a.v + (b.v - a.v) * f, snapped: false }
}

// ------------------------------------------------------------------------------------------------ levels
/** The gauge's NWS flood levels on this axis, in display units (none when NWS set them in the other kind of unit). */
export function levelsFor(gauge: Pick<RiverGauge, 'thresholds'>, axis: HydroAxis, units: HydroUnits): Partial<Record<HydroLevel, number>> {
  const th = gauge.thresholds
  if (!th) return {}
  const flowLevels = isFlowUnit(th.unit)
  if ((axis === 'flow') !== flowLevels) return {}
  const out: Partial<Record<HydroLevel, number>> = {}
  for (const k of HYDRO_LEVELS) {
    const raw = axis === 'stage' ? stageToFt(th[k], th.unit) : flowToCfs(th[k], th.unit)
    if (raw != null) out[k] = display(raw, axis, units)
  }
  return out
}

/** The NWS category of a value against the gauge's levels (Fire-3d's comparison of NWS's own numbers). */
export function categoryOf(v: number, levels: Partial<Record<HydroLevel, number>>): GaugeCategory | null {
  if (!Object.keys(levels).length) return null
  for (const k of [...HYDRO_LEVELS].reverse()) {
    const l = levels[k]
    if (l != null && v >= l) return k
  }
  return 'no_flooding'
}

/** "MINOR" / "MODERATE" / "MAJOR" / "ACTION STAGE" / "BELOW FLOOD STAGE" (from the PLAN-5 §5.3 table). */
export function categoryWord(c: GaugeCategory): string {
  if (c === 'minor' || c === 'moderate' || c === 'major') return c.toUpperCase()
  if (c === 'action') return 'ACTION STAGE'
  return GAUGE_CATEGORY_DISPLAY[c].short.replace(/\s*\(NWS\)$/, '').toUpperCase()
}

/** The chart's value range: the data with a margin, stretched to NWS levels close to it; other levels are pinned. */
export function valueRange(values: readonly number[], levels: Partial<Record<HydroLevel, number>>, axis: HydroAxis, units: HydroUnits): { vMin: number; vMax: number } {
  const lv = HYDRO_LEVELS.map((k) => levels[k]).filter((x): x is number => x != null)
  const data = values.length ? values : lv.length ? [lv[0]] : [0]
  let lo = Math.min(...data)
  let hi = Math.max(...data)
  const minSpan = axis === 'stage' ? (units === 'metric' ? 0.6 : 2) : Math.max(Math.abs(hi) * 0.2, units === 'metric' ? 3 : 100)
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2
    lo = mid - minSpan / 2
    hi = mid + minSpan / 2
  }
  const span = hi - lo
  // a level within half the data's span of the range is shown in full (flood stage just above a rising river)
  for (const l of [...lv].sort((a, b) => Math.abs(a - (lo + hi) / 2) - Math.abs(b - (lo + hi) / 2))) {
    if (l > hi && l - hi <= span * 0.5) hi = l
    if (l < lo && lo - l <= span * 0.5) lo = l
  }
  const pad = (hi - lo) * 0.1
  let vMin = lo - pad
  const vMax = hi + pad
  if (axis === 'flow' && vMin < 0 && lo >= 0) vMin = 0
  return { vMin, vMax }
}

// ------------------------------------------------------------------------------------------------ the model
const upper = (s: string) => s.toUpperCase()

/** The observed source's short name from the gauge's data attribution ("Observations courtesy of U.S. Geological
 *  Survey" → "USGS"), else "NWS". */
export function observedSource(g: Pick<RiverGauge, 'data_attribution'>): string {
  for (const a of g.data_attribution ?? []) {
    const m = /courtesy of\s+(?:the\s+)?(.+?)\.?$/i.exec(a.text ?? '')
    if (!m) continue
    const name = m[1].trim()
    if (/u\.?\s*s\.?\s*geological survey|\busgs\b/i.test(name)) return 'USGS'
    return name.length > 24 ? `${name.slice(0, 23)}…` : name
  }
  return 'NWS'
}

/** "WED NOV 4 10:00 MST"-style time for mono labels (the gauge's zone). */
export function monoTime(ms: number, tf: TimeFmt, o: { weekday?: boolean; zone?: boolean } = {}): string {
  return upper(`${fmtDayDate(ms, tf.tz, { weekday: o.weekday })} ${fmtClock(ms, tf, { zone: o.zone ?? true })}`)
}

const modelOrder: Record<ModelSeries['name'], number> = { analysis_assimilation: 0, short_range: 1, medium_range_blend: 2 }

export function buildHydrograph(input: HydrographInput): HydrographModel {
  const { gauge, axis, units, nowMs, widthPx } = input
  const tf: TimeFmt = { tz: input.zone, clock: input.clock ?? '24h' }
  const { unit, unitWord } = unitLabels(axis, units)
  const s = gauge.series ?? null
  const observedAll = seriesPoints(s?.observed, axis, units, s?.stage_unit ?? gauge.observed.unit, s?.flow_unit ?? gauge.observed.flow_unit)
  const forecastAll = seriesPoints(s?.forecast, axis, units, s?.stage_unit ?? gauge.observed.unit, s?.flow_unit ?? gauge.observed.flow_unit)
  const startMs = nowMs - HYDRO_PAST_MS
  const fcEnd = forecastAll.length ? forecastAll[forecastAll.length - 1].t : null
  const endMs = fcEnd != null ? Math.max(fcEnd, nowMs + HYDRO_MIN_FUTURE_MS) : nowMs + HYDRO_FUTURE_MS
  const observedIn = observedAll.filter((p) => p.t >= startMs && p.t <= Math.max(nowMs, startMs))
  const observed = thinPoints(observedIn, startMs, endMs, widthPx)
  const latestPt = observedIn.length ? observedIn[observedIn.length - 1] : null
  const fcIn = forecastAll.filter((p) => p.t <= endMs && p.t >= startMs)
  const forecastJoined = latestPt != null && fcIn.length > 0 && fcIn[0].t > latestPt.t
  const forecast = forecastJoined && latestPt ? [latestPt, ...fcIn] : fcIn

  // the model: flow axis only, only with a reach (D20, C28)
  let modelState: HydroModelState
  let modelReason: string | null = null
  let model: HydroModelLine[] = []
  if (axis !== 'flow') modelState = 'stage_axis'
  else if (!gauge.reach_id) modelState = 'none'
  else if (input.model && input.model.model_output === true && input.model.status === 'available' && input.model.series?.length) {
    modelState = 'available'
    model = [...input.model.series]
      .sort((a, b) => modelOrder[a.name] - modelOrder[b.name])
      .map((ser) => ({
        name: ser.name,
        referenceMs: ser.reference_ms,
        points: ser.points
          .map(([t, v]) => {
            const cfs = flowToCfs(v, ser.unit)
            return cfs == null ? null : { t, v: display(cfs, 'flow', units) }
          })
          .filter((p): p is HydroPoint => p != null && p.t >= startMs && p.t <= endMs)
          .sort((a, b) => a.t - b.t),
      }))
      .filter((l) => l.points.length > 0)
    if (!model.length) modelState = 'unavailable'
  } else if (input.modelLoading && !input.model) modelState = 'loading'
  else {
    modelState = 'unavailable'
    modelReason = input.model?.reason ?? null
  }

  const levels = levelsFor(gauge, axis, units)
  const hasLevels = Object.keys(levels).length > 0
  const values = [...observedIn, ...fcIn, ...model.flatMap((l) => l.points)].map((p) => p.v)
  const { vMin, vMax } = valueRange(values, levels, axis, units)
  const thresholds: HydroThreshold[] = HYDRO_LEVELS.flatMap((level) => {
    const value = levels[level]
    if (value == null) return []
    const pinned = value > vMax ? 'above' : value < vMin ? 'below' : null
    const label = `${upper(level)} ${fmtValue(value, axis, units)}${pinned === 'above' ? ' ↑' : pinned === 'below' ? ' ↓' : ''}`
    return [{ level, value, label, pinned }]
  })
  // faint bands above minor, none below action: minor → moderate, moderate → major, above major
  const bands: HydroBand[] = []
  const minor = levels.minor
  const moderate = levels.moderate
  const major = levels.major
  if (minor != null) bands.push({ level: 'minor', from: minor, to: moderate ?? major ?? Math.max(vMax, minor) })
  if (moderate != null) bands.push({ level: 'moderate', from: moderate, to: major ?? Math.max(vMax, moderate) })
  if (major != null) bands.push({ level: 'major', from: major, to: Math.max(vMax, major) })

  const latest = latestPt
    ? (() => {
        const stale = nowMs - latestPt.t > HYDRO_STALE_MS
        const ageText = fmtRelative(latestPt.t, nowMs)
        const label = upper(`${fillCopy(HYDRO.latest, { time: fmtClock(latestPt.t, tf), age: ageText })}${stale ? ` · ${HYDRO.stale}` : ''}`)
        return { t: latestPt.t, v: latestPt.v, label, stale, ageText }
      })()
    : null

  // the crest: the highest forecast step; "HIGH … AT END · STILL RISING" when it is the last step (C7)
  let crest: HydrographModel['crest'] = null
  if (fcIn.length) {
    let top = fcIn[0]
    for (const p of fcIn) if (p.v > top.v) top = p
    const lastStep = forecastAll[forecastAll.length - 1]
    const atEnd = top.t >= lastStep.t || (axis === 'stage' && gauge.forecast?.crest_at_end === true)
    const value = fmtValue(top.v, axis, units)
    const label = atEnd
      ? fillCopy(HYDROGRAPH_MARKS.highAtEnd, { value, UNIT: unit })
      : fillCopy(HYDROGRAPH_MARKS.crest, { value, UNIT: unit, 'DAY HH:MM': upper(`${fmtDayDate(top.t, tf.tz, { weekday: true }).split(' ')[0]} ${fmtClock(top.t, tf)}`) })
    crest = { t: top.t, v: top.v, label, atEnd }
  }

  const productTicks: HydroProductTick[] = input.products
    .filter((a) => a.sent_ms != null && a.sent_ms >= startMs && a.sent_ms <= endMs)
    .map((a) => {
      const ptf: TimeFmt = { tz: a.time_zone || tf.tz, clock: tf.clock }
      return {
        t: a.sent_ms as number,
        label: fillCopy(HYDRO.productTick, { event: a.event, sender: a.sender_name?.trim() || 'NWS', time: fmtAt(a.sent_ms as number, ptf, { zone: true }) }),
        emergency: a.emergency,
      }
    })
    .sort((a, b) => a.t - b.t)

  const dayTicks: HydroDayTick[] = localDayTicks(startMs, endMs, tf.tz).map((t) => ({ t, label: upper(fmtDayDate(t, tf.tz, { weekday: true })) }))

  const empty: string[] = []
  if (!observedIn.length) empty.push(HYDROGRAPH_EMPTY.noReadings)
  if (!gauge.thresholds) empty.push(HYDROGRAPH_EMPTY.noStages)
  else if (!hasLevels && axis === 'flow') empty.push(HYDRO.flowNoStages)
  if (!fcIn.length) empty.push(gauge.is_forecast_point ? HYDRO.noForecastNow : HYDROGRAPH_EMPTY.noForecast)
  if (modelState === 'unavailable') empty.push(HYDROGRAPH_EMPTY.noModel)

  const issued = s?.forecast_issued_ms ?? gauge.forecast?.issued_ms ?? null
  const rfc = gauge.forecast?.producer?.trim() || gauge.rfc?.trim() || 'RFC'
  const forecastLabel = fcIn.length
    ? upper(issued != null ? fillCopy(HYDRO.forecast, { rfc, time: monoTime(issued, tf) }) : fillCopy(HYDRO.forecastNoTime, { rfc }))
    : null

  return {
    lid: gauge.lid,
    name: gauge.name,
    zone: tf.tz,
    axis,
    units,
    unit,
    unitWord,
    nowMs,
    startMs,
    endMs,
    vMin,
    vMax,
    observed,
    forecast,
    forecastJoined,
    model,
    modelState,
    modelReason,
    thresholds,
    bands,
    latest,
    crest,
    productTicks,
    dayTicks,
    empty,
    observedLabel: upper(fillCopy(HYDRO.observed, { source: observedSource(gauge) })),
    forecastLabel,
    modelLabel: upper(HYDRO.model),
    hasLevels,
  }
}

// ------------------------------------------------------------------------------------------------ geometry
/** x of a time (0..1 across the plot). */
export function xFrac(m: Pick<HydrographModel, 'startMs' | 'endMs'>, t: number): number {
  return (t - m.startMs) / Math.max(1, m.endMs - m.startMs)
}

/** y of a value (0 at the top, 1 at the bottom). */
export function yFrac(m: Pick<HydrographModel, 'vMin' | 'vMax'>, v: number): number {
  return 1 - (v - m.vMin) / Math.max(1e-9, m.vMax - m.vMin)
}

/** The handle's time, kept inside the chart (null = now). */
export function clampCursor(m: Pick<HydrographModel, 'startMs' | 'endMs' | 'nowMs'>, cursorMs: number | null): number {
  const t = cursorMs ?? m.nowMs
  return Math.min(m.endMs, Math.max(m.startMs, t))
}

/** Keyboard on the handle: ←/→ one hour (Shift six), Home / End the chart's ends; null for other keys. */
export function stepCursor(m: Pick<HydrographModel, 'startMs' | 'endMs' | 'nowMs'>, cursorMs: number | null, key: string, shift: boolean): number | null {
  const t = clampCursor(m, cursorMs)
  const step = (shift ? 6 : 1) * HOUR_MS
  if (key === 'ArrowLeft' || key === 'ArrowDown') return Math.max(m.startMs, t - step)
  if (key === 'ArrowRight' || key === 'ArrowUp') return Math.min(m.endMs, t + step)
  if (key === 'Home') return m.startMs
  if (key === 'End') return m.endMs
  return null
}

// ------------------------------------------------------------------------------------------------ the handle
export interface CursorReadout {
  t: number
  /** "NOV 4 10:00 MST". */
  timeText: string
  /** "15.2 FT OBSERVED · MINOR" / "17.1 FT FORECAST (NWS) · MODERATE" / "7,060 FT³/S OBSERVED". */
  line1: string
  /** "MODEL · NWM · EXPERIMENTAL · 7,630 FT³/S (RUN NOV 4 10:00 MST)" (flow axis, model available), on its own line. */
  modelLine: string | null
  kind: 'observed' | 'forecast' | 'none'
  category: GaugeCategory | null
  /** Fire-3d drew the value between two points (HYDRO.interpolated). */
  interpolated: boolean
  /** The handle is after now: the views keep the products in effect now (C1, CURSOR_FUTURE_PRODUCTS). */
  future: boolean
  /** The reading shown is the latest one and it is older than 3 h. */
  stale: boolean
  /** Metric units: the value in the original units ("17.6 ft"), for the tooltip. */
  original: string | null
}

/** What the handle says at `cursorMs` (null = now). The observed record until the latest reading, then the NWS
 *  forecast; in flow mode the model on its own line (never combined with NWS's value, C28). */
export function cursorReadout(m: HydrographModel, cursorMs: number | null, tf: TimeFmt): CursorReadout {
  const t = clampCursor(m, cursorMs)
  const future = cursorMs != null && cursorMs > m.nowMs
  const latestT = m.latest?.t ?? Number.NEGATIVE_INFINITY
  const obs = t <= latestT + HYDRO_SNAP_MS ? valueAt(m.observed, t) : null
  const fc = !obs && t >= latestT ? valueAt(m.forecast, t) : null
  const hit = obs ?? fc
  const kind: CursorReadout['kind'] = obs ? 'observed' : fc ? 'forecast' : 'none'
  const levels = levelsFromThresholds(m)
  const category = hit ? categoryOf(hit.v, levels) : null
  const value = hit ? `${hit.snapped ? '' : '≈'}${fmtValue(hit.v, m.axis, m.units)} ${m.unit}` : ''
  const word = kind === 'observed' ? upper(HYDRO.observedWord) : kind === 'forecast' ? upper(HYDRO.forecastWord) : upper(HYDRO.noValue)
  const line1 = [hit ? `${value} ${word}` : word, category ? categoryWord(category) : null].filter(Boolean).join(' · ')
  let modelLine: string | null = null
  if (m.axis === 'flow' && m.modelState === 'available') {
    // the series that covers the handle: the analysis up to its end, then the short range, then the medium range
    for (const l of m.model) {
      const mv = valueAt(l.points, t)
      if (!mv) continue
      modelLine = fillCopy(HYDROGRAPH_MARKS.model, {
        flow: `${mv.snapped ? '' : '≈'}${fmtValue(mv.v, 'flow', m.units)}`,
        'run time': `RUN ${monoTime(l.referenceMs, tf)}`,
      })
      if (m.units === 'metric') modelLine = modelLine.replace('FT³/S', 'M³/S')
      break
    }
  }
  const stale = kind === 'observed' && m.latest != null && m.latest.stale && Math.abs(t - m.latest.t) <= HYDRO_SNAP_MS
  let original: string | null = null
  if (hit && m.units === 'metric') {
    const back = m.axis === 'stage' ? hit.v * FT_PER_M : hit.v / M3S_PER_CFS
    original = fillCopy(HYDRO.originalUnits, { value: `${fmtValue(back, m.axis, 'us')} ${m.axis === 'stage' ? 'ft' : 'ft³/s'}` })
  }
  return { t, timeText: monoTime(t, tf), line1, modelLine, kind, category, interpolated: hit ? !hit.snapped : false, future, stale, original }
}

function levelsFromThresholds(m: Pick<HydrographModel, 'thresholds'>): Partial<Record<HydroLevel, number>> {
  const out: Partial<Record<HydroLevel, number>> = {}
  for (const th of m.thresholds) out[th.level] = th.value
  return out
}

/** The handle's full one-line label ("NOV 4 10:00 MST · 15.2 FT OBSERVED · MINOR"). */
export function cursorLabel(r: Pick<CursorReadout, 'timeText' | 'line1'>): string {
  return `${r.timeText} · ${r.line1}`
}

/** Days shown (for screen readers): "Nov 1 – Nov 9". */
export function spanText(m: Pick<HydrographModel, 'startMs' | 'endMs' | 'zone'>): string {
  return `${fmtDayDate(m.startMs, m.zone)} – ${fmtDayDate(m.endMs, m.zone)}`
}

