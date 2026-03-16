#!/usr/bin/env python3
"""
bb_ai_scope_scanner.py  —  v2.0  (multi-platform)
─────────────────────────────────────────────────────────────────────────────
Scans bug bounty programs across HackerOne, Bugcrowd, YesWeHack, and Intigriti
for AI/LLM/chatbot scope entries, then outputs a CSV + ASCII trend chart.

╔══════════════════════════════════════════════════════════════════════╗
║  PLATFORM   AUTH METHOD              ENV VARS NEEDED                ║
║  ─────────  ──────────────────────   ─────────────────────────────  ║
║  HackerOne  HTTP Basic Auth          H1_USERNAME, H1_TOKEN          ║
║  Bugcrowd   Token header             BC_USERNAME, BC_TOKEN          ║
║  YesWeHack  JWT (email/pass login)   YWH_EMAIL, YWH_PASSWORD        ║
║             OR pre-obtained Bearer   YWH_TOKEN  (skips login)       ║
║  Intigriti  Bearer PAT               INTI_TOKEN                     ║
╚══════════════════════════════════════════════════════════════════════╝

Credentials are optional per-platform — platforms with missing creds
are skipped with a warning, so you can run any subset.

Credential setup:
  HackerOne : https://docs.hackerone.com/en/articles/8410331-api-token
  Bugcrowd  : Log in → top-right avatar → API Credentials
  YesWeHack : Use your YWH account email/password, OR intercept a request
              to api.yeswehack.com and grab the Authorization: Bearer XXX
              header value, then set it as YWH_TOKEN
  Intigriti : https://app.intigriti.com/researcher/personal-access-tokens

Usage:
    H1_USERNAME=x H1_TOKEN=y BC_USERNAME=a BC_TOKEN=b \\
    YWH_EMAIL=x YWH_PASSWORD=y INTI_TOKEN=z \\
    python3 bb_ai_scope_scanner.py

    python3 bb_ai_scope_scanner.py --max-pages 3 --platforms h1,ywh
    python3 bb_ai_scope_scanner.py --h1-handle shopify
    python3 bb_ai_scope_scanner.py --output results.csv --verbose
    python3 bb_ai_scope_scanner.py --creds-file creds.txt
"""

import os
import re
import csv
import sys
import time
import logging
import pathlib
import argparse
from abc import ABC, abstractmethod
from collections import defaultdict
from datetime import datetime
from typing import Optional

import requests
from requests.auth import HTTPBasicAuth

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("bb_ai_scanner")

# ─── AI / LLM Keyword Patterns ───────────────────────────────────────────────

AI_KEYWORDS = [
    r"AI[/\s]?ML\s+Features?",
    r"\bAI\s+Features?\b",
    r"\bML\s+Features?\b",
    r"\bAI\s+Scope\b",
    r"AI[-\s]?Powered",
    r"\bGenAI\b",
    r"Generative\s+AI",
    r"\bchatbot\b",
    r"\bcopilot\b",
    r"AI\s+Assistant",
    r"AI\s+Agent",
    r"\bLLM\b",
    r"\bChatGPT\b",
    r"\bOpenAI\b",
    r"GPT[-\s]?[34o]+",
    r"prompt\s+injection",
    r"\bClaude\s+AI\b",
    r"\bGemini\s+(AI|Pro|Ultra)\b",
    r"\bBard\s+AI\b",
    r"\bAnthropic\b",
    r"\bLlama\s*[23]?\b",
    r"\bMistral\s*(AI)?\b",
    r"\bRAG\b",
    r"vector\s+database",
    r"embedding\s+model",
    r"semantic\s+search",
    r"AI[-\s]?powered\s+(search|feature|assistant|tool)",
    r"machine\s+learning\s+(model|feature|endpoint)",
    r"\bDeepSeek\b",
    r"\bPerplexity\s+AI\b",
    r"\bCopilot\s+(AI|feature|endpoint)\b",
]

AI_DOMAIN_RE = re.compile(r"\.ai\b", re.IGNORECASE)

FALSE_POSITIVE_PHRASES = [
    r"AI[- ]generated\s+report",
    r"AI\s+slop",
    r"don'?t\s+(use|leak|submit|send).{0,30}(AI|ChatGPT|LLM|GPT)",
    r"(using|use\s+of)\s+AI\s+to\s+(generate|write|create)",
    r"hallucinated",
    r"no\s+AI[- ]generated",
    r"automated\s+(reports?|submissions?)",
    r"AI[- ]assisted\s+report",
    r"do\s+not\s+use\s+AI",
    r"avoid\s+(using\s+)?AI",
    r"prohibit.{0,20}AI",
    r"banned?\s+AI",
    r"report\s+quality",
    r"AI[- ]written",
    r"low[- ]quality\s+AI",
    r"spam.{0,20}AI",
]

KEYWORD_RE = re.compile(
    "|".join(f"(?:{kw})" for kw in AI_KEYWORDS),
    re.IGNORECASE,
)
FALSE_POS_RE = re.compile(
    "|".join(f"(?:{fp})" for fp in FALSE_POSITIVE_PHRASES),
    re.IGNORECASE,
)

# ─── Helpers ─────────────────────────────────────────────────────────────────

def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text or "")

def is_false_positive(text: str, match: re.Match) -> bool:
    start = max(0, match.start() - 200)
    end = min(len(text), match.end() + 200)
    return bool(FALSE_POS_RE.search(text[start:end]))

def find_ai_keywords(text: str) -> list:
    matched, seen = [], set()
    for m in KEYWORD_RE.finditer(text):
        if not is_false_positive(text, m):
            kw = m.group(0).strip()
            low = kw.lower()
            if low not in seen:
                seen.add(low)
                matched.append(kw)
    return matched

def has_ai_domain(identifier: str) -> bool:
    return bool(AI_DOMAIN_RE.search(identifier))

def iso_to_month(date_str: Optional[str]) -> str:
    if not date_str:
        return "Unknown"
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m")
    except (ValueError, AttributeError):
        return "Unknown"

def make_finding(platform, program_name, handle, date, kws, where,
                 eligible=None, identifier="") -> dict:
    return {
        "platform": platform,
        "program_name": program_name,
        "handle": handle,
        "date_introduced": date or "Unknown",
        "keyword_matched": "; ".join(kws),
        "where": where,
        "eligible_for_bounty": eligible if eligible is not None else "",
        "scope_identifier": identifier,
    }

# ─── Base Platform Client ─────────────────────────────────────────────────────

class PlatformScanner(ABC):
    RATE_DELAY = 1.0
    MAX_RETRIES = 3
    RETRY_BACKOFF = 5

    def __init__(self):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "bb-ai-scope-scanner/2.0 (security research)"
        self._configure()

    @abstractmethod
    def _configure(self): ...

    @property
    @abstractmethod
    def platform_name(self) -> str: ...

    @abstractmethod
    def is_available(self) -> bool: ...

    @abstractmethod
    def scan_all(self, max_pages: int = 0) -> list: ...

    def _get(self, url: str, params: dict = None, headers: dict = None):
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                resp = self.session.get(url, params=params, headers=headers, timeout=20)
                if resp.status_code == 429:
                    wait = int(resp.headers.get("Retry-After", self.RETRY_BACKOFF * attempt))
                    log.warning("[%s] Rate limited — waiting %ds…", self.platform_name, wait)
                    time.sleep(wait)
                    continue
                if resp.status_code == 401:
                    log.error("[%s] Auth failed for %s", self.platform_name, url)
                    return None
                if resp.status_code == 404:
                    return {}
                if not resp.ok:
                    log.warning("[%s] HTTP %d — %s", self.platform_name, resp.status_code, url)
                    return None
                return resp.json()
            except requests.RequestException as exc:
                log.warning("[%s] Request error (attempt %d/%d): %s",
                            self.platform_name, attempt, self.MAX_RETRIES, exc)
                if attempt < self.MAX_RETRIES:
                    time.sleep(self.RETRY_BACKOFF * attempt)
        return None


# ─── HackerOne ────────────────────────────────────────────────────────────────

class HackerOneScanner(PlatformScanner):
    """
    Official Hacker API v1 — https://api.hackerone.com/v1/hackers/
    Auth: HTTP Basic (username + API token)
    Rate limit: ~100 req/min
    """
    RATE_DELAY = 1.2
    BASE = "https://api.hackerone.com/v1"

    def _configure(self):
        self._username = os.environ.get("H1_USERNAME")
        self._token = os.environ.get("H1_TOKEN")
        if self._username and self._token:
            self.session.auth = HTTPBasicAuth(self._username, self._token)

    @property
    def platform_name(self): return "HackerOne"

    def is_available(self):
        return bool(self._username and self._token)

    def scan_all(self, max_pages=0) -> list:
        findings, page, total = [], 1, 0
        while True:
            data = self._get(f"{self.BASE}/hackers/programs",
                             params={"page[number]": page, "page[size]": 100})
            programs = (data or {}).get("data", [])
            if not programs:
                break
            for prog in programs:
                attrs = prog.get("attributes", {})
                handle = attrs.get("handle", "")
                name = attrs.get("name", handle)
                if not handle:
                    continue
                log.info("[H1] [%d] %s (%s)", total + 1, name, handle)
                findings.extend(self._scan_program(handle, name))
                total += 1
            links = (data or {}).get("links", {})
            if not links.get("next"):
                break
            if max_pages and page >= max_pages:
                break
            page += 1
            time.sleep(self.RATE_DELAY)
        log.info("[H1] Scanned %d programs.", total)
        return findings

    def scan_single(self, handle: str) -> list:
        return self._scan_program(handle, handle)

    def _scan_program(self, handle: str, name: str) -> list:
        findings = []
        # Policy text
        time.sleep(self.RATE_DELAY)
        prog_data = self._get(f"{self.BASE}/hackers/programs/{handle}") or {}
        attrs = (prog_data.get("data") or {}).get("attributes", {})
        policy = strip_html(attrs.get("policy") or attrs.get("policy_html") or "")
        if policy:
            kws = find_ai_keywords(policy)
            if kws:
                findings.append(make_finding(
                    "HackerOne", name, handle, "Unknown", kws, "Policy"))

        # Structured scopes
        time.sleep(self.RATE_DELAY)
        scopes_data = self._get(
            f"{self.BASE}/hackers/programs/{handle}/structured_scopes") or {}
        for item in scopes_data.get("data", []):
            a = item.get("attributes", {})
            ident = a.get("asset_identifier", "") or ""
            instr = a.get("instruction") or ""
            atype = a.get("asset_type", "")
            created = a.get("created_at")
            eligible = a.get("eligible_for_bounty", True)
            text = f"{ident} {instr}"
            kws = find_ai_keywords(text)
            if not kws and has_ai_domain(ident):
                kws = [f".ai domain ({ident})"]
            if kws:
                findings.append(make_finding(
                    "HackerOne", name, handle, created, kws,
                    f"Scope ({atype})", eligible, ident))
        return findings


# ─── Bugcrowd ─────────────────────────────────────────────────────────────────

class BugcrowdScanner(PlatformScanner):
    """
    Bugcrowd Platform API (JSON:API spec) — https://api.bugcrowd.com
    Auth: Token header  →  Authorization: Token <username>:<token>
    Get token: Log in → avatar top-right → API Credentials
    Rate limit: 60 req/min per IP
    Docs: https://docs.bugcrowd.com/api/getting-started/
    """
    RATE_DELAY = 1.1
    BASE = "https://api.bugcrowd.com"

    def _configure(self):
        self._username = os.environ.get("BC_USERNAME")
        self._token = os.environ.get("BC_TOKEN")
        if self._username and self._token:
            self.session.headers.update({
                "Authorization": f"Token {self._username}:{self._token}",
                "Accept": "application/vnd.bugcrowd+json",
            })

    @property
    def platform_name(self): return "Bugcrowd"

    def is_available(self):
        return bool(self._username and self._token)

    def scan_all(self, max_pages=0) -> list:
        findings, offset, total = [], 0, 0
        per_page = 25
        while True:
            params = {
                "page[limit]": per_page,
                "page[offset]": offset,
                "include": "current_brief.target_groups.targets",
                "fields[program]": "code,name,current_brief",
                "fields[program_brief]": "target_groups",
                "fields[target_group]": "name,targets",
                "fields[target]": "name,uri,category,eligible_for_submission,created_at",
            }
            data = self._get(f"{self.BASE}/programs", params=params) or {}
            programs = data.get("data", [])
            included_map = self._build_included_map(data.get("included", []))

            if not programs:
                break

            for prog in programs:
                prog_attrs = prog.get("attributes", {})
                handle = prog_attrs.get("code", "") or prog.get("id", "")
                name = prog_attrs.get("name", handle)
                log.info("[BC] [%d] %s", total + 1, name)
                findings.extend(
                    self._scan_program_data(prog, included_map, handle, name))
                total += 1

            links = data.get("links", {})
            if not links.get("next"):
                break
            if max_pages and (offset // per_page) + 1 >= max_pages:
                break
            offset += per_page
            time.sleep(self.RATE_DELAY)

        log.info("[BC] Scanned %d programs.", total)
        return findings

    def _build_included_map(self, included: list) -> dict:
        m = {}
        for item in included:
            key = (item.get("type"), item.get("id"))
            m[key] = item
        return m

    def _scan_program_data(self, prog: dict, included: dict,
                            handle: str, name: str) -> list:
        findings = []
        brief_rel = (prog.get("relationships") or {}).get("current_brief", {})
        brief_ref = (brief_rel.get("data") or {})
        brief = included.get(("program_brief", brief_ref.get("id")), {})
        tg_refs = (brief.get("relationships") or {}).get(
            "target_groups", {}).get("data", [])

        for tg_ref in tg_refs:
            tg = included.get(("target_group", tg_ref.get("id")), {})
            target_refs = (tg.get("relationships") or {}).get(
                "targets", {}).get("data", [])
            for t_ref in target_refs:
                target = included.get(("target", t_ref.get("id")), {})
                ta = target.get("attributes", {})
                uri = ta.get("uri") or ta.get("name") or ""
                cat = ta.get("category", "")
                created = ta.get("created_at")
                eligible = ta.get("eligible_for_submission", True)
                kws = find_ai_keywords(uri)
                if not kws and has_ai_domain(uri):
                    kws = [f".ai domain ({uri})"]
                if kws:
                    findings.append(make_finding(
                        "Bugcrowd", name, handle, created, kws,
                        f"Scope ({cat})", eligible, uri))

        # Fetch policy/overview text for this program
        time.sleep(self.RATE_DELAY)
        prog_data = self._get(
            f"{self.BASE}/programs/{handle}",
            params={"include": "current_brief",
                    "fields[program_brief]": "overview,in_scope,out_of_scope"},
        ) or {}
        brief_attrs = {}
        for inc in prog_data.get("included", []):
            if inc.get("type") == "program_brief":
                brief_attrs = inc.get("attributes", {})
                break
        policy_text = " ".join(str(v) for v in brief_attrs.values() if isinstance(v, str))
        policy_text = strip_html(policy_text)
        if policy_text:
            kws = find_ai_keywords(policy_text)
            if kws:
                findings.append(make_finding(
                    "Bugcrowd", name, handle, "Unknown", kws, "Policy"))
        return findings


# ─── YesWeHack ────────────────────────────────────────────────────────────────

class YesWeHackScanner(PlatformScanner):
    """
    YesWeHack API — https://api.yeswehack.com
    Auth: Bearer JWT obtained via POST /user/login, or set YWH_TOKEN directly.
    Public programs are accessible without auth.
    Docs: https://api.yeswehack.com/doc  (OpenAPI spec)
    Endpoints used:
      GET /programs?page=N            — paginated program list
      GET /programs/{slug}            — program detail + scopes
    """
    RATE_DELAY = 1.0
    BASE = "https://api.yeswehack.com"

    def _configure(self):
        self._email = os.environ.get("YWH_EMAIL")
        self._password = os.environ.get("YWH_PASSWORD")
        self._token = os.environ.get("YWH_TOKEN")

    @property
    def platform_name(self): return "YesWeHack"

    def is_available(self):
        # Public programs work without any creds; still useful
        return True

    def _ensure_token(self):
        if self._token:
            self.session.headers["Authorization"] = f"Bearer {self._token}"
            return True
        if self._email and self._password:
            log.info("[YWH] Logging in as %s…", self._email)
            try:
                resp = self.session.post(
                    f"{self.BASE}/user/login",
                    json={"email": self._email, "password": self._password},
                    timeout=15,
                )
                if resp.status_code == 200:
                    token = resp.json().get("token")
                    if token:
                        self._token = token
                        self.session.headers["Authorization"] = f"Bearer {token}"
                        log.info("[YWH] Login successful.")
                        return True
                log.warning("[YWH] Login failed (HTTP %d) — using public/unauthenticated mode.",
                            resp.status_code)
            except requests.RequestException as exc:
                log.warning("[YWH] Login error: %s — using public mode.", exc)
        else:
            log.info("[YWH] No credentials provided — scanning public programs only.")
        return False

    def scan_all(self, max_pages=0) -> list:
        self._ensure_token()
        findings, page, total = [], 1, 0

        while True:
            data = self._get(f"{self.BASE}/programs",
                             params={"page": page, "nb_elements_per_page": 50}) or {}
            programs = data.get("items", [])
            if not programs:
                break

            for prog in programs:
                slug = prog.get("slug", "")
                name = prog.get("title", slug)
                log.info("[YWH] [%d] %s (%s)", total + 1, name, slug)
                findings.extend(self._scan_program(slug, name))
                total += 1

            pagination = data.get("pagination", {})
            nb_pages = pagination.get("nb_pages", 1)
            if page >= nb_pages:
                break
            if max_pages and page >= max_pages:
                break
            page += 1
            time.sleep(self.RATE_DELAY)

        log.info("[YWH] Scanned %d programs.", total)
        return findings

    def _scan_program(self, slug: str, name: str) -> list:
        findings = []
        time.sleep(self.RATE_DELAY)
        data = self._get(f"{self.BASE}/programs/{slug}") or {}

        # Policy / guideline fields
        for field in ("guidelines", "out_of_scope", "description"):
            text = strip_html(data.get(field) or "")
            if text:
                kws = find_ai_keywords(text)
                if kws:
                    findings.append(make_finding(
                        "YesWeHack", name, slug, "Unknown", kws,
                        f"Policy ({field})"))

        # Scope items — YWH nests entries inside scope_type buckets
        for scope_bucket in data.get("scopes", []):
            scope_type = scope_bucket.get("scope_type", "")
            for entry in scope_bucket.get("scope", []):
                ident = entry.get("scope", "") or ""
                desc = entry.get("description", "") or ""
                # YWH doesn't expose per-scope-item created_at;
                # fall back to program updated_at as best approximation
                updated = data.get("updated_at") or data.get("created_at")
                eligible = not entry.get("out_of_scope", False)
                text = f"{ident} {desc}"
                kws = find_ai_keywords(text)
                if not kws and has_ai_domain(ident):
                    kws = [f".ai domain ({ident})"]
                if kws:
                    findings.append(make_finding(
                        "YesWeHack", name, slug, updated, kws,
                        f"Scope ({scope_type})", eligible, ident))

        return findings


# ─── Intigriti ────────────────────────────────────────────────────────────────

class IntigritiScanner(PlatformScanner):
    """
    Intigriti Researcher API v1 (beta) — https://api.intigriti.com/external/researcher/v1
    Auth: Bearer personal access token
    Get token: https://app.intigriti.com/researcher/personal-access-tokens
    Rate limit: 600 read req/min
    Swagger: https://api.intigriti.com/external/researcher/swagger/index.html
    Endpoints used:
      GET /programs                       — paginated program list
      GET /programs/{companyHandle}/{handle}  — program detail with domains/scopes
    """
    RATE_DELAY = 0.5
    BASE = "https://api.intigriti.com/external/researcher/v1"

    def _configure(self):
        self._token = os.environ.get("INTI_TOKEN")
        if self._token:
            self.session.headers["Authorization"] = f"Bearer {self._token}"

    @property
    def platform_name(self): return "Intigriti"

    def is_available(self):
        return bool(self._token)

    def scan_all(self, max_pages=0) -> list:
        findings, page, total = [], 1, 0

        while True:
            data = self._get(f"{self.BASE}/programs",
                             params={"pageNumber": page, "pageSize": 50}) or {}

            # API may return list directly or wrapped in a records/data key
            if isinstance(data, list):
                programs = data
                max_page = 1
            else:
                programs = data.get("records", data.get("data", []))
                max_page = data.get("maxPageNumber", data.get("totalPages", 1))

            if not programs:
                break

            for prog in programs:
                prog_id = prog.get("id", "")
                handle = prog.get("handle", prog_id)
                name = prog.get("name", handle)
                company = prog.get("companyHandle", "")
                log.info("[INTI] [%d] %s (%s/%s)", total + 1, name, company, handle)
                findings.extend(self._scan_program(company, handle, name))
                total += 1

            if page >= max_page:
                break
            if max_pages and page >= max_pages:
                break
            page += 1
            time.sleep(self.RATE_DELAY)

        log.info("[INTI] Scanned %d programs.", total)
        return findings

    def _scan_program(self, company: str, handle: str, name: str) -> list:
        findings = []
        time.sleep(self.RATE_DELAY)

        if company:
            path = f"{self.BASE}/programs/{company}/{handle}"
        else:
            path = f"{self.BASE}/programs/{handle}"
        data = self._get(path) or {}

        # Policy text fields
        for field in ("description", "outOfScope", "inScopeDescription"):
            text = strip_html(data.get(field) or "")
            if text:
                kws = find_ai_keywords(text)
                if kws:
                    findings.append(make_finding(
                        "Intigriti", name, handle, "Unknown", kws,
                        f"Policy ({field})"))

        # In-scope domain/endpoint items
        domains = data.get("domains", {})
        in_scope = (domains.get("inScope", [])
                    if isinstance(domains, dict) else [])

        for item in in_scope:
            ident = item.get("endpoint", item.get("domain", "")) or ""
            desc = item.get("description", "") or ""
            itype_raw = item.get("type", {})
            itype = (itype_raw.get("value", "")
                     if isinstance(itype_raw, dict) else str(itype_raw))
            created = item.get("createdAt") or item.get("addedAt")
            bounty_eligible = item.get("bounty", True)

            text = f"{ident} {desc}"
            kws = find_ai_keywords(text)
            if not kws and has_ai_domain(ident):
                kws = [f".ai domain ({ident})"]
            if kws:
                findings.append(make_finding(
                    "Intigriti", name, handle, created, kws,
                    f"Scope ({itype})", bounty_eligible, ident))

        return findings


# ─── Output ──────────────────────────────────────────────────────────────────

def write_csv(findings: list, output_path: str):
    fieldnames = [
        "Platform", "Program Name", "Handle",
        "Date AI Was Introduced", "Keyword Matched",
        "Where", "Eligible For Bounty", "Scope Identifier",
    ]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in findings:
            writer.writerow({
                "Platform": row["platform"],
                "Program Name": row["program_name"],
                "Handle": row["handle"],
                "Date AI Was Introduced": row["date_introduced"],
                "Keyword Matched": row["keyword_matched"],
                "Where": row["where"],
                "Eligible For Bounty": row.get("eligible_for_bounty", ""),
                "Scope Identifier": row.get("scope_identifier", ""),
            })
    log.info("CSV written → %s  (%d rows)", output_path, len(findings))


def print_trend_chart(findings: list):
    """ASCII bar chart: AI scope additions by month, colour-coded by platform."""
    PLATFORM_CHARS = {
        "HackerOne": "█",
        "Bugcrowd":  "▓",
        "YesWeHack": "▒",
        "Intigriti": "░",
    }

    monthly: dict = defaultdict(lambda: defaultdict(set))
    for f in findings:
        date = f["date_introduced"]
        if date and date != "Unknown":
            month = iso_to_month(date)
            if month != "Unknown":
                monthly[month][f["platform"]].add(f["program_name"])

    if not monthly:
        print("\n[No dated scope entries — only policy-text matches found (no timestamps).]\n")
        return

    sorted_months = sorted(monthly.keys())
    totals = {m: sum(len(v) for v in platforms.values())
              for m, platforms in monthly.items()}
    max_count = max(totals.values()) if totals else 1
    bar_max = 38

    print("\n" + "═" * 72)
    print("  AI/LLM IN-SCOPE TREND — New programs by month")
    legend = "  " + "  ".join(f"{ch}={p}" for p, ch in PLATFORM_CHARS.items())
    print(legend)
    print("═" * 72)

    for month in sorted_months:
        platforms = monthly[month]
        total = totals[month]
        bar_parts = []
        for platform, char in PLATFORM_CHARS.items():
            count = len(platforms.get(platform, set()))
            seg = max(0, round((count / max_count) * bar_max)) if max_count else 0
            bar_parts.append(char * seg)
        bar = "".join(bar_parts)[:bar_max].ljust(bar_max)
        print(f"  {month}  {bar}  {total:>3} program{'s' if total != 1 else ''}")
        for platform, progs in sorted(platforms.items()):
            names = sorted(progs)
            display = names[:3]
            suffix = f" +{len(names) - 3} more" if len(names) > 3 else ""
            print(f"           [{platform[:4]}] {', '.join(display)}{suffix}")

    print("═" * 72 + "\n")


def print_summary(findings: list):
    from collections import Counter

    programs_by_platform: dict = defaultdict(set)
    for f in findings:
        programs_by_platform[f["platform"]].add(f["handle"])

    all_kws = []
    for f in findings:
        all_kws.extend(k.strip().lower() for k in f["keyword_matched"].split(";"))
    kw_counts = Counter(all_kws)

    scope_f  = [f for f in findings if "Policy" not in f["where"]]
    policy_f = [f for f in findings if "Policy" in f["where"]]

    print("─" * 72)
    print("  SCAN SUMMARY")
    print("─" * 72)
    for platform, handles in sorted(programs_by_platform.items()):
        print(f"  {platform:<14} {len(handles):>4} programs with AI signals")
    total_progs = len({(f["platform"], f["handle"]) for f in findings})
    print(f"  {'TOTAL':<14} {total_progs:>4} unique programs  |  {len(findings)} rows")
    print(f"    → Scope item matches  : {len(scope_f)}")
    print(f"    → Policy text matches : {len(policy_f)}")
    print(f"\n  Top matched keywords (all platforms):")
    for kw, count in kw_counts.most_common(12):
        print(f"    {count:>4}×  {kw}")
    print("─" * 72 + "\n")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Multi-platform bug bounty AI scope scanner.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="See the module docstring for full credential setup instructions.",
    )
    parser.add_argument("--output", default="bb_ai_scope_findings.csv",
                        help="Output CSV path (default: bb_ai_scope_findings.csv)")
    parser.add_argument("--max-pages", type=int, default=0,
                        help="Max pages per platform (0=all; each page ~25-100 programs)")
    parser.add_argument("--platforms", default="h1,bc,ywh,inti",
                        help="Comma-separated platforms: h1,bc,ywh,inti (default: all)")
    parser.add_argument("--h1-handle", type=str, default=None,
                        help="Scan only this single HackerOne program handle")
    parser.add_argument("--creds-file", type=str, default=None,
                        help="Path to credentials file (KEY=VALUE per line, e.g. H1_USERNAME=alice)")
    parser.add_argument("--verbose", action="store_true",
                        help="Enable debug-level logging")
    args = parser.parse_args()

    # Load credentials from file into os.environ (if provided)
    if args.creds_file:
        creds_path = pathlib.Path(args.creds_file)
        if not creds_path.is_file():
            log.error("Credentials file not found: %s", args.creds_file)
            sys.exit(1)
        loaded = 0
        for line_no, raw in enumerate(creds_path.read_text().splitlines(), 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                log.warning("Skipping malformed line %d in %s: %s", line_no, args.creds_file, line)
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip()
            os.environ[key] = val
            loaded += 1
        log.info("Loaded %d credential(s) from %s", loaded, args.creds_file)

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    enabled = {p.strip().lower() for p in args.platforms.split(",")}

    scanners = [
        ("h1",   HackerOneScanner()),
        ("bc",   BugcrowdScanner()),
        ("ywh",  YesWeHackScanner()),
        ("inti", IntigritiScanner()),
    ]

    all_findings: list = []

    for key, scanner in scanners:
        if key not in enabled:
            continue
        if not scanner.is_available():
            log.warning(
                "[%s] Required credentials not set — skipping. "
                "Check the env vars listed in --help or the file header.",
                scanner.platform_name,
            )
            continue

        log.info("━━━ Starting %s scan ━━━", scanner.platform_name)
        try:
            if key == "h1" and args.h1_handle:
                findings = scanner.scan_single(args.h1_handle)  # type: ignore
            else:
                findings = scanner.scan_all(max_pages=args.max_pages)
            log.info("[%s] Found %d AI signal(s).", scanner.platform_name, len(findings))
            all_findings.extend(findings)
        except KeyboardInterrupt:
            log.warning("Interrupted. Saving partial results…")
            break
        except Exception as exc:
            log.error("[%s] Unexpected error: %s",
                      scanner.platform_name, exc, exc_info=args.verbose)

    if not all_findings:
        print("\nNo AI/LLM signals found across any scanned programs.\n")
        sys.exit(0)

    write_csv(all_findings, args.output)
    print_trend_chart(all_findings)
    print_summary(all_findings)


if __name__ == "__main__":
    main()