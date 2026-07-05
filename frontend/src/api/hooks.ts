import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { JOBS_LIST_POLL_MS, jobPollInterval } from '../lib/polling'
import type {
  CreateJobPayload,
  FundConfig,
  Playbook,
  ProcessorReviewPayload,
  QueryStatusPayload,
  ReviewerReviewPayload,
  SaveFundComplementsPayload,
} from './types'

/** Jobs list — polled every 10s (spec §7). */
export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: api.getJobs,
    refetchInterval: JOBS_LIST_POLL_MS,
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
    refetchInterval: (query) => jobPollInterval(query.state.data?.status),
  })
}

/** Funds list. */
export function useFunds() {
  return useQuery({
    queryKey: ['funds'],
    queryFn: api.getFunds,
  })
}

/** Selectable OpenRouter models (friendly label + model id) — static config. */
export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: api.getModels,
    staleTime: Infinity,
  })
}

/**
 * Unregistered fund folders under data/ (Story 10) — polled with the jobs
 * list cadence so a folder dropped while the app is open surfaces without
 * a refresh.
 */
export function useDiscoverFunds() {
  return useQuery({
    queryKey: ['discovered-funds'],
    queryFn: api.discoverFunds,
    refetchInterval: JOBS_LIST_POLL_MS,
  })
}

/** AI-scan discovered folders into proposed fund configs (15–30s per folder). */
export function useBootstrapFunds() {
  return useMutation({
    mutationFn: (folders: string[]) => api.bootstrapFunds(folders),
  })
}

/** Register (upsert) a full fund config; refreshes funds + discovery. */
export function useRegisterFund() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fund: FundConfig) => api.registerFund(fund),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funds'] })
      qc.invalidateQueries({ queryKey: ['discovered-funds'] })
    },
  })
}

/** Create a job (starts Phase 1). Invalidates the jobs list on success. */
export function useCreateJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateJobPayload) => api.createJob(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

/** Processor sign-off → starts Phase 2. Refreshes the job + jobs list. */
export function useProcessorReview(jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ProcessorReviewPayload) =>
      api.processorReview(jobId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

/** Global classification playbook (shared taxonomy + keywords). */
export function usePlaybook() {
  return useQuery({
    queryKey: ['playbook'],
    queryFn: api.getPlaybook,
  })
}

/** Save the global playbook (PUT /api/playbook). */
export function useSavePlaybook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (playbook: Playbook) => api.savePlaybook(playbook),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playbook'] }),
  })
}

/** Save a fund's additive keyword complements (POST /api/funds). */
export function useSaveFundComplements() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SaveFundComplementsPayload) => api.saveFundComplements(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['funds'] }),
  })
}

/** Reviewer final sign-off → completes the job. */
export function useReviewerReview(jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ReviewerReviewPayload) =>
      api.reviewerReview(jobId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

/** Send/dismiss a client query. */
export function useSetQueryStatus(jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ queryId, payload }: { queryId: string; payload: QueryStatusPayload }) =>
      api.setQueryStatus(jobId, queryId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job', jobId] }),
  })
}

/** Re-cluster client queries. */
export function useRegroupQueries(jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.regroupQueries(jobId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job', jobId] }),
  })
}
