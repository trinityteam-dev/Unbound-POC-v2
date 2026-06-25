import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricStrip } from './MetricStrip'

describe('MetricStrip', () => {
  it('renders all five stats with their values', () => {
    render(
      <MantineProvider>
        <MetricStrip total={49} matched={7} unmatched={42} queries={4} exceptions={11} />
      </MantineProvider>,
    )
    for (const label of ['Transactions', 'Matched', 'Unmatched', 'Queries', 'Exceptions']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('49')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('11')).toBeInTheDocument()
  })
})
