// The flood view's leader from the hazard circle to the flood on the map (brief 5, FloodView.dc.html "Flood extent,
// leader line and point"; PLAN-5 §4.4, D10, C4). An SVG overlay over the map and under the chrome (aria-hidden; pointer
// events none): a 1.5 px #4fc3ff line from the circle's edge to the flood's anchor, which is
//   - the primary MEMBER river gauge, drawn as its NWS category diamond in a 22 px #4fc3ff halo (α .22), or
//   - for a flood without a member gauge (flash, areal, watch), the representative point of its largest NWS polygon,
//     drawn as a small ring in the NWS alert pink. A nearby gauge on another stream never stands for a flash flood.
// The light-blue dot stays brief 4's "your selected point" (map/markers.ts). The line is hidden when the anchor is off
// the map, under the circle or the view's panels, or when it would cross them (map/leaderLayout.ts segmentHitsRect), as
// the fire view's leader (ui/public/ReportedPoint.tsx) is.
import { useEffect, useMemo, useState, type RefObject } from 'react'
import { useFloodAreas, useFloodOfficial } from '../official/floodHooks'
import { primaryGaugeReading } from '../official/floodModel'
import { useSearchUi } from '../location/searchUi'
import { openFloodSummary, useFlood } from '../state/flood'
import { useWorkspace } from '../state/workspace'
import { leaderTarget } from '../ui/public/floodView'
import { CATEGORY_COLORS, FLOOD_ALERT, FLOOD_TOKENS, gaugeTone } from './floodStyle'
import { segmentHitsRect, type Rect } from './leaderLayout'
import { useMapAnchor } from './useMapAnchor'

/** The panels a leader must not cross (the fire view's list, with the flood view's own slots). */
const BLOCKING =
  '.mw [data-chrome]:not([data-chrome="circle"]):not([data-chrome="header"]), .mw [data-chrome="header"] .tb-side > *, .mw [data-chrome="header"] .tb-centre > *, .mw .top-center > *, .pfv-search-pop, .loc-search-below > *, .fxm-legend-pop'

interface CircleGeom {
  x: number
  y: number
  r: number
}

function useCircleGeom(circle: RefObject<HTMLElement | null>, enabled: boolean): CircleGeom | null {
  const [geom, setGeom] = useState<CircleGeom | null>(null)
  useEffect(() => {
    let el = circle.current
    let raf = 0
    if (!enabled) return
    const measure = () => {
      if (!el) return
      const r = el.getBoundingClientRect()
      const next = r.width > 1 && r.height > 1 && el.getClientRects().length > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 } : null
      setGeom((g) => (g && next && Math.abs(g.x - next.x) < 0.5 && Math.abs(g.y - next.y) < 0.5 && Math.abs(g.r - next.r) < 0.5 ? g : next))
    }
    const ro = new ResizeObserver(measure)
    const attach = () => {
      el = circle.current
      if (!el) {
        raf = requestAnimationFrame(attach)
        return
      }
      measure()
      ro.observe(el)
    }
    attach()
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [circle, enabled])
  return enabled ? geom : null
}

function blockingRects(): Rect[] {
  const out: Rect[] = []
  document.querySelectorAll<HTMLElement>(BLOCKING).forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  })
  return out
}

const insideRect = (x: number, y: number, r: Rect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

export function FloodLeader({ circle, leader }: { circle: RefObject<HTMLElement | null>; leader: boolean }) {
  const summary = useFlood((s) => openFloodSummary(s))
  const gauges = useFloodOfficial((s) => (summary && s.floodId === summary.id ? s.gauges.data : null))
  const areas = useFloodAreas()
  const target = useMemo(() => leaderTarget(summary, areas.warnings), [summary, areas.warnings])
  const lngLat = useMemo(() => (target ? ([target.lon, target.lat] as const) : null), [target])
  const anchor = useMapAnchor(lngLat)
  const geom = useCircleGeom(circle, leader)
  // what may cover the line changes without a map move
  useSearchUi((s) => s.searchOpen)
  useSearchUi((s) => s.popover)
  useWorkspace((s) => s.selection)
  useWorkspace((s) => s.safeInsets)
  if (!anchor || !anchor.inView || !target) return null
  const rects = blockingRects()
  const covered = rects.some((r) => insideRect(anchor.x, anchor.y, r))
  const gauge = target.kind === 'gauge'
  const stop = gauge ? 13 : 8
  let line: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (leader && geom && !covered) {
    const dx = anchor.x - geom.x
    const dy = anchor.y - geom.y
    const len = Math.hypot(dx, dy)
    if (len > geom.r + 24) {
      const ux = dx / len
      const uy = dy / len
      const a = { x: geom.x + ux * (geom.r + 1), y: geom.y + uy * (geom.r + 1) }
      const b = { x: anchor.x - ux * stop, y: anchor.y - uy * stop }
      if (!rects.some((r) => segmentHitsRect(a, b, r))) line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
    }
  }
  // the same reading as the stage row and the map's label: the newer of the list's and the gauges answer's (WFP-R2);
  // below flood stage the diamond is grey and hollow (D9)
  const tone = gaugeTone(primaryGaugeReading(summary, gauges)?.category ?? null)
  const fill = CATEGORY_COLORS[tone]
  const hollow = tone === 'below'
  return (
    <svg className="pfv-overlay ffv-overlay" width="100%" height="100%" aria-hidden="true" data-leader={target.kind}>
      {line && <line className="ffv-leader" x1={line.x1.toFixed(1)} y1={line.y1.toFixed(1)} x2={line.x2.toFixed(1)} y2={line.y2.toFixed(1)} stroke={FLOOD_TOKENS['m-flood-lead']} strokeWidth="1.5" />}
      {!covered && (
        <g className={`ffv-point is-${target.kind}`} transform={`translate(${anchor.x.toFixed(1)} ${anchor.y.toFixed(1)})`}>
          {gauge ? (
            <>
              <circle r="22" fill={FLOOD_TOKENS['m-flood-lead']} fillOpacity="0.22" />
              <rect
                x="-6.5"
                y="-6.5"
                width="13"
                height="13"
                transform="rotate(45)"
                fill={hollow ? 'none' : fill}
                stroke={hollow ? fill : FLOOD_TOKENS['m-flood-ink-2']}
                strokeWidth={hollow ? 2 : 1.5}
                data-tone={tone}
              />
            </>
          ) : (
            <circle r="6" fill="none" stroke={FLOOD_ALERT} strokeWidth="2" />
          )}
        </g>
      )}
    </svg>
  )
}
