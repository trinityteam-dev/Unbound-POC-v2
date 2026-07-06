# Internal Transfer Detection: Keyword Whitelist Replaced with Structural Matching

## Problem

In the latest A H Smith Consulting Super Fund job (Grok-4.20, `job_20260705_165001`),
several genuine bank-to-bank transfers between the fund's own accounts showed up as
`unmatched` transactions instead of being linked as internal transfers:

- `682765 · Westpac Business Cash Reserve`: `Withdrawal Online 1422044 Tfr Westpac Bus`
  ($30,000) vs `682773 · Westpac Business One`: `Deposit Online 2422045 Tfr Westpac Bus`
  (same amount, same date) — clearly the same transfer, unmatched.
- `682765`: `Deposit Bt Funds 90167750/Redempt` ($30,000) — clearly the cash landing from
  a redemption out of the fund's own `90167750 · BT Cash Management Trust` account
  (which shows a matching `10/09/2024 | Redemption | debit=30000.0`, one day earlier) —
  unmatched, with the LLM matcher instead guessing a wrong supporting document
  ("Distribution Statement - Periodic Statement.pdf" doesn't contain $30,000) that the
  doc-grounded verifier correctly rejected.

Both were meant to be caught by `detect_internal_transfers` (`core_engine.py`), which
pairs transactions across accounts by amount + opposite direction + date proximity, but
additionally required at least one leg's narrative to contain a transfer keyword from a
fixed whitelist.

## Root Cause

Two distinct gaps in the same whitelist, `_TRANSFER_KEYWORDS = ("sweep", "transfer",
" trf", "trf ", "internal transfer", "inter-account")`:

1. **Letter-order typo.** The list has `"trf"` (t-r-f); Westpac's actual narrative
   abbreviation is `"Tfr"` (t-f-r) — a different word. `"trf" in "withdrawal online
   1422044 tfr westpac bus"` → `False`. Every `"... Tfr Westpac Bus ..."` pair in this
   job (6 pairs, $5,000 to $31,000) silently failed the keyword gate.
2. **Missing vocabulary.** The list has nothing for redemption-driven cross-account
   movements (a wrap/managed-fund cash account redeeming into a linked bank account).
   `"redempt"`/`"redemption"` was never in the list, so `90167750`'s `Redemption` rows
   never qualified as transfer candidates either, regardless of spelling.

Reproduced directly: called `detect_internal_transfers` against this job's actual stored
data in isolation — **0 pairs found** (confirms the function itself misses them, not an
ordering issue). Because these transactions never got flagged as transfers, they fell
through to the free-form LLM matcher, which — lacking real evidence — grabbed a
generically-plausible document as a guess; the doc-grounded verifier (`verify_sum_matches`)
correctly rejected the bad citation, but that just re-labels the symptom as "no supporting
document" instead of surfacing the real fix (recognize it as an internal transfer).

This is fundamentally a **keyword-whitelist problem, not a one-off typo problem**: every
bank/platform has its own narrative abbreviation ("Tfr", "Txfer", "IBT", "B/T",
"Redemption", "Sweep"...) and the list can never be complete. Patching the two gaps found
today just defers the next one to whichever bank/platform types something new tomorrow.

## Fix

Stopped treating the keyword as the deciding signal and made the actual proof
**structural**: within one fund's small, closed set of accounts, an amount moving in
**opposite directions** across **two different accounts** within a **few days** of each
other is already close to a unique fingerprint — the keyword was always the weakest part
of the evidence, not the strongest.

`detect_internal_transfers` (`core_engine.py`) now runs two corroboration tiers instead
of one hard keyword gate:

- **Corroborated** (`_transfer_corroborated`): either leg's narrative contains a transfer
  keyword (kept as a bonus signal — not required, not exhaustively maintained) **or**
  either leg's narrative names the *other* account's own number (bank-agnostic — e.g.
  `"Bt Funds 90167750/Redempt"` literally cites account `90167750`, regardless of what
  word the platform uses for "transfer"). Gets the existing generous date window
  (`max_window_days`, default 120) since text already ties the legs together.
- **Uncorroborated** (amount + opposite direction only, no textual signal at all): only
  auto-linked within a **tight** window (`uncorroborated_window_days`, default 7 — real
  intra-fund transfers clear in days, not months) **and only when that amount is
  unambiguous** — if more than one candidate pair shares an amount after corroborated
  pairs have already claimed their legs, none of them are linked. An amount coincidence
  between two genuinely unrelated transactions is only safe to trust when date AND
  uniqueness both say so; otherwise it's left for a human to check rather than guessed.

**Staging matters for correctness.** Ambiguity is recomputed *after* corroborated pairs
have claimed their legs, not before. Example from this job's real data: at $50,000 there
were three candidate cross-account pairs — the genuine BT redemption→682765 pair, the
genuine 682765→682773 "gift to mel" transfer, and a spurious 682773↔BT-redemption pair
that only existed because it shared a leg with one of the other two. Checking ambiguity
before the corroborated pair claims its legs would have flagged $50,000 as ambiguous and
suppressed the (uncorroborated, but real) 682765↔682773 pair too. Running corroborated
pairs first, removing their legs from the pool, *then* checking uncorroborated ambiguity
resolves this correctly — verified against this exact job's data.

## Verification

Ran the new `detect_internal_transfers` against `job_20260705_165001`'s actual
`reconciliation_results` (offline replay, no LLM calls): **16 transactions correctly
linked (8 pairs)** — both BT redemptions ($30,000, $50,000; corroborated via
account-number reference) and all six "Tfr Westpac Bus" pairs ($5,000 through $31,000;
uncorroborated but unambiguous once the redemption legs were claimed). The two genuine
external payments to fund members that happened to share an amount and date with a
transfer leg (Melissa Anne Smith's $50,000 gift withdrawal, Alfred H Smith's $31,000 and
$7,000 final drawdowns) correctly stayed **unmatched** — they are real payments needing
their own evidence, not internal shuffles, and the fix did not sweep them in.

Needs a fresh Phase-2 run of any affected job to take effect (extraction/matching output
isn't cached).
