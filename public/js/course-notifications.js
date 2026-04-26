// Course-launch notification subscriptions.
//
// When a user clicks "Notify me when live" on a coming-soon course, we:
//   1. Try to get an FCM token (web push). If unavailable, fall back to
//      email-only — push is best-effort, email is guaranteed.
//   2. Save the FCM token (if any) onto users/{uid}.fcmTokens (arrayUnion).
//   3. Write a subscriber doc at:
//        courseSubscribers/{slug}/subscribers/{uid}
//      The Cloud Function `onCourseStatusUpdated` reads these when the course
//      flips to status='live' and dispatches email + push to every subscriber.
//
// Storage shape (subscriber doc):
//   { uid, email, displayName, courseSlug, courseTitle, pushEnabled, createdAt }

import { auth, db, firebaseReady } from './firebase.js';
import {
  doc, setDoc, getDoc,
  serverTimestamp, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { requestNotificationToken } from './messaging.js';

const _subscribed = new Set();

export async function loadCourseSubscriptions() {
  _subscribed.clear();
  if (!firebaseReady || !auth || !auth.currentUser) return _subscribed;
  const uid = auth.currentUser.uid;

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.exists() ? snap.data() : {};
    const slugs = Array.isArray(data.notifyCourseSlugs) ? data.notifyCourseSlugs : [];
    slugs.forEach((s) => _subscribed.add(s));
  } catch (e) {
    console.warn('[course-notifications] load failed', e);
  }
  return _subscribed;
}

export function isSubscribedToCourse(slug) {
  return _subscribed.has(slug);
}

/**
 * Subscribe the current user to be notified when a course goes live.
 * `course` must include { slug, title }.
 *
 * Returns { ok: true, pushEnabled: boolean }. Throws if not signed in or
 * Firestore is unreachable.
 */
export async function subscribeToCourseLaunch(course) {
  if (!course || !course.slug) throw new Error('Missing course.');
  if (!firebaseReady || !auth || !auth.currentUser) {
    throw new Error('Please sign in to get notified.');
  }
  const user = auth.currentUser;

  // Best-effort: ask for push permission and grab an FCM token. If it fails,
  // we still subscribe via email.
  let token = null;
  try { token = await requestNotificationToken(); }
  catch (e) { token = null; }

  // Save the token + subscribed slug onto the user doc. The cloud function
  // reads fcmTokens here when the course goes live.
  try {
    const userPatch = {
      notifyCourseSlugs: arrayUnion(course.slug),
      lastActiveAt: serverTimestamp()
    };
    if (token) userPatch.fcmTokens = arrayUnion(token);
    await setDoc(doc(db, 'users', user.uid), userPatch, { merge: true });
  } catch (e) {
    console.warn('[course-notifications] user-doc patch failed', e);
  }

  // Write the subscriber record. This is what the Cloud Function reads when
  // the course flips to live.
  await setDoc(
    doc(db, 'courseSubscribers', course.slug, 'subscribers', user.uid),
    {
      uid: user.uid,
      email: user.email || null,
      displayName: user.displayName || null,
      courseSlug: course.slug,
      courseTitle: course.title || course.slug,
      pushEnabled: !!token,
      createdAt: serverTimestamp()
    },
    { merge: true }
  );

  _subscribed.add(course.slug);
  return { ok: true, pushEnabled: !!token };
}
