// The flood view's hazard circle (brief 5, FloodView.dc.html "Flood name dot"; PLAN-5 §4.4, D19, C15): the 312 px
// disc (ui/public/HazardDisc.tsx) with the design's water texture (ui/public/WaterTexture.tsx: muddy grey-green rushing
// water, mist, slanted rain, grain), the NWS product as the status ("FLOOD · WARNING", "FLASH FLOOD · EMERGENCY", never
// ACTIVE / ENDED / OVER / CLEAR), the short name ("Ridge Fork"; the whole name is the accessible name and the tooltip's
// start) and "MORE IN COMMAND ›". The hidden meaning line names the issuer and the product's own end time in the
// flood's zone ("NWS Albuquerque NM has a Flood Warning in effect for this area until …"). A watch, a flood with no NWS
// product now and a past flood are drawn quiet (a watch keeps its rain); simulated data says so.
// Motion: none under prefers-reduced-motion; paused while the tab is hidden (HazardDisc).
import type { Ref } from 'react'
import { openFloodSummary, useFlood } from '../../state/flood'
import { useTimeFormatFor } from '../../state/timeZone'
import { useNow } from '../hooks'
import { FLOOD_PUBLIC } from '../shell/floodCopy'
import { applyView } from '../shell/views'
import { floodCircleLabel, floodCircleStatus, floodShortName } from './floodView'
import { HazardDisc } from './HazardDisc'

export function FloodHazardCircle({ ref, compact = false }: { ref?: Ref<HTMLButtonElement>; compact?: boolean }) {
  const summary = useFlood((s) => openFloodSummary(s))
  const tf = useTimeFormatFor(summary?.time_zone)
  const nowMs = useNow(60_000)
  const status = floodCircleStatus(summary, tf, nowMs)
  const name = summary?.name ?? ''
  return (
    <HazardDisc
      ref={ref}
      texture="water"
      tone={status.tone}
      statusLine={status.line}
      name={name ? floodShortName(name) : ''}
      meaning={status.meaning}
      label={floodCircleLabel(name, status)}
      tip={FLOOD_PUBLIC.circleTip}
      tipName={name || undefined}
      onClick={() => applyView('command')}
      compact={compact}
      rain={status.rain}
    />
  )
}
