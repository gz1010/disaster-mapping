// Evacuation rows of a flood (brief 5, PLAN-5 §4.4, §4.5, D23, C5): the official evacuation answer for the flood's area
// (`/api/extras/evacuations?bbox=&hazard=flood`, useExtrasRuntime().evac; its incident_id is null, so never filtered by
// a fire id) in flood wording (official/floodModel.ts floodEvacuation): the issuer's own status verbatim (inside
// data-verbatim) with its count, jurisdiction, own update time and the source; "None listed" with its source and check
// time, never an all-clear; Oregon's wildfire-only feed says so (OR_EVAC_FIRE_ONLY); Cal OES zones keep their own event
// type verbatim. Never the fire rows' "near this fire" words. Used by Command's "Official now" (FloodOfficialNow) and
// shaped like the fire feed's rows (ui/feed/OfficialNow.tsx Row).
import { useExtrasRuntime } from '../../extras/runtime'
import { floodEvacuation } from '../../official/floodModel'
import { openFloodSummary, useFlood } from '../../state/flood'
import { useTimeFormatFor } from '../../state/timeZone'
import { useNow } from '../hooks'
import '../../styles/view-flood-public.css'
import { FLOOD_PUBLIC, NOT_ALL_CLEAR } from '../shell/floodCopy'

/** Does the row already say it is not an all-clear (its value or sub-line)? */
function saysNotAllClear(e: { value?: string | null; sub?: string | null; subVerbatim?: string | null }): boolean {
  return [e.value, e.sub, e.subVerbatim].some((t) => /not an all-clear/i.test(t ?? ''))
}

export function FloodEvacRows({ variant = 'command' }: { variant?: 'command' | 'compact' }) {
  const summary = useFlood((s) => openFloodSummary(s))
  const evac = useExtrasRuntime((s) => s.evac)
  const tf = useTimeFormatFor(summary?.time_zone)
  const nowMs = useNow(30_000)
  const e = floodEvacuation({ data: evac.data, loading: evac.loading, error: evac.error }, tf, nowMs)
  const zones = evac.data?.status === 'available' ? evac.data.zones.features : []
  return (
    <section className={`ffe ffe-${variant}`} aria-label={FLOOD_PUBLIC.labelEvacuations}>
      <div className={`ffe-row${e.tone === 'alert' ? ' is-alert' : ''}`} data-state={e.state}>
        <p className="ffe-head">
          <span className="ffe-label">{FLOOD_PUBLIC.labelEvacuations}</span>
          <span className="ffe-value">{e.verbatim ? <span data-verbatim="">{e.value}</span> : e.value}</span>
        </p>
        {(e.subVerbatim || e.sub || e.link) && (
          <p className="ffe-sub">
            {e.subVerbatim && <span data-verbatim="">{e.subVerbatim}</span>}
            {e.subVerbatim && (e.sub || e.link) ? ' · ' : null}
            {e.sub}
            {e.link && (
              <>
                {e.sub ? ' · ' : null}
                <a href={e.link.url} target="_blank" rel="noreferrer noopener">
                  {e.link.label}
                </a>
              </>
            )}
          </p>
        )}
        {variant === 'command' && zones.length > 1 && (
          <ul className="ffe-zones">
            {zones.slice(0, 8).map((z) => (
              <li key={String(z.id ?? z.properties.zone_id)}>
                <span data-verbatim="">{z.properties.status ?? ''}</span>
                {z.properties.zone_name ? (
                  <>
                    {' · '}
                    <span data-verbatim="">{z.properties.zone_name}</span>
                  </>
                ) : null}
                {z.properties.jurisdiction ? ` · ${z.properties.jurisdiction}` : ''}
              </li>
            ))}
          </ul>
        )}
        {/* the caveat once: not repeated when the row's own words already say it (review WFC-R15) */}
        {e.state !== 'listed' && !saysNotAllClear(e) && <p className="ffe-note">{NOT_ALL_CLEAR}</p>}
      </div>
    </section>
  )
}
