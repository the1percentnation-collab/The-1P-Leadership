---
name: find-leads
description: Find decision-maker leads (senior pastors, executive directors, CEOs, sales leaders) on public organization websites and produce a CSV for the CRM importer. Use when Anthony asks to find leads, prospects, contacts or emails for churches, nonprofits, companies or sales teams, e.g. "find 15 Tulsa churches", "get me sales leaders at OKC software companies".
argument-hint: "[how many] [who] [where], e.g. 15 Tulsa churches"
---

# Find leads

Runs `scripts/leads/find_leads.py`, which reads organizations' own staff,
leadership and contact pages, keeps only emails that literally appear on the
page, and writes `scripts/leads/out/leads.csv` in the column order
`/crm-import.html` maps automatically. Read `scripts/leads/README.md` if you
need detail beyond this file.

## 1. Turn the request into a run

From the request (or `$ARGUMENTS`), decide:

- **field**: `faith` (churches, ministries, faith-based nonprofits),
  `leadership` (companies, nonprofits, associations where the buyer is the
  CEO, COO or President), or `sales` (sales and revenue teams). If unclear,
  `leadership`.
- **search**: a web search phrase that surfaces the organizations' own sites
  and pulls toward staff pages. Include place, type and a buyer title, e.g.
  `Tulsa church executive pastor staff`,
  `Oklahoma City manufacturing company leadership team`,
  `Dallas SaaS company VP of sales team`.
- **count**: organizations to check. Default 15, cap 40 per run unless asked.

If the request names specific organizations or URLs instead, write them to
`scripts/leads/targets.csv` (columns `url,field,organization`) and use
`--targets targets.csv` in place of `--search`.

Never target LinkedIn, Facebook or other social profiles. The script refuses
them; do not work around that. If asked, explain that those sites expose no
emails and prohibit automated access, and that the organization's own site is
the source.

## 2. Make sure it can run

Work from `scripts/leads`. Check, fix only what is missing, and do not
reinstall what is already there:

1. `ANTHROPIC_API_KEY` is set (`test -n "$ANTHROPIC_API_KEY"`). If not, stop
   and tell Anthony to set it. Never ask him to paste the key into chat.
2. `.venv` exists with the packages:
   `.venv/bin/python -c "import scrapegraphai, langchain_anthropic"`.
   If not:
   ```bash
   uv venv --python 3.13 && uv pip install -r requirements.txt
   ```
   (No `uv`? `python3.13 -m venv .venv && .venv/bin/pip install -r requirements.txt`.)
3. A Chromium for Playwright. Skip this when `PLAYWRIGHT_BROWSERS_PATH` is
   already set (cloud sessions ship one). Otherwise run
   `.venv/bin/playwright install chromium` once.

## 3. Run it

```bash
cd scripts/leads
.venv/bin/python find_leads.py --search "<search>" --field <field> --max-results <count> --buyers-only
```

Run it in the background for counts above 10; it takes roughly 20 to 40
seconds per organization. Add `--include-generic` only for small churches and
nonprofits, or when asked. Results append to `out/leads.csv` and skip emails
already there; pass `--out out/<name>.csv` when Anthony wants a separate list.

If every site fails to load with a proxy or 403 error, the session's network
policy is blocking outside websites. Say so and stop: in a cloud session he
sets Network access to Full in the environment settings and starts a new
session. Do not fabricate or fill in contacts.

## 4. Report back

Keep it short:

- Organizations checked, buyers found, and any sites that failed.
- A table of the new buyers: name, title, organization, email.
- Where the file is. In a cloud session, send the CSV to Anthony with
  SendUserFile so he can download it.
- The next step: upload at `/crm-import.html` and add a `Web research` source.

Do not commit anything under `scripts/leads/out/`; it is personal data and
gitignored.
