// Roles — reads the current user's role from both custom claims and Firestore users/{uid}.
// Custom claim wins (owner is set via `bootstrapOwner` Cloud Function). Firestore doc is
// authoritative for admin/user role and companyId.

import { auth, db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let _cache = null; // { uid, role, companyId, fetchedAt }

export async function getRoleInfo(forceRefresh = false) {
  const user = auth && auth.currentUser;
  if (!user) {
    _cache = null;
    return { user: null, role: null, companyId: null, isOwner: false, isAdmin: false };
  }
  if (!forceRefresh && _cache && _cache.uid === user.uid) return _cache.info;

  let claimsRole = null;
  try {
    const tok = await user.getIdTokenResult(forceRefresh);
    claimsRole = tok.claims && tok.claims.role ? tok.claims.role : null;
  } catch (e) {}

  let docRole = null;
  let companyId = null;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      const data = snap.data();
      docRole = data.role || null;
      companyId = data.companyId || null;
    }
  } catch (e) {}

  // Owner claim beats everything. Otherwise fall back to Firestore role.
  const role = claimsRole === 'owner' ? 'owner' : (docRole || 'user');
  const info = {
    user,
    role,
    companyId,
    isOwner: role === 'owner',
    isAdmin: role === 'admin' || role === 'owner'
  };
  _cache = { uid: user.uid, info };
  return info;
}

export function clearRoleCache() { _cache = null; }
