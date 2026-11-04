import { afterEach, describe, expect, it, vi } from 'vitest'
import { DETAIL, LIST, LIST_2025 } from '../api/__fixtures__/floods/edgeCases'
import { DEFAULT_FLOOD_LAYERS, openFloodSummary, pickFlood, useFlood } from './flood'
import { getSlot } from './floodCatalog'
import { useStore } from './store'
import { useWorkspace } from './workspace'

function stub(map: Record<string, unknown>, status = 200) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url))
    const hit = Object.entries(map).find(([k]) => String(url).includes(k))
    return hit ? new Response(JSON.stringify(hit[1]), { status }) : new Response('{}', { status: 404 })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  useFlood.getState().closeFlood()
  useFlood.setState({ filter: 'live', showWatches: false, layers: { ...DEFAULT_FLOOD_LAYERS } })
  useWorkspace.setState({ hazard: 'fire' })
  useStore.setState({ incidentId: null })
})

describe('flood store (CONTRACT §16.10)', () => {
  it('defaults: live filter, watches hidden (U2), FEMA / model / CatFIM off', () => {
    const s = useFlood.getInitialState()
    expect(s.filter).toBe('live')
    expect(s.showWatches).toBe(false)
    expect(s.layers).toMatchObject({ floodplain: false, model: false, catfim: false, events: true, gauges: true, warnings: true, satellite: true })
    expect(s.floodId).toBeNull()
  })

  it('loads a list; picking a year tab loads that year once', async () => {
    const calls = stub({ 'mode=live': LIST(), 'year=2025': LIST_2025() })
    await useFlood.getState().loadFloods('live')
    expect(getSlot(useFlood.getState().lists, 'live').response?.floods.length).toBe(LIST().floods.length)
    useFlood.getState().setFilter(2025)
    await new Promise((r) => setTimeout(r, 0))
    expect(getSlot(useFlood.getState().lists, 2025).response?.year ?? 2025).toBe(2025)
    useFlood.getState().setFilter('live')
    useFlood.getState().setFilter(2025)
    expect(calls.filter((u) => u.includes('year=2025'))).toHaveLength(1)
  })

  it('a failed list keeps its status (503: lists down, never "not found")', async () => {
    stub({ 'mode=live': { detail: 'x' } }, 503)
    await useFlood.getState().loadFloods('live')
    expect(getSlot(useFlood.getState().lists, 'live')).toMatchObject({ status: 503, loading: false })
  })

  it('opening a flood shows the list row at once, then the detail; it sets Floods and closes a fire', async () => {
    stub({ 'mode=live': LIST(), '/api/floods/fixture-flood': DETAIL() })
    await useFlood.getState().loadFloods('live')
    useStore.setState({ incidentId: '2026-a', summary: { id: '2026-a', name: 'A' } as never })
    const p = useFlood.getState().openFlood('fixture-flood', { source: 'list' })
    expect(useFlood.getState().summary?.id).toBe('fixture-flood') // from the list row
    expect(useFlood.getState().detailLoading).toBe(true)
    expect(useStore.getState().incidentId).toBeNull()
    expect(useWorkspace.getState().hazard).toBe('flood')
    await p
    expect(useFlood.getState()).toMatchObject({ floodId: 'fixture-flood', resolvedFrom: 'live', detailLoading: false })
    expect(openFloodSummary(useFlood.getState())?.name).toBe('Ridge Fork River flood')
  })

  it('a fire that opens closes the flood and lists fires again', async () => {
    stub({ '/api/floods/fixture-flood': DETAIL() })
    await useFlood.getState().openFlood('fixture-flood')
    useStore.setState({ incidentId: '2026-a' })
    expect(useFlood.getState().floodId).toBeNull()
    expect(useWorkspace.getState().hazard).toBe('fire')
  })

  it('pickFlood closes a fire card and opens the flood (both presets: Command opens its flood view directly, D14)', async () => {
    stub({ '/api/floods/fixture-flood': DETAIL() })
    useWorkspace.setState({ preset: 'command', fireCardId: '2026-a' })
    pickFlood('fixture-flood', 'marker')
    expect(useWorkspace.getState().fireCardId).toBeNull()
    expect(useFlood.getState().floodId).toBe('fixture-flood')
    useWorkspace.setState({ preset: 'public' })
  })

  it('layers, watches, gauge and cursor setters', () => {
    const s = useFlood.getState()
    s.setFloodLayer('model', true)
    expect(useFlood.getState().layers.model).toBe(true)
    s.setShowWatches(true)
    expect(useFlood.getState().showWatches).toBe(true)
    s.setCursor(Number.NaN)
    expect(useFlood.getState().cursorMs).toBeNull()
    s.setCursor(5)
    expect(useFlood.getState().cursorMs).toBe(5)
    s.setGauge('ZZRF1')
    expect(useFlood.getState().gaugeLid).toBe('ZZRF1')
  })
})
