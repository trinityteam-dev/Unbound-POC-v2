# Reconciliation Match Tightening — Narrative + Amount (and Sum Tie-out)

Status: Implemented
Date: 2026-06-30
Related: [CLASSIFICATION_PLAYBOOK_REFACTOR.md](CLASSIFICATION_PLAYBOOK_REFACTOR.md),
[RECONCILIATION_MATCH_RATE_INVESTIGATION.md](RECONCILIATION_MATCH_RATE_INVESTIGATION.md)

## Problem

The Phase-2 bank reconciliation was matching transactions to the **wrong source
files**, matching on **narrative similarity alone** with no amount check. Observed on
the Hann Family Superannuation Fund (`job_20260630_072505`): of 28 matched
transactions, **20 were matched to ATO contribution *summary* screens** —

```
12× "Transfer from NetBank monthly super Josh Super Guarantee" CR 2,283.24 -> Contribution - Joshua Hann.pdf
 5× "Direct Credit ATO ... Rebecca SGC"                        CR (varies)  -> Contribution - Rebecca Hann.pdf
 ... etc
```

Every individual monthly deposit was blanket-matched to a **single annual
contribution/cap summary screen**. The transactions were genuinely contributions
(so the *category* was right), but:

1. Matching was **description-only** — the amount never had to agree with anything in
   the document, so a transaction could match a document that merely mentions a
   similar narrative.
2. A **summary/annual-total document** (ATO contribution cap screen, TSB report) was
   used as **per-deposit substantiation** — 14 deposits "matched" to one screen with
   no tie-out, giving false audit comfort.

Root cause: [build_reconciliation_prompt](../core_engine.py) instructed the LLM to
mark each transaction matched/unmatched against supporting-document *text*, with no
requirement that the **amount** reconcile and no notion of a **many-to-one sum**
match. (Amplified by the classification refactor, which correctly made ATO
contribution screens available as `Contribution` documents, giving the matcher an
attractive narrative-only target.)

## Requirement

1. A transaction matches only when a document corroborates **narrative + amount**.
2. If there is no 1-to-1 match, allow a **many-to-one** match: a set of similar-
   narrative transactions whose amounts **sum** to an amount stated in one supporting
   document (e.g. 12 monthly SG credits summing to the annual concessional total).
3. If neither holds, the transaction is **unmatched**.

## Fix

Rewrote the reconciliation system prompt in `build_reconciliation_prompt` to enforce
a three-tier matcher and extended the per-transaction JSON schema:

- **Method 1 — `one_to_one`**: a single document has an amount equal (to the cent) to
  the transaction AND a matching narrative.
- **Method 2 — `many_to_one_sum`**: similar-narrative transactions are matched
  together only when their amounts **sum** to a document amount; all members share a
  `match_group` id and carry `matched_amount` = that document total.
- **Method 3 — `unmatched`**: otherwise.

Guardrails added:
- Summary/annual-total/cap documents (ATO contribution or TSB statements, annual tax
  statements) are **corroborating only** — never per-deposit matched by narrative;
  they may only be matched via the sum tie-out, and only if amounts actually add up.
- **No double-counting** — the same document amount cannot match more than one
  transaction/group.

New per-transaction schema fields (additive; the result parser stores the whole
object and downstream still keys off `status == "matched"`):
`match_type` (`one_to_one` | `many_to_one_sum` | `unmatched`), `matched_amount`,
`match_group` (shared id for sum-match members).

### Deterministic tie-out (guards LLM arithmetic)

Because LLM arithmetic across many rows is unreliable, the sum comparison is NOT left
to the model. After `run_reconciliation_call`, `verify_sum_matches()` recomputes the
amounts in code and downgrades any match that does not actually add up:
- `one_to_one` — downgraded only on a *proven* contradiction (transaction amount and
  `matched_amount` both parse and differ beyond one cent).
- `many_to_one_sum` — the group's transaction amounts are summed and compared to
  `matched_amount`; if the target is missing/unparseable or the sum differs beyond a
  cent, every member of the group is reset to `unmatched`.
Downgraded transactions become `unmatched` and flow into the query generator.

Files:
- `core_engine.py:build_reconciliation_prompt` (prompt + schema)
- `core_engine.py:verify_sum_matches` (+ `_recon_parse_amount`, `_recon_txn_amount`,
  `_recon_mark_unmatched`) — deterministic tie-out
- `core_engine.py:run_bank_reconciliation_phase` — calls `verify_sum_matches` right
  after the reconciliation LLM call, before matched/unmatched counting.

## Expected effect (re-run required — LLM output is not cached)

- Josh's monthly SG credits become a single `many_to_one_sum` group tied to the
  concessional-contribution total, or **unmatched** if they do not sum to any stated
  total — instead of 12 narrative-only matches.
- Transactions whose amount corroborates nothing on file fall to **unmatched** and
  flow into the query generator, rather than being falsely matched.

## Notes

- Amounts are read from the transaction `credit`/`debit` fields; if future statement
  extraction changes those field names, update `_recon_txn_amount` accordingly.

## Follow-up RCA (Seyffer `job_20260701_230857`) — the tie-out was circular

Even after the above, matches were still wrong. Two examples on NAB `199860672`:
a **$15,000 "Victory Consulting sweep to NAB"** matched to `Contribution - Claudia
Seyffer.pdf`, and **$1,664.84 Superchoice** deposits matched to
`Contribution - Bernard Seyffer.pdf` — amounts that appear in **neither** document.

**Root cause.** `verify_sum_matches` validated the transaction amount against the LLM's
own `matched_amount` field, which the model populates by **echoing the transaction's
own amount** (confirmed: 40/40 `one_to_one` rows had `matched_amount == txn amount`).
So the check `txn == txn` was circular and never fired. It never confirmed the amount
actually appears in the cited document. Compounding: the model labelled per-deposit
matches as `one_to_one` instead of `many_to_one_sum`, and ignored the internal-transfer
rule for the $15k sweep (whose real counter-leg is a $15k debit on the Macquarie
statement).

**Fix (document-grounded).**
1. `_build_doc_amount_index()` extracts the set of monetary amounts actually printed in
   each supporting document (reusing cached OCR). `verify_sum_matches(reconciliation_
   results, doc_amounts=...)` now downgrades a `one_to_one` match when the transaction
   amount is **absent from the cited document**, and a `many_to_one_sum` group when its
   total is not printed there. (Lenient only when a document's text is unavailable.)
2. `detect_internal_transfers()` deterministically pairs bank-to-bank transfers across
   accounts: equal amount, opposite direction, a transfer keyword on either leg, nearest
   date within a generous bound. Each leg is marked `match_type: internal_transfer`,
   `is_internal_transfer: true`, with `internal_transfer_ref = {account_number, index}`
   linking to the counter-leg (overriding any wrong LLM match).
3. `run_bank_reconciliation_phase` runs (2) then (1) after the reconciliation call.

**Verified** on the real Seyffer data: both sweeps ($15k, $25k) re-linked as internal
transfers; 19 amount-less matches (incl. all 13 Superchoice `$1,664.84`) downgraded to
unmatched with reasons like *"1664.84 does not appear in 'Contribution - Bernard
Seyffer.pdf'"*; these flow to client queries.

**Frontend (ReconciliationScreen.tsx / types.ts).** Internal-transfer rows show a
**BANK TRANSFER** badge and a clickable *"<account> — view matching line"* link that
switches to the other account's transactions and scrolls+highlights the exact
counter-leg (`internal_transfer_ref`). The counter-leg links back.

Files: `core_engine.py` — `_build_doc_amount_index`, `_extract_amounts_from_text`,
`_amount_in_doc`, `detect_internal_transfers`, `_recon_mark_internal_transfer`,
`_recon_parse_date`, `verify_sum_matches` (now document-grounded),
`run_bank_reconciliation_phase`; `frontend/src/api/types.ts` (ReconTxn fields);
`frontend/src/components/workspace/ReconciliationScreen.tsx` (badge + line jump).
