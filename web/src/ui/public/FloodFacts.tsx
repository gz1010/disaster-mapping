// The flood view's official facts (brief 5, FloodView.dc.html "Official facts"; PLAN-5 §4.4 facts per kind, D5, D11,
// D24, C4, C7): "value — LABEL" rows (ui/shell/Readout.tsx ReadoutRow, the fire facts' structure) from the official
// answers of the open flood (official/floodHooks.ts) and its member gauges only (ui/public/floodView.ts floodFacts):
//   river           NWS forecast flooded area "Mapped" / "Not mapped here" (never a number), river stage (USGS) at the
//                   primary member gauge, forecast crest (or FORECAST HIGH when still rising at the forecast's end)
//   flash, areal    flash flood detection and damage threat (NWS's words, verbatim), a member gauge or "No river gauge in
//                   this flood"
//   watch only      the watch area (NWS's words), member gauges, the river forecast
//   then            the start, the highest NWS product with its own end and sender, evacuations (flood wording),
//                   local officials' alerts while one is in effect, the last official update
// Each value is the issuer's own, with its own time and a link under it; an issuer's words are inside data-verbatim.
// Quiet rows say why ("Unavailable right now", "Checking…") and are never an all-clear. Under the rows: OFFICIAL (or DEMO)
// with the sources and when they were checked, "Not an all-clear. Follow local officials." and "NWS water". Between the
// rows and that foot: the preparation of the flood's map data (FloodMapData). On short windows the rows scroll and the
// foot stays in view.
import { ChevronDown } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useExtrasRuntime } from '../../extras/runtime'
import { useFloodOfficial } from '../../official/floodHooks'
import { localAlertsState } from '../../official/localAlerts'
import { openFloodSummary, useFlood } from '../../state/flood'
import { useTimeFormatFor } from '../../state/timeZone'
import { useWorkspace } from '../../state/workspace'
import { ProgressBar } from '../controls'
import { useNow } from '../hooks'
import { FLOOD_PUBLIC, NOT_ALL_CLEAR } from '../shell/floodCopy'
import { localAlertsLine } from '../shell/officialSummary'
import { ReadoutRow } from '../shell/Readout'
import { floodFacts, floodFactsSource, type FloodFactRow } from './floodView'
import { floodPrepState } from '../../state/floodBuild'

function Sub({ r }: { r: FloodFactRow }) {
  if (!r.sub && !r.subVerbatim && !r.link) return null
  const parts: ReactNode[] = []
  if (r.subVerbatim) parts.push(<span key="v" data-verbatim="">{r.subVerbatim}</span>)
  if (r.sub) parts.push(<span key="s">{r.sub}</span>)
  if (r.link)
    parts.push(
      <a key="l" href={r.link.url} target="_blank" rel="noreferrer noopener">
        {r.link.label}
      </a>,
    )
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 ? ' · ' : null}
          {p}
        </span>
      ))}
    </>
  )
}

/** The flood's map data (terrain and frozen copies of its layers, C10): prepare, preparing with progress, failed. */
export function FloodMapData() {
  const s = useFlood(useShallow((st) => ({ id: st.floodId, summary: openFloodSummary(st), manifest: st.manifest, job: st.job, loading: st.detailLoading, error: st.buildError })))
  const prep = floodPrepState(s)
  if (prep.kind === 'none') return null
  if (prep.kind === 'building')
    return (
      <div className="pfv-prep is-building" role="status" aria-live="polite">
        <p className="pfv-prep-text">
          {FLOOD_PUBLIC.preparing}
          {prep.step ? <span className="pfv-prep-step"> · {prep.step}</span> : null}
        </p>
        <ProgressBar value={prep.progress} tone="fire" label="Map data preparation" />
      </div>
    )
  return (
    <div className="pfv-prep">
      <p className="pfv-prep-text">
        {prep.kind === 'failed' ? FLOOD_PUBLIC.prepareFailed : FLOOD_PUBLIC.notPrepared}
        {prep.error ? <span className="pfv-prep-step"> · {prep.error}</span> : null}
      </p>
      <button type="button" className="pfv-prep-btn" onClick={() => void useFlood.getState().startFloodBuild(prep.kind === 'failed')}>
        {prep.kind === 'failed' ? FLOOD_PUBLIC.prepareAgain : FLOOD_PUBLIC.prepare}
      </button>
    </div>
  )
}

/** The facts rows of the open flood (pure part: floodView.ts floodFacts). */
function useFloodFacts(): { rows: FloodFactRow[]; source: ReturnType<typeof floodFactsSource> } {
  const summary = useFlood((s) => openFloodSummary(s))
  const off = useFloodOfficial(useShallow((s) => ({ alerts: s.alerts, gauges: s.gauges, fim: s.fim, local: s.local })))
  const evac = useExtrasRuntime((s) => s.evac)
  const units = useWorkspace((s) => s.units)
  const tf = useTimeFormatFor(summary?.time_zone)
  const nowMs = useNow(30_000)
  return useMemo(() => {
    const localLine = summary?.mode === 'live' && off.local.data ? localAlertsLine(localAlertsState(off.local), tf, null, units === 'metric') : null
    const input = {
      summary,
      alerts: off.alerts,
      gauges: off.gauges,
      fim: off.fim,
      evac: { data: evac.data, loading: evac.loading, error: evac.error },
      local: localLine ? { text: localLine.text, link: localLine.link ?? null } : null,
      tf,
      nowMs,
      units,
    }
    return { rows: floodFacts(input), source: floodFactsSource(input) }
  }, [summary, off, evac, units, tf, nowMs])
}

function FactRowView({ r }: { r: FloodFactRow }) {
  const value = r.verbatim ? <span data-verbatim="">{r.value}</span> : r.value
  const sub = r.sub || r.subVerbatim || r.link ? r.tip ? <span data-tip={r.tip}><Sub r={r} /></span> : <Sub r={r} /> : undefined
  return <ReadoutRow value={value} unit={r.unit} label={r.label} size={r.size} tone={r.tone} sub={sub} />
}

/** `peek` (phones): the first two rows of the flood's kind. `more` (the desktop column, useFactsFit): rows are hidden
 *  below; the foot shows "More below", which scrolls them into view with `onMore`. */
export function FloodFacts({ peek = false, more = false, onMore }: { peek?: boolean; more?: boolean; onMore?: () => void } = {}) {
  const { rows, source } = useFloodFacts()
  const shown = peek ? rows.slice(0, 2) : rows
  return (
    <section className={`pfv-facts ffv-facts${peek ? ' is-peek' : ''}`} aria-label="Official information">
      <div className="pfv-facts-rows">
        {shown.map((r) => (
          <FactRowView key={r.key} r={r} />
        ))}
      </div>
      {!peek && <FloodMapData />}
      <div className="pfv-facts-foot">
        {more && onMore && (
          <button type="button" className="pfv-more" onClick={onMore} data-tip="More official facts below: scroll the list">
            More below <ChevronDown size={13} aria-hidden="true" />
          </button>
        )}
        <p className="pfv-src">
          {source.badge === 'official' && <span className="pfv-badge">Official</span>}
          {source.badge === 'demo' && <span className="pfv-badge is-demo">Demo</span>}
          <span>{source.line}</span>
        </p>
        <p className="pfv-clear">
          {NOT_ALL_CLEAR}{' '}
          <a href={FLOOD_PUBLIC.waterUrl} target="_blank" rel="noreferrer noopener">
            {FLOOD_PUBLIC.waterLink}
          </a>
        </p>
      </div>
    </section>
  )
}
