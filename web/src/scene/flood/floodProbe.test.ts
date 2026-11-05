// The 3D flood view's hover readout (review WFF-R1): never an all-clear. No negative model line; FEMA's "outside" only
// where FEMA's map covers the area; the satellite pass's own sentences (outside the image, no data, clouds; never cut);
// NOTHING_COVERS when no layer covers the spot, and never while the NWS copy could not be read.
import { describe, expect, it } from 'vitest'
import { ALERTS, DETAIL, SATELLITE } from '../../api/__fixtures__/floods/edgeCases'
import type { FloodAlertsResponse, FloodLayerStatus } from '../../api/types'
import { timeFmt } from '../../lib/time'
import { FLOOD_FORENSIC } from '../../ui/forensic-flood/floodForensicCopy'
import { FLOOD_FORENSIC_DEFAULTS, type FloodForensicLayer, type FloodLayerSetting } from '../../ui/forensic-flood/forensicFloodState'
import { ALERTS_UNAVAILABLE, floodWordingProblems, NFHL_NO_MAP, NFHL_OUTSIDE, NOTHING_COVERS, NOTHING_COVERS_OFFICIAL } from '../../ui/shell/floodCopy'
import { catfimCategoryLabel, catfimCategoryWord, floodProbeRows, type ProbeFlood } from './floodProbe'

const TF = timeFmt('America/Denver', '24h')
const EXTENT = 12000
// a 2 x 2 grid over the 12 km area: cell (row, col) centres at x, z = ±3000 m (row 0 north)
const CELL = { nw: { x: -3000, z: -3000 }, ne: { x: 3000, z: -3000 }, sw: { x: -3000, z: 3000 }, se: { x: 3000, z: 3000 } }
const IN_FLW = { lon: -108.1075, lat: 36.7977 } // inside the fixture's Flood Warning polygon only
const OUTSIDE_ALL = { lon: -108.125, lat: 36.737 } // inside the satellite image, outside every product polygon
const OUTSIDE_IMAGE = { lon: -108.0, lat: 36.737 } // east of the satellite image (its bounds end at -108.01011)

/** The fixture's warnings without the zone-based Flood Watch (which covers whole counties). */
function warningsOnly(): FloodAlertsResponse {
  const a = ALERTS()
  return { ...a, alerts: a.alerts.filter((x) => x.geometry), zones: { type: 'FeatureCollection', features: [] } }
}

function flood(over: { sat?: number[]; forecast?: number[]; floodplain?: number[]; model?: number[]; catfim?: number[]; status?: Partial<Record<string, Partial<FloodLayerStatus>>>; warnings?: FloodAlertsResponse | null } = {}): ProbeFlood {
  const d = DETAIL()
  const m = d.manifest!
  const ls = { ...m.layer_status }
  for (const [k, v] of Object.entries(over.status ?? {})) ls[k as keyof typeof ls] = { ...ls[k as keyof typeof ls], ...v }
  const arr = (v: number[] | undefined) => (v ? Uint8Array.from(v) : null)
  return {
    manifest: { ...m, layer_status: ls },
    has: { forecast: true, floodplain: true, model: true, catfim: true, satellite: true, noView: true, hand: false, depthSatellite: false, depthForecast: false },
    arrays: { width: 2, height: 2, forecast: arr(over.forecast ?? [0, 0, 0, 0]), floodplain: arr(over.floodplain ?? [0, 0, 0, 0]), model: arr(over.model ?? [0, 0, 0, 0]), catfim: arr(over.catfim ?? [0, 0, 0, 0]), satellite: arr(over.sat ?? [0, 0, 0, 0]), hand: null, depthSatellite: null, depthForecast: null },
    catfim: { key: 'catfim_ZZRF1_moderate', lid: 'ZZRF1', category: 'moderate' },
    warnings: over.warnings === undefined ? warningsOnly() : over.warnings,
    satellite: SATELLITE(),
  }
}

const layers = (on: Partial<Record<FloodForensicLayer, boolean>> = {}): Record<FloodForensicLayer, FloodLayerSetting> => {
  const out = {} as Record<FloodForensicLayer, FloodLayerSetting>
  for (const [k, v] of Object.entries(FLOOD_FORENSIC_DEFAULTS)) out[k as FloodForensicLayer] = { ...v, visible: on[k as FloodForensicLayer] ?? v.visible }
  return out
}

const NOW = ALERTS().now_ms
const probe = (f: ProbeFlood, at: { x: number; z: number }, ll: { lon: number; lat: number }, on: Partial<Record<FloodForensicLayer, boolean>> = {}) =>
  floodProbeRows({ flood: f, layers: layers(on), extent: EXTENT, point: { ...at, ...ll }, cursorMs: null, nowMs: NOW, tf: TF })
const text = (r: ReturnType<typeof probe>, key: string) => r.rows.find((x) => x.key === key)?.text

describe('floodProbeRows (the 3D hover readout, review WFF-R1)', () => {
  it('a spot no layer covers: NOTHING_COVERS, no negative model line, FEMA outside only where its map covers the area', () => {
    const r = probe(flood(), CELL.nw, OUTSIDE_ALL, { floodplain: true, model: true, catfim: true })
    expect(r.note).toBe(NOTHING_COVERS)
    expect(r.rows.find((x) => x.key === 'model')).toBeUndefined()
    expect(r.rows.find((x) => x.key === 'catfim')).toBeUndefined()
    // the fixture's FEMA map covers the whole area (reason null): NFHL_OUTSIDE, with its "not an all-clear"
    expect(text(r, 'fema')).toBe(NFHL_OUTSIDE)
    expect(text(r, 'fim')).toBe(FLOOD_FORENSIC.probeOutForecast)
    expect(text(r, 'sat')).toMatch(/saw no water at this spot; dry pixels do not mean no flooding\.$/)
    for (const row of r.rows) expect(floodWordingProblems(row.text)).toEqual([])
    expect(floodWordingProblems(r.note ?? '')).toEqual([])
  })

  it("FEMA's map covering only part of the area, or none of it, never reads as \"not in the floodplain\"", () => {
    const partial = probe(flood({ status: { floodplain: { reason: "FEMA's digital flood map covers only part of this area; outside it, FEMA's floodplain is not shown." } } }), CELL.nw, OUTSIDE_ALL, { floodplain: true })
    expect(text(partial, 'fema')).toBe(FLOOD_FORENSIC.probeOutPlainUnknown)
    const none = probe(flood({ status: { floodplain: { reason: NFHL_NO_MAP } } }), CELL.nw, OUTSIDE_ALL, { floodplain: true })
    expect(text(none, 'fema')).toBe(NFHL_NO_MAP)
    // FEMA off: no FEMA line at all
    expect(text(probe(flood(), CELL.nw, OUTSIDE_ALL), 'fema')).toBeUndefined()
  })

  it('satellite: outside the image, no data, clouds and water each in their own words', () => {
    const f = flood({ sat: [255, 253, 1, 0] })
    expect(text(probe(f, CELL.ne, OUTSIDE_IMAGE), 'sat')).toMatch(/^This spot is outside the .+ satellite image: no satellite view of it\.$/)
    expect(text(probe(f, CELL.nw, OUTSIDE_ALL), 'sat')).toMatch(/^No satellite view of this spot on the .+ pass\.$/)
    expect(text(probe(f, CELL.ne, OUTSIDE_ALL), 'sat')).toMatch(/^Clouds hid this spot on the .+ pass\.$/)
    const water = probe(f, CELL.sw, OUTSIDE_ALL)
    expect(text(water, 'sat')).toMatch(/^Water seen by satellite at this spot/)
    // water seen by satellite covers the spot: no NOTHING_COVERS
    expect(water.note).toBeNull()
  })

  it('inside the NWS warning area at the handle: the product verbatim with its own end time; no NOTHING_COVERS', () => {
    const r = probe(flood(), CELL.nw, IN_FLW)
    expect(r.rows[0].key).toMatch(/^nws-/)
    expect(r.rows[0].text).toMatch(/^Inside the NWS Flood Warning area \(until .+M[SD]T\)\.$/)
    expect(r.note).toBeNull()
  })

  it('the model and the category map: a line only inside, labelled experimental; inside them alone the narrower note', () => {
    const r = probe(flood({ model: [255, 0, 0, 0], catfim: [255, 0, 0, 0] }), CELL.nw, OUTSIDE_ALL, { model: true, catfim: true })
    expect(text(r, 'model')).toMatch(/^National Water Model \(NOAA, experimental\): flooded at the .+ analysis\.$/)
    expect(text(r, 'catfim')).toMatch(/^Inside NWS's map of moderate flooding at ZZRF1 \(experimental map library; not a forecast\)\.$/)
    expect(r.note).toBe(NOTHING_COVERS_OFFICIAL)
    // FEMA, the category map and the model say "inside" even while switched off: still the narrower note
    expect(probe(flood({ floodplain: [2, 0, 0, 0] }), CELL.nw, OUTSIDE_ALL).note).toBe(NOTHING_COVERS_OFFICIAL)
  })

  it('NWS forecast area inside covers the spot', () => {
    const r = probe(flood({ forecast: [255, 0, 0, 0] }), CELL.nw, OUTSIDE_ALL)
    expect(text(r, 'fim')).toBe(FLOOD_FORENSIC.probeInForecast)
    expect(r.note).toBeNull()
  })

  it("the NWS copy could not be read: its outage text, never NOTHING_COVERS (D24)", () => {
    const down: FloodAlertsResponse = { ...warningsOnly(), status: 'unavailable', reason: ALERTS_UNAVAILABLE, alerts: [] }
    const r = probe(flood({ warnings: down }), CELL.nw, OUTSIDE_ALL)
    expect(r.note).toBe(ALERTS_UNAVAILABLE)
    expect(text(r, 'nws')).toBe(ALERTS_UNAVAILABLE)
    expect(probe(flood({ warnings: null }), CELL.nw, OUTSIDE_ALL).note).toBe(ALERTS_UNAVAILABLE)
  })

  it('a layer the bundle could not make says so in its own words', () => {
    const r = probe(flood({ status: { water_forecast: { status: 'unavailable', reason: 'The NWS forecast flooded-area map could not be loaded right now. That is not an all-clear.' } } }), CELL.nw, OUTSIDE_ALL)
    expect(text(r, 'fim')).toMatch(/could not be loaded right now\. That is not an all-clear\.$/)
  })
})

describe('catfim category words (§5.3: never a raw value)', () => {
  it('labels and sentence words', () => {
    expect(catfimCategoryLabel('moderate')).toBe('Moderate flooding (NWS)')
    expect(catfimCategoryLabel('record')).toBe('Record flooding (NWS)')
    expect(catfimCategoryLabel('weird')).toBe('Category unknown (NWS)')
    expect(catfimCategoryWord('action')).toBe('action-stage')
    expect(catfimCategoryWord('major')).toBe('major')
  })
})
