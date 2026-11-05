// The flood views' area layers (brief 5, PLAN-5 §4.4 map layers; D16, D25, C1, C2; brief 6: at the chart's handle).
import { describe, expect, it } from 'vitest'
import { ALERTS, FIXTURE_NOW_MS, RFC_FIM, RFC_FIM_UNAVAILABLE, SATELLITE, SATELLITE_PICTURE_ONLY, SATELLITE_UNAVAILABLE } from '../api/__fixtures__/floods/edgeCases'
import nfhl from '../api/__fixtures__/floods/maps-nfhl.json'
import type { FloodMapResponse } from '../api/types'
import { productsAt } from '../official/floodModel'
import { SQUARE, testPass, testTimeline, versionBuilder } from '../state/floodTimeline.testutil'
import { fmtDayDate } from '../lib/time'
import { checkPoint } from '../location/floodCheck'
import { handleFor, isPublicView } from '../state/floodTimelineData'
import { ARCHIVED_COPY, NOTHING_COVERS } from '../ui/shell/floodCopy'
import {
  archiveCreditAtHandle,
  AREA_LAYER_KEY,
  fimHatchImage,
  FLOOD_AREA_LAYERS,
  floodAreaLayers,
  imageCorners,
  mapFeatures,
  nfhlFeatures,
  nfhlStippleImage,
  productsAtHandle,
  satelliteAtHandle,
  satelliteEdge,
  satelliteImage,
  warningFeatures,
  warningsAtHandle,
} from './floodAreaLayers'

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

// brief 6 (web-flood-playback M3): the satellite image and the warning areas follow the chart's handle
describe('flood area layers at the handle (brief 6)', () => {
  const NOW = FIXTURE_NOW_MS
  const version = versionBuilder(NOW)
  const before = testPass('DSWx-HLS_20261026T1800_L8', NOW - 9 * 24 * H, 'clear')
  const cloud = testPass('DSWx-HLS_20261028T1800_S2A', NOW - 7 * 24 * H, 'no_view')
  const partly = testPass('DSWx-HLS_20261102T1800_L9', NOW - 2 * 24 * H, 'partly_hidden', { caveat: 'Water seen by satellite (NASA OPERA), Nov 2. … dry pixels do not mean no flooding.' })
  const w1 = version('w1', 'KABQ.FL.W.0019', 'NEW', NOW - 30 * H, NOW - 20 * H, { replaced_ms: NOW - 20 * H })
  const w2 = version('w2', 'KABQ.FL.W.0019', 'EXT', NOW - 20 * H, null, { geometry: SQUARE(0.4) as never })
  const zoned = version('z1', 'KABQ.FA.Y.0007', 'NEW', NOW - 25 * H, NOW - 22 * H, { geometry: null, ugcs: ['NMZ501'] })
  const tl = testTimeline(NOW, [before, cloud, partly], [w1, zoned, w2], 'fixture-flood')
  tl.products.zones = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: SQUARE(1) as never, properties: { ugc: 'NMZ501', name: 'Zone', alert_ids: ['z1'] } }] }

  it('at now (and after now) the satellite route’s own answer, as in brief 5', () => {
    const sat = SATELLITE()
    expect(satelliteAtHandle(sat, tl, null, NOW)).toBe(sat)
    expect(satelliteAtHandle(sat, tl, NOW + 5 * H, NOW)).toBe(sat)
    expect(satelliteAtHandle(sat, null, NOW - 3 * 24 * H, NOW)).toBe(sat)
  })

  it('before now the pass at or before the handle: its own image, date and caveat; never a no-view pass', () => {
    const at = satelliteAtHandle(SATELLITE(), tl, NOW - 6 * 24 * H, NOW)!
    expect(at.measured).toBe(true)
    expect(at.image?.url).toBe(before.image!.url)
    expect(at.granules[0].acquired_ms).toBe(before.acquired_ms)
    expect(satelliteImage(at)?.url).toBe(before.image!.url)
    expect(satelliteEdge(at).features).toHaveLength(1)
    const p = satelliteAtHandle(SATELLITE(), tl, partly.acquired_ms, NOW)!
    expect(p.image?.url).toBe(partly.image!.url)
    expect(p.caveats).toEqual([partly.caveat])
    // exactly at the no-view pass: still the earlier image (with its own date)
    expect(satelliteAtHandle(SATELLITE(), tl, cloud.acquired_ms, NOW)!.granules[0].acquired_ms).toBe(before.acquired_ms)
  })

  it('before the first pass: no image, and the layer says so (never an all-clear)', () => {
    const none = satelliteAtHandle(SATELLITE(), tl, NOW - 12 * 24 * H, NOW)!
    expect(none.image).toBeNull()
    expect(satelliteImage(none)).toBeNull()
    expect(satelliteEdge(none).features).toHaveLength(0)
    expect(none.reason).toMatch(/not an all-clear/)
  })

  it('warning areas: before now the versions shown at the handle (zone-based from the timeline’s zones); at now the live answer', () => {
    const at = (t: number | null) => warningsAtHandle(ALERTS(), productsAt(ALERTS().alerts, null, NOW).alerts, tl, t, NOW).features.map((f) => (f.properties as { id: string }).id).sort()
    expect(at(NOW - 26 * H)).toEqual(['w1'])
    expect(at(NOW - 24 * H)).toEqual(['w1', 'z1'])
    expect(at(NOW - 10 * H)).toEqual(['w2'])
    // at now: brief 5's rule on the live answer (its own ids)
    expect(at(null)).toEqual(warningFeatures(productsAt(ALERTS().alerts, null, NOW).alerts, ALERTS().zones).features.map((f) => (f.properties as { id: string }).id).sort())
  })
})

describe('the Public view and the point checks at the handle (review WFP-R1, WFP-R2, WFP-R3)', () => {
  const NOW = FIXTURE_NOW_MS
  const version = versionBuilder(NOW)
  const SPOT: [number, number] = [-81.4, 29.7]
  const pass = testPass('DSWx-HLS_20261025T1644_L8', NOW - 11 * 24 * H, 'clear')
  // the IEM archive's copy of the warning (drawn from its issue until NWS's next version), then NWS's live EXT whose
  // own start is later (Calcasieu, Nov 4-5): only the archived version covers the spot between the two
  const neu = version('n1', 'KLCH.FL.W.0042', 'NEW', NOW - 30 * H, NOW - 20 * H, { replaced_ms: NOW - 20 * H, ends_ms: NOW + 30 * H, phase: 'in_effect', sender_name: 'NWS Lake Charles LA' })
  const ext = version('e1', 'KLCH.FL.W.0042', 'EXT', NOW - 20 * H, null, { onset_ms: NOW + 2 * H, effective_ms: NOW + 2 * H, ends_ms: NOW + 30 * H, archived: false, phase: 'upcoming' })
  const tl = testTimeline(NOW, [pass], [neu, ext], 'fixture-flood')
  tl.products.archive_source = { name: 'NWS products, archived copy: Iowa Environmental Mesonet', url: 'https://mesonet.agron.iastate.edu/vtec/', credit: 'NWS products (archived copies): Iowa Environmental Mesonet, Iowa State University', terms_url: 'https://mesonet.agron.iastate.edu/disclaimer.php' }
  const live = { ...ALERTS(), alerts: [ext], zones: { type: 'FeatureCollection' as const, features: [] } }
  const PAST = NOW - 26 * H

  it('Public has no time handle: a past handle left by Command or Forensic draws now (the route’s image, the live products)', () => {
    const pub = handleFor(isPublicView({ workspace: 'map', preset: 'public' }), PAST)
    expect(pub).toBeNull()
    const sat = SATELLITE()
    expect(satelliteAtHandle(sat, tl, pub, NOW)).toBe(sat)
    const ids = (t: number | null) => warningsAtHandle(live, live.alerts, tl, t, NOW).features.map((f) => (f.properties as { id: string }).id)
    expect(ids(pub)).toEqual(ids(null))
    expect(ids(pub)).toEqual(['e1'])
    // Command and Forensic (even with the Public preset kept) follow the handle
    expect(handleFor(isPublicView({ workspace: 'map', preset: 'command' }), PAST)).toBe(PAST)
    expect(handleFor(isPublicView({ workspace: 'forensic', preset: 'public' }), PAST)).toBe(PAST)
    expect(ids(PAST)).toEqual(['n1'])
  })

  const check = (cursorMs: number | null) => {
    const shown = productsAtHandle(live, live.alerts, tl, cursorMs, NOW)
    return checkPoint({
      point: SPOT,
      alerts: shown.alerts,
      shown,
      alertsStatus: 'available',
      zones: shown.zones,
      fim: null,
      satellite: satelliteAtHandle(SATELLITE(), tl, cursorMs, NOW),
      satClass: 0,
      nfhl: null,
      model: null,
      gauges: [],
      rivers: [],
      cursorMs,
      nowMs: NOW,
    })
  }

  it('a past step: the archived version the map draws covers the spot, so the check says so (never "no mapped flood layer")', () => {
    const c = check(PAST)
    const inside = c.lines.find((l) => l.inside && l.kind === 'official')
    expect(inside?.event).toBe('Flood Warning')
    expect(inside?.text).toMatch(/^Inside the NWS Flood Warning area \(until /)
    expect(c.lines.some((l) => l.text === NOTHING_COVERS)).toBe(false)
    // the satellite line names the pass the map shows at that step, with its own date
    const sat = c.lines.find((l) => l.kind === 'satellite')!
    expect(sat.text).toContain(fmtDayDate(pass.acquired_ms, 'UTC'))
    expect(sat.text).not.toContain(fmtDayDate(SATELLITE().granules[0].acquired_ms, 'UTC'))
  })

  it('at now the live answer: the EXT still to start says so with its own start', () => {
    const c = check(null)
    const inside = c.lines.find((l) => l.inside && l.kind === 'official')
    expect(inside?.text).toMatch(/starting/i)
  })

  it('the IEM archive is credited only while one of its copies is drawn at the handle (review WFP-R3)', () => {
    const past = productsAtHandle(live, live.alerts, tl, PAST, NOW)
    expect(past.source).toBe('timeline')
    expect(archiveCreditAtHandle(past, tl)).toEqual({ text: tl.products.archive_source!.credit, href: 'https://mesonet.agron.iastate.edu/disclaimer.php' })
    expect(archiveCreditAtHandle(productsAtHandle(live, live.alerts, tl, NOW - 10 * H, NOW), tl)).toBeNull()
    expect(archiveCreditAtHandle(productsAtHandle(live, live.alerts, tl, null, NOW), tl)).toBeNull()
    // without the backend's source the tag's own words still name the archive
    expect(archiveCreditAtHandle(past, { ...tl, products: { ...tl.products, archive_source: null } })?.text).toBe(ARCHIVED_COPY)
  })
})
