// Inbound email replies on Telnyx, end to end on the real emulators. A signed
// Telnyx email.received webhook posts to the shipped telnyxEmailEventWebhook
// and the test checks the contact card: the reply lands on the right contact,
// threads onto the message it answers, is recorded once even when Telnyx
// retries, and an unsigned request is refused. It also pins that a CRM email
// sent through Telnyx carries the company's Reply-To (the real mailbox), not
// a reply+ address Telnyx could never receive.
//
// Run: `npm run e2e:inbound` in tests/ (writes fake secrets and removes them).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
// Test-only keypair. run-e2e.sh puts the public half in TELNYX_PUBLIC_KEY.
const TEST_PRIVATE_KEY = 'MC4CAQAwBQYDK2VwBCIEIKaUa/SGNcbxT09Cr9lP45Z8dTKFfOIctn0HMSauzbRB';

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

const privateKey = crypto.createPrivateKey({ key: Buffer.from(TEST_PRIVATE_KEY, 'base64'), format: 'der', type: 'pkcs8' });
async function telnyxPost(payload, { sign = true } = {}) {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { 'Content-Type': 'application/json' };
  if (sign) {
    headers['telnyx-timestamp'] = ts;
    headers['telnyx-signature-ed25519'] = crypto.sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString('base64');
  }
  const r = await fetch(`${FN}/telnyxEmailEventWebhook`, { method: 'POST', headers, body });
  return { status: r.status, text: await r.text() };
}
const received = (id, payload) => ({ data: { event_type: 'email.received', id: `evt_${id}`, record_type: 'event', payload: { id, ...payload } } });

for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`${FN}/telnyxEmailEventWebhook`, { method: 'POST', body: '{}' }); if (r.status) break; }
  catch (e) { /* not yet */ }
  await sleep(1000);
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const write = (p, d) => admin((db) => setDoc(doc(db, p), d, { merge: true }));
const emailsOn = (contactId) => admin(async (db) =>
  (await getDocs(collection(db, `companies/academy/contacts/${contactId}/emails`))).docs.map((d) => ({ id: d.id, ...d.data() })));
const read = (p) => admin(async (db) => { const s = await getDoc(doc(db, p)); return s.exists() ? s.data() : null; });

const signup = await (await fetch(`${AUTH}/accounts:signUp?key=fake`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'owner@e2e.test', password: 'e2e-pass-123', returnSecureToken: true })
})).json();
const owner = { uid: signup.localId, token: signup.idToken };

await write('companies/academy', { name: 'Academy', adminUids: [owner.uid], ownerUid: owner.uid });
await write(`users/${owner.uid}`, { role: 'owner', companyId: 'academy', email: 'owner@e2e.test' });
await write('companies/academy/contacts/jo', { name: 'Jo Lead', email: 'jo@lead.com', stage: 'new', tags: [] });
await write('companies/academy/contacts/jo/emails/out1', {
  direction: 'out', threadKey: 'thread-1', subject: 'Your coaching call', messageId: 'abc@the1pnation.com',
  createdAt: new Date(Date.now() - 60000)
});

await t('a CRM email sent through Telnyx replies to the real mailbox, not a reply+ address', async () => {
  const r = await fetch(`${FN}/sendContactEmail`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ data: { companyId: 'academy', contactId: 'jo', subject: 'Checking in', bodyText: 'Hi Jo' } })
  });
  const j = await r.json();
  assert(j.result, JSON.stringify(j));
  for (let i = 0; i < 20 && !emails.length; i++) await sleep(250);
  const sent = emails[emails.length - 1];
  assert(sent, 'nothing was sent');
  assert(sent.reply_to === 'anthonybrown@the1pnation.com', `reply_to was ${JSON.stringify(sent.reply_to)}`);
});

await t('an unsigned email.received is refused', async () => {
  const r = await telnyxPost(received('forged', { from: 'jo@lead.com', subject: 'x', text: 'forged' }), { sign: false });
  assert(r.status === 403, `got ${r.status}`);
  assert(!(await emailsOn('jo')).some((e) => e.bodyText === 'forged'), 'a forged reply reached the card');
});

await t('a reply lands on the contact, threaded onto the email it answers', async () => {
  const r = await telnyxPost(received('m1', {
    from: { email: 'Jo@Lead.com', name: 'Jo Lead' }, to: ['reply@reply.the1pnation.com'],
    subject: 'Re: Your coaching call',
    text: 'Thursday works.\n\nOn Mon, Oct 26, 2026 at 9:00 AM Anthony Brown <anthonybrown@the1pnation.com> wrote:\n> When works?',
    headers: { 'In-Reply-To': '<abc@the1pnation.com>', 'Message-ID': '<r1@lead.com>' }
  }));
  assert(r.status === 200, `got ${r.status} ${r.text}`);
  const inbound = (await emailsOn('jo')).filter((e) => e.direction === 'in');
  assert(inbound.length === 1, `got ${inbound.length} inbound`);
  const m = inbound[0];
  assert(m.bodyText === 'Thursday works.', `quoted history not trimmed: ${JSON.stringify(m.bodyText)}`);
  assert(m.threadKey === 'thread-1', `not threaded: ${m.threadKey}`);
  assert(m.fromEmail === 'jo@lead.com' && m.messageId === '<r1@lead.com>', JSON.stringify(m));
  const c = await read('companies/academy/contacts/jo');
  assert(c.emailUnreadCount === 1, `unread ${c.emailUnreadCount}`);
});

await t('a Telnyx retry of the same reply is recorded once', async () => {
  const again = await telnyxPost(received('m1', {
    from: 'jo@lead.com', subject: 'Re: Your coaching call', text: 'Thursday works.'
  }));
  assert(again.status === 200, `got ${again.status}`);
  const inbound = (await emailsOn('jo')).filter((e) => e.direction === 'in');
  assert(inbound.length === 1, `duplicated: ${inbound.length}`);
  assert((await read('companies/academy/contacts/jo')).emailUnreadCount === 1, 'unread counted twice');
});

await t('a cold email from a new sender creates a contact', async () => {
  const r = await telnyxPost(received('m2', {
    from: 'New Person <new@person.com>', to: 'reply@reply.the1pnation.com',
    subject: 'Interested in coaching', html: '<p>Do you have <b>openings</b>?</p>'
  }));
  assert(r.status === 200, `got ${r.status}`);
  const contacts = await admin(async (db) => (await getDocs(collection(db, 'companies/academy/contacts'))).docs.map((d) => ({ id: d.id, ...d.data() })));
  const c = contacts.find((x) => x.email === 'new@person.com');
  assert(c && c.source === 'Email' && c.name === 'New Person', JSON.stringify(contacts));
  const m = (await emailsOn(c.id))[0];
  assert(m && /openings/.test(m.bodyText), JSON.stringify(m));
});

await t('a reply whose text did not come through is still recorded, not dropped', async () => {
  const r = await telnyxPost(received('m3', { from: 'jo@lead.com', subject: 'Re: Checking in', attachments: [] }));
  assert(r.status === 200, `got ${r.status}`);
  const inbound = (await emailsOn('jo')).filter((e) => e.direction === 'in');
  assert(inbound.length === 2 && inbound.some((e) => /did not come through/.test(e.bodyText)), JSON.stringify(inbound.map((e) => e.bodyText)));
});

await t('the SendGrid Inbound Parse route (the rollback) still records a reply', async () => {
  const B = 'e2eBoundary';
  const part = (k, v) => `--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  const body = part('from', 'Jo Lead <jo@lead.com>') + part('to', 'reply+academy.jo@reply.the1pnation.com')
    + part('subject', 'Re: Your coaching call') + part('text', 'Friday is better.')
    + part('headers', 'Message-ID: <sg1@lead.com>\r\n') + `--${B}--\r\n`;
  const bad = await fetch(`${FN}/inboundEmailWebhook?key=wrong`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${B}` }, body });
  assert(bad.status === 403, `wrong token got ${bad.status}`);
  const r = await fetch(`${FN}/inboundEmailWebhook?key=e2e-inbound-token`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${B}` }, body });
  assert(r.status === 200, `got ${r.status}`);
  const m = (await emailsOn('jo')).find((e) => e.bodyText === 'Friday is better.');
  assert(m && m.threadKey === 'thread-1' && m.messageId === '<sg1@lead.com>', JSON.stringify(m));
});

await t('delivery events still flow through the same webhook', async () => {
  const r = await telnyxPost({ data: { event_type: 'email.delivered', id: 'evt_d1', payload: { email_id: 'msg_1', recipient: 'jo@lead.com' } } });
  assert(r.status === 200, `got ${r.status}`);
});

capture.close();
await env.cleanup();
const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of failed) console.log('   ', r[1], '=>', r[2]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
