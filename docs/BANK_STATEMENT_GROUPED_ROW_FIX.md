# "Bank Statement (Grouped)" Row Removal

## Problem

After re-running Phase 1 for A H Smith Consulting Super Fund with a corrected
`funds_config.json` (see `docs/BANK_ACCOUNT_DISCOVERY_RCA.md`, 2026-07-05 entry),
the Workpapers review screen showed 5 extra rows under a category called
**"Bank Statement (Grouped)"**, all with the identical, non-clickable
`classified_name` "[Split and grouped by account]" — and account `90167750`
appeared twice among them. This read as broken/duplicated data, even though
every account number on those rows was actually correct.

## Root Cause

`classify_papers` ([core_engine.py](../core_engine.py), the bank-statement
splitting branch) appended one "Bank Statement (Grouped)" row to `job["files"]`
for **every original source file** identified as a bank statement — a
bookkeeping marker recorded the moment that one file's pages finished being
routed into their account bucket(s), *before* the later step that merges pages
across files into one PDF per account.

This produced two kinds of user confusion, neither of which was a data
problem:

1. **All 5 rows shared the identical placeholder `classified_name`**, so the
   Workpapers table couldn't visually distinguish them beyond small subtext —
   they looked like duplicate boilerplate rather than 5 distinct per-source
   markers.
2. **`90167750` legitimately appears twice** because two different original
   documents (a Tax Statement and a Periodic Statement) both belong to that
   one real account — correct, but with no annotation explaining why, it read
   as a duplicate bug.

The row also carried no downstream value: `api_processor_review`
([app.py:715](../app.py)) already explicitly skips any file whose
`classified_name` is the literal `"[Split and grouped by account]"` marker
when building the approved workpaper set, so these rows were **always**
dropped at sign-off and never reached Phase 2. Everything they conveyed
(which source files fed which account) is already present, more usefully, in
the *reasoning* field of the final merged `Bank Statement - <account> -
<name>.pdf` row (e.g. "Merged pages from: fileA.pdf (pages 1-4), fileB.pdf
(pages 1-6)").

## Fix

Removed the `processed_files.append(...)` call that created these rows
([core_engine.py:754-764](../core_engine.py) prior to this fix). The page
account-scope analysis, grouping, and final cross-file merge are unchanged —
only the intermediate per-source-file audit row is no longer added to
`job["files"]`. The `update_progress` log line for this step (visible in the
job's live progress log) is kept, so the processing step is still traceable
there if needed.

```python
# Before: appended one "Bank Statement (Grouped)" row per source file
processed_files.append({
    "original_name": filename,
    "classified_name": "[Split and grouped by account]",
    "category": "Bank Statement (Grouped)",
    ...
})

# After: no row appended — the merged per-account file's own `reasoning`
# already records which source files/pages fed it.
```

## Verification

Re-ran `classify_papers` directly against A H Smith Consulting Super Fund's
document folder with the corrected `funds_config.json`:

- **Before:** 25 processed files, 5 of them "Bank Statement (Grouped)".
- **After:** 20 processed files, 0 "Bank Statement (Grouped)" rows. The 4 real
  merged accounts (`572080`, `682765`, `682773`, `90167750`) are unchanged and
  correctly tagged.

## Note

This is a display-layer cleanup only — it does not touch account-number
correctness (that was fixed separately in `funds_config.json`; see
`docs/BANK_ACCOUNT_DISCOVERY_RCA.md`) or Phase-2 reconciliation math, both of
which were already unaffected by these rows.
