// The Brief's free-window campaigns against the real Firestore emulator.
//
// 1. The shipped buildRecipients (extracted from functions/index.js) skips
//    contacts whose account is enrolled in the Brief, keeps everyone else,
//    and still drops opt-outs.
// 2. scripts/seed-brief-campaigns.js writes three drafts, and a re-run never
//    touches one that was already sent.
//
// From the repo root: `npm run e2e:campaigns` in tests/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(path.join(ROOT, 'functions', 'package.json'));
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'demo-1p' });
const db = admin.firestore();

const src = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error('not found: ' + name);
  const bodyStart = src.indexOf(') {', i) + 2;
  let d = 0;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(src.lastIndexOf('\n', i) + 1, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
// eslint-disable-next-line no-new-func
const buildRecipients = new Function('admin', 'crypto',
  ['normalizeEmail', 'isEmailSuppressed', 'ensureUnsubToken', 'collectRecipients', 'buildRecipients'].map(grab).join('\n') +
  '\nreturn buildRecipients;')(admin, crypto);

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

const CO = 'acme';
const batch = db.batch();
const set = (p, v) => batch.set(db.doc(p), v);
set('users/owner', { email: 'the1percentnation@gmail.com', companyId: CO });
set('users/joined', { email: 'joined@e2e.test', enrolledCourseSlugs: ['one-percent-brief'] });
set('users/other', { email: 'other@e2e.test', enrolledCourseSlugs: ['the-focus-tax'] });
set(`companies/${CO}/contacts/c1`, { email: 'Joined@E2E.test', name: 'Jo Joined' });
set(`companies/${CO}/contacts/c2`, { email: 'other@e2e.test', name: 'Olu Other' });
set(`companies/${CO}/contacts/c3`, { email: 'lead@e2e.test', name: 'Lee Lead', tags: ['Chapter Preview'] });
set(`companies/${CO}/contacts/c4`, { email: 'gone@e2e.test', name: 'Gus Gone', emailOptOut: true });
await batch.commit();

await t('the Brief filter skips enrolled members and opt-outs, and keeps everyone else', async () => {
  const r = await buildRecipients(db, CO, { mode: 'all_contacts', excludeEnrolledIn: 'one-percent-brief' });
  const emails = r.map((x) => x.email).sort();
  assert(JSON.stringify(emails) === JSON.stringify(['lead@e2e.test', 'other@e2e.test']), JSON.stringify(emails));
  assert(r.every((x) => x.unsubToken), 'a recipient has no unsubscribe token');
});

await t('without the filter, an enrolled member is still a recipient', async () => {
  const r = await buildRecipients(db, CO, { mode: 'all_contacts' });
  assert(r.some((x) => x.email === 'joined@e2e.test'), JSON.stringify(r.map((x) => x.email)));
});

await t('the filter applies to tag mode too', async () => {
  await db.doc('users/lead').set({ email: 'lead@e2e.test', enrolledCourseSlugs: ['one-percent-brief'] });
  const r = await buildRecipients(db, CO, { mode: 'tags', tags: ['Chapter Preview'], excludeEnrolledIn: 'one-percent-brief' });
  assert(r.length === 0, JSON.stringify(r.map((x) => x.email)));
});

const seed = () => execFileSync('node', [path.join(ROOT, 'scripts', 'seed-brief-campaigns.js')], {
  cwd: path.join(ROOT, 'scripts'),
  env: { ...process.env, GCLOUD_PROJECT: 'demo-1p', GOOGLE_CLOUD_PROJECT: 'demo-1p' },
  encoding: 'utf8'
});

await t('the seed writes three drafts to the owner\'s CRM, each with the Brief filter', async () => {
  const out = seed();
  assert(/Company: acme/.test(out), out);
  const snap = await db.collection(`companies/${CO}/campaigns`).get();
  const ids = snap.docs.map((d) => d.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(['brief-free-final-day', 'brief-free-launch', 'brief-free-one-week']), ids.join());
  snap.docs.forEach((d) => {
    const c = d.data();
    assert(c.status === 'draft' && c.sendOn && c.bodyHtml.includes('<a href='), d.id);
    assert(c.recipientFilter.excludeEnrolledIn === 'one-percent-brief', d.id);
  });
});

await t('a re-run refreshes drafts and never touches a sent campaign', async () => {
  await db.doc(`companies/${CO}/campaigns/brief-free-launch`).update({ status: 'sent', subject: 'as sent' });
  await db.doc(`companies/${CO}/campaigns/brief-free-one-week`).update({ subject: 'edited' });
  const out = seed();
  assert(/kept\s+The Brief: free window opens \(sent\)/.test(out), out);
  const launch = (await db.doc(`companies/${CO}/campaigns/brief-free-launch`).get()).data();
  const week = (await db.doc(`companies/${CO}/campaigns/brief-free-one-week`).get()).data();
  assert(launch.status === 'sent' && launch.subject === 'as sent', JSON.stringify(launch.subject));
  assert(week.subject === 'One week left to join The Brief free', week.subject);
});

const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
