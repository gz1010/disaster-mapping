// The flood legend (brief 5, PLAN-5 §4.3): MapLegend's variants for the flood layers. On the national map in Floods: the
// flood marker sizes (by the official level and category, never Fire-3d's inference), groups "N FLOODS", watches and
// past floods (hollow), the gauge category diamonds with their names (never colour alone, never green), the short
// list-absence line, then "Legend details". In a flood view also "NWS warning area" (the alert pink). Never a model entry
// here (model output is shown and keyed only in Command, switched on). Variants: 'row' (the overview's details),
// 'chips' (Command's bottom row, with the scale), 'key' (only the details button, for the Public flood view's own key),
// 'panel' (inline, the Layers panel below 1200 px).
// Brief 5 web-flood-command: with a flood open, 'chips' are the Command flood view's chips (PLAN-5 §4.5): water seen by
// satellite with its date, no satellite view, the NWS forecast flooded area, the NWS warning area, the four gauge
// diamonds, and, only while switched on, the FEMA floodplain, the NWS category flood map (experimental) and the model
// (NWM, experimental; its own amber dotted swatch, never a water colour); the selected location; the scale. The
// details then also explain the model and the category map (their own caveats).
import { ChevronDown, Info } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { openFloodSummary, useFlood } from '../state/flood'
import { useShallow } from 'zustand/react/shallow'
import { useFloodOfficial } from '../official/floodHooks'
import { answerState, fimMapped, shownGranule } from '../official/floodModel'
import { useFloodLayerData } from '../state/floodLayerData'
import { useWorkspace } from '../state/workspace'
import { fmtDayDate } from '../lib/time'
import { satLoginNote } from '../ui/public/floodView'
import {
  CATFIM_LABEL,
  FLOOD_COMMAND,
  MODEL_CAVEAT,
  MODEL_LABEL,
  FLOOD_LIST_ABSENCE,
  FLOOD_LIST_ABSENCE_SHORT,
  FLOOD_OVERVIEW,
  FLOOD_PUBLIC,
  fillCopy,
  GAUGE_CATEGORY_DISPLAY,
  NFHL_NOTE,
  NOT_ALL_CLEAR,
  RFC_FIM_LABEL,
  RFC_FIM_NOTE,
  RFC_FIM_UNAVAILABLE,
  SAT_EDGE,
  SAT_NO_VIEW_KEY,
  SAT_UNAVAILABLE,
} from '../ui/shell/floodCopy'
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
  const gaugesDown = useNationalGauges(nationalGaugesDown) && gaugesOn && !floodOpen
  // a flood view: what each of its layers is (the backend's own caveats; brief 5 web-flood-public)
  const view = useFloodOfficial(useShallow((s) => ({ satellite: s.satellite.data, fim: s.fim.data, nfhl: s.nfhl.data })))
  // a request that failed with no answer still gets its line (review WFP-R1): never a layer that silently vanishes
  const failed = useFloodOfficial(
    useShallow((s) => ({
      satellite: !s.satellite.data && answerState(s.satellite) === 'unavailable' ? s.satellite.error : null,
      fim: !s.fim.data && answerState(s.fim) === 'unavailable' ? s.fim.error : null,
    })),
  )
  const floodplainOn = useFlood((s) => s.layers.floodplain)
  const layers = useFlood((s) => s.layers)
  const zone = useFlood((s) => openFloodSummary(s)?.time_zone ?? 'UTC')
  const extra = useFloodLayerData(useShallow((s) => ({ model: s.model.data, highFlow: s.highFlow.data, catfim: s.catfim.data })))
  const hasSel = useWorkspace((s) => s.selection != null)
  const login = floodOpen ? satLoginNote(view.satellite) : null
  const granule = shownGranule(view.satellite)
  const viewChips = (
    <ul className="fxm-legend-row fxo-legend-row cfv-chips" aria-label="Legend">
      {layers.satellite && (
        <li>
          <span className="ffk-sw ffk-sw-sat" aria-hidden="true" />
          <span>{granule && view.satellite?.measured ? fillCopy(FLOOD_COMMAND.chipSatellite, { date: fmtDayDate(granule.acquired_ms, zone) }) : FLOOD_COMMAND.chipSatelliteNone}</span>
        </li>
      )}
      {layers.satellite && granule && view.satellite?.measured && (
        <li>
          <span className="ffk-sw ffk-sw-noview" aria-hidden="true" />
          <span>{FLOOD_COMMAND.chipNoView}</span>
        </li>
      )}
      {layers.forecastArea && fimMapped(view.fim) && (
        <li>
          <span className="ffk-sw ffk-sw-forecast" aria-hidden="true" />
          <span>{FLOOD_COMMAND.chipForecast}</span>
        </li>
      )}
      {layers.warnings && (
        <li>
          <span className="ffk-sw ffk-sw-warning" aria-hidden="true" />
          <span>{FLOOD_COMMAND.chipWarning}</span>
        </li>
      )}
      {layers.gauges &&
        DIAMONDS.map((d) => (
          <Row key={d.tone} sw={`diamond-${d.tone}`} title={`River gauge: ${d.label}`}>
            {d.label.replace(' (NWS)', '').replace(' flooding', '').replace(' stage', '')}
          </Row>
        ))}
      {layers.floodplain && (
        <li>
          <span className="ffk-sw ffk-sw-floodplain" aria-hidden="true" />
          <span>{FLOOD_COMMAND.chipFloodplain}</span>
        </li>
      )}
      {layers.catfim && (
        <li>
          <span className="ffk-sw cfv-sw-catfim" aria-hidden="true" />
          <span>{FLOOD_COMMAND.chipCatfim}</span>
        </li>
      )}
      {layers.model && (
        <li>
          <span className="ffk-sw cfv-sw-model" aria-hidden="true" />
          <span>{FLOOD_COMMAND.chipModel}</span>
        </li>
      )}
      {layers.modelHighFlow && (
        <li>
          <span className="ffk-sw cfv-sw-highflow" aria-hidden="true" />
          <span>{FLOOD_COMMAND.chipHighFlow}</span>
        </li>
      )}
      {hasSel && (
        <li>
          <span className="fxm-sw fxm-sw-selection" aria-hidden="true" />
          <span>{FLOOD_COMMAND.chipSelected}</span>
        </li>
      )}
    </ul>
  )
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
      {floodOpen && view.satellite && (
        <section>
          <h3>
            <span className="ffk-sw ffk-sw-sat" aria-hidden="true" /> {view.satellite.source?.name ?? FLOOD_PUBLIC.layerSatellite}
          </h3>
          {(view.satellite.caveats ?? []).map((c, i) => (
            <p key={i}>{c}</p>
          ))}
          <p>
            <span className="ffk-sw ffk-sw-noview" aria-hidden="true" /> {SAT_NO_VIEW_KEY} · <span className="ffk-sw ffk-sw-edge" aria-hidden="true" /> {SAT_EDGE}
          </p>
          {view.satellite.status === 'unavailable' && <p className="fxm-legend-note ffk-unavailable">{SAT_UNAVAILABLE}</p>}
          {view.satellite.reason && view.satellite.reason !== SAT_UNAVAILABLE && <p className="fxm-legend-note">{view.satellite.reason}</p>}
          {login?.short && <p className="fxm-legend-note ffk-login">{login.short}</p>}
          {login?.long && <p className="fxm-legend-note">{login.long}</p>}
        </section>
      )}
      {floodOpen && !view.satellite && failed.satellite != null && (
        <section>
          <h3>
            <span className="ffk-sw ffk-sw-sat" aria-hidden="true" /> {FLOOD_PUBLIC.layerSatellite}
          </h3>
          <p className="fxm-legend-note ffk-unavailable">{SAT_UNAVAILABLE}</p>
          {failed.satellite && <p className="fxm-legend-note">{failed.satellite}</p>}
        </section>
      )}
      {floodOpen && view.fim && (
        <section>
          <h3>
            <span className="ffk-sw ffk-sw-forecast" aria-hidden="true" /> {RFC_FIM_LABEL}
          </h3>
          <p>{view.fim.coverage_note || RFC_FIM_NOTE}</p>
          {view.fim.outside_note && <p>{view.fim.outside_note}</p>}
          {view.fim.status === 'unavailable' && <p className="fxm-legend-note ffk-unavailable">{RFC_FIM_UNAVAILABLE}</p>}
          {view.fim.status !== 'available' && view.fim.reason && view.fim.reason !== RFC_FIM_UNAVAILABLE && <p className="fxm-legend-note">{view.fim.reason}</p>}
        </section>
      )}
      {floodOpen && !view.fim && failed.fim != null && (
        <section>
          <h3>
            <span className="ffk-sw ffk-sw-forecast" aria-hidden="true" /> {RFC_FIM_LABEL}
          </h3>
          <p>{RFC_FIM_NOTE}</p>
          <p className="fxm-legend-note ffk-unavailable">{RFC_FIM_UNAVAILABLE}</p>
          {failed.fim && <p className="fxm-legend-note">{failed.fim}</p>}
        </section>
      )}
      {floodOpen && (
        <section>
          <h3>
            <span className="ffk-sw ffk-sw-channel" aria-hidden="true" /> {FLOOD_PUBLIC.keyChannel}
          </h3>
          <p>{FLOOD_PUBLIC.channelBody}</p>
        </section>
      )}
      {floodOpen && floodplainOn && (
        <section>
          <h3>
            <span className="ffk-sw ffk-sw-floodplain" aria-hidden="true" /> {view.nfhl?.source?.name ?? 'FEMA'}
          </h3>
          <p>{view.nfhl?.coverage_note || NFHL_NOTE}</p>
          {view.nfhl && view.nfhl.status !== 'available' && view.nfhl.reason && <p className="fxm-legend-note">{view.nfhl.reason}</p>}
        </section>
      )}
      {floodOpen && layers.catfim && (
        <section>
          <h3>
            <span className="ffk-sw cfv-sw-catfim" aria-hidden="true" /> {CATFIM_LABEL}
          </h3>
          {extra.catfim ? (
            <>
              <p>{extra.catfim.coverage_note}</p>
              {extra.catfim.status !== 'available' && extra.catfim.reason && <p className="fxm-legend-note">{extra.catfim.reason}</p>}
              {(extra.catfim.caveats ?? []).map((c, i) => (
                <p key={i} className="fxm-legend-note">
                  {c}
                </p>
              ))}
            </>
          ) : (
            <p className="fxm-legend-note">{FLOOD_PUBLIC.checking}</p>
          )}
        </section>
      )}
      {floodOpen && (layers.model || layers.modelHighFlow) && (
        <section className="cfv-legend-model">
          <h3>
            <span className="ffk-sw cfv-sw-model" aria-hidden="true" /> {extra.model?.label ?? MODEL_LABEL}
          </h3>
          <p>{extra.model?.caveats?.[0] ?? MODEL_CAVEAT}</p>
          {layers.model && extra.model && extra.model.status !== 'available' && extra.model.reason && <p className="fxm-legend-note">{extra.model.reason}</p>}
          {layers.modelHighFlow && (
            <p>
              <span className="ffk-sw cfv-sw-highflow" aria-hidden="true" /> {FLOOD_COMMAND.highFlowBody}
            </p>
          )}
          {layers.modelHighFlow && extra.highFlow && extra.highFlow.status !== 'available' && extra.highFlow.reason && <p className="fxm-legend-note">{extra.highFlow.reason}</p>}
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
        {!key && (chips && floodOpen ? viewChips : compact)}
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
