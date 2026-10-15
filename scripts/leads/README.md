# Lead finder

Finds decision-makers on public organization websites with
[ScrapeGraphAI](https://github.com/ScrapeGraphAI/Scrapegraph-ai) and writes a
CSV that `/crm-import.html` reads with no column mapping.

## Why not LinkedIn or Facebook

Neither shows email addresses, both require a login, and both prohibit
automated access. A scraper there returns no emails and gets the account
restricted, which costs you the one place you do real research. The script
refuses those URLs on purpose.

The buyers we sell to publish their own contact details: senior pastors and
executive directors on church and nonprofit staff pages, CEOs and sales
leaders on company leadership and team pages. That is where this looks.

Use LinkedIn by hand, after the CSV is built, to check that a person is still
in the role and to find one real detail for the first line of the email.

## Setup (once)

```bash
cd scripts/leads
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
export ANTHROPIC_API_KEY=sk-ant-...
```

The model defaults to `claude-opus-5-5`. For large runs where cost matters
more than accuracy, set `export LEADS_MODEL=claude-haiku-5-5`.

## Run it

**From a list of organizations you chose** (best results):

```bash
cp targets.example.csv targets.csv   # then fill it in
python find_leads.py --targets targets.csv --buyers-only
```

**From a search**, when you are building a list from nothing:

```bash
python find_leads.py --search "Oklahoma City church senior pastor staff" --field faith --max-results 15 --include-generic
python find_leads.py --search "Oklahoma City manufacturing company leadership team" --field leadership --buyers-only
python find_leads.py --search "Tulsa SaaS company sales team VP of sales" --field sales --buyers-only
```

Output goes to `out/leads.csv` (change with `--out`). Re-running appends and
skips emails already in the file.

| Flag | What it does |
|---|---|
| `--field sales\|leadership\|faith` | Which titles count as buyers. Sales: CRO, VP Sales. Leadership: CEO, COO, President, Founder. Faith: Executive Director, Senior Pastor. |
| `--buyers-only` | Drop everyone whose title is not a buyer. HR and L&D are tagged `influencer`, never `buyer`. |
| `--include-generic` | Keep `info@` and `office@` inboxes. Worth it for small churches and nonprofits where that inbox reaches the pastor. |
| `--max-pages N` | How many staff, team, about and contact pages to read per site (default 3). |

## What lands in the CSV

`Name, Email, Phone, Company, Tags, Title, Source URL`. Tags look like
`scraped; field:faith; buyer`, so in the CRM you can filter to buyers in one
field and send that segment its own campaign.

Every email is checked against the page text. If the model returns an address
that is not literally on the page, it is dropped and logged. A guessed address
bounces, and bounces hurt the sending domain for every email after it.

## Import

1. Open `/crm-import.html`, upload `out/leads.csv`.
2. Columns map automatically. In Source, add `Web research`.
3. Import. The campaign sender already adds the unsubscribe link and honors
   opt-outs.

## Before you send

Cold B2B email is legal in the US under CAN-SPAM when it has an accurate
From line, a non-deceptive subject, your physical mailing address, and a
working unsubscribe that is honored. The CRM handles the last one. Two more
rules worth keeping:

- **Do not email EU or UK contacts** from this list. GDPR and PECR require a
  basis this list does not have.
- **Do not blast it.** Send from a secondary domain (for example
  `the1pnation.co`) warmed up over two to three weeks, 20 to 40 a day,
  personal one-to-one copy. A scraped list sent as a newsletter lands in spam
  and takes the main domain with it.
