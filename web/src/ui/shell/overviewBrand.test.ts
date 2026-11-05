// The overview bar's name word (brief 6 review RD-R1): "Disaster Mapping" is about 150 px wide, so at 1024-1279 px
// it pushed the Fires | Floods switch under the centre view pill (Floods could not be clicked). It hides there, from
// the width where the centre pill appears (1024 px) up to 1279 px, visually only: the logo mark stays and the words stay
// in the markup for screen readers. The layout itself is measured by scripts/check-topbar.mjs in a real browser.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TopBarBrand } from './TopBar'

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

/** The body of the first `@media <query> { … }` block with that exact query (one level of nested rules). */
function mediaBlock(query: string): string | null {
  const at = layoutCss.indexOf(`@media ${query} {`)
  if (at < 0) return null
  const m = /^\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/.exec(layoutCss.slice(at + `@media ${query} `.length))
  return m ? m[1] : null
}

describe('overview bar name word', () => {
  it('hides visually from 1024 to 1279 px (centre pill on screen), as on phones', () => {
    const block = mediaBlock('(min-width: 1024px) and (max-width: 1279px)')
    expect(block).not.toBeNull()
    expect(block).toMatch(/\.mw-header \.tb-brand-name \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect\(0 0 0 0\);/)
    // never display:none or visibility:hidden, which would drop the name from the accessibility tree
    expect(block).not.toMatch(/tb-brand-name[^}]*(display: none|visibility: hidden)/)
  })

  it('the lower bound is where the centre pill appears (it moves into the menu at 1023 px and below)', () => {
    expect(mediaBlock('(max-width: 1023px)')).toMatch(/\.mw-wide-only \{ display: none !important; \}/)
  })

  it('the bar still holds the full name next to the logo', () => {
    const h = renderToStaticMarkup(createElement(TopBarBrand))
    expect(h).toContain('<span class="tb-brand-name">Disaster Mapping</span>')
    expect(h).toMatch(/<svg/)
  })
})
