# Classification: "The Audit Year" Had No Anchor

## Problem

Running The Ghanshyam Superannuation Fund (`job_20260705_201151`), a Macquarie CMA
transaction listing covering the year ended 30 June 2023 was classified as "Wrap - Annual
Transaction Listing and Portfolio Valuation Report" instead of "Prior Year Documents".
Investigating further, two more documents had the identical bug: two 2022-dated dividend
advices classified as "Dividend Statement" instead of "Prior Year Documents".

## Root Cause

The classification prompt's precedence rule 1 (`core_engine.py`, `classify_papers`) reads:

> "content relating ONLY to a year before **the audit year** => Prior Year Documents"

but **"the audit year" was never defined anywhere** — not in the prompt, not in
`funds_config.json` (no fund had any year/period field), not collected at job creation
(`NewAuditModal.tsx`/`app.py` had zero concept of a target financial year). Compounding
this, classification runs **one document at a time** in a loop, so even a document that
states its own period clearly (the Wrap doc's `date` field was correctly extracted as
`30.06.23`) had no cross-document context to know whether that date was before or after
"the audit year" — there was nothing to compare it to. The model was, in effect, guessing
per document with no consistent reference point.

Established the fund's real audit year from direct evidence in its own documents: an
email dated 26 June 2024 reads *"Based on the balance at 30 June 2023, Jiten's minimum
pension payment for the current financial year is $37,744 ... take an additional
one-off pension payment before 30 June to ensure you meet the minimum"* — unambiguously
FY2023-24 (1 Jul 2023 – 30 Jun 2024), not FY24-25 as every hardcoded label elsewhere in
the app assumes.

This is a wider gap than just classification: Lead Schedules (`reconcile_papers`) hardcodes
`"FY25"` / `closing_bal_30jun25` / `tsb_2024`/`tsb_2025` labels for every fund — for
Ghanshyam specifically those are the wrong year.

## Fix

### 1. `financial_year_end` added to fund config

Every fund in `funds_config.json` now has a `"financial_year_end"` field — an ISO date,
the 30 June the audit is FOR (e.g. `"2024-06-30"` for FY23-24). Verified directly against
source documents for the two funds in question:

- **Ghanshyam**: `2024-06-30` (FY23-24) — from the pension email above.
- **Boulter Allen**: `2025-06-30` (FY24-25) — from its own TSB report ("Total
  superannuation balance as at 30/06/2025 ... Financial year 2024-2025") and ATO ITA
  extract (a FY23-24 return processed/refunded in Feb 2025, consistent with FY23-24 being
  the *prior* year to an FY24-25 audit).

The other 10 funds default to `2025-06-30` (FY24-25) — this matches the convention this
session's other work (reconciliation, Lead Schedules) was already implicitly built around,
but is an **inherited default, not individually re-verified** the way Ghanshyam and
Boulter Allen were. Flagging this so it isn't mistaken for confirmed fact.

### 2. Classification prompt has a concrete anchor

`core_engine.fy_context(fund_profile)` derives `{start, end, label, start_str, end_str}`
from `financial_year_end` (defaulting to `2025-06-30` if a fund predates the field).
`classify_papers`'s system prompt now opens with:

> "THIS FUND'S CURRENT AUDIT YEAR IS {label}: {start_str} to {end_str}. Use this exact
> period — not the calendar year, not today's date — as 'the audit year' everywhere below."

and rule 1 now says "before {start_str}" instead of the undefined "before the audit year",
explicitly telling the model to compare a document's own date/period against that anchor
even when the document's own text never uses the words "prior year".

`classify_workpapers.py` (the CLI mirror, kept in sync per project convention) got the
same change — `SYSTEM_PROMPT` became `build_system_prompt(financial_year_end=None)`,
with a new optional 3rd CLI argument and a duplicated `_fy_context` helper (this script
has no fund-profile plumbing at all today, so a full parameter thread wasn't in scope —
the duplication follows the same "standalone mirror" pattern the file already uses for
`find_executable`/`PDFTOPPM_PATH` etc.).

### 3. Threaded into Lead Schedules (light touch)

`reconcile_papers`'s system prompt now states the fund's real audit-year dates and
explicitly overrides the schema's literal field-name conventions: *"opening_bal_1jul24" =
balance as at {start_str}; "closing_bal_30jun25" = balance as at {end_str}; "tsb_2024" =
TSB at {start_str}; "tsb_2025" = TSB at {end_str}; the outstanding-returns key named "FY25"
should report on {label}'s return"*. The JSON key **names** were deliberately left
unchanged (renaming them would ripple into `app.py` and every Lead Schedules frontend
component reading those exact keys) — only the *values* the model fills them with are
corrected via explicit instruction.

### 4. Job record snapshots the audit year; displayed in the UI

`api_create_job` (`app.py`) now copies `fund_profile.get("financial_year_end")` onto the
new job record at creation time — snapshotted, not looked up live from `funds_config.json`
later, so a job's displayed year stays stable even if the fund's config changes after.
`WorkspaceHeader.tsx` displays it in the identity bar next to ABN: `formatFinancialYear()`
(`api/format.ts`) converts the ISO date to a `FYnn-nn` label, e.g. `ABN 16154927376 ·
FY23-24 · ...`. Jobs created before this field existed simply don't show it (`job.abn ?
... : ''`-style conditional) — no crash, graceful absence.

## Verification

- `core_engine.py`/`classify_workpapers.py`/`app.py` compile clean; frontend `tsc --noEmit`
  clean.
- `fy_context()` and `build_system_prompt()` tested directly: correct FY label/dates
  computed from an ISO date, and the CLI's f-string conversion didn't break the JSON
  schema block in the prompt (the literal `{`/`}` needed escaping to `{{`/`}}`, verified by
  successfully rendering the full ~6,400-char prompt without a KeyError).
- Reclassified the 3 documents for `job_20260705_201151`: category → "Prior Year
  Documents", `ai_category`/`overridden` set to reflect the correction (same fields the
  real processor-review flow would set), classified filenames and the physical PDFs in
  the job's `workpaper/` directory renamed to match. Verified in-browser: all 4 Prior Year
  Documents (the original correct one + 3 corrected) render in the Classified Docs tab, no
  console errors; the job's identity bar shows `FY23-24` correctly.
- **Not done**: this job's Phase 2 (reconciliation + Lead Schedules) already ran against
  the *old* categorization — the 3 corrected documents are still sitting in the stale
  `phase2_context.supporting_documents`/results built before the correction. A fresh
  Phase-2 (or full) run is needed for reconciliation and Lead Schedules to reflect the
  correction and to pick up the new audit-year-aware prompts.

## Update 2026-07-05 — rule 1 was being outranked by type-routing, not just missing an anchor

User changed Ghanshyam's `financial_year_end` to `2025-06-30` (FY24-25) and re-ran
(`job_20260705_222423`). Under this new anchor, 4 dividend advices (previously 2 were
prior-year, now all 4 are, since FY23-24 itself became prior-year) and the pension
confirmation email should all have been "Prior Year Documents" — none were.

**Root cause — different from the missing-anchor bug above.** The model now had the
correct anchor date (confirmed in its own reasoning) but talked itself out of applying
rule 1 anyway:

> *"the specific 'Dividend Statement' category takes precedence over a generic
> prior-year bucket"*
> *"does not qualify as Prior Year Documents because that is reserved for ... records
> exclusively about periods before FY24-25; this is a standard holding income document
> classified by type"* — self-contradictory: it just described exactly such a record,
> then said it doesn't count.
> *"refers to payments required before 30 June 2024, which falls in audit year
> FY24-25"* — also a date-boundary error; 30 June 2024 is the **last day of FY23-24**,
> the day before FY24-25 begins.

The model was treating "Prior-Year Override" as weaker than a strong, specific type
match, when it's supposed to be an unconditional override evaluated *before*
type-routing — the opposite precedence from what a model instinctively wants to do
(specific match feels more authoritative than a generic bucket).

**Fix:** rewrote rule 1 (`core_engine.py` and `classify_workpapers.py`, kept in sync) to:
- State explicitly it wins over every rule below "no matter how cleanly the document
  also matches a specific type category further down."
- Give the two exact failure cases as worked examples (a dividend advice paid in March
  2022; a pension payment made/required in June 2024) so the model has a concrete anchor
  for "this kind of ordinary document is still prior-year," not just an abstract rule.
- Explicitly tell it not to reason "the specific category is more precise, so it wins."
- Spell out the date boundary as "day one" / "last day" inclusive, to close the
  30-June-2024-vs-FY24-25 boundary confusion.
- Narrow the ATO/registry exception's wording further (a *live* snapshot pulled *right
  now*) so it can't be borrowed to justify exempting an ordinary dated advice/email.

**Correction applied:** reclassified all 5 documents in `job_20260705_222423` (still
`pending_processor_review` — no Phase 2 run yet, so this was a cleaner fix than the
previous job: corrected the `files` records and renamed the physical PDFs in `staging/`
directly, no stale Phase-2 output to reconcile). The job's other 3 already-prior-year
documents (Wrap listing, sundry-creditor email, and a MUFG transaction history the
model previously called "Unclassified") were correctly classified by the model itself
this run — confirms the anchor-date fix from the first pass is working; this update
fixes the separate precedence bug on top of it.

**Not yet re-verified:** whether the reworded rule 1 actually prevents this failure mode
on a fresh LLM call (today's fix was applied and the existing job's records corrected by
hand — no new job has been run against the reworded prompt yet).
