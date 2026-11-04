// The flood list panel rendered on the server with the copied fixture lists (PLAN-5 §4.3): rows with DEMO tags, the
// official block, the watches-hidden line (C27), the lists' notices, the absence line; the rendered words pass the
// flood wording guard with the issuers' own words stripped (C24).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { LIST, LIST_BOTH_DOWN, LIST_EMPTY, LIST_GAUGES_DOWN, LIST_NWS_DOWN } from '../../api/__fixtures__/floods/edgeCases'
import type { FloodListResponse } from '../../api/types'
import { useFlood } from '../../state/flood'
import { useWorkspace } from '../../state/workspace'
import { restoreSsrState, ssrState } from '../ssr.testutil'
import { FLOOD_GAUGES_DOWN, FLOOD_LIST_ABSENCE, FLOOD_LIST_EMPTY, FLOOD_LISTS_DOWN, FLOOD_NWS_DOWN, floodWordingProblems, stripVerbatim } from './floodCopy'
import { FloodListPanel, FloodMissingNotice, FloodShowDetailsPill } from './FloodListPanel'

afterEach(() => restoreSsrState())

function render(r: FloodListResponse | null, o: { showWatches?: boolean; error?: string | null; status?: number | null } = {}) {
  ssrState(useWorkspace, { hazard: 'flood', panels: { updates: true, analysis: false, layers: false }, overviewShowAll: false })
  ssrState(useFlood, { lists: { live: { response: r, loading: false, error: o.error ?? null, status: o.status ?? null } }, filter: 'live', showWatches: o.showWatches ?? false, floodId: null })
  const html = renderToStaticMarkup(createElement(FloodListPanel))
  return { html, text: stripVerbatim(html) }
}

describe('flood list panel', () => {
  it('title, official block, tabs, rows with DEMO tags, the watches-hidden line and the absence line', () => {
    const { html, text } = render(LIST())
    expect(text).toContain('Floods in the lower 48')
    expect(text).toContain('Flood products (NWS)')
    expect(text).toMatch(/8 in effect in the lower 48 · checked/)
    expect(text).toContain('Active')
    expect(text).toContain('Show watches')
    expect(html).toContain('role="switch" aria-checked="false"')
    expect(text).toContain('Ridge Fork River flood')
    expect((html.match(/class="fxo-demo"/g) ?? []).length).toBe(LIST().floods.length - 1) // the watch is hidden
    expect(text).not.toContain('Flood watch: Example Valley')
    expect(text).toContain('1 Flood Watch hidden · Show')
    expect(text).toContain(FLOOD_LIST_ABSENCE)
    expect(floodWordingProblems(text)).toEqual([])
  })

  it('"Show watches" on lists the watch and drops the hidden line', () => {
    const { text } = render(LIST(), { showWatches: true })
    expect(text).toContain('Flood watch: Example Valley')
    expect(text).not.toContain('Flood Watch hidden')
  })

  it('each list outage says so and never reads as an all-clear; empty and down lists keep the absence line', () => {
    expect(render(LIST_NWS_DOWN()).text).toContain(FLOOD_NWS_DOWN)
    expect(render(LIST_GAUGES_DOWN()).text).toContain(FLOOD_GAUGES_DOWN)
    expect(render(LIST_BOTH_DOWN()).text).toContain(FLOOD_LISTS_DOWN)
    const empty = render(LIST_EMPTY()).text
    expect(empty).toContain(FLOOD_LIST_EMPTY)
    expect(empty).toContain(FLOOD_LIST_ABSENCE)
    const failed = render(null, { error: 'API 503', status: 503 }).text
    expect(failed).toContain('The flood lists could not be reached right now; try again later.')
    expect(failed).not.toMatch(/not found/i)
    for (const r of [LIST_NWS_DOWN(), LIST_GAUGES_DOWN(), LIST_BOTH_DOWN(), LIST_EMPTY()]) expect(floodWordingProblems(render(r).text)).toEqual([])
  })

  it('the "Show details" pill counts listed floods; a dead link says not listed (404) or lists down (503)', () => {
    render(LIST())
    ssrState(useWorkspace, { overviewDetails: false })
    const pill = stripVerbatim(renderToStaticMarkup(createElement(FloodShowDetailsPill)))
    expect(pill).toContain('Show details')
    expect(pill).toContain(String(LIST().floods.length - 1))
    ssrState(useFlood, { missingFloodId: 'flood-20260101-gone-000000', missingReason: 'not_listed' })
    expect(stripVerbatim(renderToStaticMarkup(createElement(FloodMissingNotice)))).toContain('This flood is no longer listed.')
    ssrState(useFlood, { missingReason: 'lists_down' })
    const down = stripVerbatim(renderToStaticMarkup(createElement(FloodMissingNotice)))
    expect(down).toContain('The flood lists could not be reached right now; try again later.')
    expect(down).not.toMatch(/not found/i)
  })
})
