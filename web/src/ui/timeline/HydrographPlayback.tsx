// The flood's time steps on the river-level chart (brief 6, web-flood-playback M2; BRIEF-6 decision 2): Play / Pause
// and Previous / Next step buttons, the step at the handle in words ("Satellite pass Oct 29, 12:04 EDT · 7 days before
// now", "NWS Flood Warning issued Nov 4, 20:25 CST"), the note for the days between two satellite passes ("No satellite
// image between Oct 29 and Nov 3"), and the steps' marks on the plot. Mounted by Hydrograph.tsx in both variants
// (Command's slim chart, Forensic's dock).
//   - Steps: state/floodTimeline.ts (the satellite passes NASA saw something on, and the NWS product changes); the
//     handle (useFlood.cursorMs) moves from step to step and every view follows it. Nothing is drawn between passes.
//   - No autoplay. Play runs one step every PLAY_STEP_MS to the latest step; under prefers-reduced-motion it never runs
//     on a timer (each press shows the next step). A hand move of the handle pauses it.
//   - Keys while the chart is shown: Space plays or pauses (not while typing or on another control), the comma and full
//     stop keys step back and forward.
//   - NWS's event names are NWS's own words: rendered inside data-verbatim.
//   - Review fixes (review6): at a past step the "NWS · n" button lists the NWS versions the map draws, each with its
//     issuer, its own times, its words verbatim and a link, IEM archive copies tagged and credited (WFP-R3); phones keep
//     the image's date on a line of its own (WFP-R5); the slim chart says which drawn layers show now (WFP-R6).
import { ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FloodAlert } from '../../api/types'
import { fmtAt, timeFmt, type TimeFmt } from '../../lib/time'
import { archiveCreditAtHandle } from '../../map/floodAreaLayers'
import { useFloodOfficial } from '../../official/floodHooks'
import { fimMapped, orderAlerts } from '../../official/floodModel'
import { openFloodSummary, useFlood } from '../../state/flood'
import { isUsablePass, keyframeIndexAt, passLabel, PLAY_STEP_MS, step, STEP_EPS_MS, type StepLabel } from '../../state/floodTimeline'
import { useProductsAtHandle } from '../../state/floodTimelineData'
import { useClock } from '../../state/timeZone'
import { Popover } from '../controls'
import { ARCHIVED_COPY, fillCopy } from '../shell/floodCopy'
import { PLAYBACK } from './floodPlaybackCopy'
import { lastStep, moveHandle, playPress, playTick, setPlaying, useFloodPlayback } from './floodPlayback'
import { stepWords, type PlaybackView } from './hydrographPlaybackView'
import { xFrac, type HydrographModel } from './hydrographModel'

/** prefers-reduced-motion, live. */
function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const update = () => setOn(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])
  return on
}

/** Keys that belong to another control (Space would press it, or a list keeps its keys). */
const OTHER_CONTROL = 'button, a[href], select, summary, [role="option"], [role="listbox"], [role="menu"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"]:not(.hg-slider)'

function isTyping(t: HTMLElement | null): boolean {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

/** The row above the plot: the buttons, the step at the handle and the gap note. */
export function PlayRow({ view, variant }: { view: PlaybackView; variant: 'slim' | 'dock' }) {
  const { floodId, frames, nowMs } = view
  const cursorMs = useFlood((s) => s.cursorMs)
  const playing = useFloodPlayback((s) => s.playing && s.floodId === floodId)
  const reduced = useReducedMotion()
  const has = frames.length > 0 && view.status === 'available'

  const togglePlay = useCallback(() => {
    if (!has) return
    if (useFloodPlayback.getState().playing && useFloodPlayback.getState().floodId === floodId) return setPlaying(floodId, false)
    const r = playPress(frames, useFlood.getState().cursorMs, nowMs, reduced)
    if (!r) return
    moveHandle(floodId, r.to)
    setPlaying(floodId, r.run)
  }, [has, frames, nowMs, reduced, floodId])

  const stepTo = useCallback(
    (dir: 'next' | 'prev') => {
      if (!has) return
      setPlaying(floodId, false)
      const r = step(frames, useFlood.getState().cursorMs, dir, nowMs)
      if (r) moveHandle(floodId, r.cursorMs)
    },
    [has, frames, nowMs, floodId],
  )

  // Play: one step every PLAY_STEP_MS to the latest step (never under reduced motion)
  useEffect(() => {
    if (!playing) return
    if (reduced || !has) {
      setPlaying(floodId, false)
      return
    }
    const last = lastStep(frames, nowMs)
    const id = window.setInterval(() => {
      const next = playTick(frames, useFlood.getState().cursorMs, nowMs)
      if (next == null) return setPlaying(floodId, false)
      moveHandle(floodId, next)
      if (last && Math.abs(next - last.t) <= STEP_EPS_MS) setPlaying(floodId, false)
    }, PLAY_STEP_MS)
    return () => window.clearInterval(id)
  }, [playing, reduced, has, frames, nowMs, floodId])

  // leaving the view pauses (Play never resumes by itself when a chart comes back)
  useEffect(() => () => setPlaying(floodId, false), [floodId])

  // keys: Space, comma, full stop (one listener for the mounted chart; the latest handlers through refs)
  const keys = useRef({ togglePlay, stepTo, has })
  useEffect(() => {
    keys.current = { togglePlay, stepTo, has }
  }, [togglePlay, stepTo, has])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !keys.current.has) return
      const t = e.target as HTMLElement | null
      if (isTyping(t) || document.querySelector('.popover')) return
      if (e.key === ' ' || e.code === 'Space') {
        if (t?.closest?.(OTHER_CONTROL)) return
        e.preventDefault()
        if (!e.repeat) keys.current.togglePlay()
      } else if (e.key === ',' || e.key === '.') {
        e.preventDefault()
        keys.current.stepTo(e.key === ',' ? 'prev' : 'next')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const canPrev = has && step(frames, cursorMs, 'prev', nowMs) != null
  const canNext = has && step(frames, cursorMs, 'next', nowMs) != null
  const words = stepWords(view, cursorMs)
  const playLabel = playing ? PLAYBACK.pause : PLAYBACK.play
  const playTip = playing ? PLAYBACK.pauseTip : reduced ? PLAYBACK.playReducedTip : PLAYBACK.playTip
  // the slim chart (Command's 2D map): the drawn layers that are products of now (review WFP-R6)
  const nowLayers = useNowLayers(variant === 'slim' && words.past)
  const nowNote = nowLayers.length ? fillCopy(PLAYBACK.nowLayers, { layers: nowLayers.join(', ') }) : null
  const nowShort = nowLayers.length ? fillCopy(PLAYBACK.nowLayersShort, { layers: nowLayers.join(', ') }) : null
  const title = [words.label?.text, words.gap, words.note, nowNote].filter(Boolean).join(' · ')
  const phoneLine = [words.gapShort, nowShort].filter(Boolean).join(' · ')
  return (
    <div className={`hg-play${variant === 'dock' ? ' is-dock' : ''}`} role="group" aria-label={PLAYBACK.groupName}>
      <span className="hg-play-btns">
        <button type="button" className="hg-play-btn" aria-label={PLAYBACK.prev} data-tip={PLAYBACK.prevTip} disabled={!canPrev} onClick={() => stepTo('prev')}>
          <StepIcon kind="prev" />
        </button>
        <button
          type="button"
          className={`hg-play-btn is-play${playing ? ' is-playing' : ''}`}
          aria-label={playLabel}
          aria-pressed={playing}
          data-tip={playTip}
          disabled={!has}
          onClick={togglePlay}
        >
          <StepIcon kind={playing ? 'pause' : 'play'} />
        </button>
        <button type="button" className="hg-play-btn" aria-label={PLAYBACK.next} data-tip={PLAYBACK.nextTip} disabled={!canNext} onClick={() => stepTo('next')}>
          <StepIcon kind="next" />
        </button>
      </span>
      <p className="hg-step" title={title || undefined} aria-live="polite">
        {words.label && (
          <span className={`hg-step-label${words.onStep ? ' is-on' : ''}`}>
            <LabelText label={words.label} />
          </span>
        )}
        {words.gap && <span className="hg-step-gap">{words.gap}</span>}
        {words.note && <span className="hg-step-note">{words.note}</span>}
        {nowNote && <span className="hg-step-now">{nowNote}</span>}
      </p>
      {words.past && <NwsAtHandle />}
      {/* phones: the image's date on a line of its own, never cut by the label's clamp (review WFP-R5) */}
      {phoneLine && (
        <p className="hg-step-line" title={phoneLine}>
          {phoneLine}
        </p>
      )}
      <span className="hg-sr">{PLAYBACK.keysHelp}</span>
    </div>
  )
}

/** The drawn layers that are products of now (they stay drawn at a past step): the NWS forecast area, FEMA, the
 *  category map and the model, each while on (review WFP-R6). */
function useNowLayers(enabled: boolean): string[] {
  const layers = useFlood(useShallow((s) => ({ forecastArea: s.layers.forecastArea, floodplain: s.layers.floodplain, catfim: s.layers.catfim, model: s.layers.model, highFlow: s.layers.modelHighFlow })))
  const fim = useFloodOfficial((s) => s.fim.data)
  if (!enabled) return []
  const out: string[] = []
  if (layers.forecastArea && fimMapped(fim)) out.push(PLAYBACK.nowForecast)
  if (layers.floodplain) out.push(PLAYBACK.nowFloodplain)
  if (layers.catfim) out.push(PLAYBACK.nowCatfim)
  if (layers.model || layers.highFlow) out.push(PLAYBACK.nowModel)
  return out
}

/** "NWS · n" at a past step (review WFP-R3): the NWS versions the map draws at the handle, from the time history, each
 *  with its issuer, its own issue and end times (in its own zone), NWS's words verbatim, a link, and the IEM archive's
 *  tag and credit for an archived copy. Nothing when the handle shows the live answer (Official now lists it). */
function NwsAtHandle() {
  const live = useFloodOfficial((s) => s.alerts.data)
  const r = useProductsAtHandle(live)
  const clock = useClock()
  const zone = useFlood((s) => openFloodSummary(s)?.time_zone ?? null)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement | null>(null)
  if (r.source !== 'timeline' || !r.alerts.length) return null
  const n = r.alerts.length
  const credit = archiveCreditAtHandle(r, r.timeline)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="hg-nws-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={fillCopy(PLAYBACK.nwsButtonLabel, { n })}
        data-tip={PLAYBACK.nwsButtonTip}
        onClick={() => setOpen((o) => !o)}
      >
        {fillCopy(PLAYBACK.nwsButton, { n })}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="top-end" width={340} className="hg-nws-pop" label={PLAYBACK.nwsTitle}>
        <p className="hg-nws-title">{PLAYBACK.nwsTitle}</p>
        <ul className="hg-nws-list">
          {orderAlerts(r.alerts).map((a) => (
            <NwsVersion key={a.id} a={a} tf={timeFmt(a.time_zone || zone || 'UTC', clock)} />
          ))}
        </ul>
        <p className="hg-nws-note">{PLAYBACK.nwsNote}</p>
        {credit && (
          <p className="hg-nws-credit">
            {credit.href ? (
              <a href={credit.href} target="_blank" rel="noreferrer noopener">
                {credit.text}
              </a>
            ) : (
              credit.text
            )}
          </p>
        )}
      </Popover>
    </>
  )
}

/** One NWS version: its event and issuer verbatim, its own times, its headline verbatim, the archive tag and its link. */
export function NwsVersion({ a, tf }: { a: FloodAlert; tf: TimeFmt }) {
  const end = a.ends_ms ?? a.expires_ms
  const at = (ms: number) => fmtAt(ms, tf, { zone: true, year: 'auto' })
  const times = [a.sent_ms != null ? fillCopy(PLAYBACK.nwsIssued, { time: at(a.sent_ms) }) : null, end != null ? fillCopy(PLAYBACK.nwsUntil, { time: at(end) }) : null].filter(Boolean).join(' · ')
  const url = typeof a.url === 'string' && a.url.startsWith('https://') ? a.url : null
  return (
    <li className={`hg-nws-item${a.emergency ? ' is-emergency' : ''}`}>
      <p className="hg-nws-event">
        <strong data-verbatim="">{a.event}</strong> · <span data-verbatim="">{a.sender_name || 'National Weather Service'}</span>
      </p>
      {times && <p className="hg-nws-times">{times}</p>}
      {a.headline && (
        <p className="hg-nws-headline" data-verbatim="">
          {a.headline}
        </p>
      )}
      <p className="hg-nws-src">
        {a.archived && <span className="hg-nws-archived">{ARCHIVED_COPY}</span>}
        {a.archived && url && ' · '}
        {url && (
          <a href={url} target="_blank" rel="noreferrer noopener">
            {a.archived ? PLAYBACK.nwsLinkArchived : PLAYBACK.nwsLink} <ExternalLink size={11} aria-hidden="true" />
          </a>
        )}
      </p>
    </li>
  )
}

/** A label with NWS's event name inside data-verbatim. */
function LabelText({ label }: { label: StepLabel }) {
  const at = label.event ? label.text.indexOf(label.event) : -1
  if (!label.event || at < 0) return <>{label.text}</>
  return (
    <>
      {label.text.slice(0, at)}
      <span data-verbatim="">{label.event}</span>
      {label.text.slice(at + label.event.length)}
    </>
  )
}

function StepIcon({ kind }: { kind: 'prev' | 'next' | 'play' | 'pause' }) {
  const d =
    kind === 'play'
      ? 'M4 2.5L11.5 7L4 11.5Z'
      : kind === 'pause'
        ? 'M3.5 2.5H6V11.5H3.5ZM8 2.5H10.5V11.5H8Z'
        : kind === 'next'
          ? 'M2.5 2.5L8.5 7L2.5 11.5ZM9.5 2.5H11.5V11.5H9.5Z'
          : 'M11.5 2.5L5.5 7L11.5 11.5ZM2.5 2.5H4.5V11.5H2.5Z'
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  )
}

/** The steps' marks along the plot's top: a filled mark for each satellite pass NASA saw something on, a hollow grey
 *  one for a pass that saw nothing (no view: listed, never drawn as water); the step at the handle is outlined. */
export function PassMarks({ view, model: m, width, cursorMs }: { view: PlaybackView; model: HydrographModel; width: number; cursorMs: number | null }) {
  const on = cursorMs != null ? keyframeIndexAt(view.frames, cursorMs) : -1
  const current = on >= 0 ? view.frames[on].pass?.key : null
  return (
    <g className="hg-passes">
      {view.passes.map((p) => {
        if (p.view === 'unknown' || p.acquired_ms < m.startMs || p.acquired_ms > m.endMs) return null
        const x = xFrac(m, p.acquired_ms) * width
        const usable = isUsablePass(p)
        const tip = usable ? passLabel(p, view.tf, view.nowMs, view.past) : `${passLabel(p, view.tf, view.nowMs, view.past)} · ${p.caveat ?? ''}`.replace(/ · $/, '')
        return (
          <path key={p.key} d={`M${(x - 4.5).toFixed(1)} 0L${(x + 4.5).toFixed(1)} 0L${x.toFixed(1)} 7.5Z`} className={`hg-pass${usable ? '' : ' is-noview'}${p.key === current ? ' is-current' : ''}`}>
            <title>{tip}</title>
          </path>
        )
      })}
    </g>
  )
}
