// The national map's flood markers and river gauges (brief 5, PLAN-5 §4.3, CONTRACT §16.11). Pure: features, sources,
// layer specs and the gauge diamond images; tested in floodLayers.test.ts. map/floodController.ts puts them on the map.
//   - Flood markers: the fire marker rules of map/overviewLayers.ts with a water palette (floodStyle.ts FLOOD_PALETTE),
//     one point per listed flood at its primary gauge (else its largest polygon's representative point). Kind from the
//     official level and category only (state/floodOverview.ts floodMarkerKind): large 15 px (pinned, never grouped,
//     label at every zoom, leader candidate), active 11, small 7, other 4.5 hollow. Groups of 3 or more close floods are
//     sized 10 + 4.2·√n px (max 36) with "28 FLOODS". The centre dot takes the highest category's colour.
//   - Labels "Animas River flood" (+ " · DEMO" for synthetic data); the leader overlay's second line comes from `meta`.
//   - Gauges at action stage or above as category diamonds from z5 (6 / 7 / 8 / 9 px, NOAA's hues tuned; never green; a
//     grey "?" when NWS has not set flood stages). Below-flood-stage gauges are drawn only inside a flood view.
// Source and layer ids start with fx-flood- (never a fire id).
import type { LayerSpecification } from 'maplibre-gl'
import type { FloodSummary, GaugeCategory } from '../api/types'
import { floodMarkerKind, floodRank, gaugeCategoryRank } from '../state/floodOverview'
import type { Units } from '../state/workspace'
import { floodDisplayName, floodDotColor, floodMeta, floodMetaColor, gaugeLabel } from '../ui/public/floodOverviewText'
import { CATEGORY_COLORS, DIAMOND_PX, FLOOD_PALETTE, FLOOD_TICK_RGBA, gaugeTone, type GaugeTone } from './floodStyle'
import type { MapTheme } from './layers'
import type { Feature, FeatureCollection, Geometry } from './overlayModel'
import { DOT_PX, HIT_MIN_PX, labelSide, MARKER_PX, OVERVIEW_GROUPS, OVR, overviewLayers, overviewSourceOptions, type OverviewGroup } from './overviewLayers'

/** The flood overview's three sources (the fire overview's split: pinned = large, active = active + small, other). */
export const FLOOD_SOURCES: Record<OverviewGroup, string> = {
  pinned: 'fx-flood-overview-pinned',
  active: 'fx-flood-overview-active',
  other: 'fx-flood-overview-other',
}
export const FLOOD_GAUGE_SOURCE = 'fx-flood-gauges'

/** The flood marker layers: the fire overview's ids with the fx-flood-overview- prefix. */
export const FLOOD_OVR = Object.fromEntries(Object.entries(OVR).map(([k, v]) => [k, v.replace('fx-overview-', 'fx-flood-overview-')])) as Record<keyof typeof OVR, string>

export const FLOOD_GAUGE_LAYERS = { diamond: 'fx-flood-gauge-diamond', mark: 'fx-flood-gauge-mark', label: 'fx-flood-gauge-label' } as const

/** Single-flood layers (a click or hover means that flood). */
export const FLOOD_POINT_LAYERS: readonly string[] = [
  FLOOD_OVR.pinnedHit,
  FLOOD_OVR.activeHit,
  FLOOD_OVR.otherHit,
  FLOOD_OVR.pinnedLive,
  FLOOD_OVR.pinnedPast,
  FLOOD_OVR.activePoint,
  FLOOD_OVR.otherPoint,
  FLOOD_OVR.pinnedLabel,
  FLOOD_OVR.activeLabel,
  FLOOD_OVR.otherLabel,
]
export const FLOOD_LABEL_LAYERS: readonly string[] = [FLOOD_OVR.pinnedLabel, FLOOD_OVR.activeLabel, FLOOD_OVR.otherLabel]
export const FLOOD_CLUSTER_LAYERS: readonly string[] = [FLOOD_OVR.activeCluster, FLOOD_OVR.otherCluster]

/** Gauges are drawn from this zoom (below it the flood's centre dot carries the category). */
export const GAUGE_MIN_ZOOM = 5

/** When a flood's label shows (as the fire labels' thresholds): large at every zoom, active from z5, small from z7, the
 *  rest from z9 (and on hover). */
export const FLOOD_LABEL_ZOOM = { large: 0, active: 5, small: 7, other: 9 } as const

const validPoint = (f: { lat: number; lon: number }) => Number.isFinite(f.lon) && Number.isFinite(f.lat) && Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180

export interface FloodSplit {
  pinned: FloodSummary[]
  active: FloodSummary[]
  other: FloodSummary[]
}

/** Split the shown floods into the three sources; `hidden` (the open flood) leaves the data. */
export function splitFloods(floods: readonly FloodSummary[], hidden: ReadonlySet<string> | readonly string[] = []): FloodSplit {
  const h = hidden instanceof Set ? hidden : new Set(hidden as readonly string[])
  const out: FloodSplit = { pinned: [], active: [], other: [] }
  for (const f of floods) {
    if (h.has(f.id) || !validPoint(f)) continue
    const k = floodMarkerKind(f)
    if (k === 'large') out.pinned.push(f)
    else if (k === 'other') out.other.push(f)
    else out.active.push(f)
  }
  return out
}

/** One point feature per flood: the properties the fire spec builder and the leader overlay read. */
export function floodFeatures(floods: readonly FloodSummary[], units: Units): FeatureCollection {
  const features: Feature<Geometry>[] = []
  floods.forEach((f, i) => {
    if (!validPoint(f)) return
    const kind = floodMarkerKind(f)
    const r = MARKER_PX[kind]
    const rank = floodRank(f)
    features.push({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      properties: {
        id: f.id,
        name: f.name,
        live: kind !== 'other',
        small: false,
        kind,
        r,
        lr: r,
        dot: DOT_PX[kind],
        dot_color: floodDotColor(f),
        hit: Math.max(HIT_MIN_PX, r + 3),
        sort: rank,
        rank,
        lz: FLOOD_LABEL_ZOOM[kind],
        label: floodDisplayName(f),
        meta: floodMeta(f, units),
        meta_color: floodMetaColor(f),
        synthetic: f.synthetic,
        side: labelSide(f.lon),
      },
    })
  })
  return { type: 'FeatureCollection', features }
}

/** The three sources' data. */
export function floodOverviewData(split: FloodSplit, units: Units): Record<OverviewGroup, FeatureCollection> {
  return { pinned: floodFeatures(split.pinned, units), active: floodFeatures(split.active, units), other: floodFeatures(split.other, units) }
}

/** GeoJSON source options of one flood group (groups keep their largest rank as max_rank). */
export function floodSourceOptions(group: OverviewGroup, containerWidthPx: number): Record<string, unknown> {
  return overviewSourceOptions(group, containerWidthPx, { rankProp: 'max_rank', rankValue: 'rank' })
}

/** The flood marker layers (the fire builder with the flood palette, unit, sources, ids and no chips). */
export function floodMarkerLayers(theme: MapTheme, o: { narrow?: boolean } = {}): LayerSpecification[] {
  return overviewLayers(theme, {
    narrow: o.narrow,
    palette: FLOOD_PALETTE,
    unit: ' FLOODS',
    rankProp: 'max_rank',
    sources: FLOOD_SOURCES,
    ids: FLOOD_OVR,
    chips: false,
    dotColorProp: 'dot_color',
  })
}

// ------------------------------------------------------------------------------------------------ gauges
export interface GaugePoint {
  lid: string
  name: string
  lat: number
  lon: number
  observed_category: GaugeCategory
  observed_value: number | null
  unit: string | null
  waterbody?: string | null
}

/** The diamond image of a tone (device pixels at pixelRatio 2). */
export const DIAMOND_IMAGE: Record<GaugeTone, string> = {
  action: 'fx-flood-diamond-action',
  minor: 'fx-flood-diamond-minor',
  moderate: 'fx-flood-diamond-moderate',
  major: 'fx-flood-diamond-major',
  below: 'fx-flood-diamond-below',
  undefined: 'fx-flood-diamond-undefined',
}

/** Gauges as diamonds: at action stage or above on the national map (`minRank` 1), every status inside a flood view
 *  (`minRank` 0). The label always writes the category next to its colour. */
export function gaugeFeatures(gauges: readonly GaugePoint[], units: Units, minRank = 1): FeatureCollection {
  const features: Feature<Geometry>[] = []
  const seen = new Set<string>()
  for (const g of gauges) {
    if (seen.has(g.lid) || !validPoint(g)) continue
    const rank = gaugeCategoryRank(g.observed_category)
    if (rank < minRank) continue
    seen.add(g.lid)
    const tone = gaugeTone(g.observed_category)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [g.lon, g.lat] },
      properties: { lid: g.lid, name: g.name, tone, icon: DIAMOND_IMAGE[tone], sort: rank, label: gaugeLabel(g, units), color: CATEGORY_COLORS[tone] },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** One diamond (a square turned 45°) of `px` across: filled in the category colour with a dark rim; 'below' is a grey
 *  hollow diamond (never NOAA's green), 'undefined' a grey one with a "?" drawn by the label layer. */
export function diamondImage(tone: GaugeTone): { image: { width: number; height: number; data: Uint8Array }; options: { pixelRatio: number } } {
  const px = DIAMOND_PX[tone] + 3
  const size = Math.ceil(px * 2)
  const data = new Uint8Array(size * size * 4)
  const hex = CATEGORY_COLORS[tone]
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const c = (size - 1) / 2
  const half = DIAMOND_PX[tone] // half-diagonal in device px (the diamond is DIAMOND_PX across in CSS px)
  const hollow = tone === 'below'
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - c) + Math.abs(y - c) // L1 distance: a diamond
      const i = (y * size + x) * 4
      const edge = half - d // > 0 inside
      if (edge < -1.5) continue
      const a = Math.max(0, Math.min(1, edge + 1.5))
      const rim = edge < 1.4
      const inner = hollow ? (edge < 2.4 && edge >= 0.6 ? rgb : null) : rgb
      const col = rim ? [10, 14, 20] : inner
      if (!col) continue
      data[i] = col[0]
      data[i + 1] = col[1]
      data[i + 2] = col[2]
      data[i + 3] = Math.round(255 * a * (rim ? 0.85 : 1))
    }
  return { image: { width: size, height: size, data }, options: { pixelRatio: 2 } }
}

/** The group tick of "N FLOODS" in the flood blues (as overviewLayers.groupTickImage). */
export function floodTickImage(theme: 'dark' | 'light'): { image: { width: number; height: number; data: Uint8Array }; options: { pixelRatio: number } } {
  const w = 12
  const h = 4
  const data = new Uint8Array(w * h * 4)
  const c = FLOOD_TICK_RGBA[theme]
  for (let x = 0; x < w; x++)
    for (const y of [1, 2]) {
      const i = (y * w + x) * 4
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      data[i + 3] = Math.round(c[3] * (y === 1 ? 0.8 : 0.5))
    }
  return { image: { width: w, height: h, data }, options: { pixelRatio: 2 } }
}

/** The gauge layers (from z5): diamonds, the "?" of a gauge without flood stages, and their labels from z8. */
export function gaugeLayers(theme: MapTheme): LayerSpecification[] {
  const light = theme === 'light'
  return [
    {
      id: FLOOD_GAUGE_LAYERS.diamond,
      type: 'symbol',
      source: FLOOD_GAUGE_SOURCE,
      minzoom: GAUGE_MIN_ZOOM,
      layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'sort'] },
    },
    {
      id: FLOOD_GAUGE_LAYERS.mark,
      type: 'symbol',
      source: FLOOD_GAUGE_SOURCE,
      minzoom: GAUGE_MIN_ZOOM,
      filter: ['==', ['get', 'tone'], 'undefined'],
      layout: { 'text-field': '?', 'text-font': ['Noto Sans Bold'], 'text-size': 9, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': '#101418' },
    },
    {
      id: FLOOD_GAUGE_LAYERS.label,
      type: 'symbol',
      source: FLOOD_GAUGE_SOURCE,
      minzoom: 8,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10.5,
        'text-anchor': 'left',
        'text-offset': [0.9, 0],
        'text-optional': true,
        'text-padding': 3,
        'symbol-sort-key': ['-', 0, ['get', 'sort']],
      },
      paint: { 'text-color': light ? '#16202b' : '#e6eef5', 'text-halo-color': light ? 'rgba(255,255,255,0.95)' : 'rgba(3,6,10,0.85)', 'text-halo-width': 1.4 },
    },
  ] as unknown as LayerSpecification[]
}

/** Every flood overview group (for loops over the three sources). */
export const FLOOD_GROUPS = OVERVIEW_GROUPS
