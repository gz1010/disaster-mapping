// The Fires | Floods switch (brief 5 decision 1, PLAN-5 §4.2, D7; CONTRACT §16.12): a 28 px segmented pill in the top
// bar's title slot, after "United States ·" (Public and Command overviews, Forensic's "open an event first" page). Glass
// rgba(14,14,14,.6), hairline, the active option accent #ff7a3d with ink #1a0a03 (every selected state's look); each
// option has a 10 px glyph: a fire dot (#ff8a3c) or a water drop (#7fd4ff). A radiogroup: arrow keys move and pick,
// as the view pill does. Smaller than and left of the view pill. Switching keeps the camera, the selected point, the
// preset and Show details (state/workspace.ts setHazard). Styles: styles/flood-overview.css.
import type { KeyboardEvent } from 'react'
import { useWorkspace, type Hazard } from '../../state/workspace'
import { FLOOD_OVERVIEW } from '../shell/floodCopy'
import '../../styles/flood-overview.css'

const OPTIONS: { value: Hazard; label: string; tip: string }[] = [
  { value: 'fire', label: FLOOD_OVERVIEW.fires, tip: 'Show wildfires: agency fire records (CAL FIRE, NIFC)' },
  { value: 'flood', label: FLOOD_OVERVIEW.floods, tip: 'Show floods: NWS flood products and river gauges at flood stage' },
]

function Glyph({ hazard }: { hazard: Hazard }) {
  if (hazard === 'fire')
    return (
      <svg className="hz-glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <circle cx="5" cy="5" r="3.6" fill="#ff8a3c" />
      </svg>
    )
  return (
    <svg className="hz-glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 0.6 C6.6 3 8.2 4.8 8.2 6.6 A3.2 3.2 0 0 1 1.8 6.6 C1.8 4.8 3.4 3 5 0.6 Z" fill="#7fd4ff" />
    </svg>
  )
}

/** The switch. `size` 'sm' (28 px, the bar) or 'md' (32 px). */
export function HazardSwitch({ size = 'sm', className }: { size?: 'sm' | 'md'; className?: string }) {
  const hazard = useWorkspace((s) => s.hazard)
  const setHazard = useWorkspace((s) => s.setHazard)
  const pickWithKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const i = OPTIONS.findIndex((o) => o.value === hazard)
    const n = OPTIONS.length
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + n) % n
    setHazard(OPTIONS[next].value)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.hz-switch .hz-btn[data-hazard="${OPTIONS[next].value}"]`)?.focus({ preventScroll: true }))
  }
  return (
    <div className={`hz-switch hz-switch-${size}${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={FLOOD_OVERVIEW.switchName} onKeyDown={pickWithKeys}>
      {OPTIONS.map((o) => {
        const on = o.value === hazard
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className="hz-btn"
            data-hazard={o.value}
            data-tip={o.tip}
            onClick={() => setHazard(o.value)}
          >
            <Glyph hazard={o.value} />
            <span>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
