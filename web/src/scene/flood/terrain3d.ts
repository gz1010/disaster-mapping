// Reading the flood bundle's 3D terrain products (brief 6, manifest.terrain3d; SPEC §5.4, contract6/backend-flood-time-3d):
// uint8 rasters on the 1024² render grid, row 0 north, metres = value × 0.1, 254 = 25.4 m or more, 255 = no value
// (outside the mapped water for a depth estimate; more than 10 km from a river channel for the height above the river).
// Pure; tested in terrain3d.test.ts.
import type { FloodTerrain3d, FloodTerrainProduct } from '../../api/types'

export const TERRAIN3D_SCALE_M = 0.1
export const TERRAIN3D_TOP = 254
export const TERRAIN3D_NODATA = 255

/** One cell's value in metres: null for no value; `top` true at 25.4 m or more. */
export function cellMetres(v: number, t3?: Pick<FloodTerrain3d, 'scale_m' | 'top_code' | 'nodata'> | null): { m: number; top: boolean } | null {
  const nodata = t3?.nodata ?? TERRAIN3D_NODATA
  const top = t3?.top_code ?? TERRAIN3D_TOP
  if (!Number.isFinite(v) || v === nodata) return null
  return { m: v * (t3?.scale_m ?? TERRAIN3D_SCALE_M), top: v >= top }
}

/** The raster cell under local (x, z) (row 0 = north = -z), or -1 outside the grid. */
export function cellIndex(x: number, z: number, width: number, height: number, extent: number): number {
  const c = Math.floor((x / extent + 0.5) * width)
  const r = Math.floor((z / extent + 0.5) * height)
  return c < 0 || r < 0 || c >= width || r >= height ? -1 : r * width + c
}

/** The depth product of one mapped water ('depth_satellite' | 'depth_forecast'). */
export function depthProduct(t3: FloodTerrain3d | null | undefined, key: 'depth_satellite' | 'depth_forecast'): FloodTerrainProduct | null {
  return t3?.depth.find((d) => d.key === key) ?? null
}

/** "0.4", "1.2", "12": a depth or height in metres as people read it. */
export function fmtMetres(m: number): string {
  return m >= 10 ? String(Math.round(m)) : (Math.round(m * 10) / 10).toFixed(1)
}
