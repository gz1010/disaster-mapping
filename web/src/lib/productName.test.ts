// Guard (brief 6, decision 1): the product is called "Disaster Mapping". No text a person can see in the web app (a
// string, a template or JSX text in any source file, or the HTML pages) still uses the old name ("Fire-3d" and its
// spellings). Internal names stay as they were and are allowed: the lowercase `fire3d` of storage keys, history state
// and scene object names, and the lowercase repository slug `fire-3d`. Comments are not scanned.
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** The old product name as a person would read it ("Fire-3d", "Fire 3D", "Fire3d", "FIRE-3D"; never the `FIRE3D_*`
 *  settings' prefix). */
const OLD_NAME = /Fire[- ]?3[dD]|FIRE[- ]3D/

// raw text of every script file (test files excepted: this one holds the old name as an input) and of every HTML page
const sources = Object.fromEntries(
  Object.entries(import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>).filter(
    ([path]) => !/\.test\.tsx?$/.test(path),
  ),
)
const pages = import.meta.glob('/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Every piece of text a script can show: string literals, template parts and JSX text (comments are skipped). */
function visibleTexts(path: string, source: string): string[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, kind)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) out.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/** `{ path: [texts with the old name] }` for the given files. */
function oldNameUses(files: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [path, source] of Object.entries(files)) {
    const hits = visibleTexts(path, source).filter((t) => OLD_NAME.test(t))
    if (hits.length) out[path] = hits
  }
  return out
}

describe('product name (brief 6): Disaster Mapping', () => {
  it('finds the source files and the HTML pages', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    expect(Object.keys(sources)).toContain('/src/ui/shell/floodCopy.ts')
    expect(Object.keys(pages)).toContain('/index.html')
  })

  it('no string, template or JSX text in any source file uses the old name', () => {
    expect(oldNameUses(sources)).toEqual({})
  })

  it('the HTML pages (title, description, noscript) use the new name only', () => {
    for (const [path, html] of Object.entries(pages)) {
      expect(html, path).not.toMatch(OLD_NAME)
      expect(html, path).toMatch(/<title>Disaster Mapping\b/)
    }
  })

  it('a planted old name is found in a string, a template, JSX text and an attribute, never in a comment', () => {
    const planted = [
      "// Fire-3d in a comment is not text a person sees",
      "const a = 'Fire-3d has not prepared this flood'",
      'const b = `${n} · Fire 3D`',
      'const c = <p title="Fire3d">SEEN BY FIRE-3D SINCE</p>',
      "const d = 'fire3d:annotations:' // internal storage key: allowed",
    ].join('\n')
    expect(oldNameUses({ '/planted.tsx': planted })).toEqual({
      '/planted.tsx': ['Fire-3d has not prepared this flood', ' · Fire 3D', 'Fire3d', 'SEEN BY FIRE-3D SINCE'],
    })
  })
})
