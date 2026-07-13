/**
 * migrate-1pclc.js — writes the extracted 1P-CLC content into
 * `courses/1p-clc/modules/{id}` using the Firebase Admin SDK.
 *
 * DEFAULT IS DRY-RUN: it prints what it WOULD write and changes nothing.
 * Pass --commit to actually write. This script is intentionally NOT run as part
 * of the audit — you run it, against your live project, after reviewing the
 * extracted JSON.
 *
 * PREREQUISITES:
 *   - Node 20, `npm i firebase-admin` (or run from ../functions which has it).
 *   - A service-account key with Firestore write access, exported as
 *     GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   - The reviewed 1pclc-content.json from extract-1pclc.js in this directory.
 *
 * USAGE:
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node migrate-1pclc.js            # dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node migrate-1pclc.js --commit   # writes
 *
 * CUTOVER ORDER (do NOT skip or reorder — see scripts/README-1pclc-migration.md):
 *   1. Run extract-1pclc.js in the browser -> 1pclc-content.json
 *   2. node migrate-1pclc.js            (dry-run; review output)
 *   3. node migrate-1pclc.js --commit   (writes courses/1p-clc/modules/*)
 *   4. Verify an ENROLLED member can read the migrated lessons via the Firestore
 *      course player (the enrollment rules gate applies).
 *   5. Set courses/1p-clc.contentSource = 'firestore' (this flag already exists;
 *      loadModulesMeta in courses-data.js honors it) so the roadmap + player read
 *      Firestore instead of modules.js. Confirm 1P-CLC still renders end-to-end.
 *   6. ONLY THEN delete the lesson bodies from public/js/modules.js.
 *   Never do step 5/6 before step 4 passes — that would white-screen the live
 *   $497 course.
 */
const fs = require('fs');
const path = require('path');

const COMMIT = process.argv.includes('--commit');
const SLUG = '1p-clc';
const JSON_PATH = path.resolve(__dirname, '1pclc-content.json');

function loadContent() {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`[migrate] ${JSON_PATH} not found — run extract-1pclc.js first.`);
    process.exit(1);
  }
  const arr = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  if (!Array.isArray(arr) || !arr.length) {
    console.error('[migrate] content JSON is empty or malformed.');
    process.exit(1);
  }
  return arr;
}

async function main() {
  const content = loadContent();
  console.log(`[migrate] ${content.length} modules; mode = ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}`);

  const admin = require('firebase-admin');
  admin.initializeApp(); // uses GOOGLE_APPLICATION_CREDENTIALS
  const db = admin.firestore();

  for (const m of content) {
    const id = String(m.id);
    const doc = {
      title: m.title || `Module ${m.id}`,
      subtitle: m.subtitle || '',
      pillar: m.pillar || '',
      duration: m.duration || '',
      tagLabel: m.tagLabel || '',
      sortOrder: typeof m.sortOrder === 'number' ? m.sortOrder : Number(m.id) || 0,
      published: m.published !== false,
      html: m.html || '',
      migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'modules.js'
    };
    if (!COMMIT) {
      console.log(`  [dry-run] courses/${SLUG}/modules/${id}: "${doc.title}" (${(doc.html || '').length} chars html)`);
      continue;
    }
    await db.collection('courses').doc(SLUG).collection('modules').doc(id).set(doc, { merge: true });
    console.log(`  [written] courses/${SLUG}/modules/${id}: "${doc.title}"`);
  }

  if (!COMMIT) {
    console.log('\n[migrate] DRY-RUN complete — no data changed. Re-run with --commit to write.');
  } else {
    console.log('\n[migrate] Done. NEXT: verify an enrolled member can read the lessons,');
    console.log('  then set courses/1p-clc.contentSource = "firestore" (step 5).');
  }
}

main().catch((e) => { console.error('[migrate] failed:', e); process.exit(1); });
