#!/usr/bin/env python3
"""Metric 2 — Confident-and-Wrong Rate (CWR) report.

Standalone, read-only report over jobs_db.json. Does not import app.py or
core_engine.py and does not touch any job/job files — safe to run anytime,
against a live jobs_db.json, without affecting the running app.

Data source: each approved file in job["files"] carries `ai_category`,
`ai_confidence` (the Phase-1 AI classification) and `overridden` (whether the
human processor changed the category before sign-off) — set in app.py's
processor-review approval step. See docs/EVALUATION_METRICS_REQUIREMENTS.md,
Metric 2 / Option A, for why this is a production proxy rather than a
ground-truth measurement: it only catches errors a processor noticed, so the
real CWR is >= what this script reports.

Usage:
    python3 metrics/cwr_report.py
    python3 metrics/cwr_report.py --jobs-db /path/to/jobs_db.json --threshold 90
"""

import argparse
import json
import os
from datetime import datetime, timezone

DEFAULT_THRESHOLD = 85
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_JOBS_DB = os.path.join(REPO_ROOT, "jobs_db.json")
DEFAULT_OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")


def load_jobs(jobs_db_path):
    with open(jobs_db_path, "r", encoding="utf-8") as f:
        return json.load(f)


def eligible_records(jobs):
    """Yield one dict per approved file that carries CWR provenance.

    Files from jobs approved before this tracking was added won't have
    `ai_confidence`/`overridden` at all — those are counted as skipped rather
    than silently treated as confident-and-correct.
    """
    for job in jobs:
        for f in job.get("files", []):
            if f.get("status") != "Approved":
                continue
            if f.get("ai_confidence") is None or "overridden" not in f:
                continue
            yield {
                "job_id": job.get("job_id"),
                "fund_name": job.get("fund_name"),
                "original_name": f.get("original_name"),
                "ai_category": f.get("ai_category"),
                "approved_category": f.get("category"),
                "ai_confidence": f.get("ai_confidence"),
                "overridden": bool(f.get("overridden")),
            }


def confidence_bucket(confidence):
    if confidence >= 85:
        return "High (>=85)"
    if confidence >= 60:
        return "Medium (60-84)"
    return "Low (<60)"


def compute_metrics(jobs, threshold):
    files_scanned = sum(len(j.get("files", [])) for j in jobs)
    records = list(eligible_records(jobs))
    skipped = files_scanned - len(records)

    confident = [r for r in records if r["ai_confidence"] >= threshold]
    confident_wrong = [r for r in confident if r["overridden"]]
    cwr = (len(confident_wrong) / len(confident)) if confident else None

    buckets = {}
    for r in records:
        b = confidence_bucket(r["ai_confidence"])
        entry = buckets.setdefault(b, {"total": 0, "overridden": 0})
        entry["total"] += 1
        entry["overridden"] += 1 if r["overridden"] else 0
    for entry in buckets.values():
        entry["override_rate"] = entry["overridden"] / entry["total"] if entry["total"] else None
    # Fixed, human-meaningful ordering rather than insertion order.
    bucket_order = ["High (>=85)", "Medium (60-84)", "Low (<60)"]
    buckets = {k: buckets[k] for k in bucket_order if k in buckets}

    by_category = {}
    for r in confident:
        cat = r["ai_category"] or "Unclassified"
        entry = by_category.setdefault(cat, {"total": 0, "overridden": 0})
        entry["total"] += 1
        entry["overridden"] += 1 if r["overridden"] else 0
    for entry in by_category.values():
        entry["cwr"] = entry["overridden"] / entry["total"] if entry["total"] else None
    by_category = dict(sorted(by_category.items(), key=lambda kv: kv[1]["overridden"], reverse=True))

    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ"),
        "threshold": threshold,
        "totals": {
            "jobs_scanned": len(jobs),
            "files_scanned": files_scanned,
            "files_eligible": len(records),
            "files_skipped_no_provenance": skipped,
        },
        "cwr": {
            "confident_total": len(confident),
            "confident_wrong": len(confident_wrong),
            "rate": cwr,
        },
        "calibration_buckets": buckets,
        "by_category": by_category,
        "confident_wrong_examples": confident_wrong,
    }


def fmt_pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"


def write_json(metrics, out_path):
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)


def render_html(metrics):
    threshold = metrics["threshold"]
    cwr = metrics["cwr"]["rate"]
    cwr_color = "#9ca3af" if cwr is None else ("#16a34a" if cwr <= 0.02 else ("#d97706" if cwr <= 0.10 else "#dc2626"))

    bucket_rows = "".join(
        f"<tr><td>{b}</td><td>{v['total']}</td><td>{v['overridden']}</td>"
        f"<td>{fmt_pct(v['override_rate'])}</td></tr>"
        for b, v in metrics["calibration_buckets"].items()
    ) or "<tr><td colspan='4'>No data yet.</td></tr>"

    category_rows = "".join(
        f"<tr><td>{cat}</td><td>{v['total']}</td><td>{v['overridden']}</td>"
        f"<td>{fmt_pct(v['cwr'])}</td></tr>"
        for cat, v in metrics["by_category"].items()
    ) or "<tr><td colspan='4'>No confident classifications yet.</td></tr>"

    example_rows = "".join(
        f"<tr><td>{e['job_id']}</td><td>{e['fund_name'] or ''}</td>"
        f"<td>{e['original_name'] or ''}</td><td>{e['ai_category']}</td>"
        f"<td>{e['approved_category']}</td><td>{e['ai_confidence']}%</td></tr>"
        for e in metrics["confident_wrong_examples"]
    ) or "<tr><td colspan='6'>None found — either genuinely zero, or not enough eligible data yet.</td></tr>"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>CWR Report — {metrics['generated_at']}</title>
<style>
  body {{ font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 40px; color: #1f2937; background: #f9fafb; }}
  h1 {{ font-size: 20px; margin-bottom: 4px; }}
  .meta {{ color: #6b7280; font-size: 13px; margin-bottom: 28px; }}
  .headline {{ display: flex; align-items: baseline; gap: 14px; background: #fff; border: 1px solid #e5e7eb;
               border-radius: 10px; padding: 20px 24px; margin-bottom: 28px; }}
  .headline .value {{ font-size: 40px; font-weight: 700; color: {cwr_color}; }}
  .headline .label {{ font-size: 14px; color: #4b5563; }}
  .caveat {{ font-size: 12.5px; color: #6b7280; max-width: 640px; margin-top: 6px; }}
  table {{ border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #e5e7eb;
           border-radius: 8px; overflow: hidden; margin-bottom: 28px; }}
  th, td {{ text-align: left; padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #f0f0f1; }}
  th {{ background: #f3f4f6; color: #374151; font-weight: 600; }}
  h2 {{ font-size: 15px; margin: 0 0 10px; color: #111827; }}
  .totals span {{ display: inline-block; margin-right: 22px; font-size: 13px; color: #4b5563; }}
  .totals b {{ color: #111827; }}
</style>
</head>
<body>
  <h1>Confident-and-Wrong Rate (CWR)</h1>
  <div class="meta">Generated {metrics['generated_at']} · confidence threshold &ge; {threshold}</div>

  <div class="headline">
    <div class="value">{fmt_pct(cwr)}</div>
    <div>
      <div class="label">{metrics['cwr']['confident_wrong']} wrong out of {metrics['cwr']['confident_total']} confident classifications</div>
      <div class="caveat">Production proxy, not ground truth: "wrong" here means a human processor
      overrode the AI's category during review. This undercounts — a confident wrong answer that
      no one caught is invisible to this number. See docs/EVALUATION_METRICS_REQUIREMENTS.md
      (Metric 2) for the curated ground-truth approach that removes this bias.</div>
    </div>
  </div>

  <div class="totals">
    <span><b>{metrics['totals']['jobs_scanned']}</b> jobs scanned</span>
    <span><b>{metrics['totals']['files_scanned']}</b> files scanned</span>
    <span><b>{metrics['totals']['files_eligible']}</b> eligible (approved + has provenance)</span>
    <span><b>{metrics['totals']['files_skipped_no_provenance']}</b> skipped (approved before tracking existed)</span>
  </div>

  <h2>Calibration — override rate by confidence bucket</h2>
  <table>
    <tr><th>Bucket</th><th>Total</th><th>Overridden</th><th>Override rate</th></tr>
    {bucket_rows}
  </table>

  <h2>Confident classifications by AI category</h2>
  <table>
    <tr><th>Category (AI)</th><th>Confident total</th><th>Overridden</th><th>CWR</th></tr>
    {category_rows}
  </table>

  <h2>Confident-and-wrong examples</h2>
  <table>
    <tr><th>Job</th><th>Fund</th><th>File</th><th>AI category</th><th>Approved category</th><th>Confidence</th></tr>
    {example_rows}
  </table>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description="Compute Metric 2 (Confident-and-Wrong Rate) from jobs_db.json.")
    parser.add_argument("--jobs-db", default=DEFAULT_JOBS_DB, help="Path to jobs_db.json (default: repo root)")
    parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD, help="Confidence >= threshold counts as 'confident' (default: 85)")
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help="Output directory for the report files (default: metrics/output)")
    args = parser.parse_args()

    jobs = load_jobs(args.jobs_db)
    metrics = compute_metrics(jobs, args.threshold)

    os.makedirs(args.out_dir, exist_ok=True)
    json_path = os.path.join(args.out_dir, "cwr_report.json")
    html_path = os.path.join(args.out_dir, "cwr_report.html")
    write_json(metrics, json_path)
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(render_html(metrics))

    print(f"CWR (threshold >= {args.threshold}): {fmt_pct(metrics['cwr']['rate'])} "
          f"({metrics['cwr']['confident_wrong']}/{metrics['cwr']['confident_total']})")
    print(f"Eligible files: {metrics['totals']['files_eligible']} / {metrics['totals']['files_scanned']} scanned "
          f"({metrics['totals']['files_skipped_no_provenance']} skipped — no provenance)")
    print(f"JSON report: {json_path}")
    print(f"HTML report: {html_path}")


if __name__ == "__main__":
    main()
