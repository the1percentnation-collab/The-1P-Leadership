#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Upload a book to the digital library.
//
// Puts the EPUB (and optionally a cover) in Storage under books/{id}/ and
// writes books/{id}, the record the library shelf and the reader read. Run it
// again with a new file to publish a revised edition: `version` changes, so
// every reader's offline copy refreshes on their next open, and reading
// positions carry over (they are EPUB CFIs, not page numbers).
//
// USAGE
//   cd scripts && npm install          (once)
//   node upload-book.js --id=i-cant --epub=/path/to/book.epub \
//     --cover=/path/to/cover.jpg --title="I Can't: Is Not A Strategy" \
//     --author="Anthony Brown Sr."
//
//   --status=hidden   upload for proofing: only owners/admins see it
//   --dry-run         check the files and print the plan, write nothing
//
// Who can read the file is decided by storage.rules (users/{uid}.ownedBookIds),
// not by this script. Courses grant the book through `grantsBooks`.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initAdmin, assertCredentials } = require('./lib/init');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const DRY_RUN = process.argv.includes('--dry-run');

const id = (arg('id') || '').trim();
const epubPath = arg('epub');
const coverPath = arg('cover');
const title = arg('title');
const author = arg('author');
const status = arg('status') || 'live';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(id)) fail('--id is required: lowercase letters, numbers and dashes (e.g. i-cant).');
if (!epubPath || !fs.existsSync(epubPath)) fail('--epub must point at an .epub file.');
if (coverPath && !fs.existsSync(coverPath)) fail(`--cover file not found: ${coverPath}`);
if (!['live', 'hidden'].includes(status)) fail('--status must be live or hidden.');

// An EPUB is a zip whose first entry is an uncompressed file named
// "mimetype" containing "application/epub+zip". Checking that here catches a
// PDF or a .docx passed by mistake before it reaches readers.
const epub = fs.readFileSync(epubPath);
function firstEntry(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const name = buf.slice(30, 30 + nameLen).toString('latin1');
  const start = 30 + nameLen + extraLen;
  return { name, body: buf.slice(start, start + 20).toString('latin1') };
}
const entry = firstEntry(epub);
if (!entry || entry.name !== 'mimetype' || entry.body !== 'application/epub+zip') {
  fail(`${epubPath} is not a valid EPUB (expected a zip starting with an "application/epub+zip" mimetype entry).\n` +
    'Export the book as EPUB from Vellum, Atticus, Kindle Create, Draft2Digital or Calibre and try again.');
}
if (epub.length > 50 * 1024 * 1024) fail('The EPUB is over 50MB. Compress the images inside it and try again.');

const coverExt = coverPath ? path.extname(coverPath).toLowerCase().replace('.', '') : null;
const COVER_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
if (coverPath && !COVER_TYPES[coverExt]) fail('--cover must be a .jpg, .png or .webp image.');

async function main() {
  const { admin, db, projectId } = initAdmin();
  await assertCredentials(db, projectId);
  const bucketName = process.env.STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
  const bucket = admin.storage().bucket(bucketName);

  const filePath = `books/${id}/book.epub`;
  const version = String(Date.now());
  console.log(`Project:  ${projectId}`);
  console.log(`Bucket:   ${bucketName}`);
  console.log(`Book:     books/${id}  (status: ${status})`);
  console.log(`EPUB:     ${epubPath} (${(epub.length / 1024 / 1024).toFixed(2)} MB) -> ${filePath}`);
  if (coverPath) console.log(`Cover:    ${coverPath} -> books/${id}/cover.${coverExt}`);
  if (DRY_RUN) { console.log('\n--dry-run: nothing written.'); return; }

  await bucket.file(filePath).save(epub, {
    resumable: false,
    contentType: 'application/epub+zip',
    // Private: served only through the Storage rules, never a public URL.
    metadata: { cacheControl: 'private, max-age=0' }
  });

  const doc = {
    filePath,
    version,
    status,
    buyHref: '/bundle.html',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (title) doc.title = title;
  if (author) doc.author = author;

  if (coverPath) {
    // The cover is public (storage.rules), so a token URL is fine here and
    // lets <img> load it without the SDK.
    const coverFile = `books/${id}/cover.${coverExt}`;
    const token = crypto.randomUUID();
    await bucket.file(coverFile).save(fs.readFileSync(coverPath), {
      resumable: false,
      contentType: COVER_TYPES[coverExt],
      metadata: { cacheControl: 'public, max-age=86400', metadata: { firebaseStorageDownloadTokens: token } }
    });
    doc.coverUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(coverFile)}?alt=media&token=${token}`;
  }

  const ref = db.collection('books').doc(id);
  const existing = await ref.get();
  if (!existing.exists) doc.createdAt = admin.firestore.FieldValue.serverTimestamp();
  if (!existing.exists && !title) console.warn('Note: no --title given, the reader will fall back to the EPUB\'s own title.');
  await ref.set(doc, { merge: true });

  console.log(`\nPublished books/${id} version ${version}.`);
  console.log(`Open it at /read?book=${id} (owners and admins can always open it).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
