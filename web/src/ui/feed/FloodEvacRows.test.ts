// Evacuation rows of a flood (brief 5, PLAN-5 D23, C5): flood wording; no flood view renders "fire" in an evacuation
// row in Disaster Mapping's own words (an issuer's verbatim words, inside data-verbatim, may name a fire zone as such).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DETAIL, FIXTURE_NOW_MS } from '../../api/__fixtures__/floods/edgeCases'
import evacNm from '../../api/__fixtures__/floods/evacuations.json'
import type { EvacuationsResponse, EvacZoneFeature } from '../../extras/types'
import { useExtrasRuntime } from '../../extras/runtime'
import { useFlood } from '../../state/flood'
import { EVAC_NONE_LISTED, floodWordingProblems, OR_EVAC_FIRE_ONLY, stripVerbatim } from '../shell/floodCopy'
import { restoreSsrState, ssrState } from '../ssr.testutil'
import { FloodFacts } from '../public/FloodFacts'
import { FloodEvacRows } from './FloodEvacRows'

const H = 3_600_000
const nm = evacNm as unknown as EvacuationsResponse

const source = {
  id: 'caloes_evacuations',
  name: 'Cal OES',
  publisher: 'Cal OES',
  url: 'https://gis.data.ca.gov/',
  license: '',
  terms_url: '',
  attribution: 'Cal OES',
  disclaimer: null,
  cadence: '',
  retrieved_ms: FIXTURE_NOW_MS - 120_000,
  updated_ms: null,
  status: 'available' as const,
  reason: null,
  home_state: 'CA',
  credit: 'Cal OES',
  aggregator: 'Cal OES',
}

function zone(id: string, status: string, key: EvacZoneFeature['properties']['status_key'], eventType: string): EvacZoneFeature {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Polygon', coordinates: [[[-120, 38], [-119.9, 38], [-119.9, 38.1], [-120, 38]]] },
    properties: {
      zone_id: id,
      zone_name: `Zone ${id}`,
      status,
      status_key: key,
      county: 'Example',
      jurisdiction: 'Example County',
      city_code: null,
      event_type: eventType,
      notes: null,
      critical_info: null,
      public_info: null,
      status_updated_ms: FIXTURE_NOW_MS - H,
      aggregated_ms: null,
      state: 'CA',
      source_id: 'caloes_evacuations',
      status_verbatim: true,
      status_raw: status,
      status_label: null,
      status_label_source: null,
      incident_name: null,
      hazard_type: null,
      listed_ms: null,
      time_basis: 'issuer',
    },
  }
}

const answers: [string, EvacuationsResponse][] = [
  ['none listed', { ...nm, status: 'available', reason: null, reason_code: null, sources: [source], zones: { type: 'FeatureCollection', features: [] } }],
  ['listed (a flood zone and a fire zone of Cal OES)', { ...nm, status: 'available', reason: null, reason_code: null, sources: [source], zones: { type: 'FeatureCollection', features: [zone('a', 'Evacuation Order', 'order', 'Flood'), zone('b', 'Evacuation Warning', 'warning', 'Fire')] } }],
  ['Oregon wildfire-only', { ...nm, status: 'unavailable', reason_code: 'state_not_available', reason: OR_EVAC_FIRE_ONLY, sources: [{ ...source, id: 'or_oem_evacuations', aggregator: 'Oregon OEM', status: 'unavailable', reason: OR_EVAC_FIRE_ONLY, home_state: 'OR' }] }],
  ['not available in this state', nm],
]

beforeEach(() => {
  vi.useFakeTimers({ now: FIXTURE_NOW_MS, toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
  restoreSsrState()
})

describe('flood evacuation rows (D23, C5)', () => {
  for (const [name, data] of answers)
    it(`${name}: flood wording, never "fire" in Disaster Mapping's own words, no banned word`, () => {
      const s = DETAIL().summary
      ssrState(useFlood, { floodId: s.id, summary: s } as never)
      ssrState(useExtrasRuntime, { evac: { data, loading: false, error: null, refresh: () => undefined } } as never)
      for (const el of [createElement(FloodEvacRows, { variant: 'command' }), createElement(FloodFacts)]) {
        const html = renderToStaticMarkup(el)
        const own = stripVerbatim(html)
        // the evacuation row's own words (the facts' rows include other rows: check the evacuation part only)
        const evacPart = el.type === FloodFacts ? (/— Evacuations.*?<\/div><\/div>/.exec(html)?.[0] ?? '') : html
        expect(stripVerbatim(evacPart)).not.toMatch(/\bfires?\b|\bwildfires?\b(?! only)/i)
        expect(floodWordingProblems(own)).toEqual([])
      }
    })

  it('none listed: "None listed" with its source and check time', () => {
    ssrState(useFlood, { floodId: 'fixture-flood', summary: DETAIL().summary } as never)
    ssrState(useExtrasRuntime, { evac: { data: answers[0][1], loading: false, error: null, refresh: () => undefined } } as never)
    const html = renderToStaticMarkup(createElement(FloodEvacRows))
    expect(html).toContain(EVAC_NONE_LISTED)
    expect(html).toContain('None listed in Cal OES for this area · checked 2 min ago · not an all-clear: follow local officials.')
  })

  it("the issuer's status and event type are verbatim (data-verbatim)", () => {
    ssrState(useFlood, { floodId: 'fixture-flood', summary: DETAIL().summary } as never)
    ssrState(useExtrasRuntime, { evac: { data: answers[1][1], loading: false, error: null, refresh: () => undefined } } as never)
    const html = renderToStaticMarkup(createElement(FloodEvacRows))
    expect(html).toContain('<span data-verbatim="">Evacuation Order</span>')
    expect(html).toContain('<span data-verbatim="">Cal OES event type: Flood</span>')
  })

  it("Oregon: OR_EVAC_FIRE_ONLY (the backend's sentence, which names its wildfire-only feed)", () => {
    ssrState(useFlood, { floodId: 'fixture-flood', summary: DETAIL().summary } as never)
    ssrState(useExtrasRuntime, { evac: { data: answers[2][1], loading: false, error: null, refresh: () => undefined } } as never)
    expect(renderToStaticMarkup(createElement(FloodEvacRows))).toContain(OR_EVAC_FIRE_ONLY.replace(/'/g, '&#x27;'))
  })

  // review WFC-R15: the not-an-all-clear caveat once per row (not repeated after a sub-line that already says it)
  for (const [name, data] of answers)
    it(`${name}: "not an all-clear" said at most once`, () => {
      ssrState(useFlood, { floodId: 'fixture-flood', summary: DETAIL().summary } as never)
      ssrState(useExtrasRuntime, { evac: { data, loading: false, error: null, refresh: () => undefined } } as never)
      const html = renderToStaticMarkup(createElement(FloodEvacRows))
      expect((stripVerbatim(html).match(/not an all-clear/gi) ?? []).length).toBeLessThanOrEqual(1)
    })
  it('a row that does not say it (loading) still ends with the caveat', () => {
    ssrState(useFlood, { floodId: 'fixture-flood', summary: DETAIL().summary } as never)
    ssrState(useExtrasRuntime, { evac: { data: null, loading: true, error: null, refresh: () => undefined } } as never)
    expect(renderToStaticMarkup(createElement(FloodEvacRows))).toContain('Not an all-clear. Follow local officials.')
  })
})
