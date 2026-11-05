// Command's left readout inside a flood (brief 5, web-flood-command; PLAN-5 §4.5; CommandReadout's structure, which
// stays fire-only and frozen). Text on the map's left edge gradient, top to bottom:
//   "SELECTED POINT" with copy / centre / clear; the point in mono 30 px; DMS · UTM · WGS84 (the bundle's UTM zone,
//   else the point's own zone);
//   one line per flood layer at the point (location/floodCheck.ts checkPoint, at the river-level chart's handle:
//   productsAt, C1), each with an outlined tag saying what it is and how old: OFFICIAL, FORECAST · ISSUED 10:20,
//   SATELLITE · 4 D AGO, FEMA (when on), MODEL (only when switched on); NOTHING_COVERS when no layer covers the spot;
//   the nearest river gauge (the flood's rivers first, else at action stage or above, within 25 km): stage with its own
//   reading time, the NWS category in words (PLAN-5 §5.3, never a raw value), flood stage, the NWS forecast crest or
//   the forecast high at its end (C7), the distance, and GAUGE_OTHER_STREAM; NO_GAUGE_NEAR only when the gauge answer
//   is available (D24);
//   the flood's rows: FLOOD ID (copy), PRIMARY GAUGE coordinates (copy, centre), LAST OFFICIAL UPDATE;
//   area figures, each on its own line with its caveat: RFC_FIM_AREA_COMMAND (only when the backend measured it from
//   the flood's own forecast reaches, C6) and SAT_AREA_COMMAND with the satellite caveat.
// Without a selected point: the prompt, then the primary gauge, the flood's rows and the area figures. Phones: a
// bottom sheet whose peek line is the selected point, else the primary gauge.
import { ChevronDown, ChevronUp, Crosshair, X } from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FloodSummary, RiverGauge } from '../api/types'
import { formatDecimalPair, formatLat, formatLon } from '../lib/geodesy'
import { directionWord, distance } from '../lib/plainLanguage'
import { fmtAt, fmtRelative, HOUR_MS, timeFmt, type TimeFmt } from '../lib/time'
import { useFloodOfficial, useSatClassAt } from '../official/floodHooks'
import { answerState, memberGaugesOf, officialAlerts, withNewerReading, type AnswerState } from '../official/floodModel'
import { openFloodSummary, useFlood } from '../state/flood'
import { useFloodLayerData } from '../state/floodLayerData'
import { useClock, useTimeFormatFor } from '../state/timeZone'
import { useWorkspace, type SelectedLocation, type Units } from '../state/workspace'
import { useNow } from '../ui/hooks'
import { fmtStage } from '../ui/public/floodOverviewText'
import { fillCopy, FLOOD_COMMAND, FLOOD_LAST_KNOWN, GAUGE_NOT_DEFINED, GAUGE_OTHER_STREAM, GAUGES_UNAVAILABLE, NO_GAUGE_NEAR } from '../ui/shell/floodCopy'
import { ReadoutRow } from '../ui/shell/Readout'
import { CopyButton } from './CoordinateStrip'
import { areaFigures, categoryWords, checkPoint, forecastRow, lineTag, nearestFloodGauge, utmZoneOf, type NearestGauge } from './floodCheck'
import { coordinateLine } from './readoutText'
import { useNarrow } from './useNarrow'
import './location.css'
import '../styles/view-flood-command.css'

const flyTo = (lat: number, lon: number) => useWorkspace.getState().requestMapFlyTo({ lon, lat, zoom: Math.max(useWorkspace.getState().view?.zoom ?? 13, 13) })

// ------------------------------------------------------------------------------------------------ header + point
const CollapseSheet = createContext<(() => void) | null>(null)

function Head({ sel }: { sel: SelectedLocation | null }) {
  const clear = useWorkspace((s) => s.clearSelection)
  const collapse = useContext(CollapseSheet)
  return (
    <header className="cro-head">
      <h2 className="cro-eyebrow" id="cro-title">
        {FLOOD_COMMAND.selectedPoint}
      </h2>
      {(sel || collapse) && (
        <span className="cro-actions">
          {sel && (
            <>
              <CopyButton text={formatDecimalPair(sel.lat, sel.lon)} label="Copy coordinates" />
              <button type="button" className="mw-icon-btn cro-btn" aria-label="Center the map on the selected point" data-tip="Center the map here" onClick={() => flyTo(sel.lat, sel.lon)}>
                <Crosshair size={14} />
              </button>
              <button type="button" className="mw-icon-btn cro-btn" aria-label="Clear the selected point" data-tip="Clear the selected point" onClick={clear}>
                <X size={14} />
              </button>
            </>
          )}
          {collapse && (
            <button type="button" className="mw-icon-btn cro-btn" aria-expanded={true} aria-controls="cro-body" aria-label="Show the one-line coordinates" onClick={collapse}>
              <ChevronDown size={16} />
            </button>
          )}
        </span>
      )}
    </header>
  )
}

function Point({ lat, lon, zone }: { lat: number; lon: number; zone: number }) {
  return (
    <>
      <p className="cro-point mw-mono">
        <span>{formatLat(lat)}</span>
        <span>{formatLon(lon)}</span>
      </p>
      <p className="cro-coords mw-mono">{coordinateLine(lat, lon, zone)}</p>
    </>
  )
}

/** A line's text with NWS's own event name inside data-verbatim (CONTRACT §16.0). */
function LineText({ text, event }: { text: string; event?: string }) {
  const at = event ? text.indexOf(event) : -1
  if (!event || at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <span data-verbatim="">{event}</span>
      {text.slice(at + event.length)}
    </>
  )
}

// ------------------------------------------------------------------------------------------------ the point check
const asked = (st: AnswerState): AnswerState => (st === 'none' ? 'loading' : st)

function PointLayers({ sel, summary }: { sel: SelectedLocation; summary: FloodSummary }) {
  const fl = useFlood(useShallow((s) => ({ cursorMs: s.cursorMs, floodplain: s.layers.floodplain, model: s.layers.model })))
  const off = useFloodOfficial(useShallow((s) => ({ alerts: s.alerts, fim: s.fim, satellite: s.satellite, nfhl: s.nfhl })))
  const model = useFloodLayerData((s) => (s.floodId === summary.id ? s.model.data : null))
  const units = useWorkspace((s) => s.units)
  const tf = useTimeFormatFor(summary.time_zone)
  const nowMs = useNow(60_000)
  const satClass = useSatClassAt(sel.lon, sel.lat)
  const a = off.alerts
  const c = checkPoint({
    point: [sel.lon, sel.lat],
    alerts: officialAlerts(a.data),
    alertsStatus: a.data ? a.data.status : a.loading ? 'loading' : a.error ? 'failed' : 'loading',
    zones: a.data?.zones ?? null,
    fim: off.fim.data,
    fimState: asked(answerState(off.fim)),
    satellite: off.satellite.data,
    satelliteState: asked(answerState(off.satellite)),
    satClass,
    nfhl: fl.floodplain ? off.nfhl.data : null,
    nfhlState: fl.floodplain ? answerState(off.nfhl) : 'none',
    // model output only while its layer is on (D12); never merged with the lines above
    model: fl.model ? model : null,
    gauges: [],
    rivers: summary.rivers,
    cursorMs: fl.cursorMs,
    nowMs,
    tf,
    units,
  })
  return (
    <section className="ffr-layers" aria-label={FLOOD_COMMAND.layersAtPoint}>
      <ul className="ffr-lines">
        {c.lines.map((l) => {
          const tag = lineTag(l, { fim: off.fim.data, satellite: off.satellite.data, nowMs, tf })
          return (
            <li key={l.key} className={`ffr-line is-${l.kind}${l.inside ? ' is-inside' : ''}${l.tone ? ` is-${l.tone}` : ''}`}>
              {tag && (
                <span className={`cro-tag ffr-tag ${tag.cls}`} data-tip={tag.tip}>
                  {tag.text}
                </span>
              )}{' '}
              <LineText text={l.text} event={l.event} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ gauge rows
function GaugeRows({ sel, summary }: { sel: SelectedLocation | null; summary: FloodSummary }) {
  const gaugesAns = useFloodOfficial((s) => s.gauges)
  const units = useWorkspace((s) => s.units)
  const clock = useClock()
  const nowMs = useNow(60_000)
  const st = answerState(gaugesAns)
  const all = useMemo(() => {
    const resp = gaugesAns.data
    if (!resp || resp.status !== 'available') return [] as RiverGauge[]
    const ref = summary.primary_gauge
    return resp.gauges.map((g) => (ref && g.lid === ref.lid ? withNewerReading(g, ref) : g))
  }, [gaugesAns.data, summary.primary_gauge])
  let pick: NearestGauge | null = null
  let title: string = FLOOD_COMMAND.gaugeNearest
  if (sel) pick = nearestFloodGauge(all, [sel.lon, sel.lat], summary.rivers)
  else {
    const members = memberGaugesOf(gaugesAns.data, summary)
    const g = members.find((m) => m.lid === summary.primary_gauge?.lid) ?? members[0] ?? null
    if (g) pick = { gauge: g, km: 0, bearingDeg: 0, onRiver: true }
    title = FLOOD_COMMAND.gaugePrimary
  }
  return (
    <section className="cro-rows ffr-gauge" aria-label={FLOOD_COMMAND.gaugeTitle}>
      <h3 className="cro-eyebrow ffr-eyebrow">{title}</h3>
      {pick ? (
        <GaugeBlock n={pick} sel={sel} tf={timeFmt(pick.gauge.time_zone || summary.time_zone, clock)} units={units} nowMs={nowMs} />
      ) : st === 'loading' ? (
        <p className="ffr-note">{FLOOD_COMMAND.gaugesChecking}</p>
      ) : st === 'available' ? (
        // an absence sentence needs an answer (D24)
        sel ? <p className="ffr-note">{NO_GAUGE_NEAR}</p> : null
      ) : (
        <p className="ffr-note is-warn">{gaugesAns.data?.reason ?? GAUGES_UNAVAILABLE}</p>
      )}
    </section>
  )
}

function GaugeBlock({ n, sel, tf, units, nowMs }: { n: NearestGauge; sel: SelectedLocation | null; tf: TimeFmt; units: Units; nowMs: number }) {
  const g = n.gauge
  const cat = categoryWords(g, tf, nowMs)
  const stage = fmtStage(g.observed.value, g.observed.unit ?? 'ft', units)
  const stale = g.observed.valid_ms != null && nowMs - g.observed.valid_ms > 3 * HOUR_MS
  const reading = g.observed.valid_ms != null ? `${fmtAt(g.observed.valid_ms, tf, { zone: true, year: 'auto', refMs: nowMs })} (${fmtRelative(g.observed.valid_ms, nowMs)})` : null
  const usgs = g.data_attribution.some((d) => /geological survey|usgs/i.test(d.text))
  const fc = forecastRow(g, tf, units, nowMs)
  const minor = g.thresholds?.minor ?? null
  const river = g.waterbody?.trim() || g.name
  return (
    <>
      <p className="ffr-gauge-name">
        <span className="mw-mono">{g.lid}</span> <span data-verbatim="">{g.name}</span>
        {!g.member && <span className="ffr-gauge-nearby"> · {FLOOD_COMMAND.gaugeNearby}</span>}
      </p>
      {sel && (
        <p className="ffr-note">
          {fillCopy(FLOOD_COMMAND.gaugeDistance, { distance: distance(n.km * 1000, units).text, direction: directionWord(n.bearingDeg) })} ·{' '}
          {fillCopy(GAUGE_OTHER_STREAM, { river })}
        </p>
      )}
      <ReadoutRow
        value={stage ? stage.replace(/\s\S+$/, '') : FLOOD_COMMAND.stageNoReading}
        unit={stage ? stage.split(' ').pop() : undefined}
        label={fillCopy(usgs ? FLOOD_COMMAND.stageLabel : FLOOD_COMMAND.stageLabelOther, { lid: g.lid })}
        tone={stale ? 'stale' : undefined}
        sub={
          <>
            {reading}
            {g.data_attribution.map((d) => (
              <span key={d.text}>
                {' · '}
                <span data-verbatim="">{d.text}</span>
              </span>
            ))}
            {' · '}
            <a href={g.url} target="_blank" rel="noreferrer noopener">
              NWS gauge page
            </a>
          </>
        }
      />
      {/* the sentence adds nothing to "Moderate flooding (NWS)"; it stays for every other category (C15) */}
      <ReadoutRow size={17} value={cat.short} label={FLOOD_COMMAND.categoryLabel} sub={/^(minor|moderate|major)$/.test(g.observed.category) ? undefined : cat.sentence} />
      <ReadoutRow
        size={17}
        value={minor != null ? (fmtStage(minor, g.thresholds?.unit ?? 'ft', units) ?? '—') : FLOOD_COMMAND.floodStageNotSet}
        label={FLOOD_COMMAND.floodStageLabel}
        sub={minor == null ? GAUGE_NOT_DEFINED : undefined}
      />
      <ReadoutRow size={17} value={fc.value} label={fc.label} sub={fc.sub || undefined} />
    </>
  )
}

// ------------------------------------------------------------------------------------------------ flood rows
function FloodRows({ summary }: { summary: FloodSummary }) {
  const tf = useTimeFormatFor(summary.time_zone)
  const nowMs = useNow(60_000)
  const pg = summary.primary_gauge
  return (
    <section className="cro-rows ffr-rows" aria-label="Flood identifiers">
      <ReadoutRow size={17} value={summary.id} label={FLOOD_COMMAND.floodIdLabel} copy={summary.id} />
      {pg && Number.isFinite(pg.lat) && Number.isFinite(pg.lon) && (
        <div className="ro-row ro-17 cro-reported">
          <span className="ro-value">
            {formatLat(pg.lat)} · {formatLon(pg.lon)}
          </span>
          <span className="cro-row-btns">
            <CopyButton text={formatDecimalPair(pg.lat, pg.lon)} label="Copy the primary gauge's coordinates" />
            <button type="button" className="mw-icon-btn cro-btn" aria-label="Center the map on the primary gauge" data-tip={FLOOD_COMMAND.primaryGaugeTip} onClick={() => flyTo(pg.lat, pg.lon)}>
              <Crosshair size={13} />
            </button>
          </span>
          <span className="ro-label">— {fillCopy(FLOOD_COMMAND.primaryGaugeLabel, { lid: pg.lid })}</span>
        </div>
      )}
      <ReadoutRow
        size={17}
        value={summary.updated_ms != null ? fmtAt(summary.updated_ms, tf, { zone: true, year: 'auto', refMs: nowMs }) : FLOOD_COMMAND.noUpdateTime}
        label={FLOOD_COMMAND.lastUpdateLabel}
        sub={FLOOD_COMMAND.lastUpdateSub}
      />
      {summary.synthetic && <p className="cro-demo-note">{FLOOD_COMMAND.demoNote}</p>}
    </section>
  )
}

function AreaRows({ summary }: { summary: FloodSummary }) {
  const off = useFloodOfficial(useShallow((s) => ({ fim: s.fim.data, satellite: s.satellite.data })))
  const units = useWorkspace((s) => s.units)
  const figures = areaFigures(off.fim, off.satellite, units)
  if (!figures.length) return null
  return (
    <section className="cro-rows ffr-areas" aria-label={FLOOD_COMMAND.areaTitle} data-flood={summary.id}>
      <h3 className="cro-eyebrow ffr-eyebrow">{FLOOD_COMMAND.areaTitle}</h3>
      {figures.map((f) => (
        <div key={f.key} className="ffr-area">
          <p className="ffr-area-text">{f.text}</p>
          {f.caveat && <p className="ffr-note">{f.caveat}</p>}
        </div>
      ))}
    </section>
  )
}

function LastKnown({ summary }: { summary: FloodSummary }) {
  const resolved = useFlood((s) => s.resolvedFrom)
  const tf = useTimeFormatFor(summary.time_zone)
  if (resolved !== 'bundle' && resolved !== 'last_known') return null
  return (
    <p className="ffr-lastknown" role="note">
      {fillCopy(FLOOD_LAST_KNOWN, { date: fmtAt(summary.updated_ms ?? summary.started_ms, tf, { zone: true, year: 'always' }) })}
    </p>
  )
}

// ------------------------------------------------------------------------------------------------ phones: peek line
function Peek({ sel, summary, onToggle }: { sel: SelectedLocation | null; summary: FloodSummary | null; onToggle: () => void }) {
  const pg = summary?.primary_gauge ?? null
  const pt = sel
    ? { label: sel.source === 'address' ? 'Address' : 'Selected', lat: sel.lat, lon: sel.lon, kind: 'selected' }
    : pg
      ? { label: pg.lid, lat: pg.lat, lon: pg.lon, kind: 'gauge' }
      : null
  return (
    <div className="cro-peek">
      {pt ? (
        <>
          <span className={`cro-peek-label is-${pt.kind}`}>{pt.label}</span>
          <span className="cro-peek-value mw-mono">
            {formatLat(pt.lat)}, {formatLon(pt.lon)}
          </span>
          <CopyButton text={formatDecimalPair(pt.lat, pt.lon)} label={`Copy ${pt.kind === 'gauge' ? "the primary gauge's" : 'selected'} coordinates`} />
        </>
      ) : (
        <span className="cro-peek-value">Search or click the map to get coordinates</span>
      )}
      <button type="button" className="mw-icon-btn cro-peek-toggle" aria-expanded={false} aria-controls="cro-body" aria-label="Show the selected point, the river gauge and the flood's rows" onClick={onToggle}>
        <ChevronUp size={16} />
      </button>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ the readout
export function FloodReadout() {
  const sel = useWorkspace((s) => s.selection)
  const summary = useFlood((s) => openFloodSummary(s))
  const gridZone = useFlood((s) => (s.manifest && s.manifest.id === s.floodId && s.manifest.status === 'ready' ? (s.manifest.grid.utm_zone ?? null) : null))
  const narrow = useNarrow()
  const [sheetOpen, setSheetOpen] = useState(false)
  const selKey = sel ? `${sel.source}|${sel.lat}|${sel.lon}` : null
  const lastKey = useRef(selKey)
  useEffect(() => {
    if (selKey !== lastKey.current && selKey != null) setSheetOpen(true)
    lastKey.current = selKey
  }, [selKey])
  const open = !narrow || sheetOpen
  return (
    <section className={`cro ffr${narrow ? ' is-sheet' : ''}${open ? ' is-open' : ''}`} aria-labelledby={open ? 'cro-title' : undefined} aria-label={open ? undefined : 'Coordinates, WGS84'}>
      {narrow && <span className="mw-sheet-handle" aria-hidden="true" />}
      {narrow && !sheetOpen && <Peek sel={sel} summary={summary} onToggle={() => setSheetOpen(true)} />}
      {open && (
        <CollapseSheet.Provider value={narrow ? () => setSheetOpen(false) : null}>
          <div className="cro-body" id="cro-body">
            <Head sel={sel} />
            {sel ? <Point lat={sel.lat} lon={sel.lon} zone={utmZoneOf(sel.lon, gridZone)} /> : <p className="cro-empty">{FLOOD_COMMAND.pickPrompt}</p>}
            {summary && (
              <>
                <LastKnown summary={summary} />
                {sel && <PointLayers sel={sel} summary={summary} />}
                <GaugeRows sel={sel} summary={summary} />
                <FloodRows summary={summary} />
                <AreaRows summary={summary} />
              </>
            )}
          </div>
        </CollapseSheet.Provider>
      )}
    </section>
  )
}

