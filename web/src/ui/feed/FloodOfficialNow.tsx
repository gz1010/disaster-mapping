// "Official now" of a flood (brief 5, PLAN-5 §4.5 right panel; D23, D24, C1; CONTRACT §16.4): Command's one-line rows
// (ui/feed/OfficialNow.tsx Row, `variant="command"`), every row from its own official answer and never merged with
// model output:
//   - one row per NWS product (official/floodModel.ts floodAlertRows): "Flood Warning — in effect until 9:00 PM MST",
//     meta "NWS ALBUQUERQUE NM · SENT … · CHECKED 2 MIN AGO"; open: NWS's headline, description and instructions
//     verbatim (inside data-verbatim), its link and "Show" (fits its area on the map); a Flash Flood Emergency first and
//     open. NO_PRODUCT only when the alerts answer is available; else ALERTS_UNAVAILABLE (D24).
//   - the river forecast of the primary member gauge: "River forecast — crest 17.1 ft Thu 6:00 AM (NWS CBRFC, issued
//     10:20 AM)", or the forecast high still rising at its end (C7); "No NWS river forecast for this gauge".
//   - evacuations in flood wording (FloodEvacRows) and the local officials' messages for the flood's area.
// Foot: MODEL_SEPARATE. Mounted by web-flood-command's chrome (wave 3); the Public view shows the same answers as facts.
import { useShallow } from 'zustand/react/shallow'
import { useExtrasRuntime } from '../../extras/runtime'
import { fmtAt, fmtRelative, timeFmt, zoneAbbr } from '../../lib/time'
import { useFloodOfficial } from '../../official/floodHooks'
import { officialState, floodAlertRows, primaryMemberGauge, rfcName, type FloodAlertRow } from '../../official/floodModel'
import { localAlertsState } from '../../official/localAlerts'
import { fitOfficialBounds } from '../../official/select'
import { openFloodSummary, useFlood } from '../../state/flood'
import { useTimeFormatFor } from '../../state/timeZone'
import { useWorkspace } from '../../state/workspace'
import { useNow } from '../hooks'
import '../../styles/view-flood-public.css'
import { ALERTS_UNAVAILABLE, fillCopy, FLOOD_PUBLIC, MODEL_SEPARATE, NO_PRODUCT, NO_RFC_FORECAST, PAST_NO_FORECAST } from '../shell/floodCopy'
import { fmtStage } from '../public/floodOverviewText'
import { polygonsOf } from '../public/floodView'
import { FloodEvacRows } from './FloodEvacRows'
import { CommandRows, LocalAlertsRow, Row, SourceLink } from './OfficialNow'

const SENDER_UPPER = (s: string) => s.toUpperCase()

/** The bbox of a product's area (its polygon) for "Show". */
function areaBounds(r: FloodAlertRow): [number, number, number, number] | null {
  const rings = polygonsOf(r.geometry).flat()
  const pts = rings.flat()
  if (!pts.length) return null
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function ProductRow({ r, checkedText }: { r: FloodAlertRow; checkedText: string | null }) {
  const b = areaBounds(r)
  return (
    <Row
      icon={null}
      label={r.event}
      title={r.emergency ? `${r.event} · ${FLOOD_PUBLIC.flashEmergency}` : r.event}
      verdict={[r.phase.toLowerCase(), r.until].filter(Boolean).join(' ')}
      meta={[SENDER_UPPER(r.sender), r.sent?.toUpperCase(), checkedText?.toUpperCase(), r.archived ? 'ARCHIVED COPY' : null].filter(Boolean).join(' · ')}
      source={r.sender}
      tone="alert"
      startOpen={r.open}
      aside={
        <>
          {r.url && <SourceLink href={r.url}>{FLOOD_PUBLIC.nwsAlertLink}</SourceLink>}
          {b && (
            <button type="button" className="on-link-btn" onClick={() => fitOfficialBounds(b)}>
              Show
            </button>
          )}
        </>
      }
    >
      <div className="ffo-product">
        <p className="on-meta">
          <span data-verbatim="">{r.event}</span> · {r.sender}
        </p>
        {r.headline && (
          <p className="ffo-text" data-verbatim="">
            {r.headline}
          </p>
        )}
        {r.description && (
          <p className="ffo-text is-pre" data-verbatim="">
            {r.description}
          </p>
        )}
        {r.instruction && (
          <p className="ffo-text is-pre" data-verbatim="">
            {r.instruction}
          </p>
        )}
      </div>
    </Row>
  )
}

export function FloodOfficialNow({ variant = 'command' }: { variant?: 'command' }) {
  const summary = useFlood((s) => openFloodSummary(s))
  const off = useFloodOfficial(useShallow((s) => ({ alerts: s.alerts, gauges: s.gauges, local: s.local })))
  const clock = useWorkspace((s) => (s.preset === 'command' ? '24h' : '12h'))
  const tf = useTimeFormatFor(summary?.time_zone)
  const nowMs = useNow(30_000)
  const evac = useExtrasRuntime((s) => s.evac)
  const past = summary?.mode === 'historical'
  const alertsSt = officialState(off.alerts)
  const checked = off.alerts.data?.retrieved_ms != null ? `checked ${fmtRelative(off.alerts.data.retrieved_ms, nowMs)}` : null
  const rows = floodAlertRows(off.alerts.data, { zone: summary?.time_zone ?? tf.tz, clock, nowMs, past })
  const g = primaryMemberGauge(off.gauges.data, summary)
  const f = g?.forecast ?? null
  let forecast: { verdict: string; meta: string | null } | null = null
  if (past) forecast = { verdict: PAST_NO_FORECAST, meta: null }
  else if (g && g.is_forecast_point && f && f.max_value != null) {
    const gtf = timeFmt(g.time_zone || tf.tz, clock)
    const v = fmtStage(f.max_value, g.observed.unit ?? 'ft', 'us') ?? ''
    const when = f.max_ms != null ? fmtAt(f.max_ms, gtf, { weekday: true, zone: true, year: 'auto', refMs: nowMs }) : ''
    const issued = f.issued_ms != null ? fmtAt(f.issued_ms, gtf, { zone: true, year: 'auto', refMs: nowMs }) : ''
    forecast = {
      verdict: f.crest_at_end ? `high ${v} at the end of the forecast (${when}); still forecast to rise` : `crest ${v} ${when}`,
      meta: `NWS ${rfcName(f)}${issued ? `, issued ${issued}` : ''}`,
    }
  } else if (g) forecast = { verdict: NO_RFC_FORECAST, meta: g.name }
  const local = summary?.mode === 'live' && off.local.data ? localAlertsState(off.local) : null
  return (
    <section className={`on is-command ffo ffo-${variant}`} aria-labelledby="ffo-title">
      <header className="on-head" data-tip="Agencies' own updates, with their wording, issuer, times and a link to the source">
        <h3 id="ffo-title">Official now</h3>
        {past && <span className="on-head-sub">archived NWS products</span>}
        <span className="on-head-zone">Times in {zoneAbbr(nowMs, tf.tz)}</span>
      </header>
      <CommandRows>
        <ul className="on-rows">
          {rows.map((r) => (
            <ProductRow key={r.id} r={r} checkedText={checked} />
          ))}
          {rows.length === 0 && (
            <Row icon={null} label="NWS flood products" title="NWS flood products" verdict={alertsSt === 'available' ? 'none here right now' : alertsSt === 'loading' ? 'checking…' : 'could not be reached'} source="NWS" tone="quiet" startOpen>
              <p className="on-meta">{alertsSt === 'available' ? NO_PRODUCT : alertsSt === 'loading' ? FLOOD_PUBLIC.checking : (off.alerts.data?.reason ?? ALERTS_UNAVAILABLE)}</p>
            </Row>
          )}
          {forecast && (
            <Row icon={null} label="River forecast" title="River forecast" verdict={forecast.verdict} meta={forecast.meta ?? undefined} source="NWS" tone="info">
              <p className="on-meta">{f && f.max_value != null ? (forecast.meta ?? '') : forecast.verdict}</p>
              {f?.url && <SourceLink href={f.url}>{FLOOD_PUBLIC.forecastLink}</SourceLink>}
            </Row>
          )}
          <Row icon={null} label={FLOOD_PUBLIC.labelEvacuations} title={FLOOD_PUBLIC.labelEvacuations} verdict={evac.data ? undefined : evac.loading ? 'checking…' : undefined} source={null} tone="quiet" startOpen>
            <FloodEvacRows variant="command" />
          </Row>
          {local && <LocalAlertsRow l={local} wallMs={nowMs} refMs={nowMs} />}
        </ul>
      </CommandRows>
      <p className="on-foot">{MODEL_SEPARATE}</p>
      <p className="on-meta">{fillCopy(FLOOD_PUBLIC.sourcesLine, { age: off.alerts.data?.retrieved_ms != null ? fmtRelative(off.alerts.data.retrieved_ms, nowMs) : '—' })}</p>
    </section>
  )
}
