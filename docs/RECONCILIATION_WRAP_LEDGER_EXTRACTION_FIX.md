# Wrap "Transaction Listing" Documents Destroyed by Holdings Compression

## Problem

While investigating why a $30,000 BT redemption evidence wasn't found in any supporting
document (`job_20260705_165001`, A H Smith Consulting Super Fund), all three files
classified under the "Wrap - Annual Transaction Listing and Portfolio Valuation Report"
category turned out to be reduced to almost nothing before reaching the reconciliation
prompt:

| File | Raw text | Sent to matcher |
|---|---|---|
| `...at 30.06.25.pdf` (portfolio performance) | 7,317 chars | 130 chars |
| `...at 30.06.25_1.pdf` (portfolio valuation) | 5,977 chars | 132 chars |
| `...at 30.06.25_2.pdf` (BT Panorama transaction history) | 29,065 chars | 132 chars |

The third file is a genuine 14-page annual transaction history — trade date, settlement
date, transaction type, and net amount for every distribution, dividend, fee, and
redemption the fund's BT Panorama wrap account had over the year. That's exactly the
evidence needed to match dozens of the fund's bank deposits/withdrawals. It was being
thrown away entirely.

## Root Cause

`build_reconciliation_prompt` (`core_engine.py`) decided how to compress a document by
its **classification category name**:

```python
if "Portfolio Valuation" in doc_category:
    doc_text = _extract_portfolio_holdings(doc_text, doc_name)
```

`_extract_portfolio_holdings` is a ticker-anchored parser designed to compact a *static
holdings snapshot* (ticker, description, units) into a short summary — appropriate when
the source is genuinely a holdings valuation, since a full securities table has no
date/amount matching value for bank reconciliation and can be long.

The category "Wrap - Annual Transaction Listing **and** Portfolio Valuation Report"
bundles two structurally different documents under one name, and the gate matched all of
them by category, not content. Worse, the compressor doesn't fail safely when applied to
the wrong shape: it false-matched `"SMSF"` (from the header line `"A H SMITH CONSULTING
SUPER FUND - SMSF"`) as a standalone ASX ticker code, treated the rest of the page as that
one bogus holding's description, and returned a single garbage line —
`"SMSF: BT Panorama Investments (120673371 units)"` — for what should have been a rich
transaction ledger. The compressor's own fallback ("if no real holdings found, return the
first 6,000 raw chars") never triggered, because it *did* find a "holding" — just the
wrong one.

## Fix

Replaced the category-name gate with a **content sniff**, since the category label and
the document's actual table structure are two different things and shouldn't be coupled:

- `_looks_like_transaction_history(text)` (`core_engine.py`): true if the text contains
  both `"trade date"` and `"net amount"` (the header phrasing seen here), OR — for
  platforms that word their headers differently — if it has **at least 3 distinct dates**
  among date-led lines. The distinct-date requirement matters: a holdings valuation
  snapshot's rows are *also* date-led (each row repeats the single "as at" valuation
  date), so a naive "5+ date-led lines" check false-positived on the genuine valuation
  file (10 rows, all dated `30 Jun 2025`). Requiring several *distinct* dates correctly
  separates a real dated ledger (this fund's transaction history has 48 distinct dates
  across the year) from a single-point-in-time snapshot.
- If it looks like a transaction history: run `_strip_repeated_boilerplate` instead of the
  holdings compressor — drops any line that repeats verbatim across the document after
  its first occurrence (page headers, footers, "Table continued from previous page" —
  these repeat identically on every page and carry no reconciliation value) but leaves
  every actual transaction line untouched. Real transaction rows, even similar ones,
  never repeat byte-for-byte, so this is a safe, generic transformation that needs no
  knowledge of the platform's specific layout.
- If it doesn't look like a transaction history and the category still says "Portfolio
  Valuation": fall back to the existing `_extract_portfolio_holdings` behavior, unchanged
  — a genuine static holdings snapshot still gets compacted, since it has no date/amount
  evidence value for bank-transaction matching and could otherwise bloat the prompt with
  a long securities table.

## Verification

Ran both extraction paths against this job's actual 3 wrap documents:

| File | Content sniff | Old output | New output |
|---|---|---|---|
| portfolio performance | not a ledger | 130 chars (garbage) | 130 chars (holdings path, unchanged) |
| portfolio valuation | not a ledger (10 rows, 1 distinct date) | 132 chars (garbage) | 132 chars (holdings path, unchanged) |
| BT Panorama transaction history | **is a ledger** (48 distinct dates) | 132 chars (garbage) | **19,974 chars**, every distribution/dividend/fee/redemption line intact |

The transaction-history file now reaches the reconciliation prompt at ~69% of its raw
size (boilerplate stripped, content preserved) instead of ~0.5%.

## Note

The two files still routed through `_extract_portfolio_holdings` are *also* apparently
mishandled by the same false-ticker-match failure mode (both produced ~130 char garbage,
not a real holdings summary) — this platform's "`Description · TICKER`" layout doesn't
match the standalone-ticker-per-line assumption the function seems tuned for (likely
against a different platform's layout, per the `_PV_NON_TICKER`/Ord Minnett references in
the code). That's a pre-existing, separate bug in the holdings-compression path itself —
out of scope here (today's fix was specifically about the transaction-listing case being
destroyed), but worth a look next time a fund's portfolio-valuation evidence needs to
show up in the audit checklist/lead schedules rather than just bank reconciliation.

Needs a fresh Phase-2 run of any affected job to take effect (extraction output isn't
cached).
