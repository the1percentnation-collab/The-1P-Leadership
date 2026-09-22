// "Your next step" ordering rules — the dashboard's one piece of real
// decision logic, so it gets real tests.
//
// public/js/hub-nextup.js is deliberately pure (no Firebase imports) exactly
// so it can be exercised here. It lives outside any package.json, so Node
// would treat the .js file as CommonJS and choke on `export`; importing the
// source through a data: URL sidesteps that without adding a package.json to
// public/ that only exists to please the test runner.
import fs from 'node:fs';
import assert from 'node:assert';

const src = fs.readFileSync(new URL('../public/js/hub-nextup.js', import.meta.url), 'utf8');
const { buildNextSteps, buildOnboardingFlow, profileCompleteness } =
  await import('data:text/javascript,' + encodeURIComponent(src));

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

const course = (slug, title) => ({ slug, title, subtitle: '' });
const completion = (done, total) => ({
  modules: Array.from({ length: total }, (_, i) => ({ id: i, title: `Module ${i}`, pillar: 'P', subtitle: '' })),
  completed: new Set(Array.from({ length: done }, (_, i) => i)),
  done,
  total,
  pct: total ? Math.round((done / total) * 100) : 0,
  isComplete: total > 0 && done === total
});

const keys = (steps) => steps.map((s) => s.key);

console.log('hub-nextup — next-step ordering');

ok('an unfinished course leads, and points at the first incomplete module', () => {
  const steps = buildNextSteps({
    enrolled: [{ course: course('a', 'Course A'), completion: completion(2, 7) }]
  });
  assert.strictEqual(steps[0].key, 'resume');
  assert.strictEqual(steps[0].title, 'Module 2');
  assert.strictEqual(steps[0].ctaLabel, 'Resume');
  assert.match(steps[0].href, /course=a&module=2$/);
});

ok('an untouched course says Start, not Resume', () => {
  const [step] = buildNextSteps({
    enrolled: [{ course: course('a', 'Course A'), completion: completion(0, 5) }]
  });
  assert.strictEqual(step.ctaLabel, 'Start');
  assert.match(step.href, /module=0$/);
});

ok('the course with the most progress wins when several are open', () => {
  const [step] = buildNextSteps({
    enrolled: [
      { course: course('a', 'Course A'), completion: completion(1, 10) },
      { course: course('b', 'Course B'), completion: completion(6, 10) }
    ]
  });
  assert.match(step.sub, /Course B/);
});

ok('a finished course does not produce a resume card', () => {
  const steps = buildNextSteps({
    enrolled: [{ course: course('a', 'Course A'), completion: completion(5, 5) }]
  });
  assert.ok(!keys(steps).includes('resume'));
});

ok('a registered call inside 48h is urgent and carries the join link', () => {
  const steps = buildNextSteps({
    events: [{ id: 'e1', title: 'Live call', startsAtMs: now + 3 * HOUR, registered: true, joinUrl: 'https://zoom.test/x' }]
  });
  const join = steps.find((s) => s.key === 'join-e1');
  assert.ok(join, 'expected a join card');
  assert.strictEqual(join.urgent, true);
  assert.strictEqual(join.href, 'https://zoom.test/x');
  assert.strictEqual(join.external, true);
});

ok('a call further out than 48h is not surfaced as a join card', () => {
  const steps = buildNextSteps({
    events: [{ id: 'e1', title: 'Live call', startsAtMs: now + 5 * DAY, registered: true, joinUrl: 'https://zoom.test/x' }]
  });
  assert.ok(!keys(steps).includes('join-e1'));
});

ok('an unregistered event inside a week prompts a registration', () => {
  const steps = buildNextSteps({
    events: [{ id: 'e2', title: 'Workshop', startsAtMs: now + 3 * DAY, registered: false }]
  });
  const reg = steps.find((s) => s.key === 'register-e2');
  assert.ok(reg);
  assert.strictEqual(reg.ctaLabel, 'Register');
});

ok('an event past its start by more than the grace window is dropped', () => {
  const steps = buildNextSteps({
    events: [{ id: 'e3', title: 'Old call', startsAtMs: now - 5 * HOUR, registered: true, joinUrl: 'https://zoom.test/x' }]
  });
  // The other cards this bare context produces are not the point; the point
  // is that a call five hours gone is neither joinable nor registerable.
  assert.ok(!keys(steps).some((k) => k.endsWith('e3')));
});

ok('certification gaps name the specific blocker', () => {
  const [step] = buildNextSteps({
    certification: {
      certified: false, hoursMet: false, requiredHours: 20, approvedHours: 12,
      capstoneSubmitted: false, capstoneApproved: false, examPassed: false, attemptsUsed: 0
    }
  });
  assert.strictEqual(step.key, 'certification');
  assert.strictEqual(step.title, 'Log 8 more coaching hours');
  assert.match(step.sub, /3 requirements left/);
});

ok('a certified member gets no certification card', () => {
  const steps = buildNextSteps({ certification: { certified: true } });
  assert.ok(!keys(steps).includes('certification'));
});

ok('a mention outranks a plain comment and deep-links like the bell does', () => {
  const [step] = buildNextSteps({
    notifications: [
      { type: 'comment', read: false, fromName: 'Bo', postId: 'p2', category: 'general' },
      { type: 'mention', read: false, fromName: 'Ada', postId: 'p1', category: 'wins' }
    ]
  });
  assert.strictEqual(step.key, 'reply');
  assert.match(step.title, /^Ada/);
  assert.strictEqual(step.href, '/community.html?channel=wins#post-p1');
});

ok('an already-read notification is not a next step', () => {
  const steps = buildNextSteps({
    notifications: [{ type: 'mention', read: true, fromName: 'Ada', postId: 'p1' }]
  });
  assert.ok(!keys(steps).includes('reply'));
});

ok('a complete profile produces no profile card', () => {
  const steps = buildNextSteps({
    enrolled: [{ course: course('a', 'A'), completion: completion(1, 3) }],
    profile: { displayName: 'A', avatarUrl: 'u', bio: 'b', profession: 'p', location: 'l' }
  });
  assert.ok(!keys(steps).includes('profile'));
});

ok('the profile card names fields in English, not storage keys', () => {
  const [step] = buildNextSteps({
    enrolled: [{ course: course('a', 'A'), completion: completion(3, 3) }],
    profile: { displayName: 'A', bio: 'b', profession: 'p', location: 'l' }
  });
  assert.strictEqual(step.key, 'profile');
  assert.match(step.sub, /your photo so/);
  assert.ok(!/avatarUrl/.test(step.sub));
});

ok('skipOnboarding leaves the getting-started cards to the flow', () => {
  const steps = buildNextSteps(
    { enrolled: [], profile: null, hasPosted: false },
    { skipOnboarding: true }
  );
  assert.deepStrictEqual(keys(steps), []);
});

ok('an empty profile scores zero and names what is missing', () => {
  assert.strictEqual(profileCompleteness(null).pct, 0);
  const partial = profileCompleteness({ displayName: 'A', avatarUrl: 'u' });
  assert.strictEqual(partial.pct, 40);
  assert.deepStrictEqual(partial.missing, ['bio', 'profession', 'location']);
});

ok('a member with no courses is pointed at the catalog', () => {
  const steps = buildNextSteps({ enrolled: [] });
  assert.ok(keys(steps).includes('browse'));
});

ok('a member who has never posted is nudged to introduce themselves', () => {
  const steps = buildNextSteps({ hasPosted: false });
  assert.ok(keys(steps).includes('introduce'));
});

ok('a member who has posted is not', () => {
  const steps = buildNextSteps({ hasPosted: true });
  assert.ok(!keys(steps).includes('introduce'));
});

ok('the list is capped so the section stays one glanceable row', () => {
  const steps = buildNextSteps({
    enrolled: [{ course: course('a', 'A'), completion: completion(1, 9) }],
    events: [
      { id: 'e1', title: 'Call', startsAtMs: now + HOUR, registered: true, joinUrl: 'https://z.test' },
      { id: 'e2', title: 'Workshop', startsAtMs: now + 2 * DAY, registered: false }
    ],
    notifications: [{ type: 'mention', read: false, fromName: 'Ada', postId: 'p1' }],
    profile: null,
    hasPosted: false
  });
  assert.strictEqual(steps.length, 4);
});

ok('a brand-new member still gets something to do', () => {
  const steps = buildNextSteps({ enrolled: [], profile: null, hasPosted: false });
  assert.ok(steps.length > 0);
  assert.deepStrictEqual(keys(steps), ['profile', 'browse', 'introduce']);
});

// ── Getting-started flow ──────────────────────────────────────────────────

ok('a brand-new member gets all three steps, profile first, none done', () => {
  const flow = buildOnboardingFlow({ enrolled: [], profile: null, hasPosted: false });
  assert.strictEqual(flow.active, true);
  assert.strictEqual(flow.done, 0);
  assert.strictEqual(flow.pct, 0);
  assert.strictEqual(flow.currentKey, 'profile');
  assert.deepStrictEqual(flow.steps.map((s) => s.key), ['profile', 'introduce', 'browse']);
  assert.deepStrictEqual(flow.steps.map((s) => s.step), [1, 2, 3]);
});

ok('finished steps stay in the flow, marked done, and progress advances', () => {
  const flow = buildOnboardingFlow({
    enrolled: [],
    profile: { displayName: 'A', avatarUrl: 'u', bio: 'b', profession: 'p', location: 'l' },
    hasPosted: true
  });
  assert.strictEqual(flow.steps.length, 3);
  assert.strictEqual(flow.done, 2);
  assert.strictEqual(flow.pct, 67);
  assert.strictEqual(flow.currentKey, 'browse');
  assert.deepStrictEqual(flow.steps.map((s) => s.done), [true, true, false]);
});

ok('a settled member has no flow at all', () => {
  const flow = buildOnboardingFlow({
    enrolled: [{ course: course('a', 'A'), completion: completion(1, 3) }],
    profile: { displayName: 'A', avatarUrl: 'u', bio: 'b', profession: 'p', location: 'l' },
    hasPosted: true
  });
  assert.strictEqual(flow.active, false);
  assert.strictEqual(flow.done, 3);
  assert.strictEqual(flow.currentKey, null);
});

ok('the profile step names the missing fields in English', () => {
  const [profileStep] = buildOnboardingFlow({ profile: { displayName: 'A' }, hasPosted: false }).steps;
  assert.match(profileStep.sub, /Add your photo and bio/);
  assert.strictEqual(profileStep.meta, '20% complete');
});

console.log(`\n${passed} checks passed.`);
