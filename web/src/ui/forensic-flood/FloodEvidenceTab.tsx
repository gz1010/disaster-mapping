// The 3D flood view's Evidence tab (brief 5, PLAN-5 §4.7): every version of each NWS flood product saved with the
// flood's 3D data (warnings.json), in NWS's own words inside data-verbatim with the sender named next to it, its own
// times in the issuer's zone, and a link to the product; archived copies are labelled. Then the bundle's sources (their
// credit lines, as built) and the notes from preparing it. An answer that could not be read is said, never "none".
import { ExternalLink } from 'lucide-react'
import type { FloodAlert } from '../../api/types'
import { fmtAt, type TimeFmt } from '../../lib/time'
import { floodAssetStore } from '../../scene/flood/floodAssets'
import { useTimeFormat } from '../../state/timeZone'
import { useNow } from '../hooks'
import { fillCopy } from '../shell/floodCopy'
import { FLOOD_FORENSIC } from './floodForensicCopy'
import { evidenceProducts, versionAction } from './floodForensicView'

const httpsUrl = (u: string | null | undefined) => (u && /^https:\/\//i.test(u) ? u : null)

function when(ms: number | null | undefined, tf: TimeFmt, nowMs: number): string | null {
  return ms != null && Number.isFinite(ms) ? fmtAt(ms, tf, { zone: true, year: 'auto', refMs: nowMs }) : null
}

function Version({ a, tf, nowMs, open }: { a: FloodAlert; tf: TimeFmt; nowMs: number; open: boolean }) {
  const zoned: TimeFmt = { tz: a.time_zone || tf.tz, clock: tf.clock }
  const action = versionAction(a)
  const url = httpsUrl(a.url)
  const times = [
    ['Sent', when(a.sent_ms, zoned, nowMs)],
    ['Starts', when(a.onset_ms ?? a.effective_ms, zoned, nowMs)],
    ['Until', when(a.ends_ms ?? a.expires_ms, zoned, nowMs)],
  ].filter((t): t is [string, string] => t[1] != null)
  return (
    <details className="fxf-ev-version" open={open}>
      <summary>
        {action && <span className="fxf-ev-action mono">{action}</span>}
        <span className="mono">{times[0]?.[1] ?? ''}</span>
        {a.archived && <span className="fxf-ev-archived">{FLOOD_FORENSIC.evidenceArchived}</span>}
      </summary>
      <dl className="fxf-ev-times mono">
        {times.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="fxf-ev-text" data-verbatim="">
        {a.headline && <p className="fxf-ev-headline">{a.headline}</p>}
        {a.description && <p className="fxf-ev-pre">{a.description}</p>}
        {a.instruction && <p className="fxf-ev-pre fxf-ev-instr">{a.instruction}</p>}
        {a.area_desc && <p className="fxf-ev-area">{a.area_desc}</p>}
      </div>
      <div className="fxf-ev-foot">
        <span>{a.sender_name ?? 'NWS'}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer noopener">
            {FLOOD_FORENSIC.evidenceOpen} <ExternalLink size={11} aria-hidden="true" />
          </a>
        )}
      </div>
    </details>
  )
}

export function FloodEvidenceTab() {
  const tf = useTimeFormat()
  const nowMs = useNow(60_000)
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  if (!flood) return <p className="muted fxf-pad">{FLOOD_FORENSIC.loadingTerrain}</p>
  const w = flood.warnings
  const products = evidenceProducts(w)
  const m = flood.manifest
  return (
    <div className="fxf-evidence">
      <section className="fxf-ev-section">
        <h3 className="eyebrow">{FLOOD_FORENSIC.evidenceTitle}</h3>
        <p className="fxf-ev-intro">{FLOOD_FORENSIC.evidenceIntro}</p>
        {!w || w.status !== 'available' ? (
          <p className="fxf-ev-none">{w?.reason ?? FLOOD_FORENSIC.evidenceUnavailable}</p>
        ) : products.length === 0 ? (
          <p className="fxf-ev-none">{FLOOD_FORENSIC.evidenceNone}</p>
        ) : (
          products.map((p, i) => (
            <article key={p.key} className={`fxf-ev-product${p.emergency ? ' is-emergency' : ''}`}>
              <header>
                <span className="fxf-ev-event" data-verbatim="">
                  {p.event}
                </span>
                <span className="fxf-ev-sender">{p.sender}</span>
                {p.versions.length > 1 && <span className="fxf-ev-count mono">{fillCopy(FLOOD_FORENSIC.evidenceVersions, { n: p.versions.length })}</span>}
              </header>
              {p.versions.map((a, k) => (
                <Version key={a.id} a={a} tf={tf} nowMs={nowMs} open={i === 0 && k === 0} />
              ))}
            </article>
          ))
        )}
      </section>
      <section className="fxf-ev-section">
        <h3 className="eyebrow">{FLOOD_FORENSIC.evidenceSources}</h3>
        <p className="fxf-ev-intro mono">{fillCopy(FLOOD_FORENSIC.evidencePrepared, { time: fmtAt(m.built_ms, tf, { zone: true, year: 'auto', refMs: nowMs }) })}</p>
        <ul className="fxf-ev-sources">
          {m.data_sources.map((d, k) => (
            <li key={`${d.name}-${k}`}>
              <b>{d.name}</b>
              <span>{d.detail}</span>
            </li>
          ))}
        </ul>
      </section>
      {(m.warnings.length > 0 || m.aoi_note) && (
        <section className="fxf-ev-section">
          <h3 className="eyebrow">{FLOOD_FORENSIC.evidenceWarnings}</h3>
          <ul className="fxf-ev-sources">
            {m.aoi_note && <li>{m.aoi_note}</li>}
            {m.warnings.map((x, k) => (
              <li key={k}>{x}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
