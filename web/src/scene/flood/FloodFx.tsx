// The 3D flood view's own effects (brief 5, PLAN-5 §4.7), mounted by Scene.tsx instead of the fire effects (SceneFx):
//   FloodFxDriver  the per-frame shared fx uniforms (exaggeration, viewport, fog) the draped lines and labels read
//                  (the fire FxDriver is not mounted for a flood)
//   WarningLines   NWS warning areas as pink lines draped on the terrain (scene/fx/lines.ts ribbons), the products drawn
//                  at the hydrograph handle (brief 6: state/floodTimeline.ts productsAt via useProductsOnScreen: before
//                  now the time history's versions from GET /timeline, each from its issue time until its own end;
//                  at and after now the ones in effect NOW, C1). Warnings 2 px, advisories 1.6 px, watches dashed
//   SatelliteEdge  the satellite image's edge (thin dashed grey), so "no view" outside it never reads as dry ground
//   DrapeLabels    "MODEL · EXPERIMENTAL" (amber) and "NWS CATEGORY MAP · EXPERIMENTAL" on those drapes when switched on
//   GaugeBars      the river gauges as thin bars (GaugeBars.tsx)
// Brief 6 (web-forensic-flood-3d):
//   HeightBoost    the flood's height boost on the shared exaggeration while the flood scene is mounted (heightBoost.ts:
//                  the automatic value from the bundle's relief, or the user's choice for this flood); the fire view's
//                  own value comes back when it unmounts. A layout effect, so the camera frames the flood at its height
//   DepthSurface   the estimated water surface (FwDET) with its depth tint, inside the mapped water only (DepthSurface.tsx)
//   PassDrapeDriver the satellite drape at the river-level chart's handle (floodPassDrape.ts): a kept pass's classes
//                  from the bundle (loaded on demand), else its 2D picture, else nothing; SatelliteEdge follows the
//                  pass on screen
// Nothing here animates: lines, bars and labels are static (prefers-reduced-motion has nothing to stop).
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { apiPathUrl } from '../../api/floods'
import { dataTexture } from '../../lib/raster'
import { lonLatToLocal } from '../../lib/reproject'
import { useFloodTimelineSync } from '../../state/floodTimelineData'
import { useStore } from '../../state/store'
import { shownOpacity, useForensicFlood } from '../../ui/forensic-flood/forensicFloodState'
import { FLOOD_FORENSIC } from '../../ui/forensic-flood/floodForensicCopy'
import type { IncidentAssets } from '../assets'
import { GLSL_COMMON, GLSL_OUTPUT, GLSL_VERT, ORDER, STYLE_INDEX, fogDensity, fxUniforms } from '../fx/common'
import { GLSL_RIBBON_FRAG, GLSL_RIBBON_VERT, drape, ribbonGeometry, type RibbonLine } from '../fx/lines'
import { InOverlay, Overlay, ScreenLabel } from '../fx/text'
import { useSceneStore } from '../sceneStore'
import type { FloodSceneAssets } from './floodAssets'
import { useBundleRaster } from './bundleRaster'
import { DepthSurface } from './DepthSurface'
import { imageAffine, passDrapeGpu, usePassDrape } from './floodPassDrape'
import { useProductsOnScreen } from './flood3dHooks'
import { clipRingToBox, polygonsLocal } from './floodGeo'
import { GaugeBars } from './GaugeBars'
import { boostInUse } from './heightBoost'
import { SAT_NO_VIEW } from './satClasses'

const DEFAULT_FOG = new THREE.Color('#0b0f0d')

/** The shared fx uniforms (scene/fx/common.ts fxUniforms) the ribbons and labels read, once per frame. */
function FloodFxDriver({ extent }: { extent: number }) {
  useFrame((state, delta) => {
    const s = useStore.getState()
    const u = fxUniforms
    u.uClock.value += Math.min(0.1, Math.max(0, delta))
    u.uTimeH.value = 0
    u.uExag.value = s.exaggeration
    u.uExtent.value = extent
    u.uStyle.value = STYLE_INDEX[s.visualStyle]
    const dpr = state.gl.getPixelRatio()
    u.uPixelRatio.value = dpr
    u.uViewport.value.set(Math.max(1, state.size.width * dpr), Math.max(1, state.size.height * dpr))
    const env = useSceneStore.getState().env
    if (env) {
      u.uFogColor.value.setRGB(env.fogColor[0], env.fogColor[1], env.fogColor[2])
      u.uFogDensity.value = env.fogDensity
      u.uFogFalloff.value = env.fogFalloff
      u.uFogBaseY.value = env.fogBaseY
      u.uLineGain.value = env.lineGain
    } else {
      u.uFogColor.value.copy(DEFAULT_FOG)
      u.uFogDensity.value = fogDensity(extent)
      u.uFogFalloff.value = 0
      u.uFogBaseY.value = 0
      u.uLineGain.value = 1
    }
    const controls = state.controls as unknown as { target?: THREE.Vector3 } | null
    u.uCamDist.value = controls?.target ? state.camera.position.distanceTo(controls.target) : state.camera.position.length()
  }, -2)
  return null
}

const lineVertex = /* glsl */ `
${GLSL_COMMON}
${GLSL_VERT}
${GLSL_RIBBON_VERT}
uniform float uOpacity;
uniform float uWidth;
varying float vAlpha;
varying float vDashed;
void main() {
  gl_Position = fxRibbon(uWidth * aData.y, 3.0, 0.0016);
  vec3 world = vec3(position.x, position.y * uExag, position.z);
  vAlpha = fxKeep(world) * uOpacity * aData.x;
  vDashed = aData.z;
  if (vAlpha < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`

const lineFragment = /* glsl */ `
${GLSL_COMMON}
${GLSL_RIBBON_FRAG}
uniform vec3 uColor;
uniform float uDashScale;
varying float vAlpha;
varying float vDashed;
void main() {
  float a = fxRibbonAlpha();
  // world dash length from the camera distance, snapped to powers of two (dashes never crawl while zooming)
  float dl = exp2(floor(log2(max(8.0, uCamDist * uDashScale)) + 0.5));
  float dash = vDashed > 0.5 ? step(0.45, fract(vAlong / dl)) : 1.0;
  gl_FragColor = vec4(uColor, vAlpha * a * dash);
  ${GLSL_OUTPUT}
}
`

/** Per-frame opacities (module objects, like fxUniforms: one flood scene at a time). */
const warningOpacity = { value: 1 }
const edgeOpacity = { value: 1 }

function lineMaterial(hex: string, width: number, opacity: { value: number }, dashScale: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    uniforms: { ...fxUniforms, uOpacity: opacity, uWidth: { value: width }, uColor: { value: new THREE.Color(hex) }, uDashScale: { value: dashScale } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Pieces of outline (open polylines inside the bundle area), draped. */
function drapedOutline(rings: Float64Array[], half: number, heightAt: (x: number, z: number) => number, maxSeg: number, data: [number, number, number, number], out: RibbonLine[]): void {
  for (const ring of rings) for (const part of clipRingToBox(ring, half * 0.999)) out.push({ pts: drape(part, heightAt, maxSeg), constData: data })
}

const PRODUCT_STYLE = (event: string): [number, number] => {
  // [width factor, dashed]
  if (/warning/i.test(event)) return [1, 0]
  if (/advisory/i.test(event)) return [0.8, 0]
  if (/watch/i.test(event)) return [0.75, 1]
  return [0.7, 0]
}

function WarningLines({ assets, flood }: { assets: IncidentAssets; flood: FloodSceneAssets }) {
  const visible = useForensicFlood((s) => s.layers.warnings.visible)
  const opacity = useForensicFlood((s) => s.layers.warnings.opacity)
  // brief 6 (playback): before now the time history's versions (GET /timeline), else the bundle's copy (productsAt)
  const shown = useProductsOnScreen(flood)
  const drawn = useMemo(() => shown?.alerts ?? [], [shown])
  const zones = shown?.zones ?? null
  const drawnKey = drawn.map((a) => a.id).join('|')
  const geometry = useMemo(() => {
    if (!drawn.length) return null
    const grid = flood.manifest.grid
    const half = assets.extent / 2
    const maxSeg = Math.max(24, (assets.extent / assets.elevation.width) * 2)
    const lines: RibbonLine[] = []
    for (const a of drawn) {
      const [wf, dashed] = PRODUCT_STYLE(a.event)
      const data: [number, number, number, number] = [a.emergency ? 1 : 0.92, a.emergency ? 1.25 : wf, dashed, 0]
      const polys = a.geometry ? polygonsLocal(a.geometry, grid) : (zones?.features ?? []).filter((f) => f.properties.alert_ids.includes(a.id)).flatMap((f) => polygonsLocal(f.geometry, grid))
      for (const poly of polys) drapedOutline(poly, half, assets.heightAt, maxSeg, data, lines)
    }
    return lines.length ? ribbonGeometry(lines) : null
    // drawnKey stands for `drawn`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawnKey, assets.heightAt, assets.extent, flood.manifest.grid, zones])
  useEffect(() => () => geometry?.dispose(), [geometry])
  const material = useMemo(() => lineMaterial('#ee7aa0', 2.2, warningOpacity, 0.012), [])
  useEffect(() => () => material.dispose(), [material])
  useFrame(() => {
    warningOpacity.value = opacity
  })
  if (!visible || !geometry) return null
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={ORDER.perimeters} name="flood-warning-lines" />
}

/** Brief 6: the satellite drape at the chart's handle (floodPassDrape.ts): the textures the terrain swaps in. */
function PassDrapeDriver({ flood }: { flood: FloodSceneAssets }) {
  useFloodTimelineSync(flood.manifest.id)
  const d = usePassDrape(flood)
  const layerName = d?.mode === 'raster' ? d.waterLayer : null
  const raster = useBundleRaster(flood.manifest, layerName)
  const w = flood.arrays.width
  const h = flood.arrays.height
  const layers = flood.manifest.layers
  const satTex = useMemo(() => {
    if (!raster || !layerName || raster.length !== w * h) return null
    const info = layers[layerName]
    return info ? dataTexture({ name: layerName, url: '', info, data: raster, width: w, height: h }, { filter: 'nearest' }) : null
  }, [raster, layerName, layers, w, h])
  useEffect(() => () => satTex?.dispose(), [satTex])
  const imgUrl = d?.mode === 'image' && d.image ? apiPathUrl(d.image.url) : null
  const [img, setImg] = useState<{ url: string; tex: THREE.Texture } | null>(null)
  useEffect(() => {
    if (!imgUrl) return
    let live = true
    let made: THREE.Texture | null = null
    new THREE.TextureLoader().load(
      imgUrl,
      (tex) => {
        tex.colorSpace = THREE.NoColorSpace // the shader converts the picture's sRGB itself
        tex.minFilter = THREE.LinearFilter
        tex.generateMipmaps = false
        made = tex
        if (live) setImg({ url: imgUrl, tex })
        else tex.dispose()
      },
      undefined,
      () => {
        if (live) setImg(null)
      },
    )
    return () => {
      live = false
      made?.dispose()
    }
  }, [imgUrl])
  const imgTex = img && img.url === imgUrl ? img.tex : null
  const affine = useMemo(() => (d?.mode === 'image' && d.image ? imageAffine(d.image.bounds_lonlat, flood.manifest.grid) : null), [d, flood.manifest.grid])
  useEffect(() => {
    const g = passDrapeGpu
    g.mode = d ? d.mode : 'bundle'
    g.sat = d?.mode === 'raster' ? satTex : null
    g.img = d?.mode === 'image' && affine ? imgTex : null
    if (affine) {
      g.imgU.set(affine.u[0], affine.u[1], affine.u[2])
      g.imgV.set(affine.v[0], affine.v[1], affine.v[2])
    }
  }, [d, satTex, imgTex, affine])
  useEffect(
    () => () => {
      passDrapeGpu.mode = 'bundle'
      passDrapeGpu.sat = null
      passDrapeGpu.img = null
    },
    [],
  )
  return null
}

function SatelliteEdge({ assets, flood }: { assets: IncidentAssets; flood: FloodSceneAssets }) {
  const visible = useForensicFlood((s) => s.layers.satellite.visible)
  const sat = flood.satellite
  // brief 6: the edge of the pass on screen (the chart's handle), else the 3D data's own image
  const d = usePassDrape(flood)
  const passBounds = d ? (d.mode === 'none' ? null : (d.pass?.image?.bounds_lonlat ?? (d.mode === 'bundle' && sat?.image ? sat.image.bounds_lonlat : null))) : undefined
  const ownBounds = sat?.measured && sat.image ? sat.image.bounds_lonlat : null
  const bounds = passBounds === undefined ? (flood.has.satellite ? ownBounds : null) : passBounds
  const geometry = useMemo(() => {
    if (!bounds) return null
    const [w, s, e, n] = bounds
    const grid = flood.manifest.grid
    const steps = 32
    const ring = new Float64Array(steps * 4 * 2)
    const corners: [number, number][] = [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
    ]
    let k = 0
    for (let c = 0; c < 4; c++) {
      const [ax, ay] = corners[c]
      const [bx, by] = corners[(c + 1) % 4]
      for (let i = 0; i < steps; i++) {
        const t = i / steps
        const [x, z] = lonLatToLocal(ax + (bx - ax) * t, ay + (by - ay) * t, grid)
        ring[k++] = x
        ring[k++] = z
      }
    }
    const lines: RibbonLine[] = []
    drapedOutline([ring], assets.extent / 2, assets.heightAt, Math.max(24, (assets.extent / assets.elevation.width) * 2), [0.85, 0.6, 1, 0], lines)
    return lines.length ? ribbonGeometry(lines) : null
  }, [bounds, flood.manifest.grid, assets.extent, assets.heightAt, assets.elevation.width])
  useEffect(() => () => geometry?.dispose(), [geometry])
  const material = useMemo(() => lineMaterial(SAT_NO_VIEW, 1.6, edgeOpacity, 0.006), [])
  useEffect(() => () => material.dispose(), [material])
  if (!visible || !geometry) return null
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={ORDER.perimeters} name="flood-satellite-edge" />
}

function DrapeLabel({ assets, at, text, color }: { assets: IncidentAssets; at: [number, number]; text: string; color: string }) {
  const anchor = useMemo(
    () => (out: THREE.Vector3) => {
      out.set(at[0], assets.heightAt(at[0], at[1]) * useStore.getState().exaggeration + 6, at[1])
      return true
    },
    [assets, at],
  )
  return <ScreenLabel anchor={anchor} text={text} color={color} fontPx={10.5} offset={[14, 18]} leader dot opacity={0.9} />
}

function DrapeLabels({ assets, flood }: { assets: IncidentAssets; flood: FloodSceneAssets }) {
  const model = useForensicFlood((s) => shownOpacity(s.layers.model) > 0)
  const catfim = useForensicFlood((s) => shownOpacity(s.layers.catfim) > 0)
  const a = flood.anchors
  return (
    <InOverlay>
      {model && flood.has.model && a.model && <DrapeLabel assets={assets} at={a.model} text={FLOOD_FORENSIC.modelDrapeLabel} color="#f5c060" />}
      {catfim && flood.has.catfim && a.catfim && <DrapeLabel assets={assets} at={a.catfim} text={FLOOD_FORENSIC.catfimDrapeLabel} color="#cfeaff" />}
    </InOverlay>
  )
}

/** The flood's height boost on the shared exaggeration (store.exaggeration, which the terrain, camera, probe, lines and
 *  bars all read) while this flood's scene is mounted; the value from before (the fire view's) comes back after. */
function HeightBoost({ floodId, auto }: { floodId: string; auto: number }) {
  useLayoutEffect(() => {
    const before = useStore.getState().exaggeration
    const apply = () => {
      const { factor } = boostInUse(floodId, auto, useForensicFlood.getState().boost)
      if (useStore.getState().exaggeration !== factor) useStore.getState().setExaggeration(factor)
    }
    apply()
    const unsub = useForensicFlood.subscribe((s, p) => {
      if (s.boost !== p.boost) apply()
    })
    return () => {
      unsub()
      useStore.getState().setExaggeration(before)
    }
  }, [floodId, auto])
  return null
}

export function FloodFx({ assets, flood }: { assets: IncidentAssets; flood: FloodSceneAssets }) {
  return (
    <Overlay>
      <HeightBoost floodId={flood.manifest.id} auto={flood.boost.factor} />
      <PassDrapeDriver flood={flood} />
      <FloodFxDriver extent={assets.extent} />
      <DepthSurface assets={assets} flood={flood} />
      <WarningLines assets={assets} flood={flood} />
      <SatelliteEdge assets={assets} flood={flood} />
      <GaugeBars assets={assets} flood={flood} />
      <DrapeLabels assets={assets} flood={flood} />
    </Overlay>
  )
}

export default FloodFx
