import type { JobStatus } from '../api/types'

// Job-driven phase (spec §1). `status` → phase → screen. There is no manual
// step toggle: the job's status alone decides which screen and tabs show.
export type Phase = 0 | 1 | 1.5 | 2 | 3

export const PHASE_BY_STATUS: Record<JobStatus, Phase | null> = {
  processing_docs: 0,
  pending_processor_review: 1,
  processing_review: 1.5,
  pending_reviewer_approval: 2,
  completed: 3,
  failed: null,
}

export function jobPhase(status: JobStatus): Phase | null {
  return PHASE_BY_STATUS[status]
}

// The quiet "where am I" label shown next to the ABN (spec §4). Never a control.
export const PHASE_LABEL: Record<JobStatus, string> = {
  processing_docs: 'Step 0 · Processing',
  pending_processor_review: 'Step 1 · Doc intel',
  processing_review: 'Step 1.5 · Reconciling',
  pending_reviewer_approval: 'Step 2 · Orchestration',
  completed: 'Step 3 · Completed',
  failed: 'Failed',
}

// Tabs available in the workspace (spec §5). The `Classified Docs` tab is far-left
// to read as the pipeline flow; it is read-only once the job reaches phase 2.
export type WorkspaceTab =
  | 'Classified Docs'
  | 'Reconciliation'
  | 'Lead schedules'
  | 'Compliance'
  | 'Agent logs'

export const PHASE2_TABS: WorkspaceTab[] = [
  'Classified Docs',
  'Reconciliation',
  'Lead schedules',
  'Compliance',
  'Agent logs',
]

/** Tabs for a job's phase, in display order. Phase 0 has none. */
export function tabsForStatus(status: JobStatus): WorkspaceTab[] {
  const phase = jobPhase(status)
  if (phase === 1) return ['Classified Docs']
  if (phase === 1.5 || phase === 2 || phase === 3) return PHASE2_TABS
  return []
}

/** Default-selected tab for a status (spec §5: Reconciliation in phase 2/3). */
export function defaultTabForStatus(status: JobStatus): WorkspaceTab {
  return jobPhase(status) === 1 ? 'Classified Docs' : 'Reconciliation'
}

/** Tabs other than Reconciliation/Classified Docs hide the filter rail (spec §7c). */
export function tabHasRail(tab: WorkspaceTab): boolean {
  return tab === 'Reconciliation' || tab === 'Classified Docs'
}

/** True once the job has reached phase 2+ (Classified Docs becomes read-only). */
export function isPhase2Plus(status: JobStatus): boolean {
  const p = jobPhase(status)
  return p === 1.5 || p === 2 || p === 3
}
