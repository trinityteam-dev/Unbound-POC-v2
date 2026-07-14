# ICE Pre-Production Engagement — Scope Revisions & Rationale

**Source document reviewed:** *"Pre-Production Engagement: Automated Ingestion & Precision
Extraction Engine (ICE)" — Strategic Blueprint, Operations Manifesto & Scope of Work,
DRAFT Proposal V1.0.*

**Purpose of this document:** capture, point by point, the **scope-relevant** items from the
draft proposal that changed during review — the **original wording**, the **revision**, the
**reason**, and the **question that prompted the re-examination**. It is deliberately limited
to points that affect scope, commitments, or the data/measurement approach. It is not a full
rewrite of the proposal and does not restate architecture.

> **Not legal advice.** Privacy/compliance positions below must be validated with privacy
> counsel; they are recorded here as engagement decisions, not legal conclusions.

---

## 0. Scope anchor (the single most important clarification)

**Original (proposal):** The Executive Summary bounds the phase "strictly" to *Incoming
Document ICE (Identification, Classification, and Extraction)*, but **Section 3
("Comprehensive Production Lifecycle Components")** describes the entire product — bank
reconciliation, discrepancy engine, compliance checklist, query generation, **live Class/BGL
ledger synchronisation**, and an external multi-tenant client portal — reading as if all of it
is in the 11-week phase.

**What prompted the re-examination:** *"The 11 weeks is only for Identification and extraction
of key fields based on document type (keyfield ↔ document mapping to be provided by client)."*

**Revised position:** The 11-week engagement covers **Identification + key-field extraction
only.** Everything in Section 3 beyond identify/extract (reconciliation, checklist, query
generation, ledger integration, client portal) is **out of this phase** and should be fenced
off explicitly as "target-platform context / future phases," not presented as in-scope.

**Rationale:** Identify + key-field extraction in 11 weeks is realistic; the full pipeline is
not. Leaving Section 3 as written creates contractual exposure to deliver the whole product in
the window. Narrowing scope also **resolves the Class/BGL contradiction** (see §6): extraction
produces a structured hand-off file for BeFree's existing RPA bot; live ledger integration is
out.

---

## 1. Data residency & privacy

**Original (proposal):** Simultaneously claims data "lives entirely within BeFree's secure
tenant boundary" / "data sovereignty" / "eliminate cloud masking overhead," **and** routes
document content to **Grok (US model, Component 3.1)** and **Google Doc AI (Component 2.1)**,
while Section 4 states that **"in lieu of anonymization pipelines"** the system relies purely on
providers' zero-retention contractual clauses.

**What prompted the re-examination:** *"The data residency and privacy — we would like to use
Grok/OpenRouter with some defined clause for the customer to review and provide consent."*

**Revised position:** Using **Grok/OpenRouter under a client-reviewed consent clause is an
accepted business decision.** To make it defensible:
1. **Remove the internal contradiction.** Drop "data stays entirely in-boundary" language;
   state plainly that specific document content is disclosed to named overseas processors
   (xAI/OpenRouter, Google) under zero-retention, no-training terms, with client consent.
2. **Consent clause essentials** (validate with counsel): name the overseas recipients, the
   country, the data disclosed, the zero-retention/no-training terms; place it in the
   engagement letter.
3. **Redact TFNs at source regardless of consent** — TFNs sit under the separate TFN Rule; the
   cost of a pre-send mask is trivial and removes the worst-case headline.

**Rationale:** The consent approach is viable, but the proposal's "stays in-boundary" framing
is factually contradicted by the offshore calls and would fail a compliance reviewer's read.
Honesty + a TFN carve-out makes the same decision defensible.

---

## 2. Two-POC convergence (origin of the "custom-code" mechanisms)

**Original (proposal):** Describes a **"3-expert voting formula (40% keyword / 20% layout /
40% sequence context)"**, keyword taxonomies, a **"Track 1 custom-code structural classifier"**,
and a **"Google Doc AI — 3.2% Character Error Rate"** — presented as if all proven in one POC.

**What prompted the re-examination:** *"There was a parallel POC effort where a team was using
pure Python + PyPDF + Google OCR AI to extract and classify documents while this POC was running
on pure LLM efforts. That is where the 3-expert voting formula, keyword taxonomies, 3.2% CER etc.
come from."*

**Revised position:** These specifics are **real**, but from the **parallel Python/Google-Doc-AI
POC**, not the LLM POC. The proposal is productionising a **convergence of two POCs**. State
this explicitly early in the document so a reader understands why both a "custom-code classifier"
(Track 1) and an "LLM engine" (Track 2) exist.

**Rationale:** Without the two-POC framing, the mechanisms read as invented precision. Named as a
convergence, they are grounded. (Minor: confirm the 3.2% CER was measured on the representative
document mix — printed statements/tables — rather than primarily handwriting, since handwriting
is a small part of the real SMSF document profile.)

---

## 3. "Reinforcement Learning" terminology

**Original (proposal):** Component 3.7 / Sprint 4 / KPI 7.1 describe a "reinforcement learning"
loop that "refines prompt weight allocations."

**What prompted the re-examination:** *"What is being termed as Reinforcement Learning is not
based on weights/biases but improving the keyword set based on user feedback."*

**Revised position:** Rename to **"feedback-driven keyword/taxonomy refinement"** (or
"human-in-the-loop tuning"). No weight/reward training is implied.

**Rationale:** "RL" makes a technical reader expect gradient/reward training. The actual
mechanism is prompt/keyword refinement from reviewer corrections — same substance, no
expectation gap.

---

## 4. The 95% accuracy exit gate

**Original (proposal):** "Target Accuracy Vector: … initial extraction **precision** score goal
of **95%** across the top 5 to 10 selected document types, **pending validation by the technical
team**." Also stated as a definitive exit criterion (§2.2).

**What prompted the re-examination:** *"The 95% exit-gate came from our POC's 98% extraction
confidence — of course it was not ground truth / user-verified accuracy. What would be a metric
gate we can control?"*

**Revised position:** Replace the confidence-derived number with a **controllable, gold-set-based
gate**:
- **Headline:** *≥ 95% value accuracy on the **mandatory key fields** across the top 5–10
  (Tier-1) document types, measured against an agreed human-verified gold evaluation set;
  threshold **baselined in Sprint 1**.*
- **Safety metric (named, not just internal):** **Confident-and-Wrong Rate ≤ [Y]%** on
  auto-accepted fields.
- **Optional fields** are reported as **precision & recall**, not folded into the headline
  accuracy.
- Terminology fixed: it is **accuracy**, not "precision"; drop the word "Vector."

**Rationale:** Model **self-confidence ≠ accuracy** (this is exactly why the repo already tracks
a Confident-and-Wrong Rate). A number is "controllable" only once its measurement target is
pinned to a fixed, versioned, client-agreed gold set with defined per-field match rules. Scoping
to mandatory fields avoids the base-rate trap that makes blended accuracy meaningless on
optional/rare fields. See `EXTRACTION_METRICS_EXPLAINED.md` for the full metric reasoning.

### Update — 2026-07-13 (metrics resolved into proposal §3/§4)

- **CWR lives under the evaluation UI**, measured on **auto-accepted fields** (those that would
  ship with no human review), sliced by critical fields. The hard red line is the intersection
  **critical ∩ CWR** — a materially wrong value auto-accepted with nobody looking.
- **Critical error rate is now defined** (it was used in the §4 threshold table but never
  defined): the rate of **critical-severity errors** — wrong amount, wrong debit/credit
  direction, wrong account, wrong transaction date (financially material, undetectable
  downstream). Reported per-field and per-document (% of docs with ≥1 critical error). Numeric
  thresholds replace the old "Near zero / Very low / Acceptable" words (indicative P1 <0.5%,
  baselined Sprint 1).
- **Severity-weighted error rate defined and demoted to a reported metric, not a gate:**
  Critical 5× / High 3× / Medium 1× / Low 0.5×, summed / fields = "weighted errors per 100
  fields." It steers the fix queue; it is not an acceptance threshold.
- **Debit/credit accuracy dropped as a standalone gated row** — direction *extraction* ≠
  *balancing* (balancing/tie-out is out of scope). Direction is retained inside **row-level
  accuracy** and as a **critical-error trigger**, so sign flips are still caught.
- **Presentation kept simple for the client:** the flat §3 "Supporting Metrics" table is
  retained (a non-technical sponsor can skim it); the gate-vs-reported distinction is internal
  eval-spec framing and is **not** surfaced in the client proposal. Only two additive changes to
  §3 — **define critical error rate** and **add CWR** — both in the existing three-column style.
  (The gate/reported model still governs how we run the eval; it just isn't the client-facing
  register.)

---

## 5. "10,000 documents per type for training"

**Original (proposal):** §2.1 / §4 / §5 require BeFree to provide **10,000 historical documents
per selected document type** for "training, tuning, and evaluation."

**What prompted the re-examination:** *"Why is this conceptually mismatched? And how do
prompt-based systems typically work at scale and in an enterprise world? How do you train them
and how do you evaluate the accuracy?"* — and later: *"LLMs are not trained by data."*

**Revised position:** Replace the 10,000/type "training corpus" with **two clearly separated data
needs**:
1. **Improvement data** (reviewer corrections that refine prompts/keywords) — generated **for
   free** during use; **nothing to collect upfront**.
2. **Measurement data** (the **gold evaluation set**) — a small, blind-labelled, versioned
   sample; **hundreds per priority type**, not thousands.

**Rationale:** A prompt-based (in-context) LLM system has **frozen weights** — it does not learn
from a training corpus, so volume alone buys nothing. Documents matter only for (a) *evaluation*,
where the scarce resource is **quality labels on hundreds**, not raw volume, and (b)
*coverage/edge-case discovery*, where you want diversity, not tens of thousands of near-duplicates.
The 10,000/type figure conflated a supervised-ML training instinct with evaluation labelling.
(If literal model fine-tuning is ever pursued, *that* is where thousands of labelled examples
return — but it is not needed for this extraction quality and is out of this phase.)

---

## 6. Class/BGL ledger integration & the RPA hand-off boundary

**Original (proposal):** Component 5.1 promises "direct data integration pipelines executing
automated **live workpaper creation and ledger synchronisation into Class and BGL**," while §3.6
/ Step 4 correctly describe producing a **structured hand-off file for BeFree's existing RPA
bot.** These contradict.

**What prompted the re-examination:** The scope anchor (§0) — the 11 weeks is identify + extract
only.

**Revised position:** **Live Class/BGL integration is out of this phase.** The boundary is:
ICE identifies the document, extracts key fields, and emits a **structured payload** (the Option
A Excel / Option B JSON hand-off) consumed by BeFree's **existing** downstream RPA. Ledger
integration is future-phase.

**Rationale:** Live ledger integration is a major external-dependency build (vendor APIs,
credentials, sandboxes) inconsistent with an 11-week identify/extract engagement. Drawing the
boundary at the structured file also removes the contradiction.

---

## 7. Document-type count and gold-set sizing consequences

**Original (proposal):** Implies a manageable "top 5–10 document types"; a fixed 10,000/type ask.

**What prompted the re-examination:** *"I have a concrete number on the no. of document types.
It's 114"* … *"114 document types each having different fields to extract. Even if the fields
overlap since they are in different documents, collapse is not possible."*

**Revised position:** With **114 irreducible extraction schemas**, uniform per-type coverage is
impossible and unnecessary. Adopt a **tiered, risk-based** gold set:
- **Tier 1 (vital few, ~15 types)** — high volume and/or ledger-critical — **individually
  gated**, ~150–200 labelled/type.
- **Tier 2 (~30 types)** — reported, softly gated, ~50–75/type.
- **Tier 3 (long tail, ~70 types)** — **measured in aggregate** (at the field-instance level)
  and via production audit; individual gold sets only where a type later proves problematic.
- **The 95% gate is scoped to Tier-1 priority types** (covering the bulk of volume), with the
  tail monitored — not "95% across all 114."

**Prerequisites to finalise sizing (from client):**
1. **Per-type document-frequency distribution** (which ~15 types dominate the ~210,000
   docs/cycle: 10,500 funds × ~20 docs).
2. Confirmation that types are genuinely distinct schemas (confirmed — no collapse).

**Rationale:** Types follow a power law; proportional sampling would drown in bank statements and
never reach rare types. Field-instance accuracy remains poolable across heterogeneous types, so
aggregate tail measurement is valid even without collapse. See
`EVALUATION_HARNESS_SPEC.md` for sizing math and confidence-interval basis.

### Update — 2026-07-13 (tiering simplified for client comprehension)

The Tier-1/2/3 + volume×complexity + materiality/ground-truth-override model tested as too
complex for the client to own. Replaced with a **single-axis, client-owned** model:

- BeFree sorts all 114 types into **three priority tiers by one question — "how much does it
  matter that extraction is correct?"** Importance blends volume and financial/compliance
  impact; materiality is no longer a separate override (it is implicit in "matters").
- **Complexity is no longer a client input.** Trinity tags each *sample* simple/medium/complex
  on receipt and reports accuracy sliced by complexity — the client is not asked to band types.
- Priority 1 = individually gated; Priority 2 = measured, lighter; Priority 3 = observed and
  catalogued (spot-checked, not per-type gated).
- The 114 count and the ~15/30/70 working split remain illustrative until BeFree assigns tiers.

See proposal §5 for the client-facing wording.

---

## 8. Gold-set acquisition & labelling approach

**Original (proposal):** A single 10,000/type "provisioning" line; no labelling method,
ownership, or QA defined.

**What prompted the re-examination:** *"6,500 labelled is a humongous … effort. With only 1 week
and a team of 5-6 people, we need to nail this down to a much smaller dataset"* and *"Assisted
labelling is probably more feasible than blind/manual … maybe double labelling with QA would help."*

**Revised position:**
- **Week-1 seed:** ~800–1,000 labelled docs, concentrated on Tier-1 types (~10–15 types ×
  ~70–100). Achievable by 5–6 people in the week.
- **Method:** **assisted labelling (correct-not-author)** for bulk/volume; a smaller
  **blind-labelled "trusted core" (~50/Tier-1 type)** as the acceptance ruler; **double-labelling
  + adjudication** on a slice for label quality.
- **Anchoring-bias control:** because assisted labelling can inflate measured accuracy,
  **blind-re-label ~10% of the assisted set** to quantify the bias gap; double-labelling does
  **not** remove anchoring if both labellers see the pre-fill.
- **Acquisition options** (ranked by leverage):
  1. **Back-derive labels from finalised funds** — correct field values already exist in
     completed Class/BGL ledgers and prior workpapers (highest leverage; validate
     post-adjustment vs raw-on-document).
  2. **Harvest human-verified outputs from the two POC runs.**
  3. **Assisted labelling** (bulk).
  4. **Blind manual labelling** (trusted core + QA slice).
  5. **Rolling growth from production** — every reviewer correction becomes a labelled example.
  - *Not recommended:* synthetic documents for the measurement set (real docs only; synthetic
    acceptable for edge-case discovery only).

**Rationale:** The upfront burden is only the *measurement* gold set (small); *improvement* data
accrues free from usage. Ledger back-derivation exploits ground truth BeFree already owns.

### Update — 2026-07-13 (gold set right-sized to ~1,000, tranched)

~14,000 (a full production measurement set) was rejected as too large for a validation phase.
Locked at **~1,000 total**, concentrated on Priority 1, delivered in tranches:

- **Per-type target:** Priority 1 ~50–75/type (~10 types ≈ 600); Priority 2 ~15–25/type
  (~15–20 types ≈ 300); Priority 3 aggregate spot sample (~100). Supersedes the flat 600/type.
- **Tranches:** Tranche 1 (Week 1) = Priority 1 ~600; Tranche 2 (~Week 3) = Priority 2 ~300;
  Tranche 3 (~Week 5–6) = Priority 3 ~100.
- **Honest caveat (stated in proposal §6):** ~50–75/Priority-1 type gives a *directional*
  accuracy estimate — enough for a readiness recommendation, wider confidence than production
  certification. More gated types → smaller per-type samples or a larger total; BeFree owns the
  trade-off via the tranches.
- **Acquisition unchanged in principle:** back-derive from finalised funds (highest leverage);
  ground truth = Befree-verified values in Excel/CSV/JSON/Class-BGL formats.

See proposal §6 for the client-facing wording.

---

## 9. Tone / audience (secondary)

**Original (proposal):** Mixes heavy jargon ("cognitive friction," "computational brain," "UI
virtualization rendering frameworks") with unsubstantiated technical specifics.

**Observation:** For a mixed internal-partner + client-sponsor/executive audience, the document
would read better with **neutral tone and minimal engineering language**, technical specifics
either substantiated (via the two-POC framing) or moved to an appendix.

**Rationale:** The current mix is simultaneously too technical to skim and too loose to serve as
an engineering contract.

---

## Open decisions / prerequisites summary

| # | Item | Owner | Needed for |
|---|---|---|---|
| 1 | ~~Per-type document-frequency distribution (rank the Tier-1 ~15)~~ — **Resolved 2026-07-13**: replaced by single-axis client tiering (§7 update); BeFree sorts 114 types into 3 priority tiers | Client | Gold-set sizing, gate scope |
| 2 | Consent clause wording (overseas processors, zero-retention, TFN carve-out) | BeFree + counsel | Data-residency posture |
| 3 | Confirm scope boundary = identify + extract; Section 3 fenced as future | Both | Contractual exposure |
| 4 | Labelling resourcing (who supplies SME time; who curates type balance) | Client | Week-1 seed feasibility |
| 5 | Set `[Y]%` CWR ceiling + confirm 95% floor after Sprint-1 baseline | Both | Exit gate |

---

*Companion documents:* `EXTRACTION_METRICS_EXPLAINED.md` (accuracy / precision / recall / CWR /
confidence intervals / gold-set reasoning) and `EVALUATION_HARNESS_SPEC.md` (how to build and run
the evaluation).
