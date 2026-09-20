// The One Percent Academy — member dashboard controller.
//
// This is the whole portal in one page, not a course page with a greeting on
// it: what's new (spotlight), what to do (next step), where you are
// (progress), what's happening (activity, events, leaderboard), and what's
// next (explore). Owners get a business pulse strip on top of all of it.
//
// Two rules hold the page together:
//   1. Nothing blocks on anything it doesn't need. The header paints before a
//      single network call, then each section fills in as its own data lands.
//   2. Every section is fail-soft and self-hiding. A section whose read fails
//      renders nothing and the page closes the gap — a dashboard of eight
//      widgets cannot let the eighth one break the other seven.

import { store } from './store.js';
import { onAuthReady, currentUser, getMyReferralCode } from './auth.js';
import { getRoleInfo } from './roles.js';
import { db, functions, firebaseReady } from './firebase.js';
import {
  doc, getDoc, collection, getDocs, query, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { renderTopbar, renderTopbarEarly } from './topbar.js';
import { ensureOnboarded } from './onboarding-guard.js';
import {
  getUserProfile,
  hasNewPostsSinceVisit,
  listPosts,
  listRecentNotifs,
  getMyStats,
  getLeaderboard,
  levelProgress,
  escapeHtml,
  fmtRelative,
  initials
} from './community.js';
import { loadEnrollments, enrolledCourses, availableCourses, isEnrolled } from './enrollments.js';
import { priceInfo } from './courses-data.js';
import { loadCourseCompletion } from './course-progress.js';
import { listVisibleProducts } from './products.js';
import { listActiveAnnouncements } from './announcements.js';
import { renderSpotlight } from './hub-spotlight.js';
import { buildNextSteps } from './hub-nextup.js';

const $ = (id) => document.getElementById(id);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Completion state per enrolled course, resolved once per page load and shared
// by the continue card, the course list, the module map and the next-step
// engine. Every one of them used to answer this question differently.
let completions = new Map(); // slug -> { modules, completed, done, total, pct, isComplete }
let eventFeed = [];          // normalized upcoming events, soonest first
let spotlightHandle = null;
let productsPromise = null;  // shared by the spotlight and the explore row

function visibleProducts() {
  if (!productsPromise) productsPromise = listVisibleProducts().catch(() => []);
  return productsPromise;
}

function firstName(nameOrEmail) {
  if (!nameOrEmail) return 'there';
  const clean = String(nameOrEmail).split('@')[0].replace(/[._-]+/g, ' ').trim();
  const first = clean.split(' ')[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'there';
}

function fmtDateTime(ms) {
  if (!ms) return 'Date coming soon';
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function fmtCountdown(ms) {
  if (!ms) return '';
  const delta = ms - Date.now();
  if (delta <= 0) return 'Live now';
  if (delta < HOUR) return `${Math.max(1, Math.round(delta / (60 * 1000)))}m`;
  if (delta < DAY) return `${Math.round(delta / HOUR)}h`;
  return `${Math.round(delta / DAY)}d`;
}

function fmtMoneyCents(cents) {
  const dollars = Number(cents || 0) / 100;
  return dollars >= 1000
    ? `$${Math.round(dollars).toLocaleString('en-US')}`
    : `$${dollars.toFixed(dollars % 1 ? 2 : 0)}`;
}

function renderUserChip(user, role, { profile = null, hasNewCommunity = false } = {}) {
  // dashboard.html has its own primary nav (academy-tabs); the chip should
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

// ─── Data loading ─────────────────────────────────────────────────────────

/**
 * Completion for every enrolled course, in parallel.
 *
 * This is what the old dashboard got wrong: it computed progress inline and
 * hardcoded a single slug, so every Firestore-authored course reported 0%.
 * loadCourseCompletion already normalizes all three progress stores.
 */
async function loadCompletions() {
  const courses = enrolledCourses();
  const results = await Promise.all(courses.map(async (c) => {
    try { return [c.slug, await loadCourseCompletion(c)]; }
    catch (e) { return [c.slug, null]; }
  }));
  completions = new Map(results.filter(([, v]) => v));
}

/**
 * Upcoming events, merged from two sources:
 *   - the public `events` collection (what exists)
 *   - users/{uid}/registrations (what this member already claimed, and the
 *     Zoom link registerForEvent earned them)
 *
 * The registration mirror wins on conflict, since it is the only one of the
 * two that carries a join URL.
 */
async function loadEventFeed() {
  if (!firebaseReady || !currentUser()) return [];
  const now = Date.now();
  const byId = new Map();

  try {
    const snap = await getDocs(query(collection(db, 'events'), orderBy('startsAt', 'desc'), limit(50)));
    snap.docs.forEach((d) => {
      const e = d.data() || {};
      const startsAtMs = e.startsAt && e.startsAt.toMillis ? e.startsAt.toMillis() : null;
      // Events drop off two hours after they start, same grace the old
      // dashboard used — a call you are late to is still a call you can join.
      if (startsAtMs && startsAtMs < now - 2 * HOUR) return;
      byId.set(d.id, {
        id: d.id,
        title: e.title || 'Untitled event',
        description: e.description || '',
        imageUrl: e.imageUrl || null,
        startsAtMs,
        registered: false,
        joinUrl: null
      });
    });
  } catch (e) { /* non-fatal — the registration mirror may still have rows */ }

  try {
    const snap = await getDocs(collection(db, 'users', currentUser().uid, 'registrations'));
    snap.docs.forEach((d) => {
      const r = d.data() || {};
      const startsAtMs = r.startsAt && r.startsAt.toMillis ? r.startsAt.toMillis() : null;
      if (startsAtMs && startsAtMs < now - 2 * HOUR) return;
      const existing = byId.get(d.id) || {
        id: d.id,
        title: r.title || 'Registered event',
        description: '',
        imageUrl: null,
        startsAtMs
      };
      byId.set(d.id, { ...existing, registered: true, joinUrl: r.joinUrl || null });
    });
  } catch (e) { /* non-fatal */ }

  // The CLC cohort call is a standing weekly commitment, not an events doc.
  // Check both CLC slugs: the certification and the leader track are separate
  // courses and a member may hold either.
  for (const slug of ['1p-clc', '1p-clc-leader']) {
    if (!isEnrolled(slug)) continue;
    try {
      const courseSnap = await getDoc(doc(db, 'courses', slug));
      const cohort = courseSnap.exists() ? (courseSnap.data().cohort || {}) : {};
      let joinUrl = null;
      try {
        const priv = await getDoc(doc(db, 'courses', slug, 'private', 'cohort'));
        if (priv.exists()) joinUrl = priv.data().joinUrl || null;
      } catch (e) { /* link is admin-gated until enrollment lands */ }
      const when = [cohort.callDay, cohort.callTime].filter((v) => v && v !== 'TBD').join(' · ');
      if (when || joinUrl) {
        byId.set(`cohort-${slug}`, {
          id: `cohort-${slug}`,
          title: 'Weekly live coaching call',
          description: when ? `Weekly · ${when}` : 'Weekly live call',
          imageUrl: null,
          startsAtMs: null,
          recurringLabel: when ? `Weekly · ${when}` : 'Weekly live call',
          registered: true,
          joinUrl,
          href: `/courses.html?course=${slug}`
        });
        break; // one cohort call is enough; don't stack both tracks
      }
    } catch (e) { /* non-fatal */ }
  }

  // Dated events first, soonest to furthest; the recurring call trails them.
  return Array.from(byId.values())
    .sort((a, b) => (a.startsAtMs || Infinity) - (b.startsAtMs || Infinity));
}

// ─── Hero status bar ──────────────────────────────────────────────────────

function chip(label, value, { tone = '' } = {}) {
  return `
    <div class="hub-stat${tone ? ` is-${tone}` : ''}">
      <span class="hub-stat-value">${escapeHtml(String(value))}</span>
      <span class="hub-stat-label">${escapeHtml(label)}</span>
    </div>`;
}

function renderStatbar({ streak, stats, hasNewCommunity }) {
  const bar = $('hub-statbar');
  if (!bar) return;
  const chips = [];

  if (streak && streak.currentStreak > 0) {
    chips.push(chip(
      streak.currentStreak === 1 ? 'Day streak' : 'Day streak — keep it',
      streak.currentStreak,
      { tone: streak.currentStreak >= 7 ? 'hot' : '' }
    ));
  }

  if (stats) {
    const prog = levelProgress(stats.points || 0);
    chips.push(chip(prog.ceiling ? `${prog.toNext} pts to Lv ${prog.level + 1}` : 'Max level', `Lv ${prog.level}`));
    chips.push(chip('Points', stats.points || 0));
  }

  const inProgress = Array.from(completions.values()).filter((c) => c.total > 0 && !c.isComplete).length;
  if (inProgress > 0) chips.push(chip(inProgress === 1 ? 'Course in progress' : 'Courses in progress', inProgress));

  const nextDated = eventFeed.find((e) => e.startsAtMs && e.startsAtMs > Date.now());
  if (nextDated) chips.push(chip('To next live call', fmtCountdown(nextDated.startsAtMs), { tone: 'accent' }));

  if (hasNewCommunity) chips.push(chip('In the community', 'New', { tone: 'accent' }));

  bar.innerHTML = chips.join('');
}

// ─── Owner pulse ──────────────────────────────────────────────────────────

// Owner-only, and deliberately not awaited: an admin metric is the last thing
// on the page that should be allowed to delay a member-facing section.
async function renderOwnerPulse(role) {
  if (role !== 'owner' && role !== 'admin') return;
  const section = $('hub-pulse');
  const grid = $('hub-pulse-grid');
  if (!section || !grid || !firebaseReady) return;

  let p;
  try {
    const res = await httpsCallable(functions, 'getOwnerPulse')({});
    p = res.data;
  } catch (e) {
    console.warn('[hub] owner pulse unavailable', e);
    return;
  }
  if (!p || !p.ok) return;

  const cell = (value, label, href) => `
    <a class="hub-pulse-cell" href="${escapeHtml(href)}">
      <span class="hub-pulse-value">${escapeHtml(String(value == null ? '—' : value))}</span>
      <span class="hub-pulse-label">${escapeHtml(label)}</span>
    </a>`;

  const cells = [
    cell(p.newMembers, 'New members', '/admin.html'),
    cell(p.posts, 'Posts', '/community.html'),
    cell(p.unansweredPosts, 'Unanswered', '/community.html'),
    cell(p.orders, 'Orders', '/manage-store.html'),
    cell(fmtMoneyCents(p.grossCents), 'Gross', '/manage-store.html')
  ];
  if (p.nextEvent) {
    cells.push(cell(p.nextEvent.registrationCount, 'Registered for next event', '/events'));
  }
  if (p.interestSignups || p.preorders) {
    cells.push(cell(p.interestSignups + p.preorders, 'Interest + preorders', '/manage-products.html'));
  }

  grid.innerHTML = cells.join('');
  section.hidden = false;
}

// ─── Spotlight ────────────────────────────────────────────────────────────

/**
 * Everything worth leading the page with, from four sources, ranked into one
 * rail. Announcements outrank the rest because someone deliberately wrote
 * them; after that it is whatever happens soonest.
 */
async function renderSpotlightRail({ role, companyId }) {
  const section = $('hub-spotlight');
  if (!section) return;

  const enrolledSlugs = new Set(enrolledCourses().map((c) => c.slug));
  const [announcements, products] = await Promise.all([
    listActiveAnnouncements({ role, companyId, enrolledSlugs }).catch(() => []),
    visibleProducts()
  ]);

  const slides = [];

  announcements.forEach((a) => slides.push({
    id: `a-${a.id}`,
    kind: a.kind,
    eyebrow: a.kind === 'promo' ? 'Offer' : (a.kind === 'course' ? 'New course' : 'Announcement'),
    title: a.title,
    body: a.body,
    imageUrl: a.imageUrl,
    ctaLabel: a.ctaLabel,
    ctaHref: a.ctaHref,
    external: !!(a.ctaHref && /^https?:/i.test(a.ctaHref)),
    // Authored slides lead by default; priority is how the owner overrides
    // the automatic ordering below.
    priority: 100 + a.priority,
    sortAt: a.publishAtMs || 0
  }));

  eventFeed
    .filter((e) => e.startsAtMs)
    .slice(0, 3)
    .forEach((e) => slides.push({
      id: `e-${e.id}`,
      kind: 'event',
      eyebrow: e.registered ? 'You are registered' : 'Upcoming event',
      title: e.title,
      body: (e.description || '').slice(0, 160),
      imageUrl: e.imageUrl,
      meta: fmtDateTime(e.startsAtMs),
      ctaLabel: e.registered ? (e.joinUrl ? 'Join' : 'Details') : 'Register',
      ctaHref: e.registered && e.joinUrl ? e.joinUrl : '/events',
      external: !!(e.registered && e.joinUrl),
      priority: e.registered ? 60 : 50,
      sortAt: e.startsAtMs
    }));

  products.slice(0, 3).forEach((p) => slides.push({
    id: `p-${p.id}`,
    kind: 'product',
    eyebrow: p.status === 'live' ? 'Now available' : (p.status === 'preorder' ? 'Pre-order open' : 'Coming soon'),
    title: p.name || 'New from The One Percent',
    body: p.summary || '',
    imageUrl: p.imageUrl,
    ctaLabel: p.status === 'live' ? 'Get it' : 'Notify me',
    ctaHref: '/upcoming.html',
    priority: 40,
    sortAt: 0
  }));

  // Courses they could still take. Capped at two so the rail stays a
  // noticeboard rather than a storefront.
  availableCourses()
    .filter((c) => c.status === 'live')
    .slice(0, 2)
    .forEach((c) => {
      const price = priceInfo(c);
      slides.push({
        id: `c-${c.slug}`,
        kind: 'course',
        eyebrow: 'Open for enrollment',
        title: c.title,
        body: c.short || c.subtitle || '',
        imageUrl: c.imageUrl || null,
        meta: price.label || '',
        ctaLabel: 'Learn more',
        ctaHref: `/courses.html?course=${encodeURIComponent(c.slug)}`,
        priority: 30,
        sortAt: 0
      });
    });

  slides.sort((a, b) => (b.priority - a.priority) || ((a.sortAt || Infinity) - (b.sortAt || Infinity)));

  if (spotlightHandle) spotlightHandle.destroy();
  spotlightHandle = renderSpotlight(section, slides.slice(0, 8));
}

// ─── Next step ────────────────────────────────────────────────────────────

function renderNextSteps(steps) {
  const section = $('hub-nextup');
  const list = $('hub-nextup-list');
  if (!section || !list) return;
  if (!steps.length) { section.hidden = true; return; }

  list.innerHTML = steps.map((s) => `
    <a class="hub-next-card${s.urgent ? ' is-urgent' : ''}" href="${escapeHtml(s.href)}"${s.external ? ' target="_blank" rel="noopener"' : ''}>
      <span class="hub-next-eyebrow">${escapeHtml(s.eyebrow || '')}</span>
      <span class="hub-next-title">${escapeHtml(s.title || '')}</span>
      <span class="hub-next-sub">${escapeHtml(s.sub || '')}</span>
      <span class="hub-next-cta">${escapeHtml(s.ctaLabel || 'Open')} →</span>
    </a>
  `).join('');
  section.hidden = false;
}

// ─── Continue card ────────────────────────────────────────────────────────

function primaryCourse() {
  const enrolled = enrolledCourses();
  if (!enrolled.length) return null;
  // The course with the most work already done and something still left in
  // it. That is where momentum lives; a fresh course can wait one scroll.
  const ranked = enrolled
    .map((c) => ({ course: c, completion: completions.get(c.slug) }))
    .filter((r) => r.completion);
  const inFlight = ranked
    .filter((r) => r.completion.total > 0 && !r.completion.isComplete)
    .sort((a, b) => b.completion.done - a.completion.done)[0];
  return inFlight || ranked[0] || { course: enrolled[0], completion: null };
}

function renderContinueCard() {
  const slot = $('hub-continue-slot');
  if (!slot) return;

  const primary = primaryCourse();
  if (!primary) {
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

  const { course, completion } = primary;
  const pct = completion ? completion.pct : 0;
  const next = completion ? completion.modules.find((m) => !completion.completed.has(m.id)) : null;

  let meta, title, sub, cta;
  let href = `/courses.html?course=${encodeURIComponent(course.slug)}`;

  if (completion && completion.isComplete) {
    meta = `${course.title} · complete`;
    title = 'Revisit what matters';
    sub = 'The modules stay open. Return when you need to recalibrate or revisit a framework.';
    cta = 'Open course →';
  } else if (next) {
    const isFirst = completion.done === 0;
    meta = `${isFirst ? 'Start here' : 'Up next'} · Module ${next.id}${next.pillar ? ` · ${next.pillar}` : ''}`;
    title = next.title;
    sub = next.subtitle || 'Pick up where you left off. The work compounds when you stay consistent.';
    cta = `${isFirst ? 'Begin' : 'Resume'} Module ${next.id} →`;
    href = `/courses.html?course=${encodeURIComponent(course.slug)}&module=${next.id}`;
  } else {
    meta = 'Continue your work';
    title = course.title;
    sub = course.subtitle || 'Open your course roadmap.';
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

// ─── Course arc ───────────────────────────────────────────────────────────

// Every enrolled course gets a roadmap now, not just the one whose modules
// happened to be hardcoded in JS.
function renderModuleMap(slug) {
  const section = $('hub-progress');
  const slot = $('hub-module-map');
  const link = $('hub-progress-link');
  if (!section || !slot) return;

  const enrolled = enrolledCourses();
  const primary = primaryCourse();
  const target = slug || (primary && primary.course.slug);
  const course = enrolled.find((c) => c.slug === target);
  const completion = course ? completions.get(course.slug) : null;

  if (!course || !completion || !completion.modules.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  if (link) link.href = `/courses.html?course=${encodeURIComponent(course.slug)}`;

  renderCourseSwitch(course.slug);

  const nextId = (completion.modules.find((m) => !completion.completed.has(m.id)) || {}).id;
  slot.innerHTML = completion.modules.map((m) => {
    const done = completion.completed.has(m.id);
    const isCurrent = m.id === nextId && !done;
    const state = done ? 'is-done' : (isCurrent ? 'is-current' : 'is-todo');
    const marker = done ? '✓' : String(m.id).padStart(2, '0');
    const href = `/courses.html?course=${encodeURIComponent(course.slug)}&module=${m.id}`;
    return `
      <a class="hub-mm-cell ${state}" href="${href}" title="${escapeHtml(m.title)}">
        <span class="hub-mm-marker">${marker}</span>
        <span class="hub-mm-body">
          <span class="hub-mm-pillar">${escapeHtml(m.tagLabel || m.pillar || '')}</span>
          <span class="hub-mm-title">${escapeHtml(m.title)}</span>
          <span class="hub-mm-duration">${escapeHtml(m.duration || '')}</span>
        </span>
      </a>
    `;
  }).join('');
}

function renderCourseSwitch(activeSlug) {
  const wrap = $('hub-course-switch');
  if (!wrap) return;
  const withModules = enrolledCourses().filter((c) => {
    const comp = completions.get(c.slug);
    return comp && comp.modules.length;
  });
  if (withModules.length < 2) { wrap.hidden = true; return; }

  wrap.hidden = false;
  wrap.innerHTML = withModules.map((c) => {
    const comp = completions.get(c.slug);
    return `<button class="hub-course-pill${c.slug === activeSlug ? ' is-active' : ''}" type="button"
              data-slug="${escapeHtml(c.slug)}">${escapeHtml(c.short || c.title)} <em>${comp.pct}%</em></button>`;
  }).join('');

  wrap.querySelectorAll('.hub-course-pill').forEach((b) => {
    b.addEventListener('click', () => renderModuleMap(b.dataset.slug));
  });
}

// ─── Activity feed ────────────────────────────────────────────────────────

let activityCache = { community: null, you: null };

function activityRow({ href, avatar, title, sub, meta }) {
  return `
    <a class="academy-list-item" href="${escapeHtml(href)}">
      <div class="academy-list-avatar">${avatar}</div>
      <div class="academy-list-main">
        <div class="academy-list-title">${escapeHtml(title)}</div>
        <div class="academy-list-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="academy-list-meta">${escapeHtml(meta)}</div>
    </a>`;
}

async function loadCommunityFeed({ role, companyId }) {
  if (activityCache.community) return activityCache.community;
  if (!firebaseReady) {
    activityCache.community = `<div class="academy-empty">Community is offline right now. Check back in a moment.</div>`;
    return activityCache.community;
  }
  try {
    const { posts } = await listPosts({ pageSize: 6, role, companyId });
    if (!posts || !posts.length) {
      activityCache.community = `<div class="academy-empty">No posts yet. Start the conversation over in the community.</div>`;
      return activityCache.community;
    }
    activityCache.community = posts.map((p) => {
      const name = p.authorName || 'Member';
      const avatarUrl = p.authorAvatar || p.authorAvatarUrl || null;
      const avatar = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : escapeHtml(initials(name));
      const snippet = (p.text || '').replace(/\s+/g, ' ').slice(0, 110);
      return activityRow({
        href: `/community.html?channel=${encodeURIComponent(p.category || 'general')}#post-${encodeURIComponent(p.id)}`,
        avatar,
        title: name,
        sub: snippet + ((p.text || '').length > 110 ? '…' : ''),
        meta: p.createdAt ? fmtRelative(p.createdAt) : ''
      });
    }).join('');
    return activityCache.community;
  } catch (e) {
    console.warn('[hub] community feed failed', e);
    activityCache.community = `<div class="academy-empty">Couldn't load community activity.</div>`;
    return activityCache.community;
  }
}

// "For you" is the notification stream — likes, comments and mentions aimed
// at this member specifically, rather than the room at large.
async function loadYouFeed(notifications) {
  if (activityCache.you) return activityCache.you;
  const rows = (notifications || []).slice(0, 6);
  if (!rows.length) {
    activityCache.you = `<div class="academy-empty">Nothing aimed at you yet. Post something and that changes fast.</div>`;
    return activityCache.you;
  }
  const verb = {
    like: 'liked your post',
    comment: 'replied to you',
    mention: 'mentioned you',
    channel_request: 'asked to join a channel',
    channel_access_granted: 'approved your channel request',
    channel_access_denied: 'declined your channel request'
  };
  activityCache.you = rows.map((n) => activityRow({
    href: n.postId
      ? `/community.html?channel=${encodeURIComponent(n.category || 'general')}#post-${encodeURIComponent(n.postId)}`
      : '/community.html',
    avatar: n.fromAvatar
      ? `<img src="${escapeHtml(n.fromAvatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : escapeHtml(initials(n.fromName || 'Member')),
    title: `${n.fromName || 'Someone'} ${verb[n.type] || 'was active'}`,
    sub: (n.preview || '').replace(/\s+/g, ' ').slice(0, 110) || 'Open the community to see it.',
    meta: n.createdAt ? fmtRelative(n.createdAt) : ''
  })).join('');
  return activityCache.you;
}

function wireActivityTabs({ role, companyId, notifications }) {
  const tabs = $('hub-activity-tabs');
  const list = $('hub-activity-list');
  if (!tabs || !list) return;

  async function show(feed) {
    list.innerHTML = `<div class="academy-empty">Loading…</div>`;
    list.innerHTML = feed === 'you'
      ? await loadYouFeed(notifications)
      : await loadCommunityFeed({ role, companyId });
  }

  tabs.querySelectorAll('.hub-activity-tab').forEach((b) => {
    b.addEventListener('click', () => {
      tabs.querySelectorAll('.hub-activity-tab').forEach((o) => {
        o.classList.toggle('is-active', o === b);
        o.setAttribute('aria-selected', o === b ? 'true' : 'false');
      });
      show(b.dataset.feed);
    });
  });

  show('community');
}

// ─── Events rail ──────────────────────────────────────────────────────────

function renderEventsRail() {
  const list = $('hub-events-list');
  if (!list) return;

  if (!eventFeed.length) {
    list.innerHTML = `
      <a class="academy-list-item" href="/book-a-call.html">
        <div class="academy-list-avatar">1:1</div>
        <div class="academy-list-main">
          <div class="academy-list-title">Book time with Anthony</div>
          <div class="academy-list-sub">Nothing on the calendar yet. Bring the real question.</div>
        </div>
        <div class="academy-list-meta">Book</div>
      </a>`;
    return;
  }

  list.innerHTML = eventFeed.slice(0, 5).map((e) => {
    const when = e.recurringLabel || fmtDateTime(e.startsAtMs);
    const badge = e.startsAtMs
      ? new Date(e.startsAtMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
      : '↻';
    const href = e.registered && e.joinUrl ? e.joinUrl : (e.href || '/events');
    const external = !!(e.registered && e.joinUrl);
    return `
      <a class="academy-list-item" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>
        <div class="academy-list-avatar">${escapeHtml(badge)}</div>
        <div class="academy-list-main">
          <div class="academy-list-title">${escapeHtml(e.title)}</div>
          <div class="academy-list-sub">${escapeHtml(when)}</div>
        </div>
        <div class="academy-list-meta">${escapeHtml(e.registered ? (e.joinUrl ? 'Join' : 'Going') : 'Register')}</div>
      </a>`;
  }).join('');
}

// ─── Leaderboard ──────────────────────────────────────────────────────────

function renderLeaderboard(rows, stats, uid) {
  const list = $('hub-leaderboard');
  if (!list) return;

  const ranked = (rows || []).slice().sort((a, b) => b.statsWeekPoints - a.statsWeekPoints);
  const top = ranked.filter((r) => r.statsWeekPoints > 0).slice(0, 3);

  if (!top.length) {
    list.innerHTML = `
      <a class="academy-list-item" href="/community.html">
        <div class="academy-list-avatar">1</div>
        <div class="academy-list-main">
          <div class="academy-list-title">The board is open</div>
          <div class="academy-list-sub">Nobody has scored this week. First post takes the lead.</div>
        </div>
        <div class="academy-list-meta">Post</div>
      </a>`;
    return;
  }

  const myRank = ranked.findIndex((r) => r.uid === uid);
  const rowsHtml = top.map((r, i) => activityRow({
    href: '/community.html',
    avatar: r.avatarUrl
      ? `<img src="${escapeHtml(r.avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : escapeHtml(initials(r.displayName)),
    title: `${i + 1}. ${r.displayName}`,
    sub: `Level ${r.level} · ${r.statsPoints} points all time`,
    meta: `${r.statsWeekPoints} pts`
  })).join('');

  // Where the member actually stands, but only once they are on the board —
  // telling somebody they are unranked is not motivation.
  const mine = myRank >= 0 && myRank > 2
    ? activityRow({
      href: '/community.html',
      avatar: 'You',
      title: `${myRank + 1}. You`,
      sub: `Level ${levelProgress((stats && stats.points) || 0).level} · ${(stats && stats.points) || 0} points all time`,
      meta: `${ranked[myRank].statsWeekPoints} pts`
    })
    : '';

  list.innerHTML = rowsHtml + mine;
}

// ─── Explore next ─────────────────────────────────────────────────────────

async function renderExplore() {
  const section = $('hub-explore');
  const row = $('hub-explore-list');
  if (!section || !row) return;

  const cards = [];

  availableCourses().slice(0, 4).forEach((c) => {
    const price = priceInfo(c);
    const status = c.status === 'live' ? 'Enroll now' : 'Coming soon';
    cards.push(`
      <a class="hub-explore-card" href="/courses.html?course=${encodeURIComponent(c.slug)}">
        <span class="hub-explore-eyebrow">${escapeHtml(status)}</span>
        <span class="hub-explore-title">${escapeHtml(c.title)}</span>
        <span class="hub-explore-sub">${escapeHtml(c.short || c.subtitle || '')}</span>
        <span class="hub-explore-price">${escapeHtml(price.label || '')}</span>
      </a>`);
  });

  try {
    const products = await visibleProducts();
    products.slice(0, 2).forEach((p) => cards.push(`
      <a class="hub-explore-card" href="/upcoming.html">
        <span class="hub-explore-eyebrow">${escapeHtml(p.status === 'live' ? 'Available' : 'Pre-order')}</span>
        <span class="hub-explore-title">${escapeHtml(p.name || 'New release')}</span>
        <span class="hub-explore-sub">${escapeHtml(p.summary || '')}</span>
        <span class="hub-explore-price">${escapeHtml(p.price != null ? `$${p.price}` : '')}</span>
      </a>`));
  } catch (e) { /* non-fatal */ }

  if (!cards.length) { section.hidden = true; return; }
  row.innerHTML = cards.join('');
  section.hidden = false;
}

// ─── Invite & Earn ────────────────────────────────────────────────────────
// The member's own referral link plus its running totals. Stays hidden until
// the callable answers, so a failure here shows nothing rather than a broken
// card — and it is never awaited by main().
async function renderReferral() {
  const sec = $('hub-referral');
  if (!sec || !firebaseReady || !currentUser()) return;

  let info;
  try {
    info = await getMyReferralCode();
  } catch (e) {
    console.warn('[hub] referral link unavailable', e);
    return;
  }
  if (!info || !info.url) return;

  // Build the link from the origin the member is actually on, so it carries
  // whichever domain they're browsing rather than the server's hardcoded
  // APP_BASE_URL. Falls back to the server's URL if the token is missing.
  const shareUrl = info.token
    ? `${location.origin}/signup.html?invite=${encodeURIComponent(info.token)}`
    : info.url;

  const per = Number(info.pointsPerReferral || 0);
  const joined = Number(info.joined || 0);
  const activated = Number(info.activated || 0);

  $('ref-per').textContent = String(per);
  $('ref-url').value = shareUrl;
  $('ref-joined').textContent = String(joined);
  $('ref-activated').textContent = String(activated);
  $('ref-points').textContent = String(Number(info.pointsEarned || 0));

  // Explain the gap between the two counts rather than leaving people to
  // wonder why an invite they know landed hasn't scored yet.
  const pending = Math.max(0, joined - activated);
  $('ref-note').textContent = pending
    ? `${pending} ${pending === 1 ? 'person has' : 'people have'} signed up but not finished their profile yet — points land once they do.`
    : 'Points are awarded once someone you invited completes their profile.';

  const urlInput = $('ref-url');
  const copyBtn = $('ref-copy');
  copyBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(shareUrl);
      else { urlInput.select(); document.execCommand('copy'); }
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
    } catch (e) { urlInput.select(); }
  });

  // Native share sheet on phones — the primary way this link will actually move.
  if (navigator.share) {
    const shareBtn = $('ref-share');
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: 'The One Percent Academy',
          text: 'Join me in The One Percent Academy.',
          url: shareUrl
        });
      } catch (e) { /* user dismissed the sheet */ }
    });
  }

  sec.hidden = false;
}

// ─── Boot ─────────────────────────────────────────────────────────────────

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
      return;
    }
    if (!(await ensureOnboarded(user))) return;
  }

  // Paint the header before anything that touches the network. Everything below
  // can be slow or fail; the Admin/Owner menu lives up here and must not go with it.
  renderTopbarEarly({ user: currentUser(), currentPage: 'dashboard', links: [] });

  // Wave one: the identity and enrollment facts every later section depends on.
  const [, , roleRes, profileRes] = await Promise.allSettled([
    store.load(),
    loadEnrollments(),
    firebaseReady && currentUser() ? getRoleInfo() : Promise.resolve(null),
    firebaseReady && currentUser() ? getUserProfile(currentUser().uid) : Promise.resolve(null)
  ]);

  const roleInfo = roleRes.status === 'fulfilled' ? roleRes.value : null;
  const role = roleInfo ? roleInfo.role : null;
  const companyId = roleInfo ? (roleInfo.companyId || null) : null;
  const profile = profileRes.status === 'fulfilled' ? profileRes.value : null;
  const uid = currentUser() ? currentUser().uid : null;

  renderGreeting(currentUser(), profile);

  // Wave two: everything else, in parallel. Each entry is independently
  // fail-soft so one slow or blocked read cannot hold up the rest of the page.
  const settle = (p, fallback) => p.then((v) => v).catch(() => fallback);

  const [
    , events, stats, leaderboard, notifications, hasNewCommunity, streak, certification
  ] = await Promise.all([
    settle(loadCompletions(), null),
    settle(loadEventFeed(), []),
    settle(getMyStats(), null),
    settle(getLeaderboard({ scope: 'global', limit: 25 }), { rows: [] }),
    settle(listRecentNotifs({ limit: 12 }), []),
    settle(firebaseReady && uid ? hasNewPostsSinceVisit({ role, companyId }) : Promise.resolve(false), false),
    settle(
      firebaseReady && uid
        ? httpsCallable(functions, 'touchDailyStreak')({}).then((r) => r.data)
        : Promise.resolve(null),
      null
    ),
    settle(
      firebaseReady && uid && isEnrolled('1p-clc')
        ? httpsCallable(functions, 'getCertificationStatus')({ slug: '1p-clc' }).then((r) => r.data)
        : Promise.resolve(null),
      null
    )
  ]);

  eventFeed = events;

  renderStatbar({ streak, stats, hasNewCommunity });
  renderContinueCard();
  renderModuleMap();
  renderEventsRail();
  renderLeaderboard(leaderboard.rows, stats, uid);
  renderUserChip(currentUser(), role, { profile, hasNewCommunity });
  wireActivityTabs({ role, companyId, notifications });

  renderNextSteps(buildNextSteps({
    enrolled: enrolledCourses()
      .map((c) => ({ course: c, completion: completions.get(c.slug) }))
      .filter((r) => r.completion),
    events: eventFeed,
    notifications,
    profile,
    certification,
    // A member with zero posts has never spoken here; that is worth a nudge.
    hasPosted: !stats || Number(stats.postCount || 0) > 0
  }));

  // Below the fold and never awaited — the page is already usable without them.
  renderSpotlightRail({ role, companyId });
  renderExplore();
  renderReferral();
  renderOwnerPulse(role);
}

main();
