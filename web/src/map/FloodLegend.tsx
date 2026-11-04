// The flood legend (brief 5, PLAN-5 §4.3): MapLegend's variants for the flood layers. On the national map in Floods: the
// flood marker sizes (by the official level and category, never Fire-3d's inference), groups "N FLOODS", watches and
// past floods (hollow), the gauge category diamonds with their names (never colour alone, never green), the short
// list-absence line, then "Legend details". In a flood view also "NWS warning area" (the alert pink). Never a model entry
// here (model output is shown and keyed only in Command, switched on). Variants: 'row' (the overview's details),
// 'chips' (Command's bottom row, with the scale), 'key' (only the details button, for the Public flood view's own key),
// 'panel' (inline, the Layers panel below 1200 px).
import { ChevronDown, Info } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useFlood } from '../state/flood'
import { FLOOD_LIST_ABSENCE, FLOOD_LIST_ABSENCE_SHORT, FLOOD_OVERVIEW, GAUGE_CATEGORY_DISPLAY, NOT_ALL_CLEAR } from '../ui/shell/floodCopy'
import { nationalGaugesDown, useNationalGauges } from './floodGaugeStatus'
import { ScaleBar } from './MapAttribution'
import type { GaugeTone } from './floodStyle'
import '../styles/flood-overview.css'

export type FloodLegendVariant = 'row' | 'chips' | 'key' | 'panel'

const DIAMONDS: { tone: GaugeTone; label: string }[] = [
  { tone: 'action', label: GAUGE_CATEGORY_DISPLAY.action.short },
  { tone: 'minor', label: GAUGE_CATEGORY_DISPLAY.minor.short },
  { tone: 'moderate', label: GAUGE_CATEGORY_DISPLAY.moderate.short },
  { tone: 'major', label: GAUGE_CATEGORY_DISPLAY.major.short },
]

function Sw({ kind }: { kind: string }) {
  return <span className={`fxo-sw fxo-sw-${kind}`} aria-hidden="true" />
}

function Row({ sw, children, title }: { sw: string; children: ReactNode; title?: string }) {
  return (
    <li title={title}>
      <Sw kind={sw} />
      <span>{children}</span>
    </li>
  )
}

export function FloodLegend({ variant = 'row' }: { variant?: FloodLegendVariant } = {}) {
  const [open, setOpen] = useState(false)
  const floodOpen = useFlood((s) => s.floodId != null)
  const past = useFlood((s) => s.filter !== 'live')
  const watches = useFlood((s) => s.showWatches)
  const gaugesOn = useFlood((s) => s.layers.gauges)
  // the national gauge layer could not be read: only the listed floods' own gauges are drawn (WFO-R8)
  const gaugesDown = useNationalGauges(nationalGaugesDown) && gaugesOn && !floodOpen && !past
  const compact = (
    <ul className="fxm-legend-row fxo-legend-row" aria-label="Legend">
      {!past && <Row sw="flood-large">{FLOOD_OVERVIEW.legendLarge}</Row>}
      {!past && <Row sw="flood-active">{FLOOD_OVERVIEW.legendActive}</Row>}
      {!past && <Row sw="flood-small">{FLOOD_OVERVIEW.legendSmall}</Row>}
      {(past || watches) && <Row sw="flood-other">{past ? FLOOD_OVERVIEW.legendPast : FLOOD_OVERVIEW.legendWatch}</Row>}
      <Row sw="flood-group" title={FLOOD_OVERVIEW.legendGroupTip}>
        Group <span className="fxm-legend-mono fxo-legend-mono">N FLOODS</span>
      </Row>
      {DIAMONDS.map((d) => (
        <Row key={d.tone} sw={`diamond-${d.tone}`} title={`River gauge: ${d.label}`}>
          {d.label.replace(' (NWS)', '')}
        </Row>
      ))}
      {floodOpen && <Row sw="warning">{FLOOD_OVERVIEW.legendWarningArea}</Row>}
      {gaugesDown && (
        <li className="fxm-legend-absence fxo-legend-warn" role="note">
          <span>{FLOOD_OVERVIEW.nationalGaugesDown}</span>
        </li>
      )}
      <li className="fxm-legend-absence" title={FLOOD_LIST_ABSENCE}>
        <span>{FLOOD_LIST_ABSENCE_SHORT}</span>
      </li>
    </ul>
  )
  const details = (
    <div className="fxm-legend-details" id="fxo-legend-details">
      <section>
        <h3>
          <Sw kind="flood-active" /> {FLOOD_OVERVIEW.legendFloodsTitle}
        </h3>
        <p>{FLOOD_OVERVIEW.legendFloodsBody}</p>
      </section>
      <section>
        <h3>
          <Sw kind="diamond-minor" /> {FLOOD_OVERVIEW.legendGaugesTitle}
        </h3>
        <p>{FLOOD_OVERVIEW.legendGaugesBody}</p>
        {gaugesDown && <p className="fxm-legend-note">{FLOOD_OVERVIEW.nationalGaugesDown}</p>}
      </section>
      {floodOpen && (
        <section>
          <h3>
            <Sw kind="warning" /> {FLOOD_OVERVIEW.legendWarningArea}
          </h3>
          <p>{FLOOD_OVERVIEW.legendWarningBody}</p>
        </section>
      )}
      <p className="fxm-legend-note">{FLOOD_LIST_ABSENCE}</p>
      <p className="fxm-legend-note">{NOT_ALL_CLEAR}</p>
    </div>
  )
  if (variant === 'panel')
    return (
      <section className="mw-legend fxm-legend is-inline fxo-legend" aria-label="Map legend">
        {compact}
        {details}
      </section>
    )
  const chips = variant === 'chips'
  const key = variant === 'key'
  return (
    <section className={`mw-legend fxm-legend fxo-legend${chips ? ' is-chips' : ''}${key ? ' is-key' : ''}`} aria-label="Map legend">
      <div className="fxm-legend-anchor">
        {!key && compact}
        {chips && <ScaleBar />}
        <button type="button" className="fxm-legend-toggle" aria-expanded={open} aria-controls="fxo-legend-details" onClick={() => setOpen((o) => !o)} data-tip="What the flood layers mean">
          <Info size={13} aria-hidden="true" />
          <span>{chips || key ? 'Legend details' : 'Details'}</span>
          <ChevronDown size={12} aria-hidden="true" className={open ? 'is-open' : ''} />
        </button>
        {open && <div className="fxm-legend-pop">{details}</div>}
      </div>
    </section>
  )
}
