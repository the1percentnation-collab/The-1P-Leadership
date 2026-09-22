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
import { renderShell } from './academy-shell.js';
import { ensureOnboarded } from './onboarding-guard.js';
import { isFirstVisit, renderWelcome } from './hub-welcome.js';
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
import { loadEnrollments, enrolledCourses, isEnrolled } from './enrollments.js';
import { loadCourseCompletion } from './course-progress.js';
import { loadCatalog, visibleOn, hrefFor, isExternal, sortForDisplay } from './catalog.js';
import { fmtLaunchDate, launchCountdown } from './launch-date.js';
import { listActiveAnnouncements } from './announcements.js';
import { renderSpotlight } from './hub-spotlight.js';
import { buildNextSteps } from './hub-nextup.js';
import { dailySeries, seriesTotal } from './points-history.js';

const $ = (id) => document.getElementById(id);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Completion state per enrolled course, resolved once per page load and shared
// by the continue card, the course list, the module map and the next-step
// engine. Every one of them used to answer this question differently.
let completions = new Map(); // slug -> { modules, completed, done, total, pct, isComplete }
let eventFeed = [];          // normalized upcoming events, soonest first
let spotlightHandle = null;
let catalogPromise = null;   // shared by the spotlight and the explore row

// Everything switched on for the dashboard, courses and products alike, in
// the shared catalog shape. One read for both sections that need it.
function dashboardCatalog() {
  if (!catalogPromise) {
    catalogPromise = loadCatalog()
      .then((items) => sortForDisplay(items.filter((i) => visibleOn(i, 'dashboard'))))
      .catch(() => []);
  }
  return catalogPromise;
}

function whenLabel(item) {
  if (item.status === 'live') return '';
  return item.launchDateMs && launchCountdown(item.launchDateMs)
    ? `Opens ${fmtLaunchDate(item.launchDateMs, { short: true })}`
    : 'Coming soon';
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

function renderUserChip(user, role, { profile = null } = {}) {
  // Nav and sign-out live in the sidebar now, so the chip is reduced to the
  // three things that belong beside a search field: search, bell, avatar.
  renderTopbar({
    user, profile, role,
    currentPage: 'dashboard',
    links: [],
    withSignOut: false
  });
}

function greetingName(user, profile) {
  return firstName((profile && profile.displayName) || (user && user.displayName) || (user && user.email));
}

// "Welcome back" to someone who has never been here reads like the portal
// wasn't paying attention. First visit gets "Welcome"; every one after it
// gets the returning greeting.
function renderGreeting(user, profile, { firstVisit = false } = {}) {
  const name = greetingName(user, profile);
  const lead = firstVisit ? 'Welcome' : 'Welcome back';
  $('hub-greeting').innerHTML = `${lead}, <span>${escapeHtml(name)}</span>.`;
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

  const [announcements, catalog] = await Promise.all([
    listActiveAnnouncements({ role, companyId, enrolledSlugs: new Set(enrolledCourses().map((c) => c.slug)) }).catch(() => []),
    dashboardCatalog()
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

  // Catalog items the member does not already hold: up to three products,
  // then up to two courses. Capped so the rail stays a noticeboard rather
  // than a storefront — the Store tab is the storefront.
  const enrolledSlugs = new Set(enrolledCourses().map((c) => c.slug));
  const forRail = catalog.filter((i) => !(i.kind === 'course' && enrolledSlugs.has(i.slug)));

  forRail.filter((i) => i.kind === 'product').slice(0, 3).forEach((i) => slides.push({
    id: `p-${i.id}`,
    kind: 'product',
    eyebrow: i.onSale ? 'On sale' : (i.status === 'live' ? 'Now available' : (i.status === 'preorder' ? 'Pre-order open' : whenLabel(i))),
    title: i.title,
    body: i.summary,
    imageUrl: i.imageUrl,
    meta: i.label ? (i.onSale ? `${i.originalLabel} → ${i.label}` : i.label) : '',
    ctaLabel: i.status === 'live' || i.status === 'preorder' ? 'Get it' : 'Notify me',
    ctaHref: hrefFor(i, 'dashboard'),
    external: isExternal(hrefFor(i, 'dashboard')),
    priority: 40,
    sortAt: i.launchDateMs || 0
  }));

  forRail.filter((i) => i.kind === 'course' && i.status === 'live').slice(0, 2).forEach((i) => slides.push({
    id: `c-${i.slug}`,
    kind: 'course',
    eyebrow: i.onSale ? 'On sale' : 'Open for enrollment',
    title: i.title,
    body: i.summary,
    // The catalog reads the cover the builder actually writes (`coverImage`);
    // this used to read `imageUrl`, which no course has, so course slides
    // never carried art.
    imageUrl: i.imageUrl,
    meta: i.label || '',
    ctaLabel: 'Learn more',
    ctaHref: hrefFor(i, 'dashboard'),
    priority: 30,
    sortAt: 0
  }));

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

// ─── Coming up (table) ────────────────────────────────────────────────────

function renderEventsTable() {
  const section = $('hub-events');
  const rows = $('hub-events-rows');
  if (!section || !rows) return;

  if (!eventFeed.length) { section.hidden = true; return; }

  rows.innerHTML = eventFeed.slice(0, 6).map((e) => {
    const when = e.recurringLabel || fmtDateTime(e.startsAtMs);
    const href = e.registered && e.joinUrl ? e.joinUrl : (e.href || '/events');
    const external = !!(e.registered && e.joinUrl);
    const status = e.registered
      ? `<span class="hub-pill is-going">Going</span>`
      : `<span class="hub-pill">Open</span>`;
    const action = e.registered && e.joinUrl ? 'Join' : (e.registered ? 'Details' : 'Register');
    const countdown = e.startsAtMs ? fmtCountdown(e.startsAtMs) : '';
    return `
      <tr>
        <td>
          <div class="hub-td-strong">${escapeHtml(when)}</div>
          ${countdown ? `<div class="hub-td-sub">${escapeHtml(countdown)} away</div>` : ''}
        </td>
        <td>${escapeHtml(e.title)}</td>
        <td>${status}</td>
        <td class="hub-td-action">
          <a class="hub-rowbtn" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(action)}</a>
        </td>
      </tr>`;
  }).join('');
  section.hidden = false;
}

// ─── Continue watching ────────────────────────────────────────────────────
//
// One card per enrolled course, ordered by momentum: the course furthest
// along and still open comes first, finished courses last. Same ranking the
// continue card uses, so the two never disagree about what you are working on.

function renderWatching() {
  const section = $('hub-watching');
  const row = $('hub-watch-list');
  if (!section || !row) return;

  const cards = enrolledCourses()
    .map((c) => ({ course: c, completion: completions.get(c.slug) }))
    .filter((r) => r.completion)
    .sort((a, b) => {
      const aOpen = a.completion.total > 0 && !a.completion.isComplete;
      const bOpen = b.completion.total > 0 && !b.completion.isComplete;
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      return b.completion.done - a.completion.done;
    });

  if (!cards.length) { section.hidden = true; return; }

  row.innerHTML = cards.map(({ course, completion }) => {
    const next = completion.modules.find((m) => !completion.completed.has(m.id));
    const href = `/courses.html?course=${encodeURIComponent(course.slug)}${next ? `&module=${next.id}` : ''}`;
    const cover = course.coverImage || course.image;
    const art = cover
      ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.remove()">`
      : '';
    const mark = escapeHtml((course.short || course.title || '1P').slice(0, 18));
    const sub = completion.total
      ? `${completion.done} of ${completion.total} modules`
      : 'Not started';
    return `
      <a class="hub-watch-card" href="${href}">
        <span class="hub-watch-art">${art}<span class="hub-watch-mark">${mark}</span></span>
        <span class="hub-watch-body">
          <span class="hub-pill">${escapeHtml(course.category || course.kind || 'Course')}</span>
          <span class="hub-watch-title">${escapeHtml(course.title)}</span>
          <span class="progress-bar"><span class="progress-fill" style="width:${completion.pct}%"></span></span>
          <span class="hub-watch-meta">${escapeHtml(sub)} · ${completion.pct}%</span>
        </span>
      </a>`;
  }).join('');
  section.hidden = false;
}

// ─── Right rail: who you are, how you're tracking, who's ahead ────────────

// The profile block. The ring around the avatar is level progress, not
// decoration: it fills toward the next level using the same thresholds the
// community page uses, so the two agree.
function renderMe(user, profile, stats, streak) {
  const el = $('hub-me');
  if (!el) return;

  const name = (profile && profile.displayName) || (user && user.displayName) || (user && user.email) || 'Member';
  const prog = levelProgress((stats && stats.points) || 0);
  const avatar = profile && profile.avatarUrl
    ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="">`
    : `<span>${escapeHtml(initials(name))}</span>`;

  const facts = [];
  if (streak && streak.currentStreak > 0) {
    facts.push([streak.currentStreak, streak.currentStreak === 1 ? 'day streak' : 'day streak']);
  }
  facts.push([prog.level, 'level']);
  facts.push([(stats && stats.points) || 0, 'points']);

  el.innerHTML = `
    <div class="hub-me-avatar" style="--ring:${prog.pct}%">
      <span class="hub-me-ring"></span>
      <span class="hub-me-face">${avatar}</span>
    </div>
    <div class="hub-me-name">${escapeHtml(name)}</div>
    <div class="hub-me-sub">${escapeHtml(prog.ceiling
      ? `${prog.toNext} points to level ${prog.level + 1}`
      : 'Top level reached')}</div>
    <div class="hub-me-facts">
      ${facts.map(([v, l]) => `
        <div class="hub-me-fact">
          <span class="hub-me-fact-value">${escapeHtml(String(v))}</span>
          <span class="hub-me-fact-label">${escapeHtml(l)}</span>
        </div>`).join('')}
    </div>`;
}

// Seven days of the member's own points, oldest to newest.
//
// This used to plot one bar per member who had scored that week, which on a
// quiet week meant a single bar at full height and full width — a solid
// rectangle rather than a chart. A fixed seven-day window is always seven
// bars, it is about the member rather than the standings (the leaderboard
// directly below already covers those), and a blank week reads as a blank
// week instead of as a broken widget.
function renderChart(stats) {
  const el = $('hub-chart');
  const note = $('hub-chart-note');
  if (!el) return;

  const series = dailySeries(stats && stats.dailyPoints, { days: 7 });
  const total = seriesTotal(series);
  const max = Math.max(...series.map((d) => d.value));

  el.innerHTML = series.map((d) => {
    // An empty day still gets a visible stub, so the axis reads as seven days
    // rather than as a chart with holes in it.
    const pct = max > 0 ? Math.max(6, Math.round((d.value / max) * 100)) : 6;
    const when = d.isToday ? 'today' : d.key;
    return `
      <div class="hub-bar-col" title="${escapeHtml(`${d.value} ${d.value === 1 ? 'point' : 'points'} ${when}`)}">
        <div class="hub-bar${d.value > 0 ? ' has-value' : ''}${d.isToday ? ' is-today' : ''}"
             style="--h:${pct}%"></div>
        <span class="hub-bar-label">${escapeHtml(d.label)}</span>
      </div>`;
  }).join('');

  // The heading's note carries the number, so the bars don't need axis labels.
  if (note) note.textContent = total > 0 ? `${total} pts` : 'No points yet';
}

function renderLeaderboard(rows, stats, uid) {
  const list = $('hub-leaderboard');
  if (!list) return;

  const ranked = (rows || []).slice().sort((a, b) => b.statsWeekPoints - a.statsWeekPoints);
  const top = ranked.filter((r) => r.statsWeekPoints > 0).slice(0, 5);

  if (!top.length) {
    list.innerHTML = `
      <a class="hub-person" href="/community.html">
        <span class="hub-person-face">1</span>
        <span class="hub-person-main">
          <span class="hub-person-name">The board is open</span>
          <span class="hub-person-sub">Nobody has scored this week.</span>
        </span>
        <span class="hub-rowbtn">Post</span>
      </a>`;
    return;
  }

  const myRank = ranked.findIndex((r) => r.uid === uid);
  const row = (r, i, isMe) => `
    <a class="hub-person${isMe ? ' is-me' : ''}" href="/community.html">
      <span class="hub-person-rank">${i + 1}</span>
      <span class="hub-person-face">${r.avatarUrl
        ? `<img src="${escapeHtml(r.avatarUrl)}" alt="">`
        : escapeHtml(initials(r.displayName))}</span>
      <span class="hub-person-main">
        <span class="hub-person-name">${escapeHtml(isMe ? 'You' : r.displayName)}</span>
        <span class="hub-person-sub">Level ${r.level} · ${r.statsPoints} pts</span>
      </span>
      <span class="hub-person-week">${r.statsWeekPoints}</span>
    </a>`;

  // Where the member actually stands, but only once they are on the board —
  // telling somebody they are unranked is not motivation.
  const mine = myRank > 4 ? row(ranked[myRank], myRank, true) : '';
  list.innerHTML = top.map((r, i) => row(r, i, r.uid === uid)).join('') + mine;
}

// ─── Explore next ─────────────────────────────────────────────────────────

async function renderExplore() {
  const section = $('hub-explore');
  const row = $('hub-explore-list');
  if (!section || !row) return;

  const enrolledSlugs = new Set(enrolledCourses().map((c) => c.slug));
  const items = (await dashboardCatalog())
    .filter((i) => !(i.kind === 'course' && enrolledSlugs.has(i.slug)))
    .slice(0, 6);

  if (!items.length) { section.hidden = true; return; }

  row.innerHTML = items.map((i) => {
    const href = hrefFor(i, 'dashboard');
    const eyebrow = i.onSale ? 'On sale'
      : (i.status === 'live' ? (i.kind === 'course' ? 'Enroll now' : 'Available')
        : (i.status === 'preorder' ? 'Pre-order' : whenLabel(i)));
    const price = i.label
      ? `${i.onSale ? `<s style="color:var(--gray-mid);margin-right:6px;">${escapeHtml(i.originalLabel)}</s>` : ''}${escapeHtml(i.label)}`
      : '';
    return `
      <a class="hub-explore-card" href="${escapeHtml(href)}"${isExternal(href) ? ' target="_blank" rel="noopener"' : ''}>
        <span class="hub-explore-eyebrow">${escapeHtml(eyebrow)}</span>
        <span class="hub-explore-title">${escapeHtml(i.title)}</span>
        <span class="hub-explore-sub">${escapeHtml(i.summary)}</span>
        <span class="hub-explore-price">${price}</span>
      </a>`;
  }).join('');
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

  // Paint the shell before anything that touches the network. Everything below
  // can be slow or fail; navigation must not go with it. Both of these read the
  // role cached in localStorage so an admin's tools don't pop in late.
  renderShell({ current: 'dashboard' });
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

  renderShell({ current: 'dashboard', role });

  // First visit drives both the greeting and the tour, and must be read from
  // the profile as it was BEFORE renderWelcome stamps `welcomeTourAt`.
  const firstVisit = isFirstVisit(profile, uid);
  renderGreeting(currentUser(), profile, { firstVisit });

  // Setup checklist + first-login tour. Staff manage the system rather than
  // enroll in it, so they never see either.
  let setupCardShown = false;
  if (role !== 'owner' && role !== 'admin') {
    setupCardShown = renderWelcome({
      profile,
      uid,
      name: greetingName(currentUser(), profile),
      firstVisit,
      enrolled: enrolledCourses().length > 0
    });
  }

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
  renderWatching();
  renderModuleMap();
  renderEventsTable();
  renderMe(currentUser(), profile, stats, streak);
  renderChart(stats);
  renderLeaderboard(leaderboard.rows, stats, uid);
  renderUserChip(currentUser(), role, { profile });
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
    hasPosted: !stats || Number(stats.postCount || 0) > 0,
    profileNudgeShown: setupCardShown
  }));

  // Below the fold and never awaited — the page is already usable without them.
  renderSpotlightRail({ role, companyId });
  renderExplore();
  renderReferral();
  renderOwnerPulse(role);
}

main();
