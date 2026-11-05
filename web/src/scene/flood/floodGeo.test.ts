// Pure helpers of the 3D flood scene: rasterising polygons, the drape pack, framing, label anchors, ring clipping, the
// NWS category map choice, and the products drawn at the hydrograph handle (C1, both sides of now).
import { describe, expect, it } from 'vitest'
import type { FloodAlert } from '../../api/types'
import { lonLatToLocal } from '../../lib/reproject'
import { anySet, chooseCatfim, clipRingToBox, FLOODPLAIN_PACK, floodFrameOf, maskAnchor, packFloodLayers, polygonsLocal, productKey, rasterizePolygons, warningsAt } from './floodGeo'

const GRID = { center_e: 762340, center_n: 4075610, utm_zone: 12, extent_m: 12000 }
const H = 3_600_000
const NOW = Date.UTC(2026, 10, 5, 5, 0)

describe('rasterizePolygons', () => {
  it('fills a square by cell centres, keeps a hole empty, and ORs polygons', () => {
    const sq = (x0: number, z0: number, x1: number, z1: number) => Float64Array.from([x0, z0, x1, z0, x1, z1, x0, z1])
    // 10 x 10 grid over 100 m: cells 10 m, centres at -45, -35, ...
    const out = rasterizePolygons([[sq(-50, -50, 0, 0), sq(-40, -40, -20, -20)], [sq(20, 20, 50, 50)]], 10, 10, 100)
    const at = (r: number, c: number) => out[r * 10 + c]
    expect(at(0, 0)).toBe(255) // north-west corner (z -45, x -45)
    expect(at(4, 4)).toBe(255)
    expect(at(1, 1)).toBe(0) // centre (-35, -35): inside the hole (-40..-20)
    expect(at(2, 2)).toBe(0) // (-25, -25): inside the hole
    expect(at(3, 3)).toBe(255) // (-15, -15): inside the outer ring, past the hole
    expect(at(5, 5)).toBe(0)
    expect(at(8, 8)).toBe(255)
    expect(at(9, 0)).toBe(0)
  })

  it('reads GeoJSON polygons in local metres (north is -z)', () => {
    const polys = polygonsLocal({ type: 'Polygon', coordinates: [[[-108.07, 36.78], [-108.05, 36.78], [-108.05, 36.8], [-108.07, 36.8], [-108.07, 36.78]]] }, GRID)
    expect(polys).toHaveLength(1)
    expect(polys[0][0].length).toBe(8) // the closing point is not repeated
    const [, zSouth] = lonLatToLocal(-108.06, 36.78, GRID)
    const [, zNorth] = lonLatToLocal(-108.06, 36.8, GRID)
    expect(zNorth).toBeLessThan(zSouth)
    expect(polygonsLocal({ type: 'Point', coordinates: [0, 0] }, GRID)).toEqual([])
  })
})

describe('packFloodLayers', () => {
  it('packs forecast, floodplain codes, model and category map into RGBA', () => {
    const p = packFloodLayers(4, { forecast: new Uint8Array([0, 255, 0, 255]), floodplain: new Uint8Array([0, 1, 2, 3]), model: new Uint8Array([255, 0, 0, 0]), catfim: null })
    expect(Array.from(p.subarray(0, 4))).toEqual([0, 0, 255, 0])
    expect(Array.from(p.subarray(4, 8))).toEqual([255, FLOODPLAIN_PACK[1], 0, 0])
    expect(p[8 + 1]).toBe(FLOODPLAIN_PACK[2])
    expect(p[12 + 1]).toBe(255)
    // a layer of the wrong size is left out, never misread
    expect(Array.from(packFloodLayers(2, { forecast: new Uint8Array(3).fill(255) }))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(anySet(new Uint8Array([0, 100]))).toBe(false)
    expect(anySet(new Uint8Array([0, 200]))).toBe(true)
  })
})

describe('floodFrameOf', () => {
  it('frames the flood bbox inside the bundle area, at least 2 km across', () => {
    const f = floodFrameOf({ bbox_lonlat: [-108.12, 36.75, -108.0, 36.83], lat: 36.79, lon: -108.06 }, GRID)
    expect(f.minX).toBeGreaterThanOrEqual(-6000)
    expect(f.maxX).toBeLessThanOrEqual(6000)
    expect(f.maxX - f.minX).toBeGreaterThan(5000)
    const tiny = floodFrameOf({ bbox_lonlat: [-108.06, 36.79, -108.06, 36.79], lat: 36.79, lon: -108.06 }, GRID)
    expect(tiny.maxX - tiny.minX).toBeGreaterThanOrEqual(1999)
    expect(tiny.maxZ - tiny.minZ).toBeGreaterThanOrEqual(1999)
  })
})

describe('maskAnchor', () => {
  it('hangs a label on a set cell, near the centroid', () => {
    const m = new Uint8Array(100)
    m[5 * 10 + 7] = 255
    m[5 * 10 + 8] = 255
    const a = maskAnchor(m, 10, 10, 100)!
    expect(a[1]).toBeCloseTo(5) // row 5 centre: -50 + 55
    expect([25, 35]).toContain(Math.round(a[0]))
    expect(maskAnchor(new Uint8Array(100), 10, 10, 100)).toBeNull()
  })
})

describe('clipRingToBox', () => {
  it('keeps a ring wholly inside as one closed run', () => {
    const r = Float64Array.from([-1, -1, 1, -1, 1, 1, -1, 1])
    const out = clipRingToBox(r, 10)
    expect(out).toHaveLength(1)
    expect(out[0].length).toBe(10) // 4 points + back to the start
  })

  it('never draws along the box edge: the parts outside are dropped', () => {
    const r = Float64Array.from([-5, -5, 20, -5, 20, 5, -5, 5])
    const out = clipRingToBox(r, 10)
    for (const part of out) for (let i = 0; i < part.length; i += 2) expect(Math.abs(part[i])).toBeLessThanOrEqual(10 + 1e-9)
    // the right side (x = 20) is outside: no point has x = 10 except where the edges cross the box
    const xs = out.flatMap((p) => Array.from(p).filter((_, i) => i % 2 === 0))
    expect(xs.filter((x) => Math.abs(x - 10) < 1e-9)).toHaveLength(2)
    expect(clipRingToBox(Float64Array.from([20, 20, 30, 20, 30, 30]), 10)).toEqual([])
  })
})

describe('chooseCatfim', () => {
  const maps = { rfc_fim: 'maps/rfc_fim.geojson', catfim_ZZRF1_moderate: 'm', catfim_ZZRF1_major: 'M', nfhl: 'n' }
  it("takes the primary gauge's NWS forecast category, else its observed one, else the highest", () => {
    expect(chooseCatfim(maps, { lid: 'ZZRF1', forecast_category: 'major', observed_category: 'moderate' })?.key).toBe('catfim_ZZRF1_major')
    expect(chooseCatfim(maps, { lid: 'ZZRF1', forecast_category: 'minor', observed_category: 'moderate' })?.key).toBe('catfim_ZZRF1_moderate')
    expect(chooseCatfim(maps, null)?.category).toBe('major')
    expect(chooseCatfim({ rfc_fim: 'x' }, null)).toBeNull()
  })
})

function alert(over: Partial<FloodAlert>): FloodAlert {
  return {
    id: 'a',
    url: null,
    office_url: null,
    event: 'Flood Warning',
    vtec: { office: 'KZZZ', phenomena: 'FL', significance: 'W', etn: 1, action: 'NEW', year: 2026 },
    hvtec: null,
    sender_name: 'NWS Example Office (synthetic)',
    sent_ms: NOW - 10 * H,
    effective_ms: NOW - 10 * H,
    onset_ms: NOW - 10 * H,
    expires_ms: NOW + 2 * H,
    ends_ms: NOW + 2 * H,
    headline: null,
    nws_headline: null,
    description: null,
    instruction: null,
    area_desc: null,
    ugcs: [],
    message_type: 'Alert',
    status: 'Actual',
    phase: 'in_effect',
    archived: false,
    time_zone: 'America/Denver',
    emergency: false,
    damage_threat: null,
    detection: null,
    geometry: null,
    covers_point: null,
    flood_ids: [],
    ...over,
  }
}

describe('warningsAt (C1: the warning lines at the hydrograph handle)', () => {
  const v1 = alert({ id: 'v1' })
  const v2 = alert({ id: 'v2', vtec: { ...v1.vtec!, action: 'EXT' }, sent_ms: NOW - 2 * H, ends_ms: NOW + 8 * H, expires_ms: NOW + 8 * H })
  const watch = alert({ id: 'w', event: 'Flood Watch', vtec: { office: 'KZZZ', phenomena: 'FA', significance: 'A', etn: 2, action: 'NEW', year: 2026 }, ends_ms: NOW + 1 * H, expires_ms: NOW + 1 * H })

  it('draws one version per product: the newest sent at the handle', () => {
    expect(productKey(v1)).toBe('KZZZ.FL.W.0001.2026')
    expect(warningsAt([v1, v2], null, NOW).alerts.map((a) => a.id)).toEqual(['v2'])
    // 5 h ago the extension had not been sent: the first version
    expect(warningsAt([v1, v2], NOW - 5 * H, NOW).alerts.map((a) => a.id)).toEqual(['v1'])
    // 11 h ago nothing had been sent
    expect(warningsAt([v1, v2], NOW - 11 * H, NOW).alerts).toEqual([])
  })

  it('after now keeps the products in effect now (and says so), even past their end', () => {
    const r = warningsAt([v1, v2, watch], NOW + 30 * H, NOW)
    expect(r.future).toBe(true)
    expect(r.alerts.map((a) => a.id).sort()).toEqual(['v2', 'w'])
    expect(warningsAt([v1, v2, watch], NOW, NOW).future).toBe(false)
  })

  it('a product NWS ended is not drawn now', () => {
    const can = alert({ id: 'c', vtec: { ...v1.vtec!, action: 'CAN' }, sent_ms: NOW - 1 * H, phase: 'ended' })
    expect(warningsAt([v1, v2, can], null, NOW).alerts).toEqual([])
  })
})
