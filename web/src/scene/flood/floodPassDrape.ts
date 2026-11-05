// The satellite pass the 3D flood view drapes at the river-level chart's handle (brief 6, decision 2; M4 of
// web-forensic-flood-3d): the pass list from GET /timeline (state/floodTimeline.ts, web-flood-playback), the pass
// rasters from the bundle's timeline.json joined by key. Until playback is wired, the bundle's own shown pass.
import type { PassOnScreen } from './depthChoice'
import type { FloodSceneAssets } from './floodAssets'

/** The playback pass on screen (null: the bundle's own satellite layer). */
export function usePassOnScreen(flood: Pick<FloodSceneAssets, 'manifest'> | null): PassOnScreen | null {
  void flood
  return null
}
