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
}

export interface PendingFile extends ClassifiedFileBase {
  reasoning: string
  status?: undefined
}

export interface ApprovedFile extends ClassifiedFileBase {
  notes: string
  status: 'Approved'
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

// Query transactions are a union (TxnEnriched | TxnSimple). Kept loose for
// the POC — refine in Phase 5 against real query data.
export interface TxnSimple {
  date?: string
  description?: string
  amount?: string
  [k: string]: unknown
}
export type TxnEnriched = TxnSimple & {
  matched?: boolean
  [k: string]: unknown
}
export type QueryTxn = TxnSimple | TxnEnriched

export type QueryStatus = 'pending' | 'sent' | 'dismissed' | string

export interface ClientQuery {
  id: string
  category: string
  query_text: string
  status: QueryStatus
  transactions: QueryTxn[]
  sub_queries?: ClientQuery[]
}

// reconciliation_results is a DICT keyed by account number (Phase 0), not a list.
export type ReconciliationResults = Record<string, unknown>

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
// May be { available: false } with no figures — always guard.
export interface TokenUsage {
  available: boolean
  total_cost?: number
  total_tokens?: number
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

// ── Funds ──────────────────────────────────────────────────────────
// NOTE (Phase 2): funds use `id`/`name` — NOT `fund_id`/`fund_name` (those
// are job fields). Confirmed against live /api/funds.
export interface Fund {
  id: string
  name: string
  abn?: string
  folder_path?: string
  members?: unknown
  bank_accounts?: unknown
  keywords?: Record<string, Record<string, string[]>>
  [k: string]: unknown
}

// ── Request payloads ───────────────────────────────────────────────
export interface CreateJobPayload {
  fund_id: string
  job_type: string
}

export interface ProcessorReviewPayload {
  files: JobFile[]
  processor_notes: string
}

export interface ReviewerReviewPayload {
  reviewer_notes: string
}

export interface QueryStatusPayload {
  status: 'sent' | 'dismissed'
  query_text?: string
}
