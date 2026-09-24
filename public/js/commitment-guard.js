// Commitment gate — before a member's first session in a course they must set
// a deadline and a weekly rhythm on /commit.html (Parkinson's Law: work
// expands to fill the time you give it). One commitment per course, stored at
// users/{uid}/courseCommitments/{slug}. Same shape as onboarding-guard.js:
// fails open on transient errors so a flaky read never locks anyone out of a
// course they paid for.

import { db, firebaseReady } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/** The member's commitment for a course, or null. Throws on read failure. */
export async function loadCommitment(uid, slug) {
  const snap = await getDoc(doc(db, 'users', uid, 'courseCommitments', slug));
  return snap.exists() ? snap.data() : null;
}

/**
 * Returns the commitment (truthy) if the caller may proceed. If the member
 * hasn't committed to this course yet, redirects to /commit.html (preserving
 * where they were headed via ?next=) and returns false — callers should
 * `return` when false.
 */
export async function ensureCommitted(user, slug) {
  if (!firebaseReady || !user || !slug) return true;
  try {
    const c = await loadCommitment(user.uid, slug);
    if (c) return c;
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/commit.html?course=${encodeURIComponent(slug)}&next=${next}`);
    return false;
  } catch (e) {
    console.warn('[commitment-guard] check failed, allowing through', e);
    return true;
  }
}
