// ── Auth ────────────────────────────────────────────────────────────────────
// Login / signup / Google OAuth / password reset / signout, plus a users/{uid}
// profile doc that every author gets on first sign-in.
//
// `onAuthReady()` resolves once the first auth-state event fires, so callers can
// `await onAuthReady()` at the top of a page and know whether someone is signed
// in before rendering.

import { auth, db, firebaseReady } from './firebase.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  updateProfile,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// The platform super-admin. This one email is minted as role:'owner' so it can
// see/manage every author's site. Everyone else signs up as a plain 'author'.
// (In production, promote to a server-set custom claim — see README §Roles.)
const PLATFORM_OWNER_EMAIL = 'you@example.com';

let _authReadyResolve;
const _authReadyPromise = new Promise((r) => { _authReadyResolve = r; });
let _currentUser = null;

if (firebaseReady) {
  onAuthStateChanged(auth, (u) => {
    _currentUser = u;
    _authReadyResolve(u);
  });
} else {
  _authReadyResolve(null);
}

export function onAuthReady(cb) {
  if (typeof cb === 'function') _authReadyPromise.then(cb);
  return _authReadyPromise;
}

export function currentUser() {
  return _currentUser;
}

// Create users/{uid} on first sign-in; touch lastActiveAt afterwards.
export async function ensureUserDoc(user, extra = {}) {
  if (!user) return null;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  const isPlatformOwner = (user.email || '').toLowerCase() === PLATFORM_OWNER_EMAIL;
  if (!snap.exists()) {
    const data = {
      email: user.email || null,
      displayName: user.displayName || extra.displayName || null,
      role: isPlatformOwner ? 'owner' : 'author',
      siteId: null,                    // filled in lazily by ensureSite() (site-store.js)
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp()
    };
    await setDoc(ref, data);
    return data;
  }
  const patch = { lastActiveAt: serverTimestamp() };
  const cur = snap.data();
  if (isPlatformOwner && cur.role !== 'owner') patch.role = 'owner';
  await setDoc(ref, patch, { merge: true });
  return { ...cur, ...patch };
}

export async function loginEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function signupEmail({ email, password, displayName }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    try { await updateProfile(cred.user, { displayName }); } catch (e) {}
  }
  await ensureUserDoc(cred.user, { displayName });
  return cred.user;
}

export async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function signOut() {
  return fbSignOut(auth);
}

// Redirect helper for pages that require a signed-in author.
export async function requireAuth(redirectTo = '/login.html') {
  const u = await onAuthReady();
  if (!u) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`${redirectTo}?next=${next}`);
    return null;
  }
  return u;
}
