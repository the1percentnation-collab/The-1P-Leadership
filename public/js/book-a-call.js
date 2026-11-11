// Book-a-call page — embeds Anthony's Zoom Scheduler booking page.
//
// The scheduler URL is read from config/booking (world-readable by rules) so
// it can be swapped without a deploy; the hardcoded default keeps the page
// working before that doc exists or when Firestore is unreachable.
//
// /book-a-call?for=team is where Join the Team applicants land (the /join
// confirmation and the reply email). It uses config/booking
// recruitingSchedulerUrl when set, so recruiting conversations can be their
// own Zoom event type; otherwise it falls back to schedulerUrl.

import { db, firebaseReady } from './firebase.js';
import { onAuthReady, currentUser } from './auth.js';
import { renderTopbarEarly } from './topbar.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const DEFAULT_SCHEDULER_URL =
  'https://scheduler.zoom.us/anthony-brown--the-one-percent-3sfu6w/the-1p-nation';

const FOR_TEAM = new URLSearchParams(location.search).get('for') === 'team';
const isZoom = (u) => typeof u === 'string' && /^https:\/\/(scheduler\.)?zoom\.us\//.test(u);

async function schedulerUrl() {
  if (!firebaseReady) return DEFAULT_SCHEDULER_URL;
  try {
    const snap = await getDoc(doc(db, 'config', 'booking'));
    const data = snap.exists() ? snap.data() : {};
    if (FOR_TEAM && isZoom(data.recruitingSchedulerUrl)) return data.recruitingSchedulerUrl;
    if (isZoom(data.schedulerUrl)) return data.schedulerUrl;
  } catch (e) { /* fall through to default */ }
  return DEFAULT_SCHEDULER_URL;
}

async function main() {
  if (FOR_TEAM) {
    document.title = 'Pick a Time to Talk | Join the Team';
    document.getElementById('bac-title').textContent = 'Pick a Time to Talk';
    document.getElementById('bac-sub').textContent = 'A short conversation about the role: the work, the standard, and how getting started works. It happens on Zoom, and the link lands in your inbox the moment you book.';
  }
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
