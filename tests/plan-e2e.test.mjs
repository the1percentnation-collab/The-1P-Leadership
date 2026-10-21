// My Plan, end to end, on the real emulators: assessment results keep their
// history, the wizard's goals save through managePlan with the three-goal
// limit, check-ins and reviews earn points once, a retake moves the goal's
// score, a coach sees only what was shared, a team admin sees totals only,
// a just-claimed visitor can save without a password, the hourly tick sends
// the review reminder, and deleting the account takes the plan with it.
//
// Run: `npm run e2e:plan` in tests/ (writes fake secrets and removes them).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, updateDoc } from 'firebase/firestore';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')]); console.log('❌', name, ':', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Email capture: what the functions think is Telnyx ─────────────────────
const emails = [];
const capture = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method === 'POST' && req.url.endsWith('/email_messages')) {
      emails.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { id: `msg_${emails.length}` } }));
      return;
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => capture.listen(8766, '127.0.0.1', r));

async function call(name, data, token) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data })
  });
  return r.json();
}

for (let i = 0; i < 60; i++) {
  try {
    const r = await call('managePlan', {});
    if (r && r.error) break;
  } catch (e) { /* not yet */ }
  await sleep(1000);
}

async function account(email) {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'e2e-pass-123', returnSecureToken: true })
  });
  const j = await r.json();
  return { uid: j.localId, token: j.idToken };
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const read = (p) => admin(async (db) => { const s = await getDoc(doc(db, p)); return s.exists() ? s.data() : null; });
const list = (p) => admin(async (db) => (await getDocs(collection(db, p))).docs.map((d) => Object.assign({ id: d.id }, d.data())));

// A zone where it is daytime now, so the tick's 9 AM to 9 PM window is open.
const ZONES = ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Honolulu', 'America/Sao_Paulo'];
const hourIn = (tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const DAY_TZ = ZONES.find((z) => hourIn(z) >= 10 && hourIn(z) <= 19) || 'America/New_York';

const owner = await account('the1percentnation@gmail.com');
const member = await account('morgan@e2e.test');
const coach = await account('coach@e2e.test');
const leader = await account('leader@e2e.test');
const team = [await account('t1@e2e.test'), await account('t2@e2e.test'), await account('t3@e2e.test')];

await admin(async (db) => {
  await setDoc(doc(db, `users/${owner.uid}`), { email: 'the1percentnation@gmail.com', displayName: 'Anthony', role: 'owner', companyId: 'academy' });
  await setDoc(doc(db, 'companies/academy'), { name: 'The One Percent', adminUids: [owner.uid] });
  await setDoc(doc(db, `users/${member.uid}`), { email: 'morgan@e2e.test', displayName: 'Morgan Member', role: 'user', companyId: null });
  await setDoc(doc(db, `users/${coach.uid}`), { email: 'coach@e2e.test', displayName: 'Casey Coach', role: 'user' });
  await setDoc(doc(db, `coachDirectory/${coach.uid}`), { uid: coach.uid, name: 'Casey Coach', active: true, track: 'life' });
  await setDoc(doc(db, 'companies/teamco'), { name: 'Team Co', adminUids: [leader.uid] });
  await setDoc(doc(db, `users/${leader.uid}`), { email: 'leader@e2e.test', displayName: 'Lee Leader', role: 'user', companyId: 'teamco' });
  for (const [i, m] of team.entries()) {
    await setDoc(doc(db, `users/${m.uid}`), { email: `t${i + 1}@e2e.test`, displayName: `Teammate ${i + 1}`, role: 'user', companyId: 'teamco' });
  }
});

const TEAM_DIMS = (v) => ({ sharedVision: v, roleClarity: v + 5, trust: v - 10, accountability: v, communication: v, engagement: v });
const result = (score, dims) => ({
  slug: 'team-alignment', mode: 'score', score, label: 'Drifting', dims, highest: 'roleClarity', lowest: 'trust',
  profile: { role: 'executive', teamSize: '11-50' }, answers: [], utm: {}
});

await t('a result saves, and a retake keeps the one it replaced', async () => {
  let r = await call('submitAssessment', result(44, TEAM_DIMS(44)), member.token);
  assert(r.result && r.result.ok, JSON.stringify(r));
  r = await call('submitAssessment', result(48, TEAM_DIMS(48)), member.token);
  assert(r.result && r.result.ok, JSON.stringify(r));
  const saved = await read(`users/${member.uid}/assessments/team-alignment`);
  assert(saved.score === 48 && saved.previous && saved.previous.score === 44, JSON.stringify(saved.previous));
  const history = await list(`users/${member.uid}/assessmentHistory`);
  assert(history.length === 2 && history.every((h) => h.slug === 'team-alignment'), JSON.stringify(history));
});

const goal = (areaKey, baseline) => ({
  source: 'assessment', slug: 'team-alignment', areaKey, areaLabel: areaKey, reading: 'score',
  title: `Work on ${areaKey}`, baseline, target: baseline + 10, checkinDay: 0, reminders: { email: true, inapp: true },
  tasks: [{ text: 'First action for the week' }, { text: 'Second action for the week' }]
});
let ids = [];

await t('the wizard\'s goals save, the first one is the focus, and the reflection lands in the journal', async () => {
  const r = await call('managePlan', { op: 'create', timezone: DAY_TZ, goals: [goal('trust', 38), goal('sharedVision', 48)], journal: [{ areaKey: 'trust', prompt: 'What is my team not telling me?', text: 'Probably the deadlines.' }] }, member.token);
  assert(r.result && r.result.ids && r.result.ids.length === 2, JSON.stringify(r));
  ids = r.result.ids;
  const goals = await list(`users/${member.uid}/goals`);
  const focus = goals.filter((g) => g.focus);
  assert(focus.length === 1 && focus[0].id === ids[0], JSON.stringify(goals.map((g) => [g.id, g.focus])));
  assert(goals.every((g) => g.status === 'active' && g.assessmentTitle === 'The Team Alignment Assessment' && g.tasks.length === 2));
  const journal = await list(`users/${member.uid}/journal`);
  assert(journal.length === 1 && journal[0].goalId === ids[0], JSON.stringify(journal));
});

await t('a fourth active goal is refused until one moves to Later', async () => {
  let r = await call('managePlan', { op: 'create', timezone: DAY_TZ, goals: [goal('roleClarity', 53), goal('engagement', 48)] }, member.token);
  assert(r.error && r.error.status === 'FAILED_PRECONDITION' && r.error.details && r.error.details.reason === 'limit', JSON.stringify(r));
  r = await call('managePlan', { op: 'create', timezone: DAY_TZ, goals: [goal('roleClarity', 53), goal('engagement', 48)], pauseIds: [ids[1]] }, member.token);
  assert(r.result && r.result.ok, JSON.stringify(r));
  const paused = await read(`users/${member.uid}/goals/${ids[1]}`);
  assert(paused.status === 'later' && paused.focus === false, JSON.stringify(paused));
  const goals = await list(`users/${member.uid}/goals`);
  assert(goals.filter((g) => g.status === 'active').length === 3);
});

await t('a check-in earns points once a week, not once per click', async () => {
  let r = await call('managePlan', { op: 'checkin', goalId: ids[0], timezone: DAY_TZ, did: 'Went first in the meeting', next: 'Ask the quiet question' }, member.token);
  assert(r.result && r.result.points === 3, JSON.stringify(r));
  r = await call('managePlan', { op: 'checkin', goalId: ids[0], timezone: DAY_TZ, did: 'Again' }, member.token);
  assert(r.result && r.result.points === 0, JSON.stringify(r));
  const stats = await read(`users/${member.uid}/stats/aggregate`);
  assert(stats.points === 3 && stats.planCheckins === 1, JSON.stringify(stats));
});

await t('checking off a task and editing it saves through managePlan', async () => {
  let r = await call('managePlan', { op: 'toggleTask', goalId: ids[0], taskId: 't1', done: true, timezone: DAY_TZ }, member.token);
  assert(r.result && r.result.goal.tasks[0].done === true, JSON.stringify(r));
  r = await call('managePlan', { op: 'addTask', goalId: ids[0], text: 'Thank whoever answers', timezone: DAY_TZ }, member.token);
  assert(r.result && r.result.goal.tasks.length === 3 && r.result.goal.tasks[2].id === 't3', JSON.stringify(r));
  r = await call('managePlan', { op: 'editTask', goalId: ids[0], taskId: 't9', text: 'nope', timezone: DAY_TZ }, member.token);
  assert(r.error && r.error.status === 'INVALID_ARGUMENT', JSON.stringify(r));
});

await t('a retake moves the score on every goal from that assessment', async () => {
  const r = await call('submitAssessment', result(60, TEAM_DIMS(60)), member.token);
  assert(r.result && r.result.ok, JSON.stringify(r));
  const g = await read(`users/${member.uid}/goals/${ids[0]}`);
  assert(g.baseline === 38 && g.latest === 50, `trust went ${g.baseline} → ${g.latest}`);
});

await t('sharing needs a listed coach, and the coach sees tasks and check-ins only', async () => {
  let r = await call('managePlan', { op: 'share', goalId: ids[0], coachUid: leader.uid }, member.token);
  assert(r.error && r.error.status === 'FAILED_PRECONDITION', JSON.stringify(r));
  r = await call('managePlan', { op: 'share', goalId: ids[0], coachUid: coach.uid }, member.token);
  assert(r.result && r.result.goal.coachName === 'Casey Coach', JSON.stringify(r));
  const c = await call('getCoachClients', {}, coach.token);
  assert(c.result && c.result.coach === true && c.result.clients.length === 1, JSON.stringify(c));
  const shown = c.result.clients[0];
  assert(shown.name === 'Morgan Member' && shown.goals.length === 1 && shown.goals[0].checkins.length === 2, JSON.stringify(shown));
  assert(!JSON.stringify(c.result).includes('Probably the deadlines'), 'the journal leaked to the coach');
  const notice = await list(`users/${coach.uid}/notifications`);
  assert(notice.some((n) => n.type === 'plan_shared'), JSON.stringify(notice));
  const notCoach = await call('getCoachClients', {}, leader.token);
  assert(notCoach.result && notCoach.result.coach === false, JSON.stringify(notCoach));
});

await t('a review that keeps going measures the next round from today\'s score', async () => {
  const r = await call('managePlan', { op: 'review', goalId: ids[0], decision: 'continue', easier: 'Saying the hard thing first', timezone: DAY_TZ }, member.token);
  assert(r.result && r.result.points === 10, JSON.stringify(r));
  const g = await read(`users/${member.uid}/goals/${ids[0]}`);
  assert(g.status === 'active' && g.baseline === 50 && g.target === 60, JSON.stringify({ s: g.status, b: g.baseline, t: g.target }));
  const journal = await list(`users/${member.uid}/journal`);
  assert(journal.some((j) => j.prompt === 'What got easier?'), JSON.stringify(journal));
});

await t('a priority lead finishing a goal opens a CRM task for Anthony and hands off the focus', async () => {
  const r = await call('managePlan', { op: 'review', goalId: ids[0], decision: 'finish', timezone: DAY_TZ }, member.token);
  assert(r.result && r.result.goal.status === 'done', JSON.stringify(r));
  const tasks = await list('companies/academy/tasks');
  assert(tasks.some((x) => /Morgan Member finished a goal/.test(x.title) && x.createdBy === 'my-plan'), JSON.stringify(tasks.map((x) => x.title)));
  const goals = await list(`users/${member.uid}/goals`);
  const focus = goals.filter((g) => g.focus);
  assert(focus.length === 1 && focus[0].status === 'active', JSON.stringify(goals.map((g) => [g.status, g.focus])));
});

await t('a team admin sees totals only, and only past three people', async () => {
  for (const [i, m] of team.entries()) {
    await call('submitAssessment', result(40 + 10 * i, TEAM_DIMS(40 + 10 * i)), m.token);
  }
  const denied = await call('getTeamPlanSummary', { companyId: 'teamco' }, member.token);
  assert(denied.error && denied.error.status === 'PERMISSION_DENIED', JSON.stringify(denied));
  const r = await call('getTeamPlanSummary', { companyId: 'teamco' }, leader.token);
  assert(r.result && r.result.members === 4 && !r.result.hidden, JSON.stringify(r));
  const ta = r.result.assessments.find((a) => a.slug === 'team-alignment');
  assert(ta && ta.n === 3 && ta.avg === 50, JSON.stringify(r.result.assessments));
  assert(!JSON.stringify(r.result).includes('Teammate'), 'a name leaked into the totals');
});

await t('a visitor who just claimed a report saves a plan without a password, once', async () => {
  const claim = await call('claimAssessment', Object.assign({ name: 'Vera Visitor', email: 'vera@e2e.test' }, result(52, TEAM_DIMS(52))));
  assert(claim.result && claim.result.status === 'created', JSON.stringify(claim));
  let r = await call('claimPlan', { email: 'vera@e2e.test', timezone: DAY_TZ, goals: [goal('trust', 42)] });
  assert(r.result && r.result.status === 'saved', JSON.stringify(r));
  r = await call('claimPlan', { email: 'vera@e2e.test', timezone: DAY_TZ, goals: [goal('engagement', 52)] });
  assert(r.result && r.result.status === 'login', JSON.stringify(r));
  r = await call('claimPlan', { email: 'morgan@e2e.test', timezone: DAY_TZ, goals: [goal('engagement', 52)] });
  assert(r.result && r.result.status === 'login', 'a used account accepted a plan from a stranger');
});

await t('the hourly tick sends a due review once, by email and the bell', async () => {
  const active = (await list(`users/${member.uid}/goals`)).find((g) => g.status === 'active' && g.focus);
  await admin((db) => updateDoc(doc(db, `users/${member.uid}/goals/${active.id}`), { reviewDate: '2020-01-01', timezone: DAY_TZ, lastReminderDate: null, reviewNoticeFor: null }));
  const before = emails.length;
  const tick = async () => (await fetch(`${FN}/runAutomationTick`, { method: 'POST', headers: { 'X-Tick-Secret': 'e2e-tick-secret' } })).json();
  const one = await tick();
  assert(one.planReminders && one.planReminders.reviews >= 1, JSON.stringify(one.planReminders));
  const notes = await list(`users/${member.uid}/notifications`);
  assert(notes.some((n) => n.type === 'plan_review' && n.link === `/plan#goal-${active.id}`), JSON.stringify(notes.map((n) => n.type)));
  assert(emails.slice(before).some((e) => /Time to review/.test(e.subject || '')), 'no review email');
  const two = await tick();
  assert(two.planReminders && two.planReminders.reviews === 0, `sent twice: ${JSON.stringify(two.planReminders)}`);
});

await t('deleting the account takes the plan, journal and results with it', async () => {
  const r = await call('deleteMyAccount', {}, member.token);
  assert(r.result && r.result.ok !== false, JSON.stringify(r));
  for (const sub of ['goals', 'journal', 'assessments', 'assessmentHistory']) {
    const left = await list(`users/${member.uid}/${sub}`);
    assert(left.length === 0, `${sub} survived: ${left.length}`);
  }
});

capture.close();
await env.cleanup();
const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of failed) console.log('   ', r[1], '=>', r[2]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
