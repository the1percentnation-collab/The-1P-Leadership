// The Alignment Scorecard: the shape every audit delivers and how it prints.
//
// The scorecard is the one thing the free Alignment Audit promises in
// writing, and it goes to a client with their logo on it. These pin what
// makes it consistent (the same six areas as the Team Alignment Assessment,
// the same scale, the 48-hour clock) and what makes it safe to print (every
// client string escaped).
//
// Run: node tests/scorecard.test.mjs
import assert from 'node:assert';
import { loadPure } from './_load-pure.mjs';

const core = await loadPure('scorecard-core.js');
const team = (await loadPure('assessments/team-alignment.js')).default;
const {
  AREAS, LIMITS, DEFAULT_ACCENT, normalizeScorecard, alignmentIndex, indexLabel, priorityArea,
  dueAt, dueState, missingForDelivery, draftFromRequest, renderScorecard
} = core;

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const rated = (ratings) => normalizeScorecard({
  areas: AREAS.map((a, i) => ({ key: a.key, rating: ratings[i] || 0, finding: 'f', solution: 's' }))
});

console.log('scorecard — shape');

ok('the six areas are the Team Alignment Assessment dimensions, in order', () => {
  assert.deepStrictEqual(AREAS.map((a) => a.key), team.dimensions.map((d) => d.key));
  assert.strictEqual(AREAS.length, 6);
});

ok('an empty scorecard normalizes to a complete draft', () => {
  const sc = normalizeScorecard({});
  assert.strictEqual(sc.status, 'draft');
  assert.strictEqual(sc.format, 'team');
  assert.strictEqual(sc.accent, DEFAULT_ACCENT);
  assert.strictEqual(sc.areas.length, 6);
  assert.ok(sc.areas.every((a) => a.rating === 0 && a.finding === '' && a.solution === ''));
  assert.deepStrictEqual(Object.keys(sc.plan), ['d30', 'd60', 'd90']);
});

ok('text is trimmed and capped at its one-page limit', () => {
  const sc = normalizeScorecard({ headline: '  ' + 'x'.repeat(500) + '  ' });
  assert.strictEqual(sc.headline.length, LIMITS.headline);
});

ok('bad values fall back instead of printing', () => {
  const sc = normalizeScorecard({
    accent: 'red', format: 'keynote', sessionDate: 'tomorrow', logoUrl: 'javascript:alert(1)',
    areas: [{ key: 'trust', rating: 9 }], priority: 'nope', recommendation: { program: 'x', delivery: 'y' }
  });
  assert.strictEqual(sc.accent, DEFAULT_ACCENT);
  assert.strictEqual(sc.format, 'team');
  assert.strictEqual(sc.sessionDate, '');
  assert.strictEqual(sc.logoUrl, '');
  assert.strictEqual(sc.areas.find((a) => a.key === 'trust').rating, 0);
  assert.strictEqual(sc.priority, '');
  assert.strictEqual(sc.recommendation.program, '');
  assert.strictEqual(sc.recommendation.delivery, '');
});

console.log('scorecard — scoring');

ok('index is null until something is rated', () => {
  assert.strictEqual(alignmentIndex(normalizeScorecard({}).areas), null);
});

ok('index runs 0 (all Misaligned) to 100 (all Fully aligned), skipping unassessed areas', () => {
  assert.strictEqual(alignmentIndex(rated([1, 1, 1, 1, 1, 1]).areas), 0);
  assert.strictEqual(alignmentIndex(rated([5, 5, 5, 5, 5, 5]).areas), 100);
  assert.strictEqual(alignmentIndex(rated([3, 0, 0, 0, 0, 0]).areas), 50);
  assert.strictEqual(indexLabel(20), 'Pulling apart');
  assert.strictEqual(indexLabel(90), 'Fully aligned');
});

ok('start-here area is the chosen one, else the lowest rated, ties to the earlier area', () => {
  const sc = rated([4, 2, 5, 2, 0, 3]);
  assert.strictEqual(priorityArea(sc), AREAS[1].key);
  assert.strictEqual(priorityArea({ ...sc, priority: 'engagement' }), 'engagement');
  assert.strictEqual(priorityArea(normalizeScorecard({})), '');
});

console.log('scorecard — the 48-hour promise');

ok('due 48 hours after the end of the session day', () => {
  const due = dueAt('2026-10-12');
  assert.strictEqual(due, new Date(2026, 9, 12, 23, 59).getTime() + 48 * 3600 * 1000);
  assert.strictEqual(dueAt(''), null);
});

ok('due state moves from open to due-soon to overdue, and delivered ends it', () => {
  const sc = normalizeScorecard({ sessionDate: '2026-10-12' });
  const due = dueAt('2026-10-12');
  assert.strictEqual(dueState(sc, due - 30 * 3600 * 1000), 'open');
  assert.strictEqual(dueState(sc, due - 2 * 3600 * 1000), 'due-soon');
  assert.strictEqual(dueState(sc, due + 1), 'overdue');
  assert.strictEqual(dueState({ ...sc, status: 'delivered' }, due + 1), 'delivered');
  assert.strictEqual(dueState(normalizeScorecard({})), 'unscheduled');
});

console.log('scorecard — delivery and intake');

ok('a blank scorecard lists everything missing; a written one lists nothing', () => {
  assert.ok(missingForDelivery(normalizeScorecard({})).length >= 5);
  const done = normalizeScorecard({
    orgName: 'Acme', preparedFor: 'Dana', sessionDate: '2026-10-12', headline: 'h',
    areas: [{ key: 'trust', rating: 2, finding: 'f', solution: 's' }], plan: { d30: 'p' }
  });
  assert.deepStrictEqual(missingForDelivery(done), []);
});

ok('a rated area without its writing is flagged by name', () => {
  const sc = normalizeScorecard({ areas: [{ key: 'trust', rating: 2 }] });
  const m = missingForDelivery(sc);
  assert.ok(m.includes('Trust: what we saw'));
  assert.ok(m.includes('Trust: what to do'));
});

ok('an audit request becomes a draft with the client filled in', () => {
  const sc = draftFromRequest({
    contactId: 'c1', name: 'Dana Lee', email: 'dana@acme.com',
    fields: { organization: 'Acme', role: 'VP Sales', team_size: '10–40', format: 'Just me, one-on-one' }
  });
  assert.strictEqual(sc.orgName, 'Acme');
  assert.strictEqual(sc.preparedFor, 'Dana Lee');
  assert.strictEqual(sc.preparedRole, 'VP Sales');
  assert.strictEqual(sc.contactId, 'c1');
  assert.strictEqual(sc.format, 'leader');
  assert.strictEqual(draftFromRequest({ fields: { format: 'My whole team' } }).format, 'team');
});

console.log('scorecard — the printed document');

ok('every client string is escaped', () => {
  const html = renderScorecard({
    orgName: '<script>x</script>', headline: '"><img src=x onerror=alert(1)>',
    areas: [{ key: 'trust', rating: 2, finding: '<b>f</b>', solution: 's' }]
  });
  assert.ok(!html.includes('<script>x'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>f</b>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

ok('prints the client logo when there is one, else their name', () => {
  const withLogo = renderScorecard({ orgName: 'Acme', logoUrl: 'https://cdn.example.com/l.png' });
  assert.ok(withLogo.includes('class="sc-client-logo" src="https://cdn.example.com/l.png"'));
  assert.ok(renderScorecard({ orgName: 'Acme' }).includes('<div class="sc-client-name">Acme</div>'));
});

ok('the accent color reaches the document, and both brands are on it', () => {
  const html = renderScorecard({ accent: '#1a73e8' });
  assert.ok(html.includes('--sc-accent:#1A73E8'));
  assert.ok(html.includes('class="sc-1p"'));
  assert.ok(html.includes('Anthony Brown Sr.'));
});

ok('all six areas print, with the start-here row marked', () => {
  const html = renderScorecard(rated([4, 2, 5, 3, 3, 3]));
  AREAS.forEach((a) => assert.ok(html.includes(a.label), a.label));
  assert.strictEqual((html.match(/class="is-first"/g) || []).length, 1);
  assert.ok(html.includes(`Start here: <strong>${AREAS[1].label}</strong>`));
});

console.log(`\n${passed} passed`);
