#!/usr/bin/env node
// Brings the homepage books into the products catalog.
//
// The #shop section on index.html was two blocks of hand-written HTML: a
// hardcoded $49 → $14.99 for "I Can't" with a link straight to Amazon, and a
// "Coming Soon" block for "Work Less & Gain More" whose button linked to
// itself — while that same book already existed as a pre-order product in
// the admin. Two records, neither aware of the other.
//
// This makes the products collection the one record:
//   - creates "I Can't: Is Not A Strategy" as a live book with the sale price
//     and the Amazon link the page showed, and the existing video assets
//   - finds the existing "Work Less & Gain More" product by name and attaches
//     its video assets, leaving its status, price and date as the admin set
//
// Idempotent: the "I Can't" doc has a fixed id, so a second run updates it
// rather than adding a twin. Prints what it did, and says so loudly when the
// target is production rather than the emulator.
//
// Emulator:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-1p \
//     node scripts/seed-shop-books.js
// Production:
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-shop-books.js
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const ICANT_ID = 'book-i-cant';

const ICANT = {
  name: "I Can't: Is Not A Strategy",
  slug: 'i-cant',
  type: 'book',
  status: 'live',
  summary: "If you've ever felt held back by doubt, I Can't shows you how to challenge the beliefs that limit you and step fully into your potential. Packed with self-discovery exercises to reprogram your mind and unlock the next version of yourself.",
  description: null,
  imageUrl: '/assets/i-cant-book-poster.jpg',
  videoUrl: '/assets/i-cant-book.mp4',
  posterUrl: '/assets/i-cant-book-poster.jpg',
  price: 49,
  salePrice: 14.99,
  saleEndsAt: null,
  // The book sells on Amazon, not through Stripe. sellable stays false so no
  // surface ever offers a Stripe checkout for it; the off-site link wins.
  sellable: false,
  externalUrl: 'https://a.co/d/0fSUaomu',
  requiresShipping: false,
  inventory: null,
  showOnSite: true,
  showInDashboard: true,
  launchDate: null,
  sortOrder: 0
};

async function main() {
  const target = process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : 'PRODUCTION Firestore';
  console.log(`Seeding the homepage books into products on ${target}…`);

  const now = admin.firestore.FieldValue.serverTimestamp();
  const icantRef = db.collection('products').doc(ICANT_ID);
  const existing = await icantRef.get();
  await icantRef.set({
    ...ICANT,
    // Counters and the launch-email guard are server-owned; only set them
    // when the doc is new so a re-run never zeroes a real interest count.
    ...(existing.exists ? {} : { interestCount: 0, preorderCount: 0, depositTotal: 0, launchNotifiedAt: null, createdAt: now }),
    updatedAt: now
  }, { merge: true });
  console.log(`  ${existing.exists ? 'updated' : 'created'} products/${ICANT_ID} — ${ICANT.name}`);

  // The coming-soon book already exists as a product; attach its assets and
  // make sure it is on both channels. Its status, price and launch date are
  // the admin's to set and are left alone.
  const snap = await db.collection('products').get();
  const wlgm = snap.docs.find((d) => /work\s*less/i.test(d.data().name || ''));
  if (wlgm) {
    const cur = wlgm.data();
    const patch = { updatedAt: now };
    if (!cur.videoUrl) patch.videoUrl = '/assets/work-less-gain-more.mp4';
    if (!cur.posterUrl) patch.posterUrl = '/assets/work-less-gain-more-poster.jpg';
    if (!cur.imageUrl) patch.imageUrl = '/assets/work-less-gain-more-poster.jpg';
    if (cur.type !== 'book') patch.type = 'book';
    if (cur.showOnSite === undefined) patch.showOnSite = true;
    if (cur.showInDashboard === undefined) patch.showInDashboard = true;
    await wlgm.ref.set(patch, { merge: true });
    console.log(`  updated products/${wlgm.id} — ${cur.name} (${Object.keys(patch).length - 1} field(s))`);
  } else {
    console.log('  no "Work Less & Gain More" product found; create it in /manage-products.html and re-run.');
  }

  console.log('\nDone. The homepage #shop now renders from these records; the');
  console.log('hand-written fallback markup in index.html can be deleted.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
