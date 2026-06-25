import { describe, expect, it } from 'vitest'
import type { JobFile } from '../../api/types'
import { playbookToRows, rowsToPlaybook, toReviewFile } from './utils'

describe('toReviewFile', () => {
  it('extracts the review payload fields, defaulting notes', () => {
    const f = {
      original_name: 'a.pdf',
      classified_name: 'Accountancy.pdf',
      category: 'Accountancy',
      account_number: null,
      amount: '270.41',
      date: null,
      reasoning: 'because',
    } as JobFile
    expect(toReviewFile(f)).toEqual({
      original_name: 'a.pdf',
      classified_name: 'Accountancy.pdf',
      category: 'Accountancy',
      account_number: null,
      amount: '270.41',
      date: null,
      notes: '',
    })
  })
})

describe('playbook keyword round-trip', () => {
  it('playbookToRows handles both comma-strings and arrays', () => {
    expect(
      playbookToRows({ Accountancy: 'Fee, Invoice', Audit: ['Auditor', 'Engagement'] }),
    ).toEqual({ Accountancy: 'Fee, Invoice', Audit: 'Auditor, Engagement' })
  })

  it('rowsToPlaybook normalizes to a trimmed comma-string', () => {
    expect(rowsToPlaybook({ Accountancy: 'Fee ,  Invoice ', Audit: '' })).toEqual({
      Accountancy: 'Fee, Invoice',
      Audit: '',
    })
  })
})
