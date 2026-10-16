// The One Percent Membership, end to end, on the real emulators: signed
// Stripe events go to the shipped stripeWebhook, callables run in the
// Functions emulator, and the test checks what a member would then have.
// It pins the business rules that matter: a founding spot is counted once,
// paid months are counted for the certification credit, a cancel keeps
// access to the end of the period, ending the membership never takes a
// course the member bought outright, and a certification can never be added.
// Books and live sessions are not part of the membership.
//
// Run: `npm run e2e:membership` in tests/ (writes fake secrets and removes them).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const stripe = require(path.join(ROOT, 'functions', 'node_modules', 'stripe'))('sk_test_fake');

const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const WEBHOOK = `${FN}/stripeWebhook`;
const WEBHOOK_SECRET = 'whsec_e2e_fake';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Email capture: what the functions think is Telnyx ─────────────────────
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
  try {
    const r = await fetch(WEBHOOK, { method: 'POST', body: '{}' });
    if (r.status === 400 || r.status === 503) break;
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
    const k = await s.json();
    return { uid: j.localId, token: k.idToken };
  }
  return { uid: j.localId, token: j.idToken };
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const read = (p) => admin(async (db) => { const s = await getDoc(doc(db, p)); return s.exists() ? s.data() : null; });

const member = await account('member@e2e.test');
const owner = await account('owner@e2e.test', { role: 'owner' });

await admin(async (db) => {
  // The member already bought one course outright, before joining.
  await setDoc(doc(db, `users/${member.uid}`), { email: 'member@e2e.test', displayName: 'Morgan Member', role: 'user', enrolledCourseSlugs: ['the-focus-tax'] });
  await setDoc(doc(db, 'config/membership'), { includedSlugs: ['icant', 'mindset-foundations'], foundingCount: 4 });
});

// ── A signed event, as Stripe would send it ───────────────────────────────
let seq = 0;
function event(type, object) {
  seq += 1;
  return { id: `evt_mb_${seq}_${type}`, object: 'event', type, api_version: '2024-06-20', created: Math.floor(Date.now() / 1000), livemode: false, data: { object } };
}
async function post(evt) {
  const payload = JSON.stringify(evt);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
  return { status: r.status, text: await r.text() };
}
const META = { kind: 'membership', uid: member.uid, plan: 'founding', billing: 'month' };
const SUB = 'sub_mb_1';
const PERIOD_END = Math.floor(Date.UTC(2026, 10, 16) / 1000);

const checkout = event('checkout.session.completed', {
  id: 'cs_mb_1', object: 'checkout.session', mode: 'subscription', payment_status: 'paid',
  amount_total: 2900, currency: 'usd', client_reference_id: member.uid,
  customer: 'cus_mb_1', customer_details: { email: 'member@e2e.test', name: 'Morgan Member' },
  customer_email: 'member@e2e.test', subscription: SUB, metadata: META
});

await t('checkout: a founding member is switched on', async () => {
  const r = await post(checkout);
  assert(r.status === 200, `status ${r.status}: ${r.text}`);
  const u = await read(`users/${member.uid}`);
  assert(u.membershipActive === true, JSON.stringify(u));
  assert(u.membership.plan === 'founding' && u.membership.billing === 'month' && u.membership.subscriptionId === SUB, JSON.stringify(u.membership));
});

await t('checkout: membership is never written into enrolledCourseSlugs', async () => {
  const u = await read(`users/${member.uid}`);
  assert(JSON.stringify(u.enrolledCourseSlugs) === JSON.stringify(['the-focus-tax']), JSON.stringify(u.enrolledCourseSlugs));
});

await t('checkout: the subscription index and purchase record are written', async () => {
  const idx = await read(`stripeSubscriptions/${SUB}`);
  assert(idx && idx.kind === 'membership' && idx.uid === member.uid, JSON.stringify(idx));
  const p = await read(`users/${member.uid}/purchases/cs_mb_1`);
  assert(p && p.mode === 'membership' && p.amount === 29, JSON.stringify(p));
});

await t('checkout: the founding count goes up by one', async () => {
  const c = await read('config/membership');
  assert(c.foundingCount === 5, JSON.stringify(c));
});

await t('checkout: a replayed or re-sent checkout never counts the spot twice', async () => {
  const again = event('checkout.session.completed', checkout.data.object);
  const r = await post(again);
  assert(r.status === 200, `status ${r.status}: ${r.text}`);
  const c = await read('config/membership');
  assert(c.foundingCount === 5, JSON.stringify(c));
});

await t('checkout: the welcome email goes out', async () => {
  for (let i = 0; i < 10 && !emails.length; i++) await sleep(300);
  const m = emails.find((e) => JSON.stringify(e.to).includes('member@e2e.test'));
  assert(m && /Welcome to The One Percent Membership/.test(m.subject), JSON.stringify(emails.map((e) => e.subject)));
});

await t('invoice.paid: each paid month is counted', async () => {
  const inv = (id) => event('invoice.paid', {
    id, object: 'invoice', subscription: SUB, paid: true,
    lines: { data: [{ period: { start: PERIOD_END - 2592000, end: PERIOD_END } }] }
  });
  assert((await post(inv('in_mb_1'))).status === 200);
  assert((await post(inv('in_mb_2'))).status === 200);
  const u = await read(`users/${member.uid}`);
  assert(u.membership.paidMonths === 2, JSON.stringify(u.membership));
  assert(u.membership.currentPeriodEnd, 'currentPeriodEnd missing');
});

await t('course console: the owner can add a course', async () => {
  const j = await call('setMembershipCourse', { slug: 'business-alignment', included: true }, owner.token);
  assert(!j.error, JSON.stringify(j));
  const c = await read('config/membership');
  assert(c.includedSlugs.includes('business-alignment'), JSON.stringify(c.includedSlugs));
});

await t('course console: a certification can never be added', async () => {
  for (const slug of ['1p-clc', '1p-clc-leader']) {
    const j = await call('setMembershipCourse', { slug, included: true }, owner.token);
    assert(j.error, `${slug}: ${JSON.stringify(j)}`);
  }
  const c = await read('config/membership');
  assert(!c.includedSlugs.includes('1p-clc') && !c.includedSlugs.includes('1p-clc-leader'), JSON.stringify(c.includedSlugs));
});

await t('course console: a member cannot change the list', async () => {
  const j = await call('setMembershipCourse', { slug: 'faith-leadership', included: true }, member.token);
  assert(j.error && j.error.status === 'PERMISSION_DENIED', JSON.stringify(j));
});

await t('checkout: an active member cannot start a second membership', async () => {
  const j = await call('createMembershipCheckout', { billing: 'month' }, member.token);
  assert(j.error && j.error.status === 'ALREADY_EXISTS', JSON.stringify(j));
});

const subObj = (extra) => ({ id: SUB, object: 'subscription', metadata: META, current_period_end: PERIOD_END, ...extra });

await t('cancel: access stays on until the period ends', async () => {
  const r = await post(event('customer.subscription.updated', subObj({ status: 'active', cancel_at_period_end: true })));
  assert(r.status === 200, `status ${r.status}: ${r.text}`);
  const u = await read(`users/${member.uid}`);
  assert(u.membershipActive === true && u.membership.status === 'canceling' && u.membership.cancelAt, JSON.stringify(u.membership));
});

await t('resume: a kept membership goes back to active', async () => {
  const r = await post(event('customer.subscription.updated', subObj({ status: 'active', cancel_at_period_end: false })));
  assert(r.status === 200, `status ${r.status}: ${r.text}`);
  const u = await read(`users/${member.uid}`);
  assert(u.membershipActive === true && u.membership.status === 'active' && u.membership.cancelAt === null, JSON.stringify(u.membership));
});

await t('a failed payment marks the member past due without cutting access', async () => {
  const r = await post(event('invoice.payment_failed', { id: 'in_mb_fail', object: 'invoice', subscription: SUB }));
  assert(r.status === 200, `status ${r.status}: ${r.text}`);
  const u = await read(`users/${member.uid}`);
  assert(u.membershipActive === true && u.membership.status === 'past_due', JSON.stringify(u.membership));
});

await t('an old, different subscription ending does not switch the member off', async () => {
  const r = await post(event('customer.subscription.deleted', { id: 'sub_old', object: 'subscription', status: 'canceled', metadata: META }));
  assert(r.status === 200, `status ${r.status}: ${r.text}`);
  const u = await read(`users/${member.uid}`);
  assert(u.membershipActive === true, JSON.stringify(u.membership));
});

await t('ended: the membership switches off', async () => {
  const r = await post(event('customer.subscription.deleted', subObj({ status: 'canceled', cancel_at_period_end: false })));
  assert(r.status === 200, `status ${r.status}: ${r.text}`);
  const u = await read(`users/${member.uid}`);
  assert(u.membershipActive === false && u.membership.status === 'canceled', JSON.stringify(u.membership));
});

await t('ended: the course bought outright is still theirs', async () => {
  const u = await read(`users/${member.uid}`);
  assert(u.enrolledCourseSlugs.includes('the-focus-tax'), JSON.stringify(u.enrolledCourseSlugs));
});

capture.close();
await env.cleanup();
const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of failed) console.log('   ', r[1], '=>', r[2]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
