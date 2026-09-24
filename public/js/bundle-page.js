// Bundle sales page (/bundle.html) — turns the "coming soon" block into a real
// Enroll button once the bundle is live, and routes the click through the
// same createCheckoutSession the course landing page uses.
//
// The bundle is the only way to buy I Can't: The Course, in two formats:
//   bundle-icant        digital book in the library, nothing ships
//   bundle-icant-print  the same plus a shipped paperback (address collected
//                       in Stripe Checkout)
// Both enroll the member in icant and put the book in their library. Someone
// already enrolled sees "Go to course" and "Read the book".

import { loadCourses, getCourseBySlug, priceInfo } from './courses-data.js';
import { onAuthReady, currentUser } from './auth.js';
import { firebaseReady, functions } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { loadEnrollments, isEnrolled } from './enrollments.js';
import { getRefCode } from './referral.js';

const BUNDLE_SLUG = 'bundle-icant';
const PRINT_SLUG = 'bundle-icant-print';
const COURSE_SLUG = 'icant';

// Promo links: /bundle.html?promo=CODE pre-applies the code, so Anthony can
// hand out one URL instead of a code to type. Validated and priced in by
// createCheckoutSession; the client never trusts it.
const PROMO = (new URLSearchParams(location.search).get('promo') || '').trim().toUpperCase() || null;
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

// Offers keyed by slug: { live, label }. Filled in init().
const offers = {};

function selectedSlug() {
  const el = document.querySelector('#format-pick input[name="format"]:checked');
  const slug = el ? el.value : BUNDLE_SLUG;
  return offers[slug] && offers[slug].live ? slug : BUNDLE_SLUG;
}

function selectedLabel() {
  const o = offers[selectedSlug()];
  return (o && o.label) || '$197';
}

function syncFormatPicker() {
  const pick = $('format-pick');
  if (!pick) return;
  pick.querySelectorAll('input[name="format"]').forEach((input) => {
    const o = offers[input.value];
    const priceEl = pick.querySelector(`[data-price-for="${input.value}"]`);
    if (priceEl && o && o.label) priceEl.textContent = o.label;
    // An option that isn't on sale yet is hidden, not shown disabled.
    const label = input.closest('.format-opt');
    if (label) label.hidden = input.value !== BUNDLE_SLUG && !(o && o.live);
  });
  // With a single option there is nothing to choose.
  const visible = [...pick.querySelectorAll('.format-opt')].filter((l) => !l.hidden);
  pick.hidden = visible.length < 2;
}

function renderCta({ live, enrolled }) {
  const top = $('bundle-cta');
  const bottom = $('bundle-cta-bottom');
  if (!top) return;
  const pick = $('format-pick');

  if (enrolled) {
    if (pick) pick.hidden = true;
    top.innerHTML = `<a class="btn-enroll" href="${COURSE_URL}">Go to the course →</a>
      <a class="btn-book" href="/library" style="margin-top:10px;">Read the book →</a>`;
    if (bottom) bottom.outerHTML = `<a class="btn-primary-lg" id="bundle-cta-bottom" href="${COURSE_URL}">Go to the course →</a>`;
    return;
  }
  if (!live) { if (pick) pick.hidden = true; return; } // keep the "coming soon" block from the markup
  syncFormatPicker();
  const label = selectedLabel();

  const promoNote = PROMO
    ? `<div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--red);text-align:center;margin-bottom:10px;">Promo ${PROMO} will be applied at checkout</div>`
    : '';
  top.innerHTML = `${promoNote}<button class="btn-enroll" id="bundle-enroll" type="button">Enroll now — ${label}</button>`;
  if (bottom) bottom.outerHTML = `<button class="btn-primary-lg" id="bundle-cta-bottom" type="button">Enroll now — ${label}</button>`;

  const buttons = [$('bundle-enroll'), $('bundle-cta-bottom')].filter(Boolean);
  buttons.forEach((btn) => btn.addEventListener('click', () => startCheckout(buttons)));
  if (pick) {
    pick.onchange = () => {
      const l = selectedLabel();
      buttons.forEach((b) => { if (!b.disabled) b.textContent = `Enroll now — ${l}`; });
    };
  }
}

async function startCheckout(buttons) {
  const label = selectedLabel();
  if (firebaseReady && !currentUser()) { requireLogin(); return; }
  msg('');
  buttons.forEach((b) => { b.disabled = true; b.textContent = 'Opening secure checkout…'; });
  try {
    const res = await httpsCallable(functions, 'createCheckoutSession')({
      slug: selectedSlug(),
      refCode: getRefCode() || undefined,
      couponCode: PROMO || undefined
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

  [BUNDLE_SLUG, PRINT_SLUG].forEach((slug) => {
    const c = getCourseBySlug(slug);
    const p = c ? priceInfo(c) : null;
    offers[slug] = { live: !!c && c.status === 'live', label: (p && p.label) || null };
  });
  const live = offers[BUNDLE_SLUG].live;
  const enrolled = !!user && [COURSE_SLUG, BUNDLE_SLUG, PRINT_SLUG].some(isEnrolled);
  renderCta({ live, enrolled });
}

init();
