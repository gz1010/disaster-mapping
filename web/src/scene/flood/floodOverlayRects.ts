// Boxes of the 3D flood view's own UI that float over the scene without being part of its insets (review WFF-R8): the
// column under the compass (entry controls, demo badge, scene key) and the prototype pill. The gauge bar labels hide
// under them (GaugeBars.tsx, gaugeBarMath.placeBarLabel). Viewport pixels, kept current by ui/forensic-flood
// (FloodForensic.tsx) with a ResizeObserver; read every frame, allocation free.
import type { ScreenRect } from './gaugeBarMath'

const rects = new Map<string, ScreenRect>()
let list: ScreenRect[] = []

/** Set (or clear, with null) one named box. */
export function setFloodOverlayRect(id: string, r: ScreenRect | null): void {
  if (r && r.right > r.left && r.bottom > r.top) rects.set(id, { left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  else rects.delete(id)
  list = [...rects.values()]
}

/** The current boxes (viewport pixels). */
export function floodOverlayRects(): readonly ScreenRect[] {
  return list
}
