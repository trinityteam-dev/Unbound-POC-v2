# Wrap/Platform Ledger Transaction Description Concatenation

## Problem

In the A H Smith Consulting Super Fund reconciliation (`job_20260707_091443`,
account `120673371` — BT Panorama Cash Account), every transaction's
`description` field was the entire flattened table row instead of just the
description, e.g.:

```
"30 June 2025 29 July 2025 Cash Management Account ETL4846AU · Spire
Multifamily Growth and Income Fund (AUD) Hedged Class Distribution
43,121.005895 Spire Multifamily Growth and Income Fund (AUD (ETL4846AU) @
$0.006433 Income $277.40"
```

The genuine description is only:
`"Distribution 43,121.005895 Spire Multifamily Growth and Income Fund (AUD
(ETL4846AU) @ $0.006433"`. Everything else (trade date, settlement date,
investment type, security code/name, transaction type, amount) belongs to
other columns of the source table. Average description length for this
account was 177 chars (max 387) vs. 20-65 chars for every other fund's bank
account in `jobs_db.json` — this is specific to wide investment-platform
ledger tables, not ordinary bank statements.

## Root Cause

`BT Panorama Annual Transaction history 2024-25 (3).pdf` is a platform
transaction ledger with columns: Trade date | Settlement date | Investment
type | Security | Description | Transaction type | Units | Net amount. `pdftotext`/OCR
renders each row as one flattened line with all columns run together (see
the raw row in [BT_CASH_MANAGEMENT_TRUST_MISCLASSIFICATION_FIX.md](BT_CASH_MANAGEMENT_TRUST_MISCLASSIFICATION_FIX.md)'s
investigation).

`extract_transactions_from_statement()` → `_parse_via_llm()`
(`core_engine.py:1634`) parses every reconciliation-account statement with
one generic prompt written for ordinary bank narrative statements — it only
said `"description": "transaction description as written"`, with no
guidance on multi-column ledger tables. Since BT Panorama's account
(`120673371`) only entered `fund_profile["bank_accounts"]` as part of the
[prior fix](BT_CASH_MANAGEMENT_TRUST_MISCLASSIFICATION_FIX.md), this is the
first fund to route a wrap ledger document through the generic bank
extraction prompt, and the LLM took "as written" literally — copying the
whole visual line.

## Fix

Added an explicit rule to `_parse_via_llm`'s system prompt
(`core_engine.py:1636`) describing the platform-ledger row shape (using the
BT Panorama row above as a worked example) and requiring `description` to
contain only the genuine Description-column narrative — trade/settlement
date, investment type, security code, transaction-type label and amount must
never be prepended/appended. The full flattened line is still captured in
`raw_line` (already part of the schema, unused downstream) so no information
is lost — it's just not shown. The frontend only ever renders `description`
(`ReconciliationScreen.tsx:424`), so cleaning it at the extraction step is
sufficient; no frontend change needed.

This is a prompt-level fix keyed on content shape (multiple columns
flattened onto one line), not a fund-specific or category-specific special
case, so it protects any fund whose configured bank account is sourced from
a similar wide platform/wrap ledger, not just BT Panorama.

Not yet verified against a live re-run (pending manual trigger).

## Related code

| File | Location | What it does |
|---|---|---|
| `core_engine.py` | `~line 1634` | `_parse_via_llm` — transaction extraction prompt (the fix) |
| `core_engine.py` | `~line 2243` | `run_reconciliation_call` — calls extraction per configured bank account |
| `frontend/src/components/workspace/ReconciliationScreen.tsx` | `~line 424` | Renders `t.description` — no other field shown |
