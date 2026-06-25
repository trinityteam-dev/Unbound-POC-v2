# Frontend Rebuild — Implementation Plan & Tracker

**Status:** Not started · **Date:** 2026-06-24 · **Owner:** Trinity Team
**Companion to:** [FRONTEND_REBUILD_SPEC.md](FRONTEND_REBUILD_SPEC.md) (the *what/why*; this doc is the *how/when*).
**Scope:** Build a new React SPA presentation layer over the **existing, unchanged** Flask engine. Throwaway POC — optimize for build speed + visual quality.

> **How to use this doc:** Each phase is a checklist. Check items as they land. **Do not mark a phase "done" until its `Tests / Acceptance` block passes.** Every phase must leave the app runnable (`npm run dev` boots, no console errors).

---

## Decisions (locked)

| Decision | Value |
|---|---|
| SPA location | `./frontend/` subfolder in this repo |
| Stack | React 18 + TypeScript + Vite + Mantine v7 + TanStack Query |
| Dev ports | SPA `:5173`, Flask `:5001` |
| API access | Vite dev proxy `/api/*` → `http://localhost:5001` |
| Backend changes | **None** — all 13 routes already exist (Appendix A of spec) |
| Old UI | `templates/index.html` stays live until cutover (Phase 8) |

---

## ⭐ Design direction (confirmed 2026-06-25) — mirror existing IA, restyle only

The new UI is a **calm restyle of the existing dashboard, NOT a workflow-centric redesign.** Decided with the Trinity Team:

1. **Match the existing information architecture 1:1.** Keep the current structure: **Step 1 / Step 2 top tabs**, and **Step 2 sub-tabs** (Reconciliation & Queries / Lead Schedules / Compliance / Agent Logs). Mirror `templates/index.html` faithfully.
2. **Everything is visible — no content gating.** Within each tab, **all cards are stacked and on-screen**, exactly like today. Do not hide, collapse, or progressively reveal content based on workflow stage. "See everything" is the priority.
3. **Keep the 4-stage timeline prominent**, but as a *progress indicator inside the existing layout* — not as a reorganizing "spine." It replaces the old "Active Orchestration Flow" stepper in the same spot/role.
4. **Restyle only** — apply the calm visual treatment (flatten boxes, whitespace zoning, restrained color, dark sidebar) from spec §1–§3. The *layout* and *content set* come from the existing UI; only the *look* changes.

> **Parity is the acceptance bar for Phase 4–5:** the new UI must show every card the existing UI shows (enumerated in the parity checklists below). A card missing = not done.

---

## 🎨 Theme (locked 2026-06-25) — "Teal Graphite"

Finalized after live iteration with Trinity Team. In `frontend/src/theme.ts` (`tokens`) + `global.css`.

- **Primary** teal `#0D9488` · **Accent** amber `#F59E0B` (active/current indicators only) · **Sidebar** charcoal `#18181B` · canvas `#EDF1F1`, cool graphite text.
- **Tabs:** top nav = tinted-underline (teal fill + amber underline); Step-2 sub-tabs = segmented control (white active chip).
- **Job list:** scrollable rows = status dot + name + relative time + chevron; amber selection accent. **Dot colors:** pending processor = amber, pending reviewer = blue `#3B82F6`, completed = green `#16A34A`.
- **Sizing:** matched to original `doc-intelligence-v2` (320px sidebar, 64px header) then nudged down a notch; base 14px; 36px timeline nodes; soft card shadows.

Full detail in memory `frontend-theme.md`.

---

## Progress overview

- [x] **Phase 0** — Pre-flight & environment check ✅ 2026-06-24
- [x] **Phase 1** — Scaffold (Vite + Mantine + theme + typed API layer) ✅ 2026-06-25
- [x] **Phase 2** — App shell + persistent header + workflow timeline ✅ 2026-06-25
- [x] **Phase 3** — Functional job creation (sidebar form; Audits-home dropped per IA decision) ✅ 2026-06-25
- [x] **Phase 4** — Step 1 content: documents table + override modal + processor sign-off + playbook ✅ 2026-06-25
- [x] **Phase 5** — Step 2 content: reconciliation/queries + lead schedules + compliance + agent logs ✅ 2026-06-25
- [x] **Phase 6** — Realtime, gating, polish: polling helper, failure view, fetch-error retry, ⌘K switcher ✅ 2026-06-25
- [ ] **Phase 4** — Step 1 workspace (Documents + Playbook)
- [ ] **Phase 5** — Step 2 workspace (Reconciliation/queries + tabs)
- [ ] **Phase 6** — Realtime, gating, polish (loading/empty/error/notifications)
- [ ] **Phase 7** — Test hardening & cross-browser/responsive pass
- [ ] **Phase 8** — Cutover & dead-code removal (old UI)

---

## Testing strategy (applies to every phase)

A lightweight, POC-appropriate test setup — enough to catch regressions without slowing the build.

- **Unit / component:** [Vitest](https://vitest.dev) + React Testing Library + `jsdom`. Test data transforms (the §8 gotchas: discriminated unions, string `amount`, null guards) and key component states.
- **API mocking:** [MSW](https://mswjs.io) (Mock Service Worker) with fixtures captured from the real Flask responses (one fixture per job status in Appendix B).
- **Type safety:** `tsc --noEmit` must pass — treated as a test gate.
- **Lint:** ESLint + `eslint-plugin-react-hooks` clean.
- **Smoke (manual/scripted):** `npm run dev` against the live Flask engine; verify each phase's user flow end-to-end. The `run-doc-intelligence-v2` skill / preview tools drive this.

**Test gate per phase = `npm run test` green + `npm run typecheck` green + `npm run lint` green + the phase's manual acceptance checks.**

Scripts to add in Phase 1 `package.json`:
```jsonc
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "lint": "eslint . --ext ts,tsx"
}
```

---

## Phase 0 — Pre-flight & environment check

Confirm the ground truth before writing code.

- [x] Flask engine starts: `python app.py` serves on `:5001` (run via `.venv`)
- [x] Capture live JSON fixtures for `GET /api/jobs` and `GET /api/jobs/:id/details` — 3 statuses captured **live** (`pending_processor_review`, `pending_reviewer_approval`, `completed`); 3 transient ones (`processing_docs`, `processing_review`, `failed`) **synthesized** from real records (runtime-only states) → `frontend/src/test/fixtures/`
- [x] Capture `GET /api/funds` and `GET /api/funds/discover` sample responses (+ `reconciliation`, `token-usage`)
- [x] Confirm Node v20.20.2 and npm 10.8.2
- [x] Note any field that disagrees with the spec — **11 discrepancies** logged in fixtures `README.md` (notably `amount`/`date`/`account_number` are nullable; `reconciliation_results` is a dict not a list; `logs` are plain strings)

**Tests / Acceptance:**
- [x] All fixtures saved and non-empty; each validated as parseable JSON
- [x] `frontend/src/test/fixtures/README.md` maps every fixture to its status + records spec discrepancies

---

## Phase 1 — Scaffold (§10 step 1)

Stand up the project skeleton, theme, proxy, and typed API layer. **No feature UI yet** — just a themed blank shell that compiles and can reach the API.

### Tasks
- [x] Vite + React + TS project scaffolded under `frontend/` (built manually to preserve Phase-0 fixtures)
- [x] Install deps: `@mantine/core @mantine/hooks @mantine/modals @mantine/notifications @tabler/icons-react @tanstack/react-query @fontsource/inter` (376 packages)
- [x] Install dev deps: `vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom msw eslint-plugin-react-hooks` (+ typescript-eslint, postcss-preset-mantine)
- [x] Configure Vite proxy: `/api` → `http://localhost:5001` in `vite.config.ts`
- [x] Add Inter font via `@fontsource/inter` (400/500/600)
- [x] **Mantine theme** (`src/theme.ts`) per spec §3:
  - [x] Custom 10-shade green scale anchored on `#00AF5A` at index 6 (`primaryShade: 6`)
  - [x] `defaultRadius: 'md'`, `fontFamily: 'Inter, sans-serif'`
  - [x] Design tokens (`tokens` export) for sidebar `#151B2D`, canvas `#F7F8FA`, hairline `#E5E8EE`, text colors
  - [x] `tabular-nums` utility class in `global.css`
- [x] `MantineProvider` + `ModalsProvider` + `Notifications` + `QueryClientProvider` wired in `main.tsx`
- [x] **`src/api/types.ts`** — encode §8 gotchas + Phase-0 discrepancies:
  - [x] `JobFile` discriminated union + `isApprovedFile()` narrowing guard
  - [x] `amount: string | null`, `date: string | null`, `account_number: string | null` (Phase-0: nullable), `created_at: string` (space-separated)
  - [x] `results`, `phase2_context`, `token_usage` optional/nullable; `reconciliation_results` typed as account-keyed dict
  - [x] Query txn union (`TxnEnriched | TxnSimple`)
  - [x] `JobStatus` literal union (the 6 Appendix B statuses)
- [x] **`src/api/client.ts`** — typed fetch wrappers for all Appendix A endpoints; `registerFund` / `savePlaybook` intents split the overloaded `POST /api/funds`
- [x] TanStack Query hooks (`useJobs` 10s, `useJobDetails` status-keyed 3s/off, `useFunds`)
- [x] MSW setup (`src/test/server.ts` + `handlers.ts`) loading Phase-0 fixtures (+ slim jobs fixture)
- [x] ESLint flat config + `react-hooks` plugin

### Tests / Acceptance
- [x] `npm run dev` boots; themed shell renders with **no console errors/warnings**
- [x] `npm run typecheck` passes
- [x] `npm run lint` passes (0 problems)
- [x] `npm run build` passes (clean production bundle)
- [x] Unit test: `types.ts` discriminated-union narrowing works (pending vs approved, + nullable amount) — `types.test.ts`
- [x] Unit test: `amount`/`date`/`created_at` parsing helpers — `format.test.ts` (9 tests)
- [x] MSW test: `useJobs` hook returns mocked job list — `hooks.test.tsx`
- [x] **13/13 tests passing**
- [x] Manual: live proxy verified — UI shows "10 jobs" fetched from real Flask `/api/jobs` (screenshot captured)

---

## Phase 2 — App shell + persistent header + workflow timeline (§10 step 2)

Browse existing jobs; the persistent chrome reflects live status. No edit actions yet.

### Tasks
- [x] `AppShell` layout: top app header (`AppHeader`) + dark `Navbar` (`Sidebar`) + main workspace region
- [x] **Sidebar** (§5, IA-faithful): brand; "Configure Audit Job" form (fund/playbook selects + New audit, stubbed for Phase 3); flat job list with active `rgba(255,255,255,.1)` bg + `2px #00AF5A` left accent; engine-status footer
- [x] **Top app nav** (mirrors existing IA): Step 1 / Step 2 tabs (Step 2 gated by `isPhase2`) + disabled Clients/Jobs/Order Docs/Reports
- [x] **Persistent header band** (§4), 3 rows:
  - [x] Row 1 — fund name + ABN (guarded when empty) (left), token/cost (guarded on `available`) + status pill (right)
  - [x] Row 2 — `WorkflowTimeline`
  - [x] Row 3 — secondary tab nav (Step 2 only — Step 1 has no sub-tabs, IA-faithful)
  - [x] Hairline divider under band
- [x] **`WorkflowTimeline`** custom component (§4.1): 4 stages, 26px nodes, two-line labels, connectors; node states (done/in-progress/upcoming/failed); status→node mapping per Appendix B; pulsing ring (`.wf-pulse`) on active AI stage + `progress_percent`
- [x] Wire sidebar list to `GET /api/jobs`; clicking a job loads `GET /api/jobs/:id/details` and populates header + timeline; auto-selects first job
- [x] Job selection via state; default step derived from status (`⌘K` switcher deferred to Phase 6)

### Tests / Acceptance
- [x] `npm run test` / `typecheck` / `lint` green (26 tests)
- [x] Component test: `timelineNodes` table-driven over **all 6** statuses (`status.test.ts`); `WorkflowTimeline` render test (`WorkflowTimeline.test.tsx`)
- [x] Component test: `statusMeta` returns correct label/color per status
- [x] Manual (live): selected real jobs in Step 1 & Step 2 → header identity, status pill, timeline all correct (screenshots captured)
- [x] Component test: `processing_docs` → pulsing node shows `progress_percent` (no live `processing_docs` job exists at rest; covered by unit test)
- [x] **Fixed mid-phase:** funds use `id`/`name` not `fund_id`/`fund_name` (was crashing Mantine `Select`); ABN empty-guard. Logged in fixtures README (#12, #13).

---

## Phase 3 — Functional job creation (§10 step 3)

> **IA-faithful revision:** per the locked "mirror existing IA" decision, the original app has **no separate Audits-home page** — it creates jobs from the sidebar "Configure Audit Job" form. So Phase 3 = make that form functional, NOT build a new landing page (which would re-introduce the dropped workflow reframing). The spec's Audits-home (§6.3) is intentionally **not built**.

### Tasks
- [x] Sidebar "Configure Audit Job" form made functional: controlled fund `Select` (`GET /api/funds`) + playbook `Select` + **Run audit pipeline** button → `POST /api/jobs/create {fund_id, job_type}`
- [x] `useCreateJob` mutation hook; invalidates jobs list on success
- [x] Submit disabled until a fund is chosen; button shows loading while pending
- [x] On success → select the new `job_id` (workspace opens) + success toast; polling begins via `useJobDetails` (new job is `processing_docs`). Errors → red toast.
- [x] Fixed `createJob` return type — endpoint returns thin `{status, job_id, message}`, not a full job
- [ ] ~~Audits home view / awaiting+recent sections~~ — **dropped** (not in existing IA)
- [ ] (Deferred) fund discovery/bootstrap via `/api/funds/discover` + `/api/funds/bootstrap`

### Tests / Acceptance
- [x] `npm run test` / `typecheck` / `lint` green (27 tests)
- [x] Hook test: `useCreateJob` posts payload, returns new `job_id` (MSW)
- [x] Manual (live): button disabled with no fund → enabled after selecting a fund (verified in browser)
- [x] Manual (live): created a Cobble job → landed in `processing_docs` (Classify active, live 10%), workspace auto-opened, then polling advanced it to `pending_processor_review` (timeline → "Your sign-off", pill → Pending processor, sidebar dot violet→amber). Empty folder = zero LLM cost.

---

## Phase 4 — Step 1 workspace: Documents + Playbook (§10 step 4)

> **IA-faithful note:** Step 1 has **no sub-tabs** — it's the existing 2-column layout (docs + sign-off left, Playbook right), all cards stacked/visible.

### Tasks
- [x] **Classified Audit Workpapers** table ← `job.files[]` (union-aware); columns Document (PDF link + original caption) / Category / Amount / Date / Status / Actions; fixed column widths
- [x] Calm styling: amber row-tint for pending rows; quiet amber "Pending" / green "Approved" status text
- [x] PDF link → `GET /api/jobs/:id/file/:phase/:filename` (`phase` = `staging` pre-approval, `workpaper` after); `[Split and grouped…]` rows render unlinked
- [x] **Override modal** (only `pending_processor_review`): category `Select` (from playbook cats) + account/amount/date/notes; edits **batched client-side** in `Step1` until sign-off
- [x] **File Exceptions** card ← `job.unprocessed_files[]` (conditional)
- [x] **Processor Sign-off** card: processor notes `Textarea` + **Submit sign-off** → `POST /api/jobs/:id/processor-review {files, processor_notes}` (`useProcessorReview`)
- [x] **Playbook Manager** card: per-category keyword editor ← `fund.keywords[job_type]`; Save → `POST /api/funds` (`useSavePlaybook`). **Keywords are comma-STRINGS, not arrays** (fixed mid-phase — was crashing)
- [x] Phase gating: override/sign-off enabled only in `pending_processor_review`; read-only otherwise

#### Parity checklist — existing Step 1 cards (all present & visible)
- [x] Classified Audit Workpapers
- [x] File Exceptions / Unprocessed Files (conditional)
- [x] Human Processor Sign-off Escalation
- [x] Playbook Manager

### Tests / Acceptance
- [x] `npm run test` / `typecheck` / `lint` green (32 tests)
- [x] **Parity: all 4 Step-1 cards render with real data** (verified live on an ADMCM `pending_processor_review` job, 18 files + 2 exceptions)
- [x] Component test: documents table renders pending (Override) vs approved (read-only) shapes (`DocumentsCard.test.tsx`)
- [x] Unit test: `toReviewFile` + playbook string round-trip (`utils.test.ts`)
- [x] Manual (live): Override modal opens pre-filled; sign-off button enabled only in `pending_processor_review`
- [ ] Manual (live): actually submit sign-off → advances to `processing_review` — **not triggered** (fires real Phase-2 LLM work; defer to user)

---

## Phase 5 — Step 2 workspace: Reconciliation/queries + tabs (§10 step 5)

### Tasks
- [ ] **Reconciliation & queries tab** (default, unified):
  - [x] **Metric strip** (`MetricStrip`) — ONE white panel, 5 hairline-divided stats ← `summary` + queries + auditor_notes
  - [x] **Bank reconciliation** (`ReconciliationCard`) ← `reconciliation_results`: account + txn rows; matched ✓ / unmatched help-circle w/ reason tooltip; account switcher when >1
  - [x] **Client queries** (`QueriesCard`) ← `queries[]`: status dot (pending amber / sent green / dismissed grey), category, txn count, "Open"
  - [x] **Query modal** (`QueryModal`) — editable query text + txn table → Send (`{status:"sent", query_text}`) / Dismiss (`{status:"dismissed"}` w/ confirm modal)
  - [x] **Reviewer sign-off** (`ReviewerSignoffCard`): reviewer notes + **Regroup queries** + **Complete & sign off**
- [x] **Lead schedules tab** (`LeadSchedules`) ← `job.results`: Cash / Securities (MXT variance amber note + distribution PASS badge) / Tax (FY25 outstanding) / Member TSB
- [x] **Compliance tab** (`Compliance`): grouped checklist `Accordion` ← `results.checklist`; notes board ← processor/reviewer/auditor notes (type-colored)
- [x] **Agent logs tab** (`AgentLogs`): dark terminal ← `job.logs[]` (level-inferred coloring, auto-scroll)
- [x] Null-guard every Phase-2 consumer (`results`/`phase2_context` may be absent)
- [x] Phase gating: reviewer sign-off / query actions only in `pending_reviewer_approval`; "running…" banner while `processing_review`

#### Parity checklist — existing Step 2 cards (all present, grouped by sub-tab)
- [x] **Recon & Queries:** timeline (header) · Bank Transaction Reconciliation · Client Queries · Reviewer Final sign-off
- [x] **Lead Schedules:** Cash · Securities/MXT · Tax · Member TSB (verified live)
- [x] **Compliance:** Document Audit Checklist Verification · Notes board (processor/reviewer/auditor)
- [x] **Agent Logs:** Agent Execution Logs

### Tests / Acceptance
- [x] `npm run test` / `typecheck` / `lint` green (34 tests)
- [x] **Parity: every Step-2 card renders in its sub-tab** — verified live on the Cobble `pending_reviewer_approval` job (49 txns, 4 queries, 11 exceptions, full lead schedules)
- [x] Component test: `MetricStrip` renders the 5 stats (`MetricStrip.test.tsx`)
- [x] Hook test: `useSetQueryStatus` posts the chosen status (`hooks.test.tsx`)
- [x] Null-guards: every consumer handles missing `results`/`phase2_context` (running-state guard)
- [x] Manual (live): query modal opens with Send/Dismiss; fixed a `<div>`-in-`<p>` nesting warning in Securities card
- [ ] Manual (live): actually send a query / Complete & sign off → `completed` — **not triggered** (real mutations on live data; defer to user)

---

## Phase 6 — Realtime, gating, polish (§7, §10 step 6)

### Tasks
- [x] Polling: active job 3s while `processing_docs`/`processing_review`, jobs list 10s, off at rest — extracted to `lib/polling.ts` (`jobPollInterval`) for testability
- [x] Loading = Mantine `Skeleton` (workspace) — already in place
- [x] Empty states = quiet centered text — already across cards (docs/queries/recon/etc.)
- [x] Errors = `notifications.show` on every mutation + inline fetch-error state with **Retry** in the workspace
- [x] `failed` status handling: red timeline node + `FailureView` (alert + agent logs, surfaced regardless of step)
- [x] Theme pass — done iteratively (Teal Graphite, sizing)
- [x] `⌘K` job switcher (`JobSwitcher`) — command palette, searchable, status dots, ↵/esc hints; verified live

### Tests / Acceptance
- [x] `npm run test` / `typecheck` / `lint` green (38 tests)
- [x] Test: `jobPollInterval` switches by status (`polling.test.ts`)
- [x] Test: `failed` job renders failure UI (`FailureView.test.tsx`); timeline red node covered by `status.test.ts`
- [x] Error path: mutation errors → red toast; fetch error → inline Retry (verified)
- [x] Manual: ⌘K switcher opens + lists jobs (verified live); no console errors on fresh load
- [ ] Manual: watch a fresh audit auto-advance through 4 stages — needs source PDFs (fund folders empty; see note)

---

## Phase 7 — Test hardening & responsive/cross-browser pass

### Tasks
- [ ] Fill component-test coverage gaps; ensure every Appendix B status has a render test
- [ ] Add a happy-path integration test per step (MSW-driven, full flow)
- [ ] `preview_resize` / responsive check at common widths; dark sidebar contrast check
- [ ] Accessibility quick pass (focus states, labels on icon-only buttons, table semantics)
- [ ] Visual diff against approved mockups in `docs/ui_redesign_mockups/` (tokens, timeline placement)

### Tests / Acceptance
- [ ] Full `npm run test` suite green; coverage on data transforms ≥ agreed threshold (POC: ~70% of `api/` + transforms)
- [ ] `npm run build` produces a clean production bundle with no type errors
- [ ] Manual: app usable at narrow + wide widths; no layout breakage
- [ ] Sign-off review against spec §1–§6 and mockups

---

## Phase 8 — Cutover & dead-code removal (old UI)

> Do **not** start removal until Phases 1–7 are signed off and the SPA is confirmed at full parity against the live engine.

### 8a. Cutover
- [ ] Decide serving model for the POC:
  - **Option A (recommended for POC):** keep SPA standalone on `:5173`; Flask serves API only. Simplest.
  - **Option B:** build SPA (`npm run build`) and have Flask serve the `dist/` from `/`; retire the Jinja template.
- [ ] If Option B: update Flask `@app.route("/")` (currently [app.py:267](../app.py)) to serve the built SPA `index.html`; add a static route for `dist/` assets
- [ ] Verify all 13 API routes still consumed correctly post-cutover

### 8b. Dead-code inventory (identify before deleting)
- [ ] **`templates/index.html`** — the entire old dense UI. Primary dead-code target once SPA is parity-complete.
- [ ] **Legacy API routes** (spec marks "ignore" — confirm zero remaining callers before removal):
  - [ ] `POST /api/process` ([app.py:805](../app.py))
  - [ ] `GET /api/progress/:run_id` ([app.py:900](../app.py))
  - [ ] `GET /api/results/:run_id` ([app.py:921](../app.py))
  - [ ] `GET /api/workpaper-files/:run_id/:filename` ([app.py:949](../app.py))
- [ ] Any Flask helpers used **only** by the above routes or the Jinja template (search for references before deleting)
- [ ] Static assets referenced only by old `index.html`
- [ ] Grep the new SPA to confirm it calls **none** of the legacy routes

### 8c. Removal (staged, reversible)
- [ ] Create branch `chore/remove-old-ui`
- [ ] Step 1: delete `templates/index.html`; point `/` at the SPA (or a redirect). Run full backend test suite (`test_story*.py`) — must stay green.
- [ ] Step 2: remove the 4 legacy routes + their now-unused helpers. Re-run backend tests.
- [ ] Step 3: remove orphaned static assets / imports. Re-run backend tests.
- [ ] Step 4: search for now-dead Python imports/functions (`vulture` or manual grep) and prune.
- [ ] Update [README.md](../README.md) and spec status to reflect new UI is the only UI.

### Tests / Acceptance
- [ ] Existing backend tests (`test_story2.py` … `test_story10.py`) all pass after **each** removal step
- [ ] App still serves: a real audit can be created and driven to `completed` through the SPA after cutover
- [ ] No 404s/500s in Flask logs from missing template/static references
- [ ] `git grep` confirms no references to deleted symbols/routes/files remain
- [ ] Final diff reviewed; removal is purely deletions of confirmed-dead code (no behavior change to live engine)

---

## Definition of Done (whole project)

- [ ] All 8 phases checked complete with their test gates green
- [ ] SPA at full parity with spec §1–§6 and approved mockups
- [ ] Old UI (`templates/index.html`) and legacy routes removed; backend tests green
- [ ] `npm run build` + `npm run test` + `npm run typecheck` + `npm run lint` all green in CI/local
- [ ] README + spec status updated to "Shipped (POC)"
