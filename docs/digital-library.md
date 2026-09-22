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
| Reader | `/read?book={id}[&chapter=N]` (`read.html`, `js/reader.js`, `vendor/foliate-js`) |
| Admin upload | `/manage-library.html` (`js/manage-library.js`, `js/library-admin.js`); `syncBookGrants` callable grants to existing members |

Every way into a course (checkout, a 100% promo code, enrollFree, admin and
beta grants) goes through `enrollmentFields()`, which adds the course's books
to `ownedBookIds`. Books are kept for life: cancelling a subscription or
revoking a beta grant does not remove them.

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
2. **Allow browser downloads from Storage.** The reader fetches the EPUB with
   the Storage SDK (`getBlob`), which needs CORS on the bucket:

   ```bash
   gcloud storage buckets update gs://the-1p-leadership.firebasestorage.app --cors-file=storage-cors.json
   ```

   Add any other domain that serves the site to `storage-cors.json` first.
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

## New editions

Re-run `upload-book.js` with the new file. `version` changes, so every
device's offline copy refreshes on next open, and positions carry over.

## Tests

- `tests/books-fulfillment.test.cjs`: which purchases grant which books (unit).
- `tests/firestore-rules.test.mjs`, `tests/storage-rules.test.mjs`: ownership can't be self-granted, the EPUB is served to owners only (emulators).
- `tests/reader-e2e.test.mjs`: the shipped reader and `books.js` against the Auth, Firestore and Storage emulators in Chromium: real download through the rule, position and bookmark sync across two devices, IndexedDB cache and version bump, non-owner denied, library shelf, and an admin uploading through Manage Library (file lands in Storage, record and course attachment in Firestore, PDF refused, hidden book proofable, re-upload bumps the edition, non-admin turned away). Needs Playwright and a sample EPUB:

  ```bash
  cd tests && READER_E2E_EPUB=/path/to/sample.epub npm run e2e:reader
  ```

The emulator ports live in the root `firebase.json` (`emulators` block); run emulator commands from the repo root.
