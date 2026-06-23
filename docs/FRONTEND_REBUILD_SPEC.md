# Frontend Rebuild Spec & Layout Guide — SMSF Document Intelligence v2 (POC)

**Status:** Final layout direction · **Date:** 2026-06-23 · **Owner:** Trinity Team
**Nature:** Throwaway POC. Goal = a **clean, modern, better-looking presentation layer** over the **existing Flask engine, unchanged**. Optimize for build speed + visual quality, not auth/tests/hardening.

**Stack (decided):** React 18 + TypeScript + **Vite** + **Mantine v7** (UI kit) + TanStack Query (polling/server-state). Standalone SPA; Vite proxies `/api/*` → Flask on `:5001`. No backend changes, no BFF.

> This document is the build guide for the **finalized layout**: a *unified, see-everything dashboard* (matching how users work today) that is re-laid-out to feel calm — flattened boxes, whitespace zoning, restrained color, a decluttered sidebar, and a **persistent header that carries fund identity, status, token/cost, and a 4-stage workflow timeline across every screen.**

---

## 1. Design principles (why it looks the way it does)

The original Flask UI is dense and busy not because it shows too much, but because of *how* it's arranged: a heavy sidebar full of boxed widgets, stacked chrome bands, and every section wrapped in its own border (boxes-inside-boxes), with color everywhere. We keep the **same information density and unified layout**, and calm it down via:

1. **Flatten the boxes.** Content sits on a tinted canvas in white panels separated by **whitespace and hairline dividers**, not nested bordered cards. Tables have row dividers only — no wrapping card border.
2. **Whitespace zoning.** Consistent 16–22px padding/gaps. Generous breathing room is the single biggest calm lever.
3. **Restrained color.** Color appears only where it carries meaning: **status, matched/unmatched marks, and the one primary action.** Everything structural is neutral, so density stops reading as noise.
4. **Strict two-zone grid + persistent action bar.** Sidebar | workspace. The primary action (Approve / Sign off) is a fixed bar at the bottom of the workspace, not a floating card.
5. **Declutter the sidebar.** The always-on config form is gone; the sidebar is a flat job list + a single "New audit" action.
6. **Persistent orientation chrome.** Fund identity, status, token/cost, and the **workflow timeline** live in a header band that never moves; only the content below changes.

---

## 2. App structure

Two contexts (keeps "browse/launch" from cluttering "do the work"), but the working screen stays a **unified dashboard**:

- **Audits home** — calm, generously spaced list: audits *awaiting your review* first, then recent ones muted. A single "New audit" action (opens fund + playbook pickers). This is where you launch/switch jobs.
- **Job workspace** — the unified dashboard for one job: persistent header (§4) + decluttered sidebar (§5) + content area with secondary tabs (§6). Everything for the current job is visible/one click away here.

Job-switching also available from the sidebar list and a `⌘K` switcher.

---

## 3. Visual tokens (match these exactly — they are what the widgets used)

| Token | Value | Use |
|---|---|---|
| **Primary green** | `#00AF5A` | Primary buttons, active timeline nodes, active tab underline, left-accent on active job. |
| **Sidebar** | `#151B2D` | Sidebar background (kept dark — liked look & feel). Text = `rgba(255,255,255,.92)` / muted `rgba(255,255,255,.62)` / faint `rgba(255,255,255,.4)`. |
| **Canvas** | Mantine `--mantine-color-gray-0` / `#F7F8FA` | Workspace background (tinted, so white panels read as raised without borders). |
| **Surface** | `#FFFFFF` | Header band, panels, action bar. |
| **Hairline** | `0.5px` border, `~#E5E8EE` (`--color-border-tertiary`) | Row dividers, band separators. |
| **Text** | primary `#1A2233`, secondary `#5B6473`, tertiary `~#8A93A2` | Hierarchy via text color, not boxes. |
| **Status semantics** | success green / warning amber / info blue / danger red | Status pills, matched/unmatched, exceptions. Use Mantine semantic colors. |

- Font: **Inter** (or system). Money/number columns: `font-variant-numeric: tabular-nums`.
- Radius: `md` (8px) most elements, `lg` (12px) panels, `xl` (16px) only for focal cards. Status pills `md`.
- Mantine `theme`: set `primaryColor` to a custom green scale anchored on `#00AF5A`, `defaultRadius: 'md'`, `fontFamily: 'Inter, sans-serif'`. That carries most of the identity.

---

## 4. Persistent header chrome (appears on every job screen)

A single white band at the top of the workspace, **identical across Step 1 and Step 2** — only its state advances and the active sub-tab changes. Three rows:

**Row 1 — identity & status**
- Left: **Fund name** (15px/500) + **ABN** (12px tertiary).
- Right: **token/cost** (`$1.03 · 248k tok`, 12px tertiary) + **status pill** (semantic; e.g. amber "Pending processor").

**Row 2 — workflow timeline** (the orientation spine; see §4.1).

**Row 3 — secondary tab nav** (content tabs for the current step; underline-active in primary green).

Hairline divider separates the band from the content canvas below.

### 4.1 Workflow timeline component (`WorkflowTimeline`)

A horizontal, full-width 4-stage strip. **This replaces the old 2-dot stepper** — it's richer (distinguishes AI stages from human gates) and doubles as the live progress indicator. Build it as a small custom flex component (Mantine's `Timeline` is vertical; `Stepper` styles differ — a ~40-line custom component matches the widgets better).

**The four stages** (left→right), each = a circular node (26px) + a two-line label (title 12px/500, owner/state 10px), connected by a 1.5px line:

| # | Title | Owner | Icon | Maps to job status |
|---|---|---|---|---|
| 1 | Classify | AI processor | `ti-robot` (active) / `ti-check` (done) | `processing_docs` |
| 2 | Your sign-off | you | `ti-user-check` | `pending_processor_review` |
| 3 | Reconcile | AI reviewer | `ti-robot` / `ti-check` | `processing_review` |
| 4 | Final sign-off | you | `ti-rosette` | `pending_reviewer_approval` → `completed` |

**Node states & exact styling (match widgets):**
- **Done:** solid `#00AF5A` fill, white `ti-check` icon. Connector *after* it = solid `#00AF5A`.
- **In progress (current):** light green fill (`success-tint`), `1.5px #00AF5A` ring, green icon; label title + sub-label in green (e.g. *"in progress · you"* or *"AI reviewer"*). Connector after = hairline neutral.
- **Upcoming:** neutral secondary fill, muted/tertiary icon, whole node `opacity: .5`. Connector = hairline neutral.
- **Failed** (`status:"failed"`): the active stage turns **danger red** fill/ring with `ti-alert-triangle`; downstream stays muted.

**Behaviour:**
- During an AI stage (Classify/Reconcile running), the in-progress node shows a **subtle pulsing ring** and may surface the live `progress_percent`.
- A small legend (done / in progress / upcoming · AI vs you) can sit once on the Audits home or be omitted in-workspace.

**Placement is fixed:** always Row 2 of the persistent header, full width, above the sub-tabs — so it never moves between Documents and Data Intelligence screens.

---

## 5. Sidebar (decluttered, dark)

`#151B2D`, ~158–200px, flat — no inner boxed widgets:

- **Brand** (small mark + "Orchestrator").
- **"New audit"** outline button → opens fund + playbook pickers (this is where the old always-on config form goes).
- **AUDITS** — flat job list: each row = fund name (one line). Active job = subtle `rgba(255,255,255,.1)` bg + `2px #00AF5A` left accent; others muted white. Generous row spacing, no per-row boxes.
- **Footer** — faint "Connected · grok-4.20" engine status + (optional) fund cost total.

Mantine: `AppShell.Navbar` with `NavLink`s (custom dark styling).

---

## 6. Content area & screens (unified, parity-complete)

Workspace = canvas (`#F7F8FA`) holding white panels with generous padding, separated by whitespace. A **persistent bottom action bar** (white, hairline top) holds notes + the primary action. Line refs point to current `templates/index.html` for parity. (Full API shapes in Appendix A.)

### 6.1 Step 1 — secondary tabs: **Documents** · **Playbook**

**Documents (default):** full-width **classified documents table** ← `job.files[]` (two shapes by stage — Appendix B). Columns: Document (PDF link), Category, Amount, Status. Calm styling: hairline row dividers, no card border; **rows needing review get a soft amber row-tint** and a "Review" link; approved rows show a quiet green "Approved". (`renderDocumentsTable` 2713)
- **Override** (only `pending_processor_review`) → Mantine `Modal`: category `Select` + account/amount/date/notes; edits batched client-side until sign-off. (3637/3680)
- **Unprocessed errors** ← `job.unprocessed_files[]` listed below the table. (2777)
- **Action bar:** processor notes `Textarea` + **Approve & continue** → `POST /api/jobs/:id/processor-review {files, processor_notes}`. (3695)

**Playbook (tab):** per-category keyword editor ← `fund.keywords[job_type]`; Save → `POST /api/funds`. Moved to its own tab so it doesn't crowd the doc review. (3566/3606)

### 6.2 Step 2 — secondary tabs: **Reconciliation & queries** · **Lead schedules** · **Compliance** · **Agent logs**

**Reconciliation & queries (default, unified):**
- **Metric strip** — ONE white panel, 5 stats divided by hairlines (not 5 cards): Transactions / Matched / Unmatched / Queries / Exceptions ← `phase2_context.summary` + queries + auditor_notes. (`renderKpiStrip` 3272)
- **Two-column grid (`gap:16px`):**
  - **Bank reconciliation** ← `phase2_context.reconciliation_results`: account + transaction rows (date, description, matched/unmatched mark via `ti-check`/`ti-help-circle`). Account switch via compact list/`Accordion`. (`renderReconciliation` 3138)
  - **Client queries** ← `phase2_context.queries[]`: clean rows with a status dot (pending amber / sent green muted), category, txn count, "Open". Selecting opens the editable query (Mantine `Modal` or detail panel) → Send/Dismiss. (3323/3353)
- **Action bar:** reviewer notes `Textarea` + **Regroup queries** (secondary) + **Complete & sign off** → `POST /api/jobs/:id/reviewer-review`. (3723)
- Query actions: Send → `POST /api/jobs/:id/queries/:qid/status {status:"sent", query_text}`; Dismiss → `{status:"dismissed"}` (with confirm). Regroup → `POST /api/jobs/:id/regroup-queries`.

**Lead schedules (tab):** ← `job.results` — Cash (`cash_reconciliation`), Securities (`portfolio_reconciliation.totals` + `mxt_reconciliation` + `distribution_check`), Tax (`tax_reconciliation`), Member TSB (`member_reconciliation`). Calm tables + a small summary-card row for securities totals; MXT variance shown as an inline amber note. (2969/3032/3078/3106/3129)

**Compliance (tab):** grouped **checklist** ← `results.checklist`; **notes board** ← `processor_notes` / `reviewer_notes` / `auditor_notes[]`. (2920/2882)

**Agent logs (tab):** dark log terminal ← `job.logs[]` (level-colored, auto-scroll). (2846) *(The pipeline progress is already in the persistent header timeline, so this tab is just the raw log.)*

### 6.3 Audits home
Header ("Audits" + "New audit"); a muted summary line; **"Awaiting your review"** section (rows with amber dot, fund, step description, role pill, time, chevron) then **"Recent"** (muted, with cost + completed pill). Hairline dividers, no boxes.

---

## 7. Realtime, state & gating (behaviour preserved)

- **Polling (TanStack Query):** active job every **3s** while `processing_docs`/`processing_review`; jobs list every **10s**. `refetchInterval` keyed on status.
- **Timeline reflects status** per §4.1 mapping — it's the single live progress surface.
- **Phase gating:** override + processor sign-off only in `pending_processor_review`; reviewer sign-off only in `pending_reviewer_approval`; PDF `phase` = `staging` before approval, `workpaper` after. Step-2 tabs show a "running…" state (driven by the header timeline) while `processing_review`.
- **Loading** = Mantine `Skeleton`; **errors** = `notifications.show` + inline message (no silent failures); **empty** = quiet centered text ("No exceptions found. Ledger is clean.").

---

## 8. Data model gotchas (encode once in `api/types.ts`)

- `job.files[]` is a **discriminated union** by stage: `{…reasoning}` (pending) vs `{…notes, status:"Approved"}` (approved).
- `amount` is a **string** (`"270.41"`); `date` is `"30.06.25"`; `created_at` is space-separated (not ISO).
- `results`, `phase2_context`, `token_usage` are **optional/null** before Phase 2 — guard every consumer.
- Query transactions are a **union** (`TxnEnriched | TxnSimple`); sub-query txns are the simple shape with pre-formatted `amount`.
- `POST /api/funds` is **overloaded** (register fund / save playbook) — wrap in two intent hooks.

---

## 9. Mantine component map (assemble, don't build)

| Need | Mantine |
|---|---|
| Shell (sidebar + header + main) | `AppShell` |
| Persistent workflow timeline | **custom** `WorkflowTimeline` (flex; ~40 lines) |
| Secondary tabs | `Tabs` (Step 1: Documents/Playbook; Step 2: 4 tabs) |
| Tables (docs, recon, schedules, checklist) | `Table` + `ScrollArea` |
| Status pills / role pills | `Badge` |
| Override / Send-query / New-audit | `Modal` |
| Notes | `Textarea` |
| Confirm dismiss / sign-off | `modals.openConfirmModal` |
| Toasts | `notifications` |
| Recon account groups | `Accordion` |
| Loading / empty | `Skeleton` / custom `EmptyState` |

---

## 10. Build order (loose — always runnable)

1. **Scaffold** — Vite + React + TS + Mantine, theme (§3), `/api` proxy, typed `api.ts`, QueryClient.
2. **Shell + persistent header** — AppShell, dark sidebar + job list, header band (identity + status + cost) + `WorkflowTimeline` + sub-tab nav. Browse existing jobs; timeline reflects live status.
3. **Audits home** — awaiting/recent lists, New-audit modal → `POST /api/jobs/create`.
4. **Step 1** — Documents table + override modal + processor action bar; Playbook tab.
5. **Step 2** — metric strip + reconciliation/queries grid + query modal; Lead schedules / Compliance / Agent logs tabs; reviewer action bar.
6. **Polish** — loading/empty/error states, notifications, theme pass.

Old `index.html` stays live; new SPA runs on `:5173` until cutover.

---

## Appendix A — API endpoints (contract; unchanged)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/funds` | List funds |
| POST | `/api/funds` | Upsert fund (register / save playbook) |
| GET | `/api/funds/discover` | Unregistered `data/` folders |
| POST | `/api/funds/bootstrap` | LLM-propose fund configs `{folders}` |
| GET | `/api/funds/:fund_id/cost-summary` | Aggregate cost across fund's jobs |
| GET | `/api/jobs` | List jobs (newest first) |
| POST | `/api/jobs/create` | Create job + start Phase 1 `{fund_id, job_type}` |
| GET | `/api/jobs/:id/details` | Full job record (poll target) |
| POST | `/api/jobs/:id/processor-review` | Processor sign-off → Phase 2 `{files, processor_notes}` |
| POST | `/api/jobs/:id/reviewer-review` | Reviewer sign-off → complete `{reviewer_notes}` |
| GET | `/api/jobs/:id/reconciliation` | Phase 2 results/queries/summary |
| POST | `/api/jobs/:id/queries/:queryId/status` | Send/dismiss query `{status, query_text}` |
| POST | `/api/jobs/:id/regroup-queries` | Re-cluster queries |
| GET | `/api/jobs/:id/token-usage` | Per-job token/cost (`available` flag) |
| GET | `/api/jobs/:id/file/:phase/:filename` | Stream PDF (`phase` = staging\|workpaper) |
| — | `/api/process`, `/api/progress/:id`, `/api/results/:id`, `/api/workpaper-files/...` | **Legacy** — ignore |

## Appendix B — Job status → UI mapping

| Status | Status pill | Timeline active node | Step 1 | Step 2 | Poll |
|---|---|---|---|---|---|
| `processing_docs` | Processing docs (info) | 1 Classify (pulsing) | progress, read-only | running | 3s |
| `pending_processor_review` | Pending processor (warning) | 2 Your sign-off | **override + approve** | running | off |
| `processing_review` | Processing review (info) | 3 Reconcile (pulsing) | approved, read-only | progress, read-only | 3s |
| `pending_reviewer_approval` | Pending reviewer (warning) | 4 Final sign-off | approved, read-only | **complete & sign off** | off |
| `completed` | Completed (success) | all done | read-only | read-only | off |
| `failed` | Failed (danger) | active node red | failure + logs | failure + logs | off |

**File shapes:** *pending* → `{original_name, classified_name, category, account_number, amount, date, reasoning}`; *approved* → same minus `reasoning`, plus `notes` + `status:"Approved"`.

---

## Appendix C — Layout reference (from approved wireframes)

The visual reference is the set of approved widget mockups in this conversation:
- **Audits home** — calm awaiting/recent lists, no sidebar density.
- **Unified Step 1** — dark decluttered sidebar + flattened documents table + bottom action bar.
- **Unified Step 2** — metric strip + reconciliation/queries two-column grid under secondary tabs.
- **Persistent workflow timeline** — 4-stage strip in the header, shown identical across both screens; colors (`#00AF5A` done/active, neutral upcoming) and placement (Row 2 of header, above sub-tabs) are authoritative.
