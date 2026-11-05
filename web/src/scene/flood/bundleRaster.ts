// One uint8 raster of the open flood's bundle, loaded on demand (brief 6, web-forensic-flood-3d): a playback pass's
// water classes (water_pass_<key>) or depth estimate (depth_pass_<key>), by manifest.layers key. Downloads go through
// the shared raster cache's fetch (fetchArrayBuffer); results are kept per flood bundle (id@built_ms) and a few at a
// time, so stepping back and forth through the passes does not fetch again.
import { useEffect, useState } from 'react'
import { fetchArrayBuffer } from '../../api/client'
import { floodFileUrl } from '../../api/floods'
import type { FloodManifest } from '../../api/types'

const MAX_KEPT = 24
const kept = new Map<string, Promise<Uint8Array | null>>()

function load(m: Pick<FloodManifest, 'id' | 'built_ms' | 'layers'>, layer: string): Promise<Uint8Array | null> {
  const k = `${m.id}@${m.built_ms}/${layer}`
  const hit = kept.get(k)
  if (hit) {
    kept.delete(k)
    kept.set(k, hit)
    return hit
  }
  const info = m.layers[layer]
  const p: Promise<Uint8Array | null> = !info
    ? Promise.resolve(null)
    : fetchArrayBuffer(floodFileUrl(m.id, info.file, m.built_ms)).then(
        (buf) => {
          const a = new Uint8Array(buf)
          return a.length === (info.width ?? 0) * (info.height ?? 0) ? a : null
        },
        (e) => {
          console.warn(`[flood 3d] layer ${layer} unavailable`, e)
          kept.delete(k)
          return null
        },
      )
  kept.set(k, p)
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value as string)
  return p
}

/** The raster of `layer` (null while loading, when the bundle has no such layer, or when it failed). `known` is used
 *  as is when given (a layer the flood's assets already hold). */
export function useBundleRaster(m: Pick<FloodManifest, 'id' | 'built_ms' | 'layers'> | null, layer: string | null, known?: Uint8Array | null): Uint8Array | null {
  const [state, setState] = useState<{ key: string; data: Uint8Array | null } | null>(null)
  const key = m && layer ? `${m.id}@${m.built_ms}/${layer}` : null
  useEffect(() => {
    if (!m || !layer || !key || known) return
    let live = true
    void load(m, layer).then((data) => {
      if (live) setState({ key, data })
    })
    return () => {
      live = false
    }
  }, [m, layer, key, known])
  if (known) return known
  return state && state.key === key ? state.data : null
}
