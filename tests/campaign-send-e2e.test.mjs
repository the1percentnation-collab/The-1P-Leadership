// Branded campaigns end to end on the real emulators: the shipped
// sendCampaign and sendCampaignTest callables run in the Functions emulator,
// send through the Telnyx path to a local capture server, and the test reads
// exactly what each recipient would have received.
//
//   - "Send test to me" mails only the admin who pressed it, marked [TEST],
//     and never changes the campaign.
//   - Sending the seeded audiobook draft delivers the branded layout to every
//     contact except opt-outs and people who already own the audiobook, each
//     with their own working unsubscribe link.
//   - Someone who is not an admin of the company can do neither.
//
// From the repo root: `npm run e2e:campaign-send` in tests/ (writes fake
// secrets and removes them afterwards).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const { CAMPAIGN, FILTER } = require(path.join(ROOT, 'scripts', 'seed-audiobook-campaign.js'));
const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const CO = 'acme';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Email capture: what the functions think is Telnyx ─────────────────────
const single = [];
// Signing up an account sends its own welcome email; only campaign tests count.
const tests = () => single.filter((m) => m.metadata && m.metadata.type === 'campaign-test');
const batches = [];
const capture = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.method === 'POST' && req.url.endsWith('/email_messages/batch')) {
      const j = JSON.parse(body);
      batches.push(j);
      res.end(JSON.stringify({ data: [], meta: { succeeded: j.messages.length, failed: 0 } }));
      return;
    }
    if (req.method === 'POST' && req.url.endsWith('/email_messages')) {
      single.push(JSON.parse(body));
      res.end(JSON.stringify({ data: { id: `msg_${single.length}` } }));
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
  try { const j = await call('sendCampaignTest', {}); if (j.error) break; } catch (e) { /* not yet */ }
  await sleep(1000);
}

async function account(email, name) {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'e2e-pass-123', displayName: name, returnSecureToken: true })
  });
  const j = await r.json();
  return { uid: j.localId, token: j.idToken };
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const read = (p) => admin(async (db) => { const s = await getDoc(doc(db, p)); return s.exists() ? s.data() : null; });

const anthony = await account('anthony@e2e.test', 'Anthony Brown');
const stranger = await account('stranger@e2e.test', 'Sam Stranger');
await admin(async (db) => {
  await setDoc(doc(db, `companies/${CO}`), { name: 'The One Percent Nation', adminUids: [anthony.uid] });
  await setDoc(doc(db, 'users/buyer'), { email: 'buyer@e2e.test', ownedBookIds: ['i-cant-audio'] });
  await setDoc(doc(db, `companies/${CO}/contacts/c1`), { email: 'lead@e2e.test', name: 'Lee Lead' });
  await setDoc(doc(db, `companies/${CO}/contacts/c2`), { email: 'Buyer@E2E.test', name: 'Bo Buyer' });
  await setDoc(doc(db, `companies/${CO}/contacts/c3`), { email: 'gone@e2e.test', name: 'Gus Gone', emailOptOut: true });
  await setDoc(doc(db, `companies/${CO}/contacts/c4`), { email: 'pat@e2e.test', name: 'Pat Prospect' });
  // The draft exactly as scripts/seed-audiobook-campaign.js writes it.
  await setDoc(doc(db, `companies/${CO}/campaigns/${CAMPAIGN.id}`), {
    name: CAMPAIGN.name, subject: CAMPAIGN.subject, fromName: 'Anthony Brown Sr.', layout: 'branded',
    preheader: CAMPAIGN.preheader, heroImageUrl: CAMPAIGN.heroImageUrl, heroAlt: CAMPAIGN.heroAlt,
    bodyText: CAMPAIGN.body.trim(), bodyHtml: '', recipientFilter: FILTER, status: 'draft'
  });
});

await t('a stranger can neither test nor send the campaign', async () => {
  const a = await call('sendCampaignTest', { companyId: CO, campaignId: CAMPAIGN.id }, stranger.token);
  const b = await call('sendCampaign', { companyId: CO, campaignId: CAMPAIGN.id }, stranger.token);
  assert(a.error && a.error.status === 'PERMISSION_DENIED', JSON.stringify(a));
  assert(b.error && b.error.status === 'PERMISSION_DENIED', JSON.stringify(b));
  assert(!tests().length && !batches.length, 'something was sent');
});

await t('"Send test to me" mails only the admin, branded and marked [TEST]', async () => {
  const j = await call('sendCampaignTest', { companyId: CO, campaignId: CAMPAIGN.id }, anthony.token);
  assert(j.result && j.result.to === 'anthony@e2e.test', JSON.stringify(j));
  assert(tests().length === 1 && !batches.length, `sent ${tests().length} tests, ${batches.length} batches`);
  const m = tests()[0];
  assert(JSON.stringify(m.to).includes('anthony@e2e.test'), JSON.stringify(m.to));
  assert(m.subject === "[TEST] I Can't is now an audiobook", m.subject);
  assert(m.html_body.includes('i-cant-audio-share.jpg') && m.html_body.includes('>Get the Audiobook</a>'), 'not the branded layout');
  assert(m.html_body.includes('href="mailto:'), 'test copy has no opt-out');
  assert(m.text_body.includes('Get the Audiobook: https://the1pnation.com/icantaudio'), m.text_body.slice(0, 200));
  const c = await read(`companies/${CO}/campaigns/${CAMPAIGN.id}`);
  assert(c.status === 'draft' && c.recipientCount == null, 'the test changed the campaign');
});

await t('an unsaved draft can be tested from the editor', async () => {
  const j = await call('sendCampaignTest', {
    companyId: CO,
    draft: { subject: 'Hi {{firstName}}', bodyText: '# Hello\n\n[Go](https://the1pnation.com/go)', layout: 'branded' }
  }, anthony.token);
  assert(j.result, JSON.stringify(j));
  const m = tests()[tests().length - 1];
  assert(m.subject === '[TEST] Hi Anthony', m.subject);
  assert(m.html_body.includes('>Go</a>') && m.html_body.includes('Book a Free Alignment Audit'), 'draft not rendered with the default signature');
});

await t('sending delivers the branded email to everyone but opt-outs and buyers', async () => {
  const j = await call('sendCampaign', { companyId: CO, campaignId: CAMPAIGN.id }, anthony.token);
  assert(j.result && j.result.recipientCount === 2, JSON.stringify(j));
  assert(batches.length === 1, `${batches.length} batches`);
  const msgs = batches[0].messages;
  const to = msgs.map((m) => JSON.stringify(m.to)).join(' ');
  assert(to.includes('lead@e2e.test') && to.includes('pat@e2e.test'), to);
  assert(!/buyer@|gone@/i.test(to), 'mailed a buyer or an opt-out: ' + to);
  for (const m of msgs) {
    assert(m.subject === "I Can't is now an audiobook", m.subject);
    assert(m.html_body.includes('i-cant-audio-share.jpg') && m.html_body.includes('>Get the Audiobook</a>'), 'not branded');
    assert(!m.html_body.includes('-unsubscribe_url-') && !m.text_body.includes('-unsubscribe_url-'), 'placeholder left unfilled');
    assert(/href="https:\/\/[^"]*unsubscribe[^"]*"/i.test(m.html_body), 'no per-recipient unsubscribe link');
    assert(m.html_body.split('Unsubscribe from these emails').length === 2, 'opt-out footer is missing or doubled');
  }
  const c = await read(`companies/${CO}/campaigns/${CAMPAIGN.id}`);
  assert(c.status === 'sent' && c.recipientCount === 2 && c.acceptedCount === 2, JSON.stringify({ s: c.status, n: c.recipientCount }));
});

await t('a sent campaign cannot be sent twice', async () => {
  const j = await call('sendCampaign', { companyId: CO, campaignId: CAMPAIGN.id }, anthony.token);
  assert(j.error && j.error.status === 'FAILED_PRECONDITION', JSON.stringify(j));
  assert(batches.length === 1, 'sent again');
});

capture.close();
await env.cleanup();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
