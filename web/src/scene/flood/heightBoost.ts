// The 3D flood view's height boost (brief 6, decision 3; web-forensic-flood-3d). Flat floodplains look like a sheet of
// paper at the fire view's ×1.5, so a flood opens with the bundle's own suggested boost (manifest.terrain3d.relief
// .exaggeration, RELIEF_RULE in backend/fire3d/floods/copy_time.py). A bundle prepared before brief 6 has no relief
// measure: the same rule runs here on the heights of the whole 3D area. The factor is always on screen ("Height ×10")
// and the user can change it (the view dock's select; FLOOD_BOOSTS go past the rule's ×10 cap for the flattest
// places). Pure; tested in heightBoost.test.ts. The scene applies it in FloodFx.tsx (useFloodHeightBoost).
import type { FloodManifest, FloodRelief } from '../../api/types'

/** The rule's steps (RELIEF_RULE): the smallest that makes the middle 90% of the heights span RELIEF_TARGET of the
 *  area's width, at most ×10. */
export const RELIEF_STEPS = [1.5, 2, 3, 5, 8, 10] as const
export const RELIEF_TARGET = 0.02
/** The choices of the view dock for a flood (the fire view keeps its own [1, 1.5, 2, 3, 5]). */
export const FLOOD_BOOSTS = [1, 1.5, 2, 3, 5, 8, 10, 15, 20] as const

export interface AutoBoost {
  /** The automatic height boost of this flood. */
  factor: number
  /** 'bundle': the backend's relief measure (near the mapped water); 'grid': measured here on the whole 3D area. */
  basis: 'bundle' | 'grid'
  /** The middle 90% of the measured heights (5th to 95th percentile), metres. */
  rangeM: number
  widthM: number
  /** False when even ×10 leaves the middle 90% under 2% of the width (the area still looks flat at the default). */
  reached: boolean
  relief: FloodRelief | null
}

/** The rule on a span of heights. */
export function boostForRange(rangeM: number, widthM: number): { factor: number; reached: boolean } {
  const target = RELIEF_TARGET * Math.max(1, widthM)
  for (const s of RELIEF_STEPS) if (Math.max(0, rangeM) * s >= target) return { factor: s, reached: true }
  return { factor: RELIEF_STEPS[RELIEF_STEPS.length - 1], reached: false }
}

/** 5th and 95th percentiles of the finite heights (a strided sample of at most ~260k cells, so a 1024² grid sorts
 *  quickly). */
export function heightPercentiles(heights: ArrayLike<number>): { p05: number; p95: number } | null {
  const n = heights.length
  const stride = Math.max(1, Math.floor(n / 262_144))
  const vals: number[] = []
  for (let i = 0; i < n; i += stride) {
    const v = heights[i]
    if (Number.isFinite(v) && v > -1000 && v < 10000) vals.push(v)
  }
  if (vals.length < 16) return null
  const sorted = Float64Array.from(vals).sort()
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
  return { p05: at(0.05), p95: at(0.95) }
}

/** The flood's automatic height boost: the bundle's relief measure, else the same rule on the whole grid. */
export function autoBoost(m: Pick<FloodManifest, 'terrain3d' | 'grid'>, heights: ArrayLike<number>): AutoBoost {
  const relief = m.terrain3d?.relief ?? null
  if (relief && Number.isFinite(relief.exaggeration) && relief.exaggeration > 0) {
    const reached = relief.target_reached ?? boostForRange(relief.range_m, relief.width_m).reached
    return { factor: relief.exaggeration, basis: 'bundle', rangeM: relief.range_m, widthM: relief.width_m, reached, relief }
  }
  const widthM = m.grid.extent_m
  const p = heightPercentiles(heights)
  const rangeM = p ? Math.max(0, p.p95 - p.p05) : 0
  const { factor, reached } = boostForRange(rangeM, widthM)
  return { factor, basis: 'grid', rangeM, widthM, reached, relief: null }
}

/** The dock's choices: FLOOD_BOOSTS plus the automatic value and the current one when they are not in it. */
export function boostOptions(auto: number, current: number): number[] {
  const set = new Set<number>(FLOOD_BOOSTS)
  for (const v of [auto, current]) if (Number.isFinite(v) && v > 0) set.add(v)
  return [...set].sort((a, b) => a - b)
}

/** "10", "1.5" (no trailing zeros). */
export function fmtFactor(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)
}

/** "6.7" m or "12" m: a height span in words-friendly precision. */
export function fmtSpan(m: number): string {
  return m >= 10 ? String(Math.round(m)) : String(Math.round(m * 10) / 10)
}

/** The height boost the scene uses: the user's own choice for this flood, else the automatic one. */
export function boostInUse(floodId: string, auto: number, choice: { floodId: string; factor: number } | null): { factor: number; user: boolean } {
  return choice && choice.floodId === floodId && Number.isFinite(choice.factor) && choice.factor > 0 ? { factor: choice.factor, user: choice.factor !== auto } : { factor: auto, user: false }
}
