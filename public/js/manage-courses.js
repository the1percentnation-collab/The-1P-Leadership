// Manage Courses console — owner + company admins.
// Create/edit courses, flip status (live / coming-soon / inactive), set
// pricing, sale prices, and subscription billing, author module content
// (Quill editor → courses/{slug}/modules), and manage coupon codes.

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady, bootstrapOwner } from './auth.js';
import { getRoleInfo, clearRoleCache } from './roles.js';
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

// ─── View router ────────────────────────────────────────────────────────────
// Three top-level views live under #panel: the course list, the single-course
// builder, and the coupons manager. Only one shows at a time.

function showView(name) {
  const views = { courses: 'courses-view', builder: 'builder-view', coupons: 'coupons-view' };
  Object.entries(views).forEach(([key, id]) => {
    const el = $(id);
    if (el) el.style.display = key === name ? 'block' : 'none';
  });
  // The builder isn't a real tab — highlight Courses while it's open.
  const activeTab = name === 'coupons' ? 'coupons' : 'courses';
  document.querySelectorAll('.console-tab').forEach((t) =>
    t.classList.toggle('is-active', t.dataset.view === activeTab));
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// ─── Course list ──────────────────────────────────────────────────────────

async function refreshCourses() {
  await loadCourses({ force: true });
  const body = $('courses-body');
  const courses = getCourses({ includeInactive: true });
  if (courses.length === 0) {
    body.innerHTML = `<tr><td colspan="7" style="color:var(--gray-mid);">No courses yet.</td></tr>`;
    return;
  }
  const STATUS_OPTS = [
    ['live', 'Live'],
    ['coming-soon', 'Coming soon'],
    ['inactive', 'Inactive'],
    ['bundle', 'Bundle']
  ];
  body.innerHTML = courses.map((c) => {
    const p = priceInfo(c);
    const slug = escapeHtml(c.slug);
    const cur = c.status || 'coming-soon';
    const statusSel = `<select class="row-status status-${escapeHtml(cur)}" data-status="${slug}" title="Change status">` +
      STATUS_OPTS.map(([v, l]) =>
        `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('') +
      `</select>`;
    const basePrice = typeof c.price === 'number' ? c.price : '';
    const salePrice = typeof c.salePrice === 'number' ? c.salePrice : '';
    const priceInput = `<input class="row-num" type="number" min="0" step="0.01" data-price="${slug}" value="${basePrice}" placeholder="—" title="Regular price">`;
    const saleInput = `<input class="row-num" type="number" min="0" step="0.01" data-sale="${slug}" value="${salePrice}" placeholder="—" title="Sale price">`;

    const billingVal = p.isSubscription
      ? `subscription-${(c.pricing && c.pricing.interval) || 'month'}`
      : 'one-time';
    const billingSel = `<select class="row-status" data-billing="${slug}" title="Change billing">` +
      [['one-time', 'One-time'], ['subscription-month', 'Monthly'], ['subscription-year', 'Yearly']]
        .map(([v, l]) => `<option value="${v}"${v === billingVal ? ' selected' : ''}>${l}</option>`).join('') +
      `</select>`;

    const contentVal = (c.contentSource === 'firestore' || !CODE_CONTENT_SLUGS.has(c.slug))
      ? 'firestore' : 'code';
    const contentSel = `<select class="row-status" data-content="${slug}" title="Change content source">` +
      [['firestore', 'Editable'], ['code', 'Built-in']]
        .map(([v, l]) => `<option value="${v}"${v === contentVal ? ' selected' : ''}>${l}</option>`).join('') +
      `</select>`;
    return `<tr>
      <td><a href="#" class="course-open" data-open="${slug}" title="Open the course builder"><b>${escapeHtml(c.title)}</b></a><br><span style="font-size:11px; color:var(--gray-mid);">${escapeHtml(c.slug)}</span></td>
      <td>${statusSel}</td>
      <td class="num">${priceInput}</td>
      <td class="num">${saleInput}</td>
      <td>${billingSel}</td>
      <td>${contentSel}</td>
      <td style="text-align:right; white-space:nowrap;">
        <span class="kebab" data-kebab>
          <button class="kebab-btn" type="button" aria-label="More actions" data-kebab-toggle>⋯</button>
          <span class="kebab-menu">
            <button type="button" data-open="${slug}">Open builder</button>
            <button type="button" data-preview="${slug}">Preview</button>
            <button type="button" class="kebab-danger" data-del-course="${slug}">Delete</button>
          </span>
        </span>
      </td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', (e) => { e.preventDefault(); openBuilder(b.dataset.open); }));
  body.querySelectorAll('[data-preview]').forEach((b) =>
    b.addEventListener('click', () => previewCourse(b.dataset.preview)));
  body.querySelectorAll('[data-del-course]').forEach((b) =>
    b.addEventListener('click', () => deleteCourse(b.dataset.delCourse)));
  body.querySelectorAll('[data-status]').forEach((sel) =>
    sel.addEventListener('change', () => setCourseStatus(sel.dataset.status, sel.value)));
  body.querySelectorAll('[data-price]').forEach((inp) =>
    inp.addEventListener('change', () => setCoursePrice(inp.dataset.price, inp.value)));
  body.querySelectorAll('[data-sale]').forEach((inp) =>
    inp.addEventListener('change', () => setCourseSale(inp.dataset.sale, inp.value)));
  body.querySelectorAll('[data-billing]').forEach((sel) =>
    sel.addEventListener('change', () => setCourseBilling(sel.dataset.billing, sel.value)));
  body.querySelectorAll('[data-content]').forEach((sel) =>
    sel.addEventListener('change', () => setCourseContent(sel.dataset.content, sel.value)));
  body.querySelectorAll('[data-kebab-toggle]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = b.closest('[data-kebab]');
      const wasOpen = menu.classList.contains('open');
      closeKebabs();
      if (!wasOpen) menu.classList.add('open');
    }));
}

// Close any open row kebab menu (also wired to a document click in main()).
function closeKebabs() {
  document.querySelectorAll('[data-kebab].open').forEach((m) => m.classList.remove('open'));
}

// Owner-only hard delete of a course doc. Leaves the modules subcollection
// orphaned (Firestore can't cascade client-side); gated behind a confirm.
async function deleteCourse(slug) {
  if (!slug) return;
  const c = getCourses({ includeInactive: true }).find((x) => x.slug === slug);
  if (!confirm(`Delete "${c ? c.title : slug}"? This removes the course. This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, 'courses', slug));
    if (_editingSlug === slug) showView('courses');
    await refreshCourses();
  } catch (e) {
    alert(`Could not delete course: ${e && e.message ? e.message : e}`);
  }
}

// Quick status flip from the course list — Publish (live) / Unpublish (inactive) /
// Coming soon. Same write path as saveCourse(); reloads the table on success.
async function setCourseStatus(slug, status) {
  if (!slug) return;
  try {
    await setDoc(doc(db, 'courses', slug), {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: _userEmail
    }, { merge: true });
    await refreshCourses();
  } catch (e) {
    alert(`Could not update status: ${e && e.message ? e.message : e}`);
  }
}

// Shared merge-write for the inline list editors. Always stamps updatedAt/By.
async function writeCourseField(slug, fields, failMsg) {
  try {
    await setDoc(doc(db, 'courses', slug), {
      ...fields,
      updatedAt: serverTimestamp(),
      updatedBy: _userEmail
    }, { merge: true });
    await refreshCourses();
  } catch (e) {
    alert(`${failMsg}: ${e && e.message ? e.message : e}`);
    await refreshCourses();
  }
}

// Inline price edit from the course list. Clears the seeded priceLabel so the
// displayed price always derives from `price` (matches saveCourse()).
async function setCoursePrice(slug, raw) {
  const price = raw === '' ? null : Number(raw);
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    alert('Enter a valid price.');
    await refreshCourses();
    return;
  }
  const c = getCourses({ includeInactive: true }).find((x) => x.slug === slug);
  const sale = c && typeof c.salePrice === 'number' ? c.salePrice : null;
  if (price != null && sale != null && sale >= price) {
    alert('Regular price must be higher than the current sale price.');
    await refreshCourses();
    return;
  }
  await writeCourseField(slug, { price, priceLabel: null }, 'Could not update price');
}

// Inline sale-price edit. Empty clears the sale; otherwise must be below price.
async function setCourseSale(slug, raw) {
  const salePrice = raw === '' ? null : Number(raw);
  if (salePrice != null && (!Number.isFinite(salePrice) || salePrice < 0)) {
    alert('Enter a valid sale price.');
    await refreshCourses();
    return;
  }
  const c = getCourses({ includeInactive: true }).find((x) => x.slug === slug);
  const price = c && typeof c.price === 'number' ? c.price : null;
  if (salePrice != null && price != null && salePrice >= price) {
    alert('Sale price must be lower than the regular price.');
    await refreshCourses();
    return;
  }
  await writeCourseField(slug, { salePrice }, 'Could not update sale price');
}

// Inline billing edit — one-time vs subscription (monthly/yearly).
async function setCourseBilling(slug, value) {
  const mode = value.startsWith('subscription') ? 'subscription' : 'one-time';
  const interval = mode === 'subscription' ? value.split('-')[1] : null;
  await writeCourseField(slug, { pricing: { mode, interval } }, 'Could not update billing');
}

// Inline content-source edit — Editable (firestore) vs Built-in (code).
async function setCourseContent(slug, value) {
  const source = value === 'code' ? 'code' : 'firestore';
  if (source === 'firestore' && CODE_CONTENT_SLUGS.has(slug)) {
    if (!confirm('Switch this course to editable content? Its lessons will render from the database. If you haven’t migrated them yet, the course may appear empty until you add modules.')) {
      await refreshCourses();
      return;
    }
  }
  await writeCourseField(slug, { contentSource: source }, 'Could not update content source');
}

// Open the member course page in owner preview mode (bypasses status/enrollment
// gates for admins — see courses-page.js). New tab so the editor stays put.
function previewCourse(slug) {
  if (!slug) return;
  window.open(`courses.html?course=${encodeURIComponent(slug)}&preview=1`, '_blank', 'noopener');
}

function previewModule(slug, moduleId) {
  if (!slug) return;
  window.open(
    `courses.html?course=${encodeURIComponent(slug)}&module=${encodeURIComponent(moduleId)}&preview=1`,
    '_blank', 'noopener');
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

// ─── One-time content migration: "I Can't: The Course" ─────────────────────
// The icant course ships its 8 lessons in code (icant-course.js). This copies
// them into courses/icant/modules as editable rich-text lessons and flips the
// course to contentSource:'firestore' so it renders from — and is editable in —
// the database. Safe to re-run: setDoc merges by module id.

function icantModuleToHtml(m, ALIGN) {
  const e = escapeHtml;
  const align = (ALIGN && ALIGN[m.alignKey]) || { label: '' };
  const parts = [];
  parts.push(`<p>${e(m.welcome)}</p>`);
  if (m.coreTeaching) {
    parts.push(`<h2>${e(m.coreTeaching.headline)}</h2>`);
    parts.push('<ul>' + (m.coreTeaching.points || []).map((p) => `<li>${e(p)}</li>`).join('') + '</ul>');
  }
  if (m.alignIntegration) {
    parts.push(`<h2>A.L.I.G.N. — ${e(align.label)}</h2>`);
    parts.push(`<p>${e(m.alignIntegration.teaching)}</p>`);
  }
  if (m.workbook) {
    parts.push('<h2>Workbook</h2>');
    if (m.workbook.reflection) parts.push(`<p><strong>Reflection.</strong> ${e(m.workbook.reflection)}</p>`);
    if (m.workbook.action) parts.push(`<p><strong>Action.</strong> ${e(m.workbook.action)}</p>`);
    if (m.workbook.prompts && m.workbook.prompts.length) {
      parts.push('<ul>' + m.workbook.prompts.map((p) => `<li>${e(p)}</li>`).join('') + '</ul>');
    }
  }
  if (m.summary && m.summary.length) {
    parts.push('<h2>Key Takeaways</h2>');
    parts.push('<ul>' + m.summary.map((s) => `<li>${e(s)}</li>`).join('') + '</ul>');
  }
  if (m.bridge) {
    parts.push('<h2>What’s Next</h2>');
    parts.push(`<blockquote>${e(m.bridge)}</blockquote>`);
  }
  if (m.id === 1) {
    parts.push('<p><em>Companion book:</em> <a href="https://a.co/d/0fSUaomu" target="_blank" rel="noopener">I Can’t: Is Not A Strategy →</a></p>');
  }
  if (m.id === 8) {
    parts.push('<p><a href="https://a.co/d/0fSUaomu" target="_blank" rel="noopener">★ Leave an Amazon review →</a></p>');
  }
  return parts.join('\n');
}

async function migrateIcant() {
  const out = $('seed-result');
  if (!confirm('Migrate "I Can’t: The Course" into the editable content editor? This copies its 8 lessons into the database and switches the live course to render from there. You can re-run it safely.')) return;
  out.innerHTML = '<div style="color:var(--gray-light); font-size:12px;">Migrating "I Can’t"…</div>';
  try {
    const { MODULES, ALIGN } = await import('./icant-course.js');
    let wrote = 0;
    for (const m of MODULES) {
      const align = (ALIGN && ALIGN[m.alignKey]) || { label: '' };
      const pillar = [m.chapterRef, align.label].filter(Boolean).join(' · ');
      await setDoc(doc(db, 'courses', 'icant', 'modules', String(m.id)), {
        id: m.id,
        title: m.title,
        subtitle: m.subtitle || null,
        pillar: pillar || null,
        duration: m.duration || null,
        tagLabel: m.alignKey || null,
        html: icantModuleToHtml(m, ALIGN),
        sortOrder: m.id,
        updatedAt: serverTimestamp(),
        updatedBy: _userEmail
      }, { merge: true });
      wrote++;
    }
    await setDoc(doc(db, 'courses', 'icant'), {
      contentSource: 'firestore',
      moduleCount: MODULES.length,
      updatedAt: serverTimestamp(),
      updatedBy: _userEmail
    }, { merge: true });
    ok(out, `Migrated ${wrote} lessons. "I Can’t: The Course" is now editable — open its builder from the list and expand <b>Curriculum</b> — and the live course renders from the database.`);
    await refreshCourses();
  } catch (e) { err(out, e); }
}

// ─── Course builder ─────────────────────────────────────────────────────────
// One workspace per course: the details/pricing form, the curriculum editor,
// and publish controls, all in the drill-in builder view. `slug === null`
// opens a blank builder for a new course.

function openBuilder(slug) {
  _editingSlug = slug || null;
  _contentSlug = slug || null;
  const c = slug ? getCourses({ includeInactive: true }).find((x) => x.slug === slug) : null;

  showView('builder');
  $('builder-title').textContent = c ? `Building: ${c.title}` : 'Add a new course';
  fillDetailsForm(c);

  // Curriculum + publish only make sense once the course exists. For a new
  // (unsaved) course, collapse/hide them until the first save creates the doc.
  const isNew = !c;
  $('section-curriculum').style.display = isNew ? 'none' : '';
  $('section-publish').style.display = isNew ? 'none' : '';
  $('section-details').open = true;
  if (!isNew) openContent(slug);
}

function fillDetailsForm(c) {
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
    const wasNew = !_editingSlug;
    if (wasNew) {
      data.contentSource = 'firestore';
      data.moduleCount = 0;
    }
    await setDoc(doc(db, 'courses', slug), data, { merge: true });
    ok(out, `Saved <b>${escapeHtml(title)}</b>.`);
    _editingSlug = slug;
    $('f-slug').disabled = true;
    $('builder-title').textContent = `Building: ${title}`;
    await refreshCourses();
    // First save of a brand-new course: reveal the curriculum + publish
    // sections now that the course doc exists, and load its (empty) modules.
    if (wasNew) {
      $('section-curriculum').style.display = '';
      $('section-publish').style.display = '';
      await openContent(slug);
    }
  } catch (e2) { err(out, e2); }
}

// ─── Content editor ───────────────────────────────────────────────────────

async function openContent(slug) {
  _contentSlug = slug;
  _editingModuleId = null;
  const c = getCourses({ includeInactive: true }).find((x) => x.slug === slug);
  $('module-editor').style.display = 'none';

  const isCode = c && c.contentSource !== 'firestore' && CODE_CONTENT_SLUGS.has(slug);
  $('content-note').innerHTML = isCode
    ? 'This course\'s lessons are built into the site code. Modules added here will <b>not</b> be shown — contact your developer to migrate it to the editor.'
    : 'Modules below are what enrolled students see. Reorder with ↑/↓, then edit each lesson.';
  $('btn-add-module').style.display = isCode ? 'none' : '';

  await refreshModules();
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
        <button class="btn btn-ghost" data-preview-mod="${m.id}" style="padding:2px 8px; font-size:11px;">Preview</button>
        <button class="btn btn-ghost" data-edit-mod="${m.id}" style="padding:2px 8px; font-size:11px;">Edit</button>
        <button class="btn btn-ghost" data-del-mod="${m.id}" style="padding:2px 8px; font-size:11px; color:var(--red);">Delete</button>
      </td>
    </tr>
  `).join('') + `</tbody></table>`;

  list.querySelectorAll('[data-edit-mod]').forEach((b) =>
    b.addEventListener('click', () => openModuleEditor(Number(b.dataset.editMod))));
  list.querySelectorAll('[data-preview-mod]').forEach((b) =>
    b.addEventListener('click', () => previewModule(_contentSlug, Number(b.dataset.previewMod))));
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
  $('m-quill').parentElement.style.display = 'block';
  $('btn-html-toggle').textContent = 'Edit HTML source';
  resetPreview();
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

// ─── In-editor lesson preview ───────────────────────────────────────────────
// Renders the module being edited exactly as the live course renderer does
// (course-renderer.js): a .lesson-header + DOMPurify-sanitized .lesson-body.
// styles.css (loaded by this page) gives it the real lesson styling.

let _purify = null;
async function getPurify() {
  if (_purify) return _purify;
  const mod = await import('https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs');
  _purify = mod.default || mod;
  return _purify;
}

let _previewOn = false;
let _htmlWasOpen = false;

function resetPreview() {
  _previewOn = false;
  const box = $('m-preview');
  if (box) box.style.display = 'none';
  const btn = $('btn-preview-toggle');
  if (btn) btn.textContent = 'Preview';
}

async function togglePreview() {
  const box = $('m-preview');
  const quillBox = $('m-quill').parentElement;
  const src = $('m-html');
  const btn = $('btn-preview-toggle');
  if (!_previewOn) {
    const purify = await getPurify();
    const pillar = $('m-pillar').value.trim();
    const duration = $('m-duration').value.trim();
    const title = $('m-title').value.trim();
    const subtitle = $('m-subtitle').value.trim();
    const eyebrow = [pillar, duration].filter(Boolean).join(' · ');
    box.innerHTML =
      `<div class="lesson-header">` +
        (eyebrow ? `<div class="academy-eyebrow">${escapeHtml(eyebrow)}</div>` : '') +
        `<h1>${escapeHtml(title)}</h1>` +
        (subtitle ? `<p class="lesson-subtitle">${escapeHtml(subtitle)}</p>` : '') +
      `</div>` +
      `<div class="lesson-body">${purify.sanitize(quillHtml() || '', { USE_PROFILES: { html: true } })}</div>`;
    _htmlWasOpen = src.style.display !== 'none';
    quillBox.style.display = 'none';
    src.style.display = 'none';
    box.style.display = 'block';
    btn.textContent = 'Back to editor';
    _previewOn = true;
  } else {
    box.style.display = 'none';
    if (_htmlWasOpen) { src.style.display = 'block'; quillBox.style.display = 'none'; }
    else { quillBox.style.display = 'block'; src.style.display = 'none'; }
    btn.textContent = 'Preview';
    _previewOn = false;
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

  let info = await getRoleInfo(true);

  // The owner account may have role 'owner' in its Firestore user doc but lack the
  // `role=owner` custom claim that Firestore rules require for course writes. Without
  // the claim, this page would load but every Save/Publish would be permission-denied.
  // Auto-run the (email-validated, server-side) bootstrapOwner claim once, refresh the
  // token, and re-read role info so writes succeed. Failures never block the page.
  if (info.role === 'owner') {
    try {
      const tok = await u.getIdTokenResult();
      if (!tok.claims || tok.claims.role !== 'owner') {
        await bootstrapOwner();
        await u.getIdToken(true);
        clearRoleCache();
        info = await getRoleInfo(true);
      }
    } catch (e) { console.warn('[manage-courses] owner claim bootstrap skipped', e); }
  }

  renderTopbar({ user: u, role: info.role, currentPage: null });
  if (!info.isAdmin) {
    gate(`You are signed in as <b>${escapeHtml(u.email || '')}</b> but this page requires an admin or owner account.`);
    return;
  }
  $('panel').style.display = 'block';

  // Top-level tabs + builder back link.
  document.querySelectorAll('.console-tab').forEach((t) =>
    t.addEventListener('click', () => showView(t.dataset.view)));
  $('btn-builder-back').addEventListener('click', (e) => { e.preventDefault(); showView('courses'); });
  // Close row kebab menus on any outside click.
  document.addEventListener('click', closeKebabs);

  $('btn-seed').addEventListener('click', seedDefaults);
  const btnMigrateIcant = $('btn-migrate-icant');
  if (btnMigrateIcant) btnMigrateIcant.addEventListener('click', migrateIcant);
  $('btn-add-course').addEventListener('click', () => openBuilder(null));
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
  $('btn-preview-toggle').addEventListener('click', togglePreview);
  $('btn-preview-course').addEventListener('click', () => { if (_editingSlug) previewCourse(_editingSlug); });

  // Publish section — flips status on the open course, then reflects it in the
  // details form's Status select and refreshes the list behind the builder.
  const publish = (status) => builderSetStatus(status);
  $('btn-publish-live').addEventListener('click', () => publish('live'));
  $('btn-publish-soon').addEventListener('click', () => publish('coming-soon'));
  $('btn-publish-inactive').addEventListener('click', () => publish('inactive'));
  $('btn-delete-course').addEventListener('click', () => { if (_editingSlug) deleteCourse(_editingSlug); });

  $('coupon-form').addEventListener('submit', createCoupon);

  await refreshCourses();
  await refreshCoupons();

  // Deep links: ?course=<slug> (primary) and ?content=<slug> (legacy alias,
  // linked from courses-page.js) open that course's builder; ?view=coupons
  // opens the coupons tab. Default view is the course list.
  const params = new URLSearchParams(location.search);
  const deepSlug = params.get('course') || params.get('content');
  if (deepSlug && getCourses({ includeInactive: true }).some((c) => c.slug === deepSlug)) {
    openBuilder(deepSlug);
    $('section-curriculum').open = true;
  } else if (params.get('view') === 'coupons') {
    showView('coupons');
  } else {
    showView('courses');
  }
}

// Flip the open course's status from the Publish section.
async function builderSetStatus(status) {
  if (!_editingSlug) return;
  const out = $('publish-result');
  try {
    await setDoc(doc(db, 'courses', _editingSlug), {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: _userEmail
    }, { merge: true });
    $('f-status').value = status;
    const label = { live: 'Live', 'coming-soon': 'Coming soon', inactive: 'Inactive' }[status] || status;
    ok(out, `Status set to <b>${escapeHtml(label)}</b>.`);
    await refreshCourses();
  } catch (e) { err(out, e); }
}

main();
