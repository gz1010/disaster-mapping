// The fire view's title (brief 4 H4, FireView.dc.html "Title: place and date"; PLAN-4 §3.4): the place (the record's
// own location text, else "<County> County, <State>") at 24 / 600, and "JUN 28 2026 — PRESENT" in mono (the record's
// end with its own label when the fire is not listed as active: "SEP 1 2025 — CONTAINED NOV 14 2025"), then the
// distance chip. The fire's name is the heading's first words for screen readers (it is shown in the hazard circle).
// Brief 5 (PLAN-5 §4.4, §4.8): the layout is the presentational TitleBlock, shared with the flood view's title
// (ui/public/FloodTitle.tsx); this container reads the fire and draws exactly what brief 4 drew.
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useRecord } from '../../official/hooks'
import { useStore } from '../../state/store'
import { useTimeFormat } from '../../state/timeZone'
import { placeLine } from '../shell/topBarText'
import { DistanceChip } from './DistanceChip'
import { fireDateLine, fireEnd, fireLabel, recordActive } from './fireView'

export function FireTitle({ chip = true, compact = false }: { chip?: boolean; compact?: boolean }) {
  const { summary, loading } = useStore(useShallow((s) => ({ summary: s.summary && s.summary.id === s.incidentId ? s.summary : null, loading: s.incidentLoading })))
  const record = useRecord()
  const tf = useTimeFormat()
  const place = placeLine(summary)
  const date = summary ? fireDateLine(summary.started_ms, recordActive(summary), fireEnd(summary, record), tf.tz) : null
  return (
    <TitleBlock
      compact={compact}
      srName={summary ? fireLabel(summary.name) : null}
      place={place ?? summary?.name ?? (loading ? 'Loading the fire…' : 'Fire')}
      date={date}
      chip={chip && summary ? <DistanceChip compact={compact} /> : null}
    />
  )
}

/** The title's layout: the place (h1, the event's name first for screen readers), the mono date line and the chip. */
export function TitleBlock({ compact = false, srName, place, date, chip }: { compact?: boolean; srName: string | null; place: string; date: string | null; chip?: ReactNode }) {
  return (
    <div className={`pfv-title${compact ? ' is-compact' : ''}`}>
      <h1 className="pfv-place">
        {srName && <span className="mw-sr-only">{srName} · </span>}
        {place}
      </h1>
      {date && <p className="pfv-date">{keepDatesWhole(date)}</p>}
      {chip}
    </div>
  )
}

/** Each "DEC 15 2025" in the line stays on one line where the line wraps (phones): it breaks between words only. */
function keepDatesWhole(line: string) {
  return line.split(/([A-Z]{3} \d{1,2} \d{4})/).map((part, i) => (i % 2 ? <span key={i} className="pfv-date-day">{part}</span> : part))
}
