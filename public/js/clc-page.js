// /clc: the 1P Certified Life Coach sales page.
//
// The page ships with the full offer in static markup. This module only makes
// the live parts live: it merges the built-in registry entry for 1p-clc with
// courses/1p-clc in Firestore (Firestore wins), fills the cohort facts, and
// turns every CTA into the right button for the visitor:
//
//   already enrolled  -> "Go to the course"  (same URL course-landing.js uses)
//   status !== live   -> "Notify me when enrollment opens" (registerCourseInterest)
//   status === live   -> "Enroll" (createCheckoutSession)
//
// Nothing here throws on missing data. If Firebase never initialized, the CTAs
// fall back to a mailto message the way corporate.js does.

import { COURSES } from './courses-registry.js';
import { firebaseReady, functions, db } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { onAuthReady, currentUser } from './auth.js';
import { loadEnrollments, isEnrolled } from './enrollments.js';
import { getRefCode } from './referral.js';

const SLUG = '1p-clc';
const COURSE_URL = `/courses.html?course=${encodeURIComponent(SLUG)}`;
const CONTACT_EMAIL = 'anthonybrown@the1pnation.com';

// ?promo=CODE pre-applies a code, so one URL can be handed out instead of a
// code to type. createCheckoutSession re-validates it; the client never trusts
// this value.
const PROMO_FROM_URL = (new URLSearchParams(location.search).get('promo') || '')
  .trim().toUpperCase() || null;

let appliedPromo = PROMO_FROM_URL;

const $ = (id) => document.getElementById(id);

const CTA_IDS = ['clc-cta-hero', 'clc-cta-pricing', 'clc-cta-bottom'];

function ctaButtons() {
  return CTA_IDS.map($).filter(Boolean);
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

function setMsg(text, isError) {
  ['clc-cta-msg', 'clc-cta-msg-bottom'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('err', !!isError && !!text);
  });
}

function requireLoginRedirect() {
  location.assign('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
}

function selectedPlan() {
  const checked = document.querySelector('input[name="clc-plan"]:checked');
  const value = checked && checked.value ? checked.value : '';
  return value || null;
}

// ─── Cohort facts ─────────────────────────────────────────────────────────

// Firestore Timestamps, Dates and ISO strings all land here. Anything we
// cannot read becomes null and the fact is dropped rather than shown as TBD.
function toDate(value) {
  try {
    if (!value) return null;
    if (typeof value.toDate === 'function') {
      const d = value.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    }
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === 'object' && typeof value.seconds === 'number') {
      const d = new Date(value.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
  } catch (e) { /* fall through */ }
  return null;
}

function fmtDate(value) {
  const d = toDate(value);
  if (!d) return null;
  try {
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  } catch (e) {
    return null;
  }
}

// "TBD" placeholders in the seed are the same as missing: never render them.
function cleanText(value) {
  const s = (value == null ? '' : String(value)).trim();
  if (!s) return null;
  if (/^(tbd|tba|n\/a|none)$/i.test(s)) return null;
  return s;
}

function renderCohortFacts(cohort, seatsTaken) {
  const el = $('clc-cohort-facts');
  if (!el) return;
  const facts = [];

  const closes = fmtDate(cohort.enrollCloseAt);
  if (closes) facts.push(`Enrollment closes <strong>${escapeHtml(closes)}</strong>`);

  const starts = fmtDate(cohort.startAt);
  if (starts) facts.push(`Module 1 drops <strong>${escapeHtml(starts)}</strong>`);

  const day = cleanText(cohort.callDay);
  const time = cleanText(cohort.callTime);
  if (day && time) facts.push(`Live call <strong>${escapeHtml(day)} at ${escapeHtml(time)}</strong>`);
  else if (day) facts.push(`Live call <strong>${escapeHtml(day)}</strong>`);

  const capacity = typeof cohort.capacity === 'number' ? cohort.capacity : null;
  if (capacity && typeof seatsTaken === 'number') {
    const taken = Math.max(0, Math.min(capacity, seatsTaken));
    facts.push(`<strong>${taken} of ${capacity}</strong> founding seats claimed`);
  }

  if (!facts.length) { el.hidden = true; return; }
  el.innerHTML = facts.map((f) => `<span class="fact">${f}</span>`).join('');
  el.hidden = false;
}

function renderSeatsNote(capacity, seatsTaken) {
  const el = $('clc-seats-note');
  if (!el) return;
  if (typeof capacity !== 'number' || typeof seatsTaken !== 'number') { el.hidden = true; return; }
  const remaining = Math.max(0, capacity - seatsTaken);
  el.textContent = remaining === 0
    ? 'All 20 founding seats are claimed.'
    : `${remaining} of ${capacity} founding seats remaining.`;
  el.hidden = false;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Coupon docs are commonly admin-read-only. A denied read is expected, not an
// error: the seat count simply does not render.
async function readFoundingRedemptions() {
  if (!firebaseReady || !db) return null;
  try {
    const snap = await withTimeout(getDoc(doc(db, 'coupons', 'FOUNDING')), 4000);
    if (!snap || !snap.exists()) return null;
    const data = snap.data() || {};
    return typeof data.redemptions === 'number' ? data.redemptions : null;
  } catch (e) {
    return null;
  }
}

// ─── CTA rendering ────────────────────────────────────────────────────────

function fmtPrice(dollars) {
  if (typeof dollars !== 'number' || !isFinite(dollars)) return null;
  return '$' + dollars.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function setCtaLabel(text) {
  ctaButtons().forEach((btn) => { btn.textContent = text; });
}

function setCtaDisabled(disabled) {
  ctaButtons().forEach((btn) => { btn.disabled = !!disabled; });
}

function replaceCtasWithLink(label, href) {
  CTA_IDS.forEach((id) => {
    const btn = $(id);
    if (!btn) return;
    const a = document.createElement('a');
    a.className = btn.className;
    a.id = id;
    a.href = href;
    a.textContent = label;
    if (id === 'clc-cta-pricing') a.style.width = '100%';
    btn.replaceWith(a);
  });
}

function bindCtas(handler) {
  ctaButtons().forEach((btn) => btn.addEventListener('click', handler));
}

// ─── Waitlist (course is not live yet) ────────────────────────────────────

function bindNotify(course) {
  setCtaLabel('Notify me when enrollment opens');
  setCtaDisabled(false);
  bindCtas(async () => {
    if (!firebaseReady) {
      setMsg(`The waitlist is unavailable right now. Email ${CONTACT_EMAIL} and we will add you directly.`, true);
      return;
    }
    if (!currentUser()) { requireLoginRedirect(); return; }
    setCtaDisabled(true);
    setCtaLabel('Adding you…');
    setMsg('');
    try {
      await httpsCallable(functions, 'registerCourseInterest')({ slug: SLUG, title: course.title });
      setCtaLabel('✓ You are on the list');
    } catch (err) {
      console.warn('[clc-page] notify failed', err);
      setCtaDisabled(false);
      setCtaLabel('Notify me when enrollment opens');
      setMsg((err && err.message) || 'Could not add you to the waitlist. Please try again.', true);
    }
  });
}

// ─── Checkout (course is live) ────────────────────────────────────────────

function bindEnroll(label) {
  setCtaLabel(label);
  setCtaDisabled(false);
  bindCtas(async () => {
    if (!firebaseReady) {
      setMsg(`Checkout is unavailable right now. Email ${CONTACT_EMAIL} and we will enroll you directly.`, true);
      return;
    }
    if (!currentUser()) { requireLoginRedirect(); return; }
    const plan = selectedPlan();
    setCtaDisabled(true);
    setCtaLabel('Opening secure checkout…');
    setMsg('');
    try {
      const res = await httpsCallable(functions, 'createCheckoutSession')({
        slug: SLUG,
        plan: plan || undefined,
        refCode: getRefCode() || undefined,
        // A plan and a promo code cannot be combined; the callable enforces
        // this too, so send only one.
        couponCode: plan ? undefined : (appliedPromo || undefined)
      });
      const data = res && res.data;
      if (data && data.enrolled) { location.assign(COURSE_URL); return; }
      if (!data || !data.url) throw new Error('Checkout could not be started.');
      location.assign(data.url);
    } catch (err) {
      console.warn('[clc-page] checkout failed', err);
      setCtaDisabled(false);
      setCtaLabel(label);
      setMsg((err && err.message) || 'Could not start checkout. Please try again.', true);
    }
  });
}

function foundingMsg(text) {
  const el = $('clc-founding-msg');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

// The FOUNDING button is the same thing as arriving on ?promo=FOUNDING: it
// stages the code for checkout. Pricing happens server-side.
function bindFoundingButton(live) {
  const btn = $('clc-founding-apply');
  if (!btn) return;
  const apply = () => {
    appliedPromo = 'FOUNDING';
    const payInFull = document.querySelector('input[name="clc-plan"][value=""]');
    if (payInFull) payInFull.checked = true;
    btn.disabled = true;
    btn.textContent = '✓ FOUNDING applied';
    foundingMsg(live
      ? 'FOUNDING will be applied at checkout. Pay in full is selected, since a code cannot be combined with a payment plan.'
      : 'FOUNDING is saved for when enrollment opens.');
  };
  btn.addEventListener('click', apply);
  if (appliedPromo === 'FOUNDING') apply();
  else if (appliedPromo) foundingMsg(`Promo ${appliedPromo} will be applied at checkout.`);
}

// A plan and a code are mutually exclusive. Say so at the moment of choosing
// instead of at the checkout error.
function bindPlanNotice() {
  document.querySelectorAll('input[name="clc-plan"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!appliedPromo) return;
      if (input.checked && input.value) {
        foundingMsg(`Promo codes cannot be combined with a payment plan. ${appliedPromo} will not be applied to installments.`);
      } else if (input.checked) {
        foundingMsg(`Promo ${appliedPromo} will be applied at checkout.`);
      }
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const registry = COURSES.find((c) => c.slug === SLUG) || { slug: SLUG, title: '1P Certified Life Coach' };

  let user = null;
  if (firebaseReady) {
    try { user = await withTimeout(onAuthReady(), 4000); } catch (e) {}
  }

  // Firestore wins over the registry for everything it defines.
  let remote = null;
  if (firebaseReady && db) {
    try {
      const snap = await withTimeout(getDoc(doc(db, 'courses', SLUG)), 5000);
      if (snap && snap.exists()) remote = snap.data() || null;
    } catch (e) {
      console.warn('[clc-page] course read failed', e);
    }
  }

  const course = Object.assign({}, registry, remote || {});
  const cohort = (course && course.cohort) || {};

  // Eyebrow and price come from the merged record so a Firestore edit shows up
  // without a deploy.
  const eyebrowEl = $('clc-eyebrow');
  if (eyebrowEl && cleanText(course.eyebrow)) eyebrowEl.textContent = course.eyebrow;

  const priceEl = $('clc-price-standard');
  const priceLabel = cleanText(course.priceLabel) || fmtPrice(course.price);
  if (priceEl && priceLabel) priceEl.textContent = priceLabel;

  const priceNoteEl = $('clc-price-note');
  if (priceNoteEl && cleanText(course.priceNote)) priceNoteEl.textContent = course.priceNote;

  // Seat count is best effort: capacity from the course doc, redemptions from
  // the coupon doc, which non-admins may not be allowed to read.
  const capacity = typeof cohort.capacity === 'number' ? cohort.capacity : null;
  let seatsTaken = null;
  if (capacity) seatsTaken = await readFoundingRedemptions();
  renderCohortFacts(cohort, seatsTaken);
  renderSeatsNote(capacity, seatsTaken);

  let enrolled = false;
  if (user) {
    try {
      await withTimeout(loadEnrollments(), 4000);
      enrolled = isEnrolled(SLUG);
    } catch (e) { enrolled = false; }
  }

  const live = course.status === 'live';

  bindFoundingButton(live);
  bindPlanNotice();

  if (enrolled) {
    replaceCtasWithLink('Go to the course →', COURSE_URL);
    return;
  }

  if (!live) {
    bindNotify(course);
    return;
  }

  bindEnroll('Enroll now');
}

main().catch((err) => {
  // Never leave the page stuck on "Loading…" because of an unexpected failure.
  console.warn('[clc-page] init failed', err);
  setCtaLabel('Notify me when enrollment opens');
  setCtaDisabled(false);
  setMsg(`If the button does not respond, email ${CONTACT_EMAIL} and we will help directly.`, false);
});
