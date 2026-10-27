// My Library (/library) — the shelf of digital books the member owns.
//
// Ownership is users/{uid}.ownedBookIds (see books.js). Courses put books
// here through `grantsBooks`; the shelf itself never looks at courses.
//
// Below the shelf, "Also available" lists the books a member can buy on
// their own (a live product that unlocks a library book, like the I Can't
// audiobook) and does not own yet, each linking to its page.

import { onAuthReady, currentUser } from './auth.js';
import { ensureOnboarded } from './onboarding-guard.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady, db } from './firebase.js';
import { getUserProfile } from './community.js';
import { renderTopbar, renderTopbarEarly } from './topbar.js';
import { renderShell } from './academy-shell.js';
import { libraryAccess, getBook, loadAllPositions, isAudioBook, bookHref } from './books.js';
import { fmtMoney } from './pricing.js';
import {
  collection, getDocs, query, where
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cover(book, cls = 'lib-cover') {
  if (book.coverUrl) {
    return `<img class="${cls}" src="${escapeHtml(book.coverUrl)}" alt="${escapeHtml(book.title || '')} cover" loading="lazy">`;
  }
  return `<div class="${cls} lib-cover-fallback">${escapeHtml(book.title || 'Book')}</div>`;
}

function readHref(book) {
  return bookHref(book);
}

function pct(pos) {
  return Math.max(0, Math.min(100, Math.round(((pos && pos.fraction) || 0) * 100)));
}

function continueCard(book, pos) {
  const p = pct(pos);
  const audio = isAudioBook(book);
  const verb = audio ? 'listening' : 'reading';
  const where = pos && pos.chapter ? pos.chapter : (p ? `Continue ${verb}` : 'Start at the beginning');
  return `
    <a class="lib-continue" href="${readHref(book)}">
      ${cover(book, '')}
      <div>
        <div class="lib-kicker">${p ? `Continue ${verb}` : (audio ? 'Start listening' : 'Start reading')}${audio ? ' · Audiobook' : ''}</div>
        <h2 class="lib-title">${escapeHtml(book.title || '')}</h2>
        <div class="lib-where">${escapeHtml(where)}</div>
        <div class="lib-bar"><i style="width:${p}%"></i></div>
        <div class="lib-meta"><span>${escapeHtml(book.author || '')}</span><span>${p}%</span></div>
        <span class="lib-cta">${p ? 'Resume' : (audio ? 'Play' : 'Open book')} →</span>
      </div>
    </a>`;
}

function shelfItem(book, pos) {
  const p = pct(pos);
  return `
    <a class="lib-book" href="${readHref(book)}">
      ${cover(book)}
      <div class="lib-book-title">${escapeHtml(book.title || '')}</div>
      <div class="lib-book-sub">${isAudioBook(book) ? 'Audiobook · ' : ''}${p ? `${p}% ${isAudioBook(book) ? 'listened' : 'read'}` : escapeHtml(book.author || 'Not started')}</div>
      ${p ? `<div class="lib-bar"><i style="width:${p}%"></i></div>` : ''}
    </a>`;
}

async function loadShelf() {
  const { ids, admin } = await libraryAccess({ fresh: true });
  let books;
  if (admin) {
    // Owners and admins see every book, including drafts, to proof uploads.
    const snap = await getDocs(collection(db, 'books'));
    books = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    books = (await Promise.all(ids.map((id) => getBook(id).catch(() => null)))).filter(Boolean);
  }
  return books.filter((b) => admin || b.status !== 'hidden');
}

// Live products that unlock a library book the member does not own yet.
// A failure here never costs the member their own shelf, so it is quiet.
async function loadAvailable(ownedIds) {
  try {
    const snap = await getDocs(query(collection(db, 'products'), where('status', '==', 'live')));
    const out = [];
    for (const d of snap.docs) {
      const p = { id: d.id, ...d.data() };
      const want = (Array.isArray(p.grantsBooks) ? p.grantsBooks : []).filter((b) => !ownedIds.includes(b));
      if (p.sellable !== true || !(p.price > 0) || p.showInDashboard === false || !want.length) continue;
      const book = await getBook(want[0]).catch(() => null);
      if (!book || book.status === 'hidden') continue;
      out.push({ product: p, book });
    }
    return out.sort((a, b) => (a.product.sortOrder || 0) - (b.product.sortOrder || 0));
  } catch (e) {
    console.warn('[library] available books did not load', e);
    return [];
  }
}

function availableItem({ product, book }) {
  const href = /^\/(?!\/)/.test(String(product.pageUrl || '')) ? product.pageUrl : bookHref(book);
  const kind = isAudioBook(book) ? 'Audiobook' : 'Ebook';
  return `
    <a class="lib-book lib-avail" href="${escapeHtml(href)}">
      ${cover({ ...book, coverUrl: book.coverUrl || product.imageUrl })}
      <div class="lib-book-title">${escapeHtml(book.title || product.name || '')}</div>
      <div class="lib-book-sub">${kind} · ${escapeHtml(fmtMoney(product.price))}</div>
      <span class="lib-avail-cta">${escapeHtml(product.pageCta || 'See details')} →</span>
    </a>`;
}

function availableSection(list) {
  if (!list.length) return '';
  return `
    <div class="lib-shelf-label" style="margin-top:44px;">Also available</div>
    <div class="lib-grid">${list.map(availableItem).join('')}</div>`;
}

async function renderLibrary() {
  const root = $('lib-root');
  let books = [];
  let available = [];
  try {
    const access = await libraryAccess({ fresh: true });
    [books, available] = await Promise.all([
      loadShelf(),
      // Admins already see every book on the shelf.
      access.admin ? Promise.resolve([]) : loadAvailable(access.ids)
    ]);
  } catch (e) {
    console.warn('[library] load failed', e);
    root.innerHTML = '<div class="lib-empty"><h2>Your library didn\'t load</h2>Check your connection and refresh the page.</div>';
    return;
  }

  if (!books.length) {
    root.innerHTML = `
      <div class="lib-empty">
        <h2>Your shelf is empty, for now</h2>
        Books and audiobooks you own live here, ready on any device. They come with the courses and bundles you enroll in, or on their own below.
        <div style="margin-top:22px;"><a class="btn btn-primary" href="/bundle.html">See The Complete I Can't Experience →</a></div>
      </div>
      ${availableSection(available)}`;
    return;
  }

  const positions = await loadAllPositions(books.map((b) => b.id));
  // The hero card is the book touched most recently, else the first owned.
  const recent = books.slice().sort((a, b) =>
    ((positions[b.id] && positions[b.id].at) || 0) - ((positions[a.id] && positions[a.id].at) || 0))[0];

  root.innerHTML = `
    ${continueCard(recent, positions[recent.id])}
    ${books.length > 1 ? `
      <div class="lib-shelf-label">All books · ${books.length}</div>
      <div class="lib-grid">${books.map((b) => shelfItem(b, positions[b.id])).join('')}</div>` : ''}
    ${availableSection(available)}`;
}

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
      return;
    }
    if (!(await ensureOnboarded(user))) return;
  }

  renderShell({ current: 'library' });
  renderTopbarEarly({ user: currentUser(), currentPage: null, links: [] });

  renderLibrary();

  let role = null;
  let profile = null;
  try {
    if (firebaseReady && currentUser()) {
      const info = await getRoleInfo();
      role = info.role;
      try { profile = await getUserProfile(currentUser().uid); } catch (e) {}
    }
  } catch (e) {}

  renderShell({ current: 'library', role });
  renderTopbar({ user: currentUser(), profile, role, currentPage: null, links: [], withSignOut: false });
}

main();
