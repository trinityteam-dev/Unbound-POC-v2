# Distribution Statement Classification Inconsistency Fix

## Problem

In the A H Smith Consulting Super Fund job (`job_20260704_191348`), five BT
Funds "Periodic Statement" documents — identical template, differing only by
underlying fund name and dollar figures — were classified inconsistently:

| File (fund) | Result | Confidence |
|---|---|---|
| BT International Fund | **Unclassified** | 65 |
| BT Australian Share Fund | **Unclassified** | 65 |
| BT Technology Fund | Distribution Statement | 75 |
| BT Smaller Companies Fund | Distribution Statement | 75 |
| BT Asian Share Fund | Distribution Statement | 75 |

Two of five effectively-identical documents were dropped to `Unclassified.pdf`
/ `Unclassified_1.pdf`, requiring manual reclassification.

## Root Cause

Not a code bug — the LLM's own `reasoning` field for the two rejected files
explicitly said:

> "Closest categories are 'Distribution Statement'... but rejected because this
> is a direct unlisted managed fund periodic statement, not a platform wrap
> report or a pure distribution notice."

That "must be a pure distribution notice" requirement doesn't exist anywhere
in the taxonomy — the model invented it. The `"Distribution Statement"` scope
text in `playbook_config.json` only said *"A managed fund/trust periodic
distribution statement for a direct holding"*, which never states whether a
periodic statement that **also** shows a full unit valuation, transaction
history, and fees still qualifies, or whether it must be a distribution-only
notice. With that boundary undefined, the model had to invent its own
criterion on every independent classification call — and, since each of the
five files is a separate API call with slightly different embedded text (fund
name, dollar amounts), it landed on opposite sides of its own invented
criterion for 2 of 5 calls. Confidence scores (65 vs 75, both mid-range) confirm
the model saw all five as borderline, not confidently sorted.

This is a taxonomy-ambiguity problem, not a randomness problem — tightening
the rule to remove the judgment call fixes it deterministically.

## Fix

Tightened the `"Distribution Statement"` scope text in three places to state
explicitly that a fund manager's own periodic statement qualifies regardless
of whether it also includes valuation/transaction detail.

### 1. `playbook_config.json` (authoritative taxonomy — both playbooks)

```
# Before
"Distribution Statement": "A managed fund/trust periodic distribution statement for a direct holding."

# After
"Distribution Statement": "ANY periodic statement issued directly by a managed fund/trust (not a wrap/platform) for a single fund holding - covers pure distribution/income notices AND a general 'Periodic Statement' that also shows unit valuation, transaction history and fees for that one fund. It does NOT need to be a distribution-only notice to qualify; do not reject this category just because the document also includes a valuation/transaction summary."
```

### 2. `core_engine.py` (live web-app prompt, `classify_papers` precedence rule 2)

Appended to the ISSUER ROUTING rule:

```
IMPORTANT — "Distribution Statement" scope: a managed fund/trust's own
"Periodic Statement" for ONE fund is "Distribution Statement" even when it
ALSO shows a unit valuation, transaction history and fees for that fund, as
long as the issuer is the fund manager itself (not a wrap/platform). Do NOT
reject "Distribution Statement" on the grounds that the document is a
"general periodic investor statement" rather than a pure distribution-only
notice — that distinction does not exist in this taxonomy; the same fund
manager's periodic statement template is Distribution Statement regardless of
which specific underlying fund it names.
```

### 3. `classify_workpapers.py` (standalone CLI — mirrors the above per its own
in-file note to keep the two prompts in sync)

Same sentence appended to its copy of precedence rule 2.

## Verification

Re-ran classification against the two previously-`Unclassified` files with the
updated prompt (same fund, same job context):

- `BTF_BT International Fund Periodic_Statement...pdf` → **Distribution
  Statement**, confidence 90 (was Unclassified, confidence 65)
- `BTF_ BT Australian Share Fund Periodic_Statement...pdf` → **Distribution
  Statement**, confidence 90 (was Unclassified, confidence 65)

Both now cite the new rule directly in their reasoning.

## Note

This closes the ambiguity for *this* category boundary only. Other category
definitions in `playbook_config.json` may have similar unstated edges that
surface as inconsistent classification on other document templates — the
general pattern (check the model's own `reasoning` for an invented
disqualifying criterion, then state explicitly that it doesn't apply) is
reusable when this recurs elsewhere.
