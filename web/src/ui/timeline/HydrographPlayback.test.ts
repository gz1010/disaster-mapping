// The flood's time steps on the river-level chart, rendered on the server (brief 6, web-flood-playback M2; BRIEF-6
// decision 2): Play / Pause and Previous / Next, never playing by itself; the step at the handle in words (a pass with
// its own time and age, an NWS change with NWS's event name verbatim); the note between two passes; the passes as marks
// (hollow for no view); the NWS changes as the ticks; the axis from the first step while stepping; the states without
// steps; Disaster Mapping's own words pass the flood wording guard.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALERTS, DETAIL, FIXTURE_NOW_MS, GAUGES } from '../../api/__fixtures__/floods/edgeCases'
import zzrf1 from '../../api/__fixtures__/floods/river-gauges-ZZRF1.json'
import type { FloodTimelineResponse, RiverGaugesResponse } from '../../api/types'
import { DAY_MS, HOUR_MS } from '../../lib/time'
import { useFloodOfficial } from '../../official/floodHooks'
import { NO_ANSWER, type Answer } from '../../official/floodModel'
import { useFlood } from '../../state/flood'
import { testPass, testTimeline, versionBuilder } from '../../state/floodTimeline.testutil'
import { useFloodTimeline } from '../../state/floodTimelineData'
import { useWorkspace } from '../../state/workspace'
import { ARCHIVED_COPY, floodWordingProblems, stripVerbatim } from '../shell/floodCopy'
import { restoreSsrState, ssrState } from '../ssr.testutil'
import { PLAYBACK } from './floodPlaybackCopy'
import { useFloodPlayback } from './floodPlayback'
import { Hydrograph, type HydrographVariant } from './Hydrograph'
import { NwsVersion } from './HydrographPlayback'
import { gaugeKey, useHydroData } from './hydrographData'

const NOW = FIXTURE_NOW_MS // Nov 4 2026 18:00 UTC (11:00 MST)
const ans = <T,>(data: T | null): Answer<T> => ({ data, loading: false, error: null })
const version = versionBuilder(NOW)
const PASSES = {
  before: testPass('DSWx-HLS_20261026T1800_L8', NOW - 9 * DAY_MS, 'clear'),
  cloud: testPass('DSWx-HLS_20261028T1800_S2A', NOW - 7 * DAY_MS, 'no_view'),
  partly: testPass('DSWx-HLS_20261102T1800_L9', NOW - 2 * DAY_MS, 'partly_hidden'),
}
const WARNING = version('w1', 'KABQ.FL.W.0019', 'NEW', NOW - 20 * HOUR_MS, null, { time_zone: 'America/Denver', sender_name: 'NWS Albuquerque NM' })
const TL = (): FloodTimelineResponse => testTimeline(NOW, Object.values(PASSES), [WARNING], 'fixture-flood')

function render(o: { cursorMs?: number | null; timeline?: FloodTimelineResponse | null; error?: string | null; engaged?: boolean; variant?: HydrographVariant } = {}) {
  const detail = DETAIL()
  ssrState(useWorkspace, { preset: 'command' })
  ssrState(useFlood, { floodId: detail.summary.id, summary: detail.summary, cursorMs: o.cursorMs ?? null } as never)
  ssrState(useFloodOfficial, { floodId: detail.summary.id, alerts: ans(ALERTS()), gauges: ans(GAUGES()), fim: NO_ANSWER, satellite: NO_ANSWER, nfhl: NO_ANSWER, local: NO_ANSWER } as never)
  ssrState(useHydroData, { gauges: { [gaugeKey('ZZRF1', null)]: ans(structuredClone(zzrf1) as unknown as RiverGaugesResponse) }, models: {}, asked: {} })
  ssrState(useFloodTimeline, { floodId: detail.summary.id, data: o.timeline === undefined ? TL() : o.timeline, loading: false, error: o.error ?? null })
  ssrState(useFloodPlayback, { floodId: detail.summary.id, playing: false, engaged: o.engaged ?? false })
  return renderToStaticMarkup(createElement(Hydrograph, { variant: o.variant ?? 'slim', floodId: detail.summary.id, lid: null, widthPx: 1000 }))
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
  restoreSsrState()
})

describe('flood time steps on the chart', () => {
  it('at now: what Play steps through; Play is not pressed (no autoplay); back is possible, forward is not', () => {
    const html = render()
    expect(html).toContain('role="group" aria-label="Flood time steps"')
    expect(html).toContain('2 satellite passes and 1 NWS product change from Oct 26 · Play steps through them')
    expect(html).toContain('aria-label="Play the time steps" aria-pressed="false"')
    expect(html).toMatch(/aria-label="Previous time step" data-tip="[^"]*"><svg/)
    expect(html).toMatch(/aria-label="Next time step" data-tip="[^"]*" disabled=""/)
    expect(html).toContain(PLAYBACK.keysHelp)
  })

  it('the passes as marks along the top: filled where NASA saw something, hollow for no view; NWS changes as ticks', () => {
    // the usual 72 h axis shows the partly hidden pass only; stepping widens it to the first step
    expect((render().match(/class="hg-pass[ "]/g) ?? []).length).toBe(1)
    const html = render({ engaged: true, cursorMs: PASSES.before.acquired_ms })
    expect((html.match(/class="hg-pass( is-current)?"/g) ?? []).length).toBe(2)
    expect((html.match(/class="hg-pass is-noview/g) ?? []).length).toBe(1)
    expect(html).toContain('class="hg-pass is-current"')
    // the NWS change is the chart's tick (not the live answer's three send times)
    expect((html.match(/class="hg-product/g) ?? []).length).toBe(1)
    // the axis starts at the first step (Oct 26, 12:00 MDT, less 6 h): the next day is labelled
    expect(html).toContain('TUE OCT 27')
    expect(render()).not.toContain('TUE OCT 27')
  })

  it('a pass step: its own time in the flood’s zone and its age; partly hidden says how much it did not see', () => {
    const html = render({ engaged: true, cursorMs: PASSES.partly.acquired_ms })
    expect(html).toContain('Satellite pass Nov 2, 11:00 MST · 2 days before now · no view of 65% of the area (clouds or no data)')
    expect(html).toContain('hg-step-label is-on')
  })

  it('an NWS step: NWS’s event name verbatim, its own time; the map’s image and the gap', () => {
    const html = render({ engaged: true, cursorMs: WARNING.shown_from_ms })
    expect(html).toContain('NWS <span data-verbatim="">Flood Warning</span> issued Nov 3, 15:00 MST')
    expect(html).toContain('Shown: satellite image of Nov 2, 11:00 MST (28 hours before the handle)')
    expect(html).toContain('No satellite image after Nov 2 yet')
  })

  it('between two passes: the older image with its own date, the gap, and the pass that saw nothing', () => {
    const html = render({ engaged: true, cursorMs: NOW - 5 * DAY_MS })
    expect(html).toContain('Shown: satellite image of Oct 26, 12:00 MDT (4 days before the handle)')
    expect(html).toContain('No satellite image between Oct 26 and Nov 2')
    expect(html).toContain('1 pass in between saw no view (clouds or no data)')
    expect(html).not.toContain('hg-step-label')
  })

  it('without steps it says why; a failed request says it could not be loaded (never an all-clear)', () => {
    const none = testTimeline(NOW, [], [], 'fixture-flood')
    none.passes.reason = 'NASA has no satellite water pass over this area between Oct 25 and Nov 4. That is not an all-clear.'
    const html = render({ timeline: none })
    expect(html).toContain('No satellite pass or NWS product change to step through yet. That is not an all-clear. NASA has no satellite water pass')
    expect(html).toMatch(/aria-label="Play the time steps" aria-pressed="false" data-tip="[^"]*" disabled=""/)
    expect(render({ timeline: null, error: 'API 503' })).toContain(PLAYBACK.unavailable)
  })

  it('the dock (Forensic) has the same controls', () => {
    const html = render({ variant: 'dock', engaged: true, cursorMs: PASSES.partly.acquired_ms })
    expect(html).toContain('class="hg-play is-dock"')
    expect(html).toContain('Satellite pass Nov 2, 11:00 MST')
  })

  it('the NWS changes stay the live answer’s ticks when the timeline’s products could not be loaded (review WFP-R7)', () => {
    const down = TL()
    down.products = { ...down.products, status: 'unavailable', products: [] }
    const ticks = (html: string) => (html.match(/class="hg-product/g) ?? []).length
    expect(ticks(render({ timeline: null }))).toBeGreaterThan(1)
    expect(ticks(render({ timeline: down }))).toBe(ticks(render({ timeline: null })))
  })

  it('a past step: "NWS · n" lists the versions the map draws; none at now (review WFP-R3)', () => {
    const html = render({ engaged: true, cursorMs: WARNING.shown_from_ms })
    expect(html).toContain('class="hg-nws-btn"')
    expect(html).toContain('>NWS · 1</button>')
    expect(html).toContain('aria-label="NWS products on the map at this time: 1. Each with its issuer, its own times and a link"')
    expect(render()).not.toContain('hg-nws-btn')
    // before the warning was issued nothing NWS is drawn: no button
    expect(render({ engaged: true, cursorMs: PASSES.before.acquired_ms })).not.toContain('hg-nws-btn')
  })

  it('each NWS version: its event and issuer verbatim, its own times in its zone, its link; an IEM copy tagged (review WFP-R3)', () => {
    const tf = { tz: 'America/Denver', clock: '24h' as const }
    const archived = renderToStaticMarkup(createElement(NwsVersion, { a: { ...WARNING, archived: true, url: 'https://mesonet.agron.iastate.edu/p.php?pid=202611032200-KABQ-WGUS45-FLWABQ', ends_ms: NOW + 30 * HOUR_MS }, tf }))
    expect(archived).toContain('<strong data-verbatim="">Flood Warning</strong> · <span data-verbatim="">NWS Albuquerque NM</span>')
    expect(archived).toContain('issued Nov 3, 15:00 MST · until Nov 5, 17:00 MST')
    expect(archived).toContain(ARCHIVED_COPY)
    expect(archived).toContain('href="https://mesonet.agron.iastate.edu/p.php?pid=202611032200-KABQ-WGUS45-FLWABQ"')
    expect(archived).toContain(PLAYBACK.nwsLinkArchived)
    const liveCopy = renderToStaticMarkup(createElement(NwsVersion, { a: { ...WARNING, archived: false }, tf }))
    expect(liveCopy).not.toContain(ARCHIVED_COPY)
    expect(liveCopy).toContain(`href="${WARNING.url}"`)
    expect(floodWordingProblems(stripVerbatim(archived))).toEqual([])
  })

  it('phones: the image’s date on its own line; the slim chart says which drawn layers show now (review WFP-R5, WFP-R6)', () => {
    const html = render({ engaged: true, cursorMs: WARNING.shown_from_ms })
    expect(html).toContain('<p class="hg-step-line" title="Image shown: Nov 2 (28 hours before)">Image shown: Nov 2 (28 hours before)</p>')
    ssrState(useFlood, { layers: { ...useFlood.getState().layers, model: true } })
    const detail = DETAIL()
    const withModel = renderToStaticMarkup(createElement(Hydrograph, { variant: 'slim', floodId: detail.summary.id, lid: null, widthPx: 1000 }))
    expect(withModel).toContain('As of now, not this time: model')
    expect(withModel).toContain('Image shown: Nov 2 (28 hours before) · Now: model')
    const dock = renderToStaticMarkup(createElement(Hydrograph, { variant: 'dock', floodId: detail.summary.id, lid: null, widthPx: 1000 }))
    expect(dock).not.toContain('As of now, not this time')
    // at now nothing of the kind
    expect(render()).not.toContain('hg-step-line')
  })

  it('Disaster Mapping’s own words pass the flood wording guard at every step', () => {
    for (const cursorMs of [null, PASSES.before.acquired_ms, NOW - 5 * DAY_MS, WARNING.shown_from_ms, PASSES.partly.acquired_ms]) {
      const text = stripVerbatim(render({ engaged: cursorMs != null, cursorMs }))
      expect(floodWordingProblems(text), String(cursorMs)).toEqual([])
    }
  })
})
