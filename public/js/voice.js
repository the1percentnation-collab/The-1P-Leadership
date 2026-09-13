// Softphone engine — a thin, UI-agnostic wrapper around the Twilio Voice JS
// SDK. Pages import this, subscribe to events, and never touch Twilio.Device
// directly, so the dialer page and the contact page behave identically.
//
//   import { softphone } from './voice.js';
//   softphone.on('status', (s) => …);           // idle|connecting|ringing|live|ended|error
//   await softphone.init(companyId);            // mints a token, registers the device
//   await softphone.call('+15551234567', { contactId });
//   softphone.hangup(); softphone.setMuted(true); softphone.sendDigits('1');
//
// The access token is short-lived and minted per admin by the getVoiceToken
// callable; nothing secret ever reaches the browser.

import { functions } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const SDK_URL = 'https://sdk.twilio.com/js/voice/releases/2.12.3/twilio.min.js';

let sdkPromise = null;
/** Load the Voice SDK once, on demand — it is ~300KB and most pages never call. */
function loadSdk() {
  if (window.Twilio && window.Twilio.Device) return Promise.resolve(window.Twilio);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => (window.Twilio && window.Twilio.Device)
      ? resolve(window.Twilio)
      : reject(new Error('Voice SDK loaded but Twilio.Device is missing.'));
    s.onerror = () => { sdkPromise = null; reject(new Error('Could not load the Twilio Voice SDK.')); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

/** E.164 for dialing. Bare 10-digit input is assumed US, matching the backend. */
export function toE164(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s[0] !== '+') {
    const digits = s.replace(/\D/g, '');
    s = digits.length === 10 ? '+1' + digits : '+' + digits;
  }
  return s.length >= 8 ? s : null;
}

/** Pretty US formatting for display; anything else passes through. */
export function formatPhone(raw) {
  const e = toE164(raw);
  if (!e) return raw || '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e;
}

class Softphone {
  constructor() {
    this.device = null;
    this.activeCall = null;
    this.companyId = null;
    this.identity = null;
    this.callerId = null;
    this.recording = false;
    this.status = 'idle';
    this.muted = false;
    this.startedAt = null;
    this.lastError = null;
    this._listeners = {};
    this._tokenCall = null;
  }

  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const arr = this._listeners[event];
    if (arr) this._listeners[event] = arr.filter((f) => f !== fn);
  }

  _emit(event, payload) {
    (this._listeners[event] || []).forEach((fn) => {
      try { fn(payload); } catch (e) { console.warn('[voice] listener', e); }
    });
  }

  _setStatus(status, extra = {}) {
    this.status = status;
    this._emit('status', { status, ...extra });
  }

  get ready() { return !!this.device; }
  get inCall() { return ['connecting', 'ringing', 'live'].includes(this.status); }

  /** Seconds since the call was answered, for a live timer. */
  get elapsedSec() {
    return this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  }

  async _fetchToken() {
    if (!this._tokenCall) this._tokenCall = httpsCallable(functions, 'getVoiceToken');
    const res = await this._tokenCall({ companyId: this.companyId });
    const data = res.data || {};
    this.identity = data.identity || null;
    this.callerId = data.callerId || null;
    this.recording = !!data.recording;
    return data.token;
  }

  /**
   * Mint a token and bring the device up. Safe to call repeatedly — the second
   * call for the same company is a no-op, so pages can init on load.
   */
  async init(companyId) {
    if (this.device && this.companyId === companyId) return this;
    if (!companyId) throw new Error('A company is required before calling.');
    this.companyId = companyId;
    this.lastError = null;

    const Twilio = await loadSdk();
    const token = await this._fetchToken();

    if (this.device) { try { this.device.destroy(); } catch (e) {} this.device = null; }

    const device = new Twilio.Device(token, {
      codecPreferences: ['opus', 'pcmu'],
      logLevel: 'error'
    });

    device.on('error', (err) => {
      this.lastError = err;
      this._emit('error', err);
      // 31005/31009 are transport drops; the SDK reconnects on its own.
      if (this.inCall) this._setStatus('error', { error: err });
    });
    device.on('tokenWillExpire', async () => {
      try { device.updateToken(await this._fetchToken()); }
      catch (e) { this._emit('error', e); }
    });
    device.on('incoming', (call) => {
      this._emit('incoming', call);
    });
    device.on('registered', () => this._emit('registered', { identity: this.identity }));

    try { await device.register(); } catch (e) { /* outbound still works unregistered */ }

    this.device = device;
    this._setStatus('idle');
    return this;
  }

  /** Wire a Call object (inbound or outbound) into our status machine. */
  _bind(call, meta = {}) {
    this.activeCall = call;
    this.meta = meta;
    this.muted = false;
    this.startedAt = null;

    call.on('ringing', () => this._setStatus('ringing', meta));
    call.on('accept', () => {
      this.startedAt = Date.now();
      this._setStatus('live', { ...meta, callSid: this.callSid });
    });
    call.on('disconnect', () => this._end('ended', meta));
    call.on('cancel', () => this._end('ended', meta));
    call.on('reject', () => this._end('ended', meta));
    call.on('error', (err) => { this.lastError = err; this._end('error', { ...meta, error: err }); });
    return call;
  }

  _end(status, meta) {
    const durationSec = this.elapsedSec;
    const callSid = this.callSid;
    this.activeCall = null;
    this.startedAt = null;
    this.muted = false;
    this._setStatus(status, { ...meta, durationSec, callSid });
  }

  /** The Twilio CallSid of the live leg — the key the backend logs under. */
  get callSid() {
    try { return (this.activeCall && this.activeCall.parameters && this.activeCall.parameters.CallSid) || null; }
    catch (e) { return null; }
  }

  /**
   * Place a call. `to` is any phone format; extra params ride along to the
   * TwiML webhook so the backend can open the call record with full context.
   */
  async call(to, { contactId = null, sessionId = null } = {}) {
    if (!this.device) throw new Error('The softphone is not connected yet.');
    if (this.inCall) throw new Error('Already on a call.');
    const dest = toE164(to);
    if (!dest) throw new Error('That phone number is not dialable.');

    this._setStatus('connecting', { to: dest, contactId });
    try {
      const call = await this.device.connect({
        params: {
          To: dest,
          companyId: this.companyId || '',
          contactId: contactId || '',
          sessionId: sessionId || ''
        }
      });
      return this._bind(call, { to: dest, contactId, sessionId });
    } catch (e) {
      this._end('error', { to: dest, contactId, error: e });
      throw e;
    }
  }

  /** Accept a ringing inbound call. */
  accept(call) {
    if (!call) return;
    const from = (call.parameters && call.parameters.From) || null;
    this._bind(call, { from, inbound: true });
    call.accept();
  }

  reject(call) { try { call && call.reject(); } catch (e) {} }

  hangup() {
    if (this.activeCall) { try { this.activeCall.disconnect(); } catch (e) {} }
    else if (this.device) { try { this.device.disconnectAll(); } catch (e) {} }
  }

  setMuted(on) {
    if (!this.activeCall) return false;
    this.activeCall.mute(!!on);
    this.muted = !!on;
    this._emit('mute', this.muted);
    return this.muted;
  }

  toggleMute() { return this.setMuted(!this.muted); }

  sendDigits(digits) {
    if (this.activeCall && digits) this.activeCall.sendDigits(String(digits));
  }

  destroy() {
    this.hangup();
    if (this.device) { try { this.device.destroy(); } catch (e) {} }
    this.device = null;
    this.companyId = null;
    this._setStatus('idle');
  }
}

export const softphone = new Softphone();
