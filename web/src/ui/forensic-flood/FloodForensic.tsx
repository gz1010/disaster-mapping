// The Forensic 3D flood view (brief 5, PLAN-5 §4.7; web-flood-forensic): mounted by ui/shell/ForensicWorkspace.tsx while
// a flood is open, in place of the fire's Forensic (whose Header, Timeline, Charts and panels stay fire-only and
// untouched). The fire Forensic's layout (scene full-bleed, floating top bar, right column, bottom dock, entry
// controls under the compass, demo badge, the fixed copy pill) with the flood's parts:
//   - the scene (scene/Scene.tsx with the flood's assets: terrain, drapes, warning lines, gauge bars; no fire effect)
//   - FloodHeader, FloodRightPanel (Layers, Analysis, Evidence, Notes; Flood overview and River gauges cards),
//     FloodDock (the river level chart and, opened, the NWS products drawn at its handle)
//   - "Frame flood" and "Charts & NWS products" under the compass; the scene key (one line per layer drawn, each with
//     its own time, and "Bar height: river stage at the gauge (scaled), not water depth")
//   - a flood without 3D data: "Disaster Mapping has not prepared this flood's 3D terrain yet." + "Prepare 3D data (about 1
//     min)" (useFlood.startFloodBuild, written by web-flood-public; its progress from state/floodBuild.ts), and the
//     scene loads by itself when the job is done
// The prototype line and "Not an all-clear. Follow local officials." (FixedCopy) stay on every state, phones included.
import { BarChart3, Crosshair, Map as MapIcon, PanelBottomClose, PanelBottomOpen, RotateCcw, Waves } from 'lucide-react'
import { lazy, Suspense, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { fmtAt } from '../../lib/time'
import { useDepthShown, useHeightInUse, useSatelliteOnScreen } from '../../scene/flood/flood3dHooks'
import { FLOOD_3D } from '../../scene/flood/flood3dCopy'
import { floodAssetStore, useFloodAssetsError } from '../../scene/flood/floodAssets'
import { setFloodOverlayRect } from '../../scene/flood/floodOverlayRects'
import { useSceneStore } from '../../scene/sceneStore'
import { floodPrepState } from '../../state/floodBuild'
import { openFloodSummary, useFlood } from '../../state/flood'
import { useStore } from '../../state/store'
import { useTimeFormat } from '../../state/timeZone'
import { ProgressBar, Spinner } from '../controls'
import { useNow } from '../hooks'
import { SceneBoundary, Toasts } from '../Overlays'
import { TooltipLayer } from '../Tooltip'
import { FixedCopy } from '../shell/FixedCopy'
import { fillCopy, PAST_NO_BUNDLE } from '../shell/floodCopy'
import { switchWorkspace } from '../shell/handoff'
import { NARROW_QUERY, useMediaQuery } from '../shell/hooks'
import { FloodDock } from './FloodDock'
import { FloodHeader } from './FloodHeader'
import { FLOOD_FORENSIC } from './floodForensicCopy'
import { sceneKeyItems } from './floodForensicView'
import { FloodRightPanel } from './FloodRightPanel'
import { useForensicFlood } from './forensicFloodState'
import { useSafeArea } from './safeArea'
import '../../styles/forensic-narrow.css'
import '../../styles/forensic-entry.css'
import '../../styles/forensic-flood.css'

const sceneOff = import.meta.env.VITE_SCENE === 'off'
const Scene = lazy(() => import('../../scene/Scene'))

/** "Frame flood" and "Charts & NWS products" (desktop) or the panels sheet (phones), under the compass. */
function EntryControls({ narrow, dockFull, onDock, sheetOpen, onSheet }: { narrow: boolean; dockFull: boolean; onDock: () => void; sheetOpen: boolean; onSheet: () => void }) {
  // brief 6: the river view (lower, closer, along the main river) when the bundle has a river line
  const hasRiver = floodAssetStore((s) => s.assets?.flood.river != null)
  return (
    <div className="fx-entry glass" role="group" aria-label="3D view">
      {hasRiver && (
        <button type="button" className="fx-entry-btn" onClick={() => useSceneStore.getState().issueCameraCommand('frame-river')} data-tip={FLOOD_3D.riverViewTip} aria-label={FLOOD_3D.riverView}>
          <Waves size={15} aria-hidden="true" /> {narrow ? FLOOD_3D.riverViewShort : FLOOD_3D.riverView}
        </button>
      )}
      <button type="button" className="fx-entry-btn" onClick={() => useSceneStore.getState().issueCameraCommand('frame-fire')} data-tip={FLOOD_FORENSIC.frameFloodTip}>
        <Crosshair size={15} aria-hidden="true" /> {FLOOD_FORENSIC.frameFlood}
      </button>
      {narrow ? (
        <button type="button" className="fx-entry-btn" aria-expanded={sheetOpen} onClick={onSheet}>
          {sheetOpen ? <PanelBottomClose size={15} aria-hidden="true" /> : <PanelBottomOpen size={15} aria-hidden="true" />} {sheetOpen ? FLOOD_FORENSIC.hidePanels : FLOOD_FORENSIC.panels}
        </button>
      ) : (
        <button type="button" className="fx-entry-btn" aria-expanded={dockFull} onClick={onDock} data-tip={FLOOD_FORENSIC.chartsTip}>
          <BarChart3 size={15} aria-hidden="true" /> {dockFull ? FLOOD_FORENSIC.hideCharts : FLOOD_FORENSIC.charts}
        </button>
      )}
    </div>
  )
}

/** The scene key: one line per layer drawn, each with its own time (D8, C16), the layer's backend note under it, the
 *  gauge bars' meaning, an amber line while the handle is after now (C1, WFF-R4), and a fold-out "About these layers"
 *  with each drawn layer's caveats in its source's words (WFF-R2). Phones: folded to its title, the amber line kept
 *  outside the fold. */
function SceneKey({ narrow }: { narrow: boolean }) {
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  const layers = useForensicFlood((s) => s.layers)
  const cursorMs = useFlood((s) => s.cursorMs)
  const tf = useTimeFormat()
  const nowMs = useNow(60_000)
  const height = useHeightInUse(flood)
  const depth = useDepthShown(flood)
  // brief 6 (playback): the satellite pass at the chart's handle, its own time, and the gap words
  const onScreen = useSatelliteOnScreen(flood)
  if (!flood) return null
  const items = sceneKeyItems({
    flood: onScreen ? { ...flood, satellite: onScreen.sat, has: { ...flood.has, satellite: onScreen.has, noView: onScreen.noView } } : flood,
    satNote: onScreen?.note ?? null,
    layers,
    tf,
    nowMs,
    cursorMs,
    height,
    depth,
    hasWarnings: flood.warnings?.status === 'available' && flood.warnings.alerts.length > 0,
    hasGauges: flood.gauges?.status === 'available' && flood.gauges.gauges.length > 0,
  })
  const more = items.filter((it) => it.more && it.more.texts.length)
  const future = items.find((it) => it.key === 'future')
  return (
    <div className="fxf-key-wrap">
      {/* phones: folded to its title (the Layers sheet has the legend too); desktop: open */}
      <details key={narrow ? 'narrow' : 'wide'} className="fxf-key glass" open={!narrow} aria-label={FLOOD_FORENSIC.keyTitle}>
        <summary className="fxf-key-title eyebrow">{FLOOD_FORENSIC.keyTitle}</summary>
        <ul>
          {items.map((it) => (
            <li key={it.key} className={it.stale ? 'is-stale' : undefined}>
              <i className={`fxf-sw-key fxf-key-${it.swatch}`} aria-hidden="true" />
              <span>
                {it.text}
                {it.notes?.map((n) => (
                  <span key={n} className="fxf-key-note">
                    {n}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        {more.length > 0 && (
          <details className="fxf-key-more">
            <summary>{FLOOD_FORENSIC.keyMore}</summary>
            <dl>
              {more.map((it) => (
                <div key={it.key}>
                  <dt>{it.more!.title}</dt>
                  {it.more!.texts.map((t) => (
                    <dd key={t}>{t}</dd>
                  ))}
                </div>
              ))}
            </dl>
          </details>
        )}
        <p className="fxf-key-foot">{FLOOD_FORENSIC.keyNotAllClear}</p>
      </details>
      {narrow && future && <p className="fxf-key-future glass">{future.text}</p>}
    </div>
  )
}

/** The page shown while the flood has no 3D data: the top bar, a glass card (prepare, progress, failure), the fixed
 *  copy. */
function NotPrepared() {
  const tf = useTimeFormat()
  const { floodId, summary, manifest, job, detailLoading, buildError } = useFlood(
    useShallow((s) => ({
      floodId: s.floodId,
      summary: openFloodSummary(s),
      manifest: s.manifest,
      job: s.job,
      detailLoading: s.detailLoading,
      buildError: s.buildError,
    })),
  )
  const prep = floodPrepState({ id: floodId, summary, manifest, job, loading: detailLoading, error: buildError })
  const nowMs = useNow(30_000)
  const loading = !summary || (detailLoading && prep.kind === 'none')
  return (
    <div className="mw fx-empty fxf-empty">
      <div className="fxf-empty-head">
        <FloodHeader />
      </div>
      <main className="fxf-empty-main">
        <section className="mw-panel fxf-prep" aria-labelledby="fxf-prep-title" aria-busy={prep.kind === 'building' || loading}>
          <h2 id="fxf-prep-title">{summary ? summary.name : FLOOD_FORENSIC.loadingDetail}</h2>
          {loading ? (
            <p className="fxf-prep-text">
              <Spinner size={12} /> {FLOOD_FORENSIC.loadingDetail}
            </p>
          ) : prep.kind === 'building' ? (
            <>
              <p className="fxf-prep-text">{prep.step === 'queued' || prep.progress == null ? FLOOD_FORENSIC.preparingQueued : fillCopy(FLOOD_FORENSIC.preparing, { step: `${prep.step ?? ''} ${Math.round((prep.progress ?? 0) * 100)}%`.trim() })}</p>
              <ProgressBar value={prep.progress} label={FLOOD_FORENSIC.prepare} />
              {prep.error && <p className="fxf-prep-error">{prep.error}</p>}
            </>
          ) : prep.kind === 'failed' ? (
            <>
              <p className="fxf-prep-text">{FLOOD_FORENSIC.prepareFailed}</p>
              {prep.error && <p className="fxf-prep-error">{prep.error}</p>}
              <button type="button" className="mw-btn fxf-btn-accent" onClick={() => void useFlood.getState().startFloodBuild(true)}>
                <RotateCcw size={14} aria-hidden="true" /> {FLOOD_FORENSIC.prepareAgain}
              </button>
            </>
          ) : prep.kind === 'needed' && summary?.mode === 'historical' ? (
            // a past flood: the build answers 409 PAST_NO_BUNDLE, so say it up front (integration; BFL-R4)
            <p className="fxf-prep-text">{PAST_NO_BUNDLE}</p>
          ) : prep.kind === 'needed' ? (
            <>
              <p className="fxf-prep-text">{FLOOD_FORENSIC.notPrepared}</p>
              <p className="fxf-prep-note">{FLOOD_FORENSIC.prepareNote}</p>
              <button type="button" className="mw-btn fxf-btn-accent fxf-prepare" onClick={() => void useFlood.getState().startFloodBuild()}>
                {FLOOD_FORENSIC.prepare}
              </button>
            </>
          ) : (
            <p className="fxf-prep-text">{floodId === 'fixture-flood' ? FLOOD_FORENSIC.prepareFixture : FLOOD_FORENSIC.notPrepared}</p>
          )}
          {manifest?.status === 'ready' && manifest.built_ms ? <p className="fxf-prep-note mono">{fmtAt(manifest.built_ms, tf, { zone: true, year: 'auto', refMs: nowMs })}</p> : null}
          <div className="fx-empty-actions">
            <button type="button" className="mw-btn" onClick={() => switchWorkspace('map')}>
              <MapIcon size={14} /> {FLOOD_FORENSIC.backToMap}
            </button>
          </div>
        </section>
      </main>
      <footer className="fx-empty-foot">
        <FixedCopy variant="pill" />
      </footer>
      <Toasts />
      <TooltipLayer />
    </div>
  )
}

/** The scene's loading and failure lines (the scene's own veil says "Loading terrain"). */
function TerrainError() {
  const error = useFloodAssetsError()
  if (!error) return null
  return <div className="fxf-terrain-error glass">{fillCopy(FLOOD_FORENSIC.terrainFailed, { reason: error })}</div>
}

/** Keeps a floating box over the scene in scene/flood/floodOverlayRects (viewport pixels) so the gauge bar labels hide
 *  under it (review WFF-R8). */
function useOverlayRect(id: string, ref: RefObject<HTMLElement | null>, layoutKey: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setFloodOverlayRect(id, { left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    for (const c of Array.from(el.children)) ro.observe(c)
    // a <details> opening or closing resizes the column (observed)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      setFloodOverlayRect(id, null)
    }
  }, [id, ref, layoutKey])
}

function FloodScene() {
  const collapsed = useStore((s) => s.panelsCollapsed)
  const demo = useFlood((s) => openFloodSummary(s)?.synthetic === true)
  const narrow = useMediaQuery(NARROW_QUERY)
  const [dockFull, setDockFull] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const header = useRef<HTMLDivElement | null>(null)
  const right = useRef<HTMLDivElement | null>(null)
  const dock = useRef<HTMLElement | null>(null)
  const ws = useRef<HTMLDivElement | null>(null)
  const note = useRef<HTMLDivElement | null>(null)
  useSafeArea(collapsed, { header, right, dock }, `${narrow}|${dockFull}|${sheetOpen}`)
  useOverlayRect('ws', ws, `${narrow}|${collapsed}|${sheetOpen}`)
  useOverlayRect('note', note, `${narrow}|${collapsed}|${dockFull}`)
  const cls = ['app', 'fxf-app', collapsed && 'is-collapsed', !dockFull && 'fx-dock-min', narrow && !sheetOpen && 'fx-sheet-closed']
  return (
    <div className={cls.filter(Boolean).join(' ')}>
      <div className="app-canvas">
        {sceneOff ? (
          <div className="scene-placeholder">
            <span className="mono">3D scene disabled (VITE_SCENE=off)</span>
          </div>
        ) : (
          <SceneBoundary>
            <Suspense
              fallback={
                <div className="scene-placeholder">
                  <span className="mono muted">loading 3D scene…</span>
                </div>
              }
            >
              <Scene />
            </Suspense>
          </SceneBoundary>
        )}
        <div className="fx-topfade" aria-hidden="true" />
      </div>
      <div className="app-header" ref={header}>
        <FloodHeader />
      </div>
      {!collapsed && (
        <>
          <FloodRightPanel panelRef={right} />
          <FloodDock dockRef={dock} />
        </>
      )}
      <div className="fx-ws" ref={ws}>
        {!collapsed && <EntryControls narrow={narrow} dockFull={dockFull} onDock={() => setDockFull((v) => !v)} sheetOpen={sheetOpen} onSheet={() => setSheetOpen((v) => !v)} />}
        {demo && (
          <span className="fx-demo-badge fxf-demo-badge" role="note" data-tip={FLOOD_FORENSIC.demoTip}>
            <span>{FLOOD_FORENSIC.demoBadge}</span>
            <span className="fxf-demo-sub">{FLOOD_FORENSIC.demoBadgeSub}</span>
          </span>
        )}
        {!collapsed && <SceneKey narrow={narrow} />}
      </div>
      <div className="fx-note" ref={note}>
        <FixedCopy variant="pill" />
      </div>
      <div className="top-center">
        <TerrainError />
      </div>
      <Toasts />
      <TooltipLayer />
    </div>
  )
}

/** The flood branch: the scene when the flood's 3D data is ready, else the "not prepared" page. */
export function FloodForensic() {
  const ready = useFlood((s) => s.manifest != null && s.manifest.id === s.floodId && s.manifest.status === 'ready')
  return ready ? <FloodScene /> : <NotPrepared />
}

export default FloodForensic
