// Public certificate verification. Reads certificateVerifications/{code} — a
// world-readable lookup written by the onCertificateProgress Cloud Function —
// and confirms the holder's name, course, and issue date. No auth required.

import { db, firebaseReady } from './firebase.js';
import {
  doc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const msg = $('msg');

function showErr(txt) { msg.innerHTML = `<div class="auth-error">${txt}</div>`; }

function fmtDate(ts) {
  try {
    const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) { return '—'; }
}

const params = new URLSearchParams(location.search);
const code = (params.get('cert') || '').trim();

if (!code) {
  $('sub').textContent = 'No certificate code was provided.';
  showErr('The link you followed is missing ?cert=CODE.');
} else if (!firebaseReady) {
  $('sub').textContent = 'Verification service is unreachable.';
  showErr('Could not reach the verification service. Check your connection and retry.');
} else {
  (async () => {
    try {
      const snap = await getDoc(doc(db, 'certificateVerifications', code));
      if (!snap.exists() || snap.data().valid === false) {
        $('sub').textContent = 'We could not verify this certificate.';
        showErr('No valid certificate matches this code. It may be mistyped or revoked.');
        return;
      }
      const c = snap.data();
      $('r-name').textContent = c.displayName || 'Learner';
      $('r-course').textContent = c.courseTitle || c.slug || 'Course';
      $('r-date').textContent = fmtDate(c.issuedAt);
      $('r-id').textContent = code;
      $('sub').textContent = 'This certificate is authentic.';
      $('result').style.display = 'block';
    } catch (e) {
      console.warn('[verify] lookup failed', e);
      $('sub').textContent = 'Verification failed.';
      showErr('Something went wrong while verifying. Please try again.');
    }
  })();
}
