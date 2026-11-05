// The 3D flood view's Layers tab (brief 5, PLAN-5 §4.7, D12, D21, D22): the fire Layers tab's look (ui/LayersTab.tsx,
// .layers / .lg / .lrow) with the flood's groups. Base: Terrain, Aerial photo (NAIP, "taken before this flood"), FEMA
// floodplain (off; "effective {date}"). Water: satellite, NWS forecast area, NWS warning areas, gauges, NWS category
// flood maps (experimental, off). Model: NWM flooded area (experimental, off). Parametric: Contours, Telemetry labels.
// A layer the bundle could not make is greyed with the backend's own reason. The switches are Forensic's own
// (forensicFloodState.ts).
import { Eye, EyeOff, RotateCcw } from 'lucide-react'
import { fmtDayDate } from '../../lib/time'
import { floodAssetStore } from '../../scene/flood/floodAssets'
import { useTimeFormat } from '../../state/timeZone'
import { Checkbox, Slider } from '../controls'
import { FLOOD_FORENSIC_DEFAULTS, useForensicFlood, type FloodForensicLayer } from './forensicFloodState'
import { FLOOD_FORENSIC } from './floodForensicCopy'
import { layerUnavailable } from './floodForensicView'

interface Row {
  key: FloodForensicLayer
  label: string
  tip: string
  exp?: boolean
}

const GROUPS: { id: string; label: string; rows: Row[] }[] = [
  {
    id: 'base',
    label: FLOOD_FORENSIC.groupBase,
    rows: [
      { key: 'terrain', label: FLOOD_FORENSIC.layerTerrain, tip: FLOOD_FORENSIC.layerTerrainTip },
      { key: 'naip', label: FLOOD_FORENSIC.layerNaip, tip: FLOOD_FORENSIC.layerNaipTip },
      { key: 'floodplain', label: FLOOD_FORENSIC.layerFloodplain, tip: FLOOD_FORENSIC.layerFloodplainTip },
    ],
  },
  {
    id: 'water',
    label: FLOOD_FORENSIC.groupWater,
    rows: [
      { key: 'satellite', label: FLOOD_FORENSIC.layerSatellite, tip: FLOOD_FORENSIC.layerSatelliteTip },
      { key: 'forecastArea', label: FLOOD_FORENSIC.layerForecast, tip: FLOOD_FORENSIC.layerForecastTip, exp: true },
      { key: 'warnings', label: FLOOD_FORENSIC.layerWarnings, tip: FLOOD_FORENSIC.layerWarningsTip },
      { key: 'gauges', label: FLOOD_FORENSIC.layerGauges, tip: FLOOD_FORENSIC.layerGaugesTip },
      { key: 'catfim', label: FLOOD_FORENSIC.layerCatfim, tip: FLOOD_FORENSIC.layerCatfimTip, exp: true },
    ],
  },
  {
    id: 'model',
    label: FLOOD_FORENSIC.groupModel,
    rows: [{ key: 'model', label: FLOOD_FORENSIC.layerModel, tip: FLOOD_FORENSIC.layerModelTip, exp: true }],
  },
  {
    id: 'parametric',
    label: FLOOD_FORENSIC.groupParametric,
    rows: [
      { key: 'contours', label: FLOOD_FORENSIC.layerContours, tip: FLOOD_FORENSIC.layerContoursTip },
      { key: 'telemetry', label: FLOOD_FORENSIC.layerTelemetry, tip: FLOOD_FORENSIC.layerTelemetryTip },
    ],
  },
]

/** A row's grey meta: FEMA's effective date(s), NAIP "before this flood", the satellite image day. */
function useMeta(): (k: FloodForensicLayer) => string | null {
  const tf = useTimeFormat()
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  return (k) => {
    if (!flood) return null
    const st = flood.manifest.layer_status
    if (k === 'floodplain' && st.floodplain?.time_ms != null) return `effective ${fmtDayDate(st.floodplain.time_ms, 'UTC', { year: 'always' })}`
    if (k === 'naip') return 'before this flood'
    if (k === 'satellite' && st.water_satellite?.time_ms != null && flood.has.satellite) return fmtDayDate(st.water_satellite.time_ms, tf.tz)
    if (k === 'catfim' && flood.catfim) return flood.catfim.category
    return null
  }
}

export function FloodLayersTab() {
  const layers = useForensicFlood((s) => s.layers)
  const flood = floodAssetStore((s) => s.assets?.flood ?? null)
  const meta = useMeta()
  const st = useForensicFlood.getState
  return (
    <div className="layers fxf-layers">
      {GROUPS.map((g) => {
        const avail = g.rows.filter((r) => !layerUnavailable(r.key, flood))
        const on = avail.filter((r) => layers[r.key].visible).length
        const allOn = avail.length > 0 && on === avail.length
        return (
          <div key={g.id} className="lg">
            <div className="lg-head">
              <span className="eyebrow">{g.label}</span>
              <span className="lg-count mono">
                {on}/{g.rows.length}
              </span>
              <span className="lg-line" />
              <button
                type="button"
                className="lg-toggle"
                disabled={avail.length === 0}
                data-tip={allOn ? `Hide all ${g.label} layers` : `Show all ${g.label} layers`}
                aria-label={allOn ? `Hide all ${g.label} layers` : `Show all ${g.label} layers`}
                onClick={() => avail.forEach((r) => st().setLayerVisible(r.key, !allOn))}
              >
                {allOn ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            {g.rows.map((r) => {
              const reason = layerUnavailable(r.key, flood)
              const disabled = reason != null
              const v = layers[r.key]
              const m = meta(r.key)
              return (
                <div key={r.key}>
                  <div className={`lrow ${disabled ? 'is-unavailable' : ''} ${v.visible && !disabled ? 'is-on' : ''}`}>
                    <Checkbox checked={v.visible && !disabled} disabled={disabled} label={`Show ${r.label}`} onChange={(on) => st().setLayerVisible(r.key, on)} />
                    <span className={`sw fxf-sw fxf-sw-${r.key}`} aria-hidden />
                    <button type="button" className="lrow-label" disabled={disabled} data-tip={reason ?? r.tip} onClick={() => st().toggleLayer(r.key)}>
                      <span className="ellipsis">{r.label}</span>
                      {m && <span className="lrow-meta mono">{m}</span>}
                    </button>
                    <Slider className="lrow-slider" label={`${r.label} opacity`} value={v.opacity} disabled={disabled} onChange={(o) => st().setLayerOpacity(r.key, o)} />
                    <button
                      type="button"
                      className="lrow-pct mono"
                      disabled={disabled}
                      onDoubleClick={() => st().setLayerOpacity(r.key, FLOOD_FORENSIC_DEFAULTS[r.key].opacity)}
                      aria-label={`${r.label} opacity ${Math.round(v.opacity * 100)}%`}
                    >
                      {Math.round(v.opacity * 100)}%
                    </button>
                  </div>
                  {v.visible && !disabled && <RowNote k={r.key} exp={r.exp} />}
                  {disabled && reason !== FLOOD_FORENSIC.layerUnavailable && <div className="fxf-row-why">{reason}</div>}
                </div>
              )
            })}
          </div>
        )
      })}
      <div className="layers-foot">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => st().resetLayers()}>
          <RotateCcw size={12} /> {FLOOD_FORENSIC.layersReset}
        </button>
        <span className="muted">{FLOOD_FORENSIC.layersFoot}</span>
      </div>
    </div>
  )
}

/** The short legend under a visible row whose look carries meaning. */
function RowNote({ k, exp }: { k: FloodForensicLayer; exp?: boolean }) {
  if (k === 'gauges') return <div className="legend fxf-note">{FLOOD_FORENSIC.barHeight}</div>
  if (k === 'satellite')
    return (
      <div className="legend legend-wrap fxf-note">
        <span className="legend-chip">
          <i className="fxf-chip-water" />
          water
        </span>
        <span className="legend-chip">
          <i className="fxf-chip-noview" />
          {FLOOD_FORENSIC.keySatNoView}
        </span>
      </div>
    )
  if (k === 'model')
    return (
      <div className="legend fxf-note">
        <span className="exp-tag">experimental model</span> {FLOOD_FORENSIC.keyModel}
      </div>
    )
  if (exp)
    return (
      <div className="legend fxf-note">
        <span className="exp-tag">experimental (NWS)</span>
      </div>
    )
  return null
}
