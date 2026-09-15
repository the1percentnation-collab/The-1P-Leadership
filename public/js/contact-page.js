// Contact detail page — edits, notes feed, activity log.

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import { collection, getDocs, query, where, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  STAGES, STAGE_IDS, SOURCES, stageMeta,
  getContact, updateContact, changeStage,
  addTag, removeTag, deleteContact,
  listNotes, addNote, deleteNote,
  listActivities, addManualActivity,
  listCompanyAdmins,
  ensureDefaultPipeline, listOpportunities, createOpportunity,
  listTasks, createTask, completeTask, reopenTask,
  listAppointments, createAppointment, setAppointmentStatus,
  listMessages, sendSms,
  listCalls, setDoNotCall, dispositionMeta, callBlockReason,
  getGoogleCalendarStatus,
  escapeHtml, fmtDateTime, fmtDate, fmtMoney, toDate
} from './crm.js';
import { dialer, onDialerEvent } from './dialer-core.js';

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
  activities: [],
  pipeline: null,
  deals: [],
  tasks: [],
  appts: [],
  messages: [],
  calls: [],
  callsLoaded: false,
  google: { connected: false },
  dealsLoaded: false,
  tasksLoaded: false,
  apptsLoaded: false,
  smsLoaded: false
};

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${escapeHtml(msg)}</div></div>`;
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

  // Consent controls. The SMS side is read-only here: smsOptedOut is set by
  // the inbound webhook when a lead replies STOP, and an admin un-ticking it
  // in the CRM would not be consent.
  const dnc = $('ct-dnc');
  if (dnc) dnc.checked = c.doNotCall === true;
  const smsNote = $('ct-sms-consent');
  if (smsNote) {
    smsNote.textContent = c.smsOptedOut === true
      ? 'This contact replied STOP — texting is blocked.'
      : '';
  }

  // Comms buttons are only live when there is something to reach.
  const blocked = callBlockReason(c);
  const callBtn = $('btn-call-contact');
  if (callBtn) {
    callBtn.disabled = !!blocked;
    callBtn.title = blocked || 'Call this contact';
  }
  const textBtn = $('btn-text-contact');
  if (textBtn) {
    const smsBlocked = !c.phone
      ? 'This contact has no phone number.'
      : (c.smsOptedOut === true ? 'This contact opted out of SMS.' : null);
    textBtn.disabled = !!smsBlocked;
    textBtn.title = smsBlocked || 'Text this contact';
  }

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
    case 'sms_received': return '📩';
    case 'deal_created': return '◆';
    case 'deal_won': return '🏆';
    case 'deal_lost': return '✖';
    case 'deal_stage_changed': return '⇨';
    case 'task_created': return '✓';
    case 'task_completed': return '☑';
    case 'call_logged': return '☎';
    case 'call_completed': return '☎';
    case 'call_inbound': return '📞';
    case 'voicemail_received': return '📨';
    case 'calendar_synced': return '🗓';
    case 'dnc_added': return '⛔';
    case 'dnc_removed': return '✅';
    case 'appointment_created': return '📅';
    case 'appointment_status': return '📅';
    case 'email_sent': return '✉';
    case 'email_event': return '📬';
    case 'event_registration': return '🎟';
    case 'course_interest': return '🎓';
    case 'member_onboarding': return '🚀';
    case 'consent_updated': return '✅';
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

// ────────────────────────────────────────────────────────────────
// Deals + Tasks panes (per-contact)
// ────────────────────────────────────────────────────────────────
function dealStageLabel(stageId) {
  const st = state.pipeline && (state.pipeline.stages || []).find((s) => s.id === stageId);
  return st ? st.label : (stageId || '—');
}

function renderDeals() {
  const host = $('deals-list');
  if (!host) return;
  if (!state.deals.length) {
    host.innerHTML = `<div class="crm-subpanel-empty">No deals yet. Create one to start tracking revenue for this contact.</div>`;
    return;
  }
  host.innerHTML = state.deals.map((o) => {
    const status = o.status === 'won' ? 'Won' : (o.status === 'lost' ? 'Lost' : dealStageLabel(o.stageId));
    return `
      <a class="crm-mini-row" href="/opportunities.html" style="text-decoration:none;">
        <div class="crm-mini-main">
          <div class="crm-mini-title">${escapeHtml(o.title)}</div>
          <div class="crm-mini-sub">${escapeHtml(status)}${o.expectedCloseAt ? ' · close ' + fmtDate(o.expectedCloseAt) : ''}</div>
        </div>
        <span class="crm-mini-val">${fmtMoney(o.value)}</span>
      </a>`;
  }).join('');
}

function renderContactTasks() {
  const host = $('tasks-list');
  if (!host) return;
  if (!state.tasks.length) {
    host.innerHTML = `<div class="crm-subpanel-empty">No tasks for this contact.</div>`;
    return;
  }
  host.innerHTML = state.tasks.map((t) => {
    const done = t.status === 'done';
    const due = toDate(t.dueAt);
    const overdue = !done && due && due < new Date();
    return `
      <div class="crm-mini-row">
        <button class="task-check ${done ? 'checked' : ''}" data-toggle-task="${t.id}" aria-label="Toggle">${done ? '✓' : ''}</button>
        <div class="crm-mini-main">
          <div class="crm-mini-title" style="${done ? 'text-decoration:line-through;color:var(--gray-mid);' : ''}">${escapeHtml(t.title)}</div>
          <div class="crm-mini-sub ${overdue ? 'task-due-overdue' : ''}">${t.dueAt ? 'Due ' + fmtDate(t.dueAt) : 'No due date'}</div>
        </div>
      </div>`;
  }).join('');
  host.querySelectorAll('[data-toggle-task]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-toggle-task');
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    try {
      if (t.status === 'done') await reopenTask(state.companyId, id);
      else await completeTask(state.companyId, id, { contactId: state.contactId, title: t.title });
      await Promise.all([refreshContactTasks(), refreshActivities()]);
    } catch (e) { alert('Could not update task: ' + (e.message || e)); }
  }));
}

function renderAppts() {
  const host = $('appts-list');
  if (!host) return;
  if (!state.appts.length) {
    host.innerHTML = `<div class="crm-subpanel-empty">No appointments for this contact.</div>`;
    return;
  }
  const rows = state.appts.slice().sort((a, b) => (toDate(b.startAt)?.getTime() || 0) - (toDate(a.startAt)?.getTime() || 0));
  host.innerHTML = rows.map((a) => {
    const d = toDate(a.startAt);
    const statusLabel = a.status === 'scheduled' ? '' : ` · ${a.status}`;
    return `
      <div class="crm-mini-row">
        <div class="crm-mini-main">
          <div class="crm-mini-title">${escapeHtml(a.title)}</div>
          <div class="crm-mini-sub">${d ? d.toLocaleString() : '—'}${a.location ? ' · ' + escapeHtml(a.location) : ''}${escapeHtml(statusLabel)}</div>
          ${a.meetLink ? `<div class="crm-mini-sub"><a href="${escapeHtml(a.meetLink)}" target="_blank" rel="noopener" class="crm-meet-link">Join Google Meet</a>${a.googleEventId ? ' · on Google Calendar' : ''}</div>` : (a.googleEventId ? '<div class="crm-mini-sub">On Google Calendar</div>' : '')}
          ${a.googleSyncError ? `<div class="crm-mini-sub" style="color:var(--red);">Calendar sync failed: ${escapeHtml(a.googleSyncError)}</div>` : ''}
        </div>
        ${a.status === 'scheduled' ? `<button class="crm-chip" data-appt-done="${a.id}">Done</button>` : ''}
      </div>`;
  }).join('');
  host.querySelectorAll('[data-appt-done]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await setAppointmentStatus(state.companyId, b.getAttribute('data-appt-done'), 'completed', { contactId: state.contactId });
      await Promise.all([refreshAppts(), refreshActivities()]);
    } catch (e) { alert('Could not update: ' + (e.message || e)); }
  }));
}

async function refreshAppts() {
  state.appts = await listAppointments(state.companyId, { contactId: state.contactId });
  renderAppts();
}

function renderCalls() {
  const host = $('calls-list');
  if (!host) return;
  if (!state.calls.length) {
    host.innerHTML = `<div class="crm-subpanel-empty">No calls logged for this contact yet.</div>`;
    return;
  }
  host.innerHTML = state.calls.map((cl) => {
    const meta = dispositionMeta(cl.disposition);
    const dur = cl.durationSec
      ? `${Math.floor(cl.durationSec / 60)}m ${cl.durationSec % 60}s`
      : (cl.status === 'no-answer' ? 'no answer' : '—');
    const bits = [
      cl.direction === 'in' ? 'Inbound' : 'Outbound',
      dur,
      cl.agentName ? escapeHtml(cl.agentName) : null,
      cl.mode === 'manual' ? 'logged manually' : null
    ].filter(Boolean);
    return `
      <div class="crm-mini-row">
        <div class="crm-mini-main">
          <div class="crm-mini-title">
            ${meta ? escapeHtml(meta.label) : escapeHtml(cl.status || 'Call')}
            <span class="crm-mini-sub">${fmtDateTime(cl.createdAt)}</span>
          </div>
          <div class="crm-mini-sub">${bits.join(' · ')}</div>
          ${cl.dispositionNote ? `<div class="crm-mini-sub">${escapeHtml(cl.dispositionNote)}</div>` : ''}
          ${cl.recordingUrl && cl.recordingStatus === 'ready'
            ? `<audio class="call-recording" controls preload="none" src="${escapeHtml(cl.recordingUrl)}"></audio>`
            : (cl.recordingStatus === 'pending' ? '<div class="crm-mini-sub">Recording processing…</div>' : '')}
        </div>
      </div>`;
  }).join('');
}

async function refreshCalls() {
  state.calls = await listCalls(state.companyId, { contactId: state.contactId });
  renderCalls();
}

/**
 * Dial this contact. The dock owns the call and the disposition prompt; all
 * this needs to do is act on the outcome — a booked call should open the
 * appointment modal while the agent still has the context in their head.
 */
async function startCall() {
  try {
    const result = await dialer.callContact(state.contact);
    if (result && result.followUp === 'appointment') openContactApptModal();
    if (result && result.followUp === 'task') openContactTaskModal();
  } catch (e) {
    const msg = e && e.message;
    if (msg && msg !== 'Cancelled.') alert(msg);
    return;
  }
  await Promise.all([refreshCalls(), refreshActivities(), refreshContact()]);
}

function renderSms() {
  const host = $('sms-pane');
  if (!host) return;
  const c = state.contact || {};
  if (!c.phone) {
    host.innerHTML = `<div class="crm-subpanel-empty">Add a phone number to this contact to text them.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="sms-thread-mini">
      <div class="sms-messages" id="ct-sms-messages">
        ${state.messages.length ? state.messages.map((m) => `
          <div class="sms-bubble sms-${m.direction === 'out' ? 'out' : 'in'}">
            <div class="sms-bubble-body">${escapeHtml(m.body || '')}</div>
            <div class="sms-bubble-meta">${fmtDateTime(m.createdAt)}${m.status ? ' · ' + escapeHtml(m.status) : ''}</div>
          </div>`).join('') : '<div class="crm-subpanel-empty" style="margin:auto;">No texts yet. Send the first one below.</div>'}
      </div>
      <form class="sms-composer" id="ct-sms-form">
        <input class="c-input" id="ct-sms-input" placeholder="Type a text…" autocomplete="off" />
        <button class="btn btn-primary" type="submit" id="ct-sms-send">Send</button>
      </form>
    </div>
    <div id="ct-sms-err" class="auth-error" style="display:none;margin-top:8px;"></div>`;
  const msgs = $('ct-sms-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
  $('ct-sms-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('ct-sms-input');
    const text = input.value.trim();
    if (!text) return;
    const btn = $('ct-sms-send');
    btn.disabled = true; btn.textContent = 'Sending…';
    $('ct-sms-err').style.display = 'none';
    try {
      await sendSms(state.companyId, state.contactId, text);
      input.value = '';
      await Promise.all([refreshSms(), refreshActivities()]);
    } catch (err) {
      $('ct-sms-err').textContent = err.message || String(err);
      $('ct-sms-err').style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Send';
    }
  });
}

async function refreshSms() {
  state.messages = await listMessages(state.companyId, state.contactId);
  renderSms();
}

async function refreshDeals() {
  if (!state.pipeline) state.pipeline = await ensureDefaultPipeline(state.companyId);
  state.deals = await listOpportunities(state.companyId, { contactId: state.contactId });
  renderDeals();
}
async function refreshContactTasks() {
  state.tasks = await listTasks(state.companyId, { contactId: state.contactId });
  renderContactTasks();
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
  renderTopbar({ user: u, role: info.role, currentPage: null });

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
    [state.admins, state.google] = await Promise.all([
      listCompanyAdmins(companyId), getGoogleCalendarStatus(companyId)
    ]);
  } catch (e) { state.admins = []; }

  state.contact = await getContact(companyId, contactId);
  if (!state.contact) { gate('Contact not found.'); return; }

  // Configure the softphone. This does not build the Twilio Device or ask for
  // the microphone — that happens on the first actual call.
  try {
    await dialer.configure({ companyId, uid: u.uid });
  } catch (e) { console.warn('[contact] dialer configure failed', e); }

  // A call placed from anywhere on this page refreshes the panes it affects.
  onDialerEvent('disposition', () => {
    refreshCalls().catch(() => {});
    refreshActivities().catch(() => {});
  });

  $('panel').style.display = 'block';
  renderContactHeader();
  await Promise.all([refreshNotes(), refreshActivities()]);

  // Feed tabs (Notes / Deals / Tasks / Activity) with lazy loading.
  const PANES = { notes: 'feed-notes', deals: 'feed-deals', tasks: 'feed-tasks', appts: 'feed-appts', calls: 'feed-calls', sms: 'feed-sms', activity: 'feed-activity' };
  document.querySelectorAll('.crm-tab[data-feed-tab]').forEach((b) => {
    b.addEventListener('click', async () => {
      document.querySelectorAll('.crm-tab[data-feed-tab]').forEach((x) => x.classList.toggle('active', x === b));
      state.feedTab = b.getAttribute('data-feed-tab');
      Object.keys(PANES).forEach((k) => {
        const el = $(PANES[k]);
        if (el) el.style.display = (k === state.feedTab) ? '' : 'none';
      });
      if (state.feedTab === 'deals' && !state.dealsLoaded) { state.dealsLoaded = true; await refreshDeals(); }
      if (state.feedTab === 'tasks' && !state.tasksLoaded) { state.tasksLoaded = true; await refreshContactTasks(); }
      if (state.feedTab === 'appts' && !state.apptsLoaded) { state.apptsLoaded = true; await refreshAppts(); }
      if (state.feedTab === 'calls' && !state.callsLoaded) { state.callsLoaded = true; await refreshCalls(); }
      if (state.feedTab === 'sms' && !state.smsLoaded) { state.smsLoaded = true; await refreshSms(); }
    });
  });

  // New deal / task / appointment for this contact
  $('btn-add-deal').addEventListener('click', openContactDealModal);
  $('btn-add-task').addEventListener('click', openContactTaskModal);
  $('btn-add-appt').addEventListener('click', openContactApptModal);

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

  // ── Comms: call, text, schedule ────────────────────────────────────────
  $('btn-call-contact').addEventListener('click', startCall);
  const paneCallBtn = $('btn-call-from-pane');
  if (paneCallBtn) paneCallBtn.addEventListener('click', startCall);

  // Text jumps to the thread that is already on this page rather than
  // navigating away — the point of the button is to stay in context.
  $('btn-text-contact').addEventListener('click', async () => {
    const tab = document.querySelector('.crm-tab[data-feed-tab="sms"]');
    if (tab) tab.click();
    if (!state.smsLoaded) { state.smsLoaded = true; await refreshSms(); }
    const input = $('ct-sms-input');
    if (input) input.focus();
  });

  $('btn-schedule-contact').addEventListener('click', openContactApptModal);

  // Do-not-call. Saved immediately rather than waiting for Save changes:
  // a half-saved consent flag is worse than none.
  $('ct-dnc').addEventListener('change', async (e) => {
    const on = e.target.checked;
    try {
      await setDoNotCall(state.companyId, state.contactId, on);
      await Promise.all([refreshContact(), refreshActivities()]);
      setStatus(on ? 'Added to do-not-call' : 'Removed from do-not-call', 'ok');
    } catch (err) {
      e.target.checked = !on;
      setStatus('Could not save: ' + (err.message || err), 'err');
    }
  });
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

function openContactDealModal() {
  const root = $('modal-root');
  const c = state.contact || {};
  const stages = (state.pipeline && state.pipeline.stages || STAGES).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">
        <h1>New <span>Deal</span></h1>
        <form id="cd-form" class="crm-form">
          <div class="crm-form-row"><label>Deal title *</label>
            <input class="c-input" id="cd-title" required value="${escapeHtml(c.name ? c.name + ' — ' : '')}" placeholder="Annual plan" /></div>
          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Value ($)</label>
              <input class="c-input" id="cd-value" type="number" min="0" step="1" placeholder="5000" /></div>
            <div class="crm-form-row"><label>Stage</label>
              <select class="c-input crm-select" id="cd-stage">
                ${stages.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}
              </select></div>
          </div>
          <div class="crm-form-row"><label>Expected close</label>
            <input class="c-input" id="cd-close" type="date" /></div>
          <div id="cd-err" class="auth-error" style="display:none;"></div>
          <div class="crm-modal-actions">
            <button type="button" class="btn btn-ghost" id="cd-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Create deal</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  $('cd-cancel').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });
  $('cd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (!state.pipeline) state.pipeline = await ensureDefaultPipeline(state.companyId);
      const closeStr = $('cd-close').value;
      await createOpportunity(state.companyId, {
        title: $('cd-title').value, value: $('cd-value').value,
        stageId: $('cd-stage').value, pipelineId: state.pipeline.id,
        expectedCloseAt: closeStr ? new Date(closeStr + 'T12:00:00') : null,
        contactId: state.contactId, contactName: c.name || null,
        ownerUid: c.ownerUid || state.uid, source: c.source || null
      });
      close();
      await Promise.all([refreshDeals(), refreshActivities(), refreshContact()]);
    } catch (err) {
      $('cd-err').textContent = err.message || String(err);
      $('cd-err').style.display = '';
    }
  });
}

function openContactTaskModal() {
  const root = $('modal-root');
  const c = state.contact || {};
  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">
        <h1>New <span>Task</span></h1>
        <form id="ct-form" class="crm-form">
          <div class="crm-form-row"><label>Title *</label>
            <input class="c-input" id="ctk-title" required placeholder="Follow up with ${escapeHtml((c.name || 'contact').split(' ')[0])}" /></div>
          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Due</label>
              <input class="c-input" id="ctk-due" type="datetime-local" /></div>
            <div class="crm-form-row"><label>Priority</label>
              <select class="c-input crm-select" id="ctk-priority">
                <option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option>
              </select></div>
          </div>
          <div id="ctk-err" class="auth-error" style="display:none;"></div>
          <div class="crm-modal-actions">
            <button type="button" class="btn btn-ghost" id="ctk-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Create task</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  $('ctk-cancel').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });
  $('ct-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const dueStr = $('ctk-due').value;
      await createTask(state.companyId, {
        title: $('ctk-title').value,
        dueAt: dueStr ? new Date(dueStr) : null,
        priority: $('ctk-priority').value,
        assigneeUid: c.ownerUid || state.uid,
        contactId: state.contactId, contactName: c.name || null
      });
      close();
      await Promise.all([refreshContactTasks(), refreshActivities()]);
    } catch (err) {
      $('ctk-err').textContent = err.message || String(err);
      $('ctk-err').style.display = '';
    }
  });
}

function openContactApptModal() {
  const root = $('modal-root');
  const c = state.contact || {};
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  const localVal = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">
        <h1>New <span>Appointment</span></h1>
        <form id="ca-form" class="crm-form">
          <div class="crm-form-row"><label>Title *</label>
            <input class="c-input" id="ca-title" required placeholder="Call with ${escapeHtml((c.name || 'contact').split(' ')[0])}" /></div>
          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Start *</label>
              <input class="c-input" id="ca-start" type="datetime-local" required value="${localVal}" /></div>
            <div class="crm-form-row"><label>Duration (min)</label>
              <input class="c-input" id="ca-dur" type="number" min="5" step="5" value="30" /></div>
          </div>
          <div class="crm-form-row"><label>Location / link</label>
            <input class="c-input" id="ca-loc" placeholder="${state.google.connected ? 'Leave blank for a Google Meet link' : 'Zoom, address, or phone'}" /></div>
          ${state.google.connected ? `
          <div class="crm-form-row">
            <label class="crm-consent-check">
              <input type="checkbox" id="ca-invite" ${c.email ? 'checked' : 'disabled'} />
              ${c.email ? `Send a calendar invite to ${escapeHtml(c.email)}` : 'Add an email to this contact to send an invite'}
            </label>
          </div>` : ''}
          <div id="ca-err" class="auth-error" style="display:none;"></div>
          <div class="crm-modal-actions">
            <button type="button" class="btn btn-ghost" id="ca-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Book</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  $('ca-cancel').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });
  $('ca-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const startStr = $('ca-start').value;
      await createAppointment(state.companyId, {
        title: $('ca-title').value,
        startAt: startStr ? new Date(startStr) : null,
        durationMin: $('ca-dur').value,
        location: $('ca-loc').value || null,
        ownerUid: c.ownerUid || state.uid,
        contactId: state.contactId, contactName: c.name || null,
        inviteContact: !!($('ca-invite') && $('ca-invite').checked)
      });
      close();
      await Promise.all([refreshAppts(), refreshActivities()]);
    } catch (err) {
      $('ca-err').textContent = err.message || String(err);
      $('ca-err').style.display = '';
    }
  });
}

main();
