// ── Public site renderer ────────────────────────────────────────────────────
// Renders any author's PUBLISHED site read-only. This is what a visitor sees at
//   /site.html?site=<siteId>            → the home page
//   /site.html?site=<siteId>&page=<id>  → a specific page
//
// The stored HTML is author-controlled, so every render runs through DOMPurify.
// Never inject page.html without sanitizing — that's the whole XSS surface.

import { getSiteById, loadPublishedPages } from './site-store.js';

let _purify = null;
async function getPurify() {
  if (_purify) return _purify;
  const mod = await import('https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs');
  _purify = mod.default || mod;
  return _purify;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const $ = (id) => document.getElementById(id);

function pickCurrent(pages, site, wantedId) {
  if (wantedId) {
    const hit = pages.find((p) => p.id === wantedId);
    if (hit) return hit;
  }
  if (site.homePageId) {
    const home = pages.find((p) => p.id === site.homePageId);
    if (home) return home;
  }
  return pages[0] || null;
}

export async function mountSite({ mount = 'site-root' } = {}) {
  const root = $(mount);
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const siteId = params.get('site');
  const pageId = params.get('page');

  if (!siteId) {
    root.innerHTML = `<div class="site-empty">No site specified.</div>`;
    return;
  }

  const site = await getSiteById(siteId);
  if (!site || site.status !== 'published') {
    root.innerHTML = `<div class="site-empty">This site isn't published yet.</div>`;
    return;
  }

  const pages = (await loadPublishedPages(siteId)).filter((p) => p.status === 'published');
  const current = pickCurrent(pages, site, pageId);

  const navPages = pages.filter((p) => p.showInNav !== false);
  const navHtml = navPages.map((p) => {
    const active = current && p.id === current.id ? ' is-active' : '';
    return `<a class="site-nav-link${active}" href="?site=${encodeURIComponent(siteId)}&page=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a>`;
  }).join('');

  const purify = await getPurify();
  const bodyHtml = current
    ? purify.sanitize(current.html || '', { USE_PROFILES: { html: true } })
    : '<p>This site has no published pages yet.</p>';

  root.innerHTML = `
    <header class="site-header">
      <div class="site-brand">
        <div class="site-title">${escapeHtml(site.title || 'Untitled site')}</div>
        ${site.tagline ? `<div class="site-tagline">${escapeHtml(site.tagline)}</div>` : ''}
      </div>
      <nav class="site-nav">${navHtml}</nav>
    </header>
    <main class="site-main">
      ${current ? `<h1 class="site-page-title">${escapeHtml(current.title)}</h1>` : ''}
      <article class="site-body">${bodyHtml}</article>
    </main>
    <footer class="site-footer">Built with the Author Command Hub</footer>
  `;

  document.title = current ? `${current.title} — ${site.title}` : (site.title || 'Site');
}
