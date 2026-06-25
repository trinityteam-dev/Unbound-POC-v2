import { describe, expect, it } from 'vitest'
import type { JobStatus } from '../api/types'
import { isPhase2, statusMeta, timelineNodes, type NodeState } from './status'

describe('timelineNodes (Appendix B mapping)', () => {
  const cases: Array<[JobStatus, NodeState[]]> = [
    ['processing_docs', ['active', 'upcoming', 'upcoming', 'upcoming']],
    ['pending_processor_review', ['done', 'active', 'upcoming', 'upcoming']],
    ['processing_review', ['done', 'done', 'active', 'upcoming']],
    ['pending_reviewer_approval', ['done', 'done', 'done', 'active']],
    ['completed', ['done', 'done', 'done', 'done']],
    ['failed', ['failed', 'upcoming', 'upcoming', 'upcoming']],
  ]
  it.each(cases)('%s → correct node states', (status, expected) => {
    expect(timelineNodes(status)).toEqual(expected)
  })

  it('always returns exactly 4 nodes', () => {
    for (const [status] of cases) {
      expect(timelineNodes(status)).toHaveLength(4)
    }
  })
})

describe('statusMeta', () => {
  it('maps each status to a label + semantic color', () => {
    expect(statusMeta.pending_processor_review).toEqual({
      label: 'Pending processor',
      color: 'yellow',
    })
    expect(statusMeta.completed.color).toBe('green')
    expect(statusMeta.failed.color).toBe('red')
  })
})

describe('isPhase2', () => {
  it('is true only once reconciliation has begun', () => {
    expect(isPhase2('processing_docs')).toBe(false)
    expect(isPhase2('pending_processor_review')).toBe(false)
    expect(isPhase2('processing_review')).toBe(true)
    expect(isPhase2('pending_reviewer_approval')).toBe(true)
    expect(isPhase2('completed')).toBe(true)
  })
})
