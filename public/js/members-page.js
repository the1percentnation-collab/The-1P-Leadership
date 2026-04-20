// Members directory — cards showing avatar, name, bio preview, progress %.

import { firebaseReady } from './firebase.js';
import { onAuthReady, signOut } from './auth.js';
import { getRoleInfo } from './roles.js';
import { listMembers, getUserProfile, avatarHtml, escapeHtml } from './community.js';

const $ = (id) => document.getElementById(id);
const TOTAL_CLC_MODULES = 7;
const TOTAL_TP_LESSONS = 55;
const TOTAL_IP_MODULES = 6;

function renderChip(me, role) {
  const chip = $('user-chip');
  const adminLink = role === 'admin' || role === 'owner'
    ? `<a class="user-chip-link" href="/admin.html">Admin</a>` : '';
  const crmLink = role === 'admin' || role === 'owner'
    ? `<a class="user-chip-link" href="/crm.html">CRM</a>` : '';
  const campaignsLink = role === 'admin' || role === 'owner'
    ? `<a class="user-chip-link" href="/campaigns.html">Campaigns</a>` : '';
  const ownerLink = role === 'owner'
    ? `<a class="user-chip-link" href="/owner.html">Owner</a>` : '';
  chip.innerHTML = `
    <a class="user-chip-link" href="/index.html">Dashboard</a>
    <a class="user-chip-link" href="/community.html">Community</a>
    <a class="user-chip-link" href="/profile.html">Profile</a>
    ${crmLink}${campaignsLink}${adminLink}${ownerLink}
    <span class="c-avatar-link">${avatarHtml(me, 28)}</span>
    <span class="user-chip-email">${escapeHtml(me.displayName || me.email || '')}</span>
    <button class="btn btn-ghost" id="btn-signout">Sign out</button>
  `;
  $('btn-signout').addEventListener('click', async () => {
    try { await signOut(); } catch (e) {}
    location.replace('/login.html');
  });
}

function memberCardHtml(m) {
  // Progress digests mirrored from each course's own client into the members
  // subcollection:
  //   completedCount   = 1P-CLC (red)
  //   tpCompletedCount = Trust The Process (gold)
  //   ipCompletedCount = The Identity of A Producer (blue)
  const cc = typeof m.completedCount === 'number' ? m.completedCount : 0;
  const tp = typeof m.tpCompletedCount === 'number' ? m.tpCompletedCount : 0;
  const ip = typeof m.ipCompletedCount === 'number' ? m.ipCompletedCount : 0;
  const clcPct = Math.min(100, Math.round((cc / TOTAL_CLC_MODULES) * 100));
  const tpPct = Math.min(100, Math.round((tp / TOTAL_TP_LESSONS) * 100));
  const ipPct = Math.min(100, Math.round((ip / TOTAL_IP_MODULES) * 100));
  const role = m.role || null;
  const roleBadge = role === 'owner'
    ? `<span class="c-role-badge c-role-owner">Owner</span>`
    : role === 'admin' ? `<span class="c-role-badge c-role-admin">Admin</span>` : '';
  const bio = m.bio ? escapeHtml(m.bio).slice(0, 120) : 'No bio yet.';
  const tpRow = tp > 0
    ? `<div class="c-member-progress" title="Trust The Process: ${tp}/${TOTAL_TP_LESSONS}">
         <div class="c-progress-bar"><div class="c-progress-fill" style="width:${tpPct}%; background:var(--gold,#d4a92e);"></div></div>
         <span class="c-progress-pct">${tpPct}%</span>
       </div>`
    : '';
  const ipRow = ip > 0
    ? `<div class="c-member-progress" title="The Identity of A Producer: ${ip}/${TOTAL_IP_MODULES}">
         <div class="c-progress-bar"><div class="c-progress-fill" style="width:${ipPct}%; background:#4fa3d1;"></div></div>
         <span class="c-progress-pct">${ipPct}%</span>
       </div>`
    : '';
  return `
    <a class="c-member-card" href="/profile.html?uid=${encodeURIComponent(m.uid)}">
      ${avatarHtml(m, 56)}
      <div class="c-member-name">${escapeHtml(m.displayName || m.email || 'Member')} ${roleBadge}</div>
      <div class="c-member-bio">${bio}</div>
      <div class="c-member-progress" title="1P-CLC: ${cc}/${TOTAL_CLC_MODULES}">
        <div class="c-progress-bar"><div class="c-progress-fill" style="width:${clcPct}%"></div></div>
        <span class="c-progress-pct">${clcPct}%</span>
      </div>
      ${tpRow}
      ${ipRow}
    </a>
  `;
}

async function main() {
  if (!firebaseReady) {
    $('grid').innerHTML = `<div class="auth-error">Firebase is unavailable.</div>`;
    return;
  }
  const u = await onAuthReady();
  if (!u) {
    location.replace('/login.html?next=' + encodeURIComponent('/members.html'));
    return;
  }
  const info = await getRoleInfo();
  const profile = (await getUserProfile(u.uid)) || {};
  const me = {
    uid: u.uid,
    email: u.email,
    displayName: profile.displayName || u.displayName || u.email,
    avatarUrl: profile.avatarUrl || null
  };
  renderChip(me, info.role);

  const members = await listMembers({ role: info.role, companyId: info.companyId });
  if (!members.length) {
    $('grid').innerHTML = `
      <div class="c-empty">
        <div class="c-empty-title">No members yet</div>
        <p>Invite teammates from the admin console to see them here.</p>
      </div>`;
    return;
  }

  // Owner: enrich by fetching user docs individually to pull bio/avatar.
  // Company/members subcollection already has displayName/avatar digest; for
  // owner path (all users) we already have full doc data.
  if (info.role !== 'owner' && info.companyId) {
    // Members subcollection doesn't include bio/avatarUrl. Lazily enrich with a small parallel fetch,
    // tolerating failures.
    await Promise.all(members.map(async (m) => {
      try {
        const p = await getUserProfile(m.uid);
        if (p) {
          m.bio = p.bio || m.bio || '';
          m.avatarUrl = p.avatarUrl || m.avatarUrl || null;
          m.role = p.role || m.role || null;
        }
      } catch (e) { /* best-effort */ }
    }));
  }

  $('grid').innerHTML = members.map(memberCardHtml).join('');
}

main();
