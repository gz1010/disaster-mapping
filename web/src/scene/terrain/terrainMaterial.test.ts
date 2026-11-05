// Texture units of the terrain shader (brief 6 review, WFF3D-R1). WebGL2 only promises MAX_TEXTURE_IMAGE_UNITS = 16 per
// fragment shader, and ANGLE on Metal (Chrome on macOS) and D3D11 (Chrome on Windows) report exactly 16. A program that
// samples more fails to link there, and the terrain (fire and flood) would not draw. The sun's shadow map (medium / high
// quality) takes one unit, so each variant of the terrain shader may sample at most 15 textures of its own.
import { describe, expect, it } from 'vitest'
import { createTerrainMaterial, setTerrainVariant, terrainFragmentShader, TERRAIN_FLOOD } from './terrainMaterial'

const MAX_UNITS = 16
const SHADOW_UNITS = 1 // one shadow-casting light (atmosphere/SunLights.tsx)

/** A small GLSL preprocessor: #ifdef / #ifndef / #else / #endif (nested), everything else kept as is. */
function preprocess(src: string, defines: Set<string>): string {
  const out: string[] = []
  const stack: { on: boolean; parentOn: boolean }[] = []
  const on = () => (stack.length ? stack[stack.length - 1].on : true)
  for (const line of src.split('\n')) {
    const t = line.trim()
    const m = /^#(ifdef|ifndef)\s+(\w+)/.exec(t)
    if (m) {
      const parentOn = on()
      const hit = defines.has(m[2]) === (m[1] === 'ifdef')
      stack.push({ on: parentOn && hit, parentOn })
      continue
    }
    if (/^#else\b/.test(t)) {
      const top = stack[stack.length - 1]
      if (!top) throw new Error('#else without #if')
      top.on = top.parentOn && !top.on
      continue
    }
    if (/^#endif\b/.test(t)) {
      if (!stack.pop()) throw new Error('#endif without #if')
      continue
    }
    if (on()) out.push(line)
  }
  if (stack.length) throw new Error('unclosed #if')
  return out.join('\n')
}

const declared = (src: string) => [...src.matchAll(/uniform\s+[iu]?sampler\w*\s+(\w+)/g)].map((m) => m[1])
const sampled = (src: string) =>
  new Set([...src.matchAll(/\b(?:texture2D|texture|textureLod|texelFetch|textureSize|textureBicubic)\(\s*(u[A-Z]\w*)/g)].map((m) => m[1]))

const FIRE_ONLY = ['uFuel', 'uObserved', 'uForecast', 'uSeverity']
const FLOOD_ONLY = ['uFloodPack', 'uSatWater', 'uSatLut', 'uHand', 'uSatImg']

describe('terrain shader texture units', () => {
  const fire = preprocess(terrainFragmentShader, new Set())
  const flood = preprocess(terrainFragmentShader, new Set([TERRAIN_FLOOD]))

  it.each([
    ['fire', fire],
    ['flood', flood],
  ])('the %s variant samples at most 15 textures (one unit left for the shadow map)', (_name, src) => {
    const d = declared(src)
    expect(new Set(d).size).toBe(d.length)
    expect(d.length + SHADOW_UNITS).toBeLessThanOrEqual(MAX_UNITS)
  })

  it.each([
    ['fire', fire],
    ['flood', flood],
  ])('every texture the %s variant samples is declared in it (no use outside its guard)', (_name, src) => {
    const d = new Set(declared(src))
    for (const u of sampled(src)) expect(d.has(u), u).toBe(true)
  })

  it('the fire variant has no flood drapes, the flood variant no fire layers', () => {
    const f = declared(fire)
    const w = declared(flood)
    for (const u of FLOOD_ONLY) {
      expect(f).not.toContain(u)
      expect(w).toContain(u)
    }
    for (const u of FIRE_ONLY) {
      expect(f).toContain(u)
      expect(w).not.toContain(u)
    }
    // the shared ground (elevation, photo, sky view, baked sun) is in both
    for (const u of ['uElev', 'uNaip', 'uSkyView', 'uBakeA', 'uBakeB', 'uLut']) {
      expect(f).toContain(u)
      expect(w).toContain(u)
    }
  })

  it('the material switches variant with a recompile only on a change', () => {
    const m = createTerrainMaterial()
    expect(TERRAIN_FLOOD in m.defines).toBe(false)
    const v0 = m.version
    setTerrainVariant(m, false)
    expect(m.version).toBe(v0)
    setTerrainVariant(m, true)
    expect(TERRAIN_FLOOD in m.defines).toBe(true)
    expect(m.version).toBe(v0 + 1)
    setTerrainVariant(m, true)
    expect(m.version).toBe(v0 + 1)
    setTerrainVariant(m, false)
    expect(TERRAIN_FLOOD in m.defines).toBe(false)
    expect(createTerrainMaterial(true).defines[TERRAIN_FLOOD]).toBe('')
    m.dispose()
  })
})
