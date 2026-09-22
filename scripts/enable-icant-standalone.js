#!/usr/bin/env node
// Puts the I Can't offer on its new footing, for the course and the bundle.
//
// Until now the course was bundle-only: `courses/icant` carried
// sellable: false, showOnSite: false and a bundleHref, so every surface sent
// buyers to The Complete I Can't Experience and createCheckoutSession refused
// the slug outright. The offer changed. Both records now sell at $197 with
// the digital edition of the book included, and both offer the paperback as
// an optional add-on at checkout for the cost of shipping — so neither one
// undercuts the other. `courses/bundle-icant` no longer ships the paperback
// in the price.
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

const COURSE = 'icant';
const BUNDLE = 'bundle-icant';

// What both records share: the book is digital and included, the paperback is
// the shipping-only add-on.
const OFFER = {
  includesEbook: true,
  paperbackUpgrade: true,
  paperbackShipping: 9.95,
  shipsBook: false,
  priceNote: 'Digital book included · paperback for shipping only'
};

async function main() {
  const target = process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : 'PRODUCTION Firestore';
  console.log(`Putting the I Can't offer on its new footing on ${target}…`);

  const stamp = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'scripts/enable-icant-standalone.js'
  };

  // ── The course: sold on its own now ────────────────────────────────────
  const courseRef = db.collection('courses').doc(COURSE);
  const courseSnap = await courseRef.get();
  if (!courseSnap.exists) {
    console.log(`  courses/${COURSE} does not exist yet — the registry defaults already `
      + 'describe the offer, so there is nothing to correct.');
  } else {
    const before = courseSnap.data();
    await courseRef.set({
      // Sold on its own, and listed everywhere again.
      sellable: true,
      showOnSite: true,
      // delete(), not null: `!!c.bundleHref` is what made the landing page
      // render "See bundle deal" instead of an Enroll button.
      bundleHref: admin.firestore.FieldValue.delete(),
      ...OFFER,
      ...stamp
    }, { merge: true });
    console.log(`  updated courses/${COURSE}`);
    console.log(`    sellable         ${before.sellable} → true`);
    console.log(`    showOnSite       ${before.showOnSite} → true`);
    console.log(`    bundleHref       ${before.bundleHref || '(unset)'} → removed`);
    console.log('    includesEbook    → true (digital book at $0 on the Stripe page)');
    console.log('    paperbackUpgrade → true at $9.95 shipping');
    console.log(`  status stays ${before.status} — flip it to live in /manage-courses.html `
      + 'when you are ready to sell.');
  }

  // ── The bundle: the $197 includes the digital book, not the paperback ──
  const bundleRef = db.collection('courses').doc(BUNDLE);
  const bundleSnap = await bundleRef.get();
  if (!bundleSnap.exists) {
    console.log(`  courses/${BUNDLE} does not exist yet — nothing to correct.`);
  } else {
    const before = bundleSnap.data();
    await bundleRef.set({ ...OFFER, ...stamp }, { merge: true });
    console.log(`  updated courses/${BUNDLE}`);
    console.log(`    shipsBook        ${before.shipsBook} → false`);
    console.log('    includesEbook    → true');
    console.log('    paperbackUpgrade → true at $9.95 shipping');
  }

  console.log('  Paste the digital book download link under Settings in the course '
    + 'builder for both records; it is stored at courses/{slug}/private/ebook so '
    + 'only buyers can read it.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
