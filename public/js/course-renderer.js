// Generic course workspace renderer — mounts any course whose content lives
// in Firestore (`courses/{slug}/modules/{id}`, authored in /manage-courses.html)
// into the standard #workspace-live-content shell. Mirrors app.js (the 1P-CLC
// controller) so the look, nav, and progress behavior match code-built courses.
//
// Progress is namespaced per course: users/{uid}/progress/{slug}__m{id}
// (the shared store.js owns the un-namespaced ids used by 1P-CLC).

import { auth, db, firebaseReady } from './firebase.js';
import {
  doc, setDoc, getDocs, collection, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { escapeHtml } from './community.js';
import { loadModuleDocs } from './courses-data.js';
import { renderCertCta } from './certificates.js';

const $ = (id) => document.getElementById(id);

let _purify = null;
async function getPurify() {
  if (_purify) return _purify;
  const mod = await import('https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs');
  _purify = mod.default || mod;
  return _purify;
}

function progressDocId(slug, moduleId) { return `${slug}__m${moduleId}`; }

const LS_PREFIX = '1p_course_progress_';

function lsGetProgress(slug) {
  try { return new Set(JSON.parse(localStorage.getItem(LS_PREFIX + slug) || '[]')); }
  catch (e) { return new Set(); }
}
function lsSetProgress(slug, set) {
  try { localStorage.setItem(LS_PREFIX + slug, JSON.stringify(Array.from(set))); } catch (e) {}
}

/** Completed module ids for a Firestore-rendered course. */
export async function loadCourseProgress(slug) {
  if (!firebaseReady || !auth || !auth.currentUser) return lsGetProgress(slug);
  try {
    const snap = await getDocs(collection(db, 'users', auth.currentUser.uid, 'progress'));
    const prefix = `${slug}__m`;
    const done = new Set();
    snap.docs.forEach((d) => {
      if (d.id.startsWith(prefix) && d.data().completed) {
        done.add(Number(d.id.slice(prefix.length)));
      }
    });
    lsSetProgress(slug, done);
    return done;
  } catch (e) {
    console.warn('[course-renderer] progress load failed', e);
    return lsGetProgress(slug);
  }
}

async function markComplete(slug, moduleId, completedSet) {
  completedSet.add(moduleId);
  lsSetProgress(slug, completedSet);
  if (firebaseReady && auth && auth.currentUser) {
    try {
      await setDoc(doc(db, 'users', auth.currentUser.uid, 'progress', progressDocId(slug, moduleId)), {
        completed: true,
        completedAt: serverTimestamp(),
        courseSlug: slug,
        moduleId
      }, { merge: true });
    } catch (e) {
      console.warn('[course-renderer] markComplete remote write failed', e);
    }
  }
}

// ─── Mount ────────────────────────────────────────────────────────────────

const state = {
  slug: null,
  modules: [],
  completed: new Set(),
  currentIdx: 0,
  bound: false
};

function currentModule() { return state.modules[state.currentIdx]; }

function buildNav() {
  const container = $('nav-container');
  if (!container) return;
  let html = '<div class="pillar-section">';
  state.modules.forEach((m, idx) => {
    const isActive = idx === state.currentIdx;
    const isDone = state.completed.has(m.id);
    html += `
      <div class="nav-item ${isActive ? 'active' : ''} ${isDone && !isActive ? 'completed' : ''}" data-nav-idx="${idx}">
        <div class="nav-num">${isDone ? '' : `<span>${idx + 1}</span>`}</div>
        <div class="nav-text">
          <div class="nav-title">${escapeHtml(m.title || `Module ${m.id}`)}</div>
          <div class="nav-meta">${escapeHtml(m.duration || '')}</div>
        </div>
        ${m.tagLabel ? `<span class="nav-tag tag-all">${escapeHtml(m.tagLabel)}</span>` : ''}
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
  container.querySelectorAll('[data-nav-idx]').forEach((el) => {
    el.addEventListener('click', () => { state.currentIdx = Number(el.dataset.navIdx); render(); });
  });
}

function updateTopBar(course) {
  const m = currentModule();
  const bc = $('breadcrumb');
  if (bc && m) {
    bc.innerHTML = `<a href="/index.html" class="breadcrumb-link">Academy</a> / ` +
      `<a href="/courses.html" class="breadcrumb-link">Courses</a> / ` +
      `<a href="/courses.html?course=${encodeURIComponent(state.slug)}" class="breadcrumb-link">${escapeHtml(course.short || course.title)}</a> / ` +
      `<span>${escapeHtml(m.title || '')}</span>`;
  }
  const cur = $('cur-mod');
  const total = $('total-mod');
  if (cur) cur.textContent = state.currentIdx + 1;
  if (total) total.textContent = state.modules.length;

  const prev = $('btn-prev');
  const next = $('btn-next');
  if (prev) prev.style.display = state.currentIdx === 0 ? 'none' : '';
  if (next) next.style.display = state.currentIdx === state.modules.length - 1 ? 'none' : '';

  const isLast = state.currentIdx === state.modules.length - 1;
  const complete = $('btn-complete');
  if (complete && m) {
    if (state.completed.has(m.id)) {
      complete.textContent = isLast ? '✓ Course Complete' : '✓ Completed — Next Module →';
      complete.className = 'btn btn-success';
      complete.onclick = () => navigate(1);
    } else {
      complete.textContent = isLast ? 'Mark Complete & Finish →' : 'Mark Complete & Continue →';
      complete.className = 'btn btn-primary';
      complete.onclick = async () => {
        await markComplete(state.slug, m.id, state.completed);
        if (!isLast) navigate(1); else render();
      };
    }
  }

  const totalDone = state.modules.filter((mod) => state.completed.has(mod.id)).length;
  const pct = state.modules.length ? Math.round((totalDone / state.modules.length) * 100) : 0;
  const fill = $('progress-fill');
  const pctEl = $('progress-pct');
  if (fill) fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';

  const statusEl = $('cert-status-val');
  if (statusEl) {
    statusEl.textContent = totalDone === 0 ? 'Not Started'
      : (totalDone < state.modules.length ? 'In Progress' : 'Complete!');
    statusEl.className = totalDone === state.modules.length && state.modules.length
      ? 'cert-status-val active' : 'cert-status-val';
  }

  // Downloadable certificate once every module is complete (server-issued).
  const certDl = $('cert-download');
  if (certDl) {
    if (state.modules.length && totalDone === state.modules.length) {
      renderCertCta(state.slug, certDl);
      setTimeout(() => renderCertCta(state.slug, certDl), 4000);
    } else {
      certDl.innerHTML = '';
    }
  }

  const footer = $('footer-progress');
  if (footer) footer.innerHTML = `Module <span>${state.currentIdx + 1}</span> of <span>${state.modules.length}</span>`;
}

let _course = null;

async function render() {
  const m = currentModule();
  const area = $('content-area');
  if (!area || !m) return;
  const purify = await getPurify();
  area.style.animation = 'none';
  void area.offsetHeight;
  area.style.animation = '';
  area.innerHTML = `
    <div class="lesson-header">
      <div class="academy-eyebrow">${escapeHtml(m.pillar || '')}${m.duration ? ` · ${escapeHtml(m.duration)}` : ''}</div>
      <h1>${escapeHtml(m.title || '')}</h1>
      ${m.subtitle ? `<p class="lesson-subtitle">${escapeHtml(m.subtitle)}</p>` : ''}
    </div>
    <div class="lesson-body">${purify.sanitize(m.html || '', { USE_PROFILES: { html: true } })}</div>
  `;
  buildNav();
  updateTopBar(_course);
  const scroller = document.querySelector('.workspace-live-content')
    || document.querySelector('.courses-main');
  if (scroller) scroller.scrollTo(0, 0);
}

function navigate(dir) {
  const next = state.currentIdx + dir;
  if (next >= 0 && next < state.modules.length) {
    state.currentIdx = next;
    render();
  }
}

export async function mountFirestoreCourse(course, { startAt } = {}) {
  _course = course;
  state.slug = course.slug;
  state.modules = await loadModuleDocs(course.slug);
  state.completed = await loadCourseProgress(course.slug);

  const area = $('content-area');
  if (state.modules.length === 0) {
    if (area) area.innerHTML = '<p style="color:var(--gray-mid); padding:24px;">Course content is being prepared. Check back soon.</p>';
    return;
  }

  // `startAt` is a module id (matches the roadmap links).
  const idx = state.modules.findIndex((m) => m.id === startAt);
  state.currentIdx = idx >= 0 ? idx : 0;

  await render();

  if (!state.bound) {
    state.bound = true;
    const prev = $('btn-prev');
    const next = $('btn-next');
    if (prev) prev.addEventListener('click', () => navigate(-1));
    if (next) next.addEventListener('click', () => navigate(1));
  }
}
