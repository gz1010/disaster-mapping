// "Official now" of a flood (brief 5, PLAN-5 §4.5, D23, D24; CONTRACT §16.4): NWS products verbatim (data-verbatim),
// Emergency first and open, NO_PRODUCT only for an available answer, the river forecast with its issuer and own time,
// flood-worded evacuations, MODEL_SEPARATE; no banned word in Fire-3d's own words; model output never a row.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALERTS, ALERTS_FLASH, ALERTS_UNAVAILABLE, DETAIL, DETAIL_FLASH, FIXTURE_NOW_MS, GAUGES, MODEL_SERIES } from '../../api/__fixtures__/floods/edgeCases'
import evacNm from '../../api/__fixtures__/floods/evacuations.json'
import type { FloodAlertsResponse } from '../../api/types'
import { useExtrasRuntime } from '../../extras/runtime'
import { useFloodOfficial } from '../../official/floodHooks'
import { NO_ANSWER, type Answer } from '../../official/floodModel'
import { useFlood } from '../../state/flood'
import { ALERTS_UNAVAILABLE as ALERTS_UNAVAILABLE_TEXT, floodWordingProblems, MODEL_SEPARATE, NO_PRODUCT, stripVerbatim } from '../shell/floodCopy'
import { restoreSsrState, ssrState } from '../ssr.testutil'
import { FloodOfficialNow } from './FloodOfficialNow'

const ans = <T,>(data: T | null): Answer<T> => ({ data, loading: false, error: null })

function render(alerts: Answer<FloodAlertsResponse>, summary = DETAIL().summary) {
  ssrState(useFlood, { floodId: summary.id, summary } as never)
  ssrState(useFloodOfficial, { floodId: summary.id, alerts, gauges: ans(GAUGES()), fim: NO_ANSWER, satellite: NO_ANSWER, nfhl: NO_ANSWER, local: NO_ANSWER } as never)
  ssrState(useExtrasRuntime, { evac: { data: evacNm, loading: false, error: null, refresh: () => undefined } } as never)
  return renderToStaticMarkup(createElement(FloodOfficialNow))
}

beforeEach(() => {
  vi.useFakeTimers({ now: FIXTURE_NOW_MS, toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
  restoreSsrState()
})

describe('FloodOfficialNow', () => {
  it('one row per NWS product (event verbatim, sender, own end time), the river forecast, evacuations, MODEL_SEPARATE', () => {
    const html = render(ans(ALERTS()))
    expect(html).toContain('<strong>Flood Warning</strong>')
    expect(html).toContain('<strong>Flood Advisory</strong>')
    expect(html).toMatch(/in effect until Nov \d{1,2}, \d{1,2}:\d{2}/)
    expect(html).toContain('NWS EXAMPLE OFFICE (SYNTHETIC)')
    expect(html).toContain('<strong>River forecast</strong> — crest 18.0 ft')
    expect(html).toContain('NWS Example River Forecast Center (synthetic), issued')
    expect(html).toContain('Evacuations')
    expect(html).toContain(MODEL_SEPARATE.replace(/'/g, '&#x27;'))
    expect(html).not.toContain(NO_PRODUCT)
    expect(floodWordingProblems(stripVerbatim(html))).toEqual([])
  })
  it('a Flash Flood Emergency comes first and open with NWS words verbatim', () => {
    const html = render(ans(ALERTS_FLASH()), DETAIL_FLASH().summary)
    const first = html.indexOf('<li')
    expect(html.slice(first, first + 400)).toContain('Flash Flood Warning · Flash Flood Emergency')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toMatch(/<p class="ffo-text[^"]*" data-verbatim="">/)
  })
  it('D24: an available answer with no product says NO_PRODUCT; an unavailable one never does', () => {
    const empty = ALERTS()
    empty.alerts = []
    expect(render(ans(empty))).toContain(NO_PRODUCT)
    const down = render(ans(ALERTS_UNAVAILABLE()))
    expect(down).not.toContain(NO_PRODUCT)
    expect(down).toContain(ALERTS_UNAVAILABLE().reason ?? ALERTS_UNAVAILABLE_TEXT)
  })
  it('model output is never an official row', () => {
    const html = render(ans(MODEL_SERIES() as unknown as FloodAlertsResponse))
    expect(html).not.toContain('National Water Model</strong>')
    expect(html).not.toContain(NO_PRODUCT)
  })
})
