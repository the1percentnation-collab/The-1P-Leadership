// My Plan: the goal rules (plan-core.js), the server's generated copy, and
// the wiring that keeps goals private, reminded and cleaned up.
//
// Run: node tests/plan.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loadPure } from './_load-pure.mjs';

const P = await loadPure('plan-core.js');
const { scoreAssessment, buildReport } = await loadPure('assessment-core.js');
const { ASSESSMENTS, getAssessment } = await loadPure('assessments-data.js');
const require = createRequire(import.meta.url);
const server = require('../functions/plan-core.js');

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const fn = read('functions/index.js');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

// The server's assessment allowlist, read from functions/index.js.
const SLUGS = Object.fromEntries([...fn.matchAll(/^\s+'([a-z0-9-]+)': \{ title: '((?:[^'\\]|\\.)*)', category: '(\w+)' \}/gm)]
  .map((m) => [m[1], { title: m[2].replace(/\\'/g, "'"), category: m[3] }]));

const TODAY = '2026-10-21'; // a Wednesday
const resultFor = (def, pattern) => scoreAssessment(def, Object.fromEntries(def.questions.map((_, i) => [i, pattern(i)])));

console.log('plan — My Plan goals, reminders and team totals');

// ── The generated server copy ──────────────────────────────────────────────

ok('functions/plan-core.js is the generated copy of public/js/plan-core.js', () => {
  const src = read('public/js/plan-core.js');
  const m = /\nexport \{([\s\S]*?)\};\s*$/.exec(src);
  assert.ok(m, 'plan-core.js must end with one export list');
  const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  const head = read('functions/plan-core.js').split('\n').slice(0, 6).join('\n') + '\n';
  const expected = head + src.slice(0, m.index) + `\nmodule.exports = {\n  ${names.join(', ')}\n};\n`;
  assert.strictEqual(read('functions/plan-core.js'), expected, 'run: node scripts/build-plan-server.cjs');
  assert.deepStrictEqual(Object.keys(server).sort(), names.slice().sort());
});

ok('the server allowlist was read from functions/index.js', () => {
  assert.strictEqual(Object.keys(SLUGS).length, ASSESSMENTS.length);
});

// ── Goal statements ────────────────────────────────────────────────────────

ok('every area in every assessment has a distinct goal with no em dash', () => {
  ASSESSMENTS.forEach((a) => {
    const goals = a.dimensions.map((d) => d.goal);
    assert.strictEqual(new Set(goals).size, goals.length, `${a.slug} repeats a goal`);
    goals.forEach((g) => assert.ok(!/[—–]/.test(g), `${a.slug}: "${g}" has a dash`));
  });
});

// ── The wizard ─────────────────────────────────────────────────────────────

ok('score assessments lead with the weakest area, recommended', () => {
  const def = getAssessment('team-alignment');
  const r = resultFor(def, (i) => (def.questions[i].dim === 'trust' ? (def.questions[i].reverse ? 5 : 1) : 4));
  const w = P.wizardAreas(def, buildReport(def, r));
  assert.strictEqual(w.reading, 'score');
  assert.strictEqual(w.recommendedKey, 'trust');
  assert.strictEqual(w.areas[0].key, 'trust');
  assert.ok(w.areas[0].recommended && !w.areas[1].recommended);
  for (let i = 2; i < w.areas.length; i++) assert.ok(w.areas[i - 1].score <= w.areas[i].score);
  assert.strictEqual(w.areas[0].goal, def.dimensions.find((d) => d.key === 'trust').goal);
  assert.strictEqual(w.areas[0].actions.length, 3);
  assert.strictEqual(w.areas[0].target, Math.min(100, w.areas[0].score + 10));
});

ok('profile assessments lead with the member\'s own type and set no target', () => {
  const def = getAssessment('leadership-style');
  const r = resultFor(def, (i) => (def.questions[i].dim === 'coach' ? (def.questions[i].reverse ? 1 : 5) : 2));
  const w = P.wizardAreas(def, buildReport(def, r));
  assert.strictEqual(w.reading, 'profile');
  assert.strictEqual(w.areas[0].key, 'coach');
  assert.ok(w.areas[0].recommended);
  assert.ok(w.areas.every((a) => a.target === null));
});

ok('lower-better assessments aim lower', () => {
  assert.strictEqual(P.targetFor(60, 'lower-better'), 50);
  assert.strictEqual(P.targetFor(8, 'lower-better'), null);
  assert.strictEqual(P.targetFor(97, 'score'), null);
  assert.strictEqual(P.targetFor(42, 'score'), 52);
  assert.strictEqual(P.targetFor(70, 'profile'), null);
});

ok('a wizard plan from every assessment passes the server\'s validation', () => {
  ASSESSMENTS.forEach((def) => {
    const r = resultFor(def, (i) => 1 + (i % 5));
    const wizard = P.wizardAreas(def, buildReport(def, r));
    const picks = wizard.areas.slice(0, 2).map((a) => ({ areaKey: a.key, tasks: a.actions.map((text) => ({ text })) }));
    const goals = P.goalsFromPicks({ def, wizard, picks, start: TODAY, checkinDay: 0, reminders: { email: true }, timezone: 'America/Chicago' });
    assert.strictEqual(goals.length, 2);
    goals.forEach((g) => {
      const v = server.validateNewGoal(g, { today: TODAY, slugs: SLUGS });
      assert.ok(v.value, `${def.slug}: ${v.error}`);
      assert.strictEqual(v.value.assessmentTitle, def.title);
      assert.deepStrictEqual(v.value.tasks.map((t) => t.due), ['2026-10-27', '2026-11-03', '2026-11-10']);
      assert.strictEqual(v.value.reviewDate, '2026-11-20');
    });
  });
});

ok('the wizard keeps the member\'s own words and dates', () => {
  const def = getAssessment('burnout-check');
  const wizard = P.wizardAreas(def, buildReport(def, resultFor(def, () => 3)));
  const [g] = P.goalsFromPicks({
    def, wizard, start: TODAY, checkinDay: 3, reminders: {}, timezone: 'UTC',
    picks: [{ areaKey: wizard.recommendedKey, title: '  Protect my mornings  ', tasks: [{ text: 'No email before 9', due: '2026-10-23' }, { text: '  ' }, { text: 'Walk at lunch' }] }]
  });
  assert.strictEqual(g.title, 'Protect my mornings');
  assert.deepStrictEqual(g.tasks, [{ text: 'No email before 9', due: '2026-10-23' }, { text: 'Walk at lunch', due: '2026-11-03' }]);
});

ok('no more than two areas per wizard run', () => {
  const def = getAssessment('alignment-scorecard');
  const wizard = P.wizardAreas(def, buildReport(def, resultFor(def, () => 3)));
  const picks = wizard.areas.map((a) => ({ areaKey: a.key, tasks: [{ text: 'Do the thing' }] }));
  assert.strictEqual(P.goalsFromPicks({ def, wizard, picks, start: TODAY }).length, P.MAX_AREAS_PER_BUILD);
});

ok('the Goal Planner becomes one 90-day goal with monthly key results', () => {
  const g = P.goalFromPlanner({
    win: 'Hit my number and feel aligned', reviewDay: 'Friday',
    okrs: [{ krs: [{ text: 'Define 3 revenue actions' }, { text: 'Build a habit stack' }] }, { krs: [{ text: 'Systemize the top 2 activities' }] }, { krs: [{ text: 'Run a 90-day retrospective' }] }]
  }, { start: TODAY, reminders: {}, timezone: 'UTC' });
  assert.strictEqual(g.source, 'planner');
  assert.strictEqual(g.checkinDay, 5);
  assert.deepStrictEqual(g.tasks.map((t) => t.due), ['2026-11-19', '2026-11-19', '2026-12-19', '2027-01-18']);
  const v = server.validateNewGoal(g, { today: TODAY, slugs: SLUGS });
  assert.strictEqual(v.value.reviewDate, P.plusDays(TODAY, 90));
});

// ── Validation ─────────────────────────────────────────────────────────────

ok('new goals are refused when malformed', () => {
  const base = { source: 'custom', title: 'Finish the proposal', tasks: [{ text: 'Outline it' }] };
  assert.ok(server.validateNewGoal(base, { today: TODAY }).value);
  assert.match(server.validateNewGoal({ ...base, source: 'nope' }, { today: TODAY }).error, /Unknown goal type/);
  assert.match(server.validateNewGoal({ ...base, title: 'x' }, { today: TODAY }).error, /name/);
  assert.match(server.validateNewGoal({ ...base, tasks: [] }, { today: TODAY }).error, /at least one/);
  assert.match(server.validateNewGoal({ ...base, tasks: Array.from({ length: 13 }, () => ({ text: 'ok ok' })) }, { today: TODAY }).error, /12/);
  assert.match(server.validateNewGoal({ ...base, source: 'assessment', slug: 'made-up', areaKey: 'x' }, { today: TODAY, slugs: SLUGS }).error, /Unknown assessment/);
  assert.match(server.validateNewGoal({ ...base, source: 'assessment', slug: 'team-alignment', areaKey: 'Bad Key' }, { today: TODAY, slugs: SLUGS }).error, /Unknown area/);
});

ok('validation clamps what the browser could fake', () => {
  const v = server.validateNewGoal({
    source: 'assessment', slug: 'team-alignment', areaKey: 'trust', areaLabel: 'Trust', reading: 'score',
    title: 'Make it safe to speak up', baseline: 140, target: -5, startDate: '2030-01-01', checkinDay: 9,
    tasks: [{ text: 'Go first', due: '2099-01-01' }], reminders: { push: 'yes' }
  }, { today: TODAY, slugs: SLUGS }).value;
  assert.strictEqual(v.baseline, 100);
  assert.strictEqual(v.latest, 100);
  assert.strictEqual(v.target, 0);
  assert.strictEqual(v.startDate, TODAY);
  assert.strictEqual(v.checkinDay, P.weekdayOf(TODAY));
  assert.strictEqual(v.tasks[0].due, null);
  assert.deepStrictEqual(v.reminders, { email: true, inapp: true, push: false });
  assert.strictEqual(v.assessmentTitle, 'The Team Alignment Assessment');
});

// ── Changes to a goal ──────────────────────────────────────────────────────

const goal = () => ({
  status: 'active', source: 'assessment', reading: 'score', baseline: 40, latest: 52, target: 50,
  startDate: '2026-09-21', reviewDate: '2026-10-21', checkinDay: 0, title: 'Give every key outcome one clear owner',
  tasks: [{ id: 't1', text: 'List outcomes', due: '2026-09-27', done: false, doneDate: null }, { id: 't2', text: 'Assign owners', due: null, done: false, doneDate: null }]
});

ok('tasks can be checked off, edited, added and removed', () => {
  let g = goal();
  const a = P.applyGoalOp(g, 'toggleTask', { taskId: 't1' }, TODAY);
  assert.strictEqual(a.patch.tasks[0].done, true);
  assert.strictEqual(a.patch.tasks[0].doneDate, TODAY);
  assert.strictEqual(a.patch.lastActivityDate, TODAY);
  assert.strictEqual(g.tasks[0].done, false, 'the original goal is not mutated');
  g = Object.assign(g, a.patch);
  const b = P.applyGoalOp(g, 'addTask', { text: 'Share the list' }, TODAY);
  assert.strictEqual(b.patch.tasks[2].id, 't3');
  assert.match(P.applyGoalOp(g, 'editTask', { taskId: 't9', text: 'x' }, TODAY).error, /gone/);
  assert.strictEqual(P.applyGoalOp(g, 'editTask', { taskId: 't2', text: 'Assign one owner each' }, TODAY).patch.tasks[1].text, 'Assign one owner each');
  const one = Object.assign(goal(), { tasks: [goal().tasks[0]] });
  assert.match(P.applyGoalOp(one, 'deleteTask', { taskId: 't1' }, TODAY).error, /at least one task/);
});

ok('picking a goal back up restarts its review clock', () => {
  const g = Object.assign(goal(), { status: 'later', lastCheckinDate: '2026-09-28' });
  const r = P.applyGoalOp(g, 'setStatus', { status: 'active' }, TODAY);
  assert.strictEqual(r.patch.startDate, TODAY);
  assert.strictEqual(r.patch.reviewDate, P.plusDays(TODAY, 30));
  assert.strictEqual(r.patch.lastCheckinDate, null);
  const done = P.applyGoalOp(goal(), 'setStatus', { status: 'done' }, TODAY);
  assert.strictEqual(done.event, 'done');
  assert.strictEqual(done.patch.focus, false);
});

ok('a check-in needs words, and keeps the last 26', () => {
  assert.match(P.applyGoalOp(goal(), 'checkin', { did: '  ' }, TODAY).error, /Write a line/);
  const many = Object.assign(goal(), { checkins: Array.from({ length: 26 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}` })) });
  const r = P.applyGoalOp(many, 'checkin', { did: 'Assigned three owners' }, TODAY);
  assert.strictEqual(r.event, 'checkin');
  assert.strictEqual(r.patch.checkins.length, 26);
  assert.strictEqual(r.patch.checkins[25].did, 'Assigned three owners');
  assert.strictEqual(r.patch.lastCheckinDate, TODAY);
  assert.match(P.applyGoalOp(Object.assign(goal(), { status: 'later' }), 'checkin', { did: 'x' }, TODAY).error, /active/);
});

ok('a review either finishes the goal or starts a new round from today\'s score', () => {
  const fin = P.applyGoalOp(goal(), 'review', { decision: 'finish', easier: 'Handoffs' }, TODAY);
  assert.strictEqual(fin.patch.status, 'done');
  assert.strictEqual(fin.patch.reviews[0].score, 52);
  const cont = P.applyGoalOp(goal(), 'review', { decision: 'continue' }, TODAY);
  assert.strictEqual(cont.patch.status, undefined);
  assert.strictEqual(cont.patch.baseline, 52);
  assert.strictEqual(cont.patch.target, 62);
  assert.strictEqual(cont.patch.reviewDate, P.plusDays(TODAY, 30));
  assert.match(P.applyGoalOp(goal(), 'review', { decision: 'maybe' }, TODAY).error, /Choose/);
});

ok('score change knows which direction is better', () => {
  assert.deepStrictEqual(P.scoreChange(goal()), { from: 40, to: 52, delta: 12, better: true, reached: true });
  const lb = P.scoreChange({ reading: 'lower-better', baseline: 70, latest: 64, target: 60 });
  assert.ok(lb.better && !lb.reached);
  assert.strictEqual(P.scoreChange({ baseline: null, latest: 3 }), null);
});

ok('due, stalled and next-task reads', () => {
  const g = goal();
  assert.ok(P.reviewDue(g, TODAY));
  assert.ok(!P.reviewDue(g, '2026-10-20'));
  assert.ok(P.checkinDue(g, TODAY));
  assert.ok(!P.checkinDue(Object.assign(goal(), { lastCheckinDate: '2026-10-18' }), TODAY));
  assert.ok(P.isStalled(Object.assign(goal(), { lastActivityDate: '2026-10-01' }), TODAY));
  assert.ok(!P.isStalled(Object.assign(goal(), { lastActivityDate: '2026-10-10' }), TODAY));
  assert.strictEqual(P.nextTask(g).id, 't1');
  assert.deepStrictEqual(P.overdueTasks(g, TODAY).map((t) => t.id), ['t1']);
});

ok('goals sort focus, active, later, done', () => {
  const order = P.orderGoals([
    { id: 'd', status: 'done' }, { id: 'l', status: 'later' }, { id: 'a', status: 'active' }, { id: 'f', status: 'active', focus: true }
  ]).map((g) => g.id);
  assert.deepStrictEqual(order, ['f', 'a', 'l', 'd']);
});

// ── Dashboard cards ────────────────────────────────────────────────────────

ok('the dashboard shows a due review first, then a check-in, then the next task', () => {
  const review = Object.assign(goal(), { id: 'r', focus: true });
  const checkin = Object.assign(goal(), { id: 'c', reviewDate: '2026-12-01', startDate: '2026-10-01' });
  const steps = P.planNextSteps([checkin, review], TODAY);
  assert.deepStrictEqual(steps.map((s) => s.key), ['plan-review', 'plan-checkin']);
  assert.strictEqual(steps[0].href, '/plan#goal-r');
  const quiet = Object.assign(goal(), { id: 'q', focus: true, reviewDate: '2026-12-01', lastCheckinDate: '2026-10-20' });
  assert.deepStrictEqual(P.planNextSteps([quiet], TODAY).map((s) => s.key), ['plan-task']);
  assert.strictEqual(P.planNextSteps([quiet], TODAY)[0].eyebrow, 'Past due');
  assert.deepStrictEqual(P.planNextSteps([], TODAY, { hasAssessments: true }).map((s) => s.key), ['plan-start']);
  assert.deepStrictEqual(P.planNextSteps([], TODAY), []);
});

// ── Reminders ──────────────────────────────────────────────────────────────

const clock = (date, minutes) => ({ date, weekday: P.weekdayOf(date), minutes });

ok('check-in reminders go on the check-in day, 9 AM to 9 PM, once a day', () => {
  const g = Object.assign(goal(), { reviewDate: '2026-12-01', checkinDay: 0, lastCheckinDate: '2026-10-18' });
  assert.deepStrictEqual(P.planReminderDue(g, clock('2026-10-25', 10 * 60)), { kind: 'checkin', date: '2026-10-25' });
  assert.strictEqual(P.planReminderDue(g, clock('2026-10-25', 8 * 60)), null);
  assert.strictEqual(P.planReminderDue(g, clock('2026-10-25', 21 * 60)), null);
  assert.strictEqual(P.planReminderDue(g, clock('2026-10-26', 10 * 60)), null, 'not the check-in day');
  assert.strictEqual(P.planReminderDue(Object.assign({}, g, { lastReminderDate: '2026-10-25' }), clock('2026-10-25', 10 * 60)), null);
  assert.strictEqual(P.planReminderDue(Object.assign({}, g, { lastCheckinDate: '2026-10-22' }), clock('2026-10-25', 10 * 60)), null, 'checked in three days ago');
  assert.strictEqual(P.planReminderDue(Object.assign({}, g, { reminders: { email: false, inapp: false } }), clock('2026-10-25', 10 * 60)), null);
  assert.strictEqual(P.planReminderDue(Object.assign({}, g, { status: 'later' }), clock('2026-10-25', 10 * 60)), null);
});

ok('the review reminder goes once per review date', () => {
  const g = goal();
  assert.deepStrictEqual(P.planReminderDue(g, clock(TODAY, 12 * 60)), { kind: 'review', date: TODAY });
  assert.strictEqual(P.planReminderDue(Object.assign(g, { reviewNoticeFor: '2026-10-21', checkinDay: 3, lastCheckinDate: TODAY }), clock('2026-10-22', 12 * 60)), null);
});

ok('reminder copy names the goal, links to it and has no em dash', () => {
  const g = Object.assign(goal(), { slug: 'team-alignment', assessmentTitle: 'The Team Alignment Assessment', areaLabel: 'Clarity of Roles' });
  const r = P.planReminderMessage(g, { kind: 'review' }, { goalId: 'abc' });
  assert.match(r.body, /Retake The Team Alignment Assessment/);
  assert.strictEqual(r.url, 'https://the1pnation.com/plan#goal-abc');
  const c = P.planReminderMessage(g, { kind: 'checkin' });
  assert.match(c.body, /0 of 2 tasks done/);
  [r, c].forEach((m) => Object.values(m).forEach((v) => assert.ok(!/—/.test(v), v)));
});

// ── Team totals ────────────────────────────────────────────────────────────

ok('team totals stay hidden under three people and never list one person', () => {
  assert.deepStrictEqual(P.summarizeTeam([{}, {}], { today: TODAY }), { members: 2, hidden: true });
  const m = (score, dims, goals = []) => ({ assessments: { 'team-alignment': { score, dims } }, goals });
  const s = P.summarizeTeam([
    m(40, { trust: 30 }, [Object.assign(goal(), { checkins: [{ date: '2026-10-15' }, { date: '2026-08-01' }] })]),
    m(60, { trust: 50 }),
    m(80, { trust: 70 }),
    { assessments: { 'burnout-check': { score: 10, dims: {} } }, goals: [] }
  ], { today: TODAY });
  assert.strictEqual(s.members, 4);
  assert.strictEqual(s.withPlan, 1);
  assert.strictEqual(s.checkinsLast30, 1);
  assert.deepStrictEqual(s.assessments, [{ slug: 'team-alignment', n: 3, avg: 60, dims: { trust: 50 } }]);
  assert.ok(!JSON.stringify(s).includes('burnout-check'), 'an assessment two people took is not shown');
});

// ── Calendar export ────────────────────────────────────────────────────────

ok('the calendar export is valid iCalendar with escaped, folded lines', () => {
  const g = Object.assign(goal(), { id: 'g1', title: 'Clarity, roles; owners' });
  g.tasks.push({ id: 't3', text: 'x'.repeat(120), due: '2026-10-30', done: false });
  const ics = P.icsForGoals([g, Object.assign(goal(), { id: 'g2', status: 'later' })], { stamp: '20261021T120000Z' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 3, 'two dated open tasks and the review; later goals are left out');
  assert.match(ics, /DTSTART;VALUE=DATE:20260927\r\nDTEND;VALUE=DATE:20260928/);
  assert.match(ics, /SUMMARY:Review: Clarity\\, roles\\; owners/);
  ics.split('\r\n').forEach((line) => assert.ok(line.length <= 75, `line too long: ${line.length}`));
  assert.ok(/\r\n x/.test(ics), 'a long summary is folded');
});

// ── Wiring ─────────────────────────────────────────────────────────────────

const block = (src, start, end) => { const i = src.indexOf(start); assert.ok(i >= 0, `${start} not found`); const j = src.indexOf(end, i + start.length); return src.slice(i, j < 0 ? undefined : j); };

ok('every plan callable is signed-in or rate-limited, and only managePlan writes goals', () => {
  for (const name of ['managePlan', 'claimPlan', 'getCoachClients', 'getTeamPlanSummary']) {
    const b = block(fn, `exports.${name} =`, '\nexports.');
    assert.ok(new RegExp(`rateLimitCaller\\([\\s\\S]{0,120}?action: '${name}'`).test(b), `${name} has no rate limit`);
  }
  assert.ok(/assertCompanyAdmin\(db, companyId, request\)/.test(block(fn, 'exports.getTeamPlanSummary =', '\nexports.')), 'team totals are not admin-only');
  assert.ok(/coachDirectory'\)\.doc\(coachUid\)[\s\S]{0,120}active !== true/.test(fn), 'sharing does not check the coach is listed');
});

ok('claimPlan writes only to a fresh account nobody can sign in to yet, with no goals', () => {
  const b = block(fn, 'exports.claimPlan =', '\nexports.');
  assert.ok(/!\(user\.providerData \|\| \[\]\)\.length/.test(b) && /7 \* 24 \* 3600 \* 1000/.test(b) && /goals'\)\.limit\(1\)/.test(b));
});

ok('the active-goal limit is enforced inside the create transaction', () => {
  const b = block(fn, 'async function createPlanGoals', '\nasync function handOffPlanFocus');
  assert.ok(/runTransaction[\s\S]*planCore\.MAX_ACTIVE/.test(b));
});

ok('account deletion and data export include every plan collection', () => {
  const list = block(fn, 'const USER_SUBCOLLECTIONS = [', '];');
  for (const name of ['assessments', 'assessmentHistory', 'goals', 'journal', 'courseCommitments']) {
    assert.ok(list.includes(`'${name}'`), `${name} survives an account deletion`);
  }
});

ok('rules let a member read their plan and write none of it', () => {
  const rules = read('firestore.rules');
  for (const m of ['assessmentHistory/{entryId}', 'goals/{goalId}', 'journal/{entryId}']) {
    const b = block(rules, `match /${m}`, '}');
    assert.ok(/allow read: if isOwner\(\) \|\| isSelf\(uid\);/.test(b), `${m} read rule changed`);
    assert.ok(/allow write: if false;/.test(b + '}'), `${m} is client-writable`);
  }
});

ok('the reminder tick has its collection-group indexes', () => {
  const idx = JSON.parse(read('firestore.indexes.json'));
  for (const f of ['status', 'coachUid']) {
    const o = (idx.fieldOverrides || []).find((x) => x.collectionGroup === 'goals' && x.fieldPath === f);
    assert.ok(o && o.indexes.some((i) => i.queryScope === 'COLLECTION_GROUP'), `goals.${f} has no collection-group index`);
  }
  assert.ok(/step\('planReminders'/.test(fn), 'the tick does not send plan reminders');
});

ok('results keep history and update the goals built from them', () => {
  const b = block(fn, 'async function recordAssessment(', '\n}\n');
  assert.ok(/recordAssessmentProgress\(db, uid, result\)/.test(b));
  assert.ok(/previous:/.test(b), 'the replaced result is not kept');
});

ok('My Plan is in the member nav and the pages exist', () => {
  assert.ok(/key: 'plan',\s+href: '\/plan'/.test(read('public/js/academy-shell.js')));
  for (const f of ['public/plan.html', 'public/plan-build.html', 'public/js/plan-page.js', 'public/js/plan-build.js', 'public/assets/plan.css']) {
    assert.ok(fs.existsSync(new URL('../' + f, import.meta.url)), `${f} is missing`);
  }
});

ok('member-facing plan copy has no em dashes', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const f of ['public/js/plan-page.js', 'public/js/plan-build.js', 'public/js/plan-core.js', 'public/plan.html', 'public/plan-build.html']) {
    const hits = strip(read(f)).split('\n').filter((l) => /—/.test(l));
    assert.deepStrictEqual(hits, [], `${f} shows an em dash`);
  }
});

console.log(`\n${passed} checks passed.`);
