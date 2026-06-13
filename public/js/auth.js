// Auth module — login, signup, Google OAuth, password reset, invite-code flow, signout.
// Exposes `onAuthReady(cb)` which resolves once the first auth state fires.

import { auth, db, functions, firebaseReady } from './firebase.js';
import { isNative } from './capacitor-bridge.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  updateProfile,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const OWNER_EMAIL = 'the1percentnation@gmail.com';

let _authReadyResolve;
const _authReadyPromise = new Promise((r) => { _authReadyResolve = r; });
let _currentUser = null;

if (firebaseReady) {
  onAuthStateChanged(auth, (u) => {
    _currentUser = u;
    _authReadyResolve(u);
  });
} else {
  // If Firebase failed to init, resolve immediately with null so callers don't hang.
  _authReadyResolve(null);
}

export function onAuthReady(cb) {
  if (typeof cb === 'function') _authReadyPromise.then(cb);
  return _authReadyPromise;
}

export function currentUser() {
  return _currentUser;
}

// Ensure a users/{uid} doc exists. Creates with owner role if email matches bootstrap email.
export async function ensureUserDoc(user, extra = {}) {
  if (!user) return null;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  const isOwnerEmail = (user.email || '').toLowerCase() === OWNER_EMAIL;
  if (!snap.exists()) {
    const data = {
      email: user.email || null,
      displayName: user.displayName || extra.displayName || null,
      role: isOwnerEmail ? 'owner' : (extra.role || 'user'),
      companyId: extra.companyId || null,
      tier: extra.tier || 'individual',
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp()
    };
    await setDoc(ref, data);
    return data;
  } else {
    // Touch lastActiveAt; upgrade role to owner for the bootstrap email if missing.
    const patch = { lastActiveAt: serverTimestamp() };
    const cur = snap.data();
    if (isOwnerEmail && cur.role !== 'owner') patch.role = 'owner';
    await setDoc(ref, patch, { merge: true });
    return { ...cur, ...patch };
  }
}

export async function loginEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function signupEmail({ email, password, displayName, inviteCode, communityInviteToken }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    try { await updateProfile(cred.user, { displayName }); } catch (e) {}
  }
  await ensureUserDoc(cred.user, { displayName });
  if (inviteCode) {
    await acceptInvite(inviteCode);
  }
  if (communityInviteToken) {
    try { await acceptCommunityInvite(communityInviteToken); }
    catch (e) { console.warn('[auth] community invite accept failed', e); }
  }
  return cred.user;
}

export async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  // Always show the account chooser so users with multiple Google accounts
  // can pick one instead of being silently signed in with the last-used one.
  provider.setCustomParameters({ prompt: 'select_account' });

  if (isNative) {
    // Popups are blocked in native WebViews — use redirect flow.
    // getRedirectResult() in firebase.js will complete the sign-in on page load.
    sessionStorage.setItem('google_redirect_pending', '1');
    await signInWithRedirect(auth, provider);
    return null; // page reloads after the redirect completes
  }

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

export async function acceptInvite(code) {
  const call = httpsCallable(functions, 'acceptInvite');
  const res = await call({ code });
  return res.data;
}

export async function acceptCommunityInvite(token) {
  const call = httpsCallable(functions, 'acceptCommunityInvite');
  const res = await call({ token });
  return res.data;
}

export async function createCommunityInvite(opts = {}) {
  const call = httpsCallable(functions, 'createCommunityInvite');
  const res = await call(opts);
  return res.data;
}

export async function bootstrapOwner() {
  const call = httpsCallable(functions, 'bootstrapOwner');
  const res = await call({});
  // Force token refresh so the new custom claim is visible.
  try { await auth.currentUser.getIdToken(true); } catch (e) {}
  return res.data;
}

// Redirect helper used by pages that require auth.
export async function requireAuth(redirectTo = '/login.html') {
  const u = await onAuthReady();
  if (!u) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`${redirectTo}?next=${next}`);
    return null;
  }
  return u;
}
