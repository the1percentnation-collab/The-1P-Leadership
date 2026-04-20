// 1P Certified Leader Coach — course workspace controller.
// Renders the sidebar nav, module content, and topbar for the 1P-CLC course.
// Exposed as `mount()` so courses-page.js can initialise it when the tab is active.

import { store, saveNote } from './store.js';
import { MODULES, PILLARS } from './modules.js';
import { onAuthReady } from './auth.js';
import { firebaseReady } from './firebase.js';
import { escapeHtml } from './community.js';

const $ = (id) => document.getElementById(id);

function buildNav() {
  const container = $('nav-container');
  if (!container) return;
  let html = '';
  PILLARS.forEach((p) => {
    html += `<div class="pillar-section"><div class="pillar-label">${p.label}</div>`;
    p.ids.forEach((id) => {
      const m = MODULES[id];
      const isActive = id === store.currentModule;
      const isDone = store.isComplete(id);
      html += `
        <div class="nav-item ${isActive ? 'active' : ''} ${isDone && !isActive ? 'completed' : ''}" data-nav-id="${id}">
          <div class="nav-num">${isDone ? '' : `<span>${id}</span>`}</div>
          <div class="nav-text">
            <div class="nav-title">${m.title}</div>
            <div class="nav-meta">${m.duration}</div>
          </div>
          <span class="nav-tag ${m.tag}">${m.tagLabel}</span>
        </div>`;
    });
    html += '</div>';
  });
  container.innerHTML = html;

  container.querySelectorAll('[data-nav-id]').forEach((el) => {
    el.addEventListener('click', () => goTo(Number(el.dataset.navId)));
  });
}

function updateTopBar() {
  const m = MODULES[store.currentModule];
  const bc = $('breadcrumb');
  if (bc) bc.innerHTML = `<a href="/index.html" class="breadcrumb-link">Academy</a> / <a href="/courses.html" class="breadcrumb-link">Courses</a> / <a href="/courses.html?course=1p-clc" class="breadcrumb-link">1P-CLC</a> / <span>${escapeHtml(m.title)}</span>`;
  const cur = $('cur-mod');
  const total = $('total-mod');
  if (cur) cur.textContent = store.currentModule;
  if (total) total.textContent = MODULES.length - 1;

  const prev = $('btn-prev');
  const next = $('btn-next');
  const complete = $('btn-complete');

  if (prev) prev.style.display = store.currentModule === 0 ? 'none' : '';
  if (next) next.style.display = store.currentModule === MODULES.length - 1 ? 'none' : '';

  const isLast = store.currentModule === MODULES.length - 1;
  if (complete) {
    if (store.isComplete(store.currentModule)) {
      complete.textContent = isLast ? '✓ Certification Submitted' : '✓ Completed — Next Module →';
      complete.className = 'btn btn-success';
      complete.onclick = () => navigate(1);
    } else {
      complete.textContent = isLast ? 'Submit for Certification →' : 'Mark Complete & Continue →';
      complete.className = 'btn btn-primary';
      complete.onclick = completeModule;
    }
  }

  const totalDone = store.completed.size;
  const pct = Math.round((totalDone / MODULES.length) * 100);
  const fill = $('progress-fill');
  const pctEl = $('progress-pct');
  if (fill) fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';

  const statusEl = $('cert-status-val');
  if (statusEl) {
    if (store.completed.size === 0) {
      statusEl.textContent = 'Not Started';
      statusEl.className = 'cert-status-val';
    } else if (store.completed.size < MODULES.length) {
      statusEl.textContent = 'In Progress';
      statusEl.className = 'cert-status-val';
    } else {
      statusEl.textContent = 'Certified!';
      statusEl.className = 'cert-status-val active';
    }
  }

  const footer = $('footer-progress');
  if (footer) footer.innerHTML = `Module <span>${store.currentModule}</span> of <span>${MODULES.length - 1}</span>`;
}

function bindNotes() {
  document.querySelectorAll('[data-note-key]').forEach((el) => {
    el.addEventListener('input', (e) => saveNote(el.dataset.noteKey, e.target.value));
  });
}

function render() {
  const m = MODULES[store.currentModule];
  const area = $('content-area');
  if (!area) return;
  area.style.animation = 'none';
  void area.offsetHeight;
  area.style.animation = '';
  area.innerHTML = m.render();
  buildNav();
  updateTopBar();
  bindNotes();
}

function goTo(id) {
  store.setCurrent(id);
  render();
}

function navigate(dir) {
  const next = store.currentModule + dir;
  if (next >= 0 && next < MODULES.length) {
    store.setCurrent(next);
    render();
    const scroller = document.querySelector('.workspace-live-content')
      || document.querySelector('.courses-main')
      || document.querySelector('.main');
    if (scroller) scroller.scrollTo(0, 0);
  }
}

function completeModule() {
  store.markComplete(store.currentModule);
  if (store.currentModule < MODULES.length - 1) {
    navigate(1);
  } else {
    render();
  }
}

let _mounted = false;

export async function mount({ startAt } = {}) {
  // Auth check — courses-page.js also does this, but guard for direct entry.
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html');
      return;
    }
  }

  await store.load();

  if (typeof startAt === 'number' && startAt >= 0 && startAt < MODULES.length) {
    store.setCurrent(startAt);
  }

  render();

  if (_mounted) return;
  _mounted = true;

  const prev = $('btn-prev');
  const next = $('btn-next');
  if (prev) prev.addEventListener('click', () => navigate(-1));
  if (next) next.addEventListener('click', () => navigate(1));
}
