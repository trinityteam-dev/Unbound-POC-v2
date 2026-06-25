import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { useCreateJob, useJobs } from './hooks'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useJobs (MSW-mocked)', () => {
  it('returns the mocked jobs list', async () => {
    const { result } = renderHook(() => useJobs(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Array.isArray(result.current.data)).toBe(true)
    expect(result.current.data!.length).toBeGreaterThan(0)
    expect(result.current.data![0]).toHaveProperty('job_id')
    expect(result.current.data![0]).toHaveProperty('status')
  })
})

describe('useCreateJob (MSW-mocked)', () => {
  it('posts the payload and returns the new job_id', async () => {
    const { result } = renderHook(() => useCreateJob(), { wrapper })
    act(() => {
      result.current.mutate({ fund_id: 'fund_1', job_type: 'Accounting_Audit' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.job_id).toBe('job_test_new')
    expect(result.current.data?.status).toBe('started')
  })
})
