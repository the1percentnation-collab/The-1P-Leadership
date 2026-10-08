# Digital library and reader

Books are their own system, separate from courses. A course attaches a book;
it never contains one.

| Piece | Where |
|---|---|
| Book record (title, author, cover, version) | Firestore `books/{bookId}`, public read |
| The EPUB | Storage `books/{bookId}/book.epub`, readable only by owners (`storage.rules`) |
| Who owns what | `users/{uid}.ownedBookIds`, written only by the server |
| Reading position and bookmarks | `users/{uid}/bookProgress/{bookId}` |
| Course → book link | `grantsBooks` on the course (`COURSE_FULFILLMENT` in `functions/index.js`, overridable on `courses/{slug}`) |
| Shelf | `/library` (`library.html`, `js/library-page.js`) |
| Reader | `/read?book={id}[&chapter=N]` (`read.html`, `js/reader.js`, `vendor/foliate-js`); the file comes from `/api/book-file` (`bookFile` function) |
| Admin upload | `/manage-library.html` (`js/manage-library.js`, `js/library-admin.js`); `syncBookGrants` callable grants to existing members |

Every way into a course (checkout, a 100% promo code, enrollFree, admin and
beta grants) goes through `resolveEnrollmentFields()`, which adds the course's
books to `ownedBookIds`. A bundle grants the books on its own record **and**
on the records of the courses it unlocks, so attaching the book to the I Can't
course in Manage Library is enough for both bundles. The book id is never
assumed in code: the course's `grantsBooks` (Firestore) wins over the
`COURSE_FULFILLMENT` defaults. Books are kept for life: cancelling a
subscription or revoking a beta grant does not remove them.

After every course checkout the webhook sends a confirmation
(`sendPurchaseEmail`): the course link, the book in the library, and for the
print bundle where the paperback ships. The result is recorded on the purchase
(`confirmationEmail: sent | failed`).

## I Can't formats

| Slug | Ships a paperback | Grants the book | Default price |
|---|---|---|---|
| `bundle-icant` | No | Yes | $197 |
| `bundle-icant-print` | Yes (address collected in Stripe) | Yes | $227 |
| `icant` (course, grants only) | No | Yes | n/a |

The buyer picks the format on `/bundle.html`. Prices and status live on the
Firestore course records, so change them in Manage Courses without a deploy.

## Launch checklist (one time)

1. **Deploy** rules and functions (merging to `main` does this).
2. **Nothing to configure for downloads.** The reader fetches the EPUB from
   `/api/book-file` on the site's own domain (a Hosting rewrite to the
   `bookFile` function, which checks the member's ID token and ownership the
   same way `storage.rules` does), so the Storage bucket needs no CORS setup.
   `storage-cors.json` is kept only for the direct-Storage fallback.
3. **Upload the book from the admin area.** Export the final manuscript as
   EPUB (Vellum, Atticus, Kindle Create, Draft2Digital or Calibre). Open
   **Library** in the admin rail (`/manage-library.html`), click **Add book**,
   drop in the EPUB and cover, set visibility to **Hidden**, tick the courses
   that include it (the two I Can't bundles and the course), and save.
   - Proof it with **Open in reader** (owners and admins can always open a
     hidden book), then edit it and switch visibility to **Live**.
   - **Grant to enrolled members** adds it to anyone who was already in an
     attached course. New buyers get it automatically.
   - A new edition is the same flow: edit, choose the new EPUB, save. Every
     device refreshes its copy on next open; pages and bookmarks are kept.

   The CLI does the same thing if you prefer a terminal:
   `cd scripts && node upload-book.js --id=i-cant --epub=... --cover=... --status=hidden`.
4. **Switch the bundle to digital** (one time):

   ```bash
   cd scripts && npm install
   node setup-digital-library.js            # dry run
   node setup-digital-library.js --apply
   ```

   This sets `shipsBook: false` on `bundle-icant` (an old `true` on the record
   would otherwise keep collecting addresses) and creates `bundle-icant-print`
   with the same status as the digital bundle. It also grants the book to
   existing members, the same as the button above.

## Chapter links from the course

Each I Can't module links to `/read?book=i-cant&chapter=N` (0 is the
Introduction). The reader finds the chapter by matching "Chapter N" or
"Introduction" in the EPUB's table of contents. If your EPUB titles chapters
differently, set `chapterHrefs` on `books/i-cant`, e.g.
`{ "0": "text/intro.xhtml", "1": "text/ch01.xhtml" }`.

## Free previews (open access)

A book marked **open access** can be read by anyone with its link, no
account: `/read?book={id}`. It is meant for a sample like the I Can't chapter
one preview, never the full book.

- `bookFile` serves it without a token while it is **Live**; Hidden stays
  admins only, for proofing. storage.rules do not change, so the
  same-origin route is the only way in.
- The books the courses sell by default (`COURSE_FULFILLMENT`) are never
  served this way, whatever their record says. Manage Library and
  `upload-book.js` also refuse open access on a book attached to a course.
- A "Get the book" button stays on every page, leading to the book's
  `buyHref` (Manage Library: **Buy link**; `/#shop` by default for a
  preview). A guest's reading position is kept on their device.

**Making the chapter one preview from the full EPUB** (no install needed):

```bash
node scripts/make-preview-epub.js --in=i-cant.epub --out=i-cant-preview.epub   # --dry-run to see the cut first
```

It keeps everything before Chapter 2 (cover, front matter, Introduction,
Chapter 1), deletes the later chapters from the file, prunes the contents and
any printed contents page, and adds a closing "Keep Reading" page linking the
book on the website (`/#shop`, override with `--buy=`), free Module 1
(`/book-bonus.html`) and the bundle. Then upload it in
Manage Library as its own book (id `i-cant-preview`, no courses ticked, tick
**Open access**), proof it Hidden, switch it Live, and use **copy link**. Or:
`cd scripts && node upload-book.js --id=i-cant-preview --epub=../i-cant-preview.epub --title="I Can't: Chapter One Preview" --author="Anthony Brown Sr." --status=hidden --open-access`.

## New editions

Re-run `upload-book.js` with the new file. `version` changes, so every
device's offline copy refreshes on next open, and positions carry over.

## Tests

- `tests/books-fulfillment.test.cjs`: which purchases grant which books (unit).
- `tests/firestore-rules.test.mjs`, `tests/storage-rules.test.mjs`: ownership can't be self-granted, the EPUB is served to owners only (emulators).
- `tests/purchase-email.test.cjs`: what the confirmation email says (unit).
- `tests/preview-epub.test.cjs`: the preview cut leaves no later chapter in the file, contents pruned, closing page added (unit).
- `tests/purchase-e2e.test.mjs` (`cd tests && npm run e2e:purchase`): a signed Stripe `checkout.session.completed` posted to the shipped webhook on the Functions emulator, for both bundles: enrollment, the real book id in `ownedBookIds`, purchase and shipping-order records, Stripe retry idempotency, and the confirmation email captured from a local stand-in for the email provider.
- `tests/reader-e2e.test.mjs`: the shipped reader and `books.js` against the Auth, Firestore and Storage emulators in Chromium: real download through the rule, position and bookmark sync across two devices, IndexedDB cache and version bump, non-owner denied, library shelf, and an admin uploading through Manage Library (file lands in Storage, record and course attachment in Firestore, PDF refused, hidden book proofable, re-upload bumps the edition, non-admin turned away). Needs Playwright and a sample EPUB:

  ```bash
  cd tests && READER_E2E_EPUB=/path/to/sample.epub npm run e2e:reader
  ```

The emulator ports live in the root `firebase.json` (`emulators` block); run emulator commands from the repo root.
