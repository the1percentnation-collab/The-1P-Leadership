// The Academy shell — the sidebar + top bar every member page sits inside.
//
// It replaces the old `academy-header` tab strip, which put four sections and
// an admin dropdown into one horizontal row and ran out of room the moment a
// page needed anything else in it. A vertical rail scales: sections are
// grouped and labelled, admin tools get their own group instead of hiding
// behind a dropdown, and the page keeps its full width for content.
//
// Rendered from one module rather than copied into five HTML files, because
// the previous header WAS copied into five HTML files and had already drifted
// (Courses was marked active on the certificate page).
//
// Two modes:
//   default — the full rail, for scrolling pages.
//   compact — icons only, for the course player, which has a sidebar of its
//             own and cannot afford a second full-width one beside it.

import { signOut } from './auth.js';
import { cachedRoleInfo } from './roles.js';
import { openSearch } from './topbar.js';

const LS_COMPACT = '1p_shell_compact';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Inline SVG rather than an icon font or emoji: emoji render differently on
// every platform and an icon font is another blocking request. 20px box,
// stroke: currentColor, so a nav item's colour drives its icon for free.
const ICONS = {
  dashboard: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/>',
  library: '<path d="M5 4.5h3.5v15H5z"/><path d="M10.5 4.5H14v15h-3.5z"/><path d="m16 5.4 3.3-.9 3 14.3-3.3.8z"/>',
  courses: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5Z"/>',
  community: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><path d="M16 5.6a3 3 0 0 1 0 5.6"/><path d="M17.5 14.4a5.5 5.5 0 0 1 3 5.1"/>',
  resources: '<path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M14 4v5h5"/><path d="M8.5 13.5h7"/><path d="M8.5 17h5"/>',
  events: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17"/><path d="M8 3.5v3M16 3.5v3"/>',
  profile: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  admin: '<path d="M12 3.5 4.5 6.8v5.1c0 4.3 3.1 8.1 7.5 9.1 4.4-1 7.5-4.8 7.5-9.1V6.8Z"/>',
  crm: '<path d="M4 19V9.5M9.3 19V4.5M14.7 19v-8M20 19v-5"/>',
  store: '<path d="M4 8h16l-1.2 11.2a1 1 0 0 1-1 .8H6.2a1 1 0 0 1-1-.8Z"/><path d="M8.8 8V6.2a3.2 3.2 0 0 1 6.4 0V8"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l7 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M17.5 9.2a4 4 0 0 1 0 5.6"/>',
  badge: '<circle cx="12" cy="9.5" r="5"/><path d="M8.6 13.8 7.5 21l4.5-2.3L16.5 21l-1.1-7.2"/>',
  site: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8a13 13 0 0 1 0 16.4"/><path d="M12 3.8a13 13 0 0 0 0 16.4"/>',
  logout: '<path d="M14.5 8V5.5a1.5 1.5 0 0 0-1.5-1.5H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H13a1.5 1.5 0 0 0 1.5-1.5V16"/><path d="M10 12h10"/><path d="m17 9 3 3-3 3"/>',
  collapse: '<path d="M14.5 6.5 9 12l5.5 5.5"/>',
  search: '<circle cx="11" cy="11" r="6.2"/><path d="m15.6 15.6 4 4"/>'
};

// Exported so the first-login tour can label each tab with the exact icon the
// member will be looking for in the rail, rather than a second set that drifts.
export function navIcon(name) {
  return `<svg class="ak-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${ICONS[name] || ICONS.dashboard}</svg>`;
}

// The member's own sections. `key` matches the `current` a page passes in.
const MAIN_NAV = [
  { key: 'dashboard', href: '/dashboard.html', label: 'Dashboard', icon: 'dashboard' },
  { key: 'courses',   href: '/courses.html',   label: 'Courses',   icon: 'courses' },
  { key: 'library',   href: '/library',        label: 'Library',   icon: 'library' },
  { key: 'community', href: '/community.html', label: 'Community', icon: 'community' },
  { key: 'resources', href: '/resources.html', label: 'Resources', icon: 'resources' },
  { key: 'store',     href: '/store.html',     label: 'Store',     icon: 'store' },
  { key: 'events',    href: '/events',         label: 'Events',    icon: 'events' }
];

// Privileged destinations. These used to live behind an "Admin ▾" dropdown in
// the old header; the rail has room to just show them, which is one click less
// and makes it obvious at a glance what an owner can reach.
const ADMIN_NAV = [
  { key: 'crm',                  href: '/crm.html',                 label: 'CRM',           icon: 'crm',       requires: 'admin' },
  { key: 'store-admin',          href: '/manage-store.html',        label: 'Store',         icon: 'store',     requires: 'admin' },
  { key: 'courses-admin',        href: '/manage-courses.html',      label: 'Courses',       icon: 'courses',   requires: 'admin' },
  { key: 'library-admin',        href: '/manage-library.html',      label: 'Library',       icon: 'library',   requires: 'admin' },
  { key: 'products-admin',       href: '/manage-products.html',     label: 'Products',      icon: 'store',     requires: 'admin' },
  { key: 'announcements-admin',  href: '/manage-announcements.html', label: 'Announcements', icon: 'megaphone', requires: 'admin' },
  { key: 'affiliates-admin',     href: '/manage-affiliates.html',   label: 'Affiliates',    icon: 'community', requires: 'admin' },
  { key: 'certification-admin',  href: '/certification-admin.html', label: 'Certification', icon: 'badge',     requires: 'admin' },
  { key: 'admin',                href: '/admin.html',               label: 'Admin',         icon: 'admin',     requires: 'admin' },
  { key: 'owner',                href: '/owner.html',               label: 'Owner',         icon: 'admin',     requires: 'owner' }
];

const ACCOUNT_NAV = [
  { key: 'profile', href: '/profile.html', label: 'Profile', icon: 'profile' },
  { key: 'site', href: 'https://the1pnation.com', label: 'Main site', icon: 'site', external: true }
];

function roleAllows(required, role) {
  if (!required) return true;
  if (required === 'admin') return role === 'admin' || role === 'owner';
  if (required === 'owner') return role === 'owner';
  return true;
}

function navItem(item, current) {
  const active = item.key === current;
  return `
    <a class="ak-nav-item${active ? ' is-active' : ''}"
       href="${escapeHtml(item.href)}"
       ${item.external ? 'target="_blank" rel="noopener"' : ''}
       ${active ? 'aria-current="page"' : ''}
       title="${escapeHtml(item.label)}">
      ${navIcon(item.icon)}<span class="ak-nav-text">${escapeHtml(item.label)}</span>
    </a>`;
}

function group(label, items, current) {
  if (!items.length) return '';
  return `
    <div class="ak-nav-group">
      <div class="ak-nav-label">${escapeHtml(label)}</div>
      ${items.map((i) => navItem(i, current)).join('')}
    </div>`;
}

function sidebarHtml({ current, role }) {
  const admin = ADMIN_NAV.filter((i) => roleAllows(i.requires, role));
  return `
    <a class="ak-brand" href="/dashboard.html" aria-label="The One Percent Academy">
      <img class="ak-brand-mark" src="/assets/academy-logo.png" alt="">
      <span class="ak-brand-text">
        <span class="ak-brand-1">The One Percent</span>
        <span class="ak-brand-2">Academy</span>
      </span>
    </a>

    <nav class="ak-nav" aria-label="Academy sections">
      ${group('Overview', MAIN_NAV, current)}
      ${group('Manage', admin, current)}
      ${group('Account', ACCOUNT_NAV, current)}
      <div class="ak-nav-group ak-nav-foot">
        <button class="ak-nav-item ak-signout" type="button" id="ak-signout" title="Sign out">
          ${navIcon('logout')}<span class="ak-nav-text">Sign out</span>
        </button>
      </div>
    </nav>

    <button class="ak-collapse" type="button" id="ak-collapse"
            aria-label="Collapse the sidebar" title="Collapse the sidebar">
      ${navIcon('collapse')}
    </button>`;
}

function applyCompact(on) {
  const shell = document.querySelector('.ak-shell');
  if (shell) shell.classList.toggle('is-compact', !!on);
  try { localStorage.setItem(LS_COMPACT, on ? '1' : '0'); } catch (e) { /* private mode */ }
}

function storedCompact() {
  try { return localStorage.getItem(LS_COMPACT) === '1'; } catch (e) { return false; }
}

/**
 * Draw the sidebar and wire the top bar's search field.
 *
 * Called twice by most pages: once before any network call with the cached
 * role (so the rail paints on the first frame and an admin's tools do not
 * pop in late), then again once getRoleInfo() resolves. Same reasoning as
 * renderTopbarEarly.
 */
export function renderShell({ current = null, role = null, compact = null } = {}) {
  const side = document.getElementById('ak-sidebar');
  if (!side) return;

  const resolved = role !== null ? role : (cachedRoleInfo() || {}).role || null;
  side.innerHTML = sidebarHtml({ current, role: resolved });

  // `compact` passed explicitly is the page's own decision (the course player
  // always wants it); otherwise honour whatever the member last chose.
  applyCompact(compact === null ? storedCompact() : compact);

  const collapse = document.getElementById('ak-collapse');
  if (collapse) collapse.addEventListener('click', () => {
    const shell = document.querySelector('.ak-shell');
    applyCompact(!(shell && shell.classList.contains('is-compact')));
  });

  const out = document.getElementById('ak-signout');
  if (out) out.addEventListener('click', async () => {
    try { await signOut(); } catch (e) { /* sign out locally regardless */ }
    location.replace('/login.html');
  });

  wireSearch();
}

// The top bar's search reads as a field but is a button: it opens the same
// overlay the bell-row magnifier always has, so member and post search stay in
// one implementation instead of two.
function wireSearch() {
  const box = document.getElementById('ak-search');
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  const open = (e) => { e.preventDefault(); openSearch(); };
  box.addEventListener('click', open);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') open(e);
  });
}
