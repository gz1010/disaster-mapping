// The Layers drawer of a flood view (brief 5, PLAN-5 §4.4, §4.5; D12, D21, D22; CONTRACT §16.10-16.11): the fire
// drawer's shell (ui/shell/LayersPanel.tsx classes: a non-modal drawer under the header's Layers button, a bottom sheet
// on phones with the legend) with the flood view's own layers, each with what it is and whose it is:
//   Water         water seen by satellite, the NWS forecast flooded area, NWS warning areas, river gauges, the main
//                 channel; Command also "NWS category flood maps (experimental)", off by default (D22)
//   Background    the FEMA 1% annual-chance floodplain, off by default, with FEMA's effective date (D21)
//   Model         Command only: the National Water Model's flooded area, off by default, experimental (D12)
//   Evacuations   the official evacuation zones toggle (flood wording)
// then the basemap, units and the way to Forensic. Public never offers the model or the NWS category maps (a note says
// they are in Command). The toggles are useFlood.layers (map/floodProfile.ts says which view draws which).
import { Box, X } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { FloodLegend } from '../../map/FloodLegend'
import { floodProfile } from '../../map/floodProfile'
import { BASEMAP_LABEL } from '../../map/providers'
import { useFloodOfficial } from '../../official/floodHooks'
import { openFloodSummary, useFlood, type FloodLayerKey } from '../../state/flood'
import { useTimeFormatFor } from '../../state/timeZone'
import { useWorkspace, type Basemap, type Units } from '../../state/workspace'
import { Segmented } from '../controls'
import { nfhlEffective } from '../public/floodView'
import { fillCopy, FLOOD_PUBLIC } from './floodCopy'
import { switchWorkspace } from './handoff'
import { NARROW_QUERY, useDrawerFocus, useMediaQuery } from './hooks'
import { applyView } from './views'

const BASEMAPS: { value: Basemap; desc: string }[] = [
  { value: 'dark', desc: 'Subdued roads and places; water layers stand out' },
  { value: 'roads', desc: 'Road map with streets, towns and landmarks' },
  { value: 'aerial', desc: 'USGS aerial photos (dated, taken before this flood; not live) with road and place labels' },
]

const UNITS: { value: Units; label: string; tip: string }[] = [
  { value: 'us', label: 'US', tip: 'ft, ft³/s, mi' },
  { value: 'metric', label: 'Metric', tip: 'm, m³/s, km' },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mw-set">
      <div className="mw-set-head">
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  )
}

function FloodToggle({ k, label, desc }: { k: FloodLayerKey; label: string; desc: string }) {
  const on = useFlood((s) => s.layers[k])
  return (
    <li>
      <label className="mw-check-row">
        <input type="checkbox" checked={on} onChange={(e) => useFlood.getState().setFloodLayer(k, e.target.checked)} />
        <span className="mw-check-text">
          <span className="mw-check-label">{label}</span>
          <span className="mw-check-desc">{desc}</span>
        </span>
      </label>
    </li>
  )
}

export function FloodLayersPanel({ variant = 'public' }: { variant?: 'public' | 'command' }) {
  const open = useWorkspace((s) => s.panels.layers)
  const basemap = useWorkspace((s) => s.basemap)
  const units = useWorkspace((s) => s.units)
  const evacOn = useWorkspace((s) => s.mapLayers.evacuation)
  const narrow = useMediaQuery(NARROW_QUERY)
  const summary = useFlood((s) => openFloodSummary(s))
  const nfhl = useFloodOfficial((s) => s.nfhl.data)
  const tf = useTimeFormatFor(summary?.time_zone)
  const heading = useRef<HTMLHeadingElement | null>(null)
  useDrawerFocus(open, heading, 'layers')
  if (!open) return null
  const ws = useWorkspace.getState()
  const profile = floodProfile(variant === 'command' ? 'command-flood' : 'public-flood')
  const eff = nfhlEffective(nfhl, tf.tz)
  return (
    <section className="mw-layers ffl" aria-labelledby="mw-layers-title" data-drawer="layers" data-variant={variant}>
      <span className="mw-sheet-handle" aria-hidden="true" />
      <header className="mw-panel-head">
        <h2 id="mw-layers-title" ref={heading} tabIndex={-1}>
          {FLOOD_PUBLIC.layersTitle}
        </h2>
        <button type="button" className="mw-icon-btn" aria-label="Close layers and settings" data-tip="Close (Esc)" onClick={() => ws.setPanel('layers', false)}>
          <X size={15} />
        </button>
      </header>
      <div className="mw-layers-body">
        <Section title={FLOOD_PUBLIC.layersWater}>
          <ul className="mw-check-list">
            {profile.satellite !== false && <FloodToggle k="satellite" label={FLOOD_PUBLIC.layerSatellite} desc={FLOOD_PUBLIC.layerSatelliteDesc} />}
            {profile.forecastArea !== false && <FloodToggle k="forecastArea" label={FLOOD_PUBLIC.layerForecast} desc={FLOOD_PUBLIC.layerForecastDesc} />}
            {profile.warnings !== false && <FloodToggle k="warnings" label={FLOOD_PUBLIC.layerWarnings} desc={FLOOD_PUBLIC.layerWarningsDesc} />}
            {profile.gauges !== false && <FloodToggle k="gauges" label={FLOOD_PUBLIC.layerGauges} desc={FLOOD_PUBLIC.layerGaugesDesc} />}
            {profile.channel !== false && <FloodToggle k="channel" label={FLOOD_PUBLIC.layerChannel} desc={FLOOD_PUBLIC.layerChannelDesc} />}
            {profile.catfim !== false && <FloodToggle k="catfim" label={FLOOD_PUBLIC.layerCatfim} desc={FLOOD_PUBLIC.layerCatfimDesc} />}
          </ul>
        </Section>
        {profile.floodplain !== false && (
          <Section title={FLOOD_PUBLIC.layersBackground}>
            <ul className="mw-check-list">
              <FloodToggle k="floodplain" label={FLOOD_PUBLIC.layerFloodplain} desc={eff ? fillCopy(FLOOD_PUBLIC.layerFloodplainDesc, { date: eff }) : FLOOD_PUBLIC.layerFloodplainDescNoDate} />
            </ul>
          </Section>
        )}
        {profile.model !== false && (
          <Section title={FLOOD_PUBLIC.layersModel}>
            <ul className="mw-check-list">
              <FloodToggle k="model" label={FLOOD_PUBLIC.layerModel} desc={FLOOD_PUBLIC.layerModelDesc} />
            </ul>
            <p className="mw-set-note">{FLOOD_PUBLIC.layersCommandNote}</p>
          </Section>
        )}
        <Section title={FLOOD_PUBLIC.layersEvac}>
          <ul className="mw-check-list">
            <li>
              <label className="mw-check-row">
                <input type="checkbox" checked={evacOn} onChange={(e) => ws.setMapLayer('evacuation', e.target.checked)} />
                <span className="mw-check-text">
                  <span className="mw-check-label">{FLOOD_PUBLIC.layerEvac}</span>
                  <span className="mw-check-desc">{FLOOD_PUBLIC.layerEvacDesc}</span>
                </span>
              </label>
            </li>
          </ul>
          {variant === 'public' && (
            <p className="mw-set-note">
              {FLOOD_PUBLIC.layersPublicNote}{' '}
              <button type="button" className="mw-link-btn" onClick={() => applyView('command')}>
                {FLOOD_PUBLIC.openCommand}
              </button>
            </p>
          )}
        </Section>
        <Section title={FLOOD_PUBLIC.basemap}>
          <div className="mw-basemaps" role="radiogroup" aria-label="Basemap">
            {BASEMAPS.map((b) => (
              <button key={b.value} type="button" role="radio" aria-checked={basemap === b.value} className={`mw-basemap mw-basemap-${b.value}`} onClick={() => ws.setBasemap(b.value)}>
                <span className="mw-basemap-swatch" aria-hidden="true" />
                <span className="mw-basemap-label">{BASEMAP_LABEL[b.value]}</span>
                <span className="mw-basemap-desc">{b.desc}</span>
              </button>
            ))}
          </div>
        </Section>
        {narrow && (
          <Section title={FLOOD_PUBLIC.legend}>
            <div className="mw-legend-inline">
              <FloodLegend variant="panel" />
            </div>
          </Section>
        )}
        <Section title={FLOOD_PUBLIC.units}>
          <Segmented value={units} options={UNITS} onChange={ws.setUnits} ariaLabel="Units" size="sm" className="mw-seg-fill" />
        </Section>
        <Section title="Forensic">
          <p className="mw-set-note">{FLOOD_PUBLIC.forensicNote}</p>
          <button type="button" className="mw-btn is-sm" onClick={() => switchWorkspace('forensic')}>
            <Box size={13} /> {FLOOD_PUBLIC.forensicButton}
          </button>
        </Section>
      </div>
    </section>
  )
}
