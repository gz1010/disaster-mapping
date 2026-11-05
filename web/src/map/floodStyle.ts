// Flood colours (brief 5, PLAN-5 §4.9, CONTRACT §16.13): the TS mirror of the flood tokens in styles/map-tokens.css,
// the national overview's flood marker palette (the fire marker rules with water blues) and the gauge category
// colours. NOAA's own legend is kept for action to major (tuned for the dark map); its green "No Flood" becomes a grey
// hollow diamond and its light blue "not defined" a grey diamond with "?" (green reads as "safe"; light blue is the
// flood colour here). No green in any flood colour: floodStyle.test.ts bans hue 75°-165° with saturation above 25 %.
// The category is always written next to its colour, and diamonds grow with the category.
import type { MapTheme } from './layers'

/** The flood tokens (styles/map-tokens.css, same names without the leading "--"). */
export const FLOOD_TOKENS = {
  'm-flood': '#2a8ce6',
  'm-flood-edge': '#7fd4ff',
  'm-flood-channel': '#103f8a',
  'm-flood-channel-edge': '#4fb4ff',
  'm-flood-lead': '#4fc3ff',
  'm-flood-ink': '#dff4ff',
  'm-flood-ink-2': '#f2fbff',
  'm-flood-forecast': '#cfeaff',
  'm-flood-disc': '#1a221f',
  'm-cat-action': '#f2e04a',
  'm-cat-minor': '#ff9a3c',
  'm-cat-moderate': '#ff4d4d',
  'm-cat-major': '#c766ff',
  'm-cat-below': '#8a8a8a',
  'm-cat-undefined': '#8a8a8a',
} as const

/** NWS warning areas use the existing alert pink; National Water Model output the modeled amber. */
export const FLOOD_ALERT = '#ee7aa0'
export const FLOOD_MODEL = '#f5c060'

/** Gauge category groups the map draws (CONTRACT §16.2 GaugeCategory, reduced to what has a colour). */
export type GaugeTone = 'action' | 'minor' | 'moderate' | 'major' | 'below' | 'undefined'

export const CATEGORY_COLORS: Record<GaugeTone, string> = {
  action: FLOOD_TOKENS['m-cat-action'],
  minor: FLOOD_TOKENS['m-cat-minor'],
  moderate: FLOOD_TOKENS['m-cat-moderate'],
  major: FLOOD_TOKENS['m-cat-major'],
  below: FLOOD_TOKENS['m-cat-below'],
  undefined: FLOOD_TOKENS['m-cat-undefined'],
}

/** Gauge diamond size (px across) by category: grows with the category (PLAN-5 §4.3: 6 / 7 / 8 / 9). Below flood
 *  stage and "not defined" are drawn at the action size, hollow / with "?". */
export const DIAMOND_PX: Record<GaugeTone, number> = { below: 6, undefined: 6, action: 6, minor: 7, moderate: 8, major: 9 }

/** The tone of an NWPS / riv_gauges category value (CONTRACT §16.2): every value maps to a colour that is never green.
 *  no_flooding → below (grey hollow); not_defined, low_threshold, obs_not_current, out_of_service, fcst_not_current,
 *  unknown → undefined (grey, "?"). */
export function gaugeTone(category: string | null | undefined): GaugeTone {
  switch (category) {
    case 'action':
    case 'minor':
    case 'moderate':
    case 'major':
      return category
    case 'no_flooding':
      return 'below'
    default:
      return 'undefined'
  }
}

/** Rank of a flood category for sorting and "highest" checks (0 = none). */
export const CATEGORY_RANK: Record<string, number> = { action: 1, minor: 2, moderate: 3, major: 4 }

/** Flood marker colours on the national map (the fire PALETTE's shape, map/overviewLayers.ts): a transparent water-blue
 *  circle with a light ring and a near-white centre dot (or the flood's highest category colour); the light road map
 *  gets darker blues so the thin rings still read. */
export const FLOOD_PALETTE = {
  dark: {
    casing: 'rgba(3,6,10,0.38)',
    fill: 'rgba(42,140,230,0.10)',
    ring: 'rgba(127,212,255,0.8)',
    dot: FLOOD_TOKENS['m-flood-ink-2'],
    otherRing: 'rgba(127,212,255,0.45)',
    otherGroupRing: 'rgba(127,212,255,0.4)',
    otherFill: 'rgba(127,212,255,0.04)',
    otherDot: 'rgba(127,212,255,0.8)',
    count: FLOOD_TOKENS['m-flood-forecast'],
    countUnit: FLOOD_TOKENS['m-flood-edge'],
    otherCount: '#a9d8ef',
    tick: 'fx-flood-group-tick-dark',
    ink: '#f0f0f0',
    halo: 'rgba(3,6,10,0.85)',
    sel: '#ffffff',
  },
  light: {
    casing: 'rgba(255,255,255,0.7)',
    fill: 'rgba(16,63,138,0.14)',
    ring: 'rgba(16,63,138,0.9)',
    dot: '#0b2a5c',
    otherRing: 'rgba(30,80,140,0.8)',
    otherGroupRing: 'rgba(30,80,140,0.55)',
    otherFill: 'rgba(30,80,140,0.06)',
    otherDot: 'rgba(30,80,140,0.9)',
    count: '#0b2a5c',
    countUnit: '#103f8a',
    otherCount: '#1e508c',
    tick: 'fx-flood-group-tick-light',
    ink: '#16202b',
    halo: 'rgba(255,255,255,0.95)',
    sel: '#16202b',
  },
} as const

export type FloodPalette = (typeof FLOOD_PALETTE)['dark'] | (typeof FLOOD_PALETTE)['light']

/** The palette for a map theme (aerial uses the dark values, as the fire markers do). */
export function floodPalette(theme: MapTheme): FloodPalette {
  return theme === 'light' ? FLOOD_PALETTE.light : FLOOD_PALETTE.dark
}

/** The tick colour of a group's "N FLOODS" label (RGBA bytes, map/overviewLayers.ts groupTickImage's shape). */
export const FLOOD_TICK_RGBA: Record<'dark' | 'light', [number, number, number, number]> = { dark: [127, 212, 255, 180], light: [16, 63, 138, 220] }

/** Area layers of the flood views (drawn by map/floodController.ts): satellite water, the NWS forecast flooded area, the
 *  main channel (the basemap's own water restyled), NWS warning areas, the FEMA floodplain and model output. */
export const FLOOD_AREA = {
  satelliteFill: 'rgba(42,140,230,0.42)',
  satelliteEdge: FLOOD_TOKENS['m-flood-edge'],
  noView: 'rgba(154,154,154,0.45)',
  forecastFill: 'rgba(42,140,230,0.16)',
  forecastEdge: FLOOD_TOKENS['m-flood-edge'],
  channelFill: 'rgba(16,63,138,0.55)',
  channelEdge: 'rgba(79,180,255,0.5)',
  warning: FLOOD_ALERT,
  floodplain: 'rgba(150,170,200,0.35)',
  model: FLOOD_MODEL,
} as const
