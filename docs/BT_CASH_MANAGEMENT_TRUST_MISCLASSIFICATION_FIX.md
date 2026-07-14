# BT Cash Management Trust Misclassified as Bank Statement

## Problem

In A H Smith Consulting Super Fund (`job_20260706_141044`), the two BT Cash
Management Trust documents were merged and renamed
`Bank Statement - BT Cash Management Trust - 90167750.pdf`:

- `BTF_BT Cash Management Trust Tax_Statement_90167750_INVESTOR_1147323_10072025.pdf`
- `BTF_BT Cash management Trust Periodic_Statement_90167750_INVESTOR_1169928_11072025.pdf`

Both are actually a direct managed-fund holding (BT Cash Management Trust,
APIR `BTA0002AU`) — the header shows `Investor Number 90167750`, no BSB. They
use the exact same template as the fund's other direct BT holdings (Asian
Share Fund, International Fund, etc.), which were correctly classified as
`Distribution Statement` / `Annual Tax Statement`.

Meanwhile `BT Panorama Annual Transaction history 2024-25 (3).pdf` — which
carries genuine bank-account identifiers (`BSB 262786 Account number
120673371`, the wrap's internal "Cash Management Account") — was correctly
classified as `Wrap - Annual Transaction Listing and Portfolio Valuation
Report`, but was never picked up as a Phase-2 reconciliation account because
that account number wasn't configured anywhere.

## Root Cause

`funds_config.json` had the wrong number configured as the fund's bank
account:

```json
{ "bsb": "", "name": "BT Cash Management Trust", "number": "90167750" }
```

`90167750` is the *Investor Number* of the directly-held trust, not a bank
account/BSB pair. This single bad config entry corrupted two independent
pipelines:

### 1 — Classification override (the filename-fallback added in
[BANK_STATEMENT_CLASSIFICATION_FIX.md](BANK_STATEMENT_CLASSIFICATION_FIX.md))

`classify_papers()` seeds `bank_account_pages` from
`fund_profile["bank_accounts"]` (`core_engine.py:637-641`), so `90167750`
was treated as a known bank-account number. The `is_bank_statement` filename
fallback (`core_engine.py:745-749`, added by the fix above as defence #3)
then fires for *any* category containing the word "statement" — including
the correct `Distribution Statement` / `Annual Tax Statement` — whenever the
source filename contains a recognised account number. Both BT Cash
Management Trust filenames contain `90167750`, so both were forced through
the bank-statement split/merge path regardless of what the LLM actually
classified them as, and their correct category was discarded.

This is not a bug in that fallback itself — it correctly protects genuine
bank statements from LLM misclassification. It only misfires because the
*config* fed it a non-bank account number.

### 2 — Missing reconciliation account

`build_phase2_context()` only reconciles accounts listed in
`fund_profile["bank_accounts"]` (`core_engine.py:1389`). Since the real
transactional account (BSB `262-786` / account `120673371`) was never
configured, the BT Panorama Annual Transaction History was filed only as a
supporting document and never entered Phase-2 bank reconciliation as its own
account ledger, even though it has real BSB/account identifiers and a
"Cash Management Account" transaction ledger structurally identical to a
bank statement.

## Fix

Corrected `funds_config.json` for `a_h_smith_con_super_fund`: removed the
bogus Investor-Number entry and added the real wrap cash account, matching
the naming convention already used for other funds' wrap cash accounts
(e.g. Ghanshyam Super Fund's `Wrap Cash Account`):

```diff
       {
         "bsb": "032-051",
         "name": "Westpac Business One",
         "number": "682773"
       },
-      {
-        "bsb": "",
-        "name": "BT Cash Management Trust",
-        "number": "90167750"
-      }
+      {
+        "bsb": "262-786",
+        "name": "BT Panorama Cash Account",
+        "number": "120673371"
+      }
     ],
```

Phase 1 needs to be re-run for this fund so the Tax/Periodic Statement docs
re-classify to `Distribution Statement` / `Annual Tax Statement` (matching
their siblings) and the BT Panorama transaction history is picked up as a
reconciliation account (re-run not performed as part of this fix — pending
manual trigger).

## Related code

| File | Location | What it does |
|---|---|---|
| `funds_config.json` | `a_h_smith_con_super_fund.bank_accounts` | Fund's configured bank accounts (the bad data) |
| `core_engine.py` | `~line 637` | `bank_account_pages` seeded from `fund_profile["bank_accounts"]` |
| `core_engine.py` | `~line 745` | `is_bank_statement` filename fallback (see BANK_STATEMENT_CLASSIFICATION_FIX.md) |
| `core_engine.py` | `~line 1389` | `build_phase2_context` — only reconciles configured `bank_accounts` |
