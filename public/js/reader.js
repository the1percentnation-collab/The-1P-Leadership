// The reader (/read?book=<id>[&chapter=N]) — a Kindle-style EPUB reader for
// the digital library.
//
// Rendering is foliate-js (public/vendor/foliate-js), which paginates the
// book with CSS columns: text reflows to any screen, pages follow the finger
// on a swipe and snap, and positions are EPUB CFIs, so a bookmark or a
// "where I left off" survives a font change, a rotation and a new edition.
//
// Everything this file adds is the reading experience around it:
//   tap zones        left edge back, right edge forward, middle shows the bars
//   Aa sheet         text size, font, spacing, margins, Paper/Sepia/Night
//   contents drawer  chapters and bookmarks
//   resume           instant from this device, synced to the next (books.js)
//   offline          the file is cached in IndexedDB after the first open

import '../vendor/foliate-js/view.js';
import * as CFI from '../vendor/foliate-js/epubcfi.js';
import { onAuthReady } from './auth.js';
import { firebaseReady } from './firebase.js';
import {
  getBook, ownsBook, getBookFile, loadPosition, createPositionSaver
} from './books.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOOK_ID = (params.get('book') || '').trim();
const CHAPTER = params.get('chapter');

// ── Settings ────────────────────────────────────────────────────────────

const LS_SETTINGS = '1p_reader_settings';
const SIZES = [84, 92, 100, 108, 118, 130, 144];
const MARGINS = { narrow: '4%', normal: '7%', wide: '12%' };
const THEMES = {
  paper: { bg: '#F7F4EE', fg: '#1B1B1B', link: '#B30205', meta: '#F7F4EE' },
  sepia: { bg: '#F1E7D0', fg: '#3B2F20', link: '#8A3B12', meta: '#F1E7D0' },
  night: { bg: '#0B0B0B', fg: '#E6E2DA', link: '#FF6B6D', meta: '#0B0B0B' }
};

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}') || {}; } catch (e) {}
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const s = {
    size: 2, font: 'serif', spacing: '1.65', margin: 'normal',
    theme: prefersDark ? 'night' : 'paper',
    ...saved
  };
  if (!(s.size >= 0 && s.size < SIZES.length)) s.size = 2;
  if (!THEMES[s.theme]) s.theme = 'paper';
  if (!MARGINS[s.margin]) s.margin = 'normal';
  return s;
}

let settings = loadSettings();

function saveSettings() {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch (e) {}
}

// CSS injected into every chapter. The first half loads the reading fonts
// before the book's own styles; the second half overrides them with the
// reader's choices, so a book styled for print still obeys Night mode.
function bookStyles(s) {
  const t = THEMES[s.theme];
  const family = s.font === 'serif' ? "'Literata', Georgia, 'Times New Roman', serif"
    : s.font === 'sans' ? "'Outfit', system-ui, -apple-system, sans-serif"
    : null;
  const before = `@import url('https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=Outfit:wght@400;600&display=swap');`;
  const after = `
    html { color-scheme: ${s.theme === 'night' ? 'dark' : 'light'}; font-size: ${SIZES[s.size]}% !important; }
    html, body { background: ${t.bg} !important; color: ${t.fg} !important; }
    body *:not(img):not(svg):not(svg *) { color: inherit !important; background-color: transparent !important; border-color: currentColor; }
    ${family ? `body, p, li, blockquote, dd, dt, td, th, figcaption { font-family: ${family} !important; }` : ''}
    p, li, blockquote, dd {
      line-height: ${s.spacing} !important;
      -webkit-hyphens: auto; hyphens: auto;
      -webkit-hyphenate-limit-before: 3; -webkit-hyphenate-limit-after: 2;
      widows: 2; orphans: 2; hanging-punctuation: allow-end last;
    }
    h1, h2, h3, h4 { line-height: 1.25 !important; -webkit-hyphens: manual; hyphens: manual; break-after: avoid; }
    a, a * { color: ${t.link} !important; text-decoration-thickness: from-font; }
    ${s.theme === 'night' ? 'img { opacity: .92; }' : ''}
    ::selection { background: ${s.theme === 'night' ? 'rgba(255,107,109,.35)' : 'rgba(230,3,6,.18)'}; }
    pre { white-space: pre-wrap !important; }
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"] { display: none; }
  `;
  return [before, `@namespace epub "http://www.idpf.org/2007/ops";\n${after}`];
}

// ── State ───────────────────────────────────────────────────────────────

let view = null;
let book = null;
let saver = null;
let here = null;        // { cfi, fraction, chapter, range }
let bookmarks = [];     // [{ cfi, label, fraction, at }]
let tocHrefs = [];      // flattened TOC: [{ label, href, depth }]
let wakeLock = null;

// ── Chrome: bars, sheets, toast ─────────────────────────────────────────

function setChrome(on) {
  document.body.classList.toggle('chrome', on);
}
function toggleChrome() { setChrome(!document.body.classList.contains('chrome')); }

function openSheet(id) {
  closeSheets();
  const el = $(id);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  document.body.classList.add('sheet-open');
}
function closeSheets() {
  ['toc', 'settings'].forEach((id) => {
    $(id).classList.remove('open');
    $(id).setAttribute('aria-hidden', 'true');
  });
  document.body.classList.remove('sheet-open');
}
function anySheetOpen() { return document.body.classList.contains('sheet-open'); }

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

function splash({ msg, cover, busy = true, actions = '' }) {
  if (cover) $('splash-cover').src = cover;
  if (msg != null) $('splash-msg').innerHTML = msg;
  $('splash-pulse').hidden = !busy;
  $('splash-actions').innerHTML = actions;
  $('splash').classList.remove('gone');
}
function hideSplash() { $('splash').classList.add('gone'); }

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Applying settings ───────────────────────────────────────────────────

function applySettings({ rerender = true } = {}) {
  document.documentElement.setAttribute('data-theme', settings.theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEMES[settings.theme].meta;

  document.querySelectorAll('.seg[data-setting]').forEach((seg) => {
    const key = seg.dataset.setting;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(settings[key]) === b.dataset.value));
  });
  $('sz-dots').innerHTML = SIZES.map((_, i) => `<i class="${i <= settings.size ? 'on' : ''}"></i>`).join('');
  $('sz-down').disabled = settings.size <= 0;
  $('sz-up').disabled = settings.size >= SIZES.length - 1;

  if (view && view.renderer && rerender) {
    view.renderer.setAttribute('gap', MARGINS[settings.margin]);
    view.renderer.setStyles?.(bookStyles(settings));
  }
}

function wireSettings() {
  document.querySelectorAll('.seg[data-setting]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      settings[seg.dataset.setting] = b.dataset.value;
      saveSettings();
      applySettings();
    });
  });
  $('sz-down').addEventListener('click', () => {
    settings.size = Math.max(0, settings.size - 1); saveSettings(); applySettings();
  });
  $('sz-up').addEventListener('click', () => {
    settings.size = Math.min(SIZES.length - 1, settings.size + 1); saveSettings(); applySettings();
  });
}

// ── Contents + bookmarks ────────────────────────────────────────────────

function flattenToc(items, depth = 0, out = []) {
  (items || []).forEach((it) => {
    out.push({ label: (it.label || '').trim(), href: it.href, depth });
    if (it.subitems && it.subitems.length) flattenToc(it.subitems, depth + 1, out);
  });
  return out;
}

function renderToc(currentHref) {
  const list = $('toc-list');
  if (!tocHrefs.length) {
    list.innerHTML = '<div class="empty">This book has no table of contents.</div>';
    return;
  }
  list.innerHTML = tocHrefs.map((t, i) => `
    <button type="button" class="toc-item${t.depth ? ' sub' : ''}${t.href === currentHref ? ' current' : ''}" data-i="${i}">
      <span>${escapeHtml(t.label || 'Untitled')}</span>
    </button>`).join('');
}

function renderMarks() {
  const list = $('marks-list');
  if (!bookmarks.length) {
    list.innerHTML = '<div class="empty">No bookmarks yet. Tap the ribbon at the top while reading to save a page.</div>';
    return;
  }
  const sorted = bookmarks.slice().sort((a, b) => (a.fraction || 0) - (b.fraction || 0));
  list.innerHTML = sorted.map((b) => `
    <button type="button" class="toc-item" data-cfi="${escapeHtml(b.cfi)}">
      <span>${escapeHtml(b.label || 'Bookmark')}</span>
      <small>${Math.round((b.fraction || 0) * 100)}%</small>
    </button>`).join('');
}

function wireToc() {
  $('toc-btn').addEventListener('click', () => { renderToc(here && here.tocHref); renderMarks(); openSheet('toc'); });
  $('toc-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const t = tocHrefs[Number(b.dataset.i)];
    closeSheets(); setChrome(false);
    if (t && t.href) view.goTo(t.href);
  });
  $('marks-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cfi]');
    if (!b) return;
    closeSheets(); setChrome(false);
    view.goTo(b.dataset.cfi);
  });
  document.querySelectorAll('#toc .tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('#toc .tab').forEach((t) => t.classList.toggle('on', t === tab));
    $('toc-list').hidden = tab.dataset.tab !== 'chapters';
    $('marks-list').hidden = tab.dataset.tab !== 'bookmarks';
  }));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheets));
  $('scrim').addEventListener('click', closeSheets);
}

// A bookmark is "on this page" when its CFI falls inside the visible range.
function markOnPage() {
  if (!here || !here.cfi) return null;
  const start = CFI.collapse(here.cfi);
  const end = CFI.collapse(here.cfi, true);
  return bookmarks.find((b) => {
    try { return CFI.compare(b.cfi, start) >= 0 && CFI.compare(b.cfi, end) <= 0; } catch (e) { return false; }
  }) || null;
}

function syncBookmarkBtn() {
  const on = !!markOnPage();
  $('bookmark-btn').classList.toggle('on', on);
  $('bookmark-btn').setAttribute('aria-pressed', String(on));
}

function toggleBookmark() {
  if (!here) return;
  const existing = markOnPage();
  if (existing) {
    bookmarks = bookmarks.filter((b) => b !== existing);
    toast('Bookmark removed');
  } else {
    const snippet = here.range ? String(here.range.toString()).replace(/\s+/g, ' ').trim().slice(0, 70) : '';
    bookmarks.push({
      cfi: CFI.collapse(here.cfi),
      label: [here.chapter, snippet && `"${snippet}…"`].filter(Boolean).join(' · ') || 'Bookmark',
      fraction: here.fraction || 0,
      at: Date.now()
    });
    toast('Page bookmarked');
  }
  syncBookmarkBtn();
  persist();
}

function persist() {
  if (!saver || !here) return;
  saver.save({ cfi: here.cfi, fraction: here.fraction, chapter: here.chapter, bookmarks });
}

// ── Navigation input ────────────────────────────────────────────────────

// foliate ignores a turn requested while the previous one is still
// animating, which reads as a dropped tap to a fast reader. Queue at most one
// turn behind the current one instead.
let turning = false;
let queuedTurn = 0;
async function turn(dir) {
  if (!view) return;
  if (turning) { queuedTurn = dir; return; }
  turning = true;
  try {
    await (dir > 0 ? view.goRight() : view.goLeft());
  } catch (e) {
    console.warn('[reader] page turn failed', e);
  } finally {
    turning = false;
    const next = queuedTurn;
    queuedTurn = 0;
    if (next) turn(next);
  }
}

// Kindle's zones: a narrow band on the left goes back, most of the right
// goes forward, and the middle toggles the bars.
function handleTapAt(x) {
  if (anySheetOpen()) { closeSheets(); return; }
  const w = window.innerWidth;
  const r = x / w;
  if (r < 0.28) { setChrome(false); turn(-1); }
  else if (r > 0.72) { setChrome(false); turn(1); }
  else toggleChrome();
}

function onKey(e) {
  const k = e.key;
  if (k === 'Escape') { if (anySheetOpen()) closeSheets(); else setChrome(false); return; }
  if (anySheetOpen()) return;
  if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault(); turn(-1); }
  else if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); turn(1); }
}

function wireInput() {
  document.addEventListener('keydown', onKey);
  // Taps on the margins around the page (outside the book's iframe).
  // Clicks inside the iframe never reach this document, so anything seen
  // here landed on the stage padding or the paginator's own margins.
  $('stage').addEventListener('click', (e) => handleTapAt(e.clientX));
  $('bookmark-btn').addEventListener('click', toggleBookmark);
  $('aa-btn').addEventListener('click', () => openSheet('settings'));

  const slider = $('slider');
  let scrubTimer = null;
  slider.addEventListener('input', () => {
    const f = parseFloat(slider.value);
    slider.style.setProperty('--p', `${f * 100}%`);
    $('scrub-pct').textContent = `${Math.round(f * 100)}%`;
    clearTimeout(scrubTimer);
    scrubTimer = setTimeout(() => view.goToFraction(f), 60);
  });

  // Flush the synced position when the reader leaves or the app goes to the
  // background (phones kill background tabs without an unload event).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saver && saver.flush();
    else requestWakeLock();
  });
  window.addEventListener('pagehide', () => saver && saver.flush());
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { wakeLock = null; }
}

// ── Relocate: progress, running header, footer ─────────────────────────

function fmtMinutes(m) {
  if (!(m > 0)) return '';
  if (m < 1) return 'Less than a minute left in chapter';
  if (m < 60) return `${Math.round(m)} min left in chapter`;
  const h = Math.floor(m / 60);
  return `${h} hr ${Math.round(m % 60)} min left in chapter`;
}

function onRelocate({ detail }) {
  const { fraction = 0, tocItem, cfi, time, range } = detail;
  const chapter = (tocItem && tocItem.label && tocItem.label.trim()) || '';
  here = { cfi, fraction, chapter, range, tocHref: tocItem && tocItem.href };

  const pct = Math.round(fraction * 100);
  $('run-head').textContent = chapter || book.title || '';
  $('run-foot').textContent = [fmtMinutes(time && time.section), `${pct}%`].filter(Boolean).join('  ·  ');
  $('scrub-chapter').textContent = chapter;
  $('scrub-pct').textContent = `${pct}%`;
  const slider = $('slider');
  if (document.activeElement !== slider) {
    slider.value = String(fraction);
    slider.style.setProperty('--p', `${fraction * 100}%`);
  }
  syncBookmarkBtn();
  persist();
}

// ── Chapter deep links from the course (?chapter=N) ─────────────────────
// Resolved against books/{id}.chapterHrefs first (set by the upload script,
// editable in Firestore), then by matching "Chapter N" / "Introduction" in
// the book's own table of contents.

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

function chapterHref(n) {
  const map = book.chapterHrefs || {};
  if (map[String(n)]) return map[String(n)];
  if (n === 0) {
    const intro = tocHrefs.find((t) => /^(introduction|intro|preface|foreword)\b/i.test(t.label));
    return intro ? intro.href : null;
  }
  const re = new RegExp(`^(chapter|ch\\.?)\\s*(${n}|${WORDS[n] || '__'})\\b`, 'i');
  const hit = tocHrefs.find((t) => re.test(t.label));
  return hit ? hit.href : null;
}

// ── Open ────────────────────────────────────────────────────────────────

async function open() {
  if (!BOOK_ID) {
    splash({ msg: '<strong>No book selected.</strong>Open a book from your library.', busy: false,
      actions: '<a class="btn primary" href="/library">Go to my library</a>' });
    return;
  }

  let user = null;
  if (firebaseReady) user = await onAuthReady();
  if (!user) {
    location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
    return;
  }

  try {
    book = await getBook(BOOK_ID);
  } catch (e) {
    book = null;
  }
  if (!book) {
    splash({ msg: '<strong>We couldn\'t find that book.</strong>It may have moved. Your library has everything you own.',
      busy: false, actions: '<a class="btn primary" href="/library">Go to my library</a>' });
    return;
  }
  document.title = `${book.title || 'Reader'} | The One Percent Library`;
  $('book-title').textContent = book.title || '';
  splash({ cover: book.coverUrl || '', msg: `<strong>${escapeHtml(book.title || '')}</strong>Opening your book…` });

  if (!(await ownsBook(BOOK_ID))) {
    const buy = book.buyHref ? `<a class="btn primary" href="${escapeHtml(book.buyHref)}">Get this book</a>` : '';
    splash({ msg: `<strong>${escapeHtml(book.title || 'This book')} isn't in your library yet.</strong>It comes with the course bundle it belongs to.`,
      busy: false, actions: `${buy}<a class="btn" href="/library">My library</a>` });
    return;
  }

  let file;
  let saved;
  try {
    [file, saved] = await Promise.all([getBookFile(book), loadPosition(BOOK_ID)]);
  } catch (e) {
    console.error('[reader] could not load the book', e);
    const offline = navigator.onLine === false;
    splash({ msg: offline
      ? '<strong>You\'re offline.</strong>Open this book once with a connection and it will be saved on this device for next time.'
      : '<strong>The book didn\'t load.</strong>Check your connection and try again.',
      busy: false, actions: '<button class="btn primary" type="button" onclick="location.reload()">Try again</button><a class="btn" href="/library">My library</a>' });
    return;
  }
  bookmarks = (saved && saved.bookmarks) || [];
  saver = createPositionSaver(BOOK_ID);

  view = document.createElement('foliate-view');
  $('stage').append(view);
  try {
    await view.open(file);
  } catch (e) {
    console.error('[reader] could not open the EPUB', e);
    splash({ msg: '<strong>This book file couldn\'t be opened.</strong>We\'ve been notified. Please try again shortly.', busy: false,
      actions: '<a class="btn" href="/library">My library</a>' });
    return;
  }

  // Page-turn feel: animated slide, one column on phones, two on a wide
  // landscape screen like an open book.
  const r = view.renderer;
  r.setAttribute('animated', '');
  r.setAttribute('margin', '0px');
  r.setAttribute('gap', MARGINS[settings.margin]);
  r.setAttribute('max-inline-size', '640px');
  r.setAttribute('max-column-count', '2');
  r.setStyles?.(bookStyles(settings));

  // A missing image or stylesheet inside the EPUB shouldn't stop the chapter.
  view.book.transformTarget?.addEventListener('data', ({ detail }) => {
    detail.data = Promise.resolve(detail.data).catch(() => '');
  });

  view.addEventListener('relocate', onRelocate);
  view.addEventListener('load', ({ detail: { doc } }) => {
    doc.addEventListener('keydown', onKey);
    // Taps inside the page. foliate's own link handler runs first and
    // prevents the default on links, so following a link never turns a page.
    doc.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      const sel = doc.getSelection && doc.getSelection();
      if (sel && !sel.isCollapsed) return;
      const frame = doc.defaultView && doc.defaultView.frameElement;
      const left = frame ? frame.getBoundingClientRect().left : 0;
      handleTapAt(left + e.clientX);
    });
  });

  tocHrefs = flattenToc(view.book.toc);
  if (!book.title) {
    const t = view.book.metadata && view.book.metadata.title;
    $('book-title').textContent = typeof t === 'string' ? t : '';
  }

  // Where to start: an explicit chapter link wins, then the saved position,
  // then the start of the text (skipping cover and front matter).
  const n = CHAPTER != null && CHAPTER !== '' ? parseInt(CHAPTER, 10) : NaN;
  const target = Number.isFinite(n) ? chapterHref(n) : null;
  try {
    if (target) await view.goTo(target);
    else await view.init({ lastLocation: saved && saved.cfi, showTextStart: true });
  } catch (e) {
    console.warn('[reader] saved position did not resolve, starting at the text', e);
    await view.goToTextStart();
  }

  applySettings({ rerender: false });
  hideSplash();
  requestWakeLock();
}

wireSettings();
wireToc();
wireInput();
applySettings({ rerender: false });
open();
