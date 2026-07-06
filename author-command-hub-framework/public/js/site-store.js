// ── Site store — the tenancy data layer ─────────────────────────────────────
// Each signed-in author owns EXACTLY ONE site. This module is the only place
// that reads/writes the site + its pages, so the Hub UI (hub.js) and the public
// renderer (renderer.js) stay thin.
//
// Firestore shape:
//   users/{uid}                      { …, siteId }              ← points at the owner's site
//   sites/{siteId}                   { ownerUid, title, tagline, slug,
//                                       status: 'draft'|'published',
//                                       homePageId, theme, createdAt, updatedAt }
//   sites/{siteId}/pages/{pageId}    { title, slug, html, status: 'draft'|'published',
//                                       showInNav, sortOrder, updatedAt }
//
// A "page" is a chunk of sanitized rich-text HTML authored in the Hub's editor.
// A "site" is that author's collection of pages plus a little site-wide config.

import { auth, db, firebaseReady } from './firebase.js';
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── ids + slugs ─────────────────────────────────────────────────────────────

function genId(len = 16) {
  const chars = 'abcdefghijkmnpqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function slugify(s, fallback = 'page') {
  const out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return out || fallback;
}

// ── the author's own site ───────────────────────────────────────────────────

// Return the caller's site, creating it (and linking users/{uid}.siteId) the
// first time. Call this once at the top of the Hub.
export async function ensureMySite(user, extra = {}) {
  if (!firebaseReady || !user) return null;
  const uref = doc(db, 'users', user.uid);
  const usnap = await getDoc(uref);
  let siteId = usnap.exists() ? (usnap.data().siteId || null) : null;

  if (siteId) {
    const s = await getDoc(doc(db, 'sites', siteId));
    if (s.exists()) return { id: s.id, ...s.data() };
  }

  // No site yet — mint one.
  siteId = genId();
  const data = {
    ownerUid: user.uid,
    title: extra.title || (user.displayName ? `${user.displayName}'s site` : 'My site'),
    tagline: extra.tagline || '',
    slug: slugify(extra.title || user.displayName || user.email || 'my-site', 'my-site'),
    status: 'draft',
    homePageId: null,
    theme: 'light',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, 'sites', siteId), data);
  await setDoc(uref, { siteId }, { merge: true });
  return { id: siteId, ...data };
}

// Patch site-wide config (title, tagline, status, homePageId, theme…).
export async function saveSite(siteId, fields) {
  await setDoc(doc(db, 'sites', siteId), {
    ...fields,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Public read of any site by its document id (used by the renderer).
export async function getSiteById(siteId) {
  if (!firebaseReady || !siteId) return null;
  const s = await getDoc(doc(db, 'sites', siteId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// ── pages ───────────────────────────────────────────────────────────────────

// All pages for the Hub (owner sees drafts + published, sorted).
export async function loadPages(siteId) {
  if (!firebaseReady || !siteId) return [];
  const snap = await getDocs(collection(db, 'sites', siteId, 'pages'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

// Only published pages, for the public renderer. The status filter is REQUIRED:
// the security rules only allow anonymous reads of published pages, so a query
// without it would be rejected on the first draft doc.
export async function loadPublishedPages(siteId) {
  if (!firebaseReady || !siteId) return [];
  const q = query(collection(db, 'sites', siteId, 'pages'), where('status', '==', 'published'));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export async function getPage(siteId, pageId) {
  const p = await getDoc(doc(db, 'sites', siteId, 'pages', pageId));
  return p.exists() ? { id: p.id, ...p.data() } : null;
}

// Create or update a page. Pass `pageId` to update, omit it to create.
export async function savePage(siteId, page) {
  const id = page.id || genId();
  const existing = page.id ? await getPage(siteId, page.id) : null;
  await setDoc(doc(db, 'sites', siteId, 'pages', id), {
    title: page.title || 'Untitled',
    slug: page.slug || slugify(page.title),
    html: page.html || '',
    status: page.status || 'draft',
    showInNav: page.showInNav !== false,
    sortOrder: typeof page.sortOrder === 'number'
      ? page.sortOrder
      : (existing ? (existing.sortOrder ?? 0) : Date.now()),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return id;
}

export async function deletePage(siteId, pageId) {
  await deleteDoc(doc(db, 'sites', siteId, 'pages', pageId));
}

// Swap two pages' sortOrder (used by the Hub's ↑/↓ reorder buttons).
export async function swapPageOrder(siteId, a, b) {
  const ao = a.sortOrder ?? 0;
  const bo = b.sortOrder ?? 0;
  await Promise.all([
    setDoc(doc(db, 'sites', siteId, 'pages', a.id), { sortOrder: bo }, { merge: true }),
    setDoc(doc(db, 'sites', siteId, 'pages', b.id), { sortOrder: ao }, { merge: true })
  ]);
}
