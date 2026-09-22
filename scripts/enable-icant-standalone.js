#!/usr/bin/env node
// Collapses the I Can't offer onto one record.
//
// Until now the course was bundle-only: `courses/icant` carried
// sellable: false, showOnSite: false and a bundleHref, so every surface sent
// buyers to The Complete I Can't Experience and createCheckoutSession refused
// the slug outright. The offer changed: $197 buys the course with the digital
// edition of the book included, and the paperback is an optional add-on at
// checkout for the cost of shipping.
//
// That left the bundle as the same offer at the same price, so it is retired.
// /bundle.html stays as the course's long-form sales page and checks out
// `icant` directly. `courses/bundle-icant` keeps its data for the purchase
// history of the members who bought it, but sellable: false takes it out of
// every listing and makes checkout refuse the slug.
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

// The offer: the book is digital and included, the paperback is the
// shipping-only add-on.
const OFFER = {
  includesEbook: true,
  paperbackUpgrade: true,
  paperbackShipping: 9.95,
  shipsBook: false,
  priceNote: 'Digital book included · paperback for shipping only'
};

// What checkout tells anyone who reaches the retired bundle through a stale
// link or an old promo.
const BUNDLE_NOTE = 'The Complete I Can\'t Experience is now just '
  + 'I Can\'t: The Course — same $197, same digital book, same paperback '
  + 'option. Enroll in the course.';

async function main() {
  const target = process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : 'PRODUCTION Firestore';
  console.log(`Collapsing the I Can't offer onto one record on ${target}…`);

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
      // /bundle.html is this course's sales page now.
      salesHref: '/bundle.html',
      ...OFFER,
      ...stamp
    }, { merge: true });
    console.log(`  updated courses/${COURSE}`);
    console.log(`    sellable         ${before.sellable} → true`);
    console.log(`    showOnSite       ${before.showOnSite} → true`);
    console.log(`    bundleHref       ${before.bundleHref || '(unset)'} → removed`);
    console.log('    salesHref        → /bundle.html');
    console.log('    includesEbook    → true (digital book at $0 on the Stripe page)');
    console.log('    paperbackUpgrade → true at $9.95 shipping');
    console.log(`  status stays ${before.status} — flip it to live in /manage-courses.html `
      + 'when you are ready to sell.');
  }

  // ── The bundle: retired, but its records stay ──────────────────────────
  const bundleRef = db.collection('courses').doc(BUNDLE);
  const bundleSnap = await bundleRef.get();
  if (!bundleSnap.exists) {
    console.log(`  courses/${BUNDLE} does not exist yet — nothing to retire.`);
  } else {
    const before = bundleSnap.data();
    await bundleRef.set({
      sellable: false,
      showOnSite: false,
      unavailableNote: BUNDLE_NOTE,
      ...OFFER,
      ...stamp
    }, { merge: true });
    console.log(`  retired courses/${BUNDLE}`);
    console.log(`    sellable         ${before.sellable} → false (off every listing, `
      + 'checkout refuses the slug)');
    console.log(`    showOnSite       ${before.showOnSite} → false`);
    console.log('    unavailableNote  → points buyers at the course');
    console.log('  Members who bought the bundle keep their enrollment and their '
      + 'purchase history; they already own the course through enrollsAlso.');
  }

  console.log('  Paste the digital book download link under Settings in the course '
    + 'builder; it is stored at courses/icant/private/ebook so only buyers can '
    + 'read it.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
