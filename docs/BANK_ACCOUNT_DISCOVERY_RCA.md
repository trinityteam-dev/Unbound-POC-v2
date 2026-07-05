# RCA — Bank accounts not detected at fund setup (Seyffer Super 1)

**Status:** Recorded · 2026-06-28 · **Owner:** Trinity Team
**Scope:** Root-cause analysis + layered remediation plan. **No code fix applied yet.**
**POC decision:** Only **Layer 5** (downstream resilience) is in scope as the quick win for now. Layers 1–4 are recorded for later, not production-committed.

---

## 1. Symptom

`Seyffer Super 1` has `bank_accounts: []` in `funds_config.json`, even though the fund's document folder contains at least two real bank statements with account numbers:

- `NAB Statements Acc#0672_Seyffer Super 1 .pdf`
- `Macquarie bank Acc #4806.pdf`

Downstream, Phase-1 bank-statement splitting cannot assign pages to accounts, so all pages fall to `"unknown"` and merge into a single generic `Bank Statement.pdf` instead of per-account workpapers.

---

## 2. Evidence

Fund setup runs `discover_fund_profile()` ([core_engine.py:206](../core_engine.py)).

**(a) Neither statement was sampled.** Discovery selects "representative" files by **filename keyword, first match per keyword, capped at 8** ([core_engine.py:217-238](../core_engine.py)). Replaying the exact selection for Seyffer, the 8 files actually sent to the LLM were:

```
ICP Funding Capital Return Statement …, ICP Share Certificate …, TSB - Bernard,
Audit report - Private Bank …, Macquarie Private Bank Tax Guide …,
Financial Year's Macquarie Interest Report …, ATO Income Tax Account …, ASIC Extract …
```

The two real statements were **crowded out**: keyword `statement` → ICP statement; `bank` → Private Bank *audit report*; `mac` → Macquarie *tax guide*. → `NAB Statements` and `Macquarie bank Acc` both excluded.

**(b) The statements have no extractable text.** `extract_pdf_text(max_pages=2)` returns **0 characters** for both — they are scanned/image PDFs. **Discovery's** OCR fallback only fires for *selected* files and OCRs **page 1 only** ([core_engine.py:244](../core_engine.py)). (Note: this page-1-only limit is in the *discovery/setup* path. The *classification* path OCRs every page on demand — see §OCR stack and Layer 5.)

**(c) Extraction is LLM-only.** No regex/heuristic for BSB/account numbers, and filename hints (`Acc#0672`, `#4806`) are unused. With no statement text, the LLM correctly returned `bank_accounts: []`. Members *were* found (from `TSB - Bernard.pdf`, which is text-extractable), proving the LLM call itself succeeded — only account extraction failed.

---

## 3. Root causes

1. **Selection bias / cap** — filename-keyword, first-match-per-keyword, 8-file cap displaces the actual statements in favour of other "statement/bank/mac" files.
2. **Scanned statements** — image PDFs yield no text; OCR fallback is first-page-only and only for selected files.
3. **No deterministic extraction** — relies entirely on the LLM; ignores BSB/account regex and filename hints.
4. **Cascade** — empty `bank_accounts` at setup → Phase-1 split has nothing to match → `"unknown"` → single merged statement; reconciliation/grouping degraded.

---

## OCR stack (reference)

- **Engine:** Tesseract, invoked as a **CLI subprocess** (not a Python OCR lib). Pipeline = `pdftoppm` (Poppler) renders a page → PNG, then `tesseract` OCRs the PNG ([core_engine.py:50-101](../core_engine.py)).
- **Settings:** render at **150 DPI**, default language (`eng`), default page-segmentation, **no image preprocessing** (no deskew/threshold/denoise). 150 DPI is below Tesseract's recommended ~300 DPI → weaker digit accuracy on scans.
- **Dependencies:** `tesseract` + `pdftoppm` are **system binaries** (`/opt/homebrew/bin`), resolved via `find_executable`. They are **not** in `requirements.txt` (only `pypdf`); OCR silently degrades if either is missing.
- **Two OCR call sites, different coverage:**
  - *Discovery / fund setup* (`discover_fund_profile`) → **page 1 only** ([core_engine.py:244](../core_engine.py)). ← Layer 2.
  - *Classification / statement split* → **every page**, OCR'd on demand when `extract_text()` is thin ([core_engine.py:543-552](../core_engine.py)). ← where Layer 5 lives.

---

## 4. Remediation — 5 trackable layers

> Priority for a real fix would be L1+L2 (robust extraction) → L3 (look at the right files) → L4 (human backstop). **For this POC we are doing L5 only.**

### ☐ Layer 1 — Deterministic account extraction (complements the LLM)
- **Goal:** recover accounts the LLM misses.
- **Approach:** regex pass for BSB (`\d{3}-?\d{3}`) and account numbers near `Account|BSB|A/C`, plus parse filename hints (`Acc#0672`, `#4806`); merge + dedupe with LLM output in `discover_fund_profile`.
- **Touches:** `core_engine.py` (`discover_fund_profile`).
- **Effort:** M. **Done when:** Seyffer setup proposes ≥2 accounts (NAB, Macquarie) without manual entry.

### ☐ Layer 2 — Proper OCR for statements *(discovery/setup path only)*
- **Goal:** get text out of scanned statements **at fund setup**.
- **Approach:** when a statement-type candidate yields little text, OCR multiple pages (not just page 1); feed that text to L1 + the LLM. (Classification already does multi-page OCR — see §OCR stack — so this layer is specifically for `discover_fund_profile`.)
- **Touches:** `core_engine.py` (OCR helpers, `discover_fund_profile`).
- **Effort:** M. **Done when:** scanned NAB/Macquarie statements yield account/BSB text during discovery.

### ☐ Layer 3 — Fix representative-file selection
- **Goal:** ensure the real statements are actually examined.
- **Approach:** before the 8-cap padding, explicitly include all bank-statement-like files (name matches `bank|statement|acc#|nab|macquarie|cba|anz|westpac…`), or run a dedicated statement pass; raise/relax the cap.
- **Touches:** `core_engine.py` (selection block, [:217-238](../core_engine.py)).
- **Effort:** S. **Done when:** both Seyffer statements appear in the discovery sample set.

### ☐ Layer 4 — Human-in-the-loop backstop (UI)
- **Goal:** guarantee correctness when auto-detection fails.
- **Approach:** bootstrap already returns a *proposed* config + warning — surface "No bank accounts detected" in setup and allow manual add/edit of bank accounts (and/or expose bank-account editing in the fund-config drawer). Persist via `POST /api/funds`.
- **Touches:** frontend (new-audit / fund-config UI), `app.py` (none — uses existing `POST /api/funds`).
- **Effort:** M. **Done when:** a user can add Seyffer's accounts in the UI and they persist.
- **Observation (persistence vs L5):** L5 derives accounts **per run** (transient) and deliberately does **not** write them back to `funds_config.json`, because the numbers come from OCR and baking an OCR-misread number into the source of truth would corrupt every future run. Layer 4 is the correct home for *persisting* discovered accounts — but only **after human confirmation** (surface L5's discoveries in the UI; persist via `POST /api/funds` once reviewed). That also upgrades the generic names/blank BSB to real values, fixing the L5 cosmetic gap.
- **Observation — natural home for L5 backfill ("set once"):** L5 (shipped) discovers accounts at classification time but **deliberately does not persist** them to `funds_config.json`; it re-derives in-memory each run. The clean way to make discovery sticky is to route L5's discovered accounts **into this L4 confirm flow** — e.g. "We detected accounts `199860672`, `965684806` from the statements — confirm to save" — so persistence happens **only after human review**, via `POST /api/funds`. Rationale for not auto-persisting:
  - **Correctness:** L5 numbers come from OCR (150 DPI, no preprocessing — see §OCR stack); a misread digit baked into the canonical config would silently corrupt *every* future run. Re-deriving per run is self-correcting; confirmed-then-persisted keeps OCR guesses out of the source of truth.
  - **Not a perf win:** persisting does **not** reduce per-run overhead — the OCR cost is incurred every job during statement splitting regardless of whether accounts are configured ([core_engine.py:543-552](../core_engine.py)); configured accounts only change what the OCR'd text is *matched against*. L5 adds only a cheap regex.
  - **What it *would* buy:** Phase-2 reconciliation picks the accounts up (reads `fund.bank_accounts`), nicer per-account filenames (real account name vs `General Bank Account`), and one-time-setup consistency.

### ☑ Layer 5 — Downstream resilience (POC quick-fix) — **IMPLEMENTED 2026-06-28**
- **Goal:** group statements correctly even when `fund.bank_accounts` is empty, decoupling grouping from setup-time discovery.
- **Approach:** during Phase-1 statement splitting ([core_engine.py:468-568](../core_engine.py)), when page text contains a detectable account number that isn't in `fund_profile["bank_accounts"]`, capture it on the fly and group by it (and optionally backfill the fund's `bank_accounts`). Statements then split into per-account files instead of one `"unknown"` merge.
- **Touches:** `core_engine.py` (Phase-1 split/group block).
- **Effort:** S–M. **Done when:** a Seyffer job produces per-account `Bank Statement - <number>.pdf` workpapers despite empty `bank_accounts` at setup.
- **OCR coverage (corrected):** the Phase-1 split loop ([core_engine.py:543-552](../core_engine.py)) **already iterates every page and OCRs each low-text page on demand**, so L5 inherits multi-page OCR — it needs **no** extra OCR work. (This is the *classification* path; the page-1-only limit in §2(b)/Layer 2 is the separate *discovery* path.)
- **Residual risk (corrected):** OCR **quality/legibility**, not page coverage. Given the stack (Tesseract @150 DPI, no preprocessing — see §OCR stack), if a scanned page's digits don't OCR cleanly, L5 can't recover them → fall back to Layer 4 (manual entry). Improving OCR fidelity (higher DPI / preprocessing) is a quality lever, but is **out of scope** for the POC.
- **Scope note:** POC-grade — does not fix setup-time discovery (Layers 1–3) or add manual entry (Layer 4).
- **IMPLEMENTED (2026-06-28):**
  - *Classification half* — `detect_account_number` discovers the account from page OCR text and groups by it; `derive_account_brand` reads the bank brand from the source statement filename so the merged workpaper is named `Bank Statement - <Brand> - <number>.pdf` (no more `General Bank Account` stub) (`core_engine.py`).
  - *Phase-2 half* — at processor sign-off (`api_processor_review`), `derive_bank_accounts_from_job` rebuilds bank accounts from the classified statements (names via the source filename brand, e.g. `NAB Account <number>`) and `merge_bank_accounts` seeds them into a **job-scoped** `fund_profile.bank_accounts` (configured accounts always win). This makes **reconciliation, Cash-at-Bank checklist, compliance and lead schedules** all populate (`app.py`).
  - *Known cosmetic gap:* discovered accounts show a generic name (`NAB Account <number>`) and **blank BSB** in reconciliation and the lead schedule (the Compliance/checklist label is number-based, so it looks normal). Real names/BSB need the config route (Layers 1/4).

---

## 5. Decision log

- **2026-06-28:** RCA recorded. POC will implement **Layer 5 only** as the quick win. Layers 1–4 deferred (recorded, not committed). Awaiting review before any code.
- **2026-06-28 (correction):** Clarified that the *classification* path (where L5 lives) already OCRs every page on demand — L5 needs no extra OCR; its residual risk is OCR **quality**, not coverage. The page-1-only OCR limit applies only to the *discovery/setup* path (Layer 2). Added §OCR stack documenting the Tesseract + pdftoppm @150 DPI pipeline.
- **2026-06-28 (L5 Phase-2 half implemented):** Added the job-scoped `fund_profile.bank_accounts` injection at processor sign-off plus filename-derived friendly names, so all of Phase 2 (reconciliation, Cash-at-Bank checklist, compliance, lead schedules) populates for funds with no configured accounts. Still transient per-run (no config write); persistence remains Layer 4 (confirm-then-save).
- **2026-06-28 (implemented):** Layer 5 shipped. Added `detect_account_number()` (conservative, context-anchored regex) in `core_engine.py`, and a fallback in the statement-split page loop ([core_engine.py:~565](../core_engine.py)) that discovers an account from page content when no configured account matches. Validated offline on Seyffer's two scanned statements (real Tesseract OCR): discovered `199860672` (NAB, ends `0672`) and `965684806` (Macquarie, ends `4806`), producing two per-account `Bank Statement - …pdf` workpapers instead of one `unknown` merge. Layers 1–4 remain deferred. **Scope boundary:** L5 fixes classification/workpaper grouping only; Phase-2 reconciliation still reads `fund.bank_accounts` (empty until L1–L4/backfill).
- **2026-07-03 (new evidence — A H Smith Consulting Super Fund):** Reproduced the same root cause on a second, independent fund, plus surfaced one gap not covered by L1–L5. `funds_config.json` has 2 configured accounts (Westpac `572080`, BT Panorama `120673371`) for a folder that actually contains 4: three distinct Westpac accounts (`572080`, `682765`, `682773` — visible directly in the `WBC <number>-<suffix>.pdf` source filenames) plus the BT Panorama CMA. Fund-discovery bootstrap (`discover_fund_profile`) proposed only 2 accounts — confirms Root Cause #1 (keyword-in-filename sampling excludes all three `WBC ####-###.pdf` files, since none contain "bank" or "statement"). Phase-1 classification (Layer 5) correctly discovered 3 (`572080` configured + `682765`/`682773` via `detect_account_number` on OCR'd statement pages), since it scans full page content of every `Bank & Term Deposits`-classified document rather than a capped sample. Phase-2 reconciliation showed 4 via `derive_bank_accounts_from_job`/`merge_bank_accounts` unioning Phase-1's 3 discovered accounts with the 2 configured accounts. **New gap (not covered by L1–L5):** the BT Panorama CMA is invisible to Layer 5's page-scan loop because that loop only runs for documents classified `Bank & Term Deposits` — a platform-held cash account referenced only inside `Wrap -` categorized documents (BT Panorama transaction/valuation/tax statement reports) is never scanned for an account number, regardless of OCR/regex quality. No code changed for this entry; recorded as evidence only.
- **2026-07-05 (new evidence + fix applied — A H Smith Consulting Super Fund, Customer-ID collision):** Found and corrected a more severe manifestation of Root Cause #3 on the same fund. Since the 2026-07-03 entry, the fund's document set changed (BT Panorama replaced by BT Cash Management Trust) and `funds_config.json`'s `bank_accounts` had been regenerated by `discover_fund_profile()` — this time producing a **fabricated** account: number `476541`, bsb `032-765`. Confirmed via OCR of all three original `WBC ####-###.pdf` statement headers that `476541` is not a real account — it is the first 6 digits of the Westpac **Customer ID** ("4765 4139", printed identically on every page of all three real accounts) with spaces stripped (`"47654139"[:6] == "476541"`); the fabricated bsb `032-765` mixes the real BSB prefix `032` with trailing Customer-ID digits `765`. Reproduced live by re-running `discover_fund_profile()` against the fund's current folder — it returns the identical wrong values every time, confirming a deterministic failure of that function's LLM-only extraction (Root Cause #3), not a one-off OCR fluke: the file-selection keyword list doesn't match `WBC ####-###.pdf` filenames, so only one of three WBC files reaches the LLM via the "pad to 8" fallback; its OCR'd header interleaves `Customer ID` and `BSB Account Number` labels/values in a way the discovery LLM misreads, splicing Customer-ID digits into both the `number` and `bsb` fields instead of reading the actual BSB Account Number line. **Downstream blast radius:** because the fabricated `476541` is a literal substring of the Customer ID printed on every page of all three real accounts, and Phase-1's page-to-configured-account matching is a blunt substring check ([core_engine.py:709-718](../core_engine.py)), every WBC page from all three accounts matched `476541` first — merging three unrelated real accounts' transactions (and their per-period `CLOSING BALANCE` boundary rows) into one contaminated bucket, while the true account numbers never appeared in `bank_accounts` at all. **Fix applied:** corrected `funds_config.json`'s A H Smith entry to the three real Westpac accounts (`572080`, `682765`, `682773`, all BSB `032-051`), verified directly from statement OCR; `90167750` (BT Cash Management Trust) was already correct and left unchanged. Verified by replaying the page-splitting loop against the real source files with the corrected config: each WBC file's filename now pre-matches its own real account number before any page is read, so every page lands in its own correct bucket with zero cross-contamination — OCR isn't even triggered for these files anymore, since `current_acc` is resolved from the filename before the "unknown" fallback can fire. **Scope of fix:** config-only; affects future job runs only. Does not retroactively correct already-completed jobs (`job_20260704_191348`, `job_20260704_222430`), which have the bad account baked into their stored `phase2_context`. **Not fixed by this change (recorded for later):** (a) `discover_fund_profile()` still has no plausibility backstop — a good candidate is rejecting a discovered account number that is itself a prefix/substring of another number the same LLM call extracted (e.g. a Customer ID it also saw); (b) a separate, model-dependent Phase-1 classification inconsistency where the BT Cash Management Trust Periodic Statement was routed to "Wrap" instead of "Bank & Term Deposits" in one run (Grok-4.20) but not another (GLM-5.2), which independently affects whether that account's transactions are extracted at all; (c) `_find_control`'s first-match-only regex ([core_engine.py:1368-1375](../core_engine.py)) can anchor on an unrelated dollar figure (e.g. a $1.00 unit price) instead of a statement's real control balance.
