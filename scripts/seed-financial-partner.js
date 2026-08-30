#!/usr/bin/env node
// Seeds the financial services vertical:
//   - the bookkeeping partner's CRM company (placeholder name — rename in
//     /owner.html or here before going live, and add the partner's principal
//     uids to adminUids so they see ONLY their own company's CRM)
//   - config/leadRouting pointing 'financial-services' leads at that company
//   - a non-sellable 'service' product doc for visibility in the store console
//
// Compliance note: insurance and securities licenses are IN PROGRESS, not
// held. The financial-services page only captures leads; nothing transacts.
//
// Run with Admin credentials:
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-financial-partner.js
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

async function main() {
  const existing = await db.collection('companies')
    .where('name', '==', '1P Financial Services Partner').limit(1).get();
  let cid;
  if (!existing.empty) {
    cid = existing.docs[0].id;
    console.log(`Partner company already exists: ${cid}`);
  } else {
    const ref = await db.collection('companies').add({
      name: '1P Financial Services Partner', // TODO Anthony: real partner name
      adminUids: [],                          // TODO Anthony: partner principal uids
      seatCount: 5,
      seatsUsed: 0,
      tier: 'team',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    cid = ref.id;
    console.log(`Partner company created: ${cid}`);
  }

  await db.collection('config').doc('leadRouting').set({
    'financial-services': cid
  }, { merge: true });
  console.log('config/leadRouting updated');

  const prodRef = db.collection('products').doc('bookkeeping-services');
  const prod = await prodRef.get();
  if (!prod.exists) {
    await prodRef.set({
      name: 'Bookkeeping Services',
      slug: 'bookkeeping-services',
      type: 'service',
      status: 'interest',
      sellable: false,
      requiresShipping: false,
      price: null,
      description: 'Professional bookkeeping through our partner firm, in partnership with The One Percent.',
      interestCount: 0,
      preorderCount: 0,
      depositTotal: 0,
      sortOrder: 90,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('bookkeeping-services product created');
  } else {
    console.log('bookkeeping-services product exists; left untouched');
  }
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
