# Admin scripts

One-off migrations and seeds that run against Firestore with Admin
credentials, from your machine. They are not deployed and nothing calls them
automatically.

`leads/` is separate: a Python lead finder that builds a CRM import CSV from
public organization websites. It never touches Firestore. See
[`leads/README.md`](leads/README.md).

## One-time setup

```bash
cd scripts
npm install
```

Then authenticate, using **either** option.

**a) A service account key.** In the Firebase Console, go to Project settings →
Service accounts → Generate new private key. Save the JSON somewhere outside
this repo (it is a credential, do not commit it), then:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json
```

**b) Your own Google account,** if you have the gcloud CLI installed:

```bash
gcloud auth application-default login
```

The project (`the-1p-leadership`) is read from `.firebaserc` automatically by
`lib/init.js`. Option (b) is why that matters: an application-default
credential carries no project id, so without it a script cannot tell which
project it is pointed at.

The two scripts you actually need to run, `fix-clc-slugs.js` and
`seed-clc.js`, both print the project before doing anything and prove the
credentials work before they write. The three unrun seeds
(`seed-booking.js`, `seed-resale-products.js`, `seed-financial-partner.js`)
still call `admin.initializeApp()` bare, so they need option (a), a service
account key. Move them onto `lib/init.js` before running any of them.

## The scripts

| Script | What it does | Run it? |
|---|---|---|
| `fix-clc-slugs.js` | Moves the Leader Coach off the `1p-clc` slug onto `1p-clc-leader` with its lessons, members and purchases; resets `1p-clc` to the Life Coach identity; archives the superseded `silence-the-voice` draft. | **Yes, once.** See below. |
| `seed-clc.js` | Writes the 8 written modules, the 48-question exam bank, the FOUNDING coupon and certification config for the $3,497 Life Coach program. | **Yes, once — but only AFTER `fix-clc-slugs.js`.** It refuses to run before that and tells you so. |
| `seed-brief.js` | Writes The One Percent Brief course ($12/month subscription) and one module per file in `brief-content/`. Brief 1 is published, the rest are drafts. Re-runs never change status, price or a brief's published state. | **Yes**, once to create it, and again whenever a brief is added or edited. |
| `seed-focus-tax.js` | Writes The Focus Tax course (free, created live) and one module per markdown file in `focus-tax-content/`, all published. A piece with a `brief` in `meta.js` ends in a link to that brief. Re-runs never change status, price or a piece's published state. | **Automatic.** The *Seed The Focus Tax* workflow runs it on every push to `main` that touches the seed or `focus-tax-content/`, and can be run by hand from the Actions tab. |
| `upload-book.js` | Uploads an EPUB (and cover) to the digital library and writes `books/{id}`. See `docs/digital-library.md`. | **Yes**, once the final EPUB is ready, and again for each new edition. |
| `setup-digital-library.js` | Makes the I Can't bundle digital, creates the paperback option, and adds the book to everyone already enrolled. | **Yes, once** after the first upload. Dry run by default; `--apply` writes. |
| `seed-booking.js` | Writes `config/booking` with the Zoom scheduler URL. | Optional. `/book-a-call.html` already works from a hardcoded fallback. |
| `seed-resale-products.js` | Creates the A.L.I.G.N. client workbook, assessment and six-week program as draft products. | Not yet. They have no content or final pricing. |
| `seed-financial-partner.js` | Creates the financial services partner company and its waitlist products. | Not yet. The partner name is still a placeholder. |

## Running the CLC slug fix

This is the one to run now. It is destructive, so it defaults to a dry run.

```bash
cd scripts
node fix-clc-slugs.js            # prints the plan, writes nothing
node fix-clc-slugs.js --apply    # commits it
```

Read the dry-run output first and confirm the project name at the top is
`the-1p-leadership`. The apply pass copies the Leader Coach lessons and
verifies they landed before deleting the originals, so a failure partway
through leaves the old data intact. Running it a second time aborts on an
identity check rather than doing anything twice.

Back up first if you want belt and braces:

```bash
gcloud firestore export gs://the-1p-leadership.appspot.com/backups/$(date +%F)
```

## After it runs

`courses/1p-clc-leader` holds the finished 7-module Leader Coach at $497, and
`courses/1p-clc` becomes the Life Coach at $3,497 with no lessons yet. Neither
can be bought until Stripe is connected. See `docs/launch-runbook.md` for the
rest of the sequence.

## The Focus Tax and The One Percent Brief

These two are one funnel, so they are run and released together.

`the-focus-tax` is free and short: four pieces of roughly 600 words on time,
capacity and structure. `one-percent-brief` is the paid side, $12 a month or
$99 a year, six long-form briefs written and one published.

Four and not more by design. The briefs already cover ADHD focus, overthinking
and burnout at length, so short pieces on those subjects would compete with
the thing they are supposed to sell. These four are the subjects no brief
covers: open loops, the list versus the calendar, meetings and working memory,
and decision load.

Pieces 1 and 3 point at brief 3, which goes deeper on starting tasks and on
external structure. Pieces 2 and 4 carry no pointer, because nothing in the
Brief covers the calendar or decision load yet. Give them a `brief` in
`meta.js` when something does.

A piece of the Focus Tax is a markdown file in `focus-tax-content/` with
frontmatter (`title`, `slug`, `issue`, `pillar`, `read_time`, `hook`) plus an
entry in `focus-tax-content/meta.js` keyed by that slug, holding the workbook
and summary and the `brief` number it points at. Adding one is those two edits
and a re-run. The markdown converter in the seed handles `##` and `###`
headings, paragraphs, ordered and unordered lists, `**bold**` and `*italic*`,
and drops the rule above the source note.

The Focus Tax is ungated. The seed creates it live at price 0, it shows in the
portal's course library and the dashboard marked Free, and a signed-in member
who opens it is enrolled on the way in (no checkout, no Join step). Reading
still needs a portal login, which is what captures the reader as a lead.

The free series only works as acquisition if the thing it points at is
purchasable. Set `one-percent-brief` to live in `/manage-courses.html` when
it is ready; until then the pointers in pieces 1 and 3 land on a Notify me
button, which still captures interest.
