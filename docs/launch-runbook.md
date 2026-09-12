# Launch runbook

The order matters. Each step assumes the ones above it are done.

## 0. Where things stand

| Product | Content | Sellable today | Blocker |
|---|---|---|---|
| The Complete I Can't Experience ($197) | ✅ 11 modules | ❌ | Stripe + flip live |
| 1P Certified Leader Coach ($497) | ✅ 7 modules | ❌ | slug fix + Stripe + flip live |
| I Can't: The Course | ✅ 11 modules | n/a | sold only inside the bundle |
| 1P Certified Life Coach ($3,497) | ✅ 8 modules + 48-question exam | ❌ | slug fix, then seed, then cohort dates + Stripe |
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

**Checked 2026-09-11 against production:**

| Secret | State |
|---|---|
| `STRIPE_SECRET_KEY` | Set, and it is a **live** key (`sk_live_…`). Real money. |
| `STRIPE_WEBHOOK_SECRET` | **Placeholder only** (`whsec_placeholder`, 17 chars). |

Both secrets existed all along. Checkout never worked because no function
*declared* them, so they were never injected at runtime. That is fixed.

The webhook secret is the remaining blocker, and it is the dangerous one. With
a live key and a placeholder signing secret, a purchase would be **charged and
then never enrolled**, because `stripeWebhook` rejects every event whose
signature it cannot verify. Do not set any course live until the real
`whsec_` value is in place.

Use Secret Manager, not `functions/.env`. The `.env` file is git-ignored, and
GitHub Actions is what deploys this project, so a key set that way would
disappear on the next merge to main.

```bash
npx firebase-tools functions:secrets:set STRIPE_SECRET_KEY --project the-1p-leadership
npx firebase-tools functions:secrets:set STRIPE_WEBHOOK_SECRET --project the-1p-leadership
```

Start with test keys (`sk_test_...`). Both are declared in `functions/index.js`
as `stripeSecretKey` / `stripeWebhookSecret` and listed in the `secrets:`
option of the four functions that touch Stripe: `createCheckoutSession`,
`stripeWebhook`, `syncCoupon`, `createRenewalCheckout`.

Then in the Stripe dashboard add a webhook endpoint pointing at the deployed
`stripeWebhook` URL, subscribed to `checkout.session.completed`,
`customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`.
The signing secret it gives you is `STRIPE_WEBHOOK_SECRET`.

Deploying happens automatically on merge to `main`
(`.github/workflows/firebase-deploy-backend.yml`). Setting a new secret value
requires a redeploy to take effect: merge something, or run the workflow by
hand from the Actions tab.

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

## 5. Seed the Life Coach program

**The curriculum is written.** All eight modules are at teaching depth, the
exam bank holds 48 questions, and the client kit and `/clc` sales page are
done. What remains is getting that content into Firestore and setting the
cohort details.

`scripts/seed-clc.js` writes the 8 modules, the exam bank, the FOUNDING coupon
and the certification config. **It has never been run.**

Run it AFTER step 1, never before. Until the slug fix has run, `courses/1p-clc`
still holds the Leader Coach and its seven lessons; seeding first would merge
Life Coach modules on top of them and the slug fix would then copy the
corrupted mix to `1p-clc-leader`, destroying both programs with no undo. The
script now refuses to run in that state and tells you to do step 1 first, so
the order is enforced rather than remembered.

```bash
cd scripts
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json
node seed-clc.js
```

Then set, in `/manage-courses.html` or directly in Firestore:

- `courses/1p-clc` → `cohort.enrollCloseAt`, `cohort.startAt`, `cohort.callDay`,
  `cohort.callTime`. All four are placeholders after seeding.
- `courses/1p-clc/private/cohort` → `joinUrl`, the Zoom link. Empty after seeding.

**Modules 2 through 8 are seeded as drafts on purpose.** The program is a
cohort with weekly module drops, so members see only module 1 until you publish
each next one in `/manage-courses.html`. There is no automatic drip anywhere in
the codebase: a module stays invisible until that toggle is flipped by hand. If
you would rather ship all eight at once, publish them all in the builder after
seeding, and drop the weekly gating from how you sell it.

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
