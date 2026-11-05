// The 3D flood scene's loader (review WFF-R10), with a stubbed fetch: layers whose layer_status is not 'ok' are never
// fetched, a raster of the wrong size is dropped (nothing drawn, never a misaligned drape), satellite cells with no
// view (253 cloud, 255 no data) set `noView`, the NWS category map is rasterised on the render grid, and opening a
// second flood disposes the first flood's textures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALERTS, DETAIL, GAUGES, SATELLITE } from '../../api/__fixtures__/floods/edgeCases'
import type { FloodManifest } from '../../api/types'
import { useFlood } from '../../state/flood'

const fetched: string[] = []
const buffers = new Map<string, ArrayBuffer>()
const jsons = new Map<string, unknown>()

vi.mock('../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api/client')>()
  return {
    ...real,
    fetchArrayBuffer: vi.fn(async (url: string) => {
      fetched.push(url)
      const key = [...buffers.keys()].find((k) => url.includes(k))
      if (!key) throw new Error(`404 ${url}`)
      return buffers.get(key)!
    }),
    fetchJson: vi.fn(async (url: string) => {
      fetched.push(url)
      const key = [...jsons.keys()].find((k) => url.includes(k))
      if (!key) throw new Error(`404 ${url}`)
      return structuredClone(jsons.get(key))
    }),
  }
})

// the aerial photo goes through THREE.TextureLoader (an <img>): not in node
vi.mock('../../lib/raster', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/raster')>()
  return { ...real, imageTexture: vi.fn(async () => null) }
})

const { floodAssetStore, syncFloodAssets } = await import('./floodAssets')

const N = 8
const u8 = (fill: (i: number) => number, n = N * N) => Uint8Array.from({ length: n }, (_, i) => fill(i)).buffer

/** The fixture manifest shrunk to an 8 x 8 render grid, with a chosen id, build time and layer states. */
function manifest(id: string, built: number, status: Partial<Record<keyof FloodManifest['layer_status'], 'ok' | 'unavailable'>> = {}): FloodManifest {
  const m = DETAIL().manifest!
  const layers = Object.fromEntries(Object.entries(m.layers).map(([k, v]) => [k, { ...v, width: N, height: N }]))
  const ls = { ...m.layer_status }
  for (const [k, v] of Object.entries(status)) ls[k as keyof typeof ls] = { ...ls[k as keyof typeof ls], status: v!, reason: v === 'ok' ? null : 'could not be loaded right now' }
  return { ...m, id, built_ms: built, layers, layer_status: { ...ls, naip: { ...ls.naip, status: 'unavailable' } }, grid: { ...m.grid, render: { ...m.grid.render, width: N, height: N }, fire: { ...m.grid.fire, width: N, height: N } }, summary: { ...m.summary, id } }
}

function serve(id: string, over: { floodplainSize?: number } = {}) {
  const base = `/floods/${id}/files/`
  buffers.set(`${base}layers/elevation.bin`, Float32Array.from({ length: N * N }, (_, i) => 1500 + i).buffer)
  buffers.set(`${base}layers/sky_view.bin`, u8(() => 200))
  buffers.set(`${base}layers/water_forecast.bin`, u8((i) => (i % N < 2 ? 255 : 0)))
  buffers.set(`${base}layers/floodplain.bin`, u8(() => 2, over.floodplainSize ?? N * N))
  buffers.set(`${base}layers/water_model.bin`, u8(() => 255))
  // a cloud cell, a no-data strip, water and land
  buffers.set(`${base}layers/water_satellite.bin`, u8((i) => (i === 0 ? 253 : i % N === N - 1 ? 255 : i % 3 === 0 ? 1 : 0)))
  jsons.set(`${base}warnings.json`, ALERTS())
  jsons.set(`${base}gauges.json`, GAUGES())
  jsons.set(`${base}satellite.json`, SATELLITE())
  jsons.set(`${base}maps/catfim_ZZRF1_moderate.geojson`, {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-108.1, 36.76], [-108.02, 36.76], [-108.02, 36.82], [-108.1, 36.82], [-108.1, 36.76]]] } }],
  })
}

async function open(m: FloodManifest) {
  useFlood.setState({ floodId: m.id, manifest: m, summary: m.summary })
  await syncFloodAssets()
}

beforeEach(() => {
  fetched.length = 0
  buffers.clear()
  jsons.clear()
})

afterEach(async () => {
  useFlood.setState({ floodId: null, manifest: null, summary: null })
  await syncFloodAssets()
})

describe('floodAssets loader (review WFF-R10)', () => {
  it("never fetches a layer whose layer_status is not 'ok', and draws nothing for it", async () => {
    serve('flood-a')
    await open(manifest('flood-a', 1, { water_model: 'unavailable' }))
    const a = floodAssetStore.getState().assets
    expect(floodAssetStore.getState().error).toBeNull()
    expect(a?.flood.has.model).toBe(false)
    expect(a?.flood.arrays.model).toBeNull()
    expect(fetched.some((u) => u.includes('water_model.bin'))).toBe(false)
    expect(fetched.some((u) => u.includes('naip'))).toBe(false)
    // the other layers loaded, with every fire part null and no ignition
    expect(a?.flood.has.forecast).toBe(true)
    expect(a?.manifest.ignition).toBeNull()
    expect(a?.textures.fuel).toBeNull()
    expect(a?.flood.warnings?.kind).toBe('flood_alerts')
  })

  it('drops a raster of the wrong size (never a misaligned drape)', async () => {
    serve('flood-b', { floodplainSize: N * N - 3 })
    await open(manifest('flood-b', 2))
    const a = floodAssetStore.getState().assets
    expect(a).not.toBeNull()
    expect(a?.flood.arrays.floodplain).toBeNull()
    expect(a?.flood.has.floodplain).toBe(false)
    expect(a?.flood.has.forecast).toBe(true)
  })

  it('sets noView from cloud (253) and no-data (255) cells, and rasterises the category map on the render grid', async () => {
    serve('flood-c')
    await open(manifest('flood-c', 3))
    const f = floodAssetStore.getState().assets!.flood
    expect(f.has.satellite).toBe(true)
    expect(f.has.noView).toBe(true)
    expect(f.textures.satWater).not.toBeNull()
    expect(f.catfim).toEqual({ key: 'catfim_ZZRF1_moderate', lid: 'ZZRF1', category: 'moderate' })
    expect(f.arrays.catfim?.length).toBe(N * N)
    expect(f.has.catfim).toBe(true)
    expect(f.textures.pack).not.toBeNull()
  })

  it("opening a second flood disposes the first flood's textures", async () => {
    serve('flood-d')
    await open(manifest('flood-d', 4))
    const first = floodAssetStore.getState().assets!
    const disposed = [first.textures.elevation, first.flood.textures.pack, first.flood.textures.satWater].map((t) => vi.spyOn(t!, 'dispose'))
    serve('flood-e')
    await open(manifest('flood-e', 5))
    expect(floodAssetStore.getState().assets?.manifest.id).toBe('flood-e')
    for (const d of disposed) expect(d).toHaveBeenCalled()
  })

  it('a stale load (the flood changed while it loaded) is disposed, never shown', async () => {
    serve('flood-f')
    serve('flood-g')
    useFlood.setState({ floodId: 'flood-f', manifest: manifest('flood-f', 6), summary: manifest('flood-f', 6).summary })
    const slow = syncFloodAssets()
    useFlood.setState({ floodId: 'flood-g', manifest: manifest('flood-g', 7), summary: manifest('flood-g', 7).summary })
    const fast = syncFloodAssets()
    await Promise.all([slow, fast])
    expect(floodAssetStore.getState().assets?.manifest.id).toBe('flood-g')
  })
})
