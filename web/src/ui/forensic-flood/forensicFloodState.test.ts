// Forensic's own flood toggles (C10, D12, D21, D22): FEMA, the NWS category maps and the model start off; nothing is
// added to state/flood.ts.
import { afterEach, describe, expect, it } from 'vitest'
import { useFlood } from '../../state/flood'
import { FLOOD_FORENSIC_DEFAULTS, FLOOD_FORENSIC_LAYERS, shownOpacity, useForensicFlood } from './forensicFloodState'

afterEach(() => useForensicFlood.getState().resetLayers())

describe('forensicFloodState', () => {
  it('starts with FEMA, the NWS category maps and the model off; the water layers, warnings and gauges on', () => {
    const L = useForensicFlood.getState().layers
    expect(L.floodplain.visible).toBe(false)
    expect(L.catfim.visible).toBe(false)
    expect(L.model.visible).toBe(false)
    for (const k of ['terrain', 'naip', 'satellite', 'forecastArea', 'warnings', 'gauges'] as const) expect(L[k].visible).toBe(true)
    expect(Object.keys(FLOOD_FORENSIC_DEFAULTS).sort()).toEqual([...FLOOD_FORENSIC_LAYERS].sort())
  })

  it('toggles, clamps opacities, resets, and an off layer draws at 0', () => {
    const s = useForensicFlood.getState()
    s.setLayerVisible('model', true)
    s.setLayerOpacity('model', 3)
    expect(useForensicFlood.getState().layers.model).toEqual({ visible: true, opacity: 1 })
    s.toggleLayer('model')
    expect(shownOpacity(useForensicFlood.getState().layers.model)).toBe(0)
    s.resetLayers()
    expect(useForensicFlood.getState().layers.model).toEqual(FLOOD_FORENSIC_DEFAULTS.model)
    s.setTab('evidence')
    expect(useForensicFlood.getState().tab).toBe('evidence')
  })

  it("keeps Forensic's own toggles out of the flood store", () => {
    const st = useFlood.getState() as unknown as Record<string, unknown>
    const layers = Object.keys(useFlood.getState().layers)
    for (const k of ['naip', 'terrain', 'contours', 'telemetry']) expect(layers).not.toContain(k)
    expect(st.tab).toBeUndefined()
    // toggling Forensic's model switch leaves the map views' model layer alone
    useForensicFlood.getState().setLayerVisible('model', true)
    expect(useFlood.getState().layers.model).toBe(false)
  })
})
