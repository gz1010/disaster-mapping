import { describe, expect, it } from 'vitest'
import { buildDepthMesh, DEPTH_RAMP } from './depthMesh'

describe('depth surface mesh (FwDET, inside the mapped water only)', () => {
  it('builds nothing without a water cell', () => {
    expect(buildDepthMesh(new Uint8Array(16).fill(255), new Float32Array(16), 4, 4, 400)).toBeNull()
    // size mismatch
    expect(buildDepthMesh(new Uint8Array(9), new Float32Array(16), 4, 4, 400)).toBeNull()
  })

  it('puts water cells at terrain + depth and the rim on the terrain, with the terrain diagonals', () => {
    // 4 x 4 grid, one water cell at row 1, col 1 holding 1.2 m (code 12); terrain 10 m everywhere
    const depth = new Uint8Array(16).fill(255)
    depth[1 * 4 + 1] = 12
    const elev = new Float32Array(16).fill(10)
    const m = buildDepthMesh(depth, elev, 4, 4, 400)!
    expect(m.cells).toBe(1)
    // the four quads around the cell, 9 vertices
    expect(m.index.length).toBe(4 * 6)
    expect(m.inside.length).toBe(9)
    const wet = [...m.inside].findIndex((v) => v === 1)
    expect(m.depth[wet]).toBeCloseTo(1.2, 5)
    expect(m.positions[wet * 3 + 1]).toBeCloseTo(11.2, 5)
    // the cell centre: x = -200 + 1.5 * 100, z = -200 + 1.5 * 100 (row 1 from the north)
    expect(m.positions[wet * 3]).toBeCloseTo(-50, 5)
    expect(m.positions[wet * 3 + 2]).toBeCloseTo(-50, 5)
    // rim vertices sit on the terrain with no depth
    for (let v = 0; v < m.inside.length; v++) {
      if (m.inside[v] === 1) continue
      expect(m.depth[v]).toBe(0)
      expect(m.positions[v * 3 + 1]).toBe(10)
    }
    // every index points at a vertex
    expect(Math.max(...m.index)).toBeLessThan(9)
  })

  it('caps 254 (25.4 m or more) and never draws a quad with no water corner', () => {
    const depth = new Uint8Array(9).fill(255)
    depth[0] = 254
    const m = buildDepthMesh(depth, new Float32Array(9), 3, 3, 300)!
    expect(m.index.length).toBe(6) // only the top-left quad touches the water cell
    expect(Math.max(...m.depth)).toBeCloseTo(25.4, 4)
  })

  it('the ramp goes from light to dark blue as the depth grows', () => {
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
    for (let i = 1; i < DEPTH_RAMP.length; i++) {
      expect(DEPTH_RAMP[i][0]).toBeGreaterThan(DEPTH_RAMP[i - 1][0])
      expect(lum(DEPTH_RAMP[i][1])).toBeLessThan(lum(DEPTH_RAMP[i - 1][1]))
    }
  })
})
