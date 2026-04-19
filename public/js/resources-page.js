// Resources page — stub for now. Just renders the shared user chip.

import { onAuthReady, signOut, currentUser } from './auth.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady } from './firebase.js';
import { getUserProfile, avatarHtml, escapeHtml } from './community.js';

const $ = (id) => document.getElementById(id);

function renderChip(user, role, profile) {
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
}

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html');
      return;
    }
  }

  let role = null;
  let profile = null;
  try {
    if (firebaseReady && currentUser()) {
      const info = await getRoleInfo();
      role = info.role;
      try { profile = await getUserProfile(currentUser().uid); } catch (e) {}
    }
  } catch (e) {}

  renderChip(currentUser(), role, profile);
}

main();
