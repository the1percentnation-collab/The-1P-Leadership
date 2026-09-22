// The digital library — data layer shared by the library shelf
// (library.html) and the reader (read.html).
//
// Books are deliberately their own system, not part of a course:
//   books/{bookId}                     public metadata (title, author, cover, chapters, version)
//   Storage books/{bookId}/book.epub   the file; storage.rules lets only owners read it
//   users/{uid}.ownedBookIds           what the member owns (Admin SDK writes only)
//   users/{uid}/bookProgress/{bookId}  where they left off, synced across devices
// A course attaches a book through `grantsBooks` in functions/index.js; nothing
// here reads course data, so a course change can never break the reader.

import { app, db, firebaseReady } from './firebase.js';
import { currentUser } from './auth.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage, ref, getBlob
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

let _ownedCache = null;

// { ids: bookIds the member owns, admin: may open any book }
export async function libraryAccess({ fresh = false } = {}) {
  if (_ownedCache && !fresh) return _ownedCache;
  const u = currentUser();
  if (!firebaseReady || !u) return { ids: [], admin: false };
  const snap = await getDoc(doc(db, 'users', u.uid));
  const data = snap.exists() ? snap.data() : {};
  const ids = Array.isArray(data.ownedBookIds) ? data.ownedBookIds.map(String) : [];
  // Admins see every book so they can proof an upload before it is sold.
  const admin = data.role === 'admin' || data.role === 'owner';
  _ownedCache = { ids, admin };
  return _ownedCache;
}

export async function ownsBook(bookId) {
  const { ids, admin } = await libraryAccess();
  return admin || ids.includes(bookId);
}

export async function getBook(bookId) {
  const snap = await getDoc(doc(db, 'books', bookId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ── Reading position ────────────────────────────────────────────────────
// Written to localStorage on every page turn (instant resume on this device)
// and to Firestore on a debounce (resume on the next device). On open, the
// newer of the two wins so switching devices never throws you backwards.

const LS_POS = (bookId) => `1p_book_pos_${bookId}`;

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

export async function loadPosition(bookId) {
  const local = lsGet(LS_POS(bookId));
  let remote = null;
  const u = currentUser();
  if (firebaseReady && u) {
    try {
      const snap = await getDoc(doc(db, 'users', u.uid, 'bookProgress', bookId));
      if (snap.exists()) {
        const d = snap.data();
        remote = {
          cfi: d.cfi || null,
          fraction: typeof d.fraction === 'number' ? d.fraction : 0,
          bookmarks: Array.isArray(d.bookmarks) ? d.bookmarks : [],
          at: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : 0
        };
      }
    } catch (e) {
      console.warn('[books] could not load synced position', e);
    }
  }
  if (!local) return remote;
  if (!remote) return local;
  const newer = (local.at || 0) >= (remote.at || 0) ? local : remote;
  // Bookmarks merge rather than race: one made on either device is kept.
  const marks = new Map();
  [...(remote.bookmarks || []), ...(local.bookmarks || [])].forEach((b) => b && b.cfi && marks.set(b.cfi, b));
  return { ...newer, bookmarks: [...marks.values()] };
}

export function createPositionSaver(bookId) {
  let pending = null;
  let timer = null;

  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    const p = pending;
    pending = null;
    const u = currentUser();
    if (!p || !firebaseReady || !u) return;
    try {
      await setDoc(doc(db, 'users', u.uid, 'bookProgress', bookId), {
        cfi: String(p.cfi || '').slice(0, 1990),
        fraction: Number(p.fraction) || 0,
        chapter: String(p.chapter || '').slice(0, 200),
        bookmarks: (p.bookmarks || []).slice(0, 200),
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('[books] position sync failed (kept on this device)', e);
    }
  }

  function save(pos) {
    const entry = { ...pos, at: Date.now() };
    lsSet(LS_POS(bookId), entry);
    pending = entry;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 3000);
  }

  return { save, flush };
}

// Shelf view: the position for every owned book, local first then synced.
export async function loadAllPositions(bookIds) {
  const out = {};
  await Promise.all(bookIds.map(async (id) => {
    try { out[id] = await loadPosition(id); } catch (e) { out[id] = null; }
  }));
  return out;
}

// ── The book file ───────────────────────────────────────────────────────
// Fetched with getBlob() (checked against storage.rules on every fetch, no
// shareable token URL) and kept in IndexedDB keyed by the book's `version`,
// so re-opening is instant and a short loss of signal doesn't stop reading.
// Uploading a new edition bumps `version`, which misses the cache and
// replaces the stored copy.

const IDB_NAME = '1p-library';
const IDB_STORE = 'files';

function idb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const d = await idb();
  return new Promise((resolve) => {
    const tx = d.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => resolve(null);
  });
}

async function idbPutReplacing(prefix, key, value) {
  const d = await idb();
  return new Promise((resolve) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    // Drop older editions of the same book so storage doesn't grow.
    const cur = store.openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) { store.put(value, key); return; }
      if (String(c.key).startsWith(prefix) && c.key !== key) c.delete();
      c.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function getBookFile(book) {
  const version = String(book.version || '1');
  const key = `${book.id}:${version}`;
  try {
    const hit = await idbGet(key);
    if (hit) return new File([hit], `${book.id}.epub`, { type: 'application/epub+zip' });
  } catch (e) { /* private mode or blocked storage: fall through to network */ }

  const path = book.filePath || `books/${book.id}/book.epub`;
  const blob = await getBlob(ref(getStorage(app), path));
  try { await idbPutReplacing(`${book.id}:`, key, blob); } catch (e) {}
  return new File([blob], `${book.id}.epub`, { type: 'application/epub+zip' });
}
