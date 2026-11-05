// The selected point's card in Floods (brief 5, PLAN-5 §4.3; C27, D24). Official information first, each with its issuer,
// its own times, its words verbatim and a link: every NWS flood product at the point (watches included, whatever "Show
// watches" says), then the nearest river gauge at action stage or above within 25 km (another stream may be closer),
// then the nearest listed floods with their distance (measured to each flood's point, never a risk statement). An
// absence sentence needs an answer: NO_PRODUCT and NO_GAUGE_NEAR show only when that answer is `available`; an
// unavailable one shows its "could not be reached" text instead. Ends with "Not an all-clear. Follow local officials."
// The gauge line keeps its own reading time (in the gauge's zone, with its age), a link to its NWS page and its data
// attribution ("Observations courtesy of U.S. Geological Survey"); the nearest floods say their distance is to each
// flood's marker, not to the water's edge (review WFO-R6, WFO-R7). Words in ui/shell/floodCopy.ts.
// Data: /api/official/flood-alerts?bbox=<the point> and /api/official/river-gauges?bbox=<the point ± 25 km> (cached per
// URL, extras/jsonQuery.ts), the flood list.
// Brief 5 web-flood-public (PLAN-5 §4.4 "Selected point", C1, C2): with a flood open, the card starts with what each of
// the flood's layers says about the spot (location/floodCheck.ts checkPoint: inside or the distance to the NWS warning
// area and the NWS forecast flooded area, the satellite's view of the spot: water, no water, clouds, no data or outside
// the image; FEMA when its layer is on), each tagged with its kind; Public ends it with the link to the experimental
// model in Command. Brief 6 (web-flood-playback, declared edit; review WFP-R1, WFP-R2): the block follows the chart's
// handle as the map does (a past step's own NWS versions and satellite pass); Public has no handle and shows now.
import { ArrowRight, ChevronRight, Droplets, ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import { API_BASE } from '../api/client'
import { floodAlertsQuery, riverGaugesQuery } from '../api/floods'
import type { FloodAlertsResponse, RiverGaugesResponse } from '../api/types'
import { expandBbox } from '../extras/client'
import { useCachedJsonQuery } from '../extras/jsonQuery'
import { formatLatLon } from '../lib/geodesy'
import { directionWord, distance } from '../lib/plainLanguage'
import { fmtAt, timeFmt } from '../lib/time'
import { useNow } from '../ui/hooks'
import { useShallow } from 'zustand/react/shallow'
import { useFloodOfficial, useSatClassAt } from '../official/floodHooks'
import { answerState } from '../official/floodModel'
import { openFloodSummary, pickFlood, useFlood } from '../state/flood'
import { useFloodHandleMs, useProductsAtHandle, useSatelliteAtHandle } from '../state/floodTimelineData'
import { applyView } from '../ui/shell/views'
import { checkPoint, type FloodCheckKind } from './floodCheck'
import { getSlot } from '../state/floodCatalog'
import { useClock, useTimeFormatFor } from '../state/timeZone'
import { useWorkspace, type SelectedLocation } from '../state/workspace'
import { floodDisplayName, floodHereLine, floodPointModel, floodRowSub, fmtStage, gaugeReadingLine, NEAR_GAUGE_KM } from '../ui/public/floodOverviewText'
import { DEMO_TAG, FLOOD_OVERVIEW, FLOOD_PUBLIC, GAUGE_CATEGORY_DISPLAY, NOT_ALL_CLEAR, fillCopy, PRODUCT_END } from '../ui/shell/floodCopy'
import { CardFrame } from './CardParts'
import './location.css'
import '../styles/flood-overview.css'
import '../styles/view-flood-public.css'

const REFRESH_MS = 2 * 60_000

/** The point's own flood-alerts URL (a zero-size box: the backend says which products cover it). */
function pointAlertsUrl(lat: number, lon: number): string {
  return `${API_BASE}/api${floodAlertsQuery({ bbox: [lon, lat, lon, lat] })}`
}

function pointGaugesUrl(lat: number, lon: number): string {
  return `${API_BASE}/api${riverGaugesQuery({ bbox: expandBbox([lon, lat, lon, lat], NEAR_GAUGE_KM) })}`
}

/** The NWS flood products at a point (Fires mode uses it for one line; Floods for the card). */
function usePointFloodAlerts(lat: number, lon: number, enabled = true) {
  return useCachedJsonQuery<FloodAlertsResponse>(enabled ? pointAlertsUrl(lat, lon) : null, { refreshMs: REFRESH_MS })
}

const KIND_TAG: Record<FloodCheckKind, string | null> = { official: 'NWS', forecast: 'NWS forecast · experimental', satellite: 'Satellite', background: 'FEMA', model: 'Model · experimental', note: null }

const asked = (st: ReturnType<typeof answerState>) => (st === 'none' ? 'loading' : st)

/** A line's text with NWS's own event name inside data-verbatim (CONTRACT §16.0; review WFP-R11). */
function CheckText({ text, event }: { text: string; event?: string }) {
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

/** A flood view: what each of the open flood's layers says about the spot (checkPoint), each line tagged. */
export function FloodViewBlock({ sel }: { sel: SelectedLocation }) {
  const fl = useFlood(useShallow((s) => ({ summary: openFloodSummary(s), floodplain: s.layers.floodplain })))
  const off = useFloodOfficial(useShallow((s) => ({ alerts: s.alerts, fim: s.fim, satellite: s.satellite, nfhl: s.nfhl })))
  const units = useWorkspace((s) => s.units)
  const publicView = useWorkspace((s) => s.preset === 'public')
  const tf = useTimeFormatFor(fl.summary?.time_zone)
  const nowMs = useNow(60_000)
  // brief 6 (web-flood-playback, declared edit; review WFP-R2): the NWS products and the satellite pass at the chart's
  // handle, as the map draws them (Public has no handle: always now, review WFP-R1)
  const cursorMs = useFloodHandleMs()
  const products = useProductsAtHandle(off.alerts.data)
  const satAt = useSatelliteAtHandle(off.satellite.data)
  const satClass = useSatClassAt(sel.lon, sel.lat, satAt)
  const a = off.alerts
  const alertsStatus = products.source === 'timeline' ? 'available' : a.data ? a.data.status : a.loading ? 'loading' : a.error ? 'failed' : 'loading'
  const c = checkPoint({
    point: [sel.lon, sel.lat],
    alerts: products.alerts,
    shown: products,
    alertsStatus,
    zones: products.zones,
    fim: off.fim.data,
    satellite: satAt,
    // each layer's own state: a failed request says so and a running one blocks NOTHING_COVERS (review WFP-R1)
    // (both are always asked for an open flood: not asked yet reads as loading)
    fimState: asked(answerState(off.fim)),
    satelliteState: asked(answerState(off.satellite)),
    nfhlState: fl.floodplain ? answerState(off.nfhl) : 'none',
    satClass,
    nfhl: fl.floodplain ? off.nfhl.data : null,
    model: null,
    gauges: [],
    rivers: fl.summary?.rivers ?? [],
    cursorMs,
    nowMs,
    tf,
    units,
  })
  return (
    <section className="fxo-card-block ffc-block" aria-label={FLOOD_PUBLIC.pointLayersTitle}>
      <p className="loc-block-title">{FLOOD_PUBLIC.pointLayersTitle}</p>
      <ul className="ffc-lines">
        {c.lines.map((l) => (
          <li key={l.key} className={`ffc-line is-${l.kind}${l.inside ? ' is-inside' : ''}${l.tone ? ` is-${l.tone}` : ''}`}>
            {KIND_TAG[l.kind] && <span className={`ffc-tag is-${l.kind}`}>{KIND_TAG[l.kind]}</span>}
            <span className="ffc-text">
              <CheckText text={l.text} event={l.event} />
            </span>
          </li>
        ))}
      </ul>
      {publicView && (
        <p className="loc-line-detail ffc-model">
          <button type="button" className="mw-link-btn" onClick={() => applyView('command')}>
            {FLOOD_PUBLIC.modelInCommand} <ChevronRight size={12} aria-hidden="true" />
          </button>
        </p>
      )}
    </section>
  )
}

export function FloodPointCard({ sel }: { sel: SelectedLocation }) {
  const units = useWorkspace((s) => s.units)
  const command = useWorkspace((s) => s.preset === 'command')
  const clock = useClock()
  const nowMs = useNow(60_000)
  const alerts = usePointFloodAlerts(sel.lat, sel.lon)
  const gauges = useCachedJsonQuery<RiverGaugesResponse>(pointGaugesUrl(sel.lat, sel.lon), { refreshMs: 5 * 60_000 })
  const live = useFlood((s) => getSlot(s.lists, 'live').response)
  const floodOpen = useFlood((s) => s.floodId != null)
  const m = useMemo(
    () =>
      floodPointModel({
        point: { lat: sel.lat, lon: sel.lon },
        alerts: alerts.data,
        alertsFailed: alerts.data == null && alerts.error != null,
        gauges: gauges.data,
        gaugesFailed: gauges.data == null && gauges.error != null,
        floods: live?.floods ?? [],
      }),
    [sel.lat, sel.lon, alerts.data, alerts.error, gauges.data, gauges.error, live],
  )
  const title = sel.label ?? formatLatLon(sel.lat, sel.lon)
  const loadingAlerts = alerts.data == null && alerts.loading
  return (
    <CardFrame sel={sel} title={title} titleIsCoords={!sel.label} type={sel.source === 'address' ? 'Address' : 'Selected point'} approximate={sel.approximate === true} command={command}>
      {floodOpen && <FloodViewBlock sel={sel} />}
      <section className="fxo-card-block" aria-label="NWS flood products at this spot">
        <p className="loc-block-title">
          <span className="mw-tag is-official">Official</span> {FLOOD_OVERVIEW.pointProductsTitle}
        </p>
        {loadingAlerts && <p className="loc-line-text">{FLOOD_OVERVIEW.checkingProducts}</p>}
        <ul className="fxo-card-products">
          {m.products.map((a) => {
            const tf = timeFmt(a.time_zone, clock)
            return (
              <li key={a.id} className={`fxo-card-product${a.emergency ? ' is-emergency' : ''}`}>
                <p className="fxo-card-event">
                  <strong data-verbatim="">{a.event}</strong>
                  {a.emergency && <span className="fxo-card-emergency"> · Flash Flood Emergency</span>}
                  <span className="fxo-card-issuer"> · {a.sender_name ?? 'National Weather Service'}</span>
                </p>
                {a.ends_ms != null && <p className="fxo-card-meta mw-mono">{fillCopy(PRODUCT_END, { event: a.event, time: fmtAt(a.ends_ms, tf, { zone: true }) })}</p>}
                {a.headline && (
                  <p className="fxo-card-headline" data-verbatim="">
                    {a.headline}
                  </p>
                )}
                {a.url && (
                  <a className="fxo-card-link" href={a.url} target="_blank" rel="noreferrer noopener">
                    NWS <ExternalLink size={11} aria-hidden="true" />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
        {m.productsNote && <p className="loc-line-text fxo-card-note">{m.productsNote}</p>}
      </section>
      <section className="fxo-card-block" aria-label="River gauge near this spot">
        <p className="loc-block-title">{FLOOD_OVERVIEW.pointGaugeTitle}</p>
        {m.gauge ? (
          <>
            <p className="loc-line-text">
              <span className="mw-mono">{m.gauge.gauge.lid}</span> <span data-verbatim="">{m.gauge.gauge.name}</span>
              {' · '}
              {[fmtStage(m.gauge.gauge.observed.value, m.gauge.gauge.observed.unit, units), (GAUGE_CATEGORY_DISPLAY[m.gauge.gauge.observed.category] ?? GAUGE_CATEGORY_DISPLAY.unknown).short].filter(Boolean).join(' · ')}
              {' · '}
              {distance(m.gauge.distanceM, units).text} {directionWord(m.gauge.bearingDeg)}
            </p>
            {/* official information keeps its own time, its issuer's attribution and a link (WFO-R7) */}
            <p className="loc-line-detail fxo-card-gauge-meta">
              <span className="mw-mono">{gaugeReadingLine(m.gauge.gauge.observed.valid_ms, m.gauge.gauge.time_zone, clock, nowMs)}</span>
              {m.gauge.gauge.data_attribution.map((d) => (
                <span key={d.text}>
                  {' · '}
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer noopener" data-verbatim="">
                      {d.text}
                    </a>
                  ) : (
                    <span data-verbatim="">{d.text}</span>
                  )}
                </span>
              ))}
              {m.gauge.gauge.url && (
                <>
                  {' · '}
                  <a className="fxo-card-link" href={m.gauge.gauge.url} target="_blank" rel="noreferrer noopener">
                    {FLOOD_OVERVIEW.gaugePage} <ExternalLink size={11} aria-hidden="true" />
                  </a>
                </>
              )}
            </p>
          </>
        ) : (
          gauges.data == null && gauges.loading && <p className="loc-line-text">{FLOOD_OVERVIEW.checkingGauges}</p>
        )}
        {m.gaugeNote && <p className="loc-line-detail">{m.gaugeNote}</p>}
      </section>
      {m.nearest.length > 0 && (
        <section className="fxo-card-block" aria-label={FLOOD_OVERVIEW.nearestTitle}>
          <p className="loc-block-title">{FLOOD_OVERVIEW.nearestTitle}</p>
          <ul className="loc-fire-list">
            {m.nearest.map((n) => (
              <li key={n.flood.id}>
                <button type="button" className="loc-fire-row" onClick={() => pickFlood(n.flood.id, 'card')} title={`Open ${floodDisplayName(n.flood)}`}>
                  <Droplets size={14} aria-hidden="true" className="loc-result-icon fxo-card-icon" />
                  <span className="loc-result-text">
                    <span className="loc-fire-head">
                      <span className="loc-result-title">
                        {n.flood.name}
                        {n.flood.synthetic && <span className="fxo-demo">{DEMO_TAG}</span>}
                      </span>
                      <span className="loc-fire-dist mw-mono">
                        {distance(n.distanceM, units).text} {directionWord(n.bearingDeg)}
                      </span>
                    </span>
                    <span className="loc-result-sub">{floodRowSub(n.flood)}</span>
                  </span>
                  <ArrowRight size={13} aria-hidden="true" className="loc-fire-go" />
                </button>
              </li>
            ))}
          </ul>
          {/* a far distance must not read as "the flooding is far from here" (WFO-R6) */}
          <p className="loc-line-detail">{FLOOD_OVERVIEW.nearestDistanceNote}</p>
        </section>
      )}
      <p className="loc-line-detail fxo-card-foot">{NOT_ALL_CLEAR}</p>
    </CardFrame>
  )
}

/** Fires mode (C27): one line under the fire point card when NWS flood products are in effect at the point; nothing
 *  when none are listed or the answer failed. "Show floods" switches the map to Floods (the point stays). */
export function FloodHereInFires({ sel }: { sel: SelectedLocation }) {
  const alerts = usePointFloodAlerts(sel.lat, sel.lon)
  const line = floodHereLine(alerts.data)
  if (!line) return null
  const [text, action] = line.split(' · ')
  return (
    <p className="mw-panel fxo-here" role="note">
      <Droplets size={13} aria-hidden="true" className="fxo-card-icon" /> {text} ·{' '}
      <button type="button" className="mw-link-btn" onClick={() => useWorkspace.getState().setHazard('flood')}>
        {action}
      </button>
    </p>
  )
}
