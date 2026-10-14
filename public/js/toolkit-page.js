// /toolkit — assessments, free reads, calculators and planners: everything a
// member uses rather than enrolls in. Sections and tools come from
// toolkit-data.js; assessments from assessments-data.js; free reads from the
// course registry (`shelf: 'toolkit'`). Replaces the old Resources stub.

import { onAuthReady, currentUser } from './auth.js';
import { ensureOnboarded } from './onboarding-guard.js';
import { getRoleInfo } from './roles.js';
import { db, firebaseReady } from './firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getUserProfile, escapeHtml } from './community.js';
import { renderTopbar, renderTopbarEarly } from './topbar.js';
import { renderShell } from './academy-shell.js';
import { loadCourses, getCourses, isToolkitItem } from './courses-data.js';
import { loadEnrollments, isEnrolled } from './enrollments.js';
import { ASSESSMENTS } from './assessments-data.js';
import { CATEGORIES } from './assessment-core.js';
import { TOOLKIT_SECTIONS, TOOLS } from './toolkit-data.js';

const $ = (id) => document.getElementById(id);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

let taken = {};

// One card shape for every section. No href = not open yet, so no link.
function card({ eyebrow, title, body, meta, cta, href, wide = false }) {
  const inner = `
    ${eyebrow ? `<span class="tk-eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
    <span class="tk-title">${escapeHtml(title)}</span>
    ${body ? `<span class="tk-body">${escapeHtml(body)}</span>` : ''}
    <span class="tk-foot">
      <span class="tk-meta">${escapeHtml(meta || '')}</span>
      ${cta ? `<span class="tk-cta">${escapeHtml(cta)}${href ? ' →' : ''}</span>` : ''}
    </span>`;
  const cls = `tk-card${wide ? ' tk-card--wide' : ''}${href ? '' : ' is-soon'}`;
  return href
    ? `<a class="${cls}" href="${escapeHtml(href)}">${inner}</a>`
    : `<div class="${cls}" aria-disabled="true">${inner}</div>`;
}

function assessmentCards() {
  const featured = ASSESSMENTS.find((a) => a.featured) || ASSESSMENTS[0];
  const cards = [];
  if (featured) {
    const done = taken[featured.slug];
    cards.push(card({
      eyebrow: done ? `Taken${done.label ? ': ' + done.label : ''}` : 'Start here · Most taken',
      title: featured.title,
      body: `${featured.hook} ${featured.short}`,
      meta: `${featured.questions.length} questions · ${featured.minutes} min`,
      cta: done ? 'Retake' : 'Take it free',
      href: `/assessments/${featured.slug}`,
      wide: true
    }));
  }
  CATEGORIES.forEach((c) => {
    const list = ASSESSMENTS.filter((a) => a.category === c.key);
    if (!list.length) return;
    const doneCount = list.filter((a) => taken[a.slug]).length;
    cards.push(card({
      eyebrow: plural(list.length, 'assessment', 'assessments'),
      title: c.label,
      body: c.blurb,
      meta: doneCount ? `${doneCount} of ${list.length} taken` : '',
      cta: 'Browse',
      href: `/assessments?category=${encodeURIComponent(c.key)}`
    }));
  });
  return cards;
}

function readCards() {
  return getCourses()
    .filter((c) => isToolkitItem(c) && c.status !== 'beta')
    .map((c) => {
      const live = c.status === 'live';
      const enrolled = isEnrolled(c.slug);
      return card({
        eyebrow: c.eyebrow || 'Free',
        title: c.title,
        body: c.subtitle || c.short,
        meta: c.priceNote || '',
        cta: !live ? 'Coming soon' : (enrolled ? 'Continue' : 'Start free'),
        href: live ? `/courses.html?course=${encodeURIComponent(c.slug)}` : null
      });
    });
}

function toolCards(sectionKey) {
  return TOOLS.filter((t) => t.section === sectionKey).map((t) => {
    const live = t.status === 'live' && !!t.href;
    return card({
      eyebrow: live ? 'Free tool' : 'Coming soon',
      title: t.title,
      body: t.short,
      meta: t.minutes ? `About ${t.minutes} min` : '',
      cta: live ? 'Open' : '',
      href: live ? t.href : null
    });
  });
}

function sectionCards(key) {
  if (key === 'assessments') return assessmentCards();
  if (key === 'reads') return readCards();
  return toolCards(key);
}

function render() {
  const sections = TOOLKIT_SECTIONS
    .map((s) => ({ ...s, cards: sectionCards(s.key) }))
    .filter((s) => s.cards.length);

  $('tk-jump').innerHTML = sections.map((s) =>
    `<a class="tk-jump-link" href="#tk-${s.key}">${escapeHtml(s.label)}</a>`).join('');

  $('tk-sections').innerHTML = sections.map((s) => {
    const meta = s.key === 'assessments'
      ? `<a class="academy-section-meta tk-see-all" href="/assessments">See all ${ASSESSMENTS.length} →</a>`
      : `<span class="academy-section-meta">${plural(s.cards.length, 'item', 'items')}</span>`;
    return `
      <section class="tk-section" id="tk-${s.key}">
        <div class="academy-section-head"><h2>${escapeHtml(s.label)}</h2>${meta}</div>
        <p class="tk-blurb">${escapeHtml(s.blurb)}</p>
        <div class="tk-grid">${s.cards.join('')}</div>
      </section>`;
  }).join('');
}

async function loadTaken(uid) {
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'assessments'));
    const next = {};
    snap.forEach((d) => { next[d.id] = d.data(); });
    taken = next;
  } catch (e) {
    console.warn('[toolkit] could not load past results', e && e.message);
  }
}

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
      return;
    }
    if (!(await ensureOnboarded(user))) return;
  }

  // Shell first — it carries navigation and must survive a slow or failed
  // load below. It paints from the role cached in localStorage.
  renderShell({ current: 'toolkit' });
  renderTopbarEarly({ user: currentUser(), currentPage: null, links: [] });

  // Paint from code first (assessments and tools need no network), then again
  // once courses, enrolments and past results are in.
  render();
  const uid = firebaseReady && currentUser() ? currentUser().uid : null;
  await Promise.allSettled([
    loadCourses(),
    loadEnrollments(),
    uid ? loadTaken(uid) : Promise.resolve()
  ]);
  render();

  let role = null;
  let profile = null;
  try {
    if (uid) {
      const info = await getRoleInfo();
      role = info.role;
      try { profile = await getUserProfile(uid); } catch (e) {}
    }
  } catch (e) {}

  // Nav and sign-out live in the sidebar, so the chip keeps only search,
  // the bell and the avatar.
  renderShell({ current: 'toolkit', role });
  renderTopbar({ user: currentUser(), profile, role, currentPage: null, links: [], withSignOut: false });
}

main();
