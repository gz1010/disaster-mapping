// The hazard circle's presentational part (brief 5, PLAN-5 §4.4 and §4.8; CONTRACT §16.12), split from the brief-4
// fire circle (ui/public/HazardCircle.tsx, which keeps its behaviour and markup). A 312 px round button: a texture
// (the fire's thermal glow, or the flood's rushing water, ui/public/WaterTexture.tsx), the shade behind the text, the
// status words, the name fitted to the circle (72 px / 800, down to 40 px over two lines, a long name down to 28 px
// over three; fireView.ts fitName), "MORE IN COMMAND ›" and a hidden meaning line (aria-describedby).
// Motion: the SMIL animations are left out under prefers-reduced-motion (the texture stands still) and paused while the
// tab is hidden (svg.pauseAnimations). Filter and gradient ids are unique per instance (useId).
import { useEffect, useId, useMemo, useRef, useSyncExternalStore, type CSSProperties, type Ref, type RefObject } from 'react'
import { fitName } from './fireView'
import { WaterTexture } from './WaterTexture'

/** The circle's size on the screen (px); its texture and text scale with the size it is drawn at. */
export const CIRCLE_PX = 312
/** The name's room inside the circle at 312 px (the chord at the name's height, less a margin). */
export const NAME_ROOM = 256

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'
/** prefers-reduced-motion, live (false on the server). */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia?.(REDUCED_QUERY)
      m?.addEventListener('change', cb)
      return () => m?.removeEventListener('change', cb)
    },
    () => window.matchMedia?.(REDUCED_QUERY).matches === true,
    () => false,
  )
}

let measureCtx: CanvasRenderingContext2D | null | undefined
/** The name's width in Inter 800 at `px` with the screen's -0.03em tracking (an estimate without a canvas). */
function measureName(text: string, px: number): number {
  if (measureCtx === undefined) measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (!measureCtx) return text.length * px * 0.62
  measureCtx.font = `800 ${px}px Inter, system-ui, sans-serif`
  return measureCtx.measureText(text).width - 0.03 * px * text.length
}

/** Pause the SVG's animations while the tab is hidden (and keep them paused under reduced motion). */
function usePausedWhenHidden(svg: RefObject<SVGSVGElement | null>, still: boolean) {
  useEffect(() => {
    const el = svg.current
    if (!el || typeof el.pauseAnimations !== 'function') return
    const apply = () => {
      if (still || document.hidden) el.pauseAnimations()
      else el.unpauseAnimations()
    }
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => document.removeEventListener('visibilitychange', apply)
  }, [svg, still])
}

/** active: the full texture; quiet: darker (a fire not listed as active, a flood with no NWS warning now, a watch, a
 *  past flood); demo: simulated data; unknown: loading. */
export type DiscTone = 'active' | 'quiet' | 'demo' | 'unknown'

export interface HazardDiscProps {
  texture: 'thermal' | 'water'
  tone: DiscTone
  /** "WILDFIRE · ACTIVE", "FLOOD · WARNING" (drawn split at " · "). */
  statusLine: string
  /** The name drawn in the circle (fitted). */
  name: string
  /** The hidden meaning line (the button's description). */
  meaning: string
  /** The button's accessible name. */
  label: string
  /** The tooltip; the drawn name is put first when it is drawn small or cut (or `tipName` always, when given). */
  tip?: string
  /** A fuller name for the tooltip's start (the flood's whole name when the circle draws a short one). */
  tipName?: string
  onClick?: () => void
  compact?: boolean
  /** Water only: keep the slanted rain on a quiet tone (a Flood Watch: rain, but no product of flooding yet). */
  rain?: boolean
  ref?: Ref<HTMLButtonElement>
}

/** The fire's thermal texture (brief 4 H4, FireView.dc.html "Fire name dot"): an feTurbulence smoky glow, brightest at
 *  the bottom left, slowly drifting; twinkling specks; film grain; no grid. */
function ThermalTexture({ svgRef, id, still }: { svgRef: RefObject<SVGSVGElement | null>; id: (k: string) => string; still: boolean }) {
  return (
    <svg ref={svgRef} className="pfv-circle-tex" width={CIRCLE_PX} height={CIRCLE_PX} viewBox={`0 0 ${CIRCLE_PX} ${CIRCLE_PX}`} aria-hidden="true">
      <defs>
        <radialGradient id={id('glow')} cx="0.3" cy="0.9" r="0.85">
          <stop offset="0" stopColor="#ff9a3c" />
          <stop offset="0.22" stopColor="#ee6a24" />
          <stop offset="0.48" stopColor="#9e2c0e" />
          <stop offset="0.74" stopColor="#3a0c05" />
          <stop offset="1" stopColor="#0b0302" />
        </radialGradient>
        <radialGradient id={id('maskg')} cx="0.3" cy="0.86" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.12" />
        </radialGradient>
        <mask id={id('mask')}>
          <rect width={CIRCLE_PX} height={CIRCLE_PX} fill={`url(#${id('maskg')})`} />
        </mask>
        <filter id={id('cloud')} x="0" y="0" width={CIRCLE_PX} height="360" filterUnits="userSpaceOnUse">
          <feTurbulence type="fractalNoise" baseFrequency="0.011 0.02" numOctaves={4} seed={8}>
            {!still && <animate attributeName="baseFrequency" dur="16s" values="0.011 0.02;0.013 0.017;0.010 0.022;0.011 0.02" repeatCount="indefinite" />}
          </feTurbulence>
          <feOffset dx="0" dy="0">{!still && <animate attributeName="dy" dur="11s" values="0;-34;-12;0" repeatCount="indefinite" />}</feOffset>
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.46  0 0 0 0 0.15  2.6 0 0 0 -1.02" />
        </filter>
        <filter id={id('speck')} x="0" y="0" width={CIRCLE_PX} height={CIRCLE_PX} filterUnits="userSpaceOnUse">
          <feTurbulence type="turbulence" baseFrequency="0.5" numOctaves={1} seed={2}>
            {!still && <animate attributeName="seed" dur="1.6s" values="2;3;4;5;6;7" calcMode="discrete" repeatCount="indefinite" />}
          </feTurbulence>
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.58  0 0 0 0 0.22  9 0 0 0 -6.4" />
        </filter>
        <filter id={id('grain')} x="0" y="0" width={CIRCLE_PX} height={CIRCLE_PX} filterUnits="userSpaceOnUse">
          <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves={2} seed={5}>
            {!still && <animate attributeName="seed" dur="0.5s" values="5;6;7;8;9" calcMode="discrete" repeatCount="indefinite" />}
          </feTurbulence>
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      <rect width={CIRCLE_PX} height={CIRCLE_PX} fill={`url(#${id('glow')})`} />
      <rect width={CIRCLE_PX} height={CIRCLE_PX} fill="#000" filter={`url(#${id('cloud')})`} mask={`url(#${id('mask')})`} opacity="0.9" style={{ mixBlendMode: 'screen' }} />
      <rect width={CIRCLE_PX} height={CIRCLE_PX} fill="#000" filter={`url(#${id('speck')})`} mask={`url(#${id('mask')})`} opacity="0.6" />
      <rect width={CIRCLE_PX} height={CIRCLE_PX} fill="#000" filter={`url(#${id('grain')})`} opacity="0.2" style={{ mixBlendMode: 'overlay' }} />
    </svg>
  )
}

export function HazardDisc({ texture, tone, statusLine, name, meaning, label, tip, tipName, onClick, compact = false, rain, ref }: HazardDiscProps) {
  const still = useReducedMotion()
  const svg = useRef<SVGSVGElement | null>(null)
  usePausedWhenHidden(svg, still)
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const id = (k: string) => `hz${uid}${k}`
  const fitted = useMemo(() => (name ? fitName(name, measureName, NAME_ROOM) : { lines: [], px: 72 }), [name])
  // a long name drawn small or cut at its end: the tooltip gives it whole (the accessible name always does)
  const shortened = fitted.px < 40 || fitted.clamp === true
  const lead = tipName ? `${tipName}. ` : shortened ? `${name}. ` : ''
  const meaningId = id('m')
  return (
    <button
      ref={ref}
      type="button"
      className={`pfv-circle is-${tone}${compact ? ' is-compact' : ''}${texture === 'water' ? ' is-water' : ''}`}
      aria-label={label}
      aria-describedby={meaningId}
      data-tip={tip != null ? `${lead}${tip}` : undefined}
      onClick={onClick}
    >
      {texture === 'water' ? (
        <WaterTexture svgRef={svg} idPrefix={`hz${uid}`} tone={tone === 'unknown' ? 'quiet' : tone} running={!still} rain={rain} />
      ) : (
        <ThermalTexture svgRef={svg} id={id} still={still} />
      )}
      <span className="pfv-circle-shade" aria-hidden="true" />
      <span className="pfv-circle-status" aria-hidden="true">
        {statusLine.split(' · ').map((part, i) => (
          <span key={i} className="pfv-circle-part">
            {i > 0 && <span className="pfv-circle-dot"> · </span>}
            {part}
          </span>
        ))}
      </span>
      {fitted.lines.length > 0 && (
        <span className={`pfv-circle-name${fitted.clamp ? ' is-clamped' : ''}`} aria-hidden="true" style={{ '--pfv-name-px': `${fitted.px}px` } as CSSProperties}>
          {fitted.lines.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </span>
      )}
      <span className="pfv-circle-more" aria-hidden="true">
        More in Command
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d="M9 6 L15 12 L9 18" />
        </svg>
      </span>
      <span id={meaningId} className="mw-sr-only">
        {meaning}
      </span>
    </button>
  )
}
