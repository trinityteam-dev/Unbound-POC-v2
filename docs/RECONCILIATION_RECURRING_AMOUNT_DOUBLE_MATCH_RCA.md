# Reconciliation — Recurring-Amount Double/Multi-Match RCA

Status: Investigated — prompt-level mitigation attempted and confirmed **insufficient**;
deterministic fix proposed but NOT yet implemented (deferred).
Date: 2026-07-03
Jobs: `job_20260702_140500` (pre-mitigation) and `job_20260703_094343` (post-mitigation),
both Seyffer Super 1.

## Problem

Bernard Seyffer's bank account receives four SuperChoice clearing-house credits through
FY25, all for the identical amount **$1,951.05** (his SGC is flat because ordinary pay
was flat month to month):

| Date | Description | Amount |
|---|---|---|
| 06/02/2025 | PC040225-121658232 Superchoice P/L | $1,951.05 CR |
| 27/03/2025 | PC250325-170318671 Superchoice P/L | $1,951.05 CR |
| 05/05/2025 | PC010525-160399364 Superchoice P/L | $1,951.05 CR |
| 19/06/2025 | PC170625-120853086 Superchoice P/L | $1,951.05 CR |

Only **one** supporting document exists for Bernard's contributions:
`Contribution - Bernard Seyffer.pdf`, a single payslip for the 01/06/2025–30/06/2025 pay
period. It states $1,951.05 as that period's SGC — restated three times in the document
text (period amount, deduction line, total), all describing the same one contribution
instance, not three.

**Run 1** (`job_20260702_140500`, pre-mitigation prompt): 2 of the 4 transactions
(06/02, 05/05) were matched `one_to_one` to `Contribution - Bernard Seyffer.pdf` — the
same document used twice. The other 2 (27/03, 19/06) were downgraded to `unmatched` by
`verify_sum_matches`, but with a misleading reason citing an unrelated document,
`Contribution - Claudia Seyffer.pdf` (Claudia's ATO income statement) — the LLM's
original Call 1 output had hallucinated a match to the wrong family member's document
for those two.

**Run 2** (`job_20260703_094343`, after the prompt mitigation below was added): regressed
further — **all 4** transactions now match `one_to_one` to
`Contribution - Bernard Seyffer.pdf`. One document is now being cited as evidence for
four separate transactions.

## Root Cause

The reconciliation prompt (`build_reconciliation_prompt`, [core_engine.py:1783](../core_engine.py#L1783))
has always told the LLM not to double-count a document:

> "Do NOT reuse the same document entry/amount to match more than one transaction or
> group (no double-counting)." ([core_engine.py:1928](../core_engine.py#L1928))

Nothing enforces this programmatically — `verify_sum_matches()`
([core_engine.py:2280](../core_engine.py#L2280)) only checks that a matched transaction's
amount *appears* in the cited document's OCR text; it never checks whether that same
document was already claimed by a different transaction. So compliance depends entirely
on the LLM following a prose instruction across a long generation with many candidate
transactions competing for the same evidence — exactly the kind of implicit,
state-tracked constraint LLMs are weak at, even at `temperature=0.0` (already set).

**Mitigation attempted (2026-07-03, this session):** added to the same prompt —

1. A precomputed `NOTE:` line under any supporting document whose amount recurs across
   ≥2 transactions, explicitly capping the claim at "AT MOST 1"
   ([core_engine.py:1849-1861](../core_engine.py#L1849)). Deliberately capped at 1 rather
   than a raw regex occurrence count, because raw counting over-counts same-document
   restatements (Bernard's payslip contains the figure 3×, but represents 1 instance) —
   a wrong higher number would authorize more double-counting, not less.
2. A worked example added to CRITICAL GUARDRAILS ([core_engine.py:1922](../core_engine.py#L1922))
   using this exact $1,951.05 / quarterly-SGC scenario.

**Why it made things worse, not better:** the injected NOTE strengthened the
*association* between the amount and the document ("$1,951.05 → this document is
evidence") more than it enforced the *cap* ("at most 1"). The model appears to have
latched onto the factual pointer and applied it to every transaction sharing that
amount, while the quantitative limit in the same sentence was dropped. This is a known
failure mode: instructions combining a factual assertion with a normative limit tend to
have the assertion followed and the limit ignored. Confirmed empirically — this is not
a hypothesis, it's what `job_20260703_094343` actually produced.

**Conclusion:** prompt engineering can reduce the frequency of this failure but cannot
*guarantee* a global uniqueness constraint across many transactions in one LLM call. A
hard constraint like "each document may satisfy at most one match" needs deterministic
enforcement, not just better wording.

## Solution (proposed — not yet implemented)

Add a post-LLM dedup pass in `verify_sum_matches()` (or a new step run alongside it,
[core_engine.py:2280](../core_engine.py#L2280)):

1. After the existing per-transaction verification, group all `status == "matched"`,
   `match_type == "one_to_one"` transactions by `matched_document`.
2. For any document backing more than one transaction, determine how many *distinct*
   instances of that amount the document can actually support — conservatively, 1
   unless there's clear evidence otherwise (e.g. multiple dated line items each showing
   the amount separately, which is not the common case for payslip/contribution
   documents in this fund set).
3. Keep the single best-fitting transaction (e.g. nearest document date if the document
   has one, otherwise first by transaction date) as `matched`; downgrade the rest to
   `unmatched` via `_recon_mark_unmatched` with an honest reason, e.g. "document already
   used to corroborate the [date] transaction — a separate document is needed for this
   occurrence," rather than the misleading wrong-document reason seen in Run 1.
4. Re-run affected jobs once this lands; `job_20260702_140500` and
   `job_20260703_094343`'s Bernard contribution results are not trustworthy as-is.

Not implemented yet — deferred per user request (2026-07-03) to revisit later.
