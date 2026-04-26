// Shared topbar renderer (Phase 3 follow-up).
//
// Replaces the per-page renderChip() boilerplate with one call site:
//
//   import { renderTopbar, defaultTopbarLinks } from './topbar.js';
//
//   renderTopbar({
//     user: u,
//     profile,                       // { displayName, avatarUrl } | null
//     role: info.role,               // 'owner' | 'admin' | 'user' | null
//     currentPage: 'crm',            // omit the page's own self-link
//   });
//
// Pages that want a non-default link set pass `links: [...]` (each entry
// is `{ href, label }`). A `withBell: false` flag disables the bell on
// pages where notifications would be noise (e.g. resource pages on
// public sub-domains).
//
// The bell + unread popover live entirely inside this module so every
// page benefits from the inbox without each one re-implementing the
// listener. Cost per page: one bounded onSnapshot (limit 20) on the
// caller's notifications subcollection.

import { auth, db, firebaseReady } from './firebase.js';
import { signOut } from './auth.js';
import {
  collection, doc, query, where, orderBy, limit, onSnapshot, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ────────────────────────────────────────────────────────────────
// Default link set
// ────────────────────────────────────────────────────────────────

const ALL_LINKS = [
  { key: 'dashboard',  href: '/index.html',     label: 'Dashboard' },
  { key: 'community',  href: '/community.html', label: 'Community' },
  { key: 'members',    href: '/members.html',   label: 'Members' },
  { key: 'profile',    href: '/profile.html',   label: 'Profile' },
  { key: 'crm',        href: '/crm.html',       label: 'CRM',       requires: 'admin' },
  { key: 'campaigns',  href: '/campaigns.html', label: 'Campaigns', requires: 'admin' },
  { key: 'admin',      href: '/admin.html',     label: 'Admin',     requires: 'admin' },
  { key: 'owner',      href: '/owner.html',     label: 'Owner',     requires: 'owner' }
];

function roleAllows(roleRequired, role) {
  if (!roleRequired) return true;
  if (roleRequired === 'admin') return role === 'admin' || role === 'owner';
  if (roleRequired === 'owner') return role === 'owner';
  return true;
}

/**
 * Returns the role-aware default link set with the active page filtered out.
 * `currentPage` is one of the keys in ALL_LINKS (e.g. 'community', 'crm').
 */
export function defaultTopbarLinks({ role = null, currentPage = null } = {}) {
  return ALL_LINKS
    .filter((l) => roleAllows(l.requires, role))
    .filter((l) => l.key !== currentPage)
    .map(({ href, label }) => ({ href, label }));
}

// ────────────────────────────────────────────────────────────────
// Avatar (kept inline so topbar.js doesn't import community.js — that
// module pulls firebase-storage and avatar uploads, which not every
// page should pay for at load time).
// ────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return (parts.slice(0, 2).map((p) => p[0] || '').join('').toUpperCase()) || '?';
}

function avatarHtml(profile, size = 28) {
  const name = (profile && (profile.displayName || profile.authorName)) || '';
  const src = profile && (profile.avatarUrl || profile.authorAvatar);
  const s = `width:${size}px; height:${size}px; font-size:${Math.round(size * 0.38)}px;`;
  if (src) return `<div class="c-avatar" style="${s}"><img src="${src}" alt="" loading="lazy"></div>`;
  return `<div class="c-avatar c-avatar-initials" style="${s}">${initials(name)}</div>`;
}

function fmtRelative(ts) {
  if (!ts) return 'just now';
  const ms = ts.toMillis ? ts.toMillis() : (ts instanceof Date ? ts.getTime() : Number(ts));
  if (!ms) return 'just now';
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  try { return new Date(ms).toLocaleDateString(); } catch (e) { return `${d}d ago`; }
}

// ────────────────────────────────────────────────────────────────
// Bell — unread notifications listener + popover
// ────────────────────────────────────────────────────────────────

const bellState = {
  unsub: null,
  unread: [],
  showing: false,
  mountId: null,
  outsideClickBound: false
};

function notifIcon(type) {
  if (type === 'like') return '❤️';
  if (type === 'comment') return '💬';
  if (type === 'mention') return '@';
  return '🔔';
}

function notifLine(n) {
  const who = escapeHtml(n.fromName || 'Someone');
  if (n.type === 'like') return `${who} liked your post`;
  if (n.type === 'comment') return `${who} commented on your post`;
  if (n.type === 'mention') return `${who} mentioned you`;
  return `${who} did something`;
}

function notifHref(n) {
  if (!n || !n.postId) return '/community.html';
  const channel = n.category || 'general';
  return `/community.html?channel=${encodeURIComponent(channel)}#post-${encodeURIComponent(n.postId)}`;
}

function getBadgeEl() {
  const root = bellState.mountId ? document.getElementById(bellState.mountId) : null;
  return root ? root.querySelector('#bell-badge') : null;
}

function getPopoverEl() {
  const root = bellState.mountId ? document.getElementById(bellState.mountId) : null;
  return root ? root.querySelector('#notif-popover') : null;
}

function renderBellBadge() {
  const badge = getBadgeEl();
  if (!badge) return;
  const count = bellState.unread.length;
  if (count <= 0) {
    badge.hidden = true;
    badge.textContent = '0';
    return;
  }
  badge.hidden = false;
  badge.textContent = count >= 20 ? '20+' : String(count);
}

function renderNotifPopover() {
  const pop = getPopoverEl();
  if (!pop) return;
  const rows = bellState.unread;
  const headerHtml = `
    <div class="c-notif-head">
      <span class="c-notif-title">Notifications</span>
      <button class="c-notif-mark-all" id="notif-mark-all" ${rows.length ? '' : 'disabled'}>Mark all read</button>
    </div>
  `;
  const bodyHtml = rows.length ? rows.map((n) => `
    <a class="c-notif-row unread" data-notif="${escapeHtml(n.id)}" href="${escapeHtml(notifHref(n))}">
      <span class="c-notif-icon">${notifIcon(n.type)}</span>
      ${avatarHtml({ avatarUrl: n.fromAvatar, displayName: n.fromName }, 28)}
      <div class="c-notif-body">
        <div class="c-notif-line">${notifLine(n)}</div>
        ${n.preview ? `<div class="c-notif-preview">${escapeHtml(n.preview)}</div>` : ''}
        <div class="c-notif-time">${fmtRelative(n.createdAt)}</div>
      </div>
    </a>
  `).join('') : `<div class="c-notif-empty">You're all caught up.</div>`;
  pop.innerHTML = headerHtml + `<div class="c-notif-list">${bodyHtml}</div>`;

  pop.querySelectorAll('.c-notif-row').forEach((a) => {
    a.addEventListener('click', async (e) => {
      const id = a.dataset.notif;
      // Mark read in the background; let the navigation proceed.
      try { await markNotifReadById(id); } catch (er) {}
      bellState.showing = false;
      pop.hidden = true;
      // The default <a href> navigates to /community.html?channel=…#post-…
      // which community-page.js handles via its hashchange + initial-hash code.
    });
  });

  const markAll = pop.querySelector('#notif-mark-all');
  if (markAll) markAll.addEventListener('click', async () => {
    const ids = bellState.unread.map((n) => n.id);
    await Promise.all(ids.map((id) => markNotifReadById(id).catch(() => {})));
  });
}

async function markNotifReadById(notifId) {
  const user = auth && auth.currentUser;
  if (!user || !notifId || !firebaseReady) return;
  try {
    await updateDoc(doc(db, 'users', user.uid, 'notifications', notifId), { read: true });
  } catch (e) {
    console.warn('[topbar] markNotifRead failed', e);
  }
}

function bindBellHandlers() {
  const root = document.getElementById(bellState.mountId);
  if (!root) return;
  const btn = root.querySelector('#btn-bell');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = getPopoverEl();
      if (!pop) return;
      bellState.showing = !bellState.showing;
      if (bellState.showing) {
        renderNotifPopover();
        pop.hidden = false;
      } else {
        pop.hidden = true;
      }
    });
  }
  if (!bellState.outsideClickBound) {
    bellState.outsideClickBound = true;
    document.addEventListener('click', (e) => {
      if (!bellState.showing) return;
      const pop = getPopoverEl();
      const rootNow = document.getElementById(bellState.mountId);
      if (!pop || !rootNow) return;
      const bellBtn = rootNow.querySelector('#btn-bell');
      if (pop.contains(e.target) || (bellBtn && bellBtn.contains(e.target))) return;
      bellState.showing = false;
      pop.hidden = true;
    });
  }
}

function startBellListener(uid) {
  if (bellState.unsub) { try { bellState.unsub(); } catch (e) {} bellState.unsub = null; }
  if (!firebaseReady || !uid) return;
  const q = query(
    collection(db, 'users', uid, 'notifications'),
    where('read', '==', false),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  bellState.unsub = onSnapshot(q, (snap) => {
    bellState.unread = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderBellBadge();
    if (bellState.showing) renderNotifPopover();
  }, (err) => {
    console.warn('[topbar] notifications listener error', err);
    bellState.unread = [];
    renderBellBadge();
  });
}

// ────────────────────────────────────────────────────────────────
// renderTopbar — the public entry point
// ────────────────────────────────────────────────────────────────

/**
 * Paint the user-chip and (optionally) wire up the notification bell.
 * Idempotent — safe to call again on role / profile change.
 */
export function renderTopbar({
  user,
  profile = null,
  role = null,
  currentPage = null,
  links = null,
  mountId = 'user-chip',
  withBell = true,
  withSignOut = true,
  signOutLabel = 'Sign out'
} = {}) {
  const chip = document.getElementById(mountId);
  if (!chip || !user) return;

  const linkSet = links || defaultTopbarLinks({ role, currentPage });
  const linksHtml = linkSet.map((l) =>
    `<a class="user-chip-link" href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`
  ).join('');

  const displayName = (profile && profile.displayName) || user.displayName || user.email || '';
  const avatarObj = {
    displayName,
    avatarUrl: (profile && profile.avatarUrl) || null
  };
  const avatarHtmlStr = `<a href="/profile.html" class="c-avatar-link" title="Your profile">${avatarHtml(avatarObj, 28)}</a>`;

  const bellHtml = withBell ? `
    <button class="c-bell" id="btn-bell" title="Notifications" aria-label="Notifications">
      <span class="c-bell-icon">🔔</span>
      <span class="c-bell-badge" id="bell-badge" hidden>0</span>
    </button>
    <div class="c-notif-popover" id="notif-popover" hidden></div>
  ` : '';

  const signOutHtml = withSignOut
    ? `<button class="btn btn-ghost" id="btn-signout">${escapeHtml(signOutLabel)}</button>`
    : '';

  chip.innerHTML = `
    ${linksHtml}
    ${bellHtml}
    ${avatarHtmlStr}
    <span class="user-chip-email">${escapeHtml(displayName)}</span>
    ${signOutHtml}
  `;

  if (withSignOut) {
    const out = chip.querySelector('#btn-signout');
    if (out) out.addEventListener('click', async () => {
      try { await signOut(); } catch (e) {}
      location.replace('/login.html');
    });
  }

  if (withBell) {
    bellState.mountId = mountId;
    bindBellHandlers();
    startBellListener(user.uid);
  }
}

/** Stop any active bell listener. Call from `beforeunload` or on signout. */
export function teardownTopbar() {
  if (bellState.unsub) { try { bellState.unsub(); } catch (e) {} }
  bellState.unsub = null;
  bellState.unread = [];
  bellState.showing = false;
}
