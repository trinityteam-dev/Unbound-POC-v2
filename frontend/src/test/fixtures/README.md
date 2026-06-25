# API Fixtures (Phase 0)

Captured from the live Flask engine on 2026-06-24 (`:5001`) for use as MSW mocks and component-test data. **Real responses win over the spec** — discrepancies noted below.

## Fixture → status map (Appendix B)

| Fixture | Status | Source |
|---|---|---|
| `job_details__pending_processor_review.json` | `pending_processor_review` | **live** — `job_20260619_110831` |
| `job_details__pending_reviewer_approval.json` | `pending_reviewer_approval` | **live** — `job_20260621_103331` |
| `job_details__completed.json` | `completed` | **live** — `job_20260531_111001` |
| `job_details__processing_docs.json` | `processing_docs` | **synthesized** from `pending_processor_review` (status + `progress_percent:45` + message) |
| `job_details__processing_review.json` | `processing_review` | **synthesized** from `pending_reviewer_approval` (status + `progress_percent:62` + message) |
| `job_details__failed.json` | `failed` | **synthesized** from `pending_processor_review` (status + error message) |

The 3 transient statuses (`processing_docs`, `processing_review`, `failed`) are runtime-only and can't be captured at rest, so they're derived from real records. Re-capture live if a real one is ever observed.

## Other fixtures

| Fixture | Endpoint |
|---|---|
| `jobs_list.json` | `GET /api/jobs` |
| `funds_list.json` | `GET /api/funds` |
| `funds_discover.json` | `GET /api/funds/discover` (currently `[]`) |
| `reconciliation__pending_reviewer_approval.json` | `GET /api/jobs/:id/reconciliation` |
| `token_usage__pending_reviewer_approval.json` | `GET /api/jobs/:id/token-usage` (currently `{"available": false}`) |

## ⚠️ Discrepancies vs FRONTEND_REBUILD_SPEC.md — encode these in `types.ts`

1. **`file.amount` is `string | null`** — not always a string. Real data: `"270.41"`, `"517.00"`, **and `null`**. Spec §8 said string only. Guard for null in the Amount column.
2. **`file.date` is `string | null`** — `"01.07.24"`, `"30.06.25"`, **and `null`**. Same guard.
3. **`file.account_number` is `string | null`** — present on the union but often null.
4. **`reconciliation_results` is a dict keyed by account number** (e.g. `{"122593890": {...}}`), **not a list**. Iterate `Object.entries()`; the account list for the switcher comes from these keys + `phase2_context.bank_accounts`.
5. **`phase2_context.summary` only has `{matched, total, unmatched}`** — the metric strip's *Queries* count comes from `queries.length` and *Exceptions* from `auditor_notes`, exactly as spec §6.2 states (just confirming `summary` does **not** carry those).
6. **`job.logs[]` are plain strings** like `"[10:33:31] Job created for fund …"` — **not** level-tagged objects. Log level for coloring must be inferred from text (e.g. `error`/`warn` substrings), or render uncolored.
7. **`phase2_context` carries extra keys** beyond spec: `bank_accounts`, `supporting_documents`, `reconciliation_notes_path`, `unprocessed_files`. Type as optional.
8. **`unprocessed_files[]` shape** = `{filename, path, reason}` (confirmed for Phase 4 error list).
9. **`created_at` is space-separated** `"2026-06-19 11:08:31"` (confirmed — not ISO).
10. **`token-usage` can be `{"available": false}`** with no figures — header cost must guard on `available`.
11. **`GET /api/jobs` returns a very large payload (~732KB)** — it appears to include full job records, not a slim list. Consider whether the list view needs all of it; do not block render on its size. (Backend unchanged per POC rules — just be aware.)
12. **Funds use `id` / `name`, NOT `fund_id` / `fund_name`** (Phase 2). `GET /api/funds` items are `{ id, name, abn, folder_path, members, bank_accounts, keywords }`. Jobs use `fund_id`/`fund_name`; funds do not. Passing `undefined` as a Mantine `Select` value (from the wrong key) crashes `OptionsDropdown` — always map fund options from `id`/`name`.
13. **`job.abn` can be empty string** (Phase 2) — guard before rendering an "ABN …" line.

### Confirmed-as-spec'd
- `file` discriminated union: pending → has `reasoning`, no `status`/`notes`; approved → has `status:"Approved"` + `notes`, no `reasoning`. ✓
- `results` keys: `cash_reconciliation`, `portfolio_reconciliation`, `tax_reconciliation`, `member_reconciliation`, `checklist`. ✓
- `query` keys: `category`, `id`, `query_text`, `status`, `sub_queries`, `transactions`. ✓
