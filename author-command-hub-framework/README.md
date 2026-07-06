# Author Command Hub — Base Framework

A self-contained, copy-paste starter that lets **each reader own and edit one
website of their own**, hosted through a central "Author Command Hub." It is the
generic skeleton extracted from the 1P Leadership site — the same proven pieces
(Firebase Hosting + Auth + Firestore, a Quill rich-text editor, and a
DOMPurify-sanitized renderer) with all the 1P-specific content stripped out and
**courses generalized into editable pages/sites**.

No bundler, no build step. Static files + Firebase. Drop it on Firebase Hosting
(or any static host) and it runs.

---

## What you get

| File | Role |
|------|------|
| `public/js/firebase.js` | Firebase init (paste your project keys here). |
| `public/js/auth.js` | Login / signup / Google / reset / signout + `users/{uid}` profile doc. |
| `public/js/roles.js` | Reads `owner` vs `author` role (custom claim → Firestore fallback). |
| `public/js/site-store.js` | **The tenancy data layer.** One site per author; all page reads/writes. |
| `public/js/renderer.js` | Public, read-only, **sanitized** renderer for a published site. |
| `public/js/hub.js` | **The Author Command Hub** — page list + Quill editor + preview + publish. |
| `public/hub.html` | The Hub console shell (loads Quill). |
| `public/site.html` | The public site shell (`/site.html?site=<siteId>`). |
| `public/login.html` | Sign-in / sign-up page. |
| `public/styles.css` | Minimal, theme-neutral styling for Hub + public site. |
| `firestore.rules` | **Tenancy enforcement** — authors edit only their own site; published = public. |
| `firebase.json` / `firestore.indexes.json` | Hosting + Firestore config. |

---

## Data model

```
users/{uid}                    { email, displayName, role, siteId }
                                 role: 'owner' (platform admin) | 'author' (a reader)
                                 siteId → the one site this author owns

sites/{siteId}                 { ownerUid, title, tagline, slug,
                                 status: 'draft' | 'published',
                                 homePageId, theme, createdAt, updatedAt }

sites/{siteId}/pages/{pageId}  { title, slug, html, status: 'draft' | 'published',
                                 showInNav, sortOrder, updatedAt }
```

- **A page** is a block of author-written rich-text HTML (authored in Quill,
  stored as HTML, always re-sanitized on render).
- **A site** is one author's collection of pages + a little site-wide config.
- **Tenancy boundary = `sites/{siteId}.ownerUid`.** Every write rule checks it.

---

## How it maps back to the original 1P site

This framework is a straight generalization of the editable-course engine:

| 1P site (source) | This framework (generic) |
|------------------|--------------------------|
| `courses/{slug}` | `sites/{siteId}` |
| `courses/{slug}/modules/{id}` (Quill HTML lessons) | `sites/{siteId}/pages/{pageId}` (Quill HTML pages) |
| `manage-courses.js` (owner course builder) | `hub.js` (per-author site builder) |
| `course-renderer.js` (DOMPurify lesson renderer) | `renderer.js` (DOMPurify site renderer) |
| `companies/{id}` multi-tenant model | `sites/{id}` per-author tenant model |
| owner/admin/user roles | owner/author roles |

If you want to see the "real" versions with pricing, enrollment, community, CRM,
etc., they live in the parent repo's `public/js/` — this folder is the distilled
core you asked to extract.

---

## Setup (about 10 minutes)

1. **Create a Firebase project** at <https://console.firebase.google.com>.
2. **Enable Authentication** → Email/Password **and** Google.
3. **Create a Firestore database** (production mode).
4. **Paste your web config** into `public/js/firebase.js` (Project settings →
   Your apps → Web).
5. **Set the platform-owner email** in `public/js/auth.js`
   (`PLATFORM_OWNER_EMAIL`) to your own address.
6. **Deploy:**
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add            # pick your project
   firebase deploy --only hosting,firestore:rules
   ```
7. Visit `/login.html`, create an account, and you land in the Hub. Add a page,
   publish it, publish the site, then open **Preview site**.

Local preview without deploying: `firebase emulators:start` (or any static file
server) — but Firestore/Auth need the real project or the emulator suite.

---

## The end-to-end flow

1. A reader signs up (`login.html` → `auth.js` creates `users/{uid}`).
2. They open `hub.html`; `site-store.ensureMySite()` lazily creates their
   `sites/{siteId}` and links it on their user doc.
3. In the Hub they add **pages** (Quill → sanitized HTML in Firestore), reorder
   them, and flip each page + the whole site to **published**.
4. Anyone can view the published site at `/site.html?site=<siteId>`;
   `renderer.js` loads only published pages and sanitizes every render.
5. `firestore.rules` guarantees a reader can only ever read/write **their own**
   site; the platform `owner` can manage all of them.

---

## Roles (production hardening)

For dev, `roles.js` trusts `users/{uid}.role`. In production, the platform
`owner` should be a **server-set custom claim** so it can't be forged. Add a
tiny Cloud Function (mirrors the 1P `bootstrapOwner`):

```js
// functions/index.js
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin'); admin.initializeApp();

exports.bootstrapOwner = onCall(async (req) => {
  const email = (req.auth?.token?.email || '').toLowerCase();
  if (email !== 'you@example.com') throw new HttpsError('permission-denied', 'Not the owner.');
  await admin.auth().setCustomUserClaims(req.auth.uid, { role: 'owner' });
  return { ok: true };
});
```

Call it once while signed in as that email, then force a token refresh
(`auth.currentUser.getIdToken(true)`). The `isPlatformOwner()` rule then holds.

---

## Extension ideas (where to grow next)

- **Vanity URLs** — add a public `siteSlugs/{slug} → { siteId }` lookup doc so
  sites resolve at `/s/<slug>` instead of `?site=<id>`. (Kept out of the base to
  avoid slug-uniqueness bookkeeping and composite indexes.)
- **Custom domains** — Firebase Hosting supports per-site custom domains.
- **Themes** — `sites/{id}.theme` is already stored; branch CSS variables on it.
- **Media uploads** — add Firebase Storage + a storage rule keyed on `ownerUid`
  (the 1P repo's `storage.rules` is a reference).
- **Billing** — gate publishing behind Stripe (the 1P `functions/index.js` has a
  full Stripe checkout + webhook implementation to copy).

---

## Security notes

- **Every render sanitizes.** `renderer.js` and the Hub preview both run stored
  HTML through DOMPurify. Never `innerHTML` raw `page.html`.
- **Rules are the real security**, not the client. The Firebase web keys are
  public by design; `firestore.rules` is what stops cross-tenant access.
- The public page-read rule requires `status == 'published'` on **both** the
  page and its site — an author's drafts stay private even on a live site.
