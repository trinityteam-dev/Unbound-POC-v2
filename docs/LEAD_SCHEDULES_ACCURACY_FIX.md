# Lead Schedules: Four Correctness Fixes

## Problem

The "Lead schedules" tab (`frontend/src/components/step2/LeadSchedules.tsx`, backed by
`reconcile_papers` in `core_engine.py`) had four distinct correctness gaps, all stemming
from the same root pattern: one giant, unverified, single-shot LLM call generating
everything, with no deterministic grounding — the same pattern already hardened for Phase 2
bank reconciliation, just not yet applied here.

1. **Cash Lead Schedule re-derived numbers the app already had, verified, from a
   different source.** Phase 2 bank reconciliation already computes each account's
   opening/closing balance deterministically from the statement's own control totals,
   with a tie-out check. Lead Schedules ignored that and asked the LLM to re-derive
   opening/closing balances from raw text a second time, in a separate call — so the
   Reconciliation tab and the Lead Schedules tab could show different balances for the
   same account.
2. **Member TSB only ever covered the first fund member.** `"member_reconciliation":
   {json.dumps(members_reconciliation[0])}` hardcoded index 0 into the schema. Any fund
   with 2+ members (the common SMSF case — e.g. a couple) would only get a TSB check for
   one of them; the rest were silently never reconciled.
3. **Securities check was hardcoded to one specific security ("MXT" — Metrics Master
   Income Trust) with literal example numbers baked into the schema**, for every fund
   regardless of what it actually holds.
4. **Every document was truncated to 12,000 raw chars before the single mega-prompt**
   (`core_engine.py`, `reconcile_papers`), even though this session's other work already
   established that several of this fund's real documents run 15,000–29,000 chars — so a
   relevant document's answer could be cut off before the LLM ever saw it.

## Fix

Same philosophy as the reconciliation hardening earlier this session: deterministic where
the app already has the answer, and don't force a check that doesn't apply to the data.

### 1. Cash — sourced from Phase 2 controls, gated on tie-out

`run_ai_reviewer_phase` / `reconcile_papers` (`core_engine.py`) now accept a
`reconciliation_results` parameter (threaded from `app.py`'s `bank_recon` result, already
in memory at the point Lead Schedules runs). After the LLM call, each cash account's
`opening_bal_1jul24`/`closing_bal_30jun25` is overlaid from
`reconciliation_results[acct]["controls"]` — **but only when that account's own tie-out
passed** (`reconciliation.tie_out is True`).

That gate matters and was caught during verification, not designed in from the start: this
job's actual data (`job_20260705_165001`) has 3 of 4 accounts with `tie_out: False` — a
merged multi-period statement can trip the already-documented `_find_control` first-match
bug (`docs/BANK_ACCOUNT_DISCOVERY_RCA.md`) and anchor on an early period's closing figure
instead of the true FY-end one. For account `682765`, the deterministic controls say
closing = `$27,842.04`, but the LLM's own free-form answer for this exact job was the
*correct* `$197,174.96`. Overriding unconditionally would have **replaced a correct number
with a known-wrong one** — the opposite of the intent. Gating on `tie_out is True` means
the override only ever replaces the LLM's guess with something that has already been
internally validated (opening + credits − debits == closing); when the deterministic
figures don't tie out, the LLM's guess is left in place rather than a worse number being
forced in.

### 2. Member TSB — all members

The prompt already built a `members_reconciliation` list for every member in the fund
profile; the bug was purely in embedding only `[0]` into the schema. Now embeds the whole
list and instructs the model to return an array of the same length, one object per member,
in order. `app.py`'s auditor-notes generation now loops over all members instead of
reading a single object. `MemberCard` (frontend) now renders one stacked entry per member
in the same card instead of a single member's data.

### 3. Securities — data-driven, not hardcoded to one security

Replaced the fixed `mxt_reconciliation`/`distribution_check` schema fields (with baked-in
example numbers) with generic arrays, `holdings_reconciliation` and `distribution_checks`.
The prompt now instructs the model to include an entry **only** for a holding it can
actually cross-reference between two independent documents (broker vs registry/wrap for a
market-value check; tax statement vs periodic statement for a distribution check) — and
explicitly states that empty arrays are the correct answer when no such holding exists,
rather than forcing an answer about a security the fund doesn't hold. `app.py`'s portfolio
variance check and `SecuritiesCard` (frontend) now iterate these arrays instead of reading
one hardcoded security.

**Backward compatibility:** the local error-path fallback
(`verify_and_generate_workpapers.get_fallback_audit_data`, used only when the live
OpenRouter call throws) still returns the old shape and wasn't rewritten (it's
hardcoded example data for a specific legacy test fund regardless, not a live path worth
the effort). `reconcile_papers` now normalizes both the legacy single-member object and the
legacy `mxt_reconciliation`/`distribution_check` shape into the new list-based shape right
after the LLM/fallback call returns, so every downstream consumer only ever handles one
shape. The frontend also tolerates a lone object for `member_reconciliation` defensively,
in case an already-cached job's `results` predates this change.

### 4. Truncation cap raised

`snippet = doc_text[:12000]` → `doc_text[:40000]` — a generous backstop rather than a
working limit, comfortably covering the largest real document seen in this fund's data
(~29,000 chars) while still bounding a pathologically large document.

## Verification

- `core_engine.py`/`app.py` compile clean; frontend `tsc --noEmit` clean.
- Cash override logic replayed against `job_20260705_165001`'s actual stored
  `reconciliation_results`: account `572080` (`tie_out: True`) correctly gets its
  deterministic opening/closing overlaid; accounts `682765`, `682773`, `90167750`
  (`tie_out: False`) correctly keep whatever the LLM's own answer was, proving the gate
  prevents the regression described above.
- Normalization logic and new frontend components verified to render without crashing
  against both the new (array) and legacy (single-object) result shapes.

Needs a fresh Phase-2 run of any affected job to populate the new fields end-to-end
(cached `jobs_db.json` results predate this schema and will render the "no data"/fallback
states in the frontend until then).
