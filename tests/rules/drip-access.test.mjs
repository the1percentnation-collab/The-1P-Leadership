// Firestore rules tests for The Rewrite Method's drip release.
//
// Run:  npm --prefix tests/rules install
//       npm --prefix tests/rules test
//
// Needs Java (the Firestore emulator is a JVM binary). The emulator is started
// by firebase-tools and torn down afterwards; nothing touches the real project.
//
// What these prove, in the order the spec asks for them:
//   - an unentitled user cannot read ANY video provider id, signed in or not;
//   - an entitled user cannot read a week their drip hasn't reached;
//   - a locked week's title and contents list stay readable, because the
//     visible path forward is part of the product;
//   - the bonus module opens on `reviewChoice` alone — "opted_out" included;
//   - and a member cannot backdate their own drip anchor, self-declare
//     isRewriter, or write a check-in without going through the callable.

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RULES = fileURLToPath(new URL('../../firestore.rules', import.meta.url));

const DAY = 24 * 3600 * 1000;
const SLUG = 'rewrite-method';
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', String(e).split('\n')[0]); fail++; }
}

const env = await initializeTestEnvironment({
  projectId: 'rewrite-rules-test',
  firestore: { host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8080), rules: readFileSync(RULES, 'utf8') }
});

// ── Seed: one entitled member whose drip started 10 days ago, one who never
//    bought, and the course content docs.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/buyer'), { role: 'user', enrolledCourseSlugs: [SLUG] });
  await setDoc(doc(db, 'users/stranger'), { role: 'user', enrolledCourseSlugs: [] });
  await setDoc(doc(db, 'users/finisher'), { role: 'user', enrolledCourseSlugs: [SLUG] });
  await setDoc(doc(db, `users/buyer/courseState/${SLUG}`), {
    courseSlug: SLUG, enrolledAt: new Date(Date.now() - 10 * DAY), checkins: {}, reviewChoice: null
  });
  await setDoc(doc(db, `users/finisher/courseState/${SLUG}`), {
    courseSlug: SLUG, enrolledAt: new Date(Date.now() - 50 * DAY),
    checkins: { 'week-6': { submittedAt: new Date() } }, reviewChoice: 'opted_out'
  });
  await setDoc(doc(db, `courses/${SLUG}`), { slug: SLUG, status: 'coming-soon' });
  for (const id of ['0', '1', '2', '5', '99']) {
    await setDoc(doc(db, `courses/${SLUG}/modules/${id}`), { order: Number(id), title: `Week ${id}` });
    await setDoc(doc(db, `courses/${SLUG}/modules/${id}/content/main`), {
      videos: [{ id: 'v', providerId: 'SECRET-VIMEO-ID' }]
    });
  }
});

const buyer    = env.authenticatedContext('buyer').firestore();
const stranger = env.authenticatedContext('stranger').firestore();
const finisher = env.authenticatedContext('finisher').firestore();
const anon     = env.unauthenticatedContext().firestore();
const content  = (db, id) => getDoc(doc(db, `courses/${SLUG}/modules/${id}/content/main`));

console.log('\nUnentitled readers');
await t('anonymous cannot read any video provider id', () => assertFails(content(anon, '0')));
await t('signed-in non-buyer cannot read week 0 content', () => assertFails(content(stranger, '0')));
await t('signed-in non-buyer cannot read the module list either', () =>
  assertFails(getDoc(doc(stranger, `courses/${SLUG}/modules/0`))));
await t('anyone may read the public course doc', () => assertSucceeds(getDoc(doc(anon, `courses/${SLUG}`))));

console.log('\nDrip (buyer, 10 days in — weeks 0 and 1 open, 2+ not)');
await t('week 0 content readable', () => assertSucceeds(content(buyer, '0')));
await t('week 1 content readable (7 days elapsed)', () => assertSucceeds(content(buyer, '1')));
await t('week 2 content REFUSED (14 days not elapsed)', () => assertFails(content(buyer, '2')));
await t('week 5 content REFUSED', () => assertFails(content(buyer, '5')));
await t('locked week metadata still readable (the visible path forward)', () =>
  assertSucceeds(getDoc(doc(buyer, `courses/${SLUG}/modules/5`))));

console.log('\nBonus module');
await t('bonus REFUSED before the review step', () => assertFails(content(buyer, '99')));
await t('bonus readable once reviewChoice is set — even "opted_out"', () =>
  assertSucceeds(content(finisher, '99')));

console.log('\ncourseState privacy + integrity');
await t('member reads own courseState', () => assertSucceeds(getDoc(doc(buyer, `users/buyer/courseState/${SLUG}`))));
await t('member cannot read another member courseState', () =>
  assertFails(getDoc(doc(stranger, `users/buyer/courseState/${SLUG}`))));
await t('member cannot backdate their own drip anchor', () =>
  assertFails(setDoc(doc(buyer, `users/buyer/courseState/${SLUG}`),
    { enrolledAt: new Date(Date.now() - 400 * DAY) }, { merge: true })));
await t('member cannot self-declare isRewriter', () =>
  assertFails(setDoc(doc(buyer, `users/buyer/courseState/${SLUG}`), { isRewriter: true }, { merge: true })));
await t('member cannot write their own check-in directly', () =>
  assertFails(setDoc(doc(buyer, `users/buyer/courseState/${SLUG}`),
    { checkins: { 'week-6': { submittedAt: new Date() } } }, { merge: true })));

console.log('\nEntitlement integrity');
await t('member cannot grant themselves the course', () =>
  assertFails(setDoc(doc(stranger, 'users/stranger'), { enrolledCourseSlugs: [SLUG] }, { merge: true })));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
