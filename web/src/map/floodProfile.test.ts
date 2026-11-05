import { describe, expect, it } from 'vitest'
import { DEFAULT_FLOOD_LAYERS } from '../state/flood'
import { floodLayerShown, floodProfile } from './floodProfile'

describe('flood map profiles (D12, D21, D22; C13, C14)', () => {
  it('Public never draws model output or NWS category maps; FEMA is a toggle, off by default', () => {
    const p = floodProfile('public-flood')
    expect(p.model).toBe(false)
    expect(p.modelHighFlow).toBe(false)
    expect(p.catfim).toBe(false)
    expect(p.floodplain).toBe('toggle')
    expect(floodLayerShown('public-flood', 'model', true)).toBe(false)
    expect(floodLayerShown('public-flood', 'floodplain', DEFAULT_FLOOD_LAYERS.floodplain)).toBe(false)
    expect(floodLayerShown('public-flood', 'floodplain', true)).toBe(true)
  })

  it('Command: FEMA, CatFIM and the model are toggles, off by default', () => {
    const p = floodProfile('command-flood')
    for (const k of ['floodplain', 'catfim', 'model', 'modelHighFlow'] as const) {
      expect(p[k]).toBe('toggle')
      expect(floodLayerShown('command-flood', k, DEFAULT_FLOOD_LAYERS[k])).toBe(false)
    }
    expect(p.warnings).toBe(true)
  })

  it('the overview draws flood markers and gauges only; fire views no flood layer', () => {
    const o = floodProfile('overview')
    expect(Object.entries(o).filter(([, v]) => v !== false).map(([k]) => k).sort()).toEqual(['events', 'gauges'])
    expect(Object.values(floodProfile('public-fire')).every((v) => v === false)).toBe(true)
  })
})
