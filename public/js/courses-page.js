// /courses.html orchestrator.
//
// Flow:
//   /courses.html               → welcome + "Available Courses" grid; sidebar
//                                 lists the user's enrolled courses only.
//   /courses.html?course=X      → roadmap for the enrolled course X. Click a
//                                 step to open that module.
//   /courses.html?course=X&module=N
//                               → opens module N of course X (actual lesson).
//
// Access gating: if X isn't in the user's enrollments, the welcome view
// is shown with a message. Nothing auto-opens; the user always chooses.

import { loadCourses, getCourseBySlug, priceInfo, loadModulesMeta } from './courses-data.js';
import { onAuthReady, currentUser } from './auth.js';
import { renderTopbar } from './topbar.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady, functions } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { getUserProfile, avatarHtml, escapeHtml } from './community.js';
import { store } from './store.js';
import { loadEnrollments, enrollInCourse, isEnrolled, enrolledCourses, availableCourses } from './enrollments.js';
import { getRefCode } from './referral.js';
import { ensureOnboarded } from './onboarding-guard.js';
import { db } from './firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

// Course slugs the current member has already joined the waitlist for.
const courseInterests = new Set();

async function loadCourseInterests() {
  courseInterests.clear();
  const user = currentUser();
  if (!firebaseReady || !user) return;
  try {
    const snap = await getDocs(collection(db, 'users', user.uid, 'courseInterests'));
    snap.forEach((d) => courseInterests.add(d.id));
  } catch (e) { /* non-fatal */ }
}

function urlParam(name) {
  const v = new URLSearchParams(location.search).get(name);
  return v == null ? null : v;
}

function courseSlug() { return urlParam('course'); }
function moduleParam() {
  const n = Number(urlParam('module'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ─── Sidebar ──────────────────────────────────────────────────────────────

function sidebarEntryHtml(course, { isActive, completedCount = 0 } = {}) {
  const href = `/courses.html?course=${encodeURIComponent(course.slug)}`;
  let chip = '';
  if (course.slug === '1p-clc') {
    const total = course.moduleCount || 7;
    const pct = Math.round((completedCount / total) * 100);
    chip = `<span class="course-entry-pct">${pct}%</span>`;
  }
  return `
    <div class="course-entry ${isActive ? 'active' : ''}" data-slug="${escapeHtml(course.slug)}">
      <a class="course-entry-head" href="${href}">
        <span class="course-entry-indicator"></span>
        <span class="course-entry-meta">
          <span class="course-entry-title">${escapeHtml(course.short || course.title)}</span>
          <span class="course-entry-sub">${escapeHtml(course.eyebrow || '')}</span>
        </span>
        ${chip}
      </a>
    </div>
  `;
}

function renderSidebar(activeSlug) {
  const list = $('courses-sidebar-list');
  if (!list) return;
  const enrolled = enrolledCourses();
  const completedCount = store.completed ? store.completed.size : 0;

  if (enrolled.length === 0) {
    list.innerHTML = `
      <div class="courses-sidebar-empty">
        <div class="courses-sidebar-empty-eyebrow">No courses yet</div>
        <p>Sign up for a course from the welcome panel to see it here.</p>
      </div>
    `;
    return;
  }

  const entries = enrolled.map((c) => sidebarEntryHtml(c, {
    isActive: c.slug === activeSlug,
    completedCount
  })).join('');

  list.innerHTML = entries + `
    <a class="courses-sidebar-browse" href="/courses.html">
      <span>+ Browse all courses</span>
    </a>
  `;
}

// ─── Welcome + Available Courses ─────────────────────────────────────────

function renderAvailableCourses() {
  const slot = $('welcome-available');
  if (!slot) return;

  const available = availableCourses();
  const enrolled = enrolledCourses();
  if (available.length === 0) {
    slot.innerHTML = enrolled.length > 0 ? `
      <div class="available-empty">You're enrolled in every course we offer. Keep going.</div>
    ` : '';
    return;
  }

  const cards = available.map((c) => {
    const isBundle = c.status === 'bundle';
    const isLive   = c.status === 'live';
    const statusBadge = isBundle
      ? `<span class="available-badge is-bundle">★ Best Value</span>`
      : isLive
        ? `<span class="available-badge is-live">Available</span>`
        : `<span class="available-badge is-soon">Coming Soon</span>`;
    const p = priceInfo(c);
    const saleBadge = p.onSale ? `<span class="available-badge is-sale">Sale</span>` : '';
    const price = p.label ? `
      <div class="available-card-price">
        ${p.onSale ? `<s class="available-card-price-was">${escapeHtml(p.originalLabel)}</s> ` : ''}${escapeHtml(p.label)}
      </div>` : '';
    const priceNote = c.priceNote ? `<div class="available-card-pricenote">${escapeHtml(c.priceNote)}</div>` : '';
    const enrollLabel = p.isFree
      ? 'Enroll Free →'
      : `Enroll${p.label ? ' · ' + escapeHtml(p.label) : ''} →`;
    const joined = courseInterests.has(c.slug);
    const action = isBundle
      ? `<a class="btn btn-primary available-bundle-link" href="${escapeHtml(c.bundleHref || '/bundle.html')}">See Bundle Deal →</a>`
      : isLive
        ? `<button class="btn btn-primary available-enroll" data-slug="${escapeHtml(c.slug)}">${enrollLabel}</button>`
        : `<button class="btn available-notify${joined ? ' is-joined' : ''}" data-slug="${escapeHtml(c.slug)}" data-title="${escapeHtml(c.title)}"${joined ? ' disabled' : ''}>${joined ? "✓ You're on the list" : 'Notify me when live'}</button>`;
    return `
      <div class="available-card ${isBundle ? 'is-bundle' : isLive ? '' : 'is-soon'}" data-slug="${escapeHtml(c.slug)}">
        <div class="available-card-top">
          ${statusBadge}${saleBadge}
          <span class="available-card-meta">${escapeHtml(c.eyebrow || '')}</span>
        </div>
        <div class="available-card-title">${escapeHtml(c.title)}</div>
        <div class="available-card-desc">${escapeHtml(c.subtitle || '')}</div>
        ${price}
        ${priceNote}
        <div class="available-card-actions">${action}</div>
      </div>
    `;
  }).join('');

  // With the sidebar gone, enrolled courses live here — above the library.
  const myCards = enrolled.map((c) => `
    <div class="available-card is-enrolled" data-slug="${escapeHtml(c.slug)}">
      <div class="available-card-top">
        <span class="available-badge is-live">Enrolled</span>
        <span class="available-card-meta">${escapeHtml(c.eyebrow || '')}</span>
      </div>
      <div class="available-card-title">${escapeHtml(c.title)}</div>
      <div class="available-card-desc">${escapeHtml(c.subtitle || '')}</div>
      <div class="available-card-actions">
        <a class="btn btn-primary" href="/courses.html?course=${encodeURIComponent(c.slug)}">Continue →</a>
      </div>
    </div>
  `).join('');
  const mySection = enrolled.length ? `
    <div class="academy-section-head">
      <h2>Your courses</h2>
      <span class="academy-section-meta">${enrolled.length} enrolled</span>
    </div>
    <div class="available-grid" style="margin-bottom:48px;">${myCards}</div>
  ` : '';

  slot.innerHTML = mySection + `
    <div class="academy-section-head">
      <h2>Course Library</h2>
      <span class="academy-section-meta">${available.length} courses · enroll to unlock</span>
    </div>
    <div class="available-grid">${cards}</div>
  `;

  // Card click (anywhere except a button/link) opens the course detail page.
  slot.querySelectorAll('.available-card').forEach((card) => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      location.assign(`/course.html?course=${encodeURIComponent(card.dataset.slug)}`);
    });
  });

  slot.querySelectorAll('.available-enroll').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const slug = btn.dataset.slug;
      const course = getCourseBySlug(slug);
      const p = course ? priceInfo(course) : { isFree: true };
      btn.disabled = true;
      btn.textContent = p.isFree ? 'Enrolling…' : 'Opening secure checkout…';
      try {
        if (p.isFree || !firebaseReady) {
          await enrollInCourse(slug);
          // Reload to show the course in the sidebar + open its roadmap.
          location.assign(`/courses.html?course=${encodeURIComponent(slug)}`);
        } else {
          const res = await httpsCallable(functions, 'createCheckoutSession')({
            slug,
            refCode: getRefCode() || undefined
          });
          const url = res && res.data && res.data.url;
          if (!url) throw new Error('Checkout could not be started.');
          location.assign(url);
        }
      } catch (err) {
        console.warn('[courses-page] enroll failed', err);
        btn.disabled = false;
        btn.textContent = 'Sign up →';
        alert(err.message || 'Could not enroll. Please try again.');
      }
    });
  });

  slot.querySelectorAll('.available-notify').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-joined')) return;
      const slug = btn.dataset.slug;
      const title = btn.dataset.title || slug;
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Adding you…';
      try {
        await httpsCallable(functions, 'registerCourseInterest')({ slug, title });
        courseInterests.add(slug);
        btn.classList.add('is-joined');
        btn.textContent = "✓ You're on the list";
      } catch (err) {
        console.warn('[courses-page] notify failed', err);
        btn.disabled = false;
        btn.textContent = prev;
        alert(err.message || 'Could not add you to the waitlist. Please try again.');
      }
    });
  });
}

function updateWelcomeCopy() {
  const hint = $('welcome-hint');
  const enrolled = enrolledCourses();
  if (!hint) return;
  hint.textContent = enrolled.length > 0
    ? '↓ Continue one of your courses below, or browse the library.'
    : '↓ Browse the available courses below and sign up to begin.';
}

// ─── Roadmap ─────────────────────────────────────────────────────────────

function roadmapHtml(course, { modules, completedSet, currentId }) {
  const completedCount = completedSet.size;
  const pct = modules.length ? Math.round((completedCount / modules.length) * 100) : 0;

  const stepsHtml = modules.map((m) => {
    const done = completedSet.has(m.id);
    const isCurrent = m.id === currentId && !done;
    const href = `/courses.html?course=${encodeURIComponent(course.slug)}&module=${m.id}`;
    const state = done ? 'is-done' : (isCurrent ? 'is-current' : 'is-todo');
    const marker = done ? '✓' : String(m.id).padStart(2, '0');
    const cta = done ? 'Review' : (isCurrent ? 'Continue →' : 'Open →');
    return `
      <a class="roadmap-step ${state}" href="${href}">
        <div class="roadmap-step-marker">${marker}</div>
        <div class="roadmap-step-body">
          <div class="roadmap-step-pillar">${escapeHtml(m.pillar)} · ${escapeHtml(m.duration)}</div>
          <div class="roadmap-step-title">${escapeHtml(m.title)}</div>
          <div class="roadmap-step-sub">${escapeHtml(m.subtitle)}</div>
        </div>
        <div class="roadmap-step-cta">${escapeHtml(cta)}</div>
      </a>
    `;
  }).join('');

  const nextId = (() => {
    for (let i = 0; i < modules.length; i++) {
      if (!completedSet.has(modules[i].id)) return modules[i].id;
    }
    return modules.length - 1;
  })();

  const primaryCtaText = completedCount === 0
    ? 'Start course →'
    : (completedCount === modules.length ? 'Review course →' : 'Continue where you left off →');

  return `
    <div class="roadmap-container">
      <header class="roadmap-hero">
        <div class="academy-eyebrow">${escapeHtml(course.eyebrow || 'Course Roadmap')}</div>
        <h1>${escapeHtml(course.title)}</h1>
        <p>${escapeHtml(course.subtitle || '')}</p>

        <div class="roadmap-hero-meta">
          <div class="progress-wrap roadmap-progress">
            <div class="progress-label">
              <span>Course Progress</span>
              <span>${pct}%</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          </div>
          <div class="roadmap-hero-stats">
            <div><span class="roadmap-stat-val">${completedCount}</span><span class="roadmap-stat-lbl">Done</span></div>
            <div><span class="roadmap-stat-val">${modules.length - completedCount}</span><span class="roadmap-stat-lbl">To go</span></div>
            <div><span class="roadmap-stat-val">${modules.length}</span><span class="roadmap-stat-lbl">Modules</span></div>
          </div>
        </div>

        <div class="roadmap-hero-cta">
          <a class="btn btn-primary" href="/courses.html?course=${encodeURIComponent(course.slug)}&module=${nextId}">${escapeHtml(primaryCtaText)}</a>
        </div>
      </header>

      <section class="roadmap-steps">
        <div class="academy-section-head">
          <h2>Your path</h2>
          <span class="academy-section-meta">${modules.length} steps · self-paced</span>
        </div>
        ${stepsHtml}
      </section>
    </div>
  `;
}

async function renderRoadmap(course) {
  const slot = $('workspace-roadmap');
  if (!slot) return;
  slot.innerHTML = '<div class="roadmap-container"><p style="color:var(--gray-mid);">Loading roadmap…</p></div>';

  const modules = await loadModulesMeta(course);

  // Progress: the shared store backs 1P-CLC; Firestore-rendered courses keep
  // their own namespaced progress docs (see course-renderer.js).
  let completedSet = new Set();
  let currentId = 0;
  if (course.contentSource === 'firestore') {
    try {
      const { loadCourseProgress } = await import('./course-renderer.js');
      completedSet = await loadCourseProgress(course.slug);
    } catch (e) {}
    currentId = modules.length ? modules[0].id : 0;
  } else if (course.slug === '1p-clc') {
    completedSet = store.completed || new Set();
    currentId = typeof store.currentModule === 'number' ? store.currentModule : 0;
  }

  if (modules.length === 0) {
    slot.innerHTML = `
      <div class="roadmap-container">
        <header class="roadmap-hero">
          <div class="academy-eyebrow">${escapeHtml(course.eyebrow || 'Course')}</div>
          <h1>${escapeHtml(course.title)}</h1>
          <p>${escapeHtml(course.subtitle || '')}</p>
          <p style="color:var(--gray-mid);">Course content is being prepared. Check back soon.</p>
        </header>
      </div>
    `;
    return;
  }

  slot.innerHTML = roadmapHtml(course, { modules, completedSet, currentId });
}

// ─── Workspace swap ───────────────────────────────────────────────────────

function showWelcome() {
  $('workspace-welcome').hidden = false;
  $('workspace-roadmap').hidden = true;
  $('workspace-live-content').hidden = true;
  $('workspace-coming-soon').hidden = true;
}
function showRoadmap() {
  $('workspace-welcome').hidden = true;
  $('workspace-roadmap').hidden = false;
  $('workspace-live-content').hidden = true;
  $('workspace-coming-soon').hidden = true;
}
function showModule() {
  $('workspace-welcome').hidden = true;
  $('workspace-roadmap').hidden = true;
  $('workspace-live-content').hidden = false;
  $('workspace-coming-soon').hidden = true;
}
function showComingSoon() {
  $('workspace-welcome').hidden = true;
  $('workspace-roadmap').hidden = true;
  $('workspace-live-content').hidden = true;
  $('workspace-coming-soon').hidden = false;
}

function renderComingSoon(course) {
  const slot = $('workspace-coming-soon');
  if (!slot) return;
  slot.innerHTML = `
    <div class="course-soon-card">
      <div class="academy-eyebrow">${escapeHtml(course.eyebrow || 'Coming Soon')}</div>
      <h2>${escapeHtml(course.title)}</h2>
      <p>${escapeHtml(course.subtitle || '')}</p>
      <p class="course-soon-payment-note">Enrollment opens soon — secure checkout is being set up. Check back shortly to register.</p>
      <div class="course-soon-actions">
        <a class="btn btn-primary" href="/course.html?course=${encodeURIComponent(course.slug)}">View course details →</a>
        <a class="btn btn-ghost" href="/courses.html">← Back to Course Library</a>
      </div>
    </div>
  `;
}

function renderCourseHero(course) {
  const eye = $('course-eyebrow');
  const title = $('course-title');
  const sub = $('course-subtitle');
  if (eye) eye.textContent = course.eyebrow || 'Course';
  if (title) title.textContent = course.title || '—';
  if (sub) sub.textContent = course.subtitle || '';
}

// ─── Owner preview banner ───────────────────────────────────────────────────

function renderPreviewBanner(course) {
  const main = $('courses-main');
  if (!main || $('owner-preview-banner')) return;
  const editLink = course.contentSource === 'firestore'
    ? `<a href="/manage-courses.html?content=${encodeURIComponent(course.slug)}" target="_blank" rel="noopener" style="color:#fff; text-decoration:underline;">✎ Edit content</a>`
    : '';
  const banner = document.createElement('div');
  banner.id = 'owner-preview-banner';
  banner.style.cssText = 'position:sticky; top:0; z-index:50; background:#b91c1c; color:#fff; ' +
    'padding:8px 16px; font-size:13px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;';
  banner.innerHTML =
    `<span>👁 Preview mode (owner) — members see this course as <b>${escapeHtml(course.status || '—')}</b>. ` +
    `This banner is only visible to you.</span>${editLink}` +
    `<a href="#" id="exit-preview" style="color:#fff; text-decoration:underline; margin-left:auto;">Exit preview</a>`;
  main.prepend(banner);
  const exit = $('exit-preview');
  if (exit) exit.addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.removeItem('1p_owner_preview');
    location.reload();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html');
      return;
    }
    if (!(await ensureOnboarded(user))) return;
  }

  // Load courses + progress + enrollments before deciding what to render.
  try { await loadCourses(); } catch (e) {}
  try { await store.load(); } catch (e) {}
  try { await loadEnrollments(); } catch (e) {}
  try { await loadCourseInterests(); } catch (e) {}

  // Owner/admin content preview: a session-scoped flag lets owner/admins view
  // any course (any status, even unenrolled) exactly as members will. Turned on
  // by ?preview=1 and persisted per-tab so roadmap→lesson navigation keeps it.
  let roleInfo = null;
  try { if (firebaseReady && currentUser()) roleInfo = await getRoleInfo(); } catch (e) {}
  const isAdmin = !!(roleInfo && roleInfo.isAdmin);
  if (urlParam('preview') === '1' && isAdmin) sessionStorage.setItem('1p_owner_preview', '1');
  const preview = isAdmin && sessionStorage.getItem('1p_owner_preview') === '1';

  const slug = courseSlug();
  const moduleId = moduleParam();
  const course = slug ? getCourseBySlug(slug, { includeInactive: preview }) : null;

  // Returning from Stripe checkout: the webhook writes the enrollment, which
  // can lag a moment behind the redirect. Poll briefly until it lands.
  if (urlParam('purchase') === 'success' && course && !isEnrolled(course.slug)) {
    for (let i = 0; i < 6 && !isEnrolled(course.slug); i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try { await loadEnrollments({ force: true }); } catch (e) {}
    }
  }

  // Always render welcome content + available courses in case we fall back to welcome.
  renderAvailableCourses();
  updateWelcomeCopy();

  if (!course) {
    renderSidebar(null);
    showWelcome();
  } else if (course.status !== 'live' && !preview) {
    renderSidebar(null);
    renderComingSoon(course);
    showComingSoon();
  } else if (!isEnrolled(course.slug) && !preview) {
    // User landed on a course they aren't enrolled in — bounce back to welcome
    // and surface it in the Available list.
    renderSidebar(null);
    showWelcome();
  } else if (moduleId != null) {
    // Module view — mount the course workspace and start at the requested module.
    renderSidebar(course.slug);
    renderCourseHero(course);
    showModule();
    try {
      // A course migrated to the editor (contentSource === 'firestore') always
      // renders via the generic Firestore-backed renderer, even if a code
      // `mount` still exists in the registry — the database is the source of truth.
      if (course.contentSource !== 'firestore' && typeof course.mount === 'function') {
        await course.mount({ startAt: moduleId });
      } else {
        // Courses authored in /manage-courses.html render via the generic
        // Firestore-backed renderer.
        const { mountFirestoreCourse } = await import('./course-renderer.js');
        await mountFirestoreCourse(course, { startAt: moduleId });
      }
    } catch (e) { console.warn('[courses-page] mount failed', e); }
  } else {
    // Roadmap view — default landing for an enrolled course.
    renderSidebar(course.slug);
    await renderRoadmap(course);
    showRoadmap();
  }

  // Owner preview banner (only the owner/admin sees this; members never do).
  if (preview && course) renderPreviewBanner(course);

  // Shared header user chip — reuse the role already fetched above.
  const role = roleInfo ? roleInfo.role : null;
  let profile = null;
  try {
    if (firebaseReady && currentUser()) {
      try { profile = await getUserProfile(currentUser().uid); } catch (e) {}
    }
  } catch (e) {}
  // courses.html has its own primary nav (academy-tabs); chip carries
  // only the bell + avatar + sign-out so we don't duplicate the nav.
  renderTopbar({ user: currentUser(), profile, role, currentPage: null, links: [] });
}

main();
