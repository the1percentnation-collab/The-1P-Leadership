// Course launch dates — parsing, formatting, countdown and "what opens next".
//
// public/js/launch-date.js is deliberately free of Firebase imports so it can
// be exercised here. Same data: URL trick as hub-nextup.test.mjs — the file
// sits outside any package.json, so Node would otherwise read its `export`
// as CommonJS and fail.
//
// The timezone cases are the point of this file. A date typed as "2027-03-03"
// must never render as March 2, which is exactly what `new Date(str)` does
// anywhere west of Greenwich.
import fs from 'node:fs';
import assert from 'node:assert';

const src = fs.readFileSync(new URL('../public/js/launch-date.js', import.meta.url), 'utf8');
const {
  launchDateMs, toDateInput, fromDateInput,
  fmtLaunchDate, launchCountdown, hasLaunched, nextLaunch
} = await import('data:text/javascript,' + encodeURIComponent(src));

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const DAY = 24 * 60 * 60 * 1000;
// A fixed "now" so the countdown cases do not drift with the wall clock.
const NOW = new Date(2027, 2, 1, 9, 30).getTime(); // 1 Mar 2027, 09:30 local
const at = (y, m, d) => new Date(y, m - 1, d).getTime();

console.log('launch-date — parsing, formatting and next-launch');

// ── Parsing ───────────────────────────────────────────────────────────────

ok('a date-only string parses as LOCAL midnight, not UTC', () => {
  const ms = launchDateMs({ launchDate: '2027-03-03' });
  const d = new Date(ms);
  // The bug this guards: UTC parsing makes these read 2 / 2027 west of GMT.
  assert.strictEqual(d.getDate(), 3);
  assert.strictEqual(d.getMonth(), 2);
  assert.strictEqual(d.getFullYear(), 2027);
  assert.strictEqual(d.getHours(), 0);
});

ok('a Firestore Timestamp is read through toMillis', () => {
  const ms = at(2027, 3, 3);
  assert.strictEqual(launchDateMs({ launchDate: { toMillis: () => ms } }), ms);
});

ok('a Timestamp exposing only toDate still works', () => {
  const ms = at(2027, 3, 3);
  assert.strictEqual(launchDateMs({ launchDate: { toDate: () => new Date(ms) } }), ms);
});

ok('a Date and a raw epoch both pass through', () => {
  const ms = at(2027, 3, 3);
  assert.strictEqual(launchDateMs({ launchDate: new Date(ms) }), ms);
  assert.strictEqual(launchDateMs({ launchDate: ms }), ms);
});

ok('absent, empty and unreadable values are null, never NaN', () => {
  assert.strictEqual(launchDateMs(null), null);
  assert.strictEqual(launchDateMs({}), null);
  assert.strictEqual(launchDateMs({ launchDate: null }), null);
  assert.strictEqual(launchDateMs({ launchDate: '' }), null);
  assert.strictEqual(launchDateMs({ launchDate: 'not a date' }), null);
  assert.strictEqual(launchDateMs({ launchDate: new Date('nope') }), null);
});

// ── Round trip through the input element ──────────────────────────────────

ok('the input value round-trips without sliding a day', () => {
  const original = '2027-03-03';
  const date = fromDateInput(original);
  assert.strictEqual(date.getDate(), 3);
  assert.strictEqual(toDateInput(date.getTime()), original);
});

ok('a partial or junk input value is rejected rather than guessed at', () => {
  assert.strictEqual(fromDateInput(''), null);
  assert.strictEqual(fromDateInput('2027-03'), null);
  assert.strictEqual(fromDateInput('03/03/2027'), null);
  assert.strictEqual(toDateInput(null), '');
});

// ── Formatting ────────────────────────────────────────────────────────────

ok('the long form names the month and year', () => {
  assert.strictEqual(fmtLaunchDate(at(2027, 3, 3)), 'March 3, 2027');
});

ok('the short form drops the year within the current year', () => {
  assert.strictEqual(fmtLaunchDate(at(2027, 3, 3), { short: true, now: NOW }), 'Mar 3');
});

ok('the short form keeps the year when the launch is in another year', () => {
  assert.strictEqual(fmtLaunchDate(at(2028, 1, 9), { short: true, now: NOW }), 'Jan 9, 2028');
});

ok('formatting a missing date yields an empty string, not "Invalid Date"', () => {
  assert.strictEqual(fmtLaunchDate(null), '');
  assert.strictEqual(fmtLaunchDate(NaN), '');
});

// ── Countdown ─────────────────────────────────────────────────────────────

ok('a launch later today reads "today", not "in 0 days"', () => {
  // 23:00 the same calendar day, from a 09:30 "now".
  assert.strictEqual(launchCountdown(new Date(2027, 2, 1, 23, 0).getTime(), { now: NOW }), 'today');
});

ok('the next calendar day reads "tomorrow" even a few hours out', () => {
  assert.strictEqual(launchCountdown(new Date(2027, 2, 2, 1, 0).getTime(), { now: NOW }), 'tomorrow');
});

ok('days, weeks and months each get their own scale', () => {
  assert.strictEqual(launchCountdown(at(2027, 3, 8), { now: NOW }), 'in 7 days');
  assert.strictEqual(launchCountdown(at(2027, 3, 22), { now: NOW }), 'in 3 weeks');
  assert.strictEqual(launchCountdown(at(2027, 6, 1), { now: NOW }), 'in 3 months');
});

ok('a past launch goes quiet instead of counting upward', () => {
  assert.strictEqual(launchCountdown(at(2027, 2, 20), { now: NOW }), '');
  assert.strictEqual(hasLaunched(at(2027, 2, 20), { now: NOW }), true);
  assert.strictEqual(hasLaunched(at(2027, 3, 8), { now: NOW }), false);
});

ok('a launch earlier today has NOT passed — the banner runs all day', () => {
  // 08:00, an hour before "now". A launch is a day, not a moment.
  assert.strictEqual(hasLaunched(new Date(2027, 2, 1, 8, 0).getTime(), { now: NOW }), false);
});

// ── Which course the banner announces ─────────────────────────────────────

const course = (slug, extra = {}) => ({
  slug, title: slug, status: 'coming-soon', showOnSite: true, ...extra
});

ok('the soonest future launch wins', () => {
  const next = nextLaunch([
    course('later', { launchDate: at(2027, 6, 1) }),
    course('sooner', { launchDate: at(2027, 3, 15) })
  ], { now: NOW });
  assert.strictEqual(next.course.slug, 'sooner');
  assert.strictEqual(next.ms, at(2027, 3, 15));
});

ok('a course with no date cannot be the next launch', () => {
  assert.strictEqual(nextLaunch([course('undated')], { now: NOW }), null);
});

ok('a past date is skipped in favour of a future one', () => {
  const next = nextLaunch([
    course('gone', { launchDate: at(2027, 1, 5) }),
    course('upcoming', { launchDate: at(2027, 4, 2) })
  ], { now: NOW });
  assert.strictEqual(next.course.slug, 'upcoming');
});

ok('every date in the past means no banner at all', () => {
  assert.strictEqual(nextLaunch([course('gone', { launchDate: at(2027, 1, 5) })], { now: NOW }), null);
});

ok('a live course is not announced as upcoming, whatever date it carries', () => {
  const live = course('open', { status: 'live', launchDate: at(2027, 4, 2) });
  assert.strictEqual(nextLaunch([live], { now: NOW }), null);
});

ok('an inactive course never reaches the banner', () => {
  const hidden = course('hidden', { status: 'inactive', launchDate: at(2027, 4, 2) });
  assert.strictEqual(nextLaunch([hidden], { now: NOW }), null);
});

ok('"On main site" off keeps a course out of the banner', () => {
  const off = course('offsite', { showOnSite: false, launchDate: at(2027, 4, 2) });
  assert.strictEqual(nextLaunch([off], { now: NOW }), null);
});

ok('a bundle-only course is not announced — its bundle is', () => {
  const inner = course('inner', { sellable: false, launchDate: at(2027, 4, 2) });
  assert.strictEqual(nextLaunch([inner], { now: NOW }), null);
});

ok('showOnSite absent counts as on, matching the default-true opt-out', () => {
  const c = { slug: 'x', title: 'X', status: 'coming-soon', launchDate: at(2027, 4, 2) };
  assert.strictEqual(nextLaunch([c], { now: NOW }).course.slug, 'x');
});

ok('an empty or missing catalog is handled, not thrown on', () => {
  assert.strictEqual(nextLaunch([], { now: NOW }), null);
  assert.strictEqual(nextLaunch(null, { now: NOW }), null);
  assert.strictEqual(nextLaunch([null, undefined], { now: NOW }), null);
});

console.log(`\n${passed} checks passed.`);
