# Fund Discovery Banner Lost in SPA Rewrite (Story 10 Regression)

## Problem
Dropping a new fund folder into `data/` no longer surfaced the "new fund
folder(s) detected — set up now" message. In the legacy Flask UI
(`templates/index.html`, Story 10), loading the page called
`GET /api/funds/discover` and showed a discovery bar with a bootstrap modal
("Scan & Propose Config" → AI extraction → Register). After the React SPA
replaced that UI — and especially once the Home landing page became the
default screen — unregistered folders were silently invisible: e.g. with
`data/The C Squared Super Fund/` present and unregistered, the Home page
showed nothing and the fund never appeared in the New-audit fund dropdown.

## Root Cause
The SPA rewrite ported the API client stub but never the UI. Whole flow was
dead code on the frontend:

1. `frontend/src/api/client.ts` defined `discoverFunds` / `bootstrapFunds` /
   `registerFund`, but **no component or hook ever called them** — a repo-wide
   search for `discoverFunds` found only its definition.
2. The `discoverFunds` return type was also wrong (`string[]`; the endpoint
   returns `{folder_name, folder_path, pdf_count}[]`), suggesting it was
   stubbed for contract completeness and never exercised.
3. The backend (`app.py: /api/funds/discover`, `/api/funds/bootstrap`,
   `POST /api/funds`) was untouched and fully working throughout.

## Fix
Ported the Story-10 flow into the SPA, surfaced on the Home landing page:

- `frontend/src/api/types.ts` — added `DiscoveredFolder`, `FundBankAccount`,
  `FundMember`, `FundConfig`, `BootstrapResult`.
- `frontend/src/api/client.ts` — corrected `discoverFunds` to
  `DiscoveredFolder[]`, typed `bootstrapFunds` → `BootstrapResult[]` and
  `registerFund` → full `FundConfig` upsert.
- `frontend/src/api/hooks.ts` — added `useDiscoverFunds()` (polled at
  `JOBS_LIST_POLL_MS` = 10s, so a folder dropped while the app is open
  appears without a refresh), `useBootstrapFunds()`, and `useRegisterFund()`
  (invalidates `funds` + `discovered-funds` so the banner clears and the new
  fund shows in the New-audit dropdown immediately).
- `frontend/src/components/FundDiscoveryBanner.tsx` (new) — amber banner
  ("N new fund folder(s) detected in `data/`…") with dismiss, plus the setup
  modal: folder list → AI scan → editable proposal cards (name, ABN, bank
  accounts, members) → per-card Register.
- `frontend/src/components/Home.tsx` — renders `<FundDiscoveryBanner />` at
  the top of the landing page.

Note: React Query's `refetchInterval` pauses while the browser tab is hidden
(default `refetchIntervalInBackground: false`, same convention as the jobs
list); the query refetches on window focus, so returning to the tab after
dropping a folder shows the banner immediately.
