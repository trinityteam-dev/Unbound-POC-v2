import type { JobStatus } from '../api/types'

export type NodeState = 'done' | 'active' | 'upcoming' | 'failed'

export interface StatusMeta {
  label: string
  color: string // Mantine semantic color
}

// Status pill labels + semantic colors (Appendix B).
export const statusMeta: Record<JobStatus, StatusMeta> = {
  processing_docs: { label: 'Processing docs', color: 'blue' },
  pending_processor_review: { label: 'Pending processor', color: 'yellow' },
  processing_review: { label: 'Processing review', color: 'blue' },
  pending_reviewer_approval: { label: 'Pending reviewer', color: 'orange' },
  completed: { label: 'Completed', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
}

// Index of the "current" stage per status (4 stages, 0-based). `completed`
// uses 4 → all four resolve to done.
const CURRENT_STAGE: Record<JobStatus, number> = {
  processing_docs: 0,
  pending_processor_review: 1,
  processing_review: 2,
  pending_reviewer_approval: 3,
  completed: 4,
  failed: 0,
}

// Stages 1 (Classify) and 3 (Reconcile) are AI stages → pulse while active.
export const AI_STAGES = [0, 2]

// Hex dot colors for the job list. Three human-gate states get distinct
// colors: pending processor (amber), pending reviewer (blue), completed (green).
export const statusDotColor: Record<JobStatus, string> = {
  processing_docs: '#8B5CF6', // AI working (violet)
  pending_processor_review: '#F59E0B', // amber
  processing_review: '#8B5CF6', // AI working (violet)
  pending_reviewer_approval: '#3B82F6', // blue
  completed: '#16A34A', // green
  failed: '#DC2626', // red
}

/** 4 node states (Classify / Sign-off / Reconcile / Final), per Appendix B. */
export function timelineNodes(status: JobStatus): NodeState[] {
  const current = CURRENT_STAGE[status]
  return [0, 1, 2, 3].map<NodeState>((i) => {
    if (status === 'failed') {
      if (i === current) return 'failed'
      return i < current ? 'done' : 'upcoming'
    }
    if (i < current) return 'done'
    if (i === current) return 'active'
    return 'upcoming'
  })
}

/** True once the job has reached Phase 2 (Step 2 tab becomes available). */
export function isPhase2(status: JobStatus): boolean {
  return (
    status === 'processing_review' ||
    status === 'pending_reviewer_approval' ||
    status === 'completed'
  )
}
