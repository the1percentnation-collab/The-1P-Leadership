// Dialer — a work queue, not a list. Pick a filter, hit Start, and the page
// walks one lead at a time: dial, log the outcome, auto-advance. The whole
// point is that a rep never has to decide what to do next, so the queue is
// built once up front and the disposition is the only required input.
//
// Ordering is coldest-first (oldest lastActivityAt), because the leads that
// have been sitting untouched are the ones the pipeline is losing.

import { firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderCrmShell } from './crm-shell.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import {
  STAGES, STAGE_IDS, stageMeta,
  listContacts, listCompanyAdmins, listNotes, addNote, listMessages, sendSms,
  listCalls, createTask, createAppointment, getContact,
  dispositionMeta, callBlockReason,
  escapeHtml, fmtDate, fmtDateTime
} from './crm.js';
import { dialer, onDialerEvent } from './dialer-core.js';

const $ = (id) => document.getElementById(id);

const state = {
  uid: null,
  companyId: null,
  contacts: [],
  admins: [],
  queue: [],          // contact ids, in dial order
  index: 0,
  running: false,
  autoAdvanceId: null,
  filters: { stages: [], ownerUid: null, tag: null, untouchedOnly: false },
  notes: [],
  calls: [],
  messages: [],
  session: { dialed: 0, connected: 0, booked: 0, talkSec: 0 }
};

// ────────────────────────────────────────────────────────────────
// Queue construction
// ────────────────────────────────────────────────────────────────

function eligible(c) {
  // A queue entry has to be callable, or the rep is just pressing skip.
  return !callBlockReason(c);
}

function buildQueue() {
  const f = state.filters;
  let rows = state.contacts.filter(eligible);
  if (f.stages.length) rows = rows.filter((c) => f.stages.includes(c.stage));
  if (f.ownerUid) rows = rows.filter((c) => c.ownerUid === f.ownerUid);
  if (f.tag) rows = rows.filter((c) => (c.tags || []).includes(f.tag));
  if (f.untouchedOnly) {
    // "Never contacted" in the sense that matters: still in the new stage and
    // nothing has happened since it was created.
    rows = rows.filter((c) => c.stage === 'new');
  }
  rows.sort((a, b) => {
    const ta = a.lastActivityAt && a.lastActivityAt.toMillis ? a.lastActivityAt.toMillis() : 0;
    const tb = b.lastActivityAt && b.lastActivityAt.toMillis ? b.lastActivityAt.toMillis() : 0;
    return ta - tb; // coldest first
  });
  state.queue = rows.map((c) => c.id);
  state.index = 0;
}

function currentContact() {
  const id = state.queue[state.index];
  return id ? state.contacts.find((c) => c.id === id) : null;
}

function allTags() {
  const set = new Set();
  state.contacts.forEach((c) => (c.tags || []).forEach((t) => set.add(t)));
  return Array.from(set).sort();
}

// ────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────

function shellHtml() {
  return `
    <div class="crm-widgets" id="dial-stats"></div>

    <div class="card dial-setup" id="dial-setup">
      <div class="crm-section-sub" style="margin-top:0;">
        Build a queue, then work it top to bottom. Space ends a call, number keys log the outcome.
      </div>
      <div class="crm-field" style="margin-bottom:12px;">
        <label class="crm-field-label">Stages</label>
        <div class="crm-chip-row" id="dial-stage-chips"></div>
      </div>
      <div class="crm-form-row-grid">
        <div class="crm-field">
          <label>Owner</label>
          <select class="c-input crm-select" id="dial-owner"></select>
        </div>
        <div class="crm-field">
          <label>Tag</label>
          <select class="c-input crm-select" id="dial-tag"></select>
        </div>
      </div>
      <label class="crm-consent-check" style="margin-top:12px;">
        <input type="checkbox" id="dial-untouched" /> Only leads still in New
      </label>
      <div class="crm-save-row" style="margin-top:18px;">
        <span class="crm-save-status" id="dial-count"></span>
        <button class="btn btn-primary" id="dial-start">Start dialing</button>
      </div>
    </div>

    <div class="dial-wrap" id="dial-wrap" hidden>
      <aside class="dial-queue" id="dial-queue"></aside>
      <section class="dial-main" id="dial-main"></section>
      <aside class="dial-side" id="dial-side"></aside>
    </div>`;
}

function renderStats() {
  const s = state.session;
  const rate = s.dialed ? Math.round((s.connected / s.dialed) * 100) : 0;
  const mins = Math.floor(s.talkSec / 60);
  const widget = (label, value, sub, accent) => `
    <div class="crm-widget ${accent ? 'crm-widget-accent' : ''}">
      <div class="crm-widget-label">${label}</div>
      <div class="crm-widget-value">${value}</div>
      ${sub ? `<div class="crm-widget-sub">${sub}</div>` : ''}
    </div>`;
  $('dial-stats').innerHTML = [
    widget('Dialed', s.dialed, 'this session'),
    widget('Connected', s.connected, `${rate}% contact rate`, true),
    widget('Booked', s.booked, 'appointments'),
    widget('Talk time', `${mins}m`, `${s.talkSec % 60}s`),
    widget('Remaining', Math.max(0, state.queue.length - state.index), 'in queue')
  ].join('');
}

function renderSetup() {
  $('dial-stage-chips').innerHTML = STAGES.map((s) => `
    <button class="crm-chip ${state.filters.stages.includes(s.id) ? 'active' : ''}" data-stage-chip="${s.id}">
      ${escapeHtml(s.label)}
    </button>`).join('');
  $('dial-stage-chips').querySelectorAll('[data-stage-chip]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-stage-chip');
      const i = state.filters.stages.indexOf(id);
      if (i === -1) state.filters.stages.push(id); else state.filters.stages.splice(i, 1);
      renderSetup();
    });
  });

  $('dial-owner').innerHTML = ['<option value="">Anyone</option>']
    .concat(state.admins.map((a) =>
      `<option value="${a.uid}" ${state.filters.ownerUid === a.uid ? 'selected' : ''}>${escapeHtml(a.displayName || a.email || a.uid)}</option>`))
    .join('');
  $('dial-tag').innerHTML = ['<option value="">Any tag</option>']
    .concat(allTags().map((t) =>
      `<option value="${escapeHtml(t)}" ${state.filters.tag === t ? 'selected' : ''}>#${escapeHtml(t)}</option>`))
    .join('');
  $('dial-untouched').checked = state.filters.untouchedOnly;

  buildQueue();
  const n = state.queue.length;
  $('dial-count').textContent = n
    ? `${n} callable lead${n === 1 ? '' : 's'} match`
    : 'No callable leads match — every match is missing a phone number or is on do-not-call.';
  $('dial-start').disabled = !n;
}

function renderQueue() {
  const host = $('dial-queue');
  const upcoming = state.queue.slice(state.index, state.index + 25);
  host.innerHTML = `
    <div class="dial-queue-head">
      Queue <span>${state.index + 1} / ${state.queue.length}</span>
    </div>
    ${upcoming.map((id, i) => {
      const c = state.contacts.find((x) => x.id === id);
      if (!c) return '';
      const meta = stageMeta(c.stage);
      return `
        <button class="dial-queue-item ${i === 0 ? 'active' : ''}" data-jump="${state.index + i}">
          <span class="crm-dot" style="background:${meta.color}"></span>
          <span class="dial-queue-name">${escapeHtml(c.name || 'Unnamed')}</span>
          <span class="dial-queue-sub">${escapeHtml(c.phone || '')}</span>
        </button>`;
    }).join('')}
    ${state.queue.length > state.index + 25 ? `<div class="crm-mini-sub" style="padding:10px 14px;">+${state.queue.length - state.index - 25} more</div>` : ''}`;
  host.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
    state.index = Number(b.getAttribute('data-jump'));
    loadCurrent();
  }));
}

function renderMain() {
  const c = currentContact();
  const host = $('dial-main');
  if (!c) {
    host.innerHTML = `
      <div class="card" style="text-align:center;">
        <h2 style="font-family:var(--font-display);font-size:30px;">Queue complete</h2>
        <div class="crm-section-sub">
          ${state.session.dialed} dialed · ${state.session.connected} connected · ${state.session.booked} booked.
        </div>
        <button class="btn btn-primary" id="dial-restart" style="margin-top:14px;">Build another queue</button>
      </div>`;
    const b = $('dial-restart');
    if (b) b.addEventListener('click', stopDialing);
    return;
  }
  const meta = stageMeta(c.stage);
  const owner = state.admins.find((a) => a.uid === c.ownerUid);
  host.innerHTML = `
    <div class="card dial-lead">
      <div class="dial-lead-head">
        <div>
          <a class="dial-lead-name" href="/contact.html?id=${encodeURIComponent(c.id)}">${escapeHtml(c.name || 'Unnamed')}</a>
          <div class="crm-mini-sub">
            ${escapeHtml(c.phone || 'no phone')}
            ${c.companyName ? ' · ' + escapeHtml(c.companyName) : ''}
            ${owner ? ' · ' + escapeHtml(owner.displayName || owner.email || '') : ''}
          </div>
        </div>
        <span class="crm-stage-badge" style="--stage-color:${meta.color}">${escapeHtml(meta.label)}</span>
      </div>
      ${(c.tags || []).length ? `<div class="crm-card-tags">${(c.tags || []).map((t) => `<span class="crm-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="crm-mini-sub" style="margin-top:8px;">Last activity ${fmtDate(c.lastActivityAt)}</div>

      <div class="dial-lead-actions">
        <button class="btn btn-primary" id="dial-call">&#9742; Call now</button>
        <button class="btn btn-ghost" id="dial-skip">Skip &rarr;</button>
      </div>
    </div>

    <div class="card">
      <label class="crm-field-label">Notes</label>
      <div id="dial-notes" class="dial-notes"></div>
      <div class="crm-note-compose" style="margin-top:10px;">
        <textarea id="dial-note-body" class="c-textarea" rows="2" placeholder="What did they say?"></textarea>
        <div class="crm-note-compose-actions">
          <button class="btn btn-ghost" id="dial-add-note">Add note</button>
        </div>
      </div>
    </div>

    <div class="card">
      <label class="crm-field-label">Recent calls</label>
      <div id="dial-calls"></div>
    </div>`;

  $('dial-call').disabled = !!callBlockReason(c);
  $('dial-call').addEventListener('click', dialCurrent);
  $('dial-skip').addEventListener('click', () => advance(true));
  $('dial-add-note').addEventListener('click', async () => {
    const body = $('dial-note-body').value.trim();
    if (!body) return;
    try {
      await addNote(state.companyId, c.id, body);
      $('dial-note-body').value = '';
      await loadPanels(c.id);
    } catch (e) { alert('Could not add note: ' + (e.message || e)); }
  });
}

function renderNotes() {
  const host = $('dial-notes');
  if (!host) return;
  if (!state.notes.length) {
    host.innerHTML = `<div class="crm-subpanel-empty">No notes yet.</div>`;
    return;
  }
  host.innerHTML = state.notes.slice(0, 4).map((n) => `
    <div class="crm-mini-row">
      <div class="crm-mini-main">
        <div class="crm-mini-sub">${escapeHtml(n.authorName || '')} · ${fmtDateTime(n.createdAt)}</div>
        <div>${escapeHtml(n.body || '')}</div>
      </div>
    </div>`).join('');
}

function renderCallHistory() {
  const host = $('dial-calls');
  if (!host) return;
  if (!state.calls.length) {
    host.innerHTML = `<div class="crm-subpanel-empty">No calls logged yet.</div>`;
    return;
  }
  host.innerHTML = state.calls.slice(0, 5).map((cl) => {
    const m = dispositionMeta(cl.disposition);
    return `<div class="crm-mini-row"><div class="crm-mini-main">
      <div class="crm-mini-title">${m ? escapeHtml(m.label) : escapeHtml(cl.status || 'Call')}</div>
      <div class="crm-mini-sub">${fmtDateTime(cl.createdAt)}${cl.dispositionNote ? ' · ' + escapeHtml(cl.dispositionNote) : ''}</div>
    </div></div>`;
  }).join('');
}

function renderSide() {
  const c = currentContact();
  const host = $('dial-side');
  if (!c) { host.innerHTML = ''; return; }
  const smsBlocked = !c.phone
    ? 'No phone number on this contact.'
    : (c.smsOptedOut === true ? 'This contact replied STOP — texting is blocked.' : null);
  host.innerHTML = `
    <div class="dial-side-head">Text ${escapeHtml((c.name || '').split(' ')[0] || 'lead')}</div>
    <div class="sms-messages" id="dial-messages">
      ${state.messages.length ? state.messages.map((m) => `
        <div class="sms-bubble sms-${m.direction === 'out' ? 'out' : 'in'}">
          <div class="sms-bubble-body">${escapeHtml(m.body || '')}</div>
          <div class="sms-bubble-meta">${fmtDateTime(m.createdAt)}</div>
        </div>`).join('') : '<div class="crm-subpanel-empty" style="margin:auto;">No texts yet.</div>'}
    </div>
    ${smsBlocked
      ? `<div class="crm-subpanel-empty">${escapeHtml(smsBlocked)}</div>`
      : `<form class="sms-composer" id="dial-sms-form">
           <input class="c-input" id="dial-sms-input" placeholder="Send a text…" autocomplete="off" />
           <button class="btn btn-primary" type="submit">Send</button>
         </form>`}
    <div id="dial-sms-err" class="auth-error" style="display:none;margin-top:8px;"></div>`;

  const form = $('dial-sms-form');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('dial-sms-input');
    const text = input.value.trim();
    if (!text) return;
    try {
      await sendSms(state.companyId, c.id, text);
      input.value = '';
      state.messages = await listMessages(state.companyId, c.id);
      renderSide();
    } catch (err) {
      $('dial-sms-err').textContent = err.message || String(err);
      $('dial-sms-err').style.display = 'block';
    }
  });
  const msgs = $('dial-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// ────────────────────────────────────────────────────────────────
// Flow
// ────────────────────────────────────────────────────────────────

async function loadPanels(contactId) {
  const [notes, calls, messages] = await Promise.all([
    listNotes(state.companyId, contactId),
    listCalls(state.companyId, { contactId, max: 10 }),
    listMessages(state.companyId, contactId)
  ]);
  state.notes = notes;
  state.calls = calls;
  state.messages = messages;
  renderNotes();
  renderCallHistory();
  renderSide();
}

function loadCurrent() {
  cancelAutoAdvance();
  renderQueue();
  renderMain();
  renderStats();
  const c = currentContact();
  if (c) loadPanels(c.id).catch((e) => console.warn('[dialer] panel load failed', e));
  else $('dial-side').innerHTML = '';
}

async function dialCurrent() {
  const c = currentContact();
  if (!c) return;
  let result = null;
  try {
    result = await dialer.callContact(c);
  } catch (e) {
    const msg = e && e.message;
    if (msg && msg !== 'Cancelled.') alert(msg);
    return;
  }

  state.session.dialed += 1;
  state.session.talkSec += result.durationSec || 0;
  if (['connected', 'booked', 'callback'].includes(result.disposition)) state.session.connected += 1;
  if (result.disposition === 'booked') state.session.booked += 1;

  // Refresh the contact so the queue reflects any stage move the disposition made.
  try {
    const fresh = await getContact(state.companyId, c.id);
    if (fresh) Object.assign(c, fresh);
  } catch (e) {}

  if (result.followUp === 'appointment') { openApptModal(c); return; }
  if (result.followUp === 'task') { openTaskModal(c); return; }
  scheduleAdvance();
}

function scheduleAdvance() {
  const secs = 3;
  renderStats();
  let left = secs;
  const main = $('dial-main');
  const banner = document.createElement('div');
  banner.className = 'dial-advance';
  banner.innerHTML = `Next lead in <strong>${left}</strong>s <button class="btn btn-ghost" id="dial-hold">Stay here</button>`;
  if (main) main.prepend(banner);
  const tick = () => {
    left -= 1;
    const strong = banner.querySelector('strong');
    if (strong) strong.textContent = String(left);
    if (left <= 0) { cancelAutoAdvance(); advance(); }
  };
  state.autoAdvanceId = setInterval(tick, 1000);
  const hold = $('dial-hold');
  if (hold) hold.addEventListener('click', () => { cancelAutoAdvance(); banner.remove(); });
}

function cancelAutoAdvance() {
  if (state.autoAdvanceId) clearInterval(state.autoAdvanceId);
  state.autoAdvanceId = null;
  document.querySelectorAll('.dial-advance').forEach((el) => el.remove());
}

function advance() {
  cancelAutoAdvance();
  state.index += 1;
  loadCurrent();
}

function startDialing() {
  buildQueue();
  if (!state.queue.length) return;
  state.running = true;
  state.session = { dialed: 0, connected: 0, booked: 0, talkSec: 0 };
  $('dial-setup').hidden = true;
  $('dial-wrap').hidden = false;
  loadCurrent();
}

function stopDialing() {
  state.running = false;
  cancelAutoAdvance();
  $('dial-setup').hidden = false;
  $('dial-wrap').hidden = true;
  renderSetup();
  renderStats();
}

// ────────────────────────────────────────────────────────────────
// Follow-up modals — reuse the same shapes as the contact page so a booking
// made from the dialer is indistinguishable from one made anywhere else.
// ────────────────────────────────────────────────────────────────

function openApptModal(contact) {
  const root = $('modal-root');
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 24);
  const localVal = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">
        <h1>Book <span>${escapeHtml((contact.name || 'lead').split(' ')[0])}</span></h1>
        <form id="da-form" class="crm-form">
          <div class="crm-form-row"><label>Title *</label>
            <input class="c-input" id="da-title" required value="Call with ${escapeHtml((contact.name || 'lead').split(' ')[0])}" /></div>
          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Start *</label>
              <input class="c-input" id="da-start" type="datetime-local" required value="${localVal}" /></div>
            <div class="crm-form-row"><label>Duration (min)</label>
              <input class="c-input" id="da-dur" type="number" min="5" step="5" value="30" /></div>
          </div>
          <div class="crm-form-row"><label>Location / link</label>
            <input class="c-input" id="da-loc" placeholder="Zoom, address, or phone" /></div>
          <div id="da-err" class="auth-error" style="display:none;"></div>
          <div class="crm-modal-actions">
            <button type="button" class="btn btn-ghost" id="da-skip">Skip</button>
            <button type="submit" class="btn btn-primary">Book &amp; next</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  $('da-skip').addEventListener('click', () => { close(); advance(); });
  $('da-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const startStr = $('da-start').value;
      await createAppointment(state.companyId, {
        title: $('da-title').value,
        startAt: startStr ? new Date(startStr) : null,
        durationMin: $('da-dur').value,
        location: $('da-loc').value || null,
        contactId: contact.id,
        contactName: contact.name || null,
        ownerUid: contact.ownerUid || state.uid
      });
      close();
      advance();
    } catch (err) {
      $('da-err').textContent = err.message || String(err);
      $('da-err').style.display = '';
    }
  });
}

function openTaskModal(contact) {
  const root = $('modal-root');
  const soon = new Date(); soon.setDate(soon.getDate() + 1); soon.setMinutes(0, 0, 0);
  const localVal = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">
        <h1>Callback <span>reminder</span></h1>
        <form id="dt-form" class="crm-form">
          <div class="crm-form-row"><label>Title *</label>
            <input class="c-input" id="dt-title" required value="Call ${escapeHtml(contact.name || 'lead')} back" /></div>
          <div class="crm-form-row"><label>Due *</label>
            <input class="c-input" id="dt-due" type="datetime-local" required value="${localVal}" /></div>
          <div id="dt-err" class="auth-error" style="display:none;"></div>
          <div class="crm-modal-actions">
            <button type="button" class="btn btn-ghost" id="dt-skip">Skip</button>
            <button type="submit" class="btn btn-primary">Save &amp; next</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  $('dt-skip').addEventListener('click', () => { close(); advance(); });
  $('dt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const due = $('dt-due').value;
      await createTask(state.companyId, {
        title: $('dt-title').value,
        dueAt: due ? new Date(due) : null,
        contactId: contact.id,
        contactName: contact.name || null,
        assigneeUid: state.uid
      });
      close();
      advance();
    } catch (err) {
      $('dt-err').textContent = err.message || String(err);
      $('dt-err').style.display = '';
    }
  });
}

// ────────────────────────────────────────────────────────────────

async function main() {
  if (!firebaseReady) return;
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/dialer.html')); return; }
  const info = await getRoleInfo(true);
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  state.uid = u.uid;

  const content = renderCrmShell({ active: 'dialer', title: 'Dialer', user: u, role: info.role });
  const params = new URLSearchParams(location.search);
  let companyId = params.get('companyId') || info.companyId || null;
  if (!companyId) {
    try {
      const resolved = await resolveCrmCompany(u.uid);
      if (resolved.companyId) companyId = resolved.companyId;
    } catch (e) {}
  }
  if (companyId) mountCrmCompanySwitcher(u.uid, companyId);
  if (!companyId) {
    content.innerHTML = `<div class="card"><div class="auth-error">You are not an admin of any company yet. Use /owner.html.</div></div>`;
    return;
  }
  state.companyId = companyId;
  content.innerHTML = `<div class="crm-section-sub">Loading leads…</div>`;

  [state.contacts, state.admins] = await Promise.all([
    listContacts(companyId), listCompanyAdmins(companyId)
  ]);

  // Hotkeys on: this is the one page where they are unambiguous.
  await dialer.configure({ companyId, uid: u.uid, hotkeys: true });
  dialer.prewarm();

  content.innerHTML = shellHtml();

  // Carry filters over from the contacts page, so "dial this view" works.
  const stage = params.get('stage');
  if (stage && STAGE_IDS.includes(stage)) state.filters.stages = [stage];
  const tag = params.get('tag');
  if (tag) state.filters.tag = tag;

  renderSetup();
  renderStats();

  $('dial-start').addEventListener('click', startDialing);
  $('dial-owner').addEventListener('change', (e) => { state.filters.ownerUid = e.target.value || null; renderSetup(); });
  $('dial-tag').addEventListener('change', (e) => { state.filters.tag = e.target.value || null; renderSetup(); });
  $('dial-untouched').addEventListener('change', (e) => { state.filters.untouchedOnly = e.target.checked; renderSetup(); });

  // Skip hotkey lives here rather than in the dock: it is a queue concept.
  document.addEventListener('keydown', (e) => {
    if (!state.running) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 's') { e.preventDefault(); advance(); }
    if (e.key === 'n') {
      const box = $('dial-note-body');
      if (box) { e.preventDefault(); box.focus(); }
    }
    if (e.key === ' ' && dialer.status === 'idle') {
      e.preventDefault();
      dialCurrent();
    }
  });

  onDialerEvent('statechange', () => renderStats());
}

main();
