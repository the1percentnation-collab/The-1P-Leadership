// Bundle sales page (/bundle.html) — turns the "coming soon" block into a real
// Enroll button once the bundle is live, and routes the click through the
// same createCheckoutSession the course landing page uses.
//
// The bundle (bundle-icant) is the only way to buy I Can't: The Course. Buying
// it enrolls the member in icant and ships the paperback (the address is
// collected in Stripe Checkout). Someone already enrolled sees "Go to course".

import { loadCourses, getCourseBySlug, priceInfo } from './courses-data.js';
import { onAuthReady, currentUser } from './auth.js';
import { firebaseReady, functions } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { loadEnrollments, isEnrolled } from './enrollments.js';
import { getRefCode } from './referral.js';

const BUNDLE_SLUG = 'bundle-icant';
const COURSE_SLUG = 'icant';
const COURSE_URL = `/courses.html?course=${encodeURIComponent(COURSE_SLUG)}`;

const $ = (id) => document.getElementById(id);

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

function msg(text) {
  const el = $('bundle-cta-msg');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

function requireLogin() {
  location.assign('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
}

function renderCta({ live, enrolled, label }) {
  const top = $('bundle-cta');
  const bottom = $('bundle-cta-bottom');
  if (!top) return;

  if (enrolled) {
    top.innerHTML = `<a class="btn-enroll" href="${COURSE_URL}">Go to the course →</a>`;
    if (bottom) bottom.outerHTML = `<a class="btn-primary-lg" id="bundle-cta-bottom" href="${COURSE_URL}">Go to the course →</a>`;
    return;
  }
  if (!live) return; // keep the "coming soon" block from the markup

  top.innerHTML = `<button class="btn-enroll" id="bundle-enroll" type="button">Enroll now — ${label}</button>`;
  if (bottom) bottom.outerHTML = `<button class="btn-primary-lg" id="bundle-cta-bottom" type="button">Enroll now — ${label}</button>`;

  const buttons = [$('bundle-enroll'), $('bundle-cta-bottom')].filter(Boolean);
  buttons.forEach((btn) => btn.addEventListener('click', () => startCheckout(buttons, label)));
}

async function startCheckout(buttons, label) {
  if (firebaseReady && !currentUser()) { requireLogin(); return; }
  msg('');
  buttons.forEach((b) => { b.disabled = true; b.textContent = 'Opening secure checkout…'; });
  try {
    const res = await httpsCallable(functions, 'createCheckoutSession')({
      slug: BUNDLE_SLUG,
      refCode: getRefCode() || undefined
    });
    const data = res && res.data;
    if (data && data.enrolled) { location.assign(COURSE_URL); return; }
    if (!data || !data.url) throw new Error('Checkout could not be started.');
    location.assign(data.url);
  } catch (err) {
    console.warn('[bundle-page] checkout failed', err);
    buttons.forEach((b) => { b.disabled = false; b.textContent = `Enroll now — ${label}`; });
    msg(err && err.message ? err.message : 'Could not start checkout. Please try again.');
  }
}

async function init() {
  let user = null;
  if (firebaseReady) {
    try { user = await withTimeout(onAuthReady(), 4000); } catch (e) {}
  }
  try { await withTimeout(loadCourses(), 5000); } catch (e) {}
  try { if (user) await withTimeout(loadEnrollments(), 4000); } catch (e) {}

  const bundle = getCourseBySlug(BUNDLE_SLUG);
  const live = !!bundle && bundle.status === 'live';
  const enrolled = !!user && (isEnrolled(COURSE_SLUG) || isEnrolled(BUNDLE_SLUG));
  const p = bundle ? priceInfo(bundle) : null;
  renderCta({ live, enrolled, label: (p && p.label) || '$197' });
}

init();
