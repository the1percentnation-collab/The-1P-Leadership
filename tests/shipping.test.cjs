// Shipping and the owner's new-order alert.
//
// The paperback checkouts asked for an address but never charged shipping,
// and nothing told the owner an order had come in. These pin the fix: flat
// US shipping in Stripe Checkout, commissions on the item and not the
// postage, and an alert that says what sold and where it goes.
//
// Run: node tests/shipping.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ship = require('../functions/shipping-core.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const session = (over = {}) => ({
  amount_total: 2098,
  total_details: { amount_shipping: 599, amount_tax: 0, amount_discount: 0 },
  customer_details: { name: 'Daniel Viruet', email: 'buyer@example.com' },
  collected_information: {
    shipping_details: {
      name: 'Daniel Viruet',
      address: { line1: '4120 S Lions Ave', line2: null, city: 'Broken Arrow', state: 'OK', postal_code: '74011', country: 'US' }
    }
  },
  metadata: {},
  ...over
});

console.log('shipping — flat rate and the new-order alert');

ok('flat shipping is $5.99 unless the record overrides it', () => {
  assert.strictEqual(ship.FLAT_SHIPPING_CENTS, 599);
  assert.strictEqual(ship.shippingCentsFor({}), 599);
  assert.strictEqual(ship.shippingCentsFor(null), 599);
  assert.strictEqual(ship.shippingCentsFor({ shippingCents: 0 }), 0);
  assert.strictEqual(ship.shippingCentsFor({ shippingCents: 799 }), 799);
  assert.strictEqual(ship.shippingCentsFor({ shippingCents: -5 }), 599);
  assert.strictEqual(ship.shippingCentsFor({ shippingCents: '3' }), 599);
});

ok('a one-time checkout collects a US address and charges shipping', () => {
  const f = ship.checkoutShippingFields({}, 'payment');
  assert.deepStrictEqual(f.shipping_address_collection, { allowed_countries: ['US'] });
  assert.strictEqual(f.shipping_options.length, 1);
  const rate = f.shipping_options[0].shipping_rate_data;
  assert.strictEqual(rate.type, 'fixed_amount');
  assert.deepStrictEqual(rate.fixed_amount, { amount: 599, currency: 'usd' });
});

ok('a subscription checkout gets the address but no shipping_options (Stripe refuses them)', () => {
  const f = ship.checkoutShippingFields({}, 'subscription');
  assert.ok(f.shipping_address_collection);
  assert.ok(!('shipping_options' in f));
  const line = ship.shippingLineItem({});
  assert.strictEqual(line.price_data.unit_amount, 599);
  assert.ok(!line.price_data.recurring, 'shipping must be a one-time charge');
  assert.strictEqual(ship.shippingLineItem({ shippingCents: 0 }), null);
});

ok('commission is on the item, not the postage', () => {
  assert.strictEqual(ship.shippingPaidCents(session()), 599);
  assert.strictEqual(ship.merchandiseDollars(session()), 14.99);
  assert.strictEqual(ship.merchandiseDollars({ amount_total: 1499 }), 14.99);
  assert.strictEqual(ship.merchandiseDollars({}), 0);
});

ok('the alert names the item, buyer, total and full address', () => {
  const c = ship.orderAlertContent({
    itemName: 'I Can\'t: Is Not A Strategy (paperback)',
    buyerName: 'Daniel Viruet', buyerEmail: 'buyer@example.com',
    totalCents: 2098, shippingCents: 599,
    shipping: session().collected_information.shipping_details,
    needsShipping: true, consoleUrl: 'https://the1pnation.com/manage-store.html'
  });
  assert.ok(c.subject.includes('New order'));
  assert.ok(c.subject.includes('$20.98'));
  assert.ok(c.subject.includes('Daniel Viruet'));
  for (const s of ['4120 S Lions Ave', 'Broken Arrow, OK 74011', 'includes $5.99 shipping', 'Ready to ship']) {
    assert.ok(c.text.includes(s), `text missing ${s}`);
  }
  assert.ok(c.html.includes('Broken Arrow, OK 74011'));
  assert.ok(c.html.includes('I Can&#39;t') || c.html.includes('I Can\'t'));
  assert.ok(c.html.includes('manage-store.html'));
});

ok('the alert flags a physical order with no address', () => {
  const c = ship.orderAlertContent({ itemName: 'Paperback', totalCents: 2098, needsShipping: true, shipping: null });
  assert.ok(c.text.includes('Needs a shipping address'));
  assert.ok(c.text.includes('(no address collected)'));
});

ok('a digital order says nothing ships', () => {
  const c = ship.orderAlertContent({ itemName: 'Audiobook', totalCents: 999, needsShipping: false });
  assert.ok(c.text.includes('nothing to ship'));
  assert.ok(!c.text.includes('Ship to'));
  assert.ok(!c.text.includes('shipping)'));
});

ok('buyer-supplied text is escaped in the alert html', () => {
  const c = ship.orderAlertContent({ itemName: 'Book', buyerName: '<script>x</script>', totalCents: 100, needsShipping: false });
  assert.ok(!c.html.includes('<script>'));
});

ok('both paperback checkouts and both webhook branches use it', () => {
  assert.ok(src.includes("shippingCore.checkoutShippingFields(product, 'payment')"), 'product checkout');
  assert.ok(src.includes('shippingCore.checkoutShippingFields(course, checkoutMode)'), 'course checkout');
  assert.ok(!/shipping_address_collection:\s*\{\s*allowed_countries/.test(src),
    'an address-only checkout came back: it ships for free');
  const alerts = src.match(/await sendOrderAlert\(/g) || [];
  assert.strictEqual(alerts.length, 2, 'store product and print-bundle orders both alert the owner');
  assert.ok(!src.includes('const saleAmount = (session.amount_total || 0) / 100;'),
    'commission is computed on the total again, shipping included');
});

ok('the webhook that sends the alert can send email', () => {
  const i = src.indexOf('exports.stripeWebhook = onRequest(');
  assert.ok(i > 0);
  assert.ok(src.slice(i, i + 300).includes('sendgridKey'));
});

console.log(`\n${passed} checks passed.`);
