// Portal notifications and the legacy-enrollment guard, end to end on the
// real emulators: the shipped onAnnouncementWritten trigger, the automation
// tick's scheduled sweep and the enrollFree callable all run in the Functions
// emulator, and the test checks what members would then see.
//
//   - Publishing an announcement rings the bell (users/{uid}/notifications)
//     for exactly the members its audience targets, once.
//   - A scheduled announcement rings nobody until its time, then the tick
//     rings it — and a second tick rings nothing.
//   - Announcements that were live before the fan-out shipped stay quiet.
//   - An icant beta tester with lesson progress is NOT handed the paid
//     Leader Coach course by the legacy migration; a genuine legacy CLC
//     student still is.
//
// From the repo root: `npm run e2e:notify` in tests/ (writes fake secrets and
// removes them afterwards).
import fs from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const TICK_SECRET = 'e2e-tick-secret';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Wait for the functions emulator ───────────────────────────────────────
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${FN}/runAutomationTick`, { method: 'POST' });
    if (r.status === 403 || r.status === 503) break; // up: refuses a missing secret
  } catch (e) { /* not yet */ }
  await sleep(1000);
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const read = (p) => admin(async (db) => { const s = await getDoc(doc(db, p)); return s.exists() ? s.data() : null; });
const bell = (uid) => admin(async (db) => (await getDocs(collection(db, `users/${uid}/notifications`))).docs.map((d) => ({ id: d.id, ...d.data() })));

// Poll until a condition holds: triggers run asynchronously after a write.
async function eventually(fn, ms = 20000) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    last = await fn();
    if (last) return last;
    await sleep(500);
  }
  return last;
}

// ── Seed members ──────────────────────────────────────────────────────────
const H = 3600e3;
await admin(async (db) => {
  await setDoc(doc(db, 'users/owner'), { email: 'owner@e2e.test', role: 'owner', enrolledCourseSlugs: [] });
  await setDoc(doc(db, 'users/beta'), { email: 'beta@e2e.test', role: 'user', companyId: null, enrolledCourseSlugs: ['icant'] });
  await setDoc(doc(db, 'users/clc'), { email: 'clc@e2e.test', role: 'user', companyId: 'acme', enrolledCourseSlugs: ['1p-clc-leader'] });
  await setDoc(doc(db, 'users/fresh'), { email: 'fresh@e2e.test', role: 'user', companyId: null, enrolledCourseSlugs: [] });
});

// ── 1. Publishing rings the right bells ───────────────────────────────────
await t('publishing an announcement to I Can\'t members rings their bells', async () => {
  await admin((db) => setDoc(doc(db, 'announcements/beta-week2'), {
    title: 'Week 2 is open', body: 'Module 3 just went live.', ctaHref: '/courses.html?course=icant',
    audience: 'enrolled', courseSlug: 'icant', active: true, createdAt: new Date()
  }));
  const n = await eventually(async () => (await bell('beta')).find((x) => x.id === 'ann_beta-week2'));
  assert(n, 'the beta tester\'s bell never rang');
  assert(n.type === 'announcement' && n.title === 'Week 2 is open', 'wrong notification: ' + JSON.stringify(n));
  assert(n.link === '/courses.html?course=icant' && n.read === false, 'bad link/read: ' + JSON.stringify(n));
  assert(n.preview === 'Module 3 just went live.', 'preview missing');
  const u = await read('users/beta');
  assert(u.unreadNotifCount === 1, 'unread badge count is ' + u.unreadNotifCount);
});

await t('...and members outside the audience hear nothing', async () => {
  await sleep(1500);
  for (const uid of ['owner', 'clc', 'fresh']) {
    assert(!(await bell(uid)).length, `${uid} was notified`);
  }
});

await t('...and the announcement is stamped so it never fans out twice', async () => {
  const a = await read('announcements/beta-week2');
  assert(a.notifiedAt, 'no notifiedAt claim');
  await admin((db) => setDoc(doc(db, 'announcements/beta-week2'), { body: 'Edited copy.' }, { merge: true }));
  await sleep(3000);
  const u = await read('users/beta');
  assert(u.unreadNotifCount === 1, 'an edit re-notified: count ' + u.unreadNotifCount);
});

await t('an \'all\' announcement reaches every member', async () => {
  await admin((db) => setDoc(doc(db, 'announcements/everyone'), {
    title: 'Portal update', body: 'New library features.', audience: 'all', active: true, createdAt: new Date()
  }));
  for (const uid of ['owner', 'beta', 'clc', 'fresh']) {
    const n = await eventually(async () => (await bell(uid)).find((x) => x.id === 'ann_everyone'));
    assert(n, `${uid} missed the all-members announcement`);
  }
});

// ── 2. Quiet cases ────────────────────────────────────────────────────────
await t('a draft rings nobody', async () => {
  await admin((db) => setDoc(doc(db, 'announcements/draft'), {
    title: 'Not yet', audience: 'all', active: false, createdAt: new Date()
  }));
  await sleep(3000);
  assert(!(await bell('fresh')).some((x) => x.id === 'ann_draft'), 'a draft notified');
});

await t('an announcement live long before this shipped stays quiet', async () => {
  await admin((db) => setDoc(doc(db, 'announcements/old-news'), {
    title: 'Old news', audience: 'all', active: true, createdAt: new Date(Date.now() - 30 * 24 * H)
  }));
  await sleep(3000);
  assert(!(await bell('fresh')).some((x) => x.id === 'ann_old-news'), 'old news notified');
});

// ── 3. Scheduled announcements ride the tick ──────────────────────────────
const tick = async () => {
  const r = await fetch(`${FN}/runAutomationTick`, { method: 'POST', headers: { 'X-Tick-Secret': TICK_SECRET } });
  return r.json();
};

await t('a scheduled announcement waits for its time', async () => {
  await admin((db) => setDoc(doc(db, 'announcements/scheduled'), {
    title: 'Live call Thursday', audience: 'all', active: true,
    createdAt: new Date(), publishAt: new Date(Date.now() + 4000)
  }));
  await sleep(2500);
  assert(!(await bell('fresh')).some((x) => x.id === 'ann_scheduled'), 'notified before its publish time');
});

await t('...then the tick rings it once its time arrives', async () => {
  await sleep(3000);
  const summary = await tick();
  assert(summary.announcements && summary.announcements.announcements === 1,
    'tick summary: ' + JSON.stringify(summary.announcements));
  assert((await bell('fresh')).some((x) => x.id === 'ann_scheduled'), 'the tick did not notify');
});

await t('...and a second tick rings nothing', async () => {
  const summary = await tick();
  assert(summary.announcements && summary.announcements.announcements === 0,
    'second tick: ' + JSON.stringify(summary.announcements));
});

// ── 4. The legacy migration no longer gives away Leader Coach ─────────────
async function signUp(email) {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'e2e-pass-123', returnSecureToken: true })
  });
  const j = await r.json();
  return { uid: j.localId, token: j.idToken };
}
async function enrollLegacy(token) {
  const r = await fetch(`${FN}/enrollFree`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { slug: '1p-clc-leader', legacy: true } })
  });
  return r.json();
}

await t('an I Can\'t tester with lesson progress is refused Leader Coach', async () => {
  const { uid, token } = await signUp('tester@e2e.test');
  await admin(async (db) => {
    await setDoc(doc(db, `users/${uid}`), { email: 'tester@e2e.test', role: 'user', enrolledCourseSlugs: ['icant'] }, { merge: true });
    await setDoc(doc(db, `users/${uid}/progress/icant__m0`), { completed: true });
    await setDoc(doc(db, `users/${uid}/progress/icant__m1`), { completed: true });
  });
  const res = await enrollLegacy(token);
  assert(res.error && /prior progress/i.test(res.error.message), 'expected a refusal, got ' + JSON.stringify(res));
  const u = await read(`users/${uid}`);
  assert(!(u.enrolledCourseSlugs || []).includes('1p-clc-leader'), 'Leader Coach was granted');
});

await t('a genuine legacy CLC student still keeps their access', async () => {
  const { uid, token } = await signUp('legacy@e2e.test');
  await admin((db) => setDoc(doc(db, `users/${uid}/progress/2`), { completed: true }));
  const res = await enrollLegacy(token);
  assert(res.result && res.result.ok, 'legacy student refused: ' + JSON.stringify(res));
  const u = await read(`users/${uid}`);
  assert((u.enrolledCourseSlugs || []).includes('1p-clc-leader'), 'legacy access not restored');
});

await env.cleanup();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
