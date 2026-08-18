# Build Spec — The Rewrite Method

Target: The One Percent Nation portal (Firebase Hosting / Firestore / Cloud
Functions / Stripe). Companion course to the book *I CAN'T* by Anthony Brown Sr.

This document is the source spec for the course. Where it conflicted with
patterns already in this repo, the repo won — see
[Deviations from the original spec](#deviations-from-the-original-spec) at the
bottom for the list and the reasoning.

---

## 1. What is being built

A gated, drip-released, six-week course called **The Rewrite Method**, added to
the existing course library. Buyers purchase via Stripe, get access via Firebase
Auth, and content unlocks weekly from their enrollment date. Each week has
videos, a downloadable worksheet, and a check-in form. Completing Week 6's
check-in unlocks a bonus module.

Brand: black `#0A0A0A`, red `#E60306`, white. Matches the portal's existing
typography and component system (`styles.css`, `course-player.js`).

Course vocabulary, used in UI copy exactly: *the sentence*, *the handwriting*,
*the draft*, *the new line*, *the pen*, *the Manuscript*. Course completers are
called **Rewriters**. Sub-line: **Six weeks to take back the pen.**

---

## 2. Data model (Firestore)

### `courses/rewrite-method`

The standard course doc every course in this portal uses. Seeded by the
`seedRewriteMethod` callable, editable afterwards from `/manage-courses.html`.

```
{
  slug, title, subtitle, eyebrow, category, status,
  price: 197,            // course only
  bundlePrice: 209,      // course + signed book (see §3)
  bundleLabel, priceNote,
  certificate: false,    // completion is the Rewriter state, not a certificate
  drip: { anchor: 'enrolledAt', intervalDays: 7, weeks: 7, bonusModuleId: 99 },
  ...marketing fields (whatYoullLearn / includes / requirements / curriculum)
}
```

### `courses/rewrite-method/modules/{order}`

One doc per week. Document id is the week number as a string: `0`–`6`, plus
`99` for the bonus module. The id **is** the drip offset — week `N` unlocks at
`enrolledAt + N * 7 days` — which is what lets the security rules enforce the
drip without reading the module body first.

```
{
  order, slug: 'week-1', title, subtitle, duration,
  unlockOffsetDays,
  videoCount,
  worksheetLabel,
  checkin: { prompt, fields: [{ key, label, type, required, ... }] },
  published: true
}
```

Everything here is safe for an entitled member to read at any time — it is the
visible path forward.

### `courses/rewrite-method/modules/{order}/content/main`

The paid payload, and the only thing the drip actually protects:

```
{
  videos: [{ id, title, runtime, provider, providerId, url }],
  worksheet: { label, storagePath, url }
}
```

Read access requires entitlement **and** an unlocked week (§5). Video provider
IDs live only here — never in shipped JavaScript, never on the parent module
doc.

### `users/{uid}/courseState/{courseSlug}`

Per-member drip and check-in state. Server-written only (Admin SDK via
callables); the client can read its own doc and nothing else.

```
{
  courseSlug,
  enrolledAt,          // drip anchor — set at first course open, not purchase
  checkins: { 'week-0': { submittedAt, data: {...} }, ... },
  reviewChoice: 'left_review' | 'opted_out' | null,
  completedAt, isRewriter
}
```

Check-in answers contain personal disclosures (childhood beliefs, family
history). They live only under the member's own document and are never written
to a shared or public collection.

Entitlement itself continues to live where every other course in this portal
keeps it: `users/{uid}.enrolledCourseSlugs`, frozen against self-writes.

---

## 3. Purchase

- Two prices on one course doc: `price` ($197, course only) and `bundlePrice`
  ($209, course + signed book).
- `createCheckoutSession({ slug, bundle, promoCode, refCode })`. The price is
  always read server-side from the course doc; the client sends only the flag.
- `bundle: true` switches to `bundlePrice`, collects a shipping address in
  Stripe Checkout, and records `bundle: true` on the purchase.
- `promoCode` resolves a Stripe promotion code server-side and applies it as a
  discount — this is the book-buyer `?code=` path distributed via the book's QR
  page. An unknown or inactive code falls back to the normal
  "enter a code at checkout" behaviour rather than failing the purchase.
- `checkout.session.completed` → the webhook writes `enrolledCourseSlugs`, the
  purchase record (with bundle flag + shipping address), and sends the purchase
  email.
- `charge.refunded` → the slug is removed from `enrolledCourseSlugs` and the
  purchase is marked `refunded`. Entitlement checks read the array, so access
  dies with the refund.

---

## 4. Drip logic

- **Anchor:** `enrolledAt` is set the first time the buyer opens the course, not
  at purchase. Gift purchases and delayed starts shouldn't burn drip days. The
  course page calls `startCourseDrip` on load; the callable sets the anchor
  server-side, once, and never moves it.
- **Unlock rule:** module `N` unlocks when `now >= enrolledAt + N * 7 days`.
  Week 0 unlocks immediately.
- **Bonus module (99)** unlocks when the Week 6 check-in exists **and**
  `reviewChoice` is set. Either value unlocks it — opting out still unlocks it.
  The review ask is an ask, not a paywall.
- Locked modules render with title, lock state, and unlock date
  ("Unlocks Tuesday, Sep 8"). They are never hidden. The visible path forward is
  part of the product.
- The client computes lock state for the UI. The database enforces it for real
  (§5). UI lock states are cosmetic.

---

## 5. Security rules

- **Entitlement source of truth:** the Stripe webhook. The client never writes
  its own entitlement — `enrolledCourseSlugs` is frozen on self-updates in
  `firestore.rules`.
- `users/{uid}/courseState/{slug}`: readable by self and owner, writable by
  nobody. All mutations go through callables that re-check entitlement and, for
  check-ins, re-check the unlock date server-side. This is what makes
  `enrolledAt` trustworthy enough to gate content on — a self-writable anchor
  could be backdated to unlock the whole course on day one.
- `courses/{slug}/modules/{id}`: entitled members only (already the case for
  every course).
- `courses/{slug}/modules/{id}/content/{doc}`: entitled members **whose drip has
  reached that week**. Bonus content additionally requires `reviewChoice`. This
  is the actual boundary protecting video provider IDs.
- Storage `users/{uid}/checkins/{file}`: owner-only read and write, images
  under 10MB. Worksheets live under `courses/{slug}/attachments/*`, which is
  already signed-in-only.
- Also configure the video provider's own domain restriction (Vimeo privacy:
  embed-only on the portal domain, or Cloudflare Stream signed URLs) when the
  videos are uploaded. Rules protect the ID; the provider protects the stream.

---

## 6. Module content map

| Order | Slug | Title | Videos | Worksheet |
|---|---|---|---|---|
| 0 | `week-0` | Pick Up the Pen | 0.1 Why Reading Alone Doesn't Rewrite Anything (5–7m) · 0.2 Open Your Manuscript (5–7m) | The Manuscript (full workbook) |
| 1 | `week-1` | Find the Sentence | 1.1 Drag It Into the Light (8–10m) · 1.2 The Shrink List (7–9m) · 1.3 Lock Your Sentence (5–6m) | Week 1 — Find the Sentence |
| 2 | `week-2` | Trace the Handwriting | 2.1 Why It Fires Before You Think (6–8m) · 2.2 The Two-Column Log, Demonstrated (7–9m) | Week 2 — Seven-Day Log |
| 3 | `week-3` | Challenge the Draft | 3.1 Put the Sentence on Trial (7–9m) · 3.2 Your Two Minds (6–8m) · 3.3 The Three-Second Window (5–7m) | Week 3 — To Me or For Me |
| 4 | `week-4` | Write the New Line: The System | 4.1 Understanding Is Not Change (7–9m) · 4.2 Shrink It, Anchor It, Mark It (9–11m) · 4.3 Convert the Hours You Already Live (6–8m) | Week 4 — The One Move |
| 5 | `week-5` | Write the New Line: Protect the Manuscript | 5.1 Evict and Replace (7–9m) · 5.2 The Daily Vote (5–7m) · 5.3 The Old Author Will Try to Take the Pen Back (6–8m) | Week 5 — New Line + Comeback Plan |
| 6 | `week-6` | Keep Writing | 6.1 The Five and the Rooms (7–9m) · 6.2 Inputs and the Portable Environment (5–7m) · 6.3 There Is No Final Draft (6–8m) | Week 6 — Environment Audit |
| 99 | `relapse-protocol` | Bonus: The Relapse Protocol | R.1 When the Old Sentence Comes Back (8–10m) | none |

Video provider IDs are added after upload. Modules seed with `providerId: null`
and render a "coming soon" state, so the structure ships before the videos do.
Worksheet PDFs exist for Week 1 and The Manuscript; the rest seed with
`storagePath: null` and the same pattern.

---

## 7. Check-ins

One form per module, rendered from the field definitions on the module doc — not
from hardcoded markup — so copy changes ship as data, not deploys.

| Week | Fields |
|---|---|
| 0 | `commitmentLine` (textarea, required) |
| 1 | `theSentence` (text, required, max 200) — "Your sentence, in one line" |
| 2 | `oldRoadCount` (number, required) + `noticed` (textarea, optional) |
| 3 | `newExpectation` (text, required) — "I am ______" |
| 4 | `markPhoto` (file → Storage, required) |
| 5 | `newLine` (text, required) + `dailyVote` (text, required) |
| 6 | `growersLine` (text, required) + `milestone` (textarea, optional) → review step |

On submit: the callable verifies entitlement and the unlock date, writes to the
member's own `courseState` doc, returns the updated state, and fires the
corresponding email. Week 6 additionally sets `completedAt` and
`isRewriter: true`.

File uploads go to `users/{uid}/checkins/` in Storage, owner-only.

---

## 8. Email events

The portal sends transactional email through SendGrid (see §"Deviations"). The
events wired:

| Event | Trigger |
|---|---|
| `rewrite_purchased` | Stripe webhook, checkout complete. Carries the bundle flag. |
| `rewrite_enrolled` | `enrolledAt` first set |
| `rewrite_week_unlocked` | Daily sweep over members whose next week just opened (`_disabled_rewriteDripEmails`, see below) |
| `rewrite_checkin_{week}` | Each check-in submission |
| `rewrite_midweek_nudge` | Day 3 of Week 2 — "How many times has the old line fired?" |
| `rewrite_completed` | Week 6 check-in submitted; sets `isRewriter: true` |
| `rewrite_review_prompt` | Sent with `rewrite_completed`; mirrors the in-app review step |

Week 6 review step (in-app, after the final check-in): one screen, plain copy.
"If the book earned it, an honest Amazon review is the highest-leverage two
minutes you can give another reader standing where you stood." Two buttons:
"I left a review" / "Not right now." Either choice sets `reviewChoice` and
unlocks the bonus module. The bonus is never gated on the review itself — it is
gated on answering.

---

## 9. Pages and routes

| Surface | Route |
|---|---|
| Public sales page | `/rewrite-method` (and `/course.html?course=rewrite-method`) |
| Gated course home | `/courses.html?course=rewrite-method` |
| Module page | `/courses.html?course=rewrite-method&module={order}` |
| Library card | `/courses.html` — same card component as every other course |

The sales page carries the hero, what-you-get, the six moves as a visual list,
the bundle option with the signed book, an FAQ, and both checkout buttons. It
accepts `?code=` for the book-buyer promotion code.

---

## 10. Definition of done

A test user can buy in Stripe test mode, open the course, see Week 0 unlocked
and Weeks 1–6 locked with dates, download the worksheets that exist, and submit
Week 0's check-in. An unentitled user cannot read any video provider ID — not
from the client, not from a direct Firestore read. The course ships with
`status: 'coming-soon'` so nothing is publicly listed until the content is
uploaded.

---

## Deviations from the original spec

The spec said: where it conflicts with existing patterns in the repo, the repo
wins. It did, in these places.

1. **Email provider — SendGrid, not Loops.** The spec assumed Loops. This portal
   has no Loops integration at all; every transactional email in
   `functions/index.js` goes through SendGrid with a `SENDGRID_API_KEY` secret.
   The events are wired to SendGrid instead. The consequence: there is no
   Loops-side drip scheduler to lean on, so `rewrite_week_unlocked` and
   `rewrite_midweek_nudge` are a daily `onSchedule` sweep rather than
   "zero infra". That sweep ships **not exported**, as
   `_disabled_rewriteDripEmails`, matching `_disabled_taskReminders` and
   `_disabled_appointmentReminders`: the CI deploy service account lacks
   Cloud Scheduler Admin (`cloudscheduler.jobs.update`), so exporting any
   `onSchedule` function fails the deploy outright. Grant that role and rename
   it to `exports.rewriteDripEmails` to turn the emails on. Unlocking itself
   does not depend on it — the drip is date math evaluated on read, not a cron
   job. Only the nudge emails wait.

2. **Enrollment shape — `enrolledCourseSlugs`, not `users/{uid}/enrollments/*`.**
   The portal's single source of truth for course access is an array on the user
   doc, frozen against self-writes and read by `isEnrolledIn()` in
   `firestore.rules`. Creating a parallel enrollments collection would have left
   two answers to "does this person have access". Course-specific state that the
   array can't hold (drip anchor, check-ins, review choice) went into
   `users/{uid}/courseState/{slug}` instead.

3. **Stripe prices — dynamic `price_data`, not stored price IDs.**
   `createCheckoutSession` builds line items from the dollar amount on the
   course doc. Keeping `priceIds` on the course doc would have meant a second,
   conflicting pricing path. The bundle is a second amount on the same doc.

4. **Routes — query params, not path segments.** Firebase Hosting rewrites
   everything to `/index.html`, and the portal addresses courses as
   `/courses.html?course={slug}`. `/rewrite-method` exists as a real page file
   for the marketing link, and renders the same landing page component.

5. **Check-in writes go through a callable, not straight from the client.** The
   spec had the client write to Firestore on submit. Because the drip anchor and
   `isRewriter` have to be untrusted-client-proof, `courseState` is server-write
   only and `submitCourseCheckin` re-verifies entitlement and the unlock date
   before writing.

6. **Seeding is an admin callable, not a script.** The repo has no local seed
   tooling or service-account workflow; admin-only callables
   (`backfillChannelDefaults`, `syncCoupon`) are how one-off data writes are
   done here. `seedRewriteMethod` follows that pattern and is idempotent.

7. **No new top-level collections.** Everything lands under existing ones:
   `courses/*` and `users/*`.
