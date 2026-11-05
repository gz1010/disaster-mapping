// Builders of flood time-history answers for tests (brief 6, web-flood-playback): passes, NWS product versions and a
// FloodTimelineResponse shaped like GET /api/floods/{id}/timeline.
import type { FloodAlert, FloodPass, FloodTimelineProduct, FloodTimelineResponse } from '../api/types'
import { DAY_MS, HOUR_MS } from '../lib/time'

export function testPass(key: string, t: number, view: FloodPass['view'], extra: Partial<FloodPass> = {}): FloodPass {
  const usable = view === 'clear' || view === 'partly_hidden'
  return {
    key,
    product: 'DSWx-HLS',
    platform: 'Landsat 9',
    acquired_ms: t,
    route: 'earthdata_gis',
    granules: [key],
    url: null,
    view,
    usable,
    clear_pct: view === 'clear' ? 90 : view === 'partly_hidden' ? 35 : view === 'no_view' ? 0 : null,
    cloud_pct: view === 'partly_hidden' ? 49 : view === 'no_view' ? 84 : view === 'clear' ? 0 : null,
    nodata_pct: view === 'unknown' ? null : 16,
    water_km2: usable ? 3 : null,
    partial_km2: usable ? 1 : null,
    image: usable ? { url: `/api/floods/f/passes/${key}.png?area=abcd1234`, bounds_lonlat: [-82, 29, -81, 30] } : null,
    layer: null,
    caveat: null,
    ...extra,
  }
}

export const SQUARE = (d: number) => ({ type: 'Polygon', coordinates: [[[-81.5, 29.5], [-81.5 + d, 29.5], [-81.5 + d, 29.9], [-81.5, 29.9], [-81.5, 29.5]]] })

/** A builder of NWS product versions whose phase is judged at `now`. */
export const versionBuilder = (now: number) => (id: string, vtec: string, action: string, sent: number, until: number | null, extra: Partial<FloodTimelineProduct> = {}): FloodTimelineProduct => {
  const [office, phen, sig, etn] = vtec.split('.')
  return {
    id,
    url: `https://api.weather.gov/alerts/${id}`,
    office_url: null,
    event: 'Flood Warning',
    vtec: { office, phenomena: phen, significance: sig, etn: Number(etn), action, year: 2026 },
    hvtec: null,
    sender_name: 'NWS Melbourne FL',
    sent_ms: sent,
    effective_ms: sent,
    onset_ms: sent,
    expires_ms: sent + 12 * HOUR_MS,
    ends_ms: until,
    headline: null,
    nws_headline: null,
    description: null,
    instruction: null,
    area_desc: null,
    ugcs: ['FLC127'],
    message_type: null,
    status: 'Actual',
    phase: until != null && until <= now ? 'ended' : 'in_effect',
    archived: true,
    time_zone: 'America/New_York',
    emergency: false,
    damage_threat: null,
    detection: null,
    geometry: SQUARE(0.2) as FloodAlert['geometry'],
    covers_point: null,
    flood_ids: ['f'],
    vtec_key: `${vtec}.2026`,
    replaced_ms: null,
    shown_from_ms: sent,
    shown_until_ms: until,
    ...extra,
  }
}

export function testTimeline(now: number, passes: FloodPass[], products: FloodTimelineProduct[], floodId = 'f'): FloodTimelineResponse {
  return {
    kind: 'flood_timeline',
    flood_id: floodId,
    now_ms: now,
    start_ms: now - 15 * DAY_MS,
    end_ms: now,
    synthetic: false,
    passes: {
      status: 'available',
      reason_code: null,
      reason: null,
      login: 'not_configured',
      login_note: null,
      source: { name: 'NASA OPERA DSWx', url: 'https://www.jpl.nasa.gov/go/opera' },
      retrieved_ms: now,
      start_ms: now - 15 * DAY_MS,
      end_ms: now,
      complete: true,
      truncated: false,
      stats_over: 'map_area',
      passes,
      shown_key: [...passes].reverse().find((p) => p.usable)?.key ?? null,
      caveats: [],
    },
    products: {
      kind: 'flood_alerts',
      status: 'available',
      reason: null,
      source: { name: 'NWS', url: 'https://api.weather.gov' },
      retrieved_ms: now,
      now_ms: now,
      flood_id: floodId,
      synthetic: false,
      caveats: [],
      products,
      zones: { type: 'FeatureCollection', features: [] },
      archive_source: null,
      complete: true,
    } as unknown as FloodTimelineResponse['products'],
  } as unknown as FloodTimelineResponse
}

