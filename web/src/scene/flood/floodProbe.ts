// The 3D flood view's hover readout (brief 5, PLAN-5 §4.7, §5.4-5.5; review WFF-R1): what each flood layer says at
// the spot under the cursor, in the same words as the map's point check (location/floodCheck.ts), never an all-clear.
//   - NWS: the products drawn at the river-level chart's handle (warningsAt, C1) whose area holds the spot
//     (INSIDE_WARNING); nothing when none does (the note below speaks for the absence)
//   - SATELLITE: the class at the spot with the pass's date: water, "saw no water … dry pixels do not mean no
//     flooding", clouds (SAT_CLOUD_POINT), no data (SAT_NODATA_POINT), outside the image (SAT_OUTSIDE_POINT, C2), snow,
//     ocean; without a measured image the layer's own reason
//   - NWS FCST: inside / outside NWS's forecast flooded area ("unknown, not absent", RFC_FIM_OUTSIDE's meaning)
//   - FEMA (while on): its zone; "Not in FEMA's mapped 1% floodplain …" (NFHL_OUTSIDE) only when FEMA's map covers the
//     whole area (layer_status.floodplain.reason null, C19), NFHL_NO_MAP, else "may not cover this spot"
//   - NWS CAT MAP and MODEL (while on): a line only when the spot is inside (MODEL_AT_POINT); never "not flooded"
//   - note: NOTHING_COVERS when no NWS product, forecast area or satellite water covers the spot (whatever is switched
//     on); NOTHING_COVERS_OFFICIAL when FEMA, the category map or the model says "inside"; the products' outage text
//     when the bundle's NWS copy could not be read
//   - brief 6 (web-forensic-flood-3d): DEPTH (while the depth surface shows) the estimate at the spot inside its mapped
//     water only (nothing outside it: no "0 m"); ABOVE RIVER (while the height above the river is on) the ground's
//     height above the nearest channel, "Not a flood map"
// Pure and tested (floodProbe.test.ts); rendered by scene/overlays/SceneOverlays.tsx.
import type { FloodAlert, FloodAlertsResponse, SatelliteWaterResponse } from '../../api/types'
import { pointInRings, type Ring } from '../../location/geometry'
import { fmtAt, fmtDayDate, type TimeFmt } from '../../lib/time'
import { shownGranule } from '../../official/floodModel'
import {
  ALERTS_UNAVAILABLE,
  fillCopy,
  FLOOD_PUBLIC,
  GAUGE_CATEGORY_DISPLAY,
  INSIDE_WARNING,
  INSIDE_WARNING_UPCOMING,
  MODEL_AT_POINT,
  NFHL_NO_MAP,
  NFHL_OUTSIDE,
  NOTHING_COVERS,
  NOTHING_COVERS_OFFICIAL,
  SAT_CLOUD_POINT,
  SAT_NODATA_POINT,
  SAT_OUTSIDE_POINT,
} from '../../ui/shell/floodCopy'
import { FLOOD_FORENSIC } from '../../ui/forensic-flood/floodForensicCopy'
import { shownOpacity, type FloodForensicLayer, type FloodLayerSetting } from '../../ui/forensic-flood/forensicFloodState'
import { isUpcoming, productEnd, productStart } from '../../ui/timeline/hydrographModel'
import type { FloodSceneAssets } from './floodAssets'
import { FLOOD_3D } from './flood3dCopy'
import { warningsAt } from './floodGeo'
import { cellMetres, fmtMetres } from './terrain3d'

export type ProbeTone = 'alert' | 'water' | 'quiet' | 'warn' | 'model'

export interface ProbeRow {
  key: string
  label: string
  text: string
  tone?: ProbeTone
}

export interface FloodProbe {
  rows: ProbeRow[]
  /** NOTHING_COVERS / NOTHING_COVERS_OFFICIAL, or the NWS copy's outage text; null when a layer covers the spot. */
  note: string | null
}

export type ProbeFlood = Pick<FloodSceneAssets, 'arrays' | 'has' | 'manifest' | 'satellite' | 'warnings' | 'catfim'>

/** A raster cell at a local point (row 0 = north), or null outside the grid. */
export function cellAt(a: Uint8Array | null, w: number, h: number, x: number, z: number, extent: number): number | null {
  if (!a) return null
  const c = Math.floor((x / extent + 0.5) * w)
  const r = Math.floor((z / extent + 0.5) * h)
  return c >= 0 && c < w && r >= 0 && r < h ? a[r * w + c] : null
}

const inBounds = (b: readonly number[] | null | undefined, lon: number, lat: number) => !!b && b.length === 4 && lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]

function polygonsOf(g: { type: string; coordinates: unknown } | null | undefined): Ring[][] {
  if (!g) return []
  if (g.type === 'Polygon') return [g.coordinates as Ring[]]
  if (g.type === 'MultiPolygon') return g.coordinates as Ring[][]
  return []
}

/** A product's areas (lon/lat): its polygon, else its zones' outlines. */
function productAreas(a: FloodAlert, zones: FloodAlertsResponse['zones'] | null | undefined): Ring[][] {
  const own = polygonsOf(a.geometry)
  if (own.length) return own
  return (zones?.features ?? []).filter((f) => f.properties.alert_ids.includes(a.id)).flatMap((f) => polygonsOf(f.geometry))
}

/** A category flood map's category for a label: "moderate" → "Moderate flooding (NWS)" (§5.3: never a raw category on
 *  screen; review WFF-R11). */
export function catfimCategoryLabel(category: string): string {
  if (category === 'record') return 'Record flooding (NWS)'
  return (GAUGE_CATEGORY_DISPLAY as Record<string, { short: string }>)[category]?.short ?? GAUGE_CATEGORY_DISPLAY.unknown.short
}

const CATEGORY_WORD: Record<string, string> = { action: 'action-stage', minor: 'minor', moderate: 'moderate', major: 'major', record: 'record' }

/** The category as a word inside a sentence ("What NWS maps for {category} flooding"; CATFIM_NOTE). */
export function catfimCategoryWord(category: string): string {
  return CATEGORY_WORD[category] ?? 'this category of'
}

export function floodProbeRows(i: {
  flood: ProbeFlood
  layers: Record<FloodForensicLayer, FloodLayerSetting>
  extent: number
  point: { x: number; z: number; lon: number; lat: number }
  cursorMs: number | null
  nowMs: number
  tf: TimeFmt
  /** Brief 6: the depth raster on screen (null: no depth surface is drawn). */
  depth?: Uint8Array | null
  /** Brief 6 (playback): the satellite pass on screen at the chart's handle (scene/flood/flood3dHooks.ts
   *  useSatelliteOnScreen); absent: the 3D data's own satellite layer. */
  satOnScreen?: { sat: SatelliteWaterResponse | null; has: boolean; arr: Uint8Array | null; imageOnly: boolean; note: string | null } | null
  /** Brief 6 (playback): the NWS products drawn at the handle (flood3dHooks useProductsOnScreen: the time history's
   *  versions before now); absent: warningsAt on the bundle's copy. */
  products?: { alerts: FloodAlert[]; zones: FloodAlertsResponse['zones'] } | null
}): FloodProbe {
  const { flood: fl, layers: L, extent, point: p, tf, nowMs } = i
  const on = (k: FloodForensicLayer) => shownOpacity(L[k]) > 0
  const { width: w, height: h } = fl.arrays
  const at = (a: Uint8Array | null) => cellAt(a, w, h, p.x, p.z, extent)
  const st = fl.manifest.layer_status
  const rows: ProbeRow[] = []
  let covered = false
  let otherInside = false

  // NWS products drawn at the handle (C1), their own end time in the issuer's zone
  const resp = fl.warnings
  const known = resp?.status === 'available'
  if (resp && known) {
    const drawn = i.products ? i.products.alerts : warningsAt(resp.alerts, i.cursorMs, nowMs).alerts
    const zones = i.products ? i.products.zones : resp.zones
    for (const a of drawn) {
      if (!productAreas(a, zones).some((poly) => pointInRings(p.lon, p.lat, poly))) continue
      covered = true
      if (!on('warnings')) continue
      const zoned: TimeFmt = { tz: a.time_zone || tf.tz, clock: tf.clock }
      const t = (ms: number) => (Number.isFinite(ms) ? fmtAt(ms, zoned, { zone: true }) : '—')
      const text = isUpcoming(a, nowMs) ? fillCopy(INSIDE_WARNING_UPCOMING, { event: a.event, start: t(productStart(a)), time: t(productEnd(a)) }) : fillCopy(INSIDE_WARNING, { event: a.event, time: t(productEnd(a)) })
      rows.push({ key: `nws-${a.id}`, label: FLOOD_FORENSIC.probeNws, text, tone: 'alert' })
    }
  } else if (on('warnings')) rows.push({ key: 'nws', label: FLOOD_FORENSIC.probeNws, text: resp?.reason ?? ALERTS_UNAVAILABLE, tone: 'warn' })

  // water seen by satellite: the pass's own sentences (C2), never "dry" for a spot it did not see
  const so = i.satOnScreen ?? null
  const sat = so ? so.sat : fl.satellite
  const satHas = so ? so.has && so.arr != null : fl.has.satellite
  const g = shownGranule(sat)
  const satCls = satHas ? at(so ? so.arr : fl.arrays.satellite) : null
  const satInside = satHas && !!sat?.image && inBounds(sat.image.bounds_lonlat, p.lon, p.lat)
  if (satInside && (satCls === 1 || satCls === 2)) covered = true
  if (on('satellite')) {
    if (so?.imageOnly && g) rows.push({ key: 'sat', label: FLOOD_FORENSIC.probeWater, text: fillCopy(FLOOD_3D.probeSatImageOnly, { date: fmtDayDate(g.acquired_ms, tf.tz, { year: 'auto', refMs: nowMs }) }), tone: 'quiet' })
    else if (!satHas || !g) rows.push({ key: 'sat', label: FLOOD_FORENSIC.probeWater, text: (so ? (so.note ?? sat?.reason) : null) ?? st.water_satellite?.reason ?? FLOOD_FORENSIC.keySatNone, tone: 'quiet' })
    else {
      const date = fmtDayDate(g.acquired_ms, tf.tz, { year: 'auto', refMs: nowMs })
      let text: string
      let tone: ProbeTone = 'quiet'
      if (!satInside || satCls == null) text = fillCopy(SAT_OUTSIDE_POINT, { date })
      else if (satCls === 1 || satCls === 2) {
        text = fillCopy(FLOOD_PUBLIC.satWaterPoint, { date })
        tone = 'water'
      } else if (satCls === 0) text = fillCopy(FLOOD_PUBLIC.satNotWaterPoint, { date })
      else if (satCls === 253) text = fillCopy(SAT_CLOUD_POINT, { date })
      else if (satCls === 255) text = fillCopy(SAT_NODATA_POINT, { date })
      else if (satCls === 252) text = fillCopy(FLOOD_PUBLIC.satSnowPoint, { date })
      else if (satCls === 254) text = fillCopy(FLOOD_PUBLIC.satOceanPoint, { date })
      else text = fillCopy(FLOOD_PUBLIC.satNoViewPoint, { date })
      rows.push({ key: 'sat', label: FLOOD_FORENSIC.probeWater, text, tone })
    }
  }

  // NWS forecast flooded area (experimental; a forecast, not today's water)
  const fimOk = st.water_forecast?.status === 'ok'
  const inFim = fimOk && (at(fl.arrays.forecast) ?? 0) > 127
  if (inFim) covered = true
  if (on('forecastArea')) {
    if (!fimOk) rows.push({ key: 'fim', label: FLOOD_FORENSIC.probeForecast, text: st.water_forecast?.reason ?? FLOOD_FORENSIC.layerUnavailable, tone: 'warn' })
    else rows.push({ key: 'fim', label: FLOOD_FORENSIC.probeForecast, text: inFim ? FLOOD_FORENSIC.probeInForecast : FLOOD_FORENSIC.probeOutForecast, tone: inFim ? undefined : 'quiet' })
  }

  // FEMA floodplain (background): "outside" only where FEMA's digital map covers the whole area (C19)
  const plain = st.floodplain
  const zone = plain?.status === 'ok' ? (at(fl.arrays.floodplain) ?? 0) : 0
  if (zone > 0) otherInside = true
  if (on('floodplain')) {
    if (plain?.status !== 'ok') rows.push({ key: 'fema', label: FLOOD_FORENSIC.probePlain, text: plain?.reason ?? FLOOD_FORENSIC.layerUnavailable, tone: 'warn' })
    else if (zone > 0) rows.push({ key: 'fema', label: FLOOD_FORENSIC.probePlain, text: zone === 3 ? FLOOD_FORENSIC.probeFloodway : zone === 2 ? FLOOD_FORENSIC.probeInPlain : FLOOD_FORENSIC.probeBand })
    else rows.push({ key: 'fema', label: FLOOD_FORENSIC.probePlain, text: plain.reason == null ? NFHL_OUTSIDE : plain.reason === NFHL_NO_MAP ? NFHL_NO_MAP : FLOOD_FORENSIC.probeOutPlainUnknown, tone: 'quiet' })
  }

  // NWS category flood map (experimental map library) and the model: a line only inside, never "not flooded"
  const inCat = fl.has.catfim && !!fl.catfim && (at(fl.arrays.catfim) ?? 0) > 127
  if (inCat) otherInside = true
  if (inCat && fl.catfim && on('catfim')) rows.push({ key: 'catfim', label: FLOOD_FORENSIC.probeCatfim, text: fillCopy(FLOOD_FORENSIC.probeInCatfim, { category: catfimCategoryWord(fl.catfim.category), lid: fl.catfim.lid }) })
  const modelOk = st.water_model?.status === 'ok'
  const inModel = modelOk && fl.has.model && (at(fl.arrays.model) ?? 0) > 127
  if (inModel) otherInside = true
  if (on('model')) {
    if (!modelOk) rows.push({ key: 'model', label: FLOOD_FORENSIC.probeModel, text: st.water_model?.reason ?? FLOOD_FORENSIC.layerUnavailable, tone: 'warn' })
    else if (inModel) {
      const t = st.water_model?.time_ms
      rows.push({ key: 'model', label: FLOOD_FORENSIC.probeModel, text: fillCopy(MODEL_AT_POINT, { time: t != null ? fmtAt(t, tf, { zone: true, year: 'auto', refMs: nowMs }) : '—' }), tone: 'model' })
    }
  }

  // brief 6: the estimated depth at the spot (inside the mapped water only) and the height above the river
  if (on('depth') && i.depth) {
    const v = cellMetres(at(i.depth) ?? Number.NaN)
    if (v) rows.push({ key: 'depth', label: FLOOD_3D.probeDepth, text: v.top ? FLOOD_3D.probeDepthTop : fillCopy(FLOOD_3D.probeDepthAt, { m: fmtMetres(v.m) }), tone: 'water' })
  }
  if (on('hand') && fl.has.hand && fl.arrays.hand) {
    const raw = at(fl.arrays.hand)
    if (raw != null) {
      const v = cellMetres(raw)
      rows.push({ key: 'hand', label: FLOOD_3D.probeHand, text: !v ? FLOOD_3D.probeHandFar : v.top ? FLOOD_3D.probeHandTop : fillCopy(FLOOD_3D.probeHandAt, { m: fmtMetres(v.m) }), tone: 'quiet' })
    }
  }

  let note: string | null = null
  if (!known) note = resp?.reason ?? ALERTS_UNAVAILABLE
  else if (!covered) note = otherInside ? NOTHING_COVERS_OFFICIAL : NOTHING_COVERS
  return { rows, note }
}
