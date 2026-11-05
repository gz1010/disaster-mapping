// The estimated water surface of the 3D flood view as a mesh (brief 6, decision 3; web-forensic-flood-3d). Pure; tested
// in depthMesh.test.ts; drawn by DepthSurface.tsx.
// Input: a depth estimate (uint8 0.1 m, 255 = no value = outside the mapped water; FwDET, manifest.terrain3d) and the
// terrain heights, both on the render grid (row 0 north). The surface has a vertex at every cell centre of the mapped
// water and of its rim: water cells sit at terrain + depth (the estimated water surface), rim cells at the terrain
// with `inside` 0, so the surface meets the ground at the water's edge and its alpha fades out there. Quads with at
// least one water corner are drawn, triangulated like the terrain mesh (alternating diagonals), so where the depth is 0
// the surface lies exactly on the terrain (DepthSurface pulls it toward the camera a little). Nothing is drawn
// outside the mapped water.
import { TERRAIN3D_NODATA, TERRAIN3D_SCALE_M, TERRAIN3D_TOP } from './terrain3d'

export interface DepthMesh {
  /** x, y (metres, not exaggerated: terrain + depth), z per vertex. */
  positions: Float32Array
  /** Depth (m) per vertex; 0 on the rim. */
  depth: Float32Array
  /** 1 for a cell of the mapped water, 0 for a rim cell. */
  inside: Float32Array
  index: Uint32Array
  /** Water cells. */
  cells: number
}

/** The mesh of a depth raster, or null when it holds no water cell. */
export function buildDepthMesh(depth: Uint8Array, elev: Float32Array, width: number, height: number, extent: number, scale = TERRAIN3D_SCALE_M): DepthMesh | null {
  const w = width
  const h = height
  if (depth.length !== w * h || elev.length !== w * h) return null
  const wet = (i: number) => depth[i] !== TERRAIN3D_NODATA
  // which vertices the drawn quads use
  const vid = new Int32Array(w * h).fill(-1)
  let nv = 0
  let nq = 0
  let cells = 0
  for (let i = 0; i < w * h; i++) if (wet(i)) cells++
  if (!cells) return null
  for (let r = 0; r < h - 1; r++) {
    for (let c = 0; c < w - 1; c++) {
      const a = r * w + c
      if (!(wet(a) || wet(a + 1) || wet(a + w) || wet(a + w + 1))) continue
      nq++
      for (const k of [a, a + 1, a + w, a + w + 1]) if (vid[k] < 0) vid[k] = nv++
    }
  }
  if (!nq) return null
  const positions = new Float32Array(nv * 3)
  const dep = new Float32Array(nv)
  const inside = new Float32Array(nv)
  const res = extent / w
  const half = extent / 2
  const top = TERRAIN3D_TOP * scale
  for (let i = 0; i < w * h; i++) {
    const v = vid[i]
    if (v < 0) continue
    const r = Math.floor(i / w)
    const c = i - r * w
    const d = wet(i) ? Math.min(depth[i] * scale, top) : 0
    positions[v * 3] = -half + (c + 0.5) * res
    positions[v * 3 + 1] = elev[i] + d
    positions[v * 3 + 2] = -half + (r + 0.5) * (extent / h)
    dep[v] = d
    inside[v] = wet(i) ? 1 : 0
  }
  const index = new Uint32Array(nq * 6)
  let k = 0
  for (let r = 0; r < h - 1; r++) {
    for (let c = 0; c < w - 1; c++) {
      const a0 = r * w + c
      if (!(wet(a0) || wet(a0 + 1) || wet(a0 + w) || wet(a0 + w + 1))) continue
      const a = vid[a0]
      const b = vid[a0 + 1]
      const d = vid[a0 + w]
      const e = vid[a0 + w + 1]
      // the terrain mesh's diagonals (scene/terrain/Terrain.tsx buildTerrainGeometry)
      if ((r + c) & 1) {
        index[k++] = a; index[k++] = d; index[k++] = b
        index[k++] = b; index[k++] = d; index[k++] = e
      } else {
        index[k++] = a; index[k++] = d; index[k++] = e
        index[k++] = a; index[k++] = e; index[k++] = b
      }
    }
  }
  return { positions, depth: dep, inside, index, cells }
}

/** The depth ramp's stops (metres → sRGB hex): shallow light blue, deeper darker blue (styles/forensic-flood.css
 *  --fxf-depth-*; the Layers tab's legend). */
export const DEPTH_RAMP: readonly [number, string][] = [
  [0, '#a9dcff'],
  [1, '#3f8fe0'],
  [2, '#1f5fb5'],
  [3, '#0d2f73'],
]
