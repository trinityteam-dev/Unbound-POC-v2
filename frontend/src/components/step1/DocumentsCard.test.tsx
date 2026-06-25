import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { JobFile } from '../../api/types'
import { DocumentsCard } from './DocumentsCard'

const pending: JobFile = {
  original_name: 'a.pdf',
  classified_name: 'Accountancy - $270.41.pdf',
  category: 'Accountancy',
  account_number: null,
  amount: '270.41',
  date: '30.06.25',
  reasoning: 'r',
}
const approved: JobFile = {
  original_name: 'b.pdf',
  classified_name: 'Audit.pdf',
  category: 'Audit',
  account_number: null,
  amount: null,
  date: null,
  notes: 'ok',
  status: 'Approved',
}

const r = (ui: React.ReactNode) => render(<MantineProvider>{ui}</MantineProvider>)

describe('DocumentsCard', () => {
  it('renders a pending row with Override + amount when editable', () => {
    r(<DocumentsCard jobId="j1" files={[pending]} editable onOverride={vi.fn()} />)
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Override')).toBeInTheDocument()
    expect(screen.getByText('$270.41')).toBeInTheDocument()
  })

  it('renders an approved row with no Override when read-only', () => {
    r(<DocumentsCard jobId="j1" files={[approved]} editable={false} onOverride={vi.fn()} />)
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.queryByText('Override')).toBeNull()
  })
})
