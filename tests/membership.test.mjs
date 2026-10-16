// The One Percent Membership: who gets what, at what price.
//
// The browser and the server each run a copy of membership-core. If they
// drift, the page could promise a course the server will not open, or a
// price checkout will not charge. These also pin the rules that matter to
// the business: certifications are never in the membership, the founding
// rate stops at 100, and the certification credit is three months, once.
//
// Run: node tests/membership.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loadPure } from './_load-pure.mjs';

const core = await loadPure('membership-core.js');
const server = createRequire(import.meta.url)('../functions/membership-core.js');
const {
  PLANS, FOUNDING_LIMIT, CERTIFICATION_SLUGS, DEFAULT_INCLUDED, isCertification, includedSlugs,
  memberHasCourse, planForSignup, foundingSpotsLeft, priceFor, certificationCredit
} = core;

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}
const member = (extra = {}) => ({ membershipActive: true, membership: { plan: 'founding', paidMonths: 5, ...extra } });

console.log('membership — server copy');

ok('the server copy is the generated copy of the browser module', () => {
  const src = fs.readFileSync(new URL('../public/js/membership-core.js', import.meta.url), 'utf8');
  const gen = fs.readFileSync(new URL('../functions/membership-core.js', import.meta.url), 'utf8');
  assert.ok(gen.includes(src.replace(/^export /gm, '')), 'functions/membership-core.js is stale: run node scripts/build-membership-server.cjs');
});

ok('the rules exclude exactly the certification list', () => {
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const m = rules.match(/!\(slug in \[([^\]]+)\]\)\s*&& isActiveMember\(\)/);
  assert.ok(m, 'memberHasCourse certification guard not found in firestore.rules');
  const inRules = m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort();
  assert.deepStrictEqual(inRules, [...CERTIFICATION_SLUGS].sort());
});

console.log('membership — certifications are never included');

ok('certification slugs are certifications', () => {
  for (const s of ['1p-clc', '1p-clc-leader']) assert.ok(isCertification(s));
  assert.ok(isCertification('any-new-course', { certification: true }));
  assert.ok(!isCertification('icant'));
});

ok('a certification on the list is dropped, and a member never gets one', () => {
  const config = { includedSlugs: ['icant', '1p-clc', '1p-clc-leader'] };
  assert.deepStrictEqual(includedSlugs(config), ['icant']);
  assert.ok(!memberHasCourse(member(), config, '1p-clc'));
  assert.ok(!memberHasCourse(member(), { includedSlugs: ['new-cert'] }, 'new-cert', { certification: true }));
});

ok('the default list has no certification', () => {
  assert.ok(DEFAULT_INCLUDED.every((s) => !isCertification(s)));
});

console.log('membership — access');

ok('an active member gets included courses; a lapsed one gets none', () => {
  assert.ok(memberHasCourse(member(), null, 'icant'));
  assert.ok(!memberHasCourse({ membershipActive: false }, null, 'icant'));
  assert.ok(!memberHasCourse(member(), { includedSlugs: ['mindset-foundations'] }, 'icant'));
});

console.log('membership — pricing');

ok('founding $29 / $290 for the first 100, then $39 / $390', () => {
  assert.strictEqual(FOUNDING_LIMIT, 100);
  assert.strictEqual(planForSignup(0), 'founding');
  assert.strictEqual(planForSignup(99), 'founding');
  assert.strictEqual(planForSignup(100), 'standard');
  assert.strictEqual(priceFor('founding', 'month'), 29);
  assert.strictEqual(priceFor('founding', 'year'), 290);
  assert.strictEqual(priceFor('standard', 'month'), 39);
  assert.strictEqual(priceFor('standard', 'year'), 390);
  assert.strictEqual(foundingSpotsLeft(97), 3);
  assert.strictEqual(foundingSpotsLeft(140), 0);
});

console.log('membership — certification credit');

ok('up to three months of the member\'s own rate, toward a certification only', () => {
  assert.strictEqual(certificationCredit(member(), '1p-clc'), 3 * PLANS.founding.month);
  assert.strictEqual(certificationCredit(member({ plan: 'standard', paidMonths: 2 }), '1p-clc'), 2 * PLANS.standard.month);
  assert.strictEqual(certificationCredit(member(), 'icant'), 0);
});

ok('no credit once used, or without an active membership', () => {
  assert.strictEqual(certificationCredit(member({ certCreditUsedAt: 1 }), '1p-clc'), 0);
  assert.strictEqual(certificationCredit({ membershipActive: false, membership: { paidMonths: 12 } }, '1p-clc'), 0);
  assert.strictEqual(certificationCredit(member({ paidMonths: 0 }), '1p-clc'), 0);
});

ok('browser and server agree', () => {
  assert.strictEqual(server.certificationCredit(member(), '1p-clc'), certificationCredit(member(), '1p-clc'));
  assert.deepStrictEqual(server.includedSlugs(null), includedSlugs(null));
  assert.strictEqual(server.planForSignup(100), planForSignup(100));
});

console.log('membership — books and live sessions are not included');

ok('no rule or server path opens books or members-only events to members', () => {
  const storage = fs.readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');
  assert.ok(!/membershipActive/.test(storage), 'storage.rules must not grant books to members');
  const fn = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert.ok(!/membersOnly/.test(fn), 'registerForEvent must not gate on membership');
  const bookFile = fn.slice(fn.indexOf('ownedBookIds.includes(bookId)') - 200, fn.indexOf('ownedBookIds.includes(bookId)') + 200);
  assert.ok(!/isActiveMember/.test(bookFile), 'bookFile must not open books to members');
});

ok('the pages never promise the library or a live session as part of the membership', () => {
  const page = fs.readFileSync(new URL('../public/membership.html', import.meta.url), 'utf8');
  const included = page.slice(page.indexOf('id="included-list"'), page.indexOf('</ul>', page.indexOf('id="included-list"')));
  assert.ok(!/librar|live session/i.test(included), 'included list mentions the library or live sessions');
  const home = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const card = home.slice(home.indexOf('Become a member.'), home.indexOf('href="/membership"', home.indexOf('Become a member.')));
  assert.ok(!/librar|live session/i.test(card), 'homepage member card mentions the library or live sessions');
});

console.log(`\n${passed} passed`);
