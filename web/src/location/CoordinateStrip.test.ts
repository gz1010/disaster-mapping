// The overview's coordinate strip names the hazard the overview lists (brief 5 integration, review WFO-R9): "No flood
// open" in Floods, "No fire open" in Fires (unchanged).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { useWorkspace } from '../state/workspace'
import { restoreSsrState, ssrState } from '../ui/ssr.testutil'
import { CoordinateStrip } from './CoordinateStrip'

afterEach(() => restoreSsrState())

describe('CoordinateStrip with no event open', () => {
  it('says "No fire open" in Fires', () => {
    ssrState(useWorkspace, { hazard: 'fire' })
    const html = renderToStaticMarkup(createElement(CoordinateStrip))
    expect(html).toContain('No fire open')
    expect(html).not.toContain('No flood open')
  })

  it('says "No flood open" in Floods', () => {
    ssrState(useWorkspace, { hazard: 'flood' })
    const html = renderToStaticMarkup(createElement(CoordinateStrip))
    expect(html).toContain('No flood open')
    expect(html).not.toContain('No fire open')
  })
})
