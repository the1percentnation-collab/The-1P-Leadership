// Speaking agreements, end to end on the real emulators: the shipped
// sendAgreement, getAgreementForSigning, signAgreement, and voidAgreement
// callables run in the Functions emulator, and email goes to a local capture
// server standing in for the provider.
//
//   - Only the owner can send. Sending freezes the snapshot, fingerprints it,
//     signs for The One Percent, and emails the client a private link.
//   - The link opens the agreement only with the right token, and records the
//     first open. Signing needs both confirmations, records name, title, IP,
//     and time, emails both parties, and cannot happen twice.
//   - A snapshot altered after sending fails the fingerprint check, and a
//     voided agreement can no longer be signed.
//
// From the repo root: `npm run e2e:agreement` in tests/.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Email capture ─────────────────────────────────────────────────────────
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
const mailTo = (addr) => emails.filter((m) => JSON.stringify(m.to).includes(addr));

async function call(name, data, token) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data })
  });
  return r.json();
}

for (let i = 0; i < 60; i++) {
  try {
    const j = await call('getAgreementForSigning', {});
    if (j.error) break;
  } catch (e) { /* not yet */ }
  await sleep(1000);
}

async function account(email, claims) {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'e2e-pass-123', returnSecureToken: true })
  });
  const j = await r.json();
  if (claims) {
    await fetch(`${AUTH}/accounts:update?key=fake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId: j.localId, customAttributes: JSON.stringify(claims) })
    });
    const s = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'e2e-pass-123', returnSecureToken: true })
    });
    return (await s.json()).idToken;
  }
  return j.idToken;
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const read = (p) => admin(async (db) => { const s = await getDoc(doc(db, p)); return s.exists() ? s.data() : null; });

const draft = (no, email) => ({
  status: 'draft',
  agreementNo: no,
  client: { legalName: 'Acme Corp', address: '1 Main St, Tulsa, OK', signerName: 'Dana Lee', signerTitle: 'VP Sales', signerEmail: email },
  event: { name: 'Sales Kickoff', date: '2027-03-12', location: 'Omni OKC', format: 'keynote', virtual: false },
  fees: { session: 3500, travel: false, workbooks: 0, recording: true },
  specialTerms: ''
});
await admin(async (db) => {
  await setDoc(doc(db, 'agreements/ag-main'), draft('SA-2027-0001', 'dana@acme.test'));
  await setDoc(doc(db, 'agreements/ag-tamper'), draft('SA-2027-0002', 'tamper@acme.test'));
  await setDoc(doc(db, 'agreements/ag-void'), draft('SA-2027-0003', 'void@acme.test'));
  await setDoc(doc(db, 'agreements/ag-blank'), { status: 'draft', agreementNo: 'SA-2027-0004' });
});

const ownerToken = await account('owner@e2e.test', { role: 'owner' });
const memberToken = await account('member@e2e.test');
let link = null;

// ── Sending ───────────────────────────────────────────────────────────────
await t('a member cannot send an agreement', async () => {
  const j = await call('sendAgreement', { id: 'ag-main' }, memberToken);
  assert(j.error && j.error.status === 'PERMISSION_DENIED', JSON.stringify(j));
});

await t('an incomplete agreement cannot be sent', async () => {
  const j = await call('sendAgreement', { id: 'ag-blank' }, ownerToken);
  assert(j.error && /Fill in before sending/.test(j.error.message), JSON.stringify(j));
});

await t('the owner sends: snapshot frozen, fingerprinted, signed for 1P, link emailed', async () => {
  const j = await call('sendAgreement', { id: 'ag-main' }, ownerToken);
  assert(j.result && j.result.ok && j.result.url.includes('/sign?a=ag-main&t='), JSON.stringify(j));
  link = new URL(j.result.url);
  const d = await read('agreements/ag-main');
  assert(d.status === 'sent', d.status);
  assert(/^[0-9a-f]{64}$/.test(d.hash), 'no hash');
  assert(d.snapshot.sections.length === 9 && d.snapshot.client.signerEmail === 'dana@acme.test', 'snapshot');
  assert(d.provider && d.provider.name === 'Anthony Brown Sr.', 'provider signature');
  const m = mailTo('dana@acme.test');
  assert(m.length === 1 && JSON.stringify(m[0]).includes(link.searchParams.get('t')), 'signing email');
});

await t('a sent agreement cannot be sent again without resend', async () => {
  const j = await call('sendAgreement', { id: 'ag-main' }, ownerToken);
  assert(j.error && j.error.status === 'FAILED_PRECONDITION', JSON.stringify(j));
});

// ── Opening ───────────────────────────────────────────────────────────────
await t('a wrong token opens nothing', async () => {
  const j = await call('getAgreementForSigning', { id: 'ag-main', token: 'x'.repeat(48) });
  assert(j.error && j.error.status === 'NOT_FOUND', JSON.stringify(j));
});

await t('the link opens the frozen agreement and records the first open', async () => {
  const j = await call('getAgreementForSigning', { id: 'ag-main', token: link.searchParams.get('t') });
  assert(j.result && j.result.status === 'sent', JSON.stringify(j));
  assert(j.result.snapshot.agreementNo === 'SA-2027-0001', 'snapshot');
  assert(j.result.audit.viewedAt > 0, 'viewedAt');
  assert(!('token' in j.result), 'token leaked');
});

// ── Signing ───────────────────────────────────────────────────────────────
const tok = () => link.searchParams.get('t');
await t('signing needs both confirmations', async () => {
  const j = await call('signAgreement', { id: 'ag-main', token: tok(), name: 'Dana Lee', title: 'VP Sales', agreeTerms: true });
  assert(j.error && j.error.status === 'INVALID_ARGUMENT', JSON.stringify(j));
});

await t('the client signs: name, title, IP, and time recorded; both parties emailed', async () => {
  const before = emails.length;
  const j = await call('signAgreement', { id: 'ag-main', token: tok(), name: 'Dana Lee', title: 'VP Sales', agreeTerms: true, agreeElectronic: true });
  assert(j.result && j.result.ok, JSON.stringify(j));
  const d = await read('agreements/ag-main');
  assert(d.status === 'signed', d.status);
  assert(d.signature.name === 'Dana Lee' && d.signature.title === 'VP Sales' && d.signature.ip, JSON.stringify(d.signature));
  const sent = emails.slice(before).map((m) => JSON.stringify(m.to));
  assert(sent.some((x) => x.includes('dana@acme.test')) && sent.some((x) => x.includes('anthonybrown@the1pnation.com')), sent.join(' '));
});

await t('a signed agreement cannot be signed again', async () => {
  const j = await call('signAgreement', { id: 'ag-main', token: tok(), name: 'Someone Else', title: 'CEO', agreeTerms: true, agreeElectronic: true });
  assert(j.error && j.error.status === 'FAILED_PRECONDITION', JSON.stringify(j));
  assert((await read('agreements/ag-main')).signature.name === 'Dana Lee', 'signature changed');
});

await t('the executed copy still opens by link, with the certificate data', async () => {
  const j = await call('getAgreementForSigning', { id: 'ag-main', token: tok() });
  assert(j.result.status === 'signed' && j.result.client.name === 'Dana Lee' && j.result.audit.hash, JSON.stringify(j.result.client));
});

// ── Integrity and voiding ─────────────────────────────────────────────────
await t('an agreement altered after sending fails the fingerprint check', async () => {
  const s = await call('sendAgreement', { id: 'ag-tamper' }, ownerToken);
  const t2 = new URL(s.result.url).searchParams.get('t');
  await admin((db) => updateDoc(doc(db, 'agreements/ag-tamper'), { 'snapshot.schedule.specialTerms': 'Fee waived.' }));
  const j = await call('signAgreement', { id: 'ag-tamper', token: t2, name: 'Dana Lee', title: 'VP', agreeTerms: true, agreeElectronic: true });
  assert(j.error && j.error.status === 'DATA_LOSS', JSON.stringify(j));
  assert((await read('agreements/ag-tamper')).status === 'sent', 'was signed');
});

await t('a voided agreement can no longer be signed', async () => {
  const s = await call('sendAgreement', { id: 'ag-void' }, ownerToken);
  const t3 = new URL(s.result.url).searchParams.get('t');
  const v = await call('voidAgreement', { id: 'ag-void' }, ownerToken);
  assert(v.result && v.result.ok, JSON.stringify(v));
  const g = await call('getAgreementForSigning', { id: 'ag-void', token: t3 });
  assert(g.result && g.result.status === 'void', JSON.stringify(g));
  const j = await call('signAgreement', { id: 'ag-void', token: t3, name: 'Dana Lee', title: 'VP', agreeTerms: true, agreeElectronic: true });
  assert(j.error && j.error.status === 'FAILED_PRECONDITION', JSON.stringify(j));
});

await env.cleanup();
capture.close();
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
