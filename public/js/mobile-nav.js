// Phone navigation for the member portal: a bottom tab bar and a "More" sheet.
//
// On a phone the desktop rail became a horizontal strip of unlabelled icons
// that ran off the right edge, and the console pages (Community, Profile,
// Members, Events) carried their own tab row plus a row of chip links, so a
// member met two or three rows of navigation before any content, and a
// different set on every page. This replaces all of it below 900px with the
// pattern every app on their phone already uses: the four places a member
// goes most, one thumb-reach away at the bottom, and everything else one tap
// further in a sheet.
//
// Mounted from renderTopbar, which every member page already calls, so no
// page opts in. Hidden above 900px by CSS; the desktop rail is untouched.

import { signOut } from './auth.js';
import { navIcon, privilegedNav } from './academy-shell.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The four tabs. `match` is every path that counts as being on that tab.
const TABS = [
  { key: 'home',      href: '/dashboard.html', label: 'Home',      icon: 'dashboard', match: ['/dashboard', '/'] },
  { key: 'courses',   href: '/courses.html',   label: 'Courses',   icon: 'courses',   match: ['/courses', '/course', '/certificate'] },
  { key: 'library',   href: '/library',        label: 'Library',   icon: 'library',   match: ['/library', '/reader'] },
  { key: 'community', href: '/community.html', label: 'Community', icon: 'community', match: ['/community'] }
];

// Everything else a member can reach, in the sheet.
const MORE = [
  { href: '/resources.html', label: 'Resources', icon: 'resources' },
  { href: '/events',         label: 'Events',    icon: 'events' },
  { href: '/store.html',     label: 'Store',     icon: 'store' },
  { href: '/members.html',   label: 'Members',   icon: 'community' },
  { href: '/profile.html',   label: 'Profile',   icon: 'profile' }
];

function currentPath() {
  return location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
}

function activeTab() {
  const path = currentPath();
  const tab = TABS.find((t) => t.match.some((m) => m === '/' ? path === '/' : path === m));
  return tab ? tab.key : 'more';
}

function isCurrent(href) {
  return currentPath() === href.replace(/\.html$/, '').replace(/\/+$/, '');
}

// Pages that already own the bottom of the screen or have their own app nav.
function excluded() {
  return !!document.getElementById('crm-root');
}

// CRM pages outside the CRM shell (a contact record) keep the slim top bar
// but not the member tabs: Home / Courses / Library is the wrong set of
// places when you are working a lead, and "Back to CRM" is already there.
function tabsHidden() {
  return /^\/contact(\.html)?$/.test(location.pathname);
}

function sheetLink(item) {
  const cur = isCurrent(item.href);
  return `<a class="mnav-sheet-link${cur ? ' is-current' : ''}" href="${esc(item.href)}"${cur ? ' aria-current="page"' : ''}>
      ${navIcon(item.icon)}<span>${esc(item.label)}</span>
    </a>`;
}

function sheetHtml(role) {
  const staff = privilegedNav(role);
  return `
    <div class="mnav-sheet-head">
      <span class="mnav-sheet-title">More</span>
      <button class="mnav-sheet-close" type="button" data-mnav-close aria-label="Close">${navIcon('close')}</button>
    </div>
    <div class="mnav-sheet-grid">${MORE.map(sheetLink).join('')}</div>
    ${staff.map((g) => `
      <div class="mnav-sheet-label">${esc(g.label)}</div>
      <div class="mnav-sheet-grid">${g.items.map(sheetLink).join('')}</div>`).join('')}
    <div class="mnav-sheet-foot">
      <a class="mnav-sheet-row" href="https://the1pnation.com" target="_blank" rel="noopener">${navIcon('site')}<span>Main site</span></a>
      <button class="mnav-sheet-row" type="button" data-mnav-signout>${navIcon('logout')}<span>Sign out</span></button>
    </div>`;
}

let lastFocus = null;

function openSheet() {
  const sheet = document.getElementById('mnav-sheet');
  const scrim = document.getElementById('mnav-scrim');
  if (!sheet || !scrim) return;
  lastFocus = document.activeElement;
  scrim.hidden = false;
  sheet.hidden = false;
  // Next frame, so the transition runs from the hidden position.
  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    sheet.classList.add('is-open');
  });
  document.body.classList.add('mnav-locked');
  const more = document.getElementById('mnav-more');
  if (more) more.setAttribute('aria-expanded', 'true');
  const first = sheet.querySelector('a, button');
  if (first) first.focus({ preventScroll: true });
}

function closeSheet() {
  const sheet = document.getElementById('mnav-sheet');
  const scrim = document.getElementById('mnav-scrim');
  if (!sheet || !scrim || sheet.hidden) return;
  scrim.classList.remove('is-open');
  sheet.classList.remove('is-open');
  document.body.classList.remove('mnav-locked');
  const more = document.getElementById('mnav-more');
  if (more) more.setAttribute('aria-expanded', 'false');
  setTimeout(() => { sheet.hidden = true; scrim.hidden = true; }, 220);
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}

/** The shell pages' top bar has no logo of its own; add one for phones. */
function ensureTopbarBrand() {
  const bar = document.querySelector('.ak-topbar');
  if (!bar || bar.querySelector('.mnav-brand')) return;
  const a = document.createElement('a');
  a.className = 'mnav-brand';
  a.href = '/dashboard.html';
  a.setAttribute('aria-label', 'The One Percent Academy, home');
  a.innerHTML = '<img src="/assets/academy-logo.png" alt="">';
  bar.insertBefore(a, bar.firstChild);
}

/**
 * Draw (or redraw, once the real role is known) the tab bar and the sheet.
 * Idempotent: renderTopbar calls it on every paint.
 */
export function mountMobileNav({ role = null } = {}) {
  if (excluded()) return;
  document.body.classList.add('has-mnav');
  ensureTopbarBrand();
  if (tabsHidden()) return;
  document.body.classList.add('has-mnav-bar');

  let bar = document.getElementById('mnav');
  if (!bar) {
    bar = document.createElement('nav');
    bar.id = 'mnav';
    bar.className = 'mnav';
    bar.setAttribute('aria-label', 'Main');
    document.body.appendChild(bar);

    const scrim = document.createElement('div');
    scrim.id = 'mnav-scrim';
    scrim.className = 'mnav-scrim';
    scrim.hidden = true;
    scrim.addEventListener('click', closeSheet);
    document.body.appendChild(scrim);

    const sheet = document.createElement('div');
    sheet.id = 'mnav-sheet';
    sheet.className = 'mnav-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'More');
    sheet.hidden = true;
    document.body.appendChild(sheet);

    sheet.addEventListener('click', async (e) => {
      if (e.target.closest('[data-mnav-close]')) { closeSheet(); return; }
      if (e.target.closest('[data-mnav-signout]')) {
        try { await signOut(); } catch (err) { /* sign out locally regardless */ }
        location.replace('/login.html');
      }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
    // Leaving a phone-width window open wide should not strand an open sheet.
    window.addEventListener('resize', () => { if (window.innerWidth > 900) closeSheet(); });
  }

  const active = activeTab();
  bar.innerHTML = TABS.map((t) => {
    const on = t.key === active;
    return `<a class="mnav-tab${on ? ' is-active' : ''}" href="${esc(t.href)}"${on ? ' aria-current="page"' : ''}>
        ${navIcon(t.icon)}<span class="mnav-label">${esc(t.label)}</span>
      </a>`;
  }).join('') + `
    <button class="mnav-tab${active === 'more' ? ' is-active' : ''}" type="button" id="mnav-more"
            aria-haspopup="dialog" aria-expanded="false" aria-controls="mnav-sheet">
      ${navIcon('more')}<span class="mnav-label">More</span>
    </button>`;
  document.getElementById('mnav-more').addEventListener('click', openSheet);

  document.getElementById('mnav-sheet').innerHTML = sheetHtml(role);
}
