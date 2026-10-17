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

const { TOOLKIT_SECTIONS, TOOLS, READ_SERIES } = await loadPure('toolkit-data.js');
const { FOCUS_TAX_LINES } = await loadPure('focus-tax-core.js');
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

ok('The Focus Tax is an essay series in the Toolkit, not a course', () => {
  assert.ok(!entry('the-focus-tax'), 'the-focus-tax course came back into the registry');
  const ft = READ_SERIES.find((r) => r.slug === 'the-focus-tax');
  assert.ok(ft && ft.href === '/reads', 'The Focus Tax is missing from Free Reads');
  assert.ok(fs.existsSync(new URL('reads.html', PUBLIC)), '/reads page is missing');
});

ok('every calculator essay link opens a published essay', () => {
  for (const l of FOCUS_TAX_LINES) {
    assert.ok(l.readSlug, `${l.key}: no readSlug`);
    assert.ok(fs.existsSync(new URL(`reads/${l.readSlug}.html`, PUBLIC)), `${l.key}: /reads/${l.readSlug} not found`);
  }
});

ok('The One Percent Brief stays in Courses', () => {
  const brief = entry('one-percent-brief');
  assert.ok(brief, 'one-percent-brief is in the registry');
  assert.doesNotMatch(brief, TOOLKIT_SHELF);
});

console.log(`\n${passed} passed`);
