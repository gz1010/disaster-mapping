// The map workspace's chrome inside a flood in the Public preset: the flood view (brief 5, FloodView.dc.html; PLAN-5
// §4.4; CONTRACT §16.10-16.12). Its layout is the Public fire view's (ui/shell/PublicFireChrome.tsx), with the design's
// values; the map shows the flood's own layers only (map/floodProfile.ts 'public-flood': water seen by satellite, the
// NWS forecast flooded area, NWS warning areas, member gauges, the main channel, evacuation zones; the FEMA floodplain
// as a Layers toggle, off by default; never the model, never NWS category maps).
//   top left     "Back to all floods" (the round X; history-aware, state/flood.ts goToFloodOverview)
//   top centre   the place and the dates (ui/public/FloodTitle.tsx), the distance chip under them
//   top right    Show panels, the view pill, "Check an address", Layers, the menu; from 1280 px the satellite image's
//                status "NASA OPERA · OCT 31 · 4 D AGO" (amber after 3 days)
//   left         the water circle (ui/public/FloodHazardCircle.tsx) with a leader to the primary member gauge, or to its
//                largest NWS polygon's point (map/FloodLeader.tsx), then the official facts (ui/public/FloodFacts.tsx)
//   right        the location card of a picked point (FloodPointCard's flood-view variant), the compact map controls and
//                the map key with the scale (ui/public/FloodKey.tsx)
//   bottom       a 30 px bar: "Research prototype — not for operational use" and "Not an all-clear. Follow local
//                officials." (left), the credits (right)
// Phones: the fire view's bottom sheet; the peek shows the first two fact rows of the flood's kind. The basemap tint is
// the design's #333 colour blend at .25 (useMapTint('flood'); review WFO-R12) and the left gradient 600 px
// (styles/view-flood-public.css). Every animation stops under prefers-reduced-motion.
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { CommandSearch } from '../../location/CommandSearch'
import { LocationCard } from '../../location/LocationCard'
import { FloodLeader } from '../../map/FloodLeader'
import { MapControls } from '../../map/MapControls'
import { useMapTint } from '../../map/useMapTint'
import { useFloodOfficialSync } from '../../official/floodHooks'
import { goToFloodOverview, openFloodSummary, useFlood } from '../../state/flood'
import { useStore } from '../../state/store'
import { useTimeFormatFor } from '../../state/timeZone'
import { useWorkspace } from '../../state/workspace'
import { FireMenu } from '../public/FireMenu'
import { FloodFacts } from '../public/FloodFacts'
import { FloodHazardCircle } from '../public/FloodHazardCircle'
import { FloodFootCredits, FloodKey, FloodSatStatus } from '../public/FloodKey'
import { FloodDistanceChip, FloodTitle } from '../public/FloodTitle'
import { useFactsFit } from '../public/useFactsFit'
import { DEMO_TAG, FLOOD_LAST_KNOWN, FLOOD_OVERVIEW, FLOOD_PUBLIC, fillCopy, NOT_ALL_CLEAR } from './floodCopy'
import { FixedCopy } from './FixedCopy'
import { FloodLayersPanel } from './FloodLayersPanel'
import { NARROW_QUERY, useMediaQuery } from './hooks'
import { TopBar, ViewPill } from './TopBar'
import { LayersPill, ShowPanelsPill } from './topBarItems'
import { fmtAt } from '../../lib/time'
import '../../styles/view-public.css'
import '../../styles/view-flood-public.css'

/** The screen's close button: 44 px round glass with an X. Back to all floods. */
function CloseFlood() {
  const close = () => {
    const had = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('pfv-close')
    goToFloodOverview()
    if (had)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.mw-header .tb-view-btn[aria-checked="true"], .mw-header .mw-hdr-menu')?.focus({ preventScroll: true })),
      )
  }
  return (
    <button type="button" className="tb-icon pfv-close" aria-label={FLOOD_OVERVIEW.backToAll} data-tip="Back to the overview of all floods (lower 48 states)" onClick={close}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M5 5 L19 19 M19 5 L5 19" />
      </svg>
    </button>
  )
}

/** A flood resolved from its bundle or Disaster Mapping's last sight (rule 13): FLOOD_LAST_KNOWN with that date. */
function LastKnownNote() {
  const summary = useFlood((s) => openFloodSummary(s))
  const resolved = useFlood((s) => s.resolvedFrom)
  const tf = useTimeFormatFor(summary?.time_zone)
  if (!summary || (resolved !== 'bundle' && resolved !== 'last_known')) return null
  return (
    <p className="ffv-lastknown" role="note">
      {fillCopy(FLOOD_LAST_KNOWN, { date: fmtAt(summary.updated_ms ?? summary.started_ms, tf, { zone: true, year: 'always' }) })}
    </p>
  )
}

/** Phones: the facts as a bottom sheet; the peek shows the first two rows of the flood's kind. */
function FactsSheet() {
  const [open, setOpen] = useState(false)
  return (
    <section className={`pfv-sheet${open ? ' is-open' : ''}`} data-chrome="facts" aria-label="Official information">
      <button type="button" className="pfv-sheet-toggle" aria-expanded={open} aria-controls="ffv-sheet-body" onClick={() => setOpen((o) => !o)}>
        <span className="mw-sheet-handle" aria-hidden="true" />
        <span className="mw-sr-only">{open ? FLOOD_PUBLIC.sheetLess : FLOOD_PUBLIC.sheetMore}</span>
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
      </button>
      <div className="pfv-sheet-body" id="ffv-sheet-body">
        {open ? (
          <>
            <FloodFacts />
            <FloodKey details={false} />
          </>
        ) : (
          <FloodFacts peek />
        )}
      </div>
    </section>
  )
}

export function PublicFloodChrome({ credits }: { credits: ReactNode }) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const wideStatus = useMediaQuery('(min-width: 1280px)')
  const collapsed = useStore((s) => s.panelsCollapsed)
  const hasSelection = useWorkspace((s) => s.selection != null)
  const floodId = useFlood((s) => s.floodId)
  const synthetic = useFlood((s) => openFloodSummary(s)?.synthetic === true)
  const circle = useRef<HTMLButtonElement | null>(null)
  const factsSlot = useRef<HTMLDivElement | null>(null)
  const fit = useFactsFit(factsSlot, !narrow && !collapsed)
  // the Public flood view's basemap tint (PLAN-5 §4.4: #333 colour blend at 0.25; review WFO-R12)
  useMapTint('flood')
  useFloodOfficialSync()
  return (
    <>
      <TopBar
        className="mw-header pfv-bar"
        data-chrome="header"
        left={
          <>
            <CloseFlood />
            {narrow && <FloodTitle chip={false} compact />}
            {synthetic && <span className="mw-demo-badge ffv-demo">{DEMO_TAG}</span>}
          </>
        }
        right={
          <>
            <ShowPanelsPill />
            <ViewPill size="sm" className="mw-wide-only" />
            <CommandSearch variant="pill" />
            <LayersPill />
            <FireMenu />
          </>
        }
      />
      {!narrow && (
        <div className="pfv-title-slot" data-chrome="title">
          <FloodTitle />
        </div>
      )}
      {/* the leader to the flood's anchor: over the map, under the chrome */}
      <FloodLeader circle={circle} leader={!narrow && !collapsed} />
      <div className="mw-layers-slot" data-chrome="layers">
        <FloodLayersPanel variant="public" />
      </div>
      <div className="mw-top pfv-top">
        {narrow ? (
          <div className="pfv-strip" data-chrome="strip">
            <FloodHazardCircle ref={circle} compact />
            <FloodDistanceChip compact />
          </div>
        ) : (
          <div className={`pfv-left${fit.level > 0 ? ' is-snug' : ''}${fit.level > 1 ? ' is-tight' : ''}${fit.level > 2 ? ' is-tighter' : ''}`}>
            <div className="pfv-circle-slot" data-chrome="circle">
              <FloodHazardCircle ref={circle} />
            </div>
            <div className="pfv-facts-slot" data-chrome="facts" ref={factsSlot}>
              <LastKnownNote />
              <FloodFacts more={fit.more} onMore={fit.scrollMore} />
            </div>
          </div>
        )}
        <div className="pfv-right">
          {wideStatus && !collapsed && (
            <div className="pfv-status" data-chrome="imagery">
              <FloodSatStatus />
            </div>
          )}
          <div className={`mw-card pfv-card${hasSelection ? '' : ' is-empty'}`} data-chrome="card">
            <LocationCard />
          </div>
        </div>
        <div className="pfv-right-bottom">
          <div className="mw-controls pfv-cluster" data-chrome="controls">
            <MapControls variant="compact" />
          </div>
          {!narrow && (
            <div className="pfv-key-slot" data-chrome="key">
              <FloodKey />
            </div>
          )}
        </div>
      </div>
      <div className="mw-bottom pfv-bottom">
        {narrow && <FactsSheet key={floodId ?? ''} />}
        <div className="pfv-foot">
          <div className="mw-note pfv-note" data-chrome="note">
            {/* both lines on every state of the view, phones included (BRIEF-5 standing rules) */}
            <FixedCopy variant="bar" extra={NOT_ALL_CLEAR} />
          </div>
          {credits}
          {/* the flood layers' credits join the map's while the key (which carries them) is hidden (WFP-R6) */}
          <FloodFootCredits show={narrow || collapsed} />
        </div>
      </div>
    </>
  )
}
