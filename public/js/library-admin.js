// Digital library admin — the data layer behind /manage-library.html.
//
// Does from the browser what scripts/upload-book.js does from a terminal:
// puts the EPUB and cover under books/{id}/ in Storage and writes books/{id}.
// storage.rules and firestore.rules already restrict both to admins, so this
// module only adds the friendlier checks (a real EPUB, size) before a rules
// rejection would. The one thing a browser cannot do is grant the book to
// members (users.ownedBookIds is server-only); that goes through the
// syncBookGrants callable.

import { app, auth, db, functions, firebaseReady } from './firebase.js';
import {
  collection, doc, getDoc, getDocs, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

export const EPUB_MAX = 50 * 1024 * 1024;
export const COVER_MAX = 10 * 1024 * 1024;
export const COVER_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const ID_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
export const AUDIO_MAX = 300 * 1024 * 1024;
// By extension, because browsers leave file.type empty for .m4b and some
// .m4a files. storage.rules accepts exactly these.
export const AUDIO_TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac' };

let _storage = null;
function storage() {
  if (!_storage && firebaseReady) _storage = getStorage(app);
  return _storage;
}

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// An EPUB is a zip whose first entry is an uncompressed "mimetype" file
// holding "application/epub+zip". Same check as scripts/upload-book.js, run
// on the first bytes so a PDF or .docx is caught before a 50MB upload.
export async function validateEpub(file) {
  if (!file) return 'Choose the EPUB file.';
  if (file.size > EPUB_MAX) return `The EPUB is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 50 MB. Compress the images inside it.`;
  const head = new Uint8Array(await file.slice(0, 128).arrayBuffer());
  const bad = 'That is not an EPUB. Export the book as EPUB from Vellum, Atticus, Kindle Create, Draft2Digital or Calibre.';
  if (head.length < 30 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) return bad;
  const nameLen = head[26] | (head[27] << 8);
  const extraLen = head[28] | (head[29] << 8);
  const name = String.fromCharCode(...head.slice(30, 30 + nameLen));
  const start = 30 + nameLen + extraLen;
  const body = String.fromCharCode(...head.slice(start, start + 20));
  if (name !== 'mimetype' || body !== 'application/epub+zip') return bad;
  return null;
}

export function audioExt(file) {
  const m = /\.([a-z0-9]+)$/i.exec((file && file.name) || '');
  const ext = m ? m[1].toLowerCase() : '';
  return AUDIO_TYPES[ext] ? ext : null;
}

export function validateAudio(file) {
  if (!file) return 'Choose the chapter files.';
  if (!audioExt(file)) return `${file.name} is not an MP3 or M4A file. Export each chapter as MP3 (or M4A).`;
  if (file.size > AUDIO_MAX) return `${file.name} is ${(file.size / 1024 / 1024).toFixed(0)} MB; the limit is 300 MB per chapter.`;
  return null;
}

// "03 - The Comfort Trap.mp3" -> "The Comfort Trap". Falls back to the
// chapter number when the name is only digits.
export function titleFromFileName(name, index) {
  const base = String(name || '').replace(/\.[a-z0-9]+$/i, '');
  const clean = base.replace(/^[\s._-]*(?:track|chapter|ch)?[\s._-]*\d+[\s._:-]*/i, '').replace(/[_]+/g, ' ').trim();
  return clean || `Chapter ${index + 1}`;
}

// Chapter files in the order the book runs, by their names: "2" before "10".
export function sortAudioFiles(files) {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

// Seconds of audio in a local file, read by the browser itself. 0 when the
// browser can't tell; the player then counts chapters instead of minutes.
export function probeDuration(file) {
  return new Promise((resolve) => {
    let url = '';
    try { url = URL.createObjectURL(file); } catch (e) { resolve(0); return; }
    const a = new Audio();
    const done = (v) => { try { URL.revokeObjectURL(url); } catch (e) {} resolve(v); };
    const t = setTimeout(() => done(0), 15000);
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => { clearTimeout(t); done(isFinite(a.duration) ? Math.round(a.duration) : 0); });
    a.addEventListener('error', () => { clearTimeout(t); done(0); });
    a.src = url;
  });
}

export function audioTrackPath(bookId, index, file) {
  return `books/${bookId}/audio-${String(index + 1).padStart(2, '0')}.${audioExt(file)}`;
}

export async function uploadAudioTrack(bookId, index, file, onProgress) {
  const path = audioTrackPath(bookId, index, file);
  await upload(path, file, AUDIO_TYPES[audioExt(file)], onProgress);
  return path;
}

export function validateCover(file) {
  if (!file) return null;
  if (!COVER_TYPES[file.type]) return 'The cover must be a JPG, PNG or WebP image.';
  if (file.size > COVER_MAX) return 'The cover is over 10 MB.';
  return null;
}

function upload(path, file, contentType, onProgress) {
  const s = storage();
  if (!s) return Promise.reject(new Error('Storage unavailable'));
  const task = uploadBytesResumable(storageRef(s, path), file, { contentType });
  return new Promise((resolve, reject) => {
    task.on('state_changed',
      (snap) => onProgress && onProgress(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
      (err) => reject(err.code === 'storage/unauthorized'
        ? new Error('Storage refused the upload. You need admin access, and the file must be an EPUB under 50 MB or an MP3/M4A chapter under 300 MB.')
        : err),
      () => resolve(task.snapshot.ref));
  });
}

export function uploadEpub(bookId, file, onProgress) {
  return upload(`books/${bookId}/book.epub`, file, 'application/epub+zip', onProgress);
}

// The cover is public (storage.rules), so a download URL is fine for <img>.
export async function uploadCover(bookId, file, onProgress) {
  const ref = await upload(`books/${bookId}/cover.${COVER_TYPES[file.type]}`, file, file.type, onProgress);
  return getDownloadURL(ref);
}

export async function getBookAdmin(bookId) {
  const snap = await getDoc(doc(db, 'books', bookId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listBooks() {
  const snap = await getDocs(collection(db, 'books'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
}

// `newFile` true means the EPUB changed: bump `version` so every reader's
// offline copy refreshes on its next open (books.js keys the cache on it).
export async function saveBook(bookId, fields, { isNew = false, newFile = false } = {}) {
  const data = {
    title: String(fields.title || '').trim(),
    author: String(fields.author || '').trim(),
    status: fields.status === 'hidden' ? 'hidden' : 'live',
    // Where "Get this book" leads: the bundle for a course book, the book's
    // own sales section for a free preview.
    buyHref: String(fields.buyHref || '').trim() || (fields.openAccess === true ? '/books' : '/bundle.html'),
    // A free sample anyone with the link can read, no account needed.
    openAccess: fields.openAccess === true,
    updatedAt: serverTimestamp()
  };
  if (fields.coverUrl) data.coverUrl = fields.coverUrl;
  if (fields.format === 'audio') {
    // An audiobook: chapters instead of an EPUB, a free sample chapter for
    // the sales view, and the blurb that sells it. Never open access; the
    // sample chapter is the free taste.
    data.format = 'audio';
    data.openAccess = false;
    data.buyHref = `/listen?book=${bookId}`;
    data.description = String(fields.description || '').trim().slice(0, 4000);
    data.sampleTrack = Number.isInteger(fields.sampleTrack) ? fields.sampleTrack : null;
    if (Array.isArray(fields.tracks)) {
      data.tracks = fields.tracks.map((t, i) => ({
        title: String(t.title || '').trim().slice(0, 200) || `Chapter ${i + 1}`,
        path: String(t.path),
        duration: Number(t.duration) > 0 ? Math.round(Number(t.duration)) : 0,
        size: Number(t.size) > 0 ? Math.round(Number(t.size)) : 0
      }));
    }
    if (isNew || newFile) data.version = String(Date.now());
  } else if (isNew || newFile) {
    data.filePath = `books/${bookId}/book.epub`;
    data.version = String(Date.now());
  }
  if (isNew) data.createdAt = serverTimestamp();
  await setDoc(doc(db, 'books', bookId), data, { merge: true });
  return data;
}

// Courses and which books each grants, for the "attach to courses" panel.
export async function listCourseGrants() {
  const snap = await getDocs(collection(db, 'courses'));
  return snap.docs
    .map((d) => ({ slug: d.id, title: d.data().title || d.id, status: d.data().status || '', kind: d.data().kind || '', grantsBooks: Array.isArray(d.data().grantsBooks) ? d.data().grantsBooks.map(String) : [] }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function setCourseGrants(slug, grantsBooks) {
  await setDoc(doc(db, 'courses', slug), { grantsBooks: grantsBooks.map(String) }, { merge: true });
}

// Server-side: add the book to everyone already enrolled in a course that
// grants it. Returns { granted, checked }.
export async function syncBookGrants(bookId) {
  if (!auth || !auth.currentUser) throw new Error('Not signed in');
  const res = await httpsCallable(functions, 'syncBookGrants')({ bookId });
  return res.data;
}
