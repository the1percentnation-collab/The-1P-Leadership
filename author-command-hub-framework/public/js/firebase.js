// ── Firebase bootstrap ──────────────────────────────────────────────────────
// CDN modular imports — no bundler, no build step. Drop these files on any
// static host (Firebase Hosting, Netlify, a plain S3 bucket) and they run.
//
// All keys below are PUBLIC per Firebase web-SDK guidance; real security comes
// from Firestore rules (see ../firestore.rules), NOT from hiding these values.
//
// TO REUSE: create a Firebase project → Project settings → "Your apps" → Web,
// copy its config object over `firebaseConfig` below, and enable
// Authentication (Email/Password + Google) and Firestore in the console.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

let _app, _auth, _db, _functions;
let _initError = null;

try {
  _app = initializeApp(firebaseConfig);
  _auth = getAuth(_app);
  _db = getFirestore(_app);
  _functions = getFunctions(_app);
  // Keep the session across tabs and reloads.
  setPersistence(_auth, browserLocalPersistence).catch(() => {});
} catch (err) {
  _initError = err;
  console.error('[firebase] init failed:', err);
}

export const app = _app;
export const auth = _auth;
export const db = _db;
export const functions = _functions;
export const initError = _initError;

// Convenience flag: did Firebase initialize well enough to try remote calls?
export const firebaseReady = !!(_app && _auth && _db);
