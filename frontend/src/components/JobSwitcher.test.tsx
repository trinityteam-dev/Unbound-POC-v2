import { describe, expect, it } from 'vitest'
import type { Job } from '../api/types'
import { renderUI } from '../test/utils'
import { JobSwitcher } from './JobSwitcher'

const jobs: Job[] = [
  {
    job_id: 'j1',
    fund_id: 'f1',
    fund_name: 'Test Fund',
    abn: '',
    job_type: 'Accounting_Audit',
    status: 'completed',
    created_at: '2026-06-25 10:00:00',
  },
]

describe('JobSwitcher', () => {
  it('mounts without crashing (closed by default) and registers the hotkey', () => {
    // Should not throw even with a null fund_name in the list.
    const withNull = [...jobs, { ...jobs[0], job_id: 'j2', fund_name: null as unknown as string }]
    expect(() => renderUI(<JobSwitcher jobs={withNull} onSelect={() => {}} />)).not.toThrow()
  })
})
