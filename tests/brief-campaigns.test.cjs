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
ok('every draft has a subject and a join link', () => {
  CAMPAIGNS.forEach((c) => {
    assert.ok(c.subject && c.subject.length <= 80, `${c.id}: subject`);
    assert.ok(c.body.includes('https://the1pnation.com/course.html?course=one-percent-brief'), `${c.id}: no join link`);
  });
});
ok('send times: launch waits for Send now, the others are real Eastern times before the deadline', () => {
  const [launch, week, final] = CAMPAIGNS;
  assert.strictEqual(launch.sendAt, null);
  assert.strictEqual(new Date(week.sendAt).toISOString(), '2026-11-30T14:00:00.000Z');
  assert.strictEqual(new Date(final.sendAt).toISOString(), '2026-12-06T13:00:00.000Z');
  assert.strictEqual(new Date(week.sendAt).getUTCDay(), 1, 'Nov 30 is not a Monday');
  assert.strictEqual(new Date(final.sendAt).getUTCDay(), 0, 'Dec 6 is not a Sunday');
  // The tick has run as much as six hours apart; the final email still has
  // most of the day before the 11:59 PM close.
  const close = new Date('2026-12-06T23:59:00-05:00').getTime();
  assert.ok(close - new Date(final.sendAt).getTime() > 12 * 3600 * 1000);
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
  assert.match(body, /addSkips\('enrolledCourseSlugs', filter && filter\.excludeEnrolledIn\)/);
  assert.match(body, /where\(field, 'array-contains', v\)/);
  assert.match(body, /normalizeEmail/);
});
ok('the campaigns page shows who is skipped and when it sends', () => {
  assert.match(pageSrc, /Skips anyone already in/);
  assert.match(pageSrc, /'Sends '\) \+ fmtWhen\(ms\)/);
});

console.log('review');
ok('the server sends only approved campaigns, never a draft', () => {
  assert.match(fnSrc, /const CAMPAIGN_SENDABLE = \['approved', 'ready'\];/);
  const i = fnSrc.indexOf('async function dispatchCampaign(');
  const body = fnSrc.slice(i, fnSrc.indexOf('\n}\n', i));
  assert.match(body, /db\.runTransaction/, 'the claim is not transactional');
  assert.match(body, /CAMPAIGN_SENDABLE\.includes\(status\)/);
  assert.ok(body.indexOf("status: 'sending'") < body.indexOf('buildRecipients'), 'recipients built before the claim');
});
ok('the tick runs the campaign step', () => {
  const i = fnSrc.indexOf('async function runTick(');
  const body = fnSrc.slice(i, fnSrc.indexOf('\n}\n', i));
  assert.match(body, /step\('campaigns', sendDueCampaigns\(db, \{ dryRun \}\)\)/);
});
ok('page and server agree on how late a scheduled send may still go out', () => {
  assert.match(fnSrc, /const CAMPAIGN_SEND_GRACE_MS = 24 \* 60 \* 60 \* 1000;/);
  assert.match(pageSrc, /const SEND_GRACE_MS = 24 \* 60 \* 60 \* 1000;/);
});
ok('review changes re-check the status in a transaction', () => {
  const i = pageSrc.indexOf('async function updateReview(');
  const body = pageSrc.slice(i, pageSrc.indexOf('\n}\n', i));
  assert.match(body, /runTransaction/);
  assert.match(body, /from\.includes\(s\)/);
  assert.match(pageSrc, /updateReview\(\['draft'\], Object\.assign\(\{\s*status: 'approved'/);
});

console.log(`\n${passed} passed`);
