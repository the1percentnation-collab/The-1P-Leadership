// The One Percent Academy — hub landing controller.
// Post-login dashboard: greeting, continue-course card, quick-access tiles, community preview.

import { store } from './store.js';
import { MODULES } from './modules.js';
import { onAuthReady, signOut, currentUser } from './auth.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady } from './firebase.js';
import {
  getUserProfile,
  hasNewPostsSinceVisit,
  listPosts,
  avatarHtml,
  escapeHtml,
  fmtRelative,
  initials
} from './community.js';
import { loadEnrollments, enrolledCourses, isEnrolled } from './enrollments.js';

const $ = (id) => document.getElementById(id);

function firstName(nameOrEmail) {
  if (!nameOrEmail) return 'there';
  const clean = String(nameOrEmail).split('@')[0].replace(/[._-]+/g, ' ').trim();
  const first = clean.split(' ')[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'there';
}

function renderUserChip(user, role, { profile = null, hasNewCommunity = false } = {}) {
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
  const displayName = (profile && profile.displayName) || user.displayName || user.email || '';
  const avatar = `<a href="/profile.html" class="c-avatar-link" title="Your profile">${avatarHtml({
    displayName,
    avatarUrl: profile && profile.avatarUrl || null
  }, 28)}</a>`;
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

  const badge = $('hub-community-badge');
  if (badge) badge.style.display = hasNewCommunity ? '' : 'none';
}

function renderGreeting(user, profile) {
  const name = firstName((profile && profile.displayName) || (user && user.displayName) || (user && user.email));
  $('hub-greeting').innerHTML = `Welcome back, <span>${escapeHtml(name)}</span>.`;
}

// Per-course data cache, populated at main() time by loadCourseCaches().
// Each entry: { modules, completed: Set<number>, currentId: number }.
const _courseCache = {};

async function loadCourseCaches(enrolled) {
  // 1P-CLC uses the already-imported MODULES + store (synchronously available).
  _courseCache['1p-clc'] = {
    modules: MODULES,
    completed: store.completed || new Set(),
    currentId: typeof store.currentModule === 'number' ? store.currentModule : 0
  };

  // Trust The Process — dynamic import so the bundle stays small for users
  // who aren't enrolled in it.
  if (enrolled.some((c) => c.slug === 'trust-process')) {
    try {
      const [m, s] = await Promise.all([
        import('./trust-process-modules.js'),
        import('./trust-process-store.js')
      ]);
      try { await s.store.load(); } catch (e) {}
      _courseCache['trust-process'] = {
        modules: m.MODULES,
        completed: s.store.completed || new Set(),
        currentId: typeof s.store.currentModule === 'number' ? s.store.currentModule : 0
      };
    } catch (e) {
      console.warn('[hub] trust-process data load failed', e);
    }
  }
}

function courseCache(slug) {
  return _courseCache[slug] || null;
}

function courseProgressPct(course) {
  const c = courseCache(course.slug);
  if (!c || !c.modules.length) return 0;
  return Math.round((c.completed.size / c.modules.length) * 100);
}

function courseCompletedCount(course) {
  const c = courseCache(course.slug);
  return c ? c.completed.size : 0;
}

function courseTotalSteps(course) {
  const c = courseCache(course.slug);
  return c ? c.modules.length : 0;
}

function statusLabel(course) {
  const pct = courseProgressPct(course);
  if (pct === 0) return 'Not started';
  if (pct >= 100) return course.slug === '1p-clc' ? 'Certified' : 'Complete';
  return 'In progress';
}

// First module the user hasn't completed yet for the given course; -1 if all done.
function nextIncompleteIdFor(slug) {
  const c = courseCache(slug);
  if (!c) return -1;
  for (let i = 0; i < c.modules.length; i++) {
    if (!c.completed.has(c.modules[i].id)) return c.modules[i].id;
  }
  return -1;
}

function renderContinueCard() {
  const slot = $('hub-continue-slot');
  if (!slot) return;

  const enrolled = enrolledCourses();

  // No enrollments yet — prompt the user to browse the course library.
  if (enrolled.length === 0) {
    slot.innerHTML = `
      <div class="academy-continue">
        <div>
          <div class="academy-continue-meta">Start your journey</div>
          <div class="academy-continue-title">No active courses yet</div>
          <div class="academy-continue-sub">Browse the Academy library and sign up for your first course — the work starts when you choose.</div>
        </div>
        <a class="btn btn-primary" href="/courses.html">Browse courses →</a>
      </div>
    `;
    return;
  }

  // Pick the "primary" enrolled course — prefer 1P-CLC if enrolled, else first.
  const primary = enrolled.find((c) => c.slug === '1p-clc') || enrolled[0];
  const pct = courseProgressPct(primary);
  const allDone = pct >= 100;
  const cache = courseCache(primary.slug);
  const unitLabel = primary.slug === 'trust-process' ? 'Lesson' : 'Module';

  let meta, title, sub, cta;
  let href = `/courses.html?course=${encodeURIComponent(primary.slug)}`;
  if (cache && cache.modules.length) {
    const doneCount = cache.completed.size;
    if (doneCount === 0) {
      const first = cache.modules[0];
      meta = `Start here · ${unitLabel} ${first.id} · ${first.pillar}`;
      title = first.title;
      sub = first.subtitle || primary.subtitle || 'Begin the first lesson and build momentum.';
      cta = `Begin ${unitLabel} ${first.id} →`;
      href = `/courses.html?course=${encodeURIComponent(primary.slug)}&module=${first.id}`;
    } else if (allDone) {
      meta = primary.slug === '1p-clc' ? 'You are certified' : 'Course complete';
      title = 'Revisit what matters';
      sub = 'The lessons stay open. Return when you need to recalibrate or revisit a framework.';
      cta = 'Open course →';
    } else {
      const nextId = nextIncompleteIdFor(primary.slug);
      const next = cache.modules.find((m) => m.id === nextId) || cache.modules[0];
      meta = `Up next · ${unitLabel} ${next.id} · ${next.pillar}`;
      title = next.title;
      sub = next.subtitle || 'Pick up where you left off. The work compounds when you stay consistent.';
      cta = `Resume ${unitLabel} ${next.id} →`;
      href = `/courses.html?course=${encodeURIComponent(primary.slug)}&module=${next.id}`;
    }
  } else {
    meta = 'Continue your work';
    title = primary.title;
    sub = primary.subtitle || 'Open your course roadmap.';
    cta = 'Open course →';
  }

  slot.innerHTML = `
    <div class="academy-continue">
      <div>
        <div class="academy-continue-meta">${escapeHtml(meta)}</div>
        <div class="academy-continue-title">${escapeHtml(title)}</div>
        <div class="academy-continue-sub">${escapeHtml(sub)}</div>
        <div class="academy-continue-progress">
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="academy-continue-progress-label">${pct}%</div>
        </div>
      </div>
      <a class="btn btn-primary" href="${href}">${escapeHtml(cta)}</a>
    </div>
  `;
}

function renderModuleMap() {
  const section = $('hub-progress');
  const slot = $('hub-module-map');
  if (!section || !slot) return;

  // Only surface the map if the user is enrolled in 1P-CLC — the only course
  // with real module data today.
  if (!isEnrolled('1p-clc')) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const currentId = nextIncompleteIdFor('1p-clc');
  slot.innerHTML = MODULES.map((m) => {
    const done = store.completed.has(m.id);
    const isCurrent = m.id === currentId && !done;
    const state = done ? 'is-done' : (isCurrent ? 'is-current' : 'is-todo');
    const marker = done ? '✓' : String(m.id).padStart(2, '0');
    const href = `/courses.html?course=1p-clc&module=${m.id}`;
    return `
      <a class="hub-mm-cell ${state}" href="${href}" title="${escapeHtml(m.title)}">
        <span class="hub-mm-marker">${marker}</span>
        <span class="hub-mm-body">
          <span class="hub-mm-pillar">${escapeHtml(m.pillarTag || m.pillar || '')}</span>
          <span class="hub-mm-title">${escapeHtml(m.title)}</span>
          <span class="hub-mm-duration">${escapeHtml(m.duration || '')}</span>
        </span>
      </a>
    `;
  }).join('');
}

function renderEnrolledList() {
  const list = $('hub-courses-list');
  if (!list) return;

  const enrolled = enrolledCourses();
  if (enrolled.length === 0) {
    list.innerHTML = `
      <a class="academy-list-item" href="/courses.html" style="text-decoration:none;">
        <div class="academy-list-avatar">+</div>
        <div class="academy-list-main">
          <div class="academy-list-title">Browse available courses</div>
          <div class="academy-list-sub">You haven't signed up for any courses yet.</div>
        </div>
        <div class="academy-list-meta">Start</div>
      </a>
    `;
    return;
  }

  list.innerHTML = enrolled.map((c) => {
    const pct = courseProgressPct(c);
    const total = courseTotalSteps(c);
    const done = courseCompletedCount(c);
    const href = `/courses.html?course=${encodeURIComponent(c.slug)}`;
    const subParts = [];
    if (total > 0) subParts.push(`${done} of ${total} modules`);
    subParts.push(`${pct}%`);
    const sub = subParts.join(' · ');
    const avatarInitials = (c.short || c.title).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    return `
      <a class="academy-list-item" href="${href}">
        <div class="academy-list-avatar">${escapeHtml(avatarInitials)}</div>
        <div class="academy-list-main">
          <div class="academy-list-title">${escapeHtml(c.title)}</div>
          <div class="academy-list-sub">${escapeHtml(sub)}</div>
        </div>
        <div class="academy-list-meta">${escapeHtml(statusLabel(c))}</div>
      </a>
    `;
  }).join('');
}

async function renderCommunityList({ role, companyId }) {
  const list = $('hub-community-list');
  if (!list) return;

  if (!firebaseReady) {
    list.innerHTML = `<div class="academy-empty">Community is offline right now. Check back in a moment.</div>`;
    return;
  }

  try {
    const { posts } = await listPosts({ pageSize: 4, role, companyId });
    if (!posts || posts.length === 0) {
      list.innerHTML = `
        <div class="academy-empty">
          No posts yet. Start the conversation over in the community.
        </div>
      `;
      return;
    }
    list.innerHTML = posts.map((p) => {
      const name = p.authorName || 'Member';
      const avatarUrl = p.authorAvatar || p.authorAvatarUrl || null;
      const avatarInner = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : escapeHtml(initials(name));
      const snippet = (p.text || '').replace(/\s+/g, ' ').slice(0, 110);
      const when = p.createdAt ? fmtRelative(p.createdAt) : '';
      return `
        <a class="academy-list-item" href="/community.html">
          <div class="academy-list-avatar">${avatarInner}</div>
          <div class="academy-list-main">
            <div class="academy-list-title">${escapeHtml(name)}</div>
            <div class="academy-list-sub">${escapeHtml(snippet)}${(p.text || '').length > 110 ? '…' : ''}</div>
          </div>
          <div class="academy-list-meta">${escapeHtml(when)}</div>
        </a>
      `;
    }).join('');
  } catch (e) {
    console.warn('[hub] community list failed', e);
    list.innerHTML = `<div class="academy-empty">Couldn't load community activity.</div>`;
  }
}

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html');
      return;
    }
  }

  await store.load();
  try { await loadEnrollments(); } catch (e) {}
  try { await loadCourseCaches(enrolledCourses()); } catch (e) {}

  let role = null;
  let companyId = null;
  let profile = null;
  let hasNewCommunity = false;

  try {
    if (firebaseReady && currentUser()) {
      const info = await getRoleInfo();
      role = info.role;
      companyId = info.companyId || null;
      try { profile = await getUserProfile(currentUser().uid); } catch (e) {}
      try { hasNewCommunity = await hasNewPostsSinceVisit({ role, companyId }); } catch (e) {}
    }
  } catch (e) {}

  renderGreeting(currentUser(), profile);
  renderContinueCard();
  renderModuleMap();
  renderEnrolledList();
  renderUserChip(currentUser(), role, { profile, hasNewCommunity });
  renderCommunityList({ role, companyId });
}

main();
