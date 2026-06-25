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

### Tasks
- [ ] **Documents tab** (default): full-width classified documents table ← `job.files[]` (handle both union shapes); columns Document (PDF link) / Category / Amount / Status
- [ ] Calm styling: hairline row dividers, amber row-tint for rows needing review + "Review" link; quiet green "Approved" for approved rows
- [ ] PDF link → `GET /api/jobs/:id/file/:phase/:filename` (`phase` = `staging` pre-approval, `workpaper` after)
- [ ] **Override modal** (only `pending_processor_review`): category `Select` + account/amount/date/notes; edits **batched client-side** until sign-off
- [ ] **Unprocessed errors** list ← `job.unprocessed_files[]` below the table
- [ ] **Action bar** (persistent bottom, white, hairline top): processor notes `Textarea` + **Approve & continue** → `POST /api/jobs/:id/processor-review {files, processor_notes}`
- [ ] **Playbook tab**: per-category keyword editor ← `fund.keywords[job_type]`; Save → `POST /api/funds` (savePlaybook intent)
- [ ] Phase gating: override/approve enabled only in `pending_processor_review`; read-only otherwise

#### Parity checklist — existing Step 1 cards (all must be present & visible)
- [ ] Classified Audit Workpapers ([index.html:1756](../templates/index.html))
- [ ] Unprocessed Files (conditional, when `unprocessed_files[]` non-empty) ([:1780](../templates/index.html))
- [ ] Human Processor Sign-off Escalation ([:1801](../templates/index.html))
- [ ] Playbook Manager ([:1819](../templates/index.html))

### Tests / Acceptance
- [ ] `npm run test` / `typecheck` / `lint` green
- [ ] **Parity: all 4 existing Step-1 cards render** (no content hidden)
- [ ] Component test: documents table renders pending vs approved file shapes correctly
- [ ] Component test: override edits batch client-side and submit as a single `files` payload
- [ ] Component test: action bar hidden/disabled when status ≠ `pending_processor_review`
- [ ] Component test: Playbook save calls `POST /api/funds` with the playbook intent shape
- [ ] Manual (live): open a `pending_processor_review` job → override a doc → Approve & continue → job advances to `processing_review`, timeline moves to stage 3

---

## Phase 5 — Step 2 workspace: Reconciliation/queries + tabs (§10 step 5)

### Tasks
- [ ] **Reconciliation & queries tab** (default, unified):
  - [ ] **Metric strip** — ONE white panel, 5 hairline-divided stats (Transactions / Matched / Unmatched / Queries / Exceptions) ← `phase2_context.summary` + queries + auditor_notes
  - [ ] **Bank reconciliation** (left col) ← `phase2_context.reconciliation_results`: account + txn rows (date, description, matched/unmatched mark); account switch via compact list/`Accordion`
  - [ ] **Client queries** (right col) ← `phase2_context.queries[]`: rows with status dot (pending amber / sent green), category, txn count, "Open"
  - [ ] Query detail modal/panel → Send (`POST …/queries/:qid/status {status:"sent", query_text}`) / Dismiss (`{status:"dismissed"}` w/ confirm)
  - [ ] **Action bar**: reviewer notes `Textarea` + **Regroup queries** (`POST …/regroup-queries`) + **Complete & sign off** (`POST …/reviewer-review`)
- [ ] **Lead schedules tab** ← `job.results`: Cash / Securities (totals + MXT variance amber note + distribution check) / Tax / Member TSB
- [ ] **Compliance tab**: grouped checklist ← `results.checklist`; notes board ← processor/reviewer/auditor notes
- [ ] **Agent logs tab**: dark log terminal ← `job.logs[]` (level-colored, auto-scroll)
- [ ] Null-guard every Phase-2 consumer (`results`/`phase2_context` may be absent)
- [ ] Phase gating: reviewer sign-off only in `pending_reviewer_approval`; "running…" state while `processing_review`

#### Parity checklist — existing Step 2 cards (all must be present & visible, grouped by sub-tab)
- [ ] **Recon & Queries:** Active Orchestration Flow (now the timeline) · Bank Transaction Reconciliation + Query rail/Groups · Human Auditor & Reviewer Final sign-off ([:1862/1907/1939](../templates/index.html))
- [ ] **Lead Schedules:** Cash Lead Schedule · Cash Verification Checks · Securities Portfolio Valuation · MXT Registry Check · ATO Tax Reconciliation Ledger · Member TSB ([:1956–2040](../templates/index.html))
- [ ] **Compliance:** Document Audit Checklist Verification · Notes board (Processor Escalation / AI Reviewer / Auditor Exceptions) ([:2072/2093](../templates/index.html))
- [ ] **Agent Logs:** Agent Execution Logs ([:2112](../templates/index.html))

### Tests / Acceptance
- [ ] `npm run test` / `typecheck` / `lint` green
- [ ] **Parity: every existing Step-2 card renders in its sub-tab** (no content hidden)
- [ ] Component test: metric strip computes 5 stats correctly from fixture
- [ ] Component test: reconciliation renders matched/unmatched marks; account switching works
- [ ] Component test: query Send/Dismiss call correct endpoints with correct payloads; Dismiss shows confirm
- [ ] Component test: Step-2 tabs show "running…" when `processing_review` and data when `pending_reviewer_approval`
- [ ] Component test: all Phase-2 consumers handle `null`/missing data without crashing
- [ ] Manual (live): open a `pending_reviewer_approval` job → send a query → Complete & sign off → job → `completed`, timeline all-done

---

## Phase 6 — Realtime, gating, polish (§7, §10 step 6)

### Tasks
- [ ] Polling: active job every **3s** while `processing_docs`/`processing_review`; jobs list every **10s**; `refetchInterval` keyed on status; stop polling at rest states
- [ ] Loading = Mantine `Skeleton` across tables/panels
- [ ] Empty states = quiet centered text ("No exceptions found. Ledger is clean.")
- [ ] Errors = `notifications.show` + inline message (no silent failures)
- [ ] `failed` status handling: red active node + failure/logs surfacing on both steps
- [ ] Theme pass: whitespace zoning (16–22px), hairline dividers, restrained color audit per §1–§3
- [ ] `⌘K` job switcher functional

### Tests / Acceptance
- [ ] `npm run test` / `typecheck` / `lint` green
- [ ] Test: polling interval switches correctly as status changes (mock timers)
- [ ] Test: error path triggers a notification and inline message
- [ ] Test: `failed` job renders red node + failure UI
- [ ] Manual: start a fresh audit and watch it auto-advance through all 4 stages via polling, no manual refresh

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
