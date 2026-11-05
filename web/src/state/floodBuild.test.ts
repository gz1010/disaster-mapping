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
