// Runs the optional-source data hooks once for the Public/Command workspace and publishes them to useExtrasRuntime
// (owner: ui-integration; CONTRACT §12.3 item 1). Renders nothing. Each source is fetched only while its layer toggle
// is on, for the incident's area (analysis area + the source's margin) and the timeline position (extrasAtMs: current
// status only at / after the live NOW marker, otherwise "not available for past dates"; imagery up to the selected
// time). While the timeline plays, the query time is held so playback never fetches; it catches up on pause.
// Brief 5 (PLAN-5 §4.1, D23): with a flood open, evacuations are asked for the flood's area (its bbox + 10 %, from
// state/selectors.ts currentArea) with hazard=flood, for now; cameras and the fire imagery chip are not fetched.
import { useEffect, useLayoutEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { openFloodSummary, useFlood } from '../state/flood'
import { floodArea } from '../state/selectors'
import { nowMarkerMs, useStore } from '../state/store'
import { useWorkspace } from '../state/workspace'
import { useNow } from '../ui/hooks'
import { DEFAULT_MARGIN_KM, extrasAtMs, incidentAreaBbox, type AreaQuery } from './client'
import { useCameraFrame, useCameras, useEvacuations, useImagery } from './hooks'
import { imagerySummaryAtMs, pickDefaultImagery } from './imagery'
import { sameQueryState, useExtrasRuntime, type ExtrasRuntimeState } from './runtime'
import { officialTimeReady, useOfficialSync } from '../official/runtime'

interface QueryTimes {
  evac: number | null
  cams: number | null
  imgs: number | null
}

export function ExtrasSync() {
  const on = useWorkspace(useShallow((s) => ({ evacuation: s.mapLayers.evacuation, cameras: s.mapLayers.cameras, recentImagery: s.mapLayers.recentImagery })))
  const now = useNow(60_000)
  const { incidentId, summary, manifest, playing, timeReady } = useStore(
    useShallow((s) => ({
      incidentId: s.incidentId,
      // the summary of the incident being shown (it can lag one render behind a switch)
      summary: s.summary && s.summary.id === s.incidentId ? s.summary : null,
      manifest: s.manifest?.status === 'ready' && s.manifest.id === s.incidentId ? s.manifest : null,
      playing: s.playing,
      timeReady: officialTimeReady(s),
    })),
  )
  const at = useStore(
    useShallow((s): QueryTimes => {
      const mode = s.manifest?.mode ?? s.summary?.mode ?? s.mode
      const m = s.manifest?.status === 'ready' ? s.manifest : null
      const marker = nowMarkerMs(m, s.forecast)
      return {
        evac: extrasAtMs('evacuations', mode, s.timeMs, now, marker),
        cams: extrasAtMs('cameras', mode, s.timeMs, now, marker),
        imgs: extrasAtMs('imagery', mode, s.timeMs, now, marker),
      }
    }),
  )
  // hold the query times while playing (adjusting state during render: React's "previous render" pattern)
  const [held, setHeld] = useState<QueryTimes>(at)
  if (!playing && (held.evac !== at.evac || held.cams !== at.cams || held.imgs !== at.imgs)) setHeld(at)
  const times = playing ? held : at

  // brief 5: the open flood's area (no fire open); a flood's evacuations are for now (current status only)
  const floodBbox = useFlood((s) => {
    const f = s.floodId != null && incidentId == null ? openFloodSummary(s) : null
    return f ? floodArea(f.bbox_lonlat)?.join(',') ?? null : null
  })
  const floodQuery: AreaQuery | null = floodBbox ? { bbox: floodBbox.split(',').map(Number) as [number, number, number, number], hazard: 'flood', atMs: null } : null
  const query = (k: 'evacuations' | 'cameras' | 'imagery', atMs: number | null): AreaQuery | null => {
    if (floodQuery) return k === 'evacuations' ? floodQuery : null
    const bbox = incidentAreaBbox(summary, manifest, DEFAULT_MARGIN_KM[k])
    // wait for the fire's own timeline: right after a switch the time still belongs to the previous fire; a fire
    // without a ready bundle has no timeline and is asked for the present
    return bbox && incidentId && timeReady ? { bbox, incident: incidentId, atMs: timeReady === 'present' ? null : atMs } : null
  }
  // brief 2: official evacuation status is checked for the open fire whatever the map layer shows (the feed, "Official
  // now" and the location card need it); the toggle only hides the zones on the map.
  const evac = useEvacuations(query('evacuations', times.evac), true)
  const cams = useCameras(query('cameras', times.cams), on.cameras)
  // the satellite chip names the newest image even while the layer is off: then one list per incident (up to the end
  // of the record), filtered by the timeline time in the chip; with the layer on, the list follows the timeline
  const imgs = useImagery(query('imagery', on.recentImagery ? times.imgs : imagerySummaryAtMs(manifest, now)), true)
  useOfficialSync()
  const frame = useCameraFrame()
  const productChoice = useExtrasRuntime((s) => s.productChoice)
  const product =
    productChoice === undefined ? pickDefaultImagery(imgs.data, summary?.started_ms ?? null) : productChoice ? (imgs.data?.products.find((p) => p.id === productChoice) ?? null) : null

  // a new incident: forget the selected camera, image and zone; drop a loaded camera image
  const clearFrame = frame.clear
  useEffect(() => {
    useExtrasRuntime.getState().resetChoices()
    clearFrame()
  }, [incidentId, floodBbox, clearFrame])

  useLayoutEffect(() => {
    const cur = useExtrasRuntime.getState()
    const patch: Partial<ExtrasRuntimeState> = {}
    if (!sameQueryState(cur.evac, evac)) patch.evac = evac
    if (!sameQueryState(cur.cams, cams)) patch.cams = cams
    if (!sameQueryState(cur.imgs, imgs)) patch.imgs = imgs
    const f = cur.frame
    if (f.cameraId !== frame.cameraId || f.frame !== frame.frame || f.loading !== frame.loading || f.error !== frame.error || f.request !== frame.request) patch.frame = frame
    if (cur.product !== product) patch.product = product
    if (Object.keys(patch).length) useExtrasRuntime.setState(patch)
  })

  // leaving the map workspace: the hooks abort; readers must not keep showing their last answers
  useEffect(
    () => () => {
      useExtrasRuntime.setState({ evac: { ...useExtrasRuntime.getState().evac, data: null, loading: false }, cams: { ...useExtrasRuntime.getState().cams, data: null, loading: false }, imgs: { ...useExtrasRuntime.getState().imgs, data: null, loading: false }, product: null })
    },
    [],
  )
  return null
}
