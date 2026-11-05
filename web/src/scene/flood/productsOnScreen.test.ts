// The NWS products of the 3D flood view at the handle (review WFF3D-R4): the warning lines, the hover and the dock's NWS
// column read one answer, so they always list the same versions; archived versions keep their tag and the IEM credit.
import { describe, expect, it } from 'vitest'
import { ALERTS } from '../../api/__fixtures__/floods/edgeCases'
import type { FloodAlert, FloodAlertsResponse, FloodTimelineResponse } from '../../api/types'
import { HOUR_MS, timeFmt } from '../../lib/time'
import { testTimeline, versionBuilder } from '../../state/floodTimeline.testutil'
import { dockNoProduct } from '../../ui/forensic-flood/floodForensicView'
import { floodWordingProblems } from '../../ui/shell/floodCopy'
import dockSource from '../../ui/forensic-flood/FloodDock.tsx?raw'
import overlaysSource from '../overlays/SceneOverlays.tsx?raw'
import hooksSource from './flood3dHooks.ts?raw'
import fxSource from './FloodFx.tsx?raw'
import { productsOnScreenOf } from './productsOnScreen'

const NOW = Date.UTC(2026, 10, 5, 18)
const v = versionBuilder(NOW)

function route(): FloodTimelineResponse {
  const tl = testTimeline(NOW, [], [
    // an archived version (IEM) of an event, then NWS's live copy of its next version
    v('w1', 'KJAX.FL.W.0007', 'NEW', NOW - 20 * 24 * HOUR_MS, null, { replaced_ms: NOW - 10 * 24 * HOUR_MS, shown_until_ms: NOW - 10 * 24 * HOUR_MS }),
    v('w2', 'KJAX.FL.W.0007', 'EXT', NOW - 10 * 24 * HOUR_MS, null, { archived: false }),
  ])
  tl.products!.archive_source = { name: 'Iowa Environmental Mesonet', url: 'https://mesonet.agron.iastate.edu/', credit: 'Archived copy (Iowa Environmental Mesonet)', terms_url: null } as never
  return tl
}

describe('productsOnScreenOf', () => {
  it("before now: the time history's versions at the handle, archived ones with the IEM credit", () => {
    const r = productsOnScreenOf({ copy: ALERTS(), route: route(), cursorMs: NOW - 15 * 24 * HOUR_MS, nowMs: NOW })!
    expect(r.source).toBe('timeline')
    expect(r.alerts.map((a) => a.id)).toEqual(['w1'])
    expect(r.alerts[0].archived).toBe(true)
    expect(r.archiveCredit?.text).toBe('Archived copy (Iowa Environmental Mesonet)')
    expect(r.archiveCredit?.href).toBe('https://mesonet.agron.iastate.edu/')
    // later the next version replaces it (never both)
    expect(productsOnScreenOf({ copy: ALERTS(), route: route(), cursorMs: NOW - 5 * 24 * HOUR_MS, nowMs: NOW })!.alerts.map((a) => a.id)).toEqual(['w2'])
  })

  it('at now (or without the time history): the copy saved with the 3D data, its newest version of each product', () => {
    const copy = ALERTS()
    const flw = copy.alerts.find((a) => a.event === 'Flood Warning')!
    const older: FloodAlert = { ...flw, id: 'flw.old', vtec: { ...flw.vtec!, action: 'NEW' }, sent_ms: (flw.sent_ms ?? 0) - 6 * HOUR_MS }
    const withOld: FloodAlertsResponse = { ...copy, alerts: [older, ...copy.alerts] }
    const r = productsOnScreenOf({ copy: withOld, route: route(), cursorMs: null, nowMs: copy.now_ms })!
    expect(r.source).toBe('copy')
    expect(r.alerts.map((a) => a.id)).not.toContain('flw.old')
    expect(r.alerts.some((a) => a.id === flw.id)).toBe(true)
    expect(r.archiveCredit).toBeNull()
    expect(r.retrievedMs).toBe(copy.retrieved_ms)
    expect(productsOnScreenOf({ copy: withOld, route: null, cursorMs: copy.now_ms - HOUR_MS, nowMs: copy.now_ms })!.source).toBe('copy')
  })

  it('a copy that could not be read: null (its outage text is shown instead)', () => {
    expect(productsOnScreenOf({ copy: { ...ALERTS(), status: 'unavailable' }, route: route(), cursorMs: null, nowMs: NOW })).toBeNull()
    expect(productsOnScreenOf({ copy: null, route: route(), cursorMs: null, nowMs: NOW })).toBeNull()
  })

  it('an empty list at a past handle names the time history (never an all-clear)', () => {
    const tf = timeFmt('America/New_York', '24h')
    const t = dockNoProduct({ cursorMs: NOW - 30 * 24 * HOUR_MS, nowMs: NOW, savedMs: NOW, tf, source: 'timeline' })
    expect(t).toMatch(/in the flood's time history/)
    expect(floodWordingProblems(t)).toEqual([])
  })

  it('the 3D warning lines, the hover and the dock column all read this one answer', () => {
    expect(fxSource).toMatch(/const shown = useProductsOnScreen\(flood\)/)
    expect(overlaysSource).toMatch(/useProductsOnScreen\(fl \?\? null\)/)
    expect(dockSource).toMatch(/const shown = useProductsOnScreen\(flood\)/)
    expect(dockSource).not.toMatch(/warningsAt\(/)
    expect(hooksSource).toMatch(/productsOnScreenOf\(\{ copy, route: forThis \? route : null, cursorMs, nowMs \}\)/)
  })
})
