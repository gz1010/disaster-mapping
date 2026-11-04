// The map workspace's chrome inside a flood in the Public preset (brief 5, PLAN-5 §4.4). This is web-flood-overview's
// STUB (wave 1): the bar ("Back to all floods", the flood's name, LIVE or the year, the view pill), a short card with
// the NWS product in effect and the fixed copy, so the chrome slot, the history and the map work end to end. The
// Public flood view (the water circle, facts, key, distance chip) replaces it: web-flood-public (wave 2).
// Every flood view keeps "Research prototype — not for operational use" and "Not an all-clear. Follow local officials."
import type { ReactNode } from 'react'
import { LocationCard } from '../../location/LocationCard'
import { MapControls } from '../../map/MapControls'
import { goToFloodOverview, openFloodSummary, useFlood } from '../../state/flood'
import { highestProduct } from '../../state/floodOverview'
import { useTimeFormatFor } from '../../state/timeZone'
import { fmtAt } from '../../lib/time'
import { DEMO_TAG, FLOOD_LAST_KNOWN, FLOOD_OVERVIEW, fillCopy, NOT_ALL_CLEAR, PRODUCT_END } from './floodCopy'
import { FixedCopy } from './FixedCopy'
import { NARROW_QUERY, useMediaQuery } from './hooks'
import { LayersPanel } from './LayersPanel'
import { BackButton, LiveDot, TopBar, ViewPill } from './TopBar'
import { CompactMenu, ShowPanelsPill } from './topBarItems'

/** The open flood's name, live / year, product line and the last-known note. */
function useFloodStubData() {
  const summary = useFlood((s) => openFloodSummary(s))
  const resolved = useFlood((s) => s.resolvedFrom)
  const loading = useFlood((s) => s.detailLoading)
  const tf = useTimeFormatFor(summary?.time_zone)
  const product = summary ? highestProduct(summary) : null
  const productLine = product
    ? product.ends_ms != null
      ? fillCopy(PRODUCT_END, { event: product.event, time: fmtAt(product.ends_ms, tf, { zone: true }) })
      : product.event
    : null
  const lastKnown = summary && (resolved === 'bundle' || resolved === 'last_known') ? fillCopy(FLOOD_LAST_KNOWN, { date: fmtAt(summary.updated_ms ?? summary.started_ms, tf, { zone: true, year: 'always' }) }) : null
  return { summary, product, productLine, lastKnown, loading }
}

export function PublicFloodChrome({ credits }: { credits: ReactNode }) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const { summary, product, productLine, lastKnown, loading } = useFloodStubData()
  return (
    <>
      <TopBar
        className="mw-header"
        data-chrome="header"
        left={
          <>
            <BackButton onClick={goToFloodOverview} label={FLOOD_OVERVIEW.backToAll} tip="Back to the overview of all floods (lower 48 states)" />
            <h1 className="mw-hdr-title">{summary?.name ?? (loading ? 'Loading flood…' : 'Flood')}</h1>
            {summary && <LiveDot live={summary.mode === 'live'} year={summary.year} />}
            {summary?.synthetic && <span className="mw-demo-badge">{DEMO_TAG}</span>}
          </>
        }
        centre={!narrow ? <ViewPill size="sm" /> : undefined}
        right={
          <>
            <ShowPanelsPill />
            <CompactMenu />
          </>
        }
      />
      <div className="mw-layers-slot" data-chrome="layers">
        <LayersPanel />
      </div>
      <div className="mw-top">
        <div className="mw-card" data-chrome="card">
          <section className="mw-panel fxo-stub" aria-label="Official flood information">
            {product && (
              <p>
                <span data-verbatim="">{product.event}</span> · {product.sender_name ?? 'NWS'}
              </p>
            )}
            {productLine && <p className="mw-mono">{productLine}</p>}
            {lastKnown && <p>{lastKnown}</p>}
            <p>{NOT_ALL_CLEAR}</p>
          </section>
          <LocationCard />
        </div>
        <div className="mw-controls ovw-cluster" data-chrome="controls">
          <MapControls variant="compact" />
        </div>
      </div>
      <div className="mw-bottom">
        <div className="mw-note" data-chrome="note">
          <FixedCopy variant="corner" />
        </div>
        {credits}
      </div>
    </>
  )
}
