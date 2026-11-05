// The flood views' area layers (brief 5, PLAN-5 §4.4 "Map layers", §4.9, D8, D21, D25, C1, C2; CONTRACT §16.11). Pure:
// sources, layer specs, features and pattern images, tested in floodAreaLayers.test.ts; map/floodController.ts puts
// them on the map and keeps them in step with the open flood's official answers (official/floodHooks.ts).
//   satellite     the backend's measured water PNG (water #2a8ce6, partial water lighter, clouds and no data the same
//                 grey "no view" hatch, never transparent; D25) as an image source on its own lon/lat bounds, and the
//                 image's edge as a thin dashed grey line ("Edge of the satellite image")
//   floodplain    FEMA's 1% floodplain (SFHA, floodway) and the 0.2 % band: a faint stipple and outline (background; a
//                 Layers toggle, off by default, D21)
//   channel       the main channel: the basemap's own OpenStreetMap water and rivers (the vector tiles' `water` and
//                 `waterway` layers) drawn #103f8a at .55 with a dashed #4fb4ff .5 edge (on every basemap, aerial too)
//   forecast      the NWS forecast flooded area (5-day maximum, experimental): a water-blue hatch with a light edge
//   warnings      the NWS products in effect (productsAt, C1): pink outlines with a faint pink fill; zone-based
//                 products drawn from their zones
// Brief 6 (web-flood-playback M3; BRIEF-6 decision 2): both follow the river-level chart's handle through the flood's
// time history (GET /api/floods/{id}/timeline; state/floodTimeline.ts). satelliteAtHandle: before now, the latest usable
// pass at or before the handle, as a satellite answer of its own (its own image, date, caveat and credit; the same
// palette and no-view hatch); before the first pass no image (said, never an all-clear); at and after now the satellite
// route's own answer, as in brief 5. Never a blend of two passes. warningsAtHandle: before now the NWS versions shown
// at the handle (from their issue time until their end or next version, archived ones included; zone-based versions
// from the timeline's zones); at and after now brief 5's productsShown on the live answer.
// Ids start with fx-flood- (never a fire id). Never the model and never NWS category maps in Public (floodProfile.ts).
import type { LayerSpecification } from 'maplibre-gl'
import type { FloodAlert, FloodAlertsResponse, FloodMapResponse, FloodTimelineResponse, SatelliteWaterResponse } from '../api/types'
import { passAt, passesOf, productsAt, STEP_EPS_MS } from '../state/floodTimeline'
import { PLAYBACK } from '../ui/timeline/floodPlaybackCopy'
import { VECTOR_SOURCE } from './basemapStyle'
import { FLOOD_ALERT, FLOOD_AREA, FLOOD_TOKENS } from './floodStyle'
import type { Feature, FeatureCollection, Geometry } from './overlayModel'

export const FLOOD_AREA_SOURCES = {
  satellite: 'fx-flood-sat-image',
  satelliteTiles: 'fx-flood-sat-tiles',
  satelliteEdge: 'fx-flood-sat-edge',
  floodplain: 'fx-flood-nfhl',
  forecast: 'fx-flood-fim',
  warnings: 'fx-flood-warnings',
} as const

export const FLOOD_AREA_LAYERS = {
  satellite: 'fx-flood-sat-image',
  satelliteTiles: 'fx-flood-sat-tiles',
  satelliteEdge: 'fx-flood-sat-edge-line',
  floodplainFill: 'fx-flood-nfhl-fill',
  floodplainLine: 'fx-flood-nfhl-line',
  channelFill: 'fx-flood-channel-fill',
  channelLine: 'fx-flood-channel-line',
  channelRiver: 'fx-flood-channel-river',
  forecastFill: 'fx-flood-fim-fill',
  forecastHatch: 'fx-flood-fim-hatch',
  forecastLine: 'fx-flood-fim-line',
  warningsFill: 'fx-flood-warn-fill',
  warningsLine: 'fx-flood-warn-line',
} as const

/** Which store toggle each area layer follows (useFlood.layers; floodProfile.ts decides per view). */
export const AREA_LAYER_KEY: Record<string, 'satellite' | 'floodplain' | 'channel' | 'forecastArea' | 'warnings'> = {
  [FLOOD_AREA_LAYERS.satellite]: 'satellite',
  [FLOOD_AREA_LAYERS.satelliteTiles]: 'satellite',
  [FLOOD_AREA_LAYERS.satelliteEdge]: 'satellite',
  [FLOOD_AREA_LAYERS.floodplainFill]: 'floodplain',
  [FLOOD_AREA_LAYERS.floodplainLine]: 'floodplain',
  [FLOOD_AREA_LAYERS.channelFill]: 'channel',
  [FLOOD_AREA_LAYERS.channelLine]: 'channel',
  [FLOOD_AREA_LAYERS.channelRiver]: 'channel',
  [FLOOD_AREA_LAYERS.forecastFill]: 'forecastArea',
  [FLOOD_AREA_LAYERS.forecastHatch]: 'forecastArea',
  [FLOOD_AREA_LAYERS.forecastLine]: 'forecastArea',
  [FLOOD_AREA_LAYERS.warningsFill]: 'warnings',
  [FLOOD_AREA_LAYERS.warningsLine]: 'warnings',
}

export const FIM_HATCH_IMAGE = 'fx-flood-fim-hatch'
export const NFHL_STIPPLE_IMAGE = 'fx-flood-nfhl-stipple'

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** The satellite image's corners for a MapLibre image source (top left, top right, bottom right, bottom left). */
export function imageCorners(b: readonly [number, number, number, number]): [[number, number], [number, number], [number, number], [number, number]] {
  const [w, s, e, n] = b
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ]
}

/** The satellite image to draw (a measured image with bounds), else null. */
export function satelliteImage(sat: SatelliteWaterResponse | null | undefined): { url: string; bounds: [number, number, number, number] } | null {
  if (!sat || sat.status !== 'available' || !sat.measured || !sat.image) return null
  const b = sat.image.bounds_lonlat
  if (!b || b.length !== 4 || !b.every(Number.isFinite) || b[0] >= b[2] || b[1] >= b[3]) return null
  return { url: sat.image.url, bounds: [b[0], b[1], b[2], b[3]] }
}

/** Draw NASA's picture (GIBS tiles) when there is no measured image? Off: its own colour map (clouds and snow in
 *  bright colours) reads like a hazard map; the key and the point card say there is no usable image instead (below the
 *  role's cut line: the integration decides how to draw it). */
export const DRAW_SAT_PICTURE = false

/** NASA's picture (GIBS tiles) when no measured image is shown: "NASA picture, {date} (not measured here)". */
export function satelliteTiles(sat: SatelliteWaterResponse | null | undefined): { template: string; maxZoom: number } | null {
  if (!sat || sat.status !== 'available' || sat.measured || !sat.tiles) return null
  const t = sat.tiles.url_template
  if (!/^https:\/\/gibs\.earthdata\.nasa\.gov\//.test(t)) return null
  return { template: t, maxZoom: Number.isFinite(sat.tiles.max_zoom) ? sat.tiles.max_zoom : 12 }
}

/** The image's edge as a closed line ("Edge of the satellite image", C2). */
export function satelliteEdge(sat: SatelliteWaterResponse | null | undefined): FeatureCollection {
  const img = satelliteImage(sat)
  if (!img) return EMPTY
  const c = imageCorners(img.bounds)
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [...c, c[0]] }, properties: {} }] }
}

/** The handle is on a time before now (the time history applies); null and now or later: the views' now. */
const beforeNow = (cursorMs: number | null, nowMs: number): cursorMs is number => cursorMs != null && Number.isFinite(cursorMs) && cursorMs < nowMs - STEP_EPS_MS

/** The satellite answer the 2D views show at the handle (brief 6; module docstring): `base` (the satellite route's
 *  answer) at and after now or without the timeline's passes; before now the pass at or before the handle as its own
 *  measured answer, or, before the first usable pass, an answer with no image that says so. */
export function satelliteAtHandle(
  base: SatelliteWaterResponse | null | undefined,
  tl: FloodTimelineResponse | null | undefined,
  cursorMs: number | null,
  nowMs: number,
): SatelliteWaterResponse | null {
  const block = tl?.passes
  if (!beforeNow(cursorMs, nowMs) || !block || block.status !== 'available' || !block.passes?.length) return base ?? null
  const at = passAt(passesOf(tl), cursorMs)
  const p = at.pass
  const credit = (block.sources ?? []).find((s) => p != null && s.name.includes(p.product)) ?? block.source
  const common = {
    kind: 'satellite_water' as const,
    status: 'available' as const,
    reason_code: null,
    login: block.login,
    login_note: block.login_note,
    tiles: null,
    source: credit,
    retrieved_ms: block.retrieved_ms,
    now_ms: nowMs,
    flood_id: tl?.flood_id ?? base?.flood_id ?? null,
    synthetic: tl?.synthetic === true || base?.synthetic === true,
  }
  if (!p || !p.image) {
    // nothing seen at or before the handle: no image, and the layer says so (never an all-clear)
    return { ...common, reason: p ? PLAYBACK.noImage : PLAYBACK.noImageAtHandle, measured: false, granules: [], image: null, stats: null, caveats: base?.caveats ?? [] }
  }
  return {
    ...common,
    reason: null,
    measured: true,
    granules: [
      {
        id: p.granules[0] ?? p.key,
        product: p.product,
        platform: p.platform,
        acquired_ms: p.acquired_ms,
        produced_ms: null,
        cloud_pct: p.cloud_pct,
        route: p.route,
        url: p.url,
      },
    ],
    image: { url: p.image.url, bounds_lonlat: p.image.bounds_lonlat },
    // the pass's own figures over the map area (no total area: the route's stats are not this pass's)
    stats: null,
    caveats: p.caveat ? [p.caveat] : (base?.caveats ?? []),
  }
}

/** The NWS warning areas at the handle (brief 6; module docstring): the timeline's versions before now (zone-based ones
 *  from the timeline's zones), the live answer's productsShown at and after now (C1). */
export function warningsAtHandle(
  live: FloodAlertsResponse | null | undefined,
  liveAlerts: readonly FloodAlert[],
  tl: FloodTimelineResponse | null | undefined,
  cursorMs: number | null,
  nowMs: number,
): FeatureCollection {
  const products = tl?.products?.status === 'available' ? tl.products.products : null
  const r = productsAt(products, liveAlerts, cursorMs, nowMs)
  return warningFeatures(r.alerts, r.source === 'timeline' ? tl?.products?.zones : live?.zones)
}

/** The polygons of a map answer (an available answer only). */
export function mapFeatures(resp: FloodMapResponse | null | undefined): FeatureCollection {
  if (!resp || resp.status !== 'available') return EMPTY
  const features = resp.features.features.filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
  return { type: 'FeatureCollection', features: features as unknown as Feature<Geometry>[] }
}

/** FEMA zones with a `band` the style reads: floodway, sfha (1 %), band (0.2 %). Never zone X shapes (D16). */
export function nfhlFeatures(resp: FloodMapResponse | null | undefined): FeatureCollection {
  const fc = mapFeatures(resp)
  const features: Feature<Geometry>[] = []
  for (const f of fc.features) {
    const p = (f.properties ?? {}) as Record<string, unknown>
    const sub = String(p.zone_subty ?? '').toUpperCase()
    const zone = String(p.fld_zone ?? '').toUpperCase()
    const band = sub.includes('FLOODWAY') ? 'floodway' : sub.includes('0.2') ? 'band' : p.sfha === true || p.sfha === 'T' || /^A|^V/.test(zone) ? 'sfha' : null
    if (band) features.push({ ...f, properties: { ...p, band } } as Feature<Geometry>)
  }
  return { type: 'FeatureCollection', features }
}

/** The NWS warning areas to draw: each product's polygon, else its zones' outlines (zone-based products), with the
 *  product's event as a property. Only the alerts given (the caller picks them with productsAt, C1). */
export function warningFeatures(alerts: readonly FloodAlert[], zones: FloodAlertsResponse['zones'] | null | undefined): FeatureCollection {
  const features: Feature<Geometry>[] = []
  const ids = new Set(alerts.map((a) => a.id))
  for (const a of alerts)
    if (a.geometry && (a.geometry.type === 'Polygon' || a.geometry.type === 'MultiPolygon'))
      features.push({ type: 'Feature', geometry: a.geometry as unknown as Geometry, properties: { id: a.id, event: a.event, emergency: a.emergency, watch: /Watch$/.test(a.event) } })
  for (const z of zones?.features ?? []) {
    const ofShown = z.properties.alert_ids.filter((id) => ids.has(id))
    if (!ofShown.length || !z.geometry) continue
    const a = alerts.find((x) => x.id === ofShown[0])
    features.push({ type: 'Feature', geometry: z.geometry as unknown as Geometry, properties: { id: ofShown[0], event: a?.event ?? '', emergency: a?.emergency ?? false, watch: /Watch$/.test(a?.event ?? ''), zone: z.properties.ugc } })
  }
  return { type: 'FeatureCollection', features }
}

/** The area layers, bottom to top (all below the basemap labels; the caller inserts them before the first label). */
export function floodAreaLayers(): LayerSpecification[] {
  return [
    // the satellite image (the PNG's own colours and alpha: water, partial water, the grey "no view" hatch)
    { id: FLOOD_AREA_LAYERS.satellite, type: 'raster', source: FLOOD_AREA_SOURCES.satellite, paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } },
    // NASA's picture (not measured here) when there is no measured image
    { id: FLOOD_AREA_LAYERS.satelliteTiles, type: 'raster', source: FLOOD_AREA_SOURCES.satelliteTiles, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } },
    // FEMA floodplain (background): a stipple; the floodway a little stronger
    {
      id: FLOOD_AREA_LAYERS.floodplainFill,
      type: 'fill',
      source: FLOOD_AREA_SOURCES.floodplain,
      paint: { 'fill-pattern': NFHL_STIPPLE_IMAGE, 'fill-opacity': ['match', ['get', 'band'], 'floodway', 0.9, 'sfha', 0.7, 0.4] },
    },
    {
      id: FLOOD_AREA_LAYERS.floodplainLine,
      type: 'line',
      source: FLOOD_AREA_SOURCES.floodplain,
      filter: ['!=', ['get', 'band'], 'band'],
      paint: { 'line-color': FLOOD_AREA.floodplain, 'line-width': 0.8 },
    },
    // the main channel: OpenStreetMap water areas and rivers from the basemap's vector tiles
    { id: FLOOD_AREA_LAYERS.channelFill, type: 'fill', source: VECTOR_SOURCE, 'source-layer': 'water', paint: { 'fill-color': FLOOD_AREA.channelFill } },
    {
      id: FLOOD_AREA_LAYERS.channelLine,
      type: 'line',
      source: VECTOR_SOURCE,
      'source-layer': 'water',
      paint: { 'line-color': FLOOD_AREA.channelEdge, 'line-width': 1, 'line-dasharray': [3, 3] },
    },
    {
      id: FLOOD_AREA_LAYERS.channelRiver,
      type: 'line',
      source: VECTOR_SOURCE,
      'source-layer': 'waterway',
      filter: ['==', ['get', 'class'], 'river'],
      paint: { 'line-color': FLOOD_TOKENS['m-flood-channel'], 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 4] },
    },
    // the NWS forecast flooded area: a light water-blue fill, the hatch and a light edge
    { id: FLOOD_AREA_LAYERS.forecastFill, type: 'fill', source: FLOOD_AREA_SOURCES.forecast, paint: { 'fill-color': FLOOD_AREA.forecastFill } },
    { id: FLOOD_AREA_LAYERS.forecastHatch, type: 'fill', source: FLOOD_AREA_SOURCES.forecast, paint: { 'fill-pattern': FIM_HATCH_IMAGE, 'fill-opacity': 0.9 } },
    { id: FLOOD_AREA_LAYERS.forecastLine, type: 'line', source: FLOOD_AREA_SOURCES.forecast, paint: { 'line-color': FLOOD_AREA.forecastEdge, 'line-opacity': 0.8, 'line-width': 1.1 } },
    // the satellite image's edge
    {
      id: FLOOD_AREA_LAYERS.satelliteEdge,
      type: 'line',
      source: FLOOD_AREA_SOURCES.satelliteEdge,
      paint: { 'line-color': '#9a9a9a', 'line-opacity': 0.85, 'line-width': 1.2, 'line-dasharray': [4, 3] },
    },
    // NWS warning areas (pink; a watch dashed and fainter)
    { id: FLOOD_AREA_LAYERS.warningsFill, type: 'fill', source: FLOOD_AREA_SOURCES.warnings, paint: { 'fill-color': FLOOD_ALERT, 'fill-opacity': ['case', ['get', 'watch'], 0.03, 0.07] } },
    {
      id: FLOOD_AREA_LAYERS.warningsLine,
      type: 'line',
      source: FLOOD_AREA_SOURCES.warnings,
      paint: { 'line-color': FLOOD_ALERT, 'line-width': ['case', ['get', 'emergency'], 2.6, 1.8], 'line-opacity': ['case', ['get', 'watch'], 0.6, 0.95] },
    },
  ] as unknown as LayerSpecification[]
}

/** The GeoJSON sources of the area layers (the image source is added when there is an image). */
export const FLOOD_AREA_GEOJSON = [FLOOD_AREA_SOURCES.satelliteEdge, FLOOD_AREA_SOURCES.floodplain, FLOOD_AREA_SOURCES.forecast, FLOOD_AREA_SOURCES.warnings] as const

type Img = { image: { width: number; height: number; data: Uint8Array }; options: { pixelRatio: number } }

/** The forecast area's hatch: thin #7fd4ff diagonals every 6 css px on transparent (device px at pixelRatio 2). */
export function fimHatchImage(): Img {
  const size = 12
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = (x + y) % size
      const a = d < 2 ? 0.75 : d < 3 ? 0.3 : 0
      if (!a) continue
      const i = (y * size + x) * 4
      data[i] = 127
      data[i + 1] = 212
      data[i + 2] = 255
      data[i + 3] = Math.round(255 * a)
    }
  return { image: { width: size, height: size, data }, options: { pixelRatio: 2 } }
}

/** FEMA's stipple: a small grey-blue dot every 4 css px (never green, never zone X). */
export function nfhlStippleImage(): Img {
  const size = 8
  const data = new Uint8Array(size * size * 4)
  for (const [x, y] of [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
    [5, 5],
    [6, 5],
    [5, 6],
    [6, 6],
  ]) {
    const i = (y * size + x) * 4
    data[i] = 170
    data[i + 1] = 186
    data[i + 2] = 214
    data[i + 3] = 200
  }
  return { image: { width: size, height: size, data }, options: { pixelRatio: 2 } }
}
