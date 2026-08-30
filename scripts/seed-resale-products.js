#!/usr/bin/env node
// Seeds the client-facing A.L.I.G.N. resale product set — the products
// certified coaches deliver and sell under the 1P name (workbook,
// assessment, six-week client program). Created as drafts (status
// 'planned', sellable false); Anthony finalizes content and pricing in
// /manage-products.html, then flips them live.
//
// Run with Admin credentials:
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-resale-products.js
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const PRODUCTS = [
  {
    id: 'align-client-workbook',
    name: 'The A.L.I.G.N. Client Workbook',
    slug: 'align-client-workbook',
    type: 'other',
    status: 'planned',
    sellable: false,
    requiresShipping: false,
    price: 47,
    description: 'The guided workbook clients move through alongside their 1P Certified Coach: awareness exercises, belief work, values excavation, and the goal stack.',
    coachResale: true
  },
  {
    id: 'align-assessment',
    name: 'The A.L.I.G.N. Assessment',
    slug: 'align-assessment',
    type: 'other',
    status: 'planned',
    sellable: false,
    requiresShipping: false,
    price: 29,
    description: 'The baseline and follow-up assessment that measures a client\'s alignment across the five A.L.I.G.N. stages, so progress is measured instead of assumed.',
    coachResale: true
  },
  {
    id: 'align-six-week-program',
    name: 'The A.L.I.G.N. Six-Week Program',
    slug: 'align-six-week-program',
    type: 'course',
    status: 'planned',
    sellable: false,
    requiresShipping: false,
    price: 297,
    description: 'The structured six-week client engagement every licensed practitioner can deliver: one A.L.I.G.N. stage at a time, with the workbook and assessment built in.',
    coachResale: true
  }
];

async function main() {
  for (const p of PRODUCTS) {
    const { id, ...rest } = p;
    const ref = db.collection('products').doc(id);
    const snap = await ref.get();
    if (snap.exists) { console.log(`${id} exists; left untouched`); continue; }
    await ref.set({
      ...rest,
      interestCount: 0,
      preorderCount: 0,
      depositTotal: 0,
      sortOrder: 100,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`${id} created`);
  }
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
