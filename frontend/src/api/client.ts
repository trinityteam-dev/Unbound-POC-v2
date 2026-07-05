// Typed fetch wrappers for the Flask engine (Appendix A — contract unchanged).
import type {
  BootstrapResult,
  CreateJobPayload,
  CreateJobResponse,
  DiscoveredFolder,
  Fund,
  FundConfig,
  Job,
  JobDetail,
  ModelsConfig,
  Playbook,
  ProcessorReviewPayload,
  QueryStatusPayload,
  ReviewAck,
  ReviewerReviewPayload,
  SaveFundComplementsPayload,
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

const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) })

export const api = {
  // Funds
  getFunds: () => request<Fund[]>('/api/funds'),
  discoverFunds: () => request<DiscoveredFolder[]>('/api/funds/discover'),
  bootstrapFunds: (folders: string[]) =>
    post<BootstrapResult[]>('/api/funds/bootstrap', { folders }),
  getFundCostSummary: (fundId: string) =>
    request<unknown>(`/api/funds/${fundId}/cost-summary`),
  registerFund: (fund: FundConfig) =>
    post<{ status: string; funds: Fund[] }>('/api/funds', fund),

  // Playbook — global shared taxonomy (GET/PUT) + additive per-fund complements.
  getPlaybook: () => request<Playbook>('/api/playbook'),
  savePlaybook: (playbook: Playbook) =>
    put<{ status: string }>('/api/playbook', playbook),
  saveFundComplements: (payload: SaveFundComplementsPayload) =>
    post<{ status: string }>('/api/funds', payload),

  // Selectable OpenRouter models
  getModels: () => request<ModelsConfig>('/api/models'),

  // Jobs
  getJobs: () => request<Job[]>('/api/jobs'),
  createJob: (payload: CreateJobPayload) =>
    post<CreateJobResponse>('/api/jobs/create', payload),
  getJobDetails: (jobId: string) =>
    request<JobDetail>(`/api/jobs/${jobId}/details`),
  processorReview: (jobId: string, payload: ProcessorReviewPayload) =>
    post<ReviewAck>(`/api/jobs/${jobId}/processor-review`, payload),
  reviewerReview: (jobId: string, payload: ReviewerReviewPayload) =>
    post<ReviewAck>(`/api/jobs/${jobId}/reviewer-review`, payload),

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
