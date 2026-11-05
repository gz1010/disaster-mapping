// Command's extra map layers (PLAN-5 §4.5, D12, D20, D22): fx-flood-* ids, each behind its own toggle and drawn only in
// Command; the model never in a water layer or colour; features only from their own kind of answer.
import { describe, expect, it } from 'vitest'
import { RFC_FIM } from '../api/__fixtures__/floods/edgeCases'
import catfim from '../api/__fixtures__/floods/maps-catfim.json'
import nwmAnalysis from '../api/__fixtures__/floods/model-nwm_analysis.json'
import nwmHighFlow from '../api/__fixtures__/floods/model-nwm_high_flow.json'
import type { FloodMapResponse, ModelOutputResponse } from '../api/types'
import { DEFAULT_FLOOD_LAYERS } from '../state/flood'
import { CATFIM_MAP_LABEL, catfimFeatures, catfimHatchImage, CMD_LAYER_KEY, FLOOD_CMD_LAYERS, floodCommandLayers, highFlowFeatures, labelPoints, MODEL_MAP_LABEL, modelFeatures, pointInside } from './floodCommandLayers'
import { floodLayerShown } from './floodProfile'
import { FLOOD_AREA, FLOOD_MODEL, FLOOD_TOKENS } from './floodStyle'

const cat = () => structuredClone(catfim) as unknown as FloodMapResponse
const ana = () => structuredClone(nwmAnalysis) as unknown as ModelOutputResponse
const hf = () => structuredClone(nwmHighFlow) as unknown as ModelOutputResponse

describe('Command flood layers', () => {
  it('fx-flood-* ids, each following catfim, model or modelHighFlow', () => {
    for (const l of floodCommandLayers()) {
      expect(l.id.startsWith('fx-flood-')).toBe(true)
      expect(['catfim', 'model', 'modelHighFlow']).toContain(CMD_LAYER_KEY[l.id])
    }
  })

  it('off by default and never in Public (D12, D22)', () => {
    for (const k of ['catfim', 'model', 'modelHighFlow'] as const) {
      expect(DEFAULT_FLOOD_LAYERS[k]).toBe(false)
      expect(floodLayerShown('public-flood', k, true)).toBe(false)
      expect(floodLayerShown('command-flood', k, true)).toBe(true)
      expect(floodLayerShown('command-flood', k, DEFAULT_FLOOD_LAYERS[k])).toBe(false)
    }
  })

  it('the model is amber and labelled MODEL · EXPERIMENTAL; never a water colour', () => {
    const water = new Set<string>([FLOOD_AREA.satelliteFill, FLOOD_AREA.forecastFill, FLOOD_AREA.forecastEdge, FLOOD_TOKENS['m-flood'], FLOOD_TOKENS['m-flood-edge'], FLOOD_AREA.warning])
    const model = floodCommandLayers().filter((l) => CMD_LAYER_KEY[l.id] !== 'catfim')
    for (const l of model) {
      const p = (l as { paint?: Record<string, unknown> }).paint ?? {}
      for (const k of ['fill-color', 'line-color', 'text-color']) if (k in p) expect(p[k]).toBe(FLOOD_MODEL)
      for (const v of Object.values(p)) if (typeof v === 'string') expect(water.has(v)).toBe(false)
    }
    const labels = model.filter((l) => l.type === 'symbol').map((l) => (l as { layout?: Record<string, unknown> }).layout?.['text-field'])
    // along the model's edge, along the high-flow reaches, and at points inside its largest polygons (WFC-R13)
    expect(labels).toEqual([MODEL_MAP_LABEL, MODEL_MAP_LABEL, MODEL_MAP_LABEL])
    const catLabel = floodCommandLayers().find((l) => l.id === FLOOD_CMD_LAYERS.catfimLabel) as { layout: Record<string, unknown> }
    expect(catLabel.layout['text-field']).toBe(CATFIM_MAP_LABEL)
    const catPoint = floodCommandLayers().find((l) => l.id === FLOOD_CMD_LAYERS.catfimPointLabel) as { layout: Record<string, unknown>; minzoom: number }
    expect(catPoint.layout['text-field']).toBe(CATFIM_MAP_LABEL)
    expect(CATFIM_MAP_LABEL).toMatch(/EXPERIMENTAL/)
  })

  it('point labels (WFC-R13): from z8, at a point inside each of the largest polygons, spread along the flood, largest first', () => {
    for (const id of [FLOOD_CMD_LAYERS.modelPointLabel, FLOOD_CMD_LAYERS.catfimPointLabel]) {
      const l = floodCommandLayers().find((x) => x.id === id) as { minzoom: number; layout: Record<string, unknown> }
      expect(l.minzoom).toBeLessThanOrEqual(8)
      expect(l.layout['symbol-placement']).toBeUndefined()
      expect(l.layout['symbol-sort-key']).toEqual(['get', 'rank'])
      // a wide collision padding: zoomed out only a few of the points keep a label
      expect(l.layout['text-padding']).toBeGreaterThanOrEqual(20)
    }
    // many small fragments (a real flood's model reaches), about 8.6 km apart: one label in each, largest first, so a
    // part of the flood zoomed into keeps its own label
    const sq = (x: number, y: number, d: number) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] } })
    const fc = { type: 'FeatureCollection', features: [sq(-95, 39, 0.01), sq(-94.9, 39, 0.05), sq(-94.8, 39, 0.02), sq(-94.7, 39, 0.03), sq(-94.6, 39, 0.04), sq(-94.5, 39, 0.005)] } as never
    const pts = labelPoints(fc)
    expect(pts.features).toHaveLength(6)
    const first = (pts.features[0].geometry as unknown as { coordinates: [number, number] }).coordinates
    expect(first[0]).toBeGreaterThan(-94.9)
    expect(first[0]).toBeLessThan(-94.85)
    expect(pts.features.map((f) => (f.properties as { rank: number }).rank)).toEqual([0, 1, 2, 3, 4, 5])
    // at most `max`, the largest kept
    expect(labelPoints(fc, 3).features).toHaveLength(3)
    // never two within minKm: fragments 1.7 km apart get one label
    const near = { type: 'FeatureCollection', features: [sq(-95, 39, 0.01), sq(-94.98, 39, 0.012), sq(-94.96, 39, 0.008)] } as never
    expect(labelPoints(near).features).toHaveLength(1)
    // the category map's few labels sit above the model's many (later = drawn and placed first), so they win a collision
    const ids = floodCommandLayers().map((x) => x.id)
    expect(ids.indexOf(FLOOD_CMD_LAYERS.catfimPointLabel)).toBeGreaterThan(ids.indexOf(FLOOD_CMD_LAYERS.modelPointLabel))
    // an L-shaped polygon: the point is inside it (not at its bounding box's centre)
    const l = [[0, 0], [10, 0], [10, 1], [1, 1], [1, 10], [0, 10], [0, 0]] as [number, number][]
    const p = pointInside([l])!
    expect(p[0] >= 0 && p[0] <= 10 && p[1] >= 0 && p[1] <= 10).toBe(true)
    expect(p[0] <= 1 || p[1] <= 1).toBe(true)
    expect(labelPoints({ type: 'FeatureCollection', features: [] }).features).toHaveLength(0)
    // the model's own fixture: one label inside its polygon
    expect(labelPoints(modelFeatures(ana())).features).toHaveLength(1)
  })

  it('features only from their own kind of answer (an official map never feeds the model, nor the reverse)', () => {
    expect(catfimFeatures(cat()).features).toHaveLength(1)
    expect(catfimFeatures(RFC_FIM()).features).toHaveLength(0)
    expect(catfimFeatures(ana() as unknown as FloodMapResponse).features).toHaveLength(0)
    expect(modelFeatures(ana()).features).toHaveLength(1)
    expect(modelFeatures(cat() as unknown as ModelOutputResponse).features).toHaveLength(0)
    expect(modelFeatures({ ...ana(), status: 'unavailable' }).features).toHaveLength(0)
    expect(highFlowFeatures(hf()).features).toHaveLength(8)
    expect(highFlowFeatures(ana()).features).toHaveLength(0)
  })

  it('the category map hatch runs the other way from the forecast area (a second angle), in water blue', () => {
    const h = catfimHatchImage()
    const px = (x: number, y: number) => h.image.data[(y * h.image.width + x) * 4 + 3]
    expect(px(0, 0)).toBeGreaterThan(0)
    expect(px(1, 1)).toBeGreaterThan(0)
    expect(px(1, 0)).toBeGreaterThan(0)
    expect(px(8, 0)).toBe(0)
  })
})
