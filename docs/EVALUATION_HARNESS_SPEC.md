# Evaluation Harness — Specification

How to build and run the evaluation that turns a labelled **gold set** into a defensible accuracy
gate and a standing quality instrument for ICE (document **identification** + **key-field
extraction**).

Read alongside `EXTRACTION_METRICS_EXPLAINED.md` (the metric definitions this harness computes) and
`ICE_SCOPE_REVISIONS.md` (why the gate is scoped the way it is).

---

## 1. Gold set — the input (sizing recap)

**Population being estimated:** ~210,000 documents/cycle (10,500 funds × ~20 docs), across **114
distinct extraction schemas** (no collapse — each type has its own fields).

**Tiered gold set (size by volume × downstream risk, not uniformly):**

| Tier | What | # types (illustrative) | Labelled/type | Use |
|---|---|---|---|---|
| **1 — vital few** | High volume and/or ledger-critical | ~15 | ~150–200 | **Individually gated** (±2–3%) |
| **2 — moderate** | Meaningful volume, lower risk | ~30 | ~50–75 | Reported, soft gate (±4–5%) |
| **3 — long tail** | Rare types | ~70 | pooled / ~10–15 or defer | **Aggregate** (field-instance level) + production audit |

- **The 95% gate is scoped to Tier-1 priority types.** Tail is monitored, not individually gated.
- **A worked Tier-1 total ≈ 2,600 labelled docs** is a realistic starting point.
- **Prerequisite from client:** the per-type document-frequency distribution (to choose the
  Tier-1 ~15) and help curating a **type-balanced** set (a random pull is ~70% bank statements).

**Acquisition:** back-derive labels from finalised Class/BGL ledgers & prior workpapers (highest
leverage — ground truth BeFree already owns); harvest human-verified POC outputs; assisted
labelling for bulk; a **blind-labelled trusted core (~50/Tier-1 type)** as the acceptance ruler;
rolling growth from production corrections. Confidence-interval basis for these sizes: see
`EXTRACTION_METRICS_EXPLAINED.md` §6.

---

## 2. Build & run sequence

Ordered. Steps **0, 1, 2, 5** are the ones commonly skipped and expensive to skip.

### Step 0 — QA the gold set *before* measuring against it
You cannot measure against a noisy ruler.
- Resolve **double-labelled disagreements**; measure **inter-annotator agreement** per field. Low
  agreement ⇒ the field *definition* is ambiguous — fix the definition, not the system.
- Compare the **assisted-labelled slice vs a blind slice** to quantify **anchoring bias** (how much
  assisted labels inflate measured accuracy). Double-labelling does **not** remove anchoring if
  both labellers saw the pre-fill.
- **Output:** an adjudicated, trusted gold set.

### Step 1 — Freeze, version, and split
- **Freeze & version** (`goldset-v1`) — immutable, so every number names the ruler it was measured
  against.
- **Split, stratified by type**, into a **dev set (~60%)** — inspected during prompt iteration —
  and a **held-out test set (~40%)** — **never inspected during tuning**, measured only for the
  gate.
- **Why:** iterating a prompt against the whole gold set **overfits** it and inflates the number.
  The held-out slice is the only honest final figure. (train/dev/test discipline applied to prompt
  engineering.)

### Step 2 — Lock the per-field match rules (before seeing any score)
Define what "correct" means, per field type, and **lock it** so no rule gets loosened later to hit
a number:

| Field type | Match rule |
|---|---|
| Amounts | numeric, to the cent (`25,500.00` == `25500`) |
| Dates | normalized to ISO (`05/06/2024` == `2024-06-05`) |
| Account/BSB numbers | digits only, exact |
| Names | trimmed, case-insensitive; fuzzy-equivalence (`J. Smith ≡ John Smith`) optionally via LLM-judge comparator |
| Optional fields | 3-state truth: value / **absent** / illegible; score present→recall, absent→precision |

### Step 3 — Build the harness
For each gold doc, run the **exact production pipeline** and compare to labels.

```
for doc in goldset:
    predicted_type            = pipeline.identify(doc)          # classification
    fields, confidences       = pipeline.extract(doc)           # extraction + per-field confidence
    for f in schema(true_type):
        got  = normalize(fields.get(f), rules[f])
        truth = normalize(labels[doc][f], rules[f])
        outcome = classify_outcome(got, truth)   # correct | wrong | missed | spurious
        record(doc, f, outcome, confidences[f], predicted_type, true_type)
emit_scorecard(records)
```

- Captures predicted **type**, each **field value**, and its **confidence**.
- Measures **both tasks**: classification (predicted vs true type) and extraction (field values).
- Run each doc a few times at **temperature 0** to also report **run-to-run stability**.

### Step 4 — Baseline run
Run on the **dev set** → first real numbers. Expect them below the POC's 98% *confidence* — that is
the point (confidence ≠ accuracy).

### Step 5 — Scorecard + error analysis (highest-value step)
Don't just read the top line — **bucket the failures**:
- **Classification:** build the **confusion matrix** — which of the 114 types get mistaken for
  which (surfaces BT CMT ↔ Wrap, Distribution-Statement boundaries, etc.).
- **Extraction:** separate **OCR failures** (value never left the page) from **extraction failures**
  (legible but wrong) from **ambiguous-label** cases (the label itself is debatable). Each needs a
  different fix.

### Step 6 — Calibrate the confidence threshold
Bucket gold-set predictions by confidence; measure accuracy and CWR per bucket. Find the confidence
level where CWR drops below the safety ceiling → that is the **production auto-accept cutoff**
(e.g. "auto-accept ≥ 0.92, route the rest; at ≥0.92 measured CWR = 0.8%"). This turns the gold set
into the production routing policy.

### Step 7 — Set the gate thresholds (from the baseline, on the held-out test)
Set the committed numbers now — not from the POC confidence:
- **Accuracy floor** per Tier-1 type (value accuracy, mandatory fields).
- **CWR ceiling** `≤ [Y]%` (per-field and per-document — recall the compounding).
- **Straight-through rate** (auto-accepted share at the error ceiling).
- **Coverage** (docs processed end-to-end).

### Step 8 — Iterate → re-measure → regression-compare
Fix prompt/playbook/validators from Step 5 → re-run on the **dev set** → keep if the number rose,
revert if it fell. Measure the **held-out test set only occasionally** (milestones) to avoid
overfitting it. Keep `classify_workpapers.py` in sync with the `classify_papers` prompt.

### Step 9 — Wire it as a CI merge gate
The harness runs on any prompt/model/OCR change; build **fails on regression**. Use **mocked
fixtures** so it's deterministic and needs no live keys — that is what makes it a real gate. (The
repo's Confident-and-Wrong-Rate tooling already anticipates this.)

### Step 10 — Production monitoring + rolling growth
- **Monthly blind audit:** random sample **including auto-accepted docs** → live accuracy/CWR +
  drift detection (see `EXTRACTION_METRICS_EXPLAINED.md` §5.4, §7).
- Every reviewer correction feeds **`goldset-v2`** for free.

---

## 3. Scorecard format

**Per field, per document type:**

| Field | Accuracy | Precision | Recall | CWR (field) | n |
|---|---|---|---|---|---|
| account_number | 98.2% | 99.1% | 98.4% | 0.4% | 400 |
| closing_balance | 94.1% | 96.0% | 95.2% | 1.1% | 400 |
| statement_date | 91.7% | 93.5% | 92.0% | 2.3% | 400 |

**Per document-type rollup:** overall accuracy, coverage, straight-through rate, **per-document CWR**
(≥1 auto-accepted field wrong), stability (run-to-run).

**Classification:** overall type-accuracy + **confusion matrix** (N×N over the tiered types;
aggregate the tail).

---

## 4. The gate, expressed against the harness

> On `goldset-v1` held-out test, across Tier-1 document types: **value accuracy ≥ [X]% on mandatory
> key fields**, **Confident-and-Wrong Rate ≤ [Y]%** (per-field and per-document), **straight-through
> rate ≥ [Z]%**, **coverage ≥ [C]%** — measured by the harness, per field and per type. Tier-2
> reported; the long tail monitored in aggregate via production audit.

Every number names the set it was measured on and is reproducible by re-running the harness — which
is what makes it controllable rather than arguable at sign-off.

---

## 5. Deliverables checklist

- [ ] Adjudicated, versioned gold set (`goldset-v1`) with inter-annotator agreement + anchoring-bias
      gap recorded.
- [ ] Stratified **dev / held-out test** split.
- [ ] Locked **per-field match rules** doc.
- [ ] **Eval harness** (classification + extraction; captures value + confidence; emits scorecard +
      confusion matrix; deterministic mocked-fixture mode for CI).
- [ ] **Baseline scorecard** + written error analysis (OCR vs extraction vs label buckets).
- [ ] **Confidence-calibration** table → auto-accept cutoff.
- [ ] **Gate thresholds** set from baseline (`X/Y/Z/C`).
- [ ] **CI merge gate** wired.
- [ ] **Production audit** procedure (monthly blind sample incl. auto-accepted) + rolling-growth
      path to `goldset-v2`.

---

*Companion documents:* `ICE_SCOPE_REVISIONS.md` and `EXTRACTION_METRICS_EXPLAINED.md`.
