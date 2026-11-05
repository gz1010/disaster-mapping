// The map workspace's chrome inside a flood in the Command preset (brief 5, web-flood-command; PLAN-5 §4.5): Command
// fire's layout and classes (styles/view-command.css, scoped to both Command chromes) with the flood's own parts; flood
// rules in styles/view-flood-command.css. No panels on the map: text on the edge gradients (MapAtmosphere "command").
//   top bar      "Back to all floods", the flood's name (18 px), LIVE or the year, the place, the demo badge · the view
//                pill · the primary gauge's line "SHRN5 · 15.2 FT · MINOR · 12 MIN AGO" (amber after 3 h; opens the
//                list of the flood's gauges), Show panels, Official now (phones), Check an address, Layers, the menu
//   left         the readout (location/FloodReadout.tsx): the selected point, what each flood layer says there, the
//                nearest gauge, the flood's rows, the area figures with their caveats
//   right        "Official now" (ui/feed/FloodOfficialNow.tsx): every NWS product verbatim, the river forecast,
//                evacuations in flood wording, local officials' messages; MODEL_SEPARATE at its foot
//   bottom       the map controls bar (left) and the flood legend chips with the scale (right), the slim river-level
//                chart (ui/timeline/Hydrograph.tsx; its handle drives the map, the readout and Official now's map
//                products: productsAt, C1), the fixed copy and the credits
// The layers drawer is FloodLayersPanel's Command variant (CatFIM, FEMA floodplain and the model, each off by
// default; D12, D21, D22). Phones: the readout is a bottom sheet with a one-line peek (the point, else the primary
// gauge), Official now the Updates sheet, the chart full width. Every flood view keeps "Research prototype — not for
// operational use" and "Not an all-clear. Follow local officials."
import { ListChecks, X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { CommandSearch } from '../../location/CommandSearch'
import { FloodReadout } from '../../location/FloodReadout'
import { ScaleBar } from '../../map/MapAttribution'
import { MapControls } from '../../map/MapControls'
import { FloodLegend } from '../../map/FloodLegend'
import { CATEGORY_COLORS, gaugeTone } from '../../map/floodStyle'
import { askedAt, useFloodOfficial, useFloodOfficialSync } from '../../official/floodHooks'
import { primaryGaugeReading } from '../../official/floodModel'
import { goToFloodOverview, openFloodSummary, useFlood } from '../../state/flood'
import { useFloodLayerDataSync } from '../../state/floodLayerData'
import { useStore } from '../../state/store'
import { useWorkspace } from '../../state/workspace'
import { fmtRelative, HOUR_MS } from '../../lib/time'
import { Popover } from '../controls'
import { FloodOfficialNow } from '../feed/FloodOfficialNow'
import { useNow } from '../hooks'
import { floodPlace } from '../public/floodView'
import { Hydrograph, GaugeList } from '../timeline/Hydrograph'
import { newestReading, useChartGauge } from '../timeline/hydrographData'
import { categoryWord } from '../timeline/hydrographModel'
import { DEMO_TAG, FLOOD_COMMAND, FLOOD_OVERVIEW } from './floodCopy'
import { FixedCopy } from './FixedCopy'
import { FloodLayersPanel } from './FloodLayersPanel'
import { NARROW_QUERY, useDrawerFocus, useMediaQuery, useOverflowing } from './hooks'
import { BackButton, LiveDot, TopBar, TopBarPlace, ViewPill } from './TopBar'
import { CompactMenu, LayersPill, PanelPill, ShowPanelsPill } from './topBarItems'
import '../../styles/view-command.css'
import '../../styles/view-flood-command.css'

/** The flood's name as the bar's title (18 px). */
function FloodName() {
  const summary = useFlood((s) => openFloodSummary(s))
  const loading = useFlood((s) => s.detailLoading)
  return <h1 className="cfv-title">{summary?.name ?? (loading ? 'Loading flood…' : 'Flood')}</h1>
}

/** The demo badge of a synthetic flood (DEMO; the full wording in its tooltip and accessible text). */
function FloodDemoBadge() {
  return (
    <span className="mw-demo-badge" role="note" data-tip={FLOOD_COMMAND.demoNote}>
      <span className="mw-sr-only">{FLOOD_COMMAND.demoNote}</span>
      <span aria-hidden="true">{DEMO_TAG}</span>
    </span>
  )
}

/** The primary gauge's line in the bar: "SHRN5 · 15.2 FT · MINOR · 12 MIN AGO" (the age amber after 3 h); opens the
 *  list of the flood's gauges (picking one shows it in the river-level chart). */
function GaugeStatus() {
  const summary = useFlood((s) => openFloodSummary(s))
  const gauges = useFloodOfficial((s) => s.gauges.data)
  const lid = useFlood((s) => s.gaugeLid)
  const nowMs = useNow(60_000)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const pg = summary?.primary_gauge ?? null
  const chart = useChartGauge(pg?.lid)
  if (!summary || !pg) return null
  // one reading per gauge: the newest of the list's, the flood's gauges answer and the chart's own answer
  const listed = primaryGaugeReading(summary, gauges)
  const own = chart && chart.lid === pg.lid ? newestReading(chart) : null
  const r = own && own.valid_ms != null && (listed?.valid_ms == null || own.valid_ms > listed.valid_ms) ? own : listed
  const value = r?.value != null ? `${r.value.toFixed(1)} ${(r.unit ?? 'ft').toUpperCase()}` : null
  const stale = r?.valid_ms != null && nowMs - r.valid_ms > 3 * HOUR_MS
  const age = r?.valid_ms != null ? fmtRelative(r.valid_ms, nowMs).toUpperCase() : null
  const tone = gaugeTone(r?.category)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="cfv-gauge-status"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-tip={FLOOD_COMMAND.gaugeStatusTip}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M5 0L10 5L5 10L0 5Z" fill={tone === 'below' ? 'none' : CATEGORY_COLORS[tone]} stroke={CATEGORY_COLORS[tone]} />
        </svg>
        <span className="cfv-gauge-text">
          {[pg.lid, value, r ? categoryWord(r.category) : null].filter(Boolean).join(' · ')}
          {age && <span className={stale ? 'is-stale' : undefined}>{` · ${age}`}</span>}
        </span>
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom-end" width={360} className="hg-picker" label={FLOOD_COMMAND.gaugeListTitle}>
        <GaugeList floodId={summary.id} lid={lid ?? pg.lid} onPick={() => setOpen(false)} />
      </Popover>
    </>
  )
}

/** Phones: the labelled toggle of the Official now sheet (no badge: none is never an all-clear). */
function OfficialToggle() {
  return <PanelPill panel="updates" icon={<ListChecks size={15} />} label={FLOOD_COMMAND.officialToggle} tip={FLOOD_COMMAND.updatesToggleTip} className="mw-narrow-only mw-updates-toggle has-label" />
}

/** The right column (desktop: text on the map's right edge; phones: the Updates sheet). */
function OfficialColumn() {
  const open = useWorkspace((s) => s.panels.updates)
  const setPanel = useWorkspace((s) => s.setPanel)
  const narrow = useMediaQuery(NARROW_QUERY)
  const heading = useRef<HTMLHeadingElement | null>(null)
  useDrawerFocus(open, heading, 'updates')
  if (!open) {
    if (narrow) return null
    return (
      <button type="button" className="mw-btn mw-updates-open" data-panel-toggle="updates" aria-expanded={false} data-tip={FLOOD_COMMAND.officialShowTip} onClick={() => setPanel('updates', true)}>
        <ListChecks size={14} /> {FLOOD_COMMAND.officialShow}
      </button>
    )
  }
  if (!narrow)
    return (
      <section className="mw-updates-panel is-column cfv-official" aria-labelledby="mw-updates-title" data-drawer="updates">
        <h2 id="mw-updates-title" className="mw-sr-only" ref={heading} tabIndex={-1}>
          {FLOOD_COMMAND.officialTitle}
        </h2>
        <FloodOfficialNow variant="command" />
        <div className="cmd-col-foot">
          <button type="button" className="mw-link-btn cmd-hide" aria-label="Hide Official now" data-tip={FLOOD_COMMAND.officialHideTip} aria-expanded={true} onClick={() => setPanel('updates', false)}>
            {FLOOD_COMMAND.officialHide}
          </button>
        </div>
      </section>
    )
  return (
    <section className="mw-updates-panel cfv-official" aria-labelledby="mw-updates-title" data-drawer="updates">
      <span className="mw-sheet-handle" aria-hidden="true" />
      <header className="mw-panel-head">
        <h2 id="mw-updates-title" ref={heading} tabIndex={-1}>
          {FLOOD_COMMAND.officialSheetTitle}
        </h2>
        <button type="button" className="mw-icon-btn" aria-label="Close Official now" aria-expanded={true} onClick={() => setPanel('updates', false)}>
          <X size={15} />
        </button>
      </header>
      <div className="mw-updates-scroll">
        <div className="mw-official-slot">
          <FloodOfficialNow variant="command" />
        </div>
      </div>
    </section>
  )
}

export function CommandFloodChrome({ credits }: { credits: ReactNode }) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const collapsed = useStore((s) => s.panelsCollapsed)
  const summary = useFlood((s) => openFloodSummary(s))
  const floodId = useFlood((s) => s.floodId)
  const gaugeLid = useFlood((s) => s.gaugeLid)
  const [cardRef, cardOver] = useOverflowing<HTMLDivElement>(!narrow)
  useFloodOfficialSync()
  useFloodLayerDataSync()
  const live = summary?.mode === 'live'
  const place = floodPlace(summary)
  return (
    <>
      <TopBar
        className="mw-header"
        data-chrome="header"
        left={
          <>
            <BackButton onClick={goToFloodOverview} label={FLOOD_OVERVIEW.backToAll} tip="Back to the overview of all floods (lower 48 states)" />
            <FloodName />
            {!narrow && summary && <LiveDot live={live} year={summary.year} />}
            {!narrow && <TopBarPlace place={place} />}
            {summary?.synthetic && !narrow && <FloodDemoBadge />}
          </>
        }
        centre={<ViewPill className="mw-wide-only" />}
        right={
          <>
            {!narrow && !collapsed && (
              <span className="cmd-status">
                <GaugeStatus />
              </span>
            )}
            <ShowPanelsPill />
            <OfficialToggle />
            <CommandSearch />
            <LayersPill />
            <CompactMenu />
          </>
        }
      />
      <div className="mw-layers-slot" data-chrome="layers">
        <FloodLayersPanel variant="command" />
      </div>
      <div className="mw-top cmd-top">
        <div ref={cardRef} className={`mw-card cmd-readout-slot${cardOver && !narrow ? ' is-overflowing' : ''}`} data-chrome="card">
          <FloodReadout />
        </div>
        {narrow && (
          <>
            {summary && (live || summary.synthetic || summary.year != null) && (
              <div className="cmd-badges" data-chrome="badges">
                <LiveDot live={live} year={summary.year} />
                {summary.synthetic && <FloodDemoBadge />}
              </div>
            )}
            <div className="mw-controls" data-chrome="controls">
              <MapControls />
            </div>
          </>
        )}
        <aside className="mw-updates" id="mw-updates" data-chrome="updates" aria-label="Official flood information">
          <OfficialColumn />
        </aside>
      </div>
      {narrow && (
        <div className="mw-scale-slot" data-chrome="scale">
          <ScaleBar />
        </div>
      )}
      <div className="mw-bottom cmd-bottom">
        {!narrow && (
          <div className="cmd-row">
            <div className="mw-controls cmd-controls" data-chrome="controls">
              <MapControls variant="bar" anchor="bottom" />
            </div>
            <div className="mw-legend-slot cmd-legend" data-chrome="legend">
              <FloodLegend variant="chips" />
            </div>
          </div>
        )}
        <div className="mw-timeline cmd-timeline cfv-chart" id="mw-timeline" data-chrome="timeline">
          {/* a past flood: the chart is asked at its last NWS product's time (the backend answers from the archive or
              says it is not available for past dates) */}
          {floodId && <Hydrograph variant="slim" floodId={summary?.id ?? floodId} lid={gaugeLid} atMs={summary ? askedAt(summary) : null} />}
        </div>
        <div className="cmd-foot">
          <div className="mw-note cmd-note" data-chrome="note">
            <FixedCopy variant="corner" />
          </div>
          {credits}
        </div>
      </div>
    </>
  )
}

