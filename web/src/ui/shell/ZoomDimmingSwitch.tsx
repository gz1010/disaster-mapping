// "Zoom dimming" (brief 6, decision 4): the switch for the map's zoom-following globe vignette, in the Display section
// of both Layers / settings drawers (ui/shell/LayersPanel.tsx for the overview and fires, FloodLayersPanel.tsx for
// floods). Off by default; the choice is remembered in this browser (useWorkspace.setZoomDimming, map/zoomDimming.ts).
// A native checkbox with the switch role, in the drawer's own row style, so it reads "Zoom dimming, switch, off" to a
// screen reader and works with the keyboard (Space) and a click on its words like the layer toggles above it. It is
// drawn as the app's small pill switch (the "Show watches" look, `.mw-switch` in styles/map-layout.css). The native
// checked state is the switch's state: no aria-checked on top of it (review RD-R6; ARIA in HTML).
import { DISPLAY_SECTION_TITLE, ZOOM_DIMMING_DESC, ZOOM_DIMMING_LABEL } from '../../map/zoomDimming'
import { useWorkspace } from '../../state/workspace'

export function ZoomDimmingSwitch() {
  const on = useWorkspace((s) => s.zoomDimming)
  return (
    <ul className="mw-check-list">
      <li>
        <label className="mw-check-row">
          <input type="checkbox" role="switch" className="mw-switch" checked={on} onChange={(e) => useWorkspace.getState().setZoomDimming(e.target.checked)} />
          <span className="mw-check-text">
            <span className="mw-check-label">{ZOOM_DIMMING_LABEL}</span>
            <span className="mw-check-desc">{ZOOM_DIMMING_DESC}</span>
          </span>
        </label>
      </li>
    </ul>
  )
}

/** The drawers' "Display" section (the drawers' own section markup) holding the switch. */
export function DisplaySection() {
  return (
    <section className="mw-set">
      <div className="mw-set-head">
        <h3>{DISPLAY_SECTION_TITLE}</h3>
      </div>
      <ZoomDimmingSwitch />
    </section>
  )
}
