// The 3D flood view's dock (brief 5, PLAN-5 §4.7): the fire dock's place (ui/BottomDock.tsx, .dock) with the river level
// chart, `Hydrograph variant="dock"` (web-flood-command's M1), for the gauge picked on its left (the flood's member
// gauges, primary first). Its handle sets useFlood.cursorMs, which the warning lines follow (C1: after now they keep the
// NWS products in effect now). "Charts & NWS products" opens the right column: the NWS products drawn at the handle,
// verbatim, with their sender and end time, and CURSOR_FUTURE_PRODUCTS after now.
import type { Ref } from 'react'
import { fmtAt } from '../../lib/time'
import { CATEGORY_COLORS, gaugeTone } from '../../map/floodStyle'
import { memberGaugesOf, orderAlerts, senderName } from '../../official/floodModel'
import { floodAssetStore } from '../../scene/flood/floodAssets'
import { warningsAt } from '../../scene/flood/floodGeo'
import { categoryCaps } from '../../scene/flood/gaugeBarMath'
import { useFlood } from '../../state/flood'
import { useTimeFormat } from '../../state/timeZone'
import { useNow } from '../hooks'
import { CURSOR_FUTURE_PRODUCTS, fillCopy, FLOOD_PUBLIC, NO_PRODUCT } from '../shell/floodCopy'
import { Hydrograph } from '../timeline/Hydrograph'
import { FLOOD_FORENSIC } from './floodForensicCopy'

/** The chart's gauge: the flood's member gauges (primary first), a compact picker on the dock's left; its colour is
 *  the gauge's NWS category, written in the list. */
function GaugePick() {
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  const lid = useFlood((s) => s.gaugeLid)
  const members = flood ? memberGaugesOf(flood.gauges, flood.summary) : []
  if (members.length < 2) return null
  const shown = members.find((g) => g.lid === lid) ?? members.find((g) => g.lid === flood?.summary.primary_gauge?.lid) ?? members[0]
  return (
    <label className="fxf-pick" data-tip={shown.name}>
      <i style={{ background: CATEGORY_COLORS[gaugeTone(shown.observed.category)] }} aria-hidden="true" />
      <span className="sr-only">{FLOOD_FORENSIC.gaugePick}</span>
      <select className="mono" value={shown.lid} onChange={(e) => useFlood.getState().setGauge(e.target.value)}>
        {members.map((g) => (
          <option key={g.lid} value={g.lid}>
            {g.lid} · {categoryCaps(g.observed.category)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The NWS products drawn at the handle (the same rule as the warning lines). */
function ProductsColumn() {
  const tf = useTimeFormat()
  const now = useNow(60_000)
  const cursorMs = useFlood((s) => s.cursorMs)
  const resp = floodAssetStore((s) => s.assets?.flood.warnings ?? null)
  const available = resp?.status === 'available'
  const drawn = available ? warningsAt(resp.alerts, cursorMs, now) : { alerts: [], future: false }
  const list = orderAlerts(drawn.alerts)
  return (
    <aside className="ke fxf-ke" aria-label={FLOOD_FORENSIC.evidenceTitle}>
      <div className="dock-title">{FLOOD_FORENSIC.evidenceTitle}</div>
      {!available ? (
        <p className="fxf-none">{resp?.reason ?? FLOOD_FORENSIC.evidenceUnavailable}</p>
      ) : list.length === 0 ? (
        <p className="fxf-none">{NO_PRODUCT}</p>
      ) : (
        <ul className="fxf-ke-list">
          {list.map((a) => {
            const end = a.ends_ms ?? a.expires_ms
            const zoned = { tz: a.time_zone || tf.tz, clock: tf.clock }
            return (
              <li key={a.id} className={a.emergency ? 'is-emergency' : undefined}>
                <span className="fxf-ke-event" data-verbatim="">
                  {a.event}
                </span>
                <span className="fxf-ke-meta mono">
                  {senderName(a.sender_name)}
                  {end != null ? ` · ${fillCopy(FLOOD_PUBLIC.until, { time: fmtAt(end, zoned, { zone: true }) })}` : ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {drawn.future && <p className="fxf-ke-future">{CURSOR_FUTURE_PRODUCTS}</p>}
    </aside>
  )
}

export function FloodDock({ dockRef }: { dockRef?: Ref<HTMLElement> }) {
  const floodId = useFlood((s) => s.floodId)
  const lid = useFlood((s) => s.gaugeLid)
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  const products = flood?.warnings?.status === 'available' ? flood.warnings.alerts : undefined
  const gauges = flood?.gauges?.status === 'available' ? [...memberGaugesOf(flood.gauges, flood.summary), ...flood.gauges.gauges.filter((g) => !g.member)] : undefined
  return (
    <section className="dock glass fxf-dock" ref={dockRef} aria-label={FLOOD_FORENSIC.dockTitle}>
      <div className="dock-main fxf-dock-main">
        <GaugePick />
        {floodId && <Hydrograph variant="dock" floodId={floodId} lid={lid} products={products} gauges={gauges} />}
      </div>
      <ProductsColumn />
    </section>
  )
}
