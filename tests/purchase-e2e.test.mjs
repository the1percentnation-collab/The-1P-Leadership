// A purchase, end to end, on the real emulators: a signed Stripe
// checkout.session.completed event is POSTed to the shipped stripeWebhook
// running in the Functions emulator, and the test checks what a buyer would
// then have: the course, the book in their library (the REAL book id the
// Manage Library page attached, not the code default), the shipping order
// for the print bundle only, and the confirmation email, captured by a
// local server standing in for the email provider.
//
// From the repo root (which holds firebase.json), after `cd functions && npm ci`:
//   tests/node_modules/.bin/firebase emulators:exec --only auth,firestore,storage,functions \
//     --project demo-1p "node tests/purchase-e2e.test.mjs"
// The functions emulator reads functions/.env.local and functions/.secret.local;
// `npm run e2e:purchase` in tests/ writes both (fake values) and removes them.
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
const WEBHOOK = `http://127.0.0.1:5001/${PROJECT}/us-central1/stripeWebhook`;
const WEBHOOK_SECRET = 'whsec_e2e_fake';
const CAPTURE_PORT = 8766;
const REAL_BOOK = 'i-cant-strategies-to-overcoming-your-limiting-beliefs';

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
await new Promise((r) => capture.listen(CAPTURE_PORT, '127.0.0.1', r));

// ── Wait for the functions emulator ───────────────────────────────────────
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(WEBHOOK, { method: 'POST', body: '{}' });
    if (r.status === 400 || r.status === 503) break; // up: rejects an unsigned body
  } catch (e) { /* not yet */ }
  await sleep(1000);
}

// ── Seed ──────────────────────────────────────────────────────────────────
const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const BUYER = 'buyer-e2e';
const PRINT_BUYER = 'buyer-print-e2e';
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, `books/${REAL_BOOK}`), { title: 'I Can\'t Strategies To Overcoming Your Limiting Beliefs', author: 'Anthony Brown', status: 'live', version: '1' });
  await setDoc(doc(db, `users/${BUYER}`), { email: 'buyer@e2e.test', displayName: 'Jordan Buyer', role: 'user' });
  await setDoc(doc(db, `users/${PRINT_BUYER}`), { email: 'print@e2e.test', displayName: 'Casey Print', role: 'user' });
  // Exactly the state after Manage Library attached the book to the course
  // only: the bundles' records carry no grantsBooks of their own.
  await setDoc(doc(db, 'courses/icant'), { title: 'I Can\'t: The Course', status: 'live', grantsBooks: [REAL_BOOK] });
  await setDoc(doc(db, 'courses/bundle-icant'), { title: 'The Complete I Can\'t Experience', status: 'live', kind: 'bundle', price: 197, shipsBook: false });
  await setDoc(doc(db, 'courses/bundle-icant-print'), { title: 'The Complete I Can\'t Experience + Paperback', status: 'live', kind: 'bundle', price: 227, shipsBook: true });
});
async function read(pathStr) {
  let out = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const s = await getDoc(doc(ctx.firestore(), pathStr));
    out = s.exists() ? s.data() : null;
  });
  return out;
}

// ── A signed event, as Stripe would send it ───────────────────────────────
function checkoutEvent({ id, uid, email, slug, metadata, shipping, amount }) {
  const session = {
    id, object: 'checkout.session', mode: 'payment', payment_status: 'paid',
    amount_total: amount, currency: 'usd',
    client_reference_id: uid,
    customer_details: { email, name: 'Test Buyer' },
    customer_email: email,
    metadata: { courseSlug: slug, uid, ...metadata },
    ...(shipping ? { shipping_details: shipping } : {})
  };
  return {
    id: `evt_${id}`, object: 'event', type: 'checkout.session.completed',
    api_version: '2024-06-20', created: Math.floor(Date.now() / 1000), livemode: false,
    data: { object: session }
  };
}
async function post(event) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
  return { status: r.status, text: await r.text() };
}

// ── 1. Digital bundle: metadata locked at checkout ────────────────────────
await t('an unsigned post is rejected', async () => {
  const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert(r.status === 400, `status ${r.status}`);
});

const digital = checkoutEvent({
  id: 'cs_digital_1', uid: BUYER, email: 'buyer@e2e.test', slug: 'bundle-icant', amount: 19700,
  // What createCheckoutSession locks in: enrollsAlso from the defaults and
  // grantsBooks resolved through the icant record.
  metadata: { enrollsAlso: 'icant', grantsBooks: REAL_BOOK }
});
await t('digital bundle: the webhook accepts the signed event', async () => {
  const r = await post(digital);
  assert(r.status === 200, `status ${r.status}: ${r.text}`);
});

await t('digital bundle: buyer is enrolled in the bundle and the course', async () => {
  const u = await read(`users/${BUYER}`);
  assert(u.enrolledCourseSlugs.includes('bundle-icant') && u.enrolledCourseSlugs.includes('icant'), JSON.stringify(u.enrolledCourseSlugs));
});

await t('digital bundle: the REAL book lands in the library, not the code default', async () => {
  const u = await read(`users/${BUYER}`);
  assert(Array.isArray(u.ownedBookIds) && u.ownedBookIds.includes(REAL_BOOK), JSON.stringify(u.ownedBookIds));
  assert(!u.ownedBookIds.includes('i-cant'), 'stale default id was granted: ' + JSON.stringify(u.ownedBookIds));
});

await t('digital bundle: purchase recorded, no shipping order', async () => {
  const p = await read(`users/${BUYER}/purchases/cs_digital_1`);
  assert(p && p.status === 'paid' && p.amount === 197, JSON.stringify(p));
  assert(p.confirmationEmail === 'sent', 'confirmationEmail: ' + p.confirmationEmail);
  assert((await read('orders/cs_digital_1')) === null, 'a digital purchase created a shipping order');
});

await t('digital bundle: the confirmation email names the course, the book and the library', async () => {
  const m = emails.find((e) => JSON.stringify(e.to).includes('buyer@e2e.test'));
  assert(m, 'no email captured for the buyer: ' + JSON.stringify(emails.map((e) => e.to)));
  const body = JSON.stringify(m);
  assert(/You're in: The Complete I Can't Experience/.test(m.subject), 'subject: ' + m.subject);
  assert(/Hi Jordan/.test(body), 'first name missing');
  assert(/courses\.html\?course=icant/.test(body), 'course link should land on the course the bundle unlocks');
  assert(/I Can't Strategies To Overcoming Your Limiting Beliefs/.test(body), 'book title missing');
  assert(/the1pnation\.com\/library/.test(body), 'library link missing');
  assert(!/paperback/i.test(body), 'digital email mentions a paperback');
});

await t('a Stripe retry of the same event is a no-op', async () => {
  const before = emails.length;
  const r = await post(digital);
  assert(r.status === 200 && /duplicate/.test(r.text), r.text);
  assert(emails.length === before, 'duplicate event sent another email');
});

// ── 2. Print bundle: older session with no grantsBooks in metadata ────────
const print = checkoutEvent({
  id: 'cs_print_1', uid: PRINT_BUYER, email: 'print@e2e.test', slug: 'bundle-icant-print', amount: 22700,
  metadata: { enrollsAlso: 'icant', shipsBook: '1' },
  shipping: { name: 'Casey Print', address: { line1: '1 Main St', city: 'Oklahoma City', state: 'OK', postal_code: '73102', country: 'US' } }
});
await t('print bundle: accepted', async () => {
  const r = await post(print);
  assert(r.status === 200, `status ${r.status}: ${r.text}`);
});

await t('print bundle: the book is resolved from the course record when metadata lacks it', async () => {
  const u = await read(`users/${PRINT_BUYER}`);
  assert(u.ownedBookIds && u.ownedBookIds.includes(REAL_BOOK), JSON.stringify(u.ownedBookIds));
  assert(u.enrolledCourseSlugs.includes('icant'), JSON.stringify(u.enrolledCourseSlugs));
});

await t('print bundle: a shipping order is written with the collected address', async () => {
  const o = await read('orders/cs_print_1');
  assert(o && o.kind === 'course-book' && o.status === 'new', JSON.stringify(o));
  assert(o.shipping && o.shipping.address.city === 'Oklahoma City', 'address missing');
  assert(o.email === 'print@e2e.test', 'order email');
});

await t('print bundle: the email says the paperback ships to their city', async () => {
  const m = emails.find((e) => JSON.stringify(e.to).includes('print@e2e.test'));
  assert(m, 'no email for the print buyer');
  const body = JSON.stringify(m);
  assert(/paperback ships to Oklahoma City, OK/.test(body), 'shipping line missing: ' + (m.text || '').slice(0, 300));
  assert(/the1pnation\.com\/library/.test(body), 'library link missing');
});

capture.close();
await env.cleanup();
const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of failed) console.log('   ', r[1], '=>', r[2]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
