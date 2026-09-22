// The digital library, end to end, on the real Firebase emulators.
//
// The rules tests prove who may read the EPUB; the reader UI test proves the
// page turns. This runs the shipped data layer between them: public/js/books.js
// downloading books/{id}/book.epub through storage.rules with getBlob(),
// syncing the reading position to users/{uid}/bookProgress, and caching the
// file in IndexedDB. Nothing in public/ is stubbed except the two lines that
// point the SDK at the emulators and the sign-in.
//
// Needs the Auth, Firestore and Storage emulators, Chromium via Playwright,
// and a sample EPUB. From the repo root (which holds firebase.json):
//   READER_E2E_EPUB=/path/to/sample.epub \
//   tests/node_modules/.bin/firebase emulators:exec --only auth,firestore,storage \
//     --project demo-1p "node tests/reader-e2e.test.mjs"
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PUB = path.join(ROOT, 'public');
const SDK_DIR = path.join(ROOT, 'tests', 'node_modules', 'firebase');
const PROJECT = 'demo-1p';
const BUCKET = `${PROJECT}.appspot.com`;
const AUTH = 'http://127.0.0.1:9099';
const PORT = 8765;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const EPUB_PATH = process.env.READER_E2E_EPUB;
if (!EPUB_PATH || !fs.existsSync(EPUB_PATH)) {
  console.error('Set READER_E2E_EPUB to a sample .epub');
  process.exit(1);
}

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static server for public/ ─────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  if (p === '/') p = '/index.html';
  let f = path.join(PUB, p);
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html'; // cleanUrls
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ── Emulator users + seed ─────────────────────────────────────────────────
async function createAuthUser(email, password) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const j = await r.json();
  if (!j.localId) throw new Error('auth emulator signUp failed: ' + JSON.stringify(j));
  return j.localId;
}
const PW = 'password123';
const ownerUid = await createAuthUser('owner@e2e.test', PW);
const otherUid = await createAuthUser('other@e2e.test', PW);

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
  storage: { host: '127.0.0.1', port: 9199, rules: fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8') }
});
const epubBytes = fs.readFileSync(EPUB_PATH);
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'books/i-cant'), { title: 'I Can\'t: Is Not A Strategy', author: 'Anthony Brown Sr.', status: 'live', version: '1', filePath: 'books/i-cant/book.epub', buyHref: '/bundle.html' });
  await setDoc(doc(db, `users/${ownerUid}`), { email: 'owner@e2e.test', role: 'user', onboardingComplete: true, ownedBookIds: ['i-cant'] });
  await setDoc(doc(db, `users/${otherUid}`), { email: 'other@e2e.test', role: 'user', onboardingComplete: true, ownedBookIds: [] });
  await uploadBytes(ref(ctx.storage(`gs://${BUCKET}`), 'books/i-cant/book.epub'), epubBytes, { contentType: 'application/epub+zip' });
});
async function readProgress(uid) {
  let out = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const s = await getDoc(doc(ctx.firestore(), `users/${uid}/bookProgress/i-cant`));
    out = s.exists() ? s.data() : null;
  });
  return out;
}

// ── The two shipped files that need pointing at the emulators ─────────────
const firebaseJs = fs.readFileSync(path.join(PUB, 'js/firebase.js'), 'utf8')
  .replace('projectId: "the-1p-leadership"', `projectId: "${PROJECT}"`)
  .replace('storageBucket: "the-1p-leadership.firebasestorage.app"', `storageBucket: "${BUCKET}"`)
  + `
import { connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, connectStorageEmulator } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
connectAuthEmulator(_auth, '${AUTH}', { disableWarnings: true });
connectFirestoreEmulator(_db, '127.0.0.1', 8080);
connectStorageEmulator(getStorage(_app), '127.0.0.1', 9199);
`;
// auth.js as shipped, except the user the test context names is signed in
// before the first auth-state check, the way a persisted session would be.
const shippedAuth = fs.readFileSync(path.join(PUB, 'js/auth.js'), 'utf8');
const authHook = `if (firebaseReady) {
  const __who = JSON.parse(localStorage.getItem('__e2e_user') || 'null');
  (__who ? signInWithEmailAndPassword(auth, __who.email, __who.password) : Promise.resolve())
    .catch((e) => console.error('e2e sign-in failed', e))
    .then(() => onAuthStateChanged(auth, (u) => {`;
if (!shippedAuth.includes('if (firebaseReady) {\n  onAuthStateChanged(auth, (u) => {')) throw new Error('auth.js shape changed; update the e2e hook');
const authJs = shippedAuth
  .replace('if (firebaseReady) {\n  onAuthStateChanged(auth, (u) => {', authHook)
  .replace(/_authReadyResolve\(u\);\n  \}\);\n\}/, '_authReadyResolve(u);\n  }));\n}');

const SDK_MAP = { 'firebase-app.js': 'firebase-app.js', 'firebase-auth.js': 'firebase-auth.js', 'firebase-firestore.js': 'firebase-firestore.js', 'firebase-functions.js': 'firebase-functions.js', 'firebase-storage.js': 'firebase-storage.js', 'firebase-app-check.js': 'firebase-app-check.js' };

const browser = await chromium.launch();
const storageHits = new Map(); // context id -> count of EPUB downloads

async function makeContext(who, { device = devices['iPhone 13'], id = 'ctx' } = {}) {
  const ctx = await browser.newContext(device);
  storageHits.set(id, 0);
  await ctx.addInitScript((w) => { localStorage.setItem('__e2e_user', JSON.stringify(w)); }, who);
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'www.gstatic.com') {
      const base = path.basename(u.pathname);
      // The npm bundles import each other by their own version's CDN URL;
      // rewrite it so every module resolves to the one URL the site uses.
      if (SDK_MAP[base]) return route.fulfill({
        body: fs.readFileSync(path.join(SDK_DIR, SDK_MAP[base]), 'utf8').replace(/firebasejs\/[\d.]+\//g, 'firebasejs/10.12.0/'),
        contentType: 'text/javascript'
      });
      return route.abort();
    }
    if (u.port === '9199' && u.pathname.includes('book.epub') && route.request().method() === 'GET') storageHits.set(id, storageHits.get(id) + 1);
    if (u.hostname === '127.0.0.1' && u.port === String(PORT)) {
      if (u.pathname === '/js/firebase.js') return route.fulfill({ body: firebaseJs, contentType: 'text/javascript' });
      if (u.pathname === '/js/auth.js') return route.fulfill({ body: authJs, contentType: 'text/javascript' });
      return route.continue();
    }
    if (u.hostname === '127.0.0.1') return route.continue(); // emulators
    return route.abort(); // fonts, analytics
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', e.message));
  page.on('requestfailed', (r) => { if (/127\.0\.0\.1:9(099|199)/.test(r.url())) console.log('   [requestfailed]', r.method(), r.url().slice(0, 120), r.failure() && r.failure().errorText); });
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|googleapis.com\/css/.test(m.text())) console.log('   [console]', m.text().slice(0, 200)); });
  return { ctx, page };
}
const OWNER = { email: 'owner@e2e.test', password: PW };
const OTHER = { email: 'other@e2e.test', password: PW };
const opened = (page) => page.waitForSelector('#splash.gone', { timeout: 30000 });
const fraction = (page) => page.evaluate(() => document.querySelector('foliate-view')?.lastLocation?.fraction ?? null);
const hasIdb = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('1p-library', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('files');
  r.onsuccess = () => { const tx = r.result.transaction('files', 'readonly'); const g = tx.objectStore('files').getAllKeys(); g.onsuccess = () => res(g.result); g.onerror = () => res([]); };
  r.onerror = () => res(null);
}));

let firstCfi = null;
let tapFraction = null;

// ── 1. Owner: real download, page turns, synced position ─────────────────
const A = await makeContext(OWNER, { id: 'A' });
await t('owner opens the book through storage.rules with getBlob()', async () => {
  await A.page.goto(`${ORIGIN}/read?book=i-cant`);
  await opened(A.page);
  await A.page.waitForTimeout(600);
  assert(storageHits.get('A') === 1, `expected 1 EPUB download, saw ${storageHits.get('A')}`);
  assert((await A.page.textContent('#run-head')).length > 0, 'no running header');
});

await t('turning pages writes the position to Firestore', async () => {
  const w = A.page.viewportSize().width, h = A.page.viewportSize().height;
  for (let i = 0; i < 3; i++) { await A.page.mouse.click(w * 0.9, h / 2); await A.page.waitForTimeout(900); }
  tapFraction = await fraction(A.page);
  assert(tapFraction > 0.01, 'did not advance');
  await A.page.waitForTimeout(3600); // 3s debounce + write
  const p = await readProgress(ownerUid);
  assert(p && typeof p.cfi === 'string' && p.cfi.startsWith('epubcfi('), 'no CFI synced: ' + JSON.stringify(p));
  assert(Math.abs(p.fraction - tapFraction) < 0.02, `synced fraction ${p.fraction} vs ${tapFraction}`);
  firstCfi = p.cfi;
});

await t('a bookmark syncs too', async () => {
  const w = A.page.viewportSize().width, h = A.page.viewportSize().height;
  await A.page.mouse.click(w / 2, h / 2); await A.page.waitForTimeout(400);
  await A.page.click('#bookmark-btn'); await A.page.waitForTimeout(3600);
  const p = await readProgress(ownerUid);
  assert(p && Array.isArray(p.bookmarks) && p.bookmarks.length === 1, 'bookmark not synced: ' + JSON.stringify(p && p.bookmarks));
});

await t('the EPUB is cached in IndexedDB under id:version', async () => {
  const keys = await hasIdb(A.page);
  assert(keys && keys.includes('i-cant:1'), 'cache keys: ' + JSON.stringify(keys));
});

await t('a reload opens from the cache without another download', async () => {
  await A.page.reload(); await opened(A.page); await A.page.waitForTimeout(600);
  assert(storageHits.get('A') === 1, `expected no new download, saw ${storageHits.get('A')} total`);
  const f = await fraction(A.page);
  assert(Math.abs(f - tapFraction) < 0.02, `resumed at ${f}, expected ${tapFraction}`);
});

// ── 2. Same user, fresh device: resumes from Firestore ───────────────────
const B = await makeContext(OWNER, { id: 'B', device: { viewport: { width: 1200, height: 800 } } });
await t('a second device resumes from the synced position and sees the bookmark', async () => {
  await B.page.goto(`${ORIGIN}/read?book=i-cant`);
  await opened(B.page); await B.page.waitForTimeout(800);
  const f = await fraction(B.page);
  assert(Math.abs(f - tapFraction) < 0.03, `fresh device opened at ${f}, expected ~${tapFraction}`);
  const on = await B.page.evaluate(() => document.getElementById('bookmark-btn').classList.contains('on'));
  assert(on, 'bookmark not shown on the second device');
});

await t('a new edition (version bump) is downloaded and replaces the cache', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'books/i-cant'), { version: '2' }, { merge: true });
  });
  const before = storageHits.get('A');
  await A.page.reload(); await opened(A.page); await A.page.waitForTimeout(800);
  assert(storageHits.get('A') === before + 1, 'new version was not downloaded');
  const keys = await hasIdb(A.page);
  assert(keys.includes('i-cant:2') && !keys.includes('i-cant:1'), 'cache not replaced: ' + JSON.stringify(keys));
});

// ── 3. Non-owner ──────────────────────────────────────────────────────────
const C = await makeContext(OTHER, { id: 'C' });
await t('a member who does not own the book is stopped, and no file is fetched', async () => {
  await C.page.goto(`${ORIGIN}/read?book=i-cant`);
  await C.page.waitForFunction(() => /isn't in your library/.test(document.getElementById('splash-msg').textContent), null, { timeout: 20000 });
  assert(storageHits.get('C') === 0, 'non-owner triggered a download');
  const hasView = await C.page.evaluate(() => !!document.querySelector('foliate-view'));
  assert(!hasView, 'reader mounted for a non-owner');
});

await t('storage.rules deny the file to a non-owner even when asked directly', async () => {
  const denied = await C.page.evaluate(async () => {
    const { app } = await import('/js/firebase.js');
    const { getStorage, ref, getBlob } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js');
    try { await getBlob(ref(getStorage(app), 'books/i-cant/book.epub')); return false; } catch (e) { return /unauthorized|403|permission/i.test(String(e.code || e.message)); }
  });
  assert(denied, 'non-owner could fetch the EPUB');
});

// ── 4. Library shelf, real data ──────────────────────────────────────────
await t('the library shelf shows the owned book with its synced progress', async () => {
  await B.page.goto(`${ORIGIN}/library`);
  await B.page.waitForSelector('.lib-continue', { timeout: 20000 });
  const txt = await B.page.textContent('.lib-continue');
  assert(/I Can't/.test(txt), 'book missing from shelf');
  assert(/[1-9]\d?%/.test(txt), 'progress not shown: ' + txt.replace(/\s+/g, ' ').slice(0, 200));
});

await t('a member with no books sees the empty shelf, not an error', async () => {
  await C.page.goto(`${ORIGIN}/library`);
  await C.page.waitForSelector('.lib-empty', { timeout: 20000 });
  assert(/empty/i.test(await C.page.textContent('.lib-empty')));
});

await browser.close();
server.close();
await env.cleanup();

const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of failed) console.log('   ', r[1], '=>', r[2]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
