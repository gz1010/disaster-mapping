// React hooks of the brief-6 3D flood view (web-forensic-flood-3d), shared by the scene (DepthSurface) and the panels
// (the scene key, the Layers tab, the hover readout): the height boost in use and the depth surface on screen.
import { useMemo } from 'react'
import { create } from 'zustand'
import type { SatelliteWaterResponse } from '../../api/types'
import { fmtDayDate } from '../../lib/time'
import { shownGranule } from '../../official/floodModel'
import { useFlood } from '../../state/flood'
import { gapNote, passesOf } from '../../state/floodTimeline'
import { timelineFor, useFloodTimeline } from '../../state/floodTimelineData'
import { useStore } from '../../state/store'
import { useTimeFormat } from '../../state/timeZone'
import { useNow } from '../../ui/hooks'
import { fillCopy } from '../../ui/shell/floodCopy'
import { useBundleRaster } from './bundleRaster'
import { depthChoiceFor, useForensicFlood } from '../../ui/forensic-flood/forensicFloodState'
import { depthShown, type DepthShown, type PassOnScreen } from './depthChoice'
import { FLOOD_3D } from './flood3dCopy'
import type { FloodSceneAssets } from './floodAssets'
import { newerPassThanShown, passOnScreenOf, satelliteOfDrape, usePassDrape } from './floodPassDrape'
import { productsOnScreenOf, type ProductsOnScreen } from './productsOnScreen'

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
  const choice = useForensicFlood((s) => depthChoiceFor(s, flood?.manifest.id))
  const cursorMs = useFlood((s) => s.cursorMs)
  const nowMs = useNow(60_000)
  const pass: PassOnScreen | null = passOnScreenOf(usePassDrape(flood))
  if (!flood) return null
  const atMs = cursorMs != null && cursorMs < nowMs ? cursorMs : null
  return depthShown({ terrain3d: flood.terrain3d, has: flood.has, choice, pass, layers: flood.manifest.layers, atMs })
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
  /** The pass's cells are read without a picture footprint (a pass from the bundle's frozen list): a cell with a class
   *  is inside what the pass covered. */
  gridOnly: boolean
  /** Playback words: which image and the gap ("No satellite image between Oct 29 and Nov 3"), or why none is drawn. */
  note: string | null
}

/** Brief 6 M4: the satellite pass the 3D view shows at the chart's handle, for the scene key, the Layers tab and the
 *  hover readout. Its words always come from the pass drawn (review WFF3D-R3: satelliteOfDrape). */
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
    if (!d || cursorMs == null) {
      // at now: the 3D data's own pass; say so when the time history lists newer passes (review WFF3D-R8)
      const routeOk = route?.passes?.status === 'available'
      const shownMs = shownGranule(flood.satellite)?.acquired_ms ?? null
      const newer = newerPassThanShown(passesOf(routeOk ? route : flood.bundleTimeline), shownMs)
      const note = newer && flood.has.satellite ? fillCopy(FLOOD_3D.keySatNewer, { date: fmtDayDate(newer.acquired_ms, tf.tz, { year: 'auto', refMs: nowMs }) }) : null
      return { sat: flood.satellite, has: flood.has.satellite, noView: flood.has.noView, arr: flood.arrays.satellite, imageOnly: false, gridOnly: false, note }
    }
    const sat = satelliteOfDrape({ drape: d, base: flood.satellite, route, bundle: flood.bundleTimeline, cursorMs, nowMs, tf })
    const gap = gapNote(d.at, cursorMs, tf, nowMs)
    const gridOnly = d.source === 'bundle'
    if (d.mode === 'none') return { sat, has: false, noView: false, arr: null, imageOnly: false, gridOnly, note: sat?.reason ?? gap }
    const partly = d.pass?.view === 'partly_hidden'
    if (d.mode === 'bundle') return { sat: sat ?? flood.satellite, has: flood.has.satellite, noView: flood.has.noView, arr: flood.arrays.satellite, imageOnly: false, gridOnly, note: gap }
    if (d.mode === 'raster') return { sat, has: true, noView: partly, arr: raster, imageOnly: false, gridOnly, note: gap }
    return { sat, has: true, noView: partly, arr: null, imageOnly: true, gridOnly: false, note: gap }
  }, [flood, d, cursorMs, route, nowMs, tf, raster])
}

/** Brief 6 (playback): the NWS products the 3D view shows at the chart's handle (productsOnScreen.ts): the warning
 *  lines, the hover's NWS rows and the dock's NWS column all read this one answer (review WFF3D-R4). Null when the
 *  bundle's copy could not be read. */
export function useProductsOnScreen(flood: Pick<FloodSceneAssets, 'manifest' | 'warnings'> | null): ProductsOnScreen | null {
  const floodId = useFlood((s) => s.floodId)
  const cursorMs = useFlood((s) => s.cursorMs)
  const route = useFloodTimeline((s) => timelineFor(s, floodId))
  const nowMs = useNow(60_000)
  const copy = flood?.warnings ?? null
  const forThis = flood != null && floodId === flood.manifest.id
  return useMemo(() => productsOnScreenOf({ copy, route: forThis ? route : null, cursorMs, nowMs }), [copy, route, forThis, cursorMs, nowMs])
}
