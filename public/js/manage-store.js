// Store hub — one console over everything Anthony sells.
//
// Three tabs:
//   Catalog     — courses (dollars), classes (cents, shown as dollars), and
//                 products in one table, with inline quick-edits. Deep edits
//                 stay in the specialist editors this page links to.
//   Promo Codes — scoped coupons for courses/products (shared module from
//                 manage-coupons.js) plus each class's access codes.
//   Orders      — product orders written by the Stripe webhook, worked
//                 manually (new → shipped → done).
//
// Writes go through the client SDK under the same rules the specialist
// editors already use: courses (stripe map frozen), products (admin CRUD),
// classes (isClassAdmin), coupons (redemptions frozen), orders (status,
// fulfillmentNote, updatedAt only).

import { firebaseReady, db } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import { initCoupons, refreshCoupons } from './manage-coupons.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function gate(msg) { $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${escapeHtml(msg)}</div></div>`; }

const money = (n) => (n == null || Number.isNaN(n)) ? '—'
  : '$' + (Number.isInteger(Number(n)) ? Number(n) : Number(n).toFixed(2));

// ─── Catalog ──────────────────────────────────────────────────────────────

const COURSE_STATUSES = ['live', 'coming-soon', 'inactive', 'bundle'];
const CLASS_STATUSES = ['interest', 'scheduled', 'waitlist', 'closed'];
const PRODUCT_STATUSES = ['planned', 'interest', 'preorder', 'live', 'archived'];

let CATALOG = [];

async function loadCatalog() {
  const [courses, classes, products] = await Promise.all([
    getDocs(collection(db, 'courses')),
    getDocs(collection(db, 'classes')),
    getDocs(collection(db, 'products'))
  ]);
  CATALOG = [
    ...courses.docs.map((d) => ({
      kind: 'course', id: d.id,
      name: d.data().title || d.id,
      price: d.data().price ?? null,
      salePrice: d.data().salePrice ?? null,
      status: d.data().status || 'inactive',
      editor: `/manage-courses.html`
    })),
    ...classes.docs.map((d) => ({
      kind: 'class', id: d.id,
      name: d.data().name || d.id,
      // Class prices live in cents; the whole catalog reads in dollars.
      price: d.data().price && typeof d.data().price.amount === 'number' ? d.data().price.amount / 100 : null,
      salePrice: d.data().price && typeof d.data().price.foundingAmount === 'number' && d.data().price.foundingAmount > 0
        ? d.data().price.foundingAmount / 100 : null,
      status: d.data().status || 'interest',
      seatsPaid: d.data().seatsPaid || 0,
      capacity: d.data().capacity || 0,
      editor: `/class-admin.html`
    })),
    ...products.docs.map((d) => ({
      kind: d.data().type === 'physical' ? 'physical' : 'digital', id: d.id,
      productType: d.data().type || 'other',
      name: d.data().name || d.id,
      price: d.data().price ?? null,
      salePrice: null,
      status: d.data().status || 'planned',
      sellable: d.data().sellable === true,
      inventory: d.data().inventory ?? null,
      editor: `/manage-products.html`
    }))
  ].sort((a, b) => a.name.localeCompare(b.name));
}

function statusOptions(item) {
  const list = item.kind === 'course' ? COURSE_STATUSES
    : item.kind === 'class' ? CLASS_STATUSES : PRODUCT_STATUSES;
  return list.map((s) => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s}</option>`).join('');
}

function renderCatalog() {
  const body = $('catalog-body');
  if (!CATALOG.length) {
    body.innerHTML = `<tr><td colspan="6" style="color:var(--gray-mid);">Nothing yet.</td></tr>`;
    return;
  }
  body.innerHTML = CATALOG.map((item, i) => `<tr data-i="${i}">
    <td><b>${escapeHtml(item.name)}</b>
      ${item.kind === 'class' && item.capacity ? `<div class="store-addr">${item.seatsPaid}/${item.capacity} seats</div>` : ''}
      ${item.inventory != null ? `<div class="store-addr">${item.inventory} in stock</div>` : ''}</td>
    <td><span class="store-kind k-${item.kind}">${item.kind}</span></td>
    <td>
      <input class="c-input store-input-sm" type="number" min="0" step="0.01" data-price value="${item.price ?? ''}" placeholder="—">
      ${item.kind !== 'class'
        ? (item.kind === 'course'
          ? `<input class="c-input store-input-sm" type="number" min="0" step="0.01" data-sale value="${item.salePrice ?? ''}" placeholder="sale" title="Sale price">`
          : '')
        : (item.salePrice != null ? `<div class="store-addr">founding ${money(item.salePrice)}</div>` : '')}
    </td>
    <td><select class="c-input crm-select" data-status>${statusOptions(item)}</select></td>
    <td>${item.kind === 'digital' || item.kind === 'physical'
      ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" data-sellable ${item.sellable ? 'checked' : ''}> buyable</label>`
      : (item.kind === 'course' ? '<span class="store-addr">via course page</span>' : '<span class="store-addr">via class page</span>')}</td>
    <td style="white-space:nowrap;">
      <button class="btn btn-ghost" data-save style="padding:2px 10px;font-size:11px;">Save</button>
      <a class="btn btn-ghost" style="padding:2px 10px;font-size:11px;"
         href="${item.kind === 'class' ? item.editor : item.editor}">Editor →</a>
    </td>
  </tr>`).join('');

  body.querySelectorAll('[data-save]').forEach((btn) => btn.addEventListener('click', async () => {
    const row = btn.closest('tr');
    const item = CATALOG[Number(row.dataset.i)];
    const priceRaw = row.querySelector('[data-price]').value;
    const price = priceRaw === '' ? null : Number(priceRaw);
    const status = row.querySelector('[data-status]').value;
    btn.disabled = true; btn.textContent = '…';
    try {
      if (item.kind === 'course') {
        const saleRaw = row.querySelector('[data-sale]').value;
        const salePrice = saleRaw === '' ? null : Number(saleRaw);
        if (salePrice != null && price != null && salePrice >= price) {
          throw new Error('Sale price must be below the regular price.');
        }
        await setDoc(doc(db, 'courses', item.id),
          { price, salePrice, status, updatedAt: serverTimestamp() }, { merge: true });
      } else if (item.kind === 'class') {
        // Class docs price in cents; read-modify-write the price map so
        // founding fields survive.
        const snap = await getDoc(doc(db, 'classes', item.id));
        const cur = (snap.exists() && snap.data().price) || {};
        await setDoc(doc(db, 'classes', item.id), {
          price: { ...cur, amount: price != null ? Math.round(price * 100) : 0, currency: cur.currency || 'usd' },
          status,
          updatedAt: new Date()
        }, { merge: true });
      } else {
        const sellable = row.querySelector('[data-sellable]').checked;
        await updateDoc(doc(db, 'products', item.id),
          { price, status, sellable, updatedAt: serverTimestamp() });
      }
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 900);
    } catch (err) {
      btn.textContent = 'Save'; btn.disabled = false;
      alert(err.message || String(err));
    }
  }));
}

// ─── Class access codes ───────────────────────────────────────────────────

let CLASS_LIST = [];

async function initClassCodes() {
  const sel = $('cc-class');
  const snap = await getDocs(collection(db, 'classes'));
  CLASS_LIST = snap.docs.map((d) => ({ slug: d.id, name: d.data().name || d.id }));
  if (!CLASS_LIST.length) {
    sel.innerHTML = '<option value="">No classes yet</option>';
    return;
  }
  sel.innerHTML = CLASS_LIST.map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`).join('');
  sel.addEventListener('change', () => renderClassCodes(sel.value));
  renderClassCodes(sel.value);
}

async function renderClassCodes(slug) {
  const body = $('class-codes-body');
  $('cc-open').href = '/class-admin.html';
  if (!slug) { body.innerHTML = '<tr><td colspan="6">Pick a class.</td></tr>'; return; }
  body.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  try {
    const snap = await getDoc(doc(db, 'classes', slug, 'private', 'config'));
    const codes = (snap.exists() && snap.data().accessCodes) || [];
    if (!codes.length) {
      body.innerHTML = '<tr><td colspan="6" style="color:var(--gray-mid);">No access codes yet — add them in the Class Console.</td></tr>';
      return;
    }
    body.innerHTML = codes.map((c, i) => `<tr>
      <td><b>${escapeHtml(c.code)}</b>${c.note ? `<div class="store-addr">${escapeHtml(c.note)}</div>` : ''}</td>
      <td>${Number(c.percentOff) >= 100 ? 'Free (comp)' : `${escapeHtml(c.percentOff)}% off`}</td>
      <td>${escapeHtml(c.redemptions || 0)}${c.maxRedemptions ? ' / ' + escapeHtml(c.maxRedemptions) : ''}</td>
      <td>${c.expiresAt ? escapeHtml(String(c.expiresAt).slice(0, 10)) : '—'}</td>
      <td>${c.active !== false ? '<span class="auth-ok" style="font-size:12px;">Active</span>' : '<span style="color:var(--red);font-size:12px;">Off</span>'}</td>
      <td><button class="btn btn-ghost" data-cc-toggle="${i}" style="padding:2px 8px;font-size:11px;">${c.active !== false ? 'Turn off' : 'Turn on'}</button></td>
    </tr>`).join('');

    body.querySelectorAll('[data-cc-toggle]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        // Re-read before writing so a redemption that landed since render
        // isn't clobbered; flip only the one code's active flag.
        const fresh = await getDoc(doc(db, 'classes', slug, 'private', 'config'));
        const arr = (fresh.exists() && fresh.data().accessCodes) || [];
        const idx = Number(b.dataset.ccToggle);
        if (arr[idx]) arr[idx] = { ...arr[idx], active: arr[idx].active === false };
        await setDoc(doc(db, 'classes', slug, 'private', 'config'),
          { accessCodes: arr, updatedAt: new Date() }, { merge: true });
        renderClassCodes(slug);
      } catch (err) {
        b.disabled = false;
        alert(err.message || String(err));
      }
    }));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" style="color:var(--red);">${escapeHtml(err.message || String(err))}</td></tr>`;
  }
}

// ─── Orders ───────────────────────────────────────────────────────────────

function shippingHtml(sh) {
  if (!sh) return '<span class="store-addr">—</span>';
  const a = sh.address || {};
  const lines = [sh.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(', '), a.country]
    .filter(Boolean);
  return `<div class="store-addr">${lines.map(escapeHtml).join('<br>')}</div>`;
}

async function renderOrders() {
  const body = $('orders-body');
  try {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
    if (snap.empty) {
      body.innerHTML = '<tr><td colspan="6" style="color:var(--gray-mid);">No orders yet.</td></tr>';
      return;
    }
    body.innerHTML = snap.docs.map((d) => {
      const o = d.data();
      const when = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate().toLocaleDateString() : '—';
      return `<tr>
        <td>${escapeHtml(when)}</td>
        <td><b>${escapeHtml(o.productName || o.productId || '—')}</b>${o.couponCode ? `<div class="store-addr">code ${escapeHtml(o.couponCode)}</div>` : ''}</td>
        <td class="store-addr">${escapeHtml(o.email || '—')}</td>
        <td>${money(o.amountTotal)}</td>
        <td>${shippingHtml(o.shipping)}</td>
        <td>
          <select class="c-input crm-select" data-order="${escapeHtml(d.id)}">
            ${['new', 'shipped', 'done'].map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-order]').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await updateDoc(doc(db, 'orders', sel.dataset.order),
          { status: sel.value, updatedAt: serverTimestamp() });
      } catch (err) { alert(err.message || String(err)); }
    }));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" style="color:var(--red);">${escapeHtml(err.message || String(err))}</td></tr>`;
  }
}

// ─── Shell ────────────────────────────────────────────────────────────────

function wireTabs() {
  document.querySelectorAll('.store-tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.store-tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.store-panel').forEach((p) =>
      p.classList.toggle('active', p.id === 'panel-' + tab.dataset.tab));
  }));
}

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/manage-store.html')); return; }
  const info = await getRoleInfo(true);
  renderTopbar({ user: u, role: info.role, currentPage: null });
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  $('panel').style.display = 'block';
  wireTabs();
  await loadCatalog();
  renderCatalog();
  initCoupons({ userEmail: u.email });
  initClassCodes();
  renderOrders();
}

main();
