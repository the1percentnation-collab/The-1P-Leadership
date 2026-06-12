// Manage Courses console — owner + company admins.
// Create/edit courses, flip status (live / coming-soon / inactive), set
// pricing, sale prices, and subscription billing, author module content
// (Quill editor → courses/{slug}/modules), and manage coupon codes.

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { COURSES } from './courses-registry.js';
import { loadCourses, getCourses, priceInfo } from './courses-data.js';

const $ = (id) => document.getElementById(id);

// Local copy — community.js (the usual export) drags in firebase-storage,
// which this console page doesn't need.
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${msg}</div></div>`;
}

function ok(el, msg) { el.innerHTML = `<div class="auth-ok">${msg}</div>`; }
function err(el, e) { el.innerHTML = `<div class="auth-error">${escapeHtml(e && e.message ? e.message : String(e))}</div>`; }

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

// Slugs whose lesson content is rendered from code (modules.js / icant-course.js).
const CODE_CONTENT_SLUGS = new Set(['1p-clc', 'icant']);

let _userEmail = null;
let _editingSlug = null;   // course being edited in the details form (null = new)
let _contentSlug = null;   // course whose content is open
let _modules = [];
let _editingModuleId = null;
let _quill = null;

// ─── Course list ──────────────────────────────────────────────────────────

async function refreshCourses() {
  await loadCourses({ force: true });
  const body = $('courses-body');
  const courses = getCourses({ includeInactive: true });
  if (courses.length === 0) {
    body.innerHTML = `<tr><td colspan="7" style="color:var(--gray-mid);">No courses yet.</td></tr>`;
    return;
  }
  body.innerHTML = courses.map((c) => {
    const p = priceInfo(c);
    const statusChip = {
      'live': '<span class="auth-ok" style="font-size:12px;">Live</span>',
      'coming-soon': '<span style="color:var(--gray-light); font-size:12px;">Coming soon</span>',
      'inactive': '<span style="color:var(--red); font-size:12px;">Inactive</span>',
      'bundle': '<span style="color:var(--gray-light); font-size:12px;">Bundle</span>'
    }[c.status] || escapeHtml(c.status || '—');
    const contentKind = (c.contentSource === 'firestore' || !CODE_CONTENT_SLUGS.has(c.slug))
      ? 'Editable' : 'Built-in';
    return `<tr>
      <td><b>${escapeHtml(c.title)}</b><br><span style="font-size:11px; color:var(--gray-mid);">${escapeHtml(c.slug)}</span></td>
      <td>${statusChip}</td>
      <td class="num">${escapeHtml(p.onSale ? p.originalLabel : (p.label || '—'))}</td>
      <td class="num">${p.onSale ? escapeHtml(p.label) : '—'}</td>
      <td>${p.isSubscription ? `Subscription${p.intervalSuffix}` : 'One-time'}</td>
      <td>${contentKind}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-ghost" data-edit="${escapeHtml(c.slug)}" style="padding:2px 8px; font-size:11px;">Details</button>
        <button class="btn btn-ghost" data-content="${escapeHtml(c.slug)}" style="padding:2px 8px; font-size:11px;">Content</button>
      </td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openCourseEditor(b.dataset.edit)));
  body.querySelectorAll('[data-content]').forEach((b) =>
    b.addEventListener('click', () => openContent(b.dataset.content)));
}

async function seedDefaults() {
  const out = $('seed-result');
  out.innerHTML = '<div style="color:var(--gray-light); font-size:12px;">Seeding…</div>';
  try {
    let wrote = 0;
    for (const c of COURSES) {
      const ref = doc(db, 'courses', c.slug);
      const snap = await getDoc(ref);
      if (snap.exists()) continue;
      await setDoc(ref, {
        slug: c.slug,
        title: c.title,
        short: c.short || null,
        subtitle: c.subtitle || null,
        eyebrow: c.eyebrow || null,
        status: c.status,
        price: typeof c.price === 'number' ? c.price : null,
        priceNote: c.priceNote || null,
        bundleHref: c.bundleHref || null,
        salePrice: null,
        pricing: { mode: 'one-time', interval: null },
        contentSource: CODE_CONTENT_SLUGS.has(c.slug) ? 'code' : 'firestore',
        sortOrder: COURSES.indexOf(c),
        updatedAt: serverTimestamp(),
        updatedBy: _userEmail
      });
      wrote++;
    }
    ok(out, wrote ? `Seeded ${wrote} course${wrote === 1 ? '' : 's'}.` : 'All built-in courses are already in the database.');
    await refreshCourses();
  } catch (e) { err(out, e); }
}

// ─── Course details editor ────────────────────────────────────────────────

function openCourseEditor(slug) {
  _editingSlug = slug || null;
  const c = slug ? getCourses({ includeInactive: true }).find((x) => x.slug === slug) : null;
  $('course-editor-card').style.display = 'block';
  $('course-editor-title').textContent = c ? `Edit: ${c.title}` : 'Add a new course';
  $('course-editor-result').innerHTML = '';

  $('f-title').value = c ? (c.title || '') : '';
  $('f-short').value = c ? (c.short || '') : '';
  $('f-slug').value = c ? c.slug : '';
  $('f-slug').disabled = !!c;
  $('f-subtitle').value = c ? (c.subtitle || '') : '';
  $('f-eyebrow').value = c ? (c.eyebrow || '') : '';
  $('f-pricenote').value = c ? (c.priceNote || '') : '';
  $('f-price').value = c && typeof c.price === 'number' ? c.price : '';
  $('f-saleprice').value = c && typeof c.salePrice === 'number' ? c.salePrice : '';
  $('f-status').value = c ? (c.status || 'coming-soon') : 'coming-soon';
  const mode = c && c.pricing && c.pricing.mode === 'subscription' ? 'subscription' : 'one-time';
  $('f-mode').value = mode;
  $('f-interval').disabled = mode !== 'subscription';
  $('f-interval').value = (c && c.pricing && c.pricing.interval) || 'month';
  $('f-sort').value = c && typeof c.sortOrder === 'number' ? c.sortOrder : getCourses({ includeInactive: true }).length;

  $('course-editor-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveCourse(e) {
  e.preventDefault();
  const out = $('course-editor-result');
  try {
    const title = $('f-title').value.trim();
    if (!title) throw new Error('Title is required.');
    const slug = _editingSlug || slugify($('f-slug').value.trim() || title);
    if (!slug) throw new Error('Could not derive a slug — set one explicitly.');

    const price = $('f-price').value === '' ? null : Number($('f-price').value);
    const salePrice = $('f-saleprice').value === '' ? null : Number($('f-saleprice').value);
    if (salePrice != null && price != null && salePrice >= price) {
      throw new Error('Sale price must be lower than the regular price.');
    }
    const mode = $('f-mode').value;

    const data = {
      slug,
      title,
      short: $('f-short').value.trim() || null,
      subtitle: $('f-subtitle').value.trim() || null,
      eyebrow: $('f-eyebrow').value.trim() || null,
      priceNote: $('f-pricenote').value.trim() || null,
      price,
      salePrice,
      // Clear the seeded display label so it always derives from `price`.
      priceLabel: null,
      status: $('f-status').value,
      pricing: { mode, interval: mode === 'subscription' ? $('f-interval').value : null },
      sortOrder: Number($('f-sort').value) || 0,
      updatedAt: serverTimestamp(),
      updatedBy: _userEmail
    };
    if (!_editingSlug) {
      data.contentSource = 'firestore';
      data.moduleCount = 0;
    }
    await setDoc(doc(db, 'courses', slug), data, { merge: true });
    ok(out, `Saved <b>${escapeHtml(title)}</b>.`);
    _editingSlug = slug;
    $('f-slug').disabled = true;
    await refreshCourses();
  } catch (e2) { err(out, e2); }
}

// ─── Content editor ───────────────────────────────────────────────────────

async function openContent(slug) {
  _contentSlug = slug;
  _editingModuleId = null;
  const c = getCourses({ includeInactive: true }).find((x) => x.slug === slug);
  $('content-card').style.display = 'block';
  $('module-editor').style.display = 'none';
  $('content-title').textContent = `Content: ${c ? c.title : slug}`;

  const isCode = c && c.contentSource !== 'firestore' && CODE_CONTENT_SLUGS.has(slug);
  $('content-note').innerHTML = isCode
    ? 'This course\'s lessons are built into the site code. Modules added here will <b>not</b> be shown — contact your developer to migrate it to the editor.'
    : 'Modules below are what enrolled students see. Drag order with ↑/↓, then edit each lesson.';
  $('btn-add-module').style.display = isCode ? 'none' : '';

  await refreshModules();
  $('content-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function refreshModules() {
  const list = $('modules-list');
  try {
    const snap = await getDocs(collection(db, 'courses', _contentSlug, 'modules'));
    _modules = snap.docs
      .map((d) => ({ id: Number(d.id), ...d.data() }))
      .sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id));
  } catch (e) {
    list.innerHTML = `<div class="auth-error">${escapeHtml(e.message || String(e))}</div>`;
    return;
  }
  if (_modules.length === 0) {
    list.innerHTML = `<div style="color:var(--gray-mid); font-size:13px;">No modules yet.</div>`;
    return;
  }
  list.innerHTML = `<table class="data-table"><tbody>` + _modules.map((m, i) => `
    <tr>
      <td class="num" style="width:36px;">${i + 1}</td>
      <td><b>${escapeHtml(m.title || `Module ${m.id}`)}</b>${m.subtitle ? `<br><span style="font-size:11px; color:var(--gray-mid);">${escapeHtml(m.subtitle)}</span>` : ''}</td>
      <td class="num">${escapeHtml(m.duration || '')}</td>
      <td style="white-space:nowrap; text-align:right;">
        <button class="btn btn-ghost" data-up="${i}" style="padding:2px 8px; font-size:11px;" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-ghost" data-down="${i}" style="padding:2px 8px; font-size:11px;" ${i === _modules.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn btn-ghost" data-edit-mod="${m.id}" style="padding:2px 8px; font-size:11px;">Edit</button>
        <button class="btn btn-ghost" data-del-mod="${m.id}" style="padding:2px 8px; font-size:11px; color:var(--red);">Delete</button>
      </td>
    </tr>
  `).join('') + `</tbody></table>`;

  list.querySelectorAll('[data-edit-mod]').forEach((b) =>
    b.addEventListener('click', () => openModuleEditor(Number(b.dataset.editMod))));
  list.querySelectorAll('[data-del-mod]').forEach((b) =>
    b.addEventListener('click', async () => {
      const m = _modules.find((x) => x.id === Number(b.dataset.delMod));
      if (!m) return;
      if (!confirm(`Delete module "${m.title || m.id}"? This cannot be undone.`)) return;
      await deleteDoc(doc(db, 'courses', _contentSlug, 'modules', String(m.id)));
      await syncModuleCount();
      await refreshModules();
    }));
  list.querySelectorAll('[data-up]').forEach((b) =>
    b.addEventListener('click', () => moveModule(Number(b.dataset.up), -1)));
  list.querySelectorAll('[data-down]').forEach((b) =>
    b.addEventListener('click', () => moveModule(Number(b.dataset.down), 1)));
}

async function moveModule(idx, dir) {
  const a = _modules[idx];
  const b = _modules[idx + dir];
  if (!a || !b) return;
  const aOrder = a.sortOrder ?? a.id;
  const bOrder = b.sortOrder ?? b.id;
  await Promise.all([
    setDoc(doc(db, 'courses', _contentSlug, 'modules', String(a.id)), { sortOrder: bOrder }, { merge: true }),
    setDoc(doc(db, 'courses', _contentSlug, 'modules', String(b.id)), { sortOrder: aOrder }, { merge: true })
  ]);
  await refreshModules();
}

async function syncModuleCount() {
  try {
    const snap = await getDocs(collection(db, 'courses', _contentSlug, 'modules'));
    await setDoc(doc(db, 'courses', _contentSlug), {
      moduleCount: snap.size,
      updatedAt: serverTimestamp(),
      updatedBy: _userEmail
    }, { merge: true });
  } catch (e) { console.warn('[manage-courses] moduleCount sync failed', e); }
}

function ensureQuill() {
  if (_quill) return _quill;
  // Quill is loaded globally from the CDN <script> tag in manage-courses.html.
  _quill = new window.Quill('#m-quill', {
    theme: 'snow',
    modules: {
      toolbar: [
        [{ header: [2, 3, false] }],
        ['bold', 'italic', 'underline'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['blockquote', 'link', 'image'],
        ['clean']
      ]
    }
  });
  return _quill;
}

function quillHtml() {
  const src = $('m-html');
  if (src.style.display !== 'none') return src.value;
  const q = ensureQuill();
  return typeof q.getSemanticHTML === 'function' ? q.getSemanticHTML() : q.root.innerHTML;
}

function openModuleEditor(moduleId) {
  const m = moduleId != null ? _modules.find((x) => x.id === moduleId) : null;
  _editingModuleId = m ? m.id : null;
  $('module-editor').style.display = 'block';
  $('module-editor-title').textContent = m ? `Edit: ${m.title || 'Module ' + m.id}` : 'New module';
  $('module-editor-result').innerHTML = '';
  $('m-title').value = m ? (m.title || '') : '';
  $('m-subtitle').value = m ? (m.subtitle || '') : '';
  $('m-pillar').value = m ? (m.pillar || '') : '';
  $('m-duration').value = m ? (m.duration || '') : '';
  $('m-taglabel').value = m ? (m.tagLabel || '') : '';

  const q = ensureQuill();
  const html = m ? (m.html || '') : '';
  q.setContents([]);
  if (html) q.clipboard.dangerouslyPasteHTML(html);
  const src = $('m-html');
  src.style.display = 'none';
  src.value = html;
  $('btn-html-toggle').textContent = 'Edit HTML source';
  $('module-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleHtmlSource() {
  const src = $('m-html');
  const quillBox = $('m-quill').parentElement;
  const q = ensureQuill();
  if (src.style.display === 'none') {
    src.value = typeof q.getSemanticHTML === 'function' ? q.getSemanticHTML() : q.root.innerHTML;
    src.style.display = 'block';
    quillBox.style.display = 'none';
    $('btn-html-toggle').textContent = 'Back to visual editor';
  } else {
    q.setContents([]);
    if (src.value) q.clipboard.dangerouslyPasteHTML(src.value);
    src.style.display = 'none';
    quillBox.style.display = 'block';
    $('btn-html-toggle').textContent = 'Edit HTML source';
  }
}

async function saveModule() {
  const out = $('module-editor-result');
  try {
    const title = $('m-title').value.trim();
    if (!title) throw new Error('Module title is required.');
    const id = _editingModuleId != null
      ? _editingModuleId
      : (_modules.reduce((mx, m) => Math.max(mx, m.id), 0) + 1);
    const existing = _modules.find((m) => m.id === id);
    await setDoc(doc(db, 'courses', _contentSlug, 'modules', String(id)), {
      id,
      title,
      subtitle: $('m-subtitle').value.trim() || null,
      pillar: $('m-pillar').value.trim() || null,
      duration: $('m-duration').value.trim() || null,
      tagLabel: $('m-taglabel').value.trim() || null,
      html: quillHtml(),
      sortOrder: existing ? (existing.sortOrder ?? id) : (_modules.length + 1),
      updatedAt: serverTimestamp(),
      updatedBy: _userEmail
    }, { merge: true });
    _editingModuleId = id;
    ok(out, 'Module saved.');
    await syncModuleCount();
    await refreshModules();
  } catch (e) { err(out, e); }
}

// ─── Coupons ──────────────────────────────────────────────────────────────

async function refreshCoupons() {
  const body = $('coupons-body');
  try {
    const snap = await getDocs(collection(db, 'coupons'));
    if (snap.empty) {
      body.innerHTML = `<tr><td colspan="6" style="color:var(--gray-mid);">No coupons yet.</td></tr>`;
      return;
    }
    body.innerHTML = snap.docs.map((d) => {
      const c = d.data();
      const discount = c.percentOff ? `${c.percentOff}% off` : (c.amountOff ? `$${c.amountOff} off` : '—');
      const expires = c.expiresAt && c.expiresAt.toDate ? c.expiresAt.toDate().toLocaleDateString() : '—';
      return `<tr>
        <td><b>${escapeHtml(d.id)}</b></td>
        <td>${escapeHtml(discount)}</td>
        <td>${escapeHtml(expires)}</td>
        <td>${c.active ? '<span class="auth-ok" style="font-size:12px;">Active</span>' : '<span style="color:var(--red); font-size:12px;">Disabled</span>'}</td>
        <td>${c.stripePromotionCodeId ? 'Synced ✓' : `<button class="btn btn-ghost" data-sync="${escapeHtml(d.id)}" style="padding:2px 8px; font-size:11px;">Sync to Stripe</button>`}</td>
        <td><button class="btn btn-ghost" data-toggle-coupon="${escapeHtml(d.id)}" style="padding:2px 8px; font-size:11px;">${c.active ? 'Disable' : 'Enable'}</button></td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-toggle-coupon]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ref = doc(db, 'coupons', b.dataset.toggleCoupon);
        const snap2 = await getDoc(ref);
        if (!snap2.exists()) return;
        await setDoc(ref, { active: !snap2.data().active }, { merge: true });
        await refreshCoupons();
      }));
    body.querySelectorAll('[data-sync]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'Syncing…';
        try {
          await httpsCallable(functions, 'syncCoupon')({ code: b.dataset.sync });
          await refreshCoupons();
        } catch (e) {
          alert(e.message || 'Sync failed. Is Stripe configured?');
          b.disabled = false;
          b.textContent = 'Sync to Stripe';
        }
      }));
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" style="color:var(--red);">${escapeHtml(e.message || String(e))}</td></tr>`;
  }
}

async function createCoupon(e) {
  e.preventDefault();
  const out = $('coupon-result');
  try {
    const code = $('cp-code').value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!code) throw new Error('Code is required.');
    const percentOff = $('cp-percent').value ? Number($('cp-percent').value) : null;
    const amountOff = $('cp-amount').value ? Number($('cp-amount').value) : null;
    if (!percentOff && !amountOff) throw new Error('Set either a % off or a $ off amount.');
    if (percentOff && amountOff) throw new Error('Use % off OR $ off, not both.');
    const expiresRaw = $('cp-expires').value;
    await setDoc(doc(db, 'coupons', code), {
      code,
      percentOff,
      amountOff,
      active: true,
      expiresAt: expiresRaw ? new Date(expiresRaw + 'T23:59:59') : null,
      createdAt: serverTimestamp(),
      createdBy: _userEmail
    });
    ok(out, `Coupon <b>${escapeHtml(code)}</b> created. Click "Sync to Stripe" to make it redeemable at checkout.`);
    $('coupon-form').reset();
    await refreshCoupons();
  } catch (e2) { err(out, e2); }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/manage-courses.html')); return; }
  _userEmail = u.email || u.uid;

  const info = await getRoleInfo(true);
  renderTopbar({ user: u, role: info.role, currentPage: null });
  if (!info.isAdmin) {
    gate(`You are signed in as <b>${escapeHtml(u.email || '')}</b> but this page requires an admin or owner account.`);
    return;
  }
  $('panel').style.display = 'block';

  $('btn-seed').addEventListener('click', seedDefaults);
  $('btn-add-course').addEventListener('click', () => openCourseEditor(null));
  $('btn-editor-cancel').addEventListener('click', () => { $('course-editor-card').style.display = 'none'; });
  $('course-editor-form').addEventListener('submit', saveCourse);
  $('f-mode').addEventListener('change', () => {
    $('f-interval').disabled = $('f-mode').value !== 'subscription';
  });
  $('f-title').addEventListener('input', () => {
    if (!_editingSlug && !$('f-slug').value) $('f-slug').placeholder = slugify($('f-title').value);
  });

  $('btn-add-module').addEventListener('click', () => openModuleEditor(null));
  $('btn-module-save').addEventListener('click', saveModule);
  $('btn-module-cancel').addEventListener('click', () => { $('module-editor').style.display = 'none'; });
  $('btn-html-toggle').addEventListener('click', toggleHtmlSource);

  $('coupon-form').addEventListener('submit', createCoupon);

  await refreshCourses();
  await refreshCoupons();
}

main();
