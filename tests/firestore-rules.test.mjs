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
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, getDocs, serverTimestamp,
  arrayUnion, arrayRemove
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
  // Dialer + integration fixtures.
  await setDoc(doc(db, 'companies/co1/contacts/c1'), { name: 'Lead One', phone: '+15555550100', stage: 'new', tags: [] });
  await setDoc(doc(db, 'companies/co1/calls/call1'), {
    contactId: 'c1', direction: 'out', mode: 'softphone', status: 'completed',
    agentUid: 'adm', recordingUrl: 'https://api.twilio.com/real.mp3', recordingStatus: 'ready'
  });
  await setDoc(doc(db, 'companies/co1/private/googleOAuth'), { refreshToken: 'super-secret-token' });
  await setDoc(doc(db, 'companies/co1/integrations/google'), { connected: true, googleEmail: 'a@b.com' });
  await setDoc(doc(db, 'companies/co1/enrollments/e1'), { sequenceId: 's1', contactId: 'c1', status: 'active', currentStep: 0 });
  await setDoc(doc(db, 'oauthStates/st1'), { companyId: 'co1', uid: 'adm' });
  // A beta cohort record, written server-side only.
  await setDoc(doc(db, 'betaTesters/tester@x.com'), {
    email: 'tester@x.com', name: 'Tester', status: 'granted', feedbackCount: 0
  });
  // Dashboard spotlight announcement.
  await setDoc(doc(db, 'announcements/a1'), {
    title: 'Launch week', body: 'The new course opens Monday.', kind: 'course',
    priority: 10, audience: 'all', active: true, publishAt: new Date()
  });
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

// ── Dialer: call logs are company-scoped, recordings are server-only ──────
await t('company admin CAN read their own call logs',
  () => assertSucceeds(getDocs(collection(adm, 'companies/co1/calls'))));

await t('another company member CANNOT read call logs',
  () => assertFails(getDocs(collection(emp2, 'companies/co1/calls'))));

await t('anonymous CANNOT read call logs',
  () => assertFails(getDoc(doc(anon, 'companies/co1/calls/call1'))));

await t('company admin CAN create a call log',
  () => assertSucceeds(addDoc(collection(adm, 'companies/co1/calls'), {
    contactId: 'c1', direction: 'out', mode: 'softphone', status: 'queued', agentUid: 'adm'
  })));

await t('admin CANNOT forge a recordingUrl on create',
  () => assertFails(addDoc(collection(adm, 'companies/co1/calls'), {
    contactId: 'c1', direction: 'out', status: 'completed', agentUid: 'adm',
    recordingUrl: 'https://evil.example/x.mp3'
  })));

await t('admin CANNOT overwrite a recordingUrl on update',
  () => assertFails(updateDoc(doc(adm, 'companies/co1/calls/call1'), {
    recordingUrl: 'https://evil.example/x.mp3'
  })));

await t('admin CAN still update a call status',
  () => assertSucceeds(updateDoc(doc(adm, 'companies/co1/calls/call1'), { status: 'completed' })));

// SMS consent is server-written only: the lead form and the recordSmsConsent
// callable both leave an activity naming the actor, and a client write would
// bypass that trail.
await t('admin can update a contact\'s ordinary fields',
  () => assertSucceeds(updateDoc(doc(adm, 'companies/co1/contacts/c1'), { name: 'Lead One Renamed' })));
await t('admin cannot grant smsConsent from the client',
  () => assertFails(updateDoc(doc(adm, 'companies/co1/contacts/c1'), { smsConsent: true })));
await t('admin cannot clear a recorded decline from the client',
  () => assertFails(updateDoc(doc(adm, 'companies/co1/contacts/c1'), { smsConsentDeclinedAt: null })));
await t('admin cannot create a contact pre-consented',
  () => assertFails(setDoc(doc(adm, 'companies/co1/contacts/c9'), { name: 'Pre', smsConsent: true })));

// ── OAuth refresh tokens are readable by nobody, owner included ───────────
await t('company admin CANNOT read the Google refresh token',
  () => assertFails(getDoc(doc(adm, 'companies/co1/private/googleOAuth'))));

await t('OWNER CANNOT read the Google refresh token either',
  () => assertFails(getDoc(doc(owner, 'companies/co1/private/googleOAuth'))));

await t('nobody can write the private OAuth doc',
  () => assertFails(setDoc(doc(adm, 'companies/co1/private/googleOAuth'), { refreshToken: 'mine' })));

await t('nobody can read an OAuth state token',
  () => assertFails(getDoc(doc(adm, 'oauthStates/st1'))));

// ── Integration status is a read-only mirror ──────────────────────────────
await t('company admin CAN read integration status',
  () => assertSucceeds(getDoc(doc(adm, 'companies/co1/integrations/google'))));

await t('company admin CANNOT write integration status',
  () => assertFails(setDoc(doc(adm, 'companies/co1/integrations/google'), { connected: false })));

await t('another company CANNOT read integration status',
  () => assertFails(getDoc(doc(emp2, 'companies/co1/integrations/google'))));

// ── Sequence enrollments: the tick owns step advancement ──────────────────
await t('admin CAN stop an enrollment',
  () => assertSucceeds(updateDoc(doc(adm, 'companies/co1/enrollments/e1'), { status: 'stopped' })));

await t('admin CANNOT advance an enrollment step',
  () => assertFails(updateDoc(doc(adm, 'companies/co1/enrollments/e1'), { currentStep: 5 })));

// ── Announcements: members read, only admins write ───────────────────────
// The dashboard spotlight is a broadcast, so every signed-in member must be
// able to read it — and no member may put words in the Academy's mouth.
await t('member CAN read an announcement',
  () => assertSucceeds(getDoc(doc(solo, 'announcements/a1'))));

await t('member CAN list announcements for the spotlight',
  () => assertSucceeds(getDocs(query(collection(emp, 'announcements'), where('active', '==', true)))));

await t('signed-out visitor CANNOT read an announcement',
  () => assertFails(getDoc(doc(anon, 'announcements/a1'))));

await t('member CANNOT create an announcement',
  () => assertFails(addDoc(collection(solo, 'announcements'), { title: 'Fake', active: true })));

await t('member CANNOT edit an announcement',
  () => assertFails(updateDoc(doc(emp, 'announcements/a1'), { title: 'Hijacked' })));

await t('admin CAN create an announcement',
  () => assertSucceeds(addDoc(collection(adm, 'announcements'), { title: 'From admin', active: true })));

await t('owner CAN edit an announcement',
  () => assertSucceeds(updateDoc(doc(owner, 'announcements/a1'), { title: 'Launch week (updated)' })));

// ── Beta cohort: owner-read, server-write only ────────────────────────────
// The record joins an applicant's identity, their note about themselves and
// their course progress. It is read through the listBetaTesters callable, so
// nothing below owner needs direct access, and no client writes it at all.
await t('owner CAN read a beta tester record',
  () => assertSucceeds(getDoc(doc(owner, 'betaTesters/tester@x.com'))));

await t('owner CAN list the beta cohort',
  () => assertSucceeds(getDocs(collection(owner, 'betaTesters'))));

await t('member CANNOT read a beta tester record',
  () => assertFails(getDoc(doc(solo, 'betaTesters/tester@x.com'))));

await t('company admin CANNOT read the beta cohort directly',
  () => assertFails(getDocs(collection(adm, 'betaTesters'))));

await t('signed-out visitor CANNOT read a beta tester record',
  () => assertFails(getDoc(doc(anon, 'betaTesters/tester@x.com'))));

await t('member CANNOT create a beta tester record',
  () => assertFails(setDoc(doc(solo, 'betaTesters/solo@x.com'), { email: 'solo@x.com', status: 'granted' })));

await t('member CANNOT promote themselves in the cohort',
  () => assertFails(updateDoc(doc(emp, 'betaTesters/tester@x.com'), { status: 'completed' })));

await t('even the owner CANNOT write a beta tester record from the client',
  () => assertFails(updateDoc(doc(owner, 'betaTesters/tester@x.com'), { status: 'completed' })));

// ── Course reviews: approved ones are public, everything else is private ──
// submitCourseReview holds every review as pending until the owner approves
// it, so the course page may only ever see approved ones. No client writes.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'courseReviews/icant__solo'), { courseSlug: 'icant', uid: 'solo', rating: 5, status: 'approved' });
  await setDoc(doc(db, 'courseReviews/icant__emp'), { courseSlug: 'icant', uid: 'emp', rating: 2, status: 'pending' });
  await setDoc(doc(db, 'users/solo/courseCompletions/icant'), { courseSlug: 'icant' });
});

await t('signed-out visitor CAN read an approved review',
  () => assertSucceeds(getDoc(doc(anon, 'courseReviews/icant__solo'))));

await t('signed-out visitor CAN list approved reviews for a course',
  () => assertSucceeds(getDocs(query(collection(anon, 'courseReviews'),
    where('courseSlug', '==', 'icant'), where('status', '==', 'approved')))));

await t('signed-out visitor CANNOT read a pending review',
  () => assertFails(getDoc(doc(anon, 'courseReviews/icant__emp'))));

await t('another member CANNOT read a pending review',
  () => assertFails(getDoc(doc(solo, 'courseReviews/icant__emp'))));

await t('the author CAN read their own pending review',
  () => assertSucceeds(getDoc(doc(emp, 'courseReviews/icant__emp'))));

await t('owner CAN read a pending review',
  () => assertSucceeds(getDoc(doc(owner, 'courseReviews/icant__emp'))));

await t('member CANNOT write a review directly',
  () => assertFails(setDoc(doc(solo, 'courseReviews/icant__solo'), { courseSlug: 'icant', uid: 'solo', rating: 5, status: 'approved' })));

await t('member CANNOT approve their own review',
  () => assertFails(updateDoc(doc(emp, 'courseReviews/icant__emp'), { status: 'approved' })));

await t('member CAN read their own course completion',
  () => assertSucceeds(getDoc(doc(solo, 'users/solo/courseCompletions/icant'))));

await t('member CANNOT stamp a course completion themselves',
  () => assertFails(setDoc(doc(emp, 'users/emp/courseCompletions/icant'), { courseSlug: 'icant' })));

await t('nobody reads the review nudge queue from the client',
  () => assertFails(getDoc(doc(owner, 'reviewRequests/icant__solo'))));

// ── Digital library ──────────────────────────────────────────────────────
// storage.rules hands out a book's EPUB on users/{uid}.ownedBookIds alone, so
// that field must be as frozen against self-writes as enrolledCourseSlugs.

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'books/i-cant'), { title: 'I Can\'t', status: 'live', version: '1' });
  await setDoc(doc(db, 'users/reader'), { email: 'reader@x.com', role: 'user', ownedBookIds: ['i-cant'] });
});
const reader = env.authenticatedContext('reader').firestore();

await t('anyone CAN read book metadata (the library shelf and sales pages)',
  () => assertSucceeds(getDoc(doc(anon, 'books/i-cant'))));

await t('member CANNOT write book metadata',
  () => assertFails(setDoc(doc(solo, 'books/i-cant'), { title: 'x' }, { merge: true })));

await t('member CANNOT give themselves a book on update',
  () => assertFails(updateDoc(doc(solo, 'users/solo'), { ownedBookIds: ['i-cant'] })));

await t('member CANNOT create their user doc already owning a book',
  () => assertFails(setDoc(doc(env.authenticatedContext('fresh').firestore(), 'users/fresh'), {
    email: 'fresh@x.com', role: 'user', ownedBookIds: ['i-cant']
  })));

await t('member CAN create their user doc with an empty library',
  () => assertSucceeds(setDoc(doc(env.authenticatedContext('fresh2').firestore(), 'users/fresh2'), {
    email: 'fresh2@x.com', role: 'user', ownedBookIds: []
  })));

await t('member CAN still edit their profile while owning a book',
  () => assertSucceeds(updateDoc(doc(reader, 'users/reader'), { displayName: 'Reader' })));

await t('member CANNOT remove a book to swap in another',
  () => assertFails(updateDoc(doc(reader, 'users/reader'), { ownedBookIds: ['other-book'] })));

await t('member CAN save their reading position',
  () => assertSucceeds(setDoc(doc(reader, 'users/reader/bookProgress/i-cant'), {
    cfi: 'epubcfi(/6/4!/4/2/1:0)', fraction: 0.12, chapter: 'Chapter 1', bookmarks: [], updatedAt: serverTimestamp()
  })));

await t('member CANNOT stash arbitrary fields in a reading position',
  () => assertFails(setDoc(doc(reader, 'users/reader/bookProgress/i-cant'), {
    cfi: 'x', fraction: 0.1, ownedBookIds: ['other']
  })));

await t('member CANNOT read someone else\'s reading position',
  () => assertFails(getDoc(doc(solo, 'users/reader/bookProgress/i-cant'))));

// ── Course commitments (Parkinson's Law questionnaire) ─────────────────────
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'users/solo/courseCommitments/icant'), {
    goalDate: '2026-10-24', days: [1, 3, 5], reminderTime: '19:00', active: true
  });
});

await t('member CAN read their own course commitment',
  () => assertSucceeds(getDoc(doc(solo, 'users/solo/courseCommitments/icant'))));

await t('member CANNOT write a commitment directly (callable only)',
  () => assertFails(setDoc(doc(solo, 'users/solo/courseCommitments/icant'), {
    goalDate: '2026-10-24', days: [1], reminderTime: '19:00', active: true, lastRemindedDate: '2099-01-01'
  })));

await t('member CANNOT read someone else\'s course commitment',
  () => assertFails(getDoc(doc(emp, 'users/solo/courseCommitments/icant'))));

// ── CRM lead sources (crmSources on the company doc) and Source details ──
// The contact card's "+ Add a new source" and the CRM Settings card write
// straight to the company doc from the browser, so these pin who may.
await t('company admin CAN add a custom lead source',
  () => assertSucceeds(updateDoc(doc(adm, 'companies/co1'), { crmSources: arrayUnion('Podcast') })));
await t('company admin CAN remove a custom lead source',
  () => assertSucceeds(updateDoc(doc(adm, 'companies/co1'), { crmSources: arrayRemove('Podcast') })));
await t('company admin CANNOT slip an adminUids change in with a source',
  () => assertFails(updateDoc(doc(adm, 'companies/co1'), { crmSources: arrayUnion('X'), adminUids: ['adm', 'emp'] })));
await t('company member (not admin) CANNOT add a lead source',
  () => assertFails(updateDoc(doc(emp, 'companies/co1'), { crmSources: arrayUnion('Spam') })));
await t('admin of another company CANNOT add a lead source here',
  () => assertFails(updateDoc(doc(env.authenticatedContext('other').firestore(), 'companies/co1'), { crmSources: arrayUnion('Spam') })));
await t('company admin CAN set a custom source and source details on a contact',
  () => assertSucceeds(updateDoc(doc(adm, 'companies/co1/contacts/c1'), {
    source: 'Chamber mixer', sourceDetail: 'Referred by Mike Brandt'
  })));
await t('company member (not admin) CANNOT edit a contact source',
  () => assertFails(updateDoc(doc(emp, 'companies/co1/contacts/c1'), { sourceDetail: 'x' })));
// The Owner field falls back to users/{uid} when an admin has no members doc.
await t('admin CAN read their own user doc (owner-name fallback)',
  () => assertSucceeds(getDoc(doc(adm, 'users/adm'))));

await env.cleanup();

let failed = 0;
for (const r of results) {
  if (r[0] === 'FAIL') failed++;
  console.log(`${r[0] === 'PASS' ? '✅' : '❌'} ${r[1]}${r[2] ? ' — ' + r[2] : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
