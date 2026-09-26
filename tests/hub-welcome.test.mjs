// First-login rules — who gets "Welcome" instead of "Welcome back", who gets
// the tour, and what the setup checklist counts.
//
// public/js/hub-welcome-state.js is deliberately pure (no Firebase, no DOM)
// exactly so it can be exercised here; hub-welcome.js keeps the impure half.
import fs from 'node:fs';
import assert from 'node:assert';

const src = fs.readFileSync(new URL('../public/js/hub-welcome-state.js', import.meta.url), 'utf8');
const { isNewMember, setupState, toMillis, clampStep, TOUR_STOPS, NEW_MEMBER_WINDOW } =
  await import('data:text/javascript,' + encodeURIComponent(src));

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

console.log('\nisNewMember');

ok('a member who just onboarded is new', () => {
  assert.equal(isNewMember({ onboardingAt: now - 60 * 1000 }, { now }), true);
});

ok('a member who has already seen the tour is not new', () => {
  assert.equal(isNewMember({ onboardingAt: now - 60 * 1000, welcomeTourAt: now - 30 * 1000 }, { now }), false);
});

ok('the localStorage mirror alone suppresses it', () => {
  assert.equal(isNewMember({ onboardingAt: now }, { now, seenLocally: true }), false);
});

ok('a long-standing member never gets the first-login treatment', () => {
  assert.equal(isNewMember({ onboardingAt: now - (NEW_MEMBER_WINDOW + DAY) }, { now }), false);
});

ok('createdAt stands in when onboardingAt is missing', () => {
  assert.equal(isNewMember({ createdAt: now - DAY }, { now }), true);
});

ok('an account with no join timestamp is treated as established', () => {
  assert.equal(isNewMember({ displayName: 'Test' }, { now }), false);
});

ok('a missing profile is never new', () => {
  assert.equal(isNewMember(null, { now }), false);
});

ok('a Firestore Timestamp is accepted, not just millis', () => {
  const ts = { toMillis: () => now - DAY };
  assert.equal(isNewMember({ onboardingAt: ts }, { now }), true);
});

console.log('\ntoMillis');

ok('ISO strings, millis, Timestamps and junk all resolve', () => {
  assert.equal(toMillis(1700000000000), 1700000000000);
  assert.equal(toMillis('2026-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(toMillis({ toMillis: () => 42 }), 42);
  assert.equal(toMillis({ seconds: 2 }), 2000);
  assert.equal(toMillis('not a date'), 0);
  assert.equal(toMillis(null), 0);
});

console.log('\nsetupState');

const full = {
  avatarUrl: 'https://example.com/a.jpg',
  bio: 'Builder.',
  company: 'One Percent',
  communityGoals: 'Grow the team.',
  location: 'Dallas, TX',
  website: 'https://example.com'
};

ok('an empty profile has nothing done', () => {
  const s = setupState({}, {});
  assert.equal(s.done, 0);
  assert.equal(s.pct, 0);
  assert.equal(s.steps.length, s.total);
});

ok('a finished profile plus an enrollment is 100%', () => {
  const s = setupState(full, { enrolled: true });
  assert.equal(s.done, s.total);
  assert.equal(s.pct, 100);
});

ok('the course step tracks enrollment, not the profile', () => {
  const withoutCourse = setupState(full, { enrolled: false });
  assert.equal(withoutCourse.done, withoutCourse.total - 1);
  assert.equal(withoutCourse.steps.find((s) => s.key === 'course').isDone, false);
});

ok('role OR company satisfies the work step', () => {
  assert.equal(setupState({ profession: 'Coach' }, {}).steps.find((s) => s.key === 'work').isDone, true);
  assert.equal(setupState({ company: 'Acme' }, {}).steps.find((s) => s.key === 'work').isDone, true);
});

ok('either link satisfies the links step', () => {
  assert.equal(setupState({ linkedinUrl: 'x' }, {}).steps.find((s) => s.key === 'links').isDone, true);
  assert.equal(setupState({ website: 'x' }, {}).steps.find((s) => s.key === 'links').isDone, true);
});

ok('every step carries a label, hint and destination', () => {
  for (const s of setupState({}, {}).steps) {
    assert.ok(s.label && s.hint && s.href.startsWith('/'), s.key);
  }
});

ok('a null profile degrades instead of throwing', () => {
  assert.equal(setupState(null, {}).done, 0);
});

console.log('\ntour');

ok('every stop has a destination and a reason to open it', () => {
  for (const s of TOUR_STOPS) {
    assert.ok(s.label && s.icon && s.href, s.key);
    assert.ok(s.blurb.length > 40, `${s.key} blurb is too thin`);
  }
});

ok('the tour covers the whole member rail', () => {
  const shell = fs.readFileSync(new URL('../public/js/academy-shell.js', import.meta.url), 'utf8');
  // MAIN_NAV runs until the next top-level declaration, whatever it is named,
  // so renaming the staff list below it cannot widen the slice.
  const start = shell.indexOf('const MAIN_NAV');
  assert.ok(start !== -1, 'MAIN_NAV not found');
  const end = shell.indexOf('\n];', start);
  const mainNav = shell.slice(start, end);
  const keys = [...mainNav.matchAll(/key: '([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 0, 'MAIN_NAV has no items');
  for (const key of keys) {
    assert.ok(TOUR_STOPS.some((s) => s.key === key), `tour is missing the ${key} tab`);
  }
  // Same order as the rail, so the tour walks down it rather than hopping.
  const tourOrder = TOUR_STOPS.map((s) => s.key).filter((k) => keys.includes(k));
  assert.deepEqual(tourOrder, keys, 'tour order does not match the rail');
});

ok('step indexes are clamped to a real stop', () => {
  assert.equal(clampStep(-5), 0);
  assert.equal(clampStep(999), TOUR_STOPS.length - 1);
  assert.equal(clampStep('3'), 3);
  assert.equal(clampStep(undefined), 0);
});

console.log(`\n${passed} passed`);
