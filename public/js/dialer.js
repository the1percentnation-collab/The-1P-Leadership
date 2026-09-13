// Power dialer — build a call queue from the CRM, work it one contact at a
// time, and log the outcome without leaving the keyboard.
//
// Layout: queue on the left, the live call card in the middle, disposition +
// notes on the right. The call card drives the Twilio softphone (voice.js);
// every outcome goes through logCallOutcome, which writes the activity, the
// note, the do-not-call flag and any follow-up task in one round trip.
//
// Keyboard: C call/hang up, M mute, N next, 1-9 pick an outcome.

import { firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderCrmShell } from './crm-shell.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import { softphone, formatPhone, toE164 } from './voice.js';
import {
  listContacts, STAGES, stageMeta, escapeHtml, fmtDateTime,
  CALL_OUTCOMES, logCallOutcome, createDialerSession, recordDialAttempt,
  endDialerSession, listCalls
} from './crm.js';

const $ = (id) => document.getElementById(id);

const state = {
  uid: null,
  companyId: null,
  allContacts: [],
  queue: [],
  index: 0,
  sessionId: null,
  status: 'idle',
  callSid: null,
  lastDurationSec: 0,
  deviceReady: false,
  deviceError: null,
  filter: { stage: '', search: '', skipCalledToday: true },
  stats: { placed: 0, logged: 0 },
  timer: null,
  history: []
};

const current = () => state.queue[state.index] || null;

// ────────────────────────────────────────────────────────────────
// Queue construction
// ────────────────────────────────────────────────────────────────
function isDialable(c) {
  return !!toE164(c.phone) && c.doNotCall !== true;
}

function calledToday(c) {
  const t = c.lastCalledAt && c.lastCalledAt.toMillis ? c.lastCalledAt.toMillis() : 0;
  if (!t) return false;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return t >= start.getTime();
}

function buildQueue() {
  const term = state.filter.search.trim().toLowerCase();
  state.queue = state.allContacts.filter((c) => {
    if (!isDialable(c)) return false;
    if (state.filter.stage && c.stage !== state.filter.stage) return false;
    if (state.filter.skipCalledToday && calledToday(c)) return false;
    if (term) {
      const hay = `${c.name || ''} ${c.companyName || ''} ${c.phone || ''} ${c.email || ''}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
  // Coldest first: contacts nobody has touched in a while rise to the top.
  state.queue.sort((a, b) => {
    const ta = a.lastActivityAt && a.lastActivityAt.toMillis ? a.lastActivityAt.toMillis() : 0;
    const tb = b.lastActivityAt && b.lastActivityAt.toMillis ? b.lastActivityAt.toMillis() : 0;
    return ta - tb;
  });
  if (state.index >= state.queue.length) state.index = 0;
}

function filterLabel() {
  const bits = [];
  if (state.filter.stage) bits.push(stageMeta(state.filter.stage).label);
  if (state.filter.search) bits.push(`"${state.filter.search}"`);
  return bits.length ? bits.join(' · ') : 'All dialable contacts';
}

// ────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────
function layout() {
  $('crm-content').innerHTML = `
    <div class="dialer-bar">
      <div class="dialer-filters">
        <select class="c-input dialer-select" id="dl-stage">
          <option value="">All stages</option>
          ${STAGES.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}
        </select>
        <input class="c-input dialer-search" id="dl-search" placeholder="Search name, company, phone…" autocomplete="off" />
        <label class="dialer-check">
          <input type="checkbox" id="dl-skip" checked /> Skip already called today
        </label>
      </div>
      <div class="dialer-status" id="dl-device"></div>
    </div>

    <div class="dialer-wrap">
      <aside class="dialer-queue">
        <div class="dialer-queue-head">
          <span id="dl-queue-count">Queue</span>
          <span class="dialer-stats" id="dl-stats"></span>
        </div>
        <div class="dialer-queue-list" id="dl-queue"></div>
      </aside>

      <section class="dialer-stage" id="dl-stage-pane"></section>

      <aside class="dialer-side">
        <div class="dialer-side-head">Log this call</div>
        <div class="dialer-side-body" id="dl-log"></div>
      </aside>
    </div>

    <div class="dialer-hint">
      Shortcuts: <kbd>C</kbd> call / hang up · <kbd>M</kbd> mute · <kbd>N</kbd> next · <kbd>1</kbd>–<kbd>9</kbd> outcome
    </div>`;

  $('dl-stage').addEventListener('change', (e) => { state.filter.stage = e.target.value; buildQueue(); renderQueue(); renderStage(); renderLog(); });
  $('dl-search').addEventListener('input', (e) => { state.filter.search = e.target.value; buildQueue(); renderQueue(); renderStage(); renderLog(); });
  $('dl-skip').addEventListener('change', (e) => { state.filter.skipCalledToday = e.target.checked; buildQueue(); renderQueue(); renderStage(); renderLog(); });
}

function renderDeviceStatus() {
  const host = $('dl-device');
  if (!host) return;
  if (state.deviceError) {
    host.innerHTML = `<span class="dialer-dot bad"></span><span>${escapeHtml(state.deviceError)}</span>`;
    return;
  }
  host.innerHTML = state.deviceReady
    ? `<span class="dialer-dot good"></span><span>Softphone ready${softphone.callerId ? ' · ' + escapeHtml(formatPhone(softphone.callerId)) : ''}${softphone.recording ? ' · recording on' : ''}</span>`
    : `<span class="dialer-dot warn"></span><span>Connecting softphone…</span>`;
}

function renderQueue() {
  const count = $('dl-queue-count');
  if (count) count.textContent = `Queue · ${state.queue.length}`;
  const stats = $('dl-stats');
  if (stats) stats.textContent = `${state.stats.placed} dialed · ${state.stats.logged} logged`;

  const host = $('dl-queue');
  if (!host) return;
  if (!state.queue.length) {
    host.innerHTML = `<div class="crm-subpanel-empty" style="padding:16px;">
      No dialable contacts match. Contacts need a phone number and must not be marked do-not-call.</div>`;
    return;
  }
  host.innerHTML = state.queue.map((c, i) => `
    <button class="dialer-queue-item ${i === state.index ? 'active' : ''} ${i < state.index ? 'done' : ''}" data-i="${i}">
      <span class="dialer-queue-name">${escapeHtml(c.name || formatPhone(c.phone))}</span>
      <span class="dialer-queue-meta">${escapeHtml(formatPhone(c.phone))}${c.companyName ? ' · ' + escapeHtml(c.companyName) : ''}</span>
    </button>`).join('');
  host.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
    if (softphone.inCall) return;
    state.index = Number(b.getAttribute('data-i'));
    state.callSid = null;
    renderQueue(); renderStage(); renderLog(); loadHistory();
  }));
  const active = host.querySelector('.dialer-queue-item.active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

function statusLabel() {
  return {
    idle: 'Ready', connecting: 'Connecting…', ringing: 'Ringing…',
    live: 'On the call', ended: 'Call ended', error: 'Call failed'
  }[state.status] || 'Ready';
}

function renderStage() {
  const host = $('dl-stage-pane');
  if (!host) return;
  const c = current();
  if (!c) {
    host.innerHTML = `<div class="crm-subpanel-empty" style="margin:auto;">Queue is empty. Widen the filters to start dialing.</div>`;
    return;
  }
  const meta = stageMeta(c.stage);
  const live = softphone.inCall;
  host.innerHTML = `
    <div class="dialer-card">
      <div class="dialer-card-head">
        <div>
          <a class="dialer-card-name" href="/contact.html?id=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">${escapeHtml(c.name || 'Unnamed contact')}</a>
          <div class="dialer-card-sub">
            ${escapeHtml(formatPhone(c.phone))}
            ${c.companyName ? ' · ' + escapeHtml(c.companyName) : ''}
            <span class="crm-stage-badge" style="--stage-color:${meta.color}">${escapeHtml(meta.label)}</span>
          </div>
        </div>
        <div class="dialer-pos">${state.index + 1} / ${state.queue.length}</div>
      </div>

      <div class="dialer-live ${state.status}">
        <span class="dialer-live-status">${escapeHtml(statusLabel())}</span>
        <span class="dialer-timer" id="dl-timer">${live ? fmtElapsed(softphone.elapsedSec) : (state.lastDurationSec ? fmtElapsed(state.lastDurationSec) : '0:00')}</span>
      </div>

      <div class="dialer-controls">
        <button class="btn ${live ? 'btn-danger' : 'btn-primary'}" id="dl-call" ${(!state.deviceReady && !live) ? 'disabled' : ''}>
          ${live ? 'Hang up' : 'Call'}
        </button>
        <button class="btn btn-ghost" id="dl-mute" ${live ? '' : 'disabled'}>${softphone.muted ? 'Unmute' : 'Mute'}</button>
        <button class="btn btn-ghost" id="dl-skip-btn" ${live ? 'disabled' : ''}>Skip</button>
        <button class="btn btn-ghost" id="dl-next" ${live ? 'disabled' : ''}>Next →</button>
      </div>

      ${live ? `<div class="dialer-keypad" id="dl-keypad">
        ${['1','2','3','4','5','6','7','8','9','*','0','#'].map((k) => `<button class="dialer-key" data-k="${k}">${k}</button>`).join('')}
      </div>` : ''}

      <div class="dialer-history">
        <div class="dialer-history-head">Recent calls</div>
        <div id="dl-history">${renderHistoryHtml()}</div>
      </div>
      <div id="dl-err" class="auth-error" style="display:none;margin-top:10px;"></div>
    </div>`;

  $('dl-call').addEventListener('click', onCallButton);
  $('dl-mute').addEventListener('click', () => { softphone.toggleMute(); renderStage(); });
  $('dl-skip-btn').addEventListener('click', () => advance());
  $('dl-next').addEventListener('click', () => advance());
  const pad = $('dl-keypad');
  if (pad) pad.querySelectorAll('[data-k]').forEach((b) =>
    b.addEventListener('click', () => softphone.sendDigits(b.getAttribute('data-k'))));
}

function renderHistoryHtml() {
  if (!state.history.length) return `<div class="crm-subpanel-empty">No calls logged with this contact yet.</div>`;
  return state.history.slice(0, 5).map((h) => `
    <div class="dialer-history-row">
      <span>${escapeHtml(h.direction === 'in' ? 'Inbound' : 'Outbound')}${h.outcome ? ' · ' + escapeHtml(h.outcome.replace(/_/g, ' ')) : ''}</span>
      <span class="crm-mini-sub">${escapeHtml(fmtDateTime(h.createdAt))}${h.durationSec ? ' · ' + fmtElapsed(h.durationSec) : ''}</span>
      ${h.recordingUrl ? `<a class="crm-chip" href="${escapeHtml(h.recordingUrl)}" target="_blank" rel="noopener">Recording</a>` : ''}
    </div>`).join('');
}

function renderLog() {
  const host = $('dl-log');
  if (!host) return;
  const c = current();
  if (!c) { host.innerHTML = `<div class="crm-subpanel-empty">Nothing to log.</div>`; return; }
  host.innerHTML = `
    <div class="dialer-outcomes">
      ${CALL_OUTCOMES.map((o, i) => `
        <button class="dialer-outcome tone-${o.tone}" data-outcome="${o.id}">
          <span class="dialer-outcome-key">${i + 1}</span>${escapeHtml(o.label)}
        </button>`).join('')}
    </div>
    <div class="crm-form-row"><label for="dl-notes">Notes</label>
      <textarea class="c-input" id="dl-notes" rows="5" placeholder="What was said, what happens next…"></textarea></div>
    <div class="crm-form-row"><label for="dl-followup">Follow-up task (optional)</label>
      <input class="c-input" id="dl-followup" type="datetime-local" /></div>
    <label class="dialer-check" style="margin-top:10px;">
      <input type="checkbox" id="dl-autonext" checked /> Move to the next contact after logging
    </label>
    <div id="dl-log-err" class="auth-error" style="display:none;margin-top:8px;"></div>`;

  host.querySelectorAll('[data-outcome]').forEach((b) =>
    b.addEventListener('click', () => submitOutcome(b.getAttribute('data-outcome'))));
}

function fmtElapsed(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function showErr(id, msg) {
  const el = $(id);
  if (!el) return;
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg;
  el.style.display = 'block';
}

// ────────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────────
async function onCallButton() {
  if (softphone.inCall) { softphone.hangup(); return; }
  const c = current();
  if (!c) return;
  showErr('dl-err', '');
  try {
    if (!state.sessionId) {
      state.sessionId = await createDialerSession(state.companyId, {
        filterLabel: filterLabel(), queueSize: state.queue.length
      });
    }
    await softphone.call(c.phone, { contactId: c.id, sessionId: state.sessionId });
    state.stats.placed += 1;
    recordDialAttempt(state.companyId, state.sessionId);
    renderQueue();
  } catch (e) {
    showErr('dl-err', e && e.message ? e.message : String(e));
  }
}

async function submitOutcome(outcome) {
  const c = current();
  if (!c) return;
  showErr('dl-log-err', '');
  const notes = ($('dl-notes') && $('dl-notes').value.trim()) || '';
  const followRaw = ($('dl-followup') && $('dl-followup').value) || '';
  const autoNext = !$('dl-autonext') || $('dl-autonext').checked;

  const buttons = document.querySelectorAll('[data-outcome]');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await logCallOutcome(state.companyId, c.id, {
      outcome, notes,
      callSid: state.callSid,
      followUpAt: followRaw ? new Date(followRaw) : null,
      followUpTitle: followRaw ? `Call back ${c.name || formatPhone(c.phone)}` : null,
      sessionId: state.sessionId
    });
    state.stats.logged += 1;
    // Keep the local copy honest so "skip called today" and do-not-call take
    // effect immediately, without a refetch between calls.
    c.lastCalledAt = { toMillis: () => Date.now() };
    c.lastCallOutcome = outcome;
    if (outcome === 'do_not_call') c.doNotCall = true;
    state.callSid = null;
    if (autoNext) advance();
    else { renderQueue(); renderLog(); loadHistory(); }
  } catch (e) {
    showErr('dl-log-err', e && e.message ? e.message : String(e));
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

function advance() {
  if (softphone.inCall) return;
  state.callSid = null;
  state.lastDurationSec = 0;
  state.status = 'idle';
  if (state.index < state.queue.length - 1) state.index += 1;
  else buildQueue();
  renderQueue(); renderStage(); renderLog(); loadHistory();
}

async function loadHistory() {
  const c = current();
  state.history = c ? await listCalls(state.companyId, { contactId: c.id, max: 5 }) : [];
  const host = $('dl-history');
  if (host) host.innerHTML = renderHistoryHtml();
}

// ────────────────────────────────────────────────────────────────
// Softphone wiring
// ────────────────────────────────────────────────────────────────
function startTimer() {
  stopTimer();
  state.timer = setInterval(() => {
    const t = $('dl-timer');
    if (t && softphone.inCall) t.textContent = fmtElapsed(softphone.elapsedSec);
  }, 1000);
}
function stopTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

function wireSoftphone() {
  softphone.on('status', (evt) => {
    state.status = evt.status;
    if (evt.callSid) state.callSid = evt.callSid;
    if (evt.status === 'live') startTimer();
    if (['ended', 'error', 'idle'].includes(evt.status)) {
      stopTimer();
      if (typeof evt.durationSec === 'number') state.lastDurationSec = evt.durationSec;
    }
    renderStage();
    // After hanging up, put the cursor in the notes box: the disposition is
    // the next thing an agent does, every single time.
    if (evt.status === 'ended') {
      const n = $('dl-notes');
      if (n) n.focus();
      loadHistory();
    }
  });
  softphone.on('error', (err) => {
    const msg = (err && (err.message || err.description)) || 'Voice error';
    showErr('dl-err', msg);
  });
  softphone.on('incoming', (call) => {
    // A live inbound call while power dialing is almost always a callback —
    // surface it rather than letting it ring into the void.
    if (softphone.inCall) { softphone.reject(call); return; }
    const from = formatPhone((call.parameters && call.parameters.From) || '');
    if (window.confirm(`Incoming call from ${from}. Answer?`)) softphone.accept(call);
    else softphone.reject(call);
  });
}

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'c') { e.preventDefault(); onCallButton(); }
    else if (k === 'm') { e.preventDefault(); softphone.toggleMute(); renderStage(); }
    else if (k === 'n') { e.preventDefault(); advance(); }
    else if (/^[1-9]$/.test(k)) {
      const o = CALL_OUTCOMES[Number(k) - 1];
      if (o) { e.preventDefault(); submitOutcome(o.id); }
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
  let companyId = new URLSearchParams(location.search).get('companyId') || info.companyId || null;
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
  content.innerHTML = `<div class="crm-section-sub">Loading contacts…</div>`;

  state.allContacts = await listContacts(companyId);
  layout();
  buildQueue();

  // Deep link: /dialer.html?contact=ID starts the run on that contact.
  const target = new URLSearchParams(location.search).get('contact');
  if (target) {
    const i = state.queue.findIndex((c) => c.id === target);
    if (i >= 0) state.index = i;
  }

  renderDeviceStatus();
  renderQueue();
  renderStage();
  renderLog();
  loadHistory();

  wireSoftphone();
  wireKeyboard();

  try {
    await softphone.init(companyId);
    state.deviceReady = true;
    state.deviceError = null;
  } catch (e) {
    state.deviceReady = false;
    state.deviceError = (e && e.message) || 'Softphone unavailable.';
  }
  renderDeviceStatus();
  renderStage();

  window.addEventListener('beforeunload', () => {
    if (state.sessionId) endDialerSession(state.companyId, state.sessionId);
    softphone.destroy();
  });
}

main();
