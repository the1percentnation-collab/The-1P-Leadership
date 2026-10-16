// Drive sync: where each repo file lands in Drive, and what gets uploaded.
//
// Run: node tests/drive-sync.test.mjs
import assert from 'node:assert';
import {
  driveTarget, planSync, isIgnored, keyFor, hasDriveScope, DRIVE_ROOT_NAME
} from '../scripts/drive-sync-core.mjs';

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

console.log('drive sync — targets');

ok('folders mirror the repo path under social/', () => {
  const t = driveTarget('social/2026-10 Membership Launch/Instagram Stories (1080x1920)/Story 01 - Founding rate.png');
  assert.deepStrictEqual(t.folders, ['2026-10 Membership Launch', 'Instagram Stories (1080x1920)']);
  assert.strictEqual(t.name, 'Story 01 - Founding rate.png');
  assert.strictEqual(t.uploadMime, 'image/png');
  assert.strictEqual(t.googleMime, null);
});

ok('.gsheet.csv becomes a Google Sheet and .gdoc.html a Google Doc, suffix dropped', () => {
  const s = driveTarget('social/Launch/Posting Schedule.gsheet.csv');
  assert.strictEqual(s.name, 'Posting Schedule');
  assert.strictEqual(s.googleMime, 'application/vnd.google-apps.spreadsheet');
  assert.strictEqual(s.uploadMime, 'text/csv');
  const d = driveTarget('social/Launch/Captions.gdoc.html');
  assert.strictEqual(d.name, 'Captions');
  assert.strictEqual(d.googleMime, 'application/vnd.google-apps.document');
});

ok('anything outside social/ is refused', () => {
  assert.throws(() => driveTarget('public/index.html'));
  assert.throws(() => driveTarget('social'));
});

ok('dotfiles, OS debris, and the README are ignored', () => {
  assert.ok(isIgnored('social/.DS_Store'));
  assert.ok(isIgnored('social/Launch/.hidden/x.png'));
  assert.ok(isIgnored('social/Launch/Thumbs.db'));
  assert.ok(!isIgnored('social/Launch/01.png'));
  assert.ok(isIgnored('social/README.md'));
});

console.log('drive sync — plan');

ok('new files are created, changed files updated in place, unchanged skipped', () => {
  const plan = planSync(
    [{ path: 'social/a/2.png', md5: 'new' }, { path: 'social/a/1.png', md5: 'same' }, { path: 'social/a/3.png', md5: 'x' }, { path: 'social/.DS_Store', md5: 'z' }],
    { 'social/a/1.png': { md5: 'same', fileId: 'f1' }, 'social/a/2.png': { md5: 'old', fileId: 'f2' } }
  );
  assert.deepStrictEqual(plan, [
    { path: 'social/a/1.png', action: 'skip', fileId: 'f1' },
    { path: 'social/a/2.png', action: 'update', fileId: 'f2' },
    { path: 'social/a/3.png', action: 'create' }
  ]);
});

ok('a manifest entry without a Drive id is uploaded again', () => {
  assert.deepStrictEqual(planSync([{ path: 'social/x.png', md5: 'm' }], { 'social/x.png': { md5: 'm' } }), [{ path: 'social/x.png', action: 'create' }]);
});

console.log('drive sync — keys and scope');

ok('keys are stable, slash-free, and distinct per path', () => {
  const a = keyFor('social/a/b.png');
  assert.strictEqual(a, keyFor('social/a/b.png'));
  assert.ok(!a.includes('/'));
  assert.notStrictEqual(a, keyFor('social/a/c.png'));
  assert.ok(!keyFor(DRIVE_ROOT_NAME).includes('/'));
});

ok('only the drive.file scope turns the sync on', () => {
  assert.ok(hasDriveScope('openid https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file email'));
  assert.ok(!hasDriveScope('openid https://www.googleapis.com/auth/calendar.events email'));
  assert.ok(!hasDriveScope(null));
});

console.log(`\n${passed} passed`);
