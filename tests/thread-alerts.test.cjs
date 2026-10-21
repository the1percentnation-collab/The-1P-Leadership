// New threads → the bell and the phone.
//
// Pinned here, extracted from the shipped functions/index.js:
//
// 1. Who hears about a new thread (threadAlertShouldNotify): only members who
//    follow the channel, never the author or anyone the post @mentions, and
//    never anyone the post's read rules would hide it from.
// 2. The rolling per-channel row (threadAlertNext): it counts up while
//    unread, and the phone buzzes at most once per throttle window.
// 3. Every community push opens the post: ?channel=…#post-…, the shape
//    community-page.js reads. ?post= alone dropped readers in #general.
// 4. The client's defaults (notify-prefs.js) match the server's.
//
// Run: node tests/thread-alerts.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');

function grab(text, name) {
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
function constLine(text, name) {
  const m = new RegExp(`const ${name} = [^;]+;`).exec(text);
  assert.ok(m, `not found: const ${name}`);
  return m[0];
}

const names = ['clampPreview', 'communityPostUrl', 'channelAlertLevel', 'canReadThread', 'threadAlertShouldNotify', 'threadAlertNext', 'threadAlertCopy'];
// eslint-disable-next-line no-new-func
const server = new Function([
  constLine(src, 'APP_BASE_URL'),
  constLine(src, 'NOTIF_TRUNCATE'),
  constLine(src, 'THREAD_ALERT_THROTTLE_MS'),
  ...names.map((n) => grab(src, n))
].join('\n') + `\nreturn { THREAD_ALERT_THROTTLE_MS, ${names.join(', ')} };`)();

const clientSrc = fs.readFileSync(path.join(root, 'public', 'js', 'notify-prefs.js'), 'utf8');
// eslint-disable-next-line no-new-func
const client = new Function(`${grab(clientSrc, 'channelAlertLevel')}\nreturn { channelAlertLevel };`)();

let passed = 0;
function t(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const post = { authorUid: 'author', companyId: null, mentionedUids: ['tagged'], category: 'wins' };
const following = (extra = {}) => ({ channelAlerts: { wins: 'all', secret: 'all' }, ...extra });
const pub = (u, p = post) => server.threadAlertShouldNotify(u.uid, u, { post: p, isPrivate: false, channelKey: 'wins', memberUids: [] });

console.log('channel defaults');
t('public channels default to mentions only', () => {
  assert.strictEqual(server.channelAlertLevel({}, 'wins', false), 'mentions');
});
t('members of a private channel default to every thread', () => {
  assert.strictEqual(server.channelAlertLevel({}, 'secret', true), 'all');
});
t('an explicit choice wins either way; junk falls back to the default', () => {
  assert.strictEqual(server.channelAlertLevel({ channelAlerts: { wins: 'all' } }, 'wins', false), 'all');
  assert.strictEqual(server.channelAlertLevel({ channelAlerts: { secret: 'mentions' } }, 'secret', true), 'mentions');
  assert.strictEqual(server.channelAlertLevel({ channelAlerts: { wins: 'loud' } }, 'wins', false), 'mentions');
});
t('the client shows the same defaults the server applies', () => {
  for (const [alerts, isPrivate] of [[{}, false], [{}, true], [{ x: 'all' }, false], [{ x: 'mentions' }, true], [{ x: 'nope' }, true]]) {
    assert.strictEqual(
      client.channelAlertLevel({ channelAlerts: alerts }, 'x', isPrivate),
      server.channelAlertLevel({ channelAlerts: alerts }, 'x', isPrivate)
    );
  }
});

console.log('who hears about a new thread');
t('a follower of a public channel does', () => {
  assert.strictEqual(pub({ uid: 'm1', ...following() }), true);
});
t('a member who never followed does not', () => {
  assert.strictEqual(pub({ uid: 'm1' }), false);
});
t('never the author, never someone the post @mentions', () => {
  assert.strictEqual(pub({ uid: 'author', ...following() }), false);
  assert.strictEqual(pub({ uid: 'tagged', ...following() }), false);
});
t('newThreads: false silences every channel', () => {
  assert.strictEqual(pub({ uid: 'm1', ...following({ notifPrefs: { newThreads: false } }) }), false);
});
t('a company post never reaches another company', () => {
  const companyPost = { ...post, companyId: 'acme' };
  assert.strictEqual(pub({ uid: 'm1', companyId: 'acme', ...following() }, companyPost), true);
  assert.strictEqual(pub({ uid: 'm2', companyId: 'globex', ...following() }, companyPost), false);
  assert.strictEqual(pub({ uid: 'm3', ...following() }, companyPost), false);
  assert.strictEqual(pub({ uid: 'm4', role: 'owner', ...following() }, companyPost), true);
});
t('a private channel reaches members by default and never outsiders', () => {
  const ctx = { post, isPrivate: true, channelKey: 'secret', memberUids: ['m1'] };
  assert.strictEqual(server.threadAlertShouldNotify('m1', {}, ctx), true);
  assert.strictEqual(server.threadAlertShouldNotify('m9', following(), ctx), false);
  assert.strictEqual(server.threadAlertShouldNotify('m1', { channelAlerts: { secret: 'mentions' } }, ctx), false);
});
t('staff outside a private channel only hear about it if they follow it', () => {
  const ctx = { post, isPrivate: true, channelKey: 'secret', memberUids: [] };
  assert.strictEqual(server.threadAlertShouldNotify('a1', { role: 'admin' }, ctx), false);
  assert.strictEqual(server.threadAlertShouldNotify('a1', { role: 'admin', ...following() }, ctx), true);
});

console.log('the rolling row and the throttle');
const NOW = Date.parse('2026-10-20T12:00:00Z');
const T = server.THREAD_ALERT_THROTTLE_MS;
t('the first thread opens a fresh row and pushes', () => {
  assert.deepStrictEqual(server.threadAlertNext(null, NOW), { count: 1, push: true, wasUnread: false });
});
t('a read row starts over at one', () => {
  assert.deepStrictEqual(server.threadAlertNext({ read: true, threadCount: 7 }, NOW), { count: 1, push: true, wasUnread: false });
});
t('an unread row counts up and stays quiet inside the window', () => {
  const r = server.threadAlertNext({ read: false, threadCount: 2, pushedAt: { toMillis: () => NOW - 60e3 } }, NOW);
  assert.deepStrictEqual(r, { count: 3, push: false, wasUnread: true });
});
t('once the window passes, the next thread pushes again', () => {
  const r = server.threadAlertNext({ read: false, threadCount: 3, pushedAt: { toMillis: () => NOW - T } }, NOW);
  assert.strictEqual(r.push, true);
  assert.strictEqual(r.count, 4);
});
t('the throttle is a quarter hour', () => {
  assert.strictEqual(T, 15 * 60 * 1000);
});

console.log('copy and links');
t('one thread names who posted where', () => {
  const c = server.threadAlertCopy({ channelName: 'Wins', fromName: 'Dana', preview: 'Closed the deal', count: 1 });
  assert.strictEqual(c.title, 'Dana posted in Wins');
  assert.strictEqual(c.body, 'Closed the deal');
});
t('several threads collapse into a count with the latest preview', () => {
  const c = server.threadAlertCopy({ channelName: 'Wins', fromName: 'Dana', preview: 'Closed the deal', count: 3 });
  assert.strictEqual(c.title, '3 new threads in Wins');
  assert.strictEqual(c.body, 'Latest from Dana: Closed the deal');
});
t('an image-only post still says something', () => {
  assert.ok(server.threadAlertCopy({ channelName: 'Wins', fromName: 'Dana', preview: '', count: 1 }).body);
});
t('push links open the post inside its channel', () => {
  assert.strictEqual(server.communityPostUrl('wins', 'p1'), 'https://the1pnation.com/community.html?channel=wins#post-p1');
  assert.strictEqual(server.communityPostUrl(null, 'p1'), 'https://the1pnation.com/community.html?channel=general#post-p1');
});
t('no community push still links with the ignored ?post= form', () => {
  assert.ok(!src.includes('community.html?post='));
});

console.log('wiring');
t('both post triggers fan out new threads', () => {
  const body = grab(src, 'handlePostCreated');
  assert.match(body, /fanOutNewThread\(db, snap\.id, post, channelKey\)/);
  assert.match(src, /onPrivatePostCreated = onDocumentCreated\(\s*\{ document: 'channels\/\{channelKey\}\/posts\/\{postId\}' \}/);
});
t('the fan-out filters every candidate and claims the row in a transaction', () => {
  assert.match(grab(src, 'fanOutNewThread'), /threadAlertShouldNotify\(/);
  assert.match(grab(src, 'notifyThread'), /runTransaction/);
});
t('the bell knows how to draw a new-thread row', () => {
  const topbar = fs.readFileSync(path.join(root, 'public', 'js', 'topbar.js'), 'utf8');
  assert.match(topbar, /new_thread:/);
  assert.match(topbar, /n\.type === 'new_thread'/);
});
t('opening a channel clears its row', () => {
  const page = fs.readFileSync(path.join(root, 'public', 'js', 'community-page.js'), 'utf8');
  assert.ok((page.match(/clearThreadAlert\(/g) || []).length >= 2);
});

console.log(`\n${passed} passed`);
