// The assessment prompt: nobody is interrupted before they have engaged,
// nobody is asked twice, and buyer and checkout pages stay clean.
//
// Run: node tests/assessment-prompt.test.mjs
import assert from 'node:assert';
import { loadPure } from './_load-pure.mjs';

const { decide, showPill, promptUtm, isExcluded, isSuppressed, PROMPT } = await loadPure('assessment-prompt-core.js');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const NOW = Date.UTC(2026, 9, 21);
const DAY = 86400000;
const sig = (o) => Object.assign({
  path: '/', now: NOW, activeMs: 0, scrollPct: 0, pageViews: 1, exitIntent: false,
  consentPending: false, shownThisSession: false, pillClosed: false, store: {}
}, o);

console.log('assessment prompt — when to ask');

ok('waits out the first 30 seconds, however far they scroll', () => {
  assert.strictEqual(decide(sig({ activeMs: 29000, scrollPct: 100 })), null);
});

ok('fires once a visitor has stayed and read', () => {
  assert.strictEqual(decide(sig({ activeMs: PROMPT.minActiveMs, scrollPct: 40 })), 'engaged');
});

ok('a second page counts as intent without scrolling', () => {
  assert.strictEqual(decide(sig({ activeMs: 30000, pageViews: 2 })), 'engaged');
  assert.strictEqual(decide(sig({ activeMs: 30000, scrollPct: 10 })), null);
});

ok('desktop exit intent fires early, but not in the first 10 seconds', () => {
  assert.strictEqual(decide(sig({ activeMs: 5000, exitIntent: true })), null);
  assert.strictEqual(decide(sig({ activeMs: 10000, exitIntent: true })), 'exit');
});

ok('never stacks on the cookie banner or the open chat', () => {
  assert.strictEqual(decide(sig({ activeMs: 60000, scrollPct: 90, consentPending: true })), null);
});

ok('asks once a session', () => {
  assert.strictEqual(decide(sig({ activeMs: 60000, scrollPct: 90, shownThisSession: true })), null);
});

ok('stays quiet for 14 days after "Not right now", then asks again', () => {
  const engaged = { activeMs: 60000, scrollPct: 90 };
  assert.strictEqual(decide(sig({ ...engaged, store: { dismissedAt: NOW - 13 * DAY } })), null);
  assert.strictEqual(decide(sig({ ...engaged, store: { dismissedAt: NOW - 15 * DAY } })), 'engaged');
});

ok('never asks someone who clicked through or found the library alone', () => {
  assert.ok(isSuppressed({ convertedAt: NOW - 90 * DAY }, NOW));
  assert.ok(isSuppressed({ visited: NOW - 90 * DAY }, NOW));
});

ok('buyer, checkout and assessment pages are excluded', () => {
  for (const p of ['/assessments', '/assessments/alignment-scorecard', '/assessment.html', '/membership', '/corporate', '/book-a-call.html', '/speaking', '/login.html']) {
    assert.ok(isExcluded(p), p);
  }
  for (const p of ['/', '/about', '/start', '/books', '/books.html']) assert.ok(!isExcluded(p), p);
});

ok('the tab shows only inside the snooze window after a dismissal', () => {
  assert.strictEqual(showPill(sig({})), false);
  assert.strictEqual(showPill(sig({ store: { dismissedAt: NOW - DAY } })), true);
  assert.strictEqual(showPill(sig({ store: { dismissedAt: NOW - DAY }, pillClosed: true })), false);
  assert.strictEqual(showPill(sig({ store: { dismissedAt: NOW - DAY, convertedAt: NOW } })), false);
  assert.strictEqual(showPill(sig({ store: { dismissedAt: NOW - 20 * DAY } })), false);
});

ok('a real campaign keeps the credit; otherwise the prompt is tagged', () => {
  assert.strictEqual(promptUtm({ source: 'facebook', campaign: 'fall' }, 'me'), '');
  assert.strictEqual(promptUtm({}, 'team'), '?utm_source=site&utm_medium=popup&utm_campaign=assessment-prompt-team');
});

console.log(`\n${passed} passed`);
