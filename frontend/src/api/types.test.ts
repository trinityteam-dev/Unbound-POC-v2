import { describe, expect, it } from 'vitest'
import { isApprovedFile, type JobFile } from './types'
import pendingProcessor from '../test/fixtures/job_details__pending_processor_review.json'
import pendingReviewer from '../test/fixtures/job_details__pending_reviewer_approval.json'

describe('JobFile discriminated union (spec §8)', () => {
  it('narrows a pending file (has reasoning, no status)', () => {
    const f = (pendingProcessor.files as JobFile[])[0]
    expect(isApprovedFile(f)).toBe(false)
    if (!isApprovedFile(f)) {
      expect(f.reasoning).toBeDefined()
    }
  })

  it('narrows an approved file (has status:"Approved" + notes)', () => {
    const f = (pendingReviewer.files as JobFile[])[0]
    expect(isApprovedFile(f)).toBe(true)
    if (isApprovedFile(f)) {
      expect(f.status).toBe('Approved')
      expect(f.notes).toBeDefined()
    }
  })

  it('tolerates nullable amount/date (Phase 0 discrepancy)', () => {
    const files = pendingProcessor.files as JobFile[]
    // At least one real file has a null amount — must not throw.
    expect(files.some((f) => f.amount === null)).toBe(true)
  })
})
