import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { JobDetail, JobStatus } from '../api/types'
import { statusMeta } from '../lib/status'
import { renderUI } from '../test/utils'
import { WorkspaceHeader } from './WorkspaceHeader'
import pendingReviewer from '../test/fixtures/job_details__pending_reviewer_approval.json'

const base = pendingReviewer as unknown as JobDetail

describe('WorkspaceHeader', () => {
  it('renders fund identity and the correct status pill for each status', () => {
    const statuses: JobStatus[] = [
      'processing_docs',
      'pending_processor_review',
      'processing_review',
      'pending_reviewer_approval',
      'completed',
      'failed',
    ]
    for (const status of statuses) {
      const { unmount } = renderUI(
        <WorkspaceHeader
          job={{ ...base, status }}
          activeStep={2}
          subTab="Reconciliation & Queries"
          onSubTabChange={() => {}}
        />,
      )
      expect(screen.getByText(base.fund_name)).toBeInTheDocument()
      expect(screen.getByText(statusMeta[status].label)).toBeInTheDocument()
      unmount()
    }
  })

  it('shows Step 2 sub-tabs only on Step 2', () => {
    const { unmount } = renderUI(
      <WorkspaceHeader job={base} activeStep={1} subTab="Reconciliation & Queries" onSubTabChange={() => {}} />,
    )
    expect(screen.queryByText('Lead Schedules')).not.toBeInTheDocument()
    unmount()

    renderUI(
      <WorkspaceHeader job={base} activeStep={2} subTab="Reconciliation & Queries" onSubTabChange={() => {}} />,
    )
    expect(screen.getByText('Lead Schedules')).toBeInTheDocument()
    expect(screen.getByText('Agent Logs')).toBeInTheDocument()
  })
})
