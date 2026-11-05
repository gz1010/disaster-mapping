// The flood view's layer credits (brief 5, CONTRACT §16.15; CLAUDE.md "credit every source"; review WFC-R4). Pure,
// tested in floodLayerCredits.test.ts. The map footer always credits the flood list's sources (lib/dataCredits.ts
// floodCredits: NWS flood products, NOAA's river gauges); a flood view adds each of its own layers' credit while that
// layer is drawn (its toggle on, the view's profile allowing it, and an answer with something to draw):
//   NWS forecast flooded area, NWS category flood map   NOAA/NWS National Water Center (experimental)
//   National Water Model (flooded area, high-flow)     NOAA/NWS National Water Center, National Water Model (...)
//   FEMA floodplain                                     Flood zones: FEMA National Flood Hazard Layer (effective)
//   water seen by satellite                             NASA JPL OPERA DSWx-HLS (PO.DAAC, doi) with its route
//   river gauges with USGS readings                     Gauge readings: U.S. Geological Survey (provisional data)
// Each answer's own `source.credit` is used when it has one (the backend sends the §16.15 line, with the route for
// OPERA; a synthetic fixture's says so); the §16.15 line otherwise.
import type { FloodMapResponse, ModelOutputResponse, RiverGaugesResponse, SatelliteWaterResponse } from '../api/types'
import type { DataCredit } from '../lib/dataCredits'
import type { FloodLayerKey } from '../state/flood'
import { gaugeCategoryRank } from '../state/floodOverview'
import type { MapChrome } from '../ui/shell/views'
import { satelliteImage } from './floodAreaLayers'
import { floodLayerShown } from './floodProfile'

/** CONTRACT §16.15, exact. */
export const NWC_CREDIT: DataCredit = { id: 'nwc', text: 'NOAA/NWS National Water Center (experimental)', href: 'https://www.weather.gov/disclaimer' }
export const NWM_CREDIT: DataCredit = { id: 'nwm', text: 'NOAA/NWS National Water Center, National Water Model (experimental model output)', href: 'https://water.noaa.gov/about/api' }
export const NFHL_CREDIT: DataCredit = { id: 'nfhl', text: 'Flood zones: FEMA National Flood Hazard Layer (effective)', href: 'https://www.arcgis.com/home/item.html?id=ae38b6f94eaf4abf97f986fa01921e13' }
export const OPERA_CREDIT: DataCredit = {
  id: 'opera',
  text: 'Water seen by satellite: NASA JPL OPERA DSWx-HLS (PO.DAAC, doi:10.5067/OPDSW-PL3V1) via NASA Earthdata GIS; contains modified Copernicus Sentinel data',
  href: 'https://podaac.jpl.nasa.gov/CitingPODAAC',
}
export const USGS_GAUGE_CREDIT: DataCredit = { id: 'usgs', text: 'Gauge readings: U.S. Geological Survey (provisional data)', href: 'https://waterdata.usgs.gov/provisional-data-statement/' }

export interface FloodLayerCreditInput {
  chrome: MapChrome
  layers: Record<FloodLayerKey, boolean>
  fim: FloodMapResponse | null
  satellite: SatelliteWaterResponse | null
  nfhl: FloodMapResponse | null
  gauges: RiverGaugesResponse | null
  model: ModelOutputResponse | null
  highFlow: ModelOutputResponse | null
  catfim: FloodMapResponse | null
}

const hasFeatures = (r: { features?: { features?: unknown[] } | null } | null | undefined) => (r?.features?.features?.length ?? 0) > 0

/** The answer's own credit line (https link from the answer when it has one), else the §16.15 line. */
function credit(base: DataCredit, src: { credit?: string | null; terms_url?: string | null; url?: string | null } | null | undefined): DataCredit {
  const text = src?.credit?.trim()
  if (!text) return base
  const href = [src?.terms_url, src?.url].find((u): u is string => typeof u === 'string' && u.startsWith('https://')) ?? base.href
  return { id: base.id, text, href }
}

/** The credits of the flood layers drawn now (deduplicated by text, in a fixed order). */
export function floodLayerCreditsFor(i: FloodLayerCreditInput): DataCredit[] {
  const out: DataCredit[] = []
  const add = (c: DataCredit) => {
    if (!out.some((o) => o.text === c.text)) out.push(c)
  }
  const shown = (k: FloodLayerKey) => floodLayerShown(i.chrome, k, i.layers[k] === true)
  if (shown('satellite') && satelliteImage(i.satellite)) add(credit(OPERA_CREDIT, i.satellite?.source))
  if (shown('forecastArea') && i.fim?.status === 'available' && hasFeatures(i.fim)) add(credit(NWC_CREDIT, i.fim.source))
  if (shown('catfim') && i.catfim?.status === 'available' && hasFeatures(i.catfim)) add(credit(NWC_CREDIT, i.catfim.source))
  if (shown('floodplain') && i.nfhl?.status === 'available' && hasFeatures(i.nfhl)) add(credit(NFHL_CREDIT, i.nfhl.source))
  if (shown('model') && i.model?.model_output === true && i.model.status === 'available' && hasFeatures(i.model)) add(credit(NWM_CREDIT, i.model.source))
  if (shown('modelHighFlow') && i.highFlow?.model_output === true && i.highFlow.status === 'available' && hasFeatures(i.highFlow)) add(credit(NWM_CREDIT, i.highFlow.source))
  // the gauges the flood views draw: every member, nearby ones at action stage or above (map/floodController.ts)
  if (shown('gauges') && i.gauges?.status === 'available') {
    const drawn = i.gauges.gauges.filter((g) => g.member || gaugeCategoryRank(g.observed.category) >= 1)
    if (drawn.some((g) => (g.data_attribution ?? []).some((d) => /U\.?S\.? Geological Survey|USGS/i.test(d.text)))) add(USGS_GAUGE_CREDIT)
  }
  return out
}
