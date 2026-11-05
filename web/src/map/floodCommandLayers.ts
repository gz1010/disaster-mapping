// The Command flood view's extra map layers (brief 5, web-flood-command; PLAN-5 §4.5, D12, D20, D22; CONTRACT §16.11).
// Pure: sources, layer specs, features and the pattern image, tested in floodCommandLayers.test.ts; map/floodController.ts
// puts them on the map from state/floodLayerData.ts. Kept apart from the Public view's area layers (floodAreaLayers.ts):
//   catfim     NWS's category flood map for the primary gauge (an official map library NWS calls experimental): a
//              second hatch angle in water blue, a dashed edge and the label "NWS CATEGORY MAP · EXPERIMENTAL"
//   model      the National Water Model's flooded area (experimental model output): a faint amber fill, an amber dotted
//              edge and the label "MODEL · EXPERIMENTAL"; never a water colour, never in a water layer
//   highFlow   the model's high-flow reaches: amber dotted lines with "MODEL · EXPERIMENTAL"
// The model's and the category map's polygons are often many small fragments (a real flood's model reaches), where a
// label along the edge never fits: each also gets point labels at a point inside its largest polygons (a few per flood,
// from z8; review WFC-R13), the line labels kept as an extra.
// Each follows its own Layers toggle (catfim, model, modelHighFlow), off by default and drawn only in Command
// (map/floodProfile.ts). Ids start with fx-flood-.
import type { LayerSpecification } from 'maplibre-gl'
import type { FloodMapResponse, ModelOutputResponse } from '../api/types'
import { isModelOutput } from '../official/floodModel'
import { FLOOD_MODEL, FLOOD_TOKENS } from './floodStyle'
import type { Feature, FeatureCollection, Geometry } from './overlayModel'

export const FLOOD_CMD_SOURCES = {
  catfim: 'fx-flood-catfim',
  model: 'fx-flood-model',
  highFlow: 'fx-flood-model-highflow',
  catfimPoints: 'fx-flood-catfim-pts',
  modelPoints: 'fx-flood-model-pts',
} as const

export const FLOOD_CMD_LAYERS = {
  catfimHatch: 'fx-flood-catfim-hatch',
  catfimLine: 'fx-flood-catfim-line',
  catfimLabel: 'fx-flood-catfim-label',
  modelFill: 'fx-flood-model-fill',
  modelLine: 'fx-flood-model-line',
  modelLabel: 'fx-flood-model-label',
  highFlowLine: 'fx-flood-model-highflow-line',
  highFlowLabel: 'fx-flood-model-highflow-label',
  catfimPointLabel: 'fx-flood-catfim-pt-label',
  modelPointLabel: 'fx-flood-model-pt-label',
} as const

/** Which store toggle each layer follows (useFlood.layers; floodProfile.ts decides per view). */
export const CMD_LAYER_KEY: Record<string, 'catfim' | 'model' | 'modelHighFlow'> = {
  [FLOOD_CMD_LAYERS.catfimHatch]: 'catfim',
  [FLOOD_CMD_LAYERS.catfimLine]: 'catfim',
  [FLOOD_CMD_LAYERS.catfimLabel]: 'catfim',
  [FLOOD_CMD_LAYERS.modelFill]: 'model',
  [FLOOD_CMD_LAYERS.modelLine]: 'model',
  [FLOOD_CMD_LAYERS.modelLabel]: 'model',
  [FLOOD_CMD_LAYERS.highFlowLine]: 'modelHighFlow',
  [FLOOD_CMD_LAYERS.highFlowLabel]: 'modelHighFlow',
  [FLOOD_CMD_LAYERS.catfimPointLabel]: 'catfim',
  [FLOOD_CMD_LAYERS.modelPointLabel]: 'model',
}

export const CATFIM_HATCH_IMAGE = 'fx-flood-catfim-hatch-img'
export const MODEL_MAP_LABEL = 'MODEL · EXPERIMENTAL'
export const CATFIM_MAP_LABEL = 'NWS CATEGORY MAP · EXPERIMENTAL'

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const isPoly = (t: string | undefined) => t === 'Polygon' || t === 'MultiPolygon'
const isLine = (t: string | undefined) => t === 'LineString' || t === 'MultiLineString'

/** NWS's category flood map polygons (an official envelope only: model output is refused). */
export function catfimFeatures(resp: FloodMapResponse | null | undefined): FeatureCollection {
  if (!resp || isModelOutput(resp) || resp.kind !== 'flood_map' || resp.map !== 'catfim' || resp.status !== 'available') return EMPTY
  const features = resp.features.features.filter((f) => isPoly(f.geometry?.type))
  return { type: 'FeatureCollection', features: features as unknown as Feature<Geometry>[] }
}

/** The model's flooded-area polygons (model output only: `model_output: true`, an nwm map kind). */
export function modelFeatures(resp: ModelOutputResponse | null | undefined): FeatureCollection {
  if (!resp || !isModelOutput(resp) || resp.status !== 'available' || !resp.features || (resp.kind !== 'nwm_analysis' && resp.kind !== 'nwm_5day')) return EMPTY
  const features = resp.features.features.filter((f) => isPoly(f.geometry?.type))
  return { type: 'FeatureCollection', features: features as unknown as Feature<Geometry>[] }
}

/** The model's high-flow reaches (lines; `recur_cat` verbatim, model output only). */
export function highFlowFeatures(resp: ModelOutputResponse | null | undefined): FeatureCollection {
  if (!resp || !isModelOutput(resp) || resp.status !== 'available' || !resp.features || resp.kind !== 'nwm_high_flow') return EMPTY
  const features = resp.features.features.filter((f) => isLine(f.geometry?.type))
  return { type: 'FeatureCollection', features: features as unknown as Feature<Geometry>[] }
}

// ------------------------------------------------------------------------------------------------ point labels
type Ring = [number, number][]

/** A ring's area in km² (planar, scaled by the latitude's cosine; enough to rank polygons). */
function ringAreaKm2(r: Ring): number {
  if (r.length < 3) return 0
  const lat0 = (r.reduce((a, p) => a + p[1], 0) / r.length) * (Math.PI / 180)
  const kx = 111.32 * Math.cos(lat0)
  const ky = 110.57
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * kx) * (r[i][1] * ky) - (r[i][0] * kx) * (r[j][1] * ky)
  return Math.abs(a) / 2
}

/** A point inside a polygon (its outer ring; holes ignored): the middle of the widest horizontal span through it, at
 *  a few heights. Null for a degenerate ring. */
export function pointInside(rings: Ring[]): [number, number] | null {
  const outer = rings[0]
  if (!outer || outer.length < 3) return null
  const ys = outer.map((p) => p[1])
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  let best: { w: number; p: [number, number] } | null = null
  for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    const y = lo + (hi - lo) * f
    const xs: number[] = []
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const [x1, y1] = outer[j]
      const [x2, y2] = outer[i]
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k]
      if (!best || w > best.w) best = { w, p: [(xs[k] + xs[k + 1]) / 2, y] }
    }
  }
  return best?.p ?? null
}

/** Label points for a layer's polygons: a point inside each of the largest polygons (at most `max`, never two within
 *  `minKm` of each other, so they spread along the whole flood), largest first (`rank` 0 = largest, so MapLibre keeps
 *  it when labels collide). Zoomed out, the collision padding keeps a few; zoomed in, each part of the flood in view
 *  keeps its own (review WFC-R13). */
export function labelPoints(fc: FeatureCollection, max = 12, minKm = 5): FeatureCollection {
  const polys: { rings: Ring[]; area: number }[] = []
  for (const f of fc.features) {
    const g = f.geometry as { type?: string; coordinates?: unknown } | null
    if (!g) continue
    const list = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? (g.coordinates as unknown[]) : []) as Ring[][]
    for (const rings of list) if (Array.isArray(rings) && rings.length) polys.push({ rings, area: ringAreaKm2(rings[0]) })
  }
  polys.sort((a, b) => b.area - a.area)
  const out: Feature<Geometry>[] = []
  const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111.32 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110.57)
  for (const p of polys) {
    if (out.length >= max) break
    const at = pointInside(p.rings)
    if (!at || out.some((o) => km((o.geometry as { coordinates: [number, number] }).coordinates, at) < minKm)) continue
    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { rank: out.length } } as unknown as Feature<Geometry>)
  }
  return { type: 'FeatureCollection', features: out }
}

/** The layers, bottom to top: the category map, then the model (above the water layers, below the NWS warning areas;
 *  the caller inserts them there). */
export function floodCommandLayers(): LayerSpecification[] {
  const label = (id: string, source: string, text: string, color: string) => ({
    id,
    type: 'symbol',
    source,
    minzoom: 10,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 360,
      'text-field': text,
      'text-font': ['Noto Sans Regular'],
      'text-size': 10,
      'text-letter-spacing': 0.08,
      'text-max-angle': 30,
    },
    paint: { 'text-color': color, 'text-halo-color': 'rgba(10,10,10,0.9)', 'text-halo-width': 1.4 },
  })
  // a label at a point inside the largest polygons (review WFC-R13): from z8, the largest kept when labels collide;
  // the wide collision padding leaves a few per view
  const pointLabel = (id: string, source: string, text: string, color: string) => ({
    id,
    type: 'symbol',
    source,
    minzoom: 8,
    layout: {
      'text-field': text,
      'text-font': ['Noto Sans Regular'],
      'text-size': 10,
      'text-letter-spacing': 0.08,
      'symbol-sort-key': ['get', 'rank'],
      'text-padding': 28,
      'text-max-width': 30,
    },
    paint: { 'text-color': color, 'text-halo-color': 'rgba(10,10,10,0.92)', 'text-halo-width': 1.6 },
  })
  return [
    { id: FLOOD_CMD_LAYERS.catfimHatch, type: 'fill', source: FLOOD_CMD_SOURCES.catfim, paint: { 'fill-pattern': CATFIM_HATCH_IMAGE, 'fill-opacity': 0.85 } },
    {
      id: FLOOD_CMD_LAYERS.catfimLine,
      type: 'line',
      source: FLOOD_CMD_SOURCES.catfim,
      paint: { 'line-color': FLOOD_TOKENS['m-flood-edge'], 'line-opacity': 0.75, 'line-width': 1, 'line-dasharray': [2, 2] },
    },
    label(FLOOD_CMD_LAYERS.catfimLabel, FLOOD_CMD_SOURCES.catfim, CATFIM_MAP_LABEL, FLOOD_TOKENS['m-flood-edge']),
    { id: FLOOD_CMD_LAYERS.modelFill, type: 'fill', source: FLOOD_CMD_SOURCES.model, paint: { 'fill-color': FLOOD_MODEL, 'fill-opacity': 0.1 } },
    {
      id: FLOOD_CMD_LAYERS.modelLine,
      type: 'line',
      source: FLOOD_CMD_SOURCES.model,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': FLOOD_MODEL, 'line-opacity': 1, 'line-width': 2.4, 'line-dasharray': [0.1, 2] },
    },
    label(FLOOD_CMD_LAYERS.modelLabel, FLOOD_CMD_SOURCES.model, MODEL_MAP_LABEL, FLOOD_MODEL),
    {
      id: FLOOD_CMD_LAYERS.highFlowLine,
      type: 'line',
      source: FLOOD_CMD_SOURCES.highFlow,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': FLOOD_MODEL, 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 14, 3.2], 'line-dasharray': [0.1, 2] },
    },
    label(FLOOD_CMD_LAYERS.highFlowLabel, FLOOD_CMD_SOURCES.highFlow, MODEL_MAP_LABEL, FLOOD_MODEL),
    // the category map's few labels above the model's many, so they win a collision (it covers a small area)
    pointLabel(FLOOD_CMD_LAYERS.modelPointLabel, FLOOD_CMD_SOURCES.modelPoints, MODEL_MAP_LABEL, FLOOD_MODEL),
    pointLabel(FLOOD_CMD_LAYERS.catfimPointLabel, FLOOD_CMD_SOURCES.catfimPoints, CATFIM_MAP_LABEL, FLOOD_TOKENS['m-flood-edge']),
  ] as unknown as LayerSpecification[]
}

export const FLOOD_CMD_GEOJSON = [FLOOD_CMD_SOURCES.catfim, FLOOD_CMD_SOURCES.model, FLOOD_CMD_SOURCES.highFlow, FLOOD_CMD_SOURCES.catfimPoints, FLOOD_CMD_SOURCES.modelPoints] as const

type Img = { image: { width: number; height: number; data: Uint8Array }; options: { pixelRatio: number } }

/** NWS's category map: thin #7fd4ff anti-diagonals (the forecast area's hatch runs the other way), every 8 css px. */
export function catfimHatchImage(): Img {
  const size = 16
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = (x - y + size) % size
      const a = d < 2 ? 0.7 : d < 3 ? 0.25 : 0
      if (!a) continue
      const i = (y * size + x) * 4
      data[i] = 127
      data[i + 1] = 212
      data[i + 2] = 255
      data[i + 3] = Math.round(255 * a)
    }
  return { image: { width: size, height: size, data }, options: { pixelRatio: 2 } }
}
