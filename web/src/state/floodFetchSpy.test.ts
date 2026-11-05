// Brief 5 fetch-spy test (PLAN-5 §8, plan5-roles acceptance): mounting the flood overview and the flood chromes never
// asks a fire-only endpoint (/api/incidents/…, fire weather, CAL FIRE, agency records, aircraft). Tests run in Node
// without a DOM: each chrome is rendered on the server with React's effect hooks collected instead of skipped, then
// every collected effect runs once ("mount"), with `fetch` spied. Fire mode is checked the same way as a control: the
// fire overview does ask for the national fire weather, so the spy really sees effect-driven requests.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const effects: Array<() => unknown> = []
vi.mock('react', async (orig) => {
  const React = await orig<typeof import('react')>()
  const collect = (fn: () => unknown) => {
    effects.push(fn)
  }
  // stores read on the client side (no server snapshot needed)
  const useSyncExternalStore = <T,>(_subscribe: unknown, getSnapshot: () => T, getServerSnapshot?: () => T) => {
    try {
      return getSnapshot()
    } catch (e) {
      // a browser-only snapshot (matchMedia): the server one
      if (getServerSnapshot) return getServerSnapshot()
      throw e
    }
  }
  const hooks = { useEffect: collect, useLayoutEffect: collect, useSyncExternalStore }
  return { ...React, default: { ...React, ...hooks }, ...hooks }
})

// zustand (a dependency, loaded outside the mock above) would read its stores' INITIAL state on the server: its hooks
// here read the current state instead
vi.mock('zustand', async (orig) => {
  const z = await orig<typeof import('zustand')>()
  type Init = import('zustand').StateCreator<unknown>
  const make = (init: Init) => {
    const api = z.createStore(init)
    const hook = (selector: (s: unknown) => unknown = (x) => x) => selector(api.getState())
    return Object.assign(hook, api)
  }
  const create = (init?: Init) => (init ? make(init) : make)
  return { ...z, create }
})

const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { FIRE_ONLY_ENDPOINTS } = await import('../api/floods')
const { useFlood } = await import('./flood')
const { useStore } = await import('./store')
const { useWorkspace } = await import('./workspace')
const { OverviewChrome } = await import('../ui/shell/OverviewChrome')
const { PublicFloodChrome } = await import('../ui/shell/PublicFloodChrome')
const { CommandFloodChrome } = await import('../ui/shell/CommandFloodChrome')
const { ExtrasSync } = await import('../extras/ExtrasSync')

const requests: string[] = []

const summary = (await import('../api/__fixtures__/floods/edgeCases')).DETAIL().summary
const list = (await import('../api/__fixtures__/floods/edgeCases')).LIST()

/** Render on the server, then run each effect the render collected once (a "mount"); returns nothing. */
async function mount(el: ReturnType<typeof createElement>) {
  effects.length = 0
  renderToStaticMarkup(el)
  for (const fn of effects.splice(0)) {
    try {
      fn()
    } catch {
      // an effect that needs a real DOM (focus, layout); it fetches nothing
    }
  }
  await new Promise((r) => setTimeout(r, 0))
}

const fireOnly = () => requests.filter((u) => FIRE_ONLY_ENDPOINTS.some((re) => re.test(u)))

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(String(url))
    if (/\/api\/floods\/fixture-flood$/.test(String(url))) return new Response(JSON.stringify({ summary, manifest: null, job: null, resolved_from: 'live' }), { status: 200 })
    if (/\/api\/floods\?/.test(String(url))) return new Response(JSON.stringify(list), { status: 200 })
    return new Response('{"status":"unavailable"}', { status: 200 })
  })
})
afterAll(() => vi.unstubAllGlobals())
afterEach(() => {
  requests.length = 0
})

describe('brief 5: no fire-only request while a flood chrome is mounted', () => {
  it('control: the fire overview asks for the national fire weather (the spy sees effect requests)', async () => {
    useWorkspace.setState({ hazard: 'fire', preset: 'public' })
    useFlood.setState({ floodId: null, summary: null })
    await mount(createElement('div', null, createElement(ExtrasSync), createElement(OverviewChrome, { credits: null })))
    expect(requests.some((u) => /\/api\/official\/fire-weather/.test(u))).toBe(true)
  })

  it('the flood overview (Public and Command)', async () => {
    for (const preset of ['public', 'command'] as const) {
      useWorkspace.setState({ hazard: 'flood', preset })
      useFlood.setState({ floodId: null, summary: null })
      await mount(createElement('div', null, createElement(ExtrasSync), createElement(OverviewChrome, { credits: null })))
      expect(fireOnly(), preset).toEqual([])
    }
  })

  it('the Public and Command flood views', async () => {
    useStore.setState({ incidentId: null, summary: null, manifest: null })
    await useFlood.getState().openFlood('fixture-flood', { source: 'url' })
    expect(useFlood.getState().summary?.id).toBe('fixture-flood')
    for (const [preset, Chrome] of [
      ['public', PublicFloodChrome],
      ['command', CommandFloodChrome],
    ] as const) {
      useWorkspace.setState({ hazard: 'flood', preset })
      await mount(createElement('div', null, createElement(ExtrasSync), createElement(Chrome, { credits: null })))
      expect(fireOnly(), preset).toEqual([])
    }
    // the flood's evacuations are asked with hazard=flood for its own area
    await mount(createElement(ExtrasSync))
    expect(requests.some((u) => /\/api\/extras\/evacuations\?bbox=.*&hazard=flood/.test(u))).toBe(true)
    useFlood.getState().closeFlood()
  })
})
