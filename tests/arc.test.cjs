// The advance reader sign-up (/arc): what config/arc means and what the
// welcome email says. Extracted from the shipped functions/index.js so the
// rules asserted here are the rules that run.
//
// Run: node tests/arc.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const start = src.indexOf('const ARC_PLATFORMS');
const end = src.indexOf('// claimArcCopy');
assert.ok(start > 0 && end > start, 'could not locate the ARC helpers in functions/index.js');

const textToHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// eslint-disable-next-line no-new-func
const lib = new Function('APP_BASE_URL', 'textToHtml', 'escapeHtmlBasic', `${src.slice(start, end)}
  return { arcConfig, arcEmailContent, ARC_PLATFORMS };`)('https://the1pnation.com', textToHtml, textToHtml);

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

console.log('arc — the advance reader sign-up');

ok('with no config the sign-up is open, uncapped, for the I Can’t edition', () => {
  const c = lib.arcConfig(null);
  assert.strictEqual(c.open, true);
  assert.strictEqual(c.bookId, 'i-cant');
  assert.strictEqual(c.limit, null);
  assert.strictEqual(c.full, false);
});

ok('only an explicit false closes it', () => {
  assert.strictEqual(lib.arcConfig({ open: false }).open, false);
  assert.strictEqual(lib.arcConfig({ open: 0 }).open, true);
});

ok('a limit is full once claimed reaches it', () => {
  assert.strictEqual(lib.arcConfig({ limit: 50, claimed: 49 }).full, false);
  assert.strictEqual(lib.arcConfig({ limit: 50, claimed: 50 }).full, true);
  assert.strictEqual(lib.arcConfig({ limit: 0, claimed: 999 }).full, false);
});

ok('a malformed book id or review link falls back safely', () => {
  assert.strictEqual(lib.arcConfig({ bookId: '../users' }).bookId, 'i-cant');
  assert.strictEqual(lib.arcConfig({ reviewUrl: 'javascript:alert(1)' }).reviewUrl, null);
  assert.strictEqual(lib.arcConfig({ reviewUrl: 'https://amazon.com/x' }).reviewUrl, 'https://amazon.com/x');
});

ok('the welcome email links straight into the reader', () => {
  const m = lib.arcEmailContent({ firstName: 'Jo', bookTitle: 'I Can’t', bookId: 'i-cant', reviewUrl: null });
  assert.strictEqual(m.readUrl, 'https://the1pnation.com/read?book=i-cant');
  assert.ok(m.text.includes(m.readUrl));
  assert.ok(m.html.includes(`href="${m.readUrl}"`));
  assert.ok(/Amazon or Goodreads/.test(m.text));
});

ok('a configured review link is the one in the email', () => {
  const m = lib.arcEmailContent({ firstName: '', bookTitle: 'I Can’t', bookId: 'i-cant', reviewUrl: 'https://amazon.com/review' });
  assert.ok(m.text.includes('https://amazon.com/review'));
  assert.ok(m.html.includes('href="https://amazon.com/review"'));
});

ok('the copy carries no em dashes (brand voice)', () => {
  const m = lib.arcEmailContent({ firstName: 'Jo', bookTitle: 'I Can’t', bookId: 'i-cant', reviewUrl: null });
  assert.ok(!/—/.test(m.text + m.html + m.subject));
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'arc.html'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'arc-page.js'), 'utf8');
  assert.ok(!/—/.test(page), 'arc page has an em dash');
});

ok('the page offers exactly the platforms the server accepts', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'arc.html'), 'utf8');
  const opts = [...page.matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1]);
  assert.deepStrictEqual(opts, lib.ARC_PLATFORMS);
});

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
