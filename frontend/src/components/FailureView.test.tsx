import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { JobDetail } from '../api/types'
import { FailureView } from './FailureView'
import failedJob from '../test/fixtures/job_details__failed.json'

describe('FailureView', () => {
  it('shows the failure alert + message + logs for a failed job', () => {
    const job = failedJob as unknown as JobDetail
    render(
      <MantineProvider>
        <FailureView job={job} />
      </MantineProvider>,
    )
    expect(screen.getByText('Audit failed')).toBeInTheDocument()
    expect(screen.getByText(job.message as string)).toBeInTheDocument()
    expect(screen.getByText('Agent Execution Logs')).toBeInTheDocument()
  })
})
