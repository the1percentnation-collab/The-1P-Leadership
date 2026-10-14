#!/usr/bin/env node
// Seeds The Focus Tax (slug: the-focus-tax), the free short-form series that
// feeds The One Percent Brief. It lives in the Courses section as one free
// course:
//   - the course doc: title, price 0, and the flags that keep it off the
//     certificate and commitment flows
//   - one module per piece from ./focus-tax-content, all published, because a
//     free series has nothing to drip
//
// Each piece is a markdown file with frontmatter beside a shared meta.js that
// carries the workbook and summary. Writing the next piece is a new markdown
// file, an entry in meta.js, and a re-run.
//
// Safe to re-run, and re-running is how edited copy gets picked up. Nothing
// the owner has set in /manage-courses.html is undone:
//   - course fields (status, price) are only written while blank, so a live
//     course is never knocked back to coming-soon or repriced
//   - a module that already exists keeps its `published` state
//
// Run with Admin credentials, from the scripts/ directory after `npm install`:
//   node seed-focus-tax.js
// See scripts/README.md for the two ways to authenticate.

const fs = require('fs');
const path = require('path');
const { initAdmin, assertCredentials } = require('./lib/init');

const SLUG = 'the-focus-tax';
const BRIEF_SLUG = 'one-percent-brief';
const CONTENT_DIR = path.join(__dirname, 'focus-tax-content');
const META = require('./focus-tax-content/meta');

// ---------------------------------------------------------------------------
// Markdown. Deliberately small: these files are authored to one shape, so a
// dependency would be more surface than this needs. Supported: --- frontmatter,
// ## and ### headings, paragraphs, 1. ordered and - unordered lists, **bold**,
// *italic*, and a trailing --- rule before the source note.
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+?)\*/g, '$1<em>$2</em>');
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
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

function toHtml(body) {
  const out = [];
  let list = null; // { tag, items }

  const flush = () => {
    if (!list) return;
    out.push(`<${list.tag}>` + list.items.map((i) => `<li>${i}</li>`).join('') + `</${list.tag}>`);
    list = null;
  };

  for (const block of body.split(/\n{2,}/)) {
    // A horizontal rule is dropped, including when it sits on the line
    // directly above the source note with no blank line between them.
    const text = block.trim().replace(/^---\n?/, '').trim();
    if (!text) continue;

    if (/^\*\*Source note:\*\*/.test(text)) {
      flush();
      out.push(`<p class="ft-source">${inline(text)}</p>`);
      continue;
    }

    const heading = text.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      flush();
      const tag = heading[1].length === 2 ? 'h2' : 'h3';
      out.push(`<${tag}>${inline(heading[2])}</${tag}>`);
      continue;
    }

    const lines = text.split('\n').map((l) => l.trim());
    const ordered = lines.every((l) => /^\d+\.\s+/.test(l));
    const unordered = lines.every((l) => /^-\s+/.test(l));
    if (ordered || unordered) {
      flush();
      list = {
        tag: ordered ? 'ol' : 'ul',
        items: lines.map((l) => inline(l.replace(/^(\d+\.|-)\s+/, '')))
      };
      flush();
      continue;
    }

    flush();
    out.push(`<p>${inline(lines.join(' '))}</p>`);
  }

  flush();
  return out.join('\n');
}

// ---------------------------------------------------------------------------

const PIECES = fs.readdirSync(CONTENT_DIR)
  .filter((f) => /^focus-tax-\d+\.md$/.test(f))
  .sort()
  .map((file) => {
    const { data, body } = parseFrontmatter(fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8'));
    const meta = META[data.slug];
    if (!meta) throw new Error(`${file}: no meta.js entry for slug "${data.slug}"`);

    const id = Number(data.issue);
    if (!Number.isInteger(id) || id < 1) throw new Error(`${file}: bad issue "${data.issue}"`);

    let html = toHtml(body);
    if (meta.brief) {
      html += `\n<p class="ft-next">Going deeper on this one: ` +
        `<a href="/courses.html?course=${BRIEF_SLUG}">The One Percent Brief</a>, ` +
        `brief ${meta.brief}.</p>`;
    }

    return {
      id,
      title: data.title,
      subtitle: data.hook || '',
      pillar: `Focus Tax ${String(id).padStart(3, '0')} · ${data.pillar || ''}`.trim(),
      duration: /read\s*$/.test(data.read_time || '')
        ? data.read_time
        : `${data.read_time || '3 min'} read`,
      access: data.access || 'free',
      html,
      workbook: meta.workbook,
      summary: meta.summary
    };
  });

async function main() {
  // Initialised here rather than at module load so this file can be required
  // and its parsing exercised without Admin credentials.
  const { admin, db, projectId } = initAdmin();
  console.log(`Project: ${projectId}`);
  await assertCredentials(db, projectId);

  const courseRef = db.collection('courses').doc(SLUG);
  const courseSnap = await courseRef.get();
  const live = (courseSnap.exists && courseSnap.data()) || {};
  const blank = (v) => v === undefined || v === null || v === '';

  const course = {
    title: 'The Focus Tax',
    contentSource: 'firestore',
    certificate: false,
    commitment: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (blank(live.status)) course.status = 'coming-soon';
  if (typeof live.price !== 'number') course.price = 0;

  const kept = ['status', 'price'].filter((k) => !(k in course));
  if (kept.length) console.log(`Course: keeping your existing ${kept.join(', ')}`);
  await courseRef.set(course, { merge: true });

  for (const p of PIECES) {
    const { id, access, ...rest } = p;
    const ref = courseRef.collection('modules').doc(String(id));
    const existing = await ref.get();
    const keepPublished = existing.exists && typeof existing.data().published === 'boolean';

    await ref.set({
      id,
      ...rest,
      html: rest.html.trim(),
      tagLabel: rest.pillar,
      sortOrder: id,
      ...(keepPublished ? {} : { published: true }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const state = keepPublished ? existing.data().published : true;
    console.log(`Focus Tax ${String(id).padStart(3, '0')} seeded: ${rest.title} ` +
      `(${state ? 'published' : 'draft'}${keepPublished ? ', kept' : ''})`);
  }

  console.log(`\nSeeded ${PIECES.length} pieces. To open The Focus Tax:`);
  console.log(`  1. Preview it: /courses.html?course=${SLUG}&preview=1`);
  console.log('  2. Set the course status to live in /manage-courses.html.');
  console.log('     It is free, so members enroll without checkout.');
  console.log(`  3. Make sure ${BRIEF_SLUG} is live too. Every piece that links`);
  console.log('     to it is pointing at a paid product, and that pointer is the');
  console.log('     only thing turning free readers into $12 a month.');
}

// Exported so the parsing can be exercised without Firestore credentials.
module.exports = { PIECES, toHtml, parseFrontmatter };

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
