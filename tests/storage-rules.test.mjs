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
import { ref, getBytes, uploadBytes } from 'firebase/storage';

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

await env.cleanup();

let failed = 0;
for (const r of results) {
  if (r[0] === 'FAIL') failed++;
  console.log(`${r[0] === 'PASS' ? '✅' : '❌'} ${r[1]}${r[2] ? ' — ' + r[2] : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
