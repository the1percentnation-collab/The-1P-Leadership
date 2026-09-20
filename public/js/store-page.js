// The member Store — every course and product the owner has switched on for
// the dashboard, in one grid with four filter tabs.
//
// This is the dashboard-side twin of the public /upcoming page and the
// homepage shop: all three read the catalog contract, so the same product
// says the same thing everywhere. The one difference is context — a member
// who holds a course sees "Open course", not "Enroll".

import { firebaseReady, auth, functions } from './firebase.js';
import { onAuthReady, currentUser } from './auth.js';
import { ensureOnboarded } from './onboarding-guard.js';
import { getRoleInfo } from './roles.js';
import { getUserProfile, escapeHtml } from './community.js';
import { renderTopbar, renderTopbarEarly } from './topbar.js';
import { renderShell } from './academy-shell.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { loadEnrollments, isEnrolled } from './enrollments.js';
import { getRefCode } from './referral.js';
import {
  loadCatalog, visibleOn, hrefFor, isExternal, ctaFor, filterByTab, sortForDisplay
} from './catalog.js';
import { fmtLaunchDate, launchCountdown } from './launch-date.js';
import { openInterestModal } from './product-interest.js';

const $ = (id) => document.getElementById(id);

let ITEMS = [];
let TAB = 'all';

function eyebrow(item) {
  if (item.onSale) return 'On sale';
  if (item.status === 'live') return item.kind === 'course' ? 'Open for enrollment' : 'Available now';
  if (item.status === 'preorder') return 'Pre-order';
  return item.launchDateMs && launchCountdown(item.launchDateMs)
    ? `Coming ${fmtLaunchDate(item.launchDateMs, { short: true })}`
    : 'Coming soon';
}

function cardHtml(item) {
  const enrolled = item.kind === 'course' && isEnrolled(item.slug);
  const cta = ctaFor(item, { enrolled });
  const href = hrefFor(item, 'dashboard', { enrolled });
  const ext = isExternal(href);

  const price = item.label
    ? `<span class="hub-explore-price">${item.onSale ? `<s style="color:var(--gray-mid);margin-right:6px;">${escapeHtml(item.originalLabel)}</s>` : ''}${escapeHtml(item.label)}</span>`
    : '';

  const when = item.status !== 'live' && item.launchDateMs && launchCountdown(item.launchDateMs)
    ? `<span class="store-when">Opens ${escapeHtml(fmtLaunchDate(item.launchDateMs))} · ${escapeHtml(launchCountdown(item.launchDateMs))}</span>`
    : '';

  let action;
  switch (cta.kind) {
    case 'buy':
      action = `<button class="btn btn-primary store-cta" data-buy="${escapeHtml(item.id)}">${escapeHtml(cta.label)}</button>`;
      break;
    case 'notify':
      action = item.kind === 'product'
        ? `<button class="btn btn-primary store-cta" data-notify="${escapeHtml(item.id)}">${escapeHtml(cta.label)}</button>`
        : `<a class="btn btn-primary store-cta" href="${escapeHtml(href)}">${escapeHtml(cta.label)}</a>`;
      break;
    case 'soldout':
      action = `<button class="btn btn-primary store-cta" disabled>Sold out</button>`;
      break;
    default:
      action = `<a class="btn btn-primary store-cta" href="${escapeHtml(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(cta.label)} →</a>`;
  }

  const art = item.imageUrl
    ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" onerror="this.remove()">`
    : '';

  return `
    <article class="store-card${enrolled ? ' is-owned' : ''}" id="s-${escapeHtml(item.kind)}-${escapeHtml(item.id)}">
      <a class="hub-watch-art store-art" href="${escapeHtml(href)}"${ext ? ' target="_blank" rel="noopener"' : ''} tabindex="-1" aria-hidden="true">
        ${art}<span class="hub-watch-mark">${escapeHtml(item.title.slice(0, 22))}</span>
      </a>
      <div class="store-body">
        <span class="hub-pill${item.onSale ? ' is-sale' : ''}">${escapeHtml(eyebrow(item))}</span>
        <span class="store-kind">${escapeHtml(item.category)}${enrolled ? ' · Yours' : ''}</span>
        <h3 class="store-title"><a href="${escapeHtml(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(item.title)}</a></h3>
        ${item.summary ? `<p class="store-sub">${escapeHtml(item.summary)}</p>` : ''}
        ${when}
        <div class="store-foot">
          ${price}
          ${action}
        </div>
      </div>
    </article>`;
}

function renderGrid() {
  const grid = $('store-grid');
  const list = sortForDisplay(filterByTab(ITEMS, TAB));
  if (!list.length) {
    const copy = {
      all: 'Nothing in the store yet. Check back soon.',
      live: 'Nothing is open right now.',
      'coming-soon': 'Nothing is scheduled to open. The next launch will show here.',
      'on-sale': 'No sales running right now.'
    }[TAB];
    grid.innerHTML = `<div class="academy-empty">${escapeHtml(copy)}</div>`;
    return;
  }
  grid.innerHTML = list.map(cardHtml).join('');

  grid.querySelectorAll('[data-notify]').forEach((b) => b.addEventListener('click', () => {
    const item = ITEMS.find((x) => x.kind === 'product' && x.id === b.dataset.notify);
    if (item) openInterestModal(item, { onJoined: () => { b.textContent = "You're on the list ✓"; b.disabled = true; } });
  }));
  grid.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => buyProduct(b)));
}

// Same checkout path as /upcoming; the server prices the item and validates
// the promo code. Members are already signed in here.
async function buyProduct(btn) {
  const id = btn.dataset.buy;
  if (!firebaseReady || !auth.currentUser) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Opening checkout…';
  try {
    const res = await httpsCallable(functions, 'createCheckoutSession')({
      productId: id,
      refCode: getRefCode() || undefined
    });
    const url = res && res.data && res.data.url;
    if (!url) throw new Error('Checkout could not be started.');
    location.assign(url);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = original;
    alert(err.message || 'Could not start checkout. Please try again.');
  }
}

function wireTabs() {
  const tabs = $('store-tabs');
  tabs.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    TAB = b.dataset.tab;
    tabs.querySelectorAll('[data-tab]').forEach((o) => {
      o.classList.toggle('is-active', o === b);
      o.setAttribute('aria-selected', o === b ? 'true' : 'false');
    });
    renderGrid();
  }));
}

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
      return;
    }
    if (!(await ensureOnboarded(user))) return;
  }

  renderShell({ current: 'store' });
  renderTopbarEarly({ user: currentUser(), currentPage: null, links: [] });
  wireTabs();

  let role = null;
  let profile = null;
  const [, , roleRes, profileRes] = await Promise.allSettled([
    loadEnrollments(),
    loadCatalog().then((items) => { ITEMS = items.filter((i) => visibleOn(i, 'dashboard')); }),
    firebaseReady && currentUser() ? getRoleInfo() : Promise.resolve(null),
    firebaseReady && currentUser() ? getUserProfile(currentUser().uid) : Promise.resolve(null)
  ]);
  if (roleRes.status === 'fulfilled' && roleRes.value) role = roleRes.value.role;
  if (profileRes.status === 'fulfilled') profile = profileRes.value;

  renderShell({ current: 'store', role });
  renderTopbar({ user: currentUser(), profile, role, currentPage: null, links: [], withSignOut: false });
  renderGrid();
}

main();
