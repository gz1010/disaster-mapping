// React hooks of the brief-6 3D flood view (web-forensic-flood-3d), shared by the scene (DepthSurface) and the panels
// (the scene key, the Layers tab, the hover readout): the height boost in use and the depth surface on screen.
import { useMemo } from 'react'
import { create } from 'zustand'
import type { FloodAlert, FloodAlertsResponse, SatelliteWaterResponse } from '../../api/types'
import { satelliteAtHandle } from '../../map/floodAreaLayers'
import { useFlood } from '../../state/flood'
import { gapNote, productsAt } from '../../state/floodTimeline'
import { timelineFor, useFloodTimeline } from '../../state/floodTimelineData'
import { useStore } from '../../state/store'
import { useTimeFormat } from '../../state/timeZone'
import { useNow } from '../../ui/hooks'
import { useBundleRaster } from './bundleRaster'
import { useForensicFlood } from '../../ui/forensic-flood/forensicFloodState'
import { depthShown, type DepthShown, type PassOnScreen } from './depthChoice'
import type { FloodSceneAssets } from './floodAssets'
import { passOnScreenOf, usePassDrape } from './floodPassDrape'

/** The height boost on screen (store.exaggeration while the flood scene is mounted) and whether it is the user's own
 *  choice for this flood. */
export function useHeightInUse(flood: Pick<FloodSceneAssets, 'manifest' | 'boost'> | null): { factor: number; user: boolean } | null {
  const exag = useStore((s) => s.exaggeration)
  const choice = useForensicFlood((s) => s.boost)
  if (!flood) return null
  const user = !!choice && choice.floodId === flood.manifest.id && choice.factor !== flood.boost.factor
  return { factor: exag, user }
}

/** The depth surface on screen: the user's choice of water, the playback pass on screen (M4), the bundle's products. */
export function useDepthShown(flood: Pick<FloodSceneAssets, 'manifest' | 'has' | 'terrain3d' | 'bundleTimeline'> | null): DepthShown | null {
  const choice = useForensicFlood((s) => s.depthFrom)
  const pass: PassOnScreen | null = passOnScreenOf(usePassDrape(flood))
  if (!flood) return null
  return depthShown({ terrain3d: flood.terrain3d, has: flood.has, choice, pass, layers: flood.manifest.layers })
}

/** The depth raster the scene shows right now (set by DepthSurface; null when no surface is drawn), for the hover
 *  readout. */
export const depthOnScreen = create<{ data: Uint8Array | null }>(() => ({ data: null }))

export interface SatelliteOnScreen {
  /** The satellite answer of the pass on screen (its own time and footprint), or the 3D data's own. */
  sat: SatelliteWaterResponse | null
  /** A pass is drawn. */
  has: boolean
  /** The pass on screen has places without a view (clouds or no data). */
  noView: boolean
  /** Its classes on the render grid (null: none, or only its 2D picture). */
  arr: Uint8Array | null
  /** Drawn from its 2D picture only (no cells in the 3D data). */
  imageOnly: boolean
  /** Playback words: which image and the gap ("No satellite image between Oct 29 and Nov 3"), or why none is drawn. */
  note: string | null
}

/** Brief 6 M4: the satellite pass the 3D view shows at the chart's handle, for the scene key and the hover readout. */
export function useSatelliteOnScreen(flood: Pick<FloodSceneAssets, 'manifest' | 'bundleTimeline' | 'satellite' | 'has' | 'arrays'> | null): SatelliteOnScreen | null {
  const d = usePassDrape(flood)
  const floodId = useFlood((s) => s.floodId)
  const cursorMs = useFlood((s) => s.cursorMs)
  const route = useFloodTimeline((s) => timelineFor(s, floodId))
  const nowMs = useNow(60_000)
  const tf = useTimeFormat()
  const raster = useBundleRaster(flood?.manifest ?? null, d?.mode === 'raster' ? d.waterLayer : null)
  return useMemo(() => {
    if (!flood) return null
    if (!d || cursorMs == null) return { sat: flood.satellite, has: flood.has.satellite, noView: flood.has.noView, arr: flood.arrays.satellite, imageOnly: false, note: null }
    // the route's own answer for the pass at the handle (its time, footprint and credit); the bundle's when the route
    // has none
    const routeSat = satelliteAtHandle(flood.satellite, route, cursorMs, nowMs)
    const note = gapNote(d.at, cursorMs, tf, nowMs)
    if (d.mode === 'none') return { sat: routeSat, has: false, noView: false, arr: null, imageOnly: false, note: routeSat?.reason ?? note }
    const partly = d.pass?.view === 'partly_hidden'
    if (d.mode === 'bundle') return { sat: routeSat ?? flood.satellite, has: flood.has.satellite, noView: flood.has.noView, arr: flood.arrays.satellite, imageOnly: false, note }
    if (d.mode === 'raster') return { sat: routeSat, has: true, noView: partly, arr: raster, imageOnly: false, note }
    return { sat: routeSat, has: true, noView: partly, arr: null, imageOnly: true, note }
  }, [flood, d, cursorMs, route, nowMs, tf, raster])
}

/** Brief 6 (playback): the NWS products the 3D view draws at the chart's handle (state/floodTimeline.ts productsAt):
 *  before now the time history's versions from GET /timeline (each from its issue time until its own end or the next
 *  version), at and after now the bundle's copy (warnings.json, kept current by the live loop) by brief 5's rule; the
 *  zone outlines of the same source. Null when the bundle's copy could not be read. */
export function useProductsOnScreen(flood: Pick<FloodSceneAssets, 'manifest' | 'warnings'> | null): { alerts: FloodAlert[]; zones: FloodAlertsResponse['zones'] } | null {
  const floodId = useFlood((s) => s.floodId)
  const cursorMs = useFlood((s) => s.cursorMs)
  const route = useFloodTimeline((s) => timelineFor(s, floodId))
  const nowMs = useNow(60_000)
  const resp = flood?.warnings ?? null
  return useMemo(() => {
    if (!resp || resp.status !== 'available') return null
    const products = route?.products?.status === 'available' ? route.products.products : null
    const r = productsAt(products, resp.alerts, cursorMs, nowMs)
    return { alerts: r.alerts, zones: r.source === 'timeline' && route?.products?.zones ? route.products.zones : resp.zones }
  }, [resp, route, cursorMs, nowMs])
}
