# Reconciliation: "CLOSING BALANCE" Rows Leaking Into Transaction Listing

## Problem

In the A H Smith Consulting Super Fund job run on GLM-5.2 (`job_20260704_222430`),
the reconciliation transaction table showed a literal `CLOSING BALANCE` line for
bank account 476541 but nothing at all for account 572080 — an inconsistency,
not a deliberate difference.

Pulling the raw statement text for 476541 (a 10-page file merged from 3 different
source Westpac PDFs across multiple statement periods) showed **8 separate
"Closing Balance" occurrences** with different figures (`$2.56, $27,842.04,
$25,715.44, $214,181.65, $197,174.96, $14,806.14, $5,502.76`). All 8 were
extracted by the LLM as if they were real transactions — each with
`amount_status: "unresolved"` (no debit/credit could be read for a balance
label), inflating the "amount(s) not read" count and cluttering the transaction
list with fake unmatched rows.

## Root Cause

The transaction-extraction prompt (`_parse_via_llm`, `core_engine.py`) already
told the model to exclude closing-balance lines:

> "INCLUDE the opening ... row ... Exclude only closing/summary lines."

Reproducing this directly against the two accounts' actual statement text with
GLM-5.2:

- **572080** — a single, clean 2-line page (`STATEMENT OPENING BALANCE` /
  `CLOSING BALANCE`, nothing else): the model followed the rule correctly,
  kept the opening row, dropped the closing row.
- **476541** — the 10-page merge spanning several statement periods, each with
  its own opening/closing balance box: the model did **not** generalize the
  rule to "every occurrence." It appears to have read "exclude closing/summary
  lines" as referring to a single, final closing line at the end of the
  document — and treated the other 7 mid-document closing-balance boxes
  (period boundaries within the merged file) as legitimate rows worth keeping.

This is a prompt-ambiguity problem, not a one-off model mistake: the instruction
never said what to do when the statement text contains *multiple* closing-balance
occurrences, so behavior diverged between a trivial single-occurrence input and
a complex multi-occurrence one.

(Separately, the 10-page 476541 file being a merge of *3 different accounts'*
statement pages, not just multiple periods of the same account, is a distinct
page-attribution bug tracked in `docs/BANK_ACCOUNT_DISCOVERY_RCA.md` — not
addressed here.)

## Fix

Tightened the extraction rules in `_parse_via_llm` (`core_engine.py:1520-1526`)
to make "every occurrence" explicit for both directions:

```
# Before
- INCLUDE the opening "Brought forward" / opening-balance row (with its balance) as the
  first row, so the running balance has an anchor. Exclude only closing/summary lines.

# After
- INCLUDE every "Brought forward" / opening-balance / "Statement Opening Balance" row you
  encounter (with its balance), so the running balance has an anchor. A single statement
  text may contain SEVERAL of these if it spans multiple periods merged together (e.g. one
  per quarter) — include ALL of them, not just the first.
- EXCLUDE every "Closing Balance" / "Statement Closing Balance" / period-summary row you
  encounter — ALL occurrences, not just the last one in the text. A merged multi-page
  statement covering several periods will have MULTIPLE closing-balance lines scattered
  through it (one per period boundary, not only at the very end); every single one of them
  must be dropped, none should ever appear as a transaction row in your output.
```

## Verification

Re-ran `_parse_via_llm` (model `z-ai/glm-5.2`) against both accounts' actual
statement text from the job workpapers:

| Account | Total rows | Closing-balance rows leaked | Opening-balance anchor rows |
|---|---|---|---|
| 572080 | 1 | 0 (unchanged — was already correct) | 1 |
| 476541 | 63 | **0 (was 8)** | 8 |

All 8 closing-balance boxes across the merged 476541 statement are now
correctly excluded, while all 8 opening-balance anchors (needed by
`_resolve_statement_amounts` to re-anchor the running balance at each period
boundary) are still kept.

## Note

This does not fix the separate `_find_control` first-match bug (also present
in this job) where the account's *displayed* opening/closing balance figures
come from a plain `re.search` over the whole merged text and can pick up an
early period's box instead of the true FY closing balance. That is a distinct,
still-open issue.

## Update 2026-07-05 — recurrence on Grok (inverted symptom) + deterministic fix

The prompt-only fix above was verified against z-ai/glm-5.2 only. Running the
same fund (A H Smith) on **x-ai/grok-4.20** (`job_20260705_165001`) reproduced
the same root cause on a different account and in the *opposite* direction:
account `572080`'s statement (`Bank Statement - 572080 - Bank statement.pdf`,
4 pages, one Westpac source file merged across 3 statement periods —
28/06/24-30/09/24, 30/09/24-31/03/25, 31/03/25-30/09/25, balance flat at
`$2.56` throughout, zero real transactions) produced **3 rows, all labelled
"CLOSING BALANCE"**, dated at each period's *closing* boundary
(30/09/2024, 31/03/2025, 30/09/2025) — the model kept the closing rows and
dropped the opening rows, the reverse of the original bug. All 3 surfaced as
`unmatched` transactions in the reconciliation UI (`amount_status:
unresolved`, no debit/credit — nothing for the matcher to reconcile against).

This confirms the include/exclude instruction added in the original fix is
not reliably followed across models/edge-cases (here: a statement whose
*only* content per period is the two balance-boundary lines, no real
transactions at all) — it reduces the frequency of the bug but doesn't
close the bug class, because it's still purely prompt-driven.

**Deterministic fix:** added a symmetric backstop to the opening-balance
detector that already existed (`_is_opening_balance_row` /
`_OPENING_BAL_RE`, used by `_resolve_statement_amounts` to anchor the running
balance regardless of what the LLM does). `core_engine.py`:

- `_CLOSING_BAL_RE` — `closing\s+balance|balance\s+c/?f(?:wd)?` — and
  `_is_closing_balance_row(desc)`, mirroring the opening-balance pair.
- `extract_transactions_from_statement` now filters out any row matching
  `_is_closing_balance_row` **immediately after `_parse_via_llm` returns**,
  before `_resolve_statement_amounts` ever sees it — regardless of which
  model produced it or how it worded the label. Safe to drop unconditionally:
  the account's real closing balance for tie-out purposes always comes from
  `_parse_statement_controls`' independent regex over the summary box, never
  from a transaction-table row, and a closing row's balance value is always
  identical to the next period's opening row (which is kept), so no
  balance-anchor information is lost by dropping it.
- Logs a warning with the dropped count whenever this backstop actually
  catches something, so a recurrence is visible in the job log instead of
  silent.

This is now the same pattern as the opening-balance side: a deterministic,
model-agnostic filter, not a prompt instruction the model may or may not
generalize correctly. The prompt wording from the original fix is left in
place (it still helps, just isn't solely relied upon anymore).

**Not yet done:** the specific job (`job_20260705_165001`) still shows the 3
stale rows in `jobs_db.json` — LLM/OCR extraction output is not cached, so
this only takes effect on a fresh Phase-2 run of that job (or any other).
