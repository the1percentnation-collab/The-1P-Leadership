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
import { doc, setDoc, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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
    rememberToken(token);
    return { ok: true };
  } catch (e) {
    console.warn('[push] enable failed', e);
    return { ok: false, reason: 'error', message: String((e && e.message) || e) };
  }
}

// This device's token, remembered so checking status never calls getToken:
// with permission granted and no token, getToken mints a new subscription.
// 'off' marks a device the member switched off here.
const TOKEN_KEY = 'fcmTokenHere';
function rememberToken(v) {
  try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { /* private mode */ }
}
function rememberedToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}

/**
 * This device's token, without prompting. Devices that turned push on before
 * the token was remembered still have their registration, and getToken
 * returns the existing token for it rather than minting one.
 */
async function currentToken() {
  if (!(await pushAvailable()) || Notification.permission !== 'granted') return null;
  const saved = rememberedToken();
  if (saved === 'off') return null;
  if (saved) return saved;
  const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
  if (!reg) return null;
  await whenActive(reg);
  const { getMessaging, getToken } = await import(SDK);
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: reg });
  if (token) rememberToken(token);
  return token || null;
}

/**
 * Is push on for THIS device? True when the browser allows it and this
 * device's token is among the member's saved tokens (`fcmTokens` from their
 * user doc). Never prompts.
 */
export async function pushEnabledHere(fcmTokens) {
  try {
    const token = await currentToken();
    return !!token && Array.isArray(fcmTokens) && fcmTokens.includes(token);
  } catch (e) {
    return false;
  }
}

/** Stop push to this device: drop its token server-side and in the browser. */
export async function disablePush(uid) {
  try {
    const token = await currentToken();
    if (!token) return { ok: true };
    await setDoc(doc(db, 'users', uid), { fcmTokens: arrayRemove(token) }, { merge: true });
    rememberToken('off');
    const { getMessaging, deleteToken } = await import(SDK);
    try { await deleteToken(getMessaging(app)); } catch (e) { /* server copy is already gone */ }
    return { ok: true };
  } catch (e) {
    console.warn('[push] disable failed', e);
    return { ok: false, reason: 'error', message: String((e && e.message) || e) };
  }
}

/** Member-facing copy for each enablePush failure reason. */
export const PUSH_ERRORS = {
  denied: 'Notifications are blocked for this site. Allow them in your browser settings, then try again.',
  dismissed: 'No problem. You can turn notifications on any time from your profile.',
  unsupported: 'Push isn\'t available in this browser.',
  error: 'Couldn\'t turn on notifications just now. Try again.'
};
