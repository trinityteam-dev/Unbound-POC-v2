# Phase 2 — LLM JSON Parsing Robustness

Status: Implemented
Date: 2026-06-30

## Problem

A Seyffer Super Phase-2 run crashed the whole job with:

```
ERROR: Expecting value: line 1 column 1 (char 0)
  File "app.py", line 260, in run_phase2_worker -> run_bank_reconciliation_phase
  File "core_engine.py", line 1370, in extract_transactions_from_statement -> _parse_via_llm
  File "core_engine.py", line 1326, in _parse_via_llm
    return json.loads(res)
json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
```

"char 0" means the LLM returned an **empty string** (or non-JSON) for the transaction
extraction of one bank statement. `_parse_via_llm` called `json.loads(res)` with no
guard, so the exception propagated up and **aborted the entire Phase-2 worker** — every
account, not just the one statement that failed.

## Root Cause

Several Phase-2 steps parsed LLM output with a bare `json.loads(res)`. LLM responses
are not guaranteed to be non-empty or fence-free (empty completion on a large/complex
statement, a `` ```json `` code fence, or prose around the JSON). Any one of these
raised `JSONDecodeError` and killed the phase. Additionally, the per-account extraction
loop had no isolation, so a single unparseable statement stopped reconciliation of all
other accounts.

## Fix

1. **Tolerant parser** — new `_lenient_json_loads(res, context)` in `core_engine.py`:
   returns `None` for empty/whitespace, strips ```` ```json ```` / ```` ``` ```` fences,
   and salvages the outermost `{...}` / `[...]` when the JSON is wrapped in prose. Never
   raises. Unit-tested against empty, whitespace, non-JSON, fenced, prose-wrapped and
   array inputs.

2. **Applied at every Phase-2 parse point** that previously used a bare `json.loads`:
   - `_parse_via_llm` (transaction extraction) → falls back to `{"transactions": []}`
   - `run_reconciliation_call` (reconciliation) → falls back to `{}`
   - `classify_transactions` (transaction categorisation) → `{}` (every tx then gets the
     fallback category, which the function already handles)
   - `run_query_generation_call` / `run_coarse_query_text_call` → `{}`
   (`reconcile_papers` at ~line 1123 was already inside a try/except with a fallback.)

3. **Per-account isolation** — the extraction loop in `run_reconciliation_call` now wraps
   `extract_transactions_from_statement` in try/except: a statement that fails to parse
   is logged and skipped (no transactions) instead of aborting the phase.

Net effect: a bad/empty LLM response degrades to "that statement has no extracted
transactions" (surfaced as unmatched/queries or a progress warning) rather than a hard
crash of the whole run.

Files: `core_engine.py` — `_lenient_json_loads` (new), `_parse_via_llm`,
`run_reconciliation_call`, `classify_transactions`, `run_query_generation_call`,
`run_coarse_query_text_call`.

## Follow-up (optional)

The empty response itself may indicate the extraction prompt hit a token/timeout limit
on a very large statement. If it recurs, consider chunking the statement text per page
before extraction, or a one-shot retry inside `_parse_via_llm` when the first response
is empty.
