// The NWS products the 3D flood view shows at the river-level chart's handle (brief 6 playback; review WFF3D-R4): one
// answer for the 3D warning lines (FloodFx WarningLines), the hover's NWS rows (floodProbe.ts) and the dock's "NWS
// products" column (ui/forensic-flood/FloodDock.tsx), so all three always list the same versions.
//   - before now: the flood's time history (GET /timeline, state/floodTimeline.ts productsAt): each version from its
//     issue time until its own end or NWS's next version, IEM archive copies included (tagged, with the archive's
//     credit)
//   - at and after now, or without the time history: the copy saved with the 3D data (warnings.json, kept current by
//     the flood live loop), its newest version of each product by brief 5's rule (floodGeo.warningsAt; C1 after now)
// Pure; tested in productsOnScreen.test.ts.
import type { FloodAlert, FloodAlertsResponse, FloodTimelineResponse } from '../../api/types'
import { archiveCreditAtHandle } from '../../map/floodAreaLayers'
import { productsAt } from '../../state/floodTimeline'
import { warningsAt } from './floodGeo'

export interface ProductsOnScreen {
  /** The versions drawn at the handle. */
  alerts: FloodAlert[]
  /** The zone outlines of the same source (zone-based products). */
  zones: FloodAlertsResponse['zones']
  /** 'timeline': the flood's time history (before now); 'copy': the copy saved with the 3D data. */
  source: 'timeline' | 'copy'
  /** After now: products in effect now are shown (C1); issuedForCursor: NWS has issued one for the handle's time. */
  future: boolean
  issuedForCursor: boolean
  /** The IEM archive's credit while archived versions are listed (else null). */
  archiveCredit: { text: string; href: string | null } | null
  /** When the list was read: the time history's retrieval time, or the saved copy's. */
  retrievedMs: number | null
}

/** The NWS products at the handle; null when the copy saved with the 3D data could not be read (its outage text is
 *  shown instead, D24). */
export function productsOnScreenOf(i: {
  copy: FloodAlertsResponse | null | undefined
  route: FloodTimelineResponse | null | undefined
  cursorMs: number | null
  nowMs: number
}): ProductsOnScreen | null {
  const { copy, route, cursorMs, nowMs } = i
  if (!copy || copy.status !== 'available') return null
  const products = route?.products?.status === 'available' ? route.products.products : null
  const r = productsAt(products, copy.alerts, cursorMs, nowMs)
  if (r.source === 'timeline') {
    return {
      alerts: r.alerts,
      zones: route?.products?.zones ?? copy.zones,
      source: 'timeline',
      future: false,
      issuedForCursor: false,
      archiveCredit: archiveCreditAtHandle(r, route),
      retrievedMs: route?.products?.retrieved_ms ?? null,
    }
  }
  // the saved copy holds every version: its newest one of each product at the time (as before brief 6)
  const w = warningsAt(copy.alerts, cursorMs, nowMs)
  return { alerts: w.alerts, zones: copy.zones, source: 'copy', future: w.future, issuedForCursor: w.issuedForCursor, archiveCredit: null, retrievedMs: copy.retrieved_ms ?? null }
}
