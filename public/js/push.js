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

const VAPID_PUBLIC_KEY = 'BF4PAT5i-T4_ozQ3-k1ekN4jT8I5KDBnj1pYkyoH6khh3mAizYJQny_4KQpkKP1BKG4BWGZQot6FXugy06DqphU'; // <-- paste your Web Push public key here
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
 * Resolve once `reg` has an active worker. getToken() on a brand-new
 * registration fails with "no active Service Worker" otherwise: that was the
 * first-toggle failure in the live test, which a second toggle "fixed" only
 * because the worker had finished activating by then.
 */
function whenActive(reg, timeoutMs = 10000) {
  if (reg.active) return Promise.resolve();
  const sw = reg.installing || reg.waiting;
  if (!sw) return navigator.serviceWorker.ready.then(() => {});
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    sw.addEventListener('statechange', () => {
      if (sw.state === 'activated') { clearTimeout(timer); resolve(); }
    });
  });
}

/**
 * Ask permission, register the service worker and save this device's token.
 * Returns { ok:true } or
 * { ok:false, reason:'denied'|'dismissed'|'unsupported'|'error', message? }.
 */
export async function enablePush(uid) {
  if (!(await pushAvailable())) return { ok: false, reason: 'unsupported' };
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'denied') return { ok: false, reason: 'denied' };
    if (perm !== 'granted') return { ok: false, reason: 'dismissed' };
    const { getMessaging, getToken } = await import(SDK);
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await whenActive(reg);
    const opts = { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: reg };
    let token;
    try {
      token = await getToken(getMessaging(app), opts);
    } catch (first) {
      // One retry after the worker settles; the push service can lag activation.
      console.warn('[push] getToken failed once, retrying', first);
      await whenActive(reg);
      await new Promise((r) => setTimeout(r, 800));
      token = await getToken(getMessaging(app), opts);
    }
    if (!token) return { ok: false, reason: 'error', message: 'no token returned' };
    await setDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) }, { merge: true });
    return { ok: true };
  } catch (e) {
    console.warn('[push] enable failed', e);
    return { ok: false, reason: 'error', message: String((e && e.message) || e) };
  }
}
