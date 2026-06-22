# Phase 0 Implementation Plan — Finish the Foundation

Builds directly on the company-courses feature (PR #40). Goal: every course
persists progress, learning paths are ordered with prerequisites, certificates
are publicly verifiable, the owner can manage the seat/renewal lifecycle, and CI
can verify all of it.

---

## 1. `icant` progress persistence  [idea 3]

**Problem.** `public/js/icant-course.js` persists only to localStorage
(`STORAGE_KEY = 'icant-course-v1'`, `state.completed` keyed by module id 1–8,
written at the "mark complete" handler ~line 723). It never writes Firestore, so
icant can't appear on rosters or earn a certificate.

**Key design decision — id collision.** Code courses currently share
`users/{uid}/progress/{id}` with **bare integer** ids. 1P-CLC uses ids 0–6 and
icant uses 1–8 → they would overlap. So icant must use the **namespaced** scheme
`users/{uid}/progress/icant__m{id}` (same shape firestore-rendered courses use),
NOT bare integers.

**Changes.**
- `public/js/icant-course.js`: import `auth, db, firebaseReady` + Firestore fns;
  on load, hydrate `state.completed` from Firestore progress docs with prefix
  `icant__m`; on complete, `setDoc(users/{uid}/progress/icant__m{id}, {completed:true,
  completedAt, courseSlug:'icant', moduleId:id}, {merge:true})`. Mirror a member
  digest (`completedCount`) to `companies/{cid}/members/{uid}` like
  `store._mirrorMemberDigest` (extract that helper or copy the pattern).
- `functions/index.js` — `onCertificateProgress`: generalize module-count +
  completion resolution so a `{slug}__m{n}` id whose slug is in
  `CODE_COURSE_MODULE_COUNTS` (e.g. `icant`) is counted via that map and the
  `{slug}__m` prefix — not via `courses/{slug}/modules` (which is empty for code
  courses). i.e. `totalModulesForCourse` checks `CODE_COURSE_MODULE_COUNTS[slug]`
  first regardless of id scheme; `countCompletedForCourse` counts by `{slug}__m`
  prefix for namespaced ids and bare integers (defaulting to `1p-clc`) for the
  legacy scheme.

*Verify:* complete all 8 icant modules for a test uid → roster `completedCount`
updates and one `users/{uid}/certificates/icant` doc is created.

## 2. Learning paths / sequencing & prerequisites  [idea 1]

**Reuse what exists.** `companies/{cid}.assignedCourseSlugs` is already an ordered
array, and `tracks.js` track `slugs` are ordered. Treat array order as the path.

**Changes.**
- `public/js/tracks.js`: per-track order is already the slug order — no schema
  change needed. Optionally add `prereqs: { [slug]: [slug,...] }` per track for
  non-linear gates; default is "previous course in the path."
- `public/js/courses-data.js`: add `courseCompletion(slug)` helper returning
  `{done, total, complete}` by reusing `loadCourseProgress` (firestore courses),
  the cert doc, and `CODE_MODULE_META` counts for code courses.
- `public/js/courses-page.js`: in the library/roadmap render, for company-assigned
  courses compute "next up" (first incomplete course whose prereqs are complete)
  and **lock** cards whose prereqs aren't met (disabled CTA + tooltip). Surface a
  "Your path" strip ordered by `assignedCourseSlugs`.
- `public/admin.html`/`admin.js`: in the roadmap review step, allow drag/reorder of
  the selected slugs (order = path order) before calling `assignCompanyCourses`.

*Verify:* a member sees courses in path order; a later course is locked until the
prerequisite shows complete.

## 3. Certificate verification page  [idea 4]

**Changes.**
- `functions/index.js` — `onCertificateProgress`: generate a `verifyCode`
  (`crypto.randomBytes`/`randomUUID`), store it on
  `users/{uid}/certificates/{slug}.verifyCode`, and write a public lookup doc
  `certificateVerifications/{verifyCode}` = `{ uid, slug, courseTitle, displayName,
  issuedAt }` (Admin SDK). Add the code + a `${APP_BASE_URL}/verify?cert={code}`
  line to `certificatePdfBuffer`.
- `firestore.rules`: new top-level block —
  `match /certificateVerifications/{code} { allow read: if true; allow write: if false; }`.
- New `public/verify.html` + `public/js/verify.js`: read the param, fetch the
  lookup doc, render name/course/date + a "Valid certificate" badge (or "not
  found"). `firebase.json` `cleanUrls` already maps `/verify` → `verify.html`.

*Verify:* open a cert PDF, visit its `/verify?cert=...` URL, see a valid badge;
a bogus code shows "not found."

## 4. Renewal & seat lifecycle  [idea 5]

**Changes.**
- `functions/index.js`:
  - `setCompanyAccess({ companyId, active })` callable (owner-only) —
    `active:false` strips `companyCourseSlugs` from each member's
    `enrolledCourseSlugs` (preserving personal purchases, same logic as
    `revokeMember`) and sets `companies/{cid}.plan.status='suspended'`;
    `active:true` re-applies via the existing `assignCompanyCourses` enroll path.
    Reversible.
  - `stripeWebhook`: extend the `invoice.payment_failed` branch to handle
    company-flat subscriptions → email owner + company admins a dunning notice
    (SendGrid) and set `plan.status='past_due'`. (`customer.subscription.deleted`
    already sets `canceled`; add the email there too.)
- `public/owner.html`/`owner.js`: show `plan.status` in the Plan column; add a
  Suspend/Resume button calling `setCompanyAccess`.
- Decision (documented): a billing lapse does **not** auto-revoke access; the owner
  decides via Suspend.

*Verify:* suspend a company → members lose company courses but keep purchased
ones; resume → access returns; simulated `payment_failed` sends a dunning email
and flips status.

## 5. Test coverage + CI  [idea 18]

**Changes.**
- `functions/package.json`: dev-deps `@firebase/rules-unit-testing`, `firebase-tools`,
  a test runner (node's built-in `node:test`), + `"test"` and `"emulate"` scripts.
- `functions/test/rules.test.js`: assert a non-owner self-write of
  `enrolledCourseSlugs`/`companyCourseSlugs`/`plan` is denied; admin can write
  `assignedCourseSlugs` but not `plan`; cert read scoping (self/owner/company-admin);
  `certificateVerifications` is publicly readable, not writable.
- `functions/test/callables.test.js` (Firestore + Storage + Functions emulators):
  `assignCompanyCourses` enrolls members + preserves personal purchases on removal;
  `revokeMember` frees a seat + strips only company courses; `onCertificateProgress`
  produces a cert doc + Storage object + verification doc, idempotently.
- `.github/workflows/ci.yml`: matrix on Node 20; `node --check` all JS; `npm ci` in
  `functions/`; run emulator tests (`firebase emulators:exec`). Java is required
  for the emulators (provision in the workflow).
- Optionally add a `SessionStart` hook (see the `session-start-hook` skill) so web
  sessions can run the suite.

*Verify:* `npm test` in `functions/` passes locally under the emulator; CI is green
on the PR.

---

## File-touch summary
- `public/js/icant-course.js` — Firestore progress + member digest
- `functions/index.js` — trigger generalization, `verifyCode` + verification doc,
  `setCompanyAccess`, dunning emails
- `public/js/courses-data.js`, `courses-page.js` — path order, "next up", gating
- `public/js/tracks.js` — optional `prereqs`
- `public/admin.html`/`admin.js` — reorderable path
- `public/owner.html`/`owner.js` — plan status + Suspend/Resume
- `public/verify.html` + `public/js/verify.js` — new public verification page
- `firestore.rules` — `certificateVerifications` block
- `functions/package.json`, `functions/test/*`, `.github/workflows/ci.yml` — tests + CI

## Suggested execution order
1. Tests + CI scaffold (so the rest is verifiable) → 2. icant persistence →
3. trigger generalization + verification page → 4. learning paths →
5. renewal/lifecycle.
