// Storage security-rules tests for the digital library.
//
// The EPUB at books/{bookId}/book.epub is the paid product itself. The only
// thing standing between it and the internet is storage.rules reading
// users/{uid}.ownedBookIds from Firestore, so these run against the real
// Storage + Firestore emulators (the rule is a cross-service lookup).
//
// Run (from the repo root, which holds firebase.json):
//   tests/node_modules/.bin/firebase emulators:exec --only firestore,storage \
//     --project demo-1p "cd tests && node storage-rules.test.mjs"
import fs from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, getBytes, listAll, uploadBytes } from 'firebase/storage';

const env = await initializeTestEnvironment({
  projectId: 'demo-1p',
  firestore: {
    host: '127.0.0.1',
    port: 8080,
    rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  },
  storage: {
    host: '127.0.0.1',
    port: 9199,
    rules: fs.readFileSync(new URL('../storage.rules', import.meta.url), 'utf8')
  }
});

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, String(e.message || e).split('\n')[0]]); }
}

const EPUB = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/reader'), { email: 'reader@x.com', role: 'user', ownedBookIds: ['i-cant'] });
  await setDoc(doc(db, 'users/other'), { email: 'other@x.com', role: 'user', ownedBookIds: ['another-book'] });
  await setDoc(doc(db, 'users/nobooks'), { email: 'nobooks@x.com', role: 'user' });
  await setDoc(doc(db, 'users/adm'), { email: 'adm@x.com', role: 'admin' });
  const st = ctx.storage();
  await uploadBytes(ref(st, 'books/i-cant/book.epub'), EPUB, { contentType: 'application/epub+zip' });
  await uploadBytes(ref(st, 'books/i-cant/cover.jpg'), new Uint8Array([0xff, 0xd8, 0xff]), { contentType: 'image/jpeg' });
});

const reader = env.authenticatedContext('reader').storage();
const other = env.authenticatedContext('other').storage();
const nobooks = env.authenticatedContext('nobooks').storage();
const adm = env.authenticatedContext('adm').storage();
const owner = env.authenticatedContext('own', { role: 'owner' }).storage();
const anon = env.unauthenticatedContext().storage();

await t('owner of the book CAN download it',
  () => assertSucceeds(getBytes(ref(reader, 'books/i-cant/book.epub'))));

await t('member who owns a different book CANNOT download it',
  () => assertFails(getBytes(ref(other, 'books/i-cant/book.epub'))));

await t('member with no books CANNOT download it',
  () => assertFails(getBytes(ref(nobooks, 'books/i-cant/book.epub'))));

await t('signed-out visitor CANNOT download it',
  () => assertFails(getBytes(ref(anon, 'books/i-cant/book.epub'))));

await t('admin CAN download it to proof an upload',
  () => assertSucceeds(getBytes(ref(adm, 'books/i-cant/book.epub'))));

await t('anyone CAN load the cover',
  () => assertSucceeds(getBytes(ref(anon, 'books/i-cant/cover.jpg'))));

await t('book owner CANNOT overwrite the book',
  () => assertFails(uploadBytes(ref(reader, 'books/i-cant/book.epub'), EPUB, { contentType: 'application/epub+zip' })));

await t('site owner CAN upload a new edition',
  () => assertSucceeds(uploadBytes(ref(owner, 'books/i-cant/book.epub'), EPUB, { contentType: 'application/epub+zip' })));

await t('site owner CANNOT upload a non-EPUB as the book',
  () => assertFails(uploadBytes(ref(owner, 'books/i-cant/book.epub'), EPUB, { contentType: 'application/pdf' })));

// Audiobook chapters: admins upload them under their own names and size
// ceiling; only owners of the audiobook can read them directly.
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
await t('site owner CAN upload an audiobook chapter',
  () => assertSucceeds(uploadBytes(ref(owner, 'books/i-cant/audio-01.mp3'), MP3, { contentType: 'audio/mpeg' })));
await t('site owner CAN upload an M4A chapter',
  () => assertSucceeds(uploadBytes(ref(owner, 'books/i-cant/audio-02.m4a'), MP3, { contentType: 'audio/mp4' })));
await t('book owner CAN read an audiobook chapter',
  () => assertSucceeds(getBytes(ref(reader, 'books/i-cant/audio-01.mp3'))));
await t('member without the book CANNOT read an audiobook chapter',
  () => assertFails(getBytes(ref(nobooks, 'books/i-cant/audio-01.mp3'))));
await t('signed-out visitor CANNOT read an audiobook chapter',
  () => assertFails(getBytes(ref(anon, 'books/i-cant/audio-01.mp3'))));
await t('book owner CANNOT upload a chapter',
  () => assertFails(uploadBytes(ref(reader, 'books/i-cant/audio-03.mp3'), MP3, { contentType: 'audio/mpeg' })));
await t('site owner CANNOT upload audio under any other file name',
  () => assertFails(uploadBytes(ref(owner, 'books/i-cant/book.epub'), MP3, { contentType: 'audio/mpeg' })));
await t('site owner CANNOT upload a non-audio file as a chapter',
  () => assertFails(uploadBytes(ref(owner, 'books/i-cant/audio-04.mp3'), MP3, { contentType: 'application/zip' })));

// Alignment Audit scorecard logos: the owner's builder only.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
await t('site owner CAN upload a client logo for a scorecard',
  () => assertSucceeds(uploadBytes(ref(owner, 'auditScorecards/sc1/logo-1.png'), PNG, { contentType: 'image/png' })));
await t('site owner CAN read a scorecard logo',
  () => assertSucceeds(getBytes(ref(owner, 'auditScorecards/sc1/logo-1.png'))));
await t('site owner CANNOT upload a non-image as a scorecard logo',
  () => assertFails(uploadBytes(ref(owner, 'auditScorecards/sc1/logo-2.pdf'), PNG, { contentType: 'application/pdf' })));
await t('admin CANNOT upload a scorecard logo',
  () => assertFails(uploadBytes(ref(adm, 'auditScorecards/sc1/logo-3.png'), PNG, { contentType: 'image/png' })));
await t('member CANNOT read a scorecard logo',
  () => assertFails(getBytes(ref(reader, 'auditScorecards/sc1/logo-1.png'))));

// The One Percent Membership does not include books: an active member reads
// only the books they own, like anyone else.
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'users/memb'), { email: 'memb@x.com', role: 'user', membershipActive: true });
});
await t('active member CANNOT download a book they did not buy',
  () => assertFails(getBytes(ref(env.authenticatedContext('memb').storage(), 'books/i-cant/book.epub'))));

// ── Paid course files: enrolled learners and admins only ──────────────────
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/learner'), { email: 'learner@x.com', role: 'user', enrolledCourseSlugs: ['icant'] });
  await setDoc(doc(db, 'users/freebie'), { email: 'freebie@x.com', role: 'user', enrolledCourseSlugs: ['the-brief'] });
  const st = ctx.storage();
  await uploadBytes(ref(st, 'courses/icant/videos/l1.mp4'), new Uint8Array([0, 0, 0, 24]), { contentType: 'video/mp4' });
  await uploadBytes(ref(st, 'courses/icant/attachments/workbook.pdf'), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' });
});
const learner = env.authenticatedContext('learner').storage();
const freebie = env.authenticatedContext('freebie').storage();
await t('an enrolled learner CAN read the course video and attachment',
  () => Promise.all([
    assertSucceeds(getBytes(ref(learner, 'courses/icant/videos/l1.mp4'))),
    assertSucceeds(getBytes(ref(learner, 'courses/icant/attachments/workbook.pdf')))
  ]));
await t('a free account enrolled elsewhere CANNOT read a paid course video',
  () => assertFails(getBytes(ref(freebie, 'courses/icant/videos/l1.mp4'))));
await t('a free account CANNOT list a paid course folder',
  () => assertFails(listAll(ref(freebie, 'courses/icant/videos'))));
await t('a free account CANNOT read a paid course attachment',
  () => assertFails(getBytes(ref(freebie, 'courses/icant/attachments/workbook.pdf'))));
await t('a signed-out visitor CANNOT read a course video',
  () => assertFails(getBytes(ref(anon, 'courses/icant/videos/l1.mp4'))));
await t('an admin and the owner CAN read course files (uploads, previews)',
  () => Promise.all([
    assertSucceeds(getBytes(ref(adm, 'courses/icant/videos/l1.mp4'))),
    assertSucceeds(getBytes(ref(owner, 'courses/icant/attachments/workbook.pdf')))
  ]));

await env.cleanup();

let failed = 0;
for (const r of results) {
  if (r[0] === 'FAIL') failed++;
  console.log(`${r[0] === 'PASS' ? '✅' : '❌'} ${r[1]}${r[2] ? ' — ' + r[2] : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
