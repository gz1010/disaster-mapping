// The fire view's hazard circle (brief 4 H4, FireView.dc.html "Fire name dot"; PLAN-4 §3.4, decision i-10; HANDOFF
// "Fire view"): a 312 px round button with a thermal texture (an SVG feTurbulence smoky glow, brightest at the
// bottom left, slowly drifting; twinkling specks; film grain; no grid), the status words from the agency record
// ("WILDFIRE · ACTIVE"; ui/public/fireView.ts hazardStatus), the fire's name (72 px / 800, fitted down to 40 px over two
// lines, a long name down to 28 px over three; the full name is the button's accessible name and, when drawn small or
// cut, its tooltip) and "MORE IN COMMAND ›", which opens the Command view.
// Motion: the SMIL animations are left out under prefers-reduced-motion (the texture stands still) and paused while the
// tab is hidden (svg.pauseAnimations). Filter and gradient ids are unique per instance (useId). A fire that is not
// listed as active glows darker (the record's words say why); a demo fire says it is simulated.
// Brief 5 (PLAN-5 §4.8): the drawing is ui/public/HazardDisc.tsx (shared with the flood circle); this container reads
// the fire and its record and draws exactly what brief 4 drew.
import type { Ref } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useRecord } from '../../official/hooks'
import { useStore } from '../../state/store'
import { useTimeFormat } from '../../state/timeZone'
import { isDemoBundle } from '../../state/workspace'
import { applyView } from '../shell/views'
import { fireEnd, fireLabel, hazardStatus } from './fireView'
import { HazardDisc } from './HazardDisc'

export { CIRCLE_PX } from './HazardDisc'

export function HazardCircle({ ref, compact = false }: { ref?: Ref<HTMLButtonElement>; compact?: boolean }) {
  const { summary, demo } = useStore(
    useShallow((s) => ({ summary: s.summary && s.summary.id === s.incidentId ? s.summary : null, demo: isDemoBundle(s.incidentId, s.manifest) })),
  )
  const record = useRecord()
  const tf = useTimeFormat()
  const issuer = summary?.record_issuer || null
  const status = hazardStatus(summary, fireEnd(summary, record), demo, issuer, tf.tz)
  const name = summary?.name ?? ''
  return (
    <HazardDisc
      ref={ref}
      texture="thermal"
      tone={status.tone}
      statusLine={status.line}
      name={name}
      meaning={status.meaning}
      label={`${name ? fireLabel(name) : 'This fire'}: ${status.line.replace(' · ', ', ').toLowerCase()}. More in Command view`}
      tip="Open this fire in the Command view: the timeline, the experimental model, coordinates and every source"
      onClick={() => applyView('command')}
      compact={compact}
    />
  )
}
