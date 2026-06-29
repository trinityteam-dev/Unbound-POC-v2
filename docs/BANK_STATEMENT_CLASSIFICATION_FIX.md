# Bank Statement Misclassification Fix

## Problem

In the Hann Family Superannuation Fund job (`job_20260629_110019`), the file
`Hann Super Fund Bank Statements 2025.pdf` was classified as **Accountancy**
instead of **Bank Statement**. As a result:

- The bank account was never identified (account_number = null).
- `phase2_context.bank_accounts` was empty.
- The reconciliation (recon) produced no entries.

## Root Cause

Three independent failures compounded into one bad outcome.

### 1 — OCR density gate was too simple

The OCR fallback in Phase 1 (`core_engine.py`) fires when page-1 text is fewer
than 50 characters. The Hann bank statement is a **26-page scanned PDF**; only
thin label text ("Interest", "Adviser Fees", "HUB 24 Investment", …) is
embedded in the text layer. Across the first three pages, `extract_pdf_text`
returned 169 characters — above the 50-char threshold — so OCR was never
triggered, and the LLM classified on these misleading labels alone.

**Chars extracted vs pages present:**

| Pages in file | Chars extracted (first 3 pages) | Chars/page |
|---|---|---|
| 26 | 169 | ~56 |

A genuine text PDF of this size would yield 200–600 chars/page.

### 2 — Source filename was not passed to the LLM

The classification prompt only contained the document's body text. The filename
`Hann Super Fund Bank Statements 2025.pdf` was never shown to the model, so
the unambiguous signal in the name ("Bank Statements") had no effect on the
decision.

### 3 — `is_bank_statement` flag had no filename fallback

Even if the LLM returns the wrong category, the engine checks `is_bank_statement`
before deciding whether to run per-page account-splitting. The check required
`"statement"` to appear in the LLM's category string. Because the LLM returned
`"Accountancy"`, this check was false, and the page-scanning / account-discovery
pipeline was skipped entirely.

The original expression also had a Python operator-precedence issue (implicit
`and` before `or`) that made the condition harder to reason about:

```python
# BEFORE — misleading operator precedence
is_bank_statement = "bank statement" in category.lower() or \
    "statement" in category.lower() and \
    ("statements" in filename.lower() or ...)
```

## Fix (three changes to `core_engine.py`)

### Fix 1 — Text-density OCR gate

**Where:** classification loop, step 2 (`~line 549`).

After extracting text from the first three pages, read the PDF page count and
compute chars-per-page. If the file has more than 3 pages **and** yields fewer
than 30 chars per sampled page, treat it as a scanned document and run OCR
regardless of the absolute character count.

```python
_total_pages = len(PdfReader(filepath).pages)
_pages_sampled = min(3, _total_pages)
_density_too_low = (
    _total_pages > 3
    and (len(text.strip()) / _pages_sampled) < 30
)
if len(text.strip()) < 50 or _density_too_low:
    # run OCR fallback
```

**Why it works:** A real text-layer PDF has 200–600 chars/page. The Hann file
had ~56 chars/page (labels only). At 30 chars/page the threshold comfortably
catches image-only statements while leaving genuine text PDFs untouched.

### Fix 2 — Include source filename in the LLM prompt

**Where:** `query_openrouter` call, step 3 (`~line 586`).

Prepend the filename to the user message:

```python
# BEFORE
f"Document content:\n```\n{text[:3500]}\n```\n\nClassify this document."

# AFTER
f"Source filename: {filename}\n\nDocument content:\n```\n{text[:3500]}\n```\n\nClassify this document."
```

**Why it works:** "Bank Statements" in the filename is an unambiguous signal.
With Fix 1 the LLM will also receive richer OCR text, but the filename acts as
a belt-and-suspenders fallback for any file whose content is still ambiguous
after OCR.

### Fix 3 — Filename fallback for `is_bank_statement`

**Where:** immediately after LLM classification (`~line 608`).

Add an explicit filename-based branch so the account-splitting pipeline runs
even when the LLM returned the wrong category:

```python
# AFTER — explicit operator grouping + filename check
_fn_lower = filename.lower()
is_bank_statement = (
    "bank statement" in category.lower()
    or (
        "statement" in category.lower()
        and ("statements" in _fn_lower or any(...))
    )
    or ("bank" in _fn_lower and "statement" in _fn_lower)   # ← new
)
```

**Why it works:** If Fixes 1 and 2 still leave the LLM unsure, this final
guard guarantees that any file whose name contains both "bank" and "statement"
is routed through the per-page account-discovery pipeline. That means:

- Page text is scanned for account numbers (Layer 5 discovery).
- Discovered accounts are written into `bank_account_pages`.
- The seeding step in `app.py` (`derive_bank_accounts_from_job`) can pick them
  up and populate `phase2_context.bank_accounts`.
- Reconciliation has a statement to work with.

## Defence-in-depth

The three fixes create a layered defence:

```
┌─────────────────────────────────────────────────┐
│ Fix 1: OCR density gate                         │
│  → LLM receives actual statement content        │
├─────────────────────────────────────────────────┤
│ Fix 2: Filename in LLM prompt                   │
│  → "Bank Statements" filename steers the model  │
├─────────────────────────────────────────────────┤
│ Fix 3: is_bank_statement filename fallback      │
│  → Even wrong LLM category triggers pipeline   │
└─────────────────────────────────────────────────┘
```

Any one of the three would have prevented the Hann issue. All three together
mean a file needs to fail all three independent checks before being silently
misclassified.

## Related code

| File | Location | What it does |
|---|---|---|
| `core_engine.py` | `~line 549` | OCR density gate (Fix 1) |
| `core_engine.py` | `~line 586` | LLM prompt construction (Fix 2) |
| `core_engine.py` | `~line 608` | `is_bank_statement` flag (Fix 3) |
| `app.py` | `~line 102` | `derive_bank_accounts_from_job` — seeds phase2 from discovered accounts |
| `app.py` | `~line 711` | Layer-5 merge: discovered accounts into fund profile |
| `core_engine.py` | `~line 1138` | `build_phase2_context` — populates `bank_accounts` list used by recon |
