# Job Workspace Layout Spec — v2 (Job-Driven, Calm Frame)

**Status:** Design direction locked (mockup-reviewed) · awaiting real-code build
**Date:** 2026-06-26 · **Owner:** Trinity Team
**Supersedes the header/nav/sidebar layout in:** [`FRONTEND_REBUILD_SPEC.md`](FRONTEND_REBUILD_SPEC.md) §4–§6 and [`STORY9_STEP2_UI_REDESIGN.md`](STORY9_STEP2_UI_REDESIGN.md)
**Nature:** Throwaway POC presentation layer over the **unchanged Flask engine**. Optimise for build speed + visual quality.

> This document is the build guide for the **finalized job-workspace layout**. It was converged through ~12 interactive mockup iterations. It records both the agreed design **and the directions that were explicitly rejected**, so a future session does not re-litigate them.

---

## 0. TL;DR — the five load-bearing decisions

1. **Phase is driven by the job, not a toggle.** A job has exactly one `status`; that status decides whether you see the Step 1 (document) screen or the Step 2 (reconciliation) screen. There is **no in-place "Step 1 / Step 2" switch** in the workspace. You move between phases by moving between *jobs* in the sidebar.
2. **One stable frame.** Identity bar → single tab row → (filter rail + content) → footer. These regions **never relocate**. Switching jobs/tabs only swaps content *inside* fixed regions.
3. **The filter rail is filters only** — never navigation. Its shape is stable: a grouped list (`Bank accounts → Views → Client queries`, or `Views → Categories`).
4. **Step 1 output stays reachable from Step 2** as a **read-only `Workpapers` tab**, far-left in the tab row, locked.
5. **Calm = de-boxed.** Flat lists, hairline dividers, whitespace zoning. Chips are reserved for the tab row; the job list, metrics, and sidebar config are **not** boxed.

### Explicitly rejected (do not revisit)
- ❌ In-place Step 1/Step 2 toggle in the workspace header (caused "shifting layout" eye-strain).
- ❌ Vertical navigation rail that changes shape by step (confusing; deep items hard to click).
- ❌ A dedicated boxed **metric strip / KPI tiles** band (too busy; metrics now live as rail counts).
- ❌ Boxed/chip **job rows** with fills + outlines (too many boxes).
- ❌ Bank accounts as horizontal pills ("soap bar") or as bulky two-line rows (pushed queries off-screen).
- ❌ A full 5–6 band stacked header (timeline + step tabs + metrics + sub-tabs + account row).

---

## 1. Interaction model — job-driven phase

`status` → phase → screen. The app already auto-selects the phase from status (see `App.tsx` `isPhase2`); this design removes the manual override entirely.

| `JobStatus` | Phase | Screen shown on select | Editable? |
|---|---|---|---|
| `processing_docs` | 0 — Processing | Pipeline-progress placeholder (spinner + "N of M files processed") | — |
| `pending_processor_review` | 1 — Doc intel | **Workpapers** (classified documents) + Playbook button | Yes (processor) |
| `processing_review` | 1.5 — Reconciling | "AI reviewer is reconciling…" banner over Step 2 shell | Read-only |
| `pending_reviewer_approval` | 2 — Orchestration | **Reconciliation** (default) + Workpapers (read-only) + Lead/Compliance/Logs | Yes (reviewer) |
| `completed` | 3 — Completed | Same as phase 2, **read-only**, footer shows "Completed · approved" | No |
| `failed` | — | Failure view (unchanged from current `FailureView`) | — |

- Selecting a job in the sidebar loads its phase screen and resets sub-state (`sub` → phase default, `acct` → first, filter → `all`).
- The current phase is shown as **quiet info** next to the ABN: `Step 2 · Orchestration` — never as a control.

---

## 2. Frame anatomy

```
┌───────────────────────────────────────────────────────────────────┐
│ App top bar (36px): ✓ BeFree            [☾/☀ theme]  [avatar]       │
├──────────────┬────────────────────────────────────────────────────┤
│  SIDEBAR     │  DETAILS PANE  (rounded, teal accent border)        │
│ (charcoal,   │ ┌────────────────────────────────────────────────┐ │
│  rounded)    │ │ Identity bar: Fund · ABN · phase   $cost [Playbk] [pill] │
│              │ ├────────────────────────────────────────────────┤ │
│ + New audit  │ │ Tab row (single line, chips/underline):         │ │
│ ─────        │ │   Workpapers │ Reconciliation · Lead · Comp · Logs │
│ JOB EXEC ·13 │ ├──────────────┬─────────────────────────────────┤ │
│ • job        │ │ FILTER RAIL  │ CONTENT                          │ │
│ • job (active│ │ (filters     │  [inline query draft / banner]   │ │
│ • job        │ │  only)       │  title · count                   │ │
│   …scrolls…  │ │              │  table (recon / documents)       │ │
│              │ │              │                                  │ │
│ ──────────── │ ├──────────────┴─────────────────────────────────┤ │
│ ● Engine·grok│ │ FOOTER: persistent job action (sign-off)         │ │
└──────────────┴─┴────────────────────────────────────────────────┴─┘
```

- **Two columns** separated by a small gutter (~6px) showing the canvas. The **details pane is a rounded panel (`radius 12px`) with a teal accent border (`--ab`)**; the sidebar is a charcoal rounded panel with a hairline border. This is the "clear accented rounded seam" between panes.
- Both panels are **full height of the shell**; their footers (`Engine · grok` on the left, sign-off on the right) are **pinned to the bottom and aligned on the same baseline**. The job list scrolls between the header and the pinned engine line — the engine never drifts.

---

## 3. Sidebar (`Sidebar.tsx`)

De-boxed. Charcoal (`--pn`), rounded panel.

1. **`＋ New audit job`** — a single quiet text+icon row at the top (teal `＋`). Replaces the always-on fund/playbook/run config form; that form opens on demand (modal or inline expand) when clicked. *(Rationale: the config block was "too many boxes" and stole space from the job list.)*
2. **Hairline divider.**
3. **`JOB EXECUTIONS · {n}`** section label (uppercase, faint) + a refresh icon on the right.
4. **Job list** — the scrollable region (`flex:1; overflow-y:auto`), **boxless**:
   - Each row = **status dot + fund name**. No timestamp, no status text, no chevron-always, **no fill, no outline**.
   - **Active job:** name turns **teal + weight 500**, with a **thin amber left edge tick** (`border-left:2px`). No background fill.
   - **Hover:** name brightens to `--i1`; a right chevron fades in. No background block.
   - Status is encoded by **dot colour** (see §8). Full status label shows in the identity bar when selected.
   - **Scrollbar:** thin, translucent, accent-coloured thumb (`--sc`), transparent track. Applies to all scroll regions.
5. **Connected engine** — **pinned to the bottom**, single line: `● Engine · grok-4.20` (dot = `--gr`), with a hairline top border. Aligned to the same baseline as the details-pane footer.

> Status dots in the list: `Pending reviewer`→amber, `Pending processor`→blue, `Processing docs`→teal, `Completed`→green. (Map from `lib/status.ts`.)

---

## 4. Details pane — identity bar

One row, info-only (no tabs here).

- **Left:** `Fund name` (15px/500, truncate) over a sub-line: `ABN {abn} · {phase label}` (11px, muted). The phase label (`Step 2 · Orchestration`) is the **only** place the step is named, and it is not interactive.
- **Right (in order):** token-cost chip (`◆ $4.21 · 1.24M`, coins icon amber) → **`Playbook` button** (violet outline, see §9) → **status pill**.
- **Status pill:** per-state colour, **rounded pill** (`radius 999px`), white text. Keep the distinct colours and the pill shape — these were explicitly liked.

The **process timeline is intentionally demoted** to the inline phase label; there is no separate 5-node stepper band. (Token cost + "where am I" are preserved; the heavy timeline band is gone.)

---

## 5. Tab row (single line, never wraps)

The job's phase determines the tabs. **One row, `flex-wrap: nowrap`.**

| Phase | Tabs (left → right) |
|---|---|
| 1 (doc intel) | `Workpapers` |
| 2 / 3 (orchestration / completed) | `Workpapers` ⟂ `Reconciliation` · `Lead schedules` · `Compliance` · `Agent logs` |
| 0 (processing) | (no tabs — shows `Pipeline progress` label) |

- **`Workpapers` is far-left** to read as the pipeline flow (evidence → reconcile → schedules → compliance → logs), with a **thin vertical divider** (`⟂`) after it separating Step-1 evidence from Step-2 work.
- **Default selected tab in phase 2/3 is `Reconciliation`** (not Workpapers) — the actual task isn't buried.
- In phase 2/3, `Workpapers` is **read-only**: render a **lock icon** before the label.
- Labels are shortened to fit one row in narrow widths: `Reconciliation` (not "Reconciliation & queries" — queries live in the rail and the table title). In the real (wide) app there is ample room; `nowrap` is still enforced.
- Tab styling: underline-on-active (teal text + amber underline) **or** chip — chips are acceptable here (the one place boxes are welcome). Keep it a single consistent treatment.

---

## 6. Filter rail (filters only — stable shape)

Width ~164px, its own scroll region, hairline right border. **Never contains navigation.** Two variants:

### 6a. Reconciliation rail (phase 2/3, `Reconciliation` tab)
```
BANK ACCOUNTS · 3
  CommSec Cash            84     ← slim single line: name + txn count
  Macquarie CMA           61        active = teal bold + amber edge tick
  ANZ V2                  52
  ───────────────────────────   (hairline divider — separates scope from filters)
VIEWS · CommSec Cash
  • All transactions      84     ← counts double as the metrics (no metric band)
  • Matched               12  (green)
  • Unmatched             72  (amber)
CLIENT QUERIES · CommSec Cash
  ● Bank Interest      18/33     ← status dot; "18/33" = on-this-account / fund-total
  ● Broker Settlements     2
  ● Dividends          51/127
  ● ASIC Fees              1
```
- **Bank accounts = slim single-line rows** (name + count). Subtle by default, teal when active. The **full account number** (`062-001 · 4471`) is surfaced in the **content title**, not the rail — keeps the rail slim while losing no data. Header shows the count (`· 3`).
- A **divider** separates `Bank accounts` (scope) from `Views`/`Client queries` (filters within the selected account). The `· {account name}` suffix on the Views/Queries headers reinforces that those filters are **scoped to the selected account**.
- **Views** = `All / Matched / Unmatched` with counts. These counts **are the metrics** — there is no separate KPI band.
- **Client queries** = one row per query (category) with a status dot and count. If a query spans accounts, show `{n-here}/{total}`.
- Selecting any rail item **filters the table** (it does not highlight in place). This guarantees every matching row is on-screen.

### 6b. Workpapers rail (phase 1 editable; phase 2/3 read-only)
```
VIEWS
  • All documents     24
  • Approved          18 (24 when phase≥2)  (green)
  • Pending review     6   (phase 1 only)   (amber)
  • Exceptions         2                      (red)
CATEGORIES
  Bank Statement       5
  Dividend             7
  Contract Note        4
  Invoice              3
  Tax Document         3
  Other                2
```
- Documents are **job-level** (not per-account) — so no account group here. Same flat list styling.

---

## 7. Content area

Order top→bottom: `[inline draft / read-only banner]` → `title · count` → `table` → (footer is separate, §8).

### 7a. Reconciliation table
- Columns: `Date · Description · Amount · Match`. Unmatched rows show the reason as a sub-line; matched = green check, unmatched = amber help-circle (reason in tooltip).
- **Title** = `{filter label} · {full account number} · {account name}` (this is where the account number surfaces). Right side = `Showing X of N`.
- **Inline query draft (replaces `QueryModal.tsx`):** selecting a query renders a draft strip above the table — category + status, an **editable textarea** (pre-filled `query_text`), and `Dismiss` / `Send to client` actions. If the query spans accounts, show an amber note: `18 of 33 transactions are on this account · 15 on others — switch accounts`. **No modal.**

### 7b. Workpapers table
- Columns: `Document · Category · Extracted · Status`. Document name is a teal link (opens the file). Status = `Approved` (green) / `Pending` (amber).
- **Phase 1 (editable):** clicking a pending row opens an **inline override editor** (category / account / amount / date / notes + `Approve & apply`) — replaces `OverrideModal.tsx`. Same "no modal" principle as the query draft.
- **Phase 2/3 (read-only):** show a blue banner — `🔒 Approved during Step 1 · read-only evidence for this reconciliation` — and no override affordance.

### 7c. Other tabs
`Lead schedules`, `Compliance`, `Agent logs` keep their existing content (from current `Step2`/`LeadSchedules`/`Compliance`/`AgentLogs`), rendered inside this same frame. They have **no filter rail** (rail hides; content spans full width).

---

## 8. Footer — persistent job action

Pinned to the bottom of the details pane, aligned with the sidebar's engine line. **Driven by phase, not by the active tab** (so it never changes when you switch tabs):

| Phase | Footer |
|---|---|
| 0 | `Sign-off available once classification completes` (no button) |
| 1 | `Processor sign-off` + **Submit sign-off** |
| 2 | `Reviewer sign-off` + **Approve & complete** |
| 3 | `Completed · reviewer approved {when}` + **Export** (quiet) |

---

## 9. Playbook (fund-level config)

- **Not** a phase tab. It is **fund/job-type configuration shared across Step 1 and Step 2**, reachable in **every phase** via the violet `Playbook` button in the identity bar.
- **Opens as a slide-over drawer** (decided) over the current screen — you never leave the job. Violet accent (`--vi`) to read as configuration, distinct from teal (data) / amber (attention).
- Content = the keyword editor (one input per category) + `Save playbook`. Maps to current `PlaybookCard` + `useSavePlaybook`.

---

## 10. Colour tokens & theming

**The palette must be theme-aware.** Accents (teal `#0D9488`, amber `#F59E0B`, status colours) carry across light/dark; **all structural neutrals and the bright active-teal must swap.** Implement via Mantine `light-dark()` / CSS variables — refactor the hardcoded dark values in `theme.ts` `tokens` into variables so a future theme switcher "just works".

| Token | Role | Dark | Light |
|---|---|---|---|
| `--bg` | app canvas / gutter | `#0e0f12` | `#E7E9ED` |
| `--pn` | sidebar panel | `#18181B` | `#F3F4F6` |
| `--sf` | details surface | `#1C1D21` | `#FFFFFF` |
| `--st` | footer/strip bg | `#16171a` | `#F7F8FA` |
| `--fd` | field/input bg | `#121316` | `#FFFFFF` |
| `--i1` | text primary | `#E7E9EC` | `#1A1C1F` |
| `--i2` | text secondary | `#A6ABB3` | `#52585F` |
| `--i3` | text tertiary | `#71767E` | `#868C94` |
| `--i4` | label faint | `#5b6068` | `#A0A6AD` |
| `--ln` | hairline | `rgba(255,255,255,.07)` | `rgba(0,0,0,.09)` |
| `--l2` | border stronger | `rgba(255,255,255,.12)` | `rgba(0,0,0,.15)` |
| `--tl` | accent teal (text/active) | `#2DD4BF` | `#0D9488` |
| `--tf` | teal fill (buttons) | `#0D9488` | `#0D9488` |
| `--am` | amber (accent/tick/underline) | `#F59E0B` | `#C77C09` |
| `--bl` | blue (processor/banner) | `#60A5FA` | `#2F6FD0` |
| `--gr` | success/matched | `#34D399` | `#16A34A` |
| `--yl` | warn/unmatched | `#FBBF24` | `#B7791F` |
| `--rd` | danger/exceptions | `#F87171` | `#DC2626` |
| `--vi` | violet (playbook/config) | `#b8a6f5` | `#7C3AED` |
| `--hv` | row hover | `rgba(255,255,255,.045)` | `rgba(0,0,0,.04)` |
| `--tn` | teal active tint (rail/accounts) | `rgba(45,212,191,.12)` | `rgba(13,148,136,.10)` |
| `--at` | amber draft tint | `rgba(245,158,11,.06)` | `rgba(245,158,11,.12)` |
| `--ab` | details-pane accent border | `rgba(45,212,191,.45)` | `rgba(13,148,136,.50)` |
| `--sc` | scrollbar thumb | `rgba(45,212,191,.40)` | `rgba(13,148,136,.40)` |

Sidebar text on charcoal uses `--s1/--s2/--s3` (white-alpha in dark; dark greys in light). Status **pills** keep white text on the status colour in both themes (deeper light values give adequate contrast).

**Where colour carries meaning:** teal = data/active, amber = attention/current, blue = processor/read-only evidence, green = matched/approved, red = exceptions, violet = configuration. Everything structural is neutral.

---

## 11. Component mapping (build targets)

| Concern | File | Change |
|---|---|---|
| Shell, phase routing | `App.tsx` | Drive screen from `status`; remove `activeStep` toggle state. |
| Sidebar | `Sidebar.tsx` | Boxless job list (§3), collapse config to `＋ New audit job`, pin engine, accent scrollbar. |
| Top bar | `AppHeader.tsx` | Brand + **theme toggle** + avatar. |
| Identity + tabs + footer | `WorkspaceHeader.tsx` | Identity bar (§4), single tab row (§5), drop the Step 1/2 tab band + metric strip. |
| Workspace shell | `Workspace.tsx` | Rounded accent details pane, rail+content+footer regions, pass phase. |
| Step 1 | `step1/Step1.tsx` | Rail (Views+Categories) + workpapers table + inline override. |
| Step 2 | `step2/Step2.tsx` | Rail (Accounts+Views+Queries) + recon table + inline draft. |
| Reconciliation | `step2/ReconciliationCard.tsx` | Full-width table, account scope from rail, `highlightQuery`→filter. |
| Queries | `step2/QueriesCard.tsx` | Becomes the rail's `Client queries` group. |
| Query modal | `step2/QueryModal.tsx` | **Retire** → inline draft strip. |
| Override modal | `step1/OverrideModal.tsx` | **Retire** → inline override editor. |
| Metrics | `step2/MetricStrip.tsx` | **Retire** → counts live in rail. |
| Playbook | `step1/PlaybookCard.tsx` | Move into a **fund-level drawer**, reachable every phase. |
| Tokens/theme | `theme.ts` | Refactor `tokens` → `light-dark()` / CSS variables per §10. |

---

## 12. Data-model notes (don't get caught by these)

- `reconciliation_results` is a **dict keyed by account number**, not a list (`types.ts`).
- A **client query can span multiple bank accounts**. **Decision:** queries are presented **per-account** in the rail (count shown as `{here}/{total}`), and the inline draft warns when transactions exist on other accounts. *(Alternative considered & not chosen: one fund-wide query object with account-sectioned transactions.)*
- Real volumes (live `jobs_db.json`): up to **3 accounts, ~197 transactions, ~164 unmatched, 4–6 queries** per job — the layout must stay calm at that scale (hence filtering, not highlighting; slim accounts; scoped views).
- `token_usage`, `auditor_notes`, `unprocessed_files` may be null/absent — guard every consumer (already noted in `types.ts`).

---

## 13. Open items to confirm before/while building

- **Job list active affordance** — confirm teal-bold + amber edge tick reads clearly enough in the running app (mockup render was contested). If not, fall back to a subtle full-row tint.
- **Tab styling** — underline vs chip (both acceptable; pick one and apply consistently).
- **`processing_review` (phase 1.5)** — confirm it shows the Step 2 shell with a "reconciling…" banner vs. a simpler progress screen.
- **Account count > 3** (rare for SMSF) — if a fund ever has many accounts, the slim list collapses to a one-line dropdown; not needed for the typical 1–3.

---

## 14. Provenance

Converged over interactive mockups v1→v12 (2026-06-26). Key turning points: master-detail + inline draft (v1–2) → multi-account scoping (v2) → reversed step order + metric tiles (v3) → calm-frame attempts (v3–5) → **job-driven phase, no toggle** (v6) → Step-1-in-Step-2 read-only (v7) → flow order + slim accounts + playbook-as-config (v8–9) → pinned engine + accent seam + theme toggle (v10) → single-row tabs (v11) → **boxless job list** (v12). Earlier static mockups: [`docs/ui_redesign_mockups/`](ui_redesign_mockups/index.html).
