// The community digest against the real Firestore emulator.
//
// The shipped sendCommunityDigests (and everything it calls) is extracted
// from functions/index.js and run with the Admin SDK pointed at the emulator,
// a fixed clock, and a mailbox stub in place of the email provider. That
// covers the parts unit tests can't: the createdAt range queries, the
// private-channel subcollections, the CRM opt-out lookup and the
// once-per-day claim.
//
// From the repo root: `npm run e2e:digest` in tests/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(path.join(ROOT, 'functions', 'package.json'));
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-1p' });
const db = admin.firestore();

const src = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error('not found: ' + name);
  const bodyStart = src.indexOf(') {', i) + 2;
  let d = 0;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(src.lastIndexOf('\n', i) + 1, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
const constLine = (name) => new RegExp(`const ${name} = [^;]+;`).exec(src)[0];

const sent = [];
let failSends = false;
// eslint-disable-next-line no-new-func
const sendCommunityDigests = new Function('admin', 'crypto', 'process', 'sendEmail', 'emailConfigured', [
  ...['APP_BASE_URL', 'NOTIF_TRUNCATE', 'DIGEST_TIMEZONE', 'DIGEST_HOUR', 'DIGEST_LOOKBACK_MS', 'DIGEST_MAX_THREADS',
    'FROM_EMAIL', 'FROM_NAME_DEFAULT', 'REPLY_TO'].map(constLine),
  ...['clampPreview', 'communityPostUrl', 'canReadThread', 'commitmentLocalClock', 'isEmailSuppressed', 'digestEligible',
    'digestThreadsFor', 'digestUnsubToken', 'digestUnsubscribeUrl', 'communityDigestMessage', 'loadDigestThreads',
    'sendCommunityDigests'].map(grab)
].join('\n') + '\nreturn sendCommunityDigests;')(
  admin, crypto, { env: { CRM_TICK_SECRET: 'e2e-secret' } },
  async (msg) => {
    if (failSends) throw new Error('Unauthorized');
    sent.push(msg); return { provider: 'stub', messageId: String(sent.length) };
  },
  () => true
);

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const to = (addr) => sent.filter((m) => m.to === addr);

// 2026-10-20 19:00 in New York (EDT, UTC-4): after the 6 PM send time.
const EVENING = new Date('2026-10-20T23:00:00Z');
const AFTERNOON = new Date('2026-10-20T19:00:00Z');
const ago = (h) => admin.firestore.Timestamp.fromMillis(EVENING.getTime() - h * 3600e3);
const post = (extra) => ({ authorUid: 'dana', authorName: 'Dana', text: 'A post', companyId: null, category: 'wins',
  commentCount: 0, likeCount: 0, mentionedUids: [], createdAt: ago(2), ...extra });

const batch = db.batch();
const set = (p, v) => batch.set(db.doc(p), v);
set('channels/wins', { name: 'Wins', visibility: 'public', listed: true, memberUids: [] });
set('channels/secret', { name: 'Inner Circle', visibility: 'private', listed: true, memberUids: ['insider'] });
set('users/dana', { email: 'dana@e2e.test' });
set('users/reader', { email: 'reader@e2e.test' });
set('users/pushy', { email: 'pushy@e2e.test', fcmTokens: ['tok'] });
set('users/off', { email: 'off@e2e.test', notifPrefs: { digest: false } });
set('users/insider', { email: 'insider@e2e.test' });
set('users/acme', { email: 'acme@e2e.test', companyId: 'acme' });
set('users/optedout', { email: 'optedout@e2e.test', crmCompanyId: 'acme', crmContactId: 'c1' });
set('companies/acme/contacts/c1', { emailOptOut: true });
set('posts/today1', post({ text: 'Closed the deal', commentCount: 3 }));
set('posts/today2', post({ text: 'Booked a keynote', createdAt: ago(1) }));
set('posts/stale', post({ text: 'Old news', createdAt: ago(30) }));
set('posts/acmeonly', post({ text: 'Acme only', companyId: 'acme' }));
set('channels/secret/posts/s1', post({ text: 'Members only', category: 'secret' }));
await batch.commit();

await t('nothing goes out before the evening send time', async () => {
  const r = await sendCommunityDigests(db, { now: AFTERNOON });
  assert(r.skipped && !sent.length, JSON.stringify(r));
});

await t('a dry run counts recipients without sending or claiming the day', async () => {
  const r = await sendCommunityDigests(db, { now: EVENING, dryRun: true });
  assert(r.wouldSend === 3 && r.suppressed === 1 && !sent.length, JSON.stringify(r));
  assert(!(await db.doc('users/reader').get()).data().communityDigest, 'a dry run claimed the day');
});

const run = await sendCommunityDigests(db, { now: EVENING });

await t('members without push get today\'s threads, liveliest first', async () => {
  const [m] = to('reader@e2e.test');
  assert(m, 'no digest for reader: ' + JSON.stringify(run));
  assert(m.subject === '2 new threads in the community', m.subject);
  assert(m.html.indexOf('Closed the deal') < m.html.indexOf('Booked a keynote'), 'wrong order');
  assert(!m.html.includes('Old news'), 'a thread older than the lookback was listed');
  assert(m.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', 'no one-click unsubscribe');
});

await t('private and company threads reach only the members who can open them', async () => {
  assert(to('insider@e2e.test')[0].html.includes('Members only'), 'the member missed the private thread');
  assert(!to('reader@e2e.test')[0].html.includes('Members only'), 'a non-member saw a private thread');
  assert(to('acme@e2e.test')[0].html.includes('Acme only'), 'the company member missed their post');
  assert(!to('reader@e2e.test')[0].html.includes('Acme only'), 'another company\'s post leaked');
});

await t('no digest for push users, opt-outs, a CRM unsubscribe, or the author\'s own posts', async () => {
  for (const addr of ['pushy@e2e.test', 'off@e2e.test', 'optedout@e2e.test', 'dana@e2e.test']) {
    assert(!to(addr).length, `${addr} got a digest`);
  }
  assert(run.suppressed === 1, 'suppression not counted: ' + JSON.stringify(run));
  assert(run.sent === 3 && sent.length === 3, JSON.stringify(run));
});

await t('a second tick the same evening sends nothing', async () => {
  const r = await sendCommunityDigests(db, { now: new Date(EVENING.getTime() + 3600e3) });
  assert(sent.length === 3, `sent ${sent.length - 3} duplicate(s): ` + JSON.stringify(r));
  const claim = (await db.doc('users/reader').get()).data().communityDigest;
  assert(claim && claim.date === '2026-10-20', 'no claim recorded');
});

await t('the next evening lists only what is new since the last digest', async () => {
  const next = new Date(EVENING.getTime() + 24 * 3600e3);
  await db.doc('posts/tomorrow').set(post({ text: 'Fresh win', createdAt: admin.firestore.Timestamp.fromMillis(next.getTime() - 3600e3) }));
  await sendCommunityDigests(db, { now: next });
  const mail = to('reader@e2e.test');
  assert(mail.length === 2, `reader got ${mail.length} digests`);
  assert(mail[1].subject === 'Dana posted in Wins' && mail[1].html.includes('Fresh win'), mail[1].subject);
  assert(!mail[1].html.includes('Closed the deal'), 'a thread was sent twice');
});

await t('a failed send gives the day back, and the retry still lists the same threads', async () => {
  const day3 = new Date(EVENING.getTime() + 48 * 3600e3);
  await db.doc('posts/day3').set(post({ text: 'Third day win', createdAt: admin.firestore.Timestamp.fromMillis(day3.getTime() - 3600e3) }));
  const before = (await db.doc('users/reader').get()).data().communityDigest;
  failSends = true;
  const r = await sendCommunityDigests(db, { now: day3 });
  failSends = false;
  assert(r.failed > 0 && r.error === 'Unauthorized', JSON.stringify(r));
  const after = (await db.doc('users/reader').get()).data().communityDigest;
  assert(after.date === before.date && after.sentAt.toMillis() === before.sentAt.toMillis(), 'the failed send kept its claim');
  const retry = await sendCommunityDigests(db, { now: new Date(day3.getTime() + 3600e3) });
  assert(retry.sent > 0 && !retry.failed, JSON.stringify(retry));
  const mail = to('reader@e2e.test');
  assert(mail.length === 3 && mail[2].html.includes('Third day win'), `reader got ${mail.length} digests`);
});

const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
