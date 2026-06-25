import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ClientQuery, JobDetail } from '../../api/types'
import { renderUI } from '../../test/utils'
import { QueriesCard } from './QueriesCard'
import pendingReviewer from '../../test/fixtures/job_details__pending_reviewer_approval.json'

const queries = (pendingReviewer as unknown as JobDetail).phase2_context!.queries as ClientQuery[]

describe('QueriesCard', () => {
  it('lists each query with an Open affordance', () => {
    renderUI(<QueriesCard queries={queries} onOpen={() => {}} />)
    expect(screen.getByText(queries[0].category)).toBeInTheDocument()
    expect(screen.getAllByText('Open').length).toBe(queries.length)
  })

  it('shows a clean empty state when there are no queries', () => {
    renderUI(<QueriesCard queries={[]} onOpen={() => {}} />)
    expect(screen.getByText(/Ledger is clean/i)).toBeInTheDocument()
  })
})
