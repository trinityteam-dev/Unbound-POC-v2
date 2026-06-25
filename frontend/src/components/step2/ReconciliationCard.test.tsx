import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { JobDetail } from '../../api/types'
import { renderUI } from '../../test/utils'
import { ReconciliationCard } from './ReconciliationCard'
import pendingReviewer from '../../test/fixtures/job_details__pending_reviewer_approval.json'

const recon = (pendingReviewer as unknown as JobDetail).phase2_context!.reconciliation_results

describe('ReconciliationCard', () => {
  it('renders the account header and transaction rows', () => {
    renderUI(<ReconciliationCard recon={recon} />)
    expect(screen.getByText(/Macquarie CMA · 122593890/)).toBeInTheDocument()
    expect(screen.getAllByText('MACQUARIE CMA INTEREST PAID').length).toBeGreaterThan(0)
  })

  it('shows an empty state when there is no reconciliation data', () => {
    renderUI(<ReconciliationCard recon={undefined} />)
    expect(screen.getByText(/No reconciliation data/i)).toBeInTheDocument()
  })
})
