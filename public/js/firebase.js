// Firebase initialization — CDN modular imports (no bundler).
// All keys here are public per Firebase web SDK guidance; security comes from Firestore rules.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js';

export const firebaseConfig = {
  apiKey: "AIzaSyCSZvsExv7O_yjE2UzJ4QQ7lsA4R9zG4_A",
  authDomain: "the-1p-leadership.firebaseapp.com",
  projectId: "the-1p-leadership",
  storageBucket: "the-1p-leadership.firebasestorage.app",
  messagingSenderId: "14602661529",
  appId: "1:14602661529:web:8031e6f7755f757cb45208",
  measurementId: "G-RBH536HRZE"
};

// ── Firebase App Check (bot / abuse protection) ─────────────────────────────
// App Check attests that calls come from THIS web app (not a script hitting the
// API directly). To turn it on:
//   1. Firebase Console > App Check > register this web app with the
//      reCAPTCHA v3 provider; copy the site key.
//   2. Paste the site key below (RECAPTCHA_V3_SITE_KEY).
//   3. Optionally set `enforceAppCheck: true` on sensitive callables in
//      functions/index.js once you've confirmed tokens are flowing.
// Leaving the key blank makes App Check a no-op, so nothing breaks before it's
// configured. See AUTH_SETUP.md.
const RECAPTCHA_V3_SITE_KEY = ""; // <-- paste your reCAPTCHA v3 site key here

let _app, _auth, _db, _functions, _appCheck;
let _initError = null;

try {
  _app = initializeApp(firebaseConfig);

  // Initialize App Check before other services if a site key is configured.
  if (RECAPTCHA_V3_SITE_KEY) {
    try {
      _appCheck = initializeAppCheck(_app, {
        provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
        isTokenAutoRefreshEnabled: true
      });
    } catch (acErr) {
      console.warn('[firebase] App Check init failed (continuing without it):', acErr);
    }
  }

  _auth = getAuth(_app);
  _db = getFirestore(_app);
  _functions = getFunctions(_app);
  // Persist sessions across tabs/reloads.
  setPersistence(_auth, browserLocalPersistence).catch(() => {});
} catch (err) {
  _initError = err;
  console.error('[firebase] init failed:', err);
}

export const appCheck = _appCheck;

export const app = _app;
export const auth = _auth;
export const db = _db;
export const functions = _functions;
export const initError = _initError;

// Convenience flag: did Firebase initialize well enough to try remote calls?
export const firebaseReady = !!(_app && _auth && _db);
