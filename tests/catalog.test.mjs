// The catalog contract — one shape for courses and products, and the rules
// every surface reads through it. These pin the model rather than any one
// page: if a rule here changes, the homepage, /upcoming, the member store
// and the dashboard all change together, which is the point.
import assert from 'node:assert';
import { loadPure } from './_load-pure.mjs';

const {
  normalizeCourse, normalizeProduct, isOnSale, visibleOn, hrefFor, isExternal,
  ctaFor, nextLaunch, filterByTab, sortForDisplay
} = await loadPure('catalog-core.js');
const { priceInfo, saleEnded } = await loadPure('pricing.js');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2027, 2, 1, 12, 0).getTime();
const at = (d) => new Date(2027, 2, d).getTime();

const course = (over = {}) => ({ slug: 'c1', title: 'Course One', status: 'live', price: 100, ...over });
const product = (over = {}) => ({ id: 'p1', name: 'Book One', type: 'book', status: 'live', price: 20, ...over });

console.log('catalog — the shared publishing contract');

// ── Pricing ───────────────────────────────────────────────────────────────

ok('a sale price below the price is on sale, with both labels', () => {
  const p = priceInfo({ price: 49, salePrice: 14.99 }, { now: NOW });
  assert.strictEqual(p.onSale, true);
  assert.strictEqual(p.label, '$14.99');
  assert.strictEqual(p.originalLabel, '$49');
  assert.strictEqual(p.amount, 14.99);
});

ok('a sale price equal to or above the price is not a sale', () => {
  assert.strictEqual(priceInfo({ price: 20, salePrice: 20 }).onSale, false);
  assert.strictEqual(priceInfo({ price: 20, salePrice: 25 }).onSale, false);
});

ok('a sale ends itself on its end date', () => {
  const live = { price: 20, salePrice: 10, saleEndsAt: new Date(NOW + DAY) };
  const over = { price: 20, salePrice: 10, saleEndsAt: new Date(NOW - DAY) };
  assert.strictEqual(priceInfo(live, { now: NOW }).onSale, true);
  assert.strictEqual(priceInfo(over, { now: NOW }).onSale, false);
  assert.strictEqual(priceInfo(over, { now: NOW }).label, '$20', 'reverts to the regular price');
  assert.strictEqual(saleEnded(over, { now: NOW }), true);
});

ok('no end date means the sale is open-ended', () => {
  assert.strictEqual(saleEnded({ saleEndsAt: null }, { now: NOW }), false);
  assert.strictEqual(priceInfo({ price: 20, salePrice: 10 }, { now: NOW }).onSale, true);
});

ok('a Firestore Timestamp end date is read through toMillis', () => {
  const ts = { toMillis: () => NOW - 1 };
  assert.strictEqual(priceInfo({ price: 20, salePrice: 10, saleEndsAt: ts }, { now: NOW }).onSale, false);
});

ok('products get the identical pricing rule without a pricing map', () => {
  const p = priceInfo(product({ salePrice: 15 }), { now: NOW });
  assert.strictEqual(p.onSale, true);
  assert.strictEqual(p.isSubscription, false);
  assert.strictEqual(p.intervalSuffix, '');
});

// ── Normalisation ─────────────────────────────────────────────────────────

ok('a product normalises to the shared shape', () => {
  const i = normalizeProduct(product({ imageUrl: 'x.jpg', externalUrl: 'https://a.co/x', interestCount: 3 }), { now: NOW });
  assert.strictEqual(i.kind, 'product');
  assert.strictEqual(i.id, 'p1');
  assert.strictEqual(i.title, 'Book One');
  assert.strictEqual(i.category, 'Book');
  assert.strictEqual(i.status, 'live');
  assert.strictEqual(i.externalUrl, 'https://a.co/x');
  assert.strictEqual(i.interestCount, 3);
  assert.strictEqual(i.showOnSite, true);
  assert.strictEqual(i.showInDashboard, true);
});

ok('product status aliases map to the shared lifecycle', () => {
  const s = (status) => normalizeProduct(product({ status })).status;
  assert.strictEqual(s('interest'), 'coming-soon');
  assert.strictEqual(s('preorder'), 'preorder');
  assert.strictEqual(s('live'), 'live');
  assert.strictEqual(s('planned'), 'hidden');
  assert.strictEqual(s('archived'), 'hidden');
  assert.strictEqual(s('garbage'), 'hidden', 'an unknown status is never shown');
});

ok('a course normalises to the shared shape, reading the cover the builder writes', () => {
  const i = normalizeCourse(course({ coverImage: 'cover.jpg', short: 'Short', category: 'Mindset' }), { now: NOW });
  assert.strictEqual(i.kind, 'course');
  assert.strictEqual(i.id, 'c1');
  assert.strictEqual(i.imageUrl, 'cover.jpg');
  assert.strictEqual(i.summary, 'Short');
  assert.strictEqual(i.category, 'Mindset');
  assert.strictEqual(i.status, 'live');
});

ok('course status aliases: inactive hides, bundle reads as live with the flag', () => {
  assert.strictEqual(normalizeCourse(course({ status: 'inactive' })).status, 'hidden');
  const b = normalizeCourse(course({ status: 'bundle', bundleHref: '/bundle.html' }));
  assert.strictEqual(b.status, 'live');
  assert.strictEqual(b.isBundle, true);
});

ok('sold out is derived from a tracked inventory of zero, and only then', () => {
  assert.strictEqual(normalizeProduct(product({ inventory: 0 })).soldOut, true);
  assert.strictEqual(normalizeProduct(product({ inventory: 3 })).soldOut, false);
  assert.strictEqual(normalizeProduct(product({ inventory: null })).soldOut, false, 'untracked is never sold out');
});

ok('junk input yields null rather than a half-item', () => {
  assert.strictEqual(normalizeCourse(null), null);
  assert.strictEqual(normalizeCourse({}), null);
  assert.strictEqual(normalizeProduct({ name: 'no id' }), null);
});

// ── Channels ──────────────────────────────────────────────────────────────

ok('a live item with both switches default-on shows on both channels', () => {
  const i = normalizeProduct(product());
  assert.strictEqual(visibleOn(i, 'site'), true);
  assert.strictEqual(visibleOn(i, 'dashboard'), true);
});

ok('each switch controls only its own channel', () => {
  const siteOff = normalizeProduct(product({ showOnSite: false }));
  assert.strictEqual(visibleOn(siteOff, 'site'), false);
  assert.strictEqual(visibleOn(siteOff, 'dashboard'), true);
  const dashOff = normalizeCourse(course({ showInDashboard: false }));
  assert.strictEqual(visibleOn(dashOff, 'site'), true);
  assert.strictEqual(visibleOn(dashOff, 'dashboard'), false);
});

ok('hidden never shows, whatever the switches say', () => {
  const i = normalizeProduct(product({ status: 'archived', showOnSite: true, showInDashboard: true }));
  assert.strictEqual(visibleOn(i, 'site'), false);
  assert.strictEqual(visibleOn(i, 'dashboard'), false);
});

ok('a bundle-only course is never listed on its own', () => {
  const i = normalizeCourse(course({ sellable: false }));
  assert.strictEqual(visibleOn(i, 'site'), false);
  assert.strictEqual(visibleOn(i, 'dashboard'), false);
});

ok('an unknown channel shows nothing', () => {
  assert.strictEqual(visibleOn(normalizeProduct(product()), 'email'), false);
});

// ── Links and calls to action ─────────────────────────────────────────────

ok('a product with an off-site link goes off-site, otherwise to its anchor', () => {
  assert.strictEqual(hrefFor(normalizeProduct(product({ externalUrl: 'https://a.co/x' })), 'site'), 'https://a.co/x');
  assert.strictEqual(hrefFor(normalizeProduct(product()), 'site'), '/upcoming.html#p-p1');
  assert.strictEqual(isExternal('https://a.co/x'), true);
  assert.strictEqual(isExternal('/upcoming.html#p-p1'), false);
});

ok('a course goes to its sales page on the site and the library in the dashboard', () => {
  const i = normalizeCourse(course());
  assert.strictEqual(hrefFor(i, 'site'), '/course.html?course=c1');
  assert.strictEqual(hrefFor(i, 'dashboard'), '/courses.html?course=c1');
  assert.strictEqual(hrefFor(i, 'dashboard', { enrolled: true }), '/courses.html?course=c1');
});

ok('a coming-soon course sends a member to the sales page, not an empty library', () => {
  const i = normalizeCourse(course({ status: 'coming-soon' }));
  assert.strictEqual(hrefFor(i, 'dashboard'), '/course.html?course=c1');
});

ok('a live bundle goes to its bundle page', () => {
  const i = normalizeCourse(course({ kind: 'bundle', bundleHref: '/bundle.html' }));
  assert.strictEqual(hrefFor(i, 'site'), '/bundle.html');
});

// A course can own a long-form sales page — /bundle.html belongs to I Can't
// now that the bundle record is retired. It wins on the public site only:
// the dashboard is where a member opens what they already bought, and a
// course that isn't live must show the waitlist rather than an Enroll button.
ok('a live course with its own sales page goes there from the site', () => {
  const i = normalizeCourse(course({ salesHref: '/bundle.html' }));
  assert.strictEqual(hrefFor(i, 'site'), '/bundle.html');
  assert.strictEqual(hrefFor(i, 'dashboard'), '/courses.html?course=c1');
});

ok('a sales page is not advertised before the course is live', () => {
  const i = normalizeCourse(course({ salesHref: '/bundle.html', status: 'coming-soon' }));
  assert.strictEqual(hrefFor(i, 'site'), '/course.html?course=c1');
});

ok('a retired record is listed nowhere', () => {
  const i = normalizeCourse(course({ sellable: false }));
  assert.strictEqual(visibleOn(i, 'site'), false);
  assert.strictEqual(visibleOn(i, 'dashboard'), false);
});

ok('the call to action follows the state', () => {
  assert.strictEqual(ctaFor(normalizeCourse(course()), { enrolled: true }).kind, 'open');
  assert.strictEqual(ctaFor(normalizeCourse(course({ status: 'coming-soon' }))).kind, 'notify');
  assert.strictEqual(ctaFor(normalizeProduct(product({ externalUrl: 'https://a.co' }))).kind, 'external');
  assert.strictEqual(ctaFor(normalizeProduct(product({ sellable: true }))).kind, 'buy');
  assert.strictEqual(ctaFor(normalizeProduct(product({ sellable: true, inventory: 0 }))).kind, 'soldout');
  assert.strictEqual(ctaFor(normalizeProduct(product({ sellable: false }))).kind, 'notify');
  assert.strictEqual(ctaFor(normalizeProduct(product({ status: 'preorder', sellable: true }))).label, 'Pre-order');
});

// ── Next launch, across kinds ─────────────────────────────────────────────

ok('the soonest future launch wins, whichever kind it is', () => {
  const items = [
    normalizeCourse(course({ status: 'coming-soon', launchDate: new Date(at(20)) }), { now: NOW }),
    normalizeProduct(product({ status: 'interest', launchDate: new Date(at(10)) }), { now: NOW })
  ];
  const n = nextLaunch(items, { now: NOW });
  assert.strictEqual(n.item.kind, 'product');
  assert.strictEqual(n.ms, at(10));
});

ok('a pre-order with a ship date counts as a launch', () => {
  const n = nextLaunch([normalizeProduct(product({ status: 'preorder', launchDate: new Date(at(5)) }), { now: NOW })], { now: NOW });
  assert.ok(n && n.item.status === 'preorder');
});

ok('the launch respects the channel it is asked about', () => {
  const items = [normalizeProduct(product({ status: 'interest', launchDate: new Date(at(5)), showOnSite: false }), { now: NOW })];
  assert.strictEqual(nextLaunch(items, { channel: 'site', now: NOW }), null);
  assert.ok(nextLaunch(items, { channel: 'dashboard', now: NOW }));
});

ok('a passed date, a live item and an undated item are all skipped', () => {
  const items = [
    normalizeCourse(course({ status: 'coming-soon', launchDate: new Date(NOW - 3 * DAY) }), { now: NOW }),
    normalizeCourse(course({ slug: 'c2', status: 'live', launchDate: new Date(at(9)) }), { now: NOW }),
    normalizeCourse(course({ slug: 'c3', status: 'coming-soon' }), { now: NOW })
  ];
  assert.strictEqual(nextLaunch(items, { now: NOW }), null);
});

// ── Store tabs and ordering ───────────────────────────────────────────────

ok('the store tabs slice the list as labelled', () => {
  const items = [
    normalizeProduct(product({ id: 'a', status: 'live' }), { now: NOW }),
    normalizeProduct(product({ id: 'b', status: 'preorder' }), { now: NOW }),
    normalizeProduct(product({ id: 'c', status: 'interest' }), { now: NOW }),
    normalizeProduct(product({ id: 'd', status: 'live', salePrice: 5 }), { now: NOW })
  ];
  assert.deepStrictEqual(filterByTab(items, 'all').map((i) => i.id), ['a', 'b', 'c', 'd']);
  assert.deepStrictEqual(filterByTab(items, 'live').map((i) => i.id), ['a', 'b', 'd']);
  assert.deepStrictEqual(filterByTab(items, 'coming-soon').map((i) => i.id), ['c']);
  assert.deepStrictEqual(filterByTab(items, 'on-sale').map((i) => i.id), ['d']);
});

ok('display order is live first, then the owner\'s sort order', () => {
  const items = [
    normalizeProduct(product({ id: 'soon', status: 'interest', sortOrder: 0 })),
    normalizeProduct(product({ id: 'live2', status: 'live', sortOrder: 2 })),
    normalizeProduct(product({ id: 'live1', status: 'live', sortOrder: 1 }))
  ];
  assert.deepStrictEqual(sortForDisplay(items).map((i) => i.id), ['live1', 'live2', 'soon']);
});

console.log(`\n${passed} checks passed.`);
