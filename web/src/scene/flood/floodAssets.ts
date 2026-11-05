// The 3D scene's assets for an open flood (brief 5, PLAN-5 §4.7, CONTRACT §16.12): the same shape the fire scene uses
// (scene/assets.ts IncidentAssets, with every fire texture and array null and a manifest typed SceneManifest whose
// ignition is null, so nothing is cast) plus a `flood` part: the drape pack (r NWS forecast flooded area, g FEMA
// floodplain, b National Water Model, a NWS category flood map), the satellite water classes with their lookup
// texture, the frozen official copies (warnings.json, gauges.json, satellite.json) and the framing box.
// Loaded once per (flood id, built_ms) from /api/floods/{id}/files/…; old textures are disposed when the flood or its
// bundle changes. Optional layers that fail to load are left out (the Layers tab says why from manifest.layer_status).
import { useEffect } from 'react'
import * as THREE from 'three'
import { create } from 'zustand'
import { fetchArrayBuffer, fetchJson } from '../../api/client'
import { floodFileUrl } from '../../api/floods'
import type { FeatureCollectionJson, FloodAlertsResponse, FloodManifest, FloodSummary, LayerInfo, RiverGaugesResponse, SatelliteWaterResponse } from '../../api/types'
import { sampleBilinear } from '../../lib/geo'
import { dataTexture, flipRows, imageTexture, type LoadedLayer } from '../../lib/raster'
import { useFlood } from '../../state/flood'
import type { IncidentAssets, SceneManifest } from '../assets'
import { anySet, chooseCatfim, featurePolygons, floodFrameOf, maskAnchor, packFloodLayers, rasterizePolygons, type CatfimChoice, type FloodFrame } from './floodGeo'
import { satLutData } from './satClasses'

export interface FloodSceneAssets {
  manifest: FloodManifest
  summary: FloodSummary
  textures: {
    /** RGBA, linear: r NWS forecast flooded area, g FEMA floodplain (floodGeo FLOODPLAIN_PACK), b NWM, a CatFIM. */
    pack: THREE.DataTexture | null
    /** DSWx classes (uint8, nearest; satClasses.ts), null without a satellite layer. */
    satWater: THREE.DataTexture | null
    /** 256 x 2 class lookup (satClasses.satLutData). */
    satLut: THREE.DataTexture
  }
  /** Which drapes have anything to draw. */
  has: { forecast: boolean; floodplain: boolean; model: boolean; catfim: boolean; satellite: boolean }
  /** Render-grid rasters as stored (row 0 = north), for the probe and the key. */
  arrays: {
    width: number
    height: number
    forecast: Uint8Array | null
    floodplain: Uint8Array | null
    model: Uint8Array | null
    catfim: Uint8Array | null
    satellite: Uint8Array | null
  }
  catfim: CatfimChoice | null
  warnings: FloodAlertsResponse | null
  gauges: RiverGaugesResponse | null
  satellite: SatelliteWaterResponse | null
  frame: FloodFrame
  /** Local [x, z] points to hang the drape labels on. */
  anchors: { model: [number, number] | null; catfim: [number, number] | null }
}

/** The scene's flood assets: the fire shape with fire parts null, plus `flood`. */
export type FloodAssets = IncidentAssets & { flood: FloodSceneAssets }

interface FloodAssetsState {
  assets: FloodAssets | null
  loading: boolean
  error: string | null
}

/** Imperative access (hand-off, frames): floodAssetStore.getState().assets */
export const floodAssetStore = create<FloodAssetsState>()(() => ({ assets: null, loading: false, error: null }))

let current: FloodAssets | null = null
let currentKey: string | null = null

const keyOf = (m: FloodManifest | null) => (m && m.status === 'ready' ? `${m.id}@${m.built_ms}` : null)

/** The manifest fields the scene reads (CONTRACT §16.12): a flood has no ignition. */
export function sceneManifestOf(m: FloodManifest): SceneManifest {
  return { id: m.id, grid: m.grid, time_origin_ms: m.time_origin_ms, time_range: m.time_range, built_ms: m.built_ms, status: m.status, mode: m.mode, ignition: null }
}

let lut: THREE.DataTexture | null = null
/** The satellite class lookup texture (shared, created once). */
export function satLutTexture(): THREE.DataTexture {
  if (!lut) {
    lut = new THREE.DataTexture(satLutData(), 256, 2, THREE.RGBAFormat, THREE.UnsignedByteType)
    lut.name = 'flood_sat_lut'
    lut.minFilter = THREE.NearestFilter
    lut.magFilter = THREE.NearestFilter
    lut.generateMipmaps = false
    lut.colorSpace = THREE.NoColorSpace
    lut.needsUpdate = true
  }
  return lut
}

async function optional<T>(name: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch (e) {
    console.warn(`[flood assets] optional part ${name} unavailable`, e)
    return null
  }
}

async function loadRaster(m: FloodManifest, name: string): Promise<LoadedLayer> {
  const info: LayerInfo | undefined = m.layers[name]
  if (!info) throw new Error(`layer ${name} is not in the manifest`)
  const url = floodFileUrl(m.id, info.file, m.built_ms)
  const buf = await fetchArrayBuffer(url)
  const data = info.dtype === 'float32' ? new Float32Array(buf) : new Uint8Array(buf)
  const width = info.width ?? 0
  const height = info.height ?? 0
  if (data.length !== width * height) throw new Error(`layer ${name}: expected ${width}x${height}, got ${data.length} values`)
  return { name, url, info, data, width, height }
}

const json = <T,>(m: FloodManifest, path: string | null | undefined): Promise<T | null> => (path ? optional(path, fetchJson<T>(floodFileUrl(m.id, path, m.built_ms))) : Promise.resolve(null))

/** Layers whose layer_status is ok (a layer the build could not make may still have no file). */
const usable = (m: FloodManifest, layer: string, key: keyof FloodManifest['layer_status']) => Boolean(m.layers[layer]) && m.layer_status[key]?.status === 'ok'

function u8(l: LoadedLayer | null): Uint8Array | null {
  return l?.data instanceof Uint8Array ? l.data : null
}

function packTexture(data: Uint8Array, w: number, h: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(flipRows(data, w, h, 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.name = 'flood_pack'
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.generateMipmaps = false
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

async function loadFloodAssets(m: FloodManifest, summary: FloodSummary, key: string): Promise<FloodAssets> {
  const opt = (name: string, statusKey: keyof FloodManifest['layer_status']) => (usable(m, name, statusKey) ? optional(name, loadRaster(m, name)) : Promise.resolve(null))
  const catfimPrimary = summary.primary_gauge
  const catfim = chooseCatfim(m.files.maps, catfimPrimary ? { lid: catfimPrimary.lid, forecast_category: catfimPrimary.forecast_category, observed_category: catfimPrimary.observed_category } : null)
  const naipInfo = m.layers.naip
  const [elev, sky, forecast, floodplain, model, satellite, naip, warnings, gauges, satJson, catfimFc] = await Promise.all([
    loadRaster(m, 'elevation'),
    m.layers.sky_view ? optional('sky_view', loadRaster(m, 'sky_view')) : Promise.resolve(null),
    opt('water_forecast', 'water_forecast'),
    opt('floodplain', 'floodplain'),
    opt('water_model', 'water_model'),
    opt('water_satellite', 'water_satellite'),
    naipInfo && m.layer_status.naip?.status === 'ok' ? optional('naip', imageTexture(floodFileUrl(m.id, naipInfo.file, m.built_ms))) : Promise.resolve(null),
    json<FloodAlertsResponse>(m, m.files.warnings),
    json<RiverGaugesResponse>(m, m.files.gauges),
    json<SatelliteWaterResponse>(m, m.files.satellite),
    catfim ? json<FeatureCollectionJson>(m, m.files.maps[catfim.key]) : Promise.resolve(null),
  ])
  const ed = elev.data as Float32Array
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < ed.length; i++) {
    const v = ed[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  const extent = m.grid.extent_m
  const w = elev.width
  const h = elev.height
  const same = (a: Uint8Array | null) => (a && a.length === w * h ? a : null)
  const fArr = same(u8(forecast))
  const pArr = same(u8(floodplain))
  const mArr = same(u8(model))
  const sArr = same(u8(satellite))
  const cArr = catfimFc ? rasterizePolygons(featurePolygons(catfimFc, m.grid), w, h, extent) : null
  const has = { forecast: anySet(fArr), floodplain: Boolean(pArr && pArr.some((v) => v > 0)), model: anySet(mArr), catfim: anySet(cArr), satellite: sArr != null }
  const pack = has.forecast || has.floodplain || has.model || has.catfim ? packTexture(packFloodLayers(w * h, { forecast: fArr, floodplain: pArr, model: mArr, catfim: cArr }), w, h) : null
  const satWater = sArr && satellite ? dataTexture({ name: 'water_satellite', url: satellite.url, info: satellite.info, data: sArr, width: w, height: h }, { filter: 'nearest' }) : null
  const scene = sceneManifestOf(m)
  return {
    ready: true,
    manifest: scene,
    forecast: null,
    key: `${key}#flood`,
    extent,
    elevation: { data: ed, width: w, height: h, min, max },
    textures: {
      elevation: dataTexture(elev, { filter: 'linear', type: 'float' }),
      observedArrival: null,
      arrivalP10: null,
      arrivalP50: null,
      arrivalP90: null,
      burnProbability: null,
      fuel: null,
      canopyCover: null,
      burnSeverity: null,
      skyView: sky ? dataTexture(sky) : null,
      water: null,
      naip,
      forecastPacked: null,
      observedField: null,
      forecastField: null,
    },
    arrays: {
      observedArrival: null,
      arrivalP50: null,
      trees: null,
      fireGrid: { width: m.grid.fire.width, height: m.grid.fire.height },
      fuel: null,
      canopyCover: null,
      arrivalP10: null,
      arrivalP90: null,
      burnProbability: null,
    },
    heightAt: (x: number, z: number) => sampleBilinear(ed, w, h, x, z, extent),
    flood: {
      manifest: m,
      summary,
      textures: { pack, satWater, satLut: satLutTexture() },
      has,
      arrays: { width: w, height: h, forecast: fArr, floodplain: pArr, model: mArr, catfim: cArr, satellite: sArr },
      catfim: has.catfim ? catfim : null,
      warnings: warnings?.kind === 'flood_alerts' ? warnings : null,
      gauges: gauges?.kind === 'river_gauges' ? gauges : null,
      satellite: satJson?.kind === 'satellite_water' ? satJson : null,
      frame: floodFrameOf(summary, m.grid),
      anchors: { model: maskAnchor(mArr, w, h, extent), catfim: maskAnchor(cArr, w, h, extent) },
    },
  }
}

function dispose(a: FloodAssets | null): void {
  if (!a) return
  for (const t of Object.values(a.textures)) t?.dispose()
  a.flood.textures.pack?.dispose()
  a.flood.textures.satWater?.dispose()
}

/** Bring the flood assets in line with the open flood's manifest (idempotent; safe to call often). */
export async function syncFloodAssets(): Promise<void> {
  const { manifest, summary, floodId } = useFlood.getState()
  const m = manifest && manifest.id === floodId ? manifest : null
  const want = keyOf(m)
  if (want === currentKey) return
  dispose(current)
  current = null
  currentKey = want
  floodAssetStore.setState({ assets: null })
  if (!want || !m) {
    floodAssetStore.setState({ loading: false, error: null })
    return
  }
  floodAssetStore.setState({ loading: true, error: null })
  try {
    const a = await loadFloodAssets(m, summary && summary.id === m.id ? summary : m.summary, want)
    if (currentKey !== want) {
      dispose(a)
      return
    }
    current = a
    floodAssetStore.setState({ assets: a, loading: false })
  } catch (e) {
    if (currentKey === want) {
      currentKey = null
      floodAssetStore.setState({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
}

/** The open flood's scene assets (null until its terrain is loaded, and while no flood with a ready bundle is open). */
export function useFloodAssets(): FloodAssets | null {
  const mKey = useFlood((s) => (s.manifest && s.manifest.id === s.floodId ? `${s.manifest.id}@${s.manifest.built_ms}:${s.manifest.status}` : null))
  useEffect(() => {
    void syncFloodAssets()
  }, [mKey])
  return floodAssetStore((s) => s.assets)
}

export const useFloodAssetsLoading = () => floodAssetStore((s) => s.loading)
export const useFloodAssetsError = () => floodAssetStore((s) => s.error)
