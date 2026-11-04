// The flood list panel rendered on the server with the copied fixture lists (PLAN-5 §4.3): rows with DEMO tags, the
// official block, the watches-hidden line (C27), the lists' notices, the absence line; the rendered words pass the
// flood wording guard with the issuers' own words stripped (C24).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIST, LIST_2026, LIST_BOTH_DOWN, LIST_EMPTY, LIST_GAUGES_DOWN, LIST_NWS_DOWN, LIST_YEAR_ARCHIVE_DOWN, YEAR_ARCHIVE_DOWN_REASON } from '../../api/__fixtures__/floods/edgeCases'
import type { FloodListResponse } from '../../api/types'
import { useNationalGauges } from '../../map/floodGaugeStatus'
import { useFlood } from '../../state/flood'
import { useWorkspace } from '../../state/workspace'
import { restoreSsrState, ssrState } from '../ssr.testutil'
import {
  FLOOD_GAUGES_DOWN,
  FLOOD_LIST_ABSENCE,
  FLOOD_LIST_EMPTY,
  FLOOD_LIST_EMPTY_VIEW,
  FLOOD_LISTS_DOWN,
  FLOOD_NOT_LISTED,
  FLOOD_NWS_DOWN,
  FLOOD_OVERVIEW,
  floodWordingProblems,
  PAST_RULE_NOTE,
  PAST_RULE_NOTE_FALLBACK,
  stripVerbatim,
} from './floodCopy'
import { FloodListPanel, FloodMissingNotice, FloodShowDetailsPill } from './FloodListPanel'

// the app test below renders App on the server: the map itself (MapLibre) and the extras' background sync (browser
// queries) are not loaded
vi.mock('../../map/MapView', () => ({ default: () => null }))
vi.mock('../../extras/ExtrasSync', () => ({ ExtrasSync: () => null }))

afterEach(() => restoreSsrState())

function render(r: FloodListResponse | null, o: { showWatches?: boolean; error?: string | null; status?: number | null; year?: number } = {}) {
  ssrState(useWorkspace, { hazard: 'flood', panels: { updates: true, analysis: false, layers: false }, overviewShowAll: false })
  const key = o.year != null ? String(o.year) : 'live'
  ssrState(useFlood, {
    lists: { live: { response: o.year != null ? LIST() : r, loading: false, error: null, status: null }, [key]: { response: r, loading: false, error: o.error ?? null, status: o.status ?? null } },
    filter: o.year ?? 'live',
    showWatches: o.showWatches ?? false,
    floodId: null,
  })
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

  it('a year whose archive could not be read says so with its reason, never "No listed floods" or a rule (review WFO-R3)', () => {
    const { text } = render(LIST_YEAR_ARCHIVE_DOWN(), { year: 2026 })
    expect(text).toContain(YEAR_ARCHIVE_DOWN_REASON)
    expect(text).toContain(FLOOD_OVERVIEW.sourceUnreadable)
    expect(text).not.toContain(FLOOD_LIST_EMPTY_VIEW)
    expect(text).not.toContain(PAST_RULE_NOTE)
    expect(text).not.toContain(PAST_RULE_NOTE_FALLBACK)
    expect(text).toContain(FLOOD_LIST_ABSENCE)
    expect(floodWordingProblems(text)).toEqual([])
    // the pill gives no number for it (a dash), never 0
    ssrState(useWorkspace, { overviewDetails: false })
    const pill = renderToStaticMarkup(createElement(FloodShowDetailsPill))
    expect(pill).toContain('flood list unavailable')
    expect(pill).not.toMatch(/>0</)
    // a year the archive answered: its rule note, and an empty year is a real empty year
    const ok = render(LIST_2026(), { year: 2026 }).text
    expect(ok).toContain(PAST_RULE_NOTE_FALLBACK)
    expect(ok).toContain(FLOOD_LIST_EMPTY_VIEW)
  })

  it('the national gauge layer could not be read: the list foot says gauges outside the listed floods are missing (WFO-R8)', () => {
    ssrState(useNationalGauges, { status: 'unavailable' })
    const { text } = render(LIST())
    expect(text).toContain(FLOOD_OVERVIEW.nationalGaugesDown)
    ssrState(useNationalGauges, { status: 'available' })
    expect(render(LIST()).text).not.toContain(FLOOD_OVERVIEW.nationalGaugesDown)
  })

  it('the app mounts the dead-link notice on the flood overview (review WFO-R2)', async () => {
    const { default: App } = await import('../../App')
    ssrState(useWorkspace, { hazard: 'flood', workspace: 'map', preset: 'public' })
    ssrState(useFlood, { lists: { live: { response: LIST(), loading: false, error: null, status: null } }, filter: 'live', floodId: null, missingFloodId: 'flood-20261104-nope-abcdef', missingReason: 'not_listed' })
    const text = stripVerbatim(renderToStaticMarkup(createElement(App)))
    expect(text).toContain(FLOOD_NOT_LISTED)
    expect(text).toContain('flood-20261104-nope-abcdef')
    ssrState(useFlood, { missingReason: 'lists_down' })
    const down = stripVerbatim(renderToStaticMarkup(createElement(App)))
    expect(down).toContain('The flood lists could not be reached right now; try again later.')
    expect(down).not.toMatch(/not found/i)
  })
})
