// The daily community digest, for members without push.
//
// Pinned here, extracted from the shipped functions/index.js:
//
// 1. Who gets one (digestEligible): members with an email and no push
//    device, unless they turned it off.
// 2. What it lists (digestThreadsFor): only threads the member could open,
//    never their own, nothing they were already sent, liveliest first.
// 3. The copy, and an unsubscribe token that is per-member and unforgeable.
// 4. Wiring: the tick runs it, it claims the day before sending, it honors a
//    CRM opt-out, and unsubscribing takes a POST, never a prefetched GET.
//
// Run: node tests/community-digest.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');

function grab(name, text = src) {
  const i = text.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `not found: ${name}`);
  const bodyStart = text.indexOf(') {', i) + 2;
  let d = 0;
  for (let j = bodyStart; j < text.length; j++) {
    if (text[j] === '{') d++;
    else if (text[j] === '}' && --d === 0) return text.slice(i, j + 1);
  }
  throw new Error(`unbalanced: ${name}`);
}
const constLine = (name) => {
  const m = new RegExp(`const ${name} = [^;]+;`).exec(src);
  assert.ok(m, `not found: const ${name}`);
  return m[0];
};

const fns = ['clampPreview', 'communityPostUrl', 'canReadThread', 'digestSinceMs', 'digestEligible', 'digestThreadsFor',
  'digestUnsubToken', 'digestUnsubscribeUrl', 'communityDigestMessage'];
// eslint-disable-next-line no-new-func
const s = new Function('crypto', [
  ...['APP_BASE_URL', 'NOTIF_TRUNCATE', 'DIGEST_MAX_THREADS', 'DIGEST_LOOKBACK_MS'].map(constLine),
  ...fns.map((n) => grab(n))
].join('\n') + `\nreturn { DIGEST_MAX_THREADS, ${fns.join(', ')} };`)(crypto);

let passed = 0;
function t(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const NOW = Date.parse('2026-10-20T23:00:00Z');
const H = 3600e3;
const thread = (id, extra = {}, post = {}) => ({
  id, channelKey: 'wins', channelName: 'Wins', isPrivate: false, memberUids: [], ...extra,
  post: { authorUid: 'dana', authorName: 'Dana', text: `Post ${id}`, companyId: null,
    commentCount: 0, likeCount: 0, createdAt: { toMillis: () => NOW - H }, ...post }
});

console.log('who gets a digest');
t('a member with an email and no push device', () => {
  assert.strictEqual(s.digestEligible({ email: 'a@b.co' }), true);
  assert.strictEqual(s.digestEligible({ email: 'a@b.co', fcmTokens: [] }), true);
});
t('never a member who has push: they already heard in real time', () => {
  assert.strictEqual(s.digestEligible({ email: 'a@b.co', fcmTokens: ['tok'] }), false);
});
t('never a member who turned it off, or one with no address', () => {
  assert.strictEqual(s.digestEligible({ email: 'a@b.co', notifPrefs: { digest: false } }), false);
  assert.strictEqual(s.digestEligible({}), false);
});

console.log('what it lists');
t('drops the member\'s own posts and anything already sent', () => {
  const r = s.digestThreadsFor('dana', {}, [thread('a'), thread('b', {}, { authorUid: 'sam' })], NOW - 24 * H);
  assert.deepStrictEqual(r.top.map((x) => x.id), ['b']);
  const old = s.digestThreadsFor('me', {}, [thread('c', {}, { createdAt: { toMillis: () => NOW - 30 * H } })], NOW - 24 * H);
  assert.strictEqual(old.total, 0);
});
t('never lists what the member could not open', () => {
  const list = [
    thread('acme', {}, { companyId: 'acme' }),
    thread('secret', { isPrivate: true, memberUids: ['in'], channelKey: 'secret', channelName: 'Inner Circle' })
  ];
  assert.deepStrictEqual(s.digestThreadsFor('out', { companyId: 'globex' }, list, 0).top, []);
  assert.deepStrictEqual(s.digestThreadsFor('in', { companyId: 'acme' }, list, 0).top.map((x) => x.id).sort(), ['acme', 'secret']);
});
t('liveliest first, then newest, capped with the full count kept', () => {
  const list = [];
  for (let i = 0; i < 9; i++) list.push(thread(`p${i}`, {}, { createdAt: { toMillis: () => NOW - (i + 1) * 60e3 } }));
  list.push(thread('hot', {}, { commentCount: 4, createdAt: { toMillis: () => NOW - 5 * H } }));
  const r = s.digestThreadsFor('me', {}, list, 0);
  assert.strictEqual(r.total, 10);
  assert.strictEqual(r.top.length, s.DIGEST_MAX_THREADS);
  assert.deepStrictEqual(r.top.map((x) => x.id), ['hot', 'p0', 'p1', 'p2', 'p3', 'p4']);
});

console.log('how far back');
t('a new member gets the last 48 hours, never the community\'s backlog', () => {
  const at = (h) => thread(`h${h}`, {}, { createdAt: { toMillis: () => NOW - h * H } });
  const list = [at(1), at(30), at(47), at(49), at(24 * 30)];
  const r = s.digestThreadsFor('newbie', {}, list, s.digestSinceMs(0, NOW));
  assert.deepStrictEqual(r.top.map((x) => x.id).sort(), ['h1', 'h30', 'h47']);
});
t('after the first digest, only what is new since the last one', () => {
  const at = (h) => thread(`h${h}`, {}, { createdAt: { toMillis: () => NOW - h * H } });
  const r = s.digestThreadsFor('me', {}, [at(2), at(10), at(30)], s.digestSinceMs(NOW - 6 * H, NOW));
  assert.deepStrictEqual(r.top.map((x) => x.id), ['h2']);
  // A member whose last digest was long ago is still capped at 48 hours.
  assert.strictEqual(s.digestSinceMs(NOW - 30 * 24 * H, NOW), NOW - 48 * H);
});
t('the first digest says it covers two days; later ones say since the last update', () => {
  assert.match(s.communityDigestMessage({ total: 2, top: [thread('a'), thread('b')] }, 'https://u', { firstDigest: true }).html, /in the last two days/);
  assert.match(s.communityDigestMessage({ total: 2, top: [thread('a'), thread('b')] }, 'https://u').text, /since your last update/);
});

console.log('copy and unsubscribe');
t('one thread names who posted where', () => {
  const m = s.communityDigestMessage({ total: 1, top: [thread('a')] }, 'https://u');
  assert.strictEqual(m.subject, 'Dana posted in Wins');
  assert.match(m.html, /community\.html\?channel=wins#post-a/);
});
t('several threads lead with the count and say how many are not shown', () => {
  const m = s.communityDigestMessage({ total: 8, top: [thread('a'), thread('b')] }, 'https://u');
  assert.strictEqual(m.subject, '8 new threads in the community');
  assert.match(m.html, /Plus 6 more/);
  assert.match(m.text, /Plus 6 more/);
});
t('post text is escaped in the HTML', () => {
  const m = s.communityDigestMessage({ total: 1, top: [thread('a', {}, { text: '<img src=x onerror=alert(1)>' })] }, 'https://u');
  assert.ok(!m.html.includes('<img src=x'));
});
t('every digest carries its unsubscribe link and a way to turn push on', () => {
  const m = s.communityDigestMessage({ total: 1, top: [thread('a')] }, 'https://the1pnation.com/digest-unsubscribe.html?u=x&amp;t=y');
  assert.match(m.html, /stop the daily digest/);
  assert.match(m.html, /profile\.html#notifications/);
  assert.match(m.text, /Stop the daily digest: /);
});
t('the unsubscribe token is per member and depends on the secret', () => {
  assert.notStrictEqual(s.digestUnsubToken('a', 'k'), s.digestUnsubToken('b', 'k'));
  assert.notStrictEqual(s.digestUnsubToken('a', 'k'), s.digestUnsubToken('a', 'other'));
  assert.strictEqual(s.digestUnsubToken('a', 'k'), s.digestUnsubToken('a', 'k'));
  assert.match(s.digestUnsubscribeUrl('a', 'k'), /^https:\/\/the1pnation\.com\/digest-unsubscribe\.html\?u=a&t=[0-9a-f]{32}$/);
});

console.log('wiring');
t('the tick runs the digest, and a dry run only counts', () => {
  const tick = grab('runTick');
  assert.match(tick, /step\('communityDigest', sendCommunityDigests\(db, \{ dryRun \}\)\)/);
  const body = grab('sendCommunityDigests');
  assert.ok(body.indexOf('if (dryRun)') < body.indexOf('runTransaction'), 'a dry run would claim the day');
});
t('it waits for the evening, honors a CRM opt-out and claims the day before sending', () => {
  const body = grab('sendCommunityDigests');
  assert.match(body, /clock\.minutes < DIGEST_HOUR \* 60/);
  const send = body.indexOf('await sendEmail(');
  assert.ok(body.indexOf('isEmailSuppressed(') < send, 'suppression is checked after sending');
  assert.ok(body.indexOf('runTransaction') < send, 'the day is claimed after sending');
  assert.match(body, /List-Unsubscribe-Post/);
});
t('a failed send gives the day back so the next tick retries', () => {
  const body = grab('sendCommunityDigests');
  const failed = body.slice(body.indexOf('out.failed++'));
  assert.match(failed, /communityDigest: last\.date \? last : admin\.firestore\.FieldValue\.delete\(\)/);
});
t('unsubscribing is POST-only and checks the token in constant time', () => {
  const i = src.indexOf('exports.digestUnsubscribe');
  const fn = src.slice(i, src.indexOf('\n});', i));
  assert.match(fn, /req\.method !== 'POST'/);
  assert.match(fn, /timingSafeEqualStr\(token, digestUnsubToken\(uid, secret\)\)/);
  assert.match(fn, /notifPrefs: \{ digest: false \}/);
  const page = fs.readFileSync(path.join(root, 'public', 'digest-unsubscribe.html'), 'utf8');
  assert.match(page, /method: 'POST'/);
});
t('the hosting rewrite routes the API path to the function', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  const r = cfg.hosting.rewrites.find((x) => x.source === '/api/digest-unsubscribe');
  assert.ok(r && r.function && r.function.functionId === 'digestUnsubscribe');
});
t('members can turn the digest off in their settings', () => {
  const prefs = fs.readFileSync(path.join(root, 'public', 'js', 'notify-prefs.js'), 'utf8');
  assert.match(prefs, /key: 'digest'/);
});

console.log(`\n${passed} passed`);
