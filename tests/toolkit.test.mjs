// The Toolkit registry (public/js/toolkit-data.js) and what it pulls out of
// the course list.
//
// A calculator or planner is added with one TOOLS line, so this guards the
// line: a section that exists, a unique slug, and a live link that points at
// a real page. It also pins The Focus Tax to the Toolkit, so it cannot drift
// back into the course catalog.
//
// Run: node tests/toolkit.test.mjs
import fs from 'node:fs';
import assert from 'node:assert';
import { loadPure } from './_load-pure.mjs';

const { TOOLKIT_SECTIONS, TOOLS } = await loadPure('toolkit-data.js');
// The course registry imports Firebase (code-mounted courses), so it is read
// as text: each entry's block runs from its `slug:` to the next one.
const REGISTRY = fs.readFileSync(new URL('../public/js/courses-registry.js', import.meta.url), 'utf8');
const entry = (slug) => {
  const start = REGISTRY.indexOf(`slug: '${slug}'`);
  if (start < 0) return null;
  const next = REGISTRY.indexOf('slug: ', start + 1);
  return REGISTRY.slice(start, next < 0 ? undefined : next);
};
const TOOLKIT_SHELF = /\bshelf:\s*'toolkit'/;
const PUBLIC = new URL('../public/', import.meta.url);

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

console.log('toolkit');

ok('section keys are unique', () => {
  const keys = TOOLKIT_SECTIONS.map((s) => s.key);
  assert.deepStrictEqual(keys, [...new Set(keys)]);
});

ok('every tool sits in a real section that TOOLS may fill', () => {
  const keys = new Set(TOOLKIT_SECTIONS.map((s) => s.key));
  for (const t of TOOLS) {
    assert.ok(keys.has(t.section), `${t.slug}: unknown section ${t.section}`);
    // Assessments and free reads come from their own registries.
    assert.ok(!['assessments', 'reads'].includes(t.section), `${t.slug}: ${t.section} is not filled from TOOLS`);
  }
});

ok('tool slugs are unique', () => {
  const slugs = TOOLS.map((t) => t.slug);
  assert.deepStrictEqual(slugs, [...new Set(slugs)]);
});

ok('every live tool links to a page that exists', () => {
  for (const t of TOOLS.filter((x) => x.status === 'live')) {
    assert.ok(t.href, `${t.slug}: a live tool needs an href`);
    if (/^https?:/.test(t.href)) continue;
    const file = t.href.replace(/^\//, '').split(/[?#]/)[0];
    const candidates = [file, file + '.html'];
    assert.ok(candidates.some((f) => fs.existsSync(new URL(f, PUBLIC))), `${t.slug}: ${t.href} not found in public/`);
  }
});

ok('The Focus Tax is a Toolkit item, not a listed course', () => {
  const ft = entry('the-focus-tax');
  assert.ok(ft, 'the-focus-tax is in the registry');
  assert.match(ft, TOOLKIT_SHELF);
});

ok('The One Percent Brief stays in Courses', () => {
  const brief = entry('one-percent-brief');
  assert.ok(brief, 'one-percent-brief is in the registry');
  assert.doesNotMatch(brief, TOOLKIT_SHELF);
});

console.log(`\n${passed} passed`);
