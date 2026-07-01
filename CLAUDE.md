# Project conventions

## Documenting bug fixes

Whenever you fix an issue in this codebase (bug, incorrect classification, threshold tuning, etc.), record it — don't just make the code change silently.

- **Trivial one-liner fix** (typo, obvious off-by-one, no real root cause to explain): add a short entry to `FINDINGS.md` — file:line, what was wrong, what changed.
- **Anything with a root cause worth remembering** (why a threshold was chosen, multiple compounding causes, a fix future-you might accidentally revert): create a new file at `docs/<AREA>_FIX.md` (or `_RCA.md` for root-cause investigations), following the existing pattern in `docs/BANK_STATEMENT_CLASSIFICATION_FIX.md`:

  ```markdown
  # <Short Title>

  ## Problem
  What broke, in which job/file, and the observable bad outcome. Include a concrete example.

  ## Root Cause
  Why it happened — numbered sub-causes if multiple factors compounded.

  ## Fix
  The actual code change(s), with before/after snippets and file:line references.
  ```

Do this automatically, without being asked each time.
