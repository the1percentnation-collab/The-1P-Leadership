#!/usr/bin/env node
// Approves campaign drafts by id, the same change the Approve button in
// /campaigns.html makes. For when the owner asks for an approval and is not
// at the admin page to press it.
//
//   node approve-campaigns.js brief-free-launch icant-audiobook-launch
//   node approve-campaigns.js brief-free-launch icant-audiobook-launch --apply
//
// Without --apply it is a dry run: it prints each campaign's name, subject,
// status and send time, and writes nothing.
//
// What an approval does, and does not do:
// - Only a draft is approved. A campaign that is already approved, rejected,
//   sending or sent is reported and left alone, so a re-run changes nothing.
// - Approving never sends. A campaign with a send time (sendAt) goes out at
//   the automation tick's first check after that time. One without a send
//   time waits for Send now in /campaigns.html.
// - It can be undone in /campaigns.html (Back to draft) until the send.
//
// Run with Admin credentials, from the scripts/ directory after `npm install`.
// The Approve campaigns workflow runs it: as a dry run on a pull request that
// adds ids to campaign-approvals.txt, for real when that merges, and by hand
// from the Actions tab.

const OWNER_EMAIL = 'the1percentnation@gmail.com';
const APPROVER_ID = 'approve-campaigns-script';
const APPROVER_NAME = 'Anthony Brown Sr. (on request, via GitHub)';
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;

/** Split the command line into campaign ids and the --apply flag. Pure. */
function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const ids = [];
  for (const raw of argv) {
    if (raw === '--apply') continue;
    for (const id of String(raw).split(/[\s,]+/).filter(Boolean)) {
      if (!ID_PATTERN.test(id)) throw new Error(`Not a campaign id: "${id}"`);
      if (!ids.includes(id)) ids.push(id);
    }
  }
  if (!ids.length) throw new Error('Name at least one campaign id.');
  return { ids, apply };
}

/** What to do with a campaign in this status. Pure. */
function decide(exists, status) {
  if (!exists) return 'missing';
  return (status || 'draft') === 'draft' ? 'approve' : 'keep';
}

function describeSend(data) {
  const at = data.sendAt && typeof data.sendAt.toDate === 'function' ? data.sendAt.toDate() : null;
  if (!at) return 'no send time, waits for Send now';
  return 'sends ' + at.toLocaleString('en-US', {
    timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short'
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
  const { ids, apply } = parseArgs(process.argv.slice(2));
  const { initAdmin, assertCredentials } = require('./lib/init');
  const { admin, db, projectId } = initAdmin();
  console.log(`Project: ${projectId}`);
  await assertCredentials(db, projectId);
  const companyId = await resolveCompanyId(db);
  console.log(`Company: ${companyId}`);
  console.log(apply ? 'Mode:    apply\n' : 'Mode:    dry run, nothing is written\n');

  const FieldValue = admin.firestore.FieldValue;
  let missing = 0;
  for (const id of ids) {
    const ref = db.collection('companies').doc(companyId).collection('campaigns').doc(id);
    // A transaction, so a campaign that leaves draft between the read and the
    // write (approved, rejected or sent from the page) is never overwritten.
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const action = decide(snap.exists, data.status);
      if (action === 'approve' && apply) {
        tx.update(ref, {
          status: 'approved',
          approvedBy: APPROVER_ID,
          approvedByName: APPROVER_NAME,
          approvedAt: FieldValue.serverTimestamp(),
          rejectedBy: FieldValue.delete(),
          rejectedByName: FieldValue.delete(),
          rejectedAt: FieldValue.delete(),
          rejectionNote: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      return { action, data };
    });

    const { action, data } = outcome;
    if (action === 'missing') {
      missing++;
      console.log(`  missing   ${id}`);
      continue;
    }
    const label = `${data.name || id} · "${data.subject || ''}" · ${describeSend(data)}`;
    if (action === 'keep') console.log(`  kept      ${label} (already ${data.status})`);
    else console.log(`  ${apply ? 'approved ' : 'would approve'} ${label}`);
  }

  if (missing) throw new Error(`${missing} campaign id(s) were not found.`);
  if (!apply) console.log('\nDry run. Re-run with --apply to approve.');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { parseArgs, decide, APPROVER_NAME };
