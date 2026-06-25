import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { JobStatus } from './types'

// Statuses where an AI stage is running → poll fast (spec §7).
const ACTIVE_STATUSES: JobStatus[] = ['processing_docs', 'processing_review']

/** Jobs list — polled every 10s (spec §7). */
export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: api.getJobs,
    refetchInterval: 10_000,
  })
}

/**
 * One job's full record — polled every 3s while an AI stage runs, otherwise
 * polling is off. refetchInterval is keyed on the fetched status (spec §7).
 */
export function useJobDetails(jobId: string | null) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJobDetails(jobId as string),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && ACTIVE_STATUSES.includes(status) ? 3_000 : false
    },
  })
}

/** Funds list. */
export function useFunds() {
  return useQuery({
    queryKey: ['funds'],
    queryFn: api.getFunds,
  })
}
