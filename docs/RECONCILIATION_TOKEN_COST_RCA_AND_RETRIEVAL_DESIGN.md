# Reconciliation Token-Cost RCA & Retrieval-Based Solution Design

**Status:** Design proposal
**Date:** 2026-06-28
**Owner:** Trinity team
**Affected code:** `core_engine.py` → `build_reconciliation_prompt` (~L1471), `run_reconciliation_call` (L1567), `reconcile_papers` (L845), Phase 2 orchestrator (L2250)

---

## 1. Premise of the problem

The Phase 2 bank reconciliation step matches every bank transaction (date, description, debit/credit) against the fund's **supporting documents** (invoices, dividend statements, distribution advices, contract notes, portfolio valuations, etc.) and classifies each transaction as `matched` (evidence found) or `unmatched`.

We observed that the per-fund LLM cost is rising as funds grow, and a "below-average" fund (Seyffer Super 1) cost **$1.50** for a single Accounting_Audit job. The end goal is to **reduce token cost as files grow**, without sacrificing audit accuracy.

### What the cost data actually shows

Token-usage records pulled from `jobs_db.json` for the Seyffer Super 1 job (2026-06-28 11:44):

| Phase 2 call            | Input tokens | Output tokens | Cost     |
|-------------------------|-------------:|--------------:|---------:|
| **`phase2_reconcile`**  | **573,373**  | 455           | **$1.44** |
| `phase2_checklist`      | 10,959       | 2,493         | $0.0199  |
| 7 other phase2 calls    | ~5,800       | ~900          | ~$0.01   |
| **Phase 2 total**       | ~590,000     | ~3,600        | **$1.46** |
| Phase 1 (34 calls)      | 37,332       | 3,151         | $0.04    |
| **Job total**           | —            | —             | **$1.50** |

**One call — `phase2_reconcile` — is 95% of the entire job cost.** For reference, the *total spend across all 27 jobs ever run* is only ~$2.24, and Seyffer alone is most of it.

The model in use is `x-ai/grok-4.20` at **$3.00 / 1M input** and **$15.00 / 1M output** (`llm_pricing.json`). At those rates, 573K input tokens = $1.72 of input list price (OpenRouter billed $1.44 actual). Output tokens are negligible — **this is an input-token problem.**

---

## 2. Root cause

The reconciliation prompt is built by **dumping the full extracted text of every supporting document into a single prompt**. From `build_reconciliation_prompt` (`core_engine.py` ~L1471):

```python
supporting_docs_lines = []
for doc in phase2_context.get("supporting_documents", []):
    doc_text = _extract_supporting_doc_text(doc_path, scratch_dir)
    if "Portfolio Valuation" in doc_category:
        doc_text = _extract_portfolio_holdings(doc_text, doc_name)   # only PV is summarised
    supporting_docs_lines.append(f"=== {doc_name} (Category: {doc_category}) ===\n{doc_text}")

supporting_docs_block = "\n\n".join(supporting_docs_lines)   # ← 573K tokens for Seyffer
```

Every supporting document, in full, is concatenated into the system prompt on **every** reconciliation call (only Portfolio Valuations get a structured summary). The LLM is being used as a **brute-force matcher that re-reads the entire document corpus to find each match.**

### Why this is the wrong shape

- **Cost scales with corpus size, not with the matching work.** `cost ≈ Σ(all supporting doc text)`. Add more statements/invoices and the single prompt grows linearly — exactly the trend being felt.
- **It is the one call a local/cheaper model cannot rescue.** 573K tokens exceeds the context window of small local models (e.g. Qwen3-14B: 32K native / ~128K with degraded YaRN) and their hardware (KV cache for 573K tokens ≈ 89 GB at fp16, vs 24 GB total on an M4 Pro). The expensive call is the one that *can't* be moved off the frontier model under the current design.
- **Chunking / map-reduce does NOT fix it.** Splitting the docs across several calls sends the *same* total doc text — same token total, same cost. The only lever that genuinely reduces cost is **ensuring most document bytes never reach the LLM at all.**

### The reframe that unlocks the fix

Relevance is **not** metadata we have up front (nothing tags a doc with an account — it is a doc dump). Relevance is a **join we compute**. Reconciliation is not "docs belong to accounts," it is **"this transaction is supported by this doc,"** and the link is almost always a **number**:

> A $1,234.56 payment leaving the bank matches an invoice that says **$1,234.56**.
> A $4,200.00 credit labelled "DIV" matches a dividend statement that says **$4,200.00**.

The **dollar amount is a join key**, extractable from *both* sides with plain code — transactions are already structured (debit/credit fields), and a regex pulls every dollar figure from a document. We do the search ourselves, cheaply, and only ask the LLM to adjudicate the ambiguous remainder.

---

## 3. Solution approach: index once, retrieve cheaply, LLM adjudicates only

Replace "dump everything → one giant LLM call" with a **retrieval pipeline**: a deterministic candidate-matching layer in front of the LLM, so the model sees only small candidate snippets instead of the whole corpus.

```
                 ┌─────────────────────────────────────────────────────────┐
   Doc dump ───► │ STAGE A: fingerprint every doc ONCE (code, ~free)        │
                 │   → {filename, category, amounts[], dates[], entities[]}  │
                 └─────────────────────────────────────────────────────────┘
                                          │  (index)
   Transactions ─────────────────────────┼─────────────────────────────────┐
                 ┌────────────────────────▼────────────────────────────────┐│
                 │ STAGE B: per-transaction candidate generation (code, 0 tok)│
                 │   score docs by amount + date + name → top 3–5 candidates  │
                 └────────────────────────┬────────────────────────────────┘│
                                          │                                   │
                 ┌────────────────────────▼────────────────────────────────┐│
                 │ STAGE C: tiered resolution                                ││
                 │   1. Auto-match (no LLM)   — unique exact amount+date+name││
                 │   2. LLM adjudicate (tiny) — ambiguous candidates only    ││
                 │   3. Unmatched (no LLM)    — no candidate clears threshold││
                 └───────────────────────────────────────────────────────────┘
```

### Stage A — Fingerprint every document once (local, ~free)

Walk the doc dump a **single time** and reduce each document to a lightweight structured record. The text is already being extracted today (`_extract_supporting_doc_text`), and the category/name already come from Phase-1 classification — so this largely **reuses existing work**.

For each supporting document, produce:

```jsonc
{
  "filename": "Invoice_AcmeAccounting_0312.pdf",
  "category": "Expense Invoice",
  "amounts":  [1234.56, 89.00],          // regex over the text — every $ figure
  "dates":    ["2026-03-12"],            // regex — invoice/statement dates
  "entities": ["Acme Accounting", "BHP"], // names/tickers; reuse classification output
  "snippets": { "1234.56": "Invoice total: $1,234.56 due 12/03/2026" }  // line per key amount
}
```

- **Amounts & dates → regex.** Reliable, deterministic, zero tokens.
- **Entities & category → reuse Phase-1 classification** (already produced). Optionally one cheap `gemini-2.5-flash` pass per doc if richer entities are needed — still O(docs), small prompts.
- **Snippets** = the single line/section around each key amount, kept so Stage C can show the LLM evidence without resending the whole doc.

Cost characteristic: **O(number of docs)** of cheap local work. Each document is read by code exactly once; no document is ever placed into a mega-prompt.

### Stage B — Candidate generation per transaction (pure code, zero tokens)

For each bank transaction, score every doc fingerprint and keep the top 3–5:

| Signal              | Strength | How                                                            |
|---------------------|----------|---------------------------------------------------------------|
| Exact amount match  | Very strong | `txn.amount == doc.amount`                                  |
| Fuzzy amount match  | Strong   | within tolerance for fees / rounding / FX                      |
| Date proximity      | Supporting | doc date within a window (e.g. ±N days) of txn date          |
| Name / token overlap| Supporting | txn description tokens ∩ doc entities ("BHP DIVIDEND" ↔ "BHP") |

This is a numeric join plus fuzzy string match — **milliseconds, no LLM, no tokens**. "Relevant docs for this transaction" is the *output* of this stage, not a precondition. (Account grouping, if ever needed, simply falls out of which transactions matched which docs.)

### Stage C — Tiered resolution

1. **Auto-match (no LLM).** Unique exact-amount candidate + date in window + name overlap → mark `matched`, record the document. Expected to cover ~50–70% of lines in typical SMSF books. This produces a **deterministic, explainable audit trail** ("matched on exact amount $1,234.56, within 2 days") — strictly better audit evidence than "the LLM decided."
2. **LLM adjudicates (tiny prompts).** Only ambiguous lines — multiple candidates, fuzzy-only amount, or name mismatch. Send the transaction + the 3–5 candidate **snippets** (~150 tokens each), *not* whole documents. Can run on the cheap fallback (`google/gemini-2.5-flash`, ~20× cheaper) and be benchmarked against Grok on known funds.
3. **Unmatched (no LLM).** No candidate clears threshold → `unmatched` with the specific reason (reusing the existing `unmatched_reason` logic), e.g. "No invoice found for this $X payment dated DD/MM."

---

## 4. Why this works (and what to expect)

- **Cost driver removed.** Code reads all ~573K tokens of doc text; the LLM sees only candidate snippets — on the order of 20–40K tokens, and routable to a cheaper model. **Estimated Seyffer: $1.50 → a few cents.**
- **Scales with matching work, not corpus size.** Adding documents adds cheap Stage-A fingerprinting, not LLM input tokens.
- **Better audit posture.** Most matches become deterministic and explainable; the LLM is reserved for genuine judgement calls.
- **Model-agnostic.** The saving holds whether the adjudication model is Grok, Gemini Flash, or a local model — and the adjudication prompts are now small enough that a local model becomes viable for that step.

---

## 5. Hard cases & handling

| Case | Handling |
|------|----------|
| **Duplicate amounts** (recurring $500 contributions) | Amount alone is ambiguous → disambiguate by date + name; escalate the line to Stage C.2 if still tied. |
| **One doc → many transactions** (portfolio valuation; invoice paid in installments) | Allow many-to-one; do not "consume" a doc on first match. |
| **Amount not verbatim in doc** (distribution advice: units × price, gross vs net) | Amount join misses → this is precisely where the LLM earns its place; escalate only these lines. |
| **Internal transfers** | Detect with **zero docs, zero tokens**: equal-and-opposite amounts across two of the fund's own accounts on nearby dates. |
| **OCR noise** on scanned docs | Fuzzy amount tolerance + date window absorb most noise; unresolved lines escalate to Stage C.2. |

---

## 6. On embeddings / "real" RAG

The instinct is "vector-search the docs." For reconciliation it is **secondary**: embeddings are weak at exact numeric matching, and reconciliation lives or dies on exact numbers. Start with the structured amount/date/name index (Stages A–B). Add embeddings **only** if *name* matching proves too weak (abbreviations, synonyms). For the POC, defer them.

---

## 7. Implementation notes (reuse map)

- **Stage A** plugs in where `phase2_context["supporting_documents"]` is assembled; reuse `_extract_supporting_doc_text` (already called) and Phase-1 classification metadata. Generalise the existing `_extract_portfolio_holdings` summarisation pattern into per-doc fingerprinting.
- **Stage B** is a new pure-Python candidate matcher consuming the index + `transactions_by_account` (already available in `run_reconciliation_call`).
- **Stage C** rewrites `build_reconciliation_prompt` so the LLM receives **candidate snippets per transaction** instead of `supporting_docs_block`; auto-matched and unmatched lines bypass the LLM entirely. Keep the existing JSON schema and `unmatched_reason` contract so downstream (`reconcile_papers`, workpaper generation) is unaffected.
- **Quick partial win** (independent of full retrieval): route `phase2_reconcile` to `google/gemini-2.5-flash` and benchmark accuracy on Seyffer / ADMCM / Rigney — a near-zero-engineering ~20× cut while the retrieval pipeline is built.

---

## 8. Summary

The $1.50 fund is **one runaway prompt** (`phase2_reconcile`, 573K input tokens) caused by dumping the **entire supporting-document corpus** into a single LLM call. The fix is not a cheaper model or chunking — it is **retrieval**: fingerprint docs once with code (Stage A), generate candidates per transaction via an amount/date/name join (Stage B), and let the LLM adjudicate only the ambiguous remainder (Stage C). This cuts cost from dollars to cents, scales with matching effort rather than corpus size, and produces a more defensible audit trail.
