// River gauges in 3D (brief 5, PLAN-5 §4.7): thin vertical bars on the terrain at each gauge of the flood's bundle
// (members bright, nearby gauges dimmer), ticks at NWS's action / minor / moderate / major flood stages in the
// category colours, a bright cap at the latest reading, a hollow cap at NWS's forecast crest (or forecast high), and a
// mono label "ZZRF1 · 17.6 FT · MODERATE · 6:25 PM MST". Fixed scale (1 ft of stage = 12 m of bar; gaugeBarMath.ts);
// the key says "Bar height: river stage at the gauge (scaled), not water depth". Static: nothing animates. Members are
// read through memberGaugesOf (one reading per gauge, review WFP-R2); a gauges answer that could not be read draws none.
// Labels mirror to the left before they run under the right column and hide under the panels and the scene key
// (gaugeBarMath.placeBarLabel, floodOverlayRects; review WFF-R8).
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { memberGaugesOf } from '../../official/floodModel'
import { useStore } from '../../state/store'
import { useTimeFormat } from '../../state/timeZone'
import { useWorkspace } from '../../state/workspace'
import { shownOpacity, useForensicFlood } from '../../ui/forensic-flood/forensicFloodState'
import { useNow } from '../../ui/hooks'
import type { IncidentAssets } from '../assets'
import { GLSL_COMMON, GLSL_OUTPUT, GLSL_VERT, ORDER, fxUniforms, prefersReducedMotion } from '../fx/common'
import { GLSL_RIBBON_FRAG, GLSL_RIBBON_VERT, GLSL_SPRITE_VERT, ribbonGeometry, spriteGeometry, type RibbonLine } from '../fx/lines'
import { InOverlay, ScreenLabel } from '../fx/text'
import { useSceneStore } from '../sceneStore'
import type { FloodSceneAssets } from './floodAssets'
import { floodOverlayRects } from './floodOverlayRects'
import { gaugeBars, placeBarLabel, type GaugeBarSpec, type ScreenRect } from './gaugeBarMath'

const barVertex = /* glsl */ `
${GLSL_COMMON}
${GLSL_VERT}
${GLSL_RIBBON_VERT}
uniform float uOpacity;
varying vec4 vData;
void main() {
  gl_Position = fxRibbon(2.0, 0.0, 0.002);
  vec3 world = vec3(position.x, position.y * uExag, position.z);
  vData = vec4(aData.rgb, aData.a * fxKeep(world) * uOpacity);
  if (vData.a < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`

const barFragment = /* glsl */ `
${GLSL_COMMON}
${GLSL_RIBBON_FRAG}
varying vec4 vData;
void main() {
  gl_FragColor = vec4(vData.rgb, vData.a * fxRibbonAlpha());
  ${GLSL_OUTPUT}
}
`

const markVertex = /* glsl */ `
${GLSL_COMMON}
${GLSL_VERT}
${GLSL_SPRITE_VERT}
attribute vec3 aBase;   // x, ground elevation (m, not exaggerated), z
attribute float aH;     // metres above the ground (the bar's scale, not exaggerated)
attribute float aKind;  // 0 tick, 1 cap (reading), 2 hollow cap (forecast)
attribute vec4 aColor;  // rgb (linear), alpha
uniform float uOpacity;
varying float vKind;
varying vec4 vColor;
void main() {
  vec3 world = vec3(aBase.x, aBase.y * uExag + aH, aBase.z);
  float halfPx = (aKind < 0.5 ? 7.0 : 5.5) * uPixelRatio;
  gl_Position = fxSprite(world, halfPx, 0.0025);
  vKind = aKind;
  vColor = vec4(aColor.rgb, aColor.a * fxKeep(world) * uOpacity);
}
`

const markFragment = /* glsl */ `
${GLSL_COMMON}
varying vec2 vQuad;
varying float vKind;
varying vec4 vColor;
void main() {
  float a;
  if (vKind < 0.5) {
    a = 1.0 - smoothstep(0.12, 0.24, abs(vQuad.y));
  } else {
    float r = length(vQuad);
    float disc = 1.0 - smoothstep(0.78, 0.98, r);
    a = vKind < 1.5 ? disc : disc * smoothstep(0.42, 0.6, r);
  }
  a *= vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  ${GLSL_OUTPUT}
}
`

/** The bars' and marks' opacity (a module object, like fxUniforms: one flood scene at a time). */
const gaugeOpacity = { value: 1 }

const _c = new THREE.Color()
function lin(hex: string): [number, number, number] {
  _c.set(hex)
  return [_c.r, _c.g, _c.b]
}

function buildBars(bars: GaugeBarSpec[], heightAt: (x: number, z: number) => number, exag: number): THREE.BufferGeometry | null {
  const lines: RibbonLine[] = []
  for (const b of bars) {
    const top = Math.max(b.heightM ?? 0, ...b.ticks.map((t) => t.heightM))
    if (!(top > 0)) continue
    const g = heightAt(b.x, b.z)
    const [r, gg, bb] = lin(b.heightM != null && b.heightM > 0 ? b.color : '#8a8a8a')
    const alpha = b.member ? 0.95 : 0.55
    // the bar up to the reading, then a faint rail up to the highest flood-stage tick (so the ticks have a support)
    if (b.heightM != null && b.heightM > 0) lines.push({ pts: [b.x, g, b.z, b.x, g + b.heightM / exag, b.z], constData: [r, gg, bb, alpha] })
    if (top > (b.heightM ?? 0)) {
      const [r2, g2, b2] = lin('#c8d2d8')
      lines.push({ pts: [b.x, g + (b.heightM ?? 0) / exag, b.z, b.x, g + top / exag, b.z], constData: [r2, g2, b2, alpha * 0.32] })
    }
  }
  return lines.length ? ribbonGeometry(lines) : null
}

function buildMarks(bars: GaugeBarSpec[], heightAt: (x: number, z: number) => number): THREE.InstancedBufferGeometry | null {
  const marks: { x: number; g: number; z: number; h: number; kind: number; color: [number, number, number]; a: number }[] = []
  for (const b of bars) {
    const g = heightAt(b.x, b.z)
    const a = b.member ? 1 : 0.6
    for (const t of b.ticks) marks.push({ x: b.x, g, z: b.z, h: t.heightM, kind: 0, color: lin(t.color), a: a * 0.95 })
    if (b.heightM != null) marks.push({ x: b.x, g, z: b.z, h: b.heightM, kind: 1, color: lin(b.color), a })
    if (b.crestM != null) marks.push({ x: b.x, g, z: b.z, h: b.crestM, kind: 2, color: lin(b.crestColor), a })
  }
  if (!marks.length) return null
  const base = new Float32Array(marks.length * 3)
  const h = new Float32Array(marks.length)
  const kind = new Float32Array(marks.length)
  const color = new Float32Array(marks.length * 4)
  marks.forEach((m, i) => {
    base.set([m.x, m.g, m.z], i * 3)
    h[i] = m.h
    kind[i] = m.kind
    color.set([...m.color, m.a], i * 4)
  })
  return spriteGeometry(marks.length, { aBase: { array: base, size: 3 }, aH: { array: h, size: 1 }, aKind: { array: kind, size: 1 }, aColor: { array: color, size: 4 } })
}

/** Per label: the declutter fade, the mirror flag and the projected anchor (ScreenLabel writes it every frame). */
interface LabelSlot {
  fade: { current: number }
  flip: { current: boolean }
  screen: { x: number; y: number; visible: boolean }
}

const LABEL_FONT_PX = 10.5
const LABEL_OFFSET: [number, number] = [10, 8]
/** Shown boxes in canvas pixels (scratch, reused every frame). */
const _blocked: ScreenRect[] = []

function BarLabel({ assets, bar, slot }: { assets: IncidentAssets; bar: GaugeBarSpec; slot: LabelSlot }) {
  const anchor = useMemo(
    () => (out: THREE.Vector3) => {
      out.set(bar.x, assets.heightAt(bar.x, bar.z) * useStore.getState().exaggeration + bar.topM + 4, bar.z)
      return true
    },
    [assets, bar],
  )
  return (
    <ScreenLabel
      anchor={anchor}
      text={bar.label}
      color={bar.member ? '#dff4ff' : '#a9b6bf'}
      fontPx={LABEL_FONT_PX}
      offset={LABEL_OFFSET}
      leader
      opacity={bar.member ? 0.92 : 0.7}
      fade={slot.fade}
      flip={slot.flip}
      screen={slot.screen}
    />
  )
}

export function GaugeBars({ assets, flood }: { assets: IncidentAssets; flood: FloodSceneAssets }) {
  const setting = useForensicFlood((s) => s.layers.gauges)
  const labelsOn = useForensicFlood((s) => shownOpacity(s.layers.telemetry) > 0)
  const exag = useStore((s) => s.exaggeration)
  const units = useWorkspace((s) => s.units)
  const tf = useTimeFormat()
  const now = useNow(60_000)
  const resp = flood.gauges
  const bars = useMemo(() => {
    if (!resp || resp.status !== 'available') return []
    const members = memberGaugesOf(resp, flood.summary)
    const nearby = resp.gauges.filter((g) => !g.member)
    return gaugeBars([...members, ...nearby], flood.manifest.grid, { units, tf, nowMs: now })
  }, [resp, flood.summary, flood.manifest.grid, units, tf, now])
  const barGeo = useMemo(() => buildBars(bars, assets.heightAt, exag), [bars, assets.heightAt, exag])
  const markGeo = useMemo(() => buildMarks(bars, assets.heightAt), [bars, assets.heightAt])
  useEffect(() => () => barGeo?.dispose(), [barGeo])
  useEffect(() => () => markGeo?.dispose(), [markGeo])
  const barMat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: barVertex, fragmentShader: barFragment, uniforms: { ...fxUniforms, uOpacity: gaugeOpacity }, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    [],
  )
  const markMat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: markVertex, fragmentShader: markFragment, uniforms: { ...fxUniforms, uOpacity: gaugeOpacity }, transparent: true, depthWrite: false, depthTest: true }),
    [],
  )
  useEffect(() => () => barMat.dispose(), [barMat])
  useEffect(() => () => markMat.dispose(), [markMat])
  const opacity = setting.opacity
  const labelled = useMemo(() => bars.filter((b) => b.labelled), [bars])
  const slots = useMemo(() => new Map<string, LabelSlot>(labelled.map((b) => [b.lid, { fade: { current: 1 }, flip: { current: false }, screen: { x: 0, y: 0, visible: false } }])), [labelled])
  useFrame((state, delta) => {
    gaugeOpacity.value = opacity
    if (!labelsOn) return
    // labels mirror to the left before they run under the right column, and hide under the panels, the scene key and
    // the prototype pill (review WFF-R8); under reduced motion they switch at once
    const insets = useSceneStore.getState().viewInsets
    const { width, height, left, top } = state.size
    _blocked.length = 0
    for (const r of floodOverlayRects()) _blocked.push({ left: r.left - left, top: r.top - top, right: r.right - left, bottom: r.bottom - top })
    const k = prefersReducedMotion() ? 1 : Math.min(1, delta * 8)
    for (const b of labelled) {
      const sl = slots.get(b.lid)
      if (!sl || !sl.screen.visible) continue
      const wPx = b.label.length * LABEL_FONT_PX * 0.62
      const placed = placeBarLabel(sl.screen, { w: width, h: height }, wPx, LABEL_FONT_PX * 1.25, LABEL_OFFSET, insets, _blocked)
      sl.flip.current = placed.flip
      sl.fade.current += ((placed.hidden ? 0 : 1) - sl.fade.current) * k
    }
  })
  if (!setting.visible || !bars.length) return null
  return (
    <>
      {barGeo && <mesh geometry={barGeo} material={barMat} frustumCulled={false} renderOrder={ORDER.profile} name="flood-gauge-bars" />}
      {markGeo && <mesh geometry={markGeo} material={markMat} frustumCulled={false} renderOrder={ORDER.profile + 1} name="flood-gauge-marks" />}
      {labelsOn && (
        <InOverlay>
          {labelled.map((b) => (
            <BarLabel key={b.lid} assets={assets} bar={b} slot={slots.get(b.lid)!} />
          ))}
        </InOverlay>
      )}
    </>
  )
}
