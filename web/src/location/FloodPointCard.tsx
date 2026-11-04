// The selected point's card in Floods (brief 5, PLAN-5 §4.3; C27, D24). Official information first, each with its issuer,
// its own times, its words verbatim and a link: every NWS flood product at the point (watches included, whatever "Show
// watches" says), then the nearest river gauge at action stage or above within 25 km (another stream may be closer),
// then the nearest listed floods with their distance (measured to each flood's point, never a risk statement). An
// absence sentence needs an answer: NO_PRODUCT and NO_GAUGE_NEAR show only when that answer is `available`; an
// unavailable one shows its "could not be reached" text instead. Ends with "Not an all-clear. Follow local officials."
// Data: /api/official/flood-alerts?bbox=<the point> and /api/official/river-gauges?bbox=<the point ± 25 km> (cached per
// URL, extras/jsonQuery.ts), the flood list. The flood views' own point check (inside / distance to each layer) is
// web-flood-public's (location/floodCheck.ts).
import { ArrowRight, Droplets, ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import { API_BASE } from '../api/client'
import { floodAlertsQuery, riverGaugesQuery } from '../api/floods'
import type { FloodAlertsResponse, RiverGaugesResponse } from '../api/types'
import { expandBbox } from '../extras/client'
import { useCachedJsonQuery } from '../extras/jsonQuery'
import { formatLatLon } from '../lib/geodesy'
import { directionWord, distance } from '../lib/plainLanguage'
import { fmtAt, timeFmt } from '../lib/time'
import { pickFlood, useFlood } from '../state/flood'
import { getSlot } from '../state/floodCatalog'
import { useClock } from '../state/timeZone'
import { useWorkspace, type SelectedLocation } from '../state/workspace'
import { floodDisplayName, floodHereLine, floodPointModel, floodRowSub, fmtStage, NEAR_GAUGE_KM } from '../ui/public/floodOverviewText'
import { DEMO_TAG, GAUGE_CATEGORY_DISPLAY, NOT_ALL_CLEAR, fillCopy, PRODUCT_END } from '../ui/shell/floodCopy'
import { CardFrame } from './CardParts'
import './location.css'
import '../styles/flood-overview.css'

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

export function FloodPointCard({ sel }: { sel: SelectedLocation }) {
  const units = useWorkspace((s) => s.units)
  const command = useWorkspace((s) => s.preset === 'command')
  const clock = useClock()
  const alerts = usePointFloodAlerts(sel.lat, sel.lon)
  const gauges = useCachedJsonQuery<RiverGaugesResponse>(pointGaugesUrl(sel.lat, sel.lon), { refreshMs: 5 * 60_000 })
  const live = useFlood((s) => getSlot(s.lists, 'live').response)
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
      <section className="fxo-card-block" aria-label="NWS flood products at this spot">
        <p className="loc-block-title">
          <span className="mw-tag is-official">Official</span> NWS flood products here
        </p>
        {loadingAlerts && <p className="loc-line-text">Checking NWS flood products…</p>}
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
        <p className="loc-block-title">River gauge (NWS)</p>
        {m.gauge ? (
          <p className="loc-line-text">
            <span className="mw-mono">{m.gauge.gauge.lid}</span> {m.gauge.gauge.name}
            {' · '}
            {[fmtStage(m.gauge.gauge.observed.value, m.gauge.gauge.observed.unit, units), (GAUGE_CATEGORY_DISPLAY[m.gauge.gauge.observed.category] ?? GAUGE_CATEGORY_DISPLAY.unknown).short].filter(Boolean).join(' · ')}
            {' · '}
            {distance(m.gauge.distanceM, units).text} {directionWord(m.gauge.bearingDeg)}
          </p>
        ) : (
          gauges.data == null && gauges.loading && <p className="loc-line-text">Checking river gauges…</p>
        )}
        {m.gaugeNote && <p className="loc-line-detail">{m.gaugeNote}</p>}
      </section>
      {m.nearest.length > 0 && (
        <section className="fxo-card-block" aria-label="Nearest listed floods">
          <p className="loc-block-title">Nearest listed floods</p>
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
