#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Untangle the CLC slug collision, and archive the superseded I Can't draft.
//
// THE PROBLEM
// `courses/1p-clc` in production holds the **Leader Coach**: title "1P
// Certified Leader Coach", price 497, contentSource firestore, and seven
// migrated lesson docs. But the code registry (public/js/courses-registry.js)
// says `1p-clc` is the **1P Certified Life Coach** at $3,497, and Firestore
// fields override the registry — so that one record is currently two different
// programs wearing each other's clothes. Meanwhile `courses/1p-clc-leader`,
// the slug the registry and every code path already expect for the Leader
// Coach, does not exist at all.
//
// WHAT THIS DOES
//   1. Copies the Leader Coach course doc and its lessons from `1p-clc` to
//      `1p-clc-leader` (plus the `private` subcollection if one exists).
//   2. Verifies the copy landed before touching anything else.
//   3. Repoints enrolled members, their lesson progress, and their purchase
//      records at the new slug. (Supersedes migrate-clc-leader-slug.js, which
//      only did the enrolledCourseSlugs half.)
//   4. Resets `courses/1p-clc` to the Life Coach identity at $3,497 with no
//      lessons, and deletes the Leader Coach lessons left behind on it.
//   5. Archives `courses/silence-the-voice` (status → inactive): it is an
//      earlier draft of the I Can't course, superseded by the rebuilt `icant`.
//
// PROGRESS NOTE
// The Leader Coach used to render from code, so progress was stored as bare
// numeric ids (`users/{uid}/progress/3`) by store.js. Now that it renders from
// Firestore, course-renderer.js reads `users/{uid}/progress/{slug}__m{id}`.
// Step 3 rewrites those docs so nobody loses their place.
//
// USAGE (from the scripts/ directory, after `npm install`)
//   node fix-clc-slugs.js            # dry run — prints the plan only
//   node fix-clc-slugs.js --apply    # actually writes
//   node fix-clc-slugs.js --apply --force   # overwrite a non-empty 1p-clc-leader
//
// Needs Admin credentials. See scripts/README.md.
// ─────────────────────────────────────────────────────────────────────────

const { initAdmin, assertCredentials } = require('./lib/init');
const { admin, db, projectId } = initAdmin();

const OLD = '1p-clc';           // currently holds the Leader Coach
const NEW = '1p-clc-leader';    // where the Leader Coach belongs
const DRAFT = 'silence-the-voice';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

const log = (...a) => console.log(...a);
const plan = (...a) => console.log(APPLY ? '  ✓' : '  would:', ...a);

// The Life Coach identity that `1p-clc` gets reset to. Mirrors the registry
// entry in public/js/courses-registry.js so the two agree.
const LIFE_COACH = {
  slug: OLD,
  title: '1P Certified Life Coach',
  short: 'Life Coach',
  subtitle: 'Certified in 16 weeks. A credential, a framework license, and a client-ready program to sell.',
  eyebrow: 'Certification · 16 Weeks',
  category: 'Leadership & Coaching',
  price: 3497,
  salePrice: null,
  priceNote: 'Includes your first-year A.L.I.G.N. Practitioner License',
  pricing: { mode: 'one-time', interval: null },
  contentSource: 'firestore',
  moduleCount: 0,
  // No lessons exist yet (seed-clc.js has never been run against this project),
  // so it stays unbuyable. createCheckoutSession refuses anything not 'live'.
  status: 'coming-soon',
  showOnSite: false,
  bundleHref: null
};

async function readCollection(path) {
  const snap = await db.collection(path).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

async function copyDocs(fromPath, toPath, label) {
  const docs = await readCollection(fromPath);
  if (!docs.length) {
    log(`  no ${label} to copy`);
    return 0;
  }
  plan(`copy ${docs.length} ${label}: ${fromPath} → ${toPath}`);
  if (APPLY) {
    // Batched so a partial failure doesn't leave a half-copied course.
    const batch = db.batch();
    docs.forEach((d) => batch.set(db.collection(toPath).doc(d.id), d.data, { merge: true }));
    await batch.commit();
  }
  return docs.length;
}

async function deleteDocs(path, label) {
  const docs = await readCollection(path);
  if (!docs.length) return 0;
  plan(`delete ${docs.length} ${label} from ${path}`);
  if (APPLY) {
    const batch = db.batch();
    docs.forEach((d) => batch.delete(db.collection(path).doc(d.id)));
    await batch.commit();
  }
  return docs.length;
}

// ── Step 1 + 2: move the Leader Coach onto its own slug ──────────────────
async function moveLeaderCoach() {
  log('\n① Move the Leader Coach to its own slug');

  const oldSnap = await db.collection('courses').doc(OLD).get();
  if (!oldSnap.exists) throw new Error(`courses/${OLD} does not exist. Nothing to move.`);
  const oldData = oldSnap.data();

  // Guard: only proceed if that record really is the Leader Coach today.
  const looksLikeLeader = /leader/i.test(String(oldData.title || ''))
    || oldData.price === 497;
  if (!looksLikeLeader) {
    throw new Error(
      `courses/${OLD} does not look like the Leader Coach (title="${oldData.title}", ` +
      `price=${oldData.price}). It may already have been fixed. Aborting.`
    );
  }

  const existingLessons = await readCollection(`courses/${NEW}/modules`);
  if (existingLessons.length && !FORCE) {
    throw new Error(
      `courses/${NEW} already has ${existingLessons.length} lessons. ` +
      `Re-run with --force to overwrite them.`
    );
  }

  const leaderDoc = {
    ...oldData,
    slug: NEW,
    contentSource: 'firestore',
    migratedFrom: OLD,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  delete leaderDoc.cohort; // Life Coach concept; the Leader Coach has no cohort.

  plan(`write courses/${NEW} ("${oldData.title}", $${oldData.price})`);
  if (APPLY) await db.collection('courses').doc(NEW).set(leaderDoc, { merge: true });

  const lessonCount = await copyDocs(`courses/${OLD}/modules`, `courses/${NEW}/modules`, 'lessons');
  await copyDocs(`courses/${OLD}/private`, `courses/${NEW}/private`, 'private docs');

  // Verify before anything destructive happens later.
  if (APPLY) {
    const copied = await readCollection(`courses/${NEW}/modules`);
    if (copied.length < lessonCount) {
      throw new Error(
        `Verification failed: expected ${lessonCount} lessons at courses/${NEW}/modules, ` +
        `found ${copied.length}. Nothing has been deleted. Fix and re-run.`
      );
    }
    log(`  verified ${copied.length} lessons at courses/${NEW}/modules`);
    await db.collection('courses').doc(NEW).set(
      { moduleCount: copied.length }, { merge: true }
    );
  }

  return lessonCount;
}

// ── Step 3: repoint members at the new slug ──────────────────────────────
async function moveMembers() {
  log('\n② Repoint enrolled members');

  const snap = await db.collection('users')
    .where('enrolledCourseSlugs', 'array-contains', OLD).get();
  log(`  ${snap.size} member(s) enrolled under ${OLD}`);
  if (!snap.size) return 0;

  for (const userDoc of snap.docs) {
    plan(`user ${userDoc.id}: ${OLD} → ${NEW}`);
    if (APPLY) {
      await userDoc.ref.update({
        enrolledCourseSlugs: admin.firestore.FieldValue.arrayRemove(OLD)
      });
      await userDoc.ref.update({
        enrolledCourseSlugs: admin.firestore.FieldValue.arrayUnion(NEW)
      });
    }

    // Lesson progress. Two legacy shapes both map to `{NEW}__m{id}`:
    //   "3"            — store.js, from when the course rendered from code
    //   "1p-clc__m3"   — course-renderer.js, after the Firestore migration
    const progress = await readCollection(`users/${userDoc.id}/progress`);
    const oldPrefix = `${OLD}__m`;
    for (const p of progress) {
      let moduleId = null;
      if (/^\d+$/.test(p.id)) moduleId = p.id;
      else if (p.id.startsWith(oldPrefix)) moduleId = p.id.slice(oldPrefix.length);
      if (moduleId === null) continue;

      const target = `${NEW}__m${moduleId}`;
      if (target === p.id) continue;
      plan(`  progress ${p.id} → ${target}`);
      if (APPLY) {
        await db.collection(`users/${userDoc.id}/progress`).doc(target)
          .set(p.data, { merge: true });
        await db.collection(`users/${userDoc.id}/progress`).doc(p.id).delete();
      }
    }

    // Purchase records, so their receipt history names the right course.
    const purchases = await db.collection('users').doc(userDoc.id)
      .collection('purchases').where('courseSlug', '==', OLD).get();
    for (const pu of purchases.docs) {
      plan(`  purchase ${pu.id}: courseSlug → ${NEW}`);
      if (APPLY) await pu.ref.update({ courseSlug: NEW });
    }
  }
  return snap.size;
}

// ── Step 4: reset 1p-clc to the Life Coach ───────────────────────────────
async function resetLifeCoach() {
  log('\n③ Reset 1p-clc to the Life Coach');
  await deleteDocs(`courses/${OLD}/modules`, 'Leader Coach lessons');
  await deleteDocs(`courses/${OLD}/private`, 'private docs');
  plan(`overwrite courses/${OLD} → "${LIFE_COACH.title}" ($${LIFE_COACH.price}), status ${LIFE_COACH.status}, 0 lessons`);
  if (APPLY) {
    await db.collection('courses').doc(OLD).set({
      ...LIFE_COACH,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
  log('  NOTE: the Life Coach has no lessons yet. Run scripts/seed-clc.js to');
  log('        create its 8 modules, exam bank and cohort config.');
}

// ── Step 5: archive the superseded I Can't draft ─────────────────────────
async function archiveDraft() {
  log('\n④ Archive the superseded I Can\'t draft');
  const snap = await db.collection('courses').doc(DRAFT).get();
  if (!snap.exists) { log(`  courses/${DRAFT} does not exist — nothing to archive`); return; }
  const d = snap.data();
  if (d.status === 'inactive') { log('  already archived'); return; }
  plan(`courses/${DRAFT} ("${d.title}") status ${d.status} → inactive`);
  if (APPLY) {
    await snap.ref.set({
      status: 'inactive',
      archivedReason: 'Superseded by the rebuilt icant course (matches the final manuscript).',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
  log('  Its lessons are left in place, so nothing is lost if you want them back.');
}

async function main() {
  await assertCredentials(db, projectId);
  log(`Project: ${projectId}`);
  log(APPLY
    ? '── APPLYING CHANGES ──────────────────────────────────────'
    : '── DRY RUN (no writes). Re-run with --apply to commit. ───');

  const lessons = await moveLeaderCoach();
  const members = await moveMembers();
  await resetLifeCoach();
  await archiveDraft();

  log('\n── Summary ───────────────────────────────────────────────');
  log(`  Leader Coach lessons moved to ${NEW}: ${lessons}`);
  log(`  Members repointed: ${members}`);
  log(`  ${OLD} reset to the Life Coach at $${LIFE_COACH.price} (no lessons yet)`);
  log(`  ${DRAFT} archived`);
  if (!APPLY) {
    log('\n  Nothing was written. Re-run with --apply.');
  } else {
    log('\n  Next: open /manage-courses.html and set 1P Certified Leader Coach');
    log('  to live once Stripe is connected.');
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
