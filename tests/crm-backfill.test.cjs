// Exercise the contact-history backfill derivation against the real shipped
// code, extracted from functions/index.js, so the rules the "Backfill now"
// button applies are the rules asserted here.
//
// The risk this pins down is parity and silence. The same derivation lives in
// scripts/backfill-last-contacted.js, and a backfill that quietly picks the
// wrong touch (or no touch) writes a confident lie into every recency report
// on the dashboard. These assertions cover what counts as contact, what does
// not, and the undefined-vs-null distinction the whole field rests on.
//
// Run: node tests/crm-backfill.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const start = src.indexOf('const BACKFILL_PAGE_SIZE');
const end = src.indexOf('exports.backfillLastContacted');
assert.ok(start > 0 && end > start, 'could not locate the backfill helpers in functions/index.js');

const { newestContactFor, backfillMs } = new Function(`
  ${src.slice(start, end)}
  return { newestContactFor, backfillMs };
`)();

// ── A Firestore stand-in, shaped only where the code actually reaches ──
const snap = (docs) => ({ empty: docs.length === 0, docs: docs.map((d) => ({ data: () => d })) });

/**
 * Build the db/contactRef pair for one contact.
 * Each source is an array of plain documents, newest-first ordering handled
 * here the way an orderBy('createdAt','desc') would.
 */
function fixture({ emails = [], messages = [], calls = [], activities = [] }) {
  const byNewest = (a, b) => backfillMs(b.createdAt) - backfillMs(a.createdAt);
  const sub = (docs) => ({
    orderBy: () => ({ limit: (n) => ({ get: async () => snap(docs.slice().sort(byNewest).slice(0, n)) }) })
  });
  const contactRef = { id: 'c1', collection: (name) => sub(name === 'emails' ? emails : activities) };
  const db = {
    collection: () => ({
      doc: () => ({
        collection: (name) => {
          if (name === 'conversations') {
            return { doc: () => ({ collection: () => sub(messages) }) };
          }
          // calls
          return { where: () => sub(calls) };
        }
      })
    })
  };
  return { db, contactRef };
}

const at = (iso) => new Date(iso);
const find = async (sources) => {
  const { db, contactRef } = fixture(sources);
  return newestContactFor(db, 'co1', contactRef);
};

let passed = 0;

async function main() {
  const tests = [];
  const test = (name, run) => tests.push([name, run]);

  test('no history at all returns null, not a guess', async () => {
    assert.strictEqual(await find({}), null);
  });

  test('an outbound email is contact', async () => {
    const r = await find({ emails: [{ createdAt: at('2026-01-10T00:00:00Z'), direction: 'out' }] });
    assert.strictEqual(r.channel, 'email');
    assert.strictEqual(r.direction, 'out');
  });

  test('an inbound SMS is contact, and direction survives', async () => {
    const r = await find({ messages: [{ createdAt: at('2026-01-10T00:00:00Z'), direction: 'in' }] });
    assert.strictEqual(r.channel, 'sms');
    assert.strictEqual(r.direction, 'in');
  });

  test('the newest touch wins across channels', async () => {
    const r = await find({
      emails: [{ createdAt: at('2026-01-01T00:00:00Z'), direction: 'out' }],
      messages: [{ createdAt: at('2026-03-01T00:00:00Z'), direction: 'out' }]
    });
    assert.strictEqual(r.channel, 'sms');
    assert.strictEqual(r.ms, at('2026-03-01T00:00:00Z').getTime());
  });

  test('a voicemail counts, a no-answer does not', async () => {
    const reached = await find({ calls: [{ createdAt: at('2026-02-01T00:00:00Z'), disposition: 'voicemail' }] });
    assert.strictEqual(reached.channel, 'call');
    const missed = await find({ calls: [{ createdAt: at('2026-02-01T00:00:00Z'), disposition: 'no_answer' }] });
    assert.strictEqual(missed, null, 'an unanswered call is an attempt, not contact');
  });

  test('a completed call with real duration counts even without a disposition', async () => {
    const r = await find({ calls: [{ createdAt: at('2026-02-01T00:00:00Z'), status: 'completed', durationSec: 42 }] });
    assert.strictEqual(r.channel, 'call');
  });

  test('a missed call does not outrank an older real one', async () => {
    const r = await find({
      calls: [
        { createdAt: at('2026-05-01T00:00:00Z'), disposition: 'no_answer' },
        { createdAt: at('2026-01-01T00:00:00Z'), disposition: 'connected' }
      ]
    });
    assert.strictEqual(r.ms, at('2026-01-01T00:00:00Z').getTime());
  });

  test('a logged meeting is contact', async () => {
    const r = await find({ activities: [{ createdAt: at('2026-04-01T00:00:00Z'), type: 'manual_meeting' }] });
    assert.strictEqual(r.channel, 'meeting');
  });

  test('notes, stage changes and imports are NOT contact', async () => {
    for (const type of ['note', 'stage_change', 'import', 'tag_added', 'unsubscribed']) {
      assert.strictEqual(await find({ activities: [{ createdAt: at('2026-04-01T00:00:00Z'), type }] }), null,
        `${type} must not count as contact`);
    }
  });

  test('inbound webhook activities are recovered from history', async () => {
    for (const [type, channel] of [['sms_received', 'sms'], ['email_received', 'email'], ['call_inbound', 'call']]) {
      const r = await find({ activities: [{ createdAt: at('2026-04-01T00:00:00Z'), type }] });
      assert.strictEqual(r.channel, channel);
      assert.strictEqual(r.direction, 'in');
    }
  });

  test('a document with no timestamp is ignored rather than dated to the epoch', async () => {
    assert.strictEqual(await find({ emails: [{ direction: 'out' }] }), null);
  });

  test('backfillMs reads Firestore Timestamps, Dates and ISO strings alike', async () => {
    const ms = at('2026-01-10T00:00:00Z').getTime();
    assert.strictEqual(backfillMs({ toMillis: () => ms }), ms);
    assert.strictEqual(backfillMs(at('2026-01-10T00:00:00Z')), ms);
    assert.strictEqual(backfillMs('2026-01-10T00:00:00Z'), ms);
    assert.strictEqual(backfillMs(null), 0);
    assert.strictEqual(backfillMs('not a date'), 0);
  });

  console.log('\ncrm-backfill');
  for (const [name, run] of tests) {
    try { await run(); passed++; console.log('  ✓ ' + name); }
    catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
  }
  console.log(`\n${passed}/${tests.length} passed`);
}

main();
