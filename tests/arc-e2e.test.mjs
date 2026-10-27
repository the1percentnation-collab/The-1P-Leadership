// The advance reader sign-up (/arc), end to end on the real emulators: an
// account calls the shipped claimArcCopy and the test checks what the reader
// would then have. It pins the rules that matter: no review promise, no
// copy; a claim puts the full book in the library and is counted once; the
// reader gets one email with the reader link; a closed or full sign-up gives
// nothing away. Then the no-password path: the form (requestArcLink) emails
// a sign-in link, opening it signs the reader in, and the claim takes the
// name from the form; a fresh link works for a returning reader.
//
// Run: `npm run e2e:arc` in tests/ (writes fake secrets and removes them).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';

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

// ── No password: the form emails a sign-in link ────────────────────────
await write('config/arc', { limit: null, open: true });
const clearRateLimits = () => admin(async (db) => {
  const snap = await getDocs(collection(db, 'rateLimits'));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
});
await clearRateLimits();
// The sign-in link in the newest email to `to`, and its one-time code.
function linkTo(to) {
  const mine = anyEmailTo(to);
  const body = JSON.stringify(mine[mine.length - 1] || {});
  const m = body.match(/https?:\/\/[^"\\\s<>]*oobCode[^"\\\s<>]*/);
  if (!m) return null;
  const href = m[0].replace(/&amp;/g, '&');
  return { href, oobCode: new URL(href).searchParams.get('oobCode') };
}
async function openLink(email) {
  const link = linkTo(email);
  assert(link && link.oobCode, `no sign-in link in the email to ${email}`);
  const r = await fetch(`${AUTH}/accounts:signInWithEmailLink?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, oobCode: link.oobCode })
  });
  const j = await r.json();
  assert(j.idToken, `sign-in with the link failed: ${JSON.stringify(j)}`);
  return { uid: j.localId, token: j.idToken, email };
}
const waitForEmails = async (to, n) => {
  for (let i = 0; i < 20 && anyEmailTo(to).length < n; i++) await sleep(250);
  return anyEmailTo(to);
};

await t('the form needs a name, a valid email and the review promise', async () => {
  const noName = await call('requestArcLink', { firstName: 'Pat', email: 'link@e2e.test', agreesToReview: true });
  assert(noName.error && noName.error.status === 'INVALID_ARGUMENT' && /name/i.test(noName.error.message), JSON.stringify(noName));
  const noPromise = await call('requestArcLink', { firstName: 'Pat', lastName: 'Link', email: 'link@e2e.test' });
  assert(noPromise.error && noPromise.error.status === 'INVALID_ARGUMENT', JSON.stringify(noPromise));
  const badEmail = await call('requestArcLink', { firstName: 'Pat', lastName: 'Link', email: 'nope', agreesToReview: true });
  assert(badEmail.error && badEmail.error.status === 'INVALID_ARGUMENT', JSON.stringify(badEmail));
  assert(anyEmailTo('link@e2e.test').length === 0, 'emailed without a valid form');
});

await t('the form emails a one-tap sign-in link with the ARC terms, and grants nothing yet', async () => {
  const before = (await read('config/arc')).claimed;
  const r = await call('requestArcLink', { firstName: ' Pat ', lastName: 'Link', email: 'Link@E2E.test', agreesToReview: true, consent: true });
  assert(r.result && r.result.ok && r.result.returning === false, JSON.stringify(r));
  const mine = await waitForEmails('link@e2e.test', 1);
  assert(mine.length === 1, `got ${mine.length} emails`);
  const body = JSON.stringify(mine[0]);
  assert(/Your advance copy of/.test(body), 'wrong subject');
  assert(body.includes('I received a free advance copy in exchange for an honest review.'), 'no disclosure line');
  const link = linkTo('link@e2e.test');
  assert(link && link.oobCode, 'no sign-in link');
  assert(decodeURIComponent(link.href).includes('the1pnation.com/arc?claim=1'), `link does not come back to /arc: ${link.href}`);
  const reqs = await admin(async (db) => (await getDocs(collection(db, 'arcRequests'))).docs.map((d) => d.data()));
  assert(reqs.length === 1 && reqs[0].firstName === 'Pat' && reqs[0].lastName === 'Link' && reqs[0].email === 'link@e2e.test', JSON.stringify(reqs));
  assert((await read('config/arc')).claimed === before, 'counted before the link was opened');
});

let linkReader = null;
await t('opening the link signs them in; the claim uses the form and sends no second email', async () => {
  linkReader = await openLink('link@e2e.test');
  const r = await call('claimArcCopy', {}, linkReader.token);
  assert(r.result && r.result.ok && r.result.already === false && r.result.readUrl === '/read?book=i-cant', JSON.stringify(r));
  const a = await read(`arcReaders/${linkReader.uid}`);
  assert(a && a.name === 'Pat Link' && a.email === 'link@e2e.test', JSON.stringify(a));
  const u = await read(`users/${linkReader.uid}`);
  assert(u && (u.ownedBookIds || []).includes('i-cant') && u.displayName === 'Pat Link', JSON.stringify(u));
  const reqs = await admin(async (db) => (await getDocs(collection(db, 'arcRequests'))).docs.length);
  assert(reqs === 0, 'the sign-up form was not cleared');
  const contacts = await admin(async (db) => (await getDocs(collection(db, 'companies/academy/contacts'))).docs.map((d) => d.data()));
  const c = contacts.find((x) => x.email === 'link@e2e.test');
  assert(c && (c.tags || []).includes('ARC Reader') && (c.tags || []).includes('Opt-In: Calls/SMS/Email'), JSON.stringify(c));
  await sleep(500);
  assert(anyEmailTo('link@e2e.test').length === 1, 'sent a welcome email on top of the link');
});

await t('a returning reader gets a fresh link that opens the book again', async () => {
  const r = await call('requestArcLink', { email: 'link@e2e.test', resend: true });
  assert(r.result && r.result.ok && r.result.returning === true, JSON.stringify(r));
  const mine = await waitForEmails('link@e2e.test', 2);
  assert(mine.length === 2 && /Your reading link for/.test(JSON.stringify(mine[1])), `got ${mine.length} emails`);
  const again = await openLink('link@e2e.test');
  assert(again.uid === linkReader.uid, 'the fresh link made a second account');
  const c = await call('claimArcCopy', {}, again.token);
  assert(c.result && c.result.already === true, JSON.stringify(c));
});

await t('a fresh link for an unknown email sends nothing and answers the same', async () => {
  const r = await call('requestArcLink', { email: 'nobody@e2e.test', resend: true });
  assert(r.result && r.result.ok && r.result.returning === false, JSON.stringify(r));
  await sleep(500);
  assert(anyEmailTo('nobody@e2e.test').length === 0, 'emailed an address with no copy');
});

await t('a fresh link for a sign-up whose link was never opened sends it again', async () => {
  await call('requestArcLink', { firstName: 'Una', lastName: 'Opened', email: 'pending@e2e.test', agreesToReview: true });
  const r = await call('requestArcLink', { email: 'pending@e2e.test', resend: true });
  assert(r.result && r.result.ok, JSON.stringify(r));
  const mine = await waitForEmails('pending@e2e.test', 2);
  assert(mine.length === 2 && /Hi Una/.test(JSON.stringify(mine[1])), `got ${mine.length} emails`);
  const p = await openLink('pending@e2e.test');
  const c = await call('claimArcCopy', {}, p.token);
  assert(c.result && c.result.already === false, JSON.stringify(c));
  assert((await read(`arcReaders/${p.uid}`)).name === 'Una Opened', 'lost the name from the form');
});

await clearRateLimits();
await t('closed: the form takes no new readers, but returning readers still get a link', async () => {
  await write('config/arc', { open: false });
  const r = await call('requestArcLink', { firstName: 'New', lastName: 'Person', email: 'new@e2e.test', agreesToReview: true });
  assert(r.error && r.error.status === 'FAILED_PRECONDITION' && /closed/i.test(r.error.message), JSON.stringify(r));
  const back = await call('requestArcLink', { email: 'link@e2e.test', resend: true });
  assert(back.result && back.result.returning === true, JSON.stringify(back));
  await write('config/arc', { open: true });
});

await t('one inbox cannot be flooded with links', async () => {
  let last;
  for (let i = 0; i < 4; i++) last = await call('requestArcLink', { email: 'flood@e2e.test', resend: true });
  assert(last.result, 'rate-limited too early: ' + JSON.stringify(last));
  const over = await call('requestArcLink', { email: 'flood@e2e.test', resend: true });
  assert(over.error && over.error.status === 'RESOURCE_EXHAUSTED', JSON.stringify(over));
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
