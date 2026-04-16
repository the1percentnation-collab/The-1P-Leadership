import { store, saveNote } from './store.js';
import { MODULES, PILLARS } from './modules.js';

const $ = (id) => document.getElementById(id);

function buildNav() {
  const container = $('nav-container');
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
  $('breadcrumb').innerHTML = `<span>1P-CLC</span> / ${m.title}`;
  $('cur-mod').textContent = store.currentModule;
  $('total-mod').textContent = MODULES.length - 1;

  const prev = $('btn-prev');
  const next = $('btn-next');
  const complete = $('btn-complete');

  prev.style.display = store.currentModule === 0 ? 'none' : '';
  next.style.display = store.currentModule === MODULES.length - 1 ? 'none' : '';

  const isLast = store.currentModule === MODULES.length - 1;
  if (store.isComplete(store.currentModule)) {
    complete.textContent = isLast ? '✓ Certification Submitted' : '✓ Completed — Next Module →';
    complete.className = 'btn btn-success';
    complete.onclick = () => navigate(1);
  } else {
    complete.textContent = isLast ? 'Submit for Certification →' : 'Mark Complete & Continue →';
    complete.className = 'btn btn-primary';
    complete.onclick = completeModule;
  }

  const totalDone = store.completed.size;
  const pct = Math.round((totalDone / MODULES.length) * 100);
  $('progress-fill').style.width = pct + '%';
  $('progress-pct').textContent = pct + '%';

  const statusEl = $('cert-status-val');
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

  $('footer-progress').innerHTML = `Module <span>${store.currentModule}</span> of <span>${MODULES.length - 1}</span>`;
}

function bindNotes() {
  document.querySelectorAll('[data-note-key]').forEach((el) => {
    el.addEventListener('input', (e) => saveNote(el.dataset.noteKey, e.target.value));
  });
}

function render() {
  const m = MODULES[store.currentModule];
  const area = $('content-area');
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
    document.querySelector('.main').scrollTo(0, 0);
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

$('btn-prev').addEventListener('click', () => navigate(-1));
$('btn-next').addEventListener('click', () => navigate(1));

store.load();
render();
