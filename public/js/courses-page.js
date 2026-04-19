// /courses.html orchestrator.
//
//   No ?course param → sidebar shows courses; main shows welcome. Nothing auto-opens.
//   ?course=<slug>   → sidebar highlights the course (and, for 1P-CLC, nests its
//                      module nav + progress + cert status beneath it); main
//                      shows the course content (live) or coming-soon card.

import { COURSES, getActiveCourse } from './courses-registry.js';
import { MODULES, PILLARS } from './modules.js';
import { onAuthReady, signOut, currentUser } from './auth.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady } from './firebase.js';
import { getUserProfile, avatarHtml, escapeHtml } from './community.js';
import { store } from './store.js';

const $ = (id) => document.getElementById(id);

// ─── Sidebar ──────────────────────────────────────────────────────────────

function courseEntryHtml(course, { isActive, completedCount = 0 } = {}) {
  const isLive = course.status === 'live';
  const href = `/courses.html?course=${encodeURIComponent(course.slug)}`;
  const badge = isLive
    ? ''
    : `<span class="course-entry-badge">Soon</span>`;

  // Live 1P-CLC gets a progress chip; other live courses just show eyebrow.
  let chip = '';
  if (isLive && course.slug === '1p-clc') {
    const pct = Math.round((completedCount / MODULES.length) * 100);
    chip = `<span class="course-entry-pct">${pct}%</span>`;
  } else if (!isLive) {
    chip = badge;
  }

  const nestedId = isActive && isLive ? 'course-entry-nested' : '';

  // For the active 1P-CLC course, embed the module nav + progress + cert status
  // inside the course entry. app.js's buildNav() / updateTopBar() target these.
  const nested = (isActive && course.slug === '1p-clc') ? `
    <div class="course-entry-nested" id="${nestedId}">
      <div class="progress-wrap">
        <div class="progress-label">
          <span>Course Progress</span>
          <span id="progress-pct">0%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
      </div>
      <div id="nav-container"></div>
      <div class="cert-status">
        <div class="cert-status-label">Certification Status</div>
        <div class="cert-status-val" id="cert-status-val">Not Started</div>
      </div>
    </div>
  ` : '';

  return `
    <div class="course-entry ${isActive ? 'active' : ''} ${isLive ? '' : 'is-soon'}" data-slug="${escapeHtml(course.slug)}">
      <a class="course-entry-head" href="${href}">
        <span class="course-entry-indicator"></span>
        <span class="course-entry-meta">
          <span class="course-entry-title">${escapeHtml(course.short || course.title)}</span>
          <span class="course-entry-sub">${escapeHtml(course.eyebrow || '')}</span>
        </span>
        ${chip}
      </a>
      ${nested}
    </div>
  `;
}

function renderSidebar(activeSlug) {
  const list = $('courses-sidebar-list');
  if (!list) return;
  const completedCount = store.completed ? store.completed.size : 0;
  list.innerHTML = COURSES.map((c) => courseEntryHtml(c, {
    isActive: c.slug === activeSlug,
    completedCount
  })).join('');
}

// ─── Main area ────────────────────────────────────────────────────────────

function showMain(course) {
  const welcome = $('workspace-welcome');
  const live = $('workspace-live-content');
  const soon = $('workspace-coming-soon');
  if (!course) {
    if (welcome) welcome.hidden = false;
    if (live) live.hidden = true;
    if (soon) soon.hidden = true;
    return;
  }
  if (welcome) welcome.hidden = true;
  if (course.status === 'live') {
    if (live) live.hidden = false;
    if (soon) soon.hidden = true;
  } else {
    if (live) live.hidden = true;
    if (soon) soon.hidden = false;
  }
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

  // Preload progress so the sidebar chip reflects the user's real completion.
  try { await store.load(); } catch (e) { /* non-fatal */ }

  const course = getActiveCourse();

  renderSidebar(course ? course.slug : null);
  showMain(course);

  if (course) {
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
