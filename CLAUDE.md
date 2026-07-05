# Project conventions

## Project map

Read this section first, in every session, before exploring the repo. It exists so a
fresh session can answer follow-ups without re-scanning the codebase. Keep it in sync
when architecture changes; keep session-specific status (what's in flight, what's next)
out of here — that lives in `docs/SESSION_HANDOFF.md` (see below).

**What this is:** "SMSF Document Intelligence v2" — Flask backend + React/Vite SPA that
classifies SMSF audit/accounting documents (Phase 1), then reconciles bank statements
against supporting documents and generates client queries (Phase 2). Uses an LLM via
OpenRouter and OCR via `pdftoppm` + `tesseract`.

**Run/verify:** use the `run-doc-intelligence-v2` skill. `.claude/launch.json` defines
`smsf-app` (backend, port 5001) and `frontend` (Vite, port 5173).

**Backend — key files:**
- `app.py` — Flask routes/orchestration; playbook load/save/resolve
  (`load_playbook`/`save_playbook`/`resolve_playbook`); `api_processor_review` is the
  human-approval step for Phase-1 classifications.
- `core_engine.py` — the engine; classification (`classify_papers`) and reconciliation
  (`run_bank_reconciliation_phase`) logic lives here. Most fixes land in this file.
- `classify_workpapers.py` — standalone CLI that **mirrors** the classification prompt in
  `core_engine.py` — keep the two in sync when editing the prompt.
- `playbook_config.json` — the classification taxonomy + per-category scope prose
  (authoritative; two job types: `Accounting_Audit` full taxonomy, `Accounting` subset).
- `transaction_categories.json` — Phase-2 transaction category taxonomy for query grouping.
- `funds_config.json`, `models_config.json` — fund and LLM model configuration.
- `jobs_db.json` — runtime job state; never commit.

**Frontend — key files** (`frontend/src/`):
- `App.tsx` — top-level routing/shell.
- `components/Home.tsx`, `Sidebar.tsx`, `WorkspaceHeader.tsx`, `NewAuditModal.tsx`,
  `FundDiscoveryBanner.tsx` — landing/navigation shell.
- `components/workspace/ReconciliationScreen.tsx` — Phase-2 reconciliation UI.
- `components/workspace/WorkpapersScreen.tsx`, `PlaybookDrawer.tsx`, `FundTotals.tsx` —
  Phase-1 workpapers review UI.
- `api/client.ts`, `api/hooks.ts`, `api/types.ts`, `api/format.ts` — API layer; `types.ts`
  holds shared shapes like `ReconTxn`/`ReconAccount`.
- Theme: Teal Graphite palette, charcoal sidebar, amber accents (see `global.css`).

**Pipeline shape:** Phase 1 = classify + rename/split files → human approval. Phase 2 =
bank reconciliation (extract → match → transfer-linking → tie-out) + checklist + client
queries.

**Where to find "why"**: this repo has a lot of fix docs (see `docs/*_FIX.md` and
`docs/*_RCA.md` below, plus `FINDINGS.md` for trivial ones). If behavior looks
intentional-but-odd, check there before "fixing" it — it's likely a deliberate decision
from a prior RCA.

**Current session status:** see `docs/SESSION_HANDOFF.md` if present — it's the one
living handoff doc, updated (not replaced) at the end of each session with what's done,
what's in flight, and the next open task. Topic-specific `_FIX.md`/`_RCA.md` docs are
permanent history; the handoff doc is the current pointer into that history.

## Session handoff protocol

`docs/SESSION_HANDOFF.md` is a living continuity doc — different sessions may be working
on different things and writing to it around the same time. Structure and edit it so that
never happens:

- **Structure:** an `## Index` table at the top (workstream, status, last-updated), then
  one `##` section per workstream, keyed by area/topic name (e.g. "Reconciliation
  hardening", "Classification playbook") — not by date or session.
- **Starting a workstream that doesn't exist yet:** add a new section + index row. Don't
  touch other sections.
- **Continuing an existing workstream:** find its section by name and append a dated
  `### Update <date>` block rather than rewriting the section wholesale. This is the rule
  that prevents one session from silently erasing another's still-incomplete task list —
  even a session that only partially understands where a workstream stands should never
  need to overwrite prior content to add its own.
- **Closing a workstream:** set its index status to `Done`. Only condense the section body
  once the durable detail has been captured in its own `docs/<AREA>_FIX.md`/`_RCA.md` (see
  below) — the handoff doc should stay lean, but never at the cost of an unresolved
  thread. If a "done" workstream still has deferred sub-decisions, keep those listed
  explicitly rather than letting `Done` imply nothing is left.
- **When to write (there is no session-end hook, so tie it to moments actually visible
  inside the conversation):**
  1. **Right after finishing a workstream-sized chunk of work** — the same moment a
     `_FIX.md`/`_RCA.md` doc would be written per the bug-fix convention below. Update
     that workstream's section then, don't defer it.
  2. **When the user signals a wrap-up or context switch** — "that's it for today," "pick
     this up later," "let's move to X" — update before responding to the switch.
  3. **When explicitly asked** to update the handoff doc.
  Do this automatically at those moments, without being asked each time — same as the
  bug-fix documentation convention below. (Gap: a session that ends abruptly with none of
  the above won't get a final update — there's no way to catch that from inside the
  conversation.)

## Documenting bug fixes

Whenever you fix an issue in this codebase (bug, incorrect classification, threshold tuning, etc.), record it — don't just make the code change silently.

- **Trivial one-liner fix** (typo, obvious off-by-one, no real root cause to explain): add a short entry to `FINDINGS.md` — file:line, what was wrong, what changed.
- **Anything with a root cause worth remembering** (why a threshold was chosen, multiple compounding causes, a fix future-you might accidentally revert): create a new file at `docs/<AREA>_FIX.md` (or `_RCA.md` for root-cause investigations), following the existing pattern in `docs/BANK_STATEMENT_CLASSIFICATION_FIX.md`:

  ```markdown
  # <Short Title>

  ## Problem
  What broke, in which job/file, and the observable bad outcome. Include a concrete example.

  ## Root Cause
  Why it happened — numbered sub-causes if multiple factors compounded.

  ## Fix
  The actual code change(s), with before/after snippets and file:line references.
  ```

Do this automatically, without being asked each time.
