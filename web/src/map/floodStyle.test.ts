import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATEGORY_COLORS, DIAMOND_PX, FLOOD_AREA, FLOOD_PALETTE, FLOOD_TICK_RGBA, FLOOD_TOKENS, gaugeTone } from './floodStyle'

/** [hue°, saturation 0-1] of a #rgb / #rrggbb / rgb() / rgba() colour; null for anything else. */
function hueSat(c: string): [number, number] | null {
  let r: number, g: number, b: number
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c.trim())
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (x) => x + x) : hex[1]
    ;[r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  } else if (fn) [r, g, b] = [fn[1], fn[2], fn[3]].map(Number)
  else return null
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  h *= 60
  if (h < 0) h += 360
  return [h, s]
}

/** PLAN-5 §4.9 / CONTRACT §16.13: hue 75°-165° with saturation above 25 % is green. */
const isGreen = (c: string) => {
  const hs = hueSat(c)
  return hs != null && hs[0] >= 75 && hs[0] <= 165 && hs[1] > 0.25
}

const colours = (o: unknown): string[] => {
  if (typeof o === 'string') return hueSat(o) ? [o] : []
  if (Array.isArray(o)) return o.flatMap(colours)
  if (o && typeof o === 'object') return Object.values(o).flatMap(colours)
  return []
}

describe('flood colours (no green anywhere)', () => {
  it('the detector itself: NOAA green and the official green are caught, blues and greys are not', () => {
    expect(isGreen('#00FF00')).toBe(true)
    expect(isGreen('#8fd3a8')).toBe(true)
    expect(isGreen('#2a8ce6')).toBe(false)
    expect(isGreen('#8a8a8a')).toBe(false)
    expect(isGreen('rgba(127,212,255,0.8)')).toBe(false)
  })

  it('no token, palette, category or area colour is green', () => {
    const all = [...colours(FLOOD_TOKENS), ...colours(FLOOD_PALETTE), ...colours(CATEGORY_COLORS), ...colours(FLOOD_AREA)]
    expect(all.length).toBeGreaterThan(40)
    expect(all.filter(isGreen)).toEqual([])
    const tick = Object.values(FLOOD_TICK_RGBA).map(([r, g, b]) => `rgb(${r},${g},${b})`)
    expect(tick.filter(isGreen)).toEqual([])
  })

  it('the CSS tokens equal the TS mirror and none of them is green', () => {
    const css = readFileSync(new URL('../styles/map-tokens.css', import.meta.url), 'utf8')
    for (const [name, value] of Object.entries(FLOOD_TOKENS)) {
      const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css)
      expect(m?.[1].trim(), name).toBe(value)
      expect(isGreen(m![1]), name).toBe(false)
    }
  })

  it('every NWPS category maps to a non-green tone; diamonds grow with the category', () => {
    const cats = ['no_flooding', 'action', 'minor', 'moderate', 'major', 'not_defined', 'low_threshold', 'obs_not_current', 'out_of_service', 'fcst_not_current', 'unknown']
    for (const c of cats) expect(isGreen(CATEGORY_COLORS[gaugeTone(c)]), c).toBe(false)
    expect(gaugeTone('no_flooding')).toBe('below')
    expect(gaugeTone('not_defined')).toBe('undefined')
    expect(gaugeTone(null)).toBe('undefined')
    expect(DIAMOND_PX.action < DIAMOND_PX.minor && DIAMOND_PX.minor < DIAMOND_PX.moderate && DIAMOND_PX.moderate < DIAMOND_PX.major).toBe(true)
  })
})
