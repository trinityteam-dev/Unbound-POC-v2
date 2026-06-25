import { describe, expect, it } from 'vitest'
import {
  formatAud,
  formatCost,
  formatMoney,
  formatRelative,
  formatShortDate,
  formatTokens,
  parseAmount,
  parseCreatedAt,
  parseShortDate,
} from './format'

describe('parseAmount', () => {
  it('parses a string amount', () => {
    expect(parseAmount('270.41')).toBe(270.41)
    expect(parseAmount('517.00')).toBe(517)
  })
  it('returns null for null/empty/invalid (Phase 0: amount is nullable)', () => {
    expect(parseAmount(null)).toBeNull()
    expect(parseAmount(undefined)).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })
})

describe('formatMoney', () => {
  it('formats AUD currency', () => {
    expect(formatMoney('270.41')).toBe('$270.41')
  })
  it('renders em-dash when absent', () => {
    expect(formatMoney(null)).toBe('—')
  })
})

describe('parseShortDate / formatShortDate', () => {
  it('parses dd.mm.yy', () => {
    const d = parseShortDate('30.06.25')
    expect(d?.getFullYear()).toBe(2025)
    expect(d?.getMonth()).toBe(5) // June
    expect(d?.getDate()).toBe(30)
  })
  it('formats to a readable date', () => {
    expect(formatShortDate('30.06.25')).toBe('30 Jun 2025')
  })
  it('handles null', () => {
    expect(parseShortDate(null)).toBeNull()
    expect(formatShortDate(null)).toBe('—')
  })
})

describe('parseCreatedAt', () => {
  it('parses space-separated timestamp (not ISO)', () => {
    const d = parseCreatedAt('2026-06-19 11:08:31')
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getDate()).toBe(19)
  })
  it('handles null', () => {
    expect(parseCreatedAt(null)).toBeNull()
  })
})

describe('formatAud', () => {
  it('formats a numeric amount; em-dash when null', () => {
    expect(formatAud(270.41)).toBe('$270.41')
    expect(formatAud(null)).toBe('—')
  })
})

describe('formatTokens', () => {
  it('compacts thousands and handles small/absent values', () => {
    expect(formatTokens(248_000)).toBe('248k tok')
    expect(formatTokens(500)).toBe('500 tok')
    expect(formatTokens(null)).toBe('')
  })
})

describe('formatCost', () => {
  it('returns null when there is no job total', () => {
    expect(formatCost(null)).toBeNull()
    expect(formatCost({})).toBeNull()
    expect(formatCost({ job_total: {} })).toBeNull()
  })
  it('formats the job total cost to 3 decimals', () => {
    expect(formatCost({ job_total: { cost_usd: 0.079878 } })).toBe('$0.080')
  })
})

describe('formatRelative', () => {
  it('returns empty for missing dates', () => {
    expect(formatRelative(null)).toBe('')
  })
  it('produces a relative string for a past timestamp', () => {
    const past = parseCreatedAt('2020-01-01 00:00:00')!
    expect(formatRelative('2020-01-01 00:00:00')).toMatch(/ago$/)
    expect(past.getFullYear()).toBe(2020)
  })
})
