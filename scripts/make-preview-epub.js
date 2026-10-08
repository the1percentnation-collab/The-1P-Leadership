#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Cut a free preview out of a finished EPUB: everything up to the end of a
// chapter (front matter, Introduction, Chapter 1 by default), then a closing
// "Keep reading" page with the next steps.
//
// The later chapters are deleted from the file, not just hidden from the
// contents, so the preview can be served to anyone (open access) without
// giving the rest of the book away. The contents (nav and NCX), any printed
// table of contents and cross-references are pruned to match.
//
// USAGE (no npm install needed)
//   node scripts/make-preview-epub.js --in=i-cant.epub --out=i-cant-preview.epub \
//     --amazon="https://www.amazon.com/dp/XXXXXXXXXX"
//
//   --through=1        last chapter to keep (default 1)
//   --cut-at=FILE      cut before this spine file instead (e.g. text/ch02.xhtml),
//                      for a book whose contents don't say "Chapter 2"
//   --amazon=URL       "Get the full book" link on the closing page
//   --site=URL         site for the course links (default https://the1pnation.com)
//   --dry-run          print what would be kept and cut, write nothing
//
// Then upload it as its own book with open access, e.g.
//   cd scripts && node upload-book.js --id=i-cant-preview --epub=../i-cant-preview.epub \
//     --title="I Can't: Chapter One Preview" --author="Anthony Brown Sr." --status=hidden --open-access
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Zip (just enough for EPUB: stored and deflated entries) ─────────────

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.slice(start, start + compSize);
    if (method !== 0 && method !== 8) throw new Error(`unsupported zip compression in ${name}`);
    if (!name.endsWith('/')) entries.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function writeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    // EPUB: "mimetype" first and uncompressed, everything else deflated.
    const store = e.name === 'mimetype';
    const body = store ? e.data : zlib.deflateRawSync(e.data, { level: 9 });
    const crc = zlib.crc32(e.data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(store ? 0 : 8, 8); h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18); h.writeUInt32LE(e.data.length, 22);
    h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(store ? 0 : 8, 10); c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, name, body);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ── EPUB helpers ────────────────────────────────────────────────────────

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
};
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textOf = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

// Resolve an href found inside `fromFile` to a path inside the zip.
function resolve(fromFile, href) {
  const clean = decodeURIComponent(String(href).split('#')[0]);
  if (!clean || /^[a-z]+:/i.test(clean)) return null;
  return path.posix.normalize(dirOf(fromFile) + clean).replace(/^\.\//, '');
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const chapterRe = (n) => new RegExp(`^(chapter|ch\\.?)\\s*(${n}|${WORDS[n] || '__'})\\b`, 'i');

// Remove every <tag>…</tag> (innermost first, so nesting works) for which
// `drop(inner)` is true, then any list left empty.
function pruneElements(html, tags, drop) {
  let prev;
  do {
    prev = html;
    for (const t of tags) {
      const re = new RegExp(`<${t}\\b[^>]*>((?:(?!<${t}\\b)[\\s\\S])*?)</${t}>`, 'gi');
      html = html.replace(re, (whole, inner) => (drop(inner) ? '' : whole));
    }
    html = html.replace(/<(ol|ul)\b[^>]*>\s*<\/\1>/gi, '');
  } while (html !== prev);
  return html;
}

function hrefsIn(html, fromFile) {
  const out = [];
  const re = /<a\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const h = attr(m[0], 'href');
    const r = h && resolve(fromFile, h);
    if (r) out.push(r);
  }
  return out;
}

function closingPage({ amazon, site, bookTitle }) {
  const option = (label, href, text) => `
    <div class="opt">
      <h2><a href="${escapeXml(href)}">${escapeXml(label)}</a></h2>
      <p>${escapeXml(text)}</p>
    </div>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Keep Reading</title>
  <style>
    body { margin: 0 6%; }
    h1 { font-size: 1.6em; margin: 2.5em 0 0.6em; }
    .lede { font-size: 1.1em; }
    .opt { margin: 1.6em 0; }
    .opt h2 { font-size: 1.15em; margin: 0 0 0.25em; }
    .sign { margin-top: 2.5em; font-style: italic; }
  </style>
</head>
<body epub:type="backmatter">
  <section epub:type="chapter">
    <h1>You just finished chapter one.</h1>
    <p class="lede">If Fact vs. Verdict showed you something, that is the point. One belief, seen clearly, is where every shift starts.</p>
    <p>The rest of ${escapeXml(bookTitle)} picks up right here. Here is where to go next.</p>
    ${amazon ? option('Get the full book', amazon, 'All ten chapters, every exercise, and the plan to turn "I can\'t" into your next move.') : ''}
    ${option('Start the course free', `${site}/book-bonus.html`, 'Module 1 of I Can\'t: The Course walks you back through this chapter with Anthony and saves your Fact vs. Verdict work as a workbook.')}
    ${option('Go all in', `${site}/bundle.html`, 'The full book and all ten course modules together, one module per chapter.')}
    <p class="sign">Become one percent better every day.<br/>Anthony Brown Sr.</p>
  </section>
</body>
</html>
`;
}

// ── The cut ─────────────────────────────────────────────────────────────

function makePreview(epubBuf, { through = 1, cutAt = null, amazon = null, site = 'https://the1pnation.com' } = {}) {
  const entries = readZip(epubBuf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = (n) => { const e = byName.get(n); if (!e) throw new Error(`missing ${n} in the EPUB`); return e.data.toString('utf8'); };
  const write = (n, s) => { byName.get(n).data = Buffer.from(s, 'utf8'); };

  const container = read('META-INF/container.xml');
  const opfPath = attr(/<rootfile\b[^>]*>/i.exec(container)[0], 'full-path');
  let opf = read(opfPath);

  const items = [...opf.matchAll(/<item\b[^>]*>/gi)].map((m) => {
    const t = m[0];
    return { tag: t, id: attr(t, 'id'), href: attr(t, 'href'), type: attr(t, 'media-type') || '', props: attr(t, 'properties') || '' };
  });
  items.forEach((i) => { i.file = resolve(opfPath, i.href); });
  const byId = new Map(items.map((i) => [i.id, i]));
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)].map((m) => ({ tag: m[0], item: byId.get(attr(m[0], 'idref')) })).filter((s) => s.item);
  const navItem = items.find((i) => /\bnav\b/.test(i.props));
  const ncxItem = items.find((i) => i.type === 'application/x-dtbncx+xml');

  // The contents, from the EPUB 3 nav, else the EPUB 2 NCX.
  let toc = [];
  if (navItem) {
    const nav = read(navItem.file);
    const tocNav = /<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^>]*>([\s\S]*?)<\/nav>/i.exec(nav);
    for (const m of (tocNav ? tocNav[1] : nav).matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
      toc.push({ label: textOf(m[1]), file: resolve(navItem.file, attr(m[0], 'href') || '') });
    }
  }
  if (!toc.length && ncxItem) {
    const ncx = read(ncxItem.file);
    for (const m of ncx.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*>/gi)) {
      const src = attr(/<content\b[^>]*>/i.exec(m[0])[0], 'src');
      toc.push({ label: textOf(m[1]), file: resolve(ncxItem.file, src || '') });
    }
  }

  let cutFile;
  if (cutAt) {
    cutFile = resolve(opfPath, cutAt);
  } else {
    const next = toc.find((t) => chapterRe(through + 1).test(t.label));
    const kept = toc.find((t) => chapterRe(through).test(t.label));
    if (!kept || !next) {
      throw new Error(`Couldn't find "Chapter ${through}" and "Chapter ${through + 1}" in the contents. ` +
        `Pass --cut-at=<file> with the first file to cut. Contents:\n${toc.map((t) => `  ${t.label}  ->  ${t.file}`).join('\n')}`);
    }
    cutFile = next.file;
  }
  const cut = spine.findIndex((s) => s.item.file === cutFile);
  if (cut <= 0) throw new Error(`${cutFile} is not in the reading order, or is the first file. Spine:\n${spine.map((s) => '  ' + s.item.file).join('\n')}`);

  const keptSpine = spine.slice(0, cut);
  const droppedItems = spine.slice(cut).map((s) => s.item).filter((i) => i !== navItem);
  const dropped = new Set(droppedItems.map((i) => i.file));
  const isDropped = (f) => !!f && dropped.has(f);

  // Front matter that links to the cut chapters: a printed contents page is
  // pruned to the kept entries, a stray "see Chapter 5" loses only its link.
  const pagesToFix = keptSpine.map((s) => s.item.file).filter((f) => f !== (navItem && navItem.file));
  for (const f of pagesToFix) {
    let html = read(f);
    const deadLinks = hrefsIn(html, f).filter(isDropped).length;
    if (!deadLinks) continue;
    if (deadLinks >= 3) {
      html = pruneElements(html, ['li', 'p', 'div'], (inner) => {
        const hs = hrefsIn(inner, f);
        return hs.some(isDropped) && !hs.some((h) => !isDropped(h));
      });
    }
    html = html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (whole, inner) => {
      const h = attr(whole, 'href');
      return h && isDropped(resolve(f, h)) ? inner : whole;
    });
    write(f, html);
  }

  // The closing page, appended to the reading order and the contents.
  const titleM = /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf);
  const bookTitle = titleM ? textOf(titleM[1]) : 'the book';
  const endFile = dirOf(opfPath) + 'preview-end.xhtml';
  const endHref = 'preview-end.xhtml';
  const relFrom = (from) => path.posix.relative(dirOf(from) || '.', endFile);

  if (navItem) {
    let nav = read(navItem.file);
    nav = pruneElements(nav, ['li'], (inner) => {
      const hs = hrefsIn(inner, navItem.file);
      return hs.some(isDropped) && !hs.some((h) => !isDropped(h));
    });
    nav = nav.replace(/(<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^>]*>[\s\S]*?)(<\/ol>)(\s*<\/nav>)/i,
      `$1  <li><a href="${escapeXml(relFrom(navItem.file))}">Keep Reading</a></li>\n$2$3`);
    write(navItem.file, nav);
  }
  if (ncxItem) {
    let ncx = read(ncxItem.file);
    ncx = pruneElements(ncx, ['navPoint'], (inner) => {
      const own = /<content\b[^>]*>/i.exec(inner.replace(/<navPoint\b[\s\S]*$/i, ''));
      return !!own && isDropped(resolve(ncxItem.file, attr(own[0], 'src') || ''));
    });
    ncx = ncx.replace(/<\/navMap>/i, `  <navPoint id="preview-end" playOrder="9999"><navLabel><text>Keep Reading</text></navLabel><content src="${escapeXml(relFrom(ncxItem.file))}"/></navPoint>\n  </navMap>`);
    write(ncxItem.file, ncx);
  }

  // The package: cut chapters out of the manifest, spine and guide; add the
  // closing page; mark the title as a preview.
  for (const i of droppedItems) opf = opf.replace(i.tag, '');
  for (const s of spine.slice(cut)) if (s.item !== navItem) opf = opf.replace(s.tag, '');
  opf = opf.replace(/<reference\b[^>]*>/gi, (t) => (isDropped(resolve(opfPath, attr(t, 'href') || '')) ? '' : t));
  opf = opf.replace(/<\/manifest>/i, `  <item id="preview-end" href="${endHref}" media-type="application/xhtml+xml"/>\n  </manifest>`);
  opf = opf.replace(/<\/spine>/i, '  <itemref idref="preview-end"/>\n  </spine>');
  if (titleM && !/preview/i.test(titleM[1])) {
    opf = opf.replace(titleM[0], titleM[0].replace(titleM[1], `${titleM[1]} (Chapter ${WORDS[through] ? WORDS[through][0].toUpperCase() + WORDS[through].slice(1) : through} Preview)`));
  }
  write(opfPath, opf);

  const out = entries.filter((e) => !dropped.has(e.name));
  out.push({ name: endFile, data: Buffer.from(closingPage({ amazon, site, bookTitle }), 'utf8') });
  // mimetype must stay first.
  out.sort((a, b) => (a.name === 'mimetype' ? -1 : b.name === 'mimetype' ? 1 : 0));

  return {
    epub: writeZip(out),
    kept: keptSpine.map((s) => s.item.file),
    dropped: [...dropped],
    toc: toc.filter((t) => !isDropped(t.file)).map((t) => t.label)
  };
}

module.exports = { makePreview, readZip, writeZip };

// ── CLI ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  const arg = (n) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };
  const input = arg('in');
  const output = arg('out');
  const dry = process.argv.includes('--dry-run');
  if (!input || !fs.existsSync(input)) { console.error('--in must point at the full book .epub'); process.exit(1); }
  if (!output && !dry) { console.error('--out is required (or use --dry-run)'); process.exit(1); }
  const amazon = arg('amazon');
  if (amazon && !/^https:\/\//.test(amazon)) { console.error('--amazon must be an https:// link'); process.exit(1); }
  try {
    const r = makePreview(fs.readFileSync(input), {
      through: parseInt(arg('through') || '1', 10), cutAt: arg('cut-at'), amazon,
      site: (arg('site') || 'https://the1pnation.com').replace(/\/+$/, '')
    });
    console.log('Keeps (in reading order):');
    r.kept.forEach((f) => console.log('  ' + f));
    console.log('  + preview-end.xhtml (Keep Reading)');
    console.log(`Cuts ${r.dropped.length} file(s): ${r.dropped.join(', ')}`);
    console.log(`Contents: ${r.toc.join(' | ')} | Keep Reading`);
    if (!amazon) console.log('Note: no --amazon link, so the closing page offers only the course and the bundle.');
    if (dry) { console.log('\n--dry-run: nothing written.'); process.exit(0); }
    fs.writeFileSync(output, r.epub);
    console.log(`\nWrote ${output} (${(r.epub.length / 1024).toFixed(0)} KB). Proof it in the reader before going live.`);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
