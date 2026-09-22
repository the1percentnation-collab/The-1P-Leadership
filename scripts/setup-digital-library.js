#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Switch The Complete I Can't Experience to the digital library.
//
// The code defaults in functions/index.js (COURSE_FULFILLMENT) already say:
//   bundle-icant        digital book, nothing ships
//   bundle-icant-print  digital book + shipped paperback
//   icant               grants the book to anyone in the course
// but a field on the Firestore course record wins over the code. If
// courses/bundle-icant still carries `shipsBook: true` from before, the
// digital bundle would keep asking for an address. This script makes the
// records agree with the code, creates the paperback option's record, and
// puts the book in the library of everyone who already has the course.
//
// USAGE
//   cd scripts && npm install          (once)
//   node setup-digital-library.js              # prints the plan, writes nothing
//   node setup-digital-library.js --apply      # commits it
//   node setup-digital-library.js --apply --print-price=227
//
// Idempotent: re-running changes nothing that is already right.
// ─────────────────────────────────────────────────────────────────────────

const { initAdmin, assertCredentials } = require('./lib/init');

const APPLY = process.argv.includes('--apply');
const priceArg = (process.argv.find((a) => a.startsWith('--print-price=')) || '').split('=')[1];
const PRINT_PRICE = priceArg ? Number(priceArg) : 227;
if (!(PRINT_PRICE > 0)) {
  console.error('--print-price must be a positive number of dollars.');
  process.exit(1);
}

const BOOK_ID = 'i-cant';
const GRANTING_SLUGS = ['bundle-icant', 'bundle-icant-print', 'icant'];

async function main() {
  const { admin, db, projectId } = initAdmin();
  await assertCredentials(db, projectId);
  const FV = admin.firestore.FieldValue;
  console.log(`Project: ${projectId}${APPLY ? '' : '   (dry run: pass --apply to write)'}\n`);

  // ── Course records ──────────────────────────────────────────────────
  const bundleRef = db.collection('courses').doc('bundle-icant');
  const printRef = db.collection('courses').doc('bundle-icant-print');
  const icantRef = db.collection('courses').doc('icant');
  const [bundle, print, icant] = await Promise.all([bundleRef.get(), printRef.get(), icantRef.get()]);

  const b = bundle.exists ? bundle.data() : null;
  if (!b) {
    console.log('courses/bundle-icant does not exist yet. Publish it from Manage Courses first, then re-run.');
  } else {
    const patch = {};
    if (b.shipsBook !== false) patch.shipsBook = false;
    if (JSON.stringify(b.grantsBooks || null) !== JSON.stringify([BOOK_ID])) patch.grantsBooks = [BOOK_ID];
    if (Object.keys(patch).length) {
      console.log(`courses/bundle-icant: set ${JSON.stringify(patch)} (digital, nothing ships)`);
      if (APPLY) await bundleRef.set(patch, { merge: true });
    } else {
      console.log('courses/bundle-icant: already digital.');
    }
  }

  if (icant.exists && JSON.stringify(icant.data().grantsBooks || null) !== JSON.stringify([BOOK_ID])) {
    console.log('courses/icant: set grantsBooks ["i-cant"]');
    if (APPLY) await icantRef.set({ grantsBooks: [BOOK_ID] }, { merge: true });
  }

  if (!print.exists && b) {
    // Mirror the digital bundle's status so both options open together.
    const doc = {
      kind: 'bundle',
      optionOf: 'bundle-icant',
      title: 'The Complete I Can\'t Experience + Paperback',
      short: 'Bundle + Paperback',
      status: b.status || 'coming-soon',
      price: PRINT_PRICE,
      shipsBook: true,
      grantsBooks: [BOOK_ID],
      enrollsAlso: ['icant'],
      sellable: true,
      showOnSite: false,
      showInDashboard: false,
      bundleHref: '/bundle.html',
      createdAt: FV.serverTimestamp()
    };
    console.log(`courses/bundle-icant-print: create (status ${doc.status}, $${PRINT_PRICE}, ships the paperback)`);
    if (APPLY) await printRef.set(doc);
  } else if (print.exists) {
    console.log(`courses/bundle-icant-print: exists (status ${print.data().status}, $${print.data().price}). Left as is.`);
  }

  // ── Backfill: everyone who already has the course gets the book ──────
  let granted = 0;
  const seen = new Set();
  for (const slug of GRANTING_SLUGS) {
    const snap = await db.collection('users').where('enrolledCourseSlugs', 'array-contains', slug).get();
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const owned = Array.isArray(d.data().ownedBookIds) ? d.data().ownedBookIds : [];
      if (owned.includes(BOOK_ID)) continue;
      granted++;
      console.log(`  grant ${BOOK_ID} -> ${d.data().email || d.id}`);
      if (APPLY) await d.ref.set({ ownedBookIds: FV.arrayUnion(BOOK_ID) }, { merge: true });
    }
  }
  console.log(`\nBackfill: ${granted} member(s) ${APPLY ? 'granted' : 'would be granted'} the book (${seen.size} enrolled in total).`);
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
