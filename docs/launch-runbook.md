# Launch runbook

The order matters. Each step assumes the ones above it are done.

## 0. Where things stand

| Product | Content | Sellable today | Blocker |
|---|---|---|---|
| The Complete I Can't Experience ($197) | ✅ 11 modules | ❌ | Stripe + flip live |
| 1P Certified Leader Coach ($497) | ✅ 7 modules | ❌ | slug fix + Stripe + flip live |
| I Can't: The Course | ✅ 11 modules | n/a | sold only inside the bundle |
| 1P Certified Life Coach ($3,497) | ❌ none | ❌ | 8 modules to write |
| Mindset Foundations, Business Alignment, Faith & Leadership, Performance & Discipline | ❌ none | ❌ | copy only, no lessons |
| Silence The Voice | 6 modules | ❌ | superseded draft, archived by step 1 |

## 1. Fix the CLC slug collision

`courses/1p-clc` in production holds the **Leader Coach** (7 lessons, $497), but
the code registry says that slug is the **$3,497 Life Coach**. Firestore
overrides the registry, so the record is currently two programs at once. This
also archives `silence-the-voice`, the superseded I Can't draft.

```bash
cd scripts
npm install                      # one time
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json
node fix-clc-slugs.js            # dry run, prints the plan
node fix-clc-slugs.js --apply    # commits it
```

Credential setup and a backup command are in `scripts/README.md`.

Safe to run once. A second run aborts rather than corrupting anything. It
verifies the lesson copy before deleting anything, and repoints any enrolled
member's progress and purchase records.

## 2. Connect Stripe

Until these are set, every paid path returns "not configured" and nothing can
be bought. Set them in `functions/.env` or Secret Manager, then deploy:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

The webhook endpoint is `stripeWebhook`. Point Stripe at it and subscribe to
`checkout.session.completed`, `invoice.paid`, and the subscription events.

```bash
./scripts/deploy-functions.sh
```

## 3. Flip the finished products live

In `/manage-courses.html`:

- **The Complete I Can't Experience** — set the title (the record has none),
  price `197`, confirm **Ships the book** is on, status **live**.
- **I Can't: The Course** — status **live**. Nobody can buy it directly
  (`sellable: false`), but bundle buyers need it live to open it.
- **1P Certified Leader Coach** — status **live** at `497`.

Then place a real test order against Stripe test keys and confirm: the
enrollment lands, the paperback order appears under Orders in
`/manage-store.html` with the shipping address, and the course opens.

## 4. Stock the book

The bundle ships a paperback. Order author copies from KDP (roughly $2.50–$3.50
print cost on a 132-page book) and keep a small shelf stock. Orders are worked
from `/manage-store.html` → Orders: `new` → `shipped` → `done`. A comped
enrollment lands as `needs-address` because there was no Stripe checkout to
collect one.

## 5. Then build the Life Coach program

`scripts/seed-clc.js` creates the 8 module shells, the exam bank and the
certification config, but **it has never been run** and 7 of its 8 modules are
drafts. Before this can sell it needs the module content written, plus a cohort
start date, enrollment close date, weekly call day and time, and the Zoom link
in `courses/1p-clc/private/cohort`.

## Known open items

- The A.L.I.G.N. letters in `public/js/align.js` were written into code, not
  confirmed by Anthony. The Brand & Company Reference still lists them as open.
- `scripts/seed-resale-products.js` and `scripts/seed-financial-partner.js`
  have never been run; those products don't exist in the database.
- `config/booking` does not exist, so the webinar registration flow captures
  leads for an event that isn't there. `/book-a-call.html` works anyway because
  the Zoom scheduler URL is hardcoded as a fallback.
- The Social Media Matrix is priced and promoted but sits at `waitlist` with no
  sessions scheduled and no join link.
