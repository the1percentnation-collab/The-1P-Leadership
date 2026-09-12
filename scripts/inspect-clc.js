#!/usr/bin/env node
// READ ONLY. Writes nothing, ever. Prints the live state of the three course
// records the CLC slug migration touches, so you can tell what has already
// happened before running anything that writes.
//
// Why this exists: fix-clc-slugs.js decides what to do from the `1p-clc`
// record's title and price alone. That is the right test for "has the identity
// been swapped", but it says nothing about whether the Leader Coach's lessons
// were moved out first. Those are separate steps, and a record can be renamed
// by hand without them. This prints both halves so the question is settled by
// looking rather than assuming.
//
//   cd scripts && node inspect-clc.js

const { initAdmin, assertCredentials } = require('./lib/init');
const { db, projectId } = initAdmin();

const SLUGS = ['1p-clc', '1p-clc-leader', 'silence-the-voice'];

// What seed-clc.js in THIS checkout would write. Comparing production against
// it turns "eyeball the titles and decide" into a straight answer, and catches
// the case where the seed ran against an older version of the content.
const MODULES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
  require(`./clc-content/module-${String(n).padStart(2, '0')}.js`));
const EXPECTED_TITLES = new Set(MODULES.map((m) => String(m.title)));
const EXPECTED_EXAM = require('./clc-content/exam.js').length;

async function report(slug) {
  const ref = db.collection('courses').doc(slug);
  const [snap, mods] = await Promise.all([ref.get(), ref.collection('modules').get()]);

  console.log(`\ncourses/${slug}`);
  if (!snap.exists) {
    console.log('  record: MISSING');
  } else {
    const d = snap.data() || {};
    console.log(`  title:  ${d.title || '(none)'}`);
    console.log(`  price:  ${d.price === undefined ? '(none)' : d.price}`);
    console.log(`  status: ${d.status || '(none)'}`);
  }

  console.log(`  lessons: ${mods.size}`);
  const titles = [];
  mods.docs
    .sort((a, b) => Number(a.id) - Number(b.id))
    .forEach((m) => {
      const t = m.data() || {};
      const state = t.published === false ? 'draft' : 'published';
      titles.push(String(t.title || ''));
      console.log(`    ${String(m.id).padStart(2)}  ${t.title || '(untitled)'}  [${state}]`);
    });
  return { exists: snap.exists, data: snap.data() || {}, lessons: mods.size, titles };
}

// The module list only answers half the question. seed-clc.js also writes an
// exam bank, the FOUNDING coupon and the certification config, and it leaves
// cohort fields as placeholders that the /clc sales page reads. Report all of
// it, so "is the seed fully applied and what is still blank" is answered by
// looking rather than inferred from the module titles.
async function reportSeedArtifacts() {
  const ref = db.collection('courses').doc('1p-clc');
  const [course, priv, exam, coupon, cert] = await Promise.all([
    ref.get(),
    ref.collection('private').doc('cohort').get(),
    db.collection('examBank').doc('1p-clc').collection('questions').get(),
    db.collection('coupons').doc('FOUNDING').get(),
    db.collection('config').doc('certification').get()
  ]);

  console.log('\n─── Seed artifacts ───');
  const short = exam.size < EXPECTED_EXAM
    ? `  <-- this checkout has ${EXPECTED_EXAM}. Re-run seed-clc.js.` : '';
  console.log(`  exam questions:      ${exam.size}${short}`);
  console.log(`  FOUNDING coupon:     ${coupon.exists ? 'present' : 'MISSING'}`);
  console.log(`  config/certification:${cert.exists ? ' present' : ' MISSING'}`);

  const cohort = (course.exists && (course.data() || {}).cohort) || {};
  const joinUrl = priv.exists ? (priv.data() || {}).joinUrl : undefined;
  const show = (v) => {
    if (v === undefined || v === null || v === '') return 'NOT SET';
    if (v === 'TBD') return 'TBD (placeholder)';
    if (v && typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 10);
    return String(v);
  };

  console.log('\n─── Cohort details the /clc page shows ───');
  console.log(`  enrollCloseAt: ${show(cohort.enrollCloseAt)}`);
  console.log(`  startAt:       ${show(cohort.startAt)}`);
  console.log(`  callDay:       ${show(cohort.callDay)}`);
  console.log(`  callTime:      ${show(cohort.callTime)}`);
  console.log(`  capacity:      ${show(cohort.capacity)}`);
  console.log(`  joinUrl:       ${joinUrl ? 'set' : 'NOT SET'}`);
  console.log('\n  These are not editable in /manage-courses.html. Set them in the');
  console.log('  Firebase Console under Firestore, on courses/1p-clc.');
}

// Every course and its status, so "what is still not live" is one glance.
async function reportAllStatuses() {
  const snap = await db.collection('courses').get();
  console.log('\n─── All courses ───');
  snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .forEach((c) => {
      const price = c.price === undefined ? '' : `$${c.price}`;
      console.log(`  ${String(c.status || '(none)').padEnd(12)} ${String(c.id).padEnd(22)} ${price}`);
    });
}

async function main() {
  console.log(`Project: ${projectId}`);
  await assertCredentials(db, projectId);
  console.log('READ ONLY. This command writes nothing.');

  const out = {};
  for (const slug of SLUGS) out[slug] = await report(slug);
  await reportSeedArtifacts();
  await reportAllStatuses();

  // Plain-language verdict, so the numbers above do not have to be interpreted.
  const main = out['1p-clc'];
  const leader = out['1p-clc-leader'];
  const isLifeCoach = main.exists
    && !/leader/i.test(String(main.data.title || ''))
    && main.data.price !== 497;

  console.log('\n─── What this means ───');
  if (!main.exists) {
    console.log('courses/1p-clc does not exist. Nothing has been migrated.');
    console.log('NEXT: node seed-clc.js');
  } else if (!isLifeCoach) {
    console.log('courses/1p-clc still holds the Leader Coach.');
    console.log('NEXT: node fix-clc-slugs.js, then --apply, then seed-clc.js');
  } else if (main.lessons === 0) {
    console.log('courses/1p-clc is the Life Coach with no lessons. This is the');
    console.log('clean state the seed expects.');
    if (!leader.exists || leader.lessons === 0) {
      console.log('');
      console.log('WARNING: 1p-clc-leader has no lessons. If the Leader Coach was');
      console.log('ever live with seven lessons, they are not here and not under');
      console.log('1p-clc either. Check a Firestore backup before selling it.');
    } else {
      console.log(`The Leader Coach is safe at 1p-clc-leader with ${leader.lessons} lesson(s).`);
    }
    console.log('NEXT: node seed-clc.js');
  } else {
    // Decide by comparing titles, rather than asking a human to eyeball them.
    const foreign = main.titles.filter((t) => t && !EXPECTED_TITLES.has(t));
    if (foreign.length) {
      console.log(`courses/1p-clc holds ${foreign.length} lesson(s) from another program:`);
      foreign.forEach((t) => console.log(`  ${t}`));
      console.log('DO NOT SEED. Seeding would merge two programs into one.');
      console.log('The seed refuses on its own in this state.');
    } else {
      console.log(`The Life Coach is seeded: all ${main.lessons} modules match this`);
      console.log('checkout, so seed-clc.js has already run. Re-running it is safe');
      console.log('and is how you pick up edited lessons or new exam questions.');
      console.log('It no longer overwrites cohort dates or the Zoom link once set.');
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\n' + (e && e.message ? e.message : e));
  process.exit(1);
});
