// The 3D flood view's right column (brief 5, PLAN-5 §4.7): the fire right panel's look (ui/RightPanel.tsx, .rcol / .rp /
// .rp-tabs) with the flood's tabs, Layers (FloodLayersTab), Analysis (each gauge's latest reading and NWS forecast; the
// chart itself is the dock's), Evidence (FloodEvidenceTab) and Notes (kept in this browser), then the cards "Flood
// overview" and "River gauges". Everything comes from the flood's 3D data (its frozen official copies), each with its
// issuer and own time.
import { ExternalLink, LineChart } from 'lucide-react'
import { useEffect, useRef, useState, type Ref } from 'react'
import { fmtAt, fmtDayDate, type TimeFmt } from '../../lib/time'
import { CATEGORY_COLORS, gaugeTone } from '../../map/floodStyle'
import { memberGaugesOf, rfcName, senderName } from '../../official/floodModel'
import { floodAssetStore } from '../../scene/flood/floodAssets'
import { categoryCaps, stageCaps } from '../../scene/flood/gaugeBarMath'
import { loadNotes, saveNotes } from '../../state/annotations'
import { openFloodSummary, useFlood } from '../../state/flood'
import { useTimeFormat } from '../../state/timeZone'
import { useWorkspace } from '../../state/workspace'
import { Card } from '../controls'
import { useNow } from '../hooks'
import { NOT_ALL_CLEAR } from '../shell/fixedCopyText'
import { CREST_LINE, fillCopy, FORECAST_HIGH_LINE, GAUGE_NOT_ALL_CLEAR, NO_RFC_FORECAST } from '../shell/floodCopy'
import { FLOOD_FORENSIC } from './floodForensicCopy'
import { gaugeRows, overviewProduct } from './floodForensicView'
import { FloodEvidenceTab } from './FloodEvidenceTab'
import { FloodLayersTab } from './FloodLayersTab'
import { useForensicFlood, type FloodForensicTab } from './forensicFloodState'

const TABS: [FloodForensicTab, string][] = [
  ['layers', FLOOD_FORENSIC.tabLayers],
  ['analysis', FLOOD_FORENSIC.tabAnalysis],
  ['evidence', FLOOD_FORENSIC.tabEvidence],
  ['notes', FLOOD_FORENSIC.tabNotes],
]

function AnalysisTab() {
  const tf = useTimeFormat()
  const units = useWorkspace((s) => s.units)
  const nowMs = useNow(60_000)
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  const lid = useFlood((s) => s.gaugeLid)
  if (!flood) return <p className="muted fxf-pad">{FLOOD_FORENSIC.loadingTerrain}</p>
  const members = memberGaugesOf(flood.gauges, flood.summary)
  if (!members.length) return <p className="fxf-pad fxf-none">{flood.gauges && flood.gauges.status !== 'available' ? (flood.gauges.reason ?? FLOOD_FORENSIC.gaugesUnavailable) : FLOOD_FORENSIC.analysisNone}</p>
  const shown = lid ?? flood.summary.primary_gauge?.lid ?? members[0].lid
  return (
    <div className="fxf-analysis">
      <h3 className="eyebrow">{FLOOD_FORENSIC.analysisTitle}</h3>
      {members.map((g) => {
        const zoned: TimeFmt = { tz: g.time_zone || tf.tz, clock: tf.clock }
        const f = g.forecast
        const crest = f && f.max_value != null ? stageCaps(f.max_value, g.thresholds?.unit ?? g.observed.unit, units) : null
        return (
          <div key={g.lid} className={`fxf-an-row${g.lid === shown ? ' is-on' : ''}`}>
            <div className="fxf-an-head">
              <span className="mono fxf-an-lid">{g.lid}</span>
              <span className="fxf-an-name" data-verbatim="">
                {g.name}
              </span>
              <button type="button" className="btn btn-sm btn-ghost" aria-pressed={g.lid === shown} onClick={() => useFlood.getState().setGauge(g.lid)} data-tip="Show this gauge in the river level chart">
                <LineChart size={12} aria-hidden="true" /> Chart
              </button>
            </div>
            <div className="fxf-an-line mono">
              <span style={{ color: CATEGORY_COLORS[gaugeTone(g.observed.category)] }}>{stageCaps(g.observed.value, g.observed.unit, units) ?? 'NO READING'} · {categoryCaps(g.observed.category)}</span>
              {g.observed.valid_ms != null && <span className="muted"> · {fmtAt(g.observed.valid_ms, zoned, { zone: true, year: 'auto', refMs: nowMs })}</span>}
            </div>
            <div className="fxf-an-sub">
              {f && crest
                ? fillCopy(f.crest_at_end ? FORECAST_HIGH_LINE : CREST_LINE, {
                    value: crest.split(' ')[0],
                    unit: crest.split(' ')[1]?.toLowerCase() ?? '',
                    'day time zone': f.max_ms != null ? fmtAt(f.max_ms, zoned, { zone: true, weekday: true }) : '',
                    'RFC name': rfcName(f),
                    time: f.issued_ms != null ? fmtAt(f.issued_ms, zoned, { zone: true }) : '',
                  })
                : g.is_forecast_point
                  ? FLOOD_FORENSIC.analysisNoSavedForecast
                  : NO_RFC_FORECAST}
            </div>
          </div>
        )
      })}
      <p className="fxf-an-foot">{NOT_ALL_CLEAR}</p>
    </div>
  )
}

function NotesTab() {
  const id = useFlood((s) => s.floodId)
  if (!id) return null
  return <NotesBody key={id} id={id} />
}

function NotesBody({ id }: { id: string }) {
  const [text, setText] = useState(() => loadNotes(id))
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef(text)
  useEffect(() => {
    latest.current = text
  }, [text])
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      saveNotes(id, latest.current)
    },
    [id],
  )
  return (
    <div className="fxf-notes">
      <h3 className="eyebrow">{FLOOD_FORENSIC.notesTitle}</h3>
      <textarea
        className="notes-area"
        value={text}
        placeholder={FLOOD_FORENSIC.notesPlaceholder}
        aria-label={FLOOD_FORENSIC.notesTitle}
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => saveNotes(id, v), 400)
        }}
      />
      <p className="muted">{FLOOD_FORENSIC.notesText}</p>
    </div>
  )
}

function TabbedPanel() {
  const tab = useForensicFlood((s) => s.tab)
  const setTab = useForensicFlood((s) => s.setTab)
  const versions = floodAssetStore((s) => (s.assets?.flood.warnings?.status === 'available' ? s.assets.flood.warnings.alerts.length : 0))
  return (
    <>
      <div className="tabs rp-tabs" role="tablist" aria-label="Panel">
        {TABS.map(([k, label]) => (
          <button key={k} id={`fxf-tab-${k}`} type="button" className="tab" role="tab" aria-selected={tab === k} aria-controls={`fxf-pane-${k}`} onClick={() => setTab(k)}>
            {label}
            {k === 'evidence' && versions > 0 && <span className="tab-count mono">{versions}</span>}
          </button>
        ))}
      </div>
      <div className="rp-body" id={`fxf-pane-${tab}`} role="tabpanel" aria-labelledby={`fxf-tab-${tab}`}>
        {tab === 'layers' && <FloodLayersTab />}
        {tab === 'analysis' && <AnalysisTab />}
        {tab === 'evidence' && <FloodEvidenceTab />}
        {tab === 'notes' && <NotesTab />}
      </div>
    </>
  )
}

function OverviewCard() {
  const tf = useTimeFormat()
  const nowMs = useNow(60_000)
  const s = useFlood(openFloodSummary)
  const flood = floodAssetStore((st) => st.assets?.flood ?? null)
  if (!s) return null
  const m = flood?.manifest
  const km = m ? Math.round(m.grid.extent_m / 1000) : null
  // the highest NWS product in effect when the 3D data was prepared, from the copy saved with it (warnings.json), never
  // from the live list; the copy's outage text when it could not be read (D24; review WFF-R6)
  const builtAt = m ? fmtAt(m.built_ms, tf, { zone: true, year: 'auto', refMs: nowMs }) : null
  const prod = flood && m ? overviewProduct(flood.warnings, m.built_ms, nowMs) : null
  return (
    <Card title={FLOOD_FORENSIC.overviewCard} collapsible storageKey="flood-overview" defaultOpen={false} className="fxf-card">
      <dl className="kv fxf-kv">
        <div>
          <dt>Kind</dt>
          <dd>{FLOOD_FORENSIC.overviewKind[s.kind]}</dd>
        </div>
        {prod && (
          <div>
            <dt>{FLOOD_FORENSIC.overviewProducts}</dt>
            <dd>
              {prod.kind === 'unavailable' ? (
                prod.text
              ) : prod.kind === 'product' ? (
                <>
                  <span data-verbatim="">{prod.alert.event}</span> <span className="muted">({senderName(prod.alert.sender_name)})</span>
                  <span className="fxf-kv-sub">{fillCopy(FLOOD_FORENSIC.overviewProductAt, { time: builtAt ?? '—' })}</span>
                </>
              ) : (
                fillCopy(FLOOD_FORENSIC.overviewNoProduct, { time: builtAt ?? '—' })
              )}
            </dd>
          </div>
        )}
        <div>
          <dt>{s.started_basis === 'first_seen' ? FLOOD_FORENSIC.overviewSeenSince : FLOOD_FORENSIC.overviewStarted}</dt>
          <dd className="mono">{fmtDayDate(s.started_ms, s.time_zone || tf.tz, { year: 'always' })}</dd>
        </div>
        {m && (
          <>
            <div>
              <dt>{FLOOD_FORENSIC.overviewArea}</dt>
              <dd className="mono">
                {km} × {km} km{m.aoi_note ? ' (cut)' : ''}
              </dd>
            </div>
            <div>
              <dt>{FLOOD_FORENSIC.overviewPrepared}</dt>
              <dd className="mono">{fmtAt(m.built_ms, tf, { zone: true, year: 'auto', refMs: nowMs })}</dd>
            </div>
          </>
        )}
      </dl>
      {m?.aoi_note && <p className="fxf-card-note">{m.aoi_note}</p>}
    </Card>
  )
}

/** Nearby gauges listed before "Show all" (a 60 km area can hold dozens). */
const NEARBY_SHOWN = 4

function GaugesCard() {
  const tf = useTimeFormat()
  const units = useWorkspace((s) => s.units)
  const nowMs = useNow(60_000)
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  const [allNearby, setAllNearby] = useState(false)
  if (!flood) return null
  const rows = gaugeRows(flood.gauges, flood.summary, units, tf, nowMs)
  const members = rows.filter((r) => r.member)
  const nearbyAll = rows.filter((r) => !r.member)
  const nearby = allNearby ? nearbyAll : nearbyAll.slice(0, NEARBY_SHOWN)
  // a gauge below flood stage is never an all-clear (§5.3; review WFF-R7): the answer's own caveats, and
  // GAUGE_NOT_ALL_CLEAR whenever a listed gauge reads below flood stage
  const below = rows.some((r) => r.tone === 'no_flooding')
  const belowNotes = [...new Set([...(flood.gauges?.caveats ?? []), ...(below ? [GAUGE_NOT_ALL_CLEAR] : [])])]
  return (
    <Card title={FLOOD_FORENSIC.gaugesCard} sub={members.length ? <span className="mono">{members.length}</span> : undefined} collapsible storageKey="flood-gauges" className="fxf-card fxf-gauges-card" bodyClassName="fxf-card-scroll">
      {flood.gauges && flood.gauges.status !== 'available' ? (
        <p className="fxf-none">{flood.gauges.reason ?? FLOOD_FORENSIC.gaugesUnavailable}</p>
      ) : (
        <>
          {[
            [FLOOD_FORENSIC.gaugesMember, members],
            [FLOOD_FORENSIC.gaugesNearby, nearby],
          ].map(([title, list]) =>
            (list as typeof rows).length ? (
              <div key={title as string} className="fxf-gauges">
                <div className="eyebrow">{title as string}</div>
                {(list as typeof rows).map((r) => (
                  <div key={r.lid} className="fxf-gauge-row" data-tip={r.time ?? undefined}>
                    <i className="fxf-gauge-dia" style={{ background: CATEGORY_COLORS[gaugeTone(r.tone)] }} aria-hidden="true" />
                    <span className="mono fxf-gauge-lid">{r.lid}</span>
                    <span className="mono fxf-gauge-val">{r.stage ?? '—'}</span>
                    <span className="mono fxf-gauge-cat">{r.category}</span>
                    <a href={r.url} target="_blank" rel="noreferrer noopener" aria-label={`NWS gauge page ${r.lid}`}>
                      <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  </div>
                ))}
              </div>
            ) : null,
          )}
          {nearbyAll.length > NEARBY_SHOWN && (
            <button type="button" className="btn btn-sm btn-ghost fxf-more" aria-expanded={allNearby} onClick={() => setAllNearby((v) => !v)}>
              {allNearby ? FLOOD_FORENSIC.gaugesFewer : fillCopy(FLOOD_FORENSIC.gaugesAll, { n: nearbyAll.length })}
            </button>
          )}
          {belowNotes.map((n) => (
            <p key={n} className="fxf-card-note fxf-gauge-caveat">
              {n}
            </p>
          ))}
          <p className="fxf-card-note">{FLOOD_FORENSIC.barHeight}</p>
        </>
      )}
    </Card>
  )
}

export function FloodRightPanel({ panelRef }: { panelRef?: Ref<HTMLDivElement> }) {
  return (
    <aside className="rcol fxf-rcol" ref={panelRef} aria-label="Flood panels">
      <section className="glass rp" aria-label="Flood panel">
        <TabbedPanel />
      </section>
      <OverviewCard />
      <GaugesCard />
    </aside>
  )
}
