// Typed fetch wrappers for the Flask engine (Appendix A — contract unchanged).
import type {
  CreateJobPayload,
  CreateJobResponse,
  Fund,
  Job,
  JobDetail,
  ProcessorReviewPayload,
  QueryStatusPayload,
  ReviewAck,
  ReviewerReviewPayload,
  SavePlaybookPayload,
  TokenUsage,
} from './types'

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, body || `${res.status} ${res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  // Funds
  getFunds: () => request<Fund[]>('/api/funds'),
  discoverFunds: () => request<string[]>('/api/funds/discover'),
  bootstrapFunds: (folders: string[]) =>
    post<unknown>('/api/funds/bootstrap', { folders }),
  getFundCostSummary: (fundId: string) =>
    request<unknown>(`/api/funds/${fundId}/cost-summary`),

  // POST /api/funds is overloaded — split into two intents (spec §8).
  registerFund: (fund: Partial<Fund>) => post<Fund>('/api/funds', fund),
  savePlaybook: (payload: SavePlaybookPayload) =>
    post<{ status: string }>('/api/funds', payload),

  // Jobs
  getJobs: () => request<Job[]>('/api/jobs'),
  createJob: (payload: CreateJobPayload) =>
    post<CreateJobResponse>('/api/jobs/create', payload),
  getJobDetails: (jobId: string) =>
    request<JobDetail>(`/api/jobs/${jobId}/details`),
  processorReview: (jobId: string, payload: ProcessorReviewPayload) =>
    post<ReviewAck>(`/api/jobs/${jobId}/processor-review`, payload),
  reviewerReview: (jobId: string, payload: ReviewerReviewPayload) =>
    post<JobDetail>(`/api/jobs/${jobId}/reviewer-review`, payload),

  // Phase 2
  getReconciliation: (jobId: string) =>
    request<unknown>(`/api/jobs/${jobId}/reconciliation`),
  setQueryStatus: (jobId: string, queryId: string, payload: QueryStatusPayload) =>
    post<unknown>(`/api/jobs/${jobId}/queries/${queryId}/status`, payload),
  regroupQueries: (jobId: string) =>
    post<unknown>(`/api/jobs/${jobId}/regroup-queries`, {}),

  // Token usage
  getTokenUsage: (jobId: string) =>
    request<TokenUsage>(`/api/jobs/${jobId}/token-usage`),

  // PDF stream URL (phase = "staging" | "workpaper")
  fileUrl: (jobId: string, phase: 'staging' | 'workpaper', filename: string) =>
    `/api/jobs/${jobId}/file/${phase}/${encodeURIComponent(filename)}`,
}

export { ApiError }
