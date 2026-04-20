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
import { onAuthReady, signOut, currentUser } from './auth.js';
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

// ─── Per-course data adapter ─────────────────────────────────────────────
//
// Each live course tracks progress with its own store + modules file. This
// helper centralises the lookup so renderSidebar / renderRoadmap can stay
// course-agnostic.

async function getCourseData(course) {
  if (!course) return { modules: [], completed: new Set(), currentId: 0 };
  if (course.slug === 'trust-process') {
    const [m, s] = await Promise.all([
      import('./trust-process-modules.js'),
      import('./trust-process-store.js')
    ]);
    try { await s.store.load(); } catch (e) {}
    return {
      modules: m.MODULES,
      completed: s.store.completed || new Set(),
      currentId: typeof s.store.currentModule === 'number' ? s.store.currentModule : 0
    };
  }
  if (course.slug === 'identity-producer') {
    const [m, s] = await Promise.all([
      import('./identity-producer-modules.js'),
      import('./identity-producer-store.js')
    ]);
    try { await s.store.load(); } catch (e) {}
    return {
      modules: m.MODULES,
      completed: s.store.completed || new Set(),
      currentId: typeof s.store.currentModule === 'number' ? s.store.currentModule : 0
    };
  }
  // Default: 1P-CLC (uses the globally imported MODULES + store).
  return {
    modules: MODULES,
    completed: store.completed || new Set(),
    currentId: typeof store.currentModule === 'number' ? store.currentModule : 0
  };
}

// ─── Sidebar ──────────────────────────────────────────────────────────────

function sidebarEntryHtml(course, { isActive, pct = null } = {}) {
  const href = `/courses.html?course=${encodeURIComponent(course.slug)}`;
  const chip = pct != null
    ? `<span class="course-entry-pct">${pct}%</span>`
    : '';
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

async function renderSidebar(activeSlug) {
  const list = $('courses-sidebar-list');
  if (!list) return;
  const enrolled = enrolledCourses();

  if (enrolled.length === 0) {
    list.innerHTML = `
      <div class="courses-sidebar-empty">
        <div class="courses-sidebar-empty-eyebrow">No courses yet</div>
        <p>Sign up for a course from the welcome panel to see it here.</p>
      </div>
    `;
    return;
  }

  // Resolve per-course pct in parallel — cheap because stores cache after first load.
  const pcts = await Promise.all(enrolled.map(async (c) => {
    if (c.status !== 'live') return null;
    const { modules, completed } = await getCourseData(c);
    if (!modules.length) return null;
    return Math.round((completed.size / modules.length) * 100);
  }));

  const entries = enrolled.map((c, i) => sidebarEntryHtml(c, {
    isActive: c.slug === activeSlug,
    pct: pcts[i]
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
    const isLive = c.status === 'live';
    const statusBadge = isLive
      ? `<span class="available-badge is-live">Available</span>`
      : `<span class="available-badge is-soon">Coming Soon</span>`;
    const price = c.priceLabel ? `<div class="available-card-price">${escapeHtml(c.priceLabel)}</div>` : '';
    const priceNote = c.priceNote ? `<div class="available-card-pricenote">${escapeHtml(c.priceNote)}</div>` : '';
    const action = isLive
      ? `<button class="btn btn-primary available-enroll" data-slug="${escapeHtml(c.slug)}">Enroll${c.priceLabel ? ' · ' + escapeHtml(c.priceLabel) : ''} →</button>`
      : `<button class="btn btn-ghost" disabled>Notify me when live</button>`;
    return `
      <div class="available-card ${isLive ? '' : 'is-soon'}" data-slug="${escapeHtml(c.slug)}">
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

function roadmapHtml(course, { modules: rawModules, completedSet, currentId }) {
  const modules = (rawModules || []).map((m) => ({
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
            <div><span class="roadmap-stat-val">${modules.length}</span><span class="roadmap-stat-lbl">${modules.length > 20 ? 'Lessons' : 'Modules'}</span></div>
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
  const { modules, completed, currentId } = await getCourseData(course);
  slot.innerHTML = roadmapHtml(course, { modules, completedSet: completed, currentId });
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
      <p>${escapeHtml(course.subtitle || 'This course is being built. Check back soon.')}</p>
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

// ─── User chip ────────────────────────────────────────────────────────────

function renderUserChip(user, role, profile) {
  const chip = $('user-chip');
  if (!chip) return;
  const adminLink = role === 'admin' || role === 'owner'
    ? `<a class="user-chip-link" href="/admin.html">Admin</a>` : '';
  const crmLink = role === 'admin' || role === 'owner'
    ? `<a class="user-chip-link" href="/crm.html">CRM</a>` : '';
  const campaignsLink = role === 'admin' || role === 'owner'
    ? `<a class="user-chip-link" href="/campaigns.html">Campaigns</a>` : '';
  const ownerLink = role === 'owner'
    ? `<a class="user-chip-link" href="/owner.html">Owner</a>` : '';
  const displayName = (profile && profile.displayName) || (user && (user.displayName || user.email)) || '';
  const avatar = user ? `<a href="/profile.html" class="c-avatar-link" title="Your profile">${avatarHtml({
    displayName,
    avatarUrl: profile && profile.avatarUrl || null
  }, 28)}</a>` : '';
  chip.innerHTML = `
    ${crmLink}${campaignsLink}${adminLink}${ownerLink}
    ${avatar}
    <span class="user-chip-email">${escapeHtml(displayName)}</span>
    <button class="btn btn-ghost" id="btn-signout">Sign out</button>
  `;
  const out = $('btn-signout');
  if (out) out.addEventListener('click', async () => {
    try { await signOut(); } catch (e) {}
    location.replace('/login.html');
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
    await renderSidebar(null);
    showWelcome();
  } else if (course.status !== 'live') {
    await renderSidebar(null);
    renderComingSoon(course);
    showComingSoon();
  } else if (!isEnrolled(course.slug)) {
    // User landed on a course they aren't enrolled in — bounce back to welcome
    // and surface it in the Available list.
    await renderSidebar(null);
    showWelcome();
  } else if (moduleId != null) {
    // Module view — mount the course workspace and start at the requested module.
    await renderSidebar(course.slug);
    renderCourseHero(course);
    showModule();
    if (typeof course.mount === 'function') {
      try { await course.mount({ startAt: moduleId }); }
      catch (e) { console.warn('[courses-page] mount failed', e); }
    }
  } else {
    // Roadmap view — default landing for an enrolled course.
    await renderSidebar(course.slug);
    await renderRoadmap(course);
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
  renderUserChip(currentUser(), role, profile);
}

main();
