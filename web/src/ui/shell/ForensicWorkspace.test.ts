// Forensic with no fire focused ("Zoom in on a fire or pick one"): like every view it keeps the fixed copy (BRIEF-4
// standing rules, CONTRACT §15.4), "Research prototype — not for operational use" and "Not an all-clear. Follow
// local officials.", outside the fire list (review H5-M1 / H5-DF-2: it used to show only the list's own footer).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '../../state/store'
import { useWorkspace } from '../../state/workspace'
import { restoreSsrState, ssrState } from '../ssr.testutil'
import ForensicWorkspace from './ForensicWorkspace'
import { NOT_ALL_CLEAR, PROTOTYPE_LINE } from './fixedCopyText'

const decode = (h: string) => h.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const text = (h: string) => decode(h.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ')

afterEach(() => restoreSsrState())

describe('Forensic, no fire open', () => {
  it('shows the prototype line and "Not an all-clear" in a footer of its own, after the list', () => {
    ssrState(useStore, { incidentId: null, summary: null })
    ssrState(useWorkspace, { fireCardId: null, workspace: 'forensic' })
    const html = renderToStaticMarkup(createElement(ForensicWorkspace))
    expect(text(html)).toContain('Zoom in on a fire or pick one')
    const foot = html.slice(html.indexOf('<footer class="fx-empty-foot"'))
    expect(foot.length).toBeLessThan(html.length)
    expect(text(foot)).toContain(`${PROTOTYPE_LINE} · ${NOT_ALL_CLEAR}`)
    // the footer comes after the list's panel, not inside it
    expect(html.indexOf('<footer class="fx-empty-foot"')).toBeGreaterThan(html.indexOf('</main>'))
  })
})

describe('brief 5: Forensic entry page in Floods', () => {
  it('has the Fires | Floods switch, lists floods (DEMO tags) and keeps the fixed copy at its foot', async () => {
    const { useFlood } = await import('../../state/flood')
    const { LIST } = await import('../../api/__fixtures__/floods/edgeCases')
    ssrState(useStore, { incidentId: null, summary: null })
    ssrState(useWorkspace, { fireCardId: null, workspace: 'forensic', hazard: 'flood' })
    ssrState(useFlood, { lists: { live: { response: LIST(), loading: false, error: null, status: null } }, filter: 'live', showWatches: false, floodId: null })
    const html = renderToStaticMarkup(createElement(ForensicWorkspace))
    const t = text(html)
    expect(html).toContain('role="radiogroup" aria-label="Show: fires or floods"')
    expect(t).toContain('Pick a flood')
    expect(t).toContain('Ridge Fork River flood')
    expect(t).toContain('DEMO')
    // watches hidden by default, and said so (C27)
    expect(t).toContain('1 Flood Watch hidden · Show')
    expect(t).not.toContain('Zoom in on a fire or pick one')
    const foot = html.slice(html.indexOf('<footer class="fx-empty-foot"'))
    expect(text(foot)).toContain(`${PROTOTYPE_LINE} · ${NOT_ALL_CLEAR}`)
  })
})

describe('brief 5: the 3D flood branch (web-flood-forensic)', () => {
  it('a listed flood without 3D data: "not prepared", Prepare 3D data, and the fixed copy', async () => {
    const { useFlood } = await import('../../state/flood')
    const { DETAIL_FLASH } = await import('../../api/__fixtures__/floods/edgeCases')
    const d = DETAIL_FLASH()
    ssrState(useStore, { incidentId: null, summary: null, panelsCollapsed: false })
    ssrState(useWorkspace, { fireCardId: null, workspace: 'forensic', hazard: 'flood' })
    ssrState(useFlood, { floodId: d.summary.id, summary: { ...d.summary, bundle_status: 'none' }, manifest: null, job: null, detailLoading: false, buildError: null })
    const html = renderToStaticMarkup(createElement(ForensicWorkspace))
    const t = text(html)
    expect(t).toContain("Fire-3d has not prepared this flood's 3D terrain yet.")
    expect(t).toContain('Prepare 3D data (about 1 min)')
    expect(t).toContain(d.summary.name)
    expect(html).toContain('aria-label="Back to all floods"')
    expect(t).not.toContain('Pick a flood')
    expect(text(html.slice(html.indexOf('<footer class="fx-empty-foot"')))).toContain(`${PROTOTYPE_LINE} · ${NOT_ALL_CLEAR}`)
  })

  it('a preparation running shows its progress', async () => {
    const { useFlood } = await import('../../state/flood')
    const { DETAIL_FLASH } = await import('../../api/__fixtures__/floods/edgeCases')
    const d = DETAIL_FLASH()
    ssrState(useStore, { incidentId: null, summary: null })
    ssrState(useWorkspace, { workspace: 'forensic', hazard: 'flood' })
    ssrState(useFlood, {
      floodId: d.summary.id,
      summary: { ...d.summary, bundle_status: 'none' },
      manifest: null,
      detailLoading: false,
      buildError: null,
      job: { id: 'j1', kind: 'build', incident_id: d.summary.id, status: 'running', progress: 0.4, step: 'terrain', message: '', created_ms: 0, started_ms: 0, finished_ms: null, error: null, result: null },
    })
    const html = renderToStaticMarkup(createElement(ForensicWorkspace))
    expect(text(html)).toContain('Preparing 3D data… terrain 40%')
    expect(html).toContain('role="progressbar"')
  })

  it('a flood with 3D data: the scene branch with its top bar, entry controls, demo badge and the fixed copy pill', async () => {
    const { useFlood } = await import('../../state/flood')
    const { DETAIL } = await import('../../api/__fixtures__/floods/edgeCases')
    const d = DETAIL()
    ssrState(useStore, { incidentId: null, summary: null, panelsCollapsed: false })
    ssrState(useWorkspace, { workspace: 'forensic', hazard: 'flood' })
    ssrState(useFlood, { floodId: d.summary.id, summary: d.summary, manifest: d.manifest, job: null, detailLoading: false })
    const html = renderToStaticMarkup(createElement(ForensicWorkspace))
    const t = text(html)
    expect(t).toContain('Ridge Fork River flood')
    expect(t).toContain('Frame flood')
    expect(t).toContain('Charts & NWS products')
    expect(t).toContain('Demo · simulated data')
    expect(t).toContain('terrain, water layers and gauges are synthetic')
    expect(t).toContain(`${PROTOTYPE_LINE} · ${NOT_ALL_CLEAR}`)
    // the fire Forensic's own parts are not mounted for a flood
    expect(t).not.toContain('Charts & key events')
    expect(t).not.toContain('Frame fire')
  })
})
