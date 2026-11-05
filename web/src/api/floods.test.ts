import { describe, expect, it } from 'vitest'
import { bboxParam, FIRE_ONLY_ENDPOINTS, floodAlertsQuery, floodFileUrl, floodListQuery, floodMapQuery, floodModelQuery, floodSatelliteQuery, riverGaugesQuery } from './floods'
import { LIST } from './__fixtures__/floods/edgeCases'

describe('flood API queries (CONTRACT §16.7)', () => {
  it('lists, detail files and the per-flood routes', () => {
    expect(floodListQuery('live')).toBe('/floods?mode=live')
    expect(floodListQuery(2025)).toBe('/floods?mode=historical&year=2025')
    expect(floodFileUrl('fixture-flood', 'maps/rfc_fim.geojson', 123)).toBe('/api/floods/fixture-flood/files/maps/rfc_fim.geojson?v=123')
    expect(floodMapQuery('fixture-flood', 'catfim', { lid: 'ZZRF1', category: 'major' })).toBe('/floods/fixture-flood/maps?kind=catfim&lid=ZZRF1&category=major')
    expect(floodModelQuery('fixture-flood', 'nwm_series', 'ZZRF1')).toBe('/floods/fixture-flood/model?kind=nwm_series&lid=ZZRF1')
    expect(floodSatelliteQuery('fixture-flood')).toBe('/floods/fixture-flood/satellite')
    expect(floodSatelliteQuery('fixture-flood', 1.6e12)).toBe('/floods/fixture-flood/satellite?at_ms=1600000000000')
  })

  it('official flood answers: one scope each (flood, bbox, lid or national), rounded boxes', () => {
    expect(bboxParam([-108.123456789, 36.7, -107.9, 36.9])).toBe('-108.12346,36.7,-107.9,36.9')
    expect(floodAlertsQuery({ flood: 'fixture-flood' })).toBe('/official/flood-alerts?flood=fixture-flood')
    expect(floodAlertsQuery({ bbox: [-108.1, 36.7, -108, 36.8], atMs: 5 })).toBe('/official/flood-alerts?bbox=-108.1%2C36.7%2C-108%2C36.8&at_ms=5')
    expect(riverGaugesQuery({ national: true, min: 'action' })).toBe('/official/river-gauges?scope=national&min=action')
    expect(riverGaugesQuery({ lid: 'ZZRF1', series: true })).toBe('/official/river-gauges?lid=ZZRF1&series=1')
    expect(riverGaugesQuery({ bbox: [-108.1, 36.7, -108, 36.8] })).toBe('/official/river-gauges?bbox=-108.1%2C36.7%2C-108%2C36.8')
  })

  it('no flood route is a fire-only endpoint', () => {
    const urls = ['/api' + floodListQuery('live'), '/api/floods/fixture-flood', '/api' + floodAlertsQuery({ flood: 'x' }), '/api' + riverGaugesQuery({ national: true })]
    for (const u of urls) expect(FIRE_ONLY_ENDPOINTS.some((re) => re.test(u)), u).toBe(false)
    expect(FIRE_ONLY_ENDPOINTS.some((re) => re.test('/api/incidents/2026-a'))).toBe(true)
    expect(FIRE_ONLY_ENDPOINTS.some((re) => re.test('/api/official/fire-weather?incident=x'))).toBe(true)
  })

  it('the copied fixture list is a flood list (the same shapes the backend validates)', () => {
    const l = LIST()
    expect(l.hazard).toBe('flood')
    expect(l.floods.length).toBeGreaterThan(5)
    expect(l.floods.every((f) => f.synthetic)).toBe(true)
  })
})
