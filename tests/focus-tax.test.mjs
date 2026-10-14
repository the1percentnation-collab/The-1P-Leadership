// The Focus Tax calculator: the math, its server copy, and the emailed report.
//
// The figures are the ones cited in How to Work Less and Gain More, so these
// pin them line by line: a change to a number here is a change to what the
// page tells people the book says. The server recomputes the report from the
// visitor's inputs, so the browser module and functions/focus-tax.js must
// agree exactly.
//
// Run: node tests/focus-tax.test.mjs
import fs from 'node:fs';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { loadPure } from './_load-pure.mjs';

const core = await loadPure('focus-tax-core.js');
const server = createRequire(import.meta.url)('../functions/focus-tax.js');
const { computeFocusTax, normalizeFocusTaxInput, FOCUS_TAX_DEFAULTS, FOCUS_TAX_SOURCES: S } = core;

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const line = (r, key) => r.lines.find((l) => l.key === key).hours;

console.log('focus tax — the book\'s figures');

ok('each line uses the book figure when nothing is capped', () => {
  const r = computeFocusTax({ hoursPerWeek: 45, interruptionsPerDay: 5, switchesPerDay: 2, meetingHoursPerWeek: 8, planning: 'sometimes' });
  near(line(r, 'interruptions'), 5 * 23 / 60 * 5, 'interruptions: 23 min each, five days (Phase One)');
  near(line(r, 'switching'), 2 * 20 / 60 * 5, 'switching: 20 min each (Phase Twelve)');
  near(line(r, 'meetings'), 8 * 0.37, 'meetings: 37% unnecessary (Phase Thirteen)');
  near(line(r, 'drift'), 2.5, 'drift: half of the 5 hours when planning is occasional (Phase Ten)');
  near(r.weeklyHours, r.lines.reduce((a, l) => a + l.hours, 0), 'total is the sum of the lines');
});

ok('the citations match the book', () => {
  assert.strictEqual(S.refocusMinutes, 23);
  assert.strictEqual(S.switchMinutes, 20);
  assert.strictEqual(S.meetingWasteShare, 0.37);
  assert.strictEqual(S.driftHours.never, 5);
});

ok('money: hourly value is income over fifty working weeks', () => {
  const r = computeFocusTax({ income: 100000, hoursPerWeek: 40 });
  near(r.hourly, 100000 / (40 * 50), 'hourly');
  near(r.yearlyCost, r.weeklyHours * r.hourly * 50, 'yearly');
});

ok('team mode multiplies by headcount at the average salary', () => {
  const base = { hoursPerWeek: 45, interruptionsPerDay: 6, switchesPerDay: 3, meetingHoursPerWeek: 10, planning: 'never' };
  const one = computeFocusTax({ ...base, mode: 'solo', income: 80000 });
  const team = computeFocusTax({ ...base, mode: 'team', teamSize: 25, avgSalary: 80000 });
  assert.strictEqual(team.people, 25);
  near(team.weeklyHours, one.weeklyHours, 'hours are per person');
  near(team.yearlyCost, one.yearlyCost * 25, 'cost covers the team');
});

console.log('\nfocus tax — guard rails');

ok('refocus plus switching never exceeds 40% of a workday', () => {
  const r = computeFocusTax({ hoursPerWeek: 40, interruptionsPerDay: 30, switchesPerDay: 20, meetingHoursPerWeek: 0, planning: 'weekly' });
  assert.ok(line(r, 'interruptions') + line(r, 'switching') <= 40 * 0.4 + 1e-9);
});

ok('the whole tax never exceeds half the week', () => {
  const r = computeFocusTax({ hoursPerWeek: 20, interruptionsPerDay: 30, switchesPerDay: 20, meetingHoursPerWeek: 40, planning: 'never' });
  assert.ok(r.weeklyHours <= 10 + 1e-9, String(r.weeklyHours));
  assert.ok(r.pctOfWeek <= 0.5 + 1e-9);
});

ok('inputs are clamped, and junk falls back to the defaults', () => {
  const n = normalizeFocusTaxInput({ income: '$250,000', hoursPerWeek: 500, interruptionsPerDay: -4, teamSize: 'many', planning: 'daily', mode: 'everyone' });
  assert.strictEqual(n.income, 250000, 'formatted money parses');
  assert.strictEqual(n.hoursPerWeek, 80);
  assert.strictEqual(n.interruptionsPerDay, 0);
  assert.strictEqual(n.teamSize, FOCUS_TAX_DEFAULTS.teamSize);
  assert.strictEqual(n.planning, FOCUS_TAX_DEFAULTS.planning);
  assert.strictEqual(n.mode, 'solo');
  assert.deepStrictEqual(normalizeFocusTaxInput(null), normalizeFocusTaxInput({}));
  const r = computeFocusTax('nonsense');
  assert.ok(Number.isFinite(r.yearlyCost) && r.yearlyCost > 0);
});

ok('the system never "reclaims" a negative amount, and gives nothing when already there', () => {
  const there = computeFocusTax({ interruptionsPerDay: 1, switchesPerDay: 1, meetingHoursPerWeek: 0, planning: 'weekly' });
  near(there.reclaimedHours, 1 - 0.25, 'only the planning drift is left to reclaim');
  const zero = computeFocusTax({ interruptionsPerDay: 0, switchesPerDay: 0, meetingHoursPerWeek: 0, planning: 'weekly' });
  assert.ok(zero.reclaimedHours >= 0);
  const heavy = computeFocusTax({ interruptionsPerDay: 12, switchesPerDay: 8, meetingHoursPerWeek: 20, planning: 'never' });
  assert.ok(heavy.reclaimedHours > 0 && heavy.reclaimedHours < heavy.weeklyHours);
});

ok('the biggest tax is the largest line, with a fix and a chapter', () => {
  const r = computeFocusTax({ interruptionsPerDay: 1, switchesPerDay: 0, meetingHoursPerWeek: 30, planning: 'weekly' });
  assert.strictEqual(r.biggest.key, 'meetings');
  assert.ok(r.biggest.fix && /Phase Thirteen/.test(r.biggest.chapter));
});

ok('no em dashes in anything the page or email shows', () => {
  for (const l of core.FOCUS_TAX_LINES) for (const v of [l.label, l.chapter, l.read, l.fix]) assert.ok(!v.includes('—'), v);
});

console.log('\nfocus tax — server copy');

ok('functions/focus-tax.js is the generated copy of the browser module', () => {
  const fixtures = [
    {},
    { mode: 'team', teamSize: 40, avgSalary: 95000, hoursPerWeek: 50, interruptionsPerDay: 9, switchesPerDay: 6, meetingHoursPerWeek: 15, planning: 'never' },
    { income: '45000', hoursPerWeek: '38', interruptionsPerDay: '2', switchesPerDay: '1', meetingHoursPerWeek: '2', planning: 'weekly' },
    { hoursPerWeek: 20, interruptionsPerDay: 30, switchesPerDay: 20, meetingHoursPerWeek: 40, planning: 'never' }
  ];
  for (const f of fixtures) {
    const a = computeFocusTax(f);
    const b = server.computeFocusTax(f);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)), JSON.stringify(f));
  }
  const src = fs.readFileSync(new URL('../public/js/focus-tax-core.js', import.meta.url), 'utf8');
  const gen = fs.readFileSync(new URL('../functions/focus-tax.js', import.meta.url), 'utf8');
  assert.ok(gen.includes(src.replace(/^export /gm, '')), 'regenerate with: node scripts/build-focus-tax-server.cjs');
});

console.log('\nfocus tax — lead form and report email');

const index = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');

ok('the lead form is registered and team requests join the corporate pipeline', () => {
  assert.match(index, /'focus-tax':\s*\{\s*source:\s*'Focus Tax Calculator'/);
  assert.match(index, /formType === 'focus-tax' && fields\.mode === 'team'\) tags\.push\('Corporate'/);
});

const start = index.indexOf('function focusTaxReportEmail(');
const end = index.indexOf('\n}\n', start) + 2;
// eslint-disable-next-line no-new-func
const focusTaxReportEmail = new Function('computeFocusTax', 'FOCUS_TAX_WEEKS', `
  const APP_BASE_URL = 'https://the1pnation.com';
  function textToHtml(t) { return String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br/>'); }
  ${index.slice(start, end)}
  return focusTaxReportEmail;`)(server.computeFocusTax, server.WORK_WEEKS);

ok('the solo report carries the number, the fix, the plan, the audit and the book', () => {
  const r = server.computeFocusTax({ income: 120000, interruptionsPerDay: 8 });
  const m = focusTaxReportEmail({ firstName: 'Jordan', result: r });
  const yearly = '$' + Math.round(r.yearlyCost).toLocaleString('en-US');
  assert.ok(m.subject.includes(yearly), m.subject);
  assert.ok(m.text.startsWith('Hi Jordan,'));
  assert.ok(m.text.includes(r.biggest.fix));
  assert.ok(m.text.includes('fifteen-minute weekly plan') && m.text.includes('weekly audit'));
  assert.ok(m.html.includes('https://the1pnation.com/#shop'));
  assert.ok(!m.text.includes('Alignment Audit'), 'the audit offer is for teams');
  assert.ok(!m.text.includes('—') && !m.html.includes('—'), 'no em dashes');
});

ok('the team report offers the Alignment Audit', () => {
  const m = focusTaxReportEmail({ firstName: 'Sam', result: server.computeFocusTax({ mode: 'team', teamSize: 12 }) });
  assert.ok(m.subject.startsWith('Your team\'s Focus Tax'));
  assert.ok(m.text.includes('team of 12') && m.html.includes('/corporate#audit'));
});

ok('a name is escaped in the html', () => {
  const m = focusTaxReportEmail({ firstName: '<b>x</b>', result: server.computeFocusTax({}) });
  assert.ok(!m.html.includes('<b>x</b>'));
});

console.log(`\n${passed} passed`);
