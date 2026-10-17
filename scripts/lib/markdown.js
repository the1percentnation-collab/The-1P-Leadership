// The small markdown dialect the essay series is written in, shared by the
// page builder (build-reads.js, public HTML) and the seed (seed-focus-tax.js,
// the full text in Firestore) so the preview and the full essay can never
// render the same source two different ways.
//
// Deliberately small: these files are authored to one shape, so a dependency
// would be more surface than this needs. Supported: --- frontmatter, ## and
// ### headings, paragraphs, 1. ordered and - unordered lists, > single-
// paragraph pull quotes, **bold**, *italic*, and a trailing --- rule before
// the source note.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Typographer's quotes: a straight quote that opens a word curls one way,
// any other curls the other, so "this" and it's read as they would in print.
function smartQuotes(s) {
  return String(s)
    .replace(/(^|[\s(\[{\u2014])"/g, '$1\u201C').replace(/"/g, '\u201D')
    .replace(/(^|[\s(\[{\u2014])'/g, '$1\u2018').replace(/'/g, '\u2019');
}

function inline(s) {
  return escapeHtml(smartQuotes(s))
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+?)\*/g, '$1<em>$2</em>');
}

function parseFrontmatter(raw) {
  const m = raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim();
    if (/^\[.*\]$/.test(value)) {
      data[key] = value.slice(1, -1).split(',').map((v) => v.trim()).filter(Boolean);
    } else {
      data[key] = value;
    }
  }
  return { data, body: m[2] };
}

// Splits a body into rendered blocks, each { html, words, kind }, so a caller
// can cut a preview at a block boundary instead of mid-sentence.
function toBlocks(body) {
  const blocks = [];
  for (const block of body.split(/\n{2,}/)) {
    // A horizontal rule is dropped, including when it sits on the line
    // directly above the source note with no blank line between them.
    const text = block.trim().replace(/^---\n?/, '').trim();
    if (!text) continue;
    const words = text.replace(/[#>*\-\d.]/g, ' ').split(/\s+/).filter(Boolean).length;

    if (/^\*\*Source note:\*\*/.test(text)) {
      blocks.push({ kind: 'source', words, html: `<p class="ft-source">${inline(text)}</p>` });
      continue;
    }

    const heading = text.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      const tag = heading[1].length === 2 ? 'h2' : 'h3';
      blocks.push({ kind: 'heading', words, html: `<${tag}>${inline(heading[2])}</${tag}>` });
      continue;
    }

    const lines = text.split('\n').map((l) => l.trim());
    if (lines.every((l) => /^>\s?/.test(l))) {
      const quote = lines.map((l) => l.replace(/^>\s?/, '')).join(' ');
      blocks.push({ kind: 'quote', words, html: `<blockquote><p>${inline(quote)}</p></blockquote>` });
      continue;
    }

    const ordered = lines.every((l) => /^\d+\.\s+/.test(l));
    const unordered = lines.every((l) => /^-\s+/.test(l));
    if (ordered || unordered) {
      const tag = ordered ? 'ol' : 'ul';
      const items = lines.map((l) => `<li>${inline(l.replace(/^(\d+\.|-)\s+/, ''))}</li>`).join('');
      blocks.push({ kind: 'list', words, html: `<${tag}>${items}</${tag}>` });
      continue;
    }

    blocks.push({ kind: 'paragraph', words, html: `<p>${inline(lines.join(' '))}</p>` });
  }
  return blocks;
}

function toHtml(body) {
  return toBlocks(body).map((b) => b.html).join('\n');
}

// The public opening of an essay: whole paragraphs from the top until at
// least `minWords`, never a heading as the last block (a preview that ends on
// a heading reads as broken), never the source note.
function previewBlocks(body, { minWords = 260 } = {}) {
  const out = [];
  let words = 0;
  for (const b of toBlocks(body)) {
    if (b.kind === 'source') break;
    out.push(b);
    words += b.words;
    if (words >= minWords && b.kind !== 'heading') break;
  }
  while (out.length && out[out.length - 1].kind === 'heading') out.pop();
  return out;
}

function wordCount(body) {
  return toBlocks(body).filter((b) => b.kind !== 'source').reduce((n, b) => n + b.words, 0);
}

module.exports = { escapeHtml, smartQuotes, inline, parseFrontmatter, toBlocks, toHtml, previewBlocks, wordCount };
