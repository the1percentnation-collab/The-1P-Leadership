// The finish line, shared by every course player.
//
// When the last module is done the player calls reportCourseComplete. The
// recordCourseCompletion callable checks the progress for itself, stamps the
// completion, moves a beta tester to completed, logs it on their CRM card and
// emails the review ask. The review itself lives at /review.html.

import { functions, firebaseReady, auth } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const SENT_PREFIX = '1p_course_done_reported_';

/** Where a member rates `slug`. */
export function reviewHref(slug) {
  return `/review.html?course=${encodeURIComponent(slug)}`;
}

/**
 * Tells the server the member finished `slug`. Safe to call repeatedly: once
 * per browser session here, and the server records a completion only once.
 */
export async function reportCourseComplete(slug, title) {
  if (!slug || !firebaseReady || !auth || !auth.currentUser) return null;
  const key = SENT_PREFIX + slug;
  try { if (sessionStorage.getItem(key)) return null; } catch (e) {}
  try {
    const res = await httpsCallable(functions, 'recordCourseCompletion')({ slug, title: title || '' });
    const d = (res && res.data) || {};
    // An "incomplete" answer means a progress write has not landed yet; leave
    // the guard unset so the next finished module tries again.
    if (d.ok) { try { sessionStorage.setItem(key, '1'); } catch (e) {} }
    return d;
  } catch (e) {
    console.warn('[course-completion] could not record completion', e);
    return null;
  }
}
