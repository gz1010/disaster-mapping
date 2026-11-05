// React hooks of the brief-6 3D flood view (web-forensic-flood-3d), shared by the scene (DepthSurface) and the panels
// (the scene key, the Layers tab, the hover readout): the height boost in use and the depth surface on screen.
import { create } from 'zustand'
import { useStore } from '../../state/store'
import { useForensicFlood } from '../../ui/forensic-flood/forensicFloodState'
import { depthShown, type DepthShown, type PassOnScreen } from './depthChoice'
import type { FloodSceneAssets } from './floodAssets'
import { usePassOnScreen } from './floodPassDrape'

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
export function useDepthShown(flood: Pick<FloodSceneAssets, 'manifest' | 'has' | 'terrain3d'> | null): DepthShown | null {
  const choice = useForensicFlood((s) => s.depthFrom)
  const pass: PassOnScreen | null = usePassOnScreen(flood)
  if (!flood) return null
  return depthShown({ terrain3d: flood.terrain3d, has: flood.has, choice, pass, layers: flood.manifest.layers })
}

/** The depth raster the scene shows right now (set by DepthSurface; null when no surface is drawn), for the hover
 *  readout. */
export const depthOnScreen = create<{ data: Uint8Array | null }>(() => ({ data: null }))
