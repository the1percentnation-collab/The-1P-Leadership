// Contact detail page — edits, notes feed, activity log.

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady, signOut } from './auth.js';
import { getRoleInfo } from './roles.js';
import { collection, getDocs, query, where, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  STAGES, STAGE_IDS, SOURCES, stageMeta,
  getContact, updateContact, changeStage,
  addTag, removeTag, deleteContact,
  listNotes, addNote, deleteNote,
  listActivities, addManualActivity,
  listCompanyAdmins,
  escapeHtml, fmtDateTime
} from './crm.js';

const $ = (id) => document.getElementById(id);

const state = {
  uid: null,
  role: null,
  companyId: null,
  contactId: null,
  contact: null,
  admins: [],
  feedTab: 'notes',
  notes: [],
  activities: []
};

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${escapeHtml(msg)}</div></div>`;
}

function renderChip(user, role) {
  const chip = $('user-chip');
  if (!chip) return;
  const adminLink = role === 'admin' || role === 'owner'
    ? `<a class="user-chip-link" href="/admin.html">Admin</a>` : '';
  const ownerLink = role === 'owner'
    ? `<a class="user-chip-link" href="/owner.html">Owner</a>` : '';
  const campaignsLink = role === 'admin' || role === 'owner'
    ? `<a class="user-chip-link" href="/campaigns.html">Campaigns</a>` : '';
  chip.innerHTML = `
    <a class="user-chip-link" href="/index.html">Dashboard</a>
    <a class="user-chip-link" href="/crm.html">CRM</a>
    ${campaignsLink}
    <a class="user-chip-link" href="/community.html">Community</a>
    ${adminLink}${ownerLink}
    <span class="user-chip-email">${escapeHtml(user.email || '')}</span>
    <button class="btn btn-ghost" id="btn-signout">Sign out</button>
  `;
  $('btn-signout').addEventListener('click', async () => {
    try { await signOut(); } catch (e) {}
    location.replace('/login.html');
  });
}

// ────────────────────────────────────────────────────────────────
// Header + info form
// ────────────────────────────────────────────────────────────────
function renderContactHeader() {
  const c = state.contact;
  if (!c) return;
  $('ct-name').value = c.name || '';
  const meta = stageMeta(c.stage);
  const ownerEntry = state.admins.find((a) => a.uid === c.ownerUid);
  const ownerLabel = ownerEntry ? (ownerEntry.displayName || ownerEntry.email || '') : '';
  const bits = [];
  if (c.companyName) bits.push(escapeHtml(c.companyName));
  if (ownerLabel) bits.push('Owner: ' + escapeHtml(ownerLabel));
  bits.push(`<span class="crm-stage-badge" style="--stage-color:${meta.color}">${escapeHtml(meta.label)}</span>`);
  $('ct-sub').innerHTML = bits.join(' · ');

  // Stage selector
  const stageSel = $('ct-stage');
  stageSel.innerHTML = STAGES.map((s) =>
    `<option value="${s.id}" ${s.id === c.stage ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('');

  // Owner selector
  const ownerSel = $('ct-owner');
  const opts = state.admins.length ? state.admins.map((a) =>
    `<option value="${a.uid}" ${a.uid === c.ownerUid ? 'selected' : ''}>${escapeHtml(a.displayName || a.email || a.uid)}</option>`) : [`<option value="${c.ownerUid || state.uid}">Me</option>`];
  ownerSel.innerHTML = opts.join('');

  // Source
  const sourceSel = $('ct-source');
  sourceSel.innerHTML = SOURCES.map((s) =>
    `<option value="${s}" ${c.source === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');

  // Inputs
  $('ct-email').value = c.email || '';
  $('ct-phone').value = c.phone || '';
  $('ct-company').value = c.companyName || '';

  // Tags
  renderTags();
}

function renderTags() {
  const host = $('ct-tags');
  const tags = (state.contact && state.contact.tags) || [];
  if (!tags.length) {
    host.innerHTML = `<span class="crm-tags-empty">No tags yet.</span>`;
    return;
  }
  host.innerHTML = tags.map((t) =>
    `<span class="crm-tag crm-tag-removable">#${escapeHtml(t)}<button class="crm-tag-x" data-tag-remove="${escapeHtml(t)}" title="Remove">×</button></span>`
  ).join('');
  host.querySelectorAll('[data-tag-remove]').forEach((b) => {
    b.addEventListener('click', async () => {
      const t = b.getAttribute('data-tag-remove');
      try {
        await removeTag(state.companyId, state.contactId, t);
        await refreshContact();
      } catch (e) { alert('Could not remove tag: ' + (e.message || e)); }
    });
  });
}

// ────────────────────────────────────────────────────────────────
// Notes + activity feeds
// ────────────────────────────────────────────────────────────────
function iconFor(type) {
  switch (type) {
    case 'note_added': return '📝';
    case 'stage_changed': return '⇨';
    case 'contact_created': return '✨';
    case 'tag_added': return '+';
    case 'tag_removed': return '−';
    case 'manual_call': return '☎';
    case 'manual_meeting': return '🤝';
    case 'manual_email': return '✉';
    case 'manual_sms': return '💬';
    case 'email_sent': return '✉';
    case 'email_event': return '📬';
    default: return '•';
  }
}

function renderNotes() {
  const host = $('notes-list');
  if (!state.notes.length) {
    host.innerHTML = `<div class="crm-empty">No notes yet.</div>`;
    return;
  }
  host.innerHTML = state.notes.map((n) => `
    <div class="crm-note">
      <div class="crm-note-head">
        <span class="crm-note-author">${escapeHtml(n.authorName || 'Unknown')}</span>
        <span class="crm-note-time">${fmtDateTime(n.createdAt)}</span>
        ${n.authorUid === state.uid || state.role === 'owner'
          ? `<button class="crm-note-del" data-del-note="${n.id}" title="Delete note">×</button>` : ''}
      </div>
      <div class="crm-note-body">${escapeHtml(n.body || '')}</div>
    </div>
  `).join('');
  host.querySelectorAll('[data-del-note]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Delete this note?')) return;
      try {
        await deleteNote(state.companyId, state.contactId, b.getAttribute('data-del-note'));
        await refreshNotes();
      } catch (e) { alert('Could not delete: ' + (e.message || e)); }
    });
  });
}

function renderActivities() {
  const host = $('activity-list');
  if (!state.activities.length) {
    host.innerHTML = `<div class="crm-empty">No activity yet.</div>`;
    return;
  }
  host.innerHTML = state.activities.map((a) => `
    <div class="crm-activity-item">
      <span class="crm-activity-icon">${iconFor(a.type)}</span>
      <div class="crm-activity-body">
        <div class="crm-activity-desc">${escapeHtml(a.description || a.type || '')}</div>
        <div class="crm-activity-meta">
          <span>${escapeHtml(a.actorName || 'Unknown')}</span>
          <span>·</span>
          <span>${fmtDateTime(a.createdAt)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

async function refreshNotes() {
  state.notes = await listNotes(state.companyId, state.contactId);
  renderNotes();
}
async function refreshActivities() {
  state.activities = await listActivities(state.companyId, state.contactId);
  renderActivities();
}
async function refreshContact() {
  state.contact = await getContact(state.companyId, state.contactId);
  if (!state.contact) {
    gate('Contact not found.');
    return;
  }
  renderContactHeader();
}

// ────────────────────────────────────────────────────────────────
// Bootstrap + event wiring
// ────────────────────────────────────────────────────────────────
async function resolveCompanyId(uid, info) {
  let companyId = info.companyId || null;
  if (!companyId && info.isAdmin) {
    try {
      const q = query(collection(db, 'companies'), where('adminUids', 'array-contains', uid), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) companyId = snap.docs[0].id;
    } catch (e) {}
  }
  return companyId;
}

function setStatus(msg, cls) {
  const el = $('ct-save-status');
  el.textContent = msg;
  el.className = 'crm-save-status ' + (cls || '');
  if (msg) {
    setTimeout(() => {
      if (el.textContent === msg) { el.textContent = ''; el.className = 'crm-save-status'; }
    }, 2600);
  }
}

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) {
    location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
    return;
  }
  const info = await getRoleInfo(true);
  state.uid = u.uid;
  state.role = info.role;
  renderChip(u, info.role);

  if (!info.isAdmin) {
    location.replace('/index.html');
    return;
  }

  const contactId = new URLSearchParams(location.search).get('id');
  if (!contactId) { gate('Missing contact id.'); return; }
  state.contactId = contactId;

  const companyId = await resolveCompanyId(u.uid, info);
  if (!companyId) { gate('No company context.'); return; }
  state.companyId = companyId;

  try {
    state.admins = await listCompanyAdmins(companyId);
  } catch (e) { state.admins = []; }

  state.contact = await getContact(companyId, contactId);
  if (!state.contact) { gate('Contact not found.'); return; }

  $('panel').style.display = 'block';
  renderContactHeader();
  await Promise.all([refreshNotes(), refreshActivities()]);

  // Feed tabs
  document.querySelectorAll('.crm-tab[data-feed-tab]').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.crm-tab[data-feed-tab]').forEach((x) => x.classList.toggle('active', x === b));
      state.feedTab = b.getAttribute('data-feed-tab');
      $('feed-notes').style.display = state.feedTab === 'notes' ? '' : 'none';
      $('feed-activity').style.display = state.feedTab === 'activity' ? '' : 'none';
    });
  });

  // Stage change
  $('ct-stage').addEventListener('change', async (e) => {
    const to = e.target.value;
    const from = state.contact.stage;
    if (to === from) return;
    try {
      await changeStage(state.companyId, state.contactId, from, to);
      await Promise.all([refreshContact(), refreshActivities()]);
      setStatus('Stage updated', 'ok');
    } catch (err) { alert('Could not change stage: ' + (err.message || err)); }
  });

  // Owner change
  $('ct-owner').addEventListener('change', async (e) => {
    const uid = e.target.value;
    try {
      await updateContact(state.companyId, state.contactId, { ownerUid: uid });
      await refreshContact();
      setStatus('Owner updated', 'ok');
    } catch (err) { alert('Could not change owner: ' + (err.message || err)); }
  });

  // Save button — bulk patches to name/email/phone/company/source
  $('btn-save-contact').addEventListener('click', async () => {
    const patch = {
      name: $('ct-name').value.trim() || 'Unnamed contact',
      email: $('ct-email').value.trim() || null,
      phone: $('ct-phone').value.trim() || null,
      companyName: $('ct-company').value.trim() || null,
      source: $('ct-source').value
    };
    try {
      await updateContact(state.companyId, state.contactId, patch);
      await refreshContact();
      setStatus('Saved', 'ok');
    } catch (err) {
      setStatus('Error: ' + (err.message || err), 'err');
    }
  });

  // Add tag
  $('ct-add-tag-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('ct-add-tag').value.trim();
    if (!v) return;
    try {
      await addTag(state.companyId, state.contactId, v);
      $('ct-add-tag').value = '';
      await Promise.all([refreshContact(), refreshActivities()]);
    } catch (err) { alert('Could not add tag: ' + (err.message || err)); }
  });

  // Note add
  $('btn-add-note').addEventListener('click', async () => {
    const body = $('note-body').value.trim();
    if (!body) return;
    try {
      await addNote(state.companyId, state.contactId, body);
      $('note-body').value = '';
      await Promise.all([refreshNotes(), refreshActivities(), refreshContact()]);
    } catch (err) { alert('Could not add note: ' + (err.message || err)); }
  });

  // Manual activity loggers
  document.querySelectorAll('[data-manual]').forEach((b) => {
    b.addEventListener('click', async () => {
      const type = b.getAttribute('data-manual');
      const label = { manual_call: 'Call', manual_meeting: 'Meeting', manual_email: 'Email', manual_sms: 'SMS' }[type] || 'Activity';
      const desc = prompt(`Log a ${label.toLowerCase()} — short description:`);
      if (!desc) return;
      try {
        await addManualActivity(state.companyId, state.contactId, { type, description: desc });
        await Promise.all([refreshActivities(), refreshContact()]);
      } catch (err) { alert('Could not log: ' + (err.message || err)); }
    });
  });

  // Delete
  $('btn-delete-contact').addEventListener('click', async () => {
    if (!confirm(`Delete ${state.contact.name}? This also removes all notes and activity history.`)) return;
    try {
      await deleteContact(state.companyId, state.contactId);
      location.replace('/crm.html');
    } catch (err) { alert('Could not delete: ' + (err.message || err)); }
  });

  // Send Email
  $('btn-send-email').addEventListener('click', openSendEmailModal);
}

function openSendEmailModal() {
  const root = $('modal-root');
  const c = state.contact || {};
  if (!c.email) {
    alert('This contact has no email address. Add one under the Email field first.');
    return;
  }
  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal send-email-modal auth-card">
        <h1>Send <span>Email</span></h1>
        <div class="camp-from-hint" style="margin-bottom:12px;">From: the1percentnation@gmail.com · To: ${escapeHtml(c.email)}</div>
        <form id="send-email-form" class="crm-form">
          <div class="crm-form-row">
            <label>Subject</label>
            <input class="c-input" id="se-subject" required placeholder="Subject line" />
          </div>
          <div class="crm-form-row">
            <label>Body (plain text — line breaks become &lt;br&gt;)</label>
            <textarea class="c-textarea" id="se-body" rows="10" required placeholder="Hi ${escapeHtml((c.name || '').split(' ')[0] || 'there')},\n\n"></textarea>
          </div>
          <div id="se-err" class="auth-error" style="display:none;"></div>
          <div id="se-ok" class="auth-ok" style="display:none;"></div>
          <div class="crm-modal-actions">
            <button type="button" class="btn btn-ghost" id="se-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary" id="se-send">Send</button>
          </div>
        </form>
      </div>
    </div>
  `;
  const close = () => { root.innerHTML = ''; };
  $('se-cancel').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });

  $('send-email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = $('se-subject').value.trim();
    const bodyText = $('se-body').value;
    if (!subject || !bodyText.trim()) return;

    const bodyHtml = bodyText
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');

    $('se-err').style.display = 'none';
    $('se-ok').style.display = 'none';
    const btn = $('se-send');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const call = httpsCallable(functions, 'sendContactEmail');
      await call({
        companyId: state.companyId,
        contactId: state.contactId,
        subject,
        bodyHtml,
        bodyText
      });
      $('se-ok').textContent = 'Email sent.';
      $('se-ok').style.display = 'block';
      await Promise.all([refreshActivities(), refreshContact()]);
      setTimeout(close, 900);
    } catch (err) {
      $('se-err').textContent = err.message || String(err);
      $('se-err').style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  });
}

main();
