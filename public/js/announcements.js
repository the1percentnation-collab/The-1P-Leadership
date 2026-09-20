// Announcements — the curated slides that lead the member dashboard.
//
// Distinct from the #announcements community channel: a channel post is a
// conversation, this is a broadcast. It carries an image, a CTA, a priority
// and a publish window, and only owner/admin can write one (firestore.rules).
//
// Scheduling is filtered client-side rather than in the query. Firestore
// cannot range-filter two different fields in one query, and an announcement
// scheduled for next week is not a secret — it simply has not been rendered
// yet — so there is nothing here worth a second index to hide.

import { app, auth, db, firebaseReady } from './firebase.js';
import {
  doc, getDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

export const ANNOUNCEMENT_KINDS = ['announcement', 'event', 'product', 'course', 'promo'];
export const ANNOUNCEMENT_AUDIENCES = ['all', 'enrolled', 'company', 'admin'];

// Lazy storage — only the authoring page pays for the storage bundle.
let _storage = null;
function storage() {
  if (!_storage && firebaseReady) _storage = getStorage(app);
  return _storage;
}

export async function uploadAnnouncementImage(file) {
  const user = auth && auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const s = storage();
  if (!s) throw new Error('Storage unavailable');
  const ext = (file.name.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase();
  const r = storageRef(s, `announcement-images/${user.uid}/${Date.now()}.${ext}`);
  await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' });
  return await getDownloadURL(r);
}

function toMillis(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}

function shape(id, data) {
  return {
    id,
    title: data.title || '',
    body: data.body || '',
    imageUrl: data.imageUrl || null,
    ctaLabel: data.ctaLabel || null,
    ctaHref: data.ctaHref || null,
    kind: ANNOUNCEMENT_KINDS.includes(data.kind) ? data.kind : 'announcement',
    priority: Number(data.priority || 0),
    audience: ANNOUNCEMENT_AUDIENCES.includes(data.audience) ? data.audience : 'all',
    courseSlug: data.courseSlug || null,
    companyId: data.companyId || null,
    active: data.active !== false,
    publishAtMs: toMillis(data.publishAt),
    expiresAtMs: toMillis(data.expiresAt),
    createdAtMs: toMillis(data.createdAt)
  };
}

/**
 * Is this announcement live, and is it for this member?
 *
 * `enrolled` targets anyone with at least one course (or a specific course
 * when courseSlug is set); `company` targets one company's members; `admin`
 * is for operational notes the whole membership does not need to read.
 */
function isVisibleTo(a, { role, companyId, enrolledSlugs, now }) {
  if (!a.active) return false;
  if (a.publishAtMs && a.publishAtMs > now) return false;
  if (a.expiresAtMs && a.expiresAtMs <= now) return false;

  const slugs = enrolledSlugs instanceof Set ? enrolledSlugs : new Set(enrolledSlugs || []);
  switch (a.audience) {
    case 'enrolled':
      return a.courseSlug ? slugs.has(a.courseSlug) : slugs.size > 0;
    case 'company':
      return !!companyId && a.companyId === companyId;
    case 'admin':
      return role === 'owner' || role === 'admin';
    default:
      return true;
  }
}

/**
 * The announcements this member should see right now, highest priority first
 * then newest. Fail-soft: a failure returns an empty list so the caller can
 * simply render nothing rather than break the page around it.
 */
export async function listActiveAnnouncements({
  role = 'user', companyId = null, enrolledSlugs = [], max = 10
} = {}) {
  if (!firebaseReady) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'announcements'),
      where('active', '==', true),
      orderBy('publishAt', 'desc'),
      limit(30)
    ));
    const now = Date.now();
    return snap.docs
      .map((d) => shape(d.id, d.data() || {}))
      .filter((a) => isVisibleTo(a, { role, companyId, enrolledSlugs, now }))
      .sort((a, b) => (b.priority - a.priority) || ((b.publishAtMs || 0) - (a.publishAtMs || 0)))
      .slice(0, max);
  } catch (e) {
    console.warn('[announcements] list failed', e);
    return [];
  }
}

// ─── Admin ────────────────────────────────────────────────────────────────

/** Every announcement, scheduled and expired included. Admin console only. */
export async function listAllAnnouncements() {
  if (!firebaseReady) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'announcements'),
      orderBy('publishAt', 'desc'),
      limit(100)
    ));
    return snap.docs.map((d) => shape(d.id, d.data() || {}));
  } catch (e) {
    console.warn('[announcements] listAll failed', e);
    return [];
  }
}

export async function getAnnouncement(id) {
  if (!firebaseReady || !id) return null;
  const snap = await getDoc(doc(db, 'announcements', id));
  return snap.exists() ? shape(snap.id, snap.data() || {}) : null;
}

// Shared by create and update so both write the same shape. Dates arrive from
// the form as `datetime-local` strings; an empty one means "no bound", which
// is a real value (publish now / never expires), not a missing one.
function payloadFrom(data) {
  const parseDate = (v) => {
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t);
  };
  return {
    title: (data.title || '').trim() || 'Untitled announcement',
    body: (data.body || '').trim() || null,
    imageUrl: data.imageUrl || null,
    ctaLabel: (data.ctaLabel || '').trim() || null,
    ctaHref: (data.ctaHref || '').trim() || null,
    kind: ANNOUNCEMENT_KINDS.includes(data.kind) ? data.kind : 'announcement',
    priority: Number(data.priority) || 0,
    audience: ANNOUNCEMENT_AUDIENCES.includes(data.audience) ? data.audience : 'all',
    courseSlug: (data.courseSlug || '').trim() || null,
    companyId: (data.companyId || '').trim() || null,
    active: data.active !== false,
    publishAt: parseDate(data.publishAt) || new Date(),
    expiresAt: parseDate(data.expiresAt)
  };
}

export async function createAnnouncement(data = {}) {
  const user = auth && auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const ref = await addDoc(collection(db, 'announcements'), {
    ...payloadFrom(data),
    createdByUid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateAnnouncement(id, data = {}) {
  if (!id) throw new Error('Missing announcement id');
  await updateDoc(doc(db, 'announcements', id), {
    ...payloadFrom(data),
    updatedAt: serverTimestamp()
  });
}

export async function deleteAnnouncement(id) {
  if (!id) throw new Error('Missing announcement id');
  await deleteDoc(doc(db, 'announcements', id));
}
