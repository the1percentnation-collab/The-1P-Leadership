// New-thread alerts, end to end on the real emulators: the shipped
// onPostCreated / onPrivatePostCreated triggers run in the Functions
// emulator, and the test checks whose bell rings.
//
//   - A public post reaches the members who follow its channel, and nobody
//     else: not the author, not someone it @mentions (they get the mention),
//     not a member who turned thread alerts off.
//   - A company post never reaches another company's follower.
//   - A second post rolls into the same row and counts up, without a second
//     unread or a second push inside the throttle window.
//   - A private channel reaches its members by default, honors a member who
//     chose mentions only, and never reaches staff who aren't in it.
//   - Members can write their own alert settings and nobody else's.
//
// From the repo root: `npm run e2e:thread` in tests/ (writes fake secrets and
// removes them afterwards).
import fs from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${FN}/runAutomationTick`, { method: 'POST' });
    if (r.status === 403 || r.status === 503) break;
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

const follow = { channelAlerts: { wins: 'all' } };
await admin(async (db) => {
  await setDoc(doc(db, 'channels/wins'), { name: 'Wins', emoji: '🏆', order: 1, visibility: 'public', listed: true, memberUids: [] });
  await setDoc(doc(db, 'channels/secret'), { name: 'Inner Circle', emoji: '🔒', order: 5, visibility: 'private', listed: true, memberUids: ['author', 'inner1', 'inner2'] });
  await setDoc(doc(db, 'users/author'), { role: 'user', companyId: null, displayName: 'Dana' });
  await setDoc(doc(db, 'users/fan'), { role: 'user', companyId: null, ...follow });
  await setDoc(doc(db, 'users/lurker'), { role: 'user', companyId: null });
  await setDoc(doc(db, 'users/tagged'), { role: 'user', companyId: null, ...follow });
  await setDoc(doc(db, 'users/quiet'), { role: 'user', companyId: null, ...follow, notifPrefs: { newThreads: false } });
  await setDoc(doc(db, 'users/acmefan'), { role: 'user', companyId: 'acme', ...follow });
  await setDoc(doc(db, 'users/globexfan'), { role: 'user', companyId: 'globex', ...follow });
  await setDoc(doc(db, 'users/inner1'), { role: 'user', companyId: null });
  await setDoc(doc(db, 'users/inner2'), { role: 'user', companyId: null, channelAlerts: { secret: 'mentions' } });
  await setDoc(doc(db, 'users/staff'), { role: 'admin', companyId: null });
});

const post = (text, extra = {}) => ({
  authorUid: 'author', authorName: 'Dana', authorAvatar: null, text, imageUrl: null,
  likeCount: 0, commentCount: 0, companyId: null, category: 'wins', pinned: false,
  mentionedUids: [], createdAt: new Date(), updatedAt: new Date(), ...extra
});

// ── Public channel ────────────────────────────────────────────────────────
await t('a new thread rings the bell of a member who follows the channel', async () => {
  await admin((db) => setDoc(doc(db, 'posts/p1'), post('Closed the deal', { mentionedUids: ['tagged'] })));
  const n = await eventually(async () => (await bell('fan')).find((x) => x.id === 'thread_wins'));
  assert(n, 'the follower\'s bell never rang');
  assert(n.type === 'new_thread' && n.postId === 'p1' && n.category === 'wins', 'wrong row: ' + JSON.stringify(n));
  assert(n.channelName === 'Wins' && n.threadCount === 1 && n.read === false, 'wrong row: ' + JSON.stringify(n));
  assert(n.pushedAt, 'the first thread should claim a push');
  const u = await read('users/fan');
  assert(u.unreadNotifCount === 1, 'badge count is ' + u.unreadNotifCount);
});

await t('...and skips the author, non-followers and anyone who turned threads off', async () => {
  await sleep(1500);
  for (const uid of ['author', 'lurker', 'quiet']) {
    assert(!(await bell(uid)).some((x) => x.type === 'new_thread'), `${uid} got a thread alert`);
  }
});

await t('...and a mentioned follower gets the mention, not a duplicate thread alert', async () => {
  const rows = await eventually(async () => {
    const r = await bell('tagged');
    return r.some((x) => x.type === 'mention') ? r : null;
  });
  assert(rows, 'the mention never arrived');
  assert(!rows.some((x) => x.type === 'new_thread'), 'mentioned member was double-notified');
});

await t('a second thread rolls into the same row without a second unread or push', async () => {
  const first = (await bell('fan')).find((x) => x.id === 'thread_wins');
  await admin((db) => setDoc(doc(db, 'posts/p2'), post('Booked three calls today')));
  const n = await eventually(async () => {
    const r = (await bell('fan')).find((x) => x.id === 'thread_wins');
    return r && r.threadCount === 2 ? r : null;
  });
  assert(n, 'the row never counted up');
  assert(n.postId === 'p2', 'row should point at the latest post');
  assert(n.pushedAt.toMillis() === first.pushedAt.toMillis(), 'pushed again inside the throttle window');
  assert((await bell('fan')).filter((x) => x.type === 'new_thread').length === 1, 'a second row appeared');
  assert((await read('users/fan')).unreadNotifCount === 1, 'the badge double-counted');
});

await t('a read row starts fresh on the next thread', async () => {
  await admin((db) => setDoc(doc(db, 'users/fan/notifications/thread_wins'), { read: true }, { merge: true }));
  await admin((db) => setDoc(doc(db, 'posts/p3'), post('New personal best')));
  const n = await eventually(async () => {
    const r = (await bell('fan')).find((x) => x.id === 'thread_wins');
    return r && r.read === false && r.postId === 'p3' ? r : null;
  });
  assert(n && n.threadCount === 1, 'row did not restart: ' + JSON.stringify(n));
});

await t('a company post reaches its own company and never another', async () => {
  await admin((db) => setDoc(doc(db, 'posts/acme1'), post('Acme only', { companyId: 'acme' })));
  const n = await eventually(async () => (await bell('acmefan')).find((x) => x.postId === 'acme1'));
  assert(n, 'the acme follower never heard');
  await sleep(1500);
  assert(!(await bell('globexfan')).some((x) => x.postId === 'acme1'), 'another company was notified');
});

// ── Private channel ───────────────────────────────────────────────────────
await t('a private channel reaches its members by default', async () => {
  await admin((db) => setDoc(doc(db, 'channels/secret/posts/s1'), post('Members only', { category: 'secret' })));
  const n = await eventually(async () => (await bell('inner1')).find((x) => x.id === 'thread_secret'));
  assert(n && n.channelName === 'Inner Circle' && n.postId === 's1', 'member missed it: ' + JSON.stringify(n));
});

await t('...honors a member who chose mentions only, and skips staff outside it', async () => {
  await sleep(1500);
  assert(!(await bell('inner2')).some((x) => x.id === 'thread_secret'), 'mentions-only member was notified');
  assert(!(await bell('staff')).some((x) => x.id === 'thread_secret'), 'non-member staff were notified');
  assert(!(await bell('fan')).some((x) => x.id === 'thread_secret'), 'a non-member was notified');
});

// ── Settings are the member's own ─────────────────────────────────────────
await t('a member can save their own alert settings and nobody else\'s', async () => {
  const mine = env.authenticatedContext('lurker').firestore();
  await assertSucceeds(setDoc(doc(mine, 'users/lurker'), {
    channelAlerts: { wins: 'all' }, notifPrefs: { courseReminders: false }
  }, { merge: true }));
  await assertFails(setDoc(doc(mine, 'users/fan'), { channelAlerts: { wins: 'mentions' } }, { merge: true }));
});

await env.cleanup();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
