// The flood view's map key (brief 5, FloodView.dc.html "Map key"; PLAN-5 §4.4, D8, C2, C16, D21): one item per layer
// drawn, each with its own source and time, then the scale and "Legend details". Neither layer is "now" (D8): "Water
// seen by satellite · Oct 31, 4:06 PM (4 d ago)" (the age computed now from the image's own time, amber after 3 days),
// "No satellite view (clouds or no data)" (the grey hatch) and "Edge of the satellite image" whenever the image has such
// parts, "NWS forecast flooded area · issued 10:20 AM", "Main channel", "NWS warning area" and, when switched on, "FEMA
// 1% annual-chance floodplain · effective {date}". Without the NASA login the key says "No radar images: NASA login not
// set up". The fire key's shape (ui/public/FireKey.tsx).
import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useFloodOfficial } from '../../official/floodHooks'
import { answerState, officialAlerts } from '../../official/floodModel'
import { DRAW_SAT_PICTURE } from '../../map/floodAreaLayers'
import { FloodLegend } from '../../map/FloodLegend'
import { ScaleBar } from '../../map/MapAttribution'
import { openFloodSummary, useFlood } from '../../state/flood'
import { gaugeCategoryRank } from '../../state/floodOverview'
import { useTimeFormatFor } from '../../state/timeZone'
import { useNow } from '../hooks'
import { FLOOD_PUBLIC, SAT_UNAVAILABLE } from '../shell/floodCopy'
import { floodKeyItems, SAT_STALE_MS, upperDay, type FloodKeyItem } from './floodView'
import { shownGranule } from '../../official/floodModel'
import { fmtRelative } from '../../lib/time'

function Item({ it }: { it: FloodKeyItem }) {
  return (
    <span className={`pfv-key-item ffk-item is-${it.key}`} data-tip={it.tip ?? undefined}>
      {it.swatch && <span className={`ffk-sw ffk-sw-${it.swatch}`} aria-hidden="true" />}
      <span className="pfv-key-text">
        {it.text}
        {it.time && <span className="pfv-key-time"> · {it.time}</span>}
        {it.age && (
          <span className={`pfv-key-time${it.stale ? ' is-stale' : ''}`} data-tip={it.stale ? FLOOD_PUBLIC.keyStaleTip : undefined}>
            {' '}
            ({it.age})
          </span>
        )}

      </span>
    </span>
  )
}

export function FloodKey({ details = true }: { details?: boolean }) {
  const summary = useFlood((s) => openFloodSummary(s))
  const layers = useFlood((s) => s.layers)
  const off = useFloodOfficial(useShallow((s) => ({ satellite: s.satellite, fim: s.fim, nfhl: s.nfhl, alerts: s.alerts })))
  const tf = useTimeFormatFor(summary?.time_zone)
  const nowMs = useNow(60_000)
  const warnings = officialAlerts(off.alerts.data).some((a) => a.geometry != null) || (off.alerts.data?.zones?.features.length ?? 0) > 0
  // each answer's state, so a failed or running request is said, never a layer that silently vanishes (review WFP-R1);
  // both are always asked for an open flood (not asked yet reads as loading)
  const satState = answerState(off.satellite)
  const fimState = answerState(off.fim)
  const items = floodKeyItems({
    satellite: off.satellite.data,
    fim: off.fim.data,
    nfhl: off.nfhl.data,
    warnings,
    layers,
    tf,
    nowMs,
    pictureDrawn: DRAW_SAT_PICTURE,
    satelliteState: satState === 'none' ? 'loading' : satState,
    fimState: fimState === 'none' ? 'loading' : fimState,
    satelliteError: off.satellite.error,
    fimError: off.fim.error,
  })
  const loading = off.satellite.loading && off.fim.loading && !off.satellite.data && !off.fim.data
  return (
    <div className="pfv-key ffk" role="group" aria-label="Map key">
      {items.length ? (
        items.map((it) => <Item key={it.key} it={it} />)
      ) : (
        <span className="pfv-key-item">
          <span className="pfv-key-text">{loading ? FLOOD_PUBLIC.keyLoading : FLOOD_PUBLIC.keyNoLayer}</span>
        </span>
      )}
      <span className="pfv-key-sep" aria-hidden="true" />
      <span className="pfv-key-scale">
        <ScaleBar />
      </span>
      {details && (
        <span className="pfv-key-legend">
          <FloodLegend variant="key" />
        </span>
      )}
      {/* the drawn layers' own credits (the map's credits in the foot bar name the list's NWS and NOAA gauges) */}
      <FloodLayerCredits />
    </div>
  )
}

/** The top bar's status from 1280 px (PLAN-5 §4.4): "NASA OPERA · OCT 31 · 4 D AGO", amber after 3 days (the age
 *  computed now from the image's own time, C16); a picture-only answer "NASA PICTURE · OCT 31"; nothing without one. */
export function FloodSatStatus() {
  const summary = useFlood((s) => openFloodSummary(s))
  const sat = useFloodOfficial((s) => s.satellite.data)
  const failed = useFloodOfficial((s) => answerState(s.satellite) === 'unavailable')
  const error = useFloodOfficial((s) => s.satellite.error)
  const on = useFlood((s) => s.layers.satellite)
  const tf = useTimeFormatFor(summary?.time_zone)
  const nowMs = useNow(60_000)
  // satellite water could not be loaded (the request failed or the backend could not read NASA): said, amber, with
  // SAT_UNAVAILABLE in the tooltip (review WFP-R1)
  if (on && failed)
    return (
      <p className="ffv-sat-status is-stale" data-tip={[SAT_UNAVAILABLE, sat?.reason ?? error].filter(Boolean).join(' · ')}>
        {FLOOD_PUBLIC.satStatusUnavailable}
      </p>
    )
  if (!sat || !on || sat.status !== 'available') return null
  const g = shownGranule(sat)
  if (sat.measured && g) {
    const day = upperDay(g.acquired_ms, tf.tz).replace(/ \d{4}$/, '')
    const stale = nowMs - g.acquired_ms > SAT_STALE_MS
    return (
      <p className={`ffv-sat-status${stale ? ' is-stale' : ''}`} data-tip={sat.caveats[0] ?? undefined}>
        NASA OPERA · {day} · {fmtRelative(g.acquired_ms, nowMs).toUpperCase()}
      </p>
    )
  }
  if (sat.tiles && DRAW_SAT_PICTURE) return <p className="ffv-sat-status">NASA PICTURE · {sat.tiles.date}</p>
  return null
}

/** The flood view's own layers' credits (CONTRACT §16.15), next to the map's credits in the foot bar: the NWS forecast
 *  flooded area (NOAA/NWS National Water Center, experimental), water seen by satellite (NASA JPL OPERA), the FEMA
 *  floodplain while it is on, and USGS for the gauges' measurements; each only while its layer shows data. The flood
 *  list's own credits (NWS, NOAA's river gauges) are in the map's credits already. */
export function FloodLayerCredits({ foot = false }: { foot?: boolean } = {}) {
  const layers = useFlood((s) => s.layers)
  const off = useFloodOfficial(useShallow((s) => ({ fim: s.fim.data, satellite: s.satellite.data, nfhl: s.nfhl.data, gauges: s.gauges.data })))
  const items: { id: string; text: string; href: string | null }[] = []
  const add = (id: string, src: { credit: string; terms_url?: string | null; url?: string | null } | null | undefined) => {
    if (!src?.credit || items.some((x) => x.text === src.credit)) return
    const href = [src.url, src.terms_url].find((u) => typeof u === 'string' && u.startsWith('https://')) ?? null
    items.push({ id, text: src.credit, href })
  }
  if (layers.forecastArea && off.fim?.status === 'available' && off.fim.features.features.length) add('fim', off.fim.source)
  if (layers.satellite && off.satellite?.status === 'available' && (off.satellite.image || (DRAW_SAT_PICTURE && off.satellite.tiles))) add('sat', off.satellite.source)
  if (layers.floodplain && off.nfhl?.status === 'available') add('nfhl', off.nfhl.source)
  // the gauges the map draws: every member gauge, nearby ones at action stage or above (map/floodController.ts)
  const drawn = off.gauges?.status === 'available' && layers.gauges ? off.gauges.gauges.filter((g) => g.member || gaugeCategoryRank(g.observed.category) >= 1) : []
  const usgs = drawn.flatMap((g) => g.data_attribution).find((d) => /U\.?S\.? Geological Survey|USGS/i.test(d.text))
  if (usgs) items.push({ id: 'usgs', text: 'Gauge readings: U.S. Geological Survey (provisional data)', href: 'https://waterdata.usgs.gov/provisional-data-statement/' })
  if (!items.length) return null
  return (
    <span className={`ffv-credits${foot ? ' is-foot' : ''}`} aria-label="Sources of the flood layers">
      {items.map((a, i) => (
        <span key={a.id}>
          {i > 0 && ' · '}
          {a.href ? (
            <a href={a.href} target="_blank" rel="noreferrer noopener">
              {a.text}
            </a>
          ) : (
            a.text
          )}
        </span>
      ))}
    </span>
  )
}

/** The flood layers' credits in the foot bar's credits (`#mw-credits`, App.tsx CreditsFooter) while the key that
 *  carries them is hidden: panels collapsed, phones (there folded behind "© Credits" with the map's credits). Every
 *  drawn layer stays credited (CLAUDE.md; PLAN-5 §4.4 foot bar; review WFP-R6). */
export function FloodFootCredits({ show }: { show: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  // a hidden anchor next to the foot's credits finds their element once both are in the page
  const anchor = useCallback((el: HTMLSpanElement | null) => setHost(el?.parentElement?.querySelector<HTMLElement>('#mw-credits') ?? null), [])
  return (
    <>
      <span ref={anchor} hidden />
      {show && host ? createPortal(<FloodLayerCredits foot />, host) : null}
    </>
  )
}
