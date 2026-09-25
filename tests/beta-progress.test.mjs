// The Progress tab's judgement calls: where somebody is, and whether they are
// on track for the date they committed to. public/js/beta-progress.js is pure
// so these run without Firebase.
//
// Run: node tests/beta-progress.test.mjs
import assert from 'node:assert';
import { loadPure } from './_load-pure.mjs';

const P = await loadPure('beta-progress.js');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const DAY = 86400000;
// Noon local time, so isoDay() is stable whatever the machine's zone.
const at = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };
const mods = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, title: `Lesson ${i + 1}` }));
const now = at('2026-09-20');

console.log('beta progress — where each tester is and whether they are on track');

ok('nothing done reads as not started, pointing at lesson one', () => {
  const p = P.testerProgress({ modules: mods, now, startedAt: now - DAY });
  assert.strictEqual(p.paceState, 'not-started');
  assert.strictEqual(p.pct, 0);
  assert.deepStrictEqual(p.currentLesson, { number: 1, id: 1, title: 'Lesson 1' });
  assert.strictEqual(p.slowStart, false);
});

ok('not started three days after access is a slow start and sorts above working testers', () => {
  const p = P.testerProgress({ modules: mods, now, startedAt: now - 4 * DAY });
  assert.strictEqual(p.slowStart, true);
  assert.ok(P.attentionRank(p) < P.attentionRank({ paceState: 'on-pace' }));
});

ok('current lesson is the first one not done, even with gaps', () => {
  const p = P.testerProgress({ modules: mods, doneIds: [1, 2, 4], now, lastLessonAt: now });
  assert.strictEqual(p.done, 3);
  assert.strictEqual(p.pct, 30);
  assert.strictEqual(p.currentLesson.number, 3);
});

ok('ahead of the straight line to the goal is on pace', () => {
  const p = P.testerProgress({
    modules: mods, doneIds: [1, 2, 3, 4, 5, 6], now, lastLessonAt: now,
    commitment: { startDate: '2026-09-10', goalDate: '2026-09-30' }
  });
  assert.strictEqual(p.paceState, 'on-pace');
  assert.strictEqual(p.daysLeft, 10);
});

ok('well under the straight line is behind', () => {
  const p = P.testerProgress({
    modules: mods, doneIds: [1], now, lastLessonAt: now,
    commitment: { startDate: '2026-09-10', goalDate: '2026-09-30' }
  });
  assert.strictEqual(p.paceState, 'behind');
  assert.strictEqual(P.paceBucket(p), 'slipping');
});

ok('past the goal date and unfinished is overdue', () => {
  const p = P.testerProgress({
    modules: mods, doneIds: [1, 2], now, lastLessonAt: now,
    commitment: { startDate: '2026-09-01', goalDate: '2026-09-15' }
  });
  assert.strictEqual(p.paceState, 'overdue');
  assert.strictEqual(P.attentionRank(p), 0);
});

ok('a week without a lesson is stalled, whatever the goal says', () => {
  const p = P.testerProgress({
    modules: mods, doneIds: [1, 2, 3], now, lastLessonAt: now - 8 * DAY,
    commitment: { startDate: '2026-09-10', goalDate: '2026-12-30' }
  });
  assert.strictEqual(p.paceState, 'stalled');
  assert.strictEqual(p.idleDays, 8);
});

ok('working with no goal set is its own state, counted as working', () => {
  const p = P.testerProgress({ modules: mods, doneIds: [1], now, lastLessonAt: now });
  assert.strictEqual(p.paceState, 'no-plan');
  assert.strictEqual(P.paceBucket(p), 'working');
});

ok('every module done, or a recorded completion, is finished', () => {
  assert.strictEqual(P.testerProgress({ modules: mods, doneIds: mods.map((m) => m.id), now }).paceState, 'finished');
  assert.strictEqual(P.testerProgress({ modules: mods, doneIds: [1], completedAt: now, now }).paceState, 'finished');
  assert.strictEqual(P.testerProgress({ modules: mods, doneIds: mods.map((m) => m.id), now }).currentLesson, null);
});

ok('the projection extends the pace so far', () => {
  // 5 of 10 in 5 days is one a day, so 5 more days.
  const p = P.testerProgress({
    modules: mods, doneIds: [1, 2, 3, 4, 5], now, lastLessonAt: now,
    commitment: { startDate: '2026-09-15', goalDate: '2026-10-15' }
  });
  assert.strictEqual(p.projectedFinish, '2026-09-25');
});

ok('without module titles it still counts from the total', () => {
  const p = P.testerProgress({ doneIds: [0, 1, 2], total: 11, now, lastLessonAt: now });
  assert.strictEqual(p.total, 11);
  assert.strictEqual(p.pct, 27);
  assert.strictEqual(p.currentLesson, null);
});

ok('tile counts add up per tester-course, reviews counted separately', () => {
  const c = P.bucketCounts([
    { progress: { paceState: 'finished' }, review: { rating: 5 } },
    { progress: { paceState: 'on-pace' } },
    { progress: { paceState: 'stalled' } },
    { progress: { paceState: 'not-started' } }
  ]);
  assert.deepStrictEqual(c, { enrolled: 4, notStarted: 1, working: 1, slipping: 1, finished: 1, reviewed: 1 });
});

console.log(`\n${passed} checks passed.`);
