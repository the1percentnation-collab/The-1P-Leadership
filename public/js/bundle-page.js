// The I Can't sales page (/bundle.html) — turns the "coming soon" block into a
// real Enroll button once the course is live, and routes the click through the
// same createCheckoutSession the course landing page uses.
//
// This page used to sell `bundle-icant`, a separate record. The bundle and the
// course became the same offer at the same price, so the record was retired
// (sellable: false, checkout refuses the slug) and this page sells `icant`
// directly. Everything on it — price, liveness, the paperback add-on — is
// read from that one course record, so the page can't advertise terms
// checkout won't honor.
//
// The purchase includes the digital edition of the book. The paperback is an
// optional add-on for the cost of shipping — ticking it collects a US address
// in Stripe Checkout and puts the book order in the store console. Someone
// already enrolled sees "Go to course".

import { loadCourses, getCourseBySlug, priceInfo } from './courses-data.js';
import { onAuthReady, currentUser } from './auth.js';
import { firebaseReady, functions } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { loadEnrollments, isEnrolled } from './enrollments.js';
import { getRefCode } from './referral.js';

const COURSE_SLUG = 'icant';
// The retired record. Still checked for enrollment: members who bought the
// bundle before it was retired own the course through it.
const LEGACY_BUNDLE_SLUG = 'bundle-icant';
// Display only. createCheckoutSession prices the add-on from
// courses/{slug}.paperbackShipping and re-validates the whole request.
const PAPERBACK_SHIPPING_FALLBACK = 9.95;

function fmtMoney(n) {
  return '$' + (Number.isInteger(n) ? n : Number(n).toFixed(2));
}

function paperbackOffer(course) {
  return !!course && course.paperbackUpgrade === true && course.shipsBook !== true;
}

function paperbackShipping(course) {
  return (course && typeof course.paperbackShipping === 'number' && course.paperbackShipping > 0)
    ? course.paperbackShipping
    : PAPERBACK_SHIPPING_FALLBACK;
}

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

// The paperback tick box, above the top Enroll button. Rendered only when the
// course actually offers the add-on, so the copy on the page and what checkout
// does can never disagree.
function addonHtml(course) {
  if (!paperbackOffer(course)) return '';
  return `
    <label class="bundle-addon" for="bundle-paperback">
      <input type="checkbox" id="bundle-paperback">
      <span>
        <b>Add the paperback — ${fmtMoney(paperbackShipping(course))} shipping only.</b>
        The printed copy mailed to you. The book is free; you cover shipping.
        US addresses, collected at checkout.
      </span>
    </label>`;
}

function renderCta({ live, enrolled, label, course }) {
  const top = $('bundle-cta');
  const bottom = $('bundle-cta-bottom');
  if (!top) return;

  if (enrolled) {
    top.innerHTML = `<a class="btn-enroll" href="${COURSE_URL}">Go to the course →</a>`;
    if (bottom) bottom.outerHTML = `<a class="btn-primary-lg" id="bundle-cta-bottom" href="${COURSE_URL}">Go to the course →</a>`;
    return;
  }
  if (!live) return; // keep the "coming soon" block from the markup

  const promoNote = PROMO
    ? `<div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold);text-align:center;margin-bottom:10px;">Promo ${PROMO} will be applied at checkout</div>`
    : '';
  top.innerHTML = `${promoNote}${addonHtml(course)}<button class="btn-enroll" id="bundle-enroll" type="button">Enroll now — ${label}</button>`;
  if (bottom) bottom.outerHTML = `<button class="btn-primary-lg" id="bundle-cta-bottom" type="button">Enroll now — ${label}</button>`;

  const buttons = [$('bundle-enroll'), $('bundle-cta-bottom')].filter(Boolean);
  buttons.forEach((btn) => btn.addEventListener('click', () => startCheckout(buttons, label)));
}

async function startCheckout(buttons, label) {
  if (firebaseReady && !currentUser()) { requireLogin(); return; }
  msg('');
  buttons.forEach((b) => { b.disabled = true; b.textContent = 'Opening secure checkout…'; });
  try {
    const box = $('bundle-paperback');
    const res = await httpsCallable(functions, 'createCheckoutSession')({
      slug: COURSE_SLUG,
      addPaperback: (box && box.checked) || undefined,
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

  const course = getCourseBySlug(COURSE_SLUG);
  const live = !!course && course.status === 'live';
  const enrolled = !!user && (isEnrolled(COURSE_SLUG) || isEnrolled(LEGACY_BUNDLE_SLUG));
  const p = course ? priceInfo(course) : null;
  renderCta({ live, enrolled, label: (p && p.label) || '$197', course });
}

init();
