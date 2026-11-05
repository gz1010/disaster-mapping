// The 3D flood view's dock (brief 5, PLAN-5 §4.7): the fire dock's place (ui/BottomDock.tsx, .dock) with the river level
// chart, `Hydrograph variant="dock"` (web-flood-command's M1), for the gauge picked on its left (the flood's member
// gauges, primary first). Its handle sets useFlood.cursorMs, which the warning lines follow (C1: after now they keep the
// NWS products in effect now). "Charts & NWS products" opens the right column: the NWS products drawn at the handle,
// the same versions as the 3D warning lines and the hover (scene/flood/productsOnScreen.ts; review WFF3D-R4): before now
// from the flood's time history, IEM archive copies tagged and credited; each with its issuer, its own issue and end
// times, NWS's words verbatim and a link. Then where the list comes from (the time history, or the copy saved with the
// 3D data and its time), and CURSOR_FUTURE_PRODUCTS (or CURSOR_FUTURE_ISSUED) after now.
import type { Ref } from 'react'
import { fmtAt, fmtRelative } from '../../lib/time'
import { CATEGORY_COLORS, gaugeTone } from '../../map/floodStyle'
import { memberGaugesOf, orderAlerts } from '../../official/floodModel'
import { useProductsOnScreen } from '../../scene/flood/flood3dHooks'
import { floodAssetStore } from '../../scene/flood/floodAssets'
import { categoryCaps } from '../../scene/flood/gaugeBarMath'
import { useFlood } from '../../state/flood'
import { useTimeFormat } from '../../state/timeZone'
import { useNow } from '../hooks'
import { fillCopy } from '../shell/floodCopy'
import { NARROW_QUERY, useMediaQuery } from '../shell/hooks'
import { Hydrograph } from '../timeline/Hydrograph'
import { NwsVersion } from '../timeline/HydrographPlayback'
import { futureProductsNote } from '../timeline/hydrographModel'
import { FLOOD_FORENSIC } from './floodForensicCopy'
import { dockNoProduct } from './floodForensicView'

/** The chart's gauge: the flood's member gauges (primary first), a compact picker on the dock's left; its colour is
 *  the gauge's NWS category, written in the list. Phones: the colour diamond and the gauge id only (the slim chart's
 *  narrow left button; review WFF-R9), the category in each option's accessible name. */
function GaugePick({ narrow }: { narrow: boolean }) {
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  const lid = useFlood((s) => s.gaugeLid)
  const members = flood ? memberGaugesOf(flood.gauges, flood.summary) : []
  if (members.length < 2) return null
  const shown = members.find((g) => g.lid === lid) ?? members.find((g) => g.lid === flood?.summary.primary_gauge?.lid) ?? members[0]
  return (
    <label className={`fxf-pick${narrow ? ' is-narrow' : ''}`} data-tip={`${shown.name} · ${categoryCaps(shown.observed.category)}`}>
      <i style={{ background: CATEGORY_COLORS[gaugeTone(shown.observed.category)] }} aria-hidden="true" />
      <span className="sr-only">{FLOOD_FORENSIC.gaugePick}</span>
      <select className="mono" value={shown.lid} onChange={(e) => useFlood.getState().setGauge(e.target.value)}>
        {members.map((g) => (
          <option key={g.lid} value={g.lid} aria-label={`${g.lid} · ${categoryCaps(g.observed.category)}`}>
            {narrow ? g.lid : `${g.lid} · ${categoryCaps(g.observed.category)}`}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The NWS products drawn at the handle: the very list the 3D warning lines and the hover use (productsOnScreen.ts),
 *  each version with its issuer, its own times, NWS's words verbatim and a link (an IEM archive copy tagged, with the
 *  archive's credit). Where the list comes from is said under it; an empty list says at what time and in which list
 *  (never "right now" for a past handle or an old copy; review WFF-R5, WFF3D-R4). */
function ProductsColumn() {
  const tf = useTimeFormat()
  const now = useNow(60_000)
  const cursorMs = useFlood((s) => s.cursorMs)
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  const resp = flood?.warnings ?? null
  const shown = useProductsOnScreen(flood)
  const list = orderAlerts(shown?.alerts ?? [])
  const fromMs = shown?.retrievedMs ?? null
  const from = fromMs != null ? fmtAt(fromMs, tf, { zone: true, year: 'auto', refMs: now }) : null
  const none = dockNoProduct({ cursorMs, nowMs: now, savedMs: resp?.retrieved_ms ?? null, tf, source: shown?.source ?? 'copy' })
  const future = shown ? futureProductsNote(shown) : null
  const credit = shown?.archiveCredit ?? null
  return (
    <aside className="ke fxf-ke" aria-label={FLOOD_FORENSIC.evidenceTitle}>
      <div className="dock-title">{FLOOD_FORENSIC.evidenceTitle}</div>
      {!shown ? (
        <p className="fxf-none">{resp?.reason ?? FLOOD_FORENSIC.evidenceUnavailable}</p>
      ) : list.length === 0 ? (
        <p className="fxf-none">{none}</p>
      ) : (
        <ul className="hg-nws-list fxf-ke-nws">
          {list.map((a) => (
            <NwsVersion key={a.id} a={a} tf={{ tz: a.time_zone || tf.tz, clock: tf.clock }} />
          ))}
        </ul>
      )}
      {future && <p className="fxf-ke-future">{future}</p>}
      {credit && (
        <p className="hg-nws-credit fxf-ke-credit">
          {credit.href ? (
            <a href={credit.href} target="_blank" rel="noreferrer noopener">
              {credit.text}
            </a>
          ) : (
            credit.text
          )}
        </p>
      )}
      {shown && from && fromMs != null && (
        <p className="fxf-ke-copy mono">{fillCopy(shown.source === 'timeline' ? FLOOD_FORENSIC.dockTimelineTime : FLOOD_FORENSIC.dockCopyTime, { time: from, age: fmtRelative(fromMs, now) })}</p>
      )}
    </aside>
  )
}

export function FloodDock({ dockRef }: { dockRef?: Ref<HTMLElement> }) {
  const floodId = useFlood((s) => s.floodId)
  const lid = useFlood((s) => s.gaugeLid)
  const narrow = useMediaQuery(NARROW_QUERY)
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  const products = flood?.warnings?.status === 'available' ? flood.warnings.alerts : undefined
  const gauges = flood?.gauges?.status === 'available' ? [...memberGaugesOf(flood.gauges, flood.summary), ...flood.gauges.gauges.filter((g) => !g.member)] : undefined
  return (
    <section className="dock glass fxf-dock" ref={dockRef} aria-label={FLOOD_FORENSIC.dockTitle}>
      <div className="dock-main fxf-dock-main">
        <GaugePick narrow={narrow} />
        {floodId && <Hydrograph variant="dock" floodId={floodId} lid={lid} products={products} gauges={gauges} />}
      </div>
      <ProductsColumn />
    </section>
  )
}
