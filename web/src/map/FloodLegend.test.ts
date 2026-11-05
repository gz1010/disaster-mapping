// Command's flood legend while its own layers are on (review WFC-R9): each chip and each details section says the
// layer's state (drawn, none here, could not be loaded, checking); a failed request is never "Checking…" forever and an
// empty NWS category map never reads as a map.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { CATFIM_UNAVAILABLE, DETAIL, MODEL_UNAVAILABLE } from '../api/__fixtures__/floods/edgeCases'
import catfim from '../api/__fixtures__/floods/maps-catfim.json'
import type { FloodMapResponse } from '../api/types'
import { NO_ANSWER, type Answer } from '../official/floodModel'
import { useFloodOfficial } from '../official/floodHooks'
import { DEFAULT_FLOOD_LAYERS, useFlood } from '../state/flood'
import { extraLayerState, useFloodLayerData } from '../state/floodLayerData'
import { useWorkspace } from '../state/workspace'
import { CATFIM_UNAVAILABLE as CATFIM_UNAVAILABLE_TEXT, FLOOD_COMMAND, floodWordingProblems, stripVerbatim } from '../ui/shell/floodCopy'
import { restoreSsrState, ssrState } from '../ui/ssr.testutil'
import { FloodLegend } from './FloodLegend'

const ans = <T,>(data: T | null, error: string | null = null): Answer<T> => ({ data, loading: false, error })
const cat = () => structuredClone(catfim) as unknown as FloodMapResponse

function render(variant: 'chips' | 'panel', extra: Record<string, unknown>) {
  const s = DETAIL().summary
  ssrState(useWorkspace, { preset: 'command', selection: null } as never)
  ssrState(useFlood, { floodId: s.id, summary: s, filter: 'live', layers: { ...DEFAULT_FLOOD_LAYERS, catfim: true, model: true } } as never)
  ssrState(useFloodOfficial, { floodId: s.id, alerts: NO_ANSWER, gauges: NO_ANSWER, fim: NO_ANSWER, satellite: NO_ANSWER, nfhl: NO_ANSWER, local: NO_ANSWER } as never)
  ssrState(useFloodLayerData, { floodId: s.id, model: NO_ANSWER, highFlow: NO_ANSWER, catfim: NO_ANSWER, catfimFor: 'DCBN8|major', asked: {}, ...extra } as never)
  return renderToStaticMarkup(createElement(FloodLegend, { variant } as never))
}

afterEach(() => restoreSsrState())

describe('Command layer states (WFC-R9)', () => {
  it('extraLayerState: drawn, empty, unavailable (answer or request), checking', () => {
    expect(extraLayerState(ans(cat()))).toBe('drawn')
    expect(extraLayerState(ans({ ...cat(), features: { type: 'FeatureCollection', features: [] } }))).toBe('empty')
    expect(extraLayerState(ans(CATFIM_UNAVAILABLE()))).toBe('unavailable')
    expect(extraLayerState(ans<FloodMapResponse>(null, 'HTTP 503'))).toBe('unavailable')
    expect(extraLayerState({ data: null, loading: true, error: null })).toBe('checking')
    expect(extraLayerState(NO_ANSWER)).toBe('checking')
  })

  it("a past flood's model: 'not kept for past dates', never 'could not be loaded' (integration)", () => {
    const past = { ...MODEL_UNAVAILABLE(), status: 'not_available_for_past_dates', reason: 'National Water Model output is not kept here for past dates.' } as never
    expect(extraLayerState(ans(past))).toBe('past')
    const html = render('chips', { model: ans(past) })
    expect(html).toContain(`${FLOOD_COMMAND.chipModel} · ${FLOOD_COMMAND.chipPast}`)
    expect(html).not.toContain(FLOOD_COMMAND.chipUnavailable)
  })

  it('chips: a failed or empty layer says so on its chip', () => {
    const html = render('chips', { catfim: ans(null, 'HTTP 503'), model: ans(MODEL_UNAVAILABLE()) })
    expect(html).toContain(`${FLOOD_COMMAND.chipCatfim} · ${FLOOD_COMMAND.chipUnavailable}`)
    expect(html).toContain(`${FLOOD_COMMAND.chipModel} · ${FLOOD_COMMAND.chipUnavailable}`)
    const empty = render('chips', { catfim: ans({ ...cat(), features: { type: 'FeatureCollection', features: [] } }) })
    expect(empty).toContain(`${FLOOD_COMMAND.chipCatfim} · ${FLOOD_COMMAND.chipNone}`)
    const drawn = render('chips', { catfim: ans(cat()) })
    expect(drawn).toContain(`>${FLOOD_COMMAND.chipCatfim}<`)
  })

  it('details: a failed CatFIM request is never "Checking…"; an empty map says none; the model says it could not be loaded', () => {
    const failed = render('panel', { catfim: ans(null, 'HTTP 503'), model: ans(null, 'HTTP 502') })
    expect(failed).toContain(CATFIM_UNAVAILABLE_TEXT)
    expect(failed).toContain('HTTP 503')
    expect(failed).not.toContain(FLOOD_COMMAND.catfimChecking)
    expect(failed).toContain(FLOOD_COMMAND.modelUnavailable)
    const empty = render('panel', { catfim: ans({ ...cat(), features: { type: 'FeatureCollection', features: [] } }) })
    expect(empty).toContain(FLOOD_COMMAND.catfimNoneFor.replace('{category}', 'major').replace('{lid}', 'DCBN8'))
    expect(empty).not.toContain('What NWS maps for moderate flooding at this gauge')
    expect(render('panel', {})).toContain(FLOOD_COMMAND.catfimChecking)
    for (const html of [failed, empty]) expect(floodWordingProblems(stripVerbatim(html))).toEqual([])
  })
})
