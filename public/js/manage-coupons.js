// Promo codes manager — shared by /manage-courses.html and /manage-store.html.
//
// Contract: coupons/{CODE} docs are validated SERVER-SIDE (validateCoupon /
// createCheckoutSession price the discount into the Stripe session), so what
// this page writes to Firestore is immediately authoritative: deactivating a
// code stops it on the next attempt, no Stripe sync involved. The legacy
// syncCoupon flow (Stripe promotion codes) is retired — old synced coupons
// keep working through the same server validation.
//
// Scoping: `appliesTo` is null (legacy — every course) or
// { kind: 'course'|'product', ids: [] } where an empty ids list means every
// item of that kind. `redemptions` is server-written; rules freeze it here.

import { db } from './firebase.js';
import {
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ok(el, msg) { el.innerHTML = `<div class="auth-ok">${msg}</div>`; }
function err(el, e) { el.innerHTML = `<div class="auth-error">${escapeHtml(e && e.message ? e.message : String(e))}</div>`; }

let _userEmail = null;
let _itemNames = { course: {}, product: {} };   // id → display name, for the table

async function loadItemChoices() {
  const [courses, products] = await Promise.all([
    getDocs(collection(db, 'courses')),
    getDocs(collection(db, 'products'))
  ]);
  _itemNames = { course: {}, product: {} };
  const courseOpts = courses.docs.map((d) => {
    _itemNames.course[d.id] = d.data().title || d.id;
    return { id: d.id, name: d.data().title || d.id };
  });
  const productOpts = products.docs.map((d) => {
    _itemNames.product[d.id] = d.data().name || d.id;
    return { id: d.id, name: d.data().name || d.id };
  });
  return { course: courseOpts, product: productOpts };
}

function scopeLabel(c) {
  const scope = c.appliesTo || null;
  if (!scope) return 'All courses';
  const kindLabel = scope.kind === 'product' ? 'product' : 'course';
  const ids = Array.isArray(scope.ids) ? scope.ids : [];
  if (!ids.length) return scope.kind === 'product' ? 'All products' : 'All courses';
  const names = ids.map((id) => _itemNames[kindLabel][id] || id);
  return names.join(', ');
}

export async function refreshCoupons() {
  const body = $('coupons-body');
  try {
    const snap = await getDocs(collection(db, 'coupons'));
    if (snap.empty) {
      body.innerHTML = `<tr><td colspan="7" style="color:var(--gray-mid);">No promo codes yet.</td></tr>`;
      return;
    }
    body.innerHTML = snap.docs.map((d) => {
      const c = d.data();
      const discount = c.percentOff >= 100 ? 'Free (comp)'
        : c.percentOff ? `${c.percentOff}% off`
        : (c.amountOff ? `$${c.amountOff} off` : '—');
      const expires = c.expiresAt && c.expiresAt.toDate ? c.expiresAt.toDate().toLocaleDateString() : '—';
      const uses = `${c.redemptions || 0}${c.maxRedemptions ? ' / ' + c.maxRedemptions : ''}`;
      return `<tr>
        <td><b>${escapeHtml(d.id)}</b></td>
        <td>${escapeHtml(discount)}</td>
        <td style="max-width:220px;">${escapeHtml(scopeLabel(c))}</td>
        <td>${escapeHtml(uses)}</td>
        <td>${escapeHtml(expires)}</td>
        <td>${c.active !== false ? '<span class="auth-ok" style="font-size:12px;">Active</span>' : '<span style="color:var(--red); font-size:12px;">Off</span>'}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-ghost" data-toggle-coupon="${escapeHtml(d.id)}" style="padding:2px 8px; font-size:11px;">${c.active !== false ? 'Turn off' : 'Turn on'}</button>
          <button class="btn btn-ghost" data-delete-coupon="${escapeHtml(d.id)}" style="padding:2px 8px; font-size:11px; color:var(--red);">Delete</button>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-toggle-coupon]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ref = doc(db, 'coupons', b.dataset.toggleCoupon);
        const snap2 = await getDoc(ref);
        if (!snap2.exists()) return;
        await setDoc(ref, { active: snap2.data().active === false }, { merge: true });
        await refreshCoupons();
      }));
    body.querySelectorAll('[data-delete-coupon]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm(`Delete promo code ${b.dataset.deleteCoupon}? Anyone holding it will no longer be able to use it.`)) return;
        await deleteDoc(doc(db, 'coupons', b.dataset.deleteCoupon));
        await refreshCoupons();
      }));
  } catch (e) {
    body.innerHTML = `<tr><td colspan="7" style="color:var(--red);">${escapeHtml(e.message || String(e))}</td></tr>`;
  }
}

function currentScope() {
  const scope = $('cp-scope') ? $('cp-scope').value : 'all-courses';
  if (scope === 'all-courses') return null;
  const kind = scope === 'products' ? 'product' : 'course';
  const ids = $('cp-items')
    ? [...$('cp-items').selectedOptions].map((o) => o.value).filter(Boolean)
    : [];
  return { kind, ids };
}

async function createCoupon(e) {
  e.preventDefault();
  const out = $('coupon-result');
  try {
    const code = $('cp-code').value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!code) throw new Error('Code is required.');
    const type = $('cp-type') ? $('cp-type').value : 'percent';
    const percentOff = type === 'comp' ? 100 : Number($('cp-percent').value);
    if (!percentOff || percentOff < 1 || percentOff > 100) {
      throw new Error('Set a percent between 1 and 100.');
    }
    const maxRaw = $('cp-max') ? $('cp-max').value : '';
    const expiresRaw = $('cp-expires').value;
    await setDoc(doc(db, 'coupons', code), {
      code,
      percentOff,
      amountOff: null,
      appliesTo: currentScope(),
      maxRedemptions: maxRaw ? Number(maxRaw) : null,
      redemptions: 0,
      active: true,
      expiresAt: expiresRaw ? new Date(expiresRaw + 'T23:59:59') : null,
      createdAt: serverTimestamp(),
      createdBy: _userEmail
    });
    ok(out, `Promo code <b>${escapeHtml(code)}</b> is live — it works at checkout right now.`);
    $('coupon-form').reset();
    syncScopeUi();
    await refreshCoupons();
  } catch (e2) { err(out, e2); }
}

function syncScopeUi() {
  const type = $('cp-type');
  const pctField = $('cp-percent-field');
  if (type && pctField) pctField.style.display = type.value === 'comp' ? 'none' : '';
  const scope = $('cp-scope');
  const items = $('cp-items');
  if (!scope || !items) return;
  const val = scope.value;
  items.parentElement.style.display = val === 'all-courses' ? 'none' : '';
  [...items.options].forEach((o) => {
    o.hidden = o.dataset.kind !== (val === 'products' ? 'product' : 'course');
    if (o.hidden) o.selected = false;
  });
}

export async function initCoupons({ userEmail } = {}) {
  _userEmail = userEmail || null;
  const form = $('coupon-form');
  if (form) form.addEventListener('submit', createCoupon);

  // Fill the item picker before first render so scope labels resolve.
  try {
    const choices = await loadItemChoices();
    const items = $('cp-items');
    if (items) {
      items.innerHTML =
        choices.course.map((c) => `<option value="${escapeHtml(c.id)}" data-kind="course">${escapeHtml(c.name)}</option>`).join('')
        + choices.product.map((p) => `<option value="${escapeHtml(p.id)}" data-kind="product">${escapeHtml(p.name)}</option>`).join('');
    }
  } catch (_) { /* picker stays empty; scoping to all still works */ }

  if ($('cp-type')) $('cp-type').addEventListener('change', syncScopeUi);
  if ($('cp-scope')) $('cp-scope').addEventListener('change', syncScopeUi);
  syncScopeUi();
  refreshCoupons();
}
