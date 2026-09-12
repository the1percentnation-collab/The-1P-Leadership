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
  mods.docs
    .sort((a, b) => Number(a.id) - Number(b.id))
    .forEach((m) => {
      const t = m.data() || {};
      const state = t.published === false ? 'draft' : 'published';
      console.log(`    ${String(m.id).padStart(2)}  ${t.title || '(untitled)'}  [${state}]`);
    });
  return { exists: snap.exists, data: snap.data() || {}, lessons: mods.size };
}

async function main() {
  console.log(`Project: ${projectId}`);
  await assertCredentials(db, projectId);
  console.log('READ ONLY. This command writes nothing.');

  const out = {};
  for (const slug of SLUGS) out[slug] = await report(slug);

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
    console.log(`courses/1p-clc is the Life Coach but already has ${main.lessons} lesson(s).`);
    console.log('Compare the titles above against the Life Coach modules. If they');
    console.log('are Leader Coach lessons, DO NOT SEED. Seeding would merge the two');
    console.log('programs together. The seed will refuse on its own in that case.');
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\n' + (e && e.message ? e.message : e));
  process.exit(1);
});
