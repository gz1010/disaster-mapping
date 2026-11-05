// The river-level chart (brief 5, web-flood-command M1; PLAN-5 §4.6, D13, D20, C1, C7, C28; CONTRACT §16.12): one river
// gauge's measured level for the last 72 h, the NWS river forecast to its end, NWS flood levels, and, on the flow axis
// only, the National Water Model as experimental model output. `variant="slim"` is Command's full-width chart under
// the map (a 40 px gauge picker on the left, the line key and the stage / flow switch above, the handle's words, the
// plot, the day ticks); `variant="dock"` is Forensic's 112 px dock (90 px plot, the key folded into the header).
//   - Style and words carry the meaning, never colour alone: observed solid "OBSERVED · USGS", the NWS forecast dashed
//     with its issuer and issue time, the model dotted amber "MODEL · NWM · EXPERIMENTAL".
//   - The handle reads values (brief 5: no play button, D13; brief 6 adds the time steps below). Drag, or keys on the slider (←/→ one hour, Shift six,
//     Home / End); "NOW" brings it back. It sets useFlood.cursorMs: the map, the readout and the point check follow
//     (productsShown: after now they keep the NWS products in effect now and add the ones NWS issued for that time; the
//     chart says CURSOR_FUTURE_PRODUCTS, or CURSOR_FUTURE_ISSUED when one covers the handle's time; C1, WFC-R1).
//   - The handle's words sit in their own row above the plot, sized for the lines shown (the value; the model's line in
//     flow mode); the future note is a wrapped line under them, never cut and never over the plot or the key (WFC-R3).
//   - Flow mode: NWS flow on the handle's first line, the model on its own line (C28); no model without a reach.
//   - Empty states: PLAN-5 §5.5. Nothing animates (reduced motion needs nothing more).
//   - Brief 6 (web-flood-playback, BRIEF-6 decision 2): the flood's time steps (HydrographPlayback.tsx): Play / Pause and
//     Previous / Next above the plot move the handle from satellite pass to NWS product change (no autoplay; reduced
//     motion: one step per press), the step and the gap between passes in words, the passes as marks along the top,
//     the NWS changes as the ticks; while stepping the axis starts at the first step (back to 72 h at now). This
//     replaces brief 5's "no play button" (D13) for floods only.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import type { FloodAlert, RiverGauge } from '../../api/types'
import { HOUR_MS, type TimeFmt } from '../../lib/time'
import { CATEGORY_COLORS, FLOOD_ALERT, FLOOD_TOKENS, gaugeTone } from '../../map/floodStyle'
import { useFloodOfficial } from '../../official/floodHooks'
import { memberGaugesOf, officialAlerts } from '../../official/floodModel'
import { openFloodSummary, useFlood } from '../../state/flood'
import { useTimeFormatFor } from '../../state/timeZone'
import { useWorkspace } from '../../state/workspace'
import { Popover, Segmented } from '../controls'
import { useNow } from '../hooks'
import {
  fillCopy,
  GAUGE_CATEGORY_DISPLAY,
  HYDRO,
  NO_MEMBER_GAUGE,
  NO_MEMBER_GAUGE_SUB,
  type GaugeCategoryKey,
} from '../shell/floodCopy'
import { gaugeKey, gaugeOf, useHydroData, useHydrographData } from './hydrographData'
import { PassMarks, PlayRow } from './HydrographPlayback'
import { usePlaybackView, type PlaybackView } from './hydrographPlaybackView'
import {
  buildHydrograph,
  clampCursor,
  cursorLabel,
  CREST_LABEL_ROOM,
  crestLeft,
  cursorReadout,
  futureProductsNote,
  handleRowHeight,
  HYDRO_GAP_MS,
  listKeyTarget,
  productsShown,
  stepCursor,
  unitLabels,
  xFrac,
  yFrac,
  type CursorReadout,
  type HydroAxis,
  type HydrographModel,
  type HydroPoint,
} from './hydrographModel'
import './hydrograph.css'

export type HydrographVariant = 'slim' | 'dock'

export interface HydrographProps {
  variant: HydrographVariant
  floodId: string
  /** The gauge (NWSLI); null: the flood's primary gauge. */
  lid: string | null
  /** The NWS products whose times are ticked (default: the open flood's flood-alerts answer). */
  products?: readonly FloodAlert[]
  /** The gauges the picker offers (default: the open flood's gauges answer, members first). */
  gauges?: readonly RiverGauge[]
  /** A past flood's time (its answers are asked at that time); null: now. */
  atMs?: number | null
  /** The axis the chart opens on (default the river stage). */
  initialAxis?: HydroAxis
  /** The plot's width before it is measured (server renders, tests); the measured width wins. */
  widthPx?: number
  className?: string
}

/** Right gutter for the NWS level labels ("MODERATE 17.0"; 92 px so the dock never cuts the last digit, integration). */
const GUTTER = 92
const PAD_Y = 5
const PLOT_H: Record<HydrographVariant, number> = { slim: 76, dock: 78 }

export function Hydrograph({ variant, floodId, lid, products, gauges, atMs = null, initialAxis = 'stage', widthPx = 0, className }: HydrographProps) {
  const summary = useFlood((s) => (s.floodId === floodId ? openFloodSummary(s) : null))
  const offGauges = useFloodOfficial((s) => (s.floodId === floodId ? s.gauges.data : null))
  const offAlerts = useFloodOfficial((s) => (s.floodId === floodId ? s.alerts.data : null))
  const units = useWorkspace((s) => s.units)
  const [axis, setAxis] = useState<HydroAxis>(initialAxis)
  const pickerGauges = useMemo(() => gauges ?? officialGauges(offGauges, summary), [gauges, offGauges, summary])
  const resolved = lid ?? summary?.primary_gauge?.lid ?? pickerGauges.find((g) => g.member)?.lid ?? null
  const listed = pickerGauges.find((g) => g.lid === resolved) ?? null
  // the model only in flow mode, and only for a gauge with an NWM reach (D20, C28)
  const cached = useHydroData((s) => (resolved ? gaugeOf(s.gauges[gaugeKey(resolved, atMs)]?.data, resolved) : null))
  const reach = (cached ?? listed)?.reach_id ?? null
  const wantModel = axis === 'flow' && reach != null
  const data = useHydrographData(floodId, resolved, { wantModel, atMs })
  const gauge = resolved ? gaugeOf(data.gauge.data, resolved) : null
  const tf = useTimeFormatFor(gauge?.time_zone ?? summary?.time_zone)
  // the flood's zone for satellite pass times (NWS products keep their own zones)
  const floodTf = useTimeFormatFor(summary?.time_zone ?? gauge?.time_zone)
  const wall = useNow(60_000)
  const nowMs = atMs ?? wall
  const pb = usePlaybackView(floodId, nowMs, atMs != null, floodTf)
  const prods = useMemo(() => products ?? officialAlerts(offAlerts), [products, offAlerts])
  const [plotRef, measured] = useWidth()
  const plotW = Math.max(0, (measured || widthPx) - GUTTER)
  const model = useMemo(
    () =>
      gauge && plotW > 40
        ? buildHydrograph({
            gauge,
            model: axis === 'flow' ? (data.model?.data ?? null) : null,
            modelLoading: data.model?.loading === true,
            products: prods,
            nowMs,
            widthPx: plotW,
            axis,
            units,
            zone: tf.tz,
            clock: tf.clock,
            past: atMs != null,
            startMs: pb.startMs,
            ticks: pb.ticks,
          })
        : null,
    [gauge, axis, data.model, prods, nowMs, plotW, units, tf, atMs, pb.startMs, pb.ticks],
  )
  const cls = `hg is-${variant}${className ? ` ${className}` : ''}`
  // a `?lid=` answer does not know the flood: membership comes from the flood's own lists
  const isMember = resolved != null && (summary?.primary_gauge?.lid === resolved || (summary?.gauges ?? []).some((g) => g.lid === resolved) || listed?.member === true)
  const isNearby = resolved != null && !isMember && listed != null
  const name = gauge ? `${gauge.lid} · ${gauge.name}` : (listed ? `${listed.lid} · ${listed.name}` : resolved) ?? ''
  const picker = variant === 'slim' ? <GaugePicker gauges={pickerGauges} lid={resolved} floodId={floodId} /> : null

  if (!resolved) {
    return (
      <section className={`${cls} is-empty`} aria-label={HYDRO.title}>
        {picker}
        <div className="hg-body">
          <PlayRow view={pb} variant={variant} />
          <p className="hg-empty">
            <strong>{NO_MEMBER_GAUGE}</strong> · {NO_MEMBER_GAUGE_SUB}
          </p>
        </div>
      </section>
    )
  }
  const state = data.gauge.data ? data.gauge.data.status : data.gauge.loading || !data.gauge.error ? 'loading' : 'failed'
  const problem = state === 'loading' ? HYDRO.loading : state === 'failed' ? HYDRO.unavailable : state !== 'available' ? (data.gauge.data?.reason ?? HYDRO.unavailable) : gauge ? null : HYDRO.unavailable
  return (
    <section className={cls} aria-label={`${HYDRO.title}: ${name}`}>
      {picker}
      <div className="hg-body">
        <HydroTop variant={variant} name={name} model={model} axis={axis} setAxis={setAxis} units={units} nearby={isNearby} />
        <PlayRow view={pb} variant={variant} />
        {problem ? (
          <div className="hg-plot is-empty" ref={plotRef} style={{ height: PLOT_H[variant] }}>
            <p className="hg-empty" title={data.gauge.error ?? undefined}>
              {problem}
            </p>
          </div>
        ) : (
          <HydroChart variant={variant} model={model} tf={tf} plotRef={plotRef} plotW={plotW} past={atMs != null} products={prods} pb={pb} />
        )}
      </div>
    </section>
  )
}

/** The picker's gauges: the flood's members (primary first), then nearby gauges. */
function officialGauges(resp: Parameters<typeof memberGaugesOf>[0], summary: Parameters<typeof memberGaugesOf>[1]): RiverGauge[] {
  const members = memberGaugesOf(resp, summary)
  const all = resp && typeof resp === 'object' && (resp as { status?: string }).status === 'available' ? ((resp as { gauges?: RiverGauge[] }).gauges ?? []) : []
  return [...members, ...all.filter((g) => !g.member)]
}

// ------------------------------------------------------------------------------------------------ the top line
function HydroTop({
  variant,
  name,
  model,
  axis,
  setAxis,
  units,
  nearby,
}: {
  variant: HydrographVariant
  name: string
  model: HydrographModel | null
  axis: HydroAxis
  setAxis: (a: HydroAxis) => void
  units: 'us' | 'metric'
  nearby: boolean
}) {
  const stageUnit = unitLabels('stage', units).unit
  const flowUnit = unitLabels('flow', units).unit
  return (
    <div className="hg-top">
      <span className="hg-name" title={name}>
        {name}
        {nearby && <span className="hg-tag">{HYDRO.pickerNearbyTag}</span>}
      </span>
      {model && (
        <span className="hg-key" aria-label="Chart lines">
          {/* a stage-only gauge on the flow axis has no measured line to key (review WFC-R5) */}
          {!model.stageOnly && (
            <span className="hg-key-item is-observed">
              <LineGlyph kind="observed" />
              {model.observedLabel}
            </span>
          )}
          {/* the NWS forecast keeps its issuer and its own issue time in both variants (review WFC-R11) */}
          {model.forecastLabel && (
            <span className="hg-key-item is-forecast" title={model.forecastLabel}>
              <LineGlyph kind="forecast" />
              {variant === 'dock' ? (model.forecastLabelShort ?? model.forecastLabel) : model.forecastLabel}
            </span>
          )}
          {model.axis === 'flow' && model.modelState === 'available' && (
            <span className="hg-key-item is-model" data-tip={HYDRO.modelTip}>
              <LineGlyph kind="model" />
              {model.modelLabel}
            </span>
          )}
        </span>
      )}
      <Segmented
        size="sm"
        className="hg-axis-switch"
        ariaLabel={HYDRO.axisName}
        value={axis}
        onChange={setAxis}
        options={[
          { value: 'stage', label: fillCopy(HYDRO.stage, { unit: stageUnit }).toUpperCase() },
          { value: 'flow', label: fillCopy(HYDRO.flow, { unit: flowUnit }).toUpperCase(), tip: HYDRO.modelTip },
        ]}
      />
    </div>
  )
}

function LineGlyph({ kind }: { kind: 'observed' | 'forecast' | 'model' }) {
  return (
    <svg className="hg-glyph" width="18" height="6" aria-hidden="true" focusable="false">
      <line x1="1" x2="17" y1="3" y2="3" className={`hg-line is-${kind}`} />
    </svg>
  )
}

// ------------------------------------------------------------------------------------------------ the chart
function HydroChart({
  variant,
  model,
  tf,
  plotRef,
  plotW,
  past,
  products,
  pb,
}: {
  variant: HydrographVariant
  model: HydrographModel | null
  tf: TimeFmt
  plotRef: (el: HTMLDivElement | null) => void
  plotW: number
  past: boolean
  products: readonly FloodAlert[]
  pb: PlaybackView
}) {
  const cursorMs = useFlood((s) => s.cursorMs)
  const helpId = useId()
  const H = PLOT_H[variant]
  const readout = model ? cursorReadout(model, cursorMs, tf) : null
  const tx = model ? clampX(xFrac(model, readout!.t) * plotW, plotW) : 0
  // after now: the products the map keeps, and whether NWS issued one for the handle's time (C1; review WFC-R1)
  const futureNote = model && readout?.future ? futureProductsNote(productsShown(products, cursorMs, model.nowMs)) : null
  return (
    <>
      <HandleRow variant={variant} readout={readout} x={tx} plotW={plotW} />
      {futureNote && (
        <p className="hg-future-note" aria-live="polite">
          {futureNote}
        </p>
      )}
      <div className="hg-plot" ref={plotRef} style={{ height: H }}>
        {model && readout && (
          <>
            <Plot model={model} readout={readout} width={plotW} height={H} pb={pb} cursorMs={cursorMs} />
            <PlotOverlays model={model} plotW={plotW} height={H} past={past} />
            <Slider model={model} readout={readout} plotW={plotW} height={H} helpId={helpId} futureNote={futureNote} />
          </>
        )}
      </div>
      {model && <AxisRow model={model} plotW={plotW} />}
      <span id={helpId} className="hg-sr">
        {HYDRO.sliderHelp}
      </span>
    </>
  )
}

const clampX = (x: number, w: number) => Math.min(w, Math.max(0, x))

/** The width of an element given by a callback ref (the plot's element changes between the loading and the chart
 *  states, so the observer follows the element, unlike ui/hooks.ts useElementSize). */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(0)
  const ro = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect()
    ro.current = null
    if (!el) return
    const update = (x: number) => setW((p) => (Math.abs(p - x) < 0.5 ? p : x))
    update(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    ro.current = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr) update(cr.width)
    })
    ro.current.observe(el)
  }, [])
  return [ref, w]
}

/** The handle's words above the plot, at the handle: the time and value; the model on its own line (flow). The row is
 *  sized for its lines, so nothing spills over the plot (review WFC-R3); the future note is its own wrapped line. */
function HandleRow({ variant, readout, x, plotW }: { variant: HydrographVariant; readout: CursorReadout | null; x: number; plotW: number }) {
  const lines = readout?.modelLine ? 2 : 1
  const height = handleRowHeight(variant, readout)
  const row = `hg-handle-row${variant === 'dock' ? ' is-dock' : ''}`
  if (!readout) return <div className={row} style={{ height }} />
  const align = x < 170 ? 'is-start' : x > plotW - 170 ? 'is-end' : ''
  const style = { left: align === 'is-start' ? 0 : align === 'is-end' ? undefined : x, right: align === 'is-end' ? 0 : undefined }
  const cls = readout.kind === 'forecast' ? 'is-forecast' : readout.kind === 'none' ? 'is-none' : readout.stale ? 'is-stale' : 'is-observed'
  const tip = [readout.interpolated ? HYDRO.interpolated : null, readout.original].filter(Boolean).join(' ')
  return (
    <div className={row} style={{ height }} data-lines={lines} aria-live="polite">
      <span className={`hg-handle-label ${align}`} style={style} title={tip || undefined}>
        <span className="hg-hl-line">
          <time dateTime={new Date(readout.t).toISOString()}>{readout.timeText}</time>
          <span className={`hg-hl-value ${cls}`}> · {readout.line1}</span>
        </span>
        {readout.modelLine && <span className="hg-hl-line is-model">{readout.modelLine}</span>}
      </span>
    </div>
  )
}

/** A series as SVG path data, broken at gaps in the record. */
function pathOf(points: readonly HydroPoint[], m: HydrographModel, w: number, h: number, gapMs = HYDRO_GAP_MS): string {
  let d = ''
  let prev: HydroPoint | null = null
  for (const p of points) {
    const x = xFrac(m, p.t) * w
    const y = PAD_Y + yFrac(m, p.v) * (h - 2 * PAD_Y)
    d += `${!prev || p.t - prev.t > gapMs ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    prev = p
  }
  return d
}

function Plot({ model: m, readout, width, height, pb, cursorMs }: { model: HydrographModel; readout: CursorReadout; width: number; height: number; pb: PlaybackView; cursorMs: number | null }) {
  const y = (v: number) => PAD_Y + yFrac(m, v) * (height - 2 * PAD_Y)
  const x = (t: number) => xFrac(m, t) * width
  const nowX = x(m.nowMs)
  const hx = clampX(x(readout.t), width)
  // pinned levels stack from the edge outwards: the highest at the top, the lowest at the bottom
  const pinnedRank: Record<string, number> = {}
  for (const dir of ['above', 'below'] as const) {
    const list = m.thresholds.filter((t) => t.pinned === dir).sort((a, b) => (dir === 'above' ? b.value - a.value : a.value - b.value))
    list.forEach((t, i) => (pinnedRank[t.level] = i))
  }
  // the labels on their lines start under the levels pinned to the top (brief 6: a small river range put "MINOR 2.0"
  // over "MODERATE 4.0 ↑")
  const pinnedAbove = m.thresholds.filter((t) => t.pinned === 'above').length
  const labels = spreadLevelLabels(
    m.thresholds.filter((t) => !t.pinned).map((t) => ({ key: t.level, y: y(t.value) })),
    height,
    pinnedAbove ? 6 + pinnedAbove * 10 : Number.NEGATIVE_INFINITY,
  )
  return (
    <svg className="hg-svg" width={width + GUTTER} height={height} role="img" aria-label={plotLabel(m)}>
      {/* faint bands above minor; none below action */}
      {m.bands.map((b) => {
        const top = y(Math.min(b.to, m.vMax))
        const bottom = y(Math.max(b.from, m.vMin))
        if (bottom <= top) return null
        return <rect key={b.level} x={0} y={top} width={width} height={bottom - top} fill={CATEGORY_COLORS[b.level]} opacity={0.08} />
      })}
      {/* the future (after now): a faint wash */}
      <rect x={nowX} y={0} width={Math.max(0, width - nowX)} height={height} className="hg-future" />
      {m.dayTicks.map((d) => (
        <line key={d.t} x1={x(d.t)} x2={x(d.t)} y1={0} y2={height} className="hg-day" />
      ))}
      {m.thresholds.map((t) => {
        const color = CATEGORY_COLORS[t.level]
        const tip = fillCopy(HYDRO.stageLineTip, { category: t.level, value: t.label.split(' ')[1] ?? '', unit: m.unitWord })
        if (t.pinned) {
          const i = pinnedRank[t.level] ?? 0
          const ly = t.pinned === 'above' ? 9 + i * 10 : height - 3 - i * 10
          return (
            <text key={t.level} x={width + 6} y={ly} className="hg-level is-pinned" fill={color}>
              <title>{`${tip} ${fillCopy(HYDRO.pinnedTip, { dir: t.pinned })}`}</title>
              {t.label}
            </text>
          )
        }
        const ly = labels[t.level] ?? y(t.value)
        return (
          <g key={t.level}>
            <line x1={0} x2={width} y1={y(t.value)} y2={y(t.value)} stroke={color} className="hg-level-line" />
            <text x={width + 6} y={ly + 3} className="hg-level" fill={color}>
              <title>{tip}</title>
              {t.label}
            </text>
          </g>
        )
      })}
      <line x1={nowX} x2={nowX} y1={0} y2={height} className="hg-now" />
      {m.model.map((l) => (
        <path key={l.name} d={pathOf(l.points, m, width, height)} className={`hg-line is-model is-${l.name}`} fill="none">
          <title>{`${m.modelLabel} · ${HYDRO.modelTip}`}</title>
        </path>
      ))}
      {m.forecast.length > 1 && <path d={pathOf(m.forecast, m, width, height, Number.POSITIVE_INFINITY)} className="hg-line is-forecast" fill="none" />}
      {m.observed.length > 0 && <path d={pathOf(m.observed, m, width, height)} className="hg-line is-observed" fill="none" />}
      {m.latest && <circle cx={x(m.latest.t)} cy={y(m.latest.v)} r={2.6} className={`hg-latest${m.latest.stale ? ' is-stale' : ''}`} />}
      {m.crest && (
        <path
          d={`M${x(m.crest.t) - 4} ${y(m.crest.v) - 8}L${x(m.crest.t) + 4} ${y(m.crest.v) - 8}L${x(m.crest.t)} ${y(m.crest.v) - 3}Z`}
          className={`hg-crest${m.crest.atEnd || m.crest.falling || m.crest.passed ? ' is-end' : ''}`}
        >
          <title>{crestTip(m.crest)}</title>
        </path>
      )}
      {m.productTicks.map((p, i) => (
        <line key={`${p.t}-${i}`} x1={x(p.t)} x2={x(p.t)} y1={height - 7} y2={height} stroke={FLOOD_ALERT} className={`hg-product${p.emergency ? ' is-emergency' : ''}`}>
          <title>{p.label}</title>
        </line>
      ))}
      {/* the satellite passes (brief 6): filled where NASA saw something, hollow grey where it saw nothing */}
      <PassMarks view={pb} model={m} width={width} cursorMs={cursorMs} />
      {/* the handle */}
      <line x1={hx} x2={hx} y1={0} y2={height} className="hg-cursor" />
      {readout.kind !== 'none' && (() => {
        const v = readoutValue(m, readout.t)
        return v != null ? <circle cx={hx} cy={y(v)} r={4.5} className="hg-thumb" /> : null
      })()}
    </svg>
  )
}

/** The plotted value at the handle (for the thumb). */
function readoutValue(m: HydrographModel, t: number): number | null {
  const pick = (pts: readonly HydroPoint[]) => {
    if (!pts.length || t < pts[0].t || t > pts[pts.length - 1].t) return null
    let i = 1
    while (i < pts.length && pts[i].t < t) i++
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i)]
    if (b.t === a.t) return a.v
    return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t)
  }
  return (m.latest && t <= m.latest.t ? pick(m.observed) : null) ?? pick(m.forecast)
}

/** Level labels at least 10 px apart (sorted top to bottom, pushed down, then kept inside). */
function spreadLevelLabels(items: { key: string; y: number }[], height: number, minY = Number.NEGATIVE_INFINITY): Record<string, number> {
  const sorted = [...items].sort((a, b) => a.y - b.y)
  const out: Record<string, number> = {}
  let last = minY - 10
  for (const it of sorted) {
    const yy = Math.max(it.y, last + 10)
    out[it.key] = Math.min(yy, height - 4)
    last = yy
  }
  return out
}

function plotLabel(m: HydrographModel): string {
  const parts = [`${m.name} (${m.lid})`, m.observedLabel.toLowerCase(), m.forecastLabel?.toLowerCase(), m.modelState === 'available' ? m.modelLabel.toLowerCase() : null]
  if (m.latest) parts.push(m.latest.label.toLowerCase())
  if (m.crest) parts.push(m.crest.label.toLowerCase())
  return parts.filter(Boolean).join('; ')
}

/** Words over the plot: NOW (back to now), the crest or "high at the end", the empty-state notes. */
function PlotOverlays({ model: m, plotW, height, past }: { model: HydrographModel; plotW: number; height: number; past: boolean }) {
  const cursor = useFlood((s) => s.cursorMs)
  const nowX = xFrac(m, m.nowMs) * plotW
  const crestX = m.crest ? xFrac(m, m.crest.t) * plotW : null
  const crestY = m.crest ? PAD_Y + yFrac(m, m.crest.v) * (height - 2 * PAD_Y) : 0
  // the label sits above the caret; a crest near the plot's top has no room there, so the label goes beside the caret
  const crestAt = m.crest && crestX != null ? crestLeft(m.crest.label, crestX, nowX, plotW, crestY < CREST_LABEL_ROOM) : null
  return (
    <>
      <button
        type="button"
        className={`hg-nowbtn${cursor == null ? ' is-current' : ''}`}
        style={{ left: nowX }}
        onClick={() => useFlood.getState().setCursor(null)}
        aria-label={past ? HYDRO.backToPastRef : HYDRO.backToNow}
        data-tip={past ? HYDRO.backToPastRef : HYDRO.backToNow}
      >
        {(past ? HYDRO.pastRef : HYDRO.now).toUpperCase()}
      </button>
      {m.crest && crestX != null && crestAt != null && (
        <span
          className={`hg-crest-label${m.crest.atEnd ? ' is-end' : ''}`}
          style={{ left: crestAt, top: Math.max(0, crestY - 22) }}
          title={crestTip(m.crest)}
        >
          {m.crest.label}
        </span>
      )}
      {m.empty.length > 0 && (
        <span className="hg-notes" title={m.modelReason ?? undefined}>
          {m.empty.join(' · ')}
        </span>
      )}
    </>
  )
}

/** The crest mark's tooltip: a crest, the forecast high still rising at its end (C7), or the highest value of a falling
 *  forecast (its first step, below the latest reading: not a peak still to come; review WFC-R14). */
function crestTip(c: NonNullable<HydrographModel['crest']>): string {
  return c.atEnd ? HYDRO.highAtEndTip : c.falling ? HYDRO.highestFallingTip : c.passed ? HYDRO.highestPassedTip : HYDRO.crestTip
}

/** The handle as a slider over the plot: drag or keys; aria-valuetext is the handle's words. */
function Slider({ model: m, readout, plotW, height, helpId, futureNote }: { model: HydrographModel; readout: CursorReadout; plotW: number; height: number; helpId: string; futureNote: string | null }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)
  const set = (t: number | null) => useFlood.getState().setCursor(t)
  const fromEvent = (e: RPointerEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, plotW)))
    const t = m.startMs + f * (m.endMs - m.startMs)
    // within 6 px of now: back to now (null), so the views follow the clock again
    const snap = ((m.endMs - m.startMs) / Math.max(1, plotW)) * 6
    set(Math.abs(t - m.nowMs) <= snap ? null : Math.round(t / 60_000) * 60_000)
  }
  const onKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    const cur = useFlood.getState().cursorMs
    const next = stepCursor(m, cur, e.key, e.shiftKey)
    if (next == null) return
    e.preventDefault()
    set(Math.abs(next - m.nowMs) < HOUR_MS / 2 && cur != null && Math.abs(cur - m.nowMs) >= HOUR_MS / 2 ? null : next)
  }
  return (
    <div
      ref={ref}
      className="hg-slider"
      style={{ width: plotW, height }}
      role="slider"
      tabIndex={0}
      aria-label={HYDRO.sliderName}
      aria-describedby={helpId}
      aria-valuemin={m.startMs}
      aria-valuemax={m.endMs}
      aria-valuenow={clampCursor(m, readout.t)}
      aria-valuetext={[cursorLabel(readout), readout.modelLine, futureNote].filter(Boolean).join('. ')}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        fromEvent(e)
      }}
      onPointerMove={(e) => {
        if (dragging.current) fromEvent(e)
      }}
      onPointerUp={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
    />
  )
}

/** The day labels that fit: inside `maxRight`, clear of LATEST's span, each clear of the last one kept. */
function dayLabels<T extends { x: number; label: string }>(days: readonly T[], maxRight: number, latest: [number, number] | null): T[] {
  const out: T[] = []
  let lastRight = Number.NEGATIVE_INFINITY
  for (const d of days) {
    const w = d.label.length * 6.4 + 6
    if (d.x + w > maxRight || d.x < lastRight + 8) continue
    if (latest && d.x + w > latest[0] && d.x < latest[1]) continue
    out.push(d)
    lastRight = d.x + w
  }
  return out
}

/** Under the plot: day labels at local midnights (the gauge's zone) and LATEST <time> · <age> (+ STALE). */
function AxisRow({ model: m, plotW }: { model: HydrographModel; plotW: number }) {
  const latestX = m.latest ? xFrac(m, m.latest.t) * plotW : null
  const latestW = m.latest ? m.latest.label.length * 6.4 + 8 : 0
  const latestLeft = latestX != null ? Math.min(plotW - latestW, Math.max(0, latestX - latestW / 2)) : null
  // each label clears the last one kept (brief 6: the wider axis while stepping has days narrower than a label, and
  // comparing with the previous day dropped every label)
  const days = dayLabels(m.dayTicks.map((d) => ({ ...d, x: xFrac(m, d.t) * plotW })), plotW + GUTTER, latestLeft != null ? [latestLeft - 4, latestLeft + latestW + 4] : null)
  return (
    <div className="hg-axis">
      {days.map((d) => (
        <span key={d.t} className="hg-dayl" style={{ left: d.x }}>
          {d.label}
        </span>
      ))}
      {m.latest && latestLeft != null && (
        <span className={`hg-latestl${m.latest.stale ? ' is-stale' : ''}`} style={{ left: latestLeft }} title={HYDRO.latestTip}>
          {m.latest.label}
        </span>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ the gauge picker
/** The list of the flood's gauges (members first, then nearby gauges labelled "not part of this flood"); picking one
 *  shows it in the river-level chart (useFlood.setGauge). Used by the chart's picker and Command's bar gauge line. */
export function GaugeList({ floodId, lid, gauges, onPick, onClose }: { floodId: string; lid: string | null; gauges?: readonly RiverGauge[]; onPick?: () => void; onClose?: () => void }) {
  const summary = useFlood((s) => (s.floodId === floodId ? openFloodSummary(s) : null))
  const offGauges = useFloodOfficial((s) => (s.floodId === floodId ? s.gauges.data : null))
  const list = useMemo(() => gauges ?? officialGauges(offGauges, summary), [gauges, offGauges, summary])
  const members = list.filter((g) => g.member)
  const nearby = list.filter((g) => !g.member)
  const box = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const options = () => Array.from(box.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
  // opened: the focus moves to the current gauge (else the first), once the popover is placed and visible (WFC-R10);
  // a timer, not an animation frame, so a busy map's slow frames never leave the focus on the opener
  useEffect(() => {
    let tries = 0
    let timer = 0
    const focus = () => {
      const all = options()
      const target = all.find((o) => o.getAttribute('aria-selected') === 'true') ?? all[0]
      target?.focus()
      if (target && document.activeElement !== target && tries++ < 10) timer = window.setTimeout(focus, 30)
    }
    timer = window.setTimeout(focus, 0)
    return () => window.clearTimeout(timer)
  }, [])
  const pick = (g: RiverGauge) => {
    if (useFlood.getState().floodId === floodId) useFlood.getState().setGauge(g.lid)
    onPick?.()
  }
  const onKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
      return
    }
    const all = options()
    const next = listKeyTarget(e.key, all.indexOf(document.activeElement as HTMLButtonElement), all.length)
    if (next == null) return
    e.preventDefault()
    all[next]?.focus()
  }
  // one tab stop: the current gauge, else the first one listed
  const tabLid = list.some((g) => g.lid === lid) ? lid : ((members[0] ?? nearby[0])?.lid ?? null)
  return (
    <div role="listbox" aria-label={HYDRO.pickGauge} ref={box} onKeyDown={onKey}>
      {[
        { title: HYDRO.pickerMembers, list: members, key: 'members' },
        { title: HYDRO.pickerNearby, list: nearby, key: 'nearby' },
      ].map(
        (grp) =>
          grp.list.length > 0 && (
            <div key={grp.title} role="group" aria-labelledby={`${titleId}-${grp.key}`}>
              <p className="hg-picker-title" id={`${titleId}-${grp.key}`}>
                {grp.title}
              </p>
              {grp.list.map((g) => {
                const cat = (g.observed.category in GAUGE_CATEGORY_DISPLAY ? g.observed.category : 'unknown') as GaugeCategoryKey
                return (
                  <button
                    key={g.lid}
                    type="button"
                    role="option"
                    aria-selected={g.lid === lid}
                    tabIndex={g.lid === tabLid ? 0 : -1}
                    className={`hg-picker-item${g.lid === lid ? ' is-current' : ''}`}
                    onClick={() => pick(g)}
                  >
                    <Diamond tone={gaugeTone(g.observed.category)} size={10} />
                    <span className="hg-picker-name">
                      <strong>{g.lid}</strong> · <span data-verbatim="">{g.name}</span>
                    </span>
                    <span className="hg-picker-cat">{GAUGE_CATEGORY_DISPLAY[cat].short}</span>
                  </button>
                )
              })}
            </div>
          ),
      )}
    </div>
  )
}

/** The slim chart's 40 px button: the gauge's category diamond; opens GaugeList. */
function GaugePicker({ gauges, lid, floodId }: { gauges: readonly RiverGauge[]; lid: string | null; floodId: string }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement | null>(null)
  // a pick or Escape returns the focus to this button (review WFC-R10)
  const close = useCallback(() => {
    setOpen(false)
    anchor.current?.focus()
  }, [])
  const current = gauges.find((g) => g.lid === lid) ?? null
  const tone = gaugeTone(current?.observed.category)
  const label = `${HYDRO.pickGauge}${lid ? ` (${lid})` : ''}`
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="hg-pick"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-tip={label}
        disabled={gauges.length === 0}
        onClick={() => setOpen((o) => !o)}
      >
        <Diamond tone={tone} size={12} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="top-start" width={340} className="hg-picker" label={HYDRO.pickGauge}>
        <GaugeList floodId={floodId} lid={lid} gauges={gauges} onPick={close} onClose={close} />
      </Popover>
    </>
  )
}

/** A category diamond (hollow grey below flood stage, "?"-grey when not defined; never green, D9). */
export function Diamond({ tone, size }: { tone: ReturnType<typeof gaugeTone>; size: number }) {
  const c = CATEGORY_COLORS[tone]
  const hollow = tone === 'below'
  const h = size / 2
  return (
    <svg width={size + 2} height={size + 2} viewBox={`-1 -1 ${size + 2} ${size + 2}`} aria-hidden="true" focusable="false" className="hg-diamond">
      <path d={`M${h} 0L${size} ${h}L${h} ${size}L0 ${h}Z`} fill={hollow ? 'none' : c} stroke={hollow ? c : FLOOD_TOKENS['m-flood-ink']} strokeWidth={hollow ? 1.4 : 0.6} />
    </svg>
  )
}

