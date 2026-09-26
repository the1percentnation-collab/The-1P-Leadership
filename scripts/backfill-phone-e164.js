#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Rewrite every contact's `phone` in E.164.
//
// WHY
// The inbound SMS and voice webhooks match a contact with
// `where('phone', '==', normalizePhone(From))`, an exact comparison against
// "+14055550123". Until now the CRM stored whatever was typed: "(405)
// 555-0123", "405.555.0123", "405-555-0123". None of those match, so the
// first reply from any such lead created a second contact named after the
// number, and SMS consent was granted to that duplicate instead of the real
// record. Every write path now normalizes on the way in; this brings the
// rows written before that into line.
//
// It also reports, without merging, any contacts that collapse onto the same
// E.164 number so they can be reviewed by hand. Merging is a judgement call
// (two people can share a landline); this script never deletes anything.
//
// USAGE
//   cd scripts && npm install          (once)
//   node backfill-phone-e164.js --dry-run     # always do this first
//   node backfill-phone-e164.js
//   node backfill-phone-e164.js --company=<companyId>
//
// Idempotent: a phone already in E.164 is left alone.
// ─────────────────────────────────────────────────────────────────────────

const { initAdmin, assertCredentials } = require('./lib/init');

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_COMPANY = (process.argv.find((a) => a.startsWith('--company=')) || '').split('=')[1] || null;

// Mirrors normalizePhone in functions/index.js and public/js/phone.js.
function normalizePhone(p) {
  if (!p) return null;
  let s = String(p).trim().replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s[0] !== '+') {
    const digits = s.replace(/\D/g, '');
    s = digits.length === 10 ? '+1' + digits : '+' + digits;
  }
  return s;
}

async function run() {
  const { db, projectId } = initAdmin();
  await assertCredentials(db, projectId);

  console.log(`\nProject: ${projectId}`);
  console.log(DRY_RUN ? 'Mode:    DRY RUN — nothing will be written\n' : 'Mode:    WRITING\n');

  const companies = ONLY_COMPANY
    ? [await db.collection('companies').doc(ONLY_COMPANY).get()]
    : (await db.collection('companies').get()).docs;

  let totalContacts = 0, totalRewritten = 0, totalUnchanged = 0, totalEmptied = 0;

  for (const companySnap of companies) {
    if (!companySnap.exists) {
      console.error(`Company ${ONLY_COMPANY} does not exist.`);
      process.exit(1);
    }
    const cid = companySnap.id;
    const name = (companySnap.data() || {}).name || cid;
    const contacts = await db.collection('companies').doc(cid).collection('contacts').get();
    if (contacts.empty) continue;

    console.log(`${name} (${cid}) — ${contacts.size} contact(s)`);
    let rewritten = 0, unchanged = 0, emptied = 0;
    const byNumber = new Map(); // E.164 → [{ id, name, email }]
    let batch = db.batch();
    let pending = 0;

    for (const c of contacts.docs) {
      totalContacts++;
      const data = c.data() || {};
      const raw = data.phone;
      if (!raw) { unchanged++; totalUnchanged++; continue; }
      const clean = normalizePhone(raw);

      if (clean) {
        const rows = byNumber.get(clean) || [];
        rows.push({ id: c.id, name: data.name || '', email: data.email || '' });
        byNumber.set(clean, rows);
      }

      if (clean === raw) { unchanged++; totalUnchanged++; continue; }

      if (clean) { rewritten++; totalRewritten++; } else { emptied++; totalEmptied++; }

      if (DRY_RUN) {
        console.log(`   ${(data.name || c.id).padEnd(32).slice(0, 32)} ${String(raw).padEnd(20).slice(0, 20)} → ${clean || '(cleared: no digits)'}`);
        continue;
      }

      // The original is kept beside the clean value once, so a bad guess
      // (a non-US number typed without its country code) can be recovered.
      const patch = { phone: clean };
      if (!data.phoneRaw) patch.phoneRaw = String(raw);
      batch.set(c.ref, patch, { merge: true });
      if (++pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0; }
    }

    if (!DRY_RUN && pending) await batch.commit();
    console.log(`   rewritten ${rewritten} · cleared ${emptied} · unchanged ${unchanged}`);

    const dupes = [...byNumber.entries()].filter(([, rows]) => rows.length > 1);
    if (dupes.length) {
      console.log(`   ${dupes.length} number(s) shared by more than one contact — review by hand:`);
      for (const [num, rows] of dupes) {
        console.log(`     ${num}`);
        rows.forEach((r) => console.log(`        ${r.id}  ${r.name}${r.email ? '  <' + r.email + '>' : ''}`));
      }
    }
    console.log('');
  }

  console.log('─'.repeat(52));
  console.log(`Contacts scanned:   ${totalContacts}`);
  console.log(`Rewritten:          ${totalRewritten}`);
  console.log(`Cleared (no digits): ${totalEmptied}`);
  console.log(`Already E.164:      ${totalUnchanged}`);
  if (DRY_RUN) console.log('\nDry run — nothing was written. Re-run without --dry-run to apply.');
}

run().catch((e) => {
  console.error('\nBackfill failed:', (e && e.message) || e);
  process.exit(1);
});
