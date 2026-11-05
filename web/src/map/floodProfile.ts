// What each map chrome draws of the flood layers (brief 5, CONTRACT §16.11; D12, D13, D21, D22): true = drawn when its
// toggle (useFlood.layers) is on, 'toggle' = a Layers-drawer toggle that starts off, false = never. Public never shows
// model output or NWS category flood maps; the FEMA floodplain is a toggle, off by default, in every view. The national
// overview draws the flood markers and gauges only. Tests: floodProfile.test.ts.
import type { FloodLayerKey } from '../state/flood'
import type { MapChrome } from '../ui/shell/views'

const NONE: Record<FloodLayerKey, boolean | 'toggle'> = {
  events: false,
  gauges: false,
  warnings: false,
  forecastArea: false,
  satellite: false,
  channel: false,
  floodplain: false,
  model: false,
  catfim: false,
}

export function floodProfile(chrome: MapChrome): Record<FloodLayerKey, boolean | 'toggle'> {
  switch (chrome) {
    case 'overview':
      return { ...NONE, events: true, gauges: true }
    case 'public-flood':
      // never the model, never CatFIM (D12, D22); FEMA a toggle off by default (D21)
      return { ...NONE, events: true, gauges: true, warnings: true, forecastArea: true, satellite: true, channel: true, floodplain: 'toggle', model: false, catfim: false }
    case 'command-flood':
      return { ...NONE, events: true, gauges: true, warnings: true, forecastArea: true, satellite: true, channel: true, floodplain: 'toggle', model: 'toggle', catfim: 'toggle' }
    default:
      // a fire view: no flood layer
      return { ...NONE }
  }
}

/** Is a flood layer drawn: the profile allows it and its toggle is on ('toggle' layers start off in the store). */
export function floodLayerShown(chrome: MapChrome, key: FloodLayerKey, on: boolean): boolean {
  const p = floodProfile(chrome)[key]
  return p === false ? false : on
}
