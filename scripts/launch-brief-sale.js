#!/usr/bin/env node
// Opens The One Percent Brief with its launch offer: live, and free to join
// until 11:59 PM Eastern on December 6, 2026. The page shows the regular
// $12/mo struck through next to "Free"; anyone who joins before the end keeps
// it free, and checkout goes back to $12/mo or $99/yr on its own afterwards.
//
// Writes only status, salePrice and saleEndsAt. Price, plans and lessons are
// left as they are. Change or end the offer later in /manage-courses.html
// (Pricing tab), not by editing this file.
//
// Run by the "Launch The One Percent Brief sale" workflow, or by hand from
// scripts/ with Admin credentials: node launch-brief-sale.js

const { initAdmin, assertCredentials } = require('./lib/init');
const { admin, db, projectId } = initAdmin();

const SLUG = 'one-percent-brief';
// 11:59 PM EST (UTC-5) on December 6, 2026.
const SALE_ENDS = new Date('2026-12-06T23:59:00-05:00');

async function main() {
  console.log(`Project: ${projectId}`);
  await assertCredentials(db, projectId);

  const ref = db.collection('courses').doc(SLUG);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`courses/${SLUG} does not exist. Run seed-brief.js first.`);
  const before = snap.data();
  if (!(typeof before.price === 'number' && before.price > 0)) {
    throw new Error(`courses/${SLUG} has no regular price to strike through (price: ${before.price}).`);
  }
  console.log(`Before: status ${before.status}, price ${before.price}, salePrice ${before.salePrice ?? 'none'}`);

  await ref.set({
    status: 'live',
    salePrice: 0,
    saleEndsAt: admin.firestore.Timestamp.fromDate(SALE_ENDS),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  const after = (await ref.get()).data();
  console.log(`After:  status ${after.status}, price ${after.price}, salePrice ${after.salePrice}, ` +
    `sale ends ${after.saleEndsAt.toDate().toISOString()}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
