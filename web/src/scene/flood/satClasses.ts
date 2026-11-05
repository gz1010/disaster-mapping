// Water seen by satellite in 3D (brief 5, PLAN-5 §4.7, D25, CONTRACT §16.12): the OPERA DSWx water classes of the flood
// bundle's water_satellite.bin, and how the terrain drapes each one. The table is the only place the classes get a
// look: the shader reads it through a 256 x 2 lookup texture built from it (satLutData), so a test over the table is a
// test over what the terrain draws.
//   0 not water      no drape (the ground). Not an all-clear: dry pixels do not mean no flooding.
//   1 open water     #2a8ce6 fill with a #7fd4ff edge
//   2 partial water  #7fd4ff, lighter
//   252 snow / ice   no view of water: the grey "no view" cross-hatch
//   253 cloud        the grey "no view" cross-hatch (never transparent, never drawn as land)
//   254 ocean        not checked (NASA masks it): no drape
//   255 no data      the same grey "no view" cross-hatch as clouds (in the bundle grid also every cell outside the image)
// Any other value is not a DSWx class: drawn as "no view" too, so an unknown value never reads as dry ground.

export type SatDrapeKind = 'land' | 'water' | 'partial' | 'noview' | 'ocean'

export interface SatDrape {
  kind: SatDrapeKind
  /** What the class means, for the key and the probe. */
  label: string
  /** Drape colour (sRGB hex), null when nothing is drawn. */
  color: string | null
  /** Fill opacity 0..1 (0: nothing drawn). */
  alpha: number
  /** Drawn with the grey "no view" cross-hatch. */
  hatch: boolean
  /** Counts as water for the water edge line. */
  water: boolean
}

/** Water fill (--m-flood), its edge (--m-flood-edge) and the "no view" grey (the satellite PNG's, CONTRACT §16.5). */
export const SAT_WATER = '#2a8ce6'
export const SAT_EDGE = '#7fd4ff'
export const SAT_NO_VIEW = '#9a9a9a'

const LAND: SatDrape = { kind: 'land', label: 'Not water on this pass (not an all-clear)', color: null, alpha: 0, hatch: false, water: false }
const WATER: SatDrape = { kind: 'water', label: 'Water seen by satellite', color: SAT_WATER, alpha: 0.55, hatch: false, water: true }
const PARTIAL: SatDrape = { kind: 'partial', label: 'Partial water seen by satellite', color: SAT_EDGE, alpha: 0.35, hatch: false, water: true }
const SNOW: SatDrape = { kind: 'noview', label: 'No satellite view of water (snow or ice)', color: SAT_NO_VIEW, alpha: 0.45, hatch: true, water: false }
const CLOUD: SatDrape = { kind: 'noview', label: 'No satellite view (clouds)', color: SAT_NO_VIEW, alpha: 0.45, hatch: true, water: false }
const OCEAN: SatDrape = { kind: 'ocean', label: 'Ocean (not checked)', color: null, alpha: 0, hatch: false, water: false }
const NO_DATA: SatDrape = { kind: 'noview', label: 'No satellite view (no data)', color: SAT_NO_VIEW, alpha: 0.45, hatch: true, water: false }
const UNKNOWN: SatDrape = { kind: 'noview', label: 'No satellite view (unknown value)', color: SAT_NO_VIEW, alpha: 0.45, hatch: true, water: false }

/** The DSWx WTR classes the bundle stores (CONTRACT §16.3). */
export const SAT_CLASSES: Readonly<Record<number, SatDrape>> = { 0: LAND, 1: WATER, 2: PARTIAL, 252: SNOW, 253: CLOUD, 254: OCEAN, 255: NO_DATA }

/** The drape of a class value (any value that is not a DSWx class: "no view"). */
export function satDrapeOf(cls: number): SatDrape {
  return SAT_CLASSES[cls] ?? UNKNOWN
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** The lookup texture's bytes, 256 x 2 RGBA (row 0 first): row 0 = the drape colour (sRGB) and its opacity; row 1 =
 *  r: water (edge line), g: "no view" hatch, b: drawn at all, a: 255. */
export function satLutData(): Uint8Array {
  const out = new Uint8Array(256 * 2 * 4)
  for (let c = 0; c < 256; c++) {
    const d = satDrapeOf(c)
    const [r, g, b] = d.color ? hexRgb(d.color) : [0, 0, 0]
    out.set([r, g, b, Math.round(d.alpha * 255)], c * 4)
    out.set([d.water ? 255 : 0, d.hatch ? 255 : 0, d.alpha > 0 ? 255 : 0, 255], (256 + c) * 4)
  }
  return out
}

/** Shares of a class raster (0..1 of all cells): water (1), partial (2), no view (252, 253, 255, unknown), for the key. */
export function satShares(classes: Uint8Array): { water: number; partial: number; noView: number } {
  let w = 0
  let p = 0
  let n = 0
  for (let i = 0; i < classes.length; i++) {
    const d = satDrapeOf(classes[i])
    if (d.kind === 'water') w++
    else if (d.kind === 'partial') p++
    else if (d.kind === 'noview') n++
  }
  const t = Math.max(1, classes.length)
  return { water: w / t, partial: p / t, noView: n / t }
}
