// Zoom dimming (brief 6, decision 4): off by default, on only after the switch, remembered in this browser, and safe
// against storage that is missing or refuses access; the stylesheet hides the vignette unless the layer says "on" and
// leaves the edge gradients behind the text alone.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../state/workspace'
import { readZoomDimming, writeZoomDimming, ZOOM_DIMMING_DEFAULT, ZOOM_DIMMING_KEY } from './zoomDimming'

/** Node's fs without @types/node (tests run in Node; the app never imports this). */
interface FsLike {
  readFileSync(p: URL, enc: string): string
}
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as FsLike
// rules only (comments dropped), whitespace collapsed
const atmosphereCss = fs
  .readFileSync(new URL('../styles/atmosphere.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')

/** A Storage stand-in that keeps its items in a Map. */
function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init))
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  }
}

/** A Storage whose every access throws (private windows, blocked site data). */
const refusing = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  useWorkspace.setState({ zoomDimming: false })
})

describe('zoom dimming preference', () => {
  it('is off by default: nothing stored, no storage at all, or storage that refuses', () => {
    expect(ZOOM_DIMMING_DEFAULT).toBe(false)
    expect(readZoomDimming(memoryStorage())).toBe(false)
    expect(readZoomDimming(null)).toBe(false)
    expect(readZoomDimming(refusing)).toBe(false)
    // the tests run in Node, which has no localStorage: the default reader falls back to off
    expect(readZoomDimming()).toBe(false)
  })

  it('reads "1" as on and anything else as off', () => {
    expect(readZoomDimming(memoryStorage({ [ZOOM_DIMMING_KEY]: '1' }))).toBe(true)
    expect(readZoomDimming(memoryStorage({ [ZOOM_DIMMING_KEY]: '0' }))).toBe(false)
    expect(readZoomDimming(memoryStorage({ [ZOOM_DIMMING_KEY]: 'true' }))).toBe(false)
    expect(readZoomDimming(memoryStorage({ [ZOOM_DIMMING_KEY]: '' }))).toBe(false)
  })

  it('writes "1" / "0" under its own key and never throws', () => {
    expect(ZOOM_DIMMING_KEY).toBe('fire3d.zoomDimming')
    const s = memoryStorage()
    writeZoomDimming(true, s)
    expect(s.getItem(ZOOM_DIMMING_KEY)).toBe('1')
    expect(readZoomDimming(s)).toBe(true)
    writeZoomDimming(false, s)
    expect(s.getItem(ZOOM_DIMMING_KEY)).toBe('0')
    expect(readZoomDimming(s)).toBe(false)
    expect(() => writeZoomDimming(true, refusing)).not.toThrow()
    expect(() => writeZoomDimming(true, null)).not.toThrow()
    expect(() => writeZoomDimming(true)).not.toThrow()
  })
})

describe('the workspace switch', () => {
  it('starts off', () => {
    expect(useWorkspace.getInitialState().zoomDimming).toBe(false)
    expect(useWorkspace.getState().zoomDimming).toBe(false)
  })

  it('turns on and off and remembers the choice in this browser', () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    useWorkspace.getState().setZoomDimming(true)
    expect(useWorkspace.getState().zoomDimming).toBe(true)
    expect(storage.getItem(ZOOM_DIMMING_KEY)).toBe('1')
    // a new page in this browser starts from the remembered choice
    expect(readZoomDimming()).toBe(true)
    useWorkspace.getState().setZoomDimming(false)
    expect(useWorkspace.getState().zoomDimming).toBe(false)
    expect(storage.getItem(ZOOM_DIMMING_KEY)).toBe('0')
    expect(readZoomDimming()).toBe(false)
  })

  it('still switches when storage refuses (the choice then lasts for this visit only)', () => {
    vi.stubGlobal('localStorage', refusing)
    expect(() => useWorkspace.getState().setZoomDimming(true)).not.toThrow()
    expect(useWorkspace.getState().zoomDimming).toBe(true)
    expect(readZoomDimming()).toBe(false)
  })
})

describe('the stylesheet', () => {
  it('hides the vignette unless the layer is marked on, before and after the script marks it', () => {
    expect(atmosphereCss).toMatch(/\.mw-atmo:not\(\[data-vignette='on'\]\)::before \{ opacity: 0; \}/)
    // the vignette itself still follows the zoom when on
    expect(atmosphereCss).toMatch(/\.mw-atmo::before \{ background: radial-gradient\([^}]*opacity: var\(--mw-vignette\)/)
  })

  it('never switches the edge gradients behind the text (only ::before is gated)', () => {
    expect(atmosphereCss).not.toMatch(/data-vignette[^{]*::after/)
    expect(atmosphereCss).toMatch(/\.mw-atmo\[data-edges='command'\]::after \{ background:/)
    expect(atmosphereCss).toMatch(/\.mw-atmo\[data-edges='fire'\]::after \{ background:/)
    expect(atmosphereCss).toMatch(/\.mw-atmo\[data-edges='overview'\]::after \{ background:/)
  })
})
