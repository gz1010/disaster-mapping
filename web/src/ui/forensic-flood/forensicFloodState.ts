// Forensic's own flood toggles (brief 5, PLAN-5 §4.7, C10): the 3D flood view's layer switches (terrain, aerial photo,
// FEMA floodplain, satellite water, the NWS forecast flooded area, NWS warning areas, river gauges, NWS category flood
// maps, the National Water Model, contours, gauge labels), their opacities and the right panel's open tab. Never new
// keys in state/flood.ts: the map views' layers live there, these only here. FEMA, the category maps and the model
// start off (D12, D21, D22); everything else on.
// Brief 6 (web-forensic-flood-3d): two layers from the terrain, the estimated water depth surface ('depth', on) and the
// height above the river ('hand', off by default: "Not a flood map"); which mapped water the depth surface is of
// (`depthFrom`, for one flood; null = automatic; review WFF3D-R6: a second press of the chosen water, Reset or another
// flood go back to automatic); and the user's own height boost for one flood (`boost`; null = the flood's automatic
// height, scene/flood/heightBoost.ts).
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
  | 'depth'
  | 'hand'

export type FloodForensicTab = 'layers' | 'analysis' | 'evidence' | 'notes'

export interface FloodLayerSetting {
  visible: boolean
  opacity: number
}

export const FLOOD_FORENSIC_LAYERS: readonly FloodForensicLayer[] = ['terrain', 'naip', 'floodplain', 'satellite', 'forecastArea', 'warnings', 'gauges', 'catfim', 'model', 'contours', 'telemetry', 'depth', 'hand']

/** Which mapped water the depth surface is of: the satellite pass shown, or the NWS forecast flooded area. */
export type DepthFrom = 'satellite' | 'forecast'

/** Defaults: FEMA floodplain, NWS category flood maps and model output off (D12, D21, D22); the height above the river
 *  off (brief 6: "Not a flood map"); everything else on. */
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
  depth: { visible: true, opacity: 0.85 },
  hand: { visible: false, opacity: 0.8 },
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
  /** The user's own height boost for one flood (null: the flood's automatic height). Kept while the app runs, so a
   *  trip to the map and back keeps it; another flood starts at its own automatic height. */
  boost: { floodId: string; factor: number } | null
  /** The depth surface's water for one flood: null = automatic (the satellite pass when it has a depth estimate, else
   *  the NWS forecast area). Another flood starts automatic. */
  depthFrom: { floodId: string; from: DepthFrom } | null
  setBoost(floodId: string, factor: number | null): void
  /** Choose the depth surface's water for this flood; null, or the water already chosen, goes back to automatic. */
  setDepthFrom(floodId: string, from: DepthFrom | null): void
  setLayerVisible(k: FloodForensicLayer, visible: boolean): void
  toggleLayer(k: FloodForensicLayer): void
  setLayerOpacity(k: FloodForensicLayer, opacity: number): void
  resetLayers(): void
  setTab(t: FloodForensicTab): void
}

export const useForensicFlood = create<ForensicFloodState>()((set) => ({
  layers: defaults(),
  tab: 'layers',
  boost: null,
  depthFrom: null,
  setBoost: (floodId, factor) => set({ boost: factor != null && Number.isFinite(factor) && factor > 0 ? { floodId, factor } : null }),
  setDepthFrom: (floodId, from) =>
    set((s) => ({ depthFrom: from == null || (s.depthFrom?.floodId === floodId && s.depthFrom.from === from) ? null : { floodId, from } })),
  setLayerVisible: (k, visible) => set((s) => (s.layers[k].visible === visible ? {} : { layers: { ...s.layers, [k]: { ...s.layers[k], visible } } })),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: { ...s.layers[k], visible: !s.layers[k].visible } } })),
  setLayerOpacity: (k, opacity) => set((s) => ({ layers: { ...s.layers, [k]: { ...s.layers[k], opacity: clamp01(opacity) } } })),
  resetLayers: () => set({ layers: defaults(), depthFrom: null }),
  setTab: (tab) => set({ tab }),
}))

/** The depth surface's water the user chose for this flood (null: automatic). */
export function depthChoiceFor(s: Pick<ForensicFloodState, 'depthFrom'>, floodId: string | null | undefined): DepthFrom | null {
  return floodId != null && s.depthFrom?.floodId === floodId ? s.depthFrom.from : null
}

/** A layer's opacity as drawn: 0 when it is off. */
export function shownOpacity(l: FloodLayerSetting): number {
  return l.visible ? l.opacity : 0
}

declare global {
  interface Window {
    /** Dev/test handle: window.__forensicFlood.getState() (scripts/shot.mjs --eval). */
    __forensicFlood?: typeof useForensicFlood
  }
}

if (typeof window !== 'undefined') window.__forensicFlood = useForensicFlood
