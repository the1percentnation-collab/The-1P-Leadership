// Softphone core — the one place that knows how to place a call, and the only
// surface that owns the docked call bar. The contact page, the contacts list,
// the dialer queue and the conversations inbox all drive calls through here so
// that a call survives navigation-free interactions and a lead can never be
// dialed twice from two places at once.
//
//   import { dialer } from './dialer-core.js';
//   await dialer.configure({ companyId, uid });
//   const result = await dialer.callContact(contact);   // resolves after disposition
//
// Three connection modes, in the order they are tried:
//   softphone — Twilio Voice WebRTC in this tab (the default)
//   bridge    — Twilio rings the agent's own cell, then dials the lead
//   manual    — no Twilio credentials: hand off to the device dialer via tel:
//               and still require a disposition, so the pipeline stays honest
//
// The vendored SDK (public/vendor/) is injected on first use rather than on
// page load: most CRM page views never place a call, and it is a 296 KB parse.

import {
  createCallLog, updateCallLog, setCallDisposition, getVoiceToken, startBridgeCall,
  dropVoicemail, getDialerSettings, getAgentPrefs, quietHoursWarning, callBlockReason,
  CALL_DISPOSITIONS, changeStage, dispositionMeta, escapeHtml
} from './crm.js';

const SDK_SRC = '/vendor/twilio-voice-2.18.5.min.js';

const state = {
  companyId: null,
  uid: null,
  settings: null,
  prefs: null,
  device: null,
  deviceError: null,      // set once we know voice is unavailable, so we stop retrying
  activeCall: null,       // the Twilio Call object, softphone mode only
  callDoc: null,          // { id, ... } of the companies/{cid}/calls doc
  contact: null,
  status: 'idle',
  startedMs: null,
  timerId: null,
  muted: false,
  keypadOpen: false,
  resolve: null,          // resolves callContact() once a disposition is recorded
  hotkeys: false,
  dockHost: null          // element to render the call panel into; null = fixed bottom bar
};

const listeners = new Map();

export function onDialerEvent(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name).delete(fn);
}

function emit(name, detail) {
  (listeners.get(name) || []).forEach((fn) => {
    try { fn(detail); } catch (e) { console.warn('[dialer] listener failed', e); }
  });
}

// ────────────────────────────────────────────────────────────────
// SDK + device
// ────────────────────────────────────────────────────────────────

let sdkPromise = null;
function loadSdk() {
  if (window.Twilio && window.Twilio.Device) return Promise.resolve(window.Twilio);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SDK_SRC;
    el.async = true;
    el.onload = () => {
      if (window.Twilio && window.Twilio.Device) resolve(window.Twilio);
      else reject(new Error('Voice SDK loaded but exposed no Device'));
    };
    el.onerror = () => reject(new Error('Could not load the Voice SDK'));
    document.head.appendChild(el);
  });
  return sdkPromise;
}

/**
 * Build the Twilio Device once and keep it registered. Any failure here —
 * missing Twilio credentials, a blocked microphone, no network — is recorded
 * in state.deviceError and downgrades every later call to manual mode instead
 * of throwing into the page.
 */
async function ensureDevice() {
  if (state.device) return state.device;
  if (state.deviceError) throw state.deviceError;
  try {
    const [Twilio, tokenData] = await Promise.all([loadSdk(), getVoiceToken(state.companyId)]);
    const device = new Twilio.Device(tokenData.token, {
      codecPreferences: ['opus', 'pcmu'],
      logLevel: 'error'
    });
    device.on('tokenWillExpire', async () => {
      try {
        const fresh = await getVoiceToken(state.companyId);
        device.updateToken(fresh.token);
      } catch (e) { console.warn('[dialer] token refresh failed', e); }
    });
    device.on('error', (err) => {
      console.warn('[dialer] device error', err && err.message);
      // 31401 is "user denied microphone access" — worth surfacing plainly,
      // because the fix is a browser permission, not a retry.
      if (err && err.code === 31401) setStatus('error', 'Microphone access was blocked. Allow it in your browser, then try again.');
    });
    device.on('incoming', (call) => {
      // Inbound calls are answered from the dock so a lead calling back does
      // not get dropped just because nobody was on the Conversations page.
      handleIncoming(call);
    });
    await device.register();
    state.device = device;
    return device;
  } catch (e) {
    state.deviceError = e;
    throw e;
  }
}

/** True when a real softphone is available right now. */
export function softphoneReady() {
  return !!state.device && !state.deviceError;
}

// ────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────

/**
 * Must be awaited before callContact(). Loads company dialer settings and the
 * agent's own mode preference. Does NOT build the Twilio Device — that happens
 * on the first actual call, so a page view costs nothing.
 */
export async function configure({ companyId, uid, hotkeys = false, dockHost = null } = {}) {
  state.companyId = companyId || state.companyId;
  state.uid = uid || state.uid;
  state.hotkeys = !!hotkeys;
  // A page can host the call panel inline (the contact record does, so the
  // record stays readable during the call). Anything else gets the fixed bar.
  state.dockHost = typeof dockHost === 'string' ? document.getElementById(dockHost) : (dockHost || null);
  const [settings, prefs] = await Promise.all([
    getDialerSettings(state.companyId),
    getAgentPrefs(state.uid)
  ]);
  state.settings = settings;
  state.prefs = prefs;
  ensureDock();
  if (state.hotkeys) enableHotkeys();
  return { settings, prefs };
}

/** Warm the softphone up so the first call does not pay the token round-trip. */
export async function prewarm() {
  try { await ensureDevice(); return true; } catch (e) { return false; }
}

export function setMode(mode) {
  if (!state.prefs) state.prefs = {};
  state.prefs.callMode = mode === 'bridge' ? 'bridge' : 'softphone';
  renderDock();
  return state.prefs.callMode;
}

export function currentMode() {
  return (state.prefs && state.prefs.callMode) || 'softphone';
}

// ────────────────────────────────────────────────────────────────
// Placing a call
// ────────────────────────────────────────────────────────────────

/**
 * Dial a contact. Resolves once the call has ended AND a disposition has been
 * recorded, with { callId, disposition, durationSec, followUp }. Rejects only
 * when the call never started (blocked contact, agent cancelled the quiet-hours
 * confirm) — a failed connection still resolves, with a disposition.
 */
export async function callContact(contact, { mode } = {}) {
  if (state.status !== 'idle' && state.status !== 'error') {
    throw new Error('A call is already in progress.');
  }
  const blocked = callBlockReason(contact);
  if (blocked) throw new Error(blocked);

  const warn = quietHoursWarning(state.settings, new Date());
  if (warn && !window.confirm(`${warn}\n\nCall ${contact.name || 'this contact'} anyway?`)) {
    throw new Error('Cancelled.');
  }

  state.contact = contact;
  state.muted = false;
  state.keypadOpen = false;
  const wanted = mode || currentMode();

  // Log the attempt first: if the browser crashes mid-call the attempt is
  // still on the record, which is the whole point of a dialer.
  state.callDoc = await createCallLog(state.companyId, {
    contactId: contact.id,
    contactName: contact.name || null,
    contactPhone: contact.phone || null,
    direction: 'out',
    mode: wanted,
    status: 'queued'
  });

  setStatus('connecting');
  emit('callstart', { contact, callId: state.callDoc.id });

  const done = new Promise((resolve) => { state.resolve = resolve; });

  try {
    if (wanted === 'bridge') await placeBridgeCall(contact);
    else await placeSoftphoneCall(contact);
  } catch (e) {
    // Twilio is not set up, the mic was blocked, or the bridge failed. Fall
    // back to the device dialer rather than losing the lead, and still collect
    // a disposition so the queue keeps moving.
    console.warn('[dialer] falling back to manual', e && e.message);
    await placeManualCall(contact, e && e.message);
  }

  return done;
}

async function placeSoftphoneCall(contact) {
  const device = await ensureDevice();
  const call = await device.connect({
    params: {
      To: contact.phone,
      companyId: state.companyId,
      contactId: contact.id,
      callId: state.callDoc.id
    }
  });
  state.activeCall = call;

  call.on('accept', () => {
    // Twilio's own SID only exists once the call is accepted; storing it lets
    // voiceStatusWebhook and dropVoicemail find this exact call.
    const sid = call.parameters && call.parameters.CallSid;
    startTimer();
    setStatus('live');
    updateCallLog(state.companyId, state.callDoc.id, {
      status: 'in-progress', twilioCallSid: sid || null
    }).catch(() => {});
  });
  call.on('ringing', () => setStatus('ringing'));
  call.on('reject', () => finishCall('no-answer'));
  call.on('cancel', () => finishCall('canceled'));
  call.on('disconnect', () => finishCall('completed'));
  call.on('error', (err) => {
    setStatus('error', (err && err.message) || 'Call failed.');
    finishCall('failed');
  });
}

async function placeBridgeCall(contact) {
  if (!state.prefs || !state.prefs.mobilePhone) {
    throw new Error('Add your mobile number in CRM Settings to use cell-bridge mode.');
  }
  setStatus('ringing', `Ringing your phone at ${state.prefs.mobilePhone}…`);
  const res = await startBridgeCall(state.companyId, contact.id, state.callDoc.id);
  await updateCallLog(state.companyId, state.callDoc.id, {
    status: 'ringing', twilioCallSid: (res && res.sid) || null
  }).catch(() => {});
  // There is no in-browser call object to listen to in bridge mode: the audio
  // path is Twilio→cell→lead. The agent closes the call out from the dock.
  setStatus('bridged', 'Connected through your phone. Hang up there, then log the outcome.');
  startTimer();
}

async function placeManualCall(contact, reason) {
  await updateCallLog(state.companyId, state.callDoc.id, { mode: 'manual', status: 'in-progress' }).catch(() => {});
  setStatus('manual', reason
    ? `Calling is not set up in the browser yet (${reason}). Opening your phone dialer instead.`
    : 'Opening your phone dialer.');
  startTimer();
  try { window.location.href = 'tel:' + contact.phone; } catch (e) { /* desktop with no handler */ }
}

// ────────────────────────────────────────────────────────────────
// Ending a call
// ────────────────────────────────────────────────────────────────

export function hangUp() {
  if (state.activeCall) {
    try { state.activeCall.disconnect(); return; } catch (e) { /* fall through */ }
  }
  // Bridge and manual modes have nothing to disconnect in this tab.
  finishCall('completed');
}

function finishCall(status) {
  if (state.status === 'disposition' || state.status === 'idle') return;
  stopTimer();
  const durationSec = state.startedMs ? Math.round((Date.now() - state.startedMs) / 1000) : 0;
  state.lastDurationSec = durationSec;
  state.activeCall = null;
  if (state.callDoc) {
    updateCallLog(state.companyId, state.callDoc.id, {
      status, durationSec, endedAt: new Date()
    }).catch(() => {});
  }
  setStatus('disposition');
  emit('callend', { callId: state.callDoc && state.callDoc.id, status, durationSec });
}

/** Record the outcome and release the dock. */
export async function recordDisposition(disposition, note) {
  if (!state.callDoc) return;
  const meta = dispositionMeta(disposition);
  const callId = state.callDoc.id;
  const contact = state.contact;
  const durationSec = state.lastDurationSec || 0;

  try {
    await setCallDisposition(state.companyId, callId, {
      disposition, note, contactId: contact && contact.id, durationSec
    });
  } catch (e) {
    alert('Could not save the outcome: ' + (e.message || e));
    return;
  }

  // Outcomes that imply a pipeline move make it, but never backwards: a
  // customer who answers the phone should not drop to "contacted".
  if (meta && meta.advanceTo && contact && contact.stage && shouldAdvance(contact.stage, meta.advanceTo)) {
    try {
      await changeStage(state.companyId, contact.id, contact.stage, meta.advanceTo);
      contact.stage = meta.advanceTo;
    } catch (e) { console.warn('[dialer] stage advance failed', e); }
  }

  const result = { callId, disposition, durationSec, followUp: (meta && meta.followUp) || null, contact };
  resetDock();
  emit('disposition', result);
  if (state.resolve) { const r = state.resolve; state.resolve = null; r(result); }
  return result;
}

// Stage order is the pipeline order in crm.js STAGES. 'lost' is always a
// legal destination; otherwise only forward moves are applied automatically.
const STAGE_ORDER = ['new', 'contacted', 'qualified', 'negotiating', 'customer'];
function shouldAdvance(from, to) {
  if (to === 'lost') return from !== 'customer';
  const a = STAGE_ORDER.indexOf(from);
  const b = STAGE_ORDER.indexOf(to);
  if (a === -1 || b === -1) return false;
  return b > a;
}

// ────────────────────────────────────────────────────────────────
// Inbound
// ────────────────────────────────────────────────────────────────

function handleIncoming(call) {
  const from = (call.parameters && call.parameters.From) || 'Unknown';
  ensureDock();
  state.status = 'incoming';
  state.contact = { id: null, name: from, phone: from };
  renderDock(`Incoming call from ${from}`);
  const dock = document.getElementById('call-dock');
  const accept = dock.querySelector('[data-dock="accept"]');
  const reject = dock.querySelector('[data-dock="reject"]');
  if (accept) accept.addEventListener('click', () => {
    call.accept();
    state.activeCall = call;
    startTimer();
    setStatus('live');
    call.on('disconnect', () => finishCall('completed'));
  });
  if (reject) reject.addEventListener('click', () => { call.reject(); resetDock(); });
}

// ────────────────────────────────────────────────────────────────
// Timer
// ────────────────────────────────────────────────────────────────

function startTimer() {
  if (state.startedMs) return;
  state.startedMs = Date.now();
  state.timerId = setInterval(() => {
    const el = document.getElementById('call-dock-timer');
    if (el) el.textContent = fmtElapsed(Date.now() - state.startedMs);
  }, 1000);
}

function stopTimer() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────
// The dock
// ────────────────────────────────────────────────────────────────

function setStatus(status, message) {
  state.status = status;
  renderDock(message);
  emit('statechange', { status, message });
}

function ensureDock() {
  let dock = document.getElementById('call-dock');
  const inline = !!(state.dockHost && document.body.contains(state.dockHost));
  // If the host changed (page re-rendered), move or rebuild the dock.
  if (dock && inline && dock.parentElement !== state.dockHost) { dock.remove(); dock = null; }
  if (dock && !inline && dock.parentElement !== document.body) { dock.remove(); dock = null; }
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'call-dock';
    dock.className = inline ? 'call-dock call-dock-inline' : 'call-dock';
    dock.hidden = true;
    (inline ? state.dockHost : document.body).appendChild(dock);
  }
  return dock;
}

function dockIsInline() {
  const dock = document.getElementById('call-dock');
  return !!(dock && dock.classList.contains('call-dock-inline'));
}

function resetDock() {
  stopTimer();
  state.status = 'idle';
  state.callDoc = null;
  state.contact = null;
  state.startedMs = null;
  state.lastDurationSec = 0;
  state.activeCall = null;
  const dock = document.getElementById('call-dock');
  if (dock) { dock.hidden = true; dock.innerHTML = ''; }
  document.body.classList.remove('has-call-dock');
}

const STATUS_LABEL = {
  connecting: 'Connecting…',
  ringing: 'Ringing…',
  live: 'On a call',
  bridged: 'On a call (via your phone)',
  manual: 'On a call (via your phone)',
  incoming: 'Incoming call',
  disposition: 'Log the outcome',
  error: 'Call problem'
};

function renderDock(message) {
  const dock = ensureDock();
  if (state.status === 'idle') {
    dock.hidden = true; dock.innerHTML = '';
    document.body.classList.remove('has-call-dock');
    return;
  }
  dock.hidden = false;
  if (!dockIsInline()) document.body.classList.add('has-call-dock');

  const c = state.contact || {};
  const name = escapeHtml(c.name || c.phone || 'Unknown');
  const phone = escapeHtml(c.phone || '');
  const label = STATUS_LABEL[state.status] || state.status;
  const showTimer = ['live', 'bridged', 'manual'].includes(state.status);
  const inCall = ['connecting', 'ringing', 'live', 'bridged', 'manual'].includes(state.status);

  dock.innerHTML = `
    <div class="call-dock-inner">
      <div class="call-dock-id">
        <div class="call-dock-name">${name}</div>
        <div class="call-dock-sub">${label}${phone ? ' · ' + phone : ''}</div>
      </div>
      ${showTimer ? `<div class="call-dock-timer" id="call-dock-timer">0:00</div>` : ''}
      <div class="call-dock-controls">
        ${state.status === 'incoming' ? `
          <button class="call-dock-btn call-dock-btn-accept" data-dock="accept">Answer</button>
          <button class="call-dock-btn call-dock-btn-end" data-dock="reject">Decline</button>
        ` : ''}
        ${state.status === 'live' ? `
          <button class="call-dock-btn ${state.muted ? 'active' : ''}" data-dock="mute">${state.muted ? 'Unmute' : 'Mute'}</button>
          <button class="call-dock-btn ${state.keypadOpen ? 'active' : ''}" data-dock="keypad">Keypad</button>
          <button class="call-dock-btn" data-dock="voicemail" title="Leave your prerecorded voicemail and move on">Drop VM</button>
        ` : ''}
        ${inCall ? `<button class="call-dock-btn call-dock-btn-end" data-dock="hangup">End call</button>` : ''}
      </div>
    </div>
    ${message ? `<div class="call-dock-status">${escapeHtml(message)}</div>` : ''}
    ${state.keypadOpen && state.status === 'live' ? keypadHtml() : ''}
    ${state.status === 'disposition' ? dispositionHtml() : ''}
  `;
  wireDock();
}

function keypadHtml() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  return `<div class="call-keypad">${keys.map((k) =>
    `<button class="call-keypad-key" data-digit="${k}">${k}</button>`).join('')}</div>`;
}

function dispositionHtml() {
  const mins = state.lastDurationSec
    ? `${Math.floor(state.lastDurationSec / 60)}m ${state.lastDurationSec % 60}s`
    : 'no connection';
  return `
    <div class="call-dock-disposition">
      <div class="call-dock-disp-head">How did it go? <span>${escapeHtml(mins)}</span></div>
      <div class="disp-grid">
        ${CALL_DISPOSITIONS.map((d) => `
          <button class="disp-btn" data-disp="${d.id}">
            <span class="disp-key">${d.key}</span>${escapeHtml(d.label)}
          </button>`).join('')}
      </div>
      <input class="c-input call-dock-note" id="call-dock-note" placeholder="Add a note (optional)" autocomplete="off" />
    </div>`;
}

function wireDock() {
  const dock = document.getElementById('call-dock');
  if (!dock) return;
  const act = (sel, fn) => dock.querySelectorAll(sel).forEach((el) => el.addEventListener('click', fn));

  act('[data-dock="hangup"]', () => hangUp());
  act('[data-dock="mute"]', () => {
    state.muted = !state.muted;
    if (state.activeCall) { try { state.activeCall.mute(state.muted); } catch (e) {} }
    renderDock();
  });
  act('[data-dock="keypad"]', () => { state.keypadOpen = !state.keypadOpen; renderDock(); });
  act('[data-dock="voicemail"]', () => triggerVoicemailDrop());
  dock.querySelectorAll('[data-digit]').forEach((b) => b.addEventListener('click', () => {
    const d = b.getAttribute('data-digit');
    if (state.activeCall) { try { state.activeCall.sendDigits(d); } catch (e) {} }
  }));
  dock.querySelectorAll('[data-disp]').forEach((b) => b.addEventListener('click', () => {
    const noteEl = document.getElementById('call-dock-note');
    b.classList.add('active');
    recordDisposition(b.getAttribute('data-disp'), noteEl ? noteEl.value : '');
  }));
}

async function triggerVoicemailDrop() {
  const sid = state.activeCall && state.activeCall.parameters && state.activeCall.parameters.CallSid;
  if (!sid) { setStatus(state.status, 'No active call to drop a voicemail into.'); return; }
  try {
    await dropVoicemail(state.companyId, sid, null);
    setStatus(state.status, 'Voicemail dropped. Hanging up.');
    hangUp();
  } catch (e) {
    setStatus(state.status, 'Voicemail drop failed: ' + (e.message || e));
  }
}

// ────────────────────────────────────────────────────────────────
// Hotkeys — the difference between a dialer and a form. Opt-in, and always
// inert while the agent is typing into a field.
// ────────────────────────────────────────────────────────────────

let hotkeysBound = false;
function enableHotkeys() {
  if (hotkeysBound) return;
  hotkeysBound = true;
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (state.status === 'disposition') {
      const match = CALL_DISPOSITIONS.find((d) => d.key === e.key);
      if (match) { e.preventDefault(); recordDisposition(match.id, ''); }
      return;
    }
    if (e.key === ' ' && ['live', 'bridged', 'manual', 'ringing'].includes(state.status)) {
      e.preventDefault(); hangUp();
    }
  });
}

export const dialer = {
  configure, callContact, hangUp, recordDisposition, prewarm,
  setMode, currentMode, softphoneReady, onDialerEvent,
  get status() { return state.status; },
  get activeCallId() { return state.callDoc && state.callDoc.id; }
};
