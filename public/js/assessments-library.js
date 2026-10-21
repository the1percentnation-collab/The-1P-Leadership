// /assessments — the free assessment library.
//
// Renders straight from the registry, so a new data file shows up here with
// no page edit. Signed-in members also see which ones they have taken and
// their last result (users/{uid}/assessments, written by submitAssessment).
import { ASSESSMENTS } from './assessments-data.js';
import { CATEGORIES } from './assessment-core.js';
import { onAuthReady } from './auth.js';
import { markVisited } from './assessment-prompt-core.js';
import { db, firebaseReady } from './firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const href = (a) => `/assessments/${a.slug}${location.search}`;

let taken = {};
let filter = 'all';

function card(a, i) {
  const t = taken[a.slug];
  const badge = t ? `<span class="done">Taken${t.label ? ': ' + esc(t.label) : ''}</span>` : '';
  return `<a class="card" href="${href(a)}">
    ${badge}
    <div class="num">${String(i + 1).padStart(2, '0')}${i === 0 && !t ? '<span class="first">Start here</span>' : ''}</div>
    <h3>${esc(a.title)}</h3>
    <div class="hook">${esc(a.hook)}</div>
    <div class="desc">${esc(a.short)}</div>
    <div class="meta"><span>${a.questions.length} questions · ${a.minutes} min</span><span class="go">${t ? 'Retake' : 'Start'} →</span></div>
  </a>`;
}

function renderFeatured() {
  const a = ASSESSMENTS.find((x) => x.featured) || ASSESSMENTS[0];
  const dims = a.dimensions.map((d) => `<li><span><b>${esc(d.label)}.</b> ${esc(d.desc)}</span></li>`).join('');
  $('featured').innerHTML = `<div class="featured">
    <div class="featured-body">
      <div class="eyebrow">Start here · Most taken</div>
      <h2 class="display">${esc(a.title)}</h2>
      <p>${esc(a.hook)} ${esc(a.short)}</p>
      <a class="btn btn-red" href="${href(a)}">Take the free scorecard</a>
    </div>
    <ul class="featured-side">${dims}</ul>
  </div>`;
}

function renderFilters() {
  const chips = [{ key: 'all', label: 'All' }].concat(CATEGORIES)
    .filter((c) => c.key === 'all' || ASSESSMENTS.some((a) => a.category === c.key));
  $('filters').innerHTML = chips.map((c) =>
    `<button class="chip" type="button" data-cat="${c.key}" aria-pressed="${c.key === filter}">${esc(c.label)}</button>`).join('');
  $('filters').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.cat;
    renderFilters();
    renderLibrary();
  }));
}

function renderLibrary() {
  $('library').innerHTML = CATEGORIES
    .filter((c) => filter === 'all' || filter === c.key)
    .map((c) => {
      const list = ASSESSMENTS.filter((a) => a.category === c.key);
      if (!list.length) return '';
      return `<section class="cat-block" id="cat-${c.key}">
        <div class="cat-head"><h2 class="display">${esc(c.label)}</h2><p>${esc(c.blurb)}</p></div>
        <div class="grid">${list.map(card).join('')}</div>
      </section>`;
    }).join('');
}

$('stat-count').textContent = ASSESSMENTS.length;
const pre = new URLSearchParams(location.search).get('category');
if (pre && CATEGORIES.some((c) => c.key === pre)) filter = pre;
renderFeatured();
renderFilters();
renderLibrary();
markVisited();
if (typeof gtag === 'function') gtag('event', 'assessment_library_view');

onAuthReady(async (user) => {
  if (!user || !firebaseReady) return;
  const nav = $('nav-account');
  nav.textContent = 'My Portal';
  nav.href = '/dashboard';
  try {
    const snap = await getDocs(collection(db, 'users', user.uid, 'assessments'));
    snap.forEach((d) => { taken[d.id] = d.data(); });
    renderLibrary();
  } catch (e) {
    console.warn('[assessments] could not load past results', e && e.message);
  }
});
