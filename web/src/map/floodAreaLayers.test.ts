// The flood views' area layers (brief 5, PLAN-5 §4.4 map layers; D16, D25, C1, C2).
import { describe, expect, it } from 'vitest'
import { ALERTS, FIXTURE_NOW_MS, RFC_FIM, RFC_FIM_UNAVAILABLE, SATELLITE, SATELLITE_PICTURE_ONLY, SATELLITE_UNAVAILABLE } from '../api/__fixtures__/floods/edgeCases'
import nfhl from '../api/__fixtures__/floods/maps-nfhl.json'
import type { FloodMapResponse } from '../api/types'
import { productsAt } from '../official/floodModel'
import { AREA_LAYER_KEY, fimHatchImage, FLOOD_AREA_LAYERS, floodAreaLayers, imageCorners, mapFeatures, nfhlFeatures, nfhlStippleImage, satelliteEdge, satelliteImage, warningFeatures } from './floodAreaLayers'

const H = 3_600_000

describe('flood area layers', () => {
  it('every id is fx-flood-*, every layer follows a Layers toggle, no model and no CatFIM layer here (Public)', () => {
    for (const l of floodAreaLayers()) {
      expect(l.id.startsWith('fx-flood-')).toBe(true)
      expect(AREA_LAYER_KEY[l.id]).toBeTruthy()
    }
    expect(floodAreaLayers().some((l) => /model|catfim|nwm/i.test(l.id))).toBe(false)
  })
  it('the satellite image: a measured image with its own bounds (top left first); none for the picture or an outage', () => {
    const img = satelliteImage(SATELLITE())!
    expect(img.url).toMatch(/^\/api\/floods\/fixture-flood\/satellite\.png\?granule=/)
    const [w, s, e, n] = SATELLITE().image!.bounds_lonlat
    expect(imageCorners(img.bounds)).toEqual([
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ])
    expect(satelliteImage(SATELLITE_PICTURE_ONLY())).toBeNull()
    expect(satelliteImage(SATELLITE_UNAVAILABLE())).toBeNull()
  })
  it("the image's edge is drawn as a closed line (C2)", () => {
    const fc = satelliteEdge(SATELLITE())
    expect(fc.features).toHaveLength(1)
    const c = (fc.features[0].geometry as { coordinates: number[][] }).coordinates
    expect(c[0]).toEqual(c[c.length - 1])
    expect(satelliteEdge(SATELLITE_UNAVAILABLE()).features).toHaveLength(0)
  })
  it('warning areas: the products in effect at the handle (C1), polygons and zone outlines', () => {
    const a = ALERTS()
    const now = productsAt(a.alerts, null, FIXTURE_NOW_MS).alerts
    const fc = warningFeatures(now, a.zones)
    expect(fc.features.length).toBeGreaterThan(0)
    expect(fc.features.some((f) => f.properties?.event === 'Flood Warning')).toBe(true)
    // a handle 30 h after now keeps the warning (it ends 8 h after now)
    const later = productsAt(a.alerts, FIXTURE_NOW_MS + 30 * H, FIXTURE_NOW_MS).alerts
    expect(warningFeatures(later, a.zones).features.some((f) => f.properties?.event === 'Flood Warning')).toBe(true)
  })
  it('the forecast area only from an available answer', () => {
    expect(mapFeatures(RFC_FIM()).features.length).toBeGreaterThan(0)
    expect(mapFeatures(RFC_FIM_UNAVAILABLE()).features).toHaveLength(0)
  })
  it('FEMA: floodway, 1 % and 0.2 % bands only, never the "minimal flood hazard" zone X (D16)', () => {
    const fc = nfhlFeatures(nfhl as unknown as FloodMapResponse)
    expect(fc.features.map((f) => f.properties?.band)).toEqual(['floodway', 'sfha', 'band'])
    const minimal = { ...(nfhl as unknown as FloodMapResponse) }
    minimal.features = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: minimal.features.features[0].geometry, properties: { fld_zone: 'X', zone_subty: 'AREA OF MINIMAL FLOOD HAZARD', sfha: 'F' } }] }
    expect(nfhlFeatures(minimal).features).toHaveLength(0)
  })
  it('pattern images are RGBA of their size; no green pixels', () => {
    for (const img of [fimHatchImage(), nfhlStippleImage()]) {
      const { width, height, data } = img.image
      expect(data.length).toBe(width * height * 4)
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) expect(data[i + 1] > data[i] + 30 && data[i + 1] > data[i + 2] + 30).toBe(false)
    }
  })
  it('the satellite image is the lowest area layer; warning lines are above the forecast area', () => {
    const ids = floodAreaLayers().map((l) => l.id)
    expect(ids[0]).toBe(FLOOD_AREA_LAYERS.satellite)
    expect(ids.indexOf(FLOOD_AREA_LAYERS.warningsLine)).toBeGreaterThan(ids.indexOf(FLOOD_AREA_LAYERS.forecastFill))
  })
})
