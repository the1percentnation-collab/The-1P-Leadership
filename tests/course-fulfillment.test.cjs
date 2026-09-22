// The I Can't offer, pinned against the shipped code: what a course checkout
// puts in front of the buyer, and what it owes them afterwards.
//
// Extracted from functions/index.js the same way the inbound-email suite is,
// so a change to the fulfillment rules cannot quietly turn the digital book
// off, charge the paperback add-on twice, or bill shipping every month on a
// payment plan.
//
// Run: node tests/course-fulfillment.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const start = src.indexOf('const COURSE_FULFILLMENT = {');
const end = src.indexOf('// Stripe moved the collected address');
assert.ok(start > 0 && end > start, 'could not locate the course fulfillment block');

const fn = new Function('Math', 'String', 'Number', 'Array',
  src.slice(start, end)
  + '\nreturn { courseFulfillment, courseLineItems, PAPERBACK_SHIPPING_DEFAULT,'
  + ' SHIPPED_BOOK_NAME, EBOOK_NAME, EBOOK_EDITION };');
const {
  courseFulfillment, courseLineItems, PAPERBACK_SHIPPING_DEFAULT, EBOOK_EDITION
} = fn(Math, String, Number, Array);

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const items = (over = {}) => courseLineItems({
  course: { title: 'I Can\'t: The Course' },
  slug: 'icant',
  fulfil: courseFulfillment('icant', {}),
  chargeDollars: 197,
  plan: null,
  isSubscription: false,
  wantsPaperback: false,
  ...over
});
const names = (list) => list.map((i) => i.price_data.product_data.name);
const cents = (list) => list.map((i) => i.price_data.unit_amount);

console.log('course fulfillment — the I Can\'t offer');

// ── Defaults ──────────────────────────────────────────────────────────────

ok('the course sells on its own, with the digital book and the paperback add-on', () => {
  const f = courseFulfillment('icant', {});
  assert.strictEqual(f.sellable, true);
  assert.strictEqual(f.includesEbook, true);
  assert.strictEqual(f.paperbackUpgrade, true);
  assert.strictEqual(f.shipsBook, false);
  assert.strictEqual(f.paperbackShipping, PAPERBACK_SHIPPING_DEFAULT);
});

// The bundle was the same offer at the same price, so it is retired: not for
// sale, but it still unlocks the course for the members who bought it, which
// is what the webhook reads when their old session is replayed.
ok('the retired bundle is not for sale and still unlocks the course', () => {
  const f = courseFulfillment('bundle-icant', {});
  assert.strictEqual(f.sellable, false);
  assert.deepStrictEqual(f.enrollsAlso, ['icant']);
});

ok('an unlisted course gets neither the book nor the add-on', () => {
  const f = courseFulfillment('1p-clc', {});
  assert.strictEqual(f.includesEbook, false);
  assert.strictEqual(f.paperbackUpgrade, false);
  assert.strictEqual(f.sellable, true);
});

// ── Firestore overrides ───────────────────────────────────────────────────

ok('Firestore turns the offer off without a deploy', () => {
  const f = courseFulfillment('icant', { includesEbook: false, paperbackUpgrade: false });
  assert.strictEqual(f.includesEbook, false);
  assert.strictEqual(f.paperbackUpgrade, false);
});

ok('a course that already ships the book never upsells it', () => {
  const f = courseFulfillment('icant', { shipsBook: true, paperbackUpgrade: true });
  assert.strictEqual(f.paperbackUpgrade, false);
});

ok('a nonsense shipping charge is clamped, not honored', () => {
  assert.strictEqual(courseFulfillment('icant', { paperbackShipping: 900 }).paperbackShipping, 49);
  assert.strictEqual(courseFulfillment('icant', { paperbackShipping: 0 }).paperbackShipping, 1);
  assert.strictEqual(courseFulfillment('icant', { paperbackShipping: 12.499 }).paperbackShipping, 12.5);
});

ok('a blank shipping field falls back to the default', () => {
  assert.strictEqual(courseFulfillment('icant', { paperbackShipping: null }).paperbackShipping,
    PAPERBACK_SHIPPING_DEFAULT);
});

// ── What the buyer sees on the Stripe page ────────────────────────────────

ok('a plain enrollment shows the course and the digital book at $0', () => {
  const list = items();
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(cents(list), [19700, 0]);
  assert.match(names(list)[1], /digital edition.*included/i);
});

ok('taking the add-on charges shipping once, as its own line', () => {
  const list = items({ wantsPaperback: true });
  assert.strictEqual(list.length, 3);
  assert.deepStrictEqual(cents(list), [19700, 0, 995]);
  assert.match(names(list)[2], /paperback.*shipping only/i);
});

ok('a promo price carries into the course line, not the add-on', () => {
  const list = items({ chargeDollars: 97, wantsPaperback: true });
  assert.deepStrictEqual(cents(list), [9700, 0, 995]);
});

ok('a course with neither extra is a single line item', () => {
  const list = items({ fulfil: courseFulfillment('1p-clc', {}) });
  assert.strictEqual(list.length, 1);
});

// ── Recurring checkouts stay clean ────────────────────────────────────────

ok('a payment plan bills the installment only — no $0 or shipping line', () => {
  const list = items({
    plan: { installments: 6, monthlyCents: 69700, label: '6 payments of $697' },
    wantsPaperback: true
  });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].price_data.unit_amount, 69700);
  assert.deepStrictEqual(list[0].price_data.recurring, { interval: 'month' });
});

ok('a subscription course carries no one-time extras into every renewal', () => {
  const list = items({
    course: { title: 'Membership', pricing: { mode: 'subscription', interval: 'year' } },
    isSubscription: true,
    wantsPaperback: true
  });
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual(list[0].price_data.recurring, { interval: 'year' });
});

ok('Stripe\'s 50c floor still applies to the course line', () => {
  assert.strictEqual(cents(items({ chargeDollars: 0.1 }))[0], 50);
});

ok('the digital entitlement is keyed to the book, not the course', () => {
  assert.strictEqual(EBOOK_EDITION, 'i-cant');
});

console.log(`\n${passed} assertions passed.`);
