#!/usr/bin/env node
// Sets the send time (sendAt) on campaigns by id, the same change the send
// time field in /campaigns.html makes. For when the owner asks for a campaign
// to be scheduled and is not at the admin page to set it.
//
//   node set-campaign-send-times.js icant-audiobook-launch=2026-11-11T09:00:00-05:00
//   node set-campaign-send-times.js icant-audiobook-launch=2026-11-11T09:00:00-05:00 --apply
//
// Without --apply it is a dry run: it prints each campaign's name, subject,
// status and the old and new send time, and writes nothing.
//
// What it does, and does not do:
// - A time must carry its own offset (-05:00, Z), so it can never be read in
//   the wrong zone, and must be in the future and within a year.
// - Only a draft or an approved campaign is scheduled. One that is rejected,
//   sending or sent is reported and left alone.
// - It never approves and never sends. An approved campaign goes out at the
//   automation tick's first check after its send time, usually within a few
//   hours of it. A draft still needs approving first.
// - Clearing or changing the time, or Back to draft, in /campaigns.html
//   undoes it any time before the send.
//
// Run with Admin credentials, from the scripts/ directory after `npm install`.
// The Schedule campaigns workflow runs it: as a dry run on a pull request that
// adds lines to campaign-send-times.txt, and for real when that merges.

const OWNER_EMAIL = 'the1percentnation@gmail.com';
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
// Date, time and an explicit offset. Seconds are optional.
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
const SCHEDULABLE = ['draft', 'approved', 'ready'];

/** Split the command line into { id, at } pairs and the --apply flag. Pure. */
function parseArgs(argv, now = Date.now()) {
  const apply = argv.includes('--apply');
  const items = [];
  for (const raw of argv) {
    if (raw === '--apply') continue;
    for (const pair of String(raw).split(/[\s,]+/).filter(Boolean)) {
      const cut = pair.indexOf('=');
      const id = cut < 0 ? pair : pair.slice(0, cut);
      const time = cut < 0 ? '' : pair.slice(cut + 1);
      if (!ID_PATTERN.test(id)) throw new Error(`Not a campaign id: "${id}"`);
      if (!TIME_PATTERN.test(time)) {
        throw new Error(`${id}: the send time must look like 2026-11-11T09:00:00-05:00, with its offset.`);
      }
      const at = new Date(time);
      if (isNaN(at.getTime())) throw new Error(`${id}: "${time}" is not a real date.`);
      if (at.getTime() <= now) throw new Error(`${id}: ${time} has already passed.`);
      if (at.getTime() - now > MAX_AHEAD_MS) throw new Error(`${id}: ${time} is more than a year away.`);
      if (items.some((x) => x.id === id)) throw new Error(`${id} is listed twice.`);
      items.push({ id, at });
    }
  }
  if (!items.length) throw new Error('Name at least one id=time pair.');
  return { items, apply };
}

/** What to do with a campaign in this status. Pure. */
function decide(exists, status) {
  if (!exists) return 'missing';
  return SCHEDULABLE.includes(status || 'draft') ? 'schedule' : 'keep';
}

function fmt(date) {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit'
  }) + ' ET';
}

async function resolveCompanyId(db) {
  if (process.env.COMPANY_ID) return process.env.COMPANY_ID;
  // Same order the campaign seeds use, so this reads the CRM they wrote to.
  const users = await db.collection('users').where('email', '==', OWNER_EMAIL).limit(1).get();
  if (!users.empty) {
    const owner = users.docs[0];
    if (owner.data().companyId) return owner.data().companyId;
    const admin0 = await db.collection('companies').where('adminUids', 'array-contains', owner.id).limit(1).get();
    if (!admin0.empty) return admin0.docs[0].id;
  }
  throw new Error('No company found for the owner. Set COMPANY_ID to the one the CRM uses.');
}

async function main() {
  const { items, apply } = parseArgs(process.argv.slice(2));
  const { initAdmin, assertCredentials } = require('./lib/init');
  const { admin, db, projectId } = initAdmin();
  console.log(`Project: ${projectId}`);
  await assertCredentials(db, projectId);
  const companyId = await resolveCompanyId(db);
  console.log(`Company: ${companyId}`);
  console.log(apply ? 'Mode:    apply\n' : 'Mode:    dry run, nothing is written\n');

  let problems = 0;
  for (const { id, at } of items) {
    const ref = db.collection('companies').doc(companyId).collection('campaigns').doc(id);
    // A transaction, so a campaign that is sent or rejected between the read
    // and the write is never rescheduled.
    const { action, data } = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {};
      const a = decide(snap.exists, d.status);
      if (a === 'schedule' && apply) {
        tx.update(ref, {
          sendAt: admin.firestore.Timestamp.fromDate(at),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      return { action: a, data: d };
    });

    if (action === 'missing') {
      problems++;
      console.log(`  missing    ${id}`);
      continue;
    }
    const status = data.status || 'draft';
    const was = data.sendAt && typeof data.sendAt.toDate === 'function' ? fmt(data.sendAt.toDate()) : 'no send time';
    const label = `${data.name || id} · "${data.subject || ''}" · ${status}`;
    if (action === 'keep') {
      problems++;
      console.log(`  kept       ${label} (cannot be scheduled)`);
      continue;
    }
    console.log(`  ${apply ? 'scheduled ' : 'would set '} ${label} · was ${was} · now ${fmt(at)}`);
    if (status === 'draft') console.log('             still a draft: it will not send until it is approved.');
  }

  if (problems) throw new Error(`${problems} campaign(s) could not be scheduled.`);
  if (!apply) console.log('\nDry run. Re-run with --apply to save.');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { parseArgs, decide, fmt };
