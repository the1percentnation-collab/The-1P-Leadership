# One Percent Nation Portal — Full-System Security Audit & Hardening

**Date:** 2026-07-11
**Scope:** Marketing site + paid member portal. Netlify/Firebase Hosting, Firebase Auth + Firestore + Storage + Cloud Functions (v2), Stripe payments.
**Branch:** `claude/1pn-portal-security-audit-xfm53h`
**Method:** Static code review of the entire repo (rules, Cloud Functions, all client JS/HTML), plus executable Firestore **rules unit tests** run against the Firebase emulator (30/30 passing).

---

## 1. Executive Summary

**Overall grade: C‑ (before) → B+ (after this pass).**

The backend architecture is fundamentally sound: Stripe prices are looked up server-side, the webhook verifies signatures and is idempotent, entitlements are written only by the Admin SDK and **frozen** against client self-writes, and most Cloud Functions authorize the caller against the specific resource. That foundation is better than most products at this price point.

Two findings, however, were **CRITICAL** and undermined the paywall and user safety:

1. **The entire paid course catalog was world-readable.** `courses/{slug}/modules` was `allow read: if true`, so anyone — signed in or not — could pull every lesson's body text, video URLs, and downloadable attachment URLs straight from the Firestore SDK. The enrollment "gate" was purely cosmetic UI. **Fixed** (rules now require enrollment; verified by unit test).
2. **Stored XSS via avatar URL.** Any member could set their profile `avatarUrl` to an HTML-breaking string and run script in every other member's browser (including admins/owner) the moment they loaded the feed. **Fixed** (output now escaped).

One **HIGH** (an unauthenticated, unsigned webhook allowing cross-tenant data injection) and several **MEDIUM** issues were also fixed. Remaining items — email-verification enforcement, App Check, dependency upgrades, signed media URLs — require operations/console work or larger refactors and are documented with step-by-step plans in §4.

**What changed in this pass (7 files):**

| File | Change |
|---|---|
| `firestore.rules` | Gate `courses/{slug}/modules` reads to admins + enrolled users |
| `storage.rules` | Gate course video/attachment reads to admins + enrolled users |
| `public/js/community.js`, `public/js/topbar.js` | Escape avatar URL to close stored XSS |
| `functions/index.js` | SendGrid webhook fails closed on missing/invalid signature; rate-limit 6 abuse-prone callables; stop leaking emails in leaderboard/member search |
| `firebase.json` | Add Content-Security-Policy header |
| `public/js/auth.js` | Send email-verification mail on signup |
| `tests/` (new) | 30 Firestore rules unit tests (emulator) |

---

## 2. Phase 0 — System Inventory (map)

**Hosting/build:** Static site under `public/` served by Firebase Hosting; `firebase.json` rewrites **all** routes to `/index.html`. There is **no server-side rendering or route gating** — every `.html`/`.js` is world-fetchable. The real security boundary is Firestore/Storage rules + Cloud Function auth. (This is normal for this architecture, but it means client JS must never be the only gate for anything paid or private.)

**Pages (46 HTML):** public marketing (`index.html`, `book.html`, `webinar.html`, `terms.html`, `privacy.html`, `affiliate.html`, `contact.html`, `upcoming.html`, `events.html`); auth (`login.html`, `signup.html`, `onboarding.html`, `invite.html`); member portal (`dashboard.html`, `courses.html`, `community.html`, `profile.html`, `goal-planning.html`, `resources.html`, `calendar.html`); admin/owner (`admin.html`, `owner.html`, `manage-courses.html`, `manage-products.html`, `manage-affiliates.html`, `members.html`, `campaigns.html`, `crm*.html`, `chatbot-kb.html`, `bug-reports.html`).

**Firebase services:** Auth (email/password + Google), Firestore (primary datastore), Storage (avatars, course media, post/event images, bug screenshots), Cloud Functions v2 (`functions/index.js`, ~4,200 lines, ~40 callables + triggers + webhooks). App Check is **wired but disabled** (empty reCAPTCHA key).

**Stripe touchpoints:** `createCheckoutSession` (server-side price lookup from `courses/{slug}`), `stripeWebhook` (`checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`), `syncCoupon` (mirrors coupons → Stripe promo codes). Entitlement = `users/{uid}.enrolledCourseSlugs`, written only by the webhook / `enrollFree` (Admin SDK).

**Secrets:** Firebase **web** API key is in `public/js/firebase.js` — this is public by design (client-safe). No Stripe secret key, service-account JSON, or webhook secret is committed (verified across repo **and full git history**). Server secrets live in Functions env/Secret Manager: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SENDGRID_*`, `TWILIO_*`, Anthropic key.

**Third-party (browser):** Firebase SDK 10.12 (gstatic), Google Fonts, Google Tag Manager/GA4, Quill 2.0.2 (jsdelivr), DOMPurify. Functions deps: `firebase-admin`, `firebase-functions`, `stripe`, `@sendgrid/mail`, `twilio`, `@anthropic-ai/sdk`.

**Firestore data model (who writes):**
- `users/{uid}` — self-writable except privilege fields (`role`, `tier`, `companyId`, `enrolledCourseSlugs`, `stats*`) which are server-only/frozen. Subcollections `progress`, `capstone` (self-private), `purchases`/`registrations`/`courseInterests`/`stats`/`notifications` (server-written).
- `companies/{cid}` — owner/company-admin scoped; subcollections `invites`, `members`, `contacts`(+`notes`,`activities`), `pipelines`, `opportunities`, `tasks`, `appointments`, `conversations`(+`messages`), `campaigns`(+`events`).
- `courses/{slug}` (public doc) + `modules` (**now enrollment-gated**).
- `posts`(+`comments`,`likes`), `channels`, `events`(+`registrations`), `products`(+`interests`,`preorders`), `coupons`, `affiliates`(+`referrals`).
- Server-only: `communityInvites`, `chatbotKnowledge`, `rateLimits`, `bugReports`, `courseSuggestions`, `stripeEvents`, `stripeSubscriptions`.

---

## 3. Findings & Fixes (Phase 1 Security Audit)

### CRITICAL

**C1 — Paid course content world-readable (paywall bypass).** `firestore.rules` had `courses/{slug}/modules` as `allow read: if true`. The module docs hold the actual paid payload (lesson `html`, `videoUrl`, uploaded `videoFile.url`, and `attachments[].url`), and the Firebase Storage download URLs embedded there carry access tokens that work regardless of Storage rules. Anyone could enumerate the full curriculum unauthenticated via the SDK/REST API; enrollment was checked only in client JS (`courses-page.js:517`).
**Fix:** `courses/{slug}/modules` reads now require `isAnyAdmin() || isEnrolledIn(slug)`, where `isEnrolledIn` reads the caller's server-frozen `enrolledCourseSlugs`. Storage `courses/{slug}/videos` and `/attachments` reads now require `isCourseAdmin() || isEnrolledInCourse(slug)`. The public course **doc** (marketing metadata) stays readable. Safe because the client only ever loads modules for enrolled users or an admin in preview mode. **Verified:** rules unit tests confirm unauth + non-enrolled reads fail, enrolled + admin + owner reads succeed.
Files: `firestore.rules`, `storage.rules`.

**C2 — Stored XSS via avatar URL.** `avatarHtml()` in `community.js:639` and `topbar.js:108` interpolated the user-controlled `avatarUrl` into `<img src="...">` without escaping. `firestore.rules` lets a user write any string to their own `avatarUrl`, so `x" onerror="…"` executes in the session of every member who renders the feed, member directory, profile, search, or notifications — including admins/owner. (`hub.js:307` already escaped it, confirming the omission was a bug.)
**Fix:** wrap the URL in the existing `escapeHtml()` in both files.
Files: `public/js/community.js`, `public/js/topbar.js`.

### HIGH

**H1 — `sendgridEventWebhook` unsigned-by-default + cross-tenant IDOR.** Signature verification ran only if `SENDGRID_WEBHOOK_KEY` was set; unset → it processed the body anyway. The handler trusts `companyId`/`campaignId`/`contactId` from each payload element and writes into `companies/*/campaigns/*/events`, increments campaign counters, and appends `contacts/*/activities`. Anyone on the internet could forge analytics or inject activity rows into any tenant.
**Fix:** verification is now mandatory and **fails closed** — 503 if the key is unset, 403 on an invalid signature. (The two Twilio webhooks already failed closed.) Files: `functions/index.js`.

**H2 — No email-verification enforcement.** No `sendEmailVerification` anywhere; a user could sign up with an address they don't own and get full portal access.
**Partial fix:** signup now sends a verification email (`auth.js`). Hard enforcement (blocking sensitive actions until `emailVerified`) is intentionally **not** switched on yet because it would lock out existing pre-verification accounts — staged rollout plan in §4.

**H3 — Flagship course content shipped in a public static file.** The legacy `1p-clc` course renders from `public/js/modules.js` (hardcoded lesson HTML), which Firebase Hosting serves to anyone (`curl .../js/modules.js`). The C1 rules fix does **not** cover this course because it doesn't read from Firestore. Requires migrating that content into gated `courses/1p-clc/modules` docs — plan in §4.

### MEDIUM (fixed)

**M1 — No Content-Security-Policy.** `firebase.json` had good headers (HSTS, X-Frame-Options, nosniff, Referrer-Policy) but no CSP.
**Fix:** added a CSP restricting `script-src`/`connect-src`/`frame-src`/etc. to the known hosts (gstatic, googletagmanager, jsdelivr, Firebase/Google APIs, YouTube/Vimeo/Loom for lesson embeds). `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`. **Tradeoff:** the site has many inline `<script>`/`<style>` blocks, so `'unsafe-inline'` is required for now — the CSP still blocks unknown external script origins and data exfil endpoints, which meaningfully raises the bar. Removing `'unsafe-inline'` (nonces/hashes) is a follow-up in §4.

**M2 — Rate-limit gaps on abuse-prone callables.** `registerForEvent`, `registerProductInterest`, `joinEarlyAccess` (all **unauthenticated**, each creates CRM contacts/activities), `searchMembers`/`searchPosts` (read up to 500/200 docs per call), and `shareEventToContacts` (bulk email) had no throttle.
**Fix:** added `rateLimitCaller` to all six (public writes 20/10min by uid+IP, searches 60/min, bulk email 10/hr). Files: `functions/index.js`.

**M3 — Email addresses leaked to members.** `getLeaderboard` and `searchMembers` projected `displayName || email`, returning raw emails for any member without a display name — contradicting the code's own stated intent to avoid leaking emails.
**Fix:** fallback changed to a neutral `'Member'` label. Files: `functions/index.js`.

### MEDIUM (documented, not code-fixable here — see §4)

- **M4 — App Check disabled** (`firebase.js` empty reCAPTCHA key): callables/Firestore have no bot-attestation, so rules are the *only* enforcement. Console + key config.
- **M5 — Account enumeration:** login/reset surface raw Firebase errors (`login.html:251/276`), distinguishing registered vs unknown emails. Mitigated by enabling **Email Enumeration Protection** in the Firebase console + generic client messages.
- **M6 — Session expiry is client-side only** (`session.js`): idle/absolute timeouts sign out the UI but don't revoke the refresh token server-side; a held token keeps minting IDs. Needs server-side session controls / token revocation.

### LOW

- **L1 — Firestore path-traversal via unsanitized client IDs — FIXED.** Client strings used in `.doc()` paths (`contactId`, `token`, `code`, `eventId`, `productId`, `slug`) were passed through without rejecting `/` or Firestore-reserved patterns. Added a `safeId()` helper (`functions/index.js`) that trims and rejects values containing `/`, `.`/`..`, `__…__`, or over-length, and applied it at every affected callable (deleteContact, sendContactEmail, sendSms, registerForEvent, shareEventToContacts, acceptCommunityInvite, syncCoupon, markAffiliatePaid, registerProductInterest, notifyProductInterest, registerCourseInterest, createCheckoutSession, enrollFree). Empty is allowed through so existing "required" checks and messages are unchanged. (`acceptInvite`'s `code` is used in a `where()` query, not a path, so it needs no change.) Logic verified in isolation.

### LOW (documented)
- **L2 — Indirect prompt injection** into `courseAdvisorChat`: community post text is injected into the system prompt and output is parsed for a `PROFILE_UPDATE{}` signal. Bounded — writes go only to the requester's own doc and only to a field allowlist — but worth monitoring.
- **L3 — Rate limiter fails open** on infra error (`enforceRateLimit`): an attacker who can induce Firestore contention on the `rateLimits` doc bypasses throttles. Documented design choice.
- **L4 — `onboarding-guard` / `app.js` fail open** if Firebase init fails. Low impact given content is otherwise gated.
- **L5 — Dependency CVEs** (see §3.1).

### 3.1 Dependency audit (`npm audit`, functions)

10 advisories, all **transitive through `firebase-admin@^12.3.0`**: 1 high (`form-data` CRLF injection), 9 moderate (`uuid` bounds check, `gaxios`/`google-gax`/`retry-request`/`teeny-request`). None is directly reachable by app-controlled input (the app doesn't expose attacker-controlled multipart field names), so exploitability here is low — but the fix is straightforward: upgrade `firebase-admin` and `firebase-functions`. Not done in this pass because it can't be verified without a deploy (major-version bump risk) — plan in §4.

### 3.2 Confirmed SAFE (reviewed, no change needed)

- **Stripe path:** price read server-side from `courses/{slug}` (client sends only `slug`); webhook signature-verified + idempotent (`stripeEvents`); subscription cancel/`invoice.payment_failed` revoke/flag access; affiliate rate locked into session metadata at purchase time; self-referral rejected.
- **Entitlement freeze:** `users` create/update rules freeze `role`/`tier`/`companyId`/`enrolledCourseSlugs`/`stats*` — **verified** a user cannot self-escalate to admin or self-grant a course (unit tests).
- **`bootstrapOwner`:** rejects unless caller's token email == owner email — not exploitable by arbitrary users.
- **`deleteUser`, `deleteContact`, `sendContactEmail`, `sendCampaign`, `sendSms`:** authorize the caller against the target company before acting (no IDOR).
- **Twilio webhooks:** signature-verified, fail closed.
- **UGC rendering** (posts, comments, profile, CRM notes, chatbot, course content): escaped via `escapeHtml`/`linkify`/`textContent`/`DOMPurify`. Avatar (C2) was the sole gap.

---

## 4. Remaining Items & Remediation Plans

**R1 — Migrate `1p-clc` content out of the public static file (H3). 🟡 SCAFFOLDING SHIPPED / you run it (1af2e1d).** `scripts/extract-1pclc.js` (browser), `scripts/migrate-1pclc.js` (Admin SDK, dry-run default), and `scripts/README-1pclc-migration.md` (cutover order) are ready. The cutover is a DATA change — set `courses/1p-clc.contentSource='firestore'` (a flag already honored by `loadModulesMeta`) after migrating — so no live-code flip is needed until the final `modules.js` cleanup. *(M effort — needs your browser session + live DB; nothing flips until you verify.)*
The `1p-clc` lessons in `public/js/modules.js` are **not** static HTML — they are 7 JavaScript `render()` functions with ~19 calls to per-user runtime state (`store.isComplete`, `getNotes`, completion banners, notes textareas) woven into the lesson body. Extracting clean content requires executing them in a logged-in browser session, and the target data must be written to the live Firestore DB (no repo-only path). The generic course player also uses a different notes/completion model, so this is a content + UX reauthoring job. Recommended steps:
1. In a browser session as an admin, stub `store`/`getNotes` to no-ops and capture each `render()` output; strip the injected notes/completion chrome to leave pure lesson HTML.
2. Write the cleaned HTML into `courses/1p-clc/modules/{n}` docs via the course builder (which already writes this shape) or a one-off Admin SDK script.
3. Only after verifying enrolled users can read the migrated course, point the `1p-clc` renderer at `loadModuleDocs` (remove the `modules.js` special-case in `courses-data.js:112`) and delete the lesson bodies from `modules.js`. The C1 gate then protects it automatically.
Do **not** rewire the renderer before the data exists in Firestore — that white-screens the live $497 course.

**R2 — Signed, expiring media URLs (defense-in-depth for C1).** *(M)* The rules fix stops enumeration, but a Storage download URL already leaked keeps working (token in URL). For true protection, mint short-lived signed URLs from a Cloud Function after an enrollment check and stop persisting long-lived tokened URLs in Firestore. Rotate existing tokens.

**R3 — Enforce email verification (H2). ✅ DONE (fc100dd).** Verification email sent on signup; non-blocking dismissible banner on authed pages with resend; server-side `email_verified` gate on `createCheckoutSession` and on the `posts`/`comments` create rules (verified via rules tests). Login and existing entitlement access are NOT gated, so no existing user is stranded.

**R4 — Enable App Check (M4). 🟡 CODE DONE / BLOCKED ON YOU (35893f6).** Init is a safe no-op and the enablement runbook is now in `firebase.js` (ordered callable-enforcement list). Remaining (yours): register the web app with reCAPTCHA v3, paste `RECAPTCHA_V3_SITE_KEY`, confirm verified traffic in the console, THEN flip `enforceAppCheck:true` (payments → invites → AI → bulk email). Not enabled in code because flipping before tokens flow rejects every call.

**R5 — Console hardening (M5). 🟡 CODE DONE / one console step is yours (a43c5e4).** Auth error messages normalized via `public/js/auth-errors.js` (no user-not-found vs wrong-password leak; reset always shows a neutral message). Remaining (yours): enable **Authentication → Settings → Email Enumeration Protection** in the console.

**R6 — Dependency upgrades (L5). 🟡 CODE DONE / deploy-test is yours (4ad0064).** `firebase-admin` 12→13.10, `firebase-functions` 5→7.2.5 (admin 14 not yet supported by functions 7). A non-breaking `npm audit fix` cleared the HIGH `form-data` CVE; `index.js` loads all 46 handlers under v7. 9 moderate `uuid` advisories remain deep in Google's client libs (only "fixable" by forcing admin→10, breaking) — accepted low risk. Remaining (yours): deploy to a preview channel and smoke-test before promoting:
```
cd functions && firebase hosting:channel:deploy preview --expires 7d   # + functions deploy to a test project
# Smoke: a test checkout, `stripe trigger checkout.session.completed`, one courseAdvisorChat call, one campaign email.
```

**R7 — Tighten CSP (M1 follow-up). ✅ DONE.** `'unsafe-inline'` has been removed from the enforcing `script-src`. **Architecture note:** Firebase Hosting serves static files with static headers, so per-request nonces aren't possible — the fix was to externalize all inline JS instead. Work done: the shared GA4 snippet → `public/js/ga.js` (34 pages); every per-page inline `<script>`/module bootstrap → `public/js/page-*.js` / `home.js` / `page-goal-planning.js` / `page-webinar.js`; all 40 inline event handlers (`onclick`/`oninput`) converted to `data-action`/`addEventListener`. Result: **zero** inline `<script>` blocks and zero inline handlers across `public/*.html`. Verified in Chromium under the strict policy — all 18 representative pages loaded with **0 `script-src` violations** — then the enforcing header was flipped and the report-only header removed. `style-src 'unsafe-inline'` is intentionally kept (inline styles are pervasive; separate follow-up).

**R8 — Validate client-supplied IDs (L1) — DONE.** `safeId()` added and applied across all affected callables (see L1 above).

**R9 — Server-side session controls (M6). 🟡 LOW-RISK PART DONE (cde3dee).** Added a `revokeMySessions` callable (`admin.auth().revokeRefreshTokens`) + a "Sign out all devices" button in the profile; the session guard's 10-min refresh loop then bounces open tabs. Deferred (flagged, not done — needs Identity Platform console settings and risks mass logout): shorter global refresh-token TTL and automatic forced re-auth for owner/admin.

---

## 5. Phases 2–5 — Notes (audit-level, not exhaustively fixed)

These phases were reviewed at the code level; the security-critical items above were prioritized for fixes. Key observations:

**Phase 2 (Functionality):** Purchase → entitlement → access works (webhook-driven, with a client-side retry loop polling for enrollment after `?purchase=success`). Failure paths return typed `HttpsError`s with user messages. Course progress persists in `users/{uid}/progress` (self-private). **Gap:** no automated end-to-end test coverage exists; recommend Playwright smoke tests for the signup→purchase→access and password-reset journeys.

**Phase 3 (Data model):** Entitlement has a single source of truth (`enrolledCourseSlugs`, server-written). Idempotency is handled for Stripe (`stripeEvents`). **Watch:** `enrolledCourseSlugs`, `adminUids`, and `mentionedUids` are unbounded-ish arrays — `mentionedUids` is capped at 10 (good); `enrolledCourseSlugs`/`adminUids` grow slowly and are fine at expected scale. Search callables read up to 500 docs — now rate-limited, but at 10k+ members consider a real search index (Algolia/Typesense) to avoid read-amplification cost.

**Phase 4 (Performance):** `public/index.html` is ~978 KB (largely inline base64 images) and `styles.css` is ~217 KB — both hurt first-load. Recommend extracting base64 assets to files, and code-splitting the portal JS. No blocking security impact.

**Phase 5 (Feature gaps, prioritized):** Legal pages (terms, privacy) exist and should be linked from checkout/footer. Highest-leverage gaps for a premium coaching product: (S) welcome/onboarding email sequence and abandoned-checkout recovery; (M) completion certificates + streak/accountability mechanics; (M) admin content publishing without deploys (partially present via `manage-courses`); (M) curriculum/book search; (S) analytics event coverage beyond GA4 pageviews.

---

## 6. Recurring Maintenance Checklist

- **Monthly:** `cd functions && npm audit`; review/upgrade deps; re-run the rules tests (`cd tests && npm test`).
- **On every rules change:** run `cd tests && npm test` before deploy — 30 tests must pass (they encode the paywall + privilege-freeze contract).
- **Weekly:** check the Stripe webhook dashboard for failed deliveries; confirm `stripeEvents` is being written (idempotency healthy).
- **Quarterly:** rotate Storage media tokens / re-mint signed URLs; review `adminUids` on every company; audit `affiliates` payout ledger.
- **On new Cloud Function:** confirm it (a) authenticates, (b) authorizes against the specific resource, (c) rate-limits if expensive/public, (d) validates client IDs used in paths.
- **Ongoing:** keep App Check enforcement on; monitor Functions logs for `[rateLimit] failing open` and webhook signature failures.

---

## 7. How to run the rules tests

```bash
cd tests
npm install
npm test        # firebase emulators:exec --only firestore ... mocha
```
Result on this branch: **30 passing.** The `courses / modules (paid content gate)` suite is the regression guard for the CRITICAL C1 fix.
