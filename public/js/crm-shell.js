// GoHighLevel-style CRM app shell — a left sidebar + main column with an
// appbar. Every CRM subpage calls renderCrmShell() to get consistent chrome
// and then fills the returned #crm-content element. Keeps the 1P red/black
// brand and reuses renderTopbar for the user-chip (avatar/search/bell/signout).
//
//   import { renderCrmShell } from './crm-shell.js';
//   const content = renderCrmShell({ active: 'opportunities', title: 'Opportunities', user, role });
//   content.innerHTML = '…';
//
// Responsive: full sidebar on desktop, off-canvas drawer under 900px toggled
// by the appbar hamburger.

import { renderTopbar } from './topbar.js';
import { privilegedNav } from './academy-shell.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Live (built) destinations + "soon" placeholders for later phases so the
// full GHL nav is visible from day one without dead links.
const NAV = [
  { key: 'dashboard',     href: '/crm-dashboard.html', label: 'Dashboard',     icon: '◧' },
  { key: 'contacts',      href: '/crm.html',           label: 'Contacts',      icon: '☷' },
  { key: 'dialer',        href: '/dialer.html',        label: 'Dialer',        icon: '☎' },
  { key: 'opportunities', href: '/opportunities.html', label: 'Opportunities', icon: '◆' },
  { key: 'tasks',         href: '/tasks.html',         label: 'Tasks',         icon: '✓' },
  { key: 'conversations', href: '/conversations.html', label: 'Conversations', icon: '✉' },
  { key: 'calendar',      href: '/calendar.html',      label: 'Calendar',      icon: '◷' },
  { key: 'campaigns',     href: '/campaigns.html',     label: 'Campaigns',     icon: '❏' },
  { key: 'sequences',     href: '/sequences.html',     label: 'Sequences',     icon: '⇶' },
  { key: 'ai-log',        href: '/crm-ai-log.html',    label: 'AI Activity',   icon: '◎' },
  { key: 'settings',      href: '/crm-settings.html',  label: 'Settings',      icon: '⚙' }
];

// The staff tools, listed under the CRM's own nav in the same groups as the
// Academy sidebar. The CRM keeps its own rail rather than taking the Academy
// one, so the set comes from academy-shell.js and is drawn here in the CRM's
// style. The CRM entry is skipped: every item above it is already the CRM.
function privilegedHtml(role) {
  return privilegedNav(role).map((g) => {
    const rows = g.items.filter((i) => i.key !== 'crm');
    if (!rows.length) return '';
    return `<div class="crm-nav-heading">${esc(g.label)}</div>` + rows.map((i) =>
      `<a class="crm-nav-item" href="${esc(i.href)}">
        <span class="crm-nav-icon">›</span>
        <span class="crm-nav-label">${esc(i.label)}</span>
      </a>`).join('');
  }).join('');
}

function navItemHtml(item, active) {
  const isActive = item.key === active;
  if (item.soon) {
    return `<span class="crm-nav-item crm-nav-soon" title="Coming soon">
      <span class="crm-nav-icon">${item.icon}</span>
      <span class="crm-nav-label">${esc(item.label)}</span>
      <span class="crm-nav-soon-tag">soon</span>
    </span>`;
  }
  return `<a class="crm-nav-item ${isActive ? 'active' : ''}" href="${esc(item.href)}">
    <span class="crm-nav-icon">${item.icon}</span>
    <span class="crm-nav-label">${esc(item.label)}</span>
  </a>`;
}

/**
 * Render the shell into #crm-root and return the #crm-content element.
 * @returns {HTMLElement|null} the content container to fill.
 */
export function renderCrmShell({ active = 'contacts', title = 'CRM', user = null, role = null } = {}) {
  const root = document.getElementById('crm-root');
  if (!root) return null;

  root.innerHTML = `
    <div class="crm-app">
      <div class="crm-drawer-scrim" id="crm-drawer-scrim" hidden></div>
      <aside class="crm-sidebar" id="crm-sidebar">
        <a class="crm-sidebar-brand" href="/dashboard.html" aria-label="The One Percent Academy">
          <img src="/assets/academy-logo.png" alt="" class="crm-sidebar-logo">
          <span class="crm-sidebar-brandtext">CRM</span>
        </a>
        <nav class="crm-nav">
          ${NAV.map((i) => navItemHtml(i, active)).join('')}
          ${privilegedHtml(role)}
        </nav>
        <div class="crm-sidebar-foot">
          <a class="crm-nav-item crm-nav-muted" href="https://the1pnation.com">
            <span class="crm-nav-icon">←</span><span class="crm-nav-label">Main Site</span>
          </a>
        </div>
      </aside>
      <div class="crm-main">
        <header class="crm-appbar">
          <button class="crm-hamburger" id="crm-hamburger" aria-label="Menu">☰</button>
          <h1 class="crm-appbar-title">${esc(title)}</h1>
          <div class="crm-appbar-spacer"></div>
          <div class="user-chip" id="user-chip"></div>
        </header>
        <div class="crm-content" id="crm-content"></div>
      </div>
    </div>
  `;

  // User chip (avatar / search / bell / signout). Suppress the regular nav
  // chips — navigation, the Owner / Admin tools included, lives in the sidebar.
  if (user) {
    renderTopbar({ user, role, mountId: 'user-chip', links: [] });
  }

  // Mobile drawer toggle.
  const sidebar = document.getElementById('crm-sidebar');
  const scrim = document.getElementById('crm-drawer-scrim');
  const ham = document.getElementById('crm-hamburger');
  const open = () => { sidebar.classList.add('open'); scrim.hidden = false; };
  const close = () => { sidebar.classList.remove('open'); scrim.hidden = true; };
  if (ham) ham.addEventListener('click', () => {
    sidebar.classList.contains('open') ? close() : open();
  });
  if (scrim) scrim.addEventListener('click', close);

  // The assistant, on every CRM screen. Mounting it here rather than on each
  // page means one place to add it and no page that quietly lacks it. It is
  // admin-gated inside the widget, and every CRM page is already admin-only,
  // so this adds no surface a member can reach.
  //
  // Dynamic import so a chatbot failure cannot stop the CRM shell rendering —
  // the pipeline has to load even if the assistant does not.
  import('./chatbot.js')
    .then((m) => { try { m.init(); } catch (e) { console.warn('[crm-shell] assistant init failed', e); } })
    .catch((e) => console.warn('[crm-shell] assistant unavailable', e));

  return document.getElementById('crm-content');
}

/**
 * Badge the Conversations nav item with the number of unread inbound replies.
 *
 * Called by pages that have already loaded the contact list, so this costs no
 * extra read — `emailUnreadCount` rides on the contact documents. Without it
 * an inbound reply is only discoverable by opening the one card it landed on,
 * which was the gap that made two-way email feel one-way.
 */
export function setCrmUnreadCount(n) {
  const count = Number(n) || 0;
  const link = document.querySelector('.crm-nav-item[href="/conversations.html"]');
  if (!link) return;
  let badge = link.querySelector('.crm-nav-unread');
  if (!count) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'sms-unread crm-nav-unread';
    link.appendChild(badge);
  }
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.title = `${count} unread ${count === 1 ? 'reply' : 'replies'}`;
}
