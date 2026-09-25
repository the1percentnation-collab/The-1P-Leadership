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
function arrayUnion(...xs) { return { __union: xs }; }
function arrayRemove(...xs) { return { __remove: xs }; }

function makeDb(seed) {
  const docs = new Map(Object.entries(seed || {}));
  const progress = new Map();

  function resolve(target, patch) {
    const out = { ...(target || {}) };
    Object.entries(patch).forEach(([k, v]) => {
      if (v === SENTINEL_TS) out[k] = SENTINEL_TS;
      else if (v && v.__inc != null) out[k] = (Number(out[k]) || 0) + v.__inc;
      else if (v && v.__union) {
        const cur = Array.isArray(out[k]) ? out[k].slice() : [];
        v.__union.forEach((x) => { if (!cur.includes(x)) cur.push(x); });
        out[k] = cur;
      } else if (v && v.__remove) {
        const cur = Array.isArray(out[k]) ? out[k].slice() : [];
        out[k] = cur.filter((x) => !v.__remove.includes(x));
      } else out[k] = v;
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
  firestore: { FieldValue: { serverTimestamp: () => SENTINEL_TS, increment, arrayUnion, arrayRemove } }
};

const sandbox = new Function('admin', 'console', `
  function normalizeEmail(e) { return String(e || '').trim().toLowerCase(); }
  ${code}
  return { advanceBetaStatus, recordBetaApplication, markBetaGranted,
           markBetaActivated, noteBetaFeedback, countProgressBySlug,
           progressDetailBySlug, ratingSummary,
           testerSlugs, normalizeSlugList, revocableSlugs, planBetaGrant,
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

  // ── Manual add ─────────────────────────────────────────────────────────
  // The console's "Add a tester" path runs through the same helper as the beta
  // form, so a hand-added tester is indistinguishable downstream apart from
  // the source stamp that says who put them there.

  await ok('a manual add opens the record at applied and stamps who added them', async () => {
    const db = makeDb({});
    await B.recordBetaApplication(
      db,
      { name: 'Dana', email: 'a@b.com', fields: {} },
      { source: 'manual', addedBy: 'owner@x.com' }
    );
    const d = db._docs.get('betaTesters/a@b.com');
    assert.strictEqual(d.status, 'applied');
    assert.strictEqual(d.source, 'manual');
    assert.strictEqual(d.addedBy, 'owner@x.com');
  });

  await ok('a form application is stamped as such without being asked', async () => {
    const db = makeDb({});
    await B.recordBetaApplication(db, { name: 'Dana', email: 'a@b.com', fields: {} });
    const d = db._docs.get('betaTesters/a@b.com');
    assert.strictEqual(d.source, 'form');
    assert.strictEqual(d.addedBy, null);
  });

  await ok('manually adding someone already in the cohort does not reset them', async () => {
    const db = makeDb({
      'betaTesters/a@b.com': tester({ status: 'active', feedbackCount: 4, source: 'form' })
    });
    await B.recordBetaApplication(
      db,
      { name: 'Dana', email: 'a@b.com', phone: '555', fields: {} },
      { source: 'manual', addedBy: 'owner@x.com' }
    );
    const d = db._docs.get('betaTesters/a@b.com');
    assert.strictEqual(d.status, 'active');
    assert.strictEqual(d.feedbackCount, 4);
    assert.strictEqual(d.source, 'form');      // not rewritten
    assert.strictEqual(d.phone, '555');        // details still refreshed
  });

  // ── CRM eligibility toggle ─────────────────────────────────────────────
  // The contact card's toggle runs through the same helper, stamped 'crm'.
  // Its two risky moves are pinned by the callable, not here: turning it off
  // declines rather than deletes, and it refuses once somebody has access.
  // What is testable at this level is that turning it on is the same write
  // the form makes.

  await ok('the CRM toggle opens a record stamped crm, with the contact linked', async () => {
    const db = makeDb({});
    await B.recordBetaApplication(
      db,
      { name: 'Dana', email: 'a@b.com', fields: {}, crmContactId: 'contact123' },
      { source: 'crm', addedBy: 'owner@x.com' }
    );
    const d = db._docs.get('betaTesters/a@b.com');
    assert.strictEqual(d.status, 'applied');
    assert.strictEqual(d.source, 'crm');
    assert.strictEqual(d.crmContactId, 'contact123');
  });

  await ok('the CRM toggle never disturbs a tester who already has access', async () => {
    const db = makeDb({
      'betaTesters/a@b.com': tester({ status: 'granted', feedbackCount: 2, crmContactId: 'old' })
    });
    await B.recordBetaApplication(
      db,
      { name: 'Dana', email: 'a@b.com', fields: {} },
      { source: 'crm', addedBy: 'owner@x.com' }
    );
    const d = db._docs.get('betaTesters/a@b.com');
    assert.strictEqual(d.status, 'granted');
    assert.strictEqual(d.feedbackCount, 2);
    assert.strictEqual(d.crmContactId, 'old');
  });

  // ── Course choice ──────────────────────────────────────────────────────
  // A beta can run on more than one course at once, so which course an
  // approval grants is a decision per tester rather than a constant.

  await ok('a picked course is stored on the new record', async () => {
    const db = makeDb({});
    await B.recordBetaApplication(
      db,
      { name: 'Dana', email: 'a@b.com', fields: {} },
      { source: 'manual', addedBy: 'owner@x.com', courseSlugs: ['clc'] }
    );
    assert.strictEqual(db._docs.get('betaTesters/a@b.com').courseSlug, 'clc');
  });

  await ok('no picked course falls back to the beta default, not to empty', async () => {
    const db = makeDb({});
    await B.recordBetaApplication(db, { name: 'Dana', email: 'a@b.com', fields: {} });
    assert.strictEqual(db._docs.get('betaTesters/a@b.com').courseSlug, B.BETA_DEFAULT_SLUG);
  });

  await ok('a later add never silently moves an existing tester to another course', async () => {
    const db = makeDb({
      'betaTesters/a@b.com': tester({ status: 'granted', courseSlug: 'icant' })
    });
    await B.recordBetaApplication(
      db,
      { name: 'Dana', email: 'a@b.com', fields: {} },
      { source: 'manual', addedBy: 'owner@x.com', courseSlugs: ['clc'] }
    );
    assert.strictEqual(db._docs.get('betaTesters/a@b.com').courseSlug, 'icant');
  });

  // ── Reading a tester's courses ─────────────────────────────────────────

  await ok('a legacy scalar record and a new array record read the same', async () => {
    assert.deepStrictEqual(B.testerSlugs({ courseSlug: 'icant' }), ['icant']);
    assert.deepStrictEqual(B.testerSlugs({ courseSlugs: ['icant'] }), ['icant']);
    assert.deepStrictEqual(B.testerSlugs({ courseSlugs: ['icant', '1p-clc'] }), ['icant', '1p-clc']);
    // An array wins over a stale scalar left beside it.
    assert.deepStrictEqual(B.testerSlugs({ courseSlugs: ['1p-clc'], courseSlug: 'icant' }), ['1p-clc']);
    assert.deepStrictEqual(B.testerSlugs({}), []);
    assert.deepStrictEqual(B.testerSlugs(null), []);
  });

  await ok('a requested list is deduped and trimmed, and empty falls back', async () => {
    assert.deepStrictEqual(B.normalizeSlugList([' icant ', 'icant', '1p-clc'], []), ['icant', '1p-clc']);
    assert.deepStrictEqual(B.normalizeSlugList('icant', []), ['icant']);
    assert.deepStrictEqual(B.normalizeSlugList([], ['icant']), ['icant']);
    assert.deepStrictEqual(B.normalizeSlugList(['', '  '], ['icant']), ['icant']);
    assert.deepStrictEqual(B.normalizeSlugList(null, ['icant']), ['icant']);
  });

  // ── Revocation safety ──────────────────────────────────────────────────
  // The selection is the truth, so unticking takes access away. These pin the
  // three things that must stop it, because enrollment is one shared array and
  // a bad removal here destroys something somebody paid for.

  const rev = (over = {}) => B.revocableSlugs({
    betaGranted: [], keeping: [], removing: [], paidSlugs: [], enrollsAlsoBy: {}, ...over
  });

  await ok('a beta-granted course with nothing holding it up is revoked', async () => {
    const r = rev({ betaGranted: ['icant'], removing: ['icant'] });
    assert.deepStrictEqual(r.revoke, ['icant']);
    assert.deepStrictEqual(r.blocked, []);
  });

  await ok('a course the beta never granted is never taken away', async () => {
    const r = rev({ betaGranted: [], removing: ['icant'] });
    assert.deepStrictEqual(r.revoke, []);
    assert.deepStrictEqual(r.blocked, [{ slug: 'icant', reason: 'not-beta-granted' }]);
  });

  await ok('a course they paid for is kept even though the beta granted it too', async () => {
    const r = rev({ betaGranted: ['icant'], removing: ['icant'], paidSlugs: ['icant'] });
    assert.deepStrictEqual(r.revoke, []);
    assert.deepStrictEqual(r.blocked, [{ slug: 'icant', reason: 'paid' }]);
  });

  await ok('unticking a bundle takes the course it unlocked with it', async () => {
    const r = rev({
      betaGranted: ['bundle-icant', 'icant'],
      removing: ['bundle-icant', 'icant'],
      keeping: [],
      enrollsAlsoBy: { 'bundle-icant': ['icant'] }
    });
    assert.deepStrictEqual(r.revoke, ['bundle-icant', 'icant']);
    assert.deepStrictEqual(r.blocked, []);
  });

  await ok('a course is kept when a course being kept unlocks it', async () => {
    const r = rev({
      betaGranted: ['bundle-icant', 'icant'],
      keeping: ['bundle-icant'],
      removing: ['icant'],
      enrollsAlsoBy: { 'bundle-icant': ['icant'] }
    });
    assert.deepStrictEqual(r.revoke, []);
    assert.deepStrictEqual(r.blocked, [{ slug: 'icant', reason: 'unlocked-by-kept-course' }]);
  });

  await ok('a bundle being removed cannot prop up its own unlocked course', async () => {
    // The fan-out is read from the KEPT set only. If it were read from the
    // removing set too, bundle-icant would imply icant and block its own
    // removal, and unticking the pair would silently do nothing.
    const r = rev({
      betaGranted: ['bundle-icant', 'icant'],
      keeping: ['1p-clc'],
      removing: ['bundle-icant', 'icant'],
      enrollsAlsoBy: { 'bundle-icant': ['icant'] }
    });
    assert.deepStrictEqual(r.revoke, ['bundle-icant', 'icant']);
  });

  await ok('paid beats the bundle rule, and both are reported per course', async () => {
    const r = rev({
      betaGranted: ['bundle-icant', 'icant', '1p-clc'],
      keeping: [],
      removing: ['bundle-icant', 'icant', '1p-clc'],
      paidSlugs: ['1p-clc'],
      enrollsAlsoBy: { 'bundle-icant': ['icant'] }
    });
    assert.deepStrictEqual(r.revoke, ['bundle-icant', 'icant']);
    assert.deepStrictEqual(r.blocked, [{ slug: '1p-clc', reason: 'paid' }]);
  });

  await ok('removing nothing revokes nothing', async () => {
    const r = rev({ betaGranted: ['icant'], keeping: ['icant'], removing: [] });
    assert.deepStrictEqual(r.revoke, []);
    assert.deepStrictEqual(r.blocked, []);
  });

  await ok('a new record writes the list and the scalar in agreement', async () => {
    const db = makeDb({});
    await B.recordBetaApplication(
      db,
      { name: 'Dana', email: 'a@b.com', fields: {} },
      { source: 'manual', addedBy: 'owner@x.com', courseSlugs: ['1p-clc', 'icant'] }
    );
    const d = db._docs.get('betaTesters/a@b.com');
    assert.deepStrictEqual(d.courseSlugs, ['1p-clc', 'icant']);
    // The scalar is the first of the list, so anything still reading the old
    // field gets their primary course rather than undefined.
    assert.strictEqual(d.courseSlug, '1p-clc');
    // An application grants nothing, so there is nothing revocable yet.
    assert.deepStrictEqual(d.betaGrantedSlugs, []);
  });

  await ok('a grant records what the beta handed over, on top of the list', async () => {
    const db = makeDb({ 'betaTesters/a@b.com': tester({ courseSlugs: ['icant'], betaGrantedSlugs: [] }) });
    await B.markBetaGranted(db, 'a@b.com', { slugs: ['icant', '1p-clc'], grantedBy: 'owner', applied: true });
    const d = db._docs.get('betaTesters/a@b.com');
    assert.deepStrictEqual(d.courseSlugs, ['icant', '1p-clc']);
    assert.deepStrictEqual(d.betaGrantedSlugs, ['icant', '1p-clc']);
    assert.strictEqual(d.status, 'granted');
  });

  await ok('a grant never claims a course the beta did not hand over', async () => {
    // The tester bought 1p-clc themselves; a beta grant of icant must not
    // quietly add it to the revocable set.
    const db = makeDb({ 'betaTesters/a@b.com': tester({ courseSlugs: ['icant', '1p-clc'], betaGrantedSlugs: [] }) });
    await B.markBetaGranted(db, 'a@b.com', { slugs: ['icant'], grantedBy: 'owner', applied: true });
    assert.deepStrictEqual(db._docs.get('betaTesters/a@b.com').betaGrantedSlugs, ['icant']);
  });

  await ok('a legacy record has nothing revocable until it is approved again', async () => {
    // Records granted before multi-course have no betaGrantedSlugs. Guessing
    // that their one course was beta-granted would be wrong for anyone who
    // bought it, so the honest answer is that nothing is revocable yet.
    const legacy = { courseSlug: 'icant', status: 'active', grantedAt: SENTINEL_TS };
    assert.deepStrictEqual(B.testerSlugs(legacy), ['icant']);
    const r = B.revocableSlugs({
      betaGranted: Array.isArray(legacy.betaGrantedSlugs) ? legacy.betaGrantedSlugs : [],
      keeping: [], removing: ['icant'], paidSlugs: [], enrollsAlsoBy: {}
    });
    assert.deepStrictEqual(r.revoke, []);
    assert.deepStrictEqual(r.blocked, [{ slug: 'icant', reason: 'not-beta-granted' }]);
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

  await ok('progress counts completed modules per course, from one read', async () => {
    const db = makeDb({});
    db._progress.set('users/uid1', [
      { id: 'icant__m1', completed: true },
      { id: 'icant__m2', completed: true },
      { id: 'icant__m3', completed: false },
      { id: '1p-clc__m1', completed: true },
      { id: 'other__m1', completed: true }
    ]);
    assert.deepStrictEqual(
      await B.countProgressBySlug(db, 'uid1', ['icant', '1p-clc']),
      { icant: 2, '1p-clc': 1 }
    );
  });

  await ok('a course with no completed modules reads zero, not missing', async () => {
    const db = makeDb({});
    db._progress.set('users/uid1', [{ id: 'icant__m1', completed: true }]);
    const out = await B.countProgressBySlug(db, 'uid1', ['icant', '1p-clc']);
    assert.strictEqual(out['1p-clc'], 0);
    assert.ok('1p-clc' in out);
  });

  await ok('sibling slugs do not bleed into each other', async () => {
    // `1p-clc` is a prefix of `1p-clc-leader`. The `__m` separator is what
    // keeps them apart, so this pins that the separator stays in the match.
    const db = makeDb({});
    db._progress.set('users/uid1', [
      { id: '1p-clc-leader__m1', completed: true },
      { id: '1p-clc-leader__m2', completed: true },
      { id: '1p-clc__m1', completed: true }
    ]);
    assert.deepStrictEqual(
      await B.countProgressBySlug(db, 'uid1', ['1p-clc', '1p-clc-leader']),
      { '1p-clc': 1, '1p-clc-leader': 2 }
    );
  });

  await ok('progress for a tester with no account is zero, not an error', async () => {
    assert.deepStrictEqual(await B.countProgressBySlug(makeDb({}), null, ['icant']), { icant: 0 });
  });

  await ok('progress detail says which modules are done and when the last one landed', async () => {
    const db = makeDb({});
    const ts = (ms) => ({ toMillis: () => ms });
    db._progress.set('users/uid1', [
      { id: 'icant__m0', completed: true, completedAt: ts(1000) },
      { id: 'icant__m3', completed: true, completedAt: ts(5000) },
      { id: 'icant__m4', completed: false, completedAt: ts(9000) },
      { id: '1p-clc__m1', completed: true }
    ]);
    const d = await B.progressDetailBySlug(db, 'uid1', ['icant', '1p-clc']);
    assert.deepStrictEqual(d.counts, { icant: 2, '1p-clc': 1 });
    assert.deepStrictEqual(d.doneIds.icant.sort(), [0, 3]);
    assert.strictEqual(d.lastAt.icant, 5000, 'an unfinished module never counts as the latest lesson');
    assert.strictEqual(d.lastAt['1p-clc'], null);
  });

  await ok('the public rating averages only valid 1-5 star ratings', async () => {
    assert.deepStrictEqual(B.ratingSummary([5, 4, 5]), { ratingAvg: 4.7, ratingCount: 3 });
    assert.deepStrictEqual(B.ratingSummary([5, 0, 9, 'x', null]), { ratingAvg: 5, ratingCount: 1 });
    assert.deepStrictEqual(B.ratingSummary([]), { ratingAvg: null, ratingCount: 0 });
  });

  await ok('a stale record (listed as granted, never enrolled) still grants', async () => {
    const r = B.planBetaGrant({ wanted: ['icant'], previous: ['icant'], enrolled: [] });
    assert.deepStrictEqual(r, { grant: ['icant'], notifyOnly: [] });
  });

  await ok('a course already held but new to the beta list notifies without granting', async () => {
    const r = B.planBetaGrant({ wanted: ['icant', 'bundle'], previous: ['icant'], enrolled: ['icant', 'bundle'] });
    assert.deepStrictEqual(r, { grant: [], notifyOnly: ['bundle'] });
  });

  await ok('re-saving courses they already have does nothing', async () => {
    const r = B.planBetaGrant({ wanted: ['icant'], previous: ['icant'], enrolled: ['icant'] });
    assert.deepStrictEqual(r, { grant: [], notifyOnly: [] });
  });

  await ok('an applicant with an account is granted everything ticked', async () => {
    const r = B.planBetaGrant({ wanted: ['icant', '1p-clc'], previous: [], enrolled: [] });
    assert.deepStrictEqual(r, { grant: ['icant', '1p-clc'], notifyOnly: [] });
  });

  console.log(`\n${passed} checks passed.`);
})();
