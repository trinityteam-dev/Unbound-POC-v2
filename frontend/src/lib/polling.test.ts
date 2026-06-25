import { describe, expect, it } from 'vitest'
import type { JobStatus } from '../api/types'
import { ACTIVE_JOB_POLL_MS, jobPollInterval } from './polling'

describe('jobPollInterval', () => {
  it('polls every 3s while an AI stage runs', () => {
    expect(jobPollInterval('processing_docs')).toBe(ACTIVE_JOB_POLL_MS)
    expect(jobPollInterval('processing_review')).toBe(ACTIVE_JOB_POLL_MS)
  })

  it('stops polling at rest/human-gate states', () => {
    const rest: JobStatus[] = [
      'pending_processor_review',
      'pending_reviewer_approval',
      'completed',
      'failed',
    ]
    for (const s of rest) expect(jobPollInterval(s)).toBe(false)
  })

  it('does not poll when status is unknown', () => {
    expect(jobPollInterval(undefined)).toBe(false)
  })
})
