#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Backfill `lastContactedAt` on every existing contact.
//
// WHY THIS IS NOT OPTIONAL CLEANUP
// Firestore range queries silently EXCLUDE documents where the ordered field
// is missing. Every contact created before this change has no
// `lastContactedAt`, so until this runs, "who has gone cold?" returns a
// near-empty list — and looks perfectly healthy doing it. The feature would
// under-report to nothing without erroring. That is the worst way to be
// wrong, so the backfill ships with the field, not after it.
//
// WHAT COUNTS AS CONTACT
// The same rule the live writers use: a human actually reached the lead, or
// the lead reached us. Derived, newest-first, from
//   - contacts/{id}/emails                  (direction out|in)
//   - conversations/{id}/messages           (SMS, direction out|in)
//   - calls where contactId == this contact (connected ones only)
//   - activities of type manual_call | manual_meeting | manual_email
// Notes, stage changes, tag edits, imports and unsubscribes are ignored —
// that is the whole point of the new field.
//
// Contacts with no real contact history get an explicit `null`, not a missing
// field, so `where('lastContactedAt','==',null)` is a reliable
// "never contacted" cohort.
//
// USAGE
//   cd scripts && npm install          (once)
//   node backfill-last-contacted.js --dry-run     # always do this first
//   node backfill-last-contacted.js
//   node backfill-last-contacted.js --company=<companyId>
//
// Idempotent: re-running recomputes the same values and skips writes where
// nothing changed.
// ─────────────────────────────────────────────────────────────────────────

const { initAdmin, assertCredentials } = require('./lib/init');

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_COMPANY = (process.argv.find((a) => a.startsWith('--company=')) || '').split('=')[1] || null;

// Dispositions where someone was actually reached. Mirrors
// CONTACTED_DISPOSITIONS in public/js/crm.js — a voicemail is a message
// delivered, a no-answer or bad number is an attempt.
const CONTACTED_DISPOSITIONS = new Set(['connected', 'booked', 'callback', 'voicemail']);
const MANUAL_CONTACT = {
  manual_call: 'call',
  manual_meeting: 'meeting',
  manual_email: 'email'
};

function ms(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  const n = Date.parse(ts);
  return Number.isNaN(n) ? 0 : n;
}

/** Newest real contact across every channel, or null if there has never been one. */
async function newestContact(contactRef) {
  let best = null; // { at, ms, channel, direction }
  const consider = (ts, channel, direction) => {
    const m = ms(ts);
    if (!m) return;
    if (!best || m > best.ms) best = { at: ts, ms: m, channel, direction };
  };

  const [emails, messages, calls, activities] = await Promise.all([
    contactRef.collection('emails').orderBy('createdAt', 'desc').limit(1).get().catch(() => null),
    contactRef.parent.parent.collection('conversations').doc(contactRef.id)
      .collection('messages').orderBy('createdAt', 'desc').limit(1).get().catch(() => null),
    contactRef.parent.parent.collection('calls')
      .where('contactId', '==', contactRef.id).orderBy('createdAt', 'desc').limit(20).get().catch(() => null),
    contactRef.collection('activities').orderBy('createdAt', 'desc').limit(50).get().catch(() => null)
  ]);

  if (emails && !emails.empty) {
    const e = emails.docs[0].data();
    consider(e.createdAt, 'email', e.direction === 'in' ? 'in' : 'out');
  }
  if (messages && !messages.empty) {
    const m = messages.docs[0].data();
    consider(m.createdAt, 'sms', m.direction === 'in' ? 'in' : 'out');
  }
  if (calls) {
    for (const d of calls.docs) {
      const c = d.data();
      const connected = CONTACTED_DISPOSITIONS.has(c.disposition)
        || (Number(c.durationSec) > 0 && c.status === 'completed');
      if (connected) consider(c.createdAt, 'call', c.direction === 'in' ? 'in' : 'out');
    }
  }
  if (activities) {
    for (const d of activities.docs) {
      const a = d.data();
      const channel = MANUAL_CONTACT[a.type];
      if (channel) consider(a.createdAt, channel, 'out');
      // Inbound signals the live webhooks now stamp, recovered from history.
      if (a.type === 'sms_received') consider(a.createdAt, 'sms', 'in');
      if (a.type === 'email_received') consider(a.createdAt, 'email', 'in');
      if (a.type === 'call_inbound') consider(a.createdAt, 'call', 'in');
    }
  }
  return best;
}

async function run() {
  const { db, projectId } = initAdmin();
  await assertCredentials(db, projectId);

  console.log(`\nProject: ${projectId}`);
  console.log(DRY_RUN ? 'Mode:    DRY RUN — nothing will be written\n' : 'Mode:    WRITING\n');

  const companies = ONLY_COMPANY
    ? [await db.collection('companies').doc(ONLY_COMPANY).get()]
    : (await db.collection('companies').get()).docs;

  let totalContacts = 0, totalStamped = 0, totalNever = 0, totalSkipped = 0;

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
    let stamped = 0, never = 0, skipped = 0;
    let batch = db.batch();
    let pending = 0;

    for (const c of contacts.docs) {
      totalContacts++;
      const found = await newestContact(c.ref);
      const current = c.data().lastContactedAt;

      // Idempotence: leave a row alone when the derived value already matches.
      const currentMs = ms(current);
      if (found && currentMs === found.ms) { skipped++; totalSkipped++; continue; }
      if (!found && current === null) { skipped++; totalSkipped++; continue; }

      const patch = found
        ? { lastContactedAt: found.at, lastContactChannel: found.channel, lastContactDirection: found.direction }
        : { lastContactedAt: null, lastContactChannel: null, lastContactDirection: null };

      if (found) { stamped++; totalStamped++; } else { never++; totalNever++; }

      if (DRY_RUN) {
        const label = found
          ? `${found.channel}/${found.direction} @ ${new Date(found.ms).toISOString().slice(0, 10)}`
          : 'never contacted';
        console.log(`   ${(c.data().name || c.id).padEnd(32).slice(0, 32)} → ${label}`);
        continue;
      }

      batch.set(c.ref, patch, { merge: true });
      if (++pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0; }
    }

    if (!DRY_RUN && pending) await batch.commit();
    console.log(`   stamped ${stamped} · never contacted ${never} · unchanged ${skipped}\n`);
  }

  console.log('─'.repeat(52));
  console.log(`Contacts scanned:   ${totalContacts}`);
  console.log(`Stamped:            ${totalStamped}`);
  console.log(`Never contacted:    ${totalNever}`);
  console.log(`Already correct:    ${totalSkipped}`);
  if (DRY_RUN) console.log('\nDry run — nothing was written. Re-run without --dry-run to apply.');
}

run().catch((e) => {
  console.error('\nBackfill failed:', (e && e.message) || e);
  process.exit(1);
});
