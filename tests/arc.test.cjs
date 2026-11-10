// The advance reader sign-up (/arc): what config/arc means and what the
// sign-in and welcome emails say. Extracted from the shipped functions/index.js so the
// rules asserted here are the rules that run.
//
// Run: node tests/arc.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const start = src.indexOf('const ARC_PLATFORMS');
const end = src.indexOf('// requestArcLink —');
assert.ok(start > 0 && end > start, 'could not locate the ARC helpers in functions/index.js');

const textToHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// eslint-disable-next-line no-new-func
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const lib = new Function('APP_BASE_URL', 'textToHtml', 'escapeHtmlBasic', 'crypto', 'normalizeEmail', `${src.slice(start, end)}
  return { arcConfig, arcName, arcEmailContent, arcLinkEmailContent, arcRequestId, ARC_DISCLOSURE };`)(
  'https://the1pnation.com', textToHtml, textToHtml, require('crypto'), normalizeEmail);
const LINK = 'https://the-1p-leadership.firebaseapp.com/__/auth/action?mode=signIn&oobCode=abc&continueUrl=https%3A%2F%2Fthe1pnation.com%2Farc%3Fclaim%3D1';

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

ok('the sign-in email carries the one-tap link and the ARC terms', () => {
  const m = lib.arcLinkEmailContent({ firstName: 'Jo', bookTitle: 'I Can’t', link: LINK, reviewUrl: null, returning: false });
  assert.strictEqual(m.subject, 'Your advance copy of I Can’t is ready');
  assert.ok(m.text.startsWith('Hi Jo,'));
  assert.ok(m.text.includes(LINK));
  assert.ok(m.html.includes(`href="${LINK.replace(/&/g, '&amp;')}"`), 'the button does not carry the link');
  assert.ok(/No password needed/.test(m.text));
  assert.ok(/don’t forward this email or share the book/.test(m.text), 'no sharing ask');
  assert.ok(/review on Amazon\./.test(m.text));
  assert.ok(!/Goodreads/.test(m.text + m.html), 'Goodreads is not where reviews go right now');
  assert.ok(m.text.includes(lib.ARC_DISCLOSURE), 'no review disclosure line');
  assert.ok(m.text.includes('https://the1pnation.com/arc'), 'no way to get a fresh link');
});

ok('a returning reader gets a fresh-link email, not a welcome', () => {
  const m = lib.arcLinkEmailContent({ firstName: '', bookTitle: 'I Can’t', link: LINK, reviewUrl: null, returning: true });
  assert.strictEqual(m.subject, 'Your reading link for I Can’t');
  assert.ok(m.text.startsWith('Hi,'));
  assert.ok(/fresh link/.test(m.text));
});

ok('the welcome email links straight into the reader', () => {
  const m = lib.arcEmailContent({ firstName: 'Jo', bookTitle: 'I Can’t', bookId: 'i-cant', reviewUrl: null });
  assert.strictEqual(m.readUrl, 'https://the1pnation.com/read?book=i-cant');
  assert.ok(m.text.includes(m.readUrl));
  assert.ok(m.html.includes(`href="${m.readUrl}"`));
  assert.ok(m.text.includes(lib.ARC_DISCLOSURE));
});

ok('a configured review link is the one in both emails', () => {
  const a = lib.arcEmailContent({ firstName: '', bookTitle: 'I Can’t', bookId: 'i-cant', reviewUrl: 'https://amazon.com/review' });
  const b = lib.arcLinkEmailContent({ firstName: '', bookTitle: 'I Can’t', link: LINK, reviewUrl: 'https://amazon.com/review' });
  for (const m of [a, b]) {
    assert.ok(m.text.includes('https://amazon.com/review'));
    assert.ok(m.html.includes('href="https://amazon.com/review"'));
  }
});

ok('names are tidied and capped; the request id ignores case and spaces', () => {
  assert.strictEqual(lib.arcName('  Mary   Ann  '), 'Mary Ann');
  assert.strictEqual(lib.arcName(null), '');
  assert.strictEqual(lib.arcName('x'.repeat(200)).length, 60);
  assert.strictEqual(lib.arcRequestId(' Jo@Example.com '), lib.arcRequestId('jo@example.com'));
  assert.notStrictEqual(lib.arcRequestId('a@x.com'), lib.arcRequestId('b@x.com'));
});

ok('a name cannot inject markup into the email', () => {
  const m = lib.arcLinkEmailContent({ firstName: '<b>Jo</b>', bookTitle: 'I Can’t', link: LINK, reviewUrl: null });
  assert.ok(!m.html.includes('<b>Jo</b>'));
});

ok('the copy carries no em dashes (brand voice)', () => {
  const a = lib.arcEmailContent({ firstName: 'Jo', bookTitle: 'I Can’t', bookId: 'i-cant', reviewUrl: null });
  const b = lib.arcLinkEmailContent({ firstName: 'Jo', bookTitle: 'I Can’t', link: LINK, reviewUrl: null, returning: false });
  const c = lib.arcLinkEmailContent({ firstName: 'Jo', bookTitle: 'I Can’t', link: LINK, reviewUrl: null, returning: true });
  for (const m of [a, b, c]) assert.ok(!/—/.test(m.text + m.html + m.subject));
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'arc.html'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'arc-page.js'), 'utf8');
  assert.ok(!/—/.test(page), 'arc page has an em dash');
});

ok('the form asks only for a name, an email and the review promise', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'arc.html'), 'utf8');
  const form = page.slice(page.indexOf('<form id="arc-form"'), page.indexOf('</form>', page.indexOf('<form id="arc-form"')));
  const ids = [...form.matchAll(/<(?:input|select|textarea)[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids, ['first', 'last', 'email', 'agree', 'updates']);
  assert.ok(!/type="password"/.test(page), 'the page still asks for a password');
});

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
