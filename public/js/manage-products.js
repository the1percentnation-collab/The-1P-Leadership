// Admin: Products & Launches — CRUD + demand dashboard. Admin/owner only.
//
// Every product carries the same publishing contract a course does (see
// catalog-core.js): a lifecycle status, a launch date for anything not yet
// open, a sale price with an optional end date, and two channel switches —
// Main site and Dashboard — that decide where it appears. The form reveals
// each control only when it applies, so a live product never shows a launch
// date and a draft never shows a sale.

import { firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import {
  PRODUCT_TYPES, PRODUCT_STATUSES, STATUS_LABELS,
  listAllProducts, createProduct, updateProduct, deleteProduct,
  listInterests, notifyLaunch, uploadProductImage, escapeHtml, fmtMoney
} from './products.js';
import { priceInfo } from './pricing.js';
import {
  launchDateMs, toDateInput, fmtLaunchDate, launchCountdown, hasLaunched
} from './launch-date.js';

const $ = (id) => document.getElementById(id);
const state = { products: [] };

// Statuses that are "not open yet" and so carry a launch date.
const PRELAUNCH = ['interest', 'preorder'];

function gate(msg) { $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${escapeHtml(msg)}</div></div>`; }

function statusBadge(s) {
  const color = { planned: '#A0A0A0', interest: '#5AA8E6', preorder: '#E8C547', live: '#56D4A8', archived: '#8B4A4A' }[s] || '#A0A0A0';
  return `<span class="crm-stage-badge" style="--stage-color:${color}">${escapeHtml(STATUS_LABELS[s] || s)}</span>`;
}

function saleBadge(p) {
  const info = priceInfo(p);
  if (!info.onSale) return '';
  const ends = info.saleEndsAtMs ? ` · ends ${fmtLaunchDate(info.saleEndsAtMs, { short: true })}` : '';
  return `<span class="crm-stage-badge" style="--stage-color:#E60306" title="On sale${escapeHtml(ends)}">On sale</span>`;
}

// What the launch date means for this product, in one line.
function launchNote(p) {
  const ms = launchDateMs(p);
  if (!PRELAUNCH.includes(p.status)) return '';
  if (ms == null) return 'No date set';
  if (hasLaunched(ms)) return 'Date passed — flips to Live on the next tick';
  return `${fmtLaunchDate(ms, { short: true })} · ${launchCountdown(ms)}`;
}

function toLocalDateTimeInput(ms) {
  if (!ms) return '';
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function channelSwitch(p, key, label, title) {
  const on = p[key] !== false;
  return `
    <label class="mc-switch" title="${escapeHtml(title)}">
      <input type="checkbox" data-channel="${key}" data-id="${escapeHtml(p.id)}"${on ? ' checked' : ''}>
      <span class="mc-switch-track"></span>
      <span>${escapeHtml(label)}</span>
    </label>`;
}

function render() {
  const totalInterest = state.products.reduce((s, p) => s + (p.interestCount || 0), 0);
  const potential = state.products.reduce((s, p) => s + (p.interestCount || 0) * (priceInfo(p).amount || 0), 0);
  const preorders = state.products.reduce((s, p) => s + (p.preorderCount || 0), 0);
  const deposits = state.products.reduce((s, p) => s + (Number(p.depositTotal) || 0), 0);

  $('demand-summary').innerHTML = `
    <div class="crm-widget crm-widget-accent"><div class="crm-widget-label">Total interested</div><div class="crm-widget-value">${totalInterest}</div></div>
    <div class="crm-widget"><div class="crm-widget-label">Potential revenue</div><div class="crm-widget-value">${fmtMoney(potential) || '$0'}</div><div class="crm-widget-sub">interest × current price</div></div>
    <div class="crm-widget"><div class="crm-widget-label">Pre-orders</div><div class="crm-widget-value">${preorders}</div></div>
    <div class="crm-widget"><div class="crm-widget-label">Deposits collected</div><div class="crm-widget-value">${fmtMoney(deposits) || '$0'}</div></div>
  `;

  const host = $('product-list');
  if (!state.products.length) {
    host.innerHTML = `<div class="card"><div class="crm-subpanel-empty">No products yet. Click “+ New Product” to add your first one.</div></div>`;
    return;
  }

  host.innerHTML = `<div class="card crm-list-card"><table class="data-table crm-list-table">
    <thead><tr><th>Product</th><th>Status</th><th>Price</th><th>Interested</th><th>Launches</th><th>Channels</th><th></th></tr></thead>
    <tbody>
    ${state.products.map((p) => {
      const info = priceInfo(p);
      const price = info.onSale
        ? `<s style="color:var(--gray-mid);">${escapeHtml(info.originalLabel)}</s> <b>${escapeHtml(info.label)}</b>`
        : (info.label ? escapeHtml(info.label) : '—');
      return `
      <tr>
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          <div class="crm-mini-sub">${escapeHtml(p.type || '')}${p.externalUrl ? ' · off-site link' : ''}</div>
        </td>
        <td>${statusBadge(p.status)} ${saleBadge(p)}</td>
        <td>${price}</td>
        <td>${p.interestCount || 0}</td>
        <td class="crm-mini-sub">${escapeHtml(launchNote(p)) || '—'}</td>
        <td style="white-space:nowrap;">
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${channelSwitch(p, 'showOnSite', 'Main site', 'Show on the public homepage and /upcoming')}
            ${channelSwitch(p, 'showInDashboard', 'Dashboard', 'Show in the member Store')}
          </div>
        </td>
        <td style="white-space:nowrap;text-align:right;">
          <button class="crm-chip" data-view="${escapeHtml(p.id)}">Interested</button>
          <button class="crm-chip" data-notify="${escapeHtml(p.id)}" title="${p.launchNotifiedAt ? 'Launch email already sent' : 'Email the interest list'}">Notify${p.launchNotifiedAt ? ' ✓' : ''}</button>
          <button class="crm-chip" data-edit="${escapeHtml(p.id)}">Edit</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;

  host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openModal(state.products.find((p) => p.id === b.getAttribute('data-edit')))));
  host.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => openInterestedModal(b.getAttribute('data-view'))));
  host.querySelectorAll('[data-channel]').forEach((cb) => cb.addEventListener('change', () => setChannel(cb)));
  host.querySelectorAll('[data-notify]').forEach((b) => b.addEventListener('click', async () => {
    const p = state.products.find((x) => x.id === b.getAttribute('data-notify'));
    if (!p) return;
    // The auto-trigger guards itself with launchNotifiedAt; this button did
    // not, so it could re-blast the whole list on every click. Say so first.
    const already = p.launchNotifiedAt && p.launchNotifiedAt.toDate
      ? `The launch email already went out on ${p.launchNotifiedAt.toDate().toLocaleDateString()}${p.launchNotifiedCount != null ? ` to ${p.launchNotifiedCount} people` : ''}.\n\nSend it again to `
      : 'Email ';
    if (!confirm(`${already}the ${p.interestCount || 0} interested people that "${p.name}" is available?`)) return;
    b.disabled = true; b.textContent = 'Sending…';
    try { const r = await notifyLaunch(p.id); alert(`Sent to ${r.sent || 0} people.`); await reload(); }
    catch (e) { alert('Could not send: ' + (e.message || e)); b.disabled = false; b.textContent = 'Notify'; }
  }));
}

// Channel switches save on change, without a re-render: the switch is its
// own indicator, and rebuilding the table mid-click makes it feel like it
// bounced. Same convention as the "On main site" switch on a course card.
async function setChannel(cb) {
  const id = cb.dataset.id;
  const key = cb.dataset.channel;
  const on = cb.checked;
  try {
    await updateProduct(id, { [key]: on });
    const p = state.products.find((x) => x.id === id);
    if (p) p[key] = on;
  } catch (e) {
    cb.checked = !on;
    alert(`Could not update: ${e.message || e}`);
  }
}

async function openInterestedModal(productId) {
  const root = $('modal-root');
  root.innerHTML = `<div class="crm-modal-backdrop" id="modal-bd"><div class="crm-modal auth-card"><h1>Interested</h1><div id="int-body">Loading…</div><div class="crm-modal-actions"><button class="btn btn-ghost" id="ic-close">Close</button></div></div></div>`;
  const close = () => { root.innerHTML = ''; };
  $('ic-close').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });
  const rows = await listInterests(productId);
  $('int-body').innerHTML = rows.length
    ? rows.map((r) => `<div class="crm-mini-row"><div class="crm-mini-main"><div class="crm-mini-title">${escapeHtml(r.name || r.email)}</div><div class="crm-mini-sub">${escapeHtml(r.email)}${r.phone ? ' · ' + escapeHtml(r.phone) : ''}${r.consent ? ' · opted-in' : ''}</div></div></div>`).join('')
    : '<div class="crm-subpanel-empty">No signups yet.</div>';
}

function openModal(product) {
  const editing = !!product;
  const p = product || {};
  const root = $('modal-root');
  const info = priceInfo(p);
  const launchMs = launchDateMs(p);

  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">
        <h1>${editing ? 'Edit' : 'New'} <span>Product</span></h1>
        <form id="p-form" class="crm-form">
          <div class="crm-form-row"><label>Name *</label><input class="c-input" id="p-name" required value="${escapeHtml(p.name || '')}" /></div>
          <div class="crm-form-row"><label>Summary (1 line)</label><input class="c-input" id="p-summary" value="${escapeHtml(p.summary || '')}" /></div>
          <div class="crm-form-row"><label>Description</label><textarea class="c-input" id="p-desc" rows="3">${escapeHtml(p.description || '')}</textarea></div>

          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Type</label><select class="c-input crm-select" id="p-type">${PRODUCT_TYPES.map((t) => `<option value="${t}" ${p.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="crm-form-row"><label>Status</label><select class="c-input crm-select" id="p-status">${PRODUCT_STATUSES.map((s) => `<option value="${s}" ${(p.status || 'planned') === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
          </div>

          <!-- Only meaningful before the product opens. Revealed by the status select. -->
          <div class="crm-form-row" id="p-launch-row"${PRELAUNCH.includes(p.status) ? '' : ' hidden'}>
            <label>Launches</label>
            <input class="c-input" id="p-launch" type="date" value="${escapeHtml(toDateInput(launchMs))}" style="max-width:220px;">
            <div class="crm-mini-sub" style="margin-top:6px;">Shown on the homepage banner, the badge and the member Store. When this date arrives the product flips to Live on its own and the interest list is emailed.</div>
          </div>

          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Price ($)</label><input class="c-input" id="p-price" type="number" min="0" step="0.01" value="${p.price != null ? p.price : ''}" /></div>
            <div class="crm-form-row"><label>Sort order</label><input class="c-input" id="p-sort" type="number" value="${p.sortOrder || 0}" /></div>
          </div>

          <div class="crm-form-row">
            <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="p-onsale" ${typeof p.salePrice === 'number' ? 'checked' : ''}>
              <span>On sale</span>
            </label>
            <div class="crm-form-row-grid" id="p-sale-fields"${typeof p.salePrice === 'number' ? '' : ' hidden'}>
              <div class="crm-form-row"><label>Sale price ($)</label><input class="c-input" id="p-saleprice" type="number" min="0" step="0.01" value="${typeof p.salePrice === 'number' ? p.salePrice : ''}" /></div>
              <div class="crm-form-row"><label>Sale ends (blank = open-ended)</label><input class="c-input" id="p-saleends" type="datetime-local" value="${escapeHtml(toLocalDateTimeInput(info.saleEndsAtMs))}" /></div>
            </div>
          </div>

          <div class="crm-form-row">
            <label>Channels</label>
            <div style="display:flex; gap:18px; flex-wrap:wrap; padding:4px 0;">
              <label class="mc-switch" title="Show on the public homepage and /upcoming"><input type="checkbox" id="p-site" ${p.showOnSite !== false ? 'checked' : ''}><span class="mc-switch-track"></span><span>Main site</span></label>
              <label class="mc-switch" title="Show in the member Store"><input type="checkbox" id="p-dash" ${p.showInDashboard !== false ? 'checked' : ''}><span class="mc-switch-track"></span><span>Dashboard</span></label>
            </div>
          </div>

          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Selling</label>
              <label style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;cursor:pointer;">
                <input type="checkbox" id="p-sellable" ${p.sellable ? 'checked' : ''}>
                <span>Buyable on the site (needs a price; Live or Pre-order)</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;cursor:pointer;">
                <input type="checkbox" id="p-shipping" ${p.requiresShipping != null ? (p.requiresShipping ? 'checked' : '') : (p.type === 'physical' ? 'checked' : '')}>
                <span>Collect a shipping address (physical goods)</span>
              </label>
            </div>
            <div class="crm-form-row"><label>Inventory (blank = untracked)</label><input class="c-input" id="p-inventory" type="number" min="0" value="${p.inventory != null ? p.inventory : ''}" /></div>
          </div>

          <div class="crm-form-row">
            <label>Off-site link (optional)</label>
            <input class="c-input" id="p-external" placeholder="https://a.co/… — buys happen there instead of Stripe" value="${escapeHtml(p.externalUrl || '')}" />
          </div>

          <div class="crm-form-row">
            <label>Cover image</label>
            <div class="p-img-uploader">
              <div class="p-img-preview" id="p-img-preview">${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="">` : '<span>No image</span>'}</div>
              <div class="p-img-controls">
                <label class="btn btn-ghost p-img-btn">Upload image<input type="file" id="p-image-file" accept="image/*" hidden></label>
                <span id="p-img-status" class="crm-save-status"></span>
                <input class="c-input" id="p-image" placeholder="…or paste an image URL" value="${escapeHtml(p.imageUrl || '')}" />
              </div>
            </div>
          </div>

          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Video (optional, homepage shop)</label><input class="c-input" id="p-video" placeholder="/assets/book.mp4" value="${escapeHtml(p.videoUrl || '')}" /></div>
            <div class="crm-form-row"><label>Video poster</label><input class="c-input" id="p-poster" placeholder="/assets/book-poster.jpg" value="${escapeHtml(p.posterUrl || '')}" /></div>
          </div>

          <div class="pre-modal-sub"><b>Draft</b> and <b>Archived</b> hide it everywhere. <b>Coming soon</b> and <b>Pre-order</b> show it with a Notify me button (Pre-order also sells, when Buyable is on). <b>Live</b> emails the interest list the first time it is set.</div>
          <div id="p-err" class="auth-error" style="display:none;"></div>
          <div class="crm-modal-actions">
            ${editing ? `<button type="button" class="btn btn-ghost" id="p-del" style="margin-right:auto;">Delete</button>` : ''}
            <button type="button" class="btn btn-ghost" id="p-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${editing ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ''; };
  $('p-cancel').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });
  if (editing) $('p-del').addEventListener('click', async () => {
    if (!confirm(`Delete "${p.name}"? This removes its interest list too.`)) return;
    await deleteProduct(p.id); close(); await reload();
  });

  // Reveal the launch date only while the status is one that has not opened.
  $('p-status').addEventListener('change', () => {
    $('p-launch-row').hidden = !PRELAUNCH.includes($('p-status').value);
  });
  $('p-onsale').addEventListener('change', () => {
    $('p-sale-fields').hidden = !$('p-onsale').checked;
  });

  // Image upload + preview (the #p-image text field stays the source of truth).
  const fileInput = $('p-image-file');
  const urlInput = $('p-image');
  const preview = $('p-img-preview');
  const imgStatus = $('p-img-status');
  const setPreview = (url) => { preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="">` : '<span>No image</span>'; };
  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { imgStatus.textContent = 'Pick an image file'; imgStatus.className = 'crm-save-status err'; return; }
    try { setPreview(URL.createObjectURL(f)); } catch (_) {}
    imgStatus.textContent = 'Uploading…'; imgStatus.className = 'crm-save-status';
    try {
      const url = await uploadProductImage(f);
      urlInput.value = url;
      setPreview(url);
      imgStatus.textContent = 'Uploaded ✓'; imgStatus.className = 'crm-save-status ok';
    } catch (err) {
      imgStatus.textContent = 'Upload failed: ' + (err.message || err); imgStatus.className = 'crm-save-status err';
    }
  });
  urlInput.addEventListener('input', () => setPreview(urlInput.value.trim()));

  $('p-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('p-status').value;
    const onSale = $('p-onsale').checked;
    const price = $('p-price').value;
    const salePrice = onSale ? $('p-saleprice').value : '';

    if (onSale) {
      if (salePrice === '' || price === '') { showErr('On sale needs both a price and a sale price.'); return; }
      if (Number(salePrice) >= Number(price)) { showErr('Sale price must be lower than the regular price.'); return; }
    }

    // Going Live is the one transition with a side effect — the interest
    // list gets an email — so it is confirmed rather than silent.
    const goingLive = status === 'live' && (p.status !== 'live');
    if (goingLive && !p.launchNotifiedAt && (p.interestCount || 0) > 0) {
      if (!confirm(`Setting "${p.name || $('p-name').value}" Live will email the ${p.interestCount} people on its waitlist. Continue?`)) return;
    }

    const data = {
      name: $('p-name').value, summary: $('p-summary').value || null, description: $('p-desc').value || null,
      type: $('p-type').value, status,
      price, sortOrder: $('p-sort').value, imageUrl: $('p-image').value || null,
      sellable: $('p-sellable').checked,
      requiresShipping: $('p-shipping').checked,
      inventory: $('p-inventory').value,
      launchDate: PRELAUNCH.includes(status) ? $('p-launch').value : null,
      salePrice: onSale ? salePrice : null,
      saleEndsAt: onSale ? $('p-saleends').value : null,
      showOnSite: $('p-site').checked,
      showInDashboard: $('p-dash').checked,
      externalUrl: $('p-external').value,
      videoUrl: $('p-video').value,
      posterUrl: $('p-poster').value
    };
    try {
      if (editing) await updateProduct(p.id, data); else await createProduct(data);
      close(); await reload();
    } catch (err) { showErr(err.message || String(err)); }
  });

  function showErr(msg) { $('p-err').textContent = msg; $('p-err').style.display = ''; }
}

async function reload() {
  state.products = await listAllProducts();
  render();
}

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/manage-products.html')); return; }
  const info = await getRoleInfo(true);
  renderTopbar({ user: u, role: info.role, currentPage: null });
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  $('panel').style.display = 'block';
  $('btn-new-product').addEventListener('click', () => openModal(null));
  await reload();
}
main();
