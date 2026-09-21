// promoteLaunchedItems — the tick step that closes the launch loop.
//
// Runs the REAL function from functions/index.js against the Firestore
// emulator: seed a course and a product dated yesterday, one of each dated
// tomorrow, one live item with a past date (must not be touched), and one
// coming-soon item with no date (must not be touched). Exactly two flip.
//
// Requires: `cd functions && npm install`, and the emulator (this file is run
// from the same `emulators:exec` as the rules suite — see package.json).
import { createRequire } from 'node:module';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-1p';
process.env.GOOGLE_CLOUD_PROJECT = process.env.GCLOUD_PROJECT;

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const { promoteLaunchedItems } = require('../functions/index.js');

const db = admin.firestore();
const DAY = 24 * 60 * 60 * 1000;
const yesterday = admin.firestore.Timestamp.fromMillis(Date.now() - DAY);
const tomorrow = admin.firestore.Timestamp.fromMillis(Date.now() + DAY);

let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { console.error('  ✗ ' + name + (detail ? '\n    ' + detail : '')); process.exitCode = 1; }
}

console.log('launch-tick — promoteLaunchedItems against the emulator');

// Seed under a distinct prefix so this never collides with the rules suite.
const seed = {
  'courses/lt-due':     { title: 'Due course',   status: 'coming-soon', launchDate: yesterday },
  'courses/lt-future':  { title: 'Future course', status: 'coming-soon', launchDate: tomorrow },
  'courses/lt-undated': { title: 'Undated',      status: 'coming-soon' },
  'courses/lt-live':    { title: 'Already live', status: 'live', launchDate: yesterday, launchedBy: 'manual' },
  'products/lt-due':    { name: 'Due product',   status: 'interest', launchDate: yesterday },
  'products/lt-pre':    { name: 'Due pre-order', status: 'preorder', launchDate: yesterday },
  'products/lt-future': { name: 'Future product', status: 'interest', launchDate: tomorrow },
  'products/lt-draft':  { name: 'Draft w/ date', status: 'planned', launchDate: yesterday }
};
const batch = db.batch();
for (const [path, data] of Object.entries(seed)) batch.set(db.doc(path), data);
await batch.commit();

const result = await promoteLaunchedItems(db);

const status = async (path) => (await db.doc(path).get()).data();

ok('reports one course and two products flipped',
  result.courses === 1 && result.products === 2, JSON.stringify(result));

const dueCourse = await status('courses/lt-due');
ok('a coming-soon course past its date is now live', dueCourse.status === 'live');
ok('...and records that the tick did it', dueCourse.launchedBy === 'auto' && !!dueCourse.launchedAt);
ok('...via the same audit fields the admin writes', dueCourse.updatedBy === 'launch-tick' && !!dueCourse.updatedAt);

ok('a coming-soon course dated tomorrow is untouched', (await status('courses/lt-future')).status === 'coming-soon');
ok('a coming-soon course with no date is untouched', (await status('courses/lt-undated')).status === 'coming-soon');

const live = await status('courses/lt-live');
ok('an already-live course is not rewritten', live.launchedBy === 'manual', 'launchedBy was overwritten');

ok('a coming-soon product past its date is now live', (await status('products/lt-due')).status === 'live');
ok('a pre-order past its ship date is now live', (await status('products/lt-pre')).status === 'live');
ok('a product dated tomorrow is untouched', (await status('products/lt-future')).status === 'interest');
ok('a draft is never promoted, whatever its date', (await status('products/lt-draft')).status === 'planned');

// Idempotent: a second tick finds nothing due.
const again = await promoteLaunchedItems(db);
ok('a second tick promotes nothing', again.courses === 0 && again.products === 0, JSON.stringify(again));

// ── dryRun — the safety valve ────────────────────────────────────────────
// A status flip is what fires the launch emails, and those cannot be unsent,
// so the preview has to be provably write-free rather than merely intended to
// be. Seed two fresh due items and assert nothing about them moves.
const dry = {
  'courses/lt-dry':   { title: 'Dry course',  status: 'coming-soon', launchDate: yesterday },
  'products/lt-dry':  { name: 'Dry product',  status: 'preorder',    launchDate: yesterday }
};
const dryBatch = db.batch();
for (const [path, data] of Object.entries(dry)) dryBatch.set(db.doc(path), data);
await dryBatch.commit();

const preview = await promoteLaunchedItems(db, { dryRun: true });
ok('a dry run reports what would flip', preview.courses === 1 && preview.products === 1, JSON.stringify(preview));
ok('...and says it was a dry run', preview.dryRun === true);
ok('...and names the items', !!preview.wouldPromote
  && preview.wouldPromote.courses.includes('lt-dry')
  && preview.wouldPromote.products.includes('lt-dry'), JSON.stringify(preview.wouldPromote));

const dryCourse = await status('courses/lt-dry');
const dryProduct = await status('products/lt-dry');
ok('a dry run writes nothing to the course', dryCourse.status === 'coming-soon' && !dryCourse.launchedAt,
  JSON.stringify(dryCourse));
ok('a dry run writes nothing to the product', dryProduct.status === 'preorder' && !dryProduct.launchedAt,
  JSON.stringify(dryProduct));

// And the real run still flips them, so the dry run left nothing in a state
// that would stop the launch happening for real.
const real = await promoteLaunchedItems(db);
ok('a real run after a dry run still flips both', real.courses === 1 && real.products === 1, JSON.stringify(real));
ok('...and the real run is not marked dry', real.dryRun === undefined);

// Clean up so a re-run of the suite starts from the same place.
const del = db.batch();
for (const path of Object.keys({ ...seed, ...dry })) del.delete(db.doc(path));
await del.commit();

console.log(`\n${passed} checks passed.`);
process.exit(process.exitCode || 0);
