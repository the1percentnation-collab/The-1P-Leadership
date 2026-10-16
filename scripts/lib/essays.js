// Loads an essay series from its markdown folder into the shape both the page
// builder (build-reads.js) and the seed (seed-focus-tax.js) use. No Firebase
// here, so the public pages can be built without Admin credentials.

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, toBlocks, previewBlocks, wordCount, escapeHtml } = require('./markdown');

const BRIEF_SLUG = 'one-percent-brief';

const SERIES = {
  slug: 'the-focus-tax',
  title: 'The Focus Tax',
  tagline: 'Deep reads on what an unstructured day really costs.',
  description: 'Every open loop, every decision you make twice, every meeting you try to hold in your head charges you a little. ' +
    'These essays are about that tax: what it costs, why trying harder never pays it, and the structure that does.',
  author: 'Anthony Brown Sr.',
  contentDir: path.join(__dirname, '..', 'focus-tax-content')
};

function briefPointer(brief) {
  return `<p class="ft-next">Going deeper on this one: ` +
    `<a href="/courses.html?course=${BRIEF_SLUG}">The One Percent Brief</a>, brief ${escapeHtml(String(brief))}.</p>`;
}

function loadSeries(series = SERIES) {
  const meta = require(path.join(series.contentDir, 'meta.js'));
  const files = fs.readdirSync(series.contentDir).filter((f) => /^focus-tax-\d+\.md$/.test(f)).sort();

  const essays = files.map((file) => {
    const { data, body } = parseFrontmatter(fs.readFileSync(path.join(series.contentDir, file), 'utf8'));
    if (!data.slug || !/^[a-z0-9-]+$/.test(data.slug)) throw new Error(`${file}: bad slug "${data.slug}"`);
    const issue = Number(data.issue);
    if (!Number.isInteger(issue) || issue < 1) throw new Error(`${file}: bad issue "${data.issue}"`);
    const m = meta[data.slug] || {};

    // The Brief pointer sits after the last line of the essay and before the
    // source note, where a reader who wants more is looking for it.
    const blocks = toBlocks(body);
    const parts = blocks.map((b) => b.html);
    if (m.brief) {
      const at = blocks.findIndex((b) => b.kind === 'source');
      parts.splice(at === -1 ? parts.length : at, 0, briefPointer(m.brief));
    }

    const words = wordCount(body);
    return {
      issue,
      issueLabel: String(issue).padStart(3, '0'),
      slug: data.slug,
      title: data.title,
      hook: data.hook || '',
      pillar: data.pillar || '',
      date: data.date || '',
      tags: data.tags || [],
      words,
      readTime: data.read_time || `${Math.max(1, Math.round(words / 230))} min`,
      brief: m.brief || null,
      html: parts.join('\n'),
      previewHtml: previewBlocks(body).map((b) => b.html).join('\n')
    };
  });

  const seen = new Set();
  for (const e of essays) {
    if (seen.has(e.slug)) throw new Error(`duplicate slug "${e.slug}"`);
    seen.add(e.slug);
  }
  return { series, essays };
}

module.exports = { SERIES, BRIEF_SLUG, loadSeries };
