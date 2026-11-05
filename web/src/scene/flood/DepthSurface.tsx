// The estimated water surface of the 3D flood view (brief 6, decision 3; web-forensic-flood-3d): a semi-transparent
// sheet at terrain + depth inside the mapped water only (FwDET, manifest.terrain3d; depthMesh.ts), tinted by depth
// (shallow light blue, deeper darker blue: DEPTH_RAMP), meeting the ground and fading out at the water's edge, under
// the height boost like the terrain (raw metres × the shared uExag). Which water it is of comes from depthChoice.ts
// (the satellite pass on screen, or the NWS forecast area); with none, nothing is drawn and the key says why. Fog and
// the area's edge fade match the terrain (fx GLSL_COMMON); nothing animates.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { shownOpacity, useForensicFlood } from '../../ui/forensic-flood/forensicFloodState'
import type { IncidentAssets } from '../assets'
import { GLSL_COMMON, GLSL_OUTPUT, fxUniforms } from '../fx/common'
import { useBundleRaster } from './bundleRaster'
import { buildDepthMesh, DEPTH_RAMP } from './depthMesh'
import { depthOnScreen, useDepthShown } from './flood3dHooks'
import type { FloodSceneAssets } from './floodAssets'

const vertexShader = /* glsl */ `
${GLSL_COMMON}
attribute float aDepth;
attribute float aInside;
varying float vDepth;
varying float vInside;
varying vec3 vWorld;
void main() {
  vec3 world = vec3(position.x, position.y * uExag, position.z);
  vWorld = world;
  vDepth = aDepth;
  vInside = aInside;
  // a little toward the camera (same pixel, smaller depth): where the estimate is 0 the sheet lies on the terrain
  gl_Position = projectionMatrix * fxViewPos(world, 0.0009);
}
`

const fragmentShader = /* glsl */ `
${GLSL_COMMON}
uniform float uOpacity;
uniform vec3 uRamp[4];
varying float vDepth;
varying float vInside;
varying vec3 vWorld;
vec3 ramp(float d) {
  vec3 c = mix(uRamp[0], uRamp[1], smoothstep(0.0, 1.0, d));
  c = mix(c, uRamp[2], smoothstep(1.0, 2.0, d));
  return mix(c, uRamp[3], smoothstep(2.0, 3.0, d));
}
void main() {
  float edge = smoothstep(0.2, 0.75, vInside);
  float d = vDepth / max(vInside, 0.35);
  vec3 col = ramp(d);
  // a faint sky sheen at grazing angles so the sheet reads as a surface (static: nothing moves)
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  col = mix(col, vec3(0.75, 0.86, 0.95), fres * 0.25);
  float alpha = mix(0.5, 0.86, smoothstep(0.0, 3.0, d)) * edge * uOpacity * fxKeep(vWorld);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
  ${GLSL_OUTPUT}
}
`

/** Per-frame opacity (a module object, like fxUniforms: one flood scene at a time). */
const depthOpacity = { value: 0.85 }

export function DepthSurface({ assets, flood }: { assets: IncidentAssets; flood: FloodSceneAssets }) {
  const setting = useForensicFlood((s) => s.layers.depth)
  const shown = useDepthShown(flood)
  const layer = shown?.from ? shown.layer : null
  const t3 = flood.terrain3d
  const satLayer = t3?.depth.find((d) => d.key === 'depth_satellite')?.layer ?? null
  const fcLayer = t3?.depth.find((d) => d.key === 'depth_forecast')?.layer ?? null
  // the bundle's own estimates are loaded with the flood; a playback pass's on demand
  const known = layer && layer === satLayer ? flood.arrays.depthSatellite : layer && layer === fcLayer ? flood.arrays.depthForecast : null
  const depth = useBundleRaster(flood.manifest, layer, known)
  const geometry = useMemo(() => {
    if (!depth) return null
    const m = buildDepthMesh(depth, assets.elevation.data, assets.elevation.width, assets.elevation.height, assets.extent, t3?.scale_m)
    if (!m) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    g.setAttribute('aDepth', new THREE.BufferAttribute(m.depth, 1))
    g.setAttribute('aInside', new THREE.BufferAttribute(m.inside, 1))
    g.setIndex(new THREE.BufferAttribute(m.index, 1))
    return g
  }, [depth, assets.elevation, assets.extent, t3?.scale_m])
  useEffect(() => () => geometry?.dispose(), [geometry])
  // the hover readout reads the same raster
  const drawn = setting.visible && geometry ? depth : null
  useEffect(() => {
    depthOnScreen.setState({ data: drawn })
    return () => depthOnScreen.setState({ data: null })
  }, [drawn])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        name: 'flood-depth-surface',
        vertexShader,
        fragmentShader,
        uniforms: { ...fxUniforms, uOpacity: depthOpacity, uRamp: { value: DEPTH_RAMP.map(([, hex]) => new THREE.Color(hex)) } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  useFrame(() => {
    depthOpacity.value = shownOpacity(setting)
  })
  if (!setting.visible || !geometry) return null
  // after the opaque terrain, before the warning lines and gauge bars (they stay on top)
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={5} name="flood-depth-surface" />
}
