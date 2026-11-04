// The flood map module (brief 5, PLAN-5 §4.3, CONTRACT §16.11), mounted by map/mapController.ts like
// official/mapLayer.ts: one handle that keeps the flood markers, groups and river gauges on the map in step with the
// flood store (lists, filter, "Show watches", the open flood) and the workspace (hazard, units). It follows its stores
// itself; `update()` re-syncs, `restyle(theme)` re-adds everything after a basemap switch (from the cached data),
// `hit(point)` says what a click means (the controller asks it first while Floods is picked or a flood is open),
// `hoverLines(point)` gives the hover text. The national river gauges come from /api/official/river-gauges
// ?scope=national&min=action (cached 5 min; on failure, the listed floods' own member gauges). Sources and layers are
// fx-flood-* only. The flood views' own layers (satellite water, NWS forecast flooded area, warning areas, channel,
// floodplain, model) are web-flood-public's and web-flood-command's (map/floodProfile.ts says which view draws what).
import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap, PointLike } from 'maplibre-gl'
import { getRiverGauges } from '../api/floods'
import type { FloodSummary, RiverGauge } from '../api/types'
import { openFloodSummary, useFlood } from '../state/flood'
import { getSlot } from '../state/floodCatalog'
import { shownFloods } from '../state/floodOverview'
import { useWorkspace } from '../state/workspace'
import { GAUGE_CATEGORY_DISPLAY, NOT_ALL_CLEAR } from '../ui/shell/floodCopy'
import { floodDisplayName, floodRowSub, gaugeLabel } from '../ui/public/floodOverviewText'
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
  return floods.flatMap((f) => f.gauges.map((g) => ({ lid: g.lid, name: g.name, lat: g.lat, lon: g.lon, observed_category: g.observed_category, observed_value: g.observed_value, unit: g.unit, waterbody: g.waterbody })))
}

const riverToPoint = (g: RiverGauge): GaugePoint => ({ lid: g.lid, name: g.name, lat: g.lat, lon: g.lon, observed_category: g.observed.category, observed_value: g.observed.value, unit: g.observed.unit, waterbody: g.waterbody })

export function mountFloodLayers(map: MapLibreMap, opts: { beforeId?: string[]; topBeforeId?: string[] } = {}): FloodLayersHandle {
  let removed = false
  let styled = false
  let dataKey = ''
  let gaugeKey = ''
  let dim: boolean | null = null
  let shown: boolean | null = null
  let national: { at: number; gauges: GaugePoint[] } | null = null
  let nationalLoading = false
  const before = () => (opts.topBeforeId ?? []).find((id) => map.getLayer(id))
  const markerIds = () => floodMarkerLayers('dark').map((l) => l.id)
  const gaugeIds = Object.values(FLOOD_GAUGE_LAYERS) as string[]
  const has = (id: string) => Boolean(map.getLayer(id))

  const loadNational = () => {
    if (nationalLoading || removed || useWorkspace.getState().hazard !== 'flood') return
    if (national && Date.now() - national.at < NATIONAL_GAUGES_TTL_MS) return
    nationalLoading = true
    getRiverGauges({ national: true, min: 'action' })
      .then((r) => {
        national = { at: Date.now(), gauges: r.status === 'available' ? r.gauges.map(riverToPoint) : (national?.gauges ?? []) }
        if (r.status !== 'available' && !national.gauges.length) national = { at: Date.now(), gauges: [] }
      })
      .catch(() => {
        // the listed floods' member gauges stand in; asked again after the TTL
        national = { at: Date.now(), gauges: national?.gauges ?? [] }
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
    // gauges on the national map in Floods (a flood view draws its own)
    const gaugesOn = ws.hazard === 'flood' && fl.floodId == null && fl.layers.gauges
    for (const id of gaugeIds) if (has(id)) map.setLayoutProperty(id, 'visibility', gaugesOn ? 'visible' : 'none')
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
    if (gaugesOn) {
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
          { text: 'Click to open this flood', cls: 'fxm-tip-hint' },
        ],
        clickable: true,
      }
    }
    if (h.kind === 'group') {
      const p = Array.isArray(point) ? { x: point[0], y: point[1] } : (point as { x: number; y: number })
      const n = Number(map.queryRenderedFeatures([p.x, p.y], { layers: FLOOD_CLUSTER_LAYERS.filter(has) })[0]?.properties?.point_count) || 0
      return { lines: [{ text: `Group of ${n} listed floods`, cls: 'fxm-tip-title' }, { text: 'Click to zoom in', cls: 'fxm-tip-hint' }], clickable: true }
    }
    const pts = national?.gauges.length ? national.gauges : memberGauges(floodsShown())
    const g = pts.find((x) => x.lid === h.id)
    if (!g) return null
    const d = GAUGE_CATEGORY_DISPLAY[g.observed_category] ?? GAUGE_CATEGORY_DISPLAY.unknown
    return {
      lines: [
        { text: g.name, cls: 'fxm-tip-title' },
        { text: gaugeLabel(g, useWorkspace.getState().units) },
        { text: `${d.short} · NOAA National Water Prediction Service (NWS)` },
        { text: 'Click to check this spot', cls: 'fxm-tip-hint' },
      ],
      clickable: true,
    }
  }

  const unsubs = [
    useFlood.subscribe((s, p) => {
      if (s.lists !== p.lists || s.filter !== p.filter || s.showWatches !== p.showWatches || s.floodId !== p.floodId || s.layers !== p.layers || s.summary !== p.summary) sync()
    }),
    useWorkspace.subscribe((s, p) => {
      if (s.hazard !== p.hazard || s.units !== p.units) sync()
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
        for (const id of [...markerIds(), ...gaugeIds]) if (has(id)) map.removeLayer(id)
        for (const g of FLOOD_GROUPS) if (map.getSource(FLOOD_SOURCES[g])) map.removeSource(FLOOD_SOURCES[g])
        if (map.getSource(FLOOD_GAUGE_SOURCE)) map.removeSource(FLOOD_GAUGE_SOURCE)
      } catch {
        // the map is being removed with its style
      }
    },
    layerIds: () => [...gaugeIds, ...markerIds()].filter(has),
  }
}
