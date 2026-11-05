// Zoom dimming (brief 6, decision 4): the globe-like vignette of the map's atmosphere (map/MapAtmosphere.tsx,
// styles/atmosphere.css), which darkens the map's edges more as you zoom in, is OFF by default. The "Zoom dimming"
// switch in the Layers / settings drawer turns it on (ui/shell/ZoomDimmingSwitch.tsx), and the choice is remembered in
// this browser (localStorage). Storage may be missing or refuse access (private windows, blocked site data, the Node
// tests): every read and write is wrapped, and an unreadable choice counts as off. The static edge gradients behind
// the panels' text are not switched: they keep the text readable either way.

/** localStorage key (internal names keep the old `fire3d` prefix, as every other stored preference does). */
export const ZOOM_DIMMING_KEY = 'fire3d.zoomDimming'
/** Off unless the user turned it on in this browser. */
export const ZOOM_DIMMING_DEFAULT = false

/** The Layers / settings drawers' section that holds the switch. */
export const DISPLAY_SECTION_TITLE = 'Display'
export const ZOOM_DIMMING_LABEL = 'Zoom dimming'
export const ZOOM_DIMMING_DESC =
  "Darkens the map's edges more as you zoom in, like the rim of a globe. Off by default; remembered in this browser. The soft shading behind the panels' text stays either way."

type ReadStore = Pick<Storage, 'getItem'>
type WriteStore = Pick<Storage, 'setItem'>

/** The browser's localStorage, or null when there is none or it cannot be reached. */
function browserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

/** The remembered choice: true only when this browser stored "on"; off when nothing is stored or storage fails. */
export function readZoomDimming(storage: ReadStore | null = browserStorage()): boolean {
  if (!storage) return ZOOM_DIMMING_DEFAULT
  try {
    const v = storage.getItem(ZOOM_DIMMING_KEY)
    return v === '1' ? true : v === '0' ? false : ZOOM_DIMMING_DEFAULT
  } catch {
    return ZOOM_DIMMING_DEFAULT
  }
}

/** Remember the choice ("1" on, "0" off). Never throws: without storage the choice lasts until the page reloads. */
export function writeZoomDimming(on: boolean, storage: WriteStore | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(ZOOM_DIMMING_KEY, on ? '1' : '0')
  } catch {
    // storage full or refused: the switch still works for this visit
  }
}
