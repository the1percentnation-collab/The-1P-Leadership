// ── Author Command Hub ──────────────────────────────────────────────────────
// The signed-in author's console for building their own editable website:
//   • Site settings  — title, tagline, publish/unpublish the whole site, pick a home page
//   • Pages          — add / edit / reorder / delete / publish individual pages
//   • Editor         — Quill rich-text with a "source HTML" toggle and live preview
//
// It talks to Firestore only through site-store.js, and renders previews with
// the exact same sanitiser the public site uses (renderer's DOMPurify), so what
// you see here is what visitors get.

import { firebaseReady } from './firebase.js';
import { onAuthReady, signOut } from './auth.js';
import {
  ensureMySite, saveSite, loadPages, savePage, deletePage, swapPageOrder, slugify
} from './site-store.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function ok(el, msg) { el.innerHTML = `<div class="msg-ok">${msg}</div>`; }
function err(el, e) { el.innerHTML = `<div class="msg-err">${escapeHtml(e && e.message ? e.message : String(e))}</div>`; }

let _site = null;         // { id, title, tagline, status, homePageId, … }
let _pages = [];          // [{ id, title, html, status, showInNav, sortOrder }]
let _editingId = null;    // page id being edited, or null for a new page
let _quill = null;

// ── Site settings ───────────────────────────────────────────────────────────

function fillSiteForm() {
  $('s-title').value = _site.title || '';
  $('s-tagline').value = _site.tagline || '';
  $('s-status').textContent = _site.status === 'published' ? 'Published' : 'Draft';
  $('s-status').className = _site.status === 'published' ? 'pill pill-live' : 'pill pill-draft';
  $('btn-publish-site').textContent = _site.status === 'published' ? 'Unpublish site' : 'Publish site';

  const link = $('site-public-link');
  if (link) {
    const href = `/site.html?site=${encodeURIComponent(_site.id)}`;
    link.href = href;
    link.textContent = location.origin + href;
  }

  // Home-page picker.
  const sel = $('s-home');
  if (sel) {
    sel.innerHTML = `<option value="">First page</option>` + _pages
      .map((p) => `<option value="${escapeHtml(p.id)}"${p.id === _site.homePageId ? ' selected' : ''}>${escapeHtml(p.title)}</option>`)
      .join('');
  }
}

async function saveSiteSettings(e) {
  e.preventDefault();
  const out = $('site-result');
  try {
    await saveSite(_site.id, {
      title: $('s-title').value.trim() || 'My site',
      tagline: $('s-tagline').value.trim() || '',
      homePageId: $('s-home').value || null
    });
    _site.title = $('s-title').value.trim() || 'My site';
    _site.tagline = $('s-tagline').value.trim() || '';
    _site.homePageId = $('s-home').value || null;
    ok(out, 'Saved.');
    fillSiteForm();
  } catch (e2) { err(out, e2); }
}

async function toggleSitePublish() {
  const out = $('site-result');
  const next = _site.status === 'published' ? 'draft' : 'published';
  try {
    await saveSite(_site.id, { status: next });
    _site.status = next;
    ok(out, next === 'published' ? 'Your site is live.' : 'Your site is now a private draft.');
    fillSiteForm();
  } catch (e2) { err(out, e2); }
}

// ── Page list ───────────────────────────────────────────────────────────────

async function refreshPages() {
  _pages = await loadPages(_site.id);
  fillSiteForm();
  const list = $('pages-list');
  if (_pages.length === 0) {
    list.innerHTML = `<div class="empty">No pages yet. Click "Add page" to write your first one.</div>`;
    return;
  }
  list.innerHTML = `<table class="tbl"><tbody>` + _pages.map((p, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>
        <b>${escapeHtml(p.title || 'Untitled')}</b>
        <span class="${p.status === 'published' ? 'pill pill-live' : 'pill pill-draft'}">${p.status === 'published' ? 'Published' : 'Draft'}</span>
        <br><span class="muted">/${escapeHtml(p.slug || '')}</span>
      </td>
      <td class="row-actions">
        <button class="btn btn-ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-ghost" data-down="${i}" ${i === _pages.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn btn-ghost" data-edit="${escapeHtml(p.id)}">Edit</button>
        <button class="btn btn-ghost btn-danger" data-del="${escapeHtml(p.id)}">Delete</button>
      </td>
    </tr>`).join('') + `</tbody></table>`;

  list.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openEditor(b.dataset.edit)));
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => removePage(b.dataset.del)));
  list.querySelectorAll('[data-up]').forEach((b) =>
    b.addEventListener('click', () => reorder(Number(b.dataset.up), -1)));
  list.querySelectorAll('[data-down]').forEach((b) =>
    b.addEventListener('click', () => reorder(Number(b.dataset.down), 1)));
}

async function reorder(idx, dir) {
  const a = _pages[idx];
  const b = _pages[idx + dir];
  if (!a || !b) return;
  await swapPageOrder(_site.id, a, b);
  await refreshPages();
}

async function removePage(id) {
  const p = _pages.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`Delete "${p.title || 'this page'}"? This can't be undone.`)) return;
  await deletePage(_site.id, id);
  if (_editingId === id) closeEditor();
  await refreshPages();
}

// ── Editor (Quill + source toggle + preview) ────────────────────────────────

function ensureQuill() {
  if (_quill) return _quill;
  // Quill is loaded from the CDN <script> in hub.html.
  _quill = new window.Quill('#q-editor', {
    theme: 'snow',
    modules: {
      toolbar: [
        [{ header: [2, 3, false] }],
        ['bold', 'italic', 'underline'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['blockquote', 'link', 'image'],
        ['clean']
      ]
    }
  });
  return _quill;
}

function editorHtml() {
  const src = $('p-html');
  if (src.style.display !== 'none') return src.value;
  const q = ensureQuill();
  return typeof q.getSemanticHTML === 'function' ? q.getSemanticHTML() : q.root.innerHTML;
}

function openEditor(id) {
  const p = id ? _pages.find((x) => x.id === id) : null;
  _editingId = p ? p.id : null;
  $('editor').style.display = 'block';
  $('editor-title').textContent = p ? `Edit: ${p.title || 'Untitled'}` : 'New page';
  $('editor-result').innerHTML = '';
  $('p-title').value = p ? (p.title || '') : '';
  $('p-slug').value = p ? (p.slug || '') : '';
  $('p-status').value = p ? (p.status || 'draft') : 'draft';
  $('p-nav').checked = p ? (p.showInNav !== false) : true;

  const q = ensureQuill();
  const html = p ? (p.html || '') : '';
  q.setContents([]);
  if (html) q.clipboard.dangerouslyPasteHTML(html);
  const src = $('p-html');
  src.value = html;
  src.style.display = 'none';
  $('q-editor').parentElement.style.display = 'block';
  $('btn-source').textContent = 'Edit HTML source';
  hidePreview();
  $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  _editingId = null;
  $('editor').style.display = 'none';
}

function toggleSource() {
  const src = $('p-html');
  const box = $('q-editor').parentElement;
  const q = ensureQuill();
  if (src.style.display === 'none') {
    src.value = typeof q.getSemanticHTML === 'function' ? q.getSemanticHTML() : q.root.innerHTML;
    src.style.display = 'block';
    box.style.display = 'none';
    $('btn-source').textContent = 'Back to visual editor';
  } else {
    q.setContents([]);
    if (src.value) q.clipboard.dangerouslyPasteHTML(src.value);
    src.style.display = 'none';
    box.style.display = 'block';
    $('btn-source').textContent = 'Edit HTML source';
  }
}

let _purify = null;
async function getPurify() {
  if (_purify) return _purify;
  const mod = await import('https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs');
  _purify = mod.default || mod;
  return _purify;
}

let _previewOn = false;
function hidePreview() {
  _previewOn = false;
  const box = $('p-preview');
  if (box) box.style.display = 'none';
  $('btn-preview').textContent = 'Preview';
}
async function togglePreview() {
  const box = $('p-preview');
  const editorBox = $('q-editor').parentElement;
  const src = $('p-html');
  if (!_previewOn) {
    const purify = await getPurify();
    box.innerHTML =
      `<h1 class="site-page-title">${escapeHtml($('p-title').value.trim())}</h1>` +
      `<article class="site-body">${purify.sanitize(editorHtml() || '', { USE_PROFILES: { html: true } })}</article>`;
    editorBox.style.display = 'none';
    src.style.display = 'none';
    box.style.display = 'block';
    $('btn-preview').textContent = 'Back to editor';
    _previewOn = true;
  } else {
    box.style.display = 'none';
    editorBox.style.display = 'block';
    $('btn-preview').textContent = 'Preview';
    _previewOn = false;
  }
}

async function savePageFromEditor() {
  const out = $('editor-result');
  try {
    const title = $('p-title').value.trim();
    if (!title) throw new Error('Give the page a title.');
    const id = await savePage(_site.id, {
      id: _editingId || undefined,
      title,
      slug: slugify($('p-slug').value.trim() || title),
      html: editorHtml(),
      status: $('p-status').value,
      showInNav: $('p-nav').checked
    });
    _editingId = id;
    ok(out, 'Page saved.');
    await refreshPages();
  } catch (e) { err(out, e); }
}

// ── Boot ────────────────────────────────────────────────────────────────────

async function main() {
  if (!firebaseReady) {
    $('gate').innerHTML = `<div class="msg-err">Firebase isn't configured. Add your keys to js/firebase.js.</div>`;
    return;
  }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/hub.html')); return; }

  $('whoami').textContent = u.email || u.displayName || 'Signed in';
  $('btn-signout').addEventListener('click', async () => {
    try { await signOut(); } catch (e) {}
    location.replace('/login.html');
  });

  _site = await ensureMySite(u);
  if (!_site) { $('gate').innerHTML = `<div class="msg-err">Couldn't load your site.</div>`; return; }
  $('panel').style.display = 'block';

  $('site-form').addEventListener('submit', saveSiteSettings);
  $('btn-publish-site').addEventListener('click', toggleSitePublish);
  $('btn-add-page').addEventListener('click', () => openEditor(null));
  $('btn-save-page').addEventListener('click', savePageFromEditor);
  $('btn-cancel-page').addEventListener('click', closeEditor);
  $('btn-source').addEventListener('click', toggleSource);
  $('btn-preview').addEventListener('click', togglePreview);
  $('p-title').addEventListener('input', () => {
    if (!_editingId && !$('p-slug').value) $('p-slug').placeholder = slugify($('p-title').value);
  });

  await refreshPages();
}

main();
