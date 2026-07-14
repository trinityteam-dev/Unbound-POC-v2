# Extraction & Classification Metrics — Explained

A reference for **Accuracy, Precision, Recall, and Confident-and-Wrong Rate (CWR)**, plus the
supporting ideas that make them meaningful: **value accuracy**, **confidence intervals**, **why a
gold set is needed**, and **when LLM-as-judge works without one**. Written in the context of
BeFree's SMSF document extraction (identify the document type, extract key fields).

The document is organised around the questions that drove each explanation, so the reasoning
chain is preserved.

---

## 1. The starting problem: confidence ≠ accuracy

The POC reported ~98% **model self-confidence**. A proposed exit gate of "95% accuracy" was
derived from it. **These are different things.** A model can be **confidently wrong** — which is
the entire reason a *Confident-and-Wrong Rate* exists as a separate metric.

**Core principle:** you cannot grade a system with a grader whose own error rate you don't know.
Confidence, a second model, an LLM judge — each is another *estimate* with no answer key. To
trust an estimate you compare it to something that is *true*: **ground truth**, i.e. a
human-verified **gold set**.

---

## 2. Value accuracy

> *Q: "What does value accuracy mean? Explain with an example. And is accuracy just comparing the
> extraction against the labelled value?"*

**Value accuracy = of the fields that are actually present, how often the extracted value exactly
matches the human-verified value** (after normalization). The emphasis is on the *content*, not
merely whether something was extracted.

**Worked example** — document type *Bank Statement*, 3 mandatory fields, 5 gold docs = 15 field
instances:

| Doc | account_number | closing_balance | statement_period_end |
|---|---|---|---|
| 1 | ✅ 199860672 | ✅ `25,500` vs `25500` (normalized → match) | ✅ |
| 2 | ✅ | ❌ truth 25,500 / extracted **25,000** (wrong value) | ✅ |
| 3 | ✅ | ✅ | ❌ wrong month |
| 4 | ✅ | ✅ | ✅ |
| 5 | ✅ | ✅ | ✅ |

- 15 instances, 13 correct → **value accuracy = 13/15 = 86.7%**
- Per field: account_number 5/5 = 100%, closing_balance 4/5 = 80%, date 4/5 = 80%.

**Normalization matters:** `25,500.00` vs `25500` = **correct** (formatting stripped); `25,000` =
a genuinely **wrong value**. Match rules are defined per field type (numeric to the cent, dates as
ISO, account numbers digits-only, names trimmed/cased) *before* scoring, so "exact match" is
unambiguous.

**Denominator note.** "Accuracy" needs its denominator stated:
- **Value accuracy (present cases only)** — of fields that have a true value, how many were
  extracted correctly. Cleanest reading; used for the headline gate on mandatory fields.
- **Overall field accuracy (all cases)** — across all docs, includes "field absent AND system
  correctly stayed silent" as correct.

On a **mandatory** field (present ~100% of the time) they converge. On an **optional/rare** field
they diverge hard (see §3, base-rate trap). Always state the headline as *"value accuracy on
present, mandatory fields."*

---

## 3. Accuracy vs Precision vs Recall

> *Q: "Are precision and accuracy different?"* … *"So CWR is not precision either?"*

The pivot is **what each metric counts**:

| Metric | Counts "correctly stayed silent"? | Question it answers |
|---|---|---|
| **Accuracy** | Yes | Across everything, how often was it right? |
| **Precision** | No | When it *did* extract, how often was it right? |
| **Recall** | No | Of the values actually present, how many did it catch? |

**Accuracy gets free credit for the empty cases; precision does not.** That is the whole
difference, and it is why on a rare/optional field a system that extracts *nothing* can still post
high accuracy (all those correct "silences") while precision and recall reveal it is useless.

### The optional-fields subtlety

> *Q: "What if some fields are optional — extract if present, otherwise fine? The gold set should
> give docs with 100% of fields so we measure the optional extraction %."*

Including only present cases measures **recall** (catch rate) but is **blind to fabrication**. An
optional field has *two* behaviours to measure:
1. **When present — does it catch it?** → **recall**.
2. **When absent — does it correctly stay silent, or hallucinate a value?** → **precision**.

Hallucinating a value for an absent field is the more dangerous error (confident fabrication into
the ledger). So the gold set needs **both present and absent cases** per optional field, and the
label schema needs **three states**: a value / **absent** / illegible. The `absent` state is what
makes precision measurable.

**Don't gate optional fields on accuracy** (base-rate trap): if a field appears in 50 of 400 docs
and the system extracts nothing ever, accuracy = 350/400 = **87.5%** but recall = **0%**. Gate
optional fields on **recall** (the "extraction %") and **precision** (fabrication rate).

---

## 4. The unified worked example (all four metrics from one batch)

> *Q: "Give me a clear and simple explanation of accuracy, precision, CWR and recall with a simple
> example from BeFree's project."*

**Task:** extract the **member name** from **100 SMSF documents**. In reality 50 *have* a member
name; 50 *don't* (a plain bank statement).

| What was true | System's action | Count | Label |
|---|---|---|---|
| Name present (50) | extracted the **right** name | 40 | ✅ correct |
| Name present | extracted a **wrong** name | 4 | ❌ wrong value |
| Name present | extracted **nothing** (missed) | 6 | ❌ missed |
| Name absent (50) | correctly extracted **nothing** | 45 | ✅ correct silence |
| Name absent | **invented** a name (hallucinated) | 5 | ❌ made-up |

The system **put a value in the field 49 times** (40 + 4 + 5) and **left it blank 51 times**.

- **Accuracy** = (40 correct extractions + 45 correct blanks) / 100 = **85%**
- **Recall** = 40 / 50 present = **80%** *(the 4 wrong + 6 missed fail recall)*
- **Precision** = 40 / 49 claims = **81.6%** *(the 4 wrong + 5 invented make it untrustworthy)*
- **CWR** = of the auto-approved claims, how many silently wrong. Say **40 of the 49 claims were
  high-confidence (auto-approved)** and of the 9 total errors, **2 landed in the auto-approved
  batch** → **CWR = 2/40 = 5%**

| Metric | This batch | Question | Bad score means |
|---|---|---|---|
| Accuracy | 85% | Right overall? | Generally unreliable |
| Recall | 80% | Catches what's there? | Leaves real fields blank → rework |
| Precision | 81.6% | Trustworthy when it fills a field? | Fills fields with wrong/invented data |
| CWR | 5% | Silently wrong on auto-approved data? | Bad data reaches the ledger unnoticed |

Plain-English summary: **Recall** = does it miss things? **Precision** = when it answers, is it
right? **Accuracy** = how often right overall? **CWR** = of what it ships without a human checking,
how much is silently wrong?

---

## 5. Confident-and-Wrong Rate (CWR)

### 5.1 Accuracy ≥ 95% does NOT imply CWR ≤ 5%

> *Q: "Accuracy > 95% implies CWR ≤ 5% — right?"* — **No.**

Accuracy's error is spread across **all** fields; CWR is the error rate inside **only the
auto-accepted (high-confidence) subset** — the fields that ship without review.

1,000 fields, 95% accuracy = 50 wrong, 800 auto-accepted / 200 routed to a human:

| Where the 50 errors fall | CWR = confident-wrong / auto-accepted |
|---|---|
| All 50 in the reviewed (low-confidence) bucket | 0/800 = **0%** (best case) |
| 30 confident, 20 reviewed | 30/800 = **3.75%** |
| All 50 in the auto-accepted bucket | 50/800 = **6.25%** (worse than 5%) |

Same 95% accuracy, CWR from 0% to 6.25%. CWR depends on whether **confidence correlates with
correctness** — which accuracy cannot see. That independence is *why* CWR is a separate gate.

### 5.2 CWR is not Precision either

> *Q: "So CWR is not precision?"* — Correct; they are cousins, separated by **confidence**.

- **Precision** = of **all** claims (any confidence), how many right.
- **CWR** = of the **high-confidence / auto-accepted** claims only, how many **wrong**.

Exact relationship: **CWR = 1 − (precision measured on just the auto-accepted subset)** — *not*
`1 − overall precision`.

**Example** — 1,000 fields, value extracted on 900, silent on 100. Of 900 claims, 850 correct →
**overall precision = 94.4%**. Of those 900, 700 auto-accepted / 200 routed.
- Errors split **10 confident / 40 low-confidence** → CWR = 10/700 = **1.4%**.
- Errors split **45 confident / 5 low-confidence** → CWR = 45/700 = **6.4%**.

Same 94.4% precision, CWR swings 1.4%↔6.4% purely on where errors land. Only CWR knows about the
auto-accept boundary.

Mental model for the three claim-metrics: **Recall** = of values present, did it catch them?
**Precision** = when it makes a claim, is the claim right? **CWR** = of claims confident enough to
ship *unreviewed*, how often silently wrong?

### 5.3 Per-field vs per-document CWR

> *Q: "Can CWR be measured per field as well as per document?"* — Both; field level is the natural
> unit, document level is the compliance unit.

- **Per-field-instance CWR** — the atomic unit (the auto-accept decision is made per field);
  aggregated **per field-type** it is the diagnostic view ("which fields do I over-trust?").
- **Per-document CWR** — needs a rule: *a document is confident-wrong if ≥ 1 of its auto-accepted
  fields is wrong.* This is the risk/compliance view (one wrong field taints the workpaper).

**Compounding — per-document CWR ≫ per-field CWR.** With 10 auto-accepted fields each at 1% CWR:
> per-document CWR ≈ 1 − (0.99)¹⁰ ≈ **9.6%**

A reassuring "1% per field" can mean **~10% of documents carry a silent error.** Report **both**;
if forced to pick one headline, use per-document (it's what reaches the ledger).

### 5.4 Measuring CWR does NOT mean checking every auto-approved item

> *Q: "Getting CWR requires checking all the high-confidence auto-approved ones manually — correct?"*
> — No.

- **On the gold set:** CWR is **free** — the labels already exist; filter to auto-accepted, count
  wrong. This is where the exit-gate CWR is measured.
- **In production:** you **sample**, not re-check everything (that would defeat auto-approval). A
  **monthly random audit of ~200–400 auto-accepted items** estimates CWR with a confidence
  interval. The sample **must include the auto-accepted bucket**, never just the low-confidence
  review queue (which is structurally blind to confident-wrong errors).
- CWR is a **rare event**, so it needs a decent sample: ~300 audited → ±2%; ~1,100 → ±1%.
- **Downstream capture** (RPA reconciliation breaks, client dispute, auditor catch) is a real but
  **lagging, undercounting** supplement — never the sole source.

**The trap:** a "review only below the confidence threshold" design **cannot measure CWR at all** —
the confident, auto-accepted items (the dangerous ones) are exactly the set nobody looks at.
Illustration: 1,000 docs, 900 auto-accepted / 100 reviewed; humans fix 20 of the 100 and it "looks
great," while 3% of the 900 = **27 silent errors** ship unseen.

---

## 6. Confidence intervals (why sample size matters)

> *Q: "Explain confidence interval to me, so I understand the importance."*

You measure accuracy on a **sample** (the gold set) but care about the whole **population** (all
~210,000 production docs). The measured number is an **estimate**; the confidence interval is how
close it is to the truth — like a political poll's "±3%."

Same measured **95% accuracy**, different sample sizes (per type):

| Gold docs / type | 95% confidence interval | True accuracy probably… |
|---|---|---|
| 50 | ±6% | 89%–100% |
| 100 | ±4.3% | ~91%–99% |
| 200 | ±3% | 92%–98% |
| 400 | ±2.1% | ~93%–97% |
| 1,000 | ±1.4% | ~93.6%–96.4% |

**Why it decides whether you can even claim the gate:** measure **94% on 100 docs → ±4.3% →
89.7%–98.3%**, which *straddles* 95% — you genuinely can't tell if you passed. Only when the
interval sits entirely above/below 95% can you make a clean claim. **The margin, not the headline,
is what makes a number defensible.**

**The one rule of thumb — it shrinks with √n:**
> To **halve** uncertainty you need **4×** the documents.

100 → 400 (4× labelling) moves ±4.3% → ±2.1%. This is why ~300–400/type is the sweet spot — below
it the number is too fuzzy to defend; above it you pay 4× for a marginally tighter number.

**Consequences:** rare types with ~20 labelled docs sit at ±9.5% ("somewhere 85%–100%" — a shrug,
hence tiering/aggregation); and rare events like CWR need larger samples to pin a low rate.

---

## 7. Why a gold set at all (the epistemics)

> *Q: "Why do I need an upfront gold set? My production/test is never measured against it; it only
> tells me the strength of my prompt on that finite set, and the prompt keeps evolving."*

**The gold set is not training data — it is a measuring instrument.** The system never sees its
labels. It is a **representative random sample of the same population production comes from.**

1. **Generalisation via sampling.** You never measure a large population directly in *any*
   statistical setting — you infer it from a sample. A poll of 1,000 predicts an election of
   150 million *none of whom were polled*; a drug trial on 5,000 predicts millions of *different*
   patients; factory QC tests 200 to infer a million. "Production isn't the gold set" is true of
   all of these — and none are useless.

2. **What generalises is the *rate*, not the extractions.** Every document is different, but the
   **error rate** is a stable property of (system + document distribution) and holds on unseen
   documents of the same kind. The gold set's 95% is an **estimate, with a known confidence
   interval, of accuracy on all 210,000 production docs of that type.**

3. **A fixed ruler is what lets the prompt evolve safely.** *Because* the prompt changes, you need
   something that doesn't. Re-running the **same** frozen gold set after a change tells you whether
   it helped: *"v2 → 94%, v3 → 96% on goldset-v1 ⇒ v3 is better."* That comparison is only valid
   because the ruler held still. Without it, every "improvement" is a blind guess.

**The one honest limit** (the valid part of the worry): generalisation holds only if the gold set
is **representative** and production doesn't **drift**. When a bank changes its layout, the gold
set stops representing production and its number stops transferring — which is why you re-audit
fresh samples and grow the set. Drift is detectable *only because* you have a fixed baseline.

**What you lose without a gold set:** no defensible client number; no way to tell if a prompt
change helped; no basis to set the confidence auto-accept threshold; no CWR; no way to compare
model A vs B; no drift detection. Every one of those decisions requires a fixed, labelled,
representative sample.

> One line: the gold set is the **answer key** that lets you grade everything else (production,
> prompt v2 vs v3, model A vs B, your confidence thresholds), by being a representative sample
> whose measured rate stands in for the millions of documents you'll never label.

---

## 8. LLM-as-judge and reference sets

> *Q: "Can LLM-as-judge determine between two models' answers without a reference set? Under what
> scenarios does it work without any reference / gold set?"*

**Two different bars:** *usable as a decision* vs *trustworthy as a measurement.* An LLM judge
produces a trustworthy **measurement** only when a reference is in the loop — in one of two ways:

1. **Reference-based judging** — you *give* the judge the correct answer; it checks equivalence
   (a smart comparator, e.g. `J. Smith ≡ John Smith`). Reliable because it isn't deciding
   correctness from scratch.
2. **Calibration** — you measure a *reference-free* judge against the gold set **once** ("when it
   says 'correct', how often is it?"), then deploy it within the measured error bounds.

**The judge never manufactures ground truth — it propagates/scales it.** Truth originates from the
human-labelled reference.

**Where reference-free judging genuinely works** (reliability tracks the **generator–verifier
gap** — how much easier verifying is than generating):
- **Verifiable outputs** — code (passes tests?), math, logic, schema compliance.
- **Source-grounded verification** — *"does this extracted value appear in this document?"* No gold
  *label*, but grounded in the **source**; excellent for hallucination detection (the POC's "amount
  must appear verbatim" check is a deterministic version of this).
- **Subjective/preference tasks** where no ground truth exists (fluency, helpfulness).
- **Pairwise comparison** ("A better than B") — more reliable than absolute scoring; usable for
  **selection/routing**, but tells you *better*, not *correct* (two wrong answers → picks the
  better-wrong one).

**Where it fails reference-free:** correctness depending on external facts the judge can't check;
**ambiguous cases with correlated errors** (e.g. SMSF taxonomy boundaries — the BT Cash Management
Trust classified `Wrap` by one model and `Bank & Term Deposits` by another; Distribution-Statement
boundary ambiguity — where generator and judge share blind spots and confidently agree on the
wrong answer); and any time you need a **defensible number**.

**For classification specifically:** an ensemble (2 models + frontier judge) is a good **production
routing signal** *and* a good **labelling accelerator** (auto-label at scale, humans verify
disagreements + spot-check agreements). But (a) it still can't self-certify accuracy, and (b) to
auto-accept on "2 models + judge agree" you must know the error rate *when they agree* — which only
a gold set can tell you. Also, a **classification gold set is cheap** (one decision per document vs
5–10 fields for extraction) and yields a **confusion matrix** the judge cannot — so build it.

> **Distilled principle:** LLM-as-judge works without a reference as a *decision tool* to the
> extent the task is *verifiable* or *source-grounded*; it needs a reference (fed or calibrated) to
> become a *measurement*. Judge and gold set are complementary — the reference is what makes the
> judge mean anything.

---

*Companion documents:* `ICE_SCOPE_REVISIONS.md` (scope changes) and `EVALUATION_HARNESS_SPEC.md`
(how to build and run the evaluation).
