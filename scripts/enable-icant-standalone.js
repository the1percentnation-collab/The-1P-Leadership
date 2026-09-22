#!/usr/bin/env node
// Turns "I Can't: The Course" into a course anyone can buy on its own.
//
// Until now the course was bundle-only: `courses/icant` carried
// sellable: false, showOnSite: false and a bundleHref, so every surface sent
// buyers to The Complete I Can't Experience and createCheckoutSession refused
// the slug outright. The offer changed — the course sells at its own price,
// every purchase includes the digital edition of the book, and the paperback
// is an optional add-on at checkout for the cost of shipping.
//
// The code registry (public/js/courses-registry.js) already says all of this,
// but Firestore fields win over the registry (see courses-data.js), so the
// stored doc has to be corrected or the old bundle-only behavior survives the
// deploy. That is what this script does.
//
// Idempotent: a second run writes the same values.
//
// Emulator:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-1p \
//     node scripts/enable-icant-standalone.js
// Production:
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/enable-icant-standalone.js
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const SLUG = 'icant';

async function main() {
  const target = process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : 'PRODUCTION Firestore';
  console.log(`Opening ${SLUG} for standalone checkout on ${target}…`);

  const ref = db.collection('courses').doc(SLUG);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`  courses/${SLUG} does not exist yet — the registry defaults already `
      + 'describe the standalone offer, so there is nothing to correct.');
    return;
  }

  const before = snap.data();
  await ref.set({
    // Sold on its own, and listed everywhere again.
    sellable: true,
    showOnSite: true,
    // deleteField, not null: `!!c.bundleHref` is what made the landing page
    // render "See bundle deal" instead of an Enroll button.
    bundleHref: admin.firestore.FieldValue.delete(),
    // The offer itself.
    includesEbook: true,
    paperbackUpgrade: true,
    paperbackShipping: 9.95,
    shipsBook: false,
    priceNote: 'Digital book included · paperback for shipping only',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'scripts/enable-icant-standalone.js'
  }, { merge: true });

  console.log(`  updated courses/${SLUG}`);
  console.log(`    sellable       ${before.sellable} → true`);
  console.log(`    showOnSite     ${before.showOnSite} → true`);
  console.log(`    bundleHref     ${before.bundleHref || '(unset)'} → removed`);
  console.log('    includesEbook  → true (digital book at $0 on the Stripe page)');
  console.log('    paperbackUpgrade → true at $9.95 shipping');
  console.log(`  status stays ${before.status} — flip it to live in /manage-courses.html `
    + 'when you are ready to sell.');
  console.log('  Paste the digital book download link under Settings in the course '
    + 'builder; it is stored at courses/icant/private/ebook so only buyers can read it.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
