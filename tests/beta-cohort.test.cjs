// The beta cohort record — the thing that made a beta console possible.
//
// Before it, an application was a CRM lead, access was a hand-typed grant and
// feedback was a generic bug report, with nothing joining the three. These
// assertions pin the one rule that keeps the joined record honest: the status
// ladder only moves forward, so a late signal (a second application, a stray
// activation) can never demote someone who has already progressed.
//
// Extracted from the shipped functions/index.js so the ladder asserted here is
// the ladder that runs.
//
// Run: node tests/beta-cohort.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const start = src.indexOf('const BETA_DEFAULT_SLUG');
const end = src.indexOf('// listBetaTesters —');
assert.ok(start > 0 && end > start, 'could not locate the beta helpers in functions/index.js');
const code = src.slice(start, end);

// ── Fakes ────────────────────────────────────────────────────────────────
// Just enough Firestore to run the helpers: a doc store keyed by path, the
// three FieldValue sentinels these helpers use, and a progress subcollection.

const SENTINEL_TS = '<<serverTimestamp>>';
function increment(n) { return { __inc: n }; }

function makeDb(seed) {
  const docs = new Map(Object.entries(seed || {}));
  const progress = new Map();

  function resolve(target, patch) {
    const out = { ...(target || {}) };
    Object.entries(patch).forEach(([k, v]) => {
      if (v === SENTINEL_TS) out[k] = SENTINEL_TS;
      else if (v && v.__inc != null) out[k] = (Number(out[k]) || 0) + v.__inc;
      else out[k] = v;
    });
    return out;
  }

  function docRef(pathKey) {
    return {
      path: pathKey,
      async get() {
        const data = docs.get(pathKey);
        return { exists: data !== undefined, data: () => data, id: pathKey.split('/').pop() };
      },
      async set(patch, opts) {
        docs.set(pathKey, (opts && opts.merge) ? resolve(docs.get(pathKey), patch) : { ...patch });
      },
      collection(sub) {
        return {
          async get() {
            const rows = progress.get(pathKey) || [];
            return { docs: rows.map((r) => ({ id: r.id, data: () => r })) };
          }
        };
      }
    };
  }

  return {
    _docs: docs,
    _progress: progress,
    collection(name) {
      return { doc: (id) => docRef(`${name}/${id}`) };
    }
  };
}

const admin = {
  firestore: { FieldValue: { serverTimestamp: () => SENTINEL_TS, increment } }
};

const sandbox = new Function('admin', 'console', `
  function normalizeEmail(e) { return String(e || '').trim().toLowerCase(); }
  ${code}
  return { advanceBetaStatus, recordBetaApplication, markBetaGranted,
           markBetaActivated, noteBetaFeedback, countCourseProgress,
           BETA_STATUS_RANK, BETA_DEFAULT_SLUG };
`);
const B = sandbox(admin, console);

let passed = 0;
function ok(name, run) {
  return run().then(
    () => { passed++; console.log('  ✓ ' + name); },
    (e) => { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
  );
}

const tester = (over = {}) => ({ email: 'a@b.com', status: 'applied', feedbackCount: 0, ...over });

console.log('beta cohort — the record behind the beta console');

(async () => {

  // ── The ladder ─────────────────────────────────────────────────────────

  await ok('an application with no record does nothing rather than inventing one', async () => {
    const db = makeDb({});
    assert.strictEqual(await B.markBetaActivated(db, 'nobody@x.com', 'uid1'), false);
    assert.strictEqual(db._docs.size, 0);
  });

  await ok('a granted tester who signs up becomes active', async () => {
    const db = makeDb({ 'betaTesters/a@b.com': tester({ status: 'granted' }) });
    await B.markBetaActivated(db, 'a@b.com', 'uid1');
    const d = db._docs.get('betaTesters/a@b.com');
    assert.strictEqual(d.status, 'active');
    assert.strictEqual(d.uid, 'uid1');
  });

  await ok('activation never demotes someone already completed', async () => {
    const db = makeDb({ 'betaTesters/a@b.com': tester({ status: 'completed' }) });
    await B.markBetaActivated(db, 'a@b.com', 'uid1');
    assert.strictEqual(db._docs.get('betaTesters/a@b.com').status, 'completed');
  });

  await ok('a late grant never demotes an active tester, but still stamps the grant', async () => {
    const db = makeDb({ 'betaTesters/a@b.com': tester({ status: 'active' }) });
    await B.markBetaGranted(db, 'a@b.com', { slug: 'icant', grantedBy: 'owner', applied: true });
    const d = db._docs.get('betaTesters/a@b.com');
    assert.strictEqual(d.status, 'active');
    assert.strictEqual(d.courseSlug, 'icant');
    assert.strictEqual(d.grantedBy, 'owner');
  });

  await ok('a grant for someone with no account is marked pending', async () => {
    const db = makeDb({ 'betaTesters/a@b.com': tester() });
    await B.markBetaGranted(db, 'a@b.com', { slug: 'icant', applied: false });
    const d = db._docs.get('betaTesters/a@b.com');
    assert.strictEqual(d.status, 'granted');
    assert.strictEqual(d.grantPending, true);
  });

  await ok('the ladder ranks every status exactly once, in order', async () => {
    const ranks = Object.values(B.BETA_STATUS_RANK);
    assert.deepStrictEqual(ranks, [...ranks].sort((a, b) => a - b));
    assert.strictEqual(new Set(ranks).size, ranks.length);
  });

  // ── Applications ───────────────────────────────────────────────────────

  await ok('a first application opens the record at applied', async () => {
    const db = makeDb({});
    await B.recordBetaApplication(db, {
      name: 'Dana', email: 'A@B.com ', phone: '555', fields: { course: "I Can't", why: 'ready' }
    });
    const d = db._docs.get('betaTesters/a@b.com');
    assert.strictEqual(d.status, 'applied');
    assert.strictEqual(d.email, 'a@b.com');
    assert.strictEqual(d.why, 'ready');
    assert.strictEqual(d.courseSlug, B.BETA_DEFAULT_SLUG);
    assert.strictEqual(d.feedbackCount, 0);
  });

  await ok('re-applying refreshes details without resetting an approved tester', async () => {
    const db = makeDb({
      'betaTesters/a@b.com': tester({ status: 'active', feedbackCount: 3, name: 'Dana' })
    });
    await B.recordBetaApplication(db, { name: 'Dana R', email: 'a@b.com', fields: { why: 'again' } });
    const d = db._docs.get('betaTesters/a@b.com');
    assert.strictEqual(d.status, 'active');
    assert.strictEqual(d.feedbackCount, 3);
    assert.strictEqual(d.name, 'Dana R');
    assert.strictEqual(d.why, 'again');
  });

  // ── Feedback ───────────────────────────────────────────────────────────

  await ok('feedback from a tester increments their count', async () => {
    const db = makeDb({ 'betaTesters/a@b.com': tester({ feedbackCount: 2 }) });
    assert.strictEqual(await B.noteBetaFeedback(db, 'A@B.com'), true);
    assert.strictEqual(db._docs.get('betaTesters/a@b.com').feedbackCount, 3);
  });

  await ok('feedback from a non-tester is ignored', async () => {
    const db = makeDb({});
    assert.strictEqual(await B.noteBetaFeedback(db, 'stranger@x.com'), false);
    assert.strictEqual(db._docs.size, 0);
  });

  // ── Progress ───────────────────────────────────────────────────────────

  await ok('progress counts completed modules for that course only', async () => {
    const db = makeDb({});
    db._progress.set('users/uid1', [
      { id: 'icant__m1', completed: true },
      { id: 'icant__m2', completed: true },
      { id: 'icant__m3', completed: false },
      { id: 'other__m1', completed: true }
    ]);
    assert.strictEqual(await B.countCourseProgress(db, 'uid1', 'icant'), 2);
  });

  await ok('progress for a tester with no account is zero, not an error', async () => {
    assert.strictEqual(await B.countCourseProgress(makeDb({}), null, 'icant'), 0);
  });

  console.log(`\n${passed} checks passed.`);
})();
