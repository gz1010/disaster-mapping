// River gauges as bars in 3D (brief 5, PLAN-5 §4.7): pure maths behind GaugeBars.tsx (named gaugeBarMath, never
// gaugeBars.ts, which would clash with GaugeBars.tsx on macOS). A gauge is a thin vertical bar standing on the terrain
// at the gauge, on a fixed scale (1 ft of river stage = 12 m of bar), with ticks at NWS's action, minor, moderate and
// major flood stages, a bright cap at the latest reading and a hollow cap at NWS's forecast crest (or forecast high).
// The bar's height is the river stage at the gauge, scaled; it is not water depth (the key says so). Static: nothing
// moves. Labels never show a raw category value (PLAN-5 §5.3).
import type { ManifestGrid, RiverGauge } from '../../api/types'
import { lonLatToLocal } from '../../lib/reproject'
import { fmtAt, fmtClock, localYear, type TimeFmt } from '../../lib/time'
import { CATEGORY_COLORS, gaugeTone } from '../../map/floodStyle'
import { GAUGE_CATEGORY_DISPLAY, type GaugeCategoryKey } from '../../ui/shell/floodCopy'
import type { Units } from '../../state/workspace'

/** Metres of bar per foot of river stage (PLAN-5 §4.7: 1 ft = 12 m). */
export const BAR_M_PER_FT = 12
const FT_PER_M = 3.28084

/** A stage in feet (metres converted; any other unit: null, never guessed). */
export function stageFt(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const u = (unit ?? 'ft').trim().toLowerCase()
  if (u === 'ft' || u === 'feet' || u === 'foot') return value
  if (u === 'm' || u === 'meters' || u === 'metres') return value * FT_PER_M
  return null
}

/** Bar height (m) of a stage in feet; a stage at or below 0 ft stands at the ground. */
export function barHeightM(ft: number | null): number | null {
  return ft == null ? null : Math.max(0, ft) * BAR_M_PER_FT
}

export type TickCategory = 'action' | 'minor' | 'moderate' | 'major'

export interface BarTick {
  category: TickCategory
  heightM: number
  color: string
}

export interface GaugeBarSpec {
  lid: string
  x: number
  z: number
  member: boolean
  /** Height of the latest reading (m of bar), null without one. */
  heightM: number | null
  /** Colour of the bar and its cap: the reading's NWS category (grey below flood stage or without a category). */
  color: string
  /** Hollow cap: NWS's forecast crest or forecast high (m of bar), null without an NWS forecast. */
  crestM: number | null
  crestColor: string
  ticks: BarTick[]
  /** Top of everything drawn (m of bar), for the label. */
  topM: number
  label: string
}

const TICKS: TickCategory[] = ['action', 'minor', 'moderate', 'major']

/** "MODERATE" / "BELOW FLOOD STAGE" / "READING NOT CURRENT": the category's short label (§5.3), capitals, without
 *  "(NWS)" and " flooding" (the label already says NWS by its gauge id and the key names the issuer). */
export function categoryCaps(category: string | null | undefined): string {
  const key = (category && category in GAUGE_CATEGORY_DISPLAY ? category : 'unknown') as GaugeCategoryKey
  return GAUGE_CATEGORY_DISPLAY[key].short.replace(/\s*\(NWS\)$/, '').replace(/ flooding$/i, '').toUpperCase()
}

/** "17.6 FT" / "5.4 M" in the viewer's units (null without a reading). */
export function stageCaps(value: number | null | undefined, unit: string | null | undefined, units: Units): string | null {
  const ft = stageFt(value, unit)
  if (ft == null) return value != null && Number.isFinite(value) ? `${value.toFixed(1)} ${(unit ?? '').toUpperCase()}`.trim() : null
  return units === 'metric' ? `${(ft / FT_PER_M).toFixed(1)} M` : `${ft.toFixed(1)} FT`
}

/** The bar's mono label: "ZZRF1 · 17.6 FT · MODERATE · 6:25 PM MST" (the reading's own time in the gauge's zone; a
 *  reading from another day also names its day). */
export function gaugeBarLabel(g: Pick<RiverGauge, 'lid' | 'observed' | 'time_zone'>, units: Units, tf: TimeFmt, nowMs: number): string {
  const parts = [g.lid]
  const stage = stageCaps(g.observed.value, g.observed.unit, units)
  parts.push(stage ?? 'NO READING')
  parts.push(categoryCaps(g.observed.category))
  const t = g.observed.valid_ms
  if (t != null && Number.isFinite(t)) {
    const zoned: TimeFmt = { tz: g.time_zone || tf.tz, clock: tf.clock }
    const sameDay = Math.abs(nowMs - t) < 20 * 3_600_000 && localYear(t, zoned.tz) === localYear(nowMs, zoned.tz)
    parts.push((sameDay ? fmtClock(t, zoned, { zone: true }) : fmtAt(t, zoned, { zone: true })).toUpperCase())
  }
  return parts.join(' · ')
}

/** One bar per gauge inside the bundle's area (members first, then nearby gauges). */
export function gaugeBars(
  gauges: readonly RiverGauge[],
  grid: Pick<ManifestGrid, 'center_e' | 'center_n' | 'utm_zone' | 'extent_m'>,
  o: { units: Units; tf: TimeFmt; nowMs: number },
): GaugeBarSpec[] {
  const half = grid.extent_m / 2
  const out: GaugeBarSpec[] = []
  for (const g of gauges) {
    if (!Number.isFinite(g.lat) || !Number.isFinite(g.lon)) continue
    const [x, z] = lonLatToLocal(g.lon, g.lat, grid)
    if (Math.abs(x) > half || Math.abs(z) > half) continue
    const th = g.thresholds
    const ticks: BarTick[] = []
    if (th)
      for (const c of TICKS) {
        const h = barHeightM(stageFt(th[c], th.unit))
        if (h != null) ticks.push({ category: c, heightM: h, color: CATEGORY_COLORS[c] })
      }
    const heightM = barHeightM(stageFt(g.observed.value, g.observed.unit))
    const crestM = g.forecast ? barHeightM(stageFt(g.forecast.max_value, th?.unit ?? g.observed.unit)) : null
    const topM = Math.max(heightM ?? 0, crestM ?? 0, ...ticks.map((t) => t.heightM), 0)
    out.push({
      lid: g.lid,
      x,
      z,
      member: g.member,
      heightM,
      color: CATEGORY_COLORS[gaugeTone(g.observed.category)],
      crestM,
      crestColor: CATEGORY_COLORS[gaugeTone(g.forecast?.category ?? null)],
      ticks,
      topM,
      label: gaugeBarLabel(g, o.units, o.tf, o.nowMs),
    })
  }
  return out.sort((a, b) => Number(b.member) - Number(a.member))
}
