// The One Percent Academy — hub landing controller.
// Post-login dashboard: greeting, continue-course card, quick-access tiles, community preview.

import { store } from './store.js';
import { MODULES } from './modules.js';
import { onAuthReady, currentUser } from './auth.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady } from './firebase.js';
import { renderTopbar } from './topbar.js';
import { ensureOnboarded } from './onboarding-guard.js';
import { maybeStartWelcomeTour } from './tour.js';
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
  // index.html has its own primary nav (academy-tabs); the chip should
  // only carry the bell + avatar + sign-out so the two don't duplicate.
  renderTopbar({ user, profile, role, currentPage: 'dashboard', links: [] });
  const badge = $('hub-community-badge');
  if (badge) badge.style.display = hasNewCommunity ? '' : 'none';
}

function renderGreeting(user, profile) {
  const name = firstName((profile && profile.displayName) || (user && user.displayName) || (user && user.email));
  $('hub-greeting').innerHTML = `Welcome back, <span>${escapeHtml(name)}</span>.`;
  renderDailyQuote();
}

// One encouraging line, rotated daily. The index is derived from the local
// calendar date so the quote is stable across reloads within a day and
// advances at midnight — no storage or network needed.
const DAILY_QUOTES = [
  'Continue your work. Stay grounded in purpose. Move forward with intention — one percent better every day.',
  'Small steps, taken daily, become the distance no one else is willing to travel.',
  'Discipline is the bridge between the person you are and the person you intend to become.',
  'Purpose turns effort into momentum. Show up today and let the work compound.',
  'You don’t rise to your goals; you fall to your systems. Build one good habit today.',
  'Potential means nothing until it meets action. Begin where you are.',
  'Consistency outlasts intensity. One honest hour beats a perfect plan never started.',
  'Redefine success on your own terms, then take one deliberate step toward it.',
  'The work you avoid is usually the work that frees you. Lean in.',
  'Progress is quiet. Trust it even on the days it doesn’t feel like winning.',
  'Become one percent better today — it is the slowest way to fail and the surest way to grow.',
  'Clarity comes from doing, not waiting. Move, and the path reveals itself.',
  'Your future is built in the unremarkable hours. Make this one count.',
  'Realign with why you started, and the how gets simpler.',
  'Growth lives just past comfort. Take the step that stretches you.',
  'Be relentless about progress, patient about results.',
  'The standard you walk past is the standard you accept. Raise it today.',
  'Energy follows commitment. Decide first, then act.',
  'You are not behind. You are exactly one decision away from forward.',
  'Master the basics until they master you. Excellence is repetition with intention.',
  'Do the hard thing while it is still small. Tomorrow it only grows.',
  'Momentum is a choice you make before you feel like it.',
  'Release the potential you’ve been protecting. The world needs the work only you can do.',
  'Focus is a superpower in a distracted world. Guard your attention like it matters — it does.',
  'Win the morning, win the day. Start with one intentional act.',
  'Effort compounds quietly, then all at once. Keep depositing.',
  'Don’t count the days — make the days count.',
  'The person you’re becoming is watching what you do right now.',
  'Plant today what your future self will be grateful to harvest.',
  'Stay grounded in purpose, and pressure becomes fuel instead of weight.',
  'One percent better, every single day — that is how ordinary becomes remarkable.'
];

function dayIndex() {
  const now = new Date();
  // Days since the Unix epoch in local time → a stable integer per calendar day.
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor(startOfDay.getTime() / 86400000);
}

function renderDailyQuote() {
  const el = $('hub-subtitle');
  if (!el) return;
  const quote = DAILY_QUOTES[((dayIndex() % DAILY_QUOTES.length) + DAILY_QUOTES.length) % DAILY_QUOTES.length];
  el.textContent = quote;
  // Re-trigger the entrance animation on each render: drop the class, force a
  // reflow, then re-add so the keyframes restart and draw attention.
  el.classList.remove('hub-quote-enter');
  void el.offsetWidth;
  el.classList.add('hub-quote-enter');
}

// Per-course progress helpers. Only 1P-CLC tracks real progress today; other
// enrolled courses render as 0% until they ship real modules + store support.
function courseProgressPct(course) {
  if (course.slug === '1p-clc') {
    return Math.round((store.completed.size / MODULES.length) * 100);
  }
  return 0;
}

function courseCompletedCount(course) {
  return course.slug === '1p-clc' ? store.completed.size : 0;
}

function courseTotalSteps(course) {
  if (course.slug === '1p-clc') return MODULES.length;
  return 0;
}

function statusLabel(course) {
  const pct = courseProgressPct(course);
  if (pct === 0) return 'Not started';
  if (pct >= 100) return 'Certified';
  return 'In progress';
}

// First module the user hasn't completed yet; -1 if all done.
function nextIncompleteModuleId() {
  for (let i = 0; i < MODULES.length; i++) {
    if (!store.completed.has(i)) return i;
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
        <a class="btn btn-primary btn-cta-pulse" href="/courses.html">Browse courses →</a>
      </div>
    `;
    return;
  }

  // Pick the "primary" enrolled course — prefer 1P-CLC if enrolled, else first.
  const primary = enrolled.find((c) => c.slug === '1p-clc') || enrolled[0];
  const pct = courseProgressPct(primary);
  const allDone = pct >= 100;

  let meta, title, sub, cta;
  let href = `/courses.html?course=${encodeURIComponent(primary.slug)}`;
  if (primary.slug === '1p-clc') {
    const doneCount = store.completed.size;
    if (doneCount === 0) {
      // First time — surface module 0 as the starting point.
      const first = MODULES[0];
      meta = `Start here · Module ${first.id} · ${first.pillar}`;
      title = first.title;
      sub = first.subtitle || 'A seven-module path grounded in mindset, structure, and consistent action.';
      cta = `Begin Module ${first.id} →`;
      href = `/courses.html?course=1p-clc&module=${first.id}`;
    } else if (allDone) {
      meta = 'You are certified';
      title = 'Revisit what matters';
      sub = 'The modules stay open. Return when you need to recalibrate or revisit a framework.';
      cta = 'Open course →';
    } else {
      const nextId = nextIncompleteModuleId();
      const next = MODULES[nextId] || MODULES[0];
      meta = `Up next · Module ${next.id} · ${next.pillar}`;
      title = next.title;
      sub = next.subtitle || 'Pick up where you left off. The work compounds when you stay consistent.';
      cta = `Resume Module ${next.id} →`;
      href = `/courses.html?course=1p-clc&module=${next.id}`;
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

  const currentId = nextIncompleteModuleId();
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
    if (!(await ensureOnboarded(user))) return;
  }

  await store.load();
  try { await loadEnrollments(); } catch (e) {}

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

  // First-time members get a short guided tour of the portal + chat assistant.
  const tourName = firstName((profile && profile.displayName) || (currentUser() && currentUser().displayName) || (currentUser() && currentUser().email));
  maybeStartWelcomeTour({ user: currentUser(), name: tourName });
}

main();
