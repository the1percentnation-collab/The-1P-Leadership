// ── Roles ───────────────────────────────────────────────────────────────────
// Reads the current user's role from a custom claim (server-set, authoritative
// for the platform owner) and falls back to users/{uid}.role. Cached per-uid.
//
//   'owner'  → platform super-admin (can manage every author's site)
//   'author' → a normal reader who owns exactly one editable site
//
// The `owner` claim is what Firestore rules should check for cross-tenant
// access. Until you wire a Cloud Function to set it, the users/{uid}.role
// field is used as a soft fallback (fine for local/dev).

import { auth, db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let _cache = null; // { uid, info }

export async function getRoleInfo(forceRefresh = false) {
  const user = auth && auth.currentUser;
  if (!user) {
    _cache = null;
    return { user: null, role: null, isOwner: false };
  }
  if (!forceRefresh && _cache && _cache.uid === user.uid) return _cache.info;

  let claimsRole = null;
  try {
    const tok = await user.getIdTokenResult(forceRefresh);
    claimsRole = tok.claims && tok.claims.role ? tok.claims.role : null;
  } catch (e) {}

  let docRole = null;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) docRole = snap.data().role || null;
  } catch (e) {}

  const role = claimsRole === 'owner' ? 'owner' : (docRole || 'author');
  const info = { user, role, isOwner: role === 'owner' };
  _cache = { uid: user.uid, info };
  return info;
}

export function clearRoleCache() { _cache = null; }
