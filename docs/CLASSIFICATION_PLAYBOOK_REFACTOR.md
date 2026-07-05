# Classification Playbook Refactor — Keywords → Playbook Taxonomy

Status: Implemented
Date: 2026-06-29
Owners: Trinity / engineering
Related: [PLAYBOOK_REFACTOR_DESIGN.md](PLAYBOOK_REFACTOR_DESIGN.md), [BANK_STATEMENT_CLASSIFICATION_FIX.md](BANK_STATEMENT_CLASSIFICATION_FIX.md)

---

## 1. Premise of the issue

Phase-1 document classification asked an LLM to pick one category per document,
where each category was defined by a **comma-separated keyword list** (stored in
`playbook_config.json`, e.g. `"Bank Statement": "CBA, Account, Statement, ..."`).

This keyword approach misclassified a material share of real SMSF documents
because keywords are brittle:

- They match surface terms without understanding a document's **purpose or issuer**.
- Categories overlapped on the same tokens (e.g. `ITA` appeared in both
  `Income Tax` and `Income Tax Activity`; "Metrics"/"Annual statement" collided
  across `Tax Statement Metrics` and `F25 Periodic Statement Metrics`).
- Many genuine, file-worthy documents had **no category at all**, so the model
  force-fit them into the nearest keyword match.

### Observed misclassifications (samples that drove this work)

| Document | Was (wrong) | Why it failed |
|----------|-------------|---------------|
| ASIC company extract | Trust Deed | "rules / established" keywords |
| Macquarie FY interest report | Bank Statement | "account / interest" keywords; no real bank-statement structure |
| ICP capital return / share certificate | Portfolio Valuation | "shares" keyword |
| Employer payslip (super contributions) | Income Tax | "tax" keyword |
| KPMG review letter, HUB24/UBS packs, OnePath insurance, ASIC fee invoice | (no clean home) | no matching category existed |

## 2. Requirements / findings

1. **Classify by purpose + issuer, not keywords.** Replace keyword lists with a
   natural-language **playbook**: a per-category scope plus global precedence rules.
2. **A complete, rolled-up taxonomy.** Use one authoritative parent-category list
   (sub-document types roll up to a parent) so we don't get a category per document.
3. **An `Unclassified` safety net.** Never force-fit; a confident `Unclassified`
   beats a wrong match.
4. **Precedence rules** to resolve the known collisions:
   - **Prior-Year override** (highest): a finalised/signed prior-year deliverable,
     or content relating *only* to a pre-audit year, → `Prior Year Documents`.
     *Exception:* live ATO/registry/super account snapshots that merely list
     prior-year transactions or a prior-30-June balance are classified by **type**
     (→ `ATO Accounts`). Future-year documents are classified by type.
   - **Issuer routing** for investment docs: wrap/platform → a `Wrap -` category;
     broker consolidated pack → `Broker - ...`; single holding → the specific
     direct category (Dividend/Distribution/Annual Tax/Trade Contract/HIN/Chess).
   - **Naming trap:** an accountant's "Activity Statement"/"Statement of Account"
     is **not** an ATO document → `Other Expenses`; only ATO-issued docs → `ATO
     Accounts`.
   - **Contributions vs ATO Accounts** (decide by the document's **headline
     subject/title**, not fuzzy "primary subject"): a doc titled/primarily a **TSB
     statement** → `ATO Accounts` *even though it references contribution caps*; a
     doc whose headline is concessional/non-concessional **contributions received &
     cap usage** → `Contribution` *even though it shows TSB*. When unsure, the
     title/filename wins. (Added after the post-refactor fix, then hardened — see §6.)
   - **Insurance split:** member life/TPD/IP premium → `Benefit paid/transferred`;
     property insurance → `Investment in Real Property`.
   - **Lender vs borrower:** fund borrows → `LRBA`; fund lends → `Loan Given by the
     SMSF`.
5. **Richer extraction.** In addition to `account_number` / `amount` / `date`,
   capture `sub_type` (the specific rolled-up document nature) and `member_name`.
6. **Two job-type playbooks.** `Accounting_Audit` (full, 29 categories) and a
   trimmed `Accounting` (non-audit) subset that omits audit/governance-only
   categories (Trust Deed, Change of trustee, ATO Trustee Declaration, Investment
   Strategy, ASIC Statement/Extract, Death Benefit Nomination, Member Joined/Left,
   Wrap - Type 2 Audit Report).

### Key finding from code analysis

Category names are **a downstream interface**, not just a label. Several modules
string-match the old names (bank-statement gate, the filename renamer, the keyword
fallback, and the reconciliation file-matcher). Renaming the taxonomy therefore
required a **decoupling pass**, not just a prompt swap. Separately, the per-fund
playbook merge (`app.resolve_playbook` / `_union_keywords`) assumed comma-token
keywords and would have **corrupted prose** scope text.

## 3. Solution & fix (what changed)

### Data
- **`playbook_config.json`** — replaced keyword lists with the rolled-up taxonomy.
  Values are now opaque **scope prose**. Two job types: `Accounting_Audit` (29
  categories) and `Accounting` (21-entry subset).
- **`app.py` `resolve_playbook()`** — values are treated as opaque; per-fund
  complements override/add at the **category** level (`{**global, **comp}`). No
  more comma tokenisation (which would mangle prose). `_union_keywords` is no
  longer used by this path.

### Prompt
- **`core_engine.py` `classify_papers()`** — the system prompt now injects the
  global precedence rules + `{categories_description}` (rendered as `- <cat>:
  <scope>`) and returns an extended JSON contract:
  `category, sub_type, account_number, amount, date, member_name, reasoning`,
  with `Unclassified` as the explicit fallback.
- **`classify_workpapers.py`** (standalone CLI) — its `SYSTEM_PROMPT` mirrors the
  same rules, the full `Accounting_Audit` category list, and the new JSON schema.
  Keep it in sync with `core_engine.py`.

### Decoupling from category names (downstream)
- **Bank-statement gate** (`classify_papers`) — now triggers on `Bank & Term
  Deposits` (legacy `Bank Statement` kept for back-compat).
- **`determine_target_filename()`** — rewritten for the new categories. Uses
  `account_number` (Bank & Term Deposits), `amount` (Other Expenses), `date`
  (Wrap/Broker valuation reports), `member_name` (Contribution), and appends
  `sub_type` for rolled-up parents (ATO Accounts, Unlisted Trust or Company,
  Investment in Real Property, Derivatives, Benefit paid/transferred). `"/"` is
  sanitised to `"_"` so `ASIC Statement/Extract` cannot create sub-directories.
- **File-record persistence** — `sub_type` and `member_name` are now stored on
  every processed-file record (alongside the existing fields).
- **`fallback_classify_by_keywords()`** — realigned to the new taxonomy, only
  fires categories active in the resolved playbook, and emits the new fields.
- **Reconciliation file-matcher** (`reconcile_papers`) — updated to the new
  filenames: broker cash → `Broker ...`; wrap/broker valuations → `Wrap ...` /
  `Broker ...`; tax statements also match `ATO Accounts`; current-tax assets match
  `ATO Accounts`; `Other Expenses - <sub_type>` disambiguates accountancy vs audit.
  Legacy names retained as fallbacks.

## 4. Known behaviour changes / limitations

- **Fee granularity now depends on `sub_type`.** Accountancy, audit, adviser,
  audit-shield and ASIC fees all roll up to `Other Expenses`; the reconciliation
  accountancy-vs-audit split relies on the `sub_type` keyword carried into the
  filename rather than separate categories.
- **Open taxonomy items** (defaults chosen, revisit if needed): ASIC annual-review
  fee invoice → `Other Expenses`; client working-paper/"PBC" schedules → currently
  `Unclassified` (no working-papers category); fee **rebates** → `Other Expenses`.
- **`Unclassified`** is honoured by the prompt but is not a `playbook_config.json`
  entry (matches the prior design).

## 5. Verification

- `python3 -m py_compile core_engine.py app.py classify_workpapers.py` → OK
- `playbook_config.json` parses; `resolve_playbook` returns 29 (Accounting_Audit)
  / 21 (Accounting) categories with prose intact.
- `determine_target_filename` produces correct names across the new categories
  (incl. `/` sanitisation and `sub_type`/`member_name`/`amount`/`date` usage).

## 6. Post-refactor fixes (Hann run — ATO contribution screens)

After the first run on the Hann Family Superannuation Fund (`job_20260629_230448`),
the five ATO concessional/non-concessional **contribution screens** were classified
as `ATO Accounts` instead of `Contribution`. Investigation found two issues.

### 7a. Classification — taxonomy overlap (primary)
The LLM correctly identified the documents (its `sub_type` values literally read
"… concessional contributions screen", "… non-concessional contributions cap …")
but filed them under the wrong **parent**. These are ATO online-services
screenshots that prominently show the member's **Total Superannuation Balance** and
**contribution caps** alongside the contribution figures. Because `ATO Accounts`
was framed as "ATO-issued account docs" and listed "TSB report", the model anchored
on the ATO-issuer + TSB signal and chose `ATO Accounts`. (The same docs went to the
old `Total Super annuation balance` category for the identical reason.) OCR was not
the cause — every file OCR'd fine and the sub_types prove the content was read.

**Fix (v1):** added an explicit precedence rule (rule 4) and tightened both scopes —
an ATO screen whose primary subject is contributions/caps → `Contribution` even if it
shows TSB; `ATO Accounts` only for income-tax/integrated-client/PAYG/GST accounts or
a **standalone** TSB/TBC report. Applied in `core_engine.py` (prompt),
`playbook_config.json` (both job types) and `classify_workpapers.py`.

**Fix (v2 — hardened).** The v1 rule said *"contributions + TSB on the same screen →
Contribution"*, which **over-triggered on TSB reports** (a TSB report always discusses
contribution caps, since TSB drives the NCC cap). In the next run
(`job_20260630_064301`) this produced an **inconsistency**: Josh's TSB report →
`ATO Accounts` (correct) but Rebecca's identical TSB report → `Contribution` (wrong) —
the model's own reasoning contradicted itself ("primary subject is TSB … therefore
Contribution"). Rule 4 was made **deterministic, anchored on the document's headline
subject/title** rather than a fuzzy "primary subject": a TSB statement → `ATO Accounts`
regardless of cap mentions; a contributions-received/cap-usage screen → `Contribution`
regardless of TSB display; on doubt the title/filename decides. Re-applied across the
same three files.

### 7b. Persistence — approval step dropped the new fields (secondary, regression)
The human-approval handler (`app.py:api_processor_review`) rebuilt each file record
with a fixed schema and **re-derived the filename without `sub_type`/`member_name`**,
so on approval those fields plus `reasoning` were lost and the detailed staging
filename collapsed (`Contribution - Joshua Hann.pdf` → `Contribution.pdf`). Phase-1
records were correct; only the approval rebuild stripped them — a touch point missed
in the original wiring pass.

**Fix:** `api_processor_review` now reads `sub_type`/`member_name`, passes them into
`determine_target_filename(...)`, and carries `sub_type`/`member_name`/`reasoning`
into both `approved_files` branches. It also **hydrates** these fields from the
Phase-1 job record when the review payload (from the SPA) omits them, so the backend
no longer depends on the client round-tripping the new fields. Frontend follow-up
(optional): have the review UI echo `sub_type`/`member_name` so user edits persist.

## 6b. Post-refactor fixes (Seyffer run — identical copies classified differently)

Two identical copies of a Macquarie Private Bank report (`@seyffer (1).pdf`,
`@seyffer-823.pdf`) were classified differently — one `Wrap - Annual Transaction
Listing and Portfolio Valuation Report`, the other `Unclassified` — in
`job_20260701_224642`. Both reasonings described the same content; they diverged only
on whether "Macquarie Private Bank" counts as a "wrap/platform".

**Cause.** Rule 2 listed specific platform names ("HUB24, UBS, Macquarie Wrap, BT
Panorama"). "Macquarie **Private Bank**" isn't literally in that list, so on this
borderline case the model flip-flopped run-to-run (closed-set reading → Unclassified;
platform reading → Wrap). Same ambiguity-plus-stochasticity family as the Rebecca-TSB
issue. Correct answer is Wrap.

**Fix 1 — wording.** Rule 2 now states the platform list is **non-exhaustive** and
names Macquarie Private Bank explicitly; a consolidated portfolio-valuation + cash-
ledger report from any platform or private-bank investment service → `Wrap - Annual
Transaction Listing and Portfolio Valuation Report`. Applied in `core_engine.py`,
`playbook_config.json` (both job types), `classify_workpapers.py`.

**Fix 2 — content-hash dedup (also cuts tokens).** `classify_papers` now caches each
classification keyed on a SHA-256 of the extracted text (filename excluded). An exact
copy reuses the first file's classification and **skips the LLM call** — so duplicates
always get the same category and we don't pay to classify the same content twice. The
Phase-1 classify JSON is also parsed via `_lenient_json_loads` now (same robustness as
Phase 2).

## 7. Touch points (file:symbol)

- `playbook_config.json` — taxonomy + scope prose (authoritative)
- `app.py:resolve_playbook` — opaque category-level merge
- `core_engine.py:classify_papers` — prompt, scope rendering, bank gate, persistence
- `core_engine.py:determine_target_filename` — filename mapping
- `core_engine.py:fallback_classify_by_keywords` — LLM-failure fallback
- `core_engine.py:reconcile_papers` — checklist file-matching
- `classify_workpapers.py:SYSTEM_PROMPT` — standalone CLI mirror
