// The free assessment library: every data file is publishable, the scoring
// math is right, and the server's allowlist matches the library.
//
// Run: node tests/assessments.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { loadPure } from './_load-pure.mjs';

const {
  validateAssessment, scoreAssessment, bandFor, headlineFor,
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
