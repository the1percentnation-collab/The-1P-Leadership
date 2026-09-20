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
  const ref = db.collection('courses').doc(SLUG);
  const snap = await ref.get();
  if (!snap.exists) return; // Fresh project: nothing to collide with.

  const d = snap.data() || {};
  if (/leader/i.test(String(d.title || '')) || d.price === 497) {
    throw new Error(
      `Refusing to seed: courses/${SLUG} still holds the Leader Coach ` +
      `(title="${d.title}", price=${d.price}).\n\n` +
      `Run the slug fix FIRST, then re-run this script:\n` +
      `    node fix-clc-slugs.js            # dry run, writes nothing\n` +
      `    node fix-clc-slugs.js --apply    # commits it\n\n` +
      `See docs/launch-runbook.md step 1. Seeding before that fix would merge ` +
      `Life Coach modules into the Leader Coach lessons and lose both programs.`
    );
  }

  // The title test above is necessary but not sufficient. A record can be
  // renamed to the Life Coach by hand while the previous program's lessons are
  // left behind in this same subcollection, and then the identity looks correct
  // while the danger is still present. So check the lessons themselves.
  //
  // An empty subcollection is the clean post-migration state. Our own eight
  // titles mean this is a safe re-run. Anything else belongs to another program
  // and must not be merged with.
  const ours = new Set(MODULES.map((m) => String(m.title)));
  const existing = await ref.collection('modules').get();
  const foreign = existing.docs
    .map((doc) => ({ id: doc.id, title: String((doc.data() || {}).title || '') }))
    .filter((m) => m.title && !ours.has(m.title));

  if (foreign.length) {
    throw new Error(
      `Refusing to seed: courses/${SLUG} already holds ${foreign.length} lesson(s) ` +
      `that are not Life Coach modules:\n` +
      foreign.map((m) => `    ${String(m.id).padStart(2)}  ${m.title}`).join('\n') +
      `\n\nThese belong to another program. Seeding would merge both programs ` +
      `into one subcollection, and there is no undo.\n\n` +
      `Run \`node inspect-clc.js\` first. It writes nothing and shows exactly ` +
      `which program each record holds.`
    );
  }
}

async function main() {
  console.log(`Project: ${projectId}`);
  await assertCredentials(db, projectId);
  await assertSlugFixHasRun();

  // Cohort placeholders, written ONLY where nothing real is set yet.
  //
  // This script is advertised as safe to re-run, and re-running it is the way
  // to pick up new exam questions or edited lesson copy. But set(..., {merge:
  // true}) deep-merges nested maps, which means an explicit `null` or `'TBD'`
  // here overwrites a leaf that already holds a real value. Written the naive
  // way, a re-run six weeks from now would silently wipe the launch dates and
  // the Zoom link off a cohort that is already selling. So each placeholder is
  // only included when the live value is still blank.
  const courseRef = db.collection('courses').doc(SLUG);
  const courseSnap = await courseRef.get();
  const live = (courseSnap.exists && (courseSnap.data() || {}).cohort) || {};
  const blank = (v) => v === undefined || v === null || v === '' || v === 'TBD';

  const cohort = { label: live.label || 'Founding Cohort' };
  if (typeof live.capacity !== 'number') cohort.capacity = 20;
  if (blank(live.enrollCloseAt)) cohort.enrollCloseAt = null;
  if (blank(live.startAt)) cohort.startAt = null;
  if (blank(live.callDay)) cohort.callDay = 'TBD';
  if (blank(live.callTime)) cohort.callTime = 'TBD';

  const kept = ['enrollCloseAt', 'startAt', 'callDay', 'callTime', 'capacity']
    .filter((k) => !(k in cohort));
  if (kept.length) console.log(`Cohort: keeping your existing ${kept.join(', ')}`);

  await courseRef.set({
    cohort,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Live-call join link lives out of public view (enrolled + admin only).
  // Same rule: never blank out a link that has already been pasted in.
  const privRef = courseRef.collection('private').doc('cohort');
  const privSnap = await privRef.get();
  if (!privSnap.exists || blank((privSnap.data() || {}).joinUrl)) {
    await privRef.set({ joinUrl: '' }, { merge: true });
  } else {
    console.log('Cohort: keeping your existing joinUrl');
  }

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

  // The practice partner channel. The course is self-paced, so students never
  // share a calendar and the old fixed peer triad cannot work; they pair off
  // here instead. Unlisted and private, so nobody outside the program sees it
  // or gets a "Request access" button for something only enrolling can open.
  //
  // Created here rather than in the community console because channel writes
  // are owner-only in the rules, and the Admin SDK bypasses that. The
  // onUserEnrollmentWritten trigger adds each buyer on enrollment; run the
  // backfillCourseChannelMembers callable once for anyone who enrolled before
  // that trigger shipped.
  await db.collection('channels').doc('clc-practice').set({
    name: 'CLC Practice Partners',
    description: 'Find a practice partner and run the module drills together.',
    emoji: '\u{1F91D}',
    listed: false,
    visibility: 'private',
    order: 90,
    memberUids: admin.firestore.FieldValue.arrayUnion(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log('channels/clc-practice seeded (unlisted, private)');

  // Everything above is data this script can write. Everything below needs a
  // decision only Anthony can make, so print it rather than leave it buried in
  // TODO comments that nobody re-reads after the run.
  console.log('\nSeeded. Still required before the Life Coach can sell:');
  console.log('  1. Coaching lab on courses/1p-clc: lab.schedule and lab.nextAt,');
  console.log('     set in /manage-courses.html. It is a standing drop-in call,');
  console.log('     not a cohort session, so there is no start date or seat cap.');
  console.log('  2. Zoom link on courses/1p-clc/private/cohort: joinUrl (empty).');
  console.log('     Use a recurring meeting link.');
  console.log('  3. Modules unlock in order as members complete them');
  console.log('     (sequentialUnlock on the course doc). All eight are');
  console.log('     published, so nothing needs flipping week by week.');
  console.log('  4. Pin a board post in the CLC Practice Partners channel telling');
  console.log('     students what to post: timezone, two windows they are free,');
  console.log('     and which module they are on.');
  console.log('  5. STRIPE_WEBHOOK_SECRET must be a real whsec_ value, or a');
  console.log('     purchase is charged and never enrolled. See the runbook.');
  console.log('  6. Set the course status to live in /manage-courses.html.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
