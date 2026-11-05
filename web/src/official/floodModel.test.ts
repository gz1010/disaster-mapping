// The official flood answers as rows and states (brief 5, PLAN-5 §3.8, D23, D24, C1, C5; CONTRACT §16.4).
import { describe, expect, it } from 'vitest'
import { ALERTS, ALERTS_FLASH, ALERTS_UNAVAILABLE, DETAIL, FIXTURE_NOW_MS, GAUGES, GAUGES_UNAVAILABLE, MODEL_SERIES, RFC_FIM, RFC_FIM_UNAVAILABLE } from '../api/__fixtures__/floods/edgeCases'
import evacNm from '../api/__fixtures__/floods/evacuations.json'
import type { FloodAlert } from '../api/types'
import type { EvacuationsResponse, EvacZoneFeature } from '../extras/types'
import { timeFmt } from '../lib/time'
import { EVAC_NONE_LISTED, floodWordingProblems, OR_EVAC_FIRE_ONLY } from '../ui/shell/floodCopy'
import {
  answerState,
  evacOwnWordsMentionFire,
  fimMapped,
  floodAlertRows,
  floodEvacuation,
  isModelOutput,
  leadAlert,
  memberGaugesOf,
  officialAlerts,
  orderAlerts,
  primaryMemberGauge,
  productsAt,
  productsDrawn,
} from './floodModel'

const tf = timeFmt('America/Denver', '12h')
const H = 3_600_000

describe('answer states (D24: absence needs an available answer)', () => {
  it('reads the envelope: available, unavailable, past; loading without data; a failed request is unavailable', () => {
    expect(answerState({ data: ALERTS(), loading: false, error: null })).toBe('available')
    expect(answerState({ data: ALERTS_UNAVAILABLE(), loading: false, error: null })).toBe('unavailable')
    expect(answerState({ data: { ...ALERTS(), status: 'not_available_for_past_dates' }, loading: false, error: null })).toBe('past')
    expect(answerState({ data: null, loading: true, error: null })).toBe('loading')
    expect(answerState({ data: null, loading: false, error: 'API 500' })).toBe('unavailable')
    expect(answerState({ data: null, loading: false, error: null })).toBe('none')
    expect(answerState(null)).toBe('none')
  })
  it('an unavailable RFC FIM answer is never "mapped"', () => {
    expect(fimMapped(RFC_FIM())).toBe(true)
    expect(fimMapped(RFC_FIM_UNAVAILABLE())).toBe(false)
  })
})

describe('NWS products verbatim (CONTRACT §16.4)', () => {
  it('rows keep the event, headline, description and instruction verbatim, with sender and own times in the issuer zone', () => {
    const rows = floodAlertRows(ALERTS(), { zone: 'America/Denver', clock: '12h', nowMs: FIXTURE_NOW_MS })
    expect(rows.map((r) => r.event)).toEqual(['Flood Warning', 'Flood Advisory', 'Flood Watch'])
    const a = ALERTS().alerts[0]
    expect(rows[0].headline).toBe(a.headline)
    expect(rows[0].description).toBe(a.description)
    expect(rows[0].instruction).toBe(a.instruction)
    expect(rows[0].sender).toBe('NWS Example Office (synthetic)')
    expect(rows[0].until).toMatch(/^until Nov \d{1,2}, \d{1,2}:\d{2} [AP]M M[SD]T$/)
    expect(rows[0].sent).toMatch(/^sent Nov \d{1,2}, \d{1,2}:\d{2} [AP]M M[SD]T$/)
    expect(rows[0].timeZone).toBe('America/Denver')
  })
  it('a Flash Flood Emergency comes first and open', () => {
    const resp = ALERTS_FLASH()
    const plain: FloodAlert = { ...resp.alerts[0], id: 'later-warning', emergency: false, sent_ms: (resp.alerts[0].sent_ms ?? 0) + H }
    resp.alerts = [plain, ...resp.alerts]
    const rows = floodAlertRows(resp, { zone: 'America/Denver', clock: '12h', nowMs: FIXTURE_NOW_MS })
    expect(rows[0].emergency).toBe(true)
    expect(rows[0].open).toBe(true)
    expect(rows[1].open).toBe(false)
    expect(orderAlerts([{ event: 'Flood Watch', emergency: false, sent_ms: 3 }, { event: 'Flood Warning', emergency: false, sent_ms: 1 }]).map((a) => a.event)).toEqual(['Flood Warning', 'Flood Watch'])
  })
  it('a model answer can never produce an official row (nor alerts or gauges)', () => {
    const model = MODEL_SERIES()
    expect(isModelOutput(model)).toBe(true)
    expect(floodAlertRows(model, { zone: 'UTC', clock: '24h', nowMs: 0 })).toEqual([])
    expect(officialAlerts(model)).toEqual([])
    expect(memberGaugesOf(model)).toEqual([])
    // even a model answer dressed with the official kind
    expect(floodAlertRows({ ...model, kind: 'flood_alerts', alerts: ALERTS().alerts }, { zone: 'UTC', clock: '24h', nowMs: 0 })).toEqual([])
    expect(isModelOutput(ALERTS())).toBe(false)
  })
  it('an unavailable answer has no rows', () => {
    expect(floodAlertRows(ALERTS_UNAVAILABLE(), { zone: 'UTC', clock: '24h', nowMs: 0 })).toEqual([])
  })
})

describe('productsAt (C1): both sides of now', () => {
  const now = FIXTURE_NOW_MS
  const mk = (id: string, start: number, end: number, phase: FloodAlert['phase'] = 'in_effect') => ({ id, onset_ms: start, effective_ms: start, sent_ms: start, ends_ms: end, expires_ms: end, phase })
  const alerts = [mk('a', now - 10 * H, now + 8 * H), mk('b', now - 30 * H, now - 20 * H, 'ended'), mk('c', now + 2 * H, now + 12 * H, 'upcoming'), mk('d', now - 5 * H, now + 5 * H, 'ended')]
  it('now (null or now): in effect now, a cancelled product excluded', () => {
    expect(productsAt(alerts, null, now)).toEqual({ alerts: [alerts[0]], future: false })
    expect(productsAt(alerts, now, now).alerts.map((a) => a.id)).toEqual(['a'])
  })
  it('a past handle: in effect then, from their own times', () => {
    expect(productsAt(alerts, now - 25 * H, now).alerts.map((a) => a.id)).toEqual(['b'])
    expect(productsAt(alerts, now - 3 * H, now).alerts.map((a) => a.id)).toEqual(['a', 'd'])
  })
  it('after now: the products in effect NOW, future true (never the upcoming one, never dropped at its end)', () => {
    const r = productsAt(alerts, now + 30 * H, now)
    expect(r.future).toBe(true)
    expect(r.alerts.map((a) => a.id)).toEqual(['a'])
  })
  it('the fixture warning ends 8 h after the fixture time and is kept for a cursor 30 h later', () => {
    const r = productsAt(ALERTS().alerts, FIXTURE_NOW_MS + 30 * H, FIXTURE_NOW_MS)
    expect(r.future).toBe(true)
    expect(r.alerts.some((a) => a.event === 'Flood Warning')).toBe(true)
  })
  it('leadAlert: the highest product in effect now', () => {
    expect(leadAlert(ALERTS(), FIXTURE_NOW_MS)?.event).toBe('Flood Warning')
    expect(leadAlert(ALERTS_UNAVAILABLE(), FIXTURE_NOW_MS)).toBeNull()
  })
})

describe('member gauges only (C4)', () => {
  it('nearby gauges (member false) are never used', () => {
    const g = GAUGES()
    const members = memberGaugesOf(g)
    expect(members.length).toBeGreaterThan(0)
    expect(members.every((x) => x.member)).toBe(true)
    expect(primaryMemberGauge(g, DETAIL().summary)?.lid).toBe('ZZRF1')
    const onlyNearby = { ...g, gauges: g.gauges.map((x) => ({ ...x, member: false })) }
    expect(primaryMemberGauge(onlyNearby, DETAIL().summary)).toBeNull()
    expect(memberGaugesOf(GAUGES_UNAVAILABLE())).toEqual([])
  })
})

// ------------------------------------------------------------------------------------------------ evacuations
const zone = (over: Partial<EvacZoneFeature['properties']> = {}): EvacZoneFeature => ({
  type: 'Feature',
  id: over.zone_id ?? 'z1',
  geometry: { type: 'Polygon', coordinates: [[[-120, 38], [-119.9, 38], [-119.9, 38.1], [-120, 38]]] },
  properties: {
    zone_id: 'z1',
    zone_name: 'Zone 1',
    status: 'Evacuation Order',
    status_key: 'order',
    county: 'Example',
    jurisdiction: 'Example County',
    city_code: null,
    event_type: 'Flood',
    notes: null,
    critical_info: null,
    public_info: null,
    status_updated_ms: FIXTURE_NOW_MS - H,
    aggregated_ms: null,
    state: 'CA',
    source_id: 'caloes_evacuations',
    status_verbatim: true,
    status_raw: 'Evacuation Order',
    status_label: null,
    status_label_source: null,
    incident_name: null,
    hazard_type: null,
    listed_ms: null,
    time_basis: 'issuer',
    ...over,
  },
})

function evac(over: Partial<EvacuationsResponse>): EvacuationsResponse {
  const base = evacNm as unknown as EvacuationsResponse
  return {
    ...base,
    status: 'available',
    reason: null,
    reason_code: null,
    retrieved_ms: FIXTURE_NOW_MS - 2 * 60_000,
    sources: [
      {
        id: 'caloes_evacuations',
        name: 'Cal OES',
        publisher: 'Cal OES',
        url: 'https://gis.data.ca.gov/',
        license: '',
        terms_url: '',
        attribution: 'Cal OES',
        disclaimer: null,
        cadence: '',
        retrieved_ms: FIXTURE_NOW_MS - 2 * 60_000,
        updated_ms: null,
        status: 'available',
        reason: null,
        home_state: 'CA',
        credit: 'Cal OES',
        aggregator: 'Cal OES',
      },
    ],
    zones: { type: 'FeatureCollection', features: [] },
    ...over,
  }
}

describe('evacuations in flood wording (D23, C5)', () => {
  it('none listed: "None listed" with the source and its check time, not an all-clear', () => {
    const f = floodEvacuation({ data: evac({}), loading: false, error: null }, tf, FIXTURE_NOW_MS)
    expect(f.state).toBe('none-listed')
    expect(f.value).toBe(EVAC_NONE_LISTED)
    expect(f.sub).toBe('None listed in Cal OES for this area · checked 2 min ago · not an all-clear: follow local officials.')
  })
  it('listed: the issuer status verbatim, Cal OES event type verbatim, never "fire" in Fire-3d words', () => {
    const f = floodEvacuation({ data: evac({ zones: { type: 'FeatureCollection', features: [zone(), zone({ zone_id: 'z2', status: 'Evacuation Warning', status_key: 'warning' })] } }), loading: false, error: null }, tf, FIXTURE_NOW_MS)
    expect(f.state).toBe('listed')
    expect(f.value).toBe('Evacuation Order')
    expect(f.verbatim).toBe(true)
    expect(f.subVerbatim).toBe('Cal OES event type: Flood')
    expect(f.sub).toMatch(/^1 zone · Example County · updated .+ · \+1 other zone · via Cal OES$/)
    expect(evacOwnWordsMentionFire(f)).toBe(false)
  })
  it('a fire zone listed in the flood area keeps its own event type verbatim; Fire-3d does not call it a flood zone', () => {
    const f = floodEvacuation({ data: evac({ zones: { type: 'FeatureCollection', features: [zone({ event_type: 'Fire' })] } }), loading: false, error: null }, tf, FIXTURE_NOW_MS)
    expect(f.subVerbatim).toBe('Cal OES event type: Fire')
    expect(evacOwnWordsMentionFire(f)).toBe(false)
  })
  it("Oregon's wildfire-only feed answers OR_EVAC_FIRE_ONLY", () => {
    const d = evac({ sources: [{ ...evac({}).sources[0], id: 'or_oem_evacuations', aggregator: 'Oregon OEM', status: 'unavailable', reason: OR_EVAC_FIRE_ONLY, home_state: 'OR' }] })
    const f = floodEvacuation({ data: { ...d, status: 'unavailable', reason_code: 'state_not_available', reason: OR_EVAC_FIRE_ONLY }, loading: false, error: null }, tf, FIXTURE_NOW_MS)
    expect(f.sub).toContain(OR_EVAC_FIRE_ONLY)
  })
  it('a state without a feed, an outage, loading', () => {
    const nm = floodEvacuation({ data: evacNm as unknown as EvacuationsResponse, loading: false, error: null }, tf, FIXTURE_NOW_MS)
    expect(nm.state).toBe('not-available')
    expect(nm.value).toBe('Not available in this state')
    expect(nm.sub).toBe('New Mexico · follow local officials')
    expect(floodEvacuation({ data: null, loading: false, error: 'API 503' }, tf, FIXTURE_NOW_MS).value).toBe('Unavailable right now')
    expect(floodEvacuation({ data: null, loading: true, error: null }, tf, FIXTURE_NOW_MS).value).toBe('Checking…')
  })
  it('no evacuation fact uses a banned word or names a fire in its own words', () => {
    for (const data of [evac({}), evacNm as unknown as EvacuationsResponse]) {
      const f = floodEvacuation({ data, loading: false, error: null }, tf, FIXTURE_NOW_MS)
      expect(floodWordingProblems(`${f.value} ${f.sub ?? ''}`)).toEqual([])
      expect(evacOwnWordsMentionFire(f)).toBe(false)
    }
  })
})

describe('productsDrawn: upcoming products are drawn at now, never after now (C1)', () => {
  const now = FIXTURE_NOW_MS
  const mk = (id: string, start: number, end: number, phase: FloodAlert['phase']) => ({ id, onset_ms: start, effective_ms: start, sent_ms: start - H, ends_ms: end, expires_ms: end, phase })
  const watch = mk('w', now + 2 * H, now + 30 * H, 'upcoming')
  const warn = mk('a', now - 2 * H, now + 8 * H, 'in_effect')
  it('now: in effect and upcoming', () => {
    expect(productsDrawn([warn, watch], null, now).alerts.map((a) => a.id)).toEqual(['a', 'w'])
  })
  it('a cursor after now: the products in effect now only', () => {
    expect(productsDrawn([warn, watch], now + 10 * H, now)).toEqual({ alerts: [warn], future: true })
  })
})
