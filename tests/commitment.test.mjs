// Course commitment (Parkinson's Law questionnaire + work reminders).
//
// Two halves, both pure:
//   - public/js/commitment-state.js: the pace math and validation behind
//     /commit.html, imported directly.
//   - commitmentLocalClock / commitmentDue / validateCommitmentInput /
//     courseReminderMessage: extracted from functions/index.js the same way
//     sms-gate.test.cjs does it (the repo has no Cloud Functions runner), plus
//     source checks that the tick, the callable and the rules are wired.
import fs from 'node:fs';
import assert from 'node:assert';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const client = await import('data:text/javascript,' + encodeURIComponent(read('public/js/commitment-state.js')));

const src = read('functions/index.js');
function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error('not found: ' + name);
  const bodyStart = src.indexOf(') {', i) + 2;
  let d = 0, started = false;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const linesSrc = src.slice(src.indexOf('const PARKINSON_LINES'), src.indexOf('];', src.indexOf('const PARKINSON_LINES')) + 2);
const server = new Function(
  [linesSrc, grab('commitmentLocalClock'), grab('commitmentDue'), grab('validateCommitmentInput'), grab('courseReminderMessage')].join('\n')
  + '\nreturn { commitmentLocalClock, commitmentDue, validateCommitmentInput, courseReminderMessage };'
)();

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

// Thursday 2026-09-24 23:30 UTC = 19:30 in New York (EDT, UTC-4).
const THU_1930_NY = new Date('2026-09-24T23:30:00Z');
const base = {
  active: true, goalDate: '2026-10-24', sessionMinutes: 30, days: [1, 3, 4],
  reminderTime: '19:00', timezone: 'America/New_York', channels: { email: true, inapp: true, push: false }
};

console.log('\nclient: commitment-state.js');

ok('addDays / daysBetween round-trip across a month boundary', () => {
  assert.equal(client.addDays('2026-09-24', 30), '2026-10-24');
  assert.equal(client.daysBetween('2026-09-24', '2026-10-24'), 30);
  assert.equal(client.daysBetween('2026-10-24', '2026-09-24'), -30);
});

ok('suggestDays spreads sessions across the week', () => {
  assert.deepEqual(client.suggestDays(180, 60), [1, 3, 5]);
  assert.deepEqual(client.suggestDays(420, 60), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(client.suggestDays(30, 60), [1]);
});

ok('paceSummary: a plan that covers the course fits', () => {
  const p = client.paceSummary({ today: '2026-09-24', goalDate: '2026-10-22', moduleCount: 8, sessionMinutes: 30, days: [1, 3, 5] });
  assert.equal(p.daysLeft, 28);
  assert.equal(p.modulesPerWeek, 2);
  assert.equal(p.plannedMinutes, 360);
  assert.equal(p.fits, true);
});

ok('paceSummary: too little time for the deadline does not fit', () => {
  const p = client.paceSummary({ today: '2026-09-24', goalDate: '2026-10-01', moduleCount: 12, sessionMinutes: 15, days: [1] });
  assert.equal(p.fits, false);
});

ok('commitmentError rejects past, today and >1 year deadlines', () => {
  const c = { goalDate: '2026-10-24', weeklyMinutes: 90, sessionMinutes: 30, days: [1], reminderTime: '19:00' };
  assert.equal(client.commitmentError(c, '2026-09-24'), '');
  assert.match(client.commitmentError({ ...c, goalDate: '2026-09-24' }, '2026-09-24'), /future/);
  assert.match(client.commitmentError({ ...c, goalDate: '2027-12-01' }, '2026-09-24'), /year/);
  assert.match(client.commitmentError({ ...c, days: [] }, '2026-09-24'), /day/);
});

ok('formatters', () => {
  assert.equal(client.fmtTime('19:00'), '7:00 PM');
  assert.equal(client.fmtTime('00:15'), '12:15 AM');
  assert.equal(client.fmtDays([1, 2, 3, 4, 5]), 'Weekdays');
  assert.equal(client.fmtDays([5, 1, 3]), 'Mon, Wed, Fri');
  assert.equal(client.fmtMinutes(90), '1.5 hrs');
  assert.equal(client.fmtDate('2026-11-30'), 'Nov 30, 2026');
});

console.log('\nserver: commitmentDue');

ok('local clock honors the member\'s timezone', () => {
  const ny = server.commitmentLocalClock(THU_1930_NY, 'America/New_York');
  assert.deepEqual(ny, { date: '2026-09-24', weekday: 4, minutes: 19 * 60 + 30 });
  const tokyo = server.commitmentLocalClock(THU_1930_NY, 'Asia/Tokyo');
  assert.equal(tokyo.date, '2026-09-25');
  assert.equal(server.commitmentLocalClock(THU_1930_NY, 'Not/AZone'), null);
});

ok('due on a chosen day after the reminder time', () => {
  assert.deepEqual(server.commitmentDue(base, THU_1930_NY), { kind: 'work', date: '2026-09-24' });
});

ok('not due before the reminder time', () => {
  assert.equal(server.commitmentDue({ ...base, reminderTime: '20:00' }, THU_1930_NY), null);
});

ok('not due more than six hours late (no 3 AM pings from a late tick)', () => {
  assert.equal(server.commitmentDue({ ...base, reminderTime: '13:00' }, THU_1930_NY), null);
  assert.ok(server.commitmentDue({ ...base, reminderTime: '13:31' }, THU_1930_NY));
});

ok('not due on a day the member didn\'t pick', () => {
  assert.equal(server.commitmentDue({ ...base, days: [1, 3] }, THU_1930_NY), null);
});

ok('once per day: lastRemindedDate blocks a second send', () => {
  assert.equal(server.commitmentDue({ ...base, lastRemindedDate: '2026-09-24' }, THU_1930_NY), null);
  assert.ok(server.commitmentDue({ ...base, lastRemindedDate: '2026-09-23' }, THU_1930_NY));
});

ok('the same instant is a different day in another timezone', () => {
  // 08:30 Friday in Tokyo; days include Friday there.
  const c = { ...base, timezone: 'Asia/Tokyo', reminderTime: '08:00', days: [5] };
  assert.deepEqual(server.commitmentDue(c, THU_1930_NY), { kind: 'work', date: '2026-09-25' });
});

ok('after the goal date: one deadline check-in, then silence', () => {
  const past = { ...base, goalDate: '2026-09-20' };
  assert.deepEqual(server.commitmentDue(past, THU_1930_NY), { kind: 'deadline', date: '2026-09-24' });
  assert.equal(server.commitmentDue({ ...past, deadlineNoticeSent: true }, THU_1930_NY), null);
  // The deadline check-in ignores the weekday list.
  assert.ok(server.commitmentDue({ ...past, days: [0] }, THU_1930_NY));
});

ok('the goal date itself is still a work day', () => {
  assert.equal(server.commitmentDue({ ...base, goalDate: '2026-09-24' }, THU_1930_NY).kind, 'work');
});

ok('inactive commitments never fire', () => {
  assert.equal(server.commitmentDue({ ...base, active: false }, THU_1930_NY), null);
});

console.log('\nserver: validateCommitmentInput');

const input = { goalDate: '2026-10-24', weeklyMinutes: 90, sessionMinutes: 30, days: [5, 1, 3], reminderTime: '19:00', channels: { push: true } };

ok('accepts a sane plan and normalizes it', () => {
  const r = server.validateCommitmentInput(input, '2026-09-24');
  assert.equal(r.error, undefined);
  assert.deepEqual(r.value.days, [1, 3, 5]);
  assert.deepEqual(r.value.channels, { email: true, inapp: true, push: true });
});

ok('rejects bad input', () => {
  const bad = (patch) => server.validateCommitmentInput({ ...input, ...patch }, '2026-09-24').error;
  assert.ok(bad({ goalDate: '2026-09-24' }));
  assert.ok(bad({ goalDate: '2027-09-26' }));
  assert.ok(bad({ goalDate: 'soon' }));
  assert.ok(bad({ weeklyMinutes: 5 }));
  assert.ok(bad({ sessionMinutes: 500 }));
  assert.ok(bad({ days: [] }));
  assert.ok(bad({ days: [1, 1] }));
  assert.ok(bad({ days: [7] }));
  assert.ok(bad({ reminderTime: '7pm' }));
  assert.ok(bad({ reminderTime: '24:00' }));
});

console.log('\nserver: courseReminderMessage');

ok('work reminder names the course, the session and days left', () => {
  const m = server.courseReminderMessage(base, 'icant', { kind: 'work', date: '2026-09-24' }, 'I Can\'t');
  assert.match(m.subject, /^Time to get to work: I Can't$/);
  assert.match(m.body, /30-minute I Can't session/);
  assert.match(m.body, /30 days to your deadline/);
  assert.equal(m.url, 'https://the1pnation.com/courses.html?course=icant');
  assert.match(m.editUrl, /commit\.html\?course=icant&edit=1$/);
});

ok('deadline check-in links to resetting the deadline', () => {
  const m = server.courseReminderMessage(base, 'icant', { kind: 'deadline', date: '2026-10-30' }, 'I Can\'t');
  assert.match(m.subject, /^Deadline check-in/);
  assert.equal(m.url, m.editUrl);
});

console.log('\nwiring');

ok('runTick runs the course reminders (skipped on dry run)', () => {
  assert.match(src, /step\('courseReminders', dryRun \? \{ skipped: 'dryRun' \} : sendCourseWorkReminders\(db\)\)/);
});

ok('saveCourseCommitment checks enrollment and validates server-side', () => {
  const body = src.slice(src.indexOf('exports.saveCourseCommitment'), src.indexOf('exports.enrollFree'));
  assert.match(body, /enrolledCourseSlugs/);
  assert.match(body, /validateCommitmentInput\(data, clock\.date\)/);
});

ok('the reminder sender claims the day in a transaction before sending', () => {
  const body = grab('sendCourseWorkReminders');
  assert.ok(body.indexOf('runTransaction') < body.indexOf('sendEmail('));
});

ok('commitments are server-written only', () => {
  const rules = read('firestore.rules');
  const i = rules.indexOf('match /courseCommitments/{slug}');
  assert.ok(i > 0);
  assert.match(rules.slice(i, i + 200), /allow write: if false;/);
});

ok('courses.html gates on the commitment before mounting a course', () => {
  const page = read('public/js/courses-page.js');
  assert.ok(page.indexOf('ensureCommitted(') > 0);
  assert.ok(page.indexOf('ensureCommitted(') < page.indexOf('mountFirestoreCourse(course'));
});

ok('the collection-group query has its index', () => {
  const idx = JSON.parse(read('firestore.indexes.json'));
  const o = (idx.fieldOverrides || []).find((f) => f.collectionGroup === 'courseCommitments' && f.fieldPath === 'active');
  assert.ok(o && o.indexes.some((x) => x.queryScope === 'COLLECTION_GROUP'));
});

console.log(`\n${passed} passed`);
