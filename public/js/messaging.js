// Firebase Cloud Messaging helper.
//
// Provides a single async function — `requestNotificationToken()` — that:
//   1. Checks the browser supports Notifications + Service Workers
//   2. Asks the user for permission (no-op if already granted/denied)
//   3. Registers `/firebase-messaging-sw.js`
//   4. Calls FCM `getToken()` with the project's VAPID key
//   5. Returns the token string, or null if push isn't available
//
// The VAPID key below is the project's public web-push key (safe to ship).
// Set it once in Firebase Console → Project Settings → Cloud Messaging →
// Web configuration → "Generate key pair", then paste the value here.
//
// If the key is left empty, push silently degrades and the caller falls back
// to email-only notifications.
//
// Tokens are returned to the caller; persistence (writing to Firestore under
// `users/{uid}.fcmTokens`) is the caller's responsibility so that the same
// helper can be reused across pages without forcing a write each time.

import { app, firebaseReady } from './firebase.js';

// Public VAPID key for web push. Empty = push disabled (email-only fallback).
export const VAPID_PUBLIC_KEY = '';

let _messagingPromise = null;
let _swRegistrationPromise = null;

function isSupportedEnvironment() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && typeof window.PushManager !== 'undefined';
}

async function loadMessaging() {
  if (_messagingPromise) return _messagingPromise;
  _messagingPromise = (async () => {
    const mod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');
    if (typeof mod.isSupported === 'function') {
      const ok = await mod.isSupported();
      if (!ok) return null;
    }
    return { mod, messaging: mod.getMessaging(app) };
  })();
  return _messagingPromise;
}

async function registerServiceWorker() {
  if (_swRegistrationPromise) return _swRegistrationPromise;
  _swRegistrationPromise = navigator.serviceWorker.register('/firebase-messaging-sw.js', {
    scope: '/'
  });
  return _swRegistrationPromise;
}

/**
 * Asks the user for notification permission and returns an FCM token.
 * Returns null if push is unsupported, the user denied, or the VAPID key
 * isn't configured. Never throws — callers can still subscribe by email.
 */
export async function requestNotificationToken() {
  if (!firebaseReady || !app) return null;
  if (!isSupportedEnvironment()) return null;
  if (!VAPID_PUBLIC_KEY) return null;

  let permission = Notification.permission;
  if (permission === 'default') {
    try { permission = await Notification.requestPermission(); }
    catch (e) { return null; }
  }
  if (permission !== 'granted') return null;

  let registration;
  try { registration = await registerServiceWorker(); }
  catch (e) {
    console.warn('[messaging] service worker registration failed', e);
    return null;
  }

  let bundle;
  try { bundle = await loadMessaging(); }
  catch (e) {
    console.warn('[messaging] FCM SDK load failed', e);
    return null;
  }
  if (!bundle) return null;

  try {
    const token = await bundle.mod.getToken(bundle.messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration
    });
    return token || null;
  } catch (e) {
    console.warn('[messaging] getToken failed', e);
    return null;
  }
}

/**
 * Foreground listener — wires `onMessage` so that when a push lands while the
 * tab is open, we surface a Notification (the SW only handles background
 * pushes). Safe to call multiple times; later calls replace the handler.
 */
export async function startForegroundMessages() {
  const bundle = await loadMessaging().catch(() => null);
  if (!bundle) return;
  try {
    bundle.mod.onMessage(bundle.messaging, (payload) => {
      const n = (payload && payload.notification) || {};
      const title = n.title || '1P Leadership';
      const body = n.body || '';
      const data = (payload && payload.data) || {};
      try {
        new Notification(title, {
          body,
          icon: n.icon || '/assets/icon-192.png',
          data
        });
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
}
