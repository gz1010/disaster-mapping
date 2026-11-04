// Brief 5 (floods) contract types: docs/redesign/CONTRACT.md section 16.2-16.6, field for field.
// Re-exported by web/src/api/types.ts. Python mirror: backend/fire3d/contracts.py ("Brief 5: floods");
// backend/tests/test_flood_contracts.py checks field names, optionality and every string-literal union.
// JSON field names are snake_case; times are epoch ms UTC; bbox is [w, s, e, n] in lon/lat.
import type { DataSource, JobStatus, LayerInfo, ManifestGrid, Mode } from './types' // type-only: types.ts re-exports this file
import type { OfficialSource, OfficialStatus } from '../official/types'

// ---------------------------------------------------------------------------------------------------------------
// 16.2 Flood list types (GET /api/floods, /api/floods/status, /api/floods/{id})
// ---------------------------------------------------------------------------------------------------------------
export type Hazard = 'fire' | 'flood'
export type FloodKind = 'river' | 'flash' | 'areal'
export type FloodLevel = 'warning' | 'advisory' | 'watch' | 'gauge_only'
export type FloodStatus = 'active' | 'inactive' // internal: never shown as a word in the UI
export type FloodCategory = 'action' | 'minor' | 'moderate' | 'major'
/** NWPS / riv_gauges category values, verbatim. */
export type GaugeCategory =
  | 'no_flooding'
  | 'action'
  | 'minor'
  | 'moderate'
  | 'major'
  | 'not_defined'
  | 'low_threshold'
  | 'obs_not_current'
  | 'out_of_service'
  | 'fcst_not_current'
  | 'unknown'
export type StartedBasis = 'nws_product' | 'gauge' | 'first_seen'
export type FloodSourceId = 'nws_alerts' | 'nwps_gauges' | 'rfc_forecasts' | 'iem_archive'
export type FloodAlertPhase = 'upcoming' | 'in_effect' | 'ended' // Python: FloodAlertPhase = AlertPhase (same values)
export type FloodBundleStatus = 'none' | 'building' | 'ready' | 'error' // Python: BundleStatus
export type FloodManifestStatus = 'building' | 'ready' | 'error' // Python: ManifestStatus

export interface GeometryJson {
  type: 'Point' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon'
  coordinates: unknown
}
export interface FeatureJson<P = Record<string, unknown>> {
  type: 'Feature'
  id?: string | number
  geometry: GeometryJson | null
  properties: P
}
export interface FeatureCollectionJson<P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: FeatureJson<P>[]
}

export interface FloodVtec {
  office: string // "KABQ"
  phenomena: string // "FL" | "FA" | "FF"
  significance: string // "W" | "Y" | "A"
  etn: number
  action: string // NEW CON EXT EXA EXB CAN EXP UPG COR ROU
  year: number // ETN restarts each year: part of the key
}

export interface FloodProductRef {
  id: string // CAP id (live) or IEM product id (archived)
  event: string // NWS event name verbatim ("Flood Warning")
  vtec_key: string | null // "KABQ.FL.W.0019.2026"
  sender_name: string | null // "NWS Albuquerque NM"
  phase: FloodAlertPhase
  sent_ms: number | null
  onset_ms: number | null
  ends_ms: number | null // ends ?? eventEndingTime ?? expires
  emergency: boolean // Flash Flood Emergency tag
  damage_threat: string | null // flashFloodDamageThreat verbatim ("CONSIDERABLE", "CATASTROPHIC")
  gauge_lids: string[] // H-VTEC NWSLI(s) linked to this product; [] when none
  url: string | null // the alert's page (api.weather.gov) or the archived product
  archived: boolean
}

export interface FloodGaugeRef {
  lid: string // NWS id ("SHRN5")
  name: string // verbatim ("San Juan River at Shiprock")
  waterbody: string | null // riv_gauges waterbody verbatim
  state: string | null
  lat: number
  lon: number
  observed_category: GaugeCategory
  observed_value: number | null // stage
  unit: string | null // "ft"
  observed_ms: number | null
  forecast_category: GaugeCategory | null // null: not a forecast point
  forecast_max_value: number | null
  forecast_max_ms: number | null
  forecast_issued_ms: number | null
  url: string // https://water.noaa.gov/gauges/<lid lower case>
}

export interface FloodSummary {
  id: string
  hazard: 'flood'
  name: string
  kind: FloodKind
  level: FloodLevel
  emergency: boolean
  status: FloodStatus
  mode: Mode
  year: number
  started_ms: number
  started_basis: StartedBasis
  updated_ms: number | null // newest product or member gauge reading
  expires_ms: number | null // latest end of the products in effect ("NWS warning until")
  last_product_ms: number | null // newest NWS product's sent time
  ended_ms: number | null // internal; never labelled "ended"
  lat: number // primary gauge, else the largest polygon's representative point
  lon: number
  bbox_lonlat: [number, number, number, number]
  state: string | null // USPS code of the point (48 states + "DC")
  states: string[]
  county: string | null
  time_zone: string // IANA (regions.time_zone_at), never NWPS's POSIX zone
  rivers: string[]
  primary_gauge: FloodGaugeRef | null
  gauges: FloodGaugeRef[] // member gauges at action or above, primary first
  gauges_in_flood: number // observed minor or worse
  max_category: FloodCategory | null // highest observed or NWS-forecast category among members
  products: FloodProductRef[] // in effect or upcoming (live; "ended" once the flood left the lists); every product (past)
  offices: string[] // "KABQ"
  bundle_status: FloodBundleStatus
  bundle_built_ms: number | null
  aliases: string[]
  synthetic: boolean // fixture-flood and the fixture server's list rows
  caveat: string | null // level gauge_only: GAUGE_ONLY_CAVEAT, GAUGE_ONLY_COASTAL_CAVEAT (a tide or lake gauge) or
  // ALERTS_UNAVAILABLE (NWS could not be read); else null. Backend-sent: show it as sent.
}

export interface FloodListSource {
  id: FloodSourceId
  name: string // "National Weather Service", "NOAA National Water Prediction Service (NWS)", ...
  status: 'available' | 'unavailable'
  retrieved_ms: number | null
  reason: string | null // FLOOD_NWS_DOWN etc.; the stale reason when stale
  stale: boolean
}

export interface FloodListResponse {
  hazard: 'flood'
  mode: Mode
  updated_ms: number
  year?: number | null // historical lists
  past_rule?: 'moderate_or_worse' | 'fallback' | null // historical: PAST_RULE or PAST_RULE_FALLBACK (PLAN-5 3.6)
  preparing?: boolean // historical: the one-time year build is still running (web: PAST_PREPARING)
  floods: FloodSummary[] // ordered by floodRank (16.8); includes level 'watch' (the web hides them by default)
  sources: FloodListSource[]
  products_in_effect: number | null // NWS flood products in effect in the lower 48 (null when NWS could not be read)
}

export interface FloodLiveStatus {
  last_refresh_ms: number | null
  next_refresh_ms: number | null
  active_floods: number | null // null: unknown (lists down), never 0 for unknown
  gauges_in_flood: number | null
  auto_build: boolean
}

export interface FloodDetailResponse {
  summary: FloodSummary // summary.id is the canonical id (may differ from the requested id after a merge)
  manifest: FloodManifest | null
  job: JobStatus | null // job.incident_id carries the flood id
  /** PLAN-5 3.2 rule 13: live list -> year lists -> registry alias -> bundle summary -> last-known summary -> 404. */
  resolved_from: 'live' | 'year' | 'alias' | 'bundle' | 'last_known'
}

// ---------------------------------------------------------------------------------------------------------------
// 16.3 The flood bundle and manifest
// ---------------------------------------------------------------------------------------------------------------
export type FloodLayerId =
  | 'terrain'
  | 'naip'
  | 'water_forecast'
  | 'floodplain'
  | 'water_satellite'
  | 'water_model'
  | 'warnings'
  | 'gauges'
export type LayerState = 'ok' | 'unavailable' | 'not_configured' | 'not_covered' | 'not_available_for_past_dates'

export interface FloodLayerStatus {
  status: LayerState
  reason: string | null // a 16.14 text
  source: string // credit line (16.15)
  time_ms: number | null // the layer's own time (image time, forecast reference time, ...)
}

export interface FloodManifest {
  schema_version: 1
  id: string
  hazard: 'flood'
  name: string
  mode: Mode
  status: FloodManifestStatus
  summary: FloodSummary // frozen at build
  time_origin_ms: number // = time_range.start_ms (kept so the fire grid helpers work)
  time_range: { start_ms: number; end_ms: number; now_ms: number }
  grid: ManifestGrid // fire = render (unused for floods)
  aoi_note: string | null // "Cut to 60 km around the primary gauge" when cut
  layers: Record<string, LayerInfo>
  layer_status: Record<FloodLayerId, FloodLayerStatus>
  files: {
    warnings: string // "warnings.json"
    gauges: string // "gauges.json"
    satellite: string | null // "satellite.json"
    satellite_image: string | null // "satellite.png"
    maps: Record<string, string> // "rfc_fim" -> "maps/rfc_fim.geojson", "catfim_ZZRF1_moderate" -> ..., "nfhl" -> ...
    model: Record<string, string> // "nwm_analysis" -> ..., "nwm_series_ZZRF1" -> ...
  }
  data_sources: DataSource[]
  warnings: string[]
  built_ms: number // also the cache-buster (?v=built_ms)
}

// ---------------------------------------------------------------------------------------------------------------
// 16.4 Official flood answers (alerts, gauges, maps)
// ---------------------------------------------------------------------------------------------------------------
export type FloodOfficialKind = 'flood_alerts' | 'river_gauges' | 'flood_map'
export type FloodReasonCode = 'past_date' | 'upstream_error' | 'not_covered' | 'not_in_lower48' | 'unknown_flood' | null

/** The fire OfficialEnvelope's fields, with flood kinds and reason codes (fire unions are not widened). */
export interface FloodEnvelope {
  kind: FloodOfficialKind
  status: OfficialStatus // 'available' | 'unavailable' | 'not_available_for_past_dates'
  reason_code: FloodReasonCode
  reason: string | null
  source: OfficialSource
  retrieved_ms: number | null
  source_updated_ms: number | null
  requested_at_ms: number | null
  now_ms: number
  flood_id: string | null
  synthetic: boolean // fixture-flood
  caveats: string[] // 16.14 texts
}

export interface FloodHvtec {
  nwsli: string // "SHRN5"; "00000" is never returned (null hvtec instead)
  severity: 'N' | '0' | '1' | '2' | '3' | 'U'
  cause: string // "ER", "SM", "RS", "DM", "IJ", ...
  begin_ms: number | null
  crest_ms: number | null
  end_ms: number | null
  record: string // "NO" | "NR" | "UU" | "OO"
}

export interface FloodAlert {
  id: string
  url: string | null
  office_url: string | null
  event: string // verbatim
  vtec: FloodVtec | null
  hvtec: FloodHvtec | null
  sender_name: string | null
  sent_ms: number | null
  effective_ms: number | null
  onset_ms: number | null
  expires_ms: number | null
  ends_ms: number | null
  headline: string | null // verbatim, line breaks kept
  nws_headline: string | null
  description: string | null
  instruction: string | null
  area_desc: string | null
  ugcs: string[]
  message_type: string | null // Alert | Update | Cancel; null for archived copies
  status: string
  phase: FloodAlertPhase
  archived: boolean
  time_zone: string | null // IANA zone of the issuing area
  emergency: boolean
  damage_threat: string | null
  detection: string | null // flashFloodDetection verbatim ("RADAR INDICATED", "OBSERVED")
  geometry: GeometryJson | null // the product polygon; null for zone-based products (see zones)
  covers_point: boolean | null // with ?bbox= of a point query: the point is inside
  flood_ids: string[] // listed floods this product belongs to
}

export interface FloodAlertsResponse extends FloodEnvelope {
  kind: 'flood_alerts'
  alerts: FloodAlert[] // Emergency first, then warnings, advisories, watches; newest first within
  zones: FeatureCollectionJson<{ ugc: string; name: string; alert_ids: string[] }>
  area_bbox: [number, number, number, number] | null
  states_checked: string[]
}

export interface GaugeThresholds {
  unit: string
  action: number | null
  minor: number | null
  moderate: number | null
  major: number | null
}
export interface GaugeReading {
  value: number | null
  unit: string | null
  flow: number | null
  flow_unit: string | null
  category: GaugeCategory
  valid_ms: number | null
}
export interface GaugeForecast {
  category: GaugeCategory | null
  max_value: number | null
  max_ms: number | null
  issued_ms: number | null
  producer: string | null // RFC code "CBRFC"
  producer_name: string | null // "Colorado Basin River Forecast Center"
  issuer: string | null // WFO "ABQ"
  url: string | null
  /** The highest forecast value is at the last forecast step (or rfc_max_forecast's max_value_timestep is the last
   *  step, or the H-VTEC crest is 000000T0000Z): not a crest; the web says FORECAST HIGH, "still forecast to rise". */
  crest_at_end: boolean
}
/** Rows [valid_ms, stage | null, flow | null]. */
export interface GaugeSeries {
  observed: [number, number | null, number | null][]
  forecast: [number, number | null, number | null][]
  forecast_issued_ms: number | null
  stage_unit: string | null
  flow_unit: string | null
}
export interface RiverGauge {
  lid: string
  usgs_id: string | null
  reach_id: string | null // NWM reach (for nwm_series)
  name: string
  waterbody: string | null
  state: string | null
  county: string | null
  time_zone: string // IANA
  lat: number
  lon: number
  url: string
  rfc: string | null
  wfo: string | null
  member: boolean // member of the flood (vs nearby)
  is_forecast_point: boolean
  thresholds: GaugeThresholds | null // null: NWS has not set flood stages
  observed: GaugeReading
  forecast: GaugeForecast | null
  series?: GaugeSeries | null // with ?series=1
  impacts?: { stage: number; statement: string }[] // verbatim (NWPS flood.impacts)
  forecast_reliability?: string | null
  hydronotes?: string[]
  data_attribution: { text: string; url: string | null }[] // "Observations courtesy of U.S. Geological Survey"
}
export interface RiverGaugesResponse extends FloodEnvelope {
  kind: 'river_gauges'
  gauges: RiverGauge[] // members first (primary first), then nearby by distance (riv_gauges envelope query;
  // never NWPS bbox). Facts and leaders use member === true only.
  area_bbox: [number, number, number, number] | null
}

export type FloodMapKind = 'rfc_fim' | 'catfim' | 'nfhl'
export interface FloodMapResponse extends FloodEnvelope {
  kind: 'flood_map'
  map: FloodMapKind
  features: FeatureCollectionJson // simplified; rfc_fim {feature_id, streamflow_cfs}; catfim {ahps_lid, magnitude, stage}; nfhl {fld_zone, zone_subty, sfha, static_bfe}
  reference_ms: number | null // rfc_fim reference_time (forecast base)
  updated_ms: number | null // service update_time
  /** rfc_fim: union area of the polygons on the flood's member gauges' reaches (layer-3 feature_id join), never a bbox
   *  crop; null when the join fails. Fire-3d's measurement, includes the river channel; shown in Command only. */
  stats: { area_km2: number } | null
  coverage_note: string // RFC_FIM_NOTE | CATFIM_NOTE | NFHL_NOTE
  outside_note: string | null // RFC_FIM_OUTSIDE (rfc_fim)
  experimental: boolean // true for rfc_fim and catfim
  category: FloodCategory | null // catfim
  min_zoom: number | null // always null: GeoJSON has no zoom limit (FEMA's 1:36,112 limit is for its export images)
  availability?: 'mapped' | 'no_digital_map' | 'unknown' | null // nfhl: layer 0; NFHL_OUTSIDE only when 'mapped'
  effective_min_ms?: number | null // nfhl: oldest FIRM panel EFF_DATE over the area (layer 3)
  effective_max_ms?: number | null // nfhl: newest
}

// ---------------------------------------------------------------------------------------------------------------
// 16.5 Satellite water and EARTHDATA_TOKEN
// ---------------------------------------------------------------------------------------------------------------
export type SatelliteLogin = 'not_configured' | 'configured' | 'refused'
export type SatelliteReasonCode =
  | 'upstream_error'
  | 'no_image'
  | 'before_archive'
  | 'not_configured'
  | 'login_refused'
  | null

export interface SatelliteGranule {
  id: string // NASA granule id / title
  product: 'DSWx-HLS' | 'DSWx-S1'
  platform: string | null // "Sentinel-2B", "Landsat 9", "Sentinel-1A"
  acquired_ms: number // the image time (shown); never the production time
  produced_ms: number | null
  cloud_pct: number | null // over the flood's area (measured), null for S1
  route: 'earthdata_gis' | 'podaac' | 'gibs'
  url: string | null // NASA page or search link
}

export interface SatelliteWaterResponse {
  kind: 'satellite_water'
  status: OfficialStatus
  reason_code: SatelliteReasonCode
  reason: string | null // SAT_UNAVAILABLE etc.
  login: SatelliteLogin // never the token
  login_note: string | null // SAT_NOT_SET_UP | SAT_LOGIN_REFUSED | null
  measured: boolean // false for the GIBS picture
  granules: SatelliteGranule[] // the image shown first
  image: { url: string; bounds_lonlat: [number, number, number, number] } | null // "/api/floods/{id}/satellite.png?granule=..."
  tiles: { url_template: string; date: string; max_zoom: number } | null // GIBS picture fallback
  stats: { area_km2: number; water_km2: number; partial_km2: number; cloud_pct: number; nodata_pct: number } | null // measured only
  source: OfficialSource
  retrieved_ms: number | null
  now_ms: number
  flood_id: string | null
  synthetic: boolean
  caveats: string[] // SAT_CAVEAT always
}

// ---------------------------------------------------------------------------------------------------------------
// 16.6 Model output (National Water Model)
// ---------------------------------------------------------------------------------------------------------------
export type ModelKind = 'nwm_analysis' | 'nwm_5day' | 'nwm_high_flow' | 'nwm_series'
export interface ModelSeries {
  name: 'analysis_assimilation' | 'short_range' | 'medium_range_blend'
  reference_ms: number // model run time
  unit: 'ft3/s'
  points: [number, number][] // [valid_ms, flow]
}
/** Deliberately not a FloodEnvelope: model output is never official information. */
export interface ModelOutputResponse {
  kind: ModelKind
  model_output: true
  label: string // MODEL_LABEL
  status: OfficialStatus
  reason: string | null
  source: OfficialSource // NOAA/NWS National Water Center, National Water Model
  retrieved_ms: number | null
  reference_ms: number | null
  updated_ms: number | null
  features: FeatureCollectionJson | null // map kinds; nwm_high_flow features carry recur_cat verbatim (an AEP in percent)
  series: ModelSeries[] | null // nwm_series
  reach_id: string | null
  lid: string | null
  now_ms: number
  flood_id: string | null
  synthetic: boolean
  caveats: string[] // MODEL_CAVEAT always
}
