// The purchase confirmation email, rendered from the shipped template.
//
// The webhook sends it after every course checkout (purchase-e2e proves the
// send); this pins what it says, so a copy edit can't quietly drop the
// library link or put a paperback line in the digital email.
//
// Run: node tests/purchase-email.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const start = src.indexOf('function purchaseEmailContent(');
const end = src.indexOf('// Never throws: the purchase landed');
assert.ok(start > 0 && end > start, 'could not locate purchaseEmailContent in functions/index.js');
const helpers = `
  const APP_BASE_URL = 'https://the1pnation.com';
  function textToHtml(t) { return String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
`;
// eslint-disable-next-line no-new-func
const purchaseEmailContent = new Function(`${helpers}${src.slice(start, end)}; return purchaseEmailContent;`)();

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const book = { id: 'i-cant-strategies-to-overcoming-your-limiting-beliefs', title: 'I Can\'t Strategies To Overcoming Your Limiting Beliefs' };

console.log('purchase email — what the buyer is told');

ok('digital bundle: course, book in library, no paperback', () => {
  const m = purchaseEmailContent({ firstName: 'Jordan', courseTitle: 'The Complete I Can\'t Experience', courseSlug: 'icant', books: [book], shipsBook: false, shipping: null });
  assert.strictEqual(m.subject, 'You\'re in: The Complete I Can\'t Experience');
  assert.ok(m.text.startsWith('Hi Jordan,'));
  assert.ok(m.text.includes('https://the1pnation.com/courses.html?course=icant'), 'lands on the course the bundle unlocks');
  assert.ok(m.text.includes(book.title) && m.html.includes(book.title));
  assert.ok(m.text.includes('https://the1pnation.com/library') && m.html.includes('https://the1pnation.com/library'));
  assert.ok(!/paperback/i.test(m.text) && !/paperback/i.test(m.html));
});

ok('print bundle: names where the paperback ships', () => {
  const m = purchaseEmailContent({ firstName: '', courseTitle: 'The Complete I Can\'t Experience + Paperback', courseSlug: 'icant', books: [book], shipsBook: true,
    shipping: { name: 'Casey', address: { city: 'Oklahoma City', state: 'OK', country: 'US' } } });
  assert.ok(m.text.startsWith('Hi there,'), 'falls back to "there" without a name');
  assert.ok(m.text.includes('Your paperback ships to Oklahoma City, OK.'));
  assert.ok(m.html.includes('ships to Oklahoma City, OK'));
});

ok('print bundle without an address asks for one instead of pretending', () => {
  const m = purchaseEmailContent({ firstName: 'A', courseTitle: 'X', courseSlug: 'x', books: [], shipsBook: true, shipping: null });
  assert.ok(m.text.includes('reply to this email with one'));
  assert.ok(!m.text.includes('is in your library'), 'no library line when no book was granted');
});

ok('two books read as a list', () => {
  const m = purchaseEmailContent({ firstName: 'A', courseTitle: 'X', courseSlug: 'x', books: [book, { id: 'b', title: 'Second Book' }], shipsBook: false });
  assert.ok(m.text.includes(`${book.title} and Second Book`));
});

ok('html escapes what came from records', () => {
  const m = purchaseEmailContent({ firstName: '<b>', courseTitle: 'A & B', courseSlug: 'x', books: [{ id: 'z', title: '<script>' }], shipsBook: false });
  assert.ok(!m.html.includes('<script>') && m.html.includes('&lt;script&gt;'));
  assert.ok(m.html.includes('A &amp; B'));
});

const sample = purchaseEmailContent({ firstName: 'Jordan', courseTitle: 'The Complete I Can\'t Experience', courseSlug: 'icant', books: [book], shipsBook: false });
console.log('\n--- sample (digital) ---\nSubject: ' + sample.subject + '\n\n' + sample.text + '\n------------------------');
console.log(`\n${passed} passed`);
