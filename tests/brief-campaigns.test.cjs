// The One Percent Brief free-window campaigns (scripts/seed-brief-campaigns.js).
//
// Pinned here:
// 1. The copy: brand rules (no em dashes, no hype words), every draft links
//    to the Brief, and the deadline it names is the one the sale ends on.
// 2. The audience: all contacts, minus anyone already enrolled in the Brief.
// 3. The wiring: buildRecipients applies that exclusion for every mode, and
//    the campaigns page shows it and the send date.
//
// Run: node tests/brief-campaigns.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const { CAMPAIGNS, FILTER, toHtml } = require(path.join(root, 'scripts', 'seed-brief-campaigns.js'));
const fnSrc = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
const saleSrc = fs.readFileSync(path.join(root, 'scripts', 'launch-brief-sale.js'), 'utf8');
const pageSrc = fs.readFileSync(path.join(root, 'public', 'js', 'campaigns.js'), 'utf8');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

console.log('copy');
ok('three drafts with fixed ids: launch, one week, final day', () => {
  assert.deepStrictEqual(CAMPAIGNS.map((c) => c.id), ['brief-free-launch', 'brief-free-one-week', 'brief-free-final-day']);
});
ok('every draft has a subject, a send date and a join link', () => {
  CAMPAIGNS.forEach((c) => {
    assert.ok(c.subject && c.subject.length <= 80, `${c.id}: subject`);
    assert.ok(c.sendOn, `${c.id}: sendOn`);
    assert.ok(c.body.includes('https://the1pnation.com/course.html?course=one-percent-brief'), `${c.id}: no join link`);
  });
});
ok('no em or en dashes, and no hype words', () => {
  CAMPAIGNS.forEach((c) => {
    const all = c.subject + c.body;
    assert.ok(!/[—–]/.test(all), `${c.id} has a dash`);
    assert.ok(!/\b(hurry|act now|don't miss|last chance|limited time|!!)/i.test(all), `${c.id} reads as hype`);
  });
});
ok('the deadline in the copy is the one the sale ends on', () => {
  assert.match(saleSrc, /new Date\('2026-12-06T23:59:00-05:00'\)/);
  CAMPAIGNS.forEach((c) => assert.ok(/December 6|tonight/.test(c.body), `${c.id} does not name the deadline`));
  assert.match(CAMPAIGNS[1].body, /11:59 PM Eastern on Sunday, December 6/);
});
ok('the body has no {{firstName}}: sendCampaign only fills it in the subject', () => {
  CAMPAIGNS.forEach((c) => assert.ok(!/\{\{/.test(c.body), c.id));
});
ok('links render as links, with the query string kept in the href only', () => {
  const html = toHtml('Join free: https://the1pnation.com/course.html?course=x&utm_source=email');
  assert.match(html, /<a href="https:\/\/the1pnation\.com\/course\.html\?course=x&amp;utm_source=email"/);
  assert.match(html, />https:\/\/the1pnation\.com\/course\.html<\/a>/);
  assert.ok(!toHtml('<b>x</b>').includes('<b>'), 'body text is not escaped');
});

console.log('audience');
ok('all contacts, minus anyone already in the Brief', () => {
  assert.strictEqual(FILTER.mode, 'all_contacts');
  assert.strictEqual(FILTER.excludeEnrolledIn, 'one-percent-brief');
});

console.log('wiring');
ok('buildRecipients drops enrolled members by email, after every mode', () => {
  const i = fnSrc.indexOf('async function buildRecipients(');
  const body = fnSrc.slice(i, fnSrc.indexOf('\n}\n', i));
  assert.match(body, /await collectRecipients\(db, companyId, filter\)/);
  assert.match(body, /where\('enrolledCourseSlugs', 'array-contains', slug\)/);
  assert.match(body, /normalizeEmail/);
});
ok('the campaigns page shows who is skipped and when to send', () => {
  assert.match(pageSrc, /Skips anyone already in/);
  assert.match(pageSrc, /'Send on ' \+ c\.sendOn/);
});

console.log(`\n${passed} passed`);
