// Enrollments — tracks which courses the signed-in user has signed up for.
//
// Storage: `users/{uid}.enrolledCourseSlugs` (array). Writable by self
// (allowed by existing firestore rules on /users/{uid}). No rule changes.
//
// Fallback: localStorage when Firebase is unavailable.
//
// Legacy auto-enroll: users who already have 1P-CLC progress (from before
// this feature shipped) are auto-enrolled in 1p-clc the first time they load.

import { auth, db, firebaseReady } from './firebase.js';
import {
  doc, getDoc, setDoc, serverTimestamp, arrayUnion,
  collection, getDocs, limit, query
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { COURSES } from './courses-registry.js';

const LS_KEY = '1p_academy_enrollments';

let _cache = null;
let _cacheUid = null;

function lsGet() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); }
  catch (e) { return new Set(); }
}
function lsSet(set) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(set))); } catch (e) {}
}

export async function loadEnrollments() {
  // Start from localStorage so the UI has something to render synchronously
  // if firestore is slow or unreachable.
  const local = lsGet();

  if (!firebaseReady || !auth || !auth.currentUser) {
    _cache = local;
    _cacheUid = null;
    return _cache;
  }

  const uid = auth.currentUser.uid;
  if (_cacheUid === uid && _cache) return _cache;

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.exists() ? snap.data() : {};
    const slugs = Array.isArray(data.enrolledCourseSlugs) ? data.enrolledCourseSlugs : [];
    _cache = new Set([...local, ...slugs]);
    _cacheUid = uid;

    // Legacy migration: if they have any progress in 1p-clc, auto-enroll.
    if (!_cache.has('1p-clc')) {
      try {
        const progQ = query(collection(db, 'users', uid, 'progress'), limit(1));
        const progSnap = await getDocs(progQ);
        if (!progSnap.empty) {
          await enrollInCourse('1p-clc');
        }
      } catch (e) { /* best-effort; ignore */ }
    }
  } catch (e) {
    console.warn('[enrollments] load failed, using local cache', e);
    _cache = local;
  }

  return _cache;
}

export async function enrollInCourse(slug) {
  const known = COURSES.find((c) => c.slug === slug);
  if (!known) throw new Error(`Unknown course: ${slug}`);
  if (known.status !== 'live') throw new Error('This course isn\'t available to join yet.');

  if (!_cache) _cache = new Set();
  _cache.add(slug);
  lsSet(_cache);

  if (firebaseReady && auth && auth.currentUser) {
    try {
      await setDoc(doc(db, 'users', auth.currentUser.uid), {
        enrolledCourseSlugs: arrayUnion(slug),
        lastActiveAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('[enrollments] remote write failed; kept in localStorage', e);
    }
  }
}

export function isEnrolled(slug) {
  return _cache ? _cache.has(slug) : false;
}

export function enrolledCourses() {
  const set = _cache || new Set();
  return COURSES.filter((c) => set.has(c.slug));
}

export function availableCourses() {
  const set = _cache || new Set();
  return COURSES.filter((c) => !set.has(c.slug));
}
