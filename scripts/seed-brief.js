#!/usr/bin/env node
// Seeds The One Percent Brief (slug: one-percent-brief), the $12/month
// membership that lives in the Courses section as one course:
//   - the course doc: title, subscription pricing, and the flags that keep it
//     off the certificate and commitment flows
//   - one module per brief from ./brief-content (brief 1 published, the rest
//     drafts so each month is released by flipping its toggle)
//
// Safe to re-run, and re-running is how edited brief copy or a new brief file
// gets picked up. Nothing the owner has set in /manage-courses.html is undone:
//   - course fields (status, price, pricing) are only written while blank, so
//     a live course is never knocked back to coming-soon or repriced
//   - a module that already exists keeps its `published` state, so a brief
//     released last month is never hidden again by a re-run
//
// Run with Admin credentials, from the scripts/ directory after `npm install`:
//   node seed-brief.js
// See scripts/README.md for the two ways to authenticate.

const fs = require('fs');
const path = require('path');
const { initAdmin, assertCredentials } = require('./lib/init');
const { admin, db, projectId } = initAdmin();

const SLUG = 'one-percent-brief';
const CONTENT_DIR = path.join(__dirname, 'brief-content');

// Every brief-NN.js in ./brief-content, in order. Adding next month's brief
// is a new file and a re-run, no change here.
const BRIEFS = fs.readdirSync(CONTENT_DIR)
  .filter((f) => /^brief-\d+\.js$/.test(f))
  .sort()
  .map((f) => require(path.join(CONTENT_DIR, f)));

async function main() {
  console.log(`Project: ${projectId}`);
  await assertCredentials(db, projectId);

  const courseRef = db.collection('courses').doc(SLUG);
  const courseSnap = await courseRef.get();
  const live = (courseSnap.exists && courseSnap.data()) || {};
  const blank = (v) => v === undefined || v === null || v === '';

  // Identity and behavior flags are always ours to write. Anything the owner
  // can change in the admin UI is only filled in while it is still blank.
  const course = {
    title: 'The One Percent Brief',
    contentSource: 'firestore',
    certificate: false,
    commitment: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (blank(live.status)) course.status = 'coming-soon';
  if (typeof live.price !== 'number') course.price = 12;
  if (!live.pricing) course.pricing = { mode: 'subscription', interval: 'month' };

  const kept = ['status', 'price', 'pricing'].filter((k) => !(k in course));
  if (kept.length) console.log(`Course: keeping your existing ${kept.join(', ')}`);
  await courseRef.set(course, { merge: true });

  for (const b of BRIEFS) {
    const { id, published, ...rest } = b;
    const ref = courseRef.collection('modules').doc(String(id));
    const existing = await ref.get();
    const keepPublished = existing.exists && typeof existing.data().published === 'boolean';

    await ref.set({
      id,
      ...rest,
      html: rest.html.trim(),
      tagLabel: rest.pillar,
      sortOrder: id,
      ...(keepPublished ? {} : { published: !!published }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const state = keepPublished ? existing.data().published : !!published;
    console.log(`Brief ${id} seeded: ${rest.title} (${state ? 'published' : 'draft'}` +
      `${keepPublished ? ', kept' : ''})`);
  }

  console.log('\nSeeded. To open The One Percent Brief to members:');
  console.log('  1. Preview it: /courses.html?course=one-percent-brief&preview=1');
  console.log('  2. Set the course status to live in /manage-courses.html.');
  console.log('     Checkout charges $12/month as a Stripe subscription. When a');
  console.log('     subscription ends in Stripe, the member loses access.');
  console.log('  3. Release one brief a month by publishing its module in');
  console.log('     /manage-courses.html. There is no automatic drip.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
