# Reconciliation "Hang" on GLM-5.2 — RCA + Fix

## Problem

Phase 2 (bank reconciliation) jobs appeared to hang indefinitely at
`processing_review` when run with model `z-ai/glm-5.2`, requiring the backend
process to be killed to recover. The same fund, same documents, run with
`x-ai/grok-4.20` completed normally. Two live incidents, both A H Smith
Consulting Super Fund, both GLM-5.2:

- `job_20260705_152140` — stuck after the "12 interest transaction(s) marked
  as needing no external evidence" log line, 20+ minutes, no further progress.
  Process killed manually (`kill -TERM`, pid 3095). This incident was already
  diagnosed (generically, as a missing-timeout gap) in
  `docs/SESSION_HANDOFF.md` under "Reconciliation hardening".
- `job_20260705_160223` — stuck at "Phase 2: Reconciling transactions against
  supporting documents..." for 15+ minutes while being live-investigated (see
  below). This one actually completed at the 15m26s mark, which is what made
  the root cause diagnosable from real data instead of a killed process.

Initial hypothesis (from the user): GLM-5.2's context window (1M tokens) vs.
Grok-4.20's (2M tokens) — the working theory was that the reconciliation
prompt was pushing GLM close to a context ceiling and something ugly was
happening as a result.

## Investigation

1. Confirmed the "hang" is a real, live network wait, not a crash: `lsof -p
   <pid>` showed a single ESTABLISHED outbound HTTPS connection with the
   process at ~0% CPU — same signature as the previously-killed incident.
2. Measured the actual reconciliation prompt for the stuck job by loading its
   stored `phase2_context` from `jobs_db.json` and running the same
   `_extract_supporting_doc_text` extraction the pipeline uses, offline,
   against all 16 supporting documents (4 bank accounts): **~216KB of text,
   ~54K estimated tokens**, all born-digital (no OCR fallback needed for this
   job). Confirmed against the recorded `token_usage` from the earlier
   successful Grok run of the same fund: `phase2_reconcile` prompt_tokens =
   **61,310**.
3. **This rules out the context-window theory.** ~61-66K tokens is ~6% of
   GLM-5.2's 1M window and ~3% of Grok-4.20's 2M window — nowhere near either
   ceiling. It also doesn't explain incident #1, which hung at a *much*
   smaller downstream call (a few thousand tokens), not the big reconciliation
   call.
4. The actual smoking gun, once job `160223` finished and its `token_usage`
   was readable, was **completion length**, not prompt length:

   | call | model | prompt_tokens | completion_tokens | wall time |
   |---|---|---|---|---|
   | `phase2_reconcile` | grok-4.20 (job 155851) | 61,310 | 8,515 | 36s |
   | `phase2_reconcile` | glm-5.2 (job 160223) | 65,989 | **65,536** | 15m 26s |

   `65,536 = 2^16` — landing exactly on a power-of-2 is a strong signal this
   is a max-output-token ceiling (provider- or model-side default), not a
   naturally-terminated response. `query_openrouter` (`core_engine.py:242`,
   pre-fix) never set `max_tokens` in the request payload, so whatever
   default GLM-5.2/its OpenRouter route uses took over. GLM produced ~8x more
   completion tokens than Grok for the *identical* matching task (per-fund,
   per-document, same transactions) and streamed them far slower — 15m26s vs
   36s is a ~25x wall-clock difference for a task that isn't 25x more prompt
   work.
5. Root cause is therefore: **GLM-5.2 is dramatically more verbose and slower
   at generating output for this specific structured-matching task than
   Grok-4.20**, most likely hitting (or nearly hitting) a max-completion-token
   default. This is compounded by a pre-existing gap already flagged in
   `docs/SESSION_HANDOFF.md`: `requests`' `timeout=` parameter bounds
   time-between-received-chunks, not total request duration, so a slow
   trickle of tokens (exactly what a 65K-token completion looks like) never
   trips it — the call just sits there indefinitely from the caller's
   perspective, indistinguishable from a true hang, with no visibility and no
   automatic recovery.
6. A secondary, previously-unnoticed risk surfaced by this: the pre-fix code
   never checked `finish_reason` on the response. If a completion is actually
   truncated mid-JSON (as opposed to happening to complete right at the
   token cap, which is what occurred in job `160223`), `_lenient_json_loads`
   would attempt to parse broken JSON with no signal that truncation, not a
   parse quirk, was the cause — a real silent-data-loss risk on any fund with
   more transactions/documents than this one.

## Fix (implemented — Layer 1 of 3 proposed; see "Deferred" below)

`query_openrouter` (`core_engine.py:242`) now:

- Runs the `requests.post` call on a background thread and joins it with a
  **wall-clock deadline** (`wall_clock_timeout`, default `max(timeout * 5,
  600)` seconds — generous enough not to abort a legitimately slow-but-working
  call like the 15m26s GLM run above, but bounded so a truly stuck call fails
  in finite time instead of hanging indefinitely). On timeout, raises
  `TimeoutError` and abandons the thread (it keeps running in the background
  until its own per-chunk `timeout` trips, but the caller gets control back
  immediately).
- Checks `choices[0]["finish_reason"]` and raises `ValueError` if it's
  `"length"` (truncated), instead of handing a possibly-corrupt partial JSON
  string to the caller.
- Both new failure modes flow through the existing exception handling (grok
  → gemini-2.5-flash fallback if the model was grok; re-raise otherwise), so
  for GLM/other non-default models the exception now propagates up to the
  Phase-2 job worker's top-level `try/except` (`app.py:362`), which will mark
  the job `failed` with a clear message instead of leaving it silently stuck
  at some `%` forever.

Verified with mocked `requests.post` (fast/normal, truncated-with-`length`,
and slow-past-deadline cases) — see session transcript; all three behave as
intended and the change is a pure safety net (no prompt, schema, or matching
logic touched).

## Deferred (not implemented this session — by explicit user decision)

Two further layers were proposed and scoped but deliberately **not**
implemented now, to keep this change minimal:

1. **Shrink the reconciliation completion schema.** The matcher's response
   currently echoes `date/description/debit/credit/type` per transaction even
   though `run_reconciliation_call` (`core_engine.py:2069-2085`) already
   overlays its own authoritative extracted values over whatever the matcher
   returns for those fields (the matcher was never trusted to reproduce them
   accurately). Trimming the required response to just the decision fields
   (`status, match_type, matched_document, matched_amount, match_group,
   unmatched_reason`, keyed by transaction index) should cut completion size
   substantially for every model, GLM included, without losing or changing
   any matching decision — those echoed fields are discarded today regardless.
2. **Split the single all-accounts reconciliation call into sequential
   per-account calls with a carried-forward evidence ledger.** The single
   call's completion size is roughly proportional to total transactions
   across *all* accounts (4, for this fund) in one shot; per-account calls
   would divide that by the account count. The subtlety: the recurring-amount
   double-count guard (`docs/RECONCILIATION_NARRATIVE_AMOUNT_MATCH_FIX.md`) —
   "a document may satisfy at most one transaction total" — currently works
   because the whole prompt shares one context. Splitting naively into
   independent per-account calls would let two different accounts each
   independently claim the same document, double-counting evidence. The safe
   version runs the per-account calls **sequentially**, carrying forward a
   "documents/amounts already claimed" ledger from each completed account into
   the next account's prompt, preserving the current guarantee explicitly
   instead of implicitly.

If GLM-5.2 hangs/times-out recur after this fix (i.e., jobs now fail fast
instead of hanging, but still fail on this model), the next step is
implementing #1 and #2 above, followed by re-running this same A H Smith GLM
job and diffing the reconciliation output against the Grok baseline (job
`job_20260705_155851`) to confirm no regression in matched/unmatched counts or
match_groups before trusting the change for anything client-facing.
