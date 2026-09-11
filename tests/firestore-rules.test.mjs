// Firestore security-rules regression tests.
//
// These run against the real Firestore emulator, so every assertion is an
// actual rule evaluation rather than a reading of the rules file.
//
// Run:
//   cd tests && npm install
//   npm test
//
// Each case below pins a rule that was found broken or dangerously open in
// the September 2026 site audit. Before the fixes, six of these failed:
// individual members could not post at all, any signed-in member could read
// every other company's posts, a non-owner admin could not list the companies
// they administer, and anyone at all could read a company's invite codes.
import fs from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, addDoc, collection, query, where, getDocs, serverTimestamp
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-1p',
  firestore: {
    host: '127.0.0.1',
    port: 8080,
    rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  }
});

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, String(e.message || e).split('\n')[0]]); }
}

// ── Seed ───────────────────────────────────────────────────────────────────
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  // An individual member: no companyId.
  await setDoc(doc(db, 'users/solo'), { email: 'solo@x.com', role: 'user', companyId: null });
  // A company member.
  await setDoc(doc(db, 'users/emp'), { email: 'emp@x.com', role: 'user', companyId: 'co1' });
  // A member of a different company.
  await setDoc(doc(db, 'users/emp2'), { email: 'emp2@x.com', role: 'user', companyId: 'co2' });
  // An admin added straight to adminUids, with no companyId on their user doc.
  await setDoc(doc(db, 'users/adm'), { email: 'adm@x.com', role: 'admin', companyId: null });
  await setDoc(doc(db, 'companies/co1'), { name: 'Co One', adminUids: ['adm'], seatCount: 10, seatsUsed: 1 });
  await setDoc(doc(db, 'companies/co2'), { name: 'Co Two', adminUids: ['other'], seatCount: 10, seatsUsed: 1 });
  await setDoc(doc(db, 'companies/co1/invites/ABC123'), { code: 'ABC123', status: 'pending', email: 'x@y.com' });
  // Existing posts: one global, one per company.
  await setDoc(doc(db, 'posts/pGlobal'), { authorUid: 'solo', companyId: null, text: 'hi', category: 'general', likeCount: 0, commentCount: 0, pinned: false });
  await setDoc(doc(db, 'posts/pCo1'), { authorUid: 'emp', companyId: 'co1', text: 'hi', category: 'general', likeCount: 0, commentCount: 0, pinned: false });
  await setDoc(doc(db, 'posts/pCo2'), { authorUid: 'emp2', companyId: 'co2', text: 'secret', category: 'general', likeCount: 0, commentCount: 0, pinned: false });
});

const solo = env.authenticatedContext('solo').firestore();
const emp = env.authenticatedContext('emp').firestore();
const emp2 = env.authenticatedContext('emp2').firestore();
const adm = env.authenticatedContext('adm').firestore();
const owner = env.authenticatedContext('own', { role: 'owner' }).firestore();
const anon = env.unauthenticatedContext().firestore();

const newPost = (uid, companyId) => ({
  authorUid: uid, authorName: 'X', authorAvatar: null, authorRole: 'user',
  text: 'hello', imageUrl: null, likeCount: 0, commentCount: 0,
  companyId, category: 'general', pinned: false, mentionedUids: [],
  createdAt: serverTimestamp(), updatedAt: serverTimestamp()
});

// ── The fix: individual members can post ───────────────────────────────────
await t('individual member (no companyId) CAN create a global post',
  () => assertSucceeds(addDoc(collection(solo, 'posts'), newPost('solo', null))));

await t('owner CAN still create a global post',
  () => assertSucceeds(addDoc(collection(owner, 'posts'), newPost('own', null))));

await t('company member CAN create a post in their own company',
  () => assertSucceeds(addDoc(collection(emp, 'posts'), newPost('emp', 'co1'))));

// ── Not a hole: company scoping still enforced ─────────────────────────────
await t('company member CANNOT post into another company',
  () => assertFails(addDoc(collection(emp, 'posts'), newPost('emp', 'co2'))));

await t('company member CANNOT post globally (would escape their company)',
  () => assertFails(addDoc(collection(emp, 'posts'), newPost('emp', null))));

await t('nobody can forge authorUid',
  () => assertFails(addDoc(collection(solo, 'posts'), newPost('emp', null))));

await t('anonymous CANNOT post',
  () => assertFails(addDoc(collection(anon, 'posts'), newPost('solo', null))));

// ── The fix: posts list is no longer open to every signed-in user ──────────
await t('member CANNOT list all posts across companies',
  () => assertFails(getDocs(collection(emp, 'posts'))));

await t('member CAN list their own company posts',
  () => assertSucceeds(getDocs(query(collection(emp, 'posts'), where('companyId', '==', 'co1')))));

await t('member CANNOT list another company posts',
  () => assertFails(getDocs(query(collection(emp, 'posts'), where('companyId', '==', 'co2')))));

await t('member CAN list global posts',
  () => assertSucceeds(getDocs(query(collection(emp, 'posts'), where('companyId', '==', null)))));

await t('owner CAN list all posts',
  () => assertSucceeds(getDocs(collection(owner, 'posts'))));

// ── The fix: companies list for a non-owner admin ─────────────────────────
await t('admin in adminUids CAN list their own companies',
  () => assertSucceeds(getDocs(query(collection(adm, 'companies'), where('adminUids', 'array-contains', 'adm')))));

await t('admin CANNOT list all companies',
  () => assertFails(getDocs(collection(adm, 'companies'))));

await t('member CANNOT list companies they do not admin',
  () => assertFails(getDocs(query(collection(emp, 'companies'), where('adminUids', 'array-contains', 'adm')))));

await t('owner CAN list all companies',
  () => assertSucceeds(getDocs(collection(owner, 'companies'))));

// ── The fix: invite codes are no longer world-readable ────────────────────
await t('anonymous CANNOT read an invite code',
  () => assertFails(getDoc(doc(anon, 'companies/co1/invites/ABC123'))));

await t('unrelated member CANNOT enumerate invite codes',
  () => assertFails(getDocs(collection(emp2, 'companies/co1/invites'))));

await t('company admin CAN still read their own invites',
  () => assertSucceeds(getDocs(collection(adm, 'companies/co1/invites'))));

await t('owner CAN still read invites',
  () => assertSucceeds(getDoc(doc(owner, 'companies/co1/invites/ABC123'))));

await env.cleanup();

let failed = 0;
for (const r of results) {
  if (r[0] === 'FAIL') failed++;
  console.log(`${r[0] === 'PASS' ? '✅' : '❌'} ${r[1]}${r[2] ? ' — ' + r[2] : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
