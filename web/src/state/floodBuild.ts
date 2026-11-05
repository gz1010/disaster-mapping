// Preparing a flood's map data (brief 5, PLAN-5 §3.3, §4.1, C10; web-flood-public): the state of the preparation as
// the views show it, and the job poller behind useFlood.startFloodBuild. A flood bundle is light (terrain, frozen
// copies of the official water layers; about a minute): `POST /api/floods/{id}/build` starts the backend's job,
// `/api/jobs/{id}` is polled with its progress, and when the job is done the flood's detail is read again so its
// manifest (with the bundle's files) arrives. Pure parts tested in floodBuild.test.ts.
import type { FloodManifest, FloodSummary, JobStatus } from '../api/types'

export type FloodPrepKind = 'none' | 'needed' | 'building' | 'failed'

export interface FloodPrepState {
  kind: FloodPrepKind
  /** 0..1 while running, null while queued or unknown. */
  progress: number | null
  /** The job's step ("terrain", "queued"). */
  step: string | null
  /** Why the last start or job failed (the backend's words). */
  error: string | null
}

/** A build job for this flood that is still running. */
export function activeBuildJob(job: JobStatus | null, floodId: string | null): JobStatus | null {
  return job && job.kind === 'build' && job.incident_id === floodId && (job.status === 'queued' || job.status === 'running') ? job : null
}

/** What the views show about the flood's map data: nothing (ready, loading, a synthetic fixture that cannot be built),
 *  "Prepare map data", its progress, or a failure with "Prepare again". */
export function floodPrepState(s: { id: string | null; summary: FloodSummary | null; manifest: FloodManifest | null; job: JobStatus | null; loading: boolean; error?: string | null }): FloodPrepState {
  const none: FloodPrepState = { kind: 'none', progress: null, step: null, error: null }
  if (!s.id || !s.summary || s.loading) return none
  const job = activeBuildJob(s.job, s.id)
  // building: a lost contact with the job (the poll keeps trying) is said next to the progress (review WFP-R9)
  if (job || s.manifest?.status === 'building' || s.summary.bundle_status === 'building')
    return { kind: 'building', progress: job && job.status === 'running' ? job.progress : null, step: job ? (job.status === 'queued' ? 'queued' : job.step || 'running') : null, error: job ? (s.error ?? null) : null }
  if (s.manifest?.status === 'ready') return none
  // fixture-flood answers 409 (bundle only): never offered
  if (s.id === 'fixture-flood') return none
  const jobFailed = s.job != null && s.job.kind === 'build' && s.job.incident_id === s.id && s.job.status === 'error'
  if (jobFailed || s.manifest?.status === 'error' || s.summary.bundle_status === 'error' || s.error) return { kind: 'failed', progress: null, step: null, error: s.error ?? s.job?.error ?? null }
  return { kind: 'needed', progress: null, step: null, error: null }
}

/** How long to wait before the next poll of a job (ms): quick while queued, then every 1.5 s. */
export function pollDelay(job: Pick<JobStatus, 'status'>): number {
  return job.status === 'queued' ? 800 : 1500
}

/** A poll of a running job that failed (review WFP-R9): one failed request is not a failed job. The poller keeps the
 *  job's last known status and asks again after a growing wait (3 s, 6 s, 12 s, then every 20 s); only the job itself
 *  saying 'error', or the server no longer knowing it (404), ends the preparation. After POLL_LOST_AFTER failures in a
 *  row the views say contact was lost (the job may still be running), and the poller goes on asking. */
export const POLL_LOST_AFTER = 4

export function pollRetryDelay(failures: number): number {
  return Math.min(20_000, 1500 * 2 ** Math.max(1, failures))
}

/** The server no longer knows the job (it restarted): the preparation is over (Prepare again). */
export function pollJobGone(status: number | null | undefined): boolean {
  return status === 404
}

/** The job finished (done or failed): stop polling. */
export function jobFinished(job: Pick<JobStatus, 'status'>): boolean {
  return job.status === 'done' || job.status === 'error'
}
