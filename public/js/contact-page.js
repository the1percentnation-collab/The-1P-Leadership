// Contact record — the whole history of a lead on one screen.
//
// Left column: who they are, the six actions (call, text, email, book, task,
// sequence), and the softphone itself, rendered INLINE so the record stays
// readable and editable while a call is live. Right column: a single
// chronological timeline that merges every channel — texts, calls, emails,
// campaign sends, appointments, tasks, notes, sequence events, stage moves —
// with the composer sitting on top of it.
//
// The timeline is assembled client-side from four sources (messages, calls,
// notes, activities) rather than a new collection: every writer in the system
// already lands in one of them, so nothing has to be re-plumbed to show up
// here, and a feature added later appears automatically.

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import { collection, getDocs, query, where, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  STAGES, SOURCES, stageMeta,
  getContact, updateContact, changeStage,
  addTag, removeTag, deleteContact,
  listNotes, addNote, deleteNote,
  listActivities, addManualActivity,
  listCompanyAdmins,
  ensureDefaultPipeline, listOpportunities, createOpportunity,
  listTasks, createTask, completeTask,
  listAppointments, createAppointment, setAppointmentStatus,
  listMessages, sendSms,
  listCalls, setDoNotCall, recordSmsConsent, smsConsentSummary, dispositionMeta, callBlockReason,
  getGoogleCalendarStatus, listSequences, listEnrollments, enrollContact, stopEnrollment,
  escapeHtml, fmtDateTime, fmtDate, fmtMoney, toDate
} from './crm.js';
import { dialer, onDialerEvent } from './dialer-core.js';
import { mountTemplatePicker } from './merge-fields.js';

const $ = (id) => document.getElementById(id);

const state = {
  uid: null,
  role: null,
  companyId: null,
  contactId: null,
  contact: null,
  admins: [],
  google: { connected: false },
  notes: [],
  activities: [],
  messages: [],
  calls: [],
  tasks: [],
  appts: [],
  deals: [],
  pipeline: null,
  composeTab: 'sms',
  tlFilter: 'all',
  smsTemplates: null,
  emailTemplates: null
};

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${escapeHtml(msg)}</div></div>`;
}

function setStatus(msg, cls) {
  const el = $('ct-save-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'crm-save-status ' + (cls || '');
  if (msg) {
    setTimeout(() => {
      if (el.textContent === msg) { el.textContent = ''; el.className = 'crm-save-status'; }
    }, 2600);
  }
}

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

function mergeContext() {
  return {
    contact: state.contact,
    owner: state.admins.find((a) => a.uid === state.uid) || null,
    appointment: (state.appts || []).find((a) => a.status === 'scheduled') || null
  };
}

// ────────────────────────────────────────────────────────────────
// Left column
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
  $('ct-sub').innerHTML =
    `<span class="crm-stage-badge" style="--stage-color:${meta.color}">${escapeHtml(meta.label)}</span>`
    + (bits.length ? `<span class="ct-sub-text">${bits.join(' · ')}</span>` : '');

  $('ct-stage').innerHTML = STAGES.map((s) =>
    `<option value="${s.id}" ${s.id === c.stage ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
  const opts = state.admins.length ? state.admins.map((a) =>
    `<option value="${a.uid}" ${a.uid === c.ownerUid ? 'selected' : ''}>${escapeHtml(a.displayName || a.email || a.uid)}</option>`)
    : [`<option value="${c.ownerUid || state.uid}">Me</option>`];
  $('ct-owner').innerHTML = opts.join('');
  $('ct-source').innerHTML = SOURCES.map((s) =>
    `<option value="${s}" ${c.source === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');

  $('ct-email').value = c.email || '';
  $('ct-email').title = c.email || '';
  $('ct-phone').value = c.phone || '';
  $('ct-company').value = c.companyName || '';
  $('ct-company').title = c.companyName || '';

  const dnc = $('ct-dnc');
  if (dnc) dnc.checked = c.doNotCall === true;
  const smsNote = $('ct-sms-consent');
  if (smsNote) smsNote.textContent = smsConsentSummary(c) || 'No SMS consent on record.';
  // The way back in for a lead who declined on the form and later says "text
  // me" on a call. Hidden once consent exists, and never offered after a STOP:
  // only the contact can undo that, by replying START.
  const recordBtn = $('btn-record-consent');
  if (recordBtn) recordBtn.hidden = c.smsConsent === true || c.smsOptedOut === true;

  // Disable what cannot work, with the reason in the tooltip.
  const callBlock = callBlockReason(c);
  const callBtn = $('btn-call-contact');
  if (callBtn) { callBtn.disabled = !!callBlock; callBtn.title = callBlock || 'Call this contact'; }
  const smsBlock = !c.phone ? 'No phone number'
    : (c.smsOptedOut === true ? 'Opted out of SMS'
    : (c.smsConsent === false ? 'Declined SMS consent' : null));
  const textBtn = $('btn-text-contact');
  if (textBtn) { textBtn.disabled = !!smsBlock; textBtn.title = smsBlock || 'Text this contact'; }
  const emailBtn = $('btn-send-email');
  if (emailBtn) { emailBtn.disabled = !c.email; emailBtn.title = c.email ? 'Email this contact' : 'No email address'; }

  renderTags();
}

function renderTags() {
  const host = $('ct-tags');
  const tags = (state.contact && state.contact.tags) || [];
  host.innerHTML = tags.length
    ? tags.map((t) => `<span class="crm-tag">#${escapeHtml(t)}<button class="crm-tag-x" data-rm-tag="${escapeHtml(t)}">×</button></span>`).join('')
    : '<span class="crm-tags-empty">No tags yet.</span>';
  host.querySelectorAll('[data-rm-tag]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await removeTag(state.companyId, state.contactId, b.getAttribute('data-rm-tag'));
      await Promise.all([refreshContact(), refreshTimeline()]);
    } catch (e) { alert('Could not remove tag: ' + (e.message || e)); }
  }));
}

function renderSideUpcoming() {
  const host = $('side-upcoming');
  if (!host) return;
  const now = Date.now();
  const rows = state.appts
    .filter((a) => a.status === 'scheduled' && (toDate(a.startAt)?.getTime() || 0) >= now - 3600000)
    .sort((a, b) => (toDate(a.startAt)?.getTime() || 0) - (toDate(b.startAt)?.getTime() || 0));
  const openTasks = state.tasks.filter((t) => t.status !== 'done')
    .sort((a, b) => (toDate(a.dueAt)?.getTime() || Infinity) - (toDate(b.dueAt)?.getTime() || Infinity));

  if (!rows.length && !openTasks.length) {
    host.innerHTML = `<div class="crm-subpanel-empty">Nothing scheduled.</div>`;
    return;
  }
  host.innerHTML = [
    ...rows.map((a) => {
      const d = toDate(a.startAt);
      return `<div class="crm-mini-row">
        <div class="crm-mini-main">
          <div class="crm-mini-title">${escapeHtml(a.title)}</div>
          <div class="crm-mini-sub">${d ? d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</div>
          ${a.meetLink ? `<div class="crm-mini-sub"><a class="crm-meet-link" href="${escapeHtml(a.meetLink)}" target="_blank" rel="noopener">Join Meet</a></div>` : ''}
        </div>
        <button class="crm-chip" data-appt-done="${a.id}">Done</button>
      </div>`;
    }),
    ...openTasks.map((t) => {
      const due = toDate(t.dueAt);
      const overdue = due && due < new Date();
      return `<div class="crm-mini-row">
        <button class="task-check" data-toggle-task="${t.id}" aria-label="Complete"></button>
        <div class="crm-mini-main">
          <div class="crm-mini-title">${escapeHtml(t.title)}</div>
          <div class="crm-mini-sub ${overdue ? 'task-due-overdue' : ''}">${t.dueAt ? 'Due ' + fmtDate(t.dueAt) : 'No due date'}</div>
        </div>
      </div>`;
    })
  ].join('');

  host.querySelectorAll('[data-appt-done]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await setAppointmentStatus(state.companyId, b.getAttribute('data-appt-done'), 'completed', { contactId: state.contactId });
      await reloadAll();
    } catch (e) { alert('Could not update: ' + (e.message || e)); }
  }));
  host.querySelectorAll('[data-toggle-task]').forEach((b) => b.addEventListener('click', async () => {
    const t = state.tasks.find((x) => x.id === b.getAttribute('data-toggle-task'));
    if (!t) return;
    try {
      await completeTask(state.companyId, t.id, { contactId: state.contactId, title: t.title });
      await reloadAll();
    } catch (e) { alert('Could not update task: ' + (e.message || e)); }
  }));
}

function dealStageLabel(stageId) {
  const st = state.pipeline && (state.pipeline.stages || []).find((s) => s.id === stageId);
  return st ? st.label : (stageId || '—');
}

function renderSideDeals() {
  const host = $('side-deals');
  if (!host) return;
  if (!state.deals.length) {
    host.innerHTML = `<div class="crm-subpanel-empty">No deals yet.</div>`;
    return;
  }
  host.innerHTML = state.deals.map((o) => {
    const status = o.status === 'won' ? 'Won' : (o.status === 'lost' ? 'Lost' : dealStageLabel(o.stageId));
    return `<a class="crm-mini-row" href="/opportunities.html" style="text-decoration:none;">
      <div class="crm-mini-main ct-trunc">
        <div class="crm-mini-title" title="${escapeHtml(o.title)}">${escapeHtml(o.title)}</div>
        <div class="crm-mini-sub">${escapeHtml(status)}${o.expectedCloseAt ? ' · close ' + fmtDate(o.expectedCloseAt) : ''}</div>
      </div>
      <span class="crm-mini-val">${fmtMoney(o.value)}</span>
    </a>`;
  }).join('');
}

// ────────────────────────────────────────────────────────────────
// The timeline
//
// Four sources are merged into one sorted list. Where a source collection
// holds the real content (messages, calls, notes), the matching activity
// entries are dropped so a text does not appear twice — the activity trail
// exists for auditing, the timeline for reading.
// ────────────────────────────────────────────────────────────────

// Activity types whose content is already covered by a collection above.
const ACTIVITY_DUPES = new Set([
  'manual_sms', 'sms_received',
  'call_logged', 'call_completed', 'call_inbound',
  'note_added'
]);

// Activity type → timeline kind. Anything unmapped is a system event.
const ACTIVITY_KIND = {
  email_sent: 'email', manual_email: 'email', email_event: 'email', campaign: 'email',
  appointment_created: 'appointment', appointment_status: 'appointment', calendar_synced: 'appointment',
  task_created: 'task', task_completed: 'task',
  manual_call: 'call', manual_meeting: 'appointment', voicemail_received: 'call'
};

const KIND_ICON = {
  sms: '💬', call: '☎', email: '✉', note: '📝',
  appointment: '📅', task: '✓', system: '•'
};

function ms(ts) {
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  const n = Date.parse(ts);
  return Number.isNaN(n) ? 0 : n;
}

/** One flat, newest-first list of everything that has happened to this lead. */
function buildTimeline() {
  const items = [];

  state.messages.forEach((m) => {
    items.push({
      kind: 'sms',
      dir: m.direction === 'out' ? 'out' : 'in',
      at: ms(m.createdAt),
      title: m.direction === 'out' ? 'Text sent' : 'Text received',
      body: m.body || '',
      meta: [m.status ? escapeHtml(m.status) : null, m.sequenceId ? 'via sequence' : null].filter(Boolean).join(' · ')
    });
  });

  state.calls.forEach((c) => {
    const d = dispositionMeta(c.disposition);
    const mins = c.durationSec ? `${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : null;
    items.push({
      kind: 'call',
      dir: c.direction === 'in' ? 'in' : 'out',
      at: ms(c.createdAt),
      title: (c.direction === 'in' ? 'Inbound call' : 'Outbound call') + (d ? ' — ' + d.label : (c.status ? ' — ' + c.status : '')),
      body: c.dispositionNote || '',
      meta: [mins, c.agentName ? escapeHtml(c.agentName) : null, c.mode === 'manual' ? 'logged manually' : null].filter(Boolean).join(' · '),
      audio: c.recordingStatus === 'ready' ? c.recordingUrl : null,
      pending: c.recordingStatus === 'pending'
    });
  });

  state.notes.forEach((n) => {
    items.push({
      kind: 'note',
      at: ms(n.createdAt),
      title: 'Note',
      body: n.body || '',
      meta: escapeHtml(n.authorName || 'Unknown'),
      delNote: (n.authorUid === state.uid || state.role === 'owner') ? n.id : null
    });
  });

  state.activities.forEach((a) => {
    if (ACTIVITY_DUPES.has(a.type)) return;
    const kind = ACTIVITY_KIND[a.type] || 'system';
    items.push({
      kind,
      at: ms(a.createdAt),
      title: kind === 'system' ? '' : titleForActivity(a),
      body: a.description || a.type || '',
      meta: escapeHtml(a.actorName || 'System'),
      icon: iconForActivity(a.type)
    });
  });

  items.sort((x, y) => y.at - x.at);
  return items;
}

function titleForActivity(a) {
  switch (a.type) {
    case 'email_sent': case 'manual_email': return 'Email sent';
    case 'email_event': return 'Email activity';
    case 'campaign': return 'Campaign sent';
    case 'appointment_created': return 'Appointment booked';
    case 'appointment_status': return 'Appointment updated';
    case 'calendar_synced': return 'Calendar synced';
    case 'task_created': return 'Task created';
    case 'task_completed': return 'Task completed';
    case 'manual_call': return 'Call logged';
    case 'manual_meeting': return 'Meeting logged';
    case 'voicemail_received': return 'Voicemail';
    default: return '';
  }
}

function iconForActivity(type) {
  switch (type) {
    case 'stage_changed': return '↗';
    case 'tag_added': return '#';
    case 'tag_removed': return '⌫';
    case 'contact_created': return '✦';
    case 'lead_form': return '⬇';
    case 'import': return '⬆';
    case 'sequence_enrolled': return '⇶';
    case 'sequence_stopped': return '⏹';
    case 'dnc_added': return '⛔';
    case 'dnc_removed': return '✅';
    case 'sms_opt_out': return '⛔';
    case 'sms_opt_in': return '✅';
    case 'deal_created': return '◆';
    case 'deal_won': return '★';
    case 'voicemail_received': return '📨';
    case 'campaign': return '❏';
    case 'email_event': return '👁';
    default: return null;
  }
}

function dayLabel(atMs) {
  const d = new Date(atMs);
  const today = new Date();
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function renderTimeline() {
  const host = $('tl-feed');
  if (!host) return;
  const all = buildTimeline();
  const rows = state.tlFilter === 'all' ? all : all.filter((i) => i.kind === state.tlFilter);

  const countEl = $('tl-count');
  if (countEl) {
    countEl.textContent = state.tlFilter === 'all'
      ? `${all.length} event${all.length === 1 ? '' : 's'}`
      : `${rows.length} of ${all.length}`;
  }

  if (!rows.length) {
    host.innerHTML = `<div class="tl-empty">${all.length
      ? 'Nothing of that kind yet.'
      : 'No history yet. Send a text, place a call, or leave a note to start the record.'}</div>`;
    return;
  }

  let lastDay = null;
  const html = [];
  rows.forEach((i, idx) => {
    const day = dayLabel(i.at);
    if (day !== lastDay) { html.push(`<div class="tl-day">${escapeHtml(day)}</div>`); lastDay = day; }
    const time = i.at ? new Date(i.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const cls = ['tl-item', `tl-item-${i.kind}`, i.dir ? `tl-${i.dir}` : ''].filter(Boolean).join(' ');
    html.push(`
      <div class="${cls}">
        <div class="tl-ico">${i.icon || KIND_ICON[i.kind] || '•'}</div>
        <div class="tl-main">
          ${i.title ? `<div class="tl-head"><span class="tl-title">${escapeHtml(i.title)}</span><span class="tl-time">${escapeHtml(time)}</span></div>` : ''}
          ${i.body ? `<div class="tl-body">${escapeHtml(i.body)}</div>` : ''}
          ${i.audio ? `<audio class="call-recording" controls preload="none" src="${escapeHtml(i.audio)}"></audio>` : ''}
          ${i.pending ? `<div class="tl-meta">Recording processing…</div>` : ''}
          <div class="tl-meta">${i.meta || ''}${!i.title ? (i.meta ? ' · ' : '') + escapeHtml(time) : ''}${
            i.delNote ? ` <button class="tl-del" data-del-note="${i.delNote}" title="Delete note">×</button>` : ''}</div>
        </div>
      </div>`);
  });
  host.innerHTML = html.join('');

  host.querySelectorAll('[data-del-note]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this note?')) return;
    try {
      await deleteNote(state.companyId, state.contactId, b.getAttribute('data-del-note'));
      await refreshTimeline();
    } catch (e) { alert('Could not delete: ' + (e.message || e)); }
  }));
}

// ────────────────────────────────────────────────────────────────
// The composer — text, note, or email, in place above the timeline
// ────────────────────────────────────────────────────────────────
function renderComposer() {
  const host = $('tl-compose-body');
  if (!host) return;
  const c = state.contact || {};
  document.querySelectorAll('[data-compose]').forEach((b) =>
    b.classList.toggle('active', b.getAttribute('data-compose') === state.composeTab));

  if (state.composeTab === 'sms') {
    const blocked = !c.phone ? 'Add a phone number to text this contact.'
      : (c.smsOptedOut === true ? 'This contact replied STOP. Texting is blocked.'
      : (c.smsConsent === false ? 'This contact declined SMS consent on the web form. Record consent above if they have since agreed.' : null));
    host.innerHTML = blocked
      ? `<div class="crm-subpanel-empty">${escapeHtml(blocked)}</div>`
      : `<div class="tl-compose-row">
           <textarea class="c-textarea" id="cp-sms" rows="2" placeholder="Text ${escapeHtml((c.name || '').split(' ')[0] || 'them')}…"></textarea>
           <button class="btn btn-primary" id="cp-sms-send">Send</button>
         </div>
         <div class="tl-compose-meta"><span id="cp-sms-tpl"></span><span class="spacer"></span><span id="cp-sms-count">0 / 160</span></div>
         <div id="cp-sms-err" class="auth-error" style="display:none;margin-top:8px;"></div>`;
    if (blocked) return;
    const box = $('cp-sms');
    const count = () => {
      const n = box.value.length;
      $('cp-sms-count').textContent = `${n} / ${Math.max(1, Math.ceil(n / 160)) * 160}`;
    };
    box.addEventListener('input', count);
    mountTemplatePicker({
      host: $('cp-sms-tpl'), input: box, channel: 'sms',
      companyId: state.companyId, context: mergeContext
    });
    const send = async () => {
      const text = box.value.trim();
      if (!text) return;
      const btn = $('cp-sms-send');
      btn.disabled = true; btn.textContent = 'Sending…';
      $('cp-sms-err').style.display = 'none';
      try {
        await sendSms(state.companyId, state.contactId, text);
        box.value = ''; count();
        await refreshTimeline();
      } catch (e) {
        $('cp-sms-err').textContent = e.message || String(e);
        $('cp-sms-err').style.display = 'block';
      } finally { btn.disabled = false; btn.textContent = 'Send'; }
    };
    $('cp-sms-send').addEventListener('click', send);
    // Enter sends, Shift+Enter makes a new line — what every messaging app does.
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    box.focus();
    return;
  }

  if (state.composeTab === 'note') {
    host.innerHTML = `
      <div class="tl-compose-row">
        <textarea class="c-textarea" id="cp-note" rows="2" placeholder="What happened? Deal context, objections, next step…"></textarea>
        <button class="btn btn-primary" id="cp-note-save">Add</button>
      </div>
      <div class="tl-compose-meta">
        <span>Log:</span>
        <button class="crm-chip" data-manual="manual_call">Call</button>
        <button class="crm-chip" data-manual="manual_meeting">Meeting</button>
        <button class="crm-chip" data-manual="manual_email">Email</button>
      </div>`;
    const box = $('cp-note');
    const save = async () => {
      const body = box.value.trim();
      if (!body) return;
      const btn = $('cp-note-save');
      btn.disabled = true;
      try {
        await addNote(state.companyId, state.contactId, body);
        box.value = '';
        await refreshTimeline();
      } catch (e) { alert('Could not add note: ' + (e.message || e)); }
      finally { btn.disabled = false; }
    };
    $('cp-note-save').addEventListener('click', save);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    });
    // Log a touch that happened outside the CRM, using whatever is typed
    // as the description rather than a second prompt.
    host.querySelectorAll('[data-manual]').forEach((b) => b.addEventListener('click', async () => {
      const type = b.getAttribute('data-manual');
      const label = { manual_call: 'call', manual_meeting: 'meeting', manual_email: 'email' }[type];
      const desc = box.value.trim() || prompt(`Log a ${label} — short description:`);
      if (!desc) return;
      try {
        await addManualActivity(state.companyId, state.contactId, { type, description: desc });
        box.value = '';
        await refreshTimeline();
      } catch (e) { alert('Could not log: ' + (e.message || e)); }
    }));
    box.focus();
    return;
  }

  // Email
  if (!c.email) {
    host.innerHTML = `<div class="crm-subpanel-empty">Add an email address to this contact first.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="crm-field"><input class="c-input" id="cp-em-subject" placeholder="Subject" /></div>
    <div class="tl-compose-row" style="margin-top:8px;">
      <textarea class="c-textarea" id="cp-em-body" rows="4" placeholder="Hi ${escapeHtml((c.name || '').split(' ')[0] || 'there')},"></textarea>
      <button class="btn btn-primary" id="cp-em-send">Send</button>
    </div>
    <div class="tl-compose-meta">
      <span id="cp-em-tpl"></span><span class="spacer"></span>
      <span>To ${escapeHtml(c.email)}</span>
    </div>
    <div id="cp-em-err" class="auth-error" style="display:none;margin-top:8px;"></div>
    <div id="cp-em-ok" class="auth-ok" style="display:none;margin-top:8px;"></div>`;
  mountTemplatePicker({
    host: $('cp-em-tpl'), input: $('cp-em-body'), channel: 'email', replace: true,
    companyId: state.companyId, context: mergeContext,
    onInsert: (tpl, rendered) => {
      if (rendered.subject && !$('cp-em-subject').value.trim()) $('cp-em-subject').value = rendered.subject;
    }
  });
  $('cp-em-send').addEventListener('click', async () => {
    const subject = $('cp-em-subject').value.trim();
    const bodyText = $('cp-em-body').value;
    if (!subject || !bodyText.trim()) {
      $('cp-em-err').textContent = 'Subject and body are both required.';
      $('cp-em-err').style.display = 'block';
      return;
    }
    const bodyHtml = bodyText.split('\n').map((l) => escapeHtml(l)).join('<br>');
    const btn = $('cp-em-send');
    btn.disabled = true; btn.textContent = 'Sending…';
    $('cp-em-err').style.display = 'none';
    try {
      const call = httpsCallable(functions, 'sendContactEmail');
      await call({
        companyId: state.companyId, contactId: state.contactId,
        subject, bodyHtml, bodyText
      });
      $('cp-em-subject').value = ''; $('cp-em-body').value = '';
      $('cp-em-ok').textContent = 'Email sent.';
      $('cp-em-ok').style.display = 'block';
      setTimeout(() => { const el = $('cp-em-ok'); if (el) el.style.display = 'none'; }, 3000);
      await refreshTimeline();
    } catch (e) {
      $('cp-em-err').textContent = e.message || String(e);
      $('cp-em-err').style.display = 'block';
    } finally { btn.disabled = false; btn.textContent = 'Send'; }
  });
  $('cp-em-subject').focus();
}

function setComposeTab(tab) {
  state.composeTab = tab;
  renderComposer();
}

// ────────────────────────────────────────────────────────────────
// Loading
// ────────────────────────────────────────────────────────────────
async function refreshContact() {
  state.contact = await getContact(state.companyId, state.contactId);
  if (!state.contact) { gate('Contact not found.'); return; }
  renderContactHeader();
  renderComposer();
}

/** Everything the timeline reads, in one round trip. */
async function refreshTimeline() {
  const [messages, calls, notes, activities] = await Promise.all([
    listMessages(state.companyId, state.contactId),
    listCalls(state.companyId, { contactId: state.contactId, max: 100 }),
    listNotes(state.companyId, state.contactId),
    listActivities(state.companyId, state.contactId)
  ]);
  state.messages = messages;
  state.calls = calls;
  state.notes = notes;
  state.activities = activities;
  renderTimeline();
}

async function refreshSide() {
  const [appts, tasks] = await Promise.all([
    listAppointments(state.companyId, { contactId: state.contactId }),
    listTasks(state.companyId, { contactId: state.contactId })
  ]);
  state.appts = appts;
  state.tasks = tasks;
  renderSideUpcoming();
}

async function refreshDeals() {
  state.deals = await listOpportunities(state.companyId, { contactId: state.contactId });
  renderSideDeals();
}

async function reloadAll() {
  await Promise.all([refreshContact(), refreshTimeline(), refreshSide(), refreshDeals()]);
}

// ────────────────────────────────────────────────────────────────
// Calling — the panel renders inside the profile card, so the record
// stays on screen and editable for the whole call.
// ────────────────────────────────────────────────────────────────
async function startCall() {
  let result = null;
  try {
    result = await dialer.callContact(state.contact);
  } catch (e) {
    const msg = e && e.message;
    if (msg && msg !== 'Cancelled.') alert(msg);
    return;
  }
  // Follow-ups the outcome implies, while the context is still fresh.
  if (result && result.followUp === 'appointment') openContactApptModal();
  if (result && result.followUp === 'task') openContactTaskModal();
  await reloadAll();
}

// ────────────────────────────────────────────────────────────────
// Modals
// ────────────────────────────────────────────────────────────────
function closeModal() { $('modal-root').innerHTML = ''; }

function modalShell(title, inner) {
  $('modal-root').innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">${title}${inner}</div>
    </div>`;
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') closeModal(); });
}

function openContactDealModal() {
  const c = state.contact || {};
  const stages = (state.pipeline && state.pipeline.stages) || [];
  modalShell('<h1>New <span>Deal</span></h1>', `
    <form id="cd-form" class="crm-form">
      <div class="crm-form-row"><label>Title *</label>
        <input class="c-input" id="cd-title" required value="${escapeHtml(c.name || '')} — " /></div>
      <div class="crm-form-row-grid">
        <div class="crm-form-row"><label>Value</label>
          <input class="c-input" id="cd-value" type="number" min="0" step="100" placeholder="2500" /></div>
        <div class="crm-form-row"><label>Stage</label>
          <select class="c-input crm-select" id="cd-stage">
            ${stages.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`).join('')}
          </select></div>
      </div>
      <div class="crm-form-row"><label>Expected close</label>
        <input class="c-input" id="cd-close" type="date" /></div>
      <div id="cd-err" class="auth-error" style="display:none;"></div>
      <div class="crm-modal-actions">
        <button type="button" class="btn btn-ghost" id="cd-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Create deal</button>
      </div>
    </form>`);
  $('cd-cancel').addEventListener('click', closeModal);
  $('cd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const close = $('cd-close').value;
      await createOpportunity(state.companyId, {
        title: $('cd-title').value,
        value: $('cd-value').value,
        pipelineId: state.pipeline && state.pipeline.id,
        stageId: $('cd-stage').value,
        expectedCloseAt: close ? new Date(close) : null,
        contactId: state.contactId,
        contactName: c.name || null,
        ownerUid: c.ownerUid || state.uid
      });
      closeModal();
      await Promise.all([refreshDeals(), refreshTimeline()]);
    } catch (err) {
      $('cd-err').textContent = err.message || String(err);
      $('cd-err').style.display = '';
    }
  });
}

function openContactTaskModal() {
  const c = state.contact || {};
  const soon = new Date(); soon.setDate(soon.getDate() + 1); soon.setMinutes(0, 0, 0);
  const localVal = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  modalShell('<h1>New <span>Task</span></h1>', `
    <form id="ctk-form" class="crm-form">
      <div class="crm-form-row"><label>Title *</label>
        <input class="c-input" id="ctk-title" required value="Follow up with ${escapeHtml((c.name || 'contact').split(' ')[0])}" /></div>
      <div class="crm-form-row-grid">
        <div class="crm-form-row"><label>Due</label>
          <input class="c-input" id="ctk-due" type="datetime-local" value="${localVal}" /></div>
        <div class="crm-form-row"><label>Priority</label>
          <select class="c-input crm-select" id="ctk-priority">
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select></div>
      </div>
      <div id="ctk-err" class="auth-error" style="display:none;"></div>
      <div class="crm-modal-actions">
        <button type="button" class="btn btn-ghost" id="ctk-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Create task</button>
      </div>
    </form>`);
  $('ctk-cancel').addEventListener('click', closeModal);
  $('ctk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const due = $('ctk-due').value;
      await createTask(state.companyId, {
        title: $('ctk-title').value,
        dueAt: due ? new Date(due) : null,
        priority: $('ctk-priority').value,
        contactId: state.contactId,
        contactName: c.name || null,
        assigneeUid: c.ownerUid || state.uid
      });
      closeModal();
      await Promise.all([refreshSide(), refreshTimeline()]);
    } catch (err) {
      $('ctk-err').textContent = err.message || String(err);
      $('ctk-err').style.display = '';
    }
  });
}

function openContactApptModal() {
  const c = state.contact || {};
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  const localVal = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  modalShell('<h1>New <span>Appointment</span></h1>', `
    <form id="ca-form" class="crm-form">
      <div class="crm-form-row"><label>Title *</label>
        <input class="c-input" id="ca-title" required value="Call with ${escapeHtml((c.name || 'contact').split(' ')[0])}" /></div>
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
    </form>`);
  $('ca-cancel').addEventListener('click', closeModal);
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
        contactId: state.contactId,
        contactName: c.name || null,
        inviteContact: !!($('ca-invite') && $('ca-invite').checked)
      });
      closeModal();
      await Promise.all([refreshSide(), refreshTimeline()]);
    } catch (err) {
      $('ca-err').textContent = err.message || String(err);
      $('ca-err').style.display = '';
    }
  });
}

async function openSequenceModal() {
  const c = state.contact || {};
  modalShell('', '<div class="crm-subpanel-empty">Loading…</div>');
  const [seqs, enrollments] = await Promise.all([
    listSequences(state.companyId),
    listEnrollments(state.companyId, { contactId: state.contactId })
  ]);
  const active = enrollments.filter((e) => e.status === 'active');
  const activeIds = new Set(active.map((e) => e.sequenceId));
  modalShell(`<h1>Sequences for <span>${escapeHtml((c.name || 'contact').split(' ')[0])}</span></h1>`, `
    ${active.length ? `
      <label class="crm-field-label" style="display:block;margin-bottom:6px;">Running now</label>
      ${active.map((e) => `
        <div class="crm-mini-row">
          <div class="crm-mini-main">
            <div class="crm-mini-title">${escapeHtml(e.sequenceName || e.sequenceId)}</div>
            <div class="crm-mini-sub">Step ${(Number(e.currentStep) || 0) + 1} · next ${fmtDateTime(e.nextRunAt)}</div>
          </div>
          <button class="crm-chip" data-seq-stop="${escapeHtml(e.id)}" data-seq-name="${escapeHtml(e.sequenceName || '')}">Stop</button>
        </div>`).join('')}` : ''}
    <label class="crm-field-label" style="display:block;margin:14px 0 6px;">Enroll in</label>
    ${seqs.filter((s) => s.active !== false && !activeIds.has(s.id)).map((s) => `
      <div class="crm-mini-row">
        <div class="crm-mini-main">
          <div class="crm-mini-title">${escapeHtml(s.name)}</div>
          <div class="crm-mini-sub">${(s.steps || []).length} step${(s.steps || []).length === 1 ? '' : 's'}</div>
        </div>
        <button class="crm-chip" data-seq-enroll="${escapeHtml(s.id)}">Enroll</button>
      </div>`).join('') || '<div class="crm-subpanel-empty">No other active sequences. <a href="/sequences.html" style="color:var(--red);">Build one</a>.</div>'}
    <div id="seqm-err" class="auth-error" style="display:none;margin-top:8px;"></div>
    <div class="crm-modal-actions"><button type="button" class="btn btn-ghost" id="seqm-close">Close</button></div>`);
  $('seqm-close').addEventListener('click', closeModal);
  const root = $('modal-root');
  root.querySelectorAll('[data-seq-enroll]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await enrollContact(state.companyId, b.getAttribute('data-seq-enroll'), state.contact);
      await refreshTimeline();
      openSequenceModal();
    } catch (e) { $('seqm-err').textContent = e.message || String(e); $('seqm-err').style.display = ''; b.disabled = false; }
  }));
  root.querySelectorAll('[data-seq-stop]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await stopEnrollment(state.companyId, b.getAttribute('data-seq-stop'), {
        reason: 'manual', contactId: state.contactId, sequenceName: b.getAttribute('data-seq-name')
      });
      await refreshTimeline();
      openSequenceModal();
    } catch (e) { $('seqm-err').textContent = e.message || String(e); $('seqm-err').style.display = ''; b.disabled = false; }
  }));
}

// ────────────────────────────────────────────────────────────────
function wire() {
  // Actions
  $('btn-call-contact').addEventListener('click', startCall);
  $('btn-text-contact').addEventListener('click', () => {
    setComposeTab('sms');
    const el = $('tl-compose');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('btn-send-email').addEventListener('click', () => setComposeTab('email'));
  $('btn-schedule-contact').addEventListener('click', openContactApptModal);
  $('btn-add-task').addEventListener('click', openContactTaskModal);
  $('btn-sequence-contact').addEventListener('click', openSequenceModal);
  $('btn-add-appt').addEventListener('click', openContactApptModal);
  $('btn-add-deal').addEventListener('click', openContactDealModal);

  // Composer tabs + timeline filters
  document.querySelectorAll('[data-compose]').forEach((b) =>
    b.addEventListener('click', () => setComposeTab(b.getAttribute('data-compose'))));
  document.querySelectorAll('[data-tl]').forEach((b) => b.addEventListener('click', () => {
    state.tlFilter = b.getAttribute('data-tl');
    document.querySelectorAll('[data-tl]').forEach((x) => x.classList.toggle('active', x === b));
    renderTimeline();
  }));

  // Stage and owner save immediately — they are single-click decisions and
  // stage moves are what the pipeline reads.
  $('ct-stage').addEventListener('change', async (e) => {
    const to = e.target.value;
    const from = state.contact.stage;
    if (to === from) return;
    try {
      await changeStage(state.companyId, state.contactId, from, to);
      await Promise.all([refreshContact(), refreshTimeline()]);
      setStatus('Stage updated', 'ok');
    } catch (err) { e.target.value = from; setStatus('Error: ' + (err.message || err), 'err'); }
  });
  $('ct-owner').addEventListener('change', async (e) => {
    try {
      await updateContact(state.companyId, state.contactId, { ownerUid: e.target.value });
      await refreshContact();
      setStatus('Owner updated', 'ok');
    } catch (err) { setStatus('Error: ' + (err.message || err), 'err'); }
  });

  $('btn-save-contact').addEventListener('click', async () => {
    try {
      await updateContact(state.companyId, state.contactId, {
        name: $('ct-name').value.trim() || 'Unnamed contact',
        email: $('ct-email').value.trim() || null,
        phone: $('ct-phone').value.trim() || null,
        companyName: $('ct-company').value.trim() || null,
        source: $('ct-source').value
      });
      await refreshContact();
      setStatus('Saved', 'ok');
    } catch (err) { setStatus('Error: ' + (err.message || err), 'err'); }
  });

  $('ct-add-tag-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('ct-add-tag').value.trim();
    if (!v) return;
    try {
      await addTag(state.companyId, state.contactId, v);
      $('ct-add-tag').value = '';
      await Promise.all([refreshContact(), refreshTimeline()]);
    } catch (err) { alert('Could not add tag: ' + (err.message || err)); }
  });

  // Consent saves immediately: a half-saved do-not-call is worse than none.
  $('ct-dnc').addEventListener('change', async (e) => {
    const on = e.target.checked;
    try {
      await setDoNotCall(state.companyId, state.contactId, on);
      await Promise.all([refreshContact(), refreshTimeline()]);
      setStatus(on ? 'Added to do-not-call' : 'Removed from do-not-call', 'ok');
    } catch (err) {
      e.target.checked = !on;
      setStatus('Could not save: ' + (err.message || err), 'err');
    }
  });

  $('btn-record-consent').addEventListener('click', async () => {
    const note = prompt('How was consent given? This note becomes the record.\n\nExample: "Asked to be texted appointment reminders, on our call today."');
    if (note == null) return;
    if (!note.trim()) { setStatus('A note is required to record consent.', 'err'); return; }
    try {
      await recordSmsConsent(state.companyId, state.contactId, note.trim());
      await Promise.all([refreshContact(), refreshTimeline()]);
      renderComposer();
      setStatus('SMS consent recorded', 'ok');
    } catch (err) {
      setStatus('Could not record consent: ' + (err.message || err), 'err');
    }
  });

  $('btn-delete-contact').addEventListener('click', async () => {
    if (!confirm(`Delete ${state.contact.name}? This also removes all notes and history.`)) return;
    try {
      await deleteContact(state.companyId, state.contactId);
      location.replace('/crm.html');
    } catch (err) { alert('Could not delete: ' + (err.message || err)); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('modal-root').innerHTML) closeModal();
  });
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
  if (!info.isAdmin) { location.replace('/index.html'); return; }

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

  // The call panel lives inside the profile card, not in a fixed bottom bar.
  try {
    await dialer.configure({ companyId, uid: u.uid, dockHost: 'ct-call-panel' });
  } catch (e) { console.warn('[contact] dialer configure failed', e); }
  onDialerEvent('disposition', () => { refreshTimeline().catch(() => {}); });

  // Deep link: /contact.html?id=…&compose=sms opens straight into that composer.
  const wanted = new URLSearchParams(location.search).get('compose');
  if (['sms', 'note', 'email'].includes(wanted)) state.composeTab = wanted;

  $('panel').style.display = 'block';
  renderContactHeader();
  renderComposer();
  wire();

  await Promise.all([refreshTimeline(), refreshSide()]);

  // The pipeline is only needed for deal labels, so it loads last.
  try {
    state.pipeline = await ensureDefaultPipeline(companyId);
    await refreshDeals();
  } catch (e) { console.warn('[contact] pipeline load failed', e); }
}

main();
