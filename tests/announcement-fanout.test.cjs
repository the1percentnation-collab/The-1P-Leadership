// Announcements → the bell, and the legacy CLC migration guard.
//
// Two rules pinned here, both extracted from the shipped functions/index.js:
//
// 1. announcementIsLive / announcementTargets decide who a published
//    announcement notifies. The audience semantics must match the dashboard
//    spotlight (announcements.js isVisibleTo) exactly, or the bell rings for
//    someone the dashboard would hide the update from.
//
// 2. isLegacyClcProgressId is what keeps enrollFree's legacy migration from
//    handing the paid Leader Coach course to anyone with progress in ANY
//    course: only the old CLC player's bare ids ('0'…'6') count; every
//    Firestore-authored course namespaces its docs as `{slug}__m{id}`.
//
// Run: node tests/announcement-fanout.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

function extract(startMarker, endMarker, returns) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  assert.ok(start > 0 && end > start, `could not locate ${startMarker} in functions/index.js`);
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(start, end)}\nreturn { ${returns} };`)();
}

const {
  announcementMillis, announcementIsLive, announcementShouldNotify, announcementTargets
} = extract(
  'function announcementMillis',
  'async function fanOutAnnouncement',
  'announcementMillis, announcementIsLive, announcementShouldNotify, announcementTargets'
);
const { isLegacyClcProgressId } = extract(
  'function isLegacyClcProgressId',
  '// enrollFree — server-side enrollment',
  'isLegacyClcProgressId'
);

let passed = 0;
function t(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const NOW = Date.parse('2026-09-24T12:00:00Z');
const past = new Date(NOW - 3600e3);
const future = new Date(NOW + 3600e3);

console.log('the publish window');
t('an active, undated announcement is live', () => {
  assert.strictEqual(announcementIsLive({ active: true }, NOW), true);
});
t('active defaults to true, matching the dashboard', () => {
  assert.strictEqual(announcementIsLive({}, NOW), true);
});
t('an inactive announcement is never live', () => {
  assert.strictEqual(announcementIsLive({ active: false }, NOW), false);
});
t('a scheduled announcement waits for its publish time', () => {
  assert.strictEqual(announcementIsLive({ active: true, publishAt: future }, NOW), false);
  assert.strictEqual(announcementIsLive({ active: true, publishAt: past }, NOW), true);
});
t('an expired announcement is done', () => {
  assert.strictEqual(announcementIsLive({ active: true, expiresAt: past }, NOW), false);
});
t('timestamps arrive as Firestore Timestamps, Dates or strings', () => {
  assert.strictEqual(announcementMillis({ toMillis: () => 42 }), 42);
  assert.strictEqual(announcementMillis(new Date(42)), 42);
  assert.strictEqual(announcementMillis('2026-09-24T12:00:00Z'), NOW);
  assert.strictEqual(announcementMillis('not a date'), null);
  assert.strictEqual(announcementMillis(null), null);
});

console.log('when the bell rings');
const hoursAgo = (h) => new Date(NOW - h * 3600e3);
t('a freshly published announcement notifies', () => {
  assert.strictEqual(announcementShouldNotify({ active: true, createdAt: hoursAgo(0.01) }, NOW), true);
});
t('a scheduled one notifies once its publish time arrives, not before', () => {
  assert.strictEqual(announcementShouldNotify({ active: true, createdAt: hoursAgo(200), publishAt: future }, NOW), false);
  assert.strictEqual(announcementShouldNotify({ active: true, createdAt: hoursAgo(200), publishAt: hoursAgo(2) }, NOW), true);
});
t('a scheduled one still notifies if the tick is slow by a day', () => {
  assert.strictEqual(announcementShouldNotify({ active: true, publishAt: hoursAgo(26) }, NOW), true);
});
t('announcements live before this shipped do not buzz everyone on deploy', () => {
  assert.strictEqual(announcementShouldNotify({ active: true, createdAt: hoursAgo(24 * 30) }, NOW), false);
  assert.strictEqual(announcementShouldNotify({ active: true, publishAt: hoursAgo(73) }, NOW), false);
});
t('with no timestamp at all it stays quiet rather than guess', () => {
  assert.strictEqual(announcementShouldNotify({ active: true }, NOW), false);
});
t('an announcement already fanned out never notifies again', () => {
  assert.strictEqual(announcementShouldNotify({ active: true, createdAt: hoursAgo(1), notifiedAt: hoursAgo(1) }, NOW), false);
});
t('a draft never notifies', () => {
  assert.strictEqual(announcementShouldNotify({ active: false, createdAt: hoursAgo(1) }, NOW), false);
});

const members = [
  { uid: 'owner1', role: 'owner', companyId: 'acme', enrolledCourseSlugs: ['icant'] },
  { uid: 'admin1', role: 'admin', companyId: null, enrolledCourseSlugs: [] },
  { uid: 'beta1', role: 'user', companyId: null, enrolledCourseSlugs: ['icant', 'bundle-icant'] },
  { uid: 'clc1', role: 'user', companyId: 'acme', enrolledCourseSlugs: ['1p-clc-leader'] },
  { uid: 'fresh1', role: 'user', companyId: null, enrolledCourseSlugs: [] }
];

console.log('who an audience reaches');
t("'all' reaches every member", () => {
  assert.deepStrictEqual(announcementTargets({ audience: 'all' }, members),
    ['owner1', 'admin1', 'beta1', 'clc1', 'fresh1']);
});
t('an unknown audience falls back to everyone, like the dashboard', () => {
  assert.deepStrictEqual(announcementTargets({ audience: 'weird' }, members).length, 5);
});
t("'enrolled' without a course means anyone with at least one course", () => {
  assert.deepStrictEqual(announcementTargets({ audience: 'enrolled' }, members),
    ['owner1', 'beta1', 'clc1']);
});
t("'enrolled' scoped to a course reaches only its members", () => {
  assert.deepStrictEqual(announcementTargets({ audience: 'enrolled', courseSlug: 'icant' }, members),
    ['owner1', 'beta1']);
});
t("'company' reaches one company's members and nobody when unset", () => {
  assert.deepStrictEqual(announcementTargets({ audience: 'company', companyId: 'acme' }, members),
    ['owner1', 'clc1']);
  assert.deepStrictEqual(announcementTargets({ audience: 'company' }, members), []);
});
t("'admin' reaches owner and admin roles only", () => {
  assert.deepStrictEqual(announcementTargets({ audience: 'admin' }, members),
    ['owner1', 'admin1']);
});
t('a member row without a uid is skipped, not crashed on', () => {
  assert.deepStrictEqual(announcementTargets({ audience: 'all' }, [{ role: 'user' }, null]), []);
});

console.log('the legacy CLC migration guard');
t('the old CLC player\'s bare ids count as legacy progress', () => {
  ['0', '3', '6'].forEach((id) => assert.strictEqual(isLegacyClcProgressId(id), true, id));
});
t('namespaced docs from other courses never trigger the migration', () => {
  ['icant__m0', 'icant__m10', '1p-clc-leader__m2', 'bundle-icant__m1']
    .forEach((id) => assert.strictEqual(isLegacyClcProgressId(id), false, id));
});

console.log(`\n${passed} assertions passed.`);
