// The essay series (/reads): the markdown, the generated public pages, and
// the rules the essays are written to. Run: node tests/reads.test.cjs
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const md = require(path.join(root, 'scripts/lib/markdown.js'));
const { loadSeries } = require(path.join(root, 'scripts/lib/essays.js'));

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

console.log('reads — the essay series');

ok('markdown renders headings, lists, pull quotes, emphasis and the source note', () => {
  const html = md.toHtml('## A head\n\nSome *one* **two**.\n\n> A quote.\n\n1. One\n2. Two\n\n---\n\n**Source note:** X.');
  assert.match(html, /<h2>A head<\/h2>/);
  assert.match(html, /<em>one<\/em> <strong>two<\/strong>/);
  assert.match(html, /<blockquote><p>A quote\.<\/p><\/blockquote>/);
  assert.match(html, /<ol><li>One<\/li><li>Two<\/li><\/ol>/);
  assert.match(html, /<p class="ft-source"><strong>Source note:<\/strong> X\.<\/p>/);
});

ok('markdown escapes HTML and curls quotes', () => {
  assert.strictEqual(md.inline('<b> & "this" it\'s'), '&lt;b&gt; &amp; “this” it’s');
});

ok('a preview ends on whole blocks, never on a heading or the source note', () => {
  const body = 'Para one has five words.\n\n## Heading\n\nPara two.\n\n---\n\n**Source note:** S.';
  const blocks = md.previewBlocks(body, { minWords: 3 });
  assert.deepStrictEqual(blocks.map((b) => b.kind), ['paragraph']);
});

const { essays } = loadSeries();

ok('every essay loads with a unique slug and issue number', () => {
  assert.ok(essays.length >= 1);
  assert.strictEqual(new Set(essays.map((e) => e.slug)).size, essays.length);
  assert.strictEqual(new Set(essays.map((e) => e.issue)).size, essays.length);
});

ok('every essay is long form, and its public preview is a small part of it', () => {
  for (const e of essays) {
    assert.ok(e.words >= 1200, `${e.slug} is ${e.words} words; the series is long-form`);
    const previewWords = e.previewHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    assert.ok(previewWords < e.words * 0.25, `${e.slug} previews ${previewWords} of ${e.words} words`);
    assert.ok(!/ft-source/.test(e.previewHtml), `${e.slug} preview includes the source note`);
  }
});

ok('no essay uses an em or en dash (brand voice)', () => {
  const dir = path.join(root, 'scripts/focus-tax-content');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/[–—]/.test(text), `${f} contains an em or en dash`);
  }
});

ok('no unconverted markdown reaches the page', () => {
  for (const e of essays) assert.ok(!/\*\*|^#{1,3} |\]\(/m.test(e.html), `${e.slug} has raw markdown`);
});

ok('a Brief pointer sits before the source note', () => {
  for (const e of essays.filter((x) => x.brief)) {
    assert.ok(e.html.indexOf('ft-next') < e.html.indexOf('ft-source'), `${e.slug} pointer is after the source note`);
  }
});

ok('the committed /reads pages match the essays (run scripts/build-reads.js)', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-reads.js'), '--check'], { stdio: 'pipe' });
});

ok('the public pages carry the opening only, never the full text', () => {
  for (const e of essays) {
    const page = fs.readFileSync(path.join(root, 'public/reads', `${e.slug}.html`), 'utf8');
    assert.ok(!page.includes('ft-source'), `${e.slug} page includes the source note`);
    const lastFull = e.html.match(/<p>[^<]{40,}<\/p>(?![\s\S]*<p>[^<]{40,}<\/p>)/);
    if (lastFull) assert.ok(!page.includes(lastFull[0]), `${e.slug} page includes the end of the essay`);
  }
});

console.log(`\n${passed} checks passed.`);
