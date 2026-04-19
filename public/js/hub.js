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

function renderContinueCard() {
  const slot = $('hub-continue-slot');
  if (!slot) return;

  const totalModules = MODULES.length - 1; // module 0 is an overview/index in the existing app
  const doneCount = store.completed.size;
  const pct = totalModules > 0 ? Math.round((doneCount / MODULES.length) * 100) : 0;

  const current = MODULES[store.currentModule] || MODULES[0];
  const allDone = doneCount >= MODULES.length;

  let meta = 'Continue your work';
  let title = current ? current.title : 'Start here';
  let sub = 'Pick up where you left off. The work compounds when you stay consistent.';
  let cta = 'Resume course';
  if (doneCount === 0) {
    meta = 'Start your journey';
    title = 'The 1P Certified Leader Coach';
    sub = 'A seven-module path grounded in mindset, structure, and consistent action. Begin at your own pace.';
    cta = 'Begin course';
  } else if (allDone) {
    meta = 'You are certified';
    title = 'Revisit what matters';
    sub = 'The modules stay open. Return when you need to recalibrate or revisit a framework.';
    cta = 'Open course';
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
      <a class="btn btn-primary" href="/courses.html">${escapeHtml(cta)} →</a>
    </div>
  `;

  const label = $('hub-progress-label');
  if (label) label.textContent = `${pct}%`;

  const courseSub = $('hub-course-sub');
  if (courseSub) courseSub.textContent = `${doneCount} of ${MODULES.length} modules complete`;

  const courseStatus = $('hub-course-status');
  if (courseStatus) {
    if (doneCount === 0) courseStatus.textContent = 'Not started';
    else if (allDone) courseStatus.textContent = 'Certified';
    else courseStatus.textContent = 'In progress';
  }
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
  renderUserChip(currentUser(), role, { profile, hasNewCommunity });
  renderCommunityList({ role, companyId });
}

main();
