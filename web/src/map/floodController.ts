// The flood map module (brief 5, PLAN-5 §4.3, CONTRACT §16.11), mounted by map/mapController.ts like
// official/mapLayer.ts: one handle that keeps the flood markers, groups and river gauges on the map in step with the
// flood store (lists, filter, "Show watches", the open flood) and the workspace (hazard, units). It follows its stores
// itself; `update()` re-syncs, `restyle(theme)` re-adds everything after a basemap switch (from the cached data),
// `hit(point)` says what a click means (the controller asks it first while Floods is picked or a flood is open),
// `hoverLines(point)` gives the hover text. The national river gauges come from /api/official/river-gauges
// ?scope=national&min=action (cached 5 min; on failure, the listed floods' own member gauges). Sources and layers are
// fx-flood-* only. The flood views' own layers (satellite water, NWS forecast flooded area, warning areas, channel,
// floodplain, model) are web-flood-public's and web-flood-command's (map/floodProfile.ts says which view draws what).
// Brief 5 web-flood-command: Command's own layers (NWS category flood map, the National Water Model's flooded area
// and high-flow reaches; map/floodCommandLayers.ts) come from state/floodLayerData.ts, each behind its own toggle.
import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap, PointLike } from 'maplibre-gl'
import { apiPathUrl, getRiverGauges } from '../api/floods'
import type { FloodSummary, RiverGauge } from '../api/types'
import { useFloodOfficial } from '../official/floodHooks'
import { memberGaugesOf, officialAlerts } from '../official/floodModel'
import { openFloodSummary, useFlood } from '../state/flood'
import { getSlot } from '../state/floodCatalog'
import { shownFloods } from '../state/floodOverview'
import { clockFor } from '../state/timeZone'
import { useWorkspace } from '../state/workspace'
import { mapChromeOf } from '../ui/shell/views'
import { gaugeCategoryRank } from '../state/floodOverview'
import { fillCopy, FLOOD_OVERVIEW, GAUGE_CATEGORY_DISPLAY, NOT_ALL_CLEAR } from '../ui/shell/floodCopy'
import { floodDisplayName, floodRowSub, gaugeLabel, gaugeReadingLine } from '../ui/public/floodOverviewText'
import {
  AREA_LAYER_KEY,
  DRAW_SAT_PICTURE,
  FIM_HATCH_IMAGE,
  fimHatchImage,
  FLOOD_AREA_GEOJSON,
  FLOOD_AREA_LAYERS,
  FLOOD_AREA_SOURCES,
  floodAreaLayers,
  imageCorners,
  mapFeatures,
  NFHL_STIPPLE_IMAGE,
  nfhlFeatures,
  nfhlStippleImage,
  satelliteEdge,
  satelliteImage,
  satelliteTiles,
  warningFeatures,
} from './floodAreaLayers'
import { useNationalGauges } from './floodGaugeStatus'
import {
  CATFIM_HATCH_IMAGE,
  catfimFeatures,
  catfimHatchImage,
  CMD_LAYER_KEY,
  FLOOD_CMD_GEOJSON,
  FLOOD_CMD_LAYERS,
  FLOOD_CMD_SOURCES,
  floodCommandLayers,
  labelPoints,
  highFlowFeatures,
  modelFeatures,
} from './floodCommandLayers'
import { useFloodLayerData } from '../state/floodLayerData'
import { gaugeKey as hydroGaugeKey, gaugeOf, useHydroData, withChartReading } from '../ui/timeline/hydrographData'
import { productsShown } from '../ui/timeline/hydrographModel'
import { floodLayerShown } from './floodProfile'
import { VECTOR_SOURCE } from './basemapStyle'
import {
  diamondImage,
  DIAMOND_IMAGE,
  FLOOD_CLUSTER_LAYERS,
  FLOOD_GAUGE_LAYERS,
  FLOOD_GAUGE_SOURCE,
  FLOOD_GROUPS,
  FLOOD_LABEL_LAYERS,
  FLOOD_OVR,
  FLOOD_POINT_LAYERS,
  FLOOD_SOURCES,
  floodMarkerLayers,
  floodOverviewData,
  floodSourceOptions,
  floodTickImage,
  gaugeFeatures,
  gaugeLayers,
  splitFloods,
  type GaugePoint,
} from './floodLayers'
import { FLOOD_PALETTE, type GaugeTone } from './floodStyle'
import type { MapTheme } from './layers'
import { useMapRuntime } from './mapStore'
import { clusterClickZoom, labelFilters, NARROW_PX, overviewPaint, OVR } from './overviewLayers'
import type { FeatureCollection } from './overlayModel'

export interface FloodHit {
  kind: 'flood' | 'gauge' | 'group'
  /** The flood id, the gauge's NWS id, or "<group>:<cluster id>" for a group. */
  id: string
  /** Where the hit is (a gauge's or a group's point). */
  lngLat?: [number, number]
}

export interface FloodLayersHandle {
  update(): void
  restyle(theme: MapTheme): void
  hit(point: PointLike): FloodHit | null
  /** Zoom in on a group the way the fire groups do (at most z8). */
  zoomToGroup(hit: FloodHit, ease: (center: [number, number], zoom: number) => void): void
  /** The hover text of a flood, group or gauge under the pointer (title first), else null. */
  hoverLines(point: PointLike): { lines: { text: string; cls?: string }[]; clickable: boolean } | null
  remove(): void
  layerIds(): string[]
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }
const NATIONAL_GAUGES_TTL_MS = 5 * 60_000

/** The floods the national map shows: the filter's list, watches as the switch says. */
export function floodsShown(): FloodSummary[] {
  const s = useFlood.getState()
  const r = getSlot(s.lists, s.filter).response
  return r ? shownFloods(r.floods, s.showWatches) : []
}

/** Floods mode: the map lists floods or a flood is open. */
export function floodMapMode(): boolean {
  return useWorkspace.getState().hazard === 'flood' || useFlood.getState().floodId != null
}

/** Gauge points from the listed floods' member gauges (the fallback when the national gauge answer is missing). */
export function memberGauges(floods: readonly FloodSummary[]): GaugePoint[] {
  return floods.flatMap((f) =>
    f.gauges.map((g) => ({
      lid: g.lid,
      name: g.name,
      lat: g.lat,
      lon: g.lon,
      observed_category: g.observed_category,
      observed_value: g.observed_value,
      unit: g.unit,
      waterbody: g.waterbody,
      observed_ms: g.observed_ms,
      time_zone: f.time_zone,
    })),
  )
}

/** The open flood's gauges for its view: every member gauge (any status: below flood stage grey, "?" without flood
 *  stages) and nearby gauges at action stage or above; from the gauges answer, else the summary's member gauges. */
export function floodViewGauges(): GaugePoint[] {
  const fl = useFlood.getState()
  const s = openFloodSummary(fl)
  if (!s) return []
  const ans = useFloodOfficial.getState()
  const resp = ans.floodId === s.id ? ans.gauges.data : null
  if (resp && resp.status === 'available') {
    // the primary gauge with the newer of its two readings, as the stage row and the leader (review WFP-R2); in Command
    // also the river-level chart's own reading when it is newer (one reading per gauge, web-flood-command)
    const chart = (g: RiverGauge) => withChartReading(g, gaugeOf(useHydroData.getState().gauges[hydroGaugeKey(g.lid, null)]?.data, g.lid))
    const members = memberGaugesOf(resp, s).map(chart).map(riverToPoint)
    const nearby = resp.gauges.filter((g) => !g.member && gaugeCategoryRank(g.observed.category) >= 1).map(chart).map(riverToPoint)
    return [...members, ...nearby]
  }
  return memberGauges([s])
}

const riverToPoint = (g: RiverGauge): GaugePoint => ({
  lid: g.lid,
  name: g.name,
  lat: g.lat,
  lon: g.lon,
  observed_category: g.observed.category,
  observed_value: g.observed.value,
  unit: g.observed.unit,
  waterbody: g.waterbody,
  observed_ms: g.observed.valid_ms,
  time_zone: g.time_zone,
})

export function mountFloodLayers(map: MapLibreMap, opts: { beforeId?: string[]; topBeforeId?: string[] } = {}): FloodLayersHandle {
  let removed = false
  let styled = false
  let dataKey = ''
  let gaugeKey = ''
  let dim: boolean | null = null
  let shown: boolean | null = null
  let national: { at: number; gauges: GaugePoint[] } | null = null
  let nationalLoading = false
  let areaKey = ''
  let imageKey = ''
  let tilesKey = ''
  let areaShown = ''
  const before = () => (opts.topBeforeId ?? []).find((id) => map.getLayer(id))
  const markerIds = () => floodMarkerLayers('dark').map((l) => l.id)
  const gaugeIds = Object.values(FLOOD_GAUGE_LAYERS) as string[]
  const has = (id: string) => Boolean(map.getLayer(id))

  const loadNational = () => {
    if (nationalLoading || removed || useWorkspace.getState().hazard !== 'flood') return
    if (national && Date.now() - national.at < NATIONAL_GAUGES_TTL_MS) return
    nationalLoading = true
    if (!national) useNationalGauges.getState().set('loading')
    getRiverGauges({ national: true, min: 'action' })
      .then((r) => {
        national = { at: Date.now(), gauges: r.status === 'available' ? r.gauges.map(riverToPoint) : (national?.gauges ?? []) }
        if (r.status !== 'available' && !national.gauges.length) national = { at: Date.now(), gauges: [] }
        // an unavailable answer: the listed floods' member gauges stand in, and the legend and list say so (WFO-R8)
        useNationalGauges.getState().set(r.status === 'available' ? 'available' : 'unavailable')
      })
      .catch(() => {
        // the listed floods' member gauges stand in; asked again after the TTL
        national = { at: Date.now(), gauges: national?.gauges ?? [] }
        useNationalGauges.getState().set('unavailable')
      })
      .finally(() => {
        nationalLoading = false
        sync()
      })
  }

  const setData = (id: string, fc: FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc as never)

  const sync = () => {
    if (removed || !styled) return
    const ws = useWorkspace.getState()
    const fl = useFlood.getState()
    const on = floodMapMode()
    if (on !== shown) {
      shown = on
      for (const id of markerIds()) if (has(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    // gauges on the national map in Floods, or the open flood's own gauges in its view
    const view = fl.floodId != null
    const gaugesOn = view ? fl.layers.gauges && floodLayerShown(viewChrome(), 'gauges', true) : ws.hazard === 'flood' && fl.layers.gauges
    for (const id of gaugeIds) if (has(id)) map.setLayoutProperty(id, 'visibility', gaugesOn ? 'visible' : 'none')
    syncAreas()
    if (!on) return
    const floods = floodsShown()
    const hidden = fl.floodId != null ? [fl.floodId, ...(openFloodSummary(fl)?.aliases ?? [])] : []
    const r = getSlot(fl.lists, fl.filter).response
    const key = `${r?.updated_ms ?? 0}|${fl.filter}|${fl.showWatches}|${ws.units}|${hidden.join(',')}|${floods.length}`
    if (key !== dataKey) {
      dataKey = key
      const data = floodOverviewData(splitFloods(floods, hidden), ws.units)
      for (const g of FLOOD_GROUPS) setData(FLOOD_SOURCES[g], data[g])
    }
    if (gaugesOn && view) {
      const g = useFloodOfficial.getState().gauges
      const pts = floodViewGauges()
      const pg = openFloodSummary(fl)?.primary_gauge
      const gk = `view|${fl.floodId}|${g.data?.retrieved_ms ?? 0}|${pts.length}|${ws.units}|${pg?.lid ?? ''}:${pg?.observed_ms ?? 0}`
      if (gk !== gaugeKey) {
        gaugeKey = gk
        setData(FLOOD_GAUGE_SOURCE, gaugeFeatures(pts, ws.units, 0))
      }
    } else if (gaugesOn) {
      loadNational()
      const pts = national?.gauges.length ? national.gauges : memberGauges(floods)
      const gk = `${national?.at ?? 0}|${pts.length}|${ws.units}|${r?.updated_ms ?? 0}`
      if (gk !== gaugeKey) {
        gaugeKey = gk
        setData(FLOOD_GAUGE_SOURCE, gaugeFeatures(pts, ws.units))
      }
    }
    // other floods are lighter while one is open (as fires are)
    const d = fl.floodId != null
    if (d !== dim) {
      dim = d
      const ids = new Map<string, string>(Object.entries(OVR).map(([k, v]) => [v, FLOOD_OVR[k as keyof typeof OVR]]))
      for (const [id, props] of Object.entries(overviewPaint(d))) {
        const fid = ids.get(id)
        if (fid && has(fid)) for (const [k, v] of Object.entries(props)) map.setPaintProperty(fid, k, v)
      }
    }
  }

  /** The chrome the open flood is shown in (public-flood or command-flood). */
  const viewChrome = () => mapChromeOf(useFlood.getState().floodId != null ? 'flood' : null, useWorkspace.getState().preset)

  /** The basemap's first label layer: the area layers go below it (water under the place names). */
  const firstLabel = () => (map.getStyle()?.layers ?? []).find((l) => l.type === 'symbol' && !l.id.startsWith('fx-'))?.id

  /** The satellite image: an image source on its own bounds, replaced when the image changes (C2). */
  const syncImage = (sat: ReturnType<typeof satelliteImage>) => {
    const key = sat ? `${sat.url}|${sat.bounds.join(',')}` : ''
    if (key === imageKey) return
    imageKey = key
    if (has(FLOOD_AREA_LAYERS.satellite)) map.removeLayer(FLOOD_AREA_LAYERS.satellite)
    if (map.getSource(FLOOD_AREA_SOURCES.satellite)) map.removeSource(FLOOD_AREA_SOURCES.satellite)
    if (!sat) return
    map.addSource(FLOOD_AREA_SOURCES.satellite, { type: 'image', url: apiPathUrl(sat.url), coordinates: imageCorners(sat.bounds) })
    const spec = floodAreaLayers().find((l) => l.id === FLOOD_AREA_LAYERS.satellite)!
    // the lowest area layer: under the floodplain, the channel, the forecast area and the warning areas
    const above = [FLOOD_AREA_LAYERS.floodplainFill, FLOOD_AREA_LAYERS.channelFill, FLOOD_AREA_LAYERS.forecastFill].find(has) ?? firstLabel()
    map.addLayer(spec, above)
    areaShown = ''
  }

  /** NASA's picture tiles (GIBS) when no measured image is shown; replaced when the date changes. */
  const syncTiles = (t: ReturnType<typeof satelliteTiles>) => {
    const key = t ? t.template : ''
    if (key === tilesKey) return
    tilesKey = key
    if (has(FLOOD_AREA_LAYERS.satelliteTiles)) map.removeLayer(FLOOD_AREA_LAYERS.satelliteTiles)
    if (map.getSource(FLOOD_AREA_SOURCES.satelliteTiles)) map.removeSource(FLOOD_AREA_SOURCES.satelliteTiles)
    if (!t) return
    map.addSource(FLOOD_AREA_SOURCES.satelliteTiles, { type: 'raster', tiles: [t.template], tileSize: 256, maxzoom: t.maxZoom })
    const spec = floodAreaLayers().find((l) => l.id === FLOOD_AREA_LAYERS.satelliteTiles)!
    const above = [FLOOD_AREA_LAYERS.floodplainFill, FLOOD_AREA_LAYERS.channelFill, FLOOD_AREA_LAYERS.forecastFill].find(has) ?? firstLabel()
    map.addLayer(spec, above)
    areaShown = ''
  }

  /** The open flood's area layers from its official answers (the products in effect at the handle's time, C1). */
  const syncAreas = () => {
    if (removed || !styled) return
    const fl = useFlood.getState()
    const off = useFloodOfficial.getState()
    const s = openFloodSummary(fl)
    const mine = s != null && off.floodId === s.id
    const extra = useFloodLayerData.getState()
    const mineExtra = s != null && extra.floodId === s.id
    const nowMs = Date.now()
    const cursorBucket = fl.cursorMs == null ? 'now' : String(Math.round(fl.cursorMs / 600_000))
    const key = mine
      ? [
          s.id,
          off.alerts.data?.retrieved_ms,
          off.alerts.data?.alerts.length,
          off.fim.data?.retrieved_ms,
          off.nfhl.data?.retrieved_ms,
          // the satellite image's edge follows its answer (review WFP-R3: the image often arrives last)
          off.satellite.data?.retrieved_ms,
          off.satellite.data?.image?.url,
          extra.model.data?.retrieved_ms,
          extra.highFlow.data?.retrieved_ms,
          extra.catfim.data?.retrieved_ms,
          extra.catfimFor,
          cursorBucket,
          Math.round(nowMs / 60_000),
        ].join('|')
      : ''
    if (key !== areaKey) {
      areaKey = key
      // the products at the chart's handle: the point check's own rule (productsShown; review WFC-R1)
      const alerts = mine ? productsShown(officialAlerts(off.alerts.data), fl.cursorMs, nowMs).alerts : []
      setData(FLOOD_AREA_SOURCES.warnings, mine ? warningFeatures(alerts, off.alerts.data?.zones) : EMPTY_FC)
      setData(FLOOD_AREA_SOURCES.forecast, mine ? mapFeatures(off.fim.data) : EMPTY_FC)
      setData(FLOOD_AREA_SOURCES.floodplain, mine ? nfhlFeatures(off.nfhl.data) : EMPTY_FC)
      setData(FLOOD_AREA_SOURCES.satelliteEdge, mine ? satelliteEdge(off.satellite.data) : EMPTY_FC)
      // Command's own layers, each from its own answer (never merged)
      const catfimFc = mineExtra ? catfimFeatures(extra.catfim.data) : EMPTY_FC
      const modelFc = mineExtra ? modelFeatures(extra.model.data) : EMPTY_FC
      setData(FLOOD_CMD_SOURCES.catfim, catfimFc)
      setData(FLOOD_CMD_SOURCES.model, modelFc)
      // point labels inside the largest polygons (review WFC-R13)
      setData(FLOOD_CMD_SOURCES.catfimPoints, labelPoints(catfimFc))
      setData(FLOOD_CMD_SOURCES.modelPoints, labelPoints(modelFc))
      setData(FLOOD_CMD_SOURCES.highFlow, mineExtra ? highFlowFeatures(extra.highFlow.data) : EMPTY_FC)
    }
    syncImage(mine ? satelliteImage(off.satellite.data) : null)
    syncTiles(mine && DRAW_SAT_PICTURE ? satelliteTiles(off.satellite.data) : null)
    // visibility: a flood open, its view's profile and the Layers toggles
    const chrome = viewChrome()
    const shownKey = `${mine}|${chrome}|${JSON.stringify(fl.layers)}`
    if (shownKey === areaShown) return
    areaShown = shownKey
    for (const [id, k] of Object.entries(AREA_LAYER_KEY)) {
      if (!has(id)) continue
      const on = mine && floodLayerShown(chrome, k, fl.layers[k])
      map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    for (const [id, k] of Object.entries(CMD_LAYER_KEY)) {
      if (!has(id)) continue
      const on = s != null && floodLayerShown(chrome, k, fl.layers[k])
      map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
  }

  /** The leader overlay names some floods below z5: the map leaves out their own labels. */
  const applyLabelFilters = () => {
    if (!styled) return
    const f = labelFilters(useMapRuntime.getState().leaderIds)
    const pairs: [string, string][] = [
      [OVR.otherLabel, FLOOD_OVR.otherLabel],
      [OVR.activeLabel, FLOOD_OVR.activeLabel],
      [OVR.pinnedLabel, FLOOD_OVR.pinnedLabel],
    ]
    for (const [fire, flood] of pairs) if (has(flood)) map.setFilter(flood, f[fire] as FilterSpecification)
  }

  const restyle = (theme: MapTheme) => {
    if (removed) return
    const width = map.getContainer().clientWidth
    for (const tone of ['dark', 'light'] as const) {
      const name = FLOOD_PALETTE[tone].tick
      if (!map.hasImage(name)) {
        const t = floodTickImage(tone)
        map.addImage(name, t.image, t.options)
      }
    }
    for (const [tone, name] of Object.entries(DIAMOND_IMAGE) as [GaugeTone, string][]) {
      if (map.hasImage(name)) continue
      const d = diamondImage(tone)
      map.addImage(name, d.image, d.options)
    }
    for (const g of FLOOD_GROUPS) if (!map.getSource(FLOOD_SOURCES[g])) map.addSource(FLOOD_SOURCES[g], floodSourceOptions(g, width) as never)
    if (!map.getSource(FLOOD_GAUGE_SOURCE)) map.addSource(FLOOD_GAUGE_SOURCE, { type: 'geojson', data: EMPTY_FC as never })
    // the flood views' area layers, below the basemap's labels (the image layer is added with its image)
    if (!map.hasImage(FIM_HATCH_IMAGE)) {
      const h = fimHatchImage()
      map.addImage(FIM_HATCH_IMAGE, h.image, h.options)
    }
    if (!map.hasImage(NFHL_STIPPLE_IMAGE)) {
      const h = nfhlStippleImage()
      map.addImage(NFHL_STIPPLE_IMAGE, h.image, h.options)
    }
    for (const id of FLOOD_AREA_GEOJSON) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY_FC as never, tolerance: 0.3 })
    const label = firstLabel()
    const vector = Boolean(map.getSource(VECTOR_SOURCE))
    for (const layer of floodAreaLayers()) {
      if (layer.id === FLOOD_AREA_LAYERS.satellite || layer.id === FLOOD_AREA_LAYERS.satelliteTiles || has(layer.id)) continue
      if ((layer as { source?: string }).source === VECTOR_SOURCE && !vector) continue
      map.addLayer({ ...layer, layout: { ...(layer.layout ?? {}), visibility: 'none' } } as typeof layer, label)
    }
    // Command's own layers: above the water layers, below the NWS warning areas (their pink stays on top)
    if (!map.hasImage(CATFIM_HATCH_IMAGE)) {
      const h = catfimHatchImage()
      map.addImage(CATFIM_HATCH_IMAGE, h.image, h.options)
    }
    for (const id of FLOOD_CMD_GEOJSON) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY_FC as never, tolerance: 0.3 })
    const underWarnings = has(FLOOD_AREA_LAYERS.warningsFill) ? FLOOD_AREA_LAYERS.warningsFill : label
    const pointLabels = new Set<string>([FLOOD_CMD_LAYERS.modelPointLabel, FLOOD_CMD_LAYERS.catfimPointLabel])
    for (const layer of floodCommandLayers()) {
      if (has(layer.id)) continue
      // the fills and lines under the warning areas; the line labels just under the basemap's own labels; the point
      // labels above them (placed before the basemap's place names, so "MODEL · EXPERIMENTAL" shows; review WFC-R13),
      // under the gauges and map-core's top layers
      const at = pointLabels.has(layer.id) ? before() : layer.type === 'symbol' ? label : underWarnings
      map.addLayer({ ...layer, layout: { ...(layer.layout ?? {}), visibility: 'none' } } as typeof layer, at)
    }
    imageKey = ''
    tilesKey = ''
    areaKey = ''
    areaShown = ''
    const b = before()
    // gauges under the flood markers; both under map-core's top layers (the selected point, its label)
    for (const layer of gaugeLayers(theme)) if (!has(layer.id)) map.addLayer(layer, b)
    for (const layer of floodMarkerLayers(theme, { narrow: width < NARROW_PX })) if (!has(layer.id)) map.addLayer(layer, b)
    styled = true
    dataKey = ''
    gaugeKey = ''
    dim = null
    shown = null
    sync()
    applyLabelFilters()
  }

  const findFlood = (id: string): FloodSummary | null => {
    const s = useFlood.getState()
    for (const slot of Object.values(s.lists)) {
      const f = slot.response?.floods.find((x) => x.id === id)
      if (f) return f
    }
    return null
  }

  const hit = (point: PointLike): FloodHit | null => {
    if (!styled || !floodMapMode()) return null
    const p = Array.isArray(point) ? { x: point[0], y: point[1] } : (point as { x: number; y: number })
    const singles = FLOOD_POINT_LAYERS.filter(has)
    if (singles.length) {
      let best: { id: string; d: number } | null = null
      let label: string | null = null
      for (const f of map.queryRenderedFeatures([p.x, p.y], { layers: singles })) {
        const id = f.properties?.id
        if (typeof id !== 'string') continue
        if (FLOOD_LABEL_LAYERS.includes(f.layer.id)) {
          label ??= id
          continue
        }
        if (f.geometry.type !== 'Point') continue
        const at = map.project(f.geometry.coordinates as [number, number])
        const d = Math.hypot(at.x - p.x, at.y - p.y)
        if (!best || d < best.d) best = { id, d }
      }
      if (best) return { kind: 'flood', id: best.id }
      if (label) return { kind: 'flood', id: label }
    }
    const groups = FLOOD_CLUSTER_LAYERS.filter(has)
    if (groups.length) {
      const feats = map.queryRenderedFeatures([p.x, p.y], { layers: groups })
      const f = feats.find((x) => x.layer.id === FLOOD_OVR.activeCluster) ?? feats[0]
      if (f && f.geometry.type === 'Point') {
        const group = f.layer.id === FLOOD_OVR.activeCluster ? 'active' : 'other'
        return { kind: 'group', id: `${group}:${Number(f.properties?.cluster_id)}`, lngLat: f.geometry.coordinates as [number, number] }
      }
    }
    const gl = [FLOOD_GAUGE_LAYERS.diamond].filter(has)
    if (gl.length) {
      const g = map.queryRenderedFeatures([p.x - 6, p.y - 6, p.x + 6, p.y + 6] as never, { layers: gl })[0]
      if (g && g.geometry.type === 'Point' && typeof g.properties?.lid === 'string') return { kind: 'gauge', id: g.properties.lid, lngLat: g.geometry.coordinates as [number, number] }
    }
    return null
  }

  const zoomToGroup = (h: FloodHit, ease: (center: [number, number], zoom: number) => void) => {
    if (h.kind !== 'group' || !h.lngLat) return
    const [group, cid] = h.id.split(':')
    const src = map.getSource(FLOOD_SOURCES[group as 'active' | 'other']) as GeoJSONSource | undefined
    const at = h.lngLat
    const go = (z: number) => {
      if (!removed) ease(at, clusterClickZoom(z, map.getZoom()))
    }
    if (!src) return go(Number.NaN)
    void src.getClusterExpansionZoom(Number(cid)).then(go, () => go(Number.NaN))
  }

  const hoverLines = (point: PointLike) => {
    const h = hit(point)
    if (!h) return null
    if (h.kind === 'flood') {
      const f = findFlood(h.id)
      if (!f) return null
      return {
        lines: [
          { text: floodDisplayName(f), cls: 'fxm-tip-title' },
          { text: floodRowSub(f) },
          ...(f.caveat ? [{ text: f.caveat }] : []),
          { text: NOT_ALL_CLEAR, cls: 'fxm-tip-hint' },
          { text: FLOOD_OVERVIEW.hoverOpen, cls: 'fxm-tip-hint' },
        ],
        clickable: true,
      }
    }
    if (h.kind === 'group') {
      const p = Array.isArray(point) ? { x: point[0], y: point[1] } : (point as { x: number; y: number })
      const n = Number(map.queryRenderedFeatures([p.x, p.y], { layers: FLOOD_CLUSTER_LAYERS.filter(has) })[0]?.properties?.point_count) || 0
      return { lines: [{ text: fillCopy(FLOOD_OVERVIEW.hoverGroup, { n }), cls: 'fxm-tip-title' }, { text: FLOOD_OVERVIEW.hoverZoom, cls: 'fxm-tip-hint' }], clickable: true }
    }
    const pts = national?.gauges.length ? national.gauges : memberGauges(floodsShown())
    const g = pts.find((x) => x.lid === h.id)
    if (!g) return null
    const d = GAUGE_CATEGORY_DISPLAY[g.observed_category] ?? GAUGE_CATEGORY_DISPLAY.unknown
    const ws = useWorkspace.getState()
    // the reading's own time, in the gauge's zone, with its age (official information keeps its own times; WFO-R7)
    const reading = gaugeReadingLine(g.observed_ms ?? null, g.time_zone ?? null, clockFor(ws.workspace, ws.preset), Date.now())
    return {
      lines: [
        { text: g.name, cls: 'fxm-tip-title' },
        { text: gaugeLabel(g, ws.units) },
        { text: fillCopy(FLOOD_OVERVIEW.hoverGaugeSource, { category: d.short }) },
        { text: reading },
        { text: FLOOD_OVERVIEW.hoverCheckSpot, cls: 'fxm-tip-hint' },
      ],
      clickable: true,
    }
  }

  const unsubs = [
    useFlood.subscribe((s, p) => {
      if (s.lists !== p.lists || s.filter !== p.filter || s.showWatches !== p.showWatches || s.floodId !== p.floodId || s.layers !== p.layers || s.summary !== p.summary || s.cursorMs !== p.cursorMs) sync()
    }),
    useFloodOfficial.subscribe((s, p) => {
      if (s.floodId !== p.floodId || s.alerts.data !== p.alerts.data || s.fim.data !== p.fim.data || s.nfhl.data !== p.nfhl.data || s.satellite.data !== p.satellite.data || s.gauges.data !== p.gauges.data) sync()
    }),
    useWorkspace.subscribe((s, p) => {
      if (s.hazard !== p.hazard || s.units !== p.units || s.preset !== p.preset) sync()
    }),
    useHydroData.subscribe((s, p) => {
      if (s.gauges !== p.gauges && useFlood.getState().floodId != null) {
        gaugeKey = ''
        sync()
      }
    }),
    useFloodLayerData.subscribe((s, p) => {
      if (s.floodId !== p.floodId || s.model.data !== p.model.data || s.highFlow.data !== p.highFlow.data || s.catfim.data !== p.catfim.data) sync()
    }),
    useMapRuntime.subscribe((s, p) => {
      if (s.leaderIds !== p.leaderIds) applyLabelFilters()
    }),
  ]

  return {
    update: () => sync(),
    restyle,
    hit,
    zoomToGroup,
    hoverLines,
    remove() {
      if (removed) return
      removed = true
      for (const u of unsubs) u()
      if (!styled) return
      try {
        for (const id of [...markerIds(), ...gaugeIds, ...Object.values(FLOOD_AREA_LAYERS), ...Object.values(FLOOD_CMD_LAYERS)]) if (has(id)) map.removeLayer(id)
        for (const g of FLOOD_GROUPS) if (map.getSource(FLOOD_SOURCES[g])) map.removeSource(FLOOD_SOURCES[g])
        if (map.getSource(FLOOD_GAUGE_SOURCE)) map.removeSource(FLOOD_GAUGE_SOURCE)
        for (const id of [...FLOOD_AREA_GEOJSON, ...FLOOD_CMD_GEOJSON, FLOOD_AREA_SOURCES.satellite, FLOOD_AREA_SOURCES.satelliteTiles]) if (map.getSource(id)) map.removeSource(id)
      } catch {
        // the map is being removed with its style
      }
    },
    layerIds: () => [...Object.values(FLOOD_AREA_LAYERS), ...Object.values(FLOOD_CMD_LAYERS), ...gaugeIds, ...markerIds()].filter(has),
  }
}
