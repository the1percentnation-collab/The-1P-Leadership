#!/usr/bin/env node
// One-off migration: the `1p-clc` course slug now belongs to the 1P Certified
// Life Coach course. Anyone whose enrolledCourseSlugs still carries the old
// `1p-clc` value was enrolled in the Leader Coach code course, so this swaps
// that value for `1p-clc-leader` to keep their access pointed at the right
// content (and to keep them out of the paid Life Coach modules).
//
// Run once with Admin credentials, before the Life Coach course goes live:
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/migrate-clc-leader-slug.js
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

async function main() {
  const snap = await db.collection('users')
    .where('enrolledCourseSlugs', 'array-contains', '1p-clc').get();
  console.log(`Found ${snap.size} users enrolled under the old 1p-clc slug.`);
  for (const doc of snap.docs) {
    await doc.ref.update({
      enrolledCourseSlugs: admin.firestore.FieldValue.arrayRemove('1p-clc')
    });
    await doc.ref.update({
      enrolledCourseSlugs: admin.firestore.FieldValue.arrayUnion('1p-clc-leader')
    });
    console.log(`Migrated ${doc.id}`);
  }
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
