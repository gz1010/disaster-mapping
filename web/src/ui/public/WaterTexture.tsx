// The flood circle's water texture (brief 5, PLAN-5 §4.4; CONTRACT §16.12): the design's SVG verbatim
// (docs/redesign/handoff-4/screens/FloodView.dc.html "Flood name dot"): muddy grey-green rushing water. A base gradient
// (dark top, a bright band at the waterline, darker below), a misty corner, two current layers of stretched noise
// tilted −9° and scrolling sideways (2.6 s and 1.5 s) under a water mask that fades in from the waterline, a mist band
// over the waterline, slanted rain (12°, 0.55 s) and film grain. The ids are unique per instance (`idPrefix`).
// `running` false (prefers-reduced-motion) leaves every <animate> / <animateTransform> out: the texture stands still.
// Tones: active and demo are the design's; quiet is drawn darker by the circle's CSS and drops the rain, unless `rain`
// keeps it (a Flood Watch: rain, but no product of flooding yet).
import type { RefObject } from 'react'

const PX = 312

export function WaterTexture({
  tone,
  idPrefix,
  running,
  rain,
  svgRef,
}: {
  tone: 'active' | 'quiet' | 'demo'
  idPrefix: string
  running: boolean
  /** Draw the rain (default: on for active and demo, off for quiet). */
  rain?: boolean
  svgRef?: RefObject<SVGSVGElement | null>
}) {
  const id = (k: string) => `${idPrefix}${k}`
  const url = (k: string) => `url(#${id(k)})`
  const withRain = rain ?? tone !== 'quiet'
  return (
    <svg ref={svgRef} className="pfv-circle-tex is-water" width={PX} height={PX} viewBox={`0 0 ${PX} ${PX}`} aria-hidden="true" data-tone={tone}>
      <defs>
        <linearGradient id={id('flBase')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#121a16" />
          <stop offset="0.3" stopColor="#2a3530" />
          <stop offset="0.44" stopColor="#7f8a84" />
          <stop offset="0.56" stopColor="#5d6863" />
          <stop offset="1" stopColor="#252d2a" />
        </linearGradient>
        <linearGradient id={id('flWaterG')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.38" stopColor="#fff" stopOpacity="0.15" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id={id('flWater')}>
          <rect width={PX} height={PX} fill={url('flWaterG')} />
        </mask>
        <filter id={id('flCurrentF')} x="0" y="0" width={PX} height={PX} filterUnits="userSpaceOnUse">
          <feTurbulence type="fractalNoise" baseFrequency="0.0096 0.08" numOctaves={4} seed={11} stitchTiles="stitch" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.78  0 0 0 0 0.83  0 0 0 0 0.79  3 0 0 0 -1.2" />
        </filter>
        <filter id={id('flFoamF')} x="0" y="0" width={PX} height={PX} filterUnits="userSpaceOnUse">
          <feTurbulence type="turbulence" baseFrequency="0.0256 0.16" numOctaves={3} seed={6} stitchTiles="stitch" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.9  0 0 0 0 0.93  0 0 0 0 0.9  -5 0 0 0 1.5" />
        </filter>
        {withRain && (
          <filter id={id('flRainF')} x="0" y="0" width={PX} height={PX} filterUnits="userSpaceOnUse">
            <feTurbulence type="fractalNoise" baseFrequency="0.48 0.0096" numOctaves={1} seed={3} stitchTiles="stitch" />
            <feColorMatrix type="matrix" values="0 0 0 0 0.92  0 0 0 0 0.95  0 0 0 0 0.93  9 0 0 0 -5.6" />
          </filter>
        )}
        <filter id={id('flGrain')} x="0" y="0" width={PX} height={PX} filterUnits="userSpaceOnUse">
          <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves={2} seed={5}>
            {running && <animate attributeName="seed" dur="0.5s" values="5;6;7;8;9" calcMode="discrete" repeatCount="indefinite" />}
          </feTurbulence>
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <filter id={id('flMistF')}>
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <pattern id={id('flCurrentP')} width={PX} height={PX} patternUnits="userSpaceOnUse">
          {running && <animateTransform attributeName="patternTransform" type="translate" dur="2.6s" values={`0 0;-${PX} 0`} repeatCount="indefinite" />}
          <rect width={PX} height={PX} fill="#000" filter={url('flCurrentF')} />
        </pattern>
        <pattern id={id('flFoamP')} width={PX} height={PX} patternUnits="userSpaceOnUse">
          {running && <animateTransform attributeName="patternTransform" type="translate" dur="1.5s" values={`0 0;-${PX} 0`} repeatCount="indefinite" />}
          <rect width={PX} height={PX} fill="#000" filter={url('flFoamF')} />
        </pattern>
        {withRain && (
          <pattern id={id('flRainP')} width={PX} height={PX} patternUnits="userSpaceOnUse">
            {running && <animateTransform attributeName="patternTransform" type="translate" dur="0.55s" values={`0 0;0 ${PX}`} repeatCount="indefinite" />}
            <rect width={PX} height={PX} fill="#000" filter={url('flRainF')} />
          </pattern>
        )}
      </defs>
      <rect width={PX} height={PX} fill={url('flBase')} />
      <path d="M0 0 H150 C120 30 110 70 70 90 C40 105 20 130 0 140 Z" fill="#0b120e" opacity="0.7" filter={url('flMistF')} />
      <g mask={url('flWater')}>
        <rect x="-80" y="-40" width="472" height="392" fill={url('flCurrentP')} opacity="0.85" transform="rotate(-9 156 156)" />
        <rect x="-80" y="-40" width="472" height="392" fill={url('flFoamP')} opacity="0.5" transform="rotate(-9 156 156)" />
      </g>
      <ellipse cx="160" cy="138" rx="190" ry="34" fill="#c3ccc6" opacity="0.32" filter={url('flMistF')} />
      {withRain && <rect x="-80" y="-80" width="472" height="472" fill={url('flRainP')} opacity="0.38" transform="rotate(12 156 156)" />}
      <rect width={PX} height={PX} fill="#000" filter={url('flGrain')} opacity="0.32" style={{ mixBlendMode: 'overlay' }} />
    </svg>
  )
}
