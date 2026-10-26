// The advance reader sign-up (/arc), end to end on the real emulators: an
// account calls the shipped claimArcCopy and the test checks what the reader
// would then have. It pins the rules that matter: no review promise, no
// copy; a claim puts the full book in the library and is counted once; the
// reader gets one email with the reader link; a closed or full sign-up gives
// nothing away.
//
// Run: `npm run e2e:arc` in tests/ (writes fake secrets and removes them).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')]); console.log('❌', name, ':', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const emails = [];
const capture = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method === 'POST' && req.url.endsWith('/email_messages')) {
      emails.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { id: `msg_${emails.length}` } }));
      return;
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => capture.listen(8766, '127.0.0.1', r));

async function call(name, data, token) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data })
  });
  return r.json();
}

for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`${FN}/claimArcCopy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}' }); if (r.status) break; }
  catch (e) { /* not yet */ }
  await sleep(1000);
}

async function account(email, displayName) {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'e2e-pass-123', displayName, returnSecureToken: true })
  });
  const j = await r.json();
  return { uid: j.localId, token: j.idToken, email };
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const read = (p) => admin(async (db) => { const s = await getDoc(doc(db, p)); return s.exists() ? s.data() : null; });
const write = (p, d, merge = true) => admin((db) => setDoc(doc(db, p), d, { merge }));

await write('books/i-cant', { title: 'I Can’t: Is Not A Strategy', status: 'live', version: '1' });
await write('companies/academy', { name: 'Academy', adminUids: [] });

const reader = await account('reader@e2e.test', 'Jordan Reader');
const second = await account('second@e2e.test', 'Sam Second');
const late = await account('late@e2e.test', 'Lee Late');
const anyEmailTo = (to) => emails.filter((m) => JSON.stringify(m.to || '').includes(to));

await t('signed out: no copy', async () => {
  const r = await call('claimArcCopy', { agreesToReview: true });
  assert(r.error && r.error.status === 'UNAUTHENTICATED', JSON.stringify(r));
});

await t('no review promise: no copy', async () => {
  const r = await call('claimArcCopy', { agreesToReview: false }, reader.token);
  assert(r.error && r.error.status === 'INVALID_ARGUMENT', JSON.stringify(r));
  const u = await read(`users/${reader.uid}`);
  assert(!u || !(u.ownedBookIds || []).includes('i-cant'), 'book granted without a review promise');
});

await t('claim: the full book is in their library', async () => {
  const r = await call('claimArcCopy', { agreesToReview: true, reviewPlatform: 'Goodreads', consent: true }, reader.token);
  assert(r.result && r.result.ok && r.result.already === false, JSON.stringify(r));
  assert(r.result.readUrl === '/read?book=i-cant', r.result.readUrl);
  const u = await read(`users/${reader.uid}`);
  assert((u.ownedBookIds || []).includes('i-cant'), JSON.stringify(u));
});

await t('claim: one reader record, counted once', async () => {
  const a = await read(`arcReaders/${reader.uid}`);
  assert(a && a.email === 'reader@e2e.test' && a.reviewPlatform === 'Goodreads' && a.bookId === 'i-cant', JSON.stringify(a));
  const cfg = await read('config/arc');
  assert(cfg && cfg.claimed === 1, JSON.stringify(cfg));
});

await t('claim: the reader is in the CRM, tagged as an ARC reader', async () => {
  const contacts = await admin(async (db) => (await getDocs(collection(db, 'companies/academy/contacts'))).docs.map((d) => d.data()));
  const c = contacts.find((x) => x.email === 'reader@e2e.test');
  assert(c && (c.tags || []).includes('ARC Reader'), JSON.stringify(contacts));
});

await t('claim: one welcome email with the reader link', async () => {
  for (let i = 0; i < 20 && !anyEmailTo('reader@e2e.test').length; i++) await sleep(250);
  const mine = anyEmailTo('reader@e2e.test');
  assert(mine.length === 1, `got ${mine.length} emails`);
  assert(JSON.stringify(mine[0]).includes('https://the1pnation.com/read?book=i-cant'), 'no reader link');
});

await t('claiming again is a no-op: no second count or email', async () => {
  const r = await call('claimArcCopy', { agreesToReview: true }, reader.token);
  assert(r.result && r.result.already === true, JSON.stringify(r));
  await sleep(500);
  assert(anyEmailTo('reader@e2e.test').length === 1, 'sent a second email');
  assert((await read('config/arc')).claimed === 1, 'counted twice');
});

await t('a limit stops new claims once it is reached', async () => {
  await write('config/arc', { limit: 2 });
  const ok = await call('claimArcCopy', { agreesToReview: true }, second.token);
  assert(ok.result && ok.result.ok, JSON.stringify(ok));
  const full = await call('claimArcCopy', { agreesToReview: true }, late.token);
  assert(full.error && full.error.status === 'RESOURCE_EXHAUSTED', JSON.stringify(full));
  const u = await read(`users/${late.uid}`);
  assert(!u || !(u.ownedBookIds || []).includes('i-cant'), 'book granted past the limit');
});

await t('closed: nothing is given away', async () => {
  await write('config/arc', { limit: null, open: false });
  const r = await call('claimArcCopy', { agreesToReview: true }, late.token);
  assert(r.error && r.error.status === 'FAILED_PRECONDITION' && /closed/i.test(r.error.message), JSON.stringify(r));
});

await t('the reader can now download the book file', async () => {
  // bookFile serves the EPUB to owners; with no file in Storage it says so,
  // which proves the ownership check passed (a non-owner gets 403).
  const r = await fetch(`${FN}/bookFile?book=i-cant`, { headers: { Authorization: `Bearer ${reader.token}` } });
  const txt = await r.text();
  assert(r.status === 404 && /book file missing/.test(txt), `${r.status} ${txt}`);
  const no = await fetch(`${FN}/bookFile?book=i-cant`, { headers: { Authorization: `Bearer ${late.token}` } });
  assert(no.status === 403, `non-reader got ${no.status}`);
});

capture.close();
await env.cleanup();
const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of failed) console.log('   ', r[1], '=>', r[2]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
