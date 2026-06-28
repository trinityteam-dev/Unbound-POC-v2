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

---

## 5. Decision log

- **2026-06-28:** RCA recorded. POC will implement **Layer 5 only** as the quick win. Layers 1–4 deferred (recorded, not committed). Awaiting review before any code.
- **2026-06-28 (correction):** Clarified that the *classification* path (where L5 lives) already OCRs every page on demand — L5 needs no extra OCR; its residual risk is OCR **quality**, not coverage. The page-1-only OCR limit applies only to the *discovery/setup* path (Layer 2). Added §OCR stack documenting the Tesseract + pdftoppm @150 DPI pipeline.
- **2026-06-28 (implemented):** Layer 5 shipped. Added `detect_account_number()` (conservative, context-anchored regex) in `core_engine.py`, and a fallback in the statement-split page loop ([core_engine.py:~565](../core_engine.py)) that discovers an account from page content when no configured account matches. Validated offline on Seyffer's two scanned statements (real Tesseract OCR): discovered `199860672` (NAB, ends `0672`) and `965684806` (Macquarie, ends `4806`), producing two per-account `Bank Statement - …pdf` workpapers instead of one `unknown` merge. Layers 1–4 remain deferred. **Scope boundary:** L5 fixes classification/workpaper grouping only; Phase-2 reconciliation still reads `fund.bank_accounts` (empty until L1–L4/backfill).
