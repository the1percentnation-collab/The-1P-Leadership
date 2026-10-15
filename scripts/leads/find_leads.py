#!/usr/bin/env python3
"""
Find decision-makers on public organization websites and write a CSV the CRM
importer (/crm-import.html) reads as-is.

WHY ORGANIZATION WEBSITES, NOT LINKEDIN OR FACEBOOK
LinkedIn and Facebook do not show email addresses, both sit behind a login
wall, and both ban automated access in their terms. Scraping them gets the
account restricted and returns no emails anyway. The people we sell to
(CEOs, sales leaders, executive directors, senior pastors) are listed with
their email on their own organization's staff, leadership and contact pages.
That is where this looks. LinkedIn is the research layer, done by hand.

WHAT IT DOES, PER TARGET
  1. Checks robots.txt and skips anything the site asks crawlers to avoid.
  2. Finds the site's own staff / team / leadership / about / contact pages.
  3. Has ScrapeGraphAI read each page and pull people, titles and emails.
  4. Throws out any email that does not literally appear on the page, so a
     model guess never reaches the CRM and never bounces.
  5. Tags each contact by field and whether their title is a buyer.

USAGE
  export ANTHROPIC_API_KEY=...
  python find_leads.py --targets targets.csv
  python find_leads.py --search "Oklahoma City nonprofit executive director" --field faith
  python find_leads.py --targets targets.csv --buyers-only --out out/okc.csv

Re-running with the same --out appends new contacts and skips emails already
in the file.
"""

import argparse
import csv
import os
import re
import sys
import time
from pathlib import Path
from typing import List, Optional
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field
from scrapegraphai.graphs import SmartScraperGraph

USER_AGENT = "OnePercentLeadFinder/1.0 (+https://the1pnation.com)"

# Never fetched. Login-walled, no emails exposed, and automated access is
# against their terms.
BLOCKED_DOMAINS = (
    "linkedin.com", "facebook.com", "fb.com", "instagram.com", "x.com",
    "twitter.com", "tiktok.com", "youtube.com",
)

# Search results worth skipping: directories and aggregators, not the
# organization itself.
AGGREGATOR_DOMAINS = BLOCKED_DOMAINS + (
    "yelp.com", "indeed.com", "glassdoor.com", "zoominfo.com", "wikipedia.org",
    "bbb.org", "yellowpages.com", "mapquest.com", "crunchbase.com",
    "rocketreach.co", "apollo.io",
)

# Links on a homepage that usually lead to named people.
PEOPLE_PAGE_HINTS = re.compile(
    r"(staff|team|leadership|our-people|people|about|who-we-are|elders|"
    r"pastor|board|executive|management|contact)",
    re.I,
)

# Buyer titles by field. HR and L&D are influencers, not buyers, so they are
# tagged separately and never counted as buyers.
BUYER_TITLES = {
    "sales": r"chief revenue|\bcro\b|vp,? (of )?sales|vice president,? (of )?sales|"
             r"head of sales|sales director|director of sales|chief sales|"
             r"sales manager|vp,? (of )?revenue",
    "leadership": r"\bceo\b|chief executive|\bcoo\b|chief operating|president|"
                  r"founder|owner|managing (director|partner)|general manager",
    # Only the person who signs off on spend. A church with a large staff has
    # a dozen pastors; the associate, youth and children's pastors are not it.
    "faith": r"executive director|senior pastor|lead pastor|head pastor|"
             r"executive pastor|senior minister|lead minister|\brector\b|bishop|"
             r"\bceo\b|president|founder",
}
INFLUENCER_TITLES = r"\bhr\b|human resources|people (ops|operations)|talent|" \
                    r"learning|l&d|training|development director|culture"

GENERIC_INBOX = re.compile(
    r"^(info|hello|contact|office|admin|support|help|team|mail|general|"
    r"church|welcome|connect|media|sales|marketing|jobs|careers|hr|billing)@",
    re.I,
)
# Stripped from names so a campaign's first-name merge reads "Hi Jon", not
# "Hi Rev.". The title column still carries the role.
HONORIFIC_RE = re.compile(r"^((rev|dr|pastor|bishop|mr|mrs|ms|fr|elder)\.?\s+)+", re.I)
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

CSV_HEADERS = ["Name", "Email", "Phone", "Company", "Tags", "Title", "Source URL"]


class Person(BaseModel):
    name: str = Field(default="", description="Full name of the person")
    title: str = Field(default="", description="Job title or role exactly as written")
    email: str = Field(default="", description="Email address exactly as written on the page, or empty")
    phone: str = Field(default="", description="Direct phone number if listed, or empty")


class PageContacts(BaseModel):
    organization: str = Field(default="", description="Name of the organization that owns this website")
    people: List[Person] = Field(default_factory=list)
    general_email: str = Field(default="", description="The organization's main contact email, or empty")


PROMPT = (
    "List every named staff member, leader, executive, pastor or board member on "
    "this page with their job title, email and direct phone. Also give the "
    "organization's name and its main contact email. Copy emails exactly as "
    "they appear on the page. If a person has no email shown, leave email "
    "empty. Never construct, infer or guess an email address."
)


def graph_config() -> dict:
    model = os.environ.get("LEADS_MODEL", "claude-opus-5-5")
    return {
        "llm": {
            "api_key": os.environ["ANTHROPIC_API_KEY"],
            "model": f"anthropic/{model}",
            # ScrapeGraphAI's token table predates current Claude models and
            # silently falls back to 8,192 without this, cutting long staff
            # pages off halfway down.
            "model_tokens": 200000,
        },
        "headless": True,
        "verbose": False,
        "loader_kwargs": {"timeout": 60},
    }


def host(url: str) -> str:
    h = urlparse(url).netloc.lower()
    return h[4:] if h.startswith("www.") else h


def is_blocked(url: str, domains=BLOCKED_DOMAINS) -> bool:
    h = host(url)
    return any(h == d or h.endswith("." + d) for d in domains)


_robots_cache = {}


def allowed_by_robots(url: str) -> bool:
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    if base not in _robots_cache:
        rp = RobotFileParser()
        try:
            r = requests.get(base + "/robots.txt", timeout=10, headers={"User-Agent": USER_AGENT})
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except requests.RequestException:
            rp.parse([])
        _robots_cache[base] = rp
    return _robots_cache[base].can_fetch(USER_AGENT, url)


def people_pages(start_url: str, limit: int) -> List[str]:
    """The start URL plus up to `limit` same-site pages likely to list people."""
    pages = [start_url]
    try:
        r = requests.get(start_url, timeout=15, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"    ! could not load {start_url}: {e}")
        return pages
    soup = BeautifulSoup(r.text, "html.parser")
    site = host(start_url)
    scored = []
    for a in soup.find_all("a", href=True):
        url = urljoin(r.url, a["href"]).split("#")[0].rstrip("/")
        if host(url) != site or url in pages or not url.startswith("http"):
            continue
        text = f"{a.get_text(' ', strip=True)} {urlparse(url).path}"
        if PEOPLE_PAGE_HINTS.search(text):
            # Staff and leadership pages first; contact and about pages last.
            rank = 0 if re.search(r"staff|team|leadership|people|pastor|elders|executive", text, re.I) else 1
            scored.append((rank, url))
    for _, url in sorted(set(scored)):
        if url not in pages:
            pages.append(url)
        if len(pages) > limit:
            break
    return pages


def scrape_page(url: str) -> Optional[tuple]:
    graph = SmartScraperGraph(prompt=PROMPT, source=url, config=graph_config(), schema=PageContacts)
    try:
        answer = graph.run()
    except Exception as e:  # network, render and model errors all end the same way: skip the page
        print(f"    ! scrape failed for {url}: {e}")
        return None
    try:
        doc_text = " ".join(str(d) for d in (graph.get_state("doc") or []))
    except KeyError:
        doc_text = ""
    if isinstance(answer, dict) and "content" in answer and isinstance(answer["content"], dict):
        answer = answer["content"]
    try:
        return PageContacts.model_validate(answer), doc_text.lower()
    except Exception:
        print(f"    ! unexpected answer shape from {url}")
        return None


def classify(title: str, field: str) -> str:
    t = title.lower()
    if field in BUYER_TITLES and re.search(BUYER_TITLES[field], t):
        return "buyer"
    if re.search(INFLUENCER_TITLES, t):
        return "influencer"
    return "other"


def rows_for_target(url: str, field: str, org_override: str, max_pages: int, include_generic: bool) -> List[dict]:
    rows = []
    for page in people_pages(url, max_pages):
        if not allowed_by_robots(page):
            print(f"    - robots.txt disallows {page}, skipping")
            continue
        print(f"    reading {page}")
        result = scrape_page(page)
        if not result:
            continue
        contacts, doc_text = result
        company = org_override or contacts.organization or host(url)

        candidates = [(p.name, p.title, p.email, p.phone) for p in contacts.people]
        if include_generic and contacts.general_email:
            candidates.append(("", "General inbox", contacts.general_email, ""))

        for name, title, email, phone in candidates:
            email = (email or "").strip().lower().removeprefix("mailto:")
            if not EMAIL_RE.match(email):
                continue
            # The page must actually contain the address. If doc text is
            # missing we cannot prove it, so the contact is dropped.
            if email not in doc_text:
                print(f"    - dropped {email}: not found on the page")
                continue
            generic = bool(GENERIC_INBOX.match(email))
            if generic and not include_generic:
                continue
            role = "generic-inbox" if generic else classify(title, field)
            tags = ["scraped", f"field:{field}", role]
            rows.append({
                "Name": HONORIFIC_RE.sub("", name.strip()),
                "Email": email,
                "Phone": (phone or "").strip(),
                "Company": company.strip(),
                "Tags": "; ".join(tags),
                "Title": title.strip(),
                "Source URL": page,
            })
        time.sleep(1)  # be a polite guest on small sites
    return rows


def search_targets(query: str, max_results: int) -> List[str]:
    from ddgs import DDGS  # installed with scrapegraphai

    seen, urls = set(), []
    for r in DDGS().text(query, max_results=max_results * 3):
        url = r.get("href") or ""
        if not url.startswith("http") or is_blocked(url, AGGREGATOR_DOMAINS):
            continue
        h = host(url)
        if h in seen:
            continue
        seen.add(h)
        urls.append(f"{urlparse(url).scheme}://{urlparse(url).netloc}")
        if len(urls) >= max_results:
            break
    return urls


def load_targets(path: Path, default_field: str) -> List[dict]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        out = []
        for row in csv.DictReader(f):
            url = (row.get("url") or "").strip()
            if not url or url.startswith("#"):
                continue
            if not url.startswith("http"):
                url = "https://" + url
            out.append({
                "url": url,
                "field": (row.get("field") or default_field).strip().lower(),
                "organization": (row.get("organization") or "").strip(),
            })
        return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--targets", type=Path, help="CSV with columns url, field, organization")
    src.add_argument("--search", help="Find organization websites with a web search first")
    ap.add_argument("--field", default="leadership", choices=sorted(BUYER_TITLES),
                    help="Field for --search results, and the default for targets without one")
    ap.add_argument("--max-results", type=int, default=10, help="Websites to take from --search")
    ap.add_argument("--max-pages", type=int, default=3, help="Extra people pages to read per site")
    ap.add_argument("--buyers-only", action="store_true", help="Keep only contacts whose title is a buyer")
    ap.add_argument("--include-generic", action="store_true",
                    help="Also keep info@ / office@ style inboxes (useful for small churches and nonprofits)")
    ap.add_argument("--out", type=Path, default=Path("out/leads.csv"))
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Set ANTHROPIC_API_KEY first.", file=sys.stderr)
        return 1

    if args.targets:
        targets = load_targets(args.targets, args.field)
    else:
        print(f"Searching: {args.search}")
        targets = [{"url": u, "field": args.field, "organization": ""}
                   for u in search_targets(args.search, args.max_results)]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    seen = set()
    if args.out.exists():
        with args.out.open(newline="", encoding="utf-8") as f:
            seen = {r["Email"].lower() for r in csv.DictReader(f) if r.get("Email")}
    new_file = not args.out.exists()

    added = 0
    with args.out.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        if new_file:
            writer.writeheader()
        for i, t in enumerate(targets, 1):
            print(f"[{i}/{len(targets)}] {t['url']} ({t['field']})")
            if is_blocked(t["url"]):
                print("    - LinkedIn/Facebook/social URL, skipping. Use the organization's own website.")
                continue
            for row in rows_for_target(t["url"], t["field"], t["organization"], args.max_pages, args.include_generic):
                if row["Email"] in seen:
                    continue
                if args.buyers_only and "buyer" not in row["Tags"]:
                    continue
                seen.add(row["Email"])
                writer.writerow(row)
                f.flush()
                added += 1
                print(f"    + {row['Name'] or '(inbox)'} | {row['Title']} | {row['Email']}")

    print(f"\nDone. {added} new contacts written to {args.out}")
    print("Import at /crm-import.html. Add a 'Web research' source in the Source picker so these stay separable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
