// The Command flood view's extra map layers (brief 5, web-flood-command; PLAN-5 §4.5, D12, D20, D22; CONTRACT §16.11).
// Pure: sources, layer specs, features and the pattern image, tested in floodCommandLayers.test.ts; map/floodController.ts
// puts them on the map from state/floodLayerData.ts. Kept apart from the Public view's area layers (floodAreaLayers.ts):
//   catfim     NWS's category flood map for the primary gauge (an official map library NWS calls experimental): a
//              second hatch angle in water blue, a dashed edge and the label "NWS CATEGORY MAP · EXPERIMENTAL"
//   model      the National Water Model's flooded area (experimental model output): a faint amber fill, an amber dotted
//              edge and the label "MODEL · EXPERIMENTAL"; never a water colour, never in a water layer
//   highFlow   the model's high-flow reaches: amber dotted lines with "MODEL · EXPERIMENTAL"
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
  ] as unknown as LayerSpecification[]
}

export const FLOOD_CMD_GEOJSON = [FLOOD_CMD_SOURCES.catfim, FLOOD_CMD_SOURCES.model, FLOOD_CMD_SOURCES.highFlow] as const

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
