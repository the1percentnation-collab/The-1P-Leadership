// Exercise contactFreshness against the real shipped code, extracted from
// public/js/crm.js, so the thresholds the CRM renders are the thresholds
// asserted here.
//
// The distinction under test is the whole point of the field: a lead whose
// record was edited is NOT a lead who was contacted. These assertions pin the
// bands (warm <7d, cooling 7-14d, stagnant 14-30d, cold >30d) and the separate
// never-contacted state.
//
// Run: node tests/crm-freshness.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'crm.js'), 'utf8');
const start = src.indexOf('export const CONTACT_FRESHNESS');
const end = src.indexOf('export async function addManualActivity');
assert.ok(start > 0 && end > start, 'could not locate the freshness helpers in crm.js');

// Strip the ES module keywords so the block runs as plain script, and supply
// the one helper it closes over (toDate, defined elsewhere in crm.js).
const code = src.slice(start, end).replace(/^export /gm, '');
const fn = new Function('Date', 'Math', `
  function toDate(ts) {
    if (!ts) return null;
    if (ts instanceof Date) return ts;
    if (ts && typeof ts.toDate === 'function') return ts.toDate();
    return null;
  }
  ${code}
  return { contactFreshness, CONTACT_FRESHNESS };
`);
const { contactFreshness, CONTACT_FRESHNESS } = fn(Date, Math);

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000 - 1000);
const at = (n, extra = {}) => contactFreshness({ lastContactedAt: daysAgo(n), ...extra });

console.log('bands');
ok('today is warm', () => assert.strictEqual(at(0).id, 'warm'));
ok('6 days is warm', () => assert.strictEqual(at(6).id, 'warm'));
ok('7 days tips into cooling', () => assert.strictEqual(at(7).id, 'cooling'));
ok('13 days is cooling', () => assert.strictEqual(at(13).id, 'cooling'));
ok('14 days tips into stagnant', () => assert.strictEqual(at(14).id, 'stagnant'));
ok('29 days is stagnant', () => assert.strictEqual(at(29).id, 'stagnant'));
ok('30 days tips into cold', () => assert.strictEqual(at(30).id, 'cold'));
ok('a year is cold', () => assert.strictEqual(at(365).id, 'cold'));

console.log('never contacted');
ok('a missing timestamp is its own state, not cold', () => {
  const f = contactFreshness({});
  assert.strictEqual(f.id, 'never');
  assert.strictEqual(f.never, true);
  assert.strictEqual(f.days, null);
  assert.notStrictEqual(f.color, CONTACT_FRESHNESS.find((b) => b.id === 'cold').color);
});
ok('null is treated the same as missing', () => {
  assert.strictEqual(contactFreshness({ lastContactedAt: null }).id, 'never');
});
ok('a null contact object does not throw', () => {
  assert.strictEqual(contactFreshness(null).id, 'never');
});

console.log('phrasing');
ok('outbound reads as us contacting them', () => {
  const f = contactFreshness({ lastContactedAt: daysAgo(3), lastContactChannel: 'email', lastContactDirection: 'out' });
  assert.strictEqual(f.detail, 'Emailed 3d ago');
});
ok('inbound reads as them reaching us', () => {
  const f = contactFreshness({ lastContactedAt: daysAgo(2), lastContactChannel: 'sms', lastContactDirection: 'in' });
  assert.strictEqual(f.detail, 'They reached out 2d ago');
});
ok('yesterday and today are worded, not counted', () => {
  assert.ok(/yesterday/.test(contactFreshness({ lastContactedAt: daysAgo(1), lastContactChannel: 'call', lastContactDirection: 'out' }).detail));
  assert.ok(/today/.test(contactFreshness({ lastContactedAt: daysAgo(0), lastContactChannel: 'call', lastContactDirection: 'out' }).detail));
  assert.strictEqual(at(0).short, 'Today');
});
ok('every channel has a verb', () => {
  ['email', 'sms', 'call', 'meeting'].forEach((ch) => {
    const d = contactFreshness({ lastContactedAt: daysAgo(5), lastContactChannel: ch, lastContactDirection: 'out' }).detail;
    assert.ok(!/undefined/.test(d), `${ch} produced "${d}"`);
  });
});
ok('an unknown channel still reads sensibly', () => {
  const d = contactFreshness({ lastContactedAt: daysAgo(5), lastContactChannel: 'carrier-pigeon', lastContactDirection: 'out' }).detail;
  assert.strictEqual(d, 'Contacted 5d ago');
});

console.log('band table');
ok('bands are ordered and terminate in an open-ended one', () => {
  assert.strictEqual(CONTACT_FRESHNESS[CONTACT_FRESHNESS.length - 1].maxDays, null);
  const bounded = CONTACT_FRESHNESS.filter((b) => b.maxDays !== null).map((b) => b.maxDays);
  assert.deepStrictEqual(bounded, [...bounded].sort((a, b) => a - b));
});
ok('every band has a distinct colour', () => {
  const colors = CONTACT_FRESHNESS.map((b) => b.color);
  assert.strictEqual(new Set(colors).size, colors.length);
});

console.log(`\n${passed} assertions passed.`);
