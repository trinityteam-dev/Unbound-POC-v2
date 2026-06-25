import type { JobStatus } from '../api/types'

export const JOBS_LIST_POLL_MS = 10_000
export const ACTIVE_JOB_POLL_MS = 3_000

// Poll the active job only while an AI stage is running (spec §7).
const ACTIVE_STATUSES: JobStatus[] = ['processing_docs', 'processing_review']

export function jobPollInterval(status: JobStatus | undefined): number | false {
  return status && ACTIVE_STATUSES.includes(status) ? ACTIVE_JOB_POLL_MS : false
}
