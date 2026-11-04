import { describe, expect, it } from 'vitest'
import type { FloodSummary } from '../api/types'
import { LIST, LIST_2026, LIST_BOTH_DOWN, LIST_EMPTY, LIST_GAUGES_DOWN, LIST_NWS_DOWN, LIST_YEAR_ARCHIVE_DOWN, PAST_FLOOD, YEAR_ARCHIVE_DOWN_REASON } from '../api/__fixtures__/floods/edgeCases'
import { EMPTY_SLOT } from './floodCatalog'
import {
  floodFlyTo,
  floodListHealth,
  floodListUnreadable,
  floodMarkerKind,
  floodRank,
  floodsInView,
  hiddenWatches,
  highestProduct,
  knownFloodCount,
  listDownReasons,
  listSourceIds,
  shownFloods,
  sortFloods,
  WATCHES_SHOWN_BY_DEFAULT,
} from './floodOverview'

const byId = (id: string) => LIST().floods.find((f) => f.id === id)!

describe('flood rank and marker kinds (CONTRACT §16.8)', () => {
  it('ranks: emergency first, then category, flash warning, level, gauges in flood', () => {
    const flash = byId('fixture-flood-flash')
    expect(floodRank(flash)).toBeGreaterThanOrEqual(1000 + 200)
    expect(floodRank(byId('fixture-flood-major'))).toBe(400 + 50 + Math.min(byId('fixture-flood-major').gauges_in_flood, 9))
    expect(floodRank(byId('fixture-flood-watch'))).toBe(0)
    const sorted = sortFloods(LIST().floods).map((f) => f.id)
    expect(sorted[0]).toBe('fixture-flood-flash')
    expect(sorted.at(-1)).toBe('fixture-flood-watch')
  })

  it('marker kinds from the official level and category only', () => {
    expect(floodMarkerKind(byId('fixture-flood-flash'))).toBe('large')
    expect(floodMarkerKind(byId('fixture-flood-major'))).toBe('large')
    expect(floodMarkerKind(byId('fixture-flood-moderate'))).toBe('large')
    expect(floodMarkerKind(byId('fixture-flood-minor'))).toBe('small') // gauge-only at minor
    expect(floodMarkerKind(byId('fixture-flood-advisory'))).toBe('small')
    expect(floodMarkerKind(byId('fixture-flood-watch'))).toBe('other')
    expect(floodMarkerKind(PAST_FLOOD())).toBe('other')
    const warningMinor = { ...byId('fixture-flood-moderate'), max_category: 'minor', gauges_in_flood: 1 } as FloodSummary
    expect(floodMarkerKind(warningMinor)).toBe('active')
    expect(floodMarkerKind({ ...warningMinor, status: 'inactive' })).toBe('other')
  })

  it('watches hidden by default (U2), counted; point checks are not filtered here', () => {
    expect(WATCHES_SHOWN_BY_DEFAULT).toBe(false)
    const l = LIST().floods
    expect(shownFloods(l, false).some((f) => f.level === 'watch')).toBe(false)
    expect(shownFloods(l, true)).toHaveLength(l.length)
    expect(hiddenWatches(l, false)).toBe(1)
    expect(hiddenWatches(l, true)).toBe(0)
  })

  it('highest product in effect: Emergency and warnings before advisories and watches', () => {
    expect(highestProduct(byId('fixture-flood'))?.event).toBe('Flood Warning')
    expect(highestProduct(byId('fixture-flood-watch'))?.event).toBe('Flood Watch')
    expect(highestProduct(byId('fixture-flood-minor'))).toBeNull()
  })

  it('list health from the sources; the count is never 0 when unknown', () => {
    const slot = (r: ReturnType<typeof LIST>) => ({ ...EMPTY_SLOT, response: r })
    expect(floodListHealth(slot(LIST()))).toBe('ok')
    expect(floodListHealth(slot(LIST_NWS_DOWN()))).toBe('nws_down')
    expect(floodListHealth(slot(LIST_GAUGES_DOWN()))).toBe('gauges_down')
    expect(floodListHealth(slot(LIST_BOTH_DOWN()))).toBe('both_down')
    expect(floodListHealth({ ...EMPTY_SLOT, error: 'x' })).toBe('failed')
    expect(knownFloodCount(null, false)).toBeNull()
    expect(knownFloodCount(LIST_EMPTY(), false)).toBe(0)
    const both = LIST_BOTH_DOWN()
    expect(knownFloodCount({ ...both, floods: [] }, false)).toBeNull()
    expect(knownFloodCount(LIST(), false)).toBe(LIST().floods.length - 1)
  })

  it('a year list is read from the IEM archive: archive down is an outage, never "0 floods" (review WFO-R3)', () => {
    const slot = (r: ReturnType<typeof LIST>) => ({ ...EMPTY_SLOT, response: r })
    expect(listSourceIds(LIST())).toEqual(['nws_alerts', 'nwps_gauges'])
    expect(listSourceIds(LIST_2026())).toEqual(['iem_archive'])
    // an answered empty year is a real empty year; an unreadable archive is not
    expect(floodListHealth(slot(LIST_2026()))).toBe('ok')
    expect(knownFloodCount(LIST_2026(), false)).toBe(0)
    const down = LIST_YEAR_ARCHIVE_DOWN()
    expect(floodListHealth(slot(down))).toBe('archive_down')
    expect(floodListUnreadable('archive_down')).toBe(true)
    expect(floodListUnreadable('both_down')).toBe(true)
    expect(floodListUnreadable('nws_down')).toBe(false)
    expect(knownFloodCount(down, false)).toBeNull()
    // the backend's own reason, verbatim and once
    expect(listDownReasons(down)).toEqual([YEAR_ARCHIVE_DOWN_REASON])
    expect(listDownReasons(LIST_BOTH_DOWN())).toEqual([LIST_BOTH_DOWN().sources[0].reason])
    expect(listDownReasons(LIST())).toEqual([])
  })

  it('in this view and the fly-to box', () => {
    const l = LIST().floods
    expect(floodsInView(l, [-110, 35, -105, 38]).map((f) => f.id)).toEqual(['fixture-flood'])
    expect(floodsInView(l, null)).toHaveLength(l.length)
    const fly = floodFlyTo(byId('fixture-flood'))!
    expect(fly.bounds![0]).toBeLessThan(byId('fixture-flood').bbox_lonlat[0])
    expect(floodFlyTo({ bbox_lonlat: [0, 0, 0, 0], lat: 36, lon: -108 })).toEqual({ lon: -108, lat: 36, zoom: 11 })
  })
})
