// Per-day points history — the series behind the dashboard chart.
//
// public/js/points-history.js is free of Firebase imports so it can be
// exercised here. Same data: URL trick as the other two suites — the file
// sits outside any package.json, so Node would read its `export` as CommonJS.
//
// These exist because of the bug they replace: the chart used to plot one bar
// per member who had scored that week, so a quiet week produced a single bar
// at full height and full width — a solid rectangle. The fix is a fixed
// seven-day window, and what these tests really pin is that the window is
// always seven entries whatever the data does.
import fs from 'node:fs';
import assert from 'node:assert';

const src = fs.readFileSync(new URL('../public/js/points-history.js', import.meta.url), 'utf8');
const { utcDayKey, lastNDayKeys, dailySeries, seriesTotal } =
  await import('data:text/javascript,' + encodeURIComponent(src));

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const DAY = 24 * 60 * 60 * 1000;
// Fixed "now" so nothing drifts with the wall clock: Fri 2027-03-05, 14:00 UTC.
const NOW = Date.UTC(2027, 2, 5, 14, 0);

console.log('points-history — the seven-day series');

// ── Day keys ──────────────────────────────────────────────────────────────

ok('a day key is YYYY-MM-DD in UTC', () => {
  assert.strictEqual(utcDayKey(new Date(NOW)), '2027-03-05');
  assert.strictEqual(utcDayKey(new Date(Date.UTC(2027, 0, 9, 23, 59))), '2027-01-09');
});

ok('day keys sort lexicographically, which is what the server prune relies on', () => {
  const keys = ['2027-03-05', '2027-02-28', '2026-12-31', '2027-03-10'];
  assert.deepStrictEqual(keys.slice().sort(), ['2026-12-31', '2027-02-28', '2027-03-05', '2027-03-10']);
});

ok('the last N keys are oldest first and end with today', () => {
  const keys = lastNDayKeys(7, NOW);
  assert.strictEqual(keys.length, 7);
  assert.strictEqual(keys[6], '2027-03-05');
  assert.strictEqual(keys[0], '2027-02-27');
  assert.deepStrictEqual(keys.slice().sort(), keys, 'keys should already be ascending');
});

ok('the window crosses a month boundary cleanly', () => {
  const keys = lastNDayKeys(4, Date.UTC(2027, 2, 2, 9, 0));
  assert.deepStrictEqual(keys, ['2027-02-27', '2027-02-28', '2027-03-01', '2027-03-02']);
});

ok('a leap day is a real day in the window', () => {
  const keys = lastNDayKeys(3, Date.UTC(2028, 2, 1, 9, 0));
  assert.deepStrictEqual(keys, ['2028-02-28', '2028-02-29', '2028-03-01']);
});

// ── The series ────────────────────────────────────────────────────────────

ok('the series is always seven entries, even with one day of data', () => {
  // This is the exact case that rendered as a solid rectangle.
  const s = dailySeries({ '2027-03-05': 10 }, { now: NOW });
  assert.strictEqual(s.length, 7);
  assert.strictEqual(seriesTotal(s), 10);
  assert.deepStrictEqual(s.map((d) => d.value), [0, 0, 0, 0, 0, 0, 10]);
});

ok('the series is seven entries with no data at all', () => {
  const s = dailySeries({}, { now: NOW });
  assert.strictEqual(s.length, 7);
  assert.strictEqual(seriesTotal(s), 0);
});

ok('a missing, null or non-object map is handled, not thrown on', () => {
  [undefined, null, 'nope', 42].forEach((bad) => {
    const s = dailySeries(bad, { now: NOW });
    assert.strictEqual(s.length, 7);
    assert.strictEqual(seriesTotal(s), 0);
  });
});

ok('days with no entry are zero, not gaps', () => {
  const s = dailySeries({ '2027-03-01': 5, '2027-03-05': 3 }, { now: NOW });
  assert.strictEqual(s.length, 7);
  assert.ok(s.every((d) => typeof d.value === 'number'));
  assert.deepStrictEqual(s.map((d) => d.value), [0, 0, 5, 0, 0, 0, 3]);
});

ok('exactly one entry is flagged as today, and it is the last one', () => {
  const s = dailySeries({ '2027-03-05': 10 }, { now: NOW });
  assert.strictEqual(s.filter((d) => d.isToday).length, 1);
  assert.strictEqual(s[6].isToday, true);
  assert.strictEqual(s[6].key, '2027-03-05');
});

ok('entries outside the window are ignored rather than counted', () => {
  const s = dailySeries({ '2027-01-01': 999, '2027-03-05': 4 }, { now: NOW });
  assert.strictEqual(seriesTotal(s), 4);
});

ok('a negative or unreadable value floors at zero', () => {
  const s = dailySeries({ '2027-03-05': -5, '2027-03-04': 'x', '2027-03-03': null }, { now: NOW });
  assert.strictEqual(seriesTotal(s), 0);
  assert.ok(s.every((d) => d.value >= 0));
});

ok('weekday labels line up with their keys, read in UTC', () => {
  // 2027-03-05 is a Friday; the window runs Saturday through Friday.
  const s = dailySeries({}, { now: NOW });
  assert.deepStrictEqual(s.map((d) => d.label), ['S', 'S', 'M', 'T', 'W', 'T', 'F']);
});

ok('a custom window length is honoured', () => {
  assert.strictEqual(dailySeries({}, { days: 14, now: NOW }).length, 14);
  assert.strictEqual(dailySeries({}, { days: 1, now: NOW }).length, 1);
});

ok('the series holds up across a month boundary', () => {
  const now = Date.UTC(2027, 3, 2, 8, 0); // 2 Apr
  const s = dailySeries({ '2027-03-31': 6, '2027-04-02': 2 }, { now });
  assert.strictEqual(s.length, 7);
  assert.strictEqual(seriesTotal(s), 8);
  assert.strictEqual(s[6].key, '2027-04-02');
  assert.strictEqual(s[6].isToday, true);
});

ok('seriesTotal survives an empty or missing series', () => {
  assert.strictEqual(seriesTotal([]), 0);
  assert.strictEqual(seriesTotal(null), 0);
});

console.log(`\n${passed} checks passed.`);
