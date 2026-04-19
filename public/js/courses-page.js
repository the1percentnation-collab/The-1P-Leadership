// /courses.html orchestrator — renders the course tab strip, shows the
// active course workspace, wires up the shared user chip, and kicks off
// the course's mount() function when the tab is live.

import { COURSES, getActiveCourse } from './courses-registry.js';
import { onAuthReady, signOut, currentUser } from './auth.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady } from './firebase.js';
import { getUserProfile, avatarHtml, escapeHtml } from './community.js';

const $ = (id) => document.getElementById(id);

function renderCourseTabs(activeSlug) {
  const strip = $('course-tabs-strip');
  if (!strip) return;
  strip.innerHTML = COURSES.map((c) => {
    const isActive = c.slug === activeSlug;
    const href = `/courses.html?course=${encodeURIComponent(c.slug)}`;
    const badge = c.status === 'coming-soon'
      ? `<span class="course-tab-badge">Soon</span>`
      : '';
    return `
      <a class="course-tab ${isActive ? 'active' : ''} ${c.status === 'coming-soon' ? 'is-soon' : ''}"
         href="${href}"
         data-course="${escapeHtml(c.slug)}">
        <span class="course-tab-label">${escapeHtml(c.short || c.title)}</span>
        ${badge}
      </a>
    `;
  }).join('');
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
        <a class="btn btn-primary" href="/courses.html?course=1p-clc">Open a live course →</a>
        <a class="btn btn-ghost" href="/index.html">Back to Academy</a>
      </div>
    </div>
  `;
}

function showWorkspace(course) {
  const liveEl = $('workspace-live');
  const soonEl = $('workspace-coming-soon');
  if (!liveEl || !soonEl) return;
  if (course.status === 'live') {
    liveEl.style.display = '';
    soonEl.style.display = 'none';
  } else {
    liveEl.style.display = 'none';
    soonEl.style.display = '';
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
  renderCourseTabs(course.slug);
  showWorkspace(course);

  if (course.status === 'live' && typeof course.mount === 'function') {
    try { await course.mount(); }
    catch (e) { console.warn('[courses-page] mount failed', e); }
  } else {
    renderComingSoon(course);
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
