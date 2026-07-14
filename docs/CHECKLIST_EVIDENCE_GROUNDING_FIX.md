# Compliance Checklist — Evidence Grounding Fix

## Problem
The Phase-2 compliance checklist ("Document Audit Checklist Verification") reported
documents as **Verified** with no supporting file behind them, and applied `N/A` vs
`Missing` inconsistently.

Concrete example — Aashka Family Superannuation Fund, earliest run
(`job_20260706_093426`). The fund's workpapers contained only ATO ICA statements, a bank
statement, and two prior-year documents. There was **no** Trust Deed, ATO Trustee
Declaration, Investment Strategy, Death Benefit Nomination, or ASIC extract on file. Yet
the checklist showed:

| Item | Status | Files | Note |
|---|---|---|---|
| Trust Deed | Verified | *(none)* | "Assumed verified… no contrary evidence" |
| ATO Trustee Declaration | Verified | *(none)* | "Standard SMSF compliance assumed verified" |
| Investment Strategy | Verified | *(none)* | "Assumed on file" |
| Death Benefit Nominations | Verified | *(none)* | "Assumed compliant and on file" |
| ASIC Statement/Extract | Verified | *(none)* | "ABN confirmed…; ASIC extract assumed compliant" |

Every one is `Verified` with an empty `files` list and an *"assumed"* note — a false pass
that also suppressed the downstream exception log (`app.py` only raises an error note for
items whose status is `Missing`).

## Root Cause
Two compounding causes in `reconcile_papers()` (`core_engine.py`):

1. **The prompt permitted assumption-based verification.** The checklist schema offered
   `Verified | Missing | N/A` but never required a status to be backed by an actual
   document. For categories it couldn't match, the LLM defaulted to reassuring
   assumptions ("assumed on file", "assumed compliant").

2. **The deterministic post-processing only *promoted*, never *demoted*.** The file
   re-derivation loop matched filenames for exactly four categories — `Cash at Bank`,
   `Listed Securities & Portfolios`, `Current Tax Assets/Liabilities`, `Other Expenses` —
   and ended with:

   ```python
   # Auto-verify if files matches
   if details["files"]:
       details["status"] = "Verified"
   ```

   There was no branch to downgrade a `Verified`-with-no-files back to `Missing`, and
   `Permanent Documents`, `General Documents`, `Prior Year Documents`, `Accounting and
   Audit Reports`, and `Term Deposit` had **no matcher at all** — so their LLM-assigned
   statuses passed through completely ungrounded. "Verified with no evidence" was the
   structurally guaranteed outcome for any category lacking a filename matcher.

## Fix
`core_engine.py`, `reconcile_papers()`. Three coordinated changes:

1. **Added filename matchers for the ungrounded categories.** Workpaper files are named
   `"<classification category> - <sub_type>.pdf"`, so each unmatched checklist item is
   matched by the category string via a new `CHECKLIST_FILE_MATCHERS` map (Trust Deed,
   Change of Trustee, ATO Trustee Declaration, Investment Strategy, Death Benefit
   Nominations, ASIC Statement/Extract, Member Joined or Left, Prior Year, Term Deposit).
   This keeps genuinely-present documents correctly `Verified` and prevents the downgrade
   below from creating false negatives.

   ```python
   elif name in CHECKLIST_FILE_MATCHERS:
       needles = [n.lower() for n in CHECKLIST_FILE_MATCHERS[name]]
       details["files"] = [f for f in available_files if any(n in f.lower() for n in needles)]
   ```

2. **Enforced the evidence rule (the core fix).** After matching, an item the LLM marked
   `Verified` with an empty `files` list is downgraded to `Missing`; `N/A` is left
   untouched:

   ```python
   if details["files"]:
       details["status"] = "Verified"
   elif str(details.get("status", "")).strip().lower() == "verified":
       details["status"] = "Missing"
       details["notes"] = (
           "No supporting document found in the workpapers "
           "(auto-downgraded from an unverified 'Verified')."
       )
   ```

   "Verified ⇒ a file backs it" is now an invariant across *all* categories, not just the
   four with bespoke matchers. Items with no possible evidence source (e.g. Trustee
   Minutes) correctly resolve to `Missing`.

3. **Hardened the prompt.** Added an explicit checklist rule barring evidence-free
   verification: mark `Verified` only with a named supporting file; absent required docs
   are `Missing`, never "assumed on file"; `N/A` only for genuinely not-applicable items.

### Result (same job, simulated against the stored data)
- The five fabricated `Verified`s → `Missing`.
- `Prior Year Audit Reports / Financials` → `Verified`, now linked to the two real
  `Prior Year Documents - …` files (previously ungrounded).
- Event-driven items that were correctly `N/A` (Change of Trustee, EPoA, Member Joined or
  Left, Fund Wound Up, Term Deposit) → unchanged.

### Note / known consequence
Checklist items with no corresponding classification category and no possible evidence
source (e.g. `Trustee Minutes`, `Signed Financial Statements`, `Audit Engagement &
Representation Letters`, `Enduring Power of Attorney`) will now surface as `Missing` for
funds that don't supply them, rather than a false `Verified`. This is the intended, honest
behaviour — it correctly drives the reviewer's attention to genuinely-absent documents.
