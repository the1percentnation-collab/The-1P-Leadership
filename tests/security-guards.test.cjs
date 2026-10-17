// Security fixes carried over from the July 2026 audit (unmerged PR #60),
// pinned at the source so a refactor cannot quietly undo one. Each of these
// was found still open on main in October 2026. The storage-rules suite
// covers the course-file gate on the emulator; these cover the rest.
//
// Run: node tests/security-guards.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fn = read('functions/index.js');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}
function block(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, 'could not find ' + start);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b > a ? b : undefined);
}

console.log('security guards');

ok('avatar URLs are escaped before they reach an <img> (stored XSS)', () => {
  for (const f of ['public/js/community.js', 'public/js/topbar.js']) {
    const s = read(f);
    assert.ok(!/<img src="\$\{src\}"/.test(s), `${f} renders an unescaped avatar URL`);
    assert.ok(/<img src="\$\{escapeHtml\(src\)\}"/.test(s), `${f} lost its escaped avatar`);
  }
});

ok('deleting an account cancels its subscriptions before deleting anything', () => {
  const b = block(fn, 'exports.deleteMyAccount', 'exports.requestDataExport');
  const cancel = b.indexOf('cancelSubscriptionsForUser(');
  const wipe = b.indexOf('USER_SUBCOLLECTIONS');
  assert.ok(cancel > 0 && wipe > cancel, 'subscriptions are not canceled before the data is wiped');
  assert.ok(/stripe\.subscriptions\.cancel\(/.test(fn), 'nothing cancels a Stripe subscription');
});

ok('public and search callables are rate-limited', () => {
  for (const name of ['registerForEvent', 'registerProductInterest', 'joinEarlyAccess', 'searchMembers', 'searchPosts', 'shareEventToContacts']) {
    const b = block(fn, `exports.${name} =`, '\nexports.');
    assert.ok(new RegExp(`rateLimitCaller\\([\\s\\S]{0,120}?action: '${name}'`).test(b), `${name} has no rate limit`);
  }
});

ok('member-facing names never fall back to an email address', () => {
  assert.ok(!/displayName: u\.displayName \|\| u\.email/.test(fn), 'a member list shows emails as names again');
});

console.log(`\n${passed} passed`);
