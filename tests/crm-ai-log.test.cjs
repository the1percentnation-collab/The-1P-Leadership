// Pin the pure helpers behind the AI activity log, extracted from the shipped
// public/js/crm.js.
//
// Two of these guard against a specific way this page could quietly mislead:
// a plan that was staged and never approved keeps status 'pending' forever
// (nothing sweeps expired plans), and the 7-day revert window is enforced
// server-side but must be reflected here or the page offers an Undo button
// that throws when pressed.
//
// Run: node tests/crm-ai-log.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'crm.js'), 'utf8');
const start = SRC.indexOf('export function aiPlanState');
const end = SRC.indexOf('// ════', SRC.indexOf('export function shadowedStageItems'));
assert.ok(start > 0 && end > start, 'could not locate the aiPlans helpers in crm.js');

const code = SRC.slice(start, end).replace(/^export /gm, '');
const { aiPlanState, aiPlanRevertable, shadowedStageItems } = new Function('Date', `
  function toDate(ts) {
    if (!ts) return null;
    if (ts instanceof Date) return ts;
    if (ts && typeof ts.toDate === 'function') return ts.toDate();
    return null;
  }
  ${code}
  return { aiPlanState, aiPlanRevertable, shadowedStageItems };
`)(Date);

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const at = (msFromNow) => ({ toDate: () => new Date(Date.now() + msFromNow) });
const DAY = 86400000;

console.log('plan state');
ok('a pending plan past its expiry reports expired, not pending', () => {
  // The whole point: nothing marks these expired server-side, so a week-old
  // dead proposal would otherwise render as still awaiting a decision.
  assert.strictEqual(aiPlanState({ status: 'pending', expiresAt: at(-60000) }), 'expired');
});
ok('a pending plan inside its window is still pending', () => {
  assert.strictEqual(aiPlanState({ status: 'pending', expiresAt: at(10 * 60000) }), 'pending');
});
ok('a pending plan with no expiry is left alone', () => {
  assert.strictEqual(aiPlanState({ status: 'pending' }), 'pending');
});
ok('expiry never overrides a terminal state', () => {
  // An applied plan gets expiresAt pushed out 90 days as a revert record;
  // an old one must not start reading as "expired unapproved".
  assert.strictEqual(aiPlanState({ status: 'applied', expiresAt: at(-DAY) }), 'applied');
  assert.strictEqual(aiPlanState({ status: 'reverted', expiresAt: at(-DAY) }), 'reverted');
});
ok('a missing plan does not throw', () => {
  assert.strictEqual(aiPlanState(null), 'unknown');
  assert.strictEqual(aiPlanState({}), 'unknown');
});

console.log('revertable');
const appliedPlan = (over = {}) => ({
  status: 'applied',
  appliedAt: at(-DAY),
  results: [{ status: 'applied', kind: 'task' }],
  ...over
});
ok('applied yesterday is revertable', () => {
  assert.strictEqual(aiPlanRevertable(appliedPlan()), true);
});
ok('partially applied is revertable too', () => {
  assert.strictEqual(aiPlanRevertable(appliedPlan({ status: 'partially_applied' })), true);
});
ok('six days is inside the window, eight days is outside', () => {
  assert.strictEqual(aiPlanRevertable(appliedPlan({ appliedAt: at(-6 * DAY) })), true);
  assert.strictEqual(aiPlanRevertable(appliedPlan({ appliedAt: at(-8 * DAY) })), false);
});
ok('a plan where nothing actually landed is not revertable', () => {
  // Every item shadowed or skipped means there is nothing to restore, and
  // offering Undo would be a button that does nothing.
  assert.strictEqual(aiPlanRevertable(appliedPlan({ results: [{ status: 'shadowed', kind: 'stage' }] })), false);
  assert.strictEqual(aiPlanRevertable(appliedPlan({ results: [] })), false);
});
ok('pending, expired and already-reverted plans are never revertable', () => {
  ['pending', 'expired', 'reverted', 'applying'].forEach((status) => {
    assert.strictEqual(aiPlanRevertable(appliedPlan({ status })), false, status);
  });
});
ok('applied with no appliedAt is not revertable', () => {
  assert.strictEqual(aiPlanRevertable(appliedPlan({ appliedAt: null })), false);
});
ok('a missing plan does not throw', () => {
  assert.strictEqual(aiPlanRevertable(null), false);
});

console.log('shadowed stage evidence');
const plans = [
  {
    planId: 'p1', userPrompt: 'clean up the cold ones', createdAt: at(-2 * DAY),
    automationWarnings: [{ sequenceName: 'Breakup', sendingSteps: 2 }],
    items: [
      { kind: 'stage', shadowed: true, contactId: 'c1', contactName: 'Jane', before: { stage: 'contacted' }, after: { stage: 'lost', reason: 'no reply in 60 days' } },
      { kind: 'task', contactId: 'c2', contactName: 'Bob', after: { title: 'Ring Bob' } },
      { kind: 'tags', contactId: 'c3', after: { addTags: ['nurture'] } }
    ]
  },
  {
    planId: 'p2', userPrompt: 'qualify the repliers', createdAt: at(-DAY), automationWarnings: [],
    items: [
      { kind: 'stage', shadowed: true, contactId: 'c4', contactName: 'Ada', before: { stage: 'new' }, after: { stage: 'qualified', reason: 'replied' } },
      // Not shadowed: once stage writes are enabled these are real changes and
      // belong in history, not in the evidence set.
      { kind: 'stage', shadowed: false, contactId: 'c5', contactName: 'Eve', before: { stage: 'new' }, after: { stage: 'contacted', reason: 'called' } }
    ]
  }
];

ok('collects shadowed stage items across every plan', () => {
  const rows = shadowedStageItems(plans);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map((r) => r.contactName), ['Jane', 'Ada']);
});
ok('ignores tasks, tags, and stage items that were actually applied', () => {
  const rows = shadowedStageItems(plans);
  assert.ok(!rows.some((r) => r.contactName === 'Eve'), 'an applied stage change leaked into the evidence set');
  assert.ok(rows.every((r) => r.from && r.to));
});
ok('carries the reason, the prompt and the automation warning', () => {
  const jane = shadowedStageItems(plans)[0];
  assert.strictEqual(jane.from, 'contacted');
  assert.strictEqual(jane.to, 'lost');
  assert.strictEqual(jane.reason, 'no reply in 60 days');
  assert.match(jane.userPrompt, /clean up the cold ones/);
  assert.strictEqual(jane.automationWarnings.length, 1);
});
ok('survives empty and malformed input', () => {
  assert.deepStrictEqual(shadowedStageItems([]), []);
  assert.deepStrictEqual(shadowedStageItems(null), []);
  assert.deepStrictEqual(shadowedStageItems([{ planId: 'x' }]), []);
  assert.strictEqual(shadowedStageItems([{ items: [{ kind: 'stage', shadowed: true, contactId: 'z' }] }]).length, 1);
});

console.log(`\n${passed} assertions passed.`);
