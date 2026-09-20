// Public "what's coming" page — browse products, join a product's interest
// list, or join the general early-access list. No login required.
//
// Renders from the catalog contract (catalog-core.js), so what a card says
// here is what the homepage shop and the member Store say about the same
// product: the launch date, the sale price, where the button goes.

import { firebaseReady, auth, functions } from './firebase.js';
import { getRefCode } from './referral.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { listVisibleProducts, joinEarlyAccess, escapeHtml } from './products.js';
import { normalizeProduct, visibleOn, ctaFor, sortForDisplay } from './catalog-core.js';
import { fmtLaunchDate, launchCountdown } from './launch-date.js';
import { openInterestModal } from './product-interest.js';

const $ = (id) => document.getElementById(id);

function badgeFor(item) {
  if (item.status === 'live') return 'Available now';
  if (item.status === 'preorder') return 'Pre-order';
  // A dated launch is a reason to come back; the bare word is not.
  return item.launchDateMs && launchCountdown(item.launchDateMs)
    ? `Coming ${fmtLaunchDate(item.launchDateMs, { short: true })}`
    : 'Coming soon';
}

function priceHtml(item) {
  if (!item.label) return '<span class="pre-card-price muted">TBA</span>';
  return item.onSale
    ? `<span class="pre-card-price"><s style="color:var(--gray-mid);font-weight:400;margin-right:6px;">${escapeHtml(item.originalLabel)}</s>${escapeHtml(item.label)}</span>`
    : `<span class="pre-card-price">${escapeHtml(item.label)}</span>`;
}

function ctaHtml(item) {
  const cta = ctaFor(item);
  const id = escapeHtml(item.id);
  switch (cta.kind) {
    case 'external':
      return `<a class="btn btn-primary" href="${escapeHtml(item.externalUrl)}" target="_blank" rel="noopener">${escapeHtml(cta.label)} →</a>`;
    case 'buy':
      return `<button class="btn btn-primary" data-buy="${id}">${escapeHtml(cta.label)} — ${escapeHtml(item.label)}</button>`;
    case 'soldout':
      // Disabled, not decorated: the old card printed "Sold out" beside a
      // button that still opened checkout (which the server then refused).
      return `<button class="btn btn-primary" disabled>Sold out</button>`;
    case 'notify':
      return `<button class="btn btn-primary" data-interest="${id}">Notify me</button>`;
    default:
      return `<a class="btn btn-primary" href="/courses.html">View it →</a>`;
  }
}

function cardHtml(item) {
  const when = item.status !== 'live' && item.launchDateMs && launchCountdown(item.launchDateMs)
    ? `<div class="pre-card-sum" style="color:var(--red);">Opens ${escapeHtml(fmtLaunchDate(item.launchDateMs))} — ${escapeHtml(launchCountdown(item.launchDateMs))}</div>`
    : '';
  return `
    <div class="card pre-card" id="p-${escapeHtml(item.id)}" data-product="${escapeHtml(item.id)}">
      ${item.imageUrl ? `<img class="pre-card-img" src="${escapeHtml(item.imageUrl)}" alt="">` : ''}
      <div class="pre-card-badge">${escapeHtml(badgeFor(item))}${item.onSale ? ' · On sale' : ''}</div>
      <h3 class="pre-card-title">${escapeHtml(item.title)}</h3>
      ${item.summary ? `<p class="pre-card-sum">${escapeHtml(item.summary)}</p>` : ''}
      ${when}
      <div class="pre-card-foot">
        ${priceHtml(item)}
        ${item.interestCount ? `<span class="pre-card-count">🔥 ${item.interestCount} interested</span>` : ''}
      </div>
      ${ctaHtml(item)}
    </div>`;
}

let ITEMS = [];
async function load() {
  // Back from a successful Stripe checkout.
  if (new URLSearchParams(location.search).get('purchase') === 'success') {
    const grid = $('pre-grid');
    const note = document.createElement('div');
    note.className = 'auth-ok';
    note.style.marginBottom = '16px';
    note.textContent = 'Order received — check your email for the receipt. Thank you!';
    grid.parentElement.insertBefore(note, grid);
    history.replaceState(null, '', location.pathname);
  }
  const raw = await listVisibleProducts();
  ITEMS = sortForDisplay(raw.map((p) => normalizeProduct(p)).filter((i) => i && visibleOn(i, 'site')));
  const grid = $('pre-grid');
  if (!ITEMS.length) {
    grid.innerHTML = `<div class="pre-empty">Nothing announced yet — join the early-access list below and you'll be first to know.</div>`;
    return;
  }
  grid.innerHTML = ITEMS.map(cardHtml).join('');
  grid.querySelectorAll('[data-interest]').forEach((b) => b.addEventListener('click', () => {
    const item = ITEMS.find((x) => x.id === b.getAttribute('data-interest'));
    if (item) openInterestModal(item, { onJoined: load });
  }));
  grid.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => buyProduct(b)));

  // A launch email or a store card links straight to one product.
  if (location.hash && location.hash.startsWith('#p-')) {
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ block: 'center' });
  }
}

// Checkout for a sellable product. Sign-in is required (same as courses);
// the server prices the item and, when it's physical, has Stripe collect the
// shipping address. A promo link (?promo=CODE) rides along and the server
// validates it against this product.
async function buyProduct(btn) {
  const id = btn.getAttribute('data-buy');
  if (!firebaseReady) return;
  if (!auth.currentUser) {
    location.assign('/login.html?next=' + encodeURIComponent(location.pathname + location.search + location.hash));
    return;
  }
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Opening secure checkout…';
  try {
    const promo = new URLSearchParams(location.search).get('promo');
    const res = await httpsCallable(functions, 'createCheckoutSession')({
      productId: id,
      refCode: getRefCode() || undefined,
      couponCode: promo ? promo.trim().toUpperCase() : undefined
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

function wireEarlyAccess() {
  $('early-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('ea-msg');
    msg.textContent = '';
    try {
      await joinEarlyAccess({
        name: $('ea-name').value.trim(), email: $('ea-email').value.trim(), consent: $('ea-consent').checked
      });
      msg.textContent = "You're on the early-access list! 🎉";
      msg.className = 'pre-msg ok';
      $('early-form').reset();
    } catch (err) {
      msg.textContent = err.message || String(err);
      msg.className = 'pre-msg err';
    }
  });
}

async function main() {
  if (!firebaseReady) { $('pre-grid').innerHTML = '<div class="pre-empty">Unable to load right now.</div>'; return; }
  wireEarlyAccess();
  await load();
}
main();
