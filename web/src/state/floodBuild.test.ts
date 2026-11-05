// Preparing a flood's map data (brief 5, C10): the prep state the views show, and useFlood.startFloodBuild starting the
// backend's build job, polling it with its progress and reading the detail again for the manifest.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DETAIL, LIST } from '../api/__fixtures__/floods/edgeCases'
import type { FloodDetailResponse, JobStatus } from '../api/types'
import { useFlood } from './flood'
import { activeBuildJob, floodPrepState, jobFinished, pollDelay } from './floodBuild'

const flash = () => LIST().floods.find((f) => f.id === 'fixture-flood-major')!
const job = (status: JobStatus['status'], progress = 0, over: Partial<JobStatus> = {}): JobStatus => ({
  id: 'job-1',
  kind: 'build',
  incident_id: 'fixture-flood-major',
  status,
  progress,
  step: status === 'running' ? 'terrain' : status,
  message: '',
  created_ms: 0,
  started_ms: null,
  finished_ms: null,
  error: null,
  result: null,
  ...over,
})

describe('floodPrepState', () => {
  const base = { id: 'fixture-flood-major', summary: flash(), manifest: null, job: null, loading: false }
  it('a listed flood without a bundle: needed; while building: progress; a ready manifest: nothing', () => {
    expect(floodPrepState(base).kind).toBe('needed')
    expect(floodPrepState({ ...base, job: job('running', 0.4) })).toMatchObject({ kind: 'building', progress: 0.4, step: 'terrain' })
    expect(floodPrepState({ ...base, job: job('queued') })).toMatchObject({ kind: 'building', progress: null, step: 'queued' })
    expect(floodPrepState({ ...base, manifest: DETAIL().manifest }).kind).toBe('none')
  })
  it('failed: the job error, a manifest in error, or the start refused (409)', () => {
    expect(floodPrepState({ ...base, job: job('error', 0, { error: 'terrain failed' }) })).toMatchObject({ kind: 'failed', error: 'terrain failed' })
    expect(floodPrepState({ ...base, error: "'x' is outside the lower 48." })).toMatchObject({ kind: 'failed', error: "'x' is outside the lower 48." })
  })
  it('the synthetic fixture (bundle only) and a loading detail: nothing offered', () => {
    expect(floodPrepState({ ...base, id: 'fixture-flood', summary: DETAIL().summary }).kind).toBe('none')
    expect(floodPrepState({ ...base, loading: true }).kind).toBe('none')
  })
  it('helpers', () => {
    expect(activeBuildJob(job('running'), 'fixture-flood-major')).not.toBeNull()
    expect(activeBuildJob(job('running'), 'other')).toBeNull()
    expect(jobFinished(job('done'))).toBe(true)
    expect(pollDelay(job('queued'))).toBeLessThan(pollDelay(job('running')))
  })
})

describe('startFloodBuild: start, poll with progress, read the manifest (canned job)', () => {
  const calls: string[] = []
  let polls = 0
  beforeEach(() => {
    vi.useFakeTimers()
    calls.length = 0
    polls = 0
    const detailReady: FloodDetailResponse = { ...DETAIL(), summary: { ...flash(), bundle_status: 'ready' }, resolved_from: 'live' }
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const u = String(url)
      calls.push(`${init?.method ?? 'GET'} ${u}`)
      if (/\/build/.test(u)) return new Response(JSON.stringify(job('queued')), { status: 200 })
      if (/\/api\/jobs\/job-1/.test(u)) {
        polls++
        return new Response(JSON.stringify(polls < 2 ? job('running', 0.5) : job('done', 1)), { status: 200 })
      }
      if (/\/api\/floods\/fixture-flood-major$/.test(u)) return new Response(JSON.stringify(detailReady), { status: 200 })
      return new Response('{}', { status: 404 })
    })
    useFlood.setState({ floodId: 'fixture-flood-major', summary: flash(), manifest: null, job: null, buildError: null })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useFlood.setState({ floodId: null, summary: null, manifest: null, job: null, buildError: null })
  })

  it('POSTs the build route, follows the job to done, then reads the detail (manifest)', async () => {
    await useFlood.getState().startFloodBuild()
    expect(calls[0]).toMatch(/^POST .*\/api\/floods\/fixture-flood-major\/build$/)
    expect(useFlood.getState().job?.status).toBe('queued')
    await vi.advanceTimersByTimeAsync(900)
    expect(useFlood.getState().job).toMatchObject({ status: 'running', progress: 0.5 })
    await vi.advanceTimersByTimeAsync(1600)
    await vi.advanceTimersByTimeAsync(10)
    expect(useFlood.getState().job?.status).toBe('done')
    expect(calls.some((c) => /GET .*\/api\/floods\/fixture-flood-major$/.test(c))).toBe(true)
    expect(useFlood.getState().manifest).not.toBeNull()
    expect(useFlood.getState().summary?.bundle_status).toBe('ready')
  })

  it('force=1 is passed; a second start while running is ignored', async () => {
    await useFlood.getState().startFloodBuild(true)
    expect(calls[0]).toMatch(/\/build\?force=1$/)
    await useFlood.getState().startFloodBuild(true)
    expect(calls.filter((c) => c.startsWith('POST')).length).toBe(1)
  })

  it('409 (the synthetic fixture, outside the lower 48): the backend reason, no job', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ detail: "'fixture-flood' is a synthetic bundle; it cannot be rebuilt." }), { status: 409 }))
    await useFlood.getState().startFloodBuild()
    expect(useFlood.getState().buildError).toBe("'fixture-flood' is a synthetic bundle; it cannot be rebuilt.")
    expect(useFlood.getState().job).toBeNull()
  })

  it('closing the flood stops the polling', async () => {
    await useFlood.getState().startFloodBuild()
    useFlood.setState({ floodId: null })
    await vi.advanceTimersByTimeAsync(5000)
    expect(polls).toBeLessThanOrEqual(1)
  })
})

// review WFP-R9: one failed poll is not a failed job
import { POLL_LOST_AFTER, pollJobGone, pollRetryDelay } from './floodBuild'

describe('job polling survives failed polls (review WFP-R9)', () => {
  let script: (string | number)[] = []
  let polls = 0
  beforeEach(() => {
    vi.useFakeTimers()
    polls = 0
    const detailReady: FloodDetailResponse = { ...DETAIL(), summary: { ...flash(), bundle_status: 'ready' }, resolved_from: 'live' }
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url)
      if (/\/build/.test(u)) return new Response(JSON.stringify(job('queued')), { status: 200 })
      if (/\/api\/jobs\/job-1/.test(u)) {
        const next = script[Math.min(polls, script.length - 1)]
        polls++
        if (typeof next === 'number') return new Response('{"detail":"busy"}', { status: next })
        return new Response(JSON.stringify(next === 'done' ? job('done', 1) : job('running', 0.5)), { status: 200 })
      }
      if (/\/api\/floods\/fixture-flood-major$/.test(u)) return new Response(JSON.stringify(detailReady), { status: 200 })
      return new Response('{}', { status: 404 })
    })
    useFlood.setState({ floodId: 'fixture-flood-major', summary: flash(), manifest: null, job: null, buildError: null })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useFlood.setState({ floodId: null, summary: null, manifest: null, job: null, buildError: null })
  })

  it('helpers: a growing wait capped at 20 s; only a 404 ends the job', () => {
    expect(pollRetryDelay(1)).toBe(3000)
    expect(pollRetryDelay(2)).toBe(6000)
    expect(pollRetryDelay(10)).toBe(20_000)
    expect(pollJobGone(404)).toBe(true)
    expect(pollJobGone(503)).toBe(false)
    expect(pollJobGone(null)).toBe(false)
  })
  it('a 503 between running polls keeps the job running (no error, no "failed"), then follows it to done', async () => {
    script = ['running', 503, 'running', 'done']
    await useFlood.getState().startFloodBuild()
    await vi.advanceTimersByTimeAsync(900) // running
    await vi.advanceTimersByTimeAsync(1600) // 503
    expect(useFlood.getState().job?.status).toBe('running')
    expect(useFlood.getState().buildError).toBeNull()
    expect(floodPrepState({ id: 'fixture-flood-major', summary: flash(), manifest: null, job: useFlood.getState().job, loading: false, error: useFlood.getState().buildError }).kind).toBe('building')
    await vi.advanceTimersByTimeAsync(3100) // retry: running
    await vi.advanceTimersByTimeAsync(1600) // done
    await vi.advanceTimersByTimeAsync(10)
    expect(useFlood.getState().job?.status).toBe('done')
    expect(useFlood.getState().manifest).not.toBeNull()
  })
  it(`${POLL_LOST_AFTER} failures in a row: "lost contact" beside the progress, still building and still polling; contact back clears it`, async () => {
    script = ['running', 503, 503, 503, 503, 'running']
    await useFlood.getState().startFloodBuild()
    await vi.advanceTimersByTimeAsync(900 + 1500 + 3000 + 6000 + 12_000 + 100)
    expect(polls).toBe(5)
    const st = useFlood.getState()
    expect(st.job?.status).toBe('running')
    expect(st.buildError).toMatch(/^Disaster Mapping lost contact with the preparation \(.+\); it may still be running\.$/)
    expect(floodPrepState({ id: 'fixture-flood-major', summary: flash(), manifest: null, job: st.job, loading: false, error: st.buildError })).toMatchObject({ kind: 'building', error: st.buildError })
    await vi.advanceTimersByTimeAsync(20_100)
    expect(polls).toBe(6)
    expect(useFlood.getState().buildError).toBeNull()
  })
  it('a 404 (the server no longer knows the job): failed, Prepare again', async () => {
    script = ['running', 404]
    await useFlood.getState().startFloodBuild()
    await vi.advanceTimersByTimeAsync(900 + 1600)
    expect(useFlood.getState().job?.status).toBe('error')
    expect(floodPrepState({ id: 'fixture-flood-major', summary: flash(), manifest: null, job: useFlood.getState().job, loading: false, error: useFlood.getState().buildError }).kind).toBe('failed')
  })
})
