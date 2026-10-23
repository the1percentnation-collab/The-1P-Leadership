// Hand sales: the books Anthony sells himself (Messenger, events, texts).
//
// The store console, the invoice page and the server each run a copy of
// hand-sales-core. If they drift, the console could show one total and the
// invoice charge another, or the reminders could fire for an order that is
// already handled. These pin the money math, the work queue, the stock
// count, and which reminder tasks an order should have open.
//
// Run: node tests/hand-sales.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loadPure } from './_load-pure.mjs';

const core = await loadPure('hand-sales-core.js');
const server = createRequire(import.meta.url)('../functions/hand-sales-core.js');
const {
  computeTotals, normalizeOrder, deliveryStatus, orderBucket, stockDelta, taskPlan, parseAddress,
  paymentOptions, invoiceMessage, reminderMessage, reminderDue, lastNudgeMs, collectionsDigest, smsLink, dmLink, summarize, invoiceNumber, isPaid, lowStock, mergeSettings
} = core;

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const products = { 'book-i-cant': { name: "I Can't: Is Not A Strategy" } };
const addr = { name: 'Jane Doe', address: { line1: '123 Main St', city: 'Dallas', state: 'tx', postal_code: '75201' } };
const input = (extra = {}) => ({
  channel: 'facebook',
  buyer: { name: 'Jane Doe', email: 'JANE@x.com ' },
  items: [{ productId: 'book-i-cant', qty: 2, unitPrice: 19.99 }],
  delivery: 'ship',
  shipping: addr,
  shippingFee: 5,
  ...extra
});
const manual = (extra = {}) => ({ kind: 'manual', ...normalizeOrder(input(), { products }), status: 'new', ...extra });

console.log('hand sales — server copy');

ok('the server copy is the generated copy of the browser module', () => {
  const src = fs.readFileSync(new URL('../public/js/hand-sales-core.js', import.meta.url), 'utf8');
  const gen = fs.readFileSync(new URL('../functions/hand-sales-core.js', import.meta.url), 'utf8');
  const body = src.slice(0, src.lastIndexOf('\nexport {') + 1);
  assert.ok(gen.includes(body), 'functions/hand-sales-core.js is stale: run node scripts/build-hand-sales-server.cjs');
  assert.deepStrictEqual(Object.keys(server).sort(), Object.keys(core).sort());
});

ok('the server wires every hand-sale entry point', () => {
  const src = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  ['manageHandSale', 'adjustStock', 'getInvoice', 'payInvoice'].forEach((n) => {
    assert.ok(src.includes(`exports.${n} = onCall(`), `${n} is not exported`);
  });
  assert.ok(/metadata\.kind === 'invoice'\)\s*\{\s*await handleInvoiceCheckout/.test(src), 'the webhook does not mark invoices paid');
});

ok('a failed morning digest gives the day back so the next tick retries', () => {
  const src = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const i = src.indexOf('async function sendStoreDigest(');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  const send = body.indexOf('await sendEmail(');
  assert.ok(body.indexOf('runTransaction') < send, 'the day is claimed after sending');
  const release = body.slice(send).match(/catch \(e\) \{([\s\S]*?)throw e;/);
  assert.ok(release && /stateRef\.set\(last\.data\(\)\)/.test(release[1]) && /stateRef\.delete\(\)/.test(release[1]),
    'a failed send keeps the claim, so today\'s digest is never retried');
});

console.log('hand sales — money');

ok('totals add up in cents, not floats', () => {
  const t = computeTotals({ items: [{ qty: 3, unitPrice: 0.1 }, { qty: 1, unitPrice: 19.99 }], shippingFee: 4.99, discount: 1, tax: 1.65 });
  assert.deepStrictEqual(t, { subtotal: 20.29, shippingFee: 4.99, discount: 1, tax: 1.65, total: 25.93 });
});

ok('a discount can bring an order to zero but never below', () => {
  assert.strictEqual(computeTotals({ items: [{ qty: 1, unitPrice: 20 }], shippingFee: 5, discount: 100 }).total, 0);
});

ok('invoice numbers read INV-1001', () => {
  assert.strictEqual(invoiceNumber(1001), 'INV-1001');
  assert.strictEqual(invoiceNumber(7), 'INV-0007');
});

console.log('hand sales — taking an order');

ok('a Messenger order normalizes: catalog name, lowercased email, uppercased state', () => {
  const o = normalizeOrder(input(), { products });
  assert.strictEqual(o.items[0].name, "I Can't: Is Not A Strategy");
  assert.strictEqual(o.buyer.email, 'jane@x.com');
  assert.strictEqual(o.shipping.address.state, 'TX');
  assert.strictEqual(o.amountTotal, 44.98);
  assert.strictEqual(o.payment.status, 'unpaid');
});

ok('it refuses an order with no buyer or no items, listing both', () => {
  assert.throws(() => normalizeOrder({ items: [] }, { products }), (e) => e.errors.length === 2);
});

ok('a product id the catalog does not know becomes a custom line, not a stock hit', () => {
  const o = normalizeOrder(input({ items: [{ productId: 'nope', name: 'Bookmark', qty: 1, unitPrice: 3 }] }), { products });
  assert.strictEqual(o.items[0].productId, null);
  assert.strictEqual(o.items[0].name, 'Bookmark');
});

ok('hand delivery drops the address and the shipping fee', () => {
  const o = normalizeOrder(input({ delivery: 'hand' }), { products });
  assert.strictEqual(o.shipping, null);
  assert.strictEqual(o.shippingFee, 0);
  assert.strictEqual(o.amountTotal, 39.98);
});

ok('a $0 order counts as a comp, and "paid" needs a method', () => {
  assert.strictEqual(normalizeOrder(input({ items: [{ productId: 'book-i-cant', qty: 1, unitPrice: 0 }], shippingFee: 0 }), { products }).payment.status, 'comp');
  assert.throws(() => normalizeOrder(input({ payment: { status: 'paid' } }), { products }), /how they paid/);
});

console.log('hand sales — the work queue');

ok('no address yet parks a shipped order in needs-address; hand delivery never does', () => {
  assert.strictEqual(deliveryStatus({ delivery: 'ship', shipping: null, status: 'new' }), 'needs-address');
  assert.strictEqual(deliveryStatus({ delivery: 'ship', shipping: addr.address ? { address: { ...addr.address, state: 'TX' } } : null, status: 'needs-address' }), 'new');
  assert.strictEqual(deliveryStatus({ delivery: 'hand', shipping: null, status: 'new' }), 'new');
  assert.strictEqual(deliveryStatus({ delivery: 'ship', shipping: null, status: 'shipped' }), 'shipped');
});

ok('money comes first: an unpaid order is "collect" even if it already shipped', () => {
  assert.strictEqual(orderBucket(manual()), 'collect');
  assert.strictEqual(orderBucket(manual({ status: 'shipped' })), 'collect');
  assert.strictEqual(orderBucket(manual({ payment: { status: 'paid' } })), 'ship');
  assert.strictEqual(orderBucket(manual({ payment: { status: 'paid' }, status: 'needs-address' })), 'address');
  assert.strictEqual(orderBucket(manual({ status: 'cancelled' })), 'cancelled');
});

ok('Stripe orders in the same list count as paid', () => {
  assert.ok(isPaid({ status: 'new', amountTotal: 30 }));
  assert.strictEqual(orderBucket({ status: 'needs-address' }), 'address');
});

console.log('hand sales — stock');

ok('a new order takes its copies off the shelf; custom lines take none', () => {
  const o = manual({ items: [{ productId: 'book-i-cant', qty: 2 }, { productId: null, name: 'Bookmark', qty: 5 }] });
  assert.deepStrictEqual(stockDelta(null, o), { 'book-i-cant': -2 });
});

ok('editing the quantity moves only the difference', () => {
  const before = manual();
  const after = { ...before, items: [{ ...before.items[0], qty: 3 }] };
  assert.deepStrictEqual(stockDelta(before, after), { 'book-i-cant': -1 });
  assert.deepStrictEqual(stockDelta(before, before), {});
});

ok('cancelling puts the copies back, and reopening takes them again', () => {
  const live = manual();
  const dead = { ...live, status: 'cancelled' };
  assert.deepStrictEqual(stockDelta(live, dead), { 'book-i-cant': 2 });
  assert.deepStrictEqual(stockDelta(dead, live), { 'book-i-cant': -2 });
});

ok('low stock uses the product threshold before the default', () => {
  assert.ok(lowStock(5, mergeSettings({})));
  assert.ok(!lowStock(6, mergeSettings({})));
  assert.ok(lowStock(10, mergeSettings({}), 10));
});

console.log('hand sales — reminders');

const NOW = Date.UTC(2026, 9, 16);
ok('an unpaid order gets a collect task due on the payment terms', () => {
  const plan = taskPlan({ ...manual(), invoiceNumber: 'INV-1001' }, { dueDays: 3 }, NOW);
  assert.deepStrictEqual(Object.keys(plan), ['collect']);
  assert.match(plan.collect.title, /Collect \$44\.98 from Jane Doe \(INV-1001\)/);
  assert.strictEqual(plan.collect.dueAt, NOW + 3 * 86400000);
});

ok('paid with an address → ship task; paid without one → address task', () => {
  assert.deepStrictEqual(Object.keys(taskPlan(manual({ payment: { status: 'paid' } }), {}, NOW)), ['ship']);
  assert.deepStrictEqual(Object.keys(taskPlan(manual({ payment: { status: 'paid' }, status: 'needs-address' }), {}, NOW)), ['address']);
});

ok('once it ships the only task is the review ask, and asking clears it', () => {
  const shipped = manual({ payment: { status: 'paid' }, status: 'shipped' });
  assert.deepStrictEqual(Object.keys(taskPlan(shipped, {}, NOW)), ['review']);
  assert.deepStrictEqual(Object.keys(taskPlan({ ...shipped, reviewAskedAt: 1 }, {}, NOW)), []);
});

ok('a cancelled order has no open tasks', () => {
  assert.deepStrictEqual(taskPlan(manual({ status: 'cancelled' }), {}, NOW), {});
});

console.log('hand sales — paste and pay');

ok('addresses pasted from a chat split into fields', () => {
  assert.deepStrictEqual(parseAddress('Jane Doe\n123 Main St Apt 4\nDallas, TX 75201'),
    { name: 'Jane Doe', address: { line1: '123 Main St Apt 4', line2: '', city: 'Dallas', state: 'TX', postal_code: '75201', country: 'US' } });
  const b = parseAddress('123 Main St, Apt 4, Dallas, Texas 75201-1234, USA');
  assert.deepStrictEqual([b.address.line1, b.address.line2, b.address.city, b.address.state, b.address.postal_code], ['123 Main St', 'Apt 4', 'Dallas', 'TX', '75201']);
  const c = parseAddress('Mike Brown, 55 Oak Ave, Houston TX 77002');
  assert.deepStrictEqual([c.name, c.address.line1, c.address.city, c.address.state], ['Mike Brown', '55 Oak Ave', 'Houston', 'TX']);
  const d = parseAddress('4410 W Elm, New York, new york 10001');
  assert.deepStrictEqual([d.address.city, d.address.state], ['New York', 'NY']);
});

ok('invoices offer Stripe card checkout only, even with old handles still saved', () => {
  const opts = paymentOptions({ cashapp: '$OnePct', venmo: '@one-pct', paypal: 'https://paypal.me/onepct' }, { amountTotal: 24.99 });
  assert.deepStrictEqual(opts.map((o) => o.key), ['card']);
  assert.deepStrictEqual(paymentOptions({}, null, { cardEnabled: false }), []);
});

ok('the Messenger message carries the link, card-only pay, and an address ask when needed', () => {
  const o = { ...manual({ status: 'needs-address', shipping: null }), invoiceNumber: 'INV-1001' };
  const msg = invoiceMessage(o, 'https://x/invoice?i=1&t=2');
  assert.match(msg, /^Hey Jane!/);
  assert.match(msg, /https:\/\/x\/invoice\?i=1&t=2/);
  assert.match(msg, /pay by card right on that page\./);
  assert.doesNotMatch(msg, /Cash App|Venmo|Zelle|PayPal/);
  assert.match(msg, /address you want it shipped to/);
});

ok('Send invoice: a text opens his Messages app with the invoice filled in', () => {
  assert.strictEqual(smsLink('417-412-1382', 'Hi & pay: https://x/i?a=1'), 'sms:+14174121382?&body=Hi%20%26%20pay%3A%20https%3A%2F%2Fx%2Fi%3Fa%3D1');
  assert.strictEqual(smsLink('+1 (405) 826-3510', 'x'), 'sms:+14058263510?&body=x');
  assert.strictEqual(smsLink('555-1234', 'x'), null);
  assert.strictEqual(smsLink('', 'x'), null);
});

ok('Send invoice: the saved profile opens their Messenger or Instagram thread', () => {
  const dm = (handle, channel = 'facebook') => dmLink({ channel, buyer: { name: 'J', handle } });
  assert.deepStrictEqual(dm('https://www.facebook.com/TheJoshuaQuick'), { app: 'Messenger', url: 'https://m.me/TheJoshuaQuick' });
  assert.strictEqual(dm('facebook.com/brennan.fanning.7').url, 'https://m.me/brennan.fanning.7');
  assert.strictEqual(dm('https://www.facebook.com/profile.php?id=10001234').url, 'https://www.facebook.com/messages/t/10001234');
  assert.strictEqual(dm('https://www.facebook.com/groups/12345'), null);
  assert.deepStrictEqual(dm('https://instagram.com/the1pnation/'), { app: 'Instagram', url: 'https://ig.me/m/the1pnation' });
  assert.strictEqual(dm('@the1pnation', 'instagram').url, 'https://ig.me/m/the1pnation');
  assert.strictEqual(dm('@the1pnation', 'facebook'), null);
  assert.strictEqual(dm(''), null);
});

ok('Remind: due once a sent invoice sits unpaid for dueDays since the last nudge', () => {
  const day = 86400000;
  const sent = (extra = {}) => ({ ...manual(), invoiceSentAt: { toMillis: () => NOW - 4 * day }, ...extra });
  assert.strictEqual(reminderDue(manual(), {}, NOW), false, 'never sent: send it first, not a reminder');
  assert.strictEqual(reminderDue(sent(), {}, NOW), true);
  assert.strictEqual(reminderDue(sent(), { dueDays: 5 }, NOW), false);
  assert.strictEqual(reminderDue(sent({ remindedAt: NOW - day }), {}, NOW), false, 'a fresh reminder resets the clock');
  assert.strictEqual(reminderDue(sent({ payment: { status: 'paid' } }), {}, NOW), false);
  assert.strictEqual(reminderDue(sent({ status: 'cancelled' }), {}, NOW), false);
  assert.strictEqual(lastNudgeMs(sent({ remindedAt: NOW - day })), NOW - day);
  assert.strictEqual(lastNudgeMs(manual()), null);
});

ok('Remind: the follow-up carries the link and asks for an address when one is missing', () => {
  const o = { ...manual({ status: 'needs-address', shipping: null }), invoiceNumber: 'INV-1001' };
  const msg = reminderMessage(o, 'https://x/invoice?i=1&t=2');
  assert.match(msg, /^Hey Jane, circling back/);
  assert.match(msg, /still open here: https:\/\/x\/invoice\?i=1&t=2/);
  assert.match(msg, /address you want it shipped to/);
  assert.doesNotMatch(reminderMessage({ ...manual(), delivery: 'hand' }, 'u'), /address|mail/);
});

ok('Morning digest: reminders quiet longest first, unsent oldest first, paid and cancelled left out', () => {
  const day = 86400000;
  const at = (d) => ({ toMillis: () => NOW - d * day });
  const o = (id, extra) => ({ ...manual(), id, ...extra });
  const d = collectionsDigest([
    o('fresh', { invoiceSentAt: at(1), createdAt: at(1) }),
    o('quiet4', { invoiceSentAt: at(4), createdAt: at(5) }),
    o('quiet9', { invoiceSentAt: at(12), remindedAt: at(9), createdAt: at(12) }),
    o('new', { createdAt: at(0) }),
    o('old', { createdAt: at(2) }),
    o('paid', { invoiceSentAt: at(9), payment: { status: 'paid' } }),
    o('gone', { invoiceSentAt: at(9), status: 'cancelled' }),
    { id: 'site', kind: 'stripe', status: 'new', amountTotal: 30 }
  ], {}, NOW);
  assert.deepStrictEqual(d.remind.map((r) => [r.order.id, r.quietDays]), [['quiet9', 9], ['quiet4', 4]]);
  assert.deepStrictEqual(d.unsent.map((r) => [r.order.id, r.ageDays]), [['old', 2], ['new', 0]]);
  assert.strictEqual(d.owedCount, 5);
  assert.strictEqual(d.owed, 224.9);
  assert.strictEqual(d.toShip, 1);
  assert.strictEqual(d.empty, false);
  assert.strictEqual(collectionsDigest([o('fresh', { invoiceSentAt: at(1) })], {}, NOW).empty, true);
  assert.strictEqual(mergeSettings({}).digestHour, 8);
});

ok('a title ending in a period does not double up in the messages', () => {
  const o = { ...manual(), items: [{ qty: 1, name: "I Can't: Strategies To Overcoming Your Limiting Beliefs.", unitPrice: 14.99 }] };
  assert.doesNotMatch(invoiceMessage(o, 'u'), /\.\./);
  assert.doesNotMatch(reminderMessage(o, 'u'), /\.\./);
  assert.match(reminderMessage(o, 'u'), /Limiting Beliefs\.\n/);
});

ok('this month counts only paid, live orders; owed counts every unpaid one', () => {
  const at = Date.UTC(2026, 9, 10);
  const s = summarize([
    manual({ createdAtMs: at }),
    manual({ createdAtMs: at, payment: { status: 'paid' } }),
    manual({ createdAtMs: at, payment: { status: 'paid' }, status: 'cancelled' }),
    { status: 'new', amountTotal: 30, createdAtMs: at }
  ], NOW);
  assert.strictEqual(s.owed, 44.98);
  assert.strictEqual(s.owedCount, 1);
  assert.strictEqual(s.monthRevenue, 74.98);
  assert.strictEqual(s.toShip, 2);
});

console.log(`\n${passed} passed`);
