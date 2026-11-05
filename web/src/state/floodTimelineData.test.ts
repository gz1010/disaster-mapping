// state/floodTimelineData.ts (brief 6, web-flood-playback M1): the route's query, when to ask again, the store's state,
// and that an answer for a flood no longer asked is dropped.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FloodTimelineResponse } from '../api/types'
import { fetchFloodTimeline, floodTimelineQuery, timelineFor, timelineIncomplete, timelineState, useFloodTimeline } from './floodTimelineData'

const answer = (id: string, complete = true) =>
  ({ kind: 'flood_timeline', flood_id: id, now_ms: 1, start_ms: 0, end_ms: 1, synthetic: true, passes: { complete, passes: [] }, products: { complete: true, products: [] } }) as unknown as FloodTimelineResponse

afterEach(() => {
  vi.unstubAllGlobals()
  useFloodTimeline.setState({ floodId: null, data: null, loading: false, error: null, receivedMs: null })
})

describe('flood timeline data', () => {
  it('asks with wait=0 (clamped 0..30) and an encoded id', () => {
    expect(floodTimelineQuery('fixture-flood')).toBe('/floods/fixture-flood/timeline?wait=0')
    expect(floodTimelineQuery('a b', 99)).toBe('/floods/a%20b/timeline?wait=30')
  })

  it('asks again while a block is not complete', () => {
    expect(timelineIncomplete(answer('f', false))).toBe(true)
    expect(timelineIncomplete(answer('f', true))).toBe(false)
    const products = { ...answer('f'), products: { complete: false, products: [] } } as unknown as FloodTimelineResponse
    expect(timelineIncomplete(products)).toBe(true)
    expect(timelineIncomplete(null)).toBe(false)
  })

  it('states: none, loading, available, unavailable; timelineFor only for the flood asked', () => {
    expect(timelineState({ data: null, loading: false, error: null })).toBe('none')
    expect(timelineState({ data: null, loading: true, error: null })).toBe('loading')
    expect(timelineState({ data: answer('f'), loading: true, error: 'x' })).toBe('available')
    expect(timelineState({ data: null, loading: false, error: 'API 500' })).toBe('unavailable')
    expect(timelineFor({ floodId: 'f', data: answer('f') }, 'f')?.flood_id).toBe('f')
    expect(timelineFor({ floodId: 'f', data: answer('f') }, 'g')).toBeNull()
  })

  it('stores the answer; drops one for a flood no longer asked', async () => {
    let resolve: (v: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (resolve = r))))
    const run = fetchFloodTimeline('f')
    expect(useFloodTimeline.getState()).toMatchObject({ floodId: 'f', loading: true })
    resolve(new Response(JSON.stringify(answer('f')), { status: 200 }))
    await run
    expect(useFloodTimeline.getState().data?.flood_id).toBe('f')
    // another flood is asked while the first answer is on its way: the late answer is dropped
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (resolve = r))))
    const late = fetchFloodTimeline('f2')
    useFloodTimeline.setState({ floodId: 'g', data: null })
    resolve(new Response(JSON.stringify(answer('f2')), { status: 200 }))
    await late
    expect(useFloodTimeline.getState()).toMatchObject({ floodId: 'g', data: null })
  })

  it('a failed request keeps the last answer and says why', async () => {
    useFloodTimeline.setState({ floodId: 'f', data: answer('f') })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('down', { status: 503 }))))
    await fetchFloodTimeline('f')
    const s = useFloodTimeline.getState()
    expect(s.data?.flood_id).toBe('f')
    expect(s.error).toMatch(/503/)
  })
})
