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
3. **Upload the book.** Export the final manuscript as EPUB (Vellum, Atticus,
   Kindle Create, Draft2Digital or Calibre), then:

   ```bash
   cd scripts && npm install
   node upload-book.js --id=i-cant --epub=/path/to/book.epub --cover=/path/to/cover.jpg \
     --title="I Can't: Is Not A Strategy" --author="Anthony Brown Sr." --status=hidden
   ```

   `--status=hidden` lets you (owner/admin) proof it at `/read?book=i-cant`
   before members see it. Re-run without it to publish.
4. **Switch the bundle to digital and grant existing members:**

   ```bash
   node setup-digital-library.js            # dry run
   node setup-digital-library.js --apply
   ```

   This sets `shipsBook: false` on `bundle-icant` (an old `true` on the record
   would otherwise keep collecting addresses), creates `bundle-icant-print`
   with the same status as the digital bundle, and adds the book to everyone
   already enrolled.

## Chapter links from the course

Each I Can't module links to `/read?book=i-cant&chapter=N` (0 is the
Introduction). The reader finds the chapter by matching "Chapter N" or
"Introduction" in the EPUB's table of contents. If your EPUB titles chapters
differently, set `chapterHrefs` on `books/i-cant`, e.g.
`{ "0": "text/intro.xhtml", "1": "text/ch01.xhtml" }`.

## New editions

Re-run `upload-book.js` with the new file. `version` changes, so every
device's offline copy refreshes on next open, and positions carry over.
