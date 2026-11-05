// The flood layers' credit lines (CONTRACT §16.15; CLAUDE.md "credit every source"; review WFC-R4): each layer adds its
// own line while it is drawn (toggle on, the view allowing it, something to draw), with the answer's own credit when it
// has one; the §16.15 line otherwise; nothing for a layer that is off, empty or unavailable.
import { describe, expect, it } from 'vitest'
import { GAUGES, MODEL_UNAVAILABLE, RFC_FIM, SATELLITE } from '../api/__fixtures__/floods/edgeCases'
import catfim from '../api/__fixtures__/floods/maps-catfim.json'
import nfhl from '../api/__fixtures__/floods/maps-nfhl.json'
import nwmAnalysis from '../api/__fixtures__/floods/model-nwm_analysis.json'
import nwmHighFlow from '../api/__fixtures__/floods/model-nwm_high_flow.json'
import type { FloodMapResponse, ModelOutputResponse } from '../api/types'
import { DEFAULT_FLOOD_LAYERS } from '../state/flood'
import { floodLayerCreditsFor, NFHL_CREDIT, NWC_CREDIT, NWM_CREDIT, OPERA_CREDIT, USGS_GAUGE_CREDIT, type FloodLayerCreditInput } from './floodLayerCredits'

const real = <T extends { source: { credit?: string | null } }>(r: T): T => ({ ...r, source: { ...r.source, credit: null } })
const base = (over: Partial<FloodLayerCreditInput> = {}): FloodLayerCreditInput => ({
  chrome: 'command-flood',
  layers: { ...DEFAULT_FLOOD_LAYERS },
  fim: real(RFC_FIM()),
  satellite: real(SATELLITE()),
  nfhl: real(nfhl as unknown as FloodMapResponse),
  gauges: GAUGES(),
  model: real(nwmAnalysis as unknown as ModelOutputResponse),
  highFlow: real(nwmHighFlow as unknown as ModelOutputResponse),
  catfim: real(catfim as unknown as FloodMapResponse),
  ...over,
})
const texts = (i: FloodLayerCreditInput) => floodLayerCreditsFor(i).map((c) => c.text)

describe('flood layer credits (WFC-R4)', () => {
  it('the exact CONTRACT 16.15 lines', () => {
    expect(NWC_CREDIT.text).toBe('NOAA/NWS National Water Center (experimental)')
    expect(NWM_CREDIT.text).toBe('NOAA/NWS National Water Center, National Water Model (experimental model output)')
    expect(NFHL_CREDIT.text).toBe('Flood zones: FEMA National Flood Hazard Layer (effective)')
    expect(OPERA_CREDIT.text).toMatch(/^Water seen by satellite: NASA JPL OPERA DSWx-HLS \(PO\.DAAC, doi:10\.5067\/OPDSW-PL3V1\) via NASA Earthdata GIS; contains modified Copernicus Sentinel data$/)
  })
  it('by default: the satellite water, the NWS forecast area and the USGS gauge readings (drawn by default)', () => {
    expect(texts(base())).toEqual([OPERA_CREDIT.text, NWC_CREDIT.text, USGS_GAUGE_CREDIT.text])
  })
  it('switching each Command layer on adds its credit; the model once for both its layers', () => {
    const on = (k: keyof typeof DEFAULT_FLOOD_LAYERS) => texts(base({ layers: { ...DEFAULT_FLOOD_LAYERS, forecastArea: false, satellite: false, gauges: false, [k]: true } }))
    expect(on('model')).toEqual([NWM_CREDIT.text])
    expect(on('modelHighFlow')).toEqual([NWM_CREDIT.text])
    expect(on('catfim')).toEqual([NWC_CREDIT.text])
    expect(on('floodplain')).toEqual([NFHL_CREDIT.text])
    const all = texts(base({ layers: { ...DEFAULT_FLOOD_LAYERS, model: true, modelHighFlow: true, catfim: true, floodplain: true } }))
    expect(all.filter((t) => t === NWM_CREDIT.text)).toHaveLength(1)
    expect(all.filter((t) => t === NWC_CREDIT.text)).toHaveLength(1)
    expect(all).toContain(NFHL_CREDIT.text)
  })
  it("never in Public for the model or the category map; nothing for a layer that is off, unavailable or empty", () => {
    expect(texts(base({ chrome: 'public-flood', layers: { ...DEFAULT_FLOOD_LAYERS, model: true, catfim: true } }))).not.toContain(NWM_CREDIT.text)
    expect(texts(base({ layers: { ...DEFAULT_FLOOD_LAYERS, model: true }, model: MODEL_UNAVAILABLE() }))).not.toContain(NWM_CREDIT.text)
    expect(texts(base({ layers: { ...DEFAULT_FLOOD_LAYERS, forecastArea: false, catfim: true }, catfim: { ...real(catfim as unknown as FloodMapResponse), features: { type: 'FeatureCollection', features: [] } } }))).not.toContain(NWC_CREDIT.text)
    expect(texts(base({ layers: { ...DEFAULT_FLOOD_LAYERS, satellite: false } }))).not.toContain(OPERA_CREDIT.text)
  })
  it("an answer's own credit line wins (a synthetic fixture says so)", () => {
    const t = texts(base({ satellite: SATELLITE() }))
    expect(t[0]).toMatch(/^Synthetic data for testing; not from: Water seen by satellite: NASA JPL OPERA/)
  })
})
