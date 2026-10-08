// The chapter one preview cut (scripts/make-preview-epub.js).
//
// The preview is served to anyone without an account, so what matters is
// what is NOT in the file: no later chapter, in the zip, the manifest, the
// spine, the contents or a printed contents page. Built against a synthetic
// EPUB 3 shaped like a Vellum export (cover, contents page, nav + NCX,
// Introduction, ten chapters).
//
// Run: node tests/preview-epub.test.cjs
//      node tests/preview-epub.test.cjs --write=/path/sample.epub   (also saves
//      the full sample, e.g. for READER_E2E_EPUB)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { makePreview, readZip, writeZip } = require('../scripts/make-preview-epub.js');

const CHAPTERS = ['Understanding Limiting Beliefs', 'Where Beliefs Come From', 'The Cost of I Can\'t', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const xhtml = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body>${body}</body></html>`;

function sampleEpub() {
  const files = [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['OEBPS/text/cover.xhtml', xhtml('Cover', '<p>I CAN\'T</p>')],
    ['OEBPS/text/contents.xhtml', xhtml('Contents', `<h1>Contents</h1>
      <p class="toc"><a href="intro.xhtml">Introduction</a></p>
      ${CHAPTERS.map((c, i) => `<p class="toc"><a href="ch${i + 1}.xhtml">Chapter ${i + 1}: ${c}</a></p>`).join('\n')}`)],
    ['OEBPS/text/intro.xhtml', xhtml('Introduction', '<h1>Introduction</h1><p>INTRO-TEXT</p>')],
    ...CHAPTERS.map((c, i) => [`OEBPS/text/ch${i + 1}.xhtml`, xhtml(c, `<h1>Chapter ${i + 1}</h1><p>CHAPTER-${i + 1}-TEXT</p>${i === 0 ? '<p>We come back to this in <a href="ch8.xhtml">Chapter 8</a>.</p>' : ''}`)]),
    ['OEBPS/images/fig.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><ol>
      <li><a href="text/intro.xhtml">Introduction</a></li>
      ${CHAPTERS.map((c, i) => `<li><a href="text/ch${i + 1}.xhtml">Chapter ${i + 1}: ${c}</a>${i === 1 ? '<ol><li><a href="text/ch2.xhtml#s1">A section</a></li></ol>' : ''}</li>`).join('\n')}
    </ol></nav><nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="text/ch1.xhtml">Start</a></li><li><a href="text/ch10.xhtml">Ten</a></li></ol></nav>`)],
    ['OEBPS/toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      <navPoint id="n0" playOrder="1"><navLabel><text>Introduction</text></navLabel><content src="text/intro.xhtml"/></navPoint>
      ${CHAPTERS.map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 2}"><navLabel><text>Chapter ${i + 1}</text></navLabel><content src="text/ch${i + 1}.xhtml"/></navPoint>`).join('\n')}
    </navMap></ncx>`],
    ['OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>I Can't: Is Not A Strategy</dc:title></metadata><manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
      <item id="contents" href="text/contents.xhtml" media-type="application/xhtml+xml"/>
      <item id="intro" href="text/intro.xhtml" media-type="application/xhtml+xml"/>
      ${CHAPTERS.map((c, i) => `<item id="ch${i + 1}" href="text/ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
      <item id="fig" href="images/fig.png" media-type="image/png"/>
    </manifest><spine toc="ncx">
      <itemref idref="cover"/><itemref idref="contents"/><itemref idref="intro"/>
      ${CHAPTERS.map((c, i) => `<itemref idref="ch${i + 1}"/>`).join('')}
    </spine><guide><reference type="text" href="text/ch1.xhtml"/><reference type="other" href="text/ch5.xhtml"/></guide></package>`]
  ];
  return writeZip(files.map(([name, d]) => ({ name, data: Buffer.isBuffer(d) ? d : Buffer.from(d, 'utf8') })));
}

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const full = sampleEpub();
const w = process.argv.find((a) => a.startsWith('--write='));
if (w) fs.writeFileSync(w.slice(8), full);

const r = makePreview(full);
const out = readZip(r.epub);
const file = (n) => { const e = out.find((x) => x.name === n); return e ? e.data.toString('utf8') : null; };
const all = out.map((e) => e.data.toString('utf8')).join('\n');

console.log('preview — the chapter one cut');

ok('keeps the cover, contents, Introduction and Chapter 1 in order', () => {
  assert.deepStrictEqual(r.kept, ['OEBPS/text/cover.xhtml', 'OEBPS/text/contents.xhtml', 'OEBPS/text/intro.xhtml', 'OEBPS/text/ch1.xhtml']);
  assert.ok(all.includes('INTRO-TEXT') && all.includes('CHAPTER-1-TEXT'));
});

ok('no text from chapters 2 to 10 is left anywhere in the file', () => {
  for (let i = 2; i <= 10; i++) {
    assert.ok(!all.includes(`CHAPTER-${i}-TEXT`), `chapter ${i} text found`);
    assert.strictEqual(file(`OEBPS/text/ch${i}.xhtml`), null, `ch${i}.xhtml still in the zip`);
  }
});

ok('the manifest, spine and guide point only at files that exist', () => {
  const opf = file('OEBPS/content.opf');
  const names = new Set(out.map((e) => e.name));
  for (const m of opf.matchAll(/href="([^"]+)"/g)) assert.ok(names.has('OEBPS/' + m[1]), 'dangling ' + m[1]);
  for (const m of opf.matchAll(/idref="([^"]+)"/g)) assert.ok(new RegExp(`id="${m[1]}"`).test(opf), 'dangling idref ' + m[1]);
  assert.ok(!/ch5/.test(opf), 'guide still lists chapter 5');
});

ok('the contents (nav, NCX, printed page) list only what is kept, plus Keep Reading', () => {
  const nav = file('OEBPS/nav.xhtml');
  assert.ok(!/ch([2-9]|10)\.xhtml/.test(nav), 'nav links a cut chapter');
  assert.ok(/Chapter 1: Understanding/.test(nav) && /Introduction/.test(nav));
  assert.ok(/<a href="preview-end\.xhtml">Keep Reading<\/a>/.test(nav), 'no Keep Reading entry in nav');
  const ncx = file('OEBPS/toc.ncx');
  assert.ok(!/ch([2-9]|10)\.xhtml/.test(ncx) && /preview-end\.xhtml/.test(ncx), 'NCX not pruned');
  const page = file('OEBPS/text/contents.xhtml');
  assert.ok(/Introduction/.test(page) && /Chapter 1:/.test(page) && !/Chapter [2-9]|Chapter 10/.test(page), 'printed contents not pruned: ' + page);
  assert.deepStrictEqual(r.toc, ['Introduction', 'Chapter 1: Understanding Limiting Beliefs']);
});

ok('a cross-reference to a cut chapter keeps its words, loses its link', () => {
  const ch1 = file('OEBPS/text/ch1.xhtml');
  assert.ok(/back to this in Chapter 8\./.test(ch1) && !/ch8\.xhtml/.test(ch1));
});

ok('the closing page offers the book on the website, the free module and the bundle', () => {
  const end = file('OEBPS/preview-end.xhtml');
  assert.ok(end.includes('href="https://the1pnation.com/#shop"'), 'Get the full book should lead to the book on the website');
  assert.ok(readZip(makePreview(full, { buy: 'https://example.com/buy' }).epub).some((e) => e.data.toString().includes('https://example.com/buy')), '--buy not used');
  assert.ok(end.includes('https://the1pnation.com/book-bonus.html') && end.includes('https://the1pnation.com/bundle.html'));
  assert.ok(!/—/.test(end), 'em dash in the closing page');
  assert.ok(end.includes('The rest of <i>I Can\'t</i> picks up'), 'closing page should name the short title, not the subtitle');
  assert.ok(/<itemref idref="preview-end"\/>\s*<\/spine>/.test(file('OEBPS/content.opf')), 'closing page not last in the spine');
});

ok('the title says it is a preview, and mimetype is still the first, stored entry', () => {
  assert.ok(/<dc:title>I Can't: Is Not A Strategy \(Chapter One Preview\)<\/dc:title>/.test(file('OEBPS/content.opf')));
  assert.strictEqual(out[0].name, 'mimetype');
  assert.strictEqual(r.epub.readUInt16LE(8), 0, 'mimetype is compressed');
  assert.strictEqual(r.epub.slice(30, 38).toString(), 'mimetype');
});

ok('a book whose contents don\'t say "Chapter 2" fails loudly, and --cut-at works', () => {
  assert.throws(() => makePreview(full, { through: 12 }), /Couldn't find "Chapter 12"/);
  const r2 = makePreview(full, { cutAt: 'text/ch3.xhtml' });
  assert.ok(r2.kept.includes('OEBPS/text/ch2.xhtml') && !r2.kept.includes('OEBPS/text/ch3.xhtml'));
});

console.log(`\n${passed} passed`);
