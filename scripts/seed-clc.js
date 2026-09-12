#!/usr/bin/env node
// Seeds the 1P Certified Life Coach course (slug: 1p-clc):
//   - cohort placeholders on the course doc + the private live-call doc
//   - eight module drafts mapped to A.L.I.G.N. (module 1 published,
//     the rest left as drafts to finish in the course builder)
//   - the FOUNDING coupon: $1,500 off, capped at 20 redemptions
//   - a draft written-exam bank (replace/extend in Firestore before launch)
//   - config/certification thresholds
//
// Safe to re-run: everything writes with merge, and the coupon is only
// created if it doesn't exist (so its redemption count is never reset).
//
// Run with Admin credentials, from the scripts/ directory after `npm install`:
//   node seed-clc.js
//
// Authenticate with EITHER a service account key
// (export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json) OR your
// own Google account (gcloud auth application-default login). The second one
// is why this uses the shared bootstrap rather than a bare initializeApp():
// an application-default credential carries no project id, so the project has
// to be resolved from .firebaserc or the run would target the wrong project,
// or fail with an unhelpful error. The bootstrap also prints the project and
// proves the credentials work before anything is written.

const { initAdmin, assertCredentials } = require('./lib/init');
const { admin, db, projectId } = initAdmin();

const SLUG = '1p-clc';

const MODULES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
  require(`./clc-content/module-${String(n).padStart(2, '0')}.js`));


// Exam bank lives in ./clc-content/exam.js so it can be extended without
// touching the seed logic.
const EXAM_QUESTIONS = require('./clc-content/exam.js');


// Preflight: `courses/1p-clc` must already BE the Life Coach before we seed.
//
// ORDER MATTERS, and getting it wrong is unrecoverable. Until
// scripts/fix-clc-slugs.js has run, `courses/1p-clc` still holds the *Leader
// Coach* (title "1P Certified Leader Coach", $497) together with its seven
// lessons. Seeding here first would merge Life Coach modules 1-8 straight on
// top of Leader Coach lessons 1-7 in the same subcollection, and the slug fix
// would then copy that corrupted mix over to `1p-clc-leader`. Both programs
// would be destroyed at once, silently, with no undo.
//
// The identity test is the same one fix-clc-slugs.js uses, so the two scripts
// can never disagree about which program a doc holds.
async function assertSlugFixHasRun() {
  const snap = await db.collection('courses').doc(SLUG).get();
  if (!snap.exists) return; // Fresh project: nothing to collide with.
  const d = snap.data() || {};
  const looksLikeLeader = /leader/i.test(String(d.title || '')) || d.price === 497;
  if (!looksLikeLeader) return;
  throw new Error(
    `Refusing to seed: courses/${SLUG} still holds the Leader Coach ` +
    `(title="${d.title}", price=${d.price}).\n\n` +
    `Run the slug fix FIRST, then re-run this script:\n` +
    `    node scripts/fix-clc-slugs.js            # dry run, writes nothing\n` +
    `    node scripts/fix-clc-slugs.js --apply    # commits it\n\n` +
    `See docs/launch-runbook.md step 1. Seeding before that fix would merge ` +
    `Life Coach modules into the Leader Coach lessons and lose both programs.`
  );
}

async function main() {
  console.log(`Project: ${projectId}`);
  await assertCredentials(db, projectId);
  await assertSlugFixHasRun();

  // Cohort placeholders on the public course doc. Replace before launch.
  await db.collection('courses').doc(SLUG).set({
    cohort: {
      label: 'Founding Cohort',
      enrollCloseAt: null,   // TODO Anthony: set enrollment close date
      startAt: null,         // TODO Anthony: set module 1 drop date
      capacity: 20,
      callDay: 'TBD',        // TODO Anthony: fixed weekly call day
      callTime: 'TBD'        // TODO Anthony: fixed weekly call time
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Live-call join link lives out of public view (enrolled + admin only).
  await db.collection('courses').doc(SLUG).collection('private').doc('cohort').set({
    joinUrl: ''             // TODO Anthony: paste the Zoom link
  }, { merge: true });

  for (const m of MODULES) {
    const { id, ...rest } = m;
    await db.collection('courses').doc(SLUG).collection('modules').doc(String(id)).set({
      id,
      ...rest,
      html: rest.html.trim(),
      tagLabel: rest.pillar,
      sortOrder: id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`Module ${id} seeded (${rest.published ? 'published' : 'draft'})`);
  }

  // Founding cohort: $1,500 off $3,497 = $1,997, publicly capped at 20.
  const couponRef = db.collection('coupons').doc('FOUNDING');
  const coupon = await couponRef.get();
  if (!coupon.exists) {
    await couponRef.set({
      code: 'FOUNDING',
      amountOff: 1500,
      appliesTo: { kind: 'course', ids: [SLUG] },
      active: true,
      maxRedemptions: 20,
      redemptions: 0,
      note: 'Founding cohort: $1,997, 20 seats, never repeated.',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('FOUNDING coupon created');
  } else {
    console.log('FOUNDING coupon already exists; left untouched');
  }

  let qNum = 0;
  for (const q of EXAM_QUESTIONS) {
    qNum += 1;
    await db.collection('examBank').doc(SLUG).collection('questions')
      .doc(`q${String(qNum).padStart(3, '0')}`).set({ ...q, active: true }, { merge: true });
  }
  console.log(`${qNum} exam questions seeded`);

  await db.collection('config').doc('certification').set({
    passingScorePercent: 80,
    maxExamAttempts: 3,
    requiredHours: 25,
    examQuestionCount: 15,
    renewalHours: 10,
    renewalCeCredits: 10
  }, { merge: true });
  console.log('config/certification seeded');

  // Everything above is data this script can write. Everything below needs a
  // decision only Anthony can make, so print it rather than leave it buried in
  // TODO comments that nobody re-reads after the run.
  console.log('\nSeeded. Still required before the Life Coach can sell:');
  console.log('  1. Cohort dates on courses/1p-clc: enrollCloseAt, startAt,');
  console.log('     callDay, callTime (all placeholders right now).');
  console.log('  2. Zoom link on courses/1p-clc/private/cohort: joinUrl (empty).');
  console.log('  3. Modules 2-8 are seeded as DRAFTS, so members see only');
  console.log('     module 1. Publish each one in /manage-courses.html as its');
  console.log('     week opens. There is no automatic drip: a module stays');
  console.log('     invisible until that toggle is flipped.');
  console.log('  4. STRIPE_WEBHOOK_SECRET must be a real whsec_ value, or a');
  console.log('     purchase is charged and never enrolled. See the runbook.');
  console.log('  5. Set the course status to live in /manage-courses.html.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
