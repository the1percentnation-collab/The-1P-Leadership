// Orders + Inventory tabs of the store console (/manage-store.html).
//
// Orders is one pipeline for everything that needs a person to fulfil it:
// Stripe checkout orders (paperback bundles, physical products) and hand
// sales Anthony takes himself (a Messenger DM, a table at an event). Hand
// sales are created and moved here and written by the manageHandSale
// callable, which keeps the invoice number, the stock count, the CRM contact
// and the reminder tasks in step. Stripe orders keep their simple status
// select, written under the existing orders rule.
//
// Inventory counts the books on Anthony's shelf (stock/{productId}), with
// every change in stock/{id}/moves. Hand sales draw it down; adjustStock
// receives boxes and corrects counts. Server-written only.
//
// Settings (config/handSales) hold the payment handles printed on invoices,
// default shipping, and the reminder timing.

import { db, functions } from './firebase.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  CHANNELS, PAYMENT_METHODS, STOCK_REASONS, BUCKETS, DEFAULT_SETTINGS,
  formatMoney, labelFor, mergeSettings, computeTotals, addressLines, isPaid, orderBucket,
  invoiceMessage, reminderMessage, reminderDue, lastNudgeMs, smsLink, dmLink, shippedMessage, reviewMessage, lowStock, summarize, parseAddress
} from './hand-sales-core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const opts = (list, sel) => list.map((x) => `<option value="${esc(x.key)}" ${x.key === sel ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null));
const day = (t) => { const m = ms(t); return m ? new Date(m).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'; };

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

const state = {
  orders: [],
  products: [],   // { id, name, type, price, salePrice }
  stock: {},      // productId → stock doc
  settings: mergeSettings({}),
  filter: 'open'
};

function invoiceUrl(o) {
  return `${location.origin}/invoice?i=${encodeURIComponent(o.id)}&t=${encodeURIComponent(o.invoiceToken)}`;
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { const t = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = t; }, 1400); }
  } catch (e) {
    window.prompt('Copy this:', text);
  }
}

function toast(msg, bad) {
  const el = $('hs-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'hs-toast show' + (bad ? ' bad' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'hs-toast'; }, 3200);
}

function errMsg(e) {
  return (e && (e.message || String(e)) || 'Something went wrong.').replace(/^FirebaseError:\s*/, '');
}

// ─── Loading ──────────────────────────────────────────────────────────────

async function loadAll() {
  const [orders, products, stock, settings] = await Promise.all([
    getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(500))),
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'stock')).catch(() => ({ docs: [] })),
    getDoc(doc(db, 'config', 'handSales')).catch(() => null)
  ]);
  state.orders = orders.docs.map((d) => ({ id: d.id, ...d.data(), createdAtMs: ms(d.data().createdAt) }));
  state.products = products.docs.map((d) => ({
    id: d.id,
    name: d.data().name || d.id,
    type: d.data().type || 'other',
    price: typeof d.data().price === 'number' ? d.data().price : null,
    salePrice: typeof d.data().salePrice === 'number' ? d.data().salePrice : null,
    status: d.data().status || 'planned'
  })).sort((a, b) => (a.type === 'book' ? -1 : 0) - (b.type === 'book' ? -1 : 0) || a.name.localeCompare(b.name));
  state.stock = {};
  stock.docs.forEach((d) => { state.stock[d.id] = { id: d.id, ...d.data() }; });
  state.settings = mergeSettings(settings && settings.exists() ? settings.data() : {});
}

function defaultPrice(p) {
  try {
    const remembered = localStorage.getItem('hs-price:' + p.id);
    if (remembered != null && remembered !== '') return Number(remembered);
  } catch (e) {}
  if (p.salePrice != null && p.price != null && p.salePrice < p.price) return p.salePrice;
  return p.price != null ? p.price : 0;
}

// ─── Orders tab ───────────────────────────────────────────────────────────

const FILTERS = [
  { key: 'open', label: 'Open', buckets: ['collect', 'address', 'ship'] },
  ...BUCKETS.filter((b) => b.key !== 'cancelled').map((b) => ({ key: b.key, label: b.label, buckets: [b.key] })),
  { key: 'cancelled', label: 'Cancelled', buckets: ['cancelled'] },
  { key: 'all', label: 'All', buckets: null }
];

function renderSummary() {
  const s = summarize(state.orders);
  const tracked = Object.values(state.stock);
  const shelf = tracked.reduce((n, x) => n + (Number(x.onHand) || 0), 0);
  const low = tracked.filter((x) => lowStock(x.onHand, state.settings, x.reorderAt)).length;
  const nudge = state.orders.filter((o) => reminderDue(o, state.settings)).length;
  $('hs-summary').innerHTML = `
    <div class="hs-tile ${s.owedCount ? 'warn' : ''}"><div class="hs-tile-k">Owed to you</div><div class="hs-tile-v">${formatMoney(s.owed)}</div><div class="hs-tile-s">${s.owedCount} unpaid invoice${s.owedCount === 1 ? '' : 's'}${nudge ? ` · ${nudge} to remind` : ''}</div></div>
    <div class="hs-tile ${s.toShip ? 'hot' : ''}"><div class="hs-tile-k">Ready to ship</div><div class="hs-tile-v">${s.toShip}</div><div class="hs-tile-s">${s.needsAddress ? `${s.needsAddress} waiting on an address` : 'paid and waiting'}</div></div>
    <div class="hs-tile"><div class="hs-tile-k">This month</div><div class="hs-tile-v">${formatMoney(s.monthRevenue)}</div><div class="hs-tile-s">${s.monthUnits} unit${s.monthUnits === 1 ? '' : 's'} paid</div></div>
    <div class="hs-tile ${low ? 'warn' : ''}"><div class="hs-tile-k">On the shelf</div><div class="hs-tile-v">${tracked.length ? shelf : '—'}</div><div class="hs-tile-s">${tracked.length ? (low ? `${low} running low` : 'stock healthy') : 'not counting yet'}</div></div>`;
}

function renderFilters() {
  const counts = {};
  state.orders.forEach((o) => { const b = orderBucket(o); counts[b] = (counts[b] || 0) + 1; });
  $('hs-filters').innerHTML = FILTERS.map((f) => {
    const n = f.buckets ? f.buckets.reduce((s, b) => s + (counts[b] || 0), 0) : state.orders.length;
    return `<button class="crm-chip ${state.filter === f.key ? 'active' : ''}" data-f="${f.key}">${esc(f.label)} <span class="hs-count">${n}</span></button>`;
  }).join('');
  $('hs-filters').querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.f;
    renderFilters();
    renderOrderList();
  }));
}

function payBadge(o) {
  if (o.status === 'cancelled') return '<span class="hs-badge mute">Cancelled</span>';
  if (o.kind !== 'manual') return '<span class="hs-badge ok">Paid · site checkout</span>';
  const p = o.payment || {};
  if (p.status === 'comp') return '<span class="hs-badge ok">Comp</span>';
  if (p.status === 'paid') return `<span class="hs-badge ok">Paid · ${esc(labelFor(PAYMENT_METHODS, p.method))}</span>`;
  const reminded = o.reminderCount > 1 ? `reminded ${o.reminderCount}×` : 'reminded';
  const seen = o.viewedAt ? 'invoice opened' : (o.remindedAt ? reminded : (o.invoiceSentAt ? 'invoice sent' : ''));
  return `<span class="hs-badge bad">Unpaid${seen ? ` · ${seen}` : ''}</span>`;
}

function stageBadge(o) {
  const map = {
    'needs-address': ['Needs address', 'warn'], new: [o.delivery === 'hand' ? 'To deliver' : 'To ship', 'hot'],
    shipped: ['Shipped', 'info'], done: ['Delivered', 'ok'], cancelled: ['Cancelled', 'mute']
  };
  const [label, cls] = map[o.status] || [o.status || '—', 'mute'];
  return `<span class="hs-badge ${cls}">${esc(label)}</span>`;
}

function itemsHtml(o) {
  if (Array.isArray(o.items) && o.items.length) {
    return o.items.map((it) => `<div>${it.qty} × ${esc(it.name)} <span class="hs-dim">@ ${formatMoney(it.unitPrice)}</span>${it.note ? `<div class="hs-dim">${esc(it.note)}</div>` : ''}</div>`).join('');
  }
  return `<div>${esc(o.productName || o.productId || '—')}${o.couponCode ? ` <span class="hs-dim">code ${esc(o.couponCode)}</span>` : ''}</div>`;
}

function primaryAction(o) {
  if (o.kind !== 'manual' || o.status === 'cancelled') return '';
  if (!isPaid(o)) return `<button class="btn btn-primary hs-act" data-act="pay">Mark paid</button>`;
  if (o.status === 'needs-address') return `<button class="btn btn-primary hs-act" data-act="edit">Add address</button>`;
  if (o.status === 'new') return o.delivery === 'hand'
    ? `<button class="btn btn-primary hs-act" data-act="deliver">Mark delivered</button>`
    : `<button class="btn btn-primary hs-act" data-act="ship">Mark shipped</button>`;
  if (o.status === 'shipped') return `<button class="btn btn-primary hs-act" data-act="deliver">Mark delivered</button>`;
  if (o.status === 'done' && !o.reviewAskedAt) return `<button class="btn btn-primary hs-act" data-act="review">Ask for review</button>`;
  return '';
}

const canSend = (o) => o.kind === 'manual' && o.status !== 'cancelled' && !isPaid(o);

// Not sent yet: Send invoice. Sent: Remind, lit up once it has sat quiet for
// dueDays (the same clock as the collect task in Tasks).
function sendButton(o) {
  if (!canSend(o)) return '<button class="btn btn-ghost hs-act" data-act="copy-msg">Copy message</button>';
  if (!o.invoiceSentAt) return '<button class="btn btn-ghost hs-act" data-act="send">Send invoice</button>';
  const due = reminderDue(o, state.settings);
  return `<button class="btn btn-ghost hs-act ${due ? 'hs-nudge' : ''}" data-act="remind"${due ? ' title="Unpaid and quiet. Time to follow up."' : ''}>Remind</button>`;
}

function orderCardHtml(o) {
  const manual = o.kind === 'manual';
  const lines = addressLines(o.shipping);
  const who = manual ? (o.buyer && o.buyer.name) || '—' : (o.shipping && o.shipping.name) || o.email || '—';
  const contactBits = manual
    ? [o.buyer && o.buyer.handle, o.buyer && o.buyer.email, o.buyer && o.buyer.phone].filter(Boolean)
    : [o.email].filter(Boolean);
  const shipBlock = o.delivery === 'hand'
    ? '<div class="hs-dim">Hand delivery / pickup</div>'
    : (lines.length
      ? `<div class="hs-addr">${lines.map(esc).join('<br>')}</div><button class="hs-link" data-act="copy-addr">Copy address</button>`
      : '<div class="hs-missing">No address yet</div>');
  const tracking = o.tracking && (o.tracking.number || o.tracking.carrier)
    ? `<div class="hs-dim">Tracking: ${esc([o.tracking.carrier, o.tracking.number].filter(Boolean).join(' '))}</div>` : '';

  return `<div class="hs-order ${o.status === 'cancelled' ? 'is-cancelled' : ''}" data-id="${esc(o.id)}">
    <div class="hs-order-head">
      <div>
        <div class="hs-order-no">${esc(manual ? o.invoiceNumber : 'Site order')} <span class="hs-dim">· ${day(o.createdAt)}${manual ? ' · ' + esc(labelFor(CHANNELS, o.channel)) : ''}</span></div>
        <div class="hs-order-who">${esc(who)}</div>
        ${contactBits.length ? `<div class="hs-dim">${contactBits.map(esc).join(' · ')}</div>` : ''}
      </div>
      <div class="hs-order-total">${formatMoney(o.amountTotal)}<div>${payBadge(o)}</div></div>
    </div>
    <div class="hs-order-body">
      <div class="hs-col"><div class="hs-k">Items</div>${itemsHtml(o)}${o.giftMessage ? `<div class="hs-sign">✍ ${esc(o.giftMessage)}</div>` : ''}</div>
      <div class="hs-col"><div class="hs-k">Send to</div>${shipBlock}${tracking}</div>
    </div>
    ${o.notes ? `<div class="hs-note">${esc(o.notes)}</div>` : ''}
    <div class="hs-order-foot">
      ${stageBadge(o)}
      <div class="hs-actions">
        ${manual ? `
          ${primaryAction(o)}
          ${sendButton(o)}
          <a class="btn btn-ghost hs-act" href="${esc(invoiceUrl(o))}" target="_blank" rel="noopener">Invoice</a>
          <details class="hs-more"><summary class="btn btn-ghost hs-act">More</summary><div class="hs-menu">
            <button data-act="edit">Edit order</button>
            ${canSend(o) ? '<button data-act="copy-msg">Copy message</button>' : ''}
            ${canSend(o) && o.invoiceSentAt ? '<button data-act="send">Send original invoice</button>' : ''}
            ${o.buyer && o.buyer.email ? `<button data-act="email">Email invoice${o.invoiceSentAt ? ' again' : ''}</button>` : ''}
            <button data-act="copy-link">Copy invoice link</button>
            ${o.status === 'shipped' || o.status === 'done' ? '<button data-act="copy-shipped">Copy shipped message</button><button data-act="copy-review">Copy review ask</button>' : ''}
            ${o.status === 'shipped' || o.status === 'done' ? '<button data-act="ship">Update tracking</button>' : ''}
            ${isPaid(o) && o.status !== 'cancelled' ? '<button data-act="unpay">Mark unpaid</button>' : ''}
            ${o.contactId ? `<a href="/contact.html?id=${encodeURIComponent(o.contactId)}">Open in CRM</a>` : ''}
            ${o.status === 'cancelled' ? '<button data-act="reopen">Reopen</button>' : '<button data-act="cancel" class="danger">Cancel order</button>'}
          </div></details>` : `
          <select class="c-input crm-select hs-act" data-act="stripe-status">
            ${['needs-address', 'new', 'shipped', 'done'].map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>`}
      </div>
    </div>
  </div>`;
}

function renderOrderList() {
  const f = FILTERS.find((x) => x.key === state.filter) || FILTERS[0];
  const rows = state.orders.filter((o) => !f.buckets || f.buckets.includes(orderBucket(o)));
  // Work queue order: money first, then addresses, then shipping, oldest first.
  if (f.key === 'open') {
    const rank = { collect: 0, address: 1, ship: 2 };
    const due = (o) => (reminderDue(o, state.settings) ? 0 : 1);
    rows.sort((a, b) => (rank[orderBucket(a)] - rank[orderBucket(b)]) || (due(a) - due(b)) || ((a.createdAtMs || 0) - (b.createdAtMs || 0)));
  }
  const list = $('hs-list');
  list.innerHTML = rows.length ? rows.map(orderCardHtml).join('')
    : `<div class="hs-empty">${f.key === 'open' ? 'Nothing waiting on you. When someone orders in a DM, hit <b>+ New order</b>.' : 'Nothing here.'}</div>`;
  list.querySelectorAll('[data-act]').forEach((el) => {
    const evt = el.tagName === 'SELECT' ? 'change' : 'click';
    el.addEventListener(evt, (e) => {
      const card = el.closest('[data-id]');
      const o = state.orders.find((x) => x.id === card.dataset.id);
      if (!o) return;
      e.preventDefault();
      const det = el.closest('details');
      if (det) det.open = false;
      onOrderAction(el.dataset.act, o, el);
    });
  });
}

async function refreshOrders() {
  await loadAll();
  renderSummary();
  renderFilters();
  renderOrderList();
  renderInventory();
}

async function runAction(o, payload, okMsg) {
  try {
    await call('manageHandSale', { id: o.id, ...payload });
    toast(okMsg);
    await refreshOrders();
  } catch (e) {
    toast(errMsg(e), true);
  }
}

async function onOrderAction(act, o, el) {
  switch (act) {
    case 'copy-addr': return copy(addressLines(o.shipping).join('\n'), el);
    case 'copy-link': return copy(invoiceUrl(o), el);
    case 'copy-msg': return copy(invoiceMessage(o, invoiceUrl(o)), el);
    case 'copy-shipped': return copy(shippedMessage(o), el);
    case 'copy-review': return copy(reviewMessage(o, state.settings), el);
    case 'send': return openSendForm(o);
    case 'remind': return openSendForm(o, { reminder: true });
    case 'edit': return openOrderForm(o);
    case 'pay': return openPayForm(o);
    case 'ship': return openShipForm(o);
    case 'deliver': return runAction(o, { action: 'deliver' }, `${o.invoiceNumber} marked delivered.`);
    case 'review': {
      await copy(reviewMessage(o, state.settings), el);
      return runAction(o, { action: 'reviewed' }, 'Review ask copied. Paste it where you talk to them.');
    }
    case 'email': return runAction(o, { action: 'email' }, `Invoice emailed to ${o.buyer.email}.`);
    case 'unpay':
      if (!confirm(`Mark ${o.invoiceNumber} as unpaid?`)) return;
      return runAction(o, { action: 'unpay' }, `${o.invoiceNumber} marked unpaid.`);
    case 'cancel':
      if (!confirm(`Cancel ${o.invoiceNumber}? Any counted copies go back on the shelf.`)) return;
      return runAction(o, { action: 'cancel' }, `${o.invoiceNumber} cancelled.`);
    case 'reopen': return runAction(o, { action: 'reopen' }, `${o.invoiceNumber} reopened.`);
    case 'stripe-status':
      try {
        await updateDoc(doc(db, 'orders', o.id), { status: el.value, updatedAt: serverTimestamp() });
        o.status = el.value;
        renderSummary(); renderFilters();
        toast('Status saved.');
      } catch (e) { toast(errMsg(e), true); }
      return;
    default:
  }
}

// ─── Modal shell ──────────────────────────────────────────────────────────

function openModal(title, bodyHtml, { wide = false } = {}) {
  closeModal();
  const bd = document.createElement('div');
  bd.className = 'crm-modal-backdrop';
  bd.id = 'hs-modal';
  bd.innerHTML = `<div class="crm-modal card hs-modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="hs-modal-head"><h2>${esc(title)}</h2><button class="hs-x" data-close aria-label="Close">×</button></div>
    ${bodyHtml}
  </div>`;
  document.body.appendChild(bd);
  bd.addEventListener('click', (e) => { if (e.target === bd || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', escClose);
  return bd;
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() {
  const m = $('hs-modal');
  if (m) m.remove();
  document.removeEventListener('keydown', escClose);
}

// ─── New / edit order ─────────────────────────────────────────────────────

function itemRowHtml(it, i) {
  const options = state.products.map((p) => `<option value="${esc(p.id)}" ${it.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  return `<div class="hs-item" data-i="${i}">
    <select class="c-input crm-select" data-k="productId">${options}<option value="" ${!it.productId ? 'selected' : ''}>Custom item…</option></select>
    <input class="c-input" data-k="name" placeholder="Item name" value="${esc(it.productId ? '' : it.name || '')}" ${it.productId ? 'hidden' : ''}>
    <input class="c-input hs-qty" data-k="qty" type="number" min="1" step="1" value="${esc(it.qty || 1)}" aria-label="Quantity">
    <input class="c-input hs-price" data-k="unitPrice" type="number" min="0" step="0.01" value="${esc(it.unitPrice ?? '')}" aria-label="Price each">
    <button type="button" class="hs-x" data-rm="${i}" aria-label="Remove item">×</button>
  </div>`;
}

function openOrderForm(existing = null) {
  const o = existing || {};
  const s = state.settings;
  const book = state.products.find((p) => p.id === 'book-i-cant') || state.products.find((p) => p.type === 'book') || state.products[0];
  let items = (o.items && o.items.length ? o.items : [book ? { productId: book.id, name: book.name, qty: 1, unitPrice: defaultPrice(book) } : { productId: null, name: '', qty: 1, unitPrice: 0 }])
    .map((it) => ({ ...it }));
  const sh = o.shipping || { name: '', address: {} };
  const a = sh.address || {};
  const pay = o.payment || { status: 'unpaid' };
  const edit = !!existing;

  const bd = openModal(edit ? `Edit ${o.invoiceNumber}` : 'New hand sale', `
    <form class="crm-form" id="hs-form" novalidate>
      <div class="hs-sec">Buyer</div>
      <div class="crm-form-row-grid">
        <div class="crm-form-row"><label for="f-name">Name *</label><input class="c-input" id="f-name" required value="${esc(o.buyer && o.buyer.name)}" autocomplete="off"></div>
        <div class="crm-form-row"><label for="f-channel">Came in through</label><select class="c-input crm-select" id="f-channel">${opts(CHANNELS, o.channel || 'facebook')}</select></div>
        <div class="crm-form-row"><label for="f-handle">Profile / handle</label><input class="c-input" id="f-handle" placeholder="facebook.com/… or @handle" value="${esc(o.buyer && o.buyer.handle)}"></div>
        <div class="crm-form-row"><label for="f-email">Email (to email the invoice)</label><input class="c-input" id="f-email" type="email" value="${esc(o.buyer && o.buyer.email)}"></div>
        <div class="crm-form-row"><label for="f-phone">Phone</label><input class="c-input" id="f-phone" type="tel" value="${esc(o.buyer && o.buyer.phone)}"></div>
      </div>

      <div class="hs-sec">Items <span class="hs-dim">qty · price each</span></div>
      <div id="f-items"></div>
      <button type="button" class="btn btn-ghost hs-add" id="f-add">+ Add item</button>
      <div class="crm-form-row"><label for="f-sign">Signing note</label><input class="c-input" id="f-sign" placeholder="Sign it to… / message to write" value="${esc(o.giftMessage)}"></div>

      <div class="hs-sec">Delivery</div>
      <div class="hs-seg" id="f-delivery">
        <button type="button" data-v="ship" class="${o.delivery !== 'hand' ? 'on' : ''}">Ship it</button>
        <button type="button" data-v="hand" class="${o.delivery === 'hand' ? 'on' : ''}">Hand deliver / pickup</button>
      </div>
      <div id="f-ship" ${o.delivery === 'hand' ? 'hidden' : ''}>
        <div class="crm-form-row"><label for="f-paste">Paste the address from the chat</label>
          <textarea class="c-input" id="f-paste" rows="2" placeholder="Jane Doe&#10;123 Main St&#10;Dallas, TX 75201"></textarea></div>
        <div class="crm-form-row-grid">
          <div class="crm-form-row"><label for="f-sname">Ship to name</label><input class="c-input" id="f-sname" value="${esc(sh.name)}"></div>
          <div class="crm-form-row"><label for="f-l1">Street</label><input class="c-input" id="f-l1" value="${esc(a.line1)}"></div>
          <div class="crm-form-row"><label for="f-l2">Apt / suite</label><input class="c-input" id="f-l2" value="${esc(a.line2)}"></div>
          <div class="crm-form-row"><label for="f-city">City</label><input class="c-input" id="f-city" value="${esc(a.city)}"></div>
          <div class="crm-form-row"><label for="f-state">State</label><input class="c-input" id="f-state" maxlength="2" value="${esc(a.state)}"></div>
          <div class="crm-form-row"><label for="f-zip">ZIP</label><input class="c-input" id="f-zip" inputmode="numeric" value="${esc(a.postal_code)}"></div>
        </div>
        <div class="hs-dim" style="margin-top:6px;">No address yet? Leave it blank. The order waits in <b>Needs address</b> with a reminder.</div>
      </div>

      <div class="hs-sec">Money</div>
      <div class="crm-form-row-grid hs-three">
        <div class="crm-form-row" id="f-shipfee-row"><label for="f-shipfee">Shipping</label><input class="c-input" id="f-shipfee" type="number" min="0" step="0.01" value="${esc(edit ? o.shippingFee : s.defaultShipping)}"></div>
        <div class="crm-form-row"><label for="f-disc">Discount</label><input class="c-input" id="f-disc" type="number" min="0" step="0.01" value="${esc(o.discount || '')}" placeholder="0"></div>
        <div class="crm-form-row"><label for="f-tax">Sales tax</label><input class="c-input" id="f-tax" type="number" min="0" step="0.01" value="${esc(o.tax || '')}" placeholder="0"></div>
      </div>
      <div class="hs-seg" id="f-paystatus">
        <button type="button" data-v="unpaid" class="${pay.status === 'unpaid' ? 'on' : ''}">Send invoice</button>
        <button type="button" data-v="paid" class="${pay.status === 'paid' ? 'on' : ''}">Already paid</button>
        <button type="button" data-v="comp" class="${pay.status === 'comp' ? 'on' : ''}">Free / comp</button>
      </div>
      <div class="crm-form-row-grid" id="f-paid" ${pay.status === 'paid' ? '' : 'hidden'}>
        <div class="crm-form-row"><label for="f-method">Paid with</label><select class="c-input crm-select" id="f-method">${opts(PAYMENT_METHODS.filter((m) => m.key !== 'card' && (!m.legacy || m.key === pay.method)), pay.method || 'cash')}</select></div>
        <div class="crm-form-row"><label for="f-ref">Reference (optional)</label><input class="c-input" id="f-ref" placeholder="Check #, receipt…" value="${esc(pay.reference)}"></div>
      </div>
      <div class="hs-total" id="f-total"></div>

      <div class="crm-form-row"><label for="f-notes">Private notes</label><textarea class="c-input" id="f-notes" rows="2" placeholder="Only you see this">${esc(o.notes)}</textarea></div>
      ${!edit ? `<label class="hs-check" id="f-email-wrap" hidden><input type="checkbox" id="f-sendemail" checked> Email the invoice to them now</label>` : ''}

      <div class="hs-err" id="f-err"></div>
      <div class="crm-modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" id="f-save">${edit ? 'Save changes' : 'Create order'}</button>
      </div>
    </form>`, { wide: true });

  let delivery = o.delivery === 'hand' ? 'hand' : 'ship';
  let payStatus = pay.status || 'unpaid';

  const readItems = () => {
    bd.querySelectorAll('.hs-item').forEach((row) => {
      const it = items[Number(row.dataset.i)];
      it.productId = row.querySelector('[data-k=productId]').value || null;
      const p = state.products.find((x) => x.id === it.productId);
      it.name = p ? p.name : row.querySelector('[data-k=name]').value;
      it.qty = Number(row.querySelector('[data-k=qty]').value) || 0;
      it.unitPrice = Number(row.querySelector('[data-k=unitPrice]').value) || 0;
    });
  };

  const renderItems = () => {
    $('f-items').innerHTML = items.map(itemRowHtml).join('');
    $('f-items').querySelectorAll('.hs-item').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector('[data-k=productId]').addEventListener('change', (e) => {
        readItems();
        const p = state.products.find((x) => x.id === e.target.value);
        items[i].unitPrice = p ? defaultPrice(p) : 0;
        renderItems();
      });
      row.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => { readItems(); renderTotal(); }));
      row.querySelector('[data-rm]').addEventListener('click', () => {
        readItems();
        items.splice(i, 1);
        if (!items.length) items.push({ productId: null, name: '', qty: 1, unitPrice: 0 });
        renderItems();
      });
    });
    renderTotal();
  };

  const renderTotal = () => {
    const t = computeTotals({
      items,
      shippingFee: delivery === 'ship' ? Number($('f-shipfee').value) || 0 : 0,
      discount: Number($('f-disc').value) || 0,
      tax: Number($('f-tax').value) || 0
    });
    const stockWarn = items.filter((it) => it.productId && state.stock[it.productId])
      .map((it) => {
        const st = state.stock[it.productId];
        const held = edit ? ((o.items || []).filter((x) => x.productId === it.productId).reduce((n, x) => n + x.qty, 0)) : 0;
        const left = (Number(st.onHand) || 0) + held - it.qty;
        return left < 0 ? `Only ${(Number(st.onHand) || 0) + held} of ${esc(st.name || it.name)} on the shelf.` : '';
      }).filter(Boolean);
    $('f-total').innerHTML = `
      <div><span>Subtotal</span><span>${formatMoney(t.subtotal)}</span></div>
      ${t.shippingFee ? `<div><span>Shipping</span><span>${formatMoney(t.shippingFee)}</span></div>` : ''}
      ${t.discount ? `<div><span>Discount</span><span>−${formatMoney(t.discount)}</span></div>` : ''}
      ${t.tax ? `<div><span>Tax</span><span>${formatMoney(t.tax)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${formatMoney(t.total)}</span></div>
      ${stockWarn.length ? `<div class="hs-warn">${stockWarn.join(' ')}</div>` : ''}`;
  };

  const seg = (id, set) => $(id).querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    set(b.dataset.v);
    renderTotal();
  }));
  seg('f-delivery', (v) => { delivery = v; $('f-ship').hidden = v !== 'ship'; $('f-shipfee-row').hidden = v !== 'ship'; });
  seg('f-paystatus', (v) => { payStatus = v; $('f-paid').hidden = v !== 'paid'; });
  $('f-shipfee-row').hidden = delivery !== 'ship';

  $('f-add').addEventListener('click', () => {
    readItems();
    const p = book || state.products[0];
    items.push(p ? { productId: p.id, name: p.name, qty: 1, unitPrice: defaultPrice(p) } : { productId: null, name: '', qty: 1, unitPrice: 0 });
    renderItems();
  });
  ['f-shipfee', 'f-disc', 'f-tax'].forEach((id) => $(id).addEventListener('input', renderTotal));

  $('f-paste').addEventListener('input', () => {
    const p = parseAddress($('f-paste').value);
    const set = (id, v) => { if (v) $(id).value = v; };
    set('f-sname', p.name);
    set('f-l1', p.address.line1);
    set('f-l2', p.address.line2);
    set('f-city', p.address.city);
    set('f-state', p.address.state);
    set('f-zip', p.address.postal_code);
  });
  $('f-name').addEventListener('change', () => { if (!$('f-sname').value) $('f-sname').value = $('f-name').value; });
  const emailWrap = $('f-email-wrap');
  if (emailWrap) {
    const sync = () => { emailWrap.hidden = !$('f-email').value.trim() || payStatus !== 'unpaid'; };
    $('f-email').addEventListener('input', sync);
    $('f-paystatus').addEventListener('click', sync);
  }

  renderItems();

  $('hs-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    readItems();
    const order = {
      channel: $('f-channel').value,
      buyer: { name: $('f-name').value, email: $('f-email').value, phone: $('f-phone').value, handle: $('f-handle').value },
      items: items.map((it) => ({ productId: it.productId, name: it.name, qty: it.qty, unitPrice: it.unitPrice })),
      delivery,
      shipping: delivery === 'ship' ? {
        name: $('f-sname').value || $('f-name').value,
        address: { line1: $('f-l1').value, line2: $('f-l2').value, city: $('f-city').value, state: $('f-state').value, postal_code: $('f-zip').value, country: 'US' }
      } : null,
      shippingFee: Number($('f-shipfee').value) || 0,
      discount: Number($('f-disc').value) || 0,
      tax: Number($('f-tax').value) || 0,
      payment: { status: payStatus, method: payStatus === 'paid' ? $('f-method').value : null, reference: $('f-ref').value },
      giftMessage: $('f-sign').value,
      notes: $('f-notes').value
    };
    const btn = $('f-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    $('f-err').textContent = '';
    try {
      items.forEach((it) => { if (it.productId) { try { localStorage.setItem('hs-price:' + it.productId, String(it.unitPrice)); } catch (er) {} } });
      const res = await call('manageHandSale', edit
        ? { action: 'update', id: o.id, order }
        : { action: 'create', order, sendEmail: !!($('f-sendemail') && !$('f-email-wrap').hidden && $('f-sendemail').checked) });
      await refreshOrders();
      if (edit) { closeModal(); toast('Order saved.'); return; }
      showCreated(res);
    } catch (err) {
      $('f-err').textContent = errMsg(err);
      btn.disabled = false; btn.textContent = edit ? 'Save changes' : 'Create order';
    }
  });
  setTimeout(() => { if (!edit) $('f-name').focus(); }, 30);
}

function showCreated(res) {
  const o = state.orders.find((x) => x.id === res.id);
  if (!o) { closeModal(); return; }
  if (!isPaid(o)) {
    openSendForm(o, {
      title: `${o.invoiceNumber} created`,
      lead: `Send them the invoice. A reminder to collect ${formatMoney(o.amountTotal)} is in <a href="/tasks.html">Tasks</a>${res.emailed ? `, and the invoice was emailed to ${esc(o.buyer.email)}` : ''}.`
    });
    return;
  }
  openModal(`${o.invoiceNumber} created`, `
    <p class="hs-lead">Paid and on your list to ${o.delivery === 'hand' ? 'deliver' : 'ship'}. A reminder is in <a href="/tasks.html">Tasks</a>.</p>
    <div class="crm-modal-actions">
      <a class="btn btn-ghost" href="${esc(invoiceUrl(o))}" target="_blank" rel="noopener">Open invoice</a>
      <button class="btn btn-primary" data-close>Done</button>
    </div>`);
}

// ─── Send invoice ─────────────────────────────────────────────────────────
// Every way to get the invoice to the buyer, straight from the order card:
// a text from the CRM number (sendSms, so the consent gate and the
// conversation log are the CRM's own), a text or DM from Anthony's own
// device, email, or copy and paste. The message is editable first. With
// { reminder: true } it is the follow-up on an invoice that went unpaid.

const SENT_VIA = { sms: 'text', 'phone-text': 'text from your phone', messenger: 'Messenger', instagram: 'Instagram', email: 'email', manual: 'hand' };

function openSendForm(o, { title, lead, reminder = false } = {}) {
  const b = o.buyer || {};
  const dm = dmLink(o);
  const crmText = !!(o.companyId && o.contactId && b.phone);
  const phoneText = !!smsLink(b.phone, '');
  // Lead with the channel they ordered on.
  const want = { facebook: 'dm', instagram: 'dm', text: 'sms', phone: 'sms', email: 'email' }[o.channel];
  const offered = [dm && 'dm', crmText && 'sms', phoneText && 'phone', b.email && 'email'].filter(Boolean);
  const first = offered.includes(want) ? want : (want === 'sms' && offered.includes('phone') ? 'phone' : offered[0]);
  const cls = (k) => `btn ${k === first ? 'btn-primary' : 'btn-ghost'}`;
  const by = (via) => (SENT_VIA[via] ? ` by ${SENT_VIA[via]}` : '');
  const history = [
    o.invoiceSentAt && `Invoice sent ${day(o.invoiceSentAt)}${by(o.invoiceSentVia)}.`,
    o.remindedAt && `Last reminded ${day(o.remindedAt)}${by(o.remindedVia)}.`,
    o.viewedAt && `They opened it ${day(o.viewedAt)}.`
  ].filter(Boolean).join(' ');
  const quietDays = lastNudgeMs(o) ? Math.floor((Date.now() - lastNudgeMs(o)) / 86400000) : 0;
  const noun = reminder ? 'Reminder' : 'Invoice';

  const bd = openModal(title || `${reminder ? 'Remind' : 'Send'} ${o.invoiceNumber}`, `
    <div class="crm-form">
      ${lead ? `<p class="hs-lead">${lead}</p>` : `<p class="hs-lead">${esc(b.name || 'They')} owe${b.name ? 's' : ''} <b>${formatMoney(o.amountTotal)}</b>${reminder && quietDays ? `, quiet for ${quietDays} day${quietDays === 1 ? '' : 's'}` : ''}.${history ? ` ${esc(history)}` : ''}</p>`}
      <div class="crm-form-row"><label for="s-msg">Message</label>
        <textarea class="c-input" rows="7" id="s-msg">${esc((reminder ? reminderMessage : invoiceMessage)(o, invoiceUrl(o)))}</textarea></div>
      <div class="hs-err" id="s-err"></div>
      <div class="hs-send">
        ${dm ? `<button type="button" class="${cls('dm')}" data-send="dm">Copy &amp; open ${esc(dm.app)}</button>` : ''}
        ${crmText ? `<button type="button" class="${cls('sms')}" data-send="sms">Text from CRM number</button>` : ''}
        ${phoneText ? `<button type="button" class="${cls('phone')}" data-send="phone">Text from my phone</button>` : ''}
        ${b.email ? `<button type="button" class="${cls('email')}" data-send="email">Email ${esc(b.email)}</button>` : ''}
        <button type="button" class="btn btn-ghost" data-send="copy">Copy message</button>
        <button type="button" class="btn btn-ghost" data-send="link">Copy link only</button>
      </div>
      ${!reminder && !o.invoiceSentAt ? '<button type="button" class="hs-link" data-send="manual">Already sent it another way? Mark it sent</button>' : ''}
      ${offered.length ? '' : '<p class="hs-dim" style="margin:0;">Add a phone, email or Facebook profile to the order to send it from here.</p>'}
    </div>`);

  // Same rule sendSms enforces, read ahead so the button says why before a
  // click fails. The server still decides.
  if (crmText) {
    getDoc(doc(db, 'companies', o.companyId, 'contacts', o.contactId)).then((snap) => {
      const c = snap.exists() ? snap.data() : {};
      if (c.smsConsent === true && c.smsOptedOut !== true) return;
      const btn = bd.querySelector('[data-send="sms"]');
      if (!bd.isConnected || !btn) return;
      btn.disabled = true;
      btn.textContent = c.smsOptedOut === true ? 'CRM text: opted out' : 'CRM text: no consent on file';
      btn.title = 'Record SMS consent on their CRM record to text from the CRM number.';
      const alt = bd.querySelector('[data-send="phone"]');
      if (btn.classList.contains('btn-primary') && alt) {
        btn.classList.replace('btn-primary', 'btn-ghost');
        alt.classList.replace('btn-ghost', 'btn-primary');
      }
    }).catch(() => {});
  }

  const box = $('s-msg');
  const fail = (e, extra = '') => { $('s-err').innerHTML = esc(errMsg(e)) + extra; };
  const done = async (via, okMsg) => {
    closeModal();
    toast(okMsg);
    try {
      await call('manageHandSale', { action: 'sent', id: o.id, via, reminder });
      await refreshOrders();
    } catch (e) { toast(errMsg(e), true); }
  };

  bd.querySelectorAll('[data-send]').forEach((btn) => btn.addEventListener('click', async () => {
    const text = box.value.trim();
    $('s-err').textContent = '';
    if (!text && ['dm', 'sms', 'phone', 'copy'].includes(btn.dataset.send)) { fail(new Error('Write a message first.')); return; }
    switch (btn.dataset.send) {
      case 'copy': return copy(text, btn);
      case 'link': return copy(invoiceUrl(o), btn);
      case 'manual': return done('manual', `${o.invoiceNumber} marked sent. Remind lights up if it sits unpaid.`);
      case 'dm': {
        // m.me and ig.me cannot prefill a message, so it rides the clipboard.
        await copy(text);
        window.open(dm.url, '_blank', 'noopener');
        return done(dm.app === 'Instagram' ? 'instagram' : 'messenger', `Message copied. Paste it in ${dm.app} and send.`);
      }
      case 'phone':
        window.location.href = smsLink(b.phone, text);
        return done('phone-text', `Opened Messages with the ${noun.toLowerCase()}. Hit send there.`);
      case 'sms': {
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          await call('sendSms', { companyId: o.companyId, contactId: o.contactId, body: text });
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Text from CRM number';
          const consent = /consent|opted out/i.test(errMsg(e));
          fail(e, consent ? ` <a href="/contact.html?id=${encodeURIComponent(o.contactId)}" target="_blank" rel="noopener">Open their record</a>${phoneText ? ', or use Text from my phone.' : '.'}` : '');
          return;
        }
        return done('sms', `${noun} texted to ${b.name || b.phone}.`);
      }
      case 'email': {
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          await call('manageHandSale', { action: 'email', id: o.id, reminder });
        } catch (e) {
          btn.disabled = false; btn.textContent = `Email ${b.email}`;
          fail(e);
          return;
        }
        closeModal();
        toast(`${noun} emailed to ${b.email}.`);
        return refreshOrders();
      }
      default:
    }
  }));
  setTimeout(() => box.focus(), 30);
}

function openPayForm(o) {
  openModal(`Payment for ${o.invoiceNumber}`, `
    <form class="crm-form" id="p-form">
      <p class="hs-lead">${esc(o.buyer && o.buyer.name)} owes <b>${formatMoney(o.amountTotal)}</b>.</p>
      <div class="crm-form-row"><label for="p-method">Paid with</label><select class="c-input crm-select" id="p-method">${opts(PAYMENT_METHODS.filter((m) => !m.legacy), 'card')}</select></div>
      <div class="crm-form-row"><label for="p-ref">Reference (optional)</label><input class="c-input" id="p-ref" placeholder="Stripe receipt, check #…"></div>
      <div class="hs-err" id="p-err"></div>
      <div class="crm-modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Mark paid</button></div>
    </form>`);
  $('p-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    e.submitter && (e.submitter.disabled = true);
    try {
      await call('manageHandSale', { action: 'pay', id: o.id, method: $('p-method').value, reference: $('p-ref').value });
      closeModal();
      toast(`${o.invoiceNumber} paid. It moved to ${o.delivery === 'hand' ? 'deliver' : 'ship'}.`);
      await refreshOrders();
    } catch (err) {
      $('p-err').textContent = errMsg(err);
      e.submitter && (e.submitter.disabled = false);
    }
  });
}

function openShipForm(o) {
  const t = o.tracking || {};
  openModal(`Ship ${o.invoiceNumber}`, `
    <form class="crm-form" id="s-form">
      ${addressLines(o.shipping).length ? `<div class="hs-addr hs-addr-box">${addressLines(o.shipping).map(esc).join('<br>')}</div>` : ''}
      <div class="crm-form-row-grid">
        <div class="crm-form-row"><label for="s-carrier">Carrier</label>
          <select class="c-input crm-select" id="s-carrier">${['USPS', 'UPS', 'FedEx', 'Other'].map((c) => `<option ${t.carrier === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="crm-form-row"><label for="s-num">Tracking # (optional)</label><input class="c-input" id="s-num" value="${esc(t.number)}"></div>
      </div>
      <div class="hs-err" id="s-err"></div>
      <div class="crm-modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Mark shipped</button></div>
    </form>`);
  $('s-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('manageHandSale', { action: 'ship', id: o.id, carrier: $('s-carrier').value, number: $('s-num').value });
      const fresh = { ...o, tracking: { carrier: $('s-carrier').value, number: $('s-num').value } };
      closeModal();
      await copy(shippedMessage(fresh));
      toast(`${o.invoiceNumber} shipped. "On the way" message copied to paste in the chat.`);
      await refreshOrders();
    } catch (err) { $('s-err').textContent = errMsg(err); }
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────

function openSettings() {
  const s = state.settings;
  const f = (id, label, val, extra = '') => `<div class="crm-form-row"><label for="st-${id}">${label}</label><input class="c-input" id="st-${id}" value="${esc(val)}" ${extra}></div>`;
  openModal('Invoice & reminder settings', `
    <form class="crm-form" id="st-form">
      <div class="hs-sec">How buyers pay you</div>
      <p class="hs-dim" style="margin:0;">Through your connected Stripe account only. Every invoice link opens a secure Stripe checkout (card, Apple Pay, Google Pay), and the order marks itself paid when it clears.</p>
      <div class="hs-sec">On the invoice</div>
      <div class="crm-form-row-grid">
        ${f('businessName', 'Business name', s.businessName)}
        ${f('fromEmail', 'Contact email', s.fromEmail)}
        ${f('web', 'Website', s.web)}
        ${f('returnAddress', 'Return address (optional)', s.returnAddress)}
      </div>
      <div class="crm-form-row"><label for="st-invoiceNote">Note at the bottom</label><textarea class="c-input" id="st-invoiceNote" rows="2">${esc(s.invoiceNote)}</textarea></div>
      <div class="hs-sec">Defaults and reminders</div>
      <div class="crm-form-row-grid hs-three">
        ${f('defaultShipping', 'Default shipping $', s.defaultShipping, 'type="number" min="0" step="0.01"')}
        ${f('dueDays', 'Payment due (days)', s.dueDays, 'type="number" min="0" step="1"')}
        ${f('shipWithinDays', 'Ship within (days)', s.shipWithinDays, 'type="number" min="0" step="1"')}
        ${f('reviewAfterDays', 'Review ask after (days)', s.reviewAfterDays, 'type="number" min="0" step="1"')}
        ${f('lowStockAt', 'Low stock at', s.lowStockAt, 'type="number" min="0" step="1"')}
      </div>
      ${f('reviewUrl', 'Review link (Amazon)', s.reviewUrl)}
      <div class="hs-err" id="st-err"></div>
      <div class="crm-modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save settings</button></div>
    </form>`, { wide: true });
  $('st-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = {};
    Object.keys(DEFAULT_SETTINGS).forEach((k) => {
      const el = $('st-' + k);
      if (!el) return;
      out[k] = typeof DEFAULT_SETTINGS[k] === 'number' ? (el.value === '' ? DEFAULT_SETTINGS[k] : Number(el.value)) : el.value.trim();
    });
    try {
      await setDoc(doc(db, 'config', 'handSales'), { ...out, updatedAt: serverTimestamp() }, { merge: true });
      state.settings = mergeSettings(out);
      closeModal();
      toast('Settings saved.');
      renderSummary();
      renderInventory();
    } catch (err) { $('st-err').textContent = errMsg(err); }
  });
}

// ─── Inventory tab ────────────────────────────────────────────────────────

function renderInventory() {
  const body = $('inv-list');
  if (!body) return;
  const physical = state.products.filter((p) => p.type === 'book' || p.type === 'physical' || state.stock[p.id]);
  if (!physical.length) {
    body.innerHTML = '<div class="hs-empty">No books or physical products in the catalog yet. Add them in the Product editor.</div>';
    return;
  }
  body.innerHTML = physical.map((p) => {
    const st = state.stock[p.id];
    if (!st) {
      return `<div class="hs-inv untracked" data-pid="${esc(p.id)}">
        <div><div class="hs-order-who">${esc(p.name)}</div><div class="hs-dim">Not counting yet. Hand sales of this item won't draw down a count.</div></div>
        <button class="btn btn-primary hs-act" data-inv="start">Start counting</button>
      </div>`;
    }
    const low = lowStock(st.onHand, state.settings, st.reorderAt);
    const value = st.unitCost != null ? formatMoney((Number(st.onHand) || 0) * Number(st.unitCost)) : null;
    return `<div class="hs-inv ${low ? 'low' : ''}" data-pid="${esc(p.id)}">
      <div class="hs-inv-main">
        <div class="hs-inv-count">${Number(st.onHand) || 0}<span>on hand</span></div>
        <div>
          <div class="hs-order-who">${esc(p.name)}</div>
          <div class="hs-dim">Reorder at ${st.reorderAt != null ? st.reorderAt : state.settings.lowStockAt}${st.unitCost != null ? ` · ${formatMoney(st.unitCost)} each · ${value} on the shelf` : ''}</div>
          ${low ? '<div class="hs-missing">Running low. A reorder reminder is in Tasks.</div>' : ''}
        </div>
      </div>
      <div class="hs-actions">
        <button class="btn btn-primary hs-act" data-inv="receive">+ Received</button>
        <button class="btn btn-ghost hs-act" data-inv="adjust">Adjust</button>
        <button class="btn btn-ghost hs-act" data-inv="history">History</button>
      </div>
      <div class="hs-moves" hidden></div>
    </div>`;
  }).join('');
  body.querySelectorAll('[data-inv]').forEach((b) => b.addEventListener('click', () => {
    const pid = b.closest('[data-pid]').dataset.pid;
    const p = state.products.find((x) => x.id === pid);
    const act = b.dataset.inv;
    if (act === 'history') return toggleHistory(b.closest('[data-pid]'), pid);
    openStockForm(p, act);
  }));
}

async function toggleHistory(card, pid) {
  const box = card.querySelector('.hs-moves');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="hs-dim">Loading…</div>';
  try {
    const snap = await getDocs(query(collection(db, 'stock', pid, 'moves'), orderBy('at', 'desc'), limit(30)));
    box.innerHTML = snap.empty ? '<div class="hs-dim">No moves yet.</div>' : `<table class="data-table"><tbody>${snap.docs.map((d) => {
      const m = d.data();
      return `<tr><td>${day(m.at)}</td><td class="num">${m.delta > 0 ? '+' : ''}${m.delta}</td><td>${esc(labelFor(STOCK_REASONS, m.reason))}${m.invoiceNumber ? ` · ${esc(m.invoiceNumber)}` : ''}${m.note ? `<div class="hs-dim">${esc(m.note)}</div>` : ''}</td><td class="num">${m.onHandAfter}</td></tr>`;
    }).join('')}</tbody></table>`;
  } catch (e) { box.innerHTML = `<div class="hs-err">${esc(errMsg(e))}</div>`; }
}

function openStockForm(p, act) {
  const st = state.stock[p.id] || {};
  const title = act === 'start' ? `Start counting ${p.name}` : act === 'receive' ? `Received copies of ${p.name}` : `Adjust ${p.name}`;
  openModal(title, `
    <form class="crm-form" id="k-form">
      ${act === 'receive'
        ? `<div class="crm-form-row"><label for="k-n">How many came in?</label><input class="c-input" id="k-n" type="number" min="1" step="1" required></div>`
        : `<div class="crm-form-row"><label for="k-n">${act === 'start' ? 'How many do you have right now?' : 'Actual count on the shelf'}</label><input class="c-input" id="k-n" type="number" min="0" step="1" required value="${act === 'adjust' ? esc(st.onHand ?? '') : ''}"></div>
           ${act === 'adjust' ? `<div class="crm-form-row"><label for="k-reason">Why</label><select class="c-input crm-select" id="k-reason">${opts(STOCK_REASONS.filter((r) => ['adjust', 'giveaway', 'damaged'].includes(r.key)), 'adjust')}</select></div>` : ''}`}
      <div class="crm-form-row-grid">
        <div class="crm-form-row"><label for="k-reorder">Remind me to reorder at</label><input class="c-input" id="k-reorder" type="number" min="0" step="1" value="${esc(st.reorderAt ?? '')}" placeholder="${esc(state.settings.lowStockAt)}"></div>
        <div class="crm-form-row"><label for="k-cost">Your cost per copy</label><input class="c-input" id="k-cost" type="number" min="0" step="0.01" value="${esc(st.unitCost ?? '')}" placeholder="optional"></div>
      </div>
      <div class="crm-form-row"><label for="k-note">Note</label><input class="c-input" id="k-note" placeholder="${act === 'receive' ? 'Printer order #, box…' : 'optional'}"></div>
      <div class="hs-err" id="k-err"></div>
      <div class="crm-modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>
    </form>`);
  $('k-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = $('k-n').value;
    const payload = {
      productId: p.id,
      reason: act === 'receive' ? 'received' : act === 'adjust' ? $('k-reason').value : 'adjust',
      note: $('k-note').value,
      reorderAt: $('k-reorder').value,
      unitCost: $('k-cost').value
    };
    if (act === 'receive') payload.delta = Number(n);
    else payload.setTo = Number(n);
    try {
      await call('adjustStock', payload);
      closeModal();
      toast('Inventory updated.');
      await refreshOrders();
    } catch (err) { $('k-err').textContent = errMsg(err); }
  });
}

// ─── Entry ────────────────────────────────────────────────────────────────

export async function initHandSales() {
  $('hs-new').addEventListener('click', () => openOrderForm());
  $('hs-settings').addEventListener('click', openSettings);
  $('inv-settings').addEventListener('click', openSettings);
  try {
    await refreshOrders();
  } catch (e) {
    $('hs-list').innerHTML = `<div class="hs-err">${esc(errMsg(e))}</div>`;
  }
  // /manage-store.html?new=1 opens the form straight away (phone shortcut).
  if (new URLSearchParams(location.search).get('new') === '1') openOrderForm();
}
