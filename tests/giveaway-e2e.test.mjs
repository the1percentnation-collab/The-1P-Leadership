// Instagram giveaways, end to end on the real emulators: the shipped
// giveawayAdmin callable runs in the Functions emulator against a stub
// Instagram Graph API served from this process (INSTAGRAM_GRAPH_BASE, set by
// run-e2e.sh), and the test checks what lands in Firestore.
//
//   - Only an admin of the company can use it.
//   - A token Instagram rejects is refused; a good one is stored where no
//     browser can read it, and never echoed back.
//   - Sync pages through every comment and reply, and the tally follows the
//     rules: one entry per commenter, one per unique friend tagged, capped.
//   - A deleted comment drops its entrant on the next sync.
//   - The draw records winners, never repeats one, and stops when the pool
//     is empty.
//   - An expired token reports as a reconnect, not a crash.
//
// From tests/: `npm run e2e:giveaway` (writes fake secrets and removes them).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PROJECT = 'demo-1p';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const IG_PORT = 8767;
const IG = `http://127.0.0.1:${IG_PORT}/v23.0`;
const GOOD_TOKEN = 'IGAA-e2e-good-token';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Stub Instagram ────────────────────────────────────────────────────────
// Two pages of top-level comments; the first comment's replies spill onto a
// page of their own, the way the Graph API nests them.
const ig = {
  expired: false,
  requests: [],
  page1: [
    { id: 'c1', text: 'In! @anna @mike', timestamp: '2026-10-01T10:00:00+0000', username: 'jo',
      replies: {
        data: [{ id: 'r1', text: 'me too @anna', timestamp: '2026-10-01T10:05:00+0000', username: 'amy' }],
        paging: { next: `${IG}/c1/replies?page=2&access_token=${GOOD_TOKEN}` }
      } },
    { id: 'c2', text: 'Good luck everyone @jo', timestamp: '2026-10-01T10:06:00+0000', username: 'the1pnation' },
    { id: 'c3', text: '@jo @a1 @a2 @a3 @a4 @a5 @a6', timestamp: '2026-10-01T10:07:00+0000', username: 'sam' }
  ],
  replies2: [
    { id: 'r2', text: '@bff', timestamp: '2026-10-01T10:08:00+0000', from: { id: '42', username: 'kim' } }
  ],
  page2: [
    { id: 'c4', text: 'again @anna @sara', timestamp: '2026-10-01T11:00:00+0000', username: 'jo' },
    { id: 'c5', text: 'me', timestamp: '2026-10-01T11:01:00+0000', username: 'lee' }
  ]
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${IG_PORT}`);
  ig.requests.push(u.pathname + u.search);
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const token = u.searchParams.get('access_token');
  if (ig.expired || token !== GOOD_TOKEN) {
    return send(400, { error: { message: 'Error validating access token: Session has expired.', type: 'OAuthException', code: 190 } });
  }
  const p = u.pathname.replace(/^\/v23\.0/, '');
  if (p === '/me') return send(200, { user_id: '1784', username: 'the1pnation' });
  if (p === '/me/media') {
    return send(200, { data: [
      { id: '9001', caption: 'GIVEAWAY: comment and tag a friend', permalink: 'https://www.instagram.com/p/xyz/',
        timestamp: '2026-10-01T09:00:00+0000', comments_count: 7, like_count: 50, media_type: 'IMAGE', media_url: 'https://cdn.example/1.jpg' }
    ] });
  }
  if (p === '/9001/comments') {
    if (u.searchParams.get('page') === '2') return send(200, { data: ig.page2 });
    return send(200, { data: ig.page1, paging: { next: `${IG}/9001/comments?page=2&access_token=${GOOD_TOKEN}` } });
  }
  if (p === '/c1/replies') return send(200, { data: ig.replies2 });
  send(404, { error: { message: 'Unknown path ' + p, code: 100 } });
});
await new Promise((r) => server.listen(IG_PORT, '127.0.0.1', r));

// ── Emulators ─────────────────────────────────────────────────────────────
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${FN}/runAutomationTick`, { method: 'POST' });
    if (r.status === 403 || r.status === 503) break;
  } catch (e) { /* not up yet */ }
  await sleep(1000);
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
});
const asAdmin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); }); return out; };
const read = (p) => asAdmin(async (db) => { const s = await getDoc(doc(db, p)); return s.exists() ? s.data() : null; });
const list = (p) => asAdmin(async (db) => (await getDocs(collection(db, p))).docs.map((d) => ({ id: d.id, ...d.data() })));

async function signUp(email) {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'e2e-pass-123', returnSecureToken: true })
  });
  const j = await r.json();
  return { uid: j.localId, token: j.idToken };
}
async function call(idToken, data) {
  const r = await fetch(`${FN}/giveawayAdmin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: { companyId: 'acme', ...data } })
  });
  return r.json();
}

const boss = await signUp('boss@e2e.test');
const outsider = await signUp('outsider@e2e.test');
await asAdmin(async (db) => {
  await setDoc(doc(db, 'companies/acme'), { name: 'Acme', adminUids: [boss.uid] });
  await setDoc(doc(db, `users/${boss.uid}`), { email: 'boss@e2e.test', role: 'admin', companyId: 'acme' });
  await setDoc(doc(db, `users/${outsider.uid}`), { email: 'outsider@e2e.test', role: 'user' });
});
const B = (data) => call(boss.token, data);

await t('someone who is not an admin of the company is refused', async () => {
  const r = await call(outsider.token, { action: 'status' });
  assert(r.error && r.error.status === 'PERMISSION_DENIED', JSON.stringify(r));
});

await t('status starts disconnected', async () => {
  const r = await B({ action: 'status' });
  assert(r.result && r.result.connected === false, JSON.stringify(r));
});

await t('a token Instagram rejects is refused and not stored', async () => {
  const r = await B({ action: 'connect', token: 'IGAA-wrong' });
  assert(r.error && r.error.status === 'INVALID_ARGUMENT', JSON.stringify(r));
  assert(!(await read('companies/acme/private/instagram')), 'a bad token was stored');
});

await t('a good token connects, is stored privately, and is never echoed back', async () => {
  const r = await B({ action: 'connect', token: GOOD_TOKEN });
  assert(r.result && r.result.connected && r.result.username === 'the1pnation', JSON.stringify(r));
  assert(!JSON.stringify(r).includes(GOOD_TOKEN), 'token echoed in the connect response');
  const stored = await read('companies/acme/private/instagram');
  assert(stored && stored.token === GOOD_TOKEN && stored.username === 'the1pnation', JSON.stringify(stored));
  const s = await B({ action: 'status' });
  assert(s.result.connected && !JSON.stringify(s).includes(GOOD_TOKEN), 'token echoed in status');
});

await t('an admin\'s browser cannot read the stored token', async () => {
  const db = env.authenticatedContext(boss.uid).firestore();
  await assertFails(getDoc(doc(db, 'companies/acme/private/instagram')));
});

await t('recent posts are listed for picking', async () => {
  const r = await B({ action: 'posts' });
  assert(r.result && r.result.posts.length === 1, JSON.stringify(r));
  const p = r.result.posts[0];
  assert(p.id === '9001' && p.commentsCount === 7 && p.thumbnailUrl === 'https://cdn.example/1.jpg', JSON.stringify(p));
});

let gid;
await t('a giveaway saves with its rules normalized', async () => {
  const r = await B({ action: 'save', name: 'October books', mediaId: '9001', caption: 'GIVEAWAY',
    rules: { maxTaggedFriends: 5, excludeHandles: '@Lee' } });
  assert(r.result && r.result.id, JSON.stringify(r));
  gid = r.result.id;
  const g = await read(`companies/acme/giveaways/${gid}`);
  assert(g.rules.entriesPerTag === 1 && g.rules.excludeHandles[0] === 'lee', JSON.stringify(g.rules));
});

await t('a browser cannot read giveaways directly (all access goes through the callable)', async () => {
  const db = env.authenticatedContext(boss.uid).firestore();
  await assertFails(getDoc(doc(db, `companies/acme/giveaways/${gid}`)));
});

await t('sync reads every page of comments and replies and tallies by the rules', async () => {
  const r = await B({ action: 'sync', giveawayId: gid });
  assert(r.result, JSON.stringify(r));
  // 5 top-level + 2 replies = 7 comments. The host's comment and lee's
  // (excluded) are not counted.
  assert(r.result.totals.comments === 7, 'comments: ' + JSON.stringify(r.result));
  assert(r.result.skipped.host === 1 && r.result.skipped.excluded === 1, JSON.stringify(r.result.skipped));
  assert(ig.requests.some((q) => q.startsWith('/v23.0/c1/replies')), 'reply page never fetched');
  assert(ig.requests.some((q) => q.includes('page=2') && q.startsWith('/v23.0/9001/comments')), 'second comment page never fetched');

  const es = Object.fromEntries((await list(`companies/acme/giveaways/${gid}/entrants`)).map((e) => [e.handle, e]));
  // jo: 1 + anna, mike, sara (anna twice counts once) = 4
  assert(es.jo && es.jo.entries === 4 && es.jo.commentCount === 2, 'jo: ' + JSON.stringify(es.jo));
  // amy (reply): 1 + anna = 2
  assert(es.amy && es.amy.entries === 2, 'amy: ' + JSON.stringify(es.amy));
  // kim (reply on the second reply page, handle from `from`): 1 + bff = 2
  assert(es.kim && es.kim.entries === 2 && es.kim.userId === '42', 'kim: ' + JSON.stringify(es.kim));
  // sam tagged 7 friends: capped at 5 → 6
  assert(es.sam && es.sam.entries === 6 && es.sam.tags.length === 7, 'sam: ' + JSON.stringify(es.sam));
  assert(!es.the1pnation && !es.lee, 'host or excluded handle entered');
  const g = await read(`companies/acme/giveaways/${gid}`);
  assert(g.totals.entries === 14 && g.totals.eligibleEntrants === 4 && g.lastSyncedAt, JSON.stringify(g.totals));
});

await t('get returns the ranked leaderboard', async () => {
  const r = await B({ action: 'get', giveawayId: gid });
  const order = r.result.entrants.map((e) => e.handle);
  assert(order.join(',') === 'sam,jo,amy,kim', order.join(','));
  assert(r.result.giveaway.lastSyncedAt && typeof r.result.giveaway.lastSyncedAt === 'string', 'timestamps not serialized');
});

await t('a deleted comment drops its entrant on the next sync', async () => {
  ig.replies2 = [];
  const r = await B({ action: 'sync', giveawayId: gid });
  assert(r.result && r.result.totals.eligibleEntrants === 3, JSON.stringify(r));
  const es = await list(`companies/acme/giveaways/${gid}/entrants`);
  assert(!es.some((e) => e.handle === 'kim'), 'kim is still listed');
});

await t('draws record winners and never repeat one', async () => {
  const drawn = [];
  for (let i = 0; i < 3; i++) {
    const r = await B({ action: 'draw', giveawayId: gid });
    assert(r.result && r.result.winners.length === 1, JSON.stringify(r));
    drawn.push(r.result.winners[0].handle);
  }
  assert(new Set(drawn).size === 3, 'a winner repeated: ' + drawn.join(','));
  const g = await read(`companies/acme/giveaways/${gid}`);
  assert(g.winners.length === 3 && g.winners[0].alternate === false && g.winners[1].alternate === true, JSON.stringify(g.winners));
  assert(g.winners[0].poolEntries === 12 && g.winners[0].poolEntrants === 3, JSON.stringify(g.winners[0]));
  const again = await B({ action: 'draw', giveawayId: gid });
  assert(again.error && again.error.status === 'FAILED_PRECONDITION', 'drew from an empty pool: ' + JSON.stringify(again));
});

await t('the post cannot be swapped out from under a finished draw', async () => {
  const r = await B({ action: 'save', giveawayId: gid, name: 'x', mediaId: '9002' });
  assert(r.error && r.error.status === 'FAILED_PRECONDITION', JSON.stringify(r));
});

await t('an expired token asks for a reconnect instead of failing blindly', async () => {
  ig.expired = true;
  const r = await B({ action: 'sync', giveawayId: gid });
  assert(r.error && r.error.status === 'FAILED_PRECONDITION' && /expired/i.test(r.error.message), JSON.stringify(r));
  ig.expired = false;
});

await t('disconnect removes the stored token', async () => {
  await B({ action: 'disconnect' });
  assert(!(await read('companies/acme/private/instagram')), 'token still stored');
});

await env.cleanup();
server.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
