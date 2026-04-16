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

export const firebaseConfig = {
  apiKey: "AIzaSyCSZvsExv7O_yjE2UzJ4QQ7lsA4R9zG4_A",
  authDomain: "the-1p-leadership.firebaseapp.com",
  projectId: "the-1p-leadership",
  storageBucket: "the-1p-leadership.firebasestorage.app",
  messagingSenderId: "14602661529",
  appId: "1:14602661529:web:8031e6f7755f757cb45208",
  measurementId: "G-RBH536HRZE"
};

let _app, _auth, _db, _functions;
let _initError = null;

try {
  _app = initializeApp(firebaseConfig);
  _auth = getAuth(_app);
  _db = getFirestore(_app);
  _functions = getFunctions(_app);
  // Persist sessions across tabs/reloads.
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
