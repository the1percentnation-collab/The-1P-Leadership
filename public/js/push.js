// Browser push (Firebase Cloud Messaging) — registers this device so the
// server's pushToUser() (functions/index.js) can reach it. Tokens live on
// users/{uid}.fcmTokens, the array pushToUser already reads and prunes.
//
// To turn it on:
//   1. Firebase Console > Project settings > Cloud Messaging > Web Push
//      certificates > Generate key pair; copy the public key.
//   2. Paste it below (VAPID_PUBLIC_KEY).
// Leaving the key blank hides every push toggle, so nothing breaks before
// it's configured.

import { app, db, firebaseReady } from './firebase.js';
import { doc, setDoc, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const VAPID_PUBLIC_KEY = ''; // <-- paste your Web Push public key here
const SDK = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';

/** iOS only delivers web push to sites added to the Home Screen. */
export function isIosNotInstalled() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone && !navigator.standalone;
}

/** True when this browser can take push and the project is configured for it. */
export async function pushAvailable() {
  if (!VAPID_PUBLIC_KEY || !firebaseReady) return false;
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
  try {
    const { isSupported } = await import(SDK);
    return await isSupported();
  } catch (e) {
    return false;
  }
}

/**
 * Ask permission, register the service worker and save this device's token.
 * Returns { ok:true } or { ok:false, reason:'denied'|'unsupported'|'error' }.
 */
export async function enablePush(uid) {
  if (!(await pushAvailable())) return { ok: false, reason: 'unsupported' };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'denied' };
    const { getMessaging, getToken } = await import(SDK);
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: reg
    });
    if (!token) return { ok: false, reason: 'error' };
    await setDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) }, { merge: true });
    return { ok: true };
  } catch (e) {
    console.warn('[push] enable failed', e);
    return { ok: false, reason: 'error' };
  }
}
