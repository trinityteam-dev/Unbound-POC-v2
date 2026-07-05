# Reconciliation — Phantom Document Citations RCA

Status: Investigated — fix NOT yet applied (analysis only)
Date: 2026-07-02
Job: `job_20260701_152935` (D & M Rigney Super Fund, run 2026-07-01 15:29)
Related: [RECONCILIATION_NARRATIVE_AMOUNT_MATCH_FIX.md](RECONCILIATION_NARRATIVE_AMOUNT_MATCH_FIX.md)

## Problem

In the Rigney reconciliation, 7 of 44 bank transactions were marked **matched** against
supporting documents that **do not exist** — not in `staging/`, not in `workpaper/`, not
in the job's `files` list. The UI renders these as document references that go nowhere.

| Date | Transaction | Amount | Phantom `matched_document` |
|---|---|---|---|
| 21/10/2024 | ASIC NetBank BPAY | $65.00 DR | `Prior Year Documents - latest ASIC statement_extract.pdf` |
| 22/10/2024 | Transfer To People Partners Pty Ltd DMRI0001 | $110.00 DR | `Accountancy_Audit fee not paid - recorded as accounting fees.pdf` |
| 26/11/2024 | Direct Credit Australian Diamo RSA-075221 | $1.00 CR | `Argyle Pink Diamond (RIGNEYDIAMOND) - sale documents.pdf` |
| 17/12/2024 | Direct Credit Australian Diamo RSA-075221 | $50,000.00 CR | `Argyle Pink Diamond (RIGNEYDIAMOND) - sale documents.pdf` |
| 06/04/2025 | Transfer To People Partners 23-24 year | $1,672.00 DR | `Accountancy_Audit fee not paid - recorded as accounting fees.pdf` |
| 29/05/2025 | Direct Credit ATO | $1.04 CR | `Deposits - CBA CDIA Account #1294 - employer contributions.pdf` |
| 13/06/2025 | Transfer to xx8963 NetBank Pink Diamond Purc | $41,500.00 DR | `GIA Diamond Colour Fancy Vivid Purplish Pink - purchase invoice.pdf` |

Additionally, **all 44 transactions came back `matched` (100%)** — no unmatched items,
no client queries generated.

## Root Cause

Four compounding causes.

### 1. The phantom names are lifted verbatim from the injected accountant notes

`build_reconciliation_prompt()` injects the fund's
`Additional Notes/All Pending Items.pdf` (the SuperRecords portal query log) at the very
top of the system prompt as *"RECONCILIATION INSTRUCTIONS FROM ACCOUNTANT — The
following notes MUST be followed"*. That PDF **describes documents that were requested
but never supplied**. The LLM treated those descriptions as available evidence and
minted filenames from the query titles:

| Phrase in `All Pending Items.pdf` | Fabricated filename |
|---|---|
| "Query: Accountancy/Audit fee not paid … please record as accounting fees" | `Accountancy_Audit fee not paid - recorded as accounting fees.pdf` |
| "Query: Deposits - CBA CDIA Account #1294 … employer contributions" | `Deposits - CBA CDIA Account #1294 - employer contributions.pdf` |
| "Query: latest ASIC statement/extract" (under "Category: Prior year documents") | `Prior Year Documents - latest ASIC statement_extract.pdf` |
| "…whether the investment made in Argyle Pink Diamond (RIGNEY DIAMOND) has been sold…" | `Argyle Pink Diamond (RIGNEYDIAMOND) - sale documents.pdf` |
| "…investment made in GIA Diamond Colour Fancy Vivid Purplish Pink … d. Purchase invoice to verify the ownership detail" | `GIA Diamond Colour Fancy Vivid Purplish Pink - purchase invoice.pdf` |

Every phantom name maps 1:1 to a query title/phrase in the notes.

### 2. The job ran on the old, lenient reconciliation prompt (pre-fix code)

The job ran 2026-07-01 15:29 on HEAD (`77f361f`), where "matched" merely meant
*"evidence found"* — no narrative+amount tie-out requirement, no `match_type` /
`matched_amount` / `match_group` fields, and **no post-LLM verification pass at all**
(`verify_sum_matches` did not exist yet; it landed in the uncommitted working tree at
~2026-07-02 00:20 per RECONCILIATION_NARRATIVE_AMOUNT_MATCH_FIX.md). Evidence: every
transaction in this job's `phase2_context.reconciliation_results` has only the 8
old-schema keys and `match_type` is absent. Hence 44/44 matched with zero scrutiny.

### 3. The real evidence was in the prompt — but under opaque `Unclassified_*` names

Classification sent the three key diamond documents to Unclassified, so the prompt
contained their full text labelled with meaningless filenames:

- `D___M_Super_Fund_Diamond_Invoice.pdf` → **`Unclassified_1.pdf`** — the actual GIA
  diamond tax invoice; its text contains both "GIA Diamond Colour Fancy Vivid Purplish
  Pink" **and $41,500**, i.e. a legitimate match for the 13/06/2025 purchase.
- `OptionToPurchaseReceipt-RSS-099154.pdf` → **`Unclassified.pdf`** — Argyle 70980
  option receipt, AUD $50,000 PAID — legitimate evidence for the 17/12/2024 credit.
- `Valuation - GIA 6221071719 260525.pdf` → **`Unclassified_2.pdf`** — GIA valuation.

Given a choice between citing "Unclassified_1.pdf" and a descriptive name matching the
notes' wording, the model invented the descriptive name. So for the diamond
transactions the *match substance* was right; the *citation* was fabricated.

### 4. No layer validates `matched_document` against the real file list

Nothing — old code or new — checks that `matched_document` is one of the supplied
supporting-document filenames. Worse, the new (uncommitted) `verify_sum_matches`
systematically **gives hallucinated filenames a free pass**:

- `doc_amounts` is keyed by real classified filenames only. A phantom name →
  `doc_amounts.get(doc)` is `None` → the one_to_one downgrade is skipped (deliberate
  leniency meant for docs whose OCR text is unavailable).
- The `amt_set is None` fallback only compares the LLM's self-reported
  `matched_amount` to the transaction amount — which the LLM echoes, so it always passes.
- It also only inspects `match_type in {one_to_one, many_to_one_sum}`; old-schema
  output (`match_type` absent) bypasses verification entirely.

So a citation of a *nonexistent* document is *less* likely to be downgraded than a
citation of a real one.

## Solution (proposed — not yet implemented)

1. **Hard filename validation after the LLM call.** Build the allowed set =
   `{classified_name for supporting_documents}` ∪ `{bank account labels}` (for internal
   transfers). Any `matched_document` outside the set: try deterministic
   re-attribution (a real document whose extracted text contains the transaction
   amount — e.g. the $41,500 invoice text — take it and flag `citation_corrected`);
   otherwise downgrade to unmatched with reason "cited document does not exist".
2. **Close the free-pass hole in `verify_sum_matches`.** Distinguish "document exists
   but amounts unknown (no OCR text)" → lenient, from "document not in the supporting
   list at all" → hard downgrade. Also treat `match_type`-absent matched transactions
   as unverified (downgrade or re-run), so old-schema/robustness-fallback output can't
   sail through.
3. **Fence the notes preamble.** Keep injecting `All Pending Items.pdf` (it carries
   genuine instructions like "record as accounting fees"), but state explicitly:
   *documents mentioned in these notes are requested/pending and are NOT available as
   evidence — never cite them as matched_document; cite only filenames from the
   SUPPORTING DOCUMENTS section.* Enumerate the allowed filenames as a numbered
   manifest in the prompt.
4. **Fix classification of collectable/diamond evidence** (secondary): the diamond tax
   invoice, option-to-purchase receipt, and GIA valuation all fell to Unclassified, so
   the model had no meaningful filename to cite. Extend the playbook (e.g. the
   Gold/Silver bullion / collectables category) to cover purchase invoices, option
   receipts, and valuations for collectables.
5. **Re-run the Rigney job** after 1–3 land; its current 44/44 matched result is not
   trustworthy (produced by the pre-fix prompt with no verification).
