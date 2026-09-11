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
// Run with Admin credentials:
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-clc.js

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const SLUG = '1p-clc';

const MODULES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
  require(`./clc-content/module-${String(n).padStart(2, '0')}.js`));


// Exam bank lives in ./clc-content/exam.js so it can be extended without
// touching the seed logic.
const EXAM_QUESTIONS = require('./clc-content/exam.js');


async function main() {
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
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
