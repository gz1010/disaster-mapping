import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeManifest, ZONE11 } from '../../location/fixtures.testutil'
import { useMapRuntime } from '../../map/mapStore'
import { useSceneStore, type CameraInfo } from '../../scene/sceneStore'
import { useStore } from '../../state/store'
import { useWorkspace } from '../../state/workspace'
import { returnBearing, switchWorkspace } from './handoff'

// Forensic frames a fire at its own default azimuth (337.5°); the map must not inherit it unless the user turned the
// Forensic camera (review H2-B2, decision k).
const FORENSIC_DEFAULT = 337.5
const cam = (bearingDeg: number): CameraInfo => ({ bearingDeg, polarDeg: 0, distance: 4000, metersPerPixel: 10, target: [0, 0, 0] })

describe('workspace hand-off heading (decision k)', () => {
  it('returns the Forensic heading only when the user turned it there', () => {
    expect(returnBearing(FORENSIC_DEFAULT, false, 0)).toBe(0)
    expect(returnBearing(FORENSIC_DEFAULT, false, -60)).toBe(-60)
    expect(returnBearing(FORENSIC_DEFAULT, false, null)).toBe(0)
    expect(returnBearing(120, true, 0)).toBe(120)
  })

  describe('map -> Forensic -> map', () => {
    beforeEach(() => {
      useStore.setState({ manifest: makeManifest(ZONE11) })
      useSceneStore.setState({ camera: null, interacting: false, cameraCommand: null })
      // the map centre outside the analysis area: Forensic frames the fire (flyTo null), at its own azimuth
      useWorkspace.setState({ workspace: 'map', perspective: '2d', view: { centerLon: -100, centerLat: 40, zoom: 9, bearing: 0, pitch: 0 } })
      useMapRuntime.setState({ camera: null })
    })

    it('keeps a north-up 2D map north up when Forensic was not turned', () => {
      switchWorkspace('forensic')
      expect(useWorkspace.getState().workspace).toBe('forensic')
      // Forensic frames the fire at its default azimuth (a tween, not the user)
      useSceneStore.getState().setCamera(cam(FORENSIC_DEFAULT))
      useSceneStore.getState().issueCameraCommand('frame-fire')
      useSceneStore.getState().setCamera(cam(FORENSIC_DEFAULT + 0.01))
      switchWorkspace('map')
      expect(useWorkspace.getState().workspace).toBe('map')
      expect(useWorkspace.getState().view?.bearing).toBe(0)
      expect(useWorkspace.getState().view?.pitch).toBe(0)
    })

    it("gives a turned map back its own heading, and carries the user's Forensic turn", () => {
      useWorkspace.setState({ view: { centerLon: -100, centerLat: 40, zoom: 9, bearing: -60, pitch: 0 } })
      switchWorkspace('forensic')
      useSceneStore.getState().setCamera(cam(FORENSIC_DEFAULT))
      switchWorkspace('map')
      expect(useWorkspace.getState().view?.bearing).toBe(-60)

      // now the user drags the Forensic camera around (the map centre outside the analysis area again)
      useWorkspace.setState({ view: { centerLon: -100, centerLat: 40, zoom: 9, bearing: -60, pitch: 0 } })
      switchWorkspace('forensic')
      useSceneStore.getState().setCamera(cam(FORENSIC_DEFAULT))
      useSceneStore.getState().setInteracting(true)
      useSceneStore.getState().setCamera(cam(100))
      useSceneStore.getState().setInteracting(false)
      switchWorkspace('map')
      expect(useWorkspace.getState().view?.bearing).toBe(100)
    })

    it("counts the Forensic compass's north up as the user's turn", () => {
      useWorkspace.setState({ view: { centerLon: -100, centerLat: 40, zoom: 9, bearing: -60, pitch: 0 } })
      switchWorkspace('forensic')
      useSceneStore.getState().setCamera(cam(FORENSIC_DEFAULT))
      useSceneStore.getState().issueCameraCommand('reset-north')
      useSceneStore.getState().setCamera(cam(0))
      switchWorkspace('map')
      expect(useWorkspace.getState().view?.bearing).toBe(0)
    })
  })
})

describe('brief 5: the hand-off of an open flood (its grid, the same heading rule)', () => {
  it("map -> Forensic flies to the map's centre inside the flood's 3D area, with the map's heading; back keeps it", async () => {
    const { useFlood } = await import('../../state/flood')
    const { DETAIL } = await import('../../api/__fixtures__/floods/edgeCases')
    const { openEventGrid } = await import('./handoff')
    const d = DETAIL()
    const m = d.manifest!
    useStore.setState({ manifest: null, incidentId: null, flyTo: null })
    useFlood.setState({ floodId: m.id, manifest: m, summary: d.summary })
    useSceneStore.setState({ camera: null, interacting: false, cameraCommand: null })
    const [w, s, e, n] = m.grid.bbox_lonlat
    const centerLon = (w + e) / 2
    const centerLat = (s + n) / 2
    useWorkspace.setState({ workspace: 'map', perspective: '2d', view: { centerLon, centerLat, zoom: 12, bearing: 40, pitch: 0 } })
    useMapRuntime.setState({ camera: null })
    vi.stubGlobal('window', { innerHeight: 1000 })
    expect(openEventGrid()).toMatchObject({ kind: 'flood', id: 'fixture-flood' })
    switchWorkspace('forensic')
    const fly = useStore.getState().flyTo
    expect(fly).not.toBeNull()
    expect(Math.abs(fly!.x)).toBeLessThan(m.grid.extent_m / 2)
    expect(fly!.bearingDeg).toBe(40)
    // back to the map: the Forensic camera's target in the flood's grid, the map's own heading (not turned)
    useSceneStore.getState().setCamera({ bearingDeg: 337.5, polarDeg: 30, distance: 4000, metersPerPixel: 10, target: [0, 0, 0] })
    switchWorkspace('map')
    const v = useWorkspace.getState().view!
    expect(v.bearing).toBe(40)
    expect(Math.abs(v.centerLon - centerLon)).toBeLessThan(0.05)
    useFlood.setState({ floodId: null, manifest: null, summary: null })
    expect(openEventGrid()).toBeNull()
    vi.unstubAllGlobals()
  })
})
