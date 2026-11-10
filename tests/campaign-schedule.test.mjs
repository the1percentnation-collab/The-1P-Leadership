// sendDueCampaigns — the tick step that sends approved campaigns on their date.
//
// Runs the REAL functions from functions/index.js against the Firestore
// emulator. Every campaign targets a company with no contacts, so a send
// builds an empty recipient list and finishes as 'sent' without calling an
// email provider.
//
//   - Only an approved campaign whose sendAt has arrived goes out.
//   - Future, undated, missed (over a day late), draft and rejected
//     campaigns are left exactly as they were.
//   - A dry run reports and writes nothing.
//   - Two sends racing for one campaign: exactly one wins.
//
// Requires: `cd functions && npm install`, and the emulator (this file is run
// from the same `emulators:exec` as the rules suite — see package.json).
import { createRequire } from 'node:module';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-1p';
process.env.GOOGLE_CLOUD_PROJECT = process.env.GCLOUD_PROJECT;

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const { sendDueCampaigns, dispatchCampaign } = require('../functions/index.js');

const db = admin.firestore();
const HOUR = 60 * 60 * 1000;
const at = (offset) => admin.firestore.Timestamp.fromMillis(Date.now() + offset);
const CO = 'sched-co';
const col = db.collection('companies').doc(CO).collection('campaigns');

let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { console.error('  ✗ ' + name + (detail ? '\n    ' + detail : '')); process.exitCode = 1; }
}

const base = { subject: 'Hello', bodyText: 'Hi', recipientFilter: { mode: 'all_contacts' } };
const seed = {
  due:       { ...base, status: 'approved', sendAt: at(-HOUR) },
  future:    { ...base, status: 'approved', sendAt: at(HOUR) },
  undated:   { ...base, status: 'approved' },
  missed:    { ...base, status: 'approved', sendAt: at(-30 * HOUR) },
  draft:     { ...base, status: 'draft', sendAt: at(-HOUR) },
  rejected:  { ...base, status: 'rejected', sendAt: at(-HOUR) }
};
await db.collection('companies').doc(CO).set({ name: 'Schedule Co' });
for (const [id, data] of Object.entries(seed)) await col.doc(id).set(data);
const status = async (id) => (await col.doc(id).get()).data().status;

console.log('dry run');
const dry = await sendDueCampaigns(db, { dryRun: true });
ok('reports only the due campaign as sendable', JSON.stringify(dry.wouldSend) === '["due"]', JSON.stringify(dry));
ok('reports the missed one', JSON.stringify(dry.missed) === '["missed"]', JSON.stringify(dry));
ok('writes nothing', (await status('due')) === 'approved');

console.log('real run');
const res = await sendDueCampaigns(db);
ok('sends exactly one campaign with no step error', res.sent === 1 && !res.error, JSON.stringify(res));
const due = (await col.doc('due').get()).data();
ok('the due campaign is sent and marked scheduled', due.status === 'sent' && due.sentVia === 'scheduled' && due.sentAt, JSON.stringify(due.status));
for (const id of ['future', 'undated', 'missed']) ok(`${id} stays approved`, (await status(id)) === 'approved');
ok('a draft with a past date is not sent', (await status('draft')) === 'draft');
ok('a rejected campaign is not sent', (await status('rejected')) === 'rejected');

const again = await sendDueCampaigns(db);
ok('a second tick sends nothing', again.sent === 0, JSON.stringify(again));

console.log('race');
await col.doc('race').set({ ...base, status: 'approved' });
const outcomes = await Promise.allSettled([
  dispatchCampaign(db, CO, 'race', { sentVia: 'manual' }),
  dispatchCampaign(db, CO, 'race', { sentVia: 'scheduled' })
]);
const won = outcomes.filter((o) => o.status === 'fulfilled').length;
const refused = outcomes.filter((o) => o.status === 'rejected' && o.reason && o.reason.code === 'failed-precondition').length;
ok('exactly one of two simultaneous sends goes through', won === 1 && refused === 1, JSON.stringify(outcomes.map((o) => o.status)));

console.log('draft');
let draftErr = null;
try { await dispatchCampaign(db, CO, 'draft'); } catch (e) { draftErr = e; }
ok('dispatching a draft is refused', draftErr && draftErr.code === 'failed-precondition', draftErr && draftErr.message);

console.log(`\n${passed} passed`);
process.exit(process.exitCode || 0);
