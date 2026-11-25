// Free consultation page: the visitor picks a consultation type and that
// type's Zoom Scheduler calendar loads inline in the panel below.
//
// Each type has its own Zoom Scheduler booking page. The URLs live on
// config/booking (world-readable by rules) under `consultations`, e.g.
//   consultations: {
//     strategy:  'https://scheduler.zoom.us/<you>/<schedule>',
//     insurance: 'https://scheduler.zoom.us/<you>/<schedule>',
//     career:    'https://scheduler.zoom.us/<you>/<schedule>'
//   }
// so a schedule can be swapped without a deploy. Until a type has its own
// URL it falls back to the DEFAULTS below, and failing those to the general
// Book a Call scheduler, so the page always shows a working calendar.

import { db, firebaseReady } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const GENERAL_SCHEDULER_URL =
  'https://scheduler.zoom.us/anthony-brown--the-one-percent-3sfu6w/the-1p-nation';

// Fill these in once the dedicated Zoom schedules exist (or set them on
// config/booking.consultations instead).
const DEFAULTS = {
  strategy: '',
  insurance: '',
  career: '',
};

const NAMES = {
  strategy: 'Financial Strategy Session',
  insurance: 'Life Insurance Review',
  career: 'Join the Team',
};

const ZOOM_URL = /^https:\/\/(scheduler\.)?zoom\.us\//;

async function loadUrls() {
  const urls = { ...DEFAULTS };
  if (firebaseReady) {
    try {
      const snap = await getDoc(doc(db, 'config', 'booking'));
      const map = snap.exists() ? (snap.data().consultations || {}) : {};
      for (const key of Object.keys(NAMES)) {
        if (typeof map[key] === 'string' && ZOOM_URL.test(map[key])) urls[key] = map[key];
      }
    } catch (e) { /* fall through to defaults */ }
  }
  for (const key of Object.keys(NAMES)) {
    if (!urls[key] || !ZOOM_URL.test(urls[key])) urls[key] = GENERAL_SCHEDULER_URL;
  }
  return urls;
}

function embedUrl(url) {
  const u = new URL(url);
  u.searchParams.set('embed', 'true');
  return u.toString();
}

async function main() {
  const tabs = Array.from(document.querySelectorAll('.fc-type'));
  const panel = document.getElementById('fc-panel');
  const frame = document.getElementById('fc-frame');
  const fallback = document.getElementById('fc-fallback');
  const nowName = document.getElementById('fc-now-name');
  if (!tabs.length || !frame) return;

  const urls = await loadUrls();
  let current = null;

  function select(key, { focus = false, scroll = false } = {}) {
    if (!NAMES[key]) key = 'strategy';
    tabs.forEach((t) => {
      const on = t.dataset.type === key;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      const pick = t.querySelector('.fc-pick');
      if (pick) pick.textContent = on ? 'Selected' : 'Choose this';
      if (on) {
        panel.setAttribute('aria-labelledby', t.id);
        if (focus) t.focus();
      }
    });
    nowName.textContent = NAMES[key];
    frame.title = `Book a ${NAMES[key]}`;
    fallback.href = urls[key];
    const next = embedUrl(urls[key]);
    if (frame.src !== next) frame.src = next;
    if (current !== key) {
      current = key;
      try { history.replaceState(null, '', `?type=${key}${location.hash}`); } catch (e) {}
      try { if (window.gtag) window.gtag('event', 'consultation_type_select', { consultation_type: key }); } catch (e) {}
    }
    if (scroll) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t.dataset.type, { scroll: window.innerWidth <= 900 }));
    t.addEventListener('keydown', (e) => {
      let j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      select(tabs[j].dataset.type, { focus: true });
    });
  });

  // ?type=insurance (or #insurance) preselects a type, so posts and emails can
  // link straight to one calendar.
  const params = new URLSearchParams(location.search);
  const wanted = params.get('type') || location.hash.replace('#', '');
  select(NAMES[wanted] ? wanted : 'strategy');
}

main();
