// OPN Course Advisor — Futuristic voice + text chatbot widget.
// Animated sine-wave visualization, STT via Web Speech API, optional TTS.
// Call init() once per page.

import { functions } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

let _init = false;

export function init() {
  if (_init) return;
  _init = true;
  injectStyles();
  const root = buildWidget();
  document.body.appendChild(root);
  wireUp(root);
}

// ─── DOM ─────────────────────────────────────────────────────────────────────

function buildWidget() {
  const root = document.createElement('div');
  root.id = 'opn-chat-widget';
  root.innerHTML = `
    <!-- Floating Action Button -->
    <button class="opn-fab" id="opn-fab" aria-label="Open course advisor" aria-expanded="false">
      <span class="opn-fab-ring opn-fab-ring-1" aria-hidden="true"></span>
      <span class="opn-fab-ring opn-fab-ring-2" aria-hidden="true"></span>
      <span class="opn-fab-core" aria-hidden="true">
        <svg class="opn-fab-icon" viewBox="0 0 28 20" fill="currentColor">
          <rect x="0"  y="7"  width="4" height="6"  rx="2"/>
          <rect x="6"  y="4"  width="4" height="12" rx="2"/>
          <rect x="12" y="0"  width="4" height="20" rx="2"/>
          <rect x="18" y="4"  width="4" height="12" rx="2"/>
          <rect x="24" y="7"  width="4" height="6"  rx="2"/>
        </svg>
      </span>
    </button>

    <!-- Chat Panel -->
    <div class="opn-panel" id="opn-panel" role="dialog" aria-modal="true" aria-label="1PN">
      <!-- Corner targeting marks -->
      <i class="opn-crn opn-crn-tl" aria-hidden="true"></i>
      <i class="opn-crn opn-crn-tr" aria-hidden="true"></i>
      <i class="opn-crn opn-crn-bl" aria-hidden="true"></i>
      <i class="opn-crn opn-crn-br" aria-hidden="true"></i>

      <!-- Header -->
      <div class="opn-hdr">
        <div class="opn-hdr-left">
          <span class="opn-led" id="opn-led" aria-hidden="true"></span>
          <span class="opn-hdr-title">1PN</span>
        </div>
        <div class="opn-hdr-right">
          <button class="opn-tts-btn" id="opn-tts-btn" aria-label="Toggle voice output" title="Toggle voice output">
            <svg class="opn-spk-on"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
            <svg class="opn-spk-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/>
              <line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          </button>
          <button class="opn-close" id="opn-close" aria-label="Close chat">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <line x1="1" y1="1" x2="13" y2="13"/>
              <line x1="13" y1="1" x2="1" y2="13"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Wave visualizer -->
      <div class="opn-viz" aria-hidden="true">
        <canvas id="opn-canvas" class="opn-canvas"></canvas>
        <div class="opn-viz-status" id="opn-viz-status">READY</div>
      </div>

      <!-- Messages -->
      <div class="opn-msgs" id="opn-msgs" role="log" aria-live="polite" aria-label="Conversation"></div>

      <!-- Input bar -->
      <div class="opn-bar">
        <button class="opn-mic" id="opn-mic" aria-label="Voice input — click to speak" title="Click to speak">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8"  y1="23" x2="16" y2="23"/>
          </svg>
          <span class="opn-mic-ring" aria-hidden="true"></span>
        </button>
        <textarea
          id="opn-input"
          class="opn-input"
          placeholder="Type or speak your question…"
          rows="1"
          maxlength="2000"
          aria-label="Your message"
        ></textarea>
        <button class="opn-send" id="opn-send" aria-label="Send message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  return root;
}

// ─── Logic ────────────────────────────────────────────────────────────────────

function wireUp(root) {
  const fab      = root.querySelector('#opn-fab');
  const panel    = root.querySelector('#opn-panel');
  const closeBtn = root.querySelector('#opn-close');
  const canvas   = root.querySelector('#opn-canvas');
  const vizStatus= root.querySelector('#opn-viz-status');
  const led      = root.querySelector('#opn-led');
  const msgs     = root.querySelector('#opn-msgs');
  const micBtn   = root.querySelector('#opn-mic');
  const input    = root.querySelector('#opn-input');
  const sendBtn  = root.querySelector('#opn-send');
  const ttsBtn   = root.querySelector('#opn-tts-btn');

  // ── State ──
  const S = { IDLE: 'idle', LISTEN: 'listen', THINK: 'think', SPEAK: 'speak' };
  const waveState = { v: S.IDLE, boost: 0 };
  let isOpen      = false;
  let loading     = false;
  let greeted     = false;
  let history     = [];
  let stopWave    = null;
  let voiceOut    = false; // TTS enabled flag

  function setS(s) {
    waveState.v = s;
    const labels = { idle: 'READY', listen: 'LISTENING…', think: 'PROCESSING…', speak: 'SPEAKING…' };
    vizStatus.textContent = labels[s] || 'READY';
    led.className = `opn-led opn-led-${s}`;
    micBtn.classList.toggle('opn-mic-active', s === S.LISTEN);
  }

  // ── TTS toggle ──
  ttsBtn.addEventListener('click', () => {
    voiceOut = !voiceOut;
    ttsBtn.classList.toggle('opn-tts-on', voiceOut);
  });

  // ── Open / close ──
  function openPanel() {
    isOpen = true;
    panel.classList.add('opn-open');
    fab.setAttribute('aria-expanded', 'true');
    panel.removeAttribute('aria-hidden');
    // Start wave on first open (after layout is painted)
    if (!stopWave) requestAnimationFrame(() => { stopWave = startWave(canvas, waveState); });
    input.focus();
    if (!greeted) {
      greeted = true;
      setTimeout(() => addMsg('assistant', 'Hi — I\'m 1PN. Ask me anything about our courses, your progress, or what you\'d like to learn next. You can type or tap the mic to speak.'), 350);
    }
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('opn-open');
    fab.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    stopListen();
    stopSpeak();
    fab.focus();
  }

  fab.addEventListener('click', () => isOpen ? closePanel() : openPanel());
  closeBtn.addEventListener('click', closePanel);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

  // ── Auto-grow textarea ──
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 112) + 'px';
    // Spike wave on each character change
    waveState.boost = Math.min(waveState.boost + 4, 22);
  });
  input.addEventListener('keydown', (e) => {
    // Printable key check (length===1 excludes Enter, Backspace, Arrow, etc.)
    if (e.key.length === 1) waveState.boost = Math.min(waveState.boost + 3, 22);
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  sendBtn.addEventListener('click', doSend);

  // ── Send ──
  async function doSend() {
    const text = input.value.trim();
    if (!text || loading) return;
    input.value = '';
    input.style.height = 'auto';
    stopListen();
    stopSpeak();
    addMsg('user', text);
    history.push({ role: 'user', content: text });

    loading = true;
    sendBtn.disabled = true;
    setS(S.THINK);
    const thinkRow = addThinking();

    try {
      const call = httpsCallable(functions, 'courseAdvisorChat');
      const res  = await call({ message: text, history: history.slice(0, -1) });
      const reply = (res.data && res.data.reply) || 'Sorry, I didn\'t catch that. Please try again.';
      history.push({ role: 'assistant', content: reply });
      thinkRow.remove();
      addMsg('assistant', reply);

      if (voiceOut) {
        setS(S.SPEAK);
        await speakText(reply);
      }
      setS(S.IDLE);
    } catch (err) {
      console.error('[chatbot]', err);
      thinkRow.remove();
      addMsg('assistant', 'Something went wrong — please try again.', true);
      setS(S.IDLE);
    } finally {
      loading = false;
      sendBtn.disabled = false;
    }
  }

  // ── Message helpers ──
  function addMsg(role, text, isErr = false) {
    const row = document.createElement('div');
    row.className = `opn-row opn-row-${role}`;
    const bub = document.createElement('div');
    bub.className = `opn-bub opn-bub-${role}${isErr ? ' opn-bub-err' : ''}`;
    bub.textContent = text;
    row.appendChild(bub);
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
    return row;
  }

  function addThinking() {
    const row = document.createElement('div');
    row.className = 'opn-row opn-row-assistant';
    row.innerHTML = `<div class="opn-bub opn-bub-assistant opn-think-dots">
      <span class="opn-dot"></span><span class="opn-dot"></span><span class="opn-dot"></span>
    </div>`;
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
    return row;
  }

  // ── Voice input (STT) ──
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition  = null;
  let isListening  = false;

  if (!SpeechRec) {
    micBtn.style.display = 'none';
  } else {
    micBtn.addEventListener('click', () => isListening ? stopListen() : startListen());
  }

  function startListen() {
    if (!SpeechRec || loading) return;
    stopSpeak();
    isListening = true;
    voiceOut    = true; // Auto-enable TTS when user uses voice
    ttsBtn.classList.add('opn-tts-on');
    setS(S.LISTEN);

    recognition = new SpeechRec();
    recognition.continuous     = false;
    recognition.interimResults = true;
    recognition.lang           = 'en-US';

    recognition.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      input.value = final || interim;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 112) + 'px';
      if (final) setTimeout(doSend, 180);
    };

    recognition.onend = () => {
      isListening = false;
      if (waveState.v === S.LISTEN) setS(S.IDLE);
    };
    recognition.onerror = (e) => {
      console.warn('[chatbot] STT error:', e.error);
      isListening = false;
      if (waveState.v === S.LISTEN) setS(S.IDLE);
    };

    try { recognition.start(); }
    catch (e) { console.warn('[chatbot] recognition start:', e); isListening = false; setS(S.IDLE); }
  }

  function stopListen() {
    isListening = false;
    if (recognition) { try { recognition.stop(); } catch (e) {} recognition = null; }
    if (waveState.v === S.LISTEN) setS(S.IDLE);
  }

  // ── Voice output (TTS) ──
  let curUtterance = null;

  function speakText(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text) { resolve(); return; }
      stopSpeak();
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = 0.97; utt.pitch = 1.0; utt.volume = 1.0;
      const pickVoice = () => {
        const voices = speechSynthesis.getVoices();
        return voices.find(v => /en-US/i.test(v.lang) && /google/i.test(v.name))
            || voices.find(v => /en-US/i.test(v.lang))
            || voices.find(v => /en/i.test(v.lang))
            || null;
      };
      const start = () => {
        const voice = pickVoice();
        if (voice) utt.voice = voice;
        utt.onend   = resolve;
        utt.onerror = resolve;
        curUtterance = utt;
        speechSynthesis.speak(utt);
      };
      if (speechSynthesis.getVoices().length) {
        start();
      } else {
        speechSynthesis.addEventListener('voiceschanged', start, { once: true });
      }
    });
  }

  function stopSpeak() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    curUtterance = null;
    if (waveState.v === S.SPEAK) setS(S.IDLE);
  }
}

// ─── Wave Canvas ──────────────────────────────────────────────────────────────

function startWave(canvas, stateRef) {
  const dpr  = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth  || 360;
  const cssH = canvas.clientHeight || 80;
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  let frame   = 0;
  let amp     = 4;  // target amplitude tracker
  let liveAmp = 4;  // smoothed amplitude that actually drives drawing
  let raf;

  // Per-state config — gentler speeds, softer amplitudes
  const CFG = {
    idle:   { targetAmp: 4,  speed: 0.011 },
    listen: { targetAmp: 22, speed: 0.048 },
    think:  { targetAmp: 10, speed: 0.030 },
    speak:  { targetAmp: 16, speed: 0.042 },
  };

  function draw() {
    const s   = stateRef.v;
    const cfg = CFG[s] || CFG.idle;
    const W   = cssW, H = cssH;

    // Slowly decay typing boost (~1.5 s at 60 fps)
    if (stateRef.boost > 0) {
      stateRef.boost *= 0.94;
      if (stateRef.boost < 0.15) stateRef.boost = 0;
    }

    // Drive the raw amplitude toward the state target
    amp += (Math.min(cfg.targetAmp + stateRef.boost, 38) - amp) * 0.05;

    // liveAmp follows amp with extra lag so nothing ever jumps
    liveAmp += (amp - liveAmp) * 0.10;

    let a = liveAmp;
    // Gentle breathing while thinking (organic, no randomness)
    if (s === 'think')  a *= 0.62 + 0.38 * Math.sin(frame * 0.042);
    // Organic variation while listening — two slow oscillators, no Math.random
    if (s === 'listen') a *= 0.78 + 0.15 * Math.sin(frame * 0.07) + 0.07 * Math.sin(frame * 0.13 + 1.1);

    ctx.clearRect(0, 0, W, H);

    // Filled area under primary wave
    const fillGrad = ctx.createLinearGradient(0, H * 0.35, 0, H);
    fillGrad.addColorStop(0, 'rgba(230,3,6,0.22)');
    fillGrad.addColorStop(1, 'rgba(230,3,6,0)');
    ctx.save();
    ctx.beginPath();
    wave(ctx, W, H, a, cfg.speed, frame, 0);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();
    ctx.restore();

    // Wave layers (primary, secondary, highlight)
    strokeWave(ctx, W, H, a,        cfg.speed, frame, 0,              '#E60306',           1.00, 2.2);
    strokeWave(ctx, W, H, a * 0.60, cfg.speed, frame, Math.PI / 2.2, 'rgba(255,80,80,.5)', 1.00, 1.4);
    strokeWave(ctx, W, H, a * 0.28, cfg.speed, frame, Math.PI,       'rgba(255,255,255,.14)', 1.00, 1.0);

    // Center glow line
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(frame * 0.05);
    ctx.strokeStyle = '#E60306';
    ctx.lineWidth   = 0.5;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.restore();

    frame++;
    raf = requestAnimationFrame(draw);
  }

  draw();
  return () => cancelAnimationFrame(raf);
}

function wave(ctx, W, H, amp, speed, frame, phase) {
  ctx.beginPath();
  for (let x = 0; x <= W; x += 2) {
    // Three harmonically-related frequencies → organic voice-like shape
    const y = H / 2 + (
      Math.sin(x * 0.019 + frame * speed          + phase) * amp * 0.55 +
      Math.sin(x * 0.034 + frame * speed * 1.31   + phase * 1.2) * amp * 0.30 +
      Math.sin(x * 0.011 + frame * speed * 0.62   + phase * 0.6) * amp * 0.15
    );
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
}

function strokeWave(ctx, W, H, amp, speed, frame, phase, color, alpha, lw) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth   = lw;
  ctx.lineJoin    = 'round';
  wave(ctx, W, H, amp, speed, frame, phase);
  ctx.stroke();
  ctx.restore();
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('opn-chat-css')) return;
  const el = document.createElement('style');
  el.id = 'opn-chat-css';
  el.textContent = `
/* ── Widget root ─────────────────────────────────────────────── */
#opn-chat-widget {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 9999;
  font-family: 'Outfit', sans-serif;
}

/* ── FAB ─────────────────────────────────────────────────────── */
.opn-fab {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: #0d0d0d;
  box-shadow:
    0 0 0 1.5px rgba(230,3,6,.55),
    0 0 18px rgba(230,3,6,.35),
    0 6px 24px rgba(0,0,0,.7);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow .2s ease, transform .18s ease;
}
.opn-fab:hover {
  transform: scale(1.07);
  box-shadow:
    0 0 0 1.5px rgba(230,3,6,.8),
    0 0 28px rgba(230,3,6,.55),
    0 8px 32px rgba(0,0,0,.75);
}
.opn-fab:active { transform: scale(.96); }

/* Pulse rings */
.opn-fab-ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(230,3,6,.45);
  pointer-events: none;
  animation: opn-ring 2.8s cubic-bezier(.215,.61,.355,1) infinite;
}
.opn-fab-ring-1 { inset: -10px; animation-delay: 0s; }
.opn-fab-ring-2 { inset: -20px; animation-delay: .9s; }
@keyframes opn-ring {
  0%   { transform: scale(.88); opacity: .8; }
  70%  { transform: scale(1.2); opacity: 0; }
  100% { transform: scale(1.2); opacity: 0; }
}

/* Waveform bars in FAB icon */
.opn-fab-core { color: #E60306; display: flex; }
.opn-fab-icon { width: 28px; height: 20px; }
.opn-fab-icon rect {
  transform-box: fill-box;
  transform-origin: center bottom;
  animation: opn-fab-bar 1.7s ease-in-out infinite;
}
.opn-fab-icon rect:nth-child(1) { animation-delay: 0s; }
.opn-fab-icon rect:nth-child(2) { animation-delay: .12s; }
.opn-fab-icon rect:nth-child(3) { animation-delay: .24s; }
.opn-fab-icon rect:nth-child(4) { animation-delay: .12s; }
.opn-fab-icon rect:nth-child(5) { animation-delay: 0s; }
@keyframes opn-fab-bar {
  0%, 100% { transform: scaleY(1); }
  50%       { transform: scaleY(.35); }
}

/* ── Panel ───────────────────────────────────────────────────── */
.opn-panel {
  position: absolute;
  bottom: 72px;
  right: 0;
  width: 380px;
  max-width: calc(100vw - 40px);
  border-radius: 18px;
  overflow: hidden;
  /* Subtle grid overlay background */
  background:
    linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px),
    #090909;
  background-size: 22px 22px, 22px 22px, auto;
  border: 1px solid rgba(230,3,6,.38);
  box-shadow:
    0 0 0 1px rgba(230,3,6,.10),
    0 0 40px rgba(230,3,6,.10),
    0 24px 64px rgba(0,0,0,.85),
    inset 0 1px 0 rgba(255,255,255,.06);
  /* Scanline overlay */
  --scan: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 3px,
    rgba(0,0,0,.06) 3px,
    rgba(0,0,0,.06) 4px
  );

  /* Closed state */
  transform: scale(.93) translateY(10px);
  opacity: 0;
  pointer-events: none;
  transition:
    transform .32s cubic-bezier(.34,1.56,.64,1),
    opacity   .22s ease;
}
.opn-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--scan);
  pointer-events: none;
  border-radius: inherit;
  z-index: 20;
}
.opn-panel.opn-open {
  transform: scale(1) translateY(0);
  opacity: 1;
  pointer-events: auto;
}

/* Corner targeting marks */
.opn-crn {
  position: absolute;
  width: 14px;
  height: 14px;
  pointer-events: none;
  z-index: 2;
}
.opn-crn-tl { top:8px;    left:8px;  border-top:1.5px solid rgba(230,3,6,.7); border-left:1.5px solid rgba(230,3,6,.7); }
.opn-crn-tr { top:8px;    right:8px; border-top:1.5px solid rgba(230,3,6,.7); border-right:1.5px solid rgba(230,3,6,.7); }
.opn-crn-bl { bottom:8px; left:8px;  border-bottom:1.5px solid rgba(230,3,6,.7); border-left:1.5px solid rgba(230,3,6,.7); }
.opn-crn-br { bottom:8px; right:8px; border-bottom:1.5px solid rgba(230,3,6,.7); border-right:1.5px solid rgba(230,3,6,.7); }

/* ── Header ──────────────────────────────────────────────────── */
.opn-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  background: rgba(5,5,5,.8);
  border-bottom: 1px solid rgba(230,3,6,.18);
  position: relative;
  z-index: 1;
}
.opn-hdr-left  { display: flex; align-items: center; gap: 9px; }
.opn-hdr-right { display: flex; align-items: center; gap: 4px; }

.opn-led {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #333;
  flex-shrink: 0;
  transition: background .25s, box-shadow .25s;
}
.opn-led-listen {
  background: #E60306;
  box-shadow: 0 0 8px #E60306;
  animation: opn-led-blink .7s ease-in-out infinite;
}
.opn-led-think {
  background: #ff8800;
  box-shadow: 0 0 7px #ff8800;
  animation: opn-led-blink .45s ease-in-out infinite;
}
.opn-led-speak {
  background: #E60306;
  box-shadow: 0 0 10px #E60306;
}
@keyframes opn-led-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: .25; }
}

.opn-hdr-title {
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  letter-spacing: .18em;
  color: #d0d0d8;
  font-weight: 700;
}
.opn-hdr-badge {
  font-family: 'Space Mono', monospace;
  font-size: 9px;
  letter-spacing: .12em;
  color: #E60306;
  border: 1px solid rgba(230,3,6,.45);
  border-radius: 4px;
  padding: 1px 6px;
}

.opn-tts-btn, .opn-close {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s, color .15s;
}
.opn-tts-btn { color: #444; }
.opn-tts-btn:hover { background: rgba(255,255,255,.05); color: #888; }
.opn-tts-btn.opn-tts-on  { color: #E60306; }
.opn-tts-btn svg { width: 15px; height: 15px; }

/* Show/hide speaker icons based on state */
.opn-tts-btn .opn-spk-on  { display: none; }
.opn-tts-btn .opn-spk-off { display: block; }
.opn-tts-btn.opn-tts-on .opn-spk-on  { display: block; }
.opn-tts-btn.opn-tts-on .opn-spk-off { display: none; }

.opn-close { color: #555; }
.opn-close:hover { background: rgba(255,255,255,.06); color: #ccc; }
.opn-close svg { width: 13px; height: 13px; }

/* ── Wave visualizer ─────────────────────────────────────────── */
.opn-viz {
  background: #050505;
  border-bottom: 1px solid rgba(255,255,255,.05);
  position: relative;
}
.opn-canvas {
  display: block;
  width: 100%;
  height: 80px;
}
.opn-viz-status {
  text-align: center;
  font-family: 'Space Mono', monospace;
  font-size: 9px;
  letter-spacing: .28em;
  color: rgba(230,3,6,.75);
  padding: 3px 0 7px;
}

/* ── Messages ────────────────────────────────────────────────── */
.opn-msgs {
  flex: 1;
  overflow-y: auto;
  padding: 14px 14px 6px;
  min-height: 200px;
  max-height: 280px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  scrollbar-width: thin;
  scrollbar-color: #2a2a2a transparent;
}
.opn-msgs::-webkit-scrollbar { width: 4px; }
.opn-msgs::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }

.opn-row { display: flex; }
.opn-row-user      { justify-content: flex-end; }
.opn-row-assistant { justify-content: flex-start; }

.opn-bub {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  animation: opn-msg-in .22s ease;
}
@keyframes opn-msg-in {
  from { opacity: 0; transform: translateY(6px) scale(.97); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

.opn-bub-user {
  background: linear-gradient(135deg, #c20204, #E60306);
  color: #fff;
  border-bottom-right-radius: 4px;
  box-shadow: 0 3px 14px rgba(230,3,6,.35);
}
.opn-bub-assistant {
  background: rgba(14,14,14,.95);
  color: #e2e2e8;
  border: 1px solid rgba(230,3,6,.22);
  border-bottom-left-radius: 4px;
  box-shadow: 0 2px 10px rgba(0,0,0,.45);
}
.opn-bub-err {
  background: rgba(30,10,10,.95);
  border-color: rgba(200,50,50,.5);
  color: #f08888;
}

/* Thinking dots */
.opn-think-dots {
  display: flex !important;
  align-items: center;
  gap: 5px;
  padding: 12px 16px !important;
}
.opn-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #E60306;
  display: inline-block;
  animation: opn-dot-bounce 1.1s ease-in-out infinite;
}
.opn-dot:nth-child(2) { animation-delay: .18s; }
.opn-dot:nth-child(3) { animation-delay: .36s; }
@keyframes opn-dot-bounce {
  0%, 80%, 100% { transform: translateY(0) scale(1); opacity: .7; }
  40%            { transform: translateY(-8px) scale(1.15); opacity: 1; }
}

/* ── Input bar ───────────────────────────────────────────────── */
.opn-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 11px 13px;
  background: rgba(5,5,5,.85);
  border-top: 1px solid rgba(230,3,6,.15);
  position: relative;
  z-index: 1;
}

/* Mic button */
.opn-mic {
  flex-shrink: 0;
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(230,3,6,.07);
  border: 1px solid rgba(230,3,6,.28);
  color: #666;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .18s, border-color .18s, color .18s, box-shadow .18s;
}
.opn-mic svg { width: 17px; height: 17px; }
.opn-mic:hover {
  background: rgba(230,3,6,.14);
  border-color: rgba(230,3,6,.55);
  color: #E60306;
}
.opn-mic-active {
  background: rgba(230,3,6,.22) !important;
  border-color: #E60306 !important;
  color: #E60306 !important;
  box-shadow: 0 0 14px rgba(230,3,6,.45) !important;
}
.opn-mic-ring {
  position: absolute;
  inset: -7px;
  border-radius: 50%;
  border: 1px solid rgba(230,3,6,.5);
  pointer-events: none;
  opacity: 0;
}
.opn-mic-active .opn-mic-ring {
  opacity: 1;
  animation: opn-mic-pulse 1.1s ease-in-out infinite;
}
@keyframes opn-mic-pulse {
  0%   { transform: scale(.9);  opacity: .9; }
  70%  { transform: scale(1.4); opacity: 0; }
  100% { transform: scale(1.4); opacity: 0; }
}

/* Textarea */
.opn-input {
  flex: 1;
  background: rgba(10,10,10,.95);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 11px;
  color: #e8e8f0;
  font-family: 'Outfit', sans-serif;
  font-size: 13.5px;
  line-height: 1.5;
  padding: 9px 13px;
  resize: none;
  outline: none;
  min-height: 40px;
  max-height: 112px;
  transition: border-color .18s, box-shadow .18s;
}
.opn-input:focus {
  border-color: rgba(230,3,6,.6);
  box-shadow: 0 0 0 3px rgba(230,3,6,.12);
}
.opn-input::placeholder { color: #444; }
.opn-input:disabled { opacity: .45; }

/* Send button */
.opn-send {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: #E60306;
  border: none;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s, transform .1s, box-shadow .18s;
  box-shadow: 0 3px 12px rgba(230,3,6,.4);
}
.opn-send:hover {
  background: #c20205;
  box-shadow: 0 4px 18px rgba(230,3,6,.6);
}
.opn-send:active { transform: scale(.9); }
.opn-send:disabled { background: #2a2a2a; box-shadow: none; cursor: not-allowed; }
.opn-send svg { width: 17px; height: 17px; }

/* ── Mobile ──────────────────────────────────────────────────── */
@media (max-width: 440px) {
  #opn-chat-widget { bottom: 18px; right: 18px; }
  .opn-panel { width: calc(100vw - 36px); bottom: 78px; }
}
  `;
  document.head.appendChild(el);
}
