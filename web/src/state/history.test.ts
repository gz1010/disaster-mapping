import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goToOverview } from '../ui/shell/fireActions'
import { goToFloodOverview, useFlood } from './flood'
import { floodNavigationUrl, floodParam, historyWrite, incidentParam, installHistorySync, isHistoryEntry, linkWithBothUrl, navigationUrl } from './history'
import { useStore } from './store'
import { useWorkspace } from './workspace'

describe('history rules', () => {
  it('pushes every navigation, replaces the not-found fallback, skips what the address bar already says', () => {
    expect(historyWrite(null, '2026-a', false)).toBe('push') // overview -> fire
    expect(historyWrite('2026-a', '2025-b', false)).toBe('push') // fire -> fire
    expect(historyWrite('2026-a', null, false)).toBe('push') // "All fires"
    expect(historyWrite('2026-a', '2026-a', false)).toBe('none') // deep link, Back / Forward
    expect(historyWrite(null, null, false)).toBe('none')
    expect(historyWrite('bad-id', null, true)).toBe('replace') // unknown link: Back never leads to it
  })

  it('records zoom focus changes in place (decision 10: Back steps through explicit opens only)', () => {
    expect(historyWrite(null, '2026-a', false, true)).toBe('replace') // zoom in on a fire
    expect(historyWrite('2026-a', null, false, true)).toBe('replace') // zoom back out
    expect(historyWrite('2026-a', '2026-b', false, true)).toBe('replace') // pan to another fire
    expect(historyWrite('2026-a', '2026-a', false, true)).toBe('none')
  })

  it('brief 4: the Public fire view is an explicit open (one push from the overview); zooming out never rewrites it', () => {
    // openFireView selects with source 'card' (state/fireCard.ts), never 'zoom': Public has no zoom focus
    expect(historyWrite(null, '2026-a', false, false)).toBe('push')
    expect(historyWrite('2026-a', '2026-b', false, false)).toBe('push') // another fire from the open fire view
    expect(historyWrite('2026-a', null, false, false)).toBe('push') // "Back to all fires" when not opened from the overview
  })

  it('builds the address of a navigation: drops the previous fire\'s t / mode and the one-shot params', () => {
    const href = 'http://x/app/?ws=map&incident=2026-a&mode=live&t=123&preset=command&basemap=roads&view=1,2,3&sel=1,2#h'
    expect(navigationUrl(href, '2025-b')).toBe('/app/?ws=map&incident=2025-b&preset=command&basemap=roads#h')
    expect(navigationUrl(href, null)).toBe('/app/?ws=map&preset=command&basemap=roads#h')
  })

  it('reads the incident parameter and recognises its own entries', () => {
    expect(incidentParam('?ws=map&incident=2026-a')).toBe('2026-a')
    expect(incidentParam('?incident=')).toBeNull()
    expect(incidentParam('')).toBeNull()
    expect(isHistoryEntry({ fire3d: 1, incident: null, fromOverview: false })).toBe(true)
    expect(isHistoryEntry(null)).toBe(false)
    expect(isHistoryEntry({ fire3d: 2 })).toBe(false)
  })
})

// ------------------------------------------------------------------------------------------------ brief 5: floods

describe('brief 5: flood addresses (CONTRACT §16.10)', () => {
  it('?flood= is never kept beside ?incident= (navigationUrl drops it, floodNavigationUrl drops the fire)', () => {
    const href = 'http://x/?ws=map&hazard=flood&flood=fixture-flood&view=1,2,3'
    expect(navigationUrl(href, '2026-a')).toBe('/?ws=map&hazard=flood&incident=2026-a')
    expect(floodNavigationUrl('http://x/?ws=map&incident=2026-a&mode=live&t=5&sel=1,2', 'fixture-flood')).toBe('/?ws=map&flood=fixture-flood')
    expect(floodNavigationUrl(href, null)).toBe('/?ws=map&hazard=flood')
  })

  it('a stale ?flood= never survives a fire navigation; a start-up link with both drops it (review WFO-R5)', () => {
    // a link with both: the fire opens and the address loses `flood`, so Back to all fires or a reload never opens it
    expect(linkWithBothUrl('http://x/?flood=fixture-flood&incident=fixture-live&ws=map#h')).toBe('/?incident=fixture-live&ws=map#h')
    expect(linkWithBothUrl('http://x/?flood=fixture-flood&ws=map')).toBeNull()
    expect(linkWithBothUrl('http://x/?incident=fixture-live')).toBeNull()
    // closing a fire drops a stale ?flood= (unless a flood is open)
    expect(navigationUrl('http://x/?flood=fixture-flood&incident=fixture-live&ws=map&mode=live', null)).toBe('/?ws=map')
    expect(navigationUrl('http://x/?flood=fixture-flood&ws=map', null, true)).toBe('/?flood=fixture-flood&ws=map')
  })

  it('reads ?flood= (a link with both opens the fire: no flood)', () => {
    expect(floodParam('?flood=fixture-flood')).toBe('fixture-flood')
    expect(floodParam('?incident=2026-a&flood=fixture-flood')).toBeNull()
    expect(floodParam('?flood=')).toBeNull()
    expect(isHistoryEntry({ fire3d: 1, incident: null, flood: 'x', fromOverview: true })).toBe(true)
  })
})

/** A browser history in memory: entries, Back, popstate. */
function fakeBrowser(start: string) {
  const listeners = new Set<() => void>()
  const entries: { state: unknown; url: string }[] = [{ state: null, url: new URL(start, 'http://x').href }]
  let i = 0
  const win = {
    location: new URL(entries[0].url),
    history: {
      get state() {
        return entries[i].state
      },
      pushState(state: unknown, _t: string, url: string) {
        entries.splice(i + 1)
        entries.push({ state, url: new URL(url, win.location.href).href })
        i++
        win.location = new URL(entries[i].url)
      },
      replaceState(state: unknown, _t: string, url: string) {
        entries[i] = { state, url: new URL(url, win.location.href).href }
        win.location = new URL(entries[i].url)
      },
      back() {
        if (i === 0) return
        i--
        win.location = new URL(entries[i].url)
        for (const l of [...listeners]) l()
      },
    },
    addEventListener: (t: string, l: () => void) => t === 'popstate' && listeners.add(l),
    removeEventListener: (t: string, l: () => void) => t === 'popstate' && listeners.delete(l),
  }
  return { win, entries, index: () => i }
}

const floodSummary = (id: string) =>
  ({ id, hazard: 'flood', name: 'Ridge Fork River flood', aliases: [], products: [], gauges: [], bbox_lonlat: [-108.2, 36.7, -107.9, 36.9], lat: 36.79, lon: -108.06, mode: 'live', year: 2026, time_zone: 'America/Denver', synthetic: true, level: 'warning', kind: 'river', status: 'active' }) as never

const fireDetail = (id: string) => ({ summary: { id, name: 'Test Fire', lat: 34, lon: -118, mode: 'live', bundle_status: 'none', time_zone: 'America/Los_Angeles' }, manifest: null, job: null })

/** fetch answers: a flood detail (canonical id `canon` when given; status `floodStatus`), a fire detail. */
function stubFetch(o: { canon?: string; floodStatus?: number } = {}) {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url)
    const m = /\/api\/floods\/([^/?]+)$/.exec(u)
    if (m) {
      if (o.floodStatus) return new Response('{"detail":"x"}', { status: o.floodStatus })
      const id = o.canon ?? decodeURIComponent(m[1])
      return new Response(JSON.stringify({ summary: floodSummary(id), manifest: null, job: null, resolved_from: o.canon ? 'alias' : 'live' }), { status: 200 })
    }
    const f = /\/api\/incidents\/([^/?]+)$/.exec(u)
    if (f) return new Response(JSON.stringify(fireDetail(decodeURIComponent(f[1]))), { status: 200 })
    return new Response('{}', { status: 404 })
  })
}

describe('brief 5: one history entry per hazard switch (C21)', () => {
  let uninstall: (() => void) | null = null
  const setup = (start: string) => {
    const b = fakeBrowser(start)
    vi.stubGlobal('window', b.win)
    uninstall = installHistorySync()
    return b
  }
  const settle = () => new Promise((r) => setTimeout(r, 0))
  beforeEach(() => {
    useStore.setState({ incidentId: null, summary: null, manifest: null, missingIncidentId: null })
    useFlood.setState({ floodId: null, summary: null, missingFloodId: null, missingReason: null, resolvedFrom: null })
    useWorkspace.setState({ hazard: 'fire', fireCardId: null })
  })
  afterEach(() => {
    uninstall?.()
    uninstall = null
    useStore.getState().closeIncident()
    useFlood.getState().closeFlood()
    vi.unstubAllGlobals()
  })

  it('fire → flood → Back: the switch is one entry; Back reopens the fire and closes the flood', async () => {
    stubFetch()
    const b = setup('/?ws=map')
    await useStore.getState().selectIncident('2026-a', { source: 'picker' })
    expect(b.entries).toHaveLength(2)
    await useFlood.getState().openFlood('fixture-flood', { source: 'search' })
    expect(b.entries).toHaveLength(3)
    expect(b.win.location.search).toBe('?ws=map&flood=fixture-flood')
    expect(useStore.getState().incidentId).toBeNull()
    expect(useWorkspace.getState().hazard).toBe('flood')
    b.win.history.back()
    await settle()
    expect(b.entries).toHaveLength(3)
    expect(b.index()).toBe(1)
    expect(useStore.getState().incidentId).toBe('2026-a')
    expect(useFlood.getState().floodId).toBeNull()
    expect(useWorkspace.getState().hazard).toBe('fire')
  })

  it('flood → fire → Back: one entry each way; Back reopens the flood and keeps listing floods', async () => {
    stubFetch()
    const b = setup('/?ws=map&hazard=flood')
    await useFlood.getState().openFlood('fixture-flood', { source: 'marker' })
    expect(b.entries).toHaveLength(2)
    expect(b.entries[1].state).toMatchObject({ fire3d: 1, incident: null, flood: 'fixture-flood', fromOverview: true })
    await useStore.getState().selectIncident('2026-a', { source: 'search' })
    expect(b.entries).toHaveLength(3)
    expect(b.win.location.search).toBe('?ws=map&hazard=flood&incident=2026-a')
    expect(useFlood.getState().floodId).toBeNull()
    b.win.history.back()
    await settle()
    expect(b.entries).toHaveLength(3)
    expect(useFlood.getState().floodId).toBe('fixture-flood')
    expect(useStore.getState().incidentId).toBeNull()
    expect(useWorkspace.getState().hazard).toBe('flood')
    // Back again: the flood overview (still Floods)
    b.win.history.back()
    await settle()
    expect(useFlood.getState().floodId).toBeNull()
    expect(useWorkspace.getState().hazard).toBe('flood')
  })

  it('fire → flood → "Back to all floods" lands on the flood overview, never Back on the fire (review WFO-R1)', async () => {
    stubFetch()
    const b = setup('/?ws=map')
    await useStore.getState().selectIncident('2026-a', { source: 'picker' })
    expect(b.entries[1].state).toMatchObject({ incident: '2026-a', fromOverview: true })
    await useFlood.getState().openFlood('fixture-flood', { source: 'card' })
    // a fire was open just before: the flood's entry is not "from the overview"
    expect(b.entries[2].state).toMatchObject({ flood: 'fixture-flood', fromOverview: false })
    goToFloodOverview()
    await settle()
    expect(useFlood.getState().floodId).toBeNull()
    expect(useStore.getState().incidentId).toBeNull()
    expect(useWorkspace.getState().hazard).toBe('flood')
    expect(b.win.location.search).toBe('?ws=map')
    expect(b.entries).toHaveLength(4)
    expect(b.index()).toBe(3)
  })

  it('flood → fire → "Back to all fires" lands on the fire overview, never Back on the flood (review WFO-R1)', async () => {
    stubFetch()
    const b = setup('/?ws=map&hazard=flood')
    await useFlood.getState().openFlood('fixture-flood', { source: 'marker' })
    expect(b.entries[1].state).toMatchObject({ flood: 'fixture-flood', fromOverview: true })
    await useStore.getState().selectIncident('2026-a', { source: 'search' })
    // a flood was open just before: the fire's entry is not "from the overview"
    expect(b.entries[2].state).toMatchObject({ incident: '2026-a', fromOverview: false })
    goToOverview()
    await settle()
    expect(useStore.getState().incidentId).toBeNull()
    expect(useFlood.getState().floodId).toBeNull()
    expect(useWorkspace.getState().hazard).toBe('fire')
    expect(b.win.location.search).not.toContain('flood=')
    expect(b.win.location.search).not.toContain('incident=')
    expect(b.entries).toHaveLength(4)
    expect(b.index()).toBe(3)
  })

  it('an event opened from its own overview still goes Back (one entry, no second overview entry)', async () => {
    stubFetch()
    const b = setup('/?ws=map&hazard=flood')
    await useFlood.getState().openFlood('fixture-flood', { source: 'list' })
    goToFloodOverview()
    await settle()
    expect(useFlood.getState().floodId).toBeNull()
    expect(b.index()).toBe(0)
    expect(b.entries).toHaveLength(2)
  })

  it('an alias answer replaces the address with the canonical id (no new entry)', async () => {
    stubFetch({ canon: 'flood-20261104-ridge-fork-river-flood-abc123' })
    const b = setup('/?ws=map&hazard=flood')
    await useFlood.getState().openFlood('flood-20261103-old-name-def456', { source: 'url' })
    expect(b.entries).toHaveLength(2)
    expect(useFlood.getState().floodId).toBe('flood-20261104-ridge-fork-river-flood-abc123')
    expect(b.win.location.search).toBe('?ws=map&hazard=flood&flood=flood-20261104-ridge-fork-river-flood-abc123')
  })

  it('404 replaces the dead link with the flood overview (not_listed); 503 says the lists are down, never "not found"', async () => {
    stubFetch({ floodStatus: 404 })
    const b = setup('/?ws=map&hazard=flood')
    await useFlood.getState().openFlood('flood-20260101-gone-000000', { source: 'url' })
    expect(useFlood.getState()).toMatchObject({ floodId: null, missingFloodId: 'flood-20260101-gone-000000', missingReason: 'not_listed' })
    expect(b.win.location.search).toBe('?ws=map&hazard=flood')
    expect(b.entries).toHaveLength(2)
    vi.unstubAllGlobals()
    vi.stubGlobal('window', b.win)
    stubFetch({ floodStatus: 503 })
    await useFlood.getState().openFlood('flood-20260101-gone-000000', { source: 'url' })
    expect(useFlood.getState().missingReason).toBe('lists_down')
  })
})
