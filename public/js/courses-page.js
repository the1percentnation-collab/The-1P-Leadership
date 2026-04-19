// /courses.html orchestrator — Courses section landing + individual course runner.
//
//   No ?course param → render the library (welcome + course grid). Hide tab strip.
//   ?course=<slug>   → render the per-course tab strip and mount that course.

import { COURSES, getActiveCourse } from './courses-registry.js';
import { onAuthReady, signOut, currentUser } from './auth.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady } from './firebase.js';
import { getUserProfile, avatarHtml, escapeHtml } from './community.js';

const $ = (id) => document.getElementById(id);

function renderCourseTabs(activeSlug) {
  const strip = $('course-tabs-strip');
  if (!strip) return;

  const allCoursesTab = `
    <a class="course-tab course-tab-all" href="/courses.html" data-course="__library">
      <span class="course-tab-label">← All Courses</span>
    </a>
  `;

  const courseTabs = COURSES.map((c) => {
    const isActive = c.slug === activeSlug;
    const href = `/courses.html?course=${encodeURIComponent(c.slug)}`;
    const badge = c.status === 'coming-soon'
      ? `<span class="course-tab-badge">Soon</span>` : '';
    return `
      <a class="course-tab ${isActive ? 'active' : ''} ${c.status === 'coming-soon' ? 'is-soon' : ''}"
         href="${href}"
         data-course="${escapeHtml(c.slug)}">
        <span class="course-tab-label">${escapeHtml(c.short || c.title)}</span>
        ${badge}
      </a>
    `;
  }).join('');

  strip.innerHTML = allCoursesTab + courseTabs;
}

function renderLibrary() {
  const slot = $('workspace-library');
  if (!slot) return;

  const cards = COURSES.map((c) => {
    const isLive = c.status === 'live';
    const href = `/courses.html?course=${encodeURIComponent(c.slug)}`;
    const statusBadge = isLive
      ? `<span class="course-card-status is-live">Live</span>`
      : `<span class="course-card-status is-soon">Coming Soon</span>`;
    const cta = isLive
      ? `<span class="course-card-cta">Open course →</span>`
      : `<span class="course-card-cta is-soon">Coming Soon</span>`;
    const meta = c.eyebrow
      ? `<span class="course-card-meta">${escapeHtml(c.eyebrow)}</span>`
      : '';
    return `
      <a class="course-card ${isLive ? '' : 'is-soon'}" href="${href}">
        <div class="course-card-top">
          ${statusBadge}
          ${meta}
        </div>
        <div class="course-card-body">
          <div class="course-card-title">${escapeHtml(c.title)}</div>
          <div class="course-card-desc">${escapeHtml(c.subtitle || '')}</div>
        </div>
        ${cta}
      </a>
    `;
  }).join('');

  slot.innerHTML = `
    <div class="library-container">
      <section class="library-hero">
        <div class="academy-eyebrow">Course Library</div>
        <h1>Welcome to <span>the Academy</span>.</h1>
        <p>Every course here is built to move you one percent better — grounded in mindset, structure, and consistent action. Pick the path you're ready to walk, and come back as often as you need to.</p>
        <div class="academy-tagline">
          <strong>Redefining Success.</strong> Realigning Purpose. Releasing Potential.
        </div>
      </section>

      <section>
        <div class="academy-section-head">
          <h2>All Courses</h2>
          <span class="academy-section-meta">${COURSES.length} in the library</span>
        </div>
        <div class="course-card-grid">
          ${cards}
        </div>
      </section>
    </div>
  `;
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

function showWorkspace(course) {
  const lib = $('workspace-library');
  const live = $('workspace-live');
  const soon = $('workspace-coming-soon');
  const strip = $('course-tabs-strip');

  if (!course) {
    if (lib) lib.style.display = '';
    if (live) live.style.display = 'none';
    if (soon) soon.style.display = 'none';
    if (strip) strip.style.display = 'none';
    return;
  }
  if (strip) strip.style.display = '';
  if (lib) lib.style.display = 'none';
  if (course.status === 'live') {
    if (live) live.style.display = '';
    if (soon) soon.style.display = 'none';
  } else {
    if (live) live.style.display = 'none';
    if (soon) soon.style.display = '';
  }
}

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

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html');
      return;
    }
  }

  const course = getActiveCourse();

  if (!course) {
    // Library landing.
    renderLibrary();
    showWorkspace(null);
  } else {
    renderCourseTabs(course.slug);
    showWorkspace(course);
    if (course.status === 'live' && typeof course.mount === 'function') {
      try { await course.mount(); }
      catch (e) { console.warn('[courses-page] mount failed', e); }
    } else {
      renderComingSoon(course);
    }
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
