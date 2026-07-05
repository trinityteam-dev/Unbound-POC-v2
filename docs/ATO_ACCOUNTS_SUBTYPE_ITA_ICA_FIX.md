# ATO Accounts Sub-Type Collision Fix (ITA vs ICA)

## Problem

In the latest A H Smith Consulting Super Fund run, both the fund's ATO Income
Tax document and its ATO Activity Statement document were filed under
near-identical names:

- `ATO Accounts - ATO integrated client account.pdf`
- `ATO Accounts - ATO integrated client account _ Activity Statement.pdf`

Both files landed under the same generic `sub_type` phrase ("ATO integrated
client account"), so an Income Tax Account document and an Activity Statement
(Integrated Client Account) document were indistinguishable by filename —
despite the ATO treating these as two separate ledger accounts (ITA and ICA)
that reconciliation needs to tell apart.

## Root Cause

The classification `system_prompt` in `core_engine.py` (mirrored in the
standalone `classify_workpapers.py` CLI) only gave the LLM one example
`sub_type` value for this category: `'ATO integrated client account'`. Nothing
in the prompt instructed the model to differentiate an Income Tax Account
statement from an Integrated Client Account / Activity Statement — so the
model reused the same example phrase (or a close variant) for both document
types, and the file-naming logic (`category - sub_type`) collapsed them into
near-duplicate names.

Notably, the Phase 2 checklist matcher (`core_engine.py:1190`) already
filtered available files by `"ICA" in f or "ITA" in f` — the code anticipated
these short tokens in filenames, but the classification prompt never actually
produced them.

## Fix

**Where:** `core_engine.py` (`~line 542`, `~line 554`) and
`classify_workpapers.py` (`~line 44`, `~line 84`).

Tightened the "NAMING TRAP" precedence rule and the `sub_type` field
description to require an exact, disambiguated token for ATO Accounts
documents instead of a free-text phrase:

```python
# BEFORE
"3. NAMING TRAP: ... only ATO-issued income-tax/integrated/activity/PAYG/GST documents => \"ATO Accounts\"."

# AFTER
"3. NAMING TRAP: ... only ATO-issued income-tax/integrated/activity/PAYG/GST documents => \"ATO Accounts\". "
"Within \"ATO Accounts\", the sub_type MUST be exactly \"ITA\" or \"ICA\" — never the generic phrase "
"\"ATO integrated client account\": an ATO Income Tax Account statement / notice of assessment / income tax "
"account document => sub_type \"ITA\"; an ATO Integrated Client Account statement or an Activity Statement "
"(BAS/IAS, GST/PAYG instalments or withholding) => sub_type \"ICA\"."
```

```python
# BEFORE
"sub_type": "... (e.g. 'Copy of share certificate', 'ATO integrated client account', 'Monthly Rental Statement', 'Audit fee invoice'), else null."

# AFTER
"sub_type": "... (e.g. 'Copy of share certificate', 'Monthly Rental Statement', 'Audit fee invoice'; "
"for 'ATO Accounts' use exactly 'ITA' for Income Tax Account documents or 'ICA' for Integrated Client "
"Account/Activity Statement documents), else null."
```

**Why it works:** the overall `category` stays `"ATO Accounts"` (unchanged,
per requirement), but the `sub_type` now forces a binary choice between two
short, unambiguous tokens instead of letting the model free-write a phrase
that happened to be identical for both document types. This also produces
filenames (`core_engine.py:466-467`, `category - sub_type`) of
`ATO Accounts - ITA.pdf` and `ATO Accounts - ICA.pdf`, which now match the
`"ICA" in f or "ITA" in f` filter already used by the Phase 2 checklist
(`core_engine.py:1190`).

## Related code

| File | Location | What it does |
|---|---|---|
| `core_engine.py` | `~line 542` | NAMING TRAP precedence rule (live app prompt) |
| `core_engine.py` | `~line 554` | `sub_type` JSON field description (live app prompt) |
| `classify_workpapers.py` | `~line 44` | NAMING TRAP precedence rule (standalone CLI, mirrors core_engine.py) |
| `classify_workpapers.py` | `~line 84` | `sub_type` JSON field description (standalone CLI) |
| `core_engine.py` | `~line 466` | Filename generation: `"{category} - {sub_type}.pdf"` |
| `core_engine.py` | `~line 1190` | Phase 2 checklist file matcher already expects `"ICA"`/`"ITA"` tokens |

## Note

This only affects future classification runs. The A H Smith Consulting Super
Fund job that surfaced this issue was classified before the fix and will need
to be re-run to pick up the corrected `ITA`/`ICA` sub-types.
