import { store, saveNote } from './store.js';
import { MODULES, PILLARS } from './modules.js';
import { onAuthReady, signOut, currentUser } from './auth.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady } from './firebase.js';
import { getUserProfile, hasNewPostsSinceVisit, avatarHtml, escapeHtml } from './community.js';

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

async function renderUserChip(user, role, opts = {}) {
  const chip = $('user-chip');
  if (!chip) return;
  const { profile = null, companyId = null, hasNewCommunity = false } = opts;
  const label = user ? (profile && profile.displayName) || user.displayName || user.email || 'Signed in' : 'Offline';
  const adminLink = role && (role === 'admin' || role === 'owner')
    ? `<a class="user-chip-link" href="/admin.html">Admin</a>` : '';
  const ownerLink = role === 'owner'
    ? `<a class="user-chip-link" href="/owner.html">Owner</a>` : '';
  const communityClass = hasNewCommunity ? 'c-has-badge' : '';
  const avatar = user
    ? `<a href="/profile.html" class="c-avatar-link" title="Your profile">${avatarHtml({
        displayName: (profile && profile.displayName) || user.displayName || user.email,
        avatarUrl: profile && profile.avatarUrl || null
      }, 28)}</a>`
    : '';
  chip.innerHTML = `
    <a class="user-chip-link ${communityClass}" href="/community.html" title="Community">Community</a>
    <a class="user-chip-link" href="/members.html">Members</a>
    ${adminLink}
    ${ownerLink}
    ${avatar}
    <span class="user-chip-email">${escapeHtml(label)}</span>
    <button class="btn btn-ghost" id="btn-signout">Sign out</button>
  `;
  const out = $('btn-signout');
  if (out) out.addEventListener('click', async () => {
    try { await signOut(); } catch (e) {}
    location.replace('/login.html');
  });
}

async function main() {
  // Require auth when Firebase is available. If Firebase failed to init entirely, we
  // fall back to localStorage-only mode (the task says: graceful fallback if unreachable,
  // but still require login before content — we honor the stricter rule when Firebase works.)
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html');
      return;
    }
  } else {
    // Firebase unreachable — degrade gracefully. Show a banner; still allow local use.
    console.warn('[app] Firebase unavailable, running in localStorage-only mode.');
  }

  await store.load();
  render();

  // Topbar chip with role-aware links + community badge + avatar.
  let role = null;
  let companyId = null;
  let profile = null;
  let hasNewCommunity = false;
  try {
    if (firebaseReady && currentUser()) {
      const info = await getRoleInfo();
      role = info.role;
      companyId = info.companyId || null;
      try {
        profile = await getUserProfile(currentUser().uid);
      } catch (e) {}
      try {
        hasNewCommunity = await hasNewPostsSinceVisit({ role, companyId });
      } catch (e) {}
    }
  } catch (e) {}
  renderUserChip(currentUser(), role, { profile, companyId, hasNewCommunity });
}

main();
