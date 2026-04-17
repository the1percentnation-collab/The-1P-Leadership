// Profile page — edit own profile (no ?uid) OR view any member by uid.

import { db, firebaseReady, auth } from './firebase.js';
import { onAuthReady, signOut } from './auth.js';
import { getRoleInfo } from './roles.js';
import { getUserProfile, updateOwnProfile, uploadAvatar, avatarHtml, escapeHtml } from './community.js';
import {
  collection, getDocs, query, where, getCountFromServer
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const TOTAL_MODULES = 7;

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
    <a class="user-chip-link" href="/members.html">Members</a>
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

// ─── Edit mode ────────────────────────────────────────────────────────────
function renderEdit(me) {
  const panel = $('panel');
  panel.innerHTML = `
    <div class="card c-profile-card">
      <h2>Your Profile</h2>
      <div class="c-profile-edit">
        <div class="c-profile-avatar-col">
          <div id="avatar-preview">${avatarHtml(me, 120)}</div>
          <label class="btn btn-ghost c-file-btn" style="margin-top:14px; justify-content:center;">
            <span>Change avatar</span>
            <input id="avatar-file" type="file" accept="image/*" hidden>
          </label>
          <div id="avatar-status" class="c-filename"></div>
        </div>
        <div class="c-profile-fields">
          <label>Display name</label>
          <input id="field-name" class="c-input" type="text" value="${escapeHtml(me.displayName || '')}">
          <label>Bio</label>
          <textarea id="field-bio" class="c-textarea" rows="4" placeholder="Tell the community a bit about yourself…">${escapeHtml(me.bio || '')}</textarea>
          <div style="display:flex; gap:10px; align-items:center; margin-top:14px;">
            <button class="btn btn-primary" id="save-btn">Save changes</button>
            <div id="save-status" class="c-save-status"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  $('avatar-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    $('avatar-status').textContent = 'Uploading…';
    try {
      const url = await uploadAvatar(f);
      me.avatarUrl = url;
      $('avatar-preview').innerHTML = avatarHtml(me, 120);
      await updateOwnProfile({ avatarUrl: url });
      $('avatar-status').textContent = 'Saved.';
      setTimeout(() => { $('avatar-status').textContent = ''; }, 2000);
    } catch (err) {
      $('avatar-status').textContent = 'Upload failed: ' + (err.message || err);
    }
  });
  $('save-btn').addEventListener('click', async () => {
    const displayName = $('field-name').value;
    const bio = $('field-bio').value;
    const status = $('save-status');
    status.textContent = 'Saving…';
    try {
      await updateOwnProfile({ displayName, bio });
      me.displayName = displayName.trim();
      me.bio = bio.trim();
      status.textContent = '✓ Saved';
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch (err) {
      status.textContent = 'Error: ' + (err.message || err);
    }
  });
}

// ─── View mode ────────────────────────────────────────────────────────────
async function renderView(profile, viewer) {
  const panel = $('panel');
  if (!profile) {
    panel.innerHTML = `<div class="card"><div class="auth-error">Profile not found or not accessible.</div></div>`;
    return;
  }
  const role = profile.role || 'user';
  const roleBadge = role === 'owner'
    ? `<span class="c-role-badge c-role-owner">Owner</span>`
    : role === 'admin' ? `<span class="c-role-badge c-role-admin">Admin</span>` : '';

  // Try to compute progress + post/comment counts (best-effort).
  let completedCount = 0;
  let postsCount = null;
  let commentsCount = null;
  try {
    // Progress reads are private (rules). We can only read progress for self or owner.
    // Skip unless viewer is self or owner. For company admins we show 0 or 'private'.
    if (viewer && (viewer.uid === profile.uid || viewer.role === 'owner')) {
      const snap = await getDocs(collection(db, 'users', profile.uid, 'progress'));
      snap.forEach((d) => { if (d.data().completed) completedCount++; });
    }
  } catch (e) {}
  try {
    const c = await getCountFromServer(query(collection(db, 'posts'), where('authorUid', '==', profile.uid)));
    postsCount = c.data().count;
  } catch (e) { /* count queries may not be allowed — fine */ }

  const pct = Math.min(100, Math.round((completedCount / TOTAL_MODULES) * 100));
  panel.innerHTML = `
    <div class="card c-profile-card">
      <div class="c-profile-view">
        ${avatarHtml(profile, 120)}
        <div class="c-profile-view-info">
          <h2 class="c-profile-name">${escapeHtml(profile.displayName || profile.email || 'Member')} ${roleBadge}</h2>
          <p class="c-profile-bio">${profile.bio ? escapeHtml(profile.bio) : '<span style="color:var(--gray-mid)">No bio yet.</span>'}</p>
          <div class="c-profile-stats">
            ${viewer && (viewer.uid === profile.uid || viewer.role === 'owner') ? `
              <div class="c-stat">
                <div class="c-stat-label">Modules</div>
                <div class="c-stat-value">${completedCount}/${TOTAL_MODULES}</div>
                <div class="c-progress-bar" style="margin-top:6px;"><div class="c-progress-fill" style="width:${pct}%"></div></div>
              </div>` : ''}
            ${postsCount != null ? `
              <div class="c-stat">
                <div class="c-stat-label">Posts</div>
                <div class="c-stat-value">${postsCount}</div>
              </div>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function main() {
  if (!firebaseReady) {
    $('panel').innerHTML = `<div class="card"><div class="auth-error">Firebase is unavailable.</div></div>`;
    return;
  }
  const u = await onAuthReady();
  if (!u) {
    location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
    return;
  }
  const info = await getRoleInfo();
  const myProfile = (await getUserProfile(u.uid)) || {};
  const me = {
    uid: u.uid,
    email: u.email,
    displayName: myProfile.displayName || u.displayName || u.email,
    avatarUrl: myProfile.avatarUrl || null,
    bio: myProfile.bio || '',
    role: info.role
  };
  renderChip(me, info.role);

  const urlUid = new URLSearchParams(location.search).get('uid');
  if (!urlUid || urlUid === u.uid) {
    renderEdit(me);
  } else {
    // Read-only view of another user. Firestore rules allow self + owner + company admin
    // of target's company. Regular company users cannot read peer user docs directly, so
    // fall back to the companies/{cid}/members/{uid} digest for non-privileged viewers.
    let profile = null;
    try {
      profile = await getUserProfile(urlUid);
    } catch (e) { /* ignore */ }
    if (!profile && info.companyId) {
      // Try members digest.
      try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        const m = await getDoc(doc(db, 'companies', info.companyId, 'members', urlUid));
        if (m.exists()) profile = { uid: urlUid, ...m.data() };
      } catch (e) {}
    }
    if (!profile) profile = { uid: urlUid, displayName: 'Member' };
    profile.uid = urlUid;
    await renderView(profile, me);
  }
}

main();
