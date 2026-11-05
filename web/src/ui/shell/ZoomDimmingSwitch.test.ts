// The "Zoom dimming" switch (brief 6, decision 4): a labelled switch, off by default, in the Display section of the
// Layers / settings drawer of fires and of floods.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { DISPLAY_SECTION_TITLE, ZOOM_DIMMING_DESC, ZOOM_DIMMING_LABEL } from '../../map/zoomDimming'
import { DEFAULT_PANELS, useWorkspace } from '../../state/workspace'
import { restoreSsrState, ssrState } from '../ssr.testutil'
import { floodWordingProblems } from './floodCopy'
import { FloodLayersPanel } from './FloodLayersPanel'
import { LayersPanel } from './LayersPanel'
import { DisplaySection, ZoomDimmingSwitch } from './ZoomDimmingSwitch'

afterEach(() => restoreSsrState())

/** Node's fs without @types/node (tests run in Node; the app never imports this). */
interface FsLike {
  readFileSync(p: URL, enc: string): string
}
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as FsLike
// rules only (comments dropped), whitespace collapsed
const layoutCss = fs
  .readFileSync(new URL('../../styles/map-layout.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

/** The switch's <input> in rendered markup. */
function switchInput(html: string): string {
  return /<input[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? ''
}

describe('Zoom dimming switch', () => {
  it('is off by default: an unchecked native checkbox with the switch role, drawn as the pill switch', () => {
    const html = renderToStaticMarkup(createElement(ZoomDimmingSwitch))
    const input = switchInput(html)
    expect(input).toContain('type="checkbox"')
    expect(input).toContain('class="mw-switch"')
    expect(input).not.toMatch(/\schecked=""/)
    // the native checked state is the switch's state; no redundant aria-checked on an <input> (review RD-R6)
    expect(input).not.toContain('aria-checked')
    expect(html).toContain(`>${ZOOM_DIMMING_LABEL}<`)
    expect(ZOOM_DIMMING_LABEL).toBe('Zoom dimming')
  })

  it('is drawn as the pill switch (track, knob, accent when on) and stands still under reduced motion', () => {
    expect(layoutCss).toMatch(/\.mw-check-row input\.mw-switch \{ appearance: none;[^}]*width: 26px; height: 14px;/)
    expect(layoutCss).toMatch(/\.mw-check-row input\.mw-switch:checked \{ background: var\(--m-accent\); \}/)
    expect(layoutCss).toMatch(/\.mw-check-row input\.mw-switch:checked::before \{ transform: translateX\(12px\);/)
    expect(layoutCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.mw-check-row input\.mw-switch, \.mw-check-row input\.mw-switch::before \{ transition: none; \} \}/)
  })

  it('shows on when the workspace says so', () => {
    ssrState(useWorkspace, { zoomDimming: true })
    const input = switchInput(renderToStaticMarkup(createElement(ZoomDimmingSwitch)))
    expect(input).toMatch(/\schecked=""/)
    expect(input).not.toContain('aria-checked')
  })

  it('sits in a Display section; its words are plain and free of the banned words', () => {
    const html = renderToStaticMarkup(createElement(DisplaySection))
    expect(html).toContain(`<h3>${DISPLAY_SECTION_TITLE}</h3>`)
    expect(DISPLAY_SECTION_TITLE).toBe('Display')
    expect(ZOOM_DIMMING_DESC).toMatch(/Off by default; remembered in this browser/)
    expect(floodWordingProblems(`${ZOOM_DIMMING_LABEL}. ${ZOOM_DIMMING_DESC}`)).toEqual([])
  })

  it('is in the Layers / settings drawer of the overview and fires, and of floods (Public and Command)', () => {
    ssrState(useWorkspace, { panels: { ...DEFAULT_PANELS, layers: true } })
    for (const el of [createElement(LayersPanel), createElement(FloodLayersPanel, { variant: 'public' }), createElement(FloodLayersPanel, { variant: 'command' })]) {
      const html = renderToStaticMarkup(el)
      expect(html).toContain(`<h3>${DISPLAY_SECTION_TITLE}</h3>`)
      const input = switchInput(html)
      expect(input).toContain('class="mw-switch"')
      expect(input).not.toMatch(/\schecked=""/)
    }
  })
})
