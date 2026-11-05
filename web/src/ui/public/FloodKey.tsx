// The flood view's map key (brief 5, FloodView.dc.html "Map key"; PLAN-5 §4.4, D8, C2, C16, D21): one item per layer
// drawn, each with its own source and time, then the scale and "Legend details". Neither layer is "now" (D8): "Water
// seen by satellite · Oct 31, 4:06 PM (4 d ago)" (the age computed now from the image's own time, amber after 3 days),
// "No satellite view (clouds or no data)" (the grey hatch) and "Edge of the satellite image" whenever the image has such
// parts, "NWS forecast flooded area · issued 10:20 AM", "Main channel", "NWS warning area" and, when switched on, "FEMA
// 1% annual-chance floodplain · effective {date}". Without the NASA login the key says "No radar images: NASA login not
// set up". The fire key's shape (ui/public/FireKey.tsx).
import { useShallow } from 'zustand/react/shallow'
import { useFloodOfficial } from '../../official/floodHooks'
import { officialAlerts } from '../../official/floodModel'
import { FloodLegend } from '../../map/FloodLegend'
import { ScaleBar } from '../../map/MapAttribution'
import { openFloodSummary, useFlood } from '../../state/flood'
import { useTimeFormatFor } from '../../state/timeZone'
import { useNow } from '../hooks'
import { FLOOD_PUBLIC } from '../shell/floodCopy'
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
  const items = floodKeyItems({ satellite: off.satellite.data, fim: off.fim.data, nfhl: off.nfhl.data, warnings, layers, tf, nowMs })
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
    </div>
  )
}

/** The top bar's status from 1280 px (PLAN-5 §4.4): "NASA OPERA · OCT 31 · 4 D AGO", amber after 3 days (the age
 *  computed now from the image's own time, C16); a picture-only answer "NASA PICTURE · OCT 31"; nothing without one. */
export function FloodSatStatus() {
  const summary = useFlood((s) => openFloodSummary(s))
  const sat = useFloodOfficial((s) => s.satellite.data)
  const on = useFlood((s) => s.layers.satellite)
  const tf = useTimeFormatFor(summary?.time_zone)
  const nowMs = useNow(60_000)
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
  if (sat.tiles) return <p className="ffv-sat-status">NASA PICTURE · {sat.tiles.date}</p>
  return null
}
