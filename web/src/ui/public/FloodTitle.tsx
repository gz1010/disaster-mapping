// The flood view's title (brief 5, FloodView.dc.html "Title: place and date"; PLAN-5 §4.4): the place of the flood's
// point ("San Juan County, New Mexico") at 24 / 600, the date line in mono ("NOV 2 2026 — PRESENT", "SEEN BY DISASTER MAPPING
// SINCE NOV 3 2026", a past flood "NOV 2 2026 — LAST NWS PRODUCT NOV 5 2026"; never "ENDED") and the distance chip.
// The flood's name is the heading's first words for screen readers (the circle shows its short name).
// The chip (the fire chip's look, ui/public/DistanceChip.tsx DistanceChipView) measures, in order, to the edge of the
// NWS warning area, else to the NWS forecast flooded area, else to the primary member gauge, and says which
// (lib/areaDistance.ts, flood-only; floodView.ts distanceToFlood). Nothing here says or colours "safe".
import { useFloodAreas } from '../../official/floodHooks'
import { openFloodSummary, useFlood } from '../../state/flood'
import { useTimeFormatFor } from '../../state/timeZone'
import { useWorkspace } from '../../state/workspace'
import { FLOOD_PUBLIC } from '../shell/floodCopy'
import { DistanceChipView } from './DistanceChip'
import { TitleBlock } from './FireTitle'
import { distanceToFlood, floodChipText, floodDateLine, floodLabel, floodPlace } from './floodView'

export function FloodDistanceChip({ compact = false }: { compact?: boolean }) {
  const device = useWorkspace((s) => s.device)
  const units = useWorkspace((s) => s.units)
  const summary = useFlood((s) => openFloodSummary(s))
  const areas = useFloodAreas()
  const g = summary?.primary_gauge ?? null
  const d = device ? distanceToFlood(device, { warnings: areas.warnings, forecast: areas.forecast, gauge: g }) : null
  const measure = d ? { text: floodChipText(d, units), inside: d.inside, bearing: d.bearingDeg } : null
  return <DistanceChipView compact={compact} measure={measure} />
}

export function FloodTitle({ chip = true, compact = false }: { chip?: boolean; compact?: boolean }) {
  const summary = useFlood((s) => openFloodSummary(s))
  const loading = useFlood((s) => s.detailLoading)
  const tf = useTimeFormatFor(summary?.time_zone)
  const place = floodPlace(summary)
  const date = floodDateLine(summary, tf.tz)
  return (
    <TitleBlock
      compact={compact}
      srName={summary ? floodLabel(summary.name) : null}
      place={place ?? (loading ? FLOOD_PUBLIC.loadingFlood : FLOOD_PUBLIC.floodFallback)}
      date={date}
      chip={chip && summary ? <FloodDistanceChip compact={compact} /> : null}
    />
  )
}
