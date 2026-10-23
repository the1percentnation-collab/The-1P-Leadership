// Hand sales, end to end on the real emulators: the shipped manageHandSale,
// adjustStock, getInvoice and payInvoice callables and the stripeWebhook run
// in the Functions emulator, with email going to a local capture server.
//
// The path a Messenger order takes:
//   - Anthony counts his shelf, then takes an order for two signed copies
//     with no address yet. It gets INV-1001, two copies come off the shelf,
//     the buyer lands in the CRM tagged Book Buyer, and a "collect" reminder
//     and an "address" reminder appear in Tasks.
//   - The buyer opens the private invoice link: only the right token works,
//     and it shows the buyer's view (no internal notes, no CRM ids).
//   - They pay by card: the signed checkout event marks the order paid,
//     closes the collect task, and emails Anthony.
//   - He adds the address, ships with tracking, and the reminders follow:
//     ship task closes, review-ask task opens. Cancelling a second order
//     puts its copies back, and dropping under the threshold opens a
//     reorder task.
//
// From the repo root: `npm run e2e:hand-sales` in tests/.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const stripe = require(path.join(ROOT, 'functions', 'node_modules', 'stripe'))('sk_test_fake');
const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const OWNER_EMAIL = 'the1percentnation@gmail.com';
const CO = 'co-academy';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name]); console.log('❌', name, '—', e && e.message); }
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
  try { const j = await call('getInvoice', {}); if (j.error) break; } catch (e) { /* not yet */ }
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
    return { token: k.idToken, uid: j.localId };
  }
  return { token: j.idToken, uid: j.localId };
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const asAdmin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const read = (p) => asAdmin(async (db) => { const s = await getDoc(doc(db, p)); return s.exists() ? s.data() : null; });
const list = (p) => asAdmin(async (db) => (await getDocs(collection(db, p))).docs.map((d) => ({ id: d.id, ...d.data() })));

const owner = await account(OWNER_EMAIL, { role: 'owner' });
const member = await account('member@e2e.test');
await asAdmin(async (db) => {
  await setDoc(doc(db, `users/${owner.uid}`), { email: OWNER_EMAIL, role: 'owner', companyId: CO });
  await setDoc(doc(db, `users/${member.uid}`), { email: 'member@e2e.test', role: 'user' });
  await setDoc(doc(db, `companies/${CO}`), { name: 'The One Percent', adminUids: [owner.uid] });
  await setDoc(doc(db, 'products/book-i-cant'), { name: "I Can't: Is Not A Strategy", type: 'book', status: 'live', price: 49, salePrice: 14.99, sellable: false, inventory: null });
  await setDoc(doc(db, 'config/handSales'), { cashapp: '$OnePct', lowStockAt: 5 });
});

const ORDER = {
  channel: 'facebook',
  buyer: { name: 'Jane Doe', email: 'jane@e2e.test', handle: 'facebook.com/jane.doe' },
  items: [{ productId: 'book-i-cant', qty: 2, unitPrice: 20 }],
  delivery: 'ship',
  shipping: { name: 'Jane Doe', address: { line1: '', city: '', state: '', postal_code: '' } },
  shippingFee: 5,
  payment: { status: 'unpaid' },
  giftMessage: 'To Jane: keep going',
  notes: 'Met at the Tulsa keynote'
};
let orderId = null;
let token = null;

await t('a member cannot take a hand sale', async () => {
  const j = await call('manageHandSale', { action: 'create', order: ORDER }, member.token);
  assert(j.error && j.error.status === 'PERMISSION_DENIED', JSON.stringify(j));
});

await t('the owner starts counting the shelf at 8', async () => {
  const j = await call('adjustStock', { productId: 'book-i-cant', setTo: 8, reorderAt: 5, unitCost: 4.5 }, owner.token);
  assert(j.result && j.result.onHand === 8, JSON.stringify(j));
});

await t('a Messenger order gets INV-1001, its own link, and waits on an address', async () => {
  const j = await call('manageHandSale', { action: 'create', order: ORDER }, owner.token);
  assert(j.result && j.result.invoiceNumber === 'INV-1001', JSON.stringify(j));
  orderId = j.result.id;
  token = new URL(j.result.url).searchParams.get('t');
  const o = await read(`orders/${orderId}`);
  assert(o.kind === 'manual' && o.status === 'needs-address' && o.amountTotal === 45, JSON.stringify({ s: o.status, a: o.amountTotal }));
  assert(o.payment.status === 'unpaid' && o.ownerUid === owner.uid, 'payment/owner');
});

await t('two copies came off the shelf, with a move that names the invoice', async () => {
  const s = await read('stock/book-i-cant');
  assert(s.onHand === 6, 'onHand ' + s.onHand);
  const moves = await list('stock/book-i-cant/moves');
  assert(moves.some((m) => m.delta === -2 && m.invoiceNumber === 'INV-1001'), JSON.stringify(moves));
});

await t('the buyer is in the CRM as a Book Buyer from Facebook Messenger', async () => {
  const o = await read(`orders/${orderId}`);
  assert(o.companyId === CO && o.contactId, 'not linked');
  const c = await read(`companies/${CO}/contacts/${o.contactId}`);
  assert(c.email === 'jane@e2e.test' && c.tags.includes('Book Buyer') && c.source === 'Book Sale', JSON.stringify(c));
  assert(/Facebook Messenger/.test(c.sourceDetail), c.sourceDetail);
});

await t('reminders: collect the money and get the address, both assigned to the owner', async () => {
  const o = await read(`orders/${orderId}`);
  assert(o.tasks.collect && o.tasks.address && !o.tasks.ship, JSON.stringify(o.tasks));
  const c = await read(`companies/${CO}/tasks/${o.tasks.collect}`);
  assert(c.status === 'open' && c.assigneeUid === owner.uid && /Collect \$45\.00 from Jane Doe \(INV-1001\)/.test(c.title), JSON.stringify(c));
  assert(c.dueAt && c.remindedAt === null, 'due/remindedAt');
});

await t('Remind: a reminder is stamped, logged, and pushes the collect task out', async () => {
  const before = await read(`orders/${orderId}`);
  const task0 = await read(`companies/${CO}/tasks/${before.tasks.collect}`);
  await call('manageHandSale', { action: 'sent', id: orderId, via: 'messenger' }, owner.token);
  const j = await call('manageHandSale', { action: 'sent', id: orderId, via: 'messenger', reminder: true }, owner.token);
  assert(j.result && j.result.ok, JSON.stringify(j));
  await call('manageHandSale', { action: 'sent', id: orderId, via: 'phone-text', reminder: true }, owner.token);
  const o = await read(`orders/${orderId}`);
  assert(o.invoiceSentVia === 'messenger' && o.remindedAt && o.remindedVia === 'phone-text' && o.reminderCount === 2,
    JSON.stringify({ sent: o.invoiceSentVia, via: o.remindedVia, n: o.reminderCount }));
  const task1 = await read(`companies/${CO}/tasks/${before.tasks.collect}`);
  assert(task1.status === 'open' && task1.dueAt.toMillis() > task0.dueAt.toMillis(), 'collect task not pushed out');
  const acts = await asAdmin((db) => getDocs(collection(db, `companies/${CO}/contacts/${o.contactId}/activities`)));
  assert(acts.docs.some((d) => /Payment reminder for INV-1001 sent by Messenger/.test(d.data().description)), 'no CRM activity');
});

await t('the invoice opens only with the right token, and shows the buyer view', async () => {
  const bad = await call('getInvoice', { id: orderId, token: 'x'.repeat(48) });
  assert(bad.error && bad.error.status === 'NOT_FOUND', JSON.stringify(bad));
  const j = await call('getInvoice', { id: orderId, token });
  const v = j.result;
  assert(v && v.invoiceNumber === 'INV-1001' && v.total === 45 && v.items[0].qty === 2, JSON.stringify(j));
  // A Cash App tag saved before invoices went Stripe-only must not print.
  assert(v.payOptions.length === 1 && v.payOptions[0].key === 'card', JSON.stringify(v.payOptions));
  const raw = JSON.stringify(v);
  assert(!/Tulsa keynote|contactId|invoiceToken|ownerUid/.test(raw), 'internal fields leaked: ' + raw);
  assert((await read(`orders/${orderId}`)).viewedAt, 'first open not recorded');
});

await t('paid by card through the invoice: the webhook marks it paid and tells the owner', async () => {
  const session = {
    id: 'cs_inv_1', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
    amount_total: 4500, currency: 'usd', payment_intent: 'pi_inv_1',
    customer_details: { email: 'jane@e2e.test' },
    metadata: { kind: 'invoice', orderId, invoiceNumber: 'INV-1001' }
  };
  const event = { id: 'evt_inv_1', object: 'event', type: 'checkout.session.completed', api_version: '2024-06-20', created: Math.floor(Date.now() / 1000), livemode: false, data: { object: session } };
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_e2e_fake' });
  const r = await fetch(`${FN}/stripeWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
  assert(r.status === 200, `webhook ${r.status}: ${await r.text()}`);
  const o = await read(`orders/${orderId}`);
  assert(o.payment.status === 'paid' && o.payment.method === 'card' && o.payment.reference === 'pi_inv_1', JSON.stringify(o.payment));
  assert(!o.tasks.collect && o.tasks.address, JSON.stringify(o.tasks));
  assert(emails.some((m) => /Paid: INV-1001/.test(m.subject)), 'no paid notice: ' + emails.map((m) => m.subject).join(' | '));
});

await t('a paid invoice will not open another checkout', async () => {
  const j = await call('payInvoice', { id: orderId, token });
  assert(j.error && /already paid/.test(j.error.message), JSON.stringify(j));
});

await t('adding the address moves it to ship, with a ship reminder', async () => {
  const j = await call('manageHandSale', { action: 'update', id: orderId, order: { ...ORDER, payment: undefined, shipping: { name: 'Jane Doe', address: { line1: '123 Main St', city: 'Dallas', state: 'TX', postal_code: '75201' } } } }, owner.token);
  assert(j.result && j.result.status === 'new', JSON.stringify(j));
  const o = await read(`orders/${orderId}`);
  assert(o.payment.status === 'paid', 'edit dropped the card payment: ' + JSON.stringify(o.payment));
  assert(o.tasks.ship && !o.tasks.address, JSON.stringify(o.tasks));
  assert((await read('stock/book-i-cant')).onHand === 6, 'an edit with the same qty moved stock');
});

await t('shipping closes the ship task and opens the review ask', async () => {
  const before = await read(`orders/${orderId}`);
  const j = await call('manageHandSale', { action: 'ship', id: orderId, carrier: 'USPS', number: '9400 1000' }, owner.token);
  assert(j.result && j.result.status === 'shipped', JSON.stringify(j));
  const o = await read(`orders/${orderId}`);
  assert(o.tracking.number === '9400 1000' && o.tasks.review && !o.tasks.ship, JSON.stringify(o.tasks));
  const shipTask = await read(`companies/${CO}/tasks/${before.tasks.ship}`);
  assert(shipTask.status === 'done', 'ship task still open');
  const v = (await call('getInvoice', { id: orderId, token })).result;
  assert(v.tracking && v.tracking.number === '9400 1000' && v.payOptions.length === 0, JSON.stringify(v.tracking));
});

await t('a second order dips the shelf under the line and opens a reorder task', async () => {
  const j = await call('manageHandSale', { action: 'create', order: { ...ORDER, buyer: { name: 'Sam Lee', phone: '+15555550123' }, items: [{ productId: 'book-i-cant', qty: 3, unitPrice: 20 }], delivery: 'hand', payment: { status: 'paid', method: 'cash' } } }, owner.token);
  assert(j.result && j.result.invoiceNumber === 'INV-1002' && j.result.status === 'new', JSON.stringify(j));
  const s = await read('stock/book-i-cant');
  assert(s.onHand === 3 && s.lowStockTaskId, JSON.stringify(s));
  const task = await read(`companies/${CO}/tasks/${s.lowStockTaskId}`);
  assert(task.status === 'open' && /Reorder I Can't/.test(task.title), JSON.stringify(task));
  const o = await read(`orders/${j.result.id}`);
  assert(o.tasks.ship && !o.tasks.collect, 'a paid hand delivery should only have a deliver task: ' + JSON.stringify(o.tasks));
  globalThis.second = j.result.id;
});

await t('Send invoice from the order card records how it went out, in the CRM too', async () => {
  const bad = await call('manageHandSale', { action: 'sent', id: globalThis.second, via: 'carrier-pigeon' }, owner.token);
  assert(bad.error && /Unknown send channel/.test(bad.error.message), JSON.stringify(bad));
  const m = await call('manageHandSale', { action: 'sent', id: globalThis.second, via: 'manual' }, owner.token);
  assert(m.result && (await read(`orders/${globalThis.second}`)).invoiceSentVia === 'manual', 'mark-sent: ' + JSON.stringify(m));
  const j = await call('manageHandSale', { action: 'sent', id: globalThis.second, via: 'phone-text' }, owner.token);
  assert(j.result && j.result.ok, JSON.stringify(j));
  const o = await read(`orders/${globalThis.second}`);
  assert(o.invoiceSentAt && o.invoiceSentVia === 'phone-text', JSON.stringify({ at: o.invoiceSentAt, via: o.invoiceSentVia }));
  const acts = await asAdmin((db) => getDocs(collection(db, `companies/${CO}/contacts/${o.contactId}/activities`)));
  assert(acts.docs.some((d) => /Invoice INV-1002 sent by a text from your phone/.test(d.data().description)), 'no CRM activity');
});

await t('Remind: a paid order refuses a reminder', async () => {
  const j = await call('manageHandSale', { action: 'sent', id: globalThis.second, via: 'messenger', reminder: true }, owner.token);
  assert(j.error && /already settled/.test(j.error.message), JSON.stringify(j));
});

await t('cancelling it puts the copies back and closes the reorder task', async () => {
  const j = await call('manageHandSale', { action: 'cancel', id: globalThis.second }, owner.token);
  assert(j.result && j.result.status === 'cancelled', JSON.stringify(j));
  const s = await read('stock/book-i-cant');
  assert(s.onHand === 6 && !s.lowStockTaskId, JSON.stringify(s));
  const o = await read(`orders/${globalThis.second}`);
  assert(Object.keys(o.tasks).length === 0, 'cancelled order kept tasks: ' + JSON.stringify(o.tasks));
});

await t('a box from the printer is received', async () => {
  const j = await call('adjustStock', { productId: 'book-i-cant', delta: 50, reason: 'received', note: 'KDP author copies' }, owner.token);
  assert(j.result && j.result.onHand === 56, JSON.stringify(j));
});

await t('the client cannot move a hand sale around the callable', async () => {
  const db = env.authenticatedContext(owner.uid, { role: 'owner' }).firestore();
  let refused = false;
  try { await setDoc(doc(db, `orders/${orderId}`), { status: 'done' }, { merge: true }); } catch (e) { refused = true; }
  assert(refused, 'owner wrote a hand sale directly');
});

await t('Morning digest: one collections email a day, each order a tap from its send sheet', async () => {
  await asAdmin((db) => setDoc(doc(db, 'config/handSales'), { digestHour: 1 }, { merge: true }));
  const j = await call('manageHandSale', { action: 'create', order: { ...ORDER, buyer: { name: 'Dana Fox', phone: '+15555550199' } } }, owner.token);
  assert(j.result && j.result.invoiceNumber === 'INV-1003', JSON.stringify(j));
  const tick = async (q = '') => {
    const r = await fetch(`${FN}/runAutomationTick${q}`, { method: 'POST', headers: { 'X-Tick-Secret': 'e2e-tick-secret' } });
    return (await r.json()).storeDigest;
  };
  const dry = await tick('?dryRun=1');
  if (dry && dry.skipped === 'before send time') { console.log('   (before 1am Eastern: digest timing not exercised)'); return; }
  assert(dry && dry.wouldSend && dry.unsent === 1, 'dry run: ' + JSON.stringify(dry));
  const before = emails.length;
  const real = await tick();
  assert(real && real.sent && real.unsent === 1, 'tick: ' + JSON.stringify(real));
  const mail = emails.slice(before).find((m) => /^Collect today/.test(m.subject));
  assert(mail, 'no digest email: ' + emails.slice(before).map((m) => m.subject).join(' | '));
  assert(/1 invoice to send/.test(mail.subject), mail.subject);
  // The Telnyx provider carries bodies as html_body / text_body.
  assert(mail.html_body.includes(`manage-store.html?tab=orders&send=${j.result.id}`), 'no Send link in the email');
  assert(/Dana Fox/.test(mail.html_body) && /Dana Fox/.test(mail.text_body), 'buyer missing');
  const again = await tick();
  assert(again && again.skipped === 'already sent today', 'second tick: ' + JSON.stringify(again));
});

await env.cleanup();
capture.close();
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
