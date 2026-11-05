// Forensic's own flood toggles (brief 5, PLAN-5 §4.7, C10): the 3D flood view's layer switches (terrain, aerial photo,
// FEMA floodplain, satellite water, the NWS forecast flooded area, NWS warning areas, river gauges, NWS category flood
// maps, the National Water Model, contours, gauge labels), their opacities and the right panel's open tab. Never new
// keys in state/flood.ts: the map views' layers live there, these only here. FEMA, the category maps and the model
// start off (D12, D21, D22); everything else on.
import { create } from 'zustand'

export type FloodForensicLayer =
  | 'terrain'
  | 'naip'
  | 'floodplain'
  | 'satellite'
  | 'forecastArea'
  | 'warnings'
  | 'gauges'
  | 'catfim'
  | 'model'
  | 'contours'
  | 'telemetry'

export type FloodForensicTab = 'layers' | 'analysis' | 'evidence' | 'notes'

export interface FloodLayerSetting {
  visible: boolean
  opacity: number
}

export const FLOOD_FORENSIC_LAYERS: readonly FloodForensicLayer[] = ['terrain', 'naip', 'floodplain', 'satellite', 'forecastArea', 'warnings', 'gauges', 'catfim', 'model', 'contours', 'telemetry']

/** Defaults: FEMA floodplain, NWS category flood maps and model output off (D12, D21, D22); everything else on. */
export const FLOOD_FORENSIC_DEFAULTS: Readonly<Record<FloodForensicLayer, FloodLayerSetting>> = {
  terrain: { visible: true, opacity: 1 },
  naip: { visible: true, opacity: 1 },
  floodplain: { visible: false, opacity: 0.8 },
  satellite: { visible: true, opacity: 0.9 },
  forecastArea: { visible: true, opacity: 0.85 },
  warnings: { visible: true, opacity: 1 },
  gauges: { visible: true, opacity: 1 },
  catfim: { visible: false, opacity: 0.85 },
  model: { visible: false, opacity: 0.85 },
  contours: { visible: true, opacity: 0.35 },
  telemetry: { visible: true, opacity: 1 },
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

function defaults(): Record<FloodForensicLayer, FloodLayerSetting> {
  const out = {} as Record<FloodForensicLayer, FloodLayerSetting>
  for (const k of FLOOD_FORENSIC_LAYERS) out[k] = { ...FLOOD_FORENSIC_DEFAULTS[k] }
  return out
}

export interface ForensicFloodState {
  layers: Record<FloodForensicLayer, FloodLayerSetting>
  tab: FloodForensicTab
  setLayerVisible(k: FloodForensicLayer, visible: boolean): void
  toggleLayer(k: FloodForensicLayer): void
  setLayerOpacity(k: FloodForensicLayer, opacity: number): void
  resetLayers(): void
  setTab(t: FloodForensicTab): void
}

export const useForensicFlood = create<ForensicFloodState>()((set) => ({
  layers: defaults(),
  tab: 'layers',
  setLayerVisible: (k, visible) => set((s) => (s.layers[k].visible === visible ? {} : { layers: { ...s.layers, [k]: { ...s.layers[k], visible } } })),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: { ...s.layers[k], visible: !s.layers[k].visible } } })),
  setLayerOpacity: (k, opacity) => set((s) => ({ layers: { ...s.layers, [k]: { ...s.layers[k], opacity: clamp01(opacity) } } })),
  resetLayers: () => set({ layers: defaults() }),
  setTab: (tab) => set({ tab }),
}))

/** A layer's opacity as drawn: 0 when it is off. */
export function shownOpacity(l: FloodLayerSetting): number {
  return l.visible ? l.opacity : 0
}
