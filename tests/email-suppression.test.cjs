// Exercise email suppression against the real shipped code, extracted from
// functions/index.js, plus a source-level regression guard on the send paths.
//
// Why this file exists: the sequence email step used to gate on
// `contact.emailUnsubscribed` / `contact.unsubscribed`. Neither field is
// written anywhere in this codebase, so the guard never fired — a contact who
// clicked unsubscribe, opted out from their mail client, or hit "report spam"
// kept receiving every remaining step of every cadence they were enrolled in.
// The flags that are actually written are `emailOptOut` (by the unsubscribe
// endpoint and the SendGrid event webhook) and the `Unsubscribed` tag.
//
// The behavioural assertions pin what suppression means. The source assertions
// pin that each send path still consults it, because a one-line drift here is
// invisible at runtime and only shows up as a complaint.
//
// Run: node tests/email-suppression.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

const start = src.indexOf('function isEmailSuppressed');
assert.ok(start > 0, 'could not locate isEmailSuppressed in functions/index.js');
const end = src.indexOf('\n}', start) + 2;
const { isEmailSuppressed } = new Function('Array',
  src.slice(start, end) + '\nreturn { isEmailSuppressed };')(Array);

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

// ── What suppression actually means ─────────────────────────────────────────
console.log('isEmailSuppressed');

ok('suppresses a contact who clicked the unsubscribe link', () => {
  assert.strictEqual(isEmailSuppressed({ email: 'a@b.com', emailOptOut: true }), true);
});

ok('suppresses a contact carrying the Unsubscribed tag', () => {
  assert.strictEqual(isEmailSuppressed({ email: 'a@b.com', tags: ['Member', 'Unsubscribed'] }), true);
});

ok('allows an ordinary contact', () => {
  assert.strictEqual(isEmailSuppressed({ email: 'a@b.com', tags: ['Member'] }), false);
});

ok('allows a contact with no tags and no flags', () => {
  assert.strictEqual(isEmailSuppressed({ email: 'a@b.com' }), false);
});

ok('treats emailOptOut: false as not suppressed', () => {
  assert.strictEqual(isEmailSuppressed({ email: 'a@b.com', emailOptOut: false }), false);
});

ok('survives null and undefined rather than throwing', () => {
  assert.strictEqual(isEmailSuppressed(null), false);
  assert.strictEqual(isEmailSuppressed(undefined), false);
});

ok('is not fooled by the legacy phantom fields alone', () => {
  // These are the fields the old sequence guard read. Nothing writes them, so
  // a contact carrying one is NOT suppressed — which is exactly why gating on
  // them silently mailed everyone. If someone reintroduces them as the test
  // for suppression, this stays false and the guard below catches it.
  assert.strictEqual(isEmailSuppressed({ email: 'a@b.com', emailUnsubscribed: true }), false);
  assert.strictEqual(isEmailSuppressed({ email: 'a@b.com', unsubscribed: true }), false);
});

// ── Source-level regression guards ──────────────────────────────────────────
console.log('send paths');

ok('no send path gates on the phantom unsubscribe fields', () => {
  const offenders = src.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /contact\.(emailUnsubscribed|unsubscribed)\s*===/.test(line));
  assert.deepStrictEqual(offenders.map((o) => o.n), [],
    'a send path is gating on a field nothing writes: line ' + offenders.map((o) => o.n).join(', '));
});

function sliceOf(startNeedle, endNeedle) {
  const a = src.indexOf(startNeedle);
  assert.ok(a > 0, 'could not locate ' + startNeedle);
  const b = src.indexOf(endNeedle, a + startNeedle.length);
  assert.ok(b > a, 'could not locate the end of ' + startNeedle);
  return src.slice(a, b);
}

ok('the sequence email step consults isEmailSuppressed', () => {
  const block = sliceOf("if (step.channel === 'email') {", "if (step.channel === 'task') {");
  assert.ok(/isEmailSuppressed\(contact\)/.test(block),
    'the sequence email step no longer checks suppression');
});

ok('the 1:1 contact email consults isEmailSuppressed', () => {
  const block = sliceOf('exports.sendContactEmail', 'exports.');
  assert.ok(/isEmailSuppressed\(/.test(block),
    'sendContactEmail no longer checks suppression');
});

ok('cadence email carries a working opt-out', () => {
  const block = sliceOf("if (step.channel === 'email') {", "if (step.channel === 'task') {");
  assert.ok(/List-Unsubscribe/.test(block), 'no List-Unsubscribe header on sequence email');
  assert.ok(/List-Unsubscribe-Post/.test(block), 'no one-click opt-out header on sequence email');
  assert.ok(/unsubscribeUrl\(/.test(block), 'no unsubscribe link built for sequence email');
  assert.ok(/Unsubscribe from these emails/.test(block), 'no visible opt-out in the email body');
});

ok('cadence email is attributable in SendGrid events', () => {
  const block = sliceOf("if (step.channel === 'email') {", "if (step.channel === 'task') {");
  assert.ok(/customArgs/.test(block) && /'sequence'/.test(block),
    'sequence email sets no customArgs, so opens and bounces cannot be attributed');
});

console.log(`\n${passed} assertions passed.`);
