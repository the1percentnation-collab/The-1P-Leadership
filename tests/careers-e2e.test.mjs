// Join the Team inquiries, end to end on the real emulators. The shipped
// submitLeadForm callable runs in the Functions emulator, a local server
// stands in for Telnyx, and the test checks what the applicant and the CRM
// would then see:
//
//   - The applicant gets the pick-a-time email right away, naming the role
//     from the server's list and linking to the team booking page.
//   - The contact is tagged Recruiting + role + link source, the referrer is
//     kept on the inquiry, and the reply is logged on the contact.
//   - A second inquiry inside a week adds the new role's tag but sends no
//     second reply.
//   - A forged source adds no tag, and a link in the name never reaches the
//     email.
//
// Run: `npm run e2e:careers` in tests/ (writes fake secrets and removes them).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocs, collection, query, where } from 'firebase/firestore';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const BOOKING = 'https://the1pnation.com/book-a-call?for=team';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name]); console.log('❌', name, ':', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Telnyx stand-in: records every email the functions send.
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
const to = (addr) => emails.filter((m) => JSON.stringify(m.to).toLowerCase().includes(addr));

const call = async (data) => {
  const r = await fetch(`${FN}/submitLeadForm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`submitLeadForm ${r.status}: ${JSON.stringify(body)}`);
  return body;
};
const inquiry = (email, name, fields) => call({ formType: 'careers', name, email, fields, consent: false });

for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`${FN}/submitLeadForm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}' }); if (r.status) break; }
  catch (e) { /* not yet */ }
  await sleep(1000);
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
await admin((db) => setDoc(doc(db, 'companies/academy'), { name: 'Academy', adminUids: [] }));

const contact = (email) => admin(async (db) => {
  const s = await getDocs(query(collection(db, 'companies/academy/contacts'), where('email', '==', email)));
  if (s.empty) return null;
  const d = s.docs[0];
  const acts = (await getDocs(collection(db, `companies/academy/contacts/${d.id}/activities`))).docs.map((a) => a.data());
  return { id: d.id, ...d.data(), activities: acts };
});

await t('a LinkedIn applicant gets the pick-a-time email for their role', async () => {
  await inquiry('marcus@e2e.test', 'Marcus Johnson', {
    role: 'Financial Representative', role_key: 'life-insurance', why: 'Ready to build.',
    source: 'linkedin', referred_by: 'tasha'
  });
  const sent = to('marcus@e2e.test');
  assert(sent.length === 1, `expected 1 email to the applicant, got ${sent.length}`);
  const m = sent[0];
  assert(/Financial Representative/.test(m.subject), 'subject names the role: ' + m.subject);
  assert(m.text_body.startsWith('Hi Marcus,'), 'greeting');
  assert(m.text_body.includes(BOOKING) && m.html_body.includes(BOOKING), 'booking link');
  assert(/Aligned Wealth/.test(m.text_body), 'signed for the team');
  assert((m.tags || []).includes('career_reply'), 'tagged career_reply');
  assert(m.reply_to, 'has a reply-to');
});

await t('the CRM contact carries recruiting, role and source tags, the referrer, and the reply log', async () => {
  const c = await contact('marcus@e2e.test');
  assert(c, 'contact created');
  for (const tag of ['Recruiting', 'Recruit: Life Insurance', 'Recruit Source: LinkedIn']) {
    assert((c.tags || []).includes(tag), `missing tag ${tag}: ${JSON.stringify(c.tags)}`);
  }
  const lead = c.activities.find((a) => a.type === 'lead_form');
  assert(lead && lead.meta.fields.referred_by === 'tasha' && lead.meta.fields.source === 'linkedin', 'referrer and source on the inquiry');
  assert(c.activities.filter((a) => a.type === 'career_reply').length === 1, 'one reply logged');
});

await t('a second inquiry inside a week adds the role tag but sends no second reply', async () => {
  await inquiry('marcus@e2e.test', 'Marcus Johnson', { role: 'Investment and Securities Representative', role_key: 'securities', why: 'Also this.' });
  assert(to('marcus@e2e.test').length === 1, `applicant got ${to('marcus@e2e.test').length} emails`);
  const c = await contact('marcus@e2e.test');
  assert((c.tags || []).includes('Recruit: Securities'), 'securities tag added');
  assert(c.activities.filter((a) => a.type === 'career_reply').length === 1, 'still one reply logged');
});

await t('a forged source adds no tag, and a link in the name never reaches the email', async () => {
  await inquiry('spam@e2e.test', 'http://win-big.example', { role: 'x', role_key: 'coach', why: 'x', source: 'Recruit: VIP' });
  const sent = to('spam@e2e.test');
  assert(sent.length === 1, 'reply sent');
  assert(sent[0].text_body.startsWith('Hi,\n'), 'generic greeting');
  assert(!/win-big/.test(sent[0].text_body + sent[0].html_body + sent[0].subject), 'name link leaked into the email');
  const c = await contact('spam@e2e.test');
  assert(!(c.tags || []).some((tg) => /VIP|Recruit Source/.test(tg)), 'forged source tag: ' + JSON.stringify(c.tags));
  assert((c.tags || []).includes('Recruit: 1P Coach'), 'role tag');
});

await env.cleanup();
capture.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
