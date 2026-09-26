// Pin the Instagram giveaway rules, extracted from the shipped
// functions/index.js so the tally asserted here is the tally that runs.
//
// These decide who can win a prize, so the edge cases are the product:
// commenting five times is still one base entry, tagging the same friend in
// three comments is still one friend, tagging yourself or the brand earns
// nothing, and "me@gmail.com" is not a tag.
//
// Run: node tests/giveaway-tally.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const start = src.indexOf('// ── Giveaway: pure helpers');
const end = src.indexOf('// ── Giveaway: Instagram Graph API');
assert.ok(start > 0 && end > start, 'could not locate the giveaway helpers in functions/index.js');

// The block reuses the file's shared clampInt, so lift that in too.
const clampStart = src.indexOf('function clampInt(');
const clampEnd = src.indexOf('\n}\n', clampStart) + 3;
assert.ok(clampStart > 0 && clampEnd > clampStart, 'could not locate clampInt in functions/index.js');

const {
  normalizeGiveawayRules, extractInstagramTags, tallyGiveawayEntries, drawGiveawayWinners
} = new Function(`
  ${src.slice(clampStart, clampEnd)}
  ${src.slice(start, end)}
  return { normalizeGiveawayRules, extractInstagramTags, tallyGiveawayEntries, drawGiveawayWinners };
`)();

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

let seq = 0;
const T0 = Date.parse('2026-10-01T12:00:00Z');
function c(username, text, { minutes = seq, parentId = null } = {}) {
  seq++;
  return { id: 'c' + seq, username, text, timestamp: new Date(T0 + minutes * 60000).toISOString(), parentId };
}
const byHandle = (tally) => Object.fromEntries(tally.entrants.map((e) => [e.handle, e]));

console.log('tag extraction');
ok('finds tags anywhere in the text, lowercased', () => {
  assert.deepStrictEqual(extractInstagramTags('Love this! @Anna_B and @mike.j 🔥'), ['anna_b', 'mike.j']);
});
ok('a trailing period ends the handle', () => {
  assert.deepStrictEqual(extractInstagramTags('thanks @anna.'), ['anna']);
});
ok('an email address is not a tag', () => {
  assert.deepStrictEqual(extractInstagramTags('email me@gmail.com or @real'), ['real']);
});
ok('the same friend twice in one comment counts once', () => {
  assert.deepStrictEqual(extractInstagramTags('@anna @ANNA @anna'), ['anna']);
});
ok('tags with no space between them are both found', () => {
  assert.deepStrictEqual(extractInstagramTags('@anna@mike'), ['anna']);
  assert.deepStrictEqual(extractInstagramTags('@anna,@mike'), ['anna', 'mike']);
});
ok('empty and missing text yield nothing', () => {
  assert.deepStrictEqual(extractInstagramTags(''), []);
  assert.deepStrictEqual(extractInstagramTags(null), []);
  assert.deepStrictEqual(extractInstagramTags('@ alone'), []);
});

console.log('\ntally');
ok('one base entry per person however many times they comment', () => {
  const t = tallyGiveawayEntries([c('jo', 'me!'), c('jo', 'me again'), c('jo', 'pick me')], {});
  const jo = byHandle(t).jo;
  assert.strictEqual(jo.commentCount, 3);
  assert.strictEqual(jo.entries, 1);
});
ok('each unique friend tagged is a bonus entry, across all their comments', () => {
  const t = tallyGiveawayEntries([
    c('jo', '@anna @mike'),
    c('jo', '@anna again and @sam')
  ], {});
  const jo = byHandle(t).jo;
  assert.deepStrictEqual(jo.countedTags, ['anna', 'mike', 'sam']);
  assert.strictEqual(jo.entries, 1 + 3);
});
ok('bonus tags stop at the cap, keeping the first ones tagged', () => {
  const t = tallyGiveawayEntries([
    c('jo', '@a1 @a2 @a3', { minutes: 1 }),
    c('jo', '@a4 @a5 @a6 @a7', { minutes: 2 })
  ], { maxTaggedFriends: 5 });
  const jo = byHandle(t).jo;
  assert.deepStrictEqual(jo.countedTags, ['a1', 'a2', 'a3', 'a4', 'a5']);
  assert.strictEqual(jo.tags.length, 7, 'all tags are kept for the record');
  assert.strictEqual(jo.entries, 6);
});
ok('the cap is by time, not by the order the API returned comments', () => {
  const late = c('jo', '@late', { minutes: 50 });
  const early = c('jo', '@early1 @early2', { minutes: 5 });
  const t = tallyGiveawayEntries([late, early], { maxTaggedFriends: 2 });
  assert.deepStrictEqual(byHandle(t).jo.countedTags, ['early1', 'early2']);
});
ok('a cap of 0 means no cap', () => {
  const tags = Array.from({ length: 12 }, (_, i) => '@f' + i).join(' ');
  const t = tallyGiveawayEntries([c('jo', tags)], { maxTaggedFriends: 0 });
  assert.strictEqual(byHandle(t).jo.entries, 13);
});
ok('tagging yourself, the host or an excluded handle earns nothing', () => {
  const t = tallyGiveawayEntries(
    [c('jo', '@jo @the1pnation @staffer @anna')],
    { excludeHandles: ['@Staffer'] },
    { hostHandle: 'The1PNation' });
  const jo = byHandle(t).jo;
  assert.deepStrictEqual(jo.countedTags, ['anna']);
  assert.deepStrictEqual(jo.ignoredTags.sort(), ['jo', 'staffer', 'the1pnation']);
  assert.strictEqual(jo.entries, 2);
});
ok('the host and excluded handles cannot enter', () => {
  const t = tallyGiveawayEntries(
    [c('the1pnation', 'Good luck @anna'), c('staffer', '@x'), c('jo', 'in')],
    { excludeHandles: 'staffer, someoneelse' },
    { hostHandle: 'the1pnation' });
  assert.deepStrictEqual(t.entrants.map((e) => e.handle), ['jo']);
  assert.strictEqual(t.skipped.host, 1);
  assert.strictEqual(t.skipped.excluded, 1);
});
ok('replies count by default and can be switched off', () => {
  const parent = c('jo', 'in');
  const reply = c('amy', '@bff', { parentId: parent.id });
  assert.strictEqual(byHandle(tallyGiveawayEntries([parent, reply], {})).amy.entries, 2);
  const off = tallyGiveawayEntries([parent, reply], { countReplies: false });
  assert.ok(!byHandle(off).amy);
  assert.strictEqual(off.skipped.replies, 1);
});
ok('comments outside the entry window are ignored', () => {
  const t = tallyGiveawayEntries([
    c('early', 'hi', { minutes: -10 }),
    c('ontime', 'hi', { minutes: 10 }),
    c('late', 'hi', { minutes: 200 })
  ], { startsAt: new Date(T0).toISOString(), endsAt: new Date(T0 + 60 * 60000).toISOString() });
  assert.deepStrictEqual(t.entrants.map((e) => e.handle), ['ontime']);
  assert.strictEqual(t.skipped.outsideWindow, 2);
});
ok('a late comment cannot add tags after the deadline', () => {
  const t = tallyGiveawayEntries([
    c('jo', '@anna', { minutes: 10 }),
    c('jo', '@mike @sam', { minutes: 120 })
  ], { endsAt: new Date(T0 + 60 * 60000).toISOString() });
  assert.strictEqual(byHandle(t).jo.entries, 2);
});
ok('requireTag leaves untagged commenters listed but with zero entries', () => {
  const t = tallyGiveawayEntries([c('jo', 'me!'), c('amy', '@bff')], { requireTag: true });
  const h = byHandle(t);
  assert.strictEqual(h.jo.entries, 0);
  assert.strictEqual(h.jo.ineligibleReason, 'no_tag');
  assert.strictEqual(h.amy.entries, 2);
  assert.strictEqual(t.totals.eligibleEntrants, 1);
});
ok('requireTag is not satisfied by tagging only yourself or the host', () => {
  const t = tallyGiveawayEntries([c('jo', '@jo @host')], { requireTag: true }, { hostHandle: 'host' });
  assert.strictEqual(byHandle(t).jo.entries, 0);
});
ok('custom weights apply', () => {
  const t = tallyGiveawayEntries([c('jo', '@a @b')], { baseEntries: 2, entriesPerTag: 3 });
  assert.strictEqual(byHandle(t).jo.entries, 2 + 6);
});
ok('handles are case-insensitive for entrants', () => {
  const t = tallyGiveawayEntries([c('Jo', '@a'), c('JO', '@b')], {});
  assert.strictEqual(t.entrants.length, 1);
  assert.strictEqual(t.entrants[0].entries, 3);
});
ok('ranks by entries, then earliest comment', () => {
  const t = tallyGiveawayEntries([
    c('second', 'in', { minutes: 2 }),
    c('first', 'in', { minutes: 1 }),
    c('top', '@x @y', { minutes: 3 })
  ], {});
  assert.deepStrictEqual(t.entrants.map((e) => e.handle), ['top', 'first', 'second']);
});
ok('totals add up', () => {
  const t = tallyGiveawayEntries([c('jo', '@anna @mike'), c('amy', '@anna'), c('', 'ghost')], {});
  assert.strictEqual(t.totals.comments, 3);
  assert.strictEqual(t.totals.countedComments, 2);
  assert.strictEqual(t.skipped.noUsername, 1);
  assert.strictEqual(t.totals.entrants, 2);
  assert.strictEqual(t.totals.entries, 3 + 2);
  assert.strictEqual(t.totals.friendsTagged, 2);
});
ok('garbage input does not throw', () => {
  assert.strictEqual(tallyGiveawayEntries(null, null).entrants.length, 0);
  assert.strictEqual(tallyGiveawayEntries([null, {}], undefined).entrants.length, 0);
});

console.log('\nrules');
ok('defaults: 1 entry, 1 per tag, cap 5, replies on', () => {
  const r = normalizeGiveawayRules({});
  assert.strictEqual(r.baseEntries, 1);
  assert.strictEqual(r.entriesPerTag, 1);
  assert.strictEqual(r.maxTaggedFriends, 5);
  assert.strictEqual(r.countReplies, true);
  assert.strictEqual(r.requireTag, false);
});
ok('out-of-range and junk values are clamped or defaulted', () => {
  const r = normalizeGiveawayRules({ baseEntries: -4, entriesPerTag: 'lots', maxTaggedFriends: 9999 });
  assert.strictEqual(r.baseEntries, 0);
  assert.strictEqual(r.entriesPerTag, 1);
  assert.strictEqual(r.maxTaggedFriends, 100);
});
ok('a reversed window is put the right way round', () => {
  const r = normalizeGiveawayRules({ startsAt: '2026-10-05T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' });
  assert.ok(r.startsAt < r.endsAt);
});
ok('an invalid date is dropped rather than excluding everyone', () => {
  assert.strictEqual(normalizeGiveawayRules({ endsAt: 'next friday' }).endsAt, null);
});

console.log('\ndraw');
const pool = [
  { handle: 'a', entries: 1 },
  { handle: 'b', entries: 3 },
  { handle: 'c', entries: 0 },
  { handle: 'd', entries: 2 }
];
ok('tickets map onto entrants in proportion to entries', () => {
  // Pool order a(1) b(3) d(2): tickets 0 → a, 1-3 → b, 4-5 → d. c has none.
  const pick = (ticket) => drawGiveawayWinners(pool, 1, () => ticket)[0].handle;
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map(pick), ['a', 'b', 'b', 'b', 'd', 'd']);
});
ok('nobody wins twice in one draw', () => {
  const w = drawGiveawayWinners(pool, 3, () => 0);
  assert.deepStrictEqual(w.map((x) => x.handle), ['a', 'b', 'd']);
  assert.deepStrictEqual(w.map((x) => x.poolEntries), [6, 5, 2]);
});
ok('previous winners are excluded from a redraw', () => {
  const w = drawGiveawayWinners(pool, 5, () => 0, ['B']);
  assert.deepStrictEqual(w.map((x) => x.handle), ['a', 'd']);
});
ok('zero-entry entrants can never win', () => {
  assert.strictEqual(drawGiveawayWinners([{ handle: 'c', entries: 0 }], 1, () => 0).length, 0);
});
ok('the weighting holds over many real draws', () => {
  const crypto = require('crypto');
  const wins = { a: 0, b: 0, d: 0 };
  const N = 60000;
  for (let i = 0; i < N; i++) wins[drawGiveawayWinners(pool, 1, (n) => crypto.randomInt(n))[0].handle]++;
  // Expected 1/6, 3/6, 2/6. Allow two percentage points either way.
  assert.ok(Math.abs(wins.a / N - 1 / 6) < 0.02, JSON.stringify(wins));
  assert.ok(Math.abs(wins.b / N - 3 / 6) < 0.02, JSON.stringify(wins));
  assert.ok(Math.abs(wins.d / N - 2 / 6) < 0.02, JSON.stringify(wins));
});

console.log('\nInstagram fetch');
// The Graph API block, run against a scripted fetch so pagination and error
// handling are exercised without a network or a real token.
const gStart = src.indexOf('// ── Giveaway: Instagram Graph API');
const gEnd = src.indexOf('function giveawayIso(');
assert.ok(gStart > 0 && gEnd > gStart, 'could not locate the Graph API block');
function loadGraph(fakeFetch) {
  return new Function('fetch', 'URL', 'process', 'HttpsError', 'admin', 'msOf', 'console', `
    ${src.slice(gStart, gEnd)}
    return { fetchInstagramComments, instagramFetch };
  `)(fakeFetch, URL, { env: {} }, Error, {}, () => null, console);
}
const reply = (json, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => json });

(async () => {
  await (async () => {
    const seen = [];
    const graph = loadGraph((url) => {
      const u = String(url);
      seen.push(u);
      if (u.includes('/m1/comments')) {
        return reply({
          data: [
            { id: '1', text: '@anna', timestamp: '2026-10-01T00:00:00Z', username: 'jo',
              replies: { data: [{ id: '1r1', text: 'me', username: 'amy', timestamp: '2026-10-01T00:01:00Z' }],
                         paging: { next: 'https://graph.instagram.com/replies-page-2' } } }
          ],
          paging: { next: 'https://graph.instagram.com/comments-page-2' }
        });
      }
      if (u.endsWith('replies-page-2')) {
        return reply({ data: [
          { id: '1r1', text: 'me', username: 'amy', timestamp: '2026-10-01T00:01:00Z' },
          { id: '1r2', text: '@x', from: { id: '99', username: 'zed' }, timestamp: '2026-10-01T00:02:00Z' }
        ] });
      }
      if (u.endsWith('comments-page-2')) {
        return reply({ data: [{ id: '2', text: 'in', username: 'kim', timestamp: '2026-10-01T00:03:00Z' }] });
      }
      throw new Error('unexpected url ' + u);
    });
    const { comments, truncated } = await graph.fetchInstagramComments('TOKEN123', 'm1');
    ok('follows comment and reply pagination, de-duplicating replies', () => {
      assert.deepStrictEqual(comments.map((x) => x.id), ['1', '1r1', '1r2', '2']);
      assert.strictEqual(truncated, false);
      assert.strictEqual(seen.length, 3);
    });
    ok('replies carry their parent, and handles fall back to from.username', () => {
      const r2 = comments.find((x) => x.id === '1r2');
      assert.strictEqual(r2.parentId, '1');
      assert.strictEqual(r2.username, 'zed');
      assert.strictEqual(r2.userId, '99');
    });
    ok('the first request asks for replies and sends the token', () => {
      const u = new URL(seen[0]);
      assert.ok(u.searchParams.get('fields').includes('replies'));
      assert.strictEqual(u.searchParams.get('access_token'), 'TOKEN123');
    });
  })();

  await (async () => {
    const graph = loadGraph(() => reply({ error: { message: 'Invalid OAuth access token.', code: 190 } }, 400));
    let err = null;
    try { await graph.instagramFetch('/me', 'SECRET-TOKEN', { fields: 'username' }); } catch (e) { err = e; }
    ok('API errors surface Meta\'s message and code, never the token', () => {
      assert.ok(err, 'expected a throw');
      assert.strictEqual(err.igCode, 190);
      assert.ok(err.message.includes('Invalid OAuth access token.'));
      assert.ok(!err.message.includes('SECRET-TOKEN'));
    });
  })();

  console.log(`\n${passed} checks passed.`);
})();
