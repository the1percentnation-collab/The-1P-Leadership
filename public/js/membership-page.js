// The One Percent Membership (/membership): the offer, the founding-spot
// count, checkout, and, for members, their own status and cancel/resume.
//
// Prices and rules come from membership-core.js; the server decides the plan
// (founding or standard) at checkout from the live count, so what this page
// shows is a preview, never the authority. config/membership is publicly
// readable for the course list and spots left.

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { loadCourses, getCourses } from './courses-data.js';
import {
  PLANS, FOUNDING_LIMIT, includedSlugs, isActiveMember, planForSignup, foundingSpotsLeft, priceFor
} from './membership-core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const params = new URLSearchParams(location.search);

let billing = params.get('join') === 'year' ? 'year' : 'month';
let config = null;
let user = null;      // auth user
let profile = null;   // users/{uid} data

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null));
const day = (t) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

function renderPrice() {
  const plan = planForSignup(config && config.foundingCount);
  const founding = plan === 'founding';
  const amount = priceFor(plan, billing);
  const std = priceFor('standard', billing);
  $('price').textContent = `$${amount}`;
  $('per').textContent = billing === 'year' ? '/ year' : '/ month';
  $('was').textContent = founding ? `$${std}` : '';
  $('was').hidden = !founding;
  $('plan-label').textContent = founding ? 'Founding member rate' : 'Membership';
  $('plan-note').textContent = founding
    ? 'Locked in for as long as you stay a member.'
    : (billing === 'year' ? 'Ten months for the price of twelve, billed once a year.' : 'Billed monthly. Cancel anytime.');
  $('btn-join').innerHTML = `${founding ? 'Join as a founding member' : 'Join the membership'} &rarr;`;
  const left = foundingSpotsLeft(config && config.foundingCount);
  $('spots-box').hidden = !founding;
  $('spots-left').textContent = String(left);
  $('spots-bar').style.width = `${Math.round(((FOUNDING_LIMIT - left) / FOUNDING_LIMIT) * 100)}%`;
  $('hero-spots').textContent = founding
    ? `${left} of ${FOUNDING_LIMIT} founding spots left at $${PLANS.founding.month} a month, kept for as long as you stay.`
    : `$${PLANS.standard.month} a month, or $${PLANS.standard.year} a year. Cancel anytime.`;
  document.querySelectorAll('[data-billing]').forEach((b) => b.classList.toggle('is-on', b.dataset.billing === billing));
}

function renderCourses() {
  const slugs = includedSlugs(config);
  const courses = getCourses().filter((c) => slugs.includes(c.slug) && c.kind !== 'bundle');
  const live = courses.filter((c) => c.status === 'live');
  const soon = courses.filter((c) => c.status === 'coming-soon');
  const names = [...live, ...soon].map((c) => `${esc(c.title)}${c.status === 'coming-soon' ? ' <em style="color:#E4C65B;font-style:normal">(coming soon)</em>' : ''}`);
  $('course-names').innerHTML = names.length ? names.join(' · ') : 'New courses join as they launch.';
  $('course-count').textContent = live.length ? `${live.length} live` : '';
}

function renderMember() {
  const m = (profile && profile.membership) || {};
  const canceling = m.status === 'canceling';
  const pastDue = m.status === 'past_due';
  const until = ms(m.cancelAt) || ms(m.currentPeriodEnd);
  const plan = PLANS[m.plan] || PLANS.standard;
  const rate = m.billing === 'year' ? `$${plan.year} a year` : `$${plan.month} a month`;
  $('join-panel').hidden = true;
  const panel = $('member-panel');
  panel.hidden = false;
  panel.closest('.mb-price-card').classList.add('mb-member');
  panel.innerHTML = `
    <div class="mb-plan">${esc(plan.label)} · active</div>
    <div class="mb-amount"><span class="n" style="font-size:clamp(44px,6vw,64px)">You are in.</span></div>
    <p class="mb-note">${esc(rate)}${m.plan === 'founding' ? ', your founding rate' : ''}. ${canceling
      ? `Your membership ends on ${esc(day(until))}. Nothing renews after that.`
      : pastDue ? 'Your last payment did not go through. Update your card from the receipt email so nothing interrupts your access.'
        : until ? `Renews on ${esc(day(until))}.` : ''}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
      <a class="btn btn-red" href="/courses.html">Go to your courses &rarr;</a>
    </div>
    <p class="mb-fine" style="margin-top:14px">${canceling
      ? '<button class="btn btn-ghost btn-sm" type="button" id="btn-resume">Keep my membership</button>'
      : '<button type="button" id="btn-cancel" style="background:none;border:0;color:var(--gray-500);text-decoration:underline;cursor:pointer;font:inherit;padding:0">Cancel membership</button>'}</p>
    <p class="mb-msg" id="member-msg" role="status" aria-live="polite"></p>`;
  const act = async (action) => {
    if (action === 'cancel' && !confirm('Cancel your membership? It stays open until the end of the period you already paid for.')) return;
    try {
      await httpsCallable(functions, 'manageMembership')({ action });
      await loadProfile();
      renderMember();
    } catch (e) {
      $('member-msg').textContent = (e && e.message) || 'That did not go through. Please try again.';
    }
  };
  const c = $('btn-cancel'); if (c) c.addEventListener('click', () => act('cancel'));
  const r = $('btn-resume'); if (r) r.addEventListener('click', () => act('resume'));
}

async function loadProfile() {
  if (!user) { profile = null; return; }
  const snap = await getDoc(doc(db, 'users', user.uid));
  profile = snap.exists() ? snap.data() : {};
}

async function join() {
  const msg = $('join-msg');
  msg.textContent = '';
  if (!user) {
    const next = `/membership?join=${billing}#join`;
    location.href = `/signup.html?next=${encodeURIComponent(next)}`;
    return;
  }
  const btn = $('btn-join');
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.textContent = 'Opening secure checkout…';
  try {
    const res = await httpsCallable(functions, 'createMembershipCheckout')({ billing });
    location.href = res.data.url;
  } catch (e) {
    msg.textContent = (e && e.message) || 'Checkout could not open. Please try again.';
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

// Back from Stripe: the webhook switches the membership on within seconds.
async function awaitActivation() {
  const w = $('welcome');
  w.hidden = false;
  w.textContent = 'Payment received. Opening your membership…';
  for (let i = 0; i < 15; i++) {
    await loadProfile();
    if (isActiveMember(profile)) {
      w.textContent = 'Welcome in. Your membership is active.';
      renderMember();
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  w.textContent = 'Payment received. Your membership is being set up and will appear here shortly. Refresh in a minute.';
}

async function main() {
  document.querySelectorAll('[data-billing]').forEach((b) => b.addEventListener('click', () => { billing = b.dataset.billing; renderPrice(); }));
  $('btn-join').addEventListener('click', join);
  renderPrice();
  if (!firebaseReady) { $('course-names').textContent = 'New courses join as they launch.'; return; }

  try {
    const [cfg] = await Promise.all([getDoc(doc(db, 'config', 'membership')), loadCourses()]);
    config = cfg.exists() ? cfg.data() : null;
  } catch (e) { console.warn('[membership] config', e); }
  renderPrice();
  renderCourses();

  user = await onAuthReady();
  if (!user) return;
  try { await loadProfile(); } catch (e) { console.warn('[membership] profile', e); }
  if (isActiveMember(profile)) { renderMember(); return; }
  if (params.get('welcome')) { awaitActivation(); return; }
  if (params.get('join')) document.getElementById('join').scrollIntoView({ block: 'center' });
}

main();
