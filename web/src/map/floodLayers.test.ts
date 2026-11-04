import { describe, expect, it } from 'vitest'
import { LIST, PAST_FLOOD } from '../api/__fixtures__/floods/edgeCases'
import { FLOOD_PALETTE } from './floodStyle'
import { diamondImage, DIAMOND_IMAGE, FLOOD_GAUGE_SOURCE, FLOOD_OVR, FLOOD_SOURCES, floodFeatures, floodMarkerLayers, floodOverviewData, floodSourceOptions, gaugeFeatures, gaugeLayers, splitFloods } from './floodLayers'
import { MARKER_PX, overviewLayers } from './overviewLayers'

const props = (fc: { features: { properties: Record<string, unknown> }[] }) => fc.features.map((f) => f.properties)

describe('flood markers (PLAN-5 §4.3)', () => {
  it('splits by marker kind: large pinned, active and small grouped, watches and past floods apart', () => {
    const s = splitFloods([...LIST().floods, PAST_FLOOD()])
    expect(s.pinned.map((f) => f.id).sort()).toEqual(['fixture-flood', 'fixture-flood-flash', 'fixture-flood-major', 'fixture-flood-moderate'].sort())
    expect(s.active.map((f) => f.id).sort()).toEqual(['fixture-flood-advisory', 'fixture-flood-minor'])
    expect(s.other.map((f) => f.id).sort()).toEqual(['fixture-flood-past', 'fixture-flood-watch'])
    expect(splitFloods(LIST().floods, ['fixture-flood']).pinned.some((f) => f.id === 'fixture-flood')).toBe(false)
  })

  it('features carry the properties the fire spec builder and the leader overlay read; DEMO in labels', () => {
    const p = props(floodFeatures(LIST().floods, 'us'))
    const major = p.find((x) => x.id === 'fixture-flood-major')!
    expect(major).toMatchObject({ kind: 'large', r: MARKER_PX.large, label: 'Sample River flood · DEMO', meta: 'MAJOR · 24.3 FT', dot_color: '#c766ff', synthetic: true, lz: 0 })
    expect(Number(major.rank)).toBeGreaterThan(400)
    const watch = p.find((x) => x.id === 'fixture-flood-watch')!
    expect(watch).toMatchObject({ kind: 'other', r: MARKER_PX.other, live: false, dot: 0 })
    for (const x of p) expect(String(x.label)).toMatch(/· DEMO$/)
    const d = floodOverviewData(splitFloods(LIST().floods), 'us')
    expect(d.pinned.features.length + d.active.features.length + d.other.features.length).toBe(LIST().floods.length)
  })

  it('layers: the fire builder with fx-flood ids, " FLOODS", max_rank groups, a per-flood dot colour and no chips', () => {
    const layers = floodMarkerLayers('dark')
    expect(layers.every((l) => l.id.startsWith('fx-flood-overview-'))).toBe(true)
    expect(layers.some((l) => /chip/.test(l.id))).toBe(false)
    const count = layers.find((l) => l.id === FLOOD_OVR.activeCount) as unknown as { layout: Record<string, unknown> }
    expect(JSON.stringify(count.layout['text-field'])).toContain(' FLOODS')
    const dot = layers.find((l) => l.id === FLOOD_OVR.pinnedDot) as unknown as { paint: Record<string, unknown> }
    expect(dot.paint['circle-color']).toEqual(['coalesce', ['get', 'dot_color'], FLOOD_PALETTE.dark.dot])
    const sources = new Set(layers.map((l) => (l as { source?: string }).source))
    expect([...sources].sort()).toEqual(Object.values(FLOOD_SOURCES).sort())
    expect(floodSourceOptions('active', 1200)).toMatchObject({ cluster: true, clusterProperties: { max_rank: ['max', ['get', 'rank']] } })
    expect(floodSourceOptions('pinned', 1200)).not.toHaveProperty('cluster')
  })

  it('the fire builder keeps its defaults (fire ids, " FIRES", max_acres, chips)', () => {
    const fire = overviewLayers('dark')
    expect(fire.every((l) => l.id.startsWith('fx-overview-'))).toBe(true)
    expect(fire.some((l) => /chip/.test(l.id))).toBe(true)
    expect(JSON.stringify(fire)).toContain(' FIRES')
    expect(JSON.stringify(fire)).not.toContain('FLOODS')
  })
})

describe('river gauges (diamonds, never green)', () => {
  const gauges = LIST().floods.flatMap((f) => f.gauges.map((g) => ({ ...g })))
  it('national map: action stage or above; inside a flood view every status', () => {
    const p = props(gaugeFeatures(gauges, 'us'))
    expect(p.every((x) => ['action', 'minor', 'moderate', 'major'].includes(String(x.tone)))).toBe(true)
    const below = { lid: 'X1', name: 'X River at Y', lat: 36, lon: -108, observed_category: 'no_flooding' as const, observed_value: 1, unit: 'ft' }
    expect(gaugeFeatures([below], 'us').features).toHaveLength(0)
    expect(props(gaugeFeatures([below], 'us', 0))[0]).toMatchObject({ tone: 'below', icon: DIAMOND_IMAGE.below })
  })

  it('diamond images: opaque centre in the category colour, transparent corners; "below" hollow', () => {
    for (const tone of ['action', 'minor', 'moderate', 'major', 'undefined'] as const) {
      const { image } = diamondImage(tone)
      const c = Math.floor(image.width / 2)
      const i = (c * image.width + c) * 4
      expect(image.data[i + 3], tone).toBeGreaterThan(200)
      expect(image.data[3], tone).toBe(0) // the corner
    }
    const hollow = diamondImage('below').image
    const c = Math.floor(hollow.width / 2)
    expect(hollow.data[(c * hollow.width + c) * 4 + 3]).toBe(0)
  })

  it('gauge layers draw from z5 on the gauge source', () => {
    const l = gaugeLayers('dark') as unknown as { source: string; minzoom: number }[]
    expect(l.every((x) => x.source === FLOOD_GAUGE_SOURCE && x.minzoom >= 5)).toBe(true)
  })
})
