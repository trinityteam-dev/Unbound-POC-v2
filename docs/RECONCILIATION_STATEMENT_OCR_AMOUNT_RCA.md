# Reconciliation — Missing Transaction Amounts (OCR) RCA & Fix

Status: Implemented
Date: 2026-07-02
Related: [RECONCILIATION_NARRATIVE_AMOUNT_MATCH_FIX.md](RECONCILIATION_NARRATIVE_AMOUNT_MATCH_FIX.md)

## Problem

In the latest Seyffer run (`job_20260702_001644`), many bank transactions appeared in
the reconciliation with a **narrative but no amount**, and were **unmatched**. Examples
on NAB `199860672`: "PC030924-174226931 Superchoice P/L", "Victory Consulting P sweep to
NAB", "PC260724-158909850 Superchoice P/L". **31 of 63** transactions had
`debit = null` and `credit = null`.

The missing amount was both the blank in the UI **and** the reason for being unmatched:
a transaction with no amount can't be amount-matched (the document-grounded tie-out and
internal-transfer pairing both require an amount), so it fell to unmatched.

## Root Cause

Investigated by comparing the OCR text against the source statement and re-OCRing at
different settings. Two compounding causes:

1. **OCR was dropping the Debits/Credits column.** At the default settings
   (**150 DPI, tesseract auto PSM 3**), none of the transaction amounts (15,000 /
   1,664.84 / …) appeared *anywhere* in the OCR text — only the **Balance** column and a
   couple of inline amounts survived. Re-OCRing at **300 DPI** recovered amounts that
   150 DPI dropped (e.g. the $15,000 sweep). So DPI was a major factor.
2. **Dot-leader rows defeat OCR even at higher DPI.** NAB rows place the amount after a
   long dot-leader run (`481471...............1,664.84`); tesseract mangles the leaders
   and swallows the amount regardless of DPI. So OCR tuning alone cannot recover every
   amount.

What OCR *does* capture reliably is the **running Balance** column. Each transaction
amount is exactly the movement in that balance — recoverable arithmetically.

Downstream, the extractor (`_parse_via_llm`) also discarded the balance, so nothing was
left to reconstruct from.

## Solution

Design constraint from review: **generic across funds/banks, and no regression to other
document types.** `psm 6` helps dense tables but *hurts* multi-column/letter layouts, so
it must not be applied to general/classification OCR.

1. **Statement-scoped OCR upgrade** — `ocr_pdf_single_page` gained `dpi`/`psm` params;
   `extract_transactions_from_statement` calls it at **300 DPI + psm 6** and applies a
   **dot-leader cleanup** (`_clean_statement_text`) that collapses `....` runs. Scoped to
   the statement-parsing path only — Phase-1 classification / general OCR keep 150 DPI +
   auto PSM, so no other document type changes.
2. **Reliable balance capture** — the `_parse_via_llm` prompt now always records the
   running `balance` (even when it appears on the line after the description), keeps the
   opening "Brought forward" row as the anchor, and leaves `debit/credit` null rather
   than guessing.
3. **Balance-delta reconstruction** (`_reconstruct_amounts_from_balances`) — for any row
   still missing an amount, `amount = balance[i] − balance[i-1]` (credit if positive,
   debit if negative), anchored on the opening balance. This is an **exact identity**,
   not a guess. Provenance is tagged: `amount_source = "ocr" | "derived" | "ocr_conflict"`
   (the last flags a read amount that disagrees with the balance movement — a
   self-validation signal). Derived amounts are surfaced in the UI as "≈ derived".
4. **Authoritative overlay** — `run_reconciliation_call` overlays the extracted
   amounts/balances/provenance onto the matcher's output by index (the matcher LLM does
   not reliably echo them), so downstream always uses the true/reconstructed values.

### "Isn't a reconstructed amount a blind match?"

No. Reconstruction recovers the **statement-side** amount; a match still requires the
amount to be corroborated by a real supporting document (the document-grounded tie-out).
A derived amount that isn't corroborated stays honestly **unmatched** — reconstruction
never creates a match. Provenance tagging + the closing-vs-read cross-check keep it
transparent and auditable.

### Also implemented in the same pass

- **Brought forward** (`is_opening_balance`) — excluded from the matcher, reconciliation
  counts, and display; used only as the delta anchor.
- **Bank interest** (`mark_no_evidence_transactions`) — a credit whose narrative is
  interest is marked `match_type = "no_evidence_required"` (matched, no document), so it
  never shows as unmatched or spawns a query. UI shows "no external evidence required".

### Generic-safety / no regression

- 300 DPI + psm 6 + dot cleanup apply **only** on the statement-extraction path — keyed
  on "this is a bank statement being parsed", not on any fund. Any fund's / bank's
  statement benefits; invoices, valuations, ASIC extracts, contributions, etc. are
  untouched (still auto PSM).

## Implementation (files / symbols)

- `core_engine.py`
  - `ocr_pdf_single_page` / `ocr_pdf_first_page` — `dpi`/`psm` params.
  - `STATEMENT_OCR_DPI` (300), `STATEMENT_OCR_PSM` (6), `_clean_statement_text`.
  - `_parse_via_llm` prompt — capture balance, keep opening row, don't guess amounts.
  - `_reconstruct_amounts_from_balances`, `_is_opening_balance_row`.
  - `extract_transactions_from_statement` — statement OCR settings + cleanup + reconstruction.
  - `run_reconciliation_call` — authoritative amount overlay; opening rows filtered from
    the matcher prompt (`build_reconciliation_prompt`).
  - `mark_no_evidence_transactions`; `detect_internal_transfers` skips opening/no-evidence.
  - `run_bank_reconciliation_phase` — order: no-evidence → transfers → doc-grounded verify;
    counting skips opening rows.
- `frontend/src/api/types.ts` — `is_opening_balance`, `amount_source`, `no_evidence_reason`.
- `frontend/src/components/workspace/ReconciliationScreen.tsx` — "≈ derived" amount tag,
  "no external evidence required" note. (Opening rows are already absent server-side, so
  the transfer counter-leg indices stay aligned — no client-side re-filtering.)

## Verification

- `py_compile` clean; frontend `tsc --noEmit` + `vite build` clean.
- Unit tests on the real NAB balance series: opening row flagged; $15,000 sweep and
  $1,664.84 Superchoice reconstructed as credits (`amount_source=derived`); an OCR-read
  interest amount kept as `ocr`; dot-leader cleanup collapses the leaders.
- Empirical OCR: 300 DPI recovers the $15,000 amount that 150 DPI dropped.
- `mark_no_evidence_transactions` marks interest rows matched/no-evidence (API-confirmed).

## Update (2026-07-02) — deeper RCA + audit safety net (Step 1, implemented)

After re-running with the reconstruction code (`job_20260702_111309`), amounts were still
wrong. Investigation of the OCR text vs the data was decisive:

- The whole ~55-transaction NAB statement OCR'd to only **9 distinct numbers** — all
  balances + the summary box. Tesseract at its best (300 DPI, PSM 6, all pages) captured
  ~57 numbers where a clean statement needs ~110: it loses **roughly half**, and the
  amount column is the casualty.
- The bogus amounts (`27,000`, `23,900`, …) appear **nowhere** in the OCR → they were
  **hallucinated by the extraction LLM** filling gaps where the amount was missing.

So the root problem is **OCR extraction** (tesseract can't read this dense dot-leader
columnar layout), with **LLM hallucination as a downstream symptom**. Reconstruction
alone can't save it because balances are captured for < half the rows.

### Fix (Step 1) — audit-grounded, corroborated, fail-safe

The durable fix is to stop trusting any single number and reconcile against the
statement's own control totals (an auditor's tie-out):

1. **Capture control totals** (`_parse_statement_controls`) — opening/closing balance,
   total credits/debits from the summary box (OCR reads these reliably).
2. **Corroborate every amount** (`_resolve_statement_amounts`) — an LLM-emitted amount is
   trusted only if it (a) appears verbatim in the statement text OR (b) equals the
   running-balance movement. Uncorroborated reads (hallucinations) are **rejected**; a
   balance delta is substituted when available, else the row is **`unresolved`** (never a
   fabricated number). Per-row `amount_status`: `ocr_confirmed | balance_confirmed |
   balance_derived | unresolved`.
3. **Statement tie-out** (`_compute_statement_reconciliation`) — `opening + credits −
   debits == closing` with zero unresolved ⇒ `reconciled`; otherwise `needs_review` with
   the `gap` and unresolved count surfaced. Fail-safe: when it can't reconcile, it flags
   for manual review instead of emitting fabricated matches.
4. **Unresolved ⇒ unmatched** with a "verify from source statement" reason
   (`run_bank_reconciliation_phase`); such rows never auto-match.
5. **Authoritative overlay** now carries `amount_status`; controls + tie-out are attached
   to each account in `reconciliation_results`.

Frontend: per-account **tie-out badge** ("reconciled" vs "does not tie out — gap $X, N
unresolved"), unresolved amounts render **"— not read"** (with reason), derived amounts
show **"≈ derived"**.

### Verified

On the real Seyffer NAB statement: the `27,000` hallucination is gone (→ `unresolved`);
22 amounts confirmed/derived, 33 honestly flagged unresolved; badge shows
`needs_review, gap $92,523.39, 33 not read`. `py_compile` + `tsc` + `vite build` clean;
no console errors.

Implementation: `core_engine.py` — `_parse_statement_controls`, `_find_control`,
`_amount_in_text`, `_resolve_statement_amounts`, `_compute_statement_reconciliation`,
`extract_transactions_from_statement` (controls_out), `run_reconciliation_call` (overlay +
tie-out), `run_bank_reconciliation_phase` (unresolved flagging). Frontend
`types.ts` + `ReconciliationScreen.tsx`.

## Update 2 (2026-07-02) — PSM 6 regression + re-allowing balance-delta derivation

A follow-up comparison (a clean 22h-old job read ~56/61 amounts; the new run recovered
only ~22/55) traced the regression to **our own changes**, not OCR density:

OCR A/B on the NAB statement (pages 1–2), everything else equal:

| Config | Amounts captured | `1,664.84` present |
|---|---|---|
| 150 DPI, default PSM 3 (original) | 11 | ✗ |
| **300 DPI, default PSM 3** | **15** | **✓** |
| 300 DPI, **PSM 6** (was applied) | **7** | **✗** |
| 400 DPI, default PSM 3 | 15 | ✓ |

- **PSM 6 was the culprit** — it collapses the page to one block and drops the dot-leader
  amount continuation lines (7 vs 15). The DPI bump (150→300) *helped*; PSM 6 more than
  cancelled it.
- The old high-coverage run had **56 amounts but 0 balances** and the amounts weren't in
  its OCR — i.e. the LLM was reading the running balances and **implicitly computing each
  amount as the balance movement**. Our prompt change ("if not clearly printed, set null;
  do NOT guess") *banned* that legitimate arithmetic, and the deterministic replacement
  only fires when a balance is stored (< half the rows), so ~50% went `unresolved`.

**Fix:**
1. `STATEMENT_OCR_PSM = None` — keep 300 DPI but use tesseract's **default PSM 3**; drop
   PSM 6.
2. `_parse_via_llm` prompt — explicitly **re-allow** computing `amount = this_balance −
   previous_balance` when the amount column isn't legible (exact identity, not guessing),
   and require capturing balances. The tie-out + corroboration remain as the *validation*
   layer (flag what fails), rather than suppressing derivation up front. Verified: when
   amounts+balances are captured, the resolver marks them `ocr_confirmed`/`balance_confirmed`
   with **0 unresolved**.

(Requires a fresh Phase-2 run to see the coverage improvement end-to-end — OCR/LLM output
is not cached.)

### Known limitations / Step 2

- **OCR is the ceiling.** The reliable long-term fix is a table-aware OCR
  (PaddleOCR PP-Structure locally, or AWS Textract / Google Document AI) behind the
  existing `ocr_pdf_single_page` seam, scoped to statements. Step 1 makes the system
  *trustworthy* regardless; Step 2 (better OCR) reduces how often it hits `needs_review`.
- **Multi-period statements**: a file that concatenates several monthly statements has
  multiple opening/closing pairs; the single-period tie-out will not balance and flags
  `needs_review` (conservative/safe, but a per-period tie-out is the better model).
- **Derived amounts on a non-tying statement** are provisional — the statement-level
  `needs_review` badge signals not to trust them without manual check.
