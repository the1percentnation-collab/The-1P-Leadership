// Manage Courses console — owner + company admins.
// Orchestrates the Kajabi-style course dashboard (cover-image cards), the
// per-course builder (course-builder.js), and the coupons manager
// (manage-coupons.js). Auth gating and the owner-claim bootstrap live here.

import { db, firebaseReady } from './firebase.js';
import { onAuthReady, bootstrapOwner } from './auth.js';
import { getRoleInfo, clearRoleCache } from './roles.js';
import { renderTopbar } from './topbar.js';
import {
  doc, getDoc, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { COURSES } from './courses-registry.js';
import { loadCourses, getCourses, priceInfo } from './courses-data.js';
import {
  initBuilder, openBuilder, builderHasUnsavedChanges, builderDiscardChanges, CODE_CONTENT_SLUGS
} from './course-builder.js';
import { initCoupons } from './manage-coupons.js';
import { openAiGeneratorModal } from './course-ai.js';

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

let _userEmail = null;
let _openSlug = null;

// ─── View router ────────────────────────────────────────────────────────────

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

// ─── Dashboard (Kajabi-style course cards) ──────────────────────────────────

const STATUS_OPTS = [
  ['live', 'Live'],
  ['coming-soon', 'Coming soon'],
  ['inactive', 'Inactive'],
  ['bundle', 'Bundle']
];

const STATUS_LABELS = { live: 'Live', 'coming-soon': 'Coming soon', inactive: 'Inactive', bundle: 'Bundle' };

function courseCardHtml(c) {
  const slug = escapeHtml(c.slug);
  const cur = c.status || 'coming-soon';
  const p = priceInfo(c);

  // The text mark is always rendered and the image sits on top of it, so a
  // cover URL that 404s degrades to the mark rather than a broken-image icon.
  const mark = `<div class="mc-card-cover-mark">${escapeHtml(c.short || c.title || c.slug)}</div>`;
  const cover = c.coverImage
    ? `${mark}<img src="${escapeHtml(c.coverImage)}" alt="" loading="lazy" onerror="this.remove()">`
    : mark;

  const price = p.label
    ? `<span class="mc-card-price">${p.onSale ? `<s>${escapeHtml(p.originalLabel)}</s>` : ''}${escapeHtml(p.label)}</span>`
    : `<span class="mc-card-price" style="color:var(--gray-mid); font-weight:400;">No price</span>`;

  const lessons = typeof c.moduleCount === 'number'
    ? `${c.moduleCount} lesson${c.moduleCount === 1 ? '' : 's'}`
    : '';

  const statusSel = `<select class="row-status status-${escapeHtml(cur)}" data-status="${slug}" title="Change status">` +
    STATUS_OPTS.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('') +
    `</select>`;

  return `
    <div class="mc-card" data-slug="${slug}">
      <div class="mc-card-cover" data-open="${slug}" title="Open the course builder">
        ${cover}
      </div>
      <div class="mc-card-body">
        <div class="mc-card-title" data-open="${slug}">${escapeHtml(c.title)}</div>
        <span class="mc-pill is-${escapeHtml(cur)} mc-card-status">${escapeHtml(STATUS_LABELS[cur] || cur)}</span>
        <div class="mc-card-slug">${slug}</div>
        <div class="mc-card-meta">
          ${price}
          ${lessons ? `<span>· ${escapeHtml(lessons)}</span>` : ''}
          ${p.isSubscription ? `<span>· ${p.intervalSuffix === '/yr' ? 'yearly' : 'monthly'}</span>` : ''}
        </div>
      </div>
      <div class="mc-card-actions">
        ${statusSel}
        <button class="btn btn-primary" data-open="${slug}" style="font-size:12px; padding:7px 14px;">Edit</button>
        <button class="btn btn-ghost" data-preview="${slug}" style="font-size:12px; padding:7px 12px;">Preview</button>
        <span style="flex:1;"></span>
        <span class="kebab" data-kebab>
          <button class="kebab-btn" type="button" aria-label="More actions" data-kebab-toggle>⋯</button>
          <span class="kebab-menu">
            <button type="button" data-landing="${slug}">Landing page ↗</button>
            <button type="button" class="kebab-danger" data-del-course="${slug}">Delete</button>
          </span>
        </span>
      </div>
    </div>`;
}

function renderDashboard() {
  const grid = $('courses-grid');
  const courses = getCourses({ includeInactive: true });
  if (courses.length === 0) {
    grid.innerHTML = `<div style="color:var(--gray-mid); grid-column:1/-1; padding:24px 0;">No courses yet — click <b>+ New course</b> to build your first one.</div>`;
    return;
  }
  grid.innerHTML = courses.map(courseCardHtml).join('');

  grid.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', (e) => { e.preventDefault(); openBuilderView(b.dataset.open); }));
  grid.querySelectorAll('[data-preview]').forEach((b) =>
    b.addEventListener('click', () => previewCourse(b.dataset.preview)));
  grid.querySelectorAll('[data-landing]').forEach((b) =>
    b.addEventListener('click', () =>
      window.open(`/course.html?course=${encodeURIComponent(b.dataset.landing)}`, '_blank', 'noopener')));
  grid.querySelectorAll('[data-del-course]').forEach((b) =>
    b.addEventListener('click', () => deleteCourse(b.dataset.delCourse)));
  grid.querySelectorAll('[data-status]').forEach((sel) =>
    sel.addEventListener('change', () => setCourseStatus(sel.dataset.status, sel.value)));
  grid.querySelectorAll('[data-kebab-toggle]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = b.closest('[data-kebab]');
      const wasOpen = menu.classList.contains('open');
      closeKebabs();
      if (!wasOpen) menu.classList.add('open');
    }));
}

async function refreshCourses() {
  await loadCourses({ force: true });
  renderDashboard();
}

// Close any open kebab menu (also wired to a document click in main()).
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
    if (_openSlug === slug) { _openSlug = null; showView('courses'); }
    await refreshCourses();
  } catch (e) {
    alert(`Could not delete course: ${e && e.message ? e.message : e}`);
  }
}

// Quick status flip from a dashboard card.
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

// Open the member course page in owner preview mode (bypasses status/enrollment
// gates for admins — see courses-page.js). New tab so the builder stays put.
function previewCourse(slug) {
  if (!slug) return;
  window.open(`courses.html?course=${encodeURIComponent(slug)}&preview=1`, '_blank', 'noopener');
}

// ─── New course modal ───────────────────────────────────────────────────────

function openNewCourseModal() {
  const root = $('modal-root');
  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal card">
        <h3 style="margin:0 0 14px;">New course</h3>
        <div class="crm-form">
          <div class="crm-form-row">
            <label for="nc-title">Course title</label>
            <input id="nc-title" type="text" placeholder="e.g. Mindset Foundations" autocomplete="off">
          </div>
          <div class="crm-form-row">
            <label for="nc-slug">URL slug</label>
            <input id="nc-slug" type="text" placeholder="auto from title" pattern="[a-z0-9-]+" autocomplete="off">
            <div class="mc-field-note" id="nc-slug-note">Course page will be /course.html?course=<b id="nc-slug-preview">…</b></div>
          </div>
          <div id="nc-result"></div>
          <div class="crm-modal-actions">
            <button class="btn btn-ghost" type="button" id="nc-cancel">Cancel</button>
            <button class="btn btn-primary" type="button" id="nc-create">Create course</button>
          </div>
        </div>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ''; };
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });
  $('nc-cancel').addEventListener('click', close);

  const titleEl = $('nc-title');
  const slugEl = $('nc-slug');
  const updateSlugPreview = () => {
    const s = slugify(slugEl.value.trim() || titleEl.value.trim()) || '…';
    $('nc-slug-preview').textContent = s;
  };
  titleEl.addEventListener('input', updateSlugPreview);
  slugEl.addEventListener('input', updateSlugPreview);
  titleEl.focus();

  $('nc-create').addEventListener('click', async () => {
    const out = $('nc-result');
    try {
      const title = titleEl.value.trim();
      if (!title) throw new Error('Title is required.');
      const slug = slugify(slugEl.value.trim() || title);
      if (!slug) throw new Error('Could not derive a slug — set one explicitly.');
      if (getCourses({ includeInactive: true }).some((c) => c.slug === slug)) {
        throw new Error(`A course with the slug "${slug}" already exists.`);
      }
      const btn = $('nc-create');
      btn.disabled = true;
      btn.textContent = 'Creating…';
      await setDoc(doc(db, 'courses', slug), {
        slug,
        title,
        status: 'coming-soon',
        contentSource: 'firestore',
        moduleCount: 0,
        priceLabel: null,
        pricing: { mode: 'one-time', interval: null },
        sortOrder: getCourses({ includeInactive: true }).length,
        updatedAt: serverTimestamp(),
        updatedBy: _userEmail
      }, { merge: true });
      await refreshCourses();
      close();
      openBuilderView(slug);
    } catch (e) {
      err(out, e);
      const btn = $('nc-create');
      if (btn) { btn.disabled = false; btn.textContent = 'Create course'; }
    }
  });
}

// ─── Builder open/close ─────────────────────────────────────────────────────

async function openBuilderView(slug) {
  _openSlug = slug;
  showView('builder');
  await openBuilder(slug);
}

function backToDashboard() {
  if (builderHasUnsavedChanges() && !confirm('You have unsaved lesson changes. Leave anyway?')) return;
  builderDiscardChanges();
  _openSlug = null;
  showView('courses');
  refreshCourses();
}

// ─── Seeding ────────────────────────────────────────────────────────────────

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
        category: c.category || null,
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
// them into courses/icant/modules as editable lessons — the workbook and
// summary become structured fields (real tabs in the player), the rest of the
// lesson becomes rich-text html. Safe to re-run: setDoc merges by module id.

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

async function migrateIcantCore() {
  const { MODULES, ALIGN } = await import('./icant-course.js');
  let wrote = 0;
  for (const m of MODULES) {
    const align = (ALIGN && ALIGN[m.alignKey]) || { label: '' };
    const pillar = [m.chapterRef, align.label].filter(Boolean).join(' · ');
    const wb = m.workbook || null;
    await setDoc(doc(db, 'courses', 'icant', 'modules', String(m.id)), {
      id: m.id,
      title: m.title,
      subtitle: m.subtitle || null,
      pillar: pillar || null,
      duration: m.duration || null,
      tagLabel: m.alignKey || null,
      html: icantModuleToHtml(m, ALIGN),
      videoUrl: null,
      workbook: wb ? {
        reflection: wb.reflection || null,
        action: wb.action || null,
        prompts: Array.isArray(wb.prompts) ? wb.prompts : []
      } : null,
      summary: Array.isArray(m.summary) && m.summary.length ? m.summary : null,
      published: true,
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
  return wrote;
}

// Migrate the 1P Certified Leader Coach lessons (modules.js) into editable
// module docs. Each lesson's rendered HTML becomes the lesson body — minus the
// duplicated header, completion banners, and notes fields; the notes fields'
// prompts become real Workbook prompts (members answer them in the Workbook
// tab, autosaved, exactly like the I Can't course).
async function migrateClcCore() {
  const { MODULES } = await import('./modules.js');
  const { store } = await import('./store.js');
  try { await store.load(); } catch (e) { /* render() tolerates empty state */ }
  let wrote = 0;
  for (let i = 0; i < MODULES.length; i++) {
    const m = MODULES[i];
    const parsed = new DOMParser().parseFromString(m.render(), 'text/html');
    const body = parsed.body;
    body.querySelectorAll('.module-header, .completion-banner').forEach((el) => el.remove());
    const prompts = [];
    body.querySelectorAll('textarea[data-note-key]').forEach((ta) => {
      const p = (ta.getAttribute('placeholder') || '').trim();
      if (p) prompts.push(p);
      ta.remove();
    });
    await setDoc(doc(db, 'courses', '1p-clc', 'modules', String(m.id)), {
      id: m.id,
      title: m.title,
      subtitle: m.subtitle || null,
      pillar: m.pillar || null,
      duration: m.duration || null,
      tagLabel: m.tagLabel || null,
      html: body.innerHTML.trim(),
      videoUrl: null,
      workbook: prompts.length ? { reflection: null, action: null, prompts } : null,
      summary: null,
      published: true,
      sortOrder: i + 1,
      updatedAt: serverTimestamp(),
      updatedBy: _userEmail
    }, { merge: true });
    wrote++;
  }
  await setDoc(doc(db, 'courses', '1p-clc'), {
    contentSource: 'firestore',
    moduleCount: MODULES.length,
    updatedAt: serverTimestamp(),
    updatedBy: _userEmail
  }, { merge: true });
  return wrote;
}

const MIGRATABLE = {
  icant: { label: '"I Can’t: The Course"', run: migrateIcantCore },
  '1p-clc': { label: '"1P Certified Leader Coach"', run: migrateClcCore }
};

// Banner-triggered migration from inside the builder: migrate, then reopen the
// builder so the curriculum is immediately editable.
async function migrateCourseLessons(slug) {
  const mig = MIGRATABLE[slug];
  if (!mig) return;
  if (!confirm(`Copy ${mig.label}'s built-in lessons into the course builder? The course switches to render from the database and every lesson becomes editable here. Members see the same course; their progress tracking starts fresh. Safe to re-run.`)) return;
  try {
    await mig.run();
    await refreshCourses();
    await openBuilderView(slug);
  } catch (e) {
    alert(`Migration failed: ${e && e.message ? e.message : e}`);
  }
}

async function migrateIcant() {
  const out = $('seed-result');
  if (!confirm('Migrate "I Can’t: The Course" into the course builder? This copies its 8 lessons into the database (workbook + summary become editable tabs) and switches the live course to render from there. You can re-run it safely.')) return;
  showView('courses');
  out.innerHTML = '<div style="color:var(--gray-light); font-size:12px;">Migrating "I Can’t"…</div>';
  try {
    const wrote = await migrateIcantCore();
    ok(out, `Migrated ${wrote} lessons. "I Can’t: The Course" is now fully editable in the builder — including its Workbook and Summary tabs.`);
    await refreshCourses();
  } catch (e) { err(out, e); }
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
    t.addEventListener('click', () => {
      if ($('builder-view').style.display !== 'none' && builderHasUnsavedChanges()
        && !confirm('You have unsaved lesson changes. Leave anyway?')) return;
      builderDiscardChanges();
      showView(t.dataset.view);
    }));
  $('btn-builder-back').addEventListener('click', (e) => { e.preventDefault(); backToDashboard(); });
  // Close kebab menus on any outside click.
  document.addEventListener('click', closeKebabs);

  $('btn-seed').addEventListener('click', seedDefaults);
  $('btn-migrate-icant').addEventListener('click', migrateIcant);
  $('btn-add-course').addEventListener('click', openNewCourseModal);
  $('btn-ai-course').addEventListener('click', () => openAiGeneratorModal({
    userEmail: _userEmail,
    onDone: async (slug) => {
      await refreshCourses();
      await openBuilderView(slug);
    }
  }));

  initBuilder({
    userEmail: _userEmail,
    onCoursesChanged: renderDashboard,
    onDeleteCourse: deleteCourse,
    onMigrate: migrateCourseLessons
  });
  initCoupons({ userEmail: _userEmail });

  await refreshCourses();

  // Deep links: ?course=<slug> (primary) and ?content=<slug> (legacy alias,
  // linked from courses-page.js) open that course's builder; ?view=coupons
  // opens the coupons tab. Default view is the course dashboard.
  const params = new URLSearchParams(location.search);
  const deepSlug = params.get('course') || params.get('content');
  if (deepSlug && getCourses({ includeInactive: true }).some((c) => c.slug === deepSlug)) {
    await openBuilderView(deepSlug);
  } else if (params.get('view') === 'coupons') {
    showView('coupons');
  } else {
    showView('courses');
  }
}

main();
