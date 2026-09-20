// Admin: Announcements — the dashboard spotlight's authoring console.
// Admin/owner only; the Firestore rules enforce that independently.

import { firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import { escapeHtml } from './products.js';
import {
  ANNOUNCEMENT_KINDS, ANNOUNCEMENT_AUDIENCES,
  listAllAnnouncements, createAnnouncement, updateAnnouncement,
  deleteAnnouncement, uploadAnnouncementImage
} from './announcements.js';

const $ = (id) => document.getElementById(id);
const state = { rows: [] };

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${escapeHtml(msg)}</div></div>`;
}

// `datetime-local` speaks local wall-clock time with no zone, so both
// directions have to correct for the offset by hand.
function toLocalInput(ms) {
  if (!ms) return '';
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function fmtWhen(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

// What a member would see right now, stated plainly — the whole point of this
// table is that scheduling never becomes a guessing game.
function liveState(a) {
  const now = Date.now();
  if (!a.active) return { label: 'paused', color: '#8B4A4A' };
  if (a.publishAtMs && a.publishAtMs > now) return { label: 'scheduled', color: '#E8C547' };
  if (a.expiresAtMs && a.expiresAtMs <= now) return { label: 'expired', color: '#A0A0A0' };
  return { label: 'live', color: '#56D4A8' };
}

function render() {
  const host = $('announcement-list');
  if (!state.rows.length) {
    host.innerHTML = `<div class="card"><div class="crm-subpanel-empty">
      No announcements yet. Click “+ New Announcement” to put something at the top of every member's dashboard.
    </div></div>`;
    return;
  }

  host.innerHTML = `<div class="card crm-list-card"><table class="data-table crm-list-table">
    <thead><tr><th>Announcement</th><th>State</th><th>Kind</th><th>Audience</th><th>Priority</th><th>Publishes</th><th>Expires</th><th></th></tr></thead>
    <tbody>
    ${state.rows.map((a) => {
      const s = liveState(a);
      return `
      <tr>
        <td>
          <strong>${escapeHtml(a.title)}</strong>
          <div class="crm-mini-sub">${escapeHtml((a.body || '').slice(0, 80))}${(a.body || '').length > 80 ? '…' : ''}</div>
        </td>
        <td><span class="crm-stage-badge" style="--stage-color:${s.color}">${s.label}</span></td>
        <td>${escapeHtml(a.kind)}</td>
        <td>${escapeHtml(a.audience)}${a.courseSlug ? `<div class="crm-mini-sub">${escapeHtml(a.courseSlug)}</div>` : ''}</td>
        <td>${a.priority}</td>
        <td>${escapeHtml(fmtWhen(a.publishAtMs))}</td>
        <td>${escapeHtml(fmtWhen(a.expiresAtMs))}</td>
        <td style="white-space:nowrap;text-align:right;">
          <button class="crm-chip" data-edit="${escapeHtml(a.id)}">Edit</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;

  host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    openModal(state.rows.find((a) => a.id === b.getAttribute('data-edit')));
  }));
}

function openModal(announcement) {
  const editing = !!announcement;
  const a = announcement || {};
  const root = $('modal-root');

  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">
        <h1>${editing ? 'Edit' : 'New'} <span>Announcement</span></h1>
        <form id="a-form" class="crm-form">
          <div class="crm-form-row"><label>Title *</label><input class="c-input" id="a-title" required value="${escapeHtml(a.title || '')}" /></div>
          <div class="crm-form-row"><label>Body</label><textarea class="c-input" id="a-body" rows="3" placeholder="One or two sentences. The slide is a headline, not an article.">${escapeHtml(a.body || '')}</textarea></div>

          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Kind</label>
              <select class="c-input crm-select" id="a-kind">
                ${ANNOUNCEMENT_KINDS.map((k) => `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${k}</option>`).join('')}
              </select>
            </div>
            <div class="crm-form-row"><label>Priority (higher shows first)</label><input class="c-input" id="a-priority" type="number" value="${a.priority != null ? a.priority : 0}" /></div>
          </div>

          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>CTA label</label><input class="c-input" id="a-cta-label" placeholder="Register" value="${escapeHtml(a.ctaLabel || '')}" /></div>
            <div class="crm-form-row"><label>CTA link</label><input class="c-input" id="a-cta-href" placeholder="/events" value="${escapeHtml(a.ctaHref || '')}" /></div>
          </div>

          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Publishes</label><input class="c-input" id="a-publish" type="datetime-local" value="${toLocalInput(a.publishAtMs)}" /></div>
            <div class="crm-form-row"><label>Expires (blank = never)</label><input class="c-input" id="a-expires" type="datetime-local" value="${toLocalInput(a.expiresAtMs)}" /></div>
          </div>

          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Audience</label>
              <select class="c-input crm-select" id="a-audience">
                ${ANNOUNCEMENT_AUDIENCES.map((v) => `<option value="${v}" ${a.audience === v ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </div>
            <div class="crm-form-row"><label>Course slug / company id (for targeted audiences)</label><input class="c-input" id="a-target" placeholder="1p-clc" value="${escapeHtml(a.courseSlug || a.companyId || '')}" /></div>
          </div>

          <div class="crm-form-row">
            <label>Cover image</label>
            <div class="p-img-uploader">
              <div class="p-img-preview" id="a-img-preview">${a.imageUrl ? `<img src="${escapeHtml(a.imageUrl)}" alt="">` : '<span>No image</span>'}</div>
              <div class="p-img-controls">
                <label class="btn btn-ghost p-img-btn">Upload image<input type="file" id="a-image-file" accept="image/*" hidden></label>
                <span id="a-img-status" class="crm-save-status"></span>
                <input class="c-input" id="a-image" placeholder="…or paste an image URL" value="${escapeHtml(a.imageUrl || '')}" />
              </div>
            </div>
          </div>

          <div class="crm-form-row">
            <label style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="a-active" ${a.active === false ? '' : 'checked'}>
              <span>Active (uncheck to pull it from the dashboard without deleting it)</span>
            </label>
          </div>

          <div class="pre-modal-sub">
            <b>all</b> shows to every member. <b>enrolled</b> needs at least one course, or the named
            course slug. <b>company</b> targets one company id. <b>admin</b> keeps it to you and your admins.
          </div>

          <div id="a-err" class="auth-error" style="display:none;"></div>
          <div class="crm-modal-actions">
            ${editing ? `<button type="button" class="btn btn-ghost" id="a-del" style="margin-right:auto;">Delete</button>` : ''}
            <button type="button" class="btn btn-ghost" id="a-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${editing ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ''; };
  $('a-cancel').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });

  if (editing) $('a-del').addEventListener('click', async () => {
    if (!confirm(`Delete "${a.title}"? Members stop seeing it immediately.`)) return;
    await deleteAnnouncement(a.id);
    close();
    await reload();
  });

  // Image upload + preview; the URL field stays the source of truth, same as
  // the product console, so a paste-in link works just as well as an upload.
  const fileInput = $('a-image-file');
  const urlInput = $('a-image');
  const preview = $('a-img-preview');
  const imgStatus = $('a-img-status');
  const setPreview = (url) => { preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="">` : '<span>No image</span>'; };

  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      imgStatus.textContent = 'Pick an image file';
      imgStatus.className = 'crm-save-status err';
      return;
    }
    try { setPreview(URL.createObjectURL(f)); } catch (_) {}
    imgStatus.textContent = 'Uploading…';
    imgStatus.className = 'crm-save-status';
    try {
      const url = await uploadAnnouncementImage(f);
      urlInput.value = url;
      setPreview(url);
      imgStatus.textContent = 'Uploaded ✓';
      imgStatus.className = 'crm-save-status ok';
    } catch (err) {
      imgStatus.textContent = 'Upload failed: ' + (err.message || err);
      imgStatus.className = 'crm-save-status err';
    }
  });
  urlInput.addEventListener('input', () => setPreview(urlInput.value.trim()));

  $('a-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const audience = $('a-audience').value;
    const target = $('a-target').value.trim();
    const data = {
      title: $('a-title').value,
      body: $('a-body').value,
      kind: $('a-kind').value,
      priority: $('a-priority').value,
      ctaLabel: $('a-cta-label').value,
      ctaHref: $('a-cta-href').value,
      publishAt: $('a-publish').value,
      expiresAt: $('a-expires').value,
      audience,
      // One field feeds whichever target the chosen audience actually uses.
      courseSlug: audience === 'enrolled' ? target : '',
      companyId: audience === 'company' ? target : '',
      imageUrl: $('a-image').value || null,
      active: $('a-active').checked
    };
    try {
      if (editing) await updateAnnouncement(a.id, data);
      else await createAnnouncement(data);
      close();
      await reload();
    } catch (err) {
      $('a-err').textContent = err.message || String(err);
      $('a-err').style.display = '';
    }
  });
}

async function reload() {
  state.rows = await listAllAnnouncements();
  render();
}

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/manage-announcements.html')); return; }
  const info = await getRoleInfo(true);
  renderTopbar({ user: u, role: info.role, currentPage: 'announcements-admin' });
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  $('panel').style.display = 'block';
  $('btn-new-announcement').addEventListener('click', () => openModal(null));
  await reload();
}

main();
