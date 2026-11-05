// Command's extra map layers (PLAN-5 §4.5, D12, D20, D22): fx-flood-* ids, each behind its own toggle and drawn only in
// Command; the model never in a water layer or colour; features only from their own kind of answer.
import { describe, expect, it } from 'vitest'
import { RFC_FIM } from '../api/__fixtures__/floods/edgeCases'
import catfim from '../api/__fixtures__/floods/maps-catfim.json'
import nwmAnalysis from '../api/__fixtures__/floods/model-nwm_analysis.json'
import nwmHighFlow from '../api/__fixtures__/floods/model-nwm_high_flow.json'
import type { FloodMapResponse, ModelOutputResponse } from '../api/types'
import { DEFAULT_FLOOD_LAYERS } from '../state/flood'
import { CATFIM_MAP_LABEL, catfimFeatures, catfimHatchImage, CMD_LAYER_KEY, FLOOD_CMD_LAYERS, floodCommandLayers, highFlowFeatures, MODEL_MAP_LABEL, modelFeatures } from './floodCommandLayers'
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
    expect(labels).toEqual([MODEL_MAP_LABEL, MODEL_MAP_LABEL])
    const catLabel = floodCommandLayers().find((l) => l.id === FLOOD_CMD_LAYERS.catfimLabel) as { layout: Record<string, unknown> }
    expect(catLabel.layout['text-field']).toBe(CATFIM_MAP_LABEL)
    expect(CATFIM_MAP_LABEL).toMatch(/EXPERIMENTAL/)
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
