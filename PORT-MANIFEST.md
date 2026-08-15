# Port Manifest — Rebuilding This Platform Under a New Brand

This document is a complete, self-contained recipe for standing up everything in
`The-1P-Leadership` as a new repository for a different brand, **with all
functionality intact**.

**Target brand: Kailey Brown — `kaileybrown.com`.** Minimal black and white
with subtle pops of red; Audrey for display. Concrete values are in §1; the
document stays token-based (`{{BRAND_NAME}}`, `{{DOMAIN}}`, …) below that, so
it remains reusable for a future brand.

It is a *port manifest*, not an architecture essay: it tells you which files to
copy, which to edit, which to gut and refill, and — critically — which
invariants will silently break the app if you "clean them up" on the way past.

**Scope of the source:** 123 tracked files. 39 HTML pages, 55 client ES modules,
a 9,821-line stylesheet, a 4,621-line Cloud Functions file exporting 52
functions, an 859-line Firestore ruleset, Storage rules, 19 composite indexes,
3 CI workflows, and live Stripe / SendGrid / Twilio / Anthropic integrations.

---

## Table of contents

1. [Brand Config — the only thing you edit](#1-brand-config)
2. [What you are building](#2-what-you-are-building)
3. [Phase 0 — Create the Firebase project](#3-phase-0--create-the-firebase-project)
4. [Phase 1 — File manifest](#4-phase-1--file-manifest)
5. [Phase 2 — The substitution pass](#5-phase-2--the-substitution-pass)
6. [Phase 3 — Content replacement](#6-phase-3--content-replacement)
7. [Phase 4 — External services and secrets](#7-phase-4--external-services-and-secrets)
8. [Phase 5 — Reference: data model, functions, authorization](#8-phase-5--reference)
9. [Phase 6 — First deploy and smoke test](#9-phase-6--first-deploy-and-smoke-test)
10. [Invariants you must not break](#10-invariants-you-must-not-break)

---

## 1. Brand Config

Target brand: **Kailey Brown** — `kaileybrown.com`. Minimal black and white
with subtle pops of red.

Every instruction later in this document refers to these tokens.

| Token | Value | Replaces (current) | Reach |
|---|---|---|---|
| `{{BRAND_NAME}}` | **Kailey Brown** | `The One Percent Nation` | 51 files |
| `{{BRAND_ACADEMY}}` | **Kailey Brown Academy** | `The One Percent Academy` | portal `<title>`s, AI prompts |
| `{{BRAND_SHORT}}` | **KB** | `1P` / `1PN` / `OPN` | monograms, CSS prefix, storage keys |
| `{{DOMAIN}}` | **kaileybrown.com** | `the1pnation.com` | 32 files |
| `{{FIREBASE_PROJECT_ID}}` | **kailey-brown** | `the-1p-leadership` | 10 files |
| `{{OWNER_EMAIL}}` | ⚠️ **TBD** — see below | `the1percentnation@gmail.com` | 5 files |
| `{{GA4_ID}}` | *create a new GA4 property* | `G-RBH536HRZE` | 36 files |
| `{{CI_SECRET_NAME}}` | **`FIREBASE_SERVICE_ACCOUNT_KAILEY_BROWN`** | `FIREBASE_SERVICE_ACCOUNT_THE_1P_LEADERSHIP` | 3 workflows |
| `{{ACCENT}}` | **`#C8102E`** | `#E60306` | 4 token blocks, SVG, email HTML |
| `{{ACCENT_DARK}}` | **`#9E0C24`** | `#B30205` | token blocks |
| `{{FONT_DISPLAY}}` | **Audrey** (self-hosted — see §1.1) | `Bebas Neue` | every page `<head>` + 4 `:root` blocks |
| `{{FONT_BODY}}` | **Jost** (Google Fonts) | `Outfit` | same |
| `{{FONT_MONO}}` | **Space Mono** (unchanged) | `Space Mono` | same |
| `{{CERT_SIGNER_NAME}}` | **Kailey Brown** | `Anthony Brown` | `public/js/certificate.js:18` |
| `{{CERT_SIGNER_TITLE}}` | **Founder, Kailey Brown** | `Founder, The One Percent Nation` | `public/js/certificate.js:19` |
| `{{CERT_PREFIX}}` | **`KB-`** | `1P-` | `public/js/certificate.js:76` |
| `{{INSTRUCTOR_*}}` | Kailey Brown + title + bio | Anthony Brown | `public/js/course-landing.js:20–24` |
| `{{FLAGSHIP_SLUG}}` | *your first course slug* | `1p-clc` | Firestore doc IDs — see §6 |

*Reach counts are file counts in the source repo, excluding this manifest.*

> ⚠️ **`{{OWNER_EMAIL}}` is the one value still outstanding.** It is not
> cosmetic — it is the hard gate that grants owner rights (§8.3), and it is
> also the From/Reply-To on every system email. Pick it before Phase 0, and
> prefer a domain address (`hello@kaileybrown.com`) over a personal Gmail:
> SendGrid sender verification on your own domain gives far better
> deliverability, and the address is visible on every outbound email.

Seven more values **cannot be guessed** — copy them out of the new Firebase
project's console (Project settings → General → Your apps → SDK setup) into
`public/js/firebase.js`:

`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`,
`appId`, `measurementId`.

> These are public by design. Firebase web API keys are not secrets — all
> security in this app comes from Firestore/Storage rules and callable-side
> auth checks. Do not try to hide them.

### 1.1 Fonts — Audrey is not a Google Font

This changes the mechanics, so handle it deliberately.

Every page in the source loads its typefaces with a single Google Fonts
`<link>`. **Audrey is not on Google Fonts**, so that mechanism cannot serve it.
Neither is Caviar Dreams (the "cookies" sample). You have two options:

**Self-host Audrey (recommended for the display face).**
1. License it for web use. The free downloads floating around are
   personal-use-only; a commercial site needs a real webfont license. Check
   the foundry's terms before you ship.
2. Convert to `.woff2`, put the files in `public/assets/fonts/`.
3. Add an `@font-face` block to `public/styles.css` — and to the inline
   `<style>` block of each self-contained page (§5.3 lists them).
4. Hosting already serves fonts with `Cache-Control: public, max-age=604800`
   (`firebase.json` covers `woff|woff2|ttf|eot`), so no config change needed.

```css
@font-face {
  font-family: 'Audrey';
  src: url('/assets/fonts/audrey.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;   /* text stays visible while the font loads */
}
```

**Use Audrey for display only.** Audrey is a wide, light, generously-tracked
display face — beautiful for the wordmark, headings and the certificate,
genuinely hard to read at 13px in a dense CRM table. Pair it with a geometric
Google Font for body and UI. `Jost` is the closest free match to the samples
you sent; `Questrial` and `Poiret One` are the other two worth auditioning.
That gives you:

```css
--font-display: 'Audrey', 'Jost', Georgia, serif;   /* wordmark, headings, certificate */
--font-body:    'Jost', system-ui, sans-serif;       /* everything else */
--font-mono:    'Space Mono', ui-monospace, monospace;
```

The `'Jost'` fallback inside `--font-display` matters: if the Audrey license or
files ever fall out, the site degrades to a near-match instead of Georgia.

### 1.2 Palette — minimal light, red used sparingly

The source is a **dark** theme (black surfaces, white text, loud red). Your
brand is the inverse: white paper, charcoal ink, red as punctuation. Read
§5.3 before you start — this is the largest single piece of work in the port,
and it is not a token swap.

```css
:root {
  /* paper + ink */
  --paper:        #FFFFFF;
  --surface:      #FAFAFA;   /* cards, raised panels */
  --surface-2:    #F2F1EF;   /* warm off-white, matches the wordmark lockup */
  --ink:          #3C3C3C;   /* body text — the grey in your logo samples */
  --ink-strong:   #1A1A1A;   /* headings */
  --ink-muted:    #8A8A8A;   /* captions, meta, placeholders */
  --border:       rgba(0, 0, 0, 0.10);

  /* the pop */
  --red:          #C8102E;
  --red-dark:     #9E0C24;
  --red-tint:     rgba(200, 16, 46, 0.08);   /* hover washes, selected rows */
  --border-red:   rgba(200, 16, 46, 0.28);
}
```

**Discipline for "subtle pops":** red carries meaning, not decoration. Reserve
it for the primary action on a screen (one per view), active nav state, the
logo mark, and genuine destructive/error states. Everything else is ink on
paper. The moment red appears on secondary buttons and section headers, the
minimalism is gone — which is exactly what the source does today, so expect to
*remove* red as you port, not just recolor it.

---

## 2. What you are building

### The stack, stated plainly

A **buildless static multi-page app** on Firebase Hosting, plus **one Cloud
Functions v2 file** (Node 20, CommonJS).

**There is no bundler, no npm on the frontend, no TypeScript, no tests, and no
linter.** There is no root `package.json` at all — the only npm project in the
repo is `functions/`. Everything in `public/` is deployed byte-for-byte as
written. Every browser dependency is loaded from a CDN URL:

| Library | Version | Source | Used by |
|---|---|---|---|
| Firebase JS SDK | 10.12.0 | `gstatic.com` | everything |
| Quill | 2.0.2 | jsDelivr | course builder rich-text editor |
| DOMPurify | 3.1.6 | jsDelivr | sanitizing builder HTML |
| pdfjs-dist | 4 | jsDelivr | PDF import in the course builder |
| mammoth | 1 | jsDelivr | .docx import in the course builder |
| html2canvas | 1.4.1 | cdnjs | bug-report screenshots |

**Read this before you "modernize."** A reader who assumes a build step exists
will add one, break the bare `import` URL specifiers, and lose an afternoon.
If you *want* a build step, that is a separate project — do the port first,
verify it works, then migrate.

### Feature inventory

Everything below must survive the port. This is the checklist for "all
functionality intact."

- **Auth** — email/password + Google OAuth, password reset, company invite
  codes, community invite tokens, idle/absolute session expiry, mandatory
  onboarding gate.
- **Roles** — `owner` (Firebase custom claim, bootstrapped by email) →
  company `admin` (Firestore field) → `user`.
- **Courses** — two authoring paths (code-defined and Firestore-defined) that
  merge at runtime; Udemy-style landing pages; a Coursera-style player with
  module sidebar, tabs, progress and notes; free enrollment and Stripe
  checkout; coupons; printable certificates with deterministic serials.
- **Course CMS** — Quill lesson editor, cover/video/attachment uploads to
  Storage, draft/publish per lesson, live/coming-soon/inactive status,
  price and sale price, main-site visibility toggle, PDF/.docx import, and
  **AI course generation** (outline + per-lesson) via Claude.
- **Community** — public feed plus private gated channels, posts, comments,
  likes, image uploads, @mentions, categories, points/levels/leaderboard,
  member directory and search, member invites, channel access requests with
  admin approval, notifications with a live bell.
- **CRM** (a GoHighLevel-style suite) — contacts with stages/sources/notes/
  activity timeline, configurable deal pipelines, opportunities, tasks,
  appointments and a calendar, two-way SMS conversations, and email campaigns
  with open/click tracking.
- **Commerce** — Stripe Checkout, webhook-driven enrollment, coupon sync,
  affiliate links with click tracking and commission payout marking, and a
  product/launch pipeline with interest lists and pre-orders.
- **Events** — create/manage with flyer upload, member registration with
  consent capture, share-to-CRM-contacts.
- **AI chatbot** — floating voice + text assistant with a canvas visualizer,
  Web Speech API STT, TTS toggle, an admin-managed knowledge base, and a
  built-in bug-report button that captures a screenshot.
- **Bug reporting** — screenshot + description → AI triage → email to owner,
  with an admin inbox.
- **Compliance** — self-service data export and account deletion, cookie
  consent banner, SMS STOP/START handling, and a Firestore-backed rate
  limiter on every expensive or abusable callable.

---

## 3. Phase 0 — Create the Firebase project

Do these in order. Nothing else works until they are done.

1. **Create the project** at <https://console.firebase.google.com> →
   `{{FIREBASE_PROJECT_ID}}`.

2. **Upgrade to the Blaze plan.** Cloud Functions v2 *cannot* deploy on Spark.
   This is not optional and it is the single most common cause of a failed
   first deploy.

3. **Enable Firestore.** Create database → region **`us-central1`** → start in
   **Production mode**. The custom rules deploy over the defaults on first
   push. Keep the region consistent with Functions (`us-central1` is set in
   `functions/index.js` via `setGlobalOptions`).

4. **Enable Auth providers.** Authentication → Sign-in method → enable
   **Email/Password** and **Google** (pick any project support email).

5. **Enable Storage.** Create the default bucket. Note its name — it goes into
   `firebaseConfig.storageBucket`.

6. **Register a Web app** and copy the `firebaseConfig` object.

7. **Create the CI service account** and grant it, beyond the default hosting
   deployer role:
   - `roles/firebaserules.admin` (Firebase Rules Admin)
   - `roles/cloudfunctions.developer` (Cloud Functions Developer)
   - `roles/iam.serviceAccountUser` (Service Account User)
   - Artifact Registry Writer (v2 functions store images there)
   - Cloud Run Admin (v2 functions run on Cloud Run underneath)

8. **Save the service-account JSON** as a GitHub repo secret named
   `{{CI_SECRET_NAME}}`.

---

## 4. Phase 1 — File manifest

Copy in this order. Each file is marked:

- **AS-IS** — copy unchanged. Do not touch.
- **EDIT** — copy, then change the specific values named.
- **REFILL** — copy the file for its *structure*, delete the content, write new.

### 4.1 Root

| File | Action | Notes |
|---|---|---|
| `firebase.json` | **AS-IS** | Hosting/Firestore/Storage/Functions config. The header block (HSTS, nosniff, frame options, referrer policy, permissions policy) and the per-extension cache rules are tuned — keep them. Note `cleanUrls: true` alongside a catch-all `** → /index.html` rewrite: real files win, so `/courses` serves `courses.html`, and only unknown paths fall through to the marketing home page. |
| `firestore.rules` | **AS-IS** | 859 lines. This *is* the authorization layer. See §8.3. |
| `firestore.indexes.json` | **AS-IS** | 19 composite indexes + 1 field override, across `appointments`, `campaigns`, `contacts`, `events`, `messages`, `notifications`, `opportunities`, `posts`, `tasks`, `users`. Queries fail at runtime without these. |
| `storage.rules` | **AS-IS** | Per-prefix upload rules with size and MIME limits. |
| `.gitignore` | **AS-IS** | |
| `.firebaserc` | **EDIT** | `{ "projects": { "default": "{{FIREBASE_PROJECT_ID}}" } }` |
| `AUTH_SETUP.md` | **EDIT** | The operational runbook. Every console deep link contains the project ID. Worth carrying over — it documents the rate limits, App Check setup, and the data model. |
| `README.md` | **REFILL** | Currently two lines. |
| `.github/workflows/firebase-hosting-merge.yml` | **EDIT** | `projectId:` and the secret name. |
| `.github/workflows/firebase-hosting-pull-request.yml` | **EDIT** | Same. Keep the `if: github.event.pull_request.head.repo.full_name == github.repository` guard — it stops forks from getting the deploy secret. |
| `.github/workflows/firebase-deploy-backend.yml` | **EDIT** | Project ID in two places, secret name, and the error-message text. **Keep the two-step structure** — see §10.5. |

### 4.2 `functions/`

| File | Action | Notes |
|---|---|---|
| `functions/package.json` | **EDIT** | Change `name` and `description` only. Keep all six dependencies and `engines.node: "20"`. |
| `functions/package-lock.json` | **AS-IS** | Or regenerate with `npm install`. |
| `functions/index.js` | **EDIT** | 4,621 lines, 52 exports. Copy whole, then edit only the brand sites listed in §5.1. |

### 4.3 `public/js/` — 55 modules

Four layers. Nothing here has a build step; all cross-module references are
relative `./x.js` imports.

**Layer 1 — foundation** (no local imports)

| Module | Purpose | Brand-coupled |
|---|---|---|
| `firebase.js` | Singleton SDK init. Exports `app, auth, db, functions, appCheck, initError, firebaseReady, firebaseConfig`. Holds `RECAPTCHA_V3_SITE_KEY`. | **Yes** — whole config |
| `courses-registry.js` | Hardcoded seed course catalog. | **Refill** |
| `certificate.js` | Certificate markup, styles, signer, serial generator. | **Yes** |
| `video-embed.js` | YouTube / Vimeo / Loom URL → safe embed HTML. | No |
| `consent-banner.js` | Cookie/analytics consent notice. | No |

**Layer 2 — services**

| Module | Purpose | Brand-coupled |
|---|---|---|
| `auth.js` | Login, signup, Google OAuth, reset, invite-code flow, signout, `onAuthReady()`. | **Yes** — `OWNER_EMAIL:22` |
| `session.js` | Session lifetime: 30 min idle, 12 hr absolute, periodic token refresh. | No |
| `roles.js` | Resolves role from custom claims + Firestore, with a localStorage cache. | No |
| `store.js` | Course progress + per-module notes; Firestore with localStorage fallback. | **Keys** — `1p_clc_state`, `1p_note_` |
| `onboarding-guard.js` | Members must complete onboarding once; owner/admin exempt; fails open. | No |
| `enrollments.js` | Which courses the signed-in user has. | **Slug** at :55 |
| `referral.js` | Affiliate attribution capture. | **Keys** — `1p_ref`, `1p_ref_clicked` |
| `course-progress.js` | One progress answer for every course shape. | No |
| `course-uploads.js` | Lesson image/attachment/video uploads to Storage. | No |
| `courses-data.js` | Merges the seed registry with Firestore overrides. | **Slugs** in `CODE_MODULE_META` |
| `community.js` | Community data layer — feed, channels, levels, notifications, avatars, mentions, leaderboard. | `DEFAULT_CHANNELS` are generic |
| `crm.js` | CRM data layer — contacts, notes, activities, pipelines. | Stage colors |
| `products.js` | Product / pre-order / interest data layer. | No |
| `chatbot.js` | Voice + text AI assistant widget. | **Yes** — `opn-` prefix throughout |

**Layer 3 — UI shells** (reused across many pages)

| Module | Purpose |
|---|---|
| `topbar.js` | `renderTopbar()`, `renderTopbarEarly()`, `defaultTopbarLinks()`, `teardownTopbar()`. Owns the role-filtered nav array (entries carry `requires: 'admin' \| 'owner'`), the admin dropdown, avatar chip, member search, and the notification bell (one bounded `onSnapshot(limit 20)` per page). **This is the single place to edit navigation.** |
| `crm-shell.js` | `renderCrmShell({ active, title, user, role })` — renders into `#crm-root`, returns `#crm-content` for the page to fill. Owns the 8-item CRM nav and the responsive drawer. |
| `course-player.js` | `mountCoursePlayer(config)` — the one in-course UI. Fully config-driven: `{ container, brand, courseTitle, modules[], tabs[], progress{}, moduleHeaderHtml, sidebarFooterHtml, labels, certificateHref, startAt }`. |
| `course-renderer.js` | `mountFirestoreCourse()` — generic renderer for Firestore-authored courses, feeding `course-player.js`. |

**Layer 4 — page controllers** (one per route)

`admin.js`, `affiliate.js`, `app.js`, `calendar.js`, `campaigns.js`,
`certificate-page.js`, `community-page.js`, `contact-page.js`,
`conversations.js`, `course-ai.js`, `course-builder.js`, `course-landing.js`,
`courses-page.js`, `crm-dashboard.js`, `crm-page.js`, `crm-settings.js`,
`events-page.js`, `home-courses.js`, `hub.js`, `icant-course.js`,
`manage-affiliates.js`, `manage-coupons.js`, `manage-courses.js`,
`manage-products.js`, `members-page.js`, `modules.js`, `opportunities.js`,
`owner.js`, `profile-page.js`, `resources-page.js`, `tasks.js`, `upcoming.js`.

> **Naming convention:** `*-page.js` = page controller (entry point), bare name
> = shared library. One flat directory, no subfolders. Keep it.

### 4.4 `public/*.html` — 39 pages

`P` = public, `M` = member (requires auth), `A` = admin, `O` = owner.

| Route | Entry module | Access | Kind |
|---|---|---|---|
| `index.html` | `home-courses.js`, `chatbot.js`, `consent-banner.js` | P | **Marketing — refill** |
| `login.html` | `auth.js`, `firebase.js`, `session.js`, `consent-banner.js` | P | App |
| `signup.html` | `auth.js`, `firebase.js`, `consent-banner.js` | P | App |
| `invite.html` | `auth.js`, `firebase.js` | P | App |
| `onboarding.html` | `auth.js`, `firebase.js` | M | App |
| `dashboard.html` | `hub.js`, `chatbot.js` | M | App |
| `courses.html` | `courses-page.js`, `course-player.js`, `chatbot.js` | M | App |
| `course.html` | `course-landing.js` | P | App |
| `certificate.html` | `certificate-page.js` | M | App |
| `community.html` | `community-page.js` | M | App |
| `members.html` | `members-page.js` | M | App |
| `profile.html` | `profile-page.js` | M | App |
| `resources.html` | `resources-page.js` | M | App (stub) |
| `events.html` | `events-page.js` | M | App |
| `upcoming.html` | `upcoming.js` | P | App |
| `affiliate.html` | `affiliate.js` | M | App |
| `crm.html` | `crm-page.js` | A | App |
| `crm-dashboard.html` | `crm-dashboard.js` | A | App |
| `crm-settings.html` | `crm-settings.js` | A | App |
| `opportunities.html` | `opportunities.js` | A | App |
| `tasks.html` | `tasks.js` | A | App |
| `conversations.html` | `conversations.js` | A | App |
| `calendar.html` | `calendar.js` | A | App |
| `campaigns.html` | `campaigns.js` | A | App |
| `contact.html` | `contact-page.js` | A | App |
| `admin.html` | `admin.js` | A | App |
| `manage-courses.html` | `manage-courses.js` (+ `course-builder.js`, `course-ai.js`, Quill) | A | App |
| `manage-products.html` | `manage-products.js` | A | App |
| `manage-affiliates.html` | `manage-affiliates.js` | A | App |
| `chatbot-kb.html` | inline module | A | App |
| `bug-reports.html` | inline module | O | App |
| `owner.html` | `owner.js` | O | App |
| `book.html` | — | P | **Marketing — refill** |
| `book-bonus.html` | — | P | **Marketing — refill** |
| `bundle.html` | — | P | **Marketing — refill** |
| `webinar.html` | — | P | **Marketing — refill** |
| `goal-planning.html` | — | P | **Marketing — refill** |
| `privacy.html` | — | P | **Legal — fill placeholders** |
| `terms.html` | — | P | **Legal — fill placeholders** |

> Most pages import their controller from an *inline* `<script type="module">`
> block rather than a `src=` attribute. If you audit the wiring, read the
> inline imports, not just `src` attributes.

### 4.5 `public/styles.css` and `public/assets/`

- `styles.css` — 9,821 lines, one global stylesheet, CSS custom properties in
  `:root`. **COPY AS-IS, then edit tokens** (§5.3).
- `assets/` — 14 files, ~13 MB. All brand-specific. **REFILL** (§6.5).

---

## 5. Phase 2 — The substitution pass

Work through these in order. Each has a `grep` you can run to locate the sites
and re-run to verify.

### 5.1 `functions/index.js` — the brand constant block

Lines 19–37 are the top of the file and the highest-leverage edit:

```js
const OWNER_EMAIL       = '{{OWNER_EMAIL}}';   // line 19
const FROM_EMAIL        = '{{OWNER_EMAIL}}';   // line 22
const FROM_NAME_DEFAULT = '{{BRAND_NAME}}';    // line 23
const REPLY_TO          = '{{OWNER_EMAIL}}';   // line 24
const APP_BASE_URL      = 'https://{{DOMAIN}}';// line 31
const REFERRAL_POINTS   = 10;                  // line 38 — tune if you like
```

Then these further sites in the same file, which a top-of-file edit misses:

| Lines | What |
|---|---|
| 617–630 | Invite email subject + HTML body, including a hardcoded `#CC1B1B` accent at 625 |
| 697–714 | Welcome email body and signature |
| ~1937 | Push-notification default title |
| ~3474 | CRM email footer signature |
| ~3045 | **Legacy carve-out**: `slug === '1p-clc'` special-cases pre-enrollment users. **Delete this** on a fresh install. |
| 3916–3923 | `OPN_COURSES` — a second, duplicated course catalog used only for the chatbot prompt. See §6.2. |
| 3944–3989 | Chatbot system prompt — brand name, tagline, portal name |
| 4365, 4384 | Bug-report AI triage prompts |
| ~4431, ~4439 | Two absolute `https://{{FIREBASE_PROJECT_ID}}.web.app/bug-reports.html` links in the notification email |
| 4511, 4579 | Course-generator system prompts |

```bash
grep -nEi "the one percent|1pnation|1P-CLC|1PN|OPN|@gmail" functions/index.js
```

### 5.2 Client identity

| File | Site | Change |
|---|---|---|
| `public/js/firebase.js` | 17–25 | Whole `firebaseConfig` object |
| `public/js/firebase.js` | 37 | Leave `RECAPTCHA_V3_SITE_KEY = ""` — App Check is a safe no-op until you set it |
| `public/js/auth.js` | 22 | `OWNER_EMAIL` — **must match `functions/index.js:19` exactly**, or `bootstrapOwner` fails |
| every `*.html` | `<head>` | The GA4 snippet, `{{GA4_ID}}` in two spots per page |
| `.firebaserc`, 3 workflows | | Project ID and secret name |

```bash
grep -rl "G-RBH536HRZE" public/          # expect ~36 files
grep -rn "the-1p-leadership" --exclude-dir=.git .
```

### 5.3 Design tokens and the dark → light inversion

**Budget real time for this step. It is the largest piece of work in the port.**

The source is a dark theme. Kailey Brown is a light one. That is not a token
swap, because the stylesheet does not go through tokens consistently. In
`public/styles.css` alone:

| Literal | Count |
|---|---|
| `rgba(255,255,255,…)` — white at some opacity, i.e. "light on dark" | 55 |
| `#fff` / `#ffffff` hardcoded | 45 |
| Hardcoded near-black hexes (`#0xxxxx`, `#1xxxxx`) | 44 |
| `rgba(0,0,0,…)` — shadows and scrims tuned for a dark ground | 30 |

That's ~174 color values that bypass `:root` entirely, plus **11 pages carrying
their own inline `<style>` block** — `index.html` (2,816 lines),
`goal-planning.html` (1,010), `webinar.html` (1,004), `bundle.html` (733),
`book.html` (535), `book-bonus.html` (472), `chatbot-kb.html` (409),
`bug-reports.html` (305), `login.html` (282), `privacy.html` (187),
`terms.html` (159).

**Recommended sequence:**

1. **Consolidate first, invert second.** Before changing a single color, pull
   the four `:root` blocks into one `public/assets/tokens.css` and `@import`
   it everywhere. Doing this first means you invert *once*, in one file,
   instead of four times — and it permanently fixes the source's weakest
   point. This is the one place I'd depart from copy-as-is.
2. **Rename tokens by role, not appearance.** `--black` and `--white` become
   lies the moment you invert. Move to `--paper` / `--ink` / `--surface` /
   `--border` as in §1.2. Mechanical, but it prevents a class of bug where a
   later contributor "fixes" `--black: #FFFFFF` back to black.
3. **Sweep the literals.** `rgba(255,255,255,0.08)` borders become
   `rgba(0,0,0,0.08)`; white text becomes ink; dark-ground shadows need
   re-tuning (shadows on white want to be softer and tighter than shadows on
   black, not just inverted).
4. **Do the app shell before the marketing pages.** `styles.css` covers all 28
   app pages at once. The marketing pages are being rewritten in Phase 3
   anyway (§6.4), so don't invert markup you're about to delete.
5. **Re-check contrast.** The source's `--gray-400: #A0A0A0` reads fine as
   muted text on `#080808`. On white it fails WCAG AA. Use `--ink-muted:
   #8A8A8A` or darker for anything at body size.

**The four token blocks** (all must move together, or one file after step 1):

1. `public/styles.css:1–28` — the canonical `:root` block
2. `public/index.html:32–56` — a duplicate `:root` (index is self-contained)
3. `public/styles.css:9451–9489` — the certificate palettes (`--cert-*`). Two
   themes are defined at `public/js/certificate.js:33–34`: **Midnight**
   (`sheet: #0A0A0A`, `accent: #E60306`) and **Classic** (`sheet: #FFFFFF`,
   `accent: #111111`). **Classic is already on-brand for Kailey Brown** — make
   it the default and change only its accent to `#C8102E`. Certificates get
   printed, so a white sheet is the right default regardless; Midnight burns a
   page of toner. Consider dropping Midnight entirely.
4. `public/goal-planning.html` and `public/webinar.html` — each has its own
   full `:root`

**Non-token color and font sites:**

- The Google Fonts `<link>` in **every** page `<head>` — and the new
  `@font-face` block for Audrey (§1.1), which must go everywhere `:root` does
- `{{ACCENT}}` hardcoded inside `public/assets/academy-logo.svg`
- `#CC1B1B` in the `functions/index.js` invite email (emails are light-ground
  already, so this one is a straight swap to `#C8102E`)
- CRM stage colors — `public/js/crm.js:16–23` and `:373–380`. These are
  categorical (new / contacted / qualified / negotiating / customer / lost),
  so keep them chromatically distinct rather than forcing them to brand red;
  just lighten them for a white ground.
- Google Maps web-component styling — `public/styles.css:1266–1271`

**Token mapping:**

```css
--red / --red-dark / --red-light / --red-glow   → --red / --red-dark / --red-tint / --border-red
--black / --black-2 / --charcoal                → --paper / --surface / --surface-2
--surface / --surface-2                         → --surface-2 / --border
--white / --off-white                           → --ink-strong / --ink
--gray-400 / --gray-600                         → --ink-muted (re-check contrast)
--border / --border-red                         → rgba(0,0,0,0.10) / rgba(200,16,46,0.28)
--font-display / --font-body / --font-mono      → Audrey / Jost / Space Mono
--nav-h / --ease-out / --ease-in                → structural, keep as-is
```

### 5.4 Visible brand strings

| File | Site | What |
|---|---|---|
| `public/js/certificate.js` | 18–19, 76, 85–87, 123–130, 164 | `CERT_SIGNER`, serial prefix `1P-`, certificate body copy, watermark |
| `public/js/course-landing.js` | 20–24, 87, 229–231, 451 | `INSTRUCTOR` object, main-site link, document title |
| `public/js/hub.js` | 1, 46–70, 387–388 | Header, `DAILY_QUOTES` array (brand-voice copy), share-sheet text |
| `public/js/crm-shell.js` | 3, 61–62, 69 | Sidebar aria-label, logo path, main-site link |
| `public/js/community-page.js` | 988–991 | `1P` monogram + academy name |
| `public/js/chatbot.js` | 1, 26, 41–52, 287 | Widget ID, `1PN` label, greeting — **and every CSS class is prefixed `opn-`** |
| `public/js/campaigns.js` | 257–258, 328 | Default from-name / from-address |
| `public/js/contact-page.js` | 550 | Default from-address |
| `public/js/events-page.js` | 676 | Registration consent checkbox text |
| `public/js/profile-page.js` | 67, 92 | Form placeholders |
| `public/js/app.js` | 35 | `courseTitle` |
| ~20 `*.html` | header | The "← Main Site" link to `https://{{DOMAIN}}` |
| every `*.html` | `<title>` | `… | {{BRAND_ACADEMY}}` or `… | {{BRAND_NAME}}` |

### 5.5 Namespaces and prefixes

Cosmetic, but leaving them makes the new brand look like a fork:

| Current | New | Where |
|---|---|---|
| `1p_ref`, `1p_ref_clicked` | `kb_ref`, `kb_ref_clicked` | `referral.js:11–12` |
| `1p_clc_state` | `kb_course_state` | `store.js:24` |
| `1p_note_` | `kb_note_` | `store.js:25` |
| `1p-book-bonus-submitted` | *(page is being replaced)* | `book-bonus.html` |
| `opn-` CSS/DOM prefix | `kb-` | throughout `chatbot.js` + its style block |
| `the-1p-leadership-functions` | `kailey-brown-functions` | `functions/package.json` |

> Changing a localStorage key orphans whatever is stored under the old one. On
> a fresh install that's nothing, so rename freely now. Doing it later logs
> people out of their locally-cached progress.

### 5.6 Favicons — regenerate, don't swap

Three pages carry **inline base64 JPEG favicons**: `index.html:1576`,
`goal-planning.html:355`, `webinar.html:416`. The current images' embedded XMP
metadata still reads `Copy of Copy of 1P final logo - 1`. Generate new ones
rather than re-encoding the old file. No other page has a favicon at all —
adding one site-wide is a cheap improvement.

### 5.7 Verification sweep

Every one of these must return zero:

```bash
for s in "the-1p-leadership" "The One Percent" "1pnation" "the1pnation" \
         "1P-CLC" "One Percent Nation" "G-RBH536HRZE" \
         "the1percentnation@gmail.com" "opn-" "1p_ref" "1p_clc_state"; do
  printf "%-32s %s\n" "$s" \
    "$(grep -rail "$s" --exclude-dir=.git --exclude=PORT-MANIFEST.md . | wc -l)"
done
```

> Two gotchas. Use `grep -a` — `public/js/community.js` contains emoji that make
> plain `grep` treat it as a binary file and skip it silently. And exclude this
> manifest, which quotes every old brand string as documentation and will
> otherwise show up as a hit for all of them.

---

## 6. Phase 3 — Content replacement

The engine is reusable; the content is not. The new brand starts with an empty
catalog and fills it through the admin UI.

### 6.1 `courses-registry.js` — the seed catalog

Keep the file and its entry schema; replace the entries.

```js
{
  slug: 'your-course',          // Firestore doc ID — see 6.3
  title: '...',
  eyebrow: 'Certification',
  price: 497,
  salePrice: null,
  status: 'live',               // 'live' | 'coming-soon' | 'inactive'
  description: '...',
  curriculum: [ { title, lessons: [...] } ],
  whatYoullLearn: [ '...' ],
  requirements: [ '...' ],
  includes: [ '...' ],
  mount: optionalFn             // code-defined courses only; see 6.2
}
```

Currently seeded (all to be replaced): `1p-clc` ($497), `bundle-icant` ($197),
`icant` ($197), `mindset-foundations` ($197), `business-alignment` ($297),
`faith-leadership` ($197), `performance-discipline` ($247). The file also
defines the proprietary "1% Method" (Baseline → Learn → Rewirement → Measure)
plus `METHOD_PARAGRAPH` / `METHOD_REQUIREMENTS` constants — brand IP, remove.

**The merge model** (`courses-data.js`, keep as-is): every registry entry is a
*seed default*; Firestore `courses/{slug}` fields override it; Firestore-only
docs are appended and render through the generic renderer. `mount` is a
function, so it can only ever come from code — Firestore cannot hold it. This
is what lets admins edit the catalog without a deploy.

### 6.2 Code-authored course content — delete, keep the pattern

- `public/js/modules.js` (551 lines) — the 7-module 1P-CLC curriculum as HTML
  template strings, organized in 3 pillars ("Lead Yourself / Lead Others /
  Lead with Purpose"), plus pricing tiers and capstone instructions. Entry
  shape: `{ id, title, subtitle, pillar, pillarTag, duration, tag, tagLabel, render() }`.
- `public/js/icant-course.js` (589 lines) — the "I Can't" course, including the
  A.L.I.G.N. framework and "One Percent Declaration".
- `public/js/app.js` — the thin adapter feeding `MODULES` into
  `mountCoursePlayer`. Keep as a worked example.

> **Recommendation:** don't author new courses in code. Build them through
> `manage-courses.html` (Quill editor → `course-builder.js` →
> `course-uploads.js`, rendered by `course-renderer.js`), or generate them with
> the AI flow in `course-ai.js`. The code path exists for legacy content.

**`OPN_COURSES` at `functions/index.js:3916–3923` is a second copy of the
catalog**, used only to build the chatbot's system prompt. It has no automatic
sync with the registry. Either refill it alongside `courses-registry.js`, or
(better) refactor it to read from Firestore.

### 6.3 Course slugs are Firestore document IDs

`1p-clc`, `icant`, `bundle-icant` are not just display strings. They appear in:

`courses-registry.js`, `courses-data.js` (`CODE_MODULE_META`),
`enrollments.js:55`, `hub.js:155,214`, `manage-courses.js:493`,
`functions/index.js:3045` and `:3916–3923`.

On a **fresh install** renaming them is free — do it now. On an **existing**
install it is a data migration touching `courses/{slug}`,
`courses/{slug}/modules/*`, `users/{uid}.enrolledCourseSlugs`,
`users/{uid}/progress/*`, `users/{uid}/certificates/{courseSlug}`, and
Storage paths under `courses/{slug}/`. Plan accordingly.

### 6.4 Marketing pages — rewrite wholesale

`index.html` (2,816 lines, fully self-contained CSS and JS), `book.html`,
`book-bonus.html`, `bundle.html`, `webinar.html`, `goal-planning.html`.

Keep `index.html`'s section skeleton as a starting layout — sticky nav, hero
with rotating headline, marquee ticker, animated stats counter, impact/programs,
dynamic courses grid (injected by `home-courses.js` — **keep this wiring**),
about + story video, founder bio, shop, testimonials, webinar CTA, community
CTA, newsletter capture, FAQ accordion, footer, login modal, chatbot widget.

**External brand links to remove or repoint:**

| Link | Where |
|---|---|
| Circle community invite URL | `index.html:2060, 2104, 2245` |
| Amazon book link `a.co/d/0fSUaomu` | `index.html:1906,2244`, `bundle.html:680,706`, `icant-course.js:446,522`, `manage-courses.js:397,400` |
| Social profiles (Facebook / Instagram / LinkedIn) | `index.html:2223–2225` |
| `certify@theonepercentnation.com` | `modules.js:531` |
| GoHighLevel / LeadConnector form `2RRVTzt8PJABfOAPd84Z` | `book.html:513`, `webinar.html:934` |
| LeadConnector survey `bhIS7gQCcguEIYLf2gE8` | `goal-planning.html:936` |
| Testimonial quotes | `index.html:1944–1990`, `webinar.html:712+` |

### 6.5 `public/assets/`

All 14 files are founder- and brand-specific. Replace them, **keeping the
filenames** so the 26 references don't 404 — or rename and update the
references, but do one or the other completely.

| File | Kind | Referenced by |
|---|---|---|
| `academy-logo.png` | Portal logo | 25 HTML pages + `crm-shell.js:62` |
| `academy-logo.svg` | Text SVG, fill `{{ACCENT}}` | |

> **Logo note for a light theme.** `academy-logo.png` is currently drawn for a
> dark sidebar. Once you invert (§5.3) it needs a dark-ink version, not the
> same file. Export the Kailey Brown wordmark set in Audrey as SVG rather than
> PNG — it's a text mark, so SVG stays crisp at every size, scales to retina
> for free, and lets you set the fill from `{{ACCENT}}` or `--ink` in CSS
> instead of shipping two raster files. Keep a PNG only for the favicon and
> OG image, which need raster.
| `founder-portrait.jpg`, `founder-headshot-square.jpg`, `founder-stage-banner.jpg`, `founder-teaching.jpg` | Founder photography | `index.html` |
| `leadership-story.mp4` (7.0 MB) + `leadership-story-poster.jpg` | About video | `index.html` |
| `i-cant-book.mp4` (4.3 MB) + `i-cant-book-poster.jpg`, `i-cant-promo.png` | Book trailer | `index.html`, `bundle.html` |
| `work-less-gain-more.mp4` + `work-less-gain-more-poster.jpg`, `work-less-gain-more.jpg` | Second book teaser | `index.html` |

### 6.6 Legal pages

`privacy.html` and `terms.html` are live and linked in the footer, but still
contain unfilled `[[placeholder]]` tokens — `privacy.html:40,44,51,137,179–181`
and `terms.html:36,40,49,77,135,137,151–153`. Note that `terms.html:49`
additionally hardcodes the old brand as a *defined term*.

Fill in legal business name, address, contact email, governing state and
effective date, then have counsel review. The code provides the *mechanisms*
for CCPA/CPRA, TCPA and CAN-SPAM compliance; it does not certify compliance.

### 6.7 Bump the cache-busters

Hosting serves JS and CSS with `Cache-Control: no-cache`, and long-lived
signed-in tabs are handled by manual query-string version bumps. Bump them so
existing sessions pick up the rebrand:
`courses-page.js?v=3`, `certificate-page.js?v=2`, `styles.css?v=4`.

---

## 7. Phase 4 — External services and secrets

Set these as Cloud Functions secrets/env vars. **Every integration degrades
gracefully when unconfigured** — the callable returns a clean "not configured"
error rather than crashing. So you can deploy first and wire services up one at
a time.

| Variable | Mechanism | Powers | Unconfigured behavior |
|---|---|---|---|
| `SENDGRID_API_KEY` | `defineSecret` (line 52) | All transactional + campaign email | Deploy-time resolution — see warning below |
| `SENDGRID_WEBHOOK_KEY` | `process.env` | ECDSA-verified open/click events | Webhook rejects |
| `STRIPE_SECRET_KEY` | `process.env` | Checkout, coupons | Checkout returns "not configured" |
| `STRIPE_WEBHOOK_SECRET` | `process.env` | Enrollment on payment | Webhook rejects |
| `TWILIO_ACCOUNT_SID` | `process.env` | SMS | `sendSms` errors cleanly |
| `TWILIO_AUTH_TOKEN` | `process.env` | SMS + webhook signature check | Same |
| `TWILIO_FROM_NUMBER` | `process.env` | SMS sender | Same |
| `ANTHROPIC_API_KEY` | `process.env` | Chatbot, bug triage, course generation | AI features error cleanly |

> **Why only SendGrid uses `defineSecret`:** `defineSecret` is resolved by the
> CLI at **deploy** time, which makes every functions deploy hit Secret
> Manager — and Secret Manager requires active billing. Everything else is read
> lazily from `process.env` inside the handler, so deploys succeed before the
> values exist. **Preserve this split.** Converting the rest to `defineSecret`
> means you can no longer deploy until every third-party account is live.

### Per-service setup

- **SendGrid** — create an API key with Mail Send. Verify `{{OWNER_EMAIL}}` as a
  sender (email will silently fail otherwise). Add the Event Webhook pointing at
  the deployed `sendgridEventWebhook` URL and enable signature verification.
- **Stripe** — create products and prices matching your catalog. Add a webhook
  endpoint pointing at `stripeWebhook` and copy the signing secret. Coupons are
  synced from the app via `syncCoupon`.
- **Twilio** — buy a number, set `TWILIO_FROM_NUMBER`. Point the inbound message
  webhook at `twilioInboundWebhook` (it handles STOP/START opt-out — required
  for TCPA) and the status callback at `twilioStatusWebhook`.
- **Anthropic** — one API key. Four call sites: `courseAdvisorChat`, the
  bug-report triage path, `generateCourseOutline`, `generateCourseLesson`. All
  pin the same model ID; the SDK is lazily `require`d inside each handler so a
  missing dependency can't break unrelated deploys.
- **App Check (optional)** — Firebase Console → App Check → register the web app
  with reCAPTCHA v3, paste the site key into `RECAPTCHA_V3_SITE_KEY` in
  `public/js/firebase.js`. Once tokens are flowing, optionally set
  `enforceAppCheck: true` on sensitive callables.

---

## 8. Phase 5 — Reference

### 8.1 Firestore data model

```
users/{uid}                     { email, displayName, role, companyId|null, tier,
                                  createdAt, lastActiveAt, currentModule,
                                  onboardingComplete, enrolledCourseSlugs[], statsPoints }
  ├ progress/{moduleId}         { completed, completedAt, notes, noteSlots }
  ├ capstone/{docId=**}         { reflection, recordingUrl, submittedAt, reviewStatus }
  ├ certificates/{courseSlug}
  ├ stats/{statId}
  ├ notifications/{notifId}     { read, createdAt, ... }
  ├ registrations/{eventId}
  ├ courseInterests/{slug}
  └ purchases/{purchaseId}

companies/{cid}                 { name, adminUids[], seatCount, seatsUsed, tier, createdAt }
  ├ invites/{inviteId}          { email, code, status, companyId, createdAt, acceptedByUid }
  ├ members/{mUid}
  ├ contacts/{contactId}        ├ notes/{noteId}
  │                             └ activities/{activityId}
  ├ pipelines/{pipelineId}
  ├ opportunities/{oppId}
  ├ tasks/{taskId}
  ├ appointments/{apptId}
  ├ conversations/{conversationId} └ messages/{messageId}
  └ campaigns/{campaignId}        └ events/{eventId}

posts/{postId}                  companyId == null → global feed; else company-scoped
  ├ comments/{commentId}
  └ likes/{likeUid}

channels/{key}                  { visibility: 'public'|'private', memberUids[], listed, order, emoji }
  ├ requests/{requestUid}
  └ posts/{postId}              ├ comments/{commentId}      ← private-channel feed
                                └ likes/{likeUid}

communityInvites/{tokenId}      server-only (invisible to clients)
courses/{slug}                  └ modules/{moduleId}        — `stripe` map is server-only
products/{productId}            ├ interests/{interestId}
                                └ preorders/{preorderId}
coupons/{code}                  — stripePromotionCodeId server-written
affiliates/{code}               └ referrals/{refId}         — money fields server-written
events/{eventId}                └ registrations/{regId}
courseSuggestions/{id}          server-written; owner/admin read
chatbotKnowledge/{entryId}      server-only both ways
rateLimits/{docId}              server-only both ways
bugReports/{reportId}           server-created; owner read/update only
```

**Storage paths** (`storage.rules`):

| Path | Read | Write | Limit |
|---|---|---|---|
| `courses/{slug}/images/` | public | course admin | 10 MB, `image/*` |
| `courses/{slug}/attachments/` | authed | course admin | 25 MB, docs/pdf/zip/audio/image |
| `courses/{slug}/videos/` | authed | course admin | 500 MB, `video/(mp4\|webm)` |
| `avatars/{uid}/` | authed | that uid | — |
| `posts/{postId}/` | authed | authed | 10 MB, `image/*` |
| `events/{eventId}/` | authed | authed | 10 MB, `image/*` |
| `product-images/{uid}/` | public | authed | 10 MB, `image/*` |
| `bug-screenshots/` | **deny** | **deny** | written by Admin SDK; owner gets signed URLs by email |

### 8.2 Cloud Functions inventory — 52 exports

**Callables (39)**

`acceptInvite`, `deleteContact`, `deleteUser`, `deleteMyAccount`,
`requestDataExport`, `bootstrapOwner`, `sendContactEmail`, `sendCampaign`,
`shareEventToContacts`, `registerForEvent`, `registerCourseInterest`,
`submitOnboarding`, `getLeaderboard`, `recomputeUserStats`, `searchMembers`,
`createCommunityInvite`, `acceptCommunityInvite`, `getMyReferralCode`,
`backfillChannelDefaults`, `requestChannelAccess`, `decideChannelAccess`,
`removeChannelMember`, `searchPosts`, `enrollFree`, `createCheckoutSession`,
`syncCoupon`, `recordAffiliateClick`, `markAffiliatePaid`, `sendSms`,
`registerProductInterest`, `joinEarlyAccess`, `notifyProductInterest`,
`saveKnowledgeEntry`, `deleteKnowledgeEntry`, `listKnowledgeEntries`,
`courseAdvisorChat`, `reportBug`, `generateCourseOutline` (`timeoutSeconds: 300`),
`generateCourseLesson` (`timeoutSeconds: 300`).

**Firestore triggers (9)** — `onInviteCreated`, `onUserCreated`,
`onPostCreated` + `onPrivatePostCreated`, `onCommentCreated` +
`onPrivateCommentCreated`, `onLikeWritten` + `onPrivateLikeWritten`,
`onProductWritten`.

> The public and private community feeds live at different Firestore paths
> (`posts/…` vs `channels/{key}/posts/…`), so each trigger is **deliberately
> duplicated**. Dropping one silently breaks notifications and points for
> private channels. Keep all eight.

**HTTP webhooks (4)** — `sendgridEventWebhook` (ECDSA signature verified),
`stripeWebhook` (signature verified), `twilioInboundWebhook` (signature
verified; handles STOP/START), `twilioStatusWebhook`.

**Scheduled — disabled by rename, not deletion**: `_disabled_taskReminders`
(line 3484), `_disabled_appointmentReminders` (3527). They are assigned to
`const _disabled_*` rather than `exports.*`, so they don't deploy. To enable,
rename to `exports.`.

**Global config**: `setGlobalOptions({ region: 'us-central1', maxInstances: 10 })`.

**Rate limiter** (lines ~149–199): a transactional Firestore fixed-window
limiter at `rateLimits/{action__key__bucket}`, keyed by uid and falling back to
`x-forwarded-for` IP. Documented limits: AI chat 20/5 min, bug reports 5/10 min,
contact email 60/10 min, campaigns 10/hr, SMS 100/10 min, checkout 15/10 min,
community invites 30/hr, affiliate clicks 30/10 min, data export 5/hr. Consider
a Firestore TTL policy on `rateLimits.expiresAt` to auto-prune.

**Points economy**: `POINTS = { POST: 5, POST_WIN: 10, COMMENT: 1, LIKE_RECEIVED: 2 }`
(line 1697), `REFERRAL_POINTS = 10` (line 38). Brand-agnostic — reuse as-is.

### 8.3 Authorization architecture

Rules helpers (`firestore.rules:8–65` and `:525–533`): `isSignedIn()`,
`isOwner()` (custom claim `request.auth.token.role == 'owner'`), `isSelf(uid)`,
`isAnyAdmin()`, `isLegalChannel(data)`, `isEnrolledIn(slug)`,
`isCompanyAdmin(cid)`, `callerAdminsSameCompanyAs(...)`, `channelDoc(key)`,
`isChannelMember(key)`.

`storage.rules` mirrors `isAnyAdmin()` across services with a
`firestore.get(/databases/(default)/documents/users/$(uid)).data.role` lookup.

**The load-bearing invariant**, quoted from the rules:

> `enrolledCourseSlugs` is the single source of truth for course access. It is
> frozen against self-writes in the `users/{uid}` rules, so only the Admin SDK
> (`enrollFree` callable + the Stripe webhook) can add to it — which is what
> makes this safe to gate paid content on.

Note also that `isEnrolledIn()` is deliberately written against `request.auth`
and the path variable only, never `resource` — that is what makes it provable
for `list` queries and not just `get`.

**`OWNER_EMAIL` is a hard gate**, not a display string. It is used by
`bootstrapOwner` (only that exact address can claim ownership, line 572), as an
undeletable-user guard (372, 459), as an owner-lookup key (1307, 2347, 2351),
and as the bug-report recipient (4435). It must be identical in
`functions/index.js:19` and `public/js/auth.js:22`.

**Server-only fields** — written exclusively by the Admin SDK and frozen in
rules: `users/*.enrolledCourseSlugs`, `courses/*.stripe`, affiliate money
fields, `coupons/*.stripePromotionCodeId`.

---

## 9. Phase 6 — First deploy and smoke test

### Deploy

```bash
npx firebase-tools login
cd functions && npm install && cd ..
npx firebase-tools deploy \
  --only firestore:rules,firestore:indexes,storage \
  --project {{FIREBASE_PROJECT_ID}}
npx firebase-tools deploy --only functions --project {{FIREBASE_PROJECT_ID}}
npx firebase-tools deploy --only hosting --project {{FIREBASE_PROJECT_ID}}
```

Or push to `main` and let both workflows run.

### Bootstrap the owner

1. Visit `/signup.html` and create an account with exactly `{{OWNER_EMAIL}}`
   (or sign in with that Google account).
2. Go to `/owner.html`. You'll see a "not yet an owner" notice. Click
   **Run bootstrapOwner**.
3. The page reloads with the `role=owner` custom claim set.

> If it fails with `permission-denied`, you are not signed in as exactly
> `{{OWNER_EMAIL}}`, or the two `OWNER_EMAIL` constants disagree.

### Smoke test — walk every subsystem

| # | Check | Exercises |
|---|---|---|
| 1 | `/owner.html` → create a company, assign an admin by email (they must have signed up first) | owner claim, company creation |
| 2 | Admin signs in → `/admin.html` → sees roster, generates an invite | role resolution, seats |
| 3 | Employee opens the invite link, signs up, lands on the portal with `companyId` set and seats-used incremented | `acceptInvite`, `onInviteCreated`, `onUserCreated` |
| 4 | Complete onboarding | `submitOnboarding`, onboarding guard |
| 5 | `/manage-courses.html` → create a course, add a module, upload an image and a video, publish | course builder, Storage rules, Quill |
| 6 | Click "✨ Generate with AI" | `generateCourseOutline` / `generateCourseLesson`, Anthropic key |
| 7 | `/courses.html` → enroll free, open the player, complete a module, view `/certificate.html` | `enrollFree`, progress store, certificates |
| 8 | Buy a paid course with a Stripe test card | `createCheckoutSession`, `stripeWebhook`, `enrolledCourseSlugs` write |
| 9 | `/community.html` → post to a public channel, then a private one; comment and like both | all 8 community triggers, points, notifications |
| 10 | `/members.html` → search | `searchMembers` |
| 11 | `/crm.html` → create a contact; `/conversations.html` → send an SMS | CRM data layer, Twilio |
| 12 | `/campaigns.html` → send a test campaign | `sendCampaign`, SendGrid, `sendgridEventWebhook` |
| 13 | `/events.html` → create an event, register, share to contacts | `registerForEvent`, `shareEventToContacts` |
| 14 | Chatbot → ask a question, then file a bug report | `courseAdvisorChat`, `reportBug`, html2canvas |
| 15 | `/profile.html` → request a data export, then test account deletion | `requestDataExport`, `deleteMyAccount` |

---

## 10. Invariants you must not break

These are the pieces that look like cruft and are not. Each one has a real
failure behind it.

**10.1 Fail open on infrastructure, fail closed on authorization.**
The onboarding guard, the role cache, and the rate limiter all deliberately
allow the request through when Firestore errors. Rules and callable auth checks
always deny. Don't "fix" the fail-open paths into fail-closed — a transient
Firestore blip would lock every user out. Don't relax the fail-closed ones.

**10.2 Server-only fields stay server-only.**
`enrolledCourseSlugs` in particular. The moment a client can write it, every
paid course is free. See §8.3.

**10.3 The `?v=N` cache-bust convention.**
JS and CSS ship with `Cache-Control: no-cache` and there is no content hashing,
so a long-lived signed-in tab can hold a stale module. Bump the query string
when you change a versioned file.

**10.4 `esc()` is duplicated on purpose.**
`crm.js`, `products.js`, `community.js`, `crm-shell.js` and `course-player.js`
each define their own HTML-escape helper. This is deliberate — it avoids
cross-imports between layers. Rendering is `innerHTML` from template literals
throughout, so **every interpolation of user data must go through the local
`esc()`**. Consolidating these is fine; removing any of them is not.

**10.5 CI deploys rules first, alone, before `npm install`.**
Preserve the two-step structure in `firebase-deploy-backend.yml`. The original
was a single `firebase deploy`; because `defineSecret` makes the functions
deploy read Secret Manager, and Secret Manager needs billing, a lapsed billing
account aborted the whole command on the secrets lookup — and the security
rules, already compiled and valid, were never pushed. **Rules silently stopped
deploying for weeks** while the workflow reported the failure as "functions."
Rules also go before `npm install` so a dependency problem in `functions/`
can't block a security-rule change either.

**10.6 The public/private community trigger pairs.**
Eight triggers, four logical events, two Firestore paths. See §8.2.

**10.7 `cleanUrls` + the catch-all rewrite coexist.**
`firebase.json` rewrites `**` → `/index.html` while `cleanUrls: true`. Real
files win, so every page is reachable both as `/courses.html` and `/courses`,
and only genuinely unknown paths fall through to the marketing home page.
Removing the rewrite gives you 404s; removing `cleanUrls` breaks extensionless
links.

**10.8 `OWNER_EMAIL` must match in two files.**
`functions/index.js:19` and `public/js/auth.js:22`.

**10.9 Config-object shells, not components.**
`renderTopbar()`, `renderCrmShell()` and `mountCoursePlayer()` each take one
options object and own a module-level array (`ALL_LINKS`, `NAV`, `MODULES`)
that is the single place to edit navigation or course structure. Add pages by
adding to those arrays, not by hand-editing markup across files.

**10.10 No build step.**
Stated once more because it is the assumption most likely to be violated by a
well-meaning contributor. `public/` ships verbatim.
