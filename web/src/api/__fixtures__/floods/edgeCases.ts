// Flood edge cases for web tests (brief 5, PLAN-5 §7.3): built from the plain copies of the backend's committed fixture
// answers in this folder (backend/tests/data/floods/fixture_api, generated with --now 2026-11-04T18:00:00Z), so web
// tests check the same shapes the backend validates. Cases the backend set does not hold are derived here from those
// answers, each by the smallest change (a structuredClone, then one field). Test helpers only (never shipped: only
// *.test.ts files import this).
import type {
  FloodAlertsResponse,
  FloodDetailResponse,
  FloodListResponse,
  FloodMapResponse,
  FloodSummary,
  ModelOutputResponse,
  RiverGauge,
  RiverGaugesResponse,
  SatelliteWaterResponse,
} from '../../types'
import detail from './detail.json'
import detailFlash from './detail-fixture-flood-flash.json'
import detailPast from './detail-fixture-flood-past.json'
import detailWatch from './detail-fixture-flood-watch.json'
import alertsUnavailable from './edge/alerts-unavailable.json'
import catfimUnavailable from './edge/catfim-unavailable.json'
import detailLastKnown from './edge/detail-last-known.json'
import gaugesUnavailable from './edge/gauges-unavailable.json'
import listBothDown from './edge/list-both-down.json'
import listEmpty from './edge/list-empty.json'
import listGaugesDown from './edge/list-gauges-down.json'
import listNwsDown from './edge/list-nws-down.json'
import modelUnavailable from './edge/model-unavailable.json'
import nfhlUnavailable from './edge/nfhl-unavailable.json'
import rfcFimUnavailable from './edge/rfc_fim-unavailable.json'
import satellitePicture from './edge/satellite-picture.json'
import satelliteRefused from './edge/satellite-refused.json'
import satelliteUnavailable from './edge/satellite-unavailable.json'
import floodAlerts from './flood-alerts.json'
import floodAlertsFlash from './flood-alerts-fixture-flood-flash.json'
import list from './list.json'
import list2025 from './list-2025.json'
import list2026 from './list-2026.json'
import rfcFim from './maps-rfc_fim.json'
import modelSeries from './model-nwm_series-ZZRF1.json'
import riverGauges from './river-gauges.json'
import riverGaugesNational from './river-gauges-national.json'
import riverGaugesZZRF2 from './river-gauges-ZZRF2.json'
import riverGaugesZZRF3 from './river-gauges-ZZRF3.json'
import riverGaugesZZRF4 from './river-gauges-ZZRF4.json'
import satellite from './satellite.json'

const clone = <T>(v: unknown): T => structuredClone(v) as T

/** The "now" of the committed answers (make_fixture.py --now 2026-11-04T18:00:00Z). */
export const FIXTURE_NOW_MS = Date.UTC(2026, 10, 4, 18, 0, 0)

// ------------------------------------------------------------------------------------------------ as generated
export const LIST = (): FloodListResponse => clone(list)
export const LIST_2026 = (): FloodListResponse => clone(list2026)
export const LIST_2025 = (): FloodListResponse => clone(list2025)
export const DETAIL = (): FloodDetailResponse => clone(detail)
export const DETAIL_FLASH = (): FloodDetailResponse => clone(detailFlash)
export const DETAIL_WATCH = (): FloodDetailResponse => clone(detailWatch)
export const DETAIL_PAST = (): FloodDetailResponse => clone(detailPast)
export const ALERTS = (): FloodAlertsResponse => clone(floodAlerts)
export const ALERTS_FLASH = (): FloodAlertsResponse => clone(floodAlertsFlash)
export const GAUGES = (): RiverGaugesResponse => clone(riverGauges)
export const GAUGES_NATIONAL = (): RiverGaugesResponse => clone(riverGaugesNational)
export const RFC_FIM = (): FloodMapResponse => clone(rfcFim)
export const MODEL_SERIES = (): ModelOutputResponse => clone(modelSeries)
export const SATELLITE = (): SatelliteWaterResponse => clone(satellite)

// ------------------------------------------------------------------------------------------------ edge cases
/** No NASA token (the default answer): login not_configured, SAT_NOT_SET_UP. */
export const SATELLITE_NO_TOKEN = SATELLITE
export const SATELLITE_TOKEN_REFUSED = (): SatelliteWaterResponse => clone(satelliteRefused)
export const SATELLITE_PICTURE_ONLY = (): SatelliteWaterResponse => clone(satellitePicture)
export const SATELLITE_UNAVAILABLE = (): SatelliteWaterResponse => clone(satelliteUnavailable)

/** A gauge whose reading is not current (NWS "Data Not Current"): ZZRF4. */
export const GAUGE_NOT_CURRENT = (): RiverGauge => clone<RiverGaugesResponse>(riverGaugesZZRF4).gauges[0]
/** A gauge out of service (derived from ZZRF4). */
export const GAUGE_OUT_OF_SERVICE = (): RiverGauge => {
  const g = GAUGE_NOT_CURRENT()
  g.observed = { ...g.observed, category: 'out_of_service', value: null, flow: null }
  return g
}
/** A gauge with no flood stages set by NWS (derived from ZZRF3). */
export const GAUGE_NOT_DEFINED = (): RiverGauge => {
  const g = clone<RiverGaugesResponse>(riverGaugesZZRF3).gauges[0]
  g.thresholds = null
  g.observed = { ...g.observed, category: 'not_defined' }
  return g
}
/** A gauge that is not an NWS forecast point (ZZRF3: no forecast, no reach_id). */
export const GAUGE_NO_FORECAST = (): RiverGauge => clone<RiverGaugesResponse>(riverGaugesZZRF3).gauges[0]
/** Flow mode without an NWM reach (ZZRF3: reach_id null, C28). */
export const GAUGE_NO_REACH = GAUGE_NO_FORECAST
/** A forecast still rising at its last step (ZZRF2: crest_at_end, C7). */
export const GAUGE_RISING_AT_END = (): RiverGauge => clone<RiverGaugesResponse>(riverGaugesZZRF2).gauges[0]

/** A Flash Flood Emergency (fixture-flood-flash). */
export const FLASH_EMERGENCY = (): FloodSummary => DETAIL_FLASH().summary

/** A Puerto Rico product the list drops (rule 1): the fixture's Flash Flood Warning moved to San Juan, PR. Never in a
 *  lower-48 list. */
export const PUERTO_RICO_ALERTS = (): FloodAlertsResponse => {
  const a = ALERTS_FLASH()
  a.alerts = a.alerts.map((x) => ({ ...x, area_desc: 'San Juan, PR', ugcs: ['PRC127'], flood_ids: [] }))
  a.states_checked = ['PR']
  return a
}

/** A past flood (2025): its products read "Was in effect". */
export const PAST_FLOOD = (): FloodSummary => DETAIL_PAST().summary

/** Lists with NWS down, the gauges down, both down, and an empty list (every source answered). */
export const LIST_NWS_DOWN = (): FloodListResponse => clone(listNwsDown)
export const LIST_GAUGES_DOWN = (): FloodListResponse => clone(listGaugesDown)
export const LIST_BOTH_DOWN = (): FloodListResponse => clone(listBothDown)
export const LIST_EMPTY = (): FloodListResponse => clone(listEmpty)

/** A year list whose IEM archive could not be read (review WFO-R3): the shape the real API answers before past floods
 *  are listed (backend-flood-live M2): no floods, no past rule, the archive unavailable with its reason. */
export const YEAR_ARCHIVE_DOWN_REASON = 'Disaster Mapping does not list past floods yet. That is not an all-clear.'
export const LIST_YEAR_ARCHIVE_DOWN = (): FloodListResponse => {
  const l = LIST_2026()
  l.floods = []
  l.past_rule = null
  l.sources = l.sources.map((x) => (x.id === 'iem_archive' ? { ...x, status: 'unavailable', retrieved_ms: null, reason: YEAR_ARCHIVE_DOWN_REASON } : x))
  return l
}

/** Each official layer could not be reached (C3). */
export const ALERTS_UNAVAILABLE = (): FloodAlertsResponse => clone(alertsUnavailable)
export const GAUGES_UNAVAILABLE = (): RiverGaugesResponse => clone(gaugesUnavailable)
export const RFC_FIM_UNAVAILABLE = (): FloodMapResponse => clone(rfcFimUnavailable)
export const CATFIM_UNAVAILABLE = (): FloodMapResponse => clone(catfimUnavailable)
export const NFHL_UNAVAILABLE = (): FloodMapResponse => clone(nfhlUnavailable)
export const MODEL_UNAVAILABLE = (): ModelOutputResponse => clone(modelUnavailable)

/** Satellite with no data and an area outside the image (C2): the fixture's own image has both. */
export const SATELLITE_NODATA_AND_EDGE = SATELLITE

/** A bundle built 7 days before the fixture's now (C16: ages are computed at render time). */
export const DETAIL_BUILT_7_DAYS_AGO = (): FloodDetailResponse => {
  const d = DETAIL()
  const week = 7 * 86_400_000
  if (d.manifest) d.manifest = { ...d.manifest, built_ms: d.manifest.built_ms - week }
  d.summary = { ...d.summary, bundle_built_ms: (d.summary.bundle_built_ms ?? FIXTURE_NOW_MS) - week }
  return d
}

/** An old id answered by its canonical flood (rule 13 alias, C20). */
export const DETAIL_ALIAS = (): FloodDetailResponse => {
  const d = DETAIL()
  d.resolved_from = 'alias'
  d.summary = { ...d.summary, aliases: [...d.summary.aliases, 'flood-20261103-old-ridge-fork-000000'] }
  return d
}
export const ALIAS_ID = 'flood-20261103-old-ridge-fork-000000'

/** A flood no longer in the lists: its last-known summary (C20). */
export const DETAIL_LAST_KNOWN = (): FloodDetailResponse => clone(detailLastKnown)

/** The live list with "Show watches" off hides its watch-only flood (C27). */
export const WATCHES_IN_LIST = (): { list: FloodListResponse; watches: number } => {
  const l = LIST()
  return { list: l, watches: l.floods.filter((f) => f.level === 'watch').length }
}
