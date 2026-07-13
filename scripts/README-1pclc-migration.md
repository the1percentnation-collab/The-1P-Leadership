# 1P-CLC content migration (audit item R1)

**Problem:** the flagship `1p-clc` course's lessons live in `public/js/modules.js`
as JavaScript `render()` functions, which Firebase Hosting serves to anyone — so
that course's content is not protected by the enrollment gate that now covers
every Firestore-backed course (`courses/{slug}/modules`). This folder holds the
tooling to migrate it into gated Firestore docs.

**Why it isn't automated:** the lessons interleave per-user runtime state
(`store.isComplete`, `getNotes`, notes textareas, completion banners) into the
HTML, so they can only be captured by running them in a real browser session.
The content must also land in the live Firestore DB. Both are your actions.

## Cutover order — do not reorder

1. **Extract** — sign in as an admin account with **no 1P-CLC progress/notes**,
   open the 1P-CLC page, paste `extract-1pclc.js` into the DevTools console. It
   downloads `1pclc-content.json`. **Review the HTML** (empty notes/completion
   chrome stripped; check nothing personal leaked).
2. **Dry-run migrate** — `GOOGLE_APPLICATION_CREDENTIALS=./sa.json node
   migrate-1pclc.js` (from this folder, with `firebase-admin` available — e.g. run
   inside `../functions`). Review the printed plan.
3. **Commit migrate** — same command with `--commit`. Writes
   `courses/1p-clc/modules/{id}`.
4. **Verify** — as an **enrolled** member, confirm the lessons load via the
   Firestore course player (the enrollment rules gate applies). Do not proceed
   until this passes.
5. **Flip the source** — set `courses/1p-clc.contentSource = 'firestore'` on the
   course doc. This flag already exists and is honored by `loadModulesMeta` in
   `public/js/courses-data.js:122`. Confirm the roadmap + player render 1P-CLC
   end-to-end from Firestore. (If the content-render path for 1P-CLC still routes
   through `modules.js` rather than the Firestore player, that final wiring is the
   last code step — verify before flipping in prod.)
6. **Remove the leak** — only now delete the lesson bodies from
   `public/js/modules.js`. The enrollment gate then protects 1P-CLC automatically.

**Never** flip step 5/6 before step 4 passes — pointing the renderer at empty
Firestore docs would white-screen the live $497 course.

## Files
- `extract-1pclc.js` — browser-console extractor (read-only; downloads JSON).
- `migrate-1pclc.js` — Admin SDK writer; **dry-run by default**, `--commit` to write.
