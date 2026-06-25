import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkflowTimeline } from './WorkflowTimeline'

function renderTimeline(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>)
}

describe('WorkflowTimeline', () => {
  it('renders all four stage titles', () => {
    renderTimeline(<WorkflowTimeline status="pending_processor_review" />)
    expect(screen.getByText('Classify')).toBeInTheDocument()
    expect(screen.getByText('Your sign-off')).toBeInTheDocument()
    expect(screen.getByText('Reconcile')).toBeInTheDocument()
    expect(screen.getByText('Final sign-off')).toBeInTheDocument()
  })

  it('marks exactly one node as the current step', () => {
    renderTimeline(<WorkflowTimeline status="processing_review" />)
    const current = screen
      .getAllByRole('listitem')
      .filter((el) => el.getAttribute('aria-current') === 'step')
    expect(current).toHaveLength(1)
  })

  it('shows live progress on an active AI stage', () => {
    renderTimeline(<WorkflowTimeline status="processing_docs" progressPercent={45} />)
    expect(screen.getByText('45%')).toBeInTheDocument()
  })

  it('marks the failed stage when status is failed', () => {
    renderTimeline(<WorkflowTimeline status="failed" />)
    expect(screen.getByText('failed')).toBeInTheDocument()
  })
})
