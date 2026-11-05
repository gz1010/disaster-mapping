// The 3D flood view's top bar (brief 5, PLAN-5 §4.7): the fire Forensic bar's layout (ui/Header.tsx, frozen) with the
// flood's words. Left: "Back to all floods" (back to the map's flood overview), the logo, "● LIVE Ridge Fork River
// flood" (or the year, and DEMO for a synthetic flood), the place and the date line in grey. Centre: the Public ·
// Command · Forensic pill. Right: copy a link, hide panels (H). With panels hidden only a mini bar remains (logo, name,
// LIVE / year, the view pill, "Panels H").
import { Maximize2, Minimize2, Share2 } from 'lucide-react'
import { fmtLatLon } from '../../lib/format'
import { openFloodSummary, goToFloodOverview, useFlood } from '../../state/flood'
import { useStore } from '../../state/store'
import { useTimeFormat } from '../../state/timeZone'
import { Logo } from '../Logo'
import { floodDateLine, floodPlace } from '../public/floodView'
import { floodDisplayName } from '../public/floodOverviewText'
import { switchWorkspace } from '../shell/handoff'
import { BackButton, IconPill, LiveDot, TopBar, TopBarBrand, ViewPill } from '../shell/TopBar'
import { DEMO_TAG } from '../shell/floodCopy'
import { toast } from '../toast'
import { FLOOD_FORENSIC } from './floodForensicCopy'

/** Forensic's "back": the map takes the camera's place first, then the flood overview (history-aware). */
function backToAllFloods(): void {
  switchWorkspace('map')
  goToFloodOverview()
}

async function copyLink(): Promise<void> {
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    toast('Link copied: this flood in 3D', 'ok')
  } catch {
    window.prompt('Copy this link', url)
  }
}

function FloodName() {
  const s = useFlood(openFloodSummary)
  if (!s) return null
  const live = s.mode === 'live'
  return (
    <span className="fxf-name" data-tip={s.name}>
      <LiveDot live={live} year={s.year} />
      <span className="fxf-name-text">{floodDisplayName({ name: s.name, synthetic: false })}</span>
      {s.synthetic && <span className="fxf-demo-tag mono">{DEMO_TAG}</span>}
    </span>
  )
}

function FloodMeta() {
  const tf = useTimeFormat()
  const s = useFlood(openFloodSummary)
  if (!s) return null
  const full = floodPlace(s)
  // the fire bar's way: the county alone ("San Juan County"), the full place and the point in the tooltip
  const place = full?.split(',')[0]?.trim() || full
  const date = floodDateLine(s, s.time_zone || tf.tz)
  return (
    <span className="tb-place fx-place" data-tip={`${full ?? s.name} · ${fmtLatLon(s.lat, s.lon, 3)}`}>
      {place && <span className="fx-place-name">{place}</span>}
      {date && (
        <span className={`tb-date${place ? ' fx-place-date' : ''}`}>
          <span>{date}</span>
        </span>
      )}
    </span>
  )
}

export function FloodHeader() {
  const collapsed = useStore((s) => s.panelsCollapsed)
  if (collapsed) return <FloodMiniBar />
  return (
    <TopBar
      inset="forensic"
      className="fx-bar fxf-bar"
      left={
        <>
          <BackButton onClick={backToAllFloods} label={FLOOD_FORENSIC.back} tip={FLOOD_FORENSIC.backTip} />
          <TopBarBrand size={22} />
          <span className="tb-sep" aria-hidden="true" />
          <FloodName />
          <FloodMeta />
        </>
      }
      centre={<ViewPill className="fx-bar-view" />}
      right={
        <nav className="hdr-actions" aria-label="Tools">
          <IconPill icon={<Share2 size={15} />} label="Share" tip="Copy a link to this flood in 3D" className="fx-tool" onClick={() => void copyLink()} />
          <IconPill icon={<Minimize2 size={15} />} label="Hide panels (H)" className="fx-tool fx-hide" onClick={() => useStore.getState().setPanelsCollapsed(true)} />
        </nav>
      }
    />
  )
}

/** Panels hidden: the flood's name, LIVE / year, the view pill and "Panels H". */
function FloodMiniBar() {
  const s = useFlood(openFloodSummary)
  return (
    <div className="minibar">
      <Logo size={20} />
      <span className="brand-name">Disaster Mapping</span>
      {s && <span className="minibar-name ellipsis">{floodDisplayName(s)}</span>}
      {s &&
        (s.mode === 'live' ? (
          <span className="minibar-live">
            <i className="live-dot" aria-hidden="true" />
            LIVE
          </span>
        ) : (
          <span className="minibar-year mono">{s.year}</span>
        ))}
      <ViewPill size="sm" className="minibar-view" />
      <button type="button" className="btn btn-sm btn-ghost minibar-panels" onClick={() => useStore.getState().setPanelsCollapsed(false)}>
        <Maximize2 size={13} /> Panels <kbd>H</kbd>
      </button>
    </div>
  )
}
