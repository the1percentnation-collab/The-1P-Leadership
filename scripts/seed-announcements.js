#!/usr/bin/env node
// Seeds three announcements that exercise every state the dashboard
// spotlight has to get right:
//   - one live now (should render)
//   - one scheduled for next week (should NOT render yet)
//   - one that expired yesterday (should NOT render any more)
//
// Aimed at the emulator, where it doubles as the acceptance check for the
// publish-window filtering in public/js/announcements.js. Safe to re-run:
// each doc has a fixed id, so a second run overwrites rather than piles up.
//
// Run against the emulator:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-1p \
//     node scripts/seed-announcements.js
//
// Run against production (deliberate, and it will say so):
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-announcements.js
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const ROWS = [
  {
    id: 'seed-live',
    title: 'I Can\'t: The Course is open',
    body: 'The book and the course in one: the digital edition is included, and '
      + 'every chapter\'s exercise is a workbook you keep. Start the module that '
      + 'matches where you are stuck.',
    kind: 'promo',
    priority: 20,
    audience: 'all',
    ctaLabel: 'See the course',
    ctaHref: '/bundle.html',
    publishAt: new Date(now - DAY),
    expiresAt: null,
    active: true
  },
  {
    id: 'seed-scheduled',
    title: 'Certification cohort opens next week',
    body: 'Applications for the next 1P Certified Life Coach cohort open Monday.',
    kind: 'course',
    priority: 10,
    audience: 'all',
    ctaLabel: 'Read the track',
    ctaHref: '/courses.html?course=1p-clc',
    publishAt: new Date(now + 7 * DAY),
    expiresAt: null,
    active: true
  },
  {
    id: 'seed-expired',
    title: 'Last call for the September workshop',
    body: 'This one has already come and gone — it must not appear on the dashboard.',
    kind: 'event',
    priority: 30,
    audience: 'all',
    ctaLabel: 'Details',
    ctaHref: '/events',
    publishAt: new Date(now - 14 * DAY),
    expiresAt: new Date(now - DAY),
    active: true
  }
];

async function main() {
  const target = process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : 'PRODUCTION Firestore';
  console.log(`Seeding ${ROWS.length} announcements into ${target}…`);

  const batch = db.batch();
  ROWS.forEach((r) => {
    const { id, ...data } = r;
    batch.set(db.collection('announcements').doc(id), {
      ...data,
      imageUrl: null,
      courseSlug: null,
      companyId: null,
      createdByUid: 'seed-script',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`  ${id} — ${r.title}`);
  });
  await batch.commit();

  console.log('\nDone. On /dashboard you should see exactly ONE spotlight slide');
  console.log('from this seed ("The Complete I Can\'t Experience is open").');
  console.log('The scheduled and expired rows are visible in /manage-announcements only.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
