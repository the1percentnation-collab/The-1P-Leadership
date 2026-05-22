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

import { COURSES, getActiveCourse } from './courses-registry.js';
import { MODULES, PILLARS } from './modules.js';
import { onAuthReady, currentUser } from './auth.js';
import { renderTopbar } from './topbar.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady } from './firebase.js';
import { getUserProfile, avatarHtml, escapeHtml } from './community.js';
import { store } from './store.js';
import { loadEnrollments, enrollInCourse, isEnrolled, enrolledCourses, availableCourses } from './enrollments.js';

const $ = (id) => document.getElementById(id);

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
    const pct = Math.round((completedCount / MODULES.length) * 100);
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
    const price = c.priceLabel ? `<div class="available-card-price">${escapeHtml(c.priceLabel)}</div>` : '';
    const priceNote = c.priceNote ? `<div class="available-card-pricenote">${escapeHtml(c.priceNote)}</div>` : '';
    const action = isBundle
      ? `<a class="btn btn-primary available-bundle-link" href="${escapeHtml(c.bundleHref || '/bundle.html')}">See Bundle Deal →</a>`
      : isLive
        ? `<button class="btn btn-primary available-enroll" data-slug="${escapeHtml(c.slug)}">Enroll${c.priceLabel ? ' · ' + escapeHtml(c.priceLabel) : ''} →</button>`
        : `<button class="btn btn-ghost" disabled>Notify me when live</button>`;
    return `
      <div class="available-card ${isBundle ? 'is-bundle' : isLive ? '' : 'is-soon'}" data-slug="${escapeHtml(c.slug)}">
        <div class="available-card-top">
          ${statusBadge}
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

  slot.innerHTML = `
    <div class="academy-section-head">
      <h2>Course Library</h2>
      <span class="academy-section-meta">${available.length} courses · enroll to unlock</span>
    </div>
    <div class="available-grid">${cards}</div>
  `;

  slot.querySelectorAll('.available-enroll').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const slug = btn.dataset.slug;
      btn.disabled = true;
      btn.textContent = 'Enrolling…';
      try {
        await enrollInCourse(slug);
        // Reload to show the course in the sidebar + open its roadmap.
        location.assign(`/courses.html?course=${encodeURIComponent(slug)}`);
      } catch (err) {
        console.warn('[courses-page] enroll failed', err);
        btn.disabled = false;
        btn.textContent = 'Sign up →';
        alert(err.message || 'Could not enroll. Please try again.');
      }
    });
  });
}

function updateWelcomeCopy() {
  const hint = $('welcome-hint');
  const enrolled = enrolledCourses();
  if (!hint) return;
  hint.textContent = enrolled.length > 0
    ? '← Choose one of your courses from the sidebar to begin.'
    : '↓ Browse the available courses below and sign up to begin.';
}

// ─── Roadmap ─────────────────────────────────────────────────────────────

function roadmapHtml(course, { completedSet, currentId }) {
  // Currently 1P-CLC is the only live course. Pull its modules.
  const modules = MODULES.map((m) => ({
    id: m.id,
    title: m.title,
    subtitle: m.subtitle || '',
    pillar: m.pillar || '',
    duration: m.duration || '',
    tagLabel: m.tagLabel || ''
  }));

  const completedCount = completedSet.size;
  const pct = Math.round((completedCount / modules.length) * 100);

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

function renderRoadmap(course) {
  const slot = $('workspace-roadmap');
  if (!slot) return;
  const completedSet = store.completed || new Set();
  const currentId = typeof store.currentModule === 'number' ? store.currentModule : 0;
  slot.innerHTML = roadmapHtml(course, { completedSet, currentId });
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
        <a class="btn btn-primary" href="/courses.html">← Back to Course Library</a>
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

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html');
      return;
    }
  }

  // Load progress + enrollments before deciding what to render.
  try { await store.load(); } catch (e) {}
  try { await loadEnrollments(); } catch (e) {}

  const slug = courseSlug();
  const moduleId = moduleParam();
  const course = slug ? COURSES.find((c) => c.slug === slug) : null;

  // Always render welcome content + available courses in case we fall back to welcome.
  renderAvailableCourses();
  updateWelcomeCopy();

  if (!course) {
    renderSidebar(null);
    showWelcome();
  } else if (course.status !== 'live') {
    renderSidebar(null);
    renderComingSoon(course);
    showComingSoon();
  } else if (!isEnrolled(course.slug)) {
    // User landed on a course they aren't enrolled in — bounce back to welcome
    // and surface it in the Available list.
    renderSidebar(null);
    showWelcome();
  } else if (moduleId != null) {
    // Module view — mount the course workspace and start at the requested module.
    renderSidebar(course.slug);
    renderCourseHero(course);
    showModule();
    if (typeof course.mount === 'function') {
      try { await course.mount({ startAt: moduleId }); }
      catch (e) { console.warn('[courses-page] mount failed', e); }
    }
  } else {
    // Roadmap view — default landing for an enrolled course.
    renderSidebar(course.slug);
    renderRoadmap(course);
    showRoadmap();
  }

  // Shared header user chip.
  let role = null;
  let profile = null;
  try {
    if (firebaseReady && currentUser()) {
      const info = await getRoleInfo();
      role = info.role;
      try { profile = await getUserProfile(currentUser().uid); } catch (e) {}
    }
  } catch (e) {}
  // courses.html has its own primary nav (academy-tabs); chip carries
  // only the bell + avatar + sign-out so we don't duplicate the nav.
  renderTopbar({ user: currentUser(), profile, role, currentPage: null, links: [] });
}

main();
