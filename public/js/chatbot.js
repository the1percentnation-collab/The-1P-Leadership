// OPN Course Advisor chatbot — floating widget.
// Works in both public (unauthenticated) and member portal (authenticated) mode.
// Call chatbot.init() once per page. Idempotent — safe to call multiple times.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { onAuthReady } from './auth.js';

let _initialised = false;

export function init() {
  if (_initialised) return;
  _initialised = true;

  injectStyles();
  const widget = buildWidget();
  document.body.appendChild(widget);
  wireUp(widget);
}

// ── DOM ──────────────────────────────────────────────────────────────────────

function buildWidget() {
  const root = document.createElement('div');
  root.id = 'opn-chat-widget';
  root.innerHTML = `
    <button class="opn-chat-fab" id="opn-chat-fab" aria-label="Open course advisor" title="Ask your course advisor">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>

    <div class="opn-chat-panel" id="opn-chat-panel" role="dialog" aria-modal="true" aria-labelledby="opn-chat-heading" hidden>
      <div class="opn-chat-header">
        <div class="opn-chat-header-info">
          <div class="opn-chat-avatar" aria-hidden="true">1%</div>
          <div>
            <div class="opn-chat-heading" id="opn-chat-heading">Course Advisor</div>
            <div class="opn-chat-subhead">One Percent Nation</div>
          </div>
        </div>
        <button class="opn-chat-close" id="opn-chat-close" aria-label="Close chat">&times;</button>
      </div>

      <div class="opn-chat-messages" id="opn-chat-messages" role="log" aria-live="polite" aria-label="Chat messages"></div>

      <form class="opn-chat-form" id="opn-chat-form" autocomplete="off">
        <textarea
          class="opn-chat-input"
          id="opn-chat-input"
          placeholder="Ask about courses, goals, or your progress…"
          rows="1"
          maxlength="2000"
          aria-label="Your message"
        ></textarea>
        <button class="opn-chat-send" id="opn-chat-send" type="submit" aria-label="Send message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </form>
    </div>
  `;
  return root;
}

// ── Logic ─────────────────────────────────────────────────────────────────────

function wireUp(root) {
  const fab    = root.querySelector('#opn-chat-fab');
  const panel  = root.querySelector('#opn-chat-panel');
  const close  = root.querySelector('#opn-chat-close');
  const form   = root.querySelector('#opn-chat-form');
  const input  = root.querySelector('#opn-chat-input');
  const msgs   = root.querySelector('#opn-chat-messages');

  let history  = [];   // [{role, content}]
  let loading  = false;
  let greeted  = false;

  function open() {
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    panel.setAttribute('aria-hidden', 'false');
    input.focus();
    if (!greeted) {
      greeted = true;
      appendMsg('assistant', 'Hi! I\'m your One Percent Nation course advisor. Ask me anything about our courses, your progress, or tell me what you\'d like to learn next.');
    }
  }

  function close_() {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    fab.focus();
  }

  fab.addEventListener('click', open);
  close.addEventListener('click', close_);

  // Close on Escape.
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close_();
  });

  // Auto-grow textarea.
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // Send on Enter (Shift+Enter = newline).
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || loading) return;

    input.value = '';
    input.style.height = 'auto';
    appendMsg('user', text);
    setLoading(true);

    const userTurn = { role: 'user', content: text };
    history.push(userTurn);

    try {
      const call = httpsCallable(functions, 'courseAdvisorChat');
      // Send history WITHOUT the message we just appended (it's the `message` param).
      const historyToSend = history.slice(0, -1);
      const res = await call({ message: text, history: historyToSend });
      const reply = (res.data && res.data.reply) || 'Sorry, I didn\'t catch that. Please try again.';
      history.push({ role: 'assistant', content: reply });
      appendMsg('assistant', reply);
    } catch (err) {
      console.error('[chatbot] error:', err);
      history.push({ role: 'assistant', content: 'Something went wrong — please try again in a moment.' });
      appendMsg('assistant', 'Something went wrong — please try again in a moment.', true);
    } finally {
      setLoading(false);
    }
  });

  function appendMsg(role, text, isError = false) {
    const wrap = document.createElement('div');
    wrap.className = `opn-msg opn-msg-${role}${isError ? ' opn-msg-error' : ''}`;

    const bubble = document.createElement('div');
    bubble.className = 'opn-msg-bubble';
    bubble.textContent = text;

    wrap.appendChild(bubble);
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function setLoading(on) {
    loading = on;
    const send = root.querySelector('#opn-chat-send');
    send.disabled = on;
    input.disabled = on;

    const existing = msgs.querySelector('.opn-typing');
    if (on && !existing) {
      const wrap = document.createElement('div');
      wrap.className = 'opn-msg opn-msg-assistant opn-typing';
      wrap.innerHTML = '<div class="opn-msg-bubble"><span class="opn-dot"></span><span class="opn-dot"></span><span class="opn-dot"></span></div>';
      msgs.appendChild(wrap);
      msgs.scrollTop = msgs.scrollHeight;
    } else if (!on && existing) {
      existing.remove();
    }
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('opn-chat-styles')) return;
  const s = document.createElement('style');
  s.id = 'opn-chat-styles';
  s.textContent = `
    #opn-chat-widget {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      font-family: 'Outfit', sans-serif;
    }

    /* FAB */
    .opn-chat-fab {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #E60306;
      color: #fff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0,0,0,.45);
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .opn-chat-fab:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 20px rgba(230,3,6,.5);
    }
    .opn-chat-fab svg { width: 24px; height: 24px; }

    /* Panel */
    .opn-chat-panel {
      position: absolute;
      bottom: 68px;
      right: 0;
      width: 360px;
      max-width: calc(100vw - 32px);
      background: #111;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0,0,0,.6);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Header */
    .opn-chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      background: #161616;
      border-bottom: 1px solid #222;
    }
    .opn-chat-header-info { display: flex; align-items: center; gap: 10px; }
    .opn-chat-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #E60306;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      letter-spacing: .5px;
      flex-shrink: 0;
    }
    .opn-chat-heading { font-size: 14px; font-weight: 600; color: #f0f0f0; }
    .opn-chat-subhead { font-size: 11px; color: #888; margin-top: 1px; }
    .opn-chat-close {
      background: none;
      border: none;
      color: #888;
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 6px;
      transition: color .12s, background .12s;
    }
    .opn-chat-close:hover { color: #f0f0f0; background: #2a2a2a; }

    /* Messages */
    .opn-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      min-height: 260px;
      max-height: 360px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scrollbar-width: thin;
      scrollbar-color: #333 transparent;
    }
    .opn-chat-messages::-webkit-scrollbar { width: 4px; }
    .opn-chat-messages::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

    .opn-msg { display: flex; }
    .opn-msg-user { justify-content: flex-end; }
    .opn-msg-assistant { justify-content: flex-start; }

    .opn-msg-bubble {
      max-width: 78%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 13.5px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .opn-msg-user .opn-msg-bubble {
      background: #E60306;
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .opn-msg-assistant .opn-msg-bubble {
      background: #1e1e1e;
      color: #e8e8e8;
      border: 1px solid #2a2a2a;
      border-bottom-left-radius: 4px;
    }
    .opn-msg-error .opn-msg-bubble {
      background: #2a1010;
      border-color: #5a2020;
      color: #f08080;
    }

    /* Typing dots */
    .opn-typing .opn-msg-bubble {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 12px 16px;
    }
    .opn-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #888;
      display: inline-block;
      animation: opn-bounce 1.2s infinite ease-in-out;
    }
    .opn-dot:nth-child(2) { animation-delay: .2s; }
    .opn-dot:nth-child(3) { animation-delay: .4s; }
    @keyframes opn-bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
    }

    /* Input form */
    .opn-chat-form {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 12px 14px;
      border-top: 1px solid #222;
      background: #161616;
    }
    .opn-chat-input {
      flex: 1;
      background: #0d0d0d;
      border: 1px solid #2a2a2a;
      border-radius: 10px;
      color: #f0f0f0;
      font-family: inherit;
      font-size: 13.5px;
      line-height: 1.5;
      padding: 9px 12px;
      resize: none;
      outline: none;
      min-height: 38px;
      max-height: 120px;
      transition: border-color .15s;
    }
    .opn-chat-input:focus { border-color: #E60306; }
    .opn-chat-input::placeholder { color: #555; }
    .opn-chat-input:disabled { opacity: .5; }

    .opn-chat-send {
      flex-shrink: 0;
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: #E60306;
      border: none;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background .15s, transform .1s;
    }
    .opn-chat-send:hover { background: #c00205; }
    .opn-chat-send:active { transform: scale(.93); }
    .opn-chat-send:disabled { background: #555; cursor: not-allowed; }
    .opn-chat-send svg { width: 16px; height: 16px; }

    @media (max-width: 420px) {
      #opn-chat-widget { bottom: 16px; right: 16px; }
      .opn-chat-panel { width: calc(100vw - 32px); }
    }
  `;
  document.head.appendChild(s);
}
