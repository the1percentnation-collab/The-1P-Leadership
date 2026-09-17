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
//   softphone — Telnyx WebRTC in this tab (the default)
//   bridge    — Telnyx rings the agent's own cell, then dials the lead
//   manual    — no calling credentials: hand off to the device dialer via tel:
//               and still require a disposition, so the pipeline stays honest
//
// The vendored SDK (public/vendor/) is imported on first use rather than on
// page load: most CRM page views never place a call, and it is a 266 KB parse.

import {
  createCallLog, updateCallLog, setCallDisposition, getVoiceToken, authorizeCall, startBridgeCall,
  dropVoicemail, getDialerSettings, getAgentPrefs, quietHoursWarning, callBlockReason,
  CALL_DISPOSITIONS, changeStage, dispositionMeta, escapeHtml
} from './crm.js';

const SDK_SRC = '/vendor/telnyx-webrtc-2.27.10.min.mjs';

const state = {
  companyId: null,
  uid: null,
  settings: null,
  prefs: null,
  device: null,
  deviceError: null,      // set once we know voice is unavailable, so we stop retrying
  activeCall: null,       // call adapter (see wrapCall), softphone mode only
  rawCall: null,          // the Telnyx Call object behind the adapter
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
  // The Telnyx bundle is a self-contained ES module, so a plain dynamic import
  // works with no bundler and no globals.
  if (sdkPromise) return sdkPromise;
  sdkPromise = import(SDK_SRC).then((mod) => {
    if (!mod || !mod.TelnyxRTC) throw new Error('Voice SDK loaded but exposed no TelnyxRTC');
    return mod;
  }).catch((e) => {
    sdkPromise = null;
    throw new Error('Could not load the Voice SDK: ' + (e && e.message));
  });
  return sdkPromise;
}

/**
 * Telnyx plays remote audio into an element we supply, where the Twilio SDK
 * managed its own. One hidden element, reused for every call, appended to the
 * body rather than the dock so re-rendering the dock never cuts the audio.
 */
function remoteAudioEl() {
  let el = document.getElementById('dialer-remote-audio');
  if (!el) {
    el = document.createElement('audio');
    el.id = 'dialer-remote-audio';
    el.autoplay = true;
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Present a Telnyx Call through the small surface the dock already drives:
 * disconnect / mute / sendDigits / parameters.CallSid. Keeping this adapter
 * means the dock, the keypad, the mute button and the voicemail drop are
 * provider-agnostic and did not have to change with the migration.
 */
function wrapCall(call) {
  return {
    raw: call,
    disconnect() { try { call.hangup(); } catch (e) {} },
    mute(on) { try { on ? call.muteAudio() : call.unmuteAudio(); } catch (e) {} },
    sendDigits(d) { try { call.dtmf(d); } catch (e) {} },
    // Telnyx exposes the call-control leg id only when the call is bridged
    // through a TeXML application; on a direct WebRTC dial there is none, which
    // is why the dock hides voicemail drop outside bridge mode.
    get parameters() {
      return { CallSid: call.telnyxCallControlId || call.telnyxLegId || null };
    }
  };
}

/**
 * Build the Telnyx client once and keep it registered. Any failure here —
 * missing credentials, a blocked microphone, no network — is recorded in
 * state.deviceError and downgrades every later call to manual mode instead of
 * throwing into the page.
 *
 * The token is a JWT minted server-side against a per-agent telephony
 * credential. It outlives a browsing session comfortably, and a refresh means
 * building a new client, so there is no equivalent of Twilio's updateToken.
 */
async function ensureDevice() {
  if (state.device) return state.device;
  if (state.deviceError) throw state.deviceError;
  try {
    const [mod, tokenData] = await Promise.all([loadSdk(), getVoiceToken(state.companyId)]);
    const client = new mod.TelnyxRTC({ login_token: tokenData.token });

    client.on('telnyx.error', (err) => {
      const msg = (err && (err.message || (err.error && err.error.message))) || 'Calling error';
      console.warn('[dialer] client error', msg);
      // A blocked microphone is worth surfacing plainly: the fix is a browser
      // permission, not a retry.
      if (/permission|microphone|NotAllowed/i.test(msg)) {
        setStatus('error', 'Microphone access was blocked. Allow it in your browser, then try again.');
      }
    });

    client.on('telnyx.notification', (n) => {
      if (!n || n.type !== 'callUpdate' || !n.call) return;
      const call = n.call;
      // Inbound calls are answered from the dock so a lead calling back does
      // not get dropped just because nobody was on the Conversations page.
      if (call.direction === 'inbound' && call.state === 'ringing'
          && state.status === 'idle' && state.rawCall !== call) {
        handleIncoming(call);
        return;
      }
      if (state.rawCall === call) onSoftphoneState(call);
    });

    // remoteElement is set per call; audio needs it in place before answering.
    client.remoteElement = remoteAudioEl();

    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('Calling did not connect in time.')), 15000);
      client.on('telnyx.ready', () => { clearTimeout(to); resolve(); });
      client.on('telnyx.socket.error', () => { clearTimeout(to); reject(new Error('Could not reach the calling service.')); });
      client.connect();
    });

    state.device = client;
    return client;
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
    // A consent refusal is not a transport problem: falling back to the device
    // dialer would place exactly the call the server just forbade.
    if (e && e.fatal) {
      await updateCallLog(state.companyId, state.callDoc.id, { status: 'canceled' }).catch(() => {});
      setStatus('error', e.message || 'This call is not allowed.');
      recordDisposition('bad_number', e.message || 'Blocked before dialing.');
      return done;
    }
    // Calling is not set up, the mic was blocked, or the bridge failed. Fall
    // back to the device dialer rather than losing the lead, and still collect
    // a disposition so the queue keeps moving.
    console.warn('[dialer] falling back to manual', e && e.message);
    await placeManualCall(contact, e && e.message);
  }

  return done;
}

async function placeSoftphoneCall(contact) {
  const device = await ensureDevice();

  // The server gets the last word on consent and supplies the number to dial,
  // which is what voiceOutboundTwiml used to do before the call reached the
  // carrier. A rejection here is a hard stop, not a fallback to manual.
  let auth;
  try {
    auth = await authorizeCall(state.companyId, contact.id);
  } catch (e) {
    // failed-precondition here means consent or configuration, and the two
    // need opposite handling: refuse the first, degrade on the second.
    const msg = (e && e.message) || 'Call not authorized.';
    if (/do not call|opted out|no phone number/i.test(msg)) {
      const fatal = new Error(msg);
      fatal.fatal = true;
      throw fatal;
    }
    throw e;
  }

  const call = device.newCall({
    destinationNumber: auth.to,
    callerNumber: auth.callerId || undefined,
    callerName: (state.settings && state.settings.callerName) || undefined,
    audio: true,
    video: false,
    remoteElement: remoteAudioEl()
  });
  state.rawCall = call;
  state.activeCall = wrapCall(call);
  setStatus('ringing');
}

/**
 * Telnyx reports one call through repeated state changes rather than discrete
 * accept/reject/disconnect events, so the mapping to our call statuses lives
 * in one place. States: new, requesting, trying, recovering, ringing,
 * answering, early, active, held, hangup, destroy, purge.
 */
function onSoftphoneState(call) {
  switch (call.state) {
    case 'trying':
    case 'requesting':
    case 'early':
    case 'ringing':
      setStatus('ringing');
      break;
    case 'active':
      if (state.status === 'live') break;
      startTimer();
      setStatus('live');
      updateCallLog(state.companyId, state.callDoc.id, {
        status: 'in-progress',
        twilioCallSid: (state.activeCall && state.activeCall.parameters.CallSid) || null
      }).catch(() => {});
      break;
    case 'hangup':
    case 'destroy':
    case 'purge': {
      // The SIP cause separates "they did not pick up" from "we hung up",
      // which is the difference between a no-answer and a completed call on
      // the contact's record.
      const cause = String(call.cause || '').toUpperCase();
      if (!state.startedMs && (cause === 'NO_ANSWER' || cause === 'ORIGINATOR_CANCEL' || call.sipCode === 480)) {
        finishCall('no-answer');
      } else if (cause === 'USER_BUSY' || call.sipCode === 486) {
        finishCall('busy');
      } else if (!state.startedMs && cause && cause !== 'NORMAL_CLEARING') {
        setStatus('error', 'Call failed (' + cause.toLowerCase().replace(/_/g, ' ') + ').');
        finishCall('failed');
      } else {
        finishCall('completed');
      }
      break;
    }
    default:
      break;
  }
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
  // path is Telnyx→cell→lead. The agent closes the call out from the dock.
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
  state.rawCall = null;
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
  const from = (call.options && call.options.remoteCallerNumber) || 'Unknown';
  ensureDock();
  state.status = 'incoming';
  state.contact = { id: null, name: from, phone: from };
  renderDock(`Incoming call from ${from}`);
  const dock = document.getElementById('call-dock');
  const accept = dock.querySelector('[data-dock="accept"]');
  const reject = dock.querySelector('[data-dock="reject"]');
  if (accept) accept.addEventListener('click', () => {
    state.rawCall = call;
    state.activeCall = wrapCall(call);
    // State changes flow through the client's notification handler, which
    // takes over once rawCall is set — including the hangup at the far end.
    call.answer({ remoteElement: remoteAudioEl() });
    startTimer();
    setStatus('live');
  });
  if (reject) reject.addEventListener('click', () => {
    try { call.hangup(); } catch (e) {}
    resetDock();
  });
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
  state.rawCall = null;
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
  if (!sid) {
    // A direct WebRTC dial has no server-side call leg to redirect, so there
    // is nothing to play the greeting into. Cell-bridge calls run through a
    // TeXML application and do have one.
    setStatus(state.status, state.status === 'live'
      ? 'Voicemail drop needs cell-bridge mode — a browser call has no leg to redirect.'
      : 'No active call to drop a voicemail into.');
    return;
  }
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
