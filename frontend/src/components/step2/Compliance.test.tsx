import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { JobDetail } from '../../api/types'
import { renderUI } from '../../test/utils'
import { Compliance } from './Compliance'
import pendingReviewer from '../../test/fixtures/job_details__pending_reviewer_approval.json'

const job = pendingReviewer as unknown as JobDetail

describe('Compliance', () => {
  it('renders the checklist groups and the auditor exceptions board', () => {
    renderUI(<Compliance job={job} />)
    expect(screen.getByText('Document Audit Checklist Verification')).toBeInTheDocument()
    // A known checklist group from the fixture
    expect(screen.getByText(/Cash at Bank/)).toBeInTheDocument()
    // Notes board reflects the auditor_notes count
    const count = (job.auditor_notes as unknown[]).length
    expect(screen.getByText(new RegExp(`Auditor exceptions \\(${count}\\)`))).toBeInTheDocument()
  })
})
