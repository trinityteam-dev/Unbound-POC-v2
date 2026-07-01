# POC Evaluation Metrics — Requirements & Solution Options

**Status:** Draft. Built so far: the `confidence` field (Metric 2), the
`ai_category`/`ai_confidence`/`overridden` override-tracking (Metric 1/2 Option A, in
`app.py`), and the standalone `metrics/cwr_report.py` report. Not yet built: any of the
Option B curated ground-truth sets, or anything for Metrics 3–4. See
[CODE_REFERENCE.md](CODE_REFERENCE.md) for general pipeline orientation.

## Purpose

The POC needs to demonstrate, with real numbers, that the AI pipeline is trustworthy enough
to move from "AI drafts, human signs off on everything" to "AI drafts, human spot-checks."
Four metrics were defined to make that case:

| # | Metric | One-line question it answers |
|---|---|---|
| 1 | Page Identification Accuracy | Is each page/document classified as the right type? |
| 2 | Confident-and-Wrong Rate (CWR) | Of the classifications the AI was *sure* about, how many were wrong? |
| 3 | Transaction Row & Amount Accuracy | Are bank statement line items captured correctly? |
| 4 | Balance Chain & Gap Accuracy | Do consecutive extracted transactions reconcile to the printed running balance? |

Metrics 1–2 evaluate **classification** (`classify_papers()`, `core_engine.py:473`).
Metrics 3–4 evaluate **extraction** (`extract_transactions_from_statement()`, `core_engine.py:1328`).

This document captures, for each metric: what it means concretely in this codebase, what
already exists to support it, the candidate ways to measure it, and a recommendation.

---

## Metric 1 — Page Identification Accuracy

### What it measures

For every page/document the pipeline classifies into one of the ~29 taxonomy categories
(`core_engine.py:538-550`, e.g. "Bank & Term Deposits", "ATO Accounts", "Contribution"),
was the assigned category the objectively correct one? This is a plain accuracy metric:
`correct_classifications / total_classifications`.

### Current pipeline state

- Classification happens once per file in `classify_papers()` (`core_engine.py:473`), via an
  LLM call (`core_engine.py:613-633`) with a rule-based fallback if the LLM call fails
  (`fallback_classify_by_keywords()`, `core_engine.py:859`).
- There is no ground truth anywhere in the repo today — `data/ADMCM/` and the other fund
  folders under `data/` are real sample documents used for functional testing, not labeled
  for classification accuracy.
- The one signal that already exists in the workflow: a human **processor** reviews every
  Phase-1 classification before approval (`pending_processor_review` status) and can override
  the category via the frontend (`InlineOverride`, wired through `onApplyOverride` in
  `frontend/src/components/Workspace.tsx:133`). Today that override is applied but the fact
  that an override *happened* is not recorded — `app.py`'s approval step
  (`app.py:650-724`) only keeps the final category, not whether it differs from the Phase-1
  AI category.

### Solution options

**Option A — Track processor overrides as an implicit correctness signal (production proxy)**
Persist `ai_category` (the original Phase-1 category) and `overridden: bool` on each approved
file record, computed at the existing comparison point in `app.py` (`app.py:664`,
`if prior and prior.get("category") == category:`). Accuracy ≈ `1 - (overridden_count / total)`,
computed by scanning `jobs_db.json` across all historical jobs.
- **Pros:** Zero extra labeling effort. Runs continuously in production, so the number
  reflects real documents/real fund data, not a static sample. Cheap to build — the diff
  point already exists in the code.
- **Cons:** Biased optimistic (a lower bound on the error rate). It only catches mistakes a
  human processor actually noticed while reviewing; a wrong classification that "looks right"
  and gets rubber-stamped is invisible to this metric. Also silent about *why* something was
  wrong (no confusion matrix).

**Option B — Curated ground-truth evaluation set**
Hand-label a sample of real documents (e.g. 100–200 pages spanning most of the 29 categories,
pulled from the existing `data/` fund folders) with the correct category. Run
`classify_papers()` (or a thin wrapper around the same per-file classification call) against
them offline and diff predicted vs. labeled category.
- **Pros:** Unbiased — measures true accuracy, not just human-caught accuracy. Supports a
  full confusion matrix (which categories get confused with which), which is far more
  actionable than a single number. Can be re-run against every future prompt/model version.
- **Cons:** Upfront labeling effort (someone has to manually confirm ~150 documents). The
  taxonomy has changed before (see `docs/CLASSIFICATION_PLAYBOOK_REFACTOR.md`) and will again,
  so the labeled set needs periodic maintenance or it silently drifts stale.
- **Sample format & a real-life example:** see
  [Ground-Truth Sample Format](#ground-truth-sample-format-for-metrics-1-and-2-option-b) below —
  the same labeled set also drives Metric 2's Option B.

**Option C — Hybrid (recommended)**
Use Option A as a free, always-on production monitor (dashboard-style: "override rate this
week"), and invest in Option B as a periodic, deliberate benchmark (e.g. run once per model/
prompt change) to get the unbiased number and the confusion matrix. Option A tells you
*trend*; Option B tells you *ground truth*.

### Recommendation

**Option C.** Build Option A first (it's a few lines in `app.py` plus a small report script)
since it's immediately available from data already flowing through the system. Schedule
Option B as a one-time investment to calibrate/validate what Option A is implying.

---

## Metric 2 — Confident-and-Wrong Rate (CWR)

### What it measures

Of the classifications the AI was *confident* about, what fraction were actually wrong
(Type 1 error / false positive on the AI's own certainty). This is the metric that tells you
whether "high confidence" can be trusted as a safe-to-skip-review signal.

`CWR = count(confidence ≥ threshold AND wrong) / count(confidence ≥ threshold)`

### Current pipeline state

- **Already built:** every Phase-1 classification now returns a `confidence` integer (0–100)
  from the LLM (`core_engine.py:547`, parsed at `core_engine.py:632-635`), persisted per file
  and displayed as a small colored badge next to the category in the Workpapers table
  (`frontend/src/components/workspace/WorkpapersScreen.tsx:331-345` — green ≥85, amber 60–84,
  red <60). The rule-based fallback classifier reports a fixed `confidence: 40`
  (`core_engine.py:908`), since it's a guess rather than a judged score.
- **Missing:** the "wrong" half of the equation — same ground-truth gap as Metric 1.
- **Missing:** an agreed "confident" threshold. The UI badge uses 85/60 as display tiers, but
  those weren't chosen from calibration data — they're a reasonable starting default.

### Solution options

**Option A — Override-tracking (same mechanism as Metric 1, Option A)**
Bucket every classification by its `confidence` value, and mark it "wrong" if the processor
overrode the category during review (see Metric 1 §Option A for the exact hook point).
`CWR = count(confidence ≥ threshold AND overridden) / count(confidence ≥ threshold)`.
- **Pros:** Reuses the exact same data collection as Metric 1 — no separate infrastructure.
  Gives a live, per-job-history number.
- **Cons:** Same lower-bound bias as Metric 1, but arguably *worse* here — a human reviewer is
  statistically less likely to scrutinize a document the AI (and often the UI badge) is
  loudly declaring "95% confident," so high-confidence wrong answers are exactly the ones most
  likely to slip through unnoticed. This metric is most useful, and most likely to
  under-report, at the same time.

**Option B — Curated ground-truth sample (same mechanism as Metric 1, Option B)**
Run the labeled evaluation set through classification, keep both the predicted category and
the reported confidence, and compute CWR directly against known-correct labels.
- **Pros:** Immune to the "reviewer didn't catch it" bias in Option A — this is the real
  number. Also lets you plot a full confidence-calibration curve (accuracy per confidence
  decile), not just a single threshold cut, which is the right basis for picking the
  "confident" threshold in the first place.
- **Cons:** Same labeling cost as Metric 1's Option B (and ideally the *same* labeled set
  serves both metrics, so this isn't fully additional cost).
- **Sample format & a real-life example:** see
  [Ground-Truth Sample Format](#ground-truth-sample-format-for-metrics-1-and-2-option-b) below.

**Option C — LLM-as-judge / second-opinion check**
For a sample of classifications (e.g. all confidence ≥85 ones), send the document to a second,
independent prompt or model asking it to judge whether the assigned category is correct,
without telling it what was assigned (blind), or asking it to classify independently and
diffing.
- **Pros:** Scales further than manual labeling without needing a human at all — can run over
  every real job's output, not just a curated sample.
- **Cons:** Not true ground truth — if the judge model shares blind spots with the classifier
  (both trained on similar data, both confused by the same edge cases, e.g. the "Activity
  Statement" naming trap noted in `core_engine.py:532`), this systematically under-detects the
  errors that matter most. Best treated as a supplementary signal, not a substitute for B.

### Recommendation

Build the confidence tracking (done) plus Option A immediately — it's nearly free given
Metric 1's infrastructure. But **do not treat Option A's CWR as the final number** for this
metric specifically, because of the under-reporting bias described above; prioritize Option B
(curated ground truth) for CWR over Metric 1, since a false "high confidence" is the single
riskiest failure mode for a human-in-the-loop workflow that's trying to reduce review burden.
Option C can be added later as a cheap way to widen coverage between periodic Option B runs.

**Open decision:** what confidence threshold defines "confident"? Recommend deferring this
choice until Option B produces a calibration curve — pick the threshold where empirical
accuracy actually starts exceeding, say, 98%, rather than assuming the UI's 85 cutoff is right.

---

## Ground-Truth Sample Format for Metrics 1 and 2 (Option B)

Metric 1's Option B and Metric 2's Option B consume the *same* curated, hand-labeled sample —
one verified classification per document, made by a human who read it, not inferred from the
AI's own output. This section defines the schema and gives a worked example.

### Grain: one record per source document, not per page

Classification runs once per source file (`classify_papers()`, `core_engine.py:473`) — the
exception is bank statements, whose *pages* get grouped and merged by account
(`core_engine.py:553-720`). For this ground-truth set, label at the document level: "this file
is correctly classified as category X." Validating the page-splitting/account-grouping logic
itself is a separate, narrower exercise and not what Metrics 1–2 are asking.

### Schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Stable id, e.g. `<fund_slug>__<filename_slug>` |
| `fund` | string | yes | Fund folder name under `data/`, for traceability back to source |
| `file_path` | string | yes | Path relative to `data/`, e.g. `Acme Family Superannuation Fund/Invoice INV-00231.pdf` |
| `true_category` | string | yes | One of the active playbook categories, exactly as listed in `core_engine.py:538-550` |
| `true_sub_type` | string \| null | no | Mirrors the classifier's `sub_type` field — enables finer-grained confusion analysis |
| `source_excerpt` | string \| null | recommended | First ~300 chars of the extracted/OCR'd text the classifier actually sees. Lets a reviewer re-check the label without re-opening the PDF, and records *which* extraction (raw text vs. OCR) the label is judging |
| `labeling_rationale` | string | yes | Why this is the correct category — mandatory for ambiguous cases; this is what makes the label defensible later and reusable for prompt tuning |
| `difficulty` | enum: `clear` \| `ambiguous` | recommended | Flags cases that hinge on a precedence rule (`core_engine.py:529-536`) rather than an obvious keyword match, so accuracy can be reported separately for "easy" vs. "hard" cases instead of one blended number |
| `labeled_by` / `labeled_at` | string / date | yes | Audit trail — who made the call and when |

### Worked example (5 records)

Modeled on real document *types* found across the sample funds in `data/` — see
**Handling real client data** below for why fund/member identifiers are placeholders rather
than the literal values.

```json
[
  {
    "id": "acme_super__bank_statement_2025",
    "fund": "Acme Family Superannuation Fund",
    "file_path": "Acme Family Superannuation Fund/Bank Statements 2025.pdf",
    "true_category": "Bank & Term Deposits",
    "true_sub_type": "Everyday transaction account statement",
    "source_excerpt": "Interest\nAdviser Fees\nHUB 24 Investment\nMember A Super Guarantee\nMember B SGC $2157.72 SalSac $4284...",
    "labeling_rationale": "Filename and body both confirm this is the fund's periodic bank statement; page-1 embedded text is sparse (scanned) but institution/account markers are present once OCR'd.",
    "difficulty": "clear",
    "labeled_by": "trinityteam@befree.com.au",
    "labeled_at": "2026-07-01"
  },
  {
    "id": "acme_super__activity_statement_naming_trap",
    "fund": "Acme Family Superannuation Fund",
    "file_path": "Acme Family Superannuation Fund/Activity Statement for Acme Family Superannuation 01Jul2024-30Jun2025.pdf",
    "true_category": "Other Expenses",
    "true_sub_type": "Accountant's Statement of Account / Activity Statement",
    "source_excerpt": "PAYMENT ADVICE\nTo: [External Accounting Firm] Pty Ltd\n...\nSTATEMENT - Activity\nAcme Family Superannuation...",
    "labeling_rationale": "Filename says 'Activity Statement', which reads like an ATO document, but the issuer block ('To: [External Accounting Firm] Pty Ltd') shows it was generated by the fund's private accountant, not the ATO. Per the NAMING TRAP rule (core_engine.py:532), a private-accountant-issued Activity Statement/Statement of Account is 'Other Expenses', not 'ATO Accounts' — this is exactly the case a keyword-only check gets wrong.",
    "difficulty": "ambiguous",
    "labeled_by": "trinityteam@befree.com.au",
    "labeled_at": "2026-07-01"
  },
  {
    "id": "acme_super__ato_income_tax_account",
    "fund": "Acme Family Superannuation Fund",
    "file_path": "Acme Family Superannuation Fund/ATO Income Tax Account 2025.pdf",
    "true_category": "ATO Accounts",
    "true_sub_type": "ATO integrated client account",
    "source_excerpt": null,
    "labeling_rationale": "Scanned document with no embedded text layer on page 1 (OCR required); the letterhead, viewed directly, is a genuine ATO Income Tax Account statement — contrast with the activity-statement case above, which looks similar by filename but has a different issuer.",
    "difficulty": "clear",
    "labeled_by": "trinityteam@befree.com.au",
    "labeled_at": "2026-07-01"
  },
  {
    "id": "acme_super__member_a_concessional_contribution",
    "fund": "Acme Family Superannuation Fund",
    "file_path": "Acme Family Superannuation Fund/Member A Concessional Contributions 2025.pdf",
    "true_category": "Contribution",
    "true_sub_type": null,
    "source_excerpt": null,
    "labeling_rationale": "Title and main table report a concessional contribution amount and cap usage for one member — per the Contribution-vs-ATO-Accounts precedence rule (core_engine.py:533), this is 'Contribution' even though the document also references the member's Total Superannuation Balance in passing.",
    "difficulty": "ambiguous",
    "labeled_by": "trinityteam@befree.com.au",
    "labeled_at": "2026-07-01"
  },
  {
    "id": "acme_super__audit_invoice",
    "fund": "Acme Family Superannuation Fund",
    "file_path": "Acme Family Superannuation Fund/Invoice INV-00231.pdf",
    "true_category": "Other Expenses",
    "true_sub_type": "Audit fee invoice",
    "source_excerpt": "TAX INVOICE\nAcme Family Superannuation\n...\nInvoice Number INV-00231\n...",
    "labeling_rationale": "Standard accounting/audit firm tax invoice — unambiguous match to Other Expenses.",
    "difficulty": "clear",
    "labeled_by": "trinityteam@befree.com.au",
    "labeled_at": "2026-07-01"
  }
]
```

Note the deliberate mix: 3 "clear" cases (bank statement, genuine ATO document, invoice) and 2
"ambiguous" ones that hinge on a precedence rule rather than a keyword match. A ground-truth
set made up entirely of easy cases will report inflated accuracy and tell you nothing about
where the classifier actually struggles — bias the sample toward the precedence-rule edge
cases enumerated in `core_engine.py:529-536` (prior-year override, issuer routing, the naming
trap, contribution vs. ATO-accounts, insurance routing, lender-vs-borrower). Those are exactly
where the keyword-only fallback classifier (`fallback_classify_by_keywords()`,
`core_engine.py:859`) would disagree with the LLM, and where "confident and wrong" is most
likely to occur.

### How this feeds Metric 2 (CWR) specifically

Run each `file_path` through classification, capture the predicted `category` and
`confidence`, and compare to `true_category`:

```
wrong             = predicted_category != true_category
confident_wrong   = wrong AND confidence >= threshold
CWR               = count(confident_wrong) / count(confidence >= threshold)
```

Because this sample is hand-verified, `wrong` here is unbiased — unlike the Option A
production proxy (`overridden`, tracked today via `app.py:679-681` and reported by
`metrics/cwr_report.py`), it does not depend on whether a human processor happened to notice
the mistake. Running the classifier against this sample also produces the confidence
calibration curve referenced in Metric 2's "Open decision" below: plot accuracy against
confidence decile, and pick the "confident" threshold where accuracy crosses your risk
tolerance instead of assuming the UI's 85/60 tiers are correct.

### Handling real client data

`data/` is git-ignored (see `.gitignore`: "Fund source documents (client PDFs — never
commit)") because it holds real client fund names, member names, and financial documents. The
worked example above is modeled on real document types and real extracted-text excerpts found
in the sample fund folders, but fund/member identifiers are replaced with placeholders
(`Acme Family Superannuation Fund`, `Member A`/`Member B`, `[External Accounting Firm]`) —
institution names that already appear verbatim in the shipped classification prompt itself
(ATO, ASIC, HUB24, Ord Minnett, etc., `core_engine.py:531`) are left as-is since they identify
no individual. When the real ground-truth file is built:

- Keep it out of git (e.g. `metrics/ground_truth/`, added to `.gitignore`) — its
  `file_path`/`fund` values will reference real client filenames.
- If it needs to be shared or reviewed by people without `data/` access, strip real
  fund/member names the same way this example does, keeping only the fields that actually
  drive the metric: `true_category`, `true_sub_type`, `difficulty`, `labeling_rationale`.

---

## Metric 3 — Transaction Row & Amount Accuracy

### What it measures

For bank statement pages, are the individual transaction rows extracted correctly — right
date, right description, right debit/credit amount — compared to what's actually printed on
the statement?

### Current pipeline state

- Extraction happens in `extract_transactions_from_statement()` (`core_engine.py:1328`), which
  calls the LLM-based parser `_parse_via_llm()` (`core_engine.py:1284`). Output schema per row:
  `{date, description, debit, credit, balance, raw_line}` (`core_engine.py:1290-1301`).
- A regex-based parser is referenced as "swappable" (`core_engine.py:1332`, "Approach A —
  LLM-based... `_parse_via_regex` can be slotted in") but **does not exist** — there is no
  second extraction method to cross-check against today.
- **Important gap found while writing this doc:** the extracted transaction rows are
  **not persisted anywhere**. `run_reconciliation_call()` (`core_engine.py:1659`) calls
  `extract_transactions_from_statement()` per account, holds the result in an in-memory
  `transactions_by_account` dict (`core_engine.py:1683-1687`), and only the *matched/unmatched*
  reconciliation output survives to `job["phase2_context"]["reconciliation_results"]`
  (`app.py:268`). The raw extracted rows (with `balance`) are thrown away once reconciliation
  runs. **Any approach below requires persisting `transactions_by_account` to the job record
  first** — this is a prerequisite, not a nice-to-have.

### Solution options

**Option A — Curated ground-truth statements (row-level diff)**
Manually transcribe the transaction table from a small set of real statements (e.g. 15–20,
covering the different bank formats already seen in `data/*`) into a ground-truth CSV/JSON.
Run extraction against the same PDFs and diff row-by-row: exact match on numeric
debit/credit, fuzzy/edit-distance match on description (OCR noise means exact string match is
too strict), exact or ±1-day match on date. Report row-level precision/recall (missed rows,
hallucinated rows, field-level error rate).
- **Pros:** The only option that directly measures what the metric asks — per-field
  correctness against real truth. Also surfaces *which* banks/formats are problematic.
- **Cons:** Labor-intensive to transcribe by hand, especially for scanned/OCR'd statements
  where the source itself is hard to read. Needs care in matching methodology (a naive exact
  string/date match will produce misleadingly low scores on formatting differences that don't
  matter).

**Option B — Aggregate reconciliation check (no ground truth needed)**
Without transcribing anything, verify: `sum(extracted credits) − sum(extracted debits) ==
closing_balance − opening_balance` for the statement period. This doesn't confirm each row is
individually correct, but it's a strong signal for *completeness* — missing, duplicated, or
sign-flipped rows will usually break the sum even if individual field values look plausible.
- **Pros:** Fully automatic, zero labeling cost, can run on every real job/statement going
  forward once the persistence gap above is fixed. Catches a large, important class of errors
  (dropped rows, wrong sign) cheaply.
- **Cons:** Doesn't catch description/date errors, or two offsetting errors that still balance
  by coincidence. This is really a completeness/consistency check, not a true accuracy metric
  — it overlaps heavily with Metric 4 below (see note there).

**Option C — Cross-method agreement (self-consistency)**
Build the regex-based parser that's currently just a stub reference, run it alongside the LLM
parser on the same statements, and measure agreement rate as a reliability proxy.
- **Pros:** No manual labeling needed; disagreement rate flags exactly which transactions are
  ambiguous enough to warrant human review.
- **Cons:** Agreement isn't accuracy — if both methods make the same mistake (e.g. both
  misread a smudged OCR digit the same way), it looks like 100% agreement and 0% accuracy.
  Also requires actually building the regex parser first, which is nontrivial for
  variable statement layouts — this is real net-new work, not just wiring up an eval.

### Recommendation

Fix the persistence gap first (persist `transactions_by_account` onto the job record — needed
by every option here and by Metric 4). Then do **Option A on a small gold set** for the true
accuracy number, and turn on **Option B as an always-on automatic check** on every real
statement processed, since it's nearly free once persistence exists and catches the costliest
error class (missing/duplicated transactions) with no labeling investment. Treat Option C as
a possible future addition, not a near-term priority — it requires building extraction
infrastructure that doesn't exist yet.

---

## Metric 4 — Balance Chain & Gap Accuracy

### What it measures

Do consecutive extracted transactions reconcile arithmetically —
`balance[n] == balance[n-1] + credit[n] - debit[n]` — and are there gaps in the transaction
sequence (e.g. a missing page, a missing statement period) that would explain a break in the
chain?

### Current pipeline state

- **Does not exist anywhere in the codebase.** The `balance` field is extracted per row when
  the statement prints one (`core_engine.py:1297`, "null if not shown"), but nothing reads or
  validates it. Confirmed by direct search — there is no arithmetic check, no chain-break
  detection, and no gap detection between statement periods anywhere in `core_engine.py` or
  `app.py`.
- Same persistence gap as Metric 3 applies: extracted transactions (with `balance`) aren't
  currently kept after the reconciliation call.
- Statement-to-statement grouping *does* partially exist — `classify_papers()` groups pages by
  account into `bank_account_pages` (`core_engine.py:553-557` initializes it, populated through
  the classification loop) and merges them into one PDF per account. This page-level grouping
  is a foundation for period-boundary checks (Option B below) but doesn't currently track
  statement period start/end dates as structured data.

### Solution options

**Option A — Deterministic balance-chain validator (within one statement)**
Write a small, pure function that takes the ordered transaction list for an account and walks
adjacent pairs, checking `balance[n] == balance[n-1] + credit[n] - debit[n]` within a cent
tolerance (to absorb rounding). Report: number of breaks, their transaction indices, and
`chain_accuracy = 1 - (breaks / total_transitions)`.
- **Pros:** Fully deterministic — no LLM, no ground truth, no labeling. Can run on every real
  job automatically once the persistence gap is fixed. Directly catches OCR/extraction errors
  (a misread digit, a dropped row) with no manual effort.
- **Cons:** Only works when the statement prints a running balance in the first place — some
  bank formats don't (`balance` is `null`), in which case this check can't run and you fall
  back to Metric 3's Option A/B for those statements. Doesn't catch two compensating errors
  within the same adjacency (rare, but possible).

**Option B — Cross-statement/period continuity check**
For a given account, verify that the closing balance of one statement period equals the
opening balance of the next period, ordered by date. This catches an entirely different error
class — a missing whole page or missing month, not just a bad row within one page.
- **Pros:** Catches gaps that Option A structurally cannot (Option A only looks *within* a
  contiguous extracted sequence — it can't tell you a whole page is missing). Directly
  addresses the "Gap Accuracy" half of this metric's name.
- **Cons:** Needs statement period metadata (start/end dates per merged PDF) that isn't
  currently modeled as structured data — today period boundaries are implicit in the page
  grouping (`core_engine.py:553-720`) but not surfaced as a queryable "period start/end" field.
  Some structured metadata work is needed before this check can be written, beyond just the
  validator function itself.

**Option C — Manual spot-check sampling**
A reviewer periodically picks a handful of processed accounts and manually verifies the
balance chain against the source PDF by hand.
- **Pros:** Catches anything the deterministic checks miss (e.g. genuinely ambiguous
  statement layouts, cases where both "balance" and "computed balance" happen to agree by
  coincidence but are both wrong versus the real bank record).
- **Cons:** Doesn't scale, slow, and redundant with Option A/B for the vast majority of normal
  cases — best used sparingly, as an audit-of-the-audit rather than a primary metric.

### Recommendation

Build **Option A** first — it's cheap, deterministic, immediately valuable, and directly
answers "Balance Chain Accuracy" for any statement that prints a running balance (this is
likely most of them). Follow with **Option B** once statement period metadata is modeled, to
cover the "Gap Accuracy" half of the metric that Option A structurally can't reach. Reserve
Option C for periodic audit spot-checks rather than routine measurement.

---

## Cross-Cutting Prerequisite: Persist Extracted Transactions

Metrics 3 and 4 both depend on data that is currently computed and discarded in the same
function call (`run_reconciliation_call()`, `core_engine.py:1659-1687`). Before any of the
Metric 3/4 options can be built, `transactions_by_account` (or an equivalent structure) needs
to be written to the job record — most naturally alongside the existing
`job["phase2_context"]["reconciliation_results"]` (`app.py:268`), e.g. as
`job["phase2_context"]["extracted_transactions"]`, keyed by account number, containing the
raw `{date, description, debit, credit, balance, raw_line}` rows before reconciliation
matching overwrites/reshapes them.

## Cross-Cutting: Where Everything Gets Stored Today

For reference, this is the current persistence model all of the above builds on top of:

- **Job records:** `jobs_db.json` (repo root), loaded/saved via `load_jobs()`/`save_jobs()`
  in `app.py`.
- **Per-file classification results (Metrics 1–2):** `job["files"]` array, each entry the
  dict shape produced in `classify_papers()` and passed through unchanged in `app.py:190`
  (`j["files"] = processed`), then rebuilt with human edits at approval time
  (`app.py:650-724`).
- **Phase 2 context (Metrics 3–4, once the gap above is fixed):**
  `job["phase2_context"]`, built in `build_phase2_context()` (`core_engine.py:1207`) and
  updated in `app.py` around the reconciliation step.
- **Token/cost accounting** (useful for cost-per-metric-run tracking):
  `job["token_usage"]`, recorded via `record_token_usage()` (`core_engine.py:205-229`).

## Open Questions For Follow-Up

1. What confidence threshold defines "confident" for CWR — deferred to Metric 2's Option B
   calibration curve rather than assumed from the UI's 85/60 display tiers.
2. Who owns transcribing the curated ground-truth sets for Metrics 1–3 (Option B in each),
   and how large should each set be to be statistically meaningful given ~29 categories and
   multiple bank statement formats?
3. Should the override-tracking proxies (Metric 1/2 Option A) run continuously in production
   from now on, or only be turned on for a defined POC measurement window?
