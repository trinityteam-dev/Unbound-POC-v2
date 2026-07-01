// API types for the SMSF Document Intelligence Flask engine.
// Encodes the spec §8 "data model gotchas" AND the Phase-0 fixture
// discrepancies (see frontend/src/test/fixtures/README.md).

export type JobStatus =
  | 'processing_docs'
  | 'pending_processor_review'
  | 'processing_review'
  | 'pending_reviewer_approval'
  | 'completed'
  | 'failed'

// ── Classified documents (job.files[]) ─────────────────────────────
// Discriminated union by stage. NOTE (Phase 0): amount/date/account_number
// are nullable — not always strings as the spec implied.
interface ClassifiedFileBase {
  original_name: string
  classified_name: string
  category: string
  account_number: string | null
  amount: string | null // e.g. "270.41" or null
  date: string | null // e.g. "30.06.25" or null
  confidence?: number | null // 0-100 LLM self-reported classification confidence
}

export interface PendingFile extends ClassifiedFileBase {
  reasoning: string
  status?: undefined
}

export interface ApprovedFile extends ClassifiedFileBase {
  notes: string
  status: 'Approved'
  // Metric 2 (CWR) provenance — set at processor-review approval time. See
  // docs/EVALUATION_METRICS_REQUIREMENTS.md.
  ai_category?: string | null
  ai_confidence?: number | null
  overridden?: boolean
}

export type JobFile = PendingFile | ApprovedFile

export function isApprovedFile(f: JobFile): f is ApprovedFile {
  return 'status' in f && f.status === 'Approved'
}

export interface UnprocessedFile {
  filename: string
  path: string
  reason: string
}

// ── Phase 2 reconciliation context ─────────────────────────────────
export interface ReconSummary {
  matched: number
  total: number
  unmatched: number
}

// A bank/reconciliation transaction (Phase 5). credit/debit are floats or null;
// `status` is "matched" | "unmatched".
export interface ReconTxn {
  date: string
  description: string
  credit: number | null
  debit: number | null
  status: string
  type?: string
  matched_document?: string | null
  unmatched_reason?: string | null
  account_name?: string
  account_number?: string
  smsf_category?: string
}

export interface ReconAccount {
  account_name: string
  account_number: string
  transactions: ReconTxn[]
}

export type QueryStatus = 'pending' | 'sent' | 'dismissed' | string

export interface ClientQuery {
  id: string
  category: string
  query_text: string
  status: QueryStatus
  transactions: ReconTxn[]
  sub_queries?: ClientQuery[] | null
}

// reconciliation_results is a DICT keyed by account number (Phase 0), not a list.
export type ReconciliationResults = Record<string, ReconAccount>

export interface AuditorNote {
  title: string
  description: string
  type: 'error' | 'warning' | string
}

export interface Phase2Context {
  summary?: ReconSummary
  queries?: ClientQuery[]
  reconciliation_results?: ReconciliationResults
  bank_accounts?: unknown
  supporting_documents?: unknown
  unprocessed_files?: UnprocessedFile[]
  fund_id?: string
  job_type?: string
  processor_notes?: string
  reconciliation_notes_path?: string
  [k: string]: unknown
}

// ── Phase 2 results (lead schedules / compliance) ──────────────────
export interface JobResults {
  cash_reconciliation?: unknown
  portfolio_reconciliation?: unknown
  tax_reconciliation?: unknown
  member_reconciliation?: unknown
  checklist?: unknown
  [k: string]: unknown
}

// ── Token usage ────────────────────────────────────────────────────
// Real shape from job.token_usage: per-phase + job totals (+ raw calls).
// Null on jobs created before usage tracking. Guard every consumer.
export interface TokenTotals {
  total_tokens: number
  cost_usd: number
}
export interface TokenUsage {
  job_total?: TokenTotals
  phases?: Record<string, TokenTotals>
  calls?: unknown[]
  available?: boolean // legacy /token-usage endpoint variant
  [k: string]: unknown
}

// ── Job ────────────────────────────────────────────────────────────
export interface Job {
  job_id: string
  fund_id: string
  fund_name: string
  abn: string
  job_type: string
  status: JobStatus
  progress_percent?: number
  message?: string
  created_at: string // space-separated "2026-06-19 11:08:31", NOT ISO
}

export interface JobDetail extends Job {
  logs: string[] // plain strings like "[10:33:31] Job created …", NOT level objects
  files: JobFile[]
  unprocessed_files: UnprocessedFile[]
  processor_notes?: string
  reviewer_notes?: string
  auditor_notes?: unknown
  results?: JobResults | null
  phase2_context?: Phase2Context | null
  token_usage?: TokenUsage | null
}

// ── Funds & playbook ───────────────────────────────────────────────
// NOTE (Phase 2): funds use `id`/`name` — NOT `fund_id`/`fund_name` (those
// are job fields). Confirmed against live /api/funds.

// Playbook[job_type][category] is a comma-separated keyword STRING (engine
// format). The global playbook lives at /api/playbook; per-fund additive
// tuning lives in fund.keyword_complements (see docs/PLAYBOOK_REFACTOR_DESIGN.md).
export type Playbook = Record<string, Record<string, string>>

export interface Fund {
  id: string
  name: string
  abn?: string
  folder_path?: string
  members?: unknown
  bank_accounts?: unknown
  // Additive per-fund keyword/category complements (merged onto the global
  // playbook at processing time). Replaces the former per-fund `keywords` copy.
  keyword_complements?: Playbook
  [k: string]: unknown
}

// ── Request payloads ───────────────────────────────────────────────
export interface CreateJobPayload {
  fund_id: string
  job_type: string
}

// POST /api/jobs/create returns a thin ack (NOT a full job record).
export interface CreateJobResponse {
  status: string
  job_id: string
  message: string
}

// The (possibly-edited) file rows sent on processor sign-off.
export interface ReviewFile {
  original_name: string
  classified_name: string
  category: string
  account_number: string | null
  amount: string | null
  date: string | null
  notes?: string
}

export interface ProcessorReviewPayload {
  files: ReviewFile[]
  processor_notes: string
}

// POST /api/funds with a fund's id + its additive keyword complements.
export interface SaveFundComplementsPayload {
  id: string
  keyword_complements: Playbook
}

export interface ReviewAck {
  status: string
  message: string
}

export interface ReviewerReviewPayload {
  reviewer_notes: string
}

export interface QueryStatusPayload {
  status: 'sent' | 'dismissed'
  query_text?: string
}
