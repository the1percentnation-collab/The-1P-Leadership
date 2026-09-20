# Launch runbook

The order matters. Each step assumes the ones above it are done.

## 0. Where things stand

| Product | Content | Sellable today | Blocker |
|---|---|---|---|
| The Complete I Can't Experience ($197) | ✅ 11 modules | ❌ | Stripe + flip live |
| 1P Certified Leader Coach ($497) | ✅ 7 modules | ❌ | slug fix + Stripe + flip live |
| I Can't: The Course | ✅ 11 modules | n/a | sold only inside the bundle |
| 1P Certified Life Coach ($3,497) | ✅ 8 modules seeded + exam bank | ❌ | status is `coming-soon`; cohort dates + Stripe |
| Mindset Foundations, Business Alignment, Faith & Leadership, Performance & Discipline | ❌ none | ❌ | copy only, no lessons |
| Silence The Voice | 6 modules | ❌ | superseded draft, archived by step 1 |

## 1. Fix the CLC slug collision — ALREADY DONE

**Verified against production on 2026-09-12. Nothing to do here.** Re-running
the fix now aborts by design, with "does not look like the Leader Coach".

`courses/1p-clc` is the Life Coach at $3,497. The Leader Coach lives at
`courses/1p-clc-leader` at $497, status live, with all seven lessons published.
`silence-the-voice` is archived as inactive. That is the finished end state.

Check any of this for yourself at any time, without writing anything:

```bash
cd scripts && node inspect-clc.js
```

The original problem this step solved is kept below for context only.

`courses/1p-clc` used to hold the **Leader Coach** (7 lessons, $497) while the
code registry said that slug was the **$3,497 Life Coach**. Firestore overrides
the registry, so the record was two programs at once.

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
| `STRIPE_WEBHOOK_SECRET` | **Re-checked 2026-09-12: a real value is now set** (38 chars, no longer the 17-char `whsec_placeholder`). |

Verify the secret length yourself without ever printing the secret:

```bash
gcloud secrets versions access latest --secret=STRIPE_WEBHOOK_SECRET \
  --project=the-1p-leadership | wc -c
```

A real value being stored is not the same as it working. It still has to match
the signing secret of the live Stripe endpoint, and the functions must have
been redeployed since it was set. Confirm with a test purchase before trusting
it, per the end of step 3.

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

## 3. Flip the finished products live — MOSTLY DONE

**Checked 2026-09-12.** These three are already `live`: `bundle-icant` at $197,
`icant` at $197, and `1p-clc-leader` at $497. Nothing to do for them.

Still `coming-soon`: **`1p-clc`, the Life Coach at $3,497.** Set it live in
`/manage-courses.html`, but only after the cohort dates in step 5 are filled
in, because the `/clc` sales page reads those dates and will otherwise show a
program with no start date.

`node inspect-clc.js` prints the status of every course if you want to confirm
before or after.

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
and the certification config.

**It has already been run. Verified against production on 2026-09-12:**
`courses/1p-clc` holds all eight modules, with module 1 published and 2 through
8 as drafts, which is exactly what this script produces. Run `node
inspect-clc.js` to confirm the exam bank, coupon and certification config too.
Re-running the seed is safe and idempotent, but there is no reason to.

The ordering rule below still applies to any fresh environment.

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

- `courses/1p-clc` → `lab.schedule` (free text, e.g. "Every other Tuesday,
  7:00pm CT") and `lab.nextAt` (the next session's date).
- `courses/1p-clc` → `cohort.enrollOpensAt`, the one date the launch campaign
  uses. It stops rendering once the course is live.
- `courses/1p-clc/private/cohort` → `joinUrl`, a recurring Zoom link. Empty
  after seeding.

**The course is self-paced now, so all eight modules are published.** They
unlock in order as a member completes each one (`sequentialUnlock` on the course
doc), which means there is nothing to flip week by week. The old cohort model
was dropped because nothing enforced it: checkout never read the enrollment
close date or the seat cap, and a second cohort would have overwritten the
first. See section 7.

## 6. Pre-registration and the announcement bar

Built for the September 25 enrollment date. Three pieces, and two Firestore
documents you have to create by hand.

### What ships in the code

- `registerCoursePreregistration` — a PUBLIC callable. No sign-in. Takes name,
  email, optional phone and a consent flag; writes
  `courses/{slug}/preregistrations/{emailKey}` (doc id is the sanitized email,
  so one person is one row however many times they submit), upserts a CRM
  contact tagged `Waitlist: 1P Certified Life Coach`, emails the registrant a
  confirmation and emails you an alert. Rate limited to 5 per 10 minutes.
  Refuses new entries once the course is `live`.
- `onCourseWritten` — fires when a course flips to `status: 'live'` and mails
  the pre-registration list once. Guarded by `launchNotifiedAt` on the course
  doc AND per recipient, so it cannot double-send. Skips anyone who
  unsubscribed.
- `notifyCoursePrereg({ slug, force })` — admin-only manual resend, for the day
  the trigger does not fire. `force: true` re-mails people already notified.
- `public/js/announce-bar.js` — the site-wide bar plus the pre-registration
  modal. Registered on 23 public pages. It reads its config from Firestore and
  falls back to hardcoded copy if that read fails.

### Create `config/announcement`

Public-readable (the rules allow it). Fields:

```
enabled       true
version       1                 bump to re-show the bar to everyone who dismissed it
message       The 1P Certified Life Coach opens enrollment September 25.
messageShort  Life Coach Certification opens September 25.
ctaText       Pre-register
ctaHref       /clc
courseSlug    1p-clc
courseTitle   1P Certified Life Coach
opensAt       2026-09-25T00:00:00-05:00
startAt       2026-09-01T00:00:00-05:00
endAt         2026-10-02T00:00:00-05:00
showDaysLeft  true
dismissible   true
```

Setting `enabled` to false kills the bar site-wide with no deploy. That is the
escape hatch if it causes a layout problem on a page nobody checked.

### Add `cohort.enrollOpensAt`

On `courses/1p-clc`, alongside the other cohort fields in section 5. The `/clc`
fact bar renders "Enrollment opens <date>" from it, and the confirmation email
uses it. Both omit the date rather than invent one if it is missing.

### September 25 cutover

One Firestore edit: `courses/1p-clc` → `status: 'live'`. That single write
flips the sales page from Pre-register to Enroll, and fires the launch email to
everyone on the list. Then set `config/announcement.enabled` to false, or let
`endAt` expire it on its own.

**Decide before the 25th whether you want that to be automatic.** If you would
rather send the launch mail by hand, set `launchNotifiedAt` on the course doc
to any timestamp BEFORE flipping the status. That disarms the trigger, and you
send with `notifyCoursePrereg` when you are ready.

## 7. Self-paced conversion

The Life Coach was sold as a fixed 16-week cohort and none of it was enforced.
`createCheckoutSession` never read `cohort.enrollCloseAt` or `cohort.capacity`,
so enrollment never closed and seats never ran out. Access was granted the
instant Stripe paid. There is one cohort map on one course document, so a
second group would have overwritten the first. Someone buying in week 14 got
every module at once and could sit the exam that afternoon.

Rather than build the missing cohort machinery, the course became self-paced.

### What changed

- **Sequential unlock.** A module opens when the one before it is complete.
  Driven by `sequentialUnlock` on the course doc, so it is per course and
  settable without a deploy. A locked module still renders, with the reason.
  It is a pacing affordance, not a paywall: the rules grant an enrolled member
  the whole modules subcollection.
- **The cohort call became a coaching lab.** Same private join link at
  `courses/{slug}/private/cohort`, same enrollment gating, but generic to any
  course now rather than hardcoded to `1p-clc`. Set `lab.schedule` and
  `lab.nextAt` in the builder. Use a recurring meeting link.
- **Gone:** enrollment close date, module 1 drop date, seat capacity. The seat
  counter never even rendered for visitors, since it read a coupon doc the
  rules restrict to admins. The scarcity that is real is the FOUNDING coupon's
  20-redemption cap, enforced at checkout, and that is what the page now says.
- **Practice partners replaced the peer triad.** Self-paced students never
  share a calendar. `channels/clc-practice` is unlisted and private, and
  `onUserEnrollmentWritten` adds each member on enrollment and removes them on
  refund. Run `backfillCourseChannelMembers({ slug: '1p-clc' })` once for
  anyone who enrolled before that trigger shipped.
- **All eight modules rewritten.** Each one now has Watch this module, The
  drill, and Practice assignment in place of the old live-call agenda.
  Durations are effort estimates instead of calendar positions.

### What you still have to do

1. **Pin a board post** in the CLC Practice Partners channel: tell students to
   post their timezone, two windows they are free, and which module they are
   on. For the first handful of buyers, pair them by hand. It is a few emails
   and it tells you whether the board is worth automating.
2. **Pick a coaching lab cadence and stand up a recurring Zoom link.** This is
   now the main thing justifying $3,497 against on-demand competitors, so put
   the first three dates on the page before launch. It is also a permanent
   commitment: phrase it as "while you are enrolled", never as a lifetime
   guarantee of a specific day and time.
3. **Record the eight sessions.** No code needed. Paste an unlisted Vimeo link
   into each module's video field in the builder. Use Vimeo with domain
   privacy, not a Storage upload: `getDownloadURL()` returns a token URL that
   bypasses Storage rules, so an uploaded video plays for anyone the link
   reaches. Until the recordings exist the modules render exactly as they do
   now, so this does not block launch. But the page must not claim
   "pre-recorded video lessons" until they are live.
4. **Re-run curriculum sync** from the builder after reseeding, or `/clc` keeps
   advertising the old module durations. The sales page renders its curriculum
   from the `curriculum` array on the parent course doc, not from the module
   docs.
5. **Diff before reseeding.** `node scripts/inspect-clc.js` first. If any
   lesson body was edited in the builder since the last seed, reseeding
   overwrites it silently.

### One thing to watch

`clc-page.js` merges the Firestore course doc over the static registry, so a
stale field in Firestore silently reinstates old copy on a page whose source
says otherwise. Verify the rendered page, not the file.

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
