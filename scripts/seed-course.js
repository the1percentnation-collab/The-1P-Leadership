#!/usr/bin/env node
// Seeds one self-paced course's lesson content into Firestore, from a content
// pack in ./course-content/<slug>/.
//
//   node seed-course.js mindset-foundations              # writes
//   node seed-course.js mindset-foundations --dry-run    # prints the plan only
//   node seed-course.js --list                           # available packs
//
// Why this exists: seed-clc.js is the Life Coach and only the Life Coach. It
// carries cohort placeholders, the FOUNDING coupon, an exam bank and the
// certification config, none of which a self-paced $197 course has. Rather
// than fork that script once per product, this one takes a slug and writes
// lesson content, which is the only thing the remaining courses need.
//
// What this script will NOT do, on purpose:
//   - create a course that does not exist in Firestore yet (a missing course
//     doc means the slug is wrong, or the course has never been saved from
//     /manage-courses.html; guessing would create a phantom product);
//   - write price, copy, curriculum outline or status. Those live in
//     public/js/courses-registry.js and /manage-courses.html. A seed script
//     that could flip a course live is a seed script that eventually does.
//
// Safe to re-run: every module writes with merge, so re-running is how you
// pick up edited lesson copy. Member progress lives under users/{uid} and is
// never touched here.
//
// Authenticate with EITHER a service account key
// (export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json) OR your
// own Google account (gcloud auth application-default login). See README.md.

const fs = require('fs');
const path = require('path');

// lib/init pulls in firebase-admin, which only exists after `npm install` in
// this directory. Required lazily so --list, --help and pack validation still
// work in a fresh checkout, and so a typo in a lesson file is reported before
// anything asks for credentials.

const PACKS_DIR = path.join(__dirname, 'course-content');

function listPacks() {
  try {
    return fs.readdirSync(PACKS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (e) {
    return [];
  }
}

function usage(message) {
  const packs = listPacks();
  console.error(
    (message ? message + '\n\n' : '') +
    'Usage: node seed-course.js <slug> [--dry-run]\n\n' +
    (packs.length
      ? 'Content packs in ./course-content:\n' + packs.map((p) => '  ' + p).join('\n')
      : 'No content packs found in ./course-content.')
  );
  process.exit(1);
}

// A pack is only usable if every module carries what course-renderer.js reads.
// Checking here, before any credential work, means a typo in a content file
// fails in a second with the field named, rather than half way through a write.
function validatePack(pack, slug) {
  const problems = [];
  const must = (cond, msg) => { if (!cond) problems.push(msg); };

  must(pack && typeof pack === 'object', 'pack does not export an object');
  if (!pack) return problems;
  must(pack.slug === slug, `pack.slug is "${pack.slug}", expected "${slug}"`);
  must(typeof pack.expectTitle === 'string' && pack.expectTitle,
    'pack.expectTitle is required (it is the identity guard)');
  must(Array.isArray(pack.modules) && pack.modules.length, 'pack.modules is empty');
  if (!Array.isArray(pack.modules)) return problems;

  const seen = new Set();
  pack.modules.forEach((m, i) => {
    const at = `module[${i}]`;
    must(Number.isInteger(m.id) && m.id > 0, `${at}: id must be a positive integer`);
    must(!seen.has(m.id), `${at}: duplicate id ${m.id}`);
    seen.add(m.id);
    must(typeof m.title === 'string' && m.title.trim(), `${at}: title is required`);
    must(typeof m.html === 'string' && m.html.trim().length > 500,
      `${at} (${m.title}): html is missing or too short to be a lesson`);
    must(typeof m.published === 'boolean', `${at} (${m.title}): published must be true or false`);
    must(m.workbook && Array.isArray(m.workbook.prompts) && m.workbook.prompts.length,
      `${at} (${m.title}): workbook.prompts is required`);
    must(Array.isArray(m.summary) && m.summary.length,
      `${at} (${m.title}): summary is required`);
  });
  return problems;
}

// The course must already exist and must still be the course this pack was
// written for. Both halves matter: a missing doc means the slug is wrong, and
// a renamed doc means the slug now holds some other program, which is exactly
// the collision that cost this project a migration script to undo once.
async function assertCourseIdentity(db, slug, pack) {
  const ref = db.collection('courses').doc(slug);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new Error(
      `Refusing to seed: courses/${slug} does not exist.\n\n` +
      `Create it first, then re-run. In /manage-courses.html, open the "..." ` +
      `menu and choose "Seed built-in courses to database": that writes a doc ` +
      `for every registry course that does not have one yet, and skips the ` +
      `ones that do.\n\n` +
      `This script writes lesson content into an existing course and never ` +
      `invents the product record itself, because a phantom course doc with a ` +
      `guessed price is worse than a failed run.`
    );
  }

  const live = String((snap.data() || {}).title || '').trim();
  if (live && live.toLowerCase() !== pack.expectTitle.toLowerCase()) {
    throw new Error(
      `Refusing to seed: courses/${slug} is titled "${live}", but this pack ` +
      `expects "${pack.expectTitle}".\n\n` +
      `That slug is holding a different program. Seeding would merge two ` +
      `courses into one subcollection and there is no undo. Check the slug, ` +
      `or update expectTitle in course-content/${slug}/index.js if the course ` +
      `was deliberately renamed.`
    );
  }

  // Same rule one level down: our own titles mean this is a re-run, an empty
  // subcollection is a clean first run, anything else belongs to someone else.
  const ours = new Set(pack.modules.map((m) => String(m.title)));
  const existing = await ref.collection('modules').get();
  const foreign = existing.docs
    .map((doc) => ({ id: doc.id, title: String((doc.data() || {}).title || '') }))
    .filter((m) => m.title && !ours.has(m.title));

  if (foreign.length) {
    throw new Error(
      `Refusing to seed: courses/${slug} already holds ${foreign.length} lesson(s) ` +
      `that are not in this content pack:\n` +
      foreign.map((m) => `    ${String(m.id).padStart(2)}  ${m.title}`).join('\n') +
      `\n\nSeeding would merge both sets into one subcollection. If these are ` +
      `old lessons you want gone, delete them in /manage-courses.html first, ` +
      `deliberately, then re-run.`
    );
  }

  return { existingCount: existing.size };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    const packs = listPacks();
    console.log(packs.length ? packs.join('\n') : 'No content packs found.');
    return;
  }

  const dryRun = args.includes('--dry-run');
  const slug = args.find((a) => !a.startsWith('--'));
  if (!slug) usage('No course slug given.');

  // The slug becomes a path segment and a Firestore doc id. Both deserve a
  // format check rather than trust in whatever was typed at the prompt.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    usage(`"${slug}" is not a valid course slug (lowercase letters, numbers and hyphens).`);
  }

  const packPath = path.join(PACKS_DIR, slug);
  if (!fs.existsSync(packPath)) usage(`No content pack at course-content/${slug}.`);

  const pack = require(packPath);
  const problems = validatePack(pack, slug);
  if (problems.length) {
    console.error(`Content pack course-content/${slug} is not valid:\n` +
      problems.map((p) => '  - ' + p).join('\n'));
    process.exit(1);
  }

  let initAdmin, assertCredentials;
  try {
    ({ initAdmin, assertCredentials } = require('./lib/init'));
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') {
      throw new Error('Dependencies are not installed. Run `npm install` in scripts/ first.');
    }
    throw e;
  }
  const { admin, db, projectId } = initAdmin();
  console.log(`Project: ${projectId}`);
  console.log(`Course:  ${slug} (${pack.expectTitle})`);
  console.log(`Pack:    ${pack.modules.length} modules\n`);

  await assertCredentials(db, projectId);
  const { existingCount } = await assertCourseIdentity(db, slug, pack);

  if (dryRun) {
    console.log(`Dry run. ${existingCount} module doc(s) exist today. Would write:`);
    pack.modules.forEach((m) => {
      console.log(`  ${String(m.id).padStart(2)}  ${m.title}` +
        `  (${m.published ? 'published' : 'draft'}, ${m.html.trim().length} chars)`);
    });
    console.log('\nNothing was written. Re-run without --dry-run to commit.');
    return;
  }

  for (const m of pack.modules) {
    const { id, ...rest } = m;
    await db.collection('courses').doc(slug).collection('modules').doc(String(id)).set({
      id,
      ...rest,
      html: rest.html.trim(),
      tagLabel: rest.pillar || '',
      sortOrder: id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`Module ${String(id).padStart(2)} seeded (${rest.published ? 'published' : 'draft'})  ${m.title}`);
  }

  if (Array.isArray(pack.postSeed) && pack.postSeed.length) {
    console.log('\nSeeded. Still required before this course can sell:\n');
    pack.postSeed.forEach((line) => console.log(line ? '  ' + line : ''));
  } else {
    console.log('\nSeeded.');
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => {
    console.error('\n' + (e && e.message ? e.message : e));
    process.exit(1);
  });
}

// Exported so tests/course-content.test.cjs can hold every content pack to the
// same field rules this script enforces, without touching Firestore.
module.exports = { validatePack, listPacks, PACKS_DIR };
