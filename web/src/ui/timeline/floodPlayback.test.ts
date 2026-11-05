// Play and step (brief 6, web-flood-playback M2): what a press of Play does (from now the first step; at the latest
// step again from the first; reduced motion one step and never running), Play's ticks stop at the latest step, the
// chart's start while stepping, and the store: a hand move pauses Play, the handle back at now ends the stepping,
// another flood resets, entering Public puts the handle back at now (review WFP-R1).
import { afterEach, describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS } from '../../lib/time'
import { useFlood } from '../../state/flood'
import { useWorkspace } from '../../state/workspace'
import { floodKeyframes } from '../../state/floodTimeline'
import { testPass, testTimeline, versionBuilder } from '../../state/floodTimeline.testutil'
import { AXIS_MAX_PAST_MS, lastStep, moveHandle, playbackAxisStart, playPress, playTick, setPlaying, useFloodPlayback } from './floodPlayback'
import { HYDRO_PAST_MS } from './hydrographModel'

const NOW = Date.UTC(2026, 10, 5, 15, 0)
const version = versionBuilder(NOW)
const TL = testTimeline(
  NOW,
  [testPass('a', NOW - 9 * DAY_MS, 'clear'), testPass('b', NOW - 7 * DAY_MS, 'no_view'), testPass('c', NOW - 2 * DAY_MS, 'partly_hidden')],
  [version('w1', 'KABQ.FL.W.0019', 'NEW', NOW - 20 * HOUR_MS, null)],
)
const FRAMES = floodKeyframes(TL, NOW)

afterEach(() => {
  useWorkspace.setState({ workspace: 'map', preset: 'public' })
  useFlood.setState({ floodId: null, cursorMs: null })
  useFloodPlayback.setState({ floodId: null, playing: false, engaged: false })
})

describe('Play and step', () => {
  it('the steps: two usable passes and one NWS change; the latest step is the NWS change', () => {
    expect(FRAMES.map((f) => f.kind)).toEqual(['pass', 'pass', 'products'])
    expect(lastStep(FRAMES, NOW)?.t).toBe(NOW - 20 * HOUR_MS)
  })

  it('a press of Play: from now the first step and run; mid-way the next step; at the latest step again from the first', () => {
    expect(playPress(FRAMES, null, NOW, false)).toEqual({ to: FRAMES[0].t, run: true })
    expect(playPress(FRAMES, FRAMES[0].t, NOW, false)).toEqual({ to: FRAMES[1].t, run: true })
    // the next step is the latest: shown, and Play stops there
    expect(playPress(FRAMES, FRAMES[1].t, NOW, false)).toEqual({ to: FRAMES[2].t, run: false })
    expect(playPress(FRAMES, FRAMES[2].t, NOW, false)).toEqual({ to: FRAMES[0].t, run: true })
    // after now: from the first step
    expect(playPress(FRAMES, NOW + HOUR_MS, NOW, false)?.to).toBe(FRAMES[0].t)
    expect(playPress([], null, NOW, false)).toBeNull()
  })

  it('reduced motion: each press shows one step and Play never runs', () => {
    expect(playPress(FRAMES, null, NOW, true)).toEqual({ to: FRAMES[0].t, run: false })
    expect(playPress(FRAMES, FRAMES[0].t, NOW, true)).toEqual({ to: FRAMES[1].t, run: false })
  })

  it('Play’s ticks stop at the latest step (never on to now by themselves)', () => {
    expect(playTick(FRAMES, FRAMES[0].t, NOW)).toBe(FRAMES[1].t)
    expect(playTick(FRAMES, FRAMES[2].t, NOW)).toBeNull()
  })

  it('the chart starts 6 h before the first step while stepping, never later than 72 h nor more than 45 days back', () => {
    expect(playbackAxisStart(FRAMES, false, NOW)).toBeNull()
    expect(playbackAxisStart([], true, NOW)).toBeNull()
    expect(playbackAxisStart(FRAMES, true, NOW)).toBe(FRAMES[0].t - 6 * HOUR_MS)
    const recent = floodKeyframes(testTimeline(NOW, [testPass('r', NOW - HOUR_MS * 10, 'clear')], []), NOW)
    expect(playbackAxisStart(recent, true, NOW)).toBe(NOW - HYDRO_PAST_MS)
    const old = floodKeyframes(testTimeline(NOW, [testPass('o', NOW - 60 * DAY_MS, 'clear')], []), NOW)
    expect(playbackAxisStart(old, true, NOW)).toBe(NOW - AXIS_MAX_PAST_MS)
  })

  it('the store: a step engages; a hand move pauses Play; back at now ends the stepping; another flood resets', () => {
    useFlood.setState({ floodId: 'f', cursorMs: null })
    moveHandle('f', FRAMES[0].t)
    setPlaying('f', true)
    expect(useFloodPlayback.getState()).toMatchObject({ floodId: 'f', engaged: true, playing: true })
    // Play's own move keeps playing
    moveHandle('f', FRAMES[1].t)
    expect(useFloodPlayback.getState().playing).toBe(true)
    // a hand move (the slider) pauses, the axis stays wide
    useFlood.getState().setCursor(FRAMES[1].t + HOUR_MS)
    expect(useFloodPlayback.getState()).toMatchObject({ playing: false, engaged: true })
    // NOW: the 72 h chart again
    useFlood.getState().setCursor(null)
    expect(useFloodPlayback.getState()).toMatchObject({ playing: false, engaged: false })
    // another flood
    moveHandle('f', FRAMES[0].t)
    setPlaying('f', true)
    useFlood.setState({ floodId: 'g', cursorMs: null })
    expect(useFloodPlayback.getState()).toMatchObject({ floodId: 'g', playing: false, engaged: false })
  })

  it('entering the Public view (no time handle) stops Play and puts the handle back at now (review WFP-R1)', () => {
    useWorkspace.setState({ workspace: 'map', preset: 'command' })
    useFlood.setState({ floodId: 'f', cursorMs: null })
    moveHandle('f', FRAMES[0].t)
    setPlaying('f', true)
    // Forensic keeps the preset it came from: its dock's handle stays
    useWorkspace.setState({ workspace: 'forensic', preset: 'public' })
    expect(useFlood.getState().cursorMs).toBe(FRAMES[0].t)
    expect(useFloodPlayback.getState().playing).toBe(true)
    // the Public map view: now
    useWorkspace.setState({ workspace: 'map' })
    expect(useFlood.getState().cursorMs).toBeNull()
    expect(useFloodPlayback.getState()).toMatchObject({ playing: false, engaged: false })
    // Command again starts at now
    useWorkspace.setState({ preset: 'command' })
    expect(useFlood.getState().cursorMs).toBeNull()
  })
})
