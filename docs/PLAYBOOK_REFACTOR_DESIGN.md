# Playbook Refactor — Global Playbook + Per-Fund Complements

**Status:** Design locked · approved 2026-06-27 · **Owner:** Trinity Team
**Nature:** Structural change to how classification keywords/categories are stored and resolved. Engine classification logic itself is unchanged.

> Extract the (largely duplicated) per-fund `keywords` block into a single shared **global playbook**, keep only **additive per-fund complements** in `funds_config.json`, and merge the two at job-processing time. Add a UI affordance to grow the global playbook.

---

## 1. Motivation

Every fund in `funds_config.json` carries its own full copy of the classification `keywords` (`{job_type: {category: "comma, separated, rules"}}`). In practice **8 of 9 funds are byte-identical** — the duplication is an artifact of `bootstrap` seeding each new fund from `funds[0]["keywords"]` ([app.py:387](../app.py)). Maintaining the category taxonomy means editing N funds. We want **one source of truth** plus small per-fund tuning.

### Current-state findings (verified)

- **8/9 funds** share an identical keyword block; **`hart_super` differs**: different keyword *strings* for shared categories (it banks with Macquarie/ANZ, not CBA) **and** a narrower category set (6 vs 12).
- **Only consumer** of keywords is Phase-1 classification: `fund_profile.get("keywords",{}).get(job_type,{})` ([core_engine.py:427](../core_engine.py)), with a hardcoded default dict fallback ([core_engine.py:430](../core_engine.py)) and a keyword fallback classifier ([core_engine.py:695](../core_engine.py)).
- **Job records never snapshot keywords** (confirmed) — keywords only matter at Phase-1 time. ⇒ **no historical-job migration**; change is forward-only.

---

## 2. Locked decisions

1. **New categories added in the UI go GLOBAL** (apply to every fund).
2. **Per-fund entries are COMPLEMENTS, not overrides** — additive only. A fund can *add* keywords/categories on top of global; it can never *replace* or *remove* a global one.
3. **(Resolved by #2)** No override/replace semantics. The merge rule everywhere is **union**. (Cost: complements can only broaden a fund, never subtract a misleading global keyword/category for one fund — accepted.)
4. **Keep the `core_engine` fallback dict** ([core_engine.py:430](../core_engine.py)) as the last-resort safety net.

### Accepted behavior change (only `hart_super`)

Because complements only add, Hart's effective playbook becomes a **superset** of what it has today: it will be offered **all 12 global categories** (vs 6) and its keyword strings become the **union** of global + Hart's terms. All other 8 funds are **byte-identical to today** (empty complement). More categories offered *can* shift Hart's classifications — accepted.

---

## 3. Data model

### 3a. Global playbook — `playbook_config.json` (new, workspace root)

```jsonc
{
  "Accounting":       { "Bank Statement": "CBA, Account, Statement, Transaction, BSB", "Portfolio Valuation": "...", "Accountancy": "..." },
  "Accounting_Audit": { "Bank Statement": "...", "Trust Deed": "Trust Deed, Deed, Rules, Establishment", ... }
}
```
Seeded verbatim from the common (admcm) block, so the 8 identical funds see no change. Single source of truth for the category taxonomy + default keywords.

> Known pre-existing wart carried over as-is: the global `Ordr Mint Transation Listing` rule contains `account 1160944` (an ADMCM-specific account number). Harmless for other funds (never matches their docs). Left global to preserve exact current behavior; can be moved to an ADMCM complement later.

### 3b. Per-fund complements — in `funds_config.json`

The full `keywords` key is **removed** from each fund and replaced by an optional, additive `keyword_complements` with the same shape:

```jsonc
{ "id": "hart_super", "name": "...", "folder_path": "...", "bank_accounts": [...], "members": [...],
  "keyword_complements": {
    "Accounting_Audit": { "Bank Statement": "Macquarie, ANZ, Balance, Interest", "Trust Deed": "Settle, Trustees", ... },
    "Accounting":       { "Bank Statement": "Macquarie, ANZ, Balance, Interest", ... }
  } }
```
- 8 funds → `keyword_complements: {}` (empty).
- `hart_super` → the **delta tokens** (Hart's tokens not already in global), computed by the migration.

### 3c. Resolution (merge) rule

For a given `(fund, job_type)`:
```
categories = global_categories ∪ fund_complement_categories
effective[cat] = union_preserve_order(global[cat] tokens, complement[cat] tokens)   # case-insensitive dedup, global first
```
Tokens are the comma-separated rule strings; output is re-joined to a comma string (the exact format `core_engine` already expects).

---

## 4. Backend changes (`app.py`)

| Concern | Change |
|---|---|
| Load/save global | New `load_playbook()` / `save_playbook()` for `playbook_config.json`. |
| Resolution | New `resolve_playbook(fund_profile, job_type)` implementing §3c. |
| Job creation | After loading `fund_profile` ([app.py:442](../app.py)) and **before** starting the worker ([app.py:494](../app.py)), set `fund_profile["keywords"] = {job_type: resolve_playbook(...)}`. ⇒ **`core_engine` untouched.** |
| New endpoints | `GET /api/playbook` → global; `PUT /api/playbook` → save global (edits + new categories). |
| Fund save | `POST /api/funds` unchanged (`f.update`) — now carries `keyword_complements` instead of `keywords`. |
| Bootstrap | Drop `keyword_template = funds[0]["keywords"]` ([app.py:387](../app.py)); new funds start with `keyword_complements: {}`. |
| New-fund builders | `_empty_fund_config` / `_profile_to_fund_config` take/emit `keyword_complements` (default `{}`) instead of `keywords`. |

`core_engine.py` is **not modified** (resolution happens upstream; fallback dict retained).

---

## 5. Frontend changes

| File | Change |
|---|---|
| `api/types.ts` | `Fund.keyword_complements?`; drop reliance on `Fund.keywords`. New `Playbook = Record<jobType, Record<category, string>>`. New payloads for global save + fund complement save. |
| `api/client.ts` | `getPlaybook()` (GET), `savePlaybook()` (PUT global), `saveFundComplements()` (POST `/api/funds`). |
| `api/hooks.ts` | `usePlaybook()`, `useSavePlaybook()` (global), `useSaveFundComplements()`. |
| `workspace/PlaybookDrawer.tsx` | Rework: load global playbook (active `job_type`) + this fund's complements. **Section A — Global playbook:** one editable keyword input per category **+ "＋ Add category"** (name + keywords). **Section B — Fund-specific additions:** optional per-category "also matches…" inputs (complements). One **Save** persists global (PUT) and complements (POST) as needed. Violet accent retained. |
| `step1/utils.ts` | Reuse `playbookToRows` / `rowsToPlaybook` for both global and complement maps. |

---

## 6. Migration (one-time script)

1. Write `playbook_config.json` = admcm's `keywords` block, verbatim.
2. For each fund: compute `keyword_complements` = per `(job_type, category)`, the tokens present in the fund but **not** in global (case-insensitive). 8 funds → `{}`; `hart_super` → its delta.
3. Strip `keywords` from every fund; add `keyword_complements`.
4. Back up `funds_config.json` first; idempotent (re-running yields the same result).

No job-data migration (jobs don't store keywords).

---

## 7. Testing & verification

- **`test_story10`** asserts `isinstance(p["keywords"], dict)` ([test_story10.py:112](../test_story10.py)) — update to `keyword_complements`.
- **Resolution unit check:** assert admcm resolves to the old block exactly; assert hart resolves to a superset (12 categories; Bank Statement contains both CBA and Macquarie tokens).
- **Frontend:** typecheck + build + vitest; live smoke — open Playbook drawer, edit a global keyword, add a category, add a fund complement, save, re-open.
- **Live engine smoke:** create a job and confirm classification still runs (resolved keywords reach the prompt).

---

## 8. Risk & rollback

- **Risk** concentrated in preserving behavior: 8 funds must be byte-identical (empty complement); only Hart changes, by design. Resolution merge is the one new code path — covered by the unit check.
- **Rollback:** restore `funds_config.json` from the migration backup and delete `playbook_config.json` + revert `app.py`/frontend. Jobs are unaffected either way.

---

## 9. Out of scope (this change)

- Subtract/exclude semantics per fund (complements are additive only — §2.3).
- Cleaning the `account 1160944` wart out of the global rule (§3a).
- Versioning/history of playbook edits.
