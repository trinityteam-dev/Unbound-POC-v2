# Production Architecture — SMSF Document Intelligence

**Status:** Design / decision record. Not yet implemented.
**Audience:** engineering + whoever owns compliance/commercials for the productised app.
**Lens:** privacy-first, buy-over-build, cost-aware. This is deliberately *critical* of the
current POC and of gold-plating — it flags what NOT to build as much as what to build.

> This doc is the target-state reference. Current-state facts it builds on are scattered
> across `docs/*_RCA.md` and the code; the one-paragraph summary in §2 is enough to read
> this standalone.

---

## 1. Guiding principles

1. **Privacy is the binding constraint, not a feature.** The data is Australian
   superannuation members' financial and tax information (bank statements, ABNs, account
   numbers, and — by schema — TFNs). Every architectural choice is subordinate to keeping
   that data in-region, minimised, access-controlled, and auditable. If a "better" design
   weakens privacy, it loses.
2. **Buy > build.** We are a small team building a compliance product, not a platform
   company. Every hour spent hand-rolling auth, a job queue, OCR, or a PII scanner is an
   hour not spent on SMSF domain logic — which is the only defensible moat here. Default to
   managed cloud services; build in-house only where the domain logic is genuinely ours.
3. **Region-lock to Australia.** Single cloud, single AU region (default: **AWS
   `ap-southeast-2` Sydney**; Azure Australia East is an equal-footing alternative). No
   service enters the design unless it can run and store data in-region under a DPA.
4. **Serverless / consumption-first for cost.** The workload is spiky and batch-shaped
   (audit season peaks, idle troughs). Pay-per-use beats always-on fleets at this scale and
   removes ops burden. Reserve provisioned capacity only where consumption pricing proves
   more expensive at measured volume.
5. **Human-in-the-loop stays.** The POC's processor/reviewer approval step is a compliance
   asset, not friction. Keep it, and make its record immutable.

---

## 2. Current state, in one paragraph

A single-user local POC: single-file Flask (`app.py`, `debug=True`, `127.0.0.1:5001`) with
**no auth, no CORS, no sessions**; background work on raw daemon threads; a 3.5 MB
`jobs_db.json` flat file used as the database and rewritten wholesale on every save with **no
locking** (real race condition); OCR via local `pdftoppm`+`tesseract`; and all document text
sent to **OpenRouter → xAI Grok (US)** by default. Client PDFs (`data/`, 274 MB) and
`jobs_db.json` are gitignored, but `funds_config.json` **is committed** with real fund names,
ABNs, BSB/account numbers, and member names. A live OpenRouter key sits in plaintext `.env`
on disk. The React SPA is clean but unauthenticated and single-tenant. Verdict: excellent
domain engine, zero production/compliance scaffolding.

---

## 3. Compliance & privacy constraints (the requirements that drive the design)

*Not legal advice — validate with privacy counsel. These are the obligations that shape
architecture.*

| Obligation | Architectural consequence |
|---|---|
| **Privacy Act 1988 + APPs** — member data is personal information | Encryption, access control, retention/deletion, breach detection are mandatory, not optional. |
| **APP 8 (cross-border disclosure)** | The moment data leaves AU (e.g. OpenRouter→xAI US) you are accountable for the overseas recipient. Drives **in-region LLM under DPA**, or don't send it. |
| **Privacy (Tax File Number) Rule 2015** | TFNs are special-category: tightly access-controlled, minimally retained, and **never sent to an LLM**. Redact before any model sees a document. |
| **Notifiable Data Breaches scheme** | Requires detect/contain/report capability → audit logging + access control + monitoring. |
| **SIS Act / audit records retention (~7 yrs)** | Real records lifecycle: retention policies, legal hold, controlled deletion. A JSON file can't do this. |
| **APES 110 / auditor independence & confidentiality** | Immutable audit trail of who approved/overrode what, with which model+version and evidence. One firm's data must never be visible to another. |
| **Professional confidentiality (client engagement)** | Consent for LLM processing belongs in the engagement letter; hard tenant isolation in the system. |

**Not currently in scope but worth a conscious "no":** IRAP/ISM (only if selling to
government), CDR/Open Banking accreditation (we ingest bank *statements*, we don't call the
CDR data API). Don't build for these speculatively. A **SOC 2 / ISO 27001-aligned posture**
is the realistic bar customers (audit firms) will ask for.

---

## 4. A decision that changes everything: single-tenant-per-firm vs pooled multi-tenant

Before the architecture, resolve this — it has the largest downstream impact.

- **Pooled multi-tenant** (one app, `tenant_id` on every row, Postgres RLS): cheapest to run,
  standard SaaS, but every isolation bug is a cross-firm data breach, and some firms will
  refuse "your data mingles with competitors'."
- **Silo / single-tenant-per-firm** (each firm gets its own isolated stack or at least its
  own database/account): stronger privacy story that *sells itself* to compliance-conscious
  accounting firms, simpler blast radius, easier data-residency/deletion guarantees — at
  higher per-tenant cost and more deployment automation.

**Recommendation:** given the data sensitivity and that the customer *is* a professional
firm, lean **siloed** — one database (and ideally one storage bucket/KMS key) per firm behind
a shared stateless app tier. It's the more defensible privacy posture and a genuine sales
differentiator, and serverless/consumption pricing keeps the per-silo cost low when a firm is
idle. Only pool if you're chasing high-volume, low-touch SMB self-service. **This is an open
decision (§11) — flag it to the business owner.**

---

## 5. Target architecture (managed-services-first)

```
   Auditor (browser, SSO)
        │  OIDC token
        ▼
  ┌──────────────┐   static SPA: S3 + CloudFront (AU)
  │  CloudFront  │   API: WAF + API Gateway / ALB
  │  + WAF       │
  └──────┬───────┘
         ▼
  ┌─────────────────────────────┐
  │  App tier (stateless)       │  Fargate or Lambda; FastAPI/Flask+gunicorn
  │  - authz (tenant + role)    │  ← the ONLY substantial code we own besides the engine
  │  - enqueue jobs, serve data │
  └───┬─────────────┬───────────┘
      │             │
      ▼             ▼
 ┌─────────┐   ┌──────────┐          ┌──────────────────────────────────┐
 │ Aurora  │   │  SQS     │          │  Worker (Fargate/Lambda)         │
 │ Postgres│   │  queue   │─────────▶│  ┌────────┐ ┌────────┐ ┌───────┐ │
 │ Serverl.│   └──────────┘          │  │Textract│▶│ PII    │▶│Bedrock│ │
 │ v2 (AU, │                         │  │/Doc AI │ │ redact │ │Claude │ │
 │ KMS,RLS)│   ┌──────────┐          │  │(OCR/   │ │(Compre-│ │(AU,   │ │
 └─────────┘   │  S3 (AU, │◀─docs────│  │ tables)│ │ hend)  │ │ 0-ret)│ │
               │  SSE-KMS)│          │  └────────┘ └────────┘ └───────┘ │
               └──────────┘          └──────────────────────────────────┘

 Cross-cutting (all managed): Secrets Manager · KMS · CloudWatch/OTel · CloudTrail
 + append-only audit log · Cognito/Entra (identity)
```

Mapping from POC → managed service, with the buy-vs-build call made explicitly:

| Capability | POC today | Production | Build or buy? |
|---|---|---|---|
| **Identity / SSO** | none | Cognito / Entra ID / Auth0 | **Buy.** Never hand-roll auth. |
| **Authz (tenant+role)** | none | app middleware + Postgres RLS | **Build** (thin; it's our domain). |
| **Database** | `jobs_db.json` flat file | Aurora Serverless v2 Postgres (AU, KMS, PITR) | **Buy** managed; **build** the schema. |
| **Object storage** | local `data/`, `jobs/` | S3 (AU, SSE-KMS, versioning, lifecycle) | **Buy.** |
| **Background jobs** | daemon threads | SQS + Fargate/Lambda workers | **Buy** the queue; **build** task handlers (existing engine fns). |
| **OCR** | `tesseract` (local) | **AWS Textract** / Azure Document Intelligence / Google Document AI | **Buy** — see §6. |
| **PII detection/redaction** | none | AWS Comprehend PII (+ custom TFN/ABN rules) | **Buy** the engine; **build** the AU-specific entity rules. |
| **LLM** | OpenRouter→Grok (US) | **Bedrock Claude** (AU, zero-retention) | **Buy**; **build** the gateway + prompts. |
| **Secrets** | plaintext `.env` | Secrets Manager / Key Vault | **Buy.** |
| **Observability** | `print()` | CloudWatch + OTel traces | **Buy.** |
| **Audit trail** | job `logs` array | CloudTrail + append-only audit table (WORM/Object Lock) | **Buy** infra; **build** the domain events. |
| **CI/CD + IaC** | none | GitHub Actions + Terraform | **Buy** tooling; **build** pipelines. |

**What stays genuinely ours (the moat):** the classification playbook + taxonomy, the
reconciliation/tie-out logic in `core_engine.py`, the human-approval workflow, the
prompts, and the Confident-and-Wrong-Rate evaluation. Everything else is undifferentiated
plumbing — rent it.

---

## 6. Managed OCR is a buy *and* a quality/cost win (not just convenience)

This one deserves emphasis because the repo already has an open "OCR engine swap" workstream
and reconciliation-extraction pain (`docs/RECONCILIATION_*`).

`tesseract` is weak on the exact thing that matters most here — **tabular bank statements and
portfolio reports**. Managed document-AI services (**Textract Queries/Tables**, Azure
Document Intelligence, Google Document AI) return *structured* tables and key-value pairs, in
AU regions, under the cloud DPA. Two compounding wins:

1. **Accuracy:** structured table extraction directly attacks the reconciliation
   mis-extraction issues, instead of dumping noisy OCR text into an LLM and hoping.
2. **LLM cost reduction:** feeding the model clean structured rows (or skipping the LLM for
   extraction entirely) cuts token spend materially versus today's "OCR the page → stuff
   `text[:3500]` into the prompt" approach.

**Trade-off to weigh honestly:** managed OCR sends the document image to the cloud OCR
service. In-region + under DPA this is acceptable for statements, but it's a *disclosure to a
processor* — so it goes through the same PII/consent gate as the LLM. If a specific document
class is too sensitive to leave the box, keep `tesseract` for that class only. Don't treat it
as all-or-nothing.

---

## 7. Data & privacy architecture

- **Residency:** every store (Aurora, S3, backups, logs) pinned to one AU region. No
  cross-region replication that lands data offshore.
- **Encryption:** KMS at rest everywhere (per-tenant keys if siloed); TLS in transit; field
  or column encryption for TFN specifically.
- **PII minimisation before any external processing (the core privacy control):**
  - **Never send TFNs to OCR-cloud or the LLM.** Redact/tokenise them the instant they're
    detected. The `FundMember.tfn` field is currently empty — add the guard *before* it's
    ever populated so it can't regress.
  - Redact member names / account numbers for tasks that don't need them (classification
    usually doesn't; reconciliation needs amounts/dates/descriptions, not TFNs).
  - Use Comprehend PII for general entities + **custom regex/validators for AU-specific
    identifiers** (TFN checksum, ABN checksum, BSB) — these are ours to build because the
    managed detectors don't know them well.
- **LLM data-handling contract:** in-region Bedrock/Vertex/Azure-OpenAI deployment with
  **contractual zero data retention** and no training-on-inputs. This is what makes APP 8
  defensible. **Retire OpenRouter for production** — its default routing (xAI, and Gemini
  fallback, GLM in prior RCAs) gives you neither region control nor a single DPA.
- **Retention & deletion:** S3/Aurora lifecycle policies matched to SIS retention (~7 yrs),
  legal-hold flag, and a real per-fund/per-tenant deletion path (right-to-erasure minus
  statutory-retention carve-out).
- **Audit log:** append-only (S3 Object Lock / WORM table) capturing auth events, data
  access, every classification approval/override with model+version, and every external
  disclosure (which fields went to OCR/LLM). Doubles as breach-detection substrate.
- **Access:** least-privilege IAM; the app assumes a role scoped to the tenant; no standing
  human access to raw client data without break-glass logging.

---

## 8. LLM strategy & guardrails

- **Model:** default to **Claude on Bedrock (`ap-southeast-2`)** — already in your
  `models_config.json`, strong at the extraction/reasoning here, AU region, enterprise DPA.
  Keep the model allowlist pattern you have (`resolve_model`); pin versions.
- **Cost control (be deliberate — LLM is the largest variable cost):**
  - **Tier models by task:** cheap/fast model for classification, stronger model only for
    reconciliation/tie-out reasoning. You already track per-call cost — turn that into a
    per-tenant budget + alerting.
  - **Extract-then-reason:** managed OCR structured output shrinks prompts (§6).
  - **Prompt caching** for the large static playbook/system prompts.
  - **Batch** non-interactive work where the provider offers discounted batch lanes.
- **Guardrails:** treat document text as untrusted input — **prompt-injection defence** (a
  malicious PDF could carry "ignore instructions" text); output schema validation (you
  already do lenient JSON parsing + treat truncation as failure — keep and harden);
  retry/backoff + circuit-breaking in the gateway (today there's only a single Grok→Gemini
  fallback).
- **Quality gate:** run Confident-and-Wrong-Rate as a **CI merge gate** on prompt/model
  changes, with mocked fixtures so it's deterministic and doesn't need live keys.

---

## 9. Cost posture

The instinct to "leverage cloud" is right *specifically because* consumption pricing suits
this workload — spiky, batch, seasonal. Rough shape of the cost model (validate with a
spike, don't trust these as quotes):

- **Near-zero idle floor:** Aurora Serverless v2 scales to a low ACU floor, Lambda/Fargate
  bill per use, S3/SQS are cents at rest. A firm processing nothing in July's off-season
  costs almost nothing — impossible with an always-on fleet.
- **Dominant variable cost = LLM tokens**, then managed OCR (per-page), then egress. The §8
  controls (model tiering, extract-then-reason, caching) target the biggest lever directly.
- **Where consumption bites back:** very high sustained volume can make serverless dearer
  than reserved capacity — revisit only when measured throughput justifies it. Don't
  pre-optimise for scale you don't have.
- **Buy-vs-build cost, stated plainly:** the managed services above cost money, but hand-
  building auth, a durable queue, OCR, PII detection, and audit infra costs *engineer-months*
  plus perpetual maintenance and a larger security/compliance surface you must certify. At
  this team size the managed bill is cheaper than the build.

---

## 10. Migration roadmap (incremental — the engine survives throughout)

`core_engine.py` is the asset and is largely portable; the worker functions become task
handlers with little change.

1. **Contain & harden (days):** rotate the leaked key; scrub `funds_config.json` from git
   history; kill `debug=True`; gunicorn; structured logging; secure the file-serving path;
   containerise with OCR binaries baked in; pin deps + lockfile. *(No behaviour change.)*
2. **State off the local box:** Aurora Postgres + S3 behind the existing API shapes
   (`types.ts` already documents them). Retire `jobs_db.json` and the config JSONs.
3. **Durable jobs:** threads → SQS + workers. Jobs survive restarts, retry, scale.
4. **Identity & isolation:** OIDC/SSO, `tenant_id` everywhere, Postgres RLS (or per-firm
   silo per §4), frontend auth header + configurable API origin.
5. **Privacy-critical swap:** OpenRouter → in-region Bedrock Claude; add PII/TFN redaction;
   swap/augment OCR with Textract. **This is the step that makes it lawful to run on real
   client data at scale** — everything before it is engineering; this is compliance.
6. **Provable posture:** audit log, retention/deletion lifecycle, CI eval gates, Terraform +
   pipelines, SOC 2 / ISO 27001-aligned controls.

Steps 1–3 are engineering hygiene. **Steps 4–5 are the product-defining, compliance-defining
work and must not slip.**

---

## 11. Immediate remediation (independent of the roadmap)

1. **Rotate the OpenRouter key** in plaintext `.env` (and delete the commented second key) —
   treat as compromised.
2. **Scrub `funds_config.json` from git history** (`git filter-repo`), move fund config to
   DB/untracked, commit a `.example` placeholder instead.
3. **Secure the file-download route** (`app.py` `/api/jobs/.../file/...`) — `secure_filename`
   + confirm resolved path stays under the job dir; it's currently path-traversable and
   unauthenticated.
4. **Guard the TFN field** so it can never be sent to any external service, before it's ever
   populated.

---

## 12. Open decisions / risks (for the business owner, not just engineering)

- **Tenancy model (§4)** — siloed vs pooled. Biggest downstream impact; decide first.
- **Cloud choice** — AWS (Bedrock+Textract+Cognito in Sydney) vs Azure (OpenAI+Document
  Intelligence+Entra, Australia East). Either works; pick one and commit to avoid multi-cloud
  tax.
- **Is any LLM disclosure acceptable to the firm's clients at all?** If not, the fallback is
  fully on-prem/in-VPC models (self-hosted open-weight in-region) — higher cost/effort, lower
  quality. Needs an explicit business/compliance sign-off, ideally reflected in engagement
  letters.
- **Legacy `templates/index.html`** (3,765-line server-rendered UI) vs the React SPA — pick
  one, delete the other; carrying both doubles the attack surface.
- **Backend test debt** — the `test_story*.py` scripts need live keys/data and aren't
  CI-runnable; a real mocked pytest suite is a prerequisite for the eval gate in §8.
