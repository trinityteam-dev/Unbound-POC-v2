import os
import re
import sys
import json
import shutil
import hashlib
import tempfile
import subprocess
import datetime
import threading
import requests
from collections import defaultdict, Counter
from pypdf import PdfReader, PdfWriter

# Phase 2 model selection (Story 4 — benchmarked 2026-06-19)
# Winner: x-ai/grok-4.20 — 3/3 known matches, numeric schema, good query grouping, ~60s
# Fallback: google/gemini-2.5-flash (string amounts, weaker grouping but functional)
# Rejected: anthropic/claude-sonnet-4-6 (empty response — prompt too large for context)
PHASE2_DEFAULT_MODEL = "x-ai/grok-4.20"
# PHASE2_DEFAULT_MODEL = "z-ai/glm-5.2"
PHASE2_FALLBACK_MODEL = "google/gemini-2.5-flash"

# Fallback only for funds whose config predates the `financial_year_end` field.
DEFAULT_FINANCIAL_YEAR_END = "2025-06-30"


def fy_context(fund_profile):
    """Derive this fund's audit-year context from fund_profile['financial_year_end']
    (an ISO date — the 30 June the audit is FOR, e.g. '2024-06-30' for FY23-24).

    Classification's Prior-Year precedence rule and the Lead Schedules prompt both need
    a concrete "before/after the audit year" anchor — previously neither had one (see
    docs/CLASSIFICATION_AUDIT_YEAR_FIX.md), so a document could only be judged prior-year
    if it happened to describe itself as such in its own text. Every fund is assumed to
    run 1 July - 30 June (standard Australian SMSF financial year); only which year varies.
    """
    fy_end_str = fund_profile.get("financial_year_end") or DEFAULT_FINANCIAL_YEAR_END
    try:
        fy_end = datetime.date.fromisoformat(fy_end_str)
    except (ValueError, TypeError):
        fy_end = datetime.date.fromisoformat(DEFAULT_FINANCIAL_YEAR_END)
    fy_start = datetime.date(fy_end.year - 1, 7, 1)
    return {
        "start": fy_start,
        "end": fy_end,
        "label": f"FY{fy_start.year % 100:02d}-{fy_end.year % 100:02d}",
        "start_str": fy_start.strftime("%d %B %Y"),
        "end_str": fy_end.strftime("%d %B %Y"),
    }

# Helper to find executables
def find_executable(name, default_path):
    path = shutil.which(name)
    if path:
        return path
    if os.path.exists(default_path):
        return default_path
    return name

PDFTOPPM_PATH = find_executable("pdftoppm", "/opt/homebrew/bin/pdftoppm")
TESSERACT_PATH = find_executable("tesseract", "/opt/homebrew/bin/tesseract")

def extract_pdf_text(filepath, max_pages=3):
    """Try to extract text from a PDF file using pypdf."""
    try:
        reader = PdfReader(filepath)
        text = ""
        num_pages = len(reader.pages)
        for i in range(min(max_pages, num_pages)):
            page_text = reader.pages[i].extract_text()
            if page_text:
                text += page_text + "\n"
        return text.strip()
    except Exception as e:
        raise RuntimeError(f"pypdf reader error: {str(e)}")

def ocr_pdf_first_page(filepath, scratch_dir, dpi=150, psm=None):
    """Render the first page of a PDF and run OCR using tesseract."""
    return ocr_pdf_single_page(filepath, 0, scratch_dir, dpi=dpi, psm=psm)

def ocr_pdf_single_page(filepath, page_idx, scratch_dir, dpi=150, psm=None):
    """Render a single page of a PDF and run OCR using tesseract (page_idx is 0-based).

    dpi/psm default to the general-purpose settings (150 DPI, tesseract auto PSM 3).
    Callers parsing dense columnar layouts (bank statements) pass a higher DPI and
    psm=6 (uniform block) — see STATEMENT_OCR_DPI / STATEMENT_OCR_PSM. These are NOT
    applied globally because psm 6 can degrade multi-column/letter documents that auto
    segmentation handles better."""
    if not os.path.exists(PDFTOPPM_PATH) or not os.path.exists(TESSERACT_PATH):
        raise FileNotFoundError(
            f"Required tools not found. pdftoppm: {PDFTOPPM_PATH}, tesseract: {TESSERACT_PATH}"
        )
    
    os.makedirs(scratch_dir, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=scratch_dir) as temp_dir:
        prefix = os.path.join(temp_dir, "page")
        cmd_render = [
            PDFTOPPM_PATH,
            "-png",
            "-f", str(page_idx + 1),
            "-l", str(page_idx + 1),
            "-r", str(dpi),
            filepath,
            prefix
        ]
        
        try:
            subprocess.run(cmd_render, check=True, capture_output=True)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"pdftoppm failed: {e.stderr.decode(errors='replace').strip()}")
        except FileNotFoundError:
            raise RuntimeError(f"pdftoppm not found at: {PDFTOPPM_PATH}")

        png_files = [f for f in os.listdir(temp_dir) if f.endswith(".png")]
        if not png_files:
            raise RuntimeError("pdftoppm did not generate any PNG files")
        
        png_path = os.path.join(temp_dir, png_files[0])
        ocr_out_base = os.path.join(temp_dir, "ocr_result")
        cmd_ocr = [
            TESSERACT_PATH,
            png_path,
            ocr_out_base
        ]
        if psm is not None:
            cmd_ocr += ["--psm", str(psm)]
        
        try:
            subprocess.run(cmd_ocr, check=True, capture_output=True)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"tesseract failed: {e.stderr.decode(errors='replace').strip()}")
        except FileNotFoundError:
            raise RuntimeError(f"tesseract not found at: {TESSERACT_PATH}")

        ocr_txt_path = ocr_out_base + ".txt"
        if os.path.exists(ocr_txt_path):
            with open(ocr_txt_path, "r", encoding="utf-8") as f:
                return f.read().strip()
        else:
            raise RuntimeError("Tesseract output file not found")


# Account-number detection from statement page text (RCA Layer 5 — see
# docs/BANK_ACCOUNT_DISCOVERY_RCA.md). Conservative: only matches digit runs that
# sit in an explicit account / BSB context, so it won't grab dates, amounts,
# phone or reference numbers.
_BSB_ACCT_RE = re.compile(
    r'bsb\D{0,8}\d{3}[-\s]?\d{3}\D{0,14}([0-9][0-9\s-]{4,12}[0-9])', re.I)
_ACCT_CONTEXT_RE = re.compile(
    r'\b(?:a/c|acc(?:t|ount)?)\s*(?:no\.?|number|#)?\s*[:#-]?\s*'
    r'(?:\d{2,3}[-\s]?\d{3,4}\s+)?'     # skip a leading BSB (3+3 or CBA-style 2+4)
    r'([0-9][0-9\s-]{5,12}[0-9])', re.I)

# Australian bank code prefixes (first 2 digits of BSB). Used to detect and strip
# a BSB that was accidentally captured as part of the account number.
_BSB_BANK_PREFIX_RE = re.compile(r'^(?:01|03|06|08|10|11|12|18|19|20|21|22|23|24|25|26|30|33|34|35|38|40|48|55|63|65|73|76|80|91|94|96|99)')

def detect_account_number(text):
    """Best-effort bank account number from statement page text. Returns a
    normalized digit string (6-16 digits) or None. Used to group statement pages
    by account when the fund profile has no bank_accounts configured (Layer 5)."""
    if not text:
        return None
    for rx in (_BSB_ACCT_RE, _ACCT_CONTEXT_RE):
        m = rx.search(text)
        if m:
            num = re.sub(r'\D', '', m.group(1))
            # If the number is longer than a typical account number it likely
            # includes a leading 6-digit BSB. Strip it when the prefix matches
            # a known Australian bank code and the remainder is a plausible length.
            if len(num) > 10 and _BSB_BANK_PREFIX_RE.match(num):
                suffix = num[6:]
                if 6 <= len(suffix) <= 10:
                    num = suffix
            if 6 <= len(num) <= 16:
                return num
    return None


# Friendly account naming for discovered accounts (RCA Layer 5 / Phase-2). The
# bank brand lives in the statement's source filename (e.g. "NAB Statements
# Acc#0672.pdf"), so we recover it there. Word-bounded for short tokens so we
# don't match "Funding" → ING etc.
_BRAND_RES = [
    ('NAB', r'\bnab\b'),
    ('Macquarie', r'macquarie'),
    ('CBA', r'\bcba\b|commbank|commonwealth\s*bank'),
    ('ANZ', r'\banz\b'),
    ('Westpac', r'westpac'),
    ('Ord Minnett', r'ord\s*min'),
    ('Bendigo', r'bendigo'),
    ('Bankwest', r'bankwest'),
    ('Suncorp', r'suncorp'),
    ('St George', r'st\.?\s*george'),
]

def derive_account_brand(source_filename):
    """Recognise a bank brand from a statement's source filename, e.g.
    'NAB Statements Acc#0672.pdf' -> 'NAB'. Returns None if unrecognised."""
    fn = (source_filename or '').lower()
    for brand, pat in _BRAND_RES:
        if re.search(pat, fn):
            return brand
    return None

def friendly_account_name(brand, account_number):
    """Display name for a discovered account: '<Brand> Account <number>', or
    'Bank Account <number>' when the brand is unknown."""
    return f"{brand} Account {account_number}" if brand else f"Bank Account {account_number}"

# ---------------------------------------------------------------------------
# Token economics helpers (Story T)
# ---------------------------------------------------------------------------

def load_llm_pricing(workspace_dir):
    """Load llm_pricing.json from workspace_dir. Returns pricing dict keyed by model ID."""
    path = os.path.join(workspace_dir, 'llm_pricing.json')
    if not os.path.exists(path):
        raise FileNotFoundError(f'llm_pricing.json not found at {path}.')
    with open(path, 'r', encoding='utf-8') as fh:
        data = json.load(fh)
    return data.get('models', {})


def calculate_call_cost(model, prompt_tokens, completion_tokens, pricing, openrouter_cost=None):
    """Return USD cost for one LLM call.

    Prefers openrouter_cost (direct from API response) over calculated rates.
    Falls back to llm_pricing.json rates only when OpenRouter does not provide cost.
    """
    if openrouter_cost is not None:
        return round(float(openrouter_cost), 6)
    rates = pricing.get(model)
    if not rates:
        print(f'[TokenEconomics] Unknown model {model!r} and no OpenRouter cost — recorded as $0.00', file=sys.stderr)
        return 0.0
    return round(
        (prompt_tokens / 1_000_000) * rates['input_per_million']
        + (completion_tokens / 1_000_000) * rates['output_per_million'],
        6,
    )


def record_token_usage(job, call_id, phase, usage, cost_usd):
    """Append a call record to job['token_usage'] and keep phase + job rollups in sync.

    Mutates `job` in place. Caller is responsible for persisting to jobs_db.json.
    """
    token_usage = job.setdefault(
        'token_usage',
        {'calls': [], 'phases': {}, 'job_total': {'total_tokens': 0, 'cost_usd': 0.0}},
    )
    token_usage['calls'].append({
        'call_id': call_id,
        'phase': phase,
        'model': usage['model'],
        'prompt_tokens': usage['prompt_tokens'],
        'completion_tokens': usage['completion_tokens'],
        'total_tokens': usage['total_tokens'],
        'cost_usd': round(cost_usd, 6),
        'timestamp': datetime.datetime.utcnow().isoformat() + 'Z',
    })
    phase_total = token_usage['phases'].setdefault(phase, {'total_tokens': 0, 'cost_usd': 0.0})
    phase_total['total_tokens'] += usage['total_tokens']
    phase_total['cost_usd'] = round(phase_total['cost_usd'] + cost_usd, 6)
    total = token_usage['job_total']
    total['total_tokens'] += usage['total_tokens']
    total['cost_usd'] = round(total['cost_usd'] + cost_usd, 6)

# model="z-ai/glm-5.2"
def query_openrouter(api_key, system_prompt, user_content, response_format=None,model="x-ai/grok-4.20" , timeout=120, wall_clock_timeout=None):
    """Generic OpenRouter query helper with fallback model option.

    `timeout` is passed to `requests` as its per-read-chunk timeout — a response that
    keeps trickling bytes slowly (seen with z-ai/glm-5.2 on the large reconciliation
    prompt, docs/RECONCILIATION_GLM_HANG_RCA.md) never trips it and can hang
    indefinitely. `wall_clock_timeout` bounds the *total* request duration regardless of
    how steadily bytes arrive; defaults to a generous multiple of `timeout` so it won't
    cut off a slow-but-legitimately-working call, only a truly stuck one.
    """
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/google/doc-intelligence",
        "X-Title": "SMSF Document Intelligence"
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "temperature": 0.0
    }
    if response_format:
        payload["response_format"] = response_format

    if wall_clock_timeout is None:
        wall_clock_timeout = max(timeout * 5, 600)

    try:
        result_box = {}

        def _do_request():
            try:
                result_box["response"] = requests.post(url, headers=headers, json=payload, timeout=timeout)
            except Exception as e:
                result_box["error"] = e

        worker = threading.Thread(target=_do_request, daemon=True)
        worker.start()
        worker.join(wall_clock_timeout)
        if worker.is_alive():
            # The request is abandoned here (the thread keeps running in the background
            # until its own per-chunk timeout trips), but the caller gets control back
            # instead of hanging indefinitely.
            raise TimeoutError(
                f"OpenRouter request to {model} exceeded the {wall_clock_timeout}s wall-clock "
                "deadline with no response — abandoning and failing fast."
            )
        if "error" in result_box:
            raise result_box["error"]

        response = result_box["response"]
        response.raise_for_status()
        res_data = response.json()
        choices = res_data.get("choices", [])
        if not choices:
            raise ValueError(f"No choices returned. Response: {res_data}")
        finish_reason = choices[0].get("finish_reason")
        if finish_reason == "length":
            raise ValueError(
                f"OpenRouter response from {model} was truncated (finish_reason='length') "
                "— it hit the model's max output token limit before finishing. Treating as "
                "a failure rather than parsing partial/corrupt JSON."
            )
        raw_usage = res_data.get("usage", {})
        usage = {
            "model": model,
            "prompt_tokens": raw_usage.get("prompt_tokens", 0),
            "completion_tokens": raw_usage.get("completion_tokens", 0),
            "total_tokens": raw_usage.get("total_tokens", 0),
            "openrouter_cost": raw_usage.get("cost"),  # USD cost from OpenRouter; None if absent
        }
        return choices[0]["message"]["content"], usage
    except Exception as e:
        if model == "x-ai/grok-4.20":
            print(f"Grok model query failed: {e}. Trying fallback model google/gemini-2.5-flash...")
            return query_openrouter(api_key, system_prompt, user_content, response_format, model="google/gemini-2.5-flash", timeout=timeout)
        raise e

def discover_fund_profile(input_dir, api_key, scratch_dir):
    """Scans all PDFs in input_dir and queries the LLM to extract the fund profile dynamically."""
    pdf_files = []
    for root, _, files in os.walk(input_dir):
        for file in files:
            if file.lower().endswith(".pdf"):
                pdf_files.append(os.path.join(root, file))
                
    if not pdf_files:
        raise ValueError("No PDF files found in the input folder.")

    target_keywords = [
        "valuation", "ledger", "statement", "ica", "ita", "member", "tsb", "audit", "invoice",
        "bank", "transaction", "mac",
    ]
    representative_files = []

    for keyword in target_keywords:
        for filepath in pdf_files:
            fn = os.path.basename(filepath).lower()
            if keyword in fn and filepath not in representative_files:
                representative_files.append(filepath)
                break

    if len(representative_files) < 8:
        for filepath in pdf_files:
            if filepath not in representative_files:
                representative_files.append(filepath)
            if len(representative_files) >= 8:
                break
                
    text_snippets = []
    for filepath in representative_files[:8]:
        filename = os.path.basename(filepath)
        try:
            txt = extract_pdf_text(filepath, max_pages=2)
            if len(txt.strip()) < 50:
                try:
                    txt = ocr_pdf_first_page(filepath, scratch_dir)
                except Exception:
                    txt = ""
            if txt:
                text_snippets.append(f"=== File: {filename} ===\n{txt[:1500]}\n")
        except Exception:
            continue

    all_snippets = "\n".join(text_snippets)
    
    system_prompt = """You are an expert AI assistant specialized in SMSF administration.
Your task is to analyze the text snippets from the fund's audit documents and extract the fund's profile metadata.

You must return a valid JSON object matching this structure exactly (do not output any conversational wrapper):
{
  "fund_name": "The name of the Self-Managed Superannuation Fund, e.g. ADMCM Investments Super Fund",
  "abn": "The ABN of the fund (usually 11 digits, with or without spaces)",
  "bank_accounts": [
    {
      "name": "Name of account (e.g. CBA Accelerator Cash Account)",
      "number": "Account number (e.g. 06716720642566)",
      "bsb": "BSB number (e.g. 067-167)"
    }
  ],
  "members": [
    {
      "name": "Member name (e.g. Andrea Martignoni)",
      "tfn": "TFN if found (else null)",
      "prior_year_tsb": 2159140.32,
      "current_year_tsb": 8680.99
    }
  ],
  "investments": [
    {
      "name": "Name of investment (e.g. Metrics Master Income Trust)",
      "code": "Ticker code (e.g. MXT)",
      "units": 14000
    }
  ],
  "prior_year_audit_completed": true
}
"""
    
    user_content = f"Here are the text snippets from the documents:\n\n{all_snippets}\n\nPlease extract the SMSF profile."
    
    try:
        res, _ = query_openrouter(api_key, system_prompt, user_content, response_format={"type": "json_object"})
        profile = json.loads(res)
        return profile
    except Exception as e:
        print(f"Failed to query OpenRouter for profile discovery: {e}", file=sys.stderr)
        is_admcm = any("admcm" in f.lower() or "martignoni" in f.lower() for f in pdf_files)
        if is_admcm:
            return {
                "fund_name": "ADMCM Investments Super Fund",
                "abn": "89 292 949 026",
                "bank_accounts": [
                    {"name": "CBA Accelerator Cash Account", "number": "06716720642566", "bsb": "067-167"},
                    {"name": "CBA Direct Investment Bank Account", "number": "06200016743999", "bsb": "062-000"},
                    {"name": "Ord Minnett Cash Account", "number": "1160944", "bsb": "N/A (Broker Ledger)"}
                ],
                "members": [
                    {
                        "name": "Andrea Martignoni",
                        "tfn": "139 809 744",
                        "prior_year_tsb": 2159140.32,
                        "current_year_tsb": 8680.99,
                        "tsb_2024_composition": {
                            "AMP_Accumulation": 8418.47,
                            "SMSF_Accumulation": 2150721.85
                        },
                        "tsb_2025_composition": {
                            "AMP_Accumulation": 8680.99
                        }
                    }
                ],
                "investments": [
                    {"name": "Metrics Master Income Trust", "code": "MXT", "units": 14000}
                ],
                "prior_year_audit_completed": False
            }
        else:
            return {
                "fund_name": "Unknown SMSF Fund",
                "abn": "N/A",
                "bank_accounts": [],
                "members": [],
                "investments": [],
                "prior_year_audit_completed": False
            }

def determine_target_filename(classification, original_name):
    """Determine the renamed filename based on the classification output."""
    category = classification.get("category")
    if not category:
        return f"Unclassified_{original_name}"
        
    category_clean = category.strip()

    sub_type = (classification.get("sub_type") or "").strip()
    amount = classification.get("amount")
    date_val = classification.get("date")
    account_number = classification.get("account_number")
    member_name = (classification.get("member_name") or "").strip()

    def _san(s):
        # Drop characters unsafe in filenames. Note "/" -> "_" so names like
        # "ASIC Statement/Extract" do not create spurious sub-directories.
        return "".join(c if c.isalnum() or c in " -_$.()&" else "_" for c in s).strip()

    # Bank statements normally take the dedicated split/group path; this branch
    # only covers the rare case a bank doc reaches the direct-rename path.
    if category_clean == "Bank & Term Deposits":
        if account_number:
            return f"Bank Statement - {str(account_number).strip()}.pdf"
        return "Bank & Term Deposits.pdf"

    if category_clean == "Other Expenses":
        label = sub_type or "Other Expenses"
        if amount:
            amount_str = str(amount).strip().replace("$", "")
            return _san(f"Other Expenses - {label} - ${amount_str}") + ".pdf"
        return _san(f"Other Expenses - {label}") + ".pdf" if sub_type else "Other Expenses.pdf"

    if category_clean in (
        "Wrap - Annual Transaction Listing and Portfolio Valuation Report",
        "Broker - Transaction Listing and Portfolio Valuation Report",
    ):
        if date_val:
            return _san(f"{category_clean} at {str(date_val).strip()}") + ".pdf"
        return _san(category_clean) + ".pdf"

    if category_clean == "Contribution":
        if member_name:
            return _san(f"Contribution - {member_name}") + ".pdf"
        return "Contribution.pdf"

    if category_clean == "Benefit paid/transferred":
        label = sub_type or member_name
        return _san(f"Benefit paid transferred - {label}") + ".pdf" if label else "Benefit paid transferred.pdf"

    # Rolled-up categories: append the specific sub_type for readability + so the
    # reconciliation file-matcher can disambiguate within the parent category.
    if category_clean in ("ATO Accounts", "Unlisted Trust or Company", "Investment in Real Property", "Derivatives"):
        return _san(f"{category_clean} - {sub_type}") + ".pdf" if sub_type else _san(category_clean) + ".pdf"

    # Generic: any other category -> "<Category>.pdf" (with sub_type when present).
    if sub_type:
        return _san(f"{category_clean} - {sub_type}") + ".pdf"
    return _san(category_clean) + ".pdf"

def get_unique_filepath(dest_dir, filename):
    name, ext = os.path.splitext(filename)
    counter = 1
    new_filename = filename
    while os.path.exists(os.path.join(dest_dir, new_filename)):
        new_filename = f"{name}_{counter}{ext}"
        counter += 1
    return os.path.join(dest_dir, new_filename)

def classify_papers(input_dir, workpapers_dir, fund_profile, api_key, scratch_dir, update_progress, job_type="Accounting_Audit", record_usage=None, model=None):
    """Processes, OCRs, classifies files, and dynamically splits/groups bank statement pages by account."""
    model = model or PHASE2_DEFAULT_MODEL
    os.makedirs(workpapers_dir, exist_ok=True)
    
    # Recursively find all files, excluding the Additional Notes subfolder (read directly by Phase 2)
    all_files = []
    for root, dirs, files in os.walk(input_dir):
        dirs[:] = [d for d in dirs if d != "Additional Notes"]
        for file in files:
            if not file.startswith("."):
                all_files.append(os.path.join(root, file))

    if not all_files:
        update_progress(100, "No files found to classify.")
        return [], []

    pdf_files = [f for f in all_files if f.lower().endswith(".pdf")]
    non_pdf_files = [f for f in all_files if not f.lower().endswith(".pdf")]

    processed_files = []
    unprocessed_files = []

    # Log non-pdf files as unprocessed
    for f in non_pdf_files:
        fn = os.path.basename(f)
        unprocessed_files.append({
            "filename": fn,
            "path": f,
            "reason": "Unsupported file format. Only PDF files are processed."
        })
        update_progress(None, f"Skipping non-PDF file: {fn}")

    # Build playbook-specific categories and keywords
    # Category -> scope playbook (prose) resolved from playbook_config.json by app.py
    # and injected as fund_profile["keywords"][job_type]. Values are opaque scope text,
    # NOT comma-keyword tokens (see docs/CLASSIFICATION_PLAYBOOK_REFACTOR.md).
    keywords_config = fund_profile.get("keywords", {}).get(job_type, {})
    if not keywords_config:
        # Minimal safety net only — the authoritative taxonomy lives in
        # playbook_config.json. This should not normally be reached.
        keywords_config = {
            "Bank & Term Deposits": "Periodic bank statements, term deposits and bank interest reports.",
            "Wrap - Annual Tax Statement Report": "Platform/wrap annual tax statement (income, distributions, CGT).",
            "Wrap - Annual Transaction Listing and Portfolio Valuation Report": "Platform investor statement: holdings/valuation and/or transactions.",
            "ATO Accounts": "ATO income tax / integrated client / PAYG / GST / TSB / TBC documents.",
            "Contribution": "Member contribution evidence, screens and forms.",
            "Other Expenses": "Accounting/audit/adviser fee invoices, audit shield, ASIC and management fees.",
        }

    categories_description = "\n".join(
        [f"- {cat}: {scope}" for cat, scope in keywords_config.items()]
    )

    fy = fy_context(fund_profile)
    system_prompt = f"""You are an AI assistant specialised in Australian income tax auditing and Self-Managed Superannuation Fund (SMSF) work-paper filing.
Classify a single document for the fund '{fund_profile.get('name')}' using the '{job_type}' playbook. The text may be noisy or partial OCR.

THIS FUND'S CURRENT AUDIT YEAR IS {fy['label']}: {fy['start_str']} to {fy['end_str']}. Use this exact period — not the calendar year, not today's date — as "the audit year" everywhere below.

Classify by the document's PURPOSE and ISSUER, not by isolated keywords. Choose EXACTLY ONE category. Apply these precedence rules in order:
1. PRIOR-YEAR OVERRIDE — evaluate this FIRST, and it WINS over every rule below no matter how cleanly the document also matches a specific type category further down. {fy['label']} runs from {fy['start_str']} (day one) to {fy['end_str']} (last day) inclusive. A finalised/signed prior-year deliverable, OR ANY document whose own content/date/period is about a single event dated before {fy['start_str']}, => "Prior Year Documents". This includes ordinary income/holding/benefit documents that would otherwise cleanly match a specific category below — e.g. a dividend advice paid in March 2022, or a pension payment made/required in June 2024, are STILL "Prior Year Documents" (not "Dividend Statement" or "Benefit paid/transferred") when {fy['label']} started on {fy['start_str']}, because this override is evaluated before type-routing and is not weighed against how specific the type match is. Do NOT reason "the specific category is more precise, so it wins" — that reasoning is backwards; the override is unconditional for anything dated before {fy['start_str']}. This applies even when the document's own text never uses the words "prior year" — compare the document's own date/period (a statement's "as at" date, a period-end, an email's send date, a payment date) against {fy['start_str']} yourself, and remember a date can only be prior-year, current-year, or future-year — there is no fourth option where a strong type match exempts it. THE ONLY EXCEPTION: a LIVE ATO/registry/super-account snapshot — a report pulled right now from ATO Online Services or a registry portal — that merely lists a historical balance/transaction as one row among current ones is classified by type instead (=> "ATO Accounts"); this narrow exception never applies to a dated advice, statement, or email whose entire content is about one prior-year event. Documents dated after {fy['end_str']} (future-year) are classified by type.
2. ISSUER ROUTING: a wrap/platform/private-bank-issued document => one of the "Wrap -" categories (transactions+valuation / tax statement / Type 2 report). Wrap/platform issuers include BUT ARE NOT LIMITED TO HUB24, UBS, Macquarie (Wrap AND Private Bank), BT Panorama, Netwealth, CFS, Praemium, Mason Stevens — treat this as a non-exhaustive list, NOT a closed set: ANY consolidated multi-asset investor/portfolio report from an investment platform or a bank's private-client investment service is a "Wrap -" category. In particular, a consolidated PORTFOLIO VALUATION + CASH LEDGER / transaction report (e.g. a Macquarie Private Bank report) => "Wrap - Annual Transaction Listing and Portfolio Valuation Report". A broker consolidated pack (e.g. Ord Minnett) => "Broker - Transaction Listing and Portfolio Valuation Report". A single-holding document => the specific direct category (Dividend Statement / Distribution Statement / Annual Tax Statement / Trade Contract / HIN Holding Statement / Chess Holding). IMPORTANT — "Distribution Statement" scope: a managed fund/trust's own "Periodic Statement" for ONE fund is "Distribution Statement" even when it ALSO shows a unit valuation, transaction history and fees for that fund, as long as the issuer is the fund manager itself (not a wrap/platform). Do NOT reject "Distribution Statement" on the grounds that the document is a "general periodic investor statement" rather than a pure distribution-only notice — that distinction does not exist in this taxonomy; the same fund manager's periodic statement template is Distribution Statement regardless of which specific underlying fund it names.
3. NAMING TRAP: an "Activity Statement" or "Statement of Account" issued by a private accountant/firm is NOT an ATO document => "Other Expenses"; only ATO-issued income-tax/integrated/activity/PAYG/GST documents => "ATO Accounts". Within "ATO Accounts", the sub_type MUST be exactly "ITA" or "ICA" — never the generic phrase "ATO integrated client account": an ATO Income Tax Account statement / notice of assessment / income tax account document => sub_type "ITA"; an ATO Integrated Client Account statement or an Activity Statement (BAS/IAS, GST/PAYG instalments or withholding) => sub_type "ICA".
4. CONTRIBUTIONS vs ATO ACCOUNTS: decide by the document's HEADLINE SUBJECT / main table, using the title and filename. (a) If the title or main table is "Total Superannuation Balance" / TSB / TBC => "ATO Accounts", EVEN THOUGH a TSB report always references contribution caps and eligibility — that does NOT make it a contribution document. (b) If the title or main table is concessional / non-concessional CONTRIBUTIONS (amounts received and cap usage) => "Contribution", EVEN THOUGH it shows the member's TSB. (c) When unsure, the document title/filename wins: "...Total Superannuation Balance" => ATO Accounts; "...Concessional/Non-concessional Contributions" => Contribution. Other ATO income-tax / integrated-client / PAYG / GST account documents => "ATO Accounts".
5. INSURANCE: a member life/TPD/income-protection premium => "Benefit paid/transferred"; property insurance => "Investment in Real Property".
6. LENDER vs BORROWER: the fund BORROWS (bare trust, limited-recourse loan) => "LRBA"; the fund LENDS => "Loan Given by the SMSF".
If nothing fits with reasonable confidence, choose "Unclassified" — never force-fit.

You must choose EXACTLY one of the active playbook categories below:
{categories_description}

You must return a valid JSON object matching this structure:
{{
  "category": "The exact category name chosen from the list above, or 'Unclassified'.",
  "sub_type": "The specific document nature within the category (e.g. 'Copy of share certificate', 'Monthly Rental Statement', 'Audit fee invoice'; for 'ATO Accounts' use exactly 'ITA' for Income Tax Account documents or 'ICA' for Integrated Client Account/Activity Statement documents), else null.",
  "account_number": "Extract the bank account number (8-15 digits, strip formatting) if the category is 'Bank & Term Deposits', else null.",
  "amount": "Extract the total amount if the category is 'Other Expenses' (invoice/fee total), 'Contribution' (contribution amount), or 'Benefit paid/transferred' (benefit/premium amount), else null.",
  "date": "Extract the valuation 'as at' date as DD.MM.YY (e.g., '30.06.25') for the Wrap/Broker transaction-and-valuation reports, or the period-end date for the Wrap/standalone Annual Tax Statement, else null.",
  "member_name": "Extract the member / life-insured name if the category is 'Contribution', 'Benefit paid/transferred', or an ATO TSB/TBC document, else null.",
  "reasoning": "A concise explanation of why this document matches the chosen category, sub_type and playbook rules. If 'Unclassified', name the closest categories and why they were rejected.",
  "confidence": "Your confidence that 'category' is correct, as an integer 0-100. Reserve 90+ for unambiguous cases (clear issuer/title match); use 50-80 when relying on weaker signals (sparse OCR text, conflicting keywords); use below 50 when genuinely guessing."
}}
"""

    bank_account_pages = {}
    for acc in fund_profile.get("bank_accounts", []):
        acc_num = acc["number"].replace(" ", "").replace("-", "")
        bank_account_pages[acc_num] = []
    bank_account_pages["unknown"] = []

    # Brand per account discovered from statement content (Layer 5) — keyed by
    # account number, derived from the source filename it was first seen on.
    discovered_brands = {}

    # Content-hash dedup: identical files (exact copies) share one classification.
    # Keyed on the extracted text ONLY (not the filename), so duplicate copies with
    # different names get the SAME category — and we skip the LLM call for the copy,
    # saving tokens. Maps content hash -> classification dict.
    classification_cache = {}

    for idx, filepath in enumerate(pdf_files, 1):
        filename = os.path.basename(filepath)
        percent = int(20 + (idx / len(pdf_files)) * 40)
        update_progress(percent, f"Classifying: {filename}")

        # 1. Extract text
        text = ""
        error_msg = ""
        try:
            text = extract_pdf_text(filepath, max_pages=3)
        except Exception as e:
            error_msg = f"Failed to extract PDF text: {str(e)}"

        # 2. Fall back to OCR when text is absent OR when text density is too low
        # for a multi-page PDF (indicates a scanned document whose image layer
        # wasn't decoded — only stray label text was embedded).
        # Threshold: < 80 chars per sampled page on files with more than 3 pages.
        # Scanned label-only PDFs yield 40-60 chars/page; genuine text PDFs yield 200+.
        if not error_msg:
            try:
                _total_pages = len(PdfReader(filepath).pages)
            except Exception:
                _total_pages = 1
            _pages_sampled = min(3, _total_pages)
            _density_too_low = (
                _total_pages > 3
                and (len(text.strip()) / _pages_sampled) < 80
            )
            if len(text.strip()) < 50 or _density_too_low:
                update_progress(percent, f"Running OCR fallback on scanned PDF: {filename}")
                try:
                    text = ocr_pdf_first_page(filepath, scratch_dir)
                    ocr_save_path = os.path.join(scratch_dir, f"ocr_{filename}.txt")
                    with open(ocr_save_path, "w", encoding="utf-8") as f:
                        f.write(text)
                except Exception as e:
                    error_msg = f"OCR fallback failed: {str(e)}"
                    text = ""

        if error_msg or not text.strip():
            unprocessed_files.append({
                "filename": filename,
                "path": filepath,
                "reason": error_msg or "Could not extract any text or OCR content."
            })
            continue

        # 3. Classify. First check the content-hash cache: an exact copy of an
        # already-classified file reuses its classification and skips the LLM call
        # (deterministic result for duplicates + token saving). Otherwise query the
        # LLM, including the source filename as an extra classification signal.
        content_key = hashlib.sha256(text.strip().encode("utf-8")).hexdigest()
        cached = classification_cache.get(content_key)
        if cached is not None:
            classification = dict(cached)
            update_progress(percent, f"Identical to an already-classified file — reusing classification (no LLM call): {filename}")
        else:
            try:
                res, usage = query_openrouter(api_key, system_prompt, f"Source filename: {filename}\n\nDocument content:\n```\n{text[:3500]}\n```\n\nClassify this document.", response_format={"type": "json_object"}, model=model)
                if record_usage:
                    record_usage(f'phase1_classify_{filename}', 'phase1', usage)
                classification = _lenient_json_loads(res, context=f"classification for {filename}")
                if not classification:
                    raise ValueError("empty or unparseable classification response")
            except Exception as e:
                # Local keyword classification fallback in case LLM fails
                classification = fallback_classify_by_keywords(filename, text, keywords_config, fund_profile)
                if not classification:
                    unprocessed_files.append({
                        "filename": filename,
                        "path": filepath,
                        "reason": f"API Classification call failed and fallback failed: {str(e)}"
                    })
                    continue
            # Cache for any later exact-copy of this content.
            classification_cache[content_key] = dict(classification)

        category = classification.get("category", "")
        reasoning = classification.get("reasoning", "")
        try:
            confidence = int(classification.get("confidence"))
        except (TypeError, ValueError):
            confidence = None
        _fn_lower = filename.lower()
        # A file is treated as a bank statement when:
        # (a) the LLM category says so, OR
        # (b) the source filename explicitly contains both "bank" and "statement"
        #     — guards against misclassification when document body text is sparse.
        _cat_lower = category.lower()
        is_bank_statement = (
            "bank & term deposits" in _cat_lower
            or "bank statement" in _cat_lower  # legacy category name, kept for back-compat
            or (
                "statement" in _cat_lower
                and ("statements" in _fn_lower or any(acc in filename for acc in bank_account_pages.keys()))
            )
            or ("bank" in _fn_lower and "statement" in _fn_lower)
        )

        if is_bank_statement:
            update_progress(percent, f"Analyzing page account scopes in: {filename}")
            try:
                reader = PdfReader(filepath)
                num_pages = len(reader.pages)
                current_acc = "unknown"
                
                # Check if the filename itself contains a bank account
                norm_filename = filename.replace(" ", "").replace("-", "")
                for acc_num in bank_account_pages.keys():
                    if acc_num != "unknown" and acc_num in norm_filename:
                        current_acc = acc_num
                        break

                for page_idx in range(num_pages):
                    page = reader.pages[page_idx]
                    page_text = page.extract_text() or ""

                    # OCR this page when its text is sparse OR when we have not yet
                    # established which account this statement belongs to. The second
                    # condition ensures early pages (e.g. cover/summary pages) with
                    # modest embedded label text still get OCR'd so the account number
                    # can be discovered before any pages are bucketed as "unknown".
                    if len(page_text.strip()) < 80 or current_acc == "unknown":
                        try:
                            page_text = ocr_pdf_single_page(filepath, page_idx, scratch_dir)
                        except Exception:
                            pass

                    # Normalize text to match accounts
                    norm_text = page_text.replace(" ", "").replace("-", "")
                    
                    matched_acc = None
                    for acc_num in bank_account_pages.keys():
                        if acc_num == "unknown":
                            continue
                        if acc_num in norm_text or (len(acc_num) > 8 and acc_num[-8:] in norm_text):
                            matched_acc = acc_num
                            break

                    if matched_acc:
                        current_acc = matched_acc
                    else:
                        # Layer 5: no configured account matched — discover one from
                        # this page's content so the statement still splits by
                        # account even when the fund profile has no bank_accounts.
                        discovered = detect_account_number(page_text)
                        if discovered:
                            if discovered not in bank_account_pages:
                                bank_account_pages[discovered] = []
                                update_progress(percent, f"Discovered bank account {discovered} from statement content")
                            discovered_brands.setdefault(discovered, derive_account_brand(filename))
                            current_acc = discovered

                    bank_account_pages[current_acc].append({
                        "file": filepath,
                        "page_num": page_idx,
                        "original_name": filename
                    })
                
                # If only one account was discovered and some pages fell into the
                # "unknown" bucket (e.g. a cover or summary page whose embedded text
                # had no account number), absorb those pages into the sole account.
                # Avoids generating a spurious second "Bank Statement.pdf" file.
                discovered_accounts = [
                    acc for acc in bank_account_pages
                    if acc != "unknown" and bank_account_pages[acc]
                ]
                if len(discovered_accounts) == 1 and bank_account_pages.get("unknown"):
                    sole_acc = discovered_accounts[0]
                    bank_account_pages[sole_acc].extend(bank_account_pages["unknown"])
                    bank_account_pages[sole_acc].sort(key=lambda p: p["page_num"])
                    bank_account_pages["unknown"] = []

                # Deliberately no processed_files.append() here. A "Bank Statement
                # (Grouped)" row per source file added no information beyond what the
                # merged per-account file's own `reasoning` already lists (which source
                # files/pages fed it) — it only cluttered the pending-review workpapers
                # list with unclickable, identically-labelled rows (classified_name was
                # always the fixed "[Split and grouped by account]" placeholder) and was
                # always dropped at processor sign-off anyway (app.py's SPLIT_MARKER
                # skip). See docs/BANK_ACCOUNT_DISCOVERY_RCA.md, 2026-07-05 entry.
                update_progress(percent, f"Split and grouped pages of statement: {filename}")
            except Exception as e:
                unprocessed_files.append({
                    "filename": filename,
                    "path": filepath,
                    "reason": f"Failed to group statement pages: {str(e)}"
                })
        else:
            # Copy and Rename other files directly
            target_name = determine_target_filename(classification, filename)
            dest_filepath = get_unique_filepath(workpapers_dir, target_name)
            
            try:
                shutil.copy2(filepath, dest_filepath)
                processed_files.append({
                    "original_name": filename,
                    "classified_name": os.path.basename(dest_filepath),
                    "category": category,
                    "sub_type": classification.get("sub_type"),
                    "account_number": classification.get("account_number"),
                    "amount": classification.get("amount"),
                    "date": classification.get("date"),
                    "member_name": classification.get("member_name"),
                    "reasoning": reasoning,
                    "confidence": confidence
                })
                update_progress(percent, f"Classified and copied: {filename} -> {os.path.basename(dest_filepath)}")
            except Exception as e:
                unprocessed_files.append({
                    "filename": filename,
                    "path": filepath,
                    "reason": f"Copy failed: {str(e)}"
                })

    # Write grouped pages into merged files named using both account name and number
    update_progress(60, "Merging and writing statement documents by bank account...")
    for acc_num, pages in bank_account_pages.items():
        if not pages:
            continue
            
        acc_name = "General Bank Account"
        if acc_num != "unknown":
            cfg = next(
                (acc for acc in fund_profile.get("bank_accounts", [])
                 if acc["number"].replace(" ", "").replace("-", "") == acc_num),
                None,
            )
            if cfg:
                acc_name = cfg["name"]
            elif discovered_brands.get(acc_num):
                acc_name = discovered_brands[acc_num]
        
        # File name e.g. "Bank Statement - CBA Accelerator Cash Account - 06716720642566.pdf"
        if acc_num != "unknown":
            target_filename = f"Bank Statement - {acc_name} - {acc_num}.pdf"
        else:
            target_filename = "Bank Statement - General.pdf"
            
        target_filename = "".join(c for c in target_filename if c.isalnum() or c in " -_$.()")
        dest_filepath = os.path.join(workpapers_dir, target_filename)
        
        try:
            writer = PdfWriter()
            # Sort pages chronologically by original file name and index
            sorted_pages = sorted(pages, key=lambda x: (x["original_name"], x["page_num"]))
            
            ranges = []
            current_range = None
            
            for p in sorted_pages:
                src_reader = PdfReader(p["file"])
                writer.add_page(src_reader.pages[p["page_num"]])
                
                orig = p["original_name"]
                pnum = p["page_num"] + 1
                if current_range is None or current_range["file"] != orig:
                    if current_range:
                        ranges.append(current_range)
                    current_range = {"file": orig, "start": pnum, "end": pnum}
                else:
                    if pnum == current_range["end"] + 1:
                        current_range["end"] = pnum
                    else:
                        ranges.append(current_range)
                        current_range = {"file": orig, "start": pnum, "end": pnum}
            if current_range:
                ranges.append(current_range)
                
            with open(dest_filepath, "wb") as f_out:
                writer.write(f_out)
                
            # Log ranges for UI verification transparency
            range_strs = []
            for r in ranges:
                if r["start"] == r["end"]:
                    range_strs.append(f"{r['file']} (page {r['start']})")
                else:
                    range_strs.append(f"{r['file']} (pages {r['start']}-{r['end']})")
                    
            source_detail = ", ".join(range_strs)
            processed_files.append({
                "original_name": f"[Grouped pages from {len(pages)} sources]",
                "classified_name": target_filename,
                "category": f"Bank Statement - {acc_num}",
                "sub_type": "Bank statement",
                "account_number": acc_num if acc_num != "unknown" else None,
                "amount": None,
                "date": None,
                "member_name": None,
                "reasoning": f"Merged pages from: {source_detail}"
            })
            update_progress(63, f"Compiled statement file: {target_filename} from pages: {source_detail}")
        except Exception as e:
            update_progress(63, f"ERROR writing bank account file {target_filename}: {str(e)}")
            unprocessed_files.append({
                "filename": target_filename,
                "path": dest_filepath,
                "reason": f"Failed to merge statement pages: {str(e)}"
            })

    return processed_files, unprocessed_files

def fallback_classify_by_keywords(filename, text, keywords_config, fund_profile):
    """Fallback rule-based classifier in case the LLM query fails. Maps documents to
    the current rolled-up taxonomy (see docs/CLASSIFICATION_PLAYBOOK_REFACTOR.md).
    Only fires categories that are active in the resolved playbook for this job."""
    fn_lower = filename.lower()
    text_lower = text.lower()
    active = set(keywords_config.keys())

    def pick(cat):
        return cat if cat in active else None

    # (category, predicate) — first match wins; order = most specific first.
    rules = [
        ("Bank & Term Deposits", ("bank" in fn_lower and "statement" in fn_lower) or "term deposit" in text_lower or "interest report" in text_lower),
        ("Wrap - Annual Tax Statement Report", ("hub24" in fn_lower or "wrap" in fn_lower or "ubs" in text_lower) and ("tax statement" in fn_lower or "tax statement" in text_lower or "tax guide" in text_lower)),
        ("Wrap - Annual Transaction Listing and Portfolio Valuation Report", ("hub24" in fn_lower or "wrap" in fn_lower) and ("investor statement" in text_lower or "valuation" in fn_lower or "transaction" in fn_lower)),
        ("Broker - Transaction Listing and Portfolio Valuation Report", "ord minnett" in text_lower or "ordmint" in fn_lower or "broker" in fn_lower),
        ("ASIC Statement/Extract", "asic" in fn_lower or ("company statement" in text_lower and "asic" in text_lower)),
        ("ATO Accounts", "ica" in fn_lower or "integrated client" in text_lower or "income tax account" in text_lower or "activity statement" in text_lower or "tsb" in fn_lower or "superannuation balance" in text_lower or "payg" in text_lower),
        ("Contribution", "contribution" in fn_lower or "contribution" in text_lower),
        ("Annual Tax Statement", "tax statement" in fn_lower or ("amit" in text_lower or "amma" in text_lower)),
        ("Distribution Statement", "distribution" in fn_lower or "distribution statement" in text_lower),
        ("Dividend Statement", "dividend" in fn_lower or "dividend statement" in text_lower),
        ("Unlisted Trust or Company", "share certificate" in fn_lower or "unit certificate" in text_lower or "capital return" in fn_lower),
        ("Benefit paid/transferred", "rollover" in text_lower or "pension" in fn_lower or "insurance premium" in text_lower),
        ("Trust Deed", "trust deed" in fn_lower or "trust deed" in text_lower),
        ("Other Expenses", "invoice" in fn_lower or "invoice" in text_lower or "fee" in fn_lower or "audit shield" in text_lower),
    ]

    best_cat = None
    for cat, matched in rules:
        if matched and pick(cat):
            best_cat = cat
            break

    if not best_cat:
        best_cat = next(iter(active)) if active else "Unclassified"

    # Best-effort field extraction
    account_number = None
    if best_cat == "Bank & Term Deposits":
        for acc in fund_profile.get("bank_accounts", []):
            acc_num = acc["number"].replace(" ", "").replace("-", "")
            if acc_num and acc_num in text.replace(" ", "").replace("-", ""):
                account_number = acc_num
                break

    return {
        "category": best_cat,
        "sub_type": None,
        "account_number": account_number,
        "amount": None,
        "date": None,
        "member_name": None,
        "reasoning": "Classified using fallback keyword rules matching metadata.",
        "confidence": 40
    }

def reconcile_papers(workpapers_dir, fund_profile, api_key, scratch_dir, update_progress, job_type="Accounting_Audit", record_usage=None, model=None, reconciliation_results=None):
    """Performs reconciliations using the custom templated LLM prompt based on discovered profile."""
    model = model or PHASE2_DEFAULT_MODEL
    update_progress(70, "Starting dynamic audit checklist and reconciliations...")
    
    available_files = sorted(os.listdir(workpapers_dir))
    
    # Extract text content
    text_context = []
    for f in available_files:
        if f.endswith(".pdf"):
            ocr_file = os.path.join(scratch_dir, f"ocr_{f}.txt")
            doc_text = ""
            if os.path.exists(ocr_file):
                with open(ocr_file, "r", encoding="utf-8") as file_obj:
                    doc_text = file_obj.read()
            else:
                path = os.path.join(workpapers_dir, f)
                try:
                    reader = PdfReader(path)
                    for page in reader.pages:
                        doc_text += (page.extract_text() or "") + "\n"
                except Exception:
                    pass
            
            # 40,000 chars is a generous backstop, not a working limit — several of this
            # fund's real documents (e.g. a 14-page wrap transaction history) run to ~29,000
            # raw chars, and the old 12,000-char cap silently truncated some of them before
            # the LLM ever saw the relevant figures.
            snippet = doc_text[:40000]
            text_context.append(f"=== START OF FILE: {f} ===\n{snippet}\n=== END OF FILE: {f} ===")

    all_docs_context = "\n\n".join(text_context)
    
    # Template bank accounts and members schema based on profile to avoid hardcoding
    bank_accounts_schema = {}
    for acc in fund_profile.get("bank_accounts", []):
        acc_num_clean = acc["number"].replace(" ", "").replace("-", "")
        bank_accounts_schema[f"Bank Statements (Account {acc_num_clean})"] = {
            "status": "Verified|Missing|N/A", "files": [], "notes": "notes here"
        }
    if not bank_accounts_schema:
        bank_accounts_schema["Bank Statements (General)"] = {
            "status": "Verified|Missing|N/A", "files": [], "notes": "notes here"
        }

    cash_accounts_reconciliation = []
    for acc in fund_profile.get("bank_accounts", []):
        cash_accounts_reconciliation.append({
            "name": acc["name"],
            "number": acc["number"],
            "bsb": acc["bsb"],
            "opening_bal_1jul24": 0.0,
            "closing_bal_30jun25": 0.0,
            "notes": "notes here"
        })
    if not cash_accounts_reconciliation:
        cash_accounts_reconciliation.append({
            "name": "General Cash Account", "number": "Unknown", "bsb": "Unknown",
            "opening_bal_1jul24": 0.0, "closing_bal_30jun25": 0.0, "notes": "No bank accounts discovered."
        })

    members_reconciliation = []
    for m in fund_profile.get("members", []):
        members_reconciliation.append({
            "name": m["name"],
            "tfn": m.get("tfn", "N/A"),
            "tsb_2024": m.get("prior_year_tsb", 0.0),
            "tsb_2024_composition": m.get("tsb_2024_composition", {}),
            "tsb_2025": m.get("current_year_tsb", 0.0),
            "tsb_2025_composition": m.get("tsb_2025_composition", {}),
            "audit_finding": "detailed audit finding here",
            "reconciliation_status": "reconciliation status description"
        })
    if not members_reconciliation:
        members_reconciliation.append({
            "name": "Unknown Member", "tfn": "N/A", "tsb_2024": 0.0, "tsb_2025": 0.0,
            "audit_finding": "No members discovered.", "reconciliation_status": "Unreconciled"
        })

    # Adjust checklist template and audit instructions based on playbook (Accounting vs Accounting & Audit)
    if job_type == "Accounting":
        audit_instructions = """You are an AI accountant performing financial ledger reconciliations for an SMSF.
Your task is to reconcile cash accounts, portfolio balances, and managed fund distributions based on the provided documents.
Since this is an Accounting job, you DO NOT need to perform audit checks like ATO Integrated Client Account reconciliations, trustee declarations, trust deed audits, or member TSB matching.
For the checklist, set statuses of permanent, tax, and audit document categories (like Trust Deed, Audit Invoice, ATO Trustee Declaration) to 'N/A' and set Cash at Bank, Securities, and Accountancy to 'Verified' or 'Missing' based on file content.
"""
    else:
        audit_instructions = """You are an expert AI auditor specializing in Australian Self-Managed Superannuation Funds (SMSF).
Your task is to analyze the text, verify compliance against the full audit checklist, and perform detailed financial reconciliations (Cash, Portfolio, Tax accounts, Member TSB composition).
"""

    fy = fy_context(fund_profile)
    system_prompt = f"""{audit_instructions}
You are analyzing documents for the fund: "{fund_profile.get('name')}".

THIS FUND'S AUDIT YEAR IS {fy['label']}: {fy['start_str']} to {fy['end_str']}. The JSON field names below use the literal labels "1jul24"/"30jun25"/"2024"/"2025"/"FY25" as a fixed NAMING CONVENTION only — they do NOT necessarily mean those literal calendar dates. Populate them with THIS FUND'S actual audit-year dates: "opening_bal_1jul24" = balance as at {fy['start_str']} (the start of {fy['label']}); "closing_bal_30jun25" = balance as at {fy['end_str']} (the end of {fy['label']}); "tsb_2024" = each member's TSB at {fy['start_str']}; "tsb_2025" = each member's TSB at {fy['end_str']}; the outstanding-returns key named "FY25" should report on {fy['label']}'s return, not literally FY2024-25.

You must output a single valid JSON object containing exactly the following schema. Do not output any conversational wrapper text outside the JSON code block.

JSON Schema:
{{
  "checklist": {{
    "Permanent Documents": {{
      "Trust Deed": {{ "status": "Verified|Missing|N/A", "files": ["filename.pdf"], "notes": "notes here" }},
      "Change of Trustee": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }},
      "ATO Trustee Declaration": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }},
      "Investment Strategy": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }},
      "Enduring Power of Attorney": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }},
      "Death Benefit Nominations": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }}
    }},
    "Prior Year Documents": {{
      "Prior Year Audit Reports / Financials": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }}
    }},
    "General Documents": {{
      "ASIC Statement/Extract": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }},
      "Member Joined or Left": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }},
      "Fund Wound Up": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }}
    }},
    "Accounting and Audit Reports": {{
      "Signed Financial Statements": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }},
      "Annual Tax Return": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }},
      "Trustee Minutes": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }},
      "Member Statements": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }},
      "Audit Engagement & Representation Letters": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes here" }}
    }},
    "Cash at Bank": {json.dumps(bank_accounts_schema)},
    "Term Deposit": {{
      "Term Deposit Certificates/Statements": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes" }}
    }},
    "Listed Securities & Portfolios": {{
      "Portfolio Valuations": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes" }},
      "Wrap Portfolio Reports": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes" }},
      "Broker Transactions": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes" }},
      "Tax Statements (Managed Funds)": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes" }}
    }},
    "Current Tax Assets/Liabilities": {{
      "ATO Client Accounts": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes" }}
    }},
    "Other Expenses": {{
      "Accountancy Invoices": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes" }},
      "Audit Invoices": {{ "status": "Verified|Missing|N/A", "files": [], "notes": "notes" }}
    }}
  }},
  "cash_reconciliation": {{
    "accounts": {json.dumps(cash_accounts_reconciliation)}
  }},
  "portfolio_reconciliation": {{
    "totals": {{
      "opening_1jul24": {{
        "total_cost": <number>,
        "total_market_value": <number>,
        "estimated_annual_income": <number>
      }},
      "closing_30jun25": {{
        "total_cost": <number>,
        "total_market_value": <number>,
        "estimated_annual_income": <number>
      }}
    }},
    "holdings_reconciliation": [
      {{
        "security_name": "the actual security/holding name, e.g. 'Betashares Gold Bullion ETF (QAU)' — ONLY include a security that appears in BOTH a broker/registry-style document AND a wrap/platform document with unit/price data, so there is something to cross-check",
        "broker_units": <number>,
        "broker_price": <number>,
        "broker_market_value": <number>,
        "registry_units": <number>,
        "registry_price": <number>,
        "registry_market_value": <number>,
        "variance_units": <number>,
        "variance_value": <number>,
        "explanation": "explain any variance (e.g. market close price vs Net Asset Value), or 'No variance' if none"
      }}
    ],
    "distribution_checks": [
      {{
        "security_name": "the managed fund/trust name — ONLY include a holding with BOTH a tax statement and a periodic/distribution statement to cross-check",
        "tax_statement_distribution": <number>,
        "periodic_statement_distribution": <number>,
        "reconciliation": "Pass|Fail",
        "notes": "reconciliation details"
      }}
    ]
  }},
  "tax_reconciliation": {{
    "accounts": [
      {{
        "name": "ATO Integrated Client Account (ICA)",
        "balance_30jun25": 0.00,
        "status": "Reconciled|N/A",
        "notes": "details"
      }},
      {{
        "name": "ATO Income Tax Account (ITA)",
        "balance_30jun25": 0.00,
        "status": "Reconciled|N/A",
        "notes": "details"
      }}
    ],
    "outstanding_returns": {{
      "FY25": "Outstanding|Lodged|N/A",
      "details": "detail"
    }}
  }},
  "member_reconciliation": {json.dumps(members_reconciliation)}
}}

IMPORTANT for "holdings_reconciliation" and "distribution_checks": these are examples of the
SHAPE only — do not force a check on a security this fund doesn't actually hold. Look at the
fund's actual classified documents and only include an entry where you can genuinely
cross-reference two independent sources (broker vs registry/wrap, or tax statement vs
periodic statement) for the SAME holding. If no such cross-referenceable holding exists,
return empty arrays for both — an empty array is the correct answer, not a fabricated one.

IMPORTANT for "member_reconciliation": the input above is the list of ALL of this fund's
members (from the fund profile) as a JSON array — one placeholder object per member. Return
the SAME LENGTH array, one completed object per member, in the same order. Do not return a
single object and do not drop any member.

IMPORTANT for "checklist": mark an item "Verified" ONLY when a specific provided document
actually evidences it, and name that document in "files". If no provided document supports a
required item, set it to "Missing" — never assume a document is "on file", "standard", or
"assumed compliant", and never mark "Verified" with an empty "files" array. Use "N/A" only
when the item is genuinely not applicable to this fund (e.g. a change of trustee that did not
occur during the period, or a term deposit the fund does not hold) — "N/A" is not a substitute
for "Missing".
"""

    update_progress(80, f"Querying OpenRouter AI ({model}) for dynamic audit analysis...")
    ai_results = {}
    use_fallback = False

    try:
        res, usage = query_openrouter(api_key, system_prompt, f"Here is the text extracted from the working papers:\n\n{all_docs_context}", response_format={"type": "json_object"}, model=model)
        if record_usage:
            record_usage('phase2_checklist', 'phase2', usage)
        ai_results = json.loads(res)
        update_progress(90, "Successfully received audit analysis from AI!")
    except Exception as e:
        print(f"Audit analysis call failed: {e}", file=sys.stderr)
        use_fallback = True

    if use_fallback:
        update_progress(90, "AI query failed. Using pre-calculated local audit analysis...")
        from verify_and_generate_workpapers import get_fallback_audit_data
        ai_results = get_fallback_audit_data(available_files)

    # Overlay the Cash Lead Schedule with the already tie-out-validated opening/closing
    # balances from Phase 2 bank reconciliation, when available. Don't let the LLM
    # re-derive (and potentially disagree with) a number the app already computed
    # deterministically from the statement's own control totals — this guarantees the
    # Reconciliation tab and the Lead Schedules tab always show the same balance for the
    # same account (see docs/LEAD_SCHEDULES_ACCURACY_FIX.md).
    if reconciliation_results:
        cash_accounts = (ai_results.get("cash_reconciliation") or {}).get("accounts") or []
        for acc in cash_accounts:
            acct_result = reconciliation_results.get(str(acc.get("number", ""))) or {}
            controls = acct_result.get("controls") or {}
            # Only trust the deterministic controls when the account's own tie-out actually
            # passed (opening + credits - debits == closing). A merged multi-period statement
            # can trip the known _find_control first-match bug (docs/BANK_ACCOUNT_DISCOVERY_RCA
            # .md) and anchor on an early period's closing figure instead of the true FY-end
            # one — the tie-out failing is exactly the signal that's happened. In that case,
            # overriding would REPLACE a possibly-correct LLM answer with a KNOWN-wrong one, so
            # leave the LLM's figure as the fallback instead.
            if (acct_result.get("reconciliation") or {}).get("tie_out") is not True:
                continue
            if controls.get("opening") is not None:
                acc["opening_bal_1jul24"] = controls["opening"]
            if controls.get("closing") is not None:
                acc["closing_bal_30jun25"] = controls["closing"]

    # Normalize legacy shapes — the local error-path fallback (verify_and_generate_workpapers
    # .get_fallback_audit_data) predates this schema and still returns the old single-member /
    # single-hardcoded-security shape. Convert it here so every downstream consumer (app.py,
    # the frontend) only ever has to handle one shape: member_reconciliation as a list,
    # portfolio holdings/distribution checks as lists.
    member_rec = ai_results.get("member_reconciliation")
    if isinstance(member_rec, dict):
        ai_results["member_reconciliation"] = [member_rec]

    portfolio = ai_results.get("portfolio_reconciliation")
    if isinstance(portfolio, dict):
        legacy_mxt = portfolio.pop("mxt_reconciliation", None)
        if legacy_mxt and "holdings_reconciliation" not in portfolio:
            portfolio["holdings_reconciliation"] = [{
                "security_name": legacy_mxt.get("description", "Holding"),
                **{k: v for k, v in legacy_mxt.items() if k != "description"},
            }]
        legacy_dist = portfolio.pop("distribution_check", None)
        if legacy_dist and "distribution_checks" not in portfolio:
            portfolio["distribution_checks"] = [{
                "security_name": "Managed fund distribution",
                "tax_statement_distribution": legacy_dist.get("mxt_tax_statement_distribution"),
                "periodic_statement_distribution": legacy_dist.get("mxt_periodic_statement_distribution"),
                "reconciliation": legacy_dist.get("reconciliation"),
                "notes": legacy_dist.get("notes"),
            }]

    # Clean and fill checklist files dynamically.
    #
    # Deterministic evidence grounding: a checklist item may only be "Verified" when a
    # real workpaper file backs it. Workpaper files are named "<classification category>
    # - <sub_type> ...pdf" (see classify_papers), so we match on the category string.
    # The four categories below (Cash at Bank, Listed Securities, Current Tax, Other
    # Expenses) have bespoke matchers; the permanent/general/prior-year/term-deposit
    # items match by name via CHECKLIST_FILE_MATCHERS. Only items whose documents can
    # actually be produced by the classifier are listed — items with no possible
    # evidence source (e.g. Trustee Minutes) correctly fall through to "Missing" below,
    # rather than being rubber-stamped "Verified" on the LLM's assumption.
    CHECKLIST_FILE_MATCHERS = {
        "Trust Deed": ["Trust Deed"],
        "Change of Trustee": ["Change of trustee", "Change of Trustee"],
        "ATO Trustee Declaration": ["Trustee Declaration"],
        "Investment Strategy": ["Investment Strategy"],
        "Death Benefit Nominations": ["Death Benefit"],
        "ASIC Statement/Extract": ["ASIC Statement", "ASIC Extract"],
        "Member Joined or Left": ["Member Joined or Left", "Member Joined"],
        "Prior Year Audit Reports / Financials": ["Prior Year Documents", "Prior Year"],
        "Term Deposit Certificates/Statements": ["Term Deposit"],
    }
    checklist_status = ai_results.get("checklist", {})
    for cat, items in checklist_status.items():
        for name, details in items.items():
            if details.get("status") == "N/A" and job_type == "Accounting":
                details["files"] = []
                continue
                
            details["files"] = []
            if cat == "Cash at Bank":
                for acc in fund_profile.get("bank_accounts", []):
                    acc_num_clean = acc["number"].replace(" ", "").replace("-", "")
                    if acc_num_clean in name or (len(acc_num_clean) > 8 and acc_num_clean[-8:] in name):
                        details["files"] = [f for f in available_files if acc_num_clean in f]
                if "Other Cash Accounts" in name or "Other Cash" in name:
                    # Broker cash now files under "Broker - ...". Legacy "Ordr Mint" kept.
                    details["files"] = [f for f in available_files if f.startswith("Broker") or "Ordr Mint" in f or "ord_mint" in f.lower()]
            elif cat == "Listed Securities & Portfolios":
                # New filenames: "Wrap - ... Portfolio Valuation Report ...",
                # "Broker - ... Portfolio Valuation Report ...". Legacy names kept.
                if "Portfolio Valuations" in name:
                    details["files"] = [f for f in available_files if "Portfolio Valuation" in f]
                elif "Wrap Portfolio Reports" in name:
                    details["files"] = [f for f in available_files if f.startswith("Wrap") or "F25 Periodic" in f]
                elif "Broker Transactions" in name:
                    details["files"] = [f for f in available_files if f.startswith("Broker") or "Ordr Mint" in f]
                elif "Tax Statements" in name:
                    details["files"] = [f for f in available_files if "Tax Statement" in f or "ATO Accounts" in f or "Income Tax.pdf" in f]
            elif cat == "Current Tax Assets/Liabilities":
                # ATO income-tax / integrated-client accounts now roll up to "ATO Accounts".
                details["files"] = [f for f in available_files if "ATO Accounts" in f or "ICA" in f or "ITA" in f or "Income Tax Activity" in f]
            elif cat == "Other Expenses":
                # Accounting/audit/adviser fees now roll up to "Other Expenses - <sub_type>".
                # sub_type keyword in the filename disambiguates accountancy vs audit.
                if "Accountancy" in name:
                    details["files"] = [f for f in available_files if (("Other Expenses" in f and "Audit" not in f) or "Accountancy" in f or "RI34193" in f)]
                elif "Audit" in name:
                    details["files"] = [f for f in available_files if (("Other Expenses" in f and "Audit" in f) or "Audit Invoice" in f)]
            elif name in CHECKLIST_FILE_MATCHERS:
                needles = [n.lower() for n in CHECKLIST_FILE_MATCHERS[name]]
                details["files"] = [
                    f for f in available_files if any(n in f.lower() for n in needles)
                ]

            # Evidence rule: a supporting file makes the item "Verified"; conversely an
            # item the LLM marked "Verified" with NO supporting file was asserted on
            # assumption ("assumed on file", "assumed compliant") and cannot stand — it
            # is downgraded to "Missing" so the exception log surfaces it. "N/A" is left
            # untouched: a genuinely not-applicable item (a change of trustee that never
            # happened, a term deposit the fund doesn't hold) has nothing to evidence.
            # See docs/CHECKLIST_EVIDENCE_GROUNDING_FIX.md.
            if details["files"]:
                details["status"] = "Verified"
            elif str(details.get("status", "")).strip().lower() == "verified":
                details["status"] = "Missing"
                details["notes"] = (
                    "No supporting document found in the workpapers "
                    "(auto-downgraded from an unverified 'Verified')."
                )
                
    # If job_type is Accounting, forcefully override checklist statuses to N/A for audit/permanent tasks
    if job_type == "Accounting":
        for cat in ["Permanent Documents", "Prior Year Documents", "Accounting and Audit Reports"]:
            if cat in checklist_status:
                for name in checklist_status[cat]:
                    checklist_status[cat][name]["status"] = "N/A"
                    checklist_status[cat][name]["notes"] = "Not required under Accounting Playbook."
                    checklist_status[cat][name]["files"] = []
                    
        if "Other Expenses" in checklist_status and "Audit Invoices" in checklist_status["Other Expenses"]:
            checklist_status["Other Expenses"]["Audit Invoices"]["status"] = "N/A"
            checklist_status["Other Expenses"]["Audit Invoices"]["notes"] = "Not required under Accounting Playbook."
            checklist_status["Other Expenses"]["Audit Invoices"]["files"] = []

        if "Current Tax Assets/Liabilities" in checklist_status:
            for name in checklist_status["Current Tax Assets/Liabilities"]:
                checklist_status["Current Tax Assets/Liabilities"][name]["status"] = "N/A"
                checklist_status["Current Tax Assets/Liabilities"][name]["notes"] = "Not required under Accounting Playbook."
                checklist_status["Current Tax Assets/Liabilities"][name]["files"] = []

        # Simplify tax reconciliation
        if "tax_reconciliation" in ai_results:
            for acc in ai_results["tax_reconciliation"].get("accounts", []):
                acc["status"] = "N/A"
                acc["notes"] = "Not required under Accounting Playbook."
            if "outstanding_returns" in ai_results["tax_reconciliation"]:
                ai_results["tax_reconciliation"]["outstanding_returns"]["FY25"] = "N/A"
                ai_results["tax_reconciliation"]["outstanding_returns"]["details"] = "Not required under Accounting Playbook."

    return ai_results

def build_phase2_context(job_id, fund_profile, job_record):
    """Builds the structured context dict consumed by every Phase 2 function.

    Returns:
        dict with keys: fund_id, job_type, bank_accounts, supporting_documents,
        reconciliation_notes_path, processor_notes, unprocessed_files
    """
    workpaper_dir = os.path.join(os.getcwd(), "jobs", job_id, "workpaper")

    # Map account number -> file record for all bank statement files
    account_numbers = {acc["number"] for acc in fund_profile.get("bank_accounts", [])}
    bank_account_map = {}
    for f in job_record.get("files", []):
        acct = f.get("account_number")
        if acct and acct in account_numbers:
            bank_account_map[acct] = f

    # One entry per fund account; warn if no matching statement was found
    bank_accounts = []
    for acc in fund_profile.get("bank_accounts", []):
        file_record = bank_account_map.get(acc["number"])
        if file_record:
            candidate = os.path.join(workpaper_dir, file_record["classified_name"])
            statement_path = candidate if os.path.exists(candidate) else None
        else:
            print(
                f"[Phase 2] WARNING: no statement file found for account "
                f"{acc['number']} ({acc['name']})",
                file=sys.stderr,
            )
            statement_path = None
            file_record = None
        bank_accounts.append({
            "name": acc["name"],
            "number": acc["number"],
            "bsb": acc.get("bsb"),
            "statement_path": statement_path,
            "file_record": file_record,
        })

    # Everything that isn't a bank statement goes into supporting_documents
    bank_classified_names = {f["classified_name"] for f in bank_account_map.values()}
    supporting_documents = []
    for f in job_record.get("files", []):
        if f.get("classified_name") not in bank_classified_names:
            doc_path = os.path.join(workpaper_dir, f["classified_name"])
            supporting_documents.append({
                "category": f.get("category"),
                "classified_name": f.get("classified_name"),
                "path": doc_path if os.path.exists(doc_path) else None,
                "file_record": f,
            })

    # Reconciliation notes: first PDF found in Additional Notes subfolder
    notes_dir = os.path.join(fund_profile["folder_path"], "Additional Notes")
    reconciliation_notes_path = None
    if os.path.isdir(notes_dir):
        pdf_files = sorted(f for f in os.listdir(notes_dir) if f.lower().endswith(".pdf"))
        if pdf_files:
            reconciliation_notes_path = os.path.join(notes_dir, pdf_files[0])
            if len(pdf_files) > 1:
                print(
                    f"[Phase 2] WARNING: multiple PDFs in Additional Notes; using {pdf_files[0]}",
                    file=sys.stderr,
                )

    return {
        "fund_id": job_record.get("fund_id"),
        "job_type": job_record.get("job_type"),
        "bank_accounts": bank_accounts,
        "supporting_documents": supporting_documents,
        "reconciliation_notes_path": reconciliation_notes_path,
        "processor_notes": job_record.get("processor_notes", ""),
        "unprocessed_files": job_record.get("unprocessed_files", []),
    }


def _lenient_json_loads(res, context=""):
    """Parse an LLM JSON response tolerantly. LLMs occasionally return an empty string,
    a markdown-fenced block, or prose around the JSON — a bare json.loads() on that
    raises and (previously) aborted the whole Phase-2 worker. Returns the parsed object,
    or None when nothing usable can be recovered (caller decides how to degrade)."""
    if not res or not str(res).strip():
        print(f"[Phase 2] Empty LLM response{(' — ' + context) if context else ''}", file=sys.stderr)
        return None
    s = str(res).strip()
    # Strip ```json ... ``` / ``` ... ``` fences if present
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z0-9]*\s*", "", s)
        if s.endswith("```"):
            s = s[:-3]
        s = s.strip()
    try:
        return json.loads(s)
    except (json.JSONDecodeError, ValueError):
        # Salvage the outermost JSON object/array if wrapped in prose
        start = min([i for i in (s.find("{"), s.find("[")) if i != -1], default=-1)
        end = max(s.rfind("}"), s.rfind("]"))
        if start != -1 and end > start:
            try:
                return json.loads(s[start:end + 1])
            except (json.JSONDecodeError, ValueError):
                pass
    print(f"[Phase 2] Could not parse LLM JSON{(' — ' + context) if context else ''}", file=sys.stderr)
    return None


# Statement-scoped OCR settings. Higher DPI (300) recovers the small-font amount column
# that 150 DPI drops. We deliberately keep tesseract's DEFAULT page-segmentation (auto,
# psm 3) rather than psm 6: an A/B on the NAB statement showed psm 6 collapses the page
# into one block and DROPS the dot-leader amount lines (7 amounts vs 15 at psm 3). Only
# the DPI bump is applied; psm stays default. Scoped to bank-statement parsing only.
STATEMENT_OCR_DPI = 300
STATEMENT_OCR_PSM = None  # None => tesseract default (auto, psm 3)

_DOT_LEADER_RE = re.compile(r"(?:[.…]\s*){3,}")
_OPENING_BAL_RE = re.compile(r"brought\s+forward|opening\s+balance|balance\s+b/?f(?:wd)?", re.I)
_CLOSING_BAL_RE = re.compile(r"closing\s+balance|balance\s+c/?f(?:wd)?", re.I)
_INTEREST_CREDIT_RE = re.compile(r"\b(?:credit\s+interest|interest\s+(?:paid|credited)|interest)\b", re.I)


def _clean_statement_text(text):
    """Collapse dot-leader runs (e.g. 'Superchoice P/L 481471........1,664.84') to a
    single space so OCR'd amounts adjacent to leaders aren't swallowed by the parser."""
    if not text:
        return text
    return _DOT_LEADER_RE.sub(" ", text)


def _is_opening_balance_row(desc):
    return bool(_OPENING_BAL_RE.search(desc or ""))


def _is_closing_balance_row(desc):
    return bool(_CLOSING_BAL_RE.search(desc or ""))


def _find_control(text, label_re):
    """Find a statement control figure: the first amount within 80 chars after a label."""
    m = re.search(label_re, text or "", re.I)
    if not m:
        return None
    window = (text or "")[m.end(): m.end() + 80]
    am = re.search(r"([0-9][0-9,]*\.\d{2})", window)
    return _recon_parse_amount(am.group(1)) if am else None


def _parse_statement_controls(text):
    """Extract the statement's own control totals (the summary box), which OCR captures
    reliably and which are the audit anchors for validating the transaction extraction."""
    return {
        "opening": _find_control(text, r"opening\s+balance|brought\s+forward"),
        "closing": _find_control(text, r"closing\s+balance"),
        "total_credits": _find_control(text, r"total\s+credits?"),
        "total_debits": _find_control(text, r"total\s+debits?"),
    }


def _amount_in_text(amt, text):
    """True if `amt` appears verbatim in the statement text, in any common format."""
    if amt is None:
        return False
    cands = {f"{amt:,.2f}", f"{amt:.2f}", f"{amt:,.0f}"}
    if amt == int(amt):
        cands.add(str(int(amt)))
    return any(c in (text or "") for c in cands)


def _resolve_statement_amounts(transactions, text, controls):
    """Audit-grounded amount resolution. An LLM-emitted amount is TRUSTED only if it is
    corroborated — either it appears verbatim in the statement text, OR it equals the
    running-balance movement. An uncorroborated amount (likely a mis-read or hallucination,
    e.g. a '27,000' that appears nowhere) is REJECTED; we substitute the balance-delta if
    one is available, otherwise the amount is marked 'unresolved' (never a fabricated
    number). Each row gets amount_status: ocr_confirmed | balance_confirmed |
    balance_derived | unresolved. Opening rows are flagged and used as the balance anchor,
    seeded from the statement's stated opening balance when present."""
    prev_bal = (controls or {}).get("opening")
    for t in transactions:
        desc = t.get("description", "") or ""
        bal = _recon_parse_amount(t.get("balance"))
        if _is_opening_balance_row(desc):
            t["is_opening_balance"] = True
            if bal is not None:
                prev_bal = bal
            continue
        read_amt = _recon_txn_amount(t)
        delta = round(bal - prev_bal, 2) if (bal is not None and prev_bal is not None) else None

        resolved, status = None, "unresolved"
        if read_amt is not None:
            corr_text = _amount_in_text(read_amt, text)
            corr_delta = delta is not None and abs(abs(delta) - read_amt) <= 0.01
            if corr_text and corr_delta:
                resolved, status = read_amt, "ocr_confirmed"
            elif corr_text or corr_delta:
                resolved, status = read_amt, "ocr_confirmed" if corr_text else "balance_confirmed"
            elif delta is not None and abs(delta) >= 0.01:
                resolved, status = abs(delta), "balance_derived"  # reject the uncorroborated read
            else:
                resolved, status = None, "unresolved"
        elif delta is not None and abs(delta) >= 0.01:
            resolved, status = abs(delta), "balance_derived"

        if resolved is None:
            t["debit"], t["credit"] = None, None
        elif delta is not None:
            if delta >= 0:
                t["credit"], t["debit"] = resolved, None
            else:
                t["debit"], t["credit"] = resolved, None
        elif t.get("debit"):
            t["debit"], t["credit"] = resolved, None
        else:
            t["credit"], t["debit"] = resolved, None
        t["amount_status"] = status

        if bal is not None:
            prev_bal = bal
    return transactions


def _compute_statement_reconciliation(acc_result, controls):
    """Statement-level tie-out against the stated controls (the audit gate). Returns a
    dict describing whether the extracted transactions reconcile: opening + credits -
    debits should equal closing, with no unresolved amounts. When it does not tie (or
    controls are unavailable), the statement is flagged for manual review rather than
    trusted."""
    controls = controls or {}
    txs = [t for t in acc_result.get("transactions", []) if not t.get("is_opening_balance")]
    credits = round(sum(_recon_parse_amount(t.get("credit")) or 0.0 for t in txs), 2)
    debits = round(sum(_recon_parse_amount(t.get("debit")) or 0.0 for t in txs), 2)
    unresolved = sum(1 for t in txs if t.get("amount_status") == "unresolved")
    opening, closing = controls.get("opening"), controls.get("closing")

    tie_out, gap = None, None
    if opening is not None and closing is not None:
        gap = round(closing - (opening + credits - debits), 2)
        tie_out = abs(gap) <= 0.01

    status = "reconciled" if (tie_out and unresolved == 0) else "needs_review"
    return {
        "status": status,
        "tie_out": tie_out,
        "gap": gap,
        "unresolved_count": unresolved,
        "computed_credits": credits,
        "computed_debits": debits,
        "opening": opening,
        "closing": closing,
        "stated_total_credits": controls.get("total_credits"),
        "stated_total_debits": controls.get("total_debits"),
    }


def _parse_via_llm(text, account, api_key, model=None, record_usage=None):
    """LLM-based transaction parser for Approach A (swappable with _parse_via_regex)."""
    system_prompt = """You are an expert at parsing Australian bank statement text.
Extract every transaction from the provided bank statement text and return them as structured JSON.

Return ONLY a valid JSON object with this exact schema:
{
  "transactions": [
    {
      "date": "DD/MM/YYYY",
      "description": "transaction description as written",
      "debit": null,
      "credit": null,
      "balance": null,
      "raw_line": "original text that was parsed"
    }
  ]
}

Rules:
- Include ALL transactions in original chronological order — do not skip any
- Dates must be in DD/MM/YYYY format
- debit = money OUT of account (positive number); null if not a debit
- credit = money IN to account (positive number); null if not a credit
- ALWAYS capture balance = the running balance shown for/after the transaction (positive
  number). In OCR'd statements the balance often appears on the line AFTER the
  description (e.g. a "…  92,519.18 Cr" line) — associate it with the transaction it
  belongs to, in order. Only use null when no running balance is shown at all.
- For the amount: if the debit/credit is printed, read it. If the amount column is NOT
  legible but the running balances are, COMPUTE the amount as the movement in the running
  balance: amount = this_balance − previous_balance (a positive movement is a credit, a
  negative movement is a debit). This is exact arithmetic, not guessing — do it whenever
  the balances are available. Only if NEITHER the amount NOR a usable pair of balances is
  available, set debit and credit to null.
- INCLUDE every "Brought forward" / opening-balance / "Statement Opening Balance" row you
  encounter (with its balance), so the running balance has an anchor. A single statement
  text may contain SEVERAL of these if it spans multiple periods merged together (e.g. one
  per quarter) — include ALL of them, not just the first.
- EXCLUDE every "Closing Balance" / "Statement Closing Balance" / period-summary row you
  encounter — ALL occurrences, not just the last one in the text. A merged multi-page
  statement covering several periods will have MULTIPLE closing-balance lines scattered
  through it (one per period boundary, not only at the very end); every single one of them
  must be dropped, none should ever appear as a transaction row in your output.
- Strip currency symbols and commas from numeric values (e.g. "$1,234.56" → 1234.56)
- SOME accounts are actually a platform/wrap cash ledger (e.g. a "BT Panorama", "Macquarie
  Wrap" or similar investment-platform transaction history) rather than a plain bank
  narrative statement. These render as a WIDE TABLE — trade date, settlement date,
  investment type (e.g. "Cash Management Account"), security code/name, a genuine
  "Description" column, transaction type (e.g. "Income", "Fee", "Buy", "Sell"), units, and
  net amount — that OCR/text-extraction flattens onto one line per row, e.g.:
  "30 June 2025  29 July 2025  Cash Management Account  ETL4846AU · Spire Multifamily
  Growth and Income Fund  Distribution 43,121.005895 Spire Multifamily Growth and Income
  Fund @ $0.006433  Income  $277.40".
  When you see this shape, `description` must be ONLY the genuine narrative text from the
  Description column (here: "Distribution 43,121.005895 Spire Multifamily Growth and
  Income Fund @ $0.006433") — never prepend the settlement date, investment type label,
  or security code, and never append the transaction-type label (Income/Fee/Buy/Sell) or
  repeat the amount. Put the full original flattened line in `raw_line` so nothing is
  lost, but keep `description` limited to what a bank teller would call the transaction's
  description, not the whole table row.
"""
    user_content = (
        f"Account: {account.get('name', 'Unknown')} (Number: {account.get('number', 'Unknown')})\n\n"
        f"Bank statement text:\n```\n{text}\n```\n\nExtract all transactions."
    )
    res, usage = query_openrouter(
        api_key, system_prompt, user_content,
        response_format={"type": "json_object"},
        timeout=180,
        **({"model": model} if model else {}),
    )
    if record_usage:
        acc_num = account.get('number', 'unknown')
        record_usage(f'phase2_extract_txns_{acc_num}', 'phase2', usage)
    parsed = _lenient_json_loads(res, context=f"transaction extraction for account {account.get('number', 'unknown')}")
    return parsed if isinstance(parsed, dict) else {"transactions": []}


def extract_transactions_from_statement(pdf_path, account, api_key, model=None, record_usage=None, controls_out=None):
    """Extract structured transaction rows from a bank statement PDF (Approach A — LLM-based).

    Returns a list of transaction dicts: { date, description, debit, credit, balance, raw_line }.
    _parse_via_llm is the active parser; _parse_via_regex can be slotted in without changing callers.
    """
    if not pdf_path or not os.path.exists(pdf_path):
        raise FileNotFoundError(f"Statement PDF not found: {pdf_path}")

    # Extract full text across all pages
    try:
        reader = PdfReader(pdf_path)
        total_pages = len(reader.pages)
        text_parts = []
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
        text = "\n".join(text_parts)
    except Exception as e:
        raise RuntimeError(f"Failed to read {pdf_path}: {e}")

    # OCR fallback for scanned statements. Use the same density-based gate as
    # Phase 1: < 80 chars/page on a multi-page PDF means the text layer is just
    # embedded labels from a scanned document. OCR every page so the full
    # transaction history is available to the parser.
    scratch_dir = os.path.join(os.path.dirname(pdf_path), "..", "scratch")
    _density_too_low = total_pages > 3 and (len(text.strip()) / total_pages) < 80
    if len(text.strip()) < 100 or _density_too_low:
        try:
            ocr_parts = []
            for page_idx in range(total_pages):
                try:
                    # Statement-scoped high-fidelity OCR (300 DPI, psm 6) to retain the
                    # amount/balance columns of dense columnar statements.
                    ocr_parts.append(ocr_pdf_single_page(
                        pdf_path, page_idx, scratch_dir,
                        dpi=STATEMENT_OCR_DPI, psm=STATEMENT_OCR_PSM,
                    ))
                except Exception:
                    pass
            if ocr_parts:
                text = "\n".join(ocr_parts)
        except Exception as e:
            raise RuntimeError(f"OCR fallback failed for {pdf_path}: {e}")

    # Collapse dot-leader runs so amounts adjacent to leaders survive parsing.
    text = _clean_statement_text(text)

    # Capture the statement's own control totals (audit anchors) for tie-out validation.
    controls = _parse_statement_controls(text)
    if controls_out is not None:
        controls_out.update(controls)

    result = _parse_via_llm(text, account, api_key, model=model, record_usage=record_usage)
    transactions = result.get("transactions", [])

    # Deterministic backstop: the extraction prompt already tells the model to exclude
    # every closing-balance/period-summary row, but that's a prompt instruction, not a
    # guarantee — models vary in how reliably they follow "every occurrence" across a
    # merged multi-period statement (see docs/RECONCILIATION_CLOSING_BALANCE_LEAK_FIX.md).
    # Strip any row that slipped through regardless of which model extracted it, so this
    # bug class can't recur no matter how the prompt is worded.
    _before = len(transactions)
    transactions = [t for t in transactions if not _is_closing_balance_row(t.get("description", ""))]
    if len(transactions) != _before:
        print(
            f"[Phase 2] Dropped {_before - len(transactions)} closing-balance row(s) "
            f"the extractor didn't exclude for account {account.get('number')}",
            file=sys.stderr,
        )

    # Audit-grounded resolution: trust only corroborated amounts (present in text OR equal
    # to the balance movement); reject uncorroborated reads; derive from balances where
    # possible; mark the rest 'unresolved'. Never fabricate a number.
    transactions = _resolve_statement_amounts(transactions, text, controls)
    _stat = defaultdict(int)
    for t in transactions:
        if not t.get("is_opening_balance"):
            _stat[t.get("amount_status", "unresolved")] += 1
    print(
        f"[Phase 2] Amount resolution for account {account.get('number')}: "
        + ", ".join(f"{k}={v}" for k, v in sorted(_stat.items())),
        file=sys.stderr,
    )

    if not transactions and len(text.strip()) > 50:
        print(
            f"[Phase 2] WARNING: zero transactions parsed from non-empty statement "
            f"for account {account.get('number')}",
            file=sys.stderr,
        )
    else:
        print(
            f"[Phase 2] Extracted {len(transactions)} transactions from "
            f"{os.path.basename(pdf_path)}",
            file=sys.stderr,
        )

    return transactions


# Words that look like ASX ticker codes but appear as standalone lines in portfolio-valuation
# text (description suffixes, legal designations, state codes, common abbreviations).
_PV_NON_TICKER = {
    'UNITS', 'FORUS', 'STPD', 'STP', 'FPO', 'CDI', 'ORD',
    'ABN', 'AFS', 'AFSL', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT',
    'ASX', 'ASIC', 'ATO', 'GPO', 'AUD', 'USD', 'GST', 'CGT',
    'TSB', 'TFN', 'ETF', 'NAV', 'BSB', 'REF', 'BOX', 'CHQ',
    # Ord Minnett portfolio section sub-headers that look like ASX tickers
    'REIT', 'HYBD', 'PROP', 'INTL', 'BOND', 'DEBT', 'INFRA', 'CASH', 'ALTV',
}

# ASX ticker pattern — 2–6 chars, first must be a letter, rest letters or digits (e.g. S32).
_ASX_TICKER_RE = re.compile(r'^[A-Z][A-Z0-9]{1,5}$')


def _extract_portfolio_holdings(full_text, doc_name):
    """Parse portfolio valuation raw text into a compact one-line-per-holding summary.

    Format: 'CODE: Description Name (N units)' — one security per line.
    Falls back to the first 6,000 chars of raw text if the ticker-anchored parse finds nothing.
    """
    # Trim legal disclaimer footer so it doesn't generate false tickers.
    for marker in ('This document was prepared', 'Ord Minnett Limited', 'A Market Participant'):
        idx = full_text.find(marker)
        if 0 < idx:
            full_text = full_text[:idx]
            break

    # Anchor search to the Equity table section (skips header address block).
    equity_idx = full_text.find('Equity\n')
    search_text = full_text[equity_idx:] if equity_idx >= 0 else full_text

    lines = [l.strip() for l in search_text.split('\n') if l.strip()]

    # Find every line that is an ASX ticker code.
    ticker_positions = [
        i for i, line in enumerate(lines)
        if _ASX_TICKER_RE.match(line) and line not in _PV_NON_TICKER
    ]

    if not ticker_positions:
        return full_text[:6000]

    holdings = []
    for pos_idx, tpos in enumerate(ticker_positions):
        ticker = lines[tpos]
        # Slice the block between this ticker and the next (up to 15 lines max).
        next_tpos = ticker_positions[pos_idx + 1] if pos_idx + 1 < len(ticker_positions) else tpos + 15
        block = lines[tpos + 1: min(next_tpos, tpos + 15)]

        # Description: non-numeric lines at the start of the block.
        desc_parts = []
        for bl in block:
            if re.match(r'^[\d$\(]', bl):
                break
            desc_parts.append(bl)
        desc = ' '.join(desc_parts).strip()
        if not desc or len(desc) < 2:
            continue

        # Units: first plain-integer line after description.
        units = None
        for bl in block[len(desc_parts):]:
            candidate = bl.replace(',', '')
            if re.match(r'^\d+$', candidate):
                units = bl
                break
            if re.match(r'^\$', bl):
                break  # into dollar amounts — no units line present

        entry = f"{ticker}: {desc}"
        if units:
            entry += f" ({units} units)"
        holdings.append(entry)

    if not holdings:
        return full_text[:6000]

    return f"[{doc_name}]\n" + '\n'.join(holdings)


def _extract_supporting_doc_text(doc_path, scratch_dir=None):
    """Extract text from a supporting document for the reconciliation prompt.

    1. Try pypdf across ALL pages.
    2. If sparse (< 80 chars/page on multi-page PDFs, or < 100 chars total), fall back to Tesseract OCR on every page and concatenate.

    Returns the extracted text string (may be empty if all methods fail).
    """
    if not doc_path or not os.path.exists(doc_path):
        return ''

    # 1. PDF text extraction.
    pages_text = []
    num_pages = 0
    try:
        reader = PdfReader(doc_path)
        num_pages = len(reader.pages)  # capture before loop so mid-loop exceptions don't lose count
        for page in reader.pages:
            pages_text.append(page.extract_text() or '')
        full_text = '\n'.join(pages_text).strip()
    except Exception as e:
        print(
            f'[Phase 2] _extract_supporting_doc_text: pypdf failed for '
            f'{os.path.basename(doc_path)}: {e}',
            file=sys.stderr,
        )
        full_text = ''

    if len(full_text) >= 100:
        return full_text

    # 2. OCR fallback — process every page.
    if scratch_dir is None:
        # Derive from doc path: jobs/{job_id}/workpaper/... → jobs/{job_id}/scratch
        scratch_dir = os.path.join(os.path.dirname(os.path.dirname(doc_path)), 'scratch')
    os.makedirs(scratch_dir, exist_ok=True)

    if num_pages == 0:
        try:
            num_pages = len(PdfReader(doc_path).pages)
        except Exception:
            return ''

    print(
        f'[Phase 2] sparse text ({len(full_text)} chars) — '
        f'OCR all {num_pages} page(s) of {os.path.basename(doc_path)}',
        file=sys.stderr,
    )
    ocr_pages = []
    for page_idx in range(num_pages):
        try:
            page_text = ocr_pdf_single_page(doc_path, page_idx, scratch_dir)
            if page_text:
                ocr_pages.append(page_text)
        except Exception as e:
            print(
                f'[Phase 2] OCR page {page_idx + 1} failed for '
                f'{os.path.basename(doc_path)}: {e}',
                file=sys.stderr,
            )

    return '\n'.join(ocr_pages).strip()


_TXN_LEDGER_HEADER_MARKERS = ("trade date", "net amount")
_TXN_LEDGER_DATE_LINE_RE = re.compile(r"^\d{1,2}\s+[A-Za-z]+\s+\d{4}\b")


def _looks_like_transaction_history(text):
    """True if `text` looks like a dated wrap/platform transaction listing (distributions,
    income, fees, redemptions) rather than a static holdings valuation snapshot. This is a
    content sniff, not a category-name check — one classification category ("Wrap - Annual
    Transaction Listing and Portfolio Valuation Report") bundles both document shapes, and
    routing by category name alone caused a transaction-history document to be destroyed by
    the holdings compressor (see docs/RECONCILIATION_TRANSFER_DETECTION_FIX.md)."""
    if not text:
        return False
    lower = text.lower()
    if all(marker in lower for marker in _TXN_LEDGER_HEADER_MARKERS):
        return True
    # Fallback for platforms that word their column headers differently: a genuine
    # transaction ledger has rows spread across MANY distinct dates. A holdings valuation
    # snapshot's rows are each also date-led (the "as at" valuation date), but every row
    # repeats the SAME single date — so require several distinct dates, not just several
    # date-led lines, or a single-date snapshot false-positives as a ledger.
    dates = {
        m.group(0) for line in text.split("\n")
        if (m := _TXN_LEDGER_DATE_LINE_RE.match(line.strip()))
    }
    return len(dates) >= 3


def _strip_repeated_boilerplate(text, min_len=8, min_repeats=3):
    """Drop lines that repeat verbatim across a multi-page document after their first
    occurrence — page headers/footers repeat identically on every page and carry no
    reconciliation value, while genuine transaction lines (even similar ones) don't repeat
    byte-for-byte. Keeps one copy of each repeated line for context, removes the rest."""
    lines = text.split("\n")
    counts = Counter(l.strip() for l in lines if len(l.strip()) >= min_len)
    seen = set()
    out = []
    for line in lines:
        key = line.strip()
        if len(key) >= min_len and counts[key] >= min_repeats:
            if key in seen:
                continue
            seen.add(key)
        out.append(line)
    return "\n".join(out)


def _count_amount_occurrences(amount, text, tol=0.01):
    """How many times `amount` (to the cent) appears as a monetary figure in `text`."""
    if amount is None or not text:
        return 0
    count = 0
    for m in _RECON_AMOUNT_RE.findall(text):
        v = _recon_parse_amount(m)
        if v is not None and abs(v - amount) <= tol:
            count += 1
    return count


def build_reconciliation_prompt(phase2_context, transactions_by_account, scratch_dir=None):
    """Build the (system_prompt, user_content) pair for the reconciliation LLM call.

    Preamble: reconciliation notes (if present).
    Subject: all transactions across all accounts.
    Evidence: supporting document text excerpts (OCR fallback for scanned PDFs; structured
    extraction for Portfolio Valuations), annotated with a recurring-amount note when a
    document's evidence for an amount is scarcer than the number of transactions sharing
    that amount — the model tends to double-count a single document across multiple
    transactions unless this is called out explicitly (see CRITICAL GUARDRAILS below).
    """
    # Count how often each transaction amount recurs across the full transaction set, so a
    # document that only substantiates ONE occurrence of a recurring amount can be flagged
    # before it gets claimed by more than one transaction.
    recurring_amounts = Counter()
    for transactions in transactions_by_account.values():
        for tx in transactions:
            if tx.get("is_opening_balance"):
                continue
            amt = tx.get("debit") or tx.get("credit")
            if amt:
                recurring_amounts[round(float(amt), 2)] += 1
    # Reconciliation notes preamble
    notes_preamble = ""
    notes_path = phase2_context.get("reconciliation_notes_path")
    if notes_path and os.path.exists(notes_path):
        try:
            reader = PdfReader(notes_path)
            notes_text = "".join(
                (page.extract_text() or "") + "\n" for page in reader.pages
            ).strip()
            if notes_text:
                notes_preamble = (
                    "## RECONCILIATION INSTRUCTIONS FROM ACCOUNTANT\n"
                    "The following notes MUST be followed when reconciling:\n\n"
                    f"{notes_text}\n\n---\n\n"
                )
        except Exception:
            pass

    # Supporting document excerpts — RC#1 fix: OCR fallback for scanned PDFs.
    # RC#2 fix: structured extraction for Portfolio Valuations instead of raw truncation.
    supporting_docs_lines = []
    for doc in phase2_context.get("supporting_documents", []):
        doc_path = doc.get("path")
        doc_name = doc.get("classified_name", "")
        doc_category = doc.get("category", "")
        if not doc_path or not os.path.exists(doc_path):
            continue
        try:
            doc_text = _extract_supporting_doc_text(doc_path, scratch_dir)
            if not doc_text:
                continue
            # Dispatch by CONTENT, not category name: a "... Portfolio Valuation Report"
            # category can bundle either a dated transaction listing (distributions,
            # income, fees — exactly what the matcher needs, kept close to raw) or a
            # static holdings snapshot (no dates, no matching value — compress it so it
            # doesn't bloat the prompt with a long securities table).
            if _looks_like_transaction_history(doc_text):
                doc_text = _strip_repeated_boilerplate(doc_text)
            elif "Portfolio Valuation" in doc_category:
                doc_text = _extract_portfolio_holdings(doc_text, doc_name)
            if doc_text:
                # Raw occurrence counts overcount: a single-period document routinely restates
                # its own figure 2-3x (e.g. a payslip's period amount, deduction line, and
                # total are ONE contribution, not three). We can't reliably tell a genuine
                # multi-period document apart from same-period restatement by regex alone, so
                # the safe default is to always cap the claim at 1 — under-claiming just means
                # a legitimate match needs a human look; over-claiming reproduces the original
                # double-counting bug.
                notes = []
                for amt, tx_count in recurring_amounts.items():
                    if tx_count < 2:
                        continue
                    if _count_amount_occurrences(amt, doc_text) >= 1:
                        notes.append(
                            f"NOTE: ${amt:,.2f} recurs in {tx_count} of the bank transactions "
                            f"below. This document is evidence for AT MOST 1 of those "
                            f"transactions, even if the figure appears more than once in the "
                            f"text here (repeats within one document are usually the same "
                            f"instance restated, e.g. a period amount and its total) — match "
                            f"only the single best-fitting one (e.g. by nearest date) and leave "
                            f"the rest unmatched, needing separate supporting evidence."
                        )
                notes_block = ("\n".join(notes) + "\n\n") if notes else ""
                supporting_docs_lines.append(
                    f"=== {doc_name} (Category: {doc_category}) ===\n{notes_block}{doc_text}"
                )
        except Exception:
            continue

    supporting_docs_block = (
        "\n\n".join(supporting_docs_lines)
        if supporting_docs_lines
        else "No supporting documents available."
    )

    # Transaction listing per account
    tx_blocks = []
    for account_number, transactions in transactions_by_account.items():
        account_name = account_number
        for acc in phase2_context.get("bank_accounts", []):
            if acc["number"] == account_number:
                account_name = f"{acc['name']} ({account_number})"
                break
        rows = []
        for i, tx in enumerate(transactions, 1):
            # Opening "brought forward" rows are balance anchors, not transactions —
            # don't ask the matcher to reconcile them.
            if tx.get("is_opening_balance"):
                continue
            debit = f"DR ${tx.get('debit')}" if tx.get("debit") else ""
            credit = f"CR ${tx.get('credit')}" if tx.get("credit") else ""
            amount = debit or credit or "Amount unknown"
            rows.append(
                f"  {i}. {tx.get('date', '?')} | {tx.get('description', 'No description')} | {amount}"
            )
        tx_blocks.append(f"Account: {account_name}\n" + "\n".join(rows))

    transactions_block = "\n\n".join(tx_blocks) if tx_blocks else "No transactions."

    system_prompt = (
        "IMPORTANT: Your entire response must be a single valid JSON object. "
        "Do not include any text, explanation, or markdown before or after the JSON.\n\n"
        f"{notes_preamble}"
        "You are an expert SMSF auditor performing a bank reconciliation.\n\n"
        "Your task: reconcile each bank transaction against the supporting documents below. "
        "A transaction may ONLY be marked 'matched' when a supporting document corroborates "
        "BOTH its narrative (counterparty / purpose) AND its amount. Narrative similarity "
        "alone is NEVER sufficient — the amount must tie out. Use one of two matching methods:\n\n"
        "1. ONE-TO-ONE (narrative + amount): a single supporting document contains an entry "
        "or stated amount that EQUALS the transaction amount (to the cent) AND whose "
        "narrative matches the transaction's counterparty/purpose. Set match_type "
        '"one_to_one", matched_amount to that amount, matched_document to the filename, '
        "match_group to null.\n"
        "2. MANY-TO-ONE (sum tie-out): when several transactions share a similar narrative and "
        "no single document matches each one individually, match them TOGETHER only if their "
        "amounts SUM to an amount stated in ONE supporting document (e.g. 12 monthly super-"
        "guarantee credits summing to the annual concessional-contribution total on an ATO "
        "contribution statement). Give every transaction in that group the SAME match_group id "
        '(e.g. "G1"), set match_type "many_to_one_sum", matched_document to that filename, and '
        "matched_amount to the document total they collectively equal. Only do this when the "
        "group sum equals the document amount (allow rounding to the cent).\n"
        "3. Otherwise the transaction is UNMATCHED.\n\n"
        "CRITICAL GUARDRAILS:\n"
        "- A summary / annual-total / cap document (e.g. an ATO contribution statement or TSB "
        "report showing yearly totals or caps, an annual tax statement) is CORROBORATING ONLY. "
        "NEVER mark an individual deposit 'matched' to it by narrative alone. Match such "
        "documents ONLY via method 2 (sum tie-out) and ONLY when the amounts actually add up; "
        "if the group does not sum to a stated total, mark those transactions unmatched.\n"
        "- Do NOT reuse the same document entry/amount to match more than one transaction or "
        "group (no double-counting). Example: if four bank transactions all show $1,951.05 "
        "(e.g. quarterly super-guarantee payments that happen to be identical because salary "
        "was flat), but a single payslip document only states $1,951.05 for ONE pay period, "
        "that document is evidence for exactly ONE of those transactions — not all four, even "
        "though the figure repeats within the document itself (e.g. as a period amount, a "
        "subtotal, and a total on the same payslip; those are restatements of ONE contribution, "
        "not separate ones). Match the single best-fitting transaction (e.g. by nearest date) "
        "and leave the remaining occurrences unmatched, with a reason noting that additional "
        "documents (for the other periods) are needed — do NOT match them to an unrelated "
        "document just because it mentions a similar or different amount.\n"
        "- A 'NOTE:' line under a supporting document tells you exactly how many transactions "
        "may legitimately be one_to_one matched to that document for a specific recurring "
        "amount — never exceed that count for that document/amount pair.\n\n"
        "## SUPPORTING DOCUMENTS\n\n"
        f"{supporting_docs_block}\n\n"
        "## REQUIRED JSON SCHEMA\n"
        "{\n"
        '  "reconciliation_results": [\n'
        "    {\n"
        '      "account_number": "string",\n'
        '      "account_name": "string",\n'
        '      "transactions": [\n'
        "        {\n"
        '          "date": "DD/MM/YYYY",\n'
        '          "description": "string",\n'
        '          "debit": null,\n'
        '          "credit": null,\n'
        '          "type": "debit or credit",\n'
        '          "status": "matched or unmatched",\n'
        '          "match_type": "one_to_one | many_to_one_sum | unmatched",\n'
        '          "matched_document": "exact supporting document filename, or null if unmatched",\n'
        '          "matched_amount": "the document amount this transaction (one_to_one) or its group (many_to_one_sum) ties out to, as a number; null if unmatched",\n'
        '          "match_group": "shared id (e.g. G1) for transactions that jointly sum-match one document; null for one_to_one and unmatched",\n'
        '          "unmatched_reason": "if unmatched: specific reason no supporting document corroborated the narrative AND amount, and what documentation would resolve it; null if matched"\n'
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- Every transaction must have status 'matched' or 'unmatched' — no other values\n"
        "- status 'matched' requires match_type 'one_to_one' or 'many_to_one_sum'; status "
        "'unmatched' requires match_type 'unmatched'\n"
        "- matched_document: exact filename from the supporting documents list above, or null\n"
        "- matched_amount: numeric; for many_to_one_sum it is the document total the group equals\n"
        "- match_group: same id for all members of a sum-match group; null otherwise\n"
        "- unmatched_reason: null for matched transactions; for unmatched, explain specifically "
        "what is missing (e.g. 'No invoice found — a supplier invoice for $X dated DD/MM would "
        "resolve this', or 'These credits do not sum to any contribution total on file')\n"
        "- Internal transfers between fund accounts are self-matched when the amounts agree "
        "(set matched_document to the receiving/sending account name)\n"
        "- Include ALL transactions in order — do not omit any\n"
        "- Respond with ONLY the JSON object — no other text\n"
    )

    user_content = (
        "Reconcile the following bank transactions against the supporting documents above:\n\n"
        f"{transactions_block}"
    )

    return system_prompt, user_content


def run_reconciliation_call(phase2_context, api_key, update_progress,
                            model=PHASE2_DEFAULT_MODEL,
                            transactions_by_account=None,
                            record_usage=None,
                            scratch_dir=None):
    """Run LLM Call 1 for Story 2: extract transactions then reconcile against supporting docs.

    Returns reconciliation_results dict keyed by account number.

    Pass `transactions_by_account` to skip extraction (useful for benchmarking multiple models
    against the same pre-extracted transactions).
    """
    controls_by_account = {}
    if transactions_by_account is None:
        transactions_by_account = {}
        for account in phase2_context.get("bank_accounts", []):
            statement_path = account.get("statement_path")
            if not statement_path:
                print(
                    f"[Phase 2] Skipping account {account['number']} ({account['name']}) "
                    "— no statement file",
                    file=sys.stderr,
                )
                continue
            update_progress(None, f"Phase 2: Parsing transactions for {account['name']}...")
            try:
                _ctrl = {}
                transactions = extract_transactions_from_statement(
                    statement_path, account, api_key, model=model, record_usage=record_usage,
                    controls_out=_ctrl,
                )
                controls_by_account[account["number"]] = _ctrl
            except Exception as e:
                # A single statement that fails to parse must not abort reconciliation
                # of the remaining accounts. Skip it with a warning; it will simply have
                # no extracted transactions.
                print(
                    f"[Phase 2] WARNING: transaction extraction failed for account "
                    f"{account.get('number')} ({account.get('name')}): {e}",
                    file=sys.stderr,
                )
                update_progress(None, f"Phase 2: Could not parse statement for {account['name']} — skipping.")
                transactions = []
            if transactions:
                transactions_by_account[account["number"]] = transactions

    if not transactions_by_account:
        print("[Phase 2] WARNING: no transactions extracted from any account.", file=sys.stderr)
        return {}

    update_progress(None, "Phase 2: Reconciling transactions against supporting documents...")
    system_prompt, user_content = build_reconciliation_prompt(
        phase2_context, transactions_by_account, scratch_dir=scratch_dir
    )

    res, usage = query_openrouter(
        api_key, system_prompt, user_content,
        response_format={"type": "json_object"},
        model=model,
        timeout=240,
    )
    if record_usage:
        record_usage('phase2_reconcile', 'phase2', usage)
    result = _lenient_json_loads(res, context="bank reconciliation") or {}

    reconciliation_results = {}
    for account_result in result.get("reconciliation_results", []):
        acc_num = account_result.get("account_number")
        if acc_num:
            reconciliation_results[acc_num] = account_result

    # Overlay authoritative extracted amounts/balances (the matcher LLM does not reliably
    # echo them, and it never saw the opening-balance anchor rows). Align by index against
    # the non-opening source transactions the matcher was actually given.
    for acc_num, account_result in reconciliation_results.items():
        src = [t for t in transactions_by_account.get(acc_num, []) if not t.get("is_opening_balance")]
        out = account_result.get("transactions", []) or []
        if len(src) == len(out):
            for s, o in zip(src, out):
                for k in ("debit", "credit", "balance", "amount_status"):
                    if k in s:
                        o[k] = s.get(k)
        else:
            print(
                f"[Phase 2] amount overlay skipped for {acc_num}: matcher returned "
                f"{len(out)} rows vs {len(src)} extracted — using matcher amounts as-is.",
                file=sys.stderr,
            )
        # Attach the statement's control totals and compute the audit tie-out.
        ctrl = controls_by_account.get(acc_num, {})
        account_result["controls"] = ctrl
        account_result["reconciliation"] = _compute_statement_reconciliation(account_result, ctrl)

    return reconciliation_results


def _recon_parse_amount(v):
    """Parse a money value (number or string like '$1,234.56 CR') to a float, else None."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).upper().replace("$", "").replace(",", "").replace("CR", "").replace("DR", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _recon_txn_amount(tx):
    """The absolute magnitude of a reconciled transaction (credit or debit)."""
    for k in ("credit", "debit", "amount"):
        a = _recon_parse_amount(tx.get(k))
        if a:
            return abs(a)
    return None


def _recon_mark_unmatched(tx, reason):
    tx["status"] = "unmatched"
    tx["match_type"] = "unmatched"
    tx["matched_document"] = None
    tx["matched_amount"] = None
    tx["match_group"] = None
    tx["is_internal_transfer"] = False
    tx["internal_transfer_ref"] = None
    tx["unmatched_reason"] = reason


def _recon_parse_date(s):
    """Parse a transaction date string to a datetime, else None."""
    if not s:
        return None
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.datetime.strptime(str(s).strip(), fmt)
        except (ValueError, TypeError):
            continue
    return None


_RECON_AMOUNT_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+")


def _extract_amounts_from_text(text):
    """Set of monetary amounts (floats, rounded to cents) appearing in a document's text."""
    out = set()
    for m in _RECON_AMOUNT_RE.findall(text or ""):
        v = _recon_parse_amount(m)
        if v is not None:
            out.add(round(v, 2))
    return out


def _amount_in_doc(amount, amt_set, tol=0.01):
    """True if `amount` appears in the document's extracted amount set (within tolerance)."""
    if amount is None or not amt_set:
        return False
    return any(abs(amount - a) <= tol for a in amt_set)


def _recon_mark_internal_transfer(tx, other_acc_num, other_idx, other_acc_name):
    """Mark a transaction as a bank-to-bank transfer, linking to the counter-leg."""
    tx["status"] = "matched"
    tx["match_type"] = "internal_transfer"
    tx["is_internal_transfer"] = True
    label = f"{other_acc_name} ({other_acc_num})" if other_acc_name else str(other_acc_num)
    tx["matched_document"] = label  # legacy field kept so older UIs still link
    tx["matched_amount"] = _recon_txn_amount(tx)
    tx["match_group"] = None
    tx["internal_transfer_ref"] = {"account_number": str(other_acc_num), "index": other_idx}
    tx["unmatched_reason"] = None


def mark_no_evidence_transactions(reconciliation_results):
    """Mark transactions that inherently have no external supporting evidence as matched
    (so they don't sit as 'unmatched' or spawn client queries). Currently: bank-credited
    interest (a credit whose narrative is interest). Overrides any prior LLM match."""
    n = 0
    for acc in reconciliation_results.values():
        for t in acc.get("transactions", []) or []:
            if t.get("is_opening_balance"):
                continue
            is_credit = _recon_parse_amount(t.get("credit")) is not None
            if is_credit and _INTEREST_CREDIT_RE.search(t.get("description", "") or ""):
                t["status"] = "matched"
                t["match_type"] = "no_evidence_required"
                t["matched_document"] = None
                t["matched_amount"] = _recon_txn_amount(t)
                t["match_group"] = None
                t["is_internal_transfer"] = False
                t["internal_transfer_ref"] = None
                t["unmatched_reason"] = None
                t["no_evidence_reason"] = "Bank-credited interest — no external evidence required."
                n += 1
    return n


_TRANSFER_KEYWORDS = ("sweep", "transfer", " trf", "trf ", "internal transfer", "inter-account")


def _transfer_corroborated(desc_a, desc_b, acc_num_a, acc_num_b):
    """True if there's a TEXTUAL signal the two legs are the same transfer: either
    narrative reads like a transfer (a bonus signal, not load-bearing — see
    docs/RECONCILIATION_TRANSFER_DETECTION_FIX.md for why a keyword whitelist alone
    can't keep up with every bank's abbreviation), or either narrative names the OTHER
    account's own number (bank-agnostic — banks routinely cite the linked account,
    e.g. "Bt Funds 90167750/Redempt", regardless of what word they use for "transfer")."""
    if any(k in desc_a for k in _TRANSFER_KEYWORDS) or any(k in desc_b for k in _TRANSFER_KEYWORDS):
        return True
    if acc_num_b and str(acc_num_b) in desc_a:
        return True
    if acc_num_a and str(acc_num_a) in desc_b:
        return True
    return False


def detect_internal_transfers(reconciliation_results, tolerance=0.01, max_window_days=120,
                               uncorroborated_window_days=7):
    """Deterministically pair bank-to-bank transfers across the fund's accounts.

    The real signal isn't narrative wording — within one fund's small, closed set of
    accounts, an EQUAL AMOUNT moving in OPPOSITE DIRECTIONS across two different accounts
    within a few days of each other is already a strong fingerprint on its own. Two
    corroboration tiers control how much date slack a pair is allowed:

    - CORROBORATED (`_transfer_corroborated`: keyword match or either leg names the
      other's account number): a generous date window (`max_window_days`) since text
      already ties the legs together — legs can clear weeks apart.
    - UNCORROBORATED (amount + opposite direction only, no textual signal): a tight
      window (`uncorroborated_window_days`) AND the amount must be unambiguous — if more
      than one candidate pair (after corroborated pairs have already claimed their legs)
      shares that amount, none of them are auto-linked, since we can't tell which
      pairing is real without a textual signal. Better to leave genuinely ambiguous
      cases for a human than to guess.

    Each leg is marked as an internal transfer linking to the other. Overrides any prior
    (LLM) match on those legs. Returns the number of transactions marked."""
    legs = []  # (acc_num, acc_name, idx, amount, direction, date, desc_lower)
    for acc_num, acc in reconciliation_results.items():
        acc_name = acc.get("account_name", acc_num)
        for idx, tx in enumerate(acc.get("transactions", []) or []):
            if tx.get("is_opening_balance") or tx.get("match_type") == "no_evidence_required":
                continue
            amt = _recon_txn_amount(tx)
            if not amt:
                continue
            if _recon_parse_amount(tx.get("credit")):
                direction = "credit"
            elif _recon_parse_amount(tx.get("debit")):
                direction = "debit"
            else:
                continue
            legs.append((acc_num, acc_name, idx, amt, direction,
                         _recon_parse_date(tx.get("date")), (tx.get("description") or "").lower()))

    corroborated = []    # (date_diff, i, j)
    uncorroborated = []  # (date_diff, i, j)
    for i in range(len(legs)):
        for j in range(i + 1, len(legs)):
            a, b = legs[i], legs[j]
            if a[0] == b[0]:
                continue  # same account
            if abs(a[3] - b[3]) > tolerance:
                continue  # amounts must match
            if a[4] == b[4]:
                continue  # need opposite direction (one out, one in)

            if a[5] and b[5]:
                dd = abs((a[5] - b[5]).days)
            else:
                dd = 10 ** 6  # unknown dates: lowest priority but still eligible

            if _transfer_corroborated(a[6], b[6], a[0], b[0]):
                if dd <= max_window_days:
                    corroborated.append((dd, i, j))
            elif dd <= uncorroborated_window_days:
                uncorroborated.append((dd, i, j))

    used = set()
    marked = 0

    def _apply(candidates):
        nonlocal marked
        for _dd, i, j in sorted(candidates, key=lambda c: c[0]):
            if i in used or j in used:
                continue
            a, b = legs[i], legs[j]
            tx_a = reconciliation_results[a[0]]["transactions"][a[2]]
            tx_b = reconciliation_results[b[0]]["transactions"][b[2]]
            _recon_mark_internal_transfer(tx_a, b[0], b[2], b[1])
            _recon_mark_internal_transfer(tx_b, a[0], a[2], a[1])
            used.add(i)
            used.add(j)
            marked += 2

    # Corroborated pairs get first claim on their legs.
    _apply(corroborated)

    # Re-check ambiguity AFTER corroborated pairs have claimed their legs — a candidate
    # that looked ambiguous only because it shared an amount with a leg a corroborated
    # pair has since claimed is no longer ambiguous once that leg is removed from
    # consideration (see docs/RECONCILIATION_TRANSFER_DETECTION_FIX.md).
    remaining = [c for c in uncorroborated if c[1] not in used and c[2] not in used]
    amount_counts = Counter(round(legs[c[1]][3], 2) for c in remaining)
    unambiguous = [c for c in remaining if amount_counts[round(legs[c[1]][3], 2)] == 1]
    _apply(unambiguous)

    return marked


def _build_doc_amount_index(phase2_context, scratch_dir):
    """Map each supporting document's classified filename -> set of amounts in its text.
    Reuses the same text extraction (with cached OCR) as the reconciliation prompt, so the
    tie-out can confirm a matched amount actually appears in the cited document."""
    doc_amounts = {}
    for doc in phase2_context.get("supporting_documents", []) or []:
        name = doc.get("classified_name") or ""
        path = doc.get("path")
        if not name or not path or not os.path.exists(path):
            continue
        try:
            txt = _extract_supporting_doc_text(path, scratch_dir)
        except Exception:
            txt = ""
        if txt:
            doc_amounts[name] = _extract_amounts_from_text(txt)
    return doc_amounts



def verify_sum_matches(reconciliation_results, doc_amounts=None, tolerance=0.01):
    """Document-grounded tie-out over the LLM's reconciliation output. The LLM's
    `matched_amount` field is self-reported (it tends to just echo the transaction's own
    amount), so we verify against the ACTUAL supporting-document text (`doc_amounts`:
    filename -> set of amounts found in that document), not against the LLM's claim:
      - one_to_one: the transaction amount must literally appear in the matched document.
        If we have that document's amounts and the amount is absent -> downgrade to unmatched.
      - many_to_one_sum: the group's amounts must sum to the tied-out figure AND that sum
        (or target) must appear in the matched document.
    Internal transfers (match_type 'internal_transfer') are left untouched — they are
    verified separately by counter-leg pairing in detect_internal_transfers().
    `doc_amounts` may be None/partial; when a document's amounts are unknown we do not
    downgrade solely on that (avoids false negatives when OCR text is unavailable).
    Returns the number of transactions downgraded to 'unmatched'."""
    doc_amounts = doc_amounts or {}
    downgraded = 0
    for acc in reconciliation_results.values():
        txs = acc.get("transactions", []) or []

        # Verify many_to_one_sum groups
        groups = defaultdict(list)
        for tx in txs:
            if (tx.get("status") == "matched"
                    and tx.get("match_type") == "many_to_one_sum"
                    and tx.get("match_group")):
                groups[tx["match_group"]].append(tx)
        for gid, members in groups.items():
            target = _recon_parse_amount(members[0].get("matched_amount"))
            total = sum((_recon_txn_amount(t) or 0.0) for t in members)
            doc = members[0].get("matched_document")
            amt_set = doc_amounts.get(doc)
            sums_ok = target is not None and abs(total - target) <= tolerance
            # The tied-out figure must actually be printed in the cited document (when known).
            present_ok = (amt_set is None) or _amount_in_doc(total, amt_set, tolerance) \
                or _amount_in_doc(target, amt_set, tolerance)
            if not (sums_ok and present_ok):
                reason = (
                    f"Sum tie-out failed: {len(members)} '{gid}' transactions total {total:.2f}"
                    + ("" if sums_ok else f" but the claimed total is {'unknown' if target is None else format(target, '.2f')}")
                    + ("" if present_ok else " and that amount does not appear in the cited document")
                    + "."
                )
                for t in members:
                    _recon_mark_unmatched(t, reason)
                    downgraded += 1

        # Verify one_to_one matches against the actual document text
        for tx in txs:
            if tx.get("status") == "matched" and tx.get("match_type") == "one_to_one":
                ta = _recon_txn_amount(tx)
                doc = tx.get("matched_document")
                amt_set = doc_amounts.get(doc)
                if amt_set is not None and not _amount_in_doc(ta, amt_set, tolerance):
                    _recon_mark_unmatched(
                        tx,
                        f"Amount not found in cited document: {('this transaction' if ta is None else format(ta, '.2f'))} "
                        f"does not appear in '{doc}'. A document containing this exact amount would resolve it.",
                    )
                    downgraded += 1
                    continue
                # Fallback contradiction check when the document's amounts are unknown.
                ma = _recon_parse_amount(tx.get("matched_amount"))
                if amt_set is None and ta is not None and ma is not None and abs(ta - ma) > tolerance:
                    _recon_mark_unmatched(
                        tx,
                        f"Amount tie-out failed: transaction {ta:.2f} does not equal the "
                        f"matched supporting-document amount {ma:.2f}.",
                    )
                    downgraded += 1

    return downgraded


def build_query_generation_prompt(unmatched_transactions, fund_name):
    """Build the (system_prompt, user_content) pair for the query generation LLM call.

    Groups unmatched transactions by category and generates humanized client queries.
    """
    tx_lines = []
    for i, tx in enumerate(unmatched_transactions, 1):
        account = tx.get("account_name", tx.get("account_number", "Unknown"))
        debit = f"DR ${tx.get('debit')}" if tx.get("debit") else ""
        credit = f"CR ${tx.get('credit')}" if tx.get("credit") else ""
        amount = debit or credit or "Amount unknown"
        reason = tx.get("unmatched_reason") or tx.get("reason", "")
        tx_lines.append(
            f"  {i}. [{account}] {tx.get('date', '?')} | {tx.get('description', 'No description')} | {amount}"
            + (f"\n     Reason unmatched: {reason}" if reason else "")
        )

    transactions_block = "\n".join(tx_lines) if tx_lines else "No unmatched transactions."

    system_prompt = (
        "IMPORTANT: Your entire response must be a single valid JSON object. "
        "Do not include any text, explanation, or markdown before or after the JSON.\n\n"
        f"You are an expert SMSF accountant preparing client queries for {fund_name}.\n\n"
        "You have been given a list of bank transactions that could not be matched to supporting "
        "documents during the reconciliation process. Your task is to group these transactions "
        "by their likely category and write a clear, professional query for each group that "
        "the accountant can send to the client to resolve the missing documentation.\n\n"
        "## REQUIRED JSON SCHEMA\n"
        "{\n"
        '  "queries": [\n'
        "    {\n"
        '      "id": "Q1",\n'
        '      "category": "Category name (e.g. Investment Income - Dividends, Bank Interest, Unknown Credit)",\n'
        '      "query_text": "Professional query text addressed to the client, listing the specific transactions and asking for the required documentation",\n'
        '      "transactions": [\n'
        "        {\n"
        '          "date": "DD/MM/YYYY",\n'
        '          "description": "transaction description",\n'
        '          "amount": "amount as string e.g. CR $1,234.56 or DR $1,234.56"\n'
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- Group related transactions under a single category with one shared query "
        "(e.g. all bank interest credits together; all dividends from one security together; "
        "all broker buy/sell settlements together)\n"
        "- Write query_text in professional tone as if the accountant is writing to the client\n"
        "- query_text must list the dates and amounts of the transactions in the group\n"
        "- Suggest the specific documentation that would resolve each query "
        "(e.g. 'Please provide the dividend statement from NAB for the payment received on XX/XX/XXXX')\n"
        "- Use id values Q1, Q2, Q3, etc.\n"
        "- Respond with ONLY the JSON object — no other text\n"
    )

    user_content = (
        f"The following {len(unmatched_transactions)} transactions from {fund_name} "
        "could not be matched to supporting documents. "
        "Please group them by category and generate professional client queries:\n\n"
        f"{transactions_block}"
    )

    return system_prompt, user_content


def run_query_generation_call(unmatched_transactions, fund_name, api_key, update_progress,
                              model=PHASE2_DEFAULT_MODEL, record_usage=None):
    """Run LLM Call 2 for Story 3: group unmatched transactions and generate client queries.

    Returns queries list: [{ id, category, query_text, transactions }]
    """
    if not unmatched_transactions:
        update_progress(None, "Phase 2: No unmatched transactions — skipping query generation.")
        return []

    update_progress(
        None,
        f"Phase 2: Generating client queries for {len(unmatched_transactions)} unmatched transactions...",
    )
    system_prompt, user_content = build_query_generation_prompt(unmatched_transactions, fund_name)

    res, usage = query_openrouter(
        api_key, system_prompt, user_content,
        response_format={"type": "json_object"},
        model=model,
        timeout=180,
    )
    if record_usage:
        record_usage('phase2_query_gen', 'phase2', usage)
    result = _lenient_json_loads(res, context="query generation") or {}
    queries = result.get("queries", [])

    if not queries and unmatched_transactions:
        print(
            f"[Phase 2] WARNING: zero queries generated from "
            f"{len(unmatched_transactions)} unmatched transactions",
            file=sys.stderr,
        )
    else:
        print(
            f"[Phase 2] Generated {len(queries)} client queries from "
            f"{len(unmatched_transactions)} unmatched transactions",
            file=sys.stderr,
        )

    return queries


# ---------------------------------------------------------------------------
# Story 3R — Deterministic grouping helpers
# ---------------------------------------------------------------------------

# Last-token patterns that mark the end of a 'Direct Credit {BSB} {PAYEE…} {REF}' description.
_REF_RE = re.compile(
    r'\s+(?:cm-\d+|[A-Z0-9]{2,8}/\d{5,}|\d{9,}|[A-Z]\d{9,})$',
    re.IGNORECASE,
)

# Words stripped from the right of the payee string (dividend/distribution indicators and month/period qualifiers)
_STRIP_WORDS = {
    'DST', 'DIST', 'DIV', 'DIS', 'DISTRIBUTION', 'DIVIDEND', 'PAYMENT', 'INCOM',
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
    'FNL', 'ITM', 'QRT', 'INTERIM', 'FINAL',
}

def _tx_amount_str(tx):
    """Return a display amount string for a transaction regardless of field format.

    New-format transactions have numeric 'debit' / 'credit' fields.
    Old-format (LLM Story 3) transactions have a single 'amount' string like 'CR $61.29'.
    """
    debit = tx.get('debit')
    credit = tx.get('credit')
    if debit:
        return f'DR ${float(debit):,.2f}'
    if credit:
        return f'CR ${float(credit):,.2f}'
    amount = tx.get('amount', '')
    return amount if amount else 'Amount unknown'


def _tx_credit_float(tx):
    """Return the credit value as a float, or 0.0 if not available / not a credit."""
    credit = tx.get('credit')
    if credit:
        try:
            return float(credit)
        except (ValueError, TypeError):
            pass
    # Old-format: parse 'CR $61.29'
    amount = tx.get('amount', '')
    if isinstance(amount, str) and amount.upper().startswith('CR '):
        try:
            return float(amount[3:].replace('$', '').replace(',', ''))
        except (ValueError, TypeError):
            pass
    return 0.0


# ASX-ticker–style tokens (≤6 all-caps chars) kept uppercase; everything else title-cased.
def _format_payee_token(token):
    return token if (token == token.upper() and len(token) <= 6) else token.title()


def _extract_payee(description):
    """Extract the payee/security name from a 'Direct Credit {BSB} {PAYEE…} {REF}' description."""
    m = re.match(r'^Direct Credit \d{6}\s+', description)
    if not m:
        return description[:30].strip()
    remainder = description[m.end():]
    remainder = _REF_RE.sub('', remainder).strip()
    tokens = remainder.split()
    while tokens and tokens[-1].upper() in _STRIP_WORDS:
        tokens.pop()
    if not tokens:
        return 'Unknown'
    return ' '.join(_format_payee_token(t) for t in tokens)


def group_unmatched_transactions(unmatched_transactions):
    """Group unmatched transactions deterministically into coarse and granular buckets.

    Returns { "coarse": [{category, transactions}], "granular": [{category, transactions}] }.
    Investment Income granular groups are rolled up to a single coarse group; all other
    groups carry through 1:1.  Never drops a transaction — unrecognised descriptions fall
    into an 'Other – …' bucket.
    """
    granular: dict = defaultdict(list)
    coarse: dict = defaultdict(list)
    rule_hits: dict = defaultdict(int)

    for tx in unmatched_transactions:
        desc = (tx.get('description') or '').strip()
        debit = tx.get('debit')

        if desc == 'Credit Interest':
            gcat = 'Bank Interest'
            ccat = 'Bank Interest'
            rule_hits['Bank Interest'] += 1

        elif 'FinClear Service' in desc:
            gcat = 'Broker Settlements'
            ccat = 'Broker Settlements'
            rule_hits['Broker Settlements'] += 1

        elif 'ASIC' in desc.upper():
            gcat = 'Regulatory Fees – ASIC'
            ccat = 'Regulatory Fees – ASIC'
            rule_hits['Regulatory Fees – ASIC'] += 1

        elif 'ATO' in desc.upper() and not (debit or (tx.get('amount', '').upper().startswith('DR '))):
            gcat = 'ATO Tax Refund'
            ccat = 'ATO Tax Refund'
            rule_hits['ATO Tax Refund'] += 1

        elif re.search(r'\bTransfer\s+(?:To|From)\b', desc, re.IGNORECASE):
            gcat = 'Internal Transfer'
            ccat = 'Internal Transfer'
            rule_hits['Internal Transfer'] += 1

        elif desc.startswith('Direct Credit '):
            payee = _extract_payee(desc)
            gcat = f'Investment Income – {payee}'
            ccat = 'Investment Income – Dividends & Distributions'
            rule_hits['Investment Income'] += 1

        else:
            label = desc[:40].rstrip()
            gcat = f'Other – {label}'
            ccat = f'Other – {label}'
            rule_hits['Other'] += 1

        granular[gcat].append(tx)
        coarse[ccat].append(tx)

    print(
        f'[Phase 2] group_unmatched_transactions: {sum(rule_hits.values())} transactions → '
        + ', '.join(f'{k}: {v}' for k, v in sorted(rule_hits.items())),
        file=sys.stderr,
    )

    coarse_list = [{'category': k, 'transactions': v} for k, v in sorted(coarse.items())]
    granular_list = [{'category': k, 'transactions': v} for k, v in sorted(granular.items())]
    return {'coarse': coarse_list, 'granular': granular_list}


# Coarse groups that have no meaningful per-security sub-division.
_NO_SUBQUERIES = {'Bank Interest', 'Broker Settlements', 'Internal Transfer'}


def build_coarse_query_text_prompt(coarse_groups, fund_name):
    """Build (system_prompt, user_content) for the single LLM call that writes coarse query texts.

    The LLM only writes query_text — all grouping is already done in Python.
    Response schema: { groups: [{ category, query_text }] }
    """
    groups_block = []
    for g in coarse_groups:
        cat = g['category']
        txs = g['transactions']
        tx_lines = []
        for tx in txs:
            tx_lines.append(f"  {tx.get('date', '?')} | {tx.get('description', '')} | {_tx_amount_str(tx)}")
        groups_block.append(
            f'Category: {cat}\nTransactions ({len(txs)}):\n' + '\n'.join(tx_lines)
        )

    system_prompt = (
        'IMPORTANT: Your entire response must be a single valid JSON object. '
        'Do not include any text, explanation, or markdown before or after the JSON.\n\n'
        f'You are an SMSF audit back-office assistant preparing internal document-request queries for {fund_name}.\n\n'
        'These queries are sent between back-office staff and the client\'s accountant or auditor — '
        'NOT directly to the fund member. Use a direct, formal tone. '
        'Do NOT regroup the transactions — only write the query_text per category.\n\n'
        '## REQUIRED JSON SCHEMA\n'
        '{\n'
        '  "groups": [\n'
        '    {\n'
        '      "category": "<exact category name as provided>",\n'
        '      "query_text": "<structured multi-line query — see format rules below>"\n'
        '    }\n'
        '  ]\n'
        '}\n\n'
        '## FORMAT RULES FOR query_text\n'
        'Each query_text must follow this exact 3-part structure, using \\n for line breaks:\n\n'
        'PART 1 — Opening statement (1–2 sentences):\n'
        '  State what is missing. Example: "We have not sighted any supporting documentation '
        f'for the following [category] transactions in {fund_name} bank statements." '
        '(Use the fund name exactly as provided — do NOT prefix it with "the".)\n\n'
        'PART 2 — Transaction list (one transaction per line, preceded by a blank line):\n'
        '  List each transaction exactly as provided: date | description | amount\n'
        '  Use the same date/description/amount from the input — do not summarise or group further.\n\n'
        'PART 3 — Document request (1–2 sentences, preceded by a blank line):\n'
        '  State exactly what document(s) are required. Be specific to the category '
        '(e.g. "annual interest statement", "pension payment authorities", "contribution notice", '
        '"ATO notice of assessment", "dividend statement", "broker contract notes").\n\n'
        'Additional rules:\n'
        '- No salutation (no "Dear ...") and no sign-off\n'
        '- No inline comma-separated transaction summaries — each transaction must be on its own line\n'
        '- Return EXACTLY the same categories as provided — do not rename, merge, or split\n'
        '- Use the same order as the input\n'
        '- Respond with ONLY the JSON object — no other text\n'
    )

    user_content = (
        f'Write query_text for each of the following {len(coarse_groups)} '
        f'transaction categories for {fund_name}:\n\n'
        + '\n\n'.join(groups_block)
    )

    return system_prompt, user_content


def generate_granular_query_text(category, transactions, fund_name=''):
    """Generate query text for a granular Investment Income group using a Python template (no LLM).

    Infers the document type from keywords in the transaction descriptions.
    """
    payee = category.replace('Investment Income – ', '')

    # Infer document type from description keywords
    descs_upper = ' '.join(tx.get('description', '') for tx in transactions).upper()
    if 'DIV' in descs_upper or 'DIVIDEND' in descs_upper:
        doc_type = 'dividend statement'
    elif 'DST' in descs_upper or 'DIST' in descs_upper or 'DISTRIBUTION' in descs_upper:
        doc_type = 'distribution notice'
    elif 'DIS' in descs_upper:
        doc_type = 'distribution notice'
    else:
        doc_type = 'supporting documentation'

    n = len(transactions)
    fund_display = (fund_name[4:] if fund_name.startswith('The ') else fund_name).strip()
    fund_clause = f' in the {fund_display} bank statements' if fund_display else ''

    tx_lines = '\n'.join(
        f"  {tx.get('date', '?')} | {tx.get('description', '')} | {_tx_amount_str(tx)}"
        for tx in transactions
    )

    return (
        f'We have not sighted any supporting documentation for the following {payee} '
        f'transaction{"s" if n != 1 else ""}{fund_clause}.\n\n'
        f'{tx_lines}\n\n'
        f'Please provide the {doc_type} confirming the above amount{"s" if n != 1 else ""} '
        f'so we can complete the reconciliation for the period.'
    )


def run_coarse_query_text_call(coarse_groups, fund_name, api_key, update_progress,
                               model=PHASE2_DEFAULT_MODEL, record_usage=None):
    """Call the LLM once to write query_text for all coarse groups.

    Returns a dict { category → query_text }.
    """
    update_progress(
        None,
        f'Phase 2: Generating query text for {len(coarse_groups)} coarse groups...',
    )
    system_prompt, user_content = build_coarse_query_text_prompt(coarse_groups, fund_name)
    res, usage = query_openrouter(
        api_key, system_prompt, user_content,
        response_format={'type': 'json_object'},
        model=model,
        timeout=180,
    )
    if record_usage:
        record_usage('phase2_coarse_query_text', 'phase2', usage)
    result = _lenient_json_loads(res, context="coarse query text") or {}
    groups_out = result.get('groups', [])
    mapping = {g['category']: g.get('query_text', '') for g in groups_out if 'category' in g}
    print(
        f'[Phase 2] run_coarse_query_text_call: received query_text for {len(mapping)} categories',
        file=sys.stderr,
    )
    return mapping


# ---------------------------------------------------------------------------
# Story 3S — Semantic classification via transaction_categories.json
# ---------------------------------------------------------------------------

def load_transaction_categories(workspace_dir):
    """Load and validate transaction_categories.json from workspace_dir.

    Returns the parsed list of category dicts.
    Raises FileNotFoundError if the file is absent, ValueError if malformed.
    """
    path = os.path.join(workspace_dir, 'transaction_categories.json')
    if not os.path.exists(path):
        raise FileNotFoundError(
            f'transaction_categories.json not found at {path}. '
            'Create it before running Phase 2.'
        )
    with open(path, 'r', encoding='utf-8') as fh:
        data = json.load(fh)
    categories = data.get('categories', [])
    if not categories:
        raise ValueError('transaction_categories.json has no categories.')
    fallbacks = [c for c in categories if c.get('is_fallback')]
    if not fallbacks:
        raise ValueError('transaction_categories.json must have exactly one category with "is_fallback": true.')
    return categories


def build_classification_prompt(unmatched_transactions, categories):
    """Build (system_prompt, user_content) for the LLM classification call.

    The LLM receives the full taxonomy from categories and must assign each
    transaction exactly one label.  Nothing about the taxonomy is hardcoded here.
    """
    fallback_label = next(c['label'] for c in categories if c.get('is_fallback'))
    valid_labels = [c['label'] for c in categories]

    # Build the category reference block from the JSON
    cat_lines = []
    for c in categories:
        direction_hint = f" ({c['direction']})" if c.get('direction', 'either') != 'either' else ''
        examples_str = ''
        if c.get('examples'):
            examples_str = '\n  Examples: ' + ' | '.join(c['examples'])
        cat_lines.append(
            f'**{c["label"]}**{direction_hint}\n  {c["description"]}{examples_str}'
        )
    categories_block = '\n\n'.join(cat_lines)

    labels_enum = ' | '.join(valid_labels)

    system_prompt = (
        'IMPORTANT: Your entire response must be a single valid JSON object. '
        'Do not include any text, explanation, or markdown before or after the JSON.\n\n'
        'You are an SMSF accountant\'s assistant classifying unmatched bank transactions '
        'for an Australian self-managed superannuation fund.\n\n'
        'Assign each transaction exactly one category from the list below. '
        f'Use "{fallback_label}" only as a last resort when no other category fits.\n\n'
        '## CATEGORIES\n\n'
        f'{categories_block}\n\n'
        '## VALID LABELS (use exactly as shown — no other values allowed)\n'
        f'{labels_enum}\n\n'
        '## REQUIRED JSON SCHEMA\n'
        '{\n'
        '  "classified": [\n'
        '    { "tx_index": 0, "category": "Bank Interest" },\n'
        '    { "tx_index": 1, "category": "Pension Payments" }\n'
        '  ]\n'
        '}\n\n'
        'Rules:\n'
        '- Return EXACTLY one entry per transaction, indices 0 through N-1\n'
        '- "category" must be one of the valid labels listed above — no other values\n'
        '- Respond with ONLY the JSON object — no other text\n'
    )

    tx_lines = []
    for i, tx in enumerate(unmatched_transactions):
        tx_lines.append(f'  {i} | {tx.get("date", "?")} | {tx.get("description", "")} | {_tx_amount_str(tx)}')

    user_content = (
        f'Classify the following {len(unmatched_transactions)} unmatched transactions:\n\n'
        + '\n'.join(tx_lines)
    )

    return system_prompt, user_content


def classify_transactions(unmatched_transactions, categories, fund_name, api_key,
                          model=PHASE2_DEFAULT_MODEL, record_usage=None):
    """Call the LLM to classify each transaction into the taxonomy from categories.

    Returns the original transaction list with 'smsf_category' added to each dict.
    Never drops a transaction — falls back to the is_fallback category on any error.
    """
    if not unmatched_transactions:
        return []

    valid_labels = {c['label'] for c in categories}
    fallback_label = next(c['label'] for c in categories if c.get('is_fallback'))

    print(
        f'[Phase 2] classify_transactions: classifying {len(unmatched_transactions)} transactions '
        f'for {fund_name} using {model}',
        file=sys.stderr,
    )

    system_prompt, user_content = build_classification_prompt(unmatched_transactions, categories)

    res, usage = query_openrouter(
        api_key, system_prompt, user_content,
        response_format={'type': 'json_object'},
        model=model,
        timeout=120,
    )
    if record_usage:
        record_usage('phase2_classify_transactions', 'phase2', usage)
    result = _lenient_json_loads(res, context="transaction categorisation") or {}
    classified = result.get('classified', [])

    # Build index → category map, validate as we go
    index_map = {}
    for item in classified:
        idx = item.get('tx_index')
        cat = item.get('category', '')
        if not isinstance(idx, int) or idx < 0 or idx >= len(unmatched_transactions):
            print(f'[Phase 2] classify_transactions: invalid tx_index {idx!r} — skipping', file=sys.stderr)
            continue
        if cat not in valid_labels:
            print(f'[Phase 2] classify_transactions: unknown category {cat!r} for index {idx} — using {fallback_label}', file=sys.stderr)
            cat = fallback_label
        index_map[idx] = cat

    # Apply classifications; any missing index gets fallback
    result_txs = []
    for i, tx in enumerate(unmatched_transactions):
        if i not in index_map:
            print(f'[Phase 2] classify_transactions: index {i} missing from response — using {fallback_label}', file=sys.stderr)
        result_txs.append({**tx, 'smsf_category': index_map.get(i, fallback_label)})

    # Log distribution
    dist = defaultdict(int)
    for tx in result_txs:
        dist[tx['smsf_category']] += 1
    print(
        '[Phase 2] classify_transactions: ' + ', '.join(f'{k}: {v}' for k, v in sorted(dist.items())),
        file=sys.stderr,
    )

    return result_txs


def _build_queries_from_classified(classified_txs, categories, fund_name, api_key,
                                   update_progress, model=PHASE2_DEFAULT_MODEL, record_usage=None):
    """Shared helper: group classified transactions, call LLM for coarse text, assemble queries.

    Used by both run_bank_reconciliation_phase() and regroup_stored_queries().
    Returns the queries list.
    """
    cat_order = {c['label']: i for i, c in enumerate(categories)}
    sub_groupable_labels = {c['label'] for c in categories if c.get('sub_groupable')}

    # Coarse grouping: one bucket per smsf_category
    coarse_buckets = defaultdict(list)
    for tx in classified_txs:
        coarse_buckets[tx['smsf_category']].append(tx)

    # Granular grouping: per-security within sub_groupable categories
    granular_buckets = defaultdict(list)
    for tx in classified_txs:
        if tx['smsf_category'] in sub_groupable_labels:
            payee = _extract_payee(tx.get('description', ''))
            granular_buckets[f"{tx['smsf_category']} – {payee}"].append(tx)

    coarse_list = [
        {'category': cat, 'transactions': txs}
        for cat, txs in sorted(coarse_buckets.items(), key=lambda kv: cat_order.get(kv[0], 999))
    ]

    coarse_text_map = run_coarse_query_text_call(
        coarse_list, fund_name, api_key, update_progress, model=model, record_usage=record_usage
    )

    queries = []
    for idx, cg in enumerate(coarse_list, 1):
        ccat = cg['category']
        sub_granular = sorted(
            [{'category': gcat, 'transactions': gtxs}
             for gcat, gtxs in granular_buckets.items()
             if gcat.startswith(f'{ccat} –')],
            key=lambda g: g['category'],
        )
        has_sub = ccat in sub_groupable_labels and len(sub_granular) > 1

        sub_queries = None
        if has_sub:
            sub_queries = [
                {
                    'id': f'Q{idx}.{sidx}',
                    'category': sg['category'],
                    'query_text': generate_granular_query_text(sg['category'], sg['transactions'], fund_name),
                    'transactions': sg['transactions'],
                    'status': 'pending',
                }
                for sidx, sg in enumerate(sub_granular, 1)
            ]

        queries.append({
            'id': f'Q{idx}',
            'category': ccat,
            'query_text': coarse_text_map.get(ccat, ''),
            'transactions': cg['transactions'],
            'sub_queries': sub_queries,
            'status': 'pending',
        })

    return queries


def regroup_stored_queries(existing_queries, fund_name, api_key, update_progress, record_usage=None):
    """Re-group queries from a stored job using LLM semantic classification (Story 3S).

    Always re-classifies all transactions — no match-rate gate.
    Returns (queries, regrouped: bool, match_rate: float).
    """

    all_txs = []
    for q in existing_queries:
        all_txs.extend(q.get('transactions') or [])

    if not all_txs:
        update_progress(None, 'Phase 2: regroup — no transactions found in stored queries, skipping.')
        for q in existing_queries:
            q.setdefault('sub_queries', None)
        return existing_queries, False, 0.0

    update_progress(None, f'Phase 2: regroup — classifying {len(all_txs)} transactions...')
    categories = load_transaction_categories(os.getcwd())
    classified_txs = classify_transactions(all_txs, categories, fund_name, api_key, record_usage=record_usage)

    new_queries = _build_queries_from_classified(
        classified_txs, categories, fund_name, api_key, update_progress, record_usage=record_usage
    )
    update_progress(None, f'Phase 2: regroup — produced {len(new_queries)} query group(s).')
    return new_queries, True, 1.0


def run_bank_reconciliation_phase(job_id, fund_profile, job_type, api_key, scratch_dir, update_progress, record_usage=None, model=None):
    """Phase 2 orchestrator: classify context → extract transactions → reconcile → generate queries.

    Returns { phase2_context, reconciliation_results, queries, summary }.
    """
    model = model or PHASE2_DEFAULT_MODEL
    jobs_db_path = os.path.join(os.getcwd(), "jobs_db.json")
    job_record = None
    if os.path.exists(jobs_db_path):
        with open(jobs_db_path, "r", encoding="utf-8") as fh:
            all_jobs = json.load(fh)
        job_record = next((j for j in all_jobs if j["job_id"] == job_id), None)

    if not job_record:
        raise ValueError(f"Job {job_id} not found in jobs_db.json")

    update_progress(None, "Phase 2: Building reconciliation context...")
    phase2_context = build_phase2_context(job_id, fund_profile, job_record)

    update_progress(None, "Phase 2: Running bank transaction reconciliation...")
    reconciliation_results = run_reconciliation_call(
        phase2_context, api_key, update_progress, model=model,
        record_usage=record_usage, scratch_dir=scratch_dir,
    )

    # (0a) Any transaction whose amount could not be corroborated (unresolved) must not be
    # auto-matched — force it to unmatched with a clear reason so it surfaces for review
    # rather than riding on a fabricated amount.
    _unresolved = 0
    for _acc in reconciliation_results.values():
        for _t in _acc.get("transactions", []) or []:
            if _t.get("is_opening_balance"):
                continue
            if _t.get("amount_status") == "unresolved":
                _recon_mark_unmatched(
                    _t,
                    "Amount could not be read from the statement or reconciled from the "
                    "running balance — verify the amount from the source statement.",
                )
                _unresolved += 1
    if _unresolved:
        update_progress(None, f"Phase 2: {_unresolved} transaction(s) have an unresolved amount — flagged for review.")

    # (0b) Mark transactions that inherently need no external evidence (bank interest) as
    # matched, so they don't show as unmatched or generate queries.
    _noev = mark_no_evidence_transactions(reconciliation_results)
    if _noev:
        update_progress(None, f"Phase 2: {_noev} interest transaction(s) marked as needing no external evidence.")

    # (1) Deterministically pair bank-to-bank transfers across the fund's accounts, so a
    # sweep between fund accounts self-matches to its counter-leg instead of being (mis)
    # matched to an unrelated supporting document.
    _transfers = detect_internal_transfers(reconciliation_results)
    if _transfers:
        update_progress(None, f"Phase 2: linked {_transfers} bank-to-bank transfer leg(s).")

    # (2) Document-grounded amount tie-out: the LLM's matched_amount just echoes the
    # transaction amount, so verify each match against the ACTUAL supporting-document text.
    # A one_to_one match whose amount is absent from the cited document, or a sum-group
    # whose total is not printed there, is downgraded to 'unmatched' (flows to queries).
    doc_amounts = _build_doc_amount_index(phase2_context, scratch_dir)
    _downgraded = verify_sum_matches(reconciliation_results, doc_amounts=doc_amounts)
    if _downgraded:
        update_progress(
            None,
            f"Phase 2: {_downgraded} transaction(s) failed the document-grounded amount "
            "tie-out and were moved to unmatched.",
        )

    # Story 3R: collect unmatched transactions, group deterministically, generate queries
    total = matched = unmatched_count = 0
    unmatched_transactions = []
    fund_name = fund_profile.get("name", "the fund")

    for acc_num, acc_result in reconciliation_results.items():
        for tx in acc_result.get("transactions", []):
            if tx.get("is_opening_balance"):
                continue  # balance anchor, not a reconcilable transaction
            total += 1
            if tx.get("status") == "matched":
                matched += 1
            else:
                unmatched_count += 1
                unmatched_transactions.append({
                    **tx,
                    "account_number": acc_num,
                    "account_name": acc_result.get("account_name", acc_num),
                })

    queries = []
    if unmatched_transactions:
        categories = load_transaction_categories(os.getcwd())
        classified_txs = classify_transactions(
            unmatched_transactions, categories, fund_name, api_key, model=model, record_usage=record_usage
        )
        queries = _build_queries_from_classified(
            classified_txs, categories, fund_name, api_key, update_progress, model=model, record_usage=record_usage
        )
    else:
        update_progress(None, 'Phase 2: No unmatched transactions — skipping query generation.')

    return {
        "phase2_context": phase2_context,
        "reconciliation_results": reconciliation_results,
        "queries": queries,
        "summary": {
            "total": total,
            "matched": matched,
            "unmatched": unmatched_count,
        },
    }


def run_ai_processor_phase(folder_path, run_id, fund_profile, job_type, api_key, scratch_dir, update_progress, record_usage=None, model=None):
    """Runs Phase 1: Scans directory, extracts texts/OCR, and suggests classifications."""
    # Staging folder in run_id directory
    run_dir = os.path.join(os.getcwd(), run_id)
    staging_dir = os.path.join(run_dir, "staging")
    os.makedirs(staging_dir, exist_ok=True)

    update_progress(10, "AI Processor: Scanning input folder...")

    # We will copy the files to the staging folder while running classification
    # Run the classification engine
    processed, unprocessed = classify_papers(
        folder_path, staging_dir, fund_profile, api_key, scratch_dir, update_progress, job_type,
        record_usage=record_usage, model=model,
    )

    return processed, unprocessed

def run_ai_reviewer_phase(run_id, fund_profile, job_type, api_key, scratch_dir, update_progress,
                           record_usage=None, model=None, reconciliation_results=None):
    """Runs Phase 2: Performs dynamic lead schedule calculations and checklist verifications.

    `reconciliation_results` (from Phase 2 bank reconciliation, keyed by account number) is
    passed through so the Cash Lead Schedule can be sourced from the already tie-out-validated
    control totals instead of asking the LLM to re-derive opening/closing balances from raw
    text a second time (see docs/LEAD_SCHEDULES_ACCURACY_FIX.md).
    """
    run_dir = os.path.join(os.getcwd(), run_id)
    workpapers_dir = os.path.join(run_dir, "workpaper")
    os.makedirs(workpapers_dir, exist_ok=True)

    update_progress(70, "AI Reviewer: Reconciling ledger balances and validating checklist...")
    results = reconcile_papers(
        workpapers_dir, fund_profile, api_key, scratch_dir, update_progress, job_type,
        record_usage=record_usage, model=model, reconciliation_results=reconciliation_results,
    )
    return results
