# Session Handoff

Living continuity doc across sessions. See `CLAUDE.md` → "Session handoff protocol" for
the write rules (index + per-workstream sections; append dated updates, never rewrite a
section wholesale; only condense a workstream once its detail lives in its own
`docs/<AREA>_FIX.md`/`_RCA.md`).

## Index

| Workstream | Status | Last updated |
|---|---|---|
| [Classification playbook](#classification-playbook) | Done — deferred decisions open | 2026-07-02 |
| [Reconciliation hardening](#reconciliation-hardening) | In progress — Step 2 (OCR engine swap) + Phase-2 hang-hardening open | 2026-07-05 |
| [Bank account discovery & statement splitting](#bank-account-discovery--statement-splitting) | In progress — one fund fixed, backstop deferred | 2026-07-05 |
| [Cross-cutting](#cross-cutting) | — | 2026-07-02 |

---

## Classification playbook

**Status:** Done — replaced keyword-based classification with a purpose/issuer
"playbook" over a rolled-up SMSF taxonomy. A few sub-decisions remain deferred (below).

**Final taxonomy (parent categories; sub-types roll up to the parent).** `Accounting_Audit`:
Trust Deed · Change of trustee document · ATO Trustee Declaration · Investment Strategy ·
ASIC Statement/Extract · Death Benefit Nomination · Member Joined or Left during the year ·
Prior Year Documents · Bank & Term Deposits · Wrap - Annual Transaction Listing and
Portfolio Valuation Report · Wrap - Annual Tax Statement Report · Wrap - Type 2 Audit
Report · Broker - Transaction Listing and Portfolio Valuation Report · HIN Holding
Statement · Trade Contract · Chess Holding · Dividend Statement · Distribution Statement ·
Annual Tax Statement · Derivatives · Unlisted Trust or Company · Investment in Real
Property · LRBA · Loan Given by the SMSF · Gold/Silver bullion · ATO Accounts ·
Contribution · Benefit paid/transferred · Other Expenses.
`Accounting` = the non-audit/non-governance subset (21). `Unclassified` is the fallback
(honoured by the prompt, not stored in the config).

**How it works:** the prompt (`core_engine.classify_papers`, ~line 520) injects global
precedence rules + `{categories_description}` rendered from `playbook_config.json`, and
returns JSON: `category, sub_type, account_number, amount, date, member_name, reasoning`.

**Locked precedence rules / decisions (in the prompt + config + CLI mirror):**
1. **Prior-Year override** — finalised/signed prior-year deliverables or content relating
   ONLY to a pre-audit year → `Prior Year Documents`. **Exception:** live ATO/registry/
   super account snapshots that merely show prior-year data → classify by type
   (→ `ATO Accounts`). Future-year docs → by type.
2. **Issuer routing** — wrap/platform/**private-bank** issued → a `Wrap -` category
   (platform list is **non-exhaustive**, explicitly incl. Macquarie **Private Bank**;
   a consolidated portfolio valuation + cash ledger → `Wrap - Annual Transaction Listing
   and Portfolio Valuation Report`); broker consolidated → `Broker - ...`; single-holding
   → the specific direct category.
3. **Naming trap** — an accountant's "Activity Statement"/"Statement of Account" is NOT an
   ATO doc → `Other Expenses`; only ATO-issued → `ATO Accounts`.
4. **Contributions vs ATO Accounts** — decide by **headline subject/title**: a TSB
   statement → `ATO Accounts` (even though it mentions contribution caps); a
   concessional/non-concessional **contributions** screen → `Contribution` (even though it
   shows TSB); on doubt the title/filename wins.
5. **Insurance** — member life/TPD/IP premium → `Benefit paid/transferred`; property
   insurance → `Investment in Real Property`.
6. **Lender vs borrower** — fund borrows → `LRBA`; fund lends → `Loan Given by the SMSF`.

**Extraction fields by category:** `account_number` (Bank & Term Deposits), `amount`
(Other Expenses / Contribution / Benefit paid/transferred), `date` (Wrap/Broker valuation
reports, Annual Tax Statement), `member_name` (Contribution / Benefit / ATO TSB-TBC),
`sub_type` (any rolled-up parent).

**Other fixes shipped:** downstream decoupled from category names (bank-statement gate,
`determine_target_filename`, reconciliation file-matcher, fallback keyword classifier);
`sub_type`/`member_name` persisted through Phase-1 AND the approval step
(`app.py:api_processor_review`, with hydration from the Phase-1 record); content-hash
de-dup in `classify_papers` (SHA-256 of extracted text skips redundant LLM calls); Phase-1
classify JSON parsed via `_lenient_json_loads`.

**Deferred decisions (still open):**
- ASIC annual-review fee invoice currently → `Other Expenses` (could be its own category).
- Client working-paper/"PBC" schedules → `Unclassified` (no working-papers category yet).
- Fee rebates → `Other Expenses`.
- Optional: eval pass on classification accuracy across sample funds (Seyffer, Hann,
  ADMCM, Rigney) using the confidence field already in the prompt.

**Detailed docs:** `docs/CLASSIFICATION_PLAYBOOK_REFACTOR.md` (full refactor story +
post-fixes: contribution/TSB, wrap wording, de-dup).

---

## Reconciliation hardening

**Status:** In progress. Hardening is done through **Step 1 (audit safety net)**.
**Step 2 (table-aware OCR engine swap) is the open next task.**

**Chronology of fixes shipped (each has its own doc):**
1. **Narrative + amount matching + sum tie-out**
   (`docs/RECONCILIATION_NARRATIVE_AMOUNT_MATCH_FIX.md`) — matcher must corroborate BOTH
   narrative and amount; many similar-narrative txns may match a document total via sum;
   else unmatched. Deterministic `verify_sum_matches` downgrades matches that don't add up.
2. **Document-grounded verification** — tie-out was initially circular (validated against
   the LLM's self-reported `matched_amount`, which just echoes the txn amount). Fixed to
   validate against the actual supporting-document text (`_build_doc_amount_index`,
   `_amount_in_doc`).
3. **Bank-to-bank transfer linking** (`detect_internal_transfers`) — pairs legs across
   accounts (equal amount, opposite direction, transfer keyword, nearest-date). Sets
   `is_internal_transfer` + `internal_transfer_ref {account_number, index}`. Frontend shows
   a **BANK TRANSFER** badge + "view matching line" that jumps to the counter-leg.
4. **No-evidence** (`mark_no_evidence_transactions`) — bank interest credits →
   `match_type: no_evidence_required` (matched, no doc, no query).
5. **Opening balance** — "Brought forward" rows flagged `is_opening_balance`, excluded from
   matcher/counts/display, used as the balance anchor.
6. **Phase-2 JSON robustness** (`docs/PHASE2_LLM_JSON_ROBUSTNESS_FIX.md`) —
   `_lenient_json_loads` at every Phase-2 parse point; per-account extraction wrapped so
   one bad statement can't abort the phase.
7. **OCR RCA + audit safety net — Step 1**
   (`docs/RECONCILIATION_STATEMENT_OCR_AMOUNT_RCA.md`) — current end state, detailed below.

**Step 1 audit safety net (current recon behaviour):** root cause found — tesseract drops
~half the amount column on the NAB scan; the extraction LLM then **hallucinates** amounts
(e.g. `27,000` that appears nowhere in the OCR). So:
- **Control totals** parsed from the summary box (`_parse_statement_controls`,
  `_find_control`): opening, closing, total credits, total debits.
- **Amount resolution** (`_resolve_statement_amounts`): an LLM amount is trusted only if it
  (a) appears verbatim in the statement text (`_amount_in_text`) OR (b) equals the running
  balance movement. Uncorroborated → rejected → balance-delta if available else
  **`unresolved`** (never a fabricated number). Per-row `amount_status`:
  `ocr_confirmed | balance_confirmed | balance_derived | unresolved`.
- **Statement tie-out** (`_compute_statement_reconciliation`): `opening + credits − debits
  == closing` and zero unresolved ⇒ `reconciled`, else `needs_review` with `gap` +
  `unresolved_count`. Fail-safe: flags for review instead of emitting fabricated matches.
- **Unresolved ⇒ unmatched** with a "verify from source statement" reason
  (in `run_bank_reconciliation_phase`).
- **Statement OCR upgrade (scoped):** statements OCR at **300 DPI + default PSM 3** +
  dot-leader cleanup (`STATEMENT_OCR_DPI=300`, `STATEMENT_OCR_PSM=None`,
  `_clean_statement_text`). NOTE: PSM 6 was tried and **reverted** — an A/B showed it drops
  the dot-leader amount lines (7 vs 15 amounts); 300 DPI + default PSM 3 is the chosen
  config. General/classification OCR unchanged (150 DPI, auto PSM). The extraction prompt
  also **re-allows** the LLM to derive `amount = balance movement` when the amount column
  isn't legible (validated by the tie-out). See `RECONCILIATION_STATEMENT_OCR_AMOUNT_RCA.md`
  "Update 2".

**Phase-2 orchestration order** (`run_bank_reconciliation_phase`): `run_reconciliation_call`
(extract → matcher → **authoritative amount overlay** + attach controls/tie-out) →
**(0a) flag unresolved → unmatched** → **(0b) mark_no_evidence** →
**(1) detect_internal_transfers** → **(2) verify_sum_matches (doc-grounded)** → count
(skip opening rows) → build queries from unmatched.

**New backend symbols (all in `core_engine.py`):** `_lenient_json_loads`,
`STATEMENT_OCR_DPI/PSM`, `_clean_statement_text`, `_is_opening_balance_row`,
`_find_control`, `_parse_statement_controls`, `_amount_in_text`,
`_resolve_statement_amounts`, `_compute_statement_reconciliation`,
`_recon_parse_amount/_recon_txn_amount/_recon_parse_date/_recon_mark_unmatched`,
`_extract_amounts_from_text`, `_amount_in_doc`, `_build_doc_amount_index`,
`_recon_mark_internal_transfer`, `detect_internal_transfers`,
`mark_no_evidence_transactions`, `verify_sum_matches` (doc-grounded),
`extract_transactions_from_statement(..., controls_out=)`. `ocr_pdf_single_page/first_page`
gained `dpi`/`psm` params.

**New data fields on `reconciliation_results[acct]`:** per-txn: `amount_status`,
`is_opening_balance`, `is_internal_transfer`, `internal_transfer_ref`, `match_type`,
`matched_amount`, `no_evidence_reason`. Per-account: `controls` {opening, closing,
total_credits, total_debits}, `reconciliation` {status, tie_out, gap, unresolved_count,
computed_credits, computed_debits, opening, closing, stated_total_credits,
stated_total_debits}.

**Frontend:** `api/types.ts` — `ReconTxn` gained `match_type, matched_amount, match_group,
is_internal_transfer, internal_transfer_ref, is_opening_balance, amount_status,
no_evidence_reason`; `ReconAccount` gained `controls`, `reconciliation`
(`ReconStatementControls`, `ReconStatementTieOut`). `ReconciliationScreen.tsx` — per-account
**tie-out badge** (reconciled vs "does not tie out — gap $X, N unresolved"); unresolved
amount → **"— not read"** (tooltip reason); derived amount → **"≈ derived"**; BANK TRANSFER
badge + counter-leg line-jump (`jumpToLine` + row `id="txn-row-<i>"` + highlight); interest
→ "no external evidence required" note.

### OPEN NEXT TASK — Step 2: better OCR for statements

**Why:** empirically on the NAB statement
(`data/Seyffer Super/NAB Statements Acc#0672...pdf`): tesseract at 150 DPI captured only
~9 numbers for ~55 txns; at 300 DPI + PSM 6 across all pages ~57 numbers where ~110 are
needed — it loses ~half the amount column. The `27,000`/`23,900` in the data were **LLM
hallucinations** (absent from OCR). Step 1 makes this *safe* (rejects fabrications, flags
`needs_review`), but the unresolved count stays high until OCR improves.

**External recommendation (via user, ChatGPT):** don't use tesseract for financial
tables. Preferred stack: **PaddleOCR** (table-aware, numeric accuracy, bounding boxes,
structured JSON, ignores handwriting) — optionally with **Docling** (layout+table→
Markdown/JSON) and/or **Marker**; TrOCR as a weaker alt. Critically: "the important part
isn't OCR, it's validating numbers: New Balance = Old + Credits − Debits, flag rows that
don't balance to the cent." (That validation is exactly Step 1, already shipped.)

**Assessment:**
- Agree tesseract is wrong here; table-aware OCR is the fix; validation-first is right
  (already done).
- Temper "99%+" as a claim to **measure** on these faint/skewed pages, not assume.
  Docling/Marker sit *on top of* an OCR engine — for an image-only PDF it's OCR every page
  (their value is layout/tables). All are heavy ML deps (Torch/Paddle, big model
  downloads, macOS wheel friction, slower); OCR here also feeds classification, so a swap
  needs a classification re-check.
- Best structural win: a table-structure engine (PaddleOCR **PP-Structure** / Docling)
  returns cells → feed rows **directly** and **drop the LLM extractor for statements** →
  eliminates the hallucination surface entirely.

**Recommended plan (timeboxed spike, statements only):**
1. Keep Step 1 as the guarantee (engine-agnostic).
2. Spike **PaddleOCR PP-Structure locally** (local = right for SMSF client privacy) behind
   the existing `ocr_pdf_single_page` seam, scoped to statement extraction.
3. Measure amount+balance capture on the NAB PDF against known values
   (**15,000 · 1,664.84 · 25,000 · 81,500 · 11,409.95 · 20,056.52**) and verify per-row
   `new_balance = old_balance ± amount`.
4. If it reads both amount and balance columns reliably → feed rows directly, bypass the
   LLM extractor for statements. If install/accuracy disappoints in the timebox → ship
   Step 1 as-is; defer engine swap. No POC risk either way.
5. Docling is worth it for the broader ingestion pipeline later; for closing the POC,
   PP-Structure directly is fewer moving parts.
- **Constraint:** ~2-day POC deadline (as of 2026-07-02). Don't attempt the full
  Docling→Paddle→Marker pipeline under deadline; timebox the spike.

**Concrete integration seam:** `core_engine.ocr_pdf_single_page(filepath, page_idx,
scratch_dir, dpi=, psm=)` is the one place statement OCR happens (called from
`extract_transactions_from_statement`). Add an engine selector (tesseract | paddle) here;
for statements prefer paddle. If using PP-Structure's table output, add a
statement-specific extractor that emits `{date, description, debit, credit, balance}` rows
directly and skips `_parse_via_llm`.

**Reconciliation-specific run/verify notes:**
- LLM/OCR output is NOT cached across runs — behaviour changes to prompts/OCR only take
  effect on a **fresh Phase-2 run** (re-run the job).
- Latest Seyffer job used for investigation: `job_20260702_111309` (2 accounts: NAB
  `199860672`, Macquarie `965684806`). Latest Hann job: `job_20260702_...`.

**Gotchas:**
- `jobs_db.json` was hand-mutated for live UI demos (transfer linking, no-evidence
  marking, Step-1 resolution applied to `job_20260702_111309` and `job_20260701_230857`)
  using the real deterministic functions (no LLM). A fresh Phase-2 run regenerates
  everything. A pre-demo backup existed in a session scratchpad (`jobs_db.backup.json`)
  but predates `job_20260702_001644` — don't blindly restore, it'd lose newer real runs.
  Treat `jobs_db.json` as disposable runtime state.
- React-query cache: the SPA may serve a stale job-details cache; hand-editing
  `jobs_db.json` mid-session won't always reflect without a hard reload / cache clear. On a
  real run this is a non-issue.
- Multi-period statements: the Macquarie file concatenates several monthly statements, so
  a single opening→closing tie-out won't balance → flags `needs_review` (conservative/
  safe). A per-period tie-out is the better long-term model (future work).
- Derived amounts on a non-tying statement are provisional — the `needs_review` badge
  signals not to trust them without manual check.

**Next steps for this workstream (priority order):**
1. Step 2 spike: PaddleOCR PP-Structure on the NAB statement (per plan above); measure
   against the known amounts + per-row balance check; decide whether to feed rows
   directly.
2. If Step 2 lands: bypass `_parse_via_llm` for statements; re-run a Seyffer job; confirm
   the tie-out now reports `reconciled` (or far fewer unresolved).
3. Revisit per-period tie-out for multi-statement files.

**Detailed docs:** `docs/RECONCILIATION_NARRATIVE_AMOUNT_MATCH_FIX.md`,
`docs/RECONCILIATION_STATEMENT_OCR_AMOUNT_RCA.md` (most relevant for continuing),
`docs/PHASE2_LLM_JSON_ROBUSTNESS_FIX.md`.

### Update 2026-07-05 — observed hang, fix deferred (not yet applied)

**Incident:** `job_20260705_152140` (A H Smith Consulting Super Fund, model
`z-ai/glm-5.2`) hung for 20+ minutes at `processing_review`/70%, silent since
the `"12 interest transaction(s) marked as needing no external evidence."` log
line. Diagnosed live: the stuck process (pid 3095) was near-0% CPU with one
open outbound HTTPS connection (consistent with an in-flight OpenRouter call),
not crashed — `run_phase2_worker`'s top-level `try/except` ([app.py:362](../app.py))
never fired, so no exception had occurred; the call was still genuinely
waiting on the network. Stopped by killing the process (`kill -TERM 3095`) —
no code fix applied yet, root cause diagnosed only.

**Root cause (two compounding gaps, both still open):**
1. **No true wall-clock cap on Phase-2 LLM calls.** `classify_transactions()`
   ([core_engine.py:2824](../core_engine.py)) calls `query_openrouter(...,
   timeout=120)`, but `requests`' `timeout=` is a **per-chunk read timeout**,
   not a hard cap on total request duration — a response that keeps trickling
   bytes slowly can run far longer than 120s without ever tripping it. Same
   risk applies to every other `query_openrouter` call site with a bare
   float timeout (`run_coarse_query_text_call` at 180s, `run_reconciliation_call`
   at 240s, etc.) — none of them enforce an actual wall-clock deadline.
2. **No progress-log heartbeat around `classify_transactions` /
   `_build_queries_from_classified`.** There's no `update_progress` call
   immediately before or during this step, so a hang here is silent in the
   job log/UI — indistinguishable from "still working" until someone notices
   the timestamp gap and investigates manually (as happened here).

**Fix to apply later (not yet implemented):**
- Wrap the `requests.post` call inside `query_openrouter` ([core_engine.py:242](../core_engine.py))
  with an actual wall-clock deadline (e.g. a watchdog thread/`signal.alarm`,
  or track `time.monotonic()` and abort/retry past a hard ceiling) so a
  slow-trickle response can't hang indefinitely — this is the same class of
  gotcha called out for `requests`/`httpx` polling loops in the
  `claude-api` skill reference.
- Add an `update_progress(None, f"Phase 2: classifying {len(unmatched_transactions)}
  unmatched transactions...")` call right before `classify_transactions()` in
  `run_bank_reconciliation_phase` ([core_engine.py:3075](../core_engine.py)),
  and a similar one before `run_coarse_query_text_call`, so
  the job doesn't look silently frozen.
- Consider whether a job stuck past some threshold (e.g. 2× the sum of its
  step timeouts) should auto-transition to `failed` with a clear "timed out"
  message rather than sitting at whatever `%` it last reported.

### Update 2026-07-05 (later) — root cause found; wall-clock/truncation fix shipped

**Root cause identified** (full writeup: `docs/RECONCILIATION_GLM_HANG_RCA.md`).
User's initial theory was GLM-5.2's smaller context window (1M vs Grok's 2M)
vs. the large reconciliation prompt (~61-66K tokens for this fund) — **ruled
out**: that prompt is only ~6% of GLM's window, nowhere near either model's
ceiling, and doesn't explain the first incident hanging at a much smaller
downstream call. Actual cause: GLM-5.2's `phase2_reconcile` completion hit
**65,536 tokens (2^16)** vs Grok's 8,515 for the identical matching task on
the identical data — ~8x more output, landing suspiciously exactly on a
power-of-2 (a max-output-token default; `query_openrouter` never set
`max_tokens`), and took 15m26s to stream vs Grok's 36s. Combined with the
already-known gap (`requests`' `timeout=` bounds per-chunk reads, not total
duration), a slow multi-minute trickle of tokens never trips the timeout and
looks identical to a true hang.

**Fix shipped (Layer 1 of 3 proposed — by explicit user decision, the other
two are deferred):** `query_openrouter` (`core_engine.py:242`) now runs the
request on a background thread with a real wall-clock deadline
(`max(timeout*5, 600)`s default) and raises `TimeoutError` if exceeded instead
of hanging; also checks `finish_reason` and raises on `"length"` (truncated)
instead of silently handing partial JSON to `_lenient_json_loads`. Both new
failure modes propagate to the Phase-2 worker's top-level `try/except`
(`app.py:362`), so a stuck/truncated call now fails the job with a clear
message instead of sitting silently at some `%` forever. Verified with mocked
`requests.post` for fast/normal, truncated, and slow-past-deadline cases.

**Deferred (scoped, not implemented):**
1. Trim the reconciliation completion schema to decision-only fields
   (`status/match_type/matched_document/matched_amount/match_group/
   unmatched_reason`) — the echoed `date/debit/credit/etc.` fields are already
   discarded and overlaid with authoritative values downstream
   (`core_engine.py:2069-2085`), so cutting them costs nothing and shrinks
   completion size for every model.
2. Split the single all-accounts reconciliation call into **sequential**
   per-account calls with a carried-forward "documents already claimed"
   ledger — divides required completion size by account count, while
   preserving (explicitly instead of implicitly) the recurring-amount
   double-count guard that today relies on all accounts sharing one prompt.

**Next step if GLM hangs/times-out recur:** implement deferred #1 and #2
above, then re-run the same A H Smith GLM job and diff against the Grok
baseline (`job_20260705_155851`) before trusting it for client-facing output.

### Update 2026-07-05 (later still) — closing-balance leak recurred on Grok, now fixed deterministically

The previously-shipped prompt fix for closing-balance rows leaking into the
transaction list (`docs/RECONCILIATION_CLOSING_BALANCE_LEAK_FIX.md`) was only
verified against GLM-5.2. Running A H Smith on Grok-4.20
(`job_20260705_165001`) reproduced the same root cause on a different
account, inverted (kept 3 "CLOSING BALANCE" rows, dropped the opening rows) —
confirming the prompt-only instruction doesn't generalize across
models/edge-cases. Fixed properly this time: added a deterministic
`_is_closing_balance_row` backstop (mirrors the existing
`_is_opening_balance_row` one) that strips any closing-balance-labelled row
right after LLM extraction, regardless of model or prompt adherence — see the
"Update 2026-07-05" section of the FIX doc above for full detail. Needs a
fresh Phase-2 run of any affected job to take effect (extraction output isn't
cached).

---

## Bank account discovery & statement splitting

**Status:** In progress. A H Smith Consulting Super Fund's account-number
corruption is fixed and verified; the underlying discovery-flow weakness that
caused it (and a related classification-consistency issue) is recorded but
**not yet fixed** — deferred as future work.

**Chronology (A H Smith Consulting Super Fund, 2026-07-05):**
1. Comparing a GLM-5.2 job run against an earlier Grok-4.20 run of the same
   fund surfaced reconciliation differences per account (transaction counts,
   which accounts even had data). Investigation traced most of it to a single
   bad account: `funds_config.json` had a fabricated account `476541` /
   BSB `032-765` instead of the fund's three real Westpac accounts.
2. **Root cause** (`docs/BANK_ACCOUNT_DISCOVERY_RCA.md`, 2026-07-05 entry):
   `discover_fund_profile()` (fund-setup bootstrap, LLM-only, no regex
   backstop — Root Cause #3 in that doc) misread an OCR'd statement header
   where "Customer ID" and "BSB Account Number" values sit close together,
   and spliced Customer-ID digits into both the account `number` and `bsb`
   fields. Because that fabricated number is a literal substring of the
   Customer ID printed on every page of the customer's real statements
   (shared across all 3 real accounts), Phase-1's page-to-account matching
   (a blunt substring check) swept all three real accounts' pages into one
   contaminated bucket. Reproduced live by re-running `discover_fund_profile`
   — deterministic, not a one-off OCR fluke.
3. **Fix applied:** corrected `funds_config.json`'s A H Smith entry to the
   real accounts (`572080`, `682765`, `682773`, BSB `032-051`), verified
   against statement OCR. Verified by replaying the page-splitting loop
   against the real source files — each file now self-attributes 100% of its
   pages to its own account via filename pre-match, zero contamination.
4. **Follow-on cleanup** (`docs/BANK_STATEMENT_GROUPED_ROW_FIX.md`): the fixed
   run surfaced a separate, pre-existing UI clutter issue — a
   "Bank Statement (Grouped)" audit row was created per source file (one per
   original PDF, before cross-file merging), all sharing an identical
   non-clickable placeholder name. Removed; these rows added no information
   beyond the merged file's own `reasoning` and were always dropped at
   processor sign-off anyway.

**Deferred / not yet fixed (recorded for later):**
- `discover_fund_profile()` still has no plausibility backstop — a discovered
  account number that is itself a prefix/substring of another number the same
  LLM call extracted (e.g. a Customer ID) should be rejected. Would prevent
  recurrence on other funds.
- Model-dependent Phase-1 classification inconsistency: the BT Cash
  Management Trust Periodic Statement was classified `Wrap -...` in one run
  (Grok-4.20) but correctly `Bank & Term Deposits` in another (GLM-5.2) for
  the *same document* — affects whether that account's transactions are
  extracted at all.
- `_find_control`'s first-match-only regex ([core_engine.py](../core_engine.py))
  can anchor on an unrelated dollar figure (e.g. a $1.00 unit price) instead
  of a statement's real control balance.
- Distribution Statement category-boundary ambiguity was separately tightened
  this session (`docs/DISTRIBUTION_STATEMENT_CLASSIFICATION_INCONSISTENCY_FIX.md`)
  and confirmed working in the GLM-5.2 A H Smith re-run.

**Detailed docs:** `docs/BANK_ACCOUNT_DISCOVERY_RCA.md` (full RCA + decision
log), `docs/BANK_STATEMENT_GROUPED_ROW_FIX.md`,
`docs/DISTRIBUTION_STATEMENT_CLASSIFICATION_INCONSISTENCY_FIX.md`.

---

## Cross-cutting

- `classify_workpapers.py` must be kept in sync with the `core_engine.classify_papers`
  prompt (it's a standalone CLI mirror) — applies to any classification-prompt edit.
- Compile/build checks: `python3 -m py_compile core_engine.py app.py
  classify_workpapers.py`; `cd frontend && npx tsc --noEmit && npx vite build`;
  `python3 -c "import json; json.load(open('playbook_config.json'))"`.
- As of 2026-07-02: nothing from that session was committed. To commit, stage the
  changed source + docs (NOT `jobs_db.json`) on the current branch.
