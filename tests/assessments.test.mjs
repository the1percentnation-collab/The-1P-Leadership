// The free assessment library: every data file is publishable, the scoring
// math is right, and the server's allowlist matches the library.
//
// Run: node tests/assessments.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { loadPure } from './_load-pure.mjs';

const {
  validateAssessment, scoreAssessment, bandFor, headlineFor, buildReport, levelFor, nextBand, blendFor, driversFor, suggestEmail,
  readingOf, levelLabelFor, toneFor, howToRead,
  isPriorityLead, segmentFor, cleanProfile, CATEGORIES
} = await loadPure('assessment-core.js');
const { ASSESSMENTS, getAssessment } = await loadPure('assessments-data.js');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const all = (def, v) => Object.fromEntries(def.questions.map((_, i) => [i, v]));

console.log('assessments — the free library');

// ── The library ──────────────────────────────────────────────────────────

ok('every assessment passes validation', () => {
  const errs = ASSESSMENTS.flatMap((a) => validateAssessment(a));
  assert.deepStrictEqual(errs, []);
});

ok('slugs are unique and every data file is registered', () => {
  const slugs = ASSESSMENTS.map((a) => a.slug);
  assert.strictEqual(new Set(slugs).size, slugs.length);
  const files = fs.readdirSync(new URL('../public/js/assessments/', import.meta.url))
    .filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();
  assert.deepStrictEqual(files, slugs.slice().sort());
});

ok('every related link points at a real assessment', () => {
  for (const a of ASSESSMENTS) for (const r of a.related || []) assert.ok(getAssessment(r), `${a.slug} → ${r}`);
});

ok('every category has at least one assessment', () => {
  for (const c of CATEGORIES) assert.ok(ASSESSMENTS.some((a) => a.category === c.key), c.key);
});

ok('the flagship Alignment Scorecard leads the library', () => {
  assert.strictEqual(ASSESSMENTS[0].slug, 'alignment-scorecard');
  assert.ok(ASSESSMENTS[0].featured);
});

ok('the server allowlist matches the library: slug, title and category', () => {
  const src = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const block = src.match(/const ASSESSMENT_SLUGS = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'ASSESSMENT_SLUGS not found in functions/index.js');
  const server = {};
  for (const m of block[1].matchAll(/'([a-z0-9-]+)':\s*\{\s*title:\s*'((?:[^'\\]|\\.)*)',\s*category:\s*'([a-z]+)'\s*\}/g)) {
    server[m[1]] = { title: m[2].replace(/\\'/g, "'"), category: m[3] };
  }
  const client = Object.fromEntries(ASSESSMENTS.map((a) => [a.slug, { title: a.title, category: a.category }]));
  assert.deepStrictEqual(server, client);
});

ok('the server knows a label for every category', () => {
  const src = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const block = src.match(/const ASSESSMENT_CATEGORY_LABELS = \{([\s\S]*?)\};/)[1];
  for (const c of CATEGORIES) assert.ok(new RegExp(`\\b${c.key}:`).test(block), c.key);
});

ok('/assessments/<slug> is served by the runner page', () => {
  const hosting = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')).hosting;
  const r = hosting.rewrites.find((x) => x.source === '/assessments/**');
  assert.ok(r, 'rewrite missing');
  assert.strictEqual(r.destination, '/assessment.html');
  assert.ok(fs.existsSync(new URL('../public/assessment.html', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../public/assessments.html', import.meta.url)));
});

// ── Scoring ──────────────────────────────────────────────────────────────

const def = {
  slug: 't', mode: 'score',
  dimensions: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
  questions: [
    { dim: 'a', text: '1' }, { dim: 'a', text: '2', reverse: true },
    { dim: 'b', text: '3' }, { dim: 'b', text: '4' }
  ],
  bands: [{ min: 0, label: 'Low' }, { min: 50, label: 'Mid' }, { min: 75, label: 'High' }]
};

ok('all 5s on plain questions and 1s on reversed ones is 100', () => {
  const r = scoreAssessment(def, { 0: 5, 1: 1, 2: 5, 3: 5 });
  assert.strictEqual(r.overall, 100);
  assert.strictEqual(r.band.label, 'High');
  assert.ok(r.complete);
});

ok('reversed questions count against when agreed with', () => {
  const r = scoreAssessment(def, { 0: 5, 1: 5, 2: 5, 3: 5 });
  assert.strictEqual(r.dims.find((d) => d.key === 'a').score, 50);
  assert.strictEqual(r.lowest, 'a');
  assert.strictEqual(r.highest, 'b');
});

ok('neutral everywhere is 50, the middle band', () => {
  const r = scoreAssessment(def, all(def, 3));
  assert.strictEqual(r.overall, 50);
  assert.strictEqual(r.band.label, 'Mid');
});

ok('unanswered questions are skipped, not scored as zero', () => {
  const r = scoreAssessment(def, { 0: 5, 2: 5 });
  assert.strictEqual(r.overall, 100);
  assert.strictEqual(r.complete, false);
});

ok('out-of-range answers are ignored', () => {
  const r = scoreAssessment(def, { 0: 9, 1: 0, 2: 'x', 3: 1 });
  assert.strictEqual(r.dims.find((d) => d.key === 'a').answered, 0);
  assert.strictEqual(r.overall, 0);
});

ok('bands pick the highest min at or below the score', () => {
  assert.strictEqual(bandFor(def, 0).label, 'Low');
  assert.strictEqual(bandFor(def, 49).label, 'Low');
  assert.strictEqual(bandFor(def, 74).label, 'Mid');
  assert.strictEqual(bandFor(def, 100).label, 'High');
});

ok('profile mode: the highest dimension is the result, ties go to the first', () => {
  const p = Object.assign({}, def, {
    mode: 'profile', bands: undefined,
    dimensions: [{ key: 'a', label: 'A', headline: 'You are A' }, { key: 'b', label: 'B', headline: 'You are B' }],
    questions: [{ dim: 'a', text: '1' }, { dim: 'b', text: '2' }]
  });
  assert.strictEqual(scoreAssessment(p, { 0: 2, 1: 5 }).profileType, 'b');
  assert.strictEqual(scoreAssessment(p, { 0: 4, 1: 4 }).profileType, 'a');
  assert.strictEqual(headlineFor(p, scoreAssessment(p, { 0: 2, 1: 5 })), 'You are B');
  assert.strictEqual(scoreAssessment(p, { 0: 2, 1: 5 }).band, null);
});

ok('every real assessment scores 0 and 100 at the extremes', () => {
  for (const a of ASSESSMENTS) {
    const best = Object.fromEntries(a.questions.map((q, i) => [i, q.reverse ? 1 : 5]));
    const worst = Object.fromEntries(a.questions.map((q, i) => [i, q.reverse ? 5 : 1]));
    assert.strictEqual(scoreAssessment(a, best).overall, 100, a.slug);
    assert.strictEqual(scoreAssessment(a, worst).overall, 0, a.slug);
    assert.ok(headlineFor(a, scoreAssessment(a, best)), a.slug + ' has a headline');
  }
});

// ── The report ───────────────────────────────────────────────────────────

ok('area levels cut at 50 and 75, like the bands', () => {
  assert.strictEqual(levelFor(0).key, 'low');
  assert.strictEqual(levelFor(49).key, 'low');
  assert.strictEqual(levelFor(50).key, 'mid');
  assert.strictEqual(levelFor(74).key, 'mid');
  assert.strictEqual(levelFor(75).key, 'high');
});

ok('score report: strength is the top area, focus the lowest, both named in one line', () => {
  const a = getAssessment('alignment-scorecard');
  const answers = Object.fromEntries(a.questions.map((q, i) => {
    const want = q.dim === 'leadership' ? 5 : q.dim === 'growth' ? 1 : 3;
    return [i, q.reverse ? 6 - want : want];
  }));
  const rep = buildReport(a, scoreAssessment(a, answers));
  assert.strictEqual(rep.strength.key, 'leadership');
  assert.strictEqual(rep.strength.level, 'high');
  assert.strictEqual(rep.focus.key, 'growth');
  assert.strictEqual(rep.focus.level, 'low');
  assert.ok(rep.oneLine.includes('Leadership (100)') && rep.oneLine.includes('Growth (0)'), rep.oneLine);
  assert.strictEqual(rep.focus.meaning, a.dimensions.find((d) => d.key === 'growth').levels.low);
});

ok('the 30-day plan is three weeks on the focus area, then the next weakest', () => {
  const a = getAssessment('alignment-scorecard');
  const answers = Object.fromEntries(a.questions.map((q, i) => {
    const want = { growth: 1, identity: 2, awareness: 3, navigation: 4, leadership: 5 }[q.dim];
    return [i, q.reverse ? 6 - want : want];
  }));
  const rep = buildReport(a, scoreAssessment(a, answers));
  assert.deepStrictEqual(rep.plan.map((p) => p.area), ['Growth', 'Growth', 'Growth', 'Identity']);
  const growth = a.dimensions.find((d) => d.key === 'growth');
  assert.deepStrictEqual(rep.plan.slice(0, 3).map((p) => p.action), growth.actions);
});

ok('even scores still produce a readable line and a full plan', () => {
  const a = getAssessment('alignment-scorecard');
  const rep = buildReport(a, scoreAssessment(a, all(a, 3)));
  assert.ok(/even/.test(rep.oneLine), rep.oneLine);
  assert.strictEqual(rep.plan.length, 4);
  assert.ok(rep.plan.every((p) => p.action));
});

ok('profile report: focus is the type, secondary the runner-up, plan ends on the runner-up', () => {
  for (const a of ASSESSMENTS.filter((x) => x.mode === 'profile')) {
    const second = a.dimensions[1].key;
    const answers = Object.fromEntries(a.questions.map((q, i) => [i, q.dim === second ? 5 : q.dim === a.dimensions[0].key ? 4 : 1]));
    const rep = buildReport(a, scoreAssessment(a, answers));
    assert.strictEqual(rep.focus.key, second, a.slug);
    assert.strictEqual(rep.secondary.key, a.dimensions[0].key, a.slug);
    assert.strictEqual(rep.plan[3].area, rep.secondary.label, a.slug);
    assert.ok(rep.headline && rep.summary && rep.oneLine, a.slug);
  }
});

ok('every assessment builds a complete report at every level', () => {
  for (const a of ASSESSMENTS) for (const v of [1, 3, 5]) {
    const rep = buildReport(a, scoreAssessment(a, all(a, v)));
    assert.ok(rep.headline && rep.summary && rep.oneLine, a.slug);
    assert.strictEqual(rep.plan.length, 4, a.slug);
    for (const ar of rep.areas) assert.ok(ar.meaning && ar.why && ar.reflect && ar.actions.length === 3, `${a.slug}/${ar.key}`);
  }
});

ok('next band: points to the next level, null at the top', () => {
  assert.deepStrictEqual(nextBand(def, 38), { band: def.bands[1], pointsAway: 12 });
  assert.strictEqual(nextBand(def, 74).pointsAway, 1);
  assert.strictEqual(nextBand(def, 80), null);
  assert.strictEqual(nextBand({ mode: 'profile' }, 10), null);
});

ok('blend: whole percents that add to 100, strongest first', () => {
  for (const a of ASSESSMENTS.filter((x) => x.mode === 'profile')) {
    const r = scoreAssessment(a, Object.fromEntries(a.questions.map((q, i) => [i, (i % 5) + 1])));
    const b = blendFor(r);
    assert.strictEqual(b.reduce((s, x) => s + x.pct, 0), 100, a.slug);
    for (let i = 1; i < b.length; i++) assert.ok(b[i - 1].pct >= b[i].pct, a.slug);
  }
  const zero = blendFor({ dims: [{ key: 'a', label: 'A', score: 0, answered: 1 }, { key: 'b', label: 'B', score: 0, answered: 1 }] });
  assert.deepStrictEqual(zero.map((x) => x.pct), [50, 50]);
});

ok('drivers: lifts and drags judged by effect, reverse-scored included, two each at most', () => {
  const d = driversFor(def, { 0: 5, 1: 5 }, 'a');
  assert.deepStrictEqual(d.lifts, [{ text: '1', answer: 'Strongly agree' }]);
  assert.deepStrictEqual(d.drags, [{ text: '2', answer: 'Strongly agree' }]);
  assert.deepStrictEqual(driversFor(def, { 0: 3, 1: 3 }, 'a'), { lifts: [], drags: [] });
  const a = getAssessment('alignment-scorecard');
  const dr = driversFor(a, all(a, 1), 'awareness');
  assert.ok(dr.lifts.length <= 2 && dr.drags.length <= 2);
  assert.ok(dr.lifts.length && dr.drags.length, 'awareness has a reversed item, so all-1s yields both');
});

ok('the report carries drivers only when answers are given', () => {
  const a = getAssessment('burnout-check');
  const r = scoreAssessment(a, all(a, 2));
  assert.ok(buildReport(a, r, all(a, 2)).areas.every((x) => x.drivers));
  assert.ok(buildReport(a, r).areas.every((x) => x.drivers === null));
});

ok('email typos on common providers are caught, real domains left alone', () => {
  assert.strictEqual(suggestEmail('a@gmial.com'), 'a@gmail.com');
  assert.strictEqual(suggestEmail('A@Gmail.con'), 'a@gmail.com');
  assert.strictEqual(suggestEmail('a@iclod.com'), 'a@icloud.com');
  assert.strictEqual(suggestEmail('a@gmail.com'), null);
  assert.strictEqual(suggestEmail('a@icloud.com'), null);
  assert.strictEqual(suggestEmail('a@the1pnation.com'), null);
  assert.strictEqual(suggestEmail('not an email'), null);
});

ok('labels and colors follow what a high score means', () => {
  const lb = getAssessment('limiting-beliefs');
  const ls = getAssessment('leadership-style');
  const al = getAssessment('alignment-scorecard');
  assert.strictEqual(readingOf(lb), 'lower-better');
  assert.strictEqual(readingOf(ls), 'profile');
  assert.strictEqual(readingOf(al), 'score');
  assert.deepStrictEqual(['low', 'high'].map((k) => [levelLabelFor(lb, k), toneFor(lb, k)]), [['Barely there', 'good'], ['Strong hold', 'watch']]);
  assert.deepStrictEqual(['low', 'high'].map((k) => [levelLabelFor(al, k), toneFor(al, k)]), [['Needs focus', 'watch'], ['Strong', 'good']]);
  assert.deepStrictEqual(['low', 'high'].map((k) => toneFor(ls, k)), ['n1', 'n3']);
  assert.ok(/Lower is better/.test(howToRead(lb)) && /No type is better/.test(howToRead(ls)));
});

ok('limiting beliefs: when nothing scores high, the result says so plainly', () => {
  const lb = getAssessment('limiting-beliefs');
  const low = buildReport(lb, scoreAssessment(lb, Object.fromEntries(lb.questions.map((q, i) => [i, q.dim === 'comfortZone' ? 2 : 1]))));
  assert.strictEqual(low.clear, true);
  assert.strictEqual(low.headline, lb.clearHeadline);
  assert.strictEqual(low.summary, lb.clearSummary);
  assert.ok(/Comfort Zone shows up most/.test(low.oneLine), low.oneLine);
  assert.strictEqual(low.focus.tone, 'good');
  const high = buildReport(lb, scoreAssessment(lb, Object.fromEntries(lb.questions.map((q, i) => [i, q.dim === 'comfortZone' ? 5 : 1]))));
  assert.strictEqual(high.clear, false);
  assert.ok(/Comfort Zone/.test(high.headline), high.headline);
  assert.strictEqual(high.focus.levelLabel, 'Strong hold');
  assert.strictEqual(high.focus.tone, 'watch');
});

// ── Segmenting ───────────────────────────────────────────────────────────

ok('leaders of 11+ people are priority leads, whatever their role', () => {
  assert.strictEqual(isPriorityLead({ role: 'manager', teamSize: '11-50' }), true);
  assert.strictEqual(isPriorityLead({ role: 'professional', teamSize: '51+' }), true);
});

ok('people who run an organization with any team are priority leads', () => {
  assert.strictEqual(isPriorityLead({ role: 'pastor', teamSize: '1-10' }), true);
  assert.strictEqual(isPriorityLead({ role: 'executive', teamSize: '1-10' }), true);
  assert.strictEqual(isPriorityLead({ role: 'manager', teamSize: '1-10' }), false);
  assert.strictEqual(isPriorityLead({ role: 'executive', teamSize: '0' }), false);
});

ok('unknown profile answers are dropped', () => {
  assert.deepStrictEqual(cleanProfile({ role: 'admin', teamSize: '9000' }), { role: null, teamSize: null });
  assert.strictEqual(isPriorityLead({ role: 'admin', teamSize: '9000' }), false);
  assert.strictEqual(segmentFor({}), 'individual');
  assert.strictEqual(segmentFor({ teamSize: '1-10' }), 'leader');
});

ok('the server mirrors the priority rule', () => {
  const src = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  const body = src.match(/function isPriorityAssessmentLead\(role, teamSize\) \{([\s\S]*?)\n\}/)[1];
  const server = new Function('role', 'teamSize', body);
  const roles = ['professional', 'owner', 'manager', 'executive', 'sales', 'pastor', 'nonprofit', 'student'];
  for (const role of roles) for (const teamSize of ['0', '1-10', '11-50', '51+']) {
    assert.strictEqual(server(role, teamSize), isPriorityLead({ role, teamSize }), `${role}/${teamSize}`);
  }
});

console.log(`\n${passed} checks passed.`);
