// Book-a-call page — embeds Anthony's Zoom Scheduler booking page.
//
// The scheduler URL is read from config/booking (world-readable by rules) so
// it can be swapped without a deploy; the hardcoded default keeps the page
// working before that doc exists or when Firestore is unreachable.

import { db, firebaseReady } from './firebase.js';
import { onAuthReady, currentUser } from './auth.js';
import { renderTopbarEarly } from './topbar.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const DEFAULT_SCHEDULER_URL =
  'https://scheduler.zoom.us/anthony-brown--the-one-percent-3sfu6w/the-1p-nation';

async function schedulerUrl() {
  if (!firebaseReady) return DEFAULT_SCHEDULER_URL;
  try {
    const snap = await getDoc(doc(db, 'config', 'booking'));
    const url = snap.exists() ? snap.data().schedulerUrl : null;
    if (url && /^https:\/\/(scheduler\.)?zoom\.us\//.test(url)) return url;
  } catch (e) { /* fall through to default */ }
  return DEFAULT_SCHEDULER_URL;
}

async function main() {
  try { if (firebaseReady) await onAuthReady(); } catch (e) {}
  renderTopbarEarly({ user: currentUser(), currentPage: null, links: [] });

  const url = await schedulerUrl();
  const frame = document.getElementById('scheduler-frame');
  const fallback = document.getElementById('scheduler-fallback');
  if (frame) {
    const embed = new URL(url);
    embed.searchParams.set('embed', 'true');
    frame.src = embed.toString();
  }
  if (fallback) fallback.href = url;
}

main();
